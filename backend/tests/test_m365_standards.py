from app.services.m365_standards import build_tenant_standards


def _hygiene(**overrides):
    base = {
        "evidence_state": "evidence_available",
        "breakdown": {
            "mfa_coverage": {"status": "assessed"}, "modern_auth": {"status": "assessed"},
            "admin_sprawl": {"status": "assessed"}, "license_efficiency": {"status": "assessed"},
            "stale_users": {"status": "assessed"},
        },
        "counts": {"mfa_coverage_pct": 98, "has_mfa_policy": True, "global_admins": 2, "unlicensed_active": 0, "stale_users": 0},
    }
    base.update(overrides)
    return base


def test_m365_standard_reports_conforming_only_with_assessed_evidence():
    result = build_tenant_standards({"id": "client-1", "name": "Acme", "cipp_tenant_id": "tenant-1"}, _hygiene())
    assert result["summary"]["state"] == "conforming"
    assert result["summary"]["conforming"] == 5


def test_m365_standard_surfaces_drift_without_remediating():
    hygiene = _hygiene(counts={"mfa_coverage_pct": 60, "has_mfa_policy": False, "global_admins": 6, "unlicensed_active": 2, "stale_users": 3})
    result = build_tenant_standards({"id": "client-1", "name": "Acme", "cipp_tenant_id": "tenant-1"}, hygiene)
    assert result["summary"]["drift"] == 5
    assert len(result["findings"]) == 5
    assert all(finding["route"] == "/control-plane?module=microsoft365&view=security" for finding in result["findings"])


def test_m365_standard_preserves_unknowns_when_no_evidence_exists():
    result = build_tenant_standards({"id": "client-1", "name": "Acme", "cipp_tenant_id": "tenant-1"})
    assert result["summary"]["evidence_gaps"] == 1
    assert result["controls"][0]["status"] == "not_assessed"
