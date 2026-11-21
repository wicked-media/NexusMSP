from fastapi import APIRouter, HTTPException, Depends, Request
from typing import Optional
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
from app.services.secret_store import encrypt_secret
from app.services.scope_permissions import (
    assert_client_scope,
    assert_record_scope,
    assert_tenant_record_scope,
    platform_tenant_id,
    scoped_query,
    tenant_scoped_query,
)
from app.models import *

router = APIRouter()

# ============== PROXMOX ENDPOINTS ==============

def _scoped_proxmox_servers(user: dict) -> dict:
    """Connection records are customer-scoped: tenant partition + client scope."""
    return tenant_scoped_query(user, scoped_query(user, {}))


@router.get("/proxmox/servers")
async def get_proxmox_servers(current_user: dict = Depends(get_current_user)):
    servers = await db.proxmox_servers.find(
        _scoped_proxmox_servers(current_user), {"_id": 0, "token_value": 0}
    ).to_list(100)
    return servers

@router.post("/proxmox/servers")
async def create_proxmox_server(server_data: dict, current_user: dict = Depends(get_current_user)):
    # A connection binds Nexus to a customer's infrastructure: the caller must
    # be inside that client's scope before any credential is stored.
    await assert_client_scope(
        current_user,
        server_data.get("client_id") or None,
        operation="proxmox.connection.create",
    )
    client_name = None
    if server_data.get('client_id'):
        client = await db.clients.find_one({"id": server_data['client_id']}, {"_id": 0})
        client_name = client['name'] if client else None
    
    server = ProxmoxServer(
        name=server_data.get('name'),
        host=server_data.get('host'),
        port=server_data.get('port', 8006),
        username=server_data.get('username'),
        token_name=server_data.get('token_name'),
        token_value=server_data.get('token_value'),
        client_id=server_data.get('client_id'),
        client_name=client_name,
        node_name=server_data.get('node_name'),
        ssl_verify=server_data.get('ssl_verify', False)
    )
    doc = server.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['tenant_id'] = platform_tenant_id(current_user)
    if doc.get('token_value'):
        # API tokens are integration secrets: encrypted at rest, and never
        # returned by any route (the read projection excludes token_value).
        doc['token_value'] = encrypt_secret(str(doc['token_value']))
    await db.proxmox_servers.insert_one(doc)
    return {"id": server.id, "name": server.name}

@router.delete("/proxmox/servers/{server_id}")
async def delete_proxmox_server(server_id: str, request: Request, current_user: dict = Depends(get_current_user)):
    await assert_tenant_record_scope(
        current_user, db.proxmox_servers, server_id,
        operation="proxmox.connection.delete", request=request,
        resource_name="Proxmox connection",
    )
    await db.proxmox_servers.delete_one({"id": server_id})
    await db.proxmox_vms.delete_many({"server_id": server_id})
    return {"message": "Server deleted"}

