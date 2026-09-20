"""
Just-in-Time (JIT) Permission Elevation — temporary elevated access for techs
with auto-expiry, audit, and break-glass mode.
"""
import re
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import PureWindowsPath
from typing import Any
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Header, Query
from app.database import db
from app.auth import get_current_user
from app.routers.tech_intel import _log_audit
from app.services.secret_store import encrypt_secret
from app.services.scope_permissions import (
    assert_client_scope,
    effective_scope,
    platform_tenant_id,
    scoped_query,
    tenant_scoped_query,
)

router = APIRouter()

ELEVATE_SETTINGS_ID = "nexus_elevate"
NATIVE_ELEVATE_MAX_DURATION = 60
SHA256_PATTERN = re.compile(r"^[a-fA-F0-9]{64}$")
SECURE_ACCESS_PROVIDERS = {"entra_pim", "windows_laps"}
SECURE_ACCESS_CONNECTOR_KEY = "nexus_secure_access_connector"

_TICKET_ELEVATION_ACTIONS = {
    "nexus_elevate_requested": ("nexus_elevate_requested", "Elevation requested"),
    "nexus_elevate_policy_auto_approved": ("nexus_elevate_policy_auto_approved", "Elevation policy queued a launch"),
    "nexus_elevate_policy_denied": ("nexus_elevate_policy_denied", "Elevation policy blocked a request"),
    "nexus_elevate_policy_review_required": ("nexus_elevate_policy_review_required", "Elevation policy requires technician review"),
    "nexus_elevate_approved": ("nexus_elevate_approved", "Elevation approved"),
    "nexus_elevate_denied": ("nexus_elevate_denied", "Elevation denied"),
    "nexus_elevate_cancelled": ("nexus_elevate_cancelled", "Elevation request withdrawn"),
    "nexus_elevate_revoked": ("nexus_elevate_revoked", "Queued elevation launch revoked"),
    "nexus_elevate_executed": ("nexus_elevate_executed", "Elevation executed"),
    "nexus_elevate_execution_failed": ("nexus_elevate_execution_failed", "Elevation execution failed"),
}


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


def _ticket_query_for_agent(agent: dict, ticket_reference: str) -> dict:
    """Constrain a linked ticket to the enrolled endpoint's client and tenant."""
    client_id = str(agent.get("client_id") or "").strip()
    if not client_id:
        raise HTTPException(status_code=409, detail="The managed endpoint must be assigned to a client before linking a ticket")
    reference_query = {"client_id": client_id, "$or": [{"id": ticket_reference}, {"ticket_number": ticket_reference}]}
    tenant_id = str(agent.get("tenant_id") or "nexus-local")
    if tenant_id == "nexus-local":
        return {
            "$and": [
                reference_query,
                {"$or": [{"tenant_id": "nexus-local"}, {"tenant_id": {"$exists": False}}]},
            ]
        }
    return {**reference_query, "tenant_id": tenant_id}


async def _resolve_agent_ticket_id(agent: dict, ticket_reference: str) -> str:
    """Resolve an optional display number to a stable, same-scope ticket ID."""
    reference = str(ticket_reference or "").strip()
    if not reference:
        return ""
    if len(reference) > 120:
        raise HTTPException(status_code=400, detail="Ticket reference is too long")
    ticket = await db.tickets.find_one(_ticket_query_for_agent(agent, reference), {"_id": 0, "id": 1})
    if not ticket or not ticket.get("id"):
        raise HTTPException(status_code=422, detail="Linked ticket is not available for this managed endpoint")
    return str(ticket["id"])


