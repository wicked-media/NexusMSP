from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random; random = random.SystemRandom()
import uuid

router = APIRouter()

@router.get("/pricing-calc/overview")
async def pricing_overview(current_user: dict = Depends(get_current_user)):
    calcs = await db.pricing_calcs.find({}, {"_id": 0}).to_list(50)
    if not calcs:
        calcs = await _seed_calcs()
    return {"calculations": calcs, "defaults": {"labor_rate_hour": 125, "target_margin_pct": 45, "overhead_multiplier": 1.35}}

@router.post("/pricing-calc/calculate")
async def calculate_pricing(data: dict, current_user: dict = Depends(get_current_user)):
    devices = data.get("devices", 10)
    users = data.get("users", 20)
    labor_hours = data.get("labor_hours_month", 8)
    labor_rate = data.get("labor_rate", 125)
    target_margin = data.get("target_margin_pct", 45) / 100
    labor_cost = labor_hours * labor_rate
    tool_cost = devices * 3.50
    overhead = (labor_cost + tool_cost) * 0.35
    total_cost = labor_cost + tool_cost + overhead
    suggested_price = round(total_cost / (1 - target_margin), 2)
    return {"cost_breakdown": {"labor": labor_cost, "tooling": tool_cost, "overhead": overhead, "total_cost": total_cost}, "suggested_mrr": suggested_price, "per_device": round(suggested_price / devices, 2), "per_user": round(suggested_price / users, 2), "margin_pct": round(target_margin * 100, 1), "profit": round(suggested_price - total_cost, 2)}

async def _seed_calcs():
    clients = ["TechStart Inc", "Global Finance Ltd", "HealthCare Plus", "NovaTech Research"]
    calcs = []
    for c in clients:
        devices = random.randint(10, 50)
        users = random.randint(20, 100)
        labor = random.randint(4, 16)
        cost = labor * 125 + devices * 3.50 + (labor * 125 + devices * 3.50) * 0.35
        price = round(cost / 0.55, 2)
        calc = {"id": f"pc-{uuid.uuid4().hex[:8]}", "client_name": c, "devices": devices, "users": users, "labor_hours": labor, "total_cost": round(cost, 2), "suggested_mrr": price, "actual_mrr": round(price * random.uniform(0.85, 1.15), 2), "margin_pct": round((price - cost) / price * 100, 1), "created_at": datetime.now(timezone.utc).isoformat()}
        calcs.append(calc)
        await db.pricing_calcs.insert_one(calc)
    return [{k: v for k, v in c.items() if k != "_id"} for c in calcs]
