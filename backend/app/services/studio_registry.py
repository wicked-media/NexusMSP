"""Nexus Studio fleet registry — the single brain behind every Studio.

A Studio is one specialist operating surface over canonical Nexus objects. The
fleet is defined once here so that adding a studio is a registry entry plus an
adapter, never a second parallel product (docs/PLATFORM_PRIORITY_MAP.md naming
rule; docs/NEXUS_STUDIO_FLEET.md is the human-readable plan this file encodes).

Three rules this module enforces:

1. **One spine.** Every studio exposes the same nine tabs — Overview,
   Inventory, Administration, Diagnostics, Changes, Automation, Security,
   Activity, Settings. The tabs are the contract; studios differ only in which
   capabilities fill them.
2. **Admission first** (docs/NEXUS_PRODUCT_CONSTITUTION.md capability admission
   gate). A studio that cannot name its problem, objects, provider contracts,
   permissions/scopes/audit/retention, verification/rollback/failure behaviour,
   commercial source, release gate, test plan, documentation and owner stays
   ``Discovery required`` or ``Architecture required`` and says so in its own
   contract.
3. **Disclosed, never fabricated** (Law 9). A tab whose capability is not
   registered renders ``planned``/``discovery_required`` with the reason — an
   unmeasured dimension is never shown as a clean state, and no studio may
   invent inventory, health or success it did not observe.

The registry is static code, not a store: it holds no customer data and no
secrets, so it needs no tenant partition (see docs/DATA_OWNERSHIP.md).
"""

from __future__ import annotations

import re
from typing import Any

from app.services import studio_proposals

REGISTRY_VERSION = "1.0"

# ============== THE SPINE ==============

SPINE_TABS: tuple[str, ...] = (
    "overview",
    "inventory",
    "administration",
    "diagnostics",
    "changes",
    "automation",
    "security",
    "activity",
    "settings",
)

TAB_META: dict[str, dict[str, str]] = {
    "overview": {
        "label": "Overview",
        "purpose": "What this studio is, its admission contract, provider health and honest status.",
    },
    "inventory": {
        "label": "Inventory",
        "purpose": "Observed provider objects for this domain, with observed_at/source provenance.",
    },
    "administration": {
        "label": "Administration",
        "purpose": "Governed actions behind the canonical action descriptor, approval and verification.",
    },
    "diagnostics": {
        "label": "Diagnostics",
        "purpose": "Read-only diagnosis and evidence-gathering for this domain.",
    },
    "changes": {
        "label": "Changes",
        "purpose": "Proposed and applied changes with approval, rollback and outcome evidence.",
    },
    "automation": {
        "label": "Automation",
        "purpose": "Registered recipes and workflows for this domain, with verification steps.",
    },
    "security": {
        "label": "Security",
        "purpose": "Security posture, containment and policy signals for this domain.",
    },
    "activity": {
        "label": "Activity",
        "purpose": "Scoped platform events whose subjects belong to this studio, newest first.",
    },
    "settings": {
        "label": "Settings",
        "purpose": "Studio-scoped configuration and connection state. Never renders credentials.",
    },
}

TAB_STATES = frozenset({"wired", "planned", "architecture_required", "discovery_required", "deferred"})

# The register's status vocabulary (docs/NEXUS_MASTER_CAPABILITY_REGISTER.md).
STUDIO_STATUSES = frozenset({
    "Not started", "Discovery required", "Architecture required", "In development",
    "Partially implemented", "Implemented", "Testing", "Production blocked",
    "Production ready", "Deferred", "Rejected with reason",
})

DEFAULT_PLANNED_SUMMARY = (
    "No capability contract is registered for this tab yet. It stays disclosed as "
    "unbuilt until an adapter, permission wiring and an evidence contract are admitted."
)

# Shared platform policy every studio inherits; individual admissions may extend
# it but never weaken it.
SCOPES_AUDIT_RETENTION = (
    "Server-side tenant partition plus technician client/site scope on every read and "
    "write; action permissions from the action catalogue; audit via activity_logs and "
    "platform events; retention follows the owning collection's documented policy."
)


# A path segment a tab endpoint leaves to be supplied, e.g. ``{platform}``.
_ENDPOINT_PARAM = re.compile(r"\{([a-z_]+)\}")


def _tab(state: str, summary: str, *, endpoint: str | None = None,
         params: dict[str, str] | None = None,
         subjects: tuple[str, ...] | None = None, evidence: str | None = None) -> dict:
    if state not in TAB_STATES:
        raise ValueError(f"unknown tab state: {state}")
    row: dict[str, Any] = {"state": state, "summary": summary}
    if endpoint:
        # A wired tab is only wired if the surface can build the request it names.
        # An endpoint that still carries a ``{placeholder}`` the registry never
        # bound is a tab that reads nothing, so it is refused here instead of
        # rendering as a wired tab over an unresolved path.
        unresolved = _ENDPOINT_PARAM.findall(endpoint) if state == "wired" else []
        undeclared = sorted(set(unresolved) - set(params or {}))
        if undeclared:
            raise ValueError(
                f"tab endpoint {endpoint} leaves {undeclared} for the surface to guess"
            )
        row["endpoint"] = endpoint
    if params:
        row["params"] = dict(params)
    if subjects:
        # Subject prefixes matched with startswith against platform event subjects.
        row["subjects"] = list(subjects)
    if evidence:
        row["evidence"] = evidence
    return row


def _planned(summary: str | None = None) -> dict:
    return _tab("planned", summary or DEFAULT_PLANNED_SUMMARY)


def _studio(
    *,
    studio_id: str,
    name: str,
    domain: str,
    product: str,
    tagline: str,
    status: str,
    priority: str,
    release: str,
    owner: str,
    home_route: str | None,
    admission: dict | None,
    provider: dict | None = None,
    tabs: dict[str, dict] | None = None,
) -> dict:
    if status not in STUDIO_STATUSES:
        raise ValueError(f"unknown studio status: {status}")
    # The navigation boundary is structural: a studio outside a declared product
    # would be a fourteenth-kind workspace by accident, which is the failure mode
    # the product taxonomy exists to prevent.
    if product not in PRODUCTS:
        raise ValueError(f"{studio_id}: unknown product '{product}'")
    if studio_id in PRODUCTS[product]["planned_studios"]:
        raise ValueError(
            f"{studio_id}: a studio cannot also be its product's planned studio"
        )
    merged = {tab: _planned() for tab in SPINE_TABS}
    # Overview always renders this studio's own contract — the admission record
    # itself is the evidence, so it is wired for every studio without a provider call.
    merged["overview"] = _tab(
        "wired",
        "Renders this studio's admission contract, provider contract state and honest status.",
        evidence="app.services.studio_registry",
    )
    for tab_id, spec in (tabs or {}).items():
        if tab_id not in SPINE_TABS:
            raise ValueError(f"{studio_id}: unknown tab '{tab_id}'")
        merged[tab_id] = spec

    # Admission consistency comes after structural validation so a typo'd tab
    # reports as the typo, not as a status mismatch.
    unadmitted = status in {"Discovery required", "Architecture required"}
    if unadmitted == (admission is not None and admission.get("state") == "complete"):
        raise ValueError(f"{studio_id}: admission state must match status '{status}'")
    if unadmitted:
        for tab_id, spec in merged.items():
            if tab_id == "overview":
                continue
            if spec["state"] == "wired":
                raise ValueError(f"{studio_id}: unadmitted studios cannot declare wired tabs")
            merged[tab_id] = _tab(
                "discovery_required" if status == "Discovery required" else "architecture_required",
                f"Blocked at capability status '{status}': admission fields are open "
                "(see the admission contract on Overview).",
            )
    return {
        "id": studio_id,
        "name": name,
        "domain": domain,
        "product": product,
        "tagline": tagline,
        "status": status,
        "priority": priority,
        "release": release,
        "owner": owner,
        "home_route": home_route,
        "provider": provider or {"name": "nexus_native", "state": "wired", "reference": "Nexus canonical objects"},
        "admission": admission,
        "spine": list(SPINE_TABS),
        "tabs": merged,
    }


def _admission(
    *,
    problem: str,
    objects: tuple[str, ...],
    provider_contracts: tuple[str, ...],
    permissions: tuple[str, ...],
    verification_rollback_failure: str,
    commercial: str,
    release_gate: str,
    test_plan: str,
    documentation: str,
    owner: str,
    scopes_audit_retention: str = SCOPES_AUDIT_RETENTION,
    state: str = "complete",
) -> dict:
    return {
        "state": state,
        "problem": problem,
        "objects": list(objects),
        "provider_contracts": list(provider_contracts),
        "permissions": list(permissions),
        "scopes_audit_retention": scopes_audit_retention,
        "verification_rollback_failure": verification_rollback_failure,
        "commercial": commercial,
        "release_gate": release_gate,
        "test_plan": test_plan,
        "documentation": documentation,
        "owner": owner,
    }


# The platform event stream wired into every admitted studio's Activity tab.
ACTIVITY_ENDPOINT = "/events/platform/recent"

OPEN_ADMISSION_NOTE = (
    "Open admission: the customer problem is known but provider contracts, "
    "verification behaviour or ownership are not yet grounded, so the studio "
    "stays out of active implementation."
)

