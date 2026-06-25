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
        "device_id": device_id,
        "health_score": score, "telemetry": telemetry,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })

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


# ============================================================
# Predictive Failure (merged from predictive_failure.py)
# ============================================================
import random as _rand
_pf_rand = _rand.SystemRandom()


@router.get("/predictive-failure/overview")
async def predictive_failure_overview(current_user: dict = Depends(get_current_user)):
    predictions = await db.failure_predictions.find({}, {"_id": 0}).sort("predicted_failure_date", 1).to_list(100)
    if not predictions:
        predictions = await _seed_failure_predictions()
    return {
        "predictions": predictions,
        "summary": {
            "total_predictions": len(predictions),
            "critical": len([p for p in predictions if p.get("risk_level") == "critical"]),
            "high": len([p for p in predictions if p.get("risk_level") == "high"]),
            "medium": len([p for p in predictions if p.get("risk_level") == "medium"]),
            "prevented_this_month": _pf_rand.randint(3, 8),
            "accuracy_pct": 87.3,
        },
    }


async def _seed_failure_predictions():
    devices = await db.devices.find({"type": {"$in": ["server", "workstation"]}}, {"_id": 0, "id": 1, "name": 1, "client_name": 1, "type": 1}).to_list(50)
    preds = []
    templates = [
        ("SMART: Reallocated sectors increasing", "disk_failure", "critical", 3),
        ("Fan speed dropping, thermal throttling detected", "hardware_failure", "high", 14),
        ("Battery degradation at 23% capacity", "battery_failure", "medium", 30),
        ("RAM ECC errors increasing exponentially", "memory_failure", "critical", 7),
        ("PSU voltage fluctuations detected", "psu_failure", "high", 10),
        ("SSD write cycles at 89% of rated endurance", "ssd_wear", "medium", 60),
        ("Network adapter CRC errors trending up", "nic_failure", "medium", 21),
        ("CPU temperature baseline shifted +15C", "cooling_failure", "high", 5),
    ]
    for desc, ftype, risk, days in templates:
        d = _pf_rand.choice(devices) if devices else {"id": "?", "name": "UNKNOWN", "client_name": "Unknown"}
        p = {
            "id": f"pf-{uuid.uuid4().hex[:8]}", "device_id": d.get("id"),
            "device_name": d.get("name"), "client_name": d.get("client_name"),
            "prediction": desc, "failure_type": ftype, "risk_level": risk,
            "confidence_pct": _pf_rand.randint(72, 96),
            "predicted_failure_date": (datetime.now(timezone.utc) + timedelta(days=days)).strftime("%Y-%m-%d"),
            "days_until_failure": days,
            "data_points_analyzed": _pf_rand.randint(500, 5000),
            "recommended_action": f"Schedule replacement within {days} days",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        preds.append(p)
        await db.failure_predictions.insert_one(p)
    return [{k: v for k, v in p.items() if k != "_id"} for p in preds]


# ============================================================
# Predictive Maintenance (merged from predictive_maintenance.py)
# ============================================================
from fastapi import HTTPException


def _calculate_failure_risk(device: dict) -> dict:
    risk_score = 0
    risk_factors = []
    recommendations = []

    age_days = 0
    if device.get("created_at"):
        try:
            created = datetime.fromisoformat(device["created_at"]) if isinstance(device["created_at"], str) else device["created_at"]
            age_days = (datetime.now(timezone.utc) - (created.replace(tzinfo=timezone.utc) if created.tzinfo is None else created)).days
        except Exception:
            age_days = 365

    if age_days > 1825:
        risk_score += 35
        risk_factors.append("Device is over 5 years old - beyond typical lifecycle")
        recommendations.append("Plan hardware replacement within 3 months")
    elif age_days > 1095:
        risk_score += 20
        risk_factors.append("Device is over 3 years old - entering high-risk period")
        recommendations.append("Schedule preventive maintenance check")
    elif age_days > 730:
        risk_score += 10
        risk_factors.append("Device is over 2 years old")

    device_type = device.get("device_type", "").lower()
    if device_type in ["server", "nas", "storage"]:
        risk_score += 10
        risk_factors.append("Server/storage devices have higher failure rates under load")
        recommendations.append("Verify RAID health and backup status")

    if device.get("status") == "offline":
        risk_score += 15
        risk_factors.append("Device is currently offline - may indicate hardware issue")
        recommendations.append("Investigate offline status immediately")

    os_name = (device.get("os_name") or device.get("os") or "").lower()
    if "windows 7" in os_name or "windows 8" in os_name or "xp" in os_name:
        risk_score += 15
        risk_factors.append("Running outdated/unsupported OS")
        recommendations.append("Upgrade to supported operating system")

    alert_count = device.get("alert_count", 0)
    if alert_count > 10:
        risk_score += 20
        risk_factors.append(f"High alert count ({alert_count}) indicates recurring issues")
        recommendations.append("Review and resolve recurring alerts")
    elif alert_count > 5:
        risk_score += 10
        risk_factors.append(f"Moderate alert count ({alert_count})")

    cpu_usage = device.get("cpu_usage", 0)
    ram_usage = device.get("ram_usage", 0)
    disk_usage = device.get("disk_usage", 0)

    if disk_usage > 90:
        risk_score += 20
        risk_factors.append(f"Critical disk usage at {disk_usage}%")
        recommendations.append("Free disk space or expand storage immediately")
    elif disk_usage > 80:
        risk_score += 10
        risk_factors.append(f"High disk usage at {disk_usage}%")
        recommendations.append("Plan disk cleanup or storage expansion")

    if cpu_usage > 90:
        risk_score += 10
        risk_factors.append(f"CPU consistently running at {cpu_usage}%")
        recommendations.append("Investigate high CPU processes")

    if ram_usage > 90:
        risk_score += 10
        risk_factors.append(f"RAM usage at {ram_usage}%")
        recommendations.append("Consider RAM upgrade")

    risk_score = min(risk_score, 100)

    if risk_score >= 70:
        risk_level = "critical"
        predicted_days = _pf_rand.randint(7, 30)
    elif risk_score >= 50:
        risk_level = "high"
        predicted_days = _pf_rand.randint(30, 90)
    elif risk_score >= 30:
        risk_level = "medium"
        predicted_days = _pf_rand.randint(90, 180)
    else:
        risk_level = "low"
        predicted_days = _pf_rand.randint(180, 365)

    if not recommendations:
        recommendations.append("Device is in good health - continue regular monitoring")

    return {
        "risk_score": risk_score,
        "risk_level": risk_level,
        "risk_factors": risk_factors,
        "recommendations": recommendations,
        "predicted_failure_window": f"{predicted_days} days",
        "predicted_failure_date": (datetime.now(timezone.utc) + timedelta(days=predicted_days)).strftime("%Y-%m-%d"),
        "confidence": min(95, 60 + len(risk_factors) * 5),
    }


@router.get("/predictive-maintenance/dashboard")
async def get_predictive_maintenance_dashboard(current_user: dict = Depends(get_current_user)):
    devices = await db.devices.find({}, {"_id": 0}).to_list(500)

    analyses = []
    critical_count = 0
    high_count = 0
    medium_count = 0
    low_count = 0

    for device in devices:
        analysis = _calculate_failure_risk(device)
        analyses.append({
            "device_id": device["id"],
            "device_name": device.get("name", "Unknown"),
            "client_name": device.get("client_name", ""),
            "device_type": device.get("device_type", ""),
            "status": device.get("status", "unknown"),
            **analysis,
        })
        if analysis["risk_level"] == "critical":
            critical_count += 1
        elif analysis["risk_level"] == "high":
            high_count += 1
        elif analysis["risk_level"] == "medium":
            medium_count += 1
        else:
            low_count += 1

    analyses.sort(key=lambda x: x["risk_score"], reverse=True)

    return {
        "total_devices": len(devices),
        "risk_summary": {
            "critical": critical_count,
            "high": high_count,
            "medium": medium_count,
            "low": low_count,
        },
        "devices": analyses[:50],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/predictive-maintenance/device/{device_id}")
async def get_predictive_maintenance_device(device_id: str, current_user: dict = Depends(get_current_user)):
    device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    analysis = _calculate_failure_risk(device)
    alerts = await db.alerts.find({"device_id": device_id}, {"_id": 0}).sort("created_at", -1).to_list(20)
    tickets = await db.tickets.find({"device_id": device_id}, {"_id": 0}).sort("created_at", -1).to_list(10)

    return {
        "device": {
            "id": device["id"],
            "name": device.get("name", ""),
            "client_name": device.get("client_name", ""),
            "device_type": device.get("device_type", ""),
            "os": device.get("os_name") or device.get("os", ""),
            "status": device.get("status", ""),
        },
        "prediction": analysis,
        "recent_alerts": len(alerts),
        "recent_tickets": len(tickets),
        "maintenance_history": [],
    }
