from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import uuid
import random

router = APIRouter()

@router.get("/dns-monitor/domains")
async def get_monitored_domains(current_user: dict = Depends(get_current_user)):
    domains = await db.dns_domains.find({}, {"_id": 0}).to_list(500)
    if not domains:
        domains = await _seed_dns_data()
    return domains

@router.post("/dns-monitor/domains")
async def add_domain(data: dict, current_user: dict = Depends(get_current_user)):
    domain = {
        "id": f"dns-{uuid.uuid4().hex[:8]}",
        "domain": data["domain"],
        "client_id": data.get("client_id", ""),
        "client_name": data.get("client_name", ""),
        "monitoring_enabled": True,
        "check_interval_minutes": data.get("check_interval_minutes", 60),
        "records": {},
        "last_checked": None,
        "alerts": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.dns_domains.insert_one(domain)
    domain.pop("_id", None)
    return domain

@router.post("/dns-monitor/check/{domain_id}")
async def check_domain_dns(domain_id: str, current_user: dict = Depends(get_current_user)):
    domain = await db.dns_domains.find_one({"id": domain_id}, {"_id": 0})
    if not domain:
        return {"error": "Domain not found"}
    now = datetime.now(timezone.utc).isoformat()
    await db.dns_domains.update_one({"id": domain_id}, {"$set": {"last_checked": now}})
    return {"status": "checked", "domain": domain["domain"], "checked_at": now}

@router.get("/dns-monitor/alerts")
async def get_dns_alerts(current_user: dict = Depends(get_current_user)):
    alerts = await db.dns_alerts.find({}, {"_id": 0}).sort("detected_at", -1).to_list(200)
    if not alerts:
        alerts = await _seed_dns_alerts()
    return alerts

@router.post("/dns-monitor/alerts/{alert_id}/acknowledge")
async def acknowledge_alert(alert_id: str, current_user: dict = Depends(get_current_user)):
    await db.dns_alerts.update_one({"id": alert_id}, {"$set": {"acknowledged": True, "acknowledged_by": current_user.get("name"), "acknowledged_at": datetime.now(timezone.utc).isoformat()}})
    return {"status": "acknowledged"}

@router.get("/dns-monitor/history/{domain_id}")
async def get_dns_history(domain_id: str, current_user: dict = Depends(get_current_user)):
    history = await db.dns_history.find({"domain_id": domain_id}, {"_id": 0}).sort("checked_at", -1).to_list(100)
    return history

async def _seed_dns_data():
    now = datetime.now(timezone.utc)
    domains = [
        {"id": "dns-001", "domain": "acme.com", "client_id": "client-001", "client_name": "Acme Corporation", "monitoring_enabled": True, "check_interval_minutes": 30,
         "records": {"A": [{"value": "203.45.67.10", "ttl": 3600}], "MX": [{"value": "mail.acme.com", "priority": 10, "ttl": 3600}], "TXT": [{"value": "v=spf1 include:_spf.google.com ~all", "ttl": 3600}], "NS": [{"value": "ns1.cloudflare.com", "ttl": 86400}, {"value": "ns2.cloudflare.com", "ttl": 86400}]},
         "last_checked": (now - timedelta(minutes=15)).isoformat(), "status": "healthy", "alerts_count": 0, "created_at": (now - timedelta(days=90)).isoformat()},
        {"id": "dns-002", "domain": "techstart.io", "client_id": "client-002", "client_name": "TechStart Inc", "monitoring_enabled": True, "check_interval_minutes": 60,
         "records": {"A": [{"value": "45.67.89.12", "ttl": 300}], "AAAA": [{"value": "2607:f8b0:4004:800::200e", "ttl": 300}], "MX": [{"value": "aspmx.l.google.com", "priority": 1, "ttl": 3600}], "TXT": [{"value": "v=spf1 include:_spf.google.com ~all", "ttl": 3600}, {"value": "google-site-verification=abc123", "ttl": 3600}], "CNAME": [{"name": "www", "value": "techstart.io", "ttl": 3600}]},
         "last_checked": (now - timedelta(minutes=45)).isoformat(), "status": "warning", "alerts_count": 1, "created_at": (now - timedelta(days=60)).isoformat()},
        {"id": "dns-003", "domain": "globalfin.com", "client_id": "client-003", "client_name": "Global Finance Ltd", "monitoring_enabled": True, "check_interval_minutes": 15,
         "records": {"A": [{"value": "91.23.45.67", "ttl": 3600}], "MX": [{"value": "globalfin-com.mail.protection.outlook.com", "priority": 0, "ttl": 3600}], "TXT": [{"value": "v=spf1 include:spf.protection.outlook.com -all", "ttl": 3600}, {"value": "MS=ms12345678", "ttl": 3600}], "NS": [{"value": "ns1-01.azure-dns.com", "ttl": 172800}]},
         "last_checked": (now - timedelta(minutes=5)).isoformat(), "status": "healthy", "alerts_count": 0, "created_at": (now - timedelta(days=120)).isoformat()},
        {"id": "dns-004", "domain": "hcplus.org", "client_id": "client-004", "client_name": "HealthCare Plus", "monitoring_enabled": True, "check_interval_minutes": 30,
         "records": {"A": [{"value": "67.89.12.34", "ttl": 3600}], "MX": [{"value": "mail.hcplus.org", "priority": 10, "ttl": 3600}], "TXT": [{"value": "v=spf1 ip4:67.89.12.34 ~all", "ttl": 3600}]},
         "last_checked": (now - timedelta(hours=2)).isoformat(), "status": "critical", "alerts_count": 2, "created_at": (now - timedelta(days=45)).isoformat()},
        {"id": "dns-005", "domain": "retailmax.com", "client_id": "client-005", "client_name": "RetailMax", "monitoring_enabled": True, "check_interval_minutes": 60,
         "records": {"A": [{"value": "34.56.78.90", "ttl": 3600}], "MX": [{"value": "aspmx.l.google.com", "priority": 1, "ttl": 3600}], "TXT": [{"value": "v=spf1 include:_spf.google.com ~all", "ttl": 3600}]},
         "last_checked": (now - timedelta(minutes=30)).isoformat(), "status": "healthy", "alerts_count": 0, "created_at": (now - timedelta(days=30)).isoformat()},
        {"id": "dns-006", "domain": "summitlegal.com", "client_id": "client-006", "client_name": "Summit Legal Group", "monitoring_enabled": True, "check_interval_minutes": 30,
         "records": {"A": [{"value": "104.26.10.1", "ttl": 300}], "MX": [{"value": "mx1.summitlegal.com", "priority": 10, "ttl": 3600}], "TXT": [{"value": "v=spf1 include:spf.protection.outlook.com -all", "ttl": 3600}]},
         "last_checked": (now - timedelta(minutes=20)).isoformat(), "status": "healthy", "alerts_count": 0, "created_at": (now - timedelta(days=75)).isoformat()},
        {"id": "dns-007", "domain": "greenvolt.com", "client_id": "client-014", "client_name": "GreenVolt Energy", "monitoring_enabled": True, "check_interval_minutes": 15,
         "records": {"A": [{"value": "52.18.200.45", "ttl": 60}], "MX": [{"value": "aspmx.l.google.com", "priority": 1, "ttl": 3600}], "TXT": [{"value": "v=spf1 include:_spf.google.com ~all", "ttl": 3600}], "CNAME": [{"name": "app", "value": "greenvolt.herokuapp.com", "ttl": 3600}]},
         "last_checked": (now - timedelta(minutes=8)).isoformat(), "status": "warning", "alerts_count": 1, "created_at": (now - timedelta(days=50)).isoformat()},
    ]
    for d in domains:
        await db.dns_domains.insert_one(d)
    return [dict((k, v) for k, v in d.items() if k != "_id") for d in domains]

async def _seed_dns_alerts():
    now = datetime.now(timezone.utc)
    alerts = [
        {"id": "dnsa-001", "domain_id": "dns-004", "domain": "hcplus.org", "client_name": "HealthCare Plus", "type": "record_changed", "severity": "critical", "record_type": "MX",
         "old_value": "mail.hcplus.org (priority: 10)", "new_value": "sus-mail-relay.xyz (priority: 5)", "message": "MX record changed - potential email hijack detected!", "detected_at": (now - timedelta(hours=2)).isoformat(), "acknowledged": False},
        {"id": "dnsa-002", "domain_id": "dns-004", "domain": "hcplus.org", "client_name": "HealthCare Plus", "type": "record_changed", "severity": "warning", "record_type": "TXT",
         "old_value": "v=spf1 ip4:67.89.12.34 ~all", "new_value": "v=spf1 ip4:67.89.12.34 ip4:185.143.0.0/16 ~all", "message": "SPF record modified - unauthorized IP range added", "detected_at": (now - timedelta(hours=1, minutes=45)).isoformat(), "acknowledged": False},
        {"id": "dnsa-003", "domain_id": "dns-002", "domain": "techstart.io", "client_name": "TechStart Inc", "type": "record_changed", "severity": "warning", "record_type": "A",
         "old_value": "45.67.89.12", "new_value": "45.67.89.15", "message": "A record IP changed - verify this was an authorized change", "detected_at": (now - timedelta(days=1)).isoformat(), "acknowledged": True, "acknowledged_by": "Alex Thompson", "acknowledged_at": (now - timedelta(hours=20)).isoformat()},
        {"id": "dnsa-004", "domain_id": "dns-007", "domain": "greenvolt.com", "client_name": "GreenVolt Energy", "type": "ttl_changed", "severity": "info", "record_type": "A",
         "old_value": "TTL: 300", "new_value": "TTL: 60", "message": "A record TTL significantly decreased", "detected_at": (now - timedelta(hours=6)).isoformat(), "acknowledged": False},
        {"id": "dnsa-005", "domain_id": "dns-003", "domain": "globalfin.com", "client_name": "Global Finance Ltd", "type": "record_added", "severity": "info", "record_type": "TXT",
         "old_value": "", "new_value": "MS=ms12345678", "message": "New TXT record added for Microsoft verification", "detected_at": (now - timedelta(days=3)).isoformat(), "acknowledged": True, "acknowledged_by": "Sarah Chen"},
    ]
    for a in alerts:
        await db.dns_alerts.insert_one(a)
    return [dict((k, v) for k, v in a.items() if k != "_id") for a in alerts]
