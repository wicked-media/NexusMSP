"""Extension Studio tests.

Extension Studio is a *review*, so the tests are mostly about refusals: a
wildcard permission, an unknown permission, a capability the API does not serve,
a credential-shaped data class, an incompatible API version and an unsigned
distributed manifest must each be caught with a disclosed reason. Nothing here
builds, signs, deploys or executes, and the tests assert that is true of the
service contract as well as the endpoint.
"""

from __future__ import annotations

import asyncio
import os
import sys
import types
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.auth import get_current_user  # noqa: E402
from app.routers import extension_studio as routes  # noqa: E402
from app.services import extension_studio as policy  # noqa: E402
from test_studio_fleet import _mounted_operation  # noqa: E402

USER = {"id": "admin-1", "name": "Ada Admin", "role": "admin", "is_admin": True}

KNOWN_PERMISSIONS = {"platform.readiness.view", "platform.configuration.manage"}
KNOWN_CAPABILITIES = {"/api/backup-center/summary", "/api/tickets"}


def _manifest(**overrides):
    manifest = {
        "id": "acme.backup-summary",
        "name": "Backup Summary Dashboard",
        "version": "1.0.0",
        "kind": "dashboard",
        "distribution": "private",
        "capabilities": ["/api/backup-center/summary"],
        "permissions": ["platform.readiness.view"],
        "data_classes": ["aggregate"],
        "isolation": "Read-only projection, confined to the caller's client scope.",
        "verification": "Renders only observed rows and discloses an unmeasured state.",
        "rollback": "Remove the dashboard registration; nothing is written so nothing is restored.",
    }
    manifest.update(overrides)
    return manifest


def _validate(manifest, **kwargs):
    return policy.validate_manifest(
        manifest,
        known_capabilities=kwargs.pop("known_capabilities", KNOWN_CAPABILITIES),
        known_permissions=kwargs.pop("known_permissions", KNOWN_PERMISSIONS),
        **kwargs,
    )


def _check(result, check_id):
    return next(check for check in result["checks"] if check["id"] == check_id)


def _fake_request(routes_list):
    return types.SimpleNamespace(app=types.SimpleNamespace(routes=routes_list))


def _route(path, methods):
    return types.SimpleNamespace(path=path, methods=set(methods))


# ============== CONTRACT ==============


def test_contract_describes_the_governed_manifest_surface():
    contract = policy.manifest_contract()
    assert contract["api_version"] == policy.NEXUS_API_VERSION
    assert contract["kinds"] == list(policy.EXTENSION_KINDS)
    assert contract["distributions"] == list(policy.DISTRIBUTIONS)
    assert set(contract["data_classes"]) == set(policy.DATA_CLASSES)
    assert contract["required_fields"] == list(policy.REQUIRED_MANIFEST_FIELDS)
    assert contract["marketplace"]["state"] == "deferred"
    assert "signing" in contract["marketplace"]["gate"].lower()
    assert contract["boundary"] == policy.EXTENSION_BOUNDARY


def test_version_compatibility_is_major_equality_and_minor_at_most():
    assert policy.version_compatible("1.0", "1.0")
    assert policy.version_compatible("1.0", "1.4")
    assert not policy.version_compatible("1.9", "1.0")
    assert not policy.version_compatible("2.0", "1.0")
    assert not policy.version_compatible("", "1.0")


# ============== THE CHECKS ==============


def test_a_complete_private_manifest_is_approved_with_every_check_passing():
    result = _validate(_manifest())
    assert result["verdict"] == "approved"
    assert len(result["checks"]) == 10
    assert {check["state"] for check in result["checks"]} == {"pass"}
    assert result["missing_fields"] == []
    assert result["boundary"] == policy.EXTENSION_BOUNDARY


def test_missing_fields_are_named_and_the_manifest_is_rejected():
    result = _validate(_manifest(id="", capabilities=[], permissions=[]))
    assert result["verdict"] == "rejected"
    assert set(result["missing_fields"]) >= {"id", "capabilities", "permissions"}
    assert _check(result, "required_fields")["state"] == "fail"


def test_a_wildcard_permission_is_refused():
    result = _validate(_manifest(permissions=["platform.*"]))
    assert result["verdict"] == "rejected"
    assert _check(result, "permissions")["state"] == "fail"
    assert "wildcard" in _check(result, "permissions")["reason"].lower()


def test_an_unknown_permission_is_refused_with_the_name():
    result = _validate(_manifest(permissions=["backup.secret.read"]))
    assert result["verdict"] == "rejected"
    assert "backup.secret.read" in _check(result, "permissions")["reason"]


def test_an_unresolved_capability_is_refused_against_the_served_routes():
    result = _validate(_manifest(capabilities=["/api/does-not-exist"]))
    assert result["verdict"] == "rejected"
    assert "/api/does-not-exist" in _check(result, "capabilities")["reason"]


def test_a_credential_shaped_data_class_is_refused():
    result = _validate(_manifest(data_classes=["operational", "credential"]))
    assert result["verdict"] == "rejected"
    assert "credential" in _check(result, "data_classes")["reason"].lower()


def test_an_unknown_kind_is_refused():
    result = _validate(_manifest(kind="plugin"))
    assert result["verdict"] == "rejected"
    assert _check(result, "kind")["state"] == "fail"


def test_an_incompatible_api_version_is_refused():
    result = _validate(_manifest(requires_api="2.0"))
    assert result["verdict"] == "rejected"
    assert _check(result, "api_compatibility")["state"] == "fail"


