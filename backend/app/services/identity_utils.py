"""Canonical identity-label helpers (variant-helper consolidation).

Replaces duplicated per-router ``_tenant_id`` and ``_actor`` definitions whose
bodies were byte-identical or differed only in the fallback label. Router
modules import them under their historical local names so call sites stay
unchanged:

    from app.services.identity_utils import tenant_id_or_none as _tenant_id

Callers whose contract genuinely differs (fallback-specific tenant defaults,
actor chains without an id fallback) keep their local definitions.
"""

from typing import Any


def tenant_id_or_none(value: Any) -> str | None:
    """Normalise a tenant id to a stripped string, or None when blank."""
    tenant_id = str(value or "").strip()
    return tenant_id or None


def actor_label(user: dict, fallback: str) -> str:
    """Human-readable actor label: name, then email, then id, then fallback."""
    return user.get("name") or user.get("email") or user.get("id") or fallback
