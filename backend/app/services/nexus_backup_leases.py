"""Dedicated signed capture-lease envelopes for the future Backup worker.

This module deliberately creates short-lived authorisations only. It has no
storage upload, source-path, encryption-key or customer-payload capability.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from app.services.agent_trust import sign_agent_command_payload


def issue_capture_lease(*, tenant_id: str, client_id: str, device_id: str, job_id: str, capture_id: str, source_profile: str) -> dict[str, Any]:
    issued = datetime.now(timezone.utc)
    expires = issued + timedelta(minutes=10)
    envelope = {
        "schema_version": 1, "lease_id": f"nbl-{uuid.uuid4().hex}", "tenant_id": tenant_id,
        "client_id": client_id, "device_id": device_id, "job_id": job_id, "capture_id": capture_id,
        "source_profile": source_profile, "issued_at": issued.isoformat(), "expires_at": expires.isoformat(),
        "nonce": uuid.uuid4().hex,
    }
    signed_payload = "|".join(str(envelope[key]) for key in ("schema_version", "lease_id", "tenant_id", "client_id", "device_id", "job_id", "capture_id", "source_profile", "issued_at", "expires_at", "nonce"))
    return {**envelope, **sign_agent_command_payload(signed_payload)}
