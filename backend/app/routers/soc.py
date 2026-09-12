from fastapi import APIRouter, Depends, HTTPException
from app.database import db
from app.routers.auth import get_current_user
from datetime import datetime, timezone, timedelta
import uuid
from app.services.module_permissions import require_module_permission
from app.services.scope_permissions import assert_client_scope, scoped_query

router = APIRouter(tags=["Huntress Integration"])


def _retired_generated_data_error(workspace: str) -> HTTPException:
    return HTTPException(
        status_code=410,
        detail=(
            f"{workspace} was retired because it generated security data "
            "instead of reading a connected provider or Nexus evidence source."
        ),
    )


async def _load_scoped_alert(alert_id: str, user: dict, *, operation: str) -> tuple[dict, dict | None]:
    """Load a SOC alert and prove the caller may act on its customer scope.

    Legacy alert rows do not always carry their client binding, so a linked
    device is used only to establish that binding.  An unbound row remains
    inaccessible to a restricted technician rather than becoming an implicit
    global alert.
    """
    alert = await db.soc_alerts.find_one({"id": alert_id}, {"_id": 0})
    if not alert:
        raise HTTPException(status_code=404, detail="SOC alert not found")

    device = None
    client_id = alert.get("client_id")
    site_id = alert.get("site_id")
    if not client_id and alert.get("device_id"):
        device = await db.devices.find_one(scoped_query(user, {"id": alert["device_id"]}), {"_id": 0})
        if device:
            client_id = device.get("client_id")
            site_id = device.get("site_id")

    await assert_client_scope(
        user,
        client_id,
        site_id=site_id,
        operation=operation,
        mask_not_found=True,
    )
    if client_id and not alert.get("client_id"):
        # Preserve the derived scope in the returned in-memory representation
        # so audit records and a created ticket are correctly customer-bound.
        alert = {**alert, "client_id": client_id, "site_id": site_id}
    return alert, device


async def _write_soc_audit(user: dict, action: str, alert: dict, metadata: dict | None = None) -> None:
    """Persist a compact, client-scoped audit record for an internal SOC action."""
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "tenant_id": user.get("tenant_id"),
        "user_id": user.get("id"),
        "user_name": user.get("name") or user.get("email") or user.get("id"),
        "action": action,
        "entity_type": "soc_alert",
        "entity_id": alert.get("id"),
        "entity_name": alert.get("title") or alert.get("summary") or "SOC alert",
        "client_id": alert.get("client_id"),
        "device_id": alert.get("device_id"),
        "metadata": metadata or {},
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

@router.get("/huntress/settings")
async def get_huntress_settings(user=Depends(get_current_user)):
    settings = await db.integration_settings.find_one({"type": "huntress"}, {"_id": 0})
    if not settings:
        return {"type": "huntress", "configured": False, "api_key": "", "secret_key": "", "base_url": "https://api.huntress.io/v1", "auto_sync": False, "sync_interval_min": 15, "last_sync": None}
    settings.pop("secret_key_raw", None)
    return settings


@router.put("/huntress/settings")
async def save_huntress_settings(body: dict, user=Depends(get_current_user)):
    now = datetime.now(timezone.utc).isoformat()
    settings = {
        "type": "huntress",
        "configured": bool(body.get("api_key")),
        "api_key": body.get("api_key", ""),
        "secret_key": body.get("secret_key", "")[:4] + "****" if body.get("secret_key") else "",
        "secret_key_raw": body.get("secret_key", ""),
        "base_url": body.get("base_url", "https://api.huntress.io/v1"),
        "auto_sync": body.get("auto_sync", False),
        "sync_interval_min": body.get("sync_interval_min", 15),
        "updated_at": now,
        "updated_by": user.get("name", "System"),
    }
    await db.integration_settings.update_one({"type": "huntress"}, {"$set": settings}, upsert=True)
    return {"message": "Huntress settings saved", "configured": settings["configured"]}


