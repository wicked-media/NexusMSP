from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
import re
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token, password_policy_error
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.services.action_permissions import (
    default_permissions_for_role,
    normalise_action_permissions,
)
from app.services.scope_permissions import normalise_scope_payload
from app.models import *

router = APIRouter()


# These IDs are the stable access controls used by the API. Administrators can
# customise their display labels and add organisation-specific standard roles,
# but cannot alter the protected administrator role or the built-in role IDs.
DEFAULT_ACCESS_ROLES = [
    {"id": "technician", "label": "Technician", "description": "Works assigned service requests and client systems.", "protected": False, "custom": False},
    {"id": "service_desk_manager", "label": "Service Desk Manager", "description": "Leads service-desk operations and technician workflows.", "protected": False, "custom": False},
    {"id": "dispatcher", "label": "Dispatcher", "description": "Coordinates queues, scheduling and client communication.", "protected": False, "custom": False},
    {"id": "admin", "label": "Administrator", "description": "Full platform and team access. Elevated access is protected and audited.", "protected": True, "custom": False},
]

ACCESS_ROLE_IDS = {role["id"] for role in DEFAULT_ACCESS_ROLES}
ROLE_ID_PATTERN = re.compile(r"^[a-z][a-z0-9_]{1,48}$")


async def _access_roles() -> list:
    stored = await db.settings.find_one({"key": "access_role_catalogue"}, {"_id": 0, "value": 1}) or {}
    stored_roles = [item for item in stored.get("value", []) if isinstance(item, dict) and item.get("id")]
    overrides = {item.get("id"): item for item in stored_roles}
    roles = [
        {
            **role,
            **{key: overrides[role["id"]][key] for key in ("label", "description") if key in overrides.get(role["id"], {})},
            "action_permissions": normalise_action_permissions(
                overrides.get(role["id"], {}).get("action_permissions", default_permissions_for_role(role["id"]))
            ),
            "action_permissions_explicit": "action_permissions" in overrides.get(role["id"], {}),
        }
        for role in DEFAULT_ACCESS_ROLES
    ]

    # Custom roles are labels and workflow classifications. Access remains
    # permission-preset based; only the protected administrator role grants
    # platform-wide administrator access.
    for item in stored_roles:
        role_id = str(item.get("id", "")).strip().lower()
        if role_id in ACCESS_ROLE_IDS or not ROLE_ID_PATTERN.fullmatch(role_id):
            continue
        label = str(item.get("label", "")).strip()
        description = str(item.get("description", "")).strip()
        if 2 <= len(label) <= 50 and len(description) <= 180:
            roles.append({
                "id": role_id,
                "label": label,
                "description": description,
                "protected": False,
                "custom": True,
                "action_permissions": normalise_action_permissions(
                    item.get("action_permissions", default_permissions_for_role(role_id))
                ),
                "action_permissions_explicit": "action_permissions" in item,
            })
    return roles


async def _access_role_ids() -> set:
    return {role["id"] for role in await _access_roles()}


async def _caller_is_admin(current_user: dict) -> bool:
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "role": 1, "is_admin": 1})
    return bool(caller and (caller.get("role") == "admin" or caller.get("is_admin")))


@router.get("/technicians/access-roles")
async def get_access_roles(current_user: dict = Depends(get_current_user)):
    """Return editable display labels for the platform's stable access roles."""
    return {"roles": await _access_roles()}


@router.get("/technicians/scope-catalog")
async def get_scope_catalog(current_user: dict = Depends(get_current_user)):
    """Return the safe client/site choices used by the technician editor."""
    if not await _caller_is_admin(current_user):
        raise HTTPException(status_code=403, detail="Administrator access required")
    clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1}).sort("name", 1).to_list(5000)
    client_names = {item.get("id"): item.get("name", "Client") for item in clients}
    raw_sites = await db.network_sites.find(
        {},
        {"_id": 0, "id": 1, "name": 1, "client_id": 1, "client_name": 1, "location": 1},
    ).to_list(5000)
    sites_by_id = {}
    for item in raw_sites:
        site_id = str(item.get("id") or "").strip()
        client_id = str(item.get("client_id") or "").strip()
        if not site_id or not client_id:
            continue
        sites_by_id[site_id] = {
            "id": site_id,
            "name": item.get("name") or item.get("location") or "Client site",
            "client_id": client_id,
            "client_name": item.get("client_name") or client_names.get(client_id, "Client"),
            "location": item.get("location", ""),
        }
    return {
        "clients": clients,
        "sites": sorted(sites_by_id.values(), key=lambda item: (item["client_name"].casefold(), item["name"].casefold())),
        "semantics": {
            "all": "Every current and future client and site",
            "restricted": "Only selected clients; an empty site list allows every site for those clients",
        },
    }


