from fastapi import APIRouter, HTTPException, Depends
from typing import Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import base64
import binascii
import hashlib
import uuid
import httpx
import re
from html import escape
from app.database import db
from app.auth import get_current_user
from app.models import *
from app.services.microsoft365_credentials import (
    has_microsoft365_client_secret,
    load_microsoft365_client_secret,
)
from app.services.secret_store import encrypt_secret
from app.services.ticket_subscriptions import notify_ticket_subscribers
from app.services.scope_permissions import platform_tenant_id, tenant_scoped_query
from app.routers.lead_studio import create_email_intake_item

router = APIRouter()
# Every shared sender is selected centrally in Mailbox & Email.  Keep this
# list aligned with the categories used by the delivery gateway so a workflow
# never silently falls back to an unrelated mailbox merely because it gained a
# dedicated conversation surface.
OUTBOUND_ROLES = {
    "ticket_comments",
    "ticket_replies",
    "service_job_comments",
    "service_job_replies",
    "billing",
    "lead_responses",
    "notifications",
}


def _managed_mailboxes(settings: Optional[dict]) -> list[dict]:
    """Return managed mailboxes, including the read-compatible legacy record.

    Earlier Nexus installations stored one mailbox only at the top level.  Do
    not make a customer reconnect it just because they add routing or a second
    mailbox: promote that record in-memory and persist it on the next safe
    settings write.
    """
    settings = settings or {}
    stored = settings.get("mailboxes")
    if isinstance(stored, list):
        return [dict(mailbox) for mailbox in stored if isinstance(mailbox, dict)]

    legacy_email = str(settings.get("mailbox_email") or "").strip()
    if not legacy_email:
        return []
    return [{
        "id": "legacy-primary",
        "mailbox_email": legacy_email,
        "tenant_id": settings.get("tenant_id", ""),
        "client_id": settings.get("client_id", ""),
        "connected": settings.get("connected", False),
        "connection_status": settings.get("connection_status", "disconnected"),
        "email_to_lead_enabled": settings.get("email_to_lead_enabled", True),
        "email_to_ticket_enabled": settings.get("email_to_ticket_enabled", False),
        "last_sync": settings.get("last_sync"),
    }]


def _normalise_outbound_delivery_state(settings: dict, mailboxes: list[dict]) -> dict:
    """Return a valid shared sender and role map for the remaining mailboxes.

    Removing a mailbox used to leave ``outbound_mailbox_email`` and one or
    more role assignments pointed at a mailbox which no longer existed.  The
    next invoice or ticket reply would then be accepted by Nexus but rejected
    by Microsoft Graph.  Treat the connected mailbox list as the authority
    and repair stale selections whenever that list changes.
    """
    addresses = {
        str(mailbox.get("mailbox_email") or "").strip().lower(): str(mailbox.get("mailbox_email") or "").strip()
        for mailbox in mailboxes
        if str(mailbox.get("mailbox_email") or "").strip()
    }
    preferred = str(
        settings.get("outbound_mailbox_email") or settings.get("mailbox_email") or ""
    ).strip().lower()
    sender = addresses.get(preferred) or next(iter(addresses.values()), "")

    saved_routing = settings.get("outbound_routing")
    saved_routing = saved_routing if isinstance(saved_routing, dict) else {}
    routing = {
        role: addresses.get(str(saved_routing.get(role) or "").strip().lower()) or sender
        for role in OUTBOUND_ROLES
    }
    return {
        "mailbox_email": sender,
        "outbound_mailbox_email": sender,
        "outbound_routing": routing if sender else {},
    }


async def _require_mailbox_admin(current_user: dict, *, allow_system_sync: bool = False) -> None:
    """Protect operational mailbox controls from ordinary technician sessions."""
    if allow_system_sync and isinstance(current_user, dict) and current_user.get("role") == "system":
        return
    caller_id = current_user.get("id") if isinstance(current_user, dict) else None
    caller = await db.users.find_one({"id": caller_id}, {"_id": 0, "role": 1, "is_admin": 1}) if caller_id else None
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")

