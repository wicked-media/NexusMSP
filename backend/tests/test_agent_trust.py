import base64
from datetime import datetime, timezone

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, ed25519
from cryptography.x509.oid import ExtendedKeyUsageOID

from app.services import agent_trust


def _csr() -> str:
    key = ec.generate_private_key(ec.SECP256R1())
    request = (
        x509.CertificateSigningRequestBuilder()
        .subject_name(x509.Name([x509.NameAttribute(x509.NameOID.COMMON_NAME, "test-agent")]))
        .sign(key, hashes.SHA256())
    )
    return request.public_bytes(serialization.Encoding.PEM).decode("ascii")


def test_device_certificate_has_client_auth_and_spiffe_identity(tmp_path, monkeypatch):
    monkeypatch.setattr(agent_trust, "PKI_DIR", tmp_path)
    monkeypatch.setattr(agent_trust, "CA_KEY_PATH", tmp_path / "ca.key")
    monkeypatch.setattr(agent_trust, "CA_CERT_PATH", tmp_path / "ca.pem")

    issued = agent_trust.issue_device_certificate(
        csr_pem=_csr(),
        device_id="device-1",
        client_id="client-1",
        hostname="TEST-PC",
    )

    certificate = x509.load_pem_x509_certificate(issued["certificate_pem"].encode("ascii"))
    eku = certificate.extensions.get_extension_for_class(x509.ExtendedKeyUsage).value
    san = certificate.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    assert ExtendedKeyUsageOID.CLIENT_AUTH in eku
    assert "spiffe://nexusmsp/clients/client-1/devices/device-1" in san.get_values_for_type(
        x509.UniformResourceIdentifier
    )
    assert len(issued["fingerprint_sha256"]) == 64
    assert datetime.fromisoformat(issued["expires_at"]) > datetime.now(timezone.utc)


def test_update_manifest_is_ed25519_signed(tmp_path, monkeypatch):
    monkeypatch.setattr(agent_trust, "PKI_DIR", tmp_path)
    monkeypatch.setattr(agent_trust, "UPDATE_KEY_PATH", tmp_path / "update.key")
    monkeypatch.setattr(agent_trust, "UPDATE_PUBLIC_PATH", tmp_path / "update.pub")

    manifest = agent_trust.sign_update_manifest(
        version="0.1.7-nexus-identity",
        sha256="a" * 64,
        size=1024,
    )

    public_key = ed25519.Ed25519PublicKey.from_public_bytes(base64.b64decode(manifest["signing_public_key"]))
    public_key.verify(
        base64.b64decode(manifest["signature"]),
        manifest["signed_payload"].encode("utf-8"),
    )
    assert manifest["signed_payload"] == f"0.1.7-nexus-identity|{'a' * 64}|1024"


def test_command_authorization_is_ed25519_signed_with_stable_key(tmp_path, monkeypatch):
    monkeypatch.setattr(agent_trust, "PKI_DIR", tmp_path)
    monkeypatch.setattr(agent_trust, "UPDATE_KEY_PATH", tmp_path / "update.key")
    monkeypatch.setattr(agent_trust, "UPDATE_PUBLIC_PATH", tmp_path / "update.pub")

    signed = agent_trust.sign_agent_command_payload(
        "1|command-1|device-1|client-1|ping|payload-hash|issued|expires|nonce|operator||system"
    )
    metadata = agent_trust.agent_command_signing_metadata()

    public_key = ed25519.Ed25519PublicKey.from_public_bytes(base64.b64decode(signed["signing_public_key"]))
    public_key.verify(base64.b64decode(signed["signature"]), signed["signed_payload"].encode("utf-8"))
    assert signed["signing_public_key"] == metadata["signing_public_key"]
    assert signed["signing_key_id"] == metadata["signing_key_id"]


def test_agent_policy_checksum_is_deterministic():
    settings = {
        "heartbeat_secs": 60,
        "poll_secs": 10,
        "auto_update_enabled": True,
        "self_repair_enabled": True,
        "require_signed_updates": True,
    }
    dns = {"enabled": True, "mode": "visibility", "local_policy_cache": True}
    first = agent_trust.build_agent_policy(settings, dns)
    second = agent_trust.build_agent_policy(settings, dns)
    assert first["checksum_sha256"] == second["checksum_sha256"]
    assert first["version"] == second["version"]
    assert first["updates"]["signed_manifest_required"] is True
    assert first["commands"]["signed_envelope_required"] is True
    assert first["commands"]["signature_algorithm"] == "ed25519"


def test_trust_state_distinguishes_issued_and_verified_transport():
    base = {
        "device_identity": {
            "certificate_fingerprint": "a" * 64,
            "certificate_expires_at": "2099-01-01T00:00:00+00:00",
            "last_transport": "token",
        }
    }
    assert agent_trust.agent_trust_state(base)["status"] == "certificate_issued"
    base["device_identity"]["last_transport"] = "mtls"
    assert agent_trust.agent_trust_state(base)["status"] == "mtls_verified"
