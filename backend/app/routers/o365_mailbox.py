from fastapi import APIRouter, HTTPException, Depends
from typing import Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
import httpx
import re
from html import escape
from app.database import db
from app.auth import get_current_user
from app.models import *

router = APIRouter()
OUTBOUND_ROLES = {"ticket_comments", "ticket_replies", "billing", "lead_responses", "notifications"}

# ============== OFFICE 365 ONE-CLICK MAILBOX SETUP ==============

@router.get("/settings/o365-mailbox")
async def get_o365_mailbox_settings(current_user: dict = Depends(get_current_user)):
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "role": 1, "is_admin": 1})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    settings = await db.settings.find_one({"type": "o365_mailbox"}, {"_id": 0})
    if settings and "mailboxes" not in settings:
        # Preserve older single-mailbox settings as the first managed mailbox.
        legacy_email = settings.get("mailbox_email")
        settings["mailboxes"] = ([{
            "id": "legacy-primary", "mailbox_email": legacy_email,
            "tenant_id": settings.get("tenant_id", ""), "client_id": settings.get("client_id", ""),
            "connected": settings.get("connected", False), "connection_status": settings.get("connection_status", "disconnected"),
            "email_to_lead_enabled": settings.get("email_to_lead_enabled", True),
            "email_to_ticket_enabled": settings.get("email_to_ticket_enabled", False),
            "last_sync": settings.get("last_sync"),
        }] if legacy_email else [])
    if settings:
        safe_settings = {**settings, "client_secret": "", "client_secret_set": bool(settings.get("client_secret"))}
        return safe_settings
    return settings or {
        "type": "o365_mailbox",
        "enabled": False,
        "tenant_id": "",
        "client_id": "",
        "client_secret": "",
        "client_secret_set": False,
        "redirect_uri": "",
        "mailbox_email": "",
        "outbound_mailbox_email": "",
        "outbound_routing": {},
        "connected": False,
        "live_sync_enabled": False,
        "mail_sync_enabled": True,
        "mail_sync_interval_minutes": 5,
        "last_sync": None,
        "email_to_lead_enabled": True,
        "email_to_ticket_enabled": False,
        "auto_reply_enabled": False,
        "mailboxes": [],
        "auto_reply_message": "Thank you for contacting us. We have received your inquiry and will respond shortly.",
    }

@router.put("/settings/o365-mailbox")
async def update_o365_mailbox_settings(data: dict, current_user: dict = Depends(get_current_user)):
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    # The settings card submits only fallback preferences. Preserve saved
    # inboxes and connection details when it updates those preferences.
    existing = await db.settings.find_one({"type": "o365_mailbox"}, {"_id": 0}) or {}
    allowed = {
        "email_to_lead_enabled", "email_to_ticket_enabled", "auto_reply_enabled",
        "auto_reply_message", "redirect_uri", "outbound_mailbox_email", "outbound_routing",
        "mail_sync_enabled", "mail_sync_interval_minutes",
    }
    updated = {key: value for key, value in data.items() if key in allowed}
    requested_sender = (updated.get("outbound_mailbox_email") or "").strip().lower()
    if requested_sender:
        available = {str(mailbox.get("mailbox_email") or "").strip().lower() for mailbox in existing.get("mailboxes", [])}
        if requested_sender not in available:
            raise HTTPException(status_code=400, detail="Select one of the connected mailboxes as the outbound sender")
    if "outbound_routing" in updated:
        routing = updated["outbound_routing"]
        if not isinstance(routing, dict) or set(routing) != OUTBOUND_ROLES:
            raise HTTPException(status_code=400, detail="Assign exactly one connected mailbox to every outbound email role")
        available = {str(mailbox.get("mailbox_email") or "").strip().lower() for mailbox in existing.get("mailboxes", [])}
        for role, address in routing.items():
            if not str(address or "").strip().lower() or str(address).strip().lower() not in available:
                raise HTTPException(status_code=400, detail=f"{role} must use one connected mailbox")
    updated["type"] = "o365_mailbox"
    updated["updated_at"] = datetime.now(timezone.utc).isoformat()
    if "mailboxes" not in existing:
        updated["mailboxes"] = []
    await db.settings.update_one({"type": "o365_mailbox"}, {"$set": updated}, upsert=True)
    return {"message": "O365 mailbox settings updated"}

