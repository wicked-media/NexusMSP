from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.services.scope_permissions import assert_client_scope, assert_record_scope, scoped_query
from app.models import *

router = APIRouter()

PROJECT_STATUSES = {"planning", "in_progress", "on_hold", "completed", "cancelled"}
TASK_STATUSES = {"todo", "in_progress", "review", "completed"}
PRIORITIES = {"low", "medium", "high", "urgent"}


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
    
    task = ProjectTask(
        project_id=project_id,
        project_name=project['name'],
        title=title,
        description=task_data.get('description'),
        status=status,
        priority=priority,
        assigned_to=assigned_to,
        assigned_name=assigned_name,
        estimated_hours=task_data.get('estimated_hours'),
        ticket_id=ticket_id,
        ticket_number=ticket_number,
        ticket_title=ticket_title,
        due_date=task_data.get('due_date'),
        dependencies=task_data.get('dependencies', []),
        order=task_data.get('order', 0)
    )
    doc = task.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.project_tasks.insert_one(doc)
    await log_activity(current_user, "project_task_created", "project_task", task.id, task.title, f"Created task in {project['name']}", metadata={"project_id": project_id, "client_id": project.get("client_id"), "ticket_id": ticket_id})
    if ticket_id:
        await ticket_audit(ticket_id, current_user, "project_task_linked", f"Linked project task: {task.title}")
    return task

@router.put("/projects/{project_id}/tasks/{task_id}")
async def update_project_task(project_id: str, task_id: str, task_data: dict, current_user: dict = Depends(get_current_user)):
    project = await _project_or_404(project_id, current_user)
    task = await db.project_tasks.find_one({"id": task_id, "project_id": project_id}, {"_id": 0})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    allowed = {"title", "description", "status", "priority", "assigned_to", "estimated_hours", "actual_hours", "due_date", "ticket_id", "order"}
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
    if updates.get("status") == "completed":
        updates["completed_at"] = datetime.now(timezone.utc).isoformat()
    elif updates.get("status"):
        updates["completed_at"] = None
    await db.project_tasks.update_one({"id": task_id, "project_id": project_id}, {"$set": updates})
    changed = ", ".join(sorted(key.replace("_", " ") for key in updates if key not in {"completed_at"})) or "task details"
    await log_activity(current_user, "project_task_updated", "project_task", task_id, updates.get("title", task["title"]), f"Updated {changed}", changes={key: {"from": task.get(key), "to": value} for key, value in updates.items() if task.get(key) != value}, metadata={"project_id": project_id, "client_id": project.get("client_id"), "ticket_id": updates.get("ticket_id", task.get("ticket_id"))})
    if "ticket_id" in updates and updates.get("ticket_id"):
        await ticket_audit(updates["ticket_id"], current_user, "project_task_linked", f"Linked project task: {updates.get('title', task['title'])}")
    return {"message": "Task updated"}

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

