"""Validation and public projection for encrypted Native Backup captures.

Records are metadata only. Payload bytes belong solely in an approved
immutable destination; plaintext keys, source paths and object URLs are never
accepted into a capture record.
"""

from __future__ import annotations

import re
from typing import Any


_SHA256 = re.compile(r"^[a-f0-9]{64}$")
_ID = re.compile(r"^[A-Za-z0-9_-]{1,200}$")
MAX_CHUNKS = 250_000


def validate_capture_record(value: dict[str, Any]) -> dict[str, Any]:
    if int(value.get("schema_version") or 0) != 1:
        raise ValueError("Unsupported capture record schema")
    for field in ("tenant_id", "client_id", "device_id", "job_id", "capture_id", "envelope_key_id", "wrapped_data_key"):
        if not isinstance(value.get(field), str) or not value[field].strip():
            raise ValueError(f"Capture record {field} is required")
    if not all(_ID.fullmatch(str(value[field])) for field in ("tenant_id", "client_id", "device_id", "job_id", "capture_id", "envelope_key_id")):
        raise ValueError("Capture record has an invalid stable identifier")
    wrapped = str(value["wrapped_data_key"])
    if len(wrapped) > 8192 or any(token in value for token in ("source_path", "file_path", "vault_url", "plaintext", "data_key")):
        raise ValueError("Capture record contains prohibited sensitive material")
    chunks = value.get("chunks")
    if not isinstance(chunks, list) or len(chunks) > MAX_CHUNKS:
        raise ValueError("Capture record has an invalid chunk list")
    observed = set()
    normalised = []
    for chunk in chunks:
        if not isinstance(chunk, dict):
            raise ValueError("Capture chunk is invalid")
        ordinal = chunk.get("ordinal")
        if not isinstance(ordinal, int) or ordinal < 0 or ordinal in observed:
            raise ValueError("Capture chunk ordinal is invalid")
        observed.add(ordinal)
        plain_bytes, cipher_bytes = chunk.get("plaintext_bytes"), chunk.get("ciphertext_bytes")
        if not isinstance(plain_bytes, int) or not isinstance(cipher_bytes, int) or plain_bytes < 0 or cipher_bytes <= plain_bytes:
            raise ValueError("Capture chunk sizes are invalid")
        plain_hash, cipher_hash = str(chunk.get("plaintext_sha256") or ""), str(chunk.get("ciphertext_sha256") or "")
        if not _SHA256.fullmatch(plain_hash) or not _SHA256.fullmatch(cipher_hash):
            raise ValueError("Capture chunk integrity metadata is invalid")
        normalised.append({"ordinal": ordinal, "plaintext_bytes": plain_bytes, "ciphertext_bytes": cipher_bytes, "plaintext_sha256": plain_hash, "ciphertext_sha256": cipher_hash, "nonce_b64": str(chunk.get("nonce_b64") or "")[:256]})
    return {**{field: value[field] for field in ("schema_version", "tenant_id", "client_id", "device_id", "job_id", "capture_id", "envelope_key_id", "wrapped_data_key")}, "chunks": normalised}


def public_capture_record(value: dict[str, Any]) -> dict[str, Any]:
    chunks = value.get("chunks") if isinstance(value.get("chunks"), list) else []
    return {
        "id": value.get("id"), "tenant_id": value.get("tenant_id"), "client_id": value.get("client_id"),
        "device_id": value.get("device_id"), "job_id": value.get("job_id"), "capture_id": value.get("capture_id"),
        "state": value.get("state", "registered"), "chunk_count": len(chunks),
        "ciphertext_bytes": sum(int(chunk.get("ciphertext_bytes") or 0) for chunk in chunks if isinstance(chunk, dict)),
        "envelope_key_id": value.get("envelope_key_id"), "created_at": value.get("created_at"),
        "proof_state": "not_proven", "execution_allowed": False,
    }