@router.put("/technicians/access-roles")
async def update_access_roles(data: dict, current_user: dict = Depends(get_current_user)):
    if not await _caller_is_admin(current_user):
        raise HTTPException(status_code=403, detail="Administrator access required")
    requested = data.get("roles")
    if not isinstance(requested, list):
        raise HTTPException(status_code=400, detail="A role catalogue is required")
    existing_catalogue = await db.settings.find_one(
        {"key": "access_role_catalogue"},
        {"_id": 0, "value": 1},
    ) or {}
    existing_by_id = {
        item.get("id"): item
        for item in existing_catalogue.get("value", [])
        if isinstance(item, dict) and item.get("id")
    }
    normalised = []
    for item in requested:
        if not isinstance(item, dict):
            raise HTTPException(status_code=400, detail="Each access role must be a valid record")
        role_id = str(item.get("id", "")).strip().lower()
        if not ROLE_ID_PATTERN.fullmatch(role_id):
            raise HTTPException(status_code=400, detail="Role IDs must use lowercase letters, numbers and underscores")
        normalised.append({**item, "id": role_id})

    by_id = {item["id"]: item for item in normalised}
    if len(by_id) != len(normalised):
        raise HTTPException(status_code=400, detail="Each access role needs a unique ID")

    required_ids = {role["id"] for role in DEFAULT_ACCESS_ROLES}
    missing_required = required_ids - set(by_id)
    if missing_required:
        raise HTTPException(status_code=400, detail="Built-in access roles cannot be removed")

    cleaned = []
    labels = set()
    ordered_ids = [role["id"] for role in DEFAULT_ACCESS_ROLES] + [item["id"] for item in normalised if item["id"] not in required_ids]
    for role_id in ordered_ids:
        item = by_id[role_id]
        label = str(item.get("label", "")).strip()
        description = str(item.get("description", "")).strip()
        if not 2 <= len(label) <= 50:
            raise HTTPException(status_code=400, detail=f"{role_id} needs a name between 2 and 50 characters")
        if len(description) > 180:
            raise HTTPException(status_code=400, detail="Role descriptions must be 180 characters or less")
        if label.casefold() in labels:
            raise HTTPException(status_code=400, detail="Each access role needs a unique name")
        labels.add(label.casefold())
        cleaned_role = {
            "id": role_id,
            "label": label,
            "description": description,
            "custom": role_id not in required_ids,
        }
        if role_id != "admin":
            if "action_permissions" in item:
                cleaned_role["action_permissions"] = normalise_action_permissions(item.get("action_permissions"))
            elif "action_permissions" in existing_by_id.get(role_id, {}):
                cleaned_role["action_permissions"] = normalise_action_permissions(existing_by_id[role_id].get("action_permissions"))
        cleaned.append(cleaned_role)

    # A role can only be retired after its members and pending invitations are
    # moved to another role. This prevents silent changes to staff access data.
    current_ids = await _access_role_ids()
    retired_ids = current_ids - set(by_id)
    if retired_ids:
        assigned = await db.users.count_documents({"role": {"$in": list(retired_ids)}})
        invited = await db.tech_invites.count_documents({"role": {"$in": list(retired_ids)}, "status": "pending"})
        if assigned or invited:
            raise HTTPException(status_code=400, detail="Reassign staff and pending invitations before retiring a custom role")

    await db.settings.update_one(
        {"key": "access_role_catalogue"},
        {"$set": {"key": "access_role_catalogue", "value": cleaned, "updated_at": datetime.now(timezone.utc).isoformat(), "updated_by": current_user.get("id")}},
        upsert=True,
    )
    from app.routers.tech_intel import _log_audit
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "password_hash": 0}) or current_user
    await _log_audit(caller, "access_role_catalogue_updated", "access-roles", "Access role catalogue", {"roles": cleaned})
    return {"roles": await _access_roles()}


# ============== TECHNICIAN MANAGEMENT ENDPOINTS ==============

