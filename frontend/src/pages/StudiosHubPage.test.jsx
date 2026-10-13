/* eslint-disable testing-library/no-unnecessary-act -- Native React createRoot requires act. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";

import StudiosHubPage from "./StudiosHubPage";
import StudioShell from "../components/studios/StudioShell";

jest.mock("axios", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock("@/App", () => ({ __esModule: true, API: "http://api.test/api", useAuth: () => ({ token: "session-token" }) }), { virtual: true });
jest.mock("@/lib/apiErrorMessage", () => jest.requireActual("../lib/apiErrorMessage"), { virtual: true });
// Same reason: the `@` alias has no jest mapping, so the page's product-grouping
// import resolves through the real module rather than a stand-in.
jest.mock("@/lib/studioProducts", () => jest.requireActual("../lib/studioProducts"), { virtual: true });
// The fleet-baseline tabs are rendered by the studio panel, so the shell's
// routing to it is real behaviour here rather than a stand-in.
jest.mock("@/components/studios/FleetBaselinePanel", () => jest.requireActual("../components/studios/FleetBaselinePanel"), { virtual: true });
jest.mock("@/components/fleet/FleetBaselineKit", () => jest.requireActual("../components/fleet/FleetBaselineKit"), { virtual: true });
// Same alias problem, one level deeper: the shell imports the observation kit
// and one panel per adopted projection, so each of those specifiers has to
// resolve here even though this suite is about the hub and the shell's routing.
// The kit is real because it owns the endpoint→panel decision the shell makes;
// the panels are stubs because their own disclosures are covered in
// `components/studios/StudioObservationPanels.test.jsx`, and a real panel would
// add its endpoint to this file's axios expectations.
jest.mock("@/components/studios/StudioObservationKit", () => jest.requireActual("../components/studios/StudioObservationKit"), { virtual: true });
jest.mock("@/components/studios/AgentFleetPanel", () => ({ __esModule: true, default: () => <div data-testid="agent-fleet-panel" /> }), { virtual: true });
jest.mock("@/components/studios/BackupRecoveryPanel", () => ({ __esModule: true, default: () => <div data-testid="backup-recovery-panel" /> }), { virtual: true });
jest.mock("@/components/studios/ClientEstatePanel", () => ({ __esModule: true, default: () => <div data-testid="client-estate-panel" /> }), { virtual: true });
jest.mock("@/components/studios/CommunicationsPanel", () => ({ __esModule: true, default: () => <div data-testid="communications-csat-panel" /> }), { virtual: true });
jest.mock("@/components/studios/DeviceEstatePanel", () => ({ __esModule: true, default: () => <div data-testid="device-estate-panel" /> }), { virtual: true });
jest.mock("@/components/studios/DocumentationInventoryPanel", () => ({ __esModule: true, default: () => <div data-testid="documentation-inventory-panel" /> }), { virtual: true });
jest.mock("@/components/studios/LeadPipelinePanel", () => ({ __esModule: true, default: () => <div data-testid="lead-pipeline-panel" /> }), { virtual: true });
jest.mock("@/components/studios/M365TenantPanel", () => ({ __esModule: true, default: () => <div data-testid="m365-tenants-panel" /> }), { virtual: true });
jest.mock("@/components/studios/NetworkSitesPanel", () => ({ __esModule: true, default: () => <div data-testid="network-sites-panel" /> }), { virtual: true });
jest.mock("@/components/studios/PatchPosturePanel", () => ({ __esModule: true, default: () => <div data-testid="patch-posture-panel" /> }), { virtual: true });
jest.mock("@/components/studios/SecurityPosturePanel", () => ({ __esModule: true, default: () => <div data-testid="security-posture-panel" /> }), { virtual: true });
jest.mock("@/components/studios/VoiceEstatePanel", () => ({ __esModule: true, default: () => <div data-testid="voice-estate-panel" /> }), { virtual: true });
jest.mock("@/components/studios/WebEstatePanel", () => ({ __esModule: true, default: () => <div data-testid="web-estate-panel" /> }), { virtual: true });
// The alias has no jest mapping. The tabs stand-in is a faithful controlled
// implementation: a trigger activates its panel, an inactive panel unmounts —
// so the shell's switching, per-tab fetches and disclosures are real behaviour.
jest.mock("@/components/ui/tabs", () => {
  const React = require("react");
  const Ctx = React.createContext(null);
  return {
    Tabs: ({ value, onValueChange, children }) => (
      <Ctx.Provider value={{ value, onValueChange }}>{children}</Ctx.Provider>
    ),
    TabsList: ({ children, ...props }) => <div role="tablist" {...props}>{children}</div>,
    TabsTrigger: ({ value, children, ...props }) => {
      const ctx = React.useContext(Ctx);
      const select = () => ctx.onValueChange(value);
      return (
        <button
          type="button"
          role="tab"
          aria-selected={ctx.value === value}
          onMouseDown={select}
          onClick={select}
          {...props}
        >
          {children}
        </button>
      );
    },
    TabsContent: ({ value, children, ...props }) => {
      const ctx = React.useContext(Ctx);
      if (ctx.value !== value) return null;
      return <div role="tabpanel" {...props}>{children}</div>;
    },
  };
}, { virtual: true });
jest.mock("@/components/OperationalPageHeader", () => ({
  __esModule: true,
  default: ({ title, description, eyebrow, actions }) => (
    <header>
      {eyebrow ? <p data-testid="header-eyebrow">{eyebrow}</p> : null}
      <h1>{title}</h1>
      {description ? <p data-testid="header-description">{description}</p> : null}
      {actions}
    </header>
  ),
}), { virtual: true });
jest.mock("@/components/ui/card", () => ({
  Card: ({ children, className, ...props }) => <section className={className} {...props}>{children}</section>,
  CardContent: ({ children, className, ...props }) => <div className={className} {...props}>{children}</div>,
}), { virtual: true });
jest.mock("@/components/ui/badge", () => ({
  Badge: ({ children, className, ...props }) => <span className={className} {...props}>{children}</span>,
}), { virtual: true });
jest.mock("@/components/ui/button", () => ({
  Button: ({ children, asChild, ...props }) => (asChild ? <span>{children}</span> : <button type="button" {...props}>{children}</button>),
}), { virtual: true });
jest.mock("@/components/ui/table", () => ({
  Table: ({ children, ...props }) => <table {...props}>{children}</table>,
  TableBody: ({ children }) => <tbody>{children}</tbody>,
  TableCell: ({ children, className }) => <td className={className}>{children}</td>,
  TableHead: ({ children }) => <th>{children}</th>,
  TableHeader: ({ children }) => <thead>{children}</thead>,
  TableRow: ({ children, ...props }) => <tr {...props}>{children}</tr>,
}), { virtual: true });
// The tabs stay REAL (Radix) so the test exercises actual tab switching.

const BASE = "http://api.test/api";
const SPINE = ["overview", "inventory", "administration", "diagnostics", "changes", "automation", "security", "activity", "settings"];

const FLEET = {
  registry_version: "1.0",
  spine: SPINE.map((id) => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1), purpose: "" })),
  count: 4,
  note: "Static capability contract.",
  product_note: "Products are the navigation boundary.",
  proposal_note: "Every catalogue idea is recorded once with one disposition.",
  products: [
    {
      id: "nexus-infrastructure", name: "Nexus Infrastructure",
      tagline: "Virtualisation, network and cloud resources.",
      studios: ["proxmox", "cloud"], count: 2, planned_studios: ["connectivity-diagnostics"],
      proposal_count: 3,
      proposals: [
        {
          id: "connectivity-diagnostics", title: "Connectivity Diagnostics Studio",
          product: "nexus-infrastructure", disposition: "studio",
          disposition_label: "Proposed studio",
          gates: [{ id: "authorised-network-probes", title: "Authorised network observation points" }],
          merges_into: null, already_exists_at: null, covers: ["dns-propagation-lab"],
          note: "Both batches need an authorised probe at each observation point.",
        },
        {
          id: "port-historian", title: "Nexus Port Historian",
          product: "nexus-infrastructure", disposition: "studio",
          disposition_label: "Proposed studio",
          gates: [{ id: "switch-port-inventory", title: "Switch port and VLAN inventory" }],
          merges_into: null, already_exists_at: null, covers: [], note: null,
        },
        {
          id: "device-state-checks", title: "Declared-state checks",
          product: "nexus-infrastructure", disposition: "served",
          disposition_label: "Already served", gates: [], merges_into: null,
          already_exists_at: "backend/app/services/nexus_device_state.py",
          covers: [], note: "Desired state and drift are reported today.",
        },
      ],
    },
    {
      id: "nexus-build", name: "Nexus Build", tagline: "Build and release.",
      studios: ["web"], count: 1, planned_studios: ["devops"], proposal_count: 3,
      proposals: [
        {
          id: "devops", title: "DevOps Studio", product: "nexus-build",
          disposition: "studio", disposition_label: "Proposed studio",
          gates: [{ id: "integration-ingestion", title: "Provider ingestion for build data" }],
          merges_into: null, already_exists_at: null, covers: [], note: null,
        },
        {
          id: "application-runtime", title: "Application Runtime Studio",
          product: "nexus-build", disposition: "merged",
          disposition_label: "Merged into a shared work item", gates: [],
          merges_into: "devops", already_exists_at: null, covers: [],
          note: "Deferred behind DevOps: it needs the deployment record to correlate against.",
        },
        {
          id: "release", title: "Release Studio", product: "nexus-build",
          disposition: "extend", disposition_label: "Extends an existing surface",
          gates: [{ id: "integration-ingestion", title: "Provider ingestion for build data" }],
          merges_into: null,
          already_exists_at: "backend/app/routers/change_management.py",
          covers: [], note: "A workspace over the change machinery, not a second engine.",
        },
      ],
    },
    // Declared with no admitted studio: a plan, not a delivered capability.
    {
      id: "nexus-knowledge", name: "Nexus Knowledge", tagline: "Documentation.",
      studios: [], count: 0, planned_studios: [], proposal_count: 0, proposals: [],
    },
  ],
  studios: [
    {
      id: "proxmox", name: "Proxmox Studio", domain: "Virtualisation", tagline: "Clusters and power actions.",
      product: "nexus-infrastructure", product_name: "Nexus Infrastructure",
      status: "Testing", priority: "P1", release: "R1-R2", owner: "Platform + Infrastructure",
      home_route: "/proxmox", provider: { name: "proxmox_ve_rest_api", state: "wired" },
      spine: SPINE,
      tab_states: { overview: "wired", inventory: "wired", activity: "wired" },
      wired_tabs: ["overview", "inventory", "activity"],
      admission_state: "complete",
    },
    {
      id: "cloud", name: "Cloud Studio", domain: "Cloud", tagline: "Hyperscaler estates.",
      product: "nexus-infrastructure", product_name: "Nexus Infrastructure",
      status: "Discovery required", priority: "P2", release: "R3", owner: "Unassigned",
      home_route: null, provider: { name: "none", state: "planned" },
      spine: SPINE, tab_states: {}, wired_tabs: [], admission_state: "open",
    },
    {
      id: "web", name: "Web Studio", domain: "Websites", tagline: "WordPress operations.",
      product: "nexus-build", product_name: "Nexus Build",
      status: "Partially implemented", priority: "P1", release: "R2", owner: "Experience",
      home_route: "/web-studio", provider: { name: "wordpress_wp_json", state: "wired" },
      spine: SPINE, tab_states: {}, wired_tabs: ["overview"], admission_state: "complete",
    },
    {
      id: "unfiled", name: "Unfiled Studio", domain: "Legacy", tagline: "A survival from before the products.",
      product: "nexus-imaginary", product_name: "Nexus Imaginary",
      status: "Discovery required", priority: "P3", release: "R7", owner: "Unassigned",
      home_route: null, provider: { name: "none", state: "planned" },
      spine: SPINE, tab_states: {}, wired_tabs: [], admission_state: "open",
    },
  ],
};

/** A payload from before the consolidation carried no proposals at all. */
function withoutProposals(fleet) {
  return {
    ...fleet,
    products: fleet.products.map((product) => {
      const copy = { ...product };
      delete copy.proposals;
      delete copy.proposal_count;
      return copy;
    }),
  };
}

