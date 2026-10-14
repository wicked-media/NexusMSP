"""Canonical ticket-time compatibility boundary.

``time_entries`` is the authoritative Nexus record for billable time, ticket
time totals and invoice generation.  ``ticket_time_entries`` is retained only
as a non-billable, read-only compatibility history for records written by the
legacy ticket workspace.  This module deliberately does not migrate or delete
legacy rows: it makes the ownership boundary explicit while allowing older
ticket history to remain visible.

Every new ticket-linked write carries a source, source reference and
idempotency key.  Internal producers (Nexus Work Session and Nexus Remote)
use their stable session IDs as the reference so a retry cannot create a
second billable entry.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
import math
import uuid

from fastapi import HTTPException

from app.database import db as default_db


CANONICAL_STORE = "time_entries"
LEGACY_STORE = "ticket_time_entries"
CANONICAL_SCHEMA_VERSION = "ticket_time.v1"
_indexed_database_ids: set[int] = set()


def _minutes(value: Any) -> float:
    """Return a non-negative numeric duration without trusting stored shape."""
    try:
        return max(0.0, float(value or 0))
    except (TypeError, ValueError):
        return 0.0


def _signed_minutes(value: Any) -> float:
    """Return a finite signed duration for explicit correction records only."""
    try:
        candidate = float(value)
    except (TypeError, ValueError):
        return 0.0
    return candidate if math.isfinite(candidate) else 0.0


def _clean_total(value: float) -> int | float:
    return int(value) if value.is_integer() else round(value, 2)


def _normalise_billable(value: Any) -> bool:
    """Accept only unambiguous billable values at the domain boundary."""
    if isinstance(value, bool):
        return value
    if isinstance(value, int) and value in (0, 1):
        return bool(value)
    if isinstance(value, str):
        normalised = value.strip().lower()
        if normalised in {"true", "1", "yes"}:
            return True
        if normalised in {"false", "0", "no"}:
            return False
    raise HTTPException(status_code=422, detail="Billable must be a boolean value")


def _normalise_hourly_rate(value: Any) -> float:
    """Reject non-finite or negative money values before they reach billing."""
    candidate = 75.0 if value is None or value == "" else value
    try:
        rate = float(candidate)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="Hourly rate must be a number")
    if not math.isfinite(rate) or rate < 0:
        raise HTTPException(status_code=422, detail="Hourly rate must be a finite non-negative number")
    return round(rate, 4)


def _timestamp(entry: dict[str, Any]) -> str:
    return str(entry.get("created_at") or entry.get("date") or "")


def _canonical_display_entry(entry: dict[str, Any]) -> dict[str, Any]:
    """Annotate an authoritative record without mutating its stored payload."""
    result = dict(entry)
    result["record_store"] = CANONICAL_STORE
    result["authoritative"] = True
    result["billing_eligible"] = True
    result.setdefault("source", "manual_time_entry")
    result.setdefault("source_reference", result.get("id"))
    result.setdefault("time_entry_schema", CANONICAL_SCHEMA_VERSION)
    return result


def _legacy_display_entry(entry: dict[str, Any]) -> dict[str, Any]:
    """Expose a legacy row as visible history, never as billing input."""
    result = dict(entry)
    result["record_store"] = LEGACY_STORE
    result["authoritative"] = False
    result["billing_eligible"] = False
    result["legacy_read_only"] = True
    result["source"] = "legacy_ticket_time_entry"
    result["source_reference"] = result.get("id")
    result["time_entry_schema"] = "legacy_ticket_time.v0"
    return result


async def list_ticket_time_history(
    ticket_id: str,
    *,
    database: Any = default_db,
    limit: int = 500,
) -> list[dict[str, Any]]:
    """Return authoritative entries plus clearly labelled legacy history.

    Legacy rows are deliberately kept out of canonical totals and billing.  If
    a future controlled import records ``legacy_ticket_time_entry_id`` on a
    canonical row, the matching legacy copy is hidden to avoid a duplicate in
    the ticket timeline.
    """
    canonical = await database.time_entries.find(
        {"ticket_id": ticket_id}, {"_id": 0}
    ).to_list(limit)
    legacy = await database.ticket_time_entries.find(
        {"ticket_id": ticket_id}, {"_id": 0}
    ).to_list(limit)
    imported_legacy_ids = {
        str(entry.get("legacy_ticket_time_entry_id"))
        for entry in canonical
        if entry.get("legacy_ticket_time_entry_id")
    }
    history = [_canonical_display_entry(entry) for entry in canonical]
    history.extend(
        _legacy_display_entry(entry)
        for entry in legacy
        if str(entry.get("id") or "") not in imported_legacy_ids
    )
    return sorted(history, key=_timestamp, reverse=True)[:limit]


async def list_technician_time_history(
    user_id: str,
    *,
    database: Any = default_db,
    since: str | None = None,
    limit: int = 5000,
) -> list[dict[str, Any]]:
    """Return one non-duplicated technician time read model.

    This compatibility read is intentionally the only place legacy
    ``ticket_time_entries`` join the new canonical stream. Billing and ticket
    totals use canonical entries only; technician history retains visible
    legacy history until a separately approved import can map it safely.
    """
    query: dict[str, Any] = {"user_id": str(user_id)}
    if since:
        query["created_at"] = {"$gte": since}
    canonical = await database.time_entries.find(query, {"_id": 0}).to_list(limit)
    legacy = await database.ticket_time_entries.find(query, {"_id": 0}).to_list(limit)
    imported_legacy_ids = {
        str(entry.get("legacy_ticket_time_entry_id"))
        for entry in canonical
        if entry.get("legacy_ticket_time_entry_id")
    }
    history = [_canonical_display_entry(entry) for entry in canonical]
    history.extend(
        _legacy_display_entry(entry)
        for entry in legacy
        if str(entry.get("id") or "") not in imported_legacy_ids
    )
    return sorted(history, key=_timestamp, reverse=True)[:limit]


async def canonical_ticket_minutes(
    ticket_id: str,
    *,
    database: Any = default_db,
) -> int | float:
    """Calculate a ticket's total from the sole authoritative collection."""
    entries = await database.time_entries.find(
        {"ticket_id": ticket_id}, {"_id": 0, "minutes": 1}
    ).to_list(10000)
    return _clean_total(sum(_signed_minutes(entry.get("minutes")) for entry in entries))


