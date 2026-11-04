"""The certainty layer: unknowns, proof, confidence, and Nexus Laws.

Every claim here is derived from authoritative operational records and is
explicitly honest about evidence. Where no evidence source exists, Nexus says
"unverified" instead of pretending. Vendor success statuses are never treated
as proof of recoverability. One datum keeps one owner; this module only reads
except for the technician-curated ``nexus_laws`` registry.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from app.services.scope_permissions import platform_tenant_id, tenant_scoped_query

LEGACY_OS_MARKERS = ("xp", "vista", "windows 7", "server 2008", "server 2012")


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


def _days_since(value: Any) -> int | None:
    parsed = _parse_iso(value)
    if not parsed:
        return None
    return (_utcnow() - parsed).days


# ============== KNOWLEDGE COVERAGE ("What don't we know?") ==============


async def knowledge_coverage(db: Any, user: dict, client_id: str | None = None) -> dict:
    """Unknown infrastructure is itself a risk. Measure it and hand back a mission."""
    scope = tenant_scoped_query(user, {"client_id": client_id} if client_id else {})
    unknowns: list[dict] = []
    checks = 0
    known = 0

    def _gap(domain: str, unknown: str, detail: str, count: int, severity: str) -> None:
        if count:
            unknowns.append({"domain": domain, "unknown": unknown, "detail": detail,
                             "count": count, "severity": severity})

    devices = await db.devices.find(scope, {"_id": 0}).limit(500).to_list(500)
    checks += len(devices) * 4
    no_owner = sum(1 for d in devices if not (d.get("assigned_user") or d.get("owner") or d.get("assigned_to")))
    no_patch = sum(1 for d in devices if not d.get("last_patch_date"))
    no_warranty = sum(1 for d in devices if not d.get("warranty_expiry"))
    no_purchase = sum(1 for d in devices if not d.get("purchase_date"))
    known += (len(devices) - no_owner) + (len(devices) - no_patch) + (len(devices) - no_warranty) + (len(devices) - no_purchase)
    _gap("devices", "unknown device owner", "No assigned user recorded — nobody to call, nobody accountable.", no_owner, "medium")
    _gap("devices", "unknown patch status", "No last-patch date recorded — patch compliance cannot be asserted.", no_patch, "high")
    _gap("devices", "unknown warranty status", "No warranty expiry recorded — replacement risk is unmeasured.", no_warranty, "medium")
    _gap("devices", "unknown provenance", "No purchase date recorded — age and lifecycle stage unknown.", no_purchase, "low")

    clients = await db.clients.find(tenant_scoped_query(user, {"id": client_id} if client_id else {}), {"_id": 0}).limit(200).to_list(200)
    checks += len(clients) * 2
    no_contact = sum(1 for c in clients if not (c.get("phone") or c.get("email")))
    no_site = sum(1 for c in clients if not (c.get("address") or c.get("city") or c.get("site_name")))
    known += (len(clients) - no_contact) + (len(clients) - no_site)
    _gap("customers", "unknown customer contact", "No phone or email on file — escalation paths unproven.", no_contact, "high")
    _gap("customers", "unknown site details", "No address/site recorded — field visits depend on memory.", no_site, "low")

    tickets = await db.tickets.find(scope, {"_id": 0}).limit(500).to_list(500)
    checks += len(tickets) * 2
    no_category = sum(1 for t in tickets if not t.get("category"))
    no_device = sum(1 for t in tickets if not (t.get("device_id") or t.get("device_ids") or t.get("asset_id")))
    known += (len(tickets) - no_category) + (len(tickets) - no_device)
    _gap("tickets", "uncategorised tickets", "No category — demand analysis and routing are guesswork.", no_category, "medium")
    _gap("tickets", "tickets with no device link", "Work happened but the object it happened to is unknown.", no_device, "medium")

    contracts = await db.contracts.find(tenant_scoped_query(user, {"client_id": client_id} if client_id else {}), {"_id": 0}).limit(200).to_list(200)
    checks += len(contracts) * 2
    no_value = sum(1 for c in contracts if not c.get("value"))
    no_end = sum(1 for c in contracts if not c.get("end_date"))
    known += (len(contracts) - no_value) + (len(contracts) - no_end)
    _gap("contracts", "agreements without recorded value", "Margin cannot be computed for these agreements.", no_value, "high")
    _gap("contracts", "agreements without end date", "Renewal horizon is invisible for these agreements.", no_end, "medium")

    # Recoverability: backup completion events exist, restore verification does not.
    backup_evidence = await db.device_events.count_documents(
        tenant_scoped_query(user, {"event_type": "backup_completed"})
    )
    restore_evidence = await db.device_events.count_documents(
        tenant_scoped_query(user, {"event_type": {"$in": ["restore_verified", "restore_tested"]}})
    )
    checks += max(1, len(devices))
    if backup_evidence and not restore_evidence:
        _gap("backups", "unverified recoverability",
             f"{backup_evidence} backup completion event(s) but zero restore verifications — "
             "backup success is not proof of recovery.", len(devices), "high")
    elif not backup_evidence:
        _gap("backups", "no backup evidence at all",
             "Neither backup events nor restore tests are recorded for this estate.", len(devices), "high")
    else:
        known += len(devices)

    # Freshness: facts decay unless reconfirmed.
    stale: list[dict] = []
    for cert in await db.ssl_certificates.find(tenant_scoped_query(user, {}), {"_id": 0}).limit(100).to_list(100):
        age = _days_since(cert.get("last_check"))
        if age is None or age > 90:
            stale.append({"fact": f"SSL {cert.get('domain')} status",
                          "last_verified": cert.get("last_check"),
                          "days_old": age,
                          "note": "Certificate state lowers confidence until rechecked."})
    for report in await db.compliance_reports.find(tenant_scoped_query(user, {"client_id": client_id} if client_id else {}), {"_id": 0}).limit(50).to_list(50):
        age = _days_since(report.get("scanned_at"))
        if age is None or age > 90:
            stale.append({"fact": f"{report.get('framework_name') or report.get('framework')} compliance scan",
                          "last_verified": report.get("scanned_at"),
                          "days_old": age,
                          "note": "Compliance state decays — rescan to restore confidence."})
    for item in await db.production_readiness_items.find(tenant_scoped_query(user, {}), {"_id": 0}).limit(50).to_list(50):
        age = _days_since(item.get("last_reviewed"))
        if age is None or age > 180:
            stale.append({"fact": f"Readiness item: {item.get('title')}",
                          "last_verified": item.get("last_reviewed"),
                          "days_old": age,
                          "note": "Evidence exists but has not been reviewed recently."})

    total_unknowns = sum(item["count"] for item in unknowns)
    coverage_pct = round(100 * known / checks) if checks else 100
    unknowns.sort(key=lambda item: {"high": 0, "medium": 1, "low": 2}[item["severity"]])
    return {
        "client_id": client_id,
        "coverage_pct": coverage_pct,
        "unknowns": unknowns,
        "total_unknowns": total_unknowns,
        "stale_facts": stale[:20],
        "mission": (f"Reduce Unknowns → 100% — {total_unknowns} unknown(s) across "
                    f"{len(unknowns)} categories." if unknowns else "Reduce Unknowns → 100% — nothing unknown. Suspiciously good."),
        "verdict": (f"Knowledge coverage {coverage_pct}%. Unknown infrastructure is itself a risk."
                    if unknowns else f"Knowledge coverage {coverage_pct}%. This customer is fully known."),
    }


# ============== PROVE IT (evidence chains) ==============


async def prove_it(db: Any, user: dict, claim: str, subject_id: str) -> dict:
    """Nexus does not repeat claims — it gathers evidence and shows its work."""
    claim_key = claim.strip().lower().replace(" ", "_").replace("-", "_")
    now = _utcnow()

    async def _device() -> dict | None:
        return await db.devices.find_one(tenant_scoped_query(user, {"id": subject_id}), {"_id": 0})

    def _result(verdict: str, evidence: list[dict], position: str, freshness: str = "") -> dict:
        return {"claim": claim, "subject_id": subject_id, "verdict": verdict,
                "evidence": evidence, "nexus_position": position, "freshness": freshness}

    if claim_key in ("backup", "backup_healthy", "backup_recoverability", "recoverability"):
        device = await _device()
        if not device:
            return {"found": False}
        events = await db.device_events.find(
            tenant_scoped_query(user, {"device_id": subject_id, "event_type": "backup_completed"}),
            {"_id": 0},
        ).sort("timestamp", -1).limit(20).to_list(20)
        restores = await db.device_events.find(
            tenant_scoped_query(user, {"device_id": subject_id,
                                       "event_type": {"$in": ["restore_verified", "restore_tested"]}}),
            {"_id": 0},
        ).sort("timestamp", -1).limit(5).to_list(5)
        drills = await db.backup_drills.find(
            tenant_scoped_query(user, {"device_id": subject_id}), {"_id": 0}
        ).sort("completed_at", -1).limit(5).to_list(5)
        evidence = [
            {"item": "Last backup event", "status": "ok" if events else "missing",
             "detail": events[0].get("timestamp") if events else "No backup completion recorded."},
            {"item": "Integrity verification", "status": "ok" if any(d.get("integrity_ok") for d in drills) else "missing",
             "detail": "Backup-drill integrity check on record." if any(d.get("integrity_ok") for d in drills) else "No integrity verification on record."},
            {"item": "Test restore", "status": "ok" if (restores or drills) else "missing",
             "detail": (restores[0].get("timestamp") if restores else drills[0].get("completed_at")) if (restores or drills) else "No restore has ever been tested."},
            {"item": "Restored workload booted / verified", "status": "ok" if any(d.get("boot_ok") or d.get("verified") for d in drills) else "missing",
             "detail": "Post-restore verification on record." if any(d.get("boot_ok") or d.get("verified") for d in drills) else "No post-restore verification on record."},
        ]
        if events and not (restores or drills):
            return _result("unverified", evidence,
                           "Backup says yes, Nexus says no. Backup completed successfully — recoverability "
                           "verification has never run. Nexus treats this workload as unprotected.")
        if restores or drills:
            return _result("verified", evidence, "Recoverability verified: backup AND restore evidence exist.")
        return _result("unverified", evidence, "No backup evidence at all. This claim cannot be made.")

    if claim_key in ("patching", "patched", "patch_compliance"):
        device = await _device()
        if not device:
            return {"found": False}
        patches = await db.device_patches.find(
            tenant_scoped_query(user, {"device_id": subject_id, "status": "installed"}), {"_id": 0}
        ).sort("installed_date", -1).limit(5).to_list(5)
        latest = patches[0].get("installed_date") if patches else device.get("last_patch_date")
        age = _days_since(latest)
        evidence = [
            {"item": "Installed patch records", "status": "ok" if patches else "missing",
             "detail": f"{len(patches)} on record, latest {latest}" if patches else "No patch records."},
            {"item": "Device patch date", "status": "ok" if device.get("last_patch_date") else "missing",
             "detail": device.get("last_patch_date") or "Not recorded on the device."},
        ]
        if age is not None and age <= 60:
            return _result("verified", evidence, f"Patching verified — last patch {age} day(s) ago.", f"{age} days")
        return _result("unverified", evidence,
                       f"Patching NOT verified — last patch evidence is {age if age is not None else 'unknown'} day(s) old.",
                       f"{age} days" if age is not None else "unknown")

    if claim_key in ("warranty", "under_warranty"):
        device = await _device()
        if not device:
            return {"found": False}
        warranty = _parse_iso(device.get("warranty_expiry"))
        evidence = [
            {"item": "Warranty expiry", "status": "ok" if warranty else "missing",
             "detail": device.get("warranty_expiry") or "Not recorded."},
            {"item": "Purchase date", "status": "ok" if device.get("purchase_date") else "missing",
             "detail": device.get("purchase_date") or "Not recorded."},
        ]
        if warranty and warranty >= now:
            return _result("verified", evidence, f"In warranty until {warranty.date().isoformat()}.")
        if warranty:
            return _result("contradicted", evidence, f"Warranty expired {(now - warranty).days} day(s) ago.")
        return _result("unverified", evidence, "No warranty evidence on file.")

    if claim_key in ("supported_os", "os_support"):
        device = await _device()
        if not device:
            return {"found": False}
        os_name = f"{device.get('os') or ''} {device.get('os_version') or ''}".lower()
        legacy = any(marker in os_name for marker in LEGACY_OS_MARKERS)
        evidence = [{"item": "Operating system", "status": "ok" if device.get("os") else "missing",
                     "detail": f"{device.get('os') or 'unknown'} {device.get('os_version') or ''}".strip()}]
        if legacy:
            return _result("contradicted", evidence, "This OS is out of support. The claim is false.")
        return _result("verified" if device.get("os") else "unverified", evidence,
                       "OS is within vendor support." if device.get("os") else "OS not recorded.")

    if claim_key in ("encryption", "encrypted", "bitlocker"):
        device = await _device()
        if not device:
            return {"found": False}
        evidence = [{"item": "Encryption attestation", "status": "missing",
                     "detail": "Nexus has no trusted encryption evidence source for this device yet."}]
        return _result("unverified", evidence,
                       "Not 'agent says enabled'. Nexus has no evidence, so Nexus does not agree with this claim — yet.")

    if claim_key in ("compliance", "compliance_scan"):
        reports = await db.compliance_reports.find(
            tenant_scoped_query(user, {"client_id": subject_id}), {"_id": 0}
        ).sort("scanned_at", -1).limit(1).to_list(1)
        if not reports:
            return {"found": False}
        report = reports[0]
        age = _days_since(report.get("scanned_at"))
        evidence = [
            {"item": f"{report.get('framework_name') or report.get('framework')} scan",
             "status": "ok" if report.get("passed") == report.get("total") else "partial",
             "detail": f"{report.get('passed')}/{report.get('total')} controls passed (score {report.get('score')})."},
            {"item": "Scan freshness", "status": "ok" if (age is not None and age <= 90) else "stale",
             "detail": f"Scanned {age} day(s) ago."},
        ]
        if report.get("passed") == report.get("total") and age is not None and age <= 90:
            return _result("verified", evidence, "Compliance verified from a fresh scan.", f"{age} days")
        return _result("unverified", evidence,
                       f"Compliance not fully verified — {report.get('passed')}/{report.get('total')} controls passed.", f"{age} days")

    return {"found": False, "unsupported_claim": claim}


# ============== CONFIDENCE (click the score, see why) ==============


async def confidence_report(db: Any, user: dict, object_type: str, object_id: str) -> dict:
    """Not all information is equally trustworthy — show the reasoning."""
    kind = object_type.strip().lower()
    rows: list[dict] = []

    if kind == "device":
        device = await db.devices.find_one(tenant_scoped_query(user, {"id": object_id}), {"_id": 0})
        if not device:
            return {"found": False}

        def _score(present: bool, corroborated: bool, stale_days: int | None) -> tuple[int, str]:
            if not present:
                return 0, "No source records this fact — Unknown."
            score = 85 if corroborated else 70
            reason = ("Corroborated by two or more independent records." if corroborated
                      else "Single source recorded — plausible, not proven.")
            if stale_days is not None and stale_days > 180:
                score -= 20
                reason += f" Last touched {stale_days} days ago — freshness decay applied."
            return score, reason

        owner_present = bool(device.get("assigned_user") or device.get("owner") or device.get("assigned_to"))
        owner_rows = await db.work_activity_audit.count_documents(
            tenant_scoped_query(user, {"user_name": device.get("assigned_user") or device.get("owner")})
        ) if owner_present else 0
        score, reason = _score(owner_present, owner_rows > 0, _days_since(device.get("updated_at")))
        rows.append({"attribute": "Device owner", "value": device.get("assigned_user") or device.get("owner")
                     or device.get("assigned_to") or "Unknown", "confidence": score, "reason": reason})

        patch_corrob = await db.device_patches.count_documents(tenant_scoped_query(user, {"device_id": object_id}))
        score, reason = _score(bool(device.get("last_patch_date")), patch_corrob > 0,
                              _days_since(device.get("last_patch_date")))
        rows.append({"attribute": "Patch state", "value": device.get("last_patch_date") or "Unknown",
                     "confidence": score, "reason": reason})

        backup_corrob = await db.device_events.count_documents(
            tenant_scoped_query(user, {"device_id": object_id, "event_type": "backup_completed"}))
        score, reason = _score(backup_corrob > 0, False, None)
        rows.append({"attribute": "Backup behaviour", "value": f"{backup_corrob} event(s)",
                     "confidence": score,
                     "reason": reason + (" No restore verification exists, so recoverability confidence stays low."
                                         if backup_corrob else "")})

        warranty_ok = bool(device.get("warranty_expiry") and device.get("purchase_date"))
        score, reason = _score(bool(device.get("warranty_expiry")), warranty_ok, None)
        rows.append({"attribute": "Warranty / provenance", "value": device.get("warranty_expiry") or "Unknown",
                     "confidence": score, "reason": reason})

        return {"found": True, "object_type": kind, "object_id": object_id,
                "attributes": rows,
                "note": "Confidence is computed from completeness, corroboration and freshness — click any score to see why."}

    if kind == "ticket":
        ticket = await db.tickets.find_one(tenant_scoped_query(user, {"id": object_id}), {"_id": 0})
        if not ticket:
            return {"found": False}
        rows.append({"attribute": "Category", "value": ticket.get("category") or "Unknown",
                     "confidence": 80 if ticket.get("category") else 0,
                     "reason": "Recorded at intake." if ticket.get("category") else "No category recorded."})
        rows.append({"attribute": "Assignment", "value": ticket.get("assigned_name") or "Unassigned",
                     "confidence": 90 if ticket.get("assigned_to") else 40,
                     "reason": "Explicit assignment on record." if ticket.get("assigned_to") else "Nobody assigned — routing is implicit."})
        rows.append({"attribute": "Device link", "value": ticket.get("device_name") or ticket.get("device_id") or "Unknown",
                     "confidence": 95 if (ticket.get("device_id") or ticket.get("device_ids")) else 20,
                     "reason": "Stable device ID on the ticket." if (ticket.get("device_id") or ticket.get("device_ids"))
                     else "No device linked — root-cause work will guess at the object."})
        rows.append({"attribute": "Root cause (hypothesis only)", "value": "Inferred from description keywords",
                     "confidence": 35,
                     "reason": "Keyword inference is a hypothesis, not evidence. Use Detective/Prove It to confirm."})
        return {"found": True, "object_type": kind, "object_id": object_id,
                "attributes": rows,
                "note": "Confidence is computed from completeness, corroboration and freshness — click any score to see why."}

    return {"found": False, "unsupported_object_type": object_type}


# ============== TICKET DIFFICULTY PREDICTION ==============

_SKILL_BY_CATEGORY = {
    "network": "Networking L3", "infrastructure": "Systems L2", "security": "Security L2",
    "m365": "Cloud L2", "cloud": "Cloud L2", "backup": "Backup Specialist L2",
    "support": "Service Desk L1", "hardware": "Field Services L1",
}


async def ticket_difficulty(db: Any, user: dict, ticket_id: str) -> dict:
    """Predicted complexity BEFORE assignment — from real ticket history."""
    ticket = await db.tickets.find_one(tenant_scoped_query(user, {"id": ticket_id}), {"_id": 0})
    if not ticket:
        return {"found": False}
    category = str(ticket.get("category") or "support").lower()
    history = await db.tickets.find(
        tenant_scoped_query(user, {"category": ticket.get("category"),
                                   "status": {"$in": ["resolved", "closed"]}}),
        {"_id": 0},
    ).limit(200).to_list(200)
    durations = sorted(float(h.get("total_time_minutes") or h.get("estimated_hours") or 0) * (1 if h.get("total_time_minutes") else 60)
                       for h in history if (h.get("total_time_minutes") or h.get("estimated_hours")))
    priority_weight = {"critical": 1.3, "high": 1.15, "medium": 1.0, "low": 0.85}.get(
        str(ticket.get("priority") or "medium").lower(), 1.0)
    devices = len(ticket.get("device_ids") or []) + (1 if ticket.get("device_id") else 0)

    if durations:
        median = durations[len(durations) // 2]
        p75 = durations[int(len(durations) * 0.75)]
        low = max(15, round(median * 0.75 * priority_weight))
        high = max(low + 15, round(max(median, p75) * priority_weight * (1 + 0.1 * max(0, devices - 1))))
    else:
        low, high = 30, 60
    complexity = "High" if (high >= 90 or str(ticket.get("priority")).lower() == "critical") else "Medium" if high >= 45 else "Low"

    escalation_rate = sum(1 for h in history if "escalat" in str(h.get("status") or "") + str(h.get("resolution_notes") or "").lower())
    escalation_probability = min(95, max(5, round(
        (20 if str(ticket.get("priority")).lower() in ("critical", "high") else 8)
        + (100 * escalation_rate / len(history) if history else 0)
        + min(20, devices * 5)
    )))
    return {
        "found": True,
        "ticket_id": ticket.get("id"),
        "ticket_number": ticket.get("ticket_number"),
        "predicted_complexity": complexity,
        "estimated_active_minutes": [low, high],
        "likely_skill": _SKILL_BY_CATEGORY.get(category, "Service Desk L1"),
        "similar_incidents": len(history),
        "escalation_probability_pct": escalation_probability,
        "basis": f"Derived from {len(history)} resolved '{ticket.get('category')}' ticket(s) with recorded effort.",
        "verdict": f"Predicted complexity: {complexity}. Estimated active technician time: {low}–{high} minutes.",
    }


# ============== TICKET GRAVITY ==============

async def ticket_gravity(db: Any, user: dict, ticket_id: str) -> dict:
    """Some P3 tickets consume ridiculous amounts of organisational attention."""
    ticket = await db.tickets.find_one(tenant_scoped_query(user, {"id": ticket_id}), {"_id": 0})
    if not ticket:
        return {"found": False}
    now = _utcnow()
    created = _parse_iso(ticket.get("created_at")) or now
    ended = _parse_iso(ticket.get("resolved_at")) or now
    elapsed_hours = max(0.0, (ended - created).total_seconds() / 3600.0)

    audit_events = await db.ticket_audit_log.count_documents(tenant_scoped_query(user, {"ticket_id": ticket_id}))
    time_rows = await db.time_entries.find(tenant_scoped_query(user, {"ticket_id": ticket_id}), {"_id": 0}).to_list(50)
    logged_minutes = sum(float(r.get("minutes") or 0) for r in time_rows)
    comms = await db.client_communication_events.count_documents(
        tenant_scoped_query(user, {"related_id": ticket_id}))
    children = await db.tickets.count_documents(
        tenant_scoped_query(user, {"$or": [{"merged_into": ticket_id}, {"parent_id": ticket_id}]}))
    audience = len(ticket.get("watchers") or []) + len(ticket.get("cc") or [])

    score = round(
        min(40, elapsed_hours / 24 * 10)
        + min(25, logged_minutes / 60 * 3)
        + min(15, audit_events * 3)
        + min(10, comms * 2.5)
        + min(10, audience * 2)
        + min(10, children * 5)
    )
    verdict = (f"INC gravity: {score}/100 — unusually high operational gravity. Service manager should look." if score >= 60
               else f"Gravity: {score}/100 — elevated attention load." if score >= 30
               else f"Gravity: {score}/100 — normal.")
    return {
        "found": True,
        "ticket_id": ticket.get("id"),
        "ticket_number": ticket.get("ticket_number"),
        "gravity_score": score,
        "breakdown": {
            "elapsed_hours": round(elapsed_hours, 1),
            "logged_minutes": logged_minutes,
            "audit_events": audit_events,
            "customer_communications": comms,
            "audience": audience,
            "merged_symptoms": children,
        },
        "verdict": verdict,
    }


# ============== ESCALATION QUALITY CONTROL ==============

async def escalation_preflight(db: Any, user: dict, ticket_id: str) -> dict:
    """Before L1→L2: what hasn't been checked? Nexus runs what it can itself."""
    ticket = await db.tickets.find_one(tenant_scoped_query(user, {"id": ticket_id}), {"_id": 0})
    if not ticket:
        return {"found": False}
    now = _utcnow()
    window = _iso(now - timedelta(hours=72))
    device_id = ticket.get("device_id") or (ticket.get("device_ids") or [None])[0]
    checks: list[dict] = []

    changes = await db.ticket_audit_log.find(
        tenant_scoped_query(user, {"ticket_id": ticket_id, "created_at": {"$gte": window}}), {"_id": 0}
    ).to_list(20)
    if device_id:
        changes += await db.device_events.find(
            tenant_scoped_query(user, {"device_id": device_id, "timestamp": {"$gte": window}}), {"_id": 0}
        ).to_list(20)
    checks.append({"check": "Recent changes", "nexus_ran": True, "ok": not changes,
                   "detail": f"{len(changes)} change/event(s) in the last 72h." if changes
                   else "No recent changes found — change-induced cause unlikely."})

    siblings = await db.tickets.find(
        tenant_scoped_query(user, {"client_id": ticket.get("client_id"), "id": {"$ne": ticket_id},
                                   "status": {"$nin": ["resolved", "closed"]}, "created_at": {"$gte": window}}),
        {"_id": 0, "ticket_number": 1, "title": 1},
    ).limit(5).to_list(5)
    checks.append({"check": "Known outage / sibling symptoms", "nexus_ran": True, "ok": not siblings,
                   "detail": f"{len(siblings)} other open ticket(s) for this customer in 72h — possible common cause."
                   if siblings else "No sibling symptoms — likely isolated."})

    repeats = 0
    if device_id:
        repeats = await db.device_events.count_documents(
            tenant_scoped_query(user, {"device_id": device_id,
                                       "event_type": {"$in": ["script_executed", "service_restart"]},
                                       "timestamp": {"$gte": window}}))
    checks.append({"check": "Repeated remediation attempts", "nexus_ran": True, "ok": repeats < 3,
                   "detail": (f"{repeats} restart/script attempts in 72h — definition of insanity threshold approaching."
                              if repeats >= 3 else "No repeated remediation detected.")})

    device = await db.devices.find_one(tenant_scoped_query(user, {"id": device_id}), {"_id": 0}) if device_id else None
    telemetry_ok = bool(device and str(device.get("status") or "").lower() in {"online", "healthy", "ok"})
    checks.append({"check": "Device telemetry fresh", "nexus_ran": True, "ok": telemetry_ok,
                   "detail": f"{device.get('name') or device_id} reporting '{device.get('status')}'." if device
                   else "No device linked to this ticket."})

    contact_ok = bool(ticket.get("contact_email") or ticket.get("contact_name") or ticket.get("cc"))
    checks.append({"check": "Alternate user / contact available", "nexus_ran": True, "ok": contact_ok,
                   "detail": "Customer contact on the ticket." if contact_ok
                   else "No alternate contact recorded — L2 will chase context."})

    human_checks = [{"check": "Confirm with a second user at the site", "why": "Rules out single-user environment issues."},
                    {"check": "Business impact confirmation", "why": "L2 prioritises verified impact over reported impact."}]
    gaps = [c["check"] for c in checks if not c["ok"]]
    return {
        "found": True,
        "ticket_id": ticket.get("id"),
        "ticket_number": ticket.get("ticket_number"),
        "checks": checks,
        "human_checks": human_checks,
        "gaps": gaps,
        "verdict": (f"Not ready to escalate — {len(gaps)} check(s) still open. Nexus ran everything it could."
                    if gaps else "Ready to escalate — all pre-escalation checks passed."),
    }


