from fastapi import APIRouter, Depends
from datetime import datetime, timezone
import os, json
from app.database import db
from app.auth import get_current_user

router = APIRouter()


@router.get("/upsell/opportunities")
async def get_upsell_opportunities(current_user: dict = Depends(get_current_user)):
    """AI-scan for upsell opportunities across all clients."""
    clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1, "tier": 1, "email": 1}).to_list(500)
    opportunities = []

    for c in clients:
        cid = c["id"]
        opps = []

        # Check device count vs contract coverage
        device_count = await db.devices.count_documents({"client_id": cid})
        contracts = await db.contracts.find({"client_id": cid, "status": "active"}, {"_id": 0}).to_list(10)
        has_contract = len(contracts) > 0
        contract_devices = sum(ct.get("device_limit", 0) for ct in contracts)

        if device_count > 0 and (not has_contract or device_count > contract_devices > 0):
            opps.append({
                "type": "device_coverage",
                "title": "Device Coverage Gap",
                "description": f"Client has {device_count} devices but contract covers {contract_devices or 'none'}",
                "potential_value": (device_count - max(contract_devices, 0)) * 15,
                "priority": "high",
            })

        # Check backup coverage
        health = await db.device_health.find({"client_id": cid}, {"_id": 0}).to_list(100)
        unmonitored = device_count - len(health)
        if unmonitored > 0 and device_count > 3:
            opps.append({
                "type": "monitoring_gap",
                "title": "Unmonitored Devices",
                "description": f"{unmonitored} of {device_count} devices lack health monitoring",
                "potential_value": unmonitored * 10,
                "priority": "medium",
            })

        # Check if no backup (Acronis)
        acronis = await db.acronis_devices.count_documents({"client_id": cid})
        if device_count > 3 and acronis == 0:
            opps.append({
                "type": "backup_gap",
                "title": "No Backup Solution",
                "description": f"Client has {device_count} devices with no Acronis backup",
                "potential_value": device_count * 8,
                "priority": "high",
            })

        # Tier upgrade opportunity
        ticket_count = await db.tickets.count_documents({"client_id": cid})
        if c.get("tier") in ["basic", "standard"] and ticket_count > 20:
            opps.append({
                "type": "tier_upgrade",
                "title": "Tier Upgrade Candidate",
                "description": f"High ticket volume ({ticket_count}) suggests need for premium support",
                "potential_value": 200,
                "priority": "medium",
            })

        # Security assessment needed
        recent_security = await db.tickets.count_documents({
            "client_id": cid, "category": "security",
            "created_at": {"$gte": (datetime.now(timezone.utc).replace(day=1)).isoformat()}
        })
        if recent_security > 2:
            opps.append({
                "type": "security_assessment",
                "title": "Security Assessment Needed",
                "description": f"{recent_security} security incidents this month — recommend security audit",
                "potential_value": 500,
                "priority": "high",
            })

        if opps:
            total_value = sum(o["potential_value"] for o in opps)
            opportunities.append({
                "client_id": cid, "client_name": c.get("name", ""),
                "tier": c.get("tier", "standard"),
                "opportunities": opps,
                "total_potential_value": total_value,
            })

    opportunities.sort(key=lambda x: x["total_potential_value"], reverse=True)

    total_pipeline = sum(o["total_potential_value"] for o in opportunities)
    return {
        "opportunities": opportunities,
        "total_clients_with_opps": len(opportunities),
        "total_pipeline_value": total_pipeline,
        "by_type": _count_by_type(opportunities),
    }


def _count_by_type(opps):
    counts = {}
    for o in opps:
        for opp in o["opportunities"]:
            t = opp["type"]
            counts[t] = counts.get(t, 0) + 1
    return counts
