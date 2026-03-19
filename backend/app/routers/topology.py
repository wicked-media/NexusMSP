from fastapi import APIRouter, Depends
from datetime import datetime, timezone
import uuid
from app.database import db
from app.auth import get_current_user

router = APIRouter()


@router.get("/topology/all")
async def get_all_topologies(current_user: dict = Depends(get_current_user)):
    """Get topology summary for all clients."""
    clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(200)
    result = []
    for c in clients:
        count = await db.devices.count_documents({"client_id": c["id"]})
        online = await db.devices.count_documents({"client_id": c["id"], "status": "online"})
        if count > 0:
            result.append({
                "client_id": c["id"], "client_name": c.get("name", ""),
                "device_count": count, "online_count": online,
                "health_pct": round((online / max(count, 1)) * 100),
            })
    return sorted(result, key=lambda x: x["device_count"], reverse=True)


@router.get("/topology/{client_id}")
async def get_network_topology(client_id: str, current_user: dict = Depends(get_current_user)):
    """Get network topology for a client as a graph of nodes and edges."""
    devices = await db.devices.find({"client_id": client_id}, {"_id": 0}).to_list(200)
    if not devices:
        return {"nodes": [], "edges": [], "client_name": ""}

    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1})
    nodes = []
    edges = []

    # Build node list with positioning
    type_groups = {}
    for d in devices:
        dt = d.get("device_type", "workstation")
        if dt not in type_groups:
            type_groups[dt] = []
        type_groups[dt].append(d)

    # Create gateway/router node at top
    gateway = None
    for d in devices:
        if d.get("device_type") in ["router", "firewall", "gateway"]:
            gateway = d
            break

    # Position nodes in a hierarchical layout
    y_offset = 0
    type_order = ["router", "firewall", "gateway", "switch", "server", "workstation", "laptop", "printer", "other"]
    for dtype in type_order:
        group = type_groups.get(dtype, [])
        for i, d in enumerate(group):
            nodes.append({
                "id": d["id"],
                "label": d.get("hostname", d.get("name", "Unknown")),
                "type": dtype,
                "status": d.get("status", "unknown"),
                "ip": d.get("ip_address", ""),
                "os": d.get("os", ""),
                "x": (i - len(group) / 2) * 180,
                "y": y_offset,
            })
        if group:
            y_offset += 150

    # Create edges (connect devices to gateway/switch, or nearest infrastructure device)
    infra_ids = [d["id"] for d in devices if d.get("device_type") in ["router", "switch", "firewall", "gateway"]]
    for d in devices:
        if d.get("device_type") not in ["router", "switch", "firewall", "gateway"]:
            target = infra_ids[0] if infra_ids else None
            if target:
                # Find closest infrastructure device by subnet
                ip = d.get("ip_address", "")
                for iid in infra_ids:
                    infra_dev = next((x for x in devices if x["id"] == iid), None)
                    if infra_dev and infra_dev.get("ip_address", "").rsplit(".", 1)[0] == ip.rsplit(".", 1)[0]:
                        target = iid
                        break
                edges.append({"source": target, "target": d["id"], "type": "ethernet"})

    # Connect switches to router
    for d in devices:
        if d.get("device_type") == "switch" and gateway:
            edges.append({"source": gateway["id"], "target": d["id"], "type": "uplink"})

    return {
        "client_name": (client or {}).get("name", ""),
        "nodes": nodes, "edges": edges,
        "stats": {
            "total_devices": len(devices),
            "online": sum(1 for d in devices if d.get("status") == "online"),
            "offline": sum(1 for d in devices if d.get("status") == "offline"),
            "types": {k: len(v) for k, v in type_groups.items()},
        }
    }
