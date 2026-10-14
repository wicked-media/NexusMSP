"""Regression checks for settings that affect generated customer documents."""

from __future__ import annotations

from reportlab import rl_config

from app.services.nexus_document_pdf import render_nexus_invoice_pdf


def test_invoice_header_and_footer_branding_are_rendered_in_the_shared_pdf():
    previous_compression = rl_config.pageCompression
    rl_config.pageCompression = 0
    try:
        rendered = render_nexus_invoice_pdf(
            {
                "invoice_number": "INV-SETTINGS-01",
                "client_name": "Example Client",
                "total": 125,
                "line_items": [{"name": "Managed service", "quantity": 1, "unit_price": 125}],
            },
            branding={
                "company_name": "Nexus Test",
                "invoice_header_text": "Nexus Test Pty Ltd | ABN 12 345 678 901",
                "invoice_footer_text": "Payment terms: Net 14",
            },
        )
    finally:
        rl_config.pageCompression = previous_compression

    assert b"Nexus Test Pty Ltd | ABN 12 345 678 901" in rendered
    assert b"Payment terms: Net 14" in rendered
