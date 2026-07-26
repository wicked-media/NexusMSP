from app.services.portal_audit import safe_metadata


def test_portal_audit_metadata_removes_secrets_recursively():
    cleaned = safe_metadata({
        "authentication_method": "password_mfa",
        "token": "do-not-store",
        "nested": {
            "totp_secret": "do-not-store",
            "email_status": "sent",
        },
    })

    assert cleaned == {
        "authentication_method": "password_mfa",
        "nested": {"email_status": "sent"},
    }


def test_portal_audit_metadata_retains_operational_evidence():
    cleaned = safe_metadata({
        "changed_fields": ["role", "can_view_invoices"],
        "outcome": "success",
        "link_id": "link-123",
    })

    assert cleaned["changed_fields"] == ["role", "can_view_invoices"]
    assert cleaned["outcome"] == "success"
    assert cleaned["link_id"] == "link-123"
