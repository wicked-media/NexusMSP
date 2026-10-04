"""One-click Microsoft 365 mail connection (delegated Graph tokens).

An administrator signs in with Microsoft once and grants admin consent for the
mail scopes Nexus needs for leads and ticket email.  The resulting delegated
tokens are stored encrypted at rest and refreshed server-side, so nobody has to
create an Azure application, paste a client secret or hand-assign Graph
application permissions.

The browser never receives token material: routes only expose the safe
connection view produced by :func:`safe_connection_view`.
"""

from __future__ import annotations

import base64
import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from app.database import db
from app.services.microsoft365_credentials import load_microsoft365_client_secret
from app.services.secret_store import decrypt_secret, encrypt_secret

CONNECTION_SETTINGS_TYPE = "microsoft_graph_connection"

# Delegated scopes for the one-click grant.  Mail.Send covers ticket replies
# and lead responses; Mail.Read powers email-to-lead / email-to-ticket inbox
# intake; the rest identify the connected account and allow token refresh.
GRAPH_MAIL_SCOPES = ["openid", "profile", "email", "offline_access", "User.Read", "Mail.Send", "Mail.Read"]

# Refresh a delegated access token this long before it actually expires.
_EXPIRY_SKEW = timedelta(minutes=5)

_SAFE_VIEW_FIELDS = (
    "status",
    "tenant_id",
    "client_id",
    "connected_account",
    "connected_account_name",
    "microsoft_user_id",
    "scopes",
    "token_expires_at",
    "connected_by",
    "connected_by_name",
    "connected_at",
    "disconnected_at",
    "updated_at",
    "last_error_code",
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat()


def _parse_expiry(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


async def load_connection() -> dict | None:
    """Return the persisted delegated mail connection, if any."""
    return await db.settings.find_one({"type": CONNECTION_SETTINGS_TYPE}, {"_id": 0})


async def load_connect_app_config() -> dict:
    """Resolve the Entra application used for the one-click grant.

    A deployment-level multi-tenant application is preferred so customer
    administrators never touch the Azure portal.  Installations that already
    registered their own Microsoft application under Settings > Sign-in &
    Access keep working through the fallback.
    """
    client_id = str(os.environ.get("MICROSOFT_OAUTH_CLIENT_ID") or "").strip()
    if client_id:
        return {
            "client_id": client_id,
            "client_secret": str(os.environ.get("MICROSOFT_OAUTH_CLIENT_SECRET") or "").strip(),
            "tenant_hint": str(os.environ.get("MICROSOFT_OAUTH_TENANT_ID") or "").strip(),
            "source": "deployment",
        }
    sso = await db.settings.find_one({"type": "microsoft_sso"}, {"_id": 0}) or {}
    client_id = str(sso.get("client_id") or "").strip()
    if client_id:
        return {
            "client_id": client_id,
            "client_secret": str(sso.get("client_secret") or "").strip(),
            "tenant_hint": str(sso.get("tenant_id") or "").strip(),
            "source": "microsoft_sso",
        }
    return {"client_id": "", "client_secret": "", "tenant_hint": "", "source": ""}


def resolve_redirect_uri(api_base_url: str) -> str:
    """Callback URL registered in the Entra application.

    Auto-detected from the request so the same build works behind any reverse
    proxy; a deployment can pin it with ``MICROSOFT_CONNECT_REDIRECT_URI`` when
    the externally visible URL cannot be derived from the incoming request.
    """
    override = str(os.environ.get("MICROSOFT_CONNECT_REDIRECT_URI") or "").strip()
    if override:
        return override
    return f"{str(api_base_url).rstrip('/')}/api/settings/microsoft-connect/callback"


def authorization_endpoint(tenant: str) -> str:
    return f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize"


def token_endpoint(tenant: str) -> str:
    return f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"


def decode_id_token_claims(id_token: Any) -> dict:
    """Read the unverified claims of an id_token received over TLS from Entra.

    Only used for non-secret metadata (the tenant ID) that is immediately
    corroborated by the signed-in profile fetch; the token itself is never
    stored or returned.
    """
    token = str(id_token or "")
    parts = token.split(".")
    if len(parts) != 3:
        return {}
    try:
        padded = parts[1] + "=" * (-len(parts[1]) % 4)
        claims = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8"))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
        return {}
    return claims if isinstance(claims, dict) else {}


def safe_connection_view(connection: dict | None, *, app_configured: bool) -> dict:
    """Project the connection for the browser without any token material."""
    connection = connection or {}
    view = {field: connection.get(field) for field in _SAFE_VIEW_FIELDS if connection.get(field) is not None}
    view.setdefault("status", "disconnected")
    view["connected"] = view["status"] == "connected"
    view["app_configured"] = app_configured
    view["scopes"] = list(connection.get("scopes") or [])
    if not view["connected"]:
        view["connected_account"] = ""
        view["tenant_id"] = ""
    return view


async def persist_tokens(
    connection: dict,
    tokens: dict,
) -> dict:
    """Encrypt and store delegated tokens on the connection document."""
    now = _utcnow()
    access_token = str(tokens.get("access_token") or "")
    refresh_token = str(tokens.get("refresh_token") or "")
    expires_in = int(tokens.get("expires_in") or 3600)
    update = {
        "access_token_encrypted": encrypt_secret(access_token),
        "token_expires_at": _iso(now + timedelta(seconds=expires_in)),
        "updated_at": _iso(now),
    }
    if refresh_token:
        update["refresh_token_encrypted"] = encrypt_secret(refresh_token)
    await db.settings.update_one(
        {"type": CONNECTION_SETTINGS_TYPE},
        {"$set": {**{key: value for key, value in connection.items() if key != "_id"}, **update}},
        upsert=True,
    )
    return update


async def mark_connection_status(status: str, *, error_code: str | None = None) -> None:
    update = {"status": status, "updated_at": _iso(_utcnow())}
    if error_code:
        update["last_error_code"] = error_code
    await db.settings.update_one({"type": CONNECTION_SETTINGS_TYPE}, {"$set": update}, upsert=True)


async def _refresh_delegated_tokens(connection: dict, app_config: dict) -> dict | None:
    """Refresh the delegated grant, persisting rotated tokens.  None on failure."""
    refresh_token = decrypt_secret(connection.get("refresh_token_encrypted") or "")
    client_id = str(connection.get("client_id") or app_config.get("client_id") or "").strip()
    if not refresh_token or not client_id:
        return None
    tenant = str(connection.get("tenant_id") or app_config.get("tenant_hint") or "organizations").strip() or "organizations"
    payload = {
        "client_id": client_id,
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "scope": " ".join(connection.get("scopes") or GRAPH_MAIL_SCOPES),
    }
    secret = str(app_config.get("client_secret") or "").strip()
    if secret:
        payload["client_secret"] = secret
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(token_endpoint(tenant), data=payload)
    except httpx.HTTPError:
        return None
    if response.status_code != 200:
        return None
    tokens = response.json()
    if not tokens.get("access_token"):
        return None
    # Entra may rotate the refresh token; always keep the newest grant.
    if not tokens.get("refresh_token"):
        tokens["refresh_token"] = refresh_token
    await persist_tokens(connection, tokens)
    return tokens


async def get_delegated_access_token() -> str | None:
    """Return a usable delegated Graph access token, refreshing when required."""
    connection = await load_connection()
    if not connection or connection.get("status") != "connected":
        return None
    access_token = str(connection.get("access_token_encrypted") or "")
    expires = _parse_expiry(connection.get("token_expires_at"))
    if access_token and expires and expires > _utcnow() + _EXPIRY_SKEW:
        return decrypt_secret(access_token)
    app_config = await load_connect_app_config()
    tokens = await _refresh_delegated_tokens(connection, app_config)
    if not tokens:
        await mark_connection_status("reauth_required", error_code="token_refresh_failed")
        return None
    return str(tokens.get("access_token") or "")


async def get_app_only_access_token() -> str | None:
    """Legacy client-credentials token from the manually connected mailbox."""
    settings = await db.settings.find_one({"type": "o365_mailbox"}, {"_id": 0}) or {}
    tenant_id = str(settings.get("tenant_id") or "").strip()
    client_id = str(settings.get("client_id") or "").strip()
    if not tenant_id or not client_id:
        return None
    client_secret = await load_microsoft365_client_secret(
        settings,
        collection=db.settings,
        query={"type": "o365_mailbox"},
    )
    if not client_secret:
        return None
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                token_endpoint(tenant_id),
                data={
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "scope": "https://graph.microsoft.com/.default",
                    "grant_type": "client_credentials",
                },
            )
    except httpx.HTTPError:
        return None
    if response.status_code != 200:
        return None
    return response.json().get("access_token")


async def acquire_graph_access_token() -> tuple[str | None, str]:
    """Return ``(access_token, mode)`` for Microsoft Graph.

    ``mode`` is ``"delegated"`` for the one-click connection, ``"app_only"``
    for the legacy client-secret mailbox connection, or ``""`` when no usable
    credential exists.  The one-click connection is authoritative when present
    so a manual Azure setup is never required alongside it.
    """
    token = await get_delegated_access_token()
    if token:
        return token, "delegated"
    token = await get_app_only_access_token()
    if token:
        return token, "app_only"
    return None, ""
