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


# ============================================================================
# Bulk Auto-Link: Match NexusOps devices to Acronis resources by name
# ============================================================================

@router.post("/devices/auto-link-acronis")
async def auto_link_devices_to_acronis(body: dict | None = None, current_user: dict = Depends(get_current_user)):
    """Bulk job: match NexusOps devices to Acronis resources by name (case-insensitive).
    Body (optional): {"client_id": "..." to scope to a single client, "force": true to re-link already-linked}
    """
    body = body or {}
    client_id = body.get("client_id")
    force = bool(body.get("force", False))

    # Pull all Acronis resources
    try:
        r = await acronis_service.get_resources()
        acronis_items = r.get("items", []) if isinstance(r, dict) else []
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Acronis fetch failed: {str(e)}")

    # Build lookup: name -> id (lowercased)
    name_to_id = {}
    for res in acronis_items:
        if not isinstance(res, dict):
            continue
        rname = (res.get("name") or "").lower().strip()
        rid = res.get("id")
        if rname and rid:
            name_to_id.setdefault(rname, rid)

    # Get devices in scope
    query = {} if not client_id else {"client_id": client_id}
    if not force:
        query["$or"] = [{"acronis_resource_id": {"$in": [None, ""]}}, {"acronis_resource_id": {"$exists": False}}]
    devices = await db.devices.find(query, {"_id": 0, "id": 1, "name": 1, "hostname": 1, "client_name": 1, "acronis_resource_id": 1}).to_list(5000)

    matched = []
    skipped = []
    no_match = []

    for d in devices:
        candidates = []
        for field in ("name", "hostname"):
            v = (d.get(field) or "").lower().strip()
            if v:
                candidates.append(v)
        rid = None
        for c in candidates:
            if c in name_to_id:
                rid = name_to_id[c]
                break
        if rid:
            await db.devices.update_one(
                {"id": d["id"]},
                {"$set": {"acronis_resource_id": rid, "updated_at": datetime.now(timezone.utc).isoformat()}},
            )
            matched.append({"device_id": d["id"], "device_name": d.get("name"), "acronis_resource_id": rid})
        else:
            no_match.append({"device_id": d["id"], "device_name": d.get("name")})

    return {
        "scanned": len(devices),
        "matched": len(matched),
        "no_match": len(no_match),
        "skipped": len(skipped),
        "matched_devices": matched[:50],
        "unmatched_devices": no_match[:50],
        "scanned_at": datetime.now(timezone.utc).isoformat(),
    }


# ============================================================================
# Drift Watchtower: scan every recurring invoice for bill-shock drift
# ============================================================================

@router.get("/billing/drift-watchtower")
async def drift_watchtower(min_drift: int = 1, current_user: dict = Depends(get_current_user)):
    """Scan every active recurring invoice for drift, return summary + worst offenders.
    `min_drift` filters out invoices with drift count below threshold.
    """
    invoices = await db.recurring_invoices.find(
        {"status": {"$ne": "cancelled"}},
        {"_id": 0}
    ).to_list(500)

    rows = []
    total_drift_invoices = 0
    total_bill_shock = 0.0
    total_line_items_drifting = 0

    for inv in invoices:
        ri_id = inv.get("id")
        if not ri_id:
            continue
        client_id = inv.get("client_id")
        line_items = inv.get("line_items", []) or []
        inv_drift_count = 0
        inv_bill_shock = 0.0
        drift_line_items = []
        for li in line_items:
            if not isinstance(li, dict):
                continue
            policy_id = li.get("acronis_policy_id")
            if not policy_id:
                continue
            billed = int(li.get("quantity") or 0)
            unit_price = float(li.get("unit_price") or 0)
            counts = await _count_devices_under_policy(policy_id, client_id)
            actual = counts.get("mapped_count", 0)
            drift = actual - billed
            if drift != 0:
                inv_drift_count += 1
                inv_bill_shock += drift * unit_price
                drift_line_items.append({
                    "description": li.get("description"),
                    "billed": billed,
                    "actual": actual,
                    "drift": drift,
                    "bill_shock": round(drift * unit_price, 2),
                })
        if inv_drift_count >= min_drift:
            total_drift_invoices += 1
            total_bill_shock += inv_bill_shock
            total_line_items_drifting += inv_drift_count
            rows.append({
                "recurring_invoice_id": ri_id,
                "client_id": client_id,
                "client_name": inv.get("client_name", ""),
                "description": inv.get("description"),
                "drift_count": inv_drift_count,
                "bill_shock_amount": round(inv_bill_shock, 2),
                "drift_line_items": drift_line_items,
                "currency": inv.get("currency", "AUD"),
            })

    rows.sort(key=lambda r: abs(r["bill_shock_amount"]), reverse=True)

    return {
        "scanned_invoices": len(invoices),
        "drift_invoices": total_drift_invoices,
        "drifting_line_items": total_line_items_drifting,
        "total_bill_shock_per_period": round(total_bill_shock, 2),
        "annualized_bill_shock_estimate": round(total_bill_shock * 12, 2),
        "currency": "AUD",
        "top_offenders": rows[:20],
        "all_rows": rows,
        "scanned_at": datetime.now(timezone.utc).isoformat(),
    }


