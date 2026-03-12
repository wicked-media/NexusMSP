from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.models import *

router = APIRouter()

# ============== PROJECT MANAGEMENT ENDPOINTS ==============

@router.get("/projects")
async def get_projects(
    client_id: Optional[str] = None,
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if client_id:
        query["client_id"] = client_id
    if status:
        query["status"] = status
    
    projects = await db.projects.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return projects

@router.get("/projects/{project_id}")
async def get_project(project_id: str, current_user: dict = Depends(get_current_user)):
    project = await db.projects.find_one({"id": project_id}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    tasks = await db.project_tasks.find({"project_id": project_id}, {"_id": 0}).sort("order", 1).to_list(1000)
    project['tasks'] = tasks
    return project

@router.post("/projects")
async def create_project(project_data: dict, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": project_data.get('client_id')}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    
    pm_name = None
    if project_data.get('project_manager'):
        pm = await db.users.find_one({"id": project_data['project_manager']}, {"_id": 0})
        pm_name = pm['name'] if pm else None
    
    project = Project(
        name=project_data.get('name'),
        description=project_data.get('description'),
        client_id=client['id'],
        client_name=client['name'],
        status=project_data.get('status', 'planning'),
        priority=project_data.get('priority', 'medium'),
        start_date=project_data.get('start_date'),
        target_end_date=project_data.get('target_end_date'),
        budget_hours=project_data.get('budget_hours'),
        project_manager=project_data.get('project_manager'),
        project_manager_name=pm_name,
        team_members=project_data.get('team_members', []),
        tags=project_data.get('tags', [])
    )
    doc = project.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['updated_at'] = doc['updated_at'].isoformat()
    await db.projects.insert_one(doc)
    return project

@router.put("/projects/{project_id}")
async def update_project(project_id: str, project_data: dict, current_user: dict = Depends(get_current_user)):
    project_data['updated_at'] = datetime.now(timezone.utc).isoformat()
    result = await db.projects.update_one({"id": project_id}, {"$set": project_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"message": "Project updated"}

@router.delete("/projects/{project_id}")
async def delete_project(project_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.projects.delete_one({"id": project_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Also delete tasks
    await db.project_tasks.delete_many({"project_id": project_id})
    return {"message": "Project deleted"}

# ============== PROJECT TASKS ENDPOINTS ==============

@router.get("/projects/{project_id}/tasks")
async def get_project_tasks(project_id: str, current_user: dict = Depends(get_current_user)):
    tasks = await db.project_tasks.find({"project_id": project_id}, {"_id": 0}).sort("order", 1).to_list(1000)
    return tasks

@router.post("/projects/{project_id}/tasks")
async def create_project_task(project_id: str, task_data: dict, current_user: dict = Depends(get_current_user)):
    project = await db.projects.find_one({"id": project_id}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    assigned_name = None
    if task_data.get('assigned_to'):
        user = await db.users.find_one({"id": task_data['assigned_to']}, {"_id": 0})
        assigned_name = user['name'] if user else None
    
    task = ProjectTask(
        project_id=project_id,
        project_name=project['name'],
        title=task_data.get('title'),
        description=task_data.get('description'),
        status=task_data.get('status', 'todo'),
        priority=task_data.get('priority', 'medium'),
        assigned_to=task_data.get('assigned_to'),
        assigned_name=assigned_name,
        estimated_hours=task_data.get('estimated_hours'),
        due_date=task_data.get('due_date'),
        dependencies=task_data.get('dependencies', []),
        order=task_data.get('order', 0)
    )
    doc = task.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.project_tasks.insert_one(doc)
    return task

@router.put("/projects/{project_id}/tasks/{task_id}")
async def update_project_task(project_id: str, task_id: str, task_data: dict, current_user: dict = Depends(get_current_user)):
    if task_data.get('status') == 'completed':
        task_data['completed_at'] = datetime.now(timezone.utc).isoformat()
    
    result = await db.project_tasks.update_one({"id": task_id, "project_id": project_id}, {"$set": task_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"message": "Task updated"}

@router.delete("/projects/{project_id}/tasks/{task_id}")
async def delete_project_task(project_id: str, task_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.project_tasks.delete_one({"id": task_id, "project_id": project_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"message": "Task deleted"}

