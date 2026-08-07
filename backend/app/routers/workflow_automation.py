"""Governed workflow automation and simulation for NexusMSP.

The studio deliberately separates planning from execution. A simulation records
what would change, risk, rollback, and evidence without mutating client systems.
Material workflows can then be handed to Change Management for independent
approval.
"""

from datetime import datetime, timezone
from typing import Any
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException, Request

from app.auth import get_current_user
from app.database import db
from app.services.action_permissions import require_action
from app.services.platform_foundation import emit_platform_event, request_correlation_id
from app.services.scope_permissions import assert_client_scope, assert_record_scope, scoped_query

router = APIRouter()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _actor(user: dict) -> str:
    return user.get("name") or user.get("email") or user.get("id") or "Unknown technician"


async def _run_in_scope(run_id: str, current_user: dict, operation: str, request: Request | None = None) -> dict:
    return await assert_record_scope(
        current_user,
        db.workflow_runs,
        run_id,
        operation=operation,
        request=request,
        resource_name="Automation run",
    )


TRIGGER_TYPES = [
    {"id": "ticket_created", "label": "Ticket created", "category": "Service desk", "fields": ["priority", "category", "client_id", "source"]},
    {"id": "ticket_updated", "label": "Ticket updated", "category": "Service desk", "fields": ["priority", "status", "assigned_to"]},
    {"id": "ticket_sla_breach", "label": "SLA breach", "category": "Service desk", "fields": ["breach_type", "client_id"]},
    {"id": "device_offline", "label": "Asset goes offline", "category": "Managed assets", "fields": ["client_id", "device_type", "duration_minutes"]},
    {"id": "device_warning", "label": "Asset warning", "category": "Managed assets", "fields": ["metric", "threshold", "client_id"]},
    {"id": "backup_failed", "label": "Backup failed", "category": "Backups", "fields": ["client_id", "backup_type"]},
    {"id": "alert_triggered", "label": "Security or monitoring alert", "category": "Security", "fields": ["severity", "alert_type", "device_id"]},
    {"id": "client_health_change", "label": "Client health changed", "category": "Clients", "fields": ["health_status", "client_id"]},
    {"id": "invoice_overdue", "label": "Invoice overdue", "category": "Billing", "fields": ["days_overdue", "amount_threshold"]},
    {"id": "schedule", "label": "Scheduled", "category": "Platform", "fields": ["cron_expression", "timezone"]},
    {"id": "patch_available", "label": "Critical patch available", "category": "Security", "fields": ["severity", "os_type"]},
    {"id": "new_client", "label": "Client created", "category": "Lifecycle", "fields": []},
    {"id": "new_user_request", "label": "New employee request approved", "category": "Lifecycle", "fields": ["client_id", "user_id", "manager_id", "start_date"]},
    {"id": "termination_request", "label": "Employee termination approved", "category": "Lifecycle", "fields": ["client_id", "user_id", "manager_id", "termination_at"]},
    {"id": "contract_renewal", "label": "Contract renewal window", "category": "Lifecycle", "fields": ["client_id", "contract_id", "days_until_renewal"]},
    {"id": "webhook_event", "label": "Authenticated webhook", "category": "Integrations", "fields": ["event_type", "source", "client_id"]},
    {"id": "platform_event", "label": "Platform event subject", "category": "Platform", "fields": ["event_subject"]},
]


ACTION_TYPES = [
    {"id": "condition", "label": "Condition branch", "category": "Flow", "fields": ["field", "operator", "value"], "risk": 0, "rollback": "No change is made."},
    {"id": "ai_decision", "label": "AI decision and recommendation", "category": "AI", "fields": ["instruction", "confidence_threshold"], "risk": 1, "rollback": "Discard the recommendation and retain the original workflow path."},
    {"id": "request_approval", "label": "Request technician approval", "category": "Governance", "fields": ["approval_group", "reason"], "risk": 0, "rollback": "Cancel the approval request."},
    {"id": "assign_ticket", "label": "Assign ticket", "category": "Tickets", "fields": ["assign_to", "assign_method"], "risk": 1, "rollback": "Restore the previous ticket owner."},
    {"id": "change_priority", "label": "Change ticket priority", "category": "Tickets", "fields": ["new_priority"], "risk": 1, "rollback": "Restore the previous ticket priority."},
    {"id": "add_note", "label": "Add auditable ticket note", "category": "Tickets", "fields": ["note_text"], "risk": 0, "rollback": "Notes remain in history; add a correcting note if required."},
    {"id": "create_ticket", "label": "Create linked ticket", "category": "Tickets", "fields": ["title", "priority", "category", "assign_to"], "risk": 1, "rollback": "Close the generated ticket with a cancellation reason."},
    {"id": "send_email", "label": "Send mailbox-routed email", "category": "Communications", "fields": ["to", "subject", "template"], "risk": 2, "rollback": "Email cannot be recalled reliably; send a correction if required."},
    {"id": "send_teams", "label": "Send Teams notification", "category": "Communications", "fields": ["channel", "message"], "risk": 1, "rollback": "Remove or correct the notification where supported."},
    {"id": "run_script", "label": "Run approved script", "category": "Managed assets", "fields": ["script_id", "target_devices"], "risk": 3, "rollback": "Run the script-specific rollback and validate the endpoint state."},
    {"id": "deploy_application", "label": "Deploy application", "category": "Managed assets", "fields": ["application_id", "target_devices"], "risk": 3, "rollback": "Uninstall the application and restore the previous configuration."},
    {"id": "reboot_device", "label": "Restart managed asset", "category": "Managed assets", "fields": ["delay_minutes"], "risk": 2, "rollback": "A restart cannot be reversed; confirm service recovery."},
    {"id": "tag_device", "label": "Update asset classification", "category": "Managed assets", "fields": ["tags"], "risk": 1, "rollback": "Restore the previous asset tags."},
    {"id": "create_m365_user", "label": "Create Microsoft 365 user", "category": "Microsoft 365", "fields": ["display_name", "user_principal_name", "usage_location"], "risk": 3, "rollback": "Block sign-in and remove the newly created account after preserving evidence."},
    {"id": "disable_m365_user", "label": "Disable Microsoft 365 user", "category": "Microsoft 365", "fields": ["user_id"], "risk": 4, "rollback": "Re-enable sign-in and restore the recorded account state."},
    {"id": "assign_m365_license", "label": "Assign Microsoft licence", "category": "Microsoft 365", "fields": ["user_id", "sku_id"], "risk": 2, "rollback": "Remove the assigned licence and restore the previous SKU set."},
    {"id": "remove_m365_license", "label": "Remove Microsoft licence", "category": "Microsoft 365", "fields": ["user_id", "sku_id"], "risk": 4, "rollback": "Reassign the recorded SKU and validate dependent services."},
    {"id": "convert_shared_mailbox", "label": "Convert mailbox to shared", "category": "Microsoft 365", "fields": ["user_id"], "risk": 3, "rollback": "Convert the mailbox back and restore the previous licence state."},
    {"id": "update_security_groups", "label": "Update security-group membership", "category": "Microsoft 365", "fields": ["user_id", "group_ids"], "risk": 3, "rollback": "Restore the before-state group memberships."},
    {"id": "archive_onedrive", "label": "Archive OneDrive", "category": "Microsoft 365", "fields": ["user_id", "destination"], "risk": 3, "rollback": "Restore content from the recorded archive destination."},
    {"id": "create_yeastar_extension", "label": "Create Yeastar extension", "category": "Voice", "fields": ["pbx_id", "extension", "display_name"], "risk": 2, "rollback": "Disable and remove the created extension after preserving call-routing evidence."},
    {"id": "disable_yeastar_extension", "label": "Disable Yeastar extension", "category": "Voice", "fields": ["pbx_id", "extension"], "risk": 3, "rollback": "Re-enable the extension and restore the previous routing."},
    {"id": "generate_document", "label": "Generate branded document", "category": "Documentation", "fields": ["template_id", "destination"], "risk": 1, "rollback": "Archive the generated document and restore the prior published version."},
    {"id": "update_documentation", "label": "Update client documentation", "category": "Documentation", "fields": ["document_type", "source"], "risk": 1, "rollback": "Restore the prior document revision."},
    {"id": "webhook", "label": "Call versioned webhook", "category": "Integrations", "fields": ["url", "method", "payload"], "risk": 3, "rollback": "Invoke the connector-specific compensation action where available."},
    {"id": "wait", "label": "Wait or schedule", "category": "Flow", "fields": ["duration_minutes"], "risk": 0, "rollback": "Cancel the queued continuation."},
]

