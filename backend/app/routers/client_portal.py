from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone, timedelta
import uuid
import secrets
from app.database import db
from app.auth import get_current_user

router = APIRouter()

# ============== PORTAL CONFIGURATION ==============

@router.get("/client-portal/config/{client_id}")
async def get_portal_config(client_id: str, current_user: dict = Depends(get_current_user)):
    config = await db.portal_configs.find_one({"client_id": client_id}, {"_id": 0})
    if not config:
        client = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1})
        config = {
            "client_id": client_id, "client_name": client["name"] if client else "Unknown",
            "enabled": False, "branding": {"primary_color": "#3b82f6", "logo_url": None, "company_name": client["name"] if client else ""},
            "features": {"can_create_tickets": True, "can_view_devices": True, "can_view_invoices": True, "can_view_contracts": True, "can_view_kb": True},
            "portal_url": None, "access_tokens": []
        }
    return config

@router.put("/client-portal/config/{client_id}")
async def update_portal_config(client_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    data["client_id"] = client_id
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.portal_configs.update_one({"client_id": client_id}, {"$set": data}, upsert=True)
    return {"message": "Portal config updated"}

@router.post("/client-portal/generate-token/{client_id}")
async def generate_portal_token(client_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    token_value = secrets.token_urlsafe(32)
    token_entry = {
        "id": str(uuid.uuid4()), "token": token_value,
        "contact_name": data.get("contact_name", ""),
        "contact_email": data.get("contact_email", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=data.get("expiry_days", 90))).isoformat(),
        "last_used": None, "active": True
    }
    await db.portal_configs.update_one(
        {"client_id": client_id},
        {"$push": {"access_tokens": token_entry}, "$set": {"client_id": client_id, "enabled": True}},
        upsert=True
    )
    return {"token": token_value, "portal_url": f"/portal/{token_value}", "entry": token_entry}

@router.delete("/client-portal/tokens/{client_id}/{token_id}")
async def revoke_portal_token(client_id: str, token_id: str, current_user: dict = Depends(get_current_user)):
    await db.portal_configs.update_one(
        {"client_id": client_id},
        {"$pull": {"access_tokens": {"id": token_id}}}
    )
    return {"message": "Token revoked"}

# ============== PUBLIC PORTAL ENDPOINTS (no auth) ==============

@router.get("/portal-api/{token}/info")
async def portal_get_info(token: str):
    config = await db.portal_configs.find_one({"access_tokens.token": token}, {"_id": 0})
    if not config or not config.get("enabled"):
        raise HTTPException(status_code=404, detail="Portal not found or disabled")
    
    token_entry = next((t for t in config.get("access_tokens", []) if t["token"] == token and t.get("active")), None)
    if not token_entry:
        raise HTTPException(status_code=403, detail="Token expired or revoked")
    
    await db.portal_configs.update_one(
        {"client_id": config["client_id"], "access_tokens.token": token},
        {"$set": {"access_tokens.$.last_used": datetime.now(timezone.utc).isoformat()}}
    )
    
    client = await db.clients.find_one({"id": config["client_id"]}, {"_id": 0, "name": 1, "email": 1, "industry": 1})
    return {
        "client": client, "branding": config.get("branding", {}),
        "features": config.get("features", {}),
        "contact_name": token_entry.get("contact_name"),
    }

@router.get("/portal-api/{token}/tickets")
async def portal_get_tickets(token: str):
    config = await db.portal_configs.find_one({"access_tokens.token": token, "enabled": True}, {"_id": 0})
    if not config:
        raise HTTPException(status_code=404, detail="Portal not found")
    
    tickets = await db.tickets.find(
        {"client_id": config["client_id"]},
        {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "status": 1, "priority": 1, "category": 1, "created_at": 1, "updated_at": 1}
    ).sort("created_at", -1).to_list(100)
    return tickets

@router.post("/portal-api/{token}/tickets")
async def portal_create_ticket(token: str, data: dict):
    config = await db.portal_configs.find_one({"access_tokens.token": token, "enabled": True}, {"_id": 0})
    if not config:
        raise HTTPException(status_code=404, detail="Portal not found")
    if not config.get("features", {}).get("can_create_tickets"):
        raise HTTPException(status_code=403, detail="Ticket creation disabled")
    
    token_entry = next((t for t in config.get("access_tokens", []) if t["token"] == token), None)
    ticket = {
        "id": str(uuid.uuid4()),
        "ticket_number": f"PT-{datetime.now(timezone.utc).strftime('%m%d%H%M')}",
        "title": data.get("title", "Portal Ticket"),
        "description": data.get("description", ""),
        "priority": "medium", "category": data.get("category", "support"),
        "status": "open", "source": "client_portal",
        "client_id": config["client_id"],
        "client_name": config.get("client_name", ""),
        "contact_name": token_entry.get("contact_name") if token_entry else None,
        "contact_email": token_entry.get("contact_email") if token_entry else None,
        "assigned_to": None, "assigned_name": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.tickets.insert_one(ticket)
    ticket.pop("_id", None)
    return ticket

@router.get("/portal-api/{token}/devices")
async def portal_get_devices(token: str):
    config = await db.portal_configs.find_one({"access_tokens.token": token, "enabled": True}, {"_id": 0})
    if not config:
        raise HTTPException(status_code=404, detail="Portal not found")
    if not config.get("features", {}).get("can_view_devices"):
        raise HTTPException(status_code=403, detail="Device view disabled")
    
    devices = await db.devices.find(
        {"client_id": config["client_id"]},
        {"_id": 0, "id": 1, "name": 1, "device_type": 1, "os": 1, "status": 1, "ip_address": 1}
    ).to_list(200)
    return devices

@router.get("/client-portal/all")
async def get_all_portal_configs(current_user: dict = Depends(get_current_user)):
    configs = await db.portal_configs.find({}, {"_id": 0}).to_list(100)
    return configs



# ============== PORTAL USER MANAGEMENT ==============

@router.get("/client-portal/users/{client_id}")
async def get_portal_users(client_id: str, current_user: dict = Depends(get_current_user)):
    """Get all portal users for a client."""
    users = await db.portal_users.find({"client_id": client_id}, {"_id": 0, "password_hash": 0, "totp_secret": 0}).sort("created_at", -1).to_list(100)
    return users


@router.post("/client-portal/users/{client_id}")
async def create_portal_user(client_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Create a new portal user for a client (admin action)."""
    from app.auth import hash_password

    email = (data.get("email") or "").lower().strip()
    name = data.get("name", "")
    if not email:
        raise HTTPException(status_code=400, detail="Email is required")

    # Check if user already exists
    existing = await db.portal_users.find_one({"email": email}, {"_id": 0, "id": 1})
    if existing:
        raise HTTPException(status_code=409, detail="A portal user with this email already exists")

    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1})
    password = data.get("password") or secrets.token_urlsafe(10)

    user = {
        "id": str(uuid.uuid4()),
        "client_id": client_id,
        "client_name": client["name"] if client else "",
        "email": email,
        "name": name,
        "phone": data.get("phone", ""),
        "role": data.get("role", "user"),
        "is_primary_contact": data.get("is_primary_contact", False),
        "can_view_all_tickets": data.get("can_view_all_tickets", True),
        "can_create_tickets": data.get("can_create_tickets", True),
        "can_view_assets": data.get("can_view_assets", True),
        "can_view_invoices": data.get("can_view_invoices", False),
        "password_hash": hash_password(password),
        "is_active": True,
        "totp_enabled": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "invited_by": current_user.get("name", ""),
    }
    await db.portal_users.insert_one(user)
    user.pop("_id", None)
    safe = {k: v for k, v in user.items() if k not in ("password_hash", "totp_secret")}
    safe["temp_password"] = password
    return safe


@router.put("/client-portal/users/{client_id}/{user_id}")
async def update_portal_user(client_id: str, user_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Update a portal user's permissions and details."""
    from app.auth import hash_password

    user = await db.portal_users.find_one({"id": user_id, "client_id": client_id}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Portal user not found")

    allowed_fields = {"name", "phone", "role", "is_primary_contact", "can_view_all_tickets",
                      "can_create_tickets", "can_view_assets", "can_view_invoices", "is_active"}
    updates = {k: v for k, v in data.items() if k in allowed_fields}
    if data.get("password"):
        updates["password_hash"] = hash_password(data["password"])
    if updates:
        updates["updated_at"] = datetime.now(timezone.utc).isoformat()
        await db.portal_users.update_one({"id": user_id}, {"$set": updates})
    return {"message": "Portal user updated"}


@router.delete("/client-portal/users/{client_id}/{user_id}")
async def delete_portal_user(client_id: str, user_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a portal user."""
    result = await db.portal_users.delete_one({"id": user_id, "client_id": client_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Portal user not found")
    return {"message": "Portal user deleted"}


@router.post("/client-portal/users/{client_id}/{user_id}/reset-password")
async def reset_portal_user_password(client_id: str, user_id: str, current_user: dict = Depends(get_current_user)):
    """Reset a portal user's password to a random one."""
    from app.auth import hash_password

    user = await db.portal_users.find_one({"id": user_id, "client_id": client_id}, {"_id": 0, "email": 1})
    if not user:
        raise HTTPException(status_code=404, detail="Portal user not found")

    new_password = secrets.token_urlsafe(10)
    await db.portal_users.update_one({"id": user_id}, {"$set": {"password_hash": hash_password(new_password), "totp_enabled": False}})
    return {"message": "Password reset", "temp_password": new_password, "email": user["email"]}



# ============== ENHANCED PORTAL API ENDPOINTS ==============

@router.get("/portal-api/{token}/invoices")
async def portal_get_invoices(token: str):
    """Client portal: View invoices for this client."""
    config = await db.portal_configs.find_one({"access_tokens.token": token, "enabled": True}, {"_id": 0})
    if not config:
        raise HTTPException(status_code=404, detail="Portal not found")
    invoices = await db.invoices.find(
        {"client_id": config["client_id"]},
        {"_id": 0, "id": 1, "invoice_number": 1, "description": 1, "total": 1, "amount_due": 1,
         "amount_paid": 1, "status": 1, "payment_status": 1, "due_date": 1, "created_at": 1, "currency": 1}
    ).sort("created_at", -1).to_list(200)
    return invoices


@router.get("/portal-api/{token}/invoices/{invoice_id}")
async def portal_get_invoice_detail(token: str, invoice_id: str):
    """Client portal: View invoice detail."""
    config = await db.portal_configs.find_one({"access_tokens.token": token, "enabled": True}, {"_id": 0})
    if not config:
        raise HTTPException(status_code=404, detail="Portal not found")
    invoice = await db.invoices.find_one(
        {"id": invoice_id, "client_id": config["client_id"]}, {"_id": 0}
    )
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return invoice


@router.get("/portal-api/{token}/devices/health")
async def portal_get_device_health(token: str):
    """Client portal: View device health summary."""
    config = await db.portal_configs.find_one({"access_tokens.token": token, "enabled": True}, {"_id": 0})
    if not config:
        raise HTTPException(status_code=404, detail="Portal not found")
    devices = await db.devices.find(
        {"client_id": config["client_id"]},
        {"_id": 0, "id": 1, "name": 1, "device_type": 1, "os": 1, "status": 1,
         "cpu_usage": 1, "memory_usage": 1, "disk_usage": 1, "last_seen": 1, "ip_address": 1}
    ).to_list(200)
    total = len(devices)
    online = len([d for d in devices if d.get("status") == "online"])
    offline = len([d for d in devices if d.get("status") == "offline"])
    warning = len([d for d in devices if d.get("status") == "warning"])
    return {"total": total, "online": online, "offline": offline, "warning": warning, "devices": devices}


@router.get("/portal-api/{token}/summary")
async def portal_get_summary(token: str):
    """Client portal: Get full client summary (devices, tickets, invoices, health)."""
    config = await db.portal_configs.find_one({"access_tokens.token": token, "enabled": True}, {"_id": 0})
    if not config:
        raise HTTPException(status_code=404, detail="Portal not found")
    cid = config["client_id"]
    client = await db.clients.find_one({"id": cid}, {"_id": 0, "id": 1, "name": 1, "email": 1, "mrr": 1})
    devices = await db.devices.find({"client_id": cid}, {"_id": 0, "status": 1}).to_list(500)
    tickets = await db.tickets.find({"client_id": cid}, {"_id": 0, "status": 1, "priority": 1}).to_list(500)
    invoices = await db.invoices.find({"client_id": cid}, {"_id": 0, "payment_status": 1, "amount_due": 1, "total": 1}).to_list(500)

    return {
        "client": client,
        "devices": {"total": len(devices), "online": len([d for d in devices if d.get("status") == "online"]), "offline": len([d for d in devices if d.get("status") == "offline"])},
        "tickets": {"total": len(tickets), "open": len([t for t in tickets if t.get("status") not in ("closed", "resolved")]), "critical": len([t for t in tickets if t.get("priority") == "critical"])},
        "invoices": {"total": len(invoices), "outstanding": round(sum(i.get("amount_due", 0) for i in invoices if i.get("payment_status") != "paid"), 2), "paid": len([i for i in invoices if i.get("payment_status") == "paid"])},
    }

