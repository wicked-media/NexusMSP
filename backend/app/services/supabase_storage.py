"""Private Supabase Storage support for durable Nexus artifacts.

MongoDB remains the operational system of record.  This adapter is deliberately
limited to binary artifacts (documents, branded PDFs, evidence and attachments)
so metadata, permissions and workflow state continue to live in Nexus.
"""
from __future__ import annotations

import logging
import os
import re
import hashlib
from typing import Any
from urllib.parse import quote

import httpx


logger = logging.getLogger(__name__)

DEFAULT_BUCKET = "nexus-artifacts"
_OBJECT_PATH = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/=-]{0,1023}$")


class SupabaseStorageError(RuntimeError):
    """Raised when a configured Supabase Storage operation cannot complete."""


def _config() -> tuple[str, str, str] | None:
    url = str(os.getenv("SUPABASE_URL") or "").strip().rstrip("/")
    service_key = str(os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    bucket = str(os.getenv("NEXUS_SUPABASE_ARTIFACT_BUCKET") or DEFAULT_BUCKET).strip()
    if not url or not service_key or not bucket:
        return None
    return url, service_key, bucket


def is_configured() -> bool:
    return _config() is not None


def _headers(service_key: str) -> dict[str, str]:
    return {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
    }


def _safe_path(object_path: str) -> str:
    normalised = str(object_path or "").strip().lstrip("/")
    if not normalised or ".." in normalised.split("/") or not _OBJECT_PATH.fullmatch(normalised):
        raise ValueError("Artifact object path is invalid")
    return normalised


def _bucket_missing(response: httpx.Response) -> bool:
    """Supabase Storage currently represents a missing bucket as HTTP 400."""
    if response.status_code == 404:
        return True
    try:
        payload = response.json()
    except ValueError:
        return False
    return str(payload.get("code") or "") == "NoSuchBucket" or str(payload.get("statusCode") or "") == "404"


async def storage_status() -> dict[str, Any]:
    """Return a secret-free readiness result for the private artifact bucket."""
    config = _config()
    if not config:
        return {"configured": False, "bucket": None, "ready": False, "detail": "Supabase Storage is not configured."}

    url, service_key, bucket = config
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{url}/storage/v1/bucket/{quote(bucket, safe='')}",
                headers=_headers(service_key),
            )
        if _bucket_missing(response):
            return {"configured": True, "bucket": bucket, "ready": False, "detail": "Private artifact bucket has not been created yet."}
        response.raise_for_status()
        payload = response.json()
        return {
            "configured": True,
            "bucket": bucket,
            "ready": True,
            "public": bool(payload.get("public", False)),
            "detail": "Private artifact storage is ready.",
        }
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("Supabase Storage status check failed: %s", exc)
        return {"configured": True, "bucket": bucket, "ready": False, "detail": "Supabase Storage is temporarily unavailable."}


async def ensure_private_bucket() -> dict[str, Any]:
    """Create the private Nexus artifact bucket if it does not already exist."""
    config = _config()
    if not config:
        raise SupabaseStorageError("Supabase Storage is not configured")

    url, service_key, bucket = config
    headers = _headers(service_key)
    bucket_url = f"{url}/storage/v1/bucket/{quote(bucket, safe='')}"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            existing = await client.get(bucket_url, headers=headers)
            if _bucket_missing(existing):
                created = await client.post(
                    f"{url}/storage/v1/bucket",
                    headers=headers,
                    json={"id": bucket, "name": bucket, "public": False},
                )
                created.raise_for_status()
                payload = created.json()
            else:
                existing.raise_for_status()
                payload = existing.json()
    except httpx.HTTPError as exc:
        logger.error("Unable to provision Supabase artifact bucket: %s", exc)
        raise SupabaseStorageError("Unable to provision Supabase artifact storage") from exc

    if payload.get("public"):
        raise SupabaseStorageError("Nexus artifact bucket must remain private")
    return {"bucket": bucket, "public": False, "ready": True}