ACTION_BY_ID = {item["id"]: item for item in ACTION_TYPES}
CONDITION_OPERATORS = ["equals", "not_equals", "contains", "greater_than", "less_than", "is_empty", "is_not_empty"]


AUTOMATION_PACKS = [
    {
        "id": "pack-new-employee",
        "name": "New employee onboarding",
        "category": "Identity & lifecycle",
        "description": "Create the user, licence services, provision voice, deploy apps, document the outcome, and notify the manager.",
        "trigger": {"type": "new_user_request"},
        "actions": [
            {"type": "create_m365_user", "config": {}},
            {"type": "assign_m365_license", "config": {}},
            {"type": "create_yeastar_extension", "config": {}},
            {"type": "update_security_groups", "config": {}},
            {"type": "deploy_application", "config": {}},
            {"type": "generate_document", "config": {"template_id": "welcome-pack"}},
            {"type": "send_email", "config": {"template": "new-employee-ready"}},
        ],
    },
    {
        "id": "pack-employee-termination",
        "name": "Employee termination",
        "category": "Identity & lifecycle",
        "description": "A governed offboarding plan with access removal, mailbox conversion, data archive, voice routing, and asset recovery.",
        "trigger": {"type": "termination_request"},
        "actions": [
            {"type": "request_approval", "config": {"approval_group": "Service Desk Leads"}},
            {"type": "disable_m365_user", "config": {}},
            {"type": "convert_shared_mailbox", "config": {}},
            {"type": "archive_onedrive", "config": {}},
            {"type": "remove_m365_license", "config": {}},
            {"type": "disable_yeastar_extension", "config": {}},
            {"type": "create_ticket", "config": {"title": "Recover employee assets", "priority": "high"}},
            {"type": "update_documentation", "config": {"document_type": "offboarding-record"}},
        ],
    },
    {
        "id": "pack-client-onboarding",
        "name": "New client onboarding",
        "category": "Client lifecycle",
        "description": "Create the onboarding record, child work, documentation, deployment actions, and commercial handoff.",
        "trigger": {"type": "new_client"},
        "actions": [
            {"type": "create_ticket", "config": {"title": "Client onboarding programme", "priority": "high"}},
            {"type": "generate_document", "config": {"template_id": "client-welcome-pack"}},
            {"type": "deploy_application", "config": {}},
            {"type": "update_documentation", "config": {"document_type": "client-baseline"}},
            {"type": "send_email", "config": {"template": "client-onboarding-kickoff"}},
        ],
    },
    {
        "id": "pack-m365-hardening",
        "name": "Microsoft 365 hardening",
        "category": "Security",
        "description": "Assess identity controls, simulate proposed hardening, request approval, then create tracked remediation work.",
        "trigger": {"type": "schedule"},
        "actions": [
            {"type": "ai_decision", "config": {"instruction": "Prioritise the highest-impact identity control gaps", "confidence_threshold": "0.85"}},
            {"type": "request_approval", "config": {"approval_group": "Security Reviewers"}},
            {"type": "create_ticket", "config": {"title": "Microsoft 365 hardening remediation", "priority": "high"}},
            {"type": "generate_document", "config": {"template_id": "security-change-pack"}},
        ],
    },
    {
        "id": "pack-essential-eight",
        "name": "Essential Eight evidence cycle",
        "category": "Compliance",
        "description": "Schedule evidence collection, identify gaps, create remediation work, and generate an audit-ready pack.",
        "trigger": {"type": "schedule"},
        "actions": [
            {"type": "ai_decision", "config": {"instruction": "Summarise observed Essential Eight evidence gaps"}},
            {"type": "create_ticket", "config": {"title": "Essential Eight evidence gaps", "priority": "medium"}},
            {"type": "generate_document", "config": {"template_id": "essential-eight-evidence"}},
            {"type": "send_email", "config": {"template": "compliance-review-ready"}},
        ],
    },
    {
        "id": "pack-cyber-insurance",
        "name": "Cyber insurance readiness",
        "category": "Compliance",
        "description": "Collect evidence, flag unanswered requirements, and prepare a review pack without asserting certification.",
        "trigger": {"type": "contract_renewal"},
        "actions": [
            {"type": "ai_decision", "config": {"instruction": "Identify evidence gaps without treating missing evidence as a pass"}},
            {"type": "create_ticket", "config": {"title": "Cyber insurance evidence review", "priority": "high"}},
            {"type": "generate_document", "config": {"template_id": "cyber-insurance-evidence"}},
        ],
    },
    {
        "id": "pack-backup-recovery",
        "name": "Backup failure recovery",
        "category": "Resilience",
        "description": "Triage a failed backup, correlate the asset, open work, notify the owner, and preserve recovery evidence.",
        "trigger": {"type": "backup_failed"},
        "actions": [
            {"type": "ai_decision", "config": {"instruction": "Assess likely cause and safe recovery sequence"}},
            {"type": "create_ticket", "config": {"title": "Backup recovery required", "priority": "critical"}},
            {"type": "send_teams", "config": {"channel": "Backup Operations"}},
            {"type": "update_documentation", "config": {"document_type": "backup-incident"}},
        ],
    },
    {
        "id": "pack-site-deployment",
        "name": "New site deployment",
        "category": "Infrastructure",
        "description": "Coordinate network, managed assets, voice, documentation, validation, and client handover.",
        "trigger": {"type": "webhook_event"},
        "actions": [
            {"type": "request_approval", "config": {"approval_group": "Project Leads"}},
            {"type": "create_ticket", "config": {"title": "Site deployment programme", "priority": "high"}},
            {"type": "deploy_application", "config": {}},
            {"type": "update_documentation", "config": {"document_type": "site-topology"}},
            {"type": "generate_document", "config": {"template_id": "site-handover"}},
            {"type": "send_email", "config": {"template": "site-ready"}},
        ],
    },
]


