"""Device Smart Engine â€” AI Diagnose, Live Metrics Drawer, Screenshot to Ticket,
Health Score, and Fleet-wide AI insights.
"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone, timedelta
import os
import uuid
import json
import logging
import asyncio

from app.database import db
from app.auth import get_current_user
from app.services.activity import log_activity
from app.services.scope_permissions import assert_record_scope, scoped_query

logger = logging.getLogger(__name__)
router = APIRouter()


from app.services.time_utils import now_iso as _now_iso


from app.services.time_utils import parse_date_compact as _parse_date


async def _ai_chat(session_id: str, system_msg: str):
    from app.services.ai_provider import LlmChat
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(500, "AI key not configured")
    cfg = await db.settings.find_one({"type": "ai_config"}, {"_id": 0}) or {}
    chat = LlmChat(api_key=api_key, session_id=session_id, system_message=system_msg)
    chat.with_model("openai", cfg.get("model", "gpt-5.6-terra"))
    return chat


def _require_matching_device_ticket_client(device: dict, ticket: dict) -> None:
    """Prevent a scoped-but-cross-client ticket action from crossing client evidence.

    Both records must already have been loaded through ``assert_record_scope``.
    A missing client binding is not enough evidence to join a device to a ticket,
    even for a globally scoped administrator.
    """
    device_client_id = str(device.get("client_id") or "").strip()
    ticket_client_id = str(ticket.get("client_id") or "").strip()
    if not device_client_id or device_client_id != ticket_client_id:
        raise HTTPException(
            status_code=409,
            detail="The device and ticket must belong to the same client",
        )


# â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
# â•‘   1) AI DIAGNOSE â€” analyze telemetry + recent events + services   â•‘
# â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.post("/devices/{device_id}/ai-diagnose")
async def ai_diagnose(device_id: str, data: dict | None = None, current_user: dict = Depends(get_current_user)):
    """Pull device telemetry + recent agent events + services and ask Nexus AI to write a
    succinct diagnostic. Optionally posts the result as a comment to the provided ticket_id."""
    device = await assert_record_scope(
        current_user,
        db.devices,
        device_id,
        operation="device.ai_diagnose",
        resource_name="Device",
    )

    payload = data or {}
    ticket_id = payload.get("ticket_id")
    ticket = None
    if ticket_id:
        ticket = await assert_record_scope(
            current_user,
            db.tickets,
            ticket_id,
            operation="device.ai_diagnose.ticket_comment",
            resource_name="Ticket",
        )
        _require_matching_device_ticket_client(device, ticket)

    # Gather snapshots (best-effort from existing collections)
    latest_telemetry = await db.device_metrics.find({"device_id": device_id}, {"_id": 0}).sort("ts", -1).limit(30).to_list(30)
    recent_events = await db.device_events.find({"device_id": device_id}, {"_id": 0}).sort("ts", -1).limit(20).to_list(20)
    services = await db.device_services.find({"device_id": device_id}, {"_id": 0}).limit(40).to_list(40)
    pending_patches = await db.device_winupdates.find({"device_id": device_id, "installed": {"$ne": True}}, {"_id": 0}).limit(20).to_list(20)
    evidence_state = "observed" if any((latest_telemetry, recent_events, services, pending_patches)) else "not_collected"

    # Compute quick signals
    cpu_avg = sum((m.get("cpu") or 0) for m in latest_telemetry) / max(1, len(latest_telemetry))
    mem_avg = sum((m.get("memory") or 0) for m in latest_telemetry) / max(1, len(latest_telemetry))
    disk = (latest_telemetry[0].get("disk") if latest_telemetry else None) or device.get("disk_usage", 0)
    sustained_high_cpu = sum(1 for m in latest_telemetry if (m.get("cpu") or 0) > 85) >= max(3, int(len(latest_telemetry) * 0.5))
    sustained_high_mem = sum(1 for m in latest_telemetry if (m.get("memory") or 0) > 85) >= max(3, int(len(latest_telemetry) * 0.5))
    low_disk = (disk or 0) > 90
    stopped_critical = [s.get("name") for s in services if (s.get("status") or "").lower() not in ("running",) and s.get("start_type", "").lower() == "auto"][:5]

    summary = {
        "device_name": device.get("name"),
        "os": device.get("os_name") or device.get("os"),
        "status": device.get("status"),
        "ip_address": device.get("ip_address"),
        "last_seen": device.get("last_seen"),
        "agent_version": device.get("agent_version"),
        "telemetry": {
            "cpu_avg_pct": round(cpu_avg, 1), "memory_avg_pct": round(mem_avg, 1), "disk_pct": disk,
            "sustained_high_cpu": sustained_high_cpu, "sustained_high_mem": sustained_high_mem, "low_disk": low_disk,
        },
        "stopped_auto_services": stopped_critical,
        "pending_patches_count": len(pending_patches),
        "recent_events_count": len(recent_events),
        "recent_event_titles": [e.get("title") or e.get("event_type") for e in recent_events[:8]],
        "evidence_state": evidence_state,
    }

    diagnosis = ""
    actions = []
    if evidence_state == "not_collected":
        severity = "unknown"
        diagnosis = (
            "No diagnostic evidence has been collected for this endpoint. "
            "Collect a fresh Nexus Agent check-in before concluding that it is healthy."
        )
        actions = ["Collect a fresh Nexus Agent check-in"]
    else:
        try:
            from app.services.ai_provider import UserMessage
            sys = (
                "You are a senior MSP technician. Given device telemetry + events + services + patches, "
                "write a CONCISE diagnostic (3-5 bullet points) describing what's wrong (or healthy) and a "
                "remediation list. Output strict JSON: {diagnosis, severity:'low|medium|high|critical', actions:[..]}"
            )
            chat = await _ai_chat(f"diag-{device_id}-{uuid.uuid4().hex[:6]}", sys)
            resp = await chat.send_message(UserMessage(text=json.dumps(summary)))
            text = resp.strip()
            if text.startswith("```"):
                text = text.split("```")[1]
                if text.startswith("json"):
                    text = text[4:]
            parsed = json.loads(text)
            diagnosis = parsed.get("diagnosis", "")
            if isinstance(diagnosis, list):
                diagnosis = "\n".join(f"â€¢ {x}" for x in diagnosis)
            severity = parsed.get("severity", "medium")
            actions = parsed.get("actions", [])[:6]
            if isinstance(actions, str):
                actions = [actions]
        except Exception as e:
            logger.warning(f"AI diagnose failed: {e}")
            # Fallback heuristic is limited to the evidence collected above.
            bullets = []
            if sustained_high_cpu:
                bullets.append("- Sustained high CPU (>85%) for several samples")
            if sustained_high_mem:
                bullets.append("- Sustained high memory pressure")
            if low_disk:
                bullets.append(f"- Low disk free ({disk}%)")
            if stopped_critical:
                bullets.append(f"- Critical auto-start services stopped: {', '.join(stopped_critical[:3])}")
            if len(pending_patches) > 5:
                bullets.append(f"- {len(pending_patches)} pending Windows updates")
            if not bullets:
                bullets.append("- No critical issues were identified in the collected diagnostic evidence.")
            diagnosis = "\n".join(bullets)
            severity = "high" if low_disk or stopped_critical else ("medium" if (sustained_high_cpu or sustained_high_mem) else "low")
            actions = []
            if low_disk:
                actions.append("Run disk cleanup / clear temp")
            if sustained_high_cpu:
                actions.append("Check top processes; consider reboot if process hung")
            if stopped_critical:
                actions.append("Restart stopped auto services")
            if len(pending_patches) > 0:
                actions.append("Install pending patches in next maintenance window")

    result = {
        "device_id": device_id,
        "client_id": device.get("client_id"),
        "device_name": device.get("name"),
        "severity": severity,
        "diagnosis": diagnosis,
        "actions": actions,
        "signals": summary["telemetry"],
        "evidence_state": evidence_state,
        "generated_at": _now_iso(),
        "generated_by": current_user.get("name"),
    }
    await db.device_diagnoses.insert_one({**result, "id": str(uuid.uuid4())})

    # Optional ticket comment
    if ticket_id:
        body = (
            f"ðŸ¤– AI Device Diagnose â€” {device.get('name')}  ({severity.upper()})\n"
            f"{diagnosis}\n\n"
            + ("Recommended actions:\n" + "\n".join(f"â€¢ {a}" for a in actions) if actions else "")
        )
        comment = {
            "id": str(uuid.uuid4()),
            "ticket_id": ticket_id,
            "client_id": device.get("client_id"),
            "author": current_user.get("name", "AI"),
            "author_id": current_user.get("id"),
            "content": body,
            "kind": "ai_diagnose",
            "created_at": _now_iso(),
        }
        await db.ticket_comments.insert_one(comment)
        await db.tickets.update_one(
            {"id": ticket_id, "client_id": device.get("client_id")},
            {"$inc": {"comments_count": 1}, "$set": {"updated_at": _now_iso()}},
        )
        await log_activity(current_user, "ai_diagnose", "device", device_id, device.get("name", ""), f"posted to ticket {ticket.get('ticket_number')}")
        result["posted_to_ticket"] = True

    return result


# â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
# â•‘   2) LIVE METRICS â€” last N minutes time-series for the drawer     â•‘
# â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.get("/devices/{device_id}/live-metrics")
async def live_metrics(device_id: str, minutes: int = 30, current_user: dict = Depends(get_current_user)):
    """Return CPU/RAM/Disk/Net time-series for the last `minutes` minutes for charting."""
    device = await assert_record_scope(
        current_user,
        db.devices,
        device_id,
        operation="device.live_metrics.read",
        resource_name="Device",
    )
    since = datetime.now(timezone.utc) - timedelta(minutes=int(minutes))
    rows = await db.device_metrics.find(
        {"device_id": device_id, "ts": {"$gte": since.isoformat()}},
        {"_id": 0}
    ).sort("ts", 1).to_list(2000)

    return {
        "device_id": device_id,
        "device_name": device.get("name"),
        "online": (device.get("status") == "online"),
        "agent_version": device.get("agent_version"),
        "ip_address": device.get("ip_address"),
        "current": {
            "cpu": device.get("cpu_usage", 0),
            "memory": device.get("memory_usage", 0),
            "disk": device.get("disk_usage", 0),
        },
        "series": rows,
        "observation_state": "observed" if rows else "not_collected",
        "minutes": minutes,
    }


# â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
# â•‘   3) SCREENSHOT TO TICKET â€” capture user screen, attach to ticketâ•‘
# â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.post("/devices/{device_id}/screenshot-to-ticket")
async def screenshot_to_ticket(device_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Request a supported remote-agent screenshot and record it against a matching ticket."""
    device = await assert_record_scope(
        current_user,
        db.devices,
        device_id,
        operation="device.screenshot.request",
        resource_name="Device",
    )
    # A screen capture is an endpoint command with sensitive user data in its
    # output. Keep it behind the same command capability as the governed Nexus
    # Agent and ticket-device action paths rather than treating a ticket link
    # as sufficient authority.
    from app.routers.nexus_agent import _can_execute_agent_commands
    if not _can_execute_agent_commands(current_user):
        raise HTTPException(403, "Agent command permission required")
    ticket_id = data.get("ticket_id")
    if not ticket_id:
        raise HTTPException(400, "ticket_id required")
    ticket = await assert_record_scope(
        current_user,
        db.tickets,
        ticket_id,
        operation="device.screenshot.ticket_comment",
        resource_name="Ticket",
    )
    _require_matching_device_ticket_client(device, ticket)

    # Only tell the technician a capture was queued after the remote provider
    # accepted it. A missing integration is an unavailable capability, not a
    # pending endpoint action.
    image_url = None
    trmm_config = await db.settings.find_one({"key": "trmm_config"}, {"_id": 0, "value": 1}) or {}
    trmm_value = trmm_config.get("value") or {}
    if not isinstance(trmm_value, dict):
        trmm_value = {}
    trmm_url = trmm_value.get("url") or os.environ.get("TRMM_URL")
    trmm_key = trmm_value.get("api_key") or os.environ.get("TRMM_API_KEY")
    if not trmm_url or not trmm_key or not device.get("trmm_agent_id"):
        raise HTTPException(
            status_code=409,
            detail="Screenshot capture is unavailable for this endpoint. Connect a supported remote agent before requesting a capture.",
        )

    request_accepted = False
    try:
        import httpx
        async with httpx.AsyncClient(timeout=10) as cli:
            r = await cli.post(
                f"{trmm_url.rstrip('/')}/agents/{device['trmm_agent_id']}/screenshot/",
                headers={"Authorization": f"Token {trmm_key}"},
            )
            if r.status_code in (200, 202):
                request_accepted = True
                body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
                image_url = body.get("url") or body.get("screenshot_url")
    except Exception as e:
        logger.warning(f"TRMM screenshot failed: {e}")

    if not request_accepted:
        raise HTTPException(
            status_code=503,
            detail="Screenshot capture could not be queued. No ticket comment was created.",
        )

    # Persist a marker comment + (if we have data) attachment record
    comment_text = f"ðŸ“¸ Screenshot requested on {device.get('name')} â€” " + ("captured." if image_url else "queued by the remote agent.")
    comment = {
        "id": str(uuid.uuid4()),
        "ticket_id": ticket_id,
        "client_id": device.get("client_id"),
        "author": current_user.get("name"),
        "author_id": current_user.get("id"),
        "content": comment_text,
        "image_url": image_url,
        "kind": "screenshot_request",
        "device_id": device_id,
        "created_at": _now_iso(),
    }
    await db.ticket_comments.insert_one(comment)
    await db.tickets.update_one(
        {"id": ticket_id, "client_id": device.get("client_id")},
        {"$inc": {"comments_count": 1}, "$set": {"updated_at": _now_iso()}},
    )
    await log_activity(current_user, "screenshot_request", "device", device_id, device.get("name", ""), f"ticket {ticket.get('ticket_number')}")
    comment.pop("_id", None)
    return {
        "success": True,
        "status": "captured" if image_url else "queued",
        "image_url": image_url,
        "comment_id": comment["id"],
        "pending": image_url is None,
    }


