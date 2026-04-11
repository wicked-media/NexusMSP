"""Shared email sending utility using Resend"""
import os
import asyncio
import logging
import resend
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)

RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
SENDER_EMAIL = os.environ.get("SENDER_EMAIL", "onboarding@resend.dev")


def is_resend_configured():
    return bool(RESEND_API_KEY and not RESEND_API_KEY.startswith("re_test_placeholder"))


async def send_email(to_email: str, subject: str, html_content: str):
    """Send an email via Resend. Returns dict with status and email_id."""
    if not is_resend_configured():
        logger.info(f"[EMAIL MOCK] To: {to_email} | Subject: {subject}")
        return {"status": "mocked", "message": "Email logged (Resend not configured)", "email_id": None}

    resend.api_key = RESEND_API_KEY
    params = {
        "from": SENDER_EMAIL,
        "to": [to_email],
        "subject": subject,
        "html": html_content,
    }
    try:
        result = await asyncio.to_thread(resend.Emails.send, params)
        logger.info(f"[EMAIL SENT] To: {to_email} | ID: {result.get('id')}")
        return {"status": "sent", "message": f"Email sent to {to_email}", "email_id": result.get("id")}
    except Exception as e:
        logger.error(f"[EMAIL FAILED] To: {to_email} | Error: {str(e)}")
        return {"status": "failed", "message": str(e), "email_id": None}
