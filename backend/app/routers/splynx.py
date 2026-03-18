from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
import httpx
import base64
from app.database import db
from app.auth import get_current_user

router = APIRouter()

SERVICE_TYPES = ["internet", "voice", "recurring", "bundle"]
SERVICE_STATUS_MAP = {
    "active": {"label": "Active", "color": "emerald"},
    "disabled": {"label": "Suspended", "color": "red"},
    "pending": {"label": "Pending", "color": "amber"},
    "archived": {"label": "Archived", "color": "gray"},
    "stopped": {"label": "Stopped", "color": "red"},
    "blocked": {"label": "Blocked", "color": "red"},
}

async def get_splynx_config():
    config = await db.settings.find_one({"type": "splynx"}, {"_id": 0})
    if not config or not config.get("url") or not config.get("api_key_full"):
        return None
    return config

def build_auth_header(config):
    key = config.get("api_key_full", "")
    secret = config.get("api_secret_full", "")
    creds = base64.b64encode(f"{key}:{secret}".encode()).decode()
    return {"Authorization": f"Basic {creds}", "Content-Type": "application/json"}

async def splynx_get(config, path, params=None):
    url = config["url"].rstrip("/")
    api_url = f"{url}/api/2.0/{path}"
    headers = build_auth_header(config)
    async with httpx.AsyncClient(timeout=30, verify=False) as client:
        resp = await client.get(api_url, headers=headers, params=params)
        if resp.status_code == 200:
            return resp.json()
        elif resp.status_code == 401:
            raise HTTPException(status_code=401, detail="Splynx API authentication failed. Check your API key and secret.")
        elif resp.status_code == 403:
            raise HTTPException(status_code=403, detail="Splynx API access denied. Check API key permissions.")
        else:
            return None

# ============== SETTINGS ==============

@router.get("/settings/splynx")
async def get_splynx_settings(current_user: dict = Depends(get_current_user)):
    doc = await db.settings.find_one({"type": "splynx"}, {"_id": 0})
    if not doc:
        return {"type": "splynx", "url": "", "api_key": "", "api_secret": "", "configured": False}
    doc.pop("api_key_full", None)
    doc.pop("api_secret_full", None)
    return doc

@router.put("/settings/splynx")
async def update_splynx_settings(data: dict, current_user: dict = Depends(get_current_user)):
    url = data.get("url", "").rstrip("/")
    api_key = data.get("api_key", "")
    api_secret = data.get("api_secret", "")
    masked_key = f"{'*' * max(0, len(api_key) - 6)}{api_key[-6:]}" if len(api_key) > 6 else "***"
    masked_secret = f"{'*' * max(0, len(api_secret) - 6)}{api_secret[-6:]}" if len(api_secret) > 6 else "***"
    await db.settings.update_one({"type": "splynx"}, {"$set": {
        "type": "splynx",
        "url": url,
        "api_key_full": api_key,
        "api_secret_full": api_secret,
        "api_key": masked_key,
        "api_secret": masked_secret,
        "configured": bool(url and api_key and api_secret),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }}, upsert=True)
    return {"message": "Splynx settings saved", "configured": bool(url and api_key and api_secret)}

@router.post("/settings/splynx/test")
async def test_splynx_connection(current_user: dict = Depends(get_current_user)):
    config = await get_splynx_config()
    if not config:
        raise HTTPException(status_code=400, detail="Splynx not configured")
    try:
        result = await splynx_get(config, "admin/api/check")
        if result is not None:
            return {"success": True, "message": "Connected to Splynx successfully"}
        return {"success": False, "message": "Failed to connect"}
    except HTTPException as e:
        return {"success": False, "message": e.detail}
    except Exception as e:
        return {"success": False, "message": f"Connection error: {str(e)[:100]}"}

# ============== CUSTOMER LINKING ==============

@router.get("/clients/{client_id}/splynx")
async def get_client_splynx_link(client_id: str, current_user: dict = Depends(get_current_user)):
    link = await db.splynx_links.find_one({"client_id": client_id}, {"_id": 0})
    return link or {"client_id": client_id, "splynx_customer_id": "", "linked": False}