INDUSTRY_PACKS = [
    {
        "id": f"pack-industry-{slug}",
        "name": f"{industry} managed environment",
        "category": "Industry blueprint",
        "industry": industry,
        "description": description,
        "trigger": {"type": "new_client"},
        "actions": [
            {"type": "request_approval", "config": {"approval_group": "Service Delivery Leads"}},
            {"type": "create_ticket", "config": {"title": f"{industry} onboarding programme", "priority": "high"}},
            {"type": "deploy_application", "config": {}},
            {"type": "update_documentation", "config": {"document_type": f"{slug}-environment-baseline"}},
            {"type": "generate_document", "config": {"template_id": f"{slug}-client-handover"}},
            {"type": "send_email", "config": {"template": "client-onboarding-kickoff"}},
        ],
    }
    for slug, industry, description in [
        ("dental", "Dental", "Deploy a practice-ready identity, endpoint, backup, security, documentation and support baseline."),
        ("accounting", "Accounting", "Protect financial workflows with identity controls, line-of-business safeguards, backup evidence and documented support."),
        ("legal", "Legal", "Create a confidentiality-led legal practice baseline with governed access, evidence retention and resilient endpoints."),
        ("construction", "Construction", "Prepare office and field teams with mobile-ready identity, managed endpoints, site documentation and secure access."),
        ("education", "Education", "Establish a least-privilege education baseline for staff, shared devices, safeguarding evidence and resilient learning services."),
        ("manufacturing", "Manufacturing", "Coordinate production endpoints, operational technology boundaries, recovery controls and change-aware support."),
    ]
]
AUTOMATION_PACKS.extend(INDUSTRY_PACKS)


PACK_METADATA = {
    "pack-new-employee": {
        "outcome": "A new employee is ready to work with every identity, device, voice and handover step evidenced.",
        "required_connections": ["Microsoft 365", "Yeastar", "Nexus Agent", "Mailbox"],
        "permissions": ["Create identities", "Assign licences", "Deploy applications", "Send communications"],
    },
    "pack-employee-termination": {
        "outcome": "Access is removed at the approved time, data is preserved and recoverable assets are tracked.",
        "required_connections": ["Microsoft 365", "Yeastar", "Mailbox"],
        "permissions": ["Disable identities", "Remove licences", "Change call routing", "Create recovery work"],
    },
    "pack-client-onboarding": {
        "outcome": "A new client receives one accountable parent programme with deployable work, evidence and handover.",
        "required_connections": ["Nexus Agent", "Mailbox"],
        "permissions": ["Create tickets", "Deploy applications", "Create documentation", "Send communications"],
    },
    "pack-m365-hardening": {
        "outcome": "Microsoft 365 control gaps become a simulated, approved and auditable hardening programme.",
        "required_connections": ["Microsoft 365"],
        "permissions": ["Read tenant posture", "Create remediation work", "Generate evidence"],
    },
    "pack-essential-eight": {
        "outcome": "Essential Eight evidence is collected consistently and observed gaps become accountable work.",
        "required_connections": ["Nexus Agent", "Microsoft 365"],
        "permissions": ["Read security posture", "Create remediation work", "Generate evidence"],
    },
    "pack-cyber-insurance": {
        "outcome": "Insurance readiness is reviewed from observed evidence without falsely asserting certification.",
        "required_connections": ["Nexus Agent", "Microsoft 365", "Backups"],
        "permissions": ["Read operational evidence", "Create remediation work", "Generate evidence"],
    },
    "pack-backup-recovery": {
        "outcome": "A failed backup is triaged, linked to its asset and client, and preserved as recovery evidence.",
        "required_connections": ["Backups", "Mailbox or Teams"],
        "permissions": ["Read backup status", "Create tickets", "Send notifications", "Update documentation"],
    },
    "pack-site-deployment": {
        "outcome": "A new site moves through approved deployment, validation, documentation and client handover.",
        "required_connections": ["Nexus Agent", "Mailbox"],
        "permissions": ["Deploy applications", "Create tickets", "Create documentation", "Send communications"],
    },
}


def _pack_artifacts(pack: dict) -> list[dict]:
    """Declare every object a pack installs without activating external change."""
    industry = pack.get("industry")
    base = [
        {
            "kind": "workflow",
            "name": pack["name"],
            "description": f"{len(pack.get('actions') or [])}-step governed automation with simulation and rollback evidence.",
            "route": "/workflow-automation",
        },
        {
            "kind": "ticket_blueprint",
            "name": f"{pack['name']} delivery record",
            "description": "Structured intake, verification checklist and completion gate for accountable delivery.",
            "route": "/blueprints",
        },
        {
            "kind": "documentation_template",
            "name": f"{pack['name']} operating guide",
            "description": "Technician procedure, validation checks, escalation path and evidence expectations.",
            "route": "/documentation-hub?tab=library",
        },
        {
            "kind": "documentation_template",
            "name": f"{pack['name']} client handover",
            "description": "Professional client-facing summary of scope, outcome, ownership and next steps.",
            "route": "/documentation-hub?tab=library",
        },
        {
            "kind": "policy",
            "name": f"{pack['name']} baseline",
            "description": "Disabled policy draft containing the pack's recommended monitoring and delivery controls.",
            "route": "/scripting?tab=policies",
        },
        {
            "kind": "alert_rule",
            "name": f"{pack['name']} exception",
            "description": "Disabled exception rule that raises accountable work when the expected outcome drifts.",
            "route": "/alert-rules",
        },
    ]
    if industry:
        base.append({
            "kind": "security_baseline",
            "name": f"{industry} minimum security baseline",
            "description": "An editable, disabled security baseline aligned to the industry's operational risk profile.",
            "route": "/nexus-shield",
        })
        base.append({
            "kind": "backup_policy",
            "name": f"{industry} recovery baseline",
            "description": "An editable, disabled recovery policy with verification and escalation expectations.",
            "route": "/backup-center",
        })
    return base


def _pack_manifest(pack: dict) -> dict:
    metadata = PACK_METADATA.get(pack["id"], {})
    industry = pack.get("industry")
    artifacts = _pack_artifacts(pack)
    component_counts: dict[str, int] = {}
    for artifact in artifacts:
        component_counts[artifact["kind"]] = component_counts.get(artifact["kind"], 0) + 1
    return {
        **pack,
        "version": "1.0.0",
        "industry": industry,
        "outcome": metadata.get("outcome") or (
            f"A complete {industry.lower()} operating baseline is installed as governed drafts ready for client-specific review."
            if industry else pack["description"]
        ),
        "required_connections": metadata.get("required_connections") or ["Nexus Agent", "Microsoft 365", "Backups", "Mailbox"],
        "permissions": metadata.get("permissions") or ["Create tickets", "Deploy policies", "Create documentation", "Send communications"],
        "estimated_setup_minutes": 20 if industry else 12,
        "artifacts": artifacts,
        "component_counts": component_counts,
        "component_total": len(artifacts),
        "publisher": "Nexus verified",
        "trust": {
            "signature": "Nexus verified",
            "external_changes": False,
            "default_state": "Disabled drafts",
            "simulation_required": True,
            "independent_approval": True,
            "rollback_declared": True,
        },
    }


def _normalise_actions(actions: list[dict]) -> list[dict]:
    normalised = []
    for index, action in enumerate(actions or []):
        normalised.append({
            "id": action.get("id") or f"act-{uuid.uuid4().hex[:8]}",
            "type": action.get("type") or "",
            "config": action.get("config") or {},
            "order": index + 1,
        })
    return normalised


def _condition_matches(condition: dict, event: dict) -> bool:
    field = condition.get("field")
    if not field:
        return True
    value = event.get(field)
    expected = condition.get("value")
    operator = condition.get("operator", "equals")
    if operator == "equals":
        return str(value).lower() == str(expected).lower()
    if operator == "not_equals":
        return str(value).lower() != str(expected).lower()
    if operator == "contains":
        return str(expected).lower() in str(value).lower()
    if operator == "is_empty":
        return value in (None, "", [], {})
    if operator == "is_not_empty":
        return value not in (None, "", [], {})
    try:
        if operator == "greater_than":
            return float(value) > float(expected)
        if operator == "less_than":
            return float(value) < float(expected)
    except (TypeError, ValueError):
        return False
    return False


