"""The operating layer: consequence models, the commander, and commercial memory.

Distinct from ``nexus_brain`` (Mission Control's deterministic briefing engine).
The Consequence Engine answers what an action *means* to the business before it
happens; Morning Commander / End My Day decide what matters; the decision log
and risk acceptances are the MSP's collective memory. Everything derives from
authoritative records and is honest about missing evidence.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from app.services import nexus_certainty, nexus_insight
from app.services.scope_permissions import platform_tenant_id, tenant_scoped_query


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat()


def _parse_iso(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


# ============== NEXUS CONSEQUENCE ENGINE ==============


async def consequence_model(db: Any, user: dict, payload: dict) -> dict:
    """Before any action: what does clicking this button mean to the business?"""
    action_type = str(payload.get("action_type") or "").strip().lower()
    target_id = str(payload.get("target_id") or "").strip()
    destructive = bool(payload.get("destructive"))
    if not target_id:
        return {"found": False, "error": "target_id is required"}

    device = await db.devices.find_one(tenant_scoped_query(user, {"id": target_id}), {"_id": 0})
    client = None
    if not device:
        client = await db.clients.find_one(
            tenant_scoped_query(user, {"$or": [{"id": target_id}, {"name": target_id}]}), {"_id": 0})
    if not device and not client:
        return {"found": False}

    client_id = (device or client).get("client_id") or (client or {}).get("id")
    client_name = (device or client).get("client_name") or (client or {}).get("name") or client_id
    target_name = (device or {}).get("hostname") or (device or {}).get("name") or target_id

    open_tickets = await db.tickets.find(
        tenant_scoped_query(user, {**({"client_id": client_id} if client_id else {}),
                                   "status": {"$nin": ["resolved", "closed"]}}),
        {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "priority": 1, "device_id": 1},
    ).limit(20).to_list(20)
    direct_incidents = [t for t in open_tickets if device and t.get("device_id") == target_id]
    criticals = [t for t in open_tickets if str(t.get("priority") or "").lower() in {"critical", "high"}]

    contracts = await db.contracts.find(
        tenant_scoped_query(user, {"client_id": client_id} if client_id else {}), {"_id": 0}).to_list(10)
    monthly_value = 0.0
    for contract in contracts:
        try:
            value = float(contract.get("value") or 0)
        except (TypeError, ValueError):
            value = 0.0
        monthly_value += value / 12.0 if contract.get("billing_frequency") == "annual" else value

    backup_events = 0
    restore_events = 0
    if device:
        backup_events = await db.device_events.count_documents(
            tenant_scoped_query(user, {"device_id": target_id, "event_type": "backup_completed"}))
        restore_events = await db.device_events.count_documents(
            tenant_scoped_query(user, {"device_id": target_id,
                                       "event_type": {"$in": ["restore_verified", "restore_tested"]}}))

    warranty = _parse_iso((device or {}).get("warranty_expiry"))
    recovery = []
    if backup_events:
        recovery.append(f"{backup_events} backup event(s) on record"
                        + (" — recoverability proven by restore tests." if restore_events
                           else " — but NO restore verification. Treat as unprotected."))
    else:
        recovery.append("No backup evidence for this target.")
    if warranty and warranty >= _utcnow():
        recovery.append(f"In warranty until {warranty.date().isoformat()} — replacement path exists.")
    elif device:
        recovery.append("Out of warranty — replacement path is a purchase, not a swap.")

    security = []
    blob = f"{action_type} {target_name}".lower()
    if any(word in blob for word in ("firewall", "credential", "password", "mfa", "account", "permission", "disable")):
        security.append("This action touches security-relevant surface — credential or access implications must be reviewed.")
    if device and any(m in f"{(device or {}).get('os') or ''}".lower() for m in nexus_certainty.LEGACY_OS_MARKERS):
        security.append("Target runs an out-of-support operating system — security exceptions apply.")

    law_gate = await nexus_certainty.evaluate_action(db, user, {
        "action_type": action_type, "target": target_name, "destructive": destructive,
        "recoverability_evidence": bool(restore_events), "autonomous": bool(payload.get("autonomous")),
        "verification_planned": bool(payload.get("verification_planned", True)),
    })

    severity = min(100, round(
        len(criticals) * 20 + min(30, monthly_value / 100.0)
        + (15 if (device and backup_events and not restore_events) else 0) + (10 if destructive else 0)))
    band = "critical" if severity >= 70 else "high" if severity >= 45 else "moderate" if severity >= 20 else "low"

    services = sorted({str(t.get("title") or "").split(" — ")[0] for t in open_tickets})[:5]
    return {
        "found": True,
        "action_type": action_type,
        "target": target_name,
        "client_name": client_name,
        "technical_dependencies": {
            "open_incidents_on_target": [t.get("ticket_number") for t in direct_incidents],
            "open_incidents_at_customer": len(open_tickets),
        },
        "users_affected": {
            "assigned_user": (device or {}).get("assigned_user") or (device or {}).get("owner") or "Unknown",
            "note": (f"{len(open_tickets)} open ticket(s) at {client_name} indicate the human surface of this change."
                     if open_tickets else "No open tickets — impact surface looks quiet."),
        },
        "business_services": services or ["No service labels derivable from live records."],
        "security_implications": security or ["No security-sensitive surface detected for this action."],
        "billing_implications": (f"{client_name} agreement(s) worth ~${monthly_value:,.0f}/month sit behind this target."
                                 if monthly_value else "No agreement value on file for this customer."),
        "active_incidents": [{"number": t.get("ticket_number"), "title": t.get("title"), "priority": t.get("priority")}
                             for t in (direct_incidents or open_tickets)[:5]],
        "recovery_options": recovery,
        "law_gate": law_gate,
        "severity": severity,
        "severity_band": band,
        "verdict": (f"'{action_type or 'action'}' on {target_name} touches {len(direct_incidents)} direct and "
                    f"{len(open_tickets)} customer-wide open incident(s) behind a "
                    f"${monthly_value:,.0f}/month relationship. Consequence severity: {band} ({severity}/100)."),
    }


# ============== MORNING COMMANDER / END MY DAY ==============


async def morning_commander(db: Any, user: dict, name: str) -> dict:
    """Not another dashboard. Nexus decides what matters today."""
    now = _utcnow()
    overnight = _iso(now - timedelta(hours=12))
    devices = await db.devices.find(tenant_scoped_query(user, {}), {"_id": 0}).limit(500).to_list(500)
    clients = await db.clients.find(tenant_scoped_query(user, {}), {"_id": 0}).limit(200).to_list(200)

    handled = await db.activity_logs.count_documents(tenant_scoped_query(user, {
        "created_at": {"$gte": overnight},
        "action": {"$regex": "auto|agent|workflow|heal"},
    }))

    attention: list[dict] = []

    # 1. Backup recoverability gaps (client level).
    backups = await db.device_events.find(
        tenant_scoped_query(user, {"event_type": "backup_completed"}), {"_id": 0}).limit(500).to_list(500)
    restores = await db.device_events.count_documents(
        tenant_scoped_query(user, {"event_type": {"$in": ["restore_verified", "restore_tested"]}}))
    if backups and not restores:
        by_client: dict[str, int] = {}
        for row in backups:
            dev = next((d for d in devices if d.get("id") == row.get("device_id")), None)
            key = (dev or {}).get("client_name") or (dev or {}).get("client_id") or "unknown"
            by_client[key] = by_client.get(key, 0) + 1
        for client_name, count in sorted(by_client.items(), key=lambda kv: -kv[1])[:1]:
            attention.append({"rank_hint": 1, "severity": "high",
                              "line": f"{client_name} — backup recoverability unverified ({count} backup(s), zero restore tests)"})

    # 2. Likely common-cause degradation from ticket correlation.
    correlated = await nexus_certainty.correlate_tickets(db, user)
    for cluster in correlated.get("clusters", [])[:1]:
        attention.append({"rank_hint": 2, "severity": "high",
                          "line": f"{cluster.get('client_name')} — likely {cluster.get('probable_common_cause')} degradation "
                                  f"({cluster.get('symptom_count')} correlated symptoms)"})

    # 3. Agreements losing money.
    for client in clients[:6]:
        margin = await nexus_insight.agreement_margin(db, user, client.get("id") or client.get("name") or "")
        if str(margin.get("verdict") or "").startswith("⚠"):
            attention.append({"rank_hint": 3, "severity": "high",
                              "line": f"{client.get('name')} — agreement losing money ({margin.get('verdict')})"})

    # 4. Certificates expiring within 14 days.
    for cert in await db.ssl_certificates.find(tenant_scoped_query(user, {}), {"_id": 0}).limit(100).to_list(100):
        expiry = _parse_iso(cert.get("expiry_date"))
        if expiry and 0 <= (expiry - now).days <= 14:
            attention.append({"rank_hint": 4, "severity": "medium",
                              "line": f"{cert.get('domain')} — firewall/certificate expires in {(expiry - now).days} days"})

    # 5. Customers waiting far too long.
    for ticket in await db.tickets.find(
        tenant_scoped_query(user, {"status": {"$nin": ["resolved", "closed"]}}), {"_id": 0}
    ).limit(300).to_list(300):
        created = _parse_iso(ticket.get("created_at"))
        if created and (now - created).total_seconds() > 16 * 3600:
            hours = round((now - created).total_seconds() / 3600)
            attention.append({"rank_hint": 5, "severity": "high",
                              "line": f"{ticket.get('ticket_number')} — customer waiting {hours} hours"})

    attention.sort(key=lambda item: (item["rank_hint"], item["severity"] != "high"))
    top = attention[:5]
    safe_stuff = [
        {"item": "Close stale alerts with no matching ticket after 7 days", "why_safe": "non-destructive, reversible, post-action verification planned"},
        {"item": "Regenerate documentation from live telemetry for stale objects", "why_safe": "machine-maintained facts only, human notes untouched"},
        {"item": "Refresh read-only compliance and certificate checks", "why_safe": "read-only scans, evidence-only writes"},
    ]
    return {
        "greeting": f"Good morning, {name.split()[0] if name else 'technician'}.",
        "estate": f"You manage {len(devices)} endpoints across {len(clients)} customers.",
        "overnight_handled": handled,
        "attention": top,
        "safe_stuff": safe_stuff,
        "safe_note": ("Handle My Safe Stuff executes only within the autonomy boundary: non-destructive, "
                      "reversible, post-action verified. Destructive or unverifiable items are never included."),
        "name_critic": await device_name_critic(db, user),
        "verdict": (f"Your attention is needed on {len(top)} thing(s). Everything else can wait."
                    if top else "Nothing needs you today. Enjoy the eerie calm."),
    }


async def end_my_day(db: Any, user: dict, name: str) -> dict:
    """The opposite of the commander: what must not be left behind."""
    now = _utcnow()
    today = _iso(now - timedelta(hours=24))
    tomorrow = (now + timedelta(days=1)).date().isoformat()

    checks: list[dict] = []
    warnings: list[dict] = []

    unattended = await db.tickets.find(
        tenant_scoped_query(user, {"status": {"$nin": ["resolved", "closed"]},
                                   "priority": {"$in": ["critical", "high"]}}), {"_id": 0}
    ).limit(50).to_list(50)
    unassigned = [t for t in unattended if not t.get("assigned_to")]
    checks.append({"label": "No critical incidents unattended", "ok": not unassigned,
                   "detail": f"{len(unassigned)} high/critical ticket(s) unassigned." if unassigned
                   else f"{len(unattended)} high/critical ticket(s) all have owners."})
    for ticket in unassigned[:3]:
        warnings.append({"kind": "unattended", "line": f"{ticket.get('ticket_number')} is {ticket.get('priority')} and unassigned.",
                         "actions": ["Deal With It", "Assign", "Tomorrow"]})

    waiting = [t for t in unattended
               if (now - (_parse_iso(t.get("created_at")) or now)).total_seconds() > 24 * 3600]
    checks.append({"label": "Customer callbacks completed", "ok": not waiting,
                   "detail": f"{len(waiting)} customer(s) waiting over 24h." if waiting
                   else "No customer has been waiting over a day."})

    remote = await db.work_activity_audit.find(
        tenant_scoped_query(user, {"work_item": "remote", "created_at": {"$gte": today}}), {"_id": 0}
    ).to_list(100)
    opened = sum(1 for r in remote if r.get("event") == "viewed")
    closed = sum(1 for r in remote if r.get("event") == "left")
    checks.append({"label": "Remote sessions closed", "ok": opened <= closed,
                   "detail": f"{opened} session(s) opened, {closed} closed today."})

    changes = await db.ticket_audit_log.count_documents(tenant_scoped_query(user, {"created_at": {"$gte": today}}))
    checks.append({"label": "Changes verified", "ok": changes == 0,
                   "detail": f"{changes} recorded change(s) today — confirm each did what it claimed." if changes
                   else "No changes recorded today."})
    if changes:
        warnings.append({"kind": "changes", "line": f"{changes} change(s) made today still need outcome verification.",
                         "actions": ["Deal With It", "Tomorrow"]})

    devices = await db.devices.find(tenant_scoped_query(user, {}), {"_id": 0}).limit(500).to_list(500)
    backups_today = await db.device_events.count_documents(
        tenant_scoped_query(user, {"event_type": "backup_completed", "timestamp": {"$gte": today}}))
    checks.append({"label": "Backups healthy", "ok": backups_today >= max(1, len(devices) // 2),
                   "detail": f"{backups_today} backup completion(s) for {len(devices)} device(s) in 24h."})

    promises = []
    for ticket in await db.tickets.find(
        tenant_scoped_query(user, {"status": {"$nin": ["resolved", "closed"]}, "due_date": {"$ne": None}}),
        {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "due_date": 1},
    ).limit(100).to_list(100):
        due = str(ticket.get("due_date") or "")[:10]
        if due and due <= tomorrow:
            promises.append({"ticket": ticket.get("ticket_number"), "title": ticket.get("title"), "due": due})
    if promises:
        warnings.append({"kind": "promise", "line": f"{len(promises)} promise(s) due within a day.",
                         "actions": ["Deal With It", "Assign", "Tomorrow"],
                         "promises": promises})

    return {
        "checks": checks,
        "warnings": warnings,
        "verdict": ("Before you finish — everything clean. Go home." if not warnings
                    else f"Before you finish — {len(warnings)} thing(s) need a decision tonight."),
    }


# ============== COMMERCIAL MEMORY: DECISIONS & RISK ACCEPTANCES ==============


async def record_decision(db: Any, user: dict, name: str, payload: dict) -> dict:
    """Not every important MSP decision is a configuration change. Remember why."""
    entry = {
        "id": str(uuid.uuid4()),
        "tenant_id": platform_tenant_id(user),
        "client_id": str(payload.get("client_id") or "")[:64],
        "device_id": str(payload.get("device_id") or "")[:64],
        "decision": str(payload.get("decision") or "").strip()[:300],
        "reason": str(payload.get("reason") or "").strip()[:1000],
        "risks_communicated": bool(payload.get("risks_communicated")),
        "customer_accepted_risk": bool(payload.get("customer_accepted_risk")),
        "review_date": str(payload.get("review_date") or "").strip()[:40],
        "status": "active",
        "created_by": user.get("id"),
        "created_by_name": name,
        "created_at": _iso(_utcnow()),
    }
    await db.nexus_decisions.insert_one(entry)
    entry.pop("_id", None)
    return entry


async def list_decisions(db: Any, user: dict, client_id: str | None = None) -> dict:
    query: dict = {"tenant_id": platform_tenant_id(user)}
    if client_id:
        query["client_id"] = client_id
    rows = await db.nexus_decisions.find(query, {"_id": 0}).sort("created_at", -1).limit(100).to_list(100)
    return {"count": len(rows), "decisions": rows[:50],
            "note": "Six months from now Nexus still knows why the recommendation wasn't followed."}


async def record_risk_acceptance(db: Any, user: dict, name: str, payload: dict) -> dict:
    """Risks must not disappear into ticket notes. Owner, expiry, compensating controls."""
    entry = {
        "id": str(uuid.uuid4()),
        "tenant_id": platform_tenant_id(user),
        "client_id": str(payload.get("client_id") or "")[:64],
        "device_id": str(payload.get("device_id") or "")[:64],
        "title": str(payload.get("title") or "").strip()[:200],
        "risk_owner": str(payload.get("risk_owner") or "").strip()[:120],
        "accepted_date": str(payload.get("accepted_date") or "").strip()[:40],
        "expires": str(payload.get("expires") or "").strip()[:40],
        "compensating_controls": str(payload.get("compensating_controls") or "").strip()[:500],
        "status": "accepted",
        "recorded_by": name,
        "created_at": _iso(_utcnow()),
    }
    await db.risk_acceptances.insert_one(entry)
    entry.pop("_id", None)
    return entry


async def list_risk_acceptances(db: Any, user: dict, client_id: str | None = None) -> dict:
    query: dict = {"tenant_id": platform_tenant_id(user), "status": {"$ne": "closed"}}
    if client_id:
        query["client_id"] = client_id
    rows = await db.risk_acceptances.find(query, {"_id": 0}).sort("created_at", -1).limit(100).to_list(100)
    today = _utcnow().date()
    for row in rows:
        expiry = _parse_iso(row.get("expires"))
        row["review_due"] = bool(expiry and (expiry.date() - today).days <= 14)
        row["days_to_expiry"] = (expiry.date() - today).days if expiry else None
    due = [r for r in rows if r.get("review_due")]
    return {"count": len(rows), "acceptances": rows[:50], "reviews_due": len(due),
            "verdict": (f"{len(due)} risk acceptance(s) need review within 14 days." if due
                        else "No risk reviews due. Accepted risks remain deliberate, not forgotten.")}


async def we_told_you(db: Any, user: dict, client_id: str | None = None, device_id: str | None = None) -> dict:
    """Prior Recommendation Evidence — not to gloat; commercial and liability context."""
    scope: dict = {"tenant_id": platform_tenant_id(user)}
    if client_id:
        scope["client_id"] = client_id
    if device_id:
        scope["device_id"] = device_id
    acceptances = await db.risk_acceptances.find(scope, {"_id": 0}).sort("created_at", -1).limit(50).to_list(50)
    decisions = await db.nexus_decisions.find(scope, {"_id": 0}).sort("created_at", -1).limit(50).to_list(50)

    ticket_query: dict = {"status": {"$nin": ["resolved", "closed"]}}
    if client_id:
        ticket_query["client_id"] = client_id
    if device_id:
        ticket_query["device_id"] = device_id
    incidents = await db.tickets.find(tenant_scoped_query(user, ticket_query), {"_id": 0}).limit(100).to_list(100)

    chain: list[dict] = []
    for acceptance in acceptances:
        since = _parse_iso(acceptance.get("accepted_date") or acceptance.get("created_at"))
        related = [t for t in incidents
                   if (not acceptance.get("device_id") or t.get("device_id") == acceptance.get("device_id"))
                   and (not since or (_parse_iso(t.get("created_at")) or since) >= since)]
        if related:
            chain.append({
                "recommendation": acceptance.get("title"),
                "accepted_risk": f"Accepted by {acceptance.get('risk_owner') or 'customer'} "
                                 f"until {acceptance.get('expires') or 'review'}",
                "compensating_controls": acceptance.get("compensating_controls"),
                "subsequent_incidents": [{"number": t.get("ticket_number"), "title": t.get("title")}
                                         for t in related[:3]],
            })
    for decision in decisions:
        if decision.get("customer_accepted_risk"):
            related = [t for t in incidents
                       if (not decision.get("device_id") or t.get("device_id") == decision.get("device_id"))]
            if related:
                chain.append({
                    "recommendation": decision.get("decision"),
                    "accepted_risk": f"Customer accepted risk: {decision.get('reason', '')[:120]}",
                    "compensating_controls": "Recorded in the decision log.",
                    "subsequent_incidents": [{"number": t.get("ticket_number"), "title": t.get("title")}
                                             for t in related[:3]],
                })
    return {
        "chain": chain,
        "internal_note": "Nexus remembers. 😏" if chain else "",
        "verdict": ("Prior Recommendation Evidence assembled: recommendation → quote/decision → accepted risk → "
                    "subsequent incident. Commercial and liability context, not a victory lap."
                    if chain else "No prior recommendations on record for this scope — Nexus has nothing to remember yet."),
    }


# ============== EGG: DEVICE NAME CRITIC ==============


async def device_name_critic(db: Any, user: dict) -> list[dict]:
    quips: list[dict] = []
    devices = await db.devices.find(tenant_scoped_query(user, {}), {"_id": 0}).limit(300).to_list(300)
    for device in devices:
        hostname = str(device.get("hostname") or device.get("name") or "")
        upper = hostname.upper()
        purchase = _parse_iso(device.get("purchase_date"))
        age_years = (_utcnow() - purchase).days / 365.0 if purchase else None
        if "NEW" in upper and age_years and age_years >= 2:
            quips.append({"device": hostname,
                          "quip": f"'{hostname}' was created {age_years:.0f} years ago. The term 'NEW' may no longer be technically accurate."})
        elif upper.endswith("-FINAL") or "_FINAL" in upper:
            quips.append({"device": hostname,
                          "quip": f"{hostname}: Nexus suspects history will prove otherwise."})
        elif upper.startswith("TEST") or "-TEST" in upper or "_TEST" in upper:
            criticals = await db.tickets.count_documents(tenant_scoped_query(user, {
                "device_id": device.get("id"), "status": {"$nin": ["resolved", "closed"]},
                "priority": {"$in": ["critical", "high"]}}))
            if criticals:
                quips.append({"device": hostname,
                              "quip": f"{hostname} is named like a test box but has {criticals} critical open ticket(s). Nexus has concerns."})
    return quips[:10]