# â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
# â•‘   4) FLEET HEALTH SCORE                                           â•‘
# â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.get("/devices/fleet-health")
async def fleet_health(current_user: dict = Depends(get_current_user)):
    devices = await db.devices.find(scoped_query(current_user), {"_id": 0}).to_list(5000)
    total = len(devices)
    online = sum(1 for d in devices if d.get("status") == "online")
    offline = sum(1 for d in devices if d.get("status") == "offline")
    warning = sum(1 for d in devices if d.get("status") == "warning")
    no_agent = sum(1 for d in devices if not d.get("has_agent") and not d.get("trmm_agent_id"))
    stale = 0
    now = datetime.now(timezone.utc)
    for d in devices:
        ls = _parse_date(d.get("last_seen", ""))
        if ls and (now - ls).days > 7:
            stale += 1
    high_cpu = sum(1 for d in devices if (d.get("cpu_usage") or 0) > 85)
    high_mem = sum(1 for d in devices if (d.get("memory_usage") or 0) > 85)
    low_disk = sum(1 for d in devices if (d.get("disk_usage") or 0) > 90)

    # Health score = 100 - weighted penalties
    score = 100
    if total:
        score -= (offline / total) * 30
        score -= (warning / total) * 15
        score -= (no_agent / total) * 12
        score -= (stale / total) * 8
        score -= (high_cpu / total) * 8
        score -= (high_mem / total) * 8
        score -= (low_disk / total) * 12
    score = max(0, min(100, int(score)))
    band = "excellent" if score >= 85 else "good" if score >= 70 else "fair" if score >= 50 else "poor"

    return {
        "score": score, "band": band,
        "counts": {
            "total": total, "online": online, "offline": offline, "warning": warning,
            "no_agent": no_agent, "stale": stale, "high_cpu": high_cpu, "high_mem": high_mem, "low_disk": low_disk,
        },
    }


