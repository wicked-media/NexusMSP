from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional
from datetime import datetime, timezone, timedelta
from math import isfinite
import uuid
from app.database import db
from app.auth import get_current_user
from app.services.activity import log_activity
from app.services.scope_permissions import assert_client_scope, assert_record_scope, effective_scope, scoped_query
from app.models import *

router = APIRouter()

VALID_AGREEMENT_TYPES = {"rental", "buy_outright", "lease_to_own"}
VALID_PAYMENT_METHODS = {"bank_transfer", "credit_card", "cash", "cheque", "direct_debit"}
RENTAL_PAYMENT_STATUSES = {"active"}
RETURNABLE_RENTAL_STATUSES = {"active", "completed"}


def _amount(value: object, field_name: str) -> float:
    """Parse a finite positive money value without silently accepting NaN/Infinity."""
    try:
        amount = float(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail=f"{field_name} must be a valid amount")
    if not isfinite(amount) or amount <= 0:
        raise HTTPException(status_code=422, detail=f"{field_name} must be greater than zero")
    return round(amount, 2)


async def _rental_or_404(rental_id: str, current_user: dict, operation: str) -> dict:
    return await assert_record_scope(
        current_user,
        db.rentals,
        rental_id,
        operation=operation,
        resource_name="Rental agreement",
    )


def _device_visibility_query(current_user: dict, status: Optional[str] = None) -> dict:
    """Inventory is global, but a restricted technician must never receive another client's phone assignment."""
    clauses: list[dict] = []
    if status:
        clauses.append({"status": status})
    scope = effective_scope(current_user)
    if scope["mode"] == "restricted":
        clauses.append(
            {
                "$or": [
                    {"current_client_id": {"$in": scope["client_ids"]}},
                    {"current_client_id": None},
                    {"current_client_id": {"$exists": False}},
                ]
            }
        )
    if not clauses:
        return {}
    return clauses[0] if len(clauses) == 1 else {"$and": clauses}

# ============== RENTAL DEVICE INVENTORY ==============

