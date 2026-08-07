"""Nexus Agent device identity, certificate and signed-policy contracts.

The API can continue accepting the existing per-agent token while endpoints
move to certificate-authenticated transport behind a validating reverse proxy.
Private device keys are generated on the endpoint and never leave it; this
service signs only a verified certificate signing request (CSR).
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ed25519, rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID


_PROJECT_ROOT = Path(__file__).resolve().parents[3]
PKI_DIR = Path(os.environ.get("NEXUS_AGENT_PKI_DIR", _PROJECT_ROOT / "data" / "agent-pki"))
CA_KEY_PATH = PKI_DIR / "nexus-agent-ca.key"
CA_CERT_PATH = PKI_DIR / "nexus-agent-ca.pem"
UPDATE_KEY_PATH = PKI_DIR / "nexus-agent-update-signing.key"
UPDATE_PUBLIC_PATH = PKI_DIR / "nexus-agent-update-signing.pub"
CERT_VALIDITY_DAYS = 90


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _atomic_private_write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(content)
    try:
        os.chmod(temporary, 0o600)
    except OSError:
        pass
    temporary.replace(path)


def ensure_agent_authority() -> tuple[rsa.RSAPrivateKey, x509.Certificate]:
    """Load or initialise the local development CA used for agent identities."""
    if CA_KEY_PATH.exists() and CA_CERT_PATH.exists():
        key = serialization.load_pem_private_key(CA_KEY_PATH.read_bytes(), password=None)
        certificate = x509.load_pem_x509_certificate(CA_CERT_PATH.read_bytes())
        return key, certificate

    key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    subject = x509.Name([
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "NexusMSP"),
        x509.NameAttribute(NameOID.COMMON_NAME, "Nexus Agent Device Identity CA"),
    ])
    now = _now()
    certificate = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=5))
        .not_valid_after(now + timedelta(days=3650))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                key_encipherment=False,
                content_commitment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=True,
                crl_sign=True,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .sign(key, hashes.SHA256())
    )
    _atomic_private_write(
        CA_KEY_PATH,
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ),
    )
    CA_CERT_PATH.parent.mkdir(parents=True, exist_ok=True)
    CA_CERT_PATH.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
    return key, certificate


def issue_device_certificate(
    *,
    csr_pem: str,
    device_id: str,
    client_id: str,
    hostname: str,
) -> dict[str, Any]:
    """Validate an endpoint CSR and issue a short-lived client certificate."""
    try:
        csr = x509.load_pem_x509_csr(csr_pem.encode("utf-8"))
    except (TypeError, ValueError) as exc:
        raise ValueError("Device certificate request is not valid PEM") from exc
    if not csr.is_signature_valid:
        raise ValueError("Device certificate request signature is invalid")

    ca_key, ca_certificate = ensure_agent_authority()
    now = _now()
    expires = now + timedelta(days=CERT_VALIDITY_DAYS)
    common_name = f"nexus-agent:{device_id}"
    san_entries: list[x509.GeneralName] = [
        x509.UniformResourceIdentifier(
            f"spiffe://nexusmsp/clients/{client_id or 'unassigned'}/devices/{device_id}"
        )
    ]
    safe_hostname = str(hostname or "").strip()
    if safe_hostname and len(safe_hostname) <= 253:
        san_entries.append(x509.DNSName(safe_hostname))

    certificate = (
        x509.CertificateBuilder()
        .subject_name(
            x509.Name([
                x509.NameAttribute(NameOID.ORGANIZATION_NAME, "NexusMSP Agent"),
                x509.NameAttribute(NameOID.COMMON_NAME, common_name),
            ])
        )
        .issuer_name(ca_certificate.subject)
        .public_key(csr.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=5))
        .not_valid_after(expires)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.CLIENT_AUTH]), critical=True)
        .add_extension(x509.SubjectAlternativeName(san_entries), critical=False)
        .sign(ca_key, hashes.SHA256())
    )
    der = certificate.public_bytes(serialization.Encoding.DER)
    fingerprint = hashlib.sha256(der).hexdigest()
    return {
        "certificate_pem": certificate.public_bytes(serialization.Encoding.PEM).decode("ascii"),
        "ca_certificate_pem": ca_certificate.public_bytes(serialization.Encoding.PEM).decode("ascii"),
        "fingerprint_sha256": fingerprint,
        "serial_number": format(certificate.serial_number, "x"),
        "issued_at": now.isoformat(),
        "expires_at": expires.isoformat(),
        "subject": common_name,
        "spiffe_id": f"spiffe://nexusmsp/clients/{client_id or 'unassigned'}/devices/{device_id}",
    }


def _ensure_update_signing_key() -> ed25519.Ed25519PrivateKey:
    if UPDATE_KEY_PATH.exists():
        return serialization.load_pem_private_key(UPDATE_KEY_PATH.read_bytes(), password=None)
    key = ed25519.Ed25519PrivateKey.generate()
    _atomic_private_write(
        UPDATE_KEY_PATH,
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ),
    )
    public_raw = key.public_key().public_bytes(
        serialization.Encoding.Raw,
        serialization.PublicFormat.Raw,
    )
    UPDATE_PUBLIC_PATH.parent.mkdir(parents=True, exist_ok=True)
    UPDATE_PUBLIC_PATH.write_text(base64.b64encode(public_raw).decode("ascii"), encoding="ascii")
    return key


def sign_update_manifest(*, version: str, sha256: str, size: int) -> dict[str, Any]:
    key = _ensure_update_signing_key()
    signed_payload = f"{version}|{sha256.lower()}|{int(size)}"
    signature = key.sign(signed_payload.encode("utf-8"))
    public_raw = key.public_key().public_bytes(
        serialization.Encoding.Raw,
        serialization.PublicFormat.Raw,
    )
    return {
        "signature_algorithm": "ed25519",
        "signature": base64.b64encode(signature).decode("ascii"),
        "signing_public_key": base64.b64encode(public_raw).decode("ascii"),
        "signed_payload": signed_payload,
    }


def agent_command_signing_metadata() -> dict[str, str]:
    """Return the stable public trust anchor used for privileged commands."""
    key = _ensure_update_signing_key()
    public_raw = key.public_key().public_bytes(
        serialization.Encoding.Raw,
        serialization.PublicFormat.Raw,
    )
    return {
        "signature_algorithm": "ed25519",
        "signing_public_key": base64.b64encode(public_raw).decode("ascii"),
        "signing_key_id": hashlib.sha256(public_raw).hexdigest()[:24],
    }


def sign_agent_command_payload(signed_payload: str) -> dict[str, str]:
    """Sign one canonical command authorization payload."""
    if not str(signed_payload or "").strip():
        raise ValueError("Command authorization payload is required")
    key = _ensure_update_signing_key()
    metadata = agent_command_signing_metadata()
    signature = key.sign(signed_payload.encode("utf-8"))
    return {
        **metadata,
        "signature": base64.b64encode(signature).decode("ascii"),
        "signed_payload": signed_payload,
    }


def build_agent_policy(settings: dict[str, Any], dns_profile: dict[str, Any]) -> dict[str, Any]:
    """Return a deterministic, cacheable policy document for every heartbeat."""
    document = {
        "schema_version": 1,
        "heartbeat_secs": min(max(int(settings.get("heartbeat_secs") or 60), 15), 3600),
        "poll_secs": min(max(int(settings.get("poll_secs") or 10), 2), 300),
        "modules": {
            "inventory": True,
            "commands": True,
            "nexus_shield": True,
            "nexus_canary": True,
            "nexus_dns": bool(dns_profile.get("enabled", True)),
            "nexus_elevate": True,
            "client_chat": True,
        },
        "updates": {
            "enabled": bool(settings.get("auto_update_enabled", True)),
            "signed_manifest_required": bool(settings.get("require_signed_updates", True)),
            "rollback_on_failed_health_check": True,
            **agent_command_signing_metadata(),
        },
        "commands": {
            "signed_envelope_required": True,
            "maximum_clock_skew_seconds": 300,
            "replay_cache_entries": 500,
            **agent_command_signing_metadata(),
        },
        "self_repair": {
            "enabled": bool(settings.get("self_repair_enabled", True)),
            "verify_config": True,
            "verify_identity_files": True,
            "verify_policy_checksum": True,
            "repair_companion_shortcuts": True,
        },
        "dns": {
            "mode": dns_profile.get("mode", "visibility"),
            "deployment_id": dns_profile.get("deployment_id", ""),
            "local_policy_cache": bool(dns_profile.get("local_policy_cache", True)),
        },
    }
    canonical = json.dumps(document, sort_keys=True, separators=(",", ":"))
    checksum = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return {
        **document,
        "version": checksum[:16],
        "checksum_sha256": checksum,
        "issued_at": _now().isoformat(),
    }


def agent_trust_state(agent: dict[str, Any]) -> dict[str, Any]:
    identity = agent.get("device_identity") if isinstance(agent.get("device_identity"), dict) else {}
    fingerprint = str(identity.get("certificate_fingerprint") or "")
    transport = str(identity.get("last_transport") or "token")
    expires_at = identity.get("certificate_expires_at")
    expired = False
    if expires_at:
        try:
            expired = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00")) <= _now()
        except ValueError:
            expired = True
    if transport == "mtls" and fingerprint and not expired:
        status = "mtls_verified"
    elif fingerprint and not expired:
        status = "certificate_issued"
    elif expired:
        status = "certificate_expired"
    else:
        status = "legacy_token"
    return {
        "status": status,
        "transport": transport,
        "certificate_fingerprint": fingerprint,
        "certificate_expires_at": expires_at,
        "spiffe_id": identity.get("spiffe_id"),
        "install_id": identity.get("install_id"),
        "policy_version": (agent.get("policy_evidence") or {}).get("version"),
        "self_repair_status": (agent.get("self_repair") or {}).get("status", "not_reported"),
    }
