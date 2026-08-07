"""Focused regression tests for Nexus Agent command safety."""

import asyncio
import io
import json
import os
import sys
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.routers import (  # noqa: E402
    asset_depreciation,
    asset_lifecycle,
    alert_rules,
    client_budget,
    client_health,
    client_studio,
    change_management,
    cipp_hygiene,
    compliance,
    csat_surveys,
    dark_web_monitor,
    device_intel,
    device_terminal,
    devices,
    executive_reports,
    geo_map,
    identity_threats,
    infrastructure,
    integrations_overview,
    intelligent_routing,
    license_management,
    maintenance_windows,
    m365,
    networking,
    nexus_agent,
    nps_tracker,
    permission_elevation,
    patch_compliance,
    phishing_sim,
    predictive,
    pro_pack,
    procurement_planner,
    qr_assets,
    qbr_generator,
    remediation_playbooks,
    revenue,
    ransomware_tabletop,
    shadow_it,
    soc,
    sla_report_gen,
    zero_trust,
)
from app.models import UserCreate  # noqa: E402


class ListCursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *_args, **_kwargs):
        return self

    def limit(self, count):
        self.rows = self.rows[:count]
        return self

    async def to_list(self, length):
        return [dict(row) for row in self.rows[:length]]

    def __aiter__(self):
        self._iter = iter(self.rows)
        return self

    async def __anext__(self):
        try:
            return dict(next(self._iter))
        except StopIteration as exc:
            raise StopAsyncIteration from exc


def test_agent_command_permission_is_explicit():
    assert nexus_agent._can_execute_agent_commands({"role": "admin"})
    assert nexus_agent._can_execute_agent_commands({
        "role": "technician",
        "permissions": {"agent_commands": {"execute": True}},
    })
    assert not nexus_agent._can_execute_agent_commands({
        "role": "dispatcher",
        "permissions": {"devices": {"edit": True}},
    })

    with pytest.raises(HTTPException) as denied:
        asyncio.run(nexus_agent.require_agent_operator(user={"role": "dispatcher"}))
    assert denied.value.status_code == 403

    with pytest.raises(HTTPException) as settings_denied:
        asyncio.run(nexus_agent.require_agent_admin(user={
            "role": "technician",
            "permissions": {"agent_commands": {"execute": True}},
        }))
    assert settings_denied.value.status_code == 403
    assert asyncio.run(nexus_agent.require_agent_admin(user={"role": "admin"}))["role"] == "admin"


def test_change_management_requires_independent_reviewer_and_valid_schedule(monkeypatch):
    async def pending_change(_change_id):
        return {"id": "CHG-100", "status": "pending_review", "requested_by_id": "tech-requester"}

    monkeypatch.setattr(change_management, "_get_change", pending_change)

    with pytest.raises(HTTPException) as self_approval:
        asyncio.run(change_management.approve_change(
            "CHG-100",
            {"note": "Reviewed against the approved CAB agenda."},
            user={"id": "tech-requester", "name": "Requester"},
        ))
    assert self_approval.value.status_code == 403
    assert "cannot approve their own" in self_approval.value.detail

    with pytest.raises(HTTPException) as invalid_date:
        change_management._optional_date("21/07/2026")
    assert invalid_date.value.status_code == 400
    assert change_management._optional_date("2026-07-21") == "2026-07-21"


def test_m365_workspace_never_promotes_saved_credentials_to_live_telemetry(monkeypatch):
    assert m365._connection_status({}) == "not_configured"
    assert m365._connection_status({"app_id": "app"}) == "incomplete"
    assert m365._connection_status({"app_id": "app", "tenant_id": "tenant", "app_secret": "secret"}) == "configured_unverified"
    assert not any(name.startswith("MOCK_") for name in vars(m365))

    async def configured_settings():
        return {"app_id": "app", "tenant_id": "tenant", "app_secret": "secret"}

    async def unavailable_partner_provider(*_args, **_kwargs):
        raise HTTPException(status_code=503, detail="Partner Center provider is not installed for this unit test")

    monkeypatch.setattr(m365, "_get_settings", configured_settings)
    monkeypatch.setattr(m365, "_partner_center_customers", unavailable_partner_provider)
    result = asyncio.run(m365.test_connection(current_user={"id": "operator-1"}))
    assert result["ok"] is False
    assert result["mode"] == "configured_unverified"
    assert "not installed" in result["reason"].lower()


def test_cipp_hygiene_requires_enough_provider_evidence_before_scoring():
    partial = cipp_hygiene.compute_hygiene({
        "users": [{"accountEnabled": True, "assignedLicenses": [{"skuId": "lic"}]}],
        "mfa": [], "conditional": [], "guests": [],
        "_sources": {"users": True, "mfa": False, "conditional": False, "guests": False},
    })
    assert partial["score"] is None
    assert partial["evidence_state"] == "partial_evidence"
    assert partial["breakdown"]["mfa_coverage"]["status"] == "not_assessed"

    evidence_backed = cipp_hygiene.compute_hygiene({
        "users": [{
            "accountEnabled": True,
            "assignedLicenses": [{"skuId": "lic"}],
            "userPrincipalName": "operator@example.test",
            "signInActivity": {"lastSignInDateTime": datetime.now(timezone.utc).isoformat()},
            "assignedRoles": ["Global Administrator"],
        }],
        "mfa": [{"userPrincipalName": "operator@example.test", "MFARegistration": True, "MFAEnforced": True}],
        "conditional": [{"displayName": "Require MFA for administrators"}],
        "guests": [],
        "_sources": {"users": True, "mfa": True, "conditional": True, "guests": True},
    })
    assert isinstance(evidence_backed["score"], int)
    assert evidence_backed["evidence_coverage_pct"] == 100


