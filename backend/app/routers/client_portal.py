from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import uuid

router = APIRouter()

@router.get("/client-portal/config")
async def get_portal_config(current_user: dict = Depends(get_current_user)):
    config = await db.client_portal_config.find_one({}, {"_id": 0})
    if not config:
        config = {"id": "portal-config-001", "enabled": True, "allow_ticket_creation": True, "allow_ticket_viewing": True, "allow_estimate_approval": True, "allow_invoice_viewing": True, "allow_asset_viewing": True, "branding": {"logo_url": "", "primary_color": "#3b82f6", "company_name": "NexusOps MSP"}, "features": {"knowledge_base": True, "status_page": True, "file_sharing": True}, "created_at": datetime.now(timezone.utc).isoformat()}
        await db.client_portal_config.insert_one(config)
        config.pop("_id", None)
    return config

@router.put("/client-portal/config")
async def update_portal_config(data: dict, current_user: dict = Depends(get_current_user)):
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.client_portal_config.update_one({}, {"$set": data}, upsert=True)
    return {"status": "updated"}

@router.get("/client-portal/access-logs")
async def get_portal_access_logs(current_user: dict = Depends(get_current_user)):
    logs = await db.portal_access_logs.find({}, {"_id": 0}).sort("timestamp", -1).to_list(100)
    if not logs:
        now = datetime.now(timezone.utc)
        logs = [
            {"id": "pal-001", "client_id": "client-001", "client_name": "Acme Corporation", "user_email": "it@acme.com", "action": "viewed_tickets", "ip_address": "203.45.67.10", "timestamp": (now - timedelta(hours=1)).isoformat()},
            {"id": "pal-002", "client_id": "client-003", "client_name": "Global Finance Ltd", "user_email": "helpdesk@globalfin.com", "action": "created_ticket", "ip_address": "91.23.45.67", "timestamp": (now - timedelta(hours=3)).isoformat()},
            {"id": "pal-003", "client_id": "client-004", "client_name": "HealthCare Plus", "user_email": "it@hcplus.org", "action": "approved_estimate", "ip_address": "67.89.12.34", "timestamp": (now - timedelta(hours=5)).isoformat()},
            {"id": "pal-004", "client_id": "client-001", "client_name": "Acme Corporation", "user_email": "jane.doe@acme.com", "action": "viewed_invoices", "ip_address": "203.45.67.12", "timestamp": (now - timedelta(hours=8)).isoformat()},
            {"id": "pal-005", "client_id": "client-002", "client_name": "TechStart Inc", "user_email": "support@techstart.io", "action": "downloaded_report", "ip_address": "45.67.89.12", "timestamp": (now - timedelta(days=1)).isoformat()},
        ]
        for l in logs:
            await db.portal_access_logs.insert_one(l)
        logs = [dict((k, v) for k, v in l.items() if k != "_id") for l in logs]
    return logs

@router.get("/client-portal/invitations")
async def get_portal_invitations(current_user: dict = Depends(get_current_user)):
    invitations = await db.portal_invitations.find({}, {"_id": 0}).to_list(100)
    return invitations

@router.post("/client-portal/invite")
async def invite_client_user(data: dict, current_user: dict = Depends(get_current_user)):
    invitation = {"id": f"inv-{uuid.uuid4().hex[:8]}", "client_id": data["client_id"], "client_name": data.get("client_name", ""), "email": data["email"], "role": data.get("role", "viewer"), "status": "pending", "invited_by": current_user.get("name"), "created_at": datetime.now(timezone.utc).isoformat()}
    await db.portal_invitations.insert_one(invitation)
    invitation.pop("_id", None)
    return invitation
