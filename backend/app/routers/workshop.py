from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Request, Response
from typing import Optional
from datetime import datetime, timezone
import uuid
import os
import io
import asyncio
import logging
import re
from app.database import db, UPLOADS_DIR
from app.auth import get_current_user
from app.services.avatar_enrichment import attach_user_avatars
from app.services.scope_permissions import assert_client_scope, assert_record_scope, scoped_query
from app.services.upload_security import IMAGE_EXTENSIONS, safe_original_filename, safe_upload_extension

logger = logging.getLogger(__name__)


async def _enforce_workshop_job_scope(request: Request, current_user: dict = Depends(get_current_user)):
    job_id = request.path_params.get("job_id")
    if not job_id:
        return
    collection = db.workshop_bench if request.url.path.startswith("/api/workshop/bench/") else db.workshop_jobs
    await assert_record_scope(
        current_user,
        collection,
        job_id,
        operation=request.url.path,
        request=request,
        resource_name="Workshop job",
    )


def _download_name(prefix: str, value: object, extension: str) -> str:
    safe_value = re.sub(r"[^A-Za-z0-9._-]+", "_", str(value or "record")).strip("._")[:80] or "record"
    return f"{prefix}_{safe_value}.{extension}"


router = APIRouter(dependencies=[Depends(_enforce_workshop_job_scope)])

PHOTO_DIR = UPLOADS_DIR / "workshop_photos"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)


# ============== HELPERS ==============

