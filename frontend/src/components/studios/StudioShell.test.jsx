/* eslint-disable testing-library/no-unnecessary-act -- Native React createRoot requires act. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";

import StudioShell from "./StudioShell";

// The shell is the place a studio's registry contract becomes a screen, so it is
// tested here rather than only through each panel: a tab whose endpoint answers
// an adopted projection must render that projection's panel, a tab whose
// capability is planned must render the disclosure, and a tab nobody modelled
// must not be read at all.
jest.mock("axios", () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock("@/App", () => ({
  __esModule: true,
  API: "http://api.test/api",
  useAuth: () => ({ token: "session-token" }),
}), { virtual: true });
jest.mock("@/lib/apiErrorMessage", () => ({
  apiErrorMessage: (error, fallback) => error?.response?.data?.detail || fallback,
}), { virtual: true });
jest.mock("@/components/ui/card", () => ({
  Card: ({ children, className, ...props }) => <section className={className} {...props}>{children}</section>,
  CardContent: ({ children, className, ...props }) => <div className={className} {...props}>{children}</div>,
}), { virtual: true });
jest.mock("@/components/ui/badge", () => ({
  Badge: ({ children, variant: _variant, className, ...props }) => (
    <span className={className} {...props}>{children}</span>
  ),
}), { virtual: true });
jest.mock("@/components/ui/button", () => ({
  Button: ({ children, variant: _variant, size: _size, asChild: _asChild, className, ...props }) => (
    <button className={className} {...props}>{children}</button>
  ),
}), { virtual: true });
// Radix tabs mount only the active panel; the shell's per-tab dispatch is what
// this test is about, so every panel renders.
jest.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }) => <div>{children}</div>,
  TabsList: ({ children }) => <div>{children}</div>,
  TabsTrigger: ({ children, ...props }) => <button {...props}>{children}</button>,
  TabsContent: ({ children, ...props }) => <div {...props}>{children}</div>,
}), { virtual: true });
jest.mock("@/components/OperationalPageHeader", () => ({
  __esModule: true,
  default: ({ title, eyebrow }) => <header data-testid="header">{title} — {eyebrow}</header>,
}), { virtual: true });
// The fleet-baseline dispatch has its own suite; here it only has to prove the
// shell hands it the tab rather than the generic endpoint view.
jest.mock("@/components/studios/FleetBaselinePanel", () => ({
  __esModule: true,
  default: ({ spec }) => <div data-testid="fleet-baseline-panel">{spec.endpoint}</div>,
  fleetBaselineView: (endpoint) => (String(endpoint || "").includes("/fleet-baseline/") ? "deviations" : null),
}), { virtual: true });
// The panels are covered by their own suite (which asserts each one reads the
// endpoint its spec names), so here each is stubbed to report the spec it was
// handed: the assertion is about which panel the shell selected, and the two
// suites together cover the chain from contract to request.
const panelStub = (testId) => ({
  __esModule: true,
  default: ({ spec }) => <div data-testid={testId}>{spec.endpoint}</div>,
});
jest.mock("@/components/studios/AgentFleetPanel", () => panelStub("agent-fleet-panel"), { virtual: true });
jest.mock("@/components/studios/BackupRecoveryPanel", () => panelStub("backup-recovery-panel"), { virtual: true });
jest.mock("@/components/studios/ClientEstatePanel", () => panelStub("client-estate-panel"), { virtual: true });
jest.mock("@/components/studios/DeviceEstatePanel", () => panelStub("device-estate-panel"), { virtual: true });
jest.mock("@/components/studios/MicrosoftStudioPanel", () => panelStub("microsoft-studio-panel"), { virtual: true });
jest.mock("@/components/studios/MicrosoftEvidencePanel", () => panelStub("microsoft-evidence-panel"), { virtual: true });
jest.mock("@/components/studios/MicrosoftOperationsPanel", () => panelStub("microsoft-operations-panel"), { virtual: true });
jest.mock("@/components/studios/M365TenantPanel", () => panelStub("m365-tenants-panel"), { virtual: true });
jest.mock("@/components/studios/MonitoringPulsePanel", () => panelStub("monitoring-pulse-panel"), { virtual: true });
jest.mock("@/components/studios/MonitoringResourcesPanel", () => panelStub("monitoring-resources-panel"), { virtual: true });
jest.mock("@/components/studios/VoiceEstatePanel", () => panelStub("voice-estate-panel"), { virtual: true });
jest.mock("@/components/studios/WebEstatePanel", () => panelStub("web-estate-panel"), { virtual: true });
jest.mock("@/components/studios/NetworkSitesPanel", () => panelStub("network-sites-panel"), { virtual: true });
jest.mock("@/components/studios/NetworkEvidencePanel", () => panelStub("network-evidence-panel"), { virtual: true });
jest.mock("@/components/studios/PatchPosturePanel", () => panelStub("patch-posture-panel"), { virtual: true });
jest.mock("@/components/studios/SecurityPosturePanel", () => panelStub("security-posture-panel"), { virtual: true });
jest.mock("@/components/studios/LeadPipelinePanel", () => panelStub("lead-pipeline-panel"), { virtual: true });
jest.mock("@/components/studios/DocumentationInventoryPanel", () => panelStub("documentation-inventory-panel"), { virtual: true });
jest.mock("@/components/studios/CommunicationsPanel", () => panelStub("communications-csat-panel"), { virtual: true });
// The kit's dispatch map is the shell's own decision, so it is the real module.
jest.mock("@/components/studios/StudioObservationKit", () => ({
  __esModule: true,
  ...jest.requireActual("./StudioObservationKit"),
}), { virtual: true });

const BASE = "http://api.test/api";
const SPINE = ["overview", "inventory", "administration", "diagnostics", "changes", "automation", "security", "activity", "settings"];

/** A registry contract as `GET /api/studios/{id}` serves it. */
function contract(id, name, tabs) {
  return {
    id,
    name,
    domain: "Testing",
    tagline: "A studio under test.",
    status: "Partially implemented",
    priority: "P1",
    release: "R1",
    owner: "Platform",
    home_route: null,
    provider: { name: "nexus_native", state: "wired", reference: null },
    admission: { state: "complete", problem: "An outcome." },
    spine: SPINE,
    tabs: {
      ...Object.fromEntries(SPINE.map((tab) => [tab, { state: "planned", summary: "Not wired yet." }])),
      overview: { state: "wired", summary: "This studio's contract.", evidence: "app.services.studio_registry" },
      ...tabs,
    },
  };
}

