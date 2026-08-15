"""Shared action-specific permission vocabulary and enforcement.

NexusMSP historically stored broad module permissions (view/create/edit/delete)
on each user.  Those values remain a compatibility input, while this service
adds stable action subjects for high-impact operations.  Roles can opt into an
explicit action list without changing their stable role ID.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Callable

from fastapi import Depends, HTTPException, Request

from app.auth import get_current_user
from app.database import db


ACTION_PERMISSIONS: tuple[dict[str, Any], ...] = (
    {
        "id": "platform.core.rebuild",
        "category": "Platform",
        "label": "Rebuild Nexus Core relationships",
        "description": "Reconcile the canonical client/entity graph from operational source records.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "confidence.verify",
        "category": "Platform",
        "label": "Verify Nexus Confidence evidence",
        "description": "Attest that a client, device or documentation confidence profile was reviewed without overriding source-evidence gaps.",
        "impact": "medium",
        "approval_required": False,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "platform.events.manage",
        "category": "Platform",
        "label": "Manage event subscriptions",
        "description": "Create, update, pause and repair durable platform event deliveries.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "platform.events.replay",
        "category": "Platform",
        "label": "Replay retained events",
        "description": "Re-deliver retained platform events to governed subscribers.",
        "impact": "critical",
        "approval_required": True,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "platform.readiness.view",
        "category": "Platform",
        "label": "View production readiness",
        "description": "View launch gates, evidence requirements and the internal production-readiness register.",
        "impact": "low",
        "approval_required": False,
        "legacy": ("settings", "view"),
    },
    {
        "id": "platform.readiness.manage",
        "category": "Platform",
        "label": "Manage production readiness",
        "description": "Create and review launch evidence, test results and production-blocker decisions.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "dns.policy.modify",
        "category": "DNS",
        "label": "Modify DNS policies",
        "description": "Create or edit client and endpoint DNS policy.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("networking", "edit"),
    },
    {
        "id": "dns.deployment.stage",
        "category": "DNS",
        "label": "Stage DNS deployment",
        "description": "Queue a resolver or endpoint policy rollout.",
        "impact": "high",
        "approval_required": True,
        "legacy": ("networking", "edit"),
    },
    {
        "id": "dns.exception.create",
        "category": "DNS",
        "label": "Create DNS exception",
        "description": "Temporarily allow a blocked destination with a recorded reason.",
        "impact": "medium",
        "approval_required": False,
        "legacy": ("networking", "edit"),
    },
    {
        "id": "dns.emergency.disable",
        "category": "DNS",
        "label": "Emergency-disable DNS enforcement",
        "description": "Return enrolled endpoints to visibility mode during an incident.",
        "impact": "critical",
        "approval_required": True,
        "legacy": ("networking", "delete"),
    },
    {
        "id": "device.remote.start",
        "category": "Remote & devices",
        "label": "Start remote session",
        "description": "Initiate an attended or authorised remote session.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("agent_commands", "execute"),
    },
    {
        "id": "device.remote.end",
        "category": "Remote & devices",
        "label": "End remote session",
        "description": "Close a remote session and write its service, ticket and time evidence.",
        "impact": "medium",
        "approval_required": False,
        "legacy": ("agent_commands", "execute"),
    },
    {
        "id": "device.remote.configure",
        "category": "Remote & devices",
        "label": "Configure remote access",
        "description": "Change provider assignment, consent policy and remote endpoint identity.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "device.remote.repair",
        "category": "Remote & devices",
        "label": "Repair remote access",
        "description": "Run a bounded provider health repair through the trusted Nexus Agent.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("agent_commands", "execute"),
    },
    {
        "id": "device.command.execute",
        "category": "Remote & devices",
        "label": "Execute endpoint command",
        "description": "Run a device command, script, reboot, patch or process action.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("agent_commands", "execute"),
    },
    {
        "id": "asset.lifecycle.manage",
        "category": "Remote & devices",
        "label": "Manage connected asset lifecycle",
        "description": "Create or link the canonical inventory and lifecycle record for a managed endpoint.",
        "impact": "medium",
        "approval_required": False,
        "legacy": ("assets", "edit"),
    },
    {
        "id": "agent.trust.remediate",
        "category": "Remote & devices",
        "label": "Repair agent trust",
        "description": "Repair device identity, policy cache, configuration permissions or the support companion.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("agent_commands", "execute"),
    },
    {
        "id": "m365.tenant.manage",
        "category": "Microsoft 365",
        "label": "Manage Microsoft tenant connections",
        "description": "Configure Partner Center discovery, add tenants and map Microsoft tenants to Nexus clients.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "entra.user.create",
        "category": "Identity",
        "label": "Create cloud user",
        "description": "Create a Microsoft 365 or Entra user through Nexus Control.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "entra.user.disable",
        "category": "Identity",
        "label": "Disable or offboard user",
        "description": "Block sign-in or run a governed offboarding action.",
        "impact": "critical",
        "approval_required": True,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "entra.license.modify",
        "category": "Identity",
        "label": "Modify cloud licence",
        "description": "Assign or remove a Microsoft cloud licence.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "entra.group.modify",
        "category": "Identity",
        "label": "Modify cloud group access",
        "description": "Add or remove a Microsoft user from a cloud group through a governed tenant workflow.",
        "impact": "high",
        "approval_required": True,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "entra.role.modify",
        "category": "Identity",
        "label": "Modify privileged directory role",
        "description": "Assign, remove or time-bound a Microsoft directory role through an independently approved workflow.",
        "impact": "critical",
        "approval_required": True,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "exchange.mailbox.delegate",
        "category": "Microsoft 365",
        "label": "Modify mailbox delegation",
        "description": "Grant, change or remove shared-mailbox delegation through a governed, auditable workflow.",
        "impact": "high",
        "approval_required": True,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "intune.device.retire",
        "category": "Microsoft 365",
        "label": "Retire or wipe managed device",
        "description": "Retire, wipe or remove a Microsoft Intune managed device through a protected tenant workflow.",
        "impact": "critical",
        "approval_required": True,
        "legacy": ("agent_commands", "execute"),
    },
    {
        "id": "entra.conditional_access.modify",
        "category": "Microsoft 365",
        "label": "Modify Conditional Access policy",
        "description": "Create, update, enable, disable or remove a Microsoft Conditional Access policy through a controlled change workflow.",
        "impact": "critical",
        "approval_required": True,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "entra.credential.reset",
        "category": "Identity",
        "label": "Reset cloud credential",
        "description": "Reset a user password or authentication credential.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "ticket.handoff.manage",
        "category": "Service desk",
        "label": "Create and respond to ticket handovers",
        "description": "Pass, accept, decline, assist, consult, cover, return, escalate or swarm a ticket through Nexus Connect.",
        "impact": "medium",
        "approval_required": False,
        "legacy": ("tickets", "edit"),
    },
    {
        "id": "billing.invoice.create",
        "category": "Billing",
        "label": "Create invoice",
        "description": "Create a client invoice or generate one from an agreement.",
        "impact": "medium",
        "approval_required": False,
        "legacy": ("invoices", "create"),
    },
    {
        "id": "billing.invoice.modify",
        "category": "Billing",
        "label": "Modify invoice",
        "description": "Change invoice details, allocations or client ownership.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("invoices", "edit"),
    },
    {
        "id": "billing.payment.record",
        "category": "Billing",
        "label": "Record payment",
        "description": "Record or settle a client payment against an invoice.",
        "impact": "critical",
        "approval_required": True,
        "legacy": ("invoices", "edit"),
    },
    {
        "id": "billing.invoice.void",
        "category": "Billing",
        "label": "Void invoice",
        "description": "Void a financial document while retaining its audit evidence.",
        "impact": "critical",
        "approval_required": True,
        "legacy": ("invoices", "delete"),
    },
    {
        "id": "automation.workflow.modify",
        "category": "Automation",
        "label": "Modify workflow",
        "description": "Create, install, edit, toggle or retire an automation.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "automation.workflow.simulate",
        "category": "Automation",
        "label": "Simulate workflow",
        "description": "Run a non-mutating workflow simulation or controlled test.",
        "impact": "low",
        "approval_required": False,
        "legacy": ("settings", "view"),
    },
    {
        "id": "automation.workflow.execute",
        "category": "Automation",
        "label": "Execute workflow",
        "description": "Run an approved automation against its selected scope.",
        "impact": "critical",
        "approval_required": True,
        "legacy": ("agent_commands", "execute"),
    },
    {
        "id": "automation.workflow.approve",
        "category": "Automation",
        "label": "Approve workflow change",
        "description": "Submit or approve governed automation execution.",
        "impact": "critical",
        "approval_required": True,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "automation.autopilot.manage",
        "category": "Automation",
        "label": "Manage Nexus Autopilot policy",
        "description": "Configure the maximum autonomy level, client scope, confidence gate, and action allow-list.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "automation.autopilot.simulate",
        "category": "Automation",
        "label": "Simulate Nexus Autopilot",
        "description": "Generate a non-mutating Autopilot plan from retained Nexus evidence.",
        "impact": "low",
        "approval_required": False,
        "legacy": ("settings", "view"),
    },
    {
        "id": "automation.autopilot.pause",
        "category": "Automation",
        "label": "Pause Nexus Autopilot",
        "description": "Immediately return Autopilot to suggestion-only mode while preserving queued evidence.",
        "impact": "low",
        "approval_required": False,
        "legacy": ("agent_commands", "execute"),
    },
    {
        "id": "executive.intelligence.view",
        "category": "Executive",
        "label": "View CEO Mode",
        "description": "View cross-client revenue, cash, client-health, capacity, and business-risk evidence.",
        "impact": "low",
        "approval_required": False,
        "legacy": ("financial_reports", "view"),
    },
    {
        "id": "executive.scenario.simulate",
        "category": "Executive",
        "label": "Simulate an owner scenario",
        "description": "Run a non-mutating what-if model against the current executive baseline.",
        "impact": "low",
        "approval_required": False,
        "legacy": ("financial_reports", "view"),
    },
    {
        "id": "executive.board.snapshot",
        "category": "Executive",
        "label": "Save executive board snapshot",
        "description": "Retain a point-in-time board briefing with its source-quality statement.",
        "impact": "medium",
        "approval_required": False,
        "legacy": ("financial_reports", "create"),
    },
    {
        "id": "voice.pbx.modify",
        "category": "Voice",
        "label": "Modify PBX connection",
        "description": "Add or change a client PBX integration.",
        "impact": "high",
        "approval_required": False,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "voice.billing.recalculate",
        "category": "Voice",
        "label": "Recalculate voice billing",
        "description": "Recalculate billable extension quantity and agreement mapping.",
        "impact": "high",
        "approval_required": True,
        "legacy": ("invoices", "edit"),
    },
    {
        "id": "synergy.wholesale.manage",
        "category": "Web & domains",
        "label": "Manage Synergy Wholesale services",
        "description": "Request governed domain, DNS, hosting, certificate and Microsoft 365 provider actions.",
        "impact": "high",
        "approval_required": True,
        "legacy": ("settings", "edit"),
    },
    {
        "id": "security.containment.approve",
        "category": "Security",
        "label": "Approve containment",
        "description": "Approve isolation, suppression or another containment action.",
        "impact": "critical",
        "approval_required": True,
        "legacy": ("devices", "delete"),
    },
)

ACTION_PERMISSION_BY_ID = {item["id"]: item for item in ACTION_PERMISSIONS}
ACTION_PERMISSION_IDS = frozenset(ACTION_PERMISSION_BY_ID)


TECHNICIAN_DEFAULTS = frozenset(
    {
        "dns.exception.create",
        "device.remote.start",
        "device.remote.end",
        "device.remote.repair",
        "device.command.execute",
        "asset.lifecycle.manage",
        "confidence.verify",
        "entra.credential.reset",
        "ticket.handoff.manage",
        "automation.autopilot.pause",
        "automation.autopilot.simulate",
        "automation.workflow.simulate",
    }
)
DISPATCHER_DEFAULTS = frozenset({"automation.workflow.simulate"})
SERVICE_DESK_MANAGER_DEFAULTS = frozenset(
    permission_id
    for permission_id in ACTION_PERMISSION_IDS
    if permission_id
    not in {
        "billing.payment.record",
        "billing.invoice.void",
        "dns.emergency.disable",
        "platform.core.rebuild",
        "platform.events.replay",
        "platform.readiness.manage",
        "security.containment.approve",
        "executive.intelligence.view",
        "executive.scenario.simulate",
        "executive.board.snapshot",
    }
)

DEFAULT_ROLE_ACTION_PERMISSIONS: dict[str, frozenset[str]] = {
    "technician": TECHNICIAN_DEFAULTS,
    "dispatcher": DISPATCHER_DEFAULTS,
    "service_desk_manager": SERVICE_DESK_MANAGER_DEFAULTS,
    "admin": ACTION_PERMISSION_IDS,
}


def normalise_action_permissions(value: Any) -> list[str]:
    """Return a stable, validated action-permission list."""
    if isinstance(value, dict):
        values = [key for key, enabled in value.items() if enabled]
    elif isinstance(value, (list, tuple, set, frozenset)):
        values = list(value)
    else:
        values = []
    return sorted({str(item).strip() for item in values if str(item).strip() in ACTION_PERMISSION_IDS})


def default_permissions_for_role(role_id: str) -> list[str]:
    defaults = DEFAULT_ROLE_ACTION_PERMISSIONS.get(str(role_id or "").strip().lower(), TECHNICIAN_DEFAULTS)
    return sorted(defaults)


def permission_catalogue() -> dict[str, Any]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for raw in ACTION_PERMISSIONS:
        item = {key: value for key, value in raw.items() if key != "legacy"}
        grouped[item["category"]].append(item)
    return {
        "actions": [
            {key: value for key, value in item.items() if key != "legacy"}
            for item in ACTION_PERMISSIONS
        ],
        "categories": [
            {"name": category, "actions": actions}
            for category, actions in grouped.items()
        ],
        "impact_levels": ["low", "medium", "high", "critical"],
    }


async def _stored_role_permission(role_id: str) -> tuple[bool, set[str]]:
    stored = await db.settings.find_one(
        {"key": "access_role_catalogue"},
        {"_id": 0, "value": 1},
    ) or {}
    for item in stored.get("value", []):
        if isinstance(item, dict) and item.get("id") == role_id and "action_permissions" in item:
            return True, set(normalise_action_permissions(item.get("action_permissions")))
    return False, set()


def _user_override(user: dict[str, Any], permission_id: str) -> tuple[bool, bool]:
    value = user.get("action_permissions")
    if isinstance(value, dict) and permission_id in value:
        return True, bool(value[permission_id])
    if isinstance(value, (list, tuple, set, frozenset)):
        return True, permission_id in normalise_action_permissions(value)
    return False, False


async def evaluate_action_permission(user: dict[str, Any], permission_id: str) -> dict[str, Any]:
    if permission_id not in ACTION_PERMISSION_BY_ID:
        return {"allowed": False, "source": "unknown-action", "permission": permission_id}

    if user.get("is_admin") or str(user.get("role") or "").lower() == "admin":
        return {"allowed": True, "source": "administrator", "permission": permission_id}

    has_override, override_allowed = _user_override(user, permission_id)
    if has_override:
        return {
            "allowed": override_allowed,
            "source": "user-override",
            "permission": permission_id,
        }

    role_id = str(user.get("role") or "technician").strip().lower()
    role_is_explicit, role_permissions = await _stored_role_permission(role_id)
    if role_is_explicit:
        return {
            "allowed": permission_id in role_permissions,
            "source": "role-action-policy",
            "permission": permission_id,
        }

    action = ACTION_PERMISSION_BY_ID[permission_id]
    module, operation = action.get("legacy") or (None, None)
    legacy_permissions = user.get("permissions") if isinstance(user.get("permissions"), dict) else {}
    module_permissions = legacy_permissions.get(module) if isinstance(legacy_permissions.get(module), dict) else {}
    legacy_allowed = bool(module_permissions.get(operation))
    default_allowed = permission_id in DEFAULT_ROLE_ACTION_PERMISSIONS.get(role_id, TECHNICIAN_DEFAULTS)
    return {
        "allowed": legacy_allowed or default_allowed,
        "source": "legacy-compatible-role-default",
        "permission": permission_id,
    }


async def effective_action_permissions(user: dict[str, Any]) -> dict[str, Any]:
    evaluations = [await evaluate_action_permission(user, item["id"]) for item in ACTION_PERMISSIONS]
    allowed = [item["permission"] for item in evaluations if item["allowed"]]
    denied = [item["permission"] for item in evaluations if not item["allowed"]]
    return {
        "user_id": user.get("id"),
        "role": user.get("role", "technician"),
        "administrator": bool(user.get("is_admin") or user.get("role") == "admin"),
        "allowed": allowed,
        "denied": denied,
        "evaluations": evaluations,
    }


def require_action(permission_id: str) -> Callable[..., Any]:
    if permission_id not in ACTION_PERMISSION_BY_ID:
        raise RuntimeError(f"Unknown NexusMSP action permission: {permission_id}")

    async def dependency(
        request: Request,
        current_user: dict = Depends(get_current_user),
    ) -> dict:
        result = await evaluate_action_permission(current_user, permission_id)
        if result["allowed"]:
            return current_user

        correlation_id = getattr(request.state, "correlation_id", None)
        await db.permission_denials.insert_one(
            {
                "permission": permission_id,
                "user_id": current_user.get("id"),
                "user_name": current_user.get("name"),
                "role": current_user.get("role"),
                "source": result.get("source"),
                "method": request.method,
                "path": request.url.path,
                "correlation_id": correlation_id,
                "occurred_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        raise HTTPException(
            status_code=403,
            detail=f"Action permission required: {permission_id}",
            headers={"X-Required-Permission": permission_id},
        )

    return dependency