const PROXMOX = {
  registry_version: "1.0",
  id: "proxmox",
  name: "Proxmox Studio",
  domain: "Virtualisation",
  tagline: "Proxmox VE clusters: observed inventory and descriptor-gated guest power actions.",
  status: "Testing",
  priority: "P1",
  release: "R1-R2",
  owner: "Platform + Infrastructure",
  home_route: "/proxmox",
  provider: { name: "proxmox_ve_rest_api", state: "wired", reference: "app.services.proxmox_adapter" },
  spine: SPINE,
  admission: {
    state: "complete",
    problem: "MSPs operate hypervisors without an auditable path. Outcome: every action verified.",
    objects: ["device", "backup", "change"],
    provider_contracts: ["proxmox_ve_rest_api_v2"],
    permissions: ["virtualization.vm.control"],
    scopes_audit_retention: "Server-side tenant partition plus client scope.",
    verification_rollback_failure: "Task UPID polled to OK plus observed guest state.",
    commercial: "Under the client infrastructure contract.",
    release_gate: "Provider sandbox acceptance.",
    test_plan: "backend/tests/test_proxmox_actions.py",
    documentation: "docs/INTEGRATIONS/PROXMOX.md",
    owner: "Platform + Infrastructure",
  },
  tabs: {
    overview: { state: "wired", summary: "Contract plus live health.", endpoint: "/proxmox/connection" },
    inventory: { state: "wired", summary: "Live node status.", endpoint: "/proxmox/nodes" },
    administration: { state: "planned", summary: "Power actions execute through the descriptor endpoint; the studio surface lands next." },
    diagnostics: { state: "planned", summary: "No capability contract is registered for this tab yet." },
    changes: { state: "planned", summary: "No capability contract is registered for this tab yet." },
    automation: { state: "planned", summary: "No capability contract is registered for this tab yet." },
    security: { state: "planned", summary: "No capability contract is registered for this tab yet." },
    activity: { state: "wired", summary: "Virtualisation action events.", endpoint: "/events/platform/recent", subjects: ["virtualization."] },
    settings: { state: "planned", summary: "Connection management lives in Infrastructure; the studio surface adopts it next." },
  },
};