# ============== THE PRODUCTS ==============
#
# A product is the NAVIGATION boundary, not a second product line. Nexus
# presents a handful of major products and each one holds the specialist
# studios and workspaces that operate it, so a hundred-plus operational
# problems never become a hundred-plus navigation entries
# (docs/NEXUS_INVENT_BATCH_5.md records the decision and the 130-studio
# catalogue it groups).
#
# The rule this module enforces is that **no studio can exist outside a
# product**: a new capability joins an existing product by default, and
# creating another product is a deliberate, reviewable decision rather than
# something that happens by adding a studio.
#
# ``planned_studios`` is DERIVED, not written here: it is the ``studio``
# proposals ``app.services.studio_proposals`` files under the product. The
# consolidation in that module decides what each catalogue idea becomes — a
# gated studio, a section of a studio that already exists, a merge into a shared
# work item, a named gap on an existing surface, or a delivered capability — so a
# product can never claim a proposal the consolidation turned into an extension
# of something it already has. It is a plan, not a capability claim: admission
# stays per-studio, and a studio listed here is not implemented, tested or
# released by being listed here.


# ============== THE COMMERCIAL TIERS ==============
#
# The catalogue is a product portfolio, not a backlog (docs/NEXUS_INVENT_BATCH_6.md):
# the tiers below are the packaging that follows from it. A tier is a *commercial*
# statement about a product — what a Nexus subscription includes, what is an optional
# specialist addition, and what is shared platform capability every other product
# inherits — so it is declared once here rather than inferred from a price list
# somewhere else.
#
# Tiers are derived from the products that already exist and change no persistence:
# like the rest of this register they are static declaration, so they need no tenant
# partition (docs/DATA_OWNERSHIP.md).

TIERS: dict[str, dict] = {
    tier["id"]: tier
    for tier in (
        {
            "id": "core",
            "label": "Core",
            "blurb": "Everyday MSP operations: the products a technician works in all day.",
        },
        {
            "id": "specialist",
            "label": "Specialist",
            "blurb": "Advanced capability a client buys because their estate needs it.",
        },
        {
            "id": "platform",
            "label": "Platform",
            "blurb": "Shared engines every other product inherits: policy, evidence, "
                     "commercials and integration management.",
        },
    )
}

TIER_NOTE = (
    "Tiers are the commercial packaging of the same portfolio: a core subscription, "
    "optional specialist capability, and the platform features that make every product "
    "stronger. A product belongs to exactly one tier, and a tier is never claimed by a "
    "studio that has not been admitted."
)


def _product(
    product_id: str,
    name: str,
    tagline: str,
    tier: str,
) -> dict:
    if tier not in TIERS:
        raise ValueError(f"product '{product_id}': unknown tier '{tier}'")
    return {
        "id": product_id,
        "name": name,
        "tagline": tagline,
        "tier": tier,
        # Filled in below from the consolidated proposal register.
        "planned_studios": [],
    }


PRODUCTS: dict[str, dict] = {
    product["id"]: product
    for product in (
        _product(
            "nexus-endpoint", "Nexus Endpoint",
            "One endpoint estate: the device record, the agent, patching, remote control "
            "and the per-platform specialist views technicians work in.",
            "core",
        ),
        _product(
            "nexus-infrastructure", "Nexus Infrastructure",
            "The estate under the estate: virtualisation, network, DNS, connectivity and "
            "cloud resources Nexus can observe and act on.",
            "specialist",
        ),
        _product(
            "nexus-recovery", "Nexus Recovery",
            "Backup, restore and storage: recovery intent, restore evidence and the storage "
            "faults that threaten a business service.",
            "core",
        ),
        _product(
            "nexus-shield", "Nexus Shield",
            "Security and compliance: detection, evidence, control mapping and the audit "
            "trail that proves them.",
            "core",
        ),
        _product(
            "nexus-identity", "Nexus Identity",
            "Identity and the Microsoft control plane: tenants, directories, access decisions "
            "and why an authentication attempt succeeded or failed.",
            "core",
        ),
        _product(
            "nexus-service", "Nexus Service",
            "Service operations: tickets, the customer environment, commitments honoured, "
            "response clocks and dispatched work.",
            "core",
        ),
        _product(
            "nexus-communications", "Nexus Communications",
            "Voice, telecom and messaging: calls, numbers, circuits and the conversations "
            "around them.",
            "specialist",
        ),
        _product(
            "nexus-knowledge", "Nexus Knowledge",
            "Documentation and the operational memory that keeps a technician from relearning "
            "what the platform already knows.",
            "platform",
        ),
        _product(
            "nexus-automation", "Nexus Automation",
            "Automation and AI: workflows, approvals, simulation, rollback and the agents that "
            "propose work for a person to accept.",
            "platform",
        ),
        _product(
            "nexus-observability", "Nexus Observability",
            "Telemetry and its meaning: metrics, logs, traces, alerts and the evidence-backed "
            "explanation of a degradation Nexus is asked to produce.",
            "platform",
        ),
        _product(
            "nexus-commerce", "Nexus Commerce",
            "Commercial operations on one engine: quoting, procurement, stock, subscriptions, "
            "billing and real customer profitability.",
            "platform",
        ),
        _product(
            "nexus-growth", "Nexus Growth",
            "Customer growth: the client record, the technology roadmap, evidence-backed "
            "proposals and the partners Nexus delivers with.",
            "specialist",
        ),
        _product(
            "nexus-build", "Nexus Build",
            "Build and release: repositories, pipelines, application runtimes, data movement "
            "and governed releases with verification and rollback.",
            "specialist",
        ),
        _product(
            "nexus-platform", "Nexus Platform",
            "Platform and ecosystem: the extension and integration lifecycle, publishers, "
            "versions and the shared capabilities every other product inherits.",
            "platform",
        ),
    )
}

# The catalogue consolidation decides what each product is intended to hold;
# this module only publishes the result. See studio_proposals for the register
# and docs/NEXUS_STUDIO_MERGE_REVIEW.md for the merge decisions.
for _product_id in PRODUCTS:
    PRODUCTS[_product_id]["planned_studios"] = list(
        studio_proposals.planned_studios_by_product().get(_product_id, [])
    )
_unknown_proposal_products = sorted(
    set(studio_proposals.planned_studios_by_product()) - set(PRODUCTS)
)
if _unknown_proposal_products:
    raise ValueError(
        "the proposal register files work under undeclared products: "
        f"{_unknown_proposal_products}"
    )

PRODUCT_NOTE = (
    "Products are the navigation boundary: every studio belongs to exactly one, so "
    "adding capability extends an existing product instead of adding another "
    "workspace. planned_studios lists the proposed studios this product is "
    "intended to hold; every other catalogue idea is recorded with its disposition "
    "in the product's proposals."
)

# ============== THE FLEET ==============

STUDIOS: dict[str, dict] = {}


def _register(studio: dict) -> None:
    STUDIOS[studio["id"]] = studio


# --- Shipped studios adopting the spine -------------------------------------

_register(_studio(
    studio_id="web", name="Web Studio", domain="Websites",
    product="nexus-build",
    tagline="WordPress and client web estate operations on the governed website record.",
    status="Partially implemented", priority="P1", release="R2",
    owner="Experience + Platform", home_route="/web-studio",
    provider={"name": "wordpress_wp_json", "state": "wired",
              "reference": "app.routers.web_studio (Safe Update Engine, plugin intelligence)"},
    admission=_admission(
        problem=(" MSPs maintain many client WordPress sites; patching plugins blind causes "
                 "outages. Outcome: updates only proceed with fresh inventory, a fresh backup "
                 "and a preflight that blocks unsafe ones."),
        objects=("application", "device", "service"),
        provider_contracts=("wordpress_wp_json (web_studio)", "synergy_wholesale (registrations)"),
        permissions=("synergy.wholesale.manage",),
        verification_rollback_failure=("Preflight blocks on missing backup, stale inventory or "
                                       "unlinked connection; plan status never claims execution; "
                                       "failed updates surface as execution_failed evidence."),
        commercial="Website care-plan records on the client contract; no separate ledger.",
        release_gate="P1 #7 flagship batch; gates named in docs/NEXUS_WEB_STUDIO_FLEET.md.",
        test_plan="backend/tests/test_web_studio_fleet.py (preflight, risk, plan lifecycle).",
        documentation="docs/NEXUS_WEB_STUDIO_FLEET.md",
        owner="Experience + Platform",
    ),
    tabs={
        "inventory": _tab(
            "wired",
            "The managed website estate the Web workspace already derives (GET /web-studio/fleet): "
            "managed sites with their plugin-update, security-finding and backup-warning totals, "
            "each site's reachability and attention state, and the three per-dimension assessed "
            "flags that keep \"nothing found\" distinguishable from \"not yet checked\". Read, not "
            "re-counted.",
            endpoint="/web-studio/fleet",
            evidence="app.routers.web_studio",
        ),
        "activity": _planned("No WordPress-specific platform subjects are registered yet, so the "
                             "tab discloses that instead of showing an empty stream that looks like "
                             "silence."),
        "changes": _planned("Update plans and approvals live in the Safe Update Engine; the studio "
                            "surface reads them next."),
    },
))

