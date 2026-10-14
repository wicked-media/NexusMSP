"""The Nexus Command Recorder: turn a manual fix into a reviewed runbook.

A technician records the commands they actually ran while fixing something. The
recorder keeps that session append-only, then derives a *draft* runbook from the
real steps: prerequisites, variables, actions, verification and rollback. It
never invents a step that was not recorded, and it never claims a runbook works.

The honest boundary: this module plans and records, it never executes. A draft
becomes ``verified`` only after ``MIN_VERIFIED_SUCCESSES`` recorded successes,
and even then the runbook is only an autonomy *candidate* — enabling autonomy
requires an explicit human approval that this module cannot grant itself.

Secrets are the one thing the recorder must not keep. Recorded command text is
redacted for passwords, bearer tokens, API keys and similar assignments before
it is persisted or returned, and only bounded excerpts are stored.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any

from app.services.scope_permissions import platform_tenant_id, tenant_scoped_query

SESSION_KINDS = ("manual_fix", "script", "investigation")
STEP_KINDS = ("command", "output", "action", "note", "verification", "rollback")
OUTCOMES = ("success", "failure", "partial")

# A runbook is only ever an autonomy *candidate*; three real successes is the
# point at which a human may consider offering it as an autonomous action.
MIN_VERIFIED_SUCCESSES = 3

MAX_TEXT = 2000

_ACTION_KINDS = ("command", "action")

_ELEVATION_HINTS = (
    "sudo", "runas", "elevated", "administrator",
    "net localgroup administrators", "gsudo", "psexec -s",
)

# Placeholder tokens inside recorded commands: <Name> or {Name}.
_PLACEHOLDER_RE = re.compile(r"\{([A-Za-z_][A-Za-z0-9_ .\-]{0,60})\}|<([A-Za-z_][A-Za-z0-9_ .\-]{0,60})>")

# Secrets are matched as the whole marker+value and replaced, so nothing about
# the value survives into a stored step or a returned payload.
_SECRET_PATTERNS = (
    re.compile(r"(?i)\b(?:password|passwd|pwd)\s*[=:]\s*\S+"),
    # The shape a Windows technician actually types: -Password hunter2,
    # /p secret, and the space-separated forms without an equals sign.
    re.compile(r"(?i)(?:-|--|/)(?:password|passwd|pwd|p|token|apikey|api-key)\s+\S+"),
    re.compile(r"(?i)\b(?:password|passwd|pwd)\s+\S+"),
    re.compile(r"(?i)--(?:password|passwd|token|apikey|api-key)[= ]\s*\S+"),
    re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._\-]{8,}"),
    re.compile(r"(?i)\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token"
               r"|client[_-]?secret|secret|token)\s*[=:]\s*\S+"),
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat()


def redact_text(text: str) -> str:
    """Redact obvious secret assignments. Shared so every stored step is safe."""
    redacted = str(text or "")
    for pattern in _SECRET_PATTERNS:
        redacted = pattern.sub("[redacted]", redacted)
    return redacted


def extract_variables(steps: list[dict]) -> list[str]:
    """Distinct ``<Placeholder>`` / ``{Placeholder}`` tokens from recorded commands."""
    names: list[str] = []
    for step in steps:
        for match in _PLACEHOLDER_RE.finditer(str(step.get("command") or "")):
            name = str(match.group(1) or match.group(2) or "").strip()
            if name and name not in names:
                names.append(name)
    return names


def _requires_elevation(steps: list[dict]) -> bool:
    for step in steps:
        command = str(step.get("command") or "").lower()
        if any(hint in command for hint in _ELEVATION_HINTS):
            return True
    return False


def _action_steps(steps: list[dict]) -> list[dict]:
    return [step for step in steps if step.get("kind") in _ACTION_KINDS and str(step.get("command") or "").strip()]


# ============== RECORDING A SESSION ==============


async def start_session(db: Any, user: dict, name: str, payload: dict) -> dict:
    """Open a recording session. Nothing is captured until a step is recorded."""
    label = str(payload.get("label") or "").strip()
    if not label:
        return {"found": False, "error": "label is required"}
    kind = str(payload.get("kind") or "manual_fix").strip().lower()
    if kind not in SESSION_KINDS:
        return {"found": False, "error": f"kind must be one of {', '.join(SESSION_KINDS)}"}
    now = _utcnow()
    session = {
        "id": f"REC-{uuid.uuid4().hex[:12].upper()}",
        "tenant_id": platform_tenant_id(user),
        "label": label[:200],
        "kind": kind,
        "client_id": str(payload.get("client_id") or "")[:64],
        "device_id": str(payload.get("device_id") or "")[:64],
        "ticket_id": str(payload.get("ticket_id") or "")[:64],
        "technician": name,
        "status": "recording",
        "outcome": "",
        "outcome_note": "",
        "steps": [],
        "created_by": user.get("id"),
        "created_by_name": name,
        "created_at": _iso(now),
        "ended_at": "",
    }
    await db.recorded_sessions.insert_one(session)
    session.pop("_id", None)
    return {
        "found": True,
        "session": session,
        "note": ("Recording. Steps are append-only and nothing is captured from the endpoint "
                 "until you record it here; secrets in recorded text are redacted before storage."),
    }


async def record_step(db: Any, user: dict, session_id: str, payload: dict) -> dict:
    """Append one step to an open session. Closed sessions are immutable."""
    kind = str(payload.get("kind") or "").strip().lower()
    if kind not in STEP_KINDS:
        return {"found": False, "error": f"kind must be one of {', '.join(STEP_KINDS)}"}
    command = redact_text(str(payload.get("command") or ""))[:MAX_TEXT]
    if kind in _ACTION_KINDS and not command.strip():
        return {"found": False, "error": "a command step needs a command"}
    session = await db.recorded_sessions.find_one(
        tenant_scoped_query(user, {"id": session_id}), {"_id": 0})
    if not session:
        return {"found": False}
    status = str(session.get("status") or "recording")
    if status != "recording":
        return {"found": False,
                "error": (f"session is {status} — steps are append-only and closed sessions "
                          "are immutable")}
    steps = list(session.get("steps") or [])
    step = {
        "index": len(steps) + 1,
        "kind": kind,
        "command": command,
        "detail": redact_text(str(payload.get("detail") or ""))[:MAX_TEXT],
        "at": str(payload.get("at") or _iso(_utcnow())),
    }
    steps.append(step)
    await db.recorded_sessions.update_one(
        {"id": session_id, "tenant_id": session.get("tenant_id")}, {"$set": {"steps": steps}})
    session["steps"] = steps
    return {"found": True, "session": session, "step": step,
            "note": "Recorded verbatim (minus redacted secrets) with a 1-based index."}


async def end_session(db: Any, user: dict, session_id: str, payload: dict) -> dict:
    """Close a recording with an honest outcome. A closed session never reopens."""
    outcome = str(payload.get("outcome") or "").strip().lower()
    if outcome not in OUTCOMES:
        return {"found": False, "error": f"outcome must be one of {', '.join(OUTCOMES)}"}
    session = await db.recorded_sessions.find_one(
        tenant_scoped_query(user, {"id": session_id}), {"_id": 0})
    if not session:
        return {"found": False}
    status = str(session.get("status") or "recording")
    if status != "recording":
        return {"found": False,
                "error": f"session is already {status} — a closed session cannot be ended again"}
    updates = {
        "status": "completed",
        "outcome": outcome,
        "outcome_note": str(payload.get("note") or "")[:500],
        "ended_at": _iso(_utcnow()),
    }
    await db.recorded_sessions.update_one(
        {"id": session_id, "tenant_id": session.get("tenant_id")}, {"$set": updates})
    session.update(updates)
    note = ("Recording closed. Only a session with a success outcome is worth offering as a "
            "known fix.")
    if outcome != "success":
        note = (f"Recording closed as {outcome}. Nexus will not offer this as a known fix until "
                "it has a successful run.")
    return {"found": True, "session": session, "note": note}


async def get_session(db: Any, user: dict, session_id: str) -> dict:
    """One session in tenant scope."""
    session = await db.recorded_sessions.find_one(
        tenant_scoped_query(user, {"id": session_id}), {"_id": 0})
    if not session:
        return {"found": False}
    return {"found": True, "session": session}


async def list_sessions(db: Any, user: dict, status: str | None = None) -> dict:
    """Sessions in tenant scope, newest first."""
    query: dict = {}
    if status:
        query["status"] = str(status)
    rows = await db.recorded_sessions.find(
        tenant_scoped_query(user, query), {"_id": 0}).sort("created_at", -1).limit(100).to_list(100)
    return {"count": len(rows), "sessions": rows,
            "note": ("Recorded sessions in your tenant only. Steps are append-only; a closed "
                     "session is immutable evidence of what was actually run.")}


# ============== DRAFTING THE RUNBOOK ==============


async def propose_runbook(db: Any, user: dict, name: str, session_id: str, payload: dict) -> dict:
    """Derive a draft runbook from the real recorded steps.

    Everything in the draft is traceable to a recorded step or to a fact about
    the session. Nothing here is learned, guessed or exfiltrated from the
    endpoint: a human must review the draft before it means anything.
    """
    session = await db.recorded_sessions.find_one(
        tenant_scoped_query(user, {"id": session_id}), {"_id": 0})
    if not session:
        return {"found": False}
    steps = list(session.get("steps") or [])
    actions = _action_steps(steps)
    if not actions:
        return {"found": False, "error": "no recorded commands to turn into a runbook"}

    prerequisites: list[str] = []
    if session.get("device_id"):
        prerequisites.append(f"A managed device in scope (device {session['device_id']})")
    if session.get("client_id"):
        prerequisites.append(f"A client in your scope (client {session['client_id']})")
    if _requires_elevation(actions):
        prerequisites.append("Elevated rights on the target")

    variables = extract_variables(actions)
    verification = [step for step in steps if step.get("kind") == "verification"]
    rollback = [step for step in steps if step.get("kind") == "rollback"]

    now = _utcnow()
    runbook = {
        "id": f"RBK-{uuid.uuid4().hex[:12].upper()}",
        "tenant_id": platform_tenant_id(user),
        "title": str(payload.get("title") or session.get("label") or "").strip()[:200],
        "detail": str(payload.get("detail") or "")[:2000],
        "source_session_id": session.get("id"),
        "client_id": session.get("client_id") or "",
        "device_id": session.get("device_id") or "",
        "ticket_id": session.get("ticket_id") or "",
        "prerequisites": prerequisites,
        "variables": variables,
        "actions": [{key: step.get(key) for key in ("index", "kind", "command", "detail")} for step in actions],
        "verification": [{"index": step.get("index"), "detail": step.get("detail") or step.get("command")}
                         for step in verification],
        "rollback": [{"index": step.get("index"), "detail": step.get("detail") or step.get("command")}
                     for step in rollback],
        "status": "draft",
        "verified_successes": 0,
        "uses": 0,
        "autonomy_candidate": False,
        "last_outcome": "",
        "created_by": user.get("id"),
        "created_by_name": name,
        "created_at": _iso(now),
    }
    await db.recorded_runbooks.insert_one(runbook)
    runbook.pop("_id", None)

    confidence = {
        "level": "reviewed-draft" if verification else "unverified-draft",
        "recorded_steps": len(steps),
        "recorded_actions": len(actions),
        "has_verification": bool(verification),
        "has_rollback": bool(rollback),
        "basis": ("Derived only from the recorded session — zero verified successes so far. "
                  "This is a draft, not a proven fix."),
    }
    notes: list[str] = ["Draft runbook: a human must review this before it can be offered as a known fix."]
    if not verification:
        notes.append("No verification step was recorded, so nothing in the draft proves the fix worked.")
    if not rollback:
        notes.append("No rollback step was recorded — the draft cannot undo itself.")
    if not variables:
        notes.append("No variable placeholders were found; re-recording with <Placeholders> makes the runbook reusable.")
    return {"found": True, "runbook": runbook, "confidence": confidence, "note": " ".join(notes)}


async def list_runbooks(db: Any, user: dict, status: str | None = None) -> dict:
    """Draft and verified runbooks in tenant scope, newest first."""
    query: dict = {}
    if status:
        query["status"] = str(status)
    rows = await db.recorded_runbooks.find(
        tenant_scoped_query(user, query), {"_id": 0}).sort("created_at", -1).limit(100).to_list(100)
    candidates = [row for row in rows if row.get("autonomy_candidate")]
    return {
        "count": len(rows),
        "runbooks": rows,
        "autonomy_candidates": len(candidates),
        "note": ("A runbook is verified only by recorded successes and is an autonomy candidate "
                 "only after that — candidate status never means Nexus will act on its own."),
    }


async def verify_runbook(db: Any, user: dict, name: str, runbook_id: str, payload: dict) -> dict:
    """Record how a runbook actually performed.

    Every call counts as a use. A success builds toward the verified threshold; a
    failure demotes the runbook and clears its candidate flag, so a previously
    trusted runbook cannot stay trusted after it breaks something.
    """
    outcome = str(payload.get("outcome") or "").strip().lower()
    if outcome not in OUTCOMES:
        return {"found": False, "error": f"outcome must be one of {', '.join(OUTCOMES)}"}
    runbook = await db.recorded_runbooks.find_one(
        tenant_scoped_query(user, {"id": runbook_id}), {"_id": 0})
    if not runbook:
        return {"found": False}

    now = _utcnow()
    uses = int(runbook.get("uses") or 0) + 1
    verified = int(runbook.get("verified_successes") or 0)
    updates: dict = {"uses": uses, "last_outcome": outcome, "last_verified_by": name,
                     "last_verified_at": _iso(now)}

    if outcome == "success":
        verified += 1
        updates["verified_successes"] = verified
        if verified >= MIN_VERIFIED_SUCCESSES:
            updates["status"] = "verified"
            updates["autonomy_candidate"] = True
            note = (f"{verified} verified successes recorded — eligible to be offered as an "
                    "autonomous remediation candidate. Autonomy still requires explicit human "
                    "approval; this module never enables it by itself.")
        else:
            updates["status"] = "draft"
            updates["autonomy_candidate"] = False
            note = (f"{verified} of {MIN_VERIFIED_SUCCESSES} verified successes recorded — not yet "
                    "an autonomy candidate.")
    elif outcome == "failure":
        updates["status"] = "needs_review"
        updates["autonomy_candidate"] = False
        note = ("Recorded as a failed verification: the runbook is marked needs_review and is no "
                "longer an autonomy candidate. Human review is required.")
    else:
        updates["autonomy_candidate"] = False
        note = "Partial outcome recorded; the runbook keeps its history but gains no verified success."

    if payload.get("note"):
        updates["last_note"] = str(payload.get("note"))[:500]

    await db.recorded_runbooks.update_one(
        {"id": runbook_id, "tenant_id": runbook.get("tenant_id")}, {"$set": updates})
    runbook.update(updates)
    return {"found": True, "runbook": runbook,
            "verified_successes": int(runbook.get("verified_successes") or 0),
            "autonomy_candidate": bool(runbook.get("autonomy_candidate")),
            "note": note}
