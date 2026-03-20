from fastapi import APIRouter, Depends
from app.database import db
from app.auth import get_current_user
from datetime import datetime, timezone, timedelta

router = APIRouter(prefix="/sla-penalties", tags=["SLA Penalties"])

@router.get("/dashboard")
async def get_sla_penalty_dashboard(user=Depends(get_current_user)):
    contracts = await db.contracts.find({"status": "active"}, {"_id": 0}).to_list(200)
    breaches = await db.sla_breaches.find({}, {"_id": 0}).sort("breached_at", -1).to_list(500)
    penalties = await db.sla_penalties.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    
    total_penalties = sum(p.get("amount", 0) for p in penalties)
    pending_credits = sum(p.get("amount", 0) for p in penalties if p.get("status") == "pending")
    issued_credits = sum(p.get("amount", 0) for p in penalties if p.get("status") == "issued")
    
    return {
        "stats": {
            "total_breaches": len(breaches),
            "total_penalties": round(total_penalties, 2),
            "pending_credits": round(pending_credits, 2),
            "issued_credits": round(issued_credits, 2),
            "contracts_affected": len(set(b.get("contract_id") for b in breaches if b.get("contract_id"))),
        },
        "recent_breaches": breaches[:20],
        "penalties": penalties,
    }

@router.post("/calculate/{contract_id}")
async def calculate_sla_penalty(contract_id: str, user=Depends(get_current_user)):
    contract = await db.contracts.find_one({"id": contract_id}, {"_id": 0})
    if not contract:
        return {"error": "Contract not found"}
    
    tickets = await db.tickets.find({"client_id": contract.get("client_id")}, {"_id": 0}).to_list(500)
    
    breach_count = 0
    total_penalty = 0.0
    contract_value = contract.get("value", 0)
    
    for t in tickets:
        if t.get("sla_due") and t.get("status") not in ["resolved", "closed"]:
            try:
                sla_due = datetime.fromisoformat(t["sla_due"].replace("Z", "+00:00")) if isinstance(t["sla_due"], str) else t["sla_due"]
                if datetime.now(timezone.utc) > sla_due:
                    breach_count += 1
                    penalty_pct = {"critical": 5, "high": 3, "medium": 1, "low": 0.5}.get(t.get("priority", "low"), 0.5)
                    penalty_amount = round(contract_value * penalty_pct / 100, 2)
                    total_penalty += penalty_amount
            except (ValueError, TypeError):
                pass
    
    penalty_doc = {
        "id": f"pen-{contract_id}-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M')}",
        "contract_id": contract_id,
        "client_id": contract.get("client_id"),
        "client_name": contract.get("client_name"),
        "contract_name": contract.get("name"),
        "breaches": breach_count,
        "amount": round(min(total_penalty, contract_value * 0.25), 2),
        "contract_value": contract_value,
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "calculated_by": user.get("name", "System"),
    }
    
    if breach_count > 0:
        await db.sla_penalties.insert_one(penalty_doc)
    
    # Remove MongoDB _id before returning
    return {k: v for k, v in penalty_doc.items() if k != "_id"}

@router.post("/{penalty_id}/issue-credit")
async def issue_credit(penalty_id: str, user=Depends(get_current_user)):
    await db.sla_penalties.update_one(
        {"id": penalty_id},
        {"$set": {"status": "issued", "issued_by": user.get("name"), "issued_at": datetime.now(timezone.utc).isoformat()}}
    )
    return {"message": "Credit note issued"}
