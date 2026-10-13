/* eslint-disable testing-library/no-unnecessary-act -- Native React createRoot requires act. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";

import AgentFleetPanel from "./AgentFleetPanel";
import BackupRecoveryPanel from "./BackupRecoveryPanel";
import ClientEstatePanel from "./ClientEstatePanel";
import CommunicationsPanel from "./CommunicationsPanel";
import DeviceEstatePanel from "./DeviceEstatePanel";
import DocumentationInventoryPanel from "./DocumentationInventoryPanel";
import LeadPipelinePanel from "./LeadPipelinePanel";
import M365TenantPanel from "./M365TenantPanel";
import NetworkSitesPanel from "./NetworkSitesPanel";
import PatchPosturePanel from "./PatchPosturePanel";
import SecurityPosturePanel from "./SecurityPosturePanel";
import VoiceEstatePanel from "./VoiceEstatePanel";
import WebEstatePanel from "./WebEstatePanel";
import { resolveObservationEndpoint, studioObservationView } from "./StudioObservationKit";

// The `@/` alias is a webpack/craco alias with no jest mapping, so every
// aliased module the kit reaches is registered here. The kit itself is the real
// module: these panels' whole job is that their disclosures are the ones the
// tab renders.
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
jest.mock("@/components/ui/button", () => ({
  Button: ({ children, variant: _variant, size: _size, className, ...props }) => (
    <button className={className} {...props}>{children}</button>
  ),
}), { virtual: true });

const BASE = "http://api.test/api";

const DEVICES = [
  {
    id: "dev-1", name: "Reception PC", hostname: "reception", status: "online",
    client_name: "Contoso", os: "Windows 11", ip_address: "10.0.0.10",
    agent_version: "1.4.2", last_seen: "2026-10-13T08:12:00Z",
  },
  {
    // An endpoint that has never reported an agent version: it must not read as
    // a clean row with an empty column.
    id: "dev-2", name: "Old NAS", status: "offline",
    client_id: "client-9", os: "Linux", last_seen: "2026-10-01T09:00:00Z",
  },
];

const AGENTS = [
  {
    id: "a1", device_id: "dev-1", hostname: "reception", client_name: "Contoso",
    last_seen: "2026-10-13T08:12:00Z", online: true,
    agent_token: "must-not-be-rendered",
    trust: {
      status: "mtls_verified", transport: "mtls", policy_version: 4,
      self_repair_status: "not_reported", certificate_fingerprint: "AA:BB",
    },
  },
  {
    id: "a2", device_id: "dev-2", hostname: "old-nas", client_id: "client-9",
    last_seen: "2026-10-01T09:00:00Z", online: false,
    trust: { status: "legacy_token", transport: "token", policy_version: null, self_repair_status: "not_reported" },
  },
];

const CLIENTS = {
  summary: {
    client_count: 2, total_mrr: 4210.5, avg_health: 78.4, at_risk: 1,
    churned: 0, prospects: 0, with_acronis: 1, with_pax8: 0,
    patch_pending: 12, assessed_endpoints: 7,
  },
  clients: [
    {
      id: "client-1", name: "Contoso", tier: "gold", lifecycle: "active",
      health_score: 91, risk_level: "low", open_tickets: 3, asset_count: 12,
      active_contracts: 2, last_activity: "2026-10-13T07:00:00Z", mrr: 3210.5,
    },
    {
      id: "client-2", name: "Fabrikam", tier: "standard", lifecycle: "active",
      health_score: 44, risk_level: "critical", open_tickets: 9, asset_count: 3,
      active_contracts: 1, last_activity: "2026-10-12T18:00:00Z", mrr: 1000,
    },
  ],
};

const BACKUP = {
  summary: { total_jobs: 3, successful: 1, failed: 1, running: 1, success_rate: 33.3, total_size_gb: 512.5 },
  jobs: [
    { id: "job-1", name: "Server nightly", status: "success", client_name: "Contoso", size_gb: 500, last_run: "2026-10-13T02:00:00Z" },
    { id: "job-2", name: "File share", status: "failed", client_name: "Fabrikam", last_run: "2026-10-13T02:00:00Z" },
    // A workload whose run outcome was never recorded: not reported, never green.
    { id: "job-3", name: "Laptop images", client_name: "Contoso", updated_at: "2026-10-11T02:00:00Z" },
  ],
};

// ---------------------------------------------------------------------------
// The second batch of adopted projections. Each fixture carries the fields the
// panel under test actually models, plus at least one field it deliberately does
// not render (a credential, a secret or an unmodelled figure) so the omission is
// asserted rather than assumed.
// ---------------------------------------------------------------------------

const M365 = [
  {
    tenant_id: "tenant-1", tenant_name: "Contoso", users_count: 240,
    mfa_enrolled_pct: 82, secure_score: 71,
    client_secret: "m365-tenant-secret",
  },
  // A mapped tenant the provider has reported nothing about: not 0 users, not 0%.
  { tenant_id: "tenant-2", tenant_name: "Fabrikam" },
  // The collection stores the display name as `name` with the domain beside it.
  // A panel that only read `tenant_name` would label this mapped tenant with its
  // GUID while its name sat in the payload unread.
  { tenant_id: "tenant-3", name: "Northwind", default_domain: "northwind.test", users_count: 12 },
];

const VOICE = [
  {
    id: "pbx-1", name: "Contoso HQ", client_id: "client-1", client_name: "Contoso",
    pbx_url: "https://pbx.contoso.test", status: "online", enabled: true, provider: "yeastar",
    extension_count: 24, billable_extension_count: 20, last_sync: "2026-10-13T07:00:00Z",
    client_secret: "voice-client-secret", client_api_id: "voice-api-id",
  },
  {
    id: "pbx-2", name: "Fabrikam Branch", client_id: "client-2", status: "offline",
    enabled: false, extension_count: null, billable_extension_count: null,
    updated_at: "2026-10-11T07:00:00Z",
  },
];

const WEB = {
  summary: {
    managed_websites: 2, plugin_updates: 3, security_findings: 0, backup_warnings: 1,
    unreachable_sites: 0, attention_sites: 1, attention_count: 1,
    // Security has never been assessed here, so its zero is not a clean result.
    assessed: { plugins: true, security: false, backups: true },
  },
  sites: [
    {
      id: "ws-1", client_id: "client-1", client_name: "Contoso", name: "Contoso marketing",
      primary_domain: "contoso.test", platform: "wordpress", wordpress_version: "6.6.2",
      attention: { level: "attention", reasons: ["Plugin updates pending"] },
      last_health_check_at: "2026-10-13T06:00:00Z",
    },
    { id: "ws-2", name: "Fabrikam store", attention: { level: "healthy", reasons: [] } },
  ],
  synergy: { api_key: "web-synergy-key" },
};

const NETWORK = [
  {
    id: "site-1", name: "Contoso HQ", client_id: "client-1", client_name: "Contoso",
    controller_url: "https://unifi.contoso.test", site_id: "default", status: "online",
    location: "London", wan_ip: "203.0.113.7", isp: "BT", download_speed_mbps: 500,
    upload_speed_mbps: 100, verify_ssl: true, notes: "Operator note, not evidence",
    controller_password: "network-controller-secret", created_at: "2026-01-04T09:00:00Z",
  },
  { id: "site-2", name: "Fabrikam warehouse", client_id: "client-2", status: "offline" },
];

const PATCH = {
  summary: {
    total_devices: 5, assessed_devices: 3, compliant: 2, needs_attention: 1, critical: 0,
    compliance_pct: null, evidence_state: "not_assessed", legacy_unverified_policies: 2,
  },
  policies: [],
  policy_register_access: "not_available",
  devices: [
    {
      id: "dev-1", name: "Reception PC", client_name: "Contoso", os: "Windows 11",
      source: "nexus_agent", patch_ring: "ring-a", pending_patches: 4,
      patch_status: "needs_attention", observed_at: "2026-10-13T08:00:00Z",
    },
    { id: "dev-2", name: "Old NAS", client_name: "Fabrikam", os: "Linux", patch_status: "current" },
  ],
  message: "Patch state is reported by the signed agent; no fresh report exists for every endpoint.",
};

const SECURITY = {
  summary: {
    total_endpoints: 25, managed_endpoints: 20, security_assessed_endpoints: 8,
    unassessed_endpoints: 17, fully_patched: 5, patch_compliance_pct: null,
    active_threats: 2, identity_alerts: null, identity_source_configured: false,
    canary_triggers: 1, security_score: null, endpoints_online: 18,
    evidence_state: "not_assessed", generated_at: "2026-10-13T09:00:00Z",
  },
  recent_incidents: [{ id: "inc-1", title: "Suspicious login", severity: "high" }],
  devices_at_risk: [
    {
      id: "dev-1", name: "Reception PC", client_name: "Contoso", status: "online",
      patch_status: "needs_attention", pending_patches: 4,
    },
    { id: "dev-2", name: "Old NAS", client_name: "Fabrikam", status: "offline", patch_status: "stale" },
  ],
  source: "persisted-nexus-evidence",
};

const LEADS = [
  {
    id: "lead-1", company_name: "Northwind", contact_name: "Ada Lovelace", source: "referral",
    assigned_name: "Sam Campos", pipeline_stage: 3, status: "qualified",
    estimated_value: 12345.67, next_follow_up: "2026-10-20T09:00:00Z",
    last_contact: "2026-10-12T09:00:00Z",
  },
  {
    id: "lead-2", company_name: "Tailspin", status: "won",
    converted_to_client: "client-7", updated_at: "2026-10-10T09:00:00Z",
  },
];

const DOCS = [
  {
    id: "doc-1", client_id: "client-1", client_name: "Contoso", title: "VPN runbook",
    content: "<p>DOC-BODY-SENTINEL</p>", category: "Runbook", parent_id: null,
    is_template: false, tags: ["network", "vpn"], last_edited_by: "user-internal-9",
    last_edited_by_name: "Sam Campos", created_at: "2026-02-01T09:00:00Z",
    updated_at: "2026-10-09T09:00:00Z",
  },
  {
    id: "doc-2", client_id: null, client_name: null, title: "Shared security policy",
    content: "SECOND-BODY-SENTINEL", category: "Policy", is_template: false, tags: [],
    updated_at: "2026-08-01T09:00:00Z",
  },
];

const CSAT = {
  avg_score: 4.5,
  total_responses: 9,
  by_tech: [{ name: "Sam Campos", avg: 4.6, count: 5 }],
  // A client whose responses were recorded without an average: not a 0/5 average.
  by_client: [
    { name: "Contoso", avg: 4.8, count: 5 },
    { name: "Fabrikam", count: 4 },
  ],
  distribution: { "5": 6, "4": 2, "3": 1, "2": 0, "1": 0 },
};

// The API's own empty state: a zero average with no responses behind it.
const CSAT_EMPTY = {
  avg_score: 0, total_responses: 0, by_tech: [], by_client: [], trend: [], distribution: {},
};

const DEVICE_SPEC = { state: "wired", summary: "The canonical endpoint estate.", endpoint: "/devices", evidence: "app.routers.devices" };
const AGENT_SPEC = { state: "wired", summary: "The enrolled agent fleet.", endpoint: "/nexus-agent/agents", evidence: "app.routers.nexus_agent" };
const CLIENT_SPEC = { state: "wired", summary: "The account rollup.", endpoint: "/clients-enriched", evidence: "app.routers.clients" };
const BACKUP_SPEC = { state: "wired", summary: "Protected workloads.", endpoint: "/backup-dashboard/overview", evidence: "app.routers.backup_center" };
const M365_SPEC = { state: "wired", summary: "The observed Microsoft tenants.", endpoint: "/m365/tenants", evidence: "app.routers.m365" };
const VOICE_SPEC = { state: "wired", summary: "The linked voice estate.", endpoint: "/yeastar/pbxs", evidence: "app.routers.yeastar" };
const WEB_SPEC = { state: "wired", summary: "The managed website estate.", endpoint: "/web-studio/fleet", evidence: "app.routers.web_studio" };
const NETWORK_SPEC = { state: "wired", summary: "The network site register.", endpoint: "/networking/sites", evidence: "app.routers.networking" };
const PATCH_SPEC = { state: "wired", summary: "Observed endpoint patch state.", endpoint: "/patch-compliance/overview", evidence: "app.routers.patch_compliance" };
const SECURITY_SPEC = { state: "wired", summary: "Recorded security evidence.", endpoint: "/security-dashboard/overview", evidence: "app.routers.security_dashboard" };
const LEAD_SPEC = { state: "wired", summary: "The CRM's lead records.", endpoint: "/leads", evidence: "app.routers.crm" };
const DOCS_SPEC = { state: "wired", summary: "The documentation pages in scope.", endpoint: "/documentation", evidence: "app.routers.it_docs" };
const CSAT_SPEC = { state: "wired", summary: "Recorded customer feedback.", endpoint: "/csat/dashboard", evidence: "app.routers.csat_surveys" };

const STUDIO = { id: "devices", name: "Devices Studio" };

function mockApi(payload) {
  axios.get.mockImplementation(() => (
    payload instanceof Error ? Promise.reject(payload) : Promise.resolve({ data: payload })
  ));
}

describe("the observation kit", () => {
  test("only an adopted projection endpoint is mapped to a panel", () => {
    expect(studioObservationView("/devices")).toBe("device-estate");
    expect(studioObservationView("/nexus-agent/agents")).toBe("agent-fleet");
    expect(studioObservationView("/clients-enriched")).toBe("client-estate");
    expect(studioObservationView("/backup-dashboard/overview")).toBe("backup-recovery");
    expect(studioObservationView("/security-dashboard/overview")).toBe("security-posture");
    // A studio pointed somewhere else renders the generic tab, not a panel whose
    // field mapping would describe it wrongly.
    expect(studioObservationView("/proxmox/nodes")).toBe(null);
    expect(studioObservationView(null)).toBe(null);
  });

  test("every projection adopted in the second batch is mapped to its own panel", () => {
    expect(studioObservationView("/m365/tenants")).toBe("m365-tenants");
    expect(studioObservationView("/yeastar/pbxs")).toBe("voice-estate");
    expect(studioObservationView("/web-studio/fleet")).toBe("web-estate");
    expect(studioObservationView("/networking/sites")).toBe("network-sites");
    expect(studioObservationView("/patch-compliance/overview")).toBe("patch-posture");
    expect(studioObservationView("/leads")).toBe("lead-pipeline");
    expect(studioObservationView("/documentation")).toBe("documentation-inventory");
    expect(studioObservationView("/csat/dashboard")).toBe("communications-csat");
    // A neighbouring route of a mapped one is still not modelled here: the
    // endpoint decides, so the score trend is not given the posture panel.
    expect(studioObservationView("/security-dashboard/score-trend")).toBe(null);
  });

  test("a declared parameter builds the request, unbound values stay visible", () => {
    expect(resolveObservationEndpoint("/x/{platform}/y", { platform: "windows" })).toBe("/x/windows/y");
    expect(resolveObservationEndpoint("/x/{platform}/y", {})).toBe("/x/{platform}/y");
  });
});

describe("an adopted projection panel", () => {
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

  const render = (Panel, spec, studio = STUDIO) => act(async () => {
    root.render(<Panel studio={studio} spec={spec} />);
    await Promise.resolve();
    await Promise.resolve();
  });

  test("the device estate reads its registry endpoint and never blanks a field nobody reported", async () => {
    mockApi(DEVICES);
    await render(DeviceEstatePanel, DEVICE_SPEC);

    expect(axios.get).toHaveBeenCalledWith(`${BASE}/devices`, {
      headers: { Authorization: "Bearer session-token" },
    });
    expect(host.querySelector('[data-testid="studio-observation-header"]').textContent).toContain("/devices");
    const reported = host.querySelector('[data-testid="observation-row-dev-1"]').textContent;
    expect(reported).toContain("Contoso");
    expect(reported).toContain("10.0.0.10");
    expect(reported).toContain("1.4.2");
    // dev-2 reported no client name or address: both are disclosed, not blanked.
    const silent = host.querySelector('[data-testid="observation-row-dev-2"]').textContent;
    expect(silent).toContain("client-9");
    expect(silent).toContain("Not reported (IP address)");
    expect(silent).toContain("Not reported (agent version)");
    expect(host.querySelector('[data-testid="observation-total-Endpoints in scope"]').textContent).toContain("2");
    expect(host.querySelector('[data-testid="observation-total-Reporting online"]').textContent).toContain("1");
  });

  test("an empty endpoint estate is stated in the projection's terms, not as a clean zero", async () => {
    mockApi([]);
    await render(DeviceEstatePanel, DEVICE_SPEC);

    const empty = host.querySelector('[data-testid="studio-observation-empty"]').textContent;
    expect(empty).toContain("No endpoint record is in your scope");
    expect(empty).toContain("archived (retired)");
    expect(host.querySelector('[data-testid="studio-observation-rows"]')).toBeNull();
    expect(host.querySelector('[data-testid="studio-observation-totals"]')).toBeNull();
  });

  test("the agent fleet renders derived trust and never a token, key or fingerprint", async () => {
    mockApi(AGENTS);
    await render(AgentFleetPanel, AGENT_SPEC, { id: "agent", name: "Agent Studio" });

    expect(axios.get).toHaveBeenCalledWith(`${BASE}/nexus-agent/agents`, expect.any(Object));
    const verified = host.querySelector('[data-testid="observation-row-dev-1"]').textContent;
    expect(verified).toContain("mtls_verified");
    expect(verified).toContain("mtls");
    expect(verified).toContain("policy v4");
    const legacy = host.querySelector('[data-testid="observation-row-dev-2"]').textContent;
    expect(legacy).toContain("legacy_token");
    expect(legacy).toContain("Not reported (policy version)");
    // Trust is derived; the endpoint's own material is not this panel's to show.
    expect(host.textContent).not.toContain("must-not-be-rendered");
    expect(host.textContent).not.toContain("AA:BB");
    expect(host.querySelector('[data-testid="observation-total-mTLS verified identity"]').textContent).toContain("1");
  });

  test("the client estate reads the projection's own summary instead of recomputing it", async () => {
    mockApi(CLIENTS);
    await render(ClientEstatePanel, CLIENT_SPEC, { id: "client", name: "Client Studio" });

    expect(axios.get).toHaveBeenCalledWith(`${BASE}/clients-enriched`, expect.any(Object));
    expect(host.querySelector('[data-testid="observation-total-Clients in scope"]').textContent).toContain("2");
    expect(host.querySelector('[data-testid="observation-total-Average health score"]').textContent).toContain("78.4");
    const atRisk = host.querySelector('[data-testid="observation-row-client-2"]').textContent;
    expect(atRisk).toContain("Fabrikam");
    expect(atRisk).toContain("critical");
    expect(atRisk).toContain("3 devices");
    // Commercial value is deliberately not modelled by this panel.
    expect(host.textContent).not.toContain("3210.5");
  });

  test("a client read with no records in scope says so rather than showing an empty book", async () => {
    mockApi({ summary: { ...CLIENTS.summary, client_count: 0 }, clients: [] });
    await render(ClientEstatePanel, CLIENT_SPEC, { id: "client", name: "Client Studio" });

    expect(host.querySelector('[data-testid="studio-observation-empty"]').textContent)
      .toContain("No client record is in your scope");
    expect(host.querySelector('[data-testid="studio-observation-totals"]').textContent).toContain("0");
  });

  test("a backup workload with no recorded outcome is not reported, never a success", async () => {
    mockApi(BACKUP);
    await render(BackupRecoveryPanel, BACKUP_SPEC, { id: "backup", name: "Backup Studio" });

    expect(axios.get).toHaveBeenCalledWith(`${BASE}/backup-dashboard/overview`, expect.any(Object));
    const failed = host.querySelector('[data-testid="observation-row-job-2"]').textContent;
    expect(failed).toContain("failed");
    const unrecorded = host.querySelector('[data-testid="observation-row-job-3"]').textContent;
    expect(unrecorded).toContain("Not reported");
    expect(unrecorded).not.toContain("success");
    expect(host.querySelector('[data-testid="observation-total-Reported success rate"]').textContent).toContain("33.3%");
    // The endpoint's own Acronis fallback for the all-clients scope is disclosed.
    const boundary = host.querySelector('[data-testid="studio-backup-boundary"]').textContent;
    expect(boundary).toContain("Acronis-sourced rows");
    expect(boundary).toContain("never a verified restore");
  });

  test("no protected workload in scope is stated, not rendered as a clean posture", async () => {
    mockApi({ summary: { total_jobs: 0, successful: 0, failed: 0, running: 0, success_rate: 0, total_size_gb: 0 }, jobs: [] });
    await render(BackupRecoveryPanel, BACKUP_SPEC, { id: "backup", name: "Backup Studio" });

    const empty = host.querySelector('[data-testid="studio-backup-empty"]').textContent;
    expect(empty).toContain("No backup job record exists in your scope");
    expect(empty).toContain("not evidence that any workload is protected");

    expect(host.querySelector('[data-testid="studio-backup-totals"]')).toBeNull();
    expect(host.querySelector('[data-testid="studio-backup-workloads"]')).toBeNull();
  });

  test("a refused read states the failure instead of an empty, healthy-looking estate", async () => {
    mockApi(Object.assign(new Error("refused"), { response: { data: { detail: "Scope refused." } } }));
    await render(DeviceEstatePanel, DEVICE_SPEC);

    expect(host.querySelector('[data-testid="studio-observation-error"]').textContent).toContain("Scope refused.");
    expect(host.querySelector('[data-testid="studio-observation-rows"]')).toBeNull();
    expect(host.querySelector('[data-testid="studio-observation-empty"]')).toBeNull();
  });

  test("a contract that leaves its endpoint unbound requests nothing and says why", async () => {
    mockApi(DEVICES);
    await render(DeviceEstatePanel, { ...DEVICE_SPEC, endpoint: "/devices/{kind}" });

    expect(axios.get).not.toHaveBeenCalled();
    const unbound = host.querySelector('[data-testid="studio-observation-unbound"]');
    expect(unbound.textContent).toContain("carries a value the registry never declared");
    expect(host.querySelector('[data-testid="studio-observation-totals"]')).toBeNull();
  });

  test("the M365 estate reads the tenant mapping and never turns an unreported figure into a zero", async () => {
    mockApi(M365);
    await render(M365TenantPanel, M365_SPEC, { id: "m365", name: "M365 Studio" });

    expect(axios.get).toHaveBeenCalledWith(`${BASE}/m365/tenants`, expect.any(Object));
    expect(host.querySelector('[data-testid="studio-m365-tenants"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="studio-observation-header"]').textContent).toContain("/m365/tenants");
    const mapped = host.querySelector('[data-testid="observation-row-tenant-1"]').textContent;
    expect(mapped).toContain("Contoso");
    expect(mapped).toContain("240 users");
    expect(mapped).toContain("82 % MFA enrolled");
    expect(mapped).toContain("Secure Score 71");
    // A tenant the provider has reported nothing about is not 0 users, 0% MFA or
    // a Secure Score of zero.
    const silent = host.querySelector('[data-testid="observation-row-tenant-2"]').textContent;
    expect(silent).toContain("Not reported (user count)");
    expect(silent).toContain("Not reported (MFA enrolment)");
    expect(silent).toContain("Not reported (Secure Score)");
    // No verdict and no observation time: the panel invents neither.
    expect(silent).toContain("Not reported (observation time)");
    const namedByCollectionField =
      host.querySelector('[data-testid="observation-row-tenant-3"]').textContent;
    expect(namedByCollectionField).toContain("Northwind");
    expect(namedByCollectionField).toContain("northwind.test");
    expect(host.querySelector('[data-testid="observation-total-Tenants in scope"]').textContent).toContain("3");
    expect(host.querySelector('[data-testid="observation-total-Tenants reporting a user count"]').textContent).toContain("2");
    expect(host.querySelector('[data-testid="observation-total-Tenants reporting a Secure Score"]').textContent).toContain("1");
    // The projection is the mapping, not the credential behind it.
    expect(host.textContent).not.toContain("m365-tenant-secret");
  });

  test("the voice estate renders the linked PBXs and no credential material at all", async () => {
    mockApi(VOICE);
    await render(VoiceEstatePanel, VOICE_SPEC, { id: "voice", name: "Voice Studio" });

    expect(axios.get).toHaveBeenCalledWith(`${BASE}/yeastar/pbxs`, expect.any(Object));
    expect(host.querySelector('[data-testid="studio-voice-estate"]')).not.toBeNull();
    const linked = host.querySelector('[data-testid="observation-row-pbx-1"]').textContent;
    expect(linked).toContain("Contoso HQ");
    expect(linked).toContain("24 extensions");
    expect(linked).toContain("20 billable");
    expect(linked).toContain("online");
    // A PBX that has not reported its counts says so instead of reporting zero.
    const silent = host.querySelector('[data-testid="observation-row-pbx-2"]').textContent;
    expect(silent).toContain("Not reported (extension count)");
    expect(silent).toContain("Not reported (billable extension count)");
    expect(host.querySelector('[data-testid="observation-total-PBXs in scope"]').textContent).toContain("2");
    expect(host.querySelector('[data-testid="observation-total-Reporting online"]').textContent).toContain("1");
    expect(host.querySelector('[data-testid="observation-total-Enabled for sync"]').textContent).toContain("1");
    expect(host.querySelector('[data-testid="observation-total-Extensions reported"]').textContent).toContain("24");
    // The provider secret and credential identifier are not this tab's to show,
    // even though the fixture carries them.
    expect(host.textContent).not.toContain("voice-client-secret");
    expect(host.textContent).not.toContain("voice-api-id");
  });

  test("the web estate keeps 'nothing found' apart from 'not yet checked'", async () => {
    mockApi(WEB);
    await render(WebEstatePanel, WEB_SPEC, { id: "web", name: "Web Studio" });

    expect(axios.get).toHaveBeenCalledWith(`${BASE}/web-studio/fleet`, expect.any(Object));
    expect(host.querySelector('[data-testid="studio-web-estate"]')).not.toBeNull();
    const plugins = host.querySelector('[data-testid="observation-total-Plugin updates recorded"]').textContent;
    expect(plugins).toContain("3");
    expect(plugins).not.toContain("Not assessed");
    // Security was never assessed: a zero finding count must not read as clean.
    const security = host.querySelector('[data-testid="observation-total-Security findings"]').textContent;
    expect(security).toContain("Not assessed");
    expect(host.querySelector('[data-testid="observation-total-Managed websites"]').textContent).toContain("2");
    const assessedSite = host.querySelector('[data-testid="observation-row-ws-1"]').textContent;
    expect(assessedSite).toContain("contoso.test");
    expect(assessedSite).toContain("attention");
    expect(assessedSite).toContain("Plugin updates pending");
    const sparse = host.querySelector('[data-testid="observation-row-ws-2"]').textContent;
    expect(sparse).toContain("Not reported (client)");
    expect(sparse).toContain("Not reported (primary domain)");
    // Another surface's connection state is not rendered here.
    expect(host.textContent).not.toContain("web-synergy-key");
  });

  test("a web read with no site record in scope is stated, not dressed as a clean fleet", async () => {
    mockApi({ ...WEB, sites: [] });
    await render(WebEstatePanel, WEB_SPEC, { id: "web", name: "Web Studio" });

    expect(host.querySelector('[data-testid="studio-observation-empty"]').textContent)
      .toContain("No managed website record is in your scope");
    expect(host.querySelector('[data-testid="studio-observation-rows"]')).toBeNull();
  });

  test("the network estate reads the site register with controller credentials stripped", async () => {
    mockApi(NETWORK);
    await render(NetworkSitesPanel, NETWORK_SPEC, { id: "network", name: "Network Studio" });

    expect(axios.get).toHaveBeenCalledWith(`${BASE}/networking/sites`, expect.any(Object));
    const site = host.querySelector('[data-testid="observation-row-site-1"]').textContent;
    expect(site).toContain("Contoso HQ");
    expect(site).toContain("203.0.113.7");
    expect(site).toContain("BT");
    expect(site).toContain("default");
    const sparse = host.querySelector('[data-testid="observation-row-site-2"]').textContent;
    expect(sparse).toContain("Not reported (WAN address)");
    expect(sparse).toContain("Not reported (ISP)");
    // A record carries a creation time, not an observation time: time is not faked.
    expect(sparse).toContain("Not reported (observation time)");
    expect(host.querySelector('[data-testid="observation-total-Sites in scope"]').textContent).toContain("2");
    expect(host.querySelector('[data-testid="observation-total-Reporting online"]').textContent).toContain("1");
    expect(host.querySelector('[data-testid="observation-total-With a reported WAN address"]').textContent).toContain("1");
    expect(host.querySelector('[data-testid="observation-total-With a reported link speed"]').textContent).toContain("1");
    // Credentials and operator notes are not part of this read.
    expect(host.textContent).not.toContain("network-controller-secret");
    expect(host.textContent).not.toContain("Operator note");
  });

  test("patch posture turns neither an unassessed percentage into 0% nor a hardcoded zero into an all-clear", async () => {
    mockApi(PATCH);
    await render(PatchPosturePanel, PATCH_SPEC, { id: "patch", name: "Patch Studio" });

    expect(axios.get).toHaveBeenCalledWith(`${BASE}/patch-compliance/overview`, expect.any(Object));
    const reporting = host.querySelector('[data-testid="observation-row-dev-1"]').textContent;
    expect(reporting).toContain("Reception PC");
    expect(reporting).toContain("ring ring-a");
    expect(reporting).toContain("4 pending");
    expect(reporting).toContain("needs_attention");
    const silent = host.querySelector('[data-testid="observation-row-dev-2"]').textContent;
    expect(silent).toContain("Not reported (pending updates)");
    expect(host.querySelector('[data-testid="observation-total-Endpoints reporting patch state"]').textContent).toContain("3");
    // compliance_pct is null until something is assessed: never "0%".
    const compliance = host.querySelector('[data-testid="observation-total-Reported compliance"]').textContent;
    expect(compliance).toContain("Not reported");
    expect(compliance).not.toContain("0");
    expect(host.textContent).not.toContain("0%");
    // Severity is not in the agent payload, so `critical: 0` is not a headline.
    const totals = host.querySelector('[data-testid="studio-patch-totals"]').textContent;
    expect(totals).not.toMatch(/critical/i);
    expect(host.querySelector('[data-testid="observation-total-Critical"]')).toBeNull();
    const boundary = host.querySelector('[data-testid="studio-patch-boundary"]').textContent;
    expect(boundary).toContain("Severity is not part of the reported payload");
    expect(boundary).toContain("is not a measured all-clear");
    expect(host.querySelector('[data-testid="studio-patch-message"]').textContent)
      .toContain("no fresh report exists for every endpoint");
  });

  test("patch posture with nothing reported is an observed absence, not a compliant estate", async () => {
    mockApi({ ...PATCH, devices: [], summary: { ...PATCH.summary, assessed_devices: 0 } });
    await render(PatchPosturePanel, PATCH_SPEC, { id: "patch", name: "Patch Studio" });

    expect(host.querySelector('[data-testid="studio-patch-empty"]').textContent)
      .toContain("observed absence, not a compliant estate");
    expect(host.querySelector('[data-testid="studio-patch-totals"]')).toBeNull();
    expect(host.querySelector('[data-testid="studio-patch-endpoints"]')).toBeNull();
  });

  test("security posture reports identity and a null score as unmeasured, never as zero", async () => {
    mockApi(SECURITY);
    await render(SecurityPosturePanel, SECURITY_SPEC, { id: "security", name: "Security Studio" });

    expect(axios.get).toHaveBeenCalledWith(`${BASE}/security-dashboard/overview`, expect.any(Object));
    expect(host.querySelector('[data-testid="studio-security-posture"]')).not.toBeNull();
    const score = host.querySelector('[data-testid="observation-total-Reported security score"]').textContent;
    expect(score).toContain("Not reported");
    expect(score).not.toContain("0");
    const compliance = host.querySelector('[data-testid="observation-total-Reported patch compliance"]').textContent;
    expect(compliance).toContain("Not reported");
    expect(compliance).not.toContain("0%");
    // identity_alerts is null because no identity source is wired: that is not
    // "no identity alerts".
    // The value element carries the disclosure; the detail that names the missing
    // source is its sibling, so the whole total is asserted here.
    const identityValue = host.querySelector('[data-testid="observation-total-Identity alerts"]');
    expect(identityValue.textContent).toContain("Not reported");
    const identity = identityValue.parentElement.textContent;
    expect(identity).toContain("No identity threat source is configured");
    expect(identity).toContain("unmeasured rather than at zero alerts");
    expect(host.querySelector('[data-testid="observation-total-Agent-assessed endpoints"]').textContent).toContain("8");
    const atRisk = host.querySelector('[data-testid="observation-row-dev-1"]').textContent;
    expect(atRisk).toContain("Contoso");
    expect(atRisk).toContain("endpoint online");
    expect(atRisk).toContain("4 pending patch(es)");
    expect(atRisk).toContain("needs_attention");
    // The row's tone is the patch verdict it reports, not the online status beside it.
    expect(host.querySelector('[data-testid="observation-row-dev-1"] span').className)
      .toContain("bg-amber-500");
    expect(host.querySelector('[data-testid="studio-security-evidence-source"]').textContent)
      .toContain("persisted-nexus-evidence");
  });

  test("security with no assessed endpoint at risk is not read as a clean estate", async () => {
    mockApi({ ...SECURITY, devices_at_risk: [] });
    await render(SecurityPosturePanel, SECURITY_SPEC, { id: "security", name: "Security Studio" });

    const empty = host.querySelector('[data-testid="studio-observation-empty"]').textContent;
    expect(empty).toContain("No assessed endpoint is carrying pending patches");
    expect(empty).toContain("not a clean estate");
    expect(empty).toContain("never assessed");
    expect(host.querySelector('[data-testid="studio-observation-rows"]')).toBeNull();
  });

  test("the lead pipeline names what each record carries and renders no money", async () => {
    mockApi(LEADS);
    await render(LeadPipelinePanel, LEAD_SPEC, { id: "lead", name: "Lead Studio" });

    expect(axios.get).toHaveBeenCalledWith(`${BASE}/leads`, expect.any(Object));
    const open = host.querySelector('[data-testid="observation-row-lead-1"]').textContent;
    expect(open).toContain("Northwind");
    expect(open).toContain("Ada Lovelace");
    expect(open).toContain("referral");
    expect(open).toContain("Sam Campos");
    expect(open).toContain("stage 3 of 6");
    const sparse = host.querySelector('[data-testid="observation-row-lead-2"]').textContent;
    expect(sparse).toContain("Not reported (contact)");
    expect(sparse).toContain("Not reported (source)");
    expect(sparse).toContain("Not reported (owner)");
    expect(sparse).toContain("Not reported (stage)");
    expect(host.querySelector('[data-testid="observation-total-Leads in scope"]').textContent).toContain("2");
    expect(host.querySelector('[data-testid="observation-total-Open"]').textContent).toContain("1");
    expect(host.querySelector('[data-testid="observation-total-Converted to a client"]').textContent).toContain("1");
    expect(host.querySelector('[data-testid="observation-total-With a follow-up recorded"]').textContent).toContain("1");
    // No currency convention is verified, so no value is rendered or summed.
    expect(host.textContent).not.toContain("12345");
  });

  test("an empty pipeline read says the studio is observing nothing, not that sales has no pipeline", async () => {
    mockApi([]);
    await render(LeadPipelinePanel, LEAD_SPEC, { id: "lead", name: "Lead Studio" });

    expect(host.querySelector('[data-testid="studio-observation-empty"]').textContent)
      .toContain("observing an empty pipeline");
  });

  test("the documentation inventory names scope and editor but never the document body", async () => {
    mockApi(DOCS);
    await render(DocumentationInventoryPanel, DOCS_SPEC, { id: "documentation", name: "Documentation Studio" });

    expect(axios.get).toHaveBeenCalledWith(`${BASE}/documentation`, expect.any(Object));
    const scoped = host.querySelector('[data-testid="observation-row-doc-1"]').textContent;
    expect(scoped).toContain("VPN runbook");
    expect(scoped).toContain("Contoso");
    expect(scoped).toContain("tags: network, vpn");
    expect(scoped).toContain("Sam Campos");
    // A page with no client is shared knowledge, which is a real state rather
    // than a missing value.
    const shared = host.querySelector('[data-testid="observation-row-doc-2"]').textContent;
    expect(shared).toContain("Shared MSP knowledge");
    expect(host.querySelector('[data-testid="observation-total-Documents in scope"]').textContent).toContain("2");
    expect(host.querySelector('[data-testid="observation-total-Shared (not client-linked)"]').textContent).toContain("1");
    expect(host.querySelector('[data-testid="observation-total-Client-scoped"]').textContent).toContain("1");
    expect(host.querySelector('[data-testid="observation-total-Templates"]').textContent).toContain("0");
    // The body is not this tab's evidence and the internal id is not reportable.
    expect(host.textContent).not.toContain("DOC-BODY-SENTINEL");
    expect(host.textContent).not.toContain("SECOND-BODY-SENTINEL");
    expect(host.textContent).not.toContain("user-internal-9");
    // Freshness is the studio's own capability and is stated as unassessed here.
    expect(host.textContent).toContain("not yet assessed");
  });

  test("the CSAT projection renders recorded averages and skips the bands nobody used", async () => {
    mockApi(CSAT);
    await render(CommunicationsPanel, CSAT_SPEC, { id: "communications", name: "Communications Studio" });

    expect(axios.get).toHaveBeenCalledWith(`${BASE}/csat/dashboard`, expect.any(Object));
    expect(host.querySelector('[data-testid="studio-communications-totals"]').textContent).toContain("9");
    expect(host.querySelector('[data-testid="observation-total-Average score"]').textContent).toContain("4.5");
    const answered = host.querySelector('[data-testid="observation-row-Contoso"]').textContent;
    expect(answered).toContain("5 responses");
    expect(answered).toContain("4.8/5 average");
    const partial = host.querySelector('[data-testid="observation-row-Fabrikam"]').textContent;
    expect(partial).toContain("4 responses");
    expect(partial).toContain("Not reported (average score)");
    const distribution = host.querySelector('[data-testid="studio-communications-distribution"]').textContent;
    expect(distribution).toContain("5: 6");
    expect(distribution).toContain("3: 1");
    expect(distribution).not.toContain("2: 0");
  });

  test("a CSAT projection with no responses states that instead of showing 0/5", async () => {
    mockApi(CSAT_EMPTY);
    await render(CommunicationsPanel, CSAT_SPEC, { id: "communications", name: "Communications Studio" });

    const empty = host.querySelector('[data-testid="studio-communications-empty"]').textContent;
    expect(empty).toContain("No survey response is recorded in your scope");
    expect(empty).toContain("nobody answering is a response rate");
    // The API's zero average is an empty state, never a satisfaction score: no
    // score figure and no response count are painted at all.
    expect(host.querySelector('[data-testid="studio-communications-totals"]')).toBeNull();
    expect(host.querySelector('[data-testid="observation-total-Average score"]')).toBeNull();
    expect(host.querySelector('[data-testid="observation-total-Responses recorded"]')).toBeNull();
    expect(host.querySelector('[data-testid="studio-communications-clients"]')).toBeNull();
  });
});
