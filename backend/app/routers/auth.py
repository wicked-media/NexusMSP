from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import base64
import hashlib
import hmac
import struct
import time
import uuid
from app.database import db, AVATARS_DIR
from app.auth import cache_busted_avatar_url, get_current_user, hash_password, verify_password, create_token, password_policy_error
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.models import *

router = APIRouter()


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

# ============== AUTH ENDPOINTS ==============

@router.post("/auth/register")
async def register(user_data: UserCreate):
    existing = await db.users.find_one({"email": user_data.email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    policy_error = password_policy_error(user_data.password, user_data.email)
    if policy_error:
        raise HTTPException(status_code=400, detail=policy_error)
    
    user = User(
        email=user_data.email,
        name=user_data.name,
        # Public registration is always least-privilege. Elevated roles are
        # assigned through the authenticated technician-management workflow.
        role="technician",
        avatar=f"https://api.dicebear.com/7.x/initials/svg?seed={user_data.name}"
    )
    doc = user.model_dump()
    doc['password_hash'] = hash_password(user_data.password)
    doc['created_at'] = doc['created_at'].isoformat()
    await db.users.insert_one(doc)
    
    token = create_token(user.id, user.email, user.role)
    return {"token": token, "user": user.model_dump()}

@router.post("/auth/login")
async def login(credentials: UserLogin):
    user_doc = await db.users.find_one({"email": credentials.email}, {"_id": 0})
    if not user_doc or not verify_password(credentials.password, user_doc.get('password_hash', '')):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    two_factor = await db.user_2fa.find_one(
        {"user_id": user_doc["id"], "verified": True},
        {"_id": 0, "secret": 1}
    )
    if two_factor:
        if not credentials.two_factor_code:
            return {"requires_2fa": True, "email": user_doc["email"]}
        if not _valid_totp(two_factor.get("secret", ""), credentials.two_factor_code.strip()):
            raise HTTPException(status_code=401, detail="Invalid authenticator code")
    
    token = create_token(user_doc['id'], user_doc['email'], user_doc['role'])
    user_doc.pop('password_hash', None)
    user_doc['avatar'] = cache_busted_avatar_url(user_doc.get('avatar'))
    return {"token": token, "user": user_doc, "requires_2fa": False}

@router.get("/auth/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    return current_user


# ============== USER UPDATE ENDPOINT ==============

@router.put("/users/{user_id}")
async def update_user(user_id: str, user_data: dict, current_user: dict = Depends(get_current_user)):
    allowed_fields = {"name", "email_signature", "hourly_rate", "avatar"}
    update = {k: v for k, v in user_data.items() if k in allowed_fields}
    if not update:
        raise HTTPException(status_code=400, detail="No valid fields to update")
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.users.update_one({"id": user_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": "User updated"}