@router.get("/technicians/overview")
async def get_technicians_overview(current_user: dict = Depends(get_current_user)):
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(100)
    tickets = await db.tickets.find({}, {"_id": 0}).to_list(10000)
    result = []
    for u in users:
        uid = u["id"]
        assigned = [t for t in tickets if t.get("assigned_to") == uid]
        open_t = [t for t in assigned if t.get("status") in ("open", "in_progress")]
        note_counts = {}
        for t in open_t:
            nc = await db.ticket_comments.count_documents({"ticket_id": t["id"]})
            note_counts[t["id"]] = nc
        no_notes = sum(1 for tid, nc in note_counts.items() if nc == 0)
        overdue = 0
        for t in open_t:
            sla = t.get("sla_due")
            if sla:
                try:
                    sla_dt = datetime.fromisoformat(str(sla).replace("Z", "+00:00")) if isinstance(sla, str) else sla
                    if sla_dt and sla_dt < datetime.now(timezone.utc):
                        overdue += 1
                except:
                    pass
        week_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        week_start = week_start - timedelta(days=week_start.weekday())
        time_entries = await db.ticket_time_entries.find({"user_id": uid, "created_at": {"$gte": week_start.isoformat()}}, {"_id": 0}).to_list(5000)
        week_hours = round(sum(e.get("minutes", 0) for e in time_entries) / 60, 1)

        result.append({
            **{k: v for k, v in u.items() if k != "password_hash"},
            "assigned_count": len(assigned),
            "open_count": len(open_t),
            "no_notes_count": no_notes,
            "overdue_count": overdue,
            "resolved_count": len([t for t in assigned if t.get("status") in ("resolved", "closed")]),
            "hours_this_week": week_hours,
        })
    return result

@router.post("/technicians/bulk-action")
async def bulk_action_technicians(data: dict, current_user: dict = Depends(get_current_user)):
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Only admins can perform bulk actions")
    ids = data.get("tech_ids", [])
    action = data.get("action", "")
    if not ids:
        raise HTTPException(status_code=400, detail="No technicians selected")
    if action == "archive":
        await db.users.update_many({"id": {"$in": ids}}, {"$set": {"is_active": False, "archived": True, "archived_at": datetime.now(timezone.utc).isoformat()}})
        return {"message": f"{len(ids)} technicians archived"}
    elif action == "restore":
        await db.users.update_many({"id": {"$in": ids}}, {"$set": {"is_active": True, "archived": False, "archived_at": None}})
        return {"message": f"{len(ids)} technicians restored"}
    elif action == "set_categories":
        categories = data.get("categories", [])
        await db.users.update_many({"id": {"$in": ids}}, {"$set": {"categories": categories}})
        return {"message": f"Categories updated for {len(ids)} technicians"}
    elif action == "delete":
        active_count = await db.users.count_documents({"id": {"$in": ids}, "archived": {"$ne": True}})
        if active_count:
            raise HTTPException(status_code=400, detail="Archive technicians before permanent deletion")
        await db.users.delete_many({"id": {"$in": ids}})
        return {"message": f"{len(ids)} technicians permanently deleted"}
    raise HTTPException(status_code=400, detail="Invalid action")



@router.post("/technicians")
async def create_technician(tech_data: dict, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "admin" and not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Only administrators can create technicians")
    email = (tech_data.get("email") or "").strip().lower()
    name = (tech_data.get("name") or "").strip()
    password = tech_data.get("password") or ""
    if not name or not email:
        raise HTTPException(status_code=400, detail="Name and email are required")
    role = str(tech_data.get("role") or "technician").strip().lower()
    if role not in await _access_role_ids():
        raise HTTPException(status_code=400, detail="Choose a valid access role")
    if await db.users.find_one({"email": email}, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=400, detail="Email already registered")
    policy_error = password_policy_error(password, email)
    if policy_error:
        raise HTTPException(status_code=400, detail=policy_error)
    job_title = tech_data.get("job_title", "")
    permissions = tech_data.get("permissions")
    if not permissions and job_title in PERMISSION_PRESETS:
        permissions = PERMISSION_PRESETS[job_title]
    user = User(
        email=email,
        name=name,
        role=role,
        job_title=job_title,
        hourly_rate=float(tech_data.get("hourly_rate", 75)),
        phone=tech_data.get("phone", ""),
        specialties=tech_data.get("specialties", []),
        categories=tech_data.get("categories", []),
        is_active=tech_data.get("is_active", True),
        is_admin=tech_data.get("is_admin", False),
    )
    user_dict = user.model_dump()
    if permissions:
        user_dict["permissions"] = permissions
    user_dict["password_hash"] = hash_password(password)
    user_dict["created_at"] = user_dict["created_at"].isoformat()
    await db.users.insert_one(user_dict)
    if user_dict.get("is_admin") or user_dict.get("role") == "admin":
        from app.routers.tech_intel import _log_audit
        caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "password_hash": 0}) or current_user
        await _log_audit(caller, "administrator_created", user_dict["id"], user_dict["name"], {
            "role": user_dict.get("role"), "job_title": user_dict.get("job_title"),
        })
    user_dict.pop("_id", None)
    user_dict.pop("password_hash", None)
    return user_dict

