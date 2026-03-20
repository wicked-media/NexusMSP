from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random, uuid

router = APIRouter()

@router.get("/client-budget/overview")
async def budget_overview(current_user: dict = Depends(get_current_user)):
    budgets = await db.client_budgets.find({}, {"_id": 0}).to_list(100)
    if not budgets:
        budgets = await _seed_budgets()
    total_budget = sum(b.get("annual_budget", 0) for b in budgets)
    total_spent = sum(b.get("ytd_spent", 0) for b in budgets)
    return {"budgets": budgets, "summary": {"total_annual_budget": total_budget, "total_ytd_spent": total_spent, "avg_utilization_pct": round(total_spent / total_budget * 100, 1) if total_budget else 0, "clients_over_budget": len([b for b in budgets if b.get("ytd_spent", 0) > b.get("annual_budget", 0) * (datetime.now().month / 12)])}}

async def _seed_budgets():
    clients = [("TechStart Inc", 48000, 18500), ("Global Finance Ltd", 120000, 52000), ("HealthCare Plus", 85000, 38200), ("NovaTech Research", 65000, 27800), ("Pacific Schools District", 95000, 41500), ("Atlas Logistics", 55000, 23100), ("Apex Hospitality", 42000, 19800), ("Summit Legal", 38000, 15200)]
    budgets = []
    for name, annual, spent in clients:
        b = {"id": f"cb-{uuid.uuid4().hex[:8]}", "client_name": name, "annual_budget": annual, "ytd_spent": spent, "monthly_budget": round(annual / 12), "monthly_spent": round(spent / max(datetime.now().month, 1)),
             "categories": [{"name": "Hardware", "budget": round(annual * 0.3), "spent": round(spent * random.uniform(0.25, 0.35))}, {"name": "Software/Licenses", "budget": round(annual * 0.25), "spent": round(spent * random.uniform(0.2, 0.3))}, {"name": "Labor/Support", "budget": round(annual * 0.35), "spent": round(spent * random.uniform(0.3, 0.4))}, {"name": "Projects", "budget": round(annual * 0.1), "spent": round(spent * random.uniform(0.05, 0.15))}],
             "forecast_eoy": round(spent / max(datetime.now().month, 1) * 12), "status": "on_track" if spent / max(datetime.now().month, 1) * 12 <= annual * 1.05 else "over_budget"}
        budgets.append(b)
        await db.client_budgets.insert_one(b)
    return [{k: v for k, v in b.items() if k != "_id"} for b in budgets]