@router.put("/clients/{client_id}/splynx")
async def link_client_to_splynx(client_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    splynx_id = data.get("splynx_customer_id", "")
    await db.splynx_links.update_one({"client_id": client_id}, {"$set": {
        "client_id": client_id,
        "splynx_customer_id": splynx_id,
        "linked": bool(splynx_id),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }}, upsert=True)
    return {"message": "Splynx link updated"}

# ============== FETCH CUSTOMER DATA ==============

@router.get("/clients/{client_id}/splynx/customer")
async def get_splynx_customer(client_id: str, current_user: dict = Depends(get_current_user)):
    config = await get_splynx_config()
    if not config:
        return {"error": "Splynx not configured"}
    link = await db.splynx_links.find_one({"client_id": client_id}, {"_id": 0})
    if not link or not link.get("splynx_customer_id"):
        return {"error": "Client not linked to Splynx"}
    sid = link["splynx_customer_id"]
    try:
        customer = await splynx_get(config, f"admin/customers/customer/{sid}")
        if not customer:
            return {"error": "Customer not found in Splynx"}
        billing = await splynx_get(config, f"admin/customers/customer-billing/{sid}")
        return {"customer": customer, "billing": billing}
    except HTTPException as e:
        return {"error": e.detail}
    except Exception as e:
        return {"error": str(e)[:100]}

@router.get("/clients/{client_id}/splynx/services")
async def get_splynx_services(client_id: str, current_user: dict = Depends(get_current_user)):
    config = await get_splynx_config()
    if not config:
        return {"services": [], "error": "Splynx not configured"}
    link = await db.splynx_links.find_one({"client_id": client_id}, {"_id": 0})
    if not link or not link.get("splynx_customer_id"):
        return {"services": [], "error": "Client not linked to Splynx"}
    sid = link["splynx_customer_id"]
    all_services = []
    try:
        for stype in SERVICE_TYPES:
            services = await splynx_get(config, f"admin/customers/customer/{sid}/{stype}-services")
            if services and isinstance(services, list):
                for s in services:
                    s["service_type"] = stype
                    status = s.get("status", "active").lower()
                    s["status_info"] = SERVICE_STATUS_MAP.get(status, SERVICE_STATUS_MAP["active"])
                all_services.extend(services)
        return {"services": all_services, "error": None}
    except HTTPException as e:
        return {"services": [], "error": e.detail}
    except Exception as e:
        return {"services": [], "error": str(e)[:100]}

@router.get("/clients/{client_id}/splynx/invoices")
async def get_splynx_invoices(client_id: str, current_user: dict = Depends(get_current_user)):
    config = await get_splynx_config()
    if not config:
        return {"invoices": [], "error": "Splynx not configured"}
    link = await db.splynx_links.find_one({"client_id": client_id}, {"_id": 0})
    if not link or not link.get("splynx_customer_id"):
        return {"invoices": [], "error": "Client not linked to Splynx"}
    sid = link["splynx_customer_id"]
    try:
        invoices = await splynx_get(config, "admin/finance/invoices", params={
            "main_attributes[customer_id]": sid,
            "order[date_created]": "DESC",
            "limit": "50"
        })
        if invoices and isinstance(invoices, list):
            return {"invoices": invoices, "error": None}
        return {"invoices": [], "error": None}
    except Exception as e:
        return {"invoices": [], "error": str(e)[:100]}

# ============== SEARCH SPLYNX CUSTOMERS ==============

@router.get("/splynx/customers/search")
async def search_splynx_customers(q: str = "", current_user: dict = Depends(get_current_user)):
    config = await get_splynx_config()
    if not config:
        return []
    try:
        params = {"limit": "20"}
        if q:
            params["main_attributes[name]"] = f"['LIKE', '%{q}%']"
        customers = await splynx_get(config, "admin/customers/customer", params=params)
        if customers and isinstance(customers, list):
            return [{"id": c["id"], "name": c.get("name", ""), "login": c.get("login", ""),
                      "email": c.get("email", ""), "phone": c.get("phone", ""),
                      "status": c.get("status", "active")} for c in customers[:20]]
        return []
    except Exception:
        return []

# ============== SPLYNX STATUS OVERVIEW FOR ALL CLIENTS ==============

@router.get("/splynx/overview")
async def get_splynx_overview(current_user: dict = Depends(get_current_user)):
    config = await get_splynx_config()
    links = await db.splynx_links.find({"linked": True}, {"_id": 0}).to_list(1000)
    if not config or not links:
        return {"linked_clients": 0, "total_services": 0, "active_services": 0, "suspended_services": 0, "clients": []}

    clients_data = []
    total_services = 0
    active_services = 0
    suspended_services = 0

    for link in links:
        client = await db.clients.find_one({"id": link["client_id"]}, {"_id": 0, "id": 1, "name": 1})
        if not client:
            continue
        sid = link["splynx_customer_id"]
        client_services = []
        try:
            for stype in SERVICE_TYPES:
                services = await splynx_get(config, f"admin/customers/customer/{sid}/{stype}-services")
                if services and isinstance(services, list):
                    for s in services:
                        status = s.get("status", "active").lower()
                        client_services.append({
                            "description": s.get("description", s.get("tariff_name", "Service")),
                            "type": stype,
                            "status": status,
                        })
                        total_services += 1
                        if status == "active":
                            active_services += 1
                        elif status in ("disabled", "blocked", "stopped"):
                            suspended_services += 1
        except Exception:
            pass

        has_suspended = any(s["status"] in ("disabled", "blocked", "stopped") for s in client_services)
        clients_data.append({
            "client_id": client["id"],
            "client_name": client["name"],
            "splynx_id": sid,
            "services": client_services,
            "total": len(client_services),
            "active": sum(1 for s in client_services if s["status"] == "active"),
            "suspended": sum(1 for s in client_services if s["status"] in ("disabled", "blocked", "stopped")),
            "has_suspended": has_suspended,
        })

    clients_data.sort(key=lambda x: (-x["suspended"], -x["total"]))
    return {
        "linked_clients": len(links),
        "total_services": total_services,
        "active_services": active_services,
        "suspended_services": suspended_services,
        "clients": clients_data,
    }


# ============== NON-PAYMENT SYNC & AUTO-SUSPEND ==============

@router.get("/splynx/non-payment")
async def get_non_payment_customers(current_user: dict = Depends(get_current_user)):
    """Get all linked customers with overdue invoices or suspended services"""
    config = await get_splynx_config()
    links = await db.splynx_links.find({"linked": True}, {"_id": 0}).to_list(1000)
    if not config or not links:
        return {"customers": [], "total_overdue": 0, "total_suspended": 0, "auto_suspend_enabled": False}

    settings = await db.settings.find_one({"type": "splynx_suspend"}, {"_id": 0})
    auto_enabled = settings.get("auto_suspend_enabled", False) if settings else False
    grace_days = settings.get("grace_days", 14) if settings else 14

    overdue_customers = []
    total_overdue_amount = 0
    total_suspended = 0

    for link in links:
        client = await db.clients.find_one({"id": link["client_id"]}, {"_id": 0, "id": 1, "name": 1, "email": 1})
        if not client:
            continue
        sid = link["splynx_customer_id"]
        try:
            invoices = await splynx_get(config, "admin/finance/invoices", params={
                "main_attributes[customer_id]": sid,
                "main_attributes[status]": "unpaid",
                "limit": "50"
            })
            if not invoices or not isinstance(invoices, list):
                invoices = []
            unpaid = [inv for inv in invoices if inv.get("status", "").lower() in ("unpaid", "overdue")]
            if not unpaid:
                continue

            overdue_amount = sum(float(inv.get("total", 0)) for inv in unpaid)
            oldest_due = min((inv.get("date_due", "") for inv in unpaid if inv.get("date_due")), default="")

            # Check suspension state
            local_record = await db.splynx_suspensions.find_one({"client_id": client["id"]}, {"_id": 0})
            is_suspended = local_record.get("suspended", False) if local_record else False

            overdue_customers.append({
                "client_id": client["id"],
                "client_name": client["name"],
                "client_email": client.get("email", ""),
                "splynx_id": sid,
                "unpaid_invoices": len(unpaid),
                "overdue_amount": round(overdue_amount, 2),
                "oldest_due_date": oldest_due,
                "is_suspended": is_suspended,
                "suspended_at": local_record.get("suspended_at") if local_record else None,
                "suspended_by": local_record.get("suspended_by") if local_record else None,
            })
            total_overdue_amount += overdue_amount
            if is_suspended:
                total_suspended += 1
        except Exception:
            pass

    overdue_customers.sort(key=lambda x: (-x["overdue_amount"]))
    return {
        "customers": overdue_customers,
        "total_overdue": round(total_overdue_amount, 2),
        "total_overdue_count": len(overdue_customers),
        "total_suspended": total_suspended,
        "auto_suspend_enabled": auto_enabled,
        "grace_days": grace_days,
    }

@router.post("/splynx/suspend/{client_id}")
async def suspend_client(client_id: str, data: dict = {}, current_user: dict = Depends(get_current_user)):
    """Suspend a client's services in Splynx and record locally"""
    config = await get_splynx_config()
    link = await db.splynx_links.find_one({"client_id": client_id}, {"_id": 0})
    if not link or not link.get("splynx_customer_id"):
        raise HTTPException(status_code=400, detail="Client not linked to Splynx")
    sid = link["splynx_customer_id"]

    # Try to suspend in Splynx
    suspended_in_splynx = False
    try:
        if config:
            url = config["url"].rstrip("/")
            headers = build_auth_header(config)
            import httpx as hx
            async with hx.AsyncClient(timeout=30, verify=False) as cl:
                resp = await cl.put(f"{url}/api/2.0/admin/customers/customer/{sid}",
                    headers=headers, json={"status": "disabled"})
                suspended_in_splynx = resp.status_code == 200
    except Exception:
        pass

    await db.splynx_suspensions.update_one({"client_id": client_id}, {"$set": {
        "client_id": client_id, "splynx_id": sid,
        "suspended": True, "suspended_in_splynx": suspended_in_splynx,
        "suspended_at": datetime.now(timezone.utc).isoformat(),
        "suspended_by": current_user.get("name", ""),
        "reason": data.get("reason", "Non-payment"),
    }}, upsert=True)

    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    import uuid
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()), "user_id": current_user["id"],
        "title": f"Service Suspended: {client.get('name', client_id) if client else client_id}",
        "message": f"Client suspended for non-payment.{' Synced to Splynx.' if suspended_in_splynx else ' Manual sync to Splynx may be needed.'}",
        "severity": "critical", "type": "service_suspend", "read": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"message": "Client suspended", "synced_to_splynx": suspended_in_splynx}

