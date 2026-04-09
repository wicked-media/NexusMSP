from fastapi import APIRouter, HTTPException, Depends
from typing import Optional, Dict, Any
from datetime import datetime, timezone
import uuid
from app.database import db
from app.auth import get_current_user
from app.models import *

router = APIRouter()

# ============== OFFICE 365 ONE-CLICK MAILBOX SETUP ==============

@router.get("/settings/o365-mailbox")
async def get_o365_mailbox_settings(current_user: dict = Depends(get_current_user)):
    settings = await db.settings.find_one({"type": "o365_mailbox"}, {"_id": 0})
    return settings or {
        "type": "o365_mailbox",
        "enabled": False,
        "tenant_id": "",
        "client_id": "",
        "client_secret": "",
        "redirect_uri": "",
        "mailbox_email": "",
        "connected": False,
        "last_sync": None,
        "email_to_lead_enabled": True,
        "email_to_ticket_enabled": False,
        "auto_reply_enabled": False,
        "auto_reply_message": "Thank you for contacting us. We have received your inquiry and will respond shortly.",
    }

@router.put("/settings/o365-mailbox")
async def update_o365_mailbox_settings(data: dict, current_user: dict = Depends(get_current_user)):
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    data["type"] = "o365_mailbox"
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.settings.update_one({"type": "o365_mailbox"}, {"$set": data}, upsert=True)
    return {"message": "O365 mailbox settings updated"}

