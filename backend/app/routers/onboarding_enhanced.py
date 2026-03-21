from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import uuid
import random

router = APIRouter(prefix="/onboarding-enhanced", tags=["onboarding-enhanced"])

ONBOARDING_TEMPLATES = {
    "small_office": {
        "name": "Small Office (1-20 users)",
        "description": "Quick setup for small businesses with basic IT needs",
        "estimated_days": 3,
        "default_tier": "basic",
        "default_sla": "business_hours",
        "checklist_profile": "essential",
    },
    "mid_market": {
        "name": "Mid-Market (21-100 users)",
        "description": "Standard onboarding with compliance and security baseline",
        "estimated_days": 7,
        "default_tier": "standard",
        "default_sla": "priority",
        "checklist_profile": "standard",
    },
    "enterprise": {
        "name": "Enterprise (100+ users)",
        "description": "Full white-glove onboarding with dedicated project manager",
        "estimated_days": 14,
        "default_tier": "premium",
        "default_sla": "critical_24x7",
        "checklist_profile": "comprehensive",
    },
    "break_fix": {
        "name": "Break/Fix Client",
        "description": "Minimal onboarding for ad-hoc support clients",
        "estimated_days": 1,
        "default_tier": "basic",
        "default_sla": "best_effort",
        "checklist_profile": "minimal",
    },
}

STEP_DEFINITIONS = [
    {"num": 1, "key": "company_profile", "title": "Company Profile", "icon": "building", "est_minutes": 10},
    {"num": 2, "key": "contacts_access", "title": "Contacts & Access", "icon": "users", "est_minutes": 15},
    {"num": 3, "key": "asset_discovery", "title": "Asset Discovery", "icon": "monitor", "est_minutes": 20},
    {"num": 4, "key": "contracts_billing", "title": "Contracts & Billing", "icon": "file-text", "est_minutes": 15},
    {"num": 5, "key": "security_compliance", "title": "Security & Compliance", "icon": "shield", "est_minutes": 15},
    {"num": 6, "key": "monitoring_automation", "title": "Monitoring & Automation", "icon": "activity", "est_minutes": 10},
    {"num": 7, "key": "documentation", "title": "Documentation", "icon": "book", "est_minutes": 10},
    {"num": 8, "key": "go_live", "title": "Go Live", "icon": "rocket", "est_minutes": 5},
]

PREFLIGHT_CHECKLIST = [
    {"id": "pf-01", "task": "Primary contact verified and has portal access", "category": "access", "critical": True},
    {"id": "pf-02", "task": "All devices enrolled and reporting to RMM agent", "category": "devices", "critical": True},
    {"id": "pf-03", "task": "Backup solution configured and first backup completed", "category": "backup", "critical": True},
    {"id": "pf-04", "task": "Security baseline assessment passed", "category": "security", "critical": True},
    {"id": "pf-05", "task": "Monitoring alerts tested (CPU/RAM/Disk thresholds)", "category": "monitoring", "critical": True},
    {"id": "pf-06", "task": "Contract signed and billing configured", "category": "billing", "critical": True},
    {"id": "pf-07", "task": "Network documentation completed", "category": "documentation", "critical": False},
    {"id": "pf-08", "task": "Emergency contact list distributed", "category": "access", "critical": False},
    {"id": "pf-09", "task": "End-user training session scheduled", "category": "training", "critical": False},
    {"id": "pf-10", "task": "Welcome packet sent to client", "category": "communication", "critical": False},
    {"id": "pf-11", "task": "MFA enforced on all admin accounts", "category": "security", "critical": True},
    {"id": "pf-12", "task": "Patch management policy applied", "category": "patching", "critical": False},
    {"id": "pf-13", "task": "DNS/domain credentials documented", "category": "documentation", "critical": False},
    {"id": "pf-14", "task": "Vendor access credentials stored in password vault", "category": "security", "critical": False},
]


def _build_empty_session(session_id: str, template_key: str, user_name: str) -> dict:
    template = ONBOARDING_TEMPLATES.get(template_key, ONBOARDING_TEMPLATES["mid_market"])
    now = datetime.now(timezone.utc).isoformat()
    steps = {}
    for sd in STEP_DEFINITIONS:
        steps[sd["key"]] = {
            "status": "pending",
            "data": {},
            "notes": "",
            "assigned_to": "",
            "started_at": None,
            "completed_at": None,
        }
    return {
        "id": session_id,
        "status": "in_progress",
        "current_step": 1,
        "total_steps": len(STEP_DEFINITIONS),
        "template": template_key,
        "template_name": template["name"],
        "steps": steps,
        "preflight": {item["id"]: False for item in PREFLIGHT_CHECKLIST},
        "client_id": None,
        "client_name": "",
        "health_score": 0,
        "estimated_days": template["estimated_days"],
        "audit_log": [
            {"action": "session_created", "by": user_name, "at": now, "detail": f"Template: {template['name']}"}
        ],
        "tags": [],
        "priority": "normal",
        "created_at": now,
        "created_by": user_name,
        "updated_at": now,
    }


