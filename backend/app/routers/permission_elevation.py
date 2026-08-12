"""
Just-in-Time (JIT) Permission Elevation — temporary elevated access for techs
with auto-expiry, audit, and break-glass mode.
"""
import re
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import PureWindowsPath
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Header, Query
from app.database import db
from app.auth import get_current_user
from app.routers.tech_intel import _log_audit

router = APIRouter()

ELEVATE_SETTINGS_ID = "nexus_elevate"
NATIVE_ELEVATE_MAX_DURATION = 60
SHA256_PATTERN = re.compile(r"^[a-fA-F0-9]{64}$")


def _ensure_admin(caller: dict):
    if caller.get("role") != "admin" and not caller.get("is_admin"):
        raise HTTPException(status_code=403, detail="Only admins can manage elevations")


async def _get_caller(current_user: dict) -> dict:
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "password_hash": 0})
    if not caller:
        raise HTTPException(status_code=401, detail="Caller not found")
    return caller


def _can_manage_native_elevation(caller: dict) -> bool:
    """Return whether a technician is allowed to make elevation decisions."""
    if caller.get("role") == "admin" or caller.get("is_admin"):
        return True
    permissions = caller.get("permissions") or {}
    return bool((permissions.get("agent_commands") or {}).get("execute"))


def _ensure_native_elevation_operator(caller: dict) -> None:
    if not _can_manage_native_elevation(caller):
        raise HTTPException(status_code=403, detail="Nexus Elevate approval permission required")


def _normalise_windows_executable(raw_path: str) -> str:
    """Accept only an absolute Windows .exe path for the native launcher.

    The agent receives an argv array (never a shell command) and checks the
    SHA-256 again immediately before launch. Keeping the first release to
    executable files removes command-shell and script interpreter ambiguity.
    """
    candidate = str(raw_path or "").strip().strip('"')
    if not candidate or any(token in candidate for token in ("\r", "\n", "\x00")):
        raise HTTPException(status_code=400, detail="A valid executable path is required")
    path = PureWindowsPath(candidate)
    if not path.is_absolute() or path.suffix.lower() != ".exe":
        raise HTTPException(
            status_code=400,
            detail="Nexus Elevate currently permits an absolute Windows .exe path only",
        )
    return str(path)


def _normalise_argv(arguments: Any) -> list[str]:
    if arguments is None:
        return []
    if not isinstance(arguments, list) or any(not isinstance(item, str) for item in arguments):
        raise HTTPException(status_code=400, detail="arguments must be an array of plain string arguments")
    if len(arguments) > 64 or any(len(item) > 2048 or any(token in item for token in ("\r", "\n", "\x00")) for item in arguments):
        raise HTTPException(status_code=400, detail="Too many or invalid executable arguments")
    return [item.strip() for item in arguments]


async def _native_settings() -> dict:
    stored = await db.nexus_elevate_settings.find_one({"_id": ELEVATE_SETTINGS_ID}, {"_id": 0}) or {}
    return {
        "native_enabled": bool(stored.get("native_enabled", True)),
        "auto_deploy_companion": bool(stored.get("auto_deploy_companion", True)),
        "max_duration_minutes": max(5, min(NATIVE_ELEVATE_MAX_DURATION, int(stored.get("max_duration_minutes") or 15))),
        "require_justification": bool(stored.get("require_justification", True)),
        "require_sha256": True,
        "keeper_bridge_enabled": bool(stored.get("keeper_bridge_enabled", False)),
        "keeper_connector_reference": stored.get("keeper_connector_reference", ""),
        "keeper_sync_interval_minutes": max(5, min(120, int(stored.get("keeper_sync_interval_minutes") or 15))),
        "updated_at": stored.get("updated_at"),
        "updated_by": stored.get("updated_by"),
    }


async def _write_native_audit(kind: str, request: dict, actor: dict | None = None, details: dict | None = None) -> None:
    """Persist a purpose-built, immutable-style event alongside the global audit."""
    event = {
        "id": str(uuid.uuid4()),
        "kind": kind,
        "request_id": request.get("id"),
        "device_id": request.get("device_id"),
        "client_id": request.get("client_id"),
        "actor_id": (actor or {}).get("id"),
        "actor_name": (actor or {}).get("name"),
        "details": details or {},
        "at": datetime.now(timezone.utc).isoformat(),
    }
    await db.nexus_elevate_audit.insert_one(event)
    if actor:
        try:
            await _log_audit(actor, kind, request.get("id"), request.get("program_path") or "Nexus Elevate request", {
                "request_id": request.get("id"),
                "device_id": request.get("device_id"),
                "client_id": request.get("client_id"),
                **(details or {}),
            })
        except Exception:
            # The primary elevation audit must still succeed if the older
            # cross-platform audit writer has a transient issue.
            pass


async def _notify_native_elevation_review(request: dict) -> None:
    """Create one shared, actionable operator notification for a pending request."""
    request_id = request.get("id")
    if not request_id:
        return
    existing = await db.notifications.find_one({
        "ref_id": request_id,
        "type": "nexus_elevate_review",
    }, {"_id": 0, "id": 1})
    if existing:
        return
    executable = request.get("program_name") or PureWindowsPath(request.get("program_path") or "application.exe").name
    endpoint = request.get("hostname") or "a managed endpoint"
    requester = request.get("requested_by_name") or "An endpoint user"
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": "all",
        "type": "nexus_elevate_review",
        "title": "Nexus Elevate approval required",
        "message": f"{requester} requested {executable} on {endpoint}.",
        "ref_id": request_id,
        "ref_type": "nexus_elevate_request",
        "action_url": f"/nexus-elevate?status=pending&request={request_id}",
        "action_label": "Review request",
        "severity": "warning",
        "read": False,
        "read_by": [],
        "dismissed_by": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })


async def _resolve_native_elevation_review_notification(request_id: str, resolution: str) -> None:
    """Close shared review notices once the queue has a final decision."""
    if not request_id:
        return
    now = datetime.now(timezone.utc).isoformat()
    await db.notifications.update_many(
        {"ref_id": request_id, "type": "nexus_elevate_review"},
        {"$set": {"resolved_at": now, "resolution": resolution}},
    )


