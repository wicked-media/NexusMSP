"""SMS integration via MobileMessage.com.au.
Provides: outbound send, inbound webhook, delivery-status webhook,
audit log, balance check, and admin CRUD for config.
"""
import uuid
import logging
import httpx
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request, Body
from app.database import db
from app.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(tags=["SMS"])

MM_BASE = "https://api.mobilemessage.com.au/v1"


# ============== DEFAULT SMS TEMPLATES ==============
DEFAULT_SMS_TEMPLATES = [
    {"key": "ticket_update", "name": "Ticket Update", "category": "ticket",
     "body": "{client_name}, update on ticket #{ticket_number}: {comment_preview} — View: {portal_link}"},
    {"key": "ticket_ready_pickup", "name": "Ticket Ready for Pickup", "category": "ticket",
     "body": "Hi {client_name}, your device is ready for pickup. Ticket #{ticket_number}. Call us on {company_phone} to arrange a time."},
    {"key": "ticket_closed", "name": "Ticket Resolved", "category": "ticket",
     "body": "Hi {client_name}, ticket #{ticket_number} ({ticket_title}) has been resolved. Reply if you need further help."},
    {"key": "ticket_tech_dispatched", "name": "Technician Dispatched", "category": "ticket",
     "body": "Hi {client_name}, {technician_name} is on the way to your site for ticket #{ticket_number}. ETA {eta}."},
    {"key": "overdue_invoice", "name": "Overdue Invoice Reminder", "category": "billing",
     "body": "Hi {client_name}, invoice {invoice_number} for ${invoice_amount} is {days_overdue} days overdue. Pay now: {payment_link}. Reply HELP if you have any questions."},
    {"key": "invoice_due_soon", "name": "Invoice Due Soon", "category": "billing",
     "body": "Hi {client_name}, reminder: invoice {invoice_number} for ${invoice_amount} is due on {due_date}. Pay: {payment_link}"},
    {"key": "payment_received", "name": "Payment Received", "category": "billing",
     "body": "Thanks {client_name}! Payment of ${amount} received for invoice {invoice_number}. Thanks for your business."},
    {"key": "appointment_reminder", "name": "Appointment Reminder", "category": "general",
     "body": "Hi {client_name}, reminder of your appointment with {company_name} at {appointment_time}. Reply Y to confirm or call {company_phone} to reschedule."},
]


def _substitute(body: str, context: dict) -> str:
    """Replace {placeholders} in a template body. Missing placeholders are left as-is."""
    if not body:
        return ""
    result = body
    for k, v in (context or {}).items():
        result = result.replace("{" + k + "}", str(v) if v is not None else "")
    return result


# ============== CONFIG HELPERS ==============
async def _get_config():
    doc = await db.settings.find_one({"key": "sms_config"}, {"_id": 0}) or {}
    return doc.get("value", {}) or {}


def _mask(s: str) -> str:
    if not s:
        return ""
    if len(s) <= 6:
        return "***"
    return s[:3] + "..." + s[-3:]


def _norm_phone(raw: str) -> str:
    """Normalise Aus numbers to E.164-ish 61xxxxxxxxx (MobileMessage accepts 04xx or 614xx)."""
    if not raw:
        return ""
    num = "".join(c for c in raw if c.isdigit() or c == "+")
    num = num.replace("+", "")
    if num.startswith("61"):
        return num
    if num.startswith("04"):
        return "61" + num[1:]
    if num.startswith("4") and len(num) == 9:
        return "61" + num
    return num


