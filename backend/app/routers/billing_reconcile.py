"""
Recurring invoice reconciliation: detect bill-shock drift between billed
quantities and actual device counts under each Acronis backup plan.

Workflow:
  1. Each recurring invoice line item can carry `acronis_policy_id` (and `client_id` is
     read from the parent recurring invoice).
  2. We pull all Acronis applications for that policy, intersect with devices linked
     to that client (via Acronis resource ID stored on device.acronis_resource_id),
     and count.
  3. Compare to `quantity` on the line item. Flag drift.
"""
from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
import httpx
from app.database import db
from app.auth import get_current_user
from app.services.integrations import acronis_service

router = APIRouter()


async def _count_devices_under_policy(policy_id: str, client_id: str | None) -> dict:
    """Return {acronis_count, mapped_devices, mapped_count, resource_ids_under_policy}."""
    try:
        token = await acronis_service.get_token()
        api_url, _, _ = await acronis_service.get_credentials()
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(
                f"{api_url}/api/policy_management/v4/applications?policy_id={policy_id}",
                headers={"Authorization": f"Bearer {token}"},
            )
            if resp.status_code != 200:
                return {"acronis_count": 0, "mapped_devices": [], "mapped_count": 0, "resource_ids": [], "error": f"{resp.status_code}"}
            data = resp.json()
    except Exception as e:
        return {"acronis_count": 0, "mapped_devices": [], "mapped_count": 0, "resource_ids": [], "error": str(e)}

    apps = data.get("items", []) if isinstance(data, dict) else []
    resource_ids = []
    for app in apps:
        if not isinstance(app, dict):
            continue
        if app.get("enabled") is False:
            continue
        ctx = app.get("context", {}) or {}
        rid = ctx.get("id")
        if rid:
            resource_ids.append(rid)

    # Match Acronis resource IDs against devices.acronis_resource_id (preferred) or devices.acronis_id
    mapped = []
    if resource_ids:
        query = {"$or": [
            {"acronis_resource_id": {"$in": resource_ids}},
            {"acronis_id": {"$in": resource_ids}},
        ]}
        if client_id:
            query["client_id"] = client_id
        mapped = await db.devices.find(
            query,
            {"_id": 0, "id": 1, "name": 1, "client_id": 1, "client_name": 1, "acronis_resource_id": 1, "acronis_id": 1}
        ).to_list(2000)

    return {
        "acronis_count": len(resource_ids),
        "mapped_devices": mapped,
        "mapped_count": len(mapped),
        "resource_ids": resource_ids,
    }


@router.get("/billing/reconcile-recurring/{ri_id}")
async def reconcile_recurring_invoice(ri_id: str, current_user: dict = Depends(get_current_user)):
    """Compare billed quantities to actual device counts (per Acronis policy)."""
    ri = await db.recurring_invoices.find_one({"id": ri_id}, {"_id": 0})
    if not ri:
        raise HTTPException(status_code=404, detail="Recurring invoice not found")

    client_id = ri.get("client_id")
    line_items = ri.get("line_items", []) or []
    rows = []
    drift_count = 0
    bill_shock = 0  # amount over-billed or under-billed

    for li in line_items:
        if not isinstance(li, dict):
            continue
        billed = int(li.get("quantity") or 0)
        unit_price = float(li.get("unit_price") or 0)
        policy_id = li.get("acronis_policy_id")
        result = {
            "description": li.get("description", ""),
            "quantity_billed": billed,
            "unit_price": unit_price,
            "policy_id": policy_id,
            "policy_linked": bool(policy_id),
            "actual_count": None,
            "drift": None,
            "drift_severity": None,
            "bill_shock_amount": 0,
            "mapped_devices": [],
        }
        if policy_id:
            counts = await _count_devices_under_policy(policy_id, client_id)
            actual = counts.get("mapped_count", 0)
            result["actual_count"] = actual
            result["acronis_count"] = counts.get("acronis_count", 0)
            result["mapped_devices"] = counts.get("mapped_devices", [])[:25]
            drift = actual - billed
            result["drift"] = drift
            severity = "ok"
            if drift != 0:
                drift_count += 1
                # Severity: critical if >20% drift or >5 absolute, warning otherwise
                pct = abs(drift) / max(1, billed) * 100
                if abs(drift) >= 5 or pct >= 20:
                    severity = "critical"
                elif abs(drift) >= 2 or pct >= 10:
                    severity = "warning"
                else:
                    severity = "minor"
            result["drift_severity"] = severity
            result["bill_shock_amount"] = round(drift * unit_price, 2)
            bill_shock += result["bill_shock_amount"]
        rows.append(result)

    return {
        "recurring_invoice_id": ri_id,
        "description": ri.get("description", ""),
        "client_id": client_id,
        "client_name": ri.get("client_name", ""),
        "scanned_at": datetime.now(timezone.utc).isoformat(),
        "line_items": rows,
        "summary": {
            "total_line_items": len(rows),
            "policy_linked": sum(1 for r in rows if r["policy_linked"]),
            "drift_count": drift_count,
            "bill_shock_amount": round(bill_shock, 2),
            "currency": ri.get("currency", "AUD"),
        },
    }


