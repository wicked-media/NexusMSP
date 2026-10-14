"""Nexus intent model: business intent in, continuous desired-state out.

The Intent OS primitive. Instead of configuring technology, the MSP or customer
states the outcome they want ("every employee handling financial data must be
strongally authenticated, encrypted and backed up"); Nexus compiles it into
checkable controls and continuously evaluates drift against live authoritative
records.

This module is deliberately deterministic: controls are evaluated from stored
Nexus data only. Where the evidence to judge a control does not exist, the
verdict is ``unverified`` — never ``met``. Nothing here provisions anything yet;
execution belongs to the autonomy stack and always passes the Laws gate.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any

from app.services.scope_permissions import platform_tenant_id, tenant_scoped_query

INTENT_STATES = ("active", "retired")
CONTROL_VERDICTS = ("met", "drifting", "unverified")

# Keywords in a plain-English statement → suggested control kinds.
# Suggestions only; the recorded controls are what get evaluated.
_STATEMENT_HINTS: tuple[tuple[str, tuple[str, ...]], ...] = (
    (r"\bmfa\b|multi[- ]factor|strongly authenticated|2fa", ("mfa",)),
    (r"\bencrypt", ("encryption",)),
    (r"\bback(?:ed)?\b[\w\s]{0,16}\bup\b|\brecover", ("backup_verified",)),
    (r"\bpatch|up[- ]to[- ]date|updated?", ("patch_currency",)),
    (r"\bedr|antivirus|endpoint protection|malware", ("endpoint_protection",)),
    (r"unmanaged|compliant device|managed device", ("device_compliance",)),
    (r"\baudit|evidence|prove", ("evidence_freshness",)),
    (r"\bdocument", ("documentation",)),
    (r"\bssl|certificate|tls", ("certificate_validity",)),
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat()


def suggest_controls(statement: str) -> list[str]:
    """Heuristic keyword → control suggestions for a plain-English statement."""
    text = str(statement or "").lower()
    kinds: list[str] = []
    for pattern, controls in _STATEMENT_HINTS:
        if re.search(pattern, text):
            for control in controls:
                if control not in kinds:
                    kinds.append(control)
    return kinds


def _normalise_controls(payload: dict) -> list[dict]:
    raw = payload.get("controls")
    controls: list[dict] = []
    for item in raw or []:
        if isinstance(item, str):
            kind = item.strip().lower()
            controls.append({"kind": kind, "scope": "estate"})
        elif isinstance(item, dict):
            kind = str(item.get("kind") or "").strip().lower()
            if not kind:
                continue
            controls.append({
                "kind": kind,
                "scope": str(item.get("scope") or "estate").strip().lower(),
                "note": str(item.get("note") or "").strip()[:200],
            })
    return controls


async def record_intent(db: Any, user: dict, actor_name: str, payload: dict) -> dict:
    """Record a business intent: what the customer wants to be true, continuously."""
    statement = str(payload.get("statement") or "").strip()
    if not statement:
        return {"found": False, "error": "statement is required"}
    controls = _normalise_controls(payload)
    if not controls:
        controls = [{"kind": kind, "scope": "estate"} for kind in suggest_controls(statement)]
    if not controls:
        return {"found": False, "error": "no controls supplied and none could be suggested"}

    now = _iso(_utcnow())
    intent_id = f"INT-{uuid.uuid4().hex[:10]}"
    document = {
        "id": intent_id,
        "tenant_id": platform_tenant_id(user),
        "client_id": str(payload.get("client_id") or "").strip() or None,
        "statement": statement,
        "controls": controls,
        "state": "active",
        "created_by": str(actor_name or "").strip()[:120] or "unknown",
        "created_at": now,
        "updated_at": now,
    }
    await db.nexus_intents.insert_one(document)
    return {"found": True, "intent": _public(document)}


async def list_intents(db: Any, user: dict, client_id: str | None = None) -> dict:
    query: dict = {"state": "active"}
    if client_id:
        query["client_id"] = client_id
    rows = await db.nexus_intents.find(tenant_scoped_query(user, query), {"_id": 0}).to_list(200)
    return {"intents": [_public(row) for row in rows], "count": len(rows)}


def _public(document: dict) -> dict:
    return {key: value for key, value in document.items() if key != "_id"}


# ============== CONTROL EVALUATION (deterministic, honest) ==============


async def _check_mfa(db: Any, user: dict, client_id: str | None) -> dict:
    users = await db.users.find(tenant_scoped_query(user, {"state": {"$ne": "disabled"}}), {"_id": 0}).to_list(500)
    if client_id:
        users = [u for u in users if not u.get("client_id") or u.get("client_id") == client_id]
    if not users:
        return {"verdict": "unverified", "reason": "no user records to judge MFA state"}
    with_mfa = [u for u in users if u.get("mfa_enabled") or u.get("mfa")]
    privileged = [u for u in users if u.get("is_admin") or u.get("role") == "admin"]
    privileged_mfa = [u for u in privileged if u.get("mfa_enabled") or u.get("mfa")]
    unverified_count = sum(1 for u in users if u.get("mfa_enabled") is None and u.get("mfa") is None)
    if unverified_count == len(users):
        return {"verdict": "unverified", "reason": "user records carry no MFA state"}
    if privileged and len(privileged_mfa) < len(privileged):
        return {"verdict": "drifting",
                "reason": f"{len(privileged) - len(privileged_mfa)} privileged user(s) without MFA",
                "checked": len(users)}
    if len(with_mfa) < len(users):
        return {"verdict": "drifting",
                "reason": f"{len(users) - len(with_mfa)} user(s) without MFA",
                "checked": len(users)}
    return {"verdict": "met", "reason": f"all {len(users)} user(s) show MFA", "checked": len(users)}


async def _check_encryption(db: Any, user: dict, client_id: str | None) -> dict:
    query: dict = {}
    if client_id:
        query["client_id"] = client_id
    devices = await db.devices.find(tenant_scoped_query(user, query), {"_id": 0}).to_list(500)
    if not devices:
        return {"verdict": "unverified", "reason": "no devices to judge encryption state"}
    known = [d for d in devices if d.get("encrypted") is not None or d.get("disk_encryption") is not None]
    if not known:
        return {"verdict": "unverified", "reason": "device records carry no encryption state"}
    protected = [d for d in known if d.get("encrypted") or str(d.get("disk_encryption") or "").lower() in {"on", "enabled", "yes", "true"}]
    if len(protected) < len(devices):
        return {"verdict": "drifting",
                "reason": f"{len(devices) - len(protected)} device(s) without confirmed encryption",
                "checked": len(devices)}
    return {"verdict": "met", "reason": f"all {len(known)} device(s) report encryption", "checked": len(devices)}


async def _check_backup_verified(db: Any, user: dict, client_id: str | None) -> dict:
    query: dict = {"event_type": "restore_verified"}
    if client_id:
        query["client_id"] = client_id
    verified = await db.device_events.count_documents(tenant_scoped_query(user, query))
    if verified:
        return {"verdict": "met", "reason": f"{verified} restore-verified event(s) on record"}
    backups = await db.device_events.count_documents(
        tenant_scoped_query(user, {**({"client_id": client_id} if client_id else {}), "event_type": "backup_completed"}))
    if backups:
        return {"verdict": "drifting",
                "reason": f"{ backups } backup event(s) but no restore has ever been verified"}
    return {"verdict": "unverified", "reason": "no backup or restore evidence in Nexus"}


async def _check_patch_currency(db: Any, user: dict, client_id: str | None) -> dict:
    query: dict = {"status": {"$in": ["pending", "failed", "missing"]}}
    if client_id:
        query["client_id"] = client_id
    pending = await db.device_patches.count_documents(tenant_scoped_query(user, query))
    if pending:
        return {"verdict": "drifting", "reason": f"{pending} patch(es) pending or failed"}
    total = await db.device_patches.count_documents(
        tenant_scoped_query(user, {**({"client_id": client_id} if client_id else {})}))
    if not total:
        return {"verdict": "unverified", "reason": "no patch inventory in Nexus"}
    return {"verdict": "met", "reason": f"all {total} tracked patch(es) applied"}


async def _check_endpoint_protection(db: Any, user: dict, client_id: str | None) -> dict:
    query: dict = {}
    if client_id:
        query["client_id"] = client_id
    devices = await db.devices.find(tenant_scoped_query(user, query), {"_id": 0}).to_list(500)
    if not devices:
        return {"verdict": "unverified", "reason": "no devices to judge protection state"}
    known = [d for d in devices if d.get("edr") is not None or d.get("antivirus_status") is not None]
    if not known:
        return {"verdict": "unverified", "reason": "device records carry no protection state"}
    healthy = [d for d in known
               if d.get("edr") or str(d.get("antivirus_status") or "").lower() in {"active", "healthy", "enabled", "ok"}]
    if len(healthy) < len(devices):
        return {"verdict": "drifting",
                "reason": f"{len(devices) - len(healthy)} device(s) without healthy protection",
                "checked": len(devices)}
    return {"verdict": "met", "reason": f"all {len(known)} device(s) protected", "checked": len(devices)}


async def _check_certificate_validity(db: Any, user: dict, client_id: str | None) -> dict:
    query: dict = {}
    if client_id:
        query["client_id"] = client_id
    certs = await db.ssl_certificates.find(tenant_scoped_query(user, query), {"_id": 0}).to_list(200)
    if not certs:
        return {"verdict": "unverified", "reason": "no certificates tracked in Nexus"}
    now = _utcnow()
    expiring: list[str] = []
    for cert in certs:
        expires = cert.get("expires_at") or cert.get("valid_to")
        if not expires:
            continue
        try:
            expiry = datetime.fromisoformat(str(expires).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            continue
        if expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)
        if expiry <= now:
            expiring.append(str(cert.get("domain") or cert.get("id") or "certificate"))
    if expiring:
        return {"verdict": "drifting", "reason": f"{len(expiring)} expired certificate(s)", "checked": len(certs)}
    return {"verdict": "met", "reason": f"all {len(certs)} certificate(s) in date", "checked": len(certs)}


async def _check_documentation(db: Any, user: dict, client_id: str | None) -> dict:
    query: dict = {}
    if client_id:
        query["client_id"] = client_id
    devices = await db.devices.find(tenant_scoped_query(user, query), {"_id": 0}).to_list(500)
    if not devices:
        return {"verdict": "unverified", "reason": "no devices to judge documentation"}
    undocumented = [d for d in devices if not (d.get("notes") or d.get("documented"))]
    if undocumented:
        return {"verdict": "drifting",
                "reason": f"{len(undocumented)} device(s) without documentation", "checked": len(devices)}
    return {"verdict": "met", "reason": f"all {len(devices)} device(s) documented", "checked": len(devices)}


async def _check_evidence_freshness(db: Any, user: dict, client_id: str | None) -> dict:
    audit_rows = await db.work_activity_audit.count_documents(
        tenant_scoped_query(user, {**({"client_id": client_id} if client_id else {})}))
    if not audit_rows:
        return {"verdict": "drifting", "reason": "no work evidence recorded — claims cannot be proven"}
    return {"verdict": "met", "reason": f"{audit_rows} work evidence record(s) on file"}


async def _check_device_compliance(db: Any, user: dict, client_id: str | None) -> dict:
    query: dict = {}
    if client_id:
        query["client_id"] = client_id
    devices = await db.devices.find(tenant_scoped_query(user, query), {"_id": 0}).to_list(500)
    if not devices:
        return {"verdict": "unverified", "reason": "no devices to judge compliance"}
    known = [d for d in devices if d.get("compliance_state") is not None or d.get("managed") is not None]
    if not known:
        return {"verdict": "unverified", "reason": "device records carry no compliance state"}
    compliant = [d for d in known
                 if str(d.get("compliance_state") or "").lower() in {"compliant", "ok", "healthy"}
                 or d.get("managed") is True]
    if len(compliant) < len(devices):
        return {"verdict": "drifting",
                "reason": f"{len(devices) - len(compliant)} unmanaged or non-compliant device(s)",
                "checked": len(devices)}
    return {"verdict": "met", "reason": f"all {len(known)} device(s) compliant", "checked": len(devices)}


_CHECKS = {
    "mfa": _check_mfa,
    "encryption": _check_encryption,
    "backup_verified": _check_backup_verified,
    "patch_currency": _check_patch_currency,
    "endpoint_protection": _check_endpoint_protection,
    "certificate_validity": _check_certificate_validity,
    "documentation": _check_documentation,
    "evidence_freshness": _check_evidence_freshness,
    "device_compliance": _check_device_compliance,
}


def known_controls() -> list[str]:
    return sorted(_CHECKS)


async def evaluate_intents(db: Any, user: dict, client_id: str | None = None) -> dict:
    """Evaluate every active intent's controls against live data. Never fakes a verdict."""
    query: dict = {"state": "active"}
    if client_id:
        query["client_id"] = client_id
    intents = await db.nexus_intents.find(tenant_scoped_query(user, query), {"_id": 0}).to_list(200)
    evaluated: list[dict] = []
    for intent in intents:
        results = []
        for control in intent.get("controls") or []:
            kind = str(control.get("kind") or "").strip().lower()
            check = _CHECKS.get(kind)
            if not check:
                results.append({"control": kind, "verdict": "unverified",
                                "reason": f"unknown control kind '{kind}'"})
                continue
            outcome = await check(db, user, intent.get("client_id") or client_id)
            results.append({"control": kind, **outcome})
        verdicts = {r["verdict"] for r in results}
        overall = "drifting" if "drifting" in verdicts else ("unverified" if "unverified" in verdicts else "met")
        evaluated.append({**_public(intent), "results": results, "overall": overall})
    drifting = sum(1 for e in evaluated if e["overall"] == "drifting")
    return {
        "intents": evaluated,
        "count": len(evaluated),
        "drifting": drifting,
        "checked_at": _iso(_utcnow()),
    }
