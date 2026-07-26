"""Shared outbound email delivery through the primary Microsoft 365 mailbox."""
import logging
import base64
import re
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
import httpx
from app.database import db
from app.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/settings/email-delivery", tags=["Microsoft 365 Email Delivery"])


async def _load_microsoft365_config():
    settings = await db.settings.find_one({"type": "o365_mailbox"}, {"_id": 0}) or {}
    if not settings.get("enabled") or not settings.get("connected"):
        return None
    required = ("tenant_id", "client_id", "client_secret")
    if not all(str(settings.get(field) or "").strip() for field in required):
        return None
    settings["sender_email"] = settings.get("outbound_mailbox_email") or settings.get("mailbox_email")
    if not str(settings.get("sender_email") or "").strip():
        return None
    return settings


async def is_microsoft365_configured() -> bool:
    return bool(await _load_microsoft365_config())


async def _require_admin(current_user: dict):
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "role": 1, "is_admin": 1})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")


async def _resolve_client_for_addresses(addresses: list[str], explicit_client_id: str | None = None) -> dict | None:
    """Resolve a client from its profile email or any recorded client contact."""
    if explicit_client_id:
        client = await db.clients.find_one({"id": explicit_client_id}, {"_id": 0, "id": 1, "name": 1, "company_name": 1})
        if client:
            return client
    for address in addresses:
        value = str(address or "").strip()
        if not value:
            continue
        match = {"$regex": f"^{re.escape(value)}$", "$options": "i"}
        client = await db.clients.find_one(
            {"$or": [{"email": match}, {"contact_email": match}, {"contacts.email": match}]},
            {"_id": 0, "id": 1, "name": 1, "company_name": 1},
        )
        if client:
            return client
        contact = await db.client_contacts.find_one({"email": match}, {"_id": 0, "client_id": 1})
        if not contact:
            contact = await db.contacts.find_one({"email": match}, {"_id": 0, "client_id": 1})
        if contact and contact.get("client_id"):
            client = await db.clients.find_one({"id": contact["client_id"]}, {"_id": 0, "id": 1, "name": 1, "company_name": 1})
            if client:
                return client
    return None


