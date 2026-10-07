"""Normalisation of Yeastar CDR rows into one stable Nexus shape.

The original call-log route and the Voice service-desk explorer read the same
provider records, so the field mapping lives here rather than in two routes
that would drift apart. Provider field names vary by P-Series release and call
type, so every mapping is defensive: an absent field becomes an empty value,
never a guess.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

ANSWERED = "answered"
MISSED = "missed"
FAILED = "failed"

# Dispositions that mean a caller reached the queue or ring group and was not
# answered. Kept separate from MISSED because the service desk treats an
# abandoned call as a different obligation from a missed one.
ABANDONED_DISPOSITIONS = frozenset({"CANCELLED", "CANCELED", "ABANDONED", "ABANDON"})


def split_party(value: Any) -> tuple[str, str]:
    """Split Yeastar's ``Name<number>`` party format into name and number."""
    text = str(value or "").strip()
    if "<" in text and ">" in text:
        name, remainder = text.split("<", 1)
        return name.strip(), remainder.rstrip(">").strip()
    return text, text


def normalise_disposition(disposition: Any) -> str:
    """Map a provider disposition onto the vocabulary the Voice UI uses.

    An unrecognised value is lower-cased rather than coerced into a known
    state, so a provider-side change shows up as itself instead of silently
    inflating the missed-call count.
    """
    value = str(disposition or "").strip().upper()
    if value == "ANSWERED":
        return ANSWERED
    if value in {"NO ANSWER", "NOANSWER"}:
        return MISSED
    if value == "FAILED":
        return FAILED
    return value.lower()


def is_abandoned(row: dict) -> bool:
    """Whether this row records a caller who gave up before being answered."""
    disposition = str((row or {}).get("disposition") or "").strip().upper()
    return disposition in ABANDONED_DISPOSITIONS


def direction_for(call_type: Any) -> str:
    value = str(call_type or "").strip().lower()
    if value in {"inbound", "outbound"}:
        return value
    return "internal"


def _as_int(value: Any) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def _as_optional_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def normalise_cdr(row: dict) -> dict:
    """Map one provider CDR row onto the Nexus call-history shape."""
    caller_name, caller = split_party(row.get("call_from"))
    callee_name, callee = split_party(row.get("call_to"))
    duration = _as_int(row.get("duration"))
    talking = _as_int(row.get("billsec", row.get("talk_duration", duration)))
    return {
        "id": str(row.get("id", row.get("uid", ""))),
        "caller": caller,
        "caller_name": caller_name if caller_name != caller else caller,
        "callee": callee,
        "callee_name": callee_name if callee_name != callee else callee,
        "direction": direction_for(row.get("call_type")),
        "status": normalise_disposition(row.get("disposition")),
        "duration": duration,
        "talking_time": talking,
        # Queue wait is reported inconsistently across P-Series releases. It is
        # surfaced only when the PBX sent one: inferring a wait from the total
        # duration would overstate how long a customer actually waited.
        "wait_time": _as_optional_int(row.get("wait_time", row.get("ring_time"))),
        "recording": bool(row.get("recording", "")),
        "timestamp": row.get("time") or datetime.now(timezone.utc).isoformat(),
    }


def normalise_cdr_rows(rows: Any) -> list[dict]:
    """Normalise a provider page of CDR rows, ignoring malformed entries."""
    if not isinstance(rows, list):
        return []
    return [normalise_cdr(row) for row in rows if isinstance(row, dict)]
