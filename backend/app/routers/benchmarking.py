"""Internal service-performance evidence without fabricated industry comparisons."""

from datetime import datetime

from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.database import db


router = APIRouter()
RESOLVED_STATUSES = ["resolved", "closed"]


def _duration_hours(ticket: dict):
    try:
        created = datetime.fromisoformat(str(ticket["created_at"]).replace("Z", "+00:00"))
        resolved = datetime.fromisoformat(str(ticket["resolved_at"]).replace("Z", "+00:00"))
        duration = (resolved - created).total_seconds() / 3600
        return duration if duration >= 0 else None
    except (KeyError, TypeError, ValueError):
        return None


@router.get("/benchmarking/overview")
async def get_benchmarking(current_user: dict = Depends(get_current_user)):
    """Return auditable internal ticket performance only.

    An external industry comparison is not shown until it is backed by a
    configured, attributable source rather than hard-coded assumed averages.
    """
    total_resolved = await db.tickets.count_documents({"status": {"$in": RESOLVED_STATUSES}})
    total_tickets = await db.tickets.count_documents({})
    resolution_times = {}

    for priority in ["critical", "high", "medium", "low"]:
        tickets = await db.tickets.find(
            {"priority": priority, "status": {"$in": RESOLVED_STATUSES}, "resolved_at": {"$exists": True}},
            {"_id": 0, "created_at": 1, "resolved_at": 1},
        ).to_list(1000)
        durations = [duration for ticket in tickets if (duration := _duration_hours(ticket)) is not None]
        resolution_times[priority] = {
            "average_hours": round(sum(durations) / len(durations), 1) if durations else None,
            "sample_size": len(durations),
        }

    tech_records = await db.users.find({"role": {"$in": ["technician", "admin"]}}, {"_id": 0, "id": 1, "name": 1}).to_list(200)
    # Legacy imports can contain repeated user rows. A technician represents one
    # workload subject, so calculate the benchmark once per stable user ID.
    techs_by_id = {}
    for technician in tech_records:
        technician_id = str(technician.get("id") or "").strip()
        if technician_id and technician_id not in techs_by_id:
            techs_by_id[technician_id] = technician
    techs = list(techs_by_id.values())
    tech_metrics = []
    for technician in techs:
        resolved = await db.tickets.count_documents({"assigned_to": technician["id"], "status": {"$in": RESOLVED_STATUSES}})
        active = await db.tickets.count_documents({"assigned_to": technician["id"], "status": {"$in": ["open", "in_progress", "pending"]}})
        tech_metrics.append({"id": technician["id"], "name": technician.get("name") or "Technician", "resolved": resolved, "active": active})
    team_average = round(sum(item["resolved"] for item in tech_metrics) / len(tech_metrics), 1) if tech_metrics else None
    for item in tech_metrics:
        item["vs_team_average"] = round(item["resolved"] - team_average, 1) if team_average is not None else None

    sla_met = await db.tickets.count_documents({"sla_met": True})
    sla_total = await db.tickets.count_documents({"sla_met": {"$exists": True}})
    return {
        "resolution_times": resolution_times,
        "tech_performance": sorted(tech_metrics, key=lambda item: item["resolved"], reverse=True),
        "overall": {
            "total_resolved": total_resolved,
            "total_tickets": total_tickets,
            "sla_compliance": round((sla_met / sla_total) * 100, 1) if sla_total else None,
            "sla_sample_size": sla_total,
            "team_average_resolved": team_average,
        },
        "comparison_source": None,
        "comparison_note": "External benchmarks are unavailable until an attributable source is configured.",
    }
