from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from fastapi.responses import FileResponse
from typing import Optional
from datetime import datetime, timezone
import uuid
import os
import asyncio
import logging
from app.database import db
from app.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()

PHOTO_DIR = "/app/backend/uploads/field_photos"
os.makedirs(PHOTO_DIR, exist_ok=True)


async def _fj_audit(job_id: str, action: str, details: str, user: dict):
    entry = {
        "id": str(uuid.uuid4()),
        "job_id": job_id,
        "action": action,
        "details": details,
        "user_id": user.get("id", "system"),
        "user_name": user.get("name", "System"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.field_audit_log.insert_one(entry)


# ============== FIELD NOTES ==============

@router.get("/field-jobs/{job_id}/notes")
async def get_field_notes(job_id: str, current_user: dict = Depends(get_current_user)):
    notes = await db.field_notes.find({"job_id": job_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return notes


@router.post("/field-jobs/{job_id}/notes")
async def add_field_note(job_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    job = await db.field_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    note = {
        "id": str(uuid.uuid4()),
        "job_id": job_id,
        "user_id": current_user["id"],
        "user_name": current_user.get("name", ""),
        "content": data.get("content", ""),
        "note_type": data.get("note_type", "general"),
        "is_internal": data.get("is_internal", True),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.field_notes.insert_one(note)
    note.pop("_id", None)
    await _fj_audit(job_id, "note_added", f"Note added by {current_user.get('name', '')}", current_user)
    return note


# ============== SITE PHOTOS ==============

@router.get("/field-jobs/{job_id}/photos")
async def get_field_photos(job_id: str, current_user: dict = Depends(get_current_user)):
    photos = await db.field_photos.find({"job_id": job_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return photos


@router.post("/field-jobs/{job_id}/photos")
async def upload_field_photo(job_id: str, photo_type: str = "general", file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    job = await db.field_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 10MB)")
    ext = file.filename.split(".")[-1] if "." in file.filename else "jpg"
    filename = f"fj_{job_id[:8]}_{uuid.uuid4().hex[:8]}.{ext}"
    filepath = os.path.join(PHOTO_DIR, filename)
    with open(filepath, "wb") as f:
        f.write(content)
    photo = {
        "id": str(uuid.uuid4()),
        "job_id": job_id,
        "filename": filename,
        "url": f"/uploads/field_photos/{filename}",
        "photo_type": photo_type,
        "original_name": file.filename,
        "size_bytes": len(content),
        "uploaded_by": current_user["id"],
        "uploaded_by_name": current_user.get("name", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.field_photos.insert_one(photo)
    photo.pop("_id", None)
    await _fj_audit(job_id, "photo_uploaded", f"{photo_type} photo uploaded: {file.filename}", current_user)
    return photo


@router.delete("/field-jobs/{job_id}/photos/{photo_id}")
async def delete_field_photo(job_id: str, photo_id: str, current_user: dict = Depends(get_current_user)):
    photo = await db.field_photos.find_one({"id": photo_id, "job_id": job_id}, {"_id": 0})
    if photo:
        filepath = os.path.join(PHOTO_DIR, photo.get("filename", ""))
        if os.path.exists(filepath):
            os.remove(filepath)
    await db.field_photos.delete_one({"id": photo_id})
    await _fj_audit(job_id, "photo_deleted", "Photo deleted", current_user)
    return {"message": "Photo deleted"}


# ============== ENHANCED CHECKLISTS ==============

FIELD_TEMPLATES = {
    "installation": [
        "Pre-site: Confirm customer appointment",
        "Pre-site: Load vehicle with required materials",
        "Pre-site: Check weather conditions",
        "Site survey: Assess mounting location",
        "Site survey: Check line of sight to tower/POP",
        "Site survey: Verify power availability",
        "Cable run: Route cable path planned",
        "Cable run: Cable pulled and secured",
        "Cable run: Weatherproofing applied to external connectors",
        "Mounting: Antenna/dish mounted securely",
        "Mounting: Alignment completed (signal optimized)",
        "Configuration: CPE/router powered and configured",
        "Configuration: SSID and security set",
        "Configuration: IP addressing confirmed (static/DHCP)",
        "Configuration: Firewall rules applied",
        "Testing: Signal strength recorded",
        "Testing: Speed test performed (download)",
        "Testing: Speed test performed (upload)",
        "Testing: Latency/ping test",
        "Testing: Multiple device connectivity verified",
        "Cleanup: Cable ties and labelling done",
        "Cleanup: Site left tidy",
        "Handover: Customer walkthrough completed",
        "Handover: Customer credentials provided",
        "Documentation: Photos taken (all angles)",
        "Documentation: Job card signed by customer",
    ],
    "maintenance": [
        "Visual inspection of antenna/dish",
        "Check mounting hardware for corrosion/looseness",
        "Inspect cable runs for damage",
        "Check external connectors for moisture ingress",
        "Verify signal strength readings",
        "Speed test: download and upload",
        "Check firmware version on CPE/router",
        "Apply firmware updates if available",
        "Inspect indoor equipment (router, switch, UPS)",
        "Check UPS battery health",
        "Clean antenna/dish surface",
        "Re-align antenna if signal degraded",
        "Test failover/backup link if applicable",
        "Document current readings for comparison",
        "Customer sign-off on maintenance",
    ],
    "troubleshooting": [
        "Confirm symptoms with customer",
        "Check service status on monitoring platform",
        "Test signal strength at CPE",
        "Speed test: before any changes (baseline)",
        "Inspect physical connections and cables",
        "Check for RF interference",
        "Verify antenna alignment",
        "Check CPE/router config for errors",
        "Reboot CPE/router if needed",
        "Test with direct Ethernet connection (bypass WiFi)",
        "Check DHCP/DNS settings",
        "Test alternate frequency/channel",
        "Apply fix: document what was changed",
        "Speed test: after fix applied",
        "Confirm resolution with customer",
        "Document root cause and fix",
    ],
    "decommission": [
        "Confirm decommission authorization",
        "Disconnect CPE/router from power",
        "Remove indoor equipment",
        "Remove external cable runs",
        "Unmount antenna/dish",
        "Patch/repair any mounting holes",
        "Collect all equipment and accessories",
        "Tag equipment with asset IDs",
        "Wipe configurations from devices",
        "Update asset management system",
        "Update customer account status",
        "Take final site photos",
        "Customer sign-off on removal",
    ],
    "site_survey": [
        "GPS coordinates recorded",
        "Elevation / building height noted",
        "Line of sight to tower checked",
        "Signal test with survey equipment",
        "Roof/wall mounting options assessed",
        "Cable routing path identified",
        "Power source location confirmed",
        "Customer network requirements documented",
        "Existing infrastructure noted",
        "Environmental hazards identified",
        "Access requirements documented (ladder, roof, etc.)",
        "Photos of proposed installation points",
        "Estimated materials list created",
        "Customer expectations set",
    ],
}


@router.get("/field-jobs/enhanced-templates")
async def get_field_templates(current_user: dict = Depends(get_current_user)):
    custom = await db.field_templates.find({}, {"_id": 0}).to_list(50)
    templates = dict(FIELD_TEMPLATES)
    for c in custom:
        templates[c["category"]] = c["items"]
    return templates


@router.get("/field-jobs/{job_id}/enhanced-checklist")
async def get_field_checklist(job_id: str, current_user: dict = Depends(get_current_user)):
    items = await db.field_checklists.find({"job_id": job_id}, {"_id": 0}).sort("order", 1).to_list(100)
    return items


@router.post("/field-jobs/{job_id}/enhanced-checklist")
async def add_field_checklist_items(job_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    job = await db.field_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    items = data.get("items", [])
    template = data.get("template")
    if template and template in FIELD_TEMPLATES:
        items = FIELD_TEMPLATES[template]
    existing = await db.field_checklists.count_documents({"job_id": job_id})
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
            "order": existing + i,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.field_checklists.insert_one(item)
        item.pop("_id", None)
        created.append(item)
    await _fj_audit(job_id, "checklist_loaded", f"Added {len(created)} checklist items", current_user)
    return created


@router.put("/field-jobs/{job_id}/enhanced-checklist/{item_id}")
async def toggle_field_checklist_item(job_id: str, item_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    checked = data.get("checked", False)
    update = {
        "checked": checked,
        "checked_by": current_user["id"] if checked else None,
        "checked_by_name": current_user.get("name", "") if checked else None,
        "checked_at": datetime.now(timezone.utc).isoformat() if checked else None,
    }
    await db.field_checklists.update_one({"id": item_id, "job_id": job_id}, {"$set": update})
    return {"message": "Updated"}


@router.post("/field-jobs/{job_id}/enhanced-checklist/add-item")
async def add_single_field_checklist_item(job_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    count = await db.field_checklists.count_documents({"job_id": job_id})
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
    await db.field_checklists.insert_one(item)
    item.pop("_id", None)
    return item


# ============== AUDIT TRAIL ==============

@router.get("/field-jobs/{job_id}/audit-log")
async def get_field_audit_log(job_id: str, current_user: dict = Depends(get_current_user)):
    logs = await db.field_audit_log.find({"job_id": job_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return logs


# ============== CUSTOMER NOTIFICATIONS ==============

@router.post("/field-jobs/{job_id}/notify-customer")
async def notify_field_customer(job_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    job = await db.field_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    email = data.get("email") or job.get("customer_email", "")
    subject = data.get("subject", f"Update on your service - {job.get('job_number', '')}")
    message = data.get("message", "")
    notification_type = data.get("notification_type", "status_update")
    import resend
    resend_key = os.environ.get("RESEND_API_KEY", "")
    sender_email = os.environ.get("SENDER_EMAIL", "field@nexusops.io")
    sent = False
    if resend_key and not resend_key.startswith("re_test_placeholder") and email:
        resend.api_key = resend_key
        try:
            params = {
                "from": f"NexusOps Field Services <{sender_email}>",
                "to": [email],
                "subject": subject,
                "html": f"<div style='font-family:sans-serif;'>{message}</div>",
            }
            await asyncio.to_thread(resend.Emails.send, params)
            sent = True
        except Exception as e:
            logger.error(f"Field notification email failed: {e}")
    notif = {
        "id": str(uuid.uuid4()),
        "job_id": job_id,
        "type": notification_type,
        "email": email,
        "subject": subject,
        "message": message,
        "sent": sent or not resend_key,
        "sent_by": current_user["id"],
        "sent_by_name": current_user.get("name", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.field_notifications.insert_one(notif)
    notif.pop("_id", None)
    await _fj_audit(job_id, "customer_notified", f"Notification sent: {notification_type}", current_user)
    return notif


@router.get("/field-jobs/{job_id}/notifications")
async def get_field_notifications(job_id: str, current_user: dict = Depends(get_current_user)):
    notifs = await db.field_notifications.find({"job_id": job_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return notifs


# ============== QUOTE / ESTIMATE ==============

@router.get("/field-jobs/{job_id}/quote")
async def get_field_quote(job_id: str, current_user: dict = Depends(get_current_user)):
    quote = await db.field_quotes.find_one({"job_id": job_id}, {"_id": 0})
    return quote


@router.post("/field-jobs/{job_id}/quote")
async def create_or_update_field_quote(job_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    job = await db.field_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    existing = await db.field_quotes.find_one({"job_id": job_id}, {"_id": 0})
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
        await db.field_quotes.update_one({"job_id": job_id}, {"$set": quote})
    else:
        await db.field_quotes.insert_one(quote)
    quote.pop("_id", None)
    await _fj_audit(job_id, "quote_updated" if existing else "quote_created", f"Quote {'updated' if existing else 'created'}: ${total:.2f}", current_user)
    return quote


@router.post("/field-jobs/{job_id}/quote/send")
async def send_field_quote(job_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    quote = await db.field_quotes.find_one({"job_id": job_id}, {"_id": 0})
    if not quote:
        raise HTTPException(status_code=404, detail="No quote found")
    await db.field_quotes.update_one({"job_id": job_id}, {"$set": {"status": "sent", "updated_at": datetime.now(timezone.utc).isoformat()}})
    email = data.get("email") or quote.get("customer_email", "")
    if email:
        await notify_field_customer(job_id, {
            "email": email,
            "subject": f"Service Quote - {quote.get('job_number', '')}",
            "message": f"<h2>Service Quote</h2><p>Total: ${quote['total']:.2f}</p><p>{quote.get('notes', '')}</p><p>Please reply to approve.</p>",
            "notification_type": "quote_sent",
        }, current_user)
    await _fj_audit(job_id, "quote_sent", f"Quote sent to {email}", current_user)
    return {"message": "Quote sent", "status": "sent"}


@router.post("/field-jobs/{job_id}/quote/approve")
async def approve_field_quote(job_id: str, current_user: dict = Depends(get_current_user)):
    await db.field_quotes.update_one({"job_id": job_id}, {"$set": {"status": "approved", "updated_at": datetime.now(timezone.utc).isoformat()}})
    await _fj_audit(job_id, "quote_approved", "Quote approved", current_user)
    return {"message": "Quote approved"}


# ============== EQUIPMENT TRACKING ==============

@router.get("/field-jobs/{job_id}/equipment")
async def get_field_equipment(job_id: str, current_user: dict = Depends(get_current_user)):
    items = await db.field_equipment.find({"job_id": job_id}, {"_id": 0}).sort("created_at", 1).to_list(100)
    return items


@router.post("/field-jobs/{job_id}/equipment")
async def add_field_equipment(job_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    job = await db.field_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    item = {
        "id": str(uuid.uuid4()),
        "job_id": job_id,
        "equipment_type": data.get("equipment_type", ""),
        "brand": data.get("brand", ""),
        "model": data.get("model", ""),
        "serial_number": data.get("serial_number", ""),
        "mac_address": data.get("mac_address", ""),
        "ip_address": data.get("ip_address", ""),
        "config_notes": data.get("config_notes", ""),
        "action": data.get("action", "installed"),
        "added_by": current_user["id"],
        "added_by_name": current_user.get("name", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.field_equipment.insert_one(item)
    item.pop("_id", None)
    await _fj_audit(job_id, "equipment_added", f"{item['action']}: {item['equipment_type']} - {item['brand']} {item['model']}", current_user)
    return item


@router.delete("/field-jobs/{job_id}/equipment/{equip_id}")
async def delete_field_equipment(job_id: str, equip_id: str, current_user: dict = Depends(get_current_user)):
    await db.field_equipment.delete_one({"id": equip_id, "job_id": job_id})
    await _fj_audit(job_id, "equipment_removed", "Equipment entry removed", current_user)
    return {"message": "Removed"}


# ============== MATERIALS USED ==============

@router.get("/field-jobs/{job_id}/materials")
async def get_field_materials(job_id: str, current_user: dict = Depends(get_current_user)):
    items = await db.field_materials.find({"job_id": job_id}, {"_id": 0}).sort("created_at", 1).to_list(100)
    return items


@router.post("/field-jobs/{job_id}/materials")
async def add_field_material(job_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    job = await db.field_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    item = {
        "id": str(uuid.uuid4()),
        "job_id": job_id,
        "material": data.get("material", ""),
        "quantity": data.get("quantity", 1),
        "unit": data.get("unit", "each"),
        "unit_cost": float(data.get("unit_cost", 0)),
        "total": float(data.get("quantity", 1)) * float(data.get("unit_cost", 0)),
        "added_by": current_user["id"],
        "added_by_name": current_user.get("name", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.field_materials.insert_one(item)
    item.pop("_id", None)
    await _fj_audit(job_id, "material_added", f"Material: {item['material']} x{item['quantity']}", current_user)
    return item


@router.delete("/field-jobs/{job_id}/materials/{mat_id}")
async def delete_field_material(job_id: str, mat_id: str, current_user: dict = Depends(get_current_user)):
    await db.field_materials.delete_one({"id": mat_id, "job_id": job_id})
    await _fj_audit(job_id, "material_removed", "Material entry removed", current_user)
    return {"message": "Removed"}


# ============== SITE SURVEY / ACCESS INFO ==============

@router.get("/field-jobs/{job_id}/site-info")
async def get_site_info(job_id: str, current_user: dict = Depends(get_current_user)):
    info = await db.field_site_info.find_one({"job_id": job_id}, {"_id": 0})
    return info or {}


@router.put("/field-jobs/{job_id}/site-info")
async def update_site_info(job_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    allowed = {
        "gps_lat", "gps_lng", "elevation", "access_notes", "gate_code",
        "ladder_required", "roof_access", "weather_conditions", "safety_hazards",
        "existing_infrastructure", "mounting_type", "cable_entry_point",
        "power_source", "customer_email",
    }
    update = {k: v for k, v in data.items() if k in allowed}
    update["job_id"] = job_id
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    existing = await db.field_site_info.find_one({"job_id": job_id})
    if existing:
        await db.field_site_info.update_one({"job_id": job_id}, {"$set": update})
    else:
        update["created_at"] = datetime.now(timezone.utc).isoformat()
        await db.field_site_info.insert_one(update)
    await _fj_audit(job_id, "site_info_updated", "Site survey info updated", current_user)
    return {"message": "Site info updated"}


# ============== PUSH TO INVOICE ==============

@router.post("/field-jobs/{job_id}/to-invoice")
async def push_field_to_invoice(job_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    job = await db.field_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    materials = await db.field_materials.find({"job_id": job_id}, {"_id": 0}).to_list(200)
    equipment = await db.field_equipment.find({"job_id": job_id}, {"_id": 0}).to_list(200)
    line_items = []
    for m in materials:
        line_items.append({
            "id": str(uuid.uuid4()),
            "description": f"Material: {m.get('material', 'Unknown')} ({m.get('quantity', 1)} {m.get('unit', 'each')})",
            "quantity": m.get("quantity", 1),
            "unit_price": m.get("unit_cost", 0),
            "total": m.get("total", 0),
        })
    for eq in equipment:
        if eq.get("action") == "installed":
            line_items.append({
                "id": str(uuid.uuid4()),
                "description": f"Equipment: {eq.get('equipment_type', '')} - {eq.get('brand', '')} {eq.get('model', '')}",
                "quantity": 1,
                "unit_price": 0,
                "total": 0,
            })
    labour_desc = f"Field service labour: {job.get('estimated_duration', 60)} min"
    labour_rate = float(data.get("labour_rate", 95))
    labour_hrs = float(job.get("estimated_duration", 60)) / 60
    labour_cost = round(labour_rate * labour_hrs, 2)
    line_items.append({
        "id": str(uuid.uuid4()),
        "description": labour_desc,
        "quantity": 1,
        "unit_price": labour_cost,
        "total": labour_cost,
    })
    total = sum(li["total"] for li in line_items)
    invoice_id = data.get("invoice_id")
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
        await _fj_audit(job_id, "pushed_to_invoice", f"Items pushed to existing invoice {invoice_id}", current_user)
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
            "notes": f"Field Job: {job.get('job_number', '')} - {job.get('description', '')}",
            "field_job_id": job_id,
            "created_by": current_user["id"],
            "created_by_name": current_user.get("name", ""),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.invoices.insert_one(new_invoice)
        new_invoice.pop("_id", None)
        await _fj_audit(job_id, "invoice_created", f"Invoice {new_invoice['invoice_number']} created from job", current_user)
        return {"message": f"Invoice {new_invoice['invoice_number']} created", "invoice_id": new_invoice["id"], "invoice_number": new_invoice["invoice_number"]}


# ============== JOB HISTORY ==============

@router.get("/field-jobs/{job_id}/job-history")
async def get_field_job_history(job_id: str, current_user: dict = Depends(get_current_user)):
    job = await db.field_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    query_parts = []
    if job.get("service_address"):
        query_parts.append({"service_address": job["service_address"]})
    if job.get("customer_name"):
        query_parts.append({"customer_name": job["customer_name"]})
    if job.get("customer_phone"):
        query_parts.append({"customer_phone": job["customer_phone"]})
    if not query_parts:
        return []
    history = await db.field_jobs.find(
        {"$and": [{"$or": query_parts}, {"id": {"$ne": job_id}}]},
        {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    return history


# ============== QR CODE ==============

@router.get("/field-jobs/{job_id}/qr-code")
async def get_field_qr_code(job_id: str, current_user: dict = Depends(get_current_user)):
    job = await db.field_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    import qrcode
    from io import BytesIO
    base_url = os.environ.get("BASE_URL", "https://nexusops.io")
    qr_data = f"{base_url}/field/{job_id}"
    qr = qrcode.QRCode(version=1, box_size=10, border=4)
    qr.add_data(qr_data)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    filename = f"qr_fj_{job_id[:8]}.png"
    filepath = os.path.join(PHOTO_DIR, filename)
    with open(filepath, "wb") as f:
        f.write(buf.getvalue())
    return FileResponse(filepath, media_type="image/png", filename=f"QR_{job.get('job_number', job_id)}.png")


# ============== JOB PDF / COMPLETION REPORT ==============

@router.get("/field-jobs/{job_id}/pdf")
async def generate_field_pdf(job_id: str, current_user: dict = Depends(get_current_user)):
    job = await db.field_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    branding = await db.settings.find_one({"type": "branding"}, {"_id": 0})
    checklist = await db.field_checklists.find({"job_id": job_id}, {"_id": 0}).sort("order", 1).to_list(100)
    notes = await db.field_notes.find({"job_id": job_id}, {"_id": 0}).sort("created_at", 1).to_list(100)
    equipment = await db.field_equipment.find({"job_id": job_id}, {"_id": 0}).to_list(100)
    materials = await db.field_materials.find({"job_id": job_id}, {"_id": 0}).to_list(100)
    site_info = await db.field_site_info.find_one({"job_id": job_id}, {"_id": 0}) or {}

    from fpdf import FPDF

    class FieldJobPDF(FPDF):
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
            self.cell(0, 5, "Field Service / Cabling Report", ln=True, align="C")
            self.ln(3)
            self.set_draw_color(100, 100, 100)
            self.line(10, self.get_y(), 200, self.get_y())
            self.ln(5)

        def footer(self):
            self.set_y(-15)
            self.set_font("Helvetica", "I", 8)
            self.set_text_color(128)
            self.cell(0, 10, f"Page {self.page_no()}/{{nb}}", align="C")

    pdf = FieldJobPDF()
    pdf.alias_nb_pages()
    pdf.add_page()
    pdf.set_auto_page_break(auto=True, margin=20)

    # Job info
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, f"Job: {job.get('job_number', 'N/A')}", ln=True)
    pdf.set_font("Helvetica", "", 10)
    status = job.get("field_status", "unknown").replace("_", " ").title()
    pdf.cell(0, 6, f"Status: {status}  |  Category: {job.get('job_category', 'N/A').title()}  |  Priority: {job.get('priority', 'normal').title()}", ln=True)
    pdf.cell(0, 6, f"Scheduled: {job.get('scheduled_date', '')} {job.get('scheduled_time', '')}  |  Duration: {job.get('estimated_duration', '60')} min", ln=True)
    pdf.cell(0, 6, f"Technician: {job.get('assigned_to_name') or 'Unassigned'}", ln=True)
    pdf.ln(3)

    # Customer & site
    pdf.set_fill_color(240, 240, 240)
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(0, 7, "  Customer & Site", ln=True, fill=True)
    pdf.set_font("Helvetica", "", 9)
    pdf.cell(95, 6, f"  Customer: {job.get('customer_name', 'N/A')}")
    pdf.cell(95, 6, f"Phone: {job.get('customer_phone', 'N/A')}", ln=True)
    pdf.cell(0, 6, f"  Address: {job.get('service_address', 'N/A')}", ln=True)
    pdf.cell(95, 6, f"  Zone: {job.get('zone', 'N/A')}")
    pdf.cell(95, 6, f"Email: {job.get('customer_email', 'N/A')}", ln=True)
    pdf.ln(2)

    # Description
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(0, 7, "  Job Description", ln=True, fill=True)
    pdf.set_font("Helvetica", "", 9)
    pdf.multi_cell(0, 5, f"  {job.get('description', 'N/A')}")
    pdf.ln(2)

    # Site survey info
    if site_info:
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(0, 7, "  Site Survey Details", ln=True, fill=True)
        pdf.set_font("Helvetica", "", 9)
        for key in ["access_notes", "mounting_type", "cable_entry_point", "weather_conditions", "safety_hazards", "existing_infrastructure"]:
            val = site_info.get(key)
            if val:
                label = key.replace("_", " ").title()
                pdf.cell(0, 5, f"  {label}: {val}", ln=True)
        pdf.ln(2)

    # Signal / speed
    if job.get("signal_strength") or job.get("speed_test_down") or job.get("speed_test_up"):
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(0, 7, "  Signal & Speed Test Results", ln=True, fill=True)
        pdf.set_font("Helvetica", "", 9)
        pdf.cell(63, 6, f"  Signal: {job.get('signal_strength', 'N/A')} dBm")
        pdf.cell(63, 6, f"Download: {job.get('speed_test_down', 'N/A')} Mbps")
        pdf.cell(63, 6, f"Upload: {job.get('speed_test_up', 'N/A')} Mbps", ln=True)
        pdf.ln(2)

    # Equipment
    if equipment:
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(0, 7, "  Equipment Installed / Removed", ln=True, fill=True)
        pdf.set_font("Helvetica", "B", 9)
        pdf.cell(35, 6, "  Type", border=1)
        pdf.cell(40, 6, "Brand/Model", border=1)
        pdf.cell(35, 6, "Serial", border=1)
        pdf.cell(35, 6, "MAC", border=1)
        pdf.cell(30, 6, "IP", border=1)
        pdf.cell(15, 6, "Action", border=1, ln=True)
        pdf.set_font("Helvetica", "", 8)
        for eq in equipment:
            pdf.cell(35, 5, f"  {eq.get('equipment_type', '')[:15]}", border=1)
            pdf.cell(40, 5, f"{eq.get('brand', '')} {eq.get('model', '')}"[:20], border=1)
            pdf.cell(35, 5, str(eq.get("serial_number", ""))[:15], border=1)
            pdf.cell(35, 5, str(eq.get("mac_address", ""))[:17], border=1)
            pdf.cell(30, 5, str(eq.get("ip_address", ""))[:15], border=1)
            pdf.cell(15, 5, eq.get("action", "")[:8], border=1, ln=True)
        pdf.ln(2)

    # Materials
    if materials:
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(0, 7, "  Materials Used", ln=True, fill=True)
        pdf.set_font("Helvetica", "B", 9)
        pdf.cell(80, 6, "  Material", border=1)
        pdf.cell(25, 6, "Qty", border=1, align="C")
        pdf.cell(25, 6, "Unit", border=1, align="C")
        pdf.cell(30, 6, "Cost", border=1, align="R")
        pdf.cell(30, 6, "Total", border=1, align="R", ln=True)
        pdf.set_font("Helvetica", "", 9)
        for m in materials:
            pdf.cell(80, 6, f"  {m.get('material', 'N/A')}", border=1)
            pdf.cell(25, 6, str(m.get("quantity", 0)), border=1, align="C")
            pdf.cell(25, 6, m.get("unit", "each"), border=1, align="C")
            pdf.cell(30, 6, f"${m.get('unit_cost', 0):.2f}", border=1, align="R")
            pdf.cell(30, 6, f"${m.get('total', 0):.2f}", border=1, align="R", ln=True)
        mat_total = sum(m.get("total", 0) for m in materials)
        pdf.set_font("Helvetica", "B", 9)
        pdf.cell(155, 6, "  Materials Total:")
        pdf.cell(30, 6, f"${mat_total:.2f}", align="R", ln=True)
        pdf.ln(2)

    # Checklist
    if checklist:
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(0, 7, "  Completion Checklist", ln=True, fill=True)
        pdf.set_font("Helvetica", "", 9)
        for item in checklist:
            mark = "[X]" if item.get("checked") else "[ ]"
            info = f" - {item.get('checked_by_name', '')}" if item.get("checked") else ""
            pdf.cell(0, 5, f"  {mark} {item.get('item', '')}{info}", ln=True)
        pdf.ln(2)

    # Notes
    if notes:
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(0, 7, "  Field Notes", ln=True, fill=True)
        pdf.set_font("Helvetica", "", 8)
        for n in notes[:20]:
            pdf.set_font("Helvetica", "B", 8)
            pdf.cell(0, 5, f"  {n.get('user_name', '')} - {n.get('created_at', '')[:16]}", ln=True)
            pdf.set_font("Helvetica", "", 8)
            pdf.multi_cell(0, 4, f"    {n.get('content', '')[:300]}")
            pdf.ln(1)

    # Signatures
    pdf.ln(10)
    pdf.set_font("Helvetica", "", 9)
    pdf.cell(0, 6, "Customer Signature: ___________________________    Date: _______________", ln=True)
    pdf.cell(0, 6, "Technician Signature: __________________________    Date: _______________", ln=True)

    output_path = f"/tmp/field_job_{job_id[:8]}.pdf"
    pdf.output(output_path)
    return FileResponse(output_path, media_type="application/pdf", filename=f"FieldJob_{job.get('job_number', job_id)}.pdf")


# ============== FIELD DISPATCH QUEUE ==============

@router.get("/field-jobs/dispatch-queue")
async def get_field_dispatch_queue(current_user: dict = Depends(get_current_user)):
    jobs = await db.field_jobs.find(
        {"job_type": "field", "field_status": {"$nin": ["completed", "cancelled"]}},
        {"_id": 0}
    ).sort("scheduled_date", 1).to_list(500)
    columns = {
        "scheduled": [],
        "en_route": [],
        "on_site": [],
        "in_progress": [],
    }
    for j in jobs:
        status = j.get("field_status", "scheduled")
        if status in columns:
            columns[status].append(j)
    return columns
