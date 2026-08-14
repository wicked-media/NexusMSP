from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.services.scope_permissions import assert_client_scope, assert_global_scope, assert_record_scope, scoped_query
from app.models import *

router = APIRouter()

DEFAULT_CONTRACT_TYPES = [
    {"code": "managed_services", "name": "Managed Services", "description": "Ongoing managed IT agreement", "color": "blue", "default_billing_frequency": "monthly", "default_sla_tier": "standard", "is_active": True},
    {"code": "break_fix", "name": "Break/Fix", "description": "Ad-hoc support agreement", "color": "amber", "default_billing_frequency": "monthly", "default_sla_tier": "standard", "is_active": True},
    {"code": "project", "name": "Project", "description": "Fixed-scope delivery agreement", "color": "violet", "default_billing_frequency": "monthly", "default_sla_tier": "standard", "is_active": True},
    {"code": "retainer", "name": "Retainer", "description": "Prepaid advisory or vCIO capacity", "color": "emerald", "default_billing_frequency": "monthly", "default_sla_tier": "standard", "is_active": True},
]

async def _ensure_contract_types():
    if await db.contract_types.count_documents({}) == 0:
        now = datetime.now(timezone.utc).isoformat()
        await db.contract_types.insert_many([{**row, "id": str(uuid.uuid4()), "created_at": now, "updated_at": now} for row in DEFAULT_CONTRACT_TYPES])


async def _contract_or_404(contract_id: str, current_user: dict) -> dict:
    return await assert_record_scope(
        current_user,
        db.contracts,
        contract_id,
        operation="contract.access",
        resource_name="Contract",
    )


async def _line_item_or_404(item_id: str, current_user: dict) -> dict:
    return await assert_record_scope(
        current_user,
        db.line_items,
        item_id,
        operation="contract.line_item.access",
        resource_name="Line item",
    )

@router.get("/contract-types")
async def list_contract_types(include_inactive: bool = False, current_user: dict = Depends(get_current_user)):
    await assert_global_scope(current_user, operation="contract.type.read")
    await _ensure_contract_types()
    query = {} if include_inactive else {"is_active": True}
    return await db.contract_types.find(query, {"_id": 0}).sort("name", 1).to_list(200)

@router.post("/contract-types")
async def create_contract_type(data: dict, current_user: dict = Depends(get_current_user)):
    await assert_global_scope(current_user, operation="contract.type.create")
    name = str(data.get("name") or "").strip()
    code = str(data.get("code") or name.lower().replace(" ", "_")).strip().lower()
    if not name or not code:
        raise HTTPException(status_code=400, detail="Name and code are required")
    if await db.contract_types.find_one({"code": code}):
        raise HTTPException(status_code=409, detail="A contract type with this code already exists")
    now = datetime.now(timezone.utc).isoformat()
    doc = {"id": str(uuid.uuid4()), "code": code, "name": name, "description": data.get("description", ""), "color": data.get("color", "blue"), "default_billing_frequency": data.get("default_billing_frequency", "monthly"), "default_sla_tier": data.get("default_sla_tier", "standard"), "is_active": bool(data.get("is_active", True)), "created_at": now, "updated_at": now}
    await db.contract_types.insert_one(doc)
    await log_activity(current_user, "created", "contract_type", doc["id"], name, f"Created contract type {code}")
    return doc

