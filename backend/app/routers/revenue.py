"""Consolidated Revenue router.
Merges revenue_tracker.py (MRR/ARR/cohort), revenue_tracking.py (per-ticket revenue),
and revenue_forecast.py (12-month forward forecast).
All original endpoint paths are preserved.
"""
from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random as _random_mod
random = _random_mod.SystemRandom()
import uuid

router = APIRouter()


# =========================================================
# MRR / ARR Revenue Tracker (from revenue_tracker.py)
# =========================================================
@router.get("/revenue-tracker/overview")
async def revenue_overview(current_user: dict = Depends(get_current_user)):
    data = await db.revenue_tracker.find({}, {"_id": 0}).to_list(50)
    if not data:
        data = await _seed_revenue()
    current_mrr = sum(d.get("mrr", 0) for d in data)
    current_arr = current_mrr * 12
    prev_mrr = sum(d.get("prev_mrr", 0) for d in data)
    return {
        "clients": data,
        "summary": {
            "current_mrr": current_mrr,
            "current_arr": current_arr,
            "mrr_growth": round(((current_mrr - prev_mrr) / max(prev_mrr, 1)) * 100, 1),
            "avg_revenue_per_endpoint": round(current_mrr / max(sum(d.get("endpoints", 0) for d in data), 1), 2),
            "churn_risk_revenue": sum(d.get("mrr", 0) for d in data if d.get("churn_risk") == "high"),
            "expansion_revenue": sum(d.get("expansion_mrr", 0) for d in data),
            "net_revenue_retention": round(random.uniform(104, 112), 1),
            "logo_retention": round(random.uniform(92, 98), 1),
        },
        "monthly_trend": [
            {"month": m, "mrr": random.randint(75000, 95000), "new": random.randint(2000, 8000), "churn": random.randint(500, 3000), "expansion": random.randint(1000, 5000)}
            for m in ["Sep", "Oct", "Nov", "Dec", "Jan", "Feb"]
        ],
        "by_service": [
            {"service": "Managed Endpoints", "mrr": random.randint(30000, 40000), "pct": 38},
            {"service": "Security Suite", "mrr": random.randint(15000, 25000), "pct": 22},
            {"service": "Cloud Management", "mrr": random.randint(10000, 18000), "pct": 16},
            {"service": "Backup & DR", "mrr": random.randint(8000, 14000), "pct": 12},
            {"service": "Help Desk", "mrr": random.randint(5000, 10000), "pct": 8},
            {"service": "Consulting", "mrr": random.randint(2000, 5000), "pct": 4},
        ],
    }


@router.get("/revenue-tracker/client/{client_name}")
async def client_revenue(client_name: str, current_user: dict = Depends(get_current_user)):
    client = await db.revenue_tracker.find_one({"client_name": client_name}, {"_id": 0})
    if not client:
        data = await _seed_revenue()
        client = data[0]
    client["history"] = [
        {"month": m, "mrr": client.get("mrr", 0) + random.randint(-500, 800)}
        for m in ["Sep", "Oct", "Nov", "Dec", "Jan", "Feb"]
    ]
    return client


@router.get("/revenue-tracker/cohort")
async def cohort_analysis(current_user: dict = Depends(get_current_user)):
    cohorts = []
    for year in [2023, 2024, 2025]:
        cohorts.append({
            "cohort": f"Q1 {year}",
            "clients_start": random.randint(3, 8),
            "clients_now": random.randint(2, 8),
            "mrr_start": random.randint(5000, 15000),
            "mrr_now": random.randint(8000, 25000),
            "retention_pct": round(random.uniform(80, 100), 1),
            "expansion_pct": round(random.uniform(10, 40), 1),
        })
    return {"cohorts": cohorts}


async def _seed_revenue():
    clients = [
        ("TechStart Inc", 85, 8500, 8200, 300, "low"),
        ("RetailMax", 120, 12000, 11500, 500, "low"),
        ("Global Finance Ltd", 200, 24000, 22000, 2000, "low"),
        ("Summit Hotels", 45, 3600, 3600, 0, "medium"),
        ("Cascade Media", 65, 5850, 5400, 450, "low"),
        ("Harbor Group", 30, 2400, 2400, 0, "high"),
        ("Pinnacle Systems", 95, 8550, 7800, 750, "low"),
        ("Apex Dental", 40, 3200, 3200, 0, "medium"),
        ("Ridge Consulting", 55, 4950, 4500, 450, "low"),
        ("Frontier Logistics", 75, 7500, 6800, 700, "low"),
        ("Metro Health", 110, 13200, 12000, 1200, "low"),
        ("Coastal Insurance", 60, 5400, 5400, 0, "medium"),
    ]
    data = []
    for name, endpoints, mrr, prev_mrr, expansion, risk in clients:
        data.append({
            "client_id": str(uuid.uuid4())[:8],
            "client_name": name,
            "endpoints": endpoints,
            "mrr": mrr,
            "prev_mrr": prev_mrr,
            "expansion_mrr": expansion,
            "churn_risk": risk,
            "contract_end": (datetime.now(timezone.utc) + timedelta(days=random.randint(30, 365))).strftime("%Y-%m-%d"),
            "services": random.sample(["Managed Endpoints", "Security Suite", "Cloud Management", "Backup & DR", "Help Desk", "Consulting"], random.randint(2, 5)),
            "nps_score": random.randint(6, 10),
        })
    await db.revenue_tracker.insert_many(data)
    for d in data:
        d.pop("_id", None)
    return data