# ============== OFFICE 365 ONE-CLICK MAILBOX SETUP ==============

@router.get("/settings/o365-mailbox")
async def get_o365_mailbox_settings(current_user: dict = Depends(get_current_user)):
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "role": 1, "is_admin": 1})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    settings = await db.settings.find_one({"type": "o365_mailbox"}, {"_id": 0})
    if settings:
        mailboxes = _managed_mailboxes(settings)
        safe_settings = {
            **settings,
            "mailboxes": mailboxes,
            **_normalise_outbound_delivery_state(settings, mailboxes),
            "client_secret": "",
            "client_secret_set": has_microsoft365_client_secret(settings),
        }
        # The encrypted representation is still a reusable service credential
        # and must never leave the Nexus API boundary for a browser client.
        safe_settings.pop("client_secret_encrypted", None)
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
    mailboxes = _managed_mailboxes(existing)
    requested_sender = (updated.get("outbound_mailbox_email") or "").strip().lower()
    if requested_sender:
        available = {str(mailbox.get("mailbox_email") or "").strip().lower() for mailbox in mailboxes}
        if requested_sender not in available:
            raise HTTPException(status_code=400, detail="Select one of the connected mailboxes as the outbound sender")
    if "outbound_routing" in updated:
        routing = updated["outbound_routing"]
        if not isinstance(routing, dict) or set(routing) != OUTBOUND_ROLES:
            raise HTTPException(status_code=400, detail="Assign exactly one connected mailbox to every outbound email role")
        available = {str(mailbox.get("mailbox_email") or "").strip().lower() for mailbox in mailboxes}
        for role, address in routing.items():
            if not str(address or "").strip().lower() or str(address).strip().lower() not in available:
                raise HTTPException(status_code=400, detail=f"{role} must use one connected mailbox")
    if "mail_sync_interval_minutes" in updated:
        try:
            interval = int(updated["mail_sync_interval_minutes"])
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Mailbox sync interval must be a whole number of minutes")
        if not 1 <= interval <= 30:
            raise HTTPException(status_code=400, detail="Mailbox sync interval must be between 1 and 30 minutes")
        updated["mail_sync_interval_minutes"] = interval
    updated["type"] = "o365_mailbox"
    updated["updated_at"] = datetime.now(timezone.utc).isoformat()
    if "mailboxes" not in existing:
        updated["mailboxes"] = mailboxes
    await db.settings.update_one({"type": "o365_mailbox"}, {"$set": updated}, upsert=True)
    return {"message": "O365 mailbox settings updated"}