@router.post("/billing/drift-watchtower/create-tickets")
async def create_drift_tickets(body: dict | None = None, current_user: dict = Depends(get_current_user)):
    """Auto-create a ticket for every recurring invoice with drift above threshold.
    Body: {"min_pct": 10, "min_abs": 2}
    """
    body = body or {}
    min_pct = float(body.get("min_pct", 10))
    min_abs = int(body.get("min_abs", 2))

    watchtower = await drift_watchtower(min_drift=1, current_user=current_user)
    created = []
    skipped = []

    for row in watchtower.get("all_rows", []):
        # Find a worst-case line item that exceeds threshold
        worst = None
        for li in row.get("drift_line_items", []):
            billed = li.get("billed") or 0
            drift = abs(li.get("drift") or 0)
            pct = (drift / billed * 100) if billed else 100
            if drift >= min_abs or pct >= min_pct:
                if not worst or drift > abs(worst.get("drift") or 0):
                    worst = li
        if not worst:
            skipped.append(row["recurring_invoice_id"])
            continue
        # Skip if a ticket was already auto-created in last 7 days
        recent = await db.tickets.find_one({
            "client_id": row.get("client_id"),
            "tags": {"$in": ["bill-shock", "auto-generated"]},
            "created_at": {"$gte": (datetime.now(timezone.utc) - __import__("datetime").timedelta(days=7)).isoformat()},
        })
        if recent:
            skipped.append(row["recurring_invoice_id"])
            continue

        from app.routers.ticket_suggestions import generate_ticket_number
        bs = row.get("bill_shock_amount", 0)
        bs_word = "under-billing" if bs > 0 else "over-billing"
        title = f"Bill-shock detected: {row.get('client_name', 'client')} ({bs_word} ${abs(bs)}/period)"
        description = (
            f"Drift Watchtower auto-detected drift on recurring invoice {row.get('description')}.\n\n"
            f"Worst-case: {worst.get('description')} — billed {worst.get('billed')}, actual {worst.get('actual')} "
            f"(drift {worst.get('drift'):+d}, ${worst.get('bill_shock'):+.2f}/period).\n\n"
            f"{row.get('drift_count')} line item(s) drifting. Total bill shock: ${bs:+.2f}/period (~${bs * 12:+.2f}/year)."
        )
        ticket_number = await generate_ticket_number("incident")
        new_ticket = {
            "id": __import__("uuid").uuid4().hex,
            "ticket_number": ticket_number,
            "title": title,
            "description": description,
            "client_id": row.get("client_id"),
            "client_name": row.get("client_name"),
            "priority": "high" if abs(bs) > 100 else "medium",
            "status": "open",
            "category": "billing",
            "ticket_type": "task",
            "impact": "medium",
            "source": "internal",
            "tags": ["bill-shock", "auto-generated", "drift-watchtower"],
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "metadata": {
                "recurring_invoice_id": row.get("recurring_invoice_id"),
                "bill_shock_per_period": bs,
                "drift_line_items": row.get("drift_line_items"),
            },
        }
        await db.tickets.insert_one(new_ticket.copy())
        created.append({"ticket_id": new_ticket["id"], "ticket_number": ticket_number, "client_name": row.get("client_name")})

    return {
        "created_count": len(created),
        "skipped_count": len(skipped),
        "created": created,
        "thresholds": {"min_pct": min_pct, "min_abs": min_abs},
        "ran_at": datetime.now(timezone.utc).isoformat(),
    }
