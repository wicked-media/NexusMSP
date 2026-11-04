"""One-click Microsoft 365 sign-in for leads and ticket email.

An admin clicks connect, signs in with Microsoft and grants admin consent for
the mail scopes Nexus needs.  Nexus then stores the delegated grant encrypted
and uses it for ticket replies, lead responses and inbox intake — no manual
Azure application registration, client secret or Graph permission assignment
is required at the installation.
"""

from __future__ import annotations

import base64
import hashlib
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse

from app.auth import get_current_user
from app.database import db
from app.services.microsoft_graph_connection import (
    CONNECTION_SETTINGS_TYPE,
    GRAPH_MAIL_SCOPES,
    authorization_endpoint,
    decode_id_token_claims,
    load_connect_app_config,
    load_connection,
    persist_tokens,
    resolve_redirect_uri,
    safe_connection_view,
    token_endpoint,
)

router = APIRouter()

# Short-lived OAuth state, kept separate from the persisted connection so an
# authorization response can never be attached to a different Nexus admin.
_connect_states: dict[str, dict] = {}

_STATE_TTL = timedelta(minutes=10)


def _generate_pkce() -> tuple[str, str]:
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(64)).decode().rstrip("=")
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    return verifier, challenge


def _cleanup_states() -> None:
    cutoff = datetime.now(timezone.utc) - _STATE_TTL
    for state, payload in list(_connect_states.items()):
        created = payload.get("created_at")
        if not isinstance(created, datetime) or created < cutoff:
            _connect_states.pop(state, None)


async def _require_connect_admin(current_user: dict) -> dict:
    """Only platform administrators may bind the organisation mail identity."""
    caller_id = current_user.get("id") if isinstance(current_user, dict) else None
    caller = await db.users.find_one({"id": caller_id}, {"_id": 0, "role": 1, "is_admin": 1, "name": 1}) if caller_id else None
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    return caller


def _frontend_url(request: Request) -> str:
    frontend = os.environ.get("FRONTEND_URL", "")
    if not frontend:
        frontend = os.environ.get("REACT_APP_BACKEND_URL", "")
    if not frontend:
        frontend = str(request.base_url).rstrip("/")
    return frontend.rstrip("/")


async def _audit(actor: dict, action: str, details: str) -> None:
    await db.activity_logs.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": actor.get("id", ""),
        "user_name": actor.get("name", ""),
        "action": action,
        "entity_type": "settings",
        "entity_id": CONNECTION_SETTINGS_TYPE,
        "entity_name": "Microsoft 365 mail connection",
        "details": details,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })


# ============== ONE-CLICK CONNECT FLOW ==============

@router.get("/settings/microsoft-connect/start")
async def start_microsoft_connect(request: Request, current_user: dict = Depends(get_current_user)):
    """Build the Microsoft authorization URL for the one-click mail grant."""
    caller = await _require_connect_admin(current_user)
    app_config = await load_connect_app_config()
    if not app_config.get("client_id"):
        raise HTTPException(
            status_code=409,
            detail=(
                "No Microsoft sign-in application is configured for this Nexus server. "
                "Set the deployment's multi-tenant Entra application once "
                "(MICROSOFT_OAUTH_CLIENT_ID) or save an application under Settings > Sign-in & Access."
            ),
        )

    tenant = str(app_config.get("tenant_hint") or "").strip() or "organizations"
    verifier, challenge = _generate_pkce()
    state = secrets.token_urlsafe(32)
    _cleanup_states()
    _connect_states[state] = {
        "user_id": caller.get("id", ""),
        "user_name": caller.get("name", ""),
        "code_verifier": verifier,
        "tenant": tenant,
        "created_at": datetime.now(timezone.utc),
    }

    redirect_uri = resolve_redirect_uri(str(request.base_url).rstrip("/"))
    params = {
        "client_id": app_config["client_id"],
        "response_type": "code",
        "response_mode": "query",
        "redirect_uri": redirect_uri,
        "scope": " ".join(GRAPH_MAIL_SCOPES),
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        # Admin consent grants the mail scopes organisation-wide once, so every
        # technician's ticket replies and lead emails work without further prompts.
        "prompt": "admin_consent",
    }
    return {
        "authorization_url": f"{authorization_endpoint(tenant)}?{urlencode(params)}",
        "redirect_uri": redirect_uri,
        "permissions": ["User.Read", "Mail.Send", "Mail.Read"],
        "connected_account_note": "Email is sent and read as the Microsoft account that signs in.",
    }


