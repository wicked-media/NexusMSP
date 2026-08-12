"""Nexus DMARC: evidence-first domain authentication control plane.

This is the Nexus-owned record of domain posture and aggregate-report evidence.
Suped can remain an upstream source during migration, but reports and policy
state here are client-scoped and never alter public DNS without a separately
approved, audited change workflow.
"""
from datetime import datetime, timezone
from typing import Any
import uuid
from defusedxml import ElementTree
import hmac
import os
import dns.resolver

from fastapi import APIRouter, Depends, Header, HTTPException, Query
import re

from app.auth import get_current_user
from app.database import db
from app.services.activity import log_activity
from app.services.scope_permissions import assert_client_scope, scoped_query

router = APIRouter()
POLICIES = {"none", "quarantine", "reject"}
HOSTNAME_RE = re.compile(r"^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$", re.IGNORECASE)
SPF_LOOKUP_RE = re.compile(r"\b(?:include|a|mx|ptr|exists|redirect)[:=]?[^\s]*", re.IGNORECASE)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _status(value: Any) -> str:
    return str(value or "unknown").lower() if str(value or "unknown").lower() in {"pass", "fail", "unknown"} else "unknown"


def _spf_resolver() -> dns.resolver.Resolver:
    resolver = dns.resolver.Resolver(configure=True)
    configured = [value.strip() for value in os.getenv("NEXUS_DNS_RESOLVERS", "").split(",") if value.strip()]
    if configured:
        resolver.nameservers = configured
    resolver.timeout = 3
    resolver.lifetime = 5
    return resolver


@router.get("/nexus-dmarc/settings")
async def get_nexus_dmarc_settings(current_user: dict = Depends(get_current_user)):
    settings = await db.nexus_dmarc_settings.find_one({"id": "global"}, {"_id": 0}) or {}
    return {"receiver_domain": settings.get("receiver_domain", ""), "configured": bool(settings.get("receiver_domain")), "guidance": "Use a DNS domain you own and route it to the secured Nexus DMARC aggregate-report receiver before registering client domains."}


@router.put("/nexus-dmarc/settings")
async def save_nexus_dmarc_settings(data: dict[str, Any], current_user: dict = Depends(get_current_user)):
    receiver_domain = str(data.get("receiver_domain") or "").strip().lower().removeprefix("https://").split("/")[0]
    if not HOSTNAME_RE.fullmatch(receiver_domain):
        raise HTTPException(status_code=422, detail="Enter a valid report-receiver hostname, such as reports.your-nexus-domain.com")
    now = _now()
    record = {"id": "global", "receiver_domain": receiver_domain, "updated_at": now, "updated_by": current_user.get("name") or current_user.get("email") or "Authenticated technician"}
    await db.nexus_dmarc_settings.update_one({"id": "global"}, {"$set": record, "$setOnInsert": {"created_at": now}}, upsert=True)
    await log_activity(current_user, "nexus_dmarc_receiver_configured", "nexus_dmarc_settings", "global", receiver_domain, "Configured Nexus DMARC aggregate-report receiver domain", metadata={"external_changes": False})
    return {"message": "Nexus DMARC report receiver configured", "settings": record}