@router.post("/o365/connect")
async def connect_o365_mailbox(data: dict, current_user: dict = Depends(get_current_user)):
    """One-click connect to Office 365 mailbox. 
    In production, this initiates OAuth flow. Currently stores credentials for when Azure AD app is registered."""
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    existing = await db.settings.find_one({"type": "o365_mailbox"}, {"_id": 0}) or {}
    tenant_id = data.get("tenant_id", "")
    client_id = data.get("client_id", "")
    client_secret = data.get("client_secret", "")
    if str(client_secret).strip() in {"", "********"}:
        client_secret = existing.get("client_secret", "")
    mailbox_email = data.get("mailbox_email", "")
    
    if not all([tenant_id, client_id, client_secret, mailbox_email]):
        raise HTTPException(status_code=400, detail="All Azure AD credentials and mailbox email are required")
    
    mailboxes = existing.get("mailboxes", [])
    mailboxes = [m for m in mailboxes if m.get("mailbox_email", "").lower() != mailbox_email.lower()]
    mailbox = {
        "id": f"mbx-{uuid.uuid4().hex[:8]}", "tenant_id": tenant_id, "client_id": client_id,
        "mailbox_email": mailbox_email, "connected": True, "connection_status": "connected",
        "connected_at": datetime.now(timezone.utc).isoformat(), "last_sync": datetime.now(timezone.utc).isoformat(),
        "email_to_lead_enabled": data.get("email_to_lead_enabled", True),
        "email_to_ticket_enabled": data.get("email_to_ticket_enabled", False),
    }
    mailboxes.append(mailbox)
    primary_sender = existing.get("outbound_mailbox_email") or existing.get("mailbox_email") or mailbox_email
    routing = existing.get("outbound_routing") or {role: primary_sender for role in OUTBOUND_ROLES}
    settings = {
        "type": "o365_mailbox",
        "enabled": True,
        "tenant_id": tenant_id,
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": data.get("redirect_uri", ""),
        "mailbox_email": primary_sender,
        "outbound_mailbox_email": primary_sender,
        "outbound_routing": routing,
        "connected": True,
        "live_sync_enabled": False,
        "mail_sync_enabled": existing.get("mail_sync_enabled", True),
        "mail_sync_interval_minutes": existing.get("mail_sync_interval_minutes", 5),
        "connection_status": "connected",
        "connected_at": datetime.now(timezone.utc).isoformat(),
        "connected_by": current_user["id"],
        "last_sync": datetime.now(timezone.utc).isoformat(),
        "email_to_lead_enabled": data.get("email_to_lead_enabled", True),
        "email_to_ticket_enabled": data.get("email_to_ticket_enabled", False),
        "auto_reply_enabled": data.get("auto_reply_enabled", False),
        "auto_reply_message": data.get("auto_reply_message", "Thank you for contacting us. We have received your inquiry and will respond shortly."),
        "mailboxes": mailboxes,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    
    await db.settings.update_one({"type": "o365_mailbox"}, {"$set": settings}, upsert=True)
    return {"message": "Office 365 mailbox connected successfully", "status": "connected", "mailbox": mailbox_email}

@router.delete("/o365/mailboxes/{mailbox_id}")
async def remove_o365_mailbox(mailbox_id: str, current_user: dict = Depends(get_current_user)):
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    settings = await db.settings.find_one({"type": "o365_mailbox"}, {"_id": 0})
    if not settings:
        raise HTTPException(status_code=404, detail="Mailbox settings not found")
    mailboxes = settings.get("mailboxes", [])
    remaining = [m for m in mailboxes if m.get("id") != mailbox_id]
    if len(remaining) == len(mailboxes):
        raise HTTPException(status_code=404, detail="Mailbox not found")
    await db.settings.update_one({"type": "o365_mailbox"}, {"$set": {"mailboxes": remaining, "connected": bool(remaining), "enabled": bool(remaining), "updated_at": datetime.now(timezone.utc).isoformat()}})
    return {"message": "Mailbox removed", "remaining": len(remaining)}


@router.patch("/o365/mailboxes/{mailbox_id}")
async def update_o365_mailbox(mailbox_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Update the routing policy for one connected inbox without reconnecting it."""
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    settings = await db.settings.find_one({"type": "o365_mailbox"}, {"_id": 0})
    if not settings:
        raise HTTPException(status_code=404, detail="Mailbox settings not found")

    allowed = {"email_to_lead_enabled", "email_to_ticket_enabled"}
    changes = {key: value for key, value in data.items() if key in allowed}
    if not changes:
        raise HTTPException(status_code=400, detail="No mailbox routing changes supplied")

    found = False
    mailboxes = []
    for mailbox in settings.get("mailboxes", []):
        if mailbox.get("id") == mailbox_id:
            mailbox = {**mailbox, **changes, "updated_at": datetime.now(timezone.utc).isoformat()}
            found = True
        mailboxes.append(mailbox)
    if not found:
        raise HTTPException(status_code=404, detail="Mailbox not found")
    await db.settings.update_one(
        {"type": "o365_mailbox"},
        {"$set": {"mailboxes": mailboxes, "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    updated = next(mailbox for mailbox in mailboxes if mailbox.get("id") == mailbox_id)
    return {"message": "Mailbox routing updated", "mailbox": updated}

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
    """Verify the saved Microsoft Graph app credentials and shared mailbox access."""
    settings = await db.settings.find_one({"type": "o365_mailbox"}, {"_id": 0})
    if not settings or not settings.get("connected"):
        return {"success": False, "message": "O365 mailbox not connected"}
    mailbox = settings.get("outbound_mailbox_email") or settings.get("mailbox_email", "")
    required = ("tenant_id", "client_id", "client_secret")
    if not mailbox or not all(settings.get(field) for field in required):
        return {"success": False, "message": "Mailbox or Microsoft Graph credentials are incomplete", "mailbox": mailbox}
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            token_response = await client.post(
                f"https://login.microsoftonline.com/{settings['tenant_id']}/oauth2/v2.0/token",
                data={"client_id": settings["client_id"], "client_secret": settings["client_secret"], "scope": "https://graph.microsoft.com/.default", "grant_type": "client_credentials"},
            )
            if token_response.status_code != 200:
                message = "Microsoft 365 authentication failed. Verify the Tenant ID, Client ID, secret, and admin consent."
                await db.settings.update_one({"type": "o365_mailbox"}, {"$set": {"live_sync_enabled": False, "last_connection_test_at": datetime.now(timezone.utc).isoformat(), "last_connection_test_status": "failed"}})
                return {"success": False, "message": message, "mailbox": mailbox, "token_valid": False}
            access_token = token_response.json().get("access_token")
            graph_response = await client.get(
                f"https://graph.microsoft.com/v1.0/users/{mailbox}/mailFolders/inbox/messages?$top=1&$select=id",
                headers={"Authorization": f"Bearer {access_token}"},
            )
        if graph_response.status_code != 200:
            message = "Microsoft 365 authenticated, but the shared mailbox cannot be read. Grant Mail.Read application permission and admin consent."
            await db.settings.update_one({"type": "o365_mailbox"}, {"$set": {"live_sync_enabled": False, "last_connection_test_at": datetime.now(timezone.utc).isoformat(), "last_connection_test_status": "mailbox_access_failed"}})
            return {"success": False, "message": message, "mailbox": mailbox, "token_valid": True, "permissions": ["Mail.Read required"]}
        now = datetime.now(timezone.utc).isoformat()
        await db.settings.update_one({"type": "o365_mailbox"}, {"$set": {"live_sync_enabled": True, "last_sync": now, "last_connection_test_at": now, "last_connection_test_status": "connected"}})
        return {"success": True, "message": f"Microsoft Graph connected to {mailbox}", "mailbox": mailbox, "token_valid": True, "permissions": ["Mail.Read verified", "Use Send test email to verify Mail.Send"]}
    except Exception:
        return {"success": False, "message": "Microsoft 365 connection test failed. Check network access and the Azure app configuration.", "mailbox": mailbox, "token_valid": False}

@router.post("/o365/sync-emails")
async def sync_o365_emails(current_user: dict = Depends(get_current_user)):
    """Pull newly received Graph messages and feed them through the normal lead/ticket router."""
    settings = await db.settings.find_one({"type": "o365_mailbox"}, {"_id": 0})
    if not settings or not settings.get("connected"):
        raise HTTPException(status_code=400, detail="O365 mailbox not connected")
    required = ("tenant_id", "client_id", "client_secret")
    if not all(settings.get(field) for field in required):
        raise HTTPException(status_code=400, detail="Microsoft Graph credentials are incomplete")
    mailboxes = [mailbox for mailbox in settings.get("mailboxes", []) if mailbox.get("mailbox_email")]
    if not mailboxes and settings.get("mailbox_email"):
        mailboxes = [{"mailbox_email": settings["mailbox_email"]}]
    if not mailboxes:
        raise HTTPException(status_code=400, detail="No connected mailbox is available to sync")

    now = datetime.now(timezone.utc)
    cursor = settings.get("last_graph_sync")
    if cursor:
        since = cursor.replace("+00:00", "Z")
    else:
        since = (now - timedelta(days=7)).isoformat().replace("+00:00", "Z")
    fetched = leads_created = tickets_created = activities_added = skipped = errors = 0
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            token_response = await client.post(
                f"https://login.microsoftonline.com/{settings['tenant_id']}/oauth2/v2.0/token",
                data={"client_id": settings["client_id"], "client_secret": settings["client_secret"], "scope": "https://graph.microsoft.com/.default", "grant_type": "client_credentials"},
            )
            if token_response.status_code != 200:
                raise HTTPException(status_code=401, detail="Microsoft 365 authentication failed")
            headers = {"Authorization": f"Bearer {token_response.json().get('access_token')}"}
            for mailbox in mailboxes:
                address = mailbox["mailbox_email"]
                next_url = f"https://graph.microsoft.com/v1.0/users/{address}/mailFolders/inbox/messages"
                params = {
                    "$top": 100,
                    "$orderby": "receivedDateTime asc",
                    "$filter": f"receivedDateTime ge {since}",
                    "$select": "id,internetMessageId,subject,from,body,toRecipients,receivedDateTime",
                }
                # Follow Graph pagination so a busy shared mailbox is not
                # silently limited to the first 100 messages.
                while next_url:
                    response = await client.get(next_url, headers=headers, params=params)
                    params = None
                    if response.status_code != 200:
                        errors += 1
                        break
                    page = response.json()
                    next_url = page.get("@odata.nextLink")
                    for message in page.get("value", []):
                        fetched += 1
                        sender = (message.get("from") or {}).get("emailAddress") or {}
                        try:
                            result = await handle_incoming_email({
                                "id": message.get("id"),
                                "internet_message_id": message.get("internetMessageId"),
                                "from_address": sender.get("address", ""),
                                "from_name": sender.get("name", "Unknown"),
                                "subject": message.get("subject", "No Subject"),
                                "body": (message.get("body") or {}).get("content", ""),
                                "mailbox_email": address,
                            })
                            status = result.get("status")
                            leads_created += status == "lead_created"
                            tickets_created += status == "ticket_created"
                            activities_added += status == "activity_added"
                            skipped += status in {"skipped", "duplicate"} or result.get("duplicate", False)
                        except Exception:
                            errors += 1
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Microsoft Graph inbox sync failed") from exc

    sync_time = now.isoformat()
    await db.settings.update_one({"type": "o365_mailbox"}, {"$set": {"last_sync": sync_time, "last_graph_sync": sync_time, "live_sync_enabled": errors == 0}})
    return {
        "message": f"Synced {fetched} email(s): {leads_created} lead(s), {tickets_created} ticket(s), {activities_added} activity update(s)",
        "mode": "live_graph", "emails_fetched": fetched, "leads_created": leads_created,
        "tickets_created": tickets_created, "activities_added": activities_added, "skipped": skipped, "errors": errors,
    }

# ============== EMAIL-TO-LEAD WEBHOOK ==============

def _normalise_mailbox_address(value: Any) -> str:
    """Accept common Graph/webhook recipient shapes and return one address."""
    if isinstance(value, dict):
        value = value.get("address") or value.get("emailAddress", {}).get("address", "")
    if isinstance(value, list):
        value = value[0] if value else ""
    return str(value or "").strip().lower()


def _routing_for_incoming_email(settings: Optional[dict], data: dict) -> tuple[dict, str]:
    """Choose an inbox's routing flags using the addressed recipient when supplied."""
    settings = settings or {}
    recipient = _normalise_mailbox_address(
        data.get("mailbox_email") or data.get("to_address") or data.get("to") or data.get("recipient")
    )
    for mailbox in settings.get("mailboxes", []):
        if recipient and _normalise_mailbox_address(mailbox.get("mailbox_email")) == recipient:
            return mailbox, recipient
    return settings, recipient or _normalise_mailbox_address(settings.get("mailbox_email"))


def _incoming_message_id(data: dict) -> str:
    """Use the durable message identifier supplied by Graph or another mail relay."""
    return str(
        data.get("message_id") or data.get("internet_message_id") or data.get("internetMessageId") or data.get("id") or ""
    ).strip()


@router.post("/o365/webhook/incoming-email")
async def handle_incoming_email(data: dict, current_user: dict = Depends(get_current_user)):
    """Authenticated inbox ingestion for tests and trusted internal processing.
    Live Microsoft Graph polling calls this handler internally after Graph authentication.
    """
    settings = await db.settings.find_one({"type": "o365_mailbox"}, {"_id": 0})
    
    sender_email = str(data.get("from_address", data.get("from", "")) or "").strip().lower()
    sender_name = data.get("from_name", data.get("sender_name", "Unknown"))
    subject = data.get("subject", "No Subject")
    body = data.get("body", "")
    
    if not sender_email:
        raise HTTPException(status_code=400, detail="from_address is required")

    routing, routed_mailbox = _routing_for_incoming_email(settings, data)
    inbound_message_id = _incoming_message_id(data)
    if inbound_message_id:
        processed = await db.processed_inbound_emails.find_one({"message_id": inbound_message_id}, {"_id": 0})
        if processed:
            result = processed.get("result", {})
            return {**result, "duplicate": True, "message": "This inbound email was already processed"}

    # Match the sender before routing so every known-client message is retained
    # in the client correspondence history, even if ticket intake is disabled.
    email_match = {"$regex": f"^{re.escape(sender_email)}$", "$options": "i"}
    known_client = await db.clients.find_one({"$or": [
        {"email": email_match}, {"contact_email": email_match}, {"contacts.email": email_match}
    ]}, {"_id": 0})
    if not known_client:
        contact = await db.client_contacts.find_one({"email": email_match}, {"_id": 0, "client_id": 1})
        if contact and contact.get("client_id"):
            known_client = await db.clients.find_one({"id": contact["client_id"]}, {"_id": 0})
    if known_client:
        from app.routers.email_utils import record_inbound_client_email
        await record_inbound_client_email(
            sender_email=sender_email, sender_name=sender_name, subject=subject,
            mailbox=routed_mailbox, client_id=known_client.get("id"), related_type="email_intake",
        )

    # Replies to a job update must return to that job rather than creating a
    # duplicate service ticket or CRM lead. Match a known client's recent job
    # email by its normalised subject, which remains stable across Re:/Fwd:.
    job_reply = None
    if known_client:
        normalise_subject = lambda value: re.sub(r"^(?:re|fw|fwd)\s*:\s*", "", (value or "").strip(), flags=re.I).casefold()
        inbound_subject = normalise_subject(subject)
        candidates = await db.job_emails.find(
            {"client_id": known_client.get("id"), "direction": "outbound"}, {"_id": 0}
        ).sort("created_at", -1).to_list(30)
        job_reply = next((item for item in candidates if item.get("job_id") and normalise_subject(item.get("subject")) == inbound_subject), None)
        if job_reply:
            inbound_job_email = {
                "id": str(uuid.uuid4()), "job_type": job_reply.get("job_type"), "job_id": job_reply.get("job_id"),
                "client_id": known_client.get("id"), "job_number": job_reply.get("job_number"),
                "from_address": sender_email, "from_name": sender_name, "to_addresses": [routed_mailbox] if routed_mailbox else [],
                "subject": subject, "body": body, "body_type": "html" if "<" in body else "text",
                "direction": "inbound", "status": "received", "sender_mailbox": routed_mailbox,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            await db.job_emails.insert_one(inbound_job_email)
            audit_collection = "workshop_audit_log" if job_reply.get("job_type") == "workshop" else "field_audit_log"
            await db[audit_collection].insert_one({
                "id": str(uuid.uuid4()), "job_id": job_reply.get("job_id"), "action": "conversation_email_received",
                "details": f"Email reply received from {sender_name or sender_email}", "user_id": "system",
                "user_name": sender_name or sender_email, "created_at": inbound_job_email["created_at"],
            })

    auto_reply_result = None

    async def remember(result: dict) -> dict:
        if auto_reply_result:
            result["auto_reply"] = auto_reply_result
        if inbound_message_id:
            await db.processed_inbound_emails.update_one(
                {"message_id": inbound_message_id},
                {"$setOnInsert": {
                    "message_id": inbound_message_id,
                    "mailbox": routed_mailbox,
                    "result": result,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }},
                upsert=True,
            )
        return result

    if job_reply:
        return await remember({"status": "job_reply_recorded", "job_id": job_reply.get("job_id"), "job_type": job_reply.get("job_type"), "mailbox": routed_mailbox, "message": "Email reply added to the service-job conversation"})

    # An acknowledgement is useful for new enquiries, but avoid obvious mail
    # loops and automated senders. The delivery is also captured in the shared
    # outbound audit trail through send_email.
    sender_local_part = sender_email.split("@", 1)[0].lower()
    automated_sender = sender_local_part in {"no-reply", "noreply", "postmaster", "mailer-daemon"} or (subject or "").strip().lower().startswith(("auto:", "automatic reply:"))
    auto_reply_enabled = routing.get("auto_reply_enabled", (settings or {}).get("auto_reply_enabled", False))
    if auto_reply_enabled and not automated_sender:
        auto_reply_message = (routing.get("auto_reply_message") or (settings or {}).get("auto_reply_message") or "Thank you for contacting us. We have received your inquiry and will respond shortly.").strip()
        if auto_reply_message:
            from app.routers.email_utils import send_email
            delivery = await send_email(
                sender_email,
                f"Re: {subject or 'Your enquiry'}",
                f"<div style='font-family:system-ui,sans-serif;white-space:pre-wrap'>{escape(auto_reply_message)}</div>",
                category="notifications",
                client_id=(known_client or {}).get("id"),
                related_type="email_intake",
            )
            auto_reply_result = {
                "status": delivery.get("status"),
                "message": delivery.get("message"),
                "sender_mailbox": delivery.get("sender"),
            }
    
    # Check if sender is a known client contact → create ticket
    email_to_ticket = routing.get("email_to_ticket_enabled", False)
    if email_to_ticket:
        if known_client:
            client = known_client
            # Create a ticket for the known client
            tier_fields = {}
            if client.get("service_tier_id"):
                tier = await db.service_tiers.find_one(
                    {"id": client["service_tier_id"], "is_active": True},
                    {"_id": 0},
                )
                if tier:
                    tier_fields = {
                        "service_tier_id": tier["id"],
                        "service_tier_name": tier.get("name"),
                        "service_tier_source": "client",
                        "tier_response_sla_minutes": tier.get("response_sla_minutes"),
                        "tier_resolution_sla_minutes": tier.get("resolution_sla_minutes"),
                    }
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
                **tier_fields,
            }
            await db.tickets.insert_one(ticket)
            return await remember({"status": "ticket_created", "ticket_id": ticket["id"], "mailbox": routed_mailbox, "message": f"Support ticket created for {client.get('company_name', sender_email)}"})
    
    # Check if email-to-lead is enabled
    email_to_lead = routing.get("email_to_lead_enabled", True)
    if not email_to_lead:
        return await remember({"status": "skipped", "mailbox": routed_mailbox, "reason": "email-to-lead disabled for this mailbox"})
    
    existing_lead = await db.leads.find_one({"email": email_match}, {"_id": 0})
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
            "mailbox_email": routed_mailbox,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.lead_activities.insert_one(activity)
        await db.leads.update_one({"id": existing_lead["id"]}, {"$set": {"last_contact": datetime.now(timezone.utc).isoformat()}})
        return await remember({"status": "activity_added", "lead_id": existing_lead["id"], "mailbox": routed_mailbox, "message": "Email logged as activity on existing lead"})
    
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
    doc["source_mailbox"] = routed_mailbox
    await db.leads.insert_one(doc)

    await db.notifications.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": "all",
        "type": "new_lead",
        "title": f"New email lead: {company_name}",
        "message": f"{sender_name} ({sender_email}) emailed: {subject}",
        "mailbox_email": routed_mailbox,
        "ref_id": lead.id,
        "ref_type": "lead",
        "severity": "info",
        "read": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    
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
        "mailbox_email": routed_mailbox,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.lead_activities.insert_one(activity)
    
    return await remember({"status": "lead_created", "lead_id": lead.id, "mailbox": routed_mailbox, "message": f"New lead created from email: {company_name}"})

@router.get("/o365/email-leads")
async def get_email_generated_leads(current_user: dict = Depends(get_current_user)):
    """Get leads that were auto-generated from emails"""
    leads = await db.leads.find({"source": "email"}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return leads
