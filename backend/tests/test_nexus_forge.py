"""Nexus Forge tests.

Forge turns a missing capability into a governed tool specification. These tests
pin the route-grounded capability catalogue, the refusal of privileged or
credential-bearing requests, the requirement that scope, permissions and data
classes are declared, the version gate that never overwrites a published version,
and the tenant scoping of every route.
"""

import asyncio
from types import SimpleNamespace

import pytest

from app.routers import nexus_forge as forge_router
from app.services.nexus_forge import (
    build_catalogue,
    compare_versions,
    filter_catalogue,
    forge_spec_checks,
    forge_verdict,
    tool_publish_gate,
    version_is_valid,
)

CATALOGUE = build_catalogue([
    ("/api/devices", ("GET", "POST")),
    ("/api/tickets/{ticket_id}", ("GET",)),
    ("/api/wish-engine/wishes", ("GET", "POST")),
    ("/health", ("GET",)),
    ("/metrics", ("GET",)),
])


def _spec(**overrides):
    spec = {
        "title": "Certificate expiry view",
        "intent": "Show every certificate close to expiry together with the services that depend on it",
        "expected_outcome": "One place to see expiring certificates and what depends on them",
        "capability_refs": ["/api/tickets/{ticket_id}"],
        "scope": {
            "tenant_enforced": True,
            "permissions": ["tickets.read"],
            "data_classes": ["ticket_metadata"],
        },
        "sandbox_plan": "Run against the seeded sandbox tenant for 14 days before any customer sees it.",
        "tests": ["An expiring certificate inside 30 days appears exactly once"],
        "verification": "",
        "rollback": "Remove the panel registration and restore the previous workspace layout.",
        "review_interval_days": 90,
    }
    spec.update(overrides)
    return spec


def _failed_checks(result):
    return [check["id"] for check in result["checks"] if check["status"] == "fail"]


def _flagged_checks(result):
    return [check["id"] for check in result["checks"] if check["status"] == "needs_review"]


# ── policy ───────────────────────────────────────────────────────────────────


def test_the_catalogue_is_built_from_what_the_api_serves():
    ids = [row["id"] for row in CATALOGUE]
    assert ids == ["/api/devices", "/api/tickets/{ticket_id}", "/api/wish-engine/wishes"]
    # Probes and internal scraping targets are not composable capabilities.
    assert "/health" not in ids
    assert "/metrics" not in ids

    devices = next(row for row in CATALOGUE if row["id"] == "/api/devices")
    assert devices["category"] == "devices"
    assert devices["methods"] == ["GET", "POST"]
    assert devices["mutating"] is True
    assert next(row for row in CATALOGUE if row["id"] == "/api/tickets/{ticket_id}")["mutating"] is False


def test_the_catalogue_is_searched_server_side():
    result = filter_catalogue(CATALOGUE, query="tickets")
    assert [row["id"] for row in result["capabilities"]] == ["/api/tickets/{ticket_id}"]
    assert result["matched"] == 1
    assert result["total"] == 3
    assert result["truncated"] is False

    by_category = filter_catalogue(CATALOGUE, category="devices")
    assert [row["id"] for row in by_category["capabilities"]] == ["/api/devices"]
    assert {row["id"] for row in by_category["categories"]} == {"devices", "tickets", "wish-engine"}

    capped = filter_catalogue(CATALOGUE, limit=1)
    assert len(capped["capabilities"]) == 1
    assert capped["truncated"] is True


def test_a_request_for_privilege_or_credentials_is_refused():
    privileged = forge_spec_checks(
        _spec(intent="Give the tool production credentials so it can change any customer's configuration"),
        catalogue=CATALOGUE,
    )
    assert privileged["verdict"] == "fail"
    assert "no_privileged_delivery" in _failed_checks(privileged)

    credential = forge_spec_checks(
        _spec(sandbox_plan="Connect with password=hunter2 to the sandbox and leave it running"),
        catalogue=CATALOGUE,
    )
    assert credential["verdict"] == "fail"
    assert "no_credential_material" in _failed_checks(credential)


def test_capabilities_must_resolve_against_the_served_api():
    grounded = forge_spec_checks(_spec(), catalogue=CATALOGUE)
    assert "grounded_capabilities" not in _failed_checks(grounded)
    assert grounded["capabilities"][0]["id"] == "/api/tickets/{ticket_id}"

    invented = forge_spec_checks(_spec(capability_refs=["/api/imaginary-inventory"]), catalogue=CATALOGUE)
    assert invented["verdict"] == "needs_review"
    assert "grounded_capabilities" in _flagged_checks(invented)
    assert invented["unresolved_capabilities"] == ["/api/imaginary-inventory"]

    undeclared = forge_spec_checks(_spec(capability_refs=[]), catalogue=CATALOGUE)
    assert "grounded_capabilities" in _failed_checks(undeclared)


