"""Shared email sending utility using Resend.
Reads config from DB first (settings.resend), falls back to env vars.
"""
import os
import asyncio
import logging
import resend
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from dotenv import load_dotenv
from app.database import db
from app.auth import get_current_user

load_dotenv()
logger = logging.getLogger(__name__)

_ENV_API_KEY = os.environ.get("RESEND_API_KEY", "")
_ENV_SENDER = os.environ.get("SENDER_EMAIL", "onboarding@resend.dev")

router = APIRouter(prefix="/settings/resend", tags=["Resend Settings"])


async def _load_resend_config():
    """Returns (api_key, sender_email, source). source is 'db' or 'env'."""
    doc = await db.settings.find_one({"key": "resend"}, {"_id": 0})
    if doc and doc.get("value"):
        v = doc["value"]
        api_key = (v.get("api_key") or "").strip()
        if api_key:
            return api_key, (v.get("sender_email") or _ENV_SENDER or "onboarding@resend.dev"), "db"
    return _ENV_API_KEY, _ENV_SENDER, "env"


def _is_real_key(k: str) -> bool:
    return bool(k) and not k.startswith("re_test_placeholder")


async def is_resend_configured_async() -> bool:
    key, _, _ = await _load_resend_config()
    return _is_real_key(key)


# Legacy sync helper (used at module import by some callers)
def is_resend_configured():
    return _is_real_key(_ENV_API_KEY)


async def send_email(to_email: str, subject: str, html_content: str):
    """Send an email via Resend. Returns dict with status and email_id."""
    api_key, sender, source = await _load_resend_config()
    if not _is_real_key(api_key):
        logger.info(f"[EMAIL MOCK] To: {to_email} | Subject: {subject}")
        return {"status": "mocked", "message": "Email logged (Resend not configured)", "email_id": None}

    resend.api_key = api_key
    params = {
        "from": sender,
        "to": [to_email],
        "subject": subject,
        "html": html_content,
    }
    try:
        result = await asyncio.to_thread(resend.Emails.send, params)
        logger.info(f"[EMAIL SENT via {source}] To: {to_email} | ID: {result.get('id')}")
        return {"status": "sent", "message": f"Email sent to {to_email}", "email_id": result.get("id")}
    except Exception as e:
        logger.error(f"[EMAIL FAILED] To: {to_email} | Error: {str(e)}")
        return {"status": "failed", "message": str(e), "email_id": None}



def _mask(k: str) -> str:
    if not k:
        return ""
    if len(k) <= 8:
        return "***"
    return k[:4] + "..." + k[-4:]


@router.get("")
async def get_resend_settings(current_user: dict = Depends(get_current_user)):
    """Return current Resend configuration (API key masked)."""
    doc = await db.settings.find_one({"key": "resend"}, {"_id": 0}) or {}
    v = doc.get("value", {}) or {}
    db_key = v.get("api_key") or ""
    configured_from = "db" if _is_real_key(db_key) else ("env" if _is_real_key(_ENV_API_KEY) else "none")
    effective_key = db_key if _is_real_key(db_key) else _ENV_API_KEY
    return {
        "api_key": _mask(effective_key),
        "api_key_set": _is_real_key(effective_key),
        "sender_email": v.get("sender_email") or _ENV_SENDER,
        "reply_to": v.get("reply_to", ""),
        "configured_from": configured_from,
        "updated_at": doc.get("updated_at"),
        "updated_by": doc.get("updated_by"),
        "last_test_result": v.get("last_test_result"),
        "last_test_at": v.get("last_test_at"),
    }


@router.put("")
async def update_resend_settings(data: dict, current_user: dict = Depends(get_current_user)):
    """Update Resend settings. api_key='clear' removes it; masked keys ignored."""
    api_key = (data.get("api_key") or "").strip()
    sender_email = (data.get("sender_email") or "").strip() or _ENV_SENDER
    reply_to = (data.get("reply_to") or "").strip()

    existing = await db.settings.find_one({"key": "resend"}, {"_id": 0}) or {}
    current_value = existing.get("value", {}) or {}
    new_value = {**current_value, "sender_email": sender_email, "reply_to": reply_to}

    if api_key == "clear":
        new_value.pop("api_key", None)
    elif api_key and not api_key.startswith("***") and "..." not in api_key[:10]:
        new_value["api_key"] = api_key

    await db.settings.update_one(
        {"key": "resend"},
        {"$set": {
            "key": "resend",
            "value": new_value,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "updated_by": current_user.get("name", ""),
        }},
        upsert=True
    )
    return {"message": "Resend settings saved"}


@router.post("/test")
async def test_resend(data: dict = None, current_user: dict = Depends(get_current_user)):
    """Send a test email to verify Resend config."""
    data = data or {}
    to_email = (data.get("to_email") or current_user.get("email") or "").strip()
    if not to_email:
        raise HTTPException(status_code=400, detail="to_email required")

    api_key, sender, source = await _load_resend_config()
    if not _is_real_key(api_key):
        raise HTTPException(status_code=400, detail="Resend API key not configured")

    html = f"""<div style="font-family: system-ui, sans-serif; padding: 24px; max-width: 560px; margin: auto;">
      <h2 style="color: #10b981;">NexusOps - Resend Test Email</h2>
      <p>Hi {current_user.get('name', 'there')},</p>
      <p>This is a test email from your NexusOps installation to verify your Resend integration is working correctly.</p>
      <div style="background:#f1f5f9;padding:12px;border-radius:6px;font-size:12px;margin-top:16px;">
        <strong>Source:</strong> {source}<br/>
        <strong>Sender:</strong> {sender}<br/>
        <strong>Sent at:</strong> {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}
      </div>
      <p style="color:#64748b;font-size:12px;margin-top:24px;">If you received this, your Resend setup is operational.</p>
    </div>"""
    result = await send_email(to_email, "NexusOps - Resend Test Email", html)

    await db.settings.update_one(
        {"key": "resend"},
        {"$set": {
            "value.last_test_result": result.get("status"),
            "value.last_test_at": datetime.now(timezone.utc).isoformat(),
            "value.last_test_to": to_email,
            "value.last_test_message": result.get("message"),
        }},
        upsert=True
    )
    return result
