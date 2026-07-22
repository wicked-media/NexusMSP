"""Evidence-backed revenue views.

Revenue, margin, retention and forecasting are financial claims.  This router
therefore reports only active contract values, recorded time/line-item pricing,
and recorded operational attention signals.  It never fills gaps with invented
rates, cohorts, growth percentages, or churn projections.
"""

from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.database import db


router = APIRouter()


def _number(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _contract_monthly_value(contract: dict) -> float:
    return max(0, _number(contract.get("monthly_value", contract.get("mrr", contract.get("value", 0)))))


async def _active_contract_revenue() -> tuple[list[dict], list[dict]]:
    contracts = await db.contracts.find({"status": "active"}, {"_id": 0}).to_list(2000)
    clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)
    client_names = {client.get("id"): client.get("name") or "Unassigned client" for client in clients}
    grouped: dict[str, dict] = {}
    for contract in contracts:
        client_id = contract.get("client_id") or "unassigned"
        entry = grouped.setdefault(client_id, {
            "client_id": client_id,
            "client_name": contract.get("client_name") or client_names.get(client_id, "Unassigned client"),
            "mrr": 0.0,
            "contracts": 0,
            "endpoints": None,
            "status": "active",
            "source": "active_contracts",
        })
        entry["mrr"] += _contract_monthly_value(contract)
        entry["contracts"] += 1
    rows = []
    for entry in grouped.values():
        entry["mrr"] = round(entry["mrr"], 2)
        rows.append(entry)
    return rows, contracts


@router.get("/revenue-tracker/overview")
async def revenue_overview(current_user: dict = Depends(get_current_user)):
    clients, contracts = await _active_contract_revenue()
    current_mrr = round(sum(client["mrr"] for client in clients), 2)
    by_service: dict[str, float] = defaultdict(float)
    for contract in contracts:
        service = contract.get("type_name") or contract.get("service_type") or contract.get("contract_type") or "Uncategorised contracts"
        by_service[str(service)] += _contract_monthly_value(contract)
    return {
        "clients": sorted(clients, key=lambda row: row["mrr"], reverse=True),
        "summary": {
            "current_mrr": current_mrr,
            "current_arr": round(current_mrr * 12, 2),
            "mrr_growth": None,
            "avg_revenue_per_endpoint": None,
            "churn_risk_revenue": None,
            "expansion_revenue": None,
            "net_revenue_retention": None,
            "logo_retention": None,
            "evidence_state": "evidence_available" if contracts else "not_configured",
        },
        "monthly_trend": [],
        "by_service": [{"service": service, "mrr": round(value, 2)} for service, value in sorted(by_service.items(), key=lambda item: item[1], reverse=True)],
        "message": None if contracts else "No active contract values have been recorded. Add or synchronise contract billing before using revenue analytics.",
    }


