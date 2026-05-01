"""Invoice PDF Template Builder — visual, block-based templates with merge tags.

Templates live in db.invoice_pdf_templates (note: distinct from the existing
db.invoice_templates which holds recurring line-item templates):
  {
    id, name, description, doc_type: 'invoice'|'estimate'|'qbr',
    layout: 'classic'|'minimal'|'bold'|'executive',
    density: 'compact'|'standard'|'spacious',
    primary_color, accent_color,           # hex strings; falls back to branding
    blocks: [                              # toggled & ordered
      {key:'logo', enabled, order, options?},
      {key:'company_info', ...},
      {key:'bill_to', ...},
      {key:'invoice_meta', ...},
      {key:'line_items', ...},
      {key:'totals', ...},
      {key:'payment_terms', enabled, content (with merge tags)},
      {key:'notes', enabled, content},
      {key:'bank_details', enabled, content},
      {key:'qr_pay', enabled, options:{url_field:'paymentLink'}},
      {key:'footer', enabled, content},
      {key:'thank_you', enabled, content},
    ],
    is_default: bool,
    created_at, created_by
  }

Endpoints:
  /api/invoice-templates                         CRUD list/create
  /api/invoice-templates/{id}                    CRUD get/update/delete
  /api/invoice-templates/{id}/preview            POST {sample?} -> PDF bytes
  /api/invoice-templates/{id}/set-default        POST mark default for doc_type
  /api/invoices/{invoice_id}/pdf-with-template?template_id=...  preview PDF for live invoice
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


VALID_BLOCKS = [
    "logo", "company_info", "bill_to", "invoice_meta", "line_items", "totals",
    "payment_terms", "notes", "bank_details", "qr_pay", "footer", "thank_you",
]
VALID_LAYOUTS = {"classic", "minimal", "bold", "executive"}
VALID_DENSITIES = {"compact", "standard", "spacious"}
VALID_DOC_TYPES = {"invoice", "estimate", "qbr"}


def _default_blocks():
    """Sensible default blocks turned on for a new template."""
    presets = {
        "logo": {"enabled": True},
        "company_info": {"enabled": True},
        "bill_to": {"enabled": True},
        "invoice_meta": {"enabled": True},
        "line_items": {"enabled": True},
        "totals": {"enabled": True},
        "payment_terms": {"enabled": True, "content": "Payment due within {{terms_days}} days of invoice date."},
        "notes": {"enabled": False, "content": ""},
        "bank_details": {"enabled": False, "content": "Bank: {{bank_name}}\nBSB: {{bsb}}\nAccount: {{account_number}}\nReference: {{invoice_number}}"},
        "qr_pay": {"enabled": False, "options": {}},
        "footer": {"enabled": True, "content": "Thank you for your business."},
        "thank_you": {"enabled": False, "content": "We appreciate your prompt payment."},
    }
    return [{"key": k, "order": i, **presets[k]} for i, k in enumerate(VALID_BLOCKS)]


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
    for k in ("primary_color", "accent_color"):
        if k in data and data[k]:
            v = str(data[k]).strip()
            if not re.match(r"^#?[0-9a-fA-F]{6}$", v):
                raise HTTPException(400, f"{k} must be a 6-digit hex color")
            out[k] = v if v.startswith("#") else f"#{v}"
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
                entry["content"] = str(b["content"])[:4000]
            if "options" in b and isinstance(b["options"], dict):
                entry["options"] = b["options"]
            clean_blocks.append(entry)
        out["blocks"] = sorted(clean_blocks, key=lambda x: x["order"])
    return out


@router.get("/invoice-templates")
async def list_templates(doc_type: str | None = None, current_user: dict = Depends(get_current_user)):
    q = {}
    if doc_type:
        q["doc_type"] = doc_type
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
        "blocks": clean.get("blocks") or _default_blocks(),
        "is_default": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": current_user.get("name"),
    }
    await db.invoice_pdf_templates.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/invoice-templates/{tid}")
async def update_template(tid: str, data: dict, current_user: dict = Depends(get_current_user)):
    clean = _sanitize(data, doc_type_required=False)
    if not clean:
        return {"success": True, "no_change": True}
    clean["updated_at"] = datetime.now(timezone.utc).isoformat()
    res = await db.invoice_pdf_templates.update_one({"id": tid}, {"$set": clean})
    if res.matched_count == 0:
        raise HTTPException(404, "Template not found")
    return await db.invoice_pdf_templates.find_one({"id": tid}, {"_id": 0})


@router.delete("/invoice-templates/{tid}")
async def delete_template(tid: str, current_user: dict = Depends(get_current_user)):
    res = await db.invoice_pdf_templates.delete_one({"id": tid})
    if res.deleted_count == 0:
        raise HTTPException(404, "Template not found")
    return {"success": True}


@router.post("/invoice-templates/{tid}/set-default")
async def set_default(tid: str, current_user: dict = Depends(get_current_user)):
    tpl = await db.invoice_pdf_templates.find_one({"id": tid}, {"_id": 0, "doc_type": 1})
    if not tpl:
        raise HTTPException(404, "Template not found")
    await db.invoice_pdf_templates.update_many({"doc_type": tpl["doc_type"]}, {"$set": {"is_default": False}})
    await db.invoice_pdf_templates.update_one({"id": tid}, {"$set": {"is_default": True}})
    return {"success": True}


# ─────────────────────── Merge tags + sample data ───────────────────────


def _merge_tags(text: str, ctx: dict) -> str:
    if not text:
        return ""
    def repl(m):
        key = m.group(1).strip()
        return str(ctx.get(key, m.group(0)))
    return re.sub(r"\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}", repl, text)


def _build_merge_ctx(invoice: dict, branding: dict | None) -> dict:
    branding = branding or {}
    return {
        "invoice_number": invoice.get("invoice_number") or invoice.get("number") or "INV-0001",
        "client_name": invoice.get("client_name") or "Client",
        "due_date": (invoice.get("due_date") or "")[:10],
        "issue_date": (invoice.get("issue_date") or "")[:10],
        "total": f"{float(invoice.get('total') or 0):,.2f}",
        "subtotal": f"{float(invoice.get('subtotal') or 0):,.2f}",
        "tax_total": f"{float(invoice.get('tax_total') or invoice.get('tax') or 0):,.2f}",
        "currency": invoice.get("currency", "USD"),
        "terms_days": str(invoice.get("payment_terms_days", 14)),
        "company_name": branding.get("company_name", "NexusOps"),
        "company_email": branding.get("contact_email", ""),
        "company_phone": branding.get("contact_phone", ""),
        "bank_name": branding.get("bank_name", ""),
        "bsb": branding.get("bsb", ""),
        "account_number": branding.get("account_number", ""),
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
        "subtotal": 1250.00,
        "tax_total": 125.00,
        "total": 1375.00,
        "payment_terms_days": 14,
        "items": [
            {"description": "Managed IT — Monthly Service", "quantity": 1, "unit_price": 850.00, "total": 850.00},
            {"description": "M365 Business Premium x10", "quantity": 10, "unit_price": 25.00, "total": 250.00},
            {"description": "On-site visit", "quantity": 2, "unit_price": 75.00, "total": 150.00},
        ],
        "client_address": "123 King St\nSydney NSW 2000",
        "notes": "",
    }


# ─────────────────────── PDF rendering with template blocks ───────────────────────


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


def _render_template_pdf(template: dict, invoice: dict, branding: dict | None) -> bytes:
    """Block-based PDF renderer driven by the template's enabled blocks + content."""
    from fpdf import FPDF

    branding = branding or {}
    primary = _hex_to_rgb(template.get("primary_color") or branding.get("primary_color") or "#3B82F6")
    accent = _hex_to_rgb(template.get("accent_color") or branding.get("accent_color") or "#06B6D4", (6, 182, 212))
    company_name = _safe(branding.get("company_name") or "NexusOps")
    density = template.get("density", "standard")
    line_h = {"compact": 4.0, "standard": 5.0, "spacious": 6.0}.get(density, 5.0)
    layout = template.get("layout", "classic")
    blocks_by_key = {b["key"]: b for b in (template.get("blocks") or []) if b.get("enabled")}  # noqa: F841
    ordered = sorted([b for b in (template.get("blocks") or []) if b.get("enabled")], key=lambda x: x.get("order", 0))
    ctx = _build_merge_ctx(invoice, branding)

    pdf = FPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_page()

    # Header band
    if layout in ("classic", "bold"):
        pdf.set_fill_color(*primary)
        pdf.rect(0, 0, 210, 32, "F")
        pdf.set_text_color(255, 255, 255)
        pdf.set_font("Helvetica", "B", 22)
        pdf.set_xy(15, 8)
        pdf.cell(180, 8, _safe(template.get("doc_type", "invoice").upper()), ln=True)
        pdf.set_font("Helvetica", "", 11)
        pdf.set_xy(15, 18)
        pdf.cell(180, 6, _safe(f"#{ctx['invoice_number']} - {ctx['issue_date']}"), ln=True)
        pdf.set_text_color(40, 40, 40)
        pdf.set_y(40)
    elif layout == "minimal":
        pdf.set_text_color(*primary)
        pdf.set_font("Helvetica", "B", 18)
        pdf.set_xy(15, 12)
        pdf.cell(180, 8, _safe(template.get("doc_type", "invoice").upper()), ln=True)
        pdf.set_text_color(120, 120, 120)
        pdf.set_font("Helvetica", "", 10)
        pdf.set_xy(15, 22)
        pdf.cell(180, 5, _safe(f"#{ctx['invoice_number']}"), ln=True)
        pdf.set_draw_color(*primary)
        pdf.line(15, 30, 195, 30)
        pdf.set_text_color(40, 40, 40)
        pdf.set_y(38)
    else:  # executive
        pdf.set_fill_color(*accent)
        pdf.rect(0, 0, 6, 297, "F")
        pdf.set_text_color(*primary)
        pdf.set_font("Helvetica", "B", 24)
        pdf.set_xy(15, 12)
        pdf.cell(180, 9, _safe(template.get("doc_type", "invoice").upper()), ln=True)
        pdf.set_text_color(40, 40, 40)
        pdf.set_y(28)

    def _section_title(text):
        pdf.ln(2)
        pdf.set_x(15)
        pdf.set_text_color(*primary)
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(0, 5, _safe(text), ln=True)
        pdf.set_text_color(40, 40, 40)
        pdf.set_font("Helvetica", "", 10)

    def _para(text):
        if not text:
            return
        pdf.set_x(15)
        pdf.multi_cell(180, line_h, _safe(text))
        pdf.ln(0.5)

    # Render blocks in order — header-style blocks (logo/company/bill-to/meta) typically render first
    for b in ordered:
        key = b["key"]
        if key == "logo":
            # If a logo file path is configured in branding, draw it top-right
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
                    pdf.image(logo_path, 165, 8, 30, 16)
                except Exception:
                    pass
        elif key == "company_info":
            pdf.set_x(15)
            pdf.set_font("Helvetica", "B", 10)
            pdf.cell(0, 5, _safe(company_name), ln=True)
            pdf.set_font("Helvetica", "", 9)
            for line in (
                branding.get("address", ""),
                branding.get("contact_email", ""),
                branding.get("contact_phone", ""),
            ):
                if line:
                    pdf.set_x(15)
                    pdf.cell(0, 4, _safe(line), ln=True)
            pdf.ln(2)
        elif key == "bill_to":
            _section_title("Bill To")
            _para(invoice.get("client_name", ""))
            if invoice.get("client_email"):
                _para(invoice["client_email"])
            if invoice.get("client_address"):
                _para(invoice["client_address"])
        elif key == "invoice_meta":
            _section_title("Details")
            pdf.set_x(15)
            pdf.set_font("Helvetica", "", 9)
            for label, val in (
                ("Number", ctx["invoice_number"]),
                ("Issue Date", ctx["issue_date"]),
                ("Due Date", ctx["due_date"]),
                ("Currency", ctx["currency"]),
            ):
                pdf.set_x(15)
                pdf.cell(40, 4, _safe(label), border=0)
                pdf.cell(0, 4, _safe(val), ln=True)
            pdf.ln(1)
        elif key == "line_items":
            _section_title("Line Items")
            pdf.set_fill_color(*primary)
            pdf.set_text_color(255, 255, 255)
            pdf.set_font("Helvetica", "B", 9)
            pdf.set_x(15)
            pdf.cell(95, 6, _safe("Description"), border=0, fill=True)
            pdf.cell(20, 6, _safe("Qty"), border=0, align="R", fill=True)
            pdf.cell(30, 6, _safe("Unit"), border=0, align="R", fill=True)
            pdf.cell(35, 6, _safe("Total"), border=0, align="R", fill=True, ln=True)
            pdf.set_text_color(40, 40, 40)
            pdf.set_font("Helvetica", "", 9)
            for it in (invoice.get("items") or []):
                pdf.set_x(15)
                pdf.cell(95, 5, _safe(it.get("description", "")), border="B")
                pdf.cell(20, 5, _safe(str(it.get("quantity", 1))), border="B", align="R")
                pdf.cell(30, 5, _safe(f"{float(it.get('unit_price') or 0):,.2f}"), border="B", align="R")
                pdf.cell(35, 5, _safe(f"{float(it.get('total') or 0):,.2f}"), border="B", align="R", ln=True)
            pdf.ln(2)
        elif key == "totals":
            pdf.ln(1)
            pdf.set_x(140)
            pdf.set_font("Helvetica", "", 10)
            pdf.cell(30, 5, _safe("Subtotal"), align="R")
            pdf.cell(25, 5, _safe(f"{ctx['subtotal']}"), align="R", ln=True)
            pdf.set_x(140)
            pdf.cell(30, 5, _safe("Tax"), align="R")
            pdf.cell(25, 5, _safe(f"{ctx['tax_total']}"), align="R", ln=True)
            pdf.set_x(140)
            pdf.set_fill_color(*primary)
            pdf.set_text_color(255, 255, 255)
            pdf.set_font("Helvetica", "B", 11)
            pdf.cell(30, 7, _safe("TOTAL"), align="R", fill=True)
            pdf.cell(25, 7, _safe(f"{ctx['currency']} {ctx['total']}"), align="R", fill=True, ln=True)
            pdf.set_text_color(40, 40, 40)
            pdf.ln(3)
        elif key == "payment_terms":
            _section_title("Payment Terms")
            _para(_merge_tags(b.get("content", ""), ctx))
        elif key == "notes":
            _section_title("Notes")
            _para(_merge_tags(b.get("content", "") or invoice.get("notes", ""), ctx))
        elif key == "bank_details":
            _section_title("Bank Details")
            _para(_merge_tags(b.get("content", ""), ctx))
        elif key == "qr_pay":
            # Draw a simple URL-encoded QR placeholder via fpdf if a payment URL exists
            url = invoice.get("payment_link") or invoice.get("paymentLink") or ""
            if url:
                _section_title("Pay online")
                _para(url)
        elif key == "thank_you":
            _section_title("")
            pdf.set_font("Helvetica", "I", 10)
            _para(_merge_tags(b.get("content", ""), ctx))
            pdf.set_font("Helvetica", "", 10)
        elif key == "footer":
            pdf.set_y(-22)
            pdf.set_text_color(140, 140, 140)
            pdf.set_font("Helvetica", "I", 8)
            pdf.cell(0, 5, _safe(_merge_tags(b.get("content", ""), ctx)), align="C")
            pdf.set_text_color(40, 40, 40)

    return bytes(pdf.output(dest="S"))


# ─────────────────────── Preview + Live invoice rendering ───────────────────────


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
    """Render a sample invoice through the template; returns the PDF bytes."""
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
    """GET version with token in query — usable in <iframe src> for live preview."""
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
    pdf_bytes = _render_template_pdf(tpl, invoice, branding)
    safe = re.sub(r"[^a-zA-Z0-9_-]", "_", f"INV_{invoice.get('invoice_number', invoice_id)}")
    return Response(content=pdf_bytes, media_type="application/pdf",
                    headers={"Content-Disposition": f"attachment; filename={safe}.pdf"})