const NODES = [{ id: "pve-1:pve-node01", name: "pve-node01", status: "online", cpu_usage: 34.2, memory_usage: 67.5, disk_usage: 45, vm_count: 8, observed_at: "2026-10-10T01:00:00" }];

// Windows Studio exactly as the registry serves it: the Diagnostics tab names a
// cohort-bounded endpoint and the value that completes it.
const WINDOWS_STUDIO = {
  registry_version: "1.0",
  id: "windows",
  name: "Windows Studio",
  domain: "Windows estate",
  tagline: "Why this Windows endpoint differs from the rest of the estate.",
  status: "Partially implemented",
  priority: "P1",
  release: "R2",
  owner: "Platform + Experience",
  home_route: "/fleet-baseline?platform=windows",
  provider: { name: "nexus_agent", state: "partial", reference: "agent/internal/selfheal/perf.go" },
  spine: SPINE,
  admission: {
    state: "complete",
    problem: "A slow Windows endpoint cannot be judged. Outcome: every Windows endpoint is compared against its cohort.",
    objects: ["device", "telemetry", "service"],
    provider_contracts: ["nexus_agent heartbeat"],
    permissions: ["platform.readiness.view"],
    scopes_audit_retention: "Server-side tenant partition plus client scope.",
    verification_rollback_failure: "Read-only: nothing to roll back.",
    commercial: "Part of the managed endpoint service.",
    release_gate: "P1 #108. The fleet-baseline gate is cleared.",
    test_plan: "backend/tests/test_fleet_baseline.py",
    documentation: "docs/NEXUS_INVENT_BATCH_5.md",
    owner: "Platform + Experience",
  },
  tabs: {
    overview: { state: "wired", summary: "Contract plus honest status.", evidence: "app.services.studio_registry" },
    inventory: { state: "wired", summary: "The Windows cohort and what it measured.", endpoint: "/fleet-baseline/contract", evidence: "app.routers.fleet_baseline" },
    administration: { state: "planned", summary: "No capability contract is registered for this tab yet." },
    diagnostics: {
      state: "wired",
      summary: "Every Windows endpoint against its cohort's baseline, worst verdict first.",
      endpoint: "/fleet-baseline/cohorts/{platform}/deviations",
      params: { platform: "windows" },
      evidence: "app.routers.fleet_baseline",
    },
    changes: { state: "planned", summary: "No capability contract is registered for this tab yet." },
    automation: { state: "planned", summary: "Acting on a deviation is not registered." },
    security: { state: "planned", summary: "No capability contract is registered for this tab yet." },
    activity: { state: "planned", summary: "No Windows-specific platform subject is registered yet." },
    settings: { state: "planned", summary: "No capability contract is registered for this tab yet." },
  },
};