async def _expire_stale_native_approvals() -> int:
    """Close approvals that cannot safely be honoured any longer.

    The agent independently refuses an expired command, but keeping an expired
    request marked as ``approved`` in the console is misleading—particularly
    if the endpoint was offline when the approval window elapsed.  This small
    sweep runs whenever the queue is read and only changes a request once.
    """
    now = datetime.now(timezone.utc)
    cutoff = now.isoformat()
    candidates = await db.nexus_elevate_requests.find({
        "status": "approved",
        "approved_until": {"$lte": cutoff},
    }, {"_id": 0}).to_list(500)
    expired = 0
    for request in candidates:
        result = await db.nexus_elevate_requests.update_one(
            {
                "id": request.get("id"),
                "status": "approved",
                "approved_until": request.get("approved_until"),
            },
            {"$set": {
                "status": "expired",
                "expired_at": cutoff,
                "expiration_reason": "The approved launch window elapsed before a successful agent execution was recorded.",
            }},
        )
        if getattr(result, "matched_count", 0):
            request.update({"status": "expired", "expired_at": cutoff})
            try:
                await _resolve_native_elevation_review_notification(request.get("id"), "expired")
            except Exception:
                pass
            await _write_native_audit("nexus_elevate_expired", request, None, {
                "approved_until": request.get("approved_until"),
            })
            expired += 1
    return expired


async def _request_view(request: dict) -> dict:
    """Remove internal fields and enrich a request with human-facing names."""
    item = {key: value for key, value in request.items() if key != "_id"}
    client_id = item.get("client_id")
    if client_id and not item.get("client_name"):
        client = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1})
        item["client_name"] = (client or {}).get("name") or "Unassigned client"
    device = await db.devices.find_one({"nexus_agent_id": item.get("device_id")}, {"_id": 0, "id": 1, "name": 1})
    if device:
        item["asset_id"] = device.get("id")
        item["asset_name"] = device.get("name") or item.get("hostname") or "Managed asset"
    return item


# ---------------------------------------------------------------------------
# Nexus Elevate policy controls
# ---------------------------------------------------------------------------

ELEVATE_POLICY_ACTIONS = {"allow", "approval", "deny"}
ELEVATE_POLICY_MODES = {"monitor", "enforce"}


def _clean_string_list(value: Any, *, field: str, maximum: int = 100, item_length: int = 200) -> list[str]:
    """Normalise small, human-maintained policy lists without accepting junk."""
    if value is None:
        return []
    if not isinstance(value, list):
        raise HTTPException(status_code=400, detail=f"{field} must be a list")
    cleaned: list[str] = []
    for item in value:
        text = str(item or "").strip()
        if not text:
            continue
        if len(text) > item_length:
            raise HTTPException(status_code=400, detail=f"{field} contains an item that is too long")
        if text not in cleaned:
            cleaned.append(text)
    if len(cleaned) > maximum:
        raise HTTPException(status_code=400, detail=f"{field} can contain at most {maximum} items")
    return cleaned


def _policy_path(value: Any) -> str:
    """Accept an exact executable path as a policy matcher, never a wildcard."""
    if not value:
        return ""
    return _normalise_windows_executable(str(value))


def _policy_payload(data: dict, existing: dict | None = None) -> dict:
    """Validate the deliberately narrow first-release policy contract.

    Auto-allow rules must be pinned to both an exact executable path and its
    SHA-256. This prevents a broad path or publisher rule from quietly turning
    into an endpoint-wide administrator bypass.
    """
    base = existing or {}
    name = str(data.get("name", base.get("name", ""))).strip()
    if not 3 <= len(name) <= 120:
        raise HTTPException(status_code=400, detail="Policy name must be 3-120 characters")
    description = str(data.get("description", base.get("description", ""))).strip()
    if len(description) > 1000:
        raise HTTPException(status_code=400, detail="Policy description is too long")
    action = str(data.get("action", base.get("action", "approval"))).strip().lower()
    mode = str(data.get("mode", base.get("mode", "monitor"))).strip().lower()
    if action not in ELEVATE_POLICY_ACTIONS:
        raise HTTPException(status_code=400, detail="Policy action must be allow, approval, or deny")
    if mode not in ELEVATE_POLICY_MODES:
        raise HTTPException(status_code=400, detail="Policy mode must be monitor or enforce")

    incoming_scope = data.get("scope") if isinstance(data.get("scope"), dict) else {}
    old_scope = base.get("scope") if isinstance(base.get("scope"), dict) else {}
    scope = {
        "client_ids": _clean_string_list(incoming_scope.get("client_ids", old_scope.get("client_ids")), field="Client scope"),
        "device_ids": _clean_string_list(incoming_scope.get("device_ids", old_scope.get("device_ids")), field="Endpoint scope"),
    }
    incoming_match = data.get("match") if isinstance(data.get("match"), dict) else {}
    old_match = base.get("match") if isinstance(base.get("match"), dict) else {}
    program_path = _policy_path(incoming_match.get("program_path", old_match.get("program_path")))
    sha256 = str(incoming_match.get("sha256", old_match.get("sha256", "")) or "").strip().lower()
    if sha256 and not SHA256_PATTERN.fullmatch(sha256):
        raise HTTPException(status_code=400, detail="Policy SHA-256 must be a 64-character hexadecimal fingerprint")
    arguments_contains = _clean_string_list(
        incoming_match.get("arguments_contains", old_match.get("arguments_contains")),
        field="Argument conditions", maximum=12, item_length=256,
    )
    if not program_path and not sha256:
        raise HTTPException(status_code=400, detail="Add an exact program path or SHA-256 fingerprint to the policy")
    if action == "allow" and mode == "enforce" and (not program_path or not sha256):
        raise HTTPException(status_code=400, detail="Enforced auto-allow policies require both an exact program path and SHA-256")

    incoming_constraints = data.get("constraints") if isinstance(data.get("constraints"), dict) else {}
    old_constraints = base.get("constraints") if isinstance(base.get("constraints"), dict) else {}
    try:
        priority = int(data.get("priority", base.get("priority", 100)))
        duration = int(incoming_constraints.get("max_duration_minutes", old_constraints.get("max_duration_minutes", 15)))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Priority and duration must be whole numbers")
    if priority < 1 or priority > 1000:
        raise HTTPException(status_code=400, detail="Priority must be between 1 and 1000")
    if duration < 5 or duration > NATIVE_ELEVATE_MAX_DURATION:
        raise HTTPException(status_code=400, detail=f"Policy duration must be 5-{NATIVE_ELEVATE_MAX_DURATION} minutes")

    enabled = bool(data.get("enabled", base.get("enabled", True)))
    return {
        "name": name,
        "description": description,
        "action": action,
        "mode": mode,
        "enabled": enabled,
        "priority": priority,
        "scope": scope,
        "match": {
            "program_path": program_path,
            "sha256": sha256,
            "arguments_contains": arguments_contains,
        },
        "constraints": {
            "max_duration_minutes": duration,
            "require_ticket": bool(incoming_constraints.get("require_ticket", old_constraints.get("require_ticket", False))),
            "require_justification": bool(incoming_constraints.get("require_justification", old_constraints.get("require_justification", True))),
        },
    }