def test_scope_permissions_and_data_classes_are_mandatory():
    unscoped = forge_spec_checks(
        _spec(scope={"tenant_enforced": False, "permissions": ["*"], "data_classes": ["credential"]}),
        catalogue=CATALOGUE,
    )
    assert unscoped["verdict"] == "fail"
    failures = _failed_checks(unscoped)
    assert {"tenant_scope", "permissions_declared", "data_classes_declared"}.issubset(set(failures))

    empty = forge_spec_checks(
        _spec(scope={"tenant_enforced": True, "permissions": [], "data_classes": []}),
        catalogue=CATALOGUE,
    )
    assert {"permissions_declared", "data_classes_declared"}.issubset(set(_failed_checks(empty)))


def test_a_complete_read_only_design_passes_every_gate():
    result = forge_spec_checks(_spec(), catalogue=CATALOGUE)
    assert result["verdict"] == "pass"
    assert [check["status"] for check in result["checks"]] == ["pass"] * len(result["checks"])
    assert result["checks"][0]["detail"]
    labels = {check["id"] for check in result["checks"]}
    assert {"no_privileged_delivery", "grounded_capabilities", "sandbox_plan", "tests_declared", "rollback_declared"} <= labels


def test_an_incomplete_specification_fails_the_gates_it_skipped():
    thin = forge_spec_checks(
        _spec(sandbox_plan="", tests=[], rollback="", review_interval_days=0),
        catalogue=CATALOGUE,
    )
    assert thin["verdict"] == "fail"
    assert {"sandbox_plan", "tests_declared", "rollback_declared", "review_interval"} <= set(_failed_checks(thin))
    assert forge_verdict(thin["checks"]) == "fail"


def test_a_state_changing_composition_needs_stated_verification():
    without = forge_spec_checks(_spec(capability_refs=["/api/devices"]), catalogue=CATALOGUE)
    assert without["verdict"] == "needs_review"
    assert "write_verification" in _flagged_checks(without)

    with_verification = forge_spec_checks(
        _spec(
            capability_refs=["/api/devices"],
            verification="Compare the device record before and after, and confirm the sandbox tenant is unchanged.",
        ),
        catalogue=CATALOGUE,
    )
    assert with_verification["verdict"] == "pass"


def test_a_duplicate_of_a_published_tool_and_a_huge_composition_both_need_review():
    duplicate = forge_spec_checks(
        _spec(),
        catalogue=CATALOGUE,
        published_tools=[{"name": "Certificate panel", "capabilities": ["/api/tickets/{ticket_id}"]}],
    )
    assert duplicate["verdict"] == "needs_review"
    assert "duplicate_tool" in _flagged_checks(duplicate)
    detail = next(check["detail"] for check in duplicate["checks"] if check["id"] == "duplicate_tool")
    assert "Certificate panel" in detail

    wide_catalogue = build_catalogue([(f"/api/thing-{index}", ("GET",)) for index in range(30)])
    wide = forge_spec_checks(
        _spec(capability_refs=[f"/api/thing-{index}" for index in range(30)]),
        catalogue=wide_catalogue,
    )
    assert "blast_radius" in _flagged_checks(wide)
    assert wide["verdict"] == "needs_review"


def test_a_published_version_is_never_overwritten():
    assert version_is_valid("1.0") and version_is_valid("1.2.3")
    assert not version_is_valid("v1") and not version_is_valid("1")
    assert compare_versions("1.2.0", "1.1.9") == 1
    assert compare_versions("1.0", "1.0.0") == 0
    assert compare_versions("2.0", "1.9.9") == 1

    approved = {
        "stage": "approved",
        "verdict": "pass",
        "rollback": "Remove the panel registration.",
        "review_interval_days": 90,
    }
    assert tool_publish_gate(approved, version="1.0")["allowed"] is True
    assert tool_publish_gate(approved, version="1.0", existing_versions=["1.0"])["allowed"] is False
    assert tool_publish_gate(approved, version="1.1", existing_versions=["1.0"])["allowed"] is True
    assert tool_publish_gate(approved, version="0.9", existing_versions=["1.0"])["allowed"] is False
    assert tool_publish_gate(approved, version="v1")["allowed"] is False

    assert tool_publish_gate({"stage": "specified", "verdict": "pass"}, version="1.0")["allowed"] is False
    assert tool_publish_gate({"stage": "approved", "verdict": "fail"}, version="1.0")["allowed"] is False
    assert tool_publish_gate({"stage": "approved", "verdict": "pass"}, version="1.0")["allowed"] is False