async def _write_ticket_elevation_evidence(kind: str, request: dict, actor: dict | None, details: dict) -> None:
    """Project safe Elevate lifecycle evidence into a validated ticket timeline.

    The Elevate request and command remain authoritative. This is a derived,
    idempotent ticket-local audit projection to make handovers and reviews
    visible where service work is managed.
    """
    mapping = _TICKET_ELEVATION_ACTIONS.get(kind)
    ticket_id = str(request.get("ticket_id") or "").strip()
    tenant_id = str(request.get("tenant_id") or "").strip()
    client_id = str(request.get("client_id") or "").strip()
    if not mapping or not ticket_id or not tenant_id or not client_id:
        return
    ticket_query = {"id": ticket_id, "client_id": client_id}
    if tenant_id == "nexus-local":
        ticket_query["$or"] = [{"tenant_id": "nexus-local"}, {"tenant_id": {"$exists": False}}]
    else:
        ticket_query["tenant_id"] = tenant_id
    ticket = await db.tickets.find_one(ticket_query, {"_id": 0, "id": 1})
    if not ticket:
        return

    action, label = mapping
    program = str(request.get("program_name") or PureWindowsPath(request.get("program_path") or "application.exe").name)
    metadata = {
        "nexus_elevate_kind": kind,
        "elevation_request_id": request.get("id"),
        "agent_id": request.get("device_id"),
        "agent_command_id": request.get("agent_command_id") or details.get("agent_command_id") or details.get("command_id"),
        "status": request.get("status"),
    }
    entry = {
        "id": f"ticket-elevate:{ticket_id}:{request.get('id')}:{action}",
        "ticket_id": ticket_id,
        "action": action,
        "details": f"{label}: {program} on {request.get('hostname') or 'managed endpoint'}.",
        "user_id": (actor or {}).get("id") or f"nexus-agent:{request.get('device_id') or 'unknown'}",
        "user_name": (actor or {}).get("name") or "Nexus Elevate",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "elevation_request_id": request.get("id"),
        "metadata": {key: value for key, value in metadata.items() if value not in (None, "")},
    }
    await db.ticket_audit_log.update_one(
        {"ticket_id": ticket_id, "elevation_request_id": request.get("id"), "action": action},
        {"$setOnInsert": entry},
        upsert=True,
    )


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
    try:
        await _write_ticket_elevation_evidence(kind, request, actor, details or {})
    except Exception:
        # Ticket evidence is a derived projection. It must never conceal or
        # reverse the authoritative Elevate audit if an older ticket timeline
        # collection is temporarily unavailable.
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


def _secure_access_provider_guidance(provider: str) -> dict:
    """Return safe, credential-free next steps for a provider-bound request.

    Nexus intentionally cannot complete these actions by accepting a copied
    password, passkey, recovery code, refresh token, or an operator attestation.
    A future delegated provider adapter must write connector-verified evidence
    before it may advance a request beyond ``provider_action_required``.
    """
    if provider == "entra_pim":
        return {
            "title": "Activate your eligible Entra role",
            "instructions": [
                "Use your own Microsoft Entra sign-in session.",
                "Activate only the eligible role required for this ticket and endpoint.",
                "Complete Microsoft-required MFA or approval in Entra.",
            ],
            "credential_handling": "Nexus never receives or replays the technician's passkey, password, MFA response, or token.",
        }
    return {
        "title": "Retrieve Windows LAPS through Microsoft",
        "instructions": [
            "Use your own authorised Microsoft Entra or Intune session.",
            "Retrieve the credential only through the Microsoft-controlled LAPS experience.",
            "Use it only for the approved endpoint and ticket scope.",
        ],
        "credential_handling": "Nexus never receives, stores, displays, or transfers a Windows LAPS password.",
    }


async def _write_secure_access_audit(kind: str, request: dict, actor: dict, details: dict | None = None) -> None:
    event = {
        "id": str(uuid.uuid4()),
        "kind": kind,
        "request_id": request.get("id"),
        "tenant_id": request.get("tenant_id"),
        "client_id": request.get("client_id"),
        "device_id": request.get("device_id"),
        "agent_id": request.get("agent_id"),
        "actor_id": actor.get("id"),
        "actor_name": actor.get("name"),
        "details": details or {},
        "at": datetime.now(timezone.utc).isoformat(),
    }
    await db.nexus_secure_access_audit.insert_one(event)
    try:
        await _log_audit(actor, kind, request.get("id"), "Nexus secure access request", {
            "provider": request.get("provider"),
            "client_id": request.get("client_id"),
            "device_id": request.get("device_id"),
            "ticket_id": request.get("ticket_id"),
            **(details or {}),
        })
    except Exception:
        # The request-specific audit is authoritative for this workflow.
        pass