@router.put("/billing/recurring/{ri_id}/line-items/{idx}/link-policy")
async def link_line_item_to_policy(ri_id: str, idx: int, body: dict, current_user: dict = Depends(get_current_user)):
    """Set or clear the acronis_policy_id on a recurring invoice line item by index."""
    ri = await db.recurring_invoices.find_one({"id": ri_id}, {"_id": 0})
    if not ri:
        raise HTTPException(status_code=404, detail="Recurring invoice not found")
    line_items = list(ri.get("line_items") or [])
    if idx < 0 or idx >= len(line_items):
        raise HTTPException(status_code=400, detail="Invalid line item index")
    policy_id = (body or {}).get("acronis_policy_id") or None
    line_items[idx]["acronis_policy_id"] = policy_id
    await db.recurring_invoices.update_one(
        {"id": ri_id},
        {"$set": {"line_items": line_items, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    return {"message": "Linked" if policy_id else "Unlinked", "line_item": line_items[idx]}


@router.get("/devices/{device_id}/acronis")
async def get_device_acronis_info(device_id: str, current_user: dict = Depends(get_current_user)):
    """Get applied Acronis backup plans + recent activities for a single device.

    Resolves the device's acronis_resource_id (or falls back to matching device.name
    against Acronis resource names) and queries policy_management/v4/applications.
    """
    device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    # Resolve Acronis resource id
    resource_id = device.get("acronis_resource_id") or device.get("acronis_id")
    matched_by = "explicit"
    if not resource_id:
        # Try name-based fallback
        try:
            r = await acronis_service.get_resources()
            items = r.get("items", []) if isinstance(r, dict) else []
            d_name = (device.get("name") or "").lower().strip()
            d_host = (device.get("hostname") or "").lower().strip()
            for res in items:
                if not isinstance(res, dict):
                    continue
                rname = (res.get("name") or "").lower().strip()
                if rname and (rname == d_name or rname == d_host):
                    resource_id = res.get("id")
                    matched_by = "name_match"
                    break
        except Exception:
            pass

    if not resource_id:
        return {
            "device_id": device_id,
            "acronis_resource_id": None,
            "matched_by": "none",
            "applications": [],
            "recent_activities": [],
            "message": "No Acronis resource linked. Set device.acronis_resource_id manually or run a sync.",
        }

    # Fetch applications + recent activities for this resource
    applications = []
    recent = []
    try:
        token = await acronis_service.get_token()
        api_url, _, _ = await acronis_service.get_credentials()
        async with httpx.AsyncClient(timeout=20.0) as client:
            ar = await client.get(
                f"{api_url}/api/policy_management/v4/applications?context_id={resource_id}",
                headers={"Authorization": f"Bearer {token}"},
            )
            if ar.status_code == 200:
                for app in (ar.json() or {}).get("items", []):
                    if not isinstance(app, dict):
                        continue
                    pol = app.get("policy", {}) or {}
                    applications.append({
                        "application_id": app.get("id"),
                        "policy_id": pol.get("id"),
                        "policy_name": pol.get("name"),
                        "policy_type": pol.get("type"),
                        "enabled": app.get("enabled", True),
                        "state": app.get("state"),
                    })
            # Activities for this resource
            actr = await client.get(
                f"{api_url}/api/task_manager/v2/activities?context.id={resource_id}&limit=20&order=desc(startedAt)",
                headers={"Authorization": f"Bearer {token}"},
            )
            if actr.status_code == 200:
                for a in (actr.json() or {}).get("items", []):
                    ctx = a.get("context", {}) or {}
                    p = a.get("policy", {}) or {}
                    recent.append({
                        "id": a.get("idString", a.get("uuid", "")),
                        "state": a.get("state"),
                        "phase": ctx.get("phase"),
                        "activity_type": ctx.get("activityType"),
                        "policy_name": p.get("name"),
                        "started_at": a.get("startedAt"),
                        "completed_at": a.get("completedAt"),
                    })
    except Exception as e:
        return {
            "device_id": device_id,
            "acronis_resource_id": resource_id,
            "matched_by": matched_by,
            "applications": [],
            "recent_activities": [],
            "error": str(e),
        }

    return {
        "device_id": device_id,
        "acronis_resource_id": resource_id,
        "matched_by": matched_by,
        "applications": applications,
        "recent_activities": recent,
    }


@router.put("/devices/{device_id}/acronis-link")
async def link_device_to_acronis(device_id: str, body: dict, current_user: dict = Depends(get_current_user)):
    """Manually link a device to an Acronis resource id."""
    resource_id = (body or {}).get("acronis_resource_id")
    device = await db.devices.find_one({"id": device_id}, {"_id": 0, "id": 1})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    update = {"acronis_resource_id": resource_id, "updated_at": datetime.now(timezone.utc).isoformat()}
    await db.devices.update_one({"id": device_id}, {"$set": update})
    return {"message": "Linked" if resource_id else "Unlinked", "acronis_resource_id": resource_id}