const BASELINE_BOUNDARY = "A deviation is a difference from the estate's own measured median, never a fault, a cause or a prediction.";
const WINDOWS_COHORT = {
  platform: "windows", label: "Windows", device_count: 6, measured_device_count: 6,
  baseline_established: true, minimum_devices: 5, unestablished_reason: null,
  metrics: { cpu_usage: { label: "CPU", measured_count: 6, median: 20, spread: 4, unit: "%", established: true, reason: null } },
  bands: { critical: 0, degraded: 0, watch: 0, healthy: 6, unknown: 0 },
};
const WINDOWS_DEVIATIONS = {
  platform: "windows",
  cohort: WINDOWS_COHORT,
  devices: [{
    device_id: "d-hot", name: "Hot endpoint", hostname: "hot.example.test",
    band: "degraded", samples: 12, verdict: "strong",
    deviations: [{
      metric: "cpu_usage", label: "CPU", unit: "%", value: 95, cohort_median: 20, delta: 75,
      verdict: "strong",
      basis: "95% against a cohort median of 20% across 6 measured Windows endpoints (CPU).",
    }],
    unmeasured: [{ metric: "disk_usage", label: "Disk", reason: "This endpoint has not reported this metric." }],
  }],
  note: "Devices are ordered by the worst verdict they carry.",
  boundary: BASELINE_BOUNDARY,
};
const BASELINE_CONTRACT = {
  cohorts: [WINDOWS_COHORT],
  metrics: [{ key: "cpu_usage", label: "CPU", unit: "%" }],
  minimum_cohort_devices: 5, minimum_recurring_devices: 2,
  strong_deviation_ratio: 0.5, notable_deviation_ratio: 0.2, device_count: 6,
  note: "A cohort is the caller's own scoped estate, grouped by operating system.",
  boundary: BASELINE_BOUNDARY,
};