@router.get("/devices/fleet-insights")
async def fleet_insights(current_user: dict = Depends(get_current_user)):
    """AI commentary on the fleet â€” what to fix this week."""
    health = await fleet_health(current_user)
    devices = await db.devices.find(scoped_query(current_user), {"_id": 0}).to_list(5000)
    top_risky = sorted(devices, key=lambda d: ((d.get("disk_usage") or 0) + (d.get("cpu_usage") or 0) + (d.get("memory_usage") or 0)) / 3, reverse=True)[:5]
    risky = [{"name": d.get("name"), "client": d.get("client_name"), "cpu": d.get("cpu_usage", 0), "mem": d.get("memory_usage", 0), "disk": d.get("disk_usage", 0), "status": d.get("status")} for d in top_risky]

    summary = ""
    try:
        from app.services.ai_provider import UserMessage
        sys = "You're a fleet operations analyst. Write 3-4 concise bullets prioritised by impact."
        prompt = json.dumps({"health": health, "top_5_risky": risky})
        chat = await _ai_chat(f"fleet-{uuid.uuid4().hex[:6]}", sys)
        resp = await chat.send_message(UserMessage(text=prompt))
        summary = resp.strip()
    except Exception as e:
        logger.warning(f"fleet insights AI failed: {e}")
        bullets = []
        if health["counts"]["low_disk"] > 0:
            bullets.append(f"- {health['counts']['low_disk']} devices have <10% free disk â€” clear temp + reboot.")
        if health["counts"]["offline"] > 0:
            bullets.append(f"- {health['counts']['offline']} devices offline â€” contact site or schedule physical check.")
        if health["counts"]["stale"] > 0:
            bullets.append(f"- {health['counts']['stale']} agents stale (>7d since check-in) â€” reinstall agent.")
        if health["counts"]["high_cpu"]:
            bullets.append(f"- {health['counts']['high_cpu']} devices running >85% CPU â€” investigate runaway processes.")
        if not bullets:
            bullets.append("- Fleet looks healthy. Plan next maintenance window for patches.")
        summary = "\n".join(bullets)
    return {**health, "ai_summary": summary, "top_5_risky": risky}