@router.put("/contract-types/{type_id}")
async def update_contract_type(type_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    await assert_global_scope(current_user, operation="contract.type.update")
    current = await db.contract_types.find_one({"id": type_id}, {"_id": 0})
    if not current:
        raise HTTPException(status_code=404, detail="Contract type not found")
    update = {key: data[key] for key in ("name", "description", "color", "default_billing_frequency", "default_sla_tier", "is_active") if key in data}
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.contract_types.update_one({"id": type_id}, {"$set": update})
    await log_activity(current_user, "updated", "contract_type", type_id, current.get("name", ""), "Updated contract type", changes=update)
    return {"message": "Contract type updated"}


async def _resolve_billing_inclusion(item: dict) -> dict:
    """Resolve dynamic contract quantities without mutating the source inclusion."""
    resolved = dict(item)
    source = item.get("billing_source") or ("asset_backed" if item.get("line_type") == "asset_backed" else "manual")
    if source == "asset_count":
        query = {"client_id": item.get("client_id"), "status": "active"}
        if item.get("asset_type_filter"):
            query["asset_type"] = item["asset_type_filter"]
        resolved["quantity"] = await db.assets.count_documents(query)
        resolved["source_label"] = f"Live asset count{': ' + item['asset_type_filter'] if item.get('asset_type_filter') else ''}"
    elif source == "inventory" and item.get("product_id"):
        product = await db.products.find_one({"id": item["product_id"]}, {"_id": 0, "quantity_in_stock": 1, "name": 1})
        resolved["quantity"] = int((product or {}).get("quantity_in_stock", 0))
        resolved["source_label"] = f"Warehouse stock: {(product or {}).get('name', item.get('name', 'Product'))}"
    resolved["total"] = round(float(resolved.get("quantity", 0)) * float(resolved.get("unit_price", 0)), 2)
    return resolved


def _recurring_line(item: dict) -> dict:
    qty = float(item.get("quantity", 1))
    rate = float(item.get("unit_price", 0))
    return {"description": item.get("name", ""), "details": item.get("description", ""), "quantity": qty, "rate": rate, "amount": round(qty * rate, 2), "source_line_item_id": item.get("id"), "line_type": item.get("line_type", "standard"), "billing_source": item.get("billing_source", "manual"), "asset_id": item.get("asset_id"), "asset_serial_number": item.get("asset_serial_number"), "term_end": item.get("term_end"), "asset_type_filter": item.get("asset_type_filter"), "product_id": item.get("product_id")}

# ============== CONTRACTS ENDPOINTS ==============

@router.get("/contracts", response_model=List[Contract])
async def get_contracts(
    client_id: Optional[str] = None,
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if client_id:
        await assert_client_scope(current_user, client_id, operation="contract.list")
        query["client_id"] = client_id
    if status:
        query["status"] = status
    
    contracts = await db.contracts.find(scoped_query(current_user, query), {"_id": 0}).to_list(1000)
    for c in contracts:
        if isinstance(c.get('created_at'), str):
            c['created_at'] = datetime.fromisoformat(c['created_at'])
    return contracts

@router.get("/contracts/renewal-alerts")
async def get_renewal_alerts(current_user: dict = Depends(get_current_user)):
    """Get contracts expiring within 90 days"""
    now = datetime.now(timezone.utc)
    alerts = []
    for days, urgency in [(30, "critical"), (60, "warning"), (90, "info")]:
        cutoff = (now + timedelta(days=days)).isoformat()
        contracts = await db.contracts.find(scoped_query(current_user, {
            "status": "active",
            "end_date": {"$lte": cutoff, "$gte": now.isoformat()}
        }), {"_id": 0}).to_list(100)
        for c in contracts:
            end = c.get("end_date", "")
            if end:
                try:
                    end_dt = datetime.fromisoformat(end.replace("Z", "+00:00"))
                    if end_dt.tzinfo is None:
                        end_dt = end_dt.replace(tzinfo=timezone.utc)
                    days_left = (end_dt - now).days
                except:
                    days_left = 0
            else:
                days_left = 0
            alerts.append({
                "contract_id": c["id"],
                "contract_name": c.get("name"),
                "client_name": c.get("client_name"),
                "client_id": c.get("client_id"),
                "end_date": end,
                "days_remaining": days_left,
                "urgency": urgency,
                "value": c.get("value", 0),
                "sla_tier": c.get("sla_tier", "standard"),
            })
    alerts.sort(key=lambda x: x["days_remaining"])
    return alerts

@router.get("/contracts/summary")
async def get_contracts_summary(current_user: dict = Depends(get_current_user)):
    """Get contracts summary with value and SLA tier breakdown"""
    now = datetime.now(timezone.utc)
    active = await db.contracts.find(scoped_query(current_user, {"status": "active"}), {"_id": 0}).to_list(1000)
    total_value = sum(c.get("value", 0) for c in active)
    expiring_30 = sum(1 for c in active if c.get("end_date") and c["end_date"] <= (now + timedelta(days=30)).isoformat() and c["end_date"] >= now.isoformat())
    expiring_60 = sum(1 for c in active if c.get("end_date") and c["end_date"] <= (now + timedelta(days=60)).isoformat() and c["end_date"] >= now.isoformat())
    tiers = {}
    for c in active:
        tier = c.get("sla_tier", "standard")
        if tier not in tiers:
            tiers[tier] = {"count": 0, "value": 0}
        tiers[tier]["count"] += 1
        tiers[tier]["value"] += c.get("value", 0)
    return {
        "total_active": len(active),
        "total_value": total_value,
        "expiring_30": expiring_30,
        "expiring_60": expiring_60,
        "by_tier": tiers,
    }

@router.get("/contracts/auto-renewal-proposals")
async def get_auto_renewal_proposals(current_user: dict = Depends(get_current_user)):
    """Get auto-renewal proposals with upsell opportunities for contracts expiring within 60 days"""
    now = datetime.now(timezone.utc)
    cutoff = (now + timedelta(days=60)).strftime("%Y-%m-%d")
    
    contracts = await db.contracts.find(scoped_query(current_user, {
        "status": "active",
        "end_date": {"$lte": cutoff, "$ne": "", "$exists": True},
    }), {"_id": 0}).to_list(100)
    
    proposals = []
    for c in contracts:
        client = await db.clients.find_one({"id": c.get("client_id")}, {"_id": 0})
        devices = await db.devices.count_documents({"client_id": c.get("client_id")})
        tickets_30d = await db.tickets.count_documents({
            "client_id": c.get("client_id"),
            "created_at": {"$gte": (now - timedelta(days=30)).isoformat()}
        })
        
        upsell = []
        current_value = float(c.get("value", 0))
        sla_tier = c.get("sla_tier", "standard")
        
        if sla_tier == "standard":
            upsell.append({"type": "sla_upgrade", "description": "Upgrade to Silver SLA (8h response)", "additional_mrr": current_value * 0.15})
        elif sla_tier == "silver":
            upsell.append({"type": "sla_upgrade", "description": "Upgrade to Gold SLA (4h response)", "additional_mrr": current_value * 0.2})
        elif sla_tier == "gold":
            upsell.append({"type": "sla_upgrade", "description": "Upgrade to Platinum SLA (1h response)", "additional_mrr": current_value * 0.3})
        
        if devices < 10:
            upsell.append({"type": "device_expansion", "description": f"Currently managing {devices} devices - room for fleet expansion", "additional_mrr": 15 * (10 - devices)})
        
        if tickets_30d > 5:
            upsell.append({"type": "proactive", "description": "High ticket volume - suggest proactive monitoring package", "additional_mrr": 200})
        
        try:
            end = datetime.strptime(c["end_date"][:10], "%Y-%m-%d")
            days_remaining = (end - now.replace(tzinfo=None)).days
        except:
            days_remaining = 30
        
        proposals.append({
            "contract_id": c["id"],
            "contract_name": c.get("name", ""),
            "client_id": c.get("client_id", ""),
            "client_name": c.get("client_name", client.get("name", "") if client else ""),
            "current_value": current_value,
            "sla_tier": sla_tier,
            "end_date": c.get("end_date", ""),
            "days_remaining": days_remaining,
            "auto_renew": c.get("auto_renew", False),
            "upsell_opportunities": upsell,
            "total_upsell_potential": sum(u.get("additional_mrr", 0) for u in upsell),
            "recommended_new_value": current_value + sum(u.get("additional_mrr", 0) for u in upsell),
        })
    
    proposals.sort(key=lambda x: x["days_remaining"])
    
    return {
        "proposals": proposals,
        "total_current_mrr": sum(p["current_value"] for p in proposals),
        "total_potential_mrr": sum(p["recommended_new_value"] for p in proposals),
        "total_upsell_potential": sum(p["total_upsell_potential"] for p in proposals),
    }

@router.get("/contracts/{contract_id}")
async def get_contract(contract_id: str, current_user: dict = Depends(get_current_user)):
    return await _contract_or_404(contract_id, current_user)

@router.post("/contracts", response_model=Contract)
async def create_contract(contract_data: ContractCreate, current_user: dict = Depends(get_current_user)):
    await assert_client_scope(current_user, contract_data.client_id, operation="contract.create")
    client = await db.clients.find_one({"id": contract_data.client_id}, {"_id": 0})
    client_name = client['name'] if client else None
    
    contract = Contract(**contract_data.model_dump(), client_name=client_name)
    doc = contract.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.contracts.insert_one(doc)
    return contract

@router.put("/contracts/{contract_id}")
async def update_contract(contract_id: str, contract_data: dict, current_user: dict = Depends(get_current_user)):
    existing = await _contract_or_404(contract_id, current_user)
    if "client_id" in contract_data and contract_data["client_id"] != existing.get("client_id"):
        await assert_client_scope(current_user, contract_data["client_id"], operation="contract.reassign")
    result = await db.contracts.update_one({"id": contract_id}, {"$set": contract_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Contract not found")
    return {"message": "Contract updated"}

@router.delete("/contracts/{contract_id}")
async def delete_contract(contract_id: str, current_user: dict = Depends(get_current_user)):
    await _contract_or_404(contract_id, current_user)
    result = await db.contracts.delete_one({"id": contract_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Contract not found")
    return {"message": "Contract deleted"}

# ============== LINE ITEMS ENDPOINTS ==============

@router.get("/line-items", response_model=List[LineItem])
async def get_line_items(
    contract_id: Optional[str] = None,
    client_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if contract_id:
        await _contract_or_404(contract_id, current_user)
        query["contract_id"] = contract_id
    if client_id:
        await assert_client_scope(current_user, client_id, operation="contract.line_item.list")
        query["client_id"] = client_id
    
    items = await db.line_items.find(scoped_query(current_user, query), {"_id": 0}).to_list(1000)
    for i in items:
        if isinstance(i.get('created_at'), str):
            i['created_at'] = datetime.fromisoformat(i['created_at'])
        if isinstance(i.get('synced_at'), str):
            i['synced_at'] = datetime.fromisoformat(i['synced_at'])
    return items

@router.post("/line-items", response_model=LineItem)
async def create_line_item(item_data: LineItemCreate, current_user: dict = Depends(get_current_user)):
    await assert_client_scope(current_user, item_data.client_id, operation="contract.line_item.create")
    contract = await _contract_or_404(item_data.contract_id, current_user)
    if contract.get("client_id") != item_data.client_id:
        raise HTTPException(status_code=422, detail="Contract line item must belong to the contract client")
    client = await db.clients.find_one({"id": item_data.client_id}, {"_id": 0})
    client_name = client['name'] if client else None
    
    if item_data.line_type == "asset_backed":
        item_data.billing_source = "asset_backed"
        if not item_data.asset_id:
            raise HTTPException(status_code=400, detail="Choose an asset for an asset-backed line")
        asset = await db.assets.find_one({"id": item_data.asset_id}, {"_id": 0})
        if not asset:
            raise HTTPException(status_code=404, detail="Asset not found")
        await assert_client_scope(
            current_user,
            asset.get("client_id"),
            operation="contract.line_item.asset_link",
            mask_not_found=True,
        )
        if item_data.client_id and asset.get("client_id") and asset.get("client_id") != item_data.client_id:
            raise HTTPException(status_code=400, detail="The asset belongs to a different client")
        existing = await db.line_items.find_one({"asset_id": item_data.asset_id, "asset_status": "active"}, {"_id": 0, "id": 1})
        if existing:
            raise HTTPException(status_code=409, detail="This asset is already locked to another active contract line")
        item_data.asset_name = asset.get("name", item_data.asset_name)
        item_data.asset_serial_number = asset.get("serial_number", item_data.asset_serial_number)
        item_data.asset_imei = asset.get("imei", item_data.asset_imei)
        item_data.billing_lock = True
    if item_data.billing_source == "pax8_subscription":
        link = await db.pax8_company_links.find_one({"client_id": item_data.client_id}, {"_id": 0})
        if not link:
            raise HTTPException(status_code=400, detail="Link this client to a Pax8 company before adding a live subscription inclusion")
        if not item_data.pax8_product_id:
            raise HTTPException(status_code=400, detail="Choose a Pax8 subscription product")
        item_data.quantity = 0
        item_data.unit_price = 0
        item_data.source_label = "Live Pax8 subscription — invoiced from current seats"

    total = item_data.quantity * item_data.unit_price
    
    item = LineItem(**item_data.model_dump(), client_name=client_name, total=total)
    doc = item.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    if doc.get('synced_at'):
        doc['synced_at'] = doc['synced_at'].isoformat()
    await db.line_items.insert_one(doc)
    if item.line_type == "asset_backed":
        await db.assets.update_one({"id": item.asset_id}, {"$set": {
            "contract_id": item.contract_id, "contract_line_item_id": item.id,
            "billing_lock": True, "billing_status": "active"
        }})
    await log_activity(current_user, "created", "contract_line_item", item.id, item.name,
                       f"Added {item.line_type.replace('_', ' ')} billing inclusion", metadata={"contract_id": item.contract_id, "asset_id": item.asset_id})
    return item

@router.put("/line-items/{item_id}")
async def update_line_item(item_id: str, item_data: dict, current_user: dict = Depends(get_current_user)):
    existing = await _line_item_or_404(item_id, current_user)
    protected = {"asset_id", "asset_name", "asset_serial_number", "asset_imei", "asset_status", "billing_lock", "asset_history"}
    if protected.intersection(item_data) and existing.get("line_type") == "asset_backed":
        raise HTTPException(status_code=400, detail="Use Replace asset or Return asset to change a locked asset")
    if 'quantity' in item_data and 'unit_price' in item_data:
        item_data['total'] = item_data['quantity'] * item_data['unit_price']
    result = await db.line_items.update_one({"id": item_id}, {"$set": item_data})
    await log_activity(current_user, "updated", "contract_line_item", item_id, existing.get("name", ""),
                       "Updated billing inclusion", changes=item_data, metadata={"contract_id": existing.get("contract_id")})
    return {"message": "Line item updated"}

@router.delete("/line-items/{item_id}")
async def delete_line_item(item_id: str, current_user: dict = Depends(get_current_user)):
    item = await _line_item_or_404(item_id, current_user)
    if item.get("line_type") == "asset_backed" and item.get("asset_status") == "active":
        raise HTTPException(status_code=400, detail="Return or replace the locked asset before removing this line")
    result = await db.line_items.delete_one({"id": item_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Line item not found")
    return {"message": "Line item deleted"}

@router.get("/contracts/{contract_id}/billing-inclusions")
async def get_contract_billing_inclusions(contract_id: str, current_user: dict = Depends(get_current_user)):
    """Contract inclusions plus their immutable asset lifecycle audit trail."""
    await _contract_or_404(contract_id, current_user)
    items = await db.line_items.find({"contract_id": contract_id}, {"_id": 0}).to_list(500)
    audits = await db.activity_logs.find({"entity_type": "contract_line_item", "metadata.contract_id": contract_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return {"items": items, "audit": audits}

@router.get("/contracts/{contract_id}/billing-sources")
async def get_contract_billing_sources(contract_id: str, current_user: dict = Depends(get_current_user)):
    """Candidates and live indicators for source-driven contract inclusions."""
    contract = await _contract_or_404(contract_id, current_user)
    client_id = contract.get("client_id")
    asset_types = await db.assets.distinct("asset_type", {"client_id": client_id, "status": "active"})
    asset_counts = [{"asset_type": t or "hardware", "quantity": await db.assets.count_documents({"client_id": client_id, "status": "active", "asset_type": t})} for t in asset_types]
    products = await db.products.find({"is_active": {"$ne": False}}, {"_id": 0, "id": 1, "name": 1, "sku": 1, "quantity_in_stock": 1, "retail_price": 1, "track_inventory": 1}).to_list(500)
    pax8_link = await db.pax8_company_links.find_one({"client_id": client_id}, {"_id": 0})
    pax8_products = []
    if pax8_link:
        subs = await db.pax8_subscriptions.find({"companyId": pax8_link.get("pax8_company_id"), "status": "Active"}, {"_id": 0, "productId": 1, "quantity": 1, "price": 1, "billingTerm": 1}).to_list(500)
        product_ids = list({sub.get("productId") for sub in subs if sub.get("productId")})
        names = {p["id"]: p async for p in db.pax8_products.find({"id": {"$in": product_ids}}, {"_id": 0, "id": 1, "name": 1, "vendorName": 1})}
        grouped = {}
        for sub in subs:
            pid = sub.get("productId")
            if not pid: continue
            entry = grouped.setdefault(pid, {"product_id": pid, "name": (names.get(pid) or {}).get("name", "Unknown product"), "vendor": (names.get(pid) or {}).get("vendorName", ""), "quantity": 0, "unit_price": float(sub.get("price") or 0), "billing_term": sub.get("billingTerm", "Monthly")})
            entry["quantity"] += float(sub.get("quantity") or 0)
        pax8_products = list(grouped.values())
    return {"asset_counts": asset_counts, "products": products, "pax8_linked": bool(pax8_link), "pax8_products": pax8_products}


@router.get("/contracts/{contract_id}/billing-health")
async def get_contract_billing_health(contract_id: str, current_user: dict = Depends(get_current_user)):
    """Pre-billing controls: source connectivity, quantity and duplicate-charge risk."""
    contract = await _contract_or_404(contract_id, current_user)
    items = await db.line_items.find({"contract_id": contract_id, "$or": [{"asset_status": {"$exists": False}}, {"asset_status": "active"}]}, {"_id": 0}).to_list(500)
    ri = await db.recurring_invoices.find_one({"id": contract.get("recurring_invoice_id")}, {"_id": 0}) if contract.get("recurring_invoice_id") else None
    checks = []
    pax8_link = await db.pax8_company_links.find_one({"client_id": contract.get("client_id")}, {"_id": 0})
    for item in items:
        source = item.get("billing_source") or ("asset_backed" if item.get("line_type") == "asset_backed" else "manual")
        if source == "pax8_subscription":
            ok = bool(pax8_link and ri and ri.get("include_pax8_usage"))
            checks.append({"item_id": item["id"], "name": item.get("name"), "source": source, "state": "ready" if ok else "attention", "detail": "Current seats will be attached at generation" if ok else "Link Pax8 and sync this contract to its recurring invoice"})
        elif source == "asset_count":
            resolved = await _resolve_billing_inclusion(item)
            quantity = resolved.get("quantity", 0)
            checks.append({"item_id": item["id"], "name": item.get("name"), "source": source, "state": "ready" if quantity else "attention", "quantity": quantity, "detail": f"{quantity} active client asset(s) match the source" if quantity else "No active client assets currently match this source"})
        elif source == "asset_backed":
            ok = bool(item.get("asset_id") and item.get("billing_lock"))
            checks.append({"item_id": item["id"], "name": item.get("name"), "source": source, "state": "ready" if ok else "attention", "detail": f"Locked to {item.get('asset_serial_number') or item.get('asset_name', 'asset')}" if ok else "Asset lock is missing"})
        else:
            checks.append({"item_id": item["id"], "name": item.get("name"), "source": source, "state": "ready", "detail": "Static contract inclusion"})
    overall = "ready" if ri and all(check["state"] == "ready" for check in checks) else "attention"
    return {"contract_id": contract_id, "recurring_invoice_id": contract.get("recurring_invoice_id"), "recurring_status": (ri or {}).get("status"), "next_generation": (ri or {}).get("next_generation"), "overall": overall, "checks": checks}

@router.post("/line-items/{item_id}/replace-asset")
async def replace_line_item_asset(item_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    item = await _line_item_or_404(item_id, current_user)
    if item.get("line_type") != "asset_backed":
        raise HTTPException(status_code=404, detail="Asset-backed line item not found")
    if item.get("asset_status") != "active":
        raise HTTPException(status_code=400, detail="Only an active asset-backed line can be replaced")
    new_asset_id = data.get("asset_id")
    new_asset = await db.assets.find_one({"id": new_asset_id}, {"_id": 0})
    if not new_asset:
        raise HTTPException(status_code=404, detail="Replacement asset not found")
    await assert_client_scope(current_user, new_asset.get("client_id"), operation="contract.line_item.replace_asset", mask_not_found=True)
    if new_asset.get("client_id") and new_asset.get("client_id") != item.get("client_id"):
        raise HTTPException(status_code=400, detail="The replacement asset belongs to a different client")
    locked = await db.line_items.find_one({"asset_id": new_asset_id, "asset_status": "active", "id": {"$ne": item_id}}, {"_id": 0, "id": 1})
    if locked:
        raise HTTPException(status_code=409, detail="The replacement asset is already locked to another active contract line")
    now = datetime.now(timezone.utc).isoformat()
    history = {"asset_id": item.get("asset_id"), "asset_name": item.get("asset_name"), "serial_number": item.get("asset_serial_number"), "imei": item.get("asset_imei"), "status": "replaced", "reason": data.get("reason", "Asset replacement"), "effective_date": data.get("effective_date") or now[:10], "changed_at": now, "changed_by": current_user.get("name", "System")}
    if item.get("asset_id"):
        await db.assets.update_one({"id": item["asset_id"]}, {"$set": {"billing_lock": False, "billing_status": "replaced", "contract_line_item_id": None}})
    update = {"asset_id": new_asset_id, "asset_name": new_asset.get("name", ""), "asset_serial_number": new_asset.get("serial_number", ""), "asset_imei": new_asset.get("imei", ""), "asset_status": "active", "billing_lock": True, "updated_at": now}
    await db.line_items.update_one({"id": item_id}, {"$set": update, "$push": {"asset_history": history}})
    await db.assets.update_one({"id": new_asset_id}, {"$set": {"contract_id": item.get("contract_id"), "contract_line_item_id": item_id, "billing_lock": True, "billing_status": "active"}})
    await log_activity(current_user, "asset_replaced", "contract_line_item", item_id, item.get("name", ""), f"Replaced {history['serial_number'] or history['asset_name']} with {new_asset.get('serial_number') or new_asset.get('name')}", metadata={"contract_id": item.get("contract_id"), "old_asset_id": history["asset_id"], "new_asset_id": new_asset_id, "reason": history["reason"]})
    return {"message": "Asset replaced and billing lock transferred"}

@router.post("/line-items/{item_id}/return-asset")
async def return_line_item_asset(item_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    item = await _line_item_or_404(item_id, current_user)
    if item.get("line_type") != "asset_backed":
        raise HTTPException(status_code=404, detail="Asset-backed line item not found")
    if item.get("asset_status") != "active":
        raise HTTPException(status_code=400, detail="This asset is already closed")
    now = datetime.now(timezone.utc).isoformat()
    reason = data.get("reason", "Returned")
    await db.line_items.update_one({"id": item_id}, {"$set": {"asset_status": "returned", "billing_lock": False, "ended_at": now, "end_reason": reason}, "$push": {"asset_history": {"asset_id": item.get("asset_id"), "asset_name": item.get("asset_name"), "serial_number": item.get("asset_serial_number"), "status": "returned", "reason": reason, "effective_date": data.get("effective_date") or now[:10], "changed_at": now, "changed_by": current_user.get("name", "System")}}})
    if item.get("asset_id"):
        await db.assets.update_one({"id": item["asset_id"]}, {"$set": {"billing_lock": False, "billing_status": "returned", "contract_line_item_id": None}})
    await log_activity(current_user, "asset_returned", "contract_line_item", item_id, item.get("name", ""), f"Returned asset {item.get('asset_serial_number') or item.get('asset_name')}: {reason}", metadata={"contract_id": item.get("contract_id"), "asset_id": item.get("asset_id")})
    return {"message": "Asset returned; it will be excluded when the recurring invoice is synchronised"}


# ============== CONTRACT ENHANCEMENTS ==============

@router.post("/contracts/{contract_id}/link-recurring")
async def link_contract_to_recurring(contract_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Link a contract to an existing or new recurring invoice."""
    contract = await _contract_or_404(contract_id, current_user)
    ri_id = data.get("recurring_invoice_id")
    if ri_id:
        ri = await db.recurring_invoices.find_one({"id": ri_id})
        if not ri:
            raise HTTPException(status_code=404, detail="Recurring invoice not found")
        await assert_client_scope(current_user, ri.get("client_id"), operation="contract.link_recurring", mask_not_found=True)
        if ri.get("client_id") != contract.get("client_id"):
            raise HTTPException(status_code=422, detail="Recurring invoice must belong to the contract client")
        await db.recurring_invoices.update_one({"id": ri_id}, {"$set": {"contract_id": contract_id}})
        await db.contracts.update_one({"id": contract_id}, {"$set": {"recurring_invoice_id": ri_id}})
        return {"message": "Contract linked to recurring invoice", "recurring_invoice_id": ri_id}
    return {"message": "No recurring invoice ID provided"}


@router.get("/contracts/{contract_id}/recurring-invoices")
async def get_contract_recurring_invoices(contract_id: str, current_user: dict = Depends(get_current_user)):
    """Get all recurring invoices linked to a contract."""
    await _contract_or_404(contract_id, current_user)
    ris = await db.recurring_invoices.find(
        scoped_query(current_user, {"contract_id": contract_id}), {"_id": 0}
    ).to_list(50)
    return ris


@router.post("/contracts/{contract_id}/apply-price-increase")
async def apply_price_increase(contract_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Apply a price increase to a contract and its linked recurring invoices."""
    contract = await _contract_or_404(contract_id, current_user)

    increase_pct = float(data.get("increase_percent", 0))
    increase_flat = float(data.get("increase_flat", 0))
    reason = data.get("reason", "Annual price adjustment")
    effective_date = data.get("effective_date", datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    now = datetime.now(timezone.utc).isoformat()

    if increase_pct <= 0 and increase_flat <= 0:
        raise HTTPException(status_code=400, detail="Provide increase_percent or increase_flat")

    # Update contract value
    old_value = float(contract.get("value", 0))
    old_mrr = float(contract.get("mrr", 0))
    if increase_pct > 0:
        new_value = round(old_value * (1 + increase_pct / 100), 2)
        new_mrr = round(old_mrr * (1 + increase_pct / 100), 2)
    else:
        new_value = round(old_value + increase_flat, 2)
        new_mrr = round(old_mrr + increase_flat, 2)

    # Log the increase
    increase_log = {
        "date": now, "effective_date": effective_date, "reason": reason,
        "old_value": old_value, "new_value": new_value,
        "increase_percent": increase_pct, "increase_flat": increase_flat,
        "applied_by": current_user.get("name", ""),
    }

    await db.contracts.update_one({"id": contract_id}, {
        "$set": {"value": new_value, "mrr": new_mrr, "updated_at": now},
        "$push": {"price_history": increase_log},
    })

    # Also update linked recurring invoices
    updated_ris = 0
    ris = await db.recurring_invoices.find({"contract_id": contract_id, "status": "active"}, {"_id": 0}).to_list(50)
    for ri in ris:
        old_amount = float(ri.get("amount", 0))
        if increase_pct > 0:
            new_amount = round(old_amount * (1 + increase_pct / 100), 2)
        else:
            new_amount = round(old_amount + increase_flat, 2)
        # Update line items proportionally
        new_items = []
        for li in ri.get("line_items", []):
            new_li = {**li}
            old_li_amount = float(li.get("amount", 0))
            if increase_pct > 0:
                new_li["amount"] = round(old_li_amount * (1 + increase_pct / 100), 2)
                new_li["rate"] = round(float(li.get("rate", 0)) * (1 + increase_pct / 100), 2)
            new_items.append(new_li)
        subtotal = sum(float(li.get("amount", 0)) for li in new_items)
        tax_rate = float(ri.get("tax_rate", 10))
        tax_amount = round(subtotal * tax_rate / 100, 2)
        await db.recurring_invoices.update_one({"id": ri["id"]}, {"$set": {
            "line_items": new_items, "subtotal": subtotal, "tax_amount": tax_amount,
            "amount": round(subtotal + tax_amount, 2), "updated_at": now,
        }})
        updated_ris += 1

    return {
        "message": f"Price increase applied. Contract: ${old_value} → ${new_value}. Updated {updated_ris} recurring invoice(s).",
        "old_value": old_value, "new_value": new_value, "recurring_invoices_updated": updated_ris,
    }


@router.post("/contracts/{contract_id}/convert-to-recurring")
async def convert_contract_to_recurring(contract_id: str, data: dict = None, current_user: dict = Depends(get_current_user)):
    """Convert a contract's line items into a recurring invoice template.
    Automatically links the contract ↔ recurring invoice.
    Body (optional): {frequency, tax_rate, payment_terms, auto_send, include_acronis_usage}"""
    data = data or {}
    contract = await _contract_or_404(contract_id, current_user)

    # Gather line items for this contract
    items = await db.line_items.find({"contract_id": contract_id, "$or": [{"asset_status": {"$exists": False}}, {"asset_status": "active"}]}, {"_id": 0}).to_list(500)
    if not items:
        raise HTTPException(status_code=400, detail="Contract has no line items to convert")

    # Build recurring invoice line items (normalized shape used by recurring_invoices router)
    ri_items = []
    has_pax8_source = False
    for li in items:
        if li.get("billing_source") == "pax8_subscription":
            has_pax8_source = True
            continue  # Invoice generation appends the current Pax8 seat quantities.
        row = _recurring_line(await _resolve_billing_inclusion(li))
        row.update({"acronis_offering_code": li.get("acronis_offering_code"), "acronis_synced": li.get("acronis_synced", False)})
        ri_items.append(row)

    subtotal = round(sum(li["amount"] for li in ri_items), 2)
    tax_rate = float(data.get("tax_rate", 10 if contract.get("country", "AU") == "AU" else 0))
    tax_amount = round(subtotal * tax_rate / 100, 2)
    total = round(subtotal + tax_amount, 2)

    frequency = data.get("frequency", contract.get("billing_frequency", "monthly"))
    now = datetime.now(timezone.utc)

    # Determine next_generation via helper in recurring_invoices
    def _next(start, freq):
        try:
            d = datetime.strptime(start, "%Y-%m-%d")
        except Exception:
            d = now
        if freq == "monthly":
            m = d.month + 1 if d.month < 12 else 1
            y = d.year if d.month < 12 else d.year + 1
            return datetime(y, m, min(d.day, 28)).strftime("%Y-%m-%d")
        if freq == "quarterly":
            return (d + timedelta(days=92)).strftime("%Y-%m-%d")
        if freq == "annually":
            return datetime(d.year + 1, d.month, min(d.day, 28)).strftime("%Y-%m-%d")
        return (d + timedelta(days=30)).strftime("%Y-%m-%d")

    start_date = data.get("start_date") or now.strftime("%Y-%m-%d")
    ri = {
        "id": f"ri-{uuid.uuid4().hex[:8]}",
        "client_id": contract.get("client_id", ""),
        "client_name": contract.get("client_name", ""),
        "description": f"Recurring — {contract.get('name', 'Contract')}",
        "line_items": ri_items,
        "subtotal": subtotal,
        "tax_rate": tax_rate,
        "tax_amount": tax_amount,
        "amount": total,
        "currency": data.get("currency", "AUD"),
        "frequency": frequency,
        "start_date": start_date,
        "next_generation": _next(start_date, frequency),
        "end_date": contract.get("end_date"),
        "contract_id": contract_id,
        "payment_terms": data.get("payment_terms", "net_30"),
        "notes": data.get("notes", f"Auto-generated from contract {contract.get('name', '')}"),
        "auto_send": bool(data.get("auto_send", False)),
        "auto_send_email": data.get("auto_send_email", ""),
        "include_pdf": True,
        "include_acronis_usage": bool(data.get("include_acronis_usage", True)),
        "include_pax8_usage": has_pax8_source,
        "status": "active",
        "invoices_generated": 0,
        "total_billed": 0,
        "last_generated": None,
        "generation_history": [],
        "created_by": current_user.get("name", ""),
        "created_at": now.isoformat(),
        "updated_at": now.isoformat(),
    }
    await db.recurring_invoices.insert_one(ri)
    await db.contracts.update_one({"id": contract_id}, {"$set": {"recurring_invoice_id": ri["id"]}})
    await db.line_items.update_many({"contract_id": contract_id}, {"$set": {"linked_recurring_invoice_id": ri["id"]}})
    await log_activity(current_user, "recurring_invoice_created", "contract", contract_id, contract.get("name", ""), "Created linked recurring invoice from active billing inclusions", metadata={"recurring_invoice_id": ri["id"]})

    return {
        "message": f"Created recurring invoice with {len(ri_items)} line item(s). Next run: {ri['next_generation']}.",
        "recurring_invoice_id": ri["id"],
        "amount": total,
        "currency": ri["currency"],
        "line_items": len(ri_items),
        "next_generation": ri["next_generation"],
    }


@router.post("/contracts/{contract_id}/sync-recurring")
async def sync_contract_recurring(contract_id: str, current_user: dict = Depends(get_current_user)):
    """Refresh contract-owned invoice lines without touching vendor-usage additions."""
    contract = await _contract_or_404(contract_id, current_user)
    if not contract or not contract.get("recurring_invoice_id"):
        raise HTTPException(status_code=404, detail="No linked recurring invoice found")
    ri = await db.recurring_invoices.find_one({"id": contract["recurring_invoice_id"]}, {"_id": 0})
    if not ri:
        raise HTTPException(status_code=404, detail="Linked recurring invoice not found")
    items = await db.line_items.find({"contract_id": contract_id, "$or": [{"asset_status": {"$exists": False}}, {"asset_status": "active"}]}, {"_id": 0}).to_list(500)
    contract_lines = [_recurring_line(await _resolve_billing_inclusion(li)) for li in items if li.get("billing_source") != "pax8_subscription"]
    has_pax8_source = any(li.get("billing_source") == "pax8_subscription" for li in items)
    external_lines = [line for line in ri.get("line_items", []) if not line.get("source_line_item_id")]
    all_lines = contract_lines + external_lines
    subtotal = round(sum(float(line.get("amount", 0)) for line in all_lines), 2)
    tax_rate = float(ri.get("tax_rate", 0))
    await db.recurring_invoices.update_one({"id": ri["id"]}, {"$set": {"line_items": all_lines, "include_pax8_usage": has_pax8_source or ri.get("include_pax8_usage", False), "subtotal": subtotal, "tax_amount": round(subtotal * tax_rate / 100, 2), "amount": round(subtotal * (1 + tax_rate / 100), 2), "updated_at": datetime.now(timezone.utc).isoformat()}})
    await log_activity(current_user, "recurring_invoice_synced", "contract", contract_id, contract.get("name", ""), f"Synced {len(contract_lines)} active billing inclusion(s)", metadata={"recurring_invoice_id": ri["id"]})
    return {"message": "Recurring invoice synchronised", "active_lines": len(contract_lines), "recurring_invoice_id": ri["id"]}


@router.get("/contracts/{contract_id}/price-history")
async def get_price_history(contract_id: str, current_user: dict = Depends(get_current_user)):
    contract = await _contract_or_404(contract_id, current_user)
    return contract.get("price_history", [])

