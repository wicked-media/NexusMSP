from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.models import *

router = APIRouter()

# ============== CLIENTS ENDPOINTS ==============

@router.get("/clients", response_model=List[Client])
async def get_clients(current_user: dict = Depends(get_current_user)):
    clients = await db.clients.find({}, {"_id": 0}).to_list(1000)
    for c in clients:
        if isinstance(c.get('created_at'), str):
            c['created_at'] = datetime.fromisoformat(c['created_at'])
    return clients

@router.get("/clients/{client_id}")
async def get_client(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client

@router.post("/clients", response_model=Client)
async def create_client(client_data: ClientCreate, current_user: dict = Depends(get_current_user)):
    client = Client(**client_data.model_dump())
    doc = client.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.clients.insert_one(doc)
    return client

@router.put("/clients/{client_id}")
async def update_client(client_id: str, client_data: ClientCreate, current_user: dict = Depends(get_current_user)):
    result = await db.clients.update_one({"id": client_id}, {"$set": client_data.model_dump()})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Client not found")
    return {"message": "Client updated"}

@router.delete("/clients/{client_id}")
async def delete_client(client_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.clients.delete_one({"id": client_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Client not found")
    return {"message": "Client deleted"}

# ============== CLIENT HEALTH SCORE ==============

@router.get("/clients/{client_id}/health")
async def get_client_health(client_id: str, current_user: dict = Depends(get_current_user)):
    """Calculate client health score (0-100) based on multiple factors"""
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return await _calc_health(client)

@router.get("/clients/health/all")
async def get_all_client_health(current_user: dict = Depends(get_current_user)):
    """Get health scores for all clients"""
    clients = await db.clients.find({}, {"_id": 0}).to_list(1000)
    results = []
    for c in clients:
        h = await _calc_health(c)
        results.append(h)
    return results

@router.get("/clients-enriched")
async def get_clients_enriched(current_user: dict = Depends(get_current_user)):
    """Rich one-shot dataset powering the revamped Clients page."""
    now = datetime.now(timezone.utc)
    clients = await db.clients.find({}, {"_id": 0}).to_list(1000)
    client_ids = [c["id"] for c in clients]

    open_tix_map = {}
    async for row in db.tickets.aggregate([
        {"$match": {"client_id": {"$in": client_ids}, "status": {"$in": ["open", "in_progress", "pending"]}}},
        {"$group": {"_id": "$client_id", "count": {"$sum": 1}}},
    ]):
        open_tix_map[row["_id"]] = row["count"]

    asset_map = {}
    async for row in db.devices.aggregate([
        {"$match": {"client_id": {"$in": client_ids}}},
        {"$group": {"_id": "$client_id", "count": {"$sum": 1}, "online": {"$sum": {"$cond": [{"$eq": ["$status", "online"]}, 1, 0]}}}},
    ]):
        asset_map[row["_id"]] = {"total": row["count"], "online": row["online"]}

    contact_map = {}
    async for row in db.contacts.aggregate([
        {"$match": {"client_id": {"$in": client_ids}}},
        {"$group": {"_id": "$client_id", "count": {"$sum": 1}}},
    ]):
        contact_map[row["_id"]] = row["count"]

    overdue_map = {}
    async for row in db.invoices.aggregate([
        {"$match": {"client_id": {"$in": client_ids}, "payment_status": {"$ne": "paid"}, "due_date": {"$lt": now.isoformat()}}},
        {"$group": {"_id": "$client_id", "count": {"$sum": 1}, "amount": {"$sum": "$total"}}},
    ]):
        overdue_map[row["_id"]] = {"count": row["count"], "amount": row["amount"]}

    month_keys = []
    for i in range(11, -1, -1):
        dt = (now.replace(day=1) - timedelta(days=30 * i)).strftime("%Y-%m")
        month_keys.append(dt)
    mrr_trend_map = {cid: {k: 0.0 for k in month_keys} for cid in client_ids}
    async for inv in db.invoices.find(
        {"client_id": {"$in": client_ids}, "created_at": {"$gte": (now - timedelta(days=366)).isoformat()}},
        {"_id": 0, "client_id": 1, "created_at": 1, "total": 1}
    ):
        try:
            key = (inv.get("created_at") or "")[:7]
            if key in mrr_trend_map.get(inv["client_id"], {}):
                mrr_trend_map[inv["client_id"]][key] += float(inv.get("total", 0))
        except Exception:
            continue

    active_contract_map = {}
    async for row in db.contracts.aggregate([
        {"$match": {"client_id": {"$in": client_ids}, "status": "active"}},
        {"$group": {"_id": "$client_id", "count": {"$sum": 1}, "mrr": {"$sum": "$monthly_value"}}},
    ]):
        active_contract_map[row["_id"]] = row

    acronis_links = {l["client_id"] async for l in db.acronis_customer_links.find({}, {"_id": 0, "client_id": 1})}
    pax8_links = {l["client_id"] async for l in db.pax8_company_links.find({}, {"_id": 0, "client_id": 1})}

    last_activity_map = {}
    async for t in db.tickets.find({"client_id": {"$in": client_ids}}, {"_id": 0, "client_id": 1, "updated_at": 1, "created_at": 1}).sort("updated_at", -1):
        cid = t["client_id"]
        if cid not in last_activity_map:
            last_activity_map[cid] = t.get("updated_at") or t.get("created_at")

    results = []
    for c in clients:
        cid = c["id"]
        health = await _calc_health(c)
        amap = asset_map.get(cid, {"total": 0, "online": 0})
        omap = overdue_map.get(cid, {"count": 0, "amount": 0})
        contract = active_contract_map.get(cid, {})
        mrr = float(contract.get("mrr") or c.get("mrr") or 0)
        trend = [{"month": k, "value": round(mrr_trend_map[cid].get(k, 0), 2)} for k in month_keys]

        results.append({
            "id": cid,
            "name": c.get("name"),
            "industry": c.get("industry"),
            "tier": c.get("tier", "standard"),
            "lifecycle": c.get("lifecycle", "active"),
            "logo_url": c.get("logo_url"),
            "primary_color": c.get("primary_color"),
            "primary_contact": c.get("primary_contact") or c.get("contact_name"),
            "email": c.get("email"),
            "phone": c.get("phone"),
            "address": c.get("address"),
            "health_score": health["health_score"],
            "risk_level": health["risk_level"],
            "open_tickets": open_tix_map.get(cid, 0),
            "asset_count": amap["total"],
            "assets_online": amap["online"],
            "contact_count": contact_map.get(cid, 0),
            "overdue_count": omap["count"],
            "overdue_amount": round(omap.get("amount", 0), 2),
            "mrr": mrr,
            "mrr_trend": trend,
            "active_contracts": int(contract.get("count", 0)),
            "integrations": {
                "acronis": cid in acronis_links,
                "pax8": cid in pax8_links,
                "m365": bool(c.get("m365_tenant_id") or c.get("office365_tenant_id")),
                "rmm": amap["total"] > 0,
                "suped": bool(c.get("suped_tenant_id")),
                "cipp": bool(c.get("cipp_tenant_id")),
            },
            "last_activity": last_activity_map.get(cid),
            "last_qbr": c.get("last_qbr"),
            "next_qbr": c.get("next_qbr"),
            "created_at": c.get("created_at") if isinstance(c.get("created_at"), str) else (c["created_at"].isoformat() if c.get("created_at") else None),
        })

    summary = {
        "client_count": len(results),
        "total_mrr": round(sum(r["mrr"] for r in results), 2),
        "avg_health": round(sum(r["health_score"] for r in results) / max(len(results), 1), 1),
        "at_risk": sum(1 for r in results if r["risk_level"] in ("at_risk", "critical")),
        "churned": sum(1 for r in results if r["lifecycle"] == "churned"),
        "prospects": sum(1 for r in results if r["lifecycle"] == "prospect"),
        "with_acronis": sum(1 for r in results if r["integrations"]["acronis"]),
        "with_pax8": sum(1 for r in results if r["integrations"]["pax8"]),
    }

    return {"summary": summary, "clients": results}

@router.get("/clients/{client_id}/activity-timeline")
async def get_client_activity_timeline(client_id: str, current_user: dict = Depends(get_current_user)):
    """Get combined activity timeline for a client"""
    timeline = []
    
    # Recent tickets
    tickets = await db.tickets.find({"client_id": client_id}, {"_id": 0}).sort("created_at", -1).to_list(20)
    for t in tickets:
        timeline.append({"type": "ticket", "title": t.get("title"), "ticket_number": t.get("ticket_number"), "status": t.get("status"), "priority": t.get("priority"), "timestamp": t.get("created_at"), "id": t.get("id")})
    
    # Recent invoices
    invoices = await db.invoices.find({"client_id": client_id}, {"_id": 0}).sort("created_at", -1).to_list(20)
    for inv in invoices:
        timeline.append({"type": "invoice", "title": f"Invoice #{inv.get('invoice_number','')}", "amount": inv.get("total", 0), "status": inv.get("status"), "timestamp": inv.get("created_at"), "id": inv.get("id")})
    
    # Recent time entries (via tickets linked to this client)
    client_ticket_ids = [t["id"] for t in tickets]
    if client_ticket_ids:
        time_entries = await db.time_entries.find({"ticket_id": {"$in": client_ticket_ids}}, {"_id": 0}).sort("date", -1).to_list(20)
        for te in time_entries:
            timeline.append({"type": "time_entry", "title": te.get("description", "Time logged"), "minutes": te.get("minutes"), "billable": te.get("billable"), "timestamp": te.get("date"), "id": te.get("id")})
    
    # Sort by timestamp descending
    timeline.sort(key=lambda x: x.get("timestamp", "") or "", reverse=True)
    return timeline[:50]

async def _calc_health(client):
    client_id = client["id"]
    now = datetime.now(timezone.utc)
    scores = {}
    
    # 1. Ticket Health (30 pts) - fewer open, more resolved = better
    open_tickets = await db.tickets.count_documents({"client_id": client_id, "status": {"$in": ["open", "in_progress"]}})
    total_tickets = await db.tickets.count_documents({"client_id": client_id})
    resolved_tickets = await db.tickets.count_documents({"client_id": client_id, "status": {"$in": ["resolved", "closed"]}})
    
    if total_tickets == 0:
        scores["tickets"] = 25  # neutral if no tickets
    else:
        resolution_rate = resolved_tickets / total_tickets
        open_ratio = open_tickets / max(total_tickets, 1)
        scores["tickets"] = round(max(0, min(30, resolution_rate * 30 - open_ratio * 15)))
    
    # 2. SLA Compliance (20 pts)
    sla_tickets = await db.tickets.find({"client_id": client_id, "sla_due": {"$exists": True}}, {"_id": 0, "sla_due": 1, "resolved_at": 1, "status": 1}).to_list(100)
    if sla_tickets:
        breached = sum(1 for t in sla_tickets if t.get("sla_due") and (t.get("resolved_at", now.isoformat()) > t["sla_due"]))
        sla_rate = 1 - (breached / len(sla_tickets))
        scores["sla"] = round(sla_rate * 20)
    else:
        scores["sla"] = 18
    
    # 3. Device Uptime (20 pts)
    devices = await db.devices.find({"client_id": client_id}, {"_id": 0, "status": 1}).to_list(100)
    if devices:
        online = sum(1 for d in devices if d.get("status") == "online")
        scores["devices"] = round((online / len(devices)) * 20)
    else:
        scores["devices"] = 15
    
    # 4. Payment Health (20 pts) - no overdue invoices = good
    overdue = await db.invoices.count_documents({"client_id": client_id, "status": {"$in": ["overdue", "sent"]}, "due_date": {"$lt": now.isoformat()}})
    total_invoices = await db.invoices.count_documents({"client_id": client_id})
    if total_invoices > 0:
        scores["payments"] = round(max(0, 20 - overdue * 5))
    else:
        scores["payments"] = 15
    
    # 5. Contract Status (10 pts)
    active_contracts = await db.contracts.find({"client_id": client_id, "status": "active"}, {"_id": 0, "end_date": 1}).to_list(10)
    if active_contracts:
        expiring_soon = sum(1 for c in active_contracts if c.get("end_date") and c["end_date"] < (now + timedelta(days=30)).isoformat())
        scores["contracts"] = 10 if not expiring_soon else 5
    else:
        scores["contracts"] = 5
    
    total_score = sum(scores.values())
    risk = "healthy" if total_score >= 75 else "attention" if total_score >= 50 else "at_risk" if total_score >= 25 else "critical"
    
    return {
        "client_id": client_id,
        "client_name": client.get("name"),
        "health_score": total_score,
        "risk_level": risk,
        "breakdown": scores,
        "open_tickets": open_tickets,
        "total_devices": len(devices) if 'devices' in dir() else await db.devices.count_documents({"client_id": client_id}),
        "overdue_invoices": overdue if 'overdue' in dir() else 0,
        "mrr": client.get("mrr", 0),
    }

# ============== NOTIFICATIONS ==============

@router.get("/notifications")
async def get_notifications(current_user: dict = Depends(get_current_user)):
    """Get all notifications for current user"""
    notifs = await db.notifications.find({"user_id": {"$in": [current_user["id"], "all"]}}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return notifs

@router.get("/notifications/unread-count")
async def get_unread_count(current_user: dict = Depends(get_current_user)):
    count = await db.notifications.count_documents({"user_id": {"$in": [current_user["id"], "all"]}, "read": False})
    return {"count": count}

@router.post("/notifications/mark-read")
async def mark_notifications_read(data: dict, current_user: dict = Depends(get_current_user)):
    ids = data.get("ids", [])
    if ids:
        await db.notifications.update_many({"id": {"$in": ids}}, {"$set": {"read": True}})
    else:
        await db.notifications.update_many({"user_id": {"$in": [current_user["id"], "all"]}}, {"$set": {"read": True}})
    return {"message": "Notifications marked as read"}

@router.post("/notifications/delete")
async def delete_notifications(data: dict, current_user: dict = Depends(get_current_user)):
    ids = data.get("ids", [])
    if ids:
        await db.notifications.delete_many({"id": {"$in": ids}})
    return {"message": f"Deleted {len(ids)} notifications"}

@router.post("/notifications/generate")
async def generate_notifications(current_user: dict = Depends(get_current_user)):
    """Generate notifications based on current system state"""
    now = datetime.now(timezone.utc)
    notifs_created = 0
    
    # SLA Breach notifications
    breaching = await db.tickets.find({"status": {"$in": ["open", "in_progress"]}, "sla_due": {"$exists": True, "$ne": None}}, {"_id": 0}).to_list(100)
    for t in breaching:
        sla_due = t.get("sla_due", "")
        if sla_due and sla_due < now.isoformat():
            exists = await db.notifications.find_one({"ref_id": t["id"], "type": "sla_breach"})
            if not exists:
                await db.notifications.insert_one({"id": str(uuid.uuid4()), "user_id": t.get("assigned_to", "all"), "type": "sla_breach", "title": f"SLA Breached: {t.get('title','')}", "message": f"Ticket {t.get('ticket_number','')} has breached its SLA", "ref_id": t["id"], "ref_type": "ticket", "severity": "critical", "read": False, "created_at": now.isoformat()})
                notifs_created += 1
    
    # SLA Warning (within 2 hours of breach)
    for t in breaching:
        sla_due = t.get("sla_due", "")
        if sla_due and sla_due > now.isoformat() and sla_due < (now + timedelta(hours=2)).isoformat():
            exists = await db.notifications.find_one({"ref_id": t["id"], "type": "sla_warning"})
            if not exists:
                await db.notifications.insert_one({"id": str(uuid.uuid4()), "user_id": t.get("assigned_to", "all"), "type": "sla_warning", "title": f"SLA Warning: {t.get('title','')}", "message": f"Ticket {t.get('ticket_number','')} SLA due soon", "ref_id": t["id"], "ref_type": "ticket", "severity": "warning", "read": False, "created_at": now.isoformat()})
                notifs_created += 1
    
    # Contract renewal reminders (30 days)
    expiring = await db.contracts.find({"status": "active", "end_date": {"$lte": (now + timedelta(days=30)).isoformat(), "$gte": now.isoformat()}}, {"_id": 0}).to_list(50)
    for c in expiring:
        exists = await db.notifications.find_one({"ref_id": c["id"], "type": "contract_renewal"})
        if not exists:
            await db.notifications.insert_one({"id": str(uuid.uuid4()), "user_id": "all", "type": "contract_renewal", "title": f"Contract Expiring: {c.get('name','')}", "message": f"Contract for {c.get('client_name','')} expires on {c.get('end_date','')}", "ref_id": c["id"], "ref_type": "contract", "severity": "warning", "read": False, "created_at": now.isoformat()})
            notifs_created += 1
    
    # Offline device alerts
    offline = await db.devices.find({"status": "offline"}, {"_id": 0}).to_list(100)
    for d in offline:
        exists = await db.notifications.find_one({"ref_id": d["id"], "type": "device_offline", "read": False})
        if not exists:
            await db.notifications.insert_one({"id": str(uuid.uuid4()), "user_id": "all", "type": "device_offline", "title": f"Device Offline: {d.get('name','')}", "message": f"{d.get('name','')} ({d.get('client_name','')}) is offline", "ref_id": d["id"], "ref_type": "device", "severity": "warning", "read": False, "created_at": now.isoformat()})
            notifs_created += 1
    
    # Recently assigned tickets (last hour)
    recent = await db.tickets.find({"assigned_at": {"$gte": (now - timedelta(hours=1)).isoformat()}, "assigned_to": {"$exists": True, "$ne": ""}}, {"_id": 0}).to_list(50)
    for t in recent:
        exists = await db.notifications.find_one({"ref_id": t["id"], "type": "ticket_assigned"})
        if not exists:
            await db.notifications.insert_one({"id": str(uuid.uuid4()), "user_id": t["assigned_to"], "type": "ticket_assigned", "title": f"Ticket Assigned: {t.get('title','')}", "message": f"You were assigned {t.get('ticket_number', '')} - {t.get('title','')}", "ref_id": t["id"], "ref_type": "ticket", "severity": "info", "read": False, "created_at": now.isoformat()})
            notifs_created += 1
    
    # New email leads (last hour)
    recent_leads = await db.leads.find({"source": "email", "created_at": {"$gte": (now - timedelta(hours=1)).isoformat()}}, {"_id": 0}).to_list(20)
    for l in recent_leads:
        exists = await db.notifications.find_one({"ref_id": l["id"], "type": "new_lead"})
        if not exists:
            await db.notifications.insert_one({"id": str(uuid.uuid4()), "user_id": "all", "type": "new_lead", "title": f"New Lead: {l.get('company_name','')}", "message": f"New lead from {l.get('email','')} - {l.get('company_name','')}", "ref_id": l["id"], "ref_type": "lead", "severity": "info", "read": False, "created_at": now.isoformat()})
            notifs_created += 1
    
    return {"message": f"Generated {notifs_created} notifications", "count": notifs_created}

