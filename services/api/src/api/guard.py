"""Request limits, session expiry, and a boot check for frontend secrets."""

from __future__ import annotations

import logging
import os
import re
import shutil
import threading
import time
from pathlib import Path

logger = logging.getLogger("api")

BODY_LIMIT = 52 * 1024 * 1024
SESSION_MAX_AGE_DAYS = 7
_RATE_LIMIT = 60
_RATE_WINDOW = 60.0
_SECRET_NAMES = (
    "STABILITY_API_KEY",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_ACCESS_KEY_ID",
    "SOUNDCHARTS_API_KEY",
    "SOUNDCHARTS_TOKEN",
    "FAL_KEY",
    "FAL_API_KEY",
)
_BANNED = re.compile(
    r"STABILITY_API_KEY|AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID|SOUNDCHARTS_API_KEY|SOUNDCHARTS_TOKEN|FAL_KEY|FAL_API_KEY"
)
_VITE_SECRET = re.compile(r"import\.meta\.env\.VITE_(?!API_URL\b)[A-Za-z0-9_]+")
_TEXT = {".js", ".mjs", ".cjs", ".ts", ".tsx", ".css", ".html", ".json", ".map"}


class RateLimiter:
    def __init__(self, limit: int = _RATE_LIMIT, window: float = _RATE_WINDOW) -> None:
        self.limit = limit
        self.window = window
        self._hits: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            recent = [stamp for stamp in self._hits.get(key, []) if now - stamp < self.window]
            if len(recent) >= self.limit:
                self._hits[key] = recent
                return False
            recent.append(now)
            self._hits[key] = recent
            return True


def content_too_large(header: str | None, limit: int = BODY_LIMIT) -> bool:
    if header is None or not header.isdigit():
        return False
    return int(header) > limit


def allowed_origins() -> list[str]:
    raw = os.environ.get("FRONTEND_ORIGIN", "http://127.0.0.1:5173,http://localhost:5173")
    return [item.strip() for item in raw.split(",") if item.strip()]


def cleanup_old_sessions(data_root: Path, max_age_days: int = SESSION_MAX_AGE_DAYS) -> int:
    root = data_root / "sessions"
    if not root.is_dir():
        return 0
    cutoff = time.time() - max_age_days * 86400
    removed = 0
    for child in root.iterdir():
        if not child.is_dir():
            continue
        try:
            stale = child.stat().st_mtime < cutoff
        except OSError:
            continue
        if not stale:
            continue
        shutil.rmtree(child, ignore_errors=True)
        removed += 1
        logger.info("removed session folder older than %s days", max_age_days)
    return removed


def repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def assert_frontend_clean(root: Path | None = None) -> None:
    """Refuse to boot when a secret name or value is in the web app or its bundle."""
    base = root or repo_root()
    folders = [base / "apps" / "web" / "src"]
    dist = base / "apps" / "web" / "dist"
    if dist.is_dir():
        folders.append(dist)
    values = [os.environ.get(name, "").strip() for name in _SECRET_NAMES]
    values = [value for value in values if len(value) >= 20]
    for folder in folders:
        if not folder.is_dir():
            continue
        for path in folder.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in _TEXT:
                continue
            if "node_modules" in path.parts:
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            if _BANNED.search(text) or _VITE_SECRET.search(text) or any(value in text for value in values):
                logger.error("secret material in frontend file %s", path)
                raise RuntimeError("Refusing to boot: a secret appears in the frontend bundle")
