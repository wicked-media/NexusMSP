from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.models import *
from app.services.integrations import pax8_service, domotz_service, office365_service, acronis_service

router = APIRouter()

# ============== PAX8 ENDPOINTS ==============

@router.get("/pax8/status")
async def get_pax8_status(current_user: dict = Depends(get_current_user)):
    settings = await db.settings.find_one({"type": "pax8"}, {"_id": 0})
    return {"configured": bool(settings and settings.get('client_id'))}

@router.post("/pax8/settings")
async def save_pax8_settings(settings: Pax8Settings, current_user: dict = Depends(get_current_user)):
    await db.settings.update_one(
        {"type": "pax8"},
        {"$set": {
            "type": "pax8",
            "client_id": settings.client_id,
            "client_secret": settings.client_secret,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }},
        upsert=True
    )
    return {"message": "Pax8 settings saved"}

@router.get("/pax8/test-connection")
async def test_pax8_connection(current_user: dict = Depends(get_current_user)):
    try:
        await pax8_service.authenticate()
        return {"success": True, "message": "Successfully connected to Pax8"}
    except Exception as e:
        return {"success": False, "message": str(e)}

@router.get("/pax8/subscriptions")
async def get_pax8_subscriptions(company_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    try:
        return await pax8_service.get_subscriptions(company_id)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/pax8/products")
async def get_pax8_products(page: int = 0, size: int = 50, current_user: dict = Depends(get_current_user)):
    try:
        return await pax8_service.get_products(page, size)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/pax8/companies")
async def get_pax8_companies(page: int = 0, size: int = 50, current_user: dict = Depends(get_current_user)):
    try:
        return await pax8_service.get_companies(page, size)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/pax8/sync-subscriptions/{client_id}")
async def sync_pax8_subscriptions(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    
    if not client.get('pax8_company_id'):
        raise HTTPException(status_code=400, detail="Client not linked to Pax8 company")
    
    try:
        subscriptions = await pax8_service.get_subscriptions(client['pax8_company_id'])
        synced = 0
        
        for sub in subscriptions.get('content', []):
            existing = await db.line_items.find_one({
                "pax8_subscription_id": sub['id'],
                "client_id": client_id
            })
            
            line_item_data = {
                "client_id": client_id,
                "client_name": client['name'],
                "name": sub.get('productName', 'Unknown Product'),
                "description": f"Pax8 Subscription - {sub.get('commitment', {}).get('term', 'N/A')}",
                "quantity": sub.get('quantity', 1),
                "unit_price": sub.get('price', 0),
                "total": sub.get('quantity', 1) * sub.get('price', 0),
                "billing_frequency": "monthly",
                "pax8_subscription_id": sub['id'],
                "pax8_product_id": sub.get('productId'),
                "synced_at": datetime.now(timezone.utc).isoformat()
            }
            
            if existing:
                await db.line_items.update_one(
                    {"id": existing['id']},
                    {"$set": line_item_data}
                )
            else:
                line_item_data['id'] = str(uuid.uuid4())
                line_item_data['contract_id'] = ""
                line_item_data['created_at'] = datetime.now(timezone.utc).isoformat()
                await db.line_items.insert_one(line_item_data)
            
            synced += 1
        
        return {"message": f"Synced {synced} subscriptions from Pax8", "count": synced}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/pax8/link-client/{client_id}")
async def link_client_to_pax8(client_id: str, pax8_company_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.clients.update_one(
        {"id": client_id},
        {"$set": {"pax8_company_id": pax8_company_id}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Client not found")
    return {"message": "Client linked to Pax8 company"}


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
    settings = await db.settings.find_one({"type": "office365"}, {"_id": 0})
    return {"configured": bool(settings and settings.get('tenant_id') and settings.get('client_id'))}

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
    
    email = EmailMessage(
        subject=email_data.subject,
        body=email_data.body,
        body_type=email_data.body_type,
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
        # Try to send via Office 365 if configured
        status = await get_office365_status(current_user)
        if status['configured']:
            await office365_service.send_email(
                from_address=email['from_address'],
                to_addresses=email['to_addresses'],
                subject=email['subject'],
                body=email['body'],
                body_type=email['body_type']
            )
        
        await db.emails.update_one(
            {"id": email_id},
            {"$set": {"status": "sent", "sent_at": datetime.now(timezone.utc).isoformat()}}
        )
        return {"message": "Email sent successfully"}
    except Exception as e:
        await db.emails.update_one({"id": email_id}, {"$set": {"status": "failed"}})
        raise HTTPException(status_code=500, detail=str(e))


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

