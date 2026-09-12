"""Safe, explicit prevention follow-ups for completed Nexus Work Sessions.

This module deliberately records a *proposal*, not a remediation.  It gives a
technician a durable place to retain recurrence evidence and a reviewable scope
after a successful work session without queuing a command, changing a provider,
or starting an automation.  A later, separately authorised workflow may turn a
reviewed proposal into a ticket, change or remediation campaign.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
import re
import uuid

from fastapi import HTTPException


PREVENTION_FOLLOW_UP_SCHEMA = "prevention_follow_up.v1"
FOLLOW_UP_COLLECTION = "nexus_prevention_followups"
_indexed_database_ids: set[int] = set()
_VALID_PRIORITIES = frozenset({"low", "medium", "high"})
_IDEMPOTENCY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def clean_text(value: Any, *, field: str, minimum: int = 0, maximum: int = 4_000) -> str:
    """Normalise bounded user-authored evidence without retaining excess data."""
    result = str(value or "").strip()
    if len(result) < minimum:
        raise HTTPException(status_code=422, detail=f"{field} is required")
    if len(result) > maximum:
        raise HTTPException(status_code=422, detail=f"{field} must be {maximum} characters or fewer")
    return result


def normalise_candidate_device_ids(value: Any) -> list[str]:
    """Return an explicitly bounded, stable device-ID list.

    These are review candidates only.  The service intentionally does not
    resolve a device name, generate a command, or assume that a candidate is a
    valid remediation target.
    """
    if value in (None, ""):
        return []
    if not isinstance(value, list):
        raise HTTPException(status_code=422, detail="candidate_device_ids must be a list of Nexus device IDs")
    values = sorted({str(item).strip() for item in value if str(item or "").strip()})
    if len(values) > 100:
        raise HTTPException(status_code=422, detail="A prevention follow-up can review at most 100 endpoints")
    if any(len(item) > 128 for item in values):
        raise HTTPException(status_code=422, detail="candidate_device_ids contains an invalid Nexus device ID")
    return values


def normalise_idempotency_key(value: Any) -> str | None:
    key = str(value or "").strip()
    if not key:
        return None
    if not _IDEMPOTENCY_RE.fullmatch(key):
        raise HTTPException(
            status_code=422,
            detail="idempotency_key must use 1-128 letters, numbers, dots, underscores, colons or hyphens",
        )
    return key


async def ensure_prevention_follow_up_indexes(*, database: Any) -> None:
    """Create narrow indexes for retry-safe, client-scoped proposal records.

    Thin test doubles and local tools are allowed to omit ``create_index``.
    Production Motor collections receive an idempotent unique key for an
    explicit browser retry; historical collections remain untouched because the
    partial filter applies only to this schema.
    """
    database_id = id(database)
    if database_id in _indexed_database_ids:
        return
    collection = getattr(database, FOLLOW_UP_COLLECTION)
    create_index = getattr(collection, "create_index", None)
    if not callable(create_index):
        return
    await create_index(
        "id",
        unique=True,
        name="prevention_follow_up_id_unique",
        partialFilterExpression={
            "schema_version": PREVENTION_FOLLOW_UP_SCHEMA,
            "id": {"$type": "string"},
        },
    )
    await create_index(
        [("work_session_id", 1), ("idempotency_key", 1)],
        unique=True,
        name="prevention_follow_up_session_idempotency",
        partialFilterExpression={
            "schema_version": PREVENTION_FOLLOW_UP_SCHEMA,
            "idempotency_key": {"$type": "string"},
        },
    )
    await create_index(
        [("client_id", 1), ("status", 1), ("created_at", -1)],
        name="prevention_follow_up_client_status_time",
    )
    _indexed_database_ids.add(database_id)


def build_prevention_follow_up(
    *,
    work_session: dict[str, Any],
    ticket: dict[str, Any],
    actor: dict[str, Any],
    data: dict[str, Any],
    candidate_device_ids: list[str],
    source_device_id: str | None,
    created_at: str | None = None,
) -> dict[str, Any]:
    """Build a non-executable, client-scoped follow-up proposal.

    The explicit state values are part of the safety contract: no caller may
    use this record to imply that remediation has been approved, scheduled or
    executed.
    """
    if str(work_session.get("status") or "") != "completed":
        raise HTTPException(status_code=409, detail="Complete the Work Session before proposing prevention follow-up")
    client_id = str(ticket.get("client_id") or "").strip()
    if not client_id or client_id != str(work_session.get("client_id") or "").strip():
        raise HTTPException(status_code=409, detail="The Work Session no longer has a safe client scope")

    title = clean_text(data.get("title") or data.get("condition"), field="title", minimum=3, maximum=180)
    summary = clean_text(data.get("summary"), field="summary", minimum=3, maximum=4_000)
    outcome = work_session.get("outcome") if isinstance(work_session.get("outcome"), dict) else {}
    recurrence_evidence = clean_text(
        data.get("recurrence_evidence") or outcome.get("recurrence_check"),
        field="recurrence_evidence",
        maximum=4_000,
    )
    priority = str(data.get("priority") or "medium").strip().lower()
    if priority not in _VALID_PRIORITIES:
        raise HTTPException(status_code=422, detail="priority must be low, medium or high")
    idempotency_key = normalise_idempotency_key(data.get("idempotency_key"))
    created_at = created_at or utc_now()

    return {
        "id": str(uuid.uuid4()),
        "schema_version": PREVENTION_FOLLOW_UP_SCHEMA,
        "source": "nexus_work_session",
        "work_session_id": str(work_session.get("id") or ""),
        "ticket_id": str(ticket.get("id") or ""),
        "client_id": client_id,
        "site_id": ticket.get("site_id"),
        "tenant_id": ticket.get("tenant_id") or work_session.get("tenant_id"),
        "source_device_id": source_device_id,
        "candidate_device_ids": candidate_device_ids,
        "title": title,
        "summary": summary,
        "recurrence_evidence": recurrence_evidence,
        "priority": priority,
        "status": "proposed",
        "execution_status": "not_started",
        "requires_human_review": True,
        "auto_remediation": False,
        "execution_blocked_reason": "A technician must review the evidence and deliberately create a governed ticket, change or remediation campaign.",
        "allowed_next_actions": [
            "review_evidence",
            "create_governed_ticket",
            "propose_change",
            "prepare_remediation_campaign",
        ],
        "created_by": {
            "id": actor.get("id"),
            "name": actor.get("name") or actor.get("email") or "Nexus technician",
        },
        "created_at": created_at,
        "updated_at": created_at,
        "idempotency_key": idempotency_key,
    }


async def create_prevention_follow_up(
    *,
    database: Any,
    work_session: dict[str, Any],
    ticket: dict[str, Any],
    actor: dict[str, Any],
    data: dict[str, Any],
    candidate_device_ids: list[str],
    source_device_id: str | None,
) -> tuple[dict[str, Any], bool]:
    """Persist a proposal once, preserving idempotent browser retries."""
    await ensure_prevention_follow_up_indexes(database=database)
    key = normalise_idempotency_key(data.get("idempotency_key"))
    collection = getattr(database, FOLLOW_UP_COLLECTION)
    if key:
        existing = await collection.find_one(
            {
                "work_session_id": str(work_session.get("id") or ""),
                "idempotency_key": key,
                "client_id": str(ticket.get("client_id") or ""),
            },
            {"_id": 0},
        )
        if existing:
            return existing, False

    follow_up = build_prevention_follow_up(
        work_session=work_session,
        ticket=ticket,
        actor=actor,
        data=data,
        candidate_device_ids=candidate_device_ids,
        source_device_id=source_device_id,
    )
    try:
        await collection.insert_one(dict(follow_up))
    except Exception:
        # A unique-index race is safe to treat as a retry only after resolving
        # the same stable session/key/client tuple.  Every other storage error
        # remains visible to the caller.
        if not key:
            raise
        existing = await collection.find_one(
            {
                "work_session_id": str(work_session.get("id") or ""),
                "idempotency_key": key,
                "client_id": str(ticket.get("client_id") or ""),
            },
            {"_id": 0},
        )
        if not existing:
            raise
        return existing, False
    return follow_up, True
