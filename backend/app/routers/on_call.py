from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db
from app.auth import get_current_user

router = APIRouter()

# ============== ON-CALL ROSTER ==============

@router.get("/on-call/roster")
async def get_on_call_roster(current_user: dict = Depends(get_current_user)):
    shifts = await db.on_call_roster.find({}, {"_id": 0}).sort("start_time", 1).to_list(500)
    return shifts

@router.get("/on-call/active")
async def get_active_on_call(current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc).isoformat()
    active = await db.on_call_roster.find({
        "start_time": {"$lte": now}, "end_time": {"$gte": now}, "status": {"$ne": "cancelled"}
    }, {"_id": 0}).to_list(50)
    return active

@router.post("/on-call/roster")
async def create_on_call_shift(data: dict, current_user: dict = Depends(get_current_user)):
    shift = {
        "id": str(uuid.uuid4()),
        "tech_id": data.get("tech_id", ""),
        "tech_name": data.get("tech_name", ""),
        "shift_type": data.get("shift_type", "primary"),
        "category": data.get("category", "general"),
        "start_time": data.get("start_time", ""),
        "end_time": data.get("end_time", ""),
        "notes": data.get("notes", ""),
        "status": "scheduled",
        "swapped_from": None,
        "swapped_by": None,
        "created_by": current_user["id"],
        "created_by_name": current_user.get("name", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.on_call_roster.insert_one(shift)
    shift.pop("_id", None)
    # Notify tech
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()), "user_id": shift["tech_id"],
        "title": "On-Call Shift Assigned",
        "message": f"You are scheduled on-call ({shift['category']}) from {shift['start_time'][:10]} to {shift['end_time'][:10]}.",
        "severity": "info", "type": "on_call_assigned", "read": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return shift

@router.put("/on-call/roster/{shift_id}")
async def update_on_call_shift(shift_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    allowed = {"tech_id", "tech_name", "shift_type", "category", "start_time", "end_time", "notes", "status"}
    update = {k: v for k, v in data.items() if k in allowed}
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.on_call_roster.update_one({"id": shift_id}, {"$set": update})
    return {"message": "Shift updated"}

@router.delete("/on-call/roster/{shift_id}")
async def delete_on_call_shift(shift_id: str, current_user: dict = Depends(get_current_user)):
    await db.on_call_roster.delete_one({"id": shift_id})
    return {"message": "Shift deleted"}

@router.post("/on-call/roster/{shift_id}/swap")
async def swap_on_call_shift(shift_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    shift = await db.on_call_roster.find_one({"id": shift_id}, {"_id": 0})
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found")
    new_tech_id = data.get("new_tech_id")
    new_tech_name = data.get("new_tech_name", "")
    if not new_tech_id:
        raise HTTPException(status_code=400, detail="New tech required")
    old_tech_id = shift["tech_id"]
    old_tech_name = shift["tech_name"]
    await db.on_call_roster.update_one({"id": shift_id}, {"$set": {
        "tech_id": new_tech_id, "tech_name": new_tech_name,
        "swapped_from": old_tech_id, "swapped_by": current_user.get("name", ""),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }})
    # Notify both techs
    for uid, msg in [
        (old_tech_id, f"Your on-call shift has been reassigned to {new_tech_name}. Swap initiated by {current_user.get('name', '')}"),
        (new_tech_id, f"You have been assigned an on-call shift (swapped from {old_tech_name}). Swap initiated by {current_user.get('name', '')}"),
    ]:
        await db.notifications.insert_one({
            "id": str(uuid.uuid4()), "user_id": uid,
            "title": "On-Call Shift Swap", "message": msg,
            "severity": "warning", "type": "on_call_swap", "read": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    return {"message": f"Shift swapped from {old_tech_name} to {new_tech_name}"}

@router.post("/on-call/ping-active")
async def ping_active_on_call(current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc).isoformat()
    active = await db.on_call_roster.find({
        "start_time": {"$lte": now}, "end_time": {"$gte": now}, "status": {"$ne": "cancelled"}
    }, {"_id": 0}).to_list(50)
    pings = 0
    for shift in active:
        await db.notifications.insert_one({
            "id": str(uuid.uuid4()), "user_id": shift["tech_id"],
            "title": "You are ON CALL",
            "message": f"Reminder: You are currently on-call ({shift.get('category', 'general')}). Shift ends {shift['end_time'][:16]}.",
            "severity": "warning", "type": "on_call_ping", "read": False,
            "created_at": now,
        })
        pings += 1
    return {"message": f"Pinged {pings} on-call technicians"}

# ============== WORKSHOP / REPAIR JOBS ==============

@router.get("/workshop/jobs")
async def get_workshop_jobs(status: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {"job_type": "workshop"}
    if status:
        query["repair_status"] = status
    jobs = await db.workshop_jobs.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    return jobs

@router.post("/workshop/jobs")
async def create_workshop_job(data: dict, current_user: dict = Depends(get_current_user)):
    count = await db.workshop_jobs.count_documents({})
    numbering = await db.settings.find_one({"type": "job_numbering"}, {"_id": 0})
    ws_prefix = numbering.get("workshop_prefix", "WS-") if numbering else "WS-"
    job = {
        "id": str(uuid.uuid4()),
        "job_number": f"{ws_prefix}{count + 1001:04d}",
        "job_type": "workshop",
        "customer_name": data.get("customer_name", ""),
        "customer_phone": data.get("customer_phone", ""),
        "customer_email": data.get("customer_email", ""),
        "client_id": data.get("client_id", ""),
        "device_type": data.get("device_type", ""),
        "device_brand": data.get("device_brand", ""),
        "device_model": data.get("device_model", ""),
        "serial_number": data.get("serial_number", ""),
        "fault_description": data.get("fault_description", ""),
        "repair_status": "checked_in",
        "diagnosis": "",
        "repair_notes": "",
        "parts_used": [],
        "labour_minutes": 0,
        "labour_rate": float(data.get("labour_rate", 75)),
        "total_parts_cost": 0,
        "total_labour_cost": 0,
        "total_cost": 0,
        "estimated_cost": float(data.get("estimated_cost", 0)),
        "priority": data.get("priority", "normal"),
        "assigned_to": data.get("assigned_to", ""),
        "assigned_to_name": data.get("assigned_to_name", ""),
        "ticket_id": data.get("ticket_id", ""),
        "timer_running": False,
        "timer_started_at": None,
        "condition_on_arrival": data.get("condition_on_arrival", ""),
        "accessories_received": data.get("accessories_received", []),
        "customer_password": data.get("customer_password", ""),
        "warranty_status": data.get("warranty_status", "unknown"),
        "warranty_expiry": data.get("warranty_expiry", ""),
        "pickup_notified": False,
        "collected": False,
        "collected_at": None,
        "created_by": current_user["id"],
        "created_by_name": current_user.get("name", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.workshop_jobs.insert_one(job)
    job.pop("_id", None)
    return job

@router.get("/workshop/jobs/{job_id}")
async def get_workshop_job(job_id: str, current_user: dict = Depends(get_current_user)):
    job = await db.workshop_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job

@router.put("/workshop/jobs/{job_id}")
async def update_workshop_job(job_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    allowed = {"repair_status", "diagnosis", "repair_notes", "parts_used", "labour_minutes",
               "total_parts_cost", "total_labour_cost", "total_cost", "assigned_to", "assigned_to_name",
               "priority", "estimated_cost", "customer_name", "customer_phone", "customer_email",
               "device_type", "device_brand", "device_model", "fault_description", "serial_number",
               "condition_on_arrival", "accessories_received", "customer_password",
               "warranty_status", "warranty_expiry"}
    update = {k: v for k, v in data.items() if k in allowed}
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.workshop_jobs.update_one({"id": job_id}, {"$set": update})
    return {"message": "Job updated"}

@router.put("/workshop/jobs/{job_id}/status")
async def update_workshop_status(job_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    job = await db.workshop_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    new_status = data.get("status")
    update = {"repair_status": new_status, "updated_at": datetime.now(timezone.utc).isoformat()}
    if new_status == "collected":
        update["collected"] = True
        update["collected_at"] = datetime.now(timezone.utc).isoformat()
    await db.workshop_jobs.update_one({"id": job_id}, {"$set": update})
    # Notify pickup if ready
    if new_status == "ready_for_pickup" and not job.get("pickup_notified"):
        await db.workshop_jobs.update_one({"id": job_id}, {"$set": {"pickup_notified": True}})
    # Audit log
    try:
        from app.routers.workshop_enhanced import _ws_audit
        old_status = job.get("repair_status", "unknown")
        await _ws_audit(job_id, "status_changed", f"Status changed: {old_status} -> {new_status}", current_user)
    except Exception:
        pass
    return {"message": f"Status updated to {new_status}"}

@router.post("/workshop/jobs/{job_id}/add-part")
async def add_part_to_job(job_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    job = await db.workshop_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    product_id = data.get("product_id")
    qty = int(data.get("quantity", 1))
    # Deduct from inventory
    if product_id:
        product = await db.products.find_one({"id": product_id}, {"_id": 0})
        if product:
            new_stock = max(0, product.get("quantity_in_stock", 0) - qty)
            await db.products.update_one({"id": product_id}, {"$set": {
                "quantity_in_stock": new_stock, "updated_at": datetime.now(timezone.utc).isoformat()
            }})
            await db.stock_movements.insert_one({
                "id": str(uuid.uuid4()), "product_id": product_id,
                "product_name": product.get("name", ""), "type": "out",
                "quantity": qty, "previous_stock": product.get("quantity_in_stock", 0),
                "new_stock": new_stock,
                "reason": f"Workshop job {job['job_number']}",
                "reference": job_id,
                "created_by": current_user["id"],
                "created_by_name": current_user.get("name", ""),
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
    part = {
        "id": str(uuid.uuid4()),
        "product_id": product_id or "",
        "product_name": data.get("product_name", ""),
        "quantity": qty,
        "unit_price": float(data.get("unit_price", 0)),
        "total": qty * float(data.get("unit_price", 0)),
    }
    parts = job.get("parts_used", [])
    parts.append(part)
    total_parts = sum(p.get("total", 0) for p in parts)
    total_labour = (job.get("labour_minutes", 0) / 60) * job.get("labour_rate", 75)
    await db.workshop_jobs.update_one({"id": job_id}, {"$set": {
        "parts_used": parts, "total_parts_cost": round(total_parts, 2),
        "total_labour_cost": round(total_labour, 2),
        "total_cost": round(total_parts + total_labour, 2),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }})
    return {"message": "Part added", "part": part}

@router.put("/workshop/jobs/{job_id}/timer")
async def toggle_workshop_timer(job_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    job = await db.workshop_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    action = data.get("action", "toggle")
    now = datetime.now(timezone.utc)
    if action == "start" or (action == "toggle" and not job.get("timer_running")):
        await db.workshop_jobs.update_one({"id": job_id}, {"$set": {
            "timer_running": True, "timer_started_at": now.isoformat()
        }})
        return {"message": "Timer started", "timer_running": True}
    else:
        started = job.get("timer_started_at")
        added_minutes = 0
        if started:
            started_dt = datetime.fromisoformat(started.replace("Z", "+00:00"))
            added_minutes = int((now - started_dt).total_seconds() / 60)
        new_minutes = (job.get("labour_minutes", 0) + added_minutes)
        total_labour = (new_minutes / 60) * job.get("labour_rate", 75)
        total_parts = job.get("total_parts_cost", 0)
        await db.workshop_jobs.update_one({"id": job_id}, {"$set": {
            "timer_running": False, "timer_started_at": None,
            "labour_minutes": new_minutes,
            "total_labour_cost": round(total_labour, 2),
            "total_cost": round(total_parts + total_labour, 2),
        }})
        return {"message": f"Timer stopped. Added {added_minutes}min", "timer_running": False, "labour_minutes": new_minutes}

@router.get("/workshop/stats")
async def get_workshop_stats(current_user: dict = Depends(get_current_user)):
    jobs = await db.workshop_jobs.find({"job_type": "workshop"}, {"_id": 0}).to_list(10000)
    statuses = {}
    for j in jobs:
        s = j.get("repair_status", "unknown")
        statuses[s] = statuses.get(s, 0) + 1
    revenue = sum(j.get("total_cost", 0) for j in jobs if j.get("repair_status") == "collected")
    pending_revenue = sum(j.get("total_cost", 0) for j in jobs if j.get("repair_status") not in ("collected", "checked_in"))
    return {
        "total_jobs": len(jobs), "statuses": statuses,
        "revenue_collected": round(revenue, 2),
        "pending_revenue": round(pending_revenue, 2),
        "active_jobs": len([j for j in jobs if j.get("repair_status") not in ("collected", "cancelled")]),
    }

@router.delete("/workshop/jobs/{job_id}")
async def delete_workshop_job(job_id: str, current_user: dict = Depends(get_current_user)):
    await db.workshop_jobs.delete_one({"id": job_id})
    return {"message": "Job deleted"}

# ============== FIELD JOBS (WISP/INTERNET) ==============

@router.get("/field-jobs")
async def get_field_jobs(status: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {"job_type": "field"}
    if status:
        query["field_status"] = status
    jobs = await db.field_jobs.find(query, {"_id": 0}).sort("scheduled_date", 1).to_list(500)
    return jobs

@router.get("/field-jobs/templates")
async def get_checklist_templates(current_user: dict = Depends(get_current_user)):
    """Get checklist templates for different job categories"""
    return {
        "installation": [
            {"item": "Site survey complete", "checked": False},
            {"item": "Cable run / antenna mounted", "checked": False},
            {"item": "Router / CPE configured", "checked": False},
            {"item": "Speed test performed", "checked": False},
            {"item": "Customer walkthrough done", "checked": False},
            {"item": "Documentation photos taken", "checked": False},
        ],
        "maintenance": [
            {"item": "Equipment inspection", "checked": False},
            {"item": "Signal/speed verification", "checked": False},
            {"item": "Firmware updates applied", "checked": False},
            {"item": "Issue resolved / maintenance complete", "checked": False},
        ],
        "troubleshooting": [
            {"item": "Customer symptoms confirmed", "checked": False},
            {"item": "Signal strength tested", "checked": False},
            {"item": "Speed test (before fix)", "checked": False},
            {"item": "Issue identified", "checked": False},
            {"item": "Fix applied", "checked": False},
            {"item": "Speed test (after fix)", "checked": False},
            {"item": "Customer confirmation", "checked": False},
        ],
        "decommission": [
            {"item": "Equipment retrieved", "checked": False},
            {"item": "Configuration wiped", "checked": False},
            {"item": "Asset tagged for return", "checked": False},
            {"item": "Account updated", "checked": False},
        ],
    }

@router.get("/field-jobs/stats/summary")
async def get_field_job_stats(current_user: dict = Depends(get_current_user)):
    """Get field job statistics summary"""
    jobs = await db.field_jobs.find({"job_type": "field"}, {"_id": 0}).to_list(10000)
    statuses = {}
    for j in jobs:
        s = j.get("field_status", "unknown")
        statuses[s] = statuses.get(s, 0) + 1
    zones = {}
    for j in jobs:
        z = j.get("zone") or "Unassigned"
        zones[z] = zones.get(z, 0) + 1
    avg_signal = 0
    signal_jobs = [j for j in jobs if j.get("signal_strength")]
    if signal_jobs:
        avg_signal = round(sum(float(j["signal_strength"]) for j in signal_jobs) / len(signal_jobs), 1)
    return {
        "total_jobs": len(jobs), "statuses": statuses, "zones": zones,
        "avg_signal_strength": avg_signal,
        "today_jobs": len([j for j in jobs if j.get("scheduled_date") == datetime.now(timezone.utc).strftime("%Y-%m-%d")]),
    }

@router.post("/field-jobs")
async def create_field_job(data: dict, current_user: dict = Depends(get_current_user)):
    count = await db.field_jobs.count_documents({})
    numbering = await db.settings.find_one({"type": "job_numbering"}, {"_id": 0})
    cw_prefix = numbering.get("cabling_prefix", "CW-") if numbering else "CW-"
    job = {
        "id": str(uuid.uuid4()),
        "job_number": f"{cw_prefix}{count + 1001:04d}",
        "job_type": "field",
        "job_category": data.get("job_category", "installation"),
        "customer_name": data.get("customer_name", ""),
        "customer_phone": data.get("customer_phone", ""),
        "customer_email": data.get("customer_email", ""),
        "client_id": data.get("client_id", ""),
        "service_address": data.get("service_address", ""),
        "zone": data.get("zone", ""),
        "description": data.get("description", ""),
        "field_status": "scheduled",
        "priority": data.get("priority", "normal"),
        "assigned_to": data.get("assigned_to", ""),
        "assigned_to_name": data.get("assigned_to_name", ""),
        "scheduled_date": data.get("scheduled_date", ""),
        "scheduled_time": data.get("scheduled_time", ""),
        "estimated_duration": data.get("estimated_duration", "60"),
        "checklist": data.get("checklist", []),
        "signal_strength": None,
        "speed_test_down": None,
        "speed_test_up": None,
        "completion_notes": "",
        "photos": [],
        "ticket_id": data.get("ticket_id", ""),
        "created_by": current_user["id"],
        "created_by_name": current_user.get("name", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if not job["checklist"] and job["job_category"] == "installation":
        job["checklist"] = [
            {"item": "Site survey complete", "checked": False},
            {"item": "Cable run / antenna mounted", "checked": False},
            {"item": "Router / CPE configured", "checked": False},
            {"item": "Speed test performed", "checked": False},
            {"item": "Customer walkthrough done", "checked": False},
            {"item": "Documentation photos taken", "checked": False},
        ]
    elif not job["checklist"] and job["job_category"] == "maintenance":
        job["checklist"] = [
            {"item": "Equipment inspection", "checked": False},
            {"item": "Signal/speed verification", "checked": False},
            {"item": "Firmware updates applied", "checked": False},
            {"item": "Issue resolved / maintenance complete", "checked": False},
        ]
    await db.field_jobs.insert_one(job)
    job.pop("_id", None)
    return job

@router.get("/field-jobs/{job_id}")
async def get_field_job(job_id: str, current_user: dict = Depends(get_current_user)):
    job = await db.field_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Field job not found")
    return job

@router.put("/field-jobs/{job_id}")
async def update_field_job(job_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    allowed = {"field_status", "description", "assigned_to", "assigned_to_name", "scheduled_date",
               "scheduled_time", "estimated_duration", "checklist", "signal_strength",
               "speed_test_down", "speed_test_up", "completion_notes", "zone", "priority",
               "customer_name", "customer_phone", "service_address", "job_category"}
    update = {k: v for k, v in data.items() if k in allowed}
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.field_jobs.update_one({"id": job_id}, {"$set": update})
    return {"message": "Field job updated"}

@router.put("/field-jobs/{job_id}/status")
async def update_field_job_status(job_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    new_status = data.get("status")
    update = {"field_status": new_status, "updated_at": datetime.now(timezone.utc).isoformat()}
    if new_status == "completed":
        update["completed_at"] = datetime.now(timezone.utc).isoformat()
    await db.field_jobs.update_one({"id": job_id}, {"$set": update})
    return {"message": f"Status updated to {new_status}"}

@router.delete("/field-jobs/{job_id}")
async def delete_field_job(job_id: str, current_user: dict = Depends(get_current_user)):
    await db.field_jobs.delete_one({"id": job_id})
    return {"message": "Field job deleted"}

# ============== AUTO REORDER ALERTS ==============

@router.post("/inventory/check-reorder")
async def check_reorder_alerts(current_user: dict = Depends(get_current_user)):
    products = await db.products.find({"is_active": {"$ne": False}}, {"_id": 0}).to_list(10000)
    alerts_created = 0
    draft_pos_created = 0
    for p in products:
        qty = p.get("quantity_in_stock", 0)
        reorder = p.get("reorder_level", 5)
        if qty <= reorder:
            # Check if there's already an open PO with this product
            existing_po = await db.purchase_orders.find_one({
                "status": {"$in": ["draft", "submitted", "partial"]},
                "line_items.product_id": p["id"]
            }, {"_id": 0})
            if existing_po:
                continue
            # Check if alert already sent recently
            recent_alert = await db.notifications.find_one({
                "type": "reorder_alert", "ref_id": p["id"],
                "created_at": {"$gte": (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()}
            }, {"_id": 0})
            if recent_alert:
                continue
            # Create notification
            vendor_name = p.get("vendor", "Unknown Vendor")
            admins = await db.users.find({"$or": [{"role": "admin"}, {"is_admin": True}]}, {"_id": 0, "id": 1}).to_list(50)
            for admin in admins:
                await db.notifications.insert_one({
                    "id": str(uuid.uuid4()), "user_id": admin["id"],
                    "title": f"Reorder Alert: {p['name']}",
                    "message": f"Stock is at {qty} (reorder level: {reorder}). Vendor: {vendor_name}. No active PO found.",
                    "severity": "warning", "type": "reorder_alert",
                    "ref_type": "product", "ref_id": p["id"],
                    "read": False, "created_at": datetime.now(timezone.utc).isoformat(),
                })
            alerts_created += 1
            # Auto-create draft PO
            vendor = await db.vendors.find_one({"name": {"$regex": vendor_name, "$options": "i"}}, {"_id": 0})
            po_count = await db.purchase_orders.count_documents({})
            reorder_qty = max(reorder * 2, 10)
            po = {
                "id": str(uuid.uuid4()),
                "po_number": f"PO-{po_count + 1001:04d}",
                "vendor": vendor.get("name", vendor_name) if vendor else vendor_name,
                "vendor_id": vendor.get("id", "") if vendor else "",
                "vendor_contact": vendor.get("contact_name", "") if vendor else "",
                "vendor_email": vendor.get("email", "") if vendor else "",
                "status": "draft",
                "line_items": [{
                    "product_id": p["id"], "product_name": p["name"],
                    "quantity": reorder_qty, "unit_price": p.get("cost_price", 0),
                    "received_qty": 0, "status": "pending",
                }],
                "subtotal": round(reorder_qty * p.get("cost_price", 0), 2),
                "tax": 0, "shipping": 0,
                "total": round(reorder_qty * p.get("cost_price", 0), 2),
                "notes": f"Auto-generated: Stock below reorder level ({qty}/{reorder})",
                "ship_to": "", "expected_delivery": "",
                "assigned_to": "", "assigned_to_name": "",
                "created_by": "system", "created_by_name": "Auto-Reorder System",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "last_ping_at": None, "escalated": False, "escalated_at": None,
            }
            await db.purchase_orders.insert_one(po)
            draft_pos_created += 1
    return {"message": f"Reorder check complete. {alerts_created} alerts, {draft_pos_created} draft POs created."}


# ============== JOB NUMBERING SETTINGS ==============

@router.get("/settings/job-numbering")
async def get_job_numbering(current_user: dict = Depends(get_current_user)):
    doc = await db.settings.find_one({"type": "job_numbering"}, {"_id": 0})
    return doc or {
        "type": "job_numbering",
        "sla_prefix": "SLA-",
        "workshop_prefix": "WS-",
        "cabling_prefix": "CW-",
        "sla_next": 1001,
        "workshop_next": 1001,
        "cabling_next": 1001,
    }

@router.put("/settings/job-numbering")
async def update_job_numbering(data: dict, current_user: dict = Depends(get_current_user)):
    allowed = {"sla_prefix", "workshop_prefix", "cabling_prefix", "sla_next", "workshop_next", "cabling_next"}
    update = {k: v for k, v in data.items() if k in allowed}
    update["type"] = "job_numbering"
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.settings.update_one({"type": "job_numbering"}, {"$set": update}, upsert=True)
    return {"message": "Job numbering settings updated"}
