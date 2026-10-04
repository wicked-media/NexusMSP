from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
import re
from pymongo.errors import DuplicateKeyError
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit
from app.services.scope_permissions import assert_client_scope, assert_record_scope, scoped_query
from app.models import *

router = APIRouter()

PROJECT_STATUSES = {"planning", "in_progress", "on_hold", "completed", "cancelled"}
TASK_STATUSES = {"todo", "in_progress", "review", "completed"}
PRIORITIES = {"low", "medium", "high", "urgent"}
SCOPE_STATES = {"required", "optional", "not_applicable"}
REVIEW_RESULTS = {"verified", "changes_requested"}
CLOSEOUT_CHECKS = {"final_audit", "billing_confirmed", "documentation_complete", "exceptions_documented"}

# Curated, non-destructive starting points. They are kept in code so every MSP
# can begin with a safe baseline; custom project templates are stored separately
# in MongoDB and never overwrite these defaults.
PROJECT_TEMPLATE_STARTERS = [
    {
        "id": "starter-client-onboarding",
        "name": "Client onboarding",
        "description": "A governed client setup covering identity, endpoint, network, services, documentation, and handover.",
        "priority": "high",
        "scope": [
            {"component": "Identity and Microsoft 365", "state": "required", "notes": "Tenant, users, MFA, domains and baseline policies."},
            {"component": "Endpoint management and security", "state": "required", "notes": "Agent enrolment, EDR, patching and backup coverage."},
            {"component": "Network and remote access", "state": "required", "notes": "Discovery, documentation, access controls and monitoring."},
            {"component": "Telecom and voice", "state": "optional", "notes": "Confirm whether PBX, extensions or call routing are in scope."},
            {"component": "Commercial handover", "state": "required", "notes": "Confirm billable services, agreements and recurring quantities."},
        ],
        "tasks": [
            {"title": "Confirm client scope and commercial services", "description": "Validate required, optional and excluded services with the Project Manager.", "priority": "high", "estimated_hours": 1},
            {"title": "Establish identity and Microsoft 365 baseline", "description": "Set up agreed identities, access, MFA and core tenant protection.", "priority": "high", "estimated_hours": 3},
            {"title": "Enrol endpoints and security services", "description": "Confirm agents, EDR, patching and backups on every agreed endpoint.", "priority": "high", "estimated_hours": 4},
            {"title": "Document network, access and recovery path", "description": "Record operational documentation and validate secure technician access.", "priority": "medium", "estimated_hours": 2},
            {"title": "Complete client handover and close-out review", "description": "Verify delivery, billing, documentation and customer handover evidence.", "priority": "high", "estimated_hours": 2},
        ],
    },
    {
        "id": "starter-m365-migration",
        "name": "Microsoft 365 migration",
        "description": "A staged tenant migration with an explicit pilot, cutover, verification, and hypercare close-out.",
        "priority": "high",
        "scope": [
            {"component": "Tenant readiness and licensing", "state": "required", "notes": "Domains, licences, identity, migration prerequisites and approval."},
            {"component": "Mail, files and collaboration migration", "state": "required", "notes": "Define sources, data sets, pilot cohort and cutover sequence."},
            {"component": "Security baseline", "state": "required", "notes": "MFA, conditional access, admin controls and recovery evidence."},
        ],
        "tasks": [
            {"title": "Assess source environment and migration scope", "description": "Confirm users, mailboxes, domains, data sets, exclusions and licensing.", "priority": "high", "estimated_hours": 3},
            {"title": "Prepare tenant and security baseline", "description": "Configure identity, licences, MFA and approved security controls.", "priority": "high", "estimated_hours": 4},
            {"title": "Run pilot migration and independent validation", "description": "Migrate the agreed pilot cohort, verify data and obtain go/no-go direction.", "priority": "high", "estimated_hours": 5},
            {"title": "Execute cutover and hypercare", "description": "Perform approved cutover, validate service health and capture exceptions.", "priority": "high", "estimated_hours": 6},
        ],
    },
    {
        "id": "starter-new-site",
        "name": "New site deployment",
        "description": "Plan and deploy a new managed site across connectivity, network, endpoints, voice and support handover.",
        "priority": "high",
        "scope": [
            {"component": "Connectivity and network", "state": "required", "notes": "Internet, firewall, switching, Wi-Fi and monitoring."},
            {"component": "Endpoints and shared services", "state": "required", "notes": "Devices, printers, shared access and endpoint protection."},
            {"component": "Voice and site communications", "state": "optional", "notes": "PBX, extensions, ring groups and emergency calling."},
        ],
        "tasks": [
            {"title": "Confirm site design, scope and dependencies", "description": "Validate plans, ISP, access, equipment, customer decisions and target dates.", "priority": "high", "estimated_hours": 2},
            {"title": "Deploy connectivity and network baseline", "description": "Install and verify agreed network services, segmentation and monitoring.", "priority": "high", "estimated_hours": 6},
            {"title": "Configure endpoint and shared services", "description": "Prepare agreed devices, agents, printers and access controls.", "priority": "high", "estimated_hours": 4},
            {"title": "Validate handover, billing and documentation", "description": "Independently verify delivery and complete operational handover records.", "priority": "high", "estimated_hours": 2},
        ],
    },
]


async def _project_manager_details(user_id: Optional[str]):
    """Return the persisted project-manager reference without trusting the client payload."""
    if not user_id:
        return None, None
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "name": 1})
    if not user:
        raise HTTPException(status_code=404, detail="Project manager not found")
    return user["id"], user.get("name")


async def _task_assignee_details(user_id: Optional[str]):
    if not user_id:
        return None, None
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "name": 1})
    if not user:
        raise HTTPException(status_code=404, detail="Assigned technician not found")
    return user["id"], user.get("name")


async def _project_or_404(project_id: str, current_user: dict) -> dict:
    return await assert_record_scope(
        current_user,
        db.projects,
        project_id,
        operation="project.access",
        resource_name="Project",
    )


async def _ticket_details(ticket_id: Optional[str], project: dict, current_user: dict):
    if not ticket_id:
        return None, None, None
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "client_id": 1})
    if not ticket:
        raise HTTPException(status_code=404, detail="Related ticket not found")
    await assert_client_scope(
        current_user,
        ticket.get("client_id"),
        operation="project.ticket_link",
        mask_not_found=True,
    )
    if project.get("client_id") and ticket.get("client_id") != project.get("client_id"):
        raise HTTPException(status_code=400, detail="The related ticket must belong to the project client")
    return ticket["id"], ticket.get("ticket_number"), ticket.get("title")


