from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from datetime import datetime, timezone, timedelta
from typing import Optional
from urllib.parse import quote
import hashlib
import secrets
import uuid
import jwt
import pyotp
from app.database import db, JWT_SECRET, JWT_ALGORITHM
from app.auth import hash_password, verify_password
from app.services.nexus_document_pdf import render_nexus_document_pdf
from app.services.portal_audit import record_portal_event
from app.services.public_url import configured_public_base_url

from app.services.scope_permissions import platform_tenant_id
from app.services.ticket_conversation import sanitise_ticket_rich_text
from app.services.ticket_subscriptions import notify_ticket_subscribers

router = APIRouter(prefix="/portal/v2", tags=["Portal V2"])
portal_security = HTTPBearer(auto_error=False)


def _portal_ticket_comment(comment: dict) -> dict:
    """Project a public ticket comment without leaking service-desk metadata.

    Internal delivery, idempotency and labour links are useful to technicians
    but must never become customer-facing API fields.  Rich service-desk
    content is projected to its audited plain-text form because the portal
    intentionally renders a safe text conversation, not technician HTML.
    """
    return {
        "id": comment.get("id"),
        "ticket_id": comment.get("ticket_id"),
        "sender_name": comment.get("user_name") or comment.get("sender_name") or "Support",
        "sender_email": comment.get("sender_email", ""),
        "sender_type": comment.get("sender_type") or "technician",
        "content": comment.get("content_text") or comment.get("content") or "",
        "subject": comment.get("subject", ""),
        "subject_label": comment.get("subject_label", ""),
        "created_at": comment.get("created_at"),
        "attachment_count": comment.get("attachment_count", 0),
    }


def _portal_ticket_comment_scope(ticket: dict, user: dict, client: dict | None = None) -> dict:
    """Build the immutable scope fields for a portal-created ticket comment.

    Portal users are client-bound, but older portal and ticket records may not
    have been backfilled with the platform tenant marker.  Prefer the parent
    ticket, then the canonical client record, and finally the authenticated
    portal user before using the documented local partition fallback.
    """
    tenant_id = str(
        ticket.get("tenant_id")
        or (client or {}).get("tenant_id")
        or user.get("tenant_id")
        or platform_tenant_id(user)
    ).strip()
    site_id = str(ticket.get("site_id") or user.get("site_id") or "").strip() or None
    return {
        "tenant_id": tenant_id,
        "client_id": str(ticket.get("client_id") or user.get("client_id") or "").strip(),
        "site_id": site_id,
    }


def _request_context(request: Request) -> dict:
    forwarded = request.headers.get("x-forwarded-for", "")
    ip_address = forwarded.split(",", 1)[0].strip() if forwarded else (request.client.host if request.client else None)
    return {
        "ip_address": ip_address,
        "user_agent": request.headers.get("user-agent", ""),
    }


def _link_is_expired(access_token: dict) -> bool:
    expires_at = access_token.get("expires_at")
    if not expires_at:
        return False
    try:
        return datetime.fromisoformat(str(expires_at).replace("Z", "+00:00")) <= datetime.now(timezone.utc)
    except (TypeError, ValueError):
        return True


def _latest_timestamp(*values):
    parsed = []
    for value in values:
        if not value:
            continue
        if isinstance(value, datetime):
            candidate = value
        else:
            try:
                candidate = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            except (TypeError, ValueError):
                continue
        if candidate.tzinfo is None:
            candidate = candidate.replace(tzinfo=timezone.utc)
        parsed.append(candidate.astimezone(timezone.utc))
    return max(parsed).isoformat() if parsed else None


_PORTAL_CHECKOUT_LINK_TTL = timedelta(hours=24)
_MAX_PORTAL_INVOICE_ID_LENGTH = 200


async def _load_portal_checkout_invoice(invoice_id: str, client_id: str) -> tuple[dict, str]:
    """Resolve exactly one client-owned invoice for a portal payment.

    Invoice IDs historically occur in both the native and Xero collections.
    A portal checkout must not guess which record a shared ID refers to: the
    chosen collection is persisted in the payment transaction and is later
    enforced by the signed Stripe webhook settlement boundary.
    """
    clean_invoice_id = str(invoice_id or "").strip()
    if not clean_invoice_id or len(clean_invoice_id) > _MAX_PORTAL_INVOICE_ID_LENGTH:
        raise HTTPException(status_code=422, detail="Invalid invoice identifier")
    clean_client_id = str(client_id or "").strip()
    if not clean_client_id:
        raise HTTPException(status_code=403, detail="Invoice access not permitted")

    native = await db.invoices.find_one(
        {"id": clean_invoice_id, "client_id": clean_client_id},
        {"_id": 0},
    )
    xero = await db.xero_invoices.find_one(
        {"id": clean_invoice_id, "client_id": clean_client_id},
        {"_id": 0},
    )
    matches = [(invoice, collection) for invoice, collection in ((native, "invoices"), (xero, "xero_invoices")) if invoice]
    if not matches:
        # Keep the old not-found behaviour rather than revealing whether the
        # invoice exists for another portal client.
        raise HTTPException(status_code=404, detail="Invoice not found")
    if len(matches) != 1:
        raise HTTPException(status_code=409, detail="Invoice requires reconciliation before online payment")
    return matches[0]


def _portal_checkout_link_id(
    *,
    invoice: dict,
    invoice_id: str,
    client_id: str,
    collection: str,
    balance: float,
    currency: str,
) -> str:
    """Return a retry-stable, server-owned payment-link identity.

    Version/balance/currency are included so an old checkout cannot be reused
    after a material invoice change.  It contains no secret and is not sent to
    the portal browser.
    """
    material = ":".join(
        (
            "nexus-portal-checkout-link:v1",
            collection,
            invoice_id,
            client_id,
            str(invoice.get("version", 0)),
            str(int(round(balance * 100))),
            currency,
        )
    )
    return f"portal-checkout-{hashlib.sha256(material.encode('utf-8')).hexdigest()[:40]}"


async def _get_or_create_portal_checkout_link(
    *,
    invoice: dict,
    invoice_id: str,
    client_id: str,
    collection: str,
    balance: float,
    currency: str,
    portal_user: dict,
) -> dict:
    """Create one internal payment capability for the authenticated portal flow.

    The link is intentionally never returned to the browser.  It exists so a
    portal-created Stripe checkout uses the same reservation, transaction and
    webhook-settlement controls as public payment links.  A deterministic
    Mongo ``_id`` makes concurrent retries converge on one link document.
    """
    link_id = _portal_checkout_link_id(
        invoice=invoice,
        invoice_id=invoice_id,
        client_id=client_id,
        collection=collection,
        balance=balance,
        currency=currency,
    )
    now = datetime.now(timezone.utc)
    link = {
        "_id": link_id,
        "id": link_id,
        "token": secrets.token_urlsafe(32),
        "invoice_id": invoice_id,
        "invoice_collection": collection,
        "invoice_number": str(invoice.get("invoice_number") or ""),
        "client_id": client_id,
        "client_name": str(invoice.get("client_name") or portal_user.get("client_name") or ""),
        "currency": currency,
        "total": invoice.get("total", 0),
        "balance_at_creation": balance,
        "invoice_version": invoice.get("version", 0),
        "allowed_methods": ["card"],
        "expires_at": (now + _PORTAL_CHECKOUT_LINK_TTL).isoformat(),
        "status": "active",
        "source": "portal_checkout",
        "visibility": "portal_authenticated",
        "created_at": now.isoformat(),
        "created_by": "Client portal",
        "created_by_id": portal_user.get("id"),
        "payments": [],
    }
    await db.payment_links.update_one(
        {"_id": link_id},
        {"$setOnInsert": link},
        upsert=True,
    )
    stored = await db.payment_links.find_one({"_id": link_id}, {"_id": 0})
    if not stored:
        raise HTTPException(status_code=503, detail="Unable to initialise online payment")

    # Do not treat a stale/corrupt row with a matching deterministic ID as a
    # valid checkout boundary.  The public-link loader performs the remaining
    # expiry, invoice status and client-binding checks before a provider call.
    if (
        stored.get("id") != link_id
        or stored.get("source") != "portal_checkout"
        or stored.get("visibility") != "portal_authenticated"
        or stored.get("invoice_id") != invoice_id
        or stored.get("invoice_collection") != collection
        or stored.get("client_id") != client_id
        or stored.get("currency") != currency
        or stored.get("allowed_methods") != ["card"]
        or not str(stored.get("token") or "").strip()
    ):
        raise HTTPException(status_code=409, detail="Invoice requires reconciliation before online payment")
    return stored

