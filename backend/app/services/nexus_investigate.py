"""Mission Control · Investigate: tell Nexus what appears wrong, not which tool.

``backend/app/routers/mission_control.py`` already exists, and it is a *different*
surface: a portfolio briefing across the whole MSP (panels, workstreams, today's
focus). This module is the per-problem orchestrator the platform was missing —
one reported problem in, and out comes the assembled scope, the tools worth
opening, the hypotheses, the single next action, and an explicit statement of
when a human must decide instead of Nexus.

It is deliberately an *orchestrator*, not a second engine:

* The hypothesis arithmetic and the evidence trail belong to
  ``nexus_diagnostics``. This module opens a diagnostic investigation and records
  its id; it never re-implements a posterior.
* Fleet membership belongs to ``nexus_fleet_shell``; drift belongs to
  ``nexus_device_state``; proof belongs to ``nexus_evidence``. This module names
  them as tools and links to them.
* ``nexus_operational_mode`` decides whether the next action may execute at all.

Honesty boundaries:

* Every tool in the catalog carries the endpoint that actually exists and states
  what it needs. Nexus does not advertise a tool it cannot call.
* Subject resolution is a *lookup*, not a guess: when the free text cannot be
  tied to a record in the caller's tenant, the investigation is opened in
  ``awaiting_subject`` state and says so instead of inventing a device.
* ``human_decision_required`` is set from stated rules, and each reason is
  returned with it. Nexus flags an identity or change-derived fix for a human
  because restoring access or reversing a policy can conflict with a decision
  Nexus cannot see — it does not pretend to see that decision.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any

from app.services import nexus_operational_mode
from app.services.scope_permissions import platform_tenant_id, tenant_scoped_query

SUBJECT_TYPES = ("device", "user", "client")

STATUSES = ("open", "awaiting_subject", "closed")

CLOSE_OUTCOMES = ("resolved", "referred", "inconclusive")

#: Domains whose remediation changes what a person can do, so a human decides.
HUMAN_DECISION_DOMAINS = ("identity", "change")

MAX_SCOPE_ROWS = 8

#: The tools Mission Control can reach, mapped to the endpoint that really exists.
TOOLS: tuple[dict[str, Any], ...] = (
    {"tool": "diagnostic_workbench", "label": "Diagnostic Workbench", "domain": "hypotheses",
     "endpoint": "/tech-fun/diagnostics/investigations", "requires": "a subject in your scope",
     "answers": "Which cause is most likely, and which single test removes the most doubt?"},
    {"tool": "find_everywhere", "label": "Find Everywhere", "domain": "references",
     "endpoint": "/tech-fun/find", "requires": "a value to look up",
     "answers": "Where else does this value appear, and what breaks if it changes?"},
    {"tool": "state_engine", "label": "State Engine / Drift Control", "domain": "endpoint",
     "endpoint": "/tech-fun/state-engine/evaluate/{device_id}", "requires": "a device in your scope",
     "answers": "Does this machine match what it is supposed to look like?"},
    {"tool": "fleet_shell", "label": "Fleet Shell", "domain": "scope",
     "endpoint": "/tech-fun/fleet/query", "requires": "filters",
     "answers": "How many endpoints are actually affected, as an actionable object set?"},
    {"tool": "evidence", "label": "Evidence Engine", "domain": "proof",
     "endpoint": "/tech-fun/evidence", "requires": "a recorded operation",
     "answers": "Is there proof this operation actually succeeded?"},
    {"tool": "rescue", "label": "Nexus Rescue", "domain": "recovery",
     "endpoint": "/tech-fun/rescue/console/{device_id}", "requires": "a device in your scope",
     "answers": "What is still reachable when the agent or Windows itself is broken?"},
    {"tool": "synthetic_employee", "label": "Synthetic Employee", "domain": "business-service",
     "endpoint": "/tech-fun/synthetic/identities", "requires": "a registered test identity",
     "answers": "Does the business workflow itself still work for a user?"},
    {"tool": "intent_evaluation", "label": "Intent OS evaluation", "domain": "intent",
     "endpoint": "/tech-fun/intent-evaluation", "requires": "recorded intents",
     "answers": "Which stated business outcome is currently drifting from reality?"},
)

_TOOLS_BY_DOMAIN: dict[str, list[str]] = {}
for _entry in TOOLS:
    _TOOLS_BY_DOMAIN.setdefault(_entry["domain"], []).append(_entry["tool"])

#: Which tools are worth opening first for a given cause domain. Deterministic
#: and published; it narrows attention, it does not run anything.
DOMAIN_TOOLS: dict[str, tuple[str, ...]] = {
    "application": ("diagnostic_workbench", "synthetic_employee", "evidence"),
    "identity": ("diagnostic_workbench", "intent_evaluation", "evidence"),
    "endpoint": ("state_engine", "diagnostic_workbench", "rescue"),
    "network": ("find_everywhere", "diagnostic_workbench", "rescue"),
    "change": ("find_everywhere", "state_engine", "intent_evaluation"),
}

TOKEN_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{2,63}")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat()


def tool_catalog() -> dict:
    """Every tool Mission Control can reach, and what each one needs."""
    return {
        "tools": [dict(entry) for entry in TOOLS],
        "by_domain": {domain: list(names) for domain, names in sorted(_TOOLS_BY_DOMAIN.items())},
        "note": ("Each entry names the endpoint that actually exists and what it requires. Mission "
                 "Control selects tools; the tools still own their own evidence and verdicts."),
    }


def _tokens(text: str) -> list[str]:
    return [match for match in TOKEN_RE.findall(text or "")]


async def _resolve_subject(db: Any, user: dict, payload: dict) -> dict:
    """Tie the report to a record that exists in the caller's tenant, or say so."""
    subject_type = str(payload.get("subject_type") or "").strip()
    subject_id = str(payload.get("subject_id") or "").strip()
    if subject_type and subject_id:
        if subject_type not in SUBJECT_TYPES:
            return {"resolved": False, "reason": f"subject_type must be one of {', '.join(SUBJECT_TYPES)}"}
        collection = {"device": "devices", "user": "users", "client": "clients"}[subject_type]
        row = await getattr(db, collection).find_one(
            tenant_scoped_query(user, {"id": subject_id}), {"_id": 0})
        if not row:
            return {"resolved": False, "reason": "that subject is not in your scope"}
        return {"resolved": True, "subject": {
            "type": subject_type, "id": subject_id,
            "label": str(row.get("name") or row.get("hostname") or subject_id),
            "client_id": str(row.get("client_id") or ""),
        }}

    # Free text: look for a device hostname first, then a person's name. A lookup,
    # not a guess — unknown stays unknown.
    for token in _tokens(str(payload.get("problem") or "")):
        device = await db.devices.find_one(
            tenant_scoped_query(user, {"hostname": token.upper()}), {"_id": 0})
        if device:
            return {"resolved": True, "subject": {
                "type": "device", "id": str(device.get("id")),
                "label": str(device.get("hostname") or device.get("name") or ""),
                "client_id": str(device.get("client_id") or ""),
            }}
    lowered = str(payload.get("problem") or "").lower()
    for token in _tokens(lowered):
        person = await db.users.find_one(
            tenant_scoped_query(user, {"name": token.capitalize()}), {"_id": 0})
        if person:
            return {"resolved": True, "subject": {
                "type": "user", "id": str(person.get("id")),
                "label": str(person.get("name") or ""),
                "client_id": str(person.get("client_id") or ""),
            }}
    return {"resolved": False,
            "reason": "no device hostname or person in your scope matched this report"}


