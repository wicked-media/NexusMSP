"""Domain rules for accountable Client Studio follow-ups.

Follow-ups are client-bound relationship commitments, not ticket, project or
automation records.  This module keeps the persisted shape and safe API view
consistent without allowing browser-supplied tenancy, actor or owner names.
"""

from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
from typing import Any

from fastapi import HTTPException


FOLLOW_UP_SCHEMA = "client_follow_up.v1"
FOLLOW_UP_KINDS = frozenset({"task", "call", "meeting", "review"})
FOLLOW_UP_PRIORITIES = frozenset({"low", "normal", "high"})
FOLLOW_UP_STATUSES = frozenset({"open", "completed", "cancelled"})


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def iso_datetime(value: datetime) -> str:
    """Normalise a validated deadline to an explicit UTC timestamp."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def stable_follow_up_id(tenant_id: str, client_id: str, idempotency_key: str) -> str:
    """Derive a durable identity from a client-scoped create intent.

    This lets Mongo's built-in unique ``_id`` prevent duplicate records even if
    two retries arrive at exactly the same time, without reusing a mutable title
    or a contact's display data as an identifier.
    """
    source = "\x00".join((str(tenant_id), str(client_id), str(idempotency_key)))
    return "client-follow-up-" + sha256(source.encode("utf-8")).hexdigest()


def clean_text(value: Any, *, field: str, minimum: int = 0, maximum: int) -> str:
    if not isinstance(value, str):
        raise HTTPException(status_code=422, detail=f"{field} must be text")
    cleaned = value.strip()
    if not (minimum <= len(cleaned) <= maximum):
        bounds = f"between {minimum} and {maximum}" if minimum else f"at most {maximum}"
        raise HTTPException(status_code=422, detail=f"{field} must be {bounds} characters")
    return cleaned


def clean_choice(value: Any, *, field: str, allowed: frozenset[str]) -> str:
    candidate = str(value or "").strip().lower()
    if candidate not in allowed:
        raise HTTPException(status_code=422, detail=f"Choose a supported {field}")
    return candidate


def visible_follow_up(row: dict[str, Any]) -> dict[str, Any]:
    """Return the operational record without internal tenant/idempotency values."""
    return {
        key: value
        for key, value in row.items()
        if key not in {"_id", "tenant_id", "idempotency_key"}
    }


def new_follow_up(
    *,
    tenant_id: str,
    client_id: str,
    data: dict[str, Any],
    owner: dict[str, Any],
    actor: dict[str, Any],
) -> dict[str, Any]:
    now = utc_now()
    title = clean_text(data.get("title"), field="Title", minimum=1, maximum=240)
    note = clean_text(data.get("note", ""), field="Note", maximum=4000)
    idempotency_key = clean_text(
        data.get("idempotency_key"), field="Idempotency key", minimum=8, maximum=160,
    )
    due_at = data.get("due_at")
    if not isinstance(due_at, datetime):
        raise HTTPException(status_code=422, detail="A valid due date and time is required")

    return {
        "_id": stable_follow_up_id(tenant_id, client_id, idempotency_key),
        "id": stable_follow_up_id(tenant_id, client_id, idempotency_key),
        "schema_version": FOLLOW_UP_SCHEMA,
        "tenant_id": tenant_id,
        "client_id": str(client_id),
        "idempotency_key": idempotency_key,
        "title": title,
        "note": note,
        "kind": clean_choice(data.get("kind", "task"), field="follow-up type", allowed=FOLLOW_UP_KINDS),
        "priority": clean_choice(data.get("priority", "normal"), field="priority", allowed=FOLLOW_UP_PRIORITIES),
        "status": "open",
        "due_at": iso_datetime(due_at),
        "owner_id": str(owner["id"]),
        "owner_name": clean_text(owner.get("name") or "", field="Owner name", minimum=1, maximum=240),
        "created_by_id": str(actor.get("id") or "system"),
        "created_by_name": clean_text(actor.get("name") or "System", field="Actor name", minimum=1, maximum=240),
        "created_at": now,
        "updated_at": now,
        "version": 1,
    }


def update_follow_up(
    existing: dict[str, Any],
    data: dict[str, Any],
    *,
    owner: dict[str, Any] | None,
    actor: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Build a constrained update and its matching safe audit metadata."""
    changes: dict[str, Any] = {"updated_at": utc_now()}
    audit: dict[str, Any] = {"follow_up_id": existing["id"]}
    unset: dict[str, str] = {}

    if data.get("title") is not None:
        changes["title"] = clean_text(data["title"], field="Title", minimum=1, maximum=240)
    if data.get("note") is not None:
        changes["note"] = clean_text(data["note"], field="Note", maximum=4000)
    if data.get("kind") is not None:
        changes["kind"] = clean_choice(data["kind"], field="follow-up type", allowed=FOLLOW_UP_KINDS)
        audit["kind"] = changes["kind"]
    if data.get("priority") is not None:
        changes["priority"] = clean_choice(data["priority"], field="priority", allowed=FOLLOW_UP_PRIORITIES)
        audit["priority"] = changes["priority"]
    if data.get("due_at") is not None:
        due_at = data["due_at"]
        if not isinstance(due_at, datetime):
            raise HTTPException(status_code=422, detail="A valid due date and time is required")
        changes["due_at"] = iso_datetime(due_at)
        audit["due_at"] = changes["due_at"]
    if owner is not None:
        changes["owner_id"] = str(owner["id"])
        changes["owner_name"] = clean_text(owner.get("name") or "", field="Owner name", minimum=1, maximum=240)
        audit["owner_id"] = changes["owner_id"]

    next_status = existing.get("status", "open")
    if data.get("status") is not None:
        next_status = clean_choice(data["status"], field="follow-up status", allowed=FOLLOW_UP_STATUSES)
        changes["status"] = next_status
        audit["status"] = next_status

    completion_note = data.get("completion_note")
    if completion_note is not None:
        completion_note = clean_text(completion_note, field="Completion note", maximum=4000)
    if completion_note is not None and next_status != "completed":
        raise HTTPException(status_code=422, detail="Complete the follow-up before recording completion evidence")

    if next_status == "completed" and existing.get("status") != "completed":
        changes.update({
            "completed_at": changes["updated_at"],
            "completed_by_id": str(actor.get("id") or "system"),
            "completed_by_name": clean_text(actor.get("name") or "System", field="Actor name", minimum=1, maximum=240),
        })
        audit["completed"] = True
    elif next_status != "completed" and existing.get("status") == "completed":
        unset = {"completed_at": "", "completed_by_id": "", "completed_by_name": "", "completion_note": ""}
        audit["completed"] = False

    if completion_note is not None:
        changes["completion_note"] = completion_note
        audit["has_completion_note"] = bool(completion_note)

    return changes, {"audit": audit, "unset": unset}