def test_legacy_executive_reports_cannot_generate_fabricated_kpis(monkeypatch):
    assert not hasattr(executive_reports, "_gen_reports")
    async def no_op_retirement():
        return None
    monkeypatch.setattr(executive_reports, "_retire_mock_reports", no_op_retirement)
    with pytest.raises(HTTPException) as retired:
        asyncio.run(executive_reports.generate_report(current_user={"id": "operator-1"}))
    assert retired.value.status_code == 410


def test_licence_register_excludes_unattributed_legacy_or_demo_rows():
    assert not hasattr(license_management, "_gen_licenses")
    assert license_management._is_confirmed({"id": "legacy-demo", "product_name": "Invented plan"}) is False
    assert license_management._is_confirmed({"id": "manual", "source": "manual"}) is True
    assert license_management._is_confirmed({"id": "legacy-manual", "created_at": "2026-07-21T00:00:00+00:00"}) is True

    overview = license_management._overview([
        {"id": "manual", "source": "manual", "product_name": "Microsoft 365", "client_name": "Example", "purchased": 10, "used": 7, "unit_cost": 20, "monthly_cost": 200},
    ], legacy_unverified=4)
    assert overview["summary"]["total_licenses"] == 1
    assert overview["summary"]["legacy_unverified"] == 4
    assert overview["optimization_suggestions"][0]["type"] == "review_unused_seats"


def test_legacy_qbr_and_sla_generators_cannot_fabricate_report_metrics(monkeypatch):
    assert not hasattr(qbr_generator, "_seed_qbrs")
    assert not hasattr(sla_report_gen, "_seed_reports")

    async def no_op_retirement():
        return None

    monkeypatch.setattr(qbr_generator, "_retire_demo_qbrs", no_op_retirement)
    monkeypatch.setattr(sla_report_gen, "_retire_demo_sla_reports", no_op_retirement)
    with pytest.raises(HTTPException) as qbr_retired:
        asyncio.run(qbr_generator.generate_qbr({}, current_user={"id": "operator-1"}))
    with pytest.raises(HTTPException) as sla_retired:
        asyncio.run(sla_report_gen.generate_sla_report({}, current_user={"id": "operator-1"}))
    assert qbr_retired.value.status_code == 410
    assert sla_retired.value.status_code == 410


def test_customer_feedback_empty_states_do_not_invent_nps_or_csat_results():
    summary = nps_tracker._score_summary([])
    assert summary["nps_score"] is None
    assert summary["avg_score"] is None
    assert summary["response_rate_pct"] is None
    assert nps_tracker._trend([]) == []

    with pytest.raises(HTTPException) as csat_retired:
        asyncio.run(csat_surveys.seed_demo_data(current_user={"id": "operator-1"}))
    assert csat_retired.value.status_code == 410
    with pytest.raises(HTTPException) as unattributed_submission:
        asyncio.run(csat_surveys.submit_survey({"ticket_id": "forged", "score": 5}))
    assert unattributed_submission.value.status_code == 410


def test_revenue_calculations_require_recorded_contract_values_and_rates():
    assert not hasattr(revenue, "_seed_revenue")
    assert revenue._contract_monthly_value({}) == 0
    assert revenue._contract_monthly_value({"monthly_value": 1250}) == 1250
    assert revenue._contract_monthly_value({"mrr": "850.50"}) == 850.5


def test_predictive_intelligence_requires_agent_observed_signals_before_assessment():
    assert not hasattr(predictive, "_seed_failure_predictions")
    assert not hasattr(predictive, "_pf_rand")

    unverified = predictive._observed_telemetry({
        "id": "asset-1", "cpu_usage": 98, "memory_usage": 95, "disk_usage": 96,
    })
    assert unverified["evidence_state"] == "not_assessed"
    assert unverified["telemetry"] == {}

    observed = predictive._observed_telemetry({
        "id": "agent-1", "source": "nexus-agent", "last_seen": datetime.now(timezone.utc).isoformat(),
        "cpu_usage": 92, "memory_usage": 54, "disk_usage": 91,
    })
    assessment = predictive._assessment_from_observation({"id": "agent-1", "name": "Endpoint"}, observed)
    assert assessment["evidence_state"] == "assessed"
    assert assessment["health_score"] is not None
    assert assessment["predictions"]
    assert all(condition["condition_kind"] == "observed_threshold" for condition in assessment["predictions"])
    assert all("predicted_date" not in condition for condition in assessment["predictions"])


def test_patch_compliance_excludes_generated_policy_and_ring_defaults():
    assert not hasattr(patch_compliance, "_seed_patch_data")
    assert patch_compliance._confirmed_policy({"id": "pp-001", "name": "Old sample"}) is False
    assert patch_compliance._confirmed_policy({"id": "pp-real", "source": "manual", "confirmed_at": "2026-07-21T00:00:00+00:00"}) is True

    unverified = patch_compliance._agent_source({"cpu_usage": 30, "pending_patches": 0})
    enrolled = patch_compliance._agent_source({"source": "nexus-agent", "pending_patches": 0})
    assert unverified is None
    assert enrolled == "nexus-agent"


def test_intelligent_routing_requires_confirmed_rules_and_recorded_skills():
    assert not hasattr(intelligent_routing, "random")
    assert intelligent_routing._confirmed_rule({"id": "legacy-rule", "name": "Sample"}) is False
    assert intelligent_routing._confirmed_rule({"id": "rule-1", "source": "manual", "confirmed_at": "2026-07-21T00:00:00+00:00"}) is True
    assert intelligent_routing._skills({"networking": 4, "made_up": 5}) == {"networking": 4}

    candidates = [{"id": "tech-1", "open_tickets": 1, "skills": {}, "name": "Technician"}]
    assert intelligent_routing._route_scores(candidates, category="networking", method="skill_match") == []


