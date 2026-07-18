from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import Response
from datetime import datetime, timezone
from typing import Optional
import uuid
import os
import asyncio
import logging
from app.database import db
from app.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()


async def _po_audit(po_id, action, details, user):
    await db.po_audit_log.insert_one({
        "id": str(uuid.uuid4()), "po_id": po_id, "action": action,
        "details": details, "user_id": user.get("id", "system"),
        "user_name": user.get("name", "System"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })


# ============== PO PDF GENERATION ==============

@router.get("/purchase-orders/{po_id}/pdf")
async def generate_po_pdf(po_id: str, current_user: dict = Depends(get_current_user)):
    po = await db.purchase_orders.find_one({"id": po_id}, {"_id": 0})
    if not po:
        raise HTTPException(status_code=404, detail="PO not found")
    branding = await db.settings.find_one({"type": "branding"}, {"_id": 0}) or {}
    from fpdf import FPDF

    company_name = branding.get("company_name", "NexusOps")
    hex_c = branding.get("primary_color", "#3B82F6").lstrip("#")
    primary = tuple(int(hex_c[i:i+2], 16) for i in (0, 2, 4)) if len(hex_c) == 6 else (59, 130, 246)
    hex_a = branding.get("accent_color", "#06B6D4").lstrip("#")
    accent = tuple(int(hex_a[i:i+2], 16) for i in (0, 2, 4)) if len(hex_a) == 6 else (6, 182, 212)

    logo_path = None
    for key in ["company_logo_url", "invoice_logo_url"]:
        url = branding.get(key, "")
        if url:
            fp = f"/app/backend{url}" if url.startswith("/uploads/") else os.path.join("/app/backend/uploads/branding", os.path.basename(url))
            if os.path.isfile(fp):
                logo_path = fp
                break

    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=25)
    pdf.add_page()

    # Header
    pdf.set_fill_color(*primary)
    pdf.rect(0, 0, 210, 35, 'F')
    pdf.set_fill_color(*accent)
    pdf.rect(0, 33, 210, 2, 'F')

    x_text = 12
    if logo_path:
        try:
            pdf.image(logo_path, 10, 5, 25, 25)
            x_text = 38
        except Exception:
            pass

    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 18)
    pdf.set_xy(x_text, 7)
    cn = company_name.encode('latin-1', 'ignore').decode('latin-1')
    pdf.cell(100, 10, cn)
    pdf.set_font("Helvetica", "", 28)
    pdf.set_xy(120, 4)
    pdf.cell(80, 14, "PURCHASE ORDER", align="R")
    pdf.set_font("Helvetica", "", 10)
    pdf.set_xy(120, 20)
    pdf.cell(80, 6, f"#{po.get('po_number', 'N/A')}", align="R")

    # Vendor & PO Details
    pdf.set_y(42)
    pdf.set_font("Helvetica", "B", 8)
    pdf.set_text_color(*primary)
    pdf.cell(100, 5, "VENDOR")
    pdf.cell(90, 5, "ORDER DETAILS", align="R")
    pdf.ln()

    pdf.set_font("Helvetica", "B", 12)
    pdf.set_text_color(30, 30, 30)
    vendor = (po.get("vendor") or "N/A").encode('latin-1', 'ignore').decode('latin-1')
    pdf.cell(100, 7, vendor, ln=False)
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(80, 80, 80)
    pdf.cell(90, 7, f"PO #: {po.get('po_number', 'N/A')}", align="R")
    pdf.ln()

    contact = (po.get("vendor_contact") or "").encode('latin-1', 'ignore').decode('latin-1')
    email = (po.get("vendor_email") or "").encode('latin-1', 'ignore').decode('latin-1')
    if contact:
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(100, 100, 100)
        pdf.cell(100, 5, f"Contact: {contact}", ln=False)
    else:
        pdf.cell(100, 5, "", ln=False)
    pdf.cell(90, 5, f"Date: {str(po.get('created_at', ''))[:10]}", align="R")
    pdf.ln()

    if email:
        pdf.cell(100, 5, f"Email: {email}", ln=False)
    else:
        pdf.cell(100, 5, "", ln=False)
    exp = po.get("expected_delivery", "N/A")
    pdf.cell(90, 5, f"Expected Delivery: {exp}", align="R")
    pdf.ln()

    status = (po.get("status") or "draft").replace("_", " ").title()
    pdf.cell(100, 5, "", ln=False)
    pdf.cell(90, 5, f"Status: {status}", align="R")
    pdf.ln()

    ship_to = (po.get("ship_to") or "").encode('latin-1', 'ignore').decode('latin-1')
    if ship_to:
        pdf.set_font("Helvetica", "B", 8)
        pdf.set_text_color(*primary)
        pdf.cell(0, 5, "SHIP TO")
        pdf.ln()
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(80, 80, 80)
        pdf.multi_cell(100, 5, ship_to)
    pdf.ln(5)

    # Line items table
    col_w = [80, 20, 35, 25, 30]
    headers = ["Item", "Qty", "Unit Price", "Received", "Total"]
    pdf.set_fill_color(*primary)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 9)
    for i, h in enumerate(headers):
        al = "R" if i >= 2 else "C" if i == 1 else "L"
        pdf.cell(col_w[i], 9, f"  {h}" if i == 0 else h, 0, 0, al, True)
    pdf.ln()

    for idx, li in enumerate(po.get("line_items", [])):
        pdf.set_fill_color(245, 247, 250) if idx % 2 == 1 else pdf.set_fill_color(255, 255, 255)
        pdf.set_text_color(40, 40, 40)
        pdf.set_font("Helvetica", "", 9)
        name = (str(li.get("product_name", li.get("name", "")))[:40]).encode('latin-1', 'ignore').decode('latin-1')
        qty = li.get("quantity", 0)
        price = float(li.get("unit_price", 0))
        received = li.get("received_qty", 0)
        total = qty * price
        pdf.cell(col_w[0], 8, f"  {name}", 0, 0, "L", True)
        pdf.cell(col_w[1], 8, str(qty), 0, 0, "C", True)
        pdf.cell(col_w[2], 8, f"${price:,.2f}", 0, 0, "R", True)
        recv_color = (34, 197, 94) if received >= qty else (220, 38, 38) if received > 0 else (100, 100, 100)
        pdf.set_text_color(*recv_color)
        pdf.cell(col_w[3], 8, f"{received}/{qty}", 0, 0, "C", True)
        pdf.set_text_color(40, 40, 40)
        pdf.cell(col_w[4], 8, f"${total:,.2f}", 0, 1, "R", True)

    pdf.set_draw_color(*primary)
    pdf.set_line_width(0.5)
    pdf.line(10, pdf.get_y(), 200, pdf.get_y())
    pdf.set_line_width(0.2)
    pdf.ln(5)

    # Totals
    box_x = 120
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(100, 100, 100)
    pdf.set_xy(box_x, pdf.get_y())
    pdf.cell(40, 6, "Subtotal:", 0, 0, "R")
    pdf.cell(40, 6, f"${po.get('subtotal', 0):,.2f}", 0, 1, "R")
    if po.get("tax", 0) > 0:
        pdf.set_xy(box_x, pdf.get_y())
        pdf.cell(40, 6, "Tax:", 0, 0, "R")
        pdf.cell(40, 6, f"${po.get('tax', 0):,.2f}", 0, 1, "R")
    if po.get("shipping", 0) > 0:
        pdf.set_xy(box_x, pdf.get_y())
        pdf.cell(40, 6, "Shipping:", 0, 0, "R")
        pdf.cell(40, 6, f"${po.get('shipping', 0):,.2f}", 0, 1, "R")
    pdf.set_draw_color(180, 180, 180)
    pdf.line(box_x, pdf.get_y() + 1, 200, pdf.get_y() + 1)
    pdf.ln(3)
    pdf.set_xy(box_x, pdf.get_y())
    pdf.set_font("Helvetica", "B", 14)
    pdf.set_text_color(30, 30, 30)
    pdf.cell(40, 8, "Total:", 0, 0, "R")
    pdf.cell(40, 8, f"${po.get('total', 0):,.2f}", 0, 1, "R")

    # Approval info
    if po.get("approved_by_name"):
        pdf.ln(5)
        pdf.set_font("Helvetica", "B", 9)
        pdf.set_text_color(*primary)
        pdf.cell(0, 5, "APPROVAL", ln=True)
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(80, 80, 80)
        pdf.cell(0, 5, f"Approved by: {po.get('approved_by_name', '')} on {str(po.get('approved_at', ''))[:10]}", ln=True)

    # Notes
    notes = (po.get("notes") or "").encode('latin-1', 'ignore').decode('latin-1')
    if notes:
        pdf.ln(3)
        pdf.set_font("Helvetica", "B", 9)
        pdf.set_text_color(*primary)
        pdf.cell(0, 5, "NOTES", ln=True)
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(80, 80, 80)
        pdf.multi_cell(0, 5, notes[:500])

    # Footer
    pdf.set_y(-30)
    pdf.set_draw_color(*accent)
    pdf.set_line_width(0.8)
    pdf.line(10, pdf.get_y(), 200, pdf.get_y())
    pdf.set_line_width(0.2)
    pdf.ln(3)
    pdf.set_font("Helvetica", "I", 8)
    pdf.set_text_color(140, 140, 140)
    footer = (branding.get("invoice_footer_text") or "").encode('latin-1', 'ignore').decode('latin-1')
    if footer:
        pdf.cell(0, 4, footer[:120], ln=True, align="C")
    pdf.cell(0, 4, f"Generated by {cn} on {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}", ln=True, align="C")

    return Response(content=bytes(pdf.output()), media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="PO_{po.get("po_number", po_id)}.pdf"'})


# ============== APPROVAL WORKFLOW ==============

@router.post("/purchase-orders/{po_id}/submit-for-approval")
async def submit_po_for_approval(po_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    po = await db.purchase_orders.find_one({"id": po_id}, {"_id": 0})
    if not po:
        raise HTTPException(status_code=404, detail="PO not found")
    if po.get("status") != "draft":
        raise HTTPException(status_code=400, detail="Only draft POs can be submitted for approval")
    approver_id = data.get("approver_id", "")
    approver_name = data.get("approver_name", "")
    await db.purchase_orders.update_one({"id": po_id}, {"$set": {
        "status": "pending_approval",
        "approval_requested_by": current_user["id"],
        "approval_requested_by_name": current_user.get("name", ""),
        "approval_requested_at": datetime.now(timezone.utc).isoformat(),
        "approver_id": approver_id,
        "approver_name": approver_name,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }})
    if approver_id:
        await db.notifications.insert_one({
            "id": str(uuid.uuid4()), "user_id": approver_id,
            "title": f"PO {po['po_number']} needs approval",
            "message": f"{current_user.get('name', '')} submitted PO {po['po_number']} (${po.get('total', 0):.2f}) for your approval.",
            "severity": "info", "type": "po_approval",
            "ref_type": "purchase_order", "ref_id": po_id,
            "read": False, "created_at": datetime.now(timezone.utc).isoformat(),
        })
    await _po_audit(po_id, "submitted_for_approval", f"Submitted for approval to {approver_name or 'management'}", current_user)
    return {"message": "PO submitted for approval"}


@router.post("/purchase-orders/{po_id}/approve")
async def approve_po(po_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    po = await db.purchase_orders.find_one({"id": po_id}, {"_id": 0})
    if not po:
        raise HTTPException(status_code=404, detail="PO not found")
    if po.get("status") not in ("pending_approval", "draft"):
        raise HTTPException(status_code=400, detail="PO is not pending approval")
    await db.purchase_orders.update_one({"id": po_id}, {"$set": {
        "status": "approved",
        "approved_by": current_user["id"],
        "approved_by_name": current_user.get("name", ""),
        "approved_at": datetime.now(timezone.utc).isoformat(),
        "approval_notes": data.get("notes", ""),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }})
    await _po_audit(po_id, "approved", f"Approved by {current_user.get('name', '')}: {data.get('notes', '')}", current_user)
    return {"message": "PO approved"}


@router.post("/purchase-orders/{po_id}/reject")
async def reject_po(po_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    po = await db.purchase_orders.find_one({"id": po_id}, {"_id": 0})
    if not po:
        raise HTTPException(status_code=404, detail="PO not found")
    reason = data.get("reason", "")
    await db.purchase_orders.update_one({"id": po_id}, {"$set": {
        "status": "rejected",
        "rejected_by": current_user["id"],
        "rejected_by_name": current_user.get("name", ""),
        "rejected_at": datetime.now(timezone.utc).isoformat(),
        "rejection_reason": reason,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }})
    await _po_audit(po_id, "rejected", f"Rejected by {current_user.get('name', '')}: {reason}", current_user)
    return {"message": "PO rejected"}


# ============== EMAIL PO TO VENDOR ==============

@router.post("/purchase-orders/{po_id}/email-vendor")
async def email_po_to_vendor(po_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    po = await db.purchase_orders.find_one({"id": po_id}, {"_id": 0})
    if not po:
        raise HTTPException(status_code=404, detail="PO not found")
    email = data.get("email") or po.get("vendor_email", "")
    if not email:
        raise HTTPException(status_code=400, detail="No vendor email provided")
    subject = data.get("subject", f"Purchase Order {po.get('po_number', '')} from NexusOps")
    message = data.get("message", f"Please find attached Purchase Order {po.get('po_number', '')}.")
    from app.routers.email_signatures import append_default_signature
    email_body, _, signature_id = await append_default_signature(
        body=(
            f"<div style='font-family:sans-serif;'><p>{message}</p><hr/>"
            f"<p>PO: {po.get('po_number', '')}<br/>Total: ${po.get('total', 0):.2f}<br/>"
            f"Expected Delivery: {po.get('expected_delivery', 'TBA')}</p></div>"
        ),
        body_type="html",
        current_user=current_user,
        subject=subject,
    )
    from app.routers.email_utils import send_email
    delivery = await send_email(email, subject, email_body, category="billing")
    sent = delivery.get("status") == "sent"
    await db.purchase_orders.update_one({"id": po_id}, {"$set": {
        "status": "submitted" if po.get("status") in ("approved", "draft") else po.get("status"),
        "emailed_to": email,
        "emailed_at": datetime.now(timezone.utc).isoformat(),
        "email_signature_id": signature_id,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }})
    await _po_audit(po_id, "emailed_to_vendor", f"PO emailed to {email} ({delivery.get('status')})", current_user)
    return {"message": delivery.get("message", f"PO emailed to {email}"), "sent": sent, "delivery_status": delivery.get("status"), "sender_mailbox": delivery.get("sender")}


# ============== PO NOTES / COMMENTS ==============

@router.get("/purchase-orders/{po_id}/notes")
async def get_po_notes(po_id: str, current_user: dict = Depends(get_current_user)):
    notes = await db.po_notes.find({"po_id": po_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return notes


@router.post("/purchase-orders/{po_id}/notes")
async def add_po_note(po_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    note = {
        "id": str(uuid.uuid4()),
        "po_id": po_id,
        "user_id": current_user["id"],
        "user_name": current_user.get("name", ""),
        "content": data.get("content", ""),
        "note_type": data.get("note_type", "general"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.po_notes.insert_one(note)
    note.pop("_id", None)
    await _po_audit(po_id, "note_added", f"Note by {current_user.get('name', '')}", current_user)
    return note


# ============== DUPLICATE PO ==============

@router.post("/purchase-orders/{po_id}/duplicate")
async def duplicate_po(po_id: str, current_user: dict = Depends(get_current_user)):
    po = await db.purchase_orders.find_one({"id": po_id}, {"_id": 0})
    if not po:
        raise HTTPException(status_code=404, detail="PO not found")
    count = await db.purchase_orders.count_documents({})
    new_po = {**po}
    new_po["id"] = str(uuid.uuid4())
    new_po["po_number"] = f"PO-{count + 1001:04d}"
    new_po["status"] = "draft"
    new_po["created_by"] = current_user["id"]
    new_po["created_by_name"] = current_user.get("name", "")
    new_po["created_at"] = datetime.now(timezone.utc).isoformat()
    new_po["updated_at"] = datetime.now(timezone.utc).isoformat()
    for key in ["approved_by", "approved_by_name", "approved_at", "approval_notes",
                "rejected_by", "rejected_by_name", "rejected_at", "rejection_reason",
                "emailed_to", "emailed_at", "last_ping_at", "escalated", "escalated_at"]:
        new_po.pop(key, None)
    for li in new_po.get("line_items", []):
        li["received_qty"] = 0
        li["status"] = "pending"
    await db.purchase_orders.insert_one(new_po)
    new_po.pop("_id", None)
    await _po_audit(new_po["id"], "created", f"Duplicated from {po.get('po_number', '')}", current_user)
    return new_po


# ============== PO TEMPLATES ==============

@router.get("/purchase-order-templates")
async def get_po_templates(current_user: dict = Depends(get_current_user)):
    templates = await db.po_templates.find({}, {"_id": 0}).sort("name", 1).to_list(100)
    return templates


@router.post("/purchase-order-templates")
async def create_po_template(data: dict, current_user: dict = Depends(get_current_user)):
    template = {
        "id": str(uuid.uuid4()),
        "name": data.get("name", ""),
        "vendor": data.get("vendor", ""),
        "vendor_id": data.get("vendor_id", ""),
        "vendor_email": data.get("vendor_email", ""),
        "line_items": data.get("line_items", []),
        "notes": data.get("notes", ""),
        "ship_to": data.get("ship_to", ""),
        "created_by": current_user["id"],
        "created_by_name": current_user.get("name", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.po_templates.insert_one(template)
    template.pop("_id", None)
    return template


@router.delete("/purchase-order-templates/{template_id}")
async def delete_po_template(template_id: str, current_user: dict = Depends(get_current_user)):
    await db.po_templates.delete_one({"id": template_id})
    return {"message": "Template deleted"}


# ============== PO SPEND ANALYTICS ==============

@router.get("/purchase-orders/analytics/spend")
async def get_po_spend_analytics(current_user: dict = Depends(get_current_user)):
    all_pos = await db.purchase_orders.find({}, {"_id": 0}).to_list(10000)
    vendor_spend = {}
    monthly_spend = {}
    status_counts = {}
    for po in all_pos:
        vendor = po.get("vendor", "Unknown")
        vendor_spend[vendor] = vendor_spend.get(vendor, 0) + po.get("total", 0)
        month = str(po.get("created_at", ""))[:7]
        if month:
            monthly_spend[month] = monthly_spend.get(month, 0) + po.get("total", 0)
        status = po.get("status", "unknown")
        status_counts[status] = status_counts.get(status, 0) + 1
    top_vendors = sorted(vendor_spend.items(), key=lambda x: x[1], reverse=True)[:10]
    monthly_sorted = sorted(monthly_spend.items())[-12:]
    total_spend = sum(po.get("total", 0) for po in all_pos)
    avg_po_value = total_spend / len(all_pos) if all_pos else 0
    return {
        "total_spend": round(total_spend, 2),
        "total_pos": len(all_pos),
        "avg_po_value": round(avg_po_value, 2),
        "top_vendors": [{"vendor": v, "spend": round(s, 2)} for v, s in top_vendors],
        "monthly_spend": [{"month": m, "spend": round(s, 2)} for m, s in monthly_sorted],
        "status_breakdown": status_counts,
    }
