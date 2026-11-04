from app.services.action_permissions import ACTION_PERMISSION_IDS, TECHNICIAN_DEFAULTS
from app.services.nexus_backup import (
    CAPABILITY_INVENTORY_V1,
    agent_backup_readiness,
    capture_release_readiness,
    protection_readiness,
    public_repository,
    public_restore_drill,
)
from app.services import nexus_backup_vault
from app.services.nexus_backup_vault import S3VaultConnection, _put_encrypted_chunk_sync, connection_from_record, validate_endpoint_url
from app.services.secret_store import encrypt_secret
from app.routers.nexus_agent import _safe_backup_preflight_evidence


def test_native_backup_control_plane_never_promotes_intent_to_protection():
    readiness = protection_readiness(
        repository={
            "id": "nbd-1",
            "encryption_attested": True,
            "immutable_storage_attested": True,
            "restore_verification_attested": True,
        },
        device={
            "id": "device-1",
            "nexus_agent_id": "agent-1",
            "agent_runtime_capabilities": [CAPABILITY_INVENTORY_V1],
            "nexus_backup_evidence": {"state": "inventory_only"},
        },
    )
    assert readiness["state"] == "blocked"
    assert readiness["execution_allowed"] is False
    assert "No customer data has been read" in readiness["summary"]


def test_public_destination_drops_private_connection_material():
    public = public_repository({
        "id": "nbd-1",
        "client_id": "client-1",
        "destination_type": "s3_compatible",
        "destination_name": "Immutable vault",
        "secret_ref": "server-only-secret",
        "endpoint_url": "https://private.example.test/bucket",
        "object_path": "tenants/client-1",
    })
    assert public["id"] == "nbd-1"
    assert "secret_ref" not in public
    assert "endpoint_url" not in public
    assert "object_path" not in public


def test_agent_inventory_is_not_a_capture_capability():
    readiness = agent_backup_readiness({
        "nexus_agent_id": "agent-1",
        "agent_runtime_capabilities": [CAPABILITY_INVENTORY_V1],
        "nexus_backup_evidence": {"state": "inventory_only"},
    })
    assert readiness["state"] == "inventory_only"
    assert readiness["execution_allowed"] is False


def test_native_backup_actions_are_explicit_and_not_default_technician_rights():
    assert "backup.native.manage" in ACTION_PERMISSION_IDS
    assert "backup.native.capture.request" in ACTION_PERMISSION_IDS
    assert "backup.native.capture.request" not in TECHNICIAN_DEFAULTS


def test_vault_connection_decrypts_server_only_values_without_public_projection():
    record = {
        "endpoint_url_encrypted": encrypt_secret("https://s3.example.test"),
        "bucket_encrypted": encrypt_secret("client-immutable-vault"),
        "region": "ap-southeast-2",
        "access_key_id_encrypted": encrypt_secret("access-key"),
        "secret_access_key_encrypted": encrypt_secret("secret-key"),
    }
    connection = connection_from_record(record)
    assert connection.endpoint_url == "https://s3.example.test"
    assert connection.bucket == "client-immutable-vault"
    assert connection.secret_access_key == "secret-key"


def test_vault_endpoint_rejects_embedded_credentials_and_paths():
    assert validate_endpoint_url("https://vault.example.test/") == "https://vault.example.test"
    for value in ("https://user:pass@vault.example.test", "https://vault.example.test/bucket", "ftp://vault.example.test"):
        try:
            validate_endpoint_url(value)
        except ValueError:
            continue
        raise AssertionError(f"unsafe endpoint was accepted: {value}")


def test_vault_verification_requires_object_lock_and_default_encryption(monkeypatch):
    class MutableBucket:
        def head_bucket(self, **_kwargs):
            return {}

        def get_object_lock_configuration(self, **_kwargs):
            return {"ObjectLockConfiguration": {"ObjectLockEnabled": "Disabled"}}

        def get_bucket_encryption(self, **_kwargs):
            return {"ServerSideEncryptionConfiguration": {"Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]}}

    monkeypatch.setattr(nexus_backup_vault.boto3, "client", lambda *_args, **_kwargs: MutableBucket())
    result = nexus_backup_vault._verify_sync(S3VaultConnection("https://s3.example.test", "ap-southeast-2", "immutable", "key", "secret"))
    assert result == {
        "state": "not_immutable",
        "verified": False,
        "reason_code": "object_lock_not_enabled",
        "encryption_enabled": True,
    }


def test_agent_preflight_evidence_rejects_any_data_plane_claim():
    evidence, unsafe = _safe_backup_preflight_evidence({
        "platform": "windows",
        "capabilities": ["nexus_backup_capability_v1", "nexus_backup_preflight_v1", "not-allowed"],
        "upload_bytes": 1,
        "files_accessed": True,
    })
    assert unsafe is True
    assert evidence["upload_bytes"] == 0
    assert evidence["files_accessed"] is False
    assert evidence["capabilities"] == ["nexus_backup_capability_v1", "nexus_backup_preflight_v1"]


def test_agent_preflight_projection_keeps_only_bounded_windows_posture():
    evidence, unsafe = _safe_backup_preflight_evidence({
        "platform": "windows",
        "vss_state": "ready",
        "volume_capacity_state": "observed",
        "source_path": "C:\\Users\\customer\\Documents",
        "volume_name": "C:",
    })
    assert unsafe is False
    assert evidence["vss_state"] == "ready"
    assert evidence["volume_capacity_state"] == "observed"
    assert "source_path" not in evidence
    assert "volume_name" not in evidence


def test_capture_release_remains_blocked_after_safe_preflight():
    readiness = capture_release_readiness(
        intent={"preflight_result": {"status": "inventory_only"}},
        repository={
            "verification_state": "verified",
            "encryption_attested": True,
            "immutable_storage_attested": True,
            "restore_verification_attested": True,
        },
        device={"agent_runtime_capabilities": [CAPABILITY_INVENTORY_V1, "nexus_backup_preflight_v1"]},
    )
    assert readiness["state"] == "blocked"
    assert readiness["execution_allowed"] is False
    assert any("signed capture worker" in blocker.lower() for blocker in readiness["blockers"])


def test_restore_drill_is_never_projected_as_recovery_proof():
    drill = public_restore_drill({"id": "nbr-1", "job_id": "nbj-1", "state": "planned", "proof_state": "verified"})
    assert drill["proof_state"] == "not_proven"
    assert drill["execution_allowed"] is False


def test_immutable_vault_chunk_write_requires_scoped_key_and_object_lock(monkeypatch):
    calls = []

    class Vault:
        def put_object(self, **kwargs):
            calls.append(kwargs)
            return {"ETag": '"etag-1"', "VersionId": "version-1"}

    monkeypatch.setattr(nexus_backup_vault.boto3, "client", lambda *_args, **_kwargs: Vault())
    receipt = _put_encrypted_chunk_sync(
        S3VaultConnection("https://s3.example.test", "ap-southeast-2", "vault", "key", "secret"),
        object_key="nexus-backup/tenant-1/client-1/device-1/capture-1/chunks/0",
        ciphertext=b"encrypted", retain_until=__import__("datetime").datetime.now(__import__("datetime").timezone.utc),
    )
    assert receipt["ciphertext_bytes"] == len(b"encrypted")
    assert calls[0]["ObjectLockMode"] == "GOVERNANCE"
    assert calls[0]["ServerSideEncryption"] == "AES256"
