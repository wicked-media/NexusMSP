from app.services.m365_assurance import build_tenant_assurance
from app.services.m365_billing_assurance import build_m365_billing_assurance


CLIENT = {"id": "client-1", "name": "Acme", "cipp_tenant_id": "tenant-1"}


def _provider(sku_id="sku-business-premium", purchased=12, consumed=9):
    return {
        "skuId": sku_id,
        "skuPartNumber": "SPE_E3",
        "prepaidUnits": {"enabled": purchased},
        "consumedUnits": consumed,
    }


def _inclusion(sku_id="sku-business-premium", quantity=12, line_id="line-1"):
    return {
        "id": line_id,
        "client_id": "client-1",
        "contract_id": "contract-1",
        "linked_recurring_invoice_id": "ri-1",
        "name": "Microsoft 365 Business Premium",
        "quantity": quantity,
        "m365_sku_id": sku_id,
        "m365_sku_part_number": "SPE_E3",
    }


def _recurring(line_id="line-1"):
    return {
        "id": "ri-1",
        "client_id": "client-1",
        "status": "active",
        "line_items": [{"source_line_item_id": line_id, "quantity": 12}],
    }


def test_billing_assurance_never_name_matches_a_provider_sku():
    result = build_m365_billing_assurance(
        CLIENT,
        provider_licenses=[_provider()],
        billing_inclusions=[{
            "id": "line-1",
            "client_id": "client-1",
            "name": "Microsoft 365 Business Premium",  # Same display name is insufficient.
            "quantity": 12,
        }],
        recurring_invoices=[_recurring()],
    )

    assert result["summary"]["reconciled_skus"] == 0
    assert result["checks"][0]["state"] == "needs_attention"
    assert any(finding["key"].startswith("provider_sku_unmapped:") for finding in result["findings"])


def test_billing_assurance_reconciles_only_explicit_sku_and_recurring_line_identity():
    result = build_m365_billing_assurance(
        CLIENT,
        provider_licenses=[_provider()],
        billing_inclusions=[_inclusion()],
        recurring_invoices=[_recurring()],
    )

    assert result["summary"]["reconciled_skus"] == 1
    assert result["comparisons"][0]["mapping_state"] == "reconciled"
    assert result["comparisons"][0]["billed"] == 12
    assert result["checks"][0]["state"] == "verified"


def test_billing_assurance_marks_quantity_mismatch_for_review_without_mutating_records():
    result = build_m365_billing_assurance(
        CLIENT,
        provider_licenses=[_provider(purchased=15)],
        billing_inclusions=[_inclusion(quantity=12)],
        recurring_invoices=[_recurring()],
    )

    assert result["comparisons"][0]["mapping_state"] == "quantity_mismatch"
    assert any(finding["key"].startswith("quantity_mismatch:") for finding in result["findings"])
    assert result["checks"][0]["state"] == "needs_attention"


def test_billing_assurance_requires_recurring_sync_before_claiming_billed_inclusion():
    result = build_m365_billing_assurance(
        CLIENT,
        provider_licenses=[_provider()],
        billing_inclusions=[_inclusion()],
        recurring_invoices=[{"id": "ri-1", "client_id": "client-1", "status": "active", "line_items": []}],
    )

    assert result["comparisons"][0]["mapping_state"] == "mapped_not_billed"
    assert result["comparisons"][0]["billed"] is None
    assert any(finding["key"].startswith("mapping_not_synced:") for finding in result["findings"])


def test_assurance_uses_billing_evidence_when_available():
    billing = build_m365_billing_assurance(
        CLIENT,
        provider_licenses=[_provider()],
        billing_inclusions=[_inclusion()],
        recurring_invoices=[_recurring()],
    )
    result = build_tenant_assurance(CLIENT, billing_assurance=billing)

    check = next(check for check in result["checks"] if check["key"] == "licence_billing")
    assert check["state"] == "verified"
