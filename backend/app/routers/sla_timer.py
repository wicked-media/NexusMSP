from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user

router = APIRouter()


@router.get("/sla-timer/active")
async def get_active_sla_timers(current_user: dict = Depends(get_current_user)):
    """Get all tickets with SLA countdown timers."""
    now = datetime.now(timezone.utc)
    tickets = await db.tickets.find(
        {"status": {"$in": ["open", "in_progress"]}},
        {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "status": 1, "priority": 1,
         "client_name": 1, "assigned_to_name": 1, "created_at": 1}
    ).sort("created_at", 1).to_list(200)

    sla_hours = {"critical": 2, "high": 4, "medium": 8, "low": 24}
    result = []
    breached = 0
    at_risk = 0

    for t in tickets:
        created = t.get("created_at", "")
        priority = t.get("priority", "medium")
        hours = sla_hours.get(priority, 8)

        try:
            ct = datetime.fromisoformat(created.replace("Z", "+00:00"))
            deadline = ct + timedelta(hours=hours)
            remaining = (deadline - now).total_seconds()
            pct_elapsed = min(100, max(0, ((now - ct).total_seconds() / (hours * 3600)) * 100))

            is_breached = remaining < 0
            is_at_risk = 0 < remaining < 1800  # Less than 30 min

            if is_breached:
                breached += 1
            if is_at_risk:
                at_risk += 1

            t["sla_deadline"] = deadline.isoformat()
            t["sla_remaining_seconds"] = max(0, int(remaining))
            t["sla_breached"] = is_breached
            t["sla_at_risk"] = is_at_risk
            t["sla_pct_elapsed"] = round(pct_elapsed)
            t["sla_hours"] = hours
        except Exception:
            t["sla_remaining_seconds"] = 0
            t["sla_breached"] = False
            t["sla_at_risk"] = False
            t["sla_pct_elapsed"] = 0

        result.append(t)

    # Sort: breached first, then by remaining time
    result.sort(key=lambda x: (not x.get("sla_breached"), x.get("sla_remaining_seconds", 99999)))

    return {
        "tickets": result,
        "stats": {
            "total_active": len(result),
            "breached": breached,
            "at_risk": at_risk,
            "on_track": len(result) - breached - at_risk,
        }
    }


@router.get("/sla-timer/predictions")
async def get_sla_predictions(current_user: dict = Depends(get_current_user)):
    """AI-predict which tickets are likely to breach SLA."""
    now = datetime.now(timezone.utc)
    tickets = await db.tickets.find(
        {"status": {"$in": ["open", "in_progress"]}},
        {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "priority": 1,
         "assigned_to_name": 1, "created_at": 1, "client_name": 1}
    ).to_list(100)

    sla_hours = {"critical": 2, "high": 4, "medium": 8, "low": 24}
    predictions = []

    for t in tickets:
        created = t.get("created_at", "")
        priority = t.get("priority", "medium")
        hours = sla_hours.get(priority, 8)

        try:
            ct = datetime.fromisoformat(created.replace("Z", "+00:00"))
            deadline = ct + timedelta(hours=hours)
            remaining = (deadline - now).total_seconds()
            pct_used = min(100, ((now - ct).total_seconds() / (hours * 3600)) * 100)

            # Predict breach probability based on time used and queue depth
            breach_prob = min(100, pct_used * 1.2)  # Simple model
            if t.get("assigned_to_name") in [None, "", "Unassigned"]:
                breach_prob = min(100, breach_prob + 20)

            if breach_prob > 50:
                predictions.append({
                    **t,
                    "breach_probability": round(breach_prob),
                    "remaining_seconds": max(0, int(remaining)),
                    "recommendation": "Escalate immediately" if breach_prob > 80 else "Assign technician" if not t.get("assigned_to_name") else "Monitor closely",
                })
        except Exception:
            pass

    predictions.sort(key=lambda x: x["breach_probability"], reverse=True)
    return predictions