def _policy_matches(policy: dict, request: dict) -> tuple[bool, list[str]]:
    """Return whether a policy precisely matches an elevation request and why."""
    if not policy.get("enabled") or policy.get("archived_at"):
        return False, []
    scope = policy.get("scope") or {}
    client_ids = scope.get("client_ids") or []
    device_ids = scope.get("device_ids") or []
    if client_ids and request.get("client_id") not in client_ids:
        return False, []
    if device_ids and request.get("device_id") not in device_ids:
        return False, []
    match = policy.get("match") or {}
    path = str(match.get("program_path") or "")
    sha256 = str(match.get("sha256") or "").lower()
    if path and path.casefold() != str(request.get("program_path") or "").casefold():
        return False, []
    if sha256 and sha256 != str(request.get("sha256") or "").lower():
        return False, []
    joined_args = " ".join(str(item) for item in (request.get("arguments") or [])).casefold()
    for phrase in (match.get("arguments_contains") or []):
        if str(phrase).casefold() not in joined_args:
            return False, []
    reasons: list[str] = []
    if client_ids:
        reasons.append("client scope")
    if device_ids:
        reasons.append("endpoint scope")
    if path:
        reasons.append("exact executable path")
    if sha256:
        reasons.append("SHA-256 fingerprint")
    if match.get("arguments_contains"):
        reasons.append("argument conditions")
    return True, reasons


async def _evaluate_native_policy(request: dict) -> dict:
    """Evaluate the first matching priority policy.

    Monitor policies record the recommendation but never change the request.
    Enforced policies are limited to deny, queue-for-review, or an exact
    path-and-hash auto-allow. The native agent still verifies the hash just
    before starting the process.
    """
    policies = await db.nexus_elevate_policies.find(
        {"enabled": True, "archived_at": {"$in": [None, ""]}}, {"_id": 0}
    ).sort("priority", -1).to_list(500)
    action_rank = {"deny": 3, "approval": 2, "allow": 1}
    ordered = sorted(policies, key=lambda item: (-int(item.get("priority") or 0), -action_rank.get(item.get("action"), 0), str(item.get("created_at") or "")))
    monitored: list[dict] = []
    for policy in ordered:
        matched, reasons = _policy_matches(policy, request)
        if not matched:
            continue
        summary = {
            "id": policy.get("id"), "name": policy.get("name"), "version": policy.get("version", 1),
            "mode": policy.get("mode"), "action": policy.get("action"), "priority": policy.get("priority"),
            "reasons": reasons, "constraints": policy.get("constraints") or {},
        }
        if policy.get("mode") == "monitor":
            monitored.append(summary)
            continue
        constraints = policy.get("constraints") or {}
        if constraints.get("require_ticket") and not request.get("ticket_id"):
            summary["action"] = "approval"
            summary["downgraded_reason"] = "A related ticket is required before automatic handling."
        if constraints.get("require_justification") and len(str(request.get("justification") or "").strip()) < 8:
            summary["action"] = "deny"
            summary["downgraded_reason"] = "A sufficient requester justification is required."
        return {"decision": summary["action"], "matched": summary, "monitor_matches": monitored}
    return {"decision": "approval", "matched": None, "monitor_matches": monitored}


async def _write_policy_audit(kind: str, policy: dict | None, actor: dict | None, details: dict | None = None) -> None:
    event = {
        "id": str(uuid.uuid4()),
        "kind": kind,
        "policy_id": (policy or {}).get("id"),
        "policy_name": (policy or {}).get("name"),
        "actor_id": (actor or {}).get("id"),
        "actor_name": (actor or {}).get("name"),
        "details": details or {},
        "at": datetime.now(timezone.utc).isoformat(),
    }
    await db.nexus_elevate_policy_audit.insert_one(event)
    if actor:
        try:
            await _log_audit(actor, kind, (policy or {}).get("id"), (policy or {}).get("name") or "Nexus Elevate policy", details or {})
        except Exception:
            pass


def _policy_view(policy: dict) -> dict:
    return {key: value for key, value in policy.items() if key != "_id"}


async def _queue_policy_auto_approval(request: dict, policy_match: dict) -> str:
    """Queue an exact, hash-pinned launch granted by an enforced policy."""
    settings = await _native_settings()
    constraints = (policy_match or {}).get("constraints") or {}
    duration = min(
        int(request.get("requested_duration_minutes") or settings["max_duration_minutes"]),
        int(constraints.get("max_duration_minutes") or settings["max_duration_minutes"]),
        settings["max_duration_minutes"],
        NATIVE_ELEVATE_MAX_DURATION,
    )
    duration = max(5, duration)
    approved_at = datetime.now(timezone.utc)
    approved_until = approved_at + timedelta(minutes=duration)
    command_id = str(uuid.uuid4())
    command = {
        "id": command_id,
        "device_id": request["device_id"],
        "kind": "elevate_launch",
        "payload": {
            "request_id": request["id"],
            "program_path": request["program_path"],
            "arguments": request.get("arguments") or [],
            "sha256": request["sha256"],
            "approved_until": approved_until.isoformat(),
        },
        "elevation_request_id": request["id"],
        "status": "pending",
        "queued_by": "Nexus Elevate policy engine",
        "created_at": approved_at.isoformat(),
    }
    update = {
        "status": "approved",
        "approved_at": approved_at.isoformat(),
        "approved_until": approved_until.isoformat(),
        "approved_by_id": "nexus-elevate-policy-engine",
        "approved_by_name": "Nexus Elevate policy engine",
        "approval_reason": f"Auto-approved by enforced policy: {policy_match.get('name') or policy_match.get('id')}",
        "agent_command_id": command_id,
        "policy_auto_approved": True,
    }
    claimed = await db.nexus_elevate_requests.find_one_and_update(
        {"id": request["id"], "status": "pending"},
        {"$set": update},
    )
    if not claimed:
        raise RuntimeError("Could not reserve the elevation request for policy auto-approval")
    try:
        await db.nexus_agent_commands.insert_one(command)
    except Exception:
        await db.nexus_elevate_requests.update_one(
            {"id": request["id"], "status": "approved", "agent_command_id": command_id},
            {"$set": {"status": "pending"}, "$unset": {
                "approved_at": "", "approved_until": "", "approved_by_id": "",
                "approved_by_name": "", "approval_reason": "", "agent_command_id": "",
                "policy_auto_approved": "",
            }},
        )
        raise
    request.update(update)
    return command_id


