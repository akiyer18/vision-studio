"""Vision Studio API."""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import sys
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from pathlib import Path

from agent.bedrock import explain_payload, history_payload
from agent.explain import explain_result
from agent.genres import load_genres, present_history, reference_values
from agent.prompts import seeds_for
from agent.theory import bass_midi, chords_midi
from agent.turn import run_turn
from contracts import AudioFeatures, LayerPrompt, RenderJob, RenderResult, SongBrief, TraceStep, TurnRequest, TurnResponse
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from api.audio import (
    UPLOAD_LIMIT,
    ConversionError,
    analyse,
    check_session_id,
    convert_to_wav,
    default_data_root,
    midi_name,
    needs_conversion,
    safe_filename,
    session_dir,
)
from api.renderer import MockRenderer, Renderer

_WEB = ["http://localhost:5173", "http://127.0.0.1:5173"]
_INPUTS = {"text_only", "hum", "vocal", "instrument_loop", "drum_loop", "full_track", "midi"}
_BARS = re.compile(r"(\d+)")
_BPM = re.compile(r"(\d+)\s+BPM")
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
    provider = os.environ.get("PROVIDER", "mock")
    renderer_name = os.environ.get("RENDERER", "mock")
    if provider not in {"mock", "bedrock"}:
        raise RuntimeError("PROVIDER must be mock or bedrock")
    if renderer_name != "mock":
        raise RuntimeError("RENDERER must be mock until another renderer exists")

    app = FastAPI(title="Vision Studio")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_WEB,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.data_root = data_root or default_data_root()
    app.state.sessions = {}
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
        if input_type not in _INPUTS:
            raise HTTPException(400, "input_type is not recognised")
        payload = await _read_upload(file)
        folder = session_dir(request.app.state.data_root, session_id) / "audio"
        folder.mkdir(parents=True, exist_ok=True)
        original = folder / safe_filename(file.filename or "upload")
        original.write_bytes(payload)
        if input_type == "midi" or original.suffix.lower() in {".mid", ".midi"}:
            return AudioFeatures(input_type="midi", confidence=0.8)
        target = original
        if needs_conversion(original.name, file.content_type):
            target = original.with_suffix(".wav")
            try:
                convert_to_wav(original, target)
            except ConversionError as error:
                raise HTTPException(422, str(error)) from error
        return analyse(target, input_type)

    @app.post("/turn", response_model=TurnResponse)
    def turn(body: TurnRequest, request: Request) -> TurnResponse:
        response = run_turn(body)
        if response.status == "ready":
            request.app.state.sessions[body.session_id] = _record(response)
        return response

    @app.post("/render", response_model=None)
    def render(body: RenderBody, request: Request) -> list[RenderResult] | StreamingResponse:
        record, prompts = _prepare_render(request, body)
        renderer = request.app.state.renderer
        if _wants_ndjson(request):
            return _ndjson(_stream_prompts(record, renderer, body.session_id, prompts, take=1))
        rendered: list[RenderResult] = []
        for prompt in prompts:
            jobs = _jobs(body.session_id, prompt, record, take=1, seeds=prompt.seeds)
            results = _render_jobs(renderer, jobs, record.chords)
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
        if _wants_ndjson(request):
            return _ndjson(_stream_prompts(record, renderer, body.session_id, [prompt], take=take, seeds=seeds))
        results = _render_jobs(renderer, jobs, record.chords)
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
        result = explain_result(body.brief, body.prompts, body.trace, complete)
        return ExplainResponse(how=result.how, steps=list(result.steps), source=result.source)

    @app.get("/files/{session_id}/{file_path:path}")
    def files(session_id: str, file_path: str, request: Request) -> FileResponse:
        try:
            root = session_dir(request.app.state.data_root, session_id).resolve()
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        target = (root / file_path).resolve()
        if not target.is_relative_to(root) or not target.is_file():
            raise HTTPException(404, "File not found")
        return FileResponse(target)

    return app


def _record(response: TurnResponse) -> SessionRecord:
    if not response.prompts or response.progression is None:
        raise HTTPException(409, "The brief is not ready to render")
    slots = response.brief.slots
    if slots.mood is None or slots.world is None or slots.key is None:
        raise HTTPException(409, "The brief is missing mood, world, or key")
    structure = slots.structure.value if slots.structure is not None else "8 bars"
    bars_match = _BARS.search(structure)
    bpm_match = _BPM.search(response.prompts[0].prompt)
    if bars_match is None or bpm_match is None:
        raise HTTPException(409, "The brief has no bar count or tempo")
    return SessionRecord(
        prompts=list(response.prompts),
        chords=list(response.progression.chords),
        bpm=int(bpm_match.group(1)),
        bars=int(bars_match.group(1)),
        mood=slots.mood.value,
        world=slots.world.value,
        key=slots.key.value,
    )


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
        )
        for variant, seed in enumerate(seeds, start=1)
    ]


def _render_jobs(renderer: Renderer, jobs: list[RenderJob], chords: list[str]) -> list[RenderResult]:
    return [renderer.render(job, chords) for job in jobs]


def _prepare_render(request: Request, body: RenderBody) -> tuple[SessionRecord, list[LayerPrompt]]:
    record = _ready(request, body.session_id)
    if body.prompts:
        record.prompts = _apply_prompt_text(record.prompts, body.prompts)
    prompts = _prompts_for(record, body.layer)
    _write_midi(request.app.state.data_root, body.session_id, record)
    return record, prompts


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
) -> AsyncIterator[bytes]:
    for prompt in prompts:
        layer_seeds = prompt.seeds if seeds is None else seeds
        jobs = _jobs(session_id, prompt, record, take=take, seeds=layer_seeds)
        async for line in _stream_jobs(record, renderer, jobs, record.chords, take):
            yield line
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
