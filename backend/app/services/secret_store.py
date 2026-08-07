"""Encryption helpers for application-managed integration credentials.

Secrets are encrypted before they are written to MongoDB.  The encryption key
is derived from a dedicated deployment secret when available and falls back to
the server JWT secret so existing installations can adopt the vault without a
second bootstrap step.
"""

from __future__ import annotations

import base64
import hashlib
import os

from cryptography.fernet import Fernet, InvalidToken

from app.database import JWT_SECRET
from app.services.runtime_config import is_production


def _cipher() -> Fernet:
    material = os.environ.get("NEXUS_SECRET_ENCRYPTION_KEY")
    if not material and is_production():
        raise RuntimeError("NEXUS_SECRET_ENCRYPTION_KEY is required in production")
    material = material or JWT_SECRET
    key = base64.urlsafe_b64encode(hashlib.sha256(material.encode("utf-8")).digest())
    return Fernet(key)


def encrypt_secret(value: str) -> str:
    secret = str(value or "")
    if not secret:
        return ""
    return _cipher().encrypt(secret.encode("utf-8")).decode("utf-8")


def decrypt_secret(value: str) -> str:
    token = str(value or "")
    if not token:
        return ""
    try:
        return _cipher().decrypt(token.encode("utf-8")).decode("utf-8")
    except (InvalidToken, ValueError, TypeError):
        return ""


def mask_secret(value: str) -> str:
    """Return a useful fingerprint without exposing the credential."""
    secret = str(value or "").strip()
    if not secret:
        return ""
    prefix = secret[:7] if len(secret) > 11 else secret[:3]
    suffix = secret[-4:] if len(secret) > 7 else ""
    return f"{prefix}…{suffix}"