@router.get("/nexus-dmarc/overview")
async def nexus_dmarc_overview(client_id: str = Query(default=""), current_user: dict = Depends(get_current_user)):
    if client_id:
        await assert_client_scope(current_user, client_id, operation="nexus_dmarc_overview")
    query = scoped_query(current_user, {"client_id": client_id} if client_id else {})
    domains = await db.nexus_dmarc_domains.find(query, {"_id": 0}).sort("domain", 1).to_list(1000)
    reports = await db.nexus_dmarc_reports.find(query, {"_id": 0}).sort("received_at", -1).to_list(500)
    plans = await db.nexus_spf_change_plans.find(query, {"_id": 0}).sort("created_at", -1).to_list(200)
    protected = [item for item in domains if item.get("policy") in {"quarantine", "reject"}]
    failing = [item for item in domains if item.get("dmarc_status") == "fail" or item.get("spf_status") == "fail" or item.get("dkim_status") == "fail"]
    unauthorized = sum(int(item.get("unauthorized_count") or 0) for item in reports)
    score = None if not domains else max(0, min(100, round(100 - (len(failing) / len(domains) * 45) - (len(domains) - len(protected)) / len(domains) * 20 - min(25, unauthorized / 20))))
    return {
        "summary": {"domains": len(domains), "enforced": len(protected), "attention": len(failing), "unauthorized": unauthorized, "score": score},
        "domains": domains,
        "reports": reports[:100], "spf_change_plans": plans,
        "enforcement_boundary": "Nexus DMARC records posture and report evidence. Publishing or changing DNS requires a separately approved Nexus DNS change.",
        "migration": "Suped may remain connected as an upstream source while Nexus collects its own evidence and policy history.",
    }


@router.post("/nexus-dmarc/domains")
async def register_nexus_dmarc_domain(data: dict[str, Any], current_user: dict = Depends(get_current_user)):
    client_id = str(data.get("client_id") or "").strip()
    domain = str(data.get("domain") or "").strip().lower().removeprefix("https://").split("/")[0]
    if not client_id or not domain or "." not in domain:
        raise HTTPException(status_code=422, detail="A linked client and valid domain are required")
    await assert_client_scope(current_user, client_id, operation="register_nexus_dmarc_domain")
    settings = await db.nexus_dmarc_settings.find_one({"id": "global"}, {"_id": 0, "receiver_domain": 1}) or {}
    receiver_domain = str(settings.get("receiver_domain") or "").strip()
    if not receiver_domain:
        raise HTTPException(status_code=422, detail="Configure an owned Nexus DMARC report-receiver domain before registering client domains")
    existing = await db.nexus_dmarc_domains.find_one({"client_id": client_id, "domain": domain}, {"_id": 0, "id": 1})
    if existing:
        raise HTTPException(status_code=409, detail="This domain is already registered for the client")
    now = _now()
    domain_id = f"dmarc-domain-{uuid.uuid4().hex[:12]}"
    record = {
        "id": domain_id, "client_id": client_id, "client_name": str(data.get("client_name") or ""), "domain": domain,
        "rua_address": f"rua+{domain_id.split('-')[-1]}@{receiver_domain}",
        "policy": "none", "dmarc_status": "unknown", "spf_status": "unknown", "dkim_status": "unknown",
        "source": str(data.get("source") or "nexus"), "created_at": now, "updated_at": now,
        "created_by": current_user.get("name") or current_user.get("email") or "Authenticated technician",
    }
    await db.nexus_dmarc_domains.insert_one(record.copy())
    await log_activity(current_user, "nexus_dmarc_domain_registered", "nexus_dmarc_domain", domain_id, domain, "Registered domain for Nexus DMARC monitoring", metadata={"client_id": client_id, "external_changes": False})
    return {"message": "Nexus DMARC domain registered. Publish the RUA address only through an approved DNS change.", "domain": record}


