from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import RedirectResponse
from datetime import datetime, timezone
import uuid
import secrets
import hashlib
import base64
import httpx
from urllib.parse import urlencode
from app.database import db
from app.auth import get_current_user, create_token

router = APIRouter()

# In-memory state store for CSRF protection (keyed by state string)
_oauth_states = {}


def _generate_pkce():
    """Generate PKCE code_verifier and code_challenge."""
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(64)).decode().rstrip("=")
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()
    ).decode().rstrip("=")
    return verifier, challenge


async def _get_sso_config():
    """Fetch Microsoft SSO settings from DB."""
    config = await db.settings.find_one({"type": "microsoft_sso"}, {"_id": 0})
    return config


# ============== SSO SETTINGS (Admin) ==============

@router.get("/settings/microsoft-sso")
async def get_sso_settings(current_user: dict = Depends(get_current_user)):
    config = await _get_sso_config()
    if config and config.get("client_secret"):
        config["client_secret"] = "********"
    return config or {
        "type": "microsoft_sso",
        "enabled": False,
        "tenant_id": "",
        "client_id": "",
        "client_secret": "",
        "redirect_uri": "",
        "auto_create_users": True,
        "default_role": "tech",
    }


@router.put("/settings/microsoft-sso")
async def update_sso_settings(data: dict, current_user: dict = Depends(get_current_user)):
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    # Preserve existing secret if masked
    if data.get("client_secret") == "********":
        existing = await _get_sso_config()
        if existing:
            data["client_secret"] = existing.get("client_secret", "")
    data["type"] = "microsoft_sso"
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.settings.update_one({"type": "microsoft_sso"}, {"$set": data}, upsert=True)
    return {"message": "Microsoft SSO settings updated"}


@router.get("/settings/microsoft-sso/status")
async def get_sso_status():
    """Public endpoint to check if Microsoft SSO is enabled (no auth required for login page)."""
    config = await _get_sso_config()
    if config and config.get("enabled") and config.get("client_id") and config.get("tenant_id"):
        return {"enabled": True}
    return {"enabled": False}


# ============== SSO LOGIN FLOW ==============

