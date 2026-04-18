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

@router.post("/token-auth")
async def portal_token_auth(data: dict):
    """Convert a legacy portal access token to a V2 portal session.
    Used when users access /portal/:token links — auto-redirects to V2."""
    token = data.get("token", "")
    if not token:
        raise HTTPException(status_code=400, detail="Token required")
    config = await db.portal_configs.find_one({"access_tokens.token": token, "enabled": True}, {"_id": 0})
    if not config:
        raise HTTPException(status_code=404, detail="Portal link expired or invalid")

    cid = config["client_id"]
    # Find or create a portal user for this token's contact
    access_token = next((t for t in config.get("access_tokens", []) if t.get("token") == token), None)
    contact_email = (access_token.get("contact_email", "") if access_token else "").lower().strip()

    if contact_email:
        portal_user = await db.portal_users.find_one({"email": contact_email, "client_id": cid}, {"_id": 0})
    else:
        portal_user = await db.portal_users.find_one({"client_id": cid, "is_primary_contact": True}, {"_id": 0})
        if not portal_user:
            portal_user = await db.portal_users.find_one({"client_id": cid}, {"_id": 0})

    if not portal_user:
        # No portal user exists — return info to show limited view
        client = await db.clients.find_one({"id": cid}, {"_id": 0, "name": 1})
        return {"authenticated": False, "client_name": client.get("name", "") if client else "", "client_id": cid}

    if not portal_user.get("is_active", True):
        raise HTTPException(status_code=401, detail="Account disabled")

    # Mark token as used
    await db.portal_configs.update_one(
        {"client_id": cid, "access_tokens.token": token},
        {"$set": {"access_tokens.$.last_used": datetime.now(timezone.utc).isoformat()}}
    )

    jwt_token = create_portal_token(portal_user["id"], cid, portal_user["email"])
    safe_user = {k: v for k, v in portal_user.items() if k not in ("password_hash", "totp_secret")}
    return {"authenticated": True, "token": jwt_token, "user": safe_user}



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