@router.get("/huntress/test-connection")
async def test_huntress_connection(user=Depends(get_current_user)):
    settings = await db.integration_settings.find_one({"type": "huntress"}, {"_id": 0})
    if not settings or not settings.get("configured"):
        return {"connected": False, "connection_state": "not_configured", "message": "Huntress is not configured. No Huntress data is displayed until a verified provider connection exists."}
    return {"connected": False, "connection_state": "configured_unverified", "message": "Credentials are saved but this legacy endpoint does not verify them. Use the configured integration test in Settings."}


@router.get("/huntress/dashboard")
async def get_huntress_dashboard(user=Depends(get_current_user)):
    raise _retired_generated_data_error("Legacy Huntress dashboard")


@router.get("/huntress/agents")
async def get_huntress_agents(user=Depends(get_current_user)):
    raise _retired_generated_data_error("Legacy Huntress agents endpoint")


@router.get("/huntress/incidents")
async def get_huntress_incidents(user=Depends(get_current_user)):
    raise _retired_generated_data_error("Legacy Huntress incidents endpoint")


@router.get("/soc/dashboard")
async def get_soc_dashboard(user=Depends(get_current_user)):
    """Operational SOC view from stored alerts and enrolled Nexus devices only."""
    devices = await db.devices.find(scoped_query(user), {"_id": 0}).to_list(5000)
    agent_devices = [device for device in devices if device.get("nexus_agent_id")]
    alerts = await db.soc_alerts.find(scoped_query(user), {"_id": 0}).sort("created_at", -1).to_list(200)
    open_alerts = [a for a in alerts if a.get("status") in {"new", "investigating", "open"}]
    critical_alerts = [a for a in open_alerts if a.get("severity") == "critical"]
    online = sum(1 for d in agent_devices if d.get("status") == "online")
    offline = sum(1 for d in agent_devices if d.get("status") == "offline")
    security_scores = [float(d["compliance_score"]) for d in agent_devices if isinstance(d.get("compliance_score"), (int, float))]
    vulnerabilities = await db.vulnerabilities.find(
        scoped_query(user), {"_id": 0, "severity": 1, "discovered_at": 1}
    ).to_list(2000)
    vuln_summary = {severity: sum(1 for v in vulnerabilities if v.get("severity") == severity) for severity in ("critical", "high", "medium", "low")}
    vuln_summary["last_scan"] = max((v.get("discovered_at") for v in vulnerabilities if v.get("discovered_at")), default=None)
    resolved_cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    resolved_last_24h = sum(
        1 for alert in alerts
        if alert.get("status") in {"resolved", "closed"}
        and isinstance(alert.get("resolved_at"), str)
        and alert["resolved_at"] >= resolved_cutoff.isoformat()
    )
    summary = {
        "total_agents": len(agent_devices), "online": online, "offline": offline,
        "isolated": sum(1 for d in agent_devices if d.get("isolated")),
        "needs_attention": sum(1 for d in agent_devices if d.get("status") in {"needs_attention", "degraded"}),
        "health_pct": round((online / len(agent_devices)) * 100) if agent_devices else 0,
        "total_incidents": len(alerts), "open_incidents": len(open_alerts),
        "critical_incidents": len(critical_alerts), "resolved_last_24h": resolved_last_24h,
        "avg_response_time_min": None, "threats_blocked_30d": 0,
    }
    return {
        "huntress": summary, "agents": devices[:10], "incidents": open_alerts[:8],
        # Dark-web findings require a breach-intelligence provider. Do not
        # surface the old generated collection as SOC evidence.
        "persisted_alerts": alerts[:20], "dark_web_alerts": [],
        "vulnerability_summary": vuln_summary,
        "compliance_score": round(sum(security_scores) / len(security_scores)) if security_scores else None,
        # Neither identity threat detection nor phishing simulation has a
        # provider-backed Nexus source yet. Do not report legacy seeded rows.
        "identity_threats": None, "identity_source_configured": False,
        "phishing_tests_running": None, "phishing_source_configured": False,
        "mock_data": False,
    }


@router.get("/soc/alerts")
async def get_soc_alerts(user=Depends(get_current_user)):
    """Get all SOC alerts from all sources."""
    db_alerts = await db.soc_alerts.find(scoped_query(user), {"_id": 0}).sort("created_at", -1).to_list(200)
    db_alerts.sort(key=lambda x: {"critical": 0, "high": 1, "medium": 2, "low": 3}.get(x.get("severity", "low"), 4))
    return db_alerts


