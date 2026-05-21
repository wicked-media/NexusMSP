"""Invoice PDF Template Studio — visual block-based templates with merge tags,
designer gallery, drag-and-drop ordering, per-block styling, page settings,
new block types (signature, watermark, QR, payment_methods, time entries,
savings summary, custom HTML, page break, tax breakdown, divider, spacer),
and one-click clone from designer presets.

Templates live in db.invoice_pdf_templates:
  {
    id, name, description, doc_type: 'invoice'|'estimate'|'qbr'|'statement',
    layout: 'classic'|'minimal'|'bold'|'executive'|'tactical'|'modern',
    density: 'compact'|'standard'|'spacious',
    primary_color, accent_color, secondary_color,
    page: {
        orientation: 'P'|'L',
        paper_size: 'A4'|'Letter',
        margin_top, margin_bottom, margin_left, margin_right,
        font_family: 'Helvetica'|'Times'|'Courier',
        watermark_text, watermark_opacity,
    },
    blocks: [{key, enabled, order, content?, options?, style?}],
    is_default, is_preset, preset_key,
    created_at, created_by
  }
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from datetime import datetime, timezone
import os
import re
import uuid
import jwt

from app.database import db, JWT_SECRET, JWT_ALGORITHM
from app.auth import get_current_user

router = APIRouter()

# ───────────────────────────────────── Constants ─────────────────────────────────────

VALID_BLOCKS = [
    "logo", "header_banner", "company_info", "bill_to", "invoice_meta",
    "line_items", "time_entries_table", "tax_breakdown", "totals",
    "savings_summary", "payment_methods", "payment_terms", "notes",
    "bank_details", "qr_pay", "signature", "custom_html", "divider",
    "spacer", "page_break", "thank_you", "footer",
]
VALID_LAYOUTS = {"classic", "minimal", "bold", "executive", "tactical", "modern"}
VALID_DENSITIES = {"compact", "standard", "spacious"}
VALID_DOC_TYPES = {"invoice", "estimate", "qbr", "statement"}
EDITABLE_CONTENT_BLOCKS = {"payment_terms", "notes", "bank_details", "thank_you", "footer", "custom_html", "signature", "header_banner"}


def _default_blocks():
    """Sensible default blocks turned on for a new blank template."""
    presets = {
        "logo": {"enabled": True},
        "header_banner": {"enabled": False, "content": "INVOICE"},
        "company_info": {"enabled": True},
        "bill_to": {"enabled": True},
        "invoice_meta": {"enabled": True},
        "line_items": {"enabled": True},
        "time_entries_table": {"enabled": False},
        "tax_breakdown": {"enabled": False},
        "totals": {"enabled": True},
        "savings_summary": {"enabled": False},
        "payment_methods": {"enabled": False},
        "payment_terms": {"enabled": True, "content": "Payment due within {{terms_days}} days of invoice date."},
        "notes": {"enabled": False, "content": ""},
        "bank_details": {"enabled": False, "content": "Bank: {{bank_name}}\nBSB: {{bsb}}\nAccount: {{account_number}}\nReference: {{invoice_number}}"},
        "qr_pay": {"enabled": False},
        "signature": {"enabled": False, "content": "Authorised by {{company_name}}"},
        "custom_html": {"enabled": False, "content": ""},
        "divider": {"enabled": False},
        "spacer": {"enabled": False},
        "page_break": {"enabled": False},
        "thank_you": {"enabled": False, "content": "We appreciate your prompt payment."},
        "footer": {"enabled": True, "content": "Thank you for your business — {{company_name}}"},
    }
    return [{"key": k, "order": i, **presets[k]} for i, k in enumerate(VALID_BLOCKS)]


def _default_page():
    return {
        "orientation": "P", "paper_size": "A4",
        "margin_top": 18, "margin_bottom": 18, "margin_left": 15, "margin_right": 15,
        "font_family": "Helvetica",
        "watermark_text": "", "watermark_opacity": 0.08,
    }


# ───────────────────────────────────── Sanitization ─────────────────────────────────────

def _sanitize(data: dict, doc_type_required: bool = True) -> dict:
    out = {}
    for k in ("name", "description"):
        if k in data:
            out[k] = str(data[k]).strip()[:200]
    if "doc_type" in data:
        if data["doc_type"] not in VALID_DOC_TYPES:
            raise HTTPException(400, f"doc_type must be one of {sorted(VALID_DOC_TYPES)}")
        out["doc_type"] = data["doc_type"]
    elif doc_type_required:
        out["doc_type"] = "invoice"
    if "layout" in data:
        if data["layout"] not in VALID_LAYOUTS:
            raise HTTPException(400, f"layout must be one of {sorted(VALID_LAYOUTS)}")
        out["layout"] = data["layout"]
    if "density" in data:
        if data["density"] not in VALID_DENSITIES:
            raise HTTPException(400, f"density must be one of {sorted(VALID_DENSITIES)}")
        out["density"] = data["density"]
    for k in ("primary_color", "accent_color", "secondary_color"):
        if k in data and data[k]:
            v = str(data[k]).strip()
            if not re.match(r"^#?[0-9a-fA-F]{6}$", v):
                raise HTTPException(400, f"{k} must be a 6-digit hex color")
            out[k] = v if v.startswith("#") else f"#{v}"
    if "page" in data and isinstance(data["page"], dict):
        page = {}
        p = data["page"]
        if p.get("orientation") in ("P", "L"):
            page["orientation"] = p["orientation"]
        if p.get("paper_size") in ("A4", "Letter"):
            page["paper_size"] = p["paper_size"]
        for k in ("margin_top", "margin_bottom", "margin_left", "margin_right"):
            if k in p:
                try:
                    page[k] = max(5, min(40, float(p[k])))
                except Exception:
                    pass
        if p.get("font_family") in ("Helvetica", "Times", "Courier"):
            page["font_family"] = p["font_family"]
        if "watermark_text" in p:
            page["watermark_text"] = str(p["watermark_text"])[:40]
        if "watermark_opacity" in p:
            try:
                page["watermark_opacity"] = max(0.0, min(0.5, float(p["watermark_opacity"])))
            except Exception:
                pass
        out["page"] = page
    if "blocks" in data:
        clean_blocks = []
        seen = set()
        for b in (data["blocks"] or []):
            key = b.get("key")
            if key not in VALID_BLOCKS or key in seen:
                continue
            seen.add(key)
            entry = {
                "key": key,
                "enabled": bool(b.get("enabled", True)),
                "order": int(b.get("order", len(clean_blocks))),
            }
            if "content" in b and b["content"] is not None:
                entry["content"] = str(b["content"])[:6000]
            if "options" in b and isinstance(b["options"], dict):
                entry["options"] = b["options"]
            if "style" in b and isinstance(b["style"], dict):
                style = {}
                for sk in ("align", "font_size", "padding_top", "padding_bottom",
                          "bg_color", "text_color", "border_top", "border_bottom",
                          "bold", "italic"):
                    if sk in b["style"] and b["style"][sk] is not None:
                        style[sk] = b["style"][sk]
                entry["style"] = style
            clean_blocks.append(entry)
        out["blocks"] = sorted(clean_blocks, key=lambda x: x["order"])
    return out


# ───────────────────────────────────── Designer Gallery ─────────────────────────────────────

DESIGNER_PRESETS = [
    {
        "preset_key": "tactical_dark",
        "name": "Tactical Dark",
        "description": "Swiss tactical aesthetic — emerald accents on slate, matches NexusOps UI.",
        "doc_type": "invoice", "layout": "tactical", "density": "standard",
        "primary_color": "#10B981", "accent_color": "#0F172A", "secondary_color": "#334155",
        "page": {"orientation": "P", "paper_size": "A4", "margin_top": 18, "margin_bottom": 18, "margin_left": 15, "margin_right": 15, "font_family": "Helvetica"},
        "block_overrides": {
            "header_banner": {"enabled": True, "content": "INVOICE", "style": {"align": "L", "font_size": 24, "bold": True}},
            "footer": {"enabled": True, "content": "Generated by NexusOps • {{company_name}}"},
            "qr_pay": {"enabled": True},
        },
    },
    {
        "preset_key": "modern_executive",
        "name": "Modern Executive",
        "description": "Clean executive look with strong primary and refined typography.",
        "doc_type": "invoice", "layout": "executive", "density": "spacious",
        "primary_color": "#1E40AF", "accent_color": "#0EA5E9",
        "page": _default_page(),
        "block_overrides": {
            "thank_you": {"enabled": True, "content": "Thank you for your continued partnership."},
            "payment_methods": {"enabled": True},
        },
    },
    {
        "preset_key": "minimalist_white",
        "name": "Minimalist White",
        "description": "Thin lines, monochrome, no header band. Pure paper aesthetic.",
        "doc_type": "invoice", "layout": "minimal", "density": "compact",
        "primary_color": "#111827", "accent_color": "#6B7280",
        "page": _default_page(),
        "block_overrides": {
            "header_banner": {"enabled": False},
            "footer": {"enabled": True, "content": "{{company_name}}"},
        },
    },
    {
        "preset_key": "corporate_blue",
        "name": "Corporate Blue",
        "description": "Classic corporate template — blue header, structured totals.",
        "doc_type": "invoice", "layout": "classic", "density": "standard",
        "primary_color": "#1D4ED8", "accent_color": "#3B82F6",
        "page": _default_page(),
        "block_overrides": {
            "bank_details": {"enabled": True},
        },
    },
    {
        "preset_key": "bold_branded",
        "name": "Bold Branded",
        "description": "Vibrant header banner, oversized totals, signature block included.",
        "doc_type": "invoice", "layout": "bold", "density": "standard",
        "primary_color": "#DC2626", "accent_color": "#F59E0B",
        "page": _default_page(),
        "block_overrides": {
            "header_banner": {"enabled": True, "content": "INVOICE", "style": {"font_size": 28}},
            "signature": {"enabled": True},
        },
    },
    {
        "preset_key": "compact_tax_compliant",
        "name": "Compact Tax-Compliant",
        "description": "Compact layout with tax breakdown table. Ideal for AU/EU compliance.",
        "doc_type": "invoice", "layout": "minimal", "density": "compact",
        "primary_color": "#059669", "accent_color": "#10B981",
        "page": _default_page(),
        "block_overrides": {
            "tax_breakdown": {"enabled": True},
            "payment_terms": {"enabled": True, "content": "ABN {{abn}} — Payment due within {{terms_days}} days."},
        },
    },
    {
        "preset_key": "service_detailed",
        "name": "Service Detailed",
        "description": "Includes time entries table + savings summary block.",
        "doc_type": "invoice", "layout": "classic", "density": "standard",
        "primary_color": "#7C3AED", "accent_color": "#A78BFA",
        "page": _default_page(),
        "block_overrides": {
            "time_entries_table": {"enabled": True},
            "savings_summary": {"enabled": True},
        },
    },
    {
        "preset_key": "tier_themed",
        "name": "Tier-Themed (Service Tier)",
        "description": "Auto-styles by client's Service Tier (Bronze/Silver/Gold/Platinum/Diamond).",
        "doc_type": "invoice", "layout": "executive", "density": "standard",
        "primary_color": "#D97706", "accent_color": "#F59E0B",
        "page": _default_page(),
        "block_overrides": {
            "thank_you": {"enabled": True, "content": "{{tier_name}} client — priority support included."},
        },
    },
    {
        "preset_key": "pro_forma",
        "name": "Pro Forma",
        "description": "Estimate-style template marked as Pro Forma. Watermark included.",
        "doc_type": "estimate", "layout": "classic", "density": "standard",
        "primary_color": "#0891B2", "accent_color": "#06B6D4",
        "page": {**_default_page(), "watermark_text": "PRO FORMA", "watermark_opacity": 0.07},
        "block_overrides": {
            "header_banner": {"enabled": True, "content": "PRO FORMA INVOICE"},
            "footer": {"enabled": True, "content": "This document is not a tax invoice."},
        },
    },
    {
        "preset_key": "customer_statement",
        "name": "Customer Statement",
        "description": "Rollup of all unpaid invoices for a client. Aged buckets included.",
        "doc_type": "statement", "layout": "classic", "density": "standard",
        "primary_color": "#0F172A", "accent_color": "#475569",
        "page": _default_page(),
        "block_overrides": {
            "header_banner": {"enabled": True, "content": "STATEMENT OF ACCOUNT"},
            "line_items": {"enabled": False},
            "totals": {"enabled": False},
        },
    },
]


def _build_preset_doc(preset: dict, created_by: str = "system") -> dict:
    blocks = _default_blocks()
    for b in blocks:
        ov = (preset.get("block_overrides") or {}).get(b["key"])
        if ov:
            b.update(ov)
    return {
        "id": f"tpl-{preset['preset_key']}",
        "preset_key": preset["preset_key"],
        "name": preset["name"],
        "description": preset["description"],
        "doc_type": preset["doc_type"],
        "layout": preset["layout"],
        "density": preset["density"],
        "primary_color": preset.get("primary_color"),
        "accent_color": preset.get("accent_color"),
        "secondary_color": preset.get("secondary_color"),
        "page": preset.get("page") or _default_page(),
        "blocks": blocks,
        "is_default": False,
        "is_preset": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": created_by,
    }


async def _ensure_presets_seeded():
    """Idempotent: insert any preset templates that don't yet exist."""
    for p in DESIGNER_PRESETS:
        existing = await db.invoice_pdf_templates.find_one({"id": f"tpl-{p['preset_key']}"}, {"_id": 0, "id": 1})
        if not existing:
            await db.invoice_pdf_templates.insert_one(_build_preset_doc(p))