def test_client_health_requires_multiple_recorded_evidence_dimensions_before_scoring():
    assert client_health._health_status(None) == "not_assessed"
    assert client_health._device_source({"cpu_usage": 95}) is None
    assert client_health._device_source({"source": "nexus-agent", "cpu_usage": 95}) == "nexus-agent"
    assert client_health._numeric(None) is None
    assert client_health._numeric("82.5") == 82.5


def test_compliance_report_preserves_an_unassessed_scan_without_inventing_zero_score(monkeypatch):
    class Reports:
        async def find_one(self, *_args, **_kwargs):
            return {
                "id": "scan-1", "client_id": "client-1", "framework": "cis",
                "score": None, "evidence_score": None, "coverage_pct": 0,
                "passed": 0, "evaluated": 0, "total": 12, "controls": [],
                "evidence_state": "not_assessed",
            }

    class Generated:
        def __init__(self):
            self.inserted = []

        async def insert_one(self, record):
            self.inserted.append(dict(record))

    generated = Generated()
    monkeypatch.setattr(compliance, "db", SimpleNamespace(
        compliance_reports=Reports(), compliance_generated_reports=generated,
    ))
    report = asyncio.run(compliance.generate_compliance_report({"scan_id": "scan-1"}, current_user={"name": "Operator"}))
    assert report["score"] is None
    assert report["evidence_score"] is None
    assert report["status"] == "evidence_gaps"
    assert generated.inserted[0]["score"] is None


def test_infrastructure_never_returns_generated_proxmox_inventory_or_seeds_production_data(monkeypatch):
    class ProxmoxVms:
        def find(self, *_args, **_kwargs):
            return ListCursor([])

    monkeypatch.setattr(infrastructure, "db", SimpleNamespace(proxmox_vms=ProxmoxVms()))
    assert asyncio.run(infrastructure.get_proxmox_vms(current_user={"id": "operator-1"})) == []
    with pytest.raises(HTTPException) as retired:
        asyncio.run(infrastructure.seed_data(current_user={"id": "operator-1"}))
    assert retired.value.status_code == 410


def test_client_studio_never_derives_health_from_default_sentiment_or_seeded_values():
    assert not hasattr(client_studio, "_seeded")
    assert client_studio._health({"total_tickets": 0, "open_tickets": 0}, None) is None
    assert client_studio._health({"total_tickets": 4, "open_tickets": 1}, None) is None
    assert client_studio._health({"total_tickets": 4, "open_tickets": 1}, 84) == 88
    assert client_studio._risk_label(None) == "Not assessed"


def test_alert_rules_require_configured_policies_and_agent_observed_telemetry():
    assert [action["id"] for action in alert_rules.ACTION_OPTIONS] == ["create_ticket"]
    assert alert_rules._agent_observed({"cpu_usage": 99}) is False
    assert alert_rules._agent_observed({"source": "nexus-agent", "cpu_usage": 99}) is True
    with pytest.raises(HTTPException) as retired:
        asyncio.run(alert_rules._seed_rules())
    assert retired.value.status_code == 410


def test_installer_records_the_configured_agent_intervals():
    archive = nexus_agent._build_installer_zip(
        client_id="client-1",
        client_name="Example Client",
        enrollment_token="token-1",
        server_url="https://nexus.example.test",
        binary_bytes=b"agent-binary",
        heartbeat_secs=120,
        poll_secs=30,
    )
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        config = json.loads(bundle.read("config.json"))
    assert config["heartbeat_secs"] == 120
    assert config["poll_secs"] == 30
    assert config["nexus_shield"] == nexus_agent.NEXUS_SHIELD_AGENT_PROFILE


def test_public_registration_cannot_request_an_elevated_role():
    registration = UserCreate(
        name="Untrusted User",
        email="untrusted@example.com",
        password="test-password",
        role="admin",
    )

    assert "role" not in registration.model_dump()


def test_fleet_request_enforces_shell_timeout_and_batch_limits():
    with pytest.raises(ValidationError):
        nexus_agent.FleetScriptRequest(device_ids=["a"], shell="zsh", script="date")
    with pytest.raises(ValidationError):
        nexus_agent.FleetScriptRequest(device_ids=["a"], script="date", timeout_sec=0)
    with pytest.raises(ValidationError):
        nexus_agent.FleetScriptRequest(
            device_ids=[str(i) for i in range(nexus_agent.MAX_FLEET_TARGETS + 1)],
            script="date",
        )
    with pytest.raises(ValidationError):
        nexus_agent.CommandResult(id="cmd-1", status="unexpected")


class StaleCommandCollection:
    """Always returns the same stale candidate to reproduce overlapping polls."""

    def __init__(self):
        self.command = {
            "_id": "mongo-1",
            "id": "cmd-1",
            "device_id": "agent-1",
            "kind": "ping",
            "payload": {},
            "status": "pending",
        }

    def find(self, _query):
        return ListCursor([self.command])

    async def update_one(self, query, update):
        if query.get("status") == "pending" and self.command["status"] == "pending":
            self.command.update(update["$set"])
            return SimpleNamespace(modified_count=1)
        return SimpleNamespace(modified_count=0)


class ResultCommandCollection:
    def __init__(self):
        self.command = {
            "id": "cmd-result-1",
            "device_id": "agent-1",
            "kind": "ping",
            "status": "dispatched",
            "authorization": {"nonce": "nonce-result-1"},
        }

    async def find_one(self, query, *_args, **_kwargs):
        if query.get("id") != self.command["id"] or query.get("device_id") != self.command["device_id"]:
            return None
        if query.get("kind") and query["kind"] != self.command["kind"]:
            return None
        return dict(self.command)

    async def update_one(self, query, update):
        if query.get("status") == "dispatched" and self.command["status"] == "dispatched":
            self.command.update(update["$set"])
            return SimpleNamespace(modified_count=1)
        return SimpleNamespace(modified_count=0)