async def upload_artifact(object_path: str, content: bytes, content_type: str) -> str:
    """Store a binary artifact privately and return its object path, never a public URL."""
    config = _config()
    if not config:
        raise SupabaseStorageError("Supabase Storage is not configured")
    if not content:
        raise ValueError("Artifact content cannot be empty")

    url, service_key, bucket = config
    safe_path = _safe_path(object_path)
    await ensure_private_bucket()
    headers = {
        **_headers(service_key),
        "Content-Type": content_type or "application/octet-stream",
        "x-upsert": "false",
    }
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{url}/storage/v1/object/{quote(bucket, safe='')}/{quote(safe_path, safe='/')}",
                headers=headers,
                content=content,
            )
        # Content-addressed artifacts are immutable. A concurrent preview may
        # already have persisted this exact file, which is a successful result.
        if response.status_code == 409:
            return safe_path
        response.raise_for_status()
        return safe_path
    except httpx.HTTPError as exc:
        logger.error("Unable to upload Nexus artifact: %s", exc)
        raise SupabaseStorageError("Unable to store Nexus artifact") from exc


async def archive_generated_pdf(document_type: str, document_id: str, pdf_bytes: bytes) -> str | None:
    """Best-effort, immutable PDF retention that never interrupts a preview."""
    if not is_configured():
        return None
    safe_type = re.sub(r"[^A-Za-z0-9_-]", "-", str(document_type or "document")).strip("-") or "document"
    safe_id = re.sub(r"[^A-Za-z0-9_-]", "-", str(document_id or "record")).strip("-") or "record"
    digest = hashlib.sha256(pdf_bytes).hexdigest()
    object_path = f"generated/{safe_type}/{safe_id}/{digest}.pdf"
    try:
        return await upload_artifact(object_path, pdf_bytes, "application/pdf")
    except (SupabaseStorageError, ValueError) as exc:
        logger.warning("Nexus PDF archive skipped for %s/%s: %s", safe_type, safe_id, exc)
        return None


async def archive_client_artifact(
    client_id: str,
    artifact_kind: str,
    content: bytes,
    extension: str,
    content_type: str,
) -> str | None:
    """Mirror client-owned data to private storage without changing its live URL."""
    if not is_configured():
        return None
    safe_client = re.sub(r"[^A-Za-z0-9_-]", "-", str(client_id or "client")).strip("-") or "client"
    safe_kind = re.sub(r"[^A-Za-z0-9_-]", "-", str(artifact_kind or "asset")).strip("-") or "asset"
    safe_extension = re.sub(r"[^A-Za-z0-9]", "", str(extension or "bin")).lower() or "bin"
    digest = hashlib.sha256(content).hexdigest()
    object_path = f"clients/{safe_client}/{safe_kind}/{digest}.{safe_extension}"
    try:
        return await upload_artifact(object_path, content, content_type)
    except (SupabaseStorageError, ValueError) as exc:
        logger.warning("Client artifact archive skipped for %s/%s: %s", safe_client, safe_kind, exc)
        return None


async def archive_record_artifact(
    record_type: str,
    record_id: str,
    content: bytes,
    extension: str,
    content_type: str,
) -> str | None:
    """Store an immutable attachment for a Nexus record without changing its URL."""
    if not is_configured():
        return None
    safe_type = re.sub(r"[^A-Za-z0-9_-]", "-", str(record_type or "records")).strip("-") or "records"
    safe_id = re.sub(r"[^A-Za-z0-9_-]", "-", str(record_id or "record")).strip("-") or "record"
    safe_extension = re.sub(r"[^A-Za-z0-9]", "", str(extension or "bin")).lower() or "bin"
    digest = hashlib.sha256(content).hexdigest()
    object_path = f"records/{safe_type}/{safe_id}/{digest}.{safe_extension}"
    try:
        return await upload_artifact(object_path, content, content_type)
    except (SupabaseStorageError, ValueError) as exc:
        logger.warning("Record artifact archive skipped for %s/%s: %s", safe_type, safe_id, exc)
        return None


async def delete_artifact(object_path: str) -> bool:
    """Remove a private object after Nexus has authorised a source-record delete."""
    config = _config()
    if not config:
        return False
    url, service_key, bucket = config
    try:
        safe_path = _safe_path(object_path)
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.delete(
                f"{url}/storage/v1/object/{quote(bucket, safe='')}/{quote(safe_path, safe='/')}",
                headers=_headers(service_key),
            )
        if response.status_code in {200, 204, 404} or _bucket_missing(response):
            return True
        response.raise_for_status()
        return True
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("Unable to delete Nexus artifact: %s", exc)
        return False