def _build_simulation(workflow: dict, context: dict, user: dict) -> dict:
    actions = _normalise_actions(workflow.get("actions") or [])
    steps = []
    missing = []
    risk_points = 0
    for index, action in enumerate(actions):
        definition = ACTION_BY_ID.get(action["type"], {
            "label": action["type"].replace("_", " ").title() or "Unknown action",
            "fields": [],
            "risk": 2,
            "rollback": "Review the connector-specific rollback procedure.",
        })
        config = action.get("config") or {}
        required_fields = definition.get("fields") or []
        absent = [field for field in required_fields if not config.get(field) and not context.get(field)]
        if absent:
            missing.append({"step": index + 1, "action": definition["label"], "fields": absent})
        risk = int(definition.get("risk") or 0)
        risk_points += risk
        target = (
            config.get("target_devices")
            or config.get("user_id")
            or config.get("pbx_id")
            or config.get("to")
            or context.get("target_name")
            or context.get("client_name")
            or "Resolved from the approved runtime event"
        )
        steps.append({
            "step": index + 1,
            "action": action["type"],
            "label": definition["label"],
            "category": definition.get("category") or "Automation",
            "target": target,
            "before": "Current recorded state will be captured immediately before execution.",
            "after": f"{definition['label']} completed with connector response preserved.",
            "rollback": definition.get("rollback"),
            "risk": "high" if risk >= 4 else "medium" if risk >= 2 else "low",
            "status": "needs_configuration" if absent else "ready_to_simulate",
            "missing_fields": absent,
        })

    high_risk_steps = sum(step["risk"] == "high" for step in steps)
    risk_level = "high" if risk_points >= 10 or high_risk_steps else "medium" if risk_points >= 4 else "low"
    condition_results = [{
        "field": condition.get("field"),
        "operator": condition.get("operator", "equals"),
        "expected": condition.get("value"),
        "observed": context.get(condition.get("field")),
        "matches": _condition_matches(condition, context) if context else None,
    } for condition in workflow.get("conditions", [])]
    requires_approval = risk_level in {"medium", "high"} or any(step["action"] == "request_approval" for step in steps)
    return {
        "id": f"SIM-{uuid.uuid4().hex[:8].upper()}",
        "workflow_id": workflow["id"],
        "workflow_name": workflow.get("name") or "Untitled workflow",
        "mode": "simulation",
        "status": "blocked" if missing else "ready_for_approval" if requires_approval else "safe_to_run",
        "risk_level": risk_level,
        "requires_approval": requires_approval,
        "will_execute": False,
        "summary": {
            "steps": len(steps),
            "systems": len({step["category"] for step in steps}),
            "configuration_gaps": sum(len(item["fields"]) for item in missing),
            "high_risk_steps": high_risk_steps,
        },
        "trigger": workflow.get("trigger") or {},
        "condition_results": condition_results,
        "steps": steps,
        "missing_configuration": missing,
        "impact": f"{len(steps)} proposed step(s) across {len({step['category'] for step in steps})} NexusMSP capability area(s).",
        "rollback_plan": "\n".join(f"{step['step']}. {step['rollback']}" for step in reversed(steps)) or "No mutating actions are configured.",
        "context": context,
        "simulated_by": _actor(user),
        "simulated_by_id": user.get("id"),
        "simulated_at": _now(),
    }


@router.get("/workflows/triggers")
async def get_workflow_triggers(current_user: dict = Depends(get_current_user)):
    return TRIGGER_TYPES


@router.get("/workflows/actions")
async def get_workflow_actions(current_user: dict = Depends(get_current_user)):
    return ACTION_TYPES


async def _install_pack_artifact(
    artifact: dict,
    *,
    pack: dict,
    installation_id: str,
    scope: dict,
    current_user: dict,
    now: str,
) -> dict:
    kind = artifact["kind"]
    common = {
        "source_pack_id": pack["id"],
        "source_pack_version": pack["version"],
        "installation_id": installation_id,
        "pack_state": "configuration_required",
        "scope": scope,
        "created_by": _actor(current_user),
        "created_at": now,
        "updated_at": now,
    }
    if kind == "ticket_blueprint":
        record = {
            "id": f"bp-{uuid.uuid4().hex[:10]}",
            "name": artifact["name"],
            "description": artifact["description"],
            "icon": "Workflow",
            "color": "violet",
            "default_priority": "high",
            "default_category": "automation",
            "default_status": "open",
            "default_assignee_id": None,
            "sla_minutes": 480,
            "require_completion": True,
            "fields": [
                {"key": "service_owner", "label": "Service owner", "type": "text", "required": True, "placeholder": "Accountable technician"},
                {"key": "approved_scope", "label": "Approved scope", "type": "textarea", "required": True, "placeholder": "Client, users, sites and devices covered"},
                {"key": "validation_result", "label": "Validation result", "type": "textarea", "required": True, "placeholder": "Evidence that the intended outcome was achieved"},
            ],
            "checklist": [
                {"id": f"cl-{uuid.uuid4().hex[:8]}", "label": "Confirm client scope and prerequisites", "required": True},
                {"id": f"cl-{uuid.uuid4().hex[:8]}", "label": "Review simulation and approval evidence", "required": True},
                {"id": f"cl-{uuid.uuid4().hex[:8]}", "label": "Validate outcome and record exceptions", "required": True},
                {"id": f"cl-{uuid.uuid4().hex[:8]}", "label": "Complete client handover and audit note", "required": True},
            ],
            "child_templates": [],
            "active": False,
            **common,
        }
        await db.blueprints.insert_one(record)
        return {"kind": kind, "id": record["id"], "name": record["name"], "collection": "blueprints", "route": artifact["route"], "state": "disabled_draft"}

    if kind == "documentation_template":
        record = {
            "id": f"doc-{uuid.uuid4().hex[:10]}",
            "client_id": scope.get("client_id"),
            "client_name": scope.get("client_name"),
            "title": artifact["name"],
            "content": (
                f"# {artifact['name']}\n\n"
                f"## Intended outcome\n{pack['outcome']}\n\n"
                "## Before you begin\nConfirm the declared connections, permission boundary, client scope, "
                "maintenance window and rollback owner.\n\n"
                "## Delivery procedure\n1. Configure every draft component.\n"
                "2. Run Simulation Mode and review before/after evidence.\n"
                "3. Submit material changes for independent approval.\n"
                "4. Execute only within the approved client scope.\n"
                "5. Record validation, exceptions and client communication.\n\n"
                "## Evidence checklist\n- Scope and technician identity\n- Simulation and approval record\n"
                "- Component versions\n- Validation outcome\n- Exceptions and rollback actions\n"
            ),
            "category": "automation",
            "parent_id": None,
            "is_template": True,
            "tags": ["workflow-marketplace", pack["id"], pack.get("industry") or pack["category"]],
            "version": 1,
            "view_count": 0,
            "last_edited_by": current_user.get("id"),
            "last_edited_by_name": _actor(current_user),
            "archived": False,
            **common,
        }
        await db.documentation.insert_one(record)
        return {"kind": kind, "id": record["id"], "name": record["title"], "collection": "documentation", "route": artifact["route"], "state": "editable_template"}

    if kind in {"policy", "security_baseline", "backup_policy"}:
        record = {
            "id": f"pol-{uuid.uuid4().hex[:10]}",
            "name": artifact["name"],
            "description": artifact["description"],
            "policy_type": "security" if kind == "security_baseline" else "backup" if kind == "backup_policy" else "monitoring",
            "enabled": False,
            "priority": 100,
            "settings": {"marketplace_pack": pack["id"], "requires_configuration": True},
            "scripts_to_run": [],
            "alert_thresholds": {},
            "target_groups": [],
            "target_os": ["windows", "macos", "linux"],
            **common,
        }
        await db.policies.insert_one(record)
        return {"kind": kind, "id": record["id"], "name": record["name"], "collection": "policies", "route": artifact["route"], "state": "disabled_draft"}

    if kind == "alert_rule":
        record = {
            "id": f"ar-{uuid.uuid4().hex[:10]}",
            "name": artifact["name"],
            "description": artifact["description"],
            "metric": "policy_drift",
            "operator": "equals",
            "threshold": 1,
            "duration_minutes": 5,
            "scope": "client" if scope.get("client_id") else "all",
            "scope_filter": {"client_id": scope.get("client_id")} if scope.get("client_id") else {},
            "actions": [{"type": "create_ticket", "config": {"priority": "high", "category": "automation"}}],
            "severity": "high",
            "enabled": False,
            "cooldown_minutes": 60,
            "trigger_count": 0,
            "last_triggered": None,
            **common,
        }
        await db.alert_rules.insert_one(record)
        return {"kind": kind, "id": record["id"], "name": record["name"], "collection": "alert_rules", "route": artifact["route"], "state": "disabled_draft"}

    raise ValueError(f"Unsupported marketplace artifact type: {kind}")


