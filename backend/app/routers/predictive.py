from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
import uuid, os, json
from app.database import db
from app.auth import get_current_user

router = APIRouter()

async def _get_ai_chat(session_id: str, system_msg: str):
    from emergentintegrations.llm.chat import LlmChat
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        return None
    cfg = await db.settings.find_one({"type": "ai_config"}, {"_id": 0})
    provider = (cfg or {}).get("provider", "anthropic")
    model = (cfg or {}).get("model", "claude-sonnet-4-5-20250929")
    chat = LlmChat(api_key=api_key, session_id=session_id, system_message=system_msg)
    chat.with_model(provider, model)
    return chat

# Health scoring weights
HEALTH_WEIGHTS = {
    "cpu_usage": 0.2, "memory_usage": 0.2, "disk_usage": 0.25,
    "uptime_days": 0.15, "ticket_frequency": 0.2,
}


@router.get("/predictive/dashboard")
async def predictive_dashboard(current_user: dict = Depends(get_current_user)):
    """Get predictive maintenance dashboard data."""
    alerts = await db.predictive_alerts.find({}, {"_id": 0}).sort("predicted_failure_date", 1).to_list(100)
    active_alerts = [a for a in alerts if a.get("status") == "active"]
    resolved_alerts = [a for a in alerts if a.get("status") == "resolved"]

    # Device health scores
    health_scores = await db.device_health.find({}, {"_id": 0}).sort("health_score", 1).to_list(200)
    critical_devices = [d for d in health_scores if d.get("health_score", 100) < 40]

    return {
        "active_alerts": len(active_alerts),
        "resolved_alerts": len(resolved_alerts),
        "critical_devices": len(critical_devices),
        "total_monitored": len(health_scores),
        "alerts": active_alerts[:20],
        "at_risk_devices": critical_devices[:10],
        "avg_health": round(sum(d.get("health_score", 100) for d in health_scores) / max(len(health_scores), 1), 1),
    }


@router.get("/predictive/device/{device_id}")
async def get_device_prediction(device_id: str, current_user: dict = Depends(get_current_user)):
    """Get predictive analysis for a specific device."""
    device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        return {"error": "Device not found"}

    health = await db.device_health.find_one({"device_id": device_id}, {"_id": 0})
    alerts = await db.predictive_alerts.find({"device_id": device_id, "status": "active"}, {"_id": 0}).to_list(10)
    history = await db.device_health_history.find({"device_id": device_id}, {"_id": 0}).sort("timestamp", -1).to_list(30)

    return {
        "device": device,
        "health": health or {"health_score": 100, "status": "healthy"},
        "alerts": alerts,
        "health_history": history,
    }