def _calc_health_score(session: dict) -> int:
    steps = session.get("steps", {})
    total = len(steps)
    if total == 0:
        return 0
    completed = sum(1 for s in steps.values() if s.get("status") == "completed")
    preflight = session.get("preflight", {})
    pf_total = len(preflight)
    pf_done = sum(1 for v in preflight.values() if v)
    step_score = (completed / total) * 70
    pf_score = (pf_done / max(pf_total, 1)) * 30
    return round(step_score + pf_score)


@router.get("/templates")
async def get_templates(current_user: dict = Depends(get_current_user)):
    return {"templates": ONBOARDING_TEMPLATES, "step_definitions": STEP_DEFINITIONS}


@router.post("/sessions")
async def create_session(data: dict, current_user: dict = Depends(get_current_user)):
    session_id = f"OB-{uuid.uuid4().hex[:6].upper()}"
    template_key = data.get("template", "mid_market")
    user_name = current_user.get("name", "System")
    doc = _build_empty_session(session_id, template_key, user_name)
    if data.get("client_name"):
        doc["client_name"] = data["client_name"]
    if data.get("priority"):
        doc["priority"] = data["priority"]
    if data.get("tags"):
        doc["tags"] = data["tags"]
    await db.onboarding_enhanced.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.get("/sessions")
async def list_sessions(current_user: dict = Depends(get_current_user)):
    sessions = await db.onboarding_enhanced.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    for s in sessions:
        s["health_score"] = _calc_health_score(s)
    stats = {
        "total": len(sessions),
        "in_progress": len([s for s in sessions if s["status"] == "in_progress"]),
        "completed": len([s for s in sessions if s["status"] == "completed"]),
        "paused": len([s for s in sessions if s["status"] == "paused"]),
        "avg_health": round(sum(s.get("health_score", 0) for s in sessions) / max(len(sessions), 1)),
    }
    return {"sessions": sessions, "stats": stats}


