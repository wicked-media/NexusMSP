"""Tenant/client boundaries for compliance issues and attached evidence."""

import asyncio
from io import BytesIO
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, UploadFile


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.routers import compliance  # noqa: E402


class _Cursor:
    def __init__(self, rows=None):
        self.rows = rows or []

    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, _limit):
        return [dict(row) for row in self.rows]


class _Collection:
    def __init__(self, document=None, rows=None):
        self.document = document
        self.rows = rows or []
        self.find_query = None
        self.find_one_query = None
        self.inserted = []
        self.updates = []

    def find(self, query, *_args, **_kwargs):
        self.find_query = query
        return _Cursor(self.rows)

    async def find_one(self, query, *_args, **_kwargs):
        self.find_one_query = query
        return dict(self.document) if self.document else None

    async def insert_one(self, document):
        self.inserted.append(dict(document))
        return SimpleNamespace(inserted_id=document.get("id"))

    async def update_one(self, query, update):
        self.updates.append((query, update))
        return SimpleNamespace(matched_count=1, modified_count=1)


class _Request:
    method = "POST"
    url = SimpleNamespace(path="/api/compliance/issues")


def _user(**overrides):
    return {
        "id": "tech-a",
        "name": "Technician A",
        "tenant_id": "tenant-a",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
        "site_scope_ids": [],
        **overrides,
    }


def test_issue_list_applies_client_and_tenant_filters(monkeypatch):
    issues = _Collection()
    monkeypatch.setattr(compliance, "db", SimpleNamespace(compliance_issues=issues))

    assert asyncio.run(compliance.list_compliance_issues(current_user=_user())) == []

    assert issues.find_query == {
        "$and": [
            {"$and": [{"archived": {"$ne": True}}, {"client_id": {"$in": ["client-a"]}}]},
            {"tenant_id": "tenant-a"},
        ]
    }


def test_create_issue_uses_actor_tenant_and_scoped_client_record(monkeypatch):
    clients = _Collection(document={
        "id": "client-a", "tenant_id": "tenant-a", "site_id": "site-a", "name": "Client A",
    })
    issues = _Collection()
    audits = _Collection()
    monkeypatch.setattr(compliance, "db", SimpleNamespace(clients=clients, compliance_issues=issues, audit_logs=audits))
    checked = {}

    async def allow_scope(user, client_id, **kwargs):
        checked.update(user=user, client_id=client_id, **kwargs)

    monkeypatch.setattr(compliance, "assert_client_scope", allow_scope)

    issue = asyncio.run(compliance.create_compliance_issue(
        {"title": "Review evidence", "client_id": "client-a", "tenant_id": "tenant-b"},
        _Request(), _user(),
    ))

    assert issue["tenant_id"] == "tenant-a"
    assert issue["site_id"] == "site-a"
    assert issue["client_id"] == "client-a"
    assert checked["client_id"] == "client-a"
    assert checked["mask_not_found"] is True
    assert issues.inserted[0]["tenant_id"] == "tenant-a"


def test_direct_issue_update_masks_foreign_client_before_mutation(monkeypatch):
    issue = _Collection(document={
        "id": "issue-b", "tenant_id": "tenant-a", "client_id": "client-b", "status": "open",
    })
    monkeypatch.setattr(compliance, "db", SimpleNamespace(compliance_issues=issue))

    async def reject_scope(*_args, **_kwargs):
        raise HTTPException(status_code=404, detail="Resource not found")

    monkeypatch.setattr(compliance, "assert_client_scope", reject_scope)

    with pytest.raises(HTTPException) as denied:
        asyncio.run(compliance.update_compliance_issue("issue-b", {"title": "Tampered"}, _Request(), _user()))

    assert denied.value.status_code == 404
    assert issue.updates == []


def test_compliance_evidence_metadata_uses_scoped_download_without_storage_paths():
    metadata = compliance._compliance_attachment_response("issue-a", {
        "id": "evidence-a", "name": "audit.pdf", "stored_filename": "private.pdf",
        "url": "/api/uploads/compliance-evidence/private.pdf",
        "artifact_storage": {"provider": "supabase", "object_path": "private/object.pdf"},
    })

    assert metadata["download_url"] == "/api/compliance/issues/issue-a/attachments/evidence-a/download"
    assert "url" not in metadata
    assert "stored_filename" not in metadata
    assert "artifact_storage" not in metadata