@router.get("/workflows/templates")
async def get_workflow_templates(current_user: dict = Depends(get_current_user)):
    installations = await db.workflow_pack_installations.find(
        {"status": {"$ne": "removed"}},
        {"_id": 0},
    ).sort("installed_at", -1).to_list(500)
    installation_by_pack = {item.get("pack_id"): item for item in installations}
    legacy_workflows = await db.workflows.find(
        {"source_pack_id": {"$exists": True}, "archived": {"$ne": True}},
        {"_id": 0, "source_pack_id": 1, "id": 1, "enabled": 1, "approval_status": 1},
    ).to_list(500)
    legacy_by_pack = {item.get("source_pack_id"): item for item in legacy_workflows}
    result = []
    for item in AUTOMATION_PACKS:
        pack = _pack_manifest(item)
        installation = installation_by_pack.get(pack["id"])
        legacy = legacy_by_pack.get(pack["id"])
        installed = bool(installation or legacy)
        lifecycle = (installation or {}).get("status")
        if not lifecycle and legacy:
            lifecycle = "active" if legacy.get("enabled") else "configuration_required"
        result.append({
            **pack,
            "installed": installed,
            "status": lifecycle or "available",
            "steps": len(pack["actions"]),
            "installation": installation,
            "workflow_id": (installation or {}).get("workflow_id") or (legacy or {}).get("id"),
        })
    return result


@router.post("/workflows/templates/{pack_id}/install", dependencies=[Depends(require_action("automation.workflow.modify"))])
async def install_workflow_template(
    pack_id: str,
    request: Request,
    payload: dict = Body(default={}),
    current_user: dict = Depends(get_current_user),
):
    source_pack = next((item for item in AUTOMATION_PACKS if item["id"] == pack_id), None)
    if not source_pack:
        raise HTTPException(404, "Automation pack not found")
    pack = _pack_manifest(source_pack)
    existing_installation = await db.workflow_pack_installations.find_one(
        {"pack_id": pack_id, "status": {"$ne": "removed"}},
        {"_id": 0},
    )
    if existing_installation:
        existing_workflow = await db.workflows.find_one({"id": existing_installation.get("workflow_id")}, {"_id": 0})
        return {"installation": existing_installation, "workflow": existing_workflow, "already_installed": True}

    requested_scope = str(payload.get("scope") or "all_clients")
    if requested_scope not in {"all_clients", "client"}:
        raise HTTPException(400, "Pack scope must be all_clients or client")
    client_id = str(payload.get("client_id") or "") if requested_scope == "client" else ""
    client = None
    if requested_scope == "client":
        if not client_id:
            raise HTTPException(400, "Choose a client for a client-scoped installation")
        await assert_client_scope(
            current_user,
            client_id,
            operation="automation.pack.install",
            request=request,
        )
        client = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1})
        if not client:
            raise HTTPException(404, "Client not found")

    now = _now()
    installation_id = f"wpi-{uuid.uuid4().hex[:10]}"
    scope = {
        "type": requested_scope,
        "client_id": client_id or None,
        "client_name": (client or {}).get("name"),
    }
    workflow = {
        "id": f"wf-{uuid.uuid4().hex[:8]}",
        "source_pack_id": pack_id,
        "source_pack_version": pack["version"],
        "installation_id": installation_id,
        "name": pack["name"],
        "description": pack["description"],
        "category": pack["category"],
        "enabled": False,
        "trigger": pack["trigger"],
        "conditions": [],
        "actions": _normalise_actions(pack["actions"]),
        "nodes": [],
        "edges": [],
        "execution_count": 0,
        "simulation_count": 0,
        "last_executed": None,
        "last_simulated_at": None,
        "approval_status": "not_submitted",
        "pack_state": "configuration_required",
        "scope": scope,
        "created_by": _actor(current_user),
        "created_at": now,
        "updated_at": now,
    }
    created_refs = []
    try:
        await db.workflows.insert_one(workflow)
        created_refs.append({"collection": "workflows", "id": workflow["id"]})
        artifact_refs = []
        for artifact in pack["artifacts"]:
            if artifact["kind"] == "workflow":
                artifact_refs.append({
                    "kind": "workflow",
                    "id": workflow["id"],
                    "name": workflow["name"],
                    "collection": "workflows",
                    "route": artifact["route"],
                    "state": "disabled_draft",
                })
                continue
            ref = await _install_pack_artifact(
                artifact,
                pack=pack,
                installation_id=installation_id,
                scope=scope,
                current_user=current_user,
                now=now,
            )
            artifact_refs.append(ref)
            created_refs.append({"collection": ref["collection"], "id": ref["id"]})
        installation = {
            "id": installation_id,
            "pack_id": pack_id,
            "pack_name": pack["name"],
            "version": pack["version"],
            "publisher": pack["publisher"],
            "workflow_id": workflow["id"],
            "status": "configuration_required",
            "scope": scope,
            "artifact_refs": artifact_refs,
            "component_total": len(artifact_refs),
            "external_changes": False,
            "installed_by": _actor(current_user),
            "installed_by_id": current_user.get("id"),
            "installed_at": now,
            "updated_at": now,
        }
        await db.workflow_pack_installations.insert_one(installation)
    except Exception:
        for ref in reversed(created_refs):
            await db[ref["collection"]].delete_one({"id": ref["id"]})
        raise

    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": current_user.get("id"),
        "user_name": _actor(current_user),
        "action": "automation_pack_installed",
        "entity_type": "workflow_pack_installation",
        "entity_id": installation_id,
        "entity_name": pack["name"],
        "metadata": {
            "pack_id": pack_id,
            "version": pack["version"],
            "workflow_id": workflow["id"],
            "scope": scope,
            "component_total": installation["component_total"],
            "external_changes": False,
        },
        "created_at": now,
    })
    await emit_platform_event(
        subject="automation.pack.installed",
        source="nexus.workflow_marketplace",
        payload={
            "installation_id": installation_id,
            "pack_id": pack_id,
            "pack_name": pack["name"],
            "version": pack["version"],
            "workflow_id": workflow["id"],
            "scope": scope,
            "component_total": installation["component_total"],
            "external_changes": False,
        },
        actor=current_user,
        client_id=client_id or None,
        correlation_id=request_correlation_id(request),
        idempotency_key=f"workflow-pack-install:{installation_id}",
        partition_key=client_id or "nexus-marketplace",
    )
    workflow.pop("_id", None)
    installation.pop("_id", None)
    return {"installation": installation, "workflow": workflow, "already_installed": False}


