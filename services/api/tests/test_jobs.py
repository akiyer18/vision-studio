"""Job queue tests (inline mode)."""

from __future__ import annotations

from pathlib import Path

from api.job_handlers import register_default_handlers
from api.jobs import create_job, enqueue, get_job, queue_mode, register_handler, reset_jobs
from api.main import create_app
from fastapi.testclient import TestClient


def setup_function() -> None:
    reset_jobs()
    register_default_handlers(register_handler)


def test_inline_render_job_reaches_done() -> None:
    assert queue_mode() in {"inline", "redis"}
    job = create_job("render", {"session_id": "11111111-1111-4111-8111-111111111111", "layers": ["drums"]})
    done = enqueue(job)
    assert done.status == "done"
    assert done.progress == 100
    assert done.result["ok"] is True


def test_job_endpoints_report_progress(tmp_path: Path) -> None:
    with TestClient(create_app(tmp_path / "data")) as client:
        created = client.post("/jobs", json={"kind": "analyse", "payload": {"source_key": "a.wav"}})
        assert created.status_code == 200
        body = created.json()
        assert body["status"] in {"done", "running", "queued"}
        status = client.get(f"/jobs/{body['id']}")
        assert status.status_code == 200
        assert status.json()["id"] == body["id"]
        assert get_job(body["id"]) is not None
