from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random; random = random.SystemRandom()
import uuid

router = APIRouter()

@router.get("/usage-billing/overview")
async def billing_overview(current_user: dict = Depends(get_current_user)):
    plans = await db.usage_billing.find({}, {"_id": 0}).to_list(50)
    if not plans:
        plans = await _seed_plans()
    total_mrr = sum(p.get("current_mrr", 0) for p in plans)
    return {"plans": plans, "summary": {"total_mrr": total_mrr, "total_clients": len(plans), "avg_per_device": round(total_mrr / max(sum(p.get("device_count", 0) for p in plans), 1), 2), "overages_this_month": sum(p.get("overage_amount", 0) for p in plans)}}

async def _seed_plans():
    clients = [("TechStart Inc", 18, 45, 3.50, 1200), ("Global Finance Ltd", 25, 82, 4.00, 3500), ("HealthCare Plus", 35, 60, 5.00, 2800), ("NovaTech Research", 15, 35, 3.75, 900), ("Pacific Schools District", 20, 55, 3.25, 1500), ("Atlas Logistics", 12, 30, 3.50, 800), ("Apex Hospitality", 10, 25, 4.50, 750), ("Summit Legal", 8, 20, 5.50, 600)]
    plans = []
    for name, devices, users, per_device, base in clients:
        overage = max(0, devices - 15) * 2.50 if devices > 15 else 0
        p = {"id": f"ub-{uuid.uuid4().hex[:8]}", "client_name": name, "plan_type": random.choice(["per_device", "per_user", "hybrid"]), "device_count": devices, "user_count": users, "per_device_rate": per_device, "base_fee": base, "current_mrr": round(base + devices * per_device + overage, 2), "overage_amount": round(overage, 2), "storage_gb": random.randint(50, 500), "storage_rate_per_gb": 0.10, "billing_cycle": "monthly", "next_invoice": (datetime.now(timezone.utc) + timedelta(days=random.randint(1, 30))).strftime("%Y-%m-%d")}
        plans.append(p)
        await db.usage_billing.insert_one(p)
    return [{k: v for k, v in p.items() if k != "_id"} for p in plans]