async def _closeout_readiness(project: dict) -> dict:
    project_id = project["id"]
    tasks = await db.project_tasks.find({"project_id": project_id}, {"_id": 0}).to_list(1000)
    scope = await db.project_scope_items.find({"project_id": project_id}, {"_id": 0}).to_list(1000)
    decisions = await db.project_decisions.find({"project_id": project_id, "status": "open"}, {"_id": 0}).to_list(1000)
    checks = await db.project_closeout_checks.find({"project_id": project_id, "completed": True}, {"_id": 0, "check": 1}).to_list(100)
    completed_checks = {item.get("check") for item in checks}
    delivery_pending = [task for task in tasks if task.get("status") in {"todo", "in_progress"}]
    review_required = [task for task in tasks if task.get("status") == "review" or (task.get("status") == "completed" and task.get("review_result") != "verified")]
    blockers = [task for task in tasks if task.get("blocker_reason")]
    requirements = []
    if not project.get("project_manager"):
        requirements.append("Assign a Project Manager")
    if not scope:
        requirements.append("Define the project implementation scope")
    if delivery_pending:
        requirements.append(f"Complete {len(delivery_pending)} remaining delivery task(s)")
    if review_required:
        requirements.append(f"Independently verify {len(review_required)} completed task(s)")
    if blockers:
        requirements.append(f"Resolve {len(blockers)} task blocker(s)")
    if decisions:
        requirements.append(f"Resolve {len(decisions)} PM decision(s)")
    for check in sorted(CLOSEOUT_CHECKS - completed_checks):
        requirements.append(f"Complete {check.replace('_', ' ')}")
    return {
        "ready": not requirements,
        "requirements": requirements,
        "summary": {
            "total_tasks": len(tasks), "completed_tasks": len([task for task in tasks if task.get("status") == "completed" and task.get("review_result") == "verified"]),
            "pending_reviews": len(review_required), "blockers": len(blockers),
            "open_decisions": len(decisions), "scope_items": len(scope),
            "closeout_checks": sorted(completed_checks),
        },
    }

# ============== PROJECT MANAGEMENT ENDPOINTS ==============

