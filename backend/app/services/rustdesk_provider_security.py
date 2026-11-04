"""Shared validation and redaction for the RustDesk provider boundary.

RustDesk is commonly self-hosted, so private on-premises targets remain valid.
This module protects the Nexus API from malformed origins and accidental
loopback/link-local targets while allowing deployments to opt into an exact
hostname allowlist through ``NEXUS_RUSTDESK_ALLOWED_HOSTS``.
"""

from __future__ import annotations

import ipaddress
import os
import re
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from fastapi import HTTPException


SENSITIVE_FIELD_MARKERS = (
    "api_key",
    "apikey",
    "authorization",
    "credential",
    "password",
    "private_key",
    "secret",
    "token",
)

# Many URL parsers and HTTP stacks accept historical IPv4 spellings such as
# ``127.1``, ``2130706433`` or ``0x7f000001``.  ``ipaddress`` intentionally
# rejects those spellings, so recognise and reject them before an outbound
# client can reinterpret a loopback target.
_AMBIGUOUS_NUMERIC_HOST_RE = re.compile(
    r"^(?:0[xX][0-9A-Fa-f]+|[0-9]+)(?:\.(?:0[xX][0-9A-Fa-f]+|[0-9]+)){0,3}$"
)


def is_masked_secret(value: object) -> bool:
    return str(value or "").strip().startswith(("********", "••••"))


def normalise_rustdesk_server_url(value: object) -> str:
    """Return a safe HTTP(S) origin for the server-owned RustDesk provider."""
    raw = str(value or "").strip()
    if not raw:
        return ""
    if len(raw) > 512 or any(character.isspace() for character in raw):
        raise HTTPException(status_code=422, detail="RustDesk server URL must be a single HTTPS or HTTP origin")

    candidate = raw if "://" in raw else f"https://{raw}"
    parsed = urlsplit(candidate)
    if parsed.scheme not in {"https", "http"} or not parsed.hostname:
        raise HTTPException(status_code=422, detail="RustDesk server URL must use HTTP or HTTPS and include a host")
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
        raise HTTPException(status_code=422, detail="RustDesk server URL must be an origin without credentials, path, query, or fragment")
    try:
        port = parsed.port
        # A trailing DNS root label is equivalent to the same host without it.
        # Canonicalise before evaluating loopback and allowlist policy so
        # ``127.0.0.1.`` cannot bypass the literal-address checks.
        hostname = parsed.hostname.encode("idna").decode("ascii").lower().rstrip(".")
    except (UnicodeError, ValueError):
        raise HTTPException(status_code=422, detail="RustDesk server URL has an invalid host or port") from None
    if not hostname:
        raise HTTPException(status_code=422, detail="RustDesk server URL has an invalid host")

    if hostname in {"localhost", "localhost.localdomain"} or hostname.endswith(".localhost"):
        raise HTTPException(status_code=422, detail="RustDesk server URL cannot target a loopback host")
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        if _AMBIGUOUS_NUMERIC_HOST_RE.fullmatch(hostname):
            raise HTTPException(
                status_code=422,
                detail="RustDesk server URL cannot use an ambiguous numeric address",
            ) from None
        address = None
    if address and (address.is_loopback or address.is_unspecified or address.is_link_local or address.is_multicast):
        raise HTTPException(status_code=422, detail="RustDesk server URL cannot target a loopback, link-local, multicast, or unspecified address")

    allowed_hosts = {
        item.strip().lower().strip("[]")
        for item in os.environ.get("NEXUS_RUSTDESK_ALLOWED_HOSTS", "").split(",")
        if item.strip()
    }
    if allowed_hosts and hostname not in allowed_hosts:
        raise HTTPException(status_code=422, detail="RustDesk server host is not in the configured provider allowlist")

    host = f"[{hostname}]" if ":" in hostname else hostname
    netloc = f"{host}:{port}" if port else host
    return urlunsplit((parsed.scheme, netloc, "", "", ""))


def redact_provider_payload(value: Any, *, key: str = "") -> Any:
    """Redact credential-shaped fields from flexible provider payloads."""
    lowered = str(key).lower()
    if any(marker in lowered for marker in SENSITIVE_FIELD_MARKERS):
        return "[redacted]"
    if isinstance(value, dict):
        return {str(child_key): redact_provider_payload(child_value, key=str(child_key)) for child_key, child_value in value.items()}
    if isinstance(value, list):
        return [redact_provider_payload(item) for item in value]
    return value
