from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import Response
from datetime import datetime, timezone
import os
import jwt
from app.database import db, JWT_SECRET, JWT_ALGORITHM
from app.auth import get_current_user

router = APIRouter()

UPLOAD_DIR = "/app/backend/uploads/branding"


async def _get_user_from_token(token: str = Query(None)):
    """Authenticate via query param token (for PDF downloads opened in new tabs)"""
    if not token:
        raise HTTPException(status_code=401, detail="Token required")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

async def _get_branding():
    """Get branding config from correct collection key"""
    branding = await db.settings.find_one({"type": "branding"}, {"_id": 0})
    if not branding:
        branding = await db.settings.find_one({"key": "whitelabel_options"}, {"_id": 0})
        if branding:
            branding = branding.get("value", {})
    return branding or {}


async def _get_active_theme_config():
    """Get the active invoice theme config"""
    setting = await db.settings.find_one({"type": "invoice_theme"}, {"_id": 0})
    active_id = setting.get("active_theme_id", "theme-modern") if setting else "theme-modern"
    # Check custom themes first
    custom = await db.invoice_themes.find_one({"id": active_id}, {"_id": 0})
    if custom:
        return custom.get("config", {}), active_id
    # Check built-in themes
    from app.routers.invoice_themes import BUILT_IN_THEMES
    for t in BUILT_IN_THEMES:
        if t["id"] == active_id:
            return t.get("config", {}), active_id
    return {}, "theme-modern"


def _hex_to_rgb(hex_str, fallback=(59, 130, 246)):
    hex_str = (hex_str or "").lstrip("#")
    if len(hex_str) == 6:
        return tuple(int(hex_str[i:i+2], 16) for i in (0, 2, 4))
    return fallback


def _safe_latin(text):
    return str(text or "").encode('latin-1', 'ignore').decode('latin-1')


