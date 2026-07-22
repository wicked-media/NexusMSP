"""Evidence-backed device condition assessment.

This router deliberately does not estimate failure dates from a single device
snapshot.  It turns fresh, agent-reported telemetry into transparent threshold
conditions and leaves forecasting, confidence and prevention metrics empty
until a provider supplies the historical model data needed to support them.
"""

from datetime import datetime, timedelta, timezone
from typing import Any
import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.database import db


router = APIRouter()

# A record must identify an agent/provider source before it can contribute to
# a health score or an operational alert.  This keeps pre-migration demo rows,
# manually-created asset records and stale unproven rows out of the console.
TRUSTED_TELEMETRY_SOURCES = {"nexus-agent", "rmm-agent", "agent", "api-agent", "provider"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _number(value: Any, *, minimum: float = 0, maximum: float = 100) -> float | None:
    """Return a bounded observed number, never an implicit zero."""
    if isinstance(value, bool) or value is None:
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if numeric < minimum or numeric > maximum:
        return None
    return round(numeric, 2)


def _first_number(record: dict, keys: tuple[str, ...], *, maximum: float = 100) -> float | None:
    for key in keys:
        value = _number(record.get(key), maximum=maximum)
        if value is not None:
            return value
    return None


def _telemetry_source(device: dict) -> str | None:
    source = str(device.get("telemetry_source") or device.get("source") or "").strip().lower()
    if source in TRUSTED_TELEMETRY_SOURCES:
        return source
    # The Nexus Agent mirrors its enrollment ID even if an older device row
    # pre-dates the explicit source field.
    if device.get("nexus_agent_id"):
        return "nexus-agent"
    # The generic authenticated heartbeat endpoint may not add a source label,
    # but a recorded heartbeat is still a traceable agent observation.
    if device.get("last_heartbeat"):
        return "api-agent"
    return None


def _observed_telemetry(device: dict, recent_ticket_count: int | None = None) -> dict:
    """Normalise only telemetry that is explicitly present on a trusted row."""
    source = _telemetry_source(device)
    telemetry: dict[str, Any] = {}
    missing: list[str] = []

    if not source:
        return {
            "source": None,
            "observed_at": None,
            "telemetry": telemetry,
            "missing_signals": ["agent-backed telemetry source"],
            "evidence_state": "not_assessed",
        }

    metric_specs = {
        "cpu_usage": (("cpu_usage", "cpu_load"), "CPU usage"),
        "memory_usage": (("memory_usage", "memory_pct", "ram_usage"), "memory usage"),
        "disk_usage": (("disk_usage", "disk_pct"), "disk usage"),
        "temperature": (("cpu_temp", "temperature"), "temperature"),
    }
    for output_key, (keys, label) in metric_specs.items():
        value = _first_number(device, keys)
        if value is None:
            missing.append(label)
        else:
            telemetry[output_key] = value

    uptime_days = _first_number(device, ("uptime_days",), maximum=36500)
    if uptime_days is None:
        uptime_seconds = _first_number(device, ("uptime_sec", "uptime_seconds"), maximum=3_153_600_000)
        uptime_hours = _first_number(device, ("uptime_hours",), maximum=876000)
        if uptime_seconds is not None:
            uptime_days = round(uptime_seconds / 86400, 2)
        elif uptime_hours is not None:
            uptime_days = round(uptime_hours / 24, 2)
    if uptime_days is None:
        missing.append("uptime")
    else:
        telemetry["uptime_days"] = uptime_days

    if recent_ticket_count is not None:
        telemetry["recent_ticket_count"] = recent_ticket_count

    observed_metrics = [key for key in ("cpu_usage", "memory_usage", "disk_usage", "temperature") if key in telemetry]
    return {
        "source": source,
        "observed_at": device.get("last_heartbeat") or device.get("last_seen") or device.get("updated_at"),
        "telemetry": telemetry,
        "missing_signals": missing,
        "evidence_state": "assessed" if observed_metrics else "not_assessed",
    }


def _ticket_is_recent(ticket: dict, *, days: int = 30) -> bool:
    value = ticket.get("created_at") or ticket.get("opened_at")
    if not value:
        return False
    try:
        if isinstance(value, datetime):
            timestamp = value
        else:
            timestamp = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=timezone.utc)
        return timestamp >= datetime.now(timezone.utc) - timedelta(days=days)
    except (TypeError, ValueError):
        return False