@router.delete("/workflows/templates/{pack_id}/install", dependencies=[Depends(require_action("automation.workflow.modify"))])
async def remove_workflow_template(pack_id: str, request: Request, current_user: dict = Depends(get_current_user)):
    installation = await db.workflow_pack_installations.find_one(
        {"pack_id": pack_id, "status": {"$ne": "removed"}},
        {"_id": 0},
    )
    if not installation:
        legacy_workflow = await db.workflows.find_one(
            {"source_pack_id": pack_id, "archived": {"$ne": True}},
            {"_id": 0},
        )
        if not legacy_workflow:
            raise HTTPException(404, "Installed automation pack not found")
        installation = {
            "id": f"legacy-{legacy_workflow['id']}",
            "pack_id": pack_id,
            "pack_name": legacy_workflow.get("name"),
            "workflow_id": legacy_workflow["id"],
            "status": "configuration_required",
            "scope": legacy_workflow.get("scope") or {"type": "all_clients", "client_id": None},
            "artifact_refs": [{
                "kind": "workflow",
                "id": legacy_workflow["id"],
                "name": legacy_workflow.get("name"),
                "collection": "workflows",
                "route": "/workflow-automation",
                "state": "disabled_draft",
            }],
            "component_total": 1,
            "legacy_installation": True,
        }
    workflow = await db.workflows.find_one({"id": installation.get("workflow_id")}, {"_id": 0})
    if workflow and workflow.get("enabled"):
        raise HTTPException(409, "Pause the workflow before removing its pack")
    active_runs = await db.workflow_runs.count_documents({
        "workflow_id": installation.get("workflow_id"),
        "status": {"$in": ["queued", "running", "waiting", "awaiting_approval"]},
    })
    if active_runs:
        raise HTTPException(409, f"{active_runs} active workflow run(s) must finish or be cancelled before removal")

    now = _now()
    updates = {
        "workflows": {"archived": True, "enabled": False, "pack_state": "removed", "updated_at": now},
        "blueprints": {"active": False, "pack_state": "removed", "updated_at": now},
        "documentation": {"archived": True, "pack_state": "removed", "updated_at": now},
        "policies": {"enabled": False, "pack_state": "removed", "updated_at": now},
        "alert_rules": {"enabled": False, "pack_state": "removed", "updated_at": now},
    }
    for ref in installation.get("artifact_refs") or []:
        collection = ref.get("collection")
        if collection in updates and ref.get("id"):
            await db[collection].update_one({"id": ref["id"]}, {"$set": updates[collection]})
    if not installation.get("legacy_installation"):
        await db.workflow_pack_installations.update_one(
            {"id": installation["id"]},
            {"$set": {
                "status": "removed",
                "removed_by": _actor(current_user),
                "removed_by_id": current_user.get("id"),
                "removed_at": now,
                "updated_at": now,
            }},
        )
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": current_user.get("id"),
        "user_name": _actor(current_user),
        "action": "automation_pack_removed",
        "entity_type": "workflow_pack_installation",
        "entity_id": installation["id"],
        "entity_name": installation.get("pack_name"),
        "metadata": {
            "pack_id": pack_id,
            "workflow_id": installation.get("workflow_id"),
            "component_total": installation.get("component_total"),
            "preserved_in_audit": True,
        },
        "created_at": now,
    })
    await emit_platform_event(
        subject="automation.pack.removed",
        source="nexus.workflow_marketplace",
        payload={
            "installation_id": installation["id"],
            "pack_id": pack_id,
            "pack_name": installation.get("pack_name"),
            "workflow_id": installation.get("workflow_id"),
            "component_total": installation.get("component_total"),
            "preserved_in_audit": True,
        },
        actor=current_user,
        client_id=(installation.get("scope") or {}).get("client_id"),
        correlation_id=request_correlation_id(request),
        idempotency_key=f"workflow-pack-remove:{installation['id']}",
        partition_key=(installation.get("scope") or {}).get("client_id") or "nexus-marketplace",
    )
    return {
        "message": "Automation pack removed",
        "installation_id": installation["id"],
        "pack_id": pack_id,
        "removed_components": installation.get("component_total") or len(installation.get("artifact_refs") or []),
        "audit_preserved": True,
    }


@router.get("/workflows/simulations/recent")
async def get_recent_simulations(current_user: dict = Depends(get_current_user)):
    return await db.workflow_simulations.find({}, {"_id": 0}).sort("simulated_at", -1).to_list(100)


@router.get("/workflows/stats/overview")
async def get_workflow_stats(current_user: dict = Depends(get_current_user)):
    await db.workflows.update_many(
        {"approval_status": {"$exists": False}},
        {"$set": {"enabled": False, "approval_status": "not_submitted", "updated_at": _now()}},
    )
    all_workflows = await db.workflows.find({"archived": {"$ne": True}}, {"_id": 0}).to_list(500)
    if not all_workflows:
        all_workflows = await _seed_monitoring_workflow()
    return {
        "total": len(all_workflows),
        "active": sum(bool(item.get("enabled")) and item.get("approval_status") in {"approved", "not_required"} for item in all_workflows),
        "inactive": sum(not item.get("enabled") or item.get("approval_status") not in {"approved", "not_required"} for item in all_workflows),
        "total_executions": sum(item.get("execution_count", 0) for item in all_workflows),
        "simulations": await db.workflow_simulations.count_documents({}),
        "pending_approvals": await db.change_requests.count_documents({"workflow_id": {"$exists": True}, "status": "pending_review"}),
        "installed_packs": sum(bool(item.get("source_pack_id")) for item in all_workflows),
    }


@router.get("/workflows")
async def get_workflows(current_user: dict = Depends(get_current_user)):
    await db.workflows.update_many(
        {"approval_status": {"$exists": False}},
        {"$set": {"enabled": False, "approval_status": "not_submitted", "updated_at": _now()}},
    )
    workflows = await db.workflows.find({"archived": {"$ne": True}}, {"_id": 0}).sort("updated_at", -1).to_list(200)
    if not workflows:
        workflows = await _seed_monitoring_workflow()
    return workflows


@router.get("/workflows/runtime/health")
async def get_automation_runtime_health(current_user: dict = Depends(get_current_user)):
    from app.services.automation_runtime import runtime_health

    return await runtime_health()


@router.get("/workflows/runs")
async def get_automation_runs(
    status: str | None = None,
    workflow_id: str | None = None,
    limit: int = 100,
    current_user: dict = Depends(get_current_user),
):
    query: dict[str, Any] = {}
    allowed_statuses = {"queued", "running", "waiting", "awaiting_approval", "completed", "failed", "cancelled"}
    if status:
        if status not in allowed_statuses:
            raise HTTPException(400, "Unknown automation run status")
        query["status"] = status
    if workflow_id:
        query["workflow_id"] = workflow_id
    return await db.workflow_runs.find(
        scoped_query(current_user, query, site_field=None),
        {"_id": 0},
    ).sort("created_at", -1).to_list(max(1, min(limit, 250)))


