"""Owner-grade business intelligence for NexusMSP.

CEO Mode deliberately sits above the operational workspaces. It does not
invent accounting profit, churn probability, or staff activity. Instead it
combines attributable Nexus records, labels incomplete evidence, explains the
calculation behind every insight, and deep-links the owner to the source
workspace where a decision can be made.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import re
from typing import Any
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request

from app.database import db
from app.routers.client_health import _compute_health
from app.services.action_permissions import require_action
from app.services.platform_foundation import emit_platform_event, request_correlation_id
from app.services.scope_permissions import assert_global_scope


router = APIRouter(tags=["Nexus Executive"])

WINDOW_DAYS = 30
# Only these periods are accepted. A free-form window would silently change what
# "capacity", "overdue" and "trend" mean from one request to the next.
WINDOW_OPTIONS = (30, 90, 365)
WINDOW_LABELS = {
    30: "Trailing 30 days",
    90: "Trailing 90 days",
    365: "Trailing 12 months",
}
ACTIVE_TICKET_STATES = {"open", "in_progress", "pending", "waiting"}
CLOSED_INVOICE_STATES = {"cancelled", "voided"}
OPEN_PO_STATES = {"draft", "submitted", "approved", "ordered", "partially_received", "open"}

# One full-time month, used only to model aggregate availability. It is not a
# presence measure and is never attributed to an individual.
HOURS_PER_FULL_TIME_MONTH = 160

# Days a renewal is considered urgent/soon look-ahead for the owner calendar.
RENEWAL_WINDOW_DAYS = 180
RENEWAL_URGENT_DAYS = 30
RENEWAL_SOON_DAYS = 90

# The owner-stated recurring-revenue goal. It is a recorded statement, not a
# derived figure, so it is bounded and validated like one.
MRR_TARGET_MAX = 1_000_000_000
MRR_TARGET_MONTH_MIN = (2000, 1)
MRR_TARGET_MONTH_MAX = (2100, 12)
MRR_TARGET_REVISION_LIMIT = 12


from app.services.time_utils import now_iso as _now


from app.services.number_utils import float_or_default_no_bool as _number


def _round_money(value: Any) -> float:
    return round(_number(value), 2)


from app.services.time_utils import parse_datetime_tolerant as _parse_datetime


def _within_window(row: dict, threshold: datetime, fields: tuple[str, ...]) -> bool:
    for field in fields:
        parsed = _parse_datetime(row.get(field))
        if parsed:
            return parsed >= threshold
    return False


def _monthly_value(contract: dict) -> float:
    value = _number(
        contract.get("monthly_value")
        or contract.get("mrr")
        or contract.get("value")
        or contract.get("total")
    )
    frequency = str(contract.get("billing_frequency") or contract.get("frequency") or "monthly").lower()
    if frequency in {"weekly", "week"}:
        return value * 4.33
    if frequency in {"fortnightly", "biweekly"}:
        return value * 2.165
    if frequency in {"quarterly", "quarter"}:
        return value / 3
    if frequency in {"semi-annual", "semiannual", "half-yearly"}:
        return value / 6
    if frequency in {"annual", "annually", "yearly"}:
        return value / 12
    return value


def _invoice_balance(invoice: dict) -> float:
    return max(0.0, _number(invoice.get("total")) - _number(invoice.get("amount_paid")))


def _direct_cost(row: dict) -> float | None:
    """Return only a cost explicitly stored on the source record."""
    for field in ("cost_amount", "internal_cost", "total_cost", "wholesale_total"):
        if row.get(field) is not None:
            return max(0.0, _number(row.get(field)))
    quantity = _number(row.get("quantity"), 1.0) or 1.0
    for field in ("unit_cost", "cost_price", "wholesale_cost", "internal_rate"):
        if row.get(field) is not None:
            return max(0.0, _number(row.get(field)) * quantity)
    return None


def _tenant_query(user: dict) -> dict:
    """Keep legacy local records available without leaking records across tenants."""
    tenant_id = str(user.get("tenant_id") or "nexus-local")
    if tenant_id == "nexus-local":
        return {"$or": [{"tenant_id": "nexus-local"}, {"tenant_id": {"$exists": False}}, {"tenant_id": None}]}
    return {"tenant_id": tenant_id}


def _and(*clauses: dict) -> dict:
    values = [clause for clause in clauses if clause]
    if not values:
        return {}
    if len(values) == 1:
        return values[0]
    return {"$and": values}


def _actor(user: dict) -> str:
    from app.services.identity_utils import actor_label

    return actor_label(user, "Unknown owner")


def build_profit_killers(
    clients: list[dict],
    client_mrr: dict[str, float],
    tickets: list[dict],
    time_entries: list[dict],
) -> list[dict]:
    """Expose disproportionate service burden without claiming accounting profit."""
    total_mrr = sum(client_mrr.values())
    burden_by_client: dict[str, dict[str, float]] = {}
    for client in clients:
        burden_by_client[str(client.get("id"))] = {
            "tickets": 0,
            "after_hours": 0,
            "hours": 0.0,
        }

    for ticket in tickets:
        client_id = str(ticket.get("client_id") or "")
        if client_id not in burden_by_client:
            continue
        burden_by_client[client_id]["tickets"] += 1
        occurred = _parse_datetime(ticket.get("created_at") or ticket.get("opened_at"))
        if occurred and (occurred.weekday() >= 5 or occurred.hour < 8 or occurred.hour >= 18):
            burden_by_client[client_id]["after_hours"] += 1

    for entry in time_entries:
        client_id = str(entry.get("client_id") or "")
        if client_id in burden_by_client:
            burden_by_client[client_id]["hours"] += _number(entry.get("minutes")) / 60

    total_burden = sum(
        item["tickets"] + item["after_hours"] * 2 + item["hours"] / 2
        for item in burden_by_client.values()
    )
    client_by_id = {str(client.get("id")): client for client in clients}
    findings = []
    for client_id, service in burden_by_client.items():
        burden_score = service["tickets"] + service["after_hours"] * 2 + service["hours"] / 2
        if burden_score <= 0 or total_burden <= 0:
            continue
        revenue_share = client_mrr.get(client_id, 0) / total_mrr if total_mrr else 0
        burden_share = burden_score / total_burden
        ratio = burden_share / revenue_share if revenue_share else None
        if not (revenue_share == 0 or burden_share >= revenue_share * 1.35):
            continue
        client = client_by_id.get(client_id, {})
        findings.append({
            "client_id": client_id,
            "client_name": client.get("name") or "Unknown client",
            "mrr": _round_money(client_mrr.get(client_id)),
            "revenue_share_pct": round(revenue_share * 100, 1),
            "service_burden_share_pct": round(burden_share * 100, 1),
            "burden_ratio": round(ratio, 1) if ratio is not None else None,
            "tickets_30d": int(service["tickets"]),
            "after_hours_tickets_30d": int(service["after_hours"]),
            "recorded_hours_30d": round(service["hours"], 1),
            "explanation": (
                f"{client.get('name') or 'This client'} represents {round(revenue_share * 100, 1)}% "
                f"of contract-backed MRR and {round(burden_share * 100, 1)}% of recorded service burden."
            ),
            "route": f"/clients?client={client_id}",
            "evidence": "Contract value, ticket creation times, and recorded time entries for the last 30 days.",
        })
    return sorted(
        findings,
        key=lambda item: (item["burden_ratio"] is not None, -(item["burden_ratio"] or 999)),
    )[:8]


def normalise_window(value: Any) -> int:
    """Accept only the reviewed periods; anything else falls back to the default."""
    if isinstance(value, bool):
        return WINDOW_DAYS
    try:
        requested = int(value)
    except (TypeError, ValueError):
        return WINDOW_DAYS
    return requested if requested in WINDOW_OPTIONS else WINDOW_DAYS


AGING_BUCKETS = (
    ("not_due", "Not yet due", 0, 0),
    ("overdue_1_30", "1-30 days overdue", 1, 30),
    ("overdue_31_60", "31-60 days overdue", 31, 60),
    ("overdue_61_90", "61-90 days overdue", 61, 90),
    ("overdue_90_plus", "90+ days overdue", 91, None),
)


def build_receivables_aging(invoices: list[dict], now: datetime) -> dict:
    """Age the open invoice ledger from the due date each invoice records.

    An invoice with no usable due date is never quietly treated as current: it
    gets its own bucket so the owner can see how much of the ledger carries no
    dated obligation. The outstanding total is the same figure the summary
    reports, so the two can never disagree.
    """
    buckets = {
        key: {"key": key, "label": label, "count": 0, "total": 0.0, "overdue": key != "not_due"}
        for key, label, _lower, _upper in AGING_BUCKETS
    }
    buckets["undated"] = {
        "key": "undated",
        "label": "No due date recorded",
        "count": 0,
        "total": 0.0,
        "overdue": False,
    }
    outstanding = 0.0
    overdue_total = 0.0
    oldest_overdue_days = 0
    for invoice in invoices:
        balance = _invoice_balance(invoice)
        if balance <= 0:
            continue
        outstanding += balance
        due_at = _parse_datetime(invoice.get("due_date"))
        if due_at is None:
            buckets["undated"]["count"] += 1
            buckets["undated"]["total"] += balance
            continue
        days_overdue = (now.date() - due_at.date()).days
        if days_overdue <= 0:
            key = "not_due"
        else:
            key = next(
                (
                    bucket_key
                    for bucket_key, _label, lower, upper in AGING_BUCKETS
                    if bucket_key != "not_due"
                    and days_overdue >= lower
                    and (upper is None or days_overdue <= upper)
                ),
                "overdue_90_plus",
            )
            overdue_total += balance
            oldest_overdue_days = max(oldest_overdue_days, days_overdue)
        buckets[key]["count"] += 1
        buckets[key]["total"] += balance

    ordered = [buckets[key] for key, _label, _lower, _upper in AGING_BUCKETS] + [buckets["undated"]]
    for bucket in ordered:
        bucket["total"] = _round_money(bucket["total"])
        bucket["share_pct"] = round(bucket["total"] / outstanding * 100, 1) if outstanding else None
    return {
        "state": "verified" if outstanding else "insufficient_evidence",
        "outstanding_total": _round_money(outstanding),
        "overdue_total": _round_money(overdue_total),
        "oldest_overdue_days": oldest_overdue_days or None,
        "buckets": ordered,
        "method": (
            "Open invoice balances aged from the due date recorded on each invoice. "
            "Bank balances, payment timing and disputed balances are not modelled."
        ),
    }


def build_revenue_concentration(client_mrr: dict[str, float], client_names: dict[str, str] | None = None) -> dict:
    """Share of contract-backed MRR held by the largest accounts.

    This is arithmetic over recorded contract value, not a churn forecast: it
    answers "how much of the run rate rests on one relationship" and nothing
    more. A tenant with no recorded recurring value is reported as
    insufficient evidence rather than as perfectly diversified.
    """
    names = client_names or {}
    positive = sorted(
        ((str(client_id), _number(value)) for client_id, value in client_mrr.items() if _number(value) > 0),
        key=lambda item: item[1],
        reverse=True,
    )
    total = sum(value for _client_id, value in positive)
    if not positive or total <= 0:
        return {
            "state": "insufficient_evidence",
            "total": 0.0,
            "client_count": 0,
            "top_client": None,
            "top_three_share_pct": None,
            "level": "insufficient_evidence",
            "detail": "No contract-backed recurring value is recorded, so concentration cannot be measured.",
            "method": "Contract-backed MRR share per client; client fallback MRR is used only where no contract value exists.",
        }
    top_client_id, top_mrr = positive[0]
    top_share = top_mrr / total * 100
    top_three_share = sum(value for _client_id, value in positive[:3]) / total * 100
    if top_share >= 40:
        level = "dependency"
    elif top_share >= 25:
        level = "concentrated"
    else:
        level = "spread"
    top_name = names.get(top_client_id) or "The largest client"
    return {
        "state": "verified",
        "total": _round_money(total),
        "client_count": len(positive),
        "top_client": {
            "client_id": top_client_id,
            "name": top_name,
            "mrr": _round_money(top_mrr),
            "share_pct": round(top_share, 1),
        },
        "top_three_share_pct": round(top_three_share, 1),
        "level": level,
        "detail": (
            f"{top_name} is {round(top_share, 1)}% of {money_hint(total)} contract-backed MRR; "
            f"the three largest accounts together are {round(top_three_share, 1)}%."
        ),
        "method": (
            "Recorded contract monthly value plus client fallback MRR. Share is arithmetic over current records; "
            "it is not a churn probability and does not predict when an account leaves."
        ),
    }


def money_hint(value: Any) -> str:
    """A compact dollar phrasing for generated sentences (not a formatter)."""
    return f"${_number(value):,.0f}"


def build_renewal_calendar(
    contracts: list[dict],
    clients: list[dict],
    now: datetime,
    window_days: int = RENEWAL_WINDOW_DAYS,
) -> dict:
    """Active contracts whose recorded end date falls inside the owner window."""
    names = {str(client.get("id")): (client.get("name") or "Unknown client") for client in clients}
    rows = []
    for contract in contracts:
        end_at = _parse_datetime(contract.get("end_date"))
        if end_at is None or not (now <= end_at <= now + timedelta(days=window_days)):
            continue
        client_id = str(contract.get("client_id") or "")
        days_until = max(0, (end_at.date() - now.date()).days)
        rows.append({
            "contract_id": str(contract.get("id") or ""),
            "client_id": client_id,
            "client_name": names.get(client_id) or contract.get("client_name") or "Unknown client",
            "value": _round_money(_monthly_value(contract)),
            "end_date": end_at.date().isoformat(),
            "days_until": days_until,
            "urgency": (
                "immediate" if days_until <= RENEWAL_URGENT_DAYS
                else "soon" if days_until <= RENEWAL_SOON_DAYS
                else "planned"
            ),
            "route": f"/clients?client={client_id}" if client_id else "/contracts",
        })
    rows.sort(key=lambda row: (row["days_until"], -row["value"]))
    return {
        "state": "verified" if rows else "insufficient_evidence",
        "window_days": window_days,
        "total_value": _round_money(sum(row["value"] for row in rows)),
        "rows": rows[:12],
        "method": (
            f"Active contracts with a recorded end date inside {window_days} days, ordered by date then value. "
            "Contracts without an end date are not listed and are not assumed to be evergreen."
        ),
    }


def build_revenue_trend(invoices: list[dict], now: datetime, months: int = 6) -> dict:
    """Invoiced and collected totals per month, from invoice records only.

    The month is the invoice's own created date. A month with no invoice rows is
    reported as no evidence rather than as a zero-revenue month.
    """
    buckets: dict[str, dict] = {}
    for offset in range(months - 1, -1, -1):
        month_start = (now.replace(day=1) - timedelta(days=offset * 30)).replace(day=1)
        buckets[month_start.strftime("%Y-%m")] = {
            "key": month_start.strftime("%Y-%m"),
            "label": month_start.strftime("%b %Y"),
            "invoiced": 0.0,
            "collected": 0.0,
            "count": 0,
        }
    for invoice in invoices:
        if str(invoice.get("status") or "").lower() in CLOSED_INVOICE_STATES:
            continue
        raised_at = _parse_datetime(invoice.get("created_at") or invoice.get("due_date"))
        if raised_at is None:
            continue
        bucket = buckets.get(raised_at.strftime("%Y-%m"))
        if bucket is None:
            continue
        bucket["invoiced"] += _number(invoice.get("total"))
        bucket["collected"] += _number(invoice.get("amount_paid"))
        bucket["count"] += 1
    series = list(buckets.values())
    for bucket in series:
        bucket["invoiced"] = _round_money(bucket["invoiced"])
        bucket["collected"] = _round_money(bucket["collected"])
    recorded = [bucket for bucket in series if bucket["count"]]
    return {
        "state": "verified" if len(recorded) >= 2 else "insufficient_evidence",
        "months": series,
        "recorded_months": len(recorded),
        "method": (
            "Invoiced and paid totals per month, keyed on the invoice's recorded created date. "
            "A month with no invoice records is shown as no evidence, not as zero revenue."
        ),
    }


def normalise_mrr_target(payload: dict | None) -> dict:
    """Validate the goal an owner recorded as their recurring-revenue target.

    A goal is only meaningful with an amount, so the amount is required and
    bounded. The target month is optional: without it progress is still
    measurable, but no pace can honestly be stated.
    """
    payload = payload or {}
    raw_target = payload.get("target_mrr")
    if raw_target in (None, ""):
        raise ValueError("A monthly recurring revenue target is required")
    target_mrr = _number(raw_target)
    if not 0 < target_mrr <= MRR_TARGET_MAX:
        raise ValueError("The MRR goal must be greater than $0 and at most $1,000,000,000")
    raw_month = str(payload.get("target_month") or "").strip()
    target_month = None
    if raw_month:
        match = re.fullmatch(r"(\d{4})-(\d{2})", raw_month)
        if not match:
            raise ValueError("The target month must be recorded as YYYY-MM")
        year, month = int(match.group(1)), int(match.group(2))
        if not 1 <= month <= 12:
            raise ValueError("The target month must be a real calendar month")
        if not MRR_TARGET_MONTH_MIN <= (year, month) <= MRR_TARGET_MONTH_MAX:
            raise ValueError("The target month must be between 2000-01 and 2100-12")
        target_month = f"{year:04d}-{month:02d}"
    return {
        "target_mrr": round(target_mrr, 2),
        "target_month": target_month,
        "note": str(payload.get("note") or "").strip()[:280],
    }


def _target_month_label(target_month: str | None) -> str | None:
    if not target_month:
        return None
    try:
        year, month = (int(part) for part in str(target_month).split("-"))
        return datetime(year, month, 1).strftime("%b %Y")
    except (TypeError, ValueError):
        return None


def _quality_state(state: dict, key: str) -> str:
    """The evidence state the briefing already published for one source."""
    return next(
        (str(item.get("state") or "missing") for item in (state or {}).get("data_quality") or [] if item.get("id") == key),
        "missing",
    )


def build_mrr_target_progress(target: dict | None, current_mrr: Any, now: datetime) -> dict:
    """How far the current run rate is from the goal the owner recorded.

    The comparison is arithmetic over the *same* contract-backed MRR the rest of
    the briefing reports, so the two figures can never disagree. A pace figure is
    produced only when the owner recorded a target month and whole months
    actually remain, and it is labelled as the required step rather than as a
    forecast. With no recorded goal nothing is assumed: progress is absent, not
    zero.

    The recorded goal also carries the contract-backed run rate observed when it
    was recorded, so progress is stated both as the distance to the target and as
    the growth achieved since the goal was set. That starting line is a recorded
    snapshot, not a second authority: it is captured from the same figure the
    cockpit reports, it is absent when no revenue evidence existed at record time,
    and a revision never rewrites it.
    """
    current = max(0.0, _number(current_mrr))
    absent = {
        "state": "not_recorded",
        "target_mrr": None,
        "target_month": None,
        "target_month_label": None,
        "note": "",
        "recorded_at": None,
        "recorded_by": None,
        "current_mrr": _round_money(current),
        "starting_mrr": None,
        "starting_recorded_at": None,
        "growth": None,
        "growth_pct": None,
        "progress_pct": None,
        "gap": None,
        "months_remaining": None,
        "required_monthly_growth": None,
        "required_growth_pct_per_month": None,
        "revisions": [],
        "method": (
            "Progress is contract-backed MRR divided by the revenue goal the owner recorded. "
            "It is arithmetic over current records, not a forecast, and no goal is assumed when none is recorded. "
            "Growth is measured from the run rate recorded with the goal, which is a snapshot of the same figure, "
            "not a second source of revenue truth."
        ),
    }
    if not target or target.get("target_mrr") is None:
        return absent
    target_mrr = max(0.0, _number(target.get("target_mrr")))
    target_month = str(target.get("target_month") or "") or None
    gap = round(target_mrr - current, 2)
    achieved = current >= target_mrr
    progress_pct = round(current / target_mrr * 100, 1) if target_mrr > 0 else None
    months_remaining = None
    if target_month:
        year, month = (int(part) for part in target_month.split("-"))
        months_remaining = (year - now.year) * 12 + (month - now.month)
    if achieved:
        status = "achieved"
    elif months_remaining is not None and months_remaining < 0:
        # The goal month has passed without the run rate reaching it. Reporting
        # that as "behind" would imply time is left that is not there.
        status = "overdue"
    else:
        status = "in_progress"
    required_monthly_growth = None
    required_growth_pct_per_month = None
    if not achieved and gap > 0 and months_remaining is not None and months_remaining > 0:
        required_monthly_growth = round(gap / months_remaining, 2)
        if current > 0:
            required_growth_pct_per_month = round(gap / months_remaining / current * 100, 1)
    raw_starting = target.get("starting_mrr")
    # An absent starting line is reported as absent. Treating it as $0 would state
    # growth from a figure the owner never recorded, so no growth is stated at all.
    starting_mrr = max(0.0, _number(raw_starting)) if raw_starting is not None else None
    growth = round(current - starting_mrr, 2) if starting_mrr is not None else None
    growth_pct = (
        round(growth / starting_mrr * 100, 1)
        if starting_mrr is not None and starting_mrr > 0 and growth is not None
        else None
    )
    return {
        **absent,
        "state": status,
        "target_mrr": _round_money(target_mrr),
        "target_month": target_month,
        "target_month_label": _target_month_label(target_month),
        "note": str(target.get("note") or ""),
        "recorded_at": target.get("recorded_at") or target.get("created_at"),
        "recorded_by": target.get("recorded_by") or target.get("created_by"),
        "current_mrr": _round_money(current),
        "starting_mrr": _round_money(starting_mrr) if starting_mrr is not None else None,
        "starting_recorded_at": target.get("starting_recorded_at"),
        "growth": growth,
        "growth_pct": growth_pct,
        "progress_pct": progress_pct,
        "gap": gap,
        "months_remaining": months_remaining,
        "required_monthly_growth": required_monthly_growth,
        "required_growth_pct_per_month": required_growth_pct_per_month,
        "revisions": [
            {
                "target_mrr": _round_money(row.get("target_mrr")),
                "target_month": row.get("target_month"),
                "note": str(row.get("note") or ""),
                "starting_mrr": row.get("starting_mrr"),
                "changed_at": row.get("changed_at"),
                "changed_by": row.get("changed_by"),
            }
            for row in (target.get("revisions") or [])
            if isinstance(row, dict)
        ],
    }


def _goal_growth_phrase(goal: dict) -> str | None:
    """One self-contained clause stating movement since the goal was recorded.

    The growth line exists only because the recorded goal captured a starting run
    rate. A goal recorded without one states no growth, rather than measuring the
    run rate against a starting point nobody recorded, and no movement is ever
    reported as a bare "growth of $0".
    """
    growth = goal.get("growth")
    if growth is None or goal.get("starting_mrr") is None:
        return None
    starting = f"the {money_hint(goal.get('starting_mrr'))} run rate recorded with the goal"
    if growth == 0:
        return f"no change from {starting}"
    pct = goal.get("growth_pct")
    pct_clause = f" ({'+' if growth > 0 else '-'}{abs(pct)}%)" if pct is not None else ""
    verb = "growth of" if growth > 0 else "a fall of"
    return f"{verb} {money_hint(abs(growth))}{pct_clause} from {starting}"


def build_board_brief(
    summary: dict,
    risks: list[dict],
    profit_killers: list[dict],
    quality: list[dict],
    mrr_target: dict | None = None,
) -> dict:
    critical_count = sum(1 for item in risks if item.get("severity") == "critical")
    headline = (
        f"{critical_count} critical owner decision{'s' if critical_count != 1 else ''} need attention."
        if critical_count
        else "No critical owner decisions are currently evidenced."
    )
    wins = []
    if summary.get("collection_rate") is not None and summary["collection_rate"] >= 90:
        wins.append(f"Recorded invoice collection is {summary['collection_rate']}%.")
    if summary.get("average_client_health") is not None and summary["average_client_health"] >= 80:
        wins.append(f"Average assessed client health is {summary['average_client_health']}.")
    if summary.get("at_risk_clients", 0) == 0 and summary.get("assessed_clients", 0):
        wins.append("No assessed clients currently fall below the at-risk health threshold.")
    goal = mrr_target or {}
    growth_clause = _goal_growth_phrase(goal)
    if goal.get("state") == "achieved":
        wins.append(
            f"The recorded owner goal of {money_hint(goal.get('target_mrr'))} MRR is met "
            f"({goal.get('progress_pct')}% of target)"
            + (f", with {growth_clause}." if growth_clause else ".")
        )
    if not wins:
        wins.append("The briefing is current and every statement links back to retained Nexus evidence.")

    decisions = []
    if profit_killers:
        decisions.append(f"Review the commercial fit and service design for {profit_killers[0]['client_name']}.")
    decisions.extend(item.get("decision") for item in risks[:3] if item.get("decision"))
    if not decisions:
        decisions.append("Confirm the current operating plan and retain this briefing as the monthly baseline.")

    projections = []
    if summary.get("mrr") is not None:
        projections.append(f"Current contract-backed run rate is ${summary['mrr']:,.0f} MRR.")
    if summary.get("net_cash_30d") is not None:
        direction = "positive" if summary["net_cash_30d"] >= 0 else "negative"
        projections.append(f"Recorded 30-day receivables less open purchase commitments are {direction} ${abs(summary['net_cash_30d']):,.0f}.")
    if goal.get("state") == "in_progress":
        by_when = f" by {goal.get('target_month_label')}" if goal.get("target_month_label") else ""
        projections.append(
            f"The recorded owner goal is {money_hint(goal.get('target_mrr'))} MRR{by_when}; "
            f"contract-backed MRR is {goal.get('progress_pct')}% of it"
            + (f", {growth_clause}." if growth_clause else ".")
        )
    elif goal.get("state") == "overdue":
        projections.append(
            f"The recorded owner goal of {money_hint(goal.get('target_mrr'))} MRR by "
            f"{goal.get('target_month_label')} is not met ({goal.get('progress_pct')}% of target)."
        )
    missing = [item["label"] for item in quality if item.get("state") != "verified"]
    if missing:
        projections.append(f"Forecast confidence is constrained by: {', '.join(missing[:3])}.")

    return {
        "headline": headline,
        "wins": wins[:4],
        "risks": [item["title"] for item in risks[:4]] or ["No current critical or high-risk evidence."],
        "decisions": decisions[:4],
        "outlook": projections[:4],
        "method": "Deterministic briefing from current Nexus records; it is not an accounting opinion or an autonomous decision.",
    }


def normalise_scenario(payload: dict | None) -> dict:
    payload = payload or {}
    pricing_change = _number(payload.get("pricing_change_pct"))
    if not -25 <= pricing_change <= 25:
        raise ValueError("Pricing change must be between -25% and 25%")
    new_monthly_cost = _number(payload.get("new_monthly_cost"))
    if not 0 <= new_monthly_cost <= 1_000_000:
        raise ValueError("New monthly cost must be between $0 and $1,000,000")
    cash_reserve = payload.get("cash_reserve")
    if cash_reserve in (None, ""):
        normalised_cash_reserve = None
    else:
        normalised_cash_reserve = _number(cash_reserve)
        if not 0 <= normalised_cash_reserve <= 1_000_000_000:
            raise ValueError("Cash reserve must be between $0 and $1,000,000,000")
    return {
        "name": str(payload.get("name") or "Owner scenario").strip()[:100],
        "lost_client_id": str(payload.get("lost_client_id") or "").strip() or None,
        "pricing_change_pct": round(pricing_change, 1),
        "new_monthly_cost": round(new_monthly_cost, 2),
        "cash_reserve": round(normalised_cash_reserve, 2) if normalised_cash_reserve is not None else None,
    }


def build_executive_scenario(
    baseline: dict,
    client_mrr: dict[str, float],
    clients: list[dict],
    scenario: dict,
) -> dict:
    base_mrr = _number(baseline.get("mrr"))
    lost_client_id = scenario.get("lost_client_id")
    lost_mrr = _number(client_mrr.get(lost_client_id)) if lost_client_id else 0.0
    remaining_mrr = max(0.0, base_mrr - lost_mrr)
    pricing_delta = remaining_mrr * _number(scenario.get("pricing_change_pct")) / 100
    projected_mrr = max(0.0, remaining_mrr + pricing_delta)
    new_monthly_cost = _number(scenario.get("new_monthly_cost"))
    base_direct_cost = baseline.get("recorded_direct_cost")
    projected_contribution = (
        projected_mrr - _number(base_direct_cost) - new_monthly_cost
        if base_direct_cost is not None
        else None
    )
    monthly_net = projected_contribution
    cash_reserve = scenario.get("cash_reserve")
    runway = (
        round(_number(cash_reserve) / abs(monthly_net), 1)
        if cash_reserve is not None and monthly_net is not None and monthly_net < 0
        else None
    )
    client_name = next(
        (client.get("name") for client in clients if str(client.get("id")) == lost_client_id),
        None,
    )
    return {
        "name": scenario["name"],
        "will_execute": False,
        "baseline_mrr": _round_money(base_mrr),
        "projected_mrr": _round_money(projected_mrr),
        "mrr_delta": _round_money(projected_mrr - base_mrr),
        "lost_client": {"id": lost_client_id, "name": client_name, "mrr": _round_money(lost_mrr)} if lost_client_id else None,
        "pricing_change_pct": scenario["pricing_change_pct"],
        "pricing_delta": _round_money(pricing_delta),
        "new_monthly_cost": _round_money(new_monthly_cost),
        "projected_service_contribution": _round_money(projected_contribution) if projected_contribution is not None else None,
        "cash_runway_months": runway,
        "assumptions": [
            "Contract-backed MRR is held constant except for the selected client loss and pricing change.",
            "The pricing change applies to remaining contract-backed MRR.",
            "New monthly cost begins immediately and is not capitalised.",
            "Tax, timing, financing, supplier inflation, and future sales are excluded.",
        ],
        "confidence": "modelled" if base_mrr > 0 else "insufficient_evidence",
        "warning": "This is a non-mutating planning model, not an accounting forecast.",
    }


async def _load_executive_state(user: dict, window_days: int = WINDOW_DAYS) -> dict:
    window_days = normalise_window(window_days)
    now = datetime.now(timezone.utc)
    threshold = now - timedelta(days=window_days)
    tenant_query = _tenant_query(user)
    clients = await db.clients.find(tenant_query, {"_id": 0}).sort("name", 1).to_list(2000)
    client_ids = [str(client.get("id")) for client in clients if client.get("id")]
    client_query = {"client_id": {"$in": client_ids}} if client_ids else {"client_id": {"$in": []}}

    (
        contracts,
        invoices,
        purchase_orders,
        time_entries,
        users,
        tickets,
        projects,
        approvals,
        contract_lines,
        subscriptions,
        snapshots,
        watchlist_rows,
        mrr_target_row,
    ) = await asyncio.gather(
        db.contracts.find(_and(client_query, {"status": "active"}), {"_id": 0}).to_list(10000),
        db.invoices.find(_and(client_query, {"is_split_parent": {"$ne": True}}), {"_id": 0}).to_list(20000),
        db.purchase_orders.find(tenant_query, {"_id": 0}).to_list(10000),
        db.time_entries.find(client_query, {"_id": 0}).to_list(20000),
        db.users.find(tenant_query, {"_id": 0}).to_list(2000),
        db.tickets.find(client_query, {"_id": 0}).to_list(20000),
        db.projects.find(client_query, {"_id": 0}).to_list(5000),
        db.approvals.find(tenant_query, {"_id": 0}).sort("created_at", -1).to_list(1000),
        db.contract_line_items.find(client_query, {"_id": 0}).to_list(20000),
        db.service_subscriptions.find(client_query, {"_id": 0}).to_list(20000),
        db.executive_board_snapshots.find({"tenant_id": str(user.get("tenant_id") or "nexus-local")}, {"_id": 0}).sort("created_at", -1).to_list(6),
        db.executive_watchlist.find(
            {
                "tenant_id": str(user.get("tenant_id") or "nexus-local"),
                "user_id": str(user.get("id") or ""),
            },
            {"_id": 0},
        ).sort("created_at", -1).to_list(100),
        db.executive_mrr_targets.find_one(
            {"tenant_id": str(user.get("tenant_id") or "nexus-local")},
            {"_id": 0},
        ),
    )

    # Legacy purchase orders are not always client-linked. Keep only current
    # tenant/client records when an ownership field exists.
    purchase_orders = [
        row for row in purchase_orders
        if not row.get("client_id") or str(row.get("client_id")) in client_ids
    ]
    recent_tickets = [
        row for row in tickets
        if _within_window(row, threshold, ("created_at", "opened_at", "date"))
    ]
    recent_entries = [
        row for row in time_entries
        if _within_window(row, threshold, ("date", "created_at", "started_at"))
    ]
    client_mrr = {client_id: 0.0 for client_id in client_ids}
    for contract in contracts:
        client_id = str(contract.get("client_id") or "")
        if client_id in client_mrr:
            client_mrr[client_id] += _monthly_value(contract)
    for client in clients:
        client_id = str(client.get("id") or "")
        if client_id and client_mrr.get(client_id, 0) <= 0 and client.get("mrr") is not None:
            client_mrr[client_id] = max(0.0, _number(client.get("mrr")))
    total_mrr = sum(client_mrr.values())
    mrr_target = build_mrr_target_progress(mrr_target_row, total_mrr, now)

    cost_rows = [*contract_lines, *subscriptions, *recent_entries]
    explicit_costs = [cost for row in cost_rows if (cost := _direct_cost(row)) is not None]
    direct_cost = sum(explicit_costs) if explicit_costs else None
    service_contribution = total_mrr - direct_cost if direct_cost is not None else None
    contribution_margin = (
        round(service_contribution / total_mrr * 100, 1)
        if service_contribution is not None and total_mrr > 0
        else None
    )

    live_invoices = [row for row in invoices if str(row.get("status") or "").lower() not in CLOSED_INVOICE_STATES]
    invoiced = sum(_number(row.get("total")) for row in live_invoices)
    collected = sum(_number(row.get("amount_paid")) for row in live_invoices)
    outstanding = sum(_invoice_balance(row) for row in live_invoices)
    overdue_rows = []
    incoming_30d = 0.0
    for invoice in live_invoices:
        if str(invoice.get("payment_status") or "").lower() == "paid":
            continue
        balance = _invoice_balance(invoice)
        due_at = _parse_datetime(invoice.get("due_date"))
        if due_at and due_at < now and balance > 0:
            overdue_rows.append(invoice)
        if balance > 0 and (due_at is None or due_at <= now + timedelta(days=30)):
            incoming_30d += balance
    open_pos = [
        row for row in purchase_orders
        if str(row.get("status") or "").lower() in OPEN_PO_STATES
    ]
    outgoing_30d = sum(
        _number(row.get("total") or row.get("total_amount") or row.get("amount"))
        for row in open_pos
    )
    net_cash_30d = incoming_30d - outgoing_30d
    collection_rate = round(collected / invoiced * 100, 1) if invoiced else None

    technicians = [
        row for row in users
        if str(row.get("role") or "").lower() in {"technician", "admin", "service_desk_manager"}
        and row.get("is_active", True) is not False
    ]
    recorded_hours = sum(_number(row.get("minutes")) for row in recent_entries) / 60
    billable_hours = sum(_number(row.get("minutes")) for row in recent_entries if row.get("billable")) / 60
    # Availability is modelled across the same window the evidence covers, so a
    # 90-day view is not divided by a single month of nominal capacity.
    available_hours = len(technicians) * HOURS_PER_FULL_TIME_MONTH * (window_days / 30)
    capacity_pct = round(recorded_hours / available_hours * 100, 1) if available_hours else None

    health_scores = await asyncio.gather(*[_compute_health(client, user) for client in clients]) if clients else []
    assessed_health = [row for row in health_scores if isinstance(row.get("health_score"), (int, float))]
    at_risk = [row for row in assessed_health if row["health_score"] < 50]
    average_health = (
        round(sum(row["health_score"] for row in assessed_health) / len(assessed_health), 1)
        if assessed_health
        else None
    )
    at_risk_mrr = sum(client_mrr.get(str(row.get("client_id")), 0) for row in at_risk)

    expiring_contracts = []
    for contract in contracts:
        end_at = _parse_datetime(contract.get("end_date"))
        if end_at and now <= end_at <= now + timedelta(days=RENEWAL_SOON_DAYS):
            expiring_contracts.append(contract)
    overdue_projects = [
        row for row in projects
        if str(row.get("status") or "").lower() not in {"complete", "completed", "cancelled", "closed"}
        and (due := _parse_datetime(row.get("due_date") or row.get("end_date")))
        and due < now
    ]
    pending_approvals = [row for row in approvals if str(row.get("status") or "").lower() == "pending"]
    unbilled_entries = [
        row for row in recent_entries
        if row.get("billable") and not (row.get("invoice_id") or row.get("invoiced") or row.get("invoice_number"))
    ]

    client_names = {str(client.get("id")): (client.get("name") or "Unknown client") for client in clients}
    concentration = build_revenue_concentration(client_mrr, client_names)
    renewals = build_renewal_calendar(contracts, clients, now)
    receivables = build_receivables_aging(live_invoices, now)
    revenue_trend = build_revenue_trend(invoices, now)
    watchlist = [
        {
            "client_id": str(row.get("client_id") or ""),
            "client_name": client_names.get(str(row.get("client_id") or ""), "Unknown client"),
            "note": str(row.get("note") or ""),
            "created_at": row.get("created_at"),
        }
        for row in watchlist_rows
        if str(row.get("client_id") or "") in client_names
    ]

    risks = []
    if overdue_rows:
        overdue_value = sum(_invoice_balance(row) for row in overdue_rows)
        risks.append({
            "id": "overdue-receivables",
            "severity": "critical" if overdue_value >= max(total_mrr, 1) else "high",
            "title": f"${overdue_value:,.0f} is overdue across {len(overdue_rows)} invoice(s)",
            "detail": "Outstanding invoice balances with a recorded due date before today.",
            "decision": "Assign collection ownership and confirm disputed invoices.",
            "route": "/invoices",
            "source": "Invoice ledger",
        })
    if at_risk:
        risks.append({
            "id": "client-health-risk",
            "severity": "critical" if at_risk_mrr >= total_mrr * 0.25 and total_mrr else "high",
            "title": f"{len(at_risk)} assessed client(s) are at risk",
            "detail": f"${at_risk_mrr:,.0f} MRR is attached to clients below the evidence-weighted health threshold.",
            "decision": "Review the highest-value at-risk client and assign an owner.",
            "route": "/client-insights?tab=client-health",
            "source": "Client Health",
        })
    if concentration["level"] == "dependency":
        top = concentration["top_client"] or {}
        risks.append({
            "id": "revenue-concentration",
            "severity": "high",
            "title": f"{top.get('share_pct')}% of contract MRR sits with one client ({top.get('name')})",
            "detail": concentration["detail"],
            "decision": "Agree a diversification or retention plan for the largest account.",
            "route": f"/clients?client={top.get('client_id')}" if top.get("client_id") else "/clients",
            "source": "Contract register",
        })
    if receivables["oldest_overdue_days"] and receivables["oldest_overdue_days"] > 90:
        risks.append({
            "id": "aged-receivables",
            "severity": "high",
            "title": f"Oldest overdue invoice is {receivables['oldest_overdue_days']} days past its due date",
            "detail": f"${receivables['overdue_total']:,.0f} is overdue in total across {sum(1 for bucket in receivables['buckets'] if bucket['overdue'] and bucket['count'])} ageing bucket(s).",
            "decision": "Decide write-off, payment plan, or escalation for debt older than 90 days.",
            "route": "/invoices",
            "source": "Invoice ledger",
        })
    if expiring_contracts:
        risks.append({
            "id": "contract-renewals",
            "severity": "high",
            "title": f"{len(expiring_contracts)} active contract(s) expire within {RENEWAL_SOON_DAYS} days",
            "detail": "Renewal dates are taken from active contract records.",
            "decision": "Confirm renewal ownership, pricing review, and client meeting dates.",
            "route": "/contracts",
            "source": "Contract register",
        })
    if overdue_projects:
        risks.append({
            "id": "overdue-projects",
            "severity": "high",
            "title": f"{len(overdue_projects)} project(s) have passed their recorded due date",
            "detail": "Open project records with a due date before today.",
            "decision": "Reforecast scope, delivery date, and commercial impact.",
            "route": "/projects",
            "source": "Projects",
        })
    if unbilled_entries:
        unbilled_value = sum(_number(row.get("total_amount")) for row in unbilled_entries)
        risks.append({
            "id": "unbilled-time",
            "severity": "high" if unbilled_value else "medium",
            "title": f"{len(unbilled_entries)} recent billable time entries have no invoice link",
            "detail": f"Recorded billable value: ${unbilled_value:,.0f}." if unbilled_value else "Recorded time needs billing review.",
            "decision": "Reconcile the entries before the next invoice run.",
            "route": "/billing-recon",
            "source": "Time entries",
        })
    if pending_approvals:
        risks.append({
            "id": "pending-approvals",
            "severity": "medium",
            "title": f"{len(pending_approvals)} owner or manager approval(s) are pending",
            "detail": "Pending approval records can delay procurement, discounts, and operational changes.",
            "decision": "Review the oldest or highest-value approval first.",
            "route": "/team-hub?tab=command&view=approvals",
            "source": "Approval ledger",
        })
    if mrr_target["state"] == "overdue":
        # The owner's own recorded goal has lapsed. Nexus reports it as an
        # evidenced miss rather than quietly dropping the goal from the view.
        risks.append({
            "id": "mrr-target-missed",
            "severity": "high",
            "title": (
                f"The recorded MRR goal of {money_hint(mrr_target['target_mrr'])} by "
                f"{mrr_target['target_month_label']} was not met"
            ),
            "detail": (
                f"Contract-backed MRR is {money_hint(total_mrr)}, "
                f"{mrr_target['progress_pct']}% of the goal the owner recorded."
            ),
            "decision": "Replan the goal, the sales motion, or the price book — the recorded target is now historical.",
            "route": "/executive",
            "source": "Owner goal",
        })
    severity_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    risks.sort(key=lambda item: severity_order.get(item["severity"], 9))

    profit_killers = build_profit_killers(clients, client_mrr, recent_tickets, recent_entries)
    health_by_id = {str(row.get("client_id")): row for row in health_scores}
    burden_by_id = {row["client_id"]: row for row in profit_killers}
    portfolio = []
    for client in clients:
        client_id = str(client.get("id"))
        health = health_by_id.get(client_id, {})
        burden = burden_by_id.get(client_id)
        portfolio.append({
            "client_id": client_id,
            "client_name": client.get("name") or "Unknown client",
            "mrr": _round_money(client_mrr.get(client_id)),
            "health_score": health.get("health_score"),
            "health_status": health.get("status") or "not_assessed",
            "evidence_coverage_pct": health.get("evidence_coverage_pct", 0),
            "service_burden_share_pct": burden.get("service_burden_share_pct") if burden else None,
            "tickets_30d": sum(1 for row in recent_tickets if str(row.get("client_id")) == client_id),
            "route": f"/clients?client={client_id}",
        })
    portfolio.sort(key=lambda row: (row["health_score"] is None, row["health_score"] or 101, -row["mrr"]))

    summary = {
        "mrr": _round_money(total_mrr),
        "arr": _round_money(total_mrr * 12),
        "service_contribution": _round_money(service_contribution) if service_contribution is not None else None,
        "contribution_margin_pct": contribution_margin,
        "recorded_direct_cost": _round_money(direct_cost) if direct_cost is not None else None,
        "net_cash_30d": _round_money(net_cash_30d),
        "collection_rate": collection_rate,
        "average_client_health": average_health,
        "assessed_clients": len(assessed_health),
        "total_clients": len(clients),
        "at_risk_clients": len(at_risk),
        "at_risk_mrr": _round_money(at_risk_mrr),
        "staff_capacity_pct": capacity_pct,
        "top_client_name": (concentration["top_client"] or {}).get("name"),
        "top_client_share_pct": (concentration["top_client"] or {}).get("share_pct"),
        "top_three_share_pct": concentration["top_three_share_pct"],
        "oldest_overdue_days": receivables["oldest_overdue_days"],
        "renewals_next_90d": sum(1 for row in renewals["rows"] if row["days_until"] <= RENEWAL_SOON_DAYS),
        "renewal_value_180d": renewals["total_value"],
        "watchlist_count": len(watchlist),
        "risk_count": len(risks),
        "critical_risk_count": sum(1 for item in risks if item["severity"] == "critical"),
    }
    quality = [
        {
            "id": "revenue",
            "label": "Recurring revenue",
            "state": "verified" if contracts or any(client.get("mrr") is not None for client in clients) else "missing",
            "detail": f"{len(contracts)} active contract records; client MRR is used only where a contract value is absent.",
        },
        {
            "id": "profit",
            "label": "Direct cost coverage",
            "state": "verified" if explicit_costs else "missing",
            "detail": f"{len(explicit_costs)} explicit cost records." if explicit_costs else "Add unit cost, wholesale cost, or internal cost data before treating contribution as profit.",
        },
        {
            "id": "health",
            "label": "Client health",
            "state": "verified" if len(assessed_health) == len(clients) and clients else "partial" if assessed_health else "missing",
            "detail": f"{len(assessed_health)} of {len(clients)} clients meet the independent-evidence threshold.",
        },
        {
            "id": "capacity",
            "label": "Team capacity",
            "state": "verified" if recent_entries and technicians else "partial" if technicians else "missing",
            "detail": (
                f"Aggregate recorded hours versus {int(HOURS_PER_FULL_TIME_MONTH * (window_days / 30))} hours "
                "per active service-team member across the selected period; not presence or productivity surveillance."
            ),
        },
        {
            "id": "cash",
            "label": "Cash outlook",
            "state": "verified" if live_invoices or open_pos else "missing",
            "detail": "Open receivables due within 30 days less current open purchase commitments; bank balance and tax are excluded.",
        },
        {
            "id": "concentration",
            "label": "Revenue concentration",
            "state": concentration["state"],
            "detail": concentration["detail"],
        },
        {
            "id": "mrr_target",
            "label": "Recorded revenue goal",
            "state": "verified" if mrr_target["state"] != "not_recorded" else "missing",
            "detail": (
                (
                    f"Goal of {money_hint(mrr_target['target_mrr'])} MRR"
                    + (f" by {mrr_target['target_month_label']}" if mrr_target["target_month_label"] else " with no target month")
                    + f"; progress is measured against the {money_hint(total_mrr)} contract-backed MRR reported above."
                    + (
                        f" The starting run rate recorded with the goal was {money_hint(mrr_target['starting_mrr'])}."
                        if mrr_target.get("starting_mrr") is not None
                        else " No starting run rate was recorded with the goal, so growth since it was set cannot be stated."
                    )
                )
                if mrr_target["state"] != "not_recorded"
                else "No owner revenue goal is recorded, so progress cannot be measured against one."
            ),
        },
        {
            "id": "renewals",
            "label": "Renewal calendar",
            "state": renewals["state"],
            "detail": (
                f"{len(renewals['rows'])} renewal(s) inside {RENEWAL_WINDOW_DAYS} days"
                + (f" worth {money_hint(renewals['total_value'])} monthly." if renewals["rows"] else "; no contract records an end date in that window.")
            ),
        },
    ]
    board_brief = build_board_brief(summary, risks, profit_killers, quality, mrr_target)
    return {
        "generated_at": _now(),
        "period": {
            "days": window_days,
            "label": WINDOW_LABELS[window_days],
            "options": [
                {"days": days, "label": WINDOW_LABELS[days]} for days in WINDOW_OPTIONS
            ],
        },
        "summary": summary,
        "financial": {
            "contract_mrr": _round_money(total_mrr),
            "invoiced_total": _round_money(invoiced),
            "collected_total": _round_money(collected),
            "outstanding_total": _round_money(outstanding),
            "overdue_total": _round_money(sum(_invoice_balance(row) for row in overdue_rows)),
            "incoming_30d": _round_money(incoming_30d),
            "open_po_commitments": _round_money(outgoing_30d),
            "net_cash_30d": _round_money(net_cash_30d),
            "recorded_direct_cost": _round_money(direct_cost) if direct_cost is not None else None,
            "service_contribution": _round_money(service_contribution) if service_contribution is not None else None,
            "contribution_margin_pct": contribution_margin,
        },
        "customers": {
            "total": len(clients),
            "assessed": len(assessed_health),
            "average_health": average_health,
            "at_risk": len(at_risk),
            "at_risk_mrr": _round_money(at_risk_mrr),
        },
        "team": {
            "active_service_team": len(technicians),
            "window_days": window_days,
            "recorded_hours": round(recorded_hours, 1),
            "billable_hours": round(billable_hours, 1),
            "available_hours_model": round(available_hours, 1),
            "capacity_pct": capacity_pct,
            "method": "Aggregate time evidence only. CEO Mode does not expose individual movement, breaks, or presence.",
        },
        "risk_items": risks[:10],
        "profit_killers": profit_killers,
        "portfolio": portfolio[:15],
        "board_brief": board_brief,
        "data_quality": quality,
        "receivables": receivables,
        "concentration": concentration,
        "renewals": renewals,
        "revenue_trend": revenue_trend,
        "watchlist": watchlist,
        "mrr_target": mrr_target,
        "recent_board_snapshots": snapshots,
        "model_context": {
            "client_mrr": {key: _round_money(value) for key, value in client_mrr.items()},
            "clients": [{"id": client.get("id"), "name": client.get("name")} for client in clients],
        },
    }


@router.get("/executive/overview")
async def executive_overview(
    request: Request,
    window: int | None = None,
    current_user: dict = Depends(require_action("executive.intelligence.view")),
):
    await assert_global_scope(current_user, operation="executive.intelligence.view", request=request)
    return await _load_executive_state(current_user, normalise_window(window))


async def _watchlist_entry(current_user: dict, client_id: str) -> dict | None:
    return await db.executive_watchlist.find_one(
        {
            "tenant_id": str(current_user.get("tenant_id") or "nexus-local"),
            "user_id": str(current_user.get("id") or ""),
            "client_id": client_id,
        },
        {"_id": 0},
    )


@router.get("/executive/watchlist")
async def list_executive_watchlist(
    request: Request,
    current_user: dict = Depends(require_action("executive.intelligence.view")),
):
    """The clients this owner has personally flagged, within their tenant only."""
    await assert_global_scope(current_user, operation="executive.intelligence.view", request=request)
    rows = await db.executive_watchlist.find(
        {
            "tenant_id": str(current_user.get("tenant_id") or "nexus-local"),
            "user_id": str(current_user.get("id") or ""),
        },
        {"_id": 0},
    ).sort("created_at", -1).to_list(100)
    tenant_query = _tenant_query(current_user)
    client_ids = {str(row.get("client_id") or "") for row in rows}
    names: dict[str, str] = {}
    if client_ids:
        clients = await db.clients.find(
            _and(tenant_query, {"id": {"$in": sorted(client_ids)}}),
            {"_id": 0, "id": 1, "name": 1},
        ).to_list(len(client_ids))
        names = {str(client.get("id")): (client.get("name") or "Unknown client") for client in clients}
    return {
        "watchlist": [
            {
                "client_id": str(row.get("client_id") or ""),
                "client_name": names.get(str(row.get("client_id") or "")),
                "note": str(row.get("note") or ""),
                "created_at": row.get("created_at"),
            }
            for row in rows
            if str(row.get("client_id") or "") in names
        ],
        "method": "A personal owner watchlist. It grants no access and changes no client record.",
    }


@router.post("/executive/watchlist")
async def add_executive_watchlist_entry(
    payload: dict,
    request: Request,
    current_user: dict = Depends(require_action("executive.watchlist.manage")),
):
    """Flag a client for owner attention. Idempotent per tenant, user and client."""
    await assert_global_scope(current_user, operation="executive.watchlist.manage", request=request)
    client_id = str((payload or {}).get("client_id") or "").strip()
    if not client_id:
        raise HTTPException(status_code=400, detail="A client is required")
    note = str((payload or {}).get("note") or "").strip()[:280]
    client = await db.clients.find_one(_and(_tenant_query(current_user), {"id": client_id}), {"_id": 0, "id": 1, "name": 1})
    if not client:
        # A client the caller cannot see inside their own tenant never becomes a watchlist row.
        raise HTTPException(status_code=404, detail="Client not found in this tenant")
    existing = await _watchlist_entry(current_user, client_id)
    if existing:
        if existing.get("note", "") == note:
            return {"created": False, "watchlist": {
                "client_id": client_id,
                "client_name": client.get("name"),
                "note": existing.get("note", ""),
                "created_at": existing.get("created_at"),
            }}
        await db.executive_watchlist.update_one(
            {"id": existing.get("id")},
            {"$set": {"note": note, "updated_at": _now()}},
        )
        existing["note"] = note
        return {"created": False, "watchlist": {
            "client_id": client_id,
            "client_name": client.get("name"),
            "note": note,
            "created_at": existing.get("created_at"),
        }}
    record = {
        "id": str(uuid.uuid4()),
        "tenant_id": str(current_user.get("tenant_id") or "nexus-local"),
        "user_id": str(current_user.get("id") or ""),
        "client_id": client_id,
        "note": note,
        "created_at": _now(),
        "created_by": _actor(current_user),
        "correlation_id": request_correlation_id(request),
    }
    await db.executive_watchlist.insert_one(record.copy())
    await emit_platform_event(
        subject="executive.watchlist.changed",
        source="nexus.executive",
        payload={"client_id": client_id, "action": "added"},
        actor=current_user,
        correlation_id=record["correlation_id"],
        idempotency_key=f"executive-watchlist:{record['id']}",
    )
    return {"created": True, "watchlist": {
        "client_id": client_id,
        "client_name": client.get("name"),
        "note": note,
        "created_at": record["created_at"],
    }}


@router.delete("/executive/watchlist/{client_id}")
async def remove_executive_watchlist_entry(
    client_id: str,
    request: Request,
    current_user: dict = Depends(require_action("executive.watchlist.manage")),
):
    """Remove the caller's own watchlist entry. Another owner's entry is untouched."""
    await assert_global_scope(current_user, operation="executive.watchlist.manage", request=request)
    existing = await _watchlist_entry(current_user, client_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Not on the watchlist")
    await db.executive_watchlist.delete_one({"id": existing.get("id")})
    await emit_platform_event(
        subject="executive.watchlist.changed",
        source="nexus.executive",
        payload={"client_id": client_id, "action": "removed"},
        actor=current_user,
        correlation_id=request_correlation_id(request),
        idempotency_key=f"executive-watchlist-remove:{existing.get('id')}",
    )
    return {"removed": True, "client_id": client_id}


async def _mrr_target_document(current_user: dict) -> dict | None:
    """The tenant's one authoritative recorded goal, if one has been recorded."""
    return await db.executive_mrr_targets.find_one(
        {"tenant_id": str(current_user.get("tenant_id") or "nexus-local")},
        {"_id": 0},
    )


