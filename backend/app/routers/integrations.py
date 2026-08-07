from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.models import *
from app.services.integrations import domotz_service, office365_service, acronis_service

router = APIRouter()

# NOTE: Pax8 endpoints moved to /app/backend/app/routers/pax8.py (v2 — live OAuth2, billing link-to-recurring, full sync).
# Old pax8_service stub removed.


# ============== DOMOTZ ENDPOINTS ==============

@router.get("/domotz/status")
async def get_domotz_status(current_user: dict = Depends(get_current_user)):
    settings = await db.settings.find_one({"type": "domotz"}, {"_id": 0})
    return {"configured": bool(settings and settings.get('api_key'))}

@router.post("/domotz/settings")
async def save_domotz_settings(settings: DomotzSettings, current_user: dict = Depends(get_current_user)):
    await db.settings.update_one(
        {"type": "domotz"},
        {"$set": {
            "type": "domotz",
            "api_key": settings.api_key,
            "api_url": settings.api_url,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }},
        upsert=True
    )
    return {"message": "Domotz settings saved"}

@router.get("/domotz/test-connection")
async def test_domotz_connection(current_user: dict = Depends(get_current_user)):
    try:
        agents = await domotz_service.get_agents()
        return {"success": True, "message": f"Connected! Found {len(agents) if isinstance(agents, list) else 0} agents"}
    except HTTPException:
        raise
    except Exception as e:
        return {"success": False, "message": str(e)}

@router.get("/domotz/agents")
async def get_domotz_agents(page: int = 0, page_size: int = 50, current_user: dict = Depends(get_current_user)):
    try:
        return await domotz_service.get_agents(page, page_size)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/domotz/agents/{agent_id}")
async def get_domotz_agent(agent_id: int, current_user: dict = Depends(get_current_user)):
    try:
        return await domotz_service.get_agent(agent_id)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/domotz/agents/{agent_id}/devices")
async def get_domotz_agent_devices(agent_id: int, page: int = 0, page_size: int = 100, current_user: dict = Depends(get_current_user)):
    try:
        return await domotz_service.get_agent_devices(agent_id, page, page_size)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/domotz/agents/{agent_id}/devices/{device_id}")
async def get_domotz_device(agent_id: int, device_id: int, current_user: dict = Depends(get_current_user)):
    try:
        return await domotz_service.get_device(agent_id, device_id)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/domotz/agents/{agent_id}/devices/{device_id}/details")
async def get_domotz_device_details(agent_id: int, device_id: int, current_user: dict = Depends(get_current_user)):
    try:
        return await domotz_service.get_device_details(agent_id, device_id)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/domotz/agents/{agent_id}/devices/{device_id}/power/{action}")
async def execute_domotz_power_action(agent_id: int, device_id: int, action: str, current_user: dict = Depends(get_current_user)):
    try:
        return await domotz_service.execute_power_action(agent_id, device_id, action)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/domotz/alerts")
async def get_domotz_alerts(agent_id: Optional[int] = None, current_user: dict = Depends(get_current_user)):
    try:
        return await domotz_service.get_alerts(agent_id)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============== OFFICE 365 / EMAIL ENDPOINTS ==============

@router.get("/office365/status")
async def get_office365_status(current_user: dict = Depends(get_current_user)):
    # The Mailbox & Email settings workspace is the canonical source for
    # Microsoft Graph intake and delivery. Keep support for the earlier
    # single Office 365 record so older installations remain readable.
    mailbox_settings = await db.settings.find_one({"type": "o365_mailbox"}, {"_id": 0})
    legacy_settings = await db.settings.find_one({"type": "office365"}, {"_id": 0})
    settings = mailbox_settings or legacy_settings or {}
    mailboxes = settings.get("mailboxes") or []
    configured = bool(
        settings.get("connected")
        and settings.get("tenant_id")
        and settings.get("client_id")
        and settings.get("client_secret")
        and (settings.get("outbound_mailbox_email") or settings.get("mailbox_email"))
    )
    if not mailbox_settings:
        configured = bool(
            legacy_settings
            and legacy_settings.get("tenant_id")
            and legacy_settings.get("client_id")
            and legacy_settings.get("client_secret")
        )
    return {
        "configured": configured,
        "provider": "microsoft_365",
        "sender_email": settings.get("outbound_mailbox_email") or settings.get("mailbox_email") or "",
        "mailbox_count": len(mailboxes) or (1 if settings.get("mailbox_email") else 0),
        "last_sync": settings.get("last_sync"),
        "live_sync_enabled": bool(settings.get("live_sync_enabled")),
    }