# â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
# â•‘   5) FAN-OUT AI DIAGNOSE â€” across many devices                   â•‘
# â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.post("/devices/bulk-diagnose")
async def bulk_diagnose(data: dict, current_user: dict = Depends(get_current_user)):
    """Run AI diagnose against multiple devices in parallel; return their severities + diagnoses."""
    ids = data.get("device_ids") or []
    if not isinstance(ids, list):
        raise HTTPException(400, "device_ids must be a list")
    if not ids:
        raise HTTPException(400, "device_ids required")
    if len(ids) > 25:
        raise HTTPException(400, "max 25 devices per request")
    if any(not isinstance(device_id, str) or not device_id.strip() for device_id in ids):
        raise HTTPException(400, "device_ids must contain non-empty device IDs")

    # Validate the complete target set before a single AI call or diagnostic
    # document can be created. This makes a mixed-client batch fail closed.
    unique_ids = list(dict.fromkeys(device_id.strip() for device_id in ids))
    for device_id in unique_ids:
        await assert_record_scope(
            current_user,
            db.devices,
            device_id,
            operation="device.bulk_diagnose",
            resource_name="Device",
        )
    sem = asyncio.Semaphore(5)

    async def run_one(did):
        async with sem:
            try:
                r = await ai_diagnose(did, {}, current_user)
                return r
            except Exception as e:
                return {"device_id": did, "severity": "error", "diagnosis": str(e)[:120]}

    results = await asyncio.gather(*(run_one(d) for d in unique_ids))
    return {"count": len(results), "results": results}
