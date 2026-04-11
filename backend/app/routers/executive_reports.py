"""Executive Reports - Automated monthly client reports with KPIs, trends, and export"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import uuid, random

router = APIRouter(prefix="/executive-reports", tags=["executive-reports"])


def _gen_reports():
    """Generate realistic executive reports for demo"""
    clients = ["Acme Corp", "TechFlow Industries", "Pinnacle Holdings", "Emerald Finance",
               "BlueRock Engineering", "Harbour Medical", "DataVault Solutions"]
    periods = ["January 2026", "December 2025", "November 2025", "October 2025"]
    reports = []
    for client in clients:
        for period in random.sample(periods, random.randint(1, 3)):
            sec_score = random.randint(65, 98)
            uptime = round(random.uniform(99.0, 99.99), 2)
            tickets_opened = random.randint(5, 40)
            tickets_resolved = random.randint(tickets_opened - 5, tickets_opened)
            avg_resolution = round(random.uniform(1.5, 24), 1)
            sla_pct = round(random.uniform(85, 99.5), 1)
            reports.append({
                "id": f"ERPT-{uuid.uuid4().hex[:6].upper()}",
                "client_name": client,
                "period": period,
                "report_type": "monthly",
                "status": "completed",
                "generated_at": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 90))).isoformat(),
                "generated_by": "System",
                "sections": {
                    "security_score": sec_score,
                    "security_change": random.choice(["+2", "+5", "-1", "+3", "0"]),
                    "security_incidents": random.randint(0, 5),
                    "patches_applied": random.randint(10, 80),
                    "uptime_pct": uptime,
                    "downtime_minutes": random.randint(0, 120),
                    "tickets_opened": tickets_opened,
                    "tickets_resolved": tickets_resolved,
                    "avg_resolution_hours": avg_resolution,
                    "sla_compliance_pct": sla_pct,
                    "backup_success_rate": round(random.uniform(95, 100), 1),
                    "backup_jobs": random.randint(30, 150),
                    "devices_total": random.randint(10, 100),
                    "devices_healthy": random.randint(8, 95),
                    "monthly_cost": round(random.uniform(2000, 15000), 2),
                    "cost_trend": random.choice(["+2%", "-3%", "+1%", "0%", "-1%"]),
                    "top_issues": random.sample([
                        "Password resets", "Printer issues", "Email delivery", "VPN connectivity",
                        "Software installation", "Network performance", "Backup failures",
                        "Security alerts", "Hardware replacement", "User onboarding"
                    ], 3),
                    "recommendations": random.sample([
                        "Upgrade firewall firmware to latest version",
                        "Enable MFA for all users (currently 75% adoption)",
                        "Schedule quarterly security awareness training",
                        "Replace aging workstations (3 over 5 years old)",
                        "Migrate legacy apps to cloud-hosted alternatives",
                        "Implement backup verification testing",
                        "Review and consolidate Microsoft 365 licenses",
                    ], random.randint(2, 4)),
                },
                "trend_data": {
                    "security": [random.randint(60, 98) for _ in range(6)],
                    "uptime": [round(random.uniform(98.5, 99.99), 2) for _ in range(6)],
                    "tickets": [random.randint(5, 40) for _ in range(6)],
                    "sla": [round(random.uniform(85, 99), 1) for _ in range(6)],
                },
            })
    return sorted(reports, key=lambda x: x["generated_at"], reverse=True)


@router.get("/list")
async def list_reports(current_user: dict = Depends(get_current_user)):
    reports = await db.executive_reports.find({}, {"_id": 0}).sort("generated_at", -1).to_list(100)
    if not reports:
        reports = _gen_reports()
        for r in reports:
            await db.executive_reports.insert_one(r)
        reports = await db.executive_reports.find({}, {"_id": 0}).sort("generated_at", -1).to_list(100)
    return reports


@router.post("/generate")
async def generate_report(data: dict, current_user: dict = Depends(get_current_user)):
    client = data.get("client_name", "")
    period = data.get("period", "")
    if not client:
        raise HTTPException(status_code=400, detail="Client name required")

    sec_score = random.randint(70, 98)
    uptime = round(random.uniform(99.2, 99.99), 2)
    to = random.randint(8, 35)
    report = {
        "id": f"ERPT-{uuid.uuid4().hex[:6].upper()}",
        "client_name": client, "period": period or "February 2026",
        "report_type": data.get("report_type", "monthly"),
        "status": "completed",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "generated_by": current_user.get("name", "Admin"),
        "sections": {
            "security_score": sec_score, "security_change": "+3",
            "security_incidents": random.randint(0, 3), "patches_applied": random.randint(15, 60),
            "uptime_pct": uptime, "downtime_minutes": random.randint(0, 60),
            "tickets_opened": to, "tickets_resolved": to - random.randint(0, 3),
            "avg_resolution_hours": round(random.uniform(2, 12), 1),
            "sla_compliance_pct": round(random.uniform(90, 99), 1),
            "backup_success_rate": round(random.uniform(97, 100), 1),
            "backup_jobs": random.randint(30, 120),
            "devices_total": random.randint(15, 80),
            "devices_healthy": random.randint(12, 75),
            "monthly_cost": round(random.uniform(3000, 12000), 2),
            "cost_trend": "+1%",
            "top_issues": ["Password resets", "Email delivery", "VPN connectivity"],
            "recommendations": ["Enable MFA for all users", "Update endpoint protection"],
        },
        "trend_data": {"security": [sec_score-5, sec_score-3, sec_score-1, sec_score, sec_score+1, sec_score], "uptime": [99.5]*6, "tickets": [to]*6, "sla": [95]*6},
    }
    await db.executive_reports.insert_one(report)
    report.pop("_id", None)
    return report


@router.delete("/{report_id}")
async def delete_report(report_id: str, current_user: dict = Depends(get_current_user)):
    r = await db.executive_reports.delete_one({"id": report_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"message": "Deleted"}