def _secure_access_connector_query(caller: dict) -> dict:
    return tenant_scoped_query(caller, {"key": SECURE_ACCESS_CONNECTOR_KEY}, tenant_field="platform_tenant_id")


async def _secure_access_connector_settings(caller: dict) -> dict:
    stored = await db.settings.find_one(_secure_access_connector_query(caller), {"_id": 0}) or {}
    value = stored.get("value") if isinstance(stored.get("value"), dict) else {}
    configured = bool(value.get("tenant_id") and value.get("client_id") and value.get("client_secret_encrypted"))
    return {
        # The credential record is deliberately inert until the provider
        # adapter has a connector-verified PIM/LAPS contract.  Configuration
        # must never make the UI imply that Nexus can already activate roles.
        "enabled": False,
        "state": "configured_pending_provider_adapter" if configured else "awaiting_registration",
        "tenant_id": str(value.get("tenant_id") or ""),
        "client_id": str(value.get("client_id") or ""),
        "redirect_uri": str(value.get("redirect_uri") or ""),
        "client_secret_configured": bool(value.get("client_secret_encrypted")),
        "required_setup": [
            "Create a dedicated Entra app registration for Nexus secure access.",
            "Add the exact redirect URI and grant only the reviewed delegated permissions.",
            "Complete tenant-admin consent, then enable the connector in Nexus.",
        ],
        "updated_at": value.get("updated_at"),
    }


def _normalise_secure_access_redirect(raw: Any) -> str:
    value = str(raw or "").strip()
    if not value or len(value) > 500:
        raise HTTPException(status_code=400, detail="A valid redirect URI is required")
    parsed = urlparse(value)
    local_http = parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    if not (parsed.scheme == "https" or local_http) or not parsed.netloc or parsed.query or parsed.fragment:
        raise HTTPException(status_code=400, detail="Redirect URI must use HTTPS (or localhost HTTP) and contain no query or fragment")
    return value


def _policy_visible_to_caller(policy: dict, caller: dict) -> bool:
    """Return whether a policy is global or applies to an allowed client."""
    scope = effective_scope(caller)
    if scope["mode"] == "all":
        return True
    client_ids = {
        str(client_id)
        for client_id in ((policy.get("match") or {}).get("client_ids") or [])
        if client_id
    }
    return not client_ids or bool(client_ids.intersection(scope["client_ids"]))


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


def _require_manual_review_for_local_companion(evaluation: dict, *, is_local_companion: bool) -> dict:
    """Never auto-approve authority requested through the local UI bridge.

    The service token remains protected, but a loopback HTTP bridge cannot yet
    bind a request to a trusted Windows caller. Keep policies observable and
    preserve their matching evidence, while requiring a human technician until
    the companion channel moves to caller-bound IPC.
    """
    if not is_local_companion or evaluation.get("decision") != "allow":
        return evaluation
    matched = dict(evaluation.get("matched") or {})
    matched["action"] = "approval"
    matched["downgraded_reason"] = "Local companion requests require technician approval until caller-bound endpoint IPC is enabled."
    return {**evaluation, "decision": "approval", "matched": matched}


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
        "client_id": request.get("client_id"),
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
    policies = [policy for policy in policies if _policy_visible_to_caller(policy, caller)]
    clients = await db.clients.find(
        scoped_query(caller, {}, field="id", site_field=None), {"_id": 0, "id": 1, "name": 1}
    ).sort("name", 1).to_list(500)
    agents = await db.nexus_agents.find(
        scoped_query(caller, {"is_active": True}, site_field=None),
        {"_id": 0, "id": 1, "hostname": 1, "client_id": 1, "last_seen": 1},
    ).sort("hostname", 1).to_list(1000)
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
    if client_id:
        await assert_client_scope(caller, client_id, operation="nexus_elevate.policy.simulate")
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

# ---------------------------------------------------------------------------
# Nexus Elevate: provider-bound technician access requests
# ---------------------------------------------------------------------------