def test_compliance_evidence_download_is_private_audited_and_supports_legacy_files(monkeypatch, tmp_path):
    filename = "legacy-evidence.pdf"
    (tmp_path / filename).write_bytes(b"%PDF-private")
    issue = {
        "id": "issue-a", "tenant_id": "tenant-a", "client_id": "client-a", "title": "Evidence review",
        "attachments": [{
            "id": "evidence-a", "name": "audit.pdf", "url": f"/api/uploads/compliance-evidence/{filename}",
            "content_type": "application/pdf", "security_scan": {"status": "clean"},
        }],
    }
    audited = []

    async def scoped_issue(_issue_id, _user, **_kwargs):
        return issue

    async def audit(*args, **kwargs):
        audited.append((args, kwargs))

    monkeypatch.setattr(compliance, "_get_scoped_compliance_issue", scoped_issue)
    monkeypatch.setattr(compliance, "_write_compliance_audit", audit)
    monkeypatch.setattr(compliance, "COMPLIANCE_EVIDENCE_DIR", tmp_path / "private")
    monkeypatch.setattr(compliance, "LEGACY_COMPLIANCE_EVIDENCE_DIR", tmp_path)

    response = asyncio.run(compliance.download_compliance_issue_attachment(
        "issue-a", "evidence-a", SimpleNamespace(), _user(),
    ))

    assert response.body == b"%PDF-private"
    assert response.headers["cache-control"] == "private, no-store"
    assert response.headers["content-disposition"] == 'attachment; filename="audit.pdf"'
    assert audited


def test_compliance_evidence_upload_scans_and_keeps_bytes_out_of_public_mount(monkeypatch, tmp_path):
    issue = {
        "id": "issue-a", "tenant_id": "tenant-a", "client_id": "client-a", "title": "Evidence review",
        "attachments": [],
    }
    issue_collection = _Collection(document=issue)
    captured = {}
    audit_events = []

    async def scoped_issue(_issue_id, _user, **_kwargs):
        return issue

    async def clean_scan(**kwargs):
        captured["scan"] = kwargs
        return SimpleNamespace(metadata=lambda: {"status": "clean", "provider": "test"})

    async def release(_database, clean_upload):
        captured["released"] = clean_upload

    async def audit(*args, **kwargs):
        audit_events.append((args, kwargs))

    monkeypatch.setattr(compliance, "_get_scoped_compliance_issue", scoped_issue)
    monkeypatch.setattr(compliance, "db", SimpleNamespace(compliance_issues=issue_collection))
    private_dir = tmp_path / "private"
    private_dir.mkdir()
    monkeypatch.setattr(compliance, "COMPLIANCE_EVIDENCE_DIR", private_dir)
    monkeypatch.setattr(compliance, "inspect_upload", clean_scan)
    monkeypatch.setattr(compliance, "release_upload", release)
    monkeypatch.setattr(compliance, "_write_compliance_audit", audit)
    monkeypatch.setattr(compliance, "archive_record_artifact", _no_artifact)

    result = asyncio.run(compliance.upload_compliance_issue_attachment(
        "issue-a", SimpleNamespace(), UploadFile(file=BytesIO(b"customer evidence"), filename="evidence.txt", headers={"content-type": "text/plain"}),
        "reviewed", _user(),
    ))

    assert captured["scan"]["tenant_id"] == "tenant-a"
    assert captured["scan"]["client_id"] == "client-a"
    assert result["download_url"].startswith("/api/compliance/issues/issue-a/attachments/")
    assert "url" not in result and "stored_filename" not in result
    assert list(private_dir.iterdir())
    assert issue_collection.updates[0][0] == {
        "$and": [
            {"$and": [
                {"id": "issue-a", "archived": {"$ne": True}},
                {"client_id": {"$in": ["client-a"]}},
            ]},
            {"tenant_id": "tenant-a"},
        ]
    }
    assert captured["released"]
    assert audit_events


def _no_artifact(*_args, **_kwargs):
    async def _return_none():
        return None
    return _return_none()