@router.get("/workflows/runs/{run_id}")
async def get_automation_run(run_id: str, current_user: dict = Depends(get_current_user)):
    run = await _run_in_scope(run_id, current_user, "automation.run.read")
    approvals = await db.workflow_run_approvals.find({"run_id": run_id}, {"_id": 0}).sort("requested_at", 1).to_list(50)
    return {**run, "approvals": approvals}


@router.post("/workflows/runs/{run_id}/approve", dependencies=[Depends(require_action("automation.workflow.approve"))])
async def approve_automation_run(
    run_id: str,
    payload: dict = Body(default={}),
    request: Request = None,
    current_user: dict = Depends(get_current_user),
):
    from app.services.automation_runtime import decide_run_approval

    await _run_in_scope(run_id, current_user, "automation.run.approve", request)
    try:
        return await decide_run_approval(run_id, True, current_user, payload.get("reason"))
    except ValueError as error:
        raise HTTPException(409, str(error)) from error


@router.post("/workflows/runs/{run_id}/reject", dependencies=[Depends(require_action("automation.workflow.approve"))])
async def reject_automation_run(
    run_id: str,
    payload: dict = Body(default={}),
    request: Request = None,
    current_user: dict = Depends(get_current_user),
):
    from app.services.automation_runtime import decide_run_approval

    try:
        return await decide_run_approval(run_id, False, current_user, payload.get("reason"))
    except ValueError as error:
        raise HTTPException(409, str(error)) from error


@router.post("/workflows/runs/{run_id}/retry", dependencies=[Depends(require_action("automation.workflow.execute"))])
async def retry_automation_run(
    run_id: str,
    payload: dict = Body(default={}),
    request: Request = None,
    current_user: dict = Depends(get_current_user),
):
    from app.services.automation_runtime import retry_run

    try:
        return await retry_run(run_id, current_user, payload.get("reason"))
    except ValueError as error:
        raise HTTPException(409, str(error)) from error


@router.post("/workflows/runs/{run_id}/compensation/preview")
async def preview_automation_compensation(
    run_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    from app.services.automation_runtime import compensation_preview

    run = await _run_in_scope(run_id, current_user, "automation.run.compensation.preview", request)
    return compensation_preview(run)


@router.post("/workflows/runs/{run_id}/compensate", dependencies=[Depends(require_action("automation.workflow.approve"))])
async def execute_automation_compensation(
    run_id: str,
    payload: dict = Body(default={}),
    request: Request = None,
    current_user: dict = Depends(get_current_user),
):
    from app.services.automation_runtime import compensate_run

    try:
        return await compensate_run(run_id, current_user, payload.get("reason"))
    except ValueError as error:
        raise HTTPException(409, str(error)) from error


@router.post("/workflows/{workflow_id}/run", dependencies=[Depends(require_action("automation.workflow.execute"))])
async def run_workflow_now(
    workflow_id: str,
    request: Request,
    payload: dict = Body(default={}),
    current_user: dict = Depends(get_current_user),
):
    from app.services.automation_runtime import queue_workflow_run

    workflow = await db.workflows.find_one({"id": workflow_id}, {"_id": 0})
    if not workflow:
        raise HTTPException(404, "Workflow not found")
    if not workflow.get("enabled") or workflow.get("approval_status") not in {"approved", "not_required"}:
        raise HTTPException(409, "Only an enabled, approved workflow can be queued")
    context = payload.get("context") or {}
    await assert_client_scope(
        current_user,
        context.get("client_id") or None,
        operation="automation.workflow.execute",
        request=request,
    )
    source_id = str(payload.get("idempotency_key") or f"manual:{uuid.uuid4()}")
    event = {
        "id": source_id,
        "subject": "automation.manual.requested",
        "payload": context,
        "client_id": context.get("client_id"),
        "correlation_id": getattr(request.state, "correlation_id", None) or str(uuid.uuid4()),
        "actor": {"id": current_user.get("id"), "name": _actor(current_user), "role": current_user.get("role")},
        "occurred_at": _now(),
    }
    run = await queue_workflow_run(workflow, event, actor=current_user, source_id=source_id)
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": current_user.get("id"),
        "user_name": _actor(current_user),
        "action": "workflow_run_queued",
        "entity_type": "workflow_run",
        "entity_id": run["id"],
        "entity_name": workflow.get("name"),
        "metadata": {"workflow_id": workflow_id, "run_key": run.get("run_key")},
        "created_at": _now(),
    })
    return run


@router.post("/workflows", dependencies=[Depends(require_action("automation.workflow.modify"))])
async def create_workflow(data: dict, current_user: dict = Depends(get_current_user)):
    now = _now()
    workflow = {
        "id": f"wf-{uuid.uuid4().hex[:8]}",
        "name": str(data.get("name") or "Untitled workflow").strip(),
        "description": str(data.get("description") or "").strip(),
        "category": data.get("category") or "Custom",
        "enabled": bool(data.get("enabled", False)),
        "trigger": data.get("trigger") or {},
        "conditions": data.get("conditions") or [],
        "actions": _normalise_actions(data.get("actions") or []),
        "nodes": data.get("nodes") or [],
        "edges": data.get("edges") or [],
        "execution_count": 0,
        "simulation_count": 0,
        "last_executed": None,
        "last_simulated_at": None,
        "approval_status": "not_submitted",
        "created_by": _actor(current_user),
        "created_at": now,
        "updated_at": now,
    }
    await db.workflows.insert_one(workflow)
    workflow.pop("_id", None)
    return workflow


@router.get("/workflows/{workflow_id}")
async def get_workflow(workflow_id: str, current_user: dict = Depends(get_current_user)):
    workflow = await db.workflows.find_one({"id": workflow_id, "archived": {"$ne": True}}, {"_id": 0})
    if not workflow:
        raise HTTPException(404, "Workflow not found")
    return workflow