def test_isolation_and_verification_are_required_before_a_verdict():
    no_isolation = _validate(_manifest(isolation=""))
    assert _check(no_isolation, "isolation")["state"] == "fail"
    assert no_isolation["verdict"] == "rejected"

    no_verification = _validate(_manifest(verification=""))
    assert _check(no_verification, "verification")["state"] == "fail"
    assert no_verification["verdict"] == "rejected"


def test_an_extension_that_composes_nothing_needs_no_verification():
    result = _validate(_manifest(capabilities=[], permissions=["platform.readiness.view"], verification=""))
    assert _check(result, "verification")["state"] == "pass"
    # Still rejected for the missing capabilities field, which is a separate check.
    assert _check(result, "required_fields")["state"] == "fail"


def test_a_thin_rollback_plan_needs_review_rather_than_failing():
    result = _validate(_manifest(rollback="Revert"))
    assert _check(result, "rollback")["state"] == "needs_review"
    assert result["verdict"] == "needs_review"


def test_a_distributed_manifest_without_a_signature_is_refused():
    result = _validate(_manifest(distribution="distributed"))
    assert result["verdict"] == "rejected"
    assert _check(result, "distribution")["state"] == "fail"
    assert "signing" in _check(result, "distribution")["reason"].lower()


def test_a_signed_distributed_manifest_still_needs_review():
    result = _validate(_manifest(distribution="distributed", signature="sig-abc123"))
    assert _check(result, "distribution")["state"] == "needs_review"
    assert result["verdict"] == "needs_review"


def test_an_unknown_distribution_is_refused():
    result = _validate(_manifest(distribution="everyone"))
    assert _check(result, "distribution")["state"] == "fail"


def test_verdict_is_rejected_on_any_failure_and_needs_review_only_on_flags():
    assert _validate(_manifest(kind="plugin", rollback="Revert"))["verdict"] == "rejected"
    assert _validate(_manifest(rollback="Revert"))["verdict"] == "needs_review"


def test_a_non_mapping_manifest_is_rejected_rather_than_crashing():
    for payload in (None, [], "nope"):
        result = _validate(payload)
        assert result["verdict"] == "rejected"
        assert _check(result, "required_fields")["state"] == "fail"


def test_check_summary_counts_every_state():
    summary = policy.summarize_checks(_validate(_manifest(rollback="Revert"))["checks"])
    assert summary["total"] == 10
    assert summary["pass"] == 9
    assert summary["needs_review"] == 1
    assert policy.summarize_checks([])["total"] == 0


# ============== HTTP BOUNDARY ==============


def test_extension_endpoints_are_mounted_and_validate_requires_a_permission():
    for method, path, handler in (
        ("GET", "/api/extensions/contract", routes.extension_contract),
        ("GET", "/api/extensions/capabilities", routes.extension_capabilities),
        ("POST", "/api/extensions/validate", routes.validate_extension),
    ):
        route = _mounted_operation(method, path)
        assert route is not None, f"{method} {path} is not mounted"
        assert route.endpoint is handler, f"{method} {path} is shadowed by another route"

    validate_route = _mounted_operation("POST", "/api/extensions/validate")
    # `require_action` wraps `get_current_user`, so the permission gate shows up
    # as a dependency rather than as `get_current_user` itself.
    assert validate_route.dependant.dependencies, "validate is not permission-gated"

    for path, handler in (("/api/extensions/contract", routes.extension_contract),
                          ("/api/extensions/capabilities", routes.extension_capabilities)):
        route = _mounted_operation("GET", path)
        dependency_calls = [dep.call for dep in route.dependant.dependencies]
        assert get_current_user in dependency_calls, f"GET {path} is not auth-guarded"


def test_contract_endpoint_returns_the_contract():
    assert asyncio.run(routes.extension_contract(user=USER)) == policy.manifest_contract()


def test_capabilities_endpoint_is_grounded_in_the_served_routes():
    request = _fake_request([_route("/api/tickets", ["GET"]), _route("/metrics", ["GET"])])
    response = asyncio.run(routes.extension_capabilities(request=request, user=USER))
    assert [row["id"] for row in response["capabilities"]] == ["/api/tickets"]
    assert response["count"] == 1
    assert "does not serve" in response["boundary"]


def test_validate_endpoint_returns_the_verdict_and_a_check_summary():
    request = _fake_request([_route("/api/backup-center/summary", ["GET"])])
    response = asyncio.run(routes.validate_extension(
        routes.ManifestRequest(manifest=_manifest()), request=request, user=USER))
    assert response["verdict"] == "approved"
    assert response["checks_summary"]["total"] == 10
    assert response["capability_count"] == 1


def test_validate_endpoint_refuses_a_capability_the_app_does_not_serve():
    request = _fake_request([_route("/api/tickets", ["GET"])])
    response = asyncio.run(routes.validate_extension(
        routes.ManifestRequest(manifest=_manifest()), request=request, user=USER))
    assert response["verdict"] == "rejected"
    assert _check(response, "capabilities")["state"] == "fail"


def test_validate_refuses_a_non_mapping_manifest_body_without_crashing():
    # A JSON body that is a list (not an object) cannot satisfy the model, so the
    # service's own guard is exercised directly instead.
    assert policy.validate_manifest([], known_capabilities=KNOWN_CAPABILITIES,
                                   known_permissions=KNOWN_PERMISSIONS)["verdict"] == "rejected"
