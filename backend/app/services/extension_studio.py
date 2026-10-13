"""Nexus Extension Studio — a controlled way to add capability without editing core.

Foundation 3 of the three foundations in ``docs/NEXUS_FOUNDATIONS_BATCH_4.md``.

The commercial claim behind extensions ("build Nexus-native dashboards, commands,
connectors and workflows") is only safe if it is *governed*. So this module ships
the smallest honest control: a **manifest contract** plus deterministic,
disclosed checks over a submitted manifest. It generates no code, executes
nothing, holds no credential and grants no privilege.

Where :mod:`app.services.nexus_forge` composes a *design request* from routes the
API already serves, Extension Studio evaluates the *packaging* of an already
specified extension: what it is called, which kind it is, which served
capabilities and which permissions it declares, what data classes it touches,
how it is isolated, how it verifies and how it rolls back.

Marketplace distribution, signing infrastructure and isolated execution are
deferred with named gates in ``docs/NEXUS_FOUNDATIONS_BATCH_4.md`` — this module
never claims they exist. An extension that declares ``distribution: distributed``
without a recorded signature is *refused*, not silently downgraded.
"""

from __future__ import annotations

from typing import Any, Iterable, Mapping, Sequence

# The API contract a manifest is validated against.
NEXUS_API_VERSION = "1.0"

EXTENSION_KINDS = ("dashboard", "command", "connector", "workflow")

DISTRIBUTIONS = ("private", "distributed")

# Data classes an extension may declare. A credential-shaped declaration is a
# failure rather than a warning: Nexus never hands an extension a secret.
DATA_CLASSES = (
    "operational",
    "customer_contact",
    "configuration",
    "telemetry",
    "aggregate",
)
CREDENTIAL_DATA_CLASSES = frozenset({"secret", "credential", "token", "password", "private_key"})

REQUIRED_MANIFEST_FIELDS = (
    "id",
    "name",
    "version",
    "kind",
    "distribution",
    "capabilities",
    "permissions",
    "data_classes",
    "isolation",
    "verification",
    "rollback",
)

CHECK_STATES = frozenset({"pass", "needs_review", "fail"})
VERDICTS = frozenset({"approved", "needs_review", "rejected"})

EXTENSION_BOUNDARY = (
    "Extension Studio reviews a manifest. It does not build, sign, deploy or execute "
    "an extension, and approval is not a grant of privilege — every declared "
    "capability is re-checked against the caller's own permissions at call time."
)

MARKETPLACE_GATE = (
    "Deferred: marketplace distribution requires signing infrastructure, a review "
    "authority and a liability model, and isolated execution requires a sandbox with "
    "provisioning, expiry and destruction evidence. Neither exists yet, so a "
    "distributed extension cannot be approved by this contract."
)


def version_compatible(requires_api: str, api_version: str = NEXUS_API_VERSION) -> bool:
    """Compatibility is ``major`` equality and ``minor <=`` what Nexus serves."""
    def _parts(value: str) -> tuple[int, int]:
        text = str(value or "").strip()
        major, _, rest = text.partition(".")
        minor = rest.partition(".")[0]
        try:
            return int(major), int(minor or 0)
        except ValueError:
            return -1, -1

    required_major, required_minor = _parts(requires_api)
    served_major, served_minor = _parts(api_version)
    if required_major < 0:
        return False
    return required_major == served_major and required_minor <= served_minor


def manifest_contract() -> dict[str, Any]:
    """The contract the UI renders, so the rules are not re-written in the browser."""
    return {
        "api_version": NEXUS_API_VERSION,
        "kinds": list(EXTENSION_KINDS),
        "distributions": list(DISTRIBUTIONS),
        "data_classes": list(DATA_CLASSES),
        "credential_data_classes": sorted(CREDENTIAL_DATA_CLASSES),
        "required_fields": list(REQUIRED_MANIFEST_FIELDS),
        "check_states": sorted(CHECK_STATES),
        "verdicts": sorted(VERDICTS),
        "marketplace": {"state": "deferred", "gate": MARKETPLACE_GATE},
        "boundary": EXTENSION_BOUNDARY,
    }