async def sync_ticket_time_cache(
    ticket_id: str,
    *,
    database: Any = default_db,
    calculated_at: str | None = None,
) -> int | float:
    """Refresh the ticket's derived display cache from canonical time entries."""
    total_minutes = await canonical_ticket_minutes(ticket_id, database=database)
    await database.tickets.update_one(
        {"id": ticket_id},
        {
            "$set": {
                "total_time_minutes": total_minutes,
                "total_time_source": CANONICAL_STORE,
                "time_total_calculated_at": calculated_at
                or datetime.now(timezone.utc).isoformat(),
            }
        },
    )
    return total_minutes


async def ensure_ticket_time_indexes(*, database: Any = default_db) -> None:
    """Create the small, idempotent indexes that protect retry-safe writes.

    Test doubles and thin local adapters need not implement ``create_index``;
    the production Motor collection does.  The partial unique index leaves old
    records without an idempotency key untouched.
    """
    database_id = id(database)
    if database_id in _indexed_database_ids:
        return
    collection = database.time_entries
    create_index = getattr(collection, "create_index", None)
    if not callable(create_index):
        return
    await create_index(
        [("ticket_id", 1), ("idempotency_key", 1)],
        name="ticket_time_idempotency",
        unique=True,
        partialFilterExpression={
            "time_entry_schema": CANONICAL_SCHEMA_VERSION,
            "idempotency_key": {"$type": "string"},
        },
    )
    # This deliberately targets only the new canonical record shape.  Older
    # historical documents are left untouched until a separately approved
    # duplicate-ID audit/migration can establish their integrity.
    await create_index(
        [("id", 1)],
        name="canonical_time_entry_id_unique",
        unique=True,
        partialFilterExpression={
            "time_entry_schema": CANONICAL_SCHEMA_VERSION,
            "id": {"$type": "string"},
        },
    )
    await create_index(
        [("ticket_id", 1), ("created_at", -1)],
        name="ticket_time_history",
    )
    _indexed_database_ids.add(database_id)


