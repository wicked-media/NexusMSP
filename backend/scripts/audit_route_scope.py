"""Inventory FastAPI routes with their authentication and tenant-scope markers.

Evidence generator for docs/PILOT_ROUTE_SCOPE_MATRIX.md. Run from backend/:

    ../.venv/bin/python scripts/audit_route_scope.py

Prints a markdown inventory: one row per route with the auth dependency and the
tenant-scope markers found in its handler source, plus a "manual review" list of
routes that expose no authentication marker. Markers are indicative evidence
only - scope correctness is asserted by the focused tests named in the matrix.
"""

import inspect
import sys
from pathlib import Path

# Make the backend root importable when this script runs from scripts/.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

SCOPE_MARKERS = (
    "tenant_scoped_query",
    "platform_tenant_id",
    "client_scope",
    "tenant_scope",
    "record_scope",
    "object_scope",
    "require_module_permission",
    "require_action",
    "scoped_",
)

AUTH_MARKERS = (
    "get_current_user",
    "require_module_permission",
    "require_action",
    "require_agent_admin",
    "require_agent_operator",
)

# Infrastructure routes that are intentionally unauthenticated.
PUBLIC_PATHS = ("/health", "/healthz", "/readyz", "/openapi.json", "/docs", "/redoc")


def _handler_source(endpoint):
    try:
        return inspect.getsource(endpoint)
    except (OSError, TypeError):
        return ""


def collect_routes():
    import server  # noqa: E402  (path set up above)

    rows = []
    for route in server.app.routes:
        methods = sorted(getattr(route, "methods", None) or [])
        endpoint = getattr(route, "endpoint", None)
        if endpoint is None or not methods:
            continue
        path = getattr(route, "path", "")
        if path in PUBLIC_PATHS or path.startswith("/docs") or path.startswith("/redoc"):
            continue
        source = _handler_source(endpoint)
        auth = sorted({m for m in AUTH_MARKERS if m in source})
        scope = sorted({m for m in SCOPE_MARKERS if m in source})
        rows.append({
            "module": getattr(endpoint, "__module__", "?"),
            "handler": getattr(endpoint, "__name__", "?"),
            "path": path,
            "methods": ",".join(m for m in methods if m != "HEAD"),
            "auth": auth,
            "scope": scope,
        })
    return rows


def main():
    rows = collect_routes()
    by_module = {}
    for row in rows:
        by_module.setdefault(row["module"], []).append(row)

    needs_review = [r for r in rows if not r["auth"]]
    scope_marked = [r for r in rows if r["scope"]]

    print("# Route scope inventory")
    print()
    print(f"Routes: {len(rows)} · with auth marker: {len(rows) - len(needs_review)} "
          f"· with tenant-scope marker: {len(scope_marked)} · manual review (no auth marker): {len(needs_review)}")
    print()
    for module in sorted(by_module):
        print(f"## {module}")
        print()
        print("| Methods | Path | Handler | Auth | Scope markers |")
        print("|---|---|---|---|---|")
        for row in sorted(by_module[module], key=lambda r: r["path"]):
            print(f"| {row['methods']} | `{row['path']}` | `{row['handler']}` "
                  f"| {', '.join(row['auth']) or '—'} | {', '.join(row['scope']) or '—'} |")
        print()

    print("## Manual review required (no auth marker in handler source)")
    print()
    for row in sorted(needs_review, key=lambda r: (r["module"], r["path"])):
        print(f"- `{row['methods']} {row['path']}` (`{row['module']}.{row['handler']}`)")
    if not needs_review:
        print("(none)")


if __name__ == "__main__":
    main()
