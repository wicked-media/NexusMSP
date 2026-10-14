"""Shared safety rules for legacy outbound webhook administration.

The durable event backbone has its own encrypted-secret delivery pipeline.  A
small number of older workspace routes still manage compatibility webhooks in
MongoDB, so these helpers keep those routes from returning credentials or
accepting obviously unsafe endpoint URLs while they continue to operate.
"""

from __future__ import annotations

from typing import Any

from app.services.event_backbone import validate_webhook_url


_SENSITIVE_HEADER_NAMES = frozenset(
    {
        "authorization",
        "proxy-authorization",
        "x-api-key",
        "x-auth-token",
        "x-webhook-secret",
        "cookie",
    }
)


def validate_legacy_webhook_url(value: Any) -> str:
    """Use the governed event endpoint policy for compatibility webhooks."""
    try:
        return validate_webhook_url(str(value or ""))
    except ValueError as exc:
        raise ValueError(str(exc)) from exc


def redact_webhook_for_response(document: dict[str, Any]) -> dict[str, Any]:
    """Return configuration metadata without ever returning delivery secrets."""
    item = {key: value for key, value in document.items() if key not in {"_id", "secret"}}
    headers = item.get("headers")
    if isinstance(headers, dict):
        item["headers"] = {
            str(key): ("[configured]" if str(key).lower() in _SENSITIVE_HEADER_NAMES else value)
            for key, value in headers.items()
        }
    return item
