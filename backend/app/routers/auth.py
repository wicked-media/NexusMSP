from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Request
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import base64
import hashlib
import hmac
import struct
import time
import uuid
from app.database import db, AVATARS_DIR
from app.auth import (
    cache_busted_avatar_url,
    create_token,
    get_current_user,
    hash_password,
    password_policy_error,
    revoke_all_user_sessions,
    session_version_for_user,
    user_is_active,
    verify_password,
)
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.services.request_throttling import (
    LoginRateLimitExceeded,
    clear_login_attempts,
    consume_login_attempt,
)
from app.models import *

router = APIRouter()


async def _log_auth_event(
    request: Request,
    action: str,
    email: str,
    *,
    user: Optional[dict] = None,
    details: str,
) -> None:
    """Record authentication evidence without ever disrupting sign-in."""
    actor = user or {"id": "anonymous", "name": "Unauthenticated user"}
    metadata = {
        "ip_address": request.client.host if request.client else None,
        "user_agent": request.headers.get("user-agent", "")[:256],
    }
    try:
        await log_activity(
            actor,
            action,
            "authentication",
            email.lower(),
            email.lower(),
            details,
            metadata=metadata,
        )
    except Exception:
        # Audit storage availability must not create an authentication outage.
        pass


def _totp_code(secret_b32: str, counter: int) -> str:
    """Return an RFC 6238-compatible six digit TOTP code."""
    padding = "=" * ((8 - len(secret_b32) % 8) % 8)
    key = base64.b32decode(secret_b32 + padding)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = (struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF) % 1_000_000
    return str(value).zfill(6)