@router.post("/o365/connect")
async def connect_o365_mailbox(data: dict, current_user: dict = Depends(get_current_user)):
    """Connect a shared Microsoft 365 mailbox using an Entra app credential."""
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    existing = await db.settings.find_one({"type": "o365_mailbox"}, {"_id": 0}) or {}
    tenant_id = str(data.get("tenant_id") or "").strip()
    client_id = str(data.get("client_id") or "").strip()
    incoming_client_secret = data.get("client_secret", "")
    if str(incoming_client_secret).strip() in {"", "********"}:
        client_secret = await load_microsoft365_client_secret(
            existing,
            collection=db.settings,
            query={"type": "o365_mailbox"},
        )
    else:
        client_secret = str(incoming_client_secret).strip()
    mailbox_email = str(data.get("mailbox_email") or "").strip()
    
    if not all([tenant_id, client_id, client_secret, mailbox_email]):
        raise HTTPException(status_code=400, detail="All Azure AD credentials and mailbox email are required")

    # A mailbox collection is one Microsoft Graph application connection.  The
    # root record carries the client credential used for *all* listed inboxes,
    # so silently accepting a different tenant or app here would overwrite the
    # existing connection and break every previously connected mailbox.
    if existing.get("connected"):
        existing_tenant = str(existing.get("tenant_id") or "").strip()
        existing_client = str(existing.get("client_id") or "").strip()
        if (
            (existing_tenant and existing_tenant.casefold() != tenant_id.casefold())
            or (existing_client and existing_client.casefold() != client_id.casefold())
        ):
            raise HTTPException(
                status_code=400,
                detail="Additional inboxes must use the tenant and Graph application already connected to Nexus. Create a separate connection only after disconnecting the current mailbox group.",
            )
    
    mailboxes = _managed_mailboxes(existing)
    mailboxes = [m for m in mailboxes if m.get("mailbox_email", "").lower() != mailbox_email.lower()]
    mailbox = {
        "id": f"mbx-{uuid.uuid4().hex[:8]}", "tenant_id": tenant_id, "client_id": client_id,
        "mailbox_email": mailbox_email, "connected": True, "connection_status": "connected",
        "connected_at": datetime.now(timezone.utc).isoformat(), "last_sync": datetime.now(timezone.utc).isoformat(),
        "email_to_lead_enabled": data.get("email_to_lead_enabled", True),
        "email_to_ticket_enabled": data.get("email_to_ticket_enabled", False),
    }
    mailboxes.append(mailbox)
    delivery_state = _normalise_outbound_delivery_state(existing, mailboxes)
    settings = {
        "type": "o365_mailbox",
        "enabled": True,
        "tenant_id": tenant_id,
        "client_id": client_id,
        "client_secret_encrypted": encrypt_secret(client_secret),
        "redirect_uri": data.get("redirect_uri", ""),
        **delivery_state,
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
    
    await db.settings.update_one(
        {"type": "o365_mailbox"},
        {"$set": settings, "$unset": {"client_secret": ""}},
        upsert=True,
    )
    return {"message": "Office 365 mailbox connected successfully", "status": "connected", "mailbox": mailbox_email}

@router.delete("/o365/mailboxes/{mailbox_id}")
async def remove_o365_mailbox(mailbox_id: str, current_user: dict = Depends(get_current_user)):
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    settings = await db.settings.find_one({"type": "o365_mailbox"}, {"_id": 0})
    if not settings:
        raise HTTPException(status_code=404, detail="Mailbox settings not found")
    mailboxes = _managed_mailboxes(settings)
    remaining = [m for m in mailboxes if m.get("id") != mailbox_id]
    if len(remaining) == len(mailboxes):
        raise HTTPException(status_code=404, detail="Mailbox not found")
    delivery_state = _normalise_outbound_delivery_state(settings, remaining)
    has_mailboxes = bool(remaining)
    await db.settings.update_one(
        {"type": "o365_mailbox"},
        {"$set": {
            "mailboxes": remaining,
            "connected": has_mailboxes,
            "enabled": has_mailboxes,
            "connection_status": "connected" if has_mailboxes else "disconnected",
            "live_sync_enabled": bool(settings.get("live_sync_enabled")) if has_mailboxes else False,
            **delivery_state,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
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
    await _require_mailbox_admin(current_user)
    settings = await db.settings.find_one({"type": "o365_mailbox"}, {"_id": 0})
    if not settings or not settings.get("connected"):
        return {"success": False, "message": "O365 mailbox not connected"}
    mailbox = settings.get("outbound_mailbox_email") or settings.get("mailbox_email", "")
    client_secret = await load_microsoft365_client_secret(
        settings,
        collection=db.settings,
        query={"type": "o365_mailbox"},
    )
    required = ("tenant_id", "client_id")
    if not mailbox or not client_secret or not all(settings.get(field) for field in required):
        return {"success": False, "message": "Mailbox or Microsoft Graph credentials are incomplete", "mailbox": mailbox}
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            token_response = await client.post(
                f"https://login.microsoftonline.com/{settings['tenant_id']}/oauth2/v2.0/token",
                data={"client_id": settings["client_id"], "client_secret": client_secret, "scope": "https://graph.microsoft.com/.default", "grant_type": "client_credentials"},
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
    await _require_mailbox_admin(current_user, allow_system_sync=True)
    settings = await db.settings.find_one({"type": "o365_mailbox"}, {"_id": 0})
    if not settings or not settings.get("connected"):
        raise HTTPException(status_code=400, detail="O365 mailbox not connected")
    client_secret = await load_microsoft365_client_secret(
        settings,
        collection=db.settings,
        query={"type": "o365_mailbox"},
    )
    required = ("tenant_id", "client_id")
    if not client_secret or not all(settings.get(field) for field in required):
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
    fetched = intake_created = leads_created = tickets_created = activities_added = skipped = errors = 0
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            token_response = await client.post(
                f"https://login.microsoftonline.com/{settings['tenant_id']}/oauth2/v2.0/token",
                data={"client_id": settings["client_id"], "client_secret": client_secret, "scope": "https://graph.microsoft.com/.default", "grant_type": "client_credentials"},
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
                            intake_created += status == "intake_created"
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
        "message": f"Synced {fetched} email(s): {intake_created} intake item(s), {leads_created} lead(s), {tickets_created} ticket(s), {activities_added} activity update(s)",
        "mode": "live_graph", "emails_fetched": fetched, "leads_created": leads_created,
        "intake_created": intake_created, "tickets_created": tickets_created, "activities_added": activities_added, "skipped": skipped, "errors": errors,
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


def _incoming_headers(data: dict) -> dict[str, str]:
    """Return a lower-cased, bounded header map from a trusted mail relay payload."""
    raw_headers = data.get("internetMessageHeaders") or data.get("headers") or []
    if isinstance(raw_headers, dict):
        return {
            str(name).strip().lower(): str(value).strip()
            for name, value in raw_headers.items()
            if str(name).strip() and len(str(value)) <= 512
        }
    if not isinstance(raw_headers, list):
        return {}
    headers: dict[str, str] = {}
    for item in raw_headers:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip().lower()
        value = str(item.get("value") or "").strip()
        if name and len(name) <= 128 and len(value) <= 512:
            headers[name] = value
    return headers


def _normalise_thread_subject(subject: str) -> str:
    return re.sub(r"^(?:(?:re|fw|fwd)\s*:\s*)+", "", (subject or "").strip(), flags=re.I).casefold()


async def _threaded_ticket_for_inbound(headers: dict[str, str], subject: str, known_client: dict | None) -> dict | None:
    """Resolve a ticket only when its stored client matches the verified sender."""
    if not known_client or not known_client.get("id"):
        return None
    client_id = known_client["id"]
    header_ticket_id = headers.get("x-nexus-ticket-id")
    if not header_ticket_id:
        thread_key = str(headers.get("x-nexus-thread") or "")
        if thread_key.startswith("ticket:"):
            header_ticket_id = thread_key.split(":", 1)[1]
    if header_ticket_id and re.fullmatch(r"[A-Za-z0-9_-]{1,160}", header_ticket_id):
        ticket = await db.tickets.find_one({"id": header_ticket_id, "client_id": client_id}, {"_id": 0})
        if ticket:
            return ticket

    normalised_subject = _normalise_thread_subject(subject)
    if not normalised_subject:
        return None
    candidates = await db.tickets.find(
        {"client_id": client_id}, {"_id": 0}
    ).sort("updated_at", -1).to_list(250)
    return next(
        (
            ticket for ticket in candidates
            if str(ticket.get("ticket_number") or "").strip()
            and str(ticket.get("ticket_number") or "").casefold() in normalised_subject
        ),
        None,
    )


async def _possible_auto_reply_loop(headers: dict[str, str], sender_email: str, mailbox: str | None, subject: str) -> bool:
    """Suppress acknowledgement storms without dropping the inbound record itself."""
    automated = str(headers.get("auto-submitted") or "").casefold() not in {"", "no"}
    fingerprint = hashlib.sha256(
        f"{sender_email.casefold()}|{(mailbox or '').casefold()}|{_normalise_thread_subject(subject)}".encode("utf-8")
    ).hexdigest()
    now = datetime.now(timezone.utc)
    previous = await db.email_loop_guards.find_one({"fingerprint": fingerprint}, {"_id": 0, "last_seen_at": 1})
    await db.email_loop_guards.update_one(
        {"fingerprint": fingerprint},
        {"$set": {"last_seen_at": now.isoformat(), "automated": automated}, "$setOnInsert": {"created_at": now.isoformat()}},
        upsert=True,
    )
    if automated:
        return True
    if not previous or not previous.get("last_seen_at"):
        return False
    try:
        last_seen = datetime.fromisoformat(str(previous["last_seen_at"]).replace("Z", "+00:00"))
        return (now - last_seen) < timedelta(minutes=10)
    except ValueError:
        return False


def _inbound_email_attachments(data: dict) -> list[dict]:
    """Decode bounded file attachments from a trusted Graph/relay payload.

    Inline assets are intentionally excluded: they are frequently tracking or
    signature images and do not belong in the operational ticket evidence.
    """
    raw_attachments = data.get("attachments") or []
    if not isinstance(raw_attachments, list):
        return []
    decoded: list[dict] = []
    for item in raw_attachments[:10]:
        if not isinstance(item, dict) or item.get("isInline"):
            continue
        encoded = item.get("contentBytes") or item.get("content_base64")
        if not isinstance(encoded, str) or not encoded or len(encoded) > 35 * 1024 * 1024:
            continue
        try:
            content = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError):
            continue
        if len(content) > 25 * 1024 * 1024:
            continue
        decoded.append({
            "filename": str(item.get("name") or item.get("filename") or "email-attachment"),
            "content_type": str(item.get("contentType") or item.get("content_type") or "application/octet-stream"),
            "content": content,
        })
    return decoded


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
    incoming_headers = _incoming_headers(data)
    
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
    threaded_ticket = await _threaded_ticket_for_inbound(incoming_headers, subject, known_client)

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

    if threaded_ticket:
        received_at = datetime.now(timezone.utc).isoformat()
        stored_attachments = []
        rejected_attachment_count = 0
        from app.routers.ticket_attachments import store_ticket_attachment
        for inbound_attachment in _inbound_email_attachments(data):
            try:
                stored_attachments.append(await store_ticket_attachment(
                    ticket=threaded_ticket,
                    content=inbound_attachment["content"],
                    filename=inbound_attachment["filename"],
                    content_type=inbound_attachment["content_type"],
                    uploaded_by="external-email",
                    uploaded_by_name=sender_name or sender_email,
                    source="email_inbound",
                    source_message_id=inbound_message_id or None,
                ))
            except HTTPException:
                rejected_attachment_count += 1
        comment = {
            "id": str(uuid.uuid4()),
            "ticket_id": threaded_ticket["id"],
            "user_id": "external-email",
            "user_name": sender_name or sender_email,
            "content": body[:20000] if body else "(No message content)",
            "is_internal": False,
            "visibility": "public",
            "portal_visible": True,
            "client_notified": False,
            "source": "email_reply",
            "sender_email": sender_email,
            "subject": subject,
            "internet_message_id": inbound_message_id or None,
            "in_reply_to": incoming_headers.get("in-reply-to"),
            "references": incoming_headers.get("references"),
            "thread_key": incoming_headers.get("x-nexus-thread"),
            "attachment_count": len(stored_attachments),
            "rejected_attachment_count": rejected_attachment_count,
            "created_at": received_at,
        }
        await db.ticket_comments.insert_one(comment)
        try:
            await notify_ticket_subscribers(ticket=threaded_ticket, comment=comment, actor_id=None)
        except Exception:
            # The customer email is already durably captured. Subscriber
            # delivery may be retried independently and must not reject it.
            pass
        await db.tickets.update_one(
            {"id": threaded_ticket["id"], "client_id": known_client.get("id")},
            {"$set": {
                "updated_at": received_at,
                "last_activity_at": received_at,
                "last_customer_reply_at": received_at,
                "last_activity_by_id": "external-email",
                "last_activity_by_name": sender_name or sender_email,
            }},
        )
        await db.ticket_audit_log.insert_one({
            "id": str(uuid.uuid4()),
            "ticket_id": threaded_ticket["id"],
            "user_id": "external-email",
            "user_name": sender_name or sender_email,
            "action": "ticket_email_reply_received",
            "details": f"Customer email reply matched to the existing ticket thread ({len(stored_attachments)} attachment(s) retained)",
            "created_at": received_at,
        })
        from app.services.ticket_participants import sync_ticket_participants
        await sync_ticket_participants(
            ticket=threaded_ticket,
            addresses=[sender_email],
            role="sender",
            direction="inbound",
            delivery_status="received",
            display_name=sender_name,
        )
        return await remember({
            "status": "ticket_reply_added",
            "ticket_id": threaded_ticket["id"],
            "mailbox": routed_mailbox,
            "attachment_count": len(stored_attachments),
            "rejected_attachment_count": rejected_attachment_count,
            "message": "Email reply added to the existing ticket conversation",
        })

    # An acknowledgement is useful for new enquiries, but avoid obvious mail
    # loops and automated senders. The delivery is also captured in the shared
    # outbound audit trail through send_email.
    sender_local_part = sender_email.split("@", 1)[0].lower()
    automated_sender = sender_local_part in {"no-reply", "noreply", "postmaster", "mailer-daemon"} or (subject or "").strip().lower().startswith(("auto:", "automatic reply:"))
    auto_reply_loop = await _possible_auto_reply_loop(incoming_headers, sender_email, routed_mailbox, subject)
    auto_reply_enabled = routing.get("auto_reply_enabled", (settings or {}).get("auto_reply_enabled", False))
    if auto_reply_enabled and not automated_sender and not auto_reply_loop:
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
    
    existing_lead = await db.leads.find_one(tenant_scoped_query(current_user, {"email": email_match}), {"_id": 0})
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
        activity["tenant_id"] = platform_tenant_id(current_user)
        await db.lead_activities.insert_one(activity)
        await db.leads.update_one(tenant_scoped_query(current_user, {"id": existing_lead["id"]}), {"$set": {"last_contact": datetime.now(timezone.utc).isoformat()}})
        return await remember({"status": "activity_added", "lead_id": existing_lead["id"], "mailbox": routed_mailbox, "message": "Email logged as activity on existing lead"})

    intake = await create_email_intake_item(
        current_user=current_user, sender_email=sender_email, sender_name=sender_name,
        subject=subject, body=body, mailbox=routed_mailbox, message_id=inbound_message_id,
    )

    await db.notifications.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": "all",
        "type": "new_lead",
        "title": f"New lead intake: {sender_name or sender_email}",
        "message": f"{sender_name} ({sender_email}) emailed: {subject}",
        "mailbox_email": routed_mailbox,
        "ref_id": intake["id"],
        "ref_type": "lead_intake",
        "severity": "info",
        "read": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "tenant_id": platform_tenant_id(current_user),
    })
    
    return await remember({"status": "intake_created", "intake_id": intake["id"], "mailbox": routed_mailbox, "message": "Inbound email queued for Lead Intake review"})

@router.get("/o365/email-leads")
async def get_email_generated_leads(current_user: dict = Depends(get_current_user)):
    """Get leads that were auto-generated from emails"""
    await _require_mailbox_admin(current_user)
    leads = await db.leads.find({"source": "email"}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return leads