@router.put("/technicians/{tech_id}")
async def update_technician(tech_id: str, tech_data: dict, current_user: dict = Depends(get_current_user)):
    is_admin = await _caller_is_admin(current_user)
    admin_fields = {"name", "email", "role", "hourly_rate", "phone", "specialties", "categories", "is_active",
                    "email_signature", "email_signature_html", "signature_config", "avatar",
                    "job_title", "permissions", "action_permissions", "client_scope_mode", "client_scope_ids",
                    "site_scope_ids", "is_admin", "archived", "archived_at", "enabled_modules"}
    self_service_fields = {"name", "phone", "avatar", "email_signature", "email_signature_html", "signature_config", "job_title"}

    if is_admin:
        allowed = admin_fields
    elif tech_id == current_user["id"]:
        allowed = self_service_fields
    else:
        raise HTTPException(status_code=403, detail="You can only update your own profile")

    update = {k: v for k, v in tech_data.items() if k in allowed}
    target = await db.users.find_one({"id": tech_id}, {"_id": 0, "password_hash": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Technician not found")
    if "role" in update:
        update["role"] = str(update["role"] or "").strip().lower()
        if update["role"] not in await _access_role_ids():
            raise HTTPException(status_code=400, detail="Choose a valid access role")
    if "hourly_rate" in update:
        update["hourly_rate"] = float(update["hourly_rate"])
    if any(field in update for field in {"client_scope_mode", "client_scope_ids", "site_scope_ids"}):
        scope = normalise_scope_payload({**target, **tech_data})
        client_ids = set(scope["client_scope_ids"])
        site_ids = set(scope["site_scope_ids"])
        if scope["client_scope_mode"] == "restricted" and not client_ids:
            raise HTTPException(status_code=400, detail="Choose at least one client for selected-client access")
        known_clients = {
            item["id"]
            for item in await db.clients.find({"id": {"$in": list(client_ids)}}, {"_id": 0, "id": 1}).to_list(5000)
        }
        if known_clients != client_ids:
            raise HTTPException(status_code=400, detail="One or more selected clients no longer exist")
        known_sites = await db.network_sites.find(
            {"id": {"$in": list(site_ids)}},
            {"_id": 0, "id": 1, "client_id": 1},
        ).to_list(5000)
        if {item["id"] for item in known_sites} != site_ids:
            raise HTTPException(status_code=400, detail="One or more selected sites no longer exist")
        if any(item.get("client_id") not in client_ids for item in known_sites):
            raise HTTPException(status_code=400, detail="Selected sites must belong to a selected client")
        update.update(scope)
    if not update:
        raise HTTPException(status_code=400, detail="No valid fields")

    sensitive_fields = {"role", "is_admin", "permissions", "action_permissions", "client_scope_mode",
                        "client_scope_ids", "site_scope_ids", "enabled_modules"}
    sensitive_changes = {
        field: {"from": target.get(field), "to": update.get(field)}
        for field in sensitive_fields
        if field in update and target.get(field) != update.get(field)
    }
    await db.users.update_one({"id": tech_id}, {"$set": update})

    if sensitive_changes:
        from app.routers.tech_intel import _log_audit
        caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "password_hash": 0}) or current_user
        old_admin = bool(target.get("is_admin") or target.get("role") == "admin")
        new_admin = bool(update.get("is_admin", target.get("is_admin")) or update.get("role", target.get("role")) == "admin")
        if old_admin != new_admin:
            action = "administrator_access_granted" if new_admin else "administrator_access_removed"
        elif "role" in sensitive_changes:
            action = "access_role_updated"
        else:
            action = "permissions_updated"
        await _log_audit(caller, action, tech_id, target.get("name", "Technician"), {"changes": sensitive_changes})
    return {"message": "Technician updated"}

