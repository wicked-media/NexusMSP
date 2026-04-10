from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random; random = random.SystemRandom()
import uuid, asyncio, json

router = APIRouter()

# ─── Real-time SOC Feed (WebSocket + REST fallback) ───

# In-memory store for connected clients
connected_clients = []

@router.get("/soc-realtime/events")
async def get_recent_events(current_user: dict = Depends(get_current_user)):
    """REST fallback for real-time SOC events"""
    events = await db.soc_realtime_events.find({}, {"_id": 0}).sort("timestamp", -1).to_list(50)
    if not events:
        events = await _seed_events()
    stats = {
        "total_events_24h": len(events),
        "critical": len([e for e in events if e.get("severity") == "critical"]),
        "high": len([e for e in events if e.get("severity") == "high"]),
        "medium": len([e for e in events if e.get("severity") == "medium"]),
        "blocked": len([e for e in events if e.get("action") == "blocked"]),
        "investigating": len([e for e in events if e.get("status") == "investigating"]),
    }
    return {"events": events, "stats": stats, "feed_type": "polling"}


@router.post("/soc-realtime/generate")
async def generate_event(current_user: dict = Depends(get_current_user)):
    """Simulate a new SOC event for demo purposes"""
    event = _create_random_event()
    await db.soc_realtime_events.insert_one({**event})
    return {"status": "generated", "event": event}


@router.get("/soc-realtime/threat-map")
async def threat_map(current_user: dict = Depends(get_current_user)):
    """Geographic threat visualization data"""
    sources = [
        {"country": "Russia", "code": "RU", "attacks": random.randint(15, 45), "lat": 55.75, "lng": 37.62},
        {"country": "China", "code": "CN", "attacks": random.randint(20, 50), "lat": 39.9, "lng": 116.4},
        {"country": "North Korea", "code": "KP", "attacks": random.randint(5, 15), "lat": 39.0, "lng": 125.8},
        {"country": "Iran", "code": "IR", "attacks": random.randint(8, 20), "lat": 35.7, "lng": 51.4},
        {"country": "Brazil", "code": "BR", "attacks": random.randint(3, 12), "lat": -15.8, "lng": -47.9},
        {"country": "Nigeria", "code": "NG", "attacks": random.randint(2, 8), "lat": 9.1, "lng": 7.5},
        {"country": "United States", "code": "US", "attacks": random.randint(10, 30), "lat": 38.9, "lng": -77.0},
    ]
    return {
        "attack_sources": sources,
        "total_blocked_today": sum(s["attacks"] for s in sources),
        "top_attack_type": random.choice(["Brute Force", "Phishing", "Port Scan", "SQL Injection", "DDoS"]),
    }


def _create_random_event():
    types = [
        ("Brute Force Login Attempt", "authentication", "blocked"),
        ("Malware Detected", "endpoint", "quarantined"),
        ("Suspicious PowerShell Execution", "endpoint", "investigating"),
        ("Phishing Email Intercepted", "email", "blocked"),
        ("Unauthorized Access Attempt", "network", "blocked"),
        ("Data Exfiltration Detected", "network", "investigating"),
        ("Ransomware Signature Match", "endpoint", "quarantined"),
        ("Port Scan Detected", "network", "blocked"),
        ("MFA Bypass Attempt", "authentication", "blocked"),
        ("Lateral Movement Detected", "network", "investigating"),
        ("Credential Stuffing Attack", "authentication", "blocked"),
        ("C2 Beacon Communication", "endpoint", "quarantined"),
    ]
    t = random.choice(types)
    devices = ["WS-PC-045", "SRV-DC-01", "FW-EDGE-01", "RETA-SRV-01", "TECH-PRN-01", "GLOB-SW-01"]
    clients = ["TechStart Inc", "RetailMax", "Global Finance Ltd", "Summit Hotels", "Cascade Media"]
    return {
        "event_id": str(uuid.uuid4())[:8],
        "title": t[0],
        "category": t[1],
        "action": t[2],
        "severity": random.choice(["critical", "high", "medium"]),
        "status": t[2],
        "device": random.choice(devices),
        "client": random.choice(clients),
        "source_ip": f"{random.randint(1,223)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}",
        "geo": random.choice(["Moscow, RU", "Beijing, CN", "Pyongyang, KP", "Tehran, IR", "Lagos, NG"]),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "details": f"Detected by {random.choice(['Sentinel', 'Defender', 'NexusOps Agent', 'Firewall'])} at {datetime.now(timezone.utc).strftime('%H:%M:%S')}",
    }


async def _seed_events():
    events = []
    for i in range(30):
        event = _create_random_event()
        event["timestamp"] = (datetime.now(timezone.utc) - timedelta(minutes=random.randint(1, 1440))).isoformat()
        events.append(event)
    await db.soc_realtime_events.insert_many(events)
    for e in events:
        e.pop("_id", None)
    return events