# ───────────────────────────────────── Gallery + CRUD ─────────────────────────────────────

@router.get("/invoice-templates/gallery")
async def template_gallery(current_user: dict = Depends(get_current_user)):
    """Return the designer preset gallery (seeded if missing)."""
    await _ensure_presets_seeded()
    items = await db.invoice_pdf_templates.find({"is_preset": True}, {"_id": 0}).to_list(50)
    return items


@router.post("/invoice-templates/clone/{preset_key}")
async def clone_preset(preset_key: str, current_user: dict = Depends(get_current_user)):
    """Clone a designer preset into a user-editable template."""
    await _ensure_presets_seeded()
    preset = await db.invoice_pdf_templates.find_one({"preset_key": preset_key, "is_preset": True}, {"_id": 0})
    if not preset:
        raise HTTPException(404, "Preset not found")
    cloned = {**preset}
    cloned["id"] = f"tpl-{uuid.uuid4().hex[:10]}"
    cloned["name"] = f"{preset['name']} (My Copy)"
    cloned["is_preset"] = False
    cloned.pop("preset_key", None)
    cloned["is_default"] = False
    cloned["created_at"] = datetime.now(timezone.utc).isoformat()
    cloned["created_by"] = current_user.get("name", "user")
    await db.invoice_pdf_templates.insert_one(cloned)
    cloned.pop("_id", None)
    return cloned