@router.post("/nexus-elevate/secure-access/requests")
async def create_secure_access_request(data: dict, current_user: dict = Depends(get_current_user)):
    """Record a scoped request to use a Microsoft-controlled access workflow.

    This intentionally creates no endpoint command and does not attempt to
    impersonate the technician at Entra, Intune, or the target endpoint.  It
    gives the subsequent delegated connector a stable, tenant-bound request to
    verify before it can offer a provider hand-off.
    """
    caller = await _get_caller(current_user)
    _ensure_native_elevation_operator(caller)
    provider = str(data.get("provider") or "").strip().lower()
    if provider not in SECURE_ACCESS_PROVIDERS:
        raise HTTPException(status_code=400, detail="Choose Microsoft Entra PIM or Windows LAPS")
    agent_id = str(data.get("agent_id") or "").strip()
    if not agent_id:
        raise HTTPException(status_code=400, detail="An enrolled Nexus Agent is required")
    agent = await db.nexus_agents.find_one(tenant_scoped_query(caller, {"id": agent_id}), {"_id": 0})
    if not agent:
        raise HTTPException(status_code=404, detail="Managed endpoint not found")
    client_id = str(agent.get("client_id") or "").strip()
    if not client_id:
        raise HTTPException(status_code=409, detail="The endpoint must be assigned to a client before secure access can be requested")
    await assert_client_scope(caller, client_id, operation="nexus_secure_access.request.create", mask_not_found=True)
    justification = str(data.get("justification") or "").strip()
    if len(justification) < 8 or len(justification) > 2000:
        raise HTTPException(status_code=400, detail="Provide a justification between 8 and 2000 characters")
    ticket_id = str(data.get("ticket_id") or "").strip()
    if len(ticket_id) > 120:
        raise HTTPException(status_code=400, detail="Ticket reference is too long")
    requested_minutes = int(data.get("requested_duration_minutes") or 30)
    if requested_minutes < 5 or requested_minutes > NATIVE_ELEVATE_MAX_DURATION:
        raise HTTPException(status_code=400, detail=f"Requested duration must be 5-{NATIVE_ELEVATE_MAX_DURATION} minutes")

    device = await db.devices.find_one(
        tenant_scoped_query(caller, {"nexus_agent_id": agent_id}),
        {"_id": 0, "id": 1, "name": 1, "site_id": 1},
    ) or {}
    now = datetime.now(timezone.utc).isoformat()
    request = {
        "id": f"nsa-{uuid.uuid4().hex[:16]}",
        "tenant_id": platform_tenant_id(caller),
        "provider": provider,
        "status": "provider_action_required",
        "client_id": client_id,
        "site_id": device.get("site_id") or agent.get("site_id"),
        "device_id": device.get("id"),
        "device_name": device.get("name") or agent.get("hostname") or "Managed endpoint",
        "agent_id": agent_id,
        "hostname": agent.get("hostname") or "",
        "ticket_id": ticket_id,
        "justification": justification,
        "requested_duration_minutes": requested_minutes,
        "requested_by_id": caller.get("id"),
        "requested_by_name": caller.get("name") or caller.get("email") or "Technician",
        "requested_at": now,
        "provider_action_required_at": now,
        # Explicitly record the non-secret boundary so a future adapter cannot
        # quietly expand this data model into a credential vault.
        "credential_material": "never_collected",
        "provider_verification": None,
    }
    await db.nexus_secure_access_requests.insert_one(request)
    await _write_secure_access_audit("nexus_secure_access_requested", request, caller, {
        "requested_duration_minutes": requested_minutes,
        "credential_material": "never_collected",
    })
    return {"request": {key: value for key, value in request.items() if key != "_id"}, "provider_guidance": _secure_access_provider_guidance(provider)}


@router.get("/nexus-elevate/secure-access/requests")
async def list_secure_access_requests(
    provider: str | None = Query(None),
    agent_id: str | None = Query(None),
    limit: int = Query(100, ge=1, le=300),
    current_user: dict = Depends(get_current_user),
):
    caller = await _get_caller(current_user)
    _ensure_native_elevation_operator(caller)
    query: dict[str, Any] = {}
    if provider:
        normalised = provider.strip().lower()
        if normalised not in SECURE_ACCESS_PROVIDERS:
            raise HTTPException(status_code=400, detail="Unknown secure-access provider")
        query["provider"] = normalised
    if agent_id:
        query["agent_id"] = agent_id
    rows = await db.nexus_secure_access_requests.find(
        tenant_scoped_query(caller, scoped_query(caller, query, site_field=None)), {"_id": 0}
    ).sort("requested_at", -1).to_list(limit)
    return {
        "requests": rows,
        "capabilities": {
            "provider_verified_handoff": False,
            "credential_replay": False,
            "laps_password_storage": False,
        },
    }


