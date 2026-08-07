"""Distributed request-abuse controls for public authentication endpoints.

The limiter stores only keyed SHA-256 digests of identifiers. It uses MongoDB
atomic increments so separate API replicas share the same enforcement state.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import os
from typing import Any

from pymongo import ReturnDocument

from app.database import db


@dataclass(frozen=True)
class LoginRateLimitExceeded(Exception):
    retry_after: int


def _positive_int(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default
    return value if value > 0 else default


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def client_address(request: Any) -> str:
    """Return a trustworthy client address for rate-limit partitioning.

    Forwarded headers are ignored unless the deployment explicitly declares
    that requests arrive through a trusted proxy which overwrites them.
    """
    trust_proxy = os.environ.get("NEXUS_TRUST_PROXY_HEADERS", "false").lower() == "true"
    if trust_proxy:
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            return forwarded.split(",", 1)[0].strip()
        real_ip = request.headers.get("x-real-ip", "").strip()
        if real_ip:
            return real_ip
    client = getattr(request, "client", None)
    return str(getattr(client, "host", "unknown") or "unknown")


def _bucket_key(scope: str, identifier: str, bucket: int) -> str:
    return f"auth-login:{scope}:{bucket}:{_digest(identifier)}"


async def ensure_request_throttle_indexes(collection: Any | None = None) -> None:
    if collection is None:
        collection = db.security_rate_limits
    await collection.create_index(
        "expires_at",
        expireAfterSeconds=0,
        name="expire_security_rate_limits",
    )


async def consume_login_attempt(
    request: Any,
    email: str,
    *,
    collection: Any | None = None,
    now: datetime | None = None,
) -> None:
    """Atomically consume one login attempt across identity and IP budgets."""
    if collection is None:
        collection = db.security_rate_limits
    now = now or datetime.now(timezone.utc)
    window_seconds = _positive_int("NEXUS_LOGIN_WINDOW_SECONDS", 300)
    bucket = int(now.timestamp()) // window_seconds
    retry_after = max(1, ((bucket + 1) * window_seconds) - int(now.timestamp()))
    expires_at = now + timedelta(seconds=window_seconds * 2)
    normalized_email = email.strip().casefold()
    address = client_address(request)
    limits = (
        ("identity", normalized_email, _positive_int("NEXUS_LOGIN_IDENTITY_ATTEMPTS", 8)),
        ("ip", address, _positive_int("NEXUS_LOGIN_IP_ATTEMPTS", 30)),
    )

    exceeded = False
    for scope, identifier, limit in limits:
        document = await collection.find_one_and_update(
            {"_id": _bucket_key(scope, identifier, bucket)},
            {
                "$inc": {"count": 1},
                "$setOnInsert": {
                    "scope": scope,
                    "bucket": bucket,
                    "expires_at": expires_at,
                },
            },
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        if int((document or {}).get("count", 0)) > limit:
            exceeded = True

    if exceeded:
        raise LoginRateLimitExceeded(retry_after=retry_after)


async def clear_login_attempts(
    request: Any,
    email: str,
    *,
    collection: Any | None = None,
    now: datetime | None = None,
) -> None:
    """Clear current-window counters only after complete authentication."""
    if collection is None:
        collection = db.security_rate_limits
    now = now or datetime.now(timezone.utc)
    window_seconds = _positive_int("NEXUS_LOGIN_WINDOW_SECONDS", 300)
    bucket = int(now.timestamp()) // window_seconds
    await collection.delete_many(
        {
            "_id": {
                "$in": [
                    _bucket_key("identity", email.strip().casefold(), bucket),
                    _bucket_key("ip", client_address(request), bucket),
                ]
            }
        }
    )
