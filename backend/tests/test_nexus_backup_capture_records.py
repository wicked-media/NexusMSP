import pytest

from app.services.nexus_backup_capture_records import public_capture_record, validate_capture_record


def record():
    return {"schema_version": 1, "tenant_id": "tenant-1", "client_id": "client-1", "device_id": "device-1", "job_id": "job-1", "capture_id": "capture-1", "envelope_key_id": "key-1", "wrapped_data_key": "base64-ciphertext", "chunks": [{"ordinal": 0, "plaintext_bytes": 4, "ciphertext_bytes": 20, "plaintext_sha256": "a" * 64, "ciphertext_sha256": "b" * 64, "nonce_b64": "nonce"}]}


def test_capture_record_rejects_source_paths_and_projects_safe_metadata():
    value = record()
    validated = validate_capture_record(value)
    public = public_capture_record({**validated, "id": "nbc-1"})
    assert public["chunk_count"] == 1
    assert "wrapped_data_key" not in public
    value["source_path"] = "C:/customer-data"
    with pytest.raises(ValueError):
        validate_capture_record(value)
