from fastapi import APIRouter, Depends
from datetime import datetime, timezone
from app.database import db
from app.auth import get_current_user
import uuid

router = APIRouter()

@router.get("/alert-suppression/rules")
async def get_suppression_rules(current_user: dict = Depends(get_current_user)):
    return await db.alert_suppression_rules.find({}, {"_id": 0}).to_list(200)

@router.post("/alert-suppression/rules")
async def create_rule(data: dict, current_user: dict = Depends(get_current_user)):
    rule = {**data, "id": f"asr-{uuid.uuid4().hex[:8]}", "created_by": current_user.get("name"), "created_at": datetime.now(timezone.utc).isoformat(), "suppressed_count": 0, "enabled": True}
    await db.alert_suppression_rules.insert_one(rule)
    rule.pop("_id", None)
    return rule

@router.put("/alert-suppression/rules/{rule_id}")
async def update_rule(rule_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.alert_suppression_rules.update_one({"id": rule_id}, {"$set": data})
    return {"status": "updated"}

@router.delete("/alert-suppression/rules/{rule_id}")
async def delete_rule(rule_id: str, current_user: dict = Depends(get_current_user)):
    await db.alert_suppression_rules.delete_one({"id": rule_id})
    return {"status": "deleted"}

@router.get("/alert-suppression/stats")
async def get_suppression_stats(current_user: dict = Depends(get_current_user)):
    rules = await db.alert_suppression_rules.find({}, {"_id": 0}).to_list(200)
    total_suppressed = sum(r.get("suppressed_count", 0) for r in rules)
    active_rules = sum(1 for r in rules if r.get("enabled"))
    return {"total_rules": len(rules), "active_rules": active_rules, "total_suppressed": total_suppressed, "estimated_time_saved_hours": round(total_suppressed * 0.15, 1)}