def _assessment_from_observation(device: dict, observation: dict) -> dict:
    """Create a deterministic condition assessment from observed signals."""
    telemetry = observation["telemetry"]
    if observation["evidence_state"] != "assessed":
        return {
            "device_id": device.get("id", ""),
            "device_name": device.get("hostname") or device.get("name") or "Unnamed device",
            "client_name": device.get("client_name", ""),
            "health_score": None,
            "status": "not_assessed",
            "telemetry": telemetry,
            "predictions": [],
            "assessment_kind": "agent_threshold_assessment",
            "evidence_state": "not_assessed",
            "missing_signals": observation["missing_signals"],
            "message": "No agent-backed CPU, memory, disk, or temperature telemetry is available for this device.",
        }

    score = 100
    conditions: list[dict] = []

    def add_condition(condition_type: str, component: str, description: str, severity: str, recommendation: str, deduction: int) -> None:
        nonlocal score
        score -= deduction
        conditions.append({
            "type": condition_type,
            "component": component,
            "description": description,
            "severity": severity,
            "recommendation": recommendation,
            "condition_kind": "observed_threshold",
            "detected_at": observation["observed_at"] or _now(),
            "evidence_source": observation["source"],
        })

    disk = telemetry.get("disk_usage")
    if disk is not None:
        if disk > 90:
            add_condition("disk_capacity", "Storage", f"Observed disk usage is {disk:g}%.", "critical", "Free capacity or expand storage, then verify the next agent check-in.", 35)
        elif disk > 80:
            add_condition("disk_capacity", "Storage", f"Observed disk usage is {disk:g}%.", "high", "Review storage growth and schedule capacity remediation.", 20)

    cpu = telemetry.get("cpu_usage")
    if cpu is not None:
        if cpu > 90:
            add_condition("cpu_pressure", "CPU", f"Observed CPU usage is {cpu:g}%.", "high", "Inspect the active process load and confirm whether the next check-in remains elevated.", 25)
        elif cpu > 80:
            add_condition("cpu_pressure", "CPU", f"Observed CPU usage is {cpu:g}%.", "medium", "Review process load and corroborate the condition with a second check-in.", 12)

    memory = telemetry.get("memory_usage")
    if memory is not None:
        if memory > 90:
            add_condition("memory_pressure", "Memory", f"Observed memory usage is {memory:g}%.", "high", "Inspect memory-consuming processes and confirm the condition at the next check-in.", 20)
        elif memory > 85:
            add_condition("memory_pressure", "Memory", f"Observed memory usage is {memory:g}%.", "medium", "Review the active workload before planning a memory change.", 12)

    temperature = telemetry.get("temperature")
    if temperature is not None:
        if temperature > 75:
            add_condition("thermal", "CPU / chassis", f"Observed temperature is {temperature:g}°C.", "high", "Check cooling, airflow, and sensor validity before making a hardware decision.", 15)
        elif temperature > 65:
            add_condition("thermal", "CPU / chassis", f"Observed temperature is {temperature:g}°C.", "medium", "Review cooling and corroborate the next reported temperature.", 8)

    tickets = telemetry.get("recent_ticket_count")
    if isinstance(tickets, int) and tickets > 3:
        add_condition("recurring_incidents", "Service history", f"{tickets} linked tickets were created in the last 30 days.", "medium", "Review the linked ticket history for a common root cause.", min(20, tickets * 3))

    score = max(0, min(100, score))
    status = "healthy" if score >= 70 else "warning" if score >= 40 else "critical"
    return {
        "device_id": device.get("id", ""),
        "device_name": device.get("hostname") or device.get("name") or "Unnamed device",
        "client_name": device.get("client_name", ""),
        "health_score": score,
        "status": status,
        "telemetry": telemetry,
        # Kept for API compatibility. These are observed conditions, not
        # forecasts or promises of a future failure date.
        "predictions": conditions,
        "assessment_kind": "agent_threshold_assessment",
        "evidence_state": "assessed",
        "evidence_source": observation["source"],
        "observed_at": observation["observed_at"],
        "missing_signals": observation["missing_signals"],
        "analyzed_at": _now(),
        "message": "Assessment uses the latest agent-reported thresholds. Failure-date forecasting requires validated historical provider data.",
    }


