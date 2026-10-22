"""Train routes. The reference lives on disk. The page never sees a DAW session."""

from __future__ import annotations

import json
import logging
import os
import secrets
import uuid
from pathlib import Path

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from agent.compare import compare_midi
from agent.exercises import describe, exercise_from_data, exercise_to_dict, find_template, vary
from agent.train_feedback import feedback_payload, write_feedback
from api.audio import (
    UPLOAD_LIMIT,
    ConversionError,
    assert_short_enough,
    check_session_id,
    convert_to_wav,
    needs_conversion,
    stored_name,
    upload_kind,
)
from api.train_audio import compare_audio, read_wav
from api.train_render import render_reference

logger = logging.getLogger("api")
_FILES = {"reference.wav", "clean.wav", "reference.mid"}


class StartBody(BaseModel):
    category: str
    type: str
    level: str
    seed: int | None = None


def register_train(app: FastAPI) -> None:
    @app.post("/train/exercise")
    def start(body: StartBody, request: Request) -> dict[str, object]:
        _limit(request)
        try:
            template = find_template(body.category, body.type, body.level)
        except KeyError as error:
            raise HTTPException(400, "Choose a rhythm or harmony exercise.") from error
        seed = secrets.randbelow(10_000) if body.seed is None else body.seed
        exercise = vary(template, seed)
        exercise_id = str(uuid.uuid4())
        folder = _folder(request.app.state.data_root, exercise_id)
        try:
            note = render_reference(exercise, folder)
        except Exception as error:
            logger.exception("exercise render failed")
            raise HTTPException(500, "The exercise did not render. Try again.") from error
        stored = {
            "id": exercise_id,
            "template_id": template.id,
            "seed": seed,
            "revealed": False,
            "note": note,
            "exercise": exercise_to_dict(exercise),
        }
        _write(folder, stored)
        return _public(stored)

    @app.post("/train/exercise/{exercise_id}/reveal")
    def reveal(exercise_id: str, request: Request) -> dict[str, object]:
        stored = _read(request, exercise_id)
        stored["revealed"] = True
        _write(_folder(request.app.state.data_root, exercise_id), stored)
        exercise = exercise_from_data(stored["exercise"])
        payload = _public(stored)
        payload["midi"] = "reference.mid"
        payload["built"] = describe(exercise)
        return payload

    @app.post("/train/exercise/{exercise_id}/submit")
    async def submit(
        exercise_id: str,
        request: Request,
        file: UploadFile = File(...),
        mapping: str | None = Form(default=None),
    ) -> dict[str, object]:
        _limit(request)
        stored = _read(request, exercise_id)
        exercise = exercise_from_data(stored["exercise"])
        payload = await _read_upload(file)
        try:
            kind = upload_kind(file.filename or "", payload)
        except ValueError as error:
            raise HTTPException(415, str(error)) from error
        try:
            drum_map = _mapping(mapping)
        except ValueError as error:
            raise HTTPException(400, "The drum mapping could not be read.") from error
        if kind == "mid":
            try:
                result = compare_midi(exercise, payload, drum_map)
            except ValueError as error:
                raise HTTPException(400, "That MIDI file could not be read.") from error
        else:
            try:
                audio = _audio(request.app.state.data_root, exercise_id, file.filename or "upload", payload, kind)
                result = compare_audio(exercise, audio)
            except (ValueError, ConversionError) as error:
                raise HTTPException(400, "That audio could not be read.") from error
        if result.get("status") == "needs_mapping":
            return {"status": "needs_mapping", "notes": result["notes"]}
        complete = feedback_payload if os.environ.get("PROVIDER") == "bedrock" else None
        feedback = write_feedback(result, exercise, complete)
        return {"status": "compared", "result": result, "feedback": feedback}

    @app.get("/train/files/{exercise_id}/{name}")
    def train_file(exercise_id: str, name: str, request: Request) -> FileResponse:
        if name not in _FILES:
            raise HTTPException(404, "File not found")
        stored = _read(request, exercise_id)
        if name == "reference.mid" and not stored.get("revealed"):
            raise HTTPException(404, "File not found")
        target = _folder(request.app.state.data_root, exercise_id) / name
        if not target.is_file():
            raise HTTPException(404, "File not found")
        return FileResponse(target)


def _public(stored: dict[str, object]) -> dict[str, object]:
    exercise = exercise_from_data(stored["exercise"])
    return {
        "id": stored["id"],
        "template_id": stored["template_id"],
        "category": exercise.category,
        "type": exercise.type,
        "type_label": exercise.type_label,
        "level": exercise.level,
        "tempo": exercise.tempo,
        "bars": exercise.bars,
        "key": exercise.key,
        "objective": exercise.objective,
        "instructions": exercise.instructions,
        "audio": "reference.wav",
        "note": stored["note"],
    }


def _folder(data_root: Path, exercise_id: str) -> Path:
    check_session_id(exercise_id)
    root = (data_root / "exercises").resolve()
    path = (root / exercise_id).resolve()
    if not path.is_relative_to(root):
        raise HTTPException(400, "session_id must be a UUID")
    return path


def _read(request: Request, exercise_id: str) -> dict[str, object]:
    try:
        folder = _folder(request.app.state.data_root, exercise_id)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    path = folder / "exercise.json"
    if not path.is_file():
        raise HTTPException(404, "That exercise is not on this server.")
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise HTTPException(404, "That exercise is not on this server.")
    return data


def _write(folder: Path, stored: dict[str, object]) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "exercise.json").write_text(json.dumps(stored), encoding="utf-8")


def _mapping(raw: str | None) -> dict[int, str] | None:
    if raw is None or raw == "":
        return None
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError("mapping")
    mapped: dict[int, str] = {}
    for key, value in parsed.items():
        mapped[int(key)] = str(value)
    return mapped


def _audio(data_root: Path, exercise_id: str, filename: str, payload: bytes, kind: str) -> np.ndarray:
    folder = _folder(data_root, exercise_id)
    original = folder / stored_name(filename)
    original.write_bytes(payload)
    target = original
    try:
        if needs_conversion(kind):
            target = original.with_suffix(".wav")
            convert_to_wav(original, target)
        assert_short_enough(target)
        return read_wav(target)
    finally:
        original.unlink(missing_ok=True)
        if target != original:
            target.unlink(missing_ok=True)


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


def _limit(request: Request) -> None:
    host = request.client.host if request.client else "unknown"
    if not request.app.state.ip_limit.allow(host):
        raise HTTPException(429, "Too many requests. Try again shortly.")
