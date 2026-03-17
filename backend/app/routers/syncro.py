from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
import uuid
import httpx
import logging
from app.database import db
from app.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()

# ============== SYNCRO SETTINGS ==============

@router.get("/syncro/settings")
async def get_syncro_settings(current_user: dict = Depends(get_current_user)):
    doc = await db.settings.find_one({"type": "syncro"}, {"_id": 0})
    if doc and doc.get("api_key"):
        doc["api_key"] = doc["api_key"][:8] + "..." + doc["api_key"][-4:] if len(doc["api_key"]) > 12 else "****"
    return doc or {"type": "syncro", "subdomain": "", "api_key": "", "enabled": False}

@router.put("/syncro/settings")
async def update_syncro_settings(data: dict, current_user: dict = Depends(get_current_user)):
    await db.settings.update_one({"type": "syncro"}, {"$set": {
        "type": "syncro",
        "subdomain": data.get("subdomain", ""),
        "api_key": data.get("api_key", ""),
        "enabled": data.get("enabled", False),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }}, upsert=True)
    return {"message": "Syncro settings saved"}

@router.post("/syncro/test-connection")
async def test_syncro_connection(current_user: dict = Depends(get_current_user)):
    doc = await db.settings.find_one({"type": "syncro"}, {"_id": 0})
    if not doc or not doc.get("api_key") or not doc.get("subdomain"):
        raise HTTPException(status_code=400, detail="Syncro not configured")
    
    subdomain = doc["subdomain"]
    api_key = doc["api_key"]
    url = f"https://{subdomain}.syncromsp.com/api/v1/customers?page=1&per_page=1"
    
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url, headers={"Authorization": api_key})
        if resp.status_code == 200:
            return {"status": "connected", "message": "Successfully connected to Syncro"}
        else:
            return {"status": "error", "message": f"Syncro returned status {resp.status_code}"}
    except Exception as e:
        return {"status": "error", "message": f"Connection failed: {str(e)[:100]}"}

# ============== SYNCRO IMPORT ==============

