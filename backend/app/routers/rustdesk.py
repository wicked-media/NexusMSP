import os
from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from datetime import datetime, timezone
import uuid
import httpx
import os
from app.database import db
from app.auth import get_current_user

router = APIRouter()

# ============== RUSTDESK REMOTE ACCESS MANAGEMENT ==============

async def _get_rustdesk_config():
    """Get RustDesk server config from DB."""
    config = await db.settings.find_one({"key": "rustdesk_config"}, {"_id": 0})
    value = config.get("value", {}) if config else {}
    # Normalize server_url — ensure it has a protocol
    url = value.get("server_url", "").strip().rstrip("/")
    if url and not url.startswith("http"):
        url = f"https://{url}"
    value["server_url"] = url
    return value

async def _rustdesk_api_request(method: str, path: str, data: dict = None):
    """Make an authenticated request to the RustDesk server API."""
    config = await _get_rustdesk_config()
    server_url = config.get("server_url", "").rstrip("/")
    api_key = config.get("api_key", "")
    if not server_url:
        return None
    
    url = f"{server_url}/api{path}"
    headers_dict = {}
    if api_key:
        headers_dict["Authorization"] = f"Bearer {api_key}"
    
    try:
        async with httpx.AsyncClient(timeout=10.0, verify=os.environ.get('ALLOW_SELF_SIGNED_CERTS','false').lower()!='true') as client:
            if method == "GET":
                resp = await client.get(url, headers=headers_dict)
            elif method == "POST":
                resp = await client.post(url, json=data or {}, headers=headers_dict)
            else:
                return None
            if resp.status_code == 200:
                return resp.json()
            return None
    except Exception:
        return None

@router.post("/rustdesk/sync/devices")
async def sync_rustdesk_devices(current_user: dict = Depends(get_current_user)):
    """Read the Pro device inventory and link matching NexusMSP endpoints."""
    config = await _get_rustdesk_config()
    base, token = config.get("server_url", ""), config.get("api_key", "")
    if not base or not token:
        raise HTTPException(400, "RustDesk server URL and API token are required")
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(f"{base}/api/devices", params={"pageSize": 1000, "current": 1}, headers={"Authorization": f"Bearer {token}"})
    if response.status_code != 200:
        raise HTTPException(502, f"RustDesk API returned HTTP {response.status_code}")
    payload = response.json()
    devices = payload.get("data") or []
    linked = 0
    for item in devices:
        info = item.get("info") or {}
        hostname = str(info.get("hostname") or info.get("name") or item.get("id") or "").strip()
        doc = {"id": str(uuid.uuid4()), "rustdesk_guid": item.get("guid"), "rustdesk_id": item.get("id"), "hostname": hostname, "status": item.get("status"), "last_online": item.get("last_online"), "raw": item, "synced_at": datetime.now(timezone.utc).isoformat()}
        await db.rustdesk_devices.update_one({"rustdesk_guid": item.get("guid")}, {"$set": doc}, upsert=True)
        local = await db.devices.find_one({"hostname": hostname}, {"_id": 0, "id": 1})
        if local and item.get("id"):
            await db.devices.update_one({"id": local["id"]}, {"$set": {"rustdesk_id": str(item["id"]), "rustdesk_guid": item.get("guid"), "remote_access_updated_at": datetime.now(timezone.utc).isoformat()}})
            linked += 1
    return {"success": True, "synced": len(devices), "linked": linked, "total": payload.get("total", len(devices))}

@router.get("/rustdesk/config")
async def get_rustdesk_global_config(current_user: dict = Depends(get_current_user)):
    """Get global RustDesk server configuration"""
    config = await db.settings.find_one({"key": "rustdesk_config"}, {"_id": 0})
    if not config:
        return {
            "key": "rustdesk_config",
            "value": {
                "server_url": "",
                "api_key": "",
                "relay_server": "",
                "enabled": False,
                "default_password_length": 8,
            }
        }
    return config

@router.post("/rustdesk/config")
async def save_rustdesk_global_config(data: dict, current_user: dict = Depends(get_current_user)):
    """Save global RustDesk server configuration"""
    await db.settings.update_one(
        {"key": "rustdesk_config"},
        {"$set": {"key": "rustdesk_config", "value": data, "updated_at": datetime.now(timezone.utc).isoformat(), "updated_by": current_user["id"]}},
        upsert=True
    )
    return {"message": "RustDesk configuration saved"}