@router.post("/splynx/unsuspend/{client_id}")
async def unsuspend_client(client_id: str, current_user: dict = Depends(get_current_user)):
    """Unsuspend a client's services"""
    config = await get_splynx_config()
    link = await db.splynx_links.find_one({"client_id": client_id}, {"_id": 0})
    sid = link.get("splynx_customer_id", "") if link else ""

    unsuspended_in_splynx = False
    try:
        if config and sid:
            url = config["url"].rstrip("/")
            headers = build_auth_header(config)
            import httpx as hx
            async with hx.AsyncClient(timeout=30, verify=False) as cl:
                resp = await cl.put(f"{url}/api/2.0/admin/customers/customer/{sid}",
                    headers=headers, json={"status": "active"})
                unsuspended_in_splynx = resp.status_code == 200
    except Exception:
        pass

    await db.splynx_suspensions.update_one({"client_id": client_id}, {"$set": {
        "suspended": False, "unsuspended_at": datetime.now(timezone.utc).isoformat(),
        "unsuspended_by": current_user.get("name", ""),
    }})
    return {"message": "Client unsuspended", "synced_to_splynx": unsuspended_in_splynx}

@router.get("/settings/splynx-suspend")
async def get_suspend_settings(current_user: dict = Depends(get_current_user)):
    doc = await db.settings.find_one({"type": "splynx_suspend"}, {"_id": 0})
    return doc or {"type": "splynx_suspend", "auto_suspend_enabled": False, "grace_days": 14, "notify_before_suspend_days": 7, "notify_client": True}

