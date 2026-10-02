"""Server-side Nexus Backup vault connector.

This adapter is deliberately limited to S3-compatible destination readiness.
It holds encrypted connection credentials in the Nexus secret store, performs
read-only bucket checks, and returns only safe verification evidence.  It does
not accept backup bytes, issue presigned URLs, or expose a bucket, endpoint,
or credential to the browser.
"""

from __future__ import annotations

import asyncio
import hashlib
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlparse

try:  # Keep the control plane importable until the production S3 extra is installed.
    import boto3
    from botocore.config import Config
    from botocore.exceptions import BotoCoreError, ClientError
except ImportError:  # pragma: no cover - exercised by dependency-free development runtimes.
    boto3 = None
    Config = None
    BotoCoreError = ClientError = Exception

from app.services.runtime_config import is_production
from app.services.secret_store import decrypt_secret


class VaultConfigurationError(ValueError):
    """Raised when a vault connection contract is incomplete or unsafe."""


_CHUNK_KEY_RE = re.compile(
    r"^nexus-backup/(?P<tenant>[A-Za-z0-9_-]{1,200})/(?P<client>[A-Za-z0-9_-]{1,200})/"
    r"(?P<device>[A-Za-z0-9_-]{1,200})/(?P<capture>[A-Za-z0-9_-]{1,200})/chunks/(?P<ordinal>[0-9]{1,9})$"
)
MAX_ENCRYPTED_CHUNK_BYTES = 64 * 1024 * 1024


@dataclass(frozen=True)
class S3VaultConnection:
    endpoint_url: str
    region: str
    bucket: str
    access_key_id: str
    secret_access_key: str
    session_token: str | None = None


def validate_endpoint_url(value: str) -> str:
    endpoint_url = str(value or "").strip().rstrip("/")
    parsed = urlparse(endpoint_url)
    if parsed.scheme not in {"https", "http"} or not parsed.hostname or parsed.username or parsed.password:
        raise VaultConfigurationError("A valid S3-compatible endpoint URL is required")
    if is_production() and parsed.scheme != "https":
        raise VaultConfigurationError("Backup vault endpoints must use HTTPS in production")
    if parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
        raise VaultConfigurationError("Backup vault endpoint must not include a path, query, or fragment")
    return endpoint_url


def connection_from_record(record: dict[str, Any] | None) -> S3VaultConnection:
    if not record:
        raise VaultConfigurationError("No server-side vault connection is configured for this destination")
    endpoint_url = validate_endpoint_url(decrypt_secret(str(record.get("endpoint_url_encrypted") or "")))
    bucket = decrypt_secret(str(record.get("bucket_encrypted") or "")).strip()
    region = str(record.get("region") or "us-east-1").strip()
    access_key_id = decrypt_secret(str(record.get("access_key_id_encrypted") or ""))
    secret_access_key = decrypt_secret(str(record.get("secret_access_key_encrypted") or ""))
    session_token = decrypt_secret(str(record.get("session_token_encrypted") or "")) or None
    if not bucket or not access_key_id or not secret_access_key:
        raise VaultConfigurationError("The server-side vault connection is incomplete")
    return S3VaultConnection(
        endpoint_url=endpoint_url,
        region=region,
        bucket=bucket,
        access_key_id=access_key_id,
        secret_access_key=secret_access_key,
        session_token=session_token,
    )


def _verify_sync(connection: S3VaultConnection) -> dict[str, Any]:
    if boto3 is None or Config is None:
        return {"state": "connector_unavailable", "verified": False, "reason_code": "s3_connector_dependency_missing"}
    client = boto3.client(
        "s3",
        endpoint_url=connection.endpoint_url,
        region_name=connection.region,
        aws_access_key_id=connection.access_key_id,
        aws_secret_access_key=connection.secret_access_key,
        aws_session_token=connection.session_token,
        config=Config(connect_timeout=8, read_timeout=12, retries={"max_attempts": 2, "mode": "standard"}),
    )
    try:
        client.head_bucket(Bucket=connection.bucket)
    except (BotoCoreError, ClientError):
        return {"state": "unreachable", "verified": False, "reason_code": "bucket_access_failed"}

    try:
        lock_configuration = client.get_object_lock_configuration(Bucket=connection.bucket)
        object_lock_enabled = str((lock_configuration.get("ObjectLockConfiguration") or {}).get("ObjectLockEnabled") or "").upper() == "ENABLED"
    except (BotoCoreError, ClientError):
        object_lock_enabled = False

    try:
        encryption_configuration = client.get_bucket_encryption(Bucket=connection.bucket)
        encryption_enabled = bool((encryption_configuration.get("ServerSideEncryptionConfiguration") or {}).get("Rules"))
    except (BotoCoreError, ClientError):
        encryption_enabled = False

    if not object_lock_enabled:
        return {"state": "not_immutable", "verified": False, "reason_code": "object_lock_not_enabled", "encryption_enabled": encryption_enabled}
    if not encryption_enabled:
        return {"state": "encryption_not_verified", "verified": False, "reason_code": "default_encryption_not_verified", "object_lock_enabled": True}
    return {
        "state": "verified",
        "verified": True,
        "reason_code": "immutable_s3_verified",
        "object_lock_enabled": True,
        "encryption_enabled": True,
    }


