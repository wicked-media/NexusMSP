"""Safe credential access for integration tests.

Never add passwords or API keys to test source. Configure these only in the
environment that runs the integration suite:

  NEXUS_TEST_ADMIN_EMAIL
  NEXUS_TEST_ADMIN_PASSWORD
"""
import os

import pytest


def admin_credentials() -> dict[str, str]:
    email = (os.getenv("NEXUS_TEST_ADMIN_EMAIL") or "").strip()
    password = os.getenv("NEXUS_TEST_ADMIN_PASSWORD") or ""
    if not email or not password:
        pytest.skip(
            "Set NEXUS_TEST_ADMIN_EMAIL and NEXUS_TEST_ADMIN_PASSWORD to run authenticated integration tests."
        )
    return {"email": email, "password": password}