async def _assemble_scope(db: Any, user: dict, subject: dict, client_id: str) -> dict:
    """What Nexus can actually read about this problem, each row naming its source."""
    rows: list[dict] = []
    if subject and subject.get("id") and subject.get("type") == "device":
        device = await db.devices.find_one(
            tenant_scoped_query(user, {"id": subject["id"]}), {"_id": 0})
        if device:
            rows.append({"kind": "device", "source": "devices", "count": 1,
                         "detail": f"{device.get('hostname') or subject['id']} last seen "
                                   f"{device.get('last_seen') or 'never'}"})
        drift = await db.drift_findings.find(
            tenant_scoped_query(user, {"device_id": subject["id"],
                                       "status": {"$in": ["open", "remediation_proposed"]}}),
            {"_id": 0}).limit(MAX_SCOPE_ROWS).to_list(MAX_SCOPE_ROWS)
        if drift:
            rows.append({"kind": "drift", "source": "drift_findings", "count": len(drift),
                         "detail": "open drift on " + ", ".join(
                             str(item.get("check")) for item in drift[:MAX_SCOPE_ROWS])})
    if client_id:
        open_tickets = await db.tickets.count_documents(tenant_scoped_query(user, {
            "client_id": client_id,
            "status": {"$in": ["open", "in_progress", "waiting", "pending"]}}))
        rows.append({"kind": "incidents", "source": "tickets", "count": open_tickets,
                     "detail": "open tickets for this customer"})
        devices = await db.devices.count_documents(
            tenant_scoped_query(user, {"client_id": client_id}))
        rows.append({"kind": "estate", "source": "devices", "count": devices,
                     "detail": "managed devices for this customer"})
    return {
        "rows": rows,
        "sources_read": sorted({row["source"] for row in rows}),
        "note": ("Observed counts only, each naming the store it came from. Nothing here has been "
                 "interpreted as a cause."),
    }