@router.get("/proxmox/vms")
async def get_proxmox_vms(server_id: Optional[str] = None, status: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if server_id:
        query["server_id"] = server_id
    if status:
        query["status"] = status
    return await db.proxmox_vms.find(query, {"_id": 0}).sort("name", 1).to_list(1000)

@router.get("/proxmox/dashboard")
async def get_proxmox_dashboard(current_user: dict = Depends(get_current_user)):
    total_servers = await db.proxmox_servers.count_documents({})
    online_servers = await db.proxmox_servers.count_documents({"status": "online"})
    total_vms = await db.proxmox_vms.count_documents({})
    running_vms = await db.proxmox_vms.count_documents({"status": "running"})
    stopped_vms = await db.proxmox_vms.count_documents({"status": "stopped"})
    return {
        "servers": {"total": total_servers, "online": online_servers},
        "vms": {"total": total_vms, "running": running_vms, "stopped": stopped_vms}
    }

# ============== WARRANTY ENDPOINTS ==============

@router.get("/warranties")
async def get_warranties(client_id: Optional[str] = None, status: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if client_id:
        query["client_id"] = client_id
    if status:
        query["status"] = status
    warranties = await db.warranties.find(query, {"_id": 0}).sort("warranty_end", 1).to_list(1000)
    return warranties

@router.post("/warranties")
async def create_warranty(warranty_data: dict, current_user: dict = Depends(get_current_user)):
    client_name = warranty_data.pop("client_name", None)
    if warranty_data.get('client_id') and not client_name:
        client = await db.clients.find_one({"id": warranty_data['client_id']}, {"_id": 0})
        client_name = client['name'] if client else None
    
    warranty = WarrantyEntry(client_name=client_name, **warranty_data)
    doc = warranty.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.warranties.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}

@router.put("/warranties/{warranty_id}")
async def update_warranty(warranty_id: str, warranty_data: dict, current_user: dict = Depends(get_current_user)):
    result = await db.warranties.update_one({"id": warranty_id}, {"$set": warranty_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Warranty not found")
    return {"message": "Warranty updated"}

@router.delete("/warranties/{warranty_id}")
async def delete_warranty(warranty_id: str, current_user: dict = Depends(get_current_user)):
    await db.warranties.delete_one({"id": warranty_id})
    return {"message": "Warranty deleted"}

# ============== LICENSE ENDPOINTS ==============

@router.get("/licenses")
async def get_licenses(client_id: Optional[str] = None, status: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if client_id:
        query["client_id"] = client_id
    if status:
        query["status"] = status
    licenses = await db.software_licenses.find(query, {"_id": 0}).sort("software_name", 1).to_list(1000)
    return licenses

@router.post("/licenses")
async def create_license(license_data: dict, current_user: dict = Depends(get_current_user)):
    client_name = None
    if license_data.get('client_id'):
        client = await db.clients.find_one({"id": license_data['client_id']}, {"_id": 0})
        client_name = client['name'] if client else None
    
    license_entry = SoftwareLicense(client_name=client_name, **license_data)
    doc = license_entry.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.software_licenses.insert_one(doc)
    return license_entry

@router.put("/licenses/{license_id}")
async def update_license(license_id: str, license_data: dict, current_user: dict = Depends(get_current_user)):
    result = await db.software_licenses.update_one({"id": license_id}, {"$set": license_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="License not found")
    return {"message": "License updated"}

@router.delete("/licenses/{license_id}")
async def delete_license(license_id: str, current_user: dict = Depends(get_current_user)):
    await db.software_licenses.delete_one({"id": license_id})
    return {"message": "License deleted"}

# ============== DOMAIN & SSL ENDPOINTS ==============

@router.get("/domains")
async def get_domains(client_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if client_id:
        await assert_client_scope(current_user, client_id, operation="domain.read")
        query["client_id"] = client_id
    domains = await db.domains.find(scoped_query(current_user, query), {"_id": 0}).sort("expiry_date", 1).to_list(1000)
    return domains

@router.post("/domains")
async def create_domain(domain_data: dict, current_user: dict = Depends(get_current_user)):
    client_name = None
    if domain_data.get('client_id'):
        await assert_client_scope(current_user, domain_data['client_id'], operation="domain.create")
        client = await db.clients.find_one({"id": domain_data['client_id']}, {"_id": 0})
        if not client:
            raise HTTPException(status_code=404, detail="Client not found")
        client_name = client['name'] if client else None
    else:
        await assert_client_scope(current_user, None, operation="domain.create")
    
    try:
        domain = DomainEntry(client_name=client_name, **domain_data)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"Invalid domain payload: {exc}")
    doc = domain.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.domains.insert_one(doc)
    return domain

@router.delete("/domains/{domain_id}")
async def delete_domain(domain_id: str, current_user: dict = Depends(get_current_user)):
    await assert_record_scope(current_user, db.domains, domain_id, operation="domain.delete", resource_name="Domain")
    await db.domains.delete_one({"id": domain_id})
    return {"message": "Domain deleted"}

@router.get("/ssl-certificates")
async def get_ssl_certificates(client_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if client_id:
        await assert_client_scope(current_user, client_id, operation="ssl_certificate.read")
        query["client_id"] = client_id
    certs = await db.ssl_certificates.find(scoped_query(current_user, query), {"_id": 0}).sort("expiry_date", 1).to_list(1000)
    return certs

@router.post("/ssl-certificates")
async def create_ssl_certificate(cert_data: dict, current_user: dict = Depends(get_current_user)):
    client_name = None
    if cert_data.get('client_id'):
        await assert_client_scope(current_user, cert_data['client_id'], operation="ssl_certificate.create")
        client = await db.clients.find_one({"id": cert_data['client_id']}, {"_id": 0})
        if not client:
            raise HTTPException(status_code=404, detail="Client not found")
        client_name = client['name'] if client else None
    else:
        await assert_client_scope(current_user, None, operation="ssl_certificate.create")
    
    try:
        cert = SSLCertificate(client_name=client_name, **cert_data)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"Invalid certificate payload: {exc}")
    doc = cert.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.ssl_certificates.insert_one(doc)
    return cert

@router.delete("/ssl-certificates/{cert_id}")
async def delete_ssl_certificate(cert_id: str, current_user: dict = Depends(get_current_user)):
    await assert_record_scope(current_user, db.ssl_certificates, cert_id, operation="ssl_certificate.delete", resource_name="SSL certificate")
    await db.ssl_certificates.delete_one({"id": cert_id})
    return {"message": "Certificate deleted"}

# ============== VENDOR ENDPOINTS ==============

@router.get("/vendors")
async def get_vendors(category: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if category:
        query["category"] = category
    vendors = await db.vendors.find(query, {"_id": 0}).sort("name", 1).to_list(1000)
    return vendors

@router.post("/vendors")
async def create_vendor(vendor_data: dict, current_user: dict = Depends(get_current_user)):
    vendor = Vendor(**vendor_data)
    doc = vendor.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.vendors.insert_one(doc)
    return vendor

@router.put("/vendors/{vendor_id}")
async def update_vendor(vendor_id: str, vendor_data: dict, current_user: dict = Depends(get_current_user)):
    result = await db.vendors.update_one({"id": vendor_id}, {"$set": vendor_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return {"message": "Vendor updated"}

@router.delete("/vendors/{vendor_id}")
async def delete_vendor(vendor_id: str, current_user: dict = Depends(get_current_user)):
    await db.vendors.delete_one({"id": vendor_id})
    return {"message": "Vendor deleted"}

# ============== EXPIRY DASHBOARD ==============

@router.get("/expiry-dashboard")
async def get_expiry_dashboard(current_user: dict = Depends(get_current_user)):
    """Get expiring operational records from their authoritative collections.

    Warranty evidence is stored on an Inventory Asset. Licences, domains, and
    certificates remain their own managed records.
    """
    today = datetime.now(timezone.utc).date()
    soon = today + timedelta(days=30)

    warranty_assets = await db.assets.find(
        {"$or": [{"warranty_expiry": {"$exists": True, "$ne": ""}}, {"warranty_end": {"$exists": True, "$ne": ""}}]},
        {"_id": 0, "warranty_expiry": 1, "warranty_end": 1},
    ).to_list(10000)
    expiring_warranties = 0
    for asset in warranty_assets:
        raw_expiry = asset.get("warranty_expiry") or asset.get("warranty_end")
        try:
            expiry = datetime.fromisoformat(str(raw_expiry).replace("Z", "+00:00")).date()
        except (TypeError, ValueError):
            continue
        if today <= expiry <= soon:
            expiring_warranties += 1

    today_text = today.isoformat()
    soon_text = soon.isoformat()
    expiring_licenses = await db.software_licenses.count_documents({"expiry_date": {"$lte": soon_text, "$gte": today_text}})
    expiring_domains = await db.domains.count_documents({"expiry_date": {"$lte": soon_text, "$gte": today_text}})
    expiring_ssl = await db.ssl_certificates.count_documents({"expiry_date": {"$lte": soon_text, "$gte": today_text}})
    
    return {
        "warranties": {"expiring_soon": expiring_warranties},
        "licenses": {"expiring_soon": expiring_licenses},
        "domains": {"expiring_soon": expiring_domains},
        "ssl_certificates": {"expiring_soon": expiring_ssl},
        "total_expiring": expiring_warranties + expiring_licenses + expiring_domains + expiring_ssl
    }

# ============== SEED DATA ==============

@router.post("/seed")
async def seed_data(current_user: dict = Depends(get_current_user)):
    """Retired: production environments must never manufacture operating data."""
    raise HTTPException(status_code=410, detail="Demo data generation is retired. Connect a provider or create records through the normal workflow.")

