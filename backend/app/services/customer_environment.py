"""Nexus Customer Environment Studio — one customer's operating context.

Foundation 1 of the three foundations in ``docs/NEXUS_FOUNDATIONS_BATCH_4.md``.

This module is pure policy: it turns already-fetched, already-authorised
evidence into the customer environment view and the "what changed, and could it
explain today's tickets" correlation. It performs no I/O, holds no customer data
and never claims a relationship it cannot show evidence for.

Two laws from ``docs/NEXUS_STUDIO_FLEET.md`` drive the shape of everything here:

* **Disclosed, never fabricated.** A dimension that was not measured returns
  ``value: None`` with the reason it was not measured. ``0`` and "not assessed"
  are different statements and the API never renders one as the other.
* **Evidence or nothing.** A correlation is a *candidate* built from a change
  that precedes a ticket and shares an identified target. Nexus never states
  that a change caused an incident — that is the technician's conclusion.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Mapping

# ============== DIMENSIONS ==============

# The six counts the Customer Environment overview reports. Order is the
# rendering order and is part of the contract the frontend tests pin.
ENVIRONMENT_DIMENSIONS: tuple[str, ...] = (
    "devices",
    "websites",
    "services",
    "open_tickets",
    "changes",
    "alerts",
)

# Which of the brief's three groups each dimension belongs to. The brief groups
# the customer view as Health / Technology / Commercial; a dimension belongs to
# exactly one group so a card is never rendered twice.
DIMENSION_META: dict[str, dict[str, str]] = {
    "devices": {
        "label": "Devices",
        "group": "technology",
        "question": "How many managed endpoints belong to this customer?",
    },
    "websites": {
        "label": "Websites",
        "group": "technology",
        "question": "How many web properties are under management?",
    },
    "services": {
        "label": "Services",
        "group": "commercial",
        "question": "How many contracted service lines are active?",
    },
    "open_tickets": {
        "label": "Open tickets",
        "group": "health",
        "question": "What operational work is currently open?",
    },
    "changes": {
        "label": "Changes",
        "group": "health",
        "question": "What is proposed, approved or applied right now?",
    },
    "alerts": {
        "label": "Alerts",
        "group": "health",
        "question": "What signals are currently asking for attention?",
    },
}

DIMENSION_GROUPS: tuple[str, ...] = ("health", "technology", "commercial")

# The evidence-chip vocabulary. A chip is only ever rendered with one of these
# states, and only ``verified``/``connected`` may be shown as a positive state.
SIGNAL_STATES = frozenset({"verified", "connected", "due", "attention", "not_measured"})

# Overall environment health is derived from measured signals only.
HEALTH_STATES = frozenset({"healthy", "attention", "unknown"})

INVESTIGATION_BOUNDARY = (
    "Correlation only: Nexus lists changes that precede a ticket and share an "
    "identified target. It never claims a change caused an incident — deciding "
    "that is the technician's job."
)

OVERVIEW_BOUNDARY = (
    "Counts are derived from records already scoped to this customer. A dimension "
    "that was not measured is reported as not measured with its reason, never as "
    "a reassuring zero."
)


def build_dimension(
    value: Any = None,
    *,
    assessed: bool = True,
    reason: str = "",
    source: str = "",
) -> dict[str, Any]:
    """One disclosed dimension value.

    An assessed dimension carries an integer (never a float, never a string). An
    unassessed dimension carries ``value: None`` *and* the reason it was not
    measured — silence is not an honest answer.
    """
    if assessed:
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError("an assessed dimension must carry an integer value")
        if value < 0:
            raise ValueError("a dimension count cannot be negative")
        return {"value": value, "assessed": True, "reason": "", "source": source}

    if not str(reason or "").strip():
        raise ValueError("an unassessed dimension must disclose the reason it was not measured")
    return {"value": None, "assessed": False, "reason": str(reason).strip(), "source": source}


def build_signal(signal_id: str, label: str, state: str, reason: str = "") -> dict[str, Any]:
    """One evidence chip (for example a backup recovery test)."""
    if state not in SIGNAL_STATES:
        raise ValueError(f"unknown signal state: {state}")
    if state == "not_measured" and not str(reason or "").strip():
        raise ValueError(f"signal '{signal_id}' must disclose why it was not measured")
    return {
        "id": str(signal_id),
        "label": str(label),
        "state": state,
        "reason": str(reason or "").strip(),
    }


def environment_health(signals: Iterable[Mapping[str, Any]]) -> dict[str, str]:
    """Overall health derived from measured signals, or ``unknown``.

    A single ``due`` or ``attention`` chip makes the environment ``attention``.
    No measured chip at all makes it ``unknown`` — which is the correct answer
    when Nexus holds no evidence, and never ``healthy`` by default.
    """
    states = [str(signal.get("state") or "") for signal in signals]
    measured = [state for state in states if state in {"verified", "connected", "due", "attention"}]
    if not measured:
        return {
            "state": "unknown",
            "reason": "No operational signal has been measured for this customer yet.",
        }
    if any(state in {"due", "attention"} for state in measured):
        return {
            "state": "attention",
            "reason": "One or more measured signals are due or need attention.",
        }
    return {"state": "healthy", "reason": "Every measured signal is verified or connected."}


def group_dimensions(dimensions: Mapping[str, Mapping[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Bucket the disclosed dimensions into the brief's Health/Technology/Commercial tabs."""
    grouped: dict[str, list[dict[str, Any]]] = {group: [] for group in DIMENSION_GROUPS}
    for dimension_id in ENVIRONMENT_DIMENSIONS:
        meta = DIMENSION_META[dimension_id]
        spec = dict(dimensions.get(dimension_id) or build_dimension(0, assessed=False,
                                                                  reason="Not collected for this view."))
        spec.update({"id": dimension_id, "label": meta["label"], "group": meta["group"],
                     "question": meta["question"]})
        grouped[meta["group"]].append(spec)
    return grouped