async def _ws_audit(job_id: str, action: str, details: str, user: dict):
    entry = {
        "id": str(uuid.uuid4()),
        "job_id": job_id,
        "action": action,
        "details": details,
        "user_id": user.get("id", "system"),
        "user_name": user.get("name", "System"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.workshop_audit_log.insert_one(entry)


# ============== REPAIR NOTES ==============

@router.get("/workshop/jobs/{job_id}/notes")
async def get_workshop_notes(job_id: str, current_user: dict = Depends(get_current_user)):
    notes = await db.workshop_notes.find({"job_id": job_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return await attach_user_avatars(notes)


@router.post("/workshop/jobs/{job_id}/notes")
async def add_workshop_note(job_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    job = await db.workshop_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    note = {
        "id": str(uuid.uuid4()),
        "job_id": job_id,
        "user_id": current_user["id"],
        "user_name": current_user.get("name", ""),
        "avatar_url": current_user.get("avatar"),
        "content": data.get("content", ""),
        "note_type": data.get("note_type", "general"),
        "is_internal": data.get("is_internal", True),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.workshop_notes.insert_one(note)
    note.pop("_id", None)
    await _ws_audit(job_id, "note_added", f"Note added by {current_user.get('name', '')}", current_user)
    return note


# ============== PHOTO ATTACHMENTS ==============

@router.get("/workshop/jobs/{job_id}/photos")
async def get_workshop_photos(job_id: str, current_user: dict = Depends(get_current_user)):
    photos = await db.workshop_photos.find({"job_id": job_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return photos


@router.post("/workshop/jobs/{job_id}/photos")
async def upload_workshop_photo(job_id: str, photo_type: str = "general", file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    job = await db.workshop_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 10MB)")
    ext = safe_upload_extension(file.filename, allowed=IMAGE_EXTENSIONS, default="jpg")
    filename = f"ws_{job_id[:8]}_{uuid.uuid4().hex[:8]}.{ext}"
    filepath = PHOTO_DIR / filename
    with open(filepath, "wb") as f:
        f.write(content)
    photo = {
        "id": str(uuid.uuid4()),
        "job_id": job_id,
        "filename": filename,
        "url": f"/api/uploads/workshop_photos/{filename}",
        "photo_type": photo_type,
        "original_name": safe_original_filename(file.filename),
        "size_bytes": len(content),
        "uploaded_by": current_user["id"],
        "uploaded_by_name": current_user.get("name", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.workshop_photos.insert_one(photo)
    photo.pop("_id", None)
    await _ws_audit(job_id, "photo_uploaded", f"{photo_type} photo uploaded: {file.filename}", current_user)
    return photo


@router.delete("/workshop/jobs/{job_id}/photos/{photo_id}")
async def delete_workshop_photo(job_id: str, photo_id: str, current_user: dict = Depends(get_current_user)):
    photo = await db.workshop_photos.find_one({"id": photo_id, "job_id": job_id}, {"_id": 0})
    if photo:
        filepath = PHOTO_DIR / safe_original_filename(photo.get("filename"), default="missing")
        if os.path.exists(filepath):
            os.remove(filepath)
    await db.workshop_photos.delete_one({"id": photo_id})
    await _ws_audit(job_id, "photo_deleted", "Photo deleted", current_user)
    return {"message": "Photo deleted"}


# ============== DIAGNOSTIC CHECKLISTS ==============

DEFAULT_TEMPLATES = {
    "laptop": [
        "Visual inspection - check for physical damage",
        "Power on test - verify boot sequence",
        "Check BIOS/UEFI for hardware errors",
        "Run memory diagnostic (memtest)",
        "Check hard drive / SSD health (SMART)",
        "Test keyboard and trackpad",
        "Test display (dead pixels, backlight)",
        "Test WiFi and Bluetooth connectivity",
        "Test USB ports and peripherals",
        "Test battery health and charging",
        "Check thermal paste and cooling",
        "Run OS diagnostics / Event Viewer",
        "Malware/virus scan",
        "Update drivers and firmware",
        "Final power cycle and stress test",
    ],
    "desktop": [
        "Visual inspection - check for damage/dust",
        "Power on test - verify POST",
        "Check BIOS/UEFI settings and errors",
        "Run memory diagnostic",
        "Check storage drive health (SMART)",
        "Test all USB and audio ports",
        "Test video outputs (HDMI/DP/VGA)",
        "Test network connectivity (Ethernet/WiFi)",
        "Check PSU voltages and stability",
        "Check CPU and GPU temperatures",
        "Clean dust from fans and heatsinks",
        "Run OS diagnostics / Event Viewer",
        "Malware/virus scan",
        "Update drivers and firmware",
        "Stress test (CPU + GPU + RAM)",
    ],
    "phone": [
        "Visual inspection - screen, frame, buttons",
        "Power on and boot test",
        "Touch screen responsiveness test",
        "Test all physical buttons",
        "Test cameras (front and rear)",
        "Test speakers and microphone",
        "Test charging port and wireless charging",
        "Test WiFi and cellular connectivity",
        "Test Bluetooth pairing",
        "Test fingerprint / Face ID sensor",
        "Check battery health percentage",
        "Software diagnostics",
        "Factory reset if required",
        "Final validation and QC",
    ],
    "printer": [
        "Visual inspection - paper path, rollers",
        "Power on and initialization test",
        "Print test page - quality check",
        "Check ink/toner levels",
        "Test paper feed from all trays",
        "Test duplex printing",
        "Test network/WiFi connectivity",
        "Test USB direct connection",
        "Clean print heads / drum",
        "Check for paper jam sensors",
        "Test scanner functionality (if MFP)",
        "Test fax functionality (if applicable)",
        "Update firmware",
        "Final test print",
    ],
    "network": [
        "Visual inspection - ports, LEDs, cables",
        "Power cycle and boot test",
        "Check firmware version",
        "Test all ethernet ports",
        "Test WiFi signal strength",
        "Check DHCP and DNS configuration",
        "Ping test - internal and external",
        "Speed test - throughput check",
        "Check firewall rules",
        "Test VPN connectivity",
        "Review logs for errors",
        "Update firmware if needed",
        "Final connectivity validation",
    ],
}


@router.get("/workshop/diagnostic-templates")
async def get_diagnostic_templates(current_user: dict = Depends(get_current_user)):
    custom = await db.workshop_templates.find({}, {"_id": 0}).to_list(50)
    templates = dict(DEFAULT_TEMPLATES)
    for c in custom:
        templates[c["device_type"]] = c["items"]
    return templates


@router.get("/workshop/jobs/{job_id}/checklist")
async def get_workshop_checklist(job_id: str, current_user: dict = Depends(get_current_user)):
    items = await db.workshop_checklists.find({"job_id": job_id}, {"_id": 0}).sort("order", 1).to_list(100)
    return items


@router.post("/workshop/jobs/{job_id}/checklist")
async def add_checklist_items(job_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    job = await db.workshop_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    items = data.get("items", [])
    template = data.get("template")
    if template and template in DEFAULT_TEMPLATES:
        items = DEFAULT_TEMPLATES[template]
    existing_count = await db.workshop_checklists.count_documents({"job_id": job_id})
    created = []
    for i, item_text in enumerate(items):
        item = {
            "id": str(uuid.uuid4()),
            "job_id": job_id,
            "item": item_text if isinstance(item_text, str) else item_text.get("item", ""),
            "checked": False,
            "checked_by": None,
            "checked_by_name": None,
            "checked_at": None,
            "order": existing_count + i,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.workshop_checklists.insert_one(item)
        item.pop("_id", None)
        created.append(item)
    await _ws_audit(job_id, "checklist_loaded", f"Added {len(created)} checklist items", current_user)
    return created


@router.put("/workshop/jobs/{job_id}/checklist/{item_id}")
async def toggle_checklist_item(job_id: str, item_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    checked = data.get("checked", False)
    update = {
        "checked": checked,
        "checked_by": current_user["id"] if checked else None,
        "checked_by_name": current_user.get("name", "") if checked else None,
        "checked_at": datetime.now(timezone.utc).isoformat() if checked else None,
    }
    await db.workshop_checklists.update_one({"id": item_id, "job_id": job_id}, {"$set": update})
    return {"message": "Updated"}


@router.post("/workshop/jobs/{job_id}/checklist/add-item")
async def add_single_checklist_item(job_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    count = await db.workshop_checklists.count_documents({"job_id": job_id})
    item = {
        "id": str(uuid.uuid4()),
        "job_id": job_id,
        "item": data.get("item", ""),
        "checked": False,
        "checked_by": None,
        "checked_by_name": None,
        "checked_at": None,
        "order": count,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.workshop_checklists.insert_one(item)
    item.pop("_id", None)
    return item


# ============== AUDIT TRAIL ==============

@router.get("/workshop/jobs/{job_id}/audit-log")
async def get_workshop_audit_log(job_id: str, current_user: dict = Depends(get_current_user)):
    logs = await db.workshop_audit_log.find({"job_id": job_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return logs


# ============== CUSTOMER NOTIFICATIONS ==============

@router.post("/workshop/jobs/{job_id}/notify-customer")
async def notify_workshop_customer(job_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    job = await db.workshop_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    email = data.get("email") or job.get("customer_email", "")
    subject = data.get("subject", f"Update on your repair - {job.get('job_number', '')}")
    message = data.get("message", "")
    notification_type = data.get("notification_type", "status_update")
    # Use the same server-side signature pipeline as ticket email, so every
    # technician-authored customer update carries their current rich signature.
    from app.routers.email_signatures import append_default_signature
    message, _, signature_id = await append_default_signature(
        body=message,
        body_type="html",
        current_user=current_user,
        subject=subject,
    )
    from app.routers.email_utils import send_email
    delivery = await send_email(
        email,
        subject,
        f"<div style='font-family:sans-serif;'>{message}</div>",
        category="ticket_replies",
    )
    # Log the notification
    notif = {
        "id": str(uuid.uuid4()),
        "job_id": job_id,
        "type": notification_type,
        "email": email,
        "subject": subject,
        "message": message,
        "signature_id": signature_id,
        "sent": delivery.get("status") == "sent",
        "delivery_status": delivery.get("status"),
        "delivery_message": delivery.get("message"),
        "sender_mailbox": delivery.get("sender"),
        "sent_by": current_user["id"],
        "sent_by_name": current_user.get("name", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.workshop_notifications.insert_one(notif)
    notif.pop("_id", None)
    await _ws_audit(job_id, "customer_notified", f"Notification sent: {notification_type}", current_user)
    return notif


@router.get("/workshop/jobs/{job_id}/notifications")
async def get_workshop_notifications(job_id: str, current_user: dict = Depends(get_current_user)):
    notifs = await db.workshop_notifications.find({"job_id": job_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return notifs


# ============== QUOTE / ESTIMATE BUILDER ==============

@router.get("/workshop/jobs/{job_id}/quote")
async def get_workshop_quote(job_id: str, current_user: dict = Depends(get_current_user)):
    quote = await db.workshop_quotes.find_one({"job_id": job_id}, {"_id": 0})
    return quote


@router.post("/workshop/jobs/{job_id}/quote")
async def create_or_update_quote(job_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    job = await db.workshop_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    existing = await db.workshop_quotes.find_one({"job_id": job_id}, {"_id": 0})
    line_items = data.get("line_items", [])
    subtotal = sum(float(li.get("total", 0)) for li in line_items)
    tax = float(data.get("tax", 0))
    total = subtotal + tax
    quote = {
        "id": existing["id"] if existing else str(uuid.uuid4()),
        "job_id": job_id,
        "job_number": job.get("job_number", ""),
        "customer_name": job.get("customer_name", ""),
        "customer_email": job.get("customer_email", ""),
        "line_items": line_items,
        "subtotal": round(subtotal, 2),
        "tax": round(tax, 2),
        "total": round(total, 2),
        "notes": data.get("notes", ""),
        "status": data.get("status", existing.get("status", "draft") if existing else "draft"),
        "valid_until": data.get("valid_until", ""),
        "created_by": current_user["id"],
        "created_by_name": current_user.get("name", ""),
        "created_at": existing.get("created_at", datetime.now(timezone.utc).isoformat()) if existing else datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if existing:
        await db.workshop_quotes.update_one({"job_id": job_id}, {"$set": quote})
    else:
        await db.workshop_quotes.insert_one(quote)
    quote.pop("_id", None)
    action = "quote_updated" if existing else "quote_created"
    await _ws_audit(job_id, action, f"Quote {'updated' if existing else 'created'}: ${total:.2f}", current_user)
    return quote


@router.post("/workshop/jobs/{job_id}/quote/send")
async def send_quote_to_customer(job_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    quote = await db.workshop_quotes.find_one({"job_id": job_id}, {"_id": 0})
    if not quote:
        raise HTTPException(status_code=404, detail="No quote found for this job")
    await db.workshop_quotes.update_one({"job_id": job_id}, {"$set": {"status": "sent", "updated_at": datetime.now(timezone.utc).isoformat()}})
    email = data.get("email") or quote.get("customer_email", "")
    if email:
        await notify_workshop_customer(job_id, {
            "email": email,
            "subject": f"Repair Quote - {quote.get('job_number', '')}",
            "message": f"<h2>Repair Quote</h2><p>Total: ${quote['total']:.2f}</p><p>{quote.get('notes', '')}</p><p>Please reply to approve or decline this quote.</p>",
            "notification_type": "quote_sent",
        }, current_user)
    await _ws_audit(job_id, "quote_sent", f"Quote sent to {email}", current_user)
    return {"message": "Quote sent", "status": "sent"}


@router.post("/workshop/jobs/{job_id}/quote/approve")
async def approve_quote(job_id: str, current_user: dict = Depends(get_current_user)):
    quote = await db.workshop_quotes.find_one({"job_id": job_id}, {"_id": 0})
    if not quote:
        raise HTTPException(status_code=404, detail="No quote found")
    await db.workshop_quotes.update_one({"job_id": job_id}, {"$set": {"status": "approved", "updated_at": datetime.now(timezone.utc).isoformat()}})
    await _ws_audit(job_id, "quote_approved", "Quote approved", current_user)
    return {"message": "Quote approved"}


@router.post("/workshop/jobs/{job_id}/quote/decline")
async def decline_quote(job_id: str, current_user: dict = Depends(get_current_user)):
    await db.workshop_quotes.update_one({"job_id": job_id}, {"$set": {"status": "declined", "updated_at": datetime.now(timezone.utc).isoformat()}})
    await _ws_audit(job_id, "quote_declined", "Quote declined", current_user)
    return {"message": "Quote declined"}


# ============== PUSH TO INVOICE ==============

@router.post("/workshop/jobs/{job_id}/to-invoice")
async def push_workshop_to_invoice(job_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    job = await db.workshop_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    invoice_id = data.get("invoice_id")
    line_items = []
    for p in job.get("parts_used", []):
        line_items.append({
            "id": str(uuid.uuid4()),
            "description": f"Part: {p.get('product_name', 'Unknown')}",
            "quantity": p.get("quantity", 1),
            "unit_price": p.get("unit_price", 0),
            "total": p.get("total", 0),
        })
    labour_cost = job.get("total_labour_cost", 0)
    if labour_cost > 0:
        line_items.append({
            "id": str(uuid.uuid4()),
            "description": f"Labour: {job.get('labour_minutes', 0)} minutes @ ${job.get('labour_rate', 75)}/hr",
            "quantity": 1,
            "unit_price": labour_cost,
            "total": labour_cost,
        })
    total = sum(li["total"] for li in line_items)
    if invoice_id:
        inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
        if not inv:
            raise HTTPException(status_code=404, detail="Invoice not found")
        existing_items = inv.get("line_items", [])
        existing_items.extend(line_items)
        new_total = sum(li.get("total", 0) for li in existing_items)
        await db.invoices.update_one({"id": invoice_id}, {"$set": {
            "line_items": existing_items,
            "subtotal": round(new_total, 2),
            "total": round(new_total, 2),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }})
        await _ws_audit(job_id, "pushed_to_invoice", f"Items pushed to existing invoice {invoice_id}", current_user)
        return {"message": "Items added to existing invoice", "invoice_id": invoice_id}
    else:
        count = await db.invoices.count_documents({})
        new_invoice = {
            "id": str(uuid.uuid4()),
            "invoice_number": f"INV-{count + 1001:04d}",
            "client_id": job.get("client_id", ""),
            "client_name": job.get("customer_name", ""),
            "status": "draft",
            "line_items": line_items,
            "subtotal": round(total, 2),
            "tax": 0,
            "total": round(total, 2),
            "amount_paid": 0,
            "notes": f"Workshop Job: {job.get('job_number', '')} - {job.get('fault_description', '')}",
            "workshop_job_id": job_id,
            "created_by": current_user["id"],
            "created_by_name": current_user.get("name", ""),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.invoices.insert_one(new_invoice)
        new_invoice.pop("_id", None)
        await _ws_audit(job_id, "invoice_created", f"Invoice {new_invoice['invoice_number']} created from job", current_user)
        return {"message": f"Invoice {new_invoice['invoice_number']} created", "invoice_id": new_invoice["id"], "invoice_number": new_invoice["invoice_number"]}


# ============== ENHANCED INTAKE FIELDS ==============

@router.put("/workshop/jobs/{job_id}/intake")
async def update_workshop_intake(job_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    allowed = {
        "condition_on_arrival", "accessories_received", "customer_password",
        "warranty_status", "warranty_expiry", "customer_email",
    }
    update = {k: v for k, v in data.items() if k in allowed}
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.workshop_jobs.update_one({"id": job_id}, {"$set": update})
    await _ws_audit(job_id, "intake_updated", "Device intake info updated", current_user)
    return {"message": "Intake updated"}


# ============== REPAIR HISTORY LOOKUP ==============

@router.get("/workshop/jobs/{job_id}/repair-history")
async def get_repair_history(job_id: str, current_user: dict = Depends(get_current_user)):
    job = await db.workshop_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    query_parts = []
    if job.get("serial_number"):
        query_parts.append({"serial_number": job["serial_number"]})
    if job.get("customer_name"):
        query_parts.append({"customer_name": job["customer_name"]})
    if job.get("customer_phone"):
        query_parts.append({"customer_phone": job["customer_phone"]})
    if not query_parts:
        return []
    history = await db.workshop_jobs.find(
        {"$and": [{"$or": query_parts}, {"id": {"$ne": job_id}}]},
        {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    return history


# ============== QR CODE GENERATION ==============

@router.get("/workshop/jobs/{job_id}/qr-code")
async def get_workshop_qr_code(job_id: str, current_user: dict = Depends(get_current_user)):
    job = await db.workshop_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    import qrcode
    from io import BytesIO
    base_url = os.environ.get("BASE_URL", "https://nexusops.io")
    qr_data = f"{base_url}/workshop/{job_id}"
    qr = qrcode.QRCode(version=1, box_size=10, border=4)
    qr.add_data(qr_data)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return Response(
        content=buf.getvalue(),
        media_type="image/png",
        headers={"Content-Disposition": f'attachment; filename="{_download_name("QR", job.get("job_number", job_id), "png")}"'},
    )


# ============== PDF JOB CARD ==============

@router.get("/workshop/jobs/{job_id}/pdf")
async def generate_workshop_pdf(job_id: str, current_user: dict = Depends(get_current_user)):
    job = await db.workshop_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    branding = await db.settings.find_one({"type": "branding"}, {"_id": 0})
    checklist = await db.workshop_checklists.find({"job_id": job_id}, {"_id": 0}).sort("order", 1).to_list(100)
    notes = await db.workshop_notes.find({"job_id": job_id}, {"_id": 0}).sort("created_at", 1).to_list(100)

    from fpdf import FPDF

    class JobCardPDF(FPDF):
        def header(self):
            if branding and branding.get("company_logo_url"):
                logo_path = f"/app/backend{branding['company_logo_url']}"
                if os.path.exists(logo_path):
                    try:
                        self.image(logo_path, 10, 8, 30)
                    except Exception:
                        pass
            company = branding.get("company_name", "NexusOps") if branding else "NexusOps"
            self.set_font("Helvetica", "B", 16)
            self.cell(0, 10, company, ln=True, align="C")
            self.set_font("Helvetica", "", 9)
            self.cell(0, 5, "Workshop Repair Job Card", ln=True, align="C")
            self.ln(3)
            self.set_draw_color(100, 100, 100)
            self.line(10, self.get_y(), 200, self.get_y())
            self.ln(5)

        def footer(self):
            self.set_y(-15)
            self.set_font("Helvetica", "I", 8)
            self.set_text_color(128)
            self.cell(0, 10, f"Page {self.page_no()}/{{nb}}", align="C")

    pdf = JobCardPDF()
    pdf.alias_nb_pages()
    pdf.add_page()
    pdf.set_auto_page_break(auto=True, margin=20)

    # Job info section
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, f"Job: {job.get('job_number', 'N/A')}", ln=True)
    pdf.set_font("Helvetica", "", 10)
    status_label = job.get("repair_status", "unknown").replace("_", " ").title()
    pdf.cell(0, 6, f"Status: {status_label}  |  Priority: {job.get('priority', 'normal').title()}", ln=True)
    pdf.cell(0, 6, f"Created: {job.get('created_at', '')[:10]}  |  Technician: {job.get('assigned_to_name') or 'Unassigned'}", ln=True)
    pdf.ln(3)

    # Customer info
    pdf.set_fill_color(240, 240, 240)
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(0, 7, "  Customer Information", ln=True, fill=True)
    pdf.set_font("Helvetica", "", 9)
    pdf.cell(95, 6, f"  Name: {job.get('customer_name', 'N/A')}")
    pdf.cell(95, 6, f"Phone: {job.get('customer_phone', 'N/A')}", ln=True)
    pdf.cell(95, 6, f"  Email: {job.get('customer_email', 'N/A')}", ln=True)
    pdf.ln(3)

    # Device info
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(0, 7, "  Device Information", ln=True, fill=True)
    pdf.set_font("Helvetica", "", 9)
    device_desc = " ".join(filter(None, [job.get("device_brand"), job.get("device_model")])) or job.get("device_type", "N/A")
    pdf.cell(95, 6, f"  Device: {device_desc}")
    pdf.cell(95, 6, f"Serial: {job.get('serial_number', 'N/A')}", ln=True)
    pdf.cell(95, 6, f"  Condition: {job.get('condition_on_arrival', 'N/A')}")
    pdf.cell(95, 6, f"Warranty: {job.get('warranty_status', 'N/A')}", ln=True)
    accessories = job.get("accessories_received", [])
    if accessories:
        pdf.cell(0, 6, f"  Accessories: {', '.join(accessories)}", ln=True)
    pdf.ln(2)

    # Fault description
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(0, 7, "  Reported Fault", ln=True, fill=True)
    pdf.set_font("Helvetica", "", 9)
    pdf.multi_cell(0, 5, f"  {job.get('fault_description', 'N/A')}")
    pdf.ln(3)

    # Diagnostic checklist
    if checklist:
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(0, 7, "  Diagnostic Checklist", ln=True, fill=True)
        pdf.set_font("Helvetica", "", 9)
        for item in checklist:
            mark = "[X]" if item.get("checked") else "[ ]"
            checked_info = f" - {item.get('checked_by_name', '')}" if item.get("checked") else ""
            pdf.cell(0, 5, f"  {mark} {item.get('item', '')}{checked_info}", ln=True)
        pdf.ln(3)

    # Parts used
    parts = job.get("parts_used", [])
    if parts:
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(0, 7, "  Parts Used", ln=True, fill=True)
        pdf.set_font("Helvetica", "B", 9)
        pdf.cell(80, 6, "  Part", border=1)
        pdf.cell(25, 6, "Qty", border=1, align="C")
        pdf.cell(35, 6, "Unit Price", border=1, align="R")
        pdf.cell(35, 6, "Total", border=1, align="R", ln=True)
        pdf.set_font("Helvetica", "", 9)
        for p in parts:
            pdf.cell(80, 6, f"  {p.get('product_name', 'N/A')}", border=1)
            pdf.cell(25, 6, str(p.get("quantity", 0)), border=1, align="C")
            pdf.cell(35, 6, f"${p.get('unit_price', 0):.2f}", border=1, align="R")
            pdf.cell(35, 6, f"${p.get('total', 0):.2f}", border=1, align="R", ln=True)
        pdf.ln(3)

    # Billing summary
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(0, 7, "  Billing Summary", ln=True, fill=True)
    pdf.set_font("Helvetica", "", 9)
    pdf.cell(140, 6, "  Parts Total:")
    pdf.cell(35, 6, f"${job.get('total_parts_cost', 0):.2f}", align="R", ln=True)
    pdf.cell(140, 6, f"  Labour ({job.get('labour_minutes', 0)} min @ ${job.get('labour_rate', 75)}/hr):")
    pdf.cell(35, 6, f"${job.get('total_labour_cost', 0):.2f}", align="R", ln=True)
    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(140, 8, "  TOTAL:")
    pdf.cell(35, 8, f"${job.get('total_cost', 0):.2f}", align="R", ln=True)
    pdf.ln(3)

    # Notes
    if notes:
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(0, 7, "  Repair Notes", ln=True, fill=True)
        pdf.set_font("Helvetica", "", 8)
        for n in notes[:20]:
            pdf.set_font("Helvetica", "B", 8)
            pdf.cell(0, 5, f"  {n.get('user_name', '')} - {n.get('created_at', '')[:16]}", ln=True)
            pdf.set_font("Helvetica", "", 8)
            content = n.get("content", "")[:300]
            pdf.multi_cell(0, 4, f"    {content}")
            pdf.ln(1)

    # Customer signature line
    pdf.ln(10)
    pdf.set_font("Helvetica", "", 9)
    pdf.cell(0, 6, "Customer Signature: ___________________________    Date: _______________", ln=True)
    pdf.cell(0, 6, "Technician Signature: __________________________    Date: _______________", ln=True)

    return Response(
        content=bytes(pdf.output()),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{_download_name("JobCard", job.get("job_number", job_id), "pdf")}"'},
    )


# ============== WORKSHOP QUEUE / BENCH VIEW ==============

@router.get("/workshop/queue")
async def get_workshop_queue(current_user: dict = Depends(get_current_user)):
    jobs = await db.workshop_jobs.find(
        scoped_query(current_user, {"job_type": "workshop", "repair_status": {"$nin": ["collected", "cancelled"]}}),
        {"_id": 0}
    ).sort("created_at", 1).to_list(500)
    columns = {
        "checked_in": [],
        "diagnosing": [],
        "parts_ordered": [],
        "repairing": [],
        "ready_for_pickup": [],
    }
    for j in jobs:
        status = j.get("repair_status", "checked_in")
        if status in columns:
            columns[status].append(j)
    return columns


# ============================================================
# Workshop Bench (Kanban) — merged from workshop_bench.py
# ============================================================
@router.get("/workshop/bench")
async def get_bench_jobs(current_user: dict = Depends(get_current_user)):
    jobs = await db.workshop_bench.find(scoped_query(current_user), {"_id": 0}).sort("created_at", -1).to_list(500)
    return jobs


@router.post("/workshop/bench")
async def create_bench_job(data: dict, current_user: dict = Depends(get_current_user)):
    await assert_client_scope(current_user, data.get("client_id"), operation="workshop.bench.create")
    count = await db.workshop_bench.count_documents({})
    job = {
        "id": str(uuid.uuid4()),
        "job_number": f"WS-{str(count + 1).zfill(5)}",
        "title": data.get("title", ""),
        "description": data.get("description", ""),
        "client_name": data.get("client_name", ""),
        "client_id": data.get("client_id", ""),
        "device_name": data.get("device_name", ""),
        "device_id": data.get("device_id", ""),
        "assigned_to": data.get("assigned_to", ""),
        "assigned_to_name": data.get("assigned_to_name", ""),
        "bench_stage": "intake",
        "priority": data.get("priority", "medium"),
        "notes": [],
        "parts": [],
        "created_by": current_user.get("name", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.workshop_bench.insert_one(job)
    return {"id": job["id"], "job_number": job["job_number"]}


@router.put("/workshop/bench/move")
async def move_bench_job(data: dict, current_user: dict = Depends(get_current_user)):
    job_id = data.get("job_id")
    await assert_record_scope(
        current_user,
        db.workshop_bench,
        job_id,
        operation="workshop.bench.move",
        resource_name="Workshop bench job",
    )
    stage = data.get("stage")
    valid_stages = ["intake", "diagnosing", "parts_ordered", "repairing", "testing", "ready"]
    if stage not in valid_stages:
        return {"error": f"Invalid stage. Must be one of: {valid_stages}"}
    result = await db.workshop_bench.update_one(
        {"id": job_id},
        {
            "$set": {"bench_stage": stage, "updated_at": datetime.now(timezone.utc).isoformat()},
            "$push": {"history": {"stage": stage, "moved_by": current_user.get("name", ""), "at": datetime.now(timezone.utc).isoformat()}},
        },
    )
    return {"message": "Moved", "modified": result.modified_count}


@router.get("/workshop/bench/{job_id}")
async def get_bench_job(job_id: str, current_user: dict = Depends(get_current_user)):
    job = await db.workshop_bench.find_one({"id": job_id}, {"_id": 0})
    if not job:
        return {"error": "Job not found"}
    return job
