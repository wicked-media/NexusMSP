"""Disposable, authenticated API acceptance coverage for two client scopes.

This module never targets a normal Nexus environment.  It only runs when the
disposable acceptance runner explicitly supplies both ``NEXUS_TEST_ENVIRONMENT``
and ``NEXUS_ACCEPTANCE_BASE_URL``.  The runner bootstraps random accounts into
an empty, in-memory MongoDB container and removes that environment afterwards.
"""

from __future__ import annotations

import os
import secrets
import uuid
from typing import Any

import pytest
import requests


def _flag_enabled(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


@pytest.fixture(scope="module")
def acceptance_base_url() -> str:
    """Return the deliberately supplied isolated API target, or skip safely."""
    base_url = os.getenv("NEXUS_ACCEPTANCE_BASE_URL", "").strip().rstrip("/")
    if not base_url:
        pytest.skip("Nexus disposable API acceptance environment is not configured.")
    if not _flag_enabled("NEXUS_TEST_ENVIRONMENT"):
        raise pytest.UsageError(
            "NEXUS_ACCEPTANCE_BASE_URL requires NEXUS_TEST_ENVIRONMENT=1; "
            "refusing to run mutable acceptance probes against an unmarked API."
        )
    return base_url


def _password() -> str:
    """Create an ephemeral password that satisfies Nexus' server policy."""
    return f"Nexus!A9-{secrets.token_urlsafe(20)}"


def _email(label: str) -> str:
    # Pydantic's current email validator correctly rejects reserved ``.test``
    # domains.  This request never sends email, but use a syntactically valid
    # non-deliverability-checked documentation domain so the API exercises the
    # actual authentication and client-scope flow.
    return f"nexus-acceptance-{label}-{uuid.uuid4().hex[:12]}@example.com"


def _response_json(response: requests.Response, context: str) -> dict[str, Any] | list[Any]:
    try:
        return response.json()
    except ValueError as exc:
        raise AssertionError(f"{context}: expected JSON response, got HTTP {response.status_code}") from exc


def _expect_status(response: requests.Response, expected: int, context: str) -> dict[str, Any] | list[Any]:
    if response.status_code != expected:
        payload = _response_json(response, context)
        raise AssertionError(f"{context}: expected HTTP {expected}, got {response.status_code}: {payload}")
    return _response_json(response, context)


def _expect_denied(response: requests.Response, context: str) -> None:
    """Accept a policy denial or intentionally masked resource denial only."""
    if response.status_code not in {403, 404}:
        payload = _response_json(response, context)
        raise AssertionError(
            f"{context}: expected fail-closed HTTP 403 or 404, got {response.status_code}: {payload}"
        )


def _session_with_token(token: str) -> requests.Session:
    session = requests.Session()
    session.headers.update({"Authorization": f"Bearer {token}"})
    return session


def _register_bootstrap_admin(base_url: str) -> tuple[requests.Session, dict[str, Any]]:
    response = requests.post(
        f"{base_url}/api/auth/register",
        json={
            "email": _email("admin"),
            "name": "Nexus Acceptance Administrator",
            "password": _password(),
        },
        timeout=20,
    )
    payload = _expect_status(response, 200, "bootstrap administrator registration")
    assert isinstance(payload, dict)
    assert payload.get("token")
    assert isinstance(payload.get("user"), dict)
    return _session_with_token(str(payload["token"])), payload["user"]


def _create_client(session: requests.Session, base_url: str, name: str) -> dict[str, Any]:
    response = session.post(f"{base_url}/api/clients", json={"name": name}, timeout=20)
    payload = _expect_status(response, 200, f"create {name}")
    assert isinstance(payload, dict) and payload.get("id")
    return payload


def _create_device(
    session: requests.Session,
    base_url: str,
    *,
    client_id: str,
    name: str,
) -> dict[str, Any]:
    response = session.post(
        f"{base_url}/api/devices",
        json={"client_id": client_id, "name": name, "device_type": "workstation"},
        timeout=20,
    )
    payload = _expect_status(response, 200, f"create device {name}")
    assert isinstance(payload, dict) and payload.get("id")
    return payload


def _create_ticket(
    session: requests.Session,
    base_url: str,
    *,
    client_id: str,
    device_id: str,
    title: str,
) -> dict[str, Any]:
    response = session.post(
        f"{base_url}/api/tickets",
        json={
            "client_id": client_id,
            "device_id": device_id,
            "title": title,
            "description": "Disposable API acceptance evidence.",
            "priority": "medium",
        },
        timeout=20,
    )
    payload = _expect_status(response, 200, f"create ticket {title}")
    assert isinstance(payload, dict) and payload.get("id")
    return payload


def _create_scoped_technician(
    session: requests.Session,
    base_url: str,
    *,
    client_id: str,
    label: str,
    role: str = "technician",
) -> tuple[requests.Session, dict[str, Any]]:
    email = _email(label)
    password = _password()
    create_response = session.post(
        f"{base_url}/api/technicians",
        json={
            "name": f"Nexus Acceptance {label.title()} Technician",
            "email": email,
            "password": password,
            "role": role,
            "client_scope_mode": "restricted",
            "client_scope_ids": [client_id],
            "site_scope_ids": [],
        },
        timeout=20,
    )
    created = _expect_status(create_response, 200, f"create restricted {label} technician")
    assert isinstance(created, dict) and created.get("id")

    login_response = requests.post(
        f"{base_url}/api/auth/login",
        json={"email": email, "password": password},
        timeout=20,
    )
    login = _expect_status(login_response, 200, f"authenticate restricted {label} technician")
    assert isinstance(login, dict) and login.get("token")
    return _session_with_token(str(login["token"])), created


def _create_xero_invoice(
    session: requests.Session,
    base_url: str,
    *,
    client_id: str,
    reference: str,
) -> dict[str, Any]:
    response = session.post(
        f"{base_url}/api/xero/invoices",
        json={
            "client_id": client_id,
            "reference": reference,
            "line_items": [{"description": "Acceptance managed service", "quantity": 1, "unit_price": 100}],
        },
        timeout=20,
    )
    payload = _expect_status(response, 200, f"create Xero mirror invoice {reference}")
    assert isinstance(payload, dict) and payload.get("id")
    return payload


def _create_verify_request(
    session: requests.Session,
    base_url: str,
    *,
    client_id: str,
    ticket_id: str,
    subject_name: str,
) -> dict[str, Any]:
    response = session.post(
        f"{base_url}/api/nexus-verify/requests",
        json={
            "client_id": client_id,
            "ticket_id": ticket_id,
            "subject_name": subject_name,
            "subject_email": "requester@example.com",
            "action_type": "mfa_reset",
            "justification": "Disposable two-client verification acceptance evidence.",
        },
        timeout=20,
    )
    payload = _expect_status(response, 200, f"open Nexus Verify request for {subject_name}")
    assert isinstance(payload, dict)
    assert isinstance(payload.get("request"), dict) and payload["request"].get("id")
    return payload["request"]


def _generate_portal_token(
    session: requests.Session,
    base_url: str,
    *,
    client_id: str,
    label: str,
) -> dict[str, Any]:
    """Create a short-lived, disposable client portal link for isolation probes."""
    response = session.post(
        f"{base_url}/api/client-portal/generate-token/{client_id}",
        json={
            "contact_name": f"Nexus Acceptance {label.title()} Contact",
            "contact_email": _email(f"portal-{label}"),
            "expiry_days": 1,
        },
        timeout=20,
    )
    payload = _expect_status(response, 200, f"create Client {label.title()} portal link")
    assert isinstance(payload, dict) and payload.get("token")
    assert isinstance(payload.get("entry"), dict) and payload["entry"].get("id")
    return payload


def _upload_client_document(
    session: requests.Session,
    base_url: str,
    *,
    client_id: str,
    title: str,
) -> dict[str, Any]:
    """Upload disposable evidence through the real client-artifact route."""
    response = session.post(
        f"{base_url}/api/clients/{client_id}/documents",
        data={"title": title, "category": "acceptance"},
        files={"file": ("acceptance-evidence.txt", b"Nexus acceptance evidence.", "text/plain")},
        timeout=20,
    )
    payload = _expect_status(response, 200, f"upload {title}")
    assert isinstance(payload, dict) and payload.get("id")
    return payload


def test_authenticated_two_client_api_acceptance(acceptance_base_url: str) -> None:
    """Prove Client A and Client B stay isolated behind authenticated APIs.

    This is deliberately a small, high-signal golden workflow: bootstrap an
    isolated tenant, create two client estates, sign in two restricted
    technicians, then prove both allowed work and rejected cross-client reads
    and mutations.  It does not call external integrations or read local data.
    """
    admin, _admin_user = _register_bootstrap_admin(acceptance_base_url)
    client_a = _create_client(admin, acceptance_base_url, "Acceptance Client A")
    client_b = _create_client(admin, acceptance_base_url, "Acceptance Client B")
    device_a = _create_device(
        admin, acceptance_base_url, client_id=str(client_a["id"]), name="Acceptance A-WS01"
    )
    device_b = _create_device(
        admin, acceptance_base_url, client_id=str(client_b["id"]), name="Acceptance B-WS01"
    )
    ticket_a = _create_ticket(
        admin,
        acceptance_base_url,
        client_id=str(client_a["id"]),
        device_id=str(device_a["id"]),
        title="Acceptance Client A endpoint check",
    )
    ticket_b = _create_ticket(
        admin,
        acceptance_base_url,
        client_id=str(client_b["id"]),
        device_id=str(device_b["id"]),
        title="Acceptance Client B endpoint check",
    )
    portal_a = _generate_portal_token(
        admin, acceptance_base_url, client_id=str(client_a["id"]), label="client-a"
    )
    portal_b = _generate_portal_token(
        admin, acceptance_base_url, client_id=str(client_b["id"]), label="client-b"
    )

    technician_a, technician_a_record = _create_scoped_technician(
        admin, acceptance_base_url, client_id=str(client_a["id"]), label="client-a"
    )
    technician_b, technician_b_record = _create_scoped_technician(
        admin, acceptance_base_url, client_id=str(client_b["id"]), label="client-b"
    )
    billing_technician_a, _billing_technician_a_record = _create_scoped_technician(
        admin,
        acceptance_base_url,
        client_id=str(client_a["id"]),
        label="client-a-billing",
        role="service_desk_manager",
    )

    # Nexus Verify is a sensitive client-scoped workflow, not a global caller
    # lookup. A legitimate request must retain the canonical customer/ticket
    # relationship, while a foreign technician cannot list or probe it.
    verify_request_a = _create_verify_request(
        technician_a,
        acceptance_base_url,
        client_id=str(client_a["id"]),
        ticket_id=str(ticket_a["id"]),
        subject_name="Acceptance Client A requester",
    )
    assert verify_request_a["client_id"] == client_a["id"]
    assert verify_request_a["ticket_id"] == ticket_a["id"]
    verify_overview_b = _expect_status(
        technician_b.get(f"{acceptance_base_url}/api/nexus-verify/overview", timeout=20),
        200,
        "Client B technician lists only Client B Nexus Verify requests",
    )
    assert isinstance(verify_overview_b, dict)
    assert verify_request_a["id"] not in {item["id"] for item in verify_overview_b.get("requests", [])}
    foreign_verify_probe = technician_b.post(
        f"{acceptance_base_url}/api/nexus-verify/requests/{verify_request_a['id']}/challenge",
        json={"method": "nexus_app"},
        timeout=20,
    )
    foreign_verify_payload = _expect_status(
        foreign_verify_probe,
        404,
        "Client B technician cannot enumerate Client A Nexus Verify request",
    )
    assert foreign_verify_payload == {"detail": "Resource not found"}
    _expect_denied(
        technician_a.post(
            f"{acceptance_base_url}/api/nexus-verify/requests",
            json={
                "client_id": client_b["id"],
                "ticket_id": ticket_b["id"],
                "subject_name": "Rejected foreign customer requester",
                "action_type": "mfa_reset",
            },
            timeout=20,
        ),
        "Client A technician opens Client B Nexus Verify request",
    )
    mismatched_ticket = technician_a.post(
        f"{acceptance_base_url}/api/nexus-verify/requests",
        json={
            "client_id": client_a["id"],
            "ticket_id": ticket_b["id"],
            "subject_name": "Rejected cross-client ticket requester",
            "action_type": "mfa_reset",
        },
        timeout=20,
    )
    mismatch_payload = _expect_status(
        mismatched_ticket,
        400,
        "Nexus Verify rejects a ticket owned by another client",
    )
    assert mismatch_payload == {"detail": "The linked ticket must belong to the selected customer"}

    # Allowed Client A work: read its records, add a time entry, then complete
    # a Work Session.  The server must ignore a forged user_id in the payload.
    _expect_status(
        technician_a.get(f"{acceptance_base_url}/api/clients/{client_a['id']}", timeout=20),
        200,
        "Client A technician reads Client A",
    )
    _expect_status(
        technician_a.get(f"{acceptance_base_url}/api/devices/{device_a['id']}", timeout=20),
        200,
        "Client A technician reads Client A device",
    )
    compare_a = _expect_status(
        technician_a.post(
            f"{acceptance_base_url}/api/devices/compare",
            json={"device_ids": [device_a["id"]]},
            timeout=20,
        ),
        200,
        "Client A technician compares Client A device",
    )
    assert isinstance(compare_a, dict)
    assert [row["device"]["id"] for row in compare_a.get("devices", [])] == [device_a["id"]]
    foreign_compare = technician_a.post(
        f"{acceptance_base_url}/api/devices/compare",
        json={"device_ids": [device_b["id"]]},
        timeout=20,
    )
    foreign_compare_payload = _expect_status(
        foreign_compare,
        404,
        "Client A technician cannot compare Client B device",
    )
    assert foreign_compare_payload == {"detail": "Resource not found"}
    missing_compare = technician_a.post(
        f"{acceptance_base_url}/api/devices/compare",
        json={"device_ids": ["missing-device-id"]},
        timeout=20,
    )
    missing_compare_payload = _expect_status(
        missing_compare,
        404,
        "Client A technician receives the same masked response for a missing device",
    )
    assert missing_compare_payload == foreign_compare_payload
    time_machine_a = _expect_status(
        technician_a.get(
            f"{acceptance_base_url}/api/devices/{device_a['id']}/time-machine",
            timeout=20,
        ),
        200,
        "Client A technician reads Client A Time Machine evidence",
    )
    assert isinstance(time_machine_a, dict) and time_machine_a.get("device", {}).get("id") == device_a["id"]
    foreign_time_machine = technician_a.get(
        f"{acceptance_base_url}/api/devices/{device_b['id']}/time-machine",
        timeout=20,
    )
    foreign_time_machine_payload = _expect_status(
        foreign_time_machine,
        404,
        "Client A technician cannot read Client B Time Machine evidence",
    )
    assert foreign_time_machine_payload == {"detail": "Resource not found"}
    foreign_dossier = technician_a.get(
        f"{acceptance_base_url}/api/devices/{device_b['id']}/dossier",
        timeout=20,
    )
    foreign_dossier_payload = _expect_status(
        foreign_dossier,
        404,
        "Client A technician cannot read Client B device dossier",
    )
    assert foreign_dossier_payload == foreign_time_machine_payload
    sites_map_a = _expect_status(
        technician_a.get(f"{acceptance_base_url}/api/devices/sites-map", timeout=20),
        200,
        "Client A technician sees only Client A sites on the device map",
    )
    assert isinstance(sites_map_a, dict)
    assert {row.get("client_id") for row in sites_map_a.get("sites", [])} <= {client_a["id"]}
    retired_bulk_actions = technician_a.get(
        f"{acceptance_base_url}/api/bulk-actions/actions",
        timeout=20,
    )
    retired_bulk_actions_payload = _expect_status(
        retired_bulk_actions,
        410,
        "Legacy bulk-device API is retired in favour of the governed workflow",
    )
    assert retired_bulk_actions_payload == {
        "detail": "Legacy bulk device actions are retired. Use the Managed Assets bulk-action workflow."
    }
    retired_automation = technician_a.get(
        f"{acceptance_base_url}/api/automation",
        timeout=20,
    )
    retired_automation_payload = _expect_status(
        retired_automation,
        410,
        "Legacy automation API is retired in favour of governed workflows",
    )
    assert retired_automation_payload == {
        "detail": "Legacy automation runbooks are retired. Use the governed Workflow Automation workspace and /api/workflows instead."
    }
    retired_runbook_mutation = technician_a.post(
        f"{acceptance_base_url}/api/runbooks",
        json={"name": "Unsafe legacy runbook"},
        timeout=20,
    )
    retired_runbook_mutation_payload = _expect_status(
        retired_runbook_mutation,
        410,
        "Legacy generic runbook mutation is retired in favour of governed workflows",
    )
    assert retired_runbook_mutation_payload == {
        "detail": "Legacy runbook execution is retired. Use the governed Workflow Automation workspace and /api/workflows instead."
    }
    _expect_status(
        technician_a.get(f"{acceptance_base_url}/api/tickets/{ticket_a['id']}", timeout=20),
        200,
        "Client A technician reads Client A ticket",
    )
    time_entry = _expect_status(
        technician_a.post(
            f"{acceptance_base_url}/api/time-entries",
            json={
                "ticket_id": ticket_a["id"],
                "user_id": technician_b_record["id"],
                "description": "Authenticated acceptance time entry",
                "minutes": 15,
                "billable": True,
                "idempotency_key": f"acceptance-{uuid.uuid4().hex}",
            },
            timeout=20,
        ),
        200,
        "Client A technician creates time entry",
    )
    assert isinstance(time_entry, dict)
    assert time_entry.get("user_id") == technician_a_record["id"]

    started = _expect_status(
        technician_a.post(
            f"{acceptance_base_url}/api/work-sessions/tickets/{ticket_a['id']}/start",
            json={"intent": "Validate the isolated work-session path"},
            timeout=20,
        ),
        200,
        "Client A technician starts Work Session",
    )
    assert isinstance(started, dict) and isinstance(started.get("session"), dict)
    session_id = started["session"].get("id")
    assert session_id
    completed = _expect_status(
        technician_a.post(
            f"{acceptance_base_url}/api/work-sessions/{session_id}/complete",
            json={
                "minutes": 10,
                "technical_notes": "Confirmed the acceptance work-session workflow.",
                "customer_summary": "The requested check was completed.",
                "billing_classification": "review",
                "verified": True,
            },
            timeout=20,
        ),
        200,
        "Client A technician completes Work Session",
    )
    assert isinstance(completed, dict) and completed.get("time_entry")

    # Golden ticket path: publish a client-visible reply without invoking an
    # external mail provider, prove delivery into secure-link history, close
    # the request through the supported resolved flow, and retain audit proof.
    public_reply = _expect_status(
        technician_a.post(
            f"{acceptance_base_url}/api/tickets/{ticket_a['id']}/comments",
            json={
                "content": "<p>The endpoint check is complete and ready for client review.</p>",
                "is_internal": False,
                "notify_client": False,
            },
            timeout=20,
        ),
        200,
        "Client A technician publishes a client-visible ticket update",
    )
    assert isinstance(public_reply, dict)
    assert public_reply.get("portal_visible") is True
    assert public_reply.get("delivery_status") == "portal_only"

    foreign_reply = technician_b.post(
        f"{acceptance_base_url}/api/tickets/{ticket_a['id']}/comments",
        json={"content": "Rejected foreign update", "is_internal": False, "notify_client": False},
        timeout=20,
    )
    foreign_reply_payload = _expect_status(
        foreign_reply,
        404,
        "Client B technician cannot publish to Client A ticket",
    )
    assert foreign_reply_payload == {"detail": "Resource not found"}

    portal_history = _expect_status(
        requests.get(
            f"{acceptance_base_url}/api/portal-api/{portal_a['token']}/tickets/{ticket_a['id']}",
            timeout=20,
        ),
        200,
        "Client A portal receives the client-visible ticket update",
    )
    assert portal_history["ticket"]["id"] == ticket_a["id"]
    assert [comment["id"] for comment in portal_history["comments"]] == [public_reply["id"]]
    assert portal_history["comments"][0]["delivery_status"] == "portal_only"

    foreign_portal_history = requests.get(
        f"{acceptance_base_url}/api/portal-api/{portal_b['token']}/tickets/{ticket_a['id']}",
        timeout=20,
    )
    foreign_portal_payload = _expect_status(
        foreign_portal_history,
        404,
        "Client B portal cannot enumerate Client A ticket history",
    )
    missing_portal_payload = _expect_status(
        requests.get(
            f"{acceptance_base_url}/api/portal-api/{portal_b['token']}/tickets/missing-ticket",
            timeout=20,
        ),
        404,
        "Client B portal receives the same response for a missing ticket",
    )
    assert foreign_portal_payload == missing_portal_payload == {"detail": "Ticket not found"}

    resolved = _expect_status(
        technician_a.put(
            f"{acceptance_base_url}/api/tickets/{ticket_a['id']}",
            json={"status": "resolved", "resolution_notes": "Endpoint check completed."},
            timeout=20,
        ),
        200,
        "Client A technician resolves the ticket",
    )
    resolved_ticket = resolved["ticket"]
    assert resolved_ticket["status"] == "closed"
    assert resolved_ticket["resolution_status"] == "resolved_and_closed"
    assert resolved_ticket.get("resolved_at")
    assert resolved_ticket.get("closed_at")

    resolved_portal_history = _expect_status(
        requests.get(
            f"{acceptance_base_url}/api/portal-api/{portal_a['token']}/tickets/{ticket_a['id']}",
            timeout=20,
        ),
        200,
        "Client A portal retains the resolved ticket history",
    )
    assert resolved_portal_history["ticket"]["status"] == "closed"
    assert resolved_portal_history["ticket"]["resolution_status"] == "resolved_and_closed"
    assert [comment["id"] for comment in resolved_portal_history["comments"]] == [public_reply["id"]]

    ticket_audit_log = _expect_status(
        technician_a.get(f"{acceptance_base_url}/api/tickets/{ticket_a['id']}/audit-log", timeout=20),
        200,
        "Client A technician reads ticket audit evidence",
    )
    audit_actions = {entry.get("action") for entry in ticket_audit_log}
    assert {"created", "public_update_added", "updated"} <= audit_actions

    # A portal link is a client-scoped bearer credential. It must only reveal
    # its own client data, and a forged client_id in a public ticket request
    # must be ignored rather than selecting another client estate.
    portal_a_info = _expect_status(
        requests.get(f"{acceptance_base_url}/api/portal-api/{portal_a['token']}/info", timeout=20),
        200,
        "Client A portal link reads its identity",
    )
    assert isinstance(portal_a_info, dict)
    # The public compatibility response intentionally omits the internal
    # stable client ID. Its scoped ticket/device responses below prove the
    # server-side relationship without expanding public identity disclosure.
    assert portal_a_info.get("client", {}).get("name") == client_a["name"]
    portal_a_tickets = _expect_status(
        requests.get(f"{acceptance_base_url}/api/portal-api/{portal_a['token']}/tickets", timeout=20),
        200,
        "Client A portal link reads Client A tickets",
    )
    assert isinstance(portal_a_tickets, list)
    assert {ticket["id"] for ticket in portal_a_tickets} == {ticket_a["id"]}
    portal_a_devices = _expect_status(
        requests.get(f"{acceptance_base_url}/api/portal-api/{portal_a['token']}/devices", timeout=20),
        200,
        "Client A portal link reads Client A devices",
    )
    assert isinstance(portal_a_devices, list)
    assert {device["id"] for device in portal_a_devices} == {device_a["id"]}
    portal_created_ticket = _expect_status(
        requests.post(
            f"{acceptance_base_url}/api/portal-api/{portal_a['token']}/tickets",
            json={
                "title": "Acceptance portal scoped ticket",
                "description": "A forged client_id must not escape the portal link scope.",
                "client_id": client_b["id"],
            },
            timeout=20,
        ),
        200,
        "Client A portal link creates a scoped ticket",
    )
    assert isinstance(portal_created_ticket, dict)
    assert portal_created_ticket.get("client_id") == client_a["id"]
    portal_b_tickets = _expect_status(
        requests.get(f"{acceptance_base_url}/api/portal-api/{portal_b['token']}/tickets", timeout=20),
        200,
        "Client B portal link stays isolated from Client A portal data",
    )
    assert isinstance(portal_b_tickets, list)
    assert {ticket["id"] for ticket in portal_b_tickets} == {ticket_b["id"]}

    # Client evidence follows the same server-side boundary. The disposable
    # runner supplies a temporary uploads directory, so this verifies the
    # real multipart route without leaving files in a developer workspace.
    client_a_document = _upload_client_document(
        technician_a,
        acceptance_base_url,
        client_id=str(client_a["id"]),
        title="Client A acceptance evidence",
    )
    assert client_a_document.get("client_id") == client_a["id"]
    assert client_a_document.get("download_url") == (
        f"/api/clients/{client_a['id']}/documents/{client_a_document['id']}/download"
    )
    assert "url" not in client_a_document
    assert "artifact_storage" not in client_a_document
    assert client_a_document.get("security_scan", {}).get("status") == "clean"

    malware_rejection = technician_a.post(
        f"{acceptance_base_url}/api/clients/{client_a['id']}/documents",
        data={"title": "Rejected malware evidence", "category": "acceptance"},
        files={
            "file": (
                "eicar-test.txt",
                b"X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
                "text/plain",
            )
        },
        timeout=20,
    )
    _expect_status(malware_rejection, 422, "malware upload fails closed")

    signature_rejection = technician_a.post(
        f"{acceptance_base_url}/api/clients/{client_a['id']}/documents",
        data={"title": "Rejected mismatched evidence", "category": "acceptance"},
        files={"file": ("mismatched.png", b"<script>active content</script>", "image/png")},
        timeout=20,
    )
    _expect_status(signature_rejection, 400, "mismatched upload content fails closed")
    scoped_documents = _expect_status(
        technician_a.get(
            f"{acceptance_base_url}/api/clients/{client_a['id']}/documents", timeout=20
        ),
        200,
        "Client A technician lists Client A evidence",
    )
    assert isinstance(scoped_documents, list)
    assert {document["id"] for document in scoped_documents} == {client_a_document["id"]}
    assert scoped_documents[0].get("security_scan", {}).get("status") == "clean"
    assert "url" not in scoped_documents[0]
    scoped_download = technician_a.get(
        f"{acceptance_base_url}/api/clients/{client_a['id']}/documents/{client_a_document['id']}/download",
        timeout=20,
    )
    assert scoped_download.status_code == 200
    assert scoped_download.content == b"Nexus acceptance evidence."
    # The former static storage route is deliberately unavailable without a
    # session, even when a caller knows the generated filename.
    stored_filename = f"{client_a['id']}__{client_a_document['id']}.txt"
    public_static_download = requests.get(
        f"{acceptance_base_url}/api/uploads/client-documents/{stored_filename}", timeout=20
    )
    assert public_static_download.status_code == 404
    _expect_denied(
        technician_b.get(
            f"{acceptance_base_url}/api/clients/{client_a['id']}/documents/{client_a_document['id']}/download",
            timeout=20,
        ),
        "Client B technician downloads Client A evidence",
    )
    _expect_denied(
        technician_a.post(
            f"{acceptance_base_url}/api/clients/{client_b['id']}/documents",
            data={"title": "Rejected foreign evidence", "category": "acceptance"},
            files={"file": ("rejected.txt", b"This must never be stored.", "text/plain")},
            timeout=20,
        ),
        "Client A technician uploads Client B evidence",
    )
    foreign_documents = _expect_status(
        admin.get(f"{acceptance_base_url}/api/clients/{client_b['id']}/documents", timeout=20),
        200,
        "Administrator verifies Client B evidence state",
    )
    assert foreign_documents == []
    _expect_status(
        technician_a.delete(
            f"{acceptance_base_url}/api/clients/{client_a['id']}/documents/{client_a_document['id']}",
            timeout=20,
        ),
        200,
        "Client A technician removes its disposable evidence",
    )

    # Every foreign operation must be rejected server side.  A 404 is accepted
    # for endpoints intentionally masking a foreign resource from discovery.
    foreign_operations = (
        (
            technician_a.get(f"{acceptance_base_url}/api/clients/{client_b['id']}", timeout=20),
            "Client A technician reads Client B",
        ),
        (
            technician_a.get(f"{acceptance_base_url}/api/devices/{device_b['id']}", timeout=20),
            "Client A technician reads Client B device",
        ),
        (
            technician_a.get(f"{acceptance_base_url}/api/tickets/{ticket_b['id']}", timeout=20),
            "Client A technician reads Client B ticket",
        ),
        (
            technician_a.post(
                f"{acceptance_base_url}/api/time-entries",
                json={
                    "ticket_id": ticket_b["id"],
                    "user_id": technician_a_record["id"],
                    "description": "Rejected foreign mutation",
                    "minutes": 15,
                    "billable": True,
                    "idempotency_key": f"rejected-{uuid.uuid4().hex}",
                },
                timeout=20,
            ),
            "Client A technician creates Client B time entry",
        ),
        (
            technician_a.post(
                f"{acceptance_base_url}/api/work-sessions/tickets/{ticket_b['id']}/start",
                json={"intent": "Rejected foreign work session"},
                timeout=20,
            ),
            "Client A technician starts Client B Work Session",
        ),
    )
    for response, context in foreign_operations:
        _expect_denied(response, context)

    # Authenticated portal administration must apply the same client scope,
    # rather than depending on a hidden client selector in the frontend.
    _expect_status(
        technician_a.get(
            f"{acceptance_base_url}/api/client-portal/config/{client_a['id']}", timeout=20
        ),
        200,
        "Client A technician reads Client A portal configuration",
    )
    _expect_denied(
        technician_a.get(
            f"{acceptance_base_url}/api/client-portal/config/{client_b['id']}", timeout=20
        ),
        "Client A technician reads Client B portal configuration",
    )

    # Repeat a representative read/mutation denial in the opposite direction.
    _expect_status(
        technician_b.get(f"{acceptance_base_url}/api/tickets/{ticket_b['id']}", timeout=20),
        200,
        "Client B technician reads Client B ticket",
    )
    _expect_denied(
        technician_b.get(f"{acceptance_base_url}/api/tickets/{ticket_a['id']}", timeout=20),
        "Client B technician reads Client A ticket",
    )
    _expect_denied(
        technician_b.post(
            f"{acceptance_base_url}/api/work-sessions/tickets/{ticket_a['id']}/start",
            json={"intent": "Rejected foreign work session"},
            timeout=20,
        ),
        "Client B technician starts Client A Work Session",
    )

    # The blocked Client B write must not have created data or a session.
    client_b_entries = _expect_status(
        admin.get(
            f"{acceptance_base_url}/api/time-entries",
            params={"ticket_id": ticket_b["id"]},
            timeout=20,
        ),
        200,
        "Administrator verifies Client B time-entry state",
    )
    assert client_b_entries == []
    client_b_brief = _expect_status(
        admin.get(f"{acceptance_base_url}/api/work-sessions/tickets/{ticket_b['id']}", timeout=20),
        200,
        "Administrator verifies Client B Work Session state",
    )
    assert isinstance(client_b_brief, dict)
    assert client_b_brief.get("active_session") is None

    # The older Xero-shaped billing workspace is still a Nexus client-data
    # surface.  Give a restricted service-desk manager the declared billing
    # action, then prove it can create/read Client A records but cannot use that
    # action to enumerate or mutate Client B's financial documents.
    xero_invoice_a = _create_xero_invoice(
        billing_technician_a,
        acceptance_base_url,
        client_id=str(client_a["id"]),
        reference="Acceptance Client A billing",
    )
    xero_invoice_b = _create_xero_invoice(
        admin,
        acceptance_base_url,
        client_id=str(client_b["id"]),
        reference="Acceptance Client B billing",
    )
    scoped_xero_invoices = _expect_status(
        billing_technician_a.get(f"{acceptance_base_url}/api/xero/invoices", timeout=20),
        200,
        "Client A billing technician lists Xero mirror invoices",
    )
    assert isinstance(scoped_xero_invoices, list)
    assert [invoice["id"] for invoice in scoped_xero_invoices] == [xero_invoice_a["id"]]
    _expect_denied(
        billing_technician_a.put(
            f"{acceptance_base_url}/api/xero/invoices/{xero_invoice_b['id']}",
            json={"reference": "Rejected foreign financial mutation"},
            timeout=20,
        ),
        "Client A billing technician updates Client B Xero mirror invoice",
    )
    scoped_dashboard = _expect_status(
        billing_technician_a.get(f"{acceptance_base_url}/api/xero/dashboard", timeout=20),
        200,
        "Client A billing technician views scoped Xero dashboard",
    )
    assert isinstance(scoped_dashboard, dict)
    assert scoped_dashboard["invoice_count"] == 1
