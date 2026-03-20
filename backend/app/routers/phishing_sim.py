from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random, uuid

router = APIRouter()

@router.get("/phishing-sim/campaigns")
async def get_campaigns(current_user: dict = Depends(get_current_user)):
    campaigns = await db.phishing_campaigns.find({}, {"_id": 0}).to_list(50)
    if not campaigns:
        campaigns = await _seed_campaigns()
    return {"campaigns": campaigns, "summary": {"total_campaigns": len(campaigns), "total_emails_sent": sum(c.get("emails_sent", 0) for c in campaigns), "avg_click_rate": round(sum(c.get("click_rate_pct", 0) for c in campaigns) / max(len(campaigns), 1), 1), "avg_report_rate": round(sum(c.get("report_rate_pct", 0) for c in campaigns) / max(len(campaigns), 1), 1)}}

@router.post("/phishing-sim/campaigns")
async def create_campaign(data: dict, current_user: dict = Depends(get_current_user)):
    c = {"id": f"psc-{uuid.uuid4().hex[:8]}", **data, "status": "scheduled", "created_by": current_user.get("name"), "created_at": datetime.now(timezone.utc).isoformat(), "emails_sent": 0, "click_rate_pct": 0, "report_rate_pct": 0}
    await db.phishing_campaigns.insert_one(c)
    c.pop("_id", None)
    return c

async def _seed_campaigns():
    templates = [
        ("Password Reset Required", "microsoft_365", "TechStart Inc", 45, 18.2, 62.5),
        ("Invoice #INV-2025-0389 Attached", "invoice_scam", "Global Finance Ltd", 82, 12.8, 48.0),
        ("Shared Document: Q4 Budget Review", "google_drive", "HealthCare Plus", 38, 22.1, 35.7),
        ("IT Security Training - Action Required", "internal_it", "All Clients", 210, 8.5, 71.2),
        ("Delivery Notification - Package Held", "shipping_scam", "Atlas Logistics", 55, 15.6, 52.3),
    ]
    campaigns = []
    for title, template, client, sent, click, report in templates:
        c = {"id": f"psc-{uuid.uuid4().hex[:8]}", "name": title, "template_type": template, "client_name": client, "emails_sent": sent, "click_rate_pct": click, "report_rate_pct": report, "opened_pct": round(click + random.uniform(15, 30), 1), "submitted_credentials_pct": round(click * random.uniform(0.3, 0.6), 1), "status": "completed", "sent_at": (datetime.now(timezone.utc) - timedelta(days=random.randint(7, 90))).isoformat(), "created_by": "Alex Thompson"}
        campaigns.append(c)
        await db.phishing_campaigns.insert_one(c)
    return [{k: v for k, v in c.items() if k != "_id"} for c in campaigns]