# ============== SETTINGS ENDPOINTS ==============
@router.get("/settings/sms")
async def get_sms_settings(request: Request, current_user: dict = Depends(get_current_user)):
    cfg = await _get_config()
    username = cfg.get("username", "")
    password = cfg.get("password", "")

    # Build webhook URLs using a public base URL (prefer FRONTEND_URL for external access)
    import os
    public_base = (os.environ.get("FRONTEND_URL")
                   or os.environ.get("REACT_APP_BACKEND_URL")
                   or os.environ.get("PUBLIC_BASE_URL")
                   or str(request.base_url).rstrip("/"))
    if "cluster" in public_base or "svc.cluster" in public_base:
        public_base = os.environ.get("FRONTEND_URL", public_base)
    public_base = public_base.rstrip("/")

    doc = await db.settings.find_one({"key": "sms_config"}, {"_id": 0}) or {}
    return {
        "provider": "mobilemessage",
        "enabled": bool(cfg.get("enabled", bool(username and password))),
        "username": username,
        "password": _mask(password) if password else "",
        "password_set": bool(password),
        "default_sender": cfg.get("default_sender", "Mobile MSG"),
        "signature": cfg.get("signature", "Kind Regards, NexusMSP"),
        "append_signature": bool(cfg.get("append_signature", True)),
        "last_balance": cfg.get("last_balance"),
        "last_balance_at": cfg.get("last_balance_at"),
        "last_test_result": cfg.get("last_test_result"),
        "last_test_at": cfg.get("last_test_at"),
        "last_test_message": cfg.get("last_test_message"),
        "updated_at": doc.get("updated_at"),
        "updated_by": doc.get("updated_by"),
        "status_webhook_url": f"{public_base}/api/sms/webhook/status",
        "inbound_webhook_url": f"{public_base}/api/sms/webhook/inbound",
    }


@router.put("/settings/sms")
async def update_sms_settings(data: dict, current_user: dict = Depends(get_current_user)):
    """Update SMS config. password='clear' removes it. Masked input (contains '...') is ignored."""
    existing = await _get_config()
    new_value = {**existing}

    username = (data.get("username") or "").strip()
    if username:
        new_value["username"] = username

    password = (data.get("password") or "").strip()
    if password == "clear":
        new_value.pop("password", None)
    elif password and "..." not in password[:8]:
        new_value["password"] = password

    if "default_sender" in data:
        new_value["default_sender"] = (data.get("default_sender") or "Mobile MSG").strip()
    if "signature" in data:
        new_value["signature"] = (data.get("signature") or "").strip()
    if "append_signature" in data:
        new_value["append_signature"] = bool(data["append_signature"])
    if "enabled" in data:
        new_value["enabled"] = bool(data["enabled"])

    await db.settings.update_one(
        {"key": "sms_config"},
        {"$set": {
            "key": "sms_config",
            "value": new_value,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "updated_by": current_user.get("name", ""),
        }},
        upsert=True
    )
    return {"message": "SMS settings saved"}


# ============== PROVIDER CALLS ==============
async def _send_via_provider(to: str, message: str, sender: str = None, custom_ref: str = None):
    cfg = await _get_config()
    user = cfg.get("username")
    pw = cfg.get("password")
    if not (user and pw):
        raise HTTPException(status_code=400, detail="SMS provider not configured. Set username/password in Settings → Integrations → SMS.")

    payload = {
        "enable_unicode": True,
        "messages": [{
            "to": _norm_phone(to),
            "message": message,
            "sender": sender or cfg.get("default_sender") or "Mobile MSG",
        }]
    }
    if custom_ref:
        payload["messages"][0]["custom_ref"] = custom_ref

    async with httpx.AsyncClient(timeout=20.0) as c:
        resp = await c.post(
            f"{MM_BASE}/messages",
            auth=(user, pw),
            json=payload,
            headers={"Content-Type": "application/json"},
        )
    try:
        body = resp.json()
    except Exception:
        body = {"raw": resp.text}
    return resp.status_code, body


