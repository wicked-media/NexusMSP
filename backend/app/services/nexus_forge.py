"""Nexus Forge — governed tool *designs*, grounded in what Nexus already serves.

Forge is not a code generator and it is not an automation builder. A technician
describes a capability Nexus is missing; Forge turns that into a **tool
specification** that composes capabilities the platform already exposes, and then
holds it behind a checklist, a security review and retained version history.

The distinction that makes this defensible rather than magical:

* Forge never invents an unrelated application. It resolves every capability the
  request declares against the routes the running Nexus API actually serves, and
  it says plainly which declarations it could not resolve.
* Forge requests a design; it never produces or deploys executable code, and a
  request that asks for unrestricted credentials or privileged execution is
  refused rather than negotiated.
* Nothing is published because a verdict passed. A person approves, and only then
  can a version be recorded — an approved version is a governance record, not a
  deployment.

Everything here is pure and deterministic so every check can be tested directly.
The route catalogue is passed in, so the policy never reaches into the app object
itself; database access lives in `app/routers/nexus_forge.py`.
"""

from __future__ import annotations

import re
from typing import Any, Iterable, Sequence

from app.services.nexus_flow import contains_credential_material

# ── Vocabulary ───────────────────────────────────────────────────────────────

# What a Forge tool is allowed to become. The form is constrained because every
# form here is composed from surfaces Nexus already governs.
FORGE_TOOL_KINDS: tuple[str, ...] = ("panel", "dashboard", "diagnostic_command", "workflow")

TOOL_KIND_MEANING: dict[str, str] = {
    "panel": "A contextual surface inside an existing workspace, scoped to the record it was opened from.",
    "dashboard": "A read-only aggregate view across a scope the caller is already authorised for.",
    "diagnostic_command": "A read-only investigation that gathers evidence and returns it for a person to judge.",
    "workflow": "A staged, approval-gated sequence that reuses an existing workflow runner.",
}

# Lifecycle. ``changes_requested`` and ``rejected`` are terminal for a version but
# retained forever, because a refusal is product evidence too.
FORGE_STAGES: tuple[str, ...] = (
    "specified",
    "changes_requested",
    "rejected",
    "approved",
    "published",
)

CHECK_STATUSES: tuple[str, ...] = ("pass", "needs_review", "fail")

# HTTP methods that can change state. The catalogue carries them, so the policy
# can tell a read-only composition from a mutating one without guessing.
MUTATING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})

# A composition wider than this is not one tool.
MAX_COMPOSED_CAPABILITIES = 25
MIN_SANDBOX_PLAN = 20
MIN_SPEC_TEXT = 12
MIN_TEST_TEXT = 10
MAX_REVIEW_INTERVAL_DAYS = 365
MAX_CAPABILITY_REF = 120

# A request that asks Nexus to hold or bypass privilege is refused, not softened.
# The needles are deliberately narrow: each one is unambiguous on its own.
PRIVILEGED_REQUEST_PATTERNS: tuple[str, ...] = (
    "production credentials",
    "service-role key",
    "service role key",
    "service account password",
    "domain admin",
    "run as system",
    "unrestricted",
    "bypass approval",
    "bypass authentication",
    "skip the security review",
    "skip review",
    "disable auditing",
    "write directly to the database",
    "credential material",
)

_VERSION_PATTERN = re.compile(r"^\d+\.\d+(\.\d+)?$")


# ── Capability catalogue ─────────────────────────────────────────────────────


def _normalise_path(value: Any) -> str:
    path = str(value or "").strip()
    if not path:
        return ""
    if len(path) > 1:
        path = path.rstrip("/")
    return path.lower()


def capability_id(path: str) -> str:
    """The stable identity of a Nexus capability is the route it is served on."""
    return _normalise_path(path)