class EmptyCollection:
    async def find_one(self, *_args, **_kwargs):
        return None

    async def update_one(self, *_args, **_kwargs):
        return SimpleNamespace(modified_count=0)


class AgentTokenCollection:
    async def find_one(self, query):
        if query.get("agent_token") == "valid-token":
            return {"id": "agent-1", "is_active": True}
        return None


class AgentSettingsCollection:
    def __init__(self, require_mtls=False):
        self.require_mtls = require_mtls

    async def find_one(self, *_args, **_kwargs):
        return {"require_mtls": self.require_mtls}


class IdentityAgentCollection:
    def __init__(self, expires_at="2099-01-01T00:00:00+00:00"):
        self.agent = {
            "id": "agent-1",
            "client_id": "client-1",
            "agent_token": "valid-token",
            "is_active": True,
            "device_identity": {
                "certificate_fingerprint": "ab" * 32,
                "certificate_expires_at": expires_at,
            },
        }

    async def find_one(self, query, *_args, **_kwargs):
        return self.agent if query.get("agent_token") == "valid-token" else None

    async def update_one(self, *_args, **_kwargs):
        return SimpleNamespace(modified_count=1)


def test_command_poll_claims_each_command_only_once(monkeypatch):
    fake_db = SimpleNamespace(
        nexus_agents=AgentTokenCollection(),
        nexus_agent_commands=StaleCommandCollection(),
    )
    monkeypatch.setattr(nexus_agent, "db", fake_db)

    first = asyncio.run(nexus_agent.commands_poll(x_agent_token="valid-token"))
    second = asyncio.run(nexus_agent.commands_poll(x_agent_token="valid-token"))

    assert [command["id"] for command in first["commands"]] == ["cmd-1"]
    assert first["commands"][0]["authorization"]["command_id"] == "cmd-1"
    assert first["commands"][0]["authorization"]["device_id"] == "agent-1"
    assert first["commands"][0]["authorization"]["signature_algorithm"] == "ed25519"
    assert first["commands"][0]["authorization"]["nonce"]
    assert second["commands"] == []


def test_command_result_requires_dispatch_nonce_and_single_terminal_transition(monkeypatch):
    commands = ResultCommandCollection()
    empty = EmptyCollection()
    fake_db = SimpleNamespace(
        nexus_agents=AgentTokenCollection(),
        nexus_agent_commands=commands,
        nexus_agent_audit=AuditCollection(),
        maintenance_window_runs=empty,
        terminal_sessions=empty,
        devices=empty,
        device_events=empty,
        ransomware_canaries=empty,
        script_executions=empty,
    )
    monkeypatch.setattr(nexus_agent, "db", fake_db)

    with pytest.raises(HTTPException) as mismatch:
        asyncio.run(nexus_agent.command_result(
            nexus_agent.CommandResult(id="cmd-result-1", nonce="wrong", status="ok"),
            x_agent_token="valid-token",
        ))
    assert mismatch.value.status_code == 409

    accepted = asyncio.run(nexus_agent.command_result(
        nexus_agent.CommandResult(id="cmd-result-1", nonce="nonce-result-1", status="ok"),
        x_agent_token="valid-token",
    ))
    assert accepted == {"ok": True}

    with pytest.raises(HTTPException) as duplicate:
        asyncio.run(nexus_agent.command_result(
            nexus_agent.CommandResult(id="cmd-result-1", nonce="nonce-result-1", status="ok"),
            x_agent_token="valid-token",
        ))
    assert duplicate.value.status_code == 409


def test_agent_transport_enforces_mtls_only_after_proxy_trust_is_enabled(monkeypatch):
    fake_db = SimpleNamespace(
        nexus_agents=IdentityAgentCollection(),
        nexus_agent_settings=AgentSettingsCollection(require_mtls=True),
    )
    monkeypatch.setattr(nexus_agent, "MTLS_PROXY_TRUST_ENABLED", True)

    with pytest.raises(HTTPException) as missing:
        asyncio.run(nexus_agent._verify_agent_token(fake_db, "valid-token"))
    assert missing.value.status_code == 401

    verified = asyncio.run(nexus_agent._verify_agent_token(fake_db, "valid-token", "AB:" * 31 + "AB"))
    assert verified["device_identity"]["last_transport"] == "mtls"


def test_expired_agent_identity_is_limited_to_certificate_renewal():
    fake_db = SimpleNamespace(
        nexus_agents=IdentityAgentCollection(expires_at="2020-01-01T00:00:00+00:00"),
        nexus_agent_settings=AgentSettingsCollection(require_mtls=False),
    )

    with pytest.raises(HTTPException) as expired:
        asyncio.run(nexus_agent._verify_agent_token(fake_db, "valid-token"))
    assert expired.value.status_code == 401

    renewing = asyncio.run(
        nexus_agent._verify_agent_token(fake_db, "valid-token", allow_expired_identity=True)
    )
    assert renewing["id"] == "agent-1"


class RecentAgentCollection:
    def find(self, *_args, **_kwargs):
        return ListCursor([{
            "id": "agent-1",
            "hostname": "WORKSTATION-1",
            "last_seen": datetime.now(timezone.utc).isoformat(),
            "enrolled_at": datetime.now(timezone.utc).isoformat(),
        }])


class RecentDeviceCollection:
    def find(self, *_args, **_kwargs):
        return ListCursor([{"id": "device-record-1", "nexus_agent_id": "agent-1"}])


def test_recent_enrollments_return_device_record_id_and_live_status(monkeypatch):
    monkeypatch.setattr(nexus_agent, "db", SimpleNamespace(
        nexus_agents=RecentAgentCollection(),
        devices=RecentDeviceCollection(),
    ))

    rows = asyncio.run(nexus_agent.fleet_recent_enrollments(limit=8, user={"id": "user-1"}))

    assert rows[0]["device_record_id"] == "device-record-1"
    assert rows[0]["online"] is True


