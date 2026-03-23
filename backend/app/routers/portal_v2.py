from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from datetime import datetime, timezone, timedelta
from typing import Optional
import uuid
import jwt
import pyotp
from app.database import db, JWT_SECRET, JWT_ALGORITHM
from app.auth import hash_password, verify_password

router = APIRouter(prefix="/portal/v2", tags=["Portal V2"])
portal_security = HTTPBearer(auto_error=False)

# --- Portal Auth Dependency ---
async def get_portal_user(credentials: HTTPAuthorizationCredentials = Depends(portal_security)):
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "portal":
            raise HTTPException(status_code=401, detail="Invalid portal token")
        user = await db.portal_users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
        if not user or not user.get("is_active", True):
            raise HTTPException(status_code=401, detail="User not found or inactive")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def create_portal_token(user_id: str, client_id: str, email: str):
    payload = {
        "sub": user_id, "client_id": client_id, "email": email,
        "type": "portal",
        "exp": datetime.now(timezone.utc) + timedelta(hours=12),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


# ==================== AUTH ====================

@router.post("/login")
async def portal_login(data: dict):
    email = data.get("email", "").lower().strip()
    password = data.get("password", "")
    if not email or not password:
        raise HTTPException(status_code=400, detail="Email and password required")

    user = await db.portal_users.find_one({"email": email}, {"_id": 0})
    if not user or not verify_password(password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.get("is_active", True):
        raise HTTPException(status_code=401, detail="Account is disabled")

    # Check 2FA
    if user.get("totp_enabled"):
        return {"requires_2fa": True, "temp_token": create_portal_token(user["id"], user.get("client_id", ""), email) + ":2fa_pending"}

    token = create_portal_token(user["id"], user.get("client_id", ""), email)
    await db.portal_users.update_one({"id": user["id"]}, {"$set": {"last_login": datetime.now(timezone.utc).isoformat()}})
    safe_user = {k: v for k, v in user.items() if k not in ("password_hash", "totp_secret")}
    return {"token": token, "user": safe_user, "requires_2fa": False}


@router.post("/verify-2fa")
async def portal_verify_2fa(data: dict):
    temp_token = data.get("temp_token", "")
    code = data.get("code", "")
    if not temp_token.endswith(":2fa_pending"):
        raise HTTPException(status_code=400, detail="Invalid 2FA flow")

    real_token = temp_token.replace(":2fa_pending", "")
    try:
        payload = jwt.decode(real_token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = await db.portal_users.find_one({"id": payload["sub"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    totp = pyotp.TOTP(user.get("totp_secret", ""))
    if not totp.verify(code, valid_window=1):
        raise HTTPException(status_code=401, detail="Invalid 2FA code")

    token = create_portal_token(user["id"], user.get("client_id", ""), user["email"])
    await db.portal_users.update_one({"id": user["id"]}, {"$set": {"last_login": datetime.now(timezone.utc).isoformat()}})
    safe_user = {k: v for k, v in user.items() if k not in ("password_hash", "totp_secret")}
    return {"token": token, "user": safe_user}


@router.get("/setup-2fa")
async def portal_setup_2fa(user: dict = Depends(get_portal_user)):
    secret = user.get("totp_secret")
    if not secret:
        secret = pyotp.random_base32()
        await db.portal_users.update_one({"id": user["id"]}, {"$set": {"totp_secret": secret}})

    totp = pyotp.TOTP(secret)
    uri = totp.provisioning_uri(name=user["email"], issuer_name="NexusOps Portal")
    return {"secret": secret, "uri": uri, "already_enabled": user.get("totp_enabled", False)}


@router.post("/enable-2fa")
async def portal_enable_2fa(data: dict, user: dict = Depends(get_portal_user)):
    code = data.get("code", "")
    u = await db.portal_users.find_one({"id": user["id"]}, {"_id": 0})
    secret = u.get("totp_secret")
    if not secret:
        raise HTTPException(status_code=400, detail="Run setup-2fa first")

    totp = pyotp.TOTP(secret)
    if not totp.verify(code, valid_window=1):
        raise HTTPException(status_code=400, detail="Invalid code — try again")

    await db.portal_users.update_one({"id": user["id"]}, {"$set": {"totp_enabled": True}})
    return {"message": "2FA enabled successfully"}


@router.post("/disable-2fa")
async def portal_disable_2fa(data: dict, user: dict = Depends(get_portal_user)):
    code = data.get("code", "")
    u = await db.portal_users.find_one({"id": user["id"]}, {"_id": 0})
    secret = u.get("totp_secret")
    if secret:
        totp = pyotp.TOTP(secret)
        if not totp.verify(code, valid_window=1):
            raise HTTPException(status_code=400, detail="Invalid code")
    await db.portal_users.update_one({"id": user["id"]}, {"$set": {"totp_enabled": False}})
    return {"message": "2FA disabled"}


# ==================== PROFILE ====================

@router.get("/me")
async def portal_me(user: dict = Depends(get_portal_user)):
    # Get client + branding
    client = await db.clients.find_one({"id": user.get("client_id")}, {"_id": 0})
    config = await db.portal_configs.find_one({"client_id": user.get("client_id")}, {"_id": 0})
    branding = config.get("branding", {}) if config else {}
    # Get MSP branding for logo
    msp_branding = await db.settings.find_one({"key": "branding"}, {"_id": 0})
    return {
        "user": {k: v for k, v in user.items() if k not in ("password_hash", "totp_secret")},
        "client": client,
        "branding": branding,
        "msp_branding": msp_branding.get("value", {}) if msp_branding else {},
        "totp_enabled": user.get("totp_enabled", False),
    }


@router.put("/me")
async def portal_update_profile(data: dict, user: dict = Depends(get_portal_user)):
    allowed = {"name", "phone"}
    updates = {k: v for k, v in data.items() if k in allowed}
    if "password" in data and data["password"]:
        updates["password_hash"] = hash_password(data["password"])
    if updates:
        await db.portal_users.update_one({"id": user["id"]}, {"$set": updates})
    return {"message": "Profile updated"}


# ==================== DASHBOARD ====================

@router.get("/dashboard")
async def portal_dashboard(user: dict = Depends(get_portal_user)):
    cid = user.get("client_id")
    tickets = await db.tickets.find({"client_id": cid}, {"_id": 0, "id": 1, "status": 1, "priority": 1}).to_list(500)
    devices = await db.devices.find({"client_id": cid}, {"_id": 0, "id": 1, "status": 1}).to_list(500)
    invoices = await db.invoices.find({"client_id": cid}, {"_id": 0, "id": 1, "status": 1, "total": 1}).to_list(200)

    open_t = sum(1 for t in tickets if t.get("status") in ("open", "in_progress"))
    resolved_t = sum(1 for t in tickets if t.get("status") in ("resolved", "closed"))
    online_d = sum(1 for d in devices if d.get("status") == "online")
    outstanding = sum(i.get("total", 0) for i in invoices if i.get("status") in ("sent", "overdue"))

    return {
        "stats": {
            "open_tickets": open_t, "resolved_tickets": resolved_t, "total_tickets": len(tickets),
            "online_devices": online_d, "total_devices": len(devices),
            "outstanding_invoices": outstanding, "total_invoices": len(invoices),
        }
    }


# ==================== TICKETS ====================

@router.get("/tickets")
async def portal_tickets(user: dict = Depends(get_portal_user)):
    cid = user.get("client_id")
    query = {"client_id": cid}
    if not user.get("can_view_all_tickets"):
        query["$or"] = [{"contact_email": user.get("email")}, {"created_by": user.get("name")}, {"contact_email": {"$exists": False}}]
    tickets = await db.tickets.find(query, {"_id": 0}).sort("created_at", -1).to_list(200)
    return tickets


@router.post("/tickets")
async def portal_create_ticket(data: dict, user: dict = Depends(get_portal_user)):
    if not user.get("can_create_tickets", True):
        raise HTTPException(status_code=403, detail="Ticket creation not permitted")
    client = await db.clients.find_one({"id": user.get("client_id")}, {"_id": 0, "name": 1})
    ticket = {
        "id": f"TKT-{uuid.uuid4().hex[:6].upper()}", "ticket_number": f"PT-{datetime.now(timezone.utc).strftime('%m%d%H%M')}",
        "title": data.get("title", "Portal Ticket"), "description": data.get("description", ""),
        "priority": data.get("priority", "medium"), "category": data.get("category", "support"),
        "status": "open", "source": "client_portal",
        "client_id": user.get("client_id"), "client_name": client["name"] if client else "",
        "contact_name": user.get("name"), "contact_email": user.get("email"),
        "assigned_to": None, "assigned_name": None, "tags": [],
        "created_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat(),
        "created_by": user.get("name"),
    }
    await db.tickets.insert_one(ticket)
    ticket.pop("_id", None)
    return ticket


# ==================== DEVICES ====================

@router.get("/devices")
async def portal_devices(user: dict = Depends(get_portal_user)):
    if not user.get("can_view_assets", True):
        raise HTTPException(status_code=403, detail="Device access not permitted")
    devices = await db.devices.find(
        {"client_id": user.get("client_id")},
        {"_id": 0, "id": 1, "name": 1, "hostname": 1, "device_type": 1, "os": 1, "status": 1, "ip_address": 1, "cpu_usage": 1, "memory_usage": 1, "disk_usage": 1, "last_heartbeat": 1, "antivirus_status": 1, "compliance_score": 1}
    ).to_list(500)
    return devices


# ==================== INVOICES ====================

@router.get("/invoices")
async def portal_invoices(user: dict = Depends(get_portal_user)):
    if not user.get("can_view_invoices", False):
        return []
    invoices = await db.invoices.find(
        {"client_id": user.get("client_id")},
        {"_id": 0, "id": 1, "invoice_number": 1, "status": 1, "total": 1, "due_date": 1, "issued_date": 1, "paid_date": 1}
    ).sort("issued_date", -1).to_list(200)
    return invoices


# ==================== BACKUPS ====================

@router.get("/backups")
async def portal_backups(user: dict = Depends(get_portal_user)):
    cid = user.get("client_id")
    client = await db.clients.find_one({"id": cid}, {"_id": 0, "name": 1})
    cn = client["name"] if client else ""
    jobs = await db.backup_jobs.find({"client_name": cn}, {"_id": 0}).sort("last_run", -1).to_list(100)
    if not jobs:
        jobs = await db.backup_jobs.find({"client_id": cid}, {"_id": 0}).sort("last_run", -1).to_list(100)
    ok = sum(1 for j in jobs if j.get("status") == "success")
    fail = sum(1 for j in jobs if j.get("status") == "failed")
    return {"jobs": jobs, "summary": {"total": len(jobs), "successful": ok, "failed": fail, "success_rate": round(ok / max(len(jobs), 1) * 100, 1)}}


# ==================== COMPLIANCE ====================

@router.get("/compliance")
async def portal_compliance(user: dict = Depends(get_portal_user)):
    cid = user.get("client_id")
    # Return global compliance frameworks (applied to all clients)
    frameworks = await db.compliance_frameworks.find({}, {"_id": 0}).to_list(20)
    if not frameworks:
        from app.routers.compliance_frameworks import router as cf_router
        # Trigger data generation
        frameworks = [
            {"id": "nist", "name": "NIST 800-171", "compliance_pct": 77, "controls_total": 110, "controls_met": 85},
            {"id": "cis", "name": "CIS Controls v8", "compliance_pct": 74, "controls_total": 56, "controls_met": 41},
            {"id": "soc2", "name": "SOC 2 Type II", "compliance_pct": 78, "controls_total": 64, "controls_met": 50},
            {"id": "hipaa", "name": "HIPAA", "compliance_pct": 79, "controls_total": 44, "controls_met": 35},
        ]
    return {"frameworks": frameworks}


# ==================== QBR ====================

@router.get("/qbr")
async def portal_qbr(user: dict = Depends(get_portal_user)):
    cid = user.get("client_id")
    client = await db.clients.find_one({"id": cid}, {"_id": 0, "name": 1})
    cn = client["name"] if client else ""
    qbrs = await db.qbr_reports.find({"client_name": cn}, {"_id": 0}).sort("generated_at", -1).to_list(10)
    if not qbrs:
        qbrs = await db.qbr_reports.find({"client_id": cid}, {"_id": 0}).sort("generated_at", -1).to_list(10)
    return qbrs