@router.get("/nexus-elevate/secure-access/readiness")
async def get_secure_access_readiness(
    agent_id: str = Query(..., min_length=1, max_length=200),
    current_user: dict = Depends(get_current_user),
):
    """Return a non-secret readiness preflight for a provider hand-off.

    A Nexus SSO identity binding is useful context, but deliberately is not
    treated as an Entra access token, a passkey assertion, or proof that the
    caller currently holds an eligible privileged role.
    """
    caller = await _get_caller(current_user)
    _ensure_native_elevation_operator(caller)
    agent = await db.nexus_agents.find_one(tenant_scoped_query(caller, {"id": agent_id}), {"_id": 0})
    if not agent:
        raise HTTPException(status_code=404, detail="Managed endpoint not found")
    client_id = str(agent.get("client_id") or "").strip()
    if not client_id:
        raise HTTPException(status_code=409, detail="The endpoint must be assigned to a client before access readiness can be checked")
    await assert_client_scope(caller, client_id, operation="nexus_secure_access.readiness", mask_not_found=True)
    client = await db.clients.find_one(
        tenant_scoped_query(caller, {"id": client_id}),
        {"_id": 0, "id": 1, "name": 1, "cipp_tenant_id": 1, "m365_tenant_id": 1, "office365_tenant_id": 1},
    ) or {}
    connection = await db.m365_tenant_connections.find_one(
        tenant_scoped_query(caller, {"client_id": client_id}, tenant_field="platform_tenant_id"),
        {"_id": 0, "tenant_id": 1, "tenant_name": 1, "graph_verified": 1, "access_status": 1},
    ) or {}
    provider_tenant_id = str(
        connection.get("tenant_id")
        or client.get("m365_tenant_id")
        or client.get("office365_tenant_id")
        or client.get("cipp_tenant_id")
        or ""
    ).strip()
    microsoft_identity_bound = bool(caller.get("sso_provider") == "microsoft" and caller.get("microsoft_id"))
    connector = await _secure_access_connector_settings(caller)
    return {
        "agent": {"id": agent.get("id"), "hostname": agent.get("hostname"), "client_id": client_id},
        "client": {"id": client_id, "name": client.get("name"), "provider_tenant_mapped": bool(provider_tenant_id)},
        "technician_identity": {
            "microsoft_identity_bound": microsoft_identity_bound,
            "identity_subject": "bound" if microsoft_identity_bound else "not_bound",
            "provider_session_reauthentication_required": True,
        },
        "provider_connection": {
            "entra_tenant_id": provider_tenant_id or None,
            "tenant_name": connection.get("tenant_name") or None,
            "graph_evidence_verified": bool(connection.get("graph_verified")),
            "delegated_secure_access_connector": connector["state"],
        },
        "ready_for_provider_verification": bool(connector["enabled"] and microsoft_identity_bound and provider_tenant_id),
        "next_requirement": "Configure a dedicated delegated Microsoft access connector with approved redirect URI and least-privilege consent. Nexus SSO and Partner Center credentials are not reused." if not connector["enabled"] else "Provider verification still requires a fresh Microsoft sign-in and eligible role activation.",
    }


@router.get("/nexus-elevate/secure-access/settings")
async def get_secure_access_settings(current_user: dict = Depends(get_current_user)):
    caller = await _get_caller(current_user)
    _ensure_admin(caller)
    return await _secure_access_connector_settings(caller)


