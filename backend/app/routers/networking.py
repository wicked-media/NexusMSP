from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.models import *

router = APIRouter()

# ============== NETWORKING / UNIFI ENDPOINTS ==============

@router.get("/networking/sites")
async def get_networking_sites(current_user: dict = Depends(get_current_user)):
    sites = await db.network_sites.find({}, {"_id": 0}).to_list(100)
    return sites

@router.post("/networking/sites")
async def create_networking_site(data: dict, current_user: dict = Depends(get_current_user)):
    site = {
        "id": str(uuid.uuid4()), "name": data.get("name", ""),
        "client_id": data.get("client_id"), "client_name": data.get("client_name", ""),
        "controller_url": data.get("controller_url", ""), "site_id": data.get("site_id", "default"),
        "status": "online", "location": data.get("location", ""),
        "wan_ip": data.get("wan_ip", ""), "isp": data.get("isp", ""),
        "download_speed_mbps": data.get("download_speed_mbps", 0),
        "upload_speed_mbps": data.get("upload_speed_mbps", 0),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.network_sites.insert_one(site)
    site.pop("_id", None)
    return site

@router.get("/networking/sites/{site_id}")
async def get_networking_site(site_id: str, current_user: dict = Depends(get_current_user)):
    site = await db.network_sites.find_one({"id": site_id}, {"_id": 0})
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    return site

@router.put("/networking/sites/{site_id}")
async def update_networking_site(site_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    allowed = {"name", "client_id", "client_name", "controller_url", "site_id", "location",
               "wan_ip", "isp", "download_speed_mbps", "upload_speed_mbps", "status",
               "api_key", "username", "password", "verify_ssl", "notes"}
    update = {k: v for k, v in data.items() if k in allowed}
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.network_sites.update_one({"id": site_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Site not found")
    return {"message": "Site updated"}

@router.delete("/networking/sites/{site_id}")
async def delete_networking_site(site_id: str, current_user: dict = Depends(get_current_user)):
    await db.network_sites.delete_one({"id": site_id})
    await db.network_devices.delete_many({"site_id": site_id})
    await db.network_clients.delete_many({"site_id": site_id})
    return {"message": "Site and associated devices deleted"}

@router.post("/networking/sites/{site_id}/test-connection")
async def test_site_connection(site_id: str, current_user: dict = Depends(get_current_user)):
    site = await db.network_sites.find_one({"id": site_id}, {"_id": 0})
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    controller_url = site.get("controller_url", "")
    if not controller_url:
        return {"success": False, "message": "No controller URL configured"}
    try:
        async with httpx.AsyncClient(verify=False, timeout=10) as client:
            resp = await client.get(f"{controller_url}/api/s/default/stat/health")
            if resp.status_code in (200, 401, 403):
                await db.network_sites.update_one({"id": site_id}, {"$set": {"last_connection_test": datetime.now(timezone.utc).isoformat(), "connection_status": "reachable"}})
                return {"success": True, "message": f"Controller reachable (HTTP {resp.status_code})"}
    except Exception as e:
        await db.network_sites.update_one({"id": site_id}, {"$set": {"last_connection_test": datetime.now(timezone.utc).isoformat(), "connection_status": "unreachable"}})
        return {"success": False, "message": f"Connection failed: {str(e)[:100]}"}
    return {"success": False, "message": "Unknown error"}

@router.post("/networking/sites/{site_id}/adopt-device")
async def adopt_network_device(site_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    site = await db.network_sites.find_one({"id": site_id}, {"_id": 0})
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    device = {
        "id": str(uuid.uuid4()), "site_id": site_id,
        "name": data.get("name", "New Device"), "mac": data.get("mac", ""),
        "model": data.get("model", "Unknown"), "device_type": data.get("device_type", "ap"),
        "ip_address": data.get("ip_address", ""), "status": "pending_adoption",
        "firmware": data.get("firmware", ""), "uptime_seconds": 0,
        "cpu_usage": 0, "mem_usage": 0, "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.network_devices.insert_one(device)
    device.pop("_id", None)
    return device

@router.put("/networking/devices/{device_id}")
async def update_network_device(device_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    allowed = {"name", "ip_address", "status", "firmware", "notes", "device_type", "model"}
    update = {k: v for k, v in data.items() if k in allowed}
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.network_devices.update_one({"id": device_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Device not found")
    return {"message": "Device updated"}

@router.delete("/networking/devices/{device_id}")
async def delete_network_device(device_id: str, current_user: dict = Depends(get_current_user)):
    await db.network_devices.delete_one({"id": device_id})
    return {"message": "Device removed"}

@router.get("/networking/sites/{site_id}/overview")
async def get_site_overview(site_id: str, current_user: dict = Depends(get_current_user)):
    site = await db.network_sites.find_one({"id": site_id}, {"_id": 0})
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    devices = await db.network_devices.find({"site_id": site_id}, {"_id": 0}).to_list(500)
    clients = await db.network_clients.find({"site_id": site_id}, {"_id": 0}).to_list(1000)
    online_devices = [d for d in devices if d.get("status") == "online"]
    aps = [d for d in devices if d.get("device_type") == "ap"]
    switches = [d for d in devices if d.get("device_type") == "switch"]
    gateways = [d for d in devices if d.get("device_type") == "gateway"]
    wireless_clients = [c for c in clients if c.get("is_wireless")]
    wired_clients = [c for c in clients if not c.get("is_wireless")]
    total_rx = sum(c.get("rx_bytes", 0) for c in clients)
    total_tx = sum(c.get("tx_bytes", 0) for c in clients)
    return {
        "site": site, "total_devices": len(devices), "online_devices": len(online_devices),
        "access_points": len(aps), "switches": len(switches), "gateways": len(gateways),
        "total_clients": len(clients), "wireless_clients": len(wireless_clients), "wired_clients": len(wired_clients),
        "total_rx_bytes": total_rx, "total_tx_bytes": total_tx,
        "health": {"wan": "healthy", "lan": "healthy", "wlan": "healthy" if aps else "n/a"},
    }

@router.get("/networking/sites/{site_id}/devices")
async def get_site_devices(site_id: str, device_type: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {"site_id": site_id}
    if device_type:
        query["device_type"] = device_type
    devices = await db.network_devices.find(query, {"_id": 0}).to_list(500)
    return devices

@router.get("/networking/sites/{site_id}/clients")
async def get_site_clients(site_id: str, connected_only: bool = False, current_user: dict = Depends(get_current_user)):
    query = {"site_id": site_id}
    if connected_only:
        query["is_connected"] = True
    clients = await db.network_clients.find(query, {"_id": 0}).to_list(1000)
    return clients

@router.get("/networking/stats")
async def get_networking_stats(current_user: dict = Depends(get_current_user)):
    sites = await db.network_sites.find({}, {"_id": 0}).to_list(100)
    devices = await db.network_devices.find({}, {"_id": 0}).to_list(5000)
    clients = await db.network_clients.find({}, {"_id": 0}).to_list(10000)
    online_sites = [s for s in sites if s.get("status") == "online"]
    online_devices = [d for d in devices if d.get("status") == "online"]
    aps = [d for d in devices if d.get("device_type") == "ap"]
    switches_list = [d for d in devices if d.get("device_type") == "switch"]
    gateways = [d for d in devices if d.get("device_type") == "gateway"]
    return {
        "total_sites": len(sites), "online_sites": len(online_sites),
        "total_devices": len(devices), "online_devices": len(online_devices),
        "total_clients": len(clients),
        "access_points": len(aps), "switches": len(switches_list), "gateways": len(gateways),
    }

@router.put("/settings/unifi")
async def update_unifi_settings(data: dict, current_user: dict = Depends(get_current_user)):
    await db.settings.update_one({"type": "unifi"}, {"$set": {
        "type": "unifi", "controller_url": data.get("controller_url", ""),
        "username": data.get("username", ""), "password": data.get("password", ""),
        "verify_ssl": data.get("verify_ssl", False),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }}, upsert=True)
    return {"message": "UniFi settings updated"}

@router.get("/settings/unifi")
async def get_unifi_settings(current_user: dict = Depends(get_current_user)):
    settings_doc = await db.settings.find_one({"type": "unifi"}, {"_id": 0})
    if not settings_doc:
        return {"type": "unifi", "controller_url": "", "username": "", "verify_ssl": False}
    settings_doc.pop("password", None)
    return settings_doc


@router.get("/networking/dashboard")
async def get_networking_dashboard(current_user: dict = Depends(get_current_user)):
    """Comprehensive networking dashboard with health, alerts, bandwidth"""
    sites = await db.network_sites.find({}, {"_id": 0}).to_list(100)
    all_devices = await db.network_devices.find({}, {"_id": 0}).to_list(5000)
    all_clients = await db.network_clients.find({}, {"_id": 0}).to_list(10000)
    
    online_sites = [s for s in sites if s.get("status") == "online"]
    offline_sites = [s for s in sites if s.get("status") != "online"]
    
    # Device breakdown
    device_types = {}
    firmware_versions = {}
    offline_devices = []
    for d in all_devices:
        dt = d.get("device_type", "unknown")
        device_types[dt] = device_types.get(dt, 0) + 1
        fw = d.get("firmware_version", "unknown")
        firmware_versions[fw] = firmware_versions.get(fw, 0) + 1
        if d.get("status") != "online":
            offline_devices.append({"name": d.get("name"), "site_id": d.get("site_id"), "type": dt, "status": d.get("status"), "last_seen": d.get("last_seen")})
    
    # Bandwidth aggregation
    total_rx = sum(c.get("rx_bytes", 0) for c in all_clients)
    total_tx = sum(c.get("tx_bytes", 0) for c in all_clients)
    
    # Site bandwidth breakdown
    site_bandwidth = []
    for site in sites:
        site_clients = [c for c in all_clients if c.get("site_id") == site["id"]]
        site_devices = [d for d in all_devices if d.get("site_id") == site["id"]]
        rx = sum(c.get("rx_bytes", 0) for c in site_clients)
        tx = sum(c.get("tx_bytes", 0) for c in site_clients)
        site_bandwidth.append({
            "site_id": site["id"], "name": site.get("name"), "client_name": site.get("client_name"),
            "status": site.get("status"), "device_count": len(site_devices),
            "client_count": len(site_clients), "rx_bytes": rx, "tx_bytes": tx,
            "wan_ip": site.get("wan_ip"), "isp": site.get("isp"),
            "download_mbps": site.get("download_speed_mbps", 0), "upload_mbps": site.get("upload_speed_mbps", 0),
        })
    
    # Generate alerts
    alerts = []
    for d in offline_devices:
        alerts.append({"type": "device_offline", "severity": "warning", "message": f"{d['name']} is offline", "device_type": d['type']})
    for s in offline_sites:
        alerts.append({"type": "site_offline", "severity": "critical", "message": f"Site '{s.get('name')}' is offline"})
    
    return {
        "summary": {
            "total_sites": len(sites), "online_sites": len(online_sites), "offline_sites": len(offline_sites),
            "total_devices": len(all_devices), "online_devices": len([d for d in all_devices if d.get("status") == "online"]),
            "total_clients": len(all_clients),
            "total_rx_gb": round(total_rx / (1024**3), 2), "total_tx_gb": round(total_tx / (1024**3), 2),
        },
        "device_types": device_types,
        "firmware_versions": firmware_versions,
        "offline_devices": offline_devices,
        "site_bandwidth": site_bandwidth,
        "alerts": alerts,
    }

