"""
Client War Room — live operational dashboard for a single client.
Aggregates real-time device telemetry, open tickets, on-call techs, and
generates an AI commentary feed for outage moments / client calls.
"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone, timedelta
import os
import logging
from app.database import db
from app.auth import get_current_user

router = APIRouter()
logger = logging.getLogger("client_war_room")


def _iso(dt):
    if not dt:
        return None
    if isinstance(dt, str):
        return dt
    if isinstance(dt, datetime):
        return dt.isoformat()
    return str(dt)


@router.get("/clients/{client_id}/war-room")
async def war_room(client_id: str, current_user: dict = Depends(get_current_user)):
    """Aggregate live state for a single client — devices, tickets, on-call, activity."""
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    # Devices
    devices = await db.devices.find(
        {"client_id": client_id},
        {"_id": 0, "id": 1, "hostname": 1, "name": 1, "status": 1, "last_seen": 1,
         "cpu_load": 1, "memory_pct": 1, "disk_pct": 1, "issues": 1, "os": 1, "alerts": 1},
    ).to_list(500)
    online = sum(1 for d in devices if d.get("status") == "online")
    offline = sum(1 for d in devices if d.get("status") == "offline")
    warning = sum(1 for d in devices
                  if (d.get("cpu_load") or 0) > 85
                  or (d.get("memory_pct") or 0) > 85
                  or (d.get("disk_pct") or 0) > 90)

    # Open tickets — newest first, last 50
    open_tickets = await db.tickets.find(
        {"client_id": client_id, "status": {"$in": ["open", "in_progress", "pending"]}},
        {"_id": 0, "id": 1, "number": 1, "title": 1, "status": 1, "priority": 1,
         "assigned_to_name": 1, "created_at": 1, "updated_at": 1, "sla_due_at": 1},
    ).sort("created_at", -1).to_list(50)

    now = datetime.now(timezone.utc)
    breached = 0
    for t in open_tickets:
        sla = t.get("sla_due_at")
        if sla:
            try:
                sla_dt = datetime.fromisoformat(sla.replace("Z", "+00:00")) if isinstance(sla, str) else sla
                if sla_dt and sla_dt < now:
                    breached += 1
            except Exception:
                pass

    critical = sum(1 for t in open_tickets if t.get("priority") in ("critical", "urgent", "p1"))

    # On-call / active technicians (presence)
    oncall = await db.technicians.find(
        {"$or": [{"on_call_status": True}, {"is_active": True}]},
        {"_id": 0, "id": 1, "name": 1, "avatar": 1, "specialties": 1, "on_call_status": 1, "last_active_at": 1},
    ).to_list(20)

    # Recent activity feed — last 24h
    since = now - timedelta(hours=24)
    activity = []
    try:
        recent_tx = await db.tickets.find(
            {"client_id": client_id, "updated_at": {"$gte": since.isoformat()}},
            {"_id": 0, "id": 1, "title": 1, "status": 1, "priority": 1, "updated_at": 1, "assigned_to_name": 1},
        ).sort("updated_at", -1).to_list(30)
        for t in recent_tx:
            activity.append({
                "type": "ticket_update",
                "title": f"#{t.get('number', t.get('id', '')[:6])} · {t.get('title', '')}",
                "subtitle": f"{t.get('status', '').replace('_', ' ')} · {t.get('priority', 'med')}",
                "timestamp": _iso(t.get("updated_at")),
            })
    except Exception as e:
        logger.warning(f"war_room ticket activity error: {e}")

    # Severity computation — drives the war-room banner colour
    if offline > 2 or breached > 0 or critical > 0:
        severity = "critical"
    elif offline > 0 or warning > 2:
        severity = "warning"
    elif online == 0:
        severity = "warning"
    else:
        severity = "ok"

    # MTTR / live SLA snapshot (last 7 days)
    week_ago = now - timedelta(days=7)
    closed_recent = await db.tickets.find(
        {"client_id": client_id, "status": "closed",
         "closed_at": {"$gte": week_ago.isoformat()}},
        {"_id": 0, "created_at": 1, "closed_at": 1},
    ).to_list(200)
    mttr_minutes = None
    if closed_recent:
        deltas = []
        for t in closed_recent:
            try:
                ca = t.get("created_at")
                cl = t.get("closed_at")
                if ca and cl:
                    a = datetime.fromisoformat(ca.replace("Z", "+00:00")) if isinstance(ca, str) else ca
                    b = datetime.fromisoformat(cl.replace("Z", "+00:00")) if isinstance(cl, str) else cl
                    deltas.append((b - a).total_seconds() / 60)
            except Exception:
                pass
        if deltas:
            mttr_minutes = round(sum(deltas) / len(deltas))

    return {
        "client": {"id": client_id, "name": client.get("name", "")},
        "severity": severity,
        "computed_at": now.isoformat(),
        "metrics": {
            "devices_total": len(devices),
            "devices_online": online,
            "devices_offline": offline,
            "devices_warning": warning,
            "open_tickets": len(open_tickets),
            "tickets_critical": critical,
            "tickets_breached": breached,
            "mttr_7d_minutes": mttr_minutes,
            "techs_oncall": sum(1 for t in oncall if t.get("on_call_status")),
            "techs_active": len(oncall),
        },
        "devices": devices[:60],
        "open_tickets": open_tickets[:25],
        "oncall": oncall[:10],
        "activity": activity[:30],
    }


@router.get("/clients/{client_id}/war-room/commentary")
async def war_room_commentary(client_id: str, current_user: dict = Depends(get_current_user)):
    """One-shot AI commentary on the client's current operational state."""
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    # Snapshot — same logic but compressed
    devices = await db.devices.find(
        {"client_id": client_id},
        {"_id": 0, "hostname": 1, "name": 1, "status": 1, "cpu_load": 1, "memory_pct": 1, "disk_pct": 1},
    ).to_list(200)
    online = sum(1 for d in devices if d.get("status") == "online")
    offline = sum(1 for d in devices if d.get("status") == "offline")
    offline_names = [d.get("hostname") or d.get("name") for d in devices if d.get("status") == "offline"][:8]

    open_tickets = await db.tickets.find(
        {"client_id": client_id, "status": {"$in": ["open", "in_progress", "pending"]}},
        {"_id": 0, "title": 1, "priority": 1, "assigned_to_name": 1, "sla_due_at": 1},
    ).sort("created_at", -1).to_list(15)
    critical = [t for t in open_tickets if t.get("priority") in ("critical", "urgent", "p1")]

    summary_lines = [
        f"Client: {client.get('name', '')}",
        f"Devices: {online}/{len(devices)} online ({offline} offline{(' — ' + ', '.join(offline_names)) if offline_names else ''})",
        f"Open tickets: {len(open_tickets)} ({len(critical)} critical)",
    ]
    if critical:
        summary_lines.append("Critical tickets:")
        for t in critical[:5]:
            summary_lines.append(f"  - {t.get('title', '')} (assigned: {t.get('assigned_to_name', 'Unassigned')})")

    snapshot = "\n".join(summary_lines)

    # Heuristic fallback commentary (used if no LLM key)
    fallback_parts = []
    if offline >= 3:
        fallback_parts.append(f"⚠️ {offline} devices offline at {client.get('name')}. Possible site outage — check ISP/UPS/UniFi controller before triaging.")
    elif offline > 0:
        fallback_parts.append(f"{offline} device(s) offline at {client.get('name')}: {', '.join(offline_names)}.")
    if critical:
        fallback_parts.append(f"{len(critical)} critical ticket{'s' if len(critical) != 1 else ''} require immediate attention.")
    if not fallback_parts:
        fallback_parts.append(f"All systems nominal. {online}/{len(devices)} devices online, {len(open_tickets)} open tickets.")
    fallback = " ".join(fallback_parts)

    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        return {"commentary": fallback, "source": "heuristic"}

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(
            api_key=api_key,
            session_id=f"war-room-{client_id}",
            system_message=(
                "You are an MSP NOC commentator briefing a senior technician on a live client situation. "
                "Be terse, tactical, 60-90 words MAX. No fluff, no greetings. "
                "Lead with the biggest risk, then root-cause hypothesis, then a recommended next action. "
                "Use plain text, no markdown headers."
            ),
        )
        chat.with_model("anthropic", "claude-sonnet-4-5-20250929")
        resp = await chat.send_message(UserMessage(text=f"Live snapshot:\n{snapshot}\n\nGive me the situation report."))
        commentary = resp.strip() if isinstance(resp, str) else str(resp)
        return {"commentary": commentary, "source": "ai"}
    except Exception as e:
        logger.warning(f"war_room AI commentary failed: {e}")
        return {"commentary": fallback, "source": "heuristic_fallback"}