_register(_studio(
    studio_id="client", name="Client Studio", domain="Clients",
    product="nexus-growth",
    tagline="Account-level operating picture: 360 context, renewals, lifecycle and portfolio health.",
    status="Partially implemented", priority="P1", release="R2",
    owner="Experience", home_route="/clients",
    admission=_admission(
        problem=("Account context is spread across devices, contracts, tickets and invoices. "
                 "Outcome: one account surface with measurable renewal/churn coverage."),
        objects=("contract", "invoice", "service", "device", "incident"),
        provider_contracts=("nexus_native (canonical client records)",),
        permissions=("client.account.manage", "client.contact.manage", "client.site.manage",
                     "client.portfolio.recalculate"),
        verification_rollback_failure="Read-only projections; tier recompute is recomputable and audited.",
        commercial="Client MRR and contract records are the commercial source of truth.",
        release_gate="Client CRM delivery plan; P1 client experience work.",
        test_plan="backend tests for client studio projections and portfolio attention helpers.",
        documentation="docs/CLIENT_CRM_DELIVERY_PLAN.md",
        owner="Experience",
    ),
    tabs={
        "inventory": _tab(
            "wired",
            "The account rollup the Clients workspace already reads (GET /clients-enriched): "
            "computed health band and risk level, open tickets, device and assessed-endpoint "
            "counts, patch debt and last activity, per client in scope. Read, not re-counted.",
            endpoint="/clients-enriched",
            evidence="app.routers.clients",
        ),
    },
))

_register(_studio(
    studio_id="lead", name="Lead Studio", domain="Sales",
    product="nexus-growth",
    tagline="Pipeline intelligence: scoring, velocity, funnel, win/loss and saved views.",
    status="Partially implemented", priority="P2", release="R2",
    owner="Experience", home_route="/leads",
    admission=_admission(
        problem="Leads are worked without prioritisation or funnel evidence. Outcome: measurable pipeline velocity and conversion.",
        objects=("identity", "contract"),
        provider_contracts=("nexus_native (leads pipeline)",),
        permissions=("crm.lead.manage", "crm.lead.convert", "crm.lead.view"),
        verification_rollback_failure="Scoring is deterministic and hash-stable; bulk actions are idempotent per lead.",
        commercial="Weighted pipeline is advisory; invoices remain the revenue source of truth.",
        release_gate="Lead Studio v1 shipped; studio spine adoption only.",
        test_plan="Backend lead-studio endpoint tests; scoring determinism checks.",
        documentation="memory/PRD.md (Lead Studio v1 record)",
        owner="Experience",
    ),
    tabs={
        "inventory": _tab(
            "wired",
            "The lead records the Sales workspace already holds (GET /leads): company and contact, "
            "source, owner, recorded status and pipeline stage, and the last recorded contact, with "
            "the counts of open, converted and follow-up-carrying leads. Stage weighting and "
            "forecast views are separate projections and are not reproduced here.",
            endpoint="/leads",
            evidence="app.routers.crm",
        ),
    },
))

_register(_studio(
    studio_id="remote", name="Remote Studio", domain="Remote access",
    product="nexus-endpoint",
    tagline="Governed remote sessions with consent, ticket linkage and repair evidence.",
    status="Partially implemented", priority="P0", release="R1-R2",
    owner="Remote", home_route="/nexus-remote",
    provider={"name": "rustdesk_registry", "state": "partial",
              "reference": "app.services.native_remote + remote runtime"},
    admission=_admission(
        problem="Uncontrolled remote access risks cross-client exposure. Outcome: every session scoped, consented, ticketed and audited.",
        objects=("device", "incident", "user"),
        provider_contracts=("rustdesk_relay (remote runtime)", "nexus_agent (repair commands)"),
        permissions=("device.remote.start", "device.remote.control", "device.remote.end",
                     "device.remote.repair", "device.remote.configure"),
        verification_rollback_failure="Session creation is idempotent; repairs are queued through the trusted agent with expiry and replay protection.",
        commercial="Remote time feeds ticket time and invoicing.",
        release_gate="Nexus Remote production spec; sandbox relay golden workflow (R1).",
        test_plan="Remote session scope/idempotency/expiry and consent tests.",
        documentation="docs/NEXUS_REMOTE_PRODUCTION_SPEC.md",
        owner="Remote",
    ),
    tabs={
        "activity": _tab("wired", "Remote session lifecycle events, scoped to your client boundary.",
                         endpoint=ACTIVITY_ENDPOINT,
                         subjects=("remote.session.started", "remote.session.ended", "remote.repair.queued")),
    },
))

# --- The executing adapter studio -------------------------------------------

_register(_studio(
    studio_id="proxmox", name="Proxmox Studio", domain="Virtualisation",
    product="nexus-infrastructure",
    tagline="Proxmox VE clusters: observed inventory and descriptor-gated guest power actions.",
    status="Testing", priority="P1", release="R1-R2",
    owner="Platform + Infrastructure", home_route="/proxmox",
    provider={"name": "proxmox_ve_rest_api", "state": "wired",
              "reference": "app.services.proxmox_adapter (first executing adapter)"},
    admission=_admission(
        problem=("MSPs operate customer hypervisors without an auditable control path. "
                 "Outcome: every power action descriptor-validated, permission-checked, "
                 "approval-gated when destructive, task-verified and recorded."),
        objects=("device", "backup", "change"),
        provider_contracts=("proxmox_ve_rest_api_v2 (app.services.proxmox_adapter)",),
        permissions=("virtualization.vm.control",),
        verification_rollback_failure=("Proxmox task UPID polled to exitstatus OK plus observed guest "
                                       "state; verdicts verified/inconclusive/failed/unknown; rollback "
                                       "action named per power action; unconfigured fails closed 409."),
        commercial="Virtualisation sits under the client infrastructure contract; no separate metering yet.",
        release_gate="Provider sandbox acceptance (Release 1 queue item 6) before Production ready.",
        test_plan="backend/tests/test_proxmox_actions.py (38 cases: fail-closed, approval, exactly-once, verdicts, tenancy).",
        documentation="docs/INTEGRATIONS/PROXMOX.md",
        owner="Platform + Infrastructure",
    ),
    tabs={
        "inventory": _tab("wired", "Live node status from the provider with observed_at/source provenance; empty when unconfigured, never demo data.",
                          endpoint="/proxmox/nodes", evidence="backend/app/routers/proxmox.py"),
        "overview": _tab("wired", "Admission contract plus live connection health from GET /proxmox/connection (no token material).",
                         endpoint="/proxmox/connection", evidence="backend/app/routers/proxmox.py"),
        "administration": _planned("Power actions execute through POST /proxmox/vms/{id}/action with descriptor, approval and verification; the per-guest studio surface lands next."),
        "settings": _planned("Connection management (encrypted API tokens, client scope) lives in Infrastructure; the studio settings surface adopts it next."),
        "activity": _tab("wired", "Virtualisation action events: simulated, blocked, approval-requested, completed and failed outcomes.",
                         endpoint=ACTIVITY_ENDPOINT, subjects=("virtualization.",)),
    },
))

# --- Plan-named specialist domains ------------------------------------------

_register(_studio(
    studio_id="m365", name="M365 Studio", domain="Microsoft 365",
    product="nexus-identity",
    tagline="Microsoft tenants, consent, token health and audited tenant actions.",
    status="Partially implemented", priority="P1", release="R2",
    owner="Microsoft", home_route="/control-plane?module=microsoft365",
    provider={"name": "microsoft_graph", "state": "partial",
              "reference": "app.services.microsoft_graph_connection"},
    admission=_admission(
        problem="Microsoft estates are managed through scattered portals without client mapping or audit. Outcome: explicit tenant mapping, consent state, token health and audited actions.",
        objects=("identity", "user", "licence", "service"),
        provider_contracts=("microsoft_graph_connection (delegated Graph grant)", "cipp_multi_tenant (control plane)"),
        permissions=("m365.tenant.manage", "entra.user.create", "entra.user.disable",
                     "entra.license.modify", "intune.device.retire"),
        verification_rollback_failure="Token refresh failures mark reauth_required instead of revoking silently; destructive tenant actions are approval-gated and audited.",
        commercial="Licence records feed contract and invoice quantities.",
        release_gate="Microsoft sandbox acceptance (R1 queue item 6) and roadmap Release 2 gate.",
        test_plan="Control-plane and CIPP action tests; tenant isolation tests.",
        documentation="docs/NEXUS_IMPLEMENTATION_ROADMAP.md (Release 2 Microsoft foundation)",
        owner="Microsoft",
    ),
    tabs={
        "inventory": _tab(
            "wired",
            "The observed Microsoft tenants the Control Plane already maps (GET /m365/tenants): "
            "tenant identity and name, reported user count, MFA enrolment percentage and secure "
            "score per mapped tenant. Tenant credentials and tokens are removed server-side and "
            "are not part of this projection.",
            endpoint="/m365/tenants",
            evidence="app.routers.m365",
        ),
    },
))