const DEVICES = contract("devices", "Devices Studio", {
  inventory: {
    state: "wired",
    summary: "The canonical endpoint estate read through the Devices projection (GET /devices).",
    endpoint: "/devices",
    evidence: "app.routers.devices",
  },
  activity: { state: "wired", summary: "Endpoint events.", endpoint: "/events/platform/recent", subjects: ["device.connected"] },
});

// Voice Studio adopted its existing scoped PBX projection: the contract now names
// the endpoint its inventory tab reads.
const VOICE = contract("voice", "Voice Studio", {
  inventory: {
    state: "wired",
    summary: "The linked voice estate the Voice workspace already holds (GET /yeastar/pbxs): each PBX with its client mapping, controller URL, extension and billable-extension counts and last sync.",
    endpoint: "/yeastar/pbxs",
    evidence: "app.routers.yeastar",
  },
  activity: { state: "wired", summary: "Voice events.", endpoint: "/events/platform/recent", subjects: ["voice."] },
});

const MICROSOFT = contract("m365", "Microsoft Studio", {
  overview: {
    state: "wired",
    summary: "Verified Microsoft evidence in one command-centre projection.",
    endpoint: "/m365/studio-overview",
    evidence: "app.routers.m365.microsoft_studio_overview",
  },
  administration: {
    state: "wired",
    summary: "Governed Microsoft operations.",
    endpoint: "/m365/capabilities/administration",
    evidence: "app.routers.m365.microsoft_capabilities",
  },
});

const NETWORK = contract("network", "Network Studio", {
  diagnostics: {
    state: "wired",
    summary: "Retained network controller observations.",
    endpoint: "/bandwidth-monitor/overview",
    evidence: "app.routers.bandwidth_monitor",
  },
});

const MONITORING = contract("monitoring", "Monitoring Studio", {
  overview: {
    state: "wired",
    summary: "Scoped operational evidence composed by Nexus Pulse.",
    endpoint: "/nexus-pulse/overview",
    evidence: "app.routers.nexus_pulse",
  },
  inventory: {
    state: "wired",
    summary: "Scoped endpoint observation coverage.",
    endpoint: "/nexus-pulse/resources",
    evidence: "app.routers.nexus_pulse",
  },
});

