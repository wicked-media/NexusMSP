"""Nexus Shield endpoint-protection management plane.

This router deliberately distinguishes verified Nexus Agent evidence from
monitoring policy.  It must never claim that a device has been remediated or
isolated merely because a desired control is enabled in the workspace.
"""

from datetime import datetime, timezone
from typing import Any
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import get_current_user
from app.database import db
from app.services.activity import log_activity
from app.services.nexus_xdr import build_xdr_overview
from app.services.scope_permissions import assert_client_scope, scoped_query

router = APIRouter()

POLICY_KEY = "nexus_shield_policies"
POLICY_SEVERITIES = {"critical", "high", "medium", "low"}
POLICY_SCOPE_MODES = {"all_clients", "selected_clients"}

DEFAULT_POLICIES = [
    {
        "id": "defender_health",
        "name": "Microsoft Defender health",
        "description": "Alert when an assessed Windows endpoint reports Defender or real-time protection inactive.",
        "evidence": "Nexus Agent security telemetry",
        "enabled": True,
        "mode": "monitor",
        "severity": "high",
        "scope_mode": "all_clients",
        "client_ids": [],
    },
    {
        "id": "firewall_posture",
        "name": "Firewall posture",
        "description": "Keep agent-reported Windows firewall state visible in the Shield response queue.",
        "evidence": "Nexus Agent security telemetry",
        "enabled": True,
        "mode": "monitor",
        "severity": "high",
        "scope_mode": "all_clients",
        "client_ids": [],
    },
    {
        "id": "encryption_posture",
        "name": "Disk encryption posture",
        "description": "Highlight assessed endpoints that do not report encrypted local storage.",
        "evidence": "Nexus Agent security telemetry",
        "enabled": True,
        "mode": "monitor",
        "severity": "medium",
        "scope_mode": "all_clients",
        "client_ids": [],
    },
    {
        "id": "patch_exposure",
        "name": "Patch exposure",
        "description": "Surface endpoints with a critical update backlog for technician review.",
        "evidence": "Nexus Agent update telemetry",
        "enabled": True,
        "mode": "monitor",
        "severity": "medium",
        "scope_mode": "all_clients",
        "client_ids": [],
        "threshold": 10,
        "threshold_label": "Pending updates before alerting",
    },
    {
        "id": "nexus_canary",
        "name": "Nexus Canary integrity detection",
        "description": "Deploy and track protected decoy files. A changed or missing file creates an auditable response signal.",
        "evidence": "Nexus Agent canary loop",
        "enabled": True,
        "mode": "active_detection",
        "severity": "critical",
        "scope_mode": "all_clients",
        "client_ids": [],
    },
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _get_policies() -> list[dict[str, Any]]:
    stored = await db.settings.find_one({"key": POLICY_KEY}, {"_id": 0}) or {}
    stored_by_id = {
        item.get("id"): item
        for item in ((stored.get("value") or {}).get("policies") or [])
        if isinstance(item, dict) and item.get("id")
    }
    policies: list[dict[str, Any]] = []
    for policy in DEFAULT_POLICIES:
        saved = stored_by_id.get(policy["id"], {})
        severity = saved.get("severity")
        scope_mode = saved.get("scope_mode")
        merged = {
            **policy,
            "enabled": bool(saved.get("enabled", policy["enabled"])),
            "severity": severity if severity in POLICY_SEVERITIES else policy["severity"],
            "scope_mode": scope_mode if scope_mode in POLICY_SCOPE_MODES else policy["scope_mode"],
            "client_ids": list(dict.fromkeys(
                client_id for client_id in (saved.get("client_ids") or [])
                if isinstance(client_id, str) and client_id.strip()
            )),
        }
        if policy["id"] == "patch_exposure":
            try:
                threshold = int(saved.get("threshold", policy["threshold"]))
            except (TypeError, ValueError):
                threshold = policy["threshold"]
            merged["threshold"] = max(1, min(threshold, 500))
        policies.append(merged)
    return policies


async def _get_policy_metadata() -> dict[str, Any]:
    stored = await db.settings.find_one({"key": POLICY_KEY}, {"_id": 0}) or {}
    return {
        "updated_at": stored.get("updated_at"),
        "updated_by": stored.get("updated_by_name") or stored.get("updated_by"),
    }


def _policy_applies(policy: dict[str, Any], client_id: str | None) -> bool:
    if policy.get("scope_mode") != "selected_clients":
        return True
    return bool(client_id and client_id in set(policy.get("client_ids") or []))


def _device_risks(device: dict[str, Any], policies_by_id: dict[str, dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """Generate evidence-based response items without inventing device state."""
    if not device.get("security_assessed_at"):
        return []
    policies_by_id = policies_by_id or {}
    patch_threshold = int((policies_by_id.get("patch_exposure") or {}).get("threshold") or 10)
    risks: list[dict[str, Any]] = []
    name = device.get("name") or device.get("hostname") or device.get("id", "Endpoint")
    common = {"device_id": device.get("id"), "device_name": name, "client_id": device.get("client_id"), "client_name": device.get("client_name") or "Unassigned client"}
    if device.get("antivirus_status") != "active" or not device.get("defender_real_time_enabled"):
        risks.append({**common, "id": f"{device.get('id')}:defender", "control": "Defender health", "severity": "high", "reason": "Microsoft Defender real-time protection reports inactive."})
    if not device.get("firewall_enabled"):
        risks.append({**common, "id": f"{device.get('id')}:firewall", "control": "Firewall posture", "severity": "high", "reason": "The endpoint reports its firewall is not enabled."})
    encryption = str(device.get("encryption_status") or "").lower()
    if not any(marker in encryption for marker in ("encrypted", "bitlocker on", "protection on")):
        risks.append({**common, "id": f"{device.get('id')}:encryption", "control": "Disk encryption", "severity": "medium", "reason": "The endpoint does not report encrypted local storage."})
    if int(device.get("pending_patches") or 0) > patch_threshold:
        risks.append({**common, "id": f"{device.get('id')}:patches", "control": "Patch exposure", "severity": "medium", "reason": f"{int(device.get('pending_patches') or 0)} pending updates exceed the configured threshold of {patch_threshold}."})
    return risks


def _xdr_response_item(incident: dict[str, Any]) -> dict[str, Any]:
    """Translate one correlated XDR case into a review-only response item."""
    evidence = incident.get("evidence") or []
    categories = incident.get("categories") or []
    latest = evidence[0] if evidence else {}
    return {
        "id": f"xdr-response:{incident.get('id')}",
        "control": "Nexus Canary" if categories == ["endpoint"] and latest.get("source") == "Nexus Canary" else "XDR evidence",
        "severity": incident.get("severity") or "medium",
        "reason": incident.get("summary") or "Persisted security evidence requires technician validation.",
        "client_id": incident.get("client_id"),
        "client_name": incident.get("client_name") or "Unassigned client",
        "device_id": latest.get("device_id"),
        "device_name": incident.get("subject") or "Observed security subject",
        "subject": incident.get("subject"),
        "categories": categories,
        "signal_count": int(incident.get("signal_count") or len(evidence) or 1),
        "xdr_case_id": incident.get("id"),
        "latest_observed_at": incident.get("latest_observed_at"),
        "evidence_route": latest.get("route") or "/security-graph",
        "requires_approval": True,
    }


def _mail_shield_alerts(signals: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Normalise persisted Mail Shield evidence into the XDR event contract.

    The authoritative Mail Shield record remains intact; XDR receives a read
    model only, so a case cannot overwrite mail triage history.
    """
    return [{
        "id": signal.get("id"),
        "client_id": signal.get("client_id"),
        "client_name": signal.get("client_name"),
        "category": "email",
        "source": "Nexus Mail Shield",
        "title": signal.get("title"),
        "summary": signal.get("summary"),
        "severity": signal.get("severity"),
        "status": signal.get("status"),
        "user_email": signal.get("recipient") or signal.get("mailbox"),
        "created_at": signal.get("observed_at") or signal.get("created_at"),
        "evidence_route": "/mail-shield",
    } for signal in signals]


def _dmarc_alerts(reports: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Expose meaningful unauthorised-sender evidence to XDR without mutating DMARC history."""
    return [{
        "id": f"xdr-dmarc-{report.get('id')}", "client_id": report.get("client_id"),
        "category": "email", "source": "Nexus DMARC", "title": f"Unauthorised sending observed for {report.get('domain')}",
        "summary": f"{int(report.get('unauthorized_count') or 0)} unauthorised message(s) in a DMARC aggregate report.",
        "severity": "high" if int(report.get("unauthorized_count") or 0) >= 25 else "medium",
        "status": "new", "created_at": report.get("received_at"), "evidence_route": "/dmarc-compliance",
    } for report in reports if int(report.get("unauthorized_count") or 0) > 0]


@router.get("/nexus-shield/overview")
async def get_nexus_shield_overview(current_user: dict = Depends(get_current_user)):
    devices = await db.devices.find({}, {"_id": 0}).to_list(5000)
    canaries = await db.ransomware_canaries.find({"deployment_source": "nexus-agent"}, {"_id": 0}).to_list(5000)
    # Trigger evidence is canonical even when an older deployment record is
    # missing the newer Nexus Agent source marker. Do not hide an unresolved
    # integrity signal merely because deployment metadata is incomplete.
    triggers = await db.canary_triggers.find(
        {"resolved": False}, {"_id": 0}
    ).sort("triggered_at", -1).to_list(100)
    policies = await _get_policies()
    enabled_policies = {policy["id"] for policy in policies if policy.get("enabled")}
    policies_by_id = {policy["id"]: policy for policy in policies}

    enrolled = [device for device in devices if device.get("nexus_agent_id")]
    assessed = [device for device in devices if device.get("security_assessed_at")]
    risk_queue = []
    for device in devices:
        for risk in _device_risks(device, policies_by_id):
            policy_id = {"Defender health": "defender_health", "Firewall posture": "firewall_posture", "Disk encryption": "encryption_posture", "Patch exposure": "patch_exposure"}.get(risk.get("control"))
            policy = policies_by_id.get(policy_id) or {}
            if policy_id in enabled_policies and _policy_applies(policy, risk.get("client_id")):
                risk["policy_id"] = policy_id
                risk["severity"] = policy.get("severity") or risk.get("severity")
                risk_queue.append(risk)
    verified_sources = ["m365_graph", "m365_partner_center"]
    security_alerts = await db.security_alerts.find({}, {"_id": 0}).to_list(5000)
    mail_signals = await db.nexus_mail_shield_signals.find({}, {"_id": 0}).to_list(5000)
    dmarc_reports = await db.nexus_dmarc_reports.find({}, {"_id": 0}).to_list(5000)
    xdr = build_xdr_overview(
        devices=devices,
        m365_users=await db.m365_users.find({"source": {"$in": verified_sources}}, {"_id": 0}).to_list(10000),
        m365_tenants=await db.m365_tenants.find({"source": {"$in": verified_sources}}, {"_id": 0}).to_list(2000),
        security_alerts=[*security_alerts, *_mail_shield_alerts(mail_signals), *_dmarc_alerts(dmarc_reports)],
        identity_threats=await db.identity_threats.find({}, {"_id": 0}).to_list(5000),
        dns_domains=await db.dns_domains.find({}, {"_id": 0}).to_list(5000),
        dns_alerts=await db.dns_alerts.find({}, {"_id": 0}).to_list(5000),
        backup_jobs=await db.backup_jobs.find({}, {"_id": 0}).to_list(5000),
        vulnerabilities=await db.vulnerabilities.find({"source": {"$in": ["agent", "huntress", "defender", "vulnerability-provider"]}}, {"_id": 0}).to_list(5000),
        canary_triggers=triggers,
    )
    canary_policy = policies_by_id.get("nexus_canary") or {}
    for incident in xdr.get("incidents", []):
        categories = incident.get("categories") or []
        is_canary_only = categories == ["endpoint"] and all(
            row.get("source") == "Nexus Canary" for row in (incident.get("evidence") or [])
        )
        if is_canary_only and (
            "nexus_canary" not in enabled_policies
            or not _policy_applies(canary_policy, incident.get("client_id"))
        ):
            continue
        risk_queue.append(_xdr_response_item(incident))

    severity_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    risk_queue.sort(key=lambda item: (severity_order.get(item.get("severity"), 9), item.get("device_name") or ""))

    return {
        "generated_at": _now(),
        "coverage": {
            "managed_assets": len(devices),
            "agent_enrolled": len(enrolled),
            "shield_enrolled": sum(1 for item in devices if item.get("nexus_shield_enabled")),
            "agent_verified": len(assessed),
            "defender_healthy": sum(1 for item in assessed if item.get("antivirus_status") == "active" and item.get("defender_real_time_enabled")),
            "firewall_enabled": sum(1 for item in assessed if item.get("firewall_enabled")),
            "encrypted": sum(1 for item in assessed if any(marker in str(item.get("encryption_status") or "").lower() for marker in ("encrypted", "bitlocker on", "protection on"))),
        },
        "canary": {
            "deployed": len(canaries),
            "healthy": sum(1 for item in canaries if item.get("status") == "healthy"),
            "pending": sum(1 for item in canaries if item.get("status") in {"queued", "active"}),
            "triggered": sum(1 for item in canaries if item.get("status") == "triggered"),
            "unresolved": len(triggers),
        },
        "policies": policies,
        "policy_metadata": await _get_policy_metadata(),
        "risk_queue": risk_queue[:100],
        "xdr": xdr,
        "capability_note": "Nexus Shield currently provides Nexus Agent-verified posture evidence, active Nexus Canary integrity detection, and auditable response workflows. Endpoint enforcement is intentionally not represented as active until a separately reviewed agent control is installed.",
    }


async def _build_xdr_assessment(client_id: str = "") -> dict[str, Any]:
    """Return a client-scoped XDR assessment without treating filtering as evidence."""
    clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1}).sort("name", 1).to_list(5000)
    selected = next((row for row in clients if str(row.get("id")) == client_id), None)
    if client_id and not selected:
        raise HTTPException(status_code=404, detail="The selected client no longer exists")

    client_name = str((selected or {}).get("name") or "")
    if client_id:
        scope = {"$or": [
            {"client_id": client_id},
            {"client_name": client_name},
            {"organization": client_name},
        ]}
    else:
        scope = {}

    def scoped(base: dict[str, Any] | None = None) -> dict[str, Any]:
        base = base or {}
        if not scope:
            return base
        if not base:
            return scope
        return {"$and": [base, scope]}

    verified_sources = ["m365_graph", "m365_partner_center"]
    trusted_vulnerability_sources = ["agent", "huntress", "defender", "vulnerability-provider"]
    security_alerts = await db.security_alerts.find(scoped(), {"_id": 0}).to_list(5000)
    mail_signals = await db.nexus_mail_shield_signals.find(scoped(), {"_id": 0}).to_list(5000)
    dmarc_reports = await db.nexus_dmarc_reports.find(scoped(), {"_id": 0}).to_list(5000)
    xdr = build_xdr_overview(
        devices=await db.devices.find(scoped(), {"_id": 0}).to_list(10000),
        m365_users=await db.m365_users.find(scoped({"source": {"$in": verified_sources}}), {"_id": 0}).to_list(10000),
        m365_tenants=await db.m365_tenants.find(scoped({"source": {"$in": verified_sources}}), {"_id": 0}).to_list(2000),
        security_alerts=[*security_alerts, *_mail_shield_alerts(mail_signals), *_dmarc_alerts(dmarc_reports)],
        identity_threats=await db.identity_threats.find(scoped(), {"_id": 0}).to_list(5000),
        dns_domains=await db.dns_domains.find(scoped(), {"_id": 0}).to_list(5000),
        dns_alerts=await db.dns_alerts.find(scoped(), {"_id": 0}).to_list(5000),
        backup_jobs=await db.backup_jobs.find(scoped(), {"_id": 0}).to_list(5000),
        vulnerabilities=await db.vulnerabilities.find(scoped({"source": {"$in": trusted_vulnerability_sources}}), {"_id": 0}).to_list(5000),
        canary_triggers=await db.canary_triggers.find(scoped({"resolved": False}), {"_id": 0}).to_list(5000),
    )
    xdr["filters"] = {
        "clients": clients,
        "selected_client_id": client_id,
        "selected_client_name": client_name,
    }
    return xdr


@router.get("/nexus-shield/xdr")
async def get_nexus_shield_xdr(
    client_id: str = Query(default=""),
    current_user: dict = Depends(get_current_user),
):
    return await _build_xdr_assessment(client_id)


@router.get("/nexus-shield/xdr/cases")
async def list_nexus_shield_xdr_cases(
    client_id: str = Query(default=""),
    current_user: dict = Depends(get_current_user),
):
    if client_id:
        await assert_client_scope(current_user, client_id, operation="list_nexus_shield_xdr_cases")
    query = scoped_query(current_user, {"client_id": client_id} if client_id else {})
    cases = await db.nexus_shield_xdr_cases.find(query, {"_id": 0}).sort("updated_at", -1).to_list(1000)
    return {"cases": cases}


@router.get("/nexus-shield/xdr/missions")
async def list_nexus_shield_xdr_missions(
    client_id: str = Query(default=""),
    current_user: dict = Depends(get_current_user),
):
    if client_id:
        await assert_client_scope(current_user, client_id, operation="list_nexus_shield_xdr_missions")
    query = scoped_query(current_user, {"client_id": client_id} if client_id else {})
    missions = await db.nexus_shield_security_missions.find(query, {"_id": 0}).sort("updated_at", -1).to_list(1000)
    return {"missions": missions}


@router.post("/nexus-shield/xdr/missions")
async def activate_nexus_shield_xdr_mission(
    data: dict[str, Any],
    current_user: dict = Depends(get_current_user),
):
    mission_id = str(data.get("mission_id") or "").strip()
    client_id = str(data.get("client_id") or "").strip()
    reason = str(data.get("reason") or "").strip()
    if not mission_id or not reason:
        raise HTTPException(status_code=422, detail="Choose a current security mission and record the operational reason")
    await assert_client_scope(current_user, client_id or None, operation="activate_nexus_shield_xdr_mission")

    assessment = await _build_xdr_assessment(client_id)
    observed = next((item for item in assessment.get("missions", []) if item.get("id") == mission_id), None)
    if not observed:
        raise HTTPException(status_code=409, detail="This security mission is no longer supported by the current evidence. Refresh the assessment before activating it.")

    existing = await db.nexus_shield_security_missions.find_one({
        "mission_id": mission_id,
        "client_id": client_id,
        "status": {"$nin": ["completed", "cancelled"]},
    }, {"_id": 0})
    if existing:
        return {"message": "An active Security Mission already exists", "mission": existing, "existing": True}

    now = _now()
    owner_id = str(current_user.get("id") or "")
    owner_name = str(current_user.get("name") or current_user.get("email") or "Authenticated technician")
    record = {
        "id": f"shield-mission-{uuid.uuid4().hex[:12]}",
        "mission_id": mission_id,
        "title": observed.get("title"),
        "detail": observed.get("detail"),
        "impact": observed.get("impact"),
        "severity": observed.get("severity"),
        "route": observed.get("route"),
        "response_pack": observed.get("response_pack") or [],
        "client_id": client_id,
        "client_name": assessment.get("filters", {}).get("selected_client_name") or "All managed clients",
        "status": "planned",
        "owner_id": owner_id,
        "owner_name": owner_name,
        "opened_at": now,
        "updated_at": now,
        "events": [{
            "type": "mission_activated",
            "status": "planned",
            "note": reason,
            "technician_id": owner_id,
            "technician_name": owner_name,
            "at": now,
        }],
    }
    await db.nexus_shield_security_missions.insert_one(record.copy())
    await log_activity(current_user, "shield_security_mission_activated", "nexus_shield_security_mission", record["id"], record["title"] or "Security Mission", f"Activated Security Mission for {record['client_name']}", metadata={"mission_id": mission_id, "client_id": client_id, "external_changes": False})
    record.pop("_id", None)
    return {"message": "Security Mission activated and recorded", "mission": record, "existing": False}


@router.patch("/nexus-shield/xdr/missions/{mission_record_id}")
async def update_nexus_shield_xdr_mission(
    mission_record_id: str,
    data: dict[str, Any],
    current_user: dict = Depends(get_current_user),
):
    existing = await db.nexus_shield_security_missions.find_one({"id": mission_record_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Security Mission not found")
    await assert_client_scope(current_user, existing.get("client_id") or None, operation="update_nexus_shield_xdr_mission")

    status = str(data.get("status") or existing.get("status") or "planned").strip().lower()
    allowed = {"planned", "in_progress", "blocked", "completed", "cancelled"}
    if status not in allowed:
        raise HTTPException(status_code=422, detail="Choose a valid Security Mission status")
    note = str(data.get("note") or "").strip()
    if not note:
        raise HTTPException(status_code=422, detail="Record an outcome note before updating the mission")

    now = _now()
    technician_id = str(current_user.get("id") or "")
    technician_name = str(current_user.get("name") or current_user.get("email") or "Authenticated technician")
    event = {
        "type": "status_updated" if status != existing.get("status") else "mission_note",
        "from_status": existing.get("status"),
        "status": status,
        "note": note,
        "technician_id": technician_id,
        "technician_name": technician_name,
        "at": now,
    }
    update = {"status": status, "updated_at": now}
    if status in {"completed", "cancelled"}:
        update.update({"closed_at": now, "closed_by": technician_name})
    await db.nexus_shield_security_missions.update_one({"id": mission_record_id}, {"$set": update, "$push": {"events": event}})
    await log_activity(current_user, "shield_security_mission_updated", "nexus_shield_security_mission", mission_record_id, existing.get("title") or "Security Mission", f"Updated Security Mission from {existing.get('status')} to {status}", metadata={"status": status, "previous_status": existing.get("status"), "client_id": existing.get("client_id"), "external_changes": False})
    updated = await db.nexus_shield_security_missions.find_one({"id": mission_record_id}, {"_id": 0})
    return {"message": "Security Mission updated", "mission": updated}


@router.post("/nexus-shield/xdr/missions/{mission_record_id}/ticket")
async def create_nexus_shield_mission_ticket(
    mission_record_id: str,
    data: dict[str, Any],
    current_user: dict = Depends(get_current_user),
):
    mission = await db.nexus_shield_security_missions.find_one({"id": mission_record_id}, {"_id": 0})
    if not mission:
        raise HTTPException(status_code=404, detail="Security Mission not found")
    await assert_client_scope(current_user, mission.get("client_id") or None, operation="create_nexus_shield_mission_ticket")
    if not mission.get("client_id"):
        raise HTTPException(status_code=422, detail="Choose a client before creating a remediation ticket from an MSP-wide mission")
    if mission.get("ticket_id"):
        ticket = await db.tickets.find_one({"id": mission["ticket_id"]}, {"_id": 0, "id": 1, "ticket_number": 1})
        if ticket:
            return {"message": "A remediation ticket is already linked", "ticket": ticket, "existing": True}

    from app.routers.ticket_suggestions import generate_ticket_number

    now = _now()
    ticket_id = f"shield-ticket-{uuid.uuid4().hex[:12]}"
    ticket_number = await generate_ticket_number("incident")
    pack = mission.get("response_pack") or []
    description = "\n".join([
        f"Nexus Security Mission: {mission.get('title') or 'Security resilience work'}",
        mission.get("detail") or "",
        "",
        "Controlled response pack:",
        *[f"- {step}" for step in pack],
        "",
        f"Mission record: {mission.get('id')}",
    ]).strip()
    ticket = {
        "id": ticket_id,
        "ticket_number": ticket_number,
        "title": f"[Shield Mission] {mission.get('title') or 'Security resilience work'}",
        "description": description,
        "client_id": mission["client_id"],
        "client_name": mission.get("client_name"),
        "status": "open",
        "priority": mission.get("severity") if mission.get("severity") in {"critical", "high", "medium", "low"} else "high",
        "category": "security",
        "ticket_type": "incident",
        "source": "nexus_shield_mission",
        "nexus_shield_mission_id": mission["id"],
        "created_at": now,
        "updated_at": now,
        "created_by": current_user.get("name") or current_user.get("email") or "Nexus Shield",
    }
    await db.tickets.insert_one(ticket.copy())
    event = {
        "type": "remediation_ticket_created",
        "status": mission.get("status") or "planned",
        "note": str(data.get("note") or f"Created linked remediation ticket {ticket_number}."),
        "technician_id": str(current_user.get("id") or ""),
        "technician_name": str(current_user.get("name") or current_user.get("email") or "Authenticated technician"),
        "at": now,
        "ticket_id": ticket_id,
        "ticket_number": ticket_number,
    }
    await db.nexus_shield_security_missions.update_one({"id": mission_record_id}, {"$set": {"ticket_id": ticket_id, "ticket_number": ticket_number, "updated_at": now}, "$push": {"events": event}})
    await log_activity(current_user, "shield_security_mission_ticket_created", "nexus_shield_security_mission", mission_record_id, mission.get("title") or "Security Mission", f"Created linked remediation ticket {ticket_number}", metadata={"ticket_id": ticket_id, "ticket_number": ticket_number, "client_id": mission.get("client_id"), "external_changes": False})
    return {"message": "Linked remediation ticket created", "ticket": {"id": ticket_id, "ticket_number": ticket_number}, "existing": False}


@router.post("/nexus-shield/xdr/cases")
async def open_nexus_shield_xdr_case(
    data: dict[str, Any],
    current_user: dict = Depends(get_current_user),
):
    source_case_id = str(data.get("source_case_id") or "").strip()
    client_id = str(data.get("client_id") or "").strip()
    if not source_case_id:
        raise HTTPException(status_code=422, detail="Choose an observed XDR case to investigate")

    assessment = await _build_xdr_assessment(client_id)
    observed = next((row for row in assessment.get("incidents", []) if row.get("id") == source_case_id), None)
    if not observed:
        raise HTTPException(status_code=409, detail="This signal is no longer present in the current XDR assessment. Refresh the evidence before opening a case.")

    existing = await db.nexus_shield_xdr_cases.find_one({
        "source_case_id": source_case_id,
        "status": {"$nin": ["resolved", "false_positive"]},
    }, {"_id": 0})
    if existing:
        return {"message": "An active investigation already exists", "case": existing, "existing": True}

    now = _now()
    owner_id = str(current_user.get("id") or "")
    owner_name = str(current_user.get("name") or current_user.get("email") or "Authenticated technician")
    record = {
        "id": f"xdr-case-{uuid.uuid4().hex[:12]}",
        "source_case_id": source_case_id,
        "title": observed.get("title"),
        "summary": observed.get("summary"),
        "severity": observed.get("severity"),
        "client_id": observed.get("client_id") or client_id,
        "client_name": observed.get("client_name"),
        "subject": observed.get("subject"),
        "categories": observed.get("categories") or [],
        "evidence_snapshot": observed.get("evidence") or [],
        "suggested_actions_snapshot": observed.get("suggested_actions") or [],
        "status": "investigating",
        "owner_id": owner_id,
        "owner_name": owner_name,
        "opened_at": now,
        "updated_at": now,
        "events": [{
            "type": "investigation_opened",
            "status": "investigating",
            "note": str(data.get("note") or "Opened from the current evidence-backed XDR assessment."),
            "technician_id": owner_id,
            "technician_name": owner_name,
            "at": now,
        }],
    }
    await db.nexus_shield_xdr_cases.insert_one(record.copy())
    await log_activity(
        current_user,
        "shield_xdr_case_opened",
        "nexus_shield_xdr_case",
        record["id"],
        record.get("title") or "XDR investigation",
        f"Opened {record['severity']} XDR investigation for {record.get('client_name') or 'unassigned client'}",
        metadata={"source_case_id": source_case_id, "client_id": record.get("client_id"), "external_changes": False},
    )
    record.pop("_id", None)
    return {"message": "XDR investigation opened", "case": record, "existing": False}


@router.patch("/nexus-shield/xdr/cases/{case_id}")
async def update_nexus_shield_xdr_case(
    case_id: str,
    data: dict[str, Any],
    current_user: dict = Depends(get_current_user),
):
    existing = await db.nexus_shield_xdr_cases.find_one({"id": case_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="XDR investigation not found")

    status = str(data.get("status") or existing.get("status") or "investigating").strip().lower()
    allowed = {"investigating", "contained", "recovering", "resolved", "false_positive"}
    if status not in allowed:
        raise HTTPException(status_code=422, detail="Choose a valid XDR investigation status")
    note = str(data.get("note") or "").strip()
    if not note:
        raise HTTPException(status_code=422, detail="Record a decision note before updating the investigation")

    now = _now()
    technician_id = str(current_user.get("id") or "")
    technician_name = str(current_user.get("name") or current_user.get("email") or "Authenticated technician")
    event = {
        "type": "status_updated" if status != existing.get("status") else "investigation_note",
        "from_status": existing.get("status"),
        "status": status,
        "note": note,
        "technician_id": technician_id,
        "technician_name": technician_name,
        "at": now,
    }
    update = {"status": status, "updated_at": now}
    if status in {"resolved", "false_positive"}:
        update.update({"closed_at": now, "closed_by": technician_name})
    await db.nexus_shield_xdr_cases.update_one({"id": case_id}, {"$set": update, "$push": {"events": event}})
    await log_activity(
        current_user,
        "shield_xdr_case_updated",
        "nexus_shield_xdr_case",
        case_id,
        existing.get("title") or "XDR investigation",
        f"Updated XDR investigation from {existing.get('status')} to {status}",
        metadata={"status": status, "previous_status": existing.get("status"), "external_changes": False},
    )
    updated = await db.nexus_shield_xdr_cases.find_one({"id": case_id}, {"_id": 0})
    return {"message": "XDR investigation updated", "case": updated}


@router.get("/nexus-shield/policies")
async def get_nexus_shield_policies(current_user: dict = Depends(get_current_user)):
    return {"policies": await _get_policies(), **(await _get_policy_metadata())}


@router.put("/nexus-shield/policies")
async def update_nexus_shield_policies(data: dict[str, Any], current_user: dict = Depends(get_current_user)):
    incoming = data.get("policies") or []
    if not isinstance(incoming, list):
        raise HTTPException(status_code=422, detail="Policies must be provided as a list")
    valid_ids = {policy["id"] for policy in DEFAULT_POLICIES}
    incoming_ids = [item.get("id") for item in incoming if isinstance(item, dict)]
    if len(incoming_ids) != len(set(incoming_ids)) or set(incoming_ids) != valid_ids:
        raise HTTPException(status_code=422, detail="Submit the complete Nexus Shield policy set without duplicate controls")
    for item in incoming:
        client_ids = item.get("client_ids") or []
        if not isinstance(client_ids, list) or any(not isinstance(client_id, str) for client_id in client_ids):
            raise HTTPException(status_code=422, detail=f"Client scope for {item.get('id')} must be a list of client IDs")

    requested_client_ids = {
        client_id
        for item in incoming
        for client_id in (item.get("client_ids") or [])
        if isinstance(client_id, str) and client_id.strip()
    }
    if requested_client_ids:
        existing_clients = await db.clients.find(
            {"id": {"$in": list(requested_client_ids)}}, {"_id": 0, "id": 1}
        ).to_list(len(requested_client_ids))
        missing_clients = requested_client_ids - {client.get("id") for client in existing_clients}
        if missing_clients:
            raise HTTPException(status_code=422, detail="One or more selected clients no longer exist")

    existing_policies = {policy["id"]: policy for policy in await _get_policies()}
    updates: list[dict[str, Any]] = []
    for item in incoming:
        if not isinstance(item, dict) or item.get("id") not in valid_ids:
            raise HTTPException(status_code=422, detail="One or more Nexus Shield policies are invalid")
        severity = item.get("severity")
        scope_mode = item.get("scope_mode")
        client_ids = list(dict.fromkeys(item.get("client_ids") or []))
        if severity not in POLICY_SEVERITIES:
            raise HTTPException(status_code=422, detail=f"Select a valid severity for {item['id']}")
        if scope_mode not in POLICY_SCOPE_MODES:
            raise HTTPException(status_code=422, detail=f"Select a valid customer scope for {item['id']}")
        if scope_mode == "selected_clients" and not client_ids:
            raise HTTPException(status_code=422, detail=f"Choose at least one client for {item['id']}")
        update = {
            "id": item["id"],
            "enabled": bool(item.get("enabled")),
            "severity": severity,
            "scope_mode": scope_mode,
            "client_ids": client_ids if scope_mode == "selected_clients" else [],
        }
        if item["id"] == "patch_exposure":
            try:
                threshold = int(item.get("threshold"))
            except (TypeError, ValueError):
                raise HTTPException(status_code=422, detail="Patch exposure threshold must be a whole number") from None
            if threshold < 1 or threshold > 500:
                raise HTTPException(status_code=422, detail="Patch exposure threshold must be between 1 and 500")
            update["threshold"] = threshold
        updates.append(update)

    audited_fields = ("enabled", "severity", "scope_mode", "client_ids", "threshold")
    changed_controls = []
    for policy in updates:
        previous = existing_policies.get(policy["id"], {})
        changed_fields = [
            field for field in audited_fields
            if field in policy and policy.get(field) != previous.get(field)
        ]
        if changed_fields:
            changed_controls.append({"id": policy["id"], "fields": changed_fields})

    updated_at = _now()
    updated_by = current_user.get("name") or current_user.get("email") or "Authenticated technician"
    await db.settings.update_one(
        {"key": POLICY_KEY},
        {"$set": {
            "key": POLICY_KEY,
            "value": {"policies": updates},
            "updated_at": updated_at,
            "updated_by": current_user.get("id"),
            "updated_by_name": updated_by,
        }},
        upsert=True,
    )
    await log_activity(
        current_user,
        "shield_policies_updated",
        "nexus_shield",
        POLICY_KEY,
        "Nexus Shield monitoring policies",
        f"Updated {len(updates)} endpoint monitoring controls",
        metadata={
            "active_controls": sum(1 for policy in updates if policy.get("enabled")),
            "scoped_controls": sum(1 for policy in updates if policy.get("scope_mode") == "selected_clients"),
            "changed_control_count": len(changed_controls),
            "changed_controls": changed_controls,
            "external_changes": False,
        },
    )
    return {
        "message": "Nexus Shield monitoring policies saved",
        "policies": await _get_policies(),
        "updated_at": updated_at,
        "updated_by": updated_by,
        "changed_controls": len(changed_controls),
    }