def build_overview(
    *,
    client_id: str,
    client_name: str,
    dimensions: Mapping[str, Mapping[str, Any]],
    signals: Iterable[Mapping[str, Any]] = (),
) -> dict[str, Any]:
    """The Customer Environment overview for one customer."""
    disclosed = {dimension_id: dict(dimensions.get(dimension_id) or {
        "value": None,
        "assessed": False,
        "reason": "This dimension was not collected for this customer.",
        "source": "",
    }) for dimension_id in ENVIRONMENT_DIMENSIONS}
    chips = [dict(signal) for signal in signals]
    return {
        "client_id": str(client_id),
        "client_name": str(client_name or ""),
        "dimensions": disclosed,
        "groups": group_dimensions(disclosed),
        "signals": chips,
        "health": environment_health(chips),
        "boundary": OVERVIEW_BOUNDARY,
    }


# ============== CHANGE / TICKET CORRELATION ==============

# Stable Nexus identifiers a change or a ticket may point at. Only these are
# used as correlation keys — never a name, hostname or other mutable value.
_TARGET_KEYS: tuple[str, ...] = (
    "target_id",
    "device_id",
    "site_id",
    "service_id",
    "asset_id",
    "website_id",
    "user_id",
)

_TIMESTAMP_KEYS: tuple[str, ...] = (
    "occurred_at",
    "changed_at",
    "applied_at",
    "created_at",
    "opened_at",
    "started_at",
)