@router.post("/soc/alerts/{alert_id}/acknowledge")
async def acknowledge_alert(alert_id: str, user=Depends(get_current_user)):
    await require_module_permission(user, "devices", "edit")
    alert, _device = await _load_scoped_alert(alert_id, user, operation="soc_alert.acknowledge")
    if str(alert.get("status") or "").lower() in {"closed", "remediated", "resolved", "dismissed"}:
        raise HTTPException(status_code=409, detail="This SOC alert is already closed")
    now = datetime.now(timezone.utc).isoformat()
    await db.soc_alerts.update_one(
        {"id": alert_id},
        {"$set": {"status": "investigating", "acknowledged_by": user.get("name"), "acknowledged_at": now}}
    )
    await _write_soc_audit(user, "soc_alert_acknowledge", alert, {"status": "investigating"})
    return {"message": "Alert acknowledgement recorded", "status": "investigating"}


@router.post("/soc/alerts/{alert_id}/create-ticket")
async def create_ticket_from_alert(alert_id: str, body: dict, user=Depends(get_current_user)):
    """Create a ticket from a SOC alert."""
    await require_module_permission(user, "tickets", "create")
    alert, device = await _load_scoped_alert(alert_id, user, operation="soc_alert.create_ticket")
    existing = await db.tickets.find_one(
        scoped_query(user, {"soc_alert_id": alert_id, "status": {"$nin": ["resolved", "closed", "cancelled"]}}),
        {"_id": 0},
    )
    if existing:
        return {
            "message": f"Existing ticket {existing.get('ticket_number') or existing.get('id')} retained",
            "ticket_id": existing.get("id"),
            "ticket_number": existing.get("ticket_number"),
            "existing": True,
        }

    now = datetime.now(timezone.utc).isoformat()
    ticket_id = str(uuid.uuid4())
    ticket_num = f"SEC-{datetime.now(timezone.utc).strftime('%y%m%d-%H%M%S')}-{uuid.uuid4().hex[:4].upper()}"
    if not device and alert.get("hostname"):
        device = await db.devices.find_one(scoped_query(user, {"name": alert["hostname"]}), {"_id": 0})

    ticket = {
        "id": ticket_id,
        "ticket_number": ticket_num,
        "title": body.get("title", f"Security Alert: {alert_id}"),
        "description": body.get("description", ""),
        "ticket_type": "incident",
        "priority": body.get("priority", "high"),
        "status": "open",
        "source": "soc_alert",
        "soc_alert_id": alert_id,
        "client_id": (device or {}).get("client_id") or alert.get("client_id"),
        "client_name": (device or {}).get("client_name") or alert.get("organization") or alert.get("client_name"),
        "device_id": (device or {}).get("id") or alert.get("device_id"),
        "device_ids": [((device or {}).get("id") or alert.get("device_id"))] if ((device or {}).get("id") or alert.get("device_id")) else [],
        "created_by": user["id"],
        "created_by_name": user.get("name", "System"),
        "created_at": now,
        "updated_at": now,
    }
    ticket_doc = {k: v for k, v in ticket.items()}
    await db.tickets.insert_one(ticket_doc)

    await db.soc_alerts.update_one(
        {"id": alert_id},
        {"$set": {"ticket_id": ticket_id, "ticket_number": ticket_num, "status": "investigating"}}
    )
    await _write_soc_audit(user, "soc_alert_create_ticket", alert, {"ticket_id": ticket_id, "ticket_number": ticket_num})
    return {"message": f"Ticket {ticket_num} created", "ticket_id": ticket_id, "ticket_number": ticket_num, "existing": False}


@router.post("/soc/alerts/{alert_id}/isolate")
async def isolate_endpoint(alert_id: str, body: dict, user=Depends(get_current_user)):
    raise HTTPException(
        status_code=410,
        detail="SOC endpoint isolation was retired because it only changed a Nexus record. Use the connected provider or an agent-backed containment command once one is implemented.",
    )


