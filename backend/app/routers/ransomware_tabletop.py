from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random, uuid

router = APIRouter()

@router.get("/ransomware-tabletop/scenarios")
async def list_scenarios(current_user: dict = Depends(get_current_user)):
    scenarios = await db.ransomware_scenarios.find({}, {"_id": 0}).to_list(20)
    if not scenarios:
        scenarios = await _seed_scenarios()
    return scenarios

@router.post("/ransomware-tabletop/start/{scenario_id}")
async def start_drill(scenario_id: str, current_user: dict = Depends(get_current_user)):
    scenario = await db.ransomware_scenarios.find_one({"id": scenario_id}, {"_id": 0})
    if not scenario:
        return {"error": "Not found"}
    drill = {"id": f"drill-{uuid.uuid4().hex[:8]}", "scenario_id": scenario_id, "scenario_name": scenario.get("name"), "started_at": datetime.now(timezone.utc).isoformat(), "started_by": current_user.get("name"), "status": "in_progress", "current_phase": 1, "phases": scenario.get("phases", []), "responses": []}
    await db.tabletop_drills.insert_one(drill)
    drill.pop("_id", None)
    return drill

async def _seed_scenarios():
    scenarios = [
        {"name": "LockBit 3.0 Attack Simulation", "description": "Simulates a LockBit ransomware attack with lateral movement, data exfiltration, and encryption", "difficulty": "hard", "est_duration_min": 60, "phases": [
            {"phase": 1, "title": "Initial Compromise", "description": "A phishing email was opened by a user. Malicious macro executed.", "decisions": ["Isolate the workstation immediately", "Investigate further before acting", "Alert the SOC team"]},
            {"phase": 2, "title": "Lateral Movement", "description": "The attacker has moved to 3 additional workstations using stolen credentials.", "decisions": ["Kill all network connections", "Reset all AD passwords", "Identify and isolate affected machines"]},
            {"phase": 3, "title": "Data Exfiltration", "description": "500GB of data is being exfiltrated to an external IP.", "decisions": ["Block the external IP at firewall", "Enable data loss prevention rules", "Contact law enforcement"]},
            {"phase": 4, "title": "Encryption Begins", "description": "Ransomware has started encrypting file shares.", "decisions": ["Shut down all file servers", "Restore from last known good backup", "Negotiate with attackers"]},
        ]},
        {"name": "Business Email Compromise", "description": "CEO impersonation leading to wire transfer fraud attempt", "difficulty": "medium", "est_duration_min": 30, "phases": [
            {"phase": 1, "title": "Spoofed Email Received", "description": "CFO receives urgent email appearing to be from CEO requesting wire transfer.", "decisions": ["Verify via phone call to CEO", "Process the request", "Flag to IT security"]},
            {"phase": 2, "title": "Investigation", "description": "Email headers show external origin. Multiple employees targeted.", "decisions": ["Block sender domain", "Warn all employees", "Enable advanced anti-phishing"]},
        ]},
        {"name": "Supply Chain Attack", "description": "Compromised software update from trusted vendor", "difficulty": "hard", "est_duration_min": 45, "phases": [
            {"phase": 1, "title": "Vendor Update Deployed", "description": "Auto-update from monitoring tool contains backdoor. 80% of clients affected.", "decisions": ["Immediately uninstall the update", "Isolate all affected systems", "Contact vendor for verification"]},
            {"phase": 2, "title": "Backdoor Active", "description": "Command and control traffic detected from 50 endpoints.", "decisions": ["Block C2 domains at DNS", "Deploy emergency patch", "Full network isolation"]},
            {"phase": 3, "title": "Client Communication", "description": "Clients are asking questions. Media may pick this up.", "decisions": ["Proactive disclosure to all clients", "Only inform affected clients", "Wait until containment is complete"]},
        ]},
    ]
    result = []
    for s in scenarios:
        sc = {"id": f"rs-{uuid.uuid4().hex[:8]}", **s, "times_run": random.randint(0, 5), "avg_score_pct": random.randint(60, 90) if random.random() > 0.3 else None, "created_at": datetime.now(timezone.utc).isoformat()}
        result.append(sc)
        await db.ransomware_scenarios.insert_one(sc)
    return [{k: v for k, v in s.items() if k != "_id"} for s in result]
