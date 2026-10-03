"""Nexus Exposure: scoped, evidence-first exposure intelligence.

The workspace is intentionally a derived read model.  It assembles retained
asset, certificate, mail-authentication, website-health and endpoint-security
evidence, but it never runs a scan, changes a provider, or becomes a second
source of truth for any source record.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any, Awaitable

from fastapi import APIRouter, Depends, Query

from app.auth import get_current_user
from app.routers.infrastructure import get_domains, get_ssl_certificates
from app.routers.nexus_dmarc import nexus_dmarc_overview
from app.routers.ransomware_canary import get_canary_status
from app.routers.vulnerability_scanner import get_vulnerability_overview
from app.routers.web_studio import get_web_studio_overview
from app.services.scope_permissions import assert_client_scope, effective_scope


router = APIRouter(prefix="/nexus-exposure", tags=["Nexus Exposure"])

_OPEN_FINDING_STATUSES = {"open", "active", "new", "detected", "investigating", "pending", "unresolved"}
_SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "unclassified": 4}


from app.services.time_utils import now_iso as _now


def _text(value: Any, fallback: str = "Not recorded") -> str:
    value = str(value or "").strip()
    return value or fallback


def _normal(value: Any) -> str:
    return str(value or "").strip().lower()


def _parse_timestamp(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc) if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _days_until(value: Any) -> int | None:
    timestamp = _parse_timestamp(value)
    if not timestamp:
        return None
    return (timestamp.date() - datetime.now(timezone.utc).date()).days


def _visible(record: dict[str, Any], *, scope: dict[str, Any], selected_client_id: str) -> bool:
    """Apply a second, fail-closed client boundary to composed source rows.

    Source routes apply their own authorisation.  This additional guard avoids
    making a permissive or legacy source response an accidental cross-client
    disclosure when the data is assembled into one new workspace.
    """

    client_id = str(record.get("client_id") or "").strip()
    if not client_id:
        return False
    if selected_client_id and client_id != selected_client_id:
        return False
    if scope.get("mode") == "all":
        return True
    return bool(client_id and client_id in set(scope.get("client_ids") or []))


def _source_state(
    *,
    key: str,
    label: str,
    records: int,
    error: Exception | None = None,
    detail: str,
    route: str,
) -> dict[str, Any]:
    if error is not None:
        return {
            "key": key,
            "label": label,
            "state": "unavailable",
            "records": 0,
            "detail": "Nexus could not retrieve this source at the moment. No result has been inferred.",
            "route": route,
        }
    return {
        "key": key,
        "label": label,
        "state": "observed" if records else "not_assessed",
        "records": records,
        "detail": detail if records else f"No retained {label.lower()} evidence is available in this permitted scope.",
        "route": route,
    }


async def _gather_sources(tasks: dict[str, Awaitable[Any]]) -> dict[str, Any]:
    """Let a single unavailable provider surface as unavailable, not as a blank estate."""

    keys = list(tasks)
    values = await asyncio.gather(*(tasks[key] for key in keys), return_exceptions=True)
    return dict(zip(keys, values, strict=True))


def _finding(
    *,
    finding_id: str,
    source: str,
    source_collection: str,
    source_record_id: str,
    category: str,
    severity: str,
    client_id: str,
    client_name: str,
    title: str,
    detail: str,
    evidence: list[str],
    observed_at: Any,
    route: str,
    next_step: str,
    asset: str = "",
    domain: str = "",
    reachability: str = "unknown",
) -> dict[str, Any]:
    return {
        "id": finding_id,
        "source": source,
        "source_collection": source_collection,
        "source_record_id": source_record_id,
        "category": category,
        "severity": severity if severity in _SEVERITY_ORDER else "unclassified",
        "evidence_state": "observed",
        "confidence": "observed",
        "client_id": client_id,
        "client_name": client_name,
        "title": title,
        "detail": detail,
        "evidence": [item for item in evidence if item],
        "observed_at": observed_at,
        "source_route": route,
        "next_step": next_step,
        "asset": asset,
        "domain": domain,
        "reachability": reachability,
    }


def _coverage(
    *,
    coverage_id: str,
    source: str,
    client_id: str,
    client_name: str,
    title: str,
    detail: str,
    route: str,
    state: str = "not_assessed",
    observed_at: Any = None,
) -> dict[str, Any]:
    return {
        "id": coverage_id,
        "source": source,
        "client_id": client_id,
        "client_name": client_name,
        "title": title,
        "detail": detail,
        "evidence_state": state,
        "confidence": "unknown" if state == "not_assessed" else "stale",
        "observed_at": observed_at,
        "source_route": route,
        "reachability": "unknown",
    }


@router.get("/overview")
async def get_nexus_exposure_overview(
    client_id: str = Query(default=""),
    current_user: dict = Depends(get_current_user),
):
    """Return scoped exposure evidence without starting external discovery.

    A user must enter a client-bound, approved discovery workflow before Nexus
    ever performs an external scan.  This endpoint merely presents evidence
    that already exists in the owning source records.
    """

    selected_client_id = str(client_id or "").strip()
    if selected_client_id:
        await assert_client_scope(
            current_user,
            selected_client_id,
            operation="nexus_exposure.overview",
        )
    scope = effective_scope(current_user)
    source_results = await _gather_sources({
        "domains": get_domains(client_id=selected_client_id or None, current_user=current_user),
        "certificates": get_ssl_certificates(client_id=selected_client_id or None, current_user=current_user),
        "dmarc": nexus_dmarc_overview(client_id=selected_client_id, current_user=current_user),
        "web": get_web_studio_overview(client_id=selected_client_id or None, user=current_user),
        "vulnerabilities": get_vulnerability_overview(current_user=current_user, client_id=selected_client_id),
        "canaries": get_canary_status(current_user=current_user, client_id=selected_client_id),
    })

    errors = {key: value for key, value in source_results.items() if isinstance(value, Exception)}
    domains = [item for item in (source_results.get("domains") if not isinstance(source_results.get("domains"), Exception) else []) if isinstance(item, dict) and _visible(item, scope=scope, selected_client_id=selected_client_id)]
    certificates = [item for item in (source_results.get("certificates") if not isinstance(source_results.get("certificates"), Exception) else []) if isinstance(item, dict) and _visible(item, scope=scope, selected_client_id=selected_client_id)]
    dmarc_payload = source_results.get("dmarc") if not isinstance(source_results.get("dmarc"), Exception) else {}
    dmarc_domains = [item for item in (dmarc_payload.get("domains") or []) if isinstance(item, dict) and _visible(item, scope=scope, selected_client_id=selected_client_id)]
    web_payload = source_results.get("web") if not isinstance(source_results.get("web"), Exception) else {}
    web_sites = [item for item in (web_payload.get("sites") or []) if isinstance(item, dict) and _visible(item, scope=scope, selected_client_id=selected_client_id)]
    vulnerability_payload = source_results.get("vulnerabilities") if not isinstance(source_results.get("vulnerabilities"), Exception) else {}
    vulnerabilities = [item for item in (vulnerability_payload.get("findings") or []) if isinstance(item, dict) and _visible(item, scope=scope, selected_client_id=selected_client_id)]
    canary_payload = source_results.get("canaries") if not isinstance(source_results.get("canaries"), Exception) else {}
    canary_triggers = [item for item in (canary_payload.get("triggers") or []) if isinstance(item, dict) and _visible(item, scope=scope, selected_client_id=selected_client_id)]

    exposures: list[dict[str, Any]] = []
    coverage: list[dict[str, Any]] = []

    for domain in domains:
        domain_name = _text(domain.get("domain_name") or domain.get("domain"), "Managed domain")
        days = _days_until(domain.get("expiry_date"))
        if days is None:
            coverage.append(_coverage(
                coverage_id=f"domain-expiry:{domain.get('id')}",
                source="Domain inventory",
                client_id=str(domain.get("client_id") or ""),
                client_name=_text(domain.get("client_name"), "Scoped client"),
                title=f"Renewal evidence is missing · {domain_name}",
                detail="Nexus has a managed-domain record but no parseable renewal date. This is not evidence that the domain is safe or expired.",
                route="/expiry-tracker",
            ))
        elif days <= 30:
            severity = "high" if days < 0 else "medium"
            exposures.append(_finding(
                finding_id=f"domain-expiry:{domain.get('id')}",
                source="Domain inventory",
                source_collection="domains",
                source_record_id=str(domain.get("id") or domain_name),
                category="Domain lifecycle",
                severity=severity,
                client_id=str(domain.get("client_id") or ""),
                client_name=_text(domain.get("client_name"), "Scoped client"),
                title=f"{'Expired' if days < 0 else 'Renewal due'} · {domain_name}",
                detail=(f"The retained domain record expires in {days} day{'s' if days != 1 else ''}." if days >= 0 else f"The retained domain record expired {-days} day{'s' if days != -1 else ''} ago."),
                evidence=[f"Expiry: {_text(domain.get('expiry_date'))}", f"Registrar: {_text(domain.get('registrar'))}", f"Auto-renew: {'Recorded' if domain.get('auto_renew') else 'Not recorded'}"],
                observed_at=domain.get("last_check") or domain.get("updated_at"),
                route="/expiry-tracker",
                next_step="Validate the domain's renewal status and accountable owner before submitting any provider change.",
                domain=domain_name,
            ))

    for certificate in certificates:
        domain_name = _text(certificate.get("domain"), "Certificate binding")
        days = _days_until(certificate.get("expiry_date"))
        if days is None:
            coverage.append(_coverage(
                coverage_id=f"certificate-expiry:{certificate.get('id')}",
                source="Certificate inventory",
                client_id=str(certificate.get("client_id") or ""),
                client_name=_text(certificate.get("client_name"), "Scoped client"),
                title=f"Certificate expiry evidence is missing · {domain_name}",
                detail="The retained certificate record has no parseable expiry date. Reachability and public binding are not assessed here.",
                route="/expiry-tracker",
            ))
        elif days <= 30:
            severity = "critical" if days < 0 else ("high" if days <= 7 else "medium")
            exposures.append(_finding(
                finding_id=f"certificate-expiry:{certificate.get('id')}",
                source="Certificate inventory",
                source_collection="ssl_certificates",
                source_record_id=str(certificate.get("id") or domain_name),
                category="Certificate lifecycle",
                severity=severity,
                client_id=str(certificate.get("client_id") or ""),
                client_name=_text(certificate.get("client_name"), "Scoped client"),
                title=f"{'Expired' if days < 0 else 'Certificate renewal due'} · {domain_name}",
                detail=(f"The retained certificate record expires in {days} day{'s' if days != 1 else ''}." if days >= 0 else f"The retained certificate record expired {-days} day{'s' if days != -1 else ''} ago."),
                evidence=[f"Expiry: {_text(certificate.get('expiry_date'))}", f"Issuer: {_text(certificate.get('issuer'))}", f"Auto-renew: {'Recorded' if certificate.get('auto_renew') else 'Not recorded'}"],
                observed_at=certificate.get("last_check") or certificate.get("updated_at"),
                route="/expiry-tracker",
                next_step="Validate the binding and renewal responsibility, then use the approved provider or change workflow.",
                domain=domain_name,
            ))

    for domain in dmarc_domains:
        domain_name = _text(domain.get("domain"), "Registered domain")
        statuses = {key: _normal(domain.get(key)) for key in ("spf_status", "dkim_status", "dmarc_status")}
        failed = [label.split("_")[0].upper() for label, value in statuses.items() if value == "fail"]
        unknown = [label.split("_")[0].upper() for label, value in statuses.items() if value in {"", "unknown"}]
        if failed:
            exposures.append(_finding(
                finding_id=f"dmarc-posture:{domain.get('id')}",
                source="Nexus DMARC",
                source_collection="nexus_dmarc_domains",
                source_record_id=str(domain.get("id") or domain_name),
                category="Domain authentication",
                severity="high",
                client_id=str(domain.get("client_id") or ""),
                client_name=_text(domain.get("client_name"), "Scoped client"),
                title=f"Domain authentication needs review · {domain_name}",
                detail=f"Recorded {' and '.join(failed)} posture is failing. Nexus Exposure does not publish DNS or infer the cause.",
                evidence=[f"SPF: {_text(domain.get('spf_status'), 'unknown')}", f"DKIM: {_text(domain.get('dkim_status'), 'unknown')}", f"DMARC: {_text(domain.get('dmarc_status'), 'unknown')}", f"Policy: {_text(domain.get('policy'), 'not recorded')}"],
                observed_at=domain.get("last_report_at") or domain.get("last_dns_check_at") or domain.get("updated_at"),
                route="/dmarc-compliance",
                next_step="Review the source reports and sender evidence, then create an approved DNS change only if the client scope is confirmed.",
                domain=domain_name,
            ))
        elif _normal(domain.get("policy")) == "none":
            exposures.append(_finding(
                finding_id=f"dmarc-policy:{domain.get('id')}",
                source="Nexus DMARC",
                source_collection="nexus_dmarc_domains",
                source_record_id=str(domain.get("id") or domain_name),
                category="Domain authentication",
                severity="medium",
                client_id=str(domain.get("client_id") or ""),
                client_name=_text(domain.get("client_name"), "Scoped client"),
                title=f"DMARC policy is monitoring only · {domain_name}",
                detail="A retained Nexus DMARC record reports policy none. This is a policy posture observation, not an instruction to publish a DNS change.",
                evidence=[f"Policy: {_text(domain.get('policy'))}", f"SPF: {_text(domain.get('spf_status'), 'unknown')}", f"DKIM: {_text(domain.get('dkim_status'), 'unknown')}"],
                observed_at=domain.get("last_report_at") or domain.get("last_dns_check_at") or domain.get("updated_at"),
                route="/dmarc-compliance",
                next_step="Validate every legitimate sender and obtain approved change evidence before moving to enforcement.",
                domain=domain_name,
            ))
        if unknown:
            coverage.append(_coverage(
                coverage_id=f"dmarc-coverage:{domain.get('id')}",
                source="Nexus DMARC",
                client_id=str(domain.get("client_id") or ""),
                client_name=_text(domain.get("client_name"), "Scoped client"),
                title=f"Domain authentication is not fully proven · {domain_name}",
                detail=f"No retained {' / '.join(unknown)} status is available. The unknown state remains visible instead of being treated as a pass.",
                route="/dmarc-compliance",
                observed_at=domain.get("last_report_at") or domain.get("last_dns_check_at"),
            ))

    for site in web_sites:
        domain_name = _text(site.get("primary_domain"), _text(site.get("name"), "Web asset"))
        health = site.get("website_health") if isinstance(site.get("website_health"), dict) else {}
        health_state = _normal(health.get("status"))
        checked_at = health.get("checked_at") or site.get("last_health_check_at")
        if health_state in {"unreachable", "degraded"}:
            exposures.append(_finding(
                finding_id=f"website-health:{site.get('id')}",
                source="Web Studio",
                source_collection="web_sites",
                source_record_id=str(site.get("id") or domain_name),
                category="Public website availability",
                severity="high" if health_state == "unreachable" else "medium",
                client_id=str(site.get("client_id") or ""),
                client_name=_text(site.get("client_name"), "Scoped client"),
                title=f"Website health requires review · {domain_name}",
                detail=f"The last retained public health observation is {health_state}. Nexus Exposure does not re-run the check from this page.",
                evidence=[f"HTTP status: {_text(health.get('http_status'), 'not recorded')}", f"Checked: {_text(checked_at)}", f"Latency: {_text(health.get('latency_ms'), 'not recorded')} ms"],
                observed_at=checked_at,
                route="/web-studio",
                next_step="Open Web Studio, validate the site scope and then run the approved health or maintenance workflow.",
                domain=domain_name,
            ))
        elif not health_state:
            coverage.append(_coverage(
                coverage_id=f"website-health:{site.get('id')}",
                source="Web Studio",
                client_id=str(site.get("client_id") or ""),
                client_name=_text(site.get("client_name"), "Scoped client"),
                title=f"No retained website health evidence · {domain_name}",
                detail="The web record is present but Nexus has no retained health observation. Public reachability remains unknown.",
                route="/web-studio",
            ))

    for vulnerability in vulnerabilities:
        if _normal(vulnerability.get("status")) not in _OPEN_FINDING_STATUSES:
            continue
        severity = _normal(vulnerability.get("severity")) or "unclassified"
        exposures.append(_finding(
            finding_id=f"endpoint-vulnerability:{vulnerability.get('finding_key') or vulnerability.get('id')}",
            source="Vulnerability Scanner",
            source_collection="vulnerabilities_or_device_patches",
            source_record_id=str(vulnerability.get("finding_key") or vulnerability.get("id") or "finding"),
            category="Endpoint exposure",
            severity=severity,
            client_id=str(vulnerability.get("client_id") or ""),
            client_name=_text(vulnerability.get("client_name"), "Scoped client"),
            title=_text(vulnerability.get("title"), "Verified endpoint finding"),
            detail="This is agent or trusted-provider endpoint evidence. Internet reachability is not assessed by Nexus Exposure.",
            evidence=[f"Reference: {_text(vulnerability.get('reference'))}", f"Patch available: {'Yes' if vulnerability.get('patch_available') else 'Not recorded'}", f"Source: {_text(vulnerability.get('evidence'))}"],
            observed_at=vulnerability.get("detected_at"),
            route="/vulnerability-scanner",
            next_step="Validate applicability, record the remediation or accepted-risk decision in the owning vulnerability workflow, then verify the source evidence.",
            asset=_text(vulnerability.get("device_name"), "Affected endpoint"),
        ))

    for trigger in canary_triggers:
        if trigger.get("resolved"):
            continue
        exposures.append(_finding(
            finding_id=f"canary:{trigger.get('id')}",
            source="Nexus Canary",
            source_collection="canary_triggers",
            source_record_id=str(trigger.get("id") or trigger.get("canary_id") or "trigger"),
            category="Endpoint integrity",
            severity="critical",
            client_id=str(trigger.get("client_id") or ""),
            client_name=_text(trigger.get("client_name"), "Scoped client"),
            title=f"Unresolved Nexus Canary signal · {_text(trigger.get('device_name'), 'Endpoint')}",
            detail="A retained deception-file integrity signal requires a source-led containment and investigation decision.",
            evidence=[f"Type: {_text(trigger.get('trigger_type'))}", f"Reason: {_text(trigger.get('reason'))}", f"Auto-isolated: {'Yes' if trigger.get('auto_isolated') else 'No'}"],
            observed_at=trigger.get("triggered_at"),
            route="/ransomware-canary",
            next_step="Open the Canary record, validate scope, preserve evidence and follow the accountable ransomware response workflow.",
            asset=_text(trigger.get("device_name"), "Affected endpoint"),
        ))

    source_rows = [
        _source_state(key="domains", label="Domain inventory", records=len(domains), error=errors.get("domains"), detail="Registered domains with retained lifecycle evidence.", route="/expiry-tracker"),
        _source_state(key="certificates", label="Certificate inventory", records=len(certificates), error=errors.get("certificates"), detail="Registered certificate records with retained expiry evidence.", route="/expiry-tracker"),
        _source_state(key="dmarc", label="Nexus DMARC", records=len(dmarc_domains), error=errors.get("dmarc"), detail="Registered domain-authentication posture and aggregate-report evidence.", route="/dmarc-compliance"),
        _source_state(key="web", label="Web Studio", records=len(web_sites), error=errors.get("web"), detail="Client-linked web records and prior health observations.", route="/web-studio"),
        _source_state(key="vulnerabilities", label="Vulnerability Scanner", records=len(vulnerabilities), error=errors.get("vulnerabilities"), detail="Scoped Nexus Agent and trusted-provider endpoint findings.", route="/vulnerability-scanner"),
        _source_state(key="canaries", label="Nexus Canary", records=len(canary_triggers), error=errors.get("canaries"), detail="Retained endpoint-integrity signals from enrolled Nexus Agents.", route="/ransomware-canary"),
        {
            "key": "identity_leaks",
            "label": "Credential-leak intelligence",
            "state": "not_connected",
            "records": 0,
            "detail": "No approved identity-leak provider is connected. Nexus makes no claim about leaked credentials.",
            "route": "/settings?tab=integrations",
        },
    ]

    exposures.sort(key=lambda item: (_SEVERITY_ORDER.get(item["severity"], 5), str(item.get("observed_at") or ""), item["title"]))
    coverage.sort(key=lambda item: (item.get("client_name") or "", item["title"]))
    client_keys = {item.get("client_id") for item in exposures + coverage if item.get("client_id")}
    return {
        "generated_at": _now(),
        "scope": {
            "selected_client_id": selected_client_id or None,
            "mode": scope.get("mode"),
            "source": scope.get("source"),
        },
        "summary": {
            "assets": len(domains) + len(certificates) + len(web_sites),
            "observed": len(exposures),
            "critical": sum(item["severity"] == "critical" for item in exposures),
            "high": sum(item["severity"] == "high" for item in exposures),
            "not_assessed": len(coverage),
            "unavailable_sources": sum(source["state"] in {"unavailable", "not_connected"} for source in source_rows),
            "clients": len(client_keys),
        },
        "exposures": exposures,
        "coverage": coverage,
        "sources": source_rows,
        "boundary": "Nexus Exposure shows retained, scoped evidence only. It does not discover, probe, resolve, publish DNS, renew a certificate or remediate an asset from this workspace. Reachability remains unknown unless an approved source has explicitly proved it.",
        "discovery_boundary": "New external discovery requires a client-bound managed asset, verified authorisation, an approved action and retained audit evidence. This overview never scans arbitrary domains, addresses or providers.",
    }
