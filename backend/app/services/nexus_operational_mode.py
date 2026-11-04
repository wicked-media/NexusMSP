"""Nexus operational mode: normal, observe-only, or a scoped freeze.

During an incident, maintenance window or suspected compromise an operator needs
deterministic control over what Nexus is allowed to *do*:

* ``normal``      — nothing is restricted.
* ``observe_only`` — Nexus keeps detecting, diagnosing and recommending, but it
  executes nothing.
* ``frozen``      — execution is stopped for a named scope: a set of capability
  classes ("stop patching"), a set of customers ("freeze ACME only"), or both.
  With neither list supplied the freeze covers everything.

This module owns the *decision* and its audit trail. It is the one place an
operator states the platform's operational intent, and the layers that consult
it must not invent their own answer.

Honest boundaries:

* The freeze is an intersection, not a union: a freeze listing a capability and
  a customer blocks exactly that capability for that customer, and nothing else.
* A mode change requires a written reason. An unjustified stop is not allowed.
* Every change is append-only history with actor, previous state and new state.
* **Enforcement is not universal yet and this module does not pretend otherwise.**
  Nexus Autopilot already carries its own separate kill switch (it returns
  Autopilot to Observe on its own policy), and the durable automation runtime has
  its own approval pauses. Those are not re-implemented here. The layers that do
  consult this state are named in :func:`enforcement_note` so a reader can tell
  what is actually governed today from what is only declared.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from app.services.scope_permissions import platform_tenant_id, tenant_scoped_query

MODES = ("normal", "observe_only", "frozen")

CAPABILITIES = (
    "patching",
    "software_deployment",
    "ai_remediation",
    "customer_communications",
    "billing_sync",
    "device_remediation",
)

#: The layers that actually consult this state today. Anything not listed here
#: is declared policy, not enforced policy, and must not be described as enforced.
CONSULTING_LAYERS = (
    "Fleet Shell action plans",
    "State Engine / Drift Control remediation proposals",
    "Mission Control · Investigate next actions",
)

SEPARATE_CONTROLS = (
    "Nexus Autopilot's own kill switch (returns Autopilot to Observe)",
    "The durable automation runtime's approval pauses",
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat()


def capability_catalog() -> dict:
    """What can be stopped, and what actually consults this state."""
    return {
        "modes": list(MODES),
        "capabilities": list(CAPABILITIES),
        "consulting_layers": list(CONSULTING_LAYERS),
        "separate_controls": list(SEPARATE_CONTROLS),
        "meaning": {
            "normal": "Nothing is restricted.",
            "observe_only": "Nexus detects, diagnoses and recommends, but executes nothing.",
            "frozen": "Execution is stopped for the named capability classes, the named customers, or both.",
        },
        "enforcement_note": enforcement_note(),
    }


def enforcement_note() -> str:
    """State plainly what is governed by this module and what is not."""
    return (
        "This mode is consulted by: " + "; ".join(CONSULTING_LAYERS) + ". It is NOT yet consulted by: "
        + "; ".join(SEPARATE_CONTROLS)
        + ". Until those integration points exist, treat this as the platform's declared operational "
          "intent, not as a guarantee that every execution path has been interlocked."
    )


def permits(mode: dict, *, client_id: str = "", capability: str = "") -> dict:
    """Can an action run right now? Deterministic, and never optimistic.

    Called with an unknown capability this stays truthful: only an unrestricted
    mode or an out-of-scope freeze returns ``allowed``.
    """
    current = str((mode or {}).get("mode") or "normal")
    reason = str((mode or {}).get("reason") or "").strip()
    if current == "normal":
        return {"allowed": True, "reason": ""}
    if current == "observe_only":
        return {
            "allowed": False,
            "reason": ("The platform is in observe-only mode"
                       + (f": {reason}" if reason else "")
                       + ". Nexus detects, diagnoses and recommends, but executes nothing."),
        }
    if current != "frozen":
        # An unrecognised mode must not be read as permission.
        return {"allowed": False,
                "reason": f"Unrecognised operational mode '{current}' — treating it as restricted."}

    frozen_capabilities = [str(item) for item in (mode or {}).get("frozen_capabilities") or []]
    frozen_clients = [str(item) for item in (mode or {}).get("frozen_clients") or []]
    capability_blocked = not frozen_capabilities or (bool(capability) and capability in frozen_capabilities)
    client_blocked = not frozen_clients or (bool(client_id) and client_id in frozen_clients)
    if capability_blocked and client_blocked:
        scope = []
        if frozen_capabilities:
            scope.append("capability " + "/".join(frozen_capabilities))
        if frozen_clients:
            scope.append("customer " + "/".join(frozen_clients))
        return {
            "allowed": False,
            "reason": ("Execution is blocked right now: a freeze is in force for "
                       + (" and ".join(scope) if scope else "the whole platform")
                       + (f". Reason given: {reason}." if reason else ".")),
        }
    return {"allowed": True, "reason": ""}


def _normalise(mode: str) -> str:
    return mode if mode in MODES else "normal"


async def current_mode(db: Any, user: dict) -> dict:
    """The active operational state, defaulting to ``normal`` when nothing is set."""
    row = await db.operational_mode_state.find_one(
        tenant_scoped_query(user, {}), {"_id": 0})
    if not row:
        return {"mode": "normal", "reason": "", "since": "", "frozen_clients": [],
                "frozen_capabilities": [], "set_by": "", "note": enforcement_note()}
    return {
        "mode": _normalise(str(row.get("mode") or "normal")),
        "reason": str(row.get("reason") or ""),
        "since": str(row.get("updated_at") or ""),
        "frozen_clients": [str(item) for item in row.get("frozen_clients") or []],
        "frozen_capabilities": [str(item) for item in row.get("frozen_capabilities") or []],
        "set_by": str(row.get("set_by") or ""),
        "note": enforcement_note(),
    }


async def set_mode(db: Any, user: dict, name: str, payload: dict) -> dict:
    """Change the operational state. A reason is mandatory; history is append-only."""
    mode = str(payload.get("mode") or "").strip().lower()
    if mode not in MODES:
        return {"found": False, "error": f"mode must be one of {', '.join(MODES)}"}
    reason = str(payload.get("reason") or "").strip()
    if not reason:
        return {"found": False,
                "error": "a reason is required — an unjustified stop is not allowed"}

    capabilities = [str(item) for item in payload.get("capabilities") or []]
    unknown = [item for item in capabilities if item not in CAPABILITIES]
    if unknown:
        return {"found": False,
                "error": f"unknown capability '{unknown[0]}' — see the capability catalog"}
    if mode != "frozen" and (capabilities or payload.get("client_id")):
        return {"found": False,
                "error": "capabilities and client_id only apply to a frozen mode"}

    tenant_id = platform_tenant_id(user)
    previous = await current_mode(db, user)
    now = _utcnow()
    frozen_clients = [str(payload.get("client_id"))] if payload.get("client_id") else []
    document = {
        "tenant_id": tenant_id,
        "mode": mode,
        "reason": reason[:500],
        "frozen_clients": frozen_clients,
        "frozen_capabilities": capabilities,
        "set_by": name,
        "updated_at": _iso(now),
    }
    existing = await db.operational_mode_state.find_one(
        tenant_scoped_query(user, {}), {"_id": 0, "id": 1})
    if existing:
        await db.operational_mode_state.update_one(
            {"tenant_id": tenant_id}, {"$set": document})
    else:
        document["id"] = f"OPS-{uuid.uuid4().hex[:12].upper()}"
        await db.operational_mode_state.insert_one(dict(document))

    event = {
        "id": f"OPE-{uuid.uuid4().hex[:12].upper()}",
        "tenant_id": tenant_id,
        "from_mode": previous["mode"],
        "to_mode": mode,
        "reason": reason[:500],
        "frozen_clients": frozen_clients,
        "frozen_capabilities": capabilities,
        "actor": name,
        "actor_id": user.get("id"),
        "at": _iso(now),
    }
    await db.operational_mode_events.insert_one(event)
    event.pop("_id", None)

    resumed = mode == "normal"
    return {
        "found": True,
        "mode": await current_mode(db, user),
        "event": event,
        "note": ("Returned to normal operation — every previously blocked capability is available again."
                 if resumed else
                 "Applied. Consult the enforcement note: this is the platform's declared operational "
                 "intent, and the layers listed as not-yet-consulting it are still ungoverned."),
    }


async def list_events(db: Any, user: dict, limit: int = 50) -> dict:
    """Append-only history of operational-mode changes with actor and reason."""
    try:
        bounded = max(1, min(int(limit), 200))
    except (TypeError, ValueError):
        bounded = 50
    rows = await db.operational_mode_events.find(tenant_scoped_query(user, {}), {"_id": 0}) \
        .sort("at", -1).limit(bounded).to_list(bounded)
    return {
        "count": len(rows),
        "events": rows,
        "mode": await current_mode(db, user),
        "note": "Every change keeps its actor, the previous state and the written reason.",
    }