class FleetAgentCollection:
    def __init__(self):
        self.last_query = None

    def find(self, query, _projection):
        self.last_query = query
        return ListCursor([{"id": "online-1", "hostname": "ONLINE-1"}])


class FleetCommandCollection:
    def __init__(self):
        self.docs = []

    async def insert_many(self, docs, ordered=True):
        self.docs.extend(docs)
        return SimpleNamespace(inserted_ids=[doc["id"] for doc in docs])

    async def delete_many(self, _query):
        return SimpleNamespace(deleted_count=0)


class AuditCollection:
    async def insert_one(self, _doc):
        return SimpleNamespace(inserted_id="audit-1")


def test_fleet_scripts_skip_offline_targets_by_default(monkeypatch):
    agents = FleetAgentCollection()
    commands = FleetCommandCollection()
    monkeypatch.setattr(nexus_agent, "db", SimpleNamespace(
        nexus_agents=agents,
        nexus_agent_commands=commands,
        nexus_agent_audit=AuditCollection(),
    ))

    request = nexus_agent.FleetScriptRequest(
        device_ids=["online-1", "offline-1"],
        shell="powershell",
        script="Get-Date",
    )
    result = asyncio.run(nexus_agent.fleet_run_script(
        request,
        user={"id": "user-1", "email": "operator@example.test", "role": "admin"},
    ))

    assert "last_seen" in agents.last_query
    assert result["skipped_device_ids"] == ["offline-1"]
    assert len(commands.docs) == 1


def test_legacy_unauthenticated_heartbeat_endpoints_are_retired():
    with pytest.raises(HTTPException) as single:
        asyncio.run(devices.device_heartbeat("device-1", {"status": "online"}))
    assert single.value.status_code == 410

    with pytest.raises(HTTPException) as bulk:
        asyncio.run(devices.bulk_device_heartbeat({"devices": [{"id": "device-1"}]}))
    assert bulk.value.status_code == 410


class BulkDeviceCollection:
    def find(self, *_args, **_kwargs):
        return ListCursor([{
            "id": "device-1",
            "name": "WORKSTATION-1",
            "nexus_agent_id": "agent-1",
            "status": "online",
        }])


def test_device_bulk_actions_are_queued_and_message_text_is_not_executable(monkeypatch):
    captured = {}

    async def queue(device, kind, payload, queued_by):
        captured.update({"device": device, "kind": kind, "payload": payload, "queued_by": queued_by})
        return "command-1"

    monkeypatch.setattr(device_intel, "db", SimpleNamespace(devices=BulkDeviceCollection()))
    monkeypatch.setattr(nexus_agent, "queue_command_for_device", queue)

    result = asyncio.run(device_intel.bulk_action({
        "device_ids": ["device-1"],
        "action": "send-message",
        "title": "Planned maintenance",
        "body": "Don't run this: $(Get-ChildItem)",
    }, current_user={"email": "operator@example.test", "role": "admin"}))

    assert result["summary"] == {"total": 1, "queued": 1, "completed": 0, "failed": 0, "skipped": 0}
    assert result["results"][0]["status"] == "queued"
    assert captured["kind"] == "run_script"
    assert "$(Get-ChildItem)" not in captured["payload"]["script"]
    assert "FromBase64String" in captured["payload"]["script"]


class MaintenanceDevicesCollection:
    def __init__(self, rows):
        self.rows = rows

    def find(self, *_args, **_kwargs):
        return ListCursor(self.rows)


def test_maintenance_requires_enrolled_nexus_agent(monkeypatch):
    monkeypatch.setattr(maintenance_windows, "db", SimpleNamespace(
        devices=MaintenanceDevicesCollection([{
            "id": "device-1", "name": "UNMANAGED-1", "nexus_agent_id": None,
        }]),
    ))

    with pytest.raises(HTTPException) as denied:
        asyncio.run(maintenance_windows.create_window({
            "device_ids": ["device-1"],
            "actions": ["run-checks"],
            "scheduled_at": datetime.now(timezone.utc).isoformat(),
        }, current_user={"id": "operator-1", "role": "admin"}))

    assert denied.value.status_code == 409
    assert "not enrolled" in denied.value.detail


class MaintenanceWindowCollection:
    def __init__(self):
        self.doc = {"id": "window-1", "name": "Patch window", "status": "running", "device_ids": ["device-1"]}

    async def find_one(self, *_args, **_kwargs):
        return dict(self.doc)

    async def update_one(self, _query, update):
        self.doc.update(update["$set"])
        return SimpleNamespace(modified_count=1)


class MaintenanceRunsCollection:
    def find(self, *_args, **_kwargs):
        return ListCursor([{"status": "queued"}])


def test_maintenance_window_waits_for_agent_results(monkeypatch):
    windows = MaintenanceWindowCollection()
    monkeypatch.setattr(maintenance_windows, "db", SimpleNamespace(
        maintenance_windows=windows,
        maintenance_window_runs=MaintenanceRunsCollection(),
    ))

    reconciled = asyncio.run(maintenance_windows.reconcile_window_from_runs("window-1"))

    assert reconciled["status"] == "awaiting_results"
    assert windows.doc["status"] == "awaiting_results"
    assert windows.doc["summary_counts"]["queued"] == 1


class CommandConsoleDevices:
    async def find_one(self, query, *_args, **_kwargs):
        if query.get("id") == "device-1":
            return {
                "id": "device-1",
                "name": "WORKSTATION-1",
                "nexus_agent_id": "agent-1",
            }
        return None


