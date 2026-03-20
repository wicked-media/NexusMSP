from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random, uuid

router = APIRouter()

@router.get("/late-payment/predictions")
async def late_payment_predictions(current_user: dict = Depends(get_current_user)):
    preds = await db.late_payment_predictions.find({}, {"_id": 0}).to_list(50)
    if not preds:
        preds = await _seed_preds()
    return {"predictions": preds, "summary": {"total_clients": len(preds), "high_risk": len([p for p in preds if p.get("risk") == "high"]), "total_at_risk": sum(p.get("outstanding_amount", 0) for p in preds if p.get("risk") in ["high", "medium"])}}

async def _seed_preds():
    clients = [("Apex Hospitality", "high", 4500, 3, 89), ("Atlas Logistics", "medium", 2800, 2, 65), ("TechStart Inc", "low", 1200, 0, 12), ("Global Finance Ltd", "low", 3500, 0, 8), ("HealthCare Plus", "medium", 2100, 1, 55), ("Summit Legal", "high", 3800, 4, 92)]
    preds = []
    for name, risk, amount, late_count, prob in clients:
        p = {"id": f"lp-{uuid.uuid4().hex[:8]}", "client_name": name, "risk": risk, "outstanding_amount": amount, "late_history_count": late_count, "probability_pct": prob, "avg_days_late": random.randint(5, 30) if risk != "low" else 0, "recommended_action": "Send proactive reminder" if risk == "high" else "Monitor" if risk == "medium" else "No action needed", "next_invoice_date": (datetime.now(timezone.utc) + timedelta(days=random.randint(5, 30))).strftime("%Y-%m-%d")}
        preds.append(p)
        await db.late_payment_predictions.insert_one(p)
    return [{k: v for k, v in p.items() if k != "_id"} for p in preds]
