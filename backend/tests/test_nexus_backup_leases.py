from app.services.nexus_backup_leases import issue_capture_lease


def test_capture_lease_is_scoped_and_carries_no_secret_or_path():
    lease = issue_capture_lease(
        tenant_id="tenant-1", client_id="client-1", device_id="device-1", job_id="job-1",
        capture_id="capture-1", source_profile="user_data",
    )
    assert lease["tenant_id"] == "tenant-1"
    assert lease["client_id"] == "client-1"
    assert lease["device_id"] == "device-1"
    assert lease["signature_algorithm"] == "ed25519"
    assert "source_path" not in lease
    assert "encryption_key" not in lease
    assert "vault_url" not in lease