@router.get("/executive/mrr-target")
async def read_mrr_target(
    request: Request,
    current_user: dict = Depends(require_action("executive.intelligence.view")),
):
    """The recorded recurring-revenue goal, its progress, and its revision history.

    Progress is computed from the same loader the briefing uses, so the goal can
    never be measured against a different MRR figure than the cockpit reports.
    """
    await assert_global_scope(current_user, operation="executive.intelligence.view", request=request)
    state = await _load_executive_state(current_user)
    return {"mrr_target": state["mrr_target"]}


@router.put("/executive/mrr-target")
async def record_mrr_target(
    payload: dict,
    request: Request,
    current_user: dict = Depends(require_action("executive.mrr_target.manage")),
):
    """Record or revise the tenant's owner-stated MRR goal.

    Tenant-scoped: one goal per tenant, and the trailing value is retained so a
    revised goal never erases the one it replaced. Recording a goal also captures
    the contract-backed run rate at that moment as its starting line, so progress
    can be stated as growth since the goal was recorded.
    """
    await assert_global_scope(current_user, operation="executive.mrr_target.manage", request=request)
    try:
        goal = normalise_mrr_target(payload)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    tenant_id = str(current_user.get("tenant_id") or "nexus-local")
    actor = _actor(current_user)
    existing = await _mrr_target_document(current_user)
    if existing and all(existing.get(field) == goal[field] for field in ("target_mrr", "target_month", "note")):
        # Re-recording the same goal is a no-op: no new revision, no second audit event.
        state = await _load_executive_state(current_user)
        return {"created": False, "mrr_target": state["mrr_target"]}

    timestamp = _now()
    if existing and existing.get("target_mrr") is not None:
        # A revision keeps the run rate the goal was recorded against, so changing
        # the target can never quietly reset the growth the owner has achieved.
        starting = {
            "starting_mrr": existing.get("starting_mrr"),
            "starting_recorded_at": existing.get("starting_recorded_at"),
            "starting_evidence_state": existing.get("starting_evidence_state"),
        }
    else:
        # A first recording (or a re-recording after a clear) captures a fresh
        # starting line from the same contract-backed MRR the cockpit reports.
        baseline_state = await _load_executive_state(current_user)
        revenue_state = _quality_state(baseline_state, "revenue")
        has_evidence = revenue_state == "verified"
        starting = {
            "starting_mrr": _round_money(baseline_state["summary"].get("mrr")) if has_evidence else None,
            "starting_recorded_at": timestamp if has_evidence else None,
            "starting_evidence_state": revenue_state,
        }
    # History is monotonic: a goal recorded after a clear still retains every goal
    # that came before it, so clearing is never a way to erase a target.
    revisions = [row for row in (existing.get("revisions") if existing else []) or [] if isinstance(row, dict)]
    if existing and existing.get("target_mrr") is not None:
        revisions.insert(0, {
            "target_mrr": _round_money(existing.get("target_mrr")),
            "target_month": existing.get("target_month"),
            "note": str(existing.get("note") or ""),
            "starting_mrr": existing.get("starting_mrr"),
            "changed_at": timestamp,
            "changed_by": actor,
        })
    revisions = revisions[:MRR_TARGET_REVISION_LIMIT]
    if existing:
        await db.executive_mrr_targets.update_one(
            {"id": existing.get("id")},
            {"$set": {
                **goal,
                **starting,
                "revisions": revisions,
                "updated_at": timestamp,
                "updated_by": actor,
                "cleared_at": None,
                "cleared_by": None,
            }},
        )
        target_id = existing.get("id")
        created = False
    else:
        target_id = str(uuid.uuid4())
        created = True
        await db.executive_mrr_targets.insert_one({
            "id": target_id,
            "tenant_id": tenant_id,
            **goal,
            **starting,
            "revisions": revisions,
            "created_at": timestamp,
            "created_by": actor,
            "updated_at": timestamp,
            "updated_by": actor,
            "correlation_id": request_correlation_id(request),
        })

    await emit_platform_event(
        subject="executive.mrr_target.changed",
        source="nexus.executive",
        payload={
            "target_id": target_id,
            "action": "recorded" if created else "revised",
            "target_mrr": goal["target_mrr"],
            "target_month": goal["target_month"],
            "starting_mrr": starting["starting_mrr"],
            "previous_target_mrr": _round_money(existing.get("target_mrr")) if existing and existing.get("target_mrr") is not None else None,
        },
        actor=current_user,
        correlation_id=request_correlation_id(request),
        idempotency_key=f"executive-mrr-target:{target_id}:{timestamp}",
    )
    state = await _load_executive_state(current_user)
    return {"created": created, "mrr_target": state["mrr_target"]}


