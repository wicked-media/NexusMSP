from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import uuid, random

router = APIRouter()

@router.get("/recurring-invoices/list")
async def get_recurring_invoices(current_user: dict = Depends(get_current_user)):
    invoices = await db.recurring_invoices.find({}, {"_id": 0}).to_list(200)
    if not invoices:
        invoices = await _seed_recurring()
    return invoices

@router.post("/recurring-invoices/create")
async def create_recurring(data: dict, current_user: dict = Depends(get_current_user)):
    inv = {**data, "id": f"ri-{uuid.uuid4().hex[:8]}", "created_by": current_user.get("name"), "created_at": datetime.now(timezone.utc).isoformat(), "status": "active", "invoices_generated": 0}
    await db.recurring_invoices.insert_one(inv)
    inv.pop("_id", None)
    return inv

@router.put("/recurring-invoices/{invoice_id}")
async def update_recurring(invoice_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    await db.recurring_invoices.update_one({"id": invoice_id}, {"$set": data})
    return {"status": "updated"}

async def _seed_recurring():
    now = datetime.now(timezone.utc)
    invoices = [
        {"id": "ri-001", "client_name": "Acme Corporation", "client_id": "client-001", "description": "Monthly Managed IT Services", "amount": 4500.00, "frequency": "monthly", "next_generation": (now + timedelta(days=12)).strftime("%Y-%m-%d"), "contract_id": "contract-001", "line_items": [{"description": "Managed IT - 45 endpoints", "quantity": 45, "rate": 85, "amount": 3825}, {"description": "M365 License Management", "quantity": 1, "rate": 675, "amount": 675}], "status": "active", "invoices_generated": 14, "last_generated": (now - timedelta(days=18)).isoformat(), "created_by": "Alex Thompson"},
        {"id": "ri-002", "client_name": "Global Finance Ltd", "client_id": "client-003", "description": "Monthly IT Support & Security", "amount": 12800.00, "frequency": "monthly", "next_generation": (now + timedelta(days=5)).strftime("%Y-%m-%d"), "contract_id": "contract-003", "status": "active", "invoices_generated": 24, "last_generated": (now - timedelta(days=25)).isoformat()},
        {"id": "ri-003", "client_name": "HealthCare Plus", "client_id": "client-004", "description": "HIPAA Compliant IT Management", "amount": 7200.00, "frequency": "monthly", "next_generation": (now + timedelta(days=8)).strftime("%Y-%m-%d"), "status": "active", "invoices_generated": 18},
        {"id": "ri-004", "client_name": "TechStart Inc", "client_id": "client-002", "description": "Quarterly Security Audit", "amount": 3500.00, "frequency": "quarterly", "next_generation": (now + timedelta(days=45)).strftime("%Y-%m-%d"), "status": "active", "invoices_generated": 4},
        {"id": "ri-005", "client_name": "Summit Legal Group", "client_id": "client-006", "description": "Monthly IT Services + Compliance", "amount": 5600.00, "frequency": "monthly", "next_generation": (now + timedelta(days=15)).strftime("%Y-%m-%d"), "status": "active", "invoices_generated": 8},
    ]
    for i in invoices:
        await db.recurring_invoices.insert_one(i)
    return [dict((k, v) for k, v in i.items() if k != "_id") for i in invoices]
