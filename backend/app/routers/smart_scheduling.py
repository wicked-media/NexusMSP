from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
import uuid
import math
from app.database import db
from app.auth import get_current_user

router = APIRouter()

# Zone center coordinates (simulated for demo - would be configured per business)
ZONE_COORDS = {
    "North Rural": (-26.1, 28.0), "South Suburb": (-26.3, 28.05), "East Industrial": (-26.2, 28.15),
    "West CBD": (-26.2, 27.9), "Central": (-26.2, 28.05), "Downtown": (-26.19, 28.04),
}
DEFAULT_COORD = (-26.2, 28.05)


def haversine(lat1, lon1, lat2, lon2):
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


def estimate_travel_time(dist_km):
    avg_speed_kmh = 40
    return round(dist_km / avg_speed_kmh * 60)  # minutes


@router.get("/scheduling/calendar")
async def get_schedule_calendar(current_user: dict = Depends(get_current_user)):
    """Get all scheduled items for calendar view."""
    # Fetch field jobs, workshop jobs, and scheduled tickets
    fj = await db.field_jobs.find({"field_status": {"$ne": "completed"}}, {"_id": 0}).to_list(500)
    ws = await db.workshop_jobs.find({"repair_status": {"$nin": ["collected", "cancelled"]}}, {"_id": 0}).to_list(500)
    events = []
    for j in fj:
        events.append({
            "id": j["id"], "type": "field_job", "title": f"[FIELD] {j.get('customer_name', '')} - {j.get('description', '')[:50]}",
            "date": j.get("scheduled_date", ""), "time": j.get("scheduled_time", "09:00"),
            "duration": j.get("estimated_duration", 60), "zone": j.get("zone", ""),
            "technician": j.get("assigned_to_name", "Unassigned"), "technician_id": j.get("assigned_to", ""),
            "status": j.get("field_status", "scheduled"), "address": j.get("service_address", ""),
            "color": "#06b6d4",
        })
    for j in ws:
        events.append({
            "id": j["id"], "type": "workshop", "title": f"[WS] {j.get('customer_name', '')} - {j.get('fault_description', '')[:50]}",
            "date": j.get("created_at", "")[:10], "time": "09:00",
            "duration": j.get("estimated_duration", 60), "zone": "Workshop",
            "technician": j.get("assigned_to_name", "Unassigned"), "technician_id": j.get("assigned_to", ""),
            "status": j.get("repair_status", "checked_in"), "color": "#a855f7",
        })
    return events


@router.get("/scheduling/map-data")
async def get_map_data(current_user: dict = Depends(get_current_user)):
    """Get job locations for map view."""
    fj = await db.field_jobs.find({"field_status": {"$ne": "completed"}}, {"_id": 0}).to_list(200)
    markers = []
    for j in fj:
        zone = j.get("zone", "Central")
        coord = ZONE_COORDS.get(zone, DEFAULT_COORD)
        # Add slight randomization within zone
        import random
        lat = coord[0] + random.uniform(-0.02, 0.02)
        lng = coord[1] + random.uniform(-0.02, 0.02)
        markers.append({
            "id": j["id"], "lat": lat, "lng": lng, "zone": zone,
            "title": j.get("description", "Field Job")[:60],
            "customer": j.get("customer_name", ""),
            "address": j.get("service_address", ""),
            "status": j.get("field_status", "scheduled"),
            "technician": j.get("assigned_to_name", "Unassigned"),
            "scheduled": f"{j.get('scheduled_date', '')} {j.get('scheduled_time', '')}",
        })
    return {"markers": markers, "zones": ZONE_COORDS}


@router.post("/scheduling/optimize-route")
async def optimize_route(data: dict, current_user: dict = Depends(get_current_user)):
    """Optimize job order for a technician to minimize travel."""
    technician_id = data.get("technician_id")
    date = data.get("date")
    if not technician_id:
        return {"error": "technician_id required"}

    q = {"assigned_to": technician_id, "field_status": {"$nin": ["completed", "cancelled"]}}
    if date:
        q["scheduled_date"] = date
    jobs = await db.field_jobs.find(q, {"_id": 0}).to_list(50)
    if len(jobs) <= 1:
        return {"optimized_order": [j["id"] for j in jobs], "total_distance_km": 0, "total_travel_min": 0, "savings": 0}

    # Simple nearest-neighbor optimization
    coords = []
    for j in jobs:
        zone = j.get("zone", "Central")
        c = ZONE_COORDS.get(zone, DEFAULT_COORD)
        coords.append({"job": j, "lat": c[0], "lng": c[1]})

    # Calculate original distance
    orig_dist = 0
    for i in range(len(coords) - 1):
        orig_dist += haversine(coords[i]["lat"], coords[i]["lng"], coords[i + 1]["lat"], coords[i + 1]["lng"])

    # Nearest neighbor
    visited = [False] * len(coords)
    order = [0]
    visited[0] = True
    for _ in range(len(coords) - 1):
        curr = order[-1]
        best = -1
        best_dist = float("inf")
        for j in range(len(coords)):
            if not visited[j]:
                d = haversine(coords[curr]["lat"], coords[curr]["lng"], coords[j]["lat"], coords[j]["lng"])
                if d < best_dist:
                    best_dist = d
                    best = j
        if best >= 0:
            order.append(best)
            visited[best] = True

    opt_dist = 0
    for i in range(len(order) - 1):
        opt_dist += haversine(coords[order[i]]["lat"], coords[order[i]]["lng"], coords[order[i + 1]]["lat"], coords[order[i + 1]]["lng"])

    optimized = [coords[i]["job"]["id"] for i in order]
    optimized_jobs = [coords[i]["job"] for i in order]
    savings = max(0, orig_dist - opt_dist)

    return {
        "optimized_order": optimized,
        "optimized_jobs": optimized_jobs,
        "total_distance_km": round(opt_dist, 1),
        "original_distance_km": round(orig_dist, 1),
        "total_travel_min": estimate_travel_time(opt_dist),
        "savings_km": round(savings, 1),
        "savings_min": estimate_travel_time(savings),
    }


@router.get("/scheduling/technician-availability")
async def get_tech_availability(current_user: dict = Depends(get_current_user)):
    """Get technician availability based on scheduled jobs."""
    techs = await db.users.find({"role": {"$in": ["technician", "admin"]}}, {"_id": 0, "id": 1, "name": 1}).to_list(50)
    today = datetime.now(timezone.utc).date().isoformat()
    result = []
    for t in techs:
        jobs_today = await db.field_jobs.count_documents({"assigned_to": t["id"], "scheduled_date": today, "field_status": {"$ne": "completed"}})
        open_tickets = await db.tickets.count_documents({"assigned_to": t["id"], "status": {"$in": ["open", "in_progress"]}})
        result.append({
            "id": t["id"], "name": t["name"],
            "jobs_today": jobs_today, "open_tickets": open_tickets,
            "total_load": jobs_today + open_tickets,
            "available": jobs_today < 5,
        })
    return sorted(result, key=lambda x: x["total_load"])
