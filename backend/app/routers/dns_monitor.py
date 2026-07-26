from fastapi import APIRouter, Depends, HTTPException, Query, Request
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
from app.services.action_permissions import require_action
from app.services.scope_permissions import assert_client_scope, effective_scope
from pydantic import BaseModel, Field
from typing import Literal
import asyncio
import math
import re
import socket
import ssl
from collections import Counter, defaultdict
from urllib.parse import urlparse
import dns.exception
import dns.flags
import dns.name
import dns.resolver
import httpx
import uuid
import random; random = random.SystemRandom()

router = APIRouter()

DEFAULT_NEXUS_DNS_SETTINGS = {
    "id": "nexus-dns-settings",
    "product_enabled": True,
    "deployment_mode": "visibility",
    "resolver_endpoints": [],
    "dns_transport": "doh",
    "fail_behavior": "open",
    "retention_days": 30,
    "domain_redaction": False,
    "regional_storage": "australia",
    "consent_notice": True,
    "bypass_detection": True,
    "local_policy_cache": True,
    "canary_ring_percent": 5,
    "emergency_disabled": False,
    "network_mode_enabled": False,
    "logging_profile": "security_only",
    "zero_trust_enabled": False,
    "lookalike_monitoring": True,
    "service_tier": "essentials",
    "billing_model": "endpoint",
    "custom_block_page_enabled": True,
    "block_page_title": "This destination was blocked by Nexus DNS",
    "block_page_message": "Nexus DNS prevented access because this destination conflicts with your organisation's security policy.",
    "block_page_support_url": "",
    "block_page_request_access": True,
    "block_page_require_mfa": True,
}

DEFAULT_CATEGORY_ACTIONS = {
    "malware": "block",
    "phishing": "block",
    "command_and_control": "block",
    "newly_registered_domains": "audit",
    "dynamic_dns": "audit",
    "cryptomining": "block",
    "adult": "allow",
    "gambling": "allow",
    "social_media": "allow",
    "streaming": "allow",
    "generative_ai": "allow",
    "file_sharing": "audit",
}


