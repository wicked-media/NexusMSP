"""Canonical time and parsing helpers (Stage 1 refactor).

These replace the duplicated per-router ``_now`` / ``_now_iso`` / ``_parse_date``
definitions. Router modules import them under their historical local names so
call sites stay unchanged:

    from app.services.time_utils import now_iso as _now

Behaviour is deliberately identical to the definitions being consolidated:
UTC ISO-8601 strings, and tolerant parsing that returns ``None`` instead of
raising on absent or malformed input.
"""

from datetime import datetime, timezone


def now_iso() -> str:
    """Current UTC time as an ISO-8601 string."""
    return datetime.now(timezone.utc).isoformat()


def now() -> datetime:
    """Current UTC time as a datetime."""
    return datetime.now(timezone.utc)


def parse_date(value) -> datetime | None:
    """Tolerantly parse a date or timestamp string; None when absent or invalid."""
    if not value or not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y"):
            try:
                parsed = datetime.strptime(text, fmt)
                break
            except ValueError:
                continue
        else:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def iso_or_none(value: datetime | None) -> str | None:
    """ISO-format a datetime, passing None through unchanged."""
    return value.isoformat() if value else None
