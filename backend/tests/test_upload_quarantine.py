"""Malware scanner and private upload-quarantine contracts."""

from __future__ import annotations

import asyncio
import os
from pathlib import Path
import time
from types import SimpleNamespace

import pytest
import yaml

from app.services import malware_scanner, upload_quarantine
from app.services.malware_scanner import MalwareScanFailure
from app.services.upload_quarantine import UploadQuarantineFailure


ROOT = Path(__file__).resolve().parents[2]


class _Collection:
    def __init__(self):
        self.records: list[dict] = []

    async def insert_one(self, record: dict):
        self.records.append(dict(record))
        return SimpleNamespace(inserted_id=record.get("id"))

    async def update_one(self, query: dict, update: dict):
        for record in self.records:
            if all(
                record.get(key) in value["$in"]
                if isinstance(value, dict) and "$in" in value
                else record.get(key) == value
                for key, value in query.items()
            ):
                record.update(update.get("$set", {}))
                return SimpleNamespace(modified_count=1)
        return SimpleNamespace(modified_count=0)


def _database():
    return SimpleNamespace(upload_quarantine=_Collection(), audit_logs=_Collection())


def _inspect(database, content: bytes):
    return upload_quarantine.inspect_upload(
        database=database,
        content=content,
        filename="evidence.txt",
        content_type="text/plain",
        tenant_id="tenant-1",
        client_id="client-1",
        target_type="client_document",
        target_id="document-1",
        actor_id="tech-1",
        actor_name="Technician One",
    )


def test_scanner_fails_closed_when_no_provider_is_configured(monkeypatch):
    monkeypatch.delenv("NEXUS_MALWARE_SCANNER", raising=False)

    with pytest.raises(MalwareScanFailure) as exc:
        asyncio.run(malware_scanner.scan_upload(b"customer evidence"))

    assert exc.value.reason_code == "scanner_unavailable"
    assert exc.value.rejected is False


def test_production_compose_keeps_clamav_private_and_mandatory_for_api():
    compose = yaml.safe_load((ROOT / "docker-compose.production.yml").read_text(encoding="utf-8"))
    services = compose["services"]

    assert services["clamav"]["image"] == "clamav/clamav:1.4"
    assert "ports" not in services["clamav"]
    assert services["clamav"]["networks"] == ["backend"]
    assert services["api"]["environment"]["NEXUS_MALWARE_SCANNER"] == "clamav"
    assert services["api"]["environment"]["NEXUS_CLAMAV_HOST"] == "clamav"
    assert "clamav" in services["api"]["depends_on"]


def test_acceptance_scanner_requires_the_disposable_runtime_guard():
    compose = yaml.safe_load((ROOT / "docker-compose.acceptance.yml").read_text(encoding="utf-8"))
    environment = compose["services"]["api"]["environment"]

    assert environment["NEXUS_TEST_ENVIRONMENT"] == "1"
    assert environment["NEXUS_MALWARE_SCANNER"] == "test"


def test_deterministic_scanner_is_restricted_to_acceptance_runtime(monkeypatch):
    monkeypatch.setenv("NEXUS_MALWARE_SCANNER", "test")
    monkeypatch.setattr(malware_scanner, "acceptance_environment_enabled", lambda: False)

    with pytest.raises(MalwareScanFailure) as exc:
        asyncio.run(malware_scanner.scan_upload(b"customer evidence"))

    assert exc.value.reason_code == "scanner_misconfigured"

    monkeypatch.setattr(malware_scanner, "acceptance_environment_enabled", lambda: True)
    monkeypatch.setattr(malware_scanner, "environment", lambda: "production")
    with pytest.raises(MalwareScanFailure) as production_exc:
        asyncio.run(malware_scanner.scan_upload(b"customer evidence"))
    assert production_exc.value.reason_code == "scanner_misconfigured"