@router.post("/sms/send")
async def send_sms(data: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Send an SMS. Body: {to, message, sender?, client_id?, ticket_id?, custom_ref?, skip_signature?}"""
    to = (data.get("to") or "").strip()
    message = (data.get("message") or "").strip()
    if not (to and message):
        raise HTTPException(status_code=400, detail="to and message required")

    # Auto-append configured signature unless caller opts out or message already contains it
    if not data.get("skip_signature"):
        cfg = await _get_config()
        sig = (cfg.get("signature") or "").strip()
        if sig and cfg.get("append_signature", True) and sig.lower() not in message.lower():
            message = f"{message}\n\n{sig}" if not message.endswith("\n") else f"{message}{sig}"

    if len(message) > 1600:
        raise HTTPException(status_code=400, detail="Message exceeds 1600 characters")

    custom_ref = data.get("custom_ref") or str(uuid.uuid4())[:12]
    sender = data.get("sender")
    try:
        status_code, body = await _send_via_provider(to, message, sender=sender, custom_ref=custom_ref)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"SMS provider request failed: {e}")

    # Parse provider response — per-result status
    provider_ok = status_code in (200, 201)
    first_result = (body.get("results") or [{}])[0] if isinstance(body.get("results"), list) else {}
    message_id = first_result.get("message_id")
    result_status = (first_result.get("status") or "").lower()
    result_error = first_result.get("error")

    # Provider may return 200 with per-message error
    msg_ok = provider_ok and result_status in ("", "sent", "success", "delivered", "pending") and not result_error

    now = datetime.now(timezone.utc).isoformat()
    log_doc = {
        "id": str(uuid.uuid4()),
        "direction": "outbound",
        "to": _norm_phone(to),
        "message": message,
        "sender": sender or (await _get_config()).get("default_sender", "Mobile MSG"),
        "status": "sent" if msg_ok else "failed",
        "provider_status_code": status_code,
        "provider_response": body,
        "message_id": message_id,
        "custom_ref": custom_ref,
        "client_id": data.get("client_id"),
        "client_name": data.get("client_name"),
        "ticket_id": data.get("ticket_id"),
        "user_id": current_user.get("id"),
        "user_name": current_user.get("name"),
        "sent_at": now,
        "cost": first_result.get("cost"),
        "failed_reason": result_error if not msg_ok else None,
    }
    await db.sms_messages.insert_one(log_doc)

    if not msg_ok:
        err = result_error or body.get("message") or body.get("error") or body.get("raw") or "Provider rejected message"
        raise HTTPException(status_code=400, detail=f"SMS failed: {err}")

    return {
        "id": log_doc["id"],
        "message_id": message_id,
        "status": "sent",
        "to": log_doc["to"],
        "cost": first_result.get("cost"),
    }


@router.post("/sms/test")
async def test_sms(data: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Send a test SMS and persist the result."""
    to = (data.get("to") or "").strip()
    msg = (data.get("message") or "NexusOps SMS test — integration is working.").strip()
    if not to:
        raise HTTPException(status_code=400, detail="to required")

    try:
        res = await send_sms({"to": to, "message": msg, "custom_ref": "test", "skip_signature": True}, current_user=current_user)
        status = "sent"
        detail = f"Sent to {to} (id: {res.get('message_id')})"
    except HTTPException as e:
        status = "failed"
        detail = str(e.detail)
    except Exception as e:
        status = "failed"
        detail = str(e)

    await db.settings.update_one(
        {"key": "sms_config"},
        {"$set": {
            "value.last_test_result": status,
            "value.last_test_at": datetime.now(timezone.utc).isoformat(),
            "value.last_test_to": to,
            "value.last_test_message": detail,
        }},
        upsert=True
    )
    return {"status": status, "detail": detail}


@router.get("/sms/senders")
async def list_senders(current_user: dict = Depends(get_current_user)):
    """Fetch the approved sender IDs (shared/own/dedicated) from MobileMessage."""
    cfg = await _get_config()
    user = cfg.get("username"); pw = cfg.get("password")
    if not (user and pw):
        raise HTTPException(status_code=400, detail="SMS provider not configured")
    async with httpx.AsyncClient(timeout=15.0) as c:
        resp = await c.get(f"{MM_BASE}/senders", auth=(user, pw))
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=f"Senders fetch failed: {resp.text}")
    body = resp.json()
    return body.get("results") or []