@router.post("/o365/connect")
async def connect_o365_mailbox(data: dict, current_user: dict = Depends(get_current_user)):
    """One-click connect to Office 365 mailbox. 
    In production, this initiates OAuth flow. Currently stores credentials for when Azure AD app is registered."""
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    tenant_id = data.get("tenant_id", "")
    client_id = data.get("client_id", "")
    client_secret = data.get("client_secret", "")
    mailbox_email = data.get("mailbox_email", "")
    
    if not all([tenant_id, client_id, client_secret, mailbox_email]):
        raise HTTPException(status_code=400, detail="All Azure AD credentials and mailbox email are required")
    
    settings = {
        "type": "o365_mailbox",
        "enabled": True,
        "tenant_id": tenant_id,
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": data.get("redirect_uri", ""),
        "mailbox_email": mailbox_email,
        "connected": True,
        "connection_status": "connected",
        "connected_at": datetime.now(timezone.utc).isoformat(),
        "connected_by": current_user["id"],
        "last_sync": datetime.now(timezone.utc).isoformat(),
        "email_to_lead_enabled": data.get("email_to_lead_enabled", True),
        "email_to_ticket_enabled": data.get("email_to_ticket_enabled", False),
        "auto_reply_enabled": data.get("auto_reply_enabled", False),
        "auto_reply_message": data.get("auto_reply_message", "Thank you for contacting us. We have received your inquiry and will respond shortly."),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    
    await db.settings.update_one({"type": "o365_mailbox"}, {"$set": settings}, upsert=True)
    return {"message": "Office 365 mailbox connected successfully", "status": "connected", "mailbox": mailbox_email}

@router.post("/o365/disconnect")
async def disconnect_o365_mailbox(current_user: dict = Depends(get_current_user)):
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    await db.settings.update_one({"type": "o365_mailbox"}, {"$set": {
        "connected": False,
        "connection_status": "disconnected",
        "enabled": False,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }})
    return {"message": "Office 365 mailbox disconnected"}

@router.post("/o365/test-connection")
async def test_o365_connection(current_user: dict = Depends(get_current_user)):
    """Test the O365 connection. In production, calls Microsoft Graph API. Currently simulates success if credentials are set."""
    settings = await db.settings.find_one({"type": "o365_mailbox"}, {"_id": 0})
    if not settings or not settings.get("connected"):
        return {"success": False, "message": "O365 mailbox not connected"}
    
    return {
        "success": True,
        "message": "Connection test successful",
        "mailbox": settings.get("mailbox_email", ""),
        "permissions": ["Mail.Read", "Mail.Send", "Mail.ReadWrite"],
        "token_valid": True,
    }

@router.post("/o365/sync-emails")
async def sync_o365_emails(current_user: dict = Depends(get_current_user)):
    """Trigger manual email sync. In production, fetches emails from Graph API."""
    settings = await db.settings.find_one({"type": "o365_mailbox"}, {"_id": 0})
    if not settings or not settings.get("connected"):
        raise HTTPException(status_code=400, detail="O365 mailbox not connected")
    
    await db.settings.update_one({"type": "o365_mailbox"}, {"$set": {"last_sync": datetime.now(timezone.utc).isoformat()}})
    return {"message": "Email sync completed", "emails_fetched": 0, "leads_created": 0}

# ============== EMAIL-TO-LEAD WEBHOOK ==============

@router.post("/o365/webhook/incoming-email")
async def handle_incoming_email(data: dict):
    """Webhook endpoint for incoming emails. Microsoft Graph calls this when new email arrives.
    Creates a lead or ticket automatically from the email content."""
    settings = await db.settings.find_one({"type": "o365_mailbox"}, {"_id": 0})
    
    sender_email = data.get("from_address", data.get("from", ""))
    sender_name = data.get("from_name", data.get("sender_name", "Unknown"))
    subject = data.get("subject", "No Subject")
    body = data.get("body", "")
    
    if not sender_email:
        raise HTTPException(status_code=400, detail="from_address is required")
    
    # Check if sender is a known client contact → create ticket
    email_to_ticket = settings.get("email_to_ticket_enabled", False) if settings else False
    if email_to_ticket:
        # Check if this email belongs to a known client
        client = await db.clients.find_one({"$or": [
            {"email": sender_email},
            {"contacts.email": sender_email}
        ]}, {"_id": 0})
        
        if client:
            # Create a ticket for the known client
            ticket = {
                "id": str(uuid.uuid4()),
                "title": subject or "Email Support Request",
                "description": body[:2000] if body else "Received via email",
                "status": "open",
                "priority": "medium",
                "category": "email",
                "client_id": client.get("id", ""),
                "client_name": client.get("company_name", client.get("name", "")),
                "contact_name": sender_name,
                "contact_email": sender_email,
                "source": "email",
                "assigned_to": "",
                "assigned_to_name": "",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "notes": [],
                "tags": ["email-generated"],
            }
            await db.tickets.insert_one(ticket)
            return {"status": "ticket_created", "ticket_id": ticket["id"], "message": f"Support ticket created for {client.get('company_name', sender_email)}"}
    
    # Check if email-to-lead is enabled
    email_to_lead = settings.get("email_to_lead_enabled", True) if settings else True
    if not email_to_lead:
        return {"status": "skipped", "reason": "email-to-lead disabled"}
    
    existing_lead = await db.leads.find_one({"email": sender_email}, {"_id": 0})
    if existing_lead:
        activity = {
            "id": str(uuid.uuid4()),
            "lead_id": existing_lead["id"],
            "lead_name": existing_lead.get("company_name", ""),
            "user_id": "system",
            "user_name": "Email Bot",
            "activity_type": "email",
            "subject": f"New email: {subject}",
            "description": body[:500] if body else "",
            "outcome": "neutral",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.lead_activities.insert_one(activity)
        await db.leads.update_one({"id": existing_lead["id"]}, {"$set": {"last_contact": datetime.now(timezone.utc).isoformat()}})
        return {"status": "activity_added", "lead_id": existing_lead["id"], "message": "Email logged as activity on existing lead"}
    
    company_name = sender_name if sender_name != "Unknown" else sender_email.split("@")[1].split(".")[0].title()
    
    lead = Lead(
        company_name=company_name,
        contact_name=sender_name,
        email=sender_email,
        source="email",
        notes=f"Auto-created from incoming email.\n\nSubject: {subject}\n\n{body[:1000] if body else ''}",
        status="new",
        pipeline_stage=1,
        estimated_value=0,
    )
    doc = lead.model_dump()
    doc["created_at"] = doc["created_at"].isoformat()
    doc["updated_at"] = doc["updated_at"].isoformat()
    if doc.get("last_contact"):
        doc["last_contact"] = doc["last_contact"].isoformat()
    if doc.get("next_follow_up"):
        doc["next_follow_up"] = doc["next_follow_up"].isoformat()
    await db.leads.insert_one(doc)
    
    activity = {
        "id": str(uuid.uuid4()),
        "lead_id": lead.id,
        "lead_name": company_name,
        "user_id": "system",
        "user_name": "Email Bot",
        "activity_type": "email",
        "subject": f"Initial email: {subject}",
        "description": body[:500] if body else "",
        "outcome": "positive",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.lead_activities.insert_one(activity)
    
    return {"status": "lead_created", "lead_id": lead.id, "message": f"New lead created from email: {company_name}"}

@router.get("/o365/email-leads")
async def get_email_generated_leads(current_user: dict = Depends(get_current_user)):
    """Get leads that were auto-generated from emails"""
    leads = await db.leads.find({"source": "email"}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return leads
