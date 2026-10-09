"""Safe access to Microsoft 365 application-client credentials.

The mailbox feature predates the encrypted integration vault.  Keep existing
installations working by migrating the legacy plaintext field only when a
trusted server process needs to use it; browser responses never receive either
representation.
"""

from __future__ import annotations

from typing import Any

from app.services.secret_store import decrypt_secret, encrypt_secret


def has_microsoft365_client_secret(settings: dict[str, Any] | None) -> bool:
    """Return whether a mailbox record contains a credential without exposing it."""
    settings = settings or {}
    return bool(settings.get("client_secret_encrypted") or settings.get("client_secret"))


async def load_microsoft365_client_secret(
    settings: dict[str, Any] | None,
    *,
    collection: Any,
    query: dict[str, Any],
) -> str:
    """Read an encrypted client secret and lazily migrate a legacy plaintext one.

    A non-empty encrypted value is authoritative.  If it cannot be decrypted,
    fail closed rather than falling back to a possibly stale plaintext sibling.
    This prevents an invalid encrypted token from quietly reviving an old
    credential after a secret rotation.
    """
    settings = settings or {}
    encrypted = str(settings.get("client_secret_encrypted") or "").strip()
    if encrypted:
        return decrypt_secret(encrypted)

    legacy = str(settings.get("client_secret") or "").strip()
    if not legacy:
        return ""

    encrypted = encrypt_secret(legacy)
    await collection.update_one(
        query,
        {"$set": {"client_secret_encrypted": encrypted}, "$unset": {"client_secret": ""}},
    )
    # Keep the in-memory copy usable by this request, without reintroducing a
    # plaintext field into a subsequent persistence operation.
    settings["client_secret_encrypted"] = encrypted
    settings.pop("client_secret", None)
    return legacy