@router.patch("/nexus-dmarc/domains/{domain_id}")
async def update_nexus_dmarc_domain(domain_id: str, data: dict[str, Any], current_user: dict = Depends(get_current_user)):
    existing = await db.nexus_dmarc_domains.find_one({"id": domain_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Nexus DMARC domain not found")
    await assert_client_scope(current_user, existing.get("client_id"), operation="update_nexus_dmarc_domain")
    policy = str(data.get("policy") or existing.get("policy") or "none").lower()
    if policy not in POLICIES:
        raise HTTPException(status_code=422, detail="DMARC policy must be none, quarantine or reject")
    note = str(data.get("note") or "").strip()
    if policy != existing.get("policy") and not note:
        raise HTTPException(status_code=422, detail="Record an approval note before changing staged policy intent")
    now = _now()
    update = {"policy": policy, "updated_at": now, "policy_note": note or existing.get("policy_note", ""), "policy_updated_by": current_user.get("name") or current_user.get("email") or "Authenticated technician"}
    await db.nexus_dmarc_domains.update_one({"id": domain_id}, {"$set": update, "$push": {"events": {"type": "policy_intent_updated", "policy": policy, "note": note or "No policy change", "at": now}}})
    await log_activity(current_user, "nexus_dmarc_policy_intent_updated", "nexus_dmarc_domain", domain_id, existing.get("domain"), f"Set Nexus DMARC policy intent to {policy}", metadata={"client_id": existing.get("client_id"), "external_changes": False})
    return {"message": "Nexus DMARC policy intent saved. DNS was not changed.", "domain": await db.nexus_dmarc_domains.find_one({"id": domain_id}, {"_id": 0})}


@router.post("/nexus-dmarc/reports")
async def ingest_nexus_dmarc_report(data: dict[str, Any], current_user: dict = Depends(get_current_user)):
    domain_id = str(data.get("domain_id") or "").strip()
    domain = await db.nexus_dmarc_domains.find_one({"id": domain_id}, {"_id": 0})
    if not domain:
        raise HTTPException(status_code=404, detail="Register the domain before ingesting DMARC evidence")
    await assert_client_scope(current_user, domain.get("client_id"), operation="ingest_nexus_dmarc_report")
    now = _now()
    external_report_id = str(data.get("external_report_id") or "").strip()
    if external_report_id:
        duplicate = await db.nexus_dmarc_reports.find_one({"domain_id": domain_id, "external_report_id": external_report_id}, {"_id": 0, "id": 1})
        if duplicate:
            return {"message": "Duplicate DMARC aggregate evidence ignored", "report": duplicate, "duplicate": True}
    total = max(0, int(data.get("message_count") or 0))
    aligned = max(0, min(total, int(data.get("aligned_count") or 0)))
    unauthorized = max(0, min(total, int(data.get("unauthorized_count") or 0)))
    report = {"id": f"dmarc-report-{uuid.uuid4().hex[:12]}", "domain_id": domain_id, "client_id": domain["client_id"], "domain": domain["domain"], "source": str(data.get("source") or "nexus_rua_connector"), "reporter": str(data.get("reporter") or ""), "external_report_id": external_report_id, "message_count": total, "aligned_count": aligned, "unauthorized_count": unauthorized, "spf_status": _status(data.get("spf_status")), "dkim_status": _status(data.get("dkim_status")), "dmarc_status": _status(data.get("dmarc_status")), "received_at": now, "evidence": data.get("evidence") if isinstance(data.get("evidence"), list) else []}
    await db.nexus_dmarc_reports.insert_one(report.copy())
    await db.nexus_dmarc_domains.update_one({"id": domain_id}, {"$set": {"spf_status": report["spf_status"], "dkim_status": report["dkim_status"], "dmarc_status": report["dmarc_status"], "last_report_at": now, "updated_at": now}})
    await log_activity(current_user, "nexus_dmarc_report_ingested", "nexus_dmarc_domain", domain_id, domain["domain"], "Recorded aggregate DMARC evidence", metadata={"client_id": domain["client_id"], "external_changes": False})
    return {"message": "Nexus DMARC aggregate evidence recorded", "report": report}


@router.post("/nexus-dmarc/reports/xml")
async def ingest_nexus_dmarc_xml_report(data: dict[str, Any], current_user: dict = Depends(get_current_user)):
    """Normalise a bounded DMARC RUA aggregate XML report into Nexus evidence.

    The public mail receiver should authenticate its hand-off separately. This
    internal endpoint accepts only a restricted-size payload and never executes
    a policy/DNS action from report content.
    """
    domain_id = str(data.get("domain_id") or "").strip()
    xml_payload = str(data.get("xml") or "")
    if not domain_id or not xml_payload:
        raise HTTPException(status_code=422, detail="Domain and aggregate XML report are required")
    if len(xml_payload.encode("utf-8")) > 1_000_000:
        raise HTTPException(status_code=413, detail="Aggregate report exceeds the 1 MB Nexus ingestion limit")
    domain = await db.nexus_dmarc_domains.find_one({"id": domain_id}, {"_id": 0})
    if not domain:
        raise HTTPException(status_code=404, detail="Register the domain before ingesting aggregate evidence")
    await assert_client_scope(current_user, domain.get("client_id"), operation="ingest_nexus_dmarc_xml_report")
    try:
        root = ElementTree.fromstring(xml_payload)
    except ElementTree.ParseError as exc:
        raise HTTPException(status_code=422, detail="Malformed DMARC aggregate XML report") from exc
    policy_domain = (root.findtext("./policy_published/domain") or "").strip().lower()
    if policy_domain and policy_domain != str(domain.get("domain") or "").lower():
        raise HTTPException(status_code=422, detail="Aggregate report domain does not match the registered Nexus domain")
    total = aligned = unauthorized = 0
    spf_pass = dkim_pass = 0
    sender_observations: dict[tuple[str, str], int] = {}
    for record in root.findall("./record")[:10_000]:
        count_text = record.findtext("./row/count") or "0"
        try:
            count = max(0, int(count_text))
        except ValueError:
            count = 0
        total += count
        dmarc_disposition = (record.findtext("./row/policy_evaluated/disposition") or "none").lower()
        spf = (record.findtext("./row/policy_evaluated/spf") or "fail").lower()
        dkim = (record.findtext("./row/policy_evaluated/dkim") or "fail").lower()
        if spf == "pass": spf_pass += count
        if dkim == "pass": dkim_pass += count
        if spf == "pass" or dkim == "pass": aligned += count
        if dmarc_disposition in {"quarantine", "reject"} or (spf != "pass" and dkim != "pass"): unauthorized += count
        source_ip = (record.findtext("./row/source_ip") or "").strip()
        header_from = (record.findtext("./identifiers/header_from") or policy_domain or domain.get("domain") or "").strip().lower()
        if source_ip:
            key = (source_ip, header_from)
            sender_observations[key] = sender_observations.get(key, 0) + count
    observed = [{"source_ip": ip, "header_from": header_from, "message_count": count} for (ip, header_from), count in sorted(sender_observations.items(), key=lambda item: item[1], reverse=True)[:100]]
    return await ingest_nexus_dmarc_report({"domain_id": domain_id, "source": "nexus_rua_xml", "reporter": root.findtext("./report_metadata/org_name") or "", "external_report_id": root.findtext("./report_metadata/report_id") or "", "message_count": total, "aligned_count": aligned, "unauthorized_count": unauthorized, "spf_status": "pass" if total and spf_pass == total else "fail" if total else "unknown", "dkim_status": "pass" if total and dkim_pass == total else "fail" if total else "unknown", "dmarc_status": "pass" if total and aligned == total else "fail" if total else "unknown", "evidence": [{"record_count": min(len(root.findall("./record")), 10_000), "source_domain": policy_domain or domain.get("domain"), "sender_observations": observed}]} , current_user)


@router.post("/nexus-dmarc/receiver/xml")
async def receive_nexus_dmarc_xml(
    data: dict[str, Any],
    receiver_token: str = Header(default="", alias="X-Nexus-DMARC-Receiver-Token"),
):
    """Private-edge hand-off for an inbound mail provider, not a user session.

    Deploy the receiver token only in the mail-provider edge and API secret
    store. The receiver can ingest evidence but cannot publish DNS, alter
    policies, access tickets, or perform mailbox actions.
    """
    configured = os.getenv("NEXUS_DMARC_RECEIVER_TOKEN", "")
    if not configured:
        raise HTTPException(status_code=503, detail="Nexus DMARC receiver service identity is not configured")
    if not receiver_token or not hmac.compare_digest(receiver_token, configured):
        raise HTTPException(status_code=401, detail="Invalid Nexus DMARC receiver service identity")
    service_actor = {"id": "nexus-dmarc-receiver", "name": "Nexus DMARC Receiver", "role": "admin", "is_admin": True}
    return await ingest_nexus_dmarc_xml_report(data, service_actor)


@router.get("/nexus-dmarc/receiver/readiness")
async def nexus_dmarc_receiver_readiness(current_user: dict = Depends(get_current_user)):
    """Safe operational readiness indicator; never exposes the receiver secret."""
    configured = bool(os.getenv("NEXUS_DMARC_RECEIVER_TOKEN", ""))
    return {
        "receiver_identity_configured": configured,
        "state": "ready_for_edge" if configured else "configuration_required",
        "next_step": "Deploy an inbound mail-provider edge with the receiver token and validate a signed aggregate-report hand-off." if configured else "Set NEXUS_DMARC_RECEIVER_TOKEN in the API and receiver-edge secret stores.",
    }


@router.get("/nexus-dmarc/domains/{domain_id}/sender-candidates")
async def list_nexus_sender_candidates(domain_id: str, current_user: dict = Depends(get_current_user)):
    domain = await db.nexus_dmarc_domains.find_one({"id": domain_id}, {"_id": 0})
    if not domain:
        raise HTTPException(status_code=404, detail="Nexus DMARC domain not found")
    await assert_client_scope(current_user, domain.get("client_id"), operation="list_nexus_sender_candidates")
    reports = await db.nexus_dmarc_reports.find({"domain_id": domain_id}, {"_id": 0, "evidence": 1, "received_at": 1}).sort("received_at", -1).to_list(500)
    candidates: dict[tuple[str, str], int] = {}
    for report in reports:
        for evidence in report.get("evidence") or []:
            for observation in evidence.get("sender_observations") or []:
                key = (str(observation.get("source_ip") or ""), str(observation.get("header_from") or ""))
                if key[0]: candidates[key] = candidates.get(key, 0) + int(observation.get("message_count") or 0)
    return {"domain_id": domain_id, "domain": domain["domain"], "candidates": [{"source_ip": ip, "header_from": header_from, "message_count": count, "status": "unverified"} for (ip, header_from), count in sorted(candidates.items(), key=lambda item: item[1], reverse=True)], "guidance": "Observed sources are candidates, not automatically authorised senders. Confirm the provider and business owner before including a source in SPF or a flattening change plan."}


@router.post("/nexus-dmarc/domains/{domain_id}/spf-assessment")
async def assess_nexus_spf(domain_id: str, data: dict[str, Any], current_user: dict = Depends(get_current_user)):
    """Assess an SPF record and prepare a safe, reviewable flattening plan.

    It intentionally does not resolve providers or update DNS: provider IP
    changes must be refreshed by a verified connector before any DNS change is
    approved. This avoids turning a one-click helper into stale SPF exposure.
    """
    domain = await db.nexus_dmarc_domains.find_one({"id": domain_id}, {"_id": 0})
    if not domain:
        raise HTTPException(status_code=404, detail="Nexus DMARC domain not found")
    await assert_client_scope(current_user, domain.get("client_id"), operation="assess_nexus_spf")
    record = str(data.get("spf_record") or "").strip()
    if not record.lower().startswith("v=spf1"):
        raise HTTPException(status_code=422, detail="Provide one valid SPF TXT record beginning with v=spf1")
    mechanisms = SPF_LOOKUP_RE.findall(record)
    lookup_budget = len(mechanisms)
    include_targets = [token.split(":", 1)[1] for token in record.split() if token.lower().startswith("include:") and ":" in token]
    sender_candidates = [str(item).strip().lower() for item in (data.get("sender_candidates") or []) if str(item).strip()]
    now = _now()
    assessment = {"id": f"spf-assessment-{uuid.uuid4().hex[:12]}", "domain_id": domain_id, "client_id": domain["client_id"], "spf_record": record, "lookup_mechanisms": mechanisms, "lookup_budget": lookup_budget, "status": "hard_limit" if lookup_budget >= 10 else "at_risk" if lookup_budget >= 8 else "healthy", "include_targets": include_targets, "sender_candidates": sender_candidates, "recommendation": "Remove unused senders and separate bulk mail into authenticated subdomains before considering flattening." if lookup_budget >= 8 else "Monitor provider changes and preserve a documented sender inventory.", "created_at": now}
    await db.nexus_spf_assessments.insert_one(assessment.copy())
    await db.nexus_dmarc_domains.update_one({"id": domain_id}, {"$set": {"spf_lookup_budget": lookup_budget, "spf_assessment_at": now, "updated_at": now}})
    await log_activity(current_user, "nexus_spf_assessed", "nexus_dmarc_domain", domain_id, domain["domain"], f"Assessed SPF lookup budget: {lookup_budget}", metadata={"client_id": domain["client_id"], "external_changes": False})
    return {"message": "SPF assessment recorded. No DNS change was made.", "assessment": assessment, "next_step": "Create an approved Nexus DNS change plan only after verifying every active sender and provider IP source."}


@router.get("/nexus-dmarc/domains/{domain_id}/spf-discovery")
async def discover_nexus_spf(domain_id: str, current_user: dict = Depends(get_current_user)):
    """Read public SPF DNS and its bounded include chain; no DNS changes occur."""
    domain = await db.nexus_dmarc_domains.find_one({"id": domain_id}, {"_id": 0})
    if not domain:
        raise HTTPException(status_code=404, detail="Nexus DMARC domain not found")
    await assert_client_scope(current_user, domain.get("client_id"), operation="discover_nexus_spf")
    resolver = _spf_resolver()
    visited: set[str] = set()
    chain: list[dict[str, Any]] = []
    mechanisms: list[str] = []

    def resolve_spf(name: str, depth: int = 0) -> str:
        if depth > 10 or name.lower() in visited:
            return ""
        visited.add(name.lower())
        try:
            answers = resolver.resolve(name, "TXT")
            records = [b"".join(answer.strings).decode("utf-8", errors="replace") for answer in answers]
        except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer, dns.resolver.NoNameservers, dns.exception.Timeout):
            chain.append({"domain": name, "status": "unavailable"})
            return ""
        record = next((value for value in records if value.lower().startswith("v=spf1")), "")
        chain.append({"domain": name, "status": "found" if record else "no_spf", "record": record})
        if record:
            tokens = record.split()
            mechanisms.extend(SPF_LOOKUP_RE.findall(record))
            for token in tokens:
                if token.lower().startswith("include:"):
                    resolve_spf(token.split(":", 1)[1], depth + 1)
        return record

    root_record = resolve_spf(domain["domain"])
    if not root_record:
        raise HTTPException(status_code=422, detail="No public SPF TXT record could be discovered for this domain")
    return {"domain_id": domain_id, "domain": domain["domain"], "spf_record": root_record, "include_chain": chain, "lookup_budget": len(mechanisms), "status": "hard_limit" if len(mechanisms) >= 10 else "at_risk" if len(mechanisms) >= 8 else "healthy", "note": "Discovery is read-only. Verify providers and actual sending evidence before creating any flattening plan."}


@router.get("/nexus-dmarc/domains/{domain_id}/posture-discovery")
async def discover_nexus_dmarc_posture(domain_id: str, current_user: dict = Depends(get_current_user)):
    domain = await db.nexus_dmarc_domains.find_one({"id": domain_id}, {"_id": 0})
    if not domain:
        raise HTTPException(status_code=404, detail="Nexus DMARC domain not found")
    await assert_client_scope(current_user, domain.get("client_id"), operation="discover_nexus_dmarc_posture")
    resolver = _spf_resolver()
    def txt_records(name: str) -> list[str]:
        try:
            return [b"".join(item.strings).decode("utf-8", errors="replace") for item in resolver.resolve(name, "TXT")]
        except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer, dns.resolver.NoNameservers, dns.exception.Timeout):
            return []
    records = txt_records(domain["domain"])
    spf = next((record for record in records if record.lower().startswith("v=spf1")), "")
    dmarc = next((record for record in txt_records(f"_dmarc.{domain['domain']}") if record.lower().startswith("v=dmarc1")), "")
    now = _now()
    update = {"spf_status": "pass" if spf else "fail", "dmarc_status": "pass" if dmarc else "fail", "last_dns_check_at": now, "updated_at": now}
    await db.nexus_dmarc_domains.update_one({"id": domain_id}, {"$set": update})
    return {"domain_id": domain_id, "domain": domain["domain"], "spf_record": spf, "dmarc_record": dmarc, "spf_status": update["spf_status"], "dmarc_status": update["dmarc_status"], "note": "DNS discovery is read-only. DKIM requires known selector discovery from the sending platform or message evidence."}


