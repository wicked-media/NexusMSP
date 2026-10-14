"""Every wired Studio tab must read a route Nexus actually serves.

A tab is "wired" when its registry contract names the endpoint it reads, and the
fleet's whole promise is that such a tab renders observed data rather than an
invented shape. That promise has a failure mode no handler test catches: the
registry names a path, or a path parameter it never bound, and the surface
either requests nothing or requests a literal placeholder. These tests resolve
every declared endpoint through the live application (the same helper
``test_studio_fleet`` uses for the mounted-operation guards), require the
answering operation to be auth-guarded, and pin the studios that adopted an
existing workspace projection — the four that started it (devices, agent,
client, backup) and the nine that followed (web, m365, voice, network, patch,
security, documentation, lead, communications) — so a later edit cannot quietly
re-plan them. Those thirteen studios also share one rendering kit in the
browser, so the panels are checked to stay a field mapping over that kit rather
than each growing their own fetch and their own disclosure wording.

The endpoint is read from the contract, never reconstructed here: a test that
built its own path would agree with itself while the tab stayed broken.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
REPO_ROOT = BACKEND_ROOT.parent

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.services import studio_registry  # noqa: E402
from test_studio_fleet import _mounted_operation  # noqa: E402

# The studios that adopted an existing workspace projection across both batches,
# with the endpoint and the surface each one reads. Pinned so a tab that stops
# reading the projection it was admitted against fails here.
ADOPTED_PROJECTIONS = {
    "devices": ("/devices", "app.routers.devices"),
    "agent": ("/nexus-agent/agents", "app.routers.nexus_agent"),
    "client": ("/clients-enriched", "app.routers.clients"),
    "backup": ("/backup-dashboard/overview", "app.routers.backup_center"),
    # The second batch adopted a scoped projection the same way: each contract
    # names an endpoint the domain workspace already serves, and the studio
    # renders that evidence instead of deriving a second opinion about it.
    "web": ("/web-studio/fleet", "app.routers.web_studio"),
    "m365": ("/m365/tenants", "app.routers.m365"),
    "voice": ("/yeastar/pbxs", "app.routers.yeastar"),
    "network": ("/networking/sites", "app.routers.networking"),
    "patch": ("/patch-compliance/overview", "app.routers.patch_compliance"),
    "security": ("/security-dashboard/overview", "app.routers.security_dashboard"),
    "documentation": ("/documentation", "app.routers.it_docs"),
    "lead": ("/leads", "app.routers.crm"),
    "communications": ("/csat/dashboard", "app.routers.csat_surveys"),
}

# The panels that render those projections, and the kit that maps an endpoint to
# one. A wired endpoint no panel models degrades to the generic raw-payload tab,
# which is a real (if quiet) loss of the evidence contract, so the mapping is
# checked against the registry rather than assumed. One panel per adopted
# projection, in the order the projections were adopted.
OBSERVATION_KIT = REPO_ROOT / "frontend/src/components/studios/StudioObservationKit.jsx"
OBSERVATION_PANELS = (
    "DeviceEstatePanel.jsx",
    "AgentFleetPanel.jsx",
    "ClientEstatePanel.jsx",
    "BackupRecoveryPanel.jsx",
    "WebEstatePanel.jsx",
    "M365TenantPanel.jsx",
    "VoiceEstatePanel.jsx",
    "NetworkSitesPanel.jsx",
    "PatchPosturePanel.jsx",
    "SecurityPosturePanel.jsx",
    "DocumentationInventoryPanel.jsx",
    "LeadPipelinePanel.jsx",
    "CommunicationsPanel.jsx",
)

# The shared parts a panel must render through. A panel that reimplemented the
# header, the totals, the rows or the not-reported value itself would name none
# of these, which is exactly the drift this list catches.
KIT_RENDER_PARTS = (
    "ObservationHeader",
    "ObservedTotals",
    "ObservedRows",
    "Observed",
    "NotReported",
    "ObservedEmpty",
    "ObservationNote",
    "ObservationUnbound",
)


def _concrete_path(spec: dict) -> str:
    """The path a tab really requests, with the registry's bound parameters."""
    path = spec["endpoint"]
    for key, value in (spec.get("params") or {}).items():
        path = path.replace("{" + key + "}", str(value))
    return path


def _wired_tabs():
    for studio in studio_registry.STUDIOS.values():
        for tab_id, spec in studio["tabs"].items():
            if spec["state"] == "wired" and spec.get("endpoint"):
                yield studio["id"], tab_id, spec


def test_every_wired_tab_requests_a_route_that_exists():
    """No wired tab may name a path the application does not serve."""
    checked = 0
    for studio_id, tab_id, spec in _wired_tabs():
        path = _concrete_path(spec)
        assert "{" not in path, (
            f"{studio_id}.{tab_id} leaves {path} unbound, so the surface would "
            "request a literal placeholder"
        )
        route = _mounted_operation("GET", f"/api{path}")
        assert route is not None, (
            f"{studio_id}.{tab_id} is wired to {path}, which no mounted operation answers"
        )
        checked += 1
    # The floor guards the guard: the fleet holds 29 studios and each one
    # contributes its own wired Overview tab before any provider projection is
    # counted, so a total below 30 means this iteration stopped early rather than
    # that the fleet shrank.
    assert checked >= 30, "expected the fleet's wired tabs to be exercised"


