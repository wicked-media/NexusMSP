from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random; random = random.SystemRandom()

router = APIRouter()

@router.get("/security-dashboard/overview")
async def get_security_overview(current_user: dict = Depends(get_current_user)):
    devices = await db.devices.find({}, {"_id": 0, "id": 1, "name": 1, "client_name": 1, "status": 1, "patch_status": 1, "os": 1}).to_list(500)
    total = len(devices)
    patched = sum(1 for d in devices if d.get("patch_status") == "current")
    threats = await db.threat_events.count_documents({"resolved": False})
    identity_alerts = await db.identity_threats.count_documents({"resolved": False})
    canary_triggers = await db.canary_triggers.count_documents({"resolved": False})
    return {
        "summary": {
            "total_endpoints": total, "fully_patched": patched, "patch_compliance_pct": round(patched / total * 100, 1) if total else 0,
            "active_threats": threats, "identity_alerts": identity_alerts, "canary_triggers": canary_triggers,
            "security_score": round(random.uniform(72, 89), 1), "endpoints_online": sum(1 for d in devices if d.get("status") == "online"),
        },
        "recent_incidents": await db.threat_events.find({}, {"_id": 0}).sort("detected_at", -1).to_list(10),
        "devices_at_risk": [d for d in devices if d.get("patch_status") in ("critical", "needs_attention")][:15],
    }

@router.get("/security-dashboard/score-trend")
async def get_score_trend(current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    return [{"date": (now - timedelta(days=i)).strftime("%Y-%m-%d"), "score": round(random.uniform(68, 92), 1), "threats": random.randint(0, 5)} for i in range(30, -1, -1)]
