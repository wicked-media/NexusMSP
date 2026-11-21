"""Packaging contracts for first-party Native Remote distribution."""

import asyncio
import io
import json
import os
import sys
import zipfile
from pathlib import Path
from types import SimpleNamespace


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.routers import nexus_agent  # noqa: E402
from app.services import agent_runtime  # noqa: E402


class _Collection:
    def __init__(self, one=None):
        self.one = one
        self.inserted = []

    async def find_one(self, _query, _projection=None):
        return dict(self.one) if self.one else None

    async def insert_one(self, document):
        self.inserted.append(dict(document))


def _request():
    return SimpleNamespace(
        headers={},
        url=SimpleNamespace(scheme="https"),
        base_url="https://nexus.example.test/",
    )


def test_generated_installer_advertises_and_packages_native_remote(tmp_path, monkeypatch):
    agent_binary = tmp_path / "nexus-agent.exe"
    agent_binary.write_bytes(b"agent-binary")
    chat_binary = tmp_path / "nexus-client-chat.exe"
    chat_binary.write_bytes(b"chat-companion")
    tray_binary = tmp_path / "nexus-agent-tray.exe"
    tray_binary.write_bytes(b"tray-companion")
    remote_binary = tmp_path / "nexus-remote-companion.exe"
    remote_binary.write_bytes(b"native-remote-companion")

    installers = _Collection()
    audit = _Collection()
    database = SimpleNamespace(
        clients=_Collection({"id": "client-1", "name": "Example Client"}),
        nexus_agent_settings=_Collection({
            "server_url": "https://nexus.example.test",
            "heartbeat_secs": 120,
            "poll_secs": 30,
        }),
        nexus_agent_enrollment_tokens=_Collection(),
        nexus_agent_installers=installers,
        nexus_agent_audit=audit,
    )

    async def _allow_scope(*_args, **_kwargs):
        return {}

    captured = {}

    def _storage_put(path, data, content_type="application/zip"):
        captured.update(path=path, data=data, content_type=content_type)
        return {"path": path, "content_type": content_type}

    monkeypatch.setattr(nexus_agent, "db", database)
    monkeypatch.setattr(nexus_agent, "assert_client_scope", _allow_scope)
    monkeypatch.setattr(nexus_agent, "AGENT_BINARY_PATH", agent_binary)
    monkeypatch.setattr(nexus_agent, "CHAT_COMPANION_BINARY_PATH", chat_binary)
    monkeypatch.setattr(nexus_agent, "TRAY_COMPANION_BINARY_PATH", tray_binary)
    monkeypatch.setattr(nexus_agent, "REMOTE_COMPANION_BINARY_PATH", remote_binary)
    monkeypatch.setattr(nexus_agent, "_storage_put", _storage_put)

    result = asyncio.run(nexus_agent.build_installer(
        nexus_agent.InstallerBuildRequest(client_id="client-1"),
        _request(),
        {"id": "tech-1", "email": "tech@example.test", "tenant_id": "tenant-1", "is_admin": True, "role": "admin"},
    ))

    assert result["includes_native_remote"] is True
    assert installers.inserted[0]["includes_native_remote"] is True
    assert audit.inserted[0]["kind"] == "installer_built"
    assert audit.inserted[0]["payload"]["includes_native_remote"] is True

    with zipfile.ZipFile(io.BytesIO(captured["data"])) as bundle:
        names = set(bundle.namelist())
        install_script = bundle.read("install.bat").decode("utf-8")
        release_manifest = json.loads(bundle.read("release-manifest.json"))

    assert "nexus-remote-companion.exe" in names
    assert "taskkill /F /IM nexus-remote-companion.exe" in install_script
    assert release_manifest["bundled_components"]["native_remote"] is True


def test_signed_release_version_file_is_validated(tmp_path):
    version_file = tmp_path / "VERSION"
    version_file.write_text("0.1.20-signed\n", encoding="utf-8")
    assert agent_runtime.read_agent_release_version(version_file) == "0.1.20-signed"

    version_file.write_text("..\\not-a-release", encoding="utf-8")
    assert agent_runtime.read_agent_release_version(version_file) == ""
    assert agent_runtime.read_agent_release_version(tmp_path / "missing") == ""


def test_installer_without_companion_fails_closed_without_broken_copy_step():
    archive = agent_runtime.build_installer_zip(
        client_id="client-1",
        client_name="Example Client",
        enrollment_token="token-1",
        server_url="https://nexus.example.test",
        binary_bytes=b"agent-binary",
        chat_companion_bytes=b"chat-companion",
        tray_companion_bytes=b"tray-companion",
        remote_companion_bytes=None,
        heartbeat_secs=60,
        poll_secs=10,
        agent_version="0.1.20-test",
    )

    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        names = set(bundle.namelist())
        install_script = bundle.read("install.bat").decode("utf-8")
        release_manifest = json.loads(bundle.read("release-manifest.json"))

    assert "nexus-remote-companion.exe" not in names
    assert "taskkill /F /IM nexus-remote-companion.exe" not in install_script
    assert "Could not copy nexus-remote-companion.exe" not in install_script
    assert release_manifest["bundled_components"]["native_remote"] is False