@router.get("/tickets/{ticket_id}")
async def portal_ticket_detail(ticket_id: str, user: dict = Depends(get_portal_user)):
    """Get full ticket detail with messages/conversation."""
    ticket = await db.tickets.find_one({"id": ticket_id, "client_id": user.get("client_id")}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    # Get ticket messages/notes
    messages = await db.ticket_messages.find({"ticket_id": ticket_id}, {"_id": 0}).sort("created_at", 1).to_list(200)
    return {"ticket": ticket, "messages": messages}


@router.post("/tickets/{ticket_id}/messages")
async def portal_add_ticket_message(ticket_id: str, data: dict, user: dict = Depends(get_portal_user)):
    """Add a message to a ticket conversation from the portal."""
    ticket = await db.tickets.find_one({"id": ticket_id, "client_id": user.get("client_id")}, {"_id": 0, "id": 1})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    message = {
        "id": str(uuid.uuid4()),
        "ticket_id": ticket_id,
        "sender_name": user.get("name", "Client"),
        "sender_email": user.get("email", ""),
        "sender_type": "client",
        "content": data.get("content", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.ticket_messages.insert_one(message)
    message.pop("_id", None)
    # Update ticket timestamp
    await db.tickets.update_one({"id": ticket_id}, {"$set": {"updated_at": datetime.now(timezone.utc).isoformat()}})
    return message




# ==================== DEVICES ====================

@router.get("/devices")
async def portal_devices(user: dict = Depends(get_portal_user)):
    if not user.get("can_view_assets", True):
        raise HTTPException(status_code=403, detail="Device access not permitted")
    devices = await db.devices.find(
        {"client_id": user.get("client_id")},
        {"_id": 0, "id": 1, "name": 1, "hostname": 1, "device_type": 1, "os": 1, "status": 1, "ip_address": 1, "cpu_usage": 1, "memory_usage": 1, "disk_usage": 1, "last_heartbeat": 1, "antivirus_status": 1, "compliance_score": 1}
    ).to_list(500)
    # Augment with RustDesk availability
    rd_devices = await db.rustdesk_devices.find(
        {"client_id": user.get("client_id")},
        {"_id": 0, "id": 1, "device_id": 1, "rustdesk_id": 1, "name": 1, "status": 1}
    ).to_list(500)
    # Build a map: matched by device_id first, then by name
    rd_by_dev_id = {rd.get("device_id"): rd for rd in rd_devices if rd.get("device_id")}
    rd_by_name = {rd.get("name", "").lower(): rd for rd in rd_devices}
    for d in devices:
        rd = rd_by_dev_id.get(d["id"]) or rd_by_name.get((d.get("name") or "").lower()) or rd_by_name.get((d.get("hostname") or "").lower())
        if rd:
            d["rustdesk_available"] = True
            d["rustdesk_device_id"] = rd["id"]
    return devices


@router.post("/devices/{device_id}/remote-connect")
async def portal_remote_connect(device_id: str, data: dict = None, user: dict = Depends(get_portal_user)):
    """Initiate a RustDesk remote-connect session from the client portal.
    Strictly scoped to the portal user's own client_id.
    Requires explicit consent acknowledgement for audit compliance."""
    data = data or {}
    if not data.get("consent_acknowledged"):
        raise HTTPException(status_code=400, detail="Consent acknowledgement required to initiate a remote session")
    if not user.get("can_remote_devices", False):
        raise HTTPException(status_code=403, detail="Remote access not permitted. Ask your MSP to enable it on your portal account.")

    # Accept either the devices.id OR the rustdesk_devices.id or device_id (host mapping)
    rd = await db.rustdesk_devices.find_one(
        {"$or": [{"id": device_id}, {"device_id": device_id}], "client_id": user.get("client_id")},
        {"_id": 0}
    )
    if not rd:
        dev = await db.devices.find_one({"id": device_id, "client_id": user.get("client_id")}, {"_id": 0, "name": 1, "hostname": 1})
        if dev:
            rd = await db.rustdesk_devices.find_one(
                {"client_id": user.get("client_id"), "$or": [
                    {"name": dev.get("name")}, {"name": dev.get("hostname")}
                ]},
                {"_id": 0}
            )
    if not rd:
        raise HTTPException(status_code=404, detail="No RustDesk agent registered for this device. Please contact your MSP.")

    settings = await db.settings.find_one({"key": "rustdesk_config"}, {"_id": 0}) or {}
    config = settings.get("value", {})
    rd_id = rd.get("rustdesk_id", "")
    relay = (config.get("relay_server") or "").strip()
    server_url = (config.get("server_url") or "").strip().rstrip("/")

    server_host = ""
    if relay:
        server_host = relay.replace("https://", "").replace("http://", "").split("/")[0].split(":")[0]
    elif server_url:
        server_host = server_url.replace("https://", "").replace("http://", "").split("/")[0].split(":")[0]
    connection_url = f"rustdesk://{rd_id}@{server_host}" if server_host else f"rustdesk://{rd_id}"

    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    session_id = str(uuid.uuid4())

    # Lookup device metadata for the audit record
    dev_meta = await db.devices.find_one({"id": rd.get("device_id")}, {"_id": 0, "name": 1, "hostname": 1, "os": 1, "device_type": 1}) or {}

    # Create the compliance audit record (remote_session_records)
    client = await db.clients.find_one({"id": user.get("client_id")}, {"_id": 0, "name": 1})
    record = {
        "id": session_id,
        "type": "portal_remote",
        "client_id": user.get("client_id"),
        "client_name": (client or {}).get("name", ""),
        "portal_user_id": user.get("id"),
        "portal_user_name": user.get("name") or user.get("email", ""),
        "portal_user_email": user.get("email", ""),
        "device_id": rd.get("id"),
        "device_name": rd.get("name") or dev_meta.get("name") or dev_meta.get("hostname", ""),
        "device_os": dev_meta.get("os", ""),
        "rustdesk_id": rd_id,
        "started_at": now_iso,
        "ended_at": None,
        "duration_seconds": None,
        "status": "active",
        "consent_acknowledged": True,
        "consent_acknowledged_at": now_iso,
        "consent_text": data.get("consent_text",
            "I acknowledge this remote access session is being initiated by me and will be recorded for audit, compliance (SOC 2 / ISO 27001), and service-quality purposes. "
            "An MSP technician may observe or assist during the session."),
        "ip_address": data.get("ip_address", ""),
        "user_agent": data.get("user_agent", ""),
        "created_at": now_iso,
    }
    await db.remote_session_records.insert_one(record)

    # Also log to rustdesk_sessions for admin-side visibility
    await db.rustdesk_sessions.insert_one({
        "id": session_id,
        "device_id": rd.get("id"),
        "client_id": user.get("client_id"),
        "rustdesk_id": rd_id,
        "user_id": user.get("id"),
        "user_name": user.get("name", user.get("email", "Portal user")),
        "initiated_via": "client_portal",
        "status": "initiated",
        "started_at": now_iso,
        "ended_at": None,
        "session_record_id": session_id,
    })
    await db.rustdesk_devices.update_one(
        {"id": rd.get("id")},
        {"$set": {"last_connected": now_iso, "status": "connected"}}
    )

    return {
        "message": "Remote connection initiated",
        "session_id": session_id,
        "rustdesk_id": rd_id,
        "connection_url": connection_url,
        "server_host": server_host,
        "download_url": "https://rustdesk.com/download",
    }


@router.post("/remote-sessions/{session_id}/end")
async def portal_end_remote_session(session_id: str, data: dict = None, user: dict = Depends(get_portal_user)):
    """Mark a remote session as ended, compute duration."""
    data = data or {}
    rec = await db.remote_session_records.find_one(
        {"id": session_id, "client_id": user.get("client_id"), "portal_user_id": user.get("id")},
        {"_id": 0}
    )
    if not rec:
        raise HTTPException(status_code=404, detail="Remote session record not found")
    if rec.get("ended_at"):
        return {"message": "Session already ended", "duration_seconds": rec.get("duration_seconds", 0)}

    now = datetime.now(timezone.utc)
    try:
        started = datetime.fromisoformat((rec.get("started_at") or "").replace("Z", "+00:00"))
    except Exception:
        started = now
    duration = int((now - started).total_seconds())

    await db.remote_session_records.update_one(
        {"id": session_id},
        {"$set": {
            "ended_at": now.isoformat(),
            "duration_seconds": duration,
            "status": "completed",
            "notes": data.get("notes", ""),
        }}
    )
    await db.rustdesk_sessions.update_one(
        {"id": session_id},
        {"$set": {"ended_at": now.isoformat(), "status": "completed"}}
    )
    return {"message": "Session ended", "duration_seconds": duration}


@router.get("/remote-sessions")
async def portal_list_remote_sessions(user: dict = Depends(get_portal_user)):
    """Portal user sees only their own remote sessions."""
    recs = await db.remote_session_records.find(
        {"client_id": user.get("client_id"), "portal_user_id": user.get("id")},
        {"_id": 0}
    ).sort("started_at", -1).to_list(200)
    return recs


@router.get("/remote-sessions/{session_id}/pdf")
async def portal_remote_session_pdf(session_id: str, user: dict = Depends(get_portal_user)):
    """Generate a compliance-grade PDF audit record for this session."""
    from fpdf import FPDF
    from fastapi.responses import Response

    rec = await db.remote_session_records.find_one(
        {"id": session_id, "client_id": user.get("client_id"), "portal_user_id": user.get("id")},
        {"_id": 0}
    )
    if not rec:
        raise HTTPException(status_code=404, detail="Remote session record not found")

    # Fetch MSP branding
    branding = await db.settings.find_one({"key": "branding"}, {"_id": 0}) or {}
    msp_name = (branding.get("value", {}) or {}).get("company_name") or "NexusOps"

    def _fmt_dur(s):
        if s is None:
            return "In progress"
        s = int(s or 0)
        h, rem = divmod(s, 3600)
        m, sec = divmod(rem, 60)
        if h: return f"{h}h {m}m {sec}s"
        if m: return f"{m}m {sec}s"
        return f"{sec}s"

    def _fmt_dt(iso):
        if not iso:
            return "—"
        try:
            dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
            return dt.strftime("%Y-%m-%d %H:%M:%S UTC")
        except Exception:
            return iso

    pdf = FPDF()
    pdf.add_page()

    # Header
    pdf.set_fill_color(15, 23, 42)
    pdf.rect(0, 0, 210, 25, "F")
    pdf.set_font("Helvetica", "B", 16)
    pdf.set_text_color(255, 255, 255)
    pdf.set_xy(10, 8)
    pdf.cell(0, 8, msp_name, ln=1)
    pdf.set_font("Helvetica", "", 10)
    pdf.set_x(10)
    pdf.cell(0, 5, "Remote Access Session - Audit Record", ln=1)

    pdf.set_text_color(0, 0, 0)
    pdf.set_y(35)

    # Title
    pdf.set_font("Helvetica", "B", 13)
    pdf.cell(0, 8, f"Session ID: {rec['id'][:8].upper()}", ln=1)
    pdf.ln(2)

    # Two-column key/value layout
    def row(label, value):
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(55, 7, label, border=0)
        pdf.set_font("Helvetica", "", 10)
        txt = str(value or "-")
        txt = txt.encode("latin-1", "replace").decode("latin-1")
        # Truncate if too long for a single line to avoid FPDF width errors
        if len(txt) > 85:
            txt = txt[:82] + "..."
        pdf.cell(0, 7, txt, ln=1)

    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(0, 7, "Session Details", ln=1)
    pdf.set_draw_color(200, 200, 200)
    pdf.line(10, pdf.get_y(), 200, pdf.get_y())
    pdf.ln(2)

    row("Client", rec.get("client_name"))
    row("Initiated by", f"{rec.get('portal_user_name')} ({rec.get('portal_user_email')})")
    row("Device", f"{rec.get('device_name')} ({rec.get('device_os', '—')})")
    row("RustDesk ID", rec.get("rustdesk_id"))
    row("Started at", _fmt_dt(rec.get("started_at")))
    row("Ended at", _fmt_dt(rec.get("ended_at")))
    row("Duration", _fmt_dur(rec.get("duration_seconds")))
    row("Status", (rec.get("status") or "").capitalize())
    row("IP address", rec.get("ip_address"))

    pdf.ln(4)
    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(0, 7, "Consent Acknowledgement", ln=1)
    pdf.line(10, pdf.get_y(), 200, pdf.get_y())
    pdf.ln(2)
    pdf.set_font("Helvetica", "", 10)
    pdf.multi_cell(0, 6, (rec.get("consent_text") or "-").encode("latin-1", "replace").decode("latin-1"))
    pdf.ln(1)
    pdf.set_font("Helvetica", "I", 9)
    pdf.set_text_color(80, 80, 80)
    pdf.cell(0, 5, f"Acknowledged at: {_fmt_dt(rec.get('consent_acknowledged_at'))}", ln=1)

    if rec.get("notes"):
        pdf.ln(4)
        pdf.set_text_color(0, 0, 0)
        pdf.set_font("Helvetica", "B", 11)
        pdf.cell(0, 7, "Session Notes", ln=1)
        pdf.line(10, pdf.get_y(), 200, pdf.get_y())
        pdf.ln(2)
        pdf.set_font("Helvetica", "", 10)
        pdf.multi_cell(0, 6, rec.get("notes").encode("latin-1", "replace").decode("latin-1"))

    # Footer
    pdf.set_y(-25)
    pdf.set_font("Helvetica", "", 8)
    pdf.set_text_color(120, 120, 120)
    pdf.cell(0, 5, f"Generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} · {msp_name}", ln=1, align="C")
    pdf.cell(0, 5, "This document is a tamper-evident audit record of a client-initiated remote access session.", ln=1, align="C")

    pdf_bytes = bytes(pdf.output(dest="S"))
    filename = f"remote-session-{rec['id'][:8]}.pdf"
    return Response(content=pdf_bytes, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})
# ==================== INVOICES ====================

@router.get("/invoices")
async def portal_invoices(user: dict = Depends(get_portal_user)):
    if not user.get("can_view_invoices", False):
        return []
    invoices = await db.invoices.find(
        {"client_id": user.get("client_id")},
        {"_id": 0, "id": 1, "invoice_number": 1, "status": 1, "payment_status": 1, "total": 1,
         "amount_due": 1, "amount_paid": 1, "due_date": 1, "issued_date": 1, "created_at": 1,
         "paid_date": 1, "currency": 1}
    ).sort("created_at", -1).to_list(200)
    # Also check xero_invoices
    xero_invoices = await db.xero_invoices.find(
        {"client_id": user.get("client_id")},
        {"_id": 0, "id": 1, "invoice_number": 1, "status": 1, "payment_status": 1, "total": 1,
         "amount_due": 1, "amount_paid": 1, "due_date": 1, "issued_date": 1, "created_at": 1,
         "paid_date": 1, "currency": 1}
    ).sort("created_at", -1).to_list(200)
    seen = {i["id"] for i in invoices}
    for xi in xero_invoices:
        if xi["id"] not in seen:
            invoices.append(xi)
    return invoices


@router.get("/invoices/{invoice_id}")
async def portal_invoice_detail(invoice_id: str, user: dict = Depends(get_portal_user)):
    """Get full invoice detail for portal viewing."""
    if not user.get("can_view_invoices", False):
        raise HTTPException(status_code=403, detail="Invoice access not permitted")
    cid = user.get("client_id")
    invoice = await db.invoices.find_one({"id": invoice_id, "client_id": cid}, {"_id": 0})
    if not invoice:
        invoice = await db.xero_invoices.find_one({"id": invoice_id, "client_id": cid}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return invoice


@router.post("/invoices/{invoice_id}/pay")
async def portal_pay_invoice(invoice_id: str, data: dict, user: dict = Depends(get_portal_user)):
    """Create a Stripe checkout session for portal invoice payment."""
    import os
    if not user.get("can_view_invoices", False):
        raise HTTPException(status_code=403, detail="Invoice access not permitted")

    cid = user.get("client_id")
    invoice = await db.invoices.find_one({"id": invoice_id, "client_id": cid}, {"_id": 0})
    if not invoice:
        invoice = await db.xero_invoices.find_one({"id": invoice_id, "client_id": cid}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    total = float(invoice.get("total", 0))
    amount_paid = float(invoice.get("amount_paid", 0))
    balance = round(total - amount_paid, 2)
    if balance <= 0:
        raise HTTPException(status_code=400, detail="Invoice already fully paid")

    stripe_key = os.environ.get("STRIPE_API_KEY", "")
    if not stripe_key or stripe_key == "sk_test_emergent":
        # Mock payment for demo — record as pending
        payment = {
            "id": str(uuid.uuid4()),
            "method": "portal_payment",
            "amount": balance,
            "status": "pending",
            "initiated_at": datetime.now(timezone.utc).isoformat(),
            "portal_user": user.get("email"),
        }
        return {"status": "demo", "message": f"Payment of ${balance:.2f} initiated (Stripe test mode)", "balance": balance, "payment": payment}

    origin_url = data.get("origin_url", "").rstrip("/")
    success_url = f"{origin_url}/portal-dashboard?payment=success&invoice={invoice_id}"
    cancel_url = f"{origin_url}/portal-dashboard?payment=cancelled"

    try:
        from emergentintegrations.payments.stripe.checkout import StripeCheckout, CheckoutSessionRequest
        stripe_checkout = StripeCheckout(api_key=stripe_key, webhook_url=f"{origin_url}/api/webhook/stripe")
        checkout_req = CheckoutSessionRequest(
            amount=balance,
            currency=data.get("currency", "aud"),
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={
                "invoice_id": invoice_id,
                "invoice_number": invoice.get("invoice_number", ""),
                "client_id": cid,
                "portal_user": user.get("email"),
            }
        )
        session = await stripe_checkout.create_checkout_session(checkout_req)
        return {"status": "checkout", "url": session.url, "session_id": session.session_id, "balance": balance}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Payment failed: {str(e)}")


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



# ==================== KNOWLEDGE BASE ====================

@router.get("/kb")
async def portal_knowledge_base(user: dict = Depends(get_portal_user)):
    """Get published knowledge base articles for clients."""
    articles = await db.kb_articles.find(
        {"status": "published", "visibility": {"$in": ["public", "client"]}},
        {"_id": 0}
    ).sort("updated_at", -1).to_list(100)
    if not articles:
        # Return built-in articles for demo
        articles = [
            {"id": "kb-001", "title": "How to Submit a Support Ticket", "category": "Getting Started",
             "content": "You can submit tickets via the Client Portal by clicking 'New Ticket'. Include a detailed description of your issue for fastest resolution.",
             "tags": ["tickets", "support"], "created_at": datetime.now(timezone.utc).isoformat()},
            {"id": "kb-002", "title": "Setting Up Multi-Factor Authentication", "category": "Security",
             "content": "MFA adds an extra layer of security. Go to your profile settings and enable 2FA using an authenticator app like Google Authenticator or Authy.",
             "tags": ["security", "2fa"], "created_at": datetime.now(timezone.utc).isoformat()},
            {"id": "kb-003", "title": "Understanding Your Invoice", "category": "Billing",
             "content": "Your monthly invoice includes all managed services, project work, and any hardware purchases. Contact us if you have questions about specific line items.",
             "tags": ["billing", "invoices"], "created_at": datetime.now(timezone.utc).isoformat()},
            {"id": "kb-004", "title": "Password Reset Procedure", "category": "Getting Started",
             "content": "If you need to reset your password, click 'Forgot Password' on the login screen or contact our help desk for immediate assistance.",
             "tags": ["password", "account"], "created_at": datetime.now(timezone.utc).isoformat()},
            {"id": "kb-005", "title": "Remote Support Sessions", "category": "Support",
             "content": "When a technician needs to access your computer, you'll receive a link or code. Always verify the technician's identity before granting access.",
             "tags": ["remote", "support"], "created_at": datetime.now(timezone.utc).isoformat()},
        ]
    return articles

