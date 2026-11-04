"""Nexus Support Debt — the recurring work an MSP does because a source is broken.

Technical debt is code and configuration that will be expensive later. Support
debt is different: it is *labour the MSP performs again and again* because an
underlying process, deployment or agreement was never fixed. A technician
rebuilds the same Outlook profile, recreates the same accounts, chases the same
vendor approvals, and each repeat looks like ordinary ticket work in every
existing report.

This module turns that repetition into a management figure by grouping tickets
into stable work signatures and annualising the labour they consumed.

Two rules keep it honest:

* Nexus never invents a labour rate. A signature reports cost only over the time
  entries that actually carry recorded value, and discloses how complete that
  basis is. Hours are reported regardless.
* A signature is a *pattern*, not an accusation. It is keyed by the stable client
  ID and a normalised title shape, never by a technician, and it never suggests
  anybody performed the work badly.

Everything here is pure so the rules are directly testable; database access lives
in `app/routers/support_debt.py`.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

# Recurrence is judged over a rolling window and needs a real pattern before
# Nexus calls it support debt. Four occurrences of the same shape, not two.
SUPPORT_DEBT_WINDOW_DAYS = 90
SUPPORT_DEBT_MIN_OCCURRENCES = 4

# Response size cap and the size of the title shape used as a signature.
MAX_SIGNATURES = 60
_TOKEN_LIMIT = 8

# Words that describe the *report*, not the work. Dropping them lets "Printer
# offline again" and "Printer offline" collapse to the same signature.
NOISE_TOKENS = frozenset({
    "a", "again", "an", "and", "any", "are", "as", "at", "be", "but", "by",
    "can", "cannot", "cant", "customer", "does", "error", "errors", "for",
    "from", "further", "has", "have", "help", "her", "his", "in", "is", "issue",
    "issues", "it", "its", "keeps", "me", "my", "new", "not", "of", "on", "or",
    "our", "please", "problem", "problems", "still", "that", "the", "their",
    "them", "then", "there", "they", "this", "to", "tried", "urgent", "user",
    "was", "we", "when", "will", "with", "wont", "would", "you", "your",
})

# Letters only: a digit inside a word is an asset number or a version, not part
# of the work shape, so SERVER03 and SERVER04 must share a signature.
_TOKEN_PATTERN = re.compile(r"[a-z]+")


def _parse_ts(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def normalise_signature(title: str) -> str:
    """Reduce a ticket title to the work shape it represents.

    Numbers are dropped, so the same problem on SERVER03 and SERVER04 shares a
    signature; noise words are dropped, so wording differences do not hide a
    pattern; and the surviving words are ordered, so "Printer offline again" and
    "The printer is offline" are the same shape. An empty result means the title
    carried no usable shape.

    Known limitation: letters from an asset code the technician typed
    ("prn" in "PRN-04") survive and can split a pattern in two. Nexus would
    rather show a pattern the reviewer can check than quietly merge two
    different device families, and every contributed ticket ID is returned so a
    reviewer can see what actually matched.
    """
    tokens = sorted({
        token
        for token in _TOKEN_PATTERN.findall(str(title or "").lower())
        if token not in NOISE_TOKENS
    })
    return " ".join(tokens[:_TOKEN_LIMIT])


def _hours(entry: dict[str, Any]) -> float:
    minutes = entry.get("minutes")
    if minutes is not None:
        try:
            return max(0.0, float(minutes) / 60.0)
        except (TypeError, ValueError):
            pass
    try:
        return max(0.0, float(entry.get("hours") or 0))
    except (TypeError, ValueError):
        return 0.0


def _recorded_cost(entry: dict[str, Any], hours: float) -> float | None:
    """Value recorded for one time entry, or None when it carries no rate.

    Nexus uses what the entry actually holds — a recorded total, or hours at the
    recorded rate — and never substitutes a default hourly rate of its own.
    """
    for key in ("total_amount", "amount"):
        if entry.get(key) is not None:
            try:
                return max(0.0, float(entry[key]))
            except (TypeError, ValueError):
                return None
    rate = entry.get("rate")
    if rate is not None:
        try:
            return max(0.0, float(rate) * hours)
        except (TypeError, ValueError):
            return None
    return None


def labour_by_ticket(entries: Iterable[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Sum canonical time entries per ticket, disclosing the cost basis."""
    labour: dict[str, dict[str, Any]] = {}
    for entry in entries:
        ticket_id = str(entry.get("ticket_id") or "")
        if not ticket_id:
            continue
        bucket = labour.setdefault(ticket_id, {"minutes": 0.0, "hours": 0.0, "cost": 0.0, "costed_hours": 0.0, "entries": 0})
        hours = _hours(entry)
        bucket["minutes"] += hours * 60
        bucket["hours"] += hours
        bucket["entries"] += 1
        recorded = _recorded_cost(entry, hours)
        if recorded is not None:
            bucket["cost"] += recorded
            bucket["costed_hours"] += hours
    return labour


