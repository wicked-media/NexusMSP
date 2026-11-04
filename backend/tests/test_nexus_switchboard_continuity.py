from pathlib import Path

import pytest
from pydantic import ValidationError

from app.routers.nexus_continuity import RecoveryProfileUpdate, RestorePointEvidence, router as continuity_router
from app.routers.nexus_switchboard import SwitchboardPlanCreate, router as switchboard_router
from app.services.action_permissions import ACTION_PERMISSION_IDS, default_permissions_for_role
from app.services.nexus_switchboard import build_plan, recalculate_plan
from app.services.platform_recovery import build_default_profile, public_profile, recovery_status


def _admin() -> dict:
    return {"id": "admin-1", "email": "owner@nexus.example", "role": "admin", "is_admin": True}


def test_switchboard_plan_uses_stable_identity_and_stays_planning_only():
    plan = build_plan(
        plan_id="plan-1",
        payload={"name": "Syncro pilot", "provider": "syncro", "scope": ["Clients", "devices", "tickets"]},
        actor=_admin(),
        now="2026-09-02T00:00:00+00:00",
    )

    assert plan["execution_boundary"] == "planning_only"
    assert plan["stage"] == "source"
    assert plan["scope"] == ["clients", "devices", "tickets"]
    assert all(item["source_identity"] == "source_system + immutable_external_id" for item in plan["mappings"])
    assert all("Nexus" in item["nexus_identity"] for item in plan["mappings"])


def test_switchboard_plan_only_becomes_review_ready_after_all_evidence_gates():
    plan = build_plan(
        plan_id="plan-2",
        payload={"name": "Halo pilot", "provider": "halo_psa", "scope": ["clients"]},
        actor=_admin(),
    )
    plan["source_readiness"] = {"state": "fixture_verified", "evidence_reference": "fixture-2026-09", "note": "Sandbox fixture"}
    plan["mappings"][0]["status"] = "reviewed"
    plan["reconciliation"] = [{"id": item["id"], "complete": True, "evidence": "reviewed"} for item in plan["reconciliation"]]
    plan["cutover"] = [{"id": item["id"], "complete": True, "evidence": "reviewed"} for item in plan["cutover"]]

    reviewed = recalculate_plan(plan)

    assert reviewed["stage"] == "proof"
    assert reviewed["status"] == "review_ready"
    assert reviewed["execution_boundary"] == "planning_only"


def test_switchboard_create_normalises_human_scope_labels():
    payload = SwitchboardPlanCreate(name="CSV migration", provider="csv_export", scope=["Clients", "Contacts"])
    assert payload.scope == ["clients", "contacts"]


def test_switchboard_rejects_unknown_provider_and_scope():
    with pytest.raises(ValidationError):
        SwitchboardPlanCreate(name="Unsafe", provider="unknown", scope=["clients"])
    with pytest.raises(ValidationError):
        SwitchboardPlanCreate(name="Unsafe", provider="syncro", scope=["people"])


def test_platform_recovery_profile_does_not_claim_configuration_without_attestations():
    profile = build_default_profile(actor=_admin())
    assert public_profile(profile)["configured"] is False
    profile.update({
        "enabled": True,
        "destination_type": "object_lock_storage",
        "destination_name": "AU immutable vault",
        "immutable_storage_attested": True,
        "encryption_attested": True,
    })
    assert public_profile(profile)["configured"] is True


def test_platform_recovery_status_requires_isolated_restore_proof():
    profile = build_default_profile(actor=_admin())
    profile.update({
        "enabled": True,
        "destination_type": "object_lock_storage",
        "destination_name": "AU immutable vault",
        "immutable_storage_attested": True,
        "encryption_attested": True,
    })
    point = {"id": "point-1", "status": "captured_unverified"}

    assert recovery_status(profile, point, None)["status"] == "restore_verification_required"
    assert recovery_status(profile, point, {"id": "run-1", "status": "passed"})["status"] == "verified"


def test_recovery_evidence_requires_sha256_and_recovery_policy_validates_destination():
    with pytest.raises(ValidationError):
        RestorePointEvidence(
            storage_reference="vault/path",
            package_checksum="not-a-checksum",
            package_bytes=1,
            file_count=1,
            captured_at="2026-09-02T00:00:00Z",
            release_reference="nexus-api:test",
        )
    with pytest.raises(ValidationError):
        RecoveryProfileUpdate(destination_type="untrusted_destination")


def test_switchboard_and_recovery_actions_are_explicit_and_not_technician_defaults():
    expected = {
        "platform.migration.view",
        "platform.migration.manage",
        "platform.recovery.view",
        "platform.recovery.manage",
        "platform.recovery.restore",
    }
    assert expected.issubset(ACTION_PERMISSION_IDS)
    technician = default_permissions_for_role("technician")
    assert expected.isdisjoint(technician)


def test_new_platform_routes_and_host_recovery_scripts_are_present():
    switchboard_paths = {route.path for route in switchboard_router.routes}
    continuity_paths = {route.path for route in continuity_router.routes}
    assert "/nexus-switchboard/overview" in switchboard_paths
    assert "/nexus-continuity/overview" in continuity_paths

    root = Path(__file__).resolve().parents[2]
    assert (root / "scripts" / "Export-NexusPlatformRecovery.ps1").is_file()
    assert (root / "scripts" / "Import-NexusPlatformRecovery.ps1").is_file()
    assert (root / "docs" / "PLATFORM_RECOVERY_RUNBOOK.md").is_file()


def test_production_compose_keeps_each_recovery_artifact_path_durable():
    root = Path(__file__).resolve().parents[2]
    compose = (root / "docker-compose.production.yml").read_text(encoding="utf-8")

    assert "nexus-mongo:/data/db" in compose
    assert "nexus-uploads:/app/uploads" in compose
    assert "nexus-private-uploads:/app/private_uploads" in compose
    assert "nexus-installers:/app/data/agent-installers" in compose