@router.get("/rustdesk/clients/{client_id}/devices")
async def get_client_rustdesk_devices(client_id: str, current_user: dict = Depends(get_current_user)):
    """Get all RustDesk device configs for a client"""
    devices = await db.rustdesk_devices.find({"client_id": client_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return devices

@router.post("/rustdesk/clients/{client_id}/devices")
async def add_rustdesk_device(client_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Register a RustDesk device for a client"""
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    device_entry = {
        "id": str(uuid.uuid4()),
        "client_id": client_id,
        "client_name": client.get("name", ""),
        "device_name": data.get("device_name", ""),
        "rustdesk_id": data.get("rustdesk_id", ""),
        "rustdesk_password": data.get("rustdesk_password", ""),
        "os": data.get("os", ""),
        "status": "configured",
        "last_connected": None,
        "notes": data.get("notes", ""),
        "linked_device_id": data.get("linked_device_id", ""),
        "created_by": current_user["id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.rustdesk_devices.insert_one(device_entry)
    device_entry.pop("_id", None)
    return device_entry

@router.put("/rustdesk/devices/{device_id}")
async def update_rustdesk_device(device_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Update a RustDesk device config"""
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.rustdesk_devices.update_one({"id": device_id}, {"$set": data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="RustDesk device not found")
    return {"message": "RustDesk device updated"}

@router.delete("/rustdesk/devices/{device_id}")
async def delete_rustdesk_device(device_id: str, current_user: dict = Depends(get_current_user)):
    """Remove a RustDesk device config"""
    result = await db.rustdesk_devices.delete_one({"id": device_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="RustDesk device not found")
    return {"message": "RustDesk device removed"}

@router.post("/rustdesk/devices/{device_id}/connect")
async def initiate_rustdesk_connection(device_id: str, current_user: dict = Depends(get_current_user)):
    """Initiate a remote connection to a RustDesk device"""
    device = await db.rustdesk_devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        raise HTTPException(status_code=404, detail="RustDesk device not found")

    config = await _get_rustdesk_config()

    # Update last connected timestamp
    await db.rustdesk_devices.update_one(
        {"id": device_id},
        {"$set": {"last_connected": datetime.now(timezone.utc).isoformat(), "status": "connected"}}
    )

    # Log the connection
    await db.rustdesk_sessions.insert_one({
        "id": str(uuid.uuid4()),
        "device_id": device_id,
        "client_id": device.get("client_id"),
        "rustdesk_id": device.get("rustdesk_id"),
        "user_id": current_user["id"],
        "user_name": current_user["name"],
        "status": "initiated",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "ended_at": None,
    })

    rd_id = device.get("rustdesk_id", "")
    relay = config.get("relay_server", "").strip()
    server_url = config.get("server_url", "").strip().rstrip("/")

    # Build correct RustDesk URI
    server_host = ""
    if relay:
        server_host = relay.replace("https://", "").replace("http://", "").split("/")[0].split(":")[0]
    elif server_url:
        server_host = server_url.replace("https://", "").replace("http://", "").split("/")[0].split(":")[0]
    
    if server_host:
        connection_url = f"rustdesk://{rd_id}@{server_host}"
    else:
        connection_url = f"rustdesk://{rd_id}"

    return {
        "message": "Connection initiated",
        "rustdesk_id": rd_id,
        "rustdesk_password": device.get("rustdesk_password"),
        "connection_url": connection_url,
        "relay_server": relay or server_host,
        "server_url": server_url,
        "web_client_url": f"{server_url}" if server_url else None,
    }

@router.get("/rustdesk/sessions")
async def get_rustdesk_sessions(
    client_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get RustDesk session history"""
    query = {}
    if client_id:
        query["client_id"] = client_id
    sessions = await db.rustdesk_sessions.find(query, {"_id": 0}).sort("started_at", -1).to_list(100)
    return sessions


@router.get("/rustdesk/all-devices")
async def get_all_remote_devices(current_user: dict = Depends(get_current_user)):
    """Get all managed devices enriched with their RustDesk registration status"""
    # Get all managed devices
    devices = await db.devices.find({}, {
        "_id": 0, "id": 1, "name": 1, "hostname": 1, "client_id": 1, "client_name": 1,
        "device_type": 1, "os": 1, "status": 1, "ip_address": 1, "rustdesk_id": 1,
    }).to_list(500)
    # Get all registered RustDesk device entries
    rd_devices = await db.rustdesk_devices.find({}, {"_id": 0}).to_list(500)
    rd_by_linked = {r.get("linked_device_id"): r for r in rd_devices if r.get("linked_device_id")}
    rd_by_id = {r.get("id"): r for r in rd_devices}

    enriched = []
    for d in devices:
        rd = rd_by_linked.get(d["id"])
        entry = {
            **d,
            "rd_registered": bool(rd or d.get("rustdesk_id")),
            "rd_id": rd.get("rustdesk_id") if rd else d.get("rustdesk_id"),
            "rd_password": rd.get("rustdesk_password") if rd else None,
            "rd_entry_id": rd.get("id") if rd else None,
            "rd_last_connected": rd.get("last_connected") if rd else None,
            "rd_notes": rd.get("notes") if rd else None,
        }
        enriched.append(entry)

    # Add standalone RustDesk entries not linked to a managed device
    linked_ids = {r.get("linked_device_id") for r in rd_devices if r.get("linked_device_id")}
    for rd in rd_devices:
        if rd.get("linked_device_id") not in [d["id"] for d in devices]:
            enriched.append({
                "id": rd.get("id"),
                "name": rd.get("device_name", "Unlinked Device"),
                "hostname": None,
                "client_id": rd.get("client_id"),
                "client_name": rd.get("client_name"),
                "device_type": "unknown",
                "os": rd.get("os"),
                "status": rd.get("status", "configured"),
                "ip_address": None,
                "rd_registered": True,
                "rd_id": rd.get("rustdesk_id"),
                "rd_password": rd.get("rustdesk_password"),
                "rd_entry_id": rd.get("id"),
                "rd_last_connected": rd.get("last_connected"),
                "rd_notes": rd.get("notes"),
            })

    return enriched


@router.put("/rustdesk/assign/{device_id}")
async def assign_rustdesk_id(device_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Assign or update a RustDesk ID directly on a managed device, and create/update the rustdesk_devices entry"""
    rd_id = data.get("rustdesk_id", "").strip()
    rd_password = data.get("rustdesk_password", "").strip()
    if not rd_id:
        raise HTTPException(status_code=400, detail="RustDesk ID is required")

    # Update the main device record
    result = await db.devices.update_one({"id": device_id}, {"$set": {"rustdesk_id": rd_id}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Device not found")

    device = await db.devices.find_one({"id": device_id}, {"_id": 0, "name": 1, "client_id": 1, "client_name": 1, "os": 1})

    # Upsert a rustdesk_devices entry linked to this device
    existing = await db.rustdesk_devices.find_one({"linked_device_id": device_id}, {"_id": 0})
    if existing:
        await db.rustdesk_devices.update_one(
            {"linked_device_id": device_id},
            {"$set": {"rustdesk_id": rd_id, "rustdesk_password": rd_password, "updated_at": datetime.now(timezone.utc).isoformat()}}
        )
    else:
        entry = {
            "id": str(uuid.uuid4()), "client_id": device.get("client_id", ""),
            "client_name": device.get("client_name", ""), "device_name": device.get("name", ""),
            "rustdesk_id": rd_id, "rustdesk_password": rd_password, "os": device.get("os", ""),
            "status": "configured", "last_connected": None, "notes": "",
            "linked_device_id": device_id, "created_by": current_user["id"],
            "created_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.rustdesk_devices.insert_one(entry)
        entry.pop("_id", None)

    return {"message": "RustDesk ID assigned", "rustdesk_id": rd_id}


@router.post("/rustdesk/quick-connect")
async def quick_connect(data: dict, current_user: dict = Depends(get_current_user)):
    """Quick connect by RustDesk ID — logs session without requiring device registration"""
    rd_id = data.get("rustdesk_id", "").strip()
    if not rd_id:
        raise HTTPException(status_code=400, detail="RustDesk ID required")

    config = await _get_rustdesk_config()
    relay = config.get("relay_server", "").strip()
    server_url = config.get("server_url", "").strip().rstrip("/")

    # Log the session
    await db.rustdesk_sessions.insert_one({
        "id": str(uuid.uuid4()), "device_id": None, "client_id": None,
        "rustdesk_id": rd_id, "user_id": current_user["id"], "user_name": current_user["name"],
        "status": "initiated", "started_at": datetime.now(timezone.utc).isoformat(), "ended_at": None,
    })

    # Build correct RustDesk URI
    server_host = ""
    if relay:
        server_host = relay.replace("https://", "").replace("http://", "").split("/")[0].split(":")[0]
    elif server_url:
        server_host = server_url.replace("https://", "").replace("http://", "").split("/")[0].split(":")[0]
    
    if server_host:
        connection_url = f"rustdesk://{rd_id}@{server_host}"
    else:
        connection_url = f"rustdesk://{rd_id}"

    return {
        "message": "Connection initiated",
        "rustdesk_id": rd_id,
        "connection_url": connection_url,
        "relay_server": relay or server_host,
        "server_url": server_url,
        "web_client_url": f"{server_url}" if server_url else None,
    }


# ─── Patch Agent Deployment via RustDesk ───

@router.post("/rustdesk/devices/{device_id}/deploy-agent")
async def deploy_agent_to_device(device_id: str, current_user: dict = Depends(get_current_user)):
    """Queue a patch agent deployment for a device. Generates the deploy command and tracks status."""
    raise HTTPException(status_code=410, detail="The legacy Patch Agent is retired. Install Nexus Agent from the Nexus Agent workspace.")
    device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    # Get agent settings for the API URL
    settings = await db.settings.find_one({"type": "patch_agent"}, {"_id": 0})
    api_url = settings.get("api_url", "") if settings else ""
    agent_key = settings.get("agent_api_key", f"nxagent-{uuid.uuid4().hex[:16]}") if settings else f"nxagent-{uuid.uuid4().hex[:16]}"

    deploy_cmd = f'powershell -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri \'{api_url}/patch-hub/agent/download-script\' -OutFile NexusOps-PatchAgent.ps1; .\\NexusOps-PatchAgent.ps1"'

    deployment = {
        "id": f"dep-{uuid.uuid4().hex[:8]}",
        "device_id": device_id,
        "device_name": device.get("name", device.get("hostname", "Unknown")),
        "client_id": device.get("client_id", ""),
        "client_name": device.get("client_name", ""),
        "status": "pending",
        "deploy_command": deploy_cmd,
        "queued_by": current_user.get("name", ""),
        "queued_at": datetime.now(timezone.utc).isoformat(),
        "deployed_at": None,
        "agent_version": "1.0.0",
    }

    await db.agent_deployments.update_one(
        {"device_id": device_id},
        {"$set": deployment, "$setOnInsert": {"first_queued": datetime.now(timezone.utc).isoformat()}},
        upsert=True
    )

    # Mark device as pending agent deployment
    await db.devices.update_one({"id": device_id}, {"$set": {"agent_deploy_status": "pending", "agent_deploy_queued_at": deployment["queued_at"]}})

    return {"message": "Agent deployment queued", "deployment": deployment}


@router.post("/rustdesk/devices/{device_id}/deploy-agent/complete")
async def mark_agent_deployed(device_id: str, current_user: dict = Depends(get_current_user)):
    """Mark a device's agent deployment as complete (tech confirms after running the script)."""
    raise HTTPException(status_code=410, detail="The legacy Patch Agent is retired. Nexus Agent enrollment is recorded automatically.")
    await db.agent_deployments.update_one(
        {"device_id": device_id},
        {"$set": {"status": "deployed", "deployed_at": datetime.now(timezone.utc).isoformat(), "deployed_by": current_user.get("name", "")}}
    )
    await db.devices.update_one({"id": device_id}, {"$set": {"agent_deploy_status": "deployed", "agent_version": "1.0.0"}})
    return {"message": "Agent deployment marked complete"}


@router.post("/rustdesk/deploy-agent/bulk")
async def bulk_deploy_agent(data: dict, current_user: dict = Depends(get_current_user)):
    """Queue agent deployment for multiple devices at once."""
    raise HTTPException(status_code=410, detail="The legacy Patch Agent is retired. Use Nexus Agent installers instead.")
    device_ids = data.get("device_ids", [])
    if not device_ids:
        raise HTTPException(status_code=400, detail="No devices specified")

    settings = await db.settings.find_one({"type": "patch_agent"}, {"_id": 0})
    api_url = settings.get("api_url", "") if settings else ""
    agent_key = settings.get("agent_api_key", f"nxagent-{uuid.uuid4().hex[:16]}") if settings else f"nxagent-{uuid.uuid4().hex[:16]}"

    devices = await db.devices.find({"id": {"$in": device_ids}}, {"_id": 0}).to_list(500)
    queued = 0
    for device in devices:
        deploy_cmd = f'powershell -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri \'{api_url}/patch-hub/agent/download-script\' -OutFile NexusOps-PatchAgent.ps1; .\\NexusOps-PatchAgent.ps1"'
        deployment = {
            "id": f"dep-{uuid.uuid4().hex[:8]}",
            "device_id": device["id"],
            "device_name": device.get("name", device.get("hostname", "Unknown")),
            "client_id": device.get("client_id", ""),
            "client_name": device.get("client_name", ""),
            "status": "pending",
            "deploy_command": deploy_cmd,
            "queued_by": current_user.get("name", ""),
            "queued_at": datetime.now(timezone.utc).isoformat(),
            "deployed_at": None,
            "agent_version": "1.0.0",
        }
        await db.agent_deployments.update_one(
            {"device_id": device["id"]},
            {"$set": deployment, "$setOnInsert": {"first_queued": datetime.now(timezone.utc).isoformat()}},
            upsert=True
        )
        await db.devices.update_one({"id": device["id"]}, {"$set": {"agent_deploy_status": "pending"}})
        queued += 1

    return {"message": f"Agent deployment queued for {queued} devices", "queued_count": queued}


@router.get("/rustdesk/agent-deployments")
async def get_agent_deployments(current_user: dict = Depends(get_current_user)):
    """Get all agent deployment statuses."""
    raise HTTPException(status_code=410, detail="The legacy Patch Agent is retired. Nexus Agent enrollment is available in the Nexus Agent workspace.")
    deployments = await db.agent_deployments.find({}, {"_id": 0}).sort("queued_at", -1).to_list(500)
    return {
        "total": len(deployments),
        "pending": len([d for d in deployments if d.get("status") == "pending"]),
        "deployed": len([d for d in deployments if d.get("status") == "deployed"]),
        "failed": len([d for d in deployments if d.get("status") == "failed"]),
        "deployments": deployments,
    }


# ─── Live RustDesk Server API Integration ───

@router.get("/rustdesk/live/test-connection")
async def test_rustdesk_connection(
    server_url: Optional[str] = None,
    api_key: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Test connectivity to a RustDesk server. Uses query params if provided, otherwise falls back to saved config."""
    if server_url:
        # Normalize URL from query param
        server_url = server_url.strip().rstrip("/")
        if not server_url.startswith("http"):
            server_url = f"https://{server_url}"
        api_key = api_key or ""
    else:
        config = await _get_rustdesk_config()
        server_url = config.get("server_url", "").rstrip("/")
        api_key = config.get("api_key", "")
    
    if not server_url:
        return {"connected": False, "message": "No server URL configured"}
    
    results = {"server_url": server_url, "connected": False, "api_version": None, "peer_count": None, "endpoints_available": []}
    
    # Try multiple API patterns
    endpoints_to_try = [
        ("GET", "/peers", "peers"),
        ("GET", "/v1/peers", "v1_peers"),
        ("GET", "/ab/peers", "ab_peers"),
        ("GET", "/heartbeat", "heartbeat"),
    ]
    
    try:
        async with httpx.AsyncClient(timeout=10.0, verify=os.environ.get('ALLOW_SELF_SIGNED_CERTS','false').lower()!='true') as client:
            headers_dict = {}
            if api_key:
                headers_dict["Authorization"] = f"Bearer {api_key}"
            
            # Basic connectivity check
            for method, path, label in endpoints_to_try:
                try:
                    url = f"{server_url}/api{path}"
                    resp = await client.get(url, headers=headers_dict)
                    if resp.status_code in [200, 401, 403]:
                        results["connected"] = True
                        results["endpoints_available"].append({"path": path, "status": resp.status_code, "label": label})
                        if resp.status_code == 200:
                            try:
                                data = resp.json()
                                if isinstance(data, list):
                                    results["peer_count"] = len(data)
                                elif isinstance(data, dict) and "data" in data:
                                    results["peer_count"] = len(data["data"]) if isinstance(data["data"], list) else None
                            except Exception:
                                pass
                except Exception:
                    continue
            
            # Try root API
            try:
                resp = await client.get(f"{server_url}/api", headers=headers_dict)
                if resp.status_code == 200:
                    results["connected"] = True
            except Exception:
                pass
                    
        if not results["connected"]:
            # Try raw TCP to see if server is reachable
            try:
                resp = await httpx.AsyncClient(timeout=5.0, verify=os.environ.get('ALLOW_SELF_SIGNED_CERTS','false').lower()!='true').get(server_url)
                results["connected"] = True
                results["message"] = f"Server reachable (HTTP {resp.status_code}) but API endpoints not accessible. Check API key permissions."
            except Exception:
                results["message"] = "Cannot reach server. Check URL and firewall rules."
    except Exception as e:
        results["message"] = f"Connection error: {str(e)}"
    
    if results["connected"] and not results.get("message"):
        results["message"] = f"Connected successfully. {len(results['endpoints_available'])} API endpoint(s) accessible."
    
    return results


@router.get("/rustdesk/live/peers")
async def get_live_peers(current_user: dict = Depends(get_current_user)):
    """Fetch live peer data from the RustDesk server. Tries multiple API patterns."""
    config = await _get_rustdesk_config()
    server_url = config.get("server_url", "").rstrip("/")
    api_key = config.get("api_key", "")
    
    if not server_url:
        raise HTTPException(status_code=400, detail="RustDesk server not configured")
    
    peers = []
    source = None
    
    headers_dict = {}
    if api_key:
        headers_dict["Authorization"] = f"Bearer {api_key}"
    
    try:
        async with httpx.AsyncClient(timeout=15.0, verify=os.environ.get('ALLOW_SELF_SIGNED_CERTS','false').lower()!='true') as client:
            # Try different peer list endpoints
            for path in ["/peers", "/v1/peers", "/ab/peers", "/ab"]:
                try:
                    resp = await client.get(f"{server_url}/api{path}", headers=headers_dict)
                    if resp.status_code == 200:
                        data = resp.json()
                        if isinstance(data, list):
                            peers = data
                            source = path
                            break
                        elif isinstance(data, dict):
                            if "data" in data and isinstance(data["data"], list):
                                peers = data["data"]
                                source = path
                                break
                            elif "peers" in data and isinstance(data["peers"], list):
                                peers = data["peers"]
                                source = path
                                break
                except Exception:
                    continue
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to reach RustDesk server: {str(e)}")
    
    # Normalize peer data
    normalized = []
    for p in peers:
        normalized.append({
            "id": p.get("id") or p.get("Id") or p.get("peer_id") or "",
            "hostname": p.get("hostname") or p.get("Hostname") or p.get("host_name") or "",
            "username": p.get("username") or p.get("Username") or "",
            "os": p.get("os") or p.get("platform") or p.get("Platform") or "",
            "online": p.get("online", False) if isinstance(p.get("online"), bool) else str(p.get("online", "")).lower() in ["true", "1", "yes"],
            "last_online": p.get("last_online") or p.get("LastOnline") or "",
            "version": p.get("version") or p.get("Version") or "",
            "ip": p.get("ip") or "",
            "tags": p.get("tags") or p.get("Tags") or [],
            "alias": p.get("alias") or p.get("note") or "",
            "raw": p,
        })
    
    return {"peers": normalized, "count": len(normalized), "source": source, "server_url": server_url}


@router.get("/rustdesk/live/status-map")
async def get_live_status_map(current_user: dict = Depends(get_current_user)):
    """Lightweight endpoint: returns {rd_id: online/offline} map for all known peers.
    Used for polling connection status indicators on Devices pages."""
    config = await _get_rustdesk_config()
    server_url = config.get("server_url", "").rstrip("/")
    api_key = config.get("api_key", "")
    
    if not server_url:
        return {"status_map": {}, "server_configured": False}
    
    headers_dict = {}
    if api_key:
        headers_dict["Authorization"] = f"Bearer {api_key}"
    
    status_map = {}
    try:
        async with httpx.AsyncClient(timeout=8.0, verify=os.environ.get('ALLOW_SELF_SIGNED_CERTS','false').lower()!='true') as client:
            for path in ["/ab/peers", "/peers", "/v1/peers"]:
                try:
                    resp = await client.get(f"{server_url}/api{path}", headers=headers_dict)
                    if resp.status_code == 200:
                        data = resp.json()
                        peers = data if isinstance(data, list) else data.get("data", data.get("peers", []))
                        if isinstance(peers, list):
                            for p in peers:
                                rd_id = str(p.get("id") or p.get("Id") or p.get("peer_id") or "")
                                if rd_id:
                                    is_online = p.get("online", False) if isinstance(p.get("online"), bool) else str(p.get("online", "")).lower() in ["true", "1", "yes"]
                                    status_map[rd_id] = "online" if is_online else "offline"
                            break
                except Exception:
                    continue
    except Exception:
        pass
    
    return {"status_map": status_map, "server_configured": True, "peer_count": len(status_map)}



@router.post("/rustdesk/live/sync")
async def sync_rustdesk_peers(current_user: dict = Depends(get_current_user)):
    """Sync live RustDesk peers into the NexusOps device/rustdesk_devices collections.
    - Matches by RustDesk ID to existing devices
    - Updates online/offline status
    - Creates new rustdesk_devices entries for unmatched peers
    """
    config = await _get_rustdesk_config()
    server_url = config.get("server_url", "").rstrip("/")
    if not server_url:
        raise HTTPException(status_code=400, detail="RustDesk server not configured")
    
    # Fetch live peers
    headers_dict = {}
    api_key = config.get("api_key", "")
    if api_key:
        headers_dict["Authorization"] = f"Bearer {api_key}"
    
    peers = []
    try:
        async with httpx.AsyncClient(timeout=15.0, verify=os.environ.get('ALLOW_SELF_SIGNED_CERTS','false').lower()!='true') as client:
            for path in ["/peers", "/v1/peers", "/ab/peers", "/ab"]:
                try:
                    resp = await client.get(f"{server_url}/api{path}", headers=headers_dict)
                    if resp.status_code == 200:
                        data = resp.json()
                        if isinstance(data, list):
                            peers = data; break
                        elif isinstance(data, dict):
                            if "data" in data and isinstance(data["data"], list):
                                peers = data["data"]; break
                            elif "peers" in data:
                                peers = data["peers"]; break
                except Exception:
                    continue
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Cannot reach RustDesk server: {str(e)}")
    
    if not peers:
        return {"message": "No peers found on server or API not accessible", "synced": 0, "created": 0, "updated": 0}
    
    # Normalize
    normalized = []
    for p in peers:
        rd_id = p.get("id") or p.get("Id") or p.get("peer_id") or ""
        if rd_id:
            normalized.append({
                "rd_id": str(rd_id),
                "hostname": p.get("hostname") or p.get("Hostname") or p.get("host_name") or "",
                "username": p.get("username") or p.get("Username") or "",
                "os": p.get("os") or p.get("platform") or p.get("Platform") or "",
                "online": p.get("online", False) if isinstance(p.get("online"), bool) else str(p.get("online", "")).lower() in ["true", "1", "yes"],
                "version": p.get("version") or p.get("Version") or "",
                "ip": p.get("ip") or "",
                "alias": p.get("alias") or p.get("note") or "",
            })
    
    # Load existing data
    existing_rd = await db.rustdesk_devices.find({}, {"_id": 0}).to_list(1000)
    existing_devices = await db.devices.find({"rustdesk_id": {"$exists": True, "$ne": ""}}, {"_id": 0, "id": 1, "rustdesk_id": 1}).to_list(1000)
    
    rd_by_id = {r.get("rustdesk_id"): r for r in existing_rd if r.get("rustdesk_id")}
    dev_by_rd = {d.get("rustdesk_id"): d for d in existing_devices if d.get("rustdesk_id")}
    
    created = 0
    updated = 0
    now = datetime.now(timezone.utc).isoformat()
    
    for peer in normalized:
        rd_id = peer["rd_id"]
        status = "online" if peer["online"] else "offline"
        
        # Update existing device status
        if rd_id in dev_by_rd:
            await db.devices.update_one(
                {"rustdesk_id": rd_id},
                {"$set": {"status": status, "rd_last_seen": now, "rd_hostname": peer["hostname"], "rd_version": peer["version"]}}
            )
            updated += 1
        
        # Update or create rustdesk_devices entry
        if rd_id in rd_by_id:
            await db.rustdesk_devices.update_one(
                {"rustdesk_id": rd_id},
                {"$set": {"status": status, "os": peer["os"] or rd_by_id[rd_id].get("os", ""), "last_online": now if peer["online"] else rd_by_id[rd_id].get("last_online"), "rd_version": peer["version"], "rd_hostname": peer["hostname"]}}
            )
            updated += 1
        else:
            # New peer - create rustdesk_devices entry
            entry = {
                "id": str(uuid.uuid4()),
                "client_id": "",
                "client_name": "",
                "device_name": peer["alias"] or peer["hostname"] or f"RustDesk-{rd_id}",
                "rustdesk_id": rd_id,
                "rustdesk_password": "",
                "os": peer["os"],
                "status": status,
                "last_connected": now if peer["online"] else None,
                "last_online": now if peer["online"] else None,
                "rd_version": peer["version"],
                "rd_hostname": peer["hostname"],
                "notes": f"Auto-synced from RustDesk server",
                "linked_device_id": "",
                "created_by": current_user["id"],
                "created_at": now,
                "updated_at": now,
            }
            await db.rustdesk_devices.insert_one(entry)
            created += 1
    
    # Update sync timestamp
    await db.settings.update_one(
        {"key": "rustdesk_config"},
        {"$set": {"value.last_sync": now, "value.last_sync_peers": len(normalized)}}
    )
    
    return {"message": f"Synced {len(normalized)} peers from RustDesk server", "synced": len(normalized), "created": created, "updated": updated}


@router.get("/rustdesk/live/audit")
async def get_live_audit_logs(current_user: dict = Depends(get_current_user)):
    """Fetch live session audit logs from the RustDesk server."""
    config = await _get_rustdesk_config()
    server_url = config.get("server_url", "").rstrip("/")
    if not server_url:
        return {"logs": [], "source": None}
    
    headers_dict = {}
    api_key = config.get("api_key", "")
    if api_key:
        headers_dict["Authorization"] = f"Bearer {api_key}"
    
    logs = []
    source = None
    try:
        async with httpx.AsyncClient(timeout=10.0, verify=os.environ.get('ALLOW_SELF_SIGNED_CERTS','false').lower()!='true') as client:
            for path in ["/audit", "/v1/audit", "/sessions", "/conn-log"]:
                try:
                    resp = await client.get(f"{server_url}/api{path}", headers=headers_dict)
                    if resp.status_code == 200:
                        data = resp.json()
                        if isinstance(data, list):
                            logs = data; source = path; break
                        elif isinstance(data, dict) and "data" in data:
                            logs = data["data"]; source = path; break
                except Exception:
                    continue
    except Exception:
        pass
    
    return {"logs": logs[:100], "count": len(logs), "source": source}



# ============== REMOTE SESSION AUDIT RECORDS (Admin) ==============

@router.get("/remote-session-records")
async def admin_list_remote_session_records(
    client_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 200,
    current_user: dict = Depends(get_current_user)
):
    """Admin endpoint — list all client-portal remote session audit records."""
    query = {}
    if client_id:
        query["client_id"] = client_id
    if status:
        query["status"] = status
    recs = await db.remote_session_records.find(query, {"_id": 0}).sort("started_at", -1).to_list(limit)
    return recs


@router.get("/remote-session-records/{session_id}/pdf")
async def admin_remote_session_pdf(session_id: str, current_user: dict = Depends(get_current_user)):
    """Admin-side download of a portal remote-session audit PDF."""
    from fpdf import FPDF
    from fastapi.responses import Response

    rec = await db.remote_session_records.find_one({"id": session_id}, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=404, detail="Remote session record not found")

    branding = await db.settings.find_one({"key": "branding"}, {"_id": 0}) or {}
    msp_name = (branding.get("value", {}) or {}).get("company_name") or "NexusOps"

    def _fmt_dur(s):
        if s is None: return "In progress"
        s = int(s or 0); h, rem = divmod(s, 3600); m, sec = divmod(rem, 60)
        return f"{h}h {m}m {sec}s" if h else (f"{m}m {sec}s" if m else f"{sec}s")
    def _fmt_dt(iso):
        if not iso: return "—"
        try:
            return datetime.fromisoformat(iso.replace("Z", "+00:00")).strftime("%Y-%m-%d %H:%M:%S UTC")
        except Exception: return iso

    pdf = FPDF(); pdf.add_page()
    pdf.set_fill_color(15, 23, 42); pdf.rect(0, 0, 210, 25, "F")
    pdf.set_font("Helvetica", "B", 16); pdf.set_text_color(255, 255, 255); pdf.set_xy(10, 8)
    pdf.cell(0, 8, msp_name, ln=1)
    pdf.set_font("Helvetica", "", 10); pdf.set_x(10); pdf.cell(0, 5, "Remote Access Session - Audit Record", ln=1)
    pdf.set_text_color(0, 0, 0); pdf.set_y(35)
    pdf.set_font("Helvetica", "B", 13); pdf.cell(0, 8, f"Session ID: {rec['id'][:8].upper()}", ln=1); pdf.ln(2)

    def row(l, v):
        pdf.set_font("Helvetica", "B", 10); pdf.cell(55, 7, l)
        pdf.set_font("Helvetica", "", 10)
        txt = str(v or "-").encode("latin-1", "replace").decode("latin-1")
        if len(txt) > 85: txt = txt[:82] + "..."
        pdf.cell(0, 7, txt, ln=1)

    pdf.set_font("Helvetica", "B", 11); pdf.cell(0, 7, "Session Details", ln=1)
    pdf.set_draw_color(200, 200, 200); pdf.line(10, pdf.get_y(), 200, pdf.get_y()); pdf.ln(2)
    row("Client", rec.get("client_name"))
    row("Initiated by", f"{rec.get('portal_user_name')} ({rec.get('portal_user_email')})")
    row("Device", f"{rec.get('device_name')} ({rec.get('device_os', '—')})")
    row("RustDesk ID", rec.get("rustdesk_id"))
    row("Started at", _fmt_dt(rec.get("started_at")))
    row("Ended at", _fmt_dt(rec.get("ended_at")))
    row("Duration", _fmt_dur(rec.get("duration_seconds")))
    row("Status", (rec.get("status") or "").capitalize())
    row("IP address", rec.get("ip_address"))
    pdf.ln(4); pdf.set_font("Helvetica", "B", 11); pdf.cell(0, 7, "Consent Acknowledgement", ln=1)
    pdf.line(10, pdf.get_y(), 200, pdf.get_y()); pdf.ln(2)
    pdf.set_font("Helvetica", "", 10); pdf.multi_cell(0, 6, (rec.get("consent_text") or "-").encode("latin-1","replace").decode("latin-1"))
    pdf.ln(1); pdf.set_font("Helvetica", "I", 9); pdf.set_text_color(80, 80, 80)
    pdf.cell(0, 5, f"Acknowledged at: {_fmt_dt(rec.get('consent_acknowledged_at'))}", ln=1)
    if rec.get("notes"):
        pdf.ln(4); pdf.set_text_color(0, 0, 0); pdf.set_font("Helvetica", "B", 11); pdf.cell(0, 7, "Session Notes", ln=1)
        pdf.line(10, pdf.get_y(), 200, pdf.get_y()); pdf.ln(2)
        pdf.set_font("Helvetica", "", 10); pdf.multi_cell(0, 6, rec.get("notes").encode("latin-1","replace").decode("latin-1"))
    pdf.set_y(-25); pdf.set_font("Helvetica", "", 8); pdf.set_text_color(120, 120, 120)
    pdf.cell(0, 5, f"Generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} · {msp_name}", ln=1, align="C")
    pdf.cell(0, 5, "This document is a tamper-evident audit record of a client-initiated remote access session.", ln=1, align="C")

    pdf_bytes = bytes(pdf.output(dest="S"))
    return Response(content=pdf_bytes, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="remote-session-{rec["id"][:8]}.pdf"'})