# --- Portal Auth Dependency ---
async def get_portal_user(credentials: HTTPAuthorizationCredentials = Depends(portal_security)):
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "portal":
            raise HTTPException(status_code=401, detail="Invalid portal token")
        user = await db.portal_users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
        if not user or not user.get("is_active", True):
            raise HTTPException(status_code=401, detail="User not found or inactive")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def create_portal_token(user_id: str, client_id: str, email: str):
    payload = {
        "sub": user_id, "client_id": client_id, "email": email,
        "type": "portal",
        "exp": datetime.now(timezone.utc) + timedelta(hours=12),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


# ==================== AUTH ====================

@router.post("/token-auth")
async def portal_token_auth(data: dict, request: Request):
    """Convert a legacy portal access token to a V2 portal session.
    Used when users access /portal/:token links â€” auto-redirects to V2."""
    token = data.get("token", "")
    if not token:
        raise HTTPException(status_code=400, detail="Token required")
    config = await db.portal_configs.find_one({"access_tokens.token": token, "enabled": True}, {"_id": 0})
    if not config:
        raise HTTPException(status_code=404, detail="Portal link expired or invalid")

    cid = config["client_id"]
    # Find or create a portal user for this token's contact
    access_token = next((t for t in config.get("access_tokens", []) if t.get("token") == token), None)
    if not access_token or not access_token.get("active", True) or _link_is_expired(access_token):
        await record_portal_event(
            action="secure_link_access",
            client_id=cid,
            client_name=config.get("client_name", ""),
            outcome="blocked",
            details="Expired or revoked client portal link was rejected",
            metadata={"link_id": (access_token or {}).get("id", "")},
            **_request_context(request),
        )
        raise HTTPException(status_code=403, detail="Portal link expired or revoked")
    contact_email = (access_token.get("contact_email", "") if access_token else "").lower().strip()

    if contact_email:
        portal_user = await db.portal_users.find_one({"email": contact_email, "client_id": cid}, {"_id": 0})
    else:
        portal_user = await db.portal_users.find_one({"client_id": cid, "is_primary_contact": True}, {"_id": 0})
        if not portal_user:
            portal_user = await db.portal_users.find_one({"client_id": cid}, {"_id": 0})

    if not portal_user:
        # No portal user exists â€” return info to show limited view
        client = await db.clients.find_one({"id": cid}, {"_id": 0, "name": 1})
        await record_portal_event(
            action="secure_link_opened",
            client_id=cid,
            client_name=client.get("name", "") if client else config.get("client_name", ""),
            outcome="warning",
            details="Secure portal link opened without a matching permanent portal user",
            metadata={"link_id": access_token.get("id", ""), "contact_email": contact_email},
            **_request_context(request),
        )
        return {"authenticated": False, "client_name": client.get("name", "") if client else "", "client_id": cid}

    if not portal_user.get("is_active", True):
        await record_portal_event(
            action="secure_link_access",
            client_id=cid,
            client_name=portal_user.get("client_name", config.get("client_name", "")),
            portal_user=portal_user,
            outcome="blocked",
            details="Secure portal link matched a disabled portal user",
            metadata={"link_id": access_token.get("id", "")},
            **_request_context(request),
        )
        raise HTTPException(status_code=401, detail="Account disabled")

    # Mark token as used
    await db.portal_configs.update_one(
        {"client_id": cid, "access_tokens.token": token},
        {"$set": {"access_tokens.$.last_used": datetime.now(timezone.utc).isoformat()}}
    )

    jwt_token = create_portal_token(portal_user["id"], cid, portal_user["email"])
    await db.portal_users.update_one(
        {"id": portal_user["id"]},
        {"$set": {"last_login": datetime.now(timezone.utc).isoformat(), "last_login_method": "secure_link"}},
    )
    await record_portal_event(
        action="secure_link_login_succeeded",
        client_id=cid,
        client_name=portal_user.get("client_name", config.get("client_name", "")),
        portal_user=portal_user,
        details=f"{portal_user.get('name') or portal_user.get('email')} signed in using a secure link",
        metadata={"link_id": access_token.get("id", ""), "authentication_method": "secure_link"},
        **_request_context(request),
    )
    safe_user = {k: v for k, v in portal_user.items() if k not in ("password_hash", "totp_secret")}
    return {"authenticated": True, "token": jwt_token, "user": safe_user}



@router.post("/login")
async def portal_login(data: dict, request: Request):
    email = data.get("email", "").lower().strip()
    password = data.get("password", "")
    if not email or not password:
        raise HTTPException(status_code=400, detail="Email and password required")

    user = await db.portal_users.find_one({"email": email}, {"_id": 0})
    if not user or not verify_password(password, user["password_hash"]):
        await record_portal_event(
            action="portal_login",
            client_id=(user or {}).get("client_id", ""),
            client_name=(user or {}).get("client_name", ""),
            portal_user=user or {"email": email, "name": email},
            outcome="failed",
            details="Client portal sign-in failed",
            metadata={"authentication_method": "password"},
            **_request_context(request),
        )
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.get("is_active", True):
        await record_portal_event(
            action="portal_login",
            client_id=user.get("client_id", ""),
            client_name=user.get("client_name", ""),
            portal_user=user,
            outcome="blocked",
            details="Disabled client portal account attempted to sign in",
            metadata={"authentication_method": "password"},
            **_request_context(request),
        )
        raise HTTPException(status_code=401, detail="Account is disabled")

    # Check 2FA
    if user.get("totp_enabled"):
        await record_portal_event(
            action="portal_login_mfa_challenge",
            client_id=user.get("client_id", ""),
            client_name=user.get("client_name", ""),
            portal_user=user,
            details="Portal password accepted; MFA verification required",
            metadata={"authentication_method": "password_mfa"},
            **_request_context(request),
        )
        return {"requires_2fa": True, "temp_token": create_portal_token(user["id"], user.get("client_id", ""), email) + ":2fa_pending"}

    token = create_portal_token(user["id"], user.get("client_id", ""), email)
    await db.portal_users.update_one(
        {"id": user["id"]},
        {"$set": {"last_login": datetime.now(timezone.utc).isoformat(), "last_login_method": "password"}},
    )
    await record_portal_event(
        action="portal_login_succeeded",
        client_id=user.get("client_id", ""),
        client_name=user.get("client_name", ""),
        portal_user=user,
        details=f"{user.get('name') or user.get('email')} signed in to the client portal",
        metadata={"authentication_method": "password"},
        **_request_context(request),
    )
    safe_user = {k: v for k, v in user.items() if k not in ("password_hash", "totp_secret")}
    return {"token": token, "user": safe_user, "requires_2fa": False}


@router.post("/verify-2fa")
async def portal_verify_2fa(data: dict, request: Request):
    temp_token = data.get("temp_token", "")
    code = data.get("code", "")
    if not temp_token.endswith(":2fa_pending"):
        raise HTTPException(status_code=400, detail="Invalid 2FA flow")

    real_token = temp_token.replace(":2fa_pending", "")
    try:
        payload = jwt.decode(real_token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = await db.portal_users.find_one({"id": payload["sub"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    totp = pyotp.TOTP(user.get("totp_secret", ""))
    if not totp.verify(code, valid_window=1):
        await record_portal_event(
            action="portal_mfa_verification",
            client_id=user.get("client_id", ""),
            client_name=user.get("client_name", ""),
            portal_user=user,
            outcome="failed",
            details="Client portal MFA verification failed",
            metadata={"authentication_method": "password_mfa"},
            **_request_context(request),
        )
        raise HTTPException(status_code=401, detail="Invalid 2FA code")

    token = create_portal_token(user["id"], user.get("client_id", ""), user["email"])
    await db.portal_users.update_one(
        {"id": user["id"]},
        {"$set": {"last_login": datetime.now(timezone.utc).isoformat(), "last_login_method": "password_mfa"}},
    )
    await record_portal_event(
        action="portal_login_succeeded",
        client_id=user.get("client_id", ""),
        client_name=user.get("client_name", ""),
        portal_user=user,
        details=f"{user.get('name') or user.get('email')} completed MFA and signed in",
        metadata={"authentication_method": "password_mfa"},
        **_request_context(request),
    )
    safe_user = {k: v for k, v in user.items() if k not in ("password_hash", "totp_secret")}
    return {"token": token, "user": safe_user}


@router.get("/setup-2fa")
async def portal_setup_2fa(user: dict = Depends(get_portal_user)):
    secret = user.get("totp_secret")
    if not secret:
        secret = pyotp.random_base32()
        await db.portal_users.update_one({"id": user["id"]}, {"$set": {"totp_secret": secret}})

    totp = pyotp.TOTP(secret)
    uri = totp.provisioning_uri(name=user["email"], issuer_name="NexusMSP Client Portal")
    return {"secret": secret, "uri": uri, "already_enabled": user.get("totp_enabled", False)}


@router.post("/enable-2fa")
async def portal_enable_2fa(data: dict, request: Request, user: dict = Depends(get_portal_user)):
    code = data.get("code", "")
    u = await db.portal_users.find_one({"id": user["id"]}, {"_id": 0})
    secret = u.get("totp_secret")
    if not secret:
        raise HTTPException(status_code=400, detail="Run setup-2fa first")

    totp = pyotp.TOTP(secret)
    if not totp.verify(code, valid_window=1):
        await record_portal_event(
            action="portal_mfa_enable",
            client_id=user.get("client_id", ""),
            client_name=user.get("client_name", ""),
            portal_user=user,
            outcome="failed",
            details="Client portal MFA enablement verification failed",
            **_request_context(request),
        )
        raise HTTPException(status_code=400, detail="Invalid code â€” try again")

    await db.portal_users.update_one({"id": user["id"]}, {"$set": {"totp_enabled": True}})
    await record_portal_event(
        action="portal_mfa_enabled",
        client_id=user.get("client_id", ""),
        client_name=user.get("client_name", ""),
        portal_user=user,
        details=f"{user.get('name') or user.get('email')} enabled MFA",
        **_request_context(request),
    )
    return {"message": "2FA enabled successfully"}


@router.post("/disable-2fa")
async def portal_disable_2fa(data: dict, request: Request, user: dict = Depends(get_portal_user)):
    code = data.get("code", "")
    u = await db.portal_users.find_one({"id": user["id"]}, {"_id": 0})
    secret = u.get("totp_secret")
    if secret:
        totp = pyotp.TOTP(secret)
        if not totp.verify(code, valid_window=1):
            await record_portal_event(
                action="portal_mfa_disable",
                client_id=user.get("client_id", ""),
                client_name=user.get("client_name", ""),
                portal_user=user,
                outcome="failed",
                details="Client portal MFA disablement verification failed",
                **_request_context(request),
            )
            raise HTTPException(status_code=400, detail="Invalid code")
    await db.portal_users.update_one({"id": user["id"]}, {"$set": {"totp_enabled": False}})
    await record_portal_event(
        action="portal_mfa_disabled",
        client_id=user.get("client_id", ""),
        client_name=user.get("client_name", ""),
        portal_user=user,
        details=f"{user.get('name') or user.get('email')} disabled MFA",
        **_request_context(request),
    )
    return {"message": "2FA disabled"}


@router.post("/logout")
async def portal_logout(request: Request, user: dict = Depends(get_portal_user)):
    """Record explicit portal sign-out; bearer sessions remain short-lived and stateless."""
    await record_portal_event(
        action="portal_logout",
        client_id=user.get("client_id", ""),
        client_name=user.get("client_name", ""),
        portal_user=user,
        details=f"{user.get('name') or user.get('email')} signed out of the client portal",
        **_request_context(request),
    )
    return {"message": "Signed out"}


# ==================== PROFILE ====================

@router.get("/me")
async def portal_me(user: dict = Depends(get_portal_user)):
    # Get client + branding
    client = await db.clients.find_one({"id": user.get("client_id")}, {"_id": 0})
    config = await db.portal_configs.find_one({"client_id": user.get("client_id")}, {"_id": 0})
    branding = config.get("branding", {}) if config else {}
    # Get MSP branding for logo
    msp_branding = await db.settings.find_one({"key": "branding"}, {"_id": 0})
    return {
        "user": {k: v for k, v in user.items() if k not in ("password_hash", "totp_secret")},
        "client": client,
        "branding": branding,
        "features": (config or {}).get("features", {
            "can_create_tickets": True,
            "can_view_devices": True,
            "can_view_invoices": True,
            "can_view_contracts": True,
            "can_view_kb": True,
        }),
        "msp_branding": msp_branding.get("value", {}) if msp_branding else {},
        "totp_enabled": user.get("totp_enabled", False),
    }


@router.put("/me")
async def portal_update_profile(data: dict, request: Request, user: dict = Depends(get_portal_user)):
    allowed = {"name", "phone"}
    updates = {k: v for k, v in data.items() if k in allowed}
    if "password" in data and data["password"]:
        updates["password_hash"] = hash_password(data["password"])
    if updates:
        await db.portal_users.update_one({"id": user["id"]}, {"$set": updates})
        await record_portal_event(
            action="portal_profile_updated",
            client_id=user.get("client_id", ""),
            client_name=user.get("client_name", ""),
            portal_user=user,
            details=f"{user.get('name') or user.get('email')} updated their portal profile",
            metadata={
                "changed_fields": sorted(key for key in updates if key != "password_hash"),
                "password_changed": "password_hash" in updates,
            },
            **_request_context(request),
        )
    return {"message": "Profile updated"}


# ==================== DASHBOARD ====================

@router.get("/dashboard")
async def portal_dashboard(user: dict = Depends(get_portal_user)):
    cid = user.get("client_id")
    client = await db.clients.find_one({"id": cid}, {"_id": 0, "name": 1}) or {}
    config = await db.portal_configs.find_one({"client_id": cid}, {"_id": 0, "features": 1}) or {}
    features = config.get("features") or {}
    tickets = await db.tickets.find(
        {"client_id": cid},
        {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "status": 1, "priority": 1, "created_at": 1, "updated_at": 1},
    ).sort("updated_at", -1).to_list(500)
    devices = []
    if user.get("can_view_assets", True) and features.get("can_view_devices", True):
        devices = await db.devices.find(
            {"client_id": cid},
            {"_id": 0, "id": 1, "name": 1, "hostname": 1, "status": 1, "last_heartbeat": 1},
        ).to_list(500)
    invoices = []
    if user.get("can_view_invoices", False):
        invoices = await db.invoices.find(
            {"client_id": cid},
            {"_id": 0, "id": 1, "invoice_number": 1, "status": 1, "payment_status": 1, "total": 1, "amount_paid": 1, "due_date": 1, "created_at": 1},
        ).sort("created_at", -1).to_list(200)
    contracts = []
    if features.get("can_view_contracts", True):
        contracts = await db.contracts.find(
            {"client_id": cid, "status": "active"},
            {"_id": 0, "id": 1, "name": 1, "type": 1, "status": 1, "end_date": 1, "sla_tier": 1},
        ).to_list(100)
    backup_jobs = await db.backup_jobs.find(
        {"$or": [{"client_id": cid}, {"client_name": client.get("name", "")}]},
        {"_id": 0, "id": 1, "job_name": 1, "device_name": 1, "status": 1, "last_run": 1},
    ).sort("last_run", -1).to_list(100)

    open_t = sum(1 for t in tickets if t.get("status") in ("open", "in_progress"))
    resolved_t = sum(1 for t in tickets if t.get("status") in ("resolved", "closed"))
    urgent_t = sum(1 for t in tickets if t.get("status") not in ("resolved", "closed") and t.get("priority") in ("critical", "high"))
    online_d = sum(1 for d in devices if d.get("status") == "online")
    outstanding = sum(
        max(float(i.get("total", 0) or 0) - float(i.get("amount_paid", 0) or 0), 0)
        for i in invoices
        if (i.get("payment_status") or i.get("status")) not in ("paid", "void", "cancelled")
    )
    failed_backups = sum(1 for job in backup_jobs if job.get("status") in ("failed", "error"))
    health_status = "attention" if urgent_t or failed_backups else "operational"
    activity = []
    for ticket in tickets[:8]:
        activity.append({
            "id": f"ticket-{ticket.get('id')}",
            "type": "ticket",
            "title": ticket.get("title") or ticket.get("ticket_number") or "Support request",
            "detail": f"{str(ticket.get('status') or 'open').replace('_', ' ').title()} · {str(ticket.get('priority') or 'medium').title()} priority",
            "timestamp": ticket.get("updated_at") or ticket.get("created_at"),
            "target_id": ticket.get("id"),
        })
    for invoice in invoices[:5]:
        activity.append({
            "id": f"invoice-{invoice.get('id')}",
            "type": "invoice",
            "title": f"Invoice {invoice.get('invoice_number') or ''}".strip(),
            "detail": str(invoice.get("payment_status") or invoice.get("status") or "issued").replace("_", " ").title(),
            "timestamp": invoice.get("created_at"),
            "target_id": invoice.get("id"),
        })
    for job in backup_jobs[:5]:
        activity.append({
            "id": f"backup-{job.get('id')}",
            "type": "backup",
            "title": job.get("job_name") or job.get("device_name") or "Backup verification",
            "detail": f"Backup {str(job.get('status') or 'unknown').replace('_', ' ')}",
            "timestamp": job.get("last_run"),
            "target_id": job.get("id"),
        })
    activity.sort(key=lambda item: item.get("timestamp") or "", reverse=True)

    return {
        "stats": {
            "open_tickets": open_t, "resolved_tickets": resolved_t, "total_tickets": len(tickets),
            "urgent_tickets": urgent_t,
            "online_devices": online_d, "total_devices": len(devices),
            "outstanding_invoices": outstanding, "total_invoices": len(invoices),
            "active_services": len(contracts), "failed_backups": failed_backups,
        },
        "service_health": {
            "status": health_status,
            "label": "Attention required" if health_status == "attention" else "All managed services operational",
            "summary": (
                f"{urgent_t} urgent request{'s' if urgent_t != 1 else ''} and {failed_backups} failed backup{'s' if failed_backups != 1 else ''}"
                if health_status == "attention"
                else "Monitoring, managed assets, and protected workloads are reporting normally"
            ),
            "last_checked": datetime.now(timezone.utc).isoformat(),
        },
        "recent_activity": activity[:12],
    }


# ==================== TICKETS ====================

@router.get("/tickets")
async def portal_tickets(user: dict = Depends(get_portal_user)):
    cid = user.get("client_id")
    query = {"client_id": cid}
    if not user.get("can_view_all_tickets"):
        query["$or"] = [{"contact_email": user.get("email")}, {"created_by": user.get("name")}, {"contact_email": {"$exists": False}}]
    tickets = await db.tickets.find(query, {"_id": 0}).sort("created_at", -1).to_list(200)
    return tickets


@router.post("/tickets")
async def portal_create_ticket(data: dict, user: dict = Depends(get_portal_user)):
    if not user.get("can_create_tickets", True):
        raise HTTPException(status_code=403, detail="Ticket creation not permitted")
    client = await db.clients.find_one(
        {"id": user.get("client_id")},
        {"_id": 0, "name": 1, "tenant_id": 1},
    )
    ticket_scope = _portal_ticket_comment_scope(
        {"client_id": user.get("client_id"), "site_id": user.get("site_id")},
        user,
        client,
    )
    description = str(data.get("description") or "")
    comment_content, comment_content_text = ("", "")
    if description.strip():
        comment_content, comment_content_text = sanitise_ticket_rich_text(description)
    ticket = {
        "id": f"TKT-{uuid.uuid4().hex[:6].upper()}", "ticket_number": f"PT-{datetime.now(timezone.utc).strftime('%m%d%H%M')}",
        "title": data.get("title", "Portal Ticket"), "description": data.get("description", ""),
        "priority": data.get("priority", "medium"), "category": data.get("category", "support"),
        "request_type": data.get("request_type", "incident"),
        "impact": data.get("impact", "single_user"),
        "urgency": data.get("urgency", data.get("priority", "medium")),
        "preferred_contact": data.get("preferred_contact", "portal"),
        "affected_device_id": data.get("affected_device_id") or None,
        "affected_device_name": data.get("affected_device_name") or None,
        "status": "open", "source": "client_portal",
        "client_id": user.get("client_id"), "client_name": client["name"] if client else "",
        "tenant_id": ticket_scope["tenant_id"], "site_id": ticket_scope["site_id"],
        "contact_name": user.get("name"), "contact_email": user.get("email"),
        "assigned_to": None, "assigned_name": None, "tags": [],
        "created_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat(),
        "created_by": user.get("name"),
    }
    await db.tickets.insert_one(ticket)
    await db.ticket_comments.insert_one({
        "id": str(uuid.uuid4()),
        "ticket_id": ticket["id"],
        **ticket_scope,
        "user_id": user.get("id"),
        "user_name": user.get("name", "Client"),
        "sender_name": user.get("name", "Client"),
        "sender_email": user.get("email", ""),
        "sender_type": "client",
        "content": comment_content,
        "content_text": comment_content_text,
        "content_format": "tiptap_html.v1",
        "is_internal": False,
        "visibility": "public",
        "portal_visible": True,
        "client_notified": False,
        "delivery_status": "received",
        "event_type": "portal_request_created",
        "source": "client_portal",
        "created_at": ticket["created_at"],
    })
    ticket.pop("_id", None)
    return ticket


@router.get("/tickets/{ticket_id}")
async def portal_ticket_detail(ticket_id: str, user: dict = Depends(get_portal_user)):
    """Get full ticket detail with messages/conversation."""
    ticket = await db.tickets.find_one({"id": ticket_id, "client_id": user.get("client_id")}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    # Present one client-safe thread. Historical portal messages are retained,
    # while new public technician updates and client replies live in the same
    # audited ticket-comments collection used by the service desk.
    legacy_messages = await db.ticket_messages.find(
        {"ticket_id": ticket_id}, {"_id": 0}
    ).sort("created_at", 1).to_list(200)
    public_comments = await db.ticket_comments.find(
        {"ticket_id": ticket_id, "is_internal": {"$ne": True}},
        {"_id": 0},
    ).sort("created_at", 1).to_list(500)
    messages = [
        *legacy_messages,
        *[
            _portal_ticket_comment(comment)
            for comment in public_comments
        ],
    ]
    messages.sort(key=lambda item: item.get("created_at") or "")
    return {"ticket": ticket, "messages": messages}


@router.post("/tickets/{ticket_id}/messages")
async def portal_add_ticket_message(ticket_id: str, data: dict, user: dict = Depends(get_portal_user)):
    """Add a message to a ticket conversation from the portal."""
    ticket = await db.tickets.find_one(
        {"id": ticket_id, "client_id": user.get("client_id")},
        {"_id": 0, "id": 1, "status": 1, "tenant_id": 1, "client_id": 1, "site_id": 1},
    )
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    content = str(data.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="Write a reply before sending")
    content_html, content_text = sanitise_ticket_rich_text(content)
    message = {
        "id": str(uuid.uuid4()),
        "ticket_id": ticket_id,
        **_portal_ticket_comment_scope(ticket, user),
        "user_id": user.get("id"),
        "user_name": user.get("name", "Client"),
        "sender_name": user.get("name", "Client"),
        "sender_email": user.get("email", ""),
        "sender_type": "client",
        "content": content_html,
        "content_text": content_text,
        "content_format": "tiptap_html.v1",
        "is_internal": False,
        "visibility": "public",
        "portal_visible": True,
        "client_notified": False,
        "delivery_status": "received",
        "source": "client_portal",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.ticket_comments.insert_one(dict(message))
    try:
        await notify_ticket_subscribers(ticket=ticket, comment=message, actor_id=None)
    except Exception:
        # The customer reply is already durable. Preserve it rather than
        # rejecting the portal action when a technician notification retries.
        pass
    update = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if ticket.get("status") in {"on_hold", "resolved", "closed"}:
        update["status"] = "open"
        update["reopened_at"] = update["updated_at"]
        update["reopened_reason"] = "Client replied through the portal"
    await db.tickets.update_one({"id": ticket_id}, {"$set": update})
    return _portal_ticket_comment(message)




# ==================== DEVICES ====================

@router.get("/devices")
async def portal_devices(user: dict = Depends(get_portal_user)):
    if not user.get("can_view_assets", True):
        raise HTTPException(status_code=403, detail="Device access not permitted")
    devices = await db.devices.find(
        {"client_id": user.get("client_id")},
        {
            "_id": 0,
            "id": 1,
            "name": 1,
            "hostname": 1,
            "device_type": 1,
            "os": 1,
            "status": 1,
            "ip_address": 1,
            "cpu_usage": 1,
            "memory_usage": 1,
            "disk_usage": 1,
            "last_seen": 1,
            "last_heartbeat": 1,
            "rd_last_seen": 1,
            "agent_version": 1,
            "rustdesk_id": 1,
            "antivirus_status": 1,
            "compliance_score": 1,
        },
    ).to_list(500)
    for device in devices:
        device["last_check_in"] = _latest_timestamp(device.get("last_heartbeat"), device.get("last_seen"))
        device["remote_provider"] = "nexus"
        device["remote_ready"] = False
        device["remote_access_reason"] = "Native portal remote access is not available yet. Contact your technician."
        device.pop("rustdesk_id", None)
    return devices


@router.post("/devices/{device_id}/remote-connect")
async def portal_remote_connect(
    device_id: str,
    request: Request,
    data: dict = None,
    user: dict = Depends(get_portal_user),
):
    """Retire the external-provider launch without removing portal history."""
    if not user.get("can_remote_devices", False):
        raise HTTPException(status_code=403, detail="Remote access not permitted")
    raise HTTPException(status_code=410, detail="External remote access is retired. Native portal sessions are not available yet.")


@router.post("/remote-sessions/{session_id}/end")
async def portal_end_remote_session(
    session_id: str,
    request: Request,
    data: dict = None,
    user: dict = Depends(get_portal_user),
):
    """Mark a remote session as ended, compute duration."""
    data = data or {}
    rec = await db.remote_session_records.find_one(
        {"id": session_id, "client_id": user.get("client_id"), "portal_user_id": user.get("id")},
        {"_id": 0}
    )
    if not rec:
        raise HTTPException(status_code=404, detail="Remote session record not found")
    if rec.get("ended_at"):
        return {"message": "Session already ended", "duration_seconds": rec.get("duration_seconds", 0)}

    now = datetime.now(timezone.utc)
    try:
        started = datetime.fromisoformat((rec.get("started_at") or "").replace("Z", "+00:00"))
    except Exception:
        started = now
    duration = int((now - started).total_seconds())

    await db.remote_session_records.update_one(
        {"id": session_id},
        {"$set": {
            "ended_at": now.isoformat(),
            "duration_seconds": duration,
            "status": "completed",
            "notes": data.get("notes", ""),
        }}
    )
    await db.rustdesk_sessions.update_one(
        {"id": session_id},
        {"$set": {"ended_at": now.isoformat(), "status": "completed"}}
    )
    await record_portal_event(
        action="portal_remote_session_completed",
        client_id=user.get("client_id"),
        client_name=rec.get("client_name", ""),
        portal_user=user,
        outcome="success",
        details=f"Client-authorised remote session completed for {rec.get('device_name') or 'managed device'}",
        metadata={
            "session_id": session_id,
            "device_id": rec.get("device_id"),
            "device_name": rec.get("device_name"),
            "provider": "rustdesk",
            "duration_seconds": duration,
            "notes_recorded": bool(str(data.get("notes") or "").strip()),
        },
        **_request_context(request),
    )
    return {"message": "Session ended", "duration_seconds": duration}


@router.get("/remote-sessions")
async def portal_list_remote_sessions(user: dict = Depends(get_portal_user)):
    """Portal user sees only their own remote sessions."""
    recs = await db.remote_session_records.find(
        {"client_id": user.get("client_id"), "portal_user_id": user.get("id")},
        {"_id": 0}
    ).sort("started_at", -1).to_list(200)
    return recs


@router.get("/remote-sessions/{session_id}/pdf")
async def portal_remote_session_pdf(session_id: str, user: dict = Depends(get_portal_user)):
    """Generate a compliance-grade PDF audit record for this session."""
    from fpdf import FPDF
    from fastapi.responses import Response

    rec = await db.remote_session_records.find_one(
        {"id": session_id, "client_id": user.get("client_id"), "portal_user_id": user.get("id")},
        {"_id": 0}
    )
    if not rec:
        raise HTTPException(status_code=404, detail="Remote session record not found")

    # All portal evidence uses the same renderer as reports and procurement
    # records.  This prevents a client download from looking like a separate,
    # generic product surface.
    branding_record = await db.settings.find_one({"type": "branding"}, {"_id": 0})
    if not branding_record:
        branding_record = await db.settings.find_one({"key": "branding"}, {"_id": 0})
    branding = (branding_record or {}).get("value", branding_record or {}) or {}

    def duration_label(raw_seconds):
        if raw_seconds is None:
            return "In progress"
        total = max(int(raw_seconds or 0), 0)
        hours, remainder = divmod(total, 3600)
        minutes, seconds = divmod(remainder, 60)
        if hours:
            return f"{hours}h {minutes}m {seconds}s"
        if minutes:
            return f"{minutes}m {seconds}s"
        return f"{seconds}s"

    status = str(rec.get("status") or "completed").replace("_", " ").title()
    session_ref = str(rec.get("id") or "session")[:8].upper()
    client_name = rec.get("client_name") or user.get("client_name") or "Client portal"
    device_name = rec.get("device_name") or "Not recorded"
    details = {
        "Client": client_name,
        "Requested by": f"{rec.get('portal_user_name') or user.get('name') or 'Portal user'} ({rec.get('portal_user_email') or user.get('email') or 'Not recorded'})",
        "Device": device_name,
        "Operating system": rec.get("device_os") or "Not recorded",
        "Remote service": rec.get("provider") or "Nexus Remote / RustDesk",
        "Session reference": session_ref,
        "Started": rec.get("started_at") or "Not recorded",
        "Ended": rec.get("ended_at") or "In progress",
        "Duration": duration_label(rec.get("duration_seconds")),
        "Status": status,
        "Origin IP": rec.get("ip_address") or "Not recorded",
    }
    consent = {
        "Acknowledgement": rec.get("consent_text") or "Client consent was captured before the remote session started.",
        "Acknowledged at": rec.get("consent_acknowledged_at") or "Not recorded",
        "Client-initiated": "Yes" if rec.get("portal_user_id") else "No",
    }
    sections = [("Session evidence", details), ("Consent & authorisation", consent)]
    if rec.get("notes"):
        sections.append(("Session notes", rec.get("notes")))

    pdf_bytes = render_nexus_document_pdf(
        title=f"Remote Session {session_ref}",
        document_kind="Remote access audit",
        subtitle="Client-initiated remote access evidence retained by NexusMSP.",
        metadata=[
            ("Client", client_name),
            ("Device", device_name),
            ("Status", status),
            ("Started", rec.get("started_at")),
        ],
        metric_cards=[
            ("Session status", status),
            ("Duration", duration_label(rec.get("duration_seconds"))),
            ("Consent", "Captured" if rec.get("consent_acknowledged_at") else "Retained"),
            ("Remote service", rec.get("provider") or "Nexus Remote"),
        ],
        sections=sections,
        branding=branding,
        footer="This is a retained, tamper-evident NexusMSP record of a client-initiated remote-access session.",
        generated_by=user.get("name") or user.get("email") or "NexusMSP",
    )
    filename = f"remote-session-{session_ref.lower()}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

    # Fetch MSP branding
    branding = await db.settings.find_one({"key": "branding"}, {"_id": 0}) or {}
    msp_name = (branding.get("value", {}) or {}).get("company_name") or "NexusOps"

    def _fmt_dur(s):
        if s is None:
            return "In progress"
        s = int(s or 0)
        h, rem = divmod(s, 3600)
        m, sec = divmod(rem, 60)
        if h: return f"{h}h {m}m {sec}s"
        if m: return f"{m}m {sec}s"
        return f"{sec}s"

    def _fmt_dt(iso):
        if not iso:
            return "â€”"
        try:
            dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
            return dt.strftime("%Y-%m-%d %H:%M:%S UTC")
        except Exception:
            return iso

    pdf = FPDF()
    pdf.add_page()

    # Header
    pdf.set_fill_color(15, 23, 42)
    pdf.rect(0, 0, 210, 25, "F")
    pdf.set_font("Helvetica", "B", 16)
    pdf.set_text_color(255, 255, 255)
    pdf.set_xy(10, 8)
    pdf.cell(0, 8, msp_name, ln=1)
    pdf.set_font("Helvetica", "", 10)
    pdf.set_x(10)
    pdf.cell(0, 5, "Remote Access Session - Audit Record", ln=1)

    pdf.set_text_color(0, 0, 0)
    pdf.set_y(35)

    # Title
    pdf.set_font("Helvetica", "B", 13)
    pdf.cell(0, 8, f"Session ID: {rec['id'][:8].upper()}", ln=1)
    pdf.ln(2)

    # Two-column key/value layout
    def row(label, value):
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(55, 7, label, border=0)
        pdf.set_font("Helvetica", "", 10)
        txt = str(value or "-")
        txt = txt.encode("latin-1", "replace").decode("latin-1")
        # Truncate if too long for a single line to avoid FPDF width errors
        if len(txt) > 85:
            txt = txt[:82] + "..."
        pdf.cell(0, 7, txt, ln=1)

    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(0, 7, "Session Details", ln=1)
    pdf.set_draw_color(200, 200, 200)
    pdf.line(10, pdf.get_y(), 200, pdf.get_y())
    pdf.ln(2)

    row("Client", rec.get("client_name"))
    row("Initiated by", f"{rec.get('portal_user_name')} ({rec.get('portal_user_email')})")
    row("Device", f"{rec.get('device_name')} ({rec.get('device_os', 'â€”')})")
    row("RustDesk ID", rec.get("rustdesk_id"))
    row("Started at", _fmt_dt(rec.get("started_at")))
    row("Ended at", _fmt_dt(rec.get("ended_at")))
    row("Duration", _fmt_dur(rec.get("duration_seconds")))
    row("Status", (rec.get("status") or "").capitalize())
    row("IP address", rec.get("ip_address"))

    pdf.ln(4)
    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(0, 7, "Consent Acknowledgement", ln=1)
    pdf.line(10, pdf.get_y(), 200, pdf.get_y())
    pdf.ln(2)
    pdf.set_font("Helvetica", "", 10)
    pdf.multi_cell(0, 6, (rec.get("consent_text") or "-").encode("latin-1", "replace").decode("latin-1"))
    pdf.ln(1)
    pdf.set_font("Helvetica", "I", 9)
    pdf.set_text_color(80, 80, 80)
    pdf.cell(0, 5, f"Acknowledged at: {_fmt_dt(rec.get('consent_acknowledged_at'))}", ln=1)

    if rec.get("notes"):
        pdf.ln(4)
        pdf.set_text_color(0, 0, 0)
        pdf.set_font("Helvetica", "B", 11)
        pdf.cell(0, 7, "Session Notes", ln=1)
        pdf.line(10, pdf.get_y(), 200, pdf.get_y())
        pdf.ln(2)
        pdf.set_font("Helvetica", "", 10)
        pdf.multi_cell(0, 6, rec.get("notes").encode("latin-1", "replace").decode("latin-1"))

    # Footer
    pdf.set_y(-25)
    pdf.set_font("Helvetica", "", 8)
    pdf.set_text_color(120, 120, 120)
    pdf.cell(0, 5, f"Generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} - {msp_name}", ln=1, align="C")
    pdf.cell(0, 5, "This document is a tamper-evident audit record of a client-initiated remote access session.", ln=1, align="C")

    pdf_bytes = bytes(pdf.output(dest="S"))
    filename = f"remote-session-{rec['id'][:8]}.pdf"
    return Response(content=pdf_bytes, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})
# ==================== INVOICES ====================

@router.get("/invoices")
async def portal_invoices(user: dict = Depends(get_portal_user)):
    if not user.get("can_view_invoices", False):
        return []
    invoices = await db.invoices.find(
        {"client_id": user.get("client_id")},
        {"_id": 0, "id": 1, "invoice_number": 1, "status": 1, "payment_status": 1, "total": 1,
         "amount_due": 1, "amount_paid": 1, "due_date": 1, "issued_date": 1, "created_at": 1,
         "paid_date": 1, "currency": 1}
    ).sort("created_at", -1).to_list(200)
    # Also check xero_invoices
    xero_invoices = await db.xero_invoices.find(
        {"client_id": user.get("client_id")},
        {"_id": 0, "id": 1, "invoice_number": 1, "status": 1, "payment_status": 1, "total": 1,
         "amount_due": 1, "amount_paid": 1, "due_date": 1, "issued_date": 1, "created_at": 1,
         "paid_date": 1, "currency": 1}
    ).sort("created_at", -1).to_list(200)
    seen = {i["id"] for i in invoices}
    for xi in xero_invoices:
        if xi["id"] not in seen:
            invoices.append(xi)
    return invoices


@router.get("/invoices/{invoice_id}")
async def portal_invoice_detail(invoice_id: str, user: dict = Depends(get_portal_user)):
    """Get full invoice detail for portal viewing."""
    if not user.get("can_view_invoices", False):
        raise HTTPException(status_code=403, detail="Invoice access not permitted")
    cid = user.get("client_id")
    invoice = await db.invoices.find_one({"id": invoice_id, "client_id": cid}, {"_id": 0})
    if not invoice:
        invoice = await db.xero_invoices.find_one({"id": invoice_id, "client_id": cid}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return invoice


@router.post("/invoices/{invoice_id}/pay")
async def portal_pay_invoice(
    invoice_id: str,
    data: dict,
    request: Request,
    user: dict = Depends(get_portal_user),
):
    """Start one verified, client-bound Stripe checkout for a portal invoice.

    The request body is retained for backwards-compatible clients, but origin,
    currency, amount and idempotency are all determined by Nexus.  Browsers
    cannot create a chargeable session that is not reserved and persisted in
    the payment-link/payment-transaction boundary consumed by signed webhooks.
    """
    del data  # Legacy callers submit origin/currency; neither is trusted here.
    invoice_id = str(invoice_id or "").strip()
    if not user.get("can_view_invoices", False):
        await record_portal_event(
            action="portal_invoice_payment_checkout",
            client_id=str(user.get("client_id") or ""),
            portal_user=user,
            outcome="blocked",
            details="Portal payment checkout rejected because invoice access is not enabled",
            metadata={"invoice_id": str(invoice_id or "")[:_MAX_PORTAL_INVOICE_ID_LENGTH]},
            **_request_context(request),
        )
        raise HTTPException(status_code=403, detail="Invoice access not permitted")

    client_id = str(user.get("client_id") or "").strip()
    try:
        from app.routers import payment_links
        from app.services.stripe_checkout import StripeCheckout, CheckoutSessionRequest

        invoice, collection = await _load_portal_checkout_invoice(invoice_id, client_id)
        if str(invoice.get("status") or "").strip().lower() in payment_links._CANCELLED_INVOICE_STATUSES:
            raise HTTPException(status_code=409, detail="Cannot collect payment for a voided invoice")
        balance = payment_links._invoice_balance(invoice)
        if balance <= 0:
            raise HTTPException(status_code=409, detail="Invoice already fully paid")
        currency = payment_links._currency(invoice.get("currency"))
        stripe_key = await payment_links._stripe_api_key()
        if not stripe_key or stripe_key == "sk_test_placeholder":
            await record_portal_event(
                action="portal_invoice_payment_checkout",
                client_id=client_id,
                client_name=str(invoice.get("client_name") or ""),
                portal_user=user,
                outcome="blocked",
                details="Portal payment checkout was unavailable because card payments are not configured",
                metadata={"invoice_id": invoice_id, "invoice_collection": collection},
                **_request_context(request),
            )
            raise HTTPException(status_code=503, detail="Online card payments are not configured")

        link = await _get_or_create_portal_checkout_link(
            invoice=invoice,
            invoice_id=invoice_id,
            client_id=client_id,
            collection=collection,
            balance=balance,
            currency=currency,
            portal_user=user,
        )
        # Re-load through the shared public-payment gate.  Although this
        # portal-only token is never sent to the browser, the gate is the
        # canonical implementation of link expiry, invoice/client binding and
        # outstanding-balance enforcement for all online payment methods.
        link, invoice, collection, balance = await payment_links._load_public_link(str(link["token"]))
        if invoice.get("client_id") != client_id:
            raise HTTPException(status_code=404, detail="Invoice not found")

        amount_cents = int(round(balance * 100))
        idempotency_material = ":".join(
            (
                "nexus-portal-checkout:v1",
                str(link["id"]),
                collection,
                str(invoice.get("id") or invoice_id),
                client_id,
                str(invoice.get("version", 0)),
                str(amount_cents),
                currency,
            )
        )
        idempotency_key = hashlib.sha256(idempotency_material.encode("utf-8")).hexdigest()
        reservation, reused_attempt = await payment_links._reserve_online_payment_attempt(
            link=link,
            invoice=invoice,
            method="card",
            amount=balance,
            idempotency_key=idempotency_key,
        )
        if reused_attempt and reservation.get("stripe_session_id") and reservation.get("stripe_checkout_url"):
            await payment_links._ensure_payment_transaction(
                link=link,
                invoice=invoice,
                collection=collection,
                payment_record=reservation,
                provider_id_field="stripe_session_id",
                provider_id=str(reservation["stripe_session_id"]),
            )
            await record_portal_event(
                action="portal_invoice_payment_checkout_reused",
                client_id=client_id,
                client_name=str(invoice.get("client_name") or ""),
                portal_user=user,
                details="Portal payment checkout was safely reused",
                metadata={
                    "invoice_id": invoice_id,
                    "invoice_collection": collection,
                    "payment_link_id": link["id"],
                    "amount": balance,
                    "currency": currency,
                },
                **_request_context(request),
            )
            return {
                "status": "checkout",
                "url": reservation["stripe_checkout_url"],
                "session_id": reservation["stripe_session_id"],
                "balance": balance,
                "reused": True,
            }
        if reused_attempt and reservation.get("status") != "initiating":
            # A corrupted/incomplete persisted attempt must not be rewritten
            # into another provider session under a different lifecycle state.
            raise HTTPException(status_code=409, detail="An online payment attempt requires reconciliation")

        public_base = configured_public_base_url()
        quoted_invoice_id = quote(str(invoice.get("id") or invoice_id), safe="")
        checkout_req = CheckoutSessionRequest(
            amount=balance,
            currency=currency,
            success_url=(
                f"{public_base}/portal-dashboard?payment=success&invoice={quoted_invoice_id}"
                "&session_id={CHECKOUT_SESSION_ID}"
            ),
            cancel_url=f"{public_base}/portal-dashboard?payment=cancelled&invoice={quoted_invoice_id}",
            metadata={
                "payment_link_id": link["id"],
                "invoice_id": str(invoice.get("id") or invoice_id),
                "invoice_number": str(invoice.get("invoice_number") or ""),
            }
        )
        try:
            session = await StripeCheckout(api_key=stripe_key).create_checkout_session(
                checkout_req,
                idempotency_key=idempotency_key,
            )
        except Exception:
            await record_portal_event(
                action="portal_invoice_payment_checkout",
                client_id=client_id,
                client_name=str(invoice.get("client_name") or ""),
                portal_user=user,
                outcome="failed",
                details="Portal payment provider did not accept the checkout request",
                metadata={"invoice_id": invoice_id, "invoice_collection": collection, "payment_link_id": link["id"]},
                **_request_context(request),
            )
            raise HTTPException(status_code=502, detail="Unable to start card payment") from None

        payment_record = {
            **reservation,
            "status": "pending",
            "stripe_session_id": session.session_id,
            "stripe_checkout_url": session.url,
            "initiated_at": datetime.now(timezone.utc).isoformat(),
        }
        await payment_links._persist_online_payment_attempt(link=link, payment_record=payment_record)
        await payment_links._ensure_payment_transaction(
            link=link,
            invoice=invoice,
            collection=collection,
            payment_record=payment_record,
            provider_id_field="stripe_session_id",
            provider_id=session.session_id,
        )
        await record_portal_event(
            action="portal_invoice_payment_checkout",
            client_id=client_id,
            client_name=str(invoice.get("client_name") or ""),
            portal_user=user,
            details="Portal payment checkout was created and bound for webhook settlement",
            metadata={
                "invoice_id": invoice_id,
                "invoice_collection": collection,
                "payment_link_id": link["id"],
                "amount": balance,
                "currency": currency,
            },
            **_request_context(request),
        )
        return {"status": "checkout", "url": session.url, "session_id": session.session_id, "balance": balance}
    except HTTPException:
        raise
    except Exception:
        # Database/provider integration errors must not disclose operational
        # details through a customer-facing endpoint.  Preserve a bounded
        # audit trail where possible, then make the caller retry later.
        try:
            await record_portal_event(
                action="portal_invoice_payment_checkout",
                client_id=client_id,
                portal_user=user,
                outcome="failed",
                details="Portal payment checkout could not be safely initialised",
                metadata={"invoice_id": invoice_id},
                **_request_context(request),
            )
        except Exception:
            pass
        raise HTTPException(status_code=503, detail="Unable to initialise online payment") from None


@router.get("/invoices/{invoice_id}/pdf")
async def portal_invoice_pdf(invoice_id: str, user: dict = Depends(get_portal_user)):
    """Return the branded invoice PDF after enforcing portal/client scope."""
    from fastapi.responses import Response
    from app.routers.invoice_pdf import generate_invoice_pdf, _get_branding, _get_active_theme_config

    if not user.get("can_view_invoices", False):
        raise HTTPException(status_code=403, detail="Invoice access not permitted")
    cid = user.get("client_id")
    invoice = await db.invoices.find_one({"id": invoice_id, "client_id": cid}, {"_id": 0})
    if not invoice:
        invoice = await db.xero_invoices.find_one({"id": invoice_id, "client_id": cid}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    branding = await _get_branding()
    theme_config, _ = await _get_active_theme_config()
    pdf_bytes = generate_invoice_pdf(invoice, branding, theme_config)
    filename = f"{invoice.get('invoice_number') or 'invoice'}.pdf"
    return Response(
        content=bytes(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            # Generated documents must never be served from a stale browser cache.
            # This is especially important after a branding or template update.
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
        },
    )


# ==================== MANAGED SERVICES ====================

@router.get("/services")
async def portal_services(user: dict = Depends(get_portal_user)):
    """Client-scoped agreements and live subscription quantities."""
    cid = user.get("client_id")
    config = await db.portal_configs.find_one({"client_id": cid}, {"_id": 0, "features": 1}) or {}
    if (config.get("features") or {}).get("can_view_contracts", True) is False:
        raise HTTPException(status_code=403, detail="Service agreement access not permitted")
    contracts = await db.contracts.find(
        {"client_id": cid},
        {
            "_id": 0, "id": 1, "name": 1, "type": 1, "status": 1, "start_date": 1,
            "end_date": 1, "renewal_date": 1, "sla_tier": 1, "billing_frequency": 1,
            "monthly_value": 1, "mrr": 1, "auto_renew": 1,
        },
    ).sort("status", 1).to_list(100)
    subscriptions = await db.subscriptions.find(
        {"client_id": cid},
        {
            "_id": 0, "id": 1, "product_name": 1, "name": 1, "vendor": 1,
            "provider": 1, "quantity": 1, "used": 1, "status": 1, "billing_cycle": 1,
            "unit_price": 1, "monthly_cost": 1, "renewal_date": 1, "source": 1,
        },
    ).sort("product_name", 1).to_list(250)
    active_contracts = sum(1 for row in contracts if row.get("status") == "active")
    active_subscriptions = sum(1 for row in subscriptions if row.get("status", "active") == "active")
    licensed_seats = sum(
        int(row.get("quantity") or row.get("used") or 0)
        for row in subscriptions
        if row.get("status", "active") == "active"
    )
    return {
        "contracts": contracts,
        "subscriptions": subscriptions,
        "summary": {
            "active_contracts": active_contracts,
            "active_subscriptions": active_subscriptions,
            "licensed_seats": licensed_seats,
        },
    }


# ==================== CLIENT-SAFE DOCUMENTS ====================

@router.get("/documents")
async def portal_documents(user: dict = Depends(get_portal_user)):
    """Only expose documents explicitly marked for the client portal."""
    cid = user.get("client_id")
    docs = await db.client_documents.find(
        {
            "client_id": cid,
            "$or": [
                {"portal_visible": True},
                {"visibility": {"$in": ["public", "client"]}},
                {"is_public": True},
            ],
        },
        {
            "_id": 0, "id": 1, "kind": 1, "title": 1, "category": 1, "url": 1,
            "extension": 1, "size_bytes": 1, "body": 1, "updated_at": 1,
            "created_at": 1, "tags": 1,
        },
    ).sort("updated_at", -1).to_list(250)
    return docs


# ==================== BACKUPS ====================

@router.get("/backups")
async def portal_backups(user: dict = Depends(get_portal_user)):
    cid = user.get("client_id")
    client = await db.clients.find_one({"id": cid}, {"_id": 0, "name": 1})
    cn = client["name"] if client else ""
    jobs = await db.backup_jobs.find({"client_name": cn}, {"_id": 0}).sort("last_run", -1).to_list(100)
    if not jobs:
        jobs = await db.backup_jobs.find({"client_id": cid}, {"_id": 0}).sort("last_run", -1).to_list(100)
    ok = sum(1 for j in jobs if j.get("status") == "success")
    fail = sum(1 for j in jobs if j.get("status") == "failed")
    return {"jobs": jobs, "summary": {"total": len(jobs), "successful": ok, "failed": fail, "success_rate": round(ok / max(len(jobs), 1) * 100, 1)}}


# ==================== COMPLIANCE ====================

@router.get("/compliance")
async def portal_compliance(user: dict = Depends(get_portal_user)):
    cid = user.get("client_id")
    scans = await db.compliance_reports.find(
        {"client_id": cid},
        {
            "_id": 0, "id": 1, "framework": 1, "framework_name": 1, "score": 1,
            "passed": 1, "total": 1, "scanned_at": 1, "controls": 1,
        },
    ).sort("scanned_at", -1).to_list(100)
    latest_by_framework = {}
    for scan in scans:
        key = scan.get("framework") or scan.get("framework_name") or scan.get("id")
        if key not in latest_by_framework:
            latest_by_framework[key] = scan
    frameworks = [
        {
            **scan,
            "name": scan.get("framework_name") or str(scan.get("framework") or "Compliance").upper(),
            "compliance_pct": scan.get("score", 0),
            "controls_total": scan.get("total", 0),
            "controls_met": scan.get("passed", 0),
        }
        for scan in latest_by_framework.values()
    ]
    return {"frameworks": frameworks, "has_assessment": bool(frameworks)}


# ==================== QBR ====================

@router.get("/qbr")
async def portal_qbr(user: dict = Depends(get_portal_user)):
    cid = user.get("client_id")
    client = await db.clients.find_one({"id": cid}, {"_id": 0, "name": 1})
    cn = client["name"] if client else ""
    qbrs = await db.qbr_reports.find({"client_name": cn}, {"_id": 0}).sort("generated_at", -1).to_list(10)
    if not qbrs:
        qbrs = await db.qbr_reports.find({"client_id": cid}, {"_id": 0}).sort("generated_at", -1).to_list(10)
    return qbrs



# ==================== KNOWLEDGE BASE ====================

@router.get("/kb")
async def portal_knowledge_base(user: dict = Depends(get_portal_user)):
    """Get published knowledge base articles for clients."""
    config = await db.portal_configs.find_one(
        {"client_id": user.get("client_id")}, {"_id": 0, "features": 1}
    ) or {}
    if (config.get("features") or {}).get("can_view_kb", True) is False:
        return []
    articles = await db.kb_articles.find(
        {"status": "published", "visibility": {"$in": ["public", "client"]}},
        {"_id": 0}
    ).sort("updated_at", -1).to_list(100)
    if not articles:
        # Return built-in articles for demo
        articles = [
            {"id": "kb-001", "title": "How to Submit a Support Ticket", "category": "Getting Started",
             "content": "You can submit tickets via the Client Portal by clicking 'New Ticket'. Include a detailed description of your issue for fastest resolution.",
             "tags": ["tickets", "support"], "created_at": datetime.now(timezone.utc).isoformat()},
            {"id": "kb-002", "title": "Setting Up Multi-Factor Authentication", "category": "Security",
             "content": "MFA adds an extra layer of security. Go to your profile settings and enable 2FA using an authenticator app like Google Authenticator or Authy.",
             "tags": ["security", "2fa"], "created_at": datetime.now(timezone.utc).isoformat()},
            {"id": "kb-003", "title": "Understanding Your Invoice", "category": "Billing",
             "content": "Your monthly invoice includes all managed services, project work, and any hardware purchases. Contact us if you have questions about specific line items.",
             "tags": ["billing", "invoices"], "created_at": datetime.now(timezone.utc).isoformat()},
            {"id": "kb-004", "title": "Password Reset Procedure", "category": "Getting Started",
             "content": "If you need to reset your password, click 'Forgot Password' on the login screen or contact our help desk for immediate assistance.",
             "tags": ["password", "account"], "created_at": datetime.now(timezone.utc).isoformat()},
            {"id": "kb-005", "title": "Remote Support Sessions", "category": "Support",
             "content": "When a technician needs to access your computer, you'll receive a link or code. Always verify the technician's identity before granting access.",
             "tags": ["remote", "support"], "created_at": datetime.now(timezone.utc).isoformat()},
        ]
    return articles

