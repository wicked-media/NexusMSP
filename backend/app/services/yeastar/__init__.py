"""Yeastar voice integration: transport, capability catalogue and failures.

Import from here rather than from the submodules so the public surface stays
one deliberate list.
"""
from app.services.yeastar.client import (
    aclose_pools,
    api_call,
    caller_may_use_legacy_settings,
    dispatch_operation,
    fetch_bytes,
    get_token,
    has_credentials,
    invalidate_token,
    normalise_pbx_url,
    pbx_base_url,
    pbx_client_id,
    resolve_pbx,
    resolve_pbx_optional,
    revoke_token,
    verify_tls_for,
)
from app.services.yeastar.errors import YeastarError, http_status_for, provider_error
from app.services.yeastar.registry import (
    OPERATIONS,
    OPERATION_BY_ID,
    REQUIRED_ACTIONS,
    Operation,
    catalogue,
    dispatcher_operations,
    get_operation,
)
from app.services.yeastar.ycm import (
    DEFAULT_BASE_URL,
    get_ycm_token,
    invalidate_ycm_token,
    normalise_ycm_url,
    safe_ycm_settings,
    ycm_api_get,
    ycm_items,
)

__all__ = [
    "DEFAULT_BASE_URL",
    "OPERATIONS",
    "OPERATION_BY_ID",
    "REQUIRED_ACTIONS",
    "Operation",
    "YeastarError",
    "aclose_pools",
    "api_call",
    "caller_may_use_legacy_settings",
    "catalogue",
    "dispatch_operation",
    "dispatcher_operations",
    "fetch_bytes",
    "get_operation",
    "get_token",
    "get_ycm_token",
    "has_credentials",
    "http_status_for",
    "invalidate_token",
    "invalidate_ycm_token",
    "normalise_pbx_url",
    "normalise_ycm_url",
    "pbx_base_url",
    "pbx_client_id",
    "provider_error",
    "resolve_pbx",
    "resolve_pbx_optional",
    "revoke_token",
    "safe_ycm_settings",
    "verify_tls_for",
    "ycm_api_get",
    "ycm_items",
]