@router.get("/sms/balance")
async def sms_balance(current_user: dict = Depends(get_current_user)):
    cfg = await _get_config()
    user = cfg.get("username"); pw = cfg.get("password")
    if not (user and pw):
        raise HTTPException(status_code=400, detail="SMS provider not configured")
    async with httpx.AsyncClient(timeout=15.0) as c:
        resp = await c.get(f"{MM_BASE}/account", auth=(user, pw))
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=f"Balance check failed: {resp.text}")
    body = resp.json()
    balance = body.get("credit_balance")
    await db.settings.update_one(
        {"key": "sms_config"},
        {"$set": {"value.last_balance": balance, "value.last_balance_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"balance": balance, "raw": body}


# ============== MESSAGE LIST ==============
@router.get("/sms/messages")
async def list_sms(
    direction: Optional[str] = None,
    client_id: Optional[str] = None,
    limit: int = 200,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if direction:
        query["direction"] = direction
    if client_id:
        query["client_id"] = client_id
    msgs = await db.sms_messages.find(query, {"_id": 0, "provider_response": 0}).sort("sent_at", -1).to_list(limit)
    return msgs


@router.get("/sms/stats")
async def sms_stats(current_user: dict = Depends(get_current_user)):
    outbound = await db.sms_messages.count_documents({"direction": "outbound"})
    inbound = await db.sms_messages.count_documents({"direction": "inbound"})
    delivered = await db.sms_messages.count_documents({"direction": "outbound", "status": "delivered"})
    failed = await db.sms_messages.count_documents({"direction": "outbound", "status": "failed"})
    unread_inbound = await db.sms_messages.count_documents({"direction": "inbound", "read": {"$ne": True}})
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    sent_today = await db.sms_messages.count_documents({"direction": "outbound", "sent_at": {"$gte": today}})
    return {
        "outbound": outbound, "inbound": inbound,
        "delivered": delivered, "failed": failed,
        "unread_inbound": unread_inbound, "sent_today": sent_today,
    }


# ============== WEBHOOKS (PUBLIC — NO AUTH) ==============
@router.post("/sms/webhook/status")
async def webhook_status(request: Request):
    """MobileMessage posts delivery-status updates here."""
    try:
        data = await request.json()
    except Exception:
        return {"ok": True}

    message_id = data.get("message_id")
    status = data.get("status", "")
    now = datetime.now(timezone.utc).isoformat()
    update_fields = {
        "status": status or "unknown",
        "provider_status_received_at": now,
    }
    if status == "delivered":
        update_fields["delivered_at"] = now
    elif status == "failed":
        update_fields["failed_at"] = now
        update_fields["failed_reason"] = data.get("error") or data.get("message") or "failed"

    if message_id:
        await db.sms_messages.update_one({"message_id": message_id}, {"$set": update_fields})

    # Always store the raw event for audit
    await db.sms_webhook_log.insert_one({
        "id": str(uuid.uuid4()),
        "type": "status",
        "received_at": now,
        "payload": data,
    })
    return {"ok": True}


@router.post("/sms/webhook/inbound")
async def webhook_inbound(request: Request):
    """MobileMessage posts inbound SMS replies here."""
    try:
        data = await request.json()
    except Exception:
        return {"ok": True}

    now = datetime.now(timezone.utc).isoformat()
    sender_num = _norm_phone(data.get("sender") or data.get("from") or "")

    # Try to auto-link to a client by phone number match
    client = None
    if sender_num:
        # Look for clients with matching phone in either 04xx or 614xx formats
        alt = sender_num
        if alt.startswith("61"):
            alt = "0" + alt[2:]
        client = await db.clients.find_one(
            {"$or": [{"phone": sender_num}, {"phone": alt}, {"phone": {"$regex": alt[-9:]}}]},
            {"_id": 0, "id": 1, "name": 1}
        )

    doc = {
        "id": str(uuid.uuid4()),
        "direction": "inbound",
        "to": data.get("to"),
        "from": sender_num,
        "sender": sender_num,
        "message": data.get("message", ""),
        "message_id": data.get("message_id"),
        "custom_ref": data.get("custom_ref"),
        "received_at": data.get("received_at") or now,
        "sent_at": now,  # for sort consistency
        "status": "received",
        "read": False,
        "client_id": client.get("id") if client else None,
        "client_name": client.get("name") if client else None,
        "raw_payload": data,
    }

    # Auto-link to ticket if custom_ref starts with tkt- or inv-
    ref = data.get("custom_ref") or ""
    if ref.startswith("tkt-"):
        doc["ticket_id"] = ref[4:]
    elif ref.startswith("inv-"):
        doc["invoice_id"] = ref[4:]
    else:
        # Otherwise, if client has recent outbound SMS linked to a ticket, link to most recent one
        if doc.get("client_id"):
            recent = await db.sms_messages.find_one(
                {"client_id": doc["client_id"], "direction": "outbound", "ticket_id": {"$ne": None}},
                {"_id": 0, "ticket_id": 1},
                sort=[("sent_at", -1)]
            )
            if recent and recent.get("ticket_id"):
                doc["ticket_id"] = recent["ticket_id"]

    await db.sms_messages.insert_one(doc)

    # If linked to a ticket, push an activity entry
    if doc.get("ticket_id"):
        await db.tickets.update_one(
            {"id": doc["ticket_id"]},
            {"$push": {"activity": {
                "id": str(uuid.uuid4())[:8],
                "type": "sms_received",
                "user_name": doc.get("client_name") or sender_num,
                "message": f"SMS reply: {doc['message'][:100]}",
                "sms_id": doc["id"],
                "timestamp": now,
            }}, "$set": {"updated_at": now, "has_unread_sms": True}}
        )

    await db.sms_webhook_log.insert_one({
        "id": str(uuid.uuid4()),
        "type": "inbound",
        "received_at": now,
        "payload": data,
    })
    return {"ok": True}


@router.post("/sms/messages/{msg_id}/read")
async def mark_read(msg_id: str, current_user: dict = Depends(get_current_user)):
    await db.sms_messages.update_one({"id": msg_id}, {"$set": {"read": True, "read_at": datetime.now(timezone.utc).isoformat()}})
    return {"ok": True}


# ============== SMS TEMPLATES ==============
@router.get("/sms/templates")
async def list_sms_templates(category: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {"category": category} if category else {}
    docs = await db.sms_templates.find(query, {"_id": 0}).sort("name", 1).to_list(200)
    if not docs:
        now = datetime.now(timezone.utc).isoformat()
        for t in DEFAULT_SMS_TEMPLATES:
            await db.sms_templates.insert_one({
                "id": str(uuid.uuid4())[:8], **t,
                "created_at": now, "seeded": True,
            })
        docs = await db.sms_templates.find(query, {"_id": 0}).sort("name", 1).to_list(200)
    return docs


@router.post("/sms/templates")
async def create_sms_template(data: dict, current_user: dict = Depends(get_current_user)):
    doc = {
        "id": str(uuid.uuid4())[:8],
        "key": (data.get("key") or data.get("name", "")).lower().replace(" ", "_")[:32],
        "name": data.get("name", ""),
        "category": data.get("category", "general"),
        "body": data.get("body", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": current_user.get("name", ""),
    }
    if not doc["name"] or not doc["body"]:
        raise HTTPException(status_code=400, detail="name and body required")
    await db.sms_templates.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@router.put("/sms/templates/{tid}")
async def update_sms_template(tid: str, data: dict, current_user: dict = Depends(get_current_user)):
    allowed = {"name", "category", "body"}
    updates = {k: v for k, v in data.items() if k in allowed}
    if not updates:
        return {"message": "No changes"}
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    res = await db.sms_templates.update_one({"id": tid}, {"$set": updates})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"message": "Updated"}


@router.delete("/sms/templates/{tid}")
async def delete_sms_template(tid: str, current_user: dict = Depends(get_current_user)):
    res = await db.sms_templates.delete_one({"id": tid})
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail="Not found")
    return {"message": "Deleted"}


# ============== TICKET-LINKED SMS ==============
@router.get("/tickets/{ticket_id}/sms")
async def get_ticket_sms(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Return all SMS messages (outbound + inbound) linked to a ticket."""
    msgs = await db.sms_messages.find(
        {"$or": [{"ticket_id": ticket_id}, {"custom_ref": f"tkt-{ticket_id}"}]},
        {"_id": 0, "provider_response": 0, "raw_payload": 0}
    ).sort("sent_at", 1).to_list(500)
    return msgs


async def send_ticket_sms(ticket_id: str, message: str, to: str = None, template_key: str = None,
                          user: dict = None):
    """Helper used by ticket comment flow to also fire an SMS. Returns log doc id or None."""
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    # Resolve recipient
    phone = to
    if not phone and ticket.get("client_id"):
        client = await db.clients.find_one({"id": ticket["client_id"]}, {"_id": 0, "phone": 1, "mobile": 1})
        if client:
            phone = client.get("mobile") or client.get("phone")
    if not phone:
        raise HTTPException(status_code=400, detail="No phone number on ticket/client")

    # Template substitution
    if template_key:
        tmpl = await db.sms_templates.find_one({"key": template_key}, {"_id": 0})
        if tmpl:
            ctx = {
                "client_name": ticket.get("client_name", ""),
                "ticket_number": ticket.get("ticket_number") or ticket.get("id", "")[-6:],
                "ticket_title": ticket.get("title", ""),
                "ticket_id": ticket.get("id", ""),
                "comment_preview": (message or "")[:100],
                "portal_link": "",
                "company_phone": "",
                "company_name": "NexusOps",
                "technician_name": user.get("name", "") if user else "",
                "eta": "shortly",
            }
            message = _substitute(tmpl["body"], ctx)

    data = {
        "to": phone, "message": message,
        "client_id": ticket.get("client_id"),
        "client_name": ticket.get("client_name"),
        "ticket_id": ticket_id,
        "custom_ref": f"tkt-{ticket_id}",
    }
    result = await send_sms(data, current_user=user or {"id": "system", "name": "System"})
    return result


@router.post("/tickets/{ticket_id}/send-sms")
async def send_sms_on_ticket(ticket_id: str, data: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Send an SMS tied to a ticket (appears in ticket thread + SMS log)."""
    result = await send_ticket_sms(
        ticket_id=ticket_id,
        message=data.get("message", ""),
        to=data.get("to"),
        template_key=data.get("template_key"),
        user=current_user,
    )
    # Also append a note in the ticket activity
    now = datetime.now(timezone.utc).isoformat()
    await db.tickets.update_one(
        {"id": ticket_id},
        {"$push": {"activity": {
            "id": str(uuid.uuid4())[:8],
            "type": "sms_sent",
            "user_name": current_user.get("name", ""),
            "message": f"SMS sent: {data.get('message','')[:80]}",
            "sms_id": result.get("id"),
            "timestamp": now,
        }}, "$set": {"updated_at": now}}
    )
    return result


# ============== INVOICE OVERDUE SMS ==============
@router.post("/invoices/{invoice_id}/send-sms-reminder")
async def send_invoice_sms(invoice_id: str, data: dict = None, current_user: dict = Depends(get_current_user)):
    """Send an SMS reminder for an overdue/due-soon invoice. Uses the configured template."""
    data = data or {}
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if invoice.get("payment_status") == "paid" or invoice.get("status") in {"cancelled", "voided"}:
        raise HTTPException(status_code=409, detail="Payment reminders cannot be sent for paid or voided invoices")

    client = await db.clients.find_one({"id": invoice.get("client_id")}, {"_id": 0}) or {}
    phone = data.get("to") or client.get("mobile") or client.get("phone")
    if not phone:
        raise HTTPException(status_code=400, detail="No mobile number on client")

    template_key = data.get("template_key") or "overdue_invoice"
    tmpl = await db.sms_templates.find_one({"key": template_key}, {"_id": 0})
    if not tmpl:
        # Seed defaults if missing
        await list_sms_templates(current_user=current_user)
        tmpl = await db.sms_templates.find_one({"key": template_key}, {"_id": 0})

    # Compute days overdue
    days_overdue = 0
    try:
        due = invoice.get("due_date")
        if due:
            due_dt = datetime.fromisoformat(str(due).replace("Z", "+00:00")) if "T" in str(due) else datetime.strptime(str(due)[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
            days_overdue = max(0, (datetime.now(timezone.utc) - due_dt).days)
    except Exception:
        pass

    ctx = {
        "client_name": client.get("name") or invoice.get("client_name", ""),
        "invoice_number": invoice.get("invoice_number") or invoice.get("id", "")[-8:],
        "invoice_amount": f"{float(invoice.get('total') or invoice.get('amount_due') or 0):.2f}",
        "due_date": str(invoice.get("due_date", ""))[:10],
        "days_overdue": str(days_overdue),
        "payment_link": invoice.get("payment_link") or "",
        "amount": f"{float(invoice.get('total') or 0):.2f}",
        "company_name": "NexusOps",
    }
    custom_message = (data.get("message") or "").strip()
    message = custom_message if custom_message else _substitute(tmpl["body"] if tmpl else "", ctx)
    if not message:
        raise HTTPException(status_code=400, detail="Unable to build SMS body")

    result = await send_sms({
        "to": phone,
        "message": message,
        "client_id": invoice.get("client_id"),
        "client_name": invoice.get("client_name"),
        "custom_ref": f"inv-{invoice_id}",
    }, current_user=current_user)

    # Log against invoice
    await db.invoices.update_one(
        {"id": invoice_id},
        {"$set": {"last_sms_reminder_at": datetime.now(timezone.utc).isoformat()},
         "$inc": {"sms_reminders_sent": 1}}
    )
    return result