def generate_invoice_pdf(invoice, branding=None, theme_config=None):
    """Generate a professional branded invoice PDF with theme support"""
    from fpdf import FPDF

    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=25)
    pdf.add_page()

    theme = theme_config or {}
    layout = theme.get("layout", "modern")

    company_name = "NexusOps"
    primary_color = (59, 130, 246)
    secondary_color = (139, 92, 246)
    accent_color = (6, 182, 212)
    invoice_footer = ""
    logo_path = None

    if branding:
        company_name = branding.get("company_name", "NexusOps")
        primary_color = _hex_to_rgb(branding.get("primary_color", "#3B82F6"))
        secondary_color = _hex_to_rgb(branding.get("secondary_color", "#8B5CF6"), (139, 92, 246))
        accent_color = _hex_to_rgb(branding.get("accent_color", "#06B6D4"), (6, 182, 212))
        invoice_footer = _safe_latin(branding.get("invoice_footer_text", ""))

        for logo_key in ["invoice_logo_url", "company_logo_url", "letterhead_logo_url"]:
            logo_url = branding.get(logo_key, "")
            if logo_url:
                if logo_url.startswith("/api/uploads/"):
                    fp = os.path.join("/app/backend", logo_url.replace("/api/", "").lstrip("/"))
                elif logo_url.startswith("/uploads/"):
                    fp = os.path.join("/app/backend", logo_url.lstrip("/"))
                else:
                    fp = os.path.join(UPLOAD_DIR, os.path.basename(logo_url))
                if os.path.isfile(fp) and os.path.getsize(fp) > 100:
                    logo_path = fp
                    break

    # Override colors based on theme color_scheme
    color_scheme = theme.get("color_scheme", "brand")
    if color_scheme == "monochrome":
        primary_color = (31, 41, 55)
        accent_color = (55, 65, 81)
    elif color_scheme == "light":
        primary_color = (107, 114, 128)
        accent_color = (156, 163, 175)
    elif color_scheme == "vibrant":
        primary_color = (124, 58, 237)
        accent_color = (168, 85, 247)
    elif color_scheme == "dark_gold":
        primary_color = (15, 23, 42)
        accent_color = (245, 158, 11)

    cn = _safe_latin(company_name)
    inv_num = invoice.get("invoice_number", "N/A")

    # ──────── HEADER (varies by theme) ────────
    header_style = theme.get("header_style", "bar")

    if layout == "classic" or header_style == "full_width":
        # Classic: dark full-width header with formal borders
        pdf.set_fill_color(*primary_color)
        pdf.rect(0, 0, 210, 40, 'F')
        if logo_path:
            try:
                pdf.image(logo_path, 10, 7, 26, 26)
                x_text = 40
            except Exception:
                x_text = 12
        else:
            x_text = 12
        pdf.set_text_color(255, 255, 255)
        pdf.set_font("Helvetica", "B", 20)
        pdf.set_xy(x_text, 8)
        pdf.cell(100, 10, cn)
        pdf.set_font("Helvetica", "", 9)
        pdf.set_xy(x_text, 20)
        pdf.cell(100, 6, "TAX INVOICE")
        pdf.set_font("Helvetica", "B", 12)
        pdf.set_xy(120, 10)
        pdf.cell(80, 10, f"#{inv_num}", align="R")
        pdf.set_y(45)

    elif layout == "minimal" or header_style == "line_only":
        # Minimal: just company name + thin line
        pdf.set_text_color(55, 65, 81)
        pdf.set_font("Helvetica", "B", 22)
        pdf.set_xy(10, 10)
        if logo_path:
            try:
                pdf.image(logo_path, 10, 8, 20, 20)
                pdf.set_xy(34, 10)
            except Exception:
                pass
        pdf.cell(100, 10, cn)
        pdf.set_font("Helvetica", "", 10)
        pdf.set_xy(120, 12)
        pdf.set_text_color(107, 114, 128)
        pdf.cell(80, 8, f"Invoice #{inv_num}", align="R")
        pdf.set_draw_color(*primary_color)
        pdf.set_line_width(0.5)
        pdf.line(10, 30, 200, 30)
        pdf.set_line_width(0.2)
        pdf.set_y(35)

    elif layout == "bold" or header_style == "full_bleed":
        # Bold: large colored header, full bleed
        pdf.set_fill_color(*primary_color)
        pdf.rect(0, 0, 210, 50, 'F')
        pdf.set_fill_color(*accent_color)
        pdf.rect(0, 48, 210, 3, 'F')
        if logo_path:
            try:
                pdf.image(logo_path, 12, 8, 30, 30)
                x_text = 46
            except Exception:
                x_text = 14
        else:
            x_text = 14
        pdf.set_text_color(255, 255, 255)
        pdf.set_font("Helvetica", "B", 24)
        pdf.set_xy(x_text, 8)
        pdf.cell(100, 12, cn)
        pdf.set_font("Helvetica", "", 32)
        pdf.set_xy(110, 6)
        pdf.cell(90, 16, "INVOICE", align="R")
        pdf.set_font("Helvetica", "", 11)
        pdf.set_xy(110, 30)
        pdf.cell(90, 8, f"#{inv_num}", align="R")
        pdf.set_y(56)

    elif layout == "executive" or header_style == "split":
        # Executive: split header - dark left, accent right
        pdf.set_fill_color(*primary_color)
        pdf.rect(0, 0, 140, 38, 'F')
        pdf.set_fill_color(*accent_color)
        pdf.rect(140, 0, 70, 38, 'F')
        if logo_path:
            try:
                pdf.image(logo_path, 10, 6, 24, 24)
                x_text = 38
            except Exception:
                x_text = 12
        else:
            x_text = 12
        pdf.set_text_color(255, 255, 255)
        pdf.set_font("Helvetica", "B", 18)
        pdf.set_xy(x_text, 8)
        pdf.cell(90, 10, cn)
        pdf.set_font("Helvetica", "", 8)
        pdf.set_xy(x_text, 20)
        pdf.cell(90, 5, "PREMIUM INVOICE")
        # Right accent panel
        pdf.set_font("Helvetica", "B", 14)
        pdf.set_text_color(15, 23, 42)
        pdf.set_xy(142, 10)
        pdf.cell(60, 10, f"#{inv_num}", align="C")
        pdf.set_y(43)

    else:
        # Modern (default): accent bar header
        pdf.set_fill_color(*primary_color)
        pdf.rect(0, 0, 210, 35, 'F')
        pdf.set_fill_color(*accent_color)
        pdf.rect(0, 33, 210, 2, 'F')
        if logo_path:
            try:
                pdf.image(logo_path, 10, 5, 25, 25)
                x_text = 38
            except Exception:
                x_text = 12
        else:
            x_text = 12
        pdf.set_text_color(255, 255, 255)
        pdf.set_font("Helvetica", "B", 18)
        pdf.set_xy(x_text, 7)
        pdf.cell(100, 10, cn)
        pdf.set_font("Helvetica", "", 28)
        pdf.set_xy(120, 4)
        pdf.cell(80, 14, "INVOICE", align="R")
        pdf.set_font("Helvetica", "", 10)
        pdf.set_xy(120, 20)
        pdf.cell(80, 6, f"#{inv_num}", align="R")
        pdf.set_y(42)

    # ──────── BILL TO / DETAILS ────────
    pdf.set_font("Helvetica", "B", 8)
    pdf.set_text_color(*primary_color)
    pdf.cell(100, 5, "BILL TO")
    pdf.cell(90, 5, "INVOICE DETAILS", align="R")
    pdf.ln()

    pdf.set_font("Helvetica", "B", 12)
    pdf.set_text_color(30, 30, 30)
    client_name = _safe_latin(invoice.get("client_name", "N/A"))
    pdf.cell(100, 7, client_name, ln=False)

    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(80, 80, 80)
    pdf.cell(90, 7, f"Invoice #: {inv_num}", align="R")
    pdf.ln()

    client_email = _safe_latin(invoice.get("client_email", ""))
    if client_email:
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(100, 100, 100)
        pdf.cell(100, 5, client_email, ln=False)
    else:
        pdf.cell(100, 5, "", ln=False)

    due_date = invoice.get("due_date", "N/A")
    pdf.cell(90, 5, f"Due Date: {due_date}", align="R")
    pdf.ln()

    created = str(invoice.get("created_at", ""))[:10] or "N/A"
    pdf.cell(100, 5, "", ln=False)
    pdf.cell(90, 5, f"Issue Date: {created}", align="R")
    pdf.ln()

    status = (invoice.get("status") or "draft").replace("_", " ").title()
    payment_status = (invoice.get("payment_status") or "unpaid").replace("_", " ").title()
    pdf.cell(100, 5, "", ln=False)
    pdf.cell(90, 5, f"Status: {status}  |  Payment: {payment_status}", align="R")
    pdf.ln(10)

    # ──────── LINE ITEMS TABLE ────────
    line_item_style = theme.get("line_item_style", "striped")
    col_w = [75, 35, 20, 35, 25]
    headers_list = ["Item", "Description", "Qty", "Unit Price", "Total"]

    if line_item_style == "bordered":
        pdf.set_fill_color(*primary_color)
        pdf.set_text_color(255, 255, 255)
        pdf.set_font("Helvetica", "B", 9)
        for i, h in enumerate(headers_list):
            al = "R" if i >= 3 else "C" if i == 2 else "L"
            pdf.cell(col_w[i], 9, f"  {h}" if i == 0 else h, 1, 0, al, True)
        pdf.ln()
        line_items = invoice.get("line_items") or []
        pdf.set_font("Helvetica", "", 9)
        for li in line_items:
            pdf.set_text_color(40, 40, 40)
            name = _safe_latin(str(li.get("name", ""))[:38])
            desc = _safe_latin(str(li.get("description", ""))[:20])
            qty = li.get("quantity", 0)
            price = float(li.get("unit_price", 0))
            total = (qty or 0) * price
            pdf.cell(col_w[0], 8, f"  {name}", 1, 0, "L")
            pdf.cell(col_w[1], 8, desc, 1, 0, "L")
            pdf.cell(col_w[2], 8, str(qty), 1, 0, "C")
            pdf.cell(col_w[3], 8, f"${price:,.2f}", 1, 0, "R")
            pdf.cell(col_w[4], 8, f"${total:,.2f}", 1, 1, "R")
    elif line_item_style == "simple":
        pdf.set_text_color(*primary_color)
        pdf.set_font("Helvetica", "B", 9)
        for i, h in enumerate(headers_list):
            al = "R" if i >= 3 else "C" if i == 2 else "L"
            pdf.cell(col_w[i], 8, f"  {h}" if i == 0 else h, 0, 0, al)
        pdf.ln()
        pdf.set_draw_color(200, 200, 200)
        pdf.line(10, pdf.get_y(), 200, pdf.get_y())
        pdf.ln(1)
        line_items = invoice.get("line_items") or []
        pdf.set_font("Helvetica", "", 9)
        for li in line_items:
            pdf.set_text_color(60, 60, 60)
            name = _safe_latin(str(li.get("name", ""))[:38])
            desc = _safe_latin(str(li.get("description", ""))[:20])
            qty = li.get("quantity", 0)
            price = float(li.get("unit_price", 0))
            total = (qty or 0) * price
            pdf.cell(col_w[0], 7, f"  {name}", 0, 0, "L")
            pdf.cell(col_w[1], 7, desc, 0, 0, "L")
            pdf.cell(col_w[2], 7, str(qty), 0, 0, "C")
            pdf.cell(col_w[3], 7, f"${price:,.2f}", 0, 0, "R")
            pdf.cell(col_w[4], 7, f"${total:,.2f}", 0, 1, "R")
    else:
        # Default striped / highlight_totals / premium
        pdf.set_fill_color(*primary_color)
        pdf.set_text_color(255, 255, 255)
        pdf.set_font("Helvetica", "B", 9)
        for i, h in enumerate(headers_list):
            al = "R" if i >= 3 else "C" if i == 2 else "L"
            pdf.cell(col_w[i], 9, f"  {h}" if i == 0 else h, 0, 0, al, True)
        pdf.ln()
        line_items = invoice.get("line_items") or []
        pdf.set_font("Helvetica", "", 9)
        for idx, li in enumerate(line_items):
            if idx % 2 == 1:
                pdf.set_fill_color(245, 247, 250)
            else:
                pdf.set_fill_color(255, 255, 255)
            pdf.set_text_color(40, 40, 40)
            name = _safe_latin(str(li.get("name", ""))[:38])
            desc = _safe_latin(str(li.get("description", ""))[:20])
            qty = li.get("quantity", 0)
            price = float(li.get("unit_price", 0))
            total = (qty or 0) * price
            pdf.cell(col_w[0], 8, f"  {name}", 0, 0, "L", True)
            pdf.cell(col_w[1], 8, desc, 0, 0, "L", True)
            pdf.cell(col_w[2], 8, str(qty), 0, 0, "C", True)
            pdf.cell(col_w[3], 8, f"${price:,.2f}", 0, 0, "R", True)
            pdf.cell(col_w[4], 8, f"${total:,.2f}", 0, 1, "R", True)

    # Bottom line
    pdf.set_draw_color(*primary_color)
    pdf.set_line_width(0.5)
    pdf.line(10, pdf.get_y(), 200, pdf.get_y())
    pdf.set_line_width(0.2)
    pdf.ln(5)

    # ──────── TOTALS ────────
    subtotal = float(invoice.get("subtotal", 0))
    tax_rate = float(invoice.get("tax_rate", 0))
    tax = float(invoice.get("tax", 0))
    total = float(invoice.get("total", 0))
    amount_paid = float(invoice.get("amount_paid", 0))
    balance = total - amount_paid
    discount = float(invoice.get("discount", 0))

    box_x = 120

    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(100, 100, 100)
    pdf.set_xy(box_x, pdf.get_y())
    pdf.cell(40, 6, "Subtotal:", 0, 0, "R")
    pdf.cell(40, 6, f"${subtotal:,.2f}", 0, 1, "R")

    if discount > 0:
        pdf.set_xy(box_x, pdf.get_y())
        pdf.set_text_color(220, 38, 38)
        pdf.cell(40, 6, "Discount:", 0, 0, "R")
        pdf.cell(40, 6, f"-${discount:,.2f}", 0, 1, "R")

    if tax_rate > 0:
        pdf.set_xy(box_x, pdf.get_y())
        pdf.set_text_color(100, 100, 100)
        pdf.cell(40, 6, f"Tax ({tax_rate}%):", 0, 0, "R")
        pdf.cell(40, 6, f"${tax:,.2f}", 0, 1, "R")

    pdf.set_draw_color(180, 180, 180)
    pdf.line(box_x, pdf.get_y() + 1, 200, pdf.get_y() + 1)
    pdf.ln(3)
    pdf.set_xy(box_x, pdf.get_y())
    pdf.set_font("Helvetica", "B", 14)
    pdf.set_text_color(30, 30, 30)
    pdf.cell(40, 8, "Total:", 0, 0, "R")
    pdf.cell(40, 8, f"${total:,.2f}", 0, 1, "R")

    if amount_paid > 0:
        pdf.set_xy(box_x, pdf.get_y())
        pdf.set_font("Helvetica", "", 10)
        pdf.set_text_color(34, 197, 94)
        pdf.cell(40, 6, "Amount Paid:", 0, 0, "R")
        pdf.cell(40, 6, f"-${amount_paid:,.2f}", 0, 1, "R")

    if balance > 0.01:
        pdf.set_xy(box_x, pdf.get_y())
        pdf.set_fill_color(254, 242, 242)
        pdf.set_font("Helvetica", "B", 13)
        pdf.set_text_color(220, 38, 38)
        pdf.cell(40, 9, "Balance Due:", 0, 0, "R", True)
        pdf.cell(40, 9, f"${balance:,.2f}", 0, 1, "R", True)
    elif balance <= 0.01 and total > 0:
        pdf.set_xy(box_x, pdf.get_y())
        pdf.set_fill_color(240, 253, 244)
        pdf.set_font("Helvetica", "B", 12)
        pdf.set_text_color(34, 197, 94)
        pdf.cell(80, 9, "PAID IN FULL", 0, 1, "C", True)

    # ──────── PAYMENT HISTORY ────────
    payments = invoice.get("payments") or []
    if payments:
        pdf.ln(8)
        pdf.set_font("Helvetica", "B", 10)
        pdf.set_text_color(*primary_color)
        pdf.cell(0, 7, "Payment History", ln=True)
        pdf.set_draw_color(*primary_color)
        pdf.line(10, pdf.get_y(), 80, pdf.get_y())
        pdf.ln(3)
        pdf.set_font("Helvetica", "B", 8)
        pdf.set_text_color(100, 100, 100)
        pdf.cell(35, 5, "Date", 0, 0)
        pdf.cell(30, 5, "Method", 0, 0)
        pdf.cell(65, 5, "Reference", 0, 0)
        pdf.cell(30, 5, "Amount", 0, 1, "R")
        pdf.set_font("Helvetica", "", 9)
        for p in payments:
            pdf.set_text_color(60, 60, 60)
            date_str = str(p.get("date", ""))[:10]
            method = str(p.get("method", "")).replace("_", " ").title()
            ref = _safe_latin(str(p.get("reference") or p.get("session_id", "")[:16] or ""))
            amt = float(p.get("amount", 0))
            pdf.cell(35, 6, date_str, 0, 0)
            pdf.cell(30, 6, method, 0, 0)
            pdf.cell(65, 6, ref, 0, 0)
            pdf.set_text_color(34, 197, 94)
            pdf.cell(30, 6, f"${amt:,.2f}", 0, 1, "R")

    # ──────── NOTES ────────
    notes = _safe_latin(invoice.get("notes", ""))
    if notes:
        pdf.ln(6)
        pdf.set_font("Helvetica", "B", 9)
        pdf.set_text_color(*primary_color)
        pdf.cell(0, 5, "Notes", ln=True)
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(80, 80, 80)
        pdf.multi_cell(0, 5, notes[:600])

    # ──────── FOOTER ────────
    footer_style = theme.get("footer_style", "minimal")
    pdf.set_y(-30)
    pdf.set_draw_color(*accent_color)
    pdf.set_line_width(0.8)
    pdf.line(10, pdf.get_y(), 200, pdf.get_y())
    pdf.set_line_width(0.2)
    pdf.ln(3)
    pdf.set_font("Helvetica", "I", 8)
    pdf.set_text_color(140, 140, 140)
    if invoice_footer:
        pdf.cell(0, 4, invoice_footer[:120], ln=True, align="C")
    if footer_style == "full" or footer_style == "branded":
        pdf.cell(0, 4, f"Generated by {cn} on {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}", ln=True, align="C")
    pdf.cell(0, 4, "Thank you for your business!", ln=True, align="C")

    return pdf.output()


@router.get("/invoices/{invoice_id}/pdf")
async def get_invoice_pdf(invoice_id: str, user: dict = Depends(_get_user_from_token)):
    """Generate and return invoice as PDF for preview"""
    invoice = await db.xero_invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    branding = await _get_branding()
    theme_config, _ = await _get_active_theme_config()
    pdf_bytes = generate_invoice_pdf(invoice, branding, theme_config)
    inv_num = invoice.get("invoice_number", "invoice")

    return Response(
        content=bytes(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{inv_num}.pdf"'}
    )


@router.get("/invoices/{invoice_id}/pdf/download")
async def download_invoice_pdf(invoice_id: str, user: dict = Depends(_get_user_from_token)):
    """Download invoice as PDF attachment"""
    invoice = await db.xero_invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    branding = await _get_branding()
    theme_config, _ = await _get_active_theme_config()
    pdf_bytes = generate_invoice_pdf(invoice, branding, theme_config)
    inv_num = invoice.get("invoice_number", "invoice")

    return Response(
        content=bytes(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{inv_num}.pdf"'}
    )