# ============== NOISE BUDGET & ALERT USEFULNESS ==============

async def noise_budget(db: Any, user: dict) -> dict:
    """Every alert source gets measured. Then we systematically destroy alert fatigue."""
    alerts = await db.alerts.find(tenant_scoped_query(user, {}), {"_id": 0}).limit(2000).to_list(2000)
    by_type: dict[str, list] = {}
    for alert in alerts:
        by_type.setdefault(str(alert.get("alert_type") or "unknown"), []).append(alert)

    rows = []
    for alert_type, items in sorted(by_type.items()):
        actionable = 0
        for alert in items:
            created = _parse_iso(alert.get("created_at"))
            if not created:
                continue
            follow_up = await db.tickets.count_documents(
                tenant_scoped_query(user, {
                    "$or": [{"device_id": alert.get("device_id")}, {"client_id": alert.get("client_id")}],
                    "created_at": {"$gte": _iso(created), "$lte": _iso(created + timedelta(hours=48))},
                }))
            if follow_up or str(alert.get("status") or "").lower() not in {"active", "new", "open"}:
                actionable += 1
        noise_rate = round(100 * (1 - actionable / len(items)), 1) if items else 0.0
        rows.append({
            "alert_type": alert_type,
            "total": len(items),
            "actionable": actionable,
            "noise_rate_pct": noise_rate,
            "recommendation": ("Stop interrupting technicians with this — route to a digest or tune the threshold."
                               if noise_rate >= 80 else "Worth keeping — this type earns its interruptions."
                               if noise_rate <= 50 else "Tune the threshold before adding more of these."),
        })

    rules = await db.alert_suppression_rules.find(tenant_scoped_query(user, {}), {"_id": 0}).limit(50).to_list(50)
    suppressed = sum(int(r.get("suppressed_count") or 0) for r in rules)
    total = len(alerts)
    total_actionable = sum(r["actionable"] for r in rows)
    return {
        "total_alerts": total,
        "actionable": total_actionable,
        "required_human_action": sum(1 for a in alerts if str(a.get("severity") or "").lower() in {"critical", "high"}),
        "already_suppressed": suppressed,
        "noise_rate_pct": round(100 * (1 - total_actionable / total), 1) if total else 0.0,
        "by_type": rows,
        "verdict": (f"Noise rate {round(100 * (1 - total_actionable / total), 1) if total else 0.0}% across {total} alert(s). "
                    "Alert usefulness is measured from technician action, not vendor confidence." if total
                    else "No alerts recorded — silence is either success or blindness."),
    }


