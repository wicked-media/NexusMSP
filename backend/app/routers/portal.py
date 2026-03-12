from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.models import *

router = APIRouter()

# ============== CUSTOMER PORTAL ENDPOINTS ==============

@router.get("/portal/users")
async def get_portal_users(client_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if client_id:
        query["client_id"] = client_id
    
    users = await db.portal_users.find(query, {"_id": 0, "password_hash": 0}).to_list(1000)
    return users

@router.post("/portal/users")
async def create_portal_user(user_data: dict, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": user_data.get('client_id')}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    
    # Check if email already exists
    existing = await db.portal_users.find_one({"email": user_data.get('email')})
    if existing:
        raise HTTPException(status_code=400, detail="Email already exists")
    
    portal_user = PortalUser(
        client_id=client['id'],
        client_name=client['name'],
        email=user_data.get('email'),
        password_hash=hash_password(user_data.get('password', 'welcome123')),
        name=user_data.get('name'),
        phone=user_data.get('phone'),
        role=user_data.get('role', 'user'),
        is_primary_contact=user_data.get('is_primary_contact', False),
        can_view_all_tickets=user_data.get('can_view_all_tickets', False),
        can_create_tickets=user_data.get('can_create_tickets', True),
        can_view_assets=user_data.get('can_view_assets', True),
        can_view_invoices=user_data.get('can_view_invoices', False)
    )
    doc = portal_user.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.portal_users.insert_one(doc)
    
    return {"id": portal_user.id, "email": portal_user.email, "message": "Portal user created"}

@router.put("/portal/users/{user_id}")
async def update_portal_user(user_id: str, user_data: dict, current_user: dict = Depends(get_current_user)):
    if 'password' in user_data:
        user_data['password_hash'] = hash_password(user_data.pop('password'))
    
    result = await db.portal_users.update_one({"id": user_id}, {"$set": user_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Portal user not found")
    return {"message": "Portal user updated"}

@router.delete("/portal/users/{user_id}")
async def delete_portal_user(user_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.portal_users.delete_one({"id": user_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Portal user not found")
    return {"message": "Portal user deleted"}

# Portal login (separate from main app login)
@router.post("/portal/login")
async def portal_login(email: str, password: str):
    user = await db.portal_users.find_one({"email": email}, {"_id": 0})
    if not user or not verify_password(password, user['password_hash']):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    if not user.get('is_active', True):
        raise HTTPException(status_code=401, detail="Account is disabled")
    
    token = create_token(user['id'], user['email'], 'portal_user')
    
    await db.portal_users.update_one(
        {"id": user['id']},
        {"$set": {"last_login": datetime.now(timezone.utc).isoformat()}}
    )
    
    return {"token": token, "user": {k: v for k, v in user.items() if k != 'password_hash'}}