def _trusted_health(record: dict) -> bool:
    return record.get("evidence_state") == "assessed" and str(record.get("source") or record.get("evidence_source") or "").lower() in TRUSTED_TELEMETRY_SOURCES


def _trusted_alert(record: dict) -> bool:
    return str(record.get("source") or record.get("evidence_source") or "").lower() in TRUSTED_TELEMETRY_SOURCES and record.get("condition_kind") == "observed_threshold"


@router.get("/predictive/dashboard")
async def predictive_dashboard(current_user: dict = Depends(get_current_user)):
    """Return only agent/provider-backed device condition assessments."""
    health_rows = await db.device_health.find({}, {"_id": 0}).sort("health_score", 1).to_list(500)
    health_scores = [row for row in health_rows if _trusted_health(row)]
    alerts_rows = await db.predictive_alerts.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    alerts = [row for row in alerts_rows if _trusted_alert(row)]
    active_alerts = [row for row in alerts if row.get("status") == "active"]
    resolved_alerts = [row for row in alerts if row.get("status") == "resolved"]
    critical_devices = [row for row in health_scores if isinstance(row.get("health_score"), (int, float)) and row["health_score"] < 40]
    values = [row["health_score"] for row in health_scores if isinstance(row.get("health_score"), (int, float))]

    return {
        "active_alerts": len(active_alerts),
        "resolved_alerts": len(resolved_alerts),
        "critical_devices": len(critical_devices),
        "total_monitored": len(health_scores),
        "alerts": active_alerts[:20],
        "at_risk_devices": critical_devices[:10],
        "avg_health": round(sum(values) / len(values), 1) if values else None,
        "evidence_state": "assessed" if health_scores else "not_assessed",
        "message": "No agent-backed device assessments are available yet." if not health_scores else "Health scores are based on the latest agent-reported thresholds.",
    }


@router.get("/predictive/device/{device_id}")
async def get_device_prediction(device_id: str, current_user: dict = Depends(get_current_user)):
    device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    health = await db.device_health.find_one({"device_id": device_id}, {"_id": 0})
    if not _trusted_health(health or {}):
        health = _assessment_from_observation(device, _observed_telemetry(device))
    alert_rows = await db.predictive_alerts.find({"device_id": device_id, "status": "active"}, {"_id": 0}).to_list(50)
    history_rows = await db.device_health_history.find({"device_id": device_id}, {"_id": 0}).sort("timestamp", -1).to_list(30)
    return {
        "device": device,
        "health": health,
        "alerts": [row for row in alert_rows if _trusted_alert(row)],
        "health_history": [row for row in history_rows if _trusted_health(row)],
        "evidence_state": health.get("evidence_state", "not_assessed"),
    }