@router.post("/soc/alerts/{alert_id}/remediate")
async def remediate_alert(alert_id: str, body: dict, user=Depends(get_current_user)):
    """Record internal remediation evidence; it never claims provider remediation."""
    await require_module_permission(user, "devices", "edit")
    alert, _device = await _load_scoped_alert(alert_id, user, operation="soc_alert.remediate")
    notes = str(body.get("notes") or "").strip()
    if not notes:
        raise HTTPException(status_code=400, detail="Record remediation evidence or an external provider reference before closing the internal case")
    now = datetime.now(timezone.utc).isoformat()
    await db.soc_alerts.update_one(
        {"id": alert_id},
        {"$set": {"status": "remediated", "remediated_by": user.get("name"), "remediated_at": now,
                  "remediation_notes": notes},
         "$push": {"actions": {"type": "remediation_evidence_recorded", "by": user.get("name"), "at": now, "notes": notes}}}
    )
    await _write_soc_audit(user, "soc_alert_remediate", alert, {"notes": notes})
    return {"message": "Internal remediation evidence recorded", "status": "remediated"}


@router.post("/soc/alerts/{alert_id}/close")
async def close_alert(alert_id: str, body: dict, user=Depends(get_current_user)):
    await require_module_permission(user, "devices", "edit")
    alert, _device = await _load_scoped_alert(alert_id, user, operation="soc_alert.close")
    reason = str(body.get("reason") or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="A closure reason or provider reference is required")
    now = datetime.now(timezone.utc).isoformat()
    await db.soc_alerts.update_one(
        {"id": alert_id},
        {"$set": {"status": "closed", "closed_by": user.get("name"), "closed_at": now,
                  "close_reason": reason}}
    )
    await _write_soc_audit(user, "soc_alert_close", alert, {"reason": reason})
    return {"message": "Internal alert case closed"}


# --- Endpoint Security ---
@router.get("/soc/endpoints")
async def get_endpoint_security(user=Depends(get_current_user)):
    raise _retired_generated_data_error("Legacy SOC endpoint security")


@router.post("/soc/endpoints/{agent_id}/scan")
async def trigger_endpoint_scan(agent_id: str, user=Depends(get_current_user)):
    raise _retired_generated_data_error("Legacy SOC endpoint scan")


@router.post("/soc/endpoints/{agent_id}/isolate")
async def isolate_single_endpoint(agent_id: str, user=Depends(get_current_user)):
    raise _retired_generated_data_error("Legacy SOC endpoint isolation")


@router.post("/soc/endpoints/{agent_id}/unisolate")
async def unisolate_endpoint(agent_id: str, user=Depends(get_current_user)):
    raise _retired_generated_data_error("Legacy SOC endpoint release")


# --- Dark Web Monitor ---
@router.get("/soc/dark-web")
async def get_dark_web_alerts(user=Depends(get_current_user)):
    raise HTTPException(
        status_code=410,
        detail=(
            "Dark Web Monitor was retired because no breach-intelligence "
            "provider is configured. NexusMSP will not generate security "
            "findings or claim domain coverage without a live source."
        ),
    )


# --- Vulnerability Scanner ---
@router.get("/soc/vulnerabilities")
async def get_vulnerabilities(user=Depends(get_current_user)):
    raise HTTPException(
        status_code=410,
        detail=(
            "Legacy SOC vulnerabilities were retired because they generated "
            "CVE findings. Use Vulnerability Scanner for Nexus Agent patch "
            "and trusted-feed evidence."
        ),
    )


# --- Phishing Simulation ---
@router.get("/soc/phishing")
async def get_phishing_campaigns(user=Depends(get_current_user)):
    raise HTTPException(
        status_code=410,
        detail=(
            "Phishing Simulation was retired because no mail-delivery and "
            "tracking provider is connected. NexusMSP will not generate "
            "campaign metrics without actual delivery and audit evidence."
        ),
    )


