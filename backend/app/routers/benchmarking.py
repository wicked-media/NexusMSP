from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user

router = APIRouter()

# Industry benchmarks (simulated averages)
INDUSTRY_BENCHMARKS = {
    "avg_resolution_hours": {"critical": 3.2, "high": 6.5, "medium": 14.0, "low": 36.0},
    "avg_first_response_min": {"critical": 8, "high": 20, "medium": 45, "low": 120},
    "avg_tickets_per_tech_day": 6.5,
    "avg_client_satisfaction": 72,
    "avg_sla_compliance": 88,
    "avg_reopen_rate": 5.2,
}


@router.get("/benchmarking/overview")
async def get_benchmarking(current_user: dict = Depends(get_current_user)):
    """Get resolution time benchmarking against industry averages."""
    # Calculate your MSP's actual metrics
    total_resolved = await db.tickets.count_documents({"status": {"$in": ["resolved", "closed"]}})
    total_tickets = await db.tickets.count_documents({})

    # Resolution times by priority
    your_metrics = {}
    for priority in ["critical", "high", "medium", "low"]:
        tickets = await db.tickets.find(
            {"priority": priority, "status": {"$in": ["resolved", "closed"]}, "resolved_at": {"$exists": True}},
            {"_id": 0, "created_at": 1, "resolved_at": 1}
        ).to_list(200)

        if tickets:
            durations = []
            for t in tickets:
                try:
                    ct = datetime.fromisoformat(t["created_at"].replace("Z", "+00:00"))
                    rt = datetime.fromisoformat(t["resolved_at"].replace("Z", "+00:00"))
                    durations.append((rt - ct).total_seconds() / 3600)
                except Exception:
                    pass

            avg_hours = sum(durations) / len(durations) if durations else 0
            industry = INDUSTRY_BENCHMARKS["avg_resolution_hours"].get(priority, 10)
            diff_pct = round(((industry - avg_hours) / industry) * 100, 1) if industry > 0 else 0

            your_metrics[priority] = {
                "your_avg_hours": round(avg_hours, 1),
                "industry_avg_hours": industry,
                "difference_pct": diff_pct,
                "better_than_avg": avg_hours < industry,
                "sample_size": len(durations),
            }
        else:
            industry = INDUSTRY_BENCHMARKS["avg_resolution_hours"].get(priority, 10)
            your_metrics[priority] = {
                "your_avg_hours": 0, "industry_avg_hours": industry,
                "difference_pct": 0, "better_than_avg": True, "sample_size": 0,
            }

    # Tech performance
    techs = await db.users.find({"role": {"$in": ["technician", "admin"]}}, {"_id": 0, "id": 1, "name": 1}).to_list(20)
    tech_metrics = []
    for t in techs:
        resolved = await db.tickets.count_documents({"assigned_to": t["id"], "status": {"$in": ["resolved", "closed"]}})
        active = await db.tickets.count_documents({"assigned_to": t["id"], "status": {"$in": ["open", "in_progress"]}})
        tech_metrics.append({
            "id": t["id"], "name": t["name"],
            "resolved": resolved, "active": active,
            "vs_avg": round(((resolved / max(1, 30)) - INDUSTRY_BENCHMARKS["avg_tickets_per_tech_day"]) / INDUSTRY_BENCHMARKS["avg_tickets_per_tech_day"] * 100, 1),
        })

    # SLA compliance
    sla_met = await db.tickets.count_documents({"sla_met": True})
    sla_total = await db.tickets.count_documents({"sla_met": {"$exists": True}})
    sla_compliance = round((sla_met / max(sla_total, 1)) * 100, 1)

    return {
        "resolution_times": your_metrics,
        "tech_performance": sorted(tech_metrics, key=lambda x: x["resolved"], reverse=True),
        "overall": {
            "total_resolved": total_resolved,
            "total_tickets": total_tickets,
            "sla_compliance": sla_compliance,
            "industry_sla": INDUSTRY_BENCHMARKS["avg_sla_compliance"],
            "sla_vs_industry": round(sla_compliance - INDUSTRY_BENCHMARKS["avg_sla_compliance"], 1),
        },
        "industry_benchmarks": INDUSTRY_BENCHMARKS,
    }
