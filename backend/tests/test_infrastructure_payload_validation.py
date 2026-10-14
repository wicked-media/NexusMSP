"""Infrastructure create endpoints must reject malformed payloads with 422.

Regression guard: constructing DomainEntry/SSLCertificate from unvalidated dict
payloads used to raise out of the handler, surfacing as a 500 instead of a
client-correct 422.
"""

import asyncio

import pytest
from fastapi import HTTPException

from app.routers import infrastructure


class _StubUser(dict):
    pass


def _admin() -> dict:
    return {"id": "u-test", "name": "Test Admin", "role": "admin", "tenant_id": "t1"}


class TestMalformedPayloads:
    def test_ssl_certificate_missing_required_field_is_422(self):
        async def run():
            return await infrastructure.create_ssl_certificate({"status": "valid"}, _admin())
        with pytest.raises(HTTPException) as exc:
            asyncio.run(run())
        assert exc.value.status_code == 422
        assert "certificate payload" in exc.value.detail

    def test_domain_missing_required_field_is_422(self):
        async def run():
            return await infrastructure.create_domain({"registrar": "example"}, _admin())
        with pytest.raises(HTTPException) as exc:
            asyncio.run(run())
        assert exc.value.status_code == 422
        assert "domain payload" in exc.value.detail