@router.delete("/executive/mrr-target")
async def clear_mrr_target(
    request: Request,
    current_user: dict = Depends(require_action("executive.mrr_target.manage")),
):
    """Clear the recorded goal. The cleared value is retained as its last revision."""
    await assert_global_scope(current_user, operation="executive.mrr_target.manage", request=request)
    existing = await _mrr_target_document(current_user)
    if not existing or existing.get("target_mrr") is None:
        raise HTTPException(status_code=404, detail="No revenue goal is recorded")
    timestamp = _now()
    actor = _actor(current_user)
    revisions = [
        {
            "target_mrr": _round_money(existing.get("target_mrr")),
            "target_month": existing.get("target_month"),
            "note": str(existing.get("note") or ""),
            "starting_mrr": existing.get("starting_mrr"),
            "changed_at": timestamp,
            "changed_by": actor,
        },
        *list(existing.get("revisions") or []),
    ][:MRR_TARGET_REVISION_LIMIT]
    await db.executive_mrr_targets.update_one(
        {"id": existing.get("id")},
        {"$set": {
            "target_mrr": None,
            "target_month": None,
            "note": "",
            # Clearing removes the starting line with the goal it measured. The
            # value that had been recorded survives in the retained revision.
            "starting_mrr": None,
            "starting_recorded_at": None,
            "starting_evidence_state": None,
            "revisions": revisions,
            "cleared_at": timestamp,
            "cleared_by": actor,
            "updated_at": timestamp,
            "updated_by": actor,
        }},
    )
    await emit_platform_event(
        subject="executive.mrr_target.changed",
        source="nexus.executive",
        payload={
            "target_id": existing.get("id"),
            "action": "cleared",
            "previous_target_mrr": _round_money(existing.get("target_mrr")),
            "previous_starting_mrr": existing.get("starting_mrr"),
        },
        actor=current_user,
        correlation_id=request_correlation_id(request),
        idempotency_key=f"executive-mrr-target-clear:{existing.get('id')}:{timestamp}",
    )
    state = await _load_executive_state(current_user)
    return {
        "cleared": True,
        "removed_target_mrr": _round_money(existing.get("target_mrr")),
        "mrr_target": state["mrr_target"],
    }


