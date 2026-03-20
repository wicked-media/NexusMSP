from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random

router = APIRouter()

@router.get("/bandwidth-monitor/overview")
async def get_bandwidth_overview(current_user: dict = Depends(get_current_user)):
    data = await db.bandwidth_data.find({}, {"_id": 0}).to_list(500)
    if not data:
        data = await _seed_bandwidth_data()
    sites = await db.network_sites.find({}, {"_id": 0}).to_list(50)
    return {"sites": sites, "bandwidth_data": data}

@router.get("/bandwidth-monitor/site/{site_id}")
async def get_site_bandwidth(site_id: str, current_user: dict = Depends(get_current_user)):
    data = await db.bandwidth_data.find({"site_id": site_id}, {"_id": 0}).sort("timestamp", -1).to_list(288)
    return data

@router.get("/bandwidth-monitor/alerts")
async def get_bandwidth_alerts(current_user: dict = Depends(get_current_user)):
    alerts = await db.bandwidth_alerts.find({}, {"_id": 0}).sort("detected_at", -1).to_list(100)
    if not alerts:
        now = datetime.now(timezone.utc)
        alerts = [
            {"id": "bwa-001", "site_id": "nsite-004", "site_name": "HealthCare Plus - Clinic", "client_name": "HealthCare Plus", "type": "high_utilization", "severity": "warning", "message": "Upload bandwidth at 92% capacity (32.2/35 Mbps)", "detected_at": (now - timedelta(hours=2)).isoformat(), "resolved": False},
            {"id": "bwa-002", "site_id": "nsite-002", "site_name": "TechStart - Cloud DC", "client_name": "TechStart Inc", "type": "spike", "severity": "info", "message": "Unusual traffic spike detected (2.3x normal at 14:00)", "detected_at": (now - timedelta(hours=6)).isoformat(), "resolved": True},
            {"id": "bwa-003", "site_id": "nsite-001", "site_name": "Acme Corp - Main Office", "client_name": "Acme Corporation", "type": "packet_loss", "severity": "warning", "message": "Packet loss detected: 3.2% over last 30 minutes", "detected_at": (now - timedelta(hours=1)).isoformat(), "resolved": False},
        ]
        for a in alerts:
            await db.bandwidth_alerts.insert_one(a)
        alerts = [dict((k, v) for k, v in a.items() if k != "_id") for a in alerts]
    return alerts

@router.get("/bandwidth-monitor/top-talkers/{site_id}")
async def get_top_talkers(site_id: str, current_user: dict = Depends(get_current_user)):
    clients = await db.network_clients.find({"site_id": site_id}, {"_id": 0}).to_list(50)
    sorted_clients = sorted(clients, key=lambda c: (c.get("rx_bytes", 0) + c.get("tx_bytes", 0)), reverse=True)
    return sorted_clients[:10]

async def _seed_bandwidth_data():
    now = datetime.now(timezone.utc)
    sites = [("nsite-001", 500, 100), ("nsite-002", 1000, 1000), ("nsite-003", 940, 880), ("nsite-004", 200, 35), ("nsite-005", 300, 50)]
    data = []
    for site_id, max_down, max_up in sites:
        for i in range(144):
            ts = (now - timedelta(minutes=i * 10)).isoformat()
            hour = (now - timedelta(minutes=i * 10)).hour
            multiplier = 0.8 if 9 <= hour <= 17 else 0.3
            down = round(random.uniform(0.1, multiplier) * max_down, 1)
            up = round(random.uniform(0.05, multiplier * 0.6) * max_up, 1)
            latency = round(random.uniform(1, 25), 1)
            jitter = round(random.uniform(0.1, 5), 2)
            packet_loss = round(random.uniform(0, 0.5), 3) if random.random() > 0.8 else 0
            entry = {"site_id": site_id, "timestamp": ts, "download_mbps": down, "upload_mbps": up, "latency_ms": latency, "jitter_ms": jitter, "packet_loss_pct": packet_loss}
            data.append(entry)
    for d in data:
        await db.bandwidth_data.insert_one(d)
    return [dict((k, v) for k, v in d.items() if k != "_id") for d in data]
