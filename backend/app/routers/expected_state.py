"""Nexus Expected State Engine — compares declared scope to observed evidence."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.database import db
from app.services.scope_permissions import scoped_query

router = APIRouter(tags=["Nexus Expected State"])


@router.get("/expected-state/overview")
async def expected_state_overview(current_user: dict = Depends(get_current_user)):
    """Return cautious, evidence-backed controls for each managed customer.

    A missing source is intentionally reported as not assessed. Nexus must not
    infer protection, recoverability, billing, or compliance from absence.
    """
    clients = await db.clients.find(scoped_query(current_user, {}, site_field=None), {"_id": 0}).to_list(2000)
    client_ids = [item.get("id") for item in clients if item.get("id")]
    devices = await db.devices.find(scoped_query(current_user, {"client_id": {"$in": client_ids}}, site_field=None), {"_id": 0}).to_list(10000)
    agents = await db.nexus_agents.find(
        scoped_query(current_user, {"client_id": {"$in": client_ids}, "is_active": True}, site_field=None),
        {"_id": 0, "client_id": 1, "last_seen": 1},
    ).to_list(10000)
    subscriptions = await db.subscriptions.find(scoped_query(current_user, {"client_id": {"$in": client_ids}}, site_field=None), {"_id": 0}).to_list(10000)
    backup_jobs = await db.backup_jobs.find(scoped_query(current_user, {"client_id": {"$in": client_ids}}, site_field=None), {"_id": 0}).to_list(10000)
    recovery_tests = await db.backup_verifications.find(scoped_query(current_user, {"client_id": {"$in": client_ids}}, site_field=None), {"_id": 0}).to_list(10000)
    tenant_ids = [str(item.get("cipp_tenant_id") or "").strip() for item in clients if item.get("cipp_tenant_id")]
    hygiene_rows = await db.cipp_hygiene_cache.find(
        scoped_query(current_user, {"tenant_id": {"$in": tenant_ids}}, site_field=None),
        {"_id": 0, "tenant_id": 1, "hygiene": 1},
    ).to_list(2000) if tenant_ids else []
    hygiene_by_tenant = {str(row.get("tenant_id")): row.get("hygiene") or {} for row in hygiene_rows}

    online_cutoff = (datetime.now(timezone.utc) - timedelta(minutes=3)).isoformat()
    findings, coverage, controls = [], [], []

    def add_control(client_id, client_name, control_id, label, status, detail, route, expected=None, observed=None):
        controls.append({
            "id": f"{control_id}:{client_id}", "control_id": control_id,
            "client_id": client_id, "client_name": client_name, "label": label,
            "status": status, "detail": detail, "route": route,
            "expected": expected, "observed": observed,
        })

    for client in clients:
        client_id = client.get("id")
        client_name = client.get("name") or client.get("company_name") or client_id
        managed = [device for device in devices if device.get("client_id") == client_id]
        recent_agents = [agent for agent in agents if agent.get("client_id") == client_id and str(agent.get("last_seen") or "") >= online_cutoff]
        active_services = [service for service in subscriptions if service.get("client_id") == client_id and str(service.get("status") or "active").lower() not in {"cancelled", "disabled"}]
        expected_endpoints, observed_agents = len(managed), len(recent_agents)

        endpoint_status = "not_assessed" if not expected_endpoints else "covered" if observed_agents >= expected_endpoints else "gap"
        add_control(client_id, client_name, "endpoint-agent", "Active Nexus agent", endpoint_status,
                    "No managed endpoint scope is recorded." if not expected_endpoints else f"{observed_agents} of {expected_endpoints} managed endpoints have a recent agent heartbeat.",
                    "/devices", expected_endpoints or None, observed_agents if expected_endpoints else None)
        if expected_endpoints and observed_agents < expected_endpoints:
            missing = expected_endpoints - observed_agents
            findings.append({"id": f"agent:{client_id}", "client_id": client_id, "client_name": client_name, "domain": "endpoint coverage", "severity": "high" if missing > 1 else "medium", "expected": expected_endpoints, "observed": observed_agents, "title": f"{missing} managed endpoint{'s' if missing != 1 else ''} lack active Nexus agent evidence", "next_step": "Review device enrolment and agent heartbeat before treating endpoint coverage as complete.", "route": "/devices"})

        billing_status = "not_assessed" if not expected_endpoints else "covered" if active_services else "gap"
        add_control(client_id, client_name, "service-billing", "Service billing evidence", billing_status,
                    "No managed endpoint scope is recorded." if not expected_endpoints else (f"{len(active_services)} active subscription record{'s' if len(active_services) != 1 else ''} linked." if active_services else "No active subscription record is linked to the managed endpoint scope."),
                    "/services-subscriptions?view=attention", 1 if expected_endpoints else None, len(active_services) if expected_endpoints else None)
        if expected_endpoints and not active_services:
            findings.append({"id": f"billing:{client_id}", "client_id": client_id, "client_name": client_name, "domain": "billing coverage", "severity": "medium", "expected": expected_endpoints, "observed": 0, "title": "Managed endpoints are recorded but no active client subscription evidence is linked", "next_step": "Confirm contract/service mapping; Nexus cannot infer that managed endpoints are being billed.", "route": "/services-subscriptions?view=attention"})

        service_text = " ".join(str(service.get(key) or "") for service in active_services for key in ("name", "product_name", "product", "service_name", "category")).lower()
        backup_declared = any(marker in service_text for marker in ("backup", "acronis", "veeam", "datto", "bdr"))
        client_jobs = [job for job in backup_jobs if job.get("client_id") == client_id]
        failed_jobs = [job for job in client_jobs if str(job.get("status") or "").lower() in {"failed", "error"}]
        backup_status = "not_assessed" if not backup_declared else "covered" if client_jobs and not failed_jobs else "gap"
        add_control(client_id, client_name, "backup-execution", "Backup execution evidence", backup_status,
                    "No backup service declaration was found in linked subscriptions." if not backup_declared else (f"{len(client_jobs)} backup job{'s' if len(client_jobs) != 1 else ''} retained; {len(failed_jobs)} currently failed." if client_jobs else "Backup service is declared but no retained backup-job evidence is linked."),
                    "/backup-center", 1 if backup_declared else None, len(client_jobs) if backup_declared else None)
        if backup_declared and (not client_jobs or failed_jobs):
            findings.append({"id": f"backup:{client_id}", "client_id": client_id, "client_name": client_name, "domain": "backup assurance", "severity": "high" if failed_jobs else "medium", "expected": 1, "observed": len(client_jobs), "title": "Declared backup service lacks clean execution evidence", "next_step": "Review backup jobs and provider mapping. A service declaration is not proof that recoverable backups exist.", "route": "/backup-center"})

        successful_tests = [test for test in recovery_tests if test.get("client_id") == client_id and str(test.get("status") or test.get("outcome") or "").lower() in {"passed", "success", "successful", "verified"}]
        recovery_status = "not_assessed" if not backup_declared else "covered" if successful_tests else "gap"
        add_control(client_id, client_name, "recovery-verification", "Recovery verification", recovery_status,
                    "No backup service declaration was found in linked subscriptions." if not backup_declared else (f"{len(successful_tests)} retained successful recovery verification{'s' if len(successful_tests) != 1 else ''}." if successful_tests else "No successful retained recovery-verification evidence was found."),
                    "/backup-center?tab=verify", 1 if backup_declared else None, len(successful_tests) if backup_declared else None)
        if backup_declared and not successful_tests:
            findings.append({"id": f"recovery:{client_id}", "client_id": client_id, "client_name": client_name, "domain": "recovery assurance", "severity": "medium", "expected": 1, "observed": 0, "title": "Declared backup service has no retained successful recovery verification", "next_step": "Schedule a scoped recovery verification. Successful backup execution alone does not prove recoverability.", "route": "/backup-center?tab=verify"})

        tenant_id = str(client.get("cipp_tenant_id") or "").strip()
        evidence_state = str((hygiene_by_tenant.get(tenant_id) or {}).get("evidence_state") or "").lower()
        posture_status = "not_assessed" if not tenant_id else "covered" if evidence_state in {"evidence_available", "assessed", "complete"} else "gap"
        add_control(client_id, client_name, "microsoft-posture", "Microsoft security posture", posture_status,
                    "No Microsoft tenant is linked to this customer." if not tenant_id else (f"Tenant posture evidence is {evidence_state.replace('_', ' ')}." if posture_status == "covered" else "A Microsoft tenant is linked but no current posture evidence is retained."),
                    "/control-plane?module=microsoft365&view=security", 1 if tenant_id else None, 1 if posture_status == "covered" else 0 if tenant_id else None)
        if tenant_id and posture_status == "gap":
            findings.append({"id": f"m365:{client_id}", "client_id": client_id, "client_name": client_name, "domain": "Microsoft posture", "severity": "medium", "expected": 1, "observed": 0, "title": "Linked Microsoft tenant has no current retained posture evidence", "next_step": "Refresh the tenant connection and security posture before using this customer’s Microsoft controls as evidence.", "route": "/control-plane?module=microsoft365&view=security"})

        coverage.append({"client_id": client_id, "client_name": client_name, "expected_endpoints": expected_endpoints, "active_agents": observed_agents, "active_subscriptions": len(active_services), "status": endpoint_status})

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "boundary": "Expected State compares declared Nexus scope with retained evidence. Missing provider data is never treated as compliant, protected, recovered or billed.",
        "summary": {"clients": len(clients), "findings": len(findings), "coverage_gaps": sum(1 for item in coverage if item["status"] == "gap"), "not_assessed": sum(1 for item in controls if item["status"] == "not_assessed"), "controls_assessed": sum(1 for item in controls if item["status"] != "not_assessed"), "control_gaps": sum(1 for item in controls if item["status"] == "gap")},
        "findings": findings, "coverage": coverage, "controls": controls,
    }
