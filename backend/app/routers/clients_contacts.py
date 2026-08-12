from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.models import *

router = APIRouter()

# ============== CLIENT CONTACTS ==============

@router.get("/clients/{client_id}/contacts")
async def get_client_contacts(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client.get("contacts", [])

@router.post("/clients/{client_id}/contacts")
async def add_client_contact(client_id: str, contact_data: dict, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "contacts": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    name = str(contact_data.get("name", "")).strip()
    if not name:
        raise HTTPException(status_code=422, detail="Contact name is required")
    contact = {
        "id": str(uuid.uuid4()),
        "name": name,
        "email": str(contact_data.get("email", "")).strip(),
        "phone": str(contact_data.get("phone", "")).strip(),
        "role": contact_data.get("role", "general"),
        "is_primary": contact_data.get("is_primary", False),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    if contact["is_primary"]:
        await db.clients.update_one({"id": client_id}, {"$set": {"contacts.$[].is_primary": False}})
    await db.clients.update_one({"id": client_id}, {"$push": {"contacts": contact}})
    return contact

@router.put("/clients/{client_id}/contacts/{contact_id}")
async def update_client_contact(client_id: str, contact_id: str, contact_data: dict, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    contacts = client.get("contacts", [])
    found = False
    for c in contacts:
        if c["id"] == contact_id:
            name = str(contact_data.get("name", c.get("name", ""))).strip()
            if not name:
                raise HTTPException(status_code=422, detail="Contact name is required")
            c.update({k: v for k, v in contact_data.items() if k in ("name", "email", "phone", "role", "is_primary")})
            c["name"] = name
            c["email"] = str(c.get("email", "")).strip()
            c["phone"] = str(c.get("phone", "")).strip()
            found = True
            break
    if not found:
        raise HTTPException(status_code=404, detail="Contact not found")
    if any(c.get("id") == contact_id and c.get("is_primary") for c in contacts):
        for c in contacts:
            if c.get("id") != contact_id:
                c["is_primary"] = False
    await db.clients.update_one({"id": client_id}, {"$set": {"contacts": contacts}})
    return {"message": "Contact updated"}

@router.delete("/clients/{client_id}/contacts/{contact_id}")
async def delete_client_contact(client_id: str, contact_id: str, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "contacts": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    contacts = client.get("contacts", [])
    if not any(contact.get("id") == contact_id for contact in contacts):
        raise HTTPException(status_code=404, detail="Contact not found")
    await db.clients.update_one({"id": client_id}, {"$pull": {"contacts": {"id": contact_id}}})
    return {"message": "Contact deleted"}

@router.get("/clients/{client_id}/detail")
async def get_client_detail(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    tickets = await db.tickets.find({"client_id": client_id}, {"_id": 0}).to_list(500)
    devices = await db.devices.find({"client_id": client_id}, {"_id": 0}).to_list(500)
    contracts = await db.contracts.find({"client_id": client_id}, {"_id": 0}).to_list(100)
    return {"client": client, "tickets": tickets, "devices": devices, "contracts": contracts}


