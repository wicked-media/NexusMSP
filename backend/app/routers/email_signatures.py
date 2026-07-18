"""
Outlook-grade Rich Email Signatures.

Features:
- Multiple signatures per user (default / replies / external)
- HTML rich body with template variables ({{user.name}}, {{user.title}},
  {{user.phone}}, {{user.email}}, {{client.name}}, {{ticket.number}})
- Per-user default selection
- Render-with-context endpoint used by the ticket email composer
- Auto-applied by tickets.send_ticket_email when no signature is provided
"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone
from typing import Optional
import re
import uuid
from html import escape
from email.utils import parseaddr
from app.database import db
from app.auth import get_current_user

router = APIRouter()


# --- helpers ----------------------------------------------------------------
TEMPLATE_VAR_RE = re.compile(r"\{\{\s*([\w\.]+)\s*\}\}")


async def _build_context(user_id: str, ticket_id: Optional[str] = None) -> dict:
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0}) or {}
    ctx = {
        "user.name": user.get("name") or "",
        "user.first_name": (user.get("name") or "").split(" ")[0],
        "user.title": user.get("job_title") or "Technician",
        "user.email": user.get("email") or "",
        "user.phone": user.get("phone") or "",
        "user.avatar": user.get("avatar_url") or "",
        "company.name": "NexusOps MSP",
        "company.website": "",
        "company.phone": "",
    }
    # Pull company from settings
    try:
        wl = await db.app_settings.find_one({"id": "white_label"}, {"_id": 0}) or {}
        if wl.get("company_name"): ctx["company.name"] = wl["company_name"]
        if wl.get("company_website"): ctx["company.website"] = wl["company_website"]
        if wl.get("company_phone"): ctx["company.phone"] = wl["company_phone"]
    except Exception:
        pass

    if ticket_id:
        t = await db.tickets.find_one({"id": ticket_id}, {"_id": 0}) or {}
        ctx["ticket.number"] = str(t.get("ticket_number") or t.get("number") or t.get("id", "")[:8])
        ctx["ticket.title"] = t.get("title", "")
        client_id = t.get("client_id")
        if client_id:
            c = await db.clients.find_one({"id": client_id}, {"_id": 0}) or {}
            ctx["client.name"] = c.get("name", "")
    return ctx


def _render(html: str, ctx: dict) -> str:
    if not html:
        return ""
    def sub(match):
        key = match.group(1)
        return str(ctx.get(key, ""))
    return TEMPLATE_VAR_RE.sub(sub, html)


def _is_reply(subject: str) -> bool:
    """Treat standard reply/forward subjects as a reply for signature scope."""
    normalised = (subject or "").strip().lower()
    return normalised.startswith(("re:", "fw:", "fwd:"))


async def append_default_signature(
    *,
    body: str,
    body_type: str,
    current_user: dict,
    subject: str = "",
    ticket_id: Optional[str] = None,
) -> tuple[str, str, Optional[str]]:
    """Append the caller's default signature once, rendered for this message.

    This is deliberately server-side so ticket replies and the standalone mail
    composer always use the signed-in technician's signature rather than a
    browser-local copy.  The HTML marker also prevents duplicate signatures if
    a draft is saved and later sent again.
    """
    marker = "<!--nx-signature-->"
    body = body or ""
    if marker in body or "[[NX_SIG]]" in body:
        return body, body_type or "html", None

    signature = await db.email_signatures.find_one(
        {"user_id": current_user["id"], "is_default": True}, {"_id": 0},
    )
    rendered = ""
    signature_id = None
    if signature:
        scope = signature.get("scope", "all")
        message_scope = "reply" if _is_reply(subject) else "new"
        if scope not in ("all", message_scope):
            return body, body_type or "html", None
        rendered = _render(signature.get("html", ""), await _build_context(current_user["id"], ticket_id))
        signature_id = signature.get("id")
    else:
        # Retain signatures saved through the legacy profile field.
        user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "email_signature": 1}) or {}
        legacy = user.get("email_signature") or ""
        if legacy:
            rendered = f"<pre style='font-family:inherit;margin:0;'>{escape(legacy)}</pre>"

    if not rendered:
        return body, body_type or "html", None
    if (body_type or "html").lower() != "html":
        body = f"<div>{escape(body).replace(chr(10), '<br/>')}</div>"
        body_type = "html"
    return f"{body}<br/><br/>{marker}{rendered}", body_type or "html", signature_id


# --- CRUD -------------------------------------------------------------------
@router.get("/email-signatures")
async def list_signatures(current_user: dict = Depends(get_current_user)):
    """List the caller's signatures."""
    docs = await db.email_signatures.find({"user_id": current_user["id"]}, {"_id": 0}).to_list(50)
    return {"signatures": docs}