@router.post("/predictive/analyze/{device_id}")
async def analyze_device(device_id: str, current_user: dict = Depends(get_current_user)):
    """AI-powered predictive analysis for a device."""
    device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        return {"error": "Device not found"}

    # Get recent tickets for this device
    tickets = await db.tickets.find(
        {"device_id": device_id}, {"_id": 0, "title": 1, "priority": 1, "created_at": 1, "status": 1}
    ).sort("created_at", -1).to_list(10)

    # Simulate telemetry (in real RMM, this comes from agents)
    import random
    telemetry = {
        "cpu_usage": device.get("cpu_usage", random.randint(20, 90)),
        "memory_usage": device.get("memory_usage", random.randint(30, 85)),
        "disk_usage": device.get("disk_usage", random.randint(40, 95)),
        "uptime_days": device.get("uptime_days", random.randint(1, 365)),
        "temperature": device.get("temperature", random.randint(35, 80)),
        "recent_ticket_count": len(tickets),
    }

    # Calculate health score
    score = 100
    if telemetry["cpu_usage"] > 80:
        score -= 15
    if telemetry["cpu_usage"] > 90:
        score -= 10
    if telemetry["memory_usage"] > 85:
        score -= 15
    if telemetry["disk_usage"] > 80:
        score -= 20
    if telemetry["disk_usage"] > 90:
        score -= 15
    if telemetry["temperature"] > 70:
        score -= 10
    if telemetry["recent_ticket_count"] > 3:
        score -= telemetry["recent_ticket_count"] * 5
    score = max(0, min(100, score))

    status = "healthy" if score >= 70 else "warning" if score >= 40 else "critical"

    # Generate predictions
    predictions = []
    if telemetry["disk_usage"] > 80:
        days_to_full = max(1, int((100 - telemetry["disk_usage"]) / 0.5))
        predictions.append({
            "type": "disk_failure", "component": "Storage",
            "description": f"Disk at {telemetry['disk_usage']}% - predicted full in ~{days_to_full} days",
            "predicted_date": (datetime.now(timezone.utc) + timedelta(days=days_to_full)).isoformat(),
            "severity": "critical" if telemetry["disk_usage"] > 90 else "high",
            "recommendation": "Clean up disk space or replace drive",
        })
    if telemetry["temperature"] > 65:
        predictions.append({
            "type": "thermal", "component": "CPU/System",
            "description": f"Temperature at {telemetry['temperature']}C - risk of thermal throttling",
            "severity": "high" if telemetry["temperature"] > 75 else "medium",
            "recommendation": "Check cooling system, clean dust, improve airflow",
        })
    if telemetry["memory_usage"] > 85:
        predictions.append({
            "type": "memory", "component": "RAM",
            "description": f"Memory consistently at {telemetry['memory_usage']}% - performance degradation likely",
            "severity": "medium",
            "recommendation": "Identify memory-heavy processes or upgrade RAM",
        })
    if telemetry["recent_ticket_count"] > 3:
        predictions.append({
            "type": "recurring_issues", "component": "System",
            "description": f"{telemetry['recent_ticket_count']} tickets in recent period - indicates systemic issue",
            "severity": "high",
            "recommendation": "Root cause analysis needed - possible hardware failure",
        })

    # Store health data
    health_doc = {
        "device_id": device_id,
        "device_name": device.get("hostname", device.get("name", "")),
        "client_name": device.get("client_name", ""),
        "health_score": score,
        "status": status,
        "telemetry": telemetry,
        "predictions": predictions,
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.device_health.update_one({"device_id": device_id}, {"$set": health_doc}, upsert=True)

    # Store history point
    await db.device_health_history.insert_one({
        "_id": None, "device_id": device_id,
        "health_score": score, "telemetry": telemetry,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    await db.device_health_history.update_many({"_id": None}, {"$unset": {"_id": ""}})

    # Create alerts for critical predictions
    for pred in predictions:
        if pred["severity"] in ["critical", "high"]:
            alert_id = str(uuid.uuid4())[:8]
            await db.predictive_alerts.update_one(
                {"device_id": device_id, "type": pred["type"], "status": "active"},
                {"$set": {
                    "id": alert_id, "device_id": device_id,
                    "device_name": device.get("hostname", ""),
                    "client_name": device.get("client_name", ""),
                    "type": pred["type"], "component": pred["component"],
                    "description": pred["description"], "severity": pred["severity"],
                    "recommendation": pred["recommendation"],
                    "predicted_failure_date": pred.get("predicted_date", ""),
                    "status": "active",
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }},
                upsert=True,
            )

    return health_doc


@router.post("/predictive/analyze-all")
async def analyze_all_devices(current_user: dict = Depends(get_current_user)):
    """Analyze all devices for predictive maintenance."""
    devices = await db.devices.find({}, {"_id": 0, "id": 1, "hostname": 1}).to_list(100)
    results = []
    for d in devices[:30]:  # Limit to avoid timeout
        try:
            r = await analyze_device(d["id"], current_user)
            results.append({"device_id": d["id"], "name": d.get("hostname", ""), "score": r.get("health_score", 100)})
        except Exception:
            results.append({"device_id": d["id"], "error": True})
    return {"analyzed": len(results), "results": results}


@router.put("/predictive/alert/{alert_id}/resolve")
async def resolve_alert(alert_id: str, current_user: dict = Depends(get_current_user)):
    """Resolve a predictive maintenance alert."""
    await db.predictive_alerts.update_one({"id": alert_id}, {"$set": {
        "status": "resolved",
        "resolved_at": datetime.now(timezone.utc).isoformat(),
        "resolved_by": current_user.get("name", ""),
    }})
    return {"message": "Alert resolved"}
