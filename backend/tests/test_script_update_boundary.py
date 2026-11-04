"""Script update payloads cannot overwrite server-owned fields.

Regression guard: update_script previously forwarded the raw payload to a
MongoDB $set, letting a caller rewrite identity and provenance fields (id,
is_built_in, created_by, run counters). Updates are now restricted to the
technician-editable field set and validated.
"""

import asyncio

import pytest
from fastapi import HTTPException

from app.routers import scripting


def _user() -> dict:
    return {"id": "u-test", "name": "Test Admin", "role": "admin", "tenant_id": "t1"}


class TestScriptUpdateBoundary:
    def test_editable_fields_match_the_create_contract_plus_library_provenance(self):
        # Library provenance is editable because the pack install/uninstall
        # flows in the scripting workspace maintain it through this endpoint.
        create_fields = {"name", "description", "script_type", "content", "category", "os_target", "run_as_admin", "timeout_seconds", "parameters"}
        assert scripting.SCRIPT_EDITABLE_FIELDS == create_fields | {"library_pack_ids", "library_template_name"}

    def test_server_owned_fields_are_not_editable(self):
        for field in ("id", "is_built_in", "created_by", "created_by_name", "run_count", "last_run", "created_at", "updated_at"):
            assert field not in scripting.SCRIPT_EDITABLE_FIELDS

    def test_update_model_is_closed(self):
        with pytest.raises(Exception):
            scripting.ScriptUpdate(name="x", is_built_in=True)

    def test_empty_payload_is_rejected(self):
        async def run():
            return await scripting.update_script("s1", scripting.ScriptUpdate(), _user())
        with pytest.raises(HTTPException) as exc:
            asyncio.run(run())
        assert exc.value.status_code == 422

    def test_empty_name_is_rejected(self):
        async def run():
            return await scripting.update_script("s1", scripting.ScriptUpdate(name="   "), _user())
        with pytest.raises(HTTPException) as exc:
            asyncio.run(run())
        assert exc.value.status_code == 422
