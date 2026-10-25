"""Vision Studio API."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import sys
import threading
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from pathlib import Path

from agent.bedrock import explain_payload, history_payload
from agent.complete import timing_from_brief
from agent.explain import explain_result
from agent.genres import load_genres, present_history, reference_values
from agent.facts import parse_chords
from agent.prompts import base_layer, seeds_for
from agent.theory import bass_midi, chords_midi
from agent.turn import run_turn
from contracts import AudioFeatures, LayerPrompt, RenderJob, RenderResult, SongBrief, TraceStep, TurnRequest, TurnResponse
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, StreamingResponse
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

from api.audio import (
    UPLOAD_LIMIT,
    ConversionError,
    analyse,
    assert_short_enough,
    check_session_id,
    convert_to_wav,
    default_data_root,
    midi_name,
    needs_conversion,
    session_dir,
    stored_name,
    upload_kind,
)
from api.guard import BODY_LIMIT, RateLimiter, allowed_origins, assert_frontend_clean, cleanup_old_sessions, content_too_large
from api.renderer import MockRenderer, Renderer, pin_chord_audio
from api.stability import StabilityAPIRenderer
from api.account import register_account
from api.auth import attach_user, resolve_request_user
from api.job_handlers import register_default_handlers
from api.jobs import create_job, enqueue, get_job, job_public, register_handler
from api.storage import build_store, session_object_key
from api.train import register_train
from api.usage import assert_within_quota, plan_for, record_job_usage

logger = logging.getLogger("api")
_LIMITED = {"/turn", "/render", "/upload"}
_INPUTS = {"text_only", "hum", "vocal", "instrument_loop", "drum_loop", "full_track", "midi"}
_session_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()
_LAYER_ERROR = "That layer did not render. Try again."


class PromptText(BaseModel):
    layer: str
    prompt: str
    negative: str


class RenderBody(BaseModel):
    session_id: str
    prompts: list[PromptText] | None = None
    layer: str | None = None


class RegenerateBody(BaseModel):
    session_id: str
    layer: str


class ExportBody(BaseModel):
    session_id: str
    picks: dict[str, int] = Field(default_factory=dict)


class ExportResponse(BaseModel):
    files: list[str]


class ExplainBody(BaseModel):
    brief: SongBrief
    prompts: list[LayerPrompt]
    trace: list[TraceStep]
    depth: str | None = None


class ExplainResponse(BaseModel):
    how: str
    steps: list[str]
    source: str


@dataclass
class SessionRecord:
    prompts: list[LayerPrompt]
    chords: list[str]
    bpm: int
    bars: int
    mood: str
    world: str
    key: str
    takes: dict[str, int] = field(default_factory=dict)
    results: dict[str, list[RenderResult]] = field(default_factory=dict)
    upload_path: str = ""
    audio_intent: str = ""
    noise: float = 0.5
    pinned: str = ""
    progression_locked: bool = False


def load_local_env() -> None:
    """Load the repo .env for local API startup. The agent itself reads os.environ only."""
    root = Path(__file__).resolve()
    env_path: Path | None = None
    for parent in root.parents:
        candidate = parent / ".env"
        if (parent / "docs" / "spec.md").is_file() and candidate.is_file():
            env_path = candidate
            break
    if env_path is None:
        return
    from dotenv import load_dotenv

    load_dotenv(env_path, override=False)


def create_app(data_root: Path | None = None) -> FastAPI:
    assert_frontend_clean()
    provider = os.environ.get("PROVIDER", "mock")
    renderer_name = os.environ.get("RENDERER", "mock")
    if provider not in {"mock", "bedrock"}:
        raise RuntimeError("PROVIDER must be mock or bedrock")
    if renderer_name not in {"mock", "stability_api"}:
        raise RuntimeError("RENDERER must be mock or stability_api")

    app = FastAPI(title="Vision Studio")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins(),
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.data_root = data_root or default_data_root()
    app.state.store = build_store(app.state.data_root / "objects")
    app.state.ip_limit = RateLimiter()
    app.state.session_limit = RateLimiter()
    register_default_handlers(register_handler)
    cleanup_old_sessions(app.state.data_root)

    @app.middleware("http")
    async def guard_request(request: Request, call_next):
        if content_too_large(request.headers.get("content-length"), BODY_LIMIT):
            return JSONResponse(status_code=413, content={"detail": "Upload limit is 50 MB"})
        if request.method == "POST" and request.url.path in _LIMITED:
            host = request.client.host if request.client else "unknown"
            if not request.app.state.ip_limit.allow(host):
                return JSONResponse(status_code=429, content={"detail": "Too many requests. Try again shortly."})
        try:
            attach_user(request, resolve_request_user(request))
        except HTTPException as error:
            return JSONResponse(status_code=error.status_code, content={"detail": error.detail})
        try:
            return await call_next(request)
        except (HTTPException, StarletteHTTPException):
            raise
        except Exception:
            logger.exception("request failed")
            return JSONResponse(status_code=500, content={"detail": "Something went wrong. Try again."})
    app.state.sessions = {}
    app.state.turns = {}
    app.state.uploads = {}
    app.state.debug = {}
    if renderer_name == "stability_api":
        app.state.renderer = StabilityAPIRenderer(app.state.data_root)
    else:
        app.state.renderer = MockRenderer(app.state.data_root)

    @app.post("/upload")
    async def upload(
        request: Request,
        session_id: str = Form(...),
        input_type: str = Form(...),
        file: UploadFile = File(...),
    ):
        try:
            check_session_id(session_id)
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        _limit_session(request, session_id)
        if input_type not in _INPUTS:
            raise HTTPException(400, "input_type is not recognised")
        payload = await _read_upload(file)
        try:
            kind = upload_kind(file.filename or "", payload)
        except ValueError as error:
            raise HTTPException(415, str(error)) from error
        if input_type == "midi" and kind != "mid":
            raise HTTPException(415, "Use a wav, mp3, m4a, aiff, webm, or mid file.")
        folder = session_dir(request.app.state.data_root, session_id) / "audio"
        folder.mkdir(parents=True, exist_ok=True)
        original = folder / stored_name(file.filename or "upload")
        original.write_bytes(payload)
        if kind == "mid":
            return AudioFeatures(input_type="midi", confidence=0.8)
        target = original
        try:
            if needs_conversion(kind):
                target = original.with_suffix(".wav")
                convert_to_wav(original, target)
            assert_short_enough(target)
        except ConversionError as error:
            original.unlink(missing_ok=True)
            if target != original:
                target.unlink(missing_ok=True)
            raise HTTPException(422, str(error)) from error
        features = analyse(target, input_type).model_copy(update={"path": str(target)})
        request.app.state.uploads[session_id] = {
            "file": original.name,
            "path": str(target),
            "features": features.model_dump(),
        }
        return features

    @app.post("/turn", response_model=TurnResponse)
    def turn(body: TurnRequest, request: Request) -> TurnResponse:
        try:
            check_session_id(body.session_id)
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        _limit_session(request, body.session_id)
        with _lock_for(body.session_id):
            seen: dict[str, TurnResponse] = request.app.state.turns.setdefault(body.session_id, {})
            if body.request_id and body.request_id in seen:
                return seen[body.request_id]
            response = run_turn(body)
            if body.request_id:
                seen[body.request_id] = response
            if response.status == "ready":
                request.app.state.sessions[body.session_id] = _record(response)
            return response

    @app.post("/render", response_model=None)
    def render(body: RenderBody, request: Request) -> list[RenderResult] | StreamingResponse:
        _limit_session(request, body.session_id)
        record, prompts = _prepare_render(request, body)
        renderer = request.app.state.renderer
        debug = request.app.state.debug.setdefault(body.session_id, {})
        debug["jobs"] = []
        if _wants_ndjson(request):
            return _ndjson(_stream_prompts(record, renderer, body.session_id, prompts, take=1, debug=debug))
        rendered: list[RenderResult] = []
        for prompt in prompts:
            jobs = _jobs(body.session_id, prompt, record, take=1, seeds=prompt.seeds)
            results = _render_jobs(renderer, jobs, record.chords)
            _note_debug(debug, renderer, jobs)
            record.takes[prompt.layer] = 1
            record.results[prompt.layer] = results
            rendered.extend(results)
        return rendered

    @app.post("/regenerate", response_model=None)
    def regenerate(body: RegenerateBody, request: Request) -> list[RenderResult] | StreamingResponse:
        record = _ready(request, body.session_id)
        if body.layer not in record.results:
            raise HTTPException(404, "That layer has not been rendered")
        prompt = next(item for item in record.prompts if item.layer == body.layer)
        take = record.takes[body.layer] + 1
        seeds = seeds_for(body.layer, record.mood, record.world, record.key, record.bpm, take)
        jobs = _jobs(body.session_id, prompt, record, take=take, seeds=seeds)
        renderer = request.app.state.renderer
        debug = request.app.state.debug.setdefault(body.session_id, {})
        if _wants_ndjson(request):
            return _ndjson(
                _stream_prompts(record, renderer, body.session_id, [prompt], take=take, seeds=seeds, debug=debug)
            )
        results = _render_jobs(renderer, jobs, record.chords)
        _note_debug(debug, renderer, jobs)
        record.takes[body.layer] = take
        record.results[body.layer] = results
        return results

    @app.post("/export", response_model=ExportResponse)
    def export(body: ExportBody, request: Request) -> ExportResponse:
        record = _ready(request, body.session_id)
        if not record.results:
            raise HTTPException(409, "Render the session before exporting")
        unknown = set(body.picks) - set(record.results)
        if unknown:
            raise HTTPException(400, "A pick names a layer that was not rendered")
        folder = session_dir(request.app.state.data_root, body.session_id)
        export_dir = folder / "export"
        export_dir.mkdir(parents=True, exist_ok=True)
        for old in export_dir.iterdir():
            if old.is_file():
                old.unlink()
        copied: list[str] = []
        for layer, results in record.results.items():
            variant = body.picks.get(layer, 1)
            match = next((item for item in results if item.variant == variant), None)
            if match is None:
                raise HTTPException(400, f"Variation {variant} is not available for {layer}")
            dest = export_dir / Path(match.path).name
            shutil.copy2(match.path, dest)
            copied.append(str(dest))
        midi_dir = folder / "midi"
        if midi_dir.is_dir():
            for source in sorted(midi_dir.glob("*.mid")):
                dest = export_dir / source.name
                shutil.copy2(source, dest)
                copied.append(str(dest))
        return ExportResponse(files=copied)

    @app.get("/genres")
    def genres() -> list[dict[str, str]]:
        return [{"id": genre.id, "title": genre.title} for genre in load_genres()]

    @app.get("/genres/{genre_id}")
    def genre(genre_id: str) -> dict[str, object]:
        try:
            found = next(item for item in load_genres() if item.id == genre_id)
        except StopIteration as error:
            raise HTTPException(404, "That genre is not in the files") from error
        complete = history_payload if os.environ.get("PROVIDER") == "bedrock" else None
        return {
            "id": found.id,
            "title": found.title,
            "tempo_range": found.tempo_range,
            "bpm": found.bpm,
            "keys": list(found.keys),
            "instruments": list(found.instruments),
            "drum_pattern": found.drum_pattern,
            "production": found.production,
            "references": [{"artist": item.artist, "tracks": list(item.tracks)} for item in found.references],
            "history": present_history(found, complete),
            "prefill": reference_values(found),
        }

    @app.post("/explain", response_model=ExplainResponse)
    def explain(body: ExplainBody) -> ExplainResponse:
        complete = explain_payload if os.environ.get("PROVIDER") == "bedrock" else None
        result = explain_result(body.brief, body.prompts, body.trace, complete, depth=body.depth)
        return ExplainResponse(how=result.how, steps=list(result.steps), source=result.source)

    @app.get("/files/{session_id}/{file_path:path}", response_model=None)
    def files(session_id: str, file_path: str, request: Request) -> FileResponse | RedirectResponse:
        try:
            root = session_dir(request.app.state.data_root, session_id).resolve()
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        if file_path.startswith(("/", "\\")) or "\x00" in file_path or ".." in Path(file_path).parts:
            raise HTTPException(404, "File not found")
        target = (root / file_path).resolve()
        if target.is_relative_to(root) and target.is_file():
            return FileResponse(target)
        key = session_object_key(session_id, file_path)
        store = request.app.state.store
        if not store.exists(key):
            raise HTTPException(404, "File not found")
        local = store.local_path(key)
        if local is not None:
            return FileResponse(local)
        return RedirectResponse(store.signed_url(key), status_code=307)

    @app.get("/objects/{object_key:path}", response_model=None)
    def objects(object_key: str, request: Request) -> FileResponse | RedirectResponse:
        if object_key.startswith(("/", "\\")) or "\x00" in object_key or ".." in Path(object_key).parts:
            raise HTTPException(404, "File not found")
        store = request.app.state.store
        if not store.exists(object_key):
            raise HTTPException(404, "File not found")
        local = store.local_path(object_key)
        if local is not None:
            return FileResponse(local)
        return RedirectResponse(store.signed_url(object_key), status_code=307)

    @app.get("/me")
    def me(request: Request) -> dict[str, object]:
        user = getattr(request.state, "user", None)
        if user is None:
            return {"user": None}
        limits = plan_for(user.plan)
        return {
            "user": {"id": user.id, "email": user.email, "plan": user.plan},
            "limits": {
                "renders_per_day": limits.renders_per_day,
                "turns_per_day": limits.turns_per_day,
                "analyse_per_day": limits.analyse_per_day,
            },
        }

    @app.post("/jobs")
    def start_job(body: dict[str, object], request: Request) -> dict[str, object]:
        kind = str(body.get("kind") or "")
        if kind not in {"render", "analyse", "train_reference", "train_grade"}:
            raise HTTPException(400, "Unknown job kind")
        payload = body.get("payload")
        if not isinstance(payload, dict):
            payload = {}
        user = getattr(request.state, "user", None)
        user_id = getattr(request.state, "user_id", None)
        assert_within_quota(user_id, kind, getattr(user, "plan", None) if user else "free")
        job = create_job(kind, payload, user_id=user_id)
        enqueue(job)
        cents = record_job_usage(user_id, kind, job_id=job.id)
        found = get_job(job.id)
        assert found is not None
        public = job_public(found)
        public["cost_cents"] = cents
        return public

    @app.get("/jobs/{job_id}")
    def job_status(job_id: str) -> dict[str, object]:
        found = get_job(job_id)
        if found is None:
            raise HTTPException(404, "Job not found")
        return job_public(found)

    @app.get("/debug/{session_id}")
    def debug(session_id: str, request: Request) -> dict[str, object]:
        try:
            check_session_id(session_id)
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        payload = request.app.state.debug.get(session_id, {})
        return {
            "upload": request.app.state.uploads.get(session_id),
            "jobs": payload.get("jobs", []),
            "payload": payload.get("payload", {}),
            "notes": payload.get("notes", []),
        }

    register_train(app)
    register_account(app)
    return app


def _limit_session(request: Request, session_id: str) -> None:
    if not request.app.state.session_limit.allow(session_id):
        raise HTTPException(429, "Too many requests. Try again shortly.")


def _lock_for(session_id: str) -> threading.Lock:
    with _locks_guard:
        lock = _session_locks.get(session_id)
        if lock is None:
            lock = threading.Lock()
            _session_locks[session_id] = lock
        return lock


def _record(response: TurnResponse) -> SessionRecord:
    if not response.prompts or response.progression is None:
        raise HTTPException(409, "The brief is not ready to render")
    slots = response.brief.slots
    bpm, bars = timing_from_brief(response.brief, response.prompts[0].prompt)
    record = SessionRecord(
        prompts=list(response.prompts),
        chords=list(response.progression.chords),
        bpm=bpm,
        bars=bars,
        mood=slots.mood.value if slots.mood is not None else "peaceful",
        world=slots.world.value if slots.world is not None else "warm and intimate",
        key=slots.key.value if slots.key is not None else "C major",
        audio_intent=response.brief.audio_intent or "",
        noise=response.brief.noise if response.brief.noise is not None else 0.5,
        progression_locked=slots.progression is not None and slots.progression.source == "you",
    )
    _complete_record(record)
    return record


def _complete_record(record: SessionRecord) -> None:
    if record.bpm <= 0:
        record.bpm = 96
    if record.bars <= 0:
        record.bars = 8
    if not record.mood:
        record.mood = "peaceful"
    if not record.world:
        record.world = "warm and intimate"
    if not record.key:
        record.key = "C major"


def _apply_prompt_text(prompts: list[LayerPrompt], edits: list[PromptText]) -> list[LayerPrompt]:
    by_layer = {item.layer: item for item in edits}
    updated: list[LayerPrompt] = []
    for prompt in prompts:
        edit = by_layer.get(prompt.layer)
        if edit is None:
            updated.append(prompt)
            continue
        updated.append(prompt.model_copy(update={"prompt": edit.prompt, "negative": edit.negative}))
    return updated


def _ready(request: Request, session_id: str) -> SessionRecord:
    try:
        check_session_id(session_id)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    record = request.app.state.sessions.get(session_id)
    if record is None:
        raise HTTPException(404, "No ready brief for this session")
    return record


def _jobs(
    session_id: str,
    prompt: LayerPrompt,
    record: SessionRecord,
    *,
    take: int,
    seeds: tuple[float, float, float],
) -> list[RenderJob]:
    init_audio, noise = _audio_for(record, prompt.layer)
    return [
        RenderJob(
            session_id=session_id,
            layer=prompt.layer,
            prompt=prompt.prompt,
            negative=prompt.negative,
            bpm=record.bpm,
            bars=record.bars,
            seed=int(seed),
            variant=variant,
            take=take,
            init_audio=init_audio,
            noise=noise,
        )
        for variant, seed in enumerate(seeds, start=1)
    ]


def _audio_for(record: SessionRecord, layer: str) -> tuple[str | None, float | None]:
    if base_layer(layer) == "chords" and record.pinned:
        return record.pinned, None
    if record.audio_intent in {"transform", "extend"} and record.upload_path:
        noise = record.noise if record.audio_intent == "transform" else None
        return record.upload_path, noise
    return None, None


def _render_jobs(renderer: Renderer, jobs: list[RenderJob], chords: list[str]) -> list[RenderResult]:
    return [renderer.render(job, chords) for job in jobs]


def _note_debug(debug: dict[str, object], renderer: Renderer, jobs: list[RenderJob]) -> None:
    listed = debug.setdefault("jobs", [])
    if isinstance(listed, list):
        listed.extend(_job_view(job) for job in jobs)
    payload = getattr(renderer, "last_payload", None)
    if payload:
        debug["payload"] = payload
    debug["notes"] = list(getattr(renderer, "notes", []))


def _job_view(job: RenderJob) -> dict[str, object]:
    return {
        "layer": job.layer,
        "prompt": job.prompt,
        "negative": job.negative,
        "bpm": job.bpm,
        "bars": job.bars,
        "seed": job.seed,
        "init_audio": job.init_audio,
        "noise": job.noise,
    }


def _prepare_render(request: Request, body: RenderBody) -> tuple[SessionRecord, list[LayerPrompt]]:
    record = _ready(request, body.session_id)
    _complete_record(record)
    if body.prompts:
        record.prompts = _apply_prompt_text(record.prompts, body.prompts)
    prompts = _prompts_for(record, body.layer)
    _attach_audio(request, body.session_id, record)
    _write_midi(request.app.state.data_root, body.session_id, record)
    return record, prompts


def _attach_audio(request: Request, session_id: str, record: SessionRecord) -> None:
    uploaded = request.app.state.uploads.get(session_id)
    if uploaded and not record.upload_path:
        record.upload_path = str(uploaded["path"])
    if record.progression_locked and not record.pinned and record.chords:
        if parse_chords(", ".join(record.chords)):
            record.pinned = pin_chord_audio(
                request.app.state.data_root,
                session_id,
                record.chords,
                record.bpm,
                record.bars,
            )


def _prompts_for(record: SessionRecord, layer: str | None) -> list[LayerPrompt]:
    if layer is None:
        return list(record.prompts)
    selected = [item for item in record.prompts if item.layer == layer]
    if not selected:
        raise HTTPException(404, "That layer is not in this brief")
    return selected


def _wants_ndjson(request: Request) -> bool:
    return "application/x-ndjson" in request.headers.get("accept", "")


def _ndjson(chunks: AsyncIterator[bytes]) -> StreamingResponse:
    return StreamingResponse(
        chunks,
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _line(payload: dict[str, object]) -> bytes:
    return (json.dumps(payload, separators=(",", ":")) + "\n").encode()


async def _stream_prompts(
    record: SessionRecord,
    renderer: Renderer,
    session_id: str,
    prompts: list[LayerPrompt],
    *,
    take: int,
    seeds: tuple[float, float, float] | None = None,
    debug: dict[str, object] | None = None,
) -> AsyncIterator[bytes]:
    for prompt in prompts:
        layer_seeds = prompt.seeds if seeds is None else seeds
        jobs = _jobs(session_id, prompt, record, take=take, seeds=layer_seeds)
        async for line in _stream_jobs(record, renderer, jobs, record.chords, take):
            yield line
        if debug is not None:
            _note_debug(debug, renderer, jobs)
    yield _line({"kind": "done"})


async def _stream_jobs(
    record: SessionRecord,
    renderer: Renderer,
    jobs: list[RenderJob],
    chords: list[str],
    take: int,
) -> AsyncIterator[bytes]:
    if not jobs:
        return
    layer = jobs[0].layer
    results: list[RenderResult] = []
    total = len(jobs)
    try:
        for job in jobs:
            yield _line(
                {"kind": "progress", "layer": layer, "take": take, "variant": job.variant, "total": total}
            )
            results.append(await asyncio.to_thread(renderer.render, job, chords))
    except Exception:
        yield _line({"kind": "error", "layer": layer, "message": _LAYER_ERROR})
        return
    record.takes[layer] = take
    record.results[layer] = results
    yield _line(
        {
            "kind": "layer",
            "take": take,
            "results": [item.model_dump(exclude_none=True) for item in results],
        }
    )


def _write_midi(data_root: Path, session_id: str, record: SessionRecord) -> None:
    folder = session_dir(data_root, session_id) / "midi"
    folder.mkdir(parents=True, exist_ok=True)
    files = {
        "chords": chords_midi(record.chords, bpm=record.bpm, bars=record.bars),
        "bass": bass_midi(record.chords, bpm=record.bpm, bars=record.bars),
    }
    for kind, payload in files.items():
        (folder / midi_name(kind, record.bpm, record.bars)).write_bytes(payload)


async def _read_upload(file: UploadFile) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        block = await file.read(1024 * 1024)
        if not block:
            break
        total += len(block)
        if total > UPLOAD_LIMIT:
            raise HTTPException(413, "Upload limit is 50 MB")
        chunks.append(block)
    if total == 0:
        raise HTTPException(400, "The upload was empty")
    return b"".join(chunks)


if "pytest" not in sys.modules:
    load_local_env()
app = create_app()
