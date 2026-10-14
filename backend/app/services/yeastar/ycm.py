"""Yeastar Central Management (YCM) fleet transport.

YCM is a different product from a P-Series PBX: it authenticates with an OAuth
client-credentials token and answers under ``/dm/open_api`` instead of
``/openapi/v1.0``. That transport used to be hand-rolled inside the voice
router, next to its own token cache and its own exception strings. It lives
here now so the fleet connection shares the integration's failure taxonomy and
so the router keeps routing decisions rather than HTTP plumbing.

Design notes that matter operationally:

* **The cache is keyed by ``base_url|client_id``** and reused until shortly
  before expiry. YCM throttles token minting per API application, and the
  discovery/test routes are cheap to repeat, so re-minting on every call is the
  behaviour to avoid. Like the PBX client, the cache is process-local.
* **The client secret never leaves this module.** ``safe_ycm_settings`` is the
  only shape the API returns, and it deliberately omits the secret.
* These credentials are one fleet-wide connection, not per-customer data, so
  nothing here touches a customer record.
"""
from __future__ import annotations

import asyncio
import time
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import httpx

from app.services.yeastar.errors import YeastarError

DEFAULT_BASE_URL = "https://ycm.yeastar.com"
DEFAULT_USER_AGENT = "NexusMSP/1.0"

TOKEN_TIMEOUT_SECONDS = 12.0
REQUEST_TIMEOUT_SECONDS = 15.0

# Mint a token again this long before it expires, so a fleet read never races
# an expiry it has already seen.
TOKEN_SAFETY_MARGIN_SECONDS = 30
TOKEN_FALLBACK_LIFETIME_SECONDS = 600
TOKEN_MINIMUM_LIFETIME_SECONDS = 60

_tokens: dict[str, dict[str, Any]] = {}
_token_lock = asyncio.Lock()


def _client(timeout: float) -> httpx.AsyncClient:
    """Build the short-lived client used for one fleet call.

    A fleet request is an occasional administrative action rather than a
    ten-second poll, so it keeps its own short-lived connection instead of
    borrowing the PBX pools.
    """
    return httpx.AsyncClient(timeout=timeout)


def normalise_ycm_url(value: str) -> str:
    """Return a YCM base URL, rejecting anything that is not an HTTPS host.

    A bare hostname is accepted because operators paste ``ycm.yeastar.com`` from
    the portal. A value containing whitespace is refused: ``urlsplit`` accepts
    it, and letting it through turns a mistyped paste into a confusing
    connection failure instead of a clear validation message.
    """
    raw = str(value or DEFAULT_BASE_URL).strip()
    if "://" not in raw:
        raw = f"https://{raw}"
    parsed = urlsplit(raw)
    if parsed.scheme.lower() != "https" or not parsed.netloc:
        raise ValueError("Enter a valid HTTPS YCM address, for example https://ycm.yeastar.com")
    if any(character.isspace() for character in parsed.netloc):
        raise ValueError("Enter a valid HTTPS YCM address, for example https://ycm.yeastar.com")
    return urlunsplit(("https", parsed.netloc, parsed.path.rstrip("/"), "", ""))


def ycm_items(payload: Any) -> list[dict]:
    """Extract record rows from the several envelopes YCM uses.

    The fleet API wraps its lists differently per endpoint and release, so this
    tolerates a bare list, ``data``, ``items``/``instances`` and one nested
    layer, and drops anything that is not a record.
    """
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []
    data = payload.get("data", payload.get("items", payload.get("instances", [])))
    if isinstance(data, dict):
        data = data.get("items", data.get("list", data.get("instances", [])))
    return [item for item in (data or []) if isinstance(item, dict)] if isinstance(data, list) else []


def invalidate_ycm_token() -> None:
    """Forget the cached fleet token after its credentials or address change."""
    _tokens.clear()


