"""Private staging and auditable release for customer upload content."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import logging
from pathlib import Path
import time
import uuid

from app.database import ROOT_DIR
from app.services.malware_scanner import MalwareScanFailure, scan_upload
from app.services.upload_security import safe_original_filename


logger = logging.getLogger(__name__)
QUARANTINE_DIR = ROOT_DIR / "private_uploads" / "quarantine"
QUARANTINE_DIR.mkdir(parents=True, exist_ok=True)


@dataclass(frozen=True)
class CleanUpload:
    quarantine_id: str
    provider: str
    scanned_at: str
    tenant_id: str | None
    client_id: str | None
    target_type: str
    target_id: str
    filename: str
    content_type: str
    size: int
    actor_id: str
    actor_name: str

    def metadata(self) -> dict[str, str]:
        return {"status": "clean", "provider": self.provider, "scanned_at": self.scanned_at}


class UploadQuarantineFailure(RuntimeError):
    def __init__(self, reason_code: str, *, rejected: bool):
        super().__init__(reason_code)
        self.reason_code = reason_code
        self.rejected = rejected


async def ensure_upload_quarantine_indexes(database) -> None:
    """Create only the indexes needed for scoped operational inspection."""
    await database.upload_quarantine.create_index("id", unique=True, name="upload_quarantine_id_unique")
    await database.upload_quarantine.create_index(
        [("tenant_id", 1), ("client_id", 1), ("status", 1), ("created_at", -1)],
        name="upload_quarantine_tenant_client_status_time",
    )


async def cleanup_stale_quarantine(database, *, max_age_seconds: int = 3600) -> int:
    """Remove private bytes orphaned by an interrupted scan/release request."""
    removed = 0
    cutoff = time.time() - max(60, max_age_seconds)
    for path in QUARANTINE_DIR.glob("*.quarantine"):
        try:
            if path.stat().st_mtime >= cutoff:
                continue
            path.unlink()
            removed += 1
            await database.upload_quarantine.update_one(
                {"id": path.stem, "status": {"$in": ["pending", "scanning", "clean"]}},
                {"$set": {
                    "status": "error",
                    "reason_code": "stale_quarantine_removed",
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }},
            )
        except OSError:
            logger.exception("Unable to remove stale private upload quarantine file")
    return removed


async def _audit(database, record: dict, action: str, reason_code: str) -> None:
    await database.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "action": action,
        "entity_type": "upload_quarantine",
        "entity_id": record["id"],
        "entity_name": record["filename"],
        "client_id": record.get("client_id"),
        "tenant_id": record.get("tenant_id"),
        "ticket_id": record.get("target_id") if record.get("target_type") == "ticket_attachment" else None,
        "user_id": record.get("actor_id"),
        "user_name": record.get("actor_name"),
        "metadata": {
            "target_type": record.get("target_type"),
            "target_id": record.get("target_id"),
            "reason_code": reason_code,
            "size": record.get("size"),
            "content_type": record.get("content_type"),
        },
        "created_at": datetime.now(timezone.utc).isoformat(),
    })


def _remove(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        logger.exception("Unable to remove private upload quarantine file")


async def inspect_upload(
    *,
    database,
    content: bytes,
    filename: str | None,
    content_type: str | None,
    tenant_id: str | None,
    client_id: str | None,
    target_type: str,
    target_id: str,
    actor_id: str,
    actor_name: str,
) -> CleanUpload:
    """Stage privately, scan, and return a one-use clean release decision."""
    quarantine_id = str(uuid.uuid4())
    path = QUARANTINE_DIR / f"{quarantine_id}.quarantine"
    now = datetime.now(timezone.utc).isoformat()
    record = {
        "id": quarantine_id,
        "status": "pending",
        "filename": safe_original_filename(filename),
        "content_type": content_type or "application/octet-stream",
        "size": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
        "tenant_id": tenant_id or None,
        "client_id": client_id or None,
        "target_type": target_type,
        "target_id": target_id,
        "actor_id": actor_id,
        "actor_name": actor_name,
        "created_at": now,
        "updated_at": now,
    }
    path.write_bytes(content)
    try:
        await database.upload_quarantine.insert_one(dict(record))
        await _audit(database, record, "upload_quarantine_staged", "pending_scan")
        await database.upload_quarantine.update_one(
            {"id": quarantine_id},
            {"$set": {"status": "scanning", "updated_at": datetime.now(timezone.utc).isoformat()}},
        )
        result = await scan_upload(content)
        if result.status != "clean":
            raise MalwareScanFailure("malware_detected", rejected=True)
    except MalwareScanFailure as exc:
        failed_at = datetime.now(timezone.utc).isoformat()
        try:
            await database.upload_quarantine.update_one(
                {"id": quarantine_id},
                {"$set": {
                    "status": "infected" if exc.rejected else "error",
                    "reason_code": exc.reason_code,
                    "updated_at": failed_at,
                }},
            )
            action = "upload_quarantine_rejected" if exc.rejected else "upload_quarantine_failed"
            await _audit(database, record, action, exc.reason_code)
        finally:
            _remove(path)
        raise UploadQuarantineFailure(exc.reason_code, rejected=exc.rejected) from exc
    except Exception:
        _remove(path)
        raise

    scanned_at = datetime.now(timezone.utc).isoformat()
    try:
        await database.upload_quarantine.update_one(
            {"id": quarantine_id},
            {"$set": {
                "status": "clean",
                "scanner_provider": result.provider,
                "reason_code": "clean",
                "scanned_at": scanned_at,
                "updated_at": scanned_at,
            }},
        )
        await _audit(database, record, "upload_quarantine_clean", "clean")
    except Exception:
        _remove(path)
        raise
    return CleanUpload(
        quarantine_id=quarantine_id,
        provider=result.provider,
        scanned_at=scanned_at,
        tenant_id=record.get("tenant_id"),
        client_id=record.get("client_id"),
        target_type=target_type,
        target_id=target_id,
        filename=record["filename"],
        content_type=record["content_type"],
        size=record["size"],
        actor_id=actor_id,
        actor_name=actor_name,
    )


def _clean_record(upload: CleanUpload) -> dict:
    return {
        "id": upload.quarantine_id,
        "filename": upload.filename,
        "tenant_id": upload.tenant_id,
        "client_id": upload.client_id,
        "target_type": upload.target_type,
        "target_id": upload.target_id,
        "actor_id": upload.actor_id,
        "actor_name": upload.actor_name,
        "content_type": upload.content_type,
        "size": upload.size,
    }


async def release_upload(database, upload: CleanUpload) -> None:
    """Consume a clean decision after its final private record is durable."""
    _remove(QUARANTINE_DIR / f"{upload.quarantine_id}.quarantine")
    released_at = datetime.now(timezone.utc).isoformat()
    try:
        await database.upload_quarantine.update_one(
            {"id": upload.quarantine_id, "status": "clean"},
            {"$set": {"status": "released", "released_at": released_at, "updated_at": released_at}},
        )
        await _audit(database, _clean_record(upload), "upload_quarantine_released", "released")
    except Exception:
        logger.exception("Unable to mark a clean upload quarantine record as released")


async def discard_upload(database, upload: CleanUpload, reason_code: str = "release_failed") -> None:
    """Remove staged bytes if downstream private persistence cannot complete."""
    _remove(QUARANTINE_DIR / f"{upload.quarantine_id}.quarantine")
    try:
        await database.upload_quarantine.update_one(
            {"id": upload.quarantine_id},
            {"$set": {
                "status": "error",
                "reason_code": reason_code,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        await _audit(database, _clean_record(upload), "upload_quarantine_failed", reason_code)
    except Exception:
        logger.exception("Unable to mark a discarded upload quarantine record")
