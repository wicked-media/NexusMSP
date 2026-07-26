from fastapi import APIRouter, HTTPException, Depends, Query
from datetime import datetime, timezone, timedelta
import uuid
import secrets
from app.database import db
from app.auth import get_current_user
from app.routers.email_utils import send_email, is_microsoft365_configured
from app.services.portal_audit import record_portal_event

router = APIRouter()


async def _client_identity(client_id: str) -> dict:
    return await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1, "name": 1}) or {
        "id": client_id,
        "name": "Unknown client",
    }


def _require_portal_audit_access(current_user: dict) -> None:
    if current_user.get("role") not in {"admin", "owner", "super_admin"} and not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Administrator access is required to view portal audit history")


def _portal_welcome_email_html(name, email, password, company_name, portal_url, msp_name, primary_color):
    """Generate branded HTML welcome email for portal users."""
    return f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #0f172a; color: #e2e8f0; border-radius: 12px; overflow: hidden;">
      <div style="background: {primary_color}; padding: 24px 32px;">
        <h1 style="margin: 0; font-size: 20px; color: #fff;">{msp_name}</h1>
        <p style="margin: 4px 0 0; font-size: 13px; color: rgba(255,255,255,0.8);">Client Portal Access</p>
      </div>
      <div style="padding: 32px;">
        <h2 style="margin: 0 0 8px; font-size: 18px; color: #f8fafc;">Welcome, {name or 'there'}!</h2>
        <p style="color: #94a3b8; font-size: 14px; line-height: 1.6;">
          Your IT portal account for <strong style="color: #f8fafc;">{company_name}</strong> has been created.
          You can now log in to view your tickets, devices, invoices, and more.
        </p>
        <div style="background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 20px; margin: 24px 0;">
          <p style="margin: 0 0 12px; font-size: 13px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;">Your Login Credentials</p>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 6px 0; color: #94a3b8; font-size: 13px;">Email:</td><td style="padding: 6px 0; color: #f8fafc; font-size: 14px; font-weight: 600;">{email}</td></tr>
            <tr><td style="padding: 6px 0; color: #94a3b8; font-size: 13px;">Password:</td><td style="padding: 6px 0; color: {primary_color}; font-size: 14px; font-family: monospace; font-weight: 600;">{password}</td></tr>
          </table>
        </div>
        <a href="{portal_url}" style="display: inline-block; background: {primary_color}; color: #fff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">Log In to Portal</a>
        <div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid #1e293b;">
          <p style="color: #64748b; font-size: 12px; margin: 0;">For security, we recommend changing your password after your first login.</p>
          <p style="color: #64748b; font-size: 12px; margin: 8px 0 0;">If you didn't expect this email, please contact your IT provider.</p>
        </div>
      </div>
      <div style="background: #0c1222; padding: 16px 32px; text-align: center;">
        <p style="color: #475569; font-size: 11px; margin: 0;">Powered by {msp_name}</p>
      </div>
    </div>
    """


def _password_reset_email_html(name, email, password, msp_name, portal_url, primary_color):
    """Generate branded HTML password reset email."""
    return f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #0f172a; color: #e2e8f0; border-radius: 12px; overflow: hidden;">
      <div style="background: {primary_color}; padding: 24px 32px;">
        <h1 style="margin: 0; font-size: 20px; color: #fff;">{msp_name}</h1>
        <p style="margin: 4px 0 0; font-size: 13px; color: rgba(255,255,255,0.8);">Password Reset</p>
      </div>
      <div style="padding: 32px;">
        <h2 style="margin: 0 0 8px; font-size: 18px; color: #f8fafc;">Password Reset</h2>
        <p style="color: #94a3b8; font-size: 14px; line-height: 1.6;">
          Hi {name or 'there'}, your portal password has been reset by your IT administrator.
        </p>
        <div style="background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 20px; margin: 24px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 6px 0; color: #94a3b8; font-size: 13px;">Email:</td><td style="padding: 6px 0; color: #f8fafc; font-size: 14px;">{email}</td></tr>
            <tr><td style="padding: 6px 0; color: #94a3b8; font-size: 13px;">New Password:</td><td style="padding: 6px 0; color: {primary_color}; font-size: 14px; font-family: monospace; font-weight: 600;">{password}</td></tr>
          </table>
        </div>
        <a href="{portal_url}" style="display: inline-block; background: {primary_color}; color: #fff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">Log In Now</a>
        <p style="color: #64748b; font-size: 12px; margin-top: 20px;">Please change your password after logging in.</p>
      </div>
    </div>
    """

