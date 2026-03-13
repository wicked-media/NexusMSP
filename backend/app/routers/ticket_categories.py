from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional
from datetime import datetime, timezone
import uuid
from app.database import db
from app.auth import get_current_user
from app.models import *

router = APIRouter()

# ============== TICKET CATEGORIES & ISSUE TYPES ==============

DEFAULT_CATEGORIES = [
    {"id": "cat-hardware", "name": "Hardware", "icon": "monitor", "color": "#3b82f6", "sort_order": 1, "is_active": True, "issue_types": [
        {"id": "hw-broken", "name": "Broken/Damaged Equipment", "priority": "high"},
        {"id": "hw-replace", "name": "Equipment Replacement", "priority": "medium"},
        {"id": "hw-setup", "name": "New Hardware Setup", "priority": "low"},
        {"id": "hw-peripheral", "name": "Peripheral Issue (Monitor/Keyboard/Mouse)", "priority": "low"},
        {"id": "hw-printer", "name": "Printer Issue", "priority": "medium"},
        {"id": "hw-phone", "name": "Phone/VoIP Issue", "priority": "medium"},
    ]},
    {"id": "cat-software", "name": "Software", "icon": "code", "color": "#8b5cf6", "sort_order": 2, "is_active": True, "issue_types": [
        {"id": "sw-install", "name": "Software Installation", "priority": "low"},
        {"id": "sw-update", "name": "Software Update Required", "priority": "low"},
        {"id": "sw-crash", "name": "Application Crashing", "priority": "high"},
        {"id": "sw-license", "name": "License Issue/Renewal", "priority": "medium"},
        {"id": "sw-config", "name": "Application Configuration", "priority": "medium"},
        {"id": "sw-performance", "name": "Slow Performance", "priority": "medium"},
    ]},
    {"id": "cat-network", "name": "Network", "icon": "wifi", "color": "#06b6d4", "sort_order": 3, "is_active": True, "issue_types": [
        {"id": "net-down", "name": "Internet Down", "priority": "critical"},
        {"id": "net-slow", "name": "Slow Internet/Network", "priority": "high"},
        {"id": "net-wifi", "name": "WiFi Connectivity Issue", "priority": "medium"},
        {"id": "net-vpn", "name": "VPN Issue", "priority": "high"},
        {"id": "net-dns", "name": "DNS/Routing Issue", "priority": "medium"},
        {"id": "net-firewall", "name": "Firewall/Port Issue", "priority": "medium"},
    ]},
    {"id": "cat-security", "name": "Security", "icon": "shield", "color": "#ef4444", "sort_order": 4, "is_active": True, "issue_types": [
        {"id": "sec-virus", "name": "Virus/Malware Detected", "priority": "critical"},
        {"id": "sec-breach", "name": "Security Breach/Incident", "priority": "critical"},
        {"id": "sec-phishing", "name": "Phishing/Spam Report", "priority": "high"},
        {"id": "sec-password", "name": "Password Reset", "priority": "low"},
        {"id": "sec-mfa", "name": "MFA/2FA Issue", "priority": "medium"},
        {"id": "sec-access", "name": "Access/Permissions Issue", "priority": "medium"},
    ]},
    {"id": "cat-email", "name": "Email & Collaboration", "icon": "mail", "color": "#f59e0b", "sort_order": 5, "is_active": True, "issue_types": [
        {"id": "email-send", "name": "Cannot Send/Receive Email", "priority": "high"},
        {"id": "email-outlook", "name": "Outlook Issue", "priority": "medium"},
        {"id": "email-teams", "name": "Microsoft Teams Issue", "priority": "medium"},
        {"id": "email-calendar", "name": "Calendar/Booking Issue", "priority": "low"},
        {"id": "email-shared", "name": "Shared Mailbox Issue", "priority": "medium"},
        {"id": "email-mobile", "name": "Mobile Email Setup", "priority": "low"},
    ]},
    {"id": "cat-cloud", "name": "Cloud & Server", "icon": "cloud", "color": "#14b8a6", "sort_order": 6, "is_active": True, "issue_types": [
        {"id": "cloud-down", "name": "Server Down", "priority": "critical"},
        {"id": "cloud-backup", "name": "Backup Failure", "priority": "high"},
        {"id": "cloud-storage", "name": "Storage/Disk Space Issue", "priority": "medium"},
        {"id": "cloud-migration", "name": "Cloud Migration Request", "priority": "low"},
        {"id": "cloud-performance", "name": "Server Performance Issue", "priority": "high"},
        {"id": "cloud-cert", "name": "SSL/Certificate Issue", "priority": "medium"},
    ]},
    {"id": "cat-onboarding", "name": "User Onboarding/Offboarding", "icon": "user-plus", "color": "#22c55e", "sort_order": 7, "is_active": True, "issue_types": [
        {"id": "ob-newuser", "name": "New User Setup", "priority": "medium"},
        {"id": "ob-offboard", "name": "User Offboarding", "priority": "medium"},
        {"id": "ob-transfer", "name": "User Department Transfer", "priority": "low"},
        {"id": "ob-device", "name": "New Device Provisioning", "priority": "medium"},
    ]},
    {"id": "cat-request", "name": "Service Request", "icon": "clipboard", "color": "#a855f7", "sort_order": 8, "is_active": True, "issue_types": [
        {"id": "req-general", "name": "General Request", "priority": "low"},
        {"id": "req-quote", "name": "Quote Request", "priority": "low"},
        {"id": "req-project", "name": "Project Request", "priority": "medium"},
        {"id": "req-consult", "name": "Consultation Request", "priority": "low"},
        {"id": "req-training", "name": "Training Request", "priority": "low"},
    ]},
]

