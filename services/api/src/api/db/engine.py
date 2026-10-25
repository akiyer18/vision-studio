"""Database engine helpers. DATABASE_URL is optional; tests use SQLite."""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

_engine: Engine | None = None
_factory: sessionmaker[Session] | None = None


def database_url() -> str | None:
    return os.environ.get("DATABASE_URL") or None


def get_engine(url: str | None = None) -> Engine:
    global _engine, _factory
    target = url or database_url()
    if target is None:
        raise RuntimeError("DATABASE_URL is not set")
    if _engine is None or url is not None:
        connect_args = {"check_same_thread": False} if target.startswith("sqlite") else {}
        engine = create_engine(target, future=True, connect_args=connect_args)
        if url is None:
            _engine = engine
            _factory = sessionmaker(bind=engine, expire_on_commit=False, future=True)
            return _engine
        return engine
    return _engine


def get_session_factory(url: str | None = None) -> sessionmaker[Session]:
    global _factory
    if url is not None:
        return sessionmaker(bind=get_engine(url), expire_on_commit=False, future=True)
    if _factory is None:
        get_engine()
    assert _factory is not None
    return _factory


def reset_engine() -> None:
    global _engine, _factory
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _factory = None


@contextmanager
def session_scope(url: str | None = None) -> Iterator[Session]:
    factory = get_session_factory(url)
    session = factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
