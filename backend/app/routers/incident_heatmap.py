from fastapi import APIRouter, Depends
from app.database import db
from app.auth import get_current_user
from datetime import datetime, timezone, timedelta

router = APIRouter(prefix="/incident-heatmap", tags=["Incident Heatmap"])

@router.get("/data")
async def get_heatmap_data(user=Depends(get_current_user)):
    tickets = await db.tickets.find({}, {"_id": 0, "created_at": 1, "category": 1, "priority": 1, "client_name": 1, "client_id": 1}).to_list(1000)
    
    # Heatmap by hour of day (0-23) x day of week (0-6)
    hour_day_grid = [[0] * 24 for _ in range(7)]
    by_category = {}
    by_client = {}
    by_priority = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    
    for t in tickets:
        try:
            created = t.get("created_at", "")
            if isinstance(created, str):
                dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
            else:
                dt = created
            hour_day_grid[dt.weekday()][dt.hour] += 1
            
            cat = t.get("category", "other")
            by_category[cat] = by_category.get(cat, 0) + 1
            
            cn = t.get("client_name", "Unknown")
            by_client[cn] = by_client.get(cn, 0) + 1
            
            pri = t.get("priority", "low")
            if pri in by_priority:
                by_priority[pri] += 1
        except (ValueError, TypeError, AttributeError):
            pass
    
    # Flatten for frontend
    heatmap_cells = []
    days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    for day_idx, day_name in enumerate(days):
        for hour in range(24):
            heatmap_cells.append({
                "day": day_name, "day_idx": day_idx,
                "hour": hour, "count": hour_day_grid[day_idx][hour],
            })
    
    peak_hour = max(range(24), key=lambda h: sum(hour_day_grid[d][h] for d in range(7)))
    peak_day = max(range(7), key=lambda d: sum(hour_day_grid[d]))
    
    return {
        "heatmap": heatmap_cells,
        "by_category": [{"category": k, "count": v} for k, v in sorted(by_category.items(), key=lambda x: -x[1])],
        "by_client": [{"client": k, "count": v} for k, v in sorted(by_client.items(), key=lambda x: -x[1])[:10]],
        "by_priority": by_priority,
        "insights": {
            "peak_hour": f"{peak_hour}:00 - {peak_hour+1}:00",
            "peak_day": days[peak_day],
            "total_incidents": len(tickets),
            "busiest_category": max(by_category, key=by_category.get) if by_category else "N/A",
        },
    }
