"""Typed failures for the Yeastar voice integration.

Every PBX or fleet call raises through this module so a provider problem
becomes an actionable, category-tagged message instead of an opaque 500.  The
category is part of the contract: routers map it to a status code and the UI
maps it to guidance, so the set stays small and closed.
"""
from __future__ import annotations

from typing import Any

# Categories callers may branch on. ``test_yeastar_client`` asserts this stays
# closed so a new failure mode is added deliberately rather than by typo.
CATEGORIES = frozenset(
    {
        "configuration",
        "authentication",
        "connection",
        "timeout",
        "tls",
        "endpoint",
        "http",
        "api",
        "not_found",
        "unknown",
    }
)

# Provider categories that mean "the operator must change configuration"
# rather than "the PBX had a bad moment".
OPERATOR_ACTION_CATEGORIES = frozenset(
    {"configuration", "authentication", "tls", "endpoint", "not_found"}
)


class YeastarError(RuntimeError):
    """A Yeastar PBX or fleet call failed in a way the caller must explain."""

    def __init__(
        self,
        message: str,
        category: str = "api",
        *,
        status_code: int = 0,
        errcode: Any = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.category = category if category in CATEGORIES else "unknown"
        self.status_code = int(status_code or 0)
        self.errcode = errcode

    def __str__(self) -> str:
        return self.message

    @property
    def needs_operator_action(self) -> bool:
        """True when retrying cannot help until someone changes the config."""
        return self.category in OPERATOR_ACTION_CATEGORIES


def http_status_for(error: YeastarError) -> int:
    """Map a provider failure onto the status the Nexus API should return."""
    if error.category == "not_found":
        return 404
    if error.category in {"configuration", "authentication", "tls", "endpoint"}:
        return 400
    if error.category == "timeout":
        return 504
    return 502


def provider_error(payload: dict) -> YeastarError:
    """Translate a Yeastar error envelope into a categorised error.

    Yeastar returns ``{"errcode": 0, "errmsg": ...}`` on success.  Any other
    code is a provider-side rejection; the message is surfaced verbatim because
    technicians reconcile it against the PBX web UI.
    """
    code = payload.get("errcode")
    message = str(payload.get("errmsg") or "unknown error")
    lowered = message.lower()
    if "token" in lowered or "auth" in lowered or "password" in lowered:
        category = "authentication"
    elif "permission" in lowered or "denied" in lowered or "forbidden" in lowered:
        category = "authentication"
    elif "not exist" in lowered or "not found" in lowered or "no such" in lowered:
        category = "not_found"
    else:
        category = "api"
    return YeastarError(
        f"Yeastar API check failed ({message}, error {code}).",
        category,
        errcode=code,
    )