def support_debt_value(
    occurrences: int,
    hours: float,
    cost: float,
    *,
    window_days: int = SUPPORT_DEBT_WINDOW_DAYS,
) -> dict[str, Any]:
    """Annualise observed repetition into a comparable operational figure.

    The annual view is a straight projection of the observed window and says so;
    it is not a forecast. Cost is only projected when value was actually
    recorded for some of the work.
    """
    if not 1 <= int(window_days) <= 730:
        raise ValueError("Support-debt window must be between 1 and 730 days")
    times_per_year = 365.0 / int(window_days)
    repeats = int(occurrences or 0)
    value = {
        "annual_repeats": int(round(repeats * times_per_year)),
        "annual_hours": round(float(hours or 0) * times_per_year, 1),
        "projection_basis": f"Observed over {int(window_days)} days and projected to a year.",
    }
    if cost is None or float(cost or 0) <= 0:
        return {**value, "annual_cost": None}
    return {**value, "annual_cost": round(float(cost) * times_per_year, 2)}


def cost_basis(hours: float, costed_hours: float) -> str:
    """How complete the recorded-value basis is for one signature."""
    if float(costed_hours or 0) <= 0:
        return "none"
    if float(costed_hours) + 0.01 < float(hours or 0):
        return "partial"
    return "complete"


def support_debt_signatures(
    tickets: Iterable[dict[str, Any]],
    labour: dict[str, dict[str, Any]] | None = None,
    *,
    min_occurrences: int = SUPPORT_DEBT_MIN_OCCURRENCES,
    window_days: int = SUPPORT_DEBT_WINDOW_DAYS,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    """Group tickets into recurring work signatures in the observation window.

    Keyed by stable client ID plus the normalised title shape. A ticket with no
    usable title shape or no creation date cannot be dated or matched, so it is
    left out rather than guessed at.
    """
    current = now or datetime.now(timezone.utc)
    cutoff = current - timedelta(days=int(window_days))
    buckets: dict[tuple[str, str], dict[str, Any]] = {}

    for ticket in tickets:
        signature = normalise_signature(ticket.get("title"))
        if not signature:
            continue
        created = _parse_ts(ticket.get("created_at"))
        if created is None or created < cutoff or created > current:
            continue
        client_id = str(ticket.get("client_id") or "")
        key = (client_id, signature)
        bucket = buckets.setdefault(
            key,
            {
                "client_id": client_id,
                "client_name": str(ticket.get("client_name") or ""),
                "signature": signature,
                "label": str(ticket.get("title") or ""),
                "occurrences": 0,
                "ticket_ids": [],
                "hours": 0.0,
                "cost": 0.0,
                "costed_hours": 0.0,
                "first_seen": None,
                "last_seen": None,
                "categories": set(),
            },
        )
        bucket["occurrences"] += 1
        if len(bucket["ticket_ids"]) < 12:
            bucket["ticket_ids"].append(str(ticket.get("id") or ""))
        bucket["label"] = str(ticket.get("title") or bucket["label"])
        bucket["first_seen"] = min(filter(None, [bucket["first_seen"], created.isoformat()]))
        bucket["last_seen"] = max(filter(None, [bucket["last_seen"], created.isoformat()]))
        if ticket.get("category"):
            bucket["categories"].add(str(ticket["category"]))

        ticket_labour = (labour or {}).get(str(ticket.get("id") or ""))
        if ticket_labour:
            bucket["hours"] += float(ticket_labour.get("hours") or 0)
            bucket["cost"] += float(ticket_labour.get("cost") or 0)
            bucket["costed_hours"] += float(ticket_labour.get("costed_hours") or 0)

    signatures: list[dict[str, Any]] = []
    for bucket in buckets.values():
        if bucket["occurrences"] < int(min_occurrences):
            continue
        basis = cost_basis(bucket["hours"], bucket["costed_hours"])
        value = support_debt_value(
            bucket["occurrences"],
            bucket["hours"],
            bucket["cost"] if basis != "none" else None,
            window_days=window_days,
        )
        signatures.append(
            {
                "client_id": bucket["client_id"],
                "client_name": bucket["client_name"],
                "signature": bucket["signature"],
                "label": bucket["label"],
                "occurrences": bucket["occurrences"],
                "ticket_ids": bucket["ticket_ids"],
                "hours": round(bucket["hours"], 1),
                "cost": round(bucket["cost"], 2) if basis != "none" else None,
                "cost_basis": basis,
                "categories": sorted(bucket["categories"]),
                "first_seen": bucket["first_seen"],
                "last_seen": bucket["last_seen"],
                "window_days": int(window_days),
                "source_fix": (
                    "Remove the source rather than scheduling the work again: fix the deployment, "
                    "the process or the agreement that keeps recreating this ticket."
                ),
                **value,
            }
        )

    signatures.sort(
        key=lambda item: (
            -(item["annual_cost"] or 0),
            -item["annual_hours"],
            -item["annual_repeats"],
            item["signature"],
        )
    )
    return signatures[:MAX_SIGNATURES]


def support_debt_totals(signatures: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """MSP-wide support-debt figures, with the cost basis disclosed."""
    rows = list(signatures)
    costed = [row for row in rows if row.get("annual_cost") is not None]
    return {
        "signatures": len(rows),
        "recurring_tickets": sum(int(row.get("occurrences") or 0) for row in rows),
        "annual_hours": round(sum(float(row.get("annual_hours") or 0) for row in rows), 1),
        "annual_cost": round(sum(float(row["annual_cost"]) for row in costed), 2) if costed else None,
        "costed_signatures": len(costed),
        "uncosted_signatures": len(rows) - len(costed),
    }