# ============== ONE PROBLEM, MANY SYMPTOMS / WORK BATCHES ==============

_DOMAIN_KEYWORDS = {
    "network / WAN": ["slow", "timeout", "packet", "latency", "disconnect", "wan", "vpn", "drops"],
    "Microsoft 365": ["outlook", "teams", "sharepoint", "onedrive", "exchange", "m365"],
    "DNS": ["dns", "resolution", "resolve"],
    "authentication": ["login", "password", "mfa", "lockout", "sign-in", "signin"],
}

# Deepest shared layer wins: seven app symptoms usually share a transport cause.
_CAUSE_PRIORITY = ["DNS", "network / WAN", "authentication", "Microsoft 365"]


def _tokens(text: str) -> set:
    return {w for w in re.findall(r"[a-z]{4,}", str(text or "").lower())}


async def correlate_tickets(db: Any, user: dict, client_id: str | None = None) -> dict:
    """Seven tickets that look unrelated are often one problem with many symptoms."""
    query = {"status": {"$nin": ["resolved", "closed"]}}
    if client_id:
        query["client_id"] = client_id
    tickets = await db.tickets.find(tenant_scoped_query(user, query), {"_id": 0}).limit(300).to_list(300)

    def _domains_of(item: dict) -> set:
        text = f"{item.get('title') or ''} {item.get('subject') or ''} {item.get('description') or ''}".lower()
        return {name for name, words in _DOMAIN_KEYWORDS.items() if any(w in text for w in words)}

    clusters: list[dict] = []
    used: set = set()
    for index, ticket in enumerate(tickets):
        if index in used:
            continue
        domains = _domains_of(ticket)
        if not domains:
            continue
        group = [ticket]
        group_domains = [domains]
        used.add(index)
        created = _parse_iso(ticket.get("created_at"))
        for other_index, other in enumerate(tickets):
            if other_index in used or other.get("client_id") != ticket.get("client_id"):
                continue
            other_domains = _domains_of(other)
            other_created = _parse_iso(other.get("created_at"))
            close_in_time = (created and other_created
                             and abs((other_created - created).total_seconds()) <= 48 * 3600)
            if domains & other_domains and close_in_time:
                group.append(other)
                group_domains.append(other_domains)
                used.add(other_index)
        if len(group) >= 2:
            shared = set.intersection(*group_domains)
            probable = next((name for name in _CAUSE_PRIORITY if name in shared), sorted(shared)[0])
            clusters.append({
                "client_name": ticket.get("client_name"),
                "probable_common_cause": probable,
                "symptom_count": len(group),
                "tickets": [g.get("ticket_number") or g.get("id") for g in group],
                "symptoms": [g.get("title") for g in group],
                "recommendation": "Treat as ONE incident with many symptoms — correlate before dispatching separately.",
            })

    batches: list[dict] = []
    by_category: dict[str, list] = {}
    for ticket in tickets:
        if ticket.get("category"):
            by_category.setdefault(str(ticket["category"]), []).append(ticket)
    for category, items in by_category.items():
        if len(items) < 2:
            continue
        token_counts: dict[str, list] = {}
        for item in items:
            for token in _tokens(item.get("title") or item.get("subject")):
                token_counts.setdefault(token, []).append(item)
        for token, matched in token_counts.items():
            if len(matched) >= 2:
                batches.append({
                    "category": category,
                    "shared_token": token,
                    "ticket_count": len(matched),
                    "tickets": [m.get("ticket_number") or m.get("id") for m in matched],
                    "suggested_flow": "Test once → canary → execute → verify → update all tickets.",
                })
                break

    return {
        "clusters": clusters,
        "batches": batches[:10],
        "verdict": (f"{len(clusters)} probable single-incident cluster(s) and {len(batches[:10])} work batch(es) "
                    f"across {len(tickets)} open ticket(s)." if (clusters or batches)
                    else f"{len(tickets)} open ticket(s), no correlation found. They really are separate problems."),
    }


