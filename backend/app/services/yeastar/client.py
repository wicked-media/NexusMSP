"""Shared Yeastar PBX transport: pooled HTTP, one token cache, explicit scope.

Every per-PBX call in the integration now goes through here, so credential
handling, TLS policy, timeout behaviour and token lifetime are decided once
instead of at each call site.

Design notes that matter operationally:

* **Yeastar allows eight live tokens per PBX.** The cache is therefore per
  ``(pbx_url, client_id)`` and reused until shortly before expiry, and
  ``revoke_token`` frees a slot when credentials are rotated or a PBX is
  unlinked. The cache is process-local: a deployment that runs several API
  workers can still mint one token per worker, which is why the catalogue and
  docs call that out rather than silently introducing a new credential store.
* **Nothing here logs, returns or persists a secret.** Callers pass their own
  settings document and receive a token or a provider payload; the raw token
  never appears in a log line, an exception message or an API response.
* Requests deliberately keep the provider's ``access_token`` query parameter
  wire format. Changing the transport to a header without a live PBX to verify
  against would risk breaking real installations, so it is recorded as
  follow-up work instead.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import httpx

from app.database import db
from app.services.scope_permissions import (
    assert_client_scope,
    effective_scope,
    scope_query,
    tenant_scoped_query,
)
from app.services.yeastar.errors import YeastarError, provider_error

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT_SECONDS = 15.0
STREAM_TIMEOUT_SECONDS = 60.0
TOKEN_SAFETY_MARGIN_SECONDS = 60
TOKEN_FALLBACK_LIFETIME_SECONDS = 1800
USER_AGENT = "OpenAPI"
MAX_STREAM_BYTES = 64 * 1024 * 1024

# Yeastar caps a PBX at eight concurrent API tokens (provider error 60002).
TOKEN_LIMIT_ERRCODE = 60002

# Process-local, and deliberately so: see the module note about the provider's
# eight-token limit. Both primitives are asyncio objects, so they are only ever
# awaited from the application's own event loop.
_tokens: dict[str, dict[str, Any]] = {}
_token_lock = asyncio.Lock()
_clients: dict[bool, httpx.AsyncClient] = {}
_clients_lock = asyncio.Lock()


def self_signed_allowed() -> bool:
    """Whether the deployment permits PBXs with untrusted certificates."""
    return os.environ.get("ALLOW_SELF_SIGNED_CERTS", "false").strip().lower() == "true"


def verify_tls_for(settings: dict) -> bool:
    """TLS verification policy for one PBX.

    An explicit per-PBX choice wins; otherwise the deployment default decides.
    A PBX that has not been asked about keeps verification on.
    """
    configured = settings.get("tls_validation")
    if configured is None:
        return not self_signed_allowed()
    return bool(configured)


async def _pooled_client(verify: bool) -> httpx.AsyncClient:
    """Return a shared client for one TLS policy.

    A PBX fleet is a long-lived WAN dependency and the monitoring poll repeats
    every ten seconds, so reconnecting per call spent a full TLS handshake on
    every read. Two pools keep the trust decision honest: verified traffic
    never shares a connection with an untrusted certificate.
    """
    client = _clients.get(verify)
    if client is not None and not client.is_closed:
        return client
    async with _clients_lock:
        client = _clients.get(verify)
        if client is None or client.is_closed:
            client = httpx.AsyncClient(
                verify=verify,
                timeout=DEFAULT_TIMEOUT_SECONDS,
                limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
            )
            _clients[verify] = client
        return client


async def aclose_pools() -> None:
    """Release the pooled connections during application shutdown."""
    async with _clients_lock:
        clients = list(_clients.values())
        _clients.clear()
    for client in clients:
        try:
            await client.aclose()
        except Exception as exc:  # Shutdown must not raise over a socket close.
            logger.debug("Yeastar client pool close failed: %s", exc)


def normalise_pbx_url(value: str) -> str:
    """Return a PBX base URL, rejecting anything that is not an HTTP endpoint.

    A pasted value routinely carries the ``/openapi`` suffix from the PBX web
    URL. It is stripped so the caller can paste either form.
    """
    raw = str(value or "").strip()
    if not raw:
        raise ValueError("Enter the PBX URL or Yeastar FQDN")
    if "://" not in raw:
        raw = f"https://{raw}"
    parsed = urlsplit(raw)
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Enter a valid PBX URL, for example https://customer.example.yeastarcloud.com")
    # A host can never contain whitespace, and urlsplit happily accepts it, so
    # a pasted sentence would otherwise become a confusing connection failure
    # instead of a clear validation message. Single-label LAN hosts stay valid.
    if any(character.isspace() for character in parsed.netloc):
        raise ValueError("Enter a valid PBX URL, for example https://customer.example.yeastarcloud.com")
    path = parsed.path.rstrip("/")
    marker = path.lower().find("/openapi/")
    if marker >= 0:
        path = path[:marker]
    elif path.lower().endswith("/openapi"):
        path = path[:-8]
    return urlunsplit((parsed.scheme.lower(), parsed.netloc, path.rstrip("/"), "", ""))


def pbx_base_url(settings: dict) -> str:
    value = settings.get("pbx_url") or settings.get("url") or ""
    try:
        return normalise_pbx_url(str(value))
    except ValueError:
        return str(value).strip().rstrip("/")


def pbx_client_id(settings: dict) -> str:
    return str(settings.get("client_api_id") or settings.get("client_id") or "")


def has_credentials(settings: dict) -> bool:
    return bool(pbx_base_url(settings) and pbx_client_id(settings) and settings.get("client_secret"))


def token_cache_key(settings: dict) -> str:
    return f"{pbx_base_url(settings)}|{pbx_client_id(settings)}"


def invalidate_token(settings: dict | None = None) -> None:
    """Forget one PBX's cached token, or the whole cache.

    Called when credentials rotate. ``revoke_token`` is the counterpart that
    also tells the PBX to release the slot.
    """
    if settings is None:
        _tokens.clear()
        return
    _tokens.pop(token_cache_key(settings), None)


def _authentication_error(payload: dict) -> YeastarError:
    code = payload.get("errcode")
    message = str(payload.get("errmsg") or "Authentication failed")
    if code == TOKEN_LIMIT_ERRCODE:
        return YeastarError(
            "Yeastar has reached its eight-token limit. Wait for an existing token to expire (up to 30 minutes), then test again.",
            "authentication",
            errcode=code,
        )
    return YeastarError(
        f"Yeastar rejected the Client ID or Client Secret ({message}, error {code}). Check Integrations > API on this PBX.",
        "authentication",
        errcode=code,
    )


async def get_token(settings: dict, *, strict: bool = False, force_refresh: bool = False) -> str | None:
    """Get a P-Series API token, reusing a cached one while it is valid."""
    base_url = pbx_base_url(settings)
    client_id = pbx_client_id(settings)
    secret = settings.get("client_secret", "")
    if not base_url or not client_id or not secret:
        if strict:
            raise YeastarError("PBX URL, Client ID, and Client Secret are required.", "configuration")
        return None

    key = token_cache_key(settings)
    async with _token_lock:
        now = time.time()
        cached = _tokens.get(key) or {}
        if not force_refresh and cached.get("token") and now < float(cached.get("expires") or 0):
            return cached["token"]

        url = f"{base_url}/openapi/v1.0/get_token"
        try:
            client = await _pooled_client(verify_tls_for(settings))
            response = await client.post(
                url,
                json={"username": client_id, "password": secret},
                headers={"User-Agent": USER_AGENT, "Content-Type": "application/json"},
            )
            if response.status_code >= 400:
                raise YeastarError(f"The PBX returned HTTP {response.status_code} from its token endpoint.", "http")
            try:
                payload = response.json()
            except ValueError as exc:
                raise YeastarError(
                    "The address responded, but it was not a Yeastar P-Series OpenAPI endpoint. Enter the PBX base URL without /openapi.",
                    "endpoint",
                ) from exc
            if payload.get("errcode") == 0:
                token = payload.get("access_token")
                if not token:
                    raise YeastarError("Yeastar returned success without an access token.", "authentication")
                lifetime = payload.get("access_token_expire_time") or TOKEN_FALLBACK_LIFETIME_SECONDS
                _tokens[key] = {
                    "token": token,
                    # A refresh token is retained so an expired access token can
                    # be renewed without spending another of the eight slots.
                    "refresh_token": payload.get("refresh_token"),
                    "expires": now + float(lifetime) - TOKEN_SAFETY_MARGIN_SECONDS,
                }
                return token
            raise _authentication_error(payload)
        except YeastarError as exc:
            # Never log the URL's query string or the secret; the base URL and
            # the category are enough to diagnose a failed authentication.
            logger.warning("Yeastar authentication failed for %s: %s", base_url, exc.category)
            if strict:
                raise
            return None
        except httpx.TimeoutException as exc:
            error = YeastarError(
                "Timed out connecting to the PBX. Check the FQDN, web port, firewall, and remote API access.",
                "timeout",
            )
            if strict:
                raise error from exc
            return None
        except httpx.ConnectError as exc:
            detail = str(exc).lower()
            if "certificate" in detail or "ssl" in detail or "tls" in detail:
                error = YeastarError(
                    "TLS validation failed. Install a valid certificate on the PBX, or disable TLS validation only for a trusted private endpoint.",
                    "tls",
                )
            else:
                error = YeastarError(
                    "Could not reach the PBX. Check the base URL, DNS, firewall, web port, and Yeastar remote API access.",
                    "connection",
                )
            if strict:
                raise error from exc
            return None
        except httpx.HTTPError as exc:
            error = YeastarError(f"Yeastar API request failed: {exc.__class__.__name__}.", "http")
            if strict:
                raise error from exc
            return None


async def revoke_token(settings: dict) -> bool:
    """Release this PBX's token slot and forget it locally.

    Called when credentials rotate or a PBX is unlinked. Yeastar only allows
    eight live tokens per PBX, so leaving a stale one behind is what produces
    the provider's token-limit failure later.
    """
    key = token_cache_key(settings)
    cached = _tokens.pop(key, None)
    token = (cached or {}).get("token")
    base_url = pbx_base_url(settings)
    if not token or not base_url:
        return False
    try:
        client = await _pooled_client(verify_tls_for(settings))
        response = await client.get(
            f"{base_url}/openapi/v1.0/del_token",
            params={"access_token": token},
            headers={"User-Agent": USER_AGENT},
        )
        return response.status_code == 200
    except httpx.HTTPError as exc:
        # The slot expires on its own; a failed revoke must not block the
        # credential change the operator asked for.
        logger.info("Yeastar token revoke failed for %s: %s", base_url, exc.__class__.__name__)
        return False


async def api_call(
    settings: dict,
    path: str,
    *,
    method: str = "GET",
    version: str = "1.0",
    params: dict | None = None,
    body: dict | None = None,
    token: str | None = None,
    strict: bool = False,
    timeout: float | None = None,
) -> dict | list | None:
    """Call one OpenAPI interface and return its decoded payload.

    Returns ``None`` on a non-strict failure so an optional read degrades
    instead of failing a page; ``strict=True`` raises a categorised
    :class:`YeastarError` for operations where silence would be wrong.
    """
    token = token or await get_token(settings, strict=strict)
    if not token:
        return None
    base_url = pbx_base_url(settings)
    url = f"{base_url}/openapi/v{version}/{path.lstrip('/')}"
    query = {"access_token": token}
    if params:
        query.update(params)
    try:
        client = await _pooled_client(verify_tls_for(settings))
        request_timeout = timeout if timeout is not None else DEFAULT_TIMEOUT_SECONDS
        if method.upper() == "POST":
            response = await client.post(url, params=query, json=body or {}, headers={"User-Agent": USER_AGENT}, timeout=request_timeout)
        else:
            response = await client.get(url, params=query, headers={"User-Agent": USER_AGENT}, timeout=request_timeout)
        if response.status_code == 200 and response.text:
            try:
                payload = response.json()
            except ValueError as exc:
                if strict:
                    raise YeastarError("The PBX returned an invalid API response.", "endpoint") from exc
                return None
            if isinstance(payload, dict) and payload.get("errcode", 0) != 0:
                # An expired token is worth one silent renewal: it is the
                # common case after a restart, and re-authenticating costs a
                # token slot the eight-token limit makes worth protecting.
                if payload.get("errcode") in {1000, 1001, 1002, 1003} and not strict:
                    invalidate_token(settings)
                    return None
                if strict:
                    raise provider_error(payload)
            return payload
        # Log only the path and status: the query string carries the token.
        logger.error("Yeastar API %s: status=%s", path, response.status_code)
        if strict:
            raise YeastarError(f"The PBX returned HTTP {response.status_code} for {path}.", "http", status_code=response.status_code)
        return None
    except YeastarError:
        raise
    except httpx.TimeoutException as exc:
        if strict:
            raise YeastarError("The PBX API timed out during its live check.", "timeout") from exc
        return None
    except httpx.ConnectError as exc:
        if strict:
            raise YeastarError("The PBX became unreachable during its live check.", "connection") from exc
        return None
    except httpx.HTTPError as exc:
        logger.error("Yeastar API %s error: %s", path, exc.__class__.__name__)
        if strict:
            raise YeastarError("The PBX API live check failed.", "http") from exc
        return None


async def dispatch_operation(
    settings: dict,
    operation,
    *,
    params: dict | None = None,
    body: dict | None = None,
    strict: bool = True,
) -> dict | list | None:
    """Run one catalogue operation against a PBX.

    Only operations described by :mod:`app.services.yeastar.registry` reach
    this function, and only the parameters the catalogue declares are
    forwarded, so a caller cannot append arbitrary provider arguments.
    """
    allowed = set(operation.params)
    clean_params = {key: value for key, value in (params or {}).items() if key in allowed and value not in (None, "")}
    clean_body = {key: value for key, value in (body or {}).items() if not allowed or key in allowed}
    return await api_call(
        settings,
        operation.path,
        method=operation.method,
        version=operation.version,
        params=clean_params,
        body=clean_body if operation.method == "POST" else None,
        strict=strict,
    )


async def fetch_bytes(
    settings: dict,
    path: str,
    *,
    version: str = "1.0",
    params: dict | None = None,
    token: str | None = None,
    max_bytes: int = MAX_STREAM_BYTES,
) -> tuple[bytes, str]:
    """Fetch a provider artifact server-side.

    Recordings, voicemail audio and backups are private customer content. The
    provider's download URL authorises the fetch, so it is resolved here and
    the bytes are streamed to the authenticated caller by a Nexus route; the
    URL itself never reaches the browser.
    """
    token = token or await get_token(settings, strict=True)
    if not token:
        raise YeastarError("The PBX did not issue an access token.", "authentication")
    base_url = pbx_base_url(settings)
    url = f"{base_url}/openapi/v{version}/{path.lstrip('/')}"
    query = {"access_token": token}
    if params:
        query.update(params)
    try:
        client = await _pooled_client(verify_tls_for(settings))
        async with client.stream("GET", url, params=query, headers={"User-Agent": USER_AGENT}, timeout=STREAM_TIMEOUT_SECONDS) as response:
            if response.status_code >= 400:
                raise YeastarError(f"The PBX returned HTTP {response.status_code} for {path} content.", "http", status_code=response.status_code)
            declared = response.headers.get("content-length")
            if declared and declared.isdigit() and int(declared) > max_bytes:
                raise YeastarError("That artifact is larger than Nexus will relay for one request.", "configuration")
            chunks: list[bytes] = []
            total = 0
            async for chunk in response.aiter_bytes():
                total += len(chunk)
                if total > max_bytes:
                    raise YeastarError("That artifact is larger than Nexus will relay for one request.", "configuration")
                chunks.append(chunk)
            content_type = response.headers.get("content-type") or "application/octet-stream"
            return b"".join(chunks), content_type
    except YeastarError:
        raise
    except httpx.TimeoutException as exc:
        raise YeastarError("The PBX did not deliver that artifact in time.", "timeout") from exc
    except httpx.HTTPError as exc:
        raise YeastarError("The PBX artifact download failed.", "http") from exc


async def fetch_provider_url(url: str, *, max_bytes: int = MAX_STREAM_BYTES) -> tuple[bytes, str]:
    """Relay an artifact from a provider-issued URL.

    Yeastar's download interfaces answer with a URL rather than the bytes, and
    that URL authorises the download. It is therefore followed server-side and
    the content relayed to the authenticated caller, so the URL never becomes a
    capability the browser holds.
    """
    target = str(url or "").strip()
    if not target.lower().startswith(("http://", "https://")):
        raise YeastarError("The PBX returned an unusable download address.", "endpoint")
    try:
        async with httpx.AsyncClient(verify=True, timeout=STREAM_TIMEOUT_SECONDS) as http:
            async with http.stream("GET", target, headers={"User-Agent": USER_AGENT}) as response:
                if response.status_code >= 400:
                    raise YeastarError(
                        f"The PBX artifact host returned HTTP {response.status_code}.",
                        "http",
                        status_code=response.status_code,
                    )
                declared = response.headers.get("content-length")
                if declared and declared.isdigit() and int(declared) > max_bytes:
                    raise YeastarError("That artifact is larger than Nexus will relay for one request.", "configuration")
                chunks: list[bytes] = []
                total = 0
                async for chunk in response.aiter_bytes():
                    total += len(chunk)
                    if total > max_bytes:
                        raise YeastarError("That artifact is larger than Nexus will relay for one request.", "configuration")
                    chunks.append(chunk)
                return b"".join(chunks), response.headers.get("content-type") or "application/octet-stream"
    except YeastarError:
        raise
    except httpx.TimeoutException as exc:
        raise YeastarError("The PBX artifact host did not respond in time.", "timeout") from exc
    except httpx.HTTPError as exc:
        raise YeastarError("The PBX artifact download failed.", "http") from exc


def caller_may_use_legacy_settings(current_user: dict) -> bool:
    """Whether a caller may fall back to the pre-client tenant singleton.

    The legacy ``settings`` document has no client binding, so only an
    all-client actor may read it. A restricted technician must never inherit
    another customer's PBX through this path.
    """
    return effective_scope(current_user).get("mode") == "all"


async def resolve_pbx(
    current_user: dict,
    pbx_id: str | None = None,
    *,
    operation: str | None = None,
    include_legacy: bool = False,
) -> dict:
    """Resolve the PBX a caller is authorised to act on.

    Scope is applied to the query itself, so an unbound caller cannot name
    their way into another customer's PBX. The legacy singleton is considered
    only for an all-client actor that explicitly asks for it.
    """
    if pbx_id:
        record = await db.yeastar_pbxs.find_one({"id": str(pbx_id)}, {"_id": 0})
        if not record:
            raise YeastarError("PBX not found", "not_found")
        await assert_client_scope(current_user, record.get("client_id"), operation=operation, mask_not_found=True)
        return record

    base_query = tenant_scoped_query(current_user, scope_query(current_user))
    record = await db.yeastar_pbxs.find_one({**base_query, "enabled": {"$ne": False}}, {"_id": 0})
    if not record:
        record = await db.yeastar_pbxs.find_one(base_query, {"_id": 0})
    if record:
        return record

    if include_legacy and caller_may_use_legacy_settings(current_user):
        legacy = await db.settings.find_one({"type": "yeastar"}, {"_id": 0})
        if legacy:
            return legacy

    raise YeastarError("No client PBX is available to this user.", "configuration")


async def resolve_pbx_optional(current_user: dict, pbx_id: str | None = None, **kwargs) -> dict | None:
    """Same as :func:`resolve_pbx` but returns ``None`` instead of raising."""
    try:
        return await resolve_pbx(current_user, pbx_id, **kwargs)
    except YeastarError as exc:
        if exc.category == "not_found":
            raise
        return None