@router.put("/nexus-elevate/secure-access/settings")
async def put_secure_access_settings(data: dict, current_user: dict = Depends(get_current_user)):
    """Store write-only registration metadata for the future delegated adapter.

    Saving this configuration does not initiate OAuth, grant consent, retrieve
    LAPS credentials, or activate a PIM role.  The secret is encrypted before
    persistence and is never returned by either settings or readiness routes.
    """
    caller = await _get_caller(current_user)
    _ensure_admin(caller)
    existing = await db.settings.find_one(_secure_access_connector_query(caller), {"_id": 0}) or {}
    previous = existing.get("value") if isinstance(existing.get("value"), dict) else {}
    tenant_id = str(data.get("tenant_id") or previous.get("tenant_id") or "").strip()
    client_id = str(data.get("client_id") or previous.get("client_id") or "").strip()
    redirect_uri = _normalise_secure_access_redirect(data.get("redirect_uri") or previous.get("redirect_uri"))
    if not tenant_id or len(tenant_id) > 200 or not client_id or len(client_id) > 200:
        raise HTTPException(status_code=400, detail="Tenant ID and application client ID are required")
    supplied_secret = str(data.get("client_secret") or "").strip()
    encrypted_secret = encrypt_secret(supplied_secret) if supplied_secret else str(previous.get("client_secret_encrypted") or "")
    if not encrypted_secret:
        raise HTTPException(status_code=400, detail="Enter the application client secret before saving the connector")
    requested_enabled = bool(data.get("enabled", False))
    value = {
        "enabled": False,
        "tenant_id": tenant_id,
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "client_secret_encrypted": encrypted_secret,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "updated_by": caller.get("id"),
    }
    await db.settings.update_one(
        _secure_access_connector_query(caller),
        {"$set": {"key": SECURE_ACCESS_CONNECTOR_KEY, "platform_tenant_id": platform_tenant_id(caller), "value": value}},
        upsert=True,
    )
    await _write_secure_access_audit("nexus_secure_access_connector_configured", {"id": SECURE_ACCESS_CONNECTOR_KEY, "tenant_id": platform_tenant_id(caller)}, caller, {
        "enabled": False,
        "activation_requested": requested_enabled,
        "tenant_id_configured": True,
        "client_id_configured": True,
        "client_secret_configured": True,
    })
    return await _secure_access_connector_settings(caller)


@router.get("/nexus-elevate/secure-access/requests/{request_id}")
async def get_secure_access_request(request_id: str, current_user: dict = Depends(get_current_user)):
    caller = await _get_caller(current_user)
    _ensure_native_elevation_operator(caller)
    request = await db.nexus_secure_access_requests.find_one(
        tenant_scoped_query(caller, {"id": request_id}), {"_id": 0}
    )
    if not request:
        raise HTTPException(status_code=404, detail="Secure access request not found")
    await assert_client_scope(caller, request.get("client_id"), site_id=request.get("site_id"), operation="nexus_secure_access.request.read", mask_not_found=True)
    events = await db.nexus_secure_access_audit.find(
        tenant_scoped_query(caller, {"request_id": request_id}), {"_id": 0}
    ).sort("at", -1).to_list(100)
    return {"request": request, "provider_guidance": _secure_access_provider_guidance(request["provider"]), "audit": events}

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
    requests = await db.nexus_elevate_requests.find(
        scoped_query(caller, {}, site_field=None), {"_id": 0}
    ).sort("requested_at", -1).to_list(250)
    active_agents = await db.nexus_agents.count_documents(scoped_query(caller, {"is_active": True}, site_field=None))
    online_cutoff = (now - timedelta(minutes=3)).isoformat()
    online_agents = await db.nexus_agents.count_documents(scoped_query(caller, {"is_active": True, "last_seen": {"$gte": online_cutoff}}, site_field=None))
    companion_agents = await db.nexus_agents.count_documents(scoped_query(caller, {
        "is_active": True,
        "client_companion_installed_at": {"$exists": True, "$ne": None},
    }, site_field=None))
    companion_agents_online = await db.nexus_agents.count_documents(scoped_query(caller, {
        "is_active": True,
        "last_seen": {"$gte": online_cutoff},
        "client_companion_installed_at": {"$exists": True, "$ne": None},
    }, site_field=None))
    elevate_active = await db.nexus_agents.count_documents(scoped_query(caller, {"is_active": True, "nexus_elevate.state": "active"}, site_field=None))
    elevate_deploying = await db.nexus_agents.count_documents(scoped_query(caller, {"is_active": True, "nexus_elevate.state": "deploying"}, site_field=None))
    pending = [row for row in requests if row.get("status") == "pending"]
    expiring = [row for row in requests if row.get("status") == "approved" and row.get("approved_until") and row["approved_until"] <= (now + timedelta(minutes=10)).isoformat()]
    failed = [row for row in requests if row.get("status") in {"failed", "expired"}]
    recent = [await _request_view(row) for row in requests[:8]]
    active_policies = sum(1 for policy in await db.nexus_elevate_policies.find({"enabled": True, "archived_at": {"$in": [None, ""]}}, {"_id": 0, "match": 1}).to_list(500) if _policy_visible_to_caller(policy, caller))
    enforced_policies = sum(1 for policy in await db.nexus_elevate_policies.find({"enabled": True, "mode": "enforce", "archived_at": {"$in": [None, ""]}}, {"_id": 0, "match": 1}).to_list(500) if _policy_visible_to_caller(policy, caller))
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
    rows = await db.nexus_elevate_requests.find(
        scoped_query(caller, query, site_field=None), {"_id": 0}
    ).sort("requested_at", -1).to_list(limit)
    return {"requests": [await _request_view(row) for row in rows]}