async def verify_connection(record: dict[str, Any] | None) -> dict[str, Any]:
    """Read-only S3 verification; errors are intentionally non-sensitive."""

    try:
        connection = connection_from_record(record)
    except VaultConfigurationError as exc:
        return {"state": "not_configured", "verified": False, "reason_code": "connection_not_configured", "detail": str(exc)}
    return await asyncio.to_thread(_verify_sync, connection)


def _chunk_key_or_raise(value: str) -> str:
    key = str(value or "").strip()
    if not _CHUNK_KEY_RE.fullmatch(key):
        raise VaultConfigurationError("Backup chunk key is not a valid scoped immutable-vault key")
    return key


def _put_encrypted_chunk_sync(
    connection: S3VaultConnection,
    *,
    object_key: str,
    ciphertext: bytes,
    retain_until: datetime,
) -> dict[str, Any]:
    if boto3 is None or Config is None:
        raise VaultConfigurationError("S3 connector dependency is unavailable")
    if len(ciphertext) <= 0 or len(ciphertext) > MAX_ENCRYPTED_CHUNK_BYTES:
        raise VaultConfigurationError("Encrypted backup chunk is outside the permitted size")
    key = _chunk_key_or_raise(object_key)
    client = boto3.client(
        "s3", endpoint_url=connection.endpoint_url, region_name=connection.region,
        aws_access_key_id=connection.access_key_id, aws_secret_access_key=connection.secret_access_key,
        aws_session_token=connection.session_token,
        config=Config(connect_timeout=8, read_timeout=30, retries={"max_attempts": 2, "mode": "standard"}),
    )
    try:
        result = client.put_object(
            Bucket=connection.bucket,
            Key=key,
            Body=ciphertext,
            ContentType="application/octet-stream",
            ServerSideEncryption="AES256",
            ObjectLockMode="GOVERNANCE",
            ObjectLockRetainUntilDate=retain_until,
            Metadata={"nexus-format": "encrypted-chunk-v1"},
        )
    except (BotoCoreError, ClientError) as exc:
        raise VaultConfigurationError("Immutable vault rejected encrypted chunk write") from exc
    ciphertext_hash = hashlib.sha256(ciphertext).hexdigest()
    return {
        "object_key": key,
        "ciphertext_sha256": ciphertext_hash,
        "ciphertext_bytes": len(ciphertext),
        "etag": str(result.get("ETag") or "").strip('"'),
        "version_id": str(result.get("VersionId") or ""),
        "retained_until": retain_until.astimezone(timezone.utc).isoformat(),
    }


async def put_encrypted_chunk(
    record: dict[str, Any] | None,
    *,
    object_key: str,
    ciphertext: bytes,
    retention_days: int,
) -> dict[str, Any]:
    """Write one already-encrypted chunk with immutable Object Lock retention.

    This adapter is intentionally server-only. It never issues presigned URLs
    and never receives plaintext, a source path, or a data key.
    """

    if retention_days < 1 or retention_days > 3650:
        raise VaultConfigurationError("Backup retention must be between 1 and 3650 days")
    connection = connection_from_record(record)
    retain_until = datetime.now(timezone.utc) + timedelta(days=retention_days)
    return await asyncio.to_thread(
        _put_encrypted_chunk_sync,
        connection,
        object_key=object_key,
        ciphertext=bytes(ciphertext),
        retain_until=retain_until,
    )