@router.get("/auth/microsoft/login")
async def microsoft_login(request: Request):
    """Initiate Microsoft OAuth2 login. Redirects browser to Microsoft authorization page."""
    config = await _get_sso_config()
    if not config or not config.get("enabled"):
        raise HTTPException(status_code=400, detail="Microsoft SSO is not configured")

    tenant_id = config["tenant_id"]
    client_id = config["client_id"]

    # Determine redirect URI
    redirect_uri = config.get("redirect_uri", "")
    if not redirect_uri:
        # Auto-detect from request
        base = str(request.base_url).rstrip("/")
        redirect_uri = f"{base}/api/auth/microsoft/callback"

    verifier, challenge = _generate_pkce()
    state = secrets.token_urlsafe(32)

    # Store state → verifier mapping (expires after 10 min)
    _oauth_states[state] = {
        "code_verifier": verifier,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    # Clean old states (older than 10 min)
    _cleanup_states()

    params = {
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "scope": "openid profile email User.Read",
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "response_mode": "query",
        "prompt": "select_account",
    }

    auth_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/authorize?{urlencode(params)}"
    return RedirectResponse(url=auth_url, status_code=302)


@router.get("/auth/microsoft/callback")
async def microsoft_callback(request: Request, code: str = "", state: str = "", error: str = ""):
    """Handle callback from Microsoft after user authenticates."""
    import os
    # Resolve frontend URL - check env vars in order of priority
    frontend_url = os.environ.get("FRONTEND_URL", "")
    if not frontend_url:
        react_url = os.environ.get("REACT_APP_BACKEND_URL", "")
        if react_url:
            frontend_url = react_url
        else:
            frontend_url = str(request.base_url).rstrip("/")

    if error:
        return RedirectResponse(url=f"{frontend_url}/login?sso_error={error}", status_code=302)

    if not code or not state:
        return RedirectResponse(url=f"{frontend_url}/login?sso_error=missing_params", status_code=302)

    # Validate state
    state_data = _oauth_states.pop(state, None)
    if not state_data:
        return RedirectResponse(url=f"{frontend_url}/login?sso_error=invalid_state", status_code=302)

    code_verifier = state_data["code_verifier"]
    config = await _get_sso_config()
    if not config:
        return RedirectResponse(url=f"{frontend_url}/login?sso_error=not_configured", status_code=302)

    tenant_id = config["tenant_id"]
    client_id = config["client_id"]
    client_secret = config.get("client_secret", "")

    redirect_uri = config.get("redirect_uri", "")
    if not redirect_uri:
        base = str(request.base_url).rstrip("/")
        redirect_uri = f"{base}/api/auth/microsoft/callback"

    # Exchange code for tokens
    try:
        token_data = {
            "client_id": client_id,
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "code_verifier": code_verifier,
        }
        if client_secret:
            token_data["client_secret"] = client_secret

        async with httpx.AsyncClient(timeout=30.0) as client_http:
            token_resp = await client_http.post(
                f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token",
                data=token_data,
            )

        if token_resp.status_code != 200:
            return RedirectResponse(
                url=f"{frontend_url}/login?sso_error=token_exchange_failed",
                status_code=302,
            )

        tokens = token_resp.json()
        access_token = tokens.get("access_token")
        if not access_token:
            return RedirectResponse(
                url=f"{frontend_url}/login?sso_error=no_access_token",
                status_code=302,
            )

        # Fetch user profile from Microsoft Graph
        async with httpx.AsyncClient(timeout=30.0) as client_http:
            profile_resp = await client_http.get(
                "https://graph.microsoft.com/v1.0/me",
                headers={"Authorization": f"Bearer {access_token}"},
            )

        if profile_resp.status_code != 200:
            return RedirectResponse(
                url=f"{frontend_url}/login?sso_error=profile_fetch_failed",
                status_code=302,
            )

        profile = profile_resp.json()
        ms_email = (profile.get("mail") or profile.get("userPrincipalName") or "").lower()
        ms_name = profile.get("displayName") or ms_email.split("@")[0]
        ms_id = profile.get("id", "")

        if not ms_email:
            return RedirectResponse(
                url=f"{frontend_url}/login?sso_error=no_email_in_profile",
                status_code=302,
            )

        # Find or create user in our DB
        user_doc = await db.users.find_one({"email": ms_email}, {"_id": 0})

        if not user_doc:
            if not config.get("auto_create_users", True):
                return RedirectResponse(
                    url=f"{frontend_url}/login?sso_error=user_not_found",
                    status_code=302,
                )
            # Create new user
            new_user = {
                "id": str(uuid.uuid4()),
                "email": ms_email,
                "name": ms_name,
                "role": config.get("default_role", "tech"),
                "avatar": f"https://api.dicebear.com/7.x/initials/svg?seed={ms_name}",
                "password_hash": "",
                "microsoft_id": ms_id,
                "sso_provider": "microsoft",
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            await db.users.insert_one(new_user)
            user_doc = await db.users.find_one({"email": ms_email}, {"_id": 0})

        else:
            # Update Microsoft ID if not set
            if not user_doc.get("microsoft_id"):
                await db.users.update_one(
                    {"id": user_doc["id"]},
                    {"$set": {"microsoft_id": ms_id, "sso_provider": "microsoft"}},
                )

        # Generate our JWT token
        jwt_token = create_token(user_doc["id"], user_doc["email"], user_doc.get("role", "tech"))

        # Redirect to frontend with token
        return RedirectResponse(
            url=f"{frontend_url}/auth/callback?token={jwt_token}&provider=microsoft",
            status_code=302,
        )

    except Exception as e:
        return RedirectResponse(
            url=f"{frontend_url}/login?sso_error=server_error",
            status_code=302,
        )


def _cleanup_states():
    """Remove OAuth states older than 10 minutes."""
    now = datetime.now(timezone.utc)
    expired = []
    for s, data in _oauth_states.items():
        created = datetime.fromisoformat(data["created_at"])
        if (now - created).total_seconds() > 600:
            expired.append(s)
    for s in expired:
        del _oauth_states[s]