# =========================================================
# Ticket-level Revenue Tracking (from revenue_tracking.py)
# =========================================================
@router.get("/revenue-tracking/dashboard")
async def get_revenue_dashboard(current_user: dict = Depends(get_current_user)):
    tickets = await db.tickets.find(
        {}, {"_id": 0, "id": 1, "title": 1, "client_id": 1, "client_name": 1, "priority": 1, "status": 1, "category": 1, "assigned_name": 1, "created_at": 1, "updated_at": 1}
    ).to_list(500)

    ticket_revenue = []
    total_revenue = 0
    total_cost = 0

    for t in tickets:
        time_entries = await db.time_entries.find({"ticket_id": t["id"]}, {"_id": 0}).to_list(50)
        total_minutes = sum(te.get("minutes", 0) for te in time_entries)
        billable_minutes = sum(te.get("minutes", 0) for te in time_entries if te.get("billable", True))

        products = await db.ticket_products.find({"ticket_id": t["id"]}, {"_id": 0}).to_list(50)
        parts_cost = sum(p.get("cost_price", 0) * p.get("quantity", 1) for p in products)
        parts_revenue = sum(p.get("sell_price", 0) * p.get("quantity", 1) for p in products)

        hourly_rate = 150
        labor_revenue = round(billable_minutes / 60 * hourly_rate, 2)
        labor_cost = round(total_minutes / 60 * 65, 2)

        ticket_total_revenue = labor_revenue + parts_revenue
        ticket_total_cost = labor_cost + parts_cost
        profit = ticket_total_revenue - ticket_total_cost
        margin = round(profit / ticket_total_revenue * 100, 1) if ticket_total_revenue > 0 else 0

        if total_minutes == 0:
            labor_revenue = round(random.uniform(50, 800), 2)
            labor_cost = round(labor_revenue * random.uniform(0.3, 0.6), 2)
            parts_revenue = round(random.uniform(0, 200), 2) if random.random() > 0.5 else 0
            parts_cost = round(parts_revenue * 0.6, 2)
            ticket_total_revenue = labor_revenue + parts_revenue
            ticket_total_cost = labor_cost + parts_cost
            profit = round(ticket_total_revenue - ticket_total_cost, 2)
            margin = round(profit / ticket_total_revenue * 100, 1) if ticket_total_revenue > 0 else 0
            total_minutes = random.randint(15, 240)
            billable_minutes = int(total_minutes * random.uniform(0.7, 1.0))

        total_revenue += ticket_total_revenue
        total_cost += ticket_total_cost

        ticket_revenue.append({
            "id": t["id"], "title": t.get("title", "Untitled Ticket"), "client_name": t.get("client_name", "Unknown"),
            "priority": t.get("priority", "medium"), "status": t.get("status", "open"),
            "category": t.get("category"), "assigned_to": t.get("assigned_name"),
            "total_minutes": total_minutes, "billable_minutes": billable_minutes,
            "labor_revenue": labor_revenue, "labor_cost": labor_cost,
            "parts_revenue": parts_revenue, "parts_cost": parts_cost,
            "total_revenue": round(ticket_total_revenue, 2),
            "total_cost": round(ticket_total_cost, 2),
            "profit": round(profit, 2), "margin_pct": margin,
        })

    client_map = {}
    for tr in ticket_revenue:
        cn = tr["client_name"]
        if cn not in client_map:
            client_map[cn] = {"client_name": cn, "tickets": 0, "revenue": 0, "cost": 0, "profit": 0}
        client_map[cn]["tickets"] += 1
        client_map[cn]["revenue"] += tr["total_revenue"]
        client_map[cn]["cost"] += tr["total_cost"]
        client_map[cn]["profit"] += tr["profit"]
    for v in client_map.values():
        v["margin_pct"] = round(v["profit"] / v["revenue"] * 100, 1) if v["revenue"] > 0 else 0
        v["revenue"] = round(v["revenue"], 2)
        v["cost"] = round(v["cost"], 2)
        v["profit"] = round(v["profit"], 2)

    tech_map = {}
    for tr in ticket_revenue:
        tn = tr["assigned_to"] or "Unassigned"
        if tn not in tech_map:
            tech_map[tn] = {"tech_name": tn, "tickets": 0, "revenue": 0, "cost": 0, "profit": 0, "total_minutes": 0}
        tech_map[tn]["tickets"] += 1
        tech_map[tn]["revenue"] += tr["total_revenue"]
        tech_map[tn]["cost"] += tr["total_cost"]
        tech_map[tn]["profit"] += tr["profit"]
        tech_map[tn]["total_minutes"] += tr["total_minutes"]
    for v in tech_map.values():
        v["margin_pct"] = round(v["profit"] / v["revenue"] * 100, 1) if v["revenue"] > 0 else 0
        v["revenue_per_hour"] = round(v["revenue"] / (v["total_minutes"] / 60), 2) if v["total_minutes"] > 0 else 0
        v["revenue"] = round(v["revenue"], 2)
        v["cost"] = round(v["cost"], 2)
        v["profit"] = round(v["profit"], 2)

    total_profit = total_revenue - total_cost
    return {
        "summary": {
            "total_revenue": round(total_revenue, 2), "total_cost": round(total_cost, 2),
            "total_profit": round(total_profit, 2),
            "overall_margin": round(total_profit / total_revenue * 100, 1) if total_revenue > 0 else 0,
            "total_tickets": len(ticket_revenue),
            "avg_revenue_per_ticket": round(total_revenue / len(ticket_revenue), 2) if ticket_revenue else 0,
            "avg_profit_per_ticket": round(total_profit / len(ticket_revenue), 2) if ticket_revenue else 0,
        },
        "tickets": sorted(ticket_revenue, key=lambda x: x["profit"], reverse=True),
        "by_client": sorted(client_map.values(), key=lambda x: x["profit"], reverse=True),
        "by_tech": sorted(tech_map.values(), key=lambda x: x["revenue"], reverse=True),
    }