def _check(check_id: str, label: str, state: str, reason: str) -> dict[str, str]:
    if state not in CHECK_STATES:
        raise ValueError(f"unknown check state: {state}")
    return {"id": check_id, "label": label, "state": state, "reason": reason}


def _secret_shaped(class_name: str) -> bool:
    name = str(class_name or "").strip().lower()
    return name in CREDENTIAL_DATA_CLASSES or "credential" in name or "secret" in name


def validate_manifest(
    manifest: Mapping[str, Any] | None,
    *,
    known_capabilities: Iterable[str] | None = None,
    known_permissions: Iterable[str] | None = None,
    api_version: str = NEXUS_API_VERSION,
) -> dict[str, Any]:
    """Run every disclosed check over a submitted manifest.

    Returns ``{verdict, checks, missing_fields, api_version}``. ``verdict`` is
    ``rejected`` if any check fails, ``needs_review`` if any check needs review,
    and ``approved`` only when all checks pass.
    """
    document: Mapping[str, Any] = manifest if isinstance(manifest, Mapping) else {}
    capabilities_served = {str(item) for item in (known_capabilities or []) if str(item).strip()}
    if known_permissions is None:
        from app.services.action_permissions import ACTION_PERMISSION_IDS
        permissions_catalogue: set[str] = {str(item) for item in ACTION_PERMISSION_IDS}
    else:
        permissions_catalogue = {str(item) for item in known_permissions if str(item).strip()}

    checks: list[dict[str, str]] = []

    # 1. Required fields present.
    missing = [field for field in REQUIRED_MANIFEST_FIELDS if document.get(field) in (None, "", [], {})]
    checks.append(_check(
        "required_fields", "Every required manifest field is present",
        "fail" if missing else "pass",
        f"Missing required field(s): {', '.join(missing)}." if missing
        else "All required manifest fields are present.",
    ))

    # 2. Version compatibility with the API Nexus actually serves.
    requires_api = str(document.get("requires_api") or api_version)
    compatible = version_compatible(requires_api, api_version)
    checks.append(_check(
        "api_compatibility", "The extension targets a compatible Nexus API",
        "pass" if compatible else "fail",
        f"Requires API {requires_api}; Nexus serves {api_version}."
        if compatible else
        f"Requires API {requires_api}, which is not compatible with the served API {api_version}.",
    ))

    # 3. Declared kind is a governed kind.
    kind = str(document.get("kind") or "").strip().lower()
    checks.append(_check(
        "kind", "Declared kind is a governed extension kind",
        "pass" if kind in EXTENSION_KINDS else "fail",
        f"Kind '{kind}' is governed." if kind in EXTENSION_KINDS
        else f"Kind '{kind or '(none)'}' is not one of: {', '.join(EXTENSION_KINDS)}.",
    ))

    # 4. Permissions must be named and must exist; a wildcard is a failure.
    permissions = [str(item) for item in (document.get("permissions") or [])]
    wildcard = [item for item in permissions if "*" in item]
    unknown_permissions = [item for item in permissions if item not in permissions_catalogue]
    if wildcard:
        permission_state, permission_reason = "fail", f"Wildcard permission(s) are not allowed: {', '.join(wildcard)}."
    elif unknown_permissions:
        permission_state, permission_reason = "fail", (
            "Permission(s) not present in the Nexus action catalogue: "
            + ", ".join(unknown_permissions) + "."
        )
    else:
        permission_state, permission_reason = "pass", (
            f"{len(permissions)} named permission(s) all resolve to the Nexus action catalogue."
            if permissions else "The extension declares no permission and can therefore change nothing."
        )
    checks.append(_check("permissions", "Declared permissions are named, known and non-wildcard",
                         permission_state, permission_reason))

    # 5. Every declared capability must exist in the served route table.
    declared = [str(item) for item in (document.get("capabilities") or [])]
    unresolved = [item for item in declared if item not in capabilities_served]
    checks.append(_check(
        "capabilities", "Every declared capability is one the Nexus API actually serves",
        "fail" if unresolved else "pass",
        "Unresolved capability reference(s): " + ", ".join(unresolved) + "." if unresolved
        else f"All {len(declared)} declared capability reference(s) resolve to served routes.",
    ))

    # 6. Data classes are declared and never credential-shaped.
    data_classes = [str(item) for item in (document.get("data_classes") or [])]
    credential_classes = [item for item in data_classes if _secret_shaped(item)]
    checks.append(_check(
        "data_classes", "Declared data classes exclude credentials and secrets",
        "fail" if credential_classes else "pass",
        "Credential-shaped data class(es) declared: " + ", ".join(credential_classes) + "." if credential_classes
        else f"Declared data classes: {', '.join(data_classes)}." if data_classes
        else "The extension declares no data class.",
    ))

    # 7. Isolation: a plan is required before anything can be reviewed.
    isolation = document.get("isolation")
    checks.append(_check(
        "isolation", "An isolation plan is recorded",
        "pass" if str(isolation or "").strip() else "fail",
        f"Isolation plan: {isolation}" if str(isolation or "").strip()
        else "No isolation plan is recorded, so the extension's blast radius is unknown.",
    ))

    # 8. Verification: required whenever the extension claims a served capability.
    verification = document.get("verification")
    verification_text = str(verification or "").strip()
    if not declared:
        checks.append(_check("verification", "Verification is recorded for state-changing work",
                             "pass", "The extension composes no served capability, so it changes nothing."))
    else:
        checks.append(_check(
            "verification", "Verification is recorded for state-changing work",
            "pass" if verification_text else "fail",
            f"Verification: {verification_text}" if verification_text
            else "State-changing extensions must record how the result is verified.",
        ))

    # 9. Rollback: essential, but a thin plan is reviewable rather than fatal.
    rollback = str(document.get("rollback") or "").strip()
    checks.append(_check(
        "rollback", "A rollback path is recorded",
        "pass" if len(rollback) >= 20 else "needs_review",
        f"Rollback: {rollback}" if len(rollback) >= 20
        else "Rollback is missing or too thin to be a recoverable plan.",
    ))

    # 10. Distribution across tenants requires a recorded signature.
    distribution = str(document.get("distribution") or "").strip().lower()
    signature = str(document.get("signature") or "").strip()
    if distribution == "distributed" and not signature:
        distribution_state, distribution_reason = "fail", (
            "A distributed extension requires a recorded signature; signing "
            "infrastructure is deferred, so none can be approved yet."
        )
    elif distribution == "distributed":
        distribution_state, distribution_reason = "needs_review", (
            "A signature is recorded, but the review authority for distributed "
            "extensions is not yet established."
        )
    elif distribution == "private":
        distribution_state, distribution_reason = "pass", (
            "A private extension stays inside this tenant."
            + ("" if signature else " It is unsigned, which is acceptable only while private.")
        )
    else:
        distribution_state, distribution_reason = "fail", (
            f"Distribution must be one of: {', '.join(DISTRIBUTIONS)}."
        )
    checks.append(_check("distribution", "Distribution matches what Nexus can currently support",
                         distribution_state, distribution_reason))

    if any(check["state"] == "fail" for check in checks):
        verdict = "rejected"
    elif any(check["state"] == "needs_review" for check in checks):
        verdict = "needs_review"
    else:
        verdict = "approved"

    return {
        "verdict": verdict,
        "checks": checks,
        "missing_fields": missing,
        "api_version": api_version,
        "boundary": EXTENSION_BOUNDARY,
    }


def summarize_checks(checks: Sequence[Mapping[str, Any]]) -> dict[str, int]:
    """Counts per check state, so a UI can show "12 checks, 2 need review"."""
    summary = {state: 0 for state in sorted(CHECK_STATES)}
    for check in checks:
        state = str(check.get("state") or "")
        if state in summary:
            summary[state] += 1
    summary["total"] = sum(summary[state] for state in CHECK_STATES)
    return summary