# ============== PORTAL CONFIGURATION ==============


@router.get("/client-portal/access-logs")
async def get_portal_access_logs(
    client_id: str = Query(None),
    outcome: str = Query(None),
    days: int = Query(90, ge=1, le=3650),
    limit: int = Query(250, ge=1, le=1000),
    current_user: dict = Depends(get_current_user),
):
    """Return persisted portal authentication and administration evidence."""
    _require_portal_audit_access(current_user)
    query = {"timestamp": {"$gte": (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()}}
    if client_id:
        query["client_id"] = client_id
    if outcome in {"success", "failed", "blocked", "warning"}:
        query["outcome"] = outcome
    return await db.portal_access_logs.find(query, {"_id": 0}).sort("timestamp", -1).to_list(limit)


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
    client = await _client_identity(client_id)
    previous = await db.portal_configs.find_one({"client_id": client_id}, {"_id": 0}) or {}
    data["client_id"] = client_id
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.portal_configs.update_one({"client_id": client_id}, {"$set": data}, upsert=True)
    changed_features = sorted(
        key for key in set((previous.get("features") or {})) | set((data.get("features") or {}))
        if (previous.get("features") or {}).get(key) != (data.get("features") or {}).get(key)
    )
    await record_portal_event(
        action="portal_configuration_updated",
        client_id=client_id,
        client_name=client["name"],
        actor=current_user,
        details=f"Portal configuration updated for {client['name']}",
        metadata={
            "enabled_before": bool(previous.get("enabled", False)),
            "enabled_after": bool(data.get("enabled", False)),
            "changed_features": changed_features,
        },
    )
    return {"message": "Portal config updated"}

@router.post("/client-portal/generate-token/{client_id}")
async def generate_portal_token(client_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    client = await _client_identity(client_id)
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
    await record_portal_event(
        action="secure_link_generated",
        client_id=client_id,
        client_name=client["name"],
        actor=current_user,
        details=f"Secure portal link generated for {data.get('contact_name') or data.get('contact_email') or client['name']}",
        metadata={
            "link_id": token_entry["id"],
            "contact_email": data.get("contact_email", ""),
            "expires_at": token_entry["expires_at"],
        },
    )
    return {"token": token_value, "portal_url": f"/portal/{token_value}", "entry": token_entry}

@router.delete("/client-portal/tokens/{client_id}/{token_id}")
async def revoke_portal_token(client_id: str, token_id: str, current_user: dict = Depends(get_current_user)):
    client = await _client_identity(client_id)
    config = await db.portal_configs.find_one(
        {"client_id": client_id, "access_tokens.id": token_id},
        {"_id": 0, "access_tokens.$": 1},
    ) or {}
    token_entry = (config.get("access_tokens") or [{}])[0]
    await db.portal_configs.update_one(
        {"client_id": client_id},
        {"$pull": {"access_tokens": {"id": token_id}}}
    )
    await record_portal_event(
        action="secure_link_revoked",
        client_id=client_id,
        client_name=client["name"],
        actor=current_user,
        details=f"Secure portal link revoked for {token_entry.get('contact_name') or token_entry.get('contact_email') or client['name']}",
        metadata={"link_id": token_id, "contact_email": token_entry.get("contact_email", "")},
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
        "can_remote_devices": data.get("can_remote_devices", False),
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

    # Send welcome email
    send_welcome = data.get("send_welcome_email", True)
    if send_welcome and await is_microsoft365_configured():
        branding = await db.settings.find_one({"type": "branding"}, {"_id": 0}) or {}
        msp_name = branding.get("company_name", "NexusOps")
        primary_color = branding.get("primary_color", "#10b981")
        portal_url = data.get("portal_url", "")
        html = _portal_welcome_email_html(name, email, password, client["name"] if client else "", portal_url, msp_name, primary_color)
        result = await send_email(email, f"Welcome to {msp_name} Portal", html, category="notifications")
        safe["email_status"] = result.get("status", "unknown")
    else:
        safe["email_status"] = "skipped"

    await record_portal_event(
        action="portal_user_invited",
        client_id=client_id,
        client_name=client["name"] if client else "",
        actor=current_user,
        portal_user=safe,
        details=f"Portal access created for {name or email}",
        metadata={
            "role": user["role"],
            "welcome_email_status": safe["email_status"],
            "permissions": sorted(key for key in (
                "can_view_all_tickets",
                "can_create_tickets",
                "can_view_assets",
                "can_view_invoices",
                "can_remote_devices",
            ) if user.get(key)),
        },
    )
    return safe


@router.put("/client-portal/users/{client_id}/{user_id}")
async def update_portal_user(client_id: str, user_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Update a portal user's permissions and details."""
    from app.auth import hash_password

    user = await db.portal_users.find_one({"id": user_id, "client_id": client_id}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Portal user not found")

    allowed_fields = {"name", "phone", "role", "is_primary_contact", "can_view_all_tickets",
                      "can_create_tickets", "can_view_assets", "can_view_invoices", "can_remote_devices", "is_active"}
    updates = {k: v for k, v in data.items() if k in allowed_fields}
    if data.get("password"):
        updates["password_hash"] = hash_password(data["password"])
    if updates:
        updates["updated_at"] = datetime.now(timezone.utc).isoformat()
        await db.portal_users.update_one({"id": user_id}, {"$set": updates})
        await record_portal_event(
            action="portal_user_access_updated",
            client_id=client_id,
            client_name=user.get("client_name", ""),
            actor=current_user,
            portal_user=user,
            details=f"Portal access updated for {user.get('name') or user.get('email')}",
            metadata={
                "changed_fields": sorted(key for key in updates if key not in {"password_hash", "updated_at"}),
                "password_changed": bool(data.get("password")),
                "active_before": user.get("is_active", True),
                "active_after": updates.get("is_active", user.get("is_active", True)),
            },
        )
    return {"message": "Portal user updated"}


@router.delete("/client-portal/users/{client_id}/{user_id}")
async def delete_portal_user(client_id: str, user_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a portal user."""
    user = await db.portal_users.find_one({"id": user_id, "client_id": client_id}, {"_id": 0})
    result = await db.portal_users.delete_one({"id": user_id, "client_id": client_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Portal user not found")
    await record_portal_event(
        action="portal_user_removed",
        client_id=client_id,
        client_name=(user or {}).get("client_name", ""),
        actor=current_user,
        portal_user=user or {"id": user_id},
        details=f"Portal user {(user or {}).get('name') or (user or {}).get('email') or user_id} removed",
    )
    return {"message": "Portal user deleted"}


@router.post("/client-portal/users/{client_id}/{user_id}/reset-password")
async def reset_portal_user_password(client_id: str, user_id: str, data: dict = None, current_user: dict = Depends(get_current_user)):
    """Reset a portal user's password to a random one and optionally send email."""
    from app.auth import hash_password
    data = data or {}

    user = await db.portal_users.find_one(
        {"id": user_id, "client_id": client_id},
        {"_id": 0, "id": 1, "client_id": 1, "client_name": 1, "email": 1, "name": 1},
    )
    if not user:
        raise HTTPException(status_code=404, detail="Portal user not found")

    new_password = secrets.token_urlsafe(10)
    await db.portal_users.update_one({"id": user_id}, {"$set": {"password_hash": hash_password(new_password), "totp_enabled": False}})

    result = {"message": "Password reset", "temp_password": new_password, "email": user["email"]}

    # Send reset email
    if await is_microsoft365_configured():
        branding = await db.settings.find_one({"type": "branding"}, {"_id": 0}) or {}
        msp_name = branding.get("company_name", "NexusOps")
        primary_color = branding.get("primary_color", "#10b981")
        portal_url = data.get("portal_url", "")
        html = _password_reset_email_html(user.get("name", ""), user["email"], new_password, msp_name, portal_url, primary_color)
        email_result = await send_email(user["email"], f"{msp_name} - Password Reset", html, category="notifications")
        result["email_status"] = email_result.get("status", "unknown")

    await record_portal_event(
        action="portal_password_reset",
        client_id=client_id,
        client_name=user.get("client_name", ""),
        actor=current_user,
        portal_user=user,
        details=f"Portal password reset for {user.get('name') or user.get('email')}",
        metadata={"email_status": result.get("email_status", "skipped"), "mfa_reset": True},
    )
    return result



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