@router.get("/nexus-elevate/policies")
async def list_nexus_elevate_policies(current_user: dict = Depends(get_current_user)):
    caller = await _get_caller(current_user)
    _ensure_native_elevation_operator(caller)
    policies = await db.nexus_elevate_policies.find({"archived_at": {"$in": [None, ""]}}, {"_id": 0}).sort("priority", -1).to_list(500)
    clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1}).sort("name", 1).to_list(500)
    agents = await db.nexus_agents.find({"is_active": True}, {"_id": 0, "id": 1, "hostname": 1, "client_id": 1, "last_seen": 1}).sort("hostname", 1).to_list(1000)
    return {
        "policies": [_policy_view(policy) for policy in policies],
        "catalog": {"clients": clients, "agents": agents},
        "capabilities": {"enforced_auto_allow_requires_path_and_hash": True, "local_admin_removal": "not_available"},
        "permissions": {"can_manage": bool(caller.get("role") == "admin" or caller.get("is_admin"))},
    }


@router.post("/nexus-elevate/policies")
async def create_nexus_elevate_policy(data: dict, current_user: dict = Depends(get_current_user)):
    caller = await _get_caller(current_user)
    _ensure_admin(caller)
    payload = _policy_payload(data)
    now = datetime.now(timezone.utc).isoformat()
    policy = {
        "id": f"nep-{uuid.uuid4().hex[:16]}",
        **payload,
        "version": 1,
        "created_at": now,
        "created_by_id": caller.get("id"),
        "created_by_name": caller.get("name"),
        "updated_at": now,
        "updated_by_id": caller.get("id"),
        "updated_by_name": caller.get("name"),
        "archived_at": None,
    }
    await db.nexus_elevate_policies.insert_one(policy)
    await _write_policy_audit("nexus_elevate_policy_created", policy, caller, {"action": policy["action"], "mode": policy["mode"]})
    return {"policy": _policy_view(policy)}


