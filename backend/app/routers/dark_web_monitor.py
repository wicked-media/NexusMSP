from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random; random = random.SystemRandom()
import uuid

router = APIRouter()

@router.get("/dark-web-monitor/overview")
async def dark_web_overview(current_user: dict = Depends(get_current_user)):
    alerts = await db.dark_web_alerts.find({}, {"_id": 0}).to_list(200)
    if not alerts:
        alerts = await _seed_alerts()
    total = len(alerts)
    critical = len([a for a in alerts if a.get("severity") == "critical"])
    return {"alerts": alerts, "summary": {"total_exposures": total, "critical": critical, "high": len([a for a in alerts if a.get("severity") == "high"]), "medium": len([a for a in alerts if a.get("severity") == "medium"]), "domains_monitored": 8, "last_scan": datetime.now(timezone.utc).isoformat(), "credentials_found": total, "resolved": len([a for a in alerts if a.get("status") == "resolved"])}}

@router.post("/dark-web-monitor/{alert_id}/resolve")
async def resolve_alert(alert_id: str, current_user: dict = Depends(get_current_user)):
    await db.dark_web_alerts.update_one({"id": alert_id}, {"$set": {"status": "resolved", "resolved_by": current_user.get("name"), "resolved_at": datetime.now(timezone.utc).isoformat()}})
    return {"status": "resolved"}

async def _seed_alerts():
    entries = [
        ("john.smith@techstart.com", "TechStart Inc", "critical", "combo_list", "Credential found in BreachForums combo list (Jan 2025)"),
        ("admin@globalfinance.com", "Global Finance Ltd", "critical", "database_dump", "Email + hashed password in leaked database"),
        ("sarah@healthcare-plus.com", "HealthCare Plus", "high", "dark_web_paste", "Credentials posted on dark web paste site"),
        ("it@novantech.com", "NovaTech Research", "medium", "stealer_log", "Found in Redline stealer logs"),
        ("accounts@atlas-logistics.com", "Atlas Logistics", "high", "phishing_kit", "Email found in phishing kit target list"),
        ("reception@apexhotel.com", "Apex Hospitality", "medium", "combo_list", "Credential in recycled combo list"),
        ("helpdesk@pacificschools.edu", "Pacific Schools District", "critical", "database_dump", "Plaintext password found in education sector breach"),
        ("admin@summitlegal.com", "Summit Legal", "high", "dark_web_market", "Credentials for sale on dark web marketplace"),
    ]
    alerts = []
    for email, client, severity, source, desc in entries:
        a = {"id": f"dwm-{uuid.uuid4().hex[:8]}", "email": email, "client_name": client, "severity": severity, "source_type": source, "description": desc, "found_at": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 30))).isoformat(), "status": random.choice(["active", "active", "resolved"]), "password_type": random.choice(["plaintext", "hashed_md5", "hashed_sha256", "unknown"])}
        alerts.append(a)
        await db.dark_web_alerts.insert_one(a)
    return [{k: v for k, v in a.items() if k != "_id"} for a in alerts]