@router.get("/nexus-dmarc/domains/{domain_id}/spf-flatten-preview")
async def preview_nexus_spf_flattening(domain_id: str, current_user: dict = Depends(get_current_user)):
    """Create a read-only candidate by resolving SPF includes to current IPs.

    Provider ranges can change, therefore the candidate is short-lived evidence
    for a reviewed change request, never a record Nexus publishes automatically.
    """
    domain = await db.nexus_dmarc_domains.find_one({"id": domain_id}, {"_id": 0})
    if not domain:
        raise HTTPException(status_code=404, detail="Nexus DMARC domain not found")
    await assert_client_scope(current_user, domain.get("client_id"), operation="preview_nexus_spf_flattening")
    resolver = _spf_resolver()
    visited: set[str] = set(); addresses: set[str] = set(); unresolved: list[str] = []
    def expand(name: str, depth: int = 0):
        if depth > 10 or name.lower() in visited: return
        visited.add(name.lower())
        try:
            answers = resolver.resolve(name, "TXT")
            record = next((b"".join(item.strings).decode("utf-8", errors="replace") for item in answers if b"".join(item.strings).decode("utf-8", errors="replace").lower().startswith("v=spf1")), "")
        except Exception:
            unresolved.append(name); return
        for token in record.split()[1:]:
            bare = token.lstrip("+-~?")
            if bare.startswith("ip4:") or bare.startswith("ip6:"): addresses.add(bare)
            elif bare.startswith("include:"): expand(bare.split(":", 1)[1], depth + 1)
            elif bare.startswith("a") or bare.startswith("mx") or bare.startswith("ptr") or bare.startswith("exists:"): unresolved.append(token)
    expand(domain["domain"])
    if not addresses:
        raise HTTPException(status_code=422, detail="Nexus could not safely resolve enough static SPF addresses for a flattening preview")
    candidate = "v=spf1 " + " ".join(sorted(addresses)) + " -all"
    return {"domain_id": domain_id, "domain": domain["domain"], "candidate_record": candidate, "resolved_mechanisms": sorted(addresses), "unresolved_mechanisms": unresolved, "remaining_lookup_budget": 0, "expires_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(), "warning": "This is a point-in-time preview. Verify providers, sender evidence and unresolved mechanisms immediately before an approved DNS change."}


@router.post("/nexus-dmarc/domains/{domain_id}/spf-change-plan")
async def create_nexus_spf_change_plan(domain_id: str, data: dict[str, Any], current_user: dict = Depends(get_current_user)):
    domain = await db.nexus_dmarc_domains.find_one({"id": domain_id}, {"_id": 0})
    if not domain:
        raise HTTPException(status_code=404, detail="Nexus DMARC domain not found")
    await assert_client_scope(current_user, domain.get("client_id"), operation="create_nexus_spf_change_plan")
    assessment = await db.nexus_spf_assessments.find_one({"domain_id": domain_id}, {"_id": 0}, sort=[("created_at", -1)])
    if not assessment:
        raise HTTPException(status_code=422, detail="Run an SPF assessment before creating a flattening change plan")
    now = _now()
    plan = {"id": f"spf-plan-{uuid.uuid4().hex[:12]}", "domain_id": domain_id, "client_id": domain["client_id"], "domain": domain["domain"], "status": "draft", "assessment_id": assessment["id"], "lookup_budget": assessment["lookup_budget"], "sender_candidates": assessment.get("sender_candidates") or [], "include_targets": assessment.get("include_targets") or [], "steps": ["Confirm every active sender against DMARC aggregate evidence and business owner approval.", "Resolve provider includes/IP ranges through a verified connector immediately before deployment.", "Generate hosted/flattened candidate SPF record and confirm a single SPF TXT record exists.", "Run lookup-budget and syntax validation, then send controlled real-mail tests.", "Create and approve a Nexus DNS change with rollback to the current SPF record.", "Monitor aggregate evidence after deployment before escalating DMARC enforcement."], "rollback": {"restore_spf_record": assessment["spf_record"]}, "created_at": now, "created_by": current_user.get("name") or current_user.get("email") or "Authenticated technician"}
    await db.nexus_spf_change_plans.insert_one(plan.copy())
    await log_activity(current_user, "nexus_spf_change_plan_created", "nexus_spf_change_plan", plan["id"], domain["domain"], "Created a draft SPF flattening change plan", metadata={"client_id": domain["client_id"], "external_changes": False})
    return {"message": "Draft SPF flattening change plan created. No DNS record was changed.", "plan": plan}


@router.post("/nexus-dmarc/spf-change-plans/{plan_id}/change-request")
async def submit_nexus_spf_change_request(plan_id: str, data: dict[str, Any], current_user: dict = Depends(get_current_user)):
    plan = await db.nexus_spf_change_plans.find_one({"id": plan_id}, {"_id": 0})
    if not plan:
        raise HTTPException(status_code=404, detail="SPF change plan not found")
    await assert_client_scope(current_user, plan.get("client_id"), operation="submit_nexus_spf_change_request")
    if plan.get("change_request_id"):
        existing = await db.change_requests.find_one({"id": plan["change_request_id"]}, {"_id": 0, "id": 1, "status": 1})
        if existing:
            return {"message": "Change request already linked", "change_request": existing, "existing": True}
    now = _now()
    change_id = f"CHG-{uuid.uuid4().hex[:6].upper()}"
    risk = "high" if int(plan.get("lookup_budget") or 0) >= 10 else "medium"
    change = {"id": change_id, "title": f"SPF flattening: {plan['domain']}", "description": "Nexus-generated SPF change plan. Verify sender inventory, resolve provider ranges immediately before deployment, validate the candidate record and run controlled mail tests.", "category": "normal", "risk_level": risk, "impact": "Changing SPF can affect outbound delivery and DMARC alignment for authorised senders.", "rollback_plan": f"Restore recorded SPF TXT value: {plan.get('rollback', {}).get('restore_spf_record', '')}", "client_id": plan["client_id"], "status": "pending_review", "requested_by": current_user.get("name") or current_user.get("email") or "Authenticated technician", "requested_by_id": current_user.get("id"), "approvals": [], "activity": [{"type": "submitted", "at": now, "note": "Created from Nexus SPF flattening plan."}], "created_at": now, "updated_at": now, "nexus_spf_plan_id": plan_id}
    await db.change_requests.insert_one(change.copy())
    await db.nexus_spf_change_plans.update_one({"id": plan_id}, {"$set": {"status": "pending_review", "change_request_id": change_id, "updated_at": now}})
    await log_activity(current_user, "nexus_spf_change_request_created", "nexus_spf_change_plan", plan_id, plan["domain"], f"Created change request {change_id} for SPF plan", metadata={"client_id": plan["client_id"], "change_request_id": change_id, "external_changes": False})
    return {"message": "SPF change request submitted for review. DNS remains unchanged.", "change_request": {"id": change_id, "status": "pending_review"}, "existing": False}