def build_catalogue(routes: Iterable[tuple[str, Sequence[str]]]) -> list[dict[str, Any]]:
    """Turn the served routes into the catalogue Forge composes from.

    ``routes`` is ``(path, methods)`` pairs, so this stays testable without an app.
    Only ``/api`` capabilities are offered: internal metrics and probe endpoints
    are not composable surfaces.
    """
    catalogue: dict[str, dict[str, Any]] = {}
    for path, methods in routes:
        identifier = capability_id(path)
        if not identifier.startswith("/api"):
            continue
        segments = [segment for segment in identifier.split("/") if segment]
        category = segments[1] if len(segments) > 1 else "root"
        entry = catalogue.setdefault(
            identifier,
            {"id": identifier, "category": category, "methods": set()},
        )
        for method in methods or ():
            entry["methods"].add(str(method).upper())
    rows = [
        {
            "id": entry["id"],
            "category": entry["category"],
            "methods": sorted(entry["methods"]),
            "mutating": bool(entry["methods"] & MUTATING_METHODS),
        }
        for entry in catalogue.values()
    ]
    rows.sort(key=lambda item: item["id"])
    return rows


def filter_catalogue(
    catalogue: Iterable[dict[str, Any]],
    *,
    query: str | None = None,
    category: str | None = None,
    limit: int = 60,
) -> dict[str, Any]:
    """Server-side search over the catalogue so the browser never downloads all of it."""
    needle = str(query or "").strip().lower()
    wanted = str(category or "").strip().lower()
    rows = [row for row in catalogue if isinstance(row, dict)]
    total = len(rows)
    categories: dict[str, int] = {}
    for row in rows:
        key = str(row.get("category") or "root")
        categories[key] = categories.get(key, 0) + 1
    if wanted:
        rows = [row for row in rows if str(row.get("category") or "") == wanted]
    if needle:
        rows = [row for row in rows if needle in str(row.get("id") or "")]
    capped = max(1, min(int(limit or 60), 200))
    return {
        "capabilities": rows[:capped],
        "matched": len(rows),
        "total": total,
        "categories": sorted(
            ({"id": key, "count": count} for key, count in categories.items()),
            key=lambda item: (-item["count"], item["id"]),
        ),
        "truncated": len(rows) > capped,
    }


# ── Specification checks ─────────────────────────────────────────────────────


def _check(identifier: str, label: str, status: str, detail: str) -> dict[str, Any]:
    return {"id": identifier, "label": label, "status": status, "detail": detail}