@router.put("/workflows/{workflow_id}", dependencies=[Depends(require_action("automation.workflow.modify"))])
async def update_workflow(workflow_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    workflow = await db.workflows.find_one({"id": workflow_id})
    if not workflow:
        raise HTTPException(404, "Workflow not found")
    update = {key: value for key, value in data.items() if key not in {"id", "_id", "created_at", "created_by", "execution_count"}}
    if "actions" in update:
        update["actions"] = _normalise_actions(update["actions"])
    update["updated_at"] = _now()
    update["approval_status"] = "not_submitted"
    await db.workflows.update_one({"id": workflow_id}, {"$set": update})
    return {"message": "Workflow updated"}


@router.delete("/workflows/{workflow_id}", dependencies=[Depends(require_action("automation.workflow.modify"))])
async def delete_workflow(workflow_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.workflows.delete_one({"id": workflow_id})
    if not result.deleted_count:
        raise HTTPException(404, "Workflow not found")
    return {"message": "Workflow deleted"}


@router.post("/workflows/{workflow_id}/toggle", dependencies=[Depends(require_action("automation.workflow.modify"))])
async def toggle_workflow(workflow_id: str, current_user: dict = Depends(get_current_user)):
    workflow = await db.workflows.find_one({"id": workflow_id}, {"_id": 0})
    if not workflow:
        raise HTTPException(404, "Workflow not found")
    if not workflow.get("enabled") and workflow.get("approval_status") not in {"approved", "not_required"}:
        raise HTTPException(409, "Simulate this workflow and complete approval before enabling it")
    enabled = not workflow.get("enabled", False)
    await db.workflows.update_one({"id": workflow_id}, {"$set": {"enabled": enabled, "updated_at": _now()}})
    return {"enabled": enabled}


@router.post("/workflows/{workflow_id}/simulate", dependencies=[Depends(require_action("automation.workflow.simulate"))])
async def simulate_workflow(workflow_id: str, payload: dict = Body(default={}), current_user: dict = Depends(get_current_user)):
    workflow = await db.workflows.find_one({"id": workflow_id}, {"_id": 0})
    if not workflow:
        raise HTTPException(404, "Workflow not found")
    simulation = _build_simulation(workflow, payload.get("context") or payload.get("test_data") or {}, current_user)
    await db.workflow_simulations.insert_one(simulation)
    await db.workflows.update_one(
        {"id": workflow_id},
        {"$inc": {"simulation_count": 1}, "$set": {
            "last_simulated_at": simulation["simulated_at"],
            "last_simulation_id": simulation["id"],
            "approval_status": "not_required" if not simulation["requires_approval"] and not simulation["missing_configuration"] else "simulation_complete",
        }},
    )
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": current_user.get("id"),
        "user_name": _actor(current_user),
        "action": "workflow_simulated",
        "entity_type": "workflow",
        "entity_id": workflow_id,
        "entity_name": workflow.get("name"),
        "metadata": {
            "simulation_id": simulation["id"],
            "risk_level": simulation["risk_level"],
            "configuration_gaps": simulation["summary"]["configuration_gaps"],
            "will_execute": False,
        },
        "created_at": simulation["simulated_at"],
    })
    simulation.pop("_id", None)
    return simulation


@router.post("/workflows/{workflow_id}/test", dependencies=[Depends(require_action("automation.workflow.simulate"))])
async def test_workflow(workflow_id: str, payload: dict = Body(default={}), current_user: dict = Depends(get_current_user)):
    return await simulate_workflow(workflow_id, payload, current_user)


@router.post("/workflows/{workflow_id}/submit-approval", dependencies=[Depends(require_action("automation.workflow.approve"))])
async def submit_workflow_approval(workflow_id: str, request: Request, payload: dict = Body(default={}), current_user: dict = Depends(get_current_user)):
    workflow = await db.workflows.find_one({"id": workflow_id}, {"_id": 0})
    if not workflow:
        raise HTTPException(404, "Workflow not found")
    simulation_id = payload.get("simulation_id") or workflow.get("last_simulation_id")
    simulation = await db.workflow_simulations.find_one({"id": simulation_id, "workflow_id": workflow_id}, {"_id": 0})
    if not simulation:
        raise HTTPException(409, "Run Simulation Mode before requesting approval")
    if simulation.get("missing_configuration"):
        raise HTTPException(409, "Resolve the configuration gaps before requesting approval")
    justification = str(payload.get("justification") or "").strip()
    if len(justification) < 8:
        raise HTTPException(400, "Record an approval justification of at least 8 characters")
    existing = await db.change_requests.find_one({
        "workflow_id": workflow_id,
        "status": {"$in": ["pending_review", "approved", "implementing"]},
    }, {"_id": 0})
    if existing:
        return existing

    client_id = str(payload.get("client_id") or simulation.get("context", {}).get("client_id") or "")
    await assert_client_scope(
        current_user,
        client_id or None,
        operation="automation.workflow.approve",
        request=request,
    )
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1}) if client_id else None
    now = _now()
    change = {
        "id": f"CHG-{uuid.uuid4().hex[:6].upper()}",
        "workflow_id": workflow_id,
        "simulation_id": simulation["id"],
        "title": f"Automation: {workflow.get('name') or 'Untitled workflow'}",
        "description": f"{workflow.get('description') or 'Automated workflow'}\n\nApproval rationale: {justification}",
        "category": "standard",
        "risk_level": simulation["risk_level"],
        "impact": simulation["impact"],
        "rollback_plan": simulation["rollback_plan"],
        "before_after": [{"step": step["step"], "action": step["label"], "before": step["before"], "after": step["after"]} for step in simulation["steps"]],
        "client_id": client_id,
        "client_name": (client or {}).get("name") or simulation.get("context", {}).get("client_name") or "",
        "devices_affected": simulation.get("context", {}).get("device_ids") or [],
        "scheduled_date": "",
        "maintenance_window": str(payload.get("maintenance_window") or "")[:160],
        "status": "pending_review",
        "requested_by": _actor(current_user),
        "requested_by_id": current_user.get("id"),
        "approvals": [],
        "activity": [{"action": "submitted", "note": f"Generated from Simulation Mode {simulation['id']}", "by": _actor(current_user), "by_id": current_user.get("id"), "at": now}],
        "created_at": now,
        "updated_at": now,
    }
    await db.change_requests.insert_one(change)
    await db.workflows.update_one({"id": workflow_id}, {"$set": {"approval_status": "pending_review", "change_request_id": change["id"], "updated_at": now}})
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": current_user.get("id"),
        "user_name": _actor(current_user),
        "action": "workflow_change_submitted",
        "entity_type": "workflow",
        "entity_id": workflow_id,
        "entity_name": workflow.get("name"),
        "metadata": {"simulation_id": simulation["id"], "change_request_id": change["id"], "risk_level": simulation["risk_level"]},
        "created_at": now,
    })
    change.pop("_id", None)
    return change


@router.get("/workflows/{workflow_id}/logs")
async def get_workflow_logs(workflow_id: str, current_user: dict = Depends(get_current_user)):
    return await db.workflow_logs.find({"workflow_id": workflow_id}, {"_id": 0}).sort("executed_at", -1).to_list(50)


async def dispatch_workflow_event(trigger_type: str, event: dict[str, Any]) -> list[dict]:
    """Compatibility entry point: legacy publishers now queue durable runs."""
    from app.services.automation_runtime import queue_runs_for_legacy_event

    return await queue_runs_for_legacy_event(trigger_type, event)


async def _seed_monitoring_workflow() -> list[dict]:
    """Provide one conservative workflow that remains disabled until simulated."""
    now = _now()
    workflow = {
        "id": "wf-monitoring-critical",
        "name": "Critical monitoring escalation",
        "description": "Tag the asset and leave an internal note when a critical monitoring alert creates a ticket.",
        "category": "Monitoring",
        "enabled": False,
        "trigger": {"type": "alert_triggered"},
        "conditions": [{"field": "severity", "operator": "equals", "value": "critical"}],
        "actions": _normalise_actions([
            {"type": "add_note", "config": {"note_text": "Critical monitoring alert automatically escalated by NexusMSP."}},
            {"type": "tag_device", "config": {"tags": "monitoring-critical"}},
        ]),
        "nodes": [],
        "edges": [],
        "execution_count": 0,
        "simulation_count": 0,
        "last_executed": None,
        "last_simulated_at": None,
        "approval_status": "not_submitted",
        "created_by": "NexusMSP",
        "created_at": now,
        "updated_at": now,
    }
    await db.workflows.update_one({"id": workflow["id"]}, {"$setOnInsert": workflow}, upsert=True)
    return [workflow]
    await _run_in_scope(run_id, current_user, "automation.run.reject", request)
    await _run_in_scope(run_id, current_user, "automation.run.retry", request)
    await _run_in_scope(run_id, current_user, "automation.run.compensate", request)
