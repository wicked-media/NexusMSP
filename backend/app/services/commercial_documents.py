"""Shared commercial-document configuration and immutable render evidence.

Invoices and purchase orders are different operational records, but the way
Nexus presents them to customers and suppliers must be governed consistently.
This module deliberately owns only presentation metadata.  It never owns a
financial value, approval state, document number, or vendor/client identity.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import re
from typing import Any

from fastapi import HTTPException

from app.database import db


COMMERCIAL_DOCUMENT_TYPES = frozenset({"invoice", "purchase_order"})
PROFILE_SETTINGS_PREFIX = "commercial_document_profile:"
RENDERER_VERSION = "nexus-commercial-v1"

_SAFE_BRANDING_FIELDS = (
    "company_name",
    "company_logo_url",
    "invoice_logo_url",
    "primary_color",
    "accent_color",
    "document_theme",
    "address",
    "contact_email",
    "contact_phone",
    "abn",
    "tax_id",
)

_DEFAULT_PROFILES: dict[str, dict[str, str]] = {
    "invoice": {
        "label": "Tax Invoice",
        "subtitle": "",
        "terms": "",
        "footer": "This invoice is a retained NexusMSP commercial record. Please quote the invoice number with any enquiry.",
    },
    "purchase_order": {
        "label": "Purchase Order",
        "subtitle": "",
        "terms": "",
        "footer": "This purchase order is a retained NexusMSP procurement record. Validate supplier acceptance before fulfilment.",
    },
}


_PROFILE_TEXT_KEYS = ("label", "subtitle", "terms", "footer")

# Template Studio remains deliberately expressive, but the commercial renderer
# has a smaller, safer contract than the legacy free-form PDF renderer.  These
# are the optional content blocks that map directly to retained evidence
# sections in invoices and purchase orders.  Financial facts, identity and
# audit sections remain server-owned and cannot be removed or reworded.
_TEMPLATE_EVIDENCE_SECTIONS = (
    ("bank_details", "Remittance details"),
    ("signature", "Authorisation"),
    ("custom_html", "Additional information"),
    ("thank_you", "A note from our team"),
)


def _assert_document_type(document_type: str) -> str:
    value = str(document_type or "").strip().lower()
    if value not in COMMERCIAL_DOCUMENT_TYPES:
        raise HTTPException(400, f"document_type must be one of {sorted(COMMERCIAL_DOCUMENT_TYPES)}")
    return value


def _profile_key(document_type: str) -> str:
    return f"{PROFILE_SETTINGS_PREFIX}{_assert_document_type(document_type)}"


def _default_template_key(document_type: str) -> str:
    # Kept in step with the existing Template Studio default pointer.  The
    # pointer is the authoritative default selection; legacy is_default flags
    # remain a compatibility projection only.
    return f"invoice_template_default:{_assert_document_type(document_type)}"


def _clean_text(value: Any, *, field: str, maximum: int, multiline: bool = False) -> str:
    text = str(value or "").replace("\x00", "").strip()
    if not multiline:
        text = " ".join(text.split())
    else:
        text = "\n".join(line.rstrip() for line in text.splitlines()).strip()
    if len(text) > maximum:
        raise HTTPException(422, detail=f"{field} must be {maximum} characters or fewer")
    return text


def _repository(database: Any | None = None) -> Any:
    """Use an explicit repository for composed domain operations when supplied."""
    return database if database is not None else db


async def _resolve_template(
    template_id: str,
    document_type: str,
    *,
    database: Any | None = None,
) -> dict[str, Any] | None:
    if not template_id:
        return None
    template = await _repository(database).invoice_pdf_templates.find_one(
        {"id": template_id, "doc_type": document_type},
        {"_id": 0},
    )
    if not template:
        raise HTTPException(422, detail="The selected document template is unavailable for this document type")
    return template


async def normalise_document_customisation(
    data: dict[str, Any],
    document_type: str,
    *,
    partial: bool = True,
    database: Any | None = None,
) -> dict[str, Any]:
    """Validate draft-only per-document presentation fields.

    We intentionally accept only typed text and a governed Template Studio ID;
    arbitrary HTML/CSS is not a safe commercial-document contract.
    """
    _assert_document_type(document_type)
    if not isinstance(data, dict):
        raise HTTPException(422, detail="Document customisation must be an object")

    result: dict[str, Any] = {}
    fields = {
        "document_label": ("Document label", 120, False),
        "document_terms": ("Document terms", 5000, True),
    }
    for key, (label, maximum, multiline) in fields.items():
        if key in data:
            result[key] = _clean_text(data.get(key), field=label, maximum=maximum, multiline=multiline) or None
        elif not partial:
            result[key] = None

    if "document_template_id" in data:
        template_id = str(data.get("document_template_id") or "").strip()
        if template_id and not re.fullmatch(r"[A-Za-z0-9_-]{1,120}", template_id):
            raise HTTPException(422, detail="Document template ID is invalid")
        if template_id:
            await _resolve_template(template_id, document_type, database=database)
        result["document_template_id"] = template_id or None
    elif not partial:
        result["document_template_id"] = None
    return result


async def get_commercial_document_profile(
    document_type: str,
    *,
    database: Any | None = None,
) -> dict[str, Any]:
    """Return the organisation-wide presentation defaults for a document kind."""
    document_type = _assert_document_type(document_type)
    stored = await _repository(database).settings.find_one({"key": _profile_key(document_type)}, {"_id": 0}) or {}
    value = stored.get("value") if isinstance(stored.get("value"), dict) else stored
    profile = deepcopy(_DEFAULT_PROFILES[document_type])
    for key in (*_PROFILE_TEXT_KEYS, "template_id"):
        if key in value and value.get(key) is not None:
            profile[key] = str(value.get(key) or "")
    return {
        "document_type": document_type,
        "profile": profile,
        "revision": int(stored.get("revision") or 0),
        "updated_at": stored.get("updated_at"),
        "updated_by": stored.get("updated_by"),
    }


async def save_commercial_document_profile(
    document_type: str,
    data: dict[str, Any],
    *,
    actor: dict[str, Any],
    database: Any | None = None,
) -> dict[str, Any]:
    """Persist an organisation-wide, versioned commercial-document profile."""
    document_type = _assert_document_type(document_type)
    if not isinstance(data, dict):
        raise HTTPException(422, detail="Document profile must be an object")

    repository = _repository(database)
    current = await get_commercial_document_profile(document_type, database=repository)
    requested = data.get("profile") if isinstance(data.get("profile"), dict) else data
    profile = dict(current["profile"])
    for key, field, maximum, multiline in (
        ("label", "Document label", 120, False),
        ("subtitle", "Document subtitle", 240, False),
        ("terms", "Document terms", 5000, True),
        ("footer", "Document footer", 1000, True),
    ):
        if key in requested:
            profile[key] = _clean_text(requested.get(key), field=field, maximum=maximum, multiline=multiline)
    if "template_id" in requested:
        template_id = str(requested.get("template_id") or "").strip()
        if template_id and not re.fullmatch(r"[A-Za-z0-9_-]{1,120}", template_id):
            raise HTTPException(422, detail="Document template ID is invalid")
        if template_id:
            await _resolve_template(template_id, document_type, database=repository)
        profile["template_id"] = template_id

    now = datetime.now(timezone.utc).isoformat()
    revision = int(current["revision"] or 0) + 1
    await repository.settings.update_one(
        {"key": _profile_key(document_type)},
        {"$set": {
            "key": _profile_key(document_type),
            "value": profile,
            "revision": revision,
            "updated_at": now,
            "updated_by": actor.get("id"),
            "updated_by_name": actor.get("name") or actor.get("email") or "NexusMSP",
        }},
        upsert=True,
    )
    return {
        "document_type": document_type,
        "profile": profile,
        "revision": revision,
        "updated_at": now,
        "updated_by": actor.get("name") or actor.get("email") or "NexusMSP",
    }


def _snapshot_branding(branding: dict[str, Any] | None) -> dict[str, Any]:
    source = branding or {}
    return {key: deepcopy(source[key]) for key in _SAFE_BRANDING_FIELDS if source.get(key) not in (None, "")}


async def get_commercial_document_branding(*, database: Any | None = None) -> dict[str, Any]:
    """Load the existing organisation branding through one compatibility path.

    Branding remains owned by the established settings records.  This helper
    does not create a second settings model; it simply ensures every document
    route resolves the same preferred record and legacy fallback.
    """
    repository = _repository(database)
    branding = await repository.settings.find_one({"type": "branding"}, {"_id": 0}) or {}
    if branding:
        return branding
    legacy = await repository.settings.find_one({"key": "whitelabel_options"}, {"_id": 0}) or {}
    value = legacy.get("value") if isinstance(legacy.get("value"), dict) else legacy
    return value or {}


async def _stored_profile_values(
    document_type: str,
    *,
    database: Any | None = None,
) -> dict[str, Any]:
    """Return only explicitly stored organisation settings.

    The renderer needs to distinguish an administrator's deliberate choice
    from a built-in fallback.  Otherwise a built-in ``Tax Invoice`` label
    would unintentionally hide a selected template's header text.
    """
    stored = await _repository(database).settings.find_one({"key": _profile_key(document_type)}, {"_id": 0}) or {}
    value = stored.get("value") if isinstance(stored.get("value"), dict) else stored
    return {
        key: str(value.get(key) or "")
        for key in (*_PROFILE_TEXT_KEYS, "template_id")
        if key in value and value.get(key) is not None
    }


def _template_block_content(template: dict[str, Any], block_key: str) -> str:
    """Read one text block from a Template Studio document safely."""
    for block in template.get("blocks") or []:
        if not isinstance(block, dict) or block.get("key") != block_key or not block.get("enabled"):
            continue
        content = block.get("content")
        if content not in (None, ""):
            return str(content)
    return ""


def _render_template_text(value: str, document: dict[str, Any], branding: dict[str, Any]) -> str:
    """Resolve the small, safe merge-tag surface used by commercial PDFs.

    We deliberately do not evaluate arbitrary expressions or HTML.  Template
    text remains printable content and the final renderer escapes it again.
    """
    record = document or {}
    replacements = {
        "{{company_name}}": str(branding.get("company_name") or "NexusMSP"),
        "{{company_email}}": str(branding.get("contact_email") or ""),
        "{{company_phone}}": str(branding.get("contact_phone") or ""),
        "{{invoice_number}}": str(record.get("invoice_number") or ""),
        "{{po_number}}": str(record.get("po_number") or ""),
        "{{client_name}}": str(record.get("client_name") or ""),
        "{{vendor_name}}": str(record.get("vendor") or ""),
        "{{due_date}}": str(record.get("due_date") or ""),
        "{{issue_date}}": str(record.get("issued_date") or record.get("created_at") or ""),
        "{{terms_days}}": str(record.get("payment_terms_days") or branding.get("payment_terms_days") or ""),
        "{{abn}}": str(branding.get("abn") or branding.get("tax_id") or ""),
        "{{bank_name}}": str(branding.get("bank_name") or ""),
        "{{account_name}}": str(branding.get("account_name") or ""),
        "{{bsb}}": str(branding.get("bsb") or ""),
        "{{account_number}}": str(branding.get("account_number") or ""),
        "{{tier_name}}": str(record.get("client_tier") or record.get("tier_name") or ""),
    }
    text = str(value or "")
    for token, replacement in replacements.items():
        text = text.replace(token, replacement)
    # Avoid a customer-facing PDF carrying a stale unknown merge token.
    return re.sub(r"\{\{[^{}]{1,80}\}\}", "", text).strip()


def _template_evidence_sections(template: dict[str, Any], document: dict[str, Any], branding: dict[str, Any]) -> list[dict[str, str]]:
    """Turn safe Template Studio text blocks into retained PDF sections.

    ``custom_html`` was historically a legacy FPDF text-only block.  Keep
    that contract: strip markup before it reaches the shared ReportLab
    renderer rather than interpreting user-provided HTML in a PDF path.
    """
    sections: list[dict[str, str]] = []
    for block_key, title in _TEMPLATE_EVIDENCE_SECTIONS:
        raw_content = _template_block_content(template, block_key)
        if block_key == "custom_html":
            raw_content = re.sub(r"<[^>]+>", "", raw_content)
        content = _render_template_text(raw_content, document, branding).strip()
        if content:
            sections.append({"title": title, "content": content[:5000]})
    return sections


async def resolve_commercial_document_render_context(
    document_type: str,
    document: dict[str, Any],
    branding: dict[str, Any] | None,
    *,
    include_global_profile: bool = True,
    database: Any | None = None,
) -> dict[str, Any]:
    """Resolve safe presentation metadata for preview, download and delivery.

    If the record has a frozen snapshot, it wins.  Draft records resolve the
    current per-record choice, organisation profile, then Template Studio
    default pointer in that order.
    """
    document_type = _assert_document_type(document_type)
    record = document or {}
    snapshot = record.get("document_snapshot")
    if isinstance(snapshot, dict) and snapshot.get("document_type") == document_type:
        return {
            "profile": deepcopy(snapshot.get("profile") or _DEFAULT_PROFILES[document_type]),
            "branding": deepcopy(snapshot.get("branding") or _snapshot_branding(branding)),
            "template": deepcopy(snapshot.get("template") or {}),
            "renderer_version": snapshot.get("renderer_version") or RENDERER_VERSION,
            "frozen": True,
        }

    repository = _repository(database)
    stored_profile = await _stored_profile_values(document_type, database=repository) if include_global_profile else {}
    profile = dict(_DEFAULT_PROFILES[document_type])
    template_id = str(record.get("document_template_id") or stored_profile.get("template_id") or "").strip()
    if not template_id and include_global_profile:
        pointer = await repository.settings.find_one(
            {"key": _default_template_key(document_type)}, {"_id": 0, "template_id": 1}
        ) or {}
        template_id = str(pointer.get("template_id") or "").strip()
    template = await _resolve_template(template_id, document_type, database=repository) if template_id else None

    if template:
        # Template studio values only affect presentation, never commercial
        # facts. Newer template fields are optional for backward compatibility.
        profile["template_id"] = template.get("id")
        profile["template_name"] = template.get("name")
        profile["template_revision"] = template.get("revision") or template.get("updated_at") or template.get("created_at")
        template_label = template.get("document_label") or _template_block_content(template, "header_banner")
        template_terms = template.get("terms_text") or _template_block_content(template, "payment_terms")
        template_footer = template.get("footer_text") or _template_block_content(template, "footer")
        if template_label:
            profile["label"] = _render_template_text(str(template_label), record, branding or {})
        if template_terms:
            profile["terms"] = _render_template_text(str(template_terms), record, branding or {})
        if template_footer:
            profile["footer"] = _render_template_text(str(template_footer), record, branding or {})
        extra_sections = _template_evidence_sections(template, record, branding or {})
        if extra_sections:
            profile["extra_sections"] = extra_sections
        for key in ("primary_color", "accent_color", "layout", "density"):
            if template.get(key):
                profile[key] = template.get(key)

    # Explicit organisation defaults deliberately override a template's copy
    # while still allowing the template to own its palette and layout.
    if include_global_profile:
        for key in _PROFILE_TEXT_KEYS:
            if key in stored_profile:
                profile[key] = stored_profile[key]
        if stored_profile.get("template_id"):
            profile["template_id"] = stored_profile["template_id"]

    if record.get("document_label"):
        profile["label"] = str(record.get("document_label"))
    if record.get("document_terms"):
        profile["terms"] = str(record.get("document_terms"))

    render_branding = dict(branding or {})
    if profile.get("primary_color"):
        render_branding["primary_color"] = profile["primary_color"]
    if profile.get("accent_color"):
        render_branding["accent_color"] = profile["accent_color"]
    if profile.get("layout"):
        render_branding["document_theme"] = "executive" if profile["layout"] in {"executive", "modern"} else "standard"
    if profile.get("density"):
        render_branding["document_density"] = profile["density"]

    return {
        "profile": profile,
        "branding": render_branding,
        "template": {
            "id": template.get("id"),
            "name": template.get("name"),
            "revision": profile.get("template_revision"),
        } if template else {},
        "renderer_version": RENDERER_VERSION,
        "frozen": False,
    }


async def freeze_commercial_document_snapshot(
    document_type: str,
    document: dict[str, Any],
    branding: dict[str, Any] | None,
    *,
    database: Any | None = None,
) -> dict[str, Any]:
    """Create non-secret render evidence when a document leaves draft state."""
    context = await resolve_commercial_document_render_context(
        document_type,
        document,
        branding,
        database=database,
    )
    if context["frozen"]:
        return deepcopy(document.get("document_snapshot"))
    return {
        "snapshot_version": 1,
        "document_type": _assert_document_type(document_type),
        "renderer_version": context["renderer_version"],
        "profile": deepcopy(context["profile"]),
        "template": deepcopy(context["template"]),
        "branding": _snapshot_branding(context["branding"]),
        "captured_at": datetime.now(timezone.utc).isoformat(),
    }