class NexusDnsPolicyPayload(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    description: str = Field(default="", max_length=500)
    scope_type: Literal["global", "msp", "client", "site", "group", "user", "device"] = "client"
    scope_id: str = Field(default="", max_length=200)
    scope_name: str = Field(default="", max_length=200)
    mode: Literal["visibility", "audit", "block"] = "audit"
    categories: dict[str, Literal["allow", "audit", "block"]] = Field(default_factory=lambda: dict(DEFAULT_CATEGORY_ACTIONS))
    allow_domains: list[str] = Field(default_factory=list, max_length=500)
    block_domains: list[str] = Field(default_factory=list, max_length=500)
    schedule: str = Field(default="always", max_length=120)
    access_conditions: dict = Field(default_factory=dict)
    minimum_device_score: int = Field(default=0, ge=0, le=100)
    uncertain_domain_action: Literal["allow", "audit", "block"] = "audit"
    enabled: bool = True


class NexusDnsSettingsPayload(BaseModel):
    deployment_mode: Literal["visibility", "audit", "block"] = "visibility"
    resolver_endpoints: list[str] = Field(default_factory=list, max_length=12)
    dns_transport: Literal["doh", "dot"] = "doh"
    fail_behavior: Literal["open", "closed"] = "open"
    retention_days: int = Field(default=30, ge=0, le=365)
    domain_redaction: bool = False
    regional_storage: Literal["australia", "tenant_default"] = "australia"
    consent_notice: bool = True
    bypass_detection: bool = True
    local_policy_cache: bool = True
    canary_ring_percent: int = Field(default=5, ge=1, le=100)
    network_mode_enabled: bool = False
    logging_profile: Literal["security_only", "categorised", "full_audit", "private", "custom"] = "security_only"
    zero_trust_enabled: bool = False
    lookalike_monitoring: bool = True
    service_tier: Literal["essentials", "business", "secure"] = "essentials"
    billing_model: Literal["endpoint", "user", "site"] = "endpoint"
    custom_block_page_enabled: bool = True
    block_page_title: str = Field(default="This destination was blocked by Nexus DNS", max_length=140)
    block_page_message: str = Field(default="", max_length=500)
    block_page_support_url: str = Field(default="", max_length=2048)
    block_page_request_access: bool = True
    block_page_require_mfa: bool = True


class NexusDnsDeploymentPayload(BaseModel):
    device_ids: list[str] = Field(default_factory=list, max_length=200)
    all_eligible: bool = False
    ring: Literal["canary", "pilot", "broad"] = "canary"
    mode: Literal["visibility", "audit", "block"] = "visibility"
    reason: str = Field(default="", max_length=500)


class NexusDnsRollbackPayload(BaseModel):
    reason: str = Field(min_length=8, max_length=500)


class NexusDnsTemporaryAllowPayload(BaseModel):
    minutes: int = Field(default=30, ge=5, le=1440)
    reason: str = Field(min_length=4, max_length=500)


class NexusDnsDomainAnalysisPayload(BaseModel):
    domain: str = Field(min_length=3, max_length=253)
    client_id: str = Field(default="", max_length=200)


class NexusDnsShadowDecisionPayload(BaseModel):
    decision: Literal["approve", "block", "review"]
    owner: str = Field(default="", max_length=200)
    reason: str = Field(min_length=4, max_length=500)
    add_to_inventory: bool = False


class NexusDnsPrivateZonePayload(BaseModel):
    client_id: str = Field(min_length=1, max_length=200)
    name: str = Field(min_length=2, max_length=120)
    zone: str = Field(min_length=3, max_length=253)
    records: list[dict] = Field(default_factory=list, max_length=500)
    enabled: bool = True


class NexusDnsToolkitPayload(BaseModel):
    domain: str = Field(min_length=3, max_length=253)
    tool: Literal["resolve", "compare", "cname", "dnssec", "policy", "categorise"] = "resolve"
    policy_id: str = Field(default="", max_length=200)
    client_id: str = Field(default="", max_length=200)


class NexusDnsAccessRequestPayload(BaseModel):
    domain: str = Field(min_length=3, max_length=253)
    client_id: str = Field(default="", max_length=200)
    device_id: str = Field(default="", max_length=200)
    user_name: str = Field(default="", max_length=200)
    business_reason: str = Field(min_length=4, max_length=500)
    requested_minutes: int = Field(default=30, ge=5, le=1440)
    manager: str = Field(default="", max_length=200)
    mfa_verified: bool = False


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _actor(current_user: dict) -> str:
    return current_user.get("name") or current_user.get("email") or current_user.get("id") or "NexusMSP technician"


async def _assert_dns_scope(
    current_user: dict,
    *,
    scope_type: str,
    scope_id: str,
    operation: str,
    request: Request,
) -> None:
    """Resolve a DNS policy target back to its governed client boundary."""
    client_id = None
    site_id = None
    if scope_type == "client":
        client_id = scope_id
    elif scope_type == "site":
        site = await db.network_sites.find_one({"id": scope_id}, {"_id": 0, "client_id": 1})
        client_id = (site or {}).get("client_id")
        site_id = scope_id
    elif scope_type == "device":
        device = await db.nexus_agents.find_one({"id": scope_id}, {"_id": 0, "client_id": 1, "site_id": 1})
        if not device:
            device = await db.devices.find_one({"id": scope_id}, {"_id": 0, "client_id": 1, "site_id": 1})
        client_id = (device or {}).get("client_id")
        site_id = (device or {}).get("site_id")
    await assert_client_scope(
        current_user,
        client_id,
        site_id=site_id,
        operation=operation,
        request=request,
    )


async def _dns_settings() -> dict:
    current = await db.nexus_dns_settings.find_one({"id": "nexus-dns-settings"}, {"_id": 0})
    return {**DEFAULT_NEXUS_DNS_SETTINGS, **(current or {})}


def _resolver_ready(settings: dict) -> bool:
    endpoints = [str(value).strip() for value in settings.get("resolver_endpoints") or [] if str(value).strip()]
    return (
        bool(endpoints)
        and settings.get("resolver_probe_status") == "healthy"
        and bool(settings.get("resolver_attested_at"))
        and not settings.get("emergency_disabled")
    )


def _scope_allows_agent(agent: dict, scope: dict) -> bool:
    if scope.get("mode") != "restricted":
        return True
    client_ids = set(scope.get("client_ids") or [])
    site_ids = set(scope.get("site_ids") or [])
    if agent.get("client_id") not in client_ids:
        return False
    return not site_ids or not agent.get("site_id") or agent.get("site_id") in site_ids


def _recently_online(last_seen: str | None, *, minutes: int = 3) -> bool:
    try:
        return bool(
            last_seen
            and datetime.fromisoformat(str(last_seen).replace("Z", "+00:00"))
            >= datetime.now(timezone.utc) - timedelta(minutes=minutes)
        )
    except (TypeError, ValueError):
        return False


async def _dns_audit(action: str, current_user: dict, details: dict | None = None) -> None:
    await db.nexus_dns_audit.insert_one({
        "id": f"ndns-audit-{uuid.uuid4().hex[:12]}",
        "action": action,
        "actor": _actor(current_user),
        "occurred_at": _now(),
        "details": details or {},
    })


def _normalise_domain(value: str) -> str:
    domain = str(value or "").strip().lower().rstrip(".")
    if "://" in domain:
        domain = (urlparse(domain).hostname or "").lower()
    if not domain or len(domain) > 253 or "." not in domain:
        raise HTTPException(422, "Enter a valid fully-qualified domain")
    labels = domain.split(".")
    if any(not label or len(label) > 63 or not re.fullmatch(r"[a-z0-9-]+", label) or label.startswith("-") or label.endswith("-") for label in labels):
        raise HTTPException(422, "Domain contains an invalid label")
    return domain


def _entropy(value: str) -> float:
    if not value:
        return 0.0
    counts = Counter(value)
    length = len(value)
    return round(-sum((count / length) * math.log2(count / length) for count in counts.values()), 2)


def _resolve_records_sync(domain: str, nameservers: list[str] | None = None) -> dict:
    resolver = dns.resolver.Resolver(configure=not nameservers)
    if nameservers:
        resolver.nameservers = nameservers
    resolver.timeout = 2.0
    resolver.lifetime = 4.0
    output: dict[str, list[str]] = {}
    errors: dict[str, str] = {}
    response_codes: dict[str, str] = {}
    for record_type in ("A", "AAAA", "CNAME", "MX", "NS", "TXT"):
        try:
            answer = resolver.resolve(domain, record_type, raise_on_no_answer=False)
            values = [str(item).strip('"') for item in answer] if answer.rrset else []
            output[record_type] = values
            response_codes[record_type] = "NOERROR" if values else "NODATA"
        except dns.resolver.NXDOMAIN:
            errors[record_type] = "NXDOMAIN"
            response_codes[record_type] = "NXDOMAIN"
        except dns.resolver.NoNameservers as exc:
            errors[record_type] = f"No nameserver response: {str(exc)[:160]}"
            response_codes[record_type] = "SERVFAIL"
        except (dns.resolver.LifetimeTimeout, dns.exception.Timeout):
            errors[record_type] = "Resolver timeout"
            response_codes[record_type] = "TIMEOUT"
        except Exception as exc:
            errors[record_type] = str(exc)[:160]
            response_codes[record_type] = "ERROR"
    try:
        dnskey = resolver.resolve(domain, "DNSKEY", raise_on_no_answer=False)
        dnssec_present = bool(dnskey.rrset)
    except Exception:
        dnssec_present = False
    return {"records": output, "errors": errors, "response_codes": response_codes, "dnssec_present": dnssec_present}


def _certificate_info_sync(domain: str) -> dict:
    context = ssl.create_default_context()
    try:
        with socket.create_connection((domain, 443), timeout=3.0) as sock:
            with context.wrap_socket(sock, server_hostname=domain) as tls:
                cert = tls.getpeercert()
        not_before = cert.get("notBefore")
        not_after = cert.get("notAfter")
        issued = datetime.strptime(not_before, "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc) if not_before else None
        expires = datetime.strptime(not_after, "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc) if not_after else None
        return {
            "present": True,
            "issued_at": issued.isoformat() if issued else None,
            "expires_at": expires.isoformat() if expires else None,
            "age_days": max(0, (datetime.now(timezone.utc) - issued).days) if issued else None,
            "issuer": next((value for group in cert.get("issuer", []) for key, value in group if key == "organizationName"), ""),
        }
    except Exception as exc:
        return {"present": False, "error": str(exc)[:180]}


async def _rdap_info(domain: str) -> dict:
    try:
        async with httpx.AsyncClient(timeout=5.0, follow_redirects=True) as client:
            response = await client.get(f"https://rdap.org/domain/{domain}", headers={"Accept": "application/rdap+json"})
        if response.status_code == 404:
            return {"registered": False, "status": "not_found"}
        response.raise_for_status()
        body = response.json()
        events = {str(item.get("eventAction")): item.get("eventDate") for item in body.get("events") or []}
        registered_at = events.get("registration")
        age_days = None
        if registered_at:
            try:
                age_days = max(0, (datetime.now(timezone.utc) - datetime.fromisoformat(registered_at.replace("Z", "+00:00"))).days)
            except ValueError:
                pass
        registrar = ""
        for entity in body.get("entities") or []:
            if "registrar" not in (entity.get("roles") or []):
                continue
            vcard = entity.get("vcardArray") or []
            entries = vcard[1] if len(vcard) > 1 and isinstance(vcard[1], list) else []
            registrar = next((str(entry[3]) for entry in entries if isinstance(entry, list) and len(entry) > 3 and entry[0] in {"fn", "org"}), "")
            if registrar:
                break
        return {
            "registered": True,
            "status": "available",
            "registered_at": registered_at,
            "age_days": age_days,
            "registrar": registrar,
            "domain_status": body.get("status") or [],
        }
    except Exception as exc:
        return {"registered": None, "status": "unavailable", "error": str(exc)[:180]}


def _lookalike_variants(domain: str) -> list[dict]:
    labels = domain.split(".")
    stem = labels[0]
    suffix = ".".join(labels[1:])
    variants: dict[str, str] = {}
    swaps = {"i": "l", "l": "i", "o": "0", "a": "4", "e": "3", "s": "5"}
    for index, char in enumerate(stem):
        if char in swaps:
            variants[f"{stem[:index]}{swaps[char]}{stem[index + 1:]}.{suffix}"] = f"Visual substitution: {char} → {swaps[char]}"
        if index < len(stem) - 1 and stem[index] != stem[index + 1]:
            variants[f"{stem[:index]}{stem[index + 1]}{stem[index]}{stem[index + 2:]}.{suffix}"] = "Adjacent character transposition"
        if len(stem) > 5:
            variants[f"{stem[:index]}{stem[index + 1:]}.{suffix}"] = "Missing character"
    variants[f"{stem}-login.{suffix}"] = "Credential-themed suffix"
    variants[f"{stem}-secure.{suffix}"] = "Security-themed suffix"
    variants[f"{stem}.com"] = "Alternative commercial suffix"
    return [{"domain": key, "reason": value} for key, value in list(variants.items())[:24] if key != domain]


async def _record_domain_timeline(domain: str, event_type: str, summary: str, details: dict | None = None) -> dict:
    event = {
        "id": f"ndns-timeline-{uuid.uuid4().hex[:12]}",
        "domain": domain,
        "event_type": event_type,
        "summary": summary,
        "details": details or {},
        "occurred_at": _now(),
    }
    await db.nexus_dns_domain_timeline.insert_one(event)
    event.pop("_id", None)
    return event

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
    await db.dns_history.insert_one({
        "id": f"dnsh-{uuid.uuid4().hex[:10]}",
        "domain_id": domain_id,
        "domain": domain["domain"],
        "checked_at": now,
        "status": domain.get("status", "unknown"),
        "records_checked": sorted((domain.get("records") or {}).keys()),
        "initiated_by": current_user.get("name") or current_user.get("email") or "NexusMSP technician",
        "source": "manual_check",
    })
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


# ---------------------------------------------------------------------------
# Nexus DNS protective-DNS control plane
#
# These APIs intentionally separate control-plane readiness from resolver-edge
# enforcement. NexusMSP must not claim a domain was blocked until a configured
# resolver reports an authenticated enforcement event.
# ---------------------------------------------------------------------------

@router.get("/nexus-dns/overview")
async def nexus_dns_overview(current_user: dict = Depends(get_current_user)):
    settings = await _dns_settings()
    now = datetime.now(timezone.utc)
    online_since = (now - timedelta(minutes=3)).isoformat()
    agent_filter = {"is_active": True}
    total_agents = await db.nexus_agents.count_documents(agent_filter)
    online_agents = await db.nexus_agents.count_documents({**agent_filter, "last_seen": {"$gte": online_since}})
    enrolled_agents = await db.nexus_agents.count_documents({**agent_filter, "nexus_dns.enrolled": True})
    policies = await db.nexus_dns_policies.count_documents({"enabled": True})
    events = await db.nexus_dns_events.count_documents({})
    blocks = await db.nexus_dns_events.count_documents({"action": "block", "evidence_status": "verified"})
    incidents = await db.nexus_dns_events.count_documents({"severity": {"$in": ["critical", "high"]}, "resolved": {"$ne": True}})
    record_alerts = await db.dns_alerts.count_documents({"acknowledged": {"$ne": True}})
    ready = _resolver_ready(settings)
    return {
        "product": "Nexus DNS",
        "phase": "visibility" if settings.get("deployment_mode") == "visibility" else settings.get("deployment_mode"),
        "edge_ready": ready,
        "edge_status": "configured" if ready else "setup_required",
        "enforcement_available": ready,
        "protection_status": "emergency_disabled" if settings.get("emergency_disabled") else ("active" if ready and settings.get("deployment_mode") == "block" else "staged"),
        "metrics": {
            "eligible_endpoints": total_agents,
            "online_endpoints": online_agents,
            "dns_enrolled_endpoints": enrolled_agents,
            "active_policies": policies,
            "query_events": events,
            "verified_blocks": blocks,
            "open_incidents": incidents,
            "record_alerts": record_alerts,
        },
        "readiness": [
            {"key": "agent_channel", "label": "Nexus Agent deployment channel", "ready": total_agents > 0, "detail": f"{total_agents} eligible endpoint(s)"},
            {"key": "resolver_edge", "label": "Regional resolver edge", "ready": ready, "detail": "Configured resolver endpoint(s)" if ready else "Add a DoH or DoT resolver endpoint"},
            {"key": "fail_safe", "label": "Fail-safe and rollback", "ready": settings.get("fail_behavior") in {"open", "closed"} and settings.get("local_policy_cache"), "detail": f"Fail-{settings.get('fail_behavior', 'open')} with local policy cache"},
            {"key": "privacy", "label": "Privacy and retention", "ready": settings.get("retention_days", 30) >= 0, "detail": f"{settings.get('retention_days', 30)} day retention · {settings.get('regional_storage', 'australia')}"},
        ],
        "last_updated": _now(),
    }


@router.get("/nexus-dns/policies")
async def nexus_dns_policies(current_user: dict = Depends(get_current_user)):
    policies = await db.nexus_dns_policies.find({}, {"_id": 0}).sort("updated_at", -1).to_list(500)
    if policies:
        return policies
    starter = {
        "id": "ndns-policy-starter",
        "name": "High-confidence threat protection",
        "description": "Starter policy for malware, phishing, command-and-control and cryptomining. It begins in audit mode.",
        "scope_type": "msp",
        "scope_id": "",
        "scope_name": "All managed clients",
        "mode": "audit",
        "categories": dict(DEFAULT_CATEGORY_ACTIONS),
        "allow_domains": [],
        "block_domains": [],
        "schedule": "always",
        "enabled": True,
        "delivery_status": "draft",
        "source": "nexus_starter",
        "created_at": _now(),
        "updated_at": _now(),
        "updated_by": "NexusMSP",
    }
    await db.nexus_dns_policies.insert_one(starter)
    starter.pop("_id", None)
    return [starter]


@router.post("/nexus-dns/policies", dependencies=[Depends(require_action("dns.policy.modify"))])
async def create_nexus_dns_policy(payload: NexusDnsPolicyPayload, request: Request, current_user: dict = Depends(get_current_user)):
    await _assert_dns_scope(
        current_user,
        scope_type=payload.scope_type,
        scope_id=payload.scope_id,
        operation="dns.policy.modify",
        request=request,
    )
    now = _now()
    policy = {
        "id": f"ndns-policy-{uuid.uuid4().hex[:10]}",
        **payload.model_dump(),
        "delivery_status": "draft",
        "created_at": now,
        "updated_at": now,
        "updated_by": _actor(current_user),
    }
    await db.nexus_dns_policies.insert_one(policy)
    policy.pop("_id", None)
    await _dns_audit("policy_created", current_user, {"policy_id": policy["id"], "mode": policy["mode"], "scope": policy["scope_type"]})
    return policy


@router.put("/nexus-dns/policies/{policy_id}", dependencies=[Depends(require_action("dns.policy.modify"))])
async def update_nexus_dns_policy(policy_id: str, payload: NexusDnsPolicyPayload, request: Request, current_user: dict = Depends(get_current_user)):
    existing = await db.nexus_dns_policies.find_one({"id": policy_id})
    if not existing:
        raise HTTPException(404, "Nexus DNS policy not found")
    await _assert_dns_scope(
        current_user,
        scope_type=payload.scope_type,
        scope_id=payload.scope_id,
        operation="dns.policy.modify",
        request=request,
    )
    update = {**payload.model_dump(), "delivery_status": "draft", "updated_at": _now(), "updated_by": _actor(current_user)}
    await db.nexus_dns_policies.update_one({"id": policy_id}, {"$set": update})
    await _dns_audit("policy_updated", current_user, {"policy_id": policy_id, "mode": update["mode"]})
    return {**{key: value for key, value in existing.items() if key != "_id"}, **update}


@router.post("/nexus-dns/policies/{policy_id}/simulate")
async def simulate_nexus_dns_policy(policy_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    policy = await db.nexus_dns_policies.find_one({"id": policy_id}, {"_id": 0})
    if not policy:
        raise HTTPException(404, "Nexus DNS policy not found")
    domain = str(data.get("domain") or "").strip().lower().rstrip(".")
    category = str(data.get("category") or "unknown").strip().lower().replace(" ", "_")
    if not domain or "." not in domain:
        raise HTTPException(422, "Enter a valid domain to simulate")
    action = "allow"
    reason = "No matching block or audit rule"
    context = data.get("context") if isinstance(data.get("context"), dict) else {}
    conditions = policy.get("access_conditions") if isinstance(policy.get("access_conditions"), dict) else {}
    evaluations = []
    condition_failures = []

    def evaluate_condition(key: str, label: str, required, actual, passed: bool):
        item = {"key": key, "label": label, "required": required, "actual": actual, "passed": passed}
        evaluations.append(item)
        if not passed:
            condition_failures.append(item)

    if conditions.get("managed_device"):
        evaluate_condition("managed_device", "Managed device", True, bool(context.get("managed_device")), bool(context.get("managed_device")))
    if conditions.get("bitlocker_required"):
        evaluate_condition("bitlocker_required", "BitLocker enabled", True, bool(context.get("bitlocker_enabled")), bool(context.get("bitlocker_enabled")))
    minimum_score = int(policy.get("minimum_device_score") or 0)
    if minimum_score:
        actual_score = int(context.get("device_score") or 0)
        evaluate_condition("device_score", "Minimum device score", minimum_score, actual_score, actual_score >= minimum_score)
    allowed_locations = [str(value).strip().lower() for value in conditions.get("locations") or [] if str(value).strip()]
    if allowed_locations:
        actual_location = str(context.get("location") or "").strip().lower()
        evaluate_condition("location", "Approved location", allowed_locations, actual_location or "not reported", actual_location in allowed_locations)
    allowed_roles = [str(value).strip().lower() for value in conditions.get("roles") or [] if str(value).strip()]
    if allowed_roles:
        actual_role = str(context.get("role") or "").strip().lower()
        evaluate_condition("role", "Approved role", allowed_roles, actual_role or "not reported", actual_role in allowed_roles)
    risk_order = {"none": 0, "low": 1, "medium": 2, "high": 3, "critical": 4, "any": 99}
    maximum_risk = str(conditions.get("maximum_risk") or "any").lower()
    if maximum_risk != "any":
        actual_risk = str(context.get("identity_risk") or "none").lower()
        evaluate_condition(
            "identity_risk",
            "Maximum identity risk",
            maximum_risk,
            actual_risk,
            risk_order.get(actual_risk, 99) <= risk_order.get(maximum_risk, 99),
        )

    if condition_failures:
        action = "block"
        reason = f"Zero-trust access condition failed: {condition_failures[0]['label']}"
    elif domain in policy.get("allow_domains", []):
        reason, action = "Explicit allow-domain rule", "allow"
    elif domain in policy.get("block_domains", []):
        reason, action = "Explicit block-domain rule", "block"
    elif category in (policy.get("categories") or {}):
        action = policy["categories"][category]
        reason = f"Category rule: {category.replace('_', ' ')}"
    result = {
        "simulation_id": f"ndns-sim-{uuid.uuid4().hex[:10]}",
        "policy_id": policy_id,
        "domain": domain,
        "category": category,
        "action": action,
        "reason": reason,
        "policy_mode": policy.get("mode", "audit"),
        "context": context,
        "conditions_evaluated": evaluations,
        "condition_failures": condition_failures,
        "enforced": False,
        "note": "Simulation only. No DNS request or endpoint configuration was changed.",
        "simulated_at": _now(),
        "simulated_by": _actor(current_user),
    }
    await db.nexus_dns_simulations.insert_one(result)
    result.pop("_id", None)
    await _dns_audit("policy_simulated", current_user, {"policy_id": policy_id, "domain": domain, "result": action})
    return result


@router.post("/nexus-dns/policies/{policy_id}/rollout", dependencies=[Depends(require_action("dns.deployment.stage"))])
async def rollout_nexus_dns_policy(policy_id: str, data: dict, request: Request, current_user: dict = Depends(get_current_user)):
    policy = await db.nexus_dns_policies.find_one({"id": policy_id}, {"_id": 0})
    if not policy:
        raise HTTPException(404, "Nexus DNS policy not found")
    await _assert_dns_scope(
        current_user,
        scope_type=policy.get("scope_type", "msp"),
        scope_id=policy.get("scope_id", ""),
        operation="dns.deployment.stage",
        request=request,
    )
    settings = await _dns_settings()
    requested_mode = str(data.get("mode") or policy.get("mode") or "audit")
    ring = str(data.get("ring") or "canary")
    if requested_mode == "block" and not _resolver_ready(settings):
        raise HTTPException(409, "Blocking rollout is locked until a resolver edge is configured and emergency disable is clear")
    if requested_mode == "block" and ring != "canary":
        raise HTTPException(409, "The first blocking rollout must use the canary ring")
    status = "queued" if requested_mode in {"visibility", "audit"} or _resolver_ready(settings) else "blocked"
    deployment_id = f"ndns-deploy-{uuid.uuid4().hex[:10]}"
    deployment = {
        "id": deployment_id,
        "policy_id": policy_id,
        "policy_name": policy.get("name"),
        "mode": requested_mode,
        "ring": ring,
        "status": status,
        "rollback_available": True,
        "created_at": _now(),
        "created_by": _actor(current_user),
    }
    await db.nexus_dns_deployments.insert_one(deployment)
    await db.nexus_dns_policies.update_one({"id": policy_id}, {"$set": {"delivery_status": status, "last_deployment_id": deployment_id, "updated_at": _now()}})
    deployment.pop("_id", None)
    await _dns_audit("policy_rollout_queued", current_user, deployment)
    return deployment


@router.get("/nexus-dns/events")
async def nexus_dns_events(
    search: str = Query(default="", max_length=200),
    severity: str = Query(default="all", max_length=30),
    action: str = Query(default="all", max_length=30),
    client_id: str = Query(default="", max_length=200),
    current_user: dict = Depends(get_current_user),
):
    query: dict = {}
    if severity != "all":
        query["severity"] = severity
    if action != "all":
        query["action"] = action
    if client_id:
        query["client_id"] = client_id
    if search.strip():
        value = search.strip()
        query["$or"] = [
            {"domain": {"$regex": value, "$options": "i"}},
            {"device_name": {"$regex": value, "$options": "i"}},
            {"user_name": {"$regex": value, "$options": "i"}},
            {"client_name": {"$regex": value, "$options": "i"}},
        ]
    return await db.nexus_dns_events.find(query, {"_id": 0}).sort("observed_at", -1).to_list(500)


@router.post("/nexus-dns/events/{event_id}/temporary-allow", dependencies=[Depends(require_action("dns.exception.create"))])
async def temporarily_allow_dns_event(event_id: str, payload: NexusDnsTemporaryAllowPayload, request: Request, current_user: dict = Depends(get_current_user)):
    event = await db.nexus_dns_events.find_one({"id": event_id}, {"_id": 0})
    if not event:
        raise HTTPException(404, "DNS event not found")
    await assert_client_scope(
        current_user,
        event.get("client_id"),
        site_id=event.get("site_id"),
        operation="dns.exception.create",
        request=request,
    )
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=payload.minutes)).isoformat()
    exception = {
        "id": f"ndns-exception-{uuid.uuid4().hex[:10]}",
        "event_id": event_id,
        "domain": event.get("domain"),
        "client_id": event.get("client_id", ""),
        "client_name": event.get("client_name", ""),
        "site_id": event.get("site_id", ""),
        "device_name": event.get("device_name", ""),
        "scope_type": "device",
        "scope_id": event.get("device_id", ""),
        "reason": payload.reason,
        "created_at": _now(),
        "expires_at": expires_at,
        "created_by": _actor(current_user),
        "status": "active",
    }
    await db.nexus_dns_exceptions.insert_one(exception)
    exception.pop("_id", None)
    await _dns_audit("temporary_allow_created", current_user, exception)
    return exception


@router.get("/nexus-dns/exceptions")
async def nexus_dns_exceptions(
    include_expired: bool = Query(default=True),
    limit: int = Query(default=200, ge=1, le=500),
    current_user: dict = Depends(get_current_user),
):
    rows = await db.nexus_dns_exceptions.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    scope = effective_scope(current_user)
    device_ids = [row.get("scope_id") for row in rows if row.get("scope_type") == "device" and row.get("scope_id")]
    agents = await db.nexus_agents.find(
        {"id": {"$in": device_ids}},
        {"_id": 0, "id": 1, "hostname": 1, "client_id": 1, "site_id": 1},
    ).to_list(max(1, len(device_ids)))
    agent_map = {agent["id"]: agent for agent in agents if agent.get("id")}
    now = datetime.now(timezone.utc)
    visible = []
    for row in rows:
        agent = agent_map.get(row.get("scope_id")) or {}
        enriched = {
            **row,
            "client_id": row.get("client_id") or agent.get("client_id", ""),
            "site_id": row.get("site_id") or agent.get("site_id", ""),
            "device_name": row.get("device_name") or agent.get("hostname", ""),
        }
        if not _scope_allows_agent(enriched, scope):
            continue
        try:
            expired = bool(
                enriched.get("expires_at")
                and datetime.fromisoformat(str(enriched["expires_at"]).replace("Z", "+00:00")) <= now
            )
        except (TypeError, ValueError):
            expired = False
        enriched["status"] = "expired" if expired else enriched.get("status", "active")
        enriched["active"] = enriched["status"] == "active"
        if include_expired or enriched["active"]:
            visible.append(enriched)
    return {
        "exceptions": visible,
        "summary": {
            "active": sum(1 for row in visible if row["active"]),
            "expired": sum(1 for row in visible if not row["active"]),
            "total": len(visible),
        },
    }


@router.post("/nexus-dns/events/{event_id}/create-ticket")
async def create_dns_incident_ticket(event_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    event = await db.nexus_dns_events.find_one({"id": event_id}, {"_id": 0})
    if not event:
        raise HTTPException(404, "DNS event not found")
    ticket_id = str(uuid.uuid4())
    ticket_number = f"DNS-{datetime.now(timezone.utc).strftime('%y%m%d')}-{uuid.uuid4().hex[:4].upper()}"
    title = f"Nexus DNS investigation: {event.get('domain', 'unknown domain')}"
    ticket = {
        "id": ticket_id,
        "ticket_number": ticket_number,
        "title": title,
        "description": data.get("notes") or (
            f"Investigate a {event.get('severity', 'security')} Nexus DNS event for "
            f"{event.get('client_name') or 'an unlinked client'}. Evidence: {event.get('reason') or 'DNS policy match'}."
        ),
        "client_id": event.get("client_id", ""),
        "client_name": event.get("client_name", ""),
        "status": "open",
        "priority": "critical" if event.get("severity") == "critical" else "high",
        "category": "Security",
        "source": "nexus_dns",
        "created_at": _now(),
        "created_by": _actor(current_user),
        "audit_context": {"nexus_dns_event_id": event_id, "domain": event.get("domain"), "policy_id": event.get("policy_id")},
    }
    await db.tickets.insert_one(ticket)
    await db.nexus_dns_events.update_one({"id": event_id}, {"$set": {"ticket_id": ticket_id, "ticket_number": ticket_number}})
    ticket.pop("_id", None)
    await _dns_audit("incident_ticket_created", current_user, {"event_id": event_id, "ticket_id": ticket_id, "ticket_number": ticket_number})
    return ticket


@router.get("/nexus-dns/coverage")
async def nexus_dns_coverage(current_user: dict = Depends(get_current_user)):
    agents = await db.nexus_agents.find({"is_active": True}, {"_id": 0, "agent_token": 0}).sort("hostname", 1).to_list(500)
    scope = effective_scope(current_user)
    agents = [agent for agent in agents if _scope_allows_agent(agent, scope)]
    now = datetime.now(timezone.utc)
    rows = []
    for agent in agents:
        last_seen = agent.get("last_seen")
        online = False
        try:
            online = bool(last_seen and datetime.fromisoformat(last_seen.replace("Z", "+00:00")) >= now - timedelta(minutes=3))
        except (TypeError, ValueError):
            pass
        client = await db.clients.find_one({"id": agent.get("client_id")}, {"_id": 0, "name": 1}) if agent.get("client_id") else None
        dns_profile = agent.get("nexus_dns") if isinstance(agent.get("nexus_dns"), dict) else {}
        rows.append({
            "device_id": agent.get("id"),
            "hostname": agent.get("hostname") or "Unnamed endpoint",
            "client_id": agent.get("client_id", ""),
            "client_name": (client or {}).get("name", ""),
            "online": online,
            "eligible": str(agent.get("os") or "").lower().startswith("win"),
            "agent_version": agent.get("agent_version", ""),
            "dns_enrolled": bool(dns_profile.get("enrolled")),
            "mode": dns_profile.get("mode", "not_deployed"),
            "bypass_status": dns_profile.get("bypass_status", "not_assessed"),
            "last_seen": last_seen,
        })
    return {"devices": rows, "summary": {
        "total": len(rows),
        "eligible": sum(1 for row in rows if row["eligible"]),
        "online": sum(1 for row in rows if row["online"]),
        "enrolled": sum(1 for row in rows if row["dns_enrolled"]),
    }}


@router.post("/nexus-dns/deployments/preview")
async def preview_nexus_dns_deployment(payload: NexusDnsDeploymentPayload, current_user: dict = Depends(get_current_user)):
    settings = await _dns_settings()
    agent_query = {"is_active": True}
    if not payload.all_eligible:
        agent_query["id"] = {"$in": payload.device_ids}
    agents = await db.nexus_agents.find(agent_query, {"_id": 0, "id": 1, "hostname": 1, "client_id": 1, "os": 1, "last_seen": 1}).to_list(500)
    scope = effective_scope(current_user)
    agents = [agent for agent in agents if _scope_allows_agent(agent, scope)]
    eligible = [agent for agent in agents if str(agent.get("os") or "").lower().startswith("win")]
    warnings = []
    if payload.mode == "block" and not _resolver_ready(settings):
        warnings.append("Blocking is unavailable until a resolver edge is configured.")
    if payload.mode == "block" and payload.ring != "canary":
        warnings.append("Begin blocking with the canary ring before pilot or broad deployment.")
    if settings.get("fail_behavior") == "closed":
        warnings.append("Fail-closed can interrupt DNS when the resolver is unreachable; use only after resilience testing.")
    return {
        "eligible_count": len(eligible),
        "devices": eligible,
        "mode": payload.mode,
        "ring": payload.ring,
        "can_proceed": not warnings or payload.mode != "block",
        "warnings": warnings,
        "rollback_plan": [
            "Restore the adapter DNS servers captured before deployment.",
            "Remove the Nexus DNS endpoint policy and local certificate material.",
            "Flush the DNS cache and confirm resolution through the previous resolver.",
            "Record the technician, reason, affected endpoints and result in the audit trail.",
        ],
        "changes": [
            "Deploy visibility and resolver-health configuration through the existing Nexus Agent channel.",
            "Authenticate the endpoint to the assigned client policy.",
            "Enable bypass detection and keep a locally cached last-known-good policy.",
        ],
    }


@router.post("/nexus-dns/deployments", dependencies=[Depends(require_action("dns.deployment.stage"))])
async def create_nexus_dns_deployment(payload: NexusDnsDeploymentPayload, request: Request, current_user: dict = Depends(get_current_user)):
    settings = await _dns_settings()
    if payload.mode == "block" and not _resolver_ready(settings):
        raise HTTPException(409, "Blocking deployment is locked until a resolver edge is configured")
    if payload.mode == "block" and payload.ring != "canary":
        raise HTTPException(409, "The first blocking deployment must use the canary ring")
    query: dict = {"is_active": True}
    if not payload.all_eligible:
        if not payload.device_ids:
            raise HTTPException(422, "Select at least one endpoint")
        query["id"] = {"$in": payload.device_ids}
    agents = await db.nexus_agents.find(query, {"_id": 0, "agent_token": 0}).to_list(500)
    eligible = [agent for agent in agents if str(agent.get("os") or "").lower().startswith("win")]
    scope = effective_scope(current_user)
    if scope["mode"] == "restricted":
        if payload.all_eligible:
            eligible = [agent for agent in eligible if agent.get("client_id") in scope["client_ids"] and (not scope["site_ids"] or not agent.get("site_id") or agent.get("site_id") in scope["site_ids"])]
        else:
            for agent in eligible:
                await assert_client_scope(
                    current_user,
                    agent.get("client_id"),
                    site_id=agent.get("site_id"),
                    operation="dns.deployment.stage",
                    request=request,
                )
    if not eligible:
        raise HTTPException(422, "No eligible Windows endpoints are available in your client and site scope")
    deployment_id = f"ndns-deploy-{uuid.uuid4().hex[:10]}"
    now = _now()
    for agent in eligible:
        await db.nexus_agents.update_one({"id": agent["id"]}, {"$set": {
            "nexus_dns": {
                "enrolled": True,
                "mode": payload.mode,
                "ring": payload.ring,
                "deployment_id": deployment_id,
                "status": "configuration_queued",
                "updated_at": now,
            }
        }})
    deployment = {
        "id": deployment_id,
        "device_ids": [agent["id"] for agent in eligible],
        "device_count": len(eligible),
        "mode": payload.mode,
        "ring": payload.ring,
        "status": "configuration_queued",
        "reason": payload.reason,
        "rollback_available": True,
        "created_at": now,
        "created_by": _actor(current_user),
        "note": "Endpoint configuration is staged in the control plane. Enforcement begins only when a compatible agent and resolver edge acknowledge the policy.",
    }
    await db.nexus_dns_deployments.insert_one(deployment)
    deployment.pop("_id", None)
    await _dns_audit("endpoint_deployment_queued", current_user, deployment)
    return deployment


@router.get("/nexus-dns/deployments")
async def nexus_dns_deployments(
    limit: int = Query(default=100, ge=1, le=300),
    current_user: dict = Depends(get_current_user),
):
    deployments = await db.nexus_dns_deployments.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    policy_ids = sorted({deployment.get("policy_id") for deployment in deployments if deployment.get("policy_id")})
    policies = await db.nexus_dns_policies.find(
        {"id": {"$in": policy_ids}},
        {"_id": 0, "id": 1, "scope_type": 1, "scope_id": 1},
    ).to_list(max(1, len(policy_ids)))
    policy_map = {policy["id"]: policy for policy in policies if policy.get("id")}
    all_device_ids = sorted({
        device_id
        for deployment in deployments
        for device_id in (deployment.get("device_ids") or [])
        if device_id
    })
    agents = await db.nexus_agents.find(
        {"id": {"$in": all_device_ids}},
        {
            "_id": 0,
            "id": 1,
            "hostname": 1,
            "client_id": 1,
            "site_id": 1,
            "last_seen": 1,
            "nexus_dns": 1,
        },
    ).to_list(max(1, len(all_device_ids)))
    agent_map = {agent["id"]: agent for agent in agents if agent.get("id")}
    client_ids = sorted({agent.get("client_id") for agent in agents if agent.get("client_id")})
    clients = await db.clients.find({"id": {"$in": client_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(max(1, len(client_ids)))
    client_map = {client["id"]: client.get("name", "") for client in clients if client.get("id")}
    scope = effective_scope(current_user)
    visible_deployments = []

    for deployment in deployments:
        device_ids = deployment.get("device_ids") or []
        if not device_ids and scope.get("mode") == "restricted":
            policy = policy_map.get(deployment.get("policy_id"))
            if not policy:
                continue
            if policy.get("scope_type") == "client" and policy.get("scope_id") not in set(scope.get("client_ids") or []):
                continue
            if policy.get("scope_type") == "site" and policy.get("scope_id") not in set(scope.get("site_ids") or []):
                continue
            if policy.get("scope_type") in {"global", "msp"}:
                continue
        endpoint_rows = []
        for device_id in device_ids:
            agent = agent_map.get(device_id)
            if agent and not _scope_allows_agent(agent, scope):
                continue
            if not agent:
                if scope.get("mode") == "restricted":
                    continue
                endpoint_rows.append({
                    "device_id": device_id,
                    "hostname": "Removed endpoint",
                    "client_id": "",
                    "client_name": "",
                    "online": False,
                    "status": "missing",
                    "agent_status": "not_registered",
                    "last_seen": None,
                    "reported_at": None,
                })
                continue

            dns_profile = agent.get("nexus_dns") if isinstance(agent.get("nexus_dns"), dict) else {}
            expected_id = dns_profile.get("deployment_id")
            acknowledged_id = dns_profile.get("acknowledged_deployment_id")
            online = _recently_online(agent.get("last_seen"))
            if acknowledged_id == deployment.get("id"):
                endpoint_status = "acknowledged"
            elif expected_id == deployment.get("id"):
                endpoint_status = "pending" if online else "offline"
            else:
                endpoint_status = "superseded"
            endpoint_rows.append({
                "device_id": device_id,
                "hostname": agent.get("hostname") or "Unnamed endpoint",
                "client_id": agent.get("client_id", ""),
                "client_name": client_map.get(agent.get("client_id"), ""),
                "online": online,
                "status": endpoint_status,
                "agent_status": dns_profile.get("status", "not_reported"),
                "last_seen": agent.get("last_seen"),
                "reported_at": dns_profile.get("agent_reported_at"),
            })

        if device_ids and not endpoint_rows and scope.get("mode") == "restricted":
            continue

        counts = Counter(row["status"] for row in endpoint_rows)
        if deployment.get("rollback_of"):
            derived_status = "rollback_acknowledged" if endpoint_rows and counts["acknowledged"] == len(endpoint_rows) else "rollback_queued"
        elif endpoint_rows and counts["acknowledged"] == len(endpoint_rows):
            derived_status = "acknowledged"
        elif counts["acknowledged"]:
            derived_status = "partial"
        elif counts["pending"] or counts["offline"]:
            derived_status = "pending"
        elif endpoint_rows and counts["superseded"] + counts["missing"] == len(endpoint_rows):
            derived_status = "superseded"
        else:
            derived_status = deployment.get("status", "queued")

        visible_deployments.append({
            **deployment,
            "status": derived_status,
            "endpoints": endpoint_rows,
            "visible_device_count": len(endpoint_rows),
            "evidence": {
                "acknowledged": counts["acknowledged"],
                "pending": counts["pending"],
                "offline": counts["offline"],
                "superseded": counts["superseded"],
                "missing": counts["missing"],
            },
        })

    latest = visible_deployments[0] if visible_deployments else None
    endpoint_deployments = [item for item in visible_deployments if item.get("endpoints")]
    return {
        "deployments": visible_deployments,
        "summary": {
            "total": len(visible_deployments),
            "endpoint_deployments": len(endpoint_deployments),
            "acknowledged_endpoints": sum(item["evidence"]["acknowledged"] for item in endpoint_deployments),
            "pending_endpoints": sum(item["evidence"]["pending"] + item["evidence"]["offline"] for item in endpoint_deployments),
            "latest_status": latest.get("status") if latest else "not_started",
            "latest_at": latest.get("created_at") if latest else None,
        },
    }


@router.post(
    "/nexus-dns/deployments/{deployment_id}/rollback",
    dependencies=[Depends(require_action("dns.emergency.disable"))],
)
async def rollback_nexus_dns_deployment(
    deployment_id: str,
    payload: NexusDnsRollbackPayload,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    original = await db.nexus_dns_deployments.find_one({"id": deployment_id}, {"_id": 0})
    if not original:
        raise HTTPException(404, "DNS deployment not found")
    if original.get("rollback_of"):
        raise HTTPException(409, "A rollback deployment cannot be rolled back again")
    if not original.get("rollback_available", False):
        raise HTTPException(409, "Rollback is no longer available for this deployment")
    device_ids = original.get("device_ids") or []
    if not device_ids:
        raise HTTPException(422, "This policy-only rollout has no endpoint configuration to restore")

    agents = await db.nexus_agents.find(
        {"id": {"$in": device_ids}},
        {"_id": 0, "agent_token": 0},
    ).to_list(max(1, len(device_ids)))
    for agent in agents:
        await assert_client_scope(
            current_user,
            agent.get("client_id"),
            site_id=agent.get("site_id"),
            operation="dns.deployment.rollback",
            request=request,
        )
    targets = [
        agent
        for agent in agents
        if isinstance(agent.get("nexus_dns"), dict)
        and agent["nexus_dns"].get("deployment_id") == deployment_id
    ]
    if not targets:
        raise HTTPException(409, "No endpoints are still assigned to this deployment")

    rollback_id = f"ndns-rollback-{uuid.uuid4().hex[:10]}"
    now = _now()
    for agent in targets:
        await db.nexus_agents.update_one(
            {"id": agent["id"]},
            {"$set": {
                "nexus_dns.enrolled": True,
                "nexus_dns.mode": "visibility",
                "nexus_dns.deployment_id": rollback_id,
                "nexus_dns.rollback_of": deployment_id,
                "nexus_dns.status": "rollback_queued",
                "nexus_dns.updated_at": now,
            }},
        )
    rollback = {
        "id": rollback_id,
        "device_ids": [agent["id"] for agent in targets],
        "device_count": len(targets),
        "mode": "visibility",
        "ring": original.get("ring", "canary"),
        "status": "rollback_queued",
        "reason": payload.reason,
        "rollback_of": deployment_id,
        "rollback_available": False,
        "created_at": now,
        "created_by": _actor(current_user),
        "note": "Safe visibility configuration is queued. Completion is recorded only after each Nexus Agent acknowledges the rollback deployment.",
    }
    await db.nexus_dns_deployments.insert_one(rollback)
    await db.nexus_dns_deployments.update_one(
        {"id": deployment_id},
        {"$set": {
            "status": "rollback_queued",
            "rollback_available": False,
            "rollback_id": rollback_id,
            "rollback_queued_at": now,
            "rollback_queued_by": _actor(current_user),
            "rollback_reason": payload.reason,
        }},
    )
    rollback.pop("_id", None)
    await _dns_audit("endpoint_deployment_rollback_queued", current_user, {
        "deployment_id": deployment_id,
        "rollback_id": rollback_id,
        "device_ids": rollback["device_ids"],
        "reason": payload.reason,
    })
    return rollback


@router.get("/nexus-dns/settings")
async def get_nexus_dns_settings(current_user: dict = Depends(get_current_user)):
    settings = await _dns_settings()
    return {**settings, "edge_ready": _resolver_ready(settings)}


@router.put("/nexus-dns/settings", dependencies=[Depends(require_action("dns.policy.modify"))])
async def update_nexus_dns_settings(payload: NexusDnsSettingsPayload, current_user: dict = Depends(get_current_user)):
    data = payload.model_dump()
    data["resolver_endpoints"] = sorted({endpoint.strip().rstrip("/") for endpoint in data["resolver_endpoints"] if endpoint.strip()})
    for endpoint in data["resolver_endpoints"]:
        if payload.dns_transport == "doh" and not endpoint.startswith("https://"):
            raise HTTPException(422, "DoH resolver endpoints must use https://")
        if payload.dns_transport == "dot" and ":" not in endpoint:
            raise HTTPException(422, "DoT resolver endpoints must include a host and port")
    if data["deployment_mode"] == "block" and not data["resolver_endpoints"]:
        raise HTTPException(409, "Add and validate a resolver edge before selecting blocking mode")
    update = {**DEFAULT_NEXUS_DNS_SETTINGS, **data, "updated_at": _now(), "updated_by": _actor(current_user)}
    await db.nexus_dns_settings.update_one({"id": "nexus-dns-settings"}, {"$set": update}, upsert=True)
    await _dns_audit("settings_updated", current_user, {
        "deployment_mode": update["deployment_mode"],
        "resolver_count": len(update["resolver_endpoints"]),
        "fail_behavior": update["fail_behavior"],
        "retention_days": update["retention_days"],
    })
    return {**update, "edge_ready": _resolver_ready(update)}


@router.post("/nexus-dns/resolvers/test")
async def test_nexus_dns_resolvers(data: dict, current_user: dict = Depends(get_current_user)):
    settings = await _dns_settings()
    endpoints = data.get("resolver_endpoints") or settings.get("resolver_endpoints") or []
    endpoints = [str(endpoint).strip() for endpoint in endpoints if str(endpoint).strip()]
    if not endpoints:
        raise HTTPException(422, "Add at least one resolver endpoint")
    results = []
    for endpoint in endpoints:
        syntactically_valid = endpoint.startswith("https://") if settings.get("dns_transport") == "doh" else ":" in endpoint
        results.append({
            "endpoint": endpoint,
            "syntax_valid": syntactically_valid,
            "reachable": None,
            "status": "validation_required" if syntactically_valid else "invalid",
            "detail": "Endpoint saved; a deployed resolver health probe must attest connectivity and DNSSEC before enforcement." if syntactically_valid else "Endpoint format is not valid for the selected transport.",
        })
    await _dns_audit("resolver_configuration_tested", current_user, {"endpoint_count": len(endpoints)})
    return {
        "results": results,
        "edge_ready": False,
        "note": "NexusMSP does not report a resolver healthy until a trusted regional probe returns signed health evidence.",
    }


@router.post("/nexus-dns/emergency/disable", dependencies=[Depends(require_action("dns.emergency.disable"))])
async def emergency_disable_nexus_dns(data: dict, request: Request, current_user: dict = Depends(get_current_user)):
    await assert_client_scope(
        current_user,
        None,
        operation="dns.emergency.disable-global",
        request=request,
    )
    reason = str(data.get("reason") or "").strip()
    if len(reason) < 4:
        raise HTTPException(422, "A reason is required for emergency disable")
    update = {
        "emergency_disabled": True,
        "deployment_mode": "visibility",
        "emergency_disabled_at": _now(),
        "emergency_disabled_by": _actor(current_user),
        "emergency_disable_reason": reason,
    }
    await db.nexus_dns_settings.update_one({"id": "nexus-dns-settings"}, {"$set": update}, upsert=True)
    await db.nexus_agents.update_many({"nexus_dns.enrolled": True}, {"$set": {"nexus_dns.mode": "visibility", "nexus_dns.status": "emergency_disable_queued"}})
    await _dns_audit("emergency_disable", current_user, {"reason": reason})
    return {"status": "emergency_disable_queued", "message": "Nexus DNS policies have been moved to visibility mode; enrolled endpoints will restore safe resolution on next check-in."}


@router.get("/nexus-dns/audit")
async def nexus_dns_audit(limit: int = Query(default=200, ge=1, le=500), current_user: dict = Depends(get_current_user)):
    return await db.nexus_dns_audit.find({}, {"_id": 0}).sort("occurred_at", -1).to_list(limit)


@router.get("/nexus-dns/intelligence/summary")
async def nexus_dns_intelligence_summary(current_user: dict = Depends(get_current_user)):
    since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    profiles = await db.nexus_dns_domain_profiles.find({}, {"_id": 0}).sort("analysed_at", -1).to_list(500)
    active_lookalikes = await db.nexus_dns_lookalikes.count_documents({"active": True, "status": {"$ne": "dismissed"}})
    threat_domains = await db.nexus_dns_events.distinct("domain", {"observed_at": {"$gte": since}, "severity": {"$in": ["critical", "high"]}})
    newly_seen = await db.nexus_dns_domain_profiles.count_documents({"first_seen_at": {"$gte": since}})
    return {
        "analysed_domains": len(profiles),
        "high_risk_domains": sum(1 for profile in profiles if int(profile.get("risk_score") or 0) >= 70),
        "watch_domains": sum(1 for profile in profiles if 20 <= int(profile.get("risk_score") or 0) < 70),
        "active_lookalikes": active_lookalikes,
        "newly_seen_30d": newly_seen,
        "threat_domains_30d": len([domain for domain in threat_domains if domain]),
        "recent_profiles": profiles[:8],
        "scoring_note": "Risk scores combine deterministic DNS, registration, certificate, similarity, volatility and verified threat evidence. Unavailable signals are shown rather than guessed.",
    }


@router.post("/nexus-dns/intelligence/analyse")
async def analyse_nexus_dns_domain(payload: NexusDnsDomainAnalysisPayload, current_user: dict = Depends(get_current_user)):
    domain = _normalise_domain(payload.domain)
    resolved, certificate, rdap = await asyncio.gather(
        asyncio.to_thread(_resolve_records_sync, domain),
        asyncio.to_thread(_certificate_info_sync, domain),
        _rdap_info(domain),
    )
    now = _now()
    previous = await db.nexus_dns_domain_profiles.find_one({"domain": domain}, {"_id": 0})
    first_event = await db.nexus_dns_events.find_one({"domain": domain}, {"_id": 0, "observed_at": 1}, sort=[("observed_at", 1)])
    record_alert_count = await db.dns_alerts.count_documents({"domain": domain})
    verified_threats = await db.nexus_dns_events.count_documents({"domain": domain, "severity": {"$in": ["critical", "high"]}})
    affected_clients = await db.nexus_dns_events.distinct("client_id", {"domain": domain})
    monitored = await db.dns_domains.find({}, {"_id": 0, "domain": 1, "client_name": 1}).to_list(500)
    suspicious_words = [word for word in ("login", "verify", "secure", "account", "mfa", "password", "invoice", "payment") if word in domain.split(".")[0]]
    primary_label = domain.split(".")[0]
    entropy = _entropy(primary_label)
    score = 0
    signals = []

    def add_signal(key: str, label: str, points: int, evidence, confidence: str = "deterministic"):
        nonlocal score
        score += points
        signals.append({"key": key, "label": label, "points": points, "evidence": evidence, "confidence": confidence})

    if verified_threats:
        add_signal("verified_threat", "Verified Nexus threat evidence", min(50, 35 + verified_threats * 5), f"{verified_threats} high or critical event(s)")
    age_days = rdap.get("age_days")
    if age_days is not None and age_days <= 7:
        add_signal("domain_age", "Very recently registered domain", 25, f"{age_days} day(s) old")
    elif age_days is not None and age_days <= 30:
        add_signal("domain_age", "Newly registered domain", 15, f"{age_days} day(s) old")
    if suspicious_words:
        add_signal("sensitive_terms", "Credential or payment language", min(18, 6 + len(suspicious_words) * 3), ", ".join(suspicious_words))
    if entropy >= 3.7 and len(primary_label) >= 16:
        add_signal("label_entropy", "Unusually complex domain label", 10, f"Entropy {entropy}; {len(primary_label)} characters")
    if domain.startswith("xn--"):
        add_signal("punycode", "Internationalised lookalike potential", 18, "Punycode label")
    if record_alert_count:
        add_signal("record_volatility", "DNS record volatility", min(12, record_alert_count * 4), f"{record_alert_count} recorded change alert(s)")
    if certificate.get("present") and certificate.get("age_days") is not None and certificate["age_days"] <= 7:
        add_signal("certificate_age", "Recently issued TLS certificate", 8, f"{certificate['age_days']} day(s) old")
    import difflib
    similarities = []
    for item in monitored:
        protected = item.get("domain") or ""
        protected_label = protected.split(".")[0]
        protected_tld = protected.split(".")[-1] if "." in protected else ""
        candidate_tld = domain.split(".")[-1]
        ratio = difflib.SequenceMatcher(None, primary_label, protected_label).ratio()
        length_delta = abs(len(primary_label) - len(protected_label))
        same_tld = candidate_tld == protected_tld
        if protected != domain and ratio >= 0.84 and length_delta <= 2 and same_tld:
            similarities.append({
                "protected_domain": protected,
                "similarity": round(ratio * 100),
                "client_name": item.get("client_name", ""),
                "evidence": f"Registrable label similarity {round(ratio * 100)}%; same .{candidate_tld} suffix; length delta {length_delta}",
            })
    if similarities:
        best = max(similarities, key=lambda item: item["similarity"])
        add_signal("lookalike_similarity", "Similar to a monitored client domain", 22, f"{best['similarity']}% similar to {best['protected_domain']}")
    score = min(100, score)
    risk_level = "high" if score >= 70 else "elevated" if score >= 45 else "watch" if score >= 20 else "low"
    recommendation = "Block and investigate through an approval-gated incident playbook." if score >= 70 else "Keep in audit while the technician verifies the owner and business purpose." if score >= 20 else "No deterministic high-risk signal; continue normal visibility monitoring."
    profile = {
        "id": (previous or {}).get("id") or f"ndns-domain-{uuid.uuid4().hex[:10]}",
        "domain": domain,
        "client_id": payload.client_id,
        "risk_score": score,
        "risk_level": risk_level,
        "signals": signals,
        "records": resolved.get("records"),
        "record_errors": resolved.get("errors"),
        "response_codes": resolved.get("response_codes"),
        "dnssec_present": resolved.get("dnssec_present"),
        "registration": rdap,
        "certificate": certificate,
        "similarities": sorted(similarities, key=lambda item: item["similarity"], reverse=True)[:8],
        "record_alert_count": record_alert_count,
        "verified_threat_events": verified_threats,
        "affected_tenant_count": len([value for value in affected_clients if value]),
        "first_seen_at": (previous or {}).get("first_seen_at") or (first_event or {}).get("observed_at") or now,
        "last_seen_at": now,
        "analysed_at": now,
        "analysed_by": _actor(current_user),
        "recommended_action": recommendation,
        "uncertain_action": "audit",
    }
    await db.nexus_dns_domain_profiles.update_one({"domain": domain}, {"$set": profile}, upsert=True)
    await _record_domain_timeline(domain, "risk_analysis", f"Domain risk analysed as {risk_level} ({score}/100)", {"score": score, "signals": signals})
    await _dns_audit("domain_risk_analysed", current_user, {"domain": domain, "risk_score": score, "risk_level": risk_level})
    return profile


@router.get("/nexus-dns/domains/{domain}/timeline")
async def nexus_dns_domain_timeline(domain: str, current_user: dict = Depends(get_current_user)):
    value = _normalise_domain(domain)
    stored = await db.nexus_dns_domain_timeline.find({"domain": value}, {"_id": 0}).sort("occurred_at", -1).to_list(500)
    query_events = await db.nexus_dns_events.find({"domain": value}, {"_id": 0}).sort("observed_at", -1).to_list(500)
    record_alerts = await db.dns_alerts.find({"domain": value}, {"_id": 0}).sort("detected_at", -1).to_list(100)
    timeline = list(stored)
    timeline.extend({
        "id": event.get("id"),
        "domain": value,
        "event_type": "dns_query",
        "summary": f"{event.get('action', 'observed').title()} for {event.get('device_name') or 'unknown endpoint'}",
        "occurred_at": event.get("observed_at"),
        "details": event,
    } for event in query_events)
    timeline.extend({
        "id": alert.get("id"),
        "domain": value,
        "event_type": "record_change",
        "summary": alert.get("message"),
        "occurred_at": alert.get("detected_at"),
        "details": alert,
    } for alert in record_alerts)
    timeline.sort(key=lambda item: item.get("occurred_at") or "", reverse=True)
    return {"domain": value, "events": timeline, "count": len(timeline)}


@router.post("/nexus-dns/lookalikes/scan")
async def scan_nexus_dns_lookalikes(payload: NexusDnsDomainAnalysisPayload, current_user: dict = Depends(get_current_user)):
    domain = _normalise_domain(payload.domain)
    variants = _lookalike_variants(domain)[:16]
    resolutions = await asyncio.gather(*(asyncio.to_thread(_resolve_records_sync, item["domain"]) for item in variants))
    findings = []
    for item, result in zip(variants, resolutions):
        records = result.get("records") or {}
        active = any(records.get(record_type) for record_type in ("A", "AAAA", "MX", "NS", "CNAME"))
        finding = {
            "id": f"ndns-lookalike-{uuid.uuid4().hex[:10]}",
            "protected_domain": domain,
            "domain": item["domain"],
            "client_id": payload.client_id,
            "reason": item["reason"],
            "active": active,
            "signals": [record_type for record_type, values in records.items() if values],
            "status": "review" if active else "not_observed",
            "checked_at": _now(),
        }
        findings.append(finding)
        if active:
            await db.nexus_dns_lookalikes.update_one(
                {"protected_domain": domain, "domain": item["domain"]},
                {"$set": finding},
                upsert=True,
            )
            await _record_domain_timeline(item["domain"], "lookalike_detected", f"Active lookalike of {domain} detected", finding)
    await _dns_audit("lookalike_scan_completed", current_user, {"protected_domain": domain, "active_findings": sum(1 for item in findings if item["active"])})
    return {"protected_domain": domain, "findings": findings, "active_count": sum(1 for item in findings if item["active"])}


@router.get("/nexus-dns/lookalikes")
async def nexus_dns_lookalikes(current_user: dict = Depends(get_current_user)):
    return await db.nexus_dns_lookalikes.find({}, {"_id": 0}).sort("checked_at", -1).to_list(500)


@router.get("/nexus-dns/shadow-apps")
async def nexus_dns_shadow_apps(current_user: dict = Depends(get_current_user)):
    catalog = [
        {"id": "dropbox", "name": "Dropbox", "category": "File sharing", "domains": ["dropbox.com", "dropboxapi.com"]},
        {"id": "google-drive", "name": "Personal Google Drive", "category": "Personal storage", "domains": ["drive.google.com"]},
        {"id": "chatgpt", "name": "ChatGPT", "category": "Generative AI", "domains": ["chatgpt.com", "openai.com"]},
        {"id": "crypto", "name": "Cryptocurrency services", "category": "Cryptocurrency", "domains": ["coinbase.com", "binance.com"]},
        {"id": "remote-tools", "name": "Unapproved remote access", "category": "Remote access", "domains": ["anydesk.com", "teamviewer.com"]},
        {"id": "personal-email", "name": "Personal webmail", "category": "Personal email", "domains": ["gmail.com", "mail.yahoo.com", "outlook.live.com"]},
        {"id": "wetransfer", "name": "WeTransfer", "category": "File sharing", "domains": ["wetransfer.com"]},
    ]
    events = await db.nexus_dns_events.find({}, {"_id": 0}).sort("observed_at", -1).to_list(5000)
    decisions = {item["app_id"]: item for item in await db.nexus_dns_shadow_decisions.find({}, {"_id": 0}).to_list(500)}
    rows = []
    for app in catalog:
        matched = [event for event in events if any((event.get("domain") or "") == suffix or (event.get("domain") or "").endswith(f".{suffix}") for suffix in app["domains"])]
        if not matched and app["id"] not in decisions:
            continue
        clients = sorted({event.get("client_name") for event in matched if event.get("client_name")})
        devices = sorted({event.get("device_name") for event in matched if event.get("device_name")})
        decision = decisions.get(app["id"]) or {}
        rows.append({
            **app,
            "query_count": len(matched),
            "client_count": len(clients),
            "device_count": len(devices),
            "clients": clients,
            "devices": devices,
            "first_seen": min((event.get("observed_at") for event in matched if event.get("observed_at")), default=None),
            "last_seen": max((event.get("observed_at") for event in matched if event.get("observed_at")), default=None),
            "decision": decision.get("decision", "review"),
            "owner": decision.get("owner", ""),
            "inventory_linked": decision.get("add_to_inventory", False),
        })
    return {"applications": rows, "unknown_count": sum(1 for row in rows if row["decision"] == "review"), "catalog_size": len(catalog)}


@router.post("/nexus-dns/shadow-apps/{app_id}/decision")
async def decide_nexus_dns_shadow_app(app_id: str, payload: NexusDnsShadowDecisionPayload, current_user: dict = Depends(get_current_user)):
    decision = {
        "id": f"ndns-saas-{uuid.uuid4().hex[:10]}",
        "app_id": app_id,
        **payload.model_dump(),
        "decided_at": _now(),
        "decided_by": _actor(current_user),
    }
    await db.nexus_dns_shadow_decisions.update_one({"app_id": app_id}, {"$set": decision}, upsert=True)
    if payload.add_to_inventory:
        await db.client_applications.update_one(
            {"source": "nexus_dns", "source_id": app_id},
            {"$set": {
                "id": f"client-app-{uuid.uuid4().hex[:10]}",
                "name": app_id.replace("-", " ").title(),
                "source": "nexus_dns",
                "source_id": app_id,
                "status": "approved" if payload.decision == "approve" else payload.decision,
                "owner": payload.owner,
                "updated_at": _now(),
            }},
            upsert=True,
        )
    await _dns_audit("shadow_app_decision", current_user, {"app_id": app_id, "decision": payload.decision, "owner": payload.owner, "inventory": payload.add_to_inventory})
    decision.pop("_id", None)
    return decision


@router.get("/nexus-dns/incidents")
async def nexus_dns_incidents(current_user: dict = Depends(get_current_user)):
    events = await db.nexus_dns_events.find({"severity": {"$in": ["critical", "high", "medium"]}}, {"_id": 0}).sort("observed_at", 1).to_list(5000)
    groups: dict[str, list[dict]] = defaultdict(list)
    for event in events:
        domain = event.get("domain")
        if domain:
            groups[domain].append(event)
    incidents = []
    for domain, group in groups.items():
        clients = sorted({event.get("client_name") for event in group if event.get("client_name")})
        endpoints = sorted({event.get("device_name") for event in group if event.get("device_name")})
        users = sorted({event.get("user_name") for event in group if event.get("user_name")})
        incidents.append({
            "id": f"ndns-cluster-{uuid.uuid5(uuid.NAMESPACE_DNS, domain)}",
            "domain": domain,
            "title": f"Possible DNS threat campaign affecting {len(clients) or 1} client(s) and {len(endpoints)} endpoint(s)",
            "severity": "critical" if any(event.get("severity") == "critical" for event in group) else "high",
            "event_count": len(group),
            "clients": clients,
            "endpoints": endpoints,
            "users": users,
            "first_seen": min((event.get("observed_at") for event in group if event.get("observed_at")), default=None),
            "last_seen": max((event.get("observed_at") for event in group if event.get("observed_at")), default=None),
            "patient_zero": next((event.get("device_name") for event in group if event.get("device_name")), "Unknown"),
            "ticket_numbers": sorted({event.get("ticket_number") for event in group if event.get("ticket_number")}),
            "actions_taken": sorted({event.get("action") for event in group if event.get("action")}),
        })
    incidents.sort(key=lambda item: item.get("last_seen") or "", reverse=True)
    return incidents


@router.post("/nexus-dns/incidents/{incident_id}/playbook/preview")
async def preview_nexus_dns_incident_playbook(incident_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    domain = _normalise_domain(data.get("domain") or "")
    events = await db.nexus_dns_events.find({"domain": domain}, {"_id": 0}).to_list(5000)
    users = sorted({event.get("user_name") for event in events if event.get("user_name")})
    devices = sorted({event.get("device_name") for event in events if event.get("device_name")})
    steps = [
        {"order": 1, "action": "Block the domain in the affected tenant policy", "approval": True, "available": _resolver_ready(await _dns_settings()), "owner": "Nexus DNS"},
        {"order": 2, "action": f"Run endpoint scan on {len(devices)} affected device(s)", "approval": True, "available": bool(devices), "owner": "Nexus Shield"},
        {"order": 3, "action": "Search Microsoft 365 messages for the matching URL", "approval": False, "available": True, "owner": "Nexus Control Plane"},
        {"order": 4, "action": f"Revoke sessions for {len(users)} affected user(s)", "approval": True, "available": bool(users), "owner": "Nexus Control Plane"},
        {"order": 5, "action": "Check mailbox forwarding and inbox rules", "approval": False, "available": bool(users), "owner": "Nexus Control Plane"},
        {"order": 6, "action": "Create one clustered incident ticket with preserved evidence", "approval": False, "available": True, "owner": "Tickets"},
        {"order": 7, "action": "Notify the MSP security team", "approval": False, "available": True, "owner": "Notifications"},
    ]
    preview = {
        "id": f"ndns-playbook-{uuid.uuid4().hex[:10]}",
        "incident_id": incident_id,
        "domain": domain,
        "will_execute": False,
        "risk": "high",
        "requires_approval": True,
        "steps": steps,
        "configuration_gaps": [step["action"] for step in steps if not step["available"]],
        "rollback": [
            "Remove only the incident-scoped tenant block after verified false-positive approval.",
            "Release isolated endpoints only after scans and identity review complete.",
            "Do not restore revoked sessions; require a fresh authenticated sign-in.",
            "Retain the incident, change approval, exceptions and action outputs.",
        ],
        "created_at": _now(),
        "created_by": _actor(current_user),
    }
    await db.nexus_dns_playbook_previews.insert_one(preview)
    preview.pop("_id", None)
    await _dns_audit("incident_playbook_previewed", current_user, {"incident_id": incident_id, "domain": domain})
    return preview


@router.post("/nexus-dns/policies/{policy_id}/forecast")
async def forecast_nexus_dns_policy(policy_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    policy = await db.nexus_dns_policies.find_one({"id": policy_id}, {"_id": 0})
    if not policy:
        raise HTTPException(404, "Nexus DNS policy not found")
    days = min(max(int(data.get("days") or 7), 1), 30)
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    events = await db.nexus_dns_events.find({"observed_at": {"$gte": since}}, {"_id": 0}).to_list(20_000)
    would_block = []
    categories = policy.get("categories") or {}
    for event in events:
        domain = event.get("domain") or ""
        category = str(event.get("category") or "").replace(" ", "_").lower()
        if domain in (policy.get("allow_domains") or []):
            continue
        if domain in (policy.get("block_domains") or []) or categories.get(category) == "block":
            would_block.append(event)
    domains = Counter(event.get("domain") for event in would_block if event.get("domain"))
    endpoints = {event.get("device_id") or event.get("device_name") for event in would_block if event.get("device_id") or event.get("device_name")}
    clients = {event.get("client_id") or event.get("client_name") for event in would_block if event.get("client_id") or event.get("client_name")}
    result = {
        "policy_id": policy_id,
        "days": days,
        "query_count": len(events),
        "would_block_queries": len(would_block),
        "affected_endpoints": len(endpoints),
        "affected_clients": len(clients),
        "top_domains": [{"domain": domain, "count": count} for domain, count in domains.most_common(10)],
        "will_execute": False,
        "note": "Historical forecast only. No resolver or endpoint policy was changed.",
        "generated_at": _now(),
    }
    await db.nexus_dns_policy_forecasts.insert_one({"id": f"ndns-forecast-{uuid.uuid4().hex[:10]}", **result, "generated_by": _actor(current_user)})
    await _dns_audit("policy_forecast_generated", current_user, {"policy_id": policy_id, "days": days, "would_block": len(would_block)})
    return result


@router.get("/nexus-dns/private-zones")
async def nexus_dns_private_zones(client_id: str = Query(default="", max_length=200), current_user: dict = Depends(get_current_user)):
    query = {"client_id": client_id} if client_id else {}
    return await db.nexus_dns_private_zones.find(query, {"_id": 0}).sort("name", 1).to_list(500)


@router.post("/nexus-dns/private-zones")
async def create_nexus_dns_private_zone(payload: NexusDnsPrivateZonePayload, current_user: dict = Depends(get_current_user)):
    zone = _normalise_domain(payload.zone)
    client = await db.clients.find_one({"id": payload.client_id}, {"_id": 0, "name": 1})
    if not client:
        raise HTTPException(404, "Client not found")
    record = {
        "id": f"ndns-zone-{uuid.uuid4().hex[:10]}",
        **payload.model_dump(),
        "zone": zone,
        "client_name": client.get("name"),
        "tenant_isolation_key": payload.client_id,
        "created_at": _now(),
        "created_by": _actor(current_user),
    }
    await db.nexus_dns_private_zones.insert_one(record)
    record.pop("_id", None)
    await _dns_audit("private_zone_created", current_user, {"zone_id": record["id"], "client_id": payload.client_id, "zone": zone})
    return record


@router.post("/nexus-dns/toolkit/run")
async def run_nexus_dns_toolkit(payload: NexusDnsToolkitPayload, current_user: dict = Depends(get_current_user)):
    domain = _normalise_domain(payload.domain)
    started = datetime.now(timezone.utc)
    if payload.tool == "compare":
        default, cloudflare, google = await asyncio.gather(
            asyncio.to_thread(_resolve_records_sync, domain),
            asyncio.to_thread(_resolve_records_sync, domain, ["1.1.1.1"]),
            asyncio.to_thread(_resolve_records_sync, domain, ["8.8.8.8"]),
        )
        result = {"system": default, "cloudflare": cloudflare, "google": google}
    else:
        resolution = await asyncio.to_thread(_resolve_records_sync, domain)
        if payload.tool == "cname":
            result = {"cname_chain": resolution["records"].get("CNAME", []), "terminal_records": resolution["records"].get("A", []) + resolution["records"].get("AAAA", []), "errors": resolution["errors"]}
        elif payload.tool == "dnssec":
            result = {"dnssec_present": resolution["dnssec_present"], "response_codes": resolution["response_codes"], "note": "DNSKEY presence is reported; full validating-resolver attestation remains required before enforcement."}
        elif payload.tool in {"policy", "categorise"}:
            policy = await db.nexus_dns_policies.find_one({"id": payload.policy_id}, {"_id": 0}) if payload.policy_id else None
            profile = await db.nexus_dns_domain_profiles.find_one({"domain": domain}, {"_id": 0})
            action = "allow"
            matched = "No matching explicit rule"
            if policy:
                if domain in (policy.get("allow_domains") or []):
                    matched, action = "Explicit allow-domain rule", "allow"
                elif domain in (policy.get("block_domains") or []):
                    matched, action = "Explicit block-domain rule", "block"
                elif profile and profile.get("risk_score", 0) >= 70:
                    matched, action = "High deterministic risk score", policy.get("uncertain_domain_action", "audit")
            result = {"policy": policy.get("name") if policy else None, "action": action, "matched_rule": matched, "risk_profile": profile, "resolution": resolution}
        else:
            result = resolution
    duration_ms = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
    run = {
        "id": f"ndns-tool-{uuid.uuid4().hex[:10]}",
        "domain": domain,
        "tool": payload.tool,
        "client_id": payload.client_id,
        "duration_ms": duration_ms,
        "result": result,
        "ran_at": _now(),
        "ran_by": _actor(current_user),
        "changed_endpoint": False,
    }
    await db.nexus_dns_toolkit_runs.insert_one(run)
    run.pop("_id", None)
    await _dns_audit("diagnostic_run", current_user, {"tool": payload.tool, "domain": domain, "duration_ms": duration_ms})
    return run


@router.get("/nexus-dns/resolver-metrics")
async def nexus_dns_resolver_metrics(current_user: dict = Depends(get_current_user)):
    samples = await db.nexus_dns_resolver_samples.find({}, {"_id": 0}).sort("measured_at", -1).to_list(5000)
    if not samples:
        return {
            "status": "awaiting_probe",
            "samples": [],
            "summary": {"latency_ms": None, "cache_hit_rate": None, "upstream_failures": 0, "dnssec_failures": 0, "fallbacks": 0},
            "note": "Performance remains unreported until a trusted resolver or endpoint probe submits measurements.",
        }
    latest = samples[0]
    return {
        "status": latest.get("status", "unknown"),
        "samples": samples[:100],
        "summary": {
            "latency_ms": round(sum(float(item.get("latency_ms") or 0) for item in samples) / len(samples), 1),
            "cache_hit_rate": round(sum(float(item.get("cache_hit_rate") or 0) for item in samples) / len(samples), 1),
            "upstream_failures": sum(int(item.get("upstream_failures") or 0) for item in samples),
            "dnssec_failures": sum(int(item.get("dnssec_failures") or 0) for item in samples),
            "fallbacks": sum(int(item.get("fallbacks") or 0) for item in samples),
        },
    }


@router.get("/nexus-dns/service")
async def nexus_dns_service(current_user: dict = Depends(get_current_user)):
    settings = await _dns_settings()
    agents = await db.nexus_agents.count_documents({"is_active": True, "nexus_dns.enrolled": True})
    users = len(await db.nexus_dns_events.distinct("user_name", {"user_name": {"$nin": [None, ""]}}))
    sites = await db.nexus_dns_private_zones.distinct("client_id")
    tiers = [
        {"id": "essentials", "name": "Nexus DNS Essentials", "features": ["Malware and phishing policy", "Nexus Agent coverage", "Multi-tenant policy", "Basic reporting"]},
        {"id": "business", "name": "Nexus DNS Business", "features": ["Everything in Essentials", "Content categories", "User and device conditions", "SaaS discovery", "Network mode", "Custom block pages"]},
        {"id": "secure", "name": "Nexus DNS Secure", "features": ["Everything in Business", "Tunnelling analytics", "Lookalike monitoring", "Approval-gated containment", "Microsoft 365 correlation", "Advanced hunting", "Extended retention"]},
    ]
    usage = {"endpoint": agents, "user": users, "site": len([site for site in sites if site])}
    return {
        "tier": settings.get("service_tier", "essentials"),
        "billing_model": settings.get("billing_model", "endpoint"),
        "billable_quantity": usage.get(settings.get("billing_model", "endpoint"), 0),
        "usage": usage,
        "tiers": tiers,
        "reconciliation_status": "ready" if usage.get(settings.get("billing_model", "endpoint"), 0) else "awaiting_usage",
    }


@router.get("/nexus-dns/response-codes")
async def nexus_dns_response_codes(current_user: dict = Depends(get_current_user)):
    return [
        {"key": "blocked_policy", "rcode": "REFUSED", "ede": 15, "label": "Blocked by policy", "explanation": "The resolver blocked the destination under an operator security policy."},
        {"key": "nxdomain", "rcode": "NXDOMAIN", "ede": None, "label": "Domain does not exist", "explanation": "The authoritative DNS hierarchy reports no such domain."},
        {"key": "upstream_timeout", "rcode": "SERVFAIL", "ede": 23, "label": "Upstream timeout", "explanation": "The resolver could not obtain a timely upstream response."},
        {"key": "dnssec_failure", "rcode": "SERVFAIL", "ede": 6, "label": "DNSSEC validation failed", "explanation": "The validating resolver considers the answer bogus."},
        {"key": "malware", "rcode": "REFUSED", "ede": 15, "label": "Malware classification", "explanation": "A deterministic threat feed or verified incident matched the domain."},
        {"key": "client_override", "rcode": "NOERROR", "ede": None, "label": "Client override", "explanation": "A scoped, audited allow rule overrode the inherited decision."},
        {"key": "resolver_unavailable", "rcode": "SERVFAIL", "ede": 14, "label": "Resolver unavailable", "explanation": "The assigned resolver was not ready to answer."},
    ]


@router.get("/nexus-dns/tunnelling")
async def nexus_dns_tunnelling(current_user: dict = Depends(get_current_user)):
    events = await db.nexus_dns_events.find({}, {"_id": 0}).sort("observed_at", -1).to_list(20_000)
    grouped: dict[str, list[dict]] = defaultdict(list)
    for event in events:
        domain = event.get("domain")
        if domain:
            grouped[domain].append(event)
    findings = []
    for domain, group in grouped.items():
        label = domain.split(".")[0]
        entropy = _entropy(label)
        txt_queries = sum(1 for event in group if str(event.get("record_type") or "").upper() in {"TXT", "NULL"})
        long_queries = sum(1 for event in group if len(str(event.get("query_name") or event.get("domain") or "")) >= 80)
        score = min(100, round(entropy * 12 + min(len(group), 50) + txt_queries * 5 + long_queries * 8))
        if score < 55:
            continue
        findings.append({
            "id": f"ndns-tunnel-{uuid.uuid5(uuid.NAMESPACE_DNS, domain)}",
            "domain": domain,
            "score": score,
            "query_count": len(group),
            "label_entropy": entropy,
            "txt_or_null_queries": txt_queries,
            "long_queries": long_queries,
            "devices": sorted({event.get("device_name") for event in group if event.get("device_name")}),
            "clients": sorted({event.get("client_name") for event in group if event.get("client_name")}),
            "first_seen": min((event.get("observed_at") for event in group if event.get("observed_at")), default=None),
            "last_seen": max((event.get("observed_at") for event in group if event.get("observed_at")), default=None),
            "explanation": "Heuristic only: score combines query volume, label entropy, long query names and TXT/NULL use. Confirm with endpoint evidence before containment.",
        })
    findings.sort(key=lambda item: item["score"], reverse=True)
    return {
        "status": "ready" if events else "awaiting_telemetry",
        "findings": findings,
        "events_analysed": len(events),
        "note": "Nexus DNS does not claim tunnelling detection until endpoint or resolver query telemetry is present.",
    }


@router.get("/nexus-dns/unmanaged-devices")
async def nexus_dns_unmanaged_devices(current_user: dict = Depends(get_current_user)):
    events = await db.nexus_dns_events.find({"network_mode": True}, {"_id": 0}).sort("observed_at", -1).to_list(20_000)
    agents = await db.nexus_agents.find({}, {"_id": 0, "device_id": 1, "hostname": 1, "mac_address": 1}).to_list(10_000)
    known = {
        str(value).lower()
        for agent in agents
        for value in (agent.get("device_id"), agent.get("hostname"), agent.get("mac_address"))
        if value
    }
    grouped: dict[str, list[dict]] = defaultdict(list)
    for event in events:
        identity = str(event.get("device_id") or event.get("mac_address") or event.get("source_ip") or "").lower()
        if identity and identity not in known:
            grouped[identity].append(event)
    rows = []
    for identity, group in grouped.items():
        domains = Counter(event.get("domain") for event in group if event.get("domain"))
        hints = {str(event.get("device_type") or "") for event in group if event.get("device_type")}
        rows.append({
            "id": f"ndns-unmanaged-{uuid.uuid5(uuid.NAMESPACE_DNS, identity)}",
            "identity": identity,
            "client_id": next((event.get("client_id") for event in group if event.get("client_id")), ""),
            "client_name": next((event.get("client_name") for event in group if event.get("client_name")), ""),
            "device_type": next(iter(hints), "Unclassified network device"),
            "query_count": len(group),
            "top_domains": [{"domain": domain, "count": count} for domain, count in domains.most_common(5)],
            "first_seen": min((event.get("observed_at") for event in group if event.get("observed_at")), default=None),
            "last_seen": max((event.get("observed_at") for event in group if event.get("observed_at")), default=None),
        })
    rows.sort(key=lambda item: item.get("last_seen") or "", reverse=True)
    return {
        "status": "ready" if events else "awaiting_network_mode",
        "devices": rows,
        "note": "Identification uses network-mode DNS metadata and is intentionally separated from managed Nexus Agent inventory.",
    }


@router.get("/nexus-dns/access-requests")
async def nexus_dns_access_requests(current_user: dict = Depends(get_current_user)):
    return await db.nexus_dns_access_requests.find({}, {"_id": 0}).sort("requested_at", -1).to_list(500)


@router.post("/nexus-dns/access-requests")
async def create_nexus_dns_access_request(payload: NexusDnsAccessRequestPayload, current_user: dict = Depends(get_current_user)):
    settings = await _dns_settings()
    domain = _normalise_domain(payload.domain)
    status = "pending"
    if settings.get("block_page_require_mfa") and not payload.mfa_verified:
        status = "mfa_required"
    record = {
        "id": f"ndns-access-{uuid.uuid4().hex[:10]}",
        **payload.model_dump(),
        "domain": domain,
        "status": status,
        "requested_at": _now(),
        "requested_by": _actor(current_user),
        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=payload.requested_minutes)).isoformat(),
    }
    await db.nexus_dns_access_requests.insert_one(record)
    record.pop("_id", None)
    await _record_domain_timeline(domain, "access_requested", f"Temporary access requested for {payload.requested_minutes} minutes", record)
    await _dns_audit("access_requested", current_user, {"request_id": record["id"], "domain": domain, "status": status})
    return record

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