# ============== AUDIT READINESS PACK ("Auditor Tomorrow") ==============

async def audit_readiness(db: Any, user: dict, client_id: str | None = None) -> dict:
    """Assemble the evidence BEFORE the auditor arrives — controls, gaps, and a pack manifest."""
    scope = tenant_scoped_query(user, {"client_id": client_id} if client_id else {})
    devices = await db.devices.find(scope, {"_id": 0}).limit(500).to_list(500)
    controls: list[dict] = []

    def _control(name: str, status: str, evidence: str) -> None:
        controls.append({"control": name, "status": status, "evidence": evidence})

    serials = sum(1 for d in devices if d.get("serial_number"))
    _control("Asset inventory", "verified" if serials == len(devices) and devices else "partial",
             f"{serials}/{len(devices)} devices with serial numbers on record.")

    admins = await db.users.find(tenant_scoped_query(user, {}), {"_id": 0, "name": 1, "role": 1, "is_admin": 1}).to_list(200)
    privileged = [u for u in admins if u.get("is_admin") or str(u.get("role") or "").lower() == "admin"]
    _control("Privileged account controls", "verified" if admins else "unknown",
             f"{len(privileged)} privileged account(s) of {len(admins)} recorded users.")

    _control("MFA enforcement", "unknown", "No identity-provider evidence source is connected — MFA cannot be asserted.")
    _control("Disk encryption", "unknown", "No trusted encryption attestation source is connected.")

    patches = await db.device_patches.find(scope, {"_id": 0}).sort("installed_date", -1).limit(1).to_list(1)
    unpatched_dates = sum(1 for d in devices if not d.get("last_patch_date"))
    _control("Patching", "verified" if patches and unpatched_dates == 0 else "partial",
             f"Latest patch {patches[0].get('installed_date') if patches else 'none'}; "
             f"{unpatched_dates}/{len(devices)} devices missing patch dates.")

    backup_events = await db.device_events.count_documents(tenant_scoped_query(user, {"event_type": "backup_completed"}))
    restore_tests = await db.device_events.count_documents(
        tenant_scoped_query(user, {"event_type": {"$in": ["restore_verified", "restore_tested"]}}))
    _control("Backup verification", "verified" if backup_events and restore_tests else "partial" if backup_events else "failed",
             f"{backup_events} backup event(s), {restore_tests} restore verification(s). "
             + ("Recoverability unproven." if backup_events and not restore_tests else ""))

    legacy = sum(1 for d in devices
                 if any(m in f"{d.get('os') or ''} {d.get('os_version') or ''}".lower() for m in LEGACY_OS_MARKERS))
    _control("Supported operating systems", "verified" if legacy == 0 else "failed" if legacy > len(devices) // 2 else "partial",
             f"{legacy} device(s) on out-of-support operating systems.")

    certs = await db.ssl_certificates.find(tenant_scoped_query(user, {}), {"_id": 0}).limit(100).to_list(100)
    expiring = sum(1 for c in certs if (_parse_iso(c.get("expiry_date")) or _utcnow()) <= _utcnow() + timedelta(days=30))
    _control("Certificate management", "verified" if certs and expiring == 0 else "partial" if certs else "unknown",
             f"{len(certs)} certificate(s) tracked, {expiring} expired/expiring within 30 days.")

    change_evidence = (await db.ticket_audit_log.count_documents(tenant_scoped_query(user, {}))
                       + await db.activity_logs.count_documents(tenant_scoped_query(user, {})))
    _control("Change logs", "verified" if change_evidence else "failed",
             f"{change_evidence} audit record(s) retained.")

    reports = await db.compliance_reports.find(scope, {"_id": 0}).sort("scanned_at", -1).limit(1).to_list(1)
    if reports:
        report = reports[0]
        age = _days_since(report.get("scanned_at"))
        _control("Compliance scan", "verified" if (age is not None and age <= 90) else "partial",
                 f"{report.get('framework_name') or report.get('framework')}: {report.get('passed')}/{report.get('total')} "
                 f"controls passed, scanned {age} day(s) ago.")
    else:
        _control("Compliance scan", "unknown", "No compliance scan on record.")

    debt = await db.technical_debt.count_documents(
        {"tenant_id": platform_tenant_id(user), "status": "open",
         **({"client_id": client_id} if client_id else {})})
    _control("Exceptions register", "verified" if debt == 0 else "partial",
             f"{debt} open technical-debt/exception item(s) recorded.")

    weights = {"verified": 1.0, "partial": 0.5, "unknown": 0.0, "failed": 0.0}
    readiness = round(100 * sum(weights[c["status"]] for c in controls) / len(controls)) if controls else 0
    gaps = [c for c in controls if c["status"] != "verified"]
    return {
        "client_id": client_id,
        "readiness_pct": readiness,
        "controls": controls,
        "gaps": gaps,
        "pack_manifest": ["Asset inventory export", "Privileged access list", "Patch compliance report",
                          "Backup & restore verification evidence", "Encryption attestations (pending source)",
                          "Certificate register", "Change log extract", "Compliance scan results",
                          "Exceptions register", "Remediation evidence history"],
        "verdict": (f"Insurance/audit evidence package ready: {readiness}%. "
                    + (f"{len(gaps)} control gap(s) to close before the auditor smiles." if gaps
                       else "Every control has verified evidence.")),
    }