async def create_canonical_ticket_time_entry(
    *,
    ticket: dict[str, Any],
    actor: dict[str, Any],
    minutes: int | float,
    description: str,
    billable: bool,
    source: str,
    source_reference: str | None = None,
    idempotency_key: str | None = None,
    hourly_rate: float = 75.0,
    date: str | None = None,
    extra: dict[str, Any] | None = None,
    created_at: str | None = None,
    allow_negative_adjustment: bool = False,
    database: Any = default_db,
) -> tuple[dict[str, Any], bool]:
    """Write one authoritative ticket-time record, idempotently where possible.

    Returns ``(entry, created)``.  A matching idempotency key returns the
    original record and refreshes the ticket's derived cache without another
    billable write.  The caller remains responsible for authorising the ticket
    and actor before reaching this domain boundary.
    """
    ticket_id = str(ticket.get("id") or "").strip()
    if not ticket_id:
        raise HTTPException(status_code=422, detail="A ticket ID is required for time entry")
    duration = _signed_minutes(minutes) if allow_negative_adjustment else _minutes(minutes)
    if abs(duration) < 1:
        raise HTTPException(status_code=422, detail="Minutes must be at least one")
    if duration < 0 and not allow_negative_adjustment:
        raise HTTPException(status_code=422, detail="Negative minutes are only permitted for an adjustment entry")
    source = str(source or "manual_time_entry").strip() or "manual_time_entry"
    source_reference = str(source_reference or "").strip() or None
    # Entry IDs are always generated at the server-side domain boundary.
    # Caller-provided IDs made record lookup/update ambiguous and let clients
    # collide with an existing financial record.
    record_id = str(uuid.uuid4())
    key = str(idempotency_key or "").strip() or (
        f"{source}:{source_reference}" if source_reference else f"{source}:{record_id}"
    )
    if len(key) > 255:
        raise HTTPException(status_code=422, detail="Idempotency key is too long")

    await ensure_ticket_time_indexes(database=database)
    existing = await database.time_entries.find_one(
        {"ticket_id": ticket_id, "idempotency_key": key}, {"_id": 0}
    )
    if existing:
        await sync_ticket_time_cache(ticket_id, database=database)
        return _canonical_display_entry(existing), False

    created_at = created_at or datetime.now(timezone.utc).isoformat()
    rate = _normalise_hourly_rate(hourly_rate)
    normalised_billable = _normalise_billable(billable)
    total_amount = round((duration / 60) * rate, 2) if normalised_billable else 0.0
    entry: dict[str, Any] = {
        "id": record_id,
        "ticket_id": ticket_id,
        "ticket_title": ticket.get("title"),
        "client_id": ticket.get("client_id"),
        "client_name": ticket.get("client_name"),
        "user_id": actor.get("id"),
        "user_name": actor.get("name") or actor.get("email"),
        "minutes": _clean_total(duration),
        # Read-only compatibility projections for established reporting and
        # integration consumers.  ``minutes`` and ``hourly_rate`` remain the
        # authoritative values; these fields are derived only at write time.
        "duration_minutes": _clean_total(duration),
        "hours": round(duration / 60, 3),
        "description": str(description or "").strip(),
        "hourly_rate": rate,
        "rate": rate,
        "total_amount": total_amount,
        "amount": total_amount,
        "billable": normalised_billable,
        "invoiced": False,
        "date": str(date or created_at[:10]),
        "created_at": created_at,
        "started_at": created_at,
        "source": source,
        "source_reference": source_reference or record_id,
        "idempotency_key": key,
        "time_entry_schema": CANONICAL_SCHEMA_VERSION,
    }
    if extra:
        # Explicit arguments above own the billing/security invariants; callers
        # may only supplement their source-specific evidence.
        entry.update(
            {
                key: value
                for key, value in extra.items()
                if key
                not in {
                    "id",
                    "ticket_id",
                    "client_id",
                    "client_name",
                    "user_id",
                    "user_name",
                    "minutes",
                    "duration_minutes",
                    "hours",
                    "hourly_rate",
                    "rate",
                    "total_amount",
                    "amount",
                    "billable",
                    "invoiced",
                    "source",
                    "source_reference",
                    "idempotency_key",
                    "time_entry_schema",
                    "started_at",
                }
            }
        )
    try:
        await database.time_entries.insert_one(dict(entry))
    except Exception:
        # A concurrent duplicate-key race is an idempotent replay only when
        # the canonical record is now visible under the same stable key.
        existing = await database.time_entries.find_one(
            {"ticket_id": ticket_id, "idempotency_key": key}, {"_id": 0}
        )
        if not existing:
            raise
        await sync_ticket_time_cache(ticket_id, database=database)
        return _canonical_display_entry(existing), False
    await sync_ticket_time_cache(ticket_id, database=database, calculated_at=created_at)
    return _canonical_display_entry(entry), True
