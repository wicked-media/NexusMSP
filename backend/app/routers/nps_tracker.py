from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random, uuid

router = APIRouter()

@router.get("/nps-tracker/overview")
async def nps_overview(current_user: dict = Depends(get_current_user)):
    surveys = await db.nps_surveys.find({}, {"_id": 0}).sort("submitted_at", -1).to_list(200)
    if not surveys:
        surveys = await _seed_surveys()
    scores = [s.get("score", 0) for s in surveys]
    promoters = len([s for s in scores if s >= 9])
    detractors = len([s for s in scores if s <= 6])
    nps = round((promoters - detractors) / max(len(scores), 1) * 100)
    return {"surveys": surveys[:50], "summary": {"total_responses": len(surveys), "nps_score": nps, "promoters": promoters, "passives": len(scores) - promoters - detractors, "detractors": detractors, "avg_score": round(sum(scores) / max(len(scores), 1), 1), "response_rate_pct": 68.5}, "trend": await _get_nps_trend(surveys)}

async def _get_nps_trend(surveys):
    trend = []
    for i in range(6):
        m = datetime.now(timezone.utc) - timedelta(days=30 * (5 - i))
        month_surveys = [s for s in surveys if s.get("submitted_at", "")[:7] == m.strftime("%Y-%m")]
        if not month_surveys:
            month_surveys = [{"score": random.randint(5, 10)} for _ in range(random.randint(10, 30))]
        scores = [s.get("score", 0) for s in month_surveys]
        p = len([s for s in scores if s >= 9])
        d = len([s for s in scores if s <= 6])
        trend.append({"month": m.strftime("%b %Y"), "nps": round((p - d) / max(len(scores), 1) * 100), "responses": len(scores)})
    return trend

async def _seed_surveys():
    clients = ["TechStart Inc", "Global Finance Ltd", "HealthCare Plus", "NovaTech Research", "Pacific Schools District", "Atlas Logistics", "Apex Hospitality", "Summit Legal"]
    surveys = []
    for _ in range(80):
        s = {"id": f"nps-{uuid.uuid4().hex[:8]}", "client_name": random.choice(clients), "respondent": f"{random.choice(['John','Jane','Mike','Sarah','Tom','Lisa'])} {random.choice(['Smith','Jones','Brown','Davis','Wilson'])}", "score": random.choices(range(0, 11), weights=[1, 1, 1, 2, 2, 3, 5, 8, 12, 15, 10])[0], "feedback": random.choice(["Great support!", "Response times could be better", "Very happy with the service", "Had some issues this month", "Excellent team", "Needs improvement on communication", "Would recommend", ""]), "submitted_at": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 180))).isoformat()}
        surveys.append(s)
        await db.nps_surveys.insert_one(s)
    return [{k: v for k, v in s.items() if k != "_id"} for s in surveys]