const EVENTS = [
  { id: "e1", subject: "virtualization.vm.action.completed", occurred_at: "2026-10-10T01:00:00", actor: { name: "Ada Admin" }, source: "nexus.proxmox", payload: { summary: "start verified" } },
  { id: "e2", subject: "ticket.created", occurred_at: "2026-10-10T02:00:00", actor: { name: "Sam" }, source: "nexus.psa", payload: { summary: "printer jam" } },
];

const flush = async () => {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
};

function seedGet(overrides = {}) {
  axios.get.mockImplementation((url) => {
    if (overrides[url]) return Promise.resolve({ data: overrides[url] });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

describe("Studio Fleet hub", () => {
  let host;
  let root;

  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    axios.get.mockReset();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    delete global.IS_REACT_ACT_ENVIRONMENT;
  });

  const render = () => act(async () => {
    root.render(<StudiosHubPage />);
    await flush();
  });

  test("lists every studio with its honest status and the shared spine", async () => {
    seedGet({ [`${BASE}/studios`]: FLEET });
    await render();

    expect(axios.get).toHaveBeenCalledWith(`${BASE}/studios`, expect.any(Object));
    expect(host.querySelector('[data-testid="studio-card-proxmox"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="studio-card-cloud"]')).not.toBeNull();

    const cloud = host.querySelector('[data-testid="studio-card-cloud"]').textContent;
    expect(cloud).toContain("Discovery required");
    expect(cloud).toContain("admission open");

    const proxmox = host.querySelector('[data-testid="studio-card-proxmox"]').textContent;
    expect(proxmox).toContain("Testing");
    expect(proxmox).toContain("inventory");

    // The spine strip documents the one operating model.
    const hub = host.querySelector('[data-testid="studios-hub"]');
    expect(hub.textContent).toContain("Administration");
    expect(hub.textContent).toContain("Diagnostics");
  });

  test("groups the fleet into products and discloses what it cannot file", async () => {
    seedGet({ [`${BASE}/studios`]: FLEET });
    await render();

    // Products render in the registry's declared order, and the declared-but-empty
    // one still appears so a planned product is not mistaken for a missing one.
    const sectionIds = [...host.querySelectorAll('[data-testid^="product-section-"]')]
      .map((node) => node.getAttribute("data-testid"));
    expect(sectionIds).toEqual([
      "product-section-nexus-infrastructure",
      "product-section-nexus-build",
      "product-section-nexus-knowledge",
      "product-section-ungrouped",
    ]);
    expect(host.querySelector('[data-testid="product-empty-nexus-knowledge"]')).not.toBeNull();

    // Proposals are counted as proposals, never as delivered capability.
    const infrastructure = host.querySelector('[data-testid="product-section-nexus-infrastructure"]').textContent;
    expect(infrastructure).toContain("Nexus Infrastructure");
    expect(infrastructure).toContain("2 studios");
    expect(infrastructure).toContain("1 proposed");

    // A studio under a product the registry does not declare is disclosed, not hidden.
    const ungrouped = host.querySelector('[data-testid="product-section-ungrouped"]');
    expect(ungrouped.textContent).toContain("Unfiled Studio");
    expect(host.querySelector('[data-testid="product-disclosure-ungrouped"]')).not.toBeNull();

    // And the count line reports products, not a flattened studio wall.
    expect(host.querySelector('[data-testid="header-description"]').textContent)
      .toContain("4 studios across 3 products");
  });

  test("surfaces a load failure instead of an empty fleet", async () => {
    axios.get.mockRejectedValue({ response: { data: { detail: "Auth expired" } } });
    await act(async () => {
      root.render(<StudiosHubPage />);
      await flush();
    });
    expect(host.querySelector('[data-testid="fleet-error"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="fleet-error"]').textContent).toContain("Auth expired");
  });

  test("counts consolidated ideas apart from proposed studios in each product", async () => {
    seedGet({ [`${BASE}/studios`]: FLEET });
    await render();

    const infrastructure = host.querySelector('[data-testid="product-section-nexus-infrastructure"]');
    expect(infrastructure.textContent).toContain("2 studios");
    expect(infrastructure.textContent).toContain("1 proposed");
    expect(infrastructure.textContent).toContain("1 consolidated");

    // A product with no proposal at all says nothing it cannot prove.
    const knowledge = host.querySelector('[data-testid="product-section-nexus-knowledge"]');
    expect(knowledge.textContent).not.toContain("consolidated");
    expect(knowledge.textContent).not.toContain("proposed");

    // The ungrouped bucket holds studios, not proposals, so it grows no list.
    expect(host.querySelector('[data-testid="product-proposals-nexus-infrastructure"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="product-proposals-ungrouped"]')).toBeNull();
  });

  test("renders each product's catalogue with what the consolidation decided", async () => {
    seedGet({ [`${BASE}/studios`]: FLEET });
    await render();

    // A proposed studio is a plan, and its gate is named rather than implied.
    const proposed = host.querySelector('[data-testid="proposal-connectivity-diagnostics"]');
    expect(proposed.textContent).toContain("Connectivity Diagnostics Studio");
    expect(proposed.textContent).toContain("Proposed studio");
    expect(proposed.textContent).toContain("Blocked on Authorised network observation points");

    // A merge names the work item that owns it.
    const merged = host.querySelector('[data-testid="proposal-application-runtime"]');
    expect(merged.textContent).toContain("Merged into a shared work item");
    expect(merged.textContent).toContain("Merged into devops");

    // An extension names the surface it extends, not a repository path.
    const extended = host.querySelector('[data-testid="proposal-release"]');
    expect(extended.textContent).toContain("Extends an existing surface");
    expect(extended.textContent).toContain("Extends change_management.py");
  });

  test("delivered capability never wears the same tone as a proposal", async () => {
    seedGet({ [`${BASE}/studios`]: FLEET });
    await render();

    const delivered = host.querySelector('[data-testid="proposal-disposition-device-state-checks"]');
    expect(delivered.textContent).toContain("Already served");
    expect(delivered.className).toContain("emerald");

    const unbuilt = host.querySelector('[data-testid="proposal-disposition-devops"]');
    expect(unbuilt.textContent).toContain("Proposed studio");
    expect(unbuilt.className).toContain("amber");
    expect(host.querySelector('[data-testid="proposal-devops"]').textContent)
      .not.toContain("Already served");
  });

  test("a payload with no consolidated catalogue renders the fleet unchanged", async () => {
    seedGet({ [`${BASE}/studios`]: withoutProposals(FLEET) });
    await render();

    expect(host.querySelector('[data-testid="studio-card-proxmox"]')).not.toBeNull();
    expect(host.querySelectorAll('[data-testid^="product-proposals-"]')).toHaveLength(0);
    const infrastructure = host.querySelector('[data-testid="product-section-nexus-infrastructure"]');
    expect(infrastructure.textContent).toContain("1 proposed");
    expect(infrastructure.textContent).not.toContain("consolidated");
    // A declared product with nothing at all still discloses that it is a plan.
    expect(host.querySelector('[data-testid="product-empty-nexus-knowledge"]')).not.toBeNull();
  });
});

describe("StudioShell spine", () => {
  let host;
  let root;

  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    axios.get.mockReset();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    delete global.IS_REACT_ACT_ENVIRONMENT;
  });

  const render = (studioId) => act(async () => {
    root.render(<StudioShell studioId={studioId} />);
    await flush();
  });

  const clickTab = async (tabId) => act(async () => {
    const trigger = host.querySelector(`[data-testid="tab-${tabId}"]`);
    expect(trigger).not.toBeNull();
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
  });

  test("renders the admission contract and all nine spine tabs", async () => {
    seedGet({
      [`${BASE}/studios/proxmox`]: PROXMOX,
      [`${BASE}/proxmox/connection`]: { configured: false, connections: [], mode: "unconfigured" },
    });
    await render("proxmox");

    expect(host.querySelector('[data-testid="studio-shell"]').getAttribute("data-studio")).toBe("proxmox");
    for (const tab of SPINE) {
      expect(host.querySelector(`[data-testid="tab-${tab}"]`)).not.toBeNull();
    }
    const overview = host.querySelector('[data-testid="studio-overview"]');
    expect(overview.textContent).toContain("virtualization.vm.control");
    expect(overview.textContent).toContain("docs/INTEGRATIONS/PROXMOX.md");
    // Unconfigured health is disclosed on overview, never as a green state.
    expect(host.querySelector('[data-testid="studio-overview-health"]').textContent).toContain("No connection configured");
  });

  test("a planned tab discloses its admission reason instead of rendering empty", async () => {
    seedGet({
      [`${BASE}/studios/proxmox`]: PROXMOX,
      [`${BASE}/proxmox/connection`]: { configured: false, connections: [], mode: "unconfigured" },
    });
    await render("proxmox");

    await clickTab("diagnostics");
    const unwired = host.querySelector('[data-testid="tab-unwired-planned"]');
    expect(unwired).not.toBeNull();
    expect(unwired.textContent).toContain("not wired for Proxmox Studio");
    expect(unwired.textContent).toContain("No capability contract is registered for this tab yet.");
  });

  test("the activity tab fetches the scoped stream and filters to this studio's subjects", async () => {
    seedGet({
      [`${BASE}/studios/proxmox`]: PROXMOX,
      [`${BASE}/proxmox/connection`]: { configured: false, connections: [], mode: "unconfigured" },
      [`${BASE}/events/platform/recent`]: EVENTS,
    });
    await render("proxmox");

    await clickTab("activity");
    expect(axios.get).toHaveBeenCalledWith(`${BASE}/events/platform/recent`, expect.any(Object));
    const activity = host.querySelector('[data-testid="studio-activity"]');
    expect(activity.textContent).toContain("virtualization.vm.action.completed");
    expect(activity.textContent).toContain("start verified");
    // Subjects from other domains never appear under this studio.
    expect(activity.textContent).not.toContain("printer jam");
  });

  test("the inventory tab renders observed provider data, not demo rows", async () => {
    seedGet({
      [`${BASE}/studios/proxmox`]: PROXMOX,
      [`${BASE}/proxmox/connection`]: { configured: false, connections: [], mode: "unconfigured" },
      [`${BASE}/proxmox/nodes`]: NODES,
    });
    await render("proxmox");

    await clickTab("inventory");
    const inventory = host.querySelector('[data-testid="studio-inventory"]');
    expect(inventory.textContent).toContain("pve-node01");
    expect(inventory.textContent).toContain("observed 2026-10-10 01:00");
  });

  test("the Diagnostics tab renders the deviation view for the cohort the registry bound", async () => {
    seedGet({
      [`${BASE}/studios/windows`]: WINDOWS_STUDIO,
      [`${BASE}/fleet-baseline/cohorts/windows/deviations`]: WINDOWS_DEVIATIONS,
    });
    await render("windows");

    await clickTab("diagnostics");

    // The tab's own declaration completes the request: no placeholder reaches the wire.
    expect(axios.get).toHaveBeenCalledWith(
      `${BASE}/fleet-baseline/cohorts/windows/deviations`,
      expect.any(Object),
    );
    expect(axios.get.mock.calls.map(([url]) => url).some((url) => url.includes("{"))).toBe(false);

    const panel = host.querySelector('[data-testid="studio-fleet-baseline"]');
    expect(panel).not.toBeNull();
    expect(panel.getAttribute("data-view")).toBe("deviations");
    expect(panel.textContent).toContain("Cohort read: Windows");
    expect(host.querySelector('[data-testid="baseline-device-d-hot"]').textContent)
      .toContain("Well outside the cohort");
    expect(host.querySelector('[data-testid="baseline-deviation-d-hot-cpu_usage"]').textContent)
      .toContain("95% against a cohort median of 20% across 6 measured Windows endpoints");
    expect(host.querySelector('[data-testid="baseline-unmeasured-d-hot"]').textContent)
      .toContain("Disk: This endpoint has not reported this metric.");
    expect(host.querySelector('[data-testid="studio-baseline-cohort"]').textContent)
      .toContain("Baseline established");
    expect(host.querySelector('[data-testid="studio-baseline-boundary"]').textContent)
      .toBe(BASELINE_BOUNDARY);
    // It is a rendered deviation view, not the raw observed payload.
    expect(panel.textContent).not.toContain('"device_id"');
  });

  test("the Inventory tab renders the cohort contract the studio was admitted against", async () => {
    seedGet({
      [`${BASE}/studios/windows`]: WINDOWS_STUDIO,
      [`${BASE}/fleet-baseline/contract`]: BASELINE_CONTRACT,
    });
    await render("windows");

    await clickTab("inventory");

    expect(axios.get).toHaveBeenCalledWith(`${BASE}/fleet-baseline/contract`, expect.any(Object));
    const panel = host.querySelector('[data-testid="studio-fleet-baseline"]');
    expect(panel.getAttribute("data-view")).toBe("contract");
    expect(host.querySelector('[data-testid="studio-baseline-thresholds"]').textContent)
      .toContain("±20% / ±50%");
    expect(host.querySelector('[data-testid="studio-baseline-cohorts"]').textContent)
      .toContain("Windows · 6/6 measured");
  });

  test("a fleet-baseline tab that cannot be read says so instead of showing an empty cohort", async () => {
    seedGet({
      [`${BASE}/studios/windows`]: WINDOWS_STUDIO,
      [`${BASE}/fleet-baseline/cohorts/windows/deviations`]: undefined,
    });
    await render("windows");

    await clickTab("diagnostics");

    expect(host.querySelector('[data-testid="studio-baseline-error"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="studio-baseline-devices"]')).toBeNull();
    expect(host.querySelector('[data-testid="studio-baseline-cohort"]')).toBeNull();
  });

  test("an unknown studio renders a not-found state with a way back", async () => {
    axios.get.mockRejectedValue({ response: { data: { detail: "Unknown studio 'nope'" } } });
    await render("nope");
    const missing = host.querySelector('[data-testid="studio-not-found"]');
    expect(missing).not.toBeNull();
    expect(missing.textContent).toContain("Unknown studio 'nope'");
    expect(missing.textContent).toContain("Back to Studio Fleet");
  });
});