@router.get("/rental-devices")
async def get_rental_devices(status: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = _device_visibility_query(current_user, status)
    devices = await db.rental_devices.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    return devices

@router.get("/rental-devices/models")
async def get_yealink_models(current_user: dict = Depends(get_current_user)):
    return YEALINK_MODELS

@router.post("/rental-devices")
async def create_rental_device(data: RentalDeviceCreate, current_user: dict = Depends(get_current_user)):
    # Check duplicate serial
    existing = await db.rental_devices.find_one({"serial_number": data.serial_number})
    if existing:
        raise HTTPException(status_code=400, detail="Serial number already exists")
    device = RentalDevice(**data.model_dump())
    doc = device.model_dump()
    doc["created_at"] = doc["created_at"].isoformat()
    await db.rental_devices.insert_one(doc)
    doc.pop("_id", None)
    return device

@router.put("/rental-devices/{device_id}")
async def update_rental_device(device_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    device = await db.rental_devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if device.get("current_client_id"):
        await assert_client_scope(current_user, device.get("current_client_id"), operation="rental_device.update")

    allowed_fields = {
        "model_name", "serial_number", "mac_address", "imei", "firmware_version", "condition",
        "notes", "purchase_price", "purchase_date", "vendor_id", "vendor_name", "warranty_expiry",
    }
    update = {key: value for key, value in data.items() if key in allowed_fields}
    if not update:
        raise HTTPException(status_code=422, detail="No editable phone fields were supplied")
    if "serial_number" in update and update["serial_number"] != device.get("serial_number"):
        duplicate = await db.rental_devices.find_one({"serial_number": update["serial_number"], "id": {"$ne": device_id}}, {"_id": 0, "id": 1})
        if duplicate:
            raise HTTPException(status_code=409, detail="Serial number already exists")
    if "purchase_price" in update:
        try:
            purchase_price = float(update["purchase_price"])
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="Purchase price must be a valid amount")
        if not isfinite(purchase_price) or purchase_price < 0:
            raise HTTPException(status_code=422, detail="Purchase price cannot be negative")
        update["purchase_price"] = round(purchase_price, 2)
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.rental_devices.update_one({"id": device_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Device not found")
    await log_activity(current_user, "updated", "rental_device", device_id, device.get("model_name", "Phone"), "Updated rental phone inventory details", changes=update)
    return {"message": "Device updated"}

@router.delete("/rental-devices/{device_id}")
async def delete_rental_device(device_id: str, current_user: dict = Depends(get_current_user)):
    device = await db.rental_devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if device.get("current_client_id"):
        await assert_client_scope(current_user, device.get("current_client_id"), operation="rental_device.delete")
    if device.get("current_rental_id"):
        raise HTTPException(status_code=409, detail="Cannot remove a phone linked to an agreement; retain it for rental history")
    await db.rental_devices.delete_one({"id": device_id})
    await log_activity(current_user, "deleted", "rental_device", device_id, device.get("model_name", "Phone"), "Removed unassigned phone from rental inventory")
    return {"message": "Device deleted"}

# ============== RENTAL AGREEMENTS ==============

@router.get("/rentals")
async def get_rentals(client_id: Optional[str] = None, status: Optional[str] = None, agreement_type: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if client_id:
        await assert_client_scope(current_user, client_id, operation="rental.list")
        query["client_id"] = client_id
    if status:
        query["status"] = status
    if agreement_type:
        query["agreement_type"] = agreement_type
    rentals = await db.rentals.find(scoped_query(current_user, query), {"_id": 0}).sort("created_at", -1).to_list(500)
    return rentals

@router.get("/rentals/stats")
async def get_rental_stats(current_user: dict = Depends(get_current_user)):
    rental_query = scoped_query(current_user)
    total = await db.rentals.count_documents(rental_query)
    active = await db.rentals.count_documents(scoped_query(current_user, {"status": "active"}))
    completed = await db.rentals.count_documents(scoped_query(current_user, {"status": "completed"}))
    total_devices = await db.rental_devices.count_documents(_device_visibility_query(current_user))
    available_devices = await db.rental_devices.count_documents(_device_visibility_query(current_user, "available"))
    rented_devices = await db.rental_devices.count_documents(_device_visibility_query(current_user, "rented"))
    sold_devices = await db.rental_devices.count_documents(_device_visibility_query(current_user, "sold"))
    
    # Revenue calculation
    all_rentals = await db.rentals.find(rental_query, {"_id": 0, "amount_paid": 1, "device_cost": 1, "agreement_type": 1, "deposit_amount": 1, "monthly_amount": 1, "total_payments": 1, "status": 1, "next_payment_date": 1}).to_list(1000)
    total_revenue = sum(float(rental.get("amount_paid", 0) or 0) for rental in all_rentals)
    total_expected = sum(float(rental.get("device_cost", 0) or 0) for rental in all_rentals)
    expected_revenue = sum(
        float(rental.get("device_cost", 0) or 0)
        if rental.get("agreement_type") == "buy_outright"
        else float(rental.get("deposit_amount", 0) or 0) + (float(rental.get("monthly_amount", 0) or 0) * int(rental.get("total_payments", 0) or 0))
        for rental in all_rentals
    )
    today = datetime.now(timezone.utc).date().isoformat()
    overdue = sum(1 for rental in all_rentals if rental.get("status") == "active" and rental.get("next_payment_date") and str(rental["next_payment_date"]) < today)
    due_soon_cutoff = (datetime.now(timezone.utc) + timedelta(days=7)).date().isoformat()
    due_soon = sum(1 for rental in all_rentals if rental.get("status") == "active" and rental.get("next_payment_date") and today <= str(rental["next_payment_date"]) <= due_soon_cutoff)
    
    return {
        "total_agreements": total, "active": active, "overdue": overdue, "completed": completed,
        "total_devices": total_devices, "available_devices": available_devices,
        "rented_devices": rented_devices, "sold_devices": sold_devices,
        "total_revenue": total_revenue, "total_expected": total_expected,
        "expected_revenue": expected_revenue,
        "outstanding_balance": max(0, expected_revenue - total_revenue),
        "payments_due_soon": due_soon,
    }

@router.get("/rentals/{rental_id}")
async def get_rental(rental_id: str, current_user: dict = Depends(get_current_user)):
    return await _rental_or_404(rental_id, current_user, "rental.read")

@router.post("/rentals")
async def create_rental(data: RentalAgreementCreate, current_user: dict = Depends(get_current_user)):
    if not data.client_id:
        raise HTTPException(status_code=422, detail="Client is required")
    if data.agreement_type not in VALID_AGREEMENT_TYPES:
        raise HTTPException(status_code=422, detail="Agreement type must be rental, buy_outright, or lease_to_own")
    if data.end_date and data.end_date < data.start_date:
        raise HTTPException(status_code=422, detail="End date cannot be before the start date")
    if data.agreement_type != "buy_outright" and data.monthly_amount <= 0:
        raise HTTPException(status_code=422, detail="A rental or lease-to-own agreement requires a monthly amount")
    await assert_client_scope(current_user, data.client_id, operation="rental.create")
    client = await db.clients.find_one({"id": data.client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    device = await db.rental_devices.find_one({"id": data.device_id}, {"_id": 0})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if device.get("status") not in ("available", "returned"):
        raise HTTPException(status_code=400, detail=f"Device is not available (status: {device.get('status')})")
    contract = None
    if data.sla_contract_id:
        contract = await db.contracts.find_one({"id": data.sla_contract_id, "client_id": data.client_id}, {"_id": 0, "id": 1, "name": 1, "status": 1})
        if not contract:
            raise HTTPException(status_code=422, detail="The selected billing contract does not belong to this client")
        if contract.get("status") != "active":
            raise HTTPException(status_code=409, detail="The selected billing contract is not active")
    
    rental = RentalAgreement(**data.model_dump())
    rental.client_name = client["name"]
    rental.device_model = device.get("model_name", "")
    rental.device_serial = device.get("serial_number", "")
    rental.device_mac = device.get("mac_address", "")
    if contract:
        rental.sla_contract_name = contract.get("name", "")
    
    if data.agreement_type == "buy_outright":
        rental.status = "completed"
        rental.payments_made = 1
        rental.amount_paid = data.device_cost
        rental.deposit_paid = True
    else:
        # Calculate next payment date
        from dateutil.relativedelta import relativedelta
        start = datetime.fromisoformat(data.start_date)
        rental.next_payment_date = (start + relativedelta(months=1)).strftime("%Y-%m-%d")
    
    doc = rental.model_dump()
    doc["created_at"] = doc["created_at"].isoformat()
    doc["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.rentals.insert_one(doc)
    doc.pop("_id", None)
    
    # Update device status
    new_status = "sold" if data.agreement_type == "buy_outright" else "rented"
    await db.rental_devices.update_one({"id": data.device_id}, {"$set": {
        "status": new_status, "current_rental_id": rental.id,
        "current_client_id": data.client_id, "current_client_name": client["name"]
    }})
    
    await log_activity(current_user, "created", "rental", rental.id, f"Rental for {client['name']}", f"{'Sold' if data.agreement_type == 'buy_outright' else 'Rented'} {device.get('model_name')} ({device.get('serial_number')}) to {client['name']}")
    return rental

@router.post("/rentals/{rental_id}/payment")
async def record_rental_payment(rental_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    rental = await _rental_or_404(rental_id, current_user, "rental.payment.record")
    if rental.get("status") not in RENTAL_PAYMENT_STATUSES:
        raise HTTPException(status_code=409, detail="Payments can only be recorded against an active agreement")
    if rental.get("agreement_type") == "buy_outright":
        raise HTTPException(status_code=409, detail="An outright purchase is already settled at creation")
    
    amount = _amount(data.get("amount", rental.get("monthly_amount", 0)), "Payment amount")
    method = data.get("method", "bank_transfer")
    if method not in VALID_PAYMENT_METHODS:
        raise HTTPException(status_code=422, detail="Payment method is not supported")
    note = str(data.get("note", "") or "").strip()[:2000]
    is_deposit = data.get("is_deposit") is True
    
    payment = {
        "id": str(uuid.uuid4()),
        "amount": amount,
        "method": method,
        "note": note,
        "is_deposit": is_deposit,
        "date": datetime.now(timezone.utc).isoformat(),
        "recorded_by": current_user.get("name", ""),
    }
    
    new_paid = float(rental.get("amount_paid", 0)) + amount
    new_payments_made = rental.get("payments_made", 0) + (0 if is_deposit else 1)
    total_payments = rental.get("total_payments", 0)
    
    updates = {
        "amount_paid": new_paid,
        "payments_made": new_payments_made,
    }
    if is_deposit:
        updates["deposit_paid"] = True
    
    # Check if completed
    if total_payments > 0 and new_payments_made >= total_payments:
        updates["status"] = "completed"
    
    # Calculate next payment
    if total_payments > 0 and new_payments_made < total_payments and not is_deposit:
        from dateutil.relativedelta import relativedelta
        now = datetime.now(timezone.utc)
        updates["next_payment_date"] = (now + relativedelta(months=1)).strftime("%Y-%m-%d")
    
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    if updates.get("status") == "completed":
        updates["completed_at"] = datetime.now(timezone.utc).isoformat()
    await db.rentals.update_one({"id": rental_id}, {"$set": updates, "$push": {"payment_history": payment}})
    
    remaining = max(0, total_payments - new_payments_made)
    remaining_amount = max(0, float(rental.get("device_cost", 0)) - new_paid)
    
    await log_activity(
        current_user,
        "payment_recorded",
        "rental",
        rental_id,
        f"Rental for {rental.get('client_name', '')}",
        f"Recorded {method.replace('_', ' ')} payment of ${amount:.2f}",
        metadata={"amount": amount, "method": method, "is_deposit": is_deposit, "remaining_payments": remaining},
    )
    return {"message": "Payment recorded", "payments_made": new_payments_made, "remaining_payments": remaining, "remaining_amount": remaining_amount, "total_paid": new_paid}

@router.post("/rentals/{rental_id}/return")
async def return_rental_device(rental_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    rental = await _rental_or_404(rental_id, current_user, "rental.return")
    if rental.get("agreement_type") == "buy_outright":
        raise HTTPException(status_code=409, detail="An outright purchase cannot be returned through the rental workflow")
    if rental.get("status") not in RETURNABLE_RENTAL_STATUSES:
        raise HTTPException(status_code=409, detail="Only active or completed rental agreements can be returned")
    
    condition = data.get("condition", "good")
    if condition not in {"excellent", "good", "fair", "damaged"}:
        raise HTTPException(status_code=422, detail="Return condition is not supported")
    notes = str(data.get("notes", "") or "").strip()[:4000]
    
    await db.rentals.update_one({"id": rental_id}, {"$set": {
        "status": "returned",
        "return_condition": condition,
        "return_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "return_notes": notes,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }})
    
    # Free up the device
    device_id = rental.get("device_id")
    if device_id:
        await db.rental_devices.update_one({"id": device_id}, {"$set": {
            "status": "returned", "condition": condition,
            "current_rental_id": None, "current_client_id": None, "current_client_name": None,
        }})
    
    await log_activity(current_user, "returned", "rental", rental_id, f"Return from {rental.get('client_name', '')}", f"Returned {rental.get('device_model')} in {condition} condition. {notes}")
    return {"message": "Device returned"}

@router.put("/rentals/{rental_id}")
async def update_rental(rental_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    rental = await _rental_or_404(rental_id, current_user, "rental.update")
    allowed_fields = {"notes", "end_date", "sla_contract_id"}
    update = {key: value for key, value in data.items() if key in allowed_fields}
    if not update:
        raise HTTPException(status_code=422, detail="No editable agreement fields were supplied")
    if update.get("end_date") and update["end_date"] < rental.get("start_date", ""):
        raise HTTPException(status_code=422, detail="End date cannot be before the start date")
    if "sla_contract_id" in update:
        contract_id = update["sla_contract_id"]
        if contract_id:
            contract = await db.contracts.find_one({"id": contract_id, "client_id": rental.get("client_id")}, {"_id": 0, "id": 1, "name": 1, "status": 1})
            if not contract:
                raise HTTPException(status_code=422, detail="The selected billing contract does not belong to this client")
            if contract.get("status") != "active":
                raise HTTPException(status_code=409, detail="The selected billing contract is not active")
            update["sla_contract_name"] = contract.get("name", "")
        else:
            update["sla_contract_name"] = None
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.rentals.update_one({"id": rental_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Rental not found")
    await log_activity(current_user, "updated", "rental", rental_id, f"Rental for {rental.get('client_name', '')}", "Updated rental agreement details", changes=update)
    return {"message": "Rental updated"}

@router.get("/clients/{client_id}/rentals")
async def get_client_rentals(client_id: str, current_user: dict = Depends(get_current_user)):
    await assert_client_scope(current_user, client_id, operation="rental.client_list")
    rentals = await db.rentals.find(scoped_query(current_user, {"client_id": client_id}), {"_id": 0}).sort("created_at", -1).to_list(100)
    return rentals
