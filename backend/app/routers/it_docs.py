from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.models import *

router = APIRouter()

# ============== IT DOCUMENTATION ENDPOINTS ==============

# Retired: password storage is handled by Keeper/Hudu, not NexusMSP.
# @router.get("/passwords")
async def get_passwords(client_id: Optional[str] = None, category: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if client_id:
        query["client_id"] = client_id
    if category:
        query["category"] = category
    
    passwords = await db.passwords.find(query, {"_id": 0}).sort("name", 1).to_list(1000)
    # Mask passwords in list view
    for p in passwords:
        p['password'] = '••••••••'
    return passwords

# @router.get("/passwords/{password_id}")
async def get_password(password_id: str, current_user: dict = Depends(get_current_user)):
    """Get a password entry (reveals actual password)"""
    password = await db.passwords.find_one({"id": password_id}, {"_id": 0})
    if not password:
        raise HTTPException(status_code=404, detail="Password not found")
    
    # Update access tracking
    await db.passwords.update_one(
        {"id": password_id},
        {"$set": {"last_accessed": datetime.now(timezone.utc).isoformat()}, "$inc": {"access_count": 1}}
    )
    
    # Log access for audit
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": current_user['id'],
        "user_name": current_user['name'],
        "user_email": current_user['email'],
        "action": "view",
        "entity_type": "password",
        "entity_id": password_id,
        "entity_name": password.get('name'),
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    
    return password

# @router.post("/passwords")
async def create_password(password_data: dict, current_user: dict = Depends(get_current_user)):
    client_name = None
    if password_data.get('client_id'):
        client = await db.clients.find_one({"id": password_data['client_id']}, {"_id": 0})
        client_name = client['name'] if client else None
    
    password = PasswordEntry(
        client_id=password_data.get('client_id'),
        client_name=client_name,
        name=password_data.get('name'),
        category=password_data.get('category', 'general'),
        username=password_data.get('username'),
        password=password_data.get('password'),
        url=password_data.get('url'),
        notes=password_data.get('notes'),
        tags=password_data.get('tags', []),
        created_by=current_user['id']
    )
    doc = password.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['updated_at'] = doc['updated_at'].isoformat()
    await db.passwords.insert_one(doc)
    return {"id": password.id, "name": password.name, "message": "Password created"}

# @router.put("/passwords/{password_id}")
async def update_password(password_id: str, password_data: dict, current_user: dict = Depends(get_current_user)):
    password_data['updated_at'] = datetime.now(timezone.utc).isoformat()
    result = await db.passwords.update_one({"id": password_id}, {"$set": password_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Password not found")
    return {"message": "Password updated"}

# @router.delete("/passwords/{password_id}")
async def delete_password(password_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.passwords.delete_one({"id": password_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Password not found")
    return {"message": "Password deleted"}

# ============== DOCUMENTATION PAGES ENDPOINTS ==============

@router.get("/documentation")
async def get_documentation_pages(
    client_id: Optional[str] = None,
    category: Optional[str] = None,
    is_template: bool = False,
    current_user: dict = Depends(get_current_user)
):
    query = {"is_template": is_template}
    if client_id:
        query["client_id"] = client_id
    if category:
        query["category"] = category
    
    pages = await db.documentation.find(query, {"_id": 0}).sort("title", 1).to_list(1000)
    return pages

@router.get("/documentation/{doc_id}")
async def get_documentation_page(doc_id: str, current_user: dict = Depends(get_current_user)):
    doc = await db.documentation.find_one({"id": doc_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Documentation not found")
    
    await db.documentation.update_one({"id": doc_id}, {"$inc": {"view_count": 1}})
    return doc

@router.post("/documentation")
async def create_documentation_page(doc_data: dict, current_user: dict = Depends(get_current_user)):
    client_name = None
    if doc_data.get('client_id'):
        client = await db.clients.find_one({"id": doc_data['client_id']}, {"_id": 0})
        client_name = client['name'] if client else None
    
    doc = DocumentationPage(
        client_id=doc_data.get('client_id'),
        client_name=client_name,
        title=doc_data.get('title'),
        content=doc_data.get('content', ''),
        category=doc_data.get('category', 'general'),
        parent_id=doc_data.get('parent_id'),
        is_template=doc_data.get('is_template', False),
        tags=doc_data.get('tags', []),
        last_edited_by=current_user['id'],
        last_edited_by_name=current_user['name']
    )
    doc_dict = doc.model_dump()
    doc_dict['created_at'] = doc_dict['created_at'].isoformat()
    doc_dict['updated_at'] = doc_dict['updated_at'].isoformat()
    await db.documentation.insert_one(doc_dict)
    return doc

@router.put("/documentation/{doc_id}")
async def update_documentation_page(doc_id: str, doc_data: dict, current_user: dict = Depends(get_current_user)):
    doc_data['updated_at'] = datetime.now(timezone.utc).isoformat()
    doc_data['last_edited_by'] = current_user['id']
    doc_data['last_edited_by_name'] = current_user['name']
    result = await db.documentation.update_one({"id": doc_id}, {"$set": doc_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Documentation not found")
    return {"message": "Documentation updated"}

@router.delete("/documentation/{doc_id}")
async def delete_documentation_page(doc_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.documentation.delete_one({"id": doc_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Documentation not found")
    return {"message": "Documentation deleted"}

# ============== RUNBOOK ENDPOINTS ==============

@router.get("/runbooks")
async def get_runbooks(category: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if category:
        query["category"] = category
    
    runbooks = await db.runbooks.find(query, {"_id": 0}).sort("name", 1).to_list(100)
    return runbooks

@router.get("/runbooks/{runbook_id}")
async def get_runbook(runbook_id: str, current_user: dict = Depends(get_current_user)):
    runbook = await db.runbooks.find_one({"id": runbook_id}, {"_id": 0})
    if not runbook:
        raise HTTPException(status_code=404, detail="Runbook not found")
    return runbook

@router.post("/runbooks")
async def create_runbook(runbook_data: dict, current_user: dict = Depends(get_current_user)):
    runbook = Runbook(
        name=runbook_data.get('name'),
        description=runbook_data.get('description'),
        category=runbook_data.get('category', 'remediation'),
        trigger_type=runbook_data.get('trigger_type', 'manual'),
        trigger_conditions=runbook_data.get('trigger_conditions', {}),
        steps=runbook_data.get('steps', []),
        enabled=runbook_data.get('enabled', True),
        created_by=current_user['id']
    )
    doc = runbook.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.runbooks.insert_one(doc)
    return runbook

@router.put("/runbooks/{runbook_id}")
async def update_runbook(runbook_id: str, runbook_data: dict, current_user: dict = Depends(get_current_user)):
    result = await db.runbooks.update_one({"id": runbook_id}, {"$set": runbook_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Runbook not found")
    return {"message": "Runbook updated"}

@router.delete("/runbooks/{runbook_id}")
async def delete_runbook(runbook_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.runbooks.delete_one({"id": runbook_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Runbook not found")
    return {"message": "Runbook deleted"}

@router.post("/runbooks/{runbook_id}/execute")
async def execute_runbook(runbook_id: str, context: Dict[str, Any] = {}, current_user: dict = Depends(get_current_user)):
    """Execute a runbook manually"""
    runbook = await db.runbooks.find_one({"id": runbook_id}, {"_id": 0})
    if not runbook:
        raise HTTPException(status_code=404, detail="Runbook not found")
    
    execution = RunbookExecution(
        runbook_id=runbook_id,
        runbook_name=runbook['name'],
        triggered_by="manual",
        trigger_context=context,
        device_id=context.get('device_id'),
        client_id=context.get('client_id'),
        user_id=current_user['id'],
        status="running"
    )
    doc = execution.model_dump()
    doc['started_at'] = doc['started_at'].isoformat()
    await db.runbook_executions.insert_one(doc)
    
    # Update runbook stats
    await db.runbooks.update_one(
        {"id": runbook_id},
        {"$inc": {"run_count": 1}, "$set": {"last_run": datetime.now(timezone.utc).isoformat()}}
    )
    
    return execution

@router.get("/runbook-executions")
async def get_runbook_executions(runbook_id: Optional[str] = None, limit: int = 50, current_user: dict = Depends(get_current_user)):
    query = {}
    if runbook_id:
        query["runbook_id"] = runbook_id
    
    executions = await db.runbook_executions.find(query, {"_id": 0}).sort("started_at", -1).to_list(limit)
    return executions