_register(_studio(
    studio_id="voice", name="Voice Studio", domain="Voice",
    product="nexus-communications",
    tagline="PBXs, extensions, calls, billing and continuity across customer voice estates.",
    status="Partially implemented", priority="P1", release="R3",
    owner="Voice + Finance", home_route="/voice",
    provider={"name": "yeastar_p_series", "state": "wired",
              "reference": "app.services.yeastar (pooled client, interface catalogue)"},
    admission=_admission(
        problem="Voice estates span PBXs, extensions and billing with weak evidence. Outcome: one governed workspace with scoped provider actions and billing recalculation evidence.",
        objects=("service", "user", "invoice", "device"),
        provider_contracts=("yeastar_p_series_openapi (app.services.yeastar)", "yeastar_ycm_fleet"),
        permissions=("voice.pbx.modify", "voice.extension.manage", "voice.billing.recalculate",
                     "voice.recording.listen", "voice.compliance.manage"),
        verification_rollback_failure="Provider interface allow-list; read/write separation; failures map to a failure taxonomy, never silent success.",
        commercial="Voice billing recalculation feeds invoice quantities; call records are evidence, not charges.",
        release_gate="Yeastar vendor sandbox acceptance (R1 queue item 6).",
        test_plan="backend/tests/test_yeastar_client.py, test_voice_service_desk.py.",
        documentation="docs/INTEGRATIONS/YEASTAR_VOICE.md",
        owner="Voice + Finance",
    ),
    tabs={
        "inventory": _tab(
            "wired",
            "The linked voice estate the Voice workspace already holds (GET /yeastar/pbxs): each "
            "PBX with its client mapping, controller URL, enabled/status state, extension and "
            "billable-extension counts and last successful sync. The provider secret is excluded "
            "server-side; the extension counts are the provider's, not a Nexus recount.",
            endpoint="/yeastar/pbxs",
            evidence="app.routers.yeastar",
        ),
    },
))

_register(_studio(
    studio_id="telecom", name="Telecom Studio", domain="Telecom",
    product="nexus-communications",
    tagline="Mobile, internet, SIM/ICCD and ISP billing contracts.",
    status="Architecture required", priority="P2", release="R3",
    owner="Voice + Finance", home_route="/splynx-dashboard",
    provider={"name": "splynx_and_atom", "state": "partial",
              "reference": "ISP operations dashboard; Atom SFTP ingestion (roadmap R3)"},
    admission=None,
    tabs={},
))

_register(_studio(
    studio_id="devices", name="Devices Studio", domain="Endpoint estate",
    product="nexus-endpoint",
    tagline="Managed endpoints: inventory, commands, patches, health and bulk operations.",
    status="Partially implemented", priority="P0", release="R1-R2",
    owner="Agent", home_route="/devices",
    provider={"name": "nexus_agent", "state": "wired", "reference": "Go agent + command trust (app.services.agent_trust)"},
    admission=_admission(
        problem="Endpoint fleets change constantly without a governed control path. Outcome: observed inventory, signed commands and verified outcomes per device.",
        objects=("device", "application", "user"),
        provider_contracts=("nexus_agent_go (command/heartbeat/updater)",),
        permissions=("device.command.execute",),
        verification_rollback_failure="Commands are signed with expiry and replay protection; staged updates carry rollback; agent trust tests cover compromise paths.",
        commercial="Device-backed service lines feed contracts; no direct billing effect.",
        release_gate="Agent trust row: signed artifact and pilot fleet evidence (R1).",
        test_plan="backend/tests/test_nexus_agent_safety.py plus agent Go tests.",
        documentation="agent/README.md",
        owner="Agent",
    ),
    tabs={
        "inventory": _tab(
            "wired",
            "The canonical endpoint estate read through the Devices projection (GET /devices): "
            "name, client, operating system, address, the agent version each endpoint reported "
            "and when it was last observed. Archived (retired) records are excluded.",
            endpoint="/devices",
            evidence="app.routers.devices",
        ),
        "activity": _tab("wired", "Endpoint connection and health events, scoped to your client boundary.",
                         endpoint=ACTIVITY_ENDPOINT, subjects=("device.connected", "device.health.changed")),
    },
))

_register(_studio(
    studio_id="network", name="Network Studio", domain="Network",
    product="nexus-infrastructure",
    tagline="Sites, topology, bandwidth, ISP links and network device posture.",
    status="Partially implemented", priority="P2", release="R4",
    owner="Infrastructure", home_route="/networking",
    provider={"name": "unifi_and_snmp", "state": "partial", "reference": "app.routers.unifi + discovery"},
    admission=_admission(
        problem="Network state lives in vendor dashboards with no canonical topology. Outcome: provenance-carrying topology and posture over canonical network objects.",
        objects=("network", "device", "service"),
        provider_contracts=("unifi_controller (app.routers.unifi)", "snmp_discovery (planned)"),
        permissions=("platform.configuration.manage",),
        verification_rollback_failure="Reads are observed facts with observed_at/source; policy changes stage first (dns.deployment.stage pattern) with rollback notes.",
        commercial="ISP/link services map to contracts; no separate metering yet.",
        release_gate="Network row: enforcement and broad discovery telemetry remain open (R4).",
        test_plan="Network/DNS component and provider route tests.",
        documentation="docs/PLATFORM_PRIORITY_MAP.md (Network and DNS row)",
        owner="Infrastructure",
    ),
    tabs={
        "inventory": _tab(
            "wired",
            "The network sites already registered against controllers (GET /networking/sites): site "
            "and client mapping, controller URL and provider site id, status and location, WAN "
            "address, ISP and the link's advertised up/down speeds. Controller credentials and "
            "tokens are stripped server-side, so this projection is a site register rather than a "
            "viable topology map.",
            endpoint="/networking/sites",
            evidence="app.routers.networking",
        ),
    },
))

_register(_studio(
    studio_id="identity", name="Identity Studio", domain="Identity",
    product="nexus-identity",
    tagline="Entra identity lifecycle: users, roles, credentials, groups and offboarding evidence.",
    status="Partially implemented", priority="P1", release="R2",
    owner="Security + Microsoft", home_route="/identity-threats",
    provider={"name": "entra_id_graph", "state": "partial", "reference": "control-plane Entra actions"},
    admission=_admission(
        problem="Identity changes are high-blast-radius and poorly evidenced. Outcome: permission-gated, approval-gated, audited identity actions with offboarding evidence.",
        objects=("identity", "user"),
        provider_contracts=("entra_graph (control-plane actions)",),
        permissions=("entra.user.create", "entra.user.disable", "entra.role.modify",
                     "entra.credential.reset", "entra.conditional_access.modify"),
        verification_rollback_failure="Offboarding is requested as an audited workflow; destructive identity actions require approval and record outcomes; rollback for role changes is restore-of-prior-role documented per action.",
        commercial="Licence reclamation protects margin; invoices remain the billing authority.",
        release_gate="Microsoft sandbox acceptance (R1 item 6); identity actions stay approval-required until then.",
        test_plan="Entra action permission and control-plane tests.",
        documentation="docs/NEXUS_IMPLEMENTATION_ROADMAP.md",
        owner="Security + Microsoft",
    ),
    tabs={
        "activity": _tab("wired", "Identity offboarding workflow events, scoped to your boundary.",
                         endpoint=ACTIVITY_ENDPOINT, subjects=("user.offboard.requested",)),
    },
))

_register(_studio(
    studio_id="security", name="Security Studio", domain="Security",
    product="nexus-shield",
    tagline="SOC signals, shield posture, containment and threat evidence.",
    status="Partially implemented", priority="P1", release="R4",
    owner="Security", home_route="/security-dashboard",
    provider={"name": "nexus_shield_soc", "state": "partial",
              "reference": "native SOC/Shield services; EDR provider contracts pending"},
    admission=_admission(
        problem="Security signals are scattered and uncorrelated. Outcome: provenance-carrying signals correlated into incidents with containment always policy- and approval-gated.",
        objects=("risk", "incident", "device", "identity"),
        provider_contracts=("nexus_soc_native (feed/realtime)", "endpoint_edr (planned, Release 4)"),
        permissions=("security.containment.approve",),
        verification_rollback_failure="Containment supports simulation and records verification; rollback is a Release 4 gate; no unverified fix is ever claimed.",
        commercial="Security services are contract line items; no separate ledger effect.",
        release_gate="Release 4 gates: containment rollback, incident replay, evidence tamper tests.",
        test_plan="XDR/graph/canary/compliance test suites.",
        documentation="docs/NEXUS_IMPLEMENTATION_ROADMAP.md (Release 4)",
        owner="Security",
    ),
    tabs={
        "inventory": _tab(
            "wired",
            "The persisted security evidence the Security Dashboard already reads "
            "(GET /security-dashboard/overview): endpoint and assessed-endpoint counts, fully "
            "patched and reported patch compliance (null when nothing is assessed), active "
            "threats, canary triggers and the recorded security score, plus the endpoints at risk "
            "and the most recent incidents. Identity threat coverage is reported as unmeasured "
            "because no identity source is configured, never as zero alerts.",
            endpoint="/security-dashboard/overview",
            evidence="app.routers.security_dashboard",
        ),
    },
))

_register(_studio(
    studio_id="backup", name="Backup Studio", domain="Backup",
    product="nexus-recovery",
    tagline="Protected workloads, recovery verification and restore evidence.",
    status="Partially implemented", priority="P0", release="R1, R7",
    owner="Recovery", home_route="/backup-center",
    provider={"name": "nexus_backup_and_acronis", "state": "partial",
              "reference": "native Backup control plane (intent/preflight) + Acronis service"},
    admission=_admission(
        problem="Backups report green without recovery proof. Outcome: protected-workload intent plus verified restore evidence, with gaps disclosed.",
        objects=("backup", "device", "service"),
        provider_contracts=("nexus_backup_control_plane (intent + preflight)", "acronis_cyber_cloud"),
        permissions=("backup.native.view", "backup.native.manage", "backup.native.restore.verify",
                     "backup.native.restore.execute"),
        verification_rollback_failure="Native backup claims nothing it did not observe: preflight fails closed, capture stays lease-bound, restore drills are intent-only until the capture worker lands.",
        commercial="Backup protection maps to contract line items; metering rides usage_meter_events when capture ships.",
        release_gate="Backup build sequence steps 1-2 done; sandbox restore pilot gates production.",
        test_plan="Native backup control-plane, vault verification and agent preflight tests.",
        documentation="docs/NEXUS_IMPLEMENTATION_ROADMAP.md (Nexus Backup build sequence)",
        owner="Recovery",
    ),
    tabs={
        "inventory": _tab(
            "wired",
            "Protected-workload records and the recorded run outcome the Backup dashboard already "
            "computes (GET /backup-dashboard/overview), in the caller's scope. A green row is a "
            "recorded run outcome, never a verified restore, and an unrecorded status is not reported.",
            endpoint="/backup-dashboard/overview",
            evidence="app.routers.backup_center",
        ),
        "activity": _tab("wired", "Failed backup runs reported by protected workloads, scoped to your boundary.",
                         endpoint=ACTIVITY_ENDPOINT, subjects=("backup.job.failed",)),
    },
))

