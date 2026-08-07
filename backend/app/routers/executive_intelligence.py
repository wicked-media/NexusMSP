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
ACTIVE_TICKET_STATES = {"open", "in_progress", "pending", "waiting"}
CLOSED_INVOICE_STATES = {"cancelled", "voided"}
OPEN_PO_STATES = {"draft", "submitted", "approved", "ordered", "partially_received", "open"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _number(value: Any, default: float = 0.0) -> float:
    if isinstance(value, bool):
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _round_money(value: Any) -> float:
    return round(_number(value), 2)


def _parse_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        parsed = value
    else:
        text = str(value or "").strip()
        if not text:
            return None
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            try:
                parsed = datetime.strptime(text[:10], "%Y-%m-%d")
            except ValueError:
                return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


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
    return user.get("name") or user.get("email") or user.get("id") or "Unknown owner"


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


def build_board_brief(summary: dict, risks: list[dict], profit_killers: list[dict], quality: list[dict]) -> dict:
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


async def _load_executive_state(user: dict) -> dict:
    now = datetime.now(timezone.utc)
    threshold = now - timedelta(days=WINDOW_DAYS)
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
    recent_invoices = [
        row for row in invoices
        if _within_window(row, threshold, ("invoice_date", "issue_date", "created_at", "date"))
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
    available_hours = len(technicians) * 160
    capacity_pct = round(recorded_hours / available_hours * 100, 1) if available_hours else None

    health_scores = await asyncio.gather(*[_compute_health(client) for client in clients]) if clients else []
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
        if end_at and now <= end_at <= now + timedelta(days=90):
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
    if expiring_contracts:
        risks.append({
            "id": "contract-renewals",
            "severity": "high",
            "title": f"{len(expiring_contracts)} active contract(s) expire within 90 days",
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
            "detail": "Aggregate recorded hours versus 160 hours per active service-team member; not presence or productivity surveillance.",
        },
        {
            "id": "cash",
            "label": "Cash outlook",
            "state": "verified" if live_invoices or open_pos else "missing",
            "detail": "Open receivables due within 30 days less current open purchase commitments; bank balance and tax are excluded.",
        },
    ]
    board_brief = build_board_brief(summary, risks, profit_killers, quality)
    return {
        "generated_at": _now(),
        "period": {"days": WINDOW_DAYS, "label": "Trailing 30 days"},
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
            "recorded_hours_30d": round(recorded_hours, 1),
            "billable_hours_30d": round(billable_hours, 1),
            "available_hours_model": available_hours,
            "capacity_pct": capacity_pct,
            "method": "Aggregate time evidence only. CEO Mode does not expose individual movement, breaks, or presence.",
        },
        "risk_items": risks[:10],
        "profit_killers": profit_killers,
        "portfolio": portfolio[:15],
        "board_brief": board_brief,
        "data_quality": quality,
        "recent_board_snapshots": snapshots,
        "model_context": {
            "client_mrr": {key: _round_money(value) for key, value in client_mrr.items()},
            "clients": [{"id": client.get("id"), "name": client.get("name")} for client in clients],
        },
    }


@router.get("/executive/overview")
async def executive_overview(
    request: Request,
    current_user: dict = Depends(require_action("executive.intelligence.view")),
):
    await assert_global_scope(current_user, operation="executive.intelligence.view", request=request)
    return await _load_executive_state(current_user)


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
    state = await _load_executive_state(current_user)
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