@router.get("/revenue-tracker/client/{client_name}")
async def client_revenue(client_name: str, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"name": client_name}, {"_id": 0, "id": 1, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    contracts = await db.contracts.find({"client_id": client["id"], "status": "active"}, {"_id": 0}).to_list(200)
    mrr = round(sum(_contract_monthly_value(contract) for contract in contracts), 2)
    return {
        "client_id": client["id"], "client_name": client.get("name"), "mrr": mrr,
        "contracts": len(contracts), "history": [], "source": "active_contracts",
        "message": "Historical MRR requires recorded billing snapshots; NexusMSP will not estimate a trend.",
    }


@router.get("/revenue-tracker/cohort")
async def cohort_analysis(current_user: dict = Depends(get_current_user)):
    return {"cohorts": [], "message": "Cohort analysis requires recorded contract/billing history and is not estimated from current contracts."}


@router.get("/revenue-tracking/dashboard")
async def get_revenue_dashboard(current_user: dict = Depends(get_current_user)):
    tickets = await db.tickets.find({}, {"_id": 0, "id": 1, "title": 1, "client_id": 1, "client_name": 1, "priority": 1, "status": 1, "category": 1, "assigned_name": 1}).to_list(1000)
    ticket_revenue, total_revenue, total_cost = [], 0.0, 0.0
    for ticket in tickets:
        time_entries = await db.time_entries.find({"ticket_id": ticket["id"]}, {"_id": 0}).to_list(200)
        products = await db.ticket_products.find({"ticket_id": ticket["id"]}, {"_id": 0}).to_list(200)
        total_minutes = sum(max(0, _number(entry.get("minutes", entry.get("duration_minutes", 0)))) for entry in time_entries)
        billable_minutes = sum(max(0, _number(entry.get("minutes", entry.get("duration_minutes", 0)))) for entry in time_entries if entry.get("billable", True))
        labor_revenue = labor_cost = 0.0
        rate_evidence = bool(time_entries)
        for entry in time_entries:
            minutes = max(0, _number(entry.get("minutes", entry.get("duration_minutes", 0))))
            if entry.get("billable", True):
                rate = entry.get("billing_rate", entry.get("billable_rate", entry.get("rate")))
                if rate is None:
                    rate_evidence = False
                else:
                    labor_revenue += minutes / 60 * _number(rate)
            cost_rate = entry.get("cost_rate")
            if cost_rate is None:
                rate_evidence = False
            else:
                labor_cost += minutes / 60 * _number(cost_rate)
        parts_revenue = sum(_number(product.get("sell_price")) * max(0, _number(product.get("quantity", 1))) for product in products)
        parts_cost = sum(_number(product.get("cost_price")) * max(0, _number(product.get("quantity", 1))) for product in products)
        total = labor_revenue + parts_revenue
        cost = labor_cost + parts_cost
        ticket_revenue.append({
            "id": ticket["id"], "title": ticket.get("title", "Untitled ticket"), "client_name": ticket.get("client_name", "Unknown"),
            "priority": ticket.get("priority", "medium"), "status": ticket.get("status", "open"), "category": ticket.get("category"), "assigned_to": ticket.get("assigned_name"),
            "total_minutes": round(total_minutes, 2), "billable_minutes": round(billable_minutes, 2),
            "labor_revenue": round(labor_revenue, 2), "labor_cost": round(labor_cost, 2), "parts_revenue": round(parts_revenue, 2), "parts_cost": round(parts_cost, 2),
            "total_revenue": round(total, 2), "total_cost": round(cost, 2), "profit": round(total - cost, 2),
            "margin_pct": round((total - cost) / total * 100, 1) if total else None,
            "pricing_evidence": rate_evidence,
        })
        total_revenue += total
        total_cost += cost
    by_client: dict[str, dict] = {}
    by_tech: dict[str, dict] = {}
    for row in ticket_revenue:
        for collection, key, label in ((by_client, row["client_name"], "client_name"), (by_tech, row["assigned_to"] or "Unassigned", "tech_name")):
            summary = collection.setdefault(key, {label: key, "tickets": 0, "revenue": 0.0, "cost": 0.0, "profit": 0.0, "total_minutes": 0.0})
            summary["tickets"] += 1
            summary["revenue"] += row["total_revenue"]
            summary["cost"] += row["total_cost"]
            summary["profit"] += row["profit"]
            summary["total_minutes"] += row["total_minutes"]
    for collection in (by_client, by_tech):
        for summary in collection.values():
            summary["revenue"] = round(summary["revenue"], 2)
            summary["cost"] = round(summary["cost"], 2)
            summary["profit"] = round(summary["profit"], 2)
            summary["margin_pct"] = round(summary["profit"] / summary["revenue"] * 100, 1) if summary["revenue"] else None
            summary["revenue_per_hour"] = round(summary["revenue"] / (summary["total_minutes"] / 60), 2) if summary["total_minutes"] else None
    return {
        "summary": {
            "total_revenue": round(total_revenue, 2), "total_cost": round(total_cost, 2), "total_profit": round(total_revenue - total_cost, 2),
            "overall_margin": round((total_revenue - total_cost) / total_revenue * 100, 1) if total_revenue else None,
            "total_tickets": len(ticket_revenue), "avg_revenue_per_ticket": round(total_revenue / len(ticket_revenue), 2) if ticket_revenue else None,
            "avg_profit_per_ticket": round((total_revenue - total_cost) / len(ticket_revenue), 2) if ticket_revenue else None,
        },
        "tickets": sorted(ticket_revenue, key=lambda row: row["profit"], reverse=True),
        "by_client": sorted(by_client.values(), key=lambda row: row["profit"], reverse=True),
        "by_tech": sorted(by_tech.values(), key=lambda row: row["revenue"], reverse=True),
    }


@router.get("/revenue-forecast/dashboard")
async def get_revenue_forecast(user=Depends(get_current_user)):
    client_rows, contracts = await _active_contract_revenue()
    total_mrr = round(sum(row["mrr"] for row in client_rows), 2)
    attention = []
    for row in client_rows:
        open_tickets = await db.tickets.count_documents({"client_id": row["client_id"], "status": {"$in": ["open", "in_progress"]}})
        if open_tickets >= 5:
            attention.append({"client_id": row["client_id"], "client_name": row["client_name"], "mrr": row["mrr"], "open_tickets": open_tickets, "risk": "review", "sentiment": None})
    return {
        "summary": {
            "current_mrr": total_mrr, "current_arr": round(total_mrr * 12, 2), "projected_arr_12m": None,
            "total_clients": len(client_rows), "churn_risks": len(attention), "evidence_state": "evidence_available" if contracts else "not_configured",
        },
        "forecast": [], "churn_risks": sorted(attention, key=lambda row: row["mrr"], reverse=True),
        "message": "A 12-month forecast requires recorded billing snapshots and approved forecast assumptions. Current contract MRR is shown without projecting growth or churn.",
    }
