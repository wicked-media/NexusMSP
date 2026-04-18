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
    """Send an SMS. Body: {to, message, sender?, client_id?, ticket_id?, custom_ref?}"""
    to = (data.get("to") or "").strip()
    message = (data.get("message") or "").strip()
    if not (to and message):
        raise HTTPException(status_code=400, detail="to and message required")
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
        res = await send_sms({"to": to, "message": msg, "custom_ref": "test"}, current_user=current_user)
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
    await db.sms_messages.insert_one(doc)

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