@router.post("/office365/settings")
async def save_office365_settings(settings: Office365Settings, current_user: dict = Depends(get_current_user)):
    await db.settings.update_one(
        {"type": "office365"},
        {"$set": {
            "type": "office365",
            "tenant_id": settings.tenant_id,
            "client_id": settings.client_id,
            "client_secret": settings.client_secret,
            "redirect_uri": settings.redirect_uri,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }},
        upsert=True
    )
    return {"message": "Office 365 settings saved"}

@router.get("/office365/test-connection")
async def test_office365_connection(current_user: dict = Depends(get_current_user)):
    try:
        await office365_service.authenticate()
        return {"success": True, "message": "Successfully connected to Office 365"}
    except Exception as e:
        return {"success": False, "message": str(e)}

@router.get("/emails")
async def get_emails(
    client_id: Optional[str] = None,
    ticket_id: Optional[str] = None,
    direction: Optional[str] = None,
    limit: int = 50,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if client_id:
        query["client_id"] = client_id
    if ticket_id:
        query["ticket_id"] = ticket_id
    if direction:
        query["direction"] = direction
    
    emails = await db.emails.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    for e in emails:
        if isinstance(e.get('created_at'), str):
            e['created_at'] = datetime.fromisoformat(e['created_at'])
    return emails

@router.post("/emails")
async def create_email(email_data: EmailMessageCreate, current_user: dict = Depends(get_current_user)):
    client_name = None
    if email_data.client_id:
        client = await db.clients.find_one({"id": email_data.client_id}, {"_id": 0})
        client_name = client['name'] if client else None
    
    from app.routers.email_signatures import append_default_signature
    body, body_type, _signature_id = await append_default_signature(
        body=email_data.body,
        body_type=email_data.body_type,
        current_user=current_user,
        subject=email_data.subject,
        ticket_id=email_data.ticket_id,
    )

    email = EmailMessage(
        subject=email_data.subject,
        body=body,
        body_type=body_type,
        from_address=current_user.get('email', ''),
        from_name=current_user.get('name'),
        to_addresses=email_data.to_addresses,
        cc_addresses=email_data.cc_addresses,
        client_id=email_data.client_id,
        client_name=client_name,
        ticket_id=email_data.ticket_id,
        direction="outbound",
        status="draft"
    )
    doc = email.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.emails.insert_one(doc)
    return email

@router.post("/emails/{email_id}/send")
async def send_email(email_id: str, current_user: dict = Depends(get_current_user)):
    email = await db.emails.find_one({"id": email_id}, {"_id": 0})
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    
    try:
        # Drafts created before signature support (or imported drafts) receive
        # the active sender's signature when they are actually dispatched.
        from app.routers.email_signatures import append_default_signature
        body, body_type, _signature_id = await append_default_signature(
            body=email.get("body", ""),
            body_type=email.get("body_type", "html"),
            current_user=current_user,
            subject=email.get("subject", ""),
            ticket_id=email.get("ticket_id"),
        )
        email["body"] = body
        email["body_type"] = body_type
        await db.emails.update_one({"id": email_id}, {"$set": {"body": body, "body_type": body_type}})

        # All manual correspondence uses the same Microsoft 365 delivery
        # gateway as tickets and invoices. Never mark a draft as sent until
        # Graph has accepted it and the client correspondence audit is stored.
        from app.routers.email_utils import send_email as send_microsoft365_email
        delivery = await send_microsoft365_email(
            email["to_addresses"], email["subject"],
            email["body"] if email["body_type"] == "html" else f"<pre>{email['body']}</pre>",
            category="ticket_replies" if email.get("ticket_id") else "notifications",
            cc_addresses=email.get("cc_addresses") or [],
            client_id=email.get("client_id"),
            related_type="ticket" if email.get("ticket_id") else "client_email",
            related_id=email.get("ticket_id") or email_id,
            initiated_by=current_user.get("id"),
            initiated_by_name=current_user.get("name"),
        )
        delivery_status = delivery.get("status", "failed")
        update = {"status": "sent" if delivery_status == "sent" else "failed", "delivery_status": delivery_status, "delivery_message": delivery.get("message", ""), "delivery_id": delivery.get("delivery_id")}
        if delivery_status == "sent":
            update["sent_at"] = datetime.now(timezone.utc).isoformat()
        await db.emails.update_one({"id": email_id}, {"$set": update})
        if delivery_status != "sent":
            raise HTTPException(status_code=502, detail=delivery.get("message") or "Microsoft 365 could not send this email")
        return {"message": "Email sent through Microsoft 365", "delivery_id": delivery.get("delivery_id")}
    except HTTPException:
        # Preserve the actionable delivery status (for example 502 when Graph
        # has not accepted the message) instead of wrapping it as an opaque 500.
        await db.emails.update_one({"id": email_id}, {"$set": {"status": "failed"}})
        raise
    except Exception as e:
        await db.emails.update_one({"id": email_id}, {"$set": {"status": "failed"}})
        raise HTTPException(status_code=500, detail="Email delivery failed unexpectedly") from e


# ============== ACRONIS ENDPOINTS ==============

@router.get("/acronis/status")
async def get_acronis_status(current_user: dict = Depends(get_current_user)):
    settings = await db.settings.find_one({"type": "acronis"}, {"_id": 0})
    return {"configured": bool(settings and settings.get('api_url') and settings.get('client_id'))}

@router.post("/acronis/settings")
async def save_acronis_settings(settings: AcronisSettings, current_user: dict = Depends(get_current_user)):
    await db.settings.update_one(
        {"type": "acronis"},
        {"$set": {
            "type": "acronis",
            "api_url": settings.api_url,
            "client_id": settings.client_id,
            "client_secret": settings.client_secret,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }},
        upsert=True
    )
    return {"message": "Acronis settings saved"}

@router.get("/acronis/test-connection")
async def test_acronis_connection(current_user: dict = Depends(get_current_user)):
    try:
        await acronis_service.authenticate()
        return {"success": True, "message": "Successfully connected to Acronis"}
    except Exception as e:
        return {"success": False, "message": str(e)}

@router.get("/acronis/subscriptions")
async def get_acronis_subscriptions(
    client_id: Optional[str] = None,
    device_id: Optional[str] = None,
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if client_id:
        query["client_id"] = client_id
    if device_id:
        query["device_id"] = device_id
    if status:
        query["status"] = status
    
    subscriptions = await db.acronis_subscriptions.find(query, {"_id": 0}).to_list(1000)
    for s in subscriptions:
        if isinstance(s.get('created_at'), str):
            s['created_at'] = datetime.fromisoformat(s['created_at'])
    return subscriptions

@router.post("/acronis/subscriptions")
async def create_acronis_subscription(sub_data: dict, current_user: dict = Depends(get_current_user)):
    client_name = None
    device_name = None
    
    if sub_data.get('client_id'):
        client = await db.clients.find_one({"id": sub_data['client_id']}, {"_id": 0})
        client_name = client['name'] if client else None
    
    if sub_data.get('device_id'):
        device = await db.devices.find_one({"id": sub_data['device_id']}, {"_id": 0})
        device_name = device['name'] if device else None
    
    subscription = AcronisSubscription(
        client_id=sub_data.get('client_id', ''),
        client_name=client_name,
        device_id=sub_data.get('device_id'),
        device_name=device_name,
        product_name=sub_data.get('product_name', 'Acronis Cyber Protect'),
        edition=sub_data.get('edition', 'Standard'),
        status=sub_data.get('status', 'active'),
        license_type=sub_data.get('license_type', 'per_device'),
        quantity=sub_data.get('quantity', 1),
        storage_quota_gb=sub_data.get('storage_quota_gb'),
        storage_used_gb=sub_data.get('storage_used_gb'),
        expiry_date=sub_data.get('expiry_date')
    )
    doc = subscription.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    if doc.get('last_backup'):
        doc['last_backup'] = doc['last_backup'].isoformat()
    if doc.get('synced_at'):
        doc['synced_at'] = doc['synced_at'].isoformat()
    await db.acronis_subscriptions.insert_one(doc)
    return subscription

@router.put("/acronis/subscriptions/{subscription_id}")
async def update_acronis_subscription(subscription_id: str, sub_data: dict, current_user: dict = Depends(get_current_user)):
    result = await db.acronis_subscriptions.update_one({"id": subscription_id}, {"$set": sub_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Subscription not found")
    return {"message": "Subscription updated"}

@router.delete("/acronis/subscriptions/{subscription_id}")
async def delete_acronis_subscription(subscription_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.acronis_subscriptions.delete_one({"id": subscription_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Subscription not found")
    return {"message": "Subscription deleted"}

@router.get("/acronis/dashboard")
async def get_acronis_dashboard(current_user: dict = Depends(get_current_user)):
    """Get Acronis dashboard summary"""
    total = await db.acronis_subscriptions.count_documents({})
    active = await db.acronis_subscriptions.count_documents({"status": "active"})
    expired = await db.acronis_subscriptions.count_documents({"status": "expired"})
    
    # Backup status summary
    backup_success = await db.acronis_subscriptions.count_documents({"backup_status": "success"})
    backup_warning = await db.acronis_subscriptions.count_documents({"backup_status": "warning"})
    backup_failed = await db.acronis_subscriptions.count_documents({"backup_status": "failed"})
    
    return {
        "total_subscriptions": total,
        "active": active,
        "expired": expired,
        "backup_status": {
            "success": backup_success,
            "warning": backup_warning,
            "failed": backup_failed
        }
    }