@pytest.mark.parametrize(
    ("response", "expected_status", "expected_reason"),
    [
        (b"stream: OK\0", "clean", "clean"),
        (b"stream: Eicar-Signature FOUND\0", "infected", "malware_detected"),
    ],
)
def test_clamav_instream_protocol_and_verdict_parsing(response, expected_status, expected_reason):
    async def exercise():
        received = bytearray()
        command = None

        async def handle(reader, writer):
            nonlocal command
            command = await reader.readuntil(b"\0")
            while True:
                size = int.from_bytes(await reader.readexactly(4), "big")
                if size == 0:
                    break
                received.extend(await reader.readexactly(size))
            writer.write(response)
            await writer.drain()
            writer.close()
            await writer.wait_closed()

        server = await asyncio.start_server(handle, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        try:
            result = await malware_scanner._clamav_scan(
                b"customer evidence", host="127.0.0.1", port=port, timeout=2
            )
        finally:
            server.close()
            await server.wait_closed()
        return command, bytes(received), result

    command, received, result = asyncio.run(exercise())

    assert command == b"zINSTREAM\0"
    assert received == b"customer evidence"
    assert result.status == expected_status
    assert result.reason_code == expected_reason


def test_clean_upload_is_private_until_released(monkeypatch, tmp_path):
    database = _database()
    monkeypatch.setenv("NEXUS_MALWARE_SCANNER", "test")
    monkeypatch.setattr(malware_scanner, "acceptance_environment_enabled", lambda: True)
    monkeypatch.setattr(malware_scanner, "environment", lambda: "test")
    monkeypatch.setattr(upload_quarantine, "QUARANTINE_DIR", tmp_path)

    clean = asyncio.run(_inspect(database, b"customer evidence"))
    staged_path = tmp_path / f"{clean.quarantine_id}.quarantine"

    assert staged_path.read_bytes() == b"customer evidence"
    assert database.upload_quarantine.records[0]["status"] == "clean"
    assert database.upload_quarantine.records[0]["client_id"] == "client-1"
    assert database.upload_quarantine.records[0]["tenant_id"] == "tenant-1"
    assert database.audit_logs.records[-1]["metadata"]["reason_code"] == "clean"
    assert all("path" not in record["metadata"] for record in database.audit_logs.records)

    asyncio.run(upload_quarantine.release_upload(database, clean))

    assert not staged_path.exists()
    assert database.upload_quarantine.records[0]["status"] == "released"
    assert database.audit_logs.records[-1]["action"] == "upload_quarantine_released"


def test_malware_is_rejected_and_bytes_are_removed(monkeypatch, tmp_path):
    database = _database()
    monkeypatch.setenv("NEXUS_MALWARE_SCANNER", "test")
    monkeypatch.setattr(malware_scanner, "acceptance_environment_enabled", lambda: True)
    monkeypatch.setattr(malware_scanner, "environment", lambda: "test")
    monkeypatch.setattr(upload_quarantine, "QUARANTINE_DIR", tmp_path)
    eicar = b"X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"

    with pytest.raises(UploadQuarantineFailure) as exc:
        asyncio.run(_inspect(database, eicar))

    assert exc.value.rejected is True
    assert exc.value.reason_code == "malware_detected"
    assert database.upload_quarantine.records[0]["status"] == "infected"
    assert database.audit_logs.records[-1]["action"] == "upload_quarantine_rejected"
    assert list(tmp_path.iterdir()) == []


def test_startup_cleanup_removes_interrupted_quarantine_bytes(monkeypatch, tmp_path):
    database = _database()
    quarantine_id = "abandoned-upload"
    database.upload_quarantine.records.append({"id": quarantine_id, "status": "scanning"})
    path = tmp_path / f"{quarantine_id}.quarantine"
    path.write_bytes(b"orphaned private bytes")
    old_time = time.time() - 7200
    os.utime(path, (old_time, old_time))
    monkeypatch.setattr(upload_quarantine, "QUARANTINE_DIR", tmp_path)

    removed = asyncio.run(upload_quarantine.cleanup_stale_quarantine(database, max_age_seconds=60))

    assert removed == 1
    assert not path.exists()
    assert database.upload_quarantine.records[0]["status"] == "error"
    assert database.upload_quarantine.records[0]["reason_code"] == "stale_quarantine_removed"


@pytest.mark.parametrize("reason_code", ["scanner_unavailable", "scan_timeout", "scanner_error"])
def test_scanner_failures_are_classified_and_fail_closed(monkeypatch, tmp_path, reason_code):
    database = _database()
    monkeypatch.setattr(upload_quarantine, "QUARANTINE_DIR", tmp_path)

    async def fail_scan(_content: bytes):
        raise MalwareScanFailure(reason_code)

    monkeypatch.setattr(upload_quarantine, "scan_upload", fail_scan)

    with pytest.raises(UploadQuarantineFailure) as exc:
        asyncio.run(_inspect(database, b"customer evidence"))

    assert exc.value.rejected is False
    assert exc.value.reason_code == reason_code
    assert database.upload_quarantine.records[0]["status"] == "error"
    assert database.audit_logs.records[-1]["metadata"]["reason_code"] == reason_code
    assert list(tmp_path.iterdir()) == []