@router.get("/sessions/{session_id}")
async def get_session(session_id: str, current_user: dict = Depends(get_current_user)):
    s = await db.onboarding_enhanced.find_one({"id": session_id}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    s["health_score"] = _calc_health_score(s)
    return s


@router.put("/sessions/{session_id}/step/{step_key}")
async def save_step(session_id: str, step_key: str, data: dict, current_user: dict = Depends(get_current_user)):
    session = await db.onboarding_enhanced.find_one({"id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    now = datetime.now(timezone.utc).isoformat()
    user_name = current_user.get("name", "System")
    step_data = data.get("step_data", {})
    action = data.get("action", "save")  # save | complete | skip

    updates = {
        f"steps.{step_key}.data": step_data,
        f"steps.{step_key}.notes": data.get("notes", session["steps"].get(step_key, {}).get("notes", "")),
        "updated_at": now,
    }

    if action == "complete":
        updates[f"steps.{step_key}.status"] = "completed"
        updates[f"steps.{step_key}.completed_at"] = now

        # Auto-advance current step
        step_nums = {sd["key"]: sd["num"] for sd in STEP_DEFINITIONS}
        current_num = step_nums.get(step_key, 1)
        if current_num >= session.get("current_step", 1):
            updates["current_step"] = min(current_num + 1, len(STEP_DEFINITIONS))

        # Side effects per step
        await _handle_step_side_effects(session_id, session, step_key, step_data, user_name)

    elif action == "skip":
        updates[f"steps.{step_key}.status"] = "skipped"
        step_nums = {sd["key"]: sd["num"] for sd in STEP_DEFINITIONS}
        current_num = step_nums.get(step_key, 1)
        if current_num >= session.get("current_step", 1):
            updates["current_step"] = min(current_num + 1, len(STEP_DEFINITIONS))

    # Audit log
    log_entry = {"action": f"step_{action}", "step": step_key, "by": user_name, "at": now}
    await db.onboarding_enhanced.update_one(
        {"id": session_id},
        {"$set": updates, "$push": {"audit_log": log_entry}}
    )

    updated = await db.onboarding_enhanced.find_one({"id": session_id}, {"_id": 0})
    updated["health_score"] = _calc_health_score(updated)
    return updated


async def _handle_step_side_effects(session_id: str, session: dict, step_key: str, step_data: dict, user_name: str):
    now = datetime.now(timezone.utc).isoformat()

    if step_key == "company_profile":
        client_id = f"CLT-{uuid.uuid4().hex[:6].upper()}"
        client = {
            "id": client_id,
            "name": step_data.get("company_name", ""),
            "email": step_data.get("email", ""),
            "phone": step_data.get("phone", ""),
            "address": step_data.get("address", ""),
            "city": step_data.get("city", ""),
            "state": step_data.get("state", ""),
            "zip_code": step_data.get("zip_code", ""),
            "country": step_data.get("country", "US"),
            "industry": step_data.get("industry", ""),
            "employee_count": step_data.get("employee_count", 0),
            "timezone": step_data.get("timezone", "America/New_York"),
            "business_hours": step_data.get("business_hours", "9:00 AM - 5:00 PM"),
            "tier": step_data.get("tier", "standard"),
            "website": step_data.get("website", ""),
            "status": "onboarding",
            "created_at": now,
            "onboarded": False,
            "onboarding_id": session_id,
        }
        await db.clients.insert_one(client)
        await db.onboarding_enhanced.update_one(
            {"id": session_id},
            {"$set": {"client_id": client_id, "client_name": step_data.get("company_name", "")}}
        )

    elif step_key == "contacts_access":
        client_id = session.get("client_id")
        contacts = step_data.get("contacts", [])
        for c in contacts:
            if not c.get("name"):
                continue
            contact = {
                "id": f"CON-{uuid.uuid4().hex[:6].upper()}",
                "client_id": client_id,
                "name": c.get("name", ""),
                "email": c.get("email", ""),
                "phone": c.get("phone", ""),
                "role": c.get("role", "primary"),
                "title": c.get("title", ""),
                "portal_access": c.get("portal_access", False),
                "receives_alerts": c.get("receives_alerts", False),
                "created_at": now,
            }
            await db.client_contacts.insert_one(contact)

    elif step_key == "asset_discovery":
        client_id = session.get("client_id")
        client_name = session.get("client_name", "")
        devices = step_data.get("devices", [])
        for d in devices:
            if not d.get("hostname"):
                continue
            device = {
                "id": f"DEV-{uuid.uuid4().hex[:6].upper()}",
                "hostname": d.get("hostname", ""),
                "device_type": d.get("type", "workstation"),
                "os": d.get("os", ""),
                "ip_address": d.get("ip", ""),
                "mac_address": d.get("mac", ""),
                "serial_number": d.get("serial", ""),
                "manufacturer": d.get("manufacturer", ""),
                "model": d.get("model", ""),
                "location": d.get("location", ""),
                "client_id": client_id,
                "client_name": client_name,
                "status": "online",
                "monitoring_enabled": True,
                "agent_installed": False,
                "created_at": now,
            }
            await db.devices.insert_one(device)

    elif step_key == "contracts_billing":
        client_id = session.get("client_id")
        if step_data.get("create_contract"):
            contract = {
                "id": f"CTR-{uuid.uuid4().hex[:6].upper()}",
                "client_id": client_id,
                "name": step_data.get("contract_name", "Managed IT Services"),
                "type": step_data.get("contract_type", "managed"),
                "value": step_data.get("monthly_value", 0),
                "billing_cycle": step_data.get("billing_cycle", "monthly"),
                "sla_tier": step_data.get("sla_tier", "standard"),
                "sla_response_hours": step_data.get("sla_response_hours", 4),
                "sla_resolution_hours": step_data.get("sla_resolution_hours", 24),
                "start_date": step_data.get("start_date", datetime.now(timezone.utc).date().isoformat()),
                "end_date": step_data.get("end_date", ""),
                "auto_renew": step_data.get("auto_renew", True),
                "payment_terms": step_data.get("payment_terms", "net_30"),
                "status": "active",
                "created_at": now,
            }
            await db.contracts.insert_one(contract)


@router.put("/sessions/{session_id}/preflight")
async def update_preflight(session_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    session = await db.onboarding_enhanced.find_one({"id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    checklist = data.get("preflight", {})
    now = datetime.now(timezone.utc).isoformat()
    await db.onboarding_enhanced.update_one(
        {"id": session_id},
        {"$set": {"preflight": checklist, "updated_at": now}}
    )
    updated = await db.onboarding_enhanced.find_one({"id": session_id}, {"_id": 0})
    updated["health_score"] = _calc_health_score(updated)
    return updated


@router.put("/sessions/{session_id}/complete")
async def complete_session(session_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    session = await db.onboarding_enhanced.find_one({"id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    now = datetime.now(timezone.utc).isoformat()
    user_name = current_user.get("name", "System")

    # Mark client as fully onboarded
    if session.get("client_id"):
        await db.clients.update_one(
            {"id": session["client_id"]},
            {"$set": {"status": "active", "onboarded": True, "onboarded_at": now}}
        )

    # Optionally create first ticket
    first_ticket = data.get("first_ticket")
    ticket_id = None
    if first_ticket and first_ticket.get("subject"):
        ticket_id = f"TKT-{uuid.uuid4().hex[:6].upper()}"
        ticket = {
            "id": ticket_id,
            "subject": first_ticket["subject"],
            "description": first_ticket.get("description", ""),
            "priority": first_ticket.get("priority", "low"),
            "status": "open",
            "client_id": session.get("client_id"),
            "client_name": session.get("client_name", ""),
            "category": "onboarding",
            "created_at": now,
            "created_by": user_name,
        }
        await db.tickets.insert_one(ticket)

    log_entry = {"action": "onboarding_completed", "by": user_name, "at": now, "detail": f"Ticket: {ticket_id}" if ticket_id else "No first ticket"}

    await db.onboarding_enhanced.update_one(
        {"id": session_id},
        {"$set": {
            "status": "completed",
            "completed_at": now,
            "completed_by": user_name,
            "first_ticket_id": ticket_id,
        }, "$push": {"audit_log": log_entry}}
    )
    updated = await db.onboarding_enhanced.find_one({"id": session_id}, {"_id": 0})
    updated["health_score"] = _calc_health_score(updated)
    return updated


@router.put("/sessions/{session_id}/pause")
async def pause_session(session_id: str, current_user: dict = Depends(get_current_user)):
    session = await db.onboarding_enhanced.find_one({"id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    now = datetime.now(timezone.utc).isoformat()
    new_status = "in_progress" if session["status"] == "paused" else "paused"
    log_entry = {"action": f"session_{new_status}", "by": current_user.get("name", "System"), "at": now}
    await db.onboarding_enhanced.update_one(
        {"id": session_id},
        {"$set": {"status": new_status, "updated_at": now}, "$push": {"audit_log": log_entry}}
    )
    updated = await db.onboarding_enhanced.find_one({"id": session_id}, {"_id": 0})
    updated["health_score"] = _calc_health_score(updated)
    return updated


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.onboarding_enhanced.delete_one({"id": session_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"message": "Session deleted"}


@router.get("/sessions/{session_id}/audit-log")
async def get_audit_log(session_id: str, current_user: dict = Depends(get_current_user)):
    session = await db.onboarding_enhanced.find_one({"id": session_id}, {"_id": 0, "audit_log": 1, "id": 1})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"session_id": session_id, "audit_log": session.get("audit_log", [])}


@router.get("/preflight-checklist")
async def get_preflight_checklist(current_user: dict = Depends(get_current_user)):
    return {"checklist": PREFLIGHT_CHECKLIST}


@router.get("/dashboard-stats")
async def get_dashboard_stats(current_user: dict = Depends(get_current_user)):
    sessions = await db.onboarding_enhanced.find({}, {"_id": 0}).to_list(500)
    total = len(sessions)
    completed = [s for s in sessions if s["status"] == "completed"]
    in_progress = [s for s in sessions if s["status"] == "in_progress"]
    paused = [s for s in sessions if s["status"] == "paused"]

    avg_completion_days = 0
    if completed:
        durations = []
        for s in completed:
            try:
                start = datetime.fromisoformat(s["created_at"].replace("Z", "+00:00"))
                end = datetime.fromisoformat(s["completed_at"].replace("Z", "+00:00"))
                durations.append((end - start).days)
            except Exception:
                pass
        if durations:
            avg_completion_days = round(sum(durations) / len(durations), 1)

    devices_onboarded = 0
    for s in sessions:
        dev_data = s.get("steps", {}).get("asset_discovery", {}).get("data", {})
        devices_onboarded += len(dev_data.get("devices", []))

    return {
        "total_sessions": total,
        "in_progress": len(in_progress),
        "completed": len(completed),
        "paused": len(paused),
        "avg_completion_days": avg_completion_days,
        "devices_onboarded": devices_onboarded,
        "completion_rate": round(len(completed) / max(total, 1) * 100, 1),
        "avg_health": round(sum(_calc_health_score(s) for s in sessions) / max(total, 1)),
    }