_register(_studio(
    studio_id="cloud", name="Cloud Studio", domain="Cloud",
    product="nexus-infrastructure",
    tagline="Hyperscaler estates, spend and workload posture.",
    status="Discovery required", priority="P2", release="R3",
    owner="Unassigned", home_route=None,
    provider={"name": "none", "state": "planned", "reference": OPEN_ADMISSION_NOTE},
    admission=None,
    tabs={},
))

# --- Remaining specialist workspaces adopting the spine ----------------------

_register(_studio(
    studio_id="service-desk", name="Service Desk Studio", domain="Service desk",
    product="nexus-service",
    tagline="Ticket lifecycle, triage, dispatch, SLA and customer communication.",
    status="Partially implemented", priority="P0", release="R1-R2",
    owner="Service Desk", home_route="/tickets",
    admission=_admission(
        problem="Service work needs one auditable lifecycle from intake to invoice. Outcome: complete ticket lifecycle without leaving Nexus, with handoff and evidence.",
        objects=("incident", "device", "client", "invoice", "change"),
        provider_contracts=("nexus_tickets (native PSA)",),
        permissions=("ticket.lifecycle.transition", "ticket.handoff.manage", "ticket.time.create",
                     "ticket.public_update.send"),
        verification_rollback_failure="Ticket transitions are idempotent and audited; handoffs require acceptance; communications carry delivery evidence.",
        commercial="Ticket time and products feed invoices; the golden ticket-to-invoice workflow is the gate.",
        release_gate="PSA row: golden ticket workflow and delivery proof (R1-R2).",
        test_plan="Ticket workflow, scope and delivery tests across backend/tests.",
        documentation="docs/NEXUS_IMPLEMENTATION_ROADMAP.md (Release 2)",
        owner="Service Desk",
    ),
    tabs={
        "activity": _tab("wired", "Ticket creation events from the scoped platform stream.",
                         endpoint=ACTIVITY_ENDPOINT, subjects=("ticket.created",)),
    },
))

_register(_studio(
    studio_id="finance", name="Finance Studio", domain="Finance",
    product="nexus-commerce",
    tagline="Invoices, payments, reconciliation and revenue protection.",
    status="Partially implemented", priority="P0", release="R1, R3",
    owner="Finance", home_route="/billing-dashboard",
    provider={"name": "stripe_billing", "state": "wired", "reference": "app.services.stripe_checkout + payment links"},
    admission=_admission(
        problem="Revenue leaks through unbilled work and failed reconciliation. Outcome: deterministic quantities, idempotent handoffs and auditable invoices.",
        objects=("invoice", "contract", "subscription"),
        provider_contracts=("stripe_checkout (billing)", "xero_accounting (planned, R3)"),
        permissions=("billing.invoice.create", "billing.invoice.modify", "billing.payment.record"),
        verification_rollback_failure="Invoice/payment handoffs are idempotent with durable audit; provider failure scenarios are part of the golden workflow gate.",
        commercial="Invoices and the ledger are the commercial source of truth; metering is advisory until rated.",
        release_gate="Billing integrity row: golden ticket-to-invoice workflow (R1).",
        test_plan="Golden invoice/payment, split billing, tax/rounding and idempotency tests.",
        documentation="docs/NEXUS_IMPLEMENTATION_ROADMAP.md (Release 1 Billing integrity)",
        owner="Finance",
    ),
    tabs={
        "activity": _tab("wired", "Reconciliation failures reported by the billing pipeline, scoped to your boundary.",
                         endpoint=ACTIVITY_ENDPOINT, subjects=("invoice.reconciliation.failed",)),
    },
))

_register(_studio(
    studio_id="documentation", name="Documentation Studio", domain="Knowledge",
    product="nexus-knowledge",
    tagline="Runbooks, SOPs, network docs and freshness/confidence evidence.",
    status="Partially implemented", priority="P1", release="R2, R5",
    owner="Knowledge", home_route="/documentation-hub",
    admission=_admission(
        problem="Documentation rots and nobody knows which page to trust. Outcome: freshness, confidence and broken-link evidence on every document.",
        objects=("service", "device", "network"),
        provider_contracts=("nexus_knowledge (native)",),
        permissions=(),  # no dedicated action permission yet — legacy module permissions and client scope apply
        scopes_audit_retention=(SCOPES_AUDIT_RETENTION + " Adding a dedicated knowledge action "
                                "permission to the action catalogue is an open admission follow-up "
                                "before any mutating studio tab is wired."),
        verification_rollback_failure="Read-only until the mutation permission lands; version history makes edits revertible.",
        commercial="Documentation sits inside contracted service delivery; no billing effect.",
        release_gate="Documentation row: sanitisation/upload and provenance tests (R2).",
        test_plan="Upload security, knowledge search and workspace-learning tests.",
        documentation="docs/NEXUS_IMPLEMENTATION_ROADMAP.md (Documentation and knowledge)",
        owner="Knowledge",
    ),
    tabs={
        "inventory": _tab(
            "wired",
            "The documentation pages in the caller's scope (GET /documentation): title, category, "
            "whether the page is client-scoped or shared MSP knowledge, its tags and the last "
            "recorded edit. Page bodies are deliberately not part of this projection, and freshness, "
            "confidence and broken-link evidence are not yet assessed rather than assumed.",
            endpoint="/documentation",
            evidence="app.routers.it_docs",
        ),
    },
))

_register(_studio(
    studio_id="automation", name="Automation Studio", domain="Automation",
    product="nexus-automation",
    tagline="Recipes, workflows, simulations and the autonomy ladder with verification.",
    status="Partially implemented", priority="P1", release="R2, R5",
    owner="AI + Automation", home_route="/automation-hub",
    admission=_admission(
        problem="Automations without verification erode trust. Outcome: recipes carry trigger, preconditions, verification and rollback, executed under the same permissions as manual actions.",
        objects=("control", "device", "incident"),
        provider_contracts=("nexus_automation_runtime (native durable runtime)",),
        permissions=("automation.workflow.view", "automation.workflow.simulate",
                     "automation.workflow.approve", "automation.workflow.execute",
                     "automation.autopilot.manage"),
        verification_rollback_failure="Simulation before execution, approval boundaries, compensation runs and dead-letter evidence are built into the runtime.",
        commercial="Time saved is advisory; billable work still flows through time entries.",
        release_gate="AI row: tool authorization and destructive-approval test suites (R2/R5).",
        test_plan="Workflow runtime, simulation, autopilot and compensation tests.",
        documentation="docs/NEXUS_PRODUCT_CONSTITUTION.md (Autonomy contract)",
        owner="AI + Automation",
    ),
    tabs={
        "activity": _tab("wired", "Workflow run lifecycle and approval boundaries, scoped to your boundary.",
                         endpoint=ACTIVITY_ENDPOINT, subjects=("automation.", "autopilot.")),
    },
))

_register(_studio(
    studio_id="compliance", name="Compliance Studio", domain="Compliance",
    product="nexus-shield",
    tagline="Controls, evidence, readiness and change-governance posture.",
    status="Partially implemented", priority="P1", release="R4",
    owner="GRC", home_route="/compliance",
    admission=_admission(
        problem="Compliance claims age out of sync with reality. Outcome: every claim links to retained, fresh evidence with disclosed limitations.",
        objects=("control", "evidence", "risk"),
        provider_contracts=("nexus_evidence_model (operation_evidence + evidence_packs)",),
        permissions=("platform.audit.view", "platform.readiness.view", "confidence.verify"),
        verification_rollback_failure="Verdicts are re-derived from stored checks; stale evidence degrades to partial/unverified rather than passing.",
        commercial="Compliance reporting supports contract obligations; no direct billing effect.",
        release_gate="Compliance row: auditor-grade completeness and retention proof (R4).",
        test_plan="Control mapping, stale evidence, tamper and retention tests.",
        documentation="docs/NEXUS_IMPLEMENTATION_ROADMAP.md (Release 4)",
        owner="GRC",
    ),
    tabs={
        "activity": _tab("wired", "Change-governance and readiness review events, scoped to your boundary.",
                         endpoint=ACTIVITY_ENDPOINT, subjects=("change.guardian", "platform.readiness")),
    },
))