@router.post("/technicians/{tech_id}/archive")
async def archive_technician(tech_id: str, data: Optional[dict] = None, current_user: dict = Depends(get_current_user)):
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Only admins can archive technicians")
    if tech_id == current_user.get("id"):
        raise HTTPException(status_code=400, detail="You cannot archive your own account")
    target = await db.users.find_one({"id": tech_id}, {"_id": 0, "password_hash": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Technician not found")
    if target.get("archived"):
        return {"message": "Technician is already archived"}
    if target.get("is_admin") or target.get("role") == "admin":
        active_admins = await db.users.count_documents({
            "archived": {"$ne": True},
            "$or": [{"is_admin": True}, {"role": "admin"}],
        })
        if active_admins <= 1:
            raise HTTPException(status_code=400, detail="Keep at least one active administrator account")
    archive_reason = str((data or {}).get("reason", "")).strip()[:500]
    archived_at = datetime.now(timezone.utc).isoformat()
    await db.users.update_one({"id": tech_id}, {"$set": {
        "is_active": False, "archived": True,
        "archived_at": archived_at,
        "archived_by": current_user.get("id"),
        "archive_reason": archive_reason,
    }})
    from app.routers.tech_intel import _log_audit
    await _log_audit(caller, "technician_archived", tech_id, target.get("name", "Technician"), {"reason": archive_reason, "archived_at": archived_at})
    return {"message": "Technician archived"}

@router.post("/technicians/{tech_id}/restore")
async def restore_technician(tech_id: str, current_user: dict = Depends(get_current_user)):
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Only admins can restore technicians")
    target = await db.users.find_one({"id": tech_id}, {"_id": 0, "password_hash": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Technician not found")
    if not target.get("archived"):
        raise HTTPException(status_code=400, detail="Technician is not archived")
    await db.users.update_one({"id": tech_id}, {"$set": {
        "is_active": True, "archived": False, "archived_at": None,
        "restored_at": datetime.now(timezone.utc).isoformat(),
        "restored_by": current_user.get("id"),
    }})
    from app.routers.tech_intel import _log_audit
    await _log_audit(caller, "technician_restored", tech_id, target.get("name", "Technician"), {})
    return {"message": "Technician restored"}

@router.delete("/technicians/{tech_id}")
async def delete_technician(tech_id: str, current_user: dict = Depends(get_current_user)):
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Only admins can permanently delete technicians")
    if tech_id == current_user.get("id"):
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    target = await db.users.find_one({"id": tech_id}, {"_id": 0, "password_hash": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Technician not found")
    if not target.get("archived"):
        raise HTTPException(status_code=400, detail="Archive the technician before permanent deletion")
    from app.routers.tech_intel import _log_audit
    await _log_audit(caller, "technician_deleted", tech_id, target.get("name", "Technician"), {"archived_at": target.get("archived_at")})
    await db.users.delete_one({"id": tech_id})
    return {"message": "Technician permanently deleted"}

@router.get("/technicians/{tech_id}/dashboard")
async def get_technician_dashboard(tech_id: str, current_user: dict = Depends(get_current_user)):
    user = await db.users.find_one({"id": tech_id}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Technician not found")

    all_tickets = await db.tickets.find({"assigned_to": tech_id}, {"_id": 0}).to_list(5000)
    open_tickets = [t for t in all_tickets if t.get("status") in ("open", "in_progress")]
    overdue_tickets = []
    no_notes_tickets = []

    for t in open_tickets:
        sla = t.get("sla_due")
        if sla:
            if isinstance(sla, str):
                try:
                    sla_dt = datetime.fromisoformat(sla.replace("Z", "+00:00"))
                except:
                    sla_dt = None
            else:
                sla_dt = sla
            if sla_dt and sla_dt < datetime.now(timezone.utc):
                overdue_tickets.append(t)

        note_count = await db.ticket_comments.count_documents({"ticket_id": t["id"]})
        if note_count == 0:
            no_notes_tickets.append(t)

    time_entries = await db.ticket_time_entries.find({"user_id": tech_id}, {"_id": 0}).to_list(5000)
    total_min = sum(e.get("minutes", 0) for e in time_entries)
    billable_min = sum(e.get("minutes", 0) for e in time_entries if e.get("billable"))

    week_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = week_start - timedelta(days=week_start.weekday())
    week_entries = [e for e in time_entries if e.get("created_at", "") >= week_start.isoformat()]
    week_min = sum(e.get("minutes", 0) for e in week_entries)

    resolved = len([t for t in all_tickets if t.get("status") in ("resolved", "closed")])

    return {
        "technician": user,
        "stats": {
            "total_assigned": len(all_tickets),
            "open_tickets": len(open_tickets),
            "overdue_tickets": len(overdue_tickets),
            "no_notes_tickets": len(no_notes_tickets),
            "resolved_tickets": resolved,
            "total_hours": round(total_min / 60, 1),
            "billable_hours": round(billable_min / 60, 1),
            "hours_this_week": round(week_min / 60, 1),
        },
        "open_tickets": open_tickets,
        "overdue_tickets": overdue_tickets,
        "no_notes_tickets": no_notes_tickets,
    }

# Permission presets by job title
PERMISSION_PRESETS = {
    "L1 Technician": {
        "tickets": {"view": True, "create": True, "edit": True, "delete": False},
        "clients": {"view": True, "create": False, "edit": False, "delete": False},
        "invoices": {"view": False, "create": False, "edit": False, "delete": False},
        "products": {"view": True, "create": False, "edit": False, "delete": False},
        "devices": {"view": True, "create": False, "edit": False, "delete": False},
        "networking": {"view": True, "create": False, "edit": False, "delete": False},
        "assets": {"view": True, "create": False, "edit": False, "delete": False},
        "reports": {"view": False, "create": False, "edit": False, "delete": False},
        "knowledge_base": {"view": True, "create": True, "edit": False, "delete": False},
        "it_docs": {"view": False, "create": False, "edit": False, "delete": False},
        "contracts": {"view": False, "create": False, "edit": False, "delete": False},
        "projects": {"view": True, "create": False, "edit": False, "delete": False},
        "time_tracking": {"view": True, "create": True, "edit": True, "delete": False},
        "purchase_orders": {"view": False, "create": False, "edit": False, "delete": False},
        "scheduling": {"view": True, "create": False, "edit": False, "delete": False},
        "settings": {"view": False, "create": False, "edit": False, "delete": False},
        "agent_commands": {"view": False, "execute": False},
    },
    "L2 Technician": {
        "tickets": {"view": True, "create": True, "edit": True, "delete": False},
        "clients": {"view": True, "create": True, "edit": True, "delete": False},
        "invoices": {"view": True, "create": False, "edit": False, "delete": False},
        "products": {"view": True, "create": True, "edit": True, "delete": False},
        "devices": {"view": True, "create": True, "edit": True, "delete": False},
        "networking": {"view": True, "create": True, "edit": True, "delete": False},
        "assets": {"view": True, "create": True, "edit": True, "delete": False},
        "reports": {"view": True, "create": False, "edit": False, "delete": False},
        "knowledge_base": {"view": True, "create": True, "edit": True, "delete": False},
        "it_docs": {"view": True, "create": False, "edit": False, "delete": False},
        "contracts": {"view": True, "create": False, "edit": False, "delete": False},
        "projects": {"view": True, "create": True, "edit": True, "delete": False},
        "time_tracking": {"view": True, "create": True, "edit": True, "delete": False},
        "purchase_orders": {"view": True, "create": False, "edit": False, "delete": False},
        "scheduling": {"view": True, "create": True, "edit": False, "delete": False},
        "settings": {"view": False, "create": False, "edit": False, "delete": False},
        "agent_commands": {"view": False, "execute": False},
    },
    "Senior Engineer": {
        "tickets": {"view": True, "create": True, "edit": True, "delete": True},
        "clients": {"view": True, "create": True, "edit": True, "delete": False},
        "invoices": {"view": True, "create": True, "edit": True, "delete": False},
        "products": {"view": True, "create": True, "edit": True, "delete": True},
        "devices": {"view": True, "create": True, "edit": True, "delete": True},
        "networking": {"view": True, "create": True, "edit": True, "delete": True},
        "assets": {"view": True, "create": True, "edit": True, "delete": True},
        "reports": {"view": True, "create": True, "edit": False, "delete": False},
        "knowledge_base": {"view": True, "create": True, "edit": True, "delete": True},
        "it_docs": {"view": True, "create": True, "edit": True, "delete": False},
        "contracts": {"view": True, "create": True, "edit": True, "delete": False},
        "projects": {"view": True, "create": True, "edit": True, "delete": True},
        "time_tracking": {"view": True, "create": True, "edit": True, "delete": True},
        "purchase_orders": {"view": True, "create": True, "edit": True, "delete": False},
        "scheduling": {"view": True, "create": True, "edit": True, "delete": False},
        "settings": {"view": True, "create": False, "edit": False, "delete": False},
        "agent_commands": {"view": True, "execute": True},
    },
    "Service Manager": {
        "tickets": {"view": True, "create": True, "edit": True, "delete": True},
        "clients": {"view": True, "create": True, "edit": True, "delete": True},
        "invoices": {"view": True, "create": True, "edit": True, "delete": True},
        "products": {"view": True, "create": True, "edit": True, "delete": True},
        "devices": {"view": True, "create": True, "edit": True, "delete": True},
        "networking": {"view": True, "create": True, "edit": True, "delete": True},
        "assets": {"view": True, "create": True, "edit": True, "delete": True},
        "reports": {"view": True, "create": True, "edit": True, "delete": True},
        "knowledge_base": {"view": True, "create": True, "edit": True, "delete": True},
        "it_docs": {"view": True, "create": True, "edit": True, "delete": True},
        "contracts": {"view": True, "create": True, "edit": True, "delete": True},
        "projects": {"view": True, "create": True, "edit": True, "delete": True},
        "time_tracking": {"view": True, "create": True, "edit": True, "delete": True},
        "purchase_orders": {"view": True, "create": True, "edit": True, "delete": True},
        "scheduling": {"view": True, "create": True, "edit": True, "delete": True},
        "settings": {"view": True, "create": True, "edit": True, "delete": False},
        "agent_commands": {"view": True, "execute": True},
    },
    "Dispatcher": {
        "tickets": {"view": True, "create": True, "edit": True, "delete": False},
        "clients": {"view": True, "create": True, "edit": False, "delete": False},
        "invoices": {"view": True, "create": False, "edit": False, "delete": False},
        "products": {"view": True, "create": False, "edit": False, "delete": False},
        "devices": {"view": True, "create": False, "edit": False, "delete": False},
        "networking": {"view": True, "create": False, "edit": False, "delete": False},
        "assets": {"view": True, "create": False, "edit": False, "delete": False},
        "reports": {"view": True, "create": False, "edit": False, "delete": False},
        "knowledge_base": {"view": True, "create": False, "edit": False, "delete": False},
        "it_docs": {"view": False, "create": False, "edit": False, "delete": False},
        "contracts": {"view": False, "create": False, "edit": False, "delete": False},
        "projects": {"view": True, "create": False, "edit": False, "delete": False},
        "time_tracking": {"view": True, "create": True, "edit": True, "delete": False},
        "purchase_orders": {"view": False, "create": False, "edit": False, "delete": False},
        "scheduling": {"view": True, "create": True, "edit": True, "delete": True},
        "settings": {"view": False, "create": False, "edit": False, "delete": False},
        "agent_commands": {"view": False, "execute": False},
    },
}

@router.get("/technicians/permission-presets")
async def get_permission_presets(current_user: dict = Depends(get_current_user)):
    return PERMISSION_PRESETS

@router.put("/technicians/{tech_id}/permissions")
async def update_technician_permissions(tech_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Only admins can modify permissions")
    update = {}
    if "permissions" in data:
        update["permissions"] = data["permissions"]
    if "action_permissions" in data:
        update["action_permissions"] = normalise_action_permissions(data["action_permissions"])
    if "is_admin" in data:
        update["is_admin"] = data["is_admin"]
    if "job_title" in data:
        update["job_title"] = data["job_title"]
    if "enabled_modules" in data:
        update["enabled_modules"] = data["enabled_modules"]
    if update:
        await db.users.update_one({"id": tech_id}, {"$set": update})
    return {"message": "Permissions updated"}

@router.get("/technicians/leaderboard")
async def get_technician_leaderboard(current_user: dict = Depends(get_current_user)):
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(100)
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    all_tickets = await db.tickets.find({}, {"_id": 0}).to_list(10000)
    leaderboard = []
    for u in users:
        uid = u["id"]
        assigned = [t for t in all_tickets if t.get("assigned_to") == uid]
        closed_this_month = [t for t in assigned if t.get("status") in ("resolved", "closed") and t.get("resolved_at", t.get("updated_at", "")) >= month_start.isoformat()]
        closed_total = [t for t in assigned if t.get("status") in ("resolved", "closed")]
        time_entries = await db.ticket_time_entries.find({"user_id": uid}, {"_id": 0}).to_list(5000)
        month_entries = [e for e in time_entries if e.get("created_at", "") >= month_start.isoformat()]
        total_hours = round(sum(e.get("minutes", 0) for e in time_entries) / 60, 1)
        month_hours = round(sum(e.get("minutes", 0) for e in month_entries) / 60, 1)
        avg_resolution = 0
        resolved_with_time = [t for t in closed_total if t.get("resolved_at") and t.get("created_at")]
        if resolved_with_time:
            deltas = []
            for t in resolved_with_time:
                try:
                    c = datetime.fromisoformat(str(t["created_at"]).replace("Z", "+00:00"))
                    r = datetime.fromisoformat(str(t["resolved_at"]).replace("Z", "+00:00"))
                    deltas.append((r - c).total_seconds() / 3600)
                except:
                    pass
            if deltas:
                avg_resolution = round(sum(deltas) / len(deltas), 1)
        csat_total = sum(1 for t in closed_total if t.get("satisfaction_rating"))
        csat_positive = sum(1 for t in closed_total if t.get("satisfaction_rating", 0) >= 4)
        csat_score = round((csat_positive / csat_total * 100) if csat_total > 0 else 0, 1)
        leaderboard.append({
            "id": uid, "name": u["name"], "email": u["email"], "role": u.get("role", "technician"),
            "job_title": u.get("job_title", ""), "avatar": u.get("avatar"),
            "is_active": u.get("is_active", True),
            "closed_this_month": len(closed_this_month), "closed_total": len(closed_total),
            "total_assigned": len(assigned), "total_hours": total_hours,
            "month_hours": month_hours, "avg_resolution_hours": avg_resolution,
            "csat_score": csat_score, "specialties": u.get("specialties", []),
        })
    leaderboard.sort(key=lambda x: x["closed_this_month"], reverse=True)
    for i, entry in enumerate(leaderboard):
        entry["rank"] = i + 1
    return {"month": now.strftime("%B %Y"), "leaderboard": leaderboard}

@router.get("/technicians/{tech_id}/history")
async def get_technician_history(tech_id: str, current_user: dict = Depends(get_current_user)):
    user = await db.users.find_one({"id": tech_id}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Technician not found")
    all_tickets = await db.tickets.find({"assigned_to": tech_id}, {"_id": 0}).sort("created_at", -1).to_list(5000)
    resolved = [t for t in all_tickets if t.get("status") in ("resolved", "closed")]
    now = datetime.now(timezone.utc)
    monthly_data = {}
    for i in range(6):
        d = now - timedelta(days=30 * i)
        key = d.strftime("%Y-%m")
        label = d.strftime("%b %Y")
        month_start = d.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        if d.month == 12:
            month_end = month_start.replace(year=d.year + 1, month=1)
        else:
            month_end = month_start.replace(month=d.month + 1)
        closed_in_month = [t for t in resolved if month_start.isoformat() <= t.get("resolved_at", t.get("updated_at", "")) < month_end.isoformat()]
        opened_in_month = [t for t in all_tickets if month_start.isoformat() <= t.get("created_at", "") < month_end.isoformat()]
        monthly_data[key] = {"label": label, "closed": len(closed_in_month), "opened": len(opened_in_month)}
    recent_resolved = resolved[:20]
    return {
        "technician": {"id": user["id"], "name": user["name"]},
        "total_tickets": len(all_tickets), "total_resolved": len(resolved),
        "monthly": list(reversed(monthly_data.values())),
        "recent_resolved": recent_resolved,
    }

@router.put("/technicians/{tech_id}/email-signature")
async def update_email_signature(tech_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    if tech_id != current_user["id"] and not await _caller_is_admin(current_user):
        raise HTTPException(status_code=403, detail="You can only update your own email signature")
    sig_data = {
        "email_signature": data.get("email_signature", ""),
        "email_signature_html": data.get("email_signature_html", ""),
        "signature_config": data.get("signature_config", {}),
    }
    await db.users.update_one({"id": tech_id}, {"$set": sig_data})
    return {"message": "Email signature updated"}

@router.get("/technicians/{tech_id}/email-signature")
async def get_email_signature(tech_id: str, current_user: dict = Depends(get_current_user)):
    user = await db.users.find_one({"id": tech_id}, {"_id": 0, "email_signature": 1, "email_signature_html": 1, "signature_config": 1, "name": 1, "email": 1, "phone": 1, "job_title": 1})
    if not user:
        raise HTTPException(status_code=404, detail="Technician not found")
    return user

@router.get("/settings/email-signature-templates")
async def get_signature_templates(current_user: dict = Depends(get_current_user)):
    return [
        {"id": "professional", "name": "Professional", "description": "Clean, corporate style with company branding"},
        {"id": "modern", "name": "Modern", "description": "Sleek design with social links and gradient accent"},
        {"id": "minimal", "name": "Minimal", "description": "Simple text-based signature with essential info"},
        {"id": "technical", "name": "Technical", "description": "Tech-focused with certifications and skills"},
    ]