@router.post("/predictive/analyze/{device_id}")
async def analyze_device(device_id: str, current_user: dict = Depends(get_current_user)):
    """Assess real agent telemetry; never fabricate an analysis for an asset row."""
    device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    ticket_rows = await db.tickets.find({"device_id": device_id}, {"_id": 0, "created_at": 1, "opened_at": 1}).sort("created_at", -1).to_list(100)
    recent_ticket_count = sum(1 for ticket in ticket_rows if _ticket_is_recent(ticket))
    assessment = _assessment_from_observation(device, _observed_telemetry(device, recent_ticket_count))
    if assessment["evidence_state"] != "assessed":
        return assessment

    health_doc = {
        **assessment,
        "source": assessment["evidence_source"],
        "updated_by": current_user.get("id") or current_user.get("email") or "",
    }
    await db.device_health.update_one({"device_id": device_id}, {"$set": health_doc}, upsert=True)
    await db.device_health_history.insert_one({
        "device_id": device_id,
        "health_score": assessment["health_score"],
        "telemetry": assessment["telemetry"],
        "evidence_state": "assessed",
        "source": assessment["evidence_source"],
        "timestamp": assessment["analyzed_at"],
    })

    active_types = {condition["type"] for condition in assessment["predictions"] if condition["severity"] in {"critical", "high"}}
    for condition in assessment["predictions"]:
        if condition["type"] not in active_types:
            continue
        await db.predictive_alerts.update_one(
            {"device_id": device_id, "type": condition["type"], "status": "active", "source": assessment["evidence_source"]},
            {"$set": {
                "device_id": device_id,
                "device_name": assessment["device_name"], "client_name": assessment["client_name"],
                "type": condition["type"], "component": condition["component"],
                "description": condition["description"], "severity": condition["severity"],
                "recommendation": condition["recommendation"], "condition_kind": "observed_threshold",
                "evidence_source": assessment["evidence_source"], "source": assessment["evidence_source"],
                "status": "active", "created_at": _now(), "last_observed_at": assessment.get("observed_at"),
            }, "$setOnInsert": {"id": str(uuid.uuid4())}},
            upsert=True,
        )

    # A recovered observed condition should not remain active after a verified
    # re-assessment.  This only touches alerts created by this workflow.
    await db.predictive_alerts.update_many(
        {"device_id": device_id, "source": assessment["evidence_source"], "status": "active", "type": {"$nin": list(active_types)}},
        {"$set": {"status": "cleared", "cleared_at": _now(), "cleared_by": "agent reassessment"}},
    )
    return health_doc


@router.post("/predictive/analyze-all")
async def analyze_all_devices(current_user: dict = Depends(get_current_user)):
    devices = await db.devices.find({}, {"_id": 0, "id": 1, "hostname": 1}).to_list(500)
    results = []
    for device in devices[:100]:
        try:
            result = await analyze_device(device["id"], current_user)
            results.append({
                "device_id": device["id"], "name": device.get("hostname", ""),
                "status": result.get("status"), "evidence_state": result.get("evidence_state"),
                "score": result.get("health_score"),
            })
        except Exception:
            results.append({"device_id": device["id"], "name": device.get("hostname", ""), "status": "error", "evidence_state": "not_assessed"})
    assessed = [result for result in results if result.get("evidence_state") == "assessed"]
    return {
        "analyzed": len(assessed),
        "not_assessed": len(results) - len(assessed),
        "results": results,
        "message": "Only devices with agent-backed telemetry were assessed.",
    }


@router.put("/predictive/alert/{alert_id}/resolve")
async def resolve_alert(alert_id: str, current_user: dict = Depends(get_current_user)):
    existing = await db.predictive_alerts.find_one({"id": alert_id}, {"_id": 0})
    if not existing or not _trusted_alert(existing):
        raise HTTPException(status_code=404, detail="Agent-backed condition alert not found")
    await db.predictive_alerts.update_one({"id": alert_id}, {"$set": {
        "status": "resolved", "resolved_at": _now(),
        "resolved_by": current_user.get("name") or current_user.get("email") or current_user.get("id", ""),
    }})
    return {"message": "Alert resolved"}


# Predictive Failure -----------------------------------------------------------------

def _trusted_failure_prediction(record: dict) -> bool:
    source = str(record.get("source") or record.get("evidence_source") or "").lower()
    return source in TRUSTED_TELEMETRY_SOURCES and bool(record.get("prediction")) and bool(record.get("created_at"))