_register(_studio(
    studio_id="agent", name="Agent Studio", domain="Endpoint agent",
    product="nexus-endpoint",
    tagline="Nexus Agent fleet: enrolment, trust, commands, updates and self-healing evidence.",
    status="Partially implemented", priority="P0", release="R1-R2",
    owner="Agent", home_route="/nexus-agent",
    provider={"name": "nexus_agent_go", "state": "wired", "reference": "agent/internal (trust, heartbeat, updater, selfheal)"},
    admission=_admission(
        problem="A fleet agent is privileged code on customer machines. Outcome: unique identity, signed commands with expiry/replay protection, staged updates with rollback.",
        objects=("device", "identity"),
        provider_contracts=("nexus_agent_go (signed command/update channel)",),
        permissions=("agent.trust.remediate",),
        verification_rollback_failure="Compromised/replayed command tests, staged signed update and rollback drill are the release gate; self-heal evidence is sanitised and bounded.",
        commercial="Agent is included in managed service contracts; no direct billing effect.",
        release_gate="Agent trust row: Windows pilot artifact signed + rollback drill (R1).",
        test_plan="backend/tests/test_nexus_agent_safety.py, test_agent_self_heal.py; agent Go tests.",
        documentation="docs/AGENT_SELF_HEALING.md",
        owner="Agent",
    ),
    tabs={
        "inventory": _tab(
            "wired",
            "The enrolled agent fleet the trust projection serves (GET /nexus-agent/agents): "
            "hostname, client, identity transport, policy version, self-repair state and the "
            "derived trust status, most recently seen first. No token or key material is returned.",
            endpoint="/nexus-agent/agents",
            evidence="app.routers.nexus_agent",
        ),
        "activity": _tab("wired", "Agent trust, certificate and policy changes, scoped to your boundary.",
                         endpoint=ACTIVITY_ENDPOINT, subjects=("device.trust.changed", "device.identity.issued")),
    },
))

_register(_studio(
    studio_id="patch", name="Patch Studio", domain="Patching",
    product="nexus-endpoint",
    tagline="Patch cycles, compliance posture and remediation evidence.",
    status="Partially implemented", priority="P1", release="R1-R2",
    owner="Agent", home_route="/patch-tuesday",
    provider={"name": "nexus_agent_winget", "state": "wired", "reference": "agent appupdate (scan/apply evidence)"},
    admission=_admission(
        problem="Patch state is claimed from policy, not observed. Outcome: endpoint-reported scan evidence with per-package apply results and stale-evidence disclosure.",
        objects=("device", "application"),
        provider_contracts=("nexus_agent_appupdate (winget scan/apply)",),
        permissions=("device.command.execute",),
        verification_rollback_failure="Apply is a normal audited agent command; automatic install is fail-closed and policy-gated inside maintenance windows.",
        commercial="Patch management is a contracted service line; no separate metering.",
        release_gate="Application update row: elevated Windows pilot evidence open.",
        test_plan="Backend/tests/test_agent_app_updates.py parser/argument/policy/evidence tests.",
        documentation="backend/tests/test_agent_app_updates.py",
        owner="Agent",
    ),
    tabs={
        "inventory": _tab(
            "wired",
            "Observed endpoint patch state (GET /patch-compliance/overview): the assessed/reporting "
            "counts, the projection's own compliance percentage (null when nothing has been "
            "assessed, never 0%) and each reporting endpoint's ring, pending count, verdict and "
            "observation time. Only endpoints the signed agent has reported on appear, and the "
            "projection carries no CVSS severity, so it never labels a pending update critical.",
            endpoint="/patch-compliance/overview",
            evidence="app.routers.patch_compliance",
        ),
    },
))

_register(_studio(
    studio_id="dns", name="DNS Studio", domain="DNS",
    product="nexus-infrastructure",
    tagline="Resolver policy, blocking evidence and DNS deployment control.",
    status="Partially implemented", priority="P2", release="R4",
    owner="Infrastructure", home_route="/dns-monitor",
    provider={"name": "nexus_dns_resolver", "state": "partial", "reference": "dns_monitor + synergy_wholesale DNS"},
    admission=_admission(
        problem="DNS changes are both high-impact and high-value. Outcome: staged deployment, emergency disable with audit, and resolver-attested blocking evidence.",
        objects=("network", "service"),
        provider_contracts=("nexus_dns_resolver (dns_monitor)", "synergy_wholesale_dns (wired verb)"),
        permissions=("dns.policy.modify", "dns.deployment.stage", "dns.emergency.disable",
                     "dns.exception.create"),
        verification_rollback_failure="Policy deploys stage first; emergency disable is a named audited action; blocked queries are resolver-attested events.",
        commercial="DNS filtering is a sellable service line on the contract.",
        release_gate="DNS row: policy simulation/canary and bypass tests (R4).",
        test_plan="DNS policy, rollout and bypass tests.",
        documentation="docs/PLATFORM_PRIORITY_MAP.md (Network and DNS)",
        owner="Infrastructure",
    ),
    tabs={
        "activity": _tab("wired", "Resolver-attested blocked queries, scoped to your boundary.",
                         endpoint=ACTIVITY_ENDPOINT, subjects=("dns.query.blocked",)),
    },
))

_register(_studio(
    studio_id="monitoring", name="Monitoring Studio", domain="Monitoring",
    product="nexus-observability",
    tagline="Health signals, alert rules and provider-verified readiness.",
    status="Partially implemented", priority="P0", release="R1",
    owner="Platform Operations", home_route="/nexus-pulse",
    provider={"name": "prometheus_alerting", "state": "partial",
              "reference": "observability stack + app/routers/alert_rules"},
    admission=_admission(
        problem="Alerts without ownership or verification create noise. Outcome: named owners, verified provider health and dead-letter/queue evidence.",
        objects=("device", "service", "control"),
        provider_contracts=("prometheus_alertmanager (observability)", "nexus_alert_rules (native)"),
        permissions=("platform.readiness.view", "platform.events.view"),
        verification_rollback_failure="Alert delivery failures alert the named owner; configured-but-unverified providers raise NexusProviderUnverified.",
        commercial="Monitoring is part of managed service contracts; no separate metering.",
        release_gate="Reliability row: deployed firing/resolved acknowledgement drill (R1).",
        test_plan="Observability contract tests and alert-rule tests.",
        documentation="docs/OBSERVABILITY_RUNBOOK.md",
        owner="Platform Operations",
    ),
    tabs={
        "activity": _tab("wired", "Provider connection-health changes from the platform stream.",
                         endpoint=ACTIVITY_ENDPOINT, subjects=("connector.health.changed",)),
    },
))

_register(_studio(
    studio_id="communications", name="Communications Studio", domain="Communications",
    product="nexus-communications",
    tagline="Client email, notifications, CSAT/NPS and delivery evidence.",
    status="Partially implemented", priority="P1", release="R2",
    owner="Experience", home_route="/email",
    provider={"name": "notification_channels", "state": "partial",
              "reference": "email delivery log + notification channels"},
    admission=_admission(
        problem="Customer communication is scattered and unproven. Outcome: client-linked outbound records with delivery evidence and retained correspondence truth.",
        objects=("incident", "user", "evidence"),
        provider_contracts=("email_delivery_log (Nexus outbound)", "notification_channels"),
        permissions=("ticket.public_update.send",),
        verification_rollback_failure="Only saved drafts can be dispatched (replay-safe); delivery state is recorded per message; failures are visible, not silent.",
        commercial="Communications support contracted service delivery; no billing effect.",
        release_gate="PSA row: external delivery proof (R1-R2).",
        test_plan="Email/quarantine/delivery tests in the backend gate.",
        documentation="docs/DATA_OWNERSHIP.md (client communications ledger)",
        owner="Experience",
    ),
    tabs={
        "inventory": _tab(
            "wired",
            "Recorded customer feedback (GET /csat/dashboard): responses recorded, the average "
            "score with the per-client and per-technician response counts behind it, and the score "
            "distribution the survey data reports. The endpoint's zero-responses payload is read "
            "as \"nobody answered\", never as a zero score.",
            endpoint="/csat/dashboard",
            evidence="app.routers.csat_surveys",
        ),
    },
))


# --- The three foundations (docs/NEXUS_FOUNDATIONS_BATCH_4.md) ---------------

_register(_studio(
    studio_id="customer-environment", name="Customer Environment Studio", domain="Customer context",
    product="nexus-service",
    tagline="One customer's whole operating environment: estate, evidence, open work and what just changed.",
    status="Partially implemented", priority="P1", release="R2",
    owner="Experience + Platform", home_route="/customer-environment",
    admission=_admission(
        problem=("Customer context is spread across devices, websites, contracts, tickets and "
                 "changes. Outcome: one customer-scoped view that correlates authorised evidence "
                 "and answers 'what changed, and could it explain today's tickets'."),
        objects=("client", "device", "service", "incident", "change", "application"),
        provider_contracts=("nexus_native (canonical client records)",),
        permissions=("platform.audit.view", "platform.events.view"),
        verification_rollback_failure=("Read-only projection: no writes, so nothing to roll back. "
                                       "A dimension that was not measured is disclosed with its "
                                       "reason, and a correlation is only ever a candidate built "
                                       "from a change that precedes a ticket and shares an "
                                       "identified target — never a claim of cause."),
        commercial="The view is evidence, not a commercial record; contracts and invoices remain the source of truth.",
        release_gate="Foundation 1 of 3; catalogued studios 93/98 remain gated in docs/NEXUS_FOUNDATIONS_BATCH_4.md.",
        test_plan="backend/tests/test_customer_environment.py (dimension disclosure, correlation, scope).",
        documentation="docs/NEXUS_FOUNDATIONS_BATCH_4.md",
        owner="Experience + Platform",
    ),
    tabs={
        "inventory": _tab("wired", "Every customer in scope with the six disclosed environment counts.",
                          endpoint="/customer-environment/summary",
                          evidence="backend/app/routers/customer_environment.py"),
        "activity": _tab("wired", "Cross-domain events relevant to a customer's environment, scoped to your boundary.",
                         endpoint=ACTIVITY_ENDPOINT,
                         subjects=("ticket.created", "device.health.changed", "connector.health.changed")),
        "diagnostics": _planned("The change/ticket correlation reads GET /customer-environment/{clientId}/investigation; "
                                "the per-customer studio surface adopts it next."),
    },
))

