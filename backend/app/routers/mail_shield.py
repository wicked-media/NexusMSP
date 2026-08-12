"""Nexus Mail Shield: evidence-first Microsoft 365 mail-risk control plane.

This is deliberately a monitor-only foundation.  It accepts normalised evidence
from an authorised synchroniser and gives technicians explainable triage.  It
does not claim to scan mail or alter a mailbox until a verified connector and
an explicit approved response action exist.
"""

from datetime import datetime, timezone
from typing import Any
import uuid
import re

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import get_current_user
from app.database import db
from app.services.activity import log_activity
from app.services.scope_permissions import assert_client_scope, effective_scope, scoped_query


router = APIRouter()
OPEN_STATUSES = {"new", "investigating", "contained"}
SEVERITIES = {"critical", "high", "medium", "low"}
SIGNAL_TYPES = {"phishing", "bec", "impersonation", "malicious_url", "malicious_attachment", "mailbox_rule", "spoofing"}
CLIENT_ID_RE = re.compile(r"^[0-9a-fA-F-]{36}$")
POLICY_PACKS = {
    "baseline": {
        "name": "Nexus baseline",
        "description": "High-confidence phishing, impersonation and suspicious mailbox-rule evidence.",
        "signals": ["phishing", "impersonation", "mailbox_rule", "spoofing"],
        "minimum_severity": "medium",
    },
    "finance_guard": {
        "name": "Finance Guard",
        "description": "Business-email-compromise and payment-change evidence for approved finance mailboxes.",
        "signals": ["bec", "impersonation", "malicious_url", "mailbox_rule"],
        "minimum_severity": "low",
    },
    "executive_watch": {
        "name": "Executive Watch",
        "description": "Priority review for impersonation, look-alike domains and risky mailbox-rule changes.",
        "signals": ["impersonation", "spoofing", "mailbox_rule", "bec"],
        "minimum_severity": "low",
    },
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _severity(value: Any) -> str:
    return str(value or "medium").strip().lower() if str(value or "medium").strip().lower() in SEVERITIES else "medium"


async def _overview(current_user: dict, client_id: str = "") -> dict[str, Any]:
    if client_id:
        await assert_client_scope(current_user, client_id, operation="mail_shield_overview")
    query = scoped_query(current_user, {"client_id": client_id} if client_id else {})
    signals = await db.nexus_mail_shield_signals.find(query, {"_id": 0}).sort("observed_at", -1).to_list(500)
    tenants = await db.m365_tenants.find({"source": {"$in": ["m365_graph", "m365_partner_center"]}}, {"_id": 0, "id": 1, "name": 1, "client_id": 1, "graph_verified": 1}).to_list(500)
    allowed_tenants = [tenant for tenant in tenants if not client_id or str(tenant.get("client_id") or "") == client_id]
    verified_tenants = [tenant for tenant in allowed_tenants if tenant.get("graph_verified")]
    open_signals = [signal for signal in signals if str(signal.get("status") or "new").lower() in OPEN_STATUSES]
    critical = sum(1 for signal in open_signals if signal.get("severity") == "critical")
    high = sum(1 for signal in open_signals if signal.get("severity") == "high")
    protected_mailboxes = len({str(signal.get("recipient") or signal.get("mailbox") or "") for signal in signals if signal.get("recipient") or signal.get("mailbox")})
    score = max(0, 100 - critical * 28 - high * 14 - sum(6 for signal in open_signals if signal.get("severity") == "medium")) if verified_tenants else None
    by_type: dict[str, int] = {}
    for signal in open_signals:
        key = str(signal.get("signal_type") or "other")
        by_type[key] = by_type.get(key, 0) + 1
    return {
        "connection": {
            "mode": "monitor_only",
            "verified_tenants": len(verified_tenants),
            "tenant_count": len(allowed_tenants),
            "ready": bool(verified_tenants),
            "next_step": "Connect and verify Microsoft Graph mail evidence before treating Mail Shield as protective coverage.",
        },
        "confidence": {
            "score": score,
            "label": "Not assessed" if score is None else "Strong" if score >= 90 else "Good" if score >= 75 else "Needs attention" if score >= 50 else "At risk",
            "evidence_note": "Mail confidence is calculated only from verified tenant connection and persisted Mail Shield evidence. No signal is not a claim that mail is safe.",
        },
        "summary": {"open": len(open_signals), "critical": critical, "high": high, "protected_mailboxes": protected_mailboxes},
        "signals": signals[:100],
        "by_type": by_type,
    }


@router.get("/mail-shield/overview")
async def get_mail_shield_overview(client_id: str = Query(default=""), current_user: dict = Depends(get_current_user)):
    return await _overview(current_user, client_id)


@router.get("/mail-shield/connector-settings")
async def get_mail_shield_connector_settings(current_user: dict = Depends(get_current_user)):
    record = await db.nexus_mail_shield_connector_settings.find_one({"id": "global"}, {"_id": 0}) or {}
    return {"callback_url": record.get("callback_url", ""), "application_id": record.get("application_id", ""), "configured": bool(record.get("application_id") and record.get("callback_url") and record.get("secret_present")), "secret_present": bool(record.get("secret_present")), "required_permissions": ["Mail.Read (application)", "MailboxSettings.Read (application)"], "boundary": "Monitor-only evidence connector. Mail.ReadWrite is not requested or stored."}


@router.put("/mail-shield/connector-settings")
async def save_mail_shield_connector_settings(data: dict[str, Any], current_user: dict = Depends(get_current_user)):
    callback_url = str(data.get("callback_url") or "").strip()
    application_id = str(data.get("application_id") or "").strip()
    secret = str(data.get("client_secret") or "").strip()
    if callback_url and not callback_url.startswith("https://"):
        raise HTTPException(status_code=422, detail="Use an HTTPS callback URL for the Microsoft evidence connector")
    if application_id and not CLIENT_ID_RE.fullmatch(application_id):
        raise HTTPException(status_code=422, detail="Application ID must be a Microsoft Entra application GUID")
    existing = await db.nexus_mail_shield_connector_settings.find_one({"id": "global"}, {"_id": 0}) or {}
    now = _now()
    if secret:
        raise HTTPException(status_code=422, detail="Store the client secret in the deployment secret store as NEXUS_MAIL_SHIELD_CLIENT_SECRET; Nexus does not persist connector secrets in workflow settings")
    record = {"id": "global", "callback_url": callback_url, "application_id": application_id, "secret_present": bool(os.getenv("NEXUS_MAIL_SHIELD_CLIENT_SECRET", "")), "updated_at": now, "updated_by": current_user.get("name") or current_user.get("email") or "Authenticated technician"}
    await db.nexus_mail_shield_connector_settings.update_one({"id": "global"}, {"$set": record, "$setOnInsert": {"created_at": now}}, upsert=True)
    return {"message": "Mail Shield connector configuration saved. Complete Microsoft consent before activating tenant evidence.", "configured": bool(record["application_id"] and record["callback_url"] and record["secret_present"])}


@router.get("/mail-shield/connections")
async def list_mail_shield_connections(current_user: dict = Depends(get_current_user)):
    """Return verified Microsoft tenants alongside their Mail Shield setup state.

    A saved setup is deliberately not reported as active coverage until a
    dedicated Graph synchroniser has written verified mail evidence.
    """
    scope = effective_scope(current_user)
    tenants = await db.m365_tenants.find({"source": {"$in": ["m365_graph", "m365_partner_center"]}, "graph_verified": True}, {"_id": 0, "id": 1, "tenant_id": 1, "name": 1, "domain": 1, "client_id": 1}).sort("name", 1).to_list(1000)
    if scope["mode"] != "all":
        tenants = [tenant for tenant in tenants if str(tenant.get("client_id") or "") in scope["client_ids"]]
    configs = await db.nexus_mail_shield_connections.find(scoped_query(current_user), {"_id": 0}).to_list(1000)
    by_tenant = {str(item.get("tenant_id")): item for item in configs if item.get("tenant_id")}
    rows = []
    for tenant in tenants:
        tenant_id = str(tenant.get("tenant_id") or tenant.get("id") or "")
        config = by_tenant.get(tenant_id) or {}
        rows.append({
            "tenant_id": tenant_id, "tenant_name": tenant.get("name") or tenant_id,
            "domain": tenant.get("domain") or "", "client_id": tenant.get("client_id") or "",
            "connection_id": config.get("id"), "mode": config.get("mode") or "not_configured",
            "mailbox_scope": config.get("mailbox_scope"), "mailboxes": config.get("mailboxes") or [],
            "consent_confirmed": bool(config.get("consent_confirmed")),
            "webhook_verified": bool(config.get("webhook_verified")),
            "status": "evidence_active" if config.get("webhook_verified") else "setup_saved" if config else "not_configured",
            "updated_at": config.get("updated_at"),
        })
    return {"connections": rows, "required_permissions": ["Mail.Read (application) for Graph message notifications", "MailboxSettings.Read (application) for read-only mailbox posture"], "future_approval_permission": "Mail.ReadWrite is not requested for monitor-only onboarding; it is required only for a separately approved mailbox remediation capability."}


@router.put("/mail-shield/connections/{tenant_id}")
async def configure_mail_shield_connection(tenant_id: str, data: dict[str, Any], current_user: dict = Depends(get_current_user)):
    tenant = await db.m365_tenants.find_one({"$and": [{"source": {"$in": ["m365_graph", "m365_partner_center"]}}, {"graph_verified": True}, {"$or": [{"tenant_id": tenant_id}, {"id": tenant_id}]}]}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="A verified Microsoft tenant is required before Mail Shield can be configured")
    client_id = str(tenant.get("client_id") or "").strip()
    if not client_id:
        raise HTTPException(status_code=422, detail="Map this Microsoft tenant to a Nexus client before configuring Mail Shield")
    await assert_client_scope(current_user, client_id, operation="configure_mail_shield_connection")
    mailbox_scope = str(data.get("mailbox_scope") or "").strip().lower()
    mailboxes = [str(value).strip().lower() for value in (data.get("mailboxes") or []) if str(value).strip()]
    if mailbox_scope not in {"pilot_mailboxes", "all_mailboxes"}:
        raise HTTPException(status_code=422, detail="Choose a pilot-mailbox or all-mailbox monitor scope")
    if mailbox_scope == "pilot_mailboxes" and not mailboxes:
        raise HTTPException(status_code=422, detail="Add at least one pilot mailbox before enabling a pilot")
    if not bool(data.get("consent_confirmed")):
        raise HTTPException(status_code=422, detail="Confirm tenant-admin consent and mailbox scope before saving Mail Shield setup")
    now = _now()
    existing = await db.nexus_mail_shield_connections.find_one({"tenant_id": str(tenant.get("tenant_id") or tenant.get("id"))}, {"_id": 0, "id": 1})
    record = {
        "id": (existing or {}).get("id") or f"mail-connection-{uuid.uuid4().hex[:12]}", "tenant_id": str(tenant.get("tenant_id") or tenant.get("id")),
        "tenant_name": tenant.get("name") or tenant_id, "client_id": client_id,
        "mode": "monitor_only", "mailbox_scope": mailbox_scope,
        "mailboxes": mailboxes if mailbox_scope == "pilot_mailboxes" else [],
        "consent_confirmed": True, "webhook_verified": False,
        "permissions": ["Mail.Read", "MailboxSettings.Read"], "updated_at": now,
        "updated_by": current_user.get("name") or current_user.get("email") or "Authenticated technician",
    }
    await db.nexus_mail_shield_connections.update_one({"tenant_id": record["tenant_id"]}, {"$set": record, "$setOnInsert": {"created_at": now}}, upsert=True)
    await log_activity(current_user, "mail_shield_connection_configured", "nexus_mail_shield_connection", record["id"], record["tenant_name"], f"Saved monitor-only Mail Shield setup for {mailbox_scope}", metadata={"client_id": client_id, "tenant_id": record["tenant_id"], "external_changes": False})
    return {"message": "Monitor-only Mail Shield setup saved. Connector evidence is still required before coverage becomes active.", "connection": record}


@router.post("/mail-shield/connections/{tenant_id}/verify-evidence")
async def verify_mail_shield_evidence_connection(tenant_id: str, data: dict[str, Any], current_user: dict = Depends(get_current_user)):
    """Record a completed Graph/webhook verification; no mailbox access is performed here."""
    connection = await db.nexus_mail_shield_connections.find_one({"tenant_id": tenant_id}, {"_id": 0})
    if not connection:
        raise HTTPException(status_code=404, detail="Save Mail Shield monitor scope before verifying evidence delivery")
    await assert_client_scope(current_user, connection.get("client_id"), operation="verify_mail_shield_evidence_connection")
    verification_id = str(data.get("verification_id") or "").strip()
    if len(verification_id) < 8:
        raise HTTPException(status_code=422, detail="Record the verified Graph subscription or webhook reference")
    now = _now()
    await db.nexus_mail_shield_connections.update_one({"tenant_id": tenant_id}, {"$set": {"webhook_verified": True, "verification_id": verification_id, "verified_at": now, "updated_at": now}})
    return {"message": "Mail Shield evidence connection verified. Mailbox remediation is still not enabled."}


@router.get("/mail-shield/policies")
async def list_mail_shield_policies(client_id: str = Query(default=""), current_user: dict = Depends(get_current_user)):
    if client_id:
        await assert_client_scope(current_user, client_id, operation="mail_shield_policies")
    query = scoped_query(current_user, {"client_id": client_id} if client_id else {})
    policies = await db.nexus_mail_shield_policies.find(query, {"_id": 0}).sort("updated_at", -1).to_list(500)
    return {
        "policy_packs": [{"id": key, **value} for key, value in POLICY_PACKS.items()],
        "policies": policies,
        "enforcement_boundary": "Policies classify and route evidence only. They cannot quarantine, delete, release, forward, disable accounts, or alter mailbox rules.",
    }


@router.put("/mail-shield/policies/{policy_id}")
async def save_mail_shield_policy(policy_id: str, data: dict[str, Any], current_user: dict = Depends(get_current_user)):
    client_id = str(data.get("client_id") or "").strip()
    pack_id = str(data.get("pack_id") or "").strip()
    if not client_id or pack_id not in POLICY_PACKS:
        raise HTTPException(status_code=422, detail="Choose a client and a supported Nexus Mail Shield policy pack")
    await assert_client_scope(current_user, client_id, operation="save_mail_shield_policy")
    mode = str(data.get("mode") or "monitor_only").strip().lower()
    if mode not in {"monitor_only", "ticket_on_high", "approval_required"}:
        raise HTTPException(status_code=422, detail="Policy mode must be monitor-only, ticket-on-high or approval-required")
    requested_signals = [str(value).strip().lower() for value in (data.get("signals") or POLICY_PACKS[pack_id]["signals"]) if str(value).strip().lower() in SIGNAL_TYPES]
    if not requested_signals:
        raise HTTPException(status_code=422, detail="A Mail Shield policy requires at least one supported evidence signal")
    now = _now()
    existing = await db.nexus_mail_shield_policies.find_one({"id": policy_id}, {"_id": 0, "id": 1, "created_at": 1})
    record = {
        "id": (existing or {}).get("id") or policy_id,
        "client_id": client_id,
        "name": str(data.get("name") or POLICY_PACKS[pack_id]["name"]).strip() or POLICY_PACKS[pack_id]["name"],
        "pack_id": pack_id,
        "mode": mode,
        "signals": sorted(set(requested_signals)),
        "minimum_severity": _severity(data.get("minimum_severity") or POLICY_PACKS[pack_id]["minimum_severity"]),
        "approved_mailboxes": [str(value).strip().lower() for value in (data.get("approved_mailboxes") or []) if str(value).strip()],
        "enabled": bool(data.get("enabled", True)),
        "updated_at": now,
        "updated_by": current_user.get("name") or current_user.get("email") or "Authenticated technician",
        "action_boundary": "Evidence classification and approved routing only; no external mailbox action is permitted by this policy.",
    }
    await db.nexus_mail_shield_policies.update_one({"id": record["id"]}, {"$set": record, "$setOnInsert": {"created_at": now}}, upsert=True)
    await log_activity(current_user, "mail_shield_policy_saved", "nexus_mail_shield_policy", record["id"], record["name"], f"Saved {mode} Mail Shield policy", metadata={"client_id": client_id, "pack_id": pack_id, "external_changes": False})
    return {"message": "Mail Shield policy saved. It has no authority to change a mailbox.", "policy": record}


@router.post("/mail-shield/signals")
async def ingest_mail_shield_signal(data: dict[str, Any], current_user: dict = Depends(get_current_user)):
    """Persist normalised connector evidence; this endpoint does not execute mail actions."""
    client_id = str(data.get("client_id") or "").strip()
    signal_type = str(data.get("signal_type") or "").strip().lower()
    title = str(data.get("title") or "").strip()
    if not client_id or signal_type not in SIGNAL_TYPES or not title:
        raise HTTPException(status_code=422, detail="Client, supported signal type and evidence title are required")
    await assert_client_scope(current_user, client_id, operation="ingest_mail_shield_signal")
    now = _now()
    record = {
        "id": f"mail-signal-{uuid.uuid4().hex[:12]}", "client_id": client_id,
        "client_name": str(data.get("client_name") or ""), "tenant_id": str(data.get("tenant_id") or ""),
        "signal_type": signal_type, "severity": _severity(data.get("severity")), "title": title,
        "summary": str(data.get("summary") or "Persisted Nexus Mail Shield evidence."),
        "sender": str(data.get("sender") or ""), "recipient": str(data.get("recipient") or ""),
        "mailbox": str(data.get("mailbox") or ""), "message_id": str(data.get("message_id") or ""),
        "source": str(data.get("source") or "nexus_mail_shield_connector"), "status": "new",
        "observed_at": str(data.get("observed_at") or now), "created_at": now, "updated_at": now,
        "evidence": data.get("evidence") if isinstance(data.get("evidence"), list) else [],
        "events": [{"type": "signal_ingested", "note": "Persisted monitor-only mail evidence.", "at": now, "technician_name": current_user.get("name") or current_user.get("email") or "Nexus connector"}],
    }
    await db.nexus_mail_shield_signals.insert_one(record.copy())
    await log_activity(current_user, "mail_shield_signal_ingested", "nexus_mail_shield_signal", record["id"], title, f"Recorded {signal_type} mail-security evidence", metadata={"client_id": client_id, "external_changes": False})
    record.pop("_id", None)
    return {"message": "Mail Shield evidence recorded", "signal": record}


@router.patch("/mail-shield/signals/{signal_id}")
async def triage_mail_shield_signal(signal_id: str, data: dict[str, Any], current_user: dict = Depends(get_current_user)):
    existing = await db.nexus_mail_shield_signals.find_one({"id": signal_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Mail Shield signal not found")
    await assert_client_scope(current_user, existing.get("client_id"), operation="triage_mail_shield_signal")
    status = str(data.get("status") or "").strip().lower()
    note = str(data.get("note") or "").strip()
    if status not in {"new", "investigating", "contained", "resolved", "false_positive"} or not note:
        raise HTTPException(status_code=422, detail="Choose a valid status and record a triage decision")
    now = _now()
    event = {"type": "triage_updated", "status": status, "note": note, "at": now, "technician_name": current_user.get("name") or current_user.get("email") or "Authenticated technician"}
    await db.nexus_mail_shield_signals.update_one({"id": signal_id}, {"$set": {"status": status, "updated_at": now}, "$push": {"events": event}})
    await log_activity(current_user, "mail_shield_signal_triaged", "nexus_mail_shield_signal", signal_id, existing.get("title") or "Mail Shield signal", f"Updated mail-security signal to {status}", metadata={"client_id": existing.get("client_id"), "external_changes": False})
    updated = await db.nexus_mail_shield_signals.find_one({"id": signal_id}, {"_id": 0})
    return {"message": "Mail Shield triage recorded", "signal": updated}


@router.post("/mail-shield/signals/{signal_id}/ticket")
async def create_mail_shield_incident_ticket(signal_id: str, data: dict[str, Any], current_user: dict = Depends(get_current_user)):
    """Create exactly one auditable incident ticket from persisted mail evidence.

    This creates an internal Nexus work item only. It never takes a mailbox,
    account, forwarding rule, or message action on a technician's behalf.
    """
    signal = await db.nexus_mail_shield_signals.find_one({"id": signal_id}, {"_id": 0})
    if not signal:
        raise HTTPException(status_code=404, detail="Mail Shield signal not found")
    client_id = str(signal.get("client_id") or "").strip()
    if not client_id:
        raise HTTPException(status_code=422, detail="Map this evidence to a Nexus client before creating an incident ticket")
    await assert_client_scope(current_user, client_id, operation="create_mail_shield_incident_ticket")
    if signal.get("ticket_id"):
        existing = await db.tickets.find_one({"id": signal["ticket_id"]}, {"_id": 0, "id": 1, "ticket_number": 1})
        if existing:
            return {"message": "An incident ticket is already linked", "ticket": existing, "existing": True}

    from app.routers.ticket_suggestions import generate_ticket_number

    now = _now()
    ticket_id = f"mail-shield-ticket-{uuid.uuid4().hex[:12]}"
    ticket_number = await generate_ticket_number("incident")
    evidence_lines = [
        f"Nexus Mail Shield evidence: {signal.get('title') or 'Mail-security signal'}",
        signal.get("summary") or "",
        "",
        f"Signal type: {signal.get('signal_type') or 'mail risk'}",
        f"Severity: {signal.get('severity') or 'medium'}",
        f"Source: {signal.get('source') or 'Nexus Mail Shield'}",
        f"Sender: {signal.get('sender') or 'Not recorded'}",
        f"Recipient: {signal.get('recipient') or signal.get('mailbox') or 'Not recorded'}",
        f"Observed: {signal.get('observed_at') or now}",
        "",
        "Response boundary: validate and perform approved containment in the authoritative Microsoft tool. This ticket creation did not alter any mailbox.",
        f"Mail Shield record: {signal_id}",
    ]
    ticket = {
        "id": ticket_id,
        "ticket_number": ticket_number,
        "title": f"[Mail Shield] {signal.get('title') or 'Mail-security incident'}",
        "description": "\n".join(evidence_lines),
        "client_id": client_id,
        "client_name": signal.get("client_name"),
        "status": "open",
        "priority": signal.get("severity") if signal.get("severity") in {"critical", "high", "medium", "low"} else "high",
        "category": "security",
        "ticket_type": "incident",
        "source": "nexus_mail_shield",
        "nexus_mail_shield_signal_id": signal_id,
        "created_at": now,
        "updated_at": now,
        "created_by": current_user.get("name") or current_user.get("email") or "Nexus Mail Shield",
    }
    await db.tickets.insert_one(ticket.copy())
    event = {
        "type": "incident_ticket_created",
        "note": str(data.get("note") or f"Created linked incident ticket {ticket_number}."),
        "at": now,
        "technician_id": str(current_user.get("id") or ""),
        "technician_name": str(current_user.get("name") or current_user.get("email") or "Authenticated technician"),
        "ticket_id": ticket_id,
        "ticket_number": ticket_number,
    }
    await db.nexus_mail_shield_signals.update_one({"id": signal_id}, {"$set": {"ticket_id": ticket_id, "ticket_number": ticket_number, "updated_at": now}, "$push": {"events": event}})
    await log_activity(current_user, "mail_shield_incident_ticket_created", "nexus_mail_shield_signal", signal_id, signal.get("title") or "Mail Shield signal", f"Created linked incident ticket {ticket_number}", metadata={"client_id": client_id, "ticket_id": ticket_id, "ticket_number": ticket_number, "external_changes": False})
    return {"message": "Linked Mail Shield incident ticket created", "ticket": {"id": ticket_id, "ticket_number": ticket_number}, "existing": False}