class CommandConsoleSessions:
    def __init__(self):
        self.doc = {
            "id": "session-1",
            "status": "active",
            "user_id": "operator-1",
            "device_id": "device-1",
            "agent_id": "agent-1",
            "device_name": "WORKSTATION-1",
            "session_type": "powershell",
            "commands": [],
        }

    async def find_one(self, query, *_args, **_kwargs):
        if query.get("id") == self.doc["id"] and query.get("user_id", self.doc["user_id"]) == self.doc["user_id"]:
            return dict(self.doc)
        return None

    async def update_one(self, _query, update):
        self.doc.update(update.get("$set", {}))
        command = update.get("$push", {}).get("commands")
        if command:
            self.doc["commands"].append(command)
        return SimpleNamespace(modified_count=1)


class CommandConsoleCommands:
    def __init__(self):
        self.update = None

    async def update_one(self, _query, update):
        self.update = update
        return SimpleNamespace(modified_count=1)


def test_command_console_queues_to_nexus_agent_and_never_returns_simulated_output(monkeypatch):
    sessions = CommandConsoleSessions()
    commands = CommandConsoleCommands()
    captured = {}

    async def queue(device, kind, payload, queued_by):
        captured.update({"device": device, "kind": kind, "payload": payload, "queued_by": queued_by})
        return "agent-command-1"

    async def audit(*_args, **_kwargs):
        return None

    monkeypatch.setattr(device_terminal, "db", SimpleNamespace(
        devices=CommandConsoleDevices(),
        terminal_sessions=sessions,
        nexus_agent_commands=commands,
    ))
    monkeypatch.setattr(device_terminal, "queue_command_for_device", queue)
    monkeypatch.setattr(device_terminal, "log_activity", audit)

    result = asyncio.run(device_terminal.execute_command(
        "session-1",
        {"command": "Get-ComputerInfo"},
        current_user={"id": "operator-1", "email": "operator@example.test", "role": "admin"},
    ))

    assert result == {
        "command_id": "agent-command-1",
        "status": "queued",
        "message": "Queued for the live Nexus Agent",
    }
    assert captured["kind"] == "run_powershell"
    assert captured["payload"]["script"] == "Get-ComputerInfo"
    assert sessions.doc["commands"] == [{
        "id": "agent-command-1",
        "command": "Get-ComputerInfo",
        "status": "queued",
        "queued_at": sessions.doc["commands"][0]["queued_at"],
    }]
    assert "output" not in result


class NetworkRows:
    def __init__(self, rows):
        self.rows = rows
        self.inserted = []

    def find(self, *_args, **_kwargs):
        return ListCursor(self.rows)

    async def find_one(self, *_args, **_kwargs):
        return None

    async def insert_one(self, doc):
        self.inserted.append(dict(doc))
        return SimpleNamespace(inserted_id=doc.get("id"))


class CountRows:
    async def count_documents(self, _query):
        return 0


def test_network_workspace_never_autoseeds_demo_inventory(monkeypatch):
    wlans = NetworkRows([])
    dpi = NetworkRows([])
    monkeypatch.setattr(networking, "db", SimpleNamespace(
        network_wlans=wlans,
        network_port_profiles=NetworkRows([]),
        network_dpi=dpi,
    ))

    returned_wlans = asyncio.run(networking.get_site_wlans("site-1", current_user={"id": "operator-1"}))
    returned_profiles = asyncio.run(networking.get_port_profiles("site-1", current_user={"id": "operator-1"}))
    returned_dpi = asyncio.run(networking.get_site_dpi("site-1", current_user={"id": "operator-1"}))

    assert returned_wlans == []
    assert returned_profiles == []
    assert returned_dpi["categories"] == []
    assert returned_dpi["source"] == "not_available"
    assert wlans.inserted == []
    assert dpi.inserted == []


def test_network_site_creation_starts_pending_and_hides_controller_secrets(monkeypatch):
    sites = NetworkRows([])
    monkeypatch.setattr(networking, "db", SimpleNamespace(network_sites=sites))

    created = asyncio.run(networking.create_networking_site({
        "name": "Example Site",
        "controller_url": "https://controller.example.test/",
        "username": "unifi-admin",
        "password": "never-return-this",
        "verify_ssl": True,
    }, current_user={"id": "operator-1"}))

    assert created["status"] == "pending_sync"
    assert created["controller_url"] == "https://controller.example.test"
    assert "password" not in created
    assert sites.inserted[0]["password"] == "never-return-this"


def test_lifecycle_reads_the_canonical_inventory_register(monkeypatch):
    assets = NetworkRows([{
        "id": "asset-1", "name": "Firewall", "asset_type": "network",
        "cost": 900, "status": "active", "created_at": "2026-01-01T00:00:00+00:00",
    }])
    # Deliberately omit asset_lifecycle: the lifecycle view must not reach for
    # the old, parallel collection.
    monkeypatch.setattr(asset_lifecycle, "db", SimpleNamespace(assets=assets))

    rows = asyncio.run(asset_lifecycle.get_all_lifecycle_assets(current_user={"id": "operator-1"}))

    assert len(rows) == 1
    assert rows[0]["id"] == "asset-1"
    assert rows[0]["lifecycle_stage"] == "active"
    assert rows[0]["asset_tag"].startswith("AST-")


def test_depreciation_only_uses_inventory_records_with_purchase_evidence(monkeypatch):
    assets = NetworkRows([
        {"id": "asset-1", "name": "Recorded laptop", "asset_type": "laptop", "purchase_date": "2022-01-01", "cost": 2400},
        {"id": "asset-2", "name": "Unknown acquisition", "asset_type": "laptop", "cost": 2400},
    ])
    # Deliberately omit devices: depreciation must not silently turn RMM
    # endpoints into inventory records.
    monkeypatch.setattr(asset_depreciation, "db", SimpleNamespace(assets=assets))

    result = asyncio.run(asset_depreciation.asset_depreciation(current_user={"id": "operator-1"}))

    assert result["stats"]["total"] == 1
    assert result["assets"][0]["id"] == "asset-1"
    assert result["assets"][0]["purchase_price"] == 2400