// A capability that is still genuinely unbuilt: the disclosure is the feature.
const TELECOM = contract("telecom", "Telecom Studio", {
  inventory: {
    state: "planned",
    summary: "Carrier and SIP trunk inventory stays unbuilt until a carrier contract, an evidence plan and an owner are admitted.",
  },
});

const REMOTE = contract("remote", "Remote Studio", {
  inventory: {
    state: "wired",
    summary: "Governed remote session records.",
    endpoint: "/remote/sessions",
    evidence: "app.routers.remote",
  },
});

const BACKUP = contract("backup", "Backup Studio", {
  diagnostics: {
    state: "wired",
    summary: "Recorded restore verification outcomes.",
    endpoint: "/backup-verify/overview",
    evidence: "app.routers.backup_center",
  },
});

function mockApi({ studio }) {
  axios.get.mockImplementation((url) => {
    if (url.includes("/studios/")) return Promise.resolve({ data: studio });
    if (url.endsWith("/events/platform/recent")) return Promise.resolve({ data: [] });
    return Promise.reject(new Error(`unexpected url ${url}`));
  });
}

describe("the studio spine's tab dispatch", () => {
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
    await Promise.resolve();
    await Promise.resolve();
  });

  test("a tab that adopts a projection renders that projection's panel with its own spec", async () => {
    mockApi({ studio: DEVICES });
    await render("devices");

    const urls = axios.get.mock.calls.map(([url]) => url);
    expect(urls).toContain(`${BASE}/studios/devices`);
    // The device-estate panel was selected and handed the registry's endpoint;
    // it is that panel (proved in its own suite) that reads the endpoint.
    expect(host.querySelector('[data-testid="device-estate-panel"]').textContent).toBe("/devices");
    expect(host.querySelector('[data-testid="studio-observation-rows"]')).toBeNull();
    // The activity tab beside it is the generic subject-filtered view, which is
    // the one read the shell itself performs.
    expect(urls).toContain(`${BASE}/events/platform/recent`);
    expect(host.querySelector('[data-testid="header"]').textContent).toContain("3/9 areas ready");
  });

  test("a planned capability renders the disclosure and is never requested", async () => {
    mockApi({ studio: TELECOM });
    await render("telecom");

    const urls = axios.get.mock.calls.map(([url]) => url);
    expect(host.querySelector('[data-testid="tab-unwired-planned"]').textContent)
      .toContain("unbuilt until a carrier contract, an evidence plan and an owner are admitted");
    // Unbuilt is disclosed, not rendered as an empty panel that reads like a
    // healthy nothing, and nothing behind it is requested.
    expect(host.querySelector('[data-testid="studio-observation-rows"]')).toBeNull();
    expect(host.querySelector('[data-testid="studio-observation-empty"]')).toBeNull();
    expect(urls).not.toContain(`${BASE}/yeastar/pbxs`);
    expect(urls.filter((url) => url !== `${BASE}/studios/telecom`)).toEqual([]);
  });

  test("the shared workbench only offers evidence-backed areas and changes tabs intentionally", async () => {
    mockApi({ studio: DEVICES });
    await render("devices");

    expect(host.querySelector('[data-testid="studio-workbench"]').textContent).toContain("3 live areas");
    expect(host.querySelector('[data-testid="studio-workbench-open-administration"]')).toBeNull();

    await act(async () => {
      host.querySelector('[data-testid="studio-workbench-open-activity"]').click();
      await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="studio-workbench"]').textContent).toContain("Work from evidence");
  });

  test("an adopted projection is handed to its own panel, and the shell does not read it itself", async () => {
    mockApi({ studio: VOICE });
    await render("voice");

    const urls = axios.get.mock.calls.map(([url]) => url);
    expect(urls).toContain(`${BASE}/studios/voice`);
    expect(host.querySelector('[data-testid="voice-estate-panel"]').textContent).toBe("/yeastar/pbxs");
    // The panel owns that read (proved in its own suite); the shell must not
    // have fetched the same endpoint a second time behind it.
    expect(urls).not.toContain(`${BASE}/yeastar/pbxs`);
  });

  test("Microsoft Studio dispatches the command-centre overview to its evidence panel", async () => {
    mockApi({ studio: MICROSOFT });
    await render("m365");

    expect(host.querySelector('[data-testid="microsoft-studio-panel"]').textContent).toBe("/m365/studio-overview");
    expect(host.querySelector('[data-testid="microsoft-operations-panel"]').textContent).toBe("/m365/capabilities/administration");
    expect(axios.get.mock.calls.map(([url]) => url)).not.toContain(`${BASE}/m365/studio-overview`);
    expect(axios.get.mock.calls.map(([url]) => url)).not.toContain(`${BASE}/m365/capabilities/administration`);
  });

  test("Network Studio dispatches retained controller data to its evidence panel", async () => {
    mockApi({ studio: NETWORK });
    await render("network");

    expect(host.querySelector('[data-testid="network-evidence-panel"]').textContent)
      .toBe("/bandwidth-monitor/overview");
    expect(axios.get.mock.calls.map(([url]) => url)).not.toContain(`${BASE}/bandwidth-monitor/overview`);
  });

  test("Monitoring Studio dispatches its overview to the shared Pulse panel", async () => {
    mockApi({ studio: MONITORING });
    await render("monitoring");

    expect(host.querySelector('[data-testid="monitoring-pulse-panel"]').textContent)
      .toBe("/nexus-pulse/overview");
    expect(axios.get.mock.calls.map(([url]) => url)).not.toContain(`${BASE}/nexus-pulse/overview`);
    expect(host.querySelector('[data-testid="monitoring-resources-panel"]').textContent)
      .toBe("/nexus-pulse/resources");
    expect(axios.get.mock.calls.map(([url]) => url)).not.toContain(`${BASE}/nexus-pulse/resources`);
  });

  test("a later-batch studio dispatches through the same map rather than falling back to raw data", async () => {
    mockApi({
      studio: contract("communications", "Communications Studio", {
        inventory: {
          state: "wired",
          summary: "Recorded customer feedback read from the CSAT projection (GET /csat/dashboard).",
          endpoint: "/csat/dashboard",
          evidence: "app.routers.csat_surveys",
        },
      }),
    });
    await render("communications");

    expect(host.querySelector('[data-testid="communications-csat-panel"]').textContent).toBe("/csat/dashboard");
    const urls = axios.get.mock.calls.map(([url]) => url);
    expect(urls).not.toContain(`${BASE}/csat/dashboard`);
  });

  test("Remote Studio gives governed session inventory its own technician-facing panel", async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes("/studios/remote")) return Promise.resolve({ data: REMOTE });
      if (url.endsWith("/remote/sessions")) return Promise.resolve({
        data: [{ id: "session-1", device_name: "AARON-HOME-PC", technician_name: "Alex", status: "active", mode: "control" }],
      });
      return Promise.reject(new Error(`unexpected url ${url}`));
    });
    await render("remote");

    expect(host.querySelector('[data-testid="remote-sessions-panel"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="remote-sessions-list"]').textContent).toContain("AARON-HOME-PC");
    expect(axios.get.mock.calls.map(([url]) => url)).toContain(`${BASE}/remote/sessions`);
  });

  test("Backup Studio gives measured recovery verification its own evidence panel", async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes("/studios/backup")) return Promise.resolve({ data: BACKUP });
      if (url.endsWith("/backup-verify/overview")) return Promise.resolve({ data: { summary: { passed: 1, failed: 0, pending: 1, pass_rate_pct: 100 }, tests: [] } });
      return Promise.reject(new Error(`unexpected url ${url}`));
    });
    await render("backup");

    expect(host.querySelector('[data-testid="backup-verification-panel"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="backup-verification-empty"]')).not.toBeNull();
    expect(axios.get.mock.calls.map(([url]) => url)).toContain(`${BASE}/backup-verify/overview`);
  });

  test("a wired endpoint that is not an adopted projection still reads its own contract", async () => {
    mockApi({
      studio: contract("windows", "Windows Studio", {
        diagnostics: {
          state: "wired",
          summary: "Every Windows endpoint against its cohort baseline.",
          endpoint: "/fleet-baseline/cohorts/{platform}/deviations",
          params: { platform: "windows" },
          evidence: "app.routers.fleet_baseline",
        },
      }),
    });
    await render("windows");

    expect(host.querySelector('[data-testid="fleet-baseline-panel"]').textContent)
      .toBe("/fleet-baseline/cohorts/{platform}/deviations");
    expect(host.querySelector('[data-testid="studio-observation-rows"]')).toBeNull();
  });
});
