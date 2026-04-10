from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random; random = random.SystemRandom()
import uuid

router = APIRouter()

@router.get("/nlp-query/search")
async def nlp_query(q: str = "", current_user: dict = Depends(get_current_user)):
    """Natural language query engine - parse plain English into filtered results"""
    if not q:
        return {"results": [], "interpretation": "No query provided", "suggestions": [
            "Show me all devices with failed patches",
            "Which clients have the most open tickets?",
            "Devices offline for more than 24 hours",
            "Servers with high CPU usage",
            "Tickets assigned to me that are overdue",
        ]}
    q_lower = q.lower()
    interpretation = ""
    results = []

    if "offline" in q_lower or "down" in q_lower:
        devices = await db.devices.find({"status": "offline"}, {"_id": 0, "id": 1, "name": 1, "client_name": 1, "status": 1, "last_seen": 1}).to_list(100)
        interpretation = f"Found {len(devices)} offline devices"
        results = [{"type": "device", **d} for d in devices]
    elif "patch" in q_lower and ("fail" in q_lower or "error" in q_lower):
        devices = await db.devices.find({"patch_status": {"$in": ["critical", "needs_attention"]}}, {"_id": 0, "id": 1, "name": 1, "client_name": 1, "patch_status": 1, "pending_patches": 1}).to_list(100)
        interpretation = f"Found {len(devices)} devices with patch issues"
        results = [{"type": "device", **d} for d in devices]
    elif "ticket" in q_lower and "open" in q_lower:
        tickets = await db.tickets.find({"status": "open"}, {"_id": 0, "id": 1, "title": 1, "client_name": 1, "priority": 1, "assigned_to": 1}).to_list(100)
        interpretation = f"Found {len(tickets)} open tickets"
        results = [{"type": "ticket", **t} for t in tickets]
    elif "server" in q_lower or "cpu" in q_lower:
        devices = await db.devices.find({"type": "server"}, {"_id": 0, "id": 1, "name": 1, "client_name": 1, "cpu_usage": 1, "ram_usage": 1}).to_list(100)
        interpretation = f"Found {len(devices)} servers"
        results = [{"type": "device", **d} for d in devices]
    elif "client" in q_lower and "ticket" in q_lower:
        pipeline = [{"$match": {"status": "open"}}, {"$group": {"_id": "$client_name", "count": {"$sum": 1}}}, {"$sort": {"count": -1}}]
        agg = await db.tickets.aggregate(pipeline).to_list(50)
        interpretation = f"Ticket counts by client"
        results = [{"type": "stat", "client_name": a["_id"], "open_tickets": a["count"]} for a in agg]
    else:
        devices = await db.devices.find({"$or": [{"name": {"$regex": q, "$options": "i"}}, {"client_name": {"$regex": q, "$options": "i"}}]}, {"_id": 0, "id": 1, "name": 1, "client_name": 1, "status": 1}).to_list(50)
        tickets = await db.tickets.find({"$or": [{"title": {"$regex": q, "$options": "i"}}, {"description": {"$regex": q, "$options": "i"}}]}, {"_id": 0, "id": 1, "title": 1, "client_name": 1, "status": 1}).to_list(50)
        interpretation = f"Found {len(devices)} devices and {len(tickets)} tickets matching '{q}'"
        results = [{"type": "device", **d} for d in devices] + [{"type": "ticket", **t} for t in tickets]

    return {"results": results[:50], "interpretation": interpretation, "query": q, "result_count": len(results)}