def test_procurement_does_not_invent_replacement_costs(monkeypatch):
    assets = NetworkRows([{
        "id": "asset-1", "name": "Expiring firewall", "asset_type": "network",
        "warranty_expiry": "2020-01-01", "client_name": "Example Client",
    }])
    monkeypatch.setattr(procurement_planner, "db", SimpleNamespace(
        assets=assets,
        devices=NetworkRows([]),
    ))

    result = asyncio.run(procurement_planner.get_procurement_recommendations(user={"id": "operator-1"}))

    assert result["stats"]["estimated_budget"] == 0
    assert result["stats"]["unknown_cost_count"] == 1
    assert result["recommendations"][0]["estimated_cost"] is None


def test_qr_batch_uses_inventory_assets_not_managed_devices(monkeypatch):
    assets = NetworkRows([{
        "id": "asset-1", "name": "Reception switch", "asset_tag": "NET-001",
        "asset_type": "network", "client_name": "Example Client",
    }])
    # Deliberately omit devices: QR Asset Tags must still work against the
    # inventory source they represent.
    monkeypatch.setattr(qr_assets, "db", SimpleNamespace(assets=assets))

    labels = asyncio.run(qr_assets.generate_batch_qr(current_user={"id": "operator-1"}))

    assert labels[0]["asset_tag"] == "NET-001"
    assert labels[0]["name"] == "Reception switch"
    assert labels[0]["qr_image"].startswith("data:image/png;base64,")


def test_expiry_dashboard_counts_asset_warranties_from_inventory(monkeypatch):
    due_date = (datetime.now(timezone.utc) + timedelta(days=7)).date().isoformat()
    monkeypatch.setattr(infrastructure, "db", SimpleNamespace(
        assets=NetworkRows([{"id": "asset-1", "warranty_expiry": due_date}]),
        software_licenses=CountRows(),
        domains=CountRows(),
        ssl_certificates=CountRows(),
    ))

    dashboard = asyncio.run(infrastructure.get_expiry_dashboard(current_user={"id": "operator-1"}))

    assert dashboard["warranties"]["expiring_soon"] == 1
    assert dashboard["total_expiring"] == 1


def test_client_budget_overview_never_seeds_financial_plans(monkeypatch):
    monkeypatch.setattr(client_budget, "db", SimpleNamespace(client_budgets=NetworkRows([])))

    overview = asyncio.run(client_budget.budget_overview(current_user={"id": "operator-1"}))

    assert overview["budgets"] == []
    assert overview["summary"]["configured_clients"] == 0
    assert overview["summary"]["total_annual_budget"] == 0


def test_geo_map_is_retired_without_verified_location_telemetry():
    with pytest.raises(HTTPException) as retired:
        asyncio.run(geo_map.geo_map_data(current_user={"id": "operator-1"}))
    assert retired.value.status_code == 410
    assert "Dispatch availability" in retired.value.detail


class SettingsRows:
    def __init__(self, settings):
        self.settings = settings

    async def find_one(self, query, *_args, **_kwargs):
        if "type" in query:
            value = self.settings.get(query["type"])
            return dict(value) if value else None
        if query.get("key") == "rustdesk_config":
            return None
        return None


def test_integration_saved_credentials_are_not_reported_as_verified(monkeypatch):
    settings = SettingsRows({
        "huntress": {
            "type": "huntress",
            "api_key": "configured-key",
            "secret_key": "configured-secret",
        },
    })
    monkeypatch.setattr(integrations_overview, "db", SimpleNamespace(settings=settings))

    overview = asyncio.run(integrations_overview.integrations_overview(current_user={"id": "operator-1"}))
    huntress = next(tile for tile in overview["tiles"] if tile["key"] == "huntress")

    assert huntress["configured"] is True
    assert huntress["connection_state"] == "configured_unverified"
    assert overview["verified_count"] == 0
    assert "api_key" not in huntress


def test_integration_failed_test_requires_attention(monkeypatch):
    settings = SettingsRows({
        "huntress": {
            "type": "huntress",
            "api_key": "configured-key",
            "secret_key": "configured-secret",
            "last_test_status": "Authentication failed",
        },
    })
    monkeypatch.setattr(integrations_overview, "db", SimpleNamespace(settings=settings))

    overview = asyncio.run(integrations_overview.integrations_overview(current_user={"id": "operator-1"}))
    huntress = next(tile for tile in overview["tiles"] if tile["key"] == "huntress")

    assert huntress["connection_state"] == "failed"
    assert overview["attention_count"] == 1


def test_nexus_elevate_enforced_allow_requires_exact_path_and_hash():
    with pytest.raises(HTTPException) as incomplete:
        permission_elevation._policy_payload({
            "name": "Unsafe automatic updater",
            "action": "allow",
            "mode": "enforce",
            "match": {"program_path": r"C:\Program Files\Vendor\updater.exe"},
        })

    assert incomplete.value.status_code == 400
    assert "path and SHA-256" in incomplete.value.detail

    policy = permission_elevation._policy_payload({
        "name": "Pinned vendor updater",
        "action": "allow",
        "mode": "enforce",
        "scope": {"client_ids": ["client-1"], "device_ids": ["agent-1"]},
        "match": {
            "program_path": r"C:\Program Files\Vendor\updater.exe",
            "sha256": "a" * 64,
            "arguments_contains": ["/quiet"],
        },
    })
    matches, reasons = permission_elevation._policy_matches(policy, {
        "client_id": "client-1",
        "device_id": "agent-1",
        "program_path": r"C:\Program Files\Vendor\updater.exe",
        "sha256": "a" * 64,
        "arguments": ["/quiet", "/norestart"],
    })

    assert matches is True
    assert {"client scope", "endpoint scope", "exact executable path", "SHA-256 fingerprint", "argument conditions"} == set(reasons)