# --- Identity Threat ---
@router.get("/soc/identity-threats")
async def get_identity_threats(user=Depends(get_current_user)):
    return {
        "threats": [],
        "summary": {"total": 0, "critical": 0, "mfa_gaps": 0, "compromised_accounts": 0},
        "source_configured": False,
        "availability": "no_identity_provider",
        "mock_data": False,
    }


# --- Smart Automation ---
@router.get("/automation/settings")
async def get_automation_settings(user=Depends(get_current_user)):
    settings = await db.automation_settings.find_one({"type": "global"}, {"_id": 0})
    if not settings:
        return {
            "type": "global",
            "thank_you_detection": True,
            "thank_you_keywords": ["thanks", "thank you", "ty", "cheers", "appreciated", "thx"],
            "stale_ticket_days": 3,
            "stale_ticket_enabled": True,
            "stale_ticket_auto_ping": True,
            "billing_recon_enabled": True,
            "billing_recon_schedule": "weekly",
        }
    return settings


@router.put("/automation/settings")
async def save_automation_settings(body: dict, user=Depends(get_current_user)):
    body["type"] = "global"
    body["updated_at"] = datetime.now(timezone.utc).isoformat()
    body["updated_by"] = user.get("name")
    await db.automation_settings.update_one({"type": "global"}, {"$set": body}, upsert=True)
    return {"message": "Automation settings saved"}


@router.post("/automation/check-thank-you")
async def check_thank_you_responses(user=Depends(get_current_user)):
    """Scan open tickets for thank-you responses and auto-close them."""
    settings = await db.automation_settings.find_one({"type": "global"}, {"_id": 0})
    keywords = (settings or {}).get("thank_you_keywords", ["thanks", "thank you", "ty", "cheers"])
    open_tickets = await db.tickets.find(
        {"status": {"$in": ["open", "waiting_on_client", "resolved"]}},
        {"_id": 0, "id": 1, "title": 1, "conversations": 1, "status": 1}
    ).to_list(500)
    closed_count = 0
    for ticket in open_tickets:
        convos = ticket.get("conversations", [])
        if not convos:
            continue
        last_msg = convos[-1] if convos else {}
        msg_text = (last_msg.get("message", "") or "").lower().strip()
        if len(msg_text) < 50 and any(kw in msg_text for kw in keywords):
            await db.tickets.update_one({"id": ticket["id"]}, {
                "$set": {"status": "closed", "closed_at": datetime.now(timezone.utc).isoformat(), "closed_reason": "auto_thank_you"},
                "$push": {"conversations": {"message": "Auto-closed: Client sent a thank-you response.", "sender": "system", "created_at": datetime.now(timezone.utc).isoformat()}}
            })
            closed_count += 1
    return {"message": f"Scanned {len(open_tickets)} tickets, auto-closed {closed_count}", "closed": closed_count, "scanned": len(open_tickets)}


@router.post("/automation/check-stale-tickets")
async def check_stale_tickets(user=Depends(get_current_user)):
    """Find stale tickets and send reminders."""
    settings = await db.automation_settings.find_one({"type": "global"}, {"_id": 0})
    stale_days = (settings or {}).get("stale_ticket_days", 3)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=stale_days)).isoformat()
    stale = await db.tickets.find(
        {"status": {"$in": ["open", "waiting_on_client"]}, "updated_at": {"$lt": cutoff}},
        {"_id": 0, "id": 1, "title": 1, "ticket_number": 1, "client_name": 1, "updated_at": 1}
    ).to_list(200)
    pinged = 0
    for ticket in stale:
        await db.tickets.update_one({"id": ticket["id"]}, {
            "$push": {"conversations": {"message": f"Automated reminder: This ticket has had no activity for {stale_days}+ days. Please provide an update or this ticket may be auto-closed.", "sender": "system", "created_at": datetime.now(timezone.utc).isoformat()}},
            "$set": {"last_stale_ping": datetime.now(timezone.utc).isoformat()}
        })
        pinged += 1
    return {"message": f"Found {len(stale)} stale tickets, sent {pinged} reminders", "stale_count": len(stale), "pinged": pinged}


