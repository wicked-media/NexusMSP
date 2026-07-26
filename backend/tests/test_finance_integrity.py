from app.services.finance_integrity import (
    normalise_invoice_document,
    normalise_invoice_line_item,
)
from app.services.procurement_integrity import version_filter


def test_legacy_invoice_line_is_normalised_without_losing_source_fields():
    line = normalise_invoice_line_item({
        "description": "Managed service",
        "quantity": 2,
        "rate": 125,
        "amount": 250,
        "external_reference": "legacy-1",
    })

    assert line["name"] == "Managed service"
    assert line["unit_price"] == 125
    assert line["total"] == 250
    assert line["external_reference"] == "legacy-1"


def test_invoice_document_normalises_every_line():
    invoice = normalise_invoice_document({
        "id": "invoice-1",
        "line_items": [
            {"name": "Current", "quantity": 1, "unit_price": 50, "total": 50},
            {"description": "Legacy", "quantity": 3, "rate": 20, "amount": 60},
        ],
    })

    assert [line["unit_price"] for line in invoice["line_items"]] == [50, 20]
    assert [line["total"] for line in invoice["line_items"]] == [50, 60]


def test_version_filter_supports_legacy_and_versioned_purchase_orders():
    assert version_filter({"version": 4}) == {"version": 4}
    assert version_filter({}) == {"version": {"$exists": False}}