def _resolve_capabilities(
    refs: Sequence[str],
    catalogue: dict[str, dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[str]]:
    known: list[dict[str, Any]] = []
    unknown: list[str] = []
    for ref in refs:
        identifier = capability_id(ref)
        if not identifier:
            continue
        entry = catalogue.get(identifier)
        if entry:
            if not any(row["id"] == identifier for row in known):
                known.append(entry)
        elif ref not in unknown:
            unknown.append(str(ref).strip())
    return known, unknown


def forge_spec_checks(
    spec: dict[str, Any],
    *,
    catalogue: Iterable[dict[str, Any]],
    published_tools: Iterable[dict[str, Any]] = (),
) -> dict[str, Any]:
    """Run every gate against one design request and disclose each result.

    The verdict is never a score. Each check reports ``pass``, ``needs_review`` or
    ``fail`` with the reason a reviewer can argue with.
    """
    rows = {row["id"]: row for row in catalogue if isinstance(row, dict) and row.get("id")}
    refs = [str(ref or "").strip() for ref in (spec.get("capability_refs") or []) if str(ref or "").strip()]
    scope = spec.get("scope") if isinstance(spec.get("scope"), dict) else {}
    permissions = [str(item or "").strip() for item in (scope.get("permissions") or []) if str(item or "").strip()]
    data_classes = [str(item or "").strip() for item in (scope.get("data_classes") or []) if str(item or "").strip()]
    writes = [str(spec.get(key) or "") for key in ("title", "intent", "sandbox_plan", "rollback", "verification", "expected_outcome")]

    checks: list[dict[str, Any]] = []

    # 1. Forge designs a tool. A request that asks for privilege is refused here.
    request_text = " ".join(writes).lower()
    privileged = [needle for needle in PRIVILEGED_REQUEST_PATTERNS if needle in request_text]
    if contains_credential_material(" ".join(writes)):
        checks.append(
            _check(
                "no_credential_material",
                "No credential material",
                "fail",
                "The request contains something shaped like credential material. Forge stores references only.",
            )
        )
    elif privileged:
        checks.append(
            _check(
                "no_privileged_delivery",
                "No privileged delivery",
                "fail",
                f'The request asks for privileged or unrestricted delivery ({", ".join(privileged[:3])}). '
                "Forge composes authorised capabilities and cannot grant privilege a person does not hold.",
            )
        )
    else:
        checks.append(
            _check(
                "no_privileged_delivery",
                "No privileged delivery",
                "pass",
                "The request composes capabilities; it does not ask for unrestricted or credential-bearing execution.",
            )
        )

    # 2. Every declared capability must exist on the running API.
    known, unknown = _resolve_capabilities(refs, rows)
    if not refs:
        checks.append(
            _check(
                "grounded_capabilities",
                "Grounded in served capabilities",
                "fail",
                "Declare at least one Nexus capability. Forge composes what Nexus already serves instead of inventing a system.",
            )
        )
    elif unknown:
        checks.append(
            _check(
                "grounded_capabilities",
                "Grounded in served capabilities",
                "needs_review",
                f"{len(unknown)} declared capability was not found on this API ({', '.join(unknown[:3])}). "
                "An unresolvable capability needs engineering before it can be designed against.",
            )
        )
    else:
        checks.append(
            _check(
                "grounded_capabilities",
                "Grounded in served capabilities",
                "pass",
                f"All {len(known)} declared capabilities are served by this API.",
            )
        )

    # 3. Tenant scope is not optional.
    if bool(scope.get("tenant_enforced")) is True:
        scope_status = _check(
            "tenant_scope",
            "Server-side tenant scope",
            "pass",
            "The design states that every read and write is scoped server-side.",
        )
    else:
        scope_status = _check(
            "tenant_scope",
            "Server-side tenant scope",
            "fail",
            "The design must state that scope is enforced server-side. Frontend filtering is not a security control.",
        )
    checks.append(scope_status)

    # 4. Permissions must be named, and a wildcard is never a permission.
    wildcard = [item for item in permissions if item.strip() in {"*", "all", "any", "admin:*"}]
    if not permissions:
        checks.append(
            _check(
                "permissions_declared",
                "Permissions declared",
                "fail",
                "Name the permissions the tool needs. An undeclared requirement cannot be reviewed.",
            )
        )
    elif wildcard:
        checks.append(
            _check(
                "permissions_declared",
                "Permissions declared",
                "fail",
                f'An unrestricted permission was declared ({", ".join(wildcard[:3])}). Forge tools hold named capabilities only.',
            )
        )
    else:
        checks.append(
            _check(
                "permissions_declared",
                "Permissions declared",
                "pass",
                f"{len(permissions)} named permission(s) declared.",
            )
        )

    # 5. Data classes must be named too, and secrets are not a data class.
    secret_classes = [item for item in data_classes if "credential" in item.lower() or "secret" in item.lower()]
    if not data_classes:
        checks.append(
            _check(
                "data_classes_declared",
                "Data classes declared",
                "fail",
                "Declare which data classes the tool reads so a reviewer can judge the exposure.",
            )
        )
    elif secret_classes:
        checks.append(
            _check(
                "data_classes_declared",
                "Data classes declared",
                "fail",
                f'A credential-shaped data class was declared ({", ".join(secret_classes[:3])}). '
                "Forge tools read records, never secrets.",
            )
        )
    else:
        checks.append(
            _check(
                "data_classes_declared",
                "Data classes declared",
                "pass",
                f"{len(data_classes)} data class(es) declared.",
            )
        )

    # 6. Where it is proven before anyone depends on it.
    sandbox = str(spec.get("sandbox_plan") or "").strip()
    checks.append(
        _check(
            "sandbox_plan",
            "Sandbox plan",
            "pass" if len(sandbox) >= MIN_SANDBOX_PLAN else "fail",
            f"The plan describes where the tool is proven before use ({len(sandbox)} characters)."
            if len(sandbox) >= MIN_SANDBOX_PLAN
            else f"A sandbox plan of at least {MIN_SANDBOX_PLAN} characters is required, not a production trial.",
        )
    )

    # 7. A tool without tests cannot be regression-checked when Nexus changes.
    tests = [str(item or "").strip() for item in (spec.get("tests") or []) if str(item or "").strip()]
    usable_tests = [item for item in tests if len(item) >= MIN_TEST_TEXT]
    checks.append(
        _check(
            "tests_declared",
            "Verification tests",
            "pass" if usable_tests else "fail",
            f"{len(usable_tests)} verification test(s) declared."
            if usable_tests
            else f"Declare at least one test of at least {MIN_TEST_TEXT} characters; 'it works' is not a test.",
        )
    )

    # 8. Rollback, stated before the tool exists.
    rollback = str(spec.get("rollback") or "").strip()
    checks.append(
        _check(
            "rollback_declared",
            "Rollback declared",
            "pass" if len(rollback) >= MIN_SPEC_TEXT else "fail",
            "Rollback is stated." if len(rollback) >= MIN_SPEC_TEXT else "State how a published version is withdrawn.",
        )
    )

    # 9. Every published tool is re-reviewed. Nothing runs forever unreviewed.
    interval = spec.get("review_interval_days")
    try:
        interval_value = int(interval)
    except (TypeError, ValueError):
        interval_value = 0
    checks.append(
        _check(
            "review_interval",
            "Re-review interval",
            "pass" if 1 <= interval_value <= MAX_REVIEW_INTERVAL_DAYS else "fail",
            f"Re-reviewed every {interval_value} day(s)."
            if 1 <= interval_value <= MAX_REVIEW_INTERVAL_DAYS
            else f"A re-review interval between 1 and {MAX_REVIEW_INTERVAL_DAYS} days is required.",
        )
    )

    # 10. A composition that can change state needs stated verification.
    mutating = [row["id"] for row in known if row.get("mutating")]
    verification = str(spec.get("verification") or "").strip()
    if not mutating:
        checks.append(
            _check(
                "write_verification",
                "Verification for state-changing steps",
                "pass",
                "The composition is read-only, so there is no state change to verify.",
            )
        )
    elif len(verification) >= MIN_SPEC_TEXT:
        checks.append(
            _check(
                "write_verification",
                "Verification for state-changing steps",
                "pass",
                f"Verification is stated for {len(mutating)} state-changing capability(ies).",
            )
        )
    else:
        checks.append(
            _check(
                "write_verification",
                "Verification for state-changing steps",
                "needs_review",
                f'The composition reaches {len(mutating)} state-changing capability(ies) ({", ".join(mutating[:3])}) '
                "but does not state how the outcome is verified.",
            )
        )

    # 11. Do not build what a published tool already does.
    overlaps: list[str] = []
    for tool in published_tools or []:
        if not isinstance(tool, dict):
            continue
        covered = {capability_id(item) for item in (tool.get("capabilities") or [])}
        shared = sorted(covered & {row["id"] for row in known})
        if shared:
            overlaps.append(f"{tool.get('name') or tool.get('id')} already composes {', '.join(shared[:2])}")
    if overlaps:
        checks.append(
            _check(
                "duplicate_tool",
                "Not a duplicate",
                "needs_review",
                f"{len(overlaps)} published tool(s) overlap this design: {'; '.join(overlaps[:2])}. "
                "Consider extending the existing tool instead of publishing a second one.",
            )
        )
    else:
        checks.append(
            _check(
                "duplicate_tool",
                "Not a duplicate",
                "pass",
                "No published Forge tool composes these capabilities yet.",
            )
        )

    # 12. Blast radius. One tool, one job.
    if len(known) > MAX_COMPOSED_CAPABILITIES:
        checks.append(
            _check(
                "blast_radius",
                "Blast radius",
                "needs_review",
                f"This design composes {len(known)} capabilities. Split it so each tool can be reviewed on its own.",
            )
        )
    else:
        checks.append(
            _check(
                "blast_radius",
                "Blast radius",
                "pass",
                f"{len(known)} of {MAX_COMPOSED_CAPABILITIES} permitted capabilities composed.",
            )
        )

    return {
        "checks": checks,
        "verdict": forge_verdict(checks),
        "capabilities": known,
        "unresolved_capabilities": unknown,
    }


def forge_verdict(checks: Iterable[dict[str, Any]]) -> str:
    """``fail`` beats ``needs_review`` beats ``pass`` — the worst result wins."""
    statuses = {str(check.get("status") or "") for check in checks}
    if "fail" in statuses:
        return "fail"
    if "needs_review" in statuses:
        return "needs_review"
    return "pass"


def verdict_reason(verdict: str, checks: Iterable[dict[str, Any]]) -> str:
    blocking = [check for check in checks if check.get("status") == "fail"]
    flagged = [check for check in checks if check.get("status") == "needs_review"]
    if verdict == "fail":
        return (
            f"{len(blocking)} check(s) failed: {', '.join(str(check.get('label')) for check in blocking[:3])}. "
            "Fix the specification before it can be reviewed."
        )
    if verdict == "needs_review":
        return (
            f"{len(flagged)} check(s) need a human decision: {', '.join(str(check.get('label')) for check in flagged[:3])}. "
            "Nothing is blocking, but a person has to accept these knowingly."
        )
    return "Every check passed. A person still approves before any version is recorded."


# ── Version governance ───────────────────────────────────────────────────────


def version_is_valid(value: Any) -> bool:
    return bool(_VERSION_PATTERN.match(str(value or "").strip()))


def _version_parts(value: str) -> tuple[int, int, int]:
    numbers = [int(item) for item in str(value or "0").split(".") if item.isdigit()]
    numbers = (numbers + [0, 0, 0])[:3]
    return numbers[0], numbers[1], numbers[2]


def _version_sort_key(value: str) -> tuple[int, int, int]:
    return _version_parts(value)


def compare_versions(left: str, right: str) -> int:
    """Compare ``major.minor[.patch]`` versions, missing parts treated as zero."""
    left_parts, right_parts = _version_parts(left), _version_parts(right)
    return (left_parts > right_parts) - (left_parts < right_parts)


def tool_publish_gate(
    request_row: dict[str, Any],
    *,
    version: str,
    existing_versions: Iterable[str] = (),
) -> dict[str, Any]:
    """Whether one approved design may record a version.

    Four things are required: a passing-enough verdict, a human approval, a valid
    and strictly newer version, and the rollback the specification already stated.
    """
    verdict = str(request_row.get("verdict") or "")
    if verdict == "fail":
        return {"allowed": False, "reason": "A design whose checks failed cannot record a version."}
    if str(request_row.get("stage") or "") not in {"approved", "published"}:
        return {"allowed": False, "reason": "A person has to approve the design before a version can be recorded."}
    if not version_is_valid(version):
        return {"allowed": False, "reason": "Use a version in the form 1.0 or 1.2.3."}
    previous = [str(item) for item in existing_versions if str(item or "").strip()]
    if previous:
        newest = max(previous, key=_version_sort_key)
        if compare_versions(version, newest) <= 0:
            return {
                "allowed": False,
                "reason": f"Version {version} is not newer than the published {newest}; a published version is never overwritten.",
            }
    if not str(request_row.get("rollback") or "").strip():
        return {"allowed": False, "reason": "A version cannot be published without the rollback the design declared."}
    return {"allowed": True, "reason": "The design is approved, verified and versioned.",
            "review_interval_days": int(request_row.get("review_interval_days") or 0)}
