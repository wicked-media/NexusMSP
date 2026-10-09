"""Response hygiene for provider connection configuration."""

from __future__ import annotations

from typing import Any


_CONNECTION_SECRET_FIELDS = frozenset({
    "client_secret", "access_token", "refresh_token", "api_key", "webhook_key", "webhook_secret",
})


def redact_connection_settings(document: dict[str, Any] | None) -> dict[str, Any]:
    """Return connection state without serialising provider credentials."""
    return {key: value for key, value in (document or {}).items() if key not in _CONNECTION_SECRET_FIELDS and key != "_id"}
