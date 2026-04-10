from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random; random = random.SystemRandom()
import uuid

router = APIRouter()

# ─── MRR/ARR Revenue Tracker ───

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