@router.post("/executive/scenarios")
async def simulate_executive_scenario(
    payload: dict,
    request: Request,
    current_user: dict = Depends(require_action("executive.scenario.simulate")),
):
    await assert_global_scope(current_user, operation="executive.scenario.simulate", request=request)
    try:
        scenario = normalise_scenario(payload)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    state = await _load_executive_state(current_user, normalise_window((payload or {}).get("window")))
    result = build_executive_scenario(
        state["summary"],
        state["model_context"]["client_mrr"],
        state["model_context"]["clients"],
        scenario,
    )
    record = {
        "id": str(uuid.uuid4()),
        "tenant_id": str(current_user.get("tenant_id") or "nexus-local"),
        "scenario": scenario,
        "result": result,
        "created_at": _now(),
        "created_by": _actor(current_user),
        "correlation_id": request_correlation_id(request),
    }
    await db.executive_scenarios.insert_one(record)
    await emit_platform_event(
        subject="executive.scenario.simulated",
        source="nexus.executive",
        payload={"scenario_id": record["id"], "name": scenario["name"], "will_execute": False},
        actor=current_user,
        correlation_id=record["correlation_id"],
        idempotency_key=f"executive-scenario:{record['id']}",
    )
    return {**result, "id": record["id"], "created_at": record["created_at"], "created_by": record["created_by"]}


@router.post("/executive/board-snapshots")
async def save_board_snapshot(
    request: Request,
    current_user: dict = Depends(require_action("executive.board.snapshot")),
):
    await assert_global_scope(current_user, operation="executive.board.snapshot", request=request)
    state = await _load_executive_state(current_user)
    created_at = _now()
    snapshot = {
        "id": str(uuid.uuid4()),
        "tenant_id": str(current_user.get("tenant_id") or "nexus-local"),
        "title": f"Executive briefing · {datetime.now(timezone.utc).strftime('%B %Y')}",
        "summary": state["summary"],
        "board_brief": state["board_brief"],
        "data_quality": state["data_quality"],
        "created_at": created_at,
        "created_by": _actor(current_user),
        "correlation_id": request_correlation_id(request),
    }
    await db.executive_board_snapshots.insert_one(snapshot)
    await emit_platform_event(
        subject="executive.board.snapshot.saved",
        source="nexus.executive",
        payload={"snapshot_id": snapshot["id"], "title": snapshot["title"]},
        actor=current_user,
        correlation_id=snapshot["correlation_id"],
        idempotency_key=f"executive-board-snapshot:{snapshot['id']}",
    )
    return {key: value for key, value in snapshot.items() if key != "_id"}