# ── route boundary ───────────────────────────────────────────────────────────


class _Result:
    def __init__(self, matched_count=0):
        self.matched_count = matched_count


def _matches(row, query):
    for key, expected in query.items():
        if key == "$and":
            if not all(_matches(row, clause) for clause in expected):
                return False
            continue
        actual = row.get(key)
        if isinstance(expected, dict):
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            continue
        if actual != expected:
            return False
    return True


class _Rows:
    def __init__(self):
        self.rows = []

    async def find_one(self, query, _projection=None):
        return next((dict(row) for row in self.rows if _matches(row, query)), None)

    async def insert_one(self, document):
        self.rows.append(dict(document))

    async def update_one(self, query, update):
        for row in self.rows:
            if _matches(row, query):
                row.update(update.get("$set") or {})
                return _Result(1)
        return _Result(0)

    def find(self, query, _projection=None):
        return _Cursor([dict(row) for row in self.rows if _matches(row, query)])


class _Cursor:
    def __init__(self, rows):
        self._rows = rows

    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, _limit):
        return list(self._rows)


class _Db:
    def __init__(self):
        self._tables = {}

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return self._tables.setdefault(name, _Rows())


def _user(tenant="tenant-a"):
    return {"id": "tech-1", "tenant_id": tenant, "name": "Forge Tech", "email": "tech-1@example.com", "is_admin": True}


def _request(path="/api/devices", methods=("GET", "POST")):
    return SimpleNamespace(
        app=SimpleNamespace(routes=[SimpleNamespace(path=path, methods=set(methods))])
    )


class _Audit:
    def __init__(self):
        self.calls = []

    async def __call__(self, user, action, entity_type, entity_id, entity_name="", **kwargs):
        self.calls.append({"action": action, "entity_id": entity_id, "kwargs": kwargs})


@pytest.fixture()
def harness(monkeypatch):
    db = _Db()
    audit = _Audit()
    monkeypatch.setattr(forge_router, "db", db)
    monkeypatch.setattr(forge_router, "log_activity", audit)
    return db, audit


def _payload(**overrides):
    base = {
        "title": "Certificate expiry view",
        "intent": "Show every certificate close to expiry together with the services that depend on it",
        "kind": "panel",
        "expected_outcome": "One place to see expiring certificates and what depends on them",
        "capability_refs": ["/api/devices"],
        "scope": {"tenant_enforced": True, "permissions": ["devices.read"], "data_classes": ["asset_metadata"]},
        "sandbox_plan": "Run against the seeded sandbox tenant for 14 days before any customer sees it.",
        "tests": ["An expiring certificate inside 30 days appears exactly once"],
        "verification": "Compare the device record before and after inside the sandbox tenant.",
        "rollback": "Remove the panel registration and restore the previous workspace layout.",
        "review_interval_days": 90,
    }
    base.update(overrides)
    return forge_router.ForgeRequestPayload(**base)


def test_the_capability_route_reports_what_this_api_serves(harness):
    result = asyncio.run(
        forge_router.forge_capabilities(_request(), q="devices", category=None, limit=10, current_user=_user())
    )
    assert [row["id"] for row in result["capabilities"]] == ["/api/devices"]
    assert "does not generate or deploy executable code" in result["boundary"]
    assert result["kinds"]


def test_a_design_request_records_every_check_and_its_verdict(harness):
    db, audit = harness
    created = asyncio.run(forge_router.create_forge_request(_request(), _payload(), current_user=_user()))
    request = created["request"]
    assert request["verdict"] == "pass"
    assert request["stage"] == "specified"
    assert request["capabilities"][0]["id"] == "/api/devices"
    assert db.nexus_forge_requests.rows[0]["tenant_id"] == "tenant-a"
    assert audit.calls[0]["action"] == "nexus_forge.request_specified"

    refused = asyncio.run(
        forge_router.create_forge_request(
            _request(),
            _payload(intent="Store the domain admin password so the tool can fix any device it finds"),
            current_user=_user(),
        )
    )
    assert refused["request"]["verdict"] == "fail"
    assert "cannot grant privilege" in next(
        check["detail"] for check in refused["request"]["checks"] if check["id"] == "no_privileged_delivery"
    )


