from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.models import *

router = APIRouter()

# ============== MICROSOFT INTEGRATIONS CONFIG ==============

@router.get("/settings/microsoft-teams")
async def get_teams_settings(current_user: dict = Depends(get_current_user)):
    """Get Microsoft Teams integration settings"""
    settings = await db.settings.find_one({"type": "microsoft_teams"}, {"_id": 0})
    return settings or {"type": "microsoft_teams", "enabled": False, "tenant_id": "", "client_id": "", "client_secret": "", "webhook_url": ""}

@router.put("/settings/microsoft-teams")
async def update_teams_settings(data: dict, current_user: dict = Depends(get_current_user)):
    """Update Microsoft Teams integration settings"""
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    data["type"] = "microsoft_teams"
    await db.settings.update_one({"type": "microsoft_teams"}, {"$set": data}, upsert=True)
    return {"message": "Teams settings updated"}

@router.get("/settings/cipp")
async def get_cipp_settings(current_user: dict = Depends(get_current_user)):
    """Get CIPP integration settings"""
    settings = await db.settings.find_one({"type": "cipp"}, {"_id": 0})
    return settings or {"type": "cipp", "enabled": False, "api_url": "", "api_key": "", "tenant_filter": ""}

@router.put("/settings/cipp")
async def update_cipp_settings(data: dict, current_user: dict = Depends(get_current_user)):
    """Update CIPP integration settings"""
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    data["type"] = "cipp"
    await db.settings.update_one({"type": "cipp"}, {"$set": data}, upsert=True)
    return {"message": "CIPP settings updated"}

@router.get("/settings/microsoft365")
async def get_m365_settings(current_user: dict = Depends(get_current_user)):
    """Get Microsoft 365 integration settings"""
    settings = await db.settings.find_one({"type": "microsoft365"}, {"_id": 0})
    return settings or {"type": "microsoft365", "enabled": False, "tenant_id": "", "client_id": "", "client_secret": "", "redirect_uri": ""}

@router.put("/settings/microsoft365")
async def update_m365_settings(data: dict, current_user: dict = Depends(get_current_user)):
    """Update Microsoft 365 integration settings"""
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    data["type"] = "microsoft365"
    await db.settings.update_one({"type": "microsoft365"}, {"$set": data}, upsert=True)
    return {"message": "Microsoft 365 settings updated"}

@router.post("/clients/{client_id}/m365-sync")
async def sync_client_m365(client_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Sync Microsoft 365 tenancy for a client"""
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    
    m365_data = {
        "tenant_id": data.get("tenant_id", ""),
        "domain": data.get("domain", ""),
        "last_synced": datetime.now(timezone.utc).isoformat(),
        "sync_status": "synced",
    }
    await db.clients.update_one({"id": client_id}, {"$set": {"m365_config": m365_data}})
    
    # Store user licenses from CIPP if provided
    users_data = data.get("users", [])
    if users_data:
        for u in users_data:
            u["client_id"] = client_id
            u["synced_at"] = datetime.now(timezone.utc).isoformat()
        await db.m365_users.delete_many({"client_id": client_id})
        if users_data:
            await db.m365_users.insert_many(users_data)
    
    return {"message": f"M365 synced for {client['name']}", "users_synced": len(users_data)}

@router.get("/clients/{client_id}/m365-users")
async def get_client_m365_users(client_id: str, current_user: dict = Depends(get_current_user)):
    """Get M365 users for a client"""
    users = await db.m365_users.find({"client_id": client_id}, {"_id": 0}).to_list(500)
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "m365_config": 1})
    return {"users": users, "config": client.get("m365_config") if client else None}

@router.post("/cipp/sync-tenants")
async def sync_cipp_tenants(current_user: dict = Depends(get_current_user)):
    """Sync tenants from CIPP - returns mock data for now, real integration when CIPP configured"""
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    cipp_settings = await db.settings.find_one({"type": "cipp"}, {"_id": 0})
    if not cipp_settings or not cipp_settings.get("enabled"):
        return {"message": "CIPP integration not configured. Please set up in Settings > Integrations.", "tenants": [], "configured": False}
    
    # When CIPP is configured, it would call the CIPP API here
    # For now, return configuration status
    return {"message": "CIPP sync initiated", "tenants": [], "configured": True, "api_url": cipp_settings.get("api_url", "")}

@router.post("/teams/update-status")
async def update_teams_status(data: dict, current_user: dict = Depends(get_current_user)):
    """Update Microsoft Teams status for current user"""
    teams_settings = await db.settings.find_one({"type": "microsoft_teams"}, {"_id": 0})
    if not teams_settings or not teams_settings.get("enabled"):
        return {"message": "Teams integration not configured. Please set up in Settings > Integrations.", "configured": False}
    
    # Store the desired status locally
    status_data = {
        "user_id": current_user["id"],
        "availability": data.get("availability", "Available"),
        "status_message": data.get("status_message", ""),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.teams_status.update_one({"user_id": current_user["id"]}, {"$set": status_data}, upsert=True)
    return {"message": "Status updated", "configured": True, "status": status_data}

@router.get("/technicians/{tech_id}/teams-status")
async def get_tech_teams_status(tech_id: str, current_user: dict = Depends(get_current_user)):
    """Get Teams status for a technician"""
    status = await db.teams_status.find_one({"user_id": tech_id}, {"_id": 0})
    return status or {"availability": "Unknown", "status_message": ""}

