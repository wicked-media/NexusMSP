from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random; random = random.SystemRandom()
import uuid

router = APIRouter()

@router.get("/geo-map/data")
async def geo_map_data(current_user: dict = Depends(get_current_user)):
    sites = await db.geo_sites.find({}, {"_id": 0}).to_list(200)
    if not sites:
        sites = await _seed_sites()
    techs = await db.geo_technicians.find({}, {"_id": 0}).to_list(50)
    if not techs:
        techs = await _seed_techs()
    return {"sites": sites, "technicians": techs, "summary": {"total_sites": len(sites), "active_techs": len([t for t in techs if t.get("status") == "on_site"]), "available_techs": len([t for t in techs if t.get("status") == "available"]), "open_dispatch": len([t for t in techs if t.get("status") == "en_route"])}}

async def _seed_sites():
    site_data = [
        ("TechStart Inc - HQ", "TechStart Inc", -33.8688, 151.2093, 18, 1), ("TechStart Inc - Branch", "TechStart Inc", -33.7963, 151.1845, 8, 0),
        ("Global Finance - Main", "Global Finance Ltd", -33.8736, 151.2068, 25, 2), ("HealthCare Plus - Hospital", "HealthCare Plus", -33.8523, 151.2108, 35, 1),
        ("NovaTech - Lab", "NovaTech Research", -33.9173, 151.2313, 15, 0), ("Pacific Schools - Admin", "Pacific Schools District", -33.8451, 151.0652, 20, 1),
        ("Atlas Logistics - Warehouse", "Atlas Logistics", -33.9361, 151.1691, 12, 0), ("Apex Hotel - CBD", "Apex Hospitality", -33.8651, 151.2089, 10, 1),
        ("Summit Legal - Office", "Summit Legal", -33.8692, 151.2052, 8, 0), ("HealthCare Plus - Clinic", "HealthCare Plus", -33.8812, 151.2341, 6, 1),
    ]
    sites = []
    for name, client, lat, lng, devices, alerts in site_data:
        s = {"id": f"gs-{uuid.uuid4().hex[:8]}", "name": name, "client_name": client, "lat": lat, "lng": lng, "device_count": devices, "active_alerts": alerts, "status": "critical" if alerts > 1 else "warning" if alerts == 1 else "healthy"}
        sites.append(s)
        await db.geo_sites.insert_one(s)
    return [{k: v for k, v in s.items() if k != "_id"} for s in sites]

async def _seed_techs():
    tech_data = [
        ("Alex Thompson", "on_site", -33.8523, 151.2108, "HealthCare Plus - Hospital"),
        ("Sarah Chen", "available", -33.8688, 151.2093, "Office"),
        ("Mike Rodriguez", "en_route", -33.8900, 151.2000, "Atlas Logistics"),
        ("Jake Wilson", "on_site", -33.8736, 151.2068, "Global Finance - Main"),
        ("Lisa Park", "available", -33.8680, 151.2080, "Office"),
    ]
    techs = []
    for name, status, lat, lng, location in tech_data:
        t = {"id": f"gt-{uuid.uuid4().hex[:8]}", "name": name, "status": status, "lat": lat, "lng": lng, "current_location": location, "active_tickets": random.randint(0, 4), "eta_minutes": random.randint(10, 45) if status == "en_route" else None}
        techs.append(t)
        await db.geo_technicians.insert_one(t)
    return [{k: v for k, v in t.items() if k != "_id"} for t in techs]
