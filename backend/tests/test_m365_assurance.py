from app.services.m365_assurance import build_tenant_assurance


def test_assurance_reports_unknowns_without_fabricating_passes():
    assurance = build_tenant_assurance(
        {"id": "client-1", "name": "Acme", "cipp_tenant_id": "tenant-1"},
        provider_configured=False,
    )

    assert assurance["summary"]["verified_controls"] == 1
    assert assurance["summary"]["evidence_gaps"] >= 3
    assert any(check["key"] == "licence_billing" and check["state"] == "not_assessed" for check in assurance["checks"])


def test_assurance_surfaces_hygiene_risks_as_review_findings():
    assurance = build_tenant_assurance(
        {"id": "client-1", "name": "Acme", "cipp_tenant_id": "tenant-1"},
        {
            "evidence_state": "evidence_available",
            "evidence_coverage_pct": 92,
            "risks": [{"factor": "MFA coverage only 64%", "severity": "critical"}],
        },
        provider_configured=True,
    )

    identity_check = next(check for check in assurance["checks"] if check["key"] == "identity_hygiene")
    assert identity_check["state"] == "verified"
    assert any(finding["severity"] == "critical" for finding in assurance["findings"])


def test_assurance_requires_mapping_before_claiming_tenant_scope():
    assurance = build_tenant_assurance({"id": "client-1", "name": "Acme"})

    binding = next(check for check in assurance["checks"] if check["key"] == "tenant_binding")
    assert binding["state"] == "needs_attention"
    assert any(finding["key"] == "tenant_unmapped" for finding in assurance["findings"])
