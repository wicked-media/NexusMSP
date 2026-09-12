"""Validation and document-update helpers for embedded client contacts."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException


MAX_CONTACTS_PER_CLIENT = 100
CONTACT_ROLES = frozenset({"general", "technical", "billing", "authorised"})
CONTACT_TEXT_LIMITS = {"name": 240, "email": 320, "phone": 80}


def _text(value: Any, field: str) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        raise HTTPException(status_code=422, detail=f"{field.capitalize()} must be text")
    cleaned = value.strip()
    if len(cleaned) > CONTACT_TEXT_LIMITS[field]:
        raise HTTPException(status_code=422, detail=f"{field.capitalize()} is too long")
    return cleaned


def editable_contact(data: Any, existing: dict | None = None) -> dict:
    """Return only editable contact fields; identity and audit fields are server-owned."""
    if not isinstance(data, dict):
        raise HTTPException(status_code=422, detail="Contact details must be an object")
    prior = existing or {}
    contact = {
        field: _text(data[field] if field in data else prior.get(field, ""), field)
        for field in CONTACT_TEXT_LIMITS
    }
    if not contact["name"]:
        raise HTTPException(status_code=422, detail="Contact name is required")
    role = data["role"] if "role" in data else prior.get("role", "general")
    if not isinstance(role, str) or role not in CONTACT_ROLES:
        raise HTTPException(status_code=422, detail="Contact role is invalid")
    contact["role"] = role
    primary = data["is_primary"] if "is_primary" in data else prior.get("is_primary", False)
    if not isinstance(primary, bool):
        raise HTTPException(status_code=422, detail="Primary contact must be true or false")
    contact["is_primary"] = primary
    return contact


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def contact_map_pipeline(contact_id: str, replacement: dict) -> list[dict]:
    """Atomically replace a contact and clear other primary flags when required."""
    clear_other_primaries = replacement["is_primary"]
    return [{"$set": {"contacts": {"$map": {
        "input": {"$ifNull": ["$contacts", []]},
        "as": "contact",
        "in": {"$cond": [
            {"$eq": ["$$contact.id", contact_id]},
            {"$literal": replacement},
            {"$cond": [
                clear_other_primaries,
                {"$mergeObjects": ["$$contact", {"is_primary": False}]},
                "$$contact",
            ]},
        ]},
    }}}}]


def contact_delete_pipeline(contact_id: str, promoted_contact_id: str | None) -> list[dict]:
    """Remove one contact and, when needed, nominate the next primary atomically."""
    remaining = {"$filter": {
        "input": {"$ifNull": ["$contacts", []]},
        "as": "contact",
        "cond": {"$ne": ["$$contact.id", {"$literal": contact_id}]},
    }}
    if not promoted_contact_id:
        return [{"$set": {"contacts": remaining}}]
    return [{"$set": {"contacts": {"$map": {
        "input": remaining,
        "as": "contact",
        "in": {"$cond": [
            {"$eq": ["$$contact.id", {"$literal": promoted_contact_id}]},
            {"$mergeObjects": ["$$contact", {"is_primary": True}]},
            "$$contact",
        ]},
    }}}}]