@router.get("/projects")
async def get_projects(
    client_id: Optional[str] = None,
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if client_id:
        await assert_client_scope(current_user, client_id, operation="project.list")
        query["client_id"] = client_id
    if status:
        query["status"] = status
    
    projects = await db.projects.aggregate([
        {"$match": scoped_query(current_user, query)},
        {"$lookup": {"from": "project_tasks", "localField": "id", "foreignField": "project_id", "as": "_tasks"}},
        {"$addFields": {
            "task_count": {"$size": "$_tasks"},
            "completed_task_count": {"$size": {"$filter": {"input": "$_tasks", "as": "task", "cond": {"$eq": ["$$task.status", "completed"]}}}},
        }},
        {"$project": {"_id": 0, "_tasks": 0}},
        {"$sort": {"created_at": -1}},
    ]).to_list(1000)
    return projects

@router.get("/projects/{project_id}")
async def get_project(project_id: str, current_user: dict = Depends(get_current_user)):
    project = await _project_or_404(project_id, current_user)
    
    tasks = await db.project_tasks.find({"project_id": project_id}, {"_id": 0}).sort("order", 1).to_list(1000)
    project['tasks'] = tasks
    return project


@router.get("/project-templates")
async def list_project_templates(current_user: dict = Depends(get_current_user)):
    """Return the curated project starters plus MSP-authored templates.

    Templates are MSP-wide configuration, not client data. Applying one always
    creates client-scoped project, scope and task records with fresh Nexus IDs.
    """
    custom = await db.project_templates.find({"active": {"$ne": False}}, {"_id": 0}).sort("name", 1).to_list(500)
    return sorted([*PROJECT_TEMPLATE_STARTERS, *custom], key=lambda template: template["name"].lower())


async def _project_template_or_404(template_id: str) -> dict:
    starter = next((template for template in PROJECT_TEMPLATE_STARTERS if template["id"] == template_id), None)
    if starter:
        return starter
    template = await db.project_templates.find_one({"id": template_id, "active": {"$ne": False}}, {"_id": 0})
    if not template:
        raise HTTPException(status_code=404, detail="Project template not found or inactive")
    return template


@router.post("/projects/from-template")
async def create_project_from_template(payload: dict, current_user: dict = Depends(get_current_user)):
    """Create a governed project and its initial scope/tasks in one auditable action."""
    template_id = str(payload.get("template_id") or "").strip()
    project_data = payload.get("project") or {}
    if not template_id:
        raise HTTPException(status_code=400, detail="Project template is required")
    template = await _project_template_or_404(template_id)
    name = str(project_data.get("name") or "").strip()
    if len(name) < 3:
        raise HTTPException(status_code=400, detail="Project name must be at least 3 characters")
    client_id = str(project_data.get("client_id") or "").strip()
    await assert_client_scope(current_user, client_id, operation="project.create_from_template")
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    project_manager, pm_name = await _project_manager_details(project_data.get("project_manager"))
    if not project_manager:
        raise HTTPException(status_code=400, detail="Every project requires an assigned Project Manager")
    priority = project_data.get("priority") or template.get("priority") or "medium"
    if priority not in PRIORITIES:
        raise HTTPException(status_code=400, detail="Invalid project priority")
    now = datetime.now(timezone.utc).isoformat()
    project = Project(
        name=name,
        description=str(project_data.get("description") or template.get("description") or "").strip() or None,
        client_id=client["id"], client_name=client["name"], status="planning", priority=priority,
        start_date=project_data.get("start_date"), target_end_date=project_data.get("target_end_date"),
        budget_hours=project_data.get("budget_hours"), project_manager=project_manager,
        project_manager_name=pm_name,
    )
    project_doc = project.model_dump()
    project_doc["created_at"] = project_doc["created_at"].isoformat()
    project_doc["updated_at"] = project_doc["updated_at"].isoformat()
    project_doc["template_id"] = template["id"]
    project_doc["template_name"] = template["name"]
    await db.projects.insert_one(project_doc)
    project_doc.pop("_id", None)

    scope_docs = []
    for item in template.get("scope") or []:
        component = str(item.get("component") or "").strip()
        state = item.get("state", "required")
        if component and state in SCOPE_STATES:
            scope_docs.append({"id": str(uuid.uuid4()), "project_id": project.id, "client_id": client["id"], "component": component, "state": state, "notes": str(item.get("notes") or "").strip() or None, "created_at": now, "updated_at": now})
    if scope_docs:
        await db.project_scope_items.insert_many(scope_docs)

    task_docs = []
    for order, item in enumerate(template.get("tasks") or []):
        title = str(item.get("title") or "").strip()
        if len(title) >= 3:
            task = ProjectTask(project_id=project.id, project_name=project.name, title=title, description=str(item.get("description") or "").strip() or None, status="todo", priority=item.get("priority") if item.get("priority") in PRIORITIES else "medium", estimated_hours=item.get("estimated_hours"), order=order)
            doc = task.model_dump()
            doc["created_at"] = doc["created_at"].isoformat()
            task_docs.append(doc)
    if task_docs:
        await db.project_tasks.insert_many(task_docs)
    await log_activity(current_user, "project_created_from_template", "project", project.id, project.name, f"Created from project template: {template['name']}", metadata={"project_id": project.id, "client_id": client["id"], "template_id": template["id"], "scope_items": len(scope_docs), "tasks": len(task_docs)})
    return {"project": project_doc, "scope_items": len(scope_docs), "tasks": len(task_docs), "template_name": template["name"]}


@router.post("/projects/{project_id}/save-as-template")
async def save_project_as_template(project_id: str, payload: dict, current_user: dict = Depends(get_current_user)):
    """Capture a proven project plan without linking future projects to its history."""
    project = await _project_or_404(project_id, current_user)
    if project.get("project_manager") != current_user.get("id") and current_user.get("role") not in {"admin", "owner"}:
        raise HTTPException(status_code=403, detail="Only the Project Manager or an administrator can publish a project template")
    name = str(payload.get("name") or "").strip()
    if len(name) < 3:
        raise HTTPException(status_code=400, detail="Template name must be at least 3 characters")
    existing = await db.project_templates.find_one({"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}, "active": {"$ne": False}}, {"_id": 0, "id": 1})
    if existing:
        raise HTTPException(status_code=409, detail="An active project template already uses this name")
    scope = await db.project_scope_items.find({"project_id": project_id}, {"_id": 0, "component": 1, "state": 1, "notes": 1}).sort("component", 1).to_list(500)
    tasks = await db.project_tasks.find({"project_id": project_id}, {"_id": 0, "title": 1, "description": 1, "priority": 1, "estimated_hours": 1, "order": 1}).sort("order", 1).to_list(500)
    if not scope or not tasks:
        raise HTTPException(status_code=409, detail="Define project scope and at least one delivery task before creating a reusable template")
    now = datetime.now(timezone.utc).isoformat()
    template = {
        "id": str(uuid.uuid4()), "name": name,
        "description": str(payload.get("description") or project.get("description") or "").strip() or None,
        "priority": project.get("priority", "medium"),
        "scope": [{"component": item.get("component"), "state": item.get("state", "required"), "notes": item.get("notes")} for item in scope],
        "tasks": [{"title": item.get("title"), "description": item.get("description"), "priority": item.get("priority", "medium"), "estimated_hours": item.get("estimated_hours")} for item in tasks],
        "active": True, "source_project_id": project_id, "created_by": current_user.get("id"), "created_by_name": current_user.get("name"), "created_at": now, "updated_at": now,
    }
    await db.project_templates.insert_one(template)
    await log_activity(current_user, "project_template_published", "project", project_id, project["name"], f"Published reusable project template: {name}", metadata={"project_id": project_id, "client_id": project.get("client_id"), "template_id": template["id"]})
    return {key: value for key, value in template.items() if key != "_id"}


def _project_plan_ticket_document(*, ticket_id: str, ticket_number: str, project: dict,
                                  blueprint: dict, title: str, description: str, now: str,
                                  plan_id: str, parent_id: Optional[str] = None,
                                  child_template: Optional[dict] = None, device: Optional[dict] = None) -> dict:
    """Create a normal ticket document with immutable project-plan provenance."""
    priority = (child_template or {}).get("priority") or blueprint.get("default_priority") or "medium"
    category = (child_template or {}).get("category") or blueprint.get("default_category") or "project"
    ticket = Ticket(
        id=ticket_id, ticket_number=ticket_number, title=title, subject=title,
        description=description, client_id=project.get("client_id"), client_name=project.get("client_name"),
        priority=priority, status="open", ticket_type="service_request", category=category,
        parent_id=parent_id, device_id=(device or {}).get("id"),
        device_name=(device or {}).get("name") or (device or {}).get("hostname"),
        device_ids=[device["id"]] if device and device.get("id") else [],
        device_names=[(device.get("name") or device.get("hostname"))] if device and (device.get("name") or device.get("hostname")) else [],
        tags=["project", "blueprint-plan"], source="project_ticket_plan",
    )
    doc = ticket.model_dump()
    doc["created_at"] = doc["created_at"].isoformat()
    doc["updated_at"] = doc["updated_at"].isoformat()
    doc.update({
        "project_id": project["id"], "project_name": project.get("name"), "project_ticket_plan_id": plan_id,
        "project_ticket_plan_blueprint_id": blueprint["id"], "project_ticket_plan_role": "child" if parent_id else "parent",
    })
    return doc


async def ensure_project_ticket_plan_indexes():
    """Prevent duplicate parent/child ticket trees for one project blueprint."""
    await db.project_ticket_plans.create_index(
        [("project_id", 1), ("blueprint_id", 1)],
        unique=True,
        name="project_ticket_plan_project_blueprint_unique",
    )


async def _project_ticket_plan_is_ready(plan: dict, project: dict) -> bool:
    """Confirm that an idempotent replay points to a complete, scoped ticket tree.

    The unique plan key stops duplicate launches, but it must not turn a partial
    write into a false successful replay.  Check the stored parent and every
    declared child against the project/client/plan provenance before returning
    an existing plan to a technician.
    """
    if plan.get("status") != "ready":
        return False

    plan_id = str(plan.get("id") or "").strip()
    parent_id = str(plan.get("parent_ticket_id") or "").strip()
    child_ids = [str(child_id).strip() for child_id in (plan.get("child_ticket_ids") or []) if str(child_id).strip()]
    if (
        not plan_id
        or not parent_id
        or plan.get("project_id") != project.get("id")
        or plan.get("client_id") != project.get("client_id")
        or len(child_ids) != len(set(child_ids))
    ):
        return False
    try:
        if int(plan.get("child_ticket_count", -1)) != len(child_ids):
            return False
    except (TypeError, ValueError):
        return False

    expected_scope = {
        "client_id": project.get("client_id"),
        "project_id": project.get("id"),
        "project_ticket_plan_id": plan_id,
    }
    parent = await db.tickets.find_one(
        {
            "id": parent_id,
            "project_ticket_plan_role": "parent",
            **expected_scope,
        },
        {"_id": 0, "id": 1, "child_ticket_ids": 1},
    )
    if not parent:
        return False
    parent_child_ids = [str(child_id).strip() for child_id in (parent.get("child_ticket_ids") or []) if str(child_id).strip()]
    try:
        parent_count_matches = int(parent.get("child_ticket_count", -1)) == len(child_ids)
    except (TypeError, ValueError):
        parent_count_matches = False
    if (
        not parent_count_matches
        or len(parent_child_ids) != len(set(parent_child_ids))
        or set(parent_child_ids) != set(child_ids)
    ):
        return False
    if not child_ids:
        return True

    children = await db.tickets.find(
        {
            "id": {"$in": child_ids},
            "parent_id": parent_id,
            "project_ticket_plan_role": "child",
            **expected_scope,
        },
        {"_id": 0, "id": 1},
    ).to_list(len(child_ids))
    return {child.get("id") for child in children} == set(child_ids)


async def _mark_project_ticket_plan_failed(plan_id: str) -> None:
    """Leave an interrupted plan visibly safe instead of reporting a false success."""
    try:
        await db.project_ticket_plans.update_one(
            {"id": plan_id, "status": "provisioning"},
            {
                "$set": {
                    "status": "failed",
                    "failed_at": datetime.now(timezone.utc).isoformat(),
                    "failure_code": "ticket_tree_provisioning_failed",
                }
            },
        )
    except Exception:
        # Preserve the original creation failure; a subsequent replay will still
        # be blocked by the unique plan key rather than producing duplicates.
        pass


@router.get("/projects/{project_id}/ticket-plans")
async def get_project_ticket_plans(project_id: str, current_user: dict = Depends(get_current_user)):
    project = await _project_or_404(project_id, current_user)
    plans = await db.project_ticket_plans.find({"project_id": project_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
    child_ids = [child_id for plan in plans for child_id in (plan.get("child_ticket_ids") or [])]
    plan_ids = [plan["id"] for plan in plans if plan.get("id")]
    tickets = await db.tickets.find(
        {
            "id": {"$in": child_ids},
            "client_id": project.get("client_id"),
            "project_id": project_id,
            "project_ticket_plan_id": {"$in": plan_ids},
        },
        {"_id": 0, "id": 1, "status": 1, "updated_at": 1},
    ).to_list(1000) if child_ids and plan_ids else []
    by_id = {ticket["id"]: ticket for ticket in tickets}
    task_ids = [task_id for plan in plans for task_id in (plan.get("project_task_ids") or [])]
    tasks = await db.project_tasks.find(
        {"project_id": project_id, "id": {"$in": task_ids}},
        {"_id": 0, "id": 1, "status": 1, "review_result": 1},
    ).to_list(1000) if task_ids else []
    tasks_by_id = {task["id"]: task for task in tasks}
    completed_statuses = {"resolved", "closed", "completed"}
    for plan in plans:
        child_tickets = [by_id[child_id] for child_id in (plan.get("child_ticket_ids") or []) if child_id in by_id]
        plan_tasks = [tasks_by_id[task_id] for task_id in (plan.get("project_task_ids") or []) if task_id in tasks_by_id]
        status_counts = {}
        for ticket in child_tickets:
            status = ticket.get("status") or "open"
            status_counts[status] = status_counts.get(status, 0) + 1
        plan["delivery_summary"] = {
            "total": len(plan.get("child_ticket_ids") or []),
            "completed": sum(1 for ticket in child_tickets if ticket.get("status") in completed_statuses),
            "active": sum(1 for ticket in child_tickets if ticket.get("status") not in completed_statuses),
            "status_counts": status_counts,
            "last_ticket_update": max((ticket.get("updated_at") for ticket in child_tickets if ticket.get("updated_at")), default=None),
            "ready_for_review": sum(1 for task in plan_tasks if task.get("status") == "review"),
            "independently_verified": sum(1 for task in plan_tasks if task.get("status") == "completed" and task.get("review_result") == "verified"),
        }
    return plans


@router.post("/projects/{project_id}/ticket-plans")
async def create_project_ticket_plan(project_id: str, payload: dict, current_user: dict = Depends(get_current_user)):
    """Launch a selected ticket blueprint as a project parent ticket and child work tickets."""
    project = await _project_or_404(project_id, current_user)
    if project.get("project_manager") != current_user.get("id") and current_user.get("role") not in {"admin", "owner"}:
        raise HTTPException(status_code=403, detail="Only the Project Manager or an administrator can launch a project ticket plan")
    blueprint_id = str(payload.get("blueprint_id") or "").strip()
    if not blueprint_id:
        raise HTTPException(status_code=400, detail="Select a ticket blueprint")
    blueprint = await db.blueprints.find_one({"id": blueprint_id, "active": True}, {"_id": 0})
    if not blueprint:
        raise HTTPException(status_code=404, detail="Ticket blueprint not found or archived")
    await ensure_project_ticket_plan_indexes()
    existing = await db.project_ticket_plans.find_one({"project_id": project_id, "blueprint_id": blueprint_id}, {"_id": 0})
    if existing:
        if await _project_ticket_plan_is_ready(existing, project):
            return {"success": True, "idempotent": True, "plan": existing}
        raise HTTPException(
            status_code=409,
            detail="The existing project ticket plan is incomplete and needs attention. Nexus will not create another ticket tree automatically.",
        )

    from app.routers.blueprints import _hydrate_ticket_with_blueprint
    from app.routers.ticket_suggestions import generate_ticket_number

    child_templates = blueprint.get("child_templates") or []
    child_blueprints = {}
    for child_template in child_templates:
        child_blueprint_id = child_template.get("blueprint_id")
        if child_blueprint_id:
            child_blueprint = await db.blueprints.find_one({"id": child_blueprint_id, "active": True}, {"_id": 0})
            if not child_blueprint:
                raise HTTPException(status_code=409, detail=f"Child blueprint for '{child_template.get('title', 'planned work')}' is unavailable")
            child_blueprints[child_blueprint_id] = child_blueprint

    now = datetime.now(timezone.utc).isoformat()
    plan_id = f"PRP-{uuid.uuid4().hex[:8].upper()}"
    parent_id = f"TKT-{uuid.uuid4().hex[:10].upper()}"
    parent_number = await generate_ticket_number("service_request")
    parent_title = str(payload.get("title") or f"{project.get('name')} — {blueprint['name']}").strip()
    plan = {
        "id": plan_id, "project_id": project_id, "client_id": project.get("client_id"),
        "blueprint_id": blueprint_id, "blueprint_name": blueprint.get("name"),
        "parent_ticket_id": parent_id, "parent_ticket_number": parent_number, "parent_title": parent_title,
        "child_ticket_ids": [], "child_ticket_count": 0, "project_task_ids": [],
        "status": "provisioning", "created_at": now,
        "created_by": current_user.get("id"), "created_by_name": current_user.get("name"),
    }
    try:
        await db.project_ticket_plans.insert_one(plan)
        plan.pop("_id", None)
    except DuplicateKeyError:
        existing = await db.project_ticket_plans.find_one(
            {"project_id": project_id, "blueprint_id": blueprint_id}, {"_id": 0}
        )
        if existing and await _project_ticket_plan_is_ready(existing, project):
            return {"success": True, "idempotent": True, "plan": existing}
        raise HTTPException(
            status_code=409,
            detail="Another technician is launching this project blueprint, or the existing plan needs attention. Nexus will not create duplicate ticket trees.",
        )
    try:
        parent = _project_plan_ticket_document(ticket_id=parent_id, ticket_number=parent_number, project=project, blueprint=blueprint, title=parent_title, description=str(payload.get("description") or blueprint.get("description") or project.get("description") or "").strip(), now=now, plan_id=plan_id)
        parent.update({"child_ticket_ids": [], "child_ticket_count": 0})
        _hydrate_ticket_with_blueprint(parent, blueprint)
        parent.update({"blueprint_applied_at": now, "blueprint_applied_by": current_user.get("name")})
        await db.tickets.insert_one(parent)
        await ticket_audit(parent_id, current_user, "created_from_project_ticket_plan", f"Created project parent plan {plan_id} from {blueprint['name']}")

        devices = await db.devices.find({"client_id": project.get("client_id")}, {"_id": 0, "id": 1, "name": 1, "hostname": 1}).to_list(500)
        children, linked_task_ids = [], []
        for child_template in child_templates:
            targets = devices if child_template.get("per_device") and devices else [None]
            for device in targets:
                child_id = f"TKT-{uuid.uuid4().hex[:10].upper()}"
                child_number = await generate_ticket_number("service_request")
                suffix = f" — {(device.get('name') or device.get('hostname') or device.get('id'))}" if device else ""
                child_title = f"{child_template.get('title', 'Project work')}{suffix}"
                child = _project_plan_ticket_document(ticket_id=child_id, ticket_number=child_number, project=project, blueprint=blueprint, title=child_title, description=str(child_template.get("description") or blueprint.get("description") or "").strip(), now=now, plan_id=plan_id, parent_id=parent_id, child_template=child_template, device=device)
                child.update({"project_ticket_plan_child_template_id": child_template.get("id"), "project_ticket_plan_required": bool(child_template.get("required", True))})
                child_blueprint = child_blueprints.get(child_template.get("blueprint_id"))
                if child_blueprint:
                    _hydrate_ticket_with_blueprint(child, child_blueprint)
                    child.update({"blueprint_applied_at": now, "blueprint_applied_by": current_user.get("name")})
                await db.tickets.insert_one(child)
                await ticket_audit(child_id, current_user, "created_from_project_ticket_plan", f"Linked to parent {parent_number} in plan {plan_id}")
                await ticket_audit(parent_id, current_user, "child_created", f"Created child {child_number}: {child_title}")

                task = await db.project_tasks.find_one({"project_id": project_id, "title": child_template.get("title"), "ticket_id": {"$in": [None, ""]}}, {"_id": 0}) if not device else None
                if task:
                    await db.project_tasks.update_one({"id": task["id"], "project_id": project_id}, {"$set": {"ticket_id": child_id, "ticket_number": child_number, "ticket_title": child_title}})
                    linked_task_ids.append(task["id"])
                else:
                    task = ProjectTask(project_id=project_id, project_name=project["name"], title=child_title, description=child.get("description"), priority=child.get("priority", "medium"), ticket_id=child_id, ticket_number=child_number, ticket_title=child_title, order=len(linked_task_ids))
                    task_doc = task.model_dump()
                    task_doc["created_at"] = task_doc["created_at"].isoformat()
                    await db.project_tasks.insert_one(task_doc)
                    linked_task_ids.append(task.id)
                await db.tickets.update_one(
                    {"id": child_id, "project_id": project_id},
                    {"$set": {"project_task_id": task["id"] if isinstance(task, dict) else task.id}},
                )
                children.append(child)

        child_ids = [child["id"] for child in children]
        await db.tickets.update_one({"id": parent_id}, {"$set": {"child_ticket_ids": child_ids, "child_ticket_count": len(child_ids), "updated_at": now}})
        await db.clients.update_one({"id": project.get("client_id")}, {"$inc": {"ticket_count": 1 + len(children)}})
        plan.update({
            "child_ticket_ids": child_ids,
            "child_ticket_count": len(children),
            "project_task_ids": linked_task_ids,
            "status": "ready",
            "ready_at": datetime.now(timezone.utc).isoformat(),
        })
        await db.project_ticket_plans.update_one({"id": plan_id}, {"$set": plan})
    except Exception:
        await _mark_project_ticket_plan_failed(plan_id)
        raise
    await log_activity(current_user, "project_ticket_plan_created", "project", project_id, project["name"], f"Launched {parent_number} with {len(children)} linked child ticket(s) from {blueprint['name']}", metadata={"project_id": project_id, "client_id": project.get("client_id"), "plan_id": plan_id, "parent_ticket_id": parent_id, "child_ticket_ids": child_ids, "blueprint_id": blueprint_id})
    return {"success": True, "idempotent": False, "plan": plan}

@router.post("/projects")
async def create_project(project_data: dict, current_user: dict = Depends(get_current_user)):
    name = str(project_data.get("name") or "").strip()
    if len(name) < 3:
        raise HTTPException(status_code=400, detail="Project name must be at least 3 characters")
    status = project_data.get("status", "planning")
    priority = project_data.get("priority", "medium")
    if status not in PROJECT_STATUSES or priority not in PRIORITIES:
        raise HTTPException(status_code=400, detail="Invalid project status or priority")
    client_id = str(project_data.get("client_id") or "").strip()
    await assert_client_scope(current_user, client_id, operation="project.create")
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    project_manager, pm_name = await _project_manager_details(project_data.get("project_manager"))
    if not project_manager:
        raise HTTPException(status_code=400, detail="Every project requires an assigned Project Manager")
    
    project = Project(
        name=name,
        description=project_data.get('description'),
        client_id=client['id'],
        client_name=client['name'],
        status=status,
        priority=priority,
        start_date=project_data.get('start_date'),
        target_end_date=project_data.get('target_end_date'),
        budget_hours=project_data.get('budget_hours'),
        project_manager=project_manager,
        project_manager_name=pm_name,
        team_members=project_data.get('team_members', []),
        tags=project_data.get('tags', [])
    )
    doc = project.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['updated_at'] = doc['updated_at'].isoformat()
    await db.projects.insert_one(doc)
    await log_activity(current_user, "project_created", "project", project.id, project.name, f"Created project for {client['name']}", metadata={"client_id": client["id"]})
    return project

@router.put("/projects/{project_id}")
async def update_project(project_id: str, project_data: dict, current_user: dict = Depends(get_current_user)):
    existing = await _project_or_404(project_id, current_user)
    allowed = {"name", "description", "client_id", "status", "priority", "start_date", "target_end_date", "budget_hours", "project_manager", "team_members", "tags"}
    updates = {key: value for key, value in project_data.items() if key in allowed}
    if "name" in updates:
        updates["name"] = str(updates["name"] or "").strip()
        if len(updates["name"]) < 3:
            raise HTTPException(status_code=400, detail="Project name must be at least 3 characters")
    if updates.get("status") and updates["status"] not in PROJECT_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid project status")
    if updates.get("priority") and updates["priority"] not in PRIORITIES:
        raise HTTPException(status_code=400, detail="Invalid project priority")
    if "client_id" in updates:
        await assert_client_scope(current_user, updates["client_id"], operation="project.reassign")
        client = await db.clients.find_one({"id": updates["client_id"]}, {"_id": 0, "id": 1, "name": 1})
        if not client:
            raise HTTPException(status_code=404, detail="Client not found")
        linked_task = await db.project_tasks.find_one({"project_id": project_id, "ticket_id": {"$exists": True, "$ne": None}}, {"_id": 0, "ticket_id": 1})
        if linked_task and updates["client_id"] != existing.get("client_id"):
            raise HTTPException(status_code=400, detail="Unlink project task tickets before moving this project to another client")
        updates["client_name"] = client["name"]
    if "project_manager" in updates:
        updates["project_manager"], updates["project_manager_name"] = await _project_manager_details(updates["project_manager"])
    candidate = {**existing, **updates}
    if updates.get("status") == "completed":
        readiness = await _closeout_readiness(candidate)
        if not readiness["ready"]:
            raise HTTPException(status_code=409, detail="Project is not ready for close-out", headers={"X-Nexus-Closeout-Requirements": " | ".join(readiness["requirements"])})
    if updates.get("status") == "completed" and not existing.get("actual_end_date"):
        updates["actual_end_date"] = datetime.now(timezone.utc).date().isoformat()
    if updates.get("status") and updates["status"] != "completed":
        updates["actual_end_date"] = None
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.projects.update_one({"id": project_id}, {"$set": updates})
    changed = ", ".join(sorted(key.replace("_", " ") for key in updates if key not in {"updated_at", "actual_end_date"})) or "project details"
    await log_activity(current_user, "project_updated", "project", project_id, updates.get("name", existing["name"]), f"Updated {changed}", changes={key: {"from": existing.get(key), "to": value} for key, value in updates.items() if existing.get(key) != value and key != "updated_at"}, metadata={"client_id": existing.get("client_id")})
    return {"message": "Project updated"}

@router.delete("/projects/{project_id}")
async def delete_project(project_id: str, current_user: dict = Depends(get_current_user)):
    project = await _project_or_404(project_id, current_user)
    await db.projects.delete_one({"id": project_id})
    
    # Also delete tasks
    await db.project_tasks.delete_many({"project_id": project_id})
    await log_activity(current_user, "project_deleted", "project", project_id, project.get("name", "Project"), "Deleted project and its tasks", metadata={"client_id": project.get("client_id")})
    return {"message": "Project deleted"}


# ============== PROJECT GOVERNANCE ==============

@router.get("/projects/{project_id}/governance")
async def get_project_governance(project_id: str, current_user: dict = Depends(get_current_user)):
    project = await _project_or_404(project_id, current_user)
    scope = await db.project_scope_items.find({"project_id": project_id}, {"_id": 0}).sort("component", 1).to_list(500)
    decisions = await db.project_decisions.find({"project_id": project_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    checks = await db.project_closeout_checks.find({"project_id": project_id}, {"_id": 0}).to_list(100)
    return {"scope": scope, "decisions": decisions, "closeout_checks": checks, "readiness": await _closeout_readiness(project)}

@router.put("/projects/{project_id}/scope")
async def replace_project_scope(project_id: str, payload: dict, current_user: dict = Depends(get_current_user)):
    project = await _project_or_404(project_id, current_user)
    if project.get("project_manager") != current_user.get("id") and current_user.get("role") not in {"admin", "owner"}:
        raise HTTPException(status_code=403, detail="Only the Project Manager or an administrator can change authoritative scope")
    items = payload.get("items") or []
    if not isinstance(items, list):
        raise HTTPException(status_code=400, detail="Scope items must be a list")
    now = datetime.now(timezone.utc).isoformat()
    prepared = []
    for item in items:
        component = str(item.get("component") or "").strip()
        state = item.get("state", "required")
        if not component or state not in SCOPE_STATES:
            raise HTTPException(status_code=400, detail="Each scope item needs a component and valid state")
        prepared.append({"id": str(uuid.uuid4()), "project_id": project_id, "client_id": project.get("client_id"), "component": component, "state": state, "notes": str(item.get("notes") or "").strip() or None, "created_at": now, "updated_at": now})
    await db.project_scope_items.delete_many({"project_id": project_id})
    if prepared:
        await db.project_scope_items.insert_many(prepared)
    await log_activity(current_user, "project_scope_updated", "project", project_id, project["name"], f"Updated {len(prepared)} authoritative scope item(s)", metadata={"project_id": project_id, "client_id": project.get("client_id")})
    return {"items": prepared}

@router.post("/projects/{project_id}/decisions")
async def raise_project_decision(project_id: str, payload: dict, current_user: dict = Depends(get_current_user)):
    project = await _project_or_404(project_id, current_user)
    title = str(payload.get("title") or "").strip()
    if len(title) < 3:
        raise HTTPException(status_code=400, detail="Decision title must be at least 3 characters")
    decision = ProjectDecision(project_id=project_id, client_id=project.get("client_id"), title=title, detail=str(payload.get("detail") or "").strip() or None, raised_by=current_user.get("id"), raised_by_name=current_user.get("name"))
    doc = decision.model_dump()
    doc["created_at"] = doc["created_at"].isoformat()
    await db.project_decisions.insert_one(doc)
    await log_activity(current_user, "project_decision_raised", "project", project_id, project["name"], f"PM decision required: {title}", metadata={"project_id": project_id, "client_id": project.get("client_id"), "decision_id": decision.id})
    return {k: v for k, v in doc.items() if k != "_id"}

@router.post("/projects/{project_id}/decisions/{decision_id}/resolve")
async def resolve_project_decision(project_id: str, decision_id: str, payload: dict, current_user: dict = Depends(get_current_user)):
    project = await _project_or_404(project_id, current_user)
    if project.get("project_manager") != current_user.get("id") and current_user.get("role") not in {"admin", "owner"}:
        raise HTTPException(status_code=403, detail="Only the Project Manager or an administrator can resolve this decision")
    resolution = str(payload.get("resolution") or "").strip()
    if len(resolution) < 3:
        raise HTTPException(status_code=400, detail="Record the decision resolution")
    result = await db.project_decisions.update_one({"id": decision_id, "project_id": project_id, "status": "open"}, {"$set": {"status": "resolved", "resolution": resolution, "resolved_by": current_user.get("id"), "resolved_by_name": current_user.get("name"), "resolved_at": datetime.now(timezone.utc).isoformat()}})
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Open project decision not found")
    await log_activity(current_user, "project_decision_resolved", "project", project_id, project["name"], "Resolved a PM decision", metadata={"project_id": project_id, "client_id": project.get("client_id"), "decision_id": decision_id})
    return {"message": "Decision resolved"}

@router.put("/projects/{project_id}/closeout-checks/{check}")
async def set_project_closeout_check(project_id: str, check: str, payload: dict, current_user: dict = Depends(get_current_user)):
    project = await _project_or_404(project_id, current_user)
    if check not in CLOSEOUT_CHECKS:
        raise HTTPException(status_code=400, detail="Unknown close-out check")
    if project.get("project_manager") != current_user.get("id") and current_user.get("role") not in {"admin", "owner"}:
        raise HTTPException(status_code=403, detail="Only the Project Manager or an administrator can complete close-out checks")
    completed = bool(payload.get("completed"))
    record = {"project_id": project_id, "client_id": project.get("client_id"), "check": check, "completed": completed, "notes": str(payload.get("notes") or "").strip() or None, "updated_by": current_user.get("id"), "updated_by_name": current_user.get("name"), "updated_at": datetime.now(timezone.utc).isoformat()}
    await db.project_closeout_checks.update_one({"project_id": project_id, "check": check}, {"$set": record, "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": record["updated_at"]}}, upsert=True)
    await log_activity(current_user, "project_closeout_check_updated", "project", project_id, project["name"], f"Marked {check.replace('_', ' ')} as {'complete' if completed else 'incomplete'}", metadata={"project_id": project_id, "client_id": project.get("client_id"), "check": check})
    return {"message": "Close-out check updated"}

# ============== PROJECT TASKS ENDPOINTS ==============

@router.get("/projects/{project_id}/tasks")
async def get_project_tasks(project_id: str, current_user: dict = Depends(get_current_user)):
    await _project_or_404(project_id, current_user)
    tasks = await db.project_tasks.find({"project_id": project_id}, {"_id": 0}).sort("order", 1).to_list(1000)
    return tasks

@router.post("/projects/{project_id}/tasks")
async def create_project_task(project_id: str, task_data: dict, current_user: dict = Depends(get_current_user)):
    project = await _project_or_404(project_id, current_user)
    
    title = str(task_data.get("title") or "").strip()
    if len(title) < 3:
        raise HTTPException(status_code=400, detail="Task title must be at least 3 characters")
    status = task_data.get("status", "todo")
    priority = task_data.get("priority", "medium")
    if status not in TASK_STATUSES or priority not in PRIORITIES:
        raise HTTPException(status_code=400, detail="Invalid task status or priority")
    assigned_to, assigned_name = await _task_assignee_details(task_data.get("assigned_to"))
    ticket_id, ticket_number, ticket_title = await _ticket_details(task_data.get("ticket_id"), project, current_user)
    
    requested_status = task_data.get("status", "todo")
    task = ProjectTask(
        project_id=project_id,
        project_name=project['name'],
        title=title,
        description=task_data.get('description'),
        status="review" if requested_status == "completed" else status,
        priority=priority,
        assigned_to=assigned_to,
        assigned_name=assigned_name,
        estimated_hours=task_data.get('estimated_hours'),
        ticket_id=ticket_id,
        ticket_number=ticket_number,
        ticket_title=ticket_title,
        due_date=task_data.get('due_date'),
        blocker_reason=str(task_data.get("blocker_reason") or "").strip() or None,
        dependencies=task_data.get('dependencies', []),
        order=task_data.get('order', 0)
    )
    doc = task.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    if requested_status in {"review", "completed"}:
        doc.update({"implemented_by": current_user.get("id"), "implemented_by_name": current_user.get("name"), "implemented_at": doc["created_at"], "completed_at": doc["created_at"]})
    await db.project_tasks.insert_one(doc)
    await log_activity(current_user, "project_task_created", "project_task", task.id, task.title, f"Created task in {project['name']}", metadata={"project_id": project_id, "client_id": project.get("client_id"), "ticket_id": ticket_id})
    if ticket_id:
        await ticket_audit(ticket_id, current_user, "project_task_linked", f"Linked project task: {task.title}")
    return {key: value for key, value in doc.items() if key != "_id"}

@router.put("/projects/{project_id}/tasks/{task_id}")
async def update_project_task(project_id: str, task_id: str, task_data: dict, current_user: dict = Depends(get_current_user)):
    project = await _project_or_404(project_id, current_user)
    task = await db.project_tasks.find_one({"id": task_id, "project_id": project_id}, {"_id": 0})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    allowed = {"title", "description", "status", "priority", "assigned_to", "estimated_hours", "actual_hours", "due_date", "ticket_id", "order", "blocker_reason"}
    updates = {key: value for key, value in task_data.items() if key in allowed}
    if "title" in updates:
        updates["title"] = str(updates["title"] or "").strip()
        if len(updates["title"]) < 3:
            raise HTTPException(status_code=400, detail="Task title must be at least 3 characters")
    if updates.get("status") and updates["status"] not in TASK_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid task status")
    if updates.get("priority") and updates["priority"] not in PRIORITIES:
        raise HTTPException(status_code=400, detail="Invalid task priority")
    if "assigned_to" in updates:
        updates["assigned_to"], updates["assigned_name"] = await _task_assignee_details(updates["assigned_to"])
    if "ticket_id" in updates:
        updates["ticket_id"], updates["ticket_number"], updates["ticket_title"] = await _ticket_details(updates["ticket_id"], project, current_user)
    if updates.get("status") in {"review", "completed"}:
        updates["completed_at"] = datetime.now(timezone.utc).isoformat()
        updates["implemented_by"] = current_user.get("id")
        updates["implemented_by_name"] = current_user.get("name")
        updates["implemented_at"] = updates["completed_at"]
        updates["reviewed_by"] = None
        updates["reviewed_by_name"] = None
        updates["reviewed_at"] = None
        updates["review_result"] = None
        updates["review_notes"] = None
        updates["status"] = "review"
    elif updates.get("status"):
        updates["completed_at"] = None
    await db.project_tasks.update_one({"id": task_id, "project_id": project_id}, {"$set": updates})
    changed = ", ".join(sorted(key.replace("_", " ") for key in updates if key not in {"completed_at"})) or "task details"
    await log_activity(current_user, "project_task_updated", "project_task", task_id, updates.get("title", task["title"]), f"Updated {changed}", changes={key: {"from": task.get(key), "to": value} for key, value in updates.items() if task.get(key) != value}, metadata={"project_id": project_id, "client_id": project.get("client_id"), "ticket_id": updates.get("ticket_id", task.get("ticket_id"))})
    if "ticket_id" in updates and updates.get("ticket_id"):
        await ticket_audit(updates["ticket_id"], current_user, "project_task_linked", f"Linked project task: {updates.get('title', task['title'])}")
    return {"message": "Task updated"}

@router.post("/projects/{project_id}/tasks/{task_id}/review")
async def review_project_task(project_id: str, task_id: str, payload: dict, current_user: dict = Depends(get_current_user)):
    project = await _project_or_404(project_id, current_user)
    task = await db.project_tasks.find_one({"id": task_id, "project_id": project_id}, {"_id": 0})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.get("status") not in {"review", "completed"}:
        raise HTTPException(status_code=409, detail="Complete the task before requesting independent review")
    if task.get("implemented_by") == current_user.get("id"):
        raise HTTPException(status_code=403, detail="The implementing technician cannot review their own work")
    result = payload.get("result")
    if result not in REVIEW_RESULTS:
        raise HTTPException(status_code=400, detail="Review result must be verified or changes_requested")
    notes = str(payload.get("notes") or "").strip()
    if len(notes) < 3:
        raise HTTPException(
            status_code=400,
            detail=(
                "Record verification evidence before approving work"
                if result == "verified"
                else "Explain what must change before returning work"
            ),
        )
    updates = {"reviewed_by": current_user.get("id"), "reviewed_by_name": current_user.get("name"), "reviewed_at": datetime.now(timezone.utc).isoformat(), "review_result": result, "review_notes": notes or None}
    if result == "changes_requested":
        updates.update({"status": "in_progress", "completed_at": None})
    await db.project_tasks.update_one({"id": task_id, "project_id": project_id}, {"$set": updates})
    await log_activity(current_user, "project_task_reviewed", "project_task", task_id, task["title"], f"Review result: {result.replace('_', ' ')}", metadata={"project_id": project_id, "client_id": project.get("client_id"), "ticket_id": task.get("ticket_id")})
    return {"message": "Review recorded"}

@router.delete("/projects/{project_id}/tasks/{task_id}")
async def delete_project_task(project_id: str, task_id: str, current_user: dict = Depends(get_current_user)):
    project = await _project_or_404(project_id, current_user)
    task = await db.project_tasks.find_one({"id": task_id, "project_id": project_id}, {"_id": 0})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    await db.project_tasks.delete_one({"id": task_id, "project_id": project_id})
    await log_activity(current_user, "project_task_deleted", "project_task", task_id, task.get("title", "Task"), "Deleted task", metadata={"project_id": project_id, "client_id": (project or {}).get("client_id")})
    return {"message": "Task deleted"}


@router.get("/projects/{project_id}/activity")
async def get_project_activity(project_id: str, current_user: dict = Depends(get_current_user)):
    await _project_or_404(project_id, current_user)
    return await db.activity_logs.find(
        {"$or": [
            {"entity_type": "project", "entity_id": project_id},
            {"entity_type": "project_task", "metadata.project_id": project_id},
        ]},
        {"_id": 0},
    ).sort("created_at", -1).to_list(200)

# ============== PROJECT MILESTONES ==============

@router.get("/projects/{project_id}/milestones")
async def get_milestones(project_id: str, current_user: dict = Depends(get_current_user)):
    await _project_or_404(project_id, current_user)
    milestones = await db.project_milestones.find({"project_id": project_id}, {"_id": 0}).sort("due_date", 1).to_list(100)
    return milestones

@router.post("/projects/{project_id}/milestones")
async def create_milestone(project_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    await _project_or_404(project_id, current_user)
    milestone = {
        "id": str(uuid.uuid4()),
        "project_id": project_id,
        "title": data.get("title"),
        "description": data.get("description", ""),
        "due_date": data.get("due_date"),
        "status": data.get("status", "pending"),
        "completed_at": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.project_milestones.insert_one(milestone)
    return {k: v for k, v in milestone.items() if k != "_id"}

@router.put("/projects/{project_id}/milestones/{milestone_id}")
async def update_milestone(project_id: str, milestone_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    await _project_or_404(project_id, current_user)
    if data.get("status") == "completed":
        data["completed_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.project_milestones.update_one({"id": milestone_id, "project_id": project_id}, {"$set": data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Milestone not found")
    return {"message": "Milestone updated"}

@router.delete("/projects/{project_id}/milestones/{milestone_id}")
async def delete_milestone(project_id: str, milestone_id: str, current_user: dict = Depends(get_current_user)):
    await _project_or_404(project_id, current_user)
    await db.project_milestones.delete_one({"id": milestone_id, "project_id": project_id})
    return {"message": "Milestone deleted"}

@router.get("/projects/{project_id}/time-summary")
async def get_project_time_summary(project_id: str, current_user: dict = Depends(get_current_user)):
    """Get actual vs budgeted time for a project"""
    project = await _project_or_404(project_id, current_user)
    
    tasks = await db.project_tasks.find({"project_id": project_id}, {"_id": 0}).to_list(100)
    total_estimated = sum(t.get("estimated_hours", 0) or 0 for t in tasks)
    completed_tasks = sum(1 for t in tasks if t.get("status") == "completed")
    
    # Get actual time from time entries linked to project tickets
    actual_minutes = 0
    # Get tickets linked via project tasks or direct linking
    ticket_ids = [t.get("ticket_id") for t in tasks if t.get("ticket_id")]
    if ticket_ids:
        time_result = await db.time_entries.aggregate([
            {"$match": {"ticket_id": {"$in": ticket_ids}}},
            {"$group": {"_id": None, "total": {"$sum": "$minutes"}}}
        ]).to_list(1)
        actual_minutes = time_result[0]["total"] if time_result else 0
    
    return {
        "budget_hours": project.get("budget_hours", 0),
        "estimated_hours": total_estimated,
        "actual_hours": round(actual_minutes / 60, 1),
        "total_tasks": len(tasks),
        "completed_tasks": completed_tasks,
        "completion_pct": round(completed_tasks / len(tasks) * 100) if tasks else 0,
    }