def _select_tools(subject: dict, scope: dict) -> dict:
    """Which tools are worth opening, and why. Selection only — nothing is run."""
    selected: list[dict] = ["diagnostic_workbench"]
    if any(row["kind"] == "drift" for row in scope.get("rows") or []):
        selected.append("state_engine")
    if any(row["kind"] == "estate" for row in scope.get("rows") or []):
        selected.append("fleet_shell")
    if subject and subject.get("type") == "device":
        selected.append("state_engine")
    ordered: list[str] = []
    for name in selected:
        if name not in ordered:
            ordered.append(name)
    catalog = {entry["tool"]: entry for entry in TOOLS}
    return {
        "selected": [catalog[name] for name in ordered if name in catalog],
        "note": ("Selected from the published catalog. Nexus narrows attention; it does not open "
                 "these for you and it does not run them."),
    }


def _human_decision(*, cause_domain: str, conflict: str, mode: dict,
                    execution_allowed: bool) -> dict:
    """Why a human must decide. Stated rules, each with its reason."""
    reasons: list[dict] = []
    if cause_domain in HUMAN_DECISION_DOMAINS:
        reasons.append({
            "reason": f"the isolated cause is in the {cause_domain} domain",
            "detail": ("Restoring access or reversing a policy change can conflict with a decision "
                       "Nexus cannot see — an HR update, a customer instruction or an accepted risk."),
        })
    if conflict:
        reasons.append({"reason": "a stated conflict was supplied", "detail": conflict[:400]})
    if not execution_allowed:
        reasons.append({"reason": "the platform is not permitted to execute right now",
                        "detail": str(mode.get("reason") or "")})
    return {"required": bool(reasons), "reasons": reasons}


def _next_action(*, diagnostics_id: str, isolated: dict | None, scope: dict,
                 execution_allowed: bool, mode: dict) -> dict:
    if not diagnostics_id:
        return {"action": "open_a_diagnostic_investigation",
                "tool": "diagnostic_workbench",
                "detail": "No hypothesis work has started for this problem yet.",
                "execution_permitted": execution_allowed,
                "mode_reason": str(mode.get("reason") or "")}
    if isolated:
        return {"action": "apply_then_prove",
                "tool": "evidence",
                "detail": (f"A cause is isolated in the {isolated.get('domain')} domain. Apply the fix, "
                           "then record the operation evidence so success is proven rather than assumed."),
                "execution_permitted": execution_allowed,
                "mode_reason": str(mode.get("reason") or "")}
    return {"action": "record_evidence_for_the_next_best_test",
            "tool": "diagnostic_workbench",
            "detail": "Record the result of the next best test; that is what moves the answer.",
            "execution_permitted": execution_allowed,
            "mode_reason": str(mode.get("reason") or "")}