@router.get("/nexus-elevate/requests/{request_id}")
async def get_nexus_elevate_request(request_id: str, current_user: dict = Depends(get_current_user)):
    caller = await _get_caller(current_user)
    _ensure_native_elevation_operator(caller)
    await _expire_stale_native_approvals()
    request = await db.nexus_elevate_requests.find_one({"id": request_id}, {"_id": 0})
    if not request:
        raise HTTPException(status_code=404, detail="Elevation request not found")
    await assert_client_scope(caller, request.get("client_id"), operation="nexus_elevate.request.read", mask_not_found=True)
    events = await db.nexus_elevate_audit.find({"request_id": request_id}, {"_id": 0}).sort("at", -1).to_list(100)
    return {"request": await _request_view(request), "audit": events}


@router.post("/nexus-elevate/requests/{request_id}/approve")
async def approve_nexus_elevate_request(request_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    caller = await _get_caller(current_user)
    _ensure_native_elevation_operator(caller)
    request = await db.nexus_elevate_requests.find_one({"id": request_id}, {"_id": 0})
    if not request:
        raise HTTPException(status_code=404, detail="Elevation request not found")
    await assert_client_scope(caller, request.get("client_id"), operation="nexus_elevate.request.approve", mask_not_found=True)
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
        "client_id": request.get("client_id"),
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
    await assert_client_scope(caller, request.get("client_id"), operation="nexus_elevate.request.deny", mask_not_found=True)
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


@router.post("/nexus-elevate/requests/{request_id}/cancel")
async def cancel_nexus_elevate_request(request_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Withdraw a pending request or cancel a launch that has not left Nexus.

    A request is only marked revoked after its matching agent command was still
    pending and has been cancelled. Once an agent has dispatched a command,
    this route refuses to imply that an already-running process was stopped.
    """
    caller = await _get_caller(current_user)
    _ensure_native_elevation_operator(caller)
    request = await db.nexus_elevate_requests.find_one({"id": request_id}, {"_id": 0})
    if not request:
        raise HTTPException(status_code=404, detail="Elevation request not found")
    await assert_client_scope(caller, request.get("client_id"), operation="nexus_elevate.request.cancel", mask_not_found=True)
    reason = str(data.get("reason") or "").strip()
    if len(reason) < 8:
        raise HTTPException(status_code=400, detail="A cancellation reason of at least 8 characters is required")
    now = datetime.now(timezone.utc).isoformat()

    if request.get("status") == "pending":
        update = {
            "status": "cancelled",
            "cancelled_at": now,
            "cancelled_by_id": caller.get("id"),
            "cancelled_by_name": caller.get("name"),
            "cancellation_reason": reason,
        }
        result = await db.nexus_elevate_requests.update_one(
            {"id": request_id, "status": "pending"}, {"$set": update}
        )
        if not getattr(result, "matched_count", 0):
            raise HTTPException(status_code=409, detail="This elevation request was already decided by another technician")
        request.update(update)
        try:
            await _resolve_native_elevation_review_notification(request_id, "cancelled")
        except Exception:
            pass
        await _write_native_audit("nexus_elevate_cancelled", request, caller, {"reason": reason, "stage": "review"})
        return {"request": await _request_view(request), "message": "Elevation request withdrawn before approval"}

    if request.get("status") != "approved" or not request.get("agent_command_id"):
        raise HTTPException(status_code=409, detail="Only pending requests or approved launches that have not been dispatched can be cancelled")

    # Reserve the transition before touching the agent command. This prevents
    # two reviewers from both reporting a revocation and gives the agent a
    # stable, deny-by-default request state during the cancellation attempt.
    reserved = await db.nexus_elevate_requests.find_one_and_update(
        {"id": request_id, "status": "approved", "agent_command_id": request["agent_command_id"]},
        {"$set": {"status": "revoking", "revocation_requested_at": now, "revocation_requested_by_id": caller.get("id")}},
    )
    if not reserved:
        raise HTTPException(status_code=409, detail="This approved launch changed state before it could be cancelled")

    command = await db.nexus_agent_commands.find_one_and_update(
        {"id": request["agent_command_id"], "elevation_request_id": request_id, "status": "pending"},
        {"$set": {"status": "cancelled", "cancelled_at": now, "cancelled_by": caller.get("id") or caller.get("email")}},
    )
    if not command:
        # The agent may have fetched this command between the reservation and
        # cancellation attempt. Restore the truthful approved state; never
        # represent a dispatched or executed launch as revoked.
        await db.nexus_elevate_requests.update_one(
            {"id": request_id, "status": "revoking"},
            {"$set": {"status": "approved"}, "$unset": {"revocation_requested_at": "", "revocation_requested_by_id": ""}},
        )
        raise HTTPException(status_code=409, detail="The agent already received this launch; Nexus cannot claim it was cancelled")

    update = {
        "status": "revoked",
        "revoked_at": now,
        "revoked_by_id": caller.get("id"),
        "revoked_by_name": caller.get("name"),
        "revocation_reason": reason,
    }
    result = await db.nexus_elevate_requests.update_one(
        {"id": request_id, "status": "revoking"},
        {"$set": update},
    )
    if not getattr(result, "matched_count", 0):
        raise RuntimeError("Nexus Elevate command was cancelled but the request state could not be finalised")
    request.update(update)
    try:
        await _resolve_native_elevation_review_notification(request_id, "revoked")
    except Exception:
        pass
    await _write_native_audit("nexus_elevate_revoked", request, caller, {
        "reason": reason,
        "stage": "queued_launch",
        "agent_command_id": request.get("agent_command_id"),
    })
    return {"request": await _request_view(request), "message": "Queued elevation launch revoked before agent dispatch"}


# Agent-facing endpoints: these are deliberately independent of Keeper EPM.
# The future tray/companion sends the request using the enrolled agent token;
# it never receives an administrator JWT or a capability to self-approve.
@router.post("/nexus-elevate/agent/requests")
async def create_native_elevation_request(
    data: dict,
    x_agent_token: str | None = Header(None),
    x_nexus_local_companion: str | None = Header(None, alias="X-Nexus-Local-Companion"),
):
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
    ticket_id = await _resolve_agent_ticket_id(agent, str(data.get("ticket_id") or ""))
    request_id = f"nel-{uuid.uuid4().hex[:16]}"
    requester = data.get("requester") if isinstance(data.get("requester"), dict) else {}
    request_channel = "local_companion" if x_nexus_local_companion == "1" else "agent"
    request = {
        "id": request_id,
        "status": "pending",
        "provider": "native",
        "device_id": agent["id"],
        "client_id": agent.get("client_id") or "",
        "tenant_id": str(agent.get("tenant_id") or "nexus-local"),
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
        "ticket_id": ticket_id,
        "requested_duration_minutes": requested_duration,
        "requested_at": datetime.now(timezone.utc).isoformat(),
        "agent_version": str(data.get("agent_version") or "").strip()[:100],
        "request_channel": request_channel,
    }
    evaluation = _require_manual_review_for_local_companion(
        await _evaluate_native_policy(request),
        is_local_companion=request_channel == "local_companion",
    )
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
        "request_channel": request_channel,
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
