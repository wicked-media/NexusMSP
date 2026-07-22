from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone
import uuid
from app.database import db
from app.auth import get_current_user

router = APIRouter()


def _is_response(survey: dict) -> bool:
    """Only scored feedback is a CSAT response; sent surveys are not ratings."""
    score = survey.get("score")
    return isinstance(score, (int, float)) and 1 <= score <= 5


@router.get("/csat/surveys")
async def get_surveys(current_user: dict = Depends(get_current_user)):
    """Get all CSAT survey responses."""
    surveys = await db.csat_surveys.find({}, {"_id": 0}).sort("responded_at", -1).to_list(500)
    return [{**survey, "submitted_at": survey.get("responded_at") or survey.get("submitted_at")} for survey in surveys if _is_response(survey)][:200]


@router.get("/csat/dashboard")
async def csat_dashboard(current_user: dict = Depends(get_current_user)):
    """CSAT dashboard with trends."""
    surveys = await db.csat_surveys.find({}, {"_id": 0}).to_list(1000)
    surveys = [survey for survey in surveys if _is_response(survey)]
    if not surveys:
        return {"avg_score": 0, "total_responses": 0, "by_tech": [], "by_client": [], "trend": [], "distribution": {}}

    avg = round(sum(s.get("score", 0) for s in surveys) / len(surveys), 1)

    # By tech
    tech_scores = {}
    for s in surveys:
        tn = s.get("tech_name", "Unknown")
        if tn not in tech_scores:
            tech_scores[tn] = []
        tech_scores[tn].append(s.get("score", 0))
    by_tech = [{"name": k, "avg": round(sum(v)/len(v), 1), "count": len(v)} for k, v in tech_scores.items()]
    by_tech.sort(key=lambda x: x["avg"], reverse=True)

    # By client
    client_scores = {}
    for s in surveys:
        cn = s.get("client_name", "Unknown")
        if cn not in client_scores:
            client_scores[cn] = []
        client_scores[cn].append(s.get("score", 0))
    by_client = [{"name": k, "avg": round(sum(v)/len(v), 1), "count": len(v)} for k, v in client_scores.items()]
    by_client.sort(key=lambda x: x["avg"])

    # Distribution
    dist = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
    for s in surveys:
        sc = s.get("score", 3)
        dist[sc] = dist.get(sc, 0) + 1

    return {"avg_score": avg, "total_responses": len(surveys), "by_tech": by_tech, "by_client": by_client, "distribution": dist}


@router.post("/csat/submit")
async def submit_survey(data: dict):
    raise HTTPException(
        status_code=410,
        detail="Direct CSAT submission was retired. Submit feedback through the ticket-linked survey response route so it remains attributable and auditable.",
    )


@router.post("/csat/seed-demo")
async def seed_demo_data(current_user: dict = Depends(get_current_user)):
    raise HTTPException(
        status_code=410,
        detail="Demo CSAT responses were retired. CSAT dashboards only use customer-submitted feedback linked to real tickets.",
    )
