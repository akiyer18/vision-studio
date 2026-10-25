"""Clerk JWT verification and optional user provisioning."""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Any

import jwt
from fastapi import HTTPException, Request


@dataclass
class AuthUser:
    id: str
    email: str
    plan: str = "free"


_jwks_cache: dict[str, Any] | None = None
_jwks_fetched_at = 0.0


def auth_required() -> bool:
    return (os.environ.get("AUTH_REQUIRED") or "0").strip() in {"1", "true", "yes"}


def clerk_configured() -> bool:
    return bool(os.environ.get("CLERK_JWKS_URL") or os.environ.get("AUTH_TEST_SECRET"))


def current_user(request: Request) -> AuthUser | None:
    return getattr(request.state, "user", None)


def attach_user(request: Request, user: AuthUser | None) -> None:
    request.state.user = user
    request.state.user_id = user.id if user else None


def extract_bearer(request: Request) -> str | None:
    header = request.headers.get("authorization") or request.headers.get("Authorization")
    if not header:
        return None
    kind, _, token = header.partition(" ")
    if kind.lower() != "bearer" or not token:
        return None
    return token.strip()


def verify_token(token: str) -> AuthUser:
    test_secret = os.environ.get("AUTH_TEST_SECRET")
    if test_secret:
        payload = jwt.decode(token, test_secret, algorithms=["HS256"], options={"require": ["sub"]})
        return AuthUser(
            id=str(payload["sub"]),
            email=str(payload.get("email") or f"{payload['sub']}@users.local"),
            plan=str(payload.get("plan") or "free"),
        )

    jwks_url = os.environ.get("CLERK_JWKS_URL")
    if not jwks_url:
        raise HTTPException(401, "Sign in is not configured")

    header = jwt.get_unverified_header(token)
    kid = header.get("kid")
    key = _jwk_for(kid, jwks_url)
    payload = jwt.decode(
        token,
        key=key,
        algorithms=["RS256"],
        options={"require": ["sub", "exp"]},
    )
    email = payload.get("email") or payload.get("primary_email_address") or f"{payload['sub']}@users.clerk"
    return AuthUser(id=str(payload["sub"]), email=str(email), plan="free")


def ensure_user_row(user: AuthUser) -> AuthUser:
    if not os.environ.get("DATABASE_URL"):
        return user
    try:
        from api.db.engine import session_scope
        from api.db.repo import Repository

        with session_scope() as session:
            row = Repository(session).upsert_user(user.id, user.email, plan=user.plan)
            return AuthUser(id=row.id, email=row.email, plan=row.plan)
    except Exception:
        return user


def resolve_request_user(request: Request) -> AuthUser | None:
    token = extract_bearer(request)
    if token is None:
        if auth_required():
            raise HTTPException(401, "Sign in to continue")
        return None
    user = verify_token(token)
    return ensure_user_row(user)


def _jwk_for(kid: str | None, jwks_url: str) -> Any:
    global _jwks_cache, _jwks_fetched_at
    now = time.time()
    if _jwks_cache is None or now - _jwks_fetched_at > 3600:
        import urllib.request

        with urllib.request.urlopen(jwks_url, timeout=5) as response:  # noqa: S310 — Clerk JWKS URL from env
            import json

            _jwks_cache = json.load(response)
            _jwks_fetched_at = now
    assert _jwks_cache is not None
    for item in _jwks_cache.get("keys", []):
        if kid is None or item.get("kid") == kid:
            return jwt.algorithms.RSAAlgorithm.from_jwk(item)
    raise HTTPException(401, "Sign in token is not valid")
