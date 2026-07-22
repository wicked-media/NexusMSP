"""Evidence-backed NPS metrics.

No response rate or monthly score is inferred when surveys have not been
collected.  This avoids turning an empty feedback programme into a positive
customer-health signal.
"""

from collections import defaultdict
from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.database import db


router = APIRouter()


def _score_summary(surveys: list[dict]) -> dict:
    scores = [int(survey.get("score", 0)) for survey in surveys if isinstance(survey.get("score"), (int, float))]
    if not scores:
        return {"total_responses": 0, "nps_score": None, "promoters": 0, "passives": 0, "detractors": 0, "avg_score": None, "response_rate_pct": None}
    promoters = sum(score >= 9 for score in scores)
    detractors = sum(score <= 6 for score in scores)
    return {
        "total_responses": len(scores),
        "nps_score": round((promoters - detractors) / len(scores) * 100),
        "promoters": promoters,
        "passives": len(scores) - promoters - detractors,
        "detractors": detractors,
        "avg_score": round(sum(scores) / len(scores), 1),
        "response_rate_pct": None,
    }


def _trend(surveys: list[dict]) -> list[dict]:
    buckets: dict[str, list[dict]] = defaultdict(list)
    for survey in surveys:
        submitted = str(survey.get("submitted_at") or "")
        if len(submitted) >= 7:
            buckets[submitted[:7]].append(survey)
    return [
        {"month": month, "nps": _score_summary(rows)["nps_score"], "responses": len(rows)}
        for month, rows in sorted(buckets.items())[-12:]
    ]


@router.get("/nps-tracker/overview")
async def nps_overview(current_user: dict = Depends(get_current_user)):
    surveys = await db.nps_surveys.find({}, {"_id": 0}).sort("submitted_at", -1).to_list(200)
    return {
        "surveys": surveys[:50],
        "summary": _score_summary(surveys),
        "trend": _trend(surveys),
        "evidence_state": "evidence_available" if surveys else "not_configured",
        "message": None if surveys else "No NPS responses have been recorded. Configure a verified NPS collection workflow before using NPS in client health or QBRs.",
    }