def _public(row: dict) -> dict:
    return {
        "id": row.get("id"),
        "problem": row.get("problem"),
        "status": row.get("status"),
        "subject": row.get("subject") or {},
        "client_id": row.get("client_id") or "",
        "ticket_id": row.get("ticket_id") or "",
        "scope": row.get("scope") or {},
        "tools": row.get("tools") or {},
        "diagnostics_investigation_id": row.get("diagnostics_investigation_id") or "",
        "next_action": row.get("next_action") or {},
        "human_decision": row.get("human_decision") or {"required": False, "reasons": []},
        "decisions": row.get("decisions") or [],
        "close_outcome": row.get("close_outcome") or "",
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


async def _refresh(db: Any, user: dict, row: dict) -> dict:
    """Recompute the live parts of a mission investigation from real records."""
    mode = await nexus_operational_mode.current_mode(db, user)
    diagnostics_id = str(row.get("diagnostics_investigation_id") or "")
    isolated = None
    if diagnostics_id:
        investigation = await db.investigations.find_one(
            tenant_scoped_query(user, {"id": diagnostics_id}), {"_id": 0})
        if investigation:
            isolated = investigation.get("root_cause")
    client_id = str(row.get("client_id") or "")
    execution_allowed = bool(nexus_operational_mode.permits(
        mode, client_id=client_id, capability="device_remediation")["allowed"])
    cause_domain = str((isolated or {}).get("domain") or "")
    conflict = str(row.get("conflict") or "")
    return {
        "next_action": _next_action(diagnostics_id=diagnostics_id, isolated=isolated,
                                    scope=row.get("scope") or {},
                                    execution_allowed=execution_allowed, mode=mode),
        "human_decision": _human_decision(cause_domain=cause_domain, conflict=conflict,
                                          mode=mode, execution_allowed=execution_allowed),
        "isolated_cause": isolated,
        "operational_mode": mode["mode"],
    }


async def investigate(db: Any, user: dict, name: str, payload: dict) -> dict:
    """Assemble everything Nexus has about one reported problem."""
    problem = str(payload.get("problem") or "").strip()
    if not problem:
        return {"found": False, "error": "problem is required — describe what appears wrong"}
    resolved = await _resolve_subject(db, user, payload)
    if resolved.get("reason") and str(payload.get("subject_type") or "").strip():
        # An explicitly supplied subject that does not exist is a bad request, not
        # a silent downgrade to "unresolved".
        return {"found": False, "error": resolved["reason"]}

    subject = resolved.get("subject") or {}
    client_id = str(payload.get("client_id") or subject.get("client_id") or "")
    scope = await _assemble_scope(db, user, subject, client_id)
    tools = _select_tools(subject, scope)
    now = _utcnow()

    linked = str(payload.get("diagnostics_investigation_id") or "").strip()
    if linked:
        existing = await db.investigations.find_one(
            tenant_scoped_query(user, {"id": linked}), {"_id": 0})
        if not existing:
            return {"found": False,
                    "error": "that diagnostic investigation is not in your scope"}

    row = {
        "id": f"MCI-{uuid.uuid4().hex[:12].upper()}",
        "tenant_id": platform_tenant_id(user),
        "problem": problem[:500],
        "status": "open" if resolved.get("resolved") else "awaiting_subject",
        "subject": subject,
        "client_id": client_id[:64],
        "ticket_id": str(payload.get("ticket_id") or "")[:64],
        "conflict": str(payload.get("conflict") or "")[:400],
        "scope": scope,
        "tools": tools,
        "diagnostics_investigation_id": linked,
        "decisions": [],
        "close_outcome": "",
        "created_by": user.get("id"),
        "created_by_name": name,
        "created_at": _iso(now),
        "updated_at": _iso(now),
    }
    await db.mission_investigations.insert_one(row)
    row.pop("_id", None)
    live = await _refresh(db, user, row)
    row.update(live)

    note = ("Scope assembled from observable records only. Open the diagnostic investigation to start "
            "the hypothesis work — Mission Control selects tools, it does not run them.")
    if not resolved.get("resolved"):
        note = (f"Opened as awaiting_subject: {resolved.get('reason')}. Nexus will not invent a device "
                "from the report — attach the real subject and the scope becomes real.")
    return {
        "found": True,
        "investigation": _public(row),
        "resolved": bool(resolved.get("resolved")),
        "note": note,
    }


async def get_investigation(db: Any, user: dict, mission_id: str) -> dict:
    """One investigation with its live next action and human-decision gate."""
    row = await db.mission_investigations.find_one(
        tenant_scoped_query(user, {"id": mission_id}), {"_id": 0})
    if not row:
        return {"found": False}
    row.update(await _refresh(db, user, row))
    return {"found": True, "investigation": _public(row)}


async def attach_subject(db: Any, user: dict, name: str, mission_id: str, payload: dict) -> dict:
    """Attach or correct the subject, then rebuild the scope from real records."""
    row = await db.mission_investigations.find_one(
        tenant_scoped_query(user, {"id": mission_id}), {"_id": 0})
    if not row:
        return {"found": False}
    if row.get("status") == "closed":
        return {"found": False, "error": "investigation is closed — attach is recorded once"}
    resolved = await _resolve_subject(db, user, {
        "problem": row.get("problem"),
        "subject_type": payload.get("subject_type"),
        "subject_id": payload.get("subject_id"),
    })
    if not resolved.get("resolved"):
        return {"found": False, "error": str(resolved.get("reason") or "subject not found")}

    subject = resolved["subject"]
    client_id = str(payload.get("client_id") or subject.get("client_id") or "")
    scope = await _assemble_scope(db, user, subject, client_id)
    updates = {
        "subject": subject,
        "client_id": client_id[:64],
        "scope": scope,
        "tools": _select_tools(subject, scope),
        "status": "open",
        "updated_at": _iso(_utcnow()),
    }
    await db.mission_investigations.update_one(
        {"id": mission_id, "tenant_id": row.get("tenant_id")}, {"$set": updates})
    row.update(updates)
    row.update(await _refresh(db, user, row))
    return {"found": True, "investigation": _public(row),
            "note": "Scope rebuilt from the attached subject's real records."}


async def record_decision(db: Any, user: dict, name: str, mission_id: str, payload: dict) -> dict:
    """Record the human decision and what was chosen — append-only."""
    row = await db.mission_investigations.find_one(
        tenant_scoped_query(user, {"id": mission_id}), {"_id": 0})
    if not row:
        return {"found": False}
    if row.get("status") == "closed":
        return {"found": False, "error": "investigation is closed — decisions are recorded once"}
    decision = str(payload.get("decision") or "").strip()
    if not decision:
        return {"found": False, "error": "decision is required"}
    entry = {
        "decision": decision[:400],
        "chosen": str(payload.get("chosen") or "")[:200],
        "reason": str(payload.get("reason") or "")[:1000],
        "conflict": str(payload.get("conflict") or "")[:400],
        "by": name,
        "at": _iso(_utcnow()),
    }
    linked = str(payload.get("diagnostics_investigation_id") or "").strip()
    decisions = list(row.get("decisions") or []) + [entry]
    updates = {"decisions": decisions, "updated_at": entry["at"]}
    if linked:
        existing = await db.investigations.find_one(
            tenant_scoped_query(user, {"id": linked}), {"_id": 0})
        if not existing:
            return {"found": False,
                    "error": "that diagnostic investigation is not in your scope"}
        updates["diagnostics_investigation_id"] = linked
    if entry["conflict"]:
        updates["conflict"] = entry["conflict"]
    await db.mission_investigations.update_one(
        {"id": mission_id, "tenant_id": row.get("tenant_id")}, {"$set": updates})
    row.update(updates)
    row.update(await _refresh(db, user, row))
    return {"found": True, "investigation": _public(row),
            "note": ("Decision recorded with its author and reason. Nexus keeps the trail so the next "
                     "technician can see why a fix was refused, not just that it was.")}


async def close_investigation(db: Any, user: dict, name: str, mission_id: str,
                             payload: dict) -> dict:
    """Close with an honest outcome; the scope and decisions stay."""
    outcome = str(payload.get("outcome") or "").strip().lower()
    if outcome not in CLOSE_OUTCOMES:
        return {"found": False, "error": f"outcome must be one of {', '.join(CLOSE_OUTCOMES)}"}
    row = await db.mission_investigations.find_one(
        tenant_scoped_query(user, {"id": mission_id}), {"_id": 0})
    if not row:
        return {"found": False}
    if row.get("status") == "closed":
        return {"found": False, "error": "investigation is already closed — closing is recorded once"}
    now = _utcnow()
    updates = {"status": "closed", "close_outcome": outcome, "closed_by": name,
               "closed_at": _iso(now), "updated_at": _iso(now)}
    await db.mission_investigations.update_one(
        {"id": mission_id, "tenant_id": row.get("tenant_id")}, {"$set": updates})
    row.update(updates)
    row.update(await _refresh(db, user, row))
    note = {"resolved": "Closed as resolved. The evidence trail stays for the next technician.",
            "referred": "Closed and referred on. Nothing was invented to make this look finished.",
            "inconclusive": ("Closed without a confirmed cause. An honest unresolved investigation is "
                             "more useful than a guessed one.")}[outcome]
    return {"found": True, "investigation": _public(row), "note": note}


async def list_investigations(db: Any, user: dict, status: str | None = None) -> dict:
    """Open and recent mission investigations in tenant scope."""
    query: dict = {}
    if status:
        if status not in STATUSES:
            return {"found": False, "error": f"status must be one of {', '.join(STATUSES)}"}
        query["status"] = status
    rows = await db.mission_investigations.find(tenant_scoped_query(user, query), {"_id": 0}) \
        .sort("updated_at", -1).limit(100).to_list(100)
    items = []
    for row in rows:
        human = row.get("human_decision") or {}
        items.append({
            "id": row.get("id"),
            "problem": row.get("problem"),
            "status": row.get("status"),
            "subject": row.get("subject") or {},
            "client_id": row.get("client_id") or "",
            "human_decision_required": bool(human.get("required")),
            "next_action": (row.get("next_action") or {}).get("action"),
            "updated_at": row.get("updated_at"),
        })
    return {
        "count": len(items),
        "investigations": items,
        "awaiting_subject": sum(1 for item in items if item["status"] == "awaiting_subject"),
        "human_decision": sum(1 for item in items if item["human_decision_required"]),
        "note": ("Each investigation keeps its scope and decisions, so a problem does not have to be "
                 "re-triaged from scratch."),
    }
