from app.routers.channel_mode import _is_channel_admin
import pytest
from pydantic import ValidationError

from app.routers.deployment_hub import ConnectivityCheckRequest, DeploymentHeartbeat, EdgeResourceProfile, JumpAccessRequest, JumpLabGatewayRegister, _bundle_files, _edge_role_plan, _timestamp


def _deployment(kind: str) -> dict:
    return {
        "id": "deployment-test-001",
        "name": "Test deployment",
        "kind": kind,
        "public_url": "https://nexus.example.test",
    }


def test_channel_mode_requires_a_real_platform_administrator():
    assert _is_channel_admin({"role": "admin"}) is True
    assert _is_channel_admin({"role": "owner"}) is True
    assert _is_channel_admin({"is_admin": True}) is True
    assert _is_channel_admin({"role": "technician"}) is False


def test_backup_vault_bundle_keeps_kopia_private_and_protected():
    files = _bundle_files(_deployment("backup_vault"), "nxact_" + "a" * 32)
    compose = files["docker-compose.yml"]

    assert "--disable-csrf-token-checks" not in compose
    assert "--tls-cert-file=/app/config/tls/server.crt" in compose
    assert "--server-password=${KOPIA_SERVER_PASSWORD" in compose
    assert "${KOPIA_BIND_HOST:-127.0.0.1}" in compose
    assert "kopia-tls/README.txt" in files
    assert "KOPIA_SERVER_CONTROL_PASSWORD" in files[".env"]


def test_initial_bundle_contains_the_client_held_activation_code():
    activation_code = "nxact_" + "a" * 32
    files = _bundle_files(_deployment("edge"), activation_code)

    assert f"NEXUS_ACTIVATION_CODE={activation_code}" in files[".env"]
    assert "bootstrap.ps1" in files
    assert "bootstrap.sh" in files


def test_edge_role_plan_identifies_insufficient_appliance_capacity():
    plan = _edge_role_plan(
        ["backup_node", "syslog_collector"],
        EdgeResourceProfile(cpu_cores=2, memory_gb=4, storage_gb=512, lan_visibility=True),
    )

    assert plan["ready"] is False
    assert plan["requirements"]["storage_gb"] == 2304
    assert any("CPU" in gap for gap in plan["gaps"])
    assert any("persistent storage" in gap for gap in plan["gaps"])


def test_edge_bundle_carries_only_the_role_capacity_plan_not_a_health_claim():
    deployment = _deployment("edge") | {
        "edge_roles": ["discovery_probe"],
        "edge_role_plan": {"requirements": {"cpu_cores": 1, "memory_gb": 1, "storage_gb": 10}},
    }

    files = _bundle_files(deployment, "nxact_" + "a" * 32)

    assert "NEXUS_EDGE_PLANNED_CPU_CORES=1" in files[".env"]
    assert "NEXUS_EDGE_PLANNED_STORAGE_GB=10" in files[".env"]
    assert "healthy" not in files[".env"]


def test_jump_role_bundle_defaults_transport_to_disabled():
    deployment = _deployment("edge") | {"edge_roles": ["jump_gateway"]}

    files = _bundle_files(deployment, "nxact_" + "a" * 32)

    assert "NEXUS_JUMP_TRANSPORT=disabled" in files[".env"]
    assert "nexus-jump/README.md" in files
    assert "does **not** enable a WireGuard tunnel" in files["nexus-jump/README.md"]


def test_site_pulse_is_bounded_to_the_edge_control_plane():
    heartbeat = DeploymentHeartbeat(
        deployment_id="deployment-test-001",
        instance_id="edge-test-001",
        site_pulse={
            "scope": "edge_to_control_plane",
            "control_plane_dns": "healthy",
            "control_plane_transport": "healthy",
            "latency_ms": 42,
            "observed_at": "2026-08-12T10:42:00Z",
        },
    )

    assert heartbeat.site_pulse.scope == "edge_to_control_plane"
    assert heartbeat.site_pulse.latency_ms == 42


def test_connectivity_check_contract_is_host_port_not_an_arbitrary_command():
    request = ConnectivityCheckRequest(
        deployment_id="deployment-test-001",
        ticket_id="TKT-1042",
        target_host="sql01.internal.example",
        target_port=443,
        require_tls=True,
    )

    assert request.target_host == "sql01.internal.example"
    assert request.target_port == 443
    assert request.require_tls is True


def test_jump_access_contract_stays_time_and_protocol_bound():
    request = JumpAccessRequest(
        deployment_id="deployment-test-001",
        ticket_id="TKT-1042",
        target_host="nas01.internal.example",
        target_port=443,
        protocol="https",
        duration_minutes=30,
        reason="Apply the approved storage configuration change.",
    )

    assert request.protocol == "https"
    assert request.duration_minutes == 30


def test_edge_heartbeat_accepts_transport_evidence_without_claiming_access():
    heartbeat = DeploymentHeartbeat(
        deployment_id="deployment-test-001",
        instance_id="edge-test-001",
        jump_transport={"wireguard": "configured_no_session"},
    )

    assert heartbeat.jump_transport["wireguard"] == "configured_no_session"


def _jump_lab_policy() -> dict:
    return {
        "gateway_id": "nexus-jump-lab-au-01",
        "display_name": "Nexus Jump AU lab gateway",
        "environment": "lab",
        "endpoint": "jump-lab.example.test:51820",
        "public_key": "A" * 44,
        "allowed_resource_cidrs": ["10.42.10.0/24"],
        "allowed_protocols": ["https", "ssh"],
        "maximum_session_minutes": 60,
        "approval_required": True,
        "ticket_required": True,
    }


def test_jump_lab_gateway_policy_is_public_metadata_with_a_strict_boundary():
    policy = JumpLabGatewayRegister(**_jump_lab_policy())

    assert policy.environment == "lab"
    assert policy.ticket_required is True
    assert policy.approval_required is True
    assert policy.allowed_resource_cidrs == ["10.42.10.0/24"]


def test_jump_lab_gateway_policy_rejects_a_broad_route():
    policy = _jump_lab_policy()
    policy["allowed_resource_cidrs"] = ["0.0.0.0/0"]

    with pytest.raises(ValidationError, match="least-privilege"):
        JumpLabGatewayRegister(**policy)


def test_deployment_timestamp_parser_rejects_invalid_activation_windows():
    assert _timestamp("2026-08-07T00:00:00+00:00") is not None
    assert _timestamp("not-a-timestamp") is None
    assert _timestamp(None) is None
