from fastapi import APIRouter, Depends

from app.database import db
from app.auth import get_current_user

router = APIRouter()


def _grade(score: float) -> str:
    return "A" if score >= 90 else "B" if score >= 75 else "C" if score >= 60 else "D" if score >= 40 else "F"


@router.get("/endpoint-security/scores")
async def get_endpoint_scores(current_user: dict = Depends(get_current_user)):
    """Return evidence-based endpoint posture from Nexus Agent telemetry only."""
    devices = await db.devices.find({}, {"_id": 0}).to_list(5000)
    scored = []
    for device in devices:
        assessed = bool(device.get("security_assessed_at"))
        pending = int(device.get("pending_patches") or 0)
        patch_score = 100 if pending == 0 else 80 if pending <= 3 else 60 if pending <= 10 else 30
        av_active = device.get("antivirus_status") == "active" and bool(device.get("defender_real_time_enabled"))
        av_score = 100 if av_active else 0
        encryption_text = str(device.get("encryption_status") or "")
        encryption_active = any(marker in encryption_text.lower() for marker in ("encrypted", "bitlocker on", "protection on"))
        encryption_score = 100 if encryption_active else 0
        firewall_active = bool(device.get("firewall_enabled"))
        firewall_score = 100 if firewall_active else 0
        weighted = [(patch_score, 0.30), (av_score, 0.30), (encryption_score, 0.20), (firewall_score, 0.20)]
        overall = round(sum(value * weight for value, weight in weighted), 1) if assessed else None
        patch_status = "up_to_date" if pending == 0 else "pending" if pending <= 10 else "critical_missing"
        scored.append({
            "id": device["id"], "device_id": device["id"], "hostname": device.get("name") or device.get("hostname"),
            "os": " ".join(part for part in [device.get("os"), device.get("os_version")] if part),
            "organization": device.get("client_name") or "Unassigned client", "status": device.get("status") or "unknown",
            "assessed": assessed, "overall_score": overall, "patch_score": patch_score,
            "av_score": av_score, "encryption_score": encryption_score, "firewall_score": firewall_score,
            "av_status": "active" if av_active else ("inactive" if assessed else "not_assessed"),
            "firewall": "enabled" if firewall_active else ("disabled" if assessed else "not_assessed"),
            "encryption": "encrypted" if encryption_active else ("not_encrypted" if assessed else "not_assessed"),
            "patch_status": patch_status, "pending_patches": pending,
            "risk_score": round(100 - overall) if overall is not None else None,
            "grade": _grade(overall) if overall is not None else "—",
            "last_seen": device.get("last_heartbeat") or device.get("last_seen"),
        })
    scored.sort(key=lambda row: row["overall_score"] if row["overall_score"] is not None else -1)
    assessed_scores = [row["overall_score"] for row in scored if row["overall_score"] is not None]
    summary = {
        "avg_score": round(sum(assessed_scores) / len(assessed_scores), 1) if assessed_scores else None,
        "assessed": len(assessed_scores), "unassessed": len(scored) - len(assessed_scores),
        "a_count": sum(1 for row in scored if row["grade"] == "A"), "b_count": sum(1 for row in scored if row["grade"] == "B"),
        "c_count": sum(1 for row in scored if row["grade"] == "C"), "d_count": sum(1 for row in scored if row["grade"] == "D"), "f_count": sum(1 for row in scored if row["grade"] == "F"),
    }
    return {"summary": summary, "scores": scored, "source": "nexus-agent"}