@router.get("/automation/billing-recon")
async def get_billing_reconciliation(user=Depends(get_current_user)):
    """Reconcile RMM agent counts against contract line items."""
    clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(500)
    contracts = await db.contracts.find({"status": "active"}, {"_id": 0}).to_list(500)
    devices = await db.devices.find({}, {"_id": 0, "id": 1, "client_id": 1, "status": 1}).to_list(5000)

    recon = []
    for client in clients:
        client_contracts = [c for c in contracts if c.get("client_id") == client["id"]]
        client_devices = [d for d in devices if d.get("client_id") == client["id"]]
        contracted_seats = sum(int(c.get("seats", 0) or c.get("quantity", 0) or 0) for c in client_contracts)
        actual_agents = len(client_devices)
        if contracted_seats > 0 or actual_agents > 0:
            diff = actual_agents - contracted_seats
            recon.append({
                "client_id": client["id"],
                "client_name": client["name"],
                "contracted_seats": contracted_seats,
                "actual_agents": actual_agents,
                "difference": diff,
                "status": "match" if diff == 0 else "over" if diff > 0 else "under",
                "revenue_impact": round(diff * 5.0, 2),
            })
    recon.sort(key=lambda x: abs(x["difference"]), reverse=True)
    total_over = sum(r["difference"] for r in recon if r["status"] == "over")
    total_under = sum(abs(r["difference"]) for r in recon if r["status"] == "under")
    return {
        "reconciliation": recon,
        "summary": {
            "total_clients": len(recon),
            "matched": len([r for r in recon if r["status"] == "match"]),
            "over_provisioned": len([r for r in recon if r["status"] == "over"]),
            "under_provisioned": len([r for r in recon if r["status"] == "under"]),
            "total_over_agents": total_over,
            "total_under_agents": total_under,
            "potential_revenue_loss": round(total_over * 5.0, 2),
        },
        "mock_data": False,
    }


@router.get("/soc-feed/events")
async def get_soc_feed_events(current_user: dict = Depends(get_current_user)):
    events = await db.soc_events.find(
        scoped_query(current_user), {"_id": 0}
    ).sort("timestamp", -1).to_list(200)
    return events


@router.get("/soc-feed/stats")
async def get_soc_feed_stats(current_user: dict = Depends(get_current_user)):
    events = await db.soc_events.find(
        scoped_query(current_user), {"_id": 0}
    ).to_list(500)
    return {
        "total_events": len(events),
        "investigations": sum(1 for e in events if e.get("type") == "investigation"),
        "responses": sum(1 for e in events if e.get("type") == "response"),
        "resolutions": sum(1 for e in events if e.get("type") == "resolution"),
        "avg_response_time_min": None,
        "mttr_hours": None,
        "evidence_state": "recorded_events_only",
    }


@router.get("/soc-realtime/events")
async def get_soc_realtime_events(current_user: dict = Depends(get_current_user)):
    """Return recorded SOC realtime events within the caller's client scope.

    This endpoint is a polling view over persisted evidence, not a claim that
    Nexus has an active streaming provider connection.  Legacy events without
    a client binding remain unavailable to restricted technicians rather than
    becoming a cross-client feed.
    """
    events = await db.soc_realtime_events.find(
        scoped_query(current_user), {"_id": 0}
    ).sort("timestamp", -1).to_list(50)
    stats = {
        "total_events_24h": len(events),
        "critical": len([e for e in events if e.get("severity") == "critical"]),
        "high": len([e for e in events if e.get("severity") == "high"]),
        "medium": len([e for e in events if e.get("severity") == "medium"]),
        "blocked": len([e for e in events if e.get("action") == "blocked"]),
        "investigating": len([e for e in events if e.get("status") == "investigating"]),
    }
    return {
        "events": events,
        "stats": stats,
        "feed_type": "polling",
        "evidence_state": "recorded_events_only",
    }


@router.post("/soc-realtime/generate")
async def generate_soc_realtime_event(current_user: dict = Depends(get_current_user)):
    raise _retired_generated_data_error("SOC realtime event generation")


@router.get("/soc-realtime/threat-map")
async def soc_threat_map(current_user: dict = Depends(get_current_user)):
    raise _retired_generated_data_error("SOC realtime threat map")