def _parse_timestamp(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def record_timestamp(record: Mapping[str, Any]) -> datetime | None:
    """The first parseable timestamp on a change or ticket, or ``None``."""
    for key in _TIMESTAMP_KEYS:
        parsed = _parse_timestamp(record.get(key))
        if parsed is not None:
            return parsed
    return None


def correlation_targets(record: Mapping[str, Any]) -> set[str]:
    """The stable identifiers a change or ticket points at."""
    targets = {str(record[key]) for key in _TARGET_KEYS if record.get(key)}
    extra = record.get("affected_ids")
    if isinstance(extra, (list, tuple, set, frozenset)):
        targets.update(str(item) for item in extra if item)
    return {target for target in targets if target}


def correlate_changes_with_tickets(
    *,
    changes: Iterable[Mapping[str, Any]],
    open_tickets: Iterable[Mapping[str, Any]],
    now: datetime | None = None,
    window_hours: int = 24,
) -> dict[str, Any]:
    """Candidate explanations for open tickets, built from recent changes.

    A candidate is a *pair* — one change and one open ticket — where the change
    happened before the ticket was opened, inside the window, and both point at
    the same stable identifier. ``strength`` is ``strong`` when they share a
    target and ``weak`` when they only share a client. No candidate is ever
    reported without the identifiers and timestamps that produced it.
    """
    if window_hours <= 0:
        raise ValueError("window_hours must be positive")
    reference = now or datetime.now(timezone.utc)
    window_start = reference - timedelta(hours=window_hours)

    change_rows = []
    for change in changes:
        stamp = record_timestamp(change)
        change_rows.append({
            "id": str(change.get("id") or ""),
            "title": str(change.get("title") or change.get("name") or ""),
            "at": stamp,
            "targets": correlation_targets(change),
            "client_id": str(change.get("client_id") or ""),
            "status": str(change.get("status") or ""),
        })

    ticket_rows = []
    for ticket in open_tickets:
        stamp = record_timestamp(ticket)
        ticket_rows.append({
            "id": str(ticket.get("id") or ""),
            "title": str(ticket.get("title") or ""),
            "at": stamp,
            "targets": correlation_targets(ticket),
            "client_id": str(ticket.get("client_id") or ""),
        })

    candidates: list[dict[str, Any]] = []
    for ticket in ticket_rows:
        if ticket["at"] is None:
            continue
        for change in change_rows:
            if change["at"] is None:
                continue
            if not (window_start <= change["at"] <= ticket["at"]):
                continue
            shared = sorted(ticket["targets"] & change["targets"])
            same_client = bool(ticket["client_id"]) and ticket["client_id"] == change["client_id"]
            if shared:
                strength = "strong"
            elif same_client:
                strength = "weak"
            else:
                continue
            minutes = int((ticket["at"] - change["at"]).total_seconds() // 60)
            candidates.append({
                "ticket_id": ticket["id"],
                "ticket_title": ticket["title"],
                "ticket_opened_at": ticket["at"].isoformat(),
                "change_id": change["id"],
                "change_title": change["title"],
                "change_at": change["at"].isoformat(),
                "change_status": change["status"],
                "shared_targets": shared,
                "minutes_before_ticket": minutes,
                "strength": strength,
                "basis": (
                    f"Change {change['id']} was applied {minutes} minutes before ticket "
                    f"{ticket['id']} opened and both reference "
                    + (", ".join(shared) if shared else "the same customer")
                    + "."
                ),
            })

    order = {"strong": 0, "weak": 1}
    candidates.sort(key=lambda item: (order[item["strength"]], item["minutes_before_ticket"]))

    return {
        "window_hours": window_hours,
        "window_start": window_start.isoformat(),
        "changes_considered": len(change_rows),
        "open_tickets_considered": len(ticket_rows),
        "candidates": candidates,
        "boundary": INVESTIGATION_BOUNDARY,
    }


def build_investigation(
    *,
    client_id: str,
    changes: Iterable[Mapping[str, Any]],
    open_tickets: Iterable[Mapping[str, Any]],
    now: datetime | None = None,
    window_hours: int = 24,
) -> dict[str, Any]:
    """The full "what changed, and could it explain today's tickets" answer."""
    correlation = correlate_changes_with_tickets(
        changes=changes, open_tickets=open_tickets, now=now, window_hours=window_hours,
    )
    return {
        "client_id": str(client_id),
        "question": (
            "What changed in this customer's environment, and could any of those "
            "changes explain today's tickets?"
        ),
        **correlation,
    }