def test_scan_generated_issue_is_tenant_bound_and_updates_only_its_source_key(monkeypatch):
    issues = _Collection()
    monkeypatch.setattr(compliance, "db", SimpleNamespace(compliance_issues=issues))
    report = {
        "tenant_id": "tenant-a", "site_id": "site-a", "client_id": "client-a",
        "framework": "cis", "framework_name": "CIS Controls", "client_name": "Client A",
        "id": "scan-a", "scanned_at": "2026-09-01T00:00:00+00:00",
        "controls": [{"id": "CIS-1", "name": "Inventory", "status": "fail"}],
    }

    asyncio.run(compliance._sync_compliance_issues(report, _user()))

    assert issues.find_one_query == {
        "$and": [
            {"$and": [{
                "client_id": "client-a", "framework_id": "cis", "control_id": "CIS-1", "source": "evidence_scan",
            }, {"client_id": {"$in": ["client-a"]}}]},
            {"tenant_id": "tenant-a"},
        ]
    }
    assert issues.inserted[0]["tenant_id"] == "tenant-a"
    assert issues.inserted[0]["site_id"] == "site-a"


def test_compliance_evidence_retention_is_outside_public_upload_mount():
    assert compliance.COMPLIANCE_EVIDENCE_DIR != compliance.LEGACY_COMPLIANCE_EVIDENCE_DIR
    assert compliance.COMPLIANCE_EVIDENCE_DIR.parent.name == "private_uploads"
    assert compliance._evidence_filename({"stored_filename": "../other.pdf"}) == "other.pdf"
    assert compliance._evidence_filename({"stored_filename": "../../other.pdf"}) == "other.pdf"
    server_source = (Path(__file__).resolve().parents[1] / "server.py").read_text(encoding="utf-8")
    blocked = server_source.index("/api/uploads/compliance-evidence/{legacy_path:path}")
    public_mount = server_source.index('app.mount("/api/uploads"')
    assert blocked < public_mount


def test_custom_framework_list_and_lookup_hide_other_tenants(monkeypatch):
    frameworks = _Collection(rows=[
        {"id": "custom-a", "tenant_id": "tenant-a", "name": "Tenant A framework"},
        {"id": "custom-b", "tenant_id": "tenant-b", "name": "Tenant B framework"},
    ])
    monkeypatch.setattr(compliance, "db", SimpleNamespace(compliance_custom_frameworks=frameworks))

    visible = asyncio.run(compliance._custom_frameworks(_user()))
    hidden = asyncio.run(compliance._framework_definition("custom-b", _user()))

    assert list(visible) == ["custom-a"]
    assert frameworks.find_query == compliance.tenant_scoped_query(_user(), {"archived": {"$ne": True}})
    assert hidden is None


def test_foreign_custom_framework_is_hidden_from_direct_mutation(monkeypatch):
    frameworks = _Collection(document={
        "id": "custom-b", "tenant_id": "tenant-b", "name": "Tenant B framework", "controls": [],
    })
    monkeypatch.setattr(compliance, "db", SimpleNamespace(compliance_custom_frameworks=frameworks))

    with pytest.raises(HTTPException) as denied:
        asyncio.run(compliance.update_custom_framework(
            "custom-b", {"name": "Changed"}, _Request(), _user(is_admin=True),
        ))

    assert denied.value.status_code == 404
    assert frameworks.updates == []
    assert frameworks.find_one_query == compliance.tenant_scoped_query(
        _user(is_admin=True), {"id": "custom-b", "archived": {"$ne": True}}
    )


def test_custom_framework_creation_uses_actor_tenant_and_audits(monkeypatch):
    frameworks = _Collection()
    audits = []

    async def audit(*args, **kwargs):
        audits.append((args, kwargs))

    monkeypatch.setattr(compliance, "db", SimpleNamespace(compliance_custom_frameworks=frameworks))
    monkeypatch.setattr(compliance, "_write_compliance_audit", audit)

    created = asyncio.run(compliance.create_custom_framework(
        {"name": "Tenant framework", "tenant_id": "tenant-b"}, _Request(), _user(is_admin=True),
    ))

    assert created["tenant_id"] == "tenant-a"
    assert frameworks.inserted[0]["tenant_id"] == "tenant-a"
    assert audits and audits[0][0][1] == "compliance_framework_created"