@router.post("/syncro/import-clients")
async def import_clients_from_syncro(current_user: dict = Depends(get_current_user)):
    """Import clients and their associated data from Syncro RMM"""
    doc = await db.settings.find_one({"type": "syncro"}, {"_id": 0})
    if not doc or not doc.get("api_key") or not doc.get("subdomain"):
        raise HTTPException(status_code=400, detail="Syncro not configured. Add your Syncro subdomain and API key in Settings.")
    
    subdomain = doc["subdomain"]
    api_key = doc["api_key"]
    base_url = f"https://{subdomain}.syncromsp.com/api/v1"
    headers_dict = {"Authorization": api_key}
    
    imported = {"clients": 0, "contacts": 0, "assets": 0, "skipped": 0, "errors": []}
    
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            # Fetch all customers
            page = 1
            all_customers = []
            while True:
                resp = await client.get(f"{base_url}/customers?page={page}&per_page=50", headers=headers_dict)
                if resp.status_code != 200:
                    raise HTTPException(status_code=502, detail=f"Syncro API error: {resp.status_code}")
                data = resp.json()
                customers = data.get("customers", [])
                if not customers:
                    break
                all_customers.extend(customers)
                page += 1
                if page > 20:  # Safety limit
                    break
            
            for cust in all_customers:
                syncro_id = str(cust.get("id", ""))
                # Check if already imported
                existing = await db.clients.find_one({"syncro_id": syncro_id}, {"_id": 0})
                if existing:
                    imported["skipped"] += 1
                    continue
                
                # Create client
                client_id = str(uuid.uuid4())
                client_doc = {
                    "id": client_id,
                    "name": cust.get("business_name") or cust.get("firstname", "Unknown"),
                    "email": cust.get("email"),
                    "phone": cust.get("phone"),
                    "address": cust.get("address"),
                    "industry": None,
                    "contract_type": "monthly",
                    "mrr": 0.0,
                    "device_count": 0,
                    "ticket_count": 0,
                    "contacts": [],
                    "syncro_id": syncro_id,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
                await db.clients.insert_one(client_doc)
                imported["clients"] += 1
                
                # Fetch contacts for this customer
                try:
                    contacts_resp = await client.get(f"{base_url}/customers/{syncro_id}/contacts", headers=headers_dict)
                    if contacts_resp.status_code == 200:
                        contacts = contacts_resp.json().get("contacts", [])
                        for ct in contacts:
                            contact_doc = {
                                "id": str(uuid.uuid4()),
                                "client_id": client_id,
                                "name": f"{ct.get('name', '')}".strip() or "Unknown",
                                "email": ct.get("email"),
                                "phone": ct.get("phone"),
                                "role": ct.get("title", ""),
                                "is_primary": False,
                                "syncro_contact_id": str(ct.get("id", "")),
                                "created_at": datetime.now(timezone.utc).isoformat(),
                            }
                            await db.contacts.insert_one(contact_doc)
                            imported["contacts"] += 1
                except Exception as e:
                    imported["errors"].append(f"Contacts for {cust.get('business_name','')}: {str(e)[:60]}")
                
                # Fetch assets for this customer
                try:
                    assets_resp = await client.get(f"{base_url}/customers/{syncro_id}/assets", headers=headers_dict)
                    if assets_resp.status_code == 200:
                        assets = assets_resp.json().get("assets", [])
                        for asset in assets:
                            device_doc = {
                                "id": str(uuid.uuid4()),
                                "name": asset.get("name") or asset.get("hostname") or "Unknown Device",
                                "client_id": client_id,
                                "client_name": client_doc["name"],
                                "device_type": _map_syncro_asset_type(asset.get("asset_type", "")),
                                "os": asset.get("properties", {}).get("Operating System", "Unknown"),
                                "ip_address": asset.get("properties", {}).get("Local IP", ""),
                                "serial_number": asset.get("serial_number", ""),
                                "manufacturer": asset.get("properties", {}).get("Manufacturer", ""),
                                "model": asset.get("properties", {}).get("Model", ""),
                                "status": "online" if asset.get("online") else "offline",
                                "syncro_asset_id": str(asset.get("id", "")),
                                "last_seen": datetime.now(timezone.utc).isoformat(),
                                "created_at": datetime.now(timezone.utc).isoformat(),
                            }
                            await db.devices.insert_one(device_doc)
                            imported["assets"] += 1
                except Exception as e:
                    imported["errors"].append(f"Assets for {cust.get('business_name','')}: {str(e)[:60]}")
        
        return {
            "status": "success",
            "message": f"Imported {imported['clients']} clients, {imported['contacts']} contacts, {imported['assets']} devices",
            **imported
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Syncro import failed: {e}")
        raise HTTPException(status_code=500, detail=f"Import failed: {str(e)[:200]}")

@router.get("/syncro/import-preview")
async def preview_syncro_import(current_user: dict = Depends(get_current_user)):
    """Preview what would be imported from Syncro without actually importing"""
    doc = await db.settings.find_one({"type": "syncro"}, {"_id": 0})
    if not doc or not doc.get("api_key") or not doc.get("subdomain"):
        raise HTTPException(status_code=400, detail="Syncro not configured")
    
    subdomain = doc["subdomain"]
    api_key = doc["api_key"]
    base_url = f"https://{subdomain}.syncromsp.com/api/v1"
    
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(f"{base_url}/customers?page=1&per_page=100", headers={"Authorization": api_key})
            if resp.status_code != 200:
                raise HTTPException(status_code=502, detail=f"Syncro API error: {resp.status_code}")
            data = resp.json()
            customers = data.get("customers", [])
        
        # Check which are already imported
        preview = []
        for cust in customers:
            syncro_id = str(cust.get("id", ""))
            existing = await db.clients.find_one({"syncro_id": syncro_id}, {"_id": 0, "id": 1, "name": 1})
            preview.append({
                "syncro_id": syncro_id,
                "name": cust.get("business_name") or cust.get("firstname", "Unknown"),
                "email": cust.get("email"),
                "phone": cust.get("phone"),
                "already_imported": existing is not None,
                "existing_client_id": existing.get("id") if existing else None,
            })
        
        new_count = sum(1 for p in preview if not p["already_imported"])
        return {
            "total": len(preview),
            "new": new_count,
            "already_imported": len(preview) - new_count,
            "customers": preview
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Preview failed: {str(e)[:200]}")

def _map_syncro_asset_type(asset_type: str) -> str:
    mapping = {
        "Desktop": "workstation",
        "Laptop": "laptop",
        "Server": "server",
        "Tablet": "tablet",
        "Mobile": "mobile",
        "Printer": "printer",
        "Network Device": "network",
        "Other": "other",
    }
    return mapping.get(asset_type, "workstation")