# ============== NEXUS LAWS (non-negotiable invariants) ==============

BUILTIN_LAWS = [
    {"id": "law-recoverability", "condition": "destructive_without_recoverability",
     "text": "Never perform a destructive action without recoverability evidence."},
    {"id": "law-vendor-status", "condition": "vendor_status_only",
     "text": "Never call a backup healthy solely because the vendor reports success."},
    {"id": "law-verification", "condition": "autonomous_without_verification",
     "text": "Never execute autonomous remediation without post-action verification."},
    {"id": "law-credentials", "condition": "exposes_credentials",
     "text": "Never expose credentials in tickets, chat or logs."},
    {"id": "law-tenant-isolation", "condition": "crosses_tenant",
     "text": "Never allow cross-tenant data leakage."},
    {"id": "law-privileges", "condition": "silent_privilege_change",
     "text": "Never silently broaden privileges."},
    {"id": "law-policy-over-confidence", "condition": "confidence_over_policy",
     "text": "Never allow AI confidence to override an explicit security policy."},
    {"id": "law-evidence-retention", "condition": "deletes_retained_evidence",
     "text": "Never delete evidence required by retention policy."},
    {"id": "law-fixed-claims", "condition": "unverified_fix_claim",
     "text": "Never claim something is fixed unless Nexus can verify the desired outcome."},
]

