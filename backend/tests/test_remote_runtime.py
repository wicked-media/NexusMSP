from fastapi import HTTPException

from app.services.remote_runtime import (
    build_rustdesk_uri,
    normalise_session_type,
    parse_datetime,
    ticket_links_device,
)


def test_rustdesk_uri_uses_configured_relay_without_credentials():
    uri = build_rustdesk_uri(
        "842931675",
        "https://relay.nexus.example:21117/path",
        "https://fallback.nexus.example",
    )
    assert uri == "rustdesk://842931675@relay.nexus.example"
    assert "password" not in uri


def test_rustdesk_uri_falls_back_to_server_then_plain_identity():
    assert build_rustdesk_uri("42", None, "id.nexus.example:21116") == "rustdesk://42@id.nexus.example"
    assert build_rustdesk_uri("42") == "rustdesk://42"


def test_remote_session_types_are_an_explicit_allow_list():
    assert normalise_session_type("TERMINAL") == "terminal"
    try:
        normalise_session_type("arbitrary-shell")
    except HTTPException as exc:
        assert exc.status_code == 422
    else:
        raise AssertionError("unsupported session type should be rejected")


def test_ticket_device_link_supports_primary_and_multiple_assets():
    assert ticket_links_device({"device_id": "device-1"}, "device-1")
    assert ticket_links_device({"device_ids": ["device-2", "device-3"]}, "device-3")
    assert not ticket_links_device({"device_id": "device-1"}, "device-9")


def test_session_timestamps_accept_zulu_and_reject_invalid_values():
    assert parse_datetime("2026-07-25T08:00:00Z").tzinfo is not None
    assert parse_datetime("not-a-date") is None