@router.post("/email-signatures")
async def create_signature(data: dict, current_user: dict = Depends(get_current_user)):
    """Create a new signature."""
    name = (data.get("name") or "").strip()
    html = data.get("html") or ""
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    sig_id = data.get("id") or f"sig-{uuid.uuid4().hex[:10]}"
    is_default = bool(data.get("is_default"))

    doc = {
        "id": sig_id,
        "user_id": current_user["id"],
        "name": name,
        "html": html,
        "scope": data.get("scope", "all"),  # all | new | reply
        "is_default": is_default,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    if is_default:
        # Demote others
        await db.email_signatures.update_many(
            {"user_id": current_user["id"]}, {"$set": {"is_default": False}},
        )
    await db.email_signatures.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/email-signatures/{sig_id}")
async def update_signature(sig_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Update a signature (name, html, scope, default)."""
    existing = await db.email_signatures.find_one({"id": sig_id, "user_id": current_user["id"]}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Signature not found")

    update = {"updated_at": datetime.now(timezone.utc).isoformat()}
    for key in ("name", "html", "scope", "is_default"):
        if key in data:
            update[key] = data[key]

    if update.get("is_default"):
        await db.email_signatures.update_many(
            {"user_id": current_user["id"], "id": {"$ne": sig_id}},
            {"$set": {"is_default": False}},
        )

    await db.email_signatures.update_one({"id": sig_id}, {"$set": update})
    return {"message": "Signature updated"}


@router.delete("/email-signatures/{sig_id}")
async def delete_signature(sig_id: str, current_user: dict = Depends(get_current_user)):
    res = await db.email_signatures.delete_one({"id": sig_id, "user_id": current_user["id"]})
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail="Signature not found")
    return {"message": "Signature deleted"}


@router.post("/email-signatures/{sig_id}/set-default")
async def set_default(sig_id: str, current_user: dict = Depends(get_current_user)):
    sig = await db.email_signatures.find_one({"id": sig_id, "user_id": current_user["id"]}, {"_id": 0})
    if not sig:
        raise HTTPException(status_code=404, detail="Signature not found")
    await db.email_signatures.update_many(
        {"user_id": current_user["id"]}, {"$set": {"is_default": False}},
    )
    await db.email_signatures.update_one({"id": sig_id}, {"$set": {"is_default": True}})
    return {"message": "Default signature set"}


@router.post("/email-signatures/send-test")
async def send_signature_test(data: dict, current_user: dict = Depends(get_current_user)):
    """Send the caller's rendered default signature through Microsoft 365 on demand."""
    recipient = (data.get("to_email") or "").strip()
    _, address = parseaddr(recipient)
    if not address or "@" not in address:
        raise HTTPException(status_code=400, detail="Enter a valid test recipient")

    body, _, signature_id = await append_default_signature(
        body="<p>This is a NexusMSP signature test. The content below shows exactly how your default signature will appear on a new email.</p>",
        body_type="html",
        current_user=current_user,
        subject="NexusMSP signature test",
    )
    if not signature_id:
        raise HTTPException(status_code=400, detail="Set a default signature before sending a test")

    from app.routers.email_utils import send_email
    delivery = await send_email(address, "NexusMSP signature test", body, category="notifications")
    if delivery.get("status") != "sent":
        raise HTTPException(status_code=502, detail=delivery.get("message") or "Microsoft 365 could not send the test")
    return {"message": "Signature test sent", "recipient": address, "signature_id": signature_id}


# --- Render with ticket / context -----------------------------------------
@router.get("/email-signatures/render-default")
async def render_default(ticket_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    """
    Render the caller's default signature with template variables substituted
    against the optional ticket's context.
    """
    sig = await db.email_signatures.find_one(
        {"user_id": current_user["id"], "is_default": True}, {"_id": 0},
    )
    if not sig:
        # Fallback to legacy plain-text email_signature on the user record
        u = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "password_hash": 0}) or {}
        legacy = u.get("email_signature") or ""
        if legacy:
            return {"html": f"<pre style='font-family:inherit;margin:0;'>{legacy}</pre>", "source": "legacy"}
        return {"html": "", "source": "none"}

    ctx = await _build_context(current_user["id"], ticket_id)
    rendered = _render(sig.get("html", ""), ctx)
    return {"html": rendered, "source": "rich", "signature_id": sig.get("id")}


@router.get("/email-signatures/{sig_id}/render")
async def render_signature(sig_id: str, ticket_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    sig = await db.email_signatures.find_one({"id": sig_id, "user_id": current_user["id"]}, {"_id": 0})
    if not sig:
        raise HTTPException(status_code=404, detail="Signature not found")
    ctx = await _build_context(current_user["id"], ticket_id)
    return {"html": _render(sig.get("html", ""), ctx), "context": ctx}