_BUILTIN_CONDITIONS = {
    "destructive_without_recoverability":
        lambda p: bool(p.get("destructive") and not p.get("recoverability_evidence")),
    "vendor_status_only":
        lambda p: bool(p.get("vendor_status_only")),
    "autonomous_without_verification":
        lambda p: bool(p.get("autonomous") and not p.get("verification_planned")),
    "exposes_credentials":
        lambda p: bool(p.get("exposes_credentials")),
    "crosses_tenant":
        lambda p: bool(p.get("crosses_tenant")),
    "silent_privilege_change":
        lambda p: bool(p.get("privilege_change") and not p.get("approval_recorded")),
    "confidence_over_policy":
        lambda p: bool(p.get("ai_confidence_high") and p.get("security_policy_conflict")),
    "deletes_retained_evidence":
        lambda p: bool(p.get("evidence_deletion") and p.get("retention_conflict")),
    "unverified_fix_claim":
        lambda p: bool(p.get("claims_fixed") and not p.get("fix_verified")),
}


async def list_laws(db: Any, user: dict) -> dict:
    custom = await db.nexus_laws.find(
        tenant_scoped_query(user, {"enabled": {"$ne": False}}), {"_id": 0}
    ).limit(100).to_list(100)
    return {
        "builtin": BUILTIN_LAWS,
        "custom": custom,
        "precedence": "Laws sit above users, scripts, integrations, AI and automations. "
                      "Autonomy bounded by deterministic rules.",
    }


