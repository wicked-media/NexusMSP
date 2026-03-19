from fastapi import APIRouter, Depends
from datetime import datetime, timezone
import uuid
from app.database import db
from app.auth import get_current_user

router = APIRouter()


@router.get("/csat/surveys")
async def get_surveys(current_user: dict = Depends(get_current_user)):
    """Get all CSAT survey responses."""
    surveys = await db.csat_surveys.find({}, {"_id": 0}).sort("submitted_at", -1).to_list(200)
    return surveys


@router.get("/csat/dashboard")
async def csat_dashboard(current_user: dict = Depends(get_current_user)):
    """CSAT dashboard with trends."""
    surveys = await db.csat_surveys.find({}, {"_id": 0}).to_list(1000)
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
    """Submit a CSAT response (public endpoint - linked from ticket resolution email)."""
    survey_id = str(uuid.uuid4())[:8]
    doc = {
        "id": survey_id,
        "ticket_id": data.get("ticket_id", ""),
        "ticket_title": data.get("ticket_title", ""),
        "client_id": data.get("client_id", ""),
        "client_name": data.get("client_name", ""),
        "tech_id": data.get("tech_id", ""),
        "tech_name": data.get("tech_name", ""),
        "score": max(1, min(5, data.get("score", 3))),
        "comment": data.get("comment", ""),
        "submitted_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.csat_surveys.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.post("/csat/seed-demo")
async def seed_demo_data(current_user: dict = Depends(get_current_user)):
    """Seed demo CSAT data for testing."""
    import random
    techs = await db.users.find({"role": {"$in": ["technician", "admin"]}}, {"_id": 0, "id": 1, "name": 1}).to_list(10)
    clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(20)
    count = 0
    for _ in range(30):
        tech = random.choice(techs) if techs else {"id": "u1", "name": "Tech"}
        client = random.choice(clients) if clients else {"id": "c1", "name": "Client"}
        await db.csat_surveys.insert_one({
            "id": str(uuid.uuid4())[:8],
            "ticket_id": f"t-{random.randint(1,100)}",
            "client_id": client["id"], "client_name": client.get("name",""),
            "tech_id": tech["id"], "tech_name": tech.get("name",""),
            "score": random.choices([1,2,3,4,5], weights=[2,5,15,40,38])[0],
            "comment": random.choice(["Great service!", "Fast response", "Could be better", "Excellent!", "Took too long", "Very satisfied", ""]),
            "submitted_at": datetime.now(timezone.utc).isoformat(),
        })
        count += 1
    return {"seeded": count}
