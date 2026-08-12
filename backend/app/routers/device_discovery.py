from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from datetime import datetime, timezone
import ipaddress
import os
import uuid
import random; random = random.SystemRandom()
from app.database import db
from app.auth import get_current_user
from app.services.scope_permissions import assert_client_scope, scoped_query

router = APIRouter()

# ============== NETWORK DEVICE DISCOVERY ==============

@router.post("/devices/discover")
async def discover_devices(data: dict, current_user: dict = Depends(get_current_user)):
    """Run a clearly labelled demo scan only when demo mode is explicitly enabled.

    Real discovery must be performed through a scoped Nexus Edge discovery
    probe. Returning invented devices in a production deployment is unsafe, so
    this legacy demo path is intentionally disabled by default.
    """
    client_id = data.get("client_id")
    subnet = data.get("subnet", "192.168.1.0/24")

    if not client_id:
        raise HTTPException(status_code=400, detail="client_id is required")

    await assert_client_scope(current_user, client_id, operation="device.discovery.create")
    try:
        network = ipaddress.ip_network(subnet, strict=True)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Subnet must be a valid CIDR") from exc
    if not network.is_private or network.num_addresses > 1024:
        raise HTTPException(status_code=422, detail="Discovery is limited to approved private CIDRs of 1,024 addresses or fewer")

    client = await db.clients.find_one(scoped_query(current_user, {"id": client_id}), {"_id": 0, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    if os.getenv("NEXUS_DEMO_MODE", "").lower() not in {"1", "true", "yes"}:
        edge = await db.nexus_deployments.find_one(
            scoped_query(current_user, {"kind": "edge", "client_id": client_id, "edge_roles": "discovery_probe", "activation_used_at": {"$ne": None}}),
            {"_id": 0, "id": 1, "name": 1, "last_seen_at": 1},
        )
        if not edge:
            raise HTTPException(
                status_code=409,
                detail="Prepare and activate a client-scoped Nexus Edge with the Discovery probe role before running a real discovery scan. Nexus will not invent device results.",
            )
        raise HTTPException(
            status_code=409,
            detail=f"Nexus Edge {edge.get('name') or edge.get('id')} is enrolled, but live discovery dispatch is not enabled in this release. No scan was run and no device data was created.",
        )

    # Get existing devices for this client to avoid duplicates
    existing = await db.devices.find({"client_id": client_id}, {"_id": 0, "ip_address": 1, "mac_address": 1}).to_list(500)
    existing_ips = {d.get("ip_address") for d in existing if d.get("ip_address")}
    existing_macs = {d.get("mac_address") for d in existing if d.get("mac_address")}

    # Explicit demo-only sample data. It can never be confused with an Edge
    # observation because the response and persisted scan record carry mode.
    base_ip = subnet.split("/")[0].rsplit(".", 1)[0]
    manufacturers = ["Dell", "HP", "Lenovo", "Cisco", "Apple", "Microsoft", "ASUS", "Acer", "Ubiquiti", "Synology"]
    os_types = ["Windows 11", "Windows 10", "macOS Ventura", "Ubuntu 22.04", "CentOS 8", "pfSense", "UniFi OS"]
    device_types = ["workstation", "laptop", "server", "network", "mobile"]
    device_names_prefix = ["WS", "LPT", "SRV", "SW", "AP", "FW", "NAS", "PRINT"]

    discovered = []
    num_devices = random.randint(4, 12)
    used_ips = set()

    for i in range(num_devices):
        ip_suffix = random.randint(2, 254)
        ip = f"{base_ip}.{ip_suffix}"
        while ip in used_ips or ip in existing_ips:
            ip_suffix = random.randint(2, 254)
            ip = f"{base_ip}.{ip_suffix}"
        used_ips.add(ip)

        mac = ":".join([f"{random.randint(0,255):02X}" for _ in range(6)])
        while mac in existing_macs:
            mac = ":".join([f"{random.randint(0,255):02X}" for _ in range(6)])

        mfr = random.choice(manufacturers)
        dtype = random.choice(device_types)
        prefix = random.choice(device_names_prefix)
        hostname = f"{prefix}-{client.get('name', 'DEV')[:4].upper()}-{ip_suffix:03d}"
        os_name = random.choice(os_types)
        is_existing = ip in existing_ips

        discovered.append({
            "id": str(uuid.uuid4()),
            "hostname": hostname,
            "ip_address": ip,
            "mac_address": mac,
            "manufacturer": mfr,
            "os": os_name,
            "device_type": dtype,
            "status": random.choice(["online", "online", "online", "offline"]),
            "open_ports": sorted(random.sample([22, 80, 443, 3389, 5900, 8080, 8443, 53, 445, 139, 21, 25, 110], random.randint(1, 4))),
            "already_imported": is_existing,
            "response_time_ms": round(random.uniform(0.5, 45.0), 1),
        })

    # Store the scan result
    scan_id = str(uuid.uuid4())
    scan_record = {
        "id": scan_id,
        "client_id": client_id,
        "client_name": client.get("name", ""),
        "subnet": subnet,
        "discovered_count": len(discovered),
        "devices": discovered,
        "scanned_by": current_user["id"],
        "scanned_by_name": current_user["name"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "mode": "demo_simulation",
    }
    await db.network_scans.insert_one(scan_record)
    scan_record.pop("_id", None)

    return {
        "scan_id": scan_id,
        "subnet": subnet,
        "client_name": client.get("name", ""),
        "discovered_count": len(discovered),
        "devices": discovered,
        "mode": "demo_simulation",
    }

@router.post("/devices/import-discovered")
async def import_discovered_devices(data: dict, current_user: dict = Depends(get_current_user)):
    """Import selected discovered devices into the devices list"""
    client_id = data.get("client_id")
    devices_to_import = data.get("devices", [])

    if not client_id:
        raise HTTPException(status_code=400, detail="client_id is required")
    if not devices_to_import:
        raise HTTPException(status_code=400, detail="No devices selected for import")

    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    imported = 0
    for dev in devices_to_import:
        # Check for duplicates
        existing = await db.devices.find_one({
            "client_id": client_id,
            "$or": [
                {"ip_address": dev.get("ip_address")},
                {"mac_address": dev.get("mac_address")},
            ]
        })
        if existing:
            continue

        new_device = {
            "id": str(uuid.uuid4()),
            "name": dev.get("hostname", dev.get("name", "Discovered Device")),
            "client_id": client_id,
            "client_name": client.get("name", ""),
            "device_type": dev.get("device_type", "workstation"),
            "os": dev.get("os", ""),
            "os_name": dev.get("os", ""),
            "ip_address": dev.get("ip_address", ""),
            "mac_address": dev.get("mac_address", ""),
            "manufacturer": dev.get("manufacturer", ""),
            "model": "",
            "serial_number": "",
            "status": dev.get("status", "online"),
            "cpu_usage": 0,
            "memory_usage": 0,
            "disk_usage": 0,
            "tags": ["discovered", "auto-imported"],
            "notes": f"Auto-imported via network discovery on {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}",
            "source": "network_discovery",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.devices.insert_one(new_device)
        imported += 1

    return {"message": f"Imported {imported} devices", "imported_count": imported}

@router.get("/devices/scans")
async def get_scan_history(
    client_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get network scan history"""
    query = {}
    if client_id:
        query["client_id"] = client_id
    scans = await db.network_scans.find(query, {"_id": 0, "devices": 0}).sort("created_at", -1).to_list(50)
    return scans