@router.get("/settings/microsoft-connect/callback")
async def complete_microsoft_connect(request: Request, code: str = "", state: str = "", error: str = ""):
    """Exchange the Microsoft response and persist the encrypted mail grant."""
    frontend = _frontend_url(request)

    def _redirect(reason: str) -> RedirectResponse:
        return RedirectResponse(f"{frontend}/settings?tab=mailbox&microsoft_connect_error={reason}", status_code=302)

    if error or not code or not state:
        return _redirect(error or "missing_authorization_response")

    state_data = _connect_states.pop(state, None)
    _cleanup_states()
    if not state_data:
        return _redirect("invalid_or_expired_state")

    try:
        app_config = await load_connect_app_config()
        if not app_config.get("client_id"):
            return _redirect("application_not_configured")
        tenant = str(state_data.get("tenant") or app_config.get("tenant_hint") or "organizations").strip() or "organizations"
        redirect_uri = resolve_redirect_uri(str(request.base_url).rstrip("/"))

        token_payload = {
            "client_id": app_config["client_id"],
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "code_verifier": state_data["code_verifier"],
        }
        if app_config.get("client_secret"):
            token_payload["client_secret"] = app_config["client_secret"]

        async with httpx.AsyncClient(timeout=30) as client:
            token_response = await client.post(token_endpoint(tenant), data=token_payload)
            if token_response.status_code != 200:
                return _redirect("token_exchange_failed")
            tokens = token_response.json()
            if not tokens.get("access_token"):
                return _redirect("no_access_token")
            profile_response = await client.get(
                "https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName",
                headers={"Authorization": f"Bearer {tokens['access_token']}"},
            )
        if profile_response.status_code != 200:
            return _redirect("profile_fetch_failed")
        profile = profile_response.json()
        account = str(profile.get("mail") or profile.get("userPrincipalName") or "").strip()
        if not account:
            return _redirect("no_email_in_profile")

        claims = decode_id_token_claims(tokens.get("id_token"))
        tenant_id = str(claims.get("tid") or app_config.get("tenant_hint") or "").strip()

        now = datetime.now(timezone.utc)
        connection = {
            "type": CONNECTION_SETTINGS_TYPE,
            "status": "connected",
            "tenant_id": tenant_id,
            "client_id": app_config["client_id"],
            "connected_account": account,
            "connected_account_name": profile.get("displayName") or account,
            "microsoft_user_id": profile.get("id", ""),
            "scopes": str(tokens.get("scope") or " ".join(GRAPH_MAIL_SCOPES)).split(),
            "connected_by": state_data.get("user_id", ""),
            "connected_by_name": state_data.get("user_name", ""),
            "connected_at": now.isoformat(),
        }
        await persist_tokens(connection, tokens)
        actor = {"id": state_data.get("user_id", ""), "name": state_data.get("user_name", "")}
        await _audit(actor, "microsoft_mail_connected", f"Microsoft 365 mail connected as {account}.")
        return RedirectResponse(f"{frontend}/settings?tab=mailbox&microsoft_connected=1", status_code=302)
    except Exception:
        return _redirect("connection_failed")


@router.get("/settings/microsoft-connect/connection")
async def get_microsoft_connect_connection(current_user: dict = Depends(get_current_user)):
    """Safe connection status: never returns token or secret material."""
    await _require_connect_admin(current_user)
    connection = await load_connection()
    app_config = await load_connect_app_config()
    return safe_connection_view(connection, app_configured=bool(app_config.get("client_id")))


@router.delete("/settings/microsoft-connect/connection")
async def delete_microsoft_connect_connection(current_user: dict = Depends(get_current_user)):
    """Disconnect the one-click grant and drop the stored tokens."""
    caller = await _require_connect_admin(current_user)
    await db.settings.update_one(
        {"type": CONNECTION_SETTINGS_TYPE},
        {
            "$set": {
                "status": "disconnected",
                "disconnected_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
            "$unset": {
                "access_token_encrypted": "",
                "refresh_token_encrypted": "",
                "token_expires_at": "",
                "last_error_code": "",
            },
        },
        upsert=True,
    )
    await _audit(caller, "microsoft_mail_disconnected", "Microsoft 365 mail connection disconnected; stored tokens removed.")
    return {"message": "Microsoft 365 mail connection disconnected", "connected": False}
