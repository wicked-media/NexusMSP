"""Dedicated Backup envelope-key authority.

This key pair is separate from agent command signing, device identity and vault
credentials. The public key may be delivered in a signed policy; the private
key stays server-side and is required for a future isolated restore worker.
Production must provide key paths explicitly rather than generating a key.
"""

from __future__ import annotations

import base64
import hashlib
import os
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from app.services.runtime_config import is_production


_ROOT = Path(__file__).resolve().parents[3]
PRIVATE_KEY_PATH = Path(os.environ.get("NEXUS_BACKUP_ENVELOPE_PRIVATE_KEY_PATH", _ROOT / "data" / "backup-envelope" / "private.pem"))
PUBLIC_KEY_PATH = Path(os.environ.get("NEXUS_BACKUP_ENVELOPE_PUBLIC_KEY_PATH", _ROOT / "data" / "backup-envelope" / "public.pem"))


def _write_private(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(payload)
    try:
        os.chmod(temporary, 0o600)
    except OSError:
        pass
    temporary.replace(path)


def _key_pair() -> tuple[rsa.RSAPrivateKey, bytes]:
    if PRIVATE_KEY_PATH.exists() and PUBLIC_KEY_PATH.exists():
        private = serialization.load_pem_private_key(PRIVATE_KEY_PATH.read_bytes(), password=None)
        return private, PUBLIC_KEY_PATH.read_bytes()
    if is_production():
        raise RuntimeError("NEXUS_BACKUP_ENVELOPE_PRIVATE_KEY_PATH and NEXUS_BACKUP_ENVELOPE_PUBLIC_KEY_PATH are required in production")
    private = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    public = private.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    _write_private(private_path := PRIVATE_KEY_PATH, private.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    PUBLIC_KEY_PATH.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC_KEY_PATH.write_bytes(public)
    return private, public


def public_material() -> dict[str, str]:
    _, public = _key_pair()
    return {
        "algorithm": "rsa-oaep-sha256",
        "key_id": hashlib.sha256(public).hexdigest()[:24],
        "public_key_pem": public.decode("ascii"),
    }


def unwrap_data_key(*, wrapped_key_b64: str, key_id: str) -> bytes:
    private, public = _key_pair()
    expected = hashlib.sha256(public).hexdigest()[:24]
    if key_id != expected:
        raise ValueError("Backup envelope key ID is not current")
    try:
        wrapped = base64.b64decode(wrapped_key_b64, validate=True)
        return private.decrypt(wrapped, padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
    except Exception as exc:
        raise ValueError("Backup data-key envelope cannot be unwrapped") from exc