async def get_ycm_token(settings: dict, *, strict: bool = False) -> str | None:
    """Return a fleet access token, minting one only when the cache is stale.

    ``strict=False`` returns ``None`` for a connection problem so a background
    caller can degrade, but a rejected credential is always raised: silently
    reporting "not configured" for a wrong secret would hide an operator error.
    """
    client_id = str(settings.get("client_id") or "").strip()
    client_secret = str(settings.get("client_secret") or "")
    if not client_id or not client_secret:
        if strict:
            raise YeastarError("YCM Client ID and Client Secret are required.", "configuration")
        return None
    base_url = normalise_ycm_url(settings.get("base_url") or "")
    cache_key = f"{base_url}|{client_id}"
    now = time.time()
    async with _token_lock:
        cached = _tokens.get(cache_key) or {}
        if cached.get("token") and cached.get("expires_at", 0) > now + TOKEN_SAFETY_MARGIN_SECONDS:
            return cached["token"]
        headers = {"User-Agent": settings.get("user_agent") or DEFAULT_USER_AGENT}
        try:
            async with _client(TOKEN_TIMEOUT_SECONDS) as client:
                response = await client.post(
                    f"{base_url}/dm/open_api/oauth/token",
                    data={"grant_type": "client_credentials", "client_id": client_id, "client_secret": client_secret},
                    headers=headers,
                )
            payload = response.json() if response.content else {}
            if response.status_code >= 400:
                raise YeastarError(
                    "YCM rejected the Client ID or Client Secret. Check the YCM API application and permitted IP settings.",
                    "authentication",
                )
            token = payload.get("access_token") or (payload.get("data") or {}).get("access_token")
            if not token:
                raise YeastarError("YCM returned no access token. Confirm the API application has been enabled.", "authentication")
            expires_in = int(payload.get("expires_in") or (payload.get("data") or {}).get("expires_in") or TOKEN_FALLBACK_LIFETIME_SECONDS)
            _tokens[cache_key] = {"token": token, "expires_at": now + max(TOKEN_MINIMUM_LIFETIME_SECONDS, expires_in)}
            return token
        except YeastarError:
            raise
        except httpx.TimeoutException as exc:
            error = YeastarError("YCM did not respond in time. Check internet access and the configured YCM address.", "timeout")
            if strict:
                raise error from exc
            return None
        except httpx.HTTPError as exc:
            error = YeastarError("Nexus could not reach YCM. Check the configured address and outbound firewall policy.", "connection")
            if strict:
                raise error from exc
            return None


async def ycm_api_get(path: str, settings: dict) -> dict:
    """Run one authenticated fleet read and return its JSON envelope."""
    token = await get_ycm_token(settings, strict=True)
    base_url = normalise_ycm_url(settings.get("base_url") or "")
    headers = {"Authorization": f"Bearer {token}", "User-Agent": settings.get("user_agent") or DEFAULT_USER_AGENT}
    try:
        async with _client(REQUEST_TIMEOUT_SECONDS) as client:
            response = await client.get(f"{base_url}/dm/open_api/{path.lstrip('/')}", headers=headers)
        payload = response.json() if response.content else {}
        if response.status_code >= 400:
            raise YeastarError(f"YCM fleet request failed with HTTP {response.status_code}.", "http")
        return payload if isinstance(payload, dict) else {"data": payload}
    except YeastarError:
        raise
    except httpx.TimeoutException as exc:
        raise YeastarError("YCM fleet discovery timed out.", "timeout") from exc
    except httpx.HTTPError as exc:
        raise YeastarError("YCM fleet discovery could not reach the management service.", "connection") from exc


def safe_ycm_settings(record: dict | None) -> dict:
    """Return the fleet connection's non-secret state for the API and the UI."""
    record = record or {}
    return {
        "configured": bool(record.get("client_id") and record.get("client_secret")),
        "base_url": record.get("base_url") or DEFAULT_BASE_URL,
        "client_id": record.get("client_id") or "",
        "user_agent": record.get("user_agent") or DEFAULT_USER_AGENT,
        "last_test_at": record.get("last_test_at") or "",
        "last_test_status": record.get("last_test_status") or "not_tested",
        "last_test_error": record.get("last_test_error") or "",
        "last_discovery_at": record.get("last_discovery_at") or "",
    }
