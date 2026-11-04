"""Legacy document-branding compatibility endpoints.

The canonical customer-document path is Organisation Branding plus the
commercial document-template studio.  These endpoints remain for existing
Finance Center data, but are protected as global configuration and must not be
presented as the renderer used for standard invoices.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from datetime import datetime, timezone
from html import escape
import re
from app.database import db
from app.auth import get_current_user
from app.services.action_permissions import require_action
from app.services.activity import log_activity
from app.services.scope_permissions import assert_global_scope
import uuid

router = APIRouter(prefix="/doc-branding", tags=["doc-branding"])

DEFAULT_TEMPLATES = {
    "professional": {
        "id": "tpl-professional",
        "name": "Professional",
        "description": "Clean corporate layout with accent header bar",
        "is_default": True,
        "header_style": "bar",
        "color_scheme": {"primary": "#1a56db", "secondary": "#8b5cf6", "accent": "#06b6d4", "text": "#1f2937", "background": "#ffffff"},
        "font_family": "Helvetica",
        "logo_position": "left",
        "show_watermark": False,
        "footer_text": "",
        "layout": "standard",
    },
    "modern": {
        "id": "tpl-modern",
        "name": "Modern Minimal",
        "description": "Sleek minimal design with bold typography",
        "is_default": False,
        "header_style": "minimal",
        "color_scheme": {"primary": "#111827", "secondary": "#6b7280", "accent": "#10b981", "text": "#374151", "background": "#ffffff"},
        "font_family": "Helvetica",
        "logo_position": "center",
        "show_watermark": False,
        "footer_text": "",
        "layout": "modern",
    },
    "corporate": {
        "id": "tpl-corporate",
        "name": "Corporate",
        "description": "Traditional business look with structured header",
        "is_default": False,
        "header_style": "full",
        "color_scheme": {"primary": "#1e3a5f", "secondary": "#2d5986", "accent": "#d4a853", "text": "#1f2937", "background": "#ffffff"},
        "font_family": "Times",
        "logo_position": "left",
        "show_watermark": True,
        "footer_text": "",
        "layout": "corporate",
    },
    "tech": {
        "id": "tpl-tech",
        "name": "Tech Forward",
        "description": "Dark-themed tech-forward template for MSPs",
        "is_default": False,
        "header_style": "gradient",
        "color_scheme": {"primary": "#06b6d4", "secondary": "#8b5cf6", "accent": "#10b981", "text": "#e5e7eb", "background": "#0f172a"},
        "font_family": "Courier",
        "logo_position": "left",
        "show_watermark": False,
        "footer_text": "",
        "layout": "tech",
    },
}

DOC_TYPES = ["invoice", "purchase_order", "estimate", "letterhead"]
LEGACY_BRANDING_GUIDANCE = (
    "These legacy Finance Center preferences do not control standard invoice PDFs. "
    "Use Organisation Branding and the document template studio for customer documents."
)
_HEX_COLOR_RE = re.compile(r"^#?[0-9a-fA-F]{6}$")


async def _require_global_legacy_branding_scope(
    current_user: dict,
    request: Request | None,
    operation: str,
) -> None:
    """Legacy branding records are organisation-wide commercial configuration."""
    await assert_global_scope(current_user, operation=operation, request=request)


def _preview_text(value: object, fallback: str) -> str:
    """Escape stored legacy data before it reaches the HTML preview sink."""
    return escape(str(value or fallback), quote=True)


def _safe_preview_color(value: object, fallback: str) -> str:
    candidate = str(value or "").strip()
    if _HEX_COLOR_RE.fullmatch(candidate):
        return f"#{candidate.lstrip('#')}"
    return fallback


def _safe_preview_font(value: object) -> str:
    return value if isinstance(value, str) and value in {"Helvetica", "Times", "Courier"} else "Helvetica"


def _safe_preview_header_style(value: object) -> str:
    return value if isinstance(value, str) and value in {"bar", "minimal", "gradient", "full"} else "bar"


@router.get(
    "/templates",
    dependencies=[Depends(require_action("platform.configuration.manage"))],
)
async def get_branding_templates(
    current_user: dict = Depends(get_current_user),
    request: Request = None,
):
    """Get all built-in and custom branding templates"""
    await _require_global_legacy_branding_scope(
        current_user, request, "commercial_document.legacy_branding.template.list"
    )
    custom = await db.doc_branding_templates.find({}, {"_id": 0}).to_list(50)
    builtin = [{"type": "builtin", **v} for v in DEFAULT_TEMPLATES.values()]
    return {"builtin": builtin, "custom": custom}


@router.post(
    "/templates",
    dependencies=[Depends(require_action("platform.configuration.manage"))],
)
async def create_custom_template(
    data: dict,
    current_user: dict = Depends(get_current_user),
    request: Request = None,
):
    """Create a custom branding template"""
    await _require_global_legacy_branding_scope(
        current_user, request, "commercial_document.legacy_branding.template.create"
    )
    if not isinstance(data, dict):
        raise HTTPException(status_code=422, detail="Template payload must be an object")
    now = datetime.now(timezone.utc).isoformat()
    template = {
        "id": f"TPL-{uuid.uuid4().hex[:6].upper()}",
        "type": "custom",
        "name": data.get("name", "Custom Template"),
        "description": data.get("description", ""),
        "is_default": False,
        "header_style": data.get("header_style", "bar"),
        "color_scheme": data.get("color_scheme", DEFAULT_TEMPLATES["professional"]["color_scheme"]),
        "font_family": data.get("font_family", "Helvetica"),
        "logo_position": data.get("logo_position", "left"),
        "show_watermark": data.get("show_watermark", False),
        "footer_text": data.get("footer_text", ""),
        "layout": data.get("layout", "standard"),
        "created_at": now,
        "created_by": current_user.get("name", "Admin"),
    }
    await db.doc_branding_templates.insert_one(template)
    template.pop("_id", None)
    await log_activity(
        current_user,
        "created",
        "legacy_document_branding_template",
        template["id"],
        template["name"],
        "Created a legacy document-branding compatibility template",
        metadata={"deprecated": True},
    )
    return {**template, "deprecated": True, "guidance": LEGACY_BRANDING_GUIDANCE}


@router.put(
    "/templates/{template_id}",
    dependencies=[Depends(require_action("platform.configuration.manage"))],
)
async def update_template(
    template_id: str,
    data: dict,
    current_user: dict = Depends(get_current_user),
    request: Request = None,
):
    """Update a custom branding template"""
    await _require_global_legacy_branding_scope(
        current_user, request, "commercial_document.legacy_branding.template.update"
    )
    if not isinstance(data, dict):
        raise HTTPException(status_code=422, detail="Template payload must be an object")
    existing = await db.doc_branding_templates.find_one({"id": template_id}, {"_id": 0, "name": 1})
    if not existing:
        raise HTTPException(status_code=404, detail="Template not found")
    updates = {}
    for key in ["name", "description", "header_style", "color_scheme", "font_family", "logo_position", "show_watermark", "footer_text", "layout"]:
        if key in data:
            updates[key] = data[key]
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.doc_branding_templates.update_one({"id": template_id}, {"$set": updates})
    updated = await db.doc_branding_templates.find_one({"id": template_id}, {"_id": 0})
    await log_activity(
        current_user,
        "updated",
        "legacy_document_branding_template",
        template_id,
        existing.get("name") or "Legacy document branding template",
        "Updated a legacy document-branding compatibility template",
        metadata={"fields": sorted(key for key in updates if key != "updated_at"), "deprecated": True},
    )
    return {**updated, "deprecated": True, "guidance": LEGACY_BRANDING_GUIDANCE}


@router.delete(
    "/templates/{template_id}",
    dependencies=[Depends(require_action("platform.configuration.manage"))],
)
async def delete_template(
    template_id: str,
    current_user: dict = Depends(get_current_user),
    request: Request = None,
):
    """Delete a custom branding template"""
    await _require_global_legacy_branding_scope(
        current_user, request, "commercial_document.legacy_branding.template.delete"
    )
    existing = await db.doc_branding_templates.find_one({"id": template_id}, {"_id": 0, "name": 1})
    if not existing:
        raise HTTPException(status_code=404, detail="Template not found")
    result = await db.doc_branding_templates.delete_one({"id": template_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Template not found")
    await log_activity(
        current_user,
        "deleted",
        "legacy_document_branding_template",
        template_id,
        existing.get("name") or "Legacy document branding template",
        "Deleted a legacy document-branding compatibility template",
        metadata={"deprecated": True},
    )
    return {"message": "Template deleted", "deprecated": True, "guidance": LEGACY_BRANDING_GUIDANCE}


@router.get(
    "/settings",
    dependencies=[Depends(require_action("platform.configuration.manage"))],
)
async def get_branding_settings(
    current_user: dict = Depends(get_current_user),
    request: Request = None,
):
    """Get the active branding settings for each doc type"""
    await _require_global_legacy_branding_scope(
        current_user, request, "commercial_document.legacy_branding.settings.read"
    )
    settings = await db.doc_branding_settings.find({}, {"_id": 0}).to_list(10)
    # Index by doc_type
    by_type = {s["doc_type"]: s for s in settings}
    result = {}
    for dt in DOC_TYPES:
        result[dt] = by_type.get(dt, {
            "doc_type": dt,
            "active_template_id": "tpl-professional",
            "company_name": "",
            "company_address": "",
            "company_phone": "",
            "company_email": "",
            "company_website": "",
            "company_abn": "",
            "logo_url": "",
            "footer_text": "",
            "payment_instructions": "",
            "bank_details": "",
            "terms_conditions": "",
        })
    return result


@router.put(
    "/settings/{doc_type}",
    dependencies=[Depends(require_action("platform.configuration.manage"))],
)
async def update_branding_settings(
    doc_type: str,
    data: dict,
    current_user: dict = Depends(get_current_user),
    request: Request = None,
):
    """Update branding settings for a specific doc type"""
    await _require_global_legacy_branding_scope(
        current_user, request, "commercial_document.legacy_branding.settings.update"
    )
    if doc_type not in DOC_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid doc type. Must be one of: {DOC_TYPES}")
    if not isinstance(data, dict):
        raise HTTPException(status_code=422, detail="Branding payload must be an object")

    now = datetime.now(timezone.utc).isoformat()
    settings = {
        "doc_type": doc_type,
        "active_template_id": data.get("active_template_id", "tpl-professional"),
        "company_name": data.get("company_name", ""),
        "company_address": data.get("company_address", ""),
        "company_phone": data.get("company_phone", ""),
        "company_email": data.get("company_email", ""),
        "company_website": data.get("company_website", ""),
        "company_abn": data.get("company_abn", ""),
        "logo_url": data.get("logo_url", ""),
        "footer_text": data.get("footer_text", ""),
        "payment_instructions": data.get("payment_instructions", ""),
        "bank_details": data.get("bank_details", ""),
        "terms_conditions": data.get("terms_conditions", ""),
        "updated_at": now,
        "updated_by": current_user.get("name", "Admin"),
    }

    await db.doc_branding_settings.update_one(
        {"doc_type": doc_type},
        {"$set": settings},
        upsert=True
    )
    await log_activity(
        current_user,
        "updated",
        "legacy_document_branding_settings",
        doc_type,
        doc_type.replace("_", " ").title(),
        "Updated legacy document-branding compatibility settings",
        metadata={"doc_type": doc_type, "deprecated": True},
    )
    return {**settings, "deprecated": True, "guidance": LEGACY_BRANDING_GUIDANCE}


@router.get(
    "/preview/{template_id}",
    dependencies=[Depends(require_action("platform.configuration.manage"))],
)
async def preview_template(
    template_id: str,
    doc_type: str = "invoice",
    current_user: dict = Depends(get_current_user),
    request: Request = None,
):
    """Generate a preview of a template with sample data"""
    await _require_global_legacy_branding_scope(
        current_user, request, "commercial_document.legacy_branding.preview"
    )
    if doc_type not in DOC_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid doc type. Must be one of: {DOC_TYPES}")
    # Get template
    if template_id.startswith("tpl-"):
        key = template_id.replace("tpl-", "")
        template = DEFAULT_TEMPLATES.get(key)
        if not template:
            raise HTTPException(status_code=404, detail="Template not found")
    else:
        template = await db.doc_branding_templates.find_one({"id": template_id}, {"_id": 0})
        if not template:
            raise HTTPException(status_code=404, detail="Template not found")

    # Get settings
    settings = await db.doc_branding_settings.find_one({"doc_type": doc_type}, {"_id": 0})

    sample_preview = {
        "template": template,
        "settings": settings,
        "preview_html": _generate_preview_html(template, settings, doc_type),
    }
    return sample_preview


def _generate_preview_html(template: dict, settings: dict, doc_type: str) -> str:
    """Generate an escaped HTML preview of a legacy document template."""
    colors = template.get("color_scheme", {})
    primary = _safe_preview_color(colors.get("primary"), "#1a56db")
    secondary = _safe_preview_color(colors.get("secondary"), "#8b5cf6")
    accent = _safe_preview_color(colors.get("accent"), "#06b6d4")
    bg = _safe_preview_color(colors.get("background"), "#ffffff")
    text_color = _safe_preview_color(colors.get("text"), "#1f2937")
    company = _preview_text((settings or {}).get("company_name"), "Your Company Name")
    address = _preview_text((settings or {}).get("company_address"), "123 Business St, Suite 100")
    phone = _preview_text((settings or {}).get("company_phone"), "+1 (555) 000-0000")
    email = _preview_text((settings or {}).get("company_email"), "accounts@company.com")
    footer = _preview_text((settings or {}).get("footer_text"), "Thank you for your business")
    font_family = _safe_preview_font(template.get("font_family"))

    doc_label = escape(doc_type.replace("_", " ").upper(), quote=True)
    if doc_type == "letterhead":
        doc_label = ""

    header_style = _safe_preview_header_style(template.get("header_style"))
    header_html = ""
    if header_style == "bar":
        header_html = f'<div style="background:{primary};padding:20px 28px;color:#fff"><div style="font-size:20px;font-weight:bold">{company}</div><div style="font-size:11px;opacity:0.8;margin-top:4px">{address}</div></div><div style="background:{accent};height:3px"></div>'
    elif header_style == "minimal":
        header_html = f'<div style="padding:28px;border-bottom:2px solid {primary}"><div style="font-size:22px;font-weight:bold;color:{primary}">{company}</div><div style="font-size:11px;color:{secondary};margin-top:4px">{address} | {phone} | {email}</div></div>'
    elif header_style == "gradient":
        header_html = f'<div style="background:linear-gradient(135deg,{primary},{secondary});padding:24px 28px;color:#fff"><div style="font-size:20px;font-weight:bold">{company}</div><div style="font-size:11px;opacity:0.8;margin-top:4px">{address}</div></div>'
    else:
        header_html = f'<div style="background:{primary};padding:24px 28px;color:#fff"><div style="font-size:20px;font-weight:bold">{company}</div><div style="font-size:11px;opacity:0.8;margin-top:4px">{address} | {phone}</div></div>'

    return f"""
    <div style="max-width:600px;margin:0 auto;background:{bg};border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-family:{font_family},Arial,sans-serif">
      {header_html}
      <div style="padding:28px;color:{text_color}">
        {"" if not doc_label else f'<div style="text-align:right;font-size:28px;font-weight:bold;color:{primary};margin-bottom:20px">{doc_label}</div>'}
        <div style="display:flex;justify-content:space-between;margin-bottom:24px">
          <div><p style="font-size:12px;color:{secondary};text-transform:uppercase;letter-spacing:1px;margin:0 0 4px">Bill To</p><p style="margin:0;font-weight:bold">Sample Client Pty Ltd</p><p style="margin:2px 0;font-size:13px;color:#666">456 Client Ave</p></div>
          <div style="text-align:right"><p style="font-size:12px;color:{secondary};text-transform:uppercase;letter-spacing:1px;margin:0 0 4px">Details</p><p style="margin:0;font-size:13px"><strong>Number:</strong> INV-001</p><p style="margin:2px 0;font-size:13px"><strong>Date:</strong> 2026-02-01</p><p style="margin:2px 0;font-size:13px"><strong>Due:</strong> 2026-03-01</p></div>
        </div>
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
          <thead><tr style="background:{primary}10"><th style="padding:10px;text-align:left;font-size:12px;color:{primary};border-bottom:2px solid {primary}30">Description</th><th style="padding:10px;text-align:center;font-size:12px;color:{primary};border-bottom:2px solid {primary}30">Qty</th><th style="padding:10px;text-align:right;font-size:12px;color:{primary};border-bottom:2px solid {primary}30">Rate</th><th style="padding:10px;text-align:right;font-size:12px;color:{primary};border-bottom:2px solid {primary}30">Amount</th></tr></thead>
          <tbody>
            <tr><td style="padding:10px;border-bottom:1px solid #eee;font-size:13px">Managed IT Support - Monthly</td><td style="padding:10px;text-align:center;border-bottom:1px solid #eee;font-size:13px">1</td><td style="padding:10px;text-align:right;border-bottom:1px solid #eee;font-size:13px">$2,500.00</td><td style="padding:10px;text-align:right;border-bottom:1px solid #eee;font-size:13px">$2,500.00</td></tr>
            <tr><td style="padding:10px;border-bottom:1px solid #eee;font-size:13px">Network Monitoring</td><td style="padding:10px;text-align:center;border-bottom:1px solid #eee;font-size:13px">1</td><td style="padding:10px;text-align:right;border-bottom:1px solid #eee;font-size:13px">$800.00</td><td style="padding:10px;text-align:right;border-bottom:1px solid #eee;font-size:13px">$800.00</td></tr>
            <tr><td style="padding:10px;border-bottom:1px solid #eee;font-size:13px">Backup as a Service</td><td style="padding:10px;text-align:center;border-bottom:1px solid #eee;font-size:13px">5</td><td style="padding:10px;text-align:right;border-bottom:1px solid #eee;font-size:13px">$50.00</td><td style="padding:10px;text-align:right;border-bottom:1px solid #eee;font-size:13px">$250.00</td></tr>
          </tbody>
        </table>
        <div style="text-align:right;margin-bottom:20px">
          <p style="margin:4px 0;font-size:13px">Subtotal: <strong>$3,550.00</strong></p>
          <p style="margin:4px 0;font-size:13px">GST (10%): <strong>$355.00</strong></p>
          <p style="margin:8px 0 0;font-size:18px;font-weight:bold;color:{primary}">Total: $3,905.00</p>
        </div>
        <div style="border-top:1px solid #eee;padding-top:16px;text-align:center;font-size:12px;color:#888">{footer}</div>
      </div>
    </div>
    """