@router.get("/invoice-templates")
async def list_templates(doc_type: str | None = None, include_presets: bool = True, current_user: dict = Depends(get_current_user)):
    await _ensure_presets_seeded()
    q = {}
    if doc_type:
        q["doc_type"] = doc_type
    if not include_presets:
        q["is_preset"] = {"$ne": True}
    items = await db.invoice_pdf_templates.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    return items


@router.get("/invoice-templates/{tid}")
async def get_template(tid: str, current_user: dict = Depends(get_current_user)):
    doc = await db.invoice_pdf_templates.find_one({"id": tid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Template not found")
    return doc


@router.post("/invoice-templates")
async def create_template(data: dict, current_user: dict = Depends(get_current_user)):
    if not (data.get("name") or "").strip():
        raise HTTPException(400, "name required")
    clean = _sanitize(data)
    doc = {
        "id": f"tpl-{uuid.uuid4().hex[:10]}",
        "name": clean.get("name", "Untitled Template"),
        "description": clean.get("description", ""),
        "doc_type": clean.get("doc_type", "invoice"),
        "layout": clean.get("layout", "classic"),
        "density": clean.get("density", "standard"),
        "primary_color": clean.get("primary_color"),
        "accent_color": clean.get("accent_color"),
        "secondary_color": clean.get("secondary_color"),
        "page": clean.get("page") or _default_page(),
        "blocks": clean.get("blocks") or _default_blocks(),
        "is_default": False,
        "is_preset": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": current_user.get("name"),
    }
    await db.invoice_pdf_templates.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/invoice-templates/{tid}")
async def update_template(tid: str, data: dict, current_user: dict = Depends(get_current_user)):
    existing = await db.invoice_pdf_templates.find_one({"id": tid}, {"_id": 0, "is_preset": 1})
    if not existing:
        raise HTTPException(404, "Template not found")
    if existing.get("is_preset"):
        raise HTTPException(400, "Designer presets are read-only. Clone first.")
    clean = _sanitize(data, doc_type_required=False)
    if not clean:
        return {"success": True, "no_change": True}
    clean["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.invoice_pdf_templates.update_one({"id": tid}, {"$set": clean})
    return await db.invoice_pdf_templates.find_one({"id": tid}, {"_id": 0})


@router.delete("/invoice-templates/{tid}")
async def delete_template(tid: str, current_user: dict = Depends(get_current_user)):
    existing = await db.invoice_pdf_templates.find_one({"id": tid}, {"_id": 0, "is_preset": 1})
    if not existing:
        raise HTTPException(404, "Template not found")
    if existing.get("is_preset"):
        raise HTTPException(400, "Cannot delete designer presets.")
    await db.invoice_pdf_templates.delete_one({"id": tid})
    return {"success": True}


@router.post("/invoice-templates/{tid}/set-default")
async def set_default(tid: str, current_user: dict = Depends(get_current_user)):
    tpl = await db.invoice_pdf_templates.find_one({"id": tid}, {"_id": 0, "doc_type": 1})
    if not tpl:
        raise HTTPException(404, "Template not found")
    await db.invoice_pdf_templates.update_many({"doc_type": tpl["doc_type"]}, {"$set": {"is_default": False}})
    await db.invoice_pdf_templates.update_one({"id": tid}, {"$set": {"is_default": True}})
    return {"success": True}


@router.post("/invoice-templates/{tid}/duplicate")
async def duplicate_template(tid: str, current_user: dict = Depends(get_current_user)):
    src = await db.invoice_pdf_templates.find_one({"id": tid}, {"_id": 0})
    if not src:
        raise HTTPException(404, "Template not found")
    dup = {**src}
    dup["id"] = f"tpl-{uuid.uuid4().hex[:10]}"
    dup["name"] = f"{src.get('name', 'Template')} (Copy)"
    dup["is_default"] = False
    dup["is_preset"] = False
    dup.pop("preset_key", None)
    dup["created_at"] = datetime.now(timezone.utc).isoformat()
    dup["created_by"] = current_user.get("name", "user")
    await db.invoice_pdf_templates.insert_one(dup)
    dup.pop("_id", None)
    return dup


# ───────────────────────────────────── Merge tags + sample data ─────────────────────────────────────

def _merge_tags(text: str, ctx: dict) -> str:
    if not text:
        return ""
    def repl(m):
        key = m.group(1).strip()
        return str(ctx.get(key, m.group(0)))
    return re.sub(r"\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}", repl, text)


def _build_merge_ctx(invoice: dict, branding: dict | None, client_doc: dict | None = None) -> dict:
    branding = branding or {}
    client_doc = client_doc or {}
    return {
        "invoice_number": invoice.get("invoice_number") or invoice.get("number") or "INV-0001",
        "client_name": invoice.get("client_name") or client_doc.get("name") or "Client",
        "due_date": (invoice.get("due_date") or "")[:10],
        "issue_date": (invoice.get("issue_date") or invoice.get("created_at") or "")[:10],
        "total": f"{float(invoice.get('total') or 0):,.2f}",
        "subtotal": f"{float(invoice.get('subtotal') or 0):,.2f}",
        "tax_total": f"{float(invoice.get('tax_total') or invoice.get('tax') or 0):,.2f}",
        "amount_paid": f"{float(invoice.get('amount_paid') or 0):,.2f}",
        "balance_due": f"{(float(invoice.get('total') or 0) - float(invoice.get('amount_paid') or 0)):,.2f}",
        "currency": invoice.get("currency", "USD"),
        "terms_days": str(invoice.get("payment_terms_days", 14)),
        "company_name": branding.get("company_name", "NexusOps"),
        "company_email": branding.get("contact_email", ""),
        "company_phone": branding.get("contact_phone", ""),
        "abn": branding.get("abn") or branding.get("tax_id", ""),
        "bank_name": branding.get("bank_name", ""),
        "bsb": branding.get("bsb", ""),
        "account_number": branding.get("account_number", ""),
        "payment_link": invoice.get("payment_link") or invoice.get("paymentLink") or "",
        "tier_name": client_doc.get("service_tier_name") or client_doc.get("tier") or "Managed",
    }


def _sample_invoice():
    return {
        "id": "preview",
        "invoice_number": "INV-PREVIEW",
        "client_name": "Acme Corporation",
        "client_email": "billing@acme.com",
        "issue_date": datetime.now(timezone.utc).isoformat(),
        "due_date": datetime.now(timezone.utc).isoformat(),
        "currency": "USD",
        "subtotal": 1250.00, "tax_total": 125.00, "total": 1375.00, "amount_paid": 0,
        "payment_terms_days": 14,
        "items": [
            {"description": "Managed IT — Monthly Service", "quantity": 1, "unit_price": 850.00, "total": 850.00, "tax_rate": 10},
            {"description": "M365 Business Premium x10", "quantity": 10, "unit_price": 25.00, "total": 250.00, "tax_rate": 10},
            {"description": "On-site visit", "quantity": 2, "unit_price": 75.00, "total": 150.00, "tax_rate": 10},
        ],
        "time_entries": [
            {"date": "2026-02-10", "tech": "Aaron", "hours": 1.5, "ticket": "T-1023", "rate": 150, "total": 225},
            {"date": "2026-02-11", "tech": "Jamie", "hours": 0.5, "ticket": "T-1024", "rate": 150, "total": 75},
        ],
        "savings_summary": {"hours_saved": 12.5, "incidents_prevented": 4, "uptime_pct": 99.97},
        "client_address": "123 King St\nSydney NSW 2000",
        "payment_link": "https://pay.stripe.com/preview",
    }


# ───────────────────────────────────── PDF rendering ─────────────────────────────────────

def _safe(text) -> str:
    if text is None:
        return ""
    s = str(text)
    repl = {"—": "-", "–": "-", "•": "*", "“": '"', "”": '"', "‘": "'", "’": "'", "…": "...", "→": "->", "·": "-", "✓": "v", "✗": "x"}
    for k, v in repl.items():
        s = s.replace(k, v)
    return s.encode("latin-1", "replace").decode("latin-1")


def _hex_to_rgb(h, fallback=(59, 130, 246)):
    if not h:
        return fallback
    h = h.lstrip("#")
    if len(h) != 6:
        return fallback
    try:
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
    except Exception:
        return fallback


def _render_qr_png(url: str) -> str | None:
    """Render a small QR PNG to /tmp and return path, or None on failure."""
    if not url:
        return None
    try:
        import qrcode
        img = qrcode.make(url)
        path = f"/tmp/qr-{uuid.uuid4().hex[:10]}.png"
        img.save(path)
        return path
    except Exception:
        return None


def _render_template_pdf(template: dict, invoice: dict, branding: dict | None, client_doc: dict | None = None) -> bytes:
    """Block-based PDF renderer driven by the template's enabled blocks + page settings + styling."""
    from fpdf import FPDF

    branding = branding or {}
    primary = _hex_to_rgb(template.get("primary_color") or branding.get("primary_color") or "#3B82F6")
    accent = _hex_to_rgb(template.get("accent_color") or branding.get("accent_color") or "#06B6D4", (6, 182, 212))
    company_name = _safe(branding.get("company_name") or "NexusOps")
    density = template.get("density", "standard")
    line_h = {"compact": 4.0, "standard": 5.0, "spacious": 6.0}.get(density, 5.0)
    layout = template.get("layout", "classic")
    page_cfg = template.get("page") or _default_page()
    font_family = page_cfg.get("font_family", "Helvetica")
    ordered = sorted([b for b in (template.get("blocks") or []) if b.get("enabled")], key=lambda x: x.get("order", 0))
    ctx = _build_merge_ctx(invoice, branding, client_doc)

    pdf = FPDF(orientation=page_cfg.get("orientation", "P"), unit="mm", format=page_cfg.get("paper_size", "A4"))
    pdf.set_auto_page_break(auto=True, margin=page_cfg.get("margin_bottom", 18))
    margin_left = page_cfg.get("margin_left", 15)
    margin_right = page_cfg.get("margin_right", 15)
    pdf.set_left_margin(margin_left)
    pdf.set_right_margin(margin_right)
    pdf.add_page()

    page_width = pdf.w
    usable_w = page_width - margin_left - margin_right

    # Watermark (page-wide diagonal text)
    wm = (page_cfg.get("watermark_text") or "").strip()
    if wm:
        pdf.set_font(font_family, "B", 60)
        pdf.set_text_color(220, 220, 220)
        pdf.set_xy(margin_left, pdf.h / 2 - 15)
        pdf.cell(usable_w, 30, _safe(wm), align="C")
        pdf.set_text_color(40, 40, 40)
        pdf.set_xy(margin_left, page_cfg.get("margin_top", 18))

    # Header band based on layout
    header_h = 0
    if layout in ("classic", "bold"):
        pdf.set_fill_color(*primary)
        pdf.rect(0, 0, page_width, 32, "F")
        pdf.set_text_color(255, 255, 255)
        pdf.set_font(font_family, "B", 22)
        pdf.set_xy(margin_left, 8)
        pdf.cell(usable_w, 8, _safe(template.get("doc_type", "invoice").upper()), ln=True)
        pdf.set_font(font_family, "", 11)
        pdf.set_xy(margin_left, 18)
        pdf.cell(usable_w, 6, _safe(f"#{ctx['invoice_number']} - {ctx['issue_date']}"), ln=True)
        pdf.set_text_color(40, 40, 40)
        header_h = 40
    elif layout == "minimal":
        pdf.set_text_color(*primary)
        pdf.set_font(font_family, "B", 18)
        pdf.set_xy(margin_left, 12)
        pdf.cell(usable_w, 8, _safe(template.get("doc_type", "invoice").upper()), ln=True)
        pdf.set_text_color(120, 120, 120)
        pdf.set_font(font_family, "", 10)
        pdf.set_xy(margin_left, 22)
        pdf.cell(usable_w, 5, _safe(f"#{ctx['invoice_number']}"), ln=True)
        pdf.set_draw_color(*primary)
        pdf.line(margin_left, 30, page_width - margin_right, 30)
        pdf.set_text_color(40, 40, 40)
        header_h = 38
    elif layout == "tactical":
        # Slate background band + emerald top-line
        pdf.set_fill_color(15, 23, 42)  # slate-900
        pdf.rect(0, 0, page_width, 34, "F")
        pdf.set_fill_color(*primary)
        pdf.rect(0, 32, page_width, 2, "F")
        pdf.set_text_color(255, 255, 255)
        pdf.set_font(font_family, "B", 22)
        pdf.set_xy(margin_left, 9)
        pdf.cell(usable_w, 8, _safe(template.get("doc_type", "invoice").upper()), ln=True)
        pdf.set_text_color(*primary)
        pdf.set_font(font_family, "", 10)
        pdf.set_xy(margin_left, 19)
        pdf.cell(usable_w, 5, _safe(f"#{ctx['invoice_number']}  ·  {ctx['issue_date']}"), ln=True)
        pdf.set_text_color(40, 40, 40)
        header_h = 42
    elif layout == "modern":
        pdf.set_fill_color(248, 250, 252)
        pdf.rect(0, 0, page_width, 38, "F")
        pdf.set_text_color(*primary)
        pdf.set_font(font_family, "B", 20)
        pdf.set_xy(margin_left, 12)
        pdf.cell(usable_w, 8, _safe(template.get("doc_type", "invoice").upper()), ln=True)
        pdf.set_text_color(100, 116, 139)
        pdf.set_font(font_family, "", 10)
        pdf.set_xy(margin_left, 22)
        pdf.cell(usable_w, 5, _safe(f"#{ctx['invoice_number']}  ·  Due {ctx['due_date']}"), ln=True)
        pdf.set_text_color(40, 40, 40)
        header_h = 44
    else:  # executive
        pdf.set_fill_color(*accent)
        pdf.rect(0, 0, 6, pdf.h, "F")
        pdf.set_text_color(*primary)
        pdf.set_font(font_family, "B", 24)
        pdf.set_xy(margin_left, 12)
        pdf.cell(usable_w, 9, _safe(template.get("doc_type", "invoice").upper()), ln=True)
        pdf.set_text_color(40, 40, 40)
        header_h = 30

    pdf.set_y(header_h)

    def _block_style(b):
        return b.get("style") or {}

    def _apply_block_padding_top(b):
        pad = _block_style(b).get("padding_top")
        if pad:
            try:
                pdf.ln(float(pad))
            except Exception:
                pass

    def _apply_block_padding_bottom(b):
        pad = _block_style(b).get("padding_bottom")
        if pad:
            try:
                pdf.ln(float(pad))
            except Exception:
                pass

    def _section_title(text, style=None):
        pdf.ln(2)
        pdf.set_x(margin_left)
        pdf.set_text_color(*primary)
        size = int((style or {}).get("font_size") or 10)
        pdf.set_font(font_family, "B", size)
        pdf.cell(0, 5, _safe(text), ln=True)
        pdf.set_text_color(40, 40, 40)
        pdf.set_font(font_family, "", 10)

    def _para(text, style=None):
        if not text:
            return
        style = style or {}
        align = style.get("align", "L")
        size = int(style.get("font_size") or 10)
        font_style = ""
        if style.get("bold"):
            font_style += "B"
        if style.get("italic"):
            font_style += "I"
        if style.get("text_color"):
            r, g, bl = _hex_to_rgb(style["text_color"])
            pdf.set_text_color(r, g, bl)
        pdf.set_font(font_family, font_style, size)
        pdf.set_x(margin_left)
        pdf.multi_cell(usable_w, line_h, _safe(text), align=align)
        pdf.set_text_color(40, 40, 40)
        pdf.set_font(font_family, "", 10)
        pdf.ln(0.5)

    # Render blocks in order
    for b in ordered:
        key = b["key"]
        _apply_block_padding_top(b)
        style = _block_style(b)
        if key == "logo":
            logo_path = None
            for lk in ("invoice_logo_url", "company_logo_url"):
                u = branding.get(lk)
                if u and u.startswith("/api/uploads/"):
                    fp = os.path.join("/app/backend", u.replace("/api/", "").lstrip("/"))
                    if os.path.exists(fp):
                        logo_path = fp
                        break
            if logo_path:
                try:
                    pdf.image(logo_path, page_width - margin_right - 30, 8, 30, 16)
                except Exception:
                    pass
        elif key == "header_banner":
            content = _merge_tags(b.get("content", ""), ctx) or template.get("doc_type", "invoice").upper()
            pdf.set_x(margin_left)
            size = int(style.get("font_size") or 20)
            pdf.set_font(font_family, "B", size)
            pdf.set_text_color(*primary)
            pdf.cell(usable_w, size * 0.5, _safe(content), ln=True, align=style.get("align", "L"))
            pdf.set_text_color(40, 40, 40)
            pdf.set_font(font_family, "", 10)
        elif key == "company_info":
            pdf.set_x(margin_left)
            pdf.set_font(font_family, "B", 10)
            pdf.cell(0, 5, _safe(company_name), ln=True)
            pdf.set_font(font_family, "", 9)
            for line in (
                branding.get("address", ""),
                branding.get("contact_email", ""),
                branding.get("contact_phone", ""),
                branding.get("abn", ""),
            ):
                if line:
                    pdf.set_x(margin_left)
                    pdf.cell(0, 4, _safe(line), ln=True)
            pdf.ln(2)
        elif key == "bill_to":
            _section_title("Bill To", style)
            _para(invoice.get("client_name", ""))
            if invoice.get("client_email"):
                _para(invoice["client_email"])
            if invoice.get("client_address"):
                _para(invoice["client_address"])
        elif key == "invoice_meta":
            _section_title("Details", style)
            pdf.set_font(font_family, "", 9)
            for label, val in (
                ("Number", ctx["invoice_number"]),
                ("Issue Date", ctx["issue_date"]),
                ("Due Date", ctx["due_date"]),
                ("Currency", ctx["currency"]),
            ):
                pdf.set_x(margin_left)
                pdf.cell(40, 4, _safe(label), border=0)
                pdf.cell(0, 4, _safe(val), ln=True)
            pdf.ln(1)
        elif key == "line_items":
            _section_title("Line Items", style)
            pdf.set_fill_color(*primary)
            pdf.set_text_color(255, 255, 255)
            pdf.set_font(font_family, "B", 9)
            pdf.set_x(margin_left)
            col_desc = usable_w * 0.52
            col_qty = usable_w * 0.10
            col_unit = usable_w * 0.18
            col_tot = usable_w * 0.20
            pdf.cell(col_desc, 6, _safe("Description"), border=0, fill=True)
            pdf.cell(col_qty, 6, _safe("Qty"), border=0, align="R", fill=True)
            pdf.cell(col_unit, 6, _safe("Unit"), border=0, align="R", fill=True)
            pdf.cell(col_tot, 6, _safe("Total"), border=0, align="R", fill=True, ln=True)
            pdf.set_text_color(40, 40, 40)
            pdf.set_font(font_family, "", 9)
            for it in (invoice.get("items") or invoice.get("line_items") or []):
                pdf.set_x(margin_left)
                desc = it.get("description") or it.get("name", "")
                qty = it.get("quantity", 1)
                unit = float(it.get("unit_price") or it.get("rate") or 0)
                tot = float(it.get("total") or it.get("amount") or (qty * unit))
                pdf.cell(col_desc, 5, _safe(desc), border="B")
                pdf.cell(col_qty, 5, _safe(str(qty)), border="B", align="R")
                pdf.cell(col_unit, 5, _safe(f"{unit:,.2f}"), border="B", align="R")
                pdf.cell(col_tot, 5, _safe(f"{tot:,.2f}"), border="B", align="R", ln=True)
            pdf.ln(2)
        elif key == "time_entries_table":
            entries = invoice.get("time_entries") or []
            if entries:
                _section_title("Time Entries", style)
                pdf.set_fill_color(*primary)
                pdf.set_text_color(255, 255, 255)
                pdf.set_font(font_family, "B", 9)
                pdf.set_x(margin_left)
                col = usable_w / 6
                for h in ("Date", "Tech", "Ticket", "Hours", "Rate", "Total"):
                    pdf.cell(col, 6, _safe(h), fill=True, align="R" if h in ("Hours", "Rate", "Total") else "L")
                pdf.ln(6)
                pdf.set_text_color(40, 40, 40)
                pdf.set_font(font_family, "", 9)
                for te in entries:
                    pdf.set_x(margin_left)
                    pdf.cell(col, 5, _safe(te.get("date", "")), border="B")
                    pdf.cell(col, 5, _safe(te.get("tech", "")), border="B")
                    pdf.cell(col, 5, _safe(te.get("ticket", "")), border="B")
                    pdf.cell(col, 5, _safe(f"{float(te.get('hours') or 0):.2f}"), border="B", align="R")
                    pdf.cell(col, 5, _safe(f"{float(te.get('rate') or 0):,.2f}"), border="B", align="R")
                    pdf.cell(col, 5, _safe(f"{float(te.get('total') or 0):,.2f}"), border="B", align="R", ln=True)
                pdf.ln(2)
        elif key == "tax_breakdown":
            items = invoice.get("items") or invoice.get("line_items") or []
            tax_buckets = {}
            for it in items:
                rate = float(it.get("tax_rate") or 0)
                amount = float(it.get("total") or 0)
                tax_amt = amount * rate / 100
                tax_buckets.setdefault(rate, {"taxable": 0, "tax": 0})
                tax_buckets[rate]["taxable"] += amount
                tax_buckets[rate]["tax"] += tax_amt
            if tax_buckets:
                _section_title("Tax Breakdown", style)
                pdf.set_font(font_family, "B", 9)
                pdf.set_x(margin_left)
                pdf.cell(usable_w * 0.4, 5, _safe("Rate"))
                pdf.cell(usable_w * 0.3, 5, _safe("Taxable Amount"), align="R")
                pdf.cell(usable_w * 0.3, 5, _safe("Tax"), align="R", ln=True)
                pdf.set_font(font_family, "", 9)
                for rate, vals in sorted(tax_buckets.items()):
                    pdf.set_x(margin_left)
                    pdf.cell(usable_w * 0.4, 5, _safe(f"{rate:.1f}%"), border="B")
                    pdf.cell(usable_w * 0.3, 5, _safe(f"{vals['taxable']:,.2f}"), border="B", align="R")
                    pdf.cell(usable_w * 0.3, 5, _safe(f"{vals['tax']:,.2f}"), border="B", align="R", ln=True)
                pdf.ln(2)
        elif key == "totals":
            pdf.ln(1)
            tx = margin_left + usable_w * 0.55
            pdf.set_x(tx)
            pdf.set_font(font_family, "", 10)
            pdf.cell(usable_w * 0.25, 5, _safe("Subtotal"), align="R")
            pdf.cell(usable_w * 0.20, 5, _safe(f"{ctx['subtotal']}"), align="R", ln=True)
            pdf.set_x(tx)
            pdf.cell(usable_w * 0.25, 5, _safe("Tax"), align="R")
            pdf.cell(usable_w * 0.20, 5, _safe(f"{ctx['tax_total']}"), align="R", ln=True)
            if float(invoice.get("amount_paid") or 0) > 0:
                pdf.set_x(tx)
                pdf.cell(usable_w * 0.25, 5, _safe("Paid"), align="R")
                pdf.cell(usable_w * 0.20, 5, _safe(f"-{ctx['amount_paid']}"), align="R", ln=True)
            pdf.set_x(tx)
            pdf.set_fill_color(*primary)
            pdf.set_text_color(255, 255, 255)
            pdf.set_font(font_family, "B", 11)
            pdf.cell(usable_w * 0.25, 7, _safe("TOTAL"), align="R", fill=True)
            pdf.cell(usable_w * 0.20, 7, _safe(f"{ctx['currency']} {ctx['total']}"), align="R", fill=True, ln=True)
            pdf.set_text_color(40, 40, 40)
            pdf.ln(3)
        elif key == "savings_summary":
            ss = invoice.get("savings_summary") or {}
            if ss:
                _section_title("Value Delivered This Period", style)
                pdf.set_font(font_family, "", 10)
                for label, val in (
                    ("Hours saved", f"{ss.get('hours_saved', 0):.1f}"),
                    ("Incidents prevented", str(ss.get("incidents_prevented", 0))),
                    ("Uptime", f"{ss.get('uptime_pct', 0):.2f}%"),
                ):
                    pdf.set_x(margin_left)
                    pdf.cell(60, 5, _safe(label))
                    pdf.cell(0, 5, _safe(val), ln=True)
                pdf.ln(1)
        elif key == "payment_methods":
            _section_title("Payment Methods", style)
            methods = branding.get("payment_methods") or ["Credit Card (Stripe)", "Bank Transfer", "Direct Debit"]
            pdf.set_font(font_family, "", 9)
            for m in methods:
                pdf.set_x(margin_left)
                pdf.cell(0, 4, _safe(f"- {m}"), ln=True)
            pdf.ln(1)
        elif key == "payment_terms":
            _section_title("Payment Terms", style)
            _para(_merge_tags(b.get("content", ""), ctx), style)
        elif key == "notes":
            _section_title("Notes", style)
            _para(_merge_tags(b.get("content", "") or invoice.get("notes", ""), ctx), style)
        elif key == "bank_details":
            _section_title("Bank Details", style)
            _para(_merge_tags(b.get("content", ""), ctx), style)
        elif key == "qr_pay":
            url = invoice.get("payment_link") or invoice.get("paymentLink") or branding.get("default_payment_url") or ""
            if url:
                _section_title("Pay Online", style)
                qr_path = _render_qr_png(url)
                if qr_path:
                    try:
                        pdf.image(qr_path, margin_left, pdf.get_y(), 28, 28)
                    except Exception:
                        pass
                pdf.set_x(margin_left + 32)
                pdf.set_font(font_family, "", 9)
                pdf.multi_cell(usable_w - 32, 5, _safe("Scan to pay instantly:\n" + url))
                pdf.ln(2)
        elif key == "signature":
            pdf.ln(6)
            pdf.set_draw_color(120, 120, 120)
            pdf.line(margin_left, pdf.get_y(), margin_left + 70, pdf.get_y())
            pdf.ln(1)
            pdf.set_font(font_family, "I", 9)
            pdf.set_x(margin_left)
            pdf.cell(0, 4, _safe(_merge_tags(b.get("content", ""), ctx)), ln=True)
            pdf.set_font(font_family, "", 10)
        elif key == "custom_html":
            # Render text content only (HTML stripped) — keeps PDF safe & predictable
            txt = re.sub(r"<[^>]+>", "", b.get("content", "") or "")
            _para(_merge_tags(txt, ctx), style)
        elif key == "divider":
            pdf.set_draw_color(*primary)
            y = pdf.get_y() + 2
            pdf.line(margin_left, y, page_width - margin_right, y)
            pdf.set_draw_color(0, 0, 0)
            pdf.ln(4)
        elif key == "spacer":
            pdf.ln(6)
        elif key == "page_break":
            pdf.add_page()
        elif key == "thank_you":
            pdf.set_font(font_family, "I", 10)
            _para(_merge_tags(b.get("content", ""), ctx), style)
            pdf.set_font(font_family, "", 10)
        elif key == "footer":
            pdf.set_y(-22)
            pdf.set_text_color(140, 140, 140)
            pdf.set_font(font_family, "I", 8)
            pdf.cell(0, 5, _safe(_merge_tags(b.get("content", ""), ctx)), align="C")
            pdf.set_text_color(40, 40, 40)
        _apply_block_padding_bottom(b)

    return bytes(pdf.output(dest="S"))


# ───────────────────────────────────── Preview + Live invoice rendering ─────────────────────────────────────

async def _user_from_qtoken(token: str = Query(None)):
    if not token:
        raise HTTPException(401, "Token required")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(401, "User not found")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except Exception:
        raise HTTPException(401, "Invalid token")


@router.post("/invoice-templates/{tid}/preview")
async def preview_template(tid: str, data: dict = None, current_user: dict = Depends(get_current_user)):
    tpl = await db.invoice_pdf_templates.find_one({"id": tid}, {"_id": 0})
    if not tpl:
        raise HTTPException(404, "Template not found")
    branding_doc = await db.settings.find_one({"key": "branding"}, {"_id": 0}) or {}
    branding = (branding_doc.get("value") or branding_doc) if branding_doc else {}
    invoice = (data or {}).get("sample") or _sample_invoice()
    pdf_bytes = _render_template_pdf(tpl, invoice, branding)
    return Response(content=pdf_bytes, media_type="application/pdf",
                    headers={"Content-Disposition": "inline; filename=preview.pdf"})


@router.get("/invoice-templates/{tid}/preview-pdf")
async def preview_template_get(tid: str, user: dict = Depends(_user_from_qtoken)):
    tpl = await db.invoice_pdf_templates.find_one({"id": tid}, {"_id": 0})
    if not tpl:
        raise HTTPException(404, "Template not found")
    branding_doc = await db.settings.find_one({"key": "branding"}, {"_id": 0}) or {}
    branding = branding_doc.get("value") or branding_doc or {}
    pdf_bytes = _render_template_pdf(tpl, _sample_invoice(), branding)
    return Response(content=pdf_bytes, media_type="application/pdf",
                    headers={"Content-Disposition": "inline; filename=preview.pdf"})


@router.get("/invoices/{invoice_id}/pdf-with-template")
async def invoice_pdf_with_template(invoice_id: str, template_id: str | None = None, user: dict = Depends(_user_from_qtoken)):
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    tpl = None
    if template_id:
        tpl = await db.invoice_pdf_templates.find_one({"id": template_id}, {"_id": 0})
    if not tpl:
        tpl = await db.invoice_pdf_templates.find_one({"doc_type": "invoice", "is_default": True}, {"_id": 0})
    if not tpl:
        raise HTTPException(404, "No template found (template_id missing and no default)")
    branding_doc = await db.settings.find_one({"key": "branding"}, {"_id": 0}) or {}
    branding = branding_doc.get("value") or branding_doc or {}
    client_doc = None
    if invoice.get("client_id"):
        client_doc = await db.clients.find_one({"id": invoice["client_id"]}, {"_id": 0}) or {}
    pdf_bytes = _render_template_pdf(tpl, invoice, branding, client_doc)
    safe = re.sub(r"[^a-zA-Z0-9_-]", "_", f"INV_{invoice.get('invoice_number', invoice_id)}")
    return Response(content=pdf_bytes, media_type="application/pdf",
                    headers={"Content-Disposition": f"attachment; filename={safe}.pdf"})


@router.get("/invoice-templates/blocks/catalog")
async def block_catalog(current_user: dict = Depends(get_current_user)):
    """Return the canonical list of available block types with metadata for the builder UI."""
    catalog = [
        {"key": "logo", "label": "Logo", "category": "header", "editable_content": False},
        {"key": "header_banner", "label": "Header Banner", "category": "header", "editable_content": True},
        {"key": "company_info", "label": "Company Info", "category": "header", "editable_content": False},
        {"key": "bill_to", "label": "Bill To", "category": "header", "editable_content": False},
        {"key": "invoice_meta", "label": "Invoice Meta", "category": "header", "editable_content": False},
        {"key": "line_items", "label": "Line Items", "category": "body", "editable_content": False},
        {"key": "time_entries_table", "label": "Time Entries Table", "category": "body", "editable_content": False, "new": True},
        {"key": "tax_breakdown", "label": "Tax Breakdown", "category": "body", "editable_content": False, "new": True},
        {"key": "totals", "label": "Totals", "category": "body", "editable_content": False},
        {"key": "savings_summary", "label": "Value/Savings Summary", "category": "body", "editable_content": False, "new": True},
        {"key": "payment_methods", "label": "Payment Methods", "category": "footer", "editable_content": False, "new": True},
        {"key": "payment_terms", "label": "Payment Terms", "category": "footer", "editable_content": True},
        {"key": "notes", "label": "Notes", "category": "footer", "editable_content": True},
        {"key": "bank_details", "label": "Bank Details", "category": "footer", "editable_content": True},
        {"key": "qr_pay", "label": "QR Pay (Live QR)", "category": "footer", "editable_content": False, "new": True},
        {"key": "signature", "label": "Signature", "category": "footer", "editable_content": True, "new": True},
        {"key": "custom_html", "label": "Custom Block (text)", "category": "footer", "editable_content": True, "new": True},
        {"key": "divider", "label": "Divider", "category": "layout", "editable_content": False, "new": True},
        {"key": "spacer", "label": "Spacer", "category": "layout", "editable_content": False, "new": True},
        {"key": "page_break", "label": "Page Break", "category": "layout", "editable_content": False, "new": True},
        {"key": "thank_you", "label": "Thank You", "category": "footer", "editable_content": True},
        {"key": "footer", "label": "Footer", "category": "footer", "editable_content": True},
    ]
    return catalog