def test_policy_mutation_selector_repeats_tenant_client_and_site_binding():
    policy = {
        "id": "policy-a", "tenant_id": "tenant-a", "client_id": "client-a", "site_id": "site-a",
    }

    query = compliance._compliance_policy_record_query(_user(), policy)

    assert query == {
        "$and": [
            {"id": "policy-a", "archived": {"$ne": True}, "client_id": "client-a", "site_id": "site-a"},
            {"tenant_id": "tenant-a"},
        ]
    }


def test_compliance_policy_update_repeats_owned_client_and_site_selector(monkeypatch):
    policy = {
        "id": "policy-a", "tenant_id": "tenant-a", "client_id": "client-a", "site_id": "site-a",
        "name": "Existing policy", "content": "Policy content", "status": "draft", "version": 1,
    }
    policies = _Collection(document=policy)

    async def audit(*_args, **_kwargs):
        return None

    monkeypatch.setattr(compliance, "db", SimpleNamespace(compliance_policies=policies))
    monkeypatch.setattr(compliance, "_write_compliance_audit", audit)

    asyncio.run(compliance.update_compliance_policy(
        "policy-a", {"category": "Security"}, _Request(), _user(is_admin=True),
    ))

    expected_query = compliance._compliance_policy_record_query(_user(is_admin=True), policy)
    assert policies.updates[0][0] == expected_query


def test_compliance_policy_scope_keeps_globals_and_filters_client_site(monkeypatch):
    monkeypatch.setattr(compliance, "effective_scope", lambda _user: {
        "mode": "restricted", "client_ids": ["client-a"], "site_ids": ["site-a"],
    })

    query = compliance._compliance_policy_scope_query(_user(), {"archived": {"$ne": True}})

    assert query["$and"][-1] == {"tenant_id": "tenant-a"}
    boundary = query["$and"][0]["$and"][1]
    assert boundary["$or"][0]["$or"] == [
        {"client_id": None}, {"client_id": ""}, {"client_id": {"$exists": False}},
    ]
    assert {"site_id": {"$in": ["site-a"]}} in boundary["$or"][1]["$and"]
    assert boundary["$or"][1]["$and"][0] == {"client_id": {"$in": ["client-a"]}}


def test_direct_policy_lookup_masks_foreign_tenant_even_if_id_is_known(monkeypatch):
    policies = _Collection(document={
        "id": "policy-b", "tenant_id": "tenant-b", "client_id": "client-a", "status": "approved",
    })
    monkeypatch.setattr(compliance, "db", SimpleNamespace(compliance_policies=policies))

    with pytest.raises(HTTPException) as denied:
        asyncio.run(compliance._get_scoped_compliance_policy("policy-b", _user()))

    assert denied.value.status_code == 404
    assert policies.find_one_query == compliance.tenant_scoped_query(
        _user(), {"id": "policy-b", "archived": {"$ne": True}}
    )


def test_create_policy_uses_server_tenant_and_authorised_client(monkeypatch):
    policies = _Collection()
    audits = _Collection()
    monkeypatch.setattr(compliance, "db", SimpleNamespace(
        compliance_policies=policies, compliance_custom_frameworks=_Collection(), audit_logs=audits,
    ))
    checked = {}

    async def scoped_client(client_id, user, **kwargs):
        checked.update(client_id=client_id, user=user, **kwargs)
        return {"id": client_id, "tenant_id": "tenant-a", "site_id": "site-a", "name": "Client A"}

    async def audit(*_args, **_kwargs):
        return None

    monkeypatch.setattr(compliance, "_get_scoped_compliance_client", scoped_client)
    monkeypatch.setattr(compliance, "_write_compliance_audit", audit)

    policy = asyncio.run(compliance.create_compliance_policy(
        {"name": "Client security policy", "client_id": "client-a", "tenant_id": "tenant-b"},
        _Request(), _user(),
    ))

    assert policy["tenant_id"] == "tenant-a"
    assert policy["client_id"] == "client-a"
    assert policy["site_id"] == "site-a"
    assert policies.inserted[0]["tenant_id"] == "tenant-a"
    assert checked["client_id"] == "client-a"
