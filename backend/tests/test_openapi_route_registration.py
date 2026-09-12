"""Regression coverage for deterministic router auto-discovery.

FastAPI otherwise accepts duplicate method/path registrations and serves the
first one it sees.  Nexus auto-discovers a large router catalogue, so make the
single-owner rule explicit at the application boundary.
"""

from collections import Counter
import warnings

from fastapi import APIRouter
from fastapi.routing import APIRoute
import pytest

import server


def _http_operation_keys():
    return [
        (route.path_format, method)
        for route in server.app.routes
        if isinstance(route, APIRoute)
        for method in (route.methods or set())
    ]


def test_auto_discovered_http_operations_have_one_owner():
    operation_keys = _http_operation_keys()
    duplicates = [
        key
        for key, count in Counter(operation_keys).items()
        if count > 1
    ]

    assert duplicates == []


def test_documented_legacy_route_owners_match_live_handlers():
    route_owners = {
        (server._canonical_http_path(route.path_format), method): route.endpoint.__module__.rsplit(".", 1)[-1]
        for route in server.app.routes
        if isinstance(route, APIRoute)
        for method in (route.methods or set())
    }

    for operation_key, expected_owner in server._LEGACY_HTTP_OPERATION_OWNERS.items():
        assert route_owners[operation_key] == expected_owner


def test_undeclared_route_collision_fails_instead_of_changing_precedence():
    duplicate_router = APIRouter()

    @duplicate_router.get("/registration-collision-test")
    async def duplicate_handler():
        return {"ok": True}

    with pytest.raises(RuntimeError, match="duplicates HTTP operation"):
        server._include_router_without_shadowed_operations(
            "test_duplicate",
            duplicate_router,
            prefix="/api",
            operation_owners={
                ("/api/registration-collision-test", "GET"): "test_existing",
            },
        )


def test_openapi_generation_has_unique_operation_ids_without_warnings():
    original_schema = server.app.openapi_schema
    server.app.openapi_schema = None
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", UserWarning)
            schema = server.app.openapi()
    finally:
        server.app.openapi_schema = original_schema

    operation_ids = [
        operation["operationId"]
        for path_item in schema["paths"].values()
        for operation in path_item.values()
        if isinstance(operation, dict) and operation.get("operationId")
    ]
    duplicates = [
        operation_id
        for operation_id, count in Counter(operation_ids).items()
        if count > 1
    ]

    assert duplicates == []
