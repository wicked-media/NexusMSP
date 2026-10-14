"""Deployment-owned public URL helpers.

Redirect and callback URLs are security boundaries.  They must come from
deployment configuration, never from a browser request that happens to be
made by an otherwise authorised actor.
"""

from __future__ import annotations

import os
from urllib.parse import urlparse


def configured_public_base_url() -> str:
    """Return the configured public browser origin, rejecting unsafe values."""
    base_url = (
        os.environ.get("PUBLIC_URL")
        or os.environ.get("FRONTEND_URL")
        or "http://localhost:3000"
    ).strip().rstrip("/")
    parsed = urlparse(base_url)
    local_hosts = {"localhost", "127.0.0.1", "::1"}
    if (
        parsed.username
        or parsed.password
        or not parsed.hostname
        or (parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in local_hosts))
    ):
        raise RuntimeError("PUBLIC_URL/FRONTEND_URL must be HTTPS (or local HTTP) without credentials")
    return base_url