async def record_law(db: Any, user: dict, payload: dict) -> dict:
    """A custom MSP/customer law: forbidden action, approval requirement, or time window."""
    kind = str(payload.get("kind") or "").strip()
    if kind not in {"forbidden_action", "approval_required", "time_window"}:
        raise ValueError("kind must be forbidden_action, approval_required or time_window")
    law = {
        "id": str(uuid.uuid4()),
        "tenant_id": platform_tenant_id(user),
        "kind": kind,
        "text": str(payload.get("text") or "").strip()[:300],
        "pattern": str(payload.get("pattern") or "").strip().lower()[:100],
        "target_pattern": str(payload.get("target_pattern") or "").strip().lower()[:200],
        "blocked_weekdays": payload.get("blocked_weekdays") or [],
        "blocked_start_hour": payload.get("blocked_start_hour"),
        "blocked_end_hour": payload.get("blocked_end_hour"),
        "created_by": user.get("id"),
        "created_at": _iso(_utcnow()),
        "enabled": True,
    }
    await db.nexus_laws.insert_one(law)
    law.pop("_id", None)
    return law


async def evaluate_action(db: Any, user: dict, payload: dict) -> dict:
    """Deterministic pre-action gate. Blocked beats approval beats human-review beats allowed."""
    action = str(payload.get("action_type") or "").strip().lower()
    target = str(payload.get("target") or "").strip().lower()
    decisions: list[dict] = []

    for law in BUILTIN_LAWS:
        if _BUILTIN_CONDITIONS[law["condition"]](payload):
            decisions.append({"law_id": law["id"], "law": law["text"], "decision": "blocked",
                              "reason": "Action description violates this invariant."})

    custom = await db.nexus_laws.find(
        tenant_scoped_query(user, {"enabled": {"$ne": False}}), {"_id": 0}
    ).limit(100).to_list(100)
    now = _parse_iso(payload.get("scheduled_time")) or _utcnow()
    for law in custom:
        matches = ((not law.get("pattern")) or law["pattern"] in action) \
            and ((not law.get("target_pattern")) or law["target_pattern"] in target)
        if not matches:
            continue
        if law.get("kind") == "forbidden_action":
            decisions.append({"law_id": law["id"], "law": law.get("text"), "decision": "blocked",
                              "reason": f"Custom law forbids '{law.get('pattern') or 'any action'}' on "
                                        f"'{law.get('target_pattern') or 'any target'}'."})
        elif law.get("kind") == "approval_required":
            decisions.append({"law_id": law["id"], "law": law.get("text"), "decision": "needs_approval",
                              "reason": "Two-person approval required before this action proceeds."})
        elif law.get("kind") == "time_window":
            blocked_days = {int(d) for d in (law.get("blocked_weekdays") or [])}
            start = law.get("blocked_start_hour")
            end = law.get("blocked_end_hour")
            in_day = now.weekday() in blocked_days
            in_hour = (start is None and end is None) or (
                start is not None and end is not None and int(start) <= now.hour < int(end))
            if in_day and in_hour:
                decisions.append({"law_id": law["id"], "law": law.get("text"), "decision": "blocked",
                                  "reason": f"Scheduled {now.strftime('%A %H:%M')} falls inside the protected window. "
                                            f"It's Friday at {now.strftime('%H:%M')}. Nexus is not letting this happen today."})
            else:
                decisions.append({"law_id": law["id"], "law": law.get("text"), "decision": "allowed",
                                  "reason": "Outside the protected window."})

    order = {"blocked": 0, "needs_approval": 1, "needs_human": 2, "allowed": 3}
    decisions.sort(key=lambda d: order.get(d["decision"], 3))
    worst = decisions[0]["decision"] if decisions else "allowed"
    verdict = {"blocked": "BLOCKED — a Nexus Law forbids this action.",
               "needs_approval": "Needs human approval — a law requires two-person sign-off.",
               "needs_human": "Human review required.",
               "allowed": "Allowed — all Nexus Laws satisfied."}[worst if worst in ("blocked", "needs_approval", "needs_human", "allowed") else "needs_human"]
    return {
        "action_type": action,
        "target": target,
        "overall": worst if worst != "allowed" or not decisions else "allowed",
        "decisions": decisions,
        "verdict": verdict,
    }