@router.put("/nexus-elevate/policies/{policy_id}")
async def update_nexus_elevate_policy(policy_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    caller = await _get_caller(current_user)
    _ensure_admin(caller)
    existing = await db.nexus_elevate_policies.find_one({"id": policy_id, "archived_at": {"$in": [None, ""]}}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Nexus Elevate policy not found")
    payload = _policy_payload(data, existing)
    update = {
        **payload,
        "version": int(existing.get("version") or 1) + 1,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "updated_by_id": caller.get("id"),
        "updated_by_name": caller.get("name"),
    }
    await db.nexus_elevate_policies.update_one({"id": policy_id}, {"$set": update})
    existing.update(update)
    await _write_policy_audit("nexus_elevate_policy_updated", existing, caller, {"action": existing["action"], "mode": existing["mode"], "version": existing["version"]})
    return {"policy": _policy_view(existing)}


@router.post("/nexus-elevate/policies/{policy_id}/archive")
async def archive_nexus_elevate_policy(policy_id: str, current_user: dict = Depends(get_current_user)):
    caller = await _get_caller(current_user)
    _ensure_admin(caller)
    policy = await db.nexus_elevate_policies.find_one({"id": policy_id, "archived_at": {"$in": [None, ""]}}, {"_id": 0})
    if not policy:
        raise HTTPException(status_code=404, detail="Nexus Elevate policy not found")
    archived_at = datetime.now(timezone.utc).isoformat()
    await db.nexus_elevate_policies.update_one({"id": policy_id}, {"$set": {"enabled": False, "archived_at": archived_at, "archived_by_id": caller.get("id")}})
    policy.update({"enabled": False, "archived_at": archived_at})
    await _write_policy_audit("nexus_elevate_policy_archived", policy, caller)
    return {"ok": True}


@router.post("/nexus-elevate/policies/simulate")
async def simulate_nexus_elevate_policy(data: dict, current_user: dict = Depends(get_current_user)):
    caller = await _get_caller(current_user)
    _ensure_native_elevation_operator(caller)
    program_path = _normalise_windows_executable(data.get("program_path"))
    sha256 = str(data.get("sha256") or "").strip().lower()
    if not SHA256_PATTERN.fullmatch(sha256):
        raise HTTPException(status_code=400, detail="A SHA-256 fingerprint is required for simulation")
    device_id = str(data.get("device_id") or "").strip()
    client_id = str(data.get("client_id") or "").strip()
    if device_id and not client_id:
        agent = await db.nexus_agents.find_one({"id": device_id}, {"_id": 0, "client_id": 1}) or {}
        client_id = str(agent.get("client_id") or "")
    request = {
        "device_id": device_id,
        "client_id": client_id,
        "program_path": program_path,
        "sha256": sha256,
        "arguments": _normalise_argv(data.get("arguments")),
        "ticket_id": str(data.get("ticket_id") or "").strip(),
        "justification": str(data.get("justification") or "").strip(),
    }
    evaluation = await _evaluate_native_policy(request)
    await _write_policy_audit("nexus_elevate_policy_simulated", evaluation.get("matched"), caller, {
        "decision": evaluation.get("decision"), "client_id": client_id, "device_id": device_id,
        "program_path": program_path, "sha256": sha256,
    })
    return {"evaluation": evaluation}


@router.post("/permission-elevation/grant")
async def grant_elevation(data: dict, current_user: dict = Depends(get_current_user)):
    """
    Body: { "tech_id":"...", "preset":"Senior Engineer", "duration_minutes":240, "reason":"..." }
    Elevates tech to a target preset for N minutes, then auto-reverts.
    """
    caller = await _get_caller(current_user)
    _ensure_admin(caller)

    from app.routers.technicians import PERMISSION_PRESETS
    tech_id = data.get("tech_id")
    preset = data.get("preset")
    duration = int(data.get("duration_minutes") or 60)
    reason = data.get("reason") or "Manual JIT grant"

    if not tech_id or preset not in PERMISSION_PRESETS:
        raise HTTPException(status_code=400, detail="tech_id and valid preset required")
    if duration < 5 or duration > 24 * 60:
        raise HTTPException(status_code=400, detail="Duration must be 5-1440 minutes")

    tech = await db.users.find_one({"id": tech_id}, {"_id": 0, "password_hash": 0})
    if not tech:
        raise HTTPException(status_code=404, detail="Tech not found")

    expires = datetime.now(timezone.utc) + timedelta(minutes=duration)
    elevation_id = f"elev-{int(datetime.now(timezone.utc).timestamp() * 1000)}"

    record = {
        "id": elevation_id,
        "tech_id": tech_id,
        "tech_name": tech.get("name"),
        "preset": preset,
        "previous_permissions": tech.get("permissions") or {},
        "previous_title": tech.get("job_title"),
        "granted_by_id": caller.get("id"),
        "granted_by_name": caller.get("name"),
        "reason": reason,
        "granted_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": expires.isoformat(),
        "active": True,
        "revoked_at": None,
        "auto_reverted": False,
    }

    await db.permission_elevations.insert_one(record)
    await db.users.update_one(
        {"id": tech_id},
        {"$set": {
            "permissions": PERMISSION_PRESETS[preset],
            "active_elevation_id": elevation_id,
            "active_elevation_expires": expires.isoformat(),
        }},
    )

    await _log_audit(caller, "elevation_granted", tech_id, tech.get("name"), {
        "preset": preset, "duration_minutes": duration, "reason": reason, "elevation_id": elevation_id,
    })

    record.pop("previous_permissions", None)
    return record


@router.delete("/permission-elevation/{elevation_id}")
async def revoke_elevation(elevation_id: str, current_user: dict = Depends(get_current_user)):
    """Revoke an active elevation early."""
    caller = await _get_caller(current_user)
    _ensure_admin(caller)
    elev = await db.permission_elevations.find_one({"id": elevation_id}, {"_id": 0})
    if not elev or not elev.get("active"):
        raise HTTPException(status_code=404, detail="Active elevation not found")

    await db.users.update_one(
        {"id": elev["tech_id"]},
        {"$set": {
            "permissions": elev.get("previous_permissions") or {},
            "active_elevation_id": None,
            "active_elevation_expires": None,
        }},
    )
    await db.permission_elevations.update_one(
        {"id": elevation_id},
        {"$set": {"active": False, "revoked_at": datetime.now(timezone.utc).isoformat()}},
    )
    await _log_audit(caller, "elevation_revoked", elev["tech_id"], elev.get("tech_name"), {"elevation_id": elevation_id})
    return {"message": "Elevation revoked"}


@router.get("/permission-elevation/active")
async def list_active(current_user: dict = Depends(get_current_user)):
    """List active elevations and lazily auto-revert any that have expired."""
    now = datetime.now(timezone.utc)
    active = await db.permission_elevations.find({"active": True}, {"_id": 0, "previous_permissions": 0}).to_list(100)
    out = []
    for e in active:
        try:
            exp = datetime.fromisoformat(e["expires_at"].replace("Z", "+00:00"))
        except Exception:
            exp = now
        if exp <= now:
            # Auto-revert
            full = await db.permission_elevations.find_one({"id": e["id"]}, {"_id": 0})
            await db.users.update_one(
                {"id": e["tech_id"]},
                {"$set": {
                    "permissions": (full or {}).get("previous_permissions") or {},
                    "active_elevation_id": None,
                    "active_elevation_expires": None,
                }},
            )
            await db.permission_elevations.update_one(
                {"id": e["id"]},
                {"$set": {"active": False, "auto_reverted": True, "revoked_at": now.isoformat()}},
            )
            continue
        e["expires_in_minutes"] = max(0, int((exp - now).total_seconds() / 60))
        out.append(e)
    return {"active": out}


@router.post("/permission-elevation/break-glass")
async def break_glass(data: dict, current_user: dict = Depends(get_current_user)):
    """
    Self-grant full admin for emergency response. Heavily audited.
    Body: { "duration_minutes":15, "reason":"..." }
    """
    caller = await _get_caller(current_user)
    duration = int(data.get("duration_minutes") or 15)
    reason = (data.get("reason") or "").strip()
    if not reason or len(reason) < 10:
        raise HTTPException(status_code=400, detail="A detailed reason (10+ chars) is required for break-glass")
    if duration < 5 or duration > 60:
        raise HTTPException(status_code=400, detail="Break-glass capped at 60 minutes")

    expires = datetime.now(timezone.utc) + timedelta(minutes=duration)
    elevation_id = f"bg-{int(datetime.now(timezone.utc).timestamp() * 1000)}"

    record = {
        "id": elevation_id,
        "tech_id": caller["id"],
        "tech_name": caller.get("name"),
        "preset": "BREAK_GLASS_ADMIN",
        "previous_permissions": caller.get("permissions") or {},
        "previous_is_admin": bool(caller.get("is_admin")),
        "previous_title": caller.get("job_title"),
        "granted_by_id": caller["id"],
        "granted_by_name": caller.get("name"),
        "reason": reason,
        "granted_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": expires.isoformat(),
        "active": True,
        "break_glass": True,
        "revoked_at": None,
        "auto_reverted": False,
    }
    await db.permission_elevations.insert_one(record)
    await db.users.update_one(
        {"id": caller["id"]},
        {"$set": {
            "is_admin": True,
            "active_elevation_id": elevation_id,
            "active_elevation_expires": expires.isoformat(),
        }},
    )
    await _log_audit(caller, "break_glass_activated", caller["id"], caller.get("name"), {
        "duration_minutes": duration, "reason": reason, "elevation_id": elevation_id,
    })
    record.pop("previous_permissions", None)
    return record


# ---------------------------------------------------------------------------
# Nexus Elevate: native, agent-backed endpoint privilege approvals
# ---------------------------------------------------------------------------

@router.get("/nexus-elevate/settings")
async def get_nexus_elevate_settings(current_user: dict = Depends(get_current_user)):
    caller = await _get_caller(current_user)
    _ensure_native_elevation_operator(caller)
    return await _native_settings()


@router.put("/nexus-elevate/settings")
async def put_nexus_elevate_settings(data: dict, current_user: dict = Depends(get_current_user)):
    caller = await _get_caller(current_user)
    _ensure_admin(caller)

    max_duration = int(data.get("max_duration_minutes") or 15)
    if max_duration < 5 or max_duration > NATIVE_ELEVATE_MAX_DURATION:
        raise HTTPException(status_code=400, detail=f"Maximum approval duration must be 5-{NATIVE_ELEVATE_MAX_DURATION} minutes")
    connector_reference = str(data.get("keeper_connector_reference") or "").strip()
    if len(connector_reference) > 300:
        raise HTTPException(status_code=400, detail="Keeper connector reference is too long")
    settings = {
        "native_enabled": bool(data.get("native_enabled", True)),
        "auto_deploy_companion": bool(data.get("auto_deploy_companion", True)),
        "max_duration_minutes": max_duration,
        "require_justification": bool(data.get("require_justification", True)),
        "keeper_bridge_enabled": bool(data.get("keeper_bridge_enabled", False)),
        # This is intentionally only a secret-manager reference. NexusMSP does
        # not accept or store a Keeper credential in this feature.
        "keeper_connector_reference": connector_reference,
        "keeper_sync_interval_minutes": max(5, min(120, int(data.get("keeper_sync_interval_minutes") or 15))),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "updated_by": caller.get("email") or caller.get("id"),
    }
    await db.nexus_elevate_settings.update_one({"_id": ELEVATE_SETTINGS_ID}, {"$set": settings}, upsert=True)
    await _write_native_audit("nexus_elevate_settings_updated", {"id": ELEVATE_SETTINGS_ID}, caller, {
        "native_enabled": settings["native_enabled"],
        "keeper_bridge_enabled": settings["keeper_bridge_enabled"],
    })
    return await _native_settings()


@router.get("/nexus-elevate/overview")
async def nexus_elevate_overview(current_user: dict = Depends(get_current_user)):
    caller = await _get_caller(current_user)
    _ensure_native_elevation_operator(caller)
    await _expire_stale_native_approvals()
    now = datetime.now(timezone.utc)
    settings = await _native_settings()
    requests = await db.nexus_elevate_requests.find({}, {"_id": 0}).sort("requested_at", -1).to_list(250)
    active_agents = await db.nexus_agents.count_documents({"is_active": True})
    online_cutoff = (now - timedelta(minutes=3)).isoformat()
    online_agents = await db.nexus_agents.count_documents({"is_active": True, "last_seen": {"$gte": online_cutoff}})
    companion_agents = await db.nexus_agents.count_documents({
        "is_active": True,
        "client_companion_installed_at": {"$exists": True, "$ne": None},
    })
    companion_agents_online = await db.nexus_agents.count_documents({
        "is_active": True,
        "last_seen": {"$gte": online_cutoff},
        "client_companion_installed_at": {"$exists": True, "$ne": None},
    })
    elevate_active = await db.nexus_agents.count_documents({"is_active": True, "nexus_elevate.state": "active"})
    elevate_deploying = await db.nexus_agents.count_documents({"is_active": True, "nexus_elevate.state": "deploying"})
    pending = [row for row in requests if row.get("status") == "pending"]
    expiring = [row for row in requests if row.get("status") == "approved" and row.get("approved_until") and row["approved_until"] <= (now + timedelta(minutes=10)).isoformat()]
    failed = [row for row in requests if row.get("status") in {"failed", "expired"}]
    recent = [await _request_view(row) for row in requests[:8]]
    active_policies = await db.nexus_elevate_policies.count_documents({"enabled": True, "archived_at": {"$in": [None, ""]}})
    enforced_policies = await db.nexus_elevate_policies.count_documents({"enabled": True, "mode": "enforce", "archived_at": {"$in": [None, ""]}})
    return {
        "settings": settings,
        "summary": {
            "pending": len(pending),
            "approved": sum(1 for row in requests if row.get("status") == "approved"),
            "expiring_soon": len(expiring),
            "failed_or_expired": len(failed),
            "native_agent_coverage": active_agents,
            "native_agents_online": online_agents,
            "companion_agents_ready": companion_agents,
            "companion_agents_online": companion_agents_online,
            "elevate_active": elevate_active,
            "elevate_deploying": elevate_deploying,
            "keeper_bridge_requests": sum(1 for row in requests if row.get("provider") == "keeper" and row.get("status") == "pending"),
            "active_policies": active_policies,
            "enforced_policies": enforced_policies,
        },
        "recent_requests": recent,
    }


@router.get("/nexus-elevate/requests")
async def list_nexus_elevate_requests(
    status: str | None = Query(None),
    client_id: str | None = Query(None),
    device_id: str | None = Query(None),
    limit: int = Query(150, ge=1, le=500),
    current_user: dict = Depends(get_current_user),
):
    caller = await _get_caller(current_user)
    _ensure_native_elevation_operator(caller)
    await _expire_stale_native_approvals()
    query: dict[str, Any] = {}
    if status and status != "all":
        query["status"] = status
    if client_id:
        query["client_id"] = client_id
    if device_id:
        query["device_id"] = device_id
    rows = await db.nexus_elevate_requests.find(query, {"_id": 0}).sort("requested_at", -1).to_list(limit)
    return {"requests": [await _request_view(row) for row in rows]}


@router.get("/nexus-elevate/requests/{request_id}")
async def get_nexus_elevate_request(request_id: str, current_user: dict = Depends(get_current_user)):
    caller = await _get_caller(current_user)
    _ensure_native_elevation_operator(caller)
    await _expire_stale_native_approvals()
    request = await db.nexus_elevate_requests.find_one({"id": request_id}, {"_id": 0})
    if not request:
        raise HTTPException(status_code=404, detail="Elevation request not found")
    events = await db.nexus_elevate_audit.find({"request_id": request_id}, {"_id": 0}).sort("at", -1).to_list(100)
    return {"request": await _request_view(request), "audit": events}


@router.post("/nexus-elevate/requests/{request_id}/approve")
async def approve_nexus_elevate_request(request_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    caller = await _get_caller(current_user)
    _ensure_native_elevation_operator(caller)
    request = await db.nexus_elevate_requests.find_one({"id": request_id}, {"_id": 0})
    if not request:
        raise HTTPException(status_code=404, detail="Elevation request not found")
    if request.get("status") != "pending":
        raise HTTPException(status_code=409, detail="Only pending elevation requests can be approved")
    settings = await _native_settings()
    if not settings["native_enabled"]:
        raise HTTPException(status_code=409, detail="Native Nexus Elevate is disabled in Settings")

    duration = int(data.get("duration_minutes") or settings["max_duration_minutes"])
    duration = min(duration, settings["max_duration_minutes"], NATIVE_ELEVATE_MAX_DURATION)
    if duration < 5:
        raise HTTPException(status_code=400, detail="Approval duration must be at least 5 minutes")
    decision_reason = str(data.get("reason") or "").strip()
    if len(decision_reason) < 8:
        raise HTTPException(status_code=400, detail="An approval reason of at least 8 characters is required")

    approved_at = datetime.now(timezone.utc)
    approved_until = approved_at + timedelta(minutes=duration)
    command_id = str(uuid.uuid4())
    command = {
        "id": command_id,
        "device_id": request["device_id"],
        "kind": "elevate_launch",
        "payload": {
            "request_id": request["id"],
            "program_path": request["program_path"],
            "arguments": request.get("arguments") or [],
            "sha256": request["sha256"],
            "approved_until": approved_until.isoformat(),
        },
        "elevation_request_id": request["id"],
        "status": "pending",
        "queued_by": caller.get("email") or caller.get("id"),
        "created_at": approved_at.isoformat(),
    }
    update = {
        "status": "approved",
        "approved_at": approved_at.isoformat(),
        "approved_until": approved_until.isoformat(),
        "approved_by_id": caller.get("id"),
        "approved_by_name": caller.get("name"),
        "approval_reason": decision_reason,
        "agent_command_id": command_id,
    }
    # Claim the request before queuing the command.  A normal read followed by
    # an update allowed two approvers to both observe ``pending`` and enqueue
    # the same executable.  ``find_one_and_update`` gives exactly one caller
    # ownership of the state transition.
    claimed = await db.nexus_elevate_requests.find_one_and_update(
        {"id": request_id, "status": "pending"},
        {"$set": update},
    )
    if not claimed:
        raise HTTPException(status_code=409, detail="This elevation request was already decided by another technician")
    try:
        await db.nexus_agent_commands.insert_one(command)
    except Exception as exc:
        # Do not leave an approved request behind if its delivery command was
        # never committed.  The conditional rollback cannot overwrite a later
        # state transition.
        await db.nexus_elevate_requests.update_one(
            {"id": request_id, "status": "approved", "agent_command_id": command_id},
            {"$set": {"status": "pending"}, "$unset": {
                "approved_at": "", "approved_until": "", "approved_by_id": "",
                "approved_by_name": "", "approval_reason": "", "agent_command_id": "",
            }},
        )
        raise HTTPException(status_code=503, detail="Could not queue the approved launch; the request remains pending") from exc
    request = claimed
    request.update(update)
    try:
        await _resolve_native_elevation_review_notification(request_id, "approved")
    except Exception:
        pass
    await _write_native_audit("nexus_elevate_approved", request, caller, {
        "duration_minutes": duration,
        "reason": decision_reason,
        "agent_command_id": command_id,
        "sha256": request.get("sha256"),
    })
    return {"request": await _request_view(request), "command_id": command_id}


@router.post("/nexus-elevate/requests/{request_id}/deny")
async def deny_nexus_elevate_request(request_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    caller = await _get_caller(current_user)
    _ensure_native_elevation_operator(caller)
    request = await db.nexus_elevate_requests.find_one({"id": request_id}, {"_id": 0})
    if not request:
        raise HTTPException(status_code=404, detail="Elevation request not found")
    if request.get("status") != "pending":
        raise HTTPException(status_code=409, detail="Only pending elevation requests can be denied")
    reason = str(data.get("reason") or "").strip()
    if len(reason) < 8:
        raise HTTPException(status_code=400, detail="A denial reason of at least 8 characters is required")
    update = {
        "status": "denied",
        "denied_at": datetime.now(timezone.utc).isoformat(),
        "denied_by_id": caller.get("id"),
        "denied_by_name": caller.get("name"),
        "denial_reason": reason,
    }
    result = await db.nexus_elevate_requests.update_one(
        {"id": request_id, "status": "pending"},
        {"$set": update},
    )
    if not getattr(result, "matched_count", 0):
        raise HTTPException(status_code=409, detail="This elevation request was already decided by another technician")
    request.update(update)
    try:
        await _resolve_native_elevation_review_notification(request_id, "denied")
    except Exception:
        pass
    await _write_native_audit("nexus_elevate_denied", request, caller, {"reason": reason})
    return {"request": await _request_view(request)}


# Agent-facing endpoints: these are deliberately independent of Keeper EPM.
# The future tray/companion sends the request using the enrolled agent token;
# it never receives an administrator JWT or a capability to self-approve.
@router.post("/nexus-elevate/agent/requests")
async def create_native_elevation_request(data: dict, x_agent_token: str | None = Header(None)):
    if not x_agent_token:
        raise HTTPException(status_code=401, detail="Missing agent token")
    agent = await db.nexus_agents.find_one({"agent_token": x_agent_token, "is_active": True}, {"_id": 0})
    if not agent:
        raise HTTPException(status_code=401, detail="Invalid agent token")
    settings = await _native_settings()
    if not settings["native_enabled"]:
        raise HTTPException(status_code=409, detail="Native Nexus Elevate is disabled by the organisation")

    program_path = _normalise_windows_executable(data.get("program_path"))
    sha256 = str(data.get("sha256") or "").strip().lower()
    if not SHA256_PATTERN.fullmatch(sha256):
        raise HTTPException(status_code=400, detail="A SHA-256 fingerprint is required for every elevated executable")
    arguments = _normalise_argv(data.get("arguments"))
    justification = str(data.get("justification") or "").strip()
    if settings["require_justification"] and len(justification) < 8:
        raise HTTPException(status_code=400, detail="A technician or end-user justification of at least 8 characters is required")
    requested_duration = max(5, min(settings["max_duration_minutes"], int(data.get("requested_duration_minutes") or settings["max_duration_minutes"])))
    request_id = f"nel-{uuid.uuid4().hex[:16]}"
    requester = data.get("requester") if isinstance(data.get("requester"), dict) else {}
    request = {
        "id": request_id,
        "status": "pending",
        "provider": "native",
        "device_id": agent["id"],
        "client_id": agent.get("client_id") or "",
        "hostname": agent.get("hostname") or data.get("hostname") or "Managed endpoint",
        "program_path": program_path,
        "program_name": PureWindowsPath(program_path).name,
        "arguments": arguments,
        "sha256": sha256,
        "publisher": str(data.get("publisher") or "Unknown publisher").strip()[:500],
        "parent_process": str(data.get("parent_process") or "").strip()[:500],
        "requested_by_name": str(requester.get("name") or data.get("requester_name") or "Endpoint user").strip()[:200],
        "requested_by_sid": str(requester.get("sid") or data.get("requester_sid") or "").strip()[:200],
        "session_id": str(data.get("session_id") or "").strip()[:100],
        "justification": justification[:4000],
        "ticket_id": str(data.get("ticket_id") or "").strip()[:100],
        "requested_duration_minutes": requested_duration,
        "requested_at": datetime.now(timezone.utc).isoformat(),
        "agent_version": str(data.get("agent_version") or "").strip()[:100],
    }
    evaluation = await _evaluate_native_policy(request)
    request["policy_evaluation"] = evaluation
    matched_policy = evaluation.get("matched") or {}
    if evaluation.get("decision") == "deny":
        request.update({
            "status": "denied",
            "denied_at": datetime.now(timezone.utc).isoformat(),
            "denied_by_id": "nexus-elevate-policy-engine",
            "denied_by_name": "Nexus Elevate policy engine",
            "denial_reason": f"Blocked by enforced policy: {matched_policy.get('name') or matched_policy.get('id')}",
            "policy_denied": True,
        })
    await db.nexus_elevate_requests.insert_one(request)
    await _write_native_audit("nexus_elevate_requested", request, None, {
        "requested_by_name": request["requested_by_name"],
        "publisher": request["publisher"],
        "sha256": sha256,
        "ticket_id": request["ticket_id"],
        "policy_decision": evaluation.get("decision"),
        "matched_policy_id": matched_policy.get("id"),
        "monitor_policy_ids": [item.get("id") for item in evaluation.get("monitor_matches") or []],
    })
    if evaluation.get("decision") == "allow":
        command_id = await _queue_policy_auto_approval(request, matched_policy)
        await _write_native_audit("nexus_elevate_policy_auto_approved", request, None, {
            "policy_id": matched_policy.get("id"), "policy_name": matched_policy.get("name"),
            "agent_command_id": command_id, "sha256": sha256,
        })
    elif evaluation.get("decision") == "deny":
        await _write_native_audit("nexus_elevate_policy_denied", request, None, {
            "policy_id": matched_policy.get("id"), "policy_name": matched_policy.get("name"), "sha256": sha256,
        })
    elif matched_policy:
        await _write_native_audit("nexus_elevate_policy_review_required", request, None, {
            "policy_id": matched_policy.get("id"), "policy_name": matched_policy.get("name"), "sha256": sha256,
        })
    if request.get("status") == "pending":
        try:
            await _notify_native_elevation_review(request)
        except Exception:
            # A notification outage must never prevent the agent from safely
            # receiving its request ID and polling the decision state.
            pass
    return {"id": request_id, "status": request.get("status", "pending"), "poll_after_seconds": 5}


@router.get("/nexus-elevate/agent/requests")
async def list_native_elevation_agent_requests(x_agent_token: str | None = Header(None)):
    """Expose only this endpoint's recent Elevate history to its local companion."""
    agent = await db.nexus_agents.find_one({"agent_token": x_agent_token, "is_active": True}, {"_id": 0})
    if not agent:
        raise HTTPException(status_code=401, detail="Invalid agent token")
    await _expire_stale_native_approvals()
    rows = await db.nexus_elevate_requests.find(
        {"device_id": agent["id"]},
        {"_id": 0, "id": 1, "status": 1, "program_name": 1, "requested_at": 1, "approved_until": 1, "denial_reason": 1, "executed_at": 1},
    ).sort("requested_at", -1).to_list(25)
    return {"requests": rows}


@router.get("/nexus-elevate/agent/requests/{request_id}")
async def get_native_elevation_agent_status(request_id: str, x_agent_token: str | None = Header(None)):
    agent = await db.nexus_agents.find_one({"agent_token": x_agent_token, "is_active": True}, {"_id": 0})
    if not agent:
        raise HTTPException(status_code=401, detail="Invalid agent token")
    request = await db.nexus_elevate_requests.find_one({"id": request_id, "device_id": agent["id"]}, {"_id": 0})
    if not request:
        raise HTTPException(status_code=404, detail="Elevation request not found")
    if request.get("status") == "approved" and str(request.get("approved_until") or "") <= datetime.now(timezone.utc).isoformat():
        await _expire_stale_native_approvals()
        request = await db.nexus_elevate_requests.find_one({"id": request_id, "device_id": agent["id"]}, {"_id": 0}) or request
    return {
        "id": request["id"],
        "status": request.get("status"),
        "approved_until": request.get("approved_until"),
        "denial_reason": request.get("denial_reason"),
        "agent_command_id": request.get("agent_command_id"),
    }


async def record_native_elevation_execution(command: dict, result: dict, agent: dict) -> None:
    """Mirror the agent's exact hash-pinned launch result into the request audit."""
    request_id = command.get("elevation_request_id") or (command.get("payload") or {}).get("request_id")
    if not request_id:
        return
    request = await db.nexus_elevate_requests.find_one({"id": request_id, "device_id": agent.get("id")}, {"_id": 0})
    if not request:
        return
    completed_at = datetime.now(timezone.utc).isoformat()
    status = "executed" if result.get("status") == "ok" else "failed"
    update = {
        "status": status,
        "execution_status": result.get("status"),
        "execution_exit_code": result.get("exit_code"),
        "execution_stdout": str(result.get("stdout") or "")[-16000:],
        "execution_stderr": str(result.get("stderr") or "")[-4000:],
        "executed_at": completed_at,
        "execution_duration_ms": result.get("duration_ms") or 0,
    }
    await db.nexus_elevate_requests.update_one({"id": request_id}, {"$set": update})
    request.update(update)
    await _write_native_audit("nexus_elevate_executed" if status == "executed" else "nexus_elevate_execution_failed", request, None, {
        "agent_id": agent.get("id"),
        "command_id": command.get("id"),
        "exit_code": result.get("exit_code"),
        "duration_ms": result.get("duration_ms"),
    })