@router.get("/predictive-failure/overview")
async def predictive_failure_overview(current_user: dict = Depends(get_current_user)):
    """Return provider-backed forecasts only; legacy generated rows are ignored."""
    rows = await db.failure_predictions.find({}, {"_id": 0}).sort("predicted_failure_date", 1).to_list(500)
    predictions = [row for row in rows if _trusted_failure_prediction(row)]
    summary = {
        "total_predictions": len(predictions),
        "critical": sum(1 for row in predictions if row.get("risk_level") == "critical"),
        "high": sum(1 for row in predictions if row.get("risk_level") == "high"),
        "medium": sum(1 for row in predictions if row.get("risk_level") == "medium"),
        "prevented_this_month": None,
        "accuracy_pct": None,
        "evidence_state": "provider_backed" if predictions else "not_configured",
    }
    return {
        "predictions": predictions,
        "summary": summary,
        "message": "No provider-backed failure forecasts are configured. NexusMSP will show observed agent conditions in Device Monitoring until a validated predictive provider is connected." if not predictions else "Forecasts are supplied by the recorded provider source.",
    }


# Predictive Maintenance -------------------------------------------------------------

def _maintenance_assessment(device: dict) -> dict:
    observation = _observed_telemetry(device)
    assessment = _assessment_from_observation(device, observation)
    if assessment["evidence_state"] != "assessed":
        return {
            "risk_score": None, "risk_level": "not_assessed", "risk_factors": [],
            "recommendations": ["Enroll the endpoint with a reporting agent and wait for a telemetry check-in."],
            "predicted_failure_window": None, "predicted_failure_date": None, "confidence": None,
            "assessment_kind": "agent_threshold_assessment", "evidence_state": "not_assessed",
            "missing_signals": assessment["missing_signals"],
        }
    score = max(0, 100 - int(assessment["health_score"]))
    if score >= 60:
        level = "critical"
    elif score >= 30:
        level = "high"
    elif score > 0:
        level = "medium"
    else:
        level = "low"
    return {
        "risk_score": score,
        "risk_level": level,
        "risk_factors": [condition["description"] for condition in assessment["predictions"]],
        "recommendations": [condition["recommendation"] for condition in assessment["predictions"]] or ["No threshold conditions were observed in the latest agent check-in."],
        "predicted_failure_window": None,
        "predicted_failure_date": None,
        "confidence": None,
        "assessment_kind": "agent_threshold_assessment",
        "evidence_state": "assessed",
        "missing_signals": assessment["missing_signals"],
        "telemetry": assessment["telemetry"],
    }


@router.get("/predictive-maintenance/dashboard")
async def get_predictive_maintenance_dashboard(current_user: dict = Depends(get_current_user)):
    devices = await db.devices.find({}, {"_id": 0}).to_list(500)
    analyses = []
    counts = {"critical": 0, "high": 0, "medium": 0, "low": 0, "not_assessed": 0}
    for device in devices:
        analysis = _maintenance_assessment(device)
        counts[analysis["risk_level"]] += 1
        analyses.append({
            "device_id": device.get("id", ""), "device_name": device.get("name") or device.get("hostname") or "Unnamed device",
            "client_name": device.get("client_name", ""), "device_type": device.get("device_type", ""),
            "status": device.get("status", "unknown"), **analysis,
        })
    analyses.sort(key=lambda item: item["risk_score"] if item["risk_score"] is not None else -1, reverse=True)
    return {
        "total_devices": len(devices), "risk_summary": counts, "devices": analyses[:50],
        "generated_at": _now(), "message": "This view reports current agent threshold conditions, not estimated failure dates.",
    }


@router.get("/predictive-maintenance/device/{device_id}")
async def get_predictive_maintenance_device(device_id: str, current_user: dict = Depends(get_current_user)):
    device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    alert_rows = await db.alerts.find({"device_id": device_id}, {"_id": 0}).sort("created_at", -1).to_list(20)
    ticket_rows = await db.tickets.find({"device_id": device_id}, {"_id": 0}).sort("created_at", -1).to_list(10)
    return {
        "device": {
            "id": device["id"], "name": device.get("name") or device.get("hostname") or "",
            "client_name": device.get("client_name", ""), "device_type": device.get("device_type", ""),
            "os": device.get("os_name") or device.get("os", ""), "status": device.get("status", ""),
        },
        "prediction": _maintenance_assessment(device),
        "recent_alerts": len(alert_rows), "recent_tickets": len(ticket_rows), "maintenance_history": [],
    }
