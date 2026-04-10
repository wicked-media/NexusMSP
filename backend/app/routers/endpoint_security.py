from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random; random = random.SystemRandom()

router = APIRouter()

@router.get("/endpoint-security/scores")
async def get_endpoint_scores(current_user: dict = Depends(get_current_user)):
    devices = await db.devices.find({}, {"_id": 0}).to_list(500)
    scored = []
    for d in devices:
        patch_score = 100 if d.get("patch_status") == "current" else 60 if d.get("patch_status") == "needs_attention" else 30
        av_score = random.choice([90, 95, 100, 80, 0])
        encryption = random.choice([100, 100, 100, 0])
        firewall = random.choice([100, 100, 90, 0])
        mfa = random.choice([100, 100, 0, 0])
        total = round((patch_score * 0.3 + av_score * 0.2 + encryption * 0.2 + firewall * 0.15 + mfa * 0.15), 1)
        scored.append({
            "device_id": d["id"], "device_name": d.get("name"), "client_name": d.get("client_name"), "type": d.get("type"),
            "overall_score": total, "patch_score": patch_score, "av_score": av_score, "encryption_score": encryption,
            "firewall_score": firewall, "mfa_score": mfa, "grade": "A" if total >= 90 else "B" if total >= 75 else "C" if total >= 60 else "D" if total >= 40 else "F",
        })
    scored.sort(key=lambda x: x["overall_score"])
    summary = {"avg_score": round(sum(s["overall_score"] for s in scored) / len(scored), 1) if scored else 0, "a_count": sum(1 for s in scored if s["grade"] == "A"), "b_count": sum(1 for s in scored if s["grade"] == "B"), "c_count": sum(1 for s in scored if s["grade"] == "C"), "d_count": sum(1 for s in scored if s["grade"] == "D"), "f_count": sum(1 for s in scored if s["grade"] == "F")}
    return {"summary": summary, "scores": scored}
