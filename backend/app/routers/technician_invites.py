"""Technician Invite System - email invites with setup tokens"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user, hash_password, password_policy_error
from app.routers.email_utils import send_email, is_microsoft365_configured
import uuid
import os

router = APIRouter()

FRONTEND_URL = os.environ.get("FRONTEND_URL", "")


def _require_admin(current_user: dict):
    if current_user.get("role") != "admin" and not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Administrator access required")


def _build_invite_email_html(invite: dict, company_name: str = "NexusOps") -> str:
    """Build an HTML invitation email"""
    name = invite.get("name", "Technician")
    role = invite.get("role", "technician").replace("_", " ").title()
    job_title = invite.get("job_title", "")
    invited_by = invite.get("invited_by", "Admin")
    token = invite.get("token", "")

    setup_url = f"{FRONTEND_URL}/setup-account?token={token}" if FRONTEND_URL else f"#setup-token-{token}"

    return f"""
    <div style="max-width:600px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;background:#0f0f1a;color:#e0e0e0;border-radius:12px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#1a56db,#8b5cf6);padding:32px;text-align:center">
        <h1 style="margin:0;color:#fff;font-size:24px">Welcome to {company_name}!</h1>
        <p style="margin:8px 0 0;color:rgba(255,255,255,0.8);font-size:14px">You've been invited to join the team</p>
      </div>

      <div style="padding:32px">
        <p style="font-size:15px;line-height:1.6;margin:0 0 20px">Hi {name},</p>
        <p style="font-size:15px;line-height:1.6;margin:0 0 20px">
          <strong>{invited_by}</strong> has invited you to join <strong>{company_name}</strong> as a <strong>{role}</strong>{f' ({job_title})' if job_title else ''}.
        </p>

        <div style="background:#1a1a2e;border-radius:10px;padding:20px;margin:24px 0;border:1px solid #333">
          <p style="margin:0 0 12px;font-size:13px;color:#888;text-transform:uppercase;letter-spacing:1px">Your Details</p>
          <table style="width:100%;font-size:14px">
            <tr><td style="padding:4px 0;color:#888;width:100px">Name:</td><td style="padding:4px 0;font-weight:bold">{name}</td></tr>
            <tr><td style="padding:4px 0;color:#888">Email:</td><td style="padding:4px 0;font-weight:bold">{invite.get("email","")}</td></tr>
            <tr><td style="padding:4px 0;color:#888">Role:</td><td style="padding:4px 0;font-weight:bold">{role}</td></tr>
            {f'<tr><td style="padding:4px 0;color:#888">Title:</td><td style="padding:4px 0;font-weight:bold">{job_title}</td></tr>' if job_title else ''}
          </table>
        </div>

        <div style="text-align:center;margin:28px 0">
          <a href="{setup_url}" style="display:inline-block;background:linear-gradient(135deg,#1a56db,#8b5cf6);color:#fff;text-decoration:none;padding:14px 40px;border-radius:8px;font-size:15px;font-weight:bold">Accept Invitation & Set Up Account</a>
        </div>

        <p style="font-size:12px;color:#666;text-align:center;margin-top:20px">
          This invitation expires in 7 days. If you didn't expect this email, you can safely ignore it.
        </p>

        <div style="border-top:1px solid #333;margin-top:28px;padding-top:16px;text-align:center">
          <p style="margin:0;font-size:11px;color:#555">Sent by {company_name} via NexusOps</p>
        </div>
      </div>
    </div>
    """


@router.post("/technicians/invite")
async def invite_technician(data: dict, current_user: dict = Depends(get_current_user)):
    """Send an email invite to a new technician"""
    _require_admin(current_user)
    email = data.get("email", "").strip().lower()
    name = data.get("name", "").strip()
    if not email or not name:
        raise HTTPException(status_code=400, detail="Name and email are required")

    # Check for existing tech with this email
    existing = await db.users.find_one({"email": email}, {"_id": 0, "id": 1})
    if existing:
        raise HTTPException(status_code=409, detail="A technician with this email already exists")

    # Check for existing pending invite
    pending = await db.tech_invites.find_one({"email": email, "status": "pending"}, {"_id": 0})
    if pending:
        raise HTTPException(status_code=409, detail="An invitation for this email is already pending")

    token = uuid.uuid4().hex
    now = datetime.now(timezone.utc)
    invite = {
        "id": f"INV-{uuid.uuid4().hex[:6].upper()}",
        "token": token,
        "name": name,
        "email": email,
        "role": data.get("role", "technician"),
        "job_title": data.get("job_title", ""),
        "categories": data.get("categories", []),
        "hourly_rate": data.get("hourly_rate", 75),
        "message": data.get("message", ""),
        "status": "pending",
        "invited_by": current_user.get("name", "Admin"),
        "invited_by_id": current_user.get("id", ""),
        "created_at": now.isoformat(),
        "expires_at": (now + timedelta(days=7)).isoformat(),
    }

    await db.tech_invites.insert_one(invite)
    invite.pop("_id", None)

    # Send the email
    html = _build_invite_email_html(invite)
    subject = f"You're invited to join NexusOps as a {invite['role'].replace('_',' ').title()}"
    email_result = await send_email(email, subject, html, category="notifications")

    # Update invite with email status
    await db.tech_invites.update_one(
        {"id": invite["id"]},
        {"$set": {"email_status": email_result["status"], "email_id": email_result.get("email_id")}}
    )

    return {
        "invite": {k: v for k, v in invite.items() if k != "token"},
        "email": email_result,
        "email_configured": await is_microsoft365_configured(),
    }


@router.get("/technicians/invites")
async def list_invites(current_user: dict = Depends(get_current_user)):
    """List all technician invites"""
    _require_admin(current_user)
    invites = await db.tech_invites.find({}, {"_id": 0, "token": 0}).sort("created_at", -1).to_list(100)
    return invites


@router.delete("/technicians/invites/{invite_id}")
async def revoke_invite(invite_id: str, current_user: dict = Depends(get_current_user)):
    """Revoke a pending invite"""
    _require_admin(current_user)
    result = await db.tech_invites.update_one(
        {"id": invite_id, "status": "pending"},
        {"$set": {"status": "revoked", "revoked_at": datetime.now(timezone.utc).isoformat(), "revoked_by": current_user.get("name", "Admin")}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Invite not found or already used/revoked")
    return {"message": "Invite revoked"}


@router.post("/technicians/invites/{invite_id}/resend")
async def resend_invite(invite_id: str, current_user: dict = Depends(get_current_user)):
    """Resend an invite email"""
    _require_admin(current_user)
    invite = await db.tech_invites.find_one({"id": invite_id, "status": "pending"}, {"_id": 0})
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found or not pending")

    html = _build_invite_email_html(invite)
    subject = "Reminder: You're invited to join NexusOps"
    email_result = await send_email(invite["email"], subject, html, category="notifications")

    await db.tech_invites.update_one(
        {"id": invite_id},
        {"$set": {"email_status": email_result["status"], "last_resent_at": datetime.now(timezone.utc).isoformat()}}
    )
    return {"email": email_result, "email_configured": await is_microsoft365_configured()}


@router.post("/technicians/accept-invite")
async def accept_invite(data: dict):
    """Accept an invite and create the technician account (no auth required)"""
    token = data.get("token", "")
    password = data.get("password", "")
    if not token or not password:
        raise HTTPException(status_code=400, detail="Token and password are required")

    invite = await db.tech_invites.find_one({"token": token, "status": "pending"}, {"_id": 0})
    if not invite:
        raise HTTPException(status_code=404, detail="Invalid or expired invite token")

    # Check expiry
    expires = invite.get("expires_at", "")
    if expires and datetime.fromisoformat(expires) < datetime.now(timezone.utc):
        await db.tech_invites.update_one({"token": token}, {"$set": {"status": "expired"}})
        raise HTTPException(status_code=410, detail="This invite has expired")

    policy_error = password_policy_error(password, invite.get("email", ""))
    if policy_error:
        raise HTTPException(status_code=400, detail=policy_error)
    if await db.users.find_one({"email": invite["email"]}, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=409, detail="An account with this email already exists")

    # Create the technician
    now = datetime.now(timezone.utc).isoformat()
    password_hash = hash_password(password)

    tech_id = f"TECH-{uuid.uuid4().hex[:6].upper()}"
    technician = {
        "id": tech_id,
        "name": invite["name"],
        "email": invite["email"],
        "password_hash": password_hash,
        "role": invite.get("role", "technician"),
        "job_title": invite.get("job_title", ""),
        "categories": invite.get("categories", []),
        "hourly_rate": invite.get("hourly_rate", 75),
        "specialties": [],
        "is_active": True,
        "is_admin": False,
        "archived": False,
        "created_at": now,
        "invited_by": invite.get("invited_by", ""),
    }
    await db.technicians.insert_one(technician)

    # Also create user account
    user = {
        "id": tech_id,
        "name": invite["name"],
        "email": invite["email"],
        "password_hash": password_hash,
        "role": invite.get("role", "technician"),
        "is_active": True,
        "created_at": now,
    }
    await db.users.insert_one(user)

    # Mark invite as accepted
    await db.tech_invites.update_one(
        {"token": token},
        {"$set": {"status": "accepted", "accepted_at": now, "tech_id": tech_id}}
    )

    return {"message": "Account created successfully", "tech_id": tech_id}
