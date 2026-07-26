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
from app.services.scope_permissions import assert_client_scope

router = APIRouter()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _actor(user: dict) -> str:
    return user.get("name") or user.get("email") or user.get("id") or "Unknown technician"


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


@router.get("/workflows/templates")
async def get_workflow_templates(current_user: dict = Depends(get_current_user)):
    installed = {
        item.get("source_pack_id")
        for item in await db.workflows.find({"source_pack_id": {"$exists": True}}, {"_id": 0, "source_pack_id": 1}).to_list(200)
    }
    return [{**pack, "installed": pack["id"] in installed, "steps": len(pack["actions"]), "publisher": "Nexus verified"} for pack in AUTOMATION_PACKS]


@router.post("/workflows/templates/{pack_id}/install", dependencies=[Depends(require_action("automation.workflow.modify"))])
async def install_workflow_template(pack_id: str, current_user: dict = Depends(get_current_user)):
    pack = next((item for item in AUTOMATION_PACKS if item["id"] == pack_id), None)
    if not pack:
        raise HTTPException(404, "Automation pack not found")
    existing = await db.workflows.find_one({"source_pack_id": pack_id}, {"_id": 0})
    if existing:
        return existing
    now = _now()
    workflow = {
        "id": f"wf-{uuid.uuid4().hex[:8]}",
        "source_pack_id": pack_id,
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
        "created_by": _actor(current_user),
        "created_at": now,
        "updated_at": now,
    }
    await db.workflows.insert_one(workflow)
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": current_user.get("id"),
        "user_name": _actor(current_user),
        "action": "automation_pack_installed",
        "entity_type": "workflow",
        "entity_id": workflow["id"],
        "entity_name": workflow["name"],
        "metadata": {"pack_id": pack_id, "enabled": False},
        "created_at": now,
    })
    workflow.pop("_id", None)
    return workflow


@router.get("/workflows/simulations/recent")
async def get_recent_simulations(current_user: dict = Depends(get_current_user)):
    return await db.workflow_simulations.find({}, {"_id": 0}).sort("simulated_at", -1).to_list(100)


@router.get("/workflows/stats/overview")
async def get_workflow_stats(current_user: dict = Depends(get_current_user)):
    await db.workflows.update_many(
        {"approval_status": {"$exists": False}},
        {"$set": {"enabled": False, "approval_status": "not_submitted", "updated_at": _now()}},
    )
    all_workflows = await db.workflows.find({}, {"_id": 0}).to_list(500)
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
    workflows = await db.workflows.find({}, {"_id": 0}).sort("updated_at", -1).to_list(200)
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
    return await db.workflow_runs.find(query, {"_id": 0}).sort("created_at", -1).to_list(max(1, min(limit, 250)))


@router.get("/workflows/runs/{run_id}")
async def get_automation_run(run_id: str, current_user: dict = Depends(get_current_user)):
    run = await db.workflow_runs.find_one({"id": run_id}, {"_id": 0})
    if not run:
        raise HTTPException(404, "Automation run not found")
    approvals = await db.workflow_run_approvals.find({"run_id": run_id}, {"_id": 0}).sort("requested_at", 1).to_list(50)
    return {**run, "approvals": approvals}


@router.post("/workflows/runs/{run_id}/approve", dependencies=[Depends(require_action("automation.workflow.approve"))])
async def approve_automation_run(
    run_id: str,
    payload: dict = Body(default={}),
    current_user: dict = Depends(get_current_user),
):
    from app.services.automation_runtime import decide_run_approval

    try:
        return await decide_run_approval(run_id, True, current_user, payload.get("reason"))
    except ValueError as error:
        raise HTTPException(409, str(error)) from error


@router.post("/workflows/runs/{run_id}/reject", dependencies=[Depends(require_action("automation.workflow.approve"))])
async def reject_automation_run(
    run_id: str,
    payload: dict = Body(default={}),
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
    current_user: dict = Depends(get_current_user),
):
    from app.services.automation_runtime import retry_run

    try:
        return await retry_run(run_id, current_user, payload.get("reason"))
    except ValueError as error:
        raise HTTPException(409, str(error)) from error


@router.post("/workflows/runs/{run_id}/compensation/preview")
async def preview_automation_compensation(run_id: str, current_user: dict = Depends(get_current_user)):
    from app.services.automation_runtime import compensation_preview

    run = await db.workflow_runs.find_one({"id": run_id}, {"_id": 0})
    if not run:
        raise HTTPException(404, "Automation run not found")
    return compensation_preview(run)


@router.post("/workflows/runs/{run_id}/compensate", dependencies=[Depends(require_action("automation.workflow.approve"))])
async def execute_automation_compensation(
    run_id: str,
    payload: dict = Body(default={}),
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
    workflow = await db.workflows.find_one({"id": workflow_id}, {"_id": 0})
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