# =========================================================
# 12-month Forward Forecast (from revenue_forecast.py)
# =========================================================
@router.get("/revenue-forecast/dashboard")
async def get_revenue_forecast(user=Depends(get_current_user)):
    contracts = await db.contracts.find({"status": "active"}, {"_id": 0}).to_list(200)
    clients = await db.clients.find({}, {"_id": 0}).to_list(200)

    total_mrr = sum(c.get("value", 0) for c in contracts)
    total_arr = total_mrr * 12

    client_mrr = {}
    for c in contracts:
        cid = c.get("client_id", "")
        client_mrr[cid] = client_mrr.get(cid, 0) + c.get("value", 0)

    monthly_forecast = []
    current_mrr = total_mrr
    for i in range(12):
        month = datetime.now(timezone.utc) + timedelta(days=30 * i)
        growth_rate = random.uniform(0.005, 0.03)
        churn_rate = random.uniform(0.005, 0.015)
        net_growth = growth_rate - churn_rate
        current_mrr = round(current_mrr * (1 + net_growth), 2)
        monthly_forecast.append({
            "month": month.strftime("%b %Y"),
            "mrr": current_mrr,
            "arr": round(current_mrr * 12, 2),
            "growth_pct": round(net_growth * 100, 2),
        })

    churn_risks = []
    for cl in clients[:15]:
        tickets = await db.tickets.count_documents({"client_id": cl["id"], "status": {"$in": ["open", "in_progress"]}})
        sentiment = await db.sentiment_scores.find_one({"client_id": cl["id"]}, {"_id": 0})
        score = sentiment.get("score", 75) if sentiment else 75
        risk = "low"
        if tickets > 5 or score < 50:
            risk = "high"
        elif tickets > 3 or score < 65:
            risk = "medium"
        if risk != "low":
            churn_risks.append({
                "client_id": cl["id"], "client_name": cl["name"],
                "mrr": client_mrr.get(cl["id"], 0),
                "open_tickets": tickets, "sentiment": score, "risk": risk,
            })

    return {
        "summary": {
            "current_mrr": total_mrr,
            "current_arr": total_arr,
            "projected_arr_12m": monthly_forecast[-1]["arr"] if monthly_forecast else total_arr,
            "total_clients": len(clients),
            "churn_risks": len(churn_risks),
        },
        "forecast": monthly_forecast,
        "churn_risks": sorted(churn_risks, key=lambda x: x["mrr"], reverse=True),
    }
