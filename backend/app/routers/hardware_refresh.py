from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random; random = random.SystemRandom()
import uuid

router = APIRouter()

@router.get("/hardware-refresh/overview")
async def hardware_refresh_overview(current_user: dict = Depends(get_current_user)):
    plans = await db.hardware_refresh.find({}, {"_id": 0}).to_list(200)
    if not plans:
        plans = await _seed_plans()
    eol_soon = [p for p in plans if p.get("status") == "eol_approaching"]
    eol_passed = [p for p in plans if p.get("status") == "eol_passed"]
    return {"devices": plans, "summary": {"total_tracked": len(plans), "eol_approaching": len(eol_soon), "eol_passed": len(eol_passed), "replacement_budget_needed": sum(p.get("replacement_cost", 0) for p in eol_soon + eol_passed), "avg_device_age_years": round(sum(p.get("age_years", 0) for p in plans) / max(len(plans), 1), 1)}}

async def _seed_plans():
    devices = await db.devices.find({}, {"_id": 0, "id": 1, "name": 1, "client_name": 1, "type": 1, "manufacturer": 1, "model": 1}).to_list(200)
    plans = []
    for d in devices[:50]:
        age = round(random.uniform(0.5, 8), 1)
        warranty_years = random.choice([3, 4, 5])
        eol_date = (datetime.now(timezone.utc) + timedelta(days=random.randint(-365, 730))).strftime("%Y-%m-%d")
        status = "current" if age < warranty_years - 1 else "eol_approaching" if age < warranty_years + 1 else "eol_passed"
        p = {"id": f"hr-{uuid.uuid4().hex[:8]}", "device_id": d.get("id"), "device_name": d.get("name"), "client_name": d.get("client_name"), "type": d.get("type"), "manufacturer": d.get("manufacturer", "Dell"), "model": d.get("model", "OptiPlex 7080"), "purchase_date": (datetime.now(timezone.utc) - timedelta(days=int(age * 365))).strftime("%Y-%m-%d"), "warranty_end": eol_date, "age_years": age, "lifecycle_years": warranty_years, "status": status, "replacement_cost": random.choice([800, 1200, 1500, 2500, 3500, 5000]) if status != "current" else 0, "recommended_replacement": random.choice(["Dell OptiPlex 7090", "HP EliteDesk 800 G9", "Lenovo ThinkCentre M90q", "Dell PowerEdge R760"])}
        plans.append(p)
        await db.hardware_refresh.insert_one(p)
    return [{k: v for k, v in p.items() if k != "_id"} for p in plans]
