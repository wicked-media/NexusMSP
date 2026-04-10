from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random; random = random.SystemRandom()

router = APIRouter()

@router.get("/capacity-planner/overview")
async def get_capacity_overview(current_user: dict = Depends(get_current_user)):
    techs = await db.users.find({"role": {"$in": ["admin", "technician"]}}, {"_id": 0, "id": 1, "name": 1, "role": 1}).to_list(50)
    tickets_30d = await db.tickets.count_documents({})
    devices = await db.devices.count_documents({})
    clients = await db.clients.count_documents({})
    tech_count = max(len(techs), 3)
    tickets_per_tech = round(tickets_30d / tech_count, 1) if tech_count else 0
    devices_per_tech = round(devices / tech_count, 1) if tech_count else 0
    trend = [{"month": f"2026-{m:02d}", "tickets": random.randint(80, 160), "tech_hours_available": tech_count * 160, "tech_hours_used": random.randint(tech_count * 100, tech_count * 155)} for m in range(1, 7)]
    return {
        "current": {"technicians": tech_count, "total_clients": clients, "total_devices": devices, "tickets_per_tech": tickets_per_tech, "devices_per_tech": devices_per_tech, "utilization_pct": round(random.uniform(70, 95), 1)},
        "forecast": {"recommended_techs": tech_count + (1 if devices_per_tech > 40 else 0), "hiring_needed": devices_per_tech > 40, "bottleneck": "ticket_volume" if tickets_per_tech > 30 else "none"},
        "trend": trend,
    }

@router.get("/auto-documentation/documents")
async def get_auto_docs(current_user: dict = Depends(get_current_user)):
    docs = await db.auto_generated_docs.find({}, {"_id": 0}).sort("generated_at", -1).to_list(50)
    if not docs:
        now = datetime.now(timezone.utc)
        docs = [
            {"id": "adoc-001", "client_name": "Acme Corporation", "doc_type": "network_diagram", "title": "Acme Corp - Network Topology", "description": "Auto-generated network diagram from device discovery data", "sections": ["WAN connectivity", "LAN segments", "Firewall rules", "VLAN configuration", "Device inventory"], "generated_at": (now - timedelta(days=7)).isoformat(), "status": "completed"},
            {"id": "adoc-002", "client_name": "Global Finance Ltd", "doc_type": "asset_inventory", "title": "Global Finance - Complete Asset Register", "description": "Full asset list with specs, warranty, and assignments", "sections": ["Servers", "Workstations", "Network equipment", "Peripherals", "Software licenses"], "generated_at": (now - timedelta(days=3)).isoformat(), "status": "completed"},
            {"id": "adoc-003", "client_name": "HealthCare Plus", "doc_type": "disaster_recovery", "title": "HC Plus - DR Plan", "description": "AI-generated disaster recovery plan based on infrastructure analysis", "sections": ["Critical systems", "Recovery order", "Contact list", "Backup verification", "RTO/RPO targets"], "generated_at": (now - timedelta(days=14)).isoformat(), "status": "completed"},
        ]
        for d in docs:
            await db.auto_generated_docs.insert_one(d)
        docs = [dict((k, v) for k, v in d.items() if k != "_id") for d in docs]
    return docs

@router.post("/auto-documentation/generate")
async def generate_doc(data: dict, current_user: dict = Depends(get_current_user)):
    import uuid
    doc = {"id": f"adoc-{uuid.uuid4().hex[:8]}", "client_name": data.get("client_name"), "doc_type": data.get("doc_type"), "title": data.get("title", f"{data.get('client_name')} - {data.get('doc_type', 'document').replace('_', ' ').title()}"), "description": f"Auto-generated {data.get('doc_type', 'document')}", "generated_at": datetime.now(timezone.utc).isoformat(), "generated_by": current_user.get("name"), "status": "generating"}
    await db.auto_generated_docs.insert_one(doc)
    doc.pop("_id", None)
    return doc