# ============== CREDENTIAL LEAK GUARD ("Absolutely not.") ==============

_CREDENTIAL_PATTERNS = [
    ("private_key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")),
    ("cloud_access_key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("api_token", re.compile(r"\b(?:ghp_|xox[baprs]-|sk-)[A-Za-z0-9_-]{16,}\b")),
    ("credential_assignment",
     re.compile(r"(?i)\b(password|passwd|pwd|secret|api[ _-]?key|access[ _-]?token|credential)\b\s*[:=]\s*\S+")),
]


async def credential_scan(_db: Any, _user: dict, text: str) -> dict:
    """Detect credentials in a draft — and never, ever echo the secret back."""
    redacted = str(text or "")
    findings: list[dict] = []
    for kind, pattern in _CREDENTIAL_PATTERNS:
        for match in pattern.finditer(redacted):
            label = match.group(1) if match.lastindex else kind.replace("_", " ")
            findings.append({"kind": kind, "field": str(label).lower(),
                             "masked": "[REDACTED — never pasted into tickets]"})
        redacted = pattern.sub("[REDACTED credential]", redacted)
    return {
        "detected": bool(findings),
        "findings": findings,
        "redacted_text": redacted,
        "verdict": ("🚨 Absolutely not. Nexus detected a credential and removed it from the draft."
                    if findings else "No credentials detected in this text."),
        "guidance": "Store securely instead — use the credential vault / integration secret store." if findings else "",
    }


# ============== TICKET REALITY CHECKS & TECHNICIAN PRESENCE EFFECT ==============

async def ticket_reality_check(db: Any, user: dict, ticket_id: str) -> dict:
    """Urgency punctuation, definition of insanity, 'nobody changed anything', 'it never worked'."""
    ticket = await db.tickets.find_one(tenant_scoped_query(user, {"id": ticket_id}), {"_id": 0})
    if not ticket:
        return {"found": False}
    now = _utcnow()
    findings: list[dict] = []

    title = f"{ticket.get('title') or ''} {ticket.get('subject') or ''}"
    bangs = title.count("!")
    if bangs >= 3:
        findings.append({"kind": "urgency_punctuation",
                         "line": f"Urgency punctuation detected: {bangs} exclamation marks. "
                                 f"Technical severity remains {ticket.get('priority') or 'unrated'}."})

    device_id = ticket.get("device_id") or (ticket.get("device_ids") or [None])[0]
    if device_id:
        window = _iso(now - timedelta(hours=72))
        repeats = await db.device_events.count_documents(
            tenant_scoped_query(user, {"device_id": device_id,
                                       "event_type": {"$in": ["script_executed", "service_restart"]},
                                       "timestamp": {"$gte": window}}))
        if repeats >= 3:
            findings.append({"kind": "insanity_threshold",
                             "line": "Definition of insanity threshold approaching — the same remediation has run "
                                     f"{repeats} times in 72h. Want to try a different diagnostic path?"})

    changes = await db.ticket_audit_log.find(
        tenant_scoped_query(user, {"ticket_id": ticket_id}), {"_id": 0}
    ).sort("created_at", -1).limit(5).to_list(5)
    if device_id:
        changes += await db.device_events.find(
            tenant_scoped_query(user, {"device_id": device_id, "timestamp": {"$gte": _iso(now - timedelta(days=7))}}),
            {"_id": 0}).limit(5).to_list(5)
    if changes:
        findings.append({"kind": "nobody_changed_anything",
                         "line": "Narrator: somebody changed something.",
                         "changes": [str(c.get("details") or c.get("message") or c.get("event_type") or "change") for c in changes[:5]]})

    if device_id:
        successes = await db.device_events.find(
            tenant_scoped_query(user, {"device_id": device_id,
                                       "event_type": {"$in": ["agent_check_in", "login", "backup_completed"]}}),
            {"_id": 0}).sort("timestamp", -1).limit(1).to_list(1)
        if successes:
            age = _days_since(successes[0].get("timestamp"))
            findings.append({"kind": "never_worked",
                             "line": f"Evidence suggests it worked successfully "
                                     f"{age if age is not None else 'recently'} day(s) ago. Would you like the timeline?"})

    return {"found": True, "ticket_id": ticket.get("id"), "ticket_number": ticket.get("ticket_number"),
            "findings": findings,
            "verdict": ("Reality checks complete — " + str(len(findings)) + " note(s) for the technician."
                        if findings else "Reality checks complete. The ticket's story checks out.")}


async def presence_effect(db: Any, user: dict) -> dict:
    """'It only does it when you're not here' — measured. Problems fixed by a technician connecting."""
    sessions = await db.work_activity_audit.find(
        tenant_scoped_query(user, {"work_item": "remote", "event": "viewed"}), {"_id": 0}
    ).limit(200).to_list(200)
    resolved = await db.tickets.find(
        tenant_scoped_query(user, {"status": {"$in": ["resolved", "closed"]}, "resolved_at": {"$ne": None}}),
        {"_id": 0, "resolved_at": 1, "assigned_name": 1},
    ).limit(500).to_list(500)

    per_tech: dict[str, int] = {}
    for session in sessions:
        started = _parse_iso(session.get("created_at"))
        if not started:
            continue
        for ticket in resolved:
            ended = _parse_iso(ticket.get("resolved_at"))
            if ended and 0 <= (ended - started).total_seconds() <= 30 * 60:
                tech = session.get("user_name") or ticket.get("assigned_name") or "unknown"
                per_tech[tech] = per_tech.get(tech, 0) + 1

    total = sum(per_tech.values())
    return {
        "per_technician": [{"technician": tech, "count": count}
                           for tech, count in sorted(per_tech.items(), key=lambda kv: -kv[1])],
        "total": total,
        "verdict": (f"Technician Presence Effect confirmed: {total} problem(s) mysteriously fixed within 30 minutes "
                    "of a remote session beginning." if total
                    else "No Technician Presence Effect recorded yet — either the aura is weak or sessions aren't tracked here."),
    }
