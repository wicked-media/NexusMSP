from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db
from app.auth import get_current_user
from app.services.activity import log_activity
from app.models import *

router = APIRouter()

# ============== RENTAL DEVICE INVENTORY ==============

@router.get("/rental-devices")
async def get_rental_devices(status: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if status:
        query["status"] = status
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
    result = await db.rental_devices.update_one({"id": device_id}, {"$set": data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Device not found")
    return {"message": "Device updated"}

@router.delete("/rental-devices/{device_id}")
async def delete_rental_device(device_id: str, current_user: dict = Depends(get_current_user)):
    device = await db.rental_devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if device.get("status") == "rented":
        raise HTTPException(status_code=400, detail="Cannot delete a rented device")
    await db.rental_devices.delete_one({"id": device_id})
    return {"message": "Device deleted"}

# ============== RENTAL AGREEMENTS ==============

@router.get("/rentals")
async def get_rentals(client_id: Optional[str] = None, status: Optional[str] = None, agreement_type: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if client_id:
        query["client_id"] = client_id
    if status:
        query["status"] = status
    if agreement_type:
        query["agreement_type"] = agreement_type
    rentals = await db.rentals.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    return rentals

@router.get("/rentals/stats")
async def get_rental_stats(current_user: dict = Depends(get_current_user)):
    total = await db.rentals.count_documents({})
    active = await db.rentals.count_documents({"status": "active"})
    overdue = await db.rentals.count_documents({"status": "overdue"})
    completed = await db.rentals.count_documents({"status": "completed"})
    total_devices = await db.rental_devices.count_documents({})
    available_devices = await db.rental_devices.count_documents({"status": "available"})
    rented_devices = await db.rental_devices.count_documents({"status": "rented"})
    sold_devices = await db.rental_devices.count_documents({"status": "sold"})
    
    # Revenue calculation
    all_rentals = await db.rentals.find({}, {"_id": 0, "amount_paid": 1, "device_cost": 1, "agreement_type": 1}).to_list(1000)
    total_revenue = sum(r.get("amount_paid", 0) for r in all_rentals)
    total_expected = sum(r.get("device_cost", 0) for r in all_rentals)
    
    return {
        "total_agreements": total, "active": active, "overdue": overdue, "completed": completed,
        "total_devices": total_devices, "available_devices": available_devices,
        "rented_devices": rented_devices, "sold_devices": sold_devices,
        "total_revenue": total_revenue, "total_expected": total_expected,
    }

@router.get("/rentals/{rental_id}")
async def get_rental(rental_id: str, current_user: dict = Depends(get_current_user)):
    rental = await db.rentals.find_one({"id": rental_id}, {"_id": 0})
    if not rental:
        raise HTTPException(status_code=404, detail="Rental not found")
    return rental

@router.post("/rentals")
async def create_rental(data: RentalAgreementCreate, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": data.client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    device = await db.rental_devices.find_one({"id": data.device_id}, {"_id": 0})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if device.get("status") not in ("available", "returned"):
        raise HTTPException(status_code=400, detail=f"Device is not available (status: {device.get('status')})")
    
    rental = RentalAgreement(**data.model_dump())
    rental.client_name = client["name"]
    rental.device_model = device.get("model_name", "")
    rental.device_serial = device.get("serial_number", "")
    rental.device_mac = device.get("mac_address", "")
    
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
    rental = await db.rentals.find_one({"id": rental_id}, {"_id": 0})
    if not rental:
        raise HTTPException(status_code=404, detail="Rental not found")
    
    amount = float(data.get("amount", rental.get("monthly_amount", 0)))
    method = data.get("method", "bank_transfer")
    note = data.get("note", "")
    is_deposit = data.get("is_deposit", False)
    
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
    
    await db.rentals.update_one({"id": rental_id}, {"$set": updates, "$push": {"payment_history": payment}})
    
    remaining = max(0, total_payments - new_payments_made)
    remaining_amount = max(0, float(rental.get("device_cost", 0)) - new_paid)
    
    return {"message": "Payment recorded", "payments_made": new_payments_made, "remaining_payments": remaining, "remaining_amount": remaining_amount, "total_paid": new_paid}

@router.post("/rentals/{rental_id}/return")
async def return_rental_device(rental_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    rental = await db.rentals.find_one({"id": rental_id}, {"_id": 0})
    if not rental:
        raise HTTPException(status_code=404, detail="Rental not found")
    
    condition = data.get("condition", "good")
    notes = data.get("notes", "")
    
    await db.rentals.update_one({"id": rental_id}, {"$set": {
        "status": "returned",
        "return_condition": condition,
        "return_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "return_notes": notes,
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
    result = await db.rentals.update_one({"id": rental_id}, {"$set": data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Rental not found")
    return {"message": "Rental updated"}

@router.get("/clients/{client_id}/rentals")
async def get_client_rentals(client_id: str, current_user: dict = Depends(get_current_user)):
    rentals = await db.rentals.find({"client_id": client_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return rentals
