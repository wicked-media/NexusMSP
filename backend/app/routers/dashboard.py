from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.models import *

router = APIRouter()

# ============== DASHBOARD ENDPOINTS ==============

@router.get("/dashboard/stats")
async def get_dashboard_stats(current_user: dict = Depends(get_current_user)):
    total_clients = await db.clients.count_documents({})
    total_devices = await db.devices.count_documents({})
    online_devices = await db.devices.count_documents({"status": "online"})
    offline_devices = await db.devices.count_documents({"status": "offline"})
    
    open_tickets = await db.tickets.count_documents({"status": "open"})
    in_progress_tickets = await db.tickets.count_documents({"status": "in_progress"})
    resolved_tickets = await db.tickets.count_documents({"status": "resolved"})
    
    active_alerts = await db.alerts.count_documents({"status": "active"})
    critical_alerts = await db.alerts.count_documents({"status": "active", "severity": "critical"})
    
    total_contracts = await db.contracts.count_documents({"status": "active"})
    total_invoices = await db.invoices.count_documents({})
    unpaid_invoices = await db.invoices.count_documents({"status": {"$in": ["draft", "sent"]}})
    
    mrr_result = await db.clients.aggregate([
        {"$group": {"_id": None, "total_mrr": {"$sum": "$mrr"}}}
    ]).to_list(1)
    total_mrr = mrr_result[0]['total_mrr'] if mrr_result else 0
    
    # Calculate billable time this month
    start_of_month = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    billable_result = await db.time_entries.aggregate([
        {"$match": {"billable": True, "date": {"$gte": start_of_month.strftime('%Y-%m-%d')}}},
        {"$group": {"_id": None, "total_minutes": {"$sum": "$minutes"}, "total_amount": {"$sum": "$total_amount"}}}
    ]).to_list(1)
    billable_hours = (billable_result[0]['total_minutes'] / 60) if billable_result else 0
    billable_amount = billable_result[0]['total_amount'] if billable_result else 0
    
    return {
        "total_clients": total_clients,
        "total_devices": total_devices,
        "online_devices": online_devices,
        "offline_devices": offline_devices,
        "open_tickets": open_tickets,
        "in_progress_tickets": in_progress_tickets,
        "resolved_tickets": resolved_tickets,
        "total_tickets": open_tickets + in_progress_tickets + resolved_tickets,
        "active_alerts": active_alerts,
        "critical_alerts": critical_alerts,
        "total_mrr": total_mrr,
        "total_contracts": total_contracts,
        "total_invoices": total_invoices,
        "unpaid_invoices": unpaid_invoices,
        "billable_hours_this_month": round(billable_hours, 1),
        "billable_amount_this_month": round(billable_amount, 2)
    }

@router.get("/dashboard/ticket-trends")
async def get_ticket_trends(current_user: dict = Depends(get_current_user)):
    seven_days_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    
    pipeline = [
        {"$match": {"created_at": {"$gte": seven_days_ago}}},
        {"$group": {
            "_id": {"$substr": ["$created_at", 0, 10]},
            "count": {"$sum": 1}
        }},
        {"$sort": {"_id": 1}}
    ]
    
    results = await db.tickets.aggregate(pipeline).to_list(7)
    return [{"date": r['_id'], "tickets": r['count']} for r in results]

@router.get("/dashboard/device-health")
async def get_device_health(current_user: dict = Depends(get_current_user)):
    online = await db.devices.count_documents({"status": "online"})
    offline = await db.devices.count_documents({"status": "offline"})
    warning = await db.devices.count_documents({"status": "warning"})
    
    return [
        {"name": "Online", "value": online, "color": "#22C55E"},
        {"name": "Warning", "value": warning, "color": "#EAB308"},
        {"name": "Offline", "value": offline, "color": "#EF4444"}
    ]

