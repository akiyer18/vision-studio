"""Local filesystem and S3-compatible object storage."""

from __future__ import annotations

import os
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol
from urllib.parse import quote


class ObjectStore(Protocol):
    def put_bytes(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> str: ...

    def put_file(self, key: str, path: Path, content_type: str = "application/octet-stream") -> str: ...

    def get_bytes(self, key: str) -> bytes: ...

    def exists(self, key: str) -> bool: ...

    def signed_url(self, key: str, expires_in: int = 3600) -> str: ...

    def local_path(self, key: str) -> Path | None: ...


@dataclass
class LocalStore:
    root: Path

    def _path(self, key: str) -> Path:
        clean = key.lstrip("/").replace("..", "")
        path = (self.root / clean).resolve()
        if not str(path).startswith(str(self.root.resolve())):
            raise ValueError("object key escapes the store root")
        return path

    def put_bytes(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return key

    def put_file(self, key: str, path: Path, content_type: str = "application/octet-stream") -> str:
        target = self._path(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
        return key

    def get_bytes(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()

    def signed_url(self, key: str, expires_in: int = 3600) -> str:
        del expires_in
        return f"/files/{quote(key, safe='/')}"

    def local_path(self, key: str) -> Path | None:
        path = self._path(key)
        return path if path.is_file() else None


@dataclass
class S3Store:
    bucket: str
    endpoint_url: str | None
    access_key: str
    secret_key: str
    region: str = "auto"
    public_base: str | None = None

    def _client(self):
        import boto3

        return boto3.client(
            "s3",
            endpoint_url=self.endpoint_url or None,
            aws_access_key_id=self.access_key,
            aws_secret_access_key=self.secret_key,
            region_name=self.region,
        )

    def put_bytes(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
        self._client().put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)
        return key

    def put_file(self, key: str, path: Path, content_type: str = "application/octet-stream") -> str:
        self._client().upload_file(str(path), self.bucket, key, ExtraArgs={"ContentType": content_type})
        return key

    def get_bytes(self, key: str) -> bytes:
        response = self._client().get_object(Bucket=self.bucket, Key=key)
        return response["Body"].read()

    def exists(self, key: str) -> bool:
        try:
            self._client().head_object(Bucket=self.bucket, Key=key)
            return True
        except Exception:
            return False

    def signed_url(self, key: str, expires_in: int = 3600) -> str:
        return self._client().generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": key},
            ExpiresIn=expires_in,
        )

    def local_path(self, key: str) -> Path | None:
        del key
        return None


def storage_mode() -> str:
    return (os.environ.get("STORAGE") or "local").strip().lower()


def build_store(data_root: Path | None = None) -> ObjectStore:
    mode = storage_mode()
    if mode in {"s3", "r2", "minio"}:
        bucket = os.environ.get("S3_BUCKET") or "vision-studio"
        access = os.environ.get("S3_ACCESS_KEY_ID") or ""
        secret = os.environ.get("S3_SECRET_ACCESS_KEY") or ""
        if not access or not secret:
            raise RuntimeError("S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required when STORAGE=s3")
        return S3Store(
            bucket=bucket,
            endpoint_url=os.environ.get("S3_ENDPOINT_URL") or None,
            access_key=access,
            secret_key=secret,
            region=os.environ.get("S3_REGION") or "auto",
            public_base=os.environ.get("S3_PUBLIC_BASE") or None,
        )
    root = data_root or Path(__file__).resolve().parents[4] / "data" / "objects"
    root.mkdir(parents=True, exist_ok=True)
    return LocalStore(root=root)


def session_object_key(session_id: str, relative: str) -> str:
    return f"sessions/{session_id}/{relative.lstrip('/')}"


def content_type_for(path: Path | str) -> str:
    name = str(path).lower()
    if name.endswith(".wav"):
        return "audio/wav"
    if name.endswith(".mid") or name.endswith(".midi"):
        return "audio/midi"
    if name.endswith(".mp3"):
        return "audio/mpeg"
    if name.endswith(".json"):
        return "application/json"
    return "application/octet-stream"
