from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.models import *

router = APIRouter()

# ============== CONTRACTS ENDPOINTS ==============

@router.get("/contracts", response_model=List[Contract])
async def get_contracts(
    client_id: Optional[str] = None,
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if client_id:
        query["client_id"] = client_id
    if status:
        query["status"] = status
    
    contracts = await db.contracts.find(query, {"_id": 0}).to_list(1000)
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
        contracts = await db.contracts.find({
            "status": "active",
            "end_date": {"$lte": cutoff, "$gte": now.isoformat()}
        }, {"_id": 0}).to_list(100)
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
    active = await db.contracts.find({"status": "active"}, {"_id": 0}).to_list(1000)
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
    
    contracts = await db.contracts.find({
        "status": "active",
        "end_date": {"$lte": cutoff, "$ne": "", "$exists": True},
    }, {"_id": 0}).to_list(100)
    
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
    contract = await db.contracts.find_one({"id": contract_id}, {"_id": 0})
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found")
    return contract

@router.post("/contracts", response_model=Contract)
async def create_contract(contract_data: ContractCreate, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": contract_data.client_id}, {"_id": 0})
    client_name = client['name'] if client else None
    
    contract = Contract(**contract_data.model_dump(), client_name=client_name)
    doc = contract.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.contracts.insert_one(doc)
    return contract

@router.put("/contracts/{contract_id}")
async def update_contract(contract_id: str, contract_data: dict, current_user: dict = Depends(get_current_user)):
    result = await db.contracts.update_one({"id": contract_id}, {"$set": contract_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Contract not found")
    return {"message": "Contract updated"}

@router.delete("/contracts/{contract_id}")
async def delete_contract(contract_id: str, current_user: dict = Depends(get_current_user)):
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
        query["contract_id"] = contract_id
    if client_id:
        query["client_id"] = client_id
    
    items = await db.line_items.find(query, {"_id": 0}).to_list(1000)
    for i in items:
        if isinstance(i.get('created_at'), str):
            i['created_at'] = datetime.fromisoformat(i['created_at'])
        if isinstance(i.get('synced_at'), str):
            i['synced_at'] = datetime.fromisoformat(i['synced_at'])
    return items

@router.post("/line-items", response_model=LineItem)
async def create_line_item(item_data: LineItemCreate, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": item_data.client_id}, {"_id": 0})
    client_name = client['name'] if client else None
    
    total = item_data.quantity * item_data.unit_price
    
    item = LineItem(**item_data.model_dump(), client_name=client_name, total=total)
    doc = item.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    if doc.get('synced_at'):
        doc['synced_at'] = doc['synced_at'].isoformat()
    await db.line_items.insert_one(doc)
    return item

@router.put("/line-items/{item_id}")
async def update_line_item(item_id: str, item_data: dict, current_user: dict = Depends(get_current_user)):
    if 'quantity' in item_data and 'unit_price' in item_data:
        item_data['total'] = item_data['quantity'] * item_data['unit_price']
    result = await db.line_items.update_one({"id": item_id}, {"$set": item_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Line item not found")
    return {"message": "Line item updated"}

@router.delete("/line-items/{item_id}")
async def delete_line_item(item_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.line_items.delete_one({"id": item_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Line item not found")
    return {"message": "Line item deleted"}


# ============== CONTRACT ENHANCEMENTS ==============

@router.post("/contracts/{contract_id}/link-recurring")
async def link_contract_to_recurring(contract_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Link a contract to an existing or new recurring invoice."""
    contract = await db.contracts.find_one({"id": contract_id}, {"_id": 0})
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found")
    ri_id = data.get("recurring_invoice_id")
    if ri_id:
        ri = await db.recurring_invoices.find_one({"id": ri_id})
        if not ri:
            raise HTTPException(status_code=404, detail="Recurring invoice not found")
        await db.recurring_invoices.update_one({"id": ri_id}, {"$set": {"contract_id": contract_id}})
        await db.contracts.update_one({"id": contract_id}, {"$set": {"recurring_invoice_id": ri_id}})
        return {"message": "Contract linked to recurring invoice", "recurring_invoice_id": ri_id}
    return {"message": "No recurring invoice ID provided"}


@router.get("/contracts/{contract_id}/recurring-invoices")
async def get_contract_recurring_invoices(contract_id: str, current_user: dict = Depends(get_current_user)):
    """Get all recurring invoices linked to a contract."""
    ris = await db.recurring_invoices.find({"contract_id": contract_id}, {"_id": 0}).to_list(50)
    return ris


@router.post("/contracts/{contract_id}/apply-price-increase")
async def apply_price_increase(contract_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Apply a price increase to a contract and its linked recurring invoices."""
    contract = await db.contracts.find_one({"id": contract_id}, {"_id": 0})
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found")

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


@router.get("/contracts/{contract_id}/price-history")
async def get_price_history(contract_id: str, current_user: dict = Depends(get_current_user)):
    contract = await db.contracts.find_one({"id": contract_id}, {"_id": 0})
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found")
    return contract.get("price_history", [])