@router.get("/ticket-categories")
async def get_ticket_categories(current_user: dict = Depends(get_current_user)):
    cats = await db.ticket_categories.find({"is_active": True}, {"_id": 0}).sort("sort_order", 1).to_list(100)
    if not cats:
        # Seed defaults
        for cat in DEFAULT_CATEGORIES:
            cat["created_at"] = datetime.now(timezone.utc).isoformat()
            await db.ticket_categories.insert_one({**cat})
        cats = DEFAULT_CATEGORIES
    return cats

@router.get("/ticket-categories/all")
async def get_all_ticket_categories(current_user: dict = Depends(get_current_user)):
    cats = await db.ticket_categories.find({}, {"_id": 0}).sort("sort_order", 1).to_list(100)
    if not cats:
        for cat in DEFAULT_CATEGORIES:
            cat["created_at"] = datetime.now(timezone.utc).isoformat()
            await db.ticket_categories.insert_one({**cat})
        cats = DEFAULT_CATEGORIES
    return cats

@router.post("/ticket-categories")
async def create_ticket_category(data: dict, current_user: dict = Depends(get_current_user)):
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    cat = {
        "id": f"cat-{str(uuid.uuid4())[:8]}",
        "name": data.get("name", "New Category"),
        "description": data.get("description", ""),
        "icon": data.get("icon", "folder"),
        "color": data.get("color", "#3b82f6"),
        "sort_order": data.get("sort_order", 99),
        "is_active": True,
        "issue_types": data.get("issue_types", []),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.ticket_categories.insert_one({**cat})
    return cat

@router.put("/ticket-categories/{cat_id}")
async def update_ticket_category(cat_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    result = await db.ticket_categories.update_one({"id": cat_id}, {"$set": data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Category not found")
    return {"message": "Category updated"}

@router.delete("/ticket-categories/{cat_id}")
async def delete_ticket_category(cat_id: str, current_user: dict = Depends(get_current_user)):
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    await db.ticket_categories.update_one({"id": cat_id}, {"$set": {"is_active": False}})
    return {"message": "Category deactivated"}

@router.post("/ticket-categories/{cat_id}/issue-types")
async def add_issue_type(cat_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    issue = {
        "id": f"issue-{str(uuid.uuid4())[:8]}",
        "name": data.get("name", "New Issue"),
        "description": data.get("description", ""),
        "priority": data.get("priority", "medium"),
    }
    result = await db.ticket_categories.update_one({"id": cat_id}, {"$push": {"issue_types": issue}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Category not found")
    return {"message": "Issue type added", "issue": issue}

@router.delete("/ticket-categories/{cat_id}/issue-types/{issue_id}")
async def remove_issue_type(cat_id: str, issue_id: str, current_user: dict = Depends(get_current_user)):
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    result = await db.ticket_categories.update_one({"id": cat_id}, {"$pull": {"issue_types": {"id": issue_id}}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Category not found")
    return {"message": "Issue type removed"}