_register(_studio(
    studio_id="operations-assurance", name="Operations Assurance Studio", domain="Assurance",
    product="nexus-service",
    tagline="Did the promised operational outcome happen — evaluated from evidence, never inferred.",
    status="Partially implemented", priority="P1", release="R2",
    owner="Platform Operations", home_route="/operations-assurance",
    admission=_admission(
        problem=("Monitoring reports that jobs ran, not that the customer's promised outcome was "
                 "achieved. Outcome: each promise is evaluated against recorded evidence and gaps "
                 "are named, with an unmeasured promise disclosed rather than shown as met."),
        objects=("backup", "service", "identity", "device"),
        provider_contracts=("nexus_native (evidence from owned collections)",),
        permissions=("platform.readiness.view", "confidence.verify"),
        verification_rollback_failure=("Read-only evaluation: no writes. Each commitment returns "
                                       "met/at_risk/breached/not_measured with the reason and the "
                                       "evidence source; a commitment with no recorded evidence is "
                                       "reported not_measured, never met."),
        commercial="Assurance supports contract obligations and retention; billing is unaffected.",
        release_gate="Foundation 2 of 3; the departed-access evidence source is the named gate in docs/NEXUS_FOUNDATIONS_BATCH_4.md.",
        test_plan="backend/tests/test_operations_assurance.py (per-commitment states, no-evidence disclosure, scope).",
        documentation="docs/NEXUS_FOUNDATIONS_BATCH_4.md",
        owner="Platform Operations",
    ),
    tabs={
        "inventory": _tab("wired", "The promises this studio evaluates and the evidence each one needs.",
                          endpoint="/operations-assurance/contract",
                          evidence="backend/app/routers/operations_assurance.py"),
        "diagnostics": _tab("wired", "Each promised outcome evaluated against recorded, scoped evidence with its gaps.",
                            endpoint="/operations-assurance/commitments",
                            evidence="backend/app/routers/operations_assurance.py"),
        "activity": _tab("wired", "Readiness review and confidence verification events, scoped to your boundary.",
                         endpoint=ACTIVITY_ENDPOINT,
                         subjects=("platform.readiness.reviewed", "confidence.assessment.verified")),
    },
))

_register(_studio(
    studio_id="extension", name="Extension Studio", domain="Ecosystem",
    product="nexus-platform",
    tagline="A governed manifest contract for adding Nexus-native capability without editing core.",
    status="Partially implemented", priority="P2", release="R6",
    owner="Platform Ecosystem", home_route="/extension-studio",
    admission=_admission(
        problem=("Every new capability today means changing core, which cannot scale. Outcome: an "
                 "extension manifest is checked against the routes Nexus actually serves, the "
                 "permission catalogue and a declared isolation/verification/rollback plan "
                 "before anyone reviews it."),
        objects=("control", "evidence"),
        provider_contracts=("nexus_native (served route catalogue + action permission catalogue)",),
        permissions=("platform.configuration.manage", "platform.readiness.view"),
        verification_rollback_failure=("Review only: the endpoint persists nothing, builds nothing, "
                                       "signs nothing and executes nothing. Twelve disclosed checks "
                                       "return pass/needs_review/fail with their reason; a wildcard "
                                       "permission, an unresolved capability, a credential-shaped "
                                       "data class or an unsigned distributed manifest is refused."),
        commercial="Extension distribution is not commercialised yet; marketplace distribution is deferred with a named gate.",
        release_gate=("Foundation 3 of 3. Signing infrastructure, a review authority, isolated "
                      "execution and marketplace distribution remain the named gates in "
                      "docs/NEXUS_FOUNDATIONS_BATCH_4.md before any extension can be distributed."),
        test_plan="backend/tests/test_extension_studio.py (per-check verdicts, refuses, contract).",
        documentation="docs/NEXUS_FOUNDATIONS_BATCH_4.md",
        owner="Platform Ecosystem",
    ),
    tabs={
        "inventory": _tab("wired", "Capabilities a manifest may declare, grounded in the routes this Nexus serves.",
                          endpoint="/extensions/capabilities",
                          evidence="backend/app/routers/extension_studio.py"),
        "settings": _tab("wired", "The manifest contract: kinds, distributions, data classes and required fields.",
                         endpoint="/extensions/contract",
                         evidence="backend/app/routers/extension_studio.py"),
        "activity": _planned("No extension-specific platform subject is registered yet, so this tab "
                             "discloses that instead of showing an empty stream that looks like silence."),
    },
))


# --- Batch 5 studios admitted once the fleet-baseline gate was cleared -------
#
# Both of these waited on the same gate: "a baseline exists per endpoint and
# nothing compares a device against the fleet". The projection in
# ``app.services.fleet_baseline`` is that comparison, so the gate is recorded as
# cleared rather than deferred (``app.services.studio_proposals``) and these two
# are admitted reading it. They stay ``Partially implemented``: comparing two
# operating systems is not the same as having built the per-platform
# specialisation, and turning a deviation into work is a change *request* raised
# through Change Management (``app.routers.fleet_baseline``), not a repair these
# studios perform.

_register(_studio(
    studio_id="windows", name="Windows Studio", domain="Windows estate",
    product="nexus-endpoint",
    tagline="Why this Windows endpoint differs from the rest of the estate, measured "
            "against the estate's own endpoints rather than a vendor profile.",
    status="Partially implemented", priority="P1", release="R2",
    owner="Platform + Experience", home_route="/fleet-baseline?platform=windows",
    provider={"name": "nexus_agent", "state": "partial",
              "reference": "usage metrics reported on the device record plus the "
                           "agent's learned self-heal performance band "
                           "(agent/internal/selfheal/perf.go)"},
    admission=_admission(
        problem=("A technician opening a slow Windows endpoint cannot say whether it is "
                 "slow for this estate or slow in absolute terms, so triage starts from "
                 "opinion. Outcome: every Windows endpoint is compared against the "
                 "measured median of the caller's own Windows cohort, with the "
                 "deviation, its size and the number of endpoints behind it named — and "
                 "a cohort too small to define a baseline says so instead of grading "
                 "anyone."),
        objects=("device", "telemetry", "service"),
        provider_contracts=(
            "nexus_agent heartbeat (cpu/memory/disk usage and the learned self-heal "
            "performance band)",
        ),
        permissions=("platform.readiness.view",),
        verification_rollback_failure=(
            "The reads write nothing. A metric nobody reported is null with its reason "
            "rather than 0; a cohort below five measured endpoints returns "
            "cohort_not_established rather than a verdict; a device with no reported "
            "metric is not_measured, never healthy; and every response carries the "
            "boundary that a deviation is a difference from the estate's median, not a "
            "fault. The automation tab raises a change request from a shape and "
            "executes nothing: it needs platform.readiness.manage and a global client "
            "scope, it refuses a shape the recurrence view does not report, and it "
            "refuses to raise a second change for a shape that already has one open. "
            "The request carries what would verify the repair and what would undo it, "
            "and the technician who raised it cannot approve it."),
        commercial="No separate ledger: comparing an endpoint against the estate is part "
                   "of the managed endpoint service already sold per device.",
        release_gate="P1 #108. The fleet-baseline gate is cleared and cites "
                     "app/services/fleet_baseline.py in app/services/studio_proposals.py; "
                     "the macOS and Linux views it would extend to stay gated on "
                     "agent-platform-parity. Raising a deviation as a change request is "
                     "registered (app/services/fleet_change_proposal.py); choosing and "
                     "applying a repair recipe is not.",
        test_plan="backend/tests/test_fleet_baseline.py (cohort thresholds, unmeasured "
                  "metrics, deviation verdicts, recurrence).",
        documentation="docs/NEXUS_INVENT_BATCH_5.md",
        owner="Platform + Experience",
    ),
    tabs={
        "inventory": _tab(
            "wired",
            "The caller's own Windows cohort and what it measured: device count, how "
            "many endpoints reported each metric, the median and the spread, plus the "
            "minimum cohort size and deviation thresholds the verdicts use.",
            endpoint="/fleet-baseline/contract",
            evidence="app.routers.fleet_baseline",
        ),
        "diagnostics": _tab(
            "wired",
            "Every Windows endpoint against its cohort's baseline, worst verdict first, "
            "with the deviation, its basis and the endpoints behind the median. An "
            "unmeasured metric is listed as unmeasured rather than as a clean result.",
            endpoint="/fleet-baseline/cohorts/{platform}/deviations",
            # The studio's own cohort: a Windows studio that silently read whatever
            # cohort happened to be largest would be explaining a different estate.
            params={"platform": "windows"},
            evidence="app.routers.fleet_baseline",
        ),
        "automation": _tab(
            "wired",
            "Acting on a deviation as *proposed work*: a repair recipe chosen from a "
            "shape, raised as a change request with the shape's own evidence, a "
            "verification step and a rollback statement, then approved and tracked "
            "through Change Management. Nexus executes nothing here — the approval, "
            "implementation and rollback lifecycle belongs to the change record.",
            endpoint="/fleet-baseline/cohorts/{platform}/proposed-changes",
            params={"platform": "windows"},
            evidence="app.routers.fleet_baseline",
            subjects=("endpoint.deviation.change.proposed",),
        ),
    },
))

