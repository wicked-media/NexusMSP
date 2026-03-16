from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from datetime import datetime, timezone, timedelta
import uuid
import httpx
from app.database import db
from app.auth import get_current_user

router = APIRouter()

SUPED_BASE_URL = "https://www.suped.com/api"

SUPED_SERVICES = [
    {"key": "dmarc_monitoring", "name": "DMARC Monitoring", "description": "Monitor DMARC reports and email authentication"},
    {"key": "hosted_dmarc", "name": "Hosted DMARC", "description": "Managed DMARC DNS record hosting"},
    {"key": "hosted_spf", "name": "Hosted SPF", "description": "Managed SPF DNS record hosting with flattening"},
    {"key": "hosted_mta_sts", "name": "Hosted MTA-STS", "description": "Managed MTA-STS policy hosting"},
    {"key": "spf_flattening", "name": "SPF Flattening", "description": "Automatic SPF record optimization"},
    {"key": "blocklist_monitoring", "name": "Blocklist Monitoring", "description": "Monitor IP/domain blocklist status"},
]

# ============== SUPED SETTINGS ==============

@router.get("/settings/suped")
async def get_suped_settings(current_user: dict = Depends(get_current_user)):
    settings_doc = await db.settings.find_one({"type": "suped"}, {"_id": 0})
    if not settings_doc:
        return {"type": "suped", "api_key": "", "configured": False}
    settings_doc.pop("api_key_full", None)
    return settings_doc

@router.put("/settings/suped")
async def update_suped_settings(data: dict, current_user: dict = Depends(get_current_user)):
    api_key = data.get("api_key", "")
    masked = f"{'*' * max(0, len(api_key) - 8)}{api_key[-8:]}" if len(api_key) > 8 else "***"
    await db.settings.update_one({"type": "suped"}, {"$set": {
        "type": "suped",
        "api_key_full": api_key,
        "api_key": masked,
        "configured": bool(api_key),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }}, upsert=True)
    return {"message": "Suped settings saved", "configured": bool(api_key)}

# ============== CLIENT SUBSCRIPTIONS ==============

@router.get("/clients/{client_id}/subscriptions")
async def get_client_subscriptions(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    subs = await db.client_subscriptions.find_one({"client_id": client_id}, {"_id": 0})
    if not subs:
        default_subs = {
            "client_id": client_id,
            "suped_org_id": "",
            "services": {s["key"]: False for s in SUPED_SERVICES},
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        return default_subs
    return subs

@router.put("/clients/{client_id}/subscriptions")
async def update_client_subscriptions(client_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    update = {
        "client_id": client_id,
        "suped_org_id": data.get("suped_org_id", ""),
        "services": data.get("services", {}),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.client_subscriptions.update_one(
        {"client_id": client_id}, {"$set": update}, upsert=True
    )
    return {"message": "Subscriptions updated"}

@router.get("/clients/subscriptions/summary")
async def get_all_subscriptions_summary(current_user: dict = Depends(get_current_user)):
    subs = await db.client_subscriptions.find({}, {"_id": 0}).to_list(1000)
    summary = {}
    for s in subs:
        active_count = sum(1 for v in s.get("services", {}).values() if v)
        total = len(SUPED_SERVICES)
        summary[s["client_id"]] = {
            "active_count": active_count,
            "total": total,
            "has_suped": bool(s.get("suped_org_id")),
            "suped_org_id": s.get("suped_org_id", ""),
            "services": s.get("services", {}),
        }
    return summary

# ============== DMARC RECORDS PROXY ==============

@router.get("/clients/{client_id}/dmarc-records")
async def get_client_dmarc_records(
    client_id: str,
    days: int = 30,
    current_user: dict = Depends(get_current_user)
):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    subs = await db.client_subscriptions.find_one({"client_id": client_id}, {"_id": 0})
    if not subs or not subs.get("suped_org_id"):
        return {"records": [], "message": "No Suped Organization ID configured for this client"}

    settings_doc = await db.settings.find_one({"type": "suped"}, {"_id": 0})
    if not settings_doc or not settings_doc.get("api_key_full"):
        return {"records": [], "message": "Suped API key not configured. Go to Settings to add it."}

    api_key = settings_doc["api_key_full"]
    org_id = subs["suped_org_id"]
    end_date = datetime.now(timezone.utc)
    start_date = end_date - timedelta(days=days)

    try:
        async with httpx.AsyncClient(timeout=30) as http_client:
            resp = await http_client.get(
                f"{SUPED_BASE_URL}/public/dmarc-records",
                params={
                    "organizationId": org_id,
                    "startDate": start_date.isoformat(),
                    "endDate": end_date.isoformat(),
                },
                headers={"Authorization": f"Bearer {api_key}"}
            )
            if resp.status_code == 200:
                data = resp.json()
                records = data if isinstance(data, list) else data.get("dmarcRecords", [])
                # Build summary stats
                total_emails = sum(r.get("emails", 0) for r in records)
                authorized = sum(r.get("emails", 0) for r in records if r.get("category") == "authorized")
                rejected = sum(r.get("emails", 0) for r in records if r.get("category") == "rejected")
                quarantined = sum(r.get("emails", 0) for r in records if r.get("category") == "quarantined")
                sources = {}
                for r in records:
                    src = r.get("source", "Unknown")
                    sources[src] = sources.get(src, 0) + r.get("emails", 0)
                top_sources = sorted(sources.items(), key=lambda x: x[1], reverse=True)[:10]

                return {
                    "records": records[:200],
                    "summary": {
                        "total_emails": total_emails,
                        "authorized": authorized,
                        "rejected": rejected,
                        "quarantined": quarantined,
                        "compliance_rate": round((authorized / total_emails * 100), 1) if total_emails > 0 else 0,
                        "unique_sources": len(sources),
                        "top_sources": [{"source": s, "count": c} for s, c in top_sources],
                        "period_days": days,
                    },
                }
            elif resp.status_code == 403:
                return {"records": [], "message": "API key does not have access to this organization"}
            else:
                return {"records": [], "message": f"Suped API returned status {resp.status_code}"}
    except Exception as e:
        return {"records": [], "message": f"Failed to fetch from Suped: {str(e)[:100]}"}

@router.get("/suped/services")
async def get_suped_services(current_user: dict = Depends(get_current_user)):
    return SUPED_SERVICES