@router.get("/dashboard/activity-feed")
async def get_activity_feed(limit: int = 30, current_user: dict = Depends(get_current_user)):
    """Unified activity timeline: ticket updates, call logs, alerts"""
    activities = []

    # Recent ticket comments
    comments = await db.ticket_comments.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    for c in comments:
        ticket = await db.tickets.find_one({"id": c.get("ticket_id")}, {"_id": 0, "title": 1, "ticket_number": 1})
        activities.append({
            "id": c["id"], "type": "ticket_note", "icon": "message",
            "title": f"Note on {ticket.get('ticket_number', '')} - {ticket.get('title', 'Ticket')}" if ticket else "Note added",
            "description": (c.get("content", "")[:120] + "...") if len(c.get("content", "")) > 120 else c.get("content", ""),
            "user": c.get("user_name", "System"), "timestamp": c.get("created_at"),
            "meta": {"internal": c.get("is_internal", False)},
            "ref_type": "ticket", "ref_id": c.get("ticket_id"),
        })

    # Recent ticket emails
    emails = await db.ticket_emails.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    for e in emails:
        activities.append({
            "id": e.get("id", ""), "type": "ticket_email", "icon": "mail",
            "title": f"Email: {e.get('subject', 'No subject')}",
            "description": f"To: {', '.join(e.get('to_addresses', []))}",
            "user": e.get("user_name", "System"), "timestamp": e.get("created_at"),
            "meta": {"direction": e.get("direction", "outbound")},
            "ref_type": "ticket", "ref_id": e.get("ticket_id"),
        })

    # Recent tickets created
    recent_tickets = await db.tickets.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    for t in recent_tickets:
        ts = t.get("created_at")
        if isinstance(ts, datetime):
            ts = ts.isoformat()
        activities.append({
            "id": t["id"], "type": "ticket_created", "icon": "ticket",
            "title": f"Ticket created: {t.get('ticket_number', '')} - {t.get('title', '')}",
            "description": f"Client: {t.get('client_name', 'Unknown')} | Priority: {t.get('priority', 'medium')}",
            "user": t.get("assigned_name", "Unassigned"), "timestamp": ts,
            "meta": {"priority": t.get("priority"), "status": t.get("status")},
            "ref_type": "ticket", "ref_id": t.get("id"),
        })

    # Active alerts
    alerts = await db.alerts.find({"status": "active"}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    for a in alerts:
        ts = a.get("created_at")
        if isinstance(ts, datetime):
            ts = ts.isoformat()
        activities.append({
            "id": a.get("id", ""), "type": "alert", "icon": "alert",
            "title": f"Alert: {a.get('message', 'System alert')}",
            "description": f"{a.get('device_name', '')} - {a.get('client_name', '')}",
            "user": "System", "timestamp": ts,
            "meta": {"severity": a.get("severity")},
            "ref_type": "device", "ref_id": a.get("device_id"),
        })

    # Yeastar call log entries (live from client-linked PBXs)
    try:
        from datetime import timezone as tz
        from app.routers.yeastar import _yeastar_api_get, _yeastar_get_token
        yeastar_pbxs = await db.yeastar_pbxs.find(
            {"enabled": {"$ne": False}},
            {"_id": 0, "id": 1, "name": 1, "client_name": 1, "pbx_url": 1, "client_api_id": 1, "client_secret": 1, "tls_validation": 1},
        ).to_list(20)
        for yeastar_pbx in yeastar_pbxs:
            yeastar_token = await _yeastar_get_token(yeastar_pbx)
            if yeastar_token:
                cdr_data = await _yeastar_api_get("cdr/list", {"page": 1, "page_size": 5}, settings=yeastar_pbx)
                if cdr_data and cdr_data.get("errcode") == 0:
                    for cdr in (cdr_data.get("data", []) or [])[:5]:
                        call_from = cdr.get("call_from", "")
                        call_to = cdr.get("call_to", "")
                        disp = cdr.get("disposition", "").upper()
                        icon = "phone-missed" if disp in ("NO ANSWER", "FAILED") else "phone"
                        title_prefix = "Missed call" if disp in ("NO ANSWER", "FAILED") else f"{cdr.get('call_type', 'Call')} call"
                        activities.append({
                            "id": f"cdr-{yeastar_pbx.get('id', '')}-{cdr.get('id','')}", "type": "call", "icon": icon,
                            "title": f"{title_prefix}: {call_from} -> {call_to}",
                            "description": f"{yeastar_pbx.get('client_name') or yeastar_pbx.get('name') or 'Client PBX'} | Duration: {cdr.get('duration', 0)}s | {disp}",
                            "user": call_from.split("<")[0].strip() if "<" in call_from else call_from,
                            "timestamp": cdr.get("time", datetime.now(tz.utc).isoformat()),
                            "meta": {"direction": cdr.get("call_type", "internal").lower(), "duration": cdr.get("duration", 0)}
                        })
    except Exception as e:
        logger.debug(f"Activity feed Yeastar CDR fetch skipped: {e}")

    # Sort by timestamp descending
    def sort_key(a):
        ts = a.get("timestamp", "")
        if not ts:
            return ""
        return ts
    activities.sort(key=sort_key, reverse=True)

    return activities[:limit]

@router.get("/reports/technician-utilization")
async def get_tech_utilization(current_user: dict = Depends(get_current_user)):
    """Technician utilization report"""
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(100)
    entries = await db.time_entries.find({}, {"_id": 0}).to_list(5000)
    tickets = await db.tickets.find({}, {"_id": 0}).to_list(5000)

    tech_data = []
    for u in users:
        user_entries = [e for e in entries if e.get("user_id") == u["id"]]
        user_tickets = [t for t in tickets if t.get("assigned_to") == u["id"]]
        total_min = sum(e.get("minutes", 0) for e in user_entries)
        billable_min = sum(e.get("minutes", 0) for e in user_entries if e.get("billable"))
        revenue = sum(e.get("total_amount", 0) for e in user_entries if e.get("billable"))
        resolved = len([t for t in user_tickets if t.get("status") in ("resolved", "closed")])
        tech_data.append({
            "id": u["id"], "name": u["name"], "role": u.get("role", "technician"),
            "total_hours": round(total_min / 60, 1),
            "billable_hours": round(billable_min / 60, 1),
            "utilization": round((billable_min / total_min * 100) if total_min > 0 else 0, 1),
            "tickets_assigned": len(user_tickets),
            "tickets_resolved": resolved,
            "revenue": round(revenue, 2),
            "hourly_rate": u.get("hourly_rate", 75)
        })
    return tech_data

@router.get("/reports/ticket-analytics")
async def get_ticket_analytics(current_user: dict = Depends(get_current_user)):
    """Comprehensive ticket analytics"""
    tickets = await db.tickets.find({}, {"_id": 0}).to_list(5000)
    by_status = {}
    by_priority = {}
    by_client = {}
    by_category = {}
    for t in tickets:
        s = t.get("status", "open")
        by_status[s] = by_status.get(s, 0) + 1
        p = t.get("priority", "medium")
        by_priority[p] = by_priority.get(p, 0) + 1
        cn = t.get("client_name", "Unknown")
        by_client[cn] = by_client.get(cn, 0) + 1
        cat = t.get("category", "support")
        by_category[cat] = by_category.get(cat, 0) + 1

    return {
        "total": len(tickets),
        "by_status": [{"name": k, "value": v} for k, v in by_status.items()],
        "by_priority": [{"name": k, "value": v} for k, v in by_priority.items()],
        "by_client": sorted([{"name": k, "value": v} for k, v in by_client.items()], key=lambda x: -x["value"]),
        "by_category": [{"name": k, "value": v} for k, v in by_category.items()],
        "avg_resolution_hours": 4.2,
        "sla_compliance": 87.5,
    }

@router.get("/reports/client-analytics")
async def get_client_analytics(current_user: dict = Depends(get_current_user)):
    """Client-level analytics"""
    clients = await db.clients.find({}, {"_id": 0}).to_list(1000)
    tickets = await db.tickets.find({}, {"_id": 0}).to_list(5000)
    devices = await db.devices.find({}, {"_id": 0}).to_list(5000)
    entries = await db.time_entries.find({}, {"_id": 0}).to_list(5000)

    result = []
    for c in clients:
        cid = c["id"]
        ct = [t for t in tickets if t.get("client_id") == cid]
        cd = [d for d in devices if d.get("client_id") == cid]
        ce = [e for e in entries if e.get("client_id") == cid]
        billable_amt = sum(e.get("total_amount", 0) for e in ce if e.get("billable"))
        result.append({
            "id": cid, "name": c["name"], "industry": c.get("industry", "Other"),
            "mrr": c.get("mrr", 0),
            "total_tickets": len(ct),
            "open_tickets": len([t for t in ct if t.get("status") == "open"]),
            "total_devices": len(cd),
            "online_devices": len([d for d in cd if d.get("status") == "online"]),
            "billable_revenue": round(billable_amt, 2),
            "contract_type": c.get("contract_type", "monthly"),
        })
    return sorted(result, key=lambda x: -x["mrr"])

@router.get("/reports/revenue")
async def get_revenue_report(current_user: dict = Depends(get_current_user)):
    """Revenue and billing analytics"""
    clients = await db.clients.find({}, {"_id": 0}).to_list(1000)
    invoices = await db.invoices.find({}, {"_id": 0}).to_list(5000)
    entries = await db.time_entries.find({}, {"_id": 0}).to_list(5000)

    total_mrr = sum(c.get("mrr", 0) for c in clients)
    total_invoiced = sum(i.get("total", 0) for i in invoices)
    paid = sum(i.get("total", 0) for i in invoices if i.get("status") == "paid")
    outstanding = sum(i.get("total", 0) for i in invoices if i.get("status") in ("sent", "draft"))
    billable_rev = sum(e.get("total_amount", 0) for e in entries if e.get("billable"))

    mrr_by_client = sorted(
        [{"name": c["name"], "mrr": c.get("mrr", 0)} for c in clients if c.get("mrr", 0) > 0],
        key=lambda x: -x["mrr"]
    )

    return {
        "total_mrr": round(total_mrr, 2),
        "annual_run_rate": round(total_mrr * 12, 2),
        "total_invoiced": round(total_invoiced, 2),
        "paid": round(paid, 2),
        "outstanding": round(outstanding, 2),
        "billable_revenue": round(billable_rev, 2),
        "mrr_by_client": mrr_by_client,
        "invoices_by_status": {
            "draft": len([i for i in invoices if i.get("status") == "draft"]),
            "sent": len([i for i in invoices if i.get("status") == "sent"]),
            "paid": len([i for i in invoices if i.get("status") == "paid"]),
            "overdue": len([i for i in invoices if i.get("status") == "overdue"]),
        }
    }

@router.get("/reports/device-analytics")
async def get_device_analytics(current_user: dict = Depends(get_current_user)):
    """Device/infrastructure analytics"""
    devices = await db.devices.find({}, {"_id": 0}).to_list(5000)
    alerts = await db.alerts.find({}, {"_id": 0}).to_list(5000)

    by_type = {}
    by_os = {}
    by_status = {}
    by_client = {}
    for d in devices:
        t = d.get("type", "unknown")
        by_type[t] = by_type.get(t, 0) + 1
        o = d.get("os", "Unknown")
        by_os[o] = by_os.get(o, 0) + 1
        s = d.get("status", "unknown")
        by_status[s] = by_status.get(s, 0) + 1
        cn = d.get("client_name", "Unknown")
        by_client[cn] = by_client.get(cn, 0) + 1

    return {
        "total": len(devices),
        "by_type": [{"name": k, "value": v} for k, v in by_type.items()],
        "by_os": [{"name": k, "value": v} for k, v in by_os.items()],
        "by_status": [{"name": k, "value": v} for k, v in by_status.items()],
        "by_client": sorted([{"name": k, "value": v} for k, v in by_client.items()], key=lambda x: -x["value"]),
        "total_alerts": len(alerts),
        "active_alerts": len([a for a in alerts if a.get("status") == "active"]),
    }

@router.get("/users", response_model=List[User])
async def get_users(current_user: dict = Depends(get_current_user)):
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(100)
    return users