_register(_studio(
    studio_id="endpoint-performance", name="Endpoint Performance Studio",
    domain="Endpoint performance",
    product="nexus-endpoint",
    tagline="The performance shapes more than one endpoint shares, counted from the "
            "same deviations the per-device view returns.",
    status="Partially implemented", priority="P1", release="R2",
    owner="Platform + Observability",
    home_route="/fleet-baseline?view=recurrence",
    provider={"name": "nexus_agent", "state": "partial",
              "reference": "learned per-endpoint performance evidence on the device "
                           "record, grouped by operating-system cohort"},
    admission=_admission(
        problem=("Recurring endpoint degradation is found ticket by ticket, so the same "
                 "fault is diagnosed repeatedly as separate incidents. Outcome: "
                 "performance shapes shared by more than one endpoint in a cohort are "
                 "counted from the deviation evidence, so a recurring problem is visible "
                 "before it has been raised as work — and the count is derived from the "
                 "same deviations the per-device view shows, so the two cannot "
                 "disagree."),
        objects=("device", "telemetry", "incident"),
        provider_contracts=(
            "nexus_agent heartbeat (usage metrics and learned performance band); "
            "nexus_native deviation evidence",
        ),
        permissions=("platform.readiness.view",),
        verification_rollback_failure=(
            "The reads write nothing. A shape needs at least two endpoints before it is "
            "reported as shared — one machine's bad day is not a recurring problem — and "
            "it is counted from the same deviations the per-device view returns, so the "
            "recurrence count can never claim evidence the deviation view does not "
            "carry. A cohort without an established baseline produces no shapes and says "
            "why. A shape raises a change request rather than a ticket, and raises "
            "nothing at all: the shape is evidence, the request is reviewed by someone "
            "other than its author, and no endpoint is touched."),
        commercial="No separate ledger: recurring-shape evidence improves the endpoint "
                   "service already sold per device rather than adding a line item.",
        release_gate="P1 #111. The fleet-baseline gate is cleared (see "
                     "app/services/studio_proposals.py); raising a shape as a proposed "
                     "change is registered in app/services/fleet_change_proposal.py and "
                     "approved through Change Management, while choosing and applying a "
                     "repair remains unbuilt and is disclosed as such.",
        test_plan="backend/tests/test_fleet_baseline.py (recurrence counts, the "
                  "two-endpoint minimum, no shapes without a baseline).",
        documentation="docs/NEXUS_INVENT_BATCH_5.md",
        owner="Platform + Observability",
    ),
    tabs={
        "inventory": _tab(
            "wired",
            "The cohorts this estate can compare at all, with the metric list, minimum "
            "cohort size and deviation thresholds disclosed so a shape can be "
            "reproduced by hand.",
            endpoint="/fleet-baseline/contract",
            evidence="app.routers.fleet_baseline",
        ),
        "diagnostics": _tab(
            "wired",
            "Shapes more than one endpoint in a cohort shares — metric, direction, "
            "verdict, how many endpoints show it and the median they deviate from — "
            "ordered by how widespread each one is. Read for the Windows cohort, "
            "which is the cohort the agent reports today; each cohort is read "
            "separately rather than pooled into one shape.",
            endpoint="/fleet-baseline/cohorts/{platform}/recurrence",
            params={"platform": "windows"},
            evidence="app.routers.fleet_baseline",
        ),
        "changes": _tab(
            "wired",
            "Each recurring shape and the change request it would raise, with the "
            "refusals disclosed: a shape the recurrence view does not report has no "
            "row, and a shape with an open change names that change instead of "
            "proposing a second. Nothing here changes a device — raising the change "
            "needs platform.readiness.manage, and the request is then approved "
            "independently through Change Management.",
            endpoint="/fleet-baseline/cohorts/{platform}/proposed-changes",
            params={"platform": "windows"},
            evidence="app.routers.fleet_baseline",
            subjects=("endpoint.deviation.change.proposed",),
        ),
    },
))


# ============== PUBLIC API ==============


def product_catalogue() -> list[dict]:
    """The declared products, in declaration order, with the studios they hold.

    Emitted from the declaration rather than from the studios so a product with
    no admitted studio yet still appears (with an empty ``studios`` list) once it
    is declared — an empty product is a plan, and saying so is honest.

    Each product also carries the consolidated catalogue: ``planned_studios`` is
    the proposed studios it is intended to hold, and ``proposals`` is every
    catalogue idea filed under it with the disposition the consolidation gave it.
    A product with no proposal left to build is the honest result of a merge, so
    it is disclosed as such rather than padded with a name.
    """
    catalogue = []
    for product in PRODUCTS.values():
        studios = [s["id"] for s in STUDIOS.values() if s["product"] == product["id"]]
        proposals = studio_proposals.proposals_for_product(product["id"])
        catalogue.append({
            "id": product["id"],
            "name": product["name"],
            "tagline": product["tagline"],
            "tier": product["tier"],
            "tier_label": TIERS[product["tier"]]["label"],
            "studios": studios,
            "count": len(studios),
            "planned_studios": list(product["planned_studios"]),
            "proposals": proposals,
            "proposal_count": len(proposals),
        })
    return catalogue


def tier_rollup() -> list[dict]:
    """The three tiers with what each currently holds, in declaration order.

    Emitted from the tier declaration, so a tier with no product is disclosed as
    empty rather than omitted, and a consumer cannot invent a fourth one.
    """
    catalogue = product_catalogue()
    return [
        {
            "id": tier["id"],
            "label": tier["label"],
            "blurb": tier["blurb"],
            "products": [
                product["id"] for product in catalogue if product["tier"] == tier["id"]
            ],
            "studio_count": sum(
                product["count"] for product in catalogue if product["tier"] == tier["id"]
            ),
            "planned_count": sum(
                len(product["planned_studios"])
                for product in catalogue
                if product["tier"] == tier["id"]
            ),
        }
        for tier in TIERS.values()
    ]


def list_studios() -> dict:
    """Fleet overview: one honest row per registered studio."""
    rows = []
    for studio in STUDIOS.values():
        wired = [tab for tab, spec in studio["tabs"].items() if spec["state"] == "wired"]
        rows.append({
            "id": studio["id"],
            "name": studio["name"],
            "domain": studio["domain"],
            "product": studio["product"],
            "product_name": PRODUCTS[studio["product"]]["name"],
            "tier": PRODUCTS[studio["product"]]["tier"],
            "tier_label": TIERS[PRODUCTS[studio["product"]]["tier"]]["label"],
            "tagline": studio["tagline"],
            "status": studio["status"],
            "priority": studio["priority"],
            "release": studio["release"],
            "owner": studio["owner"],
            "home_route": studio["home_route"],
            "provider": studio["provider"],
            "spine": studio["spine"],
            "tab_states": {tab: spec["state"] for tab, spec in studio["tabs"].items()},
            "wired_tabs": wired,
            "admission_state": (studio["admission"] or {}).get("state", "open"),
        })
    return {
        "registry_version": REGISTRY_VERSION,
        "spine": [
            {"id": tab, "label": TAB_META[tab]["label"], "purpose": TAB_META[tab]["purpose"]}
            for tab in SPINE_TABS
        ],
        "products": product_catalogue(),
        "tiers": tier_rollup(),
        "studios": rows,
        "count": len(rows),
        "summary": {
            "total": len(rows),
            "by_status": {
                status: sum(1 for row in rows if row["status"] == status)
                for status in sorted({row["status"] for row in rows})
            },
            "by_product": {
                product["id"]: product["count"] for product in product_catalogue()
            },
            "by_tier": {
                tier["id"]: tier["studio_count"] for tier in tier_rollup()
            },
        },
        "note": (
            "Static capability contract: statuses and tab states are admission-gate "
            "evidence, not live health. Wired tabs name the endpoint they read."
        ),
        "product_note": PRODUCT_NOTE,
        "proposal_note": studio_proposals.PROPOSAL_NOTE,
        "tier_note": TIER_NOTE,
    }


def get_studio(studio_id: str) -> dict | None:
    """One studio's full contract, or None when it is not part of the fleet."""
    studio = STUDIOS.get(str(studio_id or "").strip().lower())
    if not studio:
        return None
    contract = dict(studio)
    contract["registry_version"] = REGISTRY_VERSION
    contract["tier"] = PRODUCTS[studio["product"]]["tier"]
    contract["tier_label"] = TIERS[contract["tier"]]["label"]
    contract["tabs"] = {tab: dict(spec) for tab, spec in studio["tabs"].items()}
    return contract


# The consolidation is validated once, against the fleet that actually exists,
# so an inconsistent catalogue fails the process that imports it instead of a
# screen that renders it. The same function is called directly in the tests.
studio_proposals.validate(
    studio_products={s["id"]: s["product"] for s in STUDIOS.values()},
    product_ids=frozenset(PRODUCTS),
)