def test_shadow_it_demo_seed_is_retired_without_overwriting_agent_inventory():
    with pytest.raises(HTTPException) as retired:
        asyncio.run(shadow_it.seed_demo(current_user={"id": "operator-1"}))

    assert retired.value.status_code == 410
    assert "Nexus Agent" in retired.value.detail


def test_zero_trust_never_seeds_random_policies_or_trust_scores():
    with pytest.raises(HTTPException) as retired:
        asyncio.run(zero_trust.zero_trust_overview(current_user={"id": "operator-1"}))

    assert retired.value.status_code == 410
    assert "Microsoft Conditional Access" in retired.value.detail


def test_dark_web_monitor_never_generates_security_findings_without_a_provider():
    with pytest.raises(HTTPException) as retired:
        asyncio.run(dark_web_monitor.dark_web_overview(current_user={"id": "operator-1"}))

    assert retired.value.status_code == 410
    assert "breach-intelligence provider" in retired.value.detail


def test_phishing_simulation_never_generates_campaign_metrics_without_delivery_tracking():
    with pytest.raises(HTTPException) as retired:
        asyncio.run(phishing_sim.get_campaigns(current_user={"id": "operator-1"}))

    assert retired.value.status_code == 410
    assert "mail-delivery and tracking provider" in retired.value.detail


def test_identity_threats_stay_empty_without_a_provider():
    overview = asyncio.run(identity_threats.get_identity_overview(current_user={"id": "operator-1"}))

    assert overview["source_configured"] is False
    assert overview["threats"] == []
    assert overview["summary"]["total_alerts"] == 0


def test_legacy_soc_generated_endpoints_are_retired():
    with pytest.raises(HTTPException) as retired:
        asyncio.run(soc.get_huntress_dashboard(user={"id": "operator-1"}))

    assert retired.value.status_code == 410
    assert "generated security data" in retired.value.detail


def test_soc_cannot_claim_database_only_endpoint_isolation():
    assert not hasattr(soc, "generate_mock_agents")
    assert not hasattr(soc, "generate_mock_incidents")

    with pytest.raises(HTTPException) as retired:
        asyncio.run(soc.isolate_endpoint("alert-1", {}, user={"id": "operator-1"}))
    assert retired.value.status_code == 410
    assert "agent-backed containment" in retired.value.detail


def test_response_runbooks_do_not_claim_automatic_execution_or_seeded_history():
    assert remediation_playbooks.RESPONSE_TEMPLATES
    assert all(template["execution_mode"] == "guided" for template in remediation_playbooks.RESPONSE_TEMPLATES)
    assert all("executions" not in template and "last_executed" not in template for template in remediation_playbooks.RESPONSE_TEMPLATES)

    with pytest.raises(HTTPException) as retired:
        asyncio.run(remediation_playbooks.execute_playbook("template-ransomware-containment", current_user={"id": "operator-1"}))

    assert retired.value.status_code == 410
    assert "guided response" in retired.value.detail


def test_tabletop_templates_are_static_guidance_not_invented_drill_metrics():
    assert ransomware_tabletop.TABLETOP_TEMPLATES
    assert all("times_run" not in template and "avg_score_pct" not in template for template in ransomware_tabletop.TABLETOP_TEMPLATES)
    assert ransomware_tabletop._template_for("tabletop-ransomware-containment")["phases"]

    with pytest.raises(HTTPException) as missing:
        ransomware_tabletop._template_for("made-up-template")
    assert missing.value.status_code == 404


def test_disaster_recovery_plan_requires_realistic_recovery_objectives():
    assert pro_pack.DR_SCENARIO_TEMPLATES
    assert pro_pack._dr_positive_hours("4", "RTO") == 4.0

    with pytest.raises(HTTPException) as invalid:
        pro_pack._dr_positive_hours(0, "RTO")
    assert invalid.value.status_code == 400


class ShadowItRows:
    def __init__(self, rows):
        self.rows = [dict(row) for row in rows]
        self.deleted = []
        self.inserted = []

    def find(self, query=None, *_args, **_kwargs):
        query = query or {}
        rows = self.rows
        for key, expected in query.items():
            if isinstance(expected, dict) and "$in" in expected:
                rows = [row for row in rows if row.get(key) in expected["$in"]]
            elif not isinstance(expected, dict):
                rows = [row for row in rows if row.get(key) == expected]
        return ListCursor(rows)

    async def find_one(self, query, *_args, **_kwargs):
        for row in self.find(query).rows:
            return dict(row)
        return None

    async def delete_many(self, query):
        self.deleted.append(dict(query))
        return SimpleNamespace(deleted_count=0)

    async def insert_many(self, docs):
        self.inserted.extend(dict(doc) for doc in docs)
        return SimpleNamespace(inserted_ids=[doc.get("id") for doc in docs])


def test_shadow_it_scans_canonical_agent_software_inventory(monkeypatch):
    findings = ShadowItRows([])
    monkeypatch.setattr(shadow_it, "db", SimpleNamespace(
        clients=ShadowItRows([{"id": "client-1", "name": "Example Client"}]),
        shadow_it_baselines=ShadowItRows([]),
        devices=ShadowItRows([{
            "id": "device-1", "client_id": "client-1", "name": "Example PC",
            # The old compact field is deliberately empty; the agent collection
            # below is the source Shadow IT must consume.
            "installed_software": [], "os": "Windows 11",
        }]),
        device_software=ShadowItRows([{
            "device_id": "device-1", "name": "AnyDesk", "source": "nexus-agent",
        }]),
        shadow_it_findings=findings,
    ))

    result = asyncio.run(shadow_it._scan_client("client-1"))

    assert result["devices_with_agent_inventory"] == 1
    assert result["devices_with_legacy_inventory"] == 0
    assert result["findings"] == 1
    assert findings.inserted[0]["app"] == "AnyDesk"
    assert findings.inserted[0]["inventory_sources"] == ["nexus-agent"]