def test_approval_is_withheld_from_a_failed_design_and_needs_a_note_when_flagged(harness):
    db, _ = harness
    failed = asyncio.run(
        forge_router.create_forge_request(
            _request(), _payload(sandbox_plan="", tests=[], rollback=""), current_user=_user()
        )
    )["request"]

    with pytest.raises(Exception) as blocked:
        asyncio.run(
            forge_router.review_forge_request(
                failed["id"],
                forge_router.ForgeReviewPayload(decision="approved", evidence_note="Looks fine to me"),
                current_user=_user(),
            )
        )
    assert "failed" in str(blocked.value)

    flagged = asyncio.run(
        forge_router.create_forge_request(
            _request(), _payload(capability_refs=["/api/devices"], verification=""), current_user=_user()
        )
    )["request"]
    assert flagged["verdict"] == "needs_review"

    with pytest.raises(Exception) as thin_note:
        asyncio.run(
            forge_router.review_forge_request(
                flagged["id"],
                forge_router.ForgeReviewPayload(decision="approved", evidence_note="noted"),
                current_user=_user(),
            )
        )
    assert "at least 20 characters" in str(thin_note.value)

    approved = asyncio.run(
        forge_router.review_forge_request(
            flagged["id"],
            forge_router.ForgeReviewPayload(
                decision="approved",
                evidence_note="The verification gap is acceptable because the tool only previews records.",
            ),
            current_user=_user(),
        )
    )["request"]
    assert approved["stage"] == "approved"
    assert approved["review_history"][0]["verdict_at_review"] == "needs_review"


def test_a_version_can_only_be_recorded_for_an_approved_design_and_never_overwrites(harness):
    db, audit = harness
    created = asyncio.run(forge_router.create_forge_request(_request(), _payload(), current_user=_user()))["request"]

    with pytest.raises(Exception) as unapproved:
        asyncio.run(
            forge_router.publish_forge_request(
                created["id"],
                forge_router.ForgePublishPayload(version="1.0", evidence_note="Ready for customers"),
                current_user=_user(),
            )
        )
    assert "approve the design" in str(unapproved.value)

    asyncio.run(
        forge_router.review_forge_request(
            created["id"],
            forge_router.ForgeReviewPayload(decision="approved", evidence_note="Reviewed against the served capabilities."),
            current_user=_user(),
        )
    )
    first = asyncio.run(
        forge_router.publish_forge_request(
            created["id"],
            forge_router.ForgePublishPayload(version="1.0", evidence_note="First release for the sandbox tenant"),
            current_user=_user(),
        )
    )
    assert first["request"]["stage"] == "published"
    assert first["request"]["versions"][0]["version"] == "1.0"
    assert first["request"]["versions"][0]["review_interval_days"] == 90
    assert first["tools"][0]["latest_version"] == "1.0"
    assert first["tools"][0]["next_review_at"]
    assert audit.calls[-1]["action"] == "nexus_forge.version_recorded"

    with pytest.raises(Exception) as same_version:
        asyncio.run(
            forge_router.publish_forge_request(
                created["id"],
                forge_router.ForgePublishPayload(version="1.0", evidence_note="Re-releasing the same version"),
                current_user=_user(),
            )
        )
    assert "never overwritten" in str(same_version.value)

    second = asyncio.run(
        forge_router.publish_forge_request(
            created["id"],
            forge_router.ForgePublishPayload(version="1.1", evidence_note="Adds the dependent-service column"),
            current_user=_user(),
        )
    )
    assert [item["version"] for item in second["request"]["versions"]] == ["1.0", "1.1"]
    assert second["request"]["versions"][1]["supersedes"] == "1.0"

    with pytest.raises(Exception) as closed:
        asyncio.run(
            forge_router.review_forge_request(
                created["id"],
                forge_router.ForgeReviewPayload(decision="approved", evidence_note="Approving a published tool again"),
                current_user=_user(),
            )
        )
    assert "versioned" in str(closed.value)


def test_design_requests_are_tenant_scoped(harness):
    db, _ = harness
    created = asyncio.run(forge_router.create_forge_request(_request(), _payload(), current_user=_user()))["request"]

    with pytest.raises(Exception) as hidden:
        asyncio.run(
            forge_router.review_forge_request(
                created["id"],
                forge_router.ForgeReviewPayload(decision="approved", evidence_note="Cross-tenant approval attempt"),
                current_user=_user(tenant="tenant-b"),
            )
        )
    assert "not found" in str(hidden.value)

    other = asyncio.run(forge_router.list_forge_requests(current_user=_user(tenant="tenant-b")))
    assert other["requests"] == []
    assert other["summary"] == {"total": 0, "awaiting_review": 0, "approved": 0, "published": 0, "failed": 0}