async def _record_delivery(*, recipients: list[str], cc_recipients: list[str], bcc_recipients: list[str], subject: str, category: str, sender: str | None, attachments: list[dict] | None, result: dict, client_id: str | None = None, related_type: str | None = None, related_id: str | None = None, initiated_by: str | None = None, initiated_by_name: str | None = None):
    """Maintain a delivery audit and attach client correspondence to the client history."""
    try:
        delivery_id = str(uuid.uuid4())
        client = await _resolve_client_for_addresses([*recipients, *cc_recipients, *bcc_recipients], client_id)
        entry = {
            "id": delivery_id,
            "recipients": recipients,
            "cc_recipients": cc_recipients,
            "bcc_recipient_count": len(bcc_recipients),
            "subject": subject,
            "category": category,
            "sender_mailbox": sender,
            "attachment_count": len(attachments or []),
            "status": result.get("status"),
            "message": result.get("message"),
            "client_id": (client or {}).get("id"),
            "client_name": (client or {}).get("company_name") or (client or {}).get("name"),
            "related_type": related_type,
            "related_id": related_id,
            "initiated_by": initiated_by,
            "initiated_by_name": initiated_by_name,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.email_delivery_log.insert_one(entry)
        if client:
            await db.client_communication_events.insert_one({
                "id": str(uuid.uuid4()),
                "delivery_id": delivery_id,
                "client_id": client["id"],
                "direction": "outbound",
                "channel": "email",
                "recipients": recipients,
                "cc_recipients": cc_recipients,
                "subject": subject,
                "category": category,
                "sender_mailbox": sender,
                "delivery_status": result.get("status"),
                "delivery_message": result.get("message"),
                "delivery_confirmed": result.get("status") == "sent",
                "related_type": related_type,
                "related_id": related_id,
                "initiated_by": initiated_by,
                "initiated_by_name": initiated_by_name,
                "created_at": entry["created_at"],
            })
        return delivery_id
    except Exception as exc:
        logger.warning("Unable to save email delivery audit record: %s", exc)
        return None


async def record_inbound_client_email(*, sender_email: str, sender_name: str, subject: str, mailbox: str | None, client_id: str | None = None, related_type: str | None = None, related_id: str | None = None):
    """Add an inbound message to the same immutable client correspondence history."""
    client = await _resolve_client_for_addresses([sender_email], client_id)
    if not client:
        return None
    event = {
        "id": str(uuid.uuid4()),
        "client_id": client["id"],
        "direction": "inbound",
        "channel": "email",
        "sender_email": sender_email,
        "sender_name": sender_name,
        "recipients": [mailbox] if mailbox else [],
        "subject": subject,
        "category": "inbound",
        "sender_mailbox": mailbox,
        "delivery_status": "received",
        "delivery_confirmed": True,
        "related_type": related_type,
        "related_id": related_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.client_communication_events.insert_one(event)
    return event


async def send_email(to_email: str | list[str], subject: str, html_content: str, category: str = "notifications", cc_addresses: list[str] | None = None, bcc_addresses: list[str] | None = None, attachments: list[dict] | None = None, client_id: str | None = None, related_type: str | None = None, related_id: str | None = None, initiated_by: str | None = None, initiated_by_name: str | None = None):
    """Send through the selected Microsoft 365 mailbox for an outbound category."""
    recipients = [to_email] if isinstance(to_email, str) else [address for address in to_email if address]
    cc_recipients = [address for address in (cc_addresses or []) if address]
    bcc_recipients = [address for address in (bcc_addresses or []) if address]

    async def record(result: dict):
        result["delivery_id"] = await _record_delivery(
            recipients=recipients, cc_recipients=cc_recipients, bcc_recipients=bcc_recipients, subject=subject, category=category,
            sender=result.get("sender"), attachments=attachments, result=result, client_id=client_id,
            related_type=related_type, related_id=related_id, initiated_by=initiated_by,
            initiated_by_name=initiated_by_name,
        )
        return result

    config = await _load_microsoft365_config()
    if not config:
        logger.info("[EMAIL MOCK] To: %s | Subject: %s", to_email, subject)
        result = {"status": "mocked", "message": "Email logged (Microsoft 365 mailbox not connected)", "email_id": None}
        return await record(result)

    sender = (config.get("outbound_routing") or {}).get(category) or config["sender_email"]
    if not recipients:
        result = {"status": "failed", "message": "No email recipient provided", "email_id": None}
        return await record(result)
    graph_attachments = []
    for attachment in attachments or []:
        content = attachment.get("content", b"")
        content_bytes = content.encode("utf-8") if isinstance(content, str) else content
        graph_attachments.append({
            "@odata.type": "#microsoft.graph.fileAttachment",
            "name": attachment.get("filename") or "attachment",
            "contentType": attachment.get("content_type") or "application/octet-stream",
            "contentBytes": base64.b64encode(content_bytes).decode("ascii"),
        })
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            token_response = await client.post(
                f"https://login.microsoftonline.com/{config['tenant_id']}/oauth2/v2.0/token",
                data={
                    "client_id": config["client_id"],
                    "client_secret": config["client_secret"],
                    "scope": "https://graph.microsoft.com/.default",
                    "grant_type": "client_credentials",
                },
            )
            if token_response.status_code != 200:
                result = {"status": "failed", "message": "Microsoft 365 authentication failed", "email_id": None}
                return await record(result)
            access_token = token_response.json().get("access_token")
            send_response = await client.post(
                f"https://graph.microsoft.com/v1.0/users/{sender}/sendMail",
                headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
                json={
                    "message": {
                        "subject": subject,
                        "body": {"contentType": "HTML", "content": html_content},
                        "toRecipients": [{"emailAddress": {"address": address}} for address in recipients],
                        "ccRecipients": [{"emailAddress": {"address": address}} for address in cc_recipients],
                        "bccRecipients": [{"emailAddress": {"address": address}} for address in bcc_recipients],
                        "attachments": graph_attachments,
                    },
                    "saveToSentItems": True,
                },
            )
            if send_response.status_code not in (200, 202):
                result = {"status": "failed", "message": "Microsoft 365 rejected the email", "email_id": None}
                return await record(result)
        logger.info("[EMAIL SENT via Microsoft 365] From: %s To: %s", sender, ", ".join(recipients))
        result = {"status": "sent", "message": f"Email sent to {', '.join(recipients)} via Microsoft 365", "email_id": None, "sender": sender}
        return await record(result)
    except Exception as exc:
        logger.error("[EMAIL FAILED via Microsoft 365] To: %s | Error: %s", to_email, exc)
        result = {"status": "failed", "message": "Microsoft 365 delivery failed", "email_id": None}
        return await record(result)



def _mask(k: str) -> str:
    if not k:
        return ""
    if len(k) <= 8:
        return "***"
    return k[:4] + "..." + k[-4:]


@router.get("")
async def get_email_delivery_settings(current_user: dict = Depends(get_current_user)):
    """Return safe status of the shared Microsoft 365 delivery mailbox."""
    await _require_admin(current_user)
    config = await _load_microsoft365_config()
    return {
        "provider": "microsoft_365",
        "configured": bool(config),
        "sender_email": config.get("sender_email") if config else "",
        "updated_at": config.get("updated_at") if config else None,
        "updated_by": config.get("connected_by") if config else None,
    }


@router.get("/audit")
async def list_email_delivery_audit(limit: int = 25, current_user: dict = Depends(get_current_user)):
    """Recent provider-independent outbound delivery outcomes for the mail console."""
    await _require_admin(current_user)
    safe_limit = max(1, min(limit, 100))
    deliveries = await db.email_delivery_log.find({}, {"_id": 0}).sort("created_at", -1).to_list(safe_limit)
    return {"deliveries": deliveries}


@router.post("/test")
async def test_microsoft365_delivery(data: dict = None, current_user: dict = Depends(get_current_user)):
    """Send a controlled test email through the shared Microsoft 365 mailbox."""
    await _require_admin(current_user)
    data = data or {}
    to_email = (data.get("to_email") or current_user.get("email") or "").strip()
    if not to_email:
        raise HTTPException(status_code=400, detail="to_email required")
    if not await is_microsoft365_configured():
        raise HTTPException(status_code=400, detail="Microsoft 365 mailbox is not connected")

    html = f"""<div style="font-family: system-ui, sans-serif; padding: 24px; max-width: 560px; margin: auto;">
      <h2 style="color: #10b981;">NexusMSP - Microsoft 365 Test Email</h2>
      <p>Hi {current_user.get('name', 'there')},</p>
      <p>This is a test email from your NexusMSP installation to verify Microsoft 365 mail delivery.</p>
      <p style="color:#64748b;font-size:12px;margin-top:24px;">If you received this, the shared mailbox is ready for leads, tickets, invoices, and reminders.</p>
    </div>"""
    result = await send_email(to_email, "NexusMSP - Microsoft 365 Test Email", html)
    await db.settings.update_one(
        {"type": "o365_mailbox"},
        {"$set": {
            "last_outbound_test_status": result.get("status"),
            "last_outbound_test_at": datetime.now(timezone.utc).isoformat(),
            "last_outbound_test_to": to_email,
            "last_outbound_test_message": result.get("message", ""),
        }},
    )
    return result