def _valid_totp(secret_b32: str, code: str) -> bool:
    if not code or not secret_b32:
        return False
    now = int(time.time() // 30)
    return any(hmac.compare_digest(code, _totp_code(secret_b32, now + shift)) for shift in (-1, 0, 1))


async def _technician_onboarding_flags(user: dict) -> dict:
    """Return fail-closed onboarding gate flags without exposing audit history.

    The dedicated technician-onboarding endpoint contains the detailed guide
    and evidence.  Authentication responses only need the two gate flags, and
    login must remain available even if a non-critical training-state write is
    temporarily unavailable.
    """
    try:
        from app.services.technician_onboarding import get_or_create_technician_onboarding

        onboarding = await get_or_create_technician_onboarding(db, user)
        return {
            "onboarding_required": bool(onboarding.get("must_complete_before_operational_work", True)),
            "is_onboarding_compliant": bool(onboarding.get("is_compliant", False)),
        }
    except Exception:
        # Never silently open the first-use gate if Nexus cannot establish a
        # technician's evidence state. The authenticated user can retry the
        # dedicated onboarding endpoint after the transient dependency recovers.
        return {"onboarding_required": True, "is_onboarding_compliant": False}

# ============== AUTH ENDPOINTS ==============

@router.post("/auth/register")
async def register(user_data: UserCreate):
    # Self-service registration is only valid for the very first bootstrap
    # account. Once NexusMSP has users, new technicians must be invited and
    # assigned through the authenticated Team workspace.
    if await db.users.count_documents({}) > 0:
        raise HTTPException(
            status_code=403,
            detail="Public registration is disabled. Ask a NexusMSP administrator to invite you.",
        )
    existing = await db.users.find_one({"email": user_data.email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    policy_error = password_policy_error(user_data.password, user_data.email)
    if policy_error:
        raise HTTPException(status_code=400, detail=policy_error)
    
    user = User(
        email=user_data.email,
        name=user_data.name,
        # The only public registration allowed is the empty-database bootstrap
        # account, which becomes the administrator for subsequent invitations.
        role="admin",
        avatar=f"https://api.dicebear.com/7.x/initials/svg?seed={user_data.name}"
    )
    doc = user.model_dump()
    doc['password_hash'] = hash_password(user_data.password)
    doc['created_at'] = doc['created_at'].isoformat()
    await db.users.insert_one(doc)
    
    token = create_token(
        user.id,
        user.email,
        user.role,
        session_version=session_version_for_user(doc),
    )
    return {"token": token, "user": user.model_dump()}

@router.post("/auth/login")
async def login(credentials: UserLogin, request: Request):
    try:
        await consume_login_attempt(request, credentials.email)
    except LoginRateLimitExceeded as exc:
        await _log_auth_event(
            request,
            "auth.login_throttled",
            credentials.email,
            details="Sign-in was temporarily blocked by the authentication abuse guard.",
        )
        raise HTTPException(
            status_code=429,
            detail="Too many sign-in attempts. Try again later.",
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc

    user_doc = await db.users.find_one({"email": credentials.email}, {"_id": 0})
    if not user_doc or not verify_password(credentials.password, user_doc.get('password_hash', '')):
        await _log_auth_event(
            request,
            "auth.login_failed",
            credentials.email,
            details="Sign-in rejected because the supplied credentials were invalid.",
        )
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user_is_active(user_doc):
        await _log_auth_event(
            request,
            "auth.login_blocked",
            user_doc["email"],
            user=user_doc,
            details="Sign-in was blocked because the technician account is inactive.",
        )
        raise HTTPException(status_code=401, detail="Account is inactive")

    two_factor = await db.user_2fa.find_one(
        {"user_id": user_doc["id"], "verified": True},
        {"_id": 0, "secret": 1}
    )
    if two_factor:
        if not credentials.two_factor_code:
            await _log_auth_event(
                request,
                "auth.mfa_challenge",
                user_doc["email"],
                user=user_doc,
                details="Primary credentials accepted; authenticator verification is required.",
            )
            return {"requires_2fa": True, "email": user_doc["email"]}
        if not _valid_totp(two_factor.get("secret", ""), credentials.two_factor_code.strip()):
            await _log_auth_event(
                request,
                "auth.mfa_failed",
                user_doc["email"],
                user=user_doc,
                details="Sign-in rejected because authenticator verification failed.",
            )
            raise HTTPException(status_code=401, detail="Invalid authenticator code")
    
    token = create_token(
        user_doc['id'],
        user_doc['email'],
        user_doc['role'],
        session_version=session_version_for_user(user_doc),
    )
    await clear_login_attempts(request, user_doc["email"])
    onboarding_flags = await _technician_onboarding_flags(user_doc)
    user_doc.pop('password_hash', None)
    # The account-owned evidence log is intentionally not returned from the
    # authentication endpoint; it is available through the scoped onboarding
    # API when the user opens the checklist.
    user_doc.pop("technician_onboarding", None)
    user_doc['avatar'] = cache_busted_avatar_url(user_doc.get('avatar'))
    await _log_auth_event(
        request,
        "auth.login_success",
        user_doc["email"],
        user=user_doc,
        details="User authenticated successfully.",
    )
    return {"token": token, "user": {**user_doc, **onboarding_flags}, "requires_2fa": False}

@router.get("/auth/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    onboarding_flags = await _technician_onboarding_flags(current_user)
    safe_user = dict(current_user)
    safe_user.pop("technician_onboarding", None)
    return {**safe_user, **onboarding_flags}


@router.post("/auth/sessions/revoke-all")
async def revoke_all_sessions(request: Request, current_user: dict = Depends(get_current_user)):
    """Immediately invalidate the caller's active Nexus sessions everywhere.

    This endpoint intentionally requires a valid current session before the
    generation is advanced. The triggering request can complete normally, but
    every token issued before it is rejected by the canonical auth dependency
    on its next use.
    """
    session_version = await revoke_all_user_sessions(current_user.get("id"))
    await _log_auth_event(
        request,
        "auth.sessions_revoked",
        str(current_user.get("email") or ""),
        user=current_user,
        details="The technician revoked all active Nexus sessions.",
    )
    return {
        "message": "All active Nexus sessions have been revoked. Sign in again to continue.",
        "session_version": session_version,
    }


# ============== USER UPDATE ENDPOINT ==============


def _can_manage_user_profile(actor: dict, target_user_id: str) -> bool:
    """Allow self-service profile changes or an explicitly administrative edit."""
    if str(actor.get("id") or "") == str(target_user_id):
        return True
    return actor.get("is_admin") in (True, 1) or str(actor.get("role") or "").lower() == "admin"


@router.put("/users/{user_id}")
async def update_user(user_id: str, user_data: dict, current_user: dict = Depends(get_current_user)):
    if not _can_manage_user_profile(current_user, user_id):
        raise HTTPException(status_code=403, detail="You can only update your own profile")
    managing_another_user = str(current_user.get("id") or "") != str(user_id)
    allowed_fields = {"name", "email_signature", "avatar"}
    if managing_another_user:
        # Labour rates are staff-management data, not a self-service field.
        allowed_fields.add("hourly_rate")
    update = {k: v for k, v in user_data.items() if k in allowed_fields}
    if not update:
        raise HTTPException(status_code=400, detail="No valid fields to update")
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.users.update_one({"id": user_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    await log_activity(
        current_user,
        "updated",
        "user_profile",
        user_id,
        user_id,
        "Updated own profile" if not managing_another_user else "Updated technician profile",
        metadata={"changed_fields": sorted(update.keys()), "self_service": not managing_another_user},
    )
    return {"message": "User updated"}