def test_every_wired_tab_is_guarded_by_the_authentication_dependency():
    """A studio read is a customer-scoped read; the route must require an actor."""
    for studio_id, tab_id, spec in _wired_tabs():
        route = _mounted_operation("GET", f"/api{_concrete_path(spec)}")
        assert route is not None, f"{studio_id}.{tab_id}"
        dependency_modules = {
            getattr(dep.call, "__module__", "") for dep in route.dependant.dependencies
        }
        assert "app.auth" in dependency_modules, (
            f"{studio_id}.{tab_id} reads {spec['endpoint']} through a route with no "
            f"app.auth dependency (found {sorted(dependency_modules)})"
        )


def test_the_studios_that_adopted_a_projection_read_the_one_they_were_admitted_against():
    for studio_id, (endpoint, evidence) in ADOPTED_PROJECTIONS.items():
        studio = studio_registry.STUDIOS[studio_id]
        inventory = studio["tabs"]["inventory"]
        assert inventory["state"] == "wired", studio_id
        assert inventory["endpoint"] == endpoint, studio_id
        assert inventory["evidence"] == evidence, studio_id
        # The tab says the projection is read, not re-counted: a studio that
        # presented its own arithmetic would be a second source of truth.
        assert "GET " in inventory["summary"], studio_id
        # Admission is unchanged by wiring a tab: these stay Partially
        # implemented until their own release gates clear.
        assert studio["status"] == "Partially implemented", studio_id


def test_the_browser_knows_which_panel_renders_each_adopted_projection():
    """The registry and the surface must agree about who renders what."""
    kit = OBSERVATION_KIT.read_text(encoding="utf-8")
    declared = set(re.findall(r'path === "([^"]+)"', kit))
    for studio_id, (endpoint, _evidence) in ADOPTED_PROJECTIONS.items():
        assert endpoint in declared, (
            f"{studio_id} reads {endpoint}, which the observation kit does not map "
            "to a panel — the tab would fall back to raw JSON"
        )
    for panel in OBSERVATION_PANELS:
        path = OBSERVATION_KIT.parent / panel
        assert path.exists(), f"missing studio observation panel: {panel}"
        # The shell is where a panel is selected; it must import every panel a
        # studio's contract can select.
        shell = (OBSERVATION_KIT.parent / "StudioShell.jsx").read_text(encoding="utf-8")
        assert panel.removesuffix(".jsx") in shell, (
            f"{panel} is not dispatched from StudioShell.jsx"
        )


def _shell_observation_map() -> dict[str, str]:
    """The view key → panel component StudioShell actually selects.

    This map is the last step of the chain and the only silent one: a panel that
    is imported but missing here degrades to the generic raw-payload tab without
    failing anything, which is exactly the loss the fleet forbids.
    """
    shell = (OBSERVATION_KIT.parent / "StudioShell.jsx").read_text(encoding="utf-8")
    block = shell.split("const OBSERVATION_PANELS = {", 1)[1].split("};\n", 1)[0]
    return dict(re.findall(r'"([a-z0-9-]+)":\s*(\w+),', block))


def test_the_shell_selects_exactly_the_panels_the_kit_can_name():
    """Importing a panel is not selecting it, and the difference is invisible."""
    kit = OBSERVATION_KIT.read_text(encoding="utf-8")
    selectable = set(re.findall(r'return "([a-z0-9-]+)";', kit))
    selected = _shell_observation_map()

    assert selectable == set(selected), (
        "the kit and the shell disagree about which projections have a panel: "
        f"unselectable {sorted(selectable - set(selected))}, "
        f"unreachable {sorted(set(selected) - selectable)}"
    )
    assert len(selected) == len(ADOPTED_PROJECTIONS), (
        f"{len(selected)} panel(s) selected for {len(ADOPTED_PROJECTIONS)} adopted projections"
    )
    # A key naming a component nobody renders is the same bug dressed as
    # configuration, so every selection is checked against the filesystem.
    for component in selected.values():
        assert (OBSERVATION_KIT.parent / f"{component}.jsx").exists(), component


def test_every_adopted_projection_panel_renders_through_the_shared_kit():
    """A panel maps fields; the kit owns the request and the disclosures.

    Thirteen panels read thirteen projections, so the failure mode worth pinning
    is drift: one panel quietly growing its own fetch or its own wording for a
    value the API did not report, which would leave the fleet's disclosure
    contract true in twelve places and false in the thirteenth. The sources are
    read rather than executed, so this asserts the shape each panel was written
    to, not its rendered output.
    """
    for panel in OBSERVATION_PANELS:
        source = (OBSERVATION_KIT.parent / panel).read_text(encoding="utf-8")
        assert "useStudioObservation(" in source, (
            f"{panel} does not read its projection through the shared kit"
        )
        assert "axios" not in source, (
            f"{panel} performs its own request; the registry contract and the "
            "endpoint are the kit's to read"
        )
        assert "StudioObservationKit" in source, (
            f"{panel} does not import from the shared kit"
        )
        assert any(part in source for part in KIT_RENDER_PARTS), (
            f"{panel} renders none of the kit's shared parts "
            f"({', '.join(KIT_RENDER_PARTS)})"
        )


def test_an_unbound_endpoint_is_refused_rather_than_requested():
    """The kit's own guard: a placeholder the registry never bound reads nothing."""
    with pytest.raises(ValueError, match="leaves"):
        studio_registry._tab("wired", "x", endpoint="/devices/{kind}")