@router.put("/settings/splynx-suspend")
async def update_suspend_settings(data: dict, current_user: dict = Depends(get_current_user)):
    data["type"] = "splynx_suspend"
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.settings.update_one({"type": "splynx_suspend"}, {"$set": data}, upsert=True)
    return {"message": "Suspend settings updated"}

@router.post("/splynx/auto-suspend-check")
async def auto_suspend_check(current_user: dict = Depends(get_current_user)):
    """Check all overdue customers and auto-suspend if enabled and past grace period"""
    settings = await db.settings.find_one({"type": "splynx_suspend"}, {"_id": 0})
    if not settings or not settings.get("auto_suspend_enabled"):
        return {"message": "Auto-suspend disabled", "suspended": 0, "warned": 0}

    grace_days = settings.get("grace_days", 14)
    warn_days = settings.get("notify_before_suspend_days", 7)
    config = await get_splynx_config()
    links = await db.splynx_links.find({"linked": True}, {"_id": 0}).to_list(1000)

    suspended_count = 0
    warned_count = 0

    for link in links:
        client = await db.clients.find_one({"id": link["client_id"]}, {"_id": 0, "id": 1, "name": 1})
        if not client:
            continue
        sid = link["splynx_customer_id"]
        already = await db.splynx_suspensions.find_one({"client_id": client["id"], "suspended": True}, {"_id": 0})
        if already:
            continue

        try:
            if not config:
                continue
            invoices = await splynx_get(config, "admin/finance/invoices", params={
                "main_attributes[customer_id]": sid,
                "main_attributes[status]": "unpaid",
                "limit": "10"
            })
            if not invoices or not isinstance(invoices, list):
                continue
            unpaid = [inv for inv in invoices if inv.get("status", "").lower() in ("unpaid", "overdue")]
            if not unpaid:
                continue

            oldest_due = min((inv.get("date_due", "") for inv in unpaid if inv.get("date_due")), default="")
            if not oldest_due:
                continue

            from datetime import datetime as dt
            try:
                due_date = dt.strptime(oldest_due, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            except Exception:
                continue
            days_overdue = (datetime.now(timezone.utc) - due_date).days

            import uuid
            if days_overdue >= grace_days:
                # Auto-suspend
                try:
                    url = config["url"].rstrip("/")
                    headers = build_auth_header(config)
                    import httpx as hx
                    async with hx.AsyncClient(timeout=30, verify=False) as cl:
                        await cl.put(f"{url}/api/2.0/admin/customers/customer/{sid}",
                            headers=headers, json={"status": "disabled"})
                except Exception:
                    pass
                await db.splynx_suspensions.update_one({"client_id": client["id"]}, {"$set": {
                    "client_id": client["id"], "splynx_id": sid, "suspended": True,
                    "suspended_at": datetime.now(timezone.utc).isoformat(),
                    "suspended_by": "Auto-Suspend System", "reason": f"Overdue {days_overdue} days",
                }}, upsert=True)
                admins = await db.users.find({"$or": [{"role": "admin"}, {"is_admin": True}]}, {"_id": 0, "id": 1}).to_list(50)
                for a in admins:
                    await db.notifications.insert_one({
                        "id": str(uuid.uuid4()), "user_id": a["id"],
                        "title": f"AUTO-SUSPENDED: {client['name']}",
                        "message": f"Services suspended after {days_overdue} days overdue. Total unpaid: {len(unpaid)} invoices.",
                        "severity": "critical", "type": "auto_suspend", "read": False,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    })
                suspended_count += 1
            elif days_overdue >= (grace_days - warn_days):
                # Send warning
                admins = await db.users.find({"$or": [{"role": "admin"}, {"is_admin": True}]}, {"_id": 0, "id": 1}).to_list(50)
                for a in admins:
                    await db.notifications.insert_one({
                        "id": str(uuid.uuid4()), "user_id": a["id"],
                        "title": f"Payment Warning: {client['name']}",
                        "message": f"Client is {days_overdue} days overdue. Auto-suspend in {grace_days - days_overdue} days.",
                        "severity": "warning", "type": "payment_warning", "read": False,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    })
                warned_count += 1
        except Exception:
            pass

    return {"message": f"Auto-suspend check complete. {suspended_count} suspended, {warned_count} warned.", "suspended": suspended_count, "warned": warned_count}
