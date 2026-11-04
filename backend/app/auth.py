from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from datetime import datetime, timezone, timedelta
import jwt
import bcrypt
import re
import uuid
from app.database import db, security, JWT_SECRET, JWT_ALGORITHM, JWT_EXPIRATION_HOURS, AVATARS_DIR


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))


def password_policy_error(password: str, email: str = "") -> str | None:
    """Return a user-safe password policy error, or None when the password is acceptable."""
    if len(password) < 12:
        return "Use at least 12 characters"
    categories = sum((
        bool(re.search(r"[a-z]", password)),
        bool(re.search(r"[A-Z]", password)),
        bool(re.search(r"\d", password)),
        bool(re.search(r"[^A-Za-z0-9]", password)),
    ))
    if categories < 3:
        return "Use at least three of: lowercase, uppercase, number, and symbol"
    local_part = email.split("@", 1)[0].strip().lower()
    if local_part and len(local_part) >= 3 and local_part in password.lower():
        return "Do not include your email name in the password"
    return None


def user_is_active(user: dict | None) -> bool:
    """Treat an explicit account disablement as an immediate token revocation.

    Older user records do not always carry an activity field, so an omitted
    value remains compatible.  Only an explicit false/disabled state blocks a
    session; this avoids silently breaking legacy active technicians.
    """
    if not user:
        return False
    if user.get("is_active") is False or user.get("active") is False:
        return False
    return str(user.get("status") or "active").strip().lower() not in {
        "disabled", "inactive", "suspended", "locked", "revoked",
    }


def _session_version(value: object) -> int:
    """Return a safe non-negative account session generation.

    Legacy Nexus users predate session revocation, so an omitted value is
    deliberately treated as generation zero.  That lets us introduce a
    server-side revocation boundary without invalidating every existing
    technician token at deployment time.
    """
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def session_version_for_user(user: dict | None) -> int:
    """Return the authoritative session generation stored on an account."""
    return _session_version((user or {}).get("session_version"))


def create_token(
    user_id: str,
    email: str,
    role: str,
    *,
    session_version: int = 0,
) -> str:
    """Create a short-lived token bound to the account's session generation.

    The random ID gives each issued token an auditable identity.  The session
    generation is checked against the user document on every authenticated
    request, so incrementing it invalidates all previously issued sessions
    immediately without relying on browser-side storage being cleared.
    """
    issued_at = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "sv": _session_version(session_version),
        "jti": str(uuid.uuid4()),
        "iat": issued_at,
        "exp": issued_at + timedelta(hours=JWT_EXPIRATION_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def cache_busted_avatar_url(avatar_url: str | None) -> str | None:
    """Return a fresh public URL for locally-hosted technician avatars.

    Avatar files deliberately retain a stable filename per technician. Adding a
    file-version query parameter prevents browsers from reusing a cached image
    after a technician replaces their profile photo.
    """
    prefix = "/api/uploads/avatars/"
    if not avatar_url or not avatar_url.startswith(prefix) or "?" in avatar_url:
        return avatar_url

    filename = avatar_url[len(prefix):]
    if not filename or "/" in filename or "\\" in filename:
        return avatar_url

    avatar_file = AVATARS_DIR / filename
    if not avatar_file.is_file():
        return avatar_url
    return f"{avatar_url}?v={avatar_file.stat().st_mtime_ns}"


async def get_active_user_from_token(token: str) -> dict:
    """Resolve a signed Nexus token through the canonical active-account check.

    Browser PDF previews temporarily use a query-string transport because a
    native browser PDF navigation cannot attach the normal Bearer header.  Do
    not give that transport a weaker account-validation path than the regular
    API dependency: both must reject disabled, locked, suspended, expired and
    malformed sessions in exactly the same way.
    """
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        subject = payload.get("sub") if isinstance(payload, dict) else None
        if not subject:
            raise HTTPException(status_code=401, detail="Invalid token")
        user = await get_active_user_by_id(subject)
        # A password reset, account recovery or explicit "sign out everywhere"
        # increments the server-side generation.  Signed tokens from a prior
        # generation therefore lose access immediately, including browser PDF
        # previews that use the same canonical token validator.
        if _session_version(payload.get("sv")) != session_version_for_user(user):
            raise HTTPException(status_code=401, detail="Session has been revoked")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


async def get_active_user_by_id(user_id: str) -> dict:
    """Load an active Nexus account without accepting a browser credential.

    Short-lived, object-bound browser capabilities use this after looking up
    their server-side record.  Keeping it shared with token authentication
    means a disabled, suspended or deleted account immediately loses both
    regular API access and any outstanding browser capability.
    """
    subject = str(user_id or "").strip()
    if not subject:
        raise HTTPException(status_code=401, detail="Invalid user")
    user = await db.users.find_one({"id": subject}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if not user_is_active(user):
        raise HTTPException(status_code=401, detail="User account is inactive")
    user["avatar"] = cache_busted_avatar_url(user.get("avatar"))
    return user


async def revoke_all_user_sessions(user_id: str) -> int:
    """Invalidate every issued Nexus session for one active account.

    This is intentionally generation-based rather than a browser-only
    logout.  It is safe to call repeatedly, is immediately effective for
    every API route using ``get_current_user``, and remains compatible with
    legacy records that have no session field yet.
    """
    subject = str(user_id or "").strip()
    if not subject:
        raise HTTPException(status_code=401, detail="Invalid user")
    result = await db.users.update_one(
        {"id": subject},
        {
            "$inc": {"session_version": 1},
            "$set": {"sessions_revoked_at": datetime.now(timezone.utc).isoformat()},
        },
    )
    if not result.matched_count:
        raise HTTPException(status_code=401, detail="User not found")
    user = await db.users.find_one(
        {"id": subject},
        {"_id": 0, "session_version": 1},
    )
    return session_version_for_user(user)


async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Resolve the Bearer credential through the canonical active-user path."""
    return await get_active_user_from_token(credentials.credentials)
