/* eslint-disable testing-library/no-unnecessary-act -- Native React createRoot requires act. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";

import FleetBaselinePanel, { fleetBaselineView, resolveTabEndpoint } from "./FleetBaselinePanel";

// The `@/` alias is a webpack/craco alias with no jest mapping. The kit is the
// real module — the panel's whole job is that its disclosures are the ones the
// page renders — and every aliased module it reaches is registered below.
jest.mock("axios", () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock("@/App", () => ({
  __esModule: true,
  API: "http://api.test/api",
  useAuth: () => ({ token: "session-token" }),
}), { virtual: true });
jest.mock("@/lib/apiErrorMessage", () => ({
  apiErrorMessage: (error, fallback) => error?.response?.data?.detail || fallback,
}), { virtual: true });
jest.mock("@/components/fleet/FleetBaselineKit", () => jest.requireActual("../fleet/FleetBaselineKit"), { virtual: true });
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
  Button: ({ children, variant: _variant, size: _size, className, ...props }) => (
    <button className={className} {...props}>{children}</button>
  ),
}), { virtual: true });
jest.mock("@/components/ui/table", () => ({
  Table: ({ children, ...props }) => <table {...props}>{children}</table>,
  TableBody: ({ children }) => <tbody>{children}</tbody>,
  TableCell: ({ children, className }) => <td className={className}>{children}</td>,
  TableHead: ({ children }) => <th>{children}</th>,
  TableHeader: ({ children }) => <thead>{children}</thead>,
  TableRow: ({ children, ...props }) => <tr {...props}>{children}</tr>,
}), { virtual: true });

const BASE = "http://api.test/api";
const BOUNDARY = "A deviation is a difference from the estate's own measured median, never a fault, a cause or a prediction.";

const WINDOWS_COHORT = {
  platform: "windows",
  label: "Windows",
  device_count: 6,
  measured_device_count: 6,
  baseline_established: true,
  minimum_devices: 5,
  unestablished_reason: null,
  metrics: {
    cpu_usage: { label: "CPU", measured_count: 6, median: 20, spread: 4, unit: "%", established: true, reason: null },
    disk_usage: { label: "Disk", measured_count: 0, median: null, spread: null, unit: "%", established: false, reason: "No endpoint in this cohort reported this metric." },
  },
  bands: { critical: 0, degraded: 0, watch: 0, healthy: 6, unknown: 0 },
};

const UNMEASURED_COHORT = {
  ...WINDOWS_COHORT,
  platform: "linux",
  label: "Linux",
  device_count: 2,
  measured_device_count: 2,
  baseline_established: false,
  unestablished_reason: "2 of 2 endpoints reported a metric; 5 measured endpoints are needed before a cohort baseline exists.",
};

const CONTRACT = {
  cohorts: [WINDOWS_COHORT, UNMEASURED_COHORT],
  metrics: [{ key: "cpu_usage", label: "CPU", unit: "%" }, { key: "disk_usage", label: "Disk", unit: "%" }],
  minimum_cohort_devices: 5,
  minimum_recurring_devices: 2,
  strong_deviation_ratio: 0.5,
  notable_deviation_ratio: 0.2,
  device_count: 8,
  note: "A cohort is the caller's own scoped estate, grouped by operating system.",
  boundary: BOUNDARY,
};

const DEVIATIONS = {
  platform: "windows",
  cohort: WINDOWS_COHORT,
  devices: [
    {
      device_id: "d-hot", name: "Hot endpoint", hostname: "hot.example.test",
      band: "degraded", samples: 12, verdict: "strong",
      deviations: [
        {
          metric: "cpu_usage", label: "CPU", unit: "%", value: 95,
          cohort_median: 20, delta: 75, verdict: "strong",
          basis: "95% against a cohort median of 20% across 6 measured Windows endpoints (CPU).",
        },
      ],
      unmeasured: [{ metric: "disk_usage", label: "Disk", reason: "This endpoint has not reported this metric." }],
    },
    {
      device_id: "d-silent", name: "Silent endpoint", hostname: "silent.example.test",
      band: "unknown", samples: null, verdict: "not_measured", deviations: [],
      unmeasured: [{ metric: "cpu_usage", label: "CPU", reason: "This endpoint has not reported this metric." }],
    },
  ],
  note: "Devices are ordered by the worst verdict they carry.",
  boundary: BOUNDARY,
};

const RECURRENCE = {
  platform: "windows",
  cohort: WINDOWS_COHORT,
  shapes: [
    {
      id: "windows|cpu_usage|above|strong", platform: "windows", metric: "cpu_usage", label: "CPU",
      direction: "above", verdict: "strong", device_count: 3, device_names: ["Alpha", "Bravo", "Charlie"],
      cohort_median: 20, basis: "3 of 6 measured Windows endpoints sit more than 50% above the cohort median of 20% for CPU.",
    },
  ],
  minimum_devices: 2,
  note: "A shape needs at least two endpoints before it is reported as shared.",
  boundary: BOUNDARY,
};

const WINDOWS_STUDIO = { id: "windows", name: "Windows Studio" };

/** The Diagnostics tab exactly as the registry declares it. */
const DEVIATION_SPEC = {
  state: "wired",
  summary: "Every Windows endpoint against its cohort's baseline.",
  endpoint: "/fleet-baseline/cohorts/{platform}/deviations",
  params: { platform: "windows" },
  evidence: "app.routers.fleet_baseline",
};

const RECURRENCE_SPEC = {
  state: "wired",
  summary: "Shapes more than one endpoint shares.",
  endpoint: "/fleet-baseline/cohorts/{platform}/recurrence",
  params: { platform: "windows" },
  evidence: "app.routers.fleet_baseline",
};

const CONTRACT_SPEC = {
  state: "wired",
  summary: "The cohort contract.",
  endpoint: "/fleet-baseline/contract",
  evidence: "app.routers.fleet_baseline",
};

/** The tab that raises a shape as a change request, as the registry declares it. */
const PROPOSAL_SPEC = {
  state: "wired",
  summary: "Each recurring shape and the change request it would raise.",
  endpoint: "/fleet-baseline/cohorts/{platform}/proposed-changes",
  params: { platform: "windows" },
  evidence: "app.routers.fleet_baseline",
  subjects: ["endpoint.deviation.change.proposed"],
};

const PROPOSALS = {
  platform: "windows",
  cohort: WINDOWS_COHORT,
  minimum_devices: 2,
  shapes: [
    {
      shape_id: "windows|cpu_usage|above|strong", metric: "cpu_usage", label: "CPU",
      direction: "above", verdict: "strong", device_count: 3, device_names: ["Alpha", "Bravo", "Charlie"],
      basis: "3 of 6 measured Windows endpoints sit more than 50% above the cohort median of 20% for CPU.",
      proposed: true, reason: null, detail: null,
      change: {
        title: "Cpu usage is above the Windows cohort median on 3 endpoints",
        description: "3 endpoints share a strong deviation in CPU.",
        category: "normal", risk_level: "high",
        verification: "Re-read the deviations view after the repair and check CPU on the 3 named endpoints.",
        rollback_plan: "No Nexus rollback is required, because Nexus has executed nothing: this is a proposal only.",
      },
    },
    {
      shape_id: "windows|memory_usage|above|notable", metric: "memory_usage", label: "Memory",
      direction: "above", verdict: "notable", device_count: 2, device_names: ["Delta", "Echo"],
      basis: "2 of 6 measured Windows endpoints sit more than 20% above the cohort median of 40% for Memory.",
      proposed: false, reason: "already_open",
      detail: "Change CHG-OPEN01 is already open for this shape (status approved).",
      existing_change_id: "CHG-OPEN01",
    },
  ],
  proposable_count: 1,
  open_change_count: 1,
  note: "Each row is the change request a shape would raise.",
  boundary: "A proposal is a request for work, not work: Nexus has executed nothing on any endpoint.",
};

function mockApi({ contract = CONTRACT, deviations = DEVIATIONS, recurrence = RECURRENCE, proposals = PROPOSALS } = {}) {
  axios.get.mockImplementation((url) => {
    if (url.endsWith("/fleet-baseline/contract")) return Promise.resolve({ data: contract });
    if (url.includes("/proposed-changes")) return Promise.resolve({ data: proposals });
    if (url.includes("/deviations")) return Promise.resolve({ data: deviations });
    if (url.includes("/recurrence")) return Promise.resolve({ data: recurrence });
    return Promise.reject(new Error(`unexpected url ${url}`));
  });
}

describe("the registry's endpoint parameters", () => {
  test("a declared value builds the request the tab names", () => {
    expect(resolveTabEndpoint("/fleet-baseline/cohorts/{platform}/deviations", { platform: "windows" }))
      .toBe("/fleet-baseline/cohorts/windows/deviations");
  });

  test("a value is encoded rather than concatenated raw", () => {
    expect(resolveTabEndpoint("/cohorts/{platform}/x", { platform: "a b/c" }))
      .toBe("/cohorts/a%20b%2Fc/x");
  });

  test("a placeholder the registry never bound stays visible instead of resolving to guesswork", () => {
    expect(resolveTabEndpoint("/fleet-baseline/cohorts/{platform}/deviations", {}))
      .toBe("/fleet-baseline/cohorts/{platform}/deviations");
  });

  test("only a fleet-baseline question is rendered by this panel", () => {
    expect(fleetBaselineView("/fleet-baseline/cohorts/windows/deviations")).toBe("deviations");
    expect(fleetBaselineView("/fleet-baseline/cohorts/{platform}/recurrence")).toBe("recurrence");
    expect(fleetBaselineView("/fleet-baseline/contract")).toBe("contract");
    expect(fleetBaselineView("/proxmox/nodes")).toBe(null);
    expect(fleetBaselineView(null)).toBe(null);
  });
});

describe("the studio Diagnostics deviation view", () => {
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

  const render = (studio, spec) => act(async () => {
    root.render(<FleetBaselinePanel studio={studio} spec={spec} />);
    await Promise.resolve();
  });

  test("reads the cohort the registry bound, never a literal placeholder", async () => {
    mockApi();
    await render(WINDOWS_STUDIO, DEVIATION_SPEC);

    expect(axios.get).toHaveBeenCalledWith(`${BASE}/fleet-baseline/cohorts/windows/deviations`, {
      headers: { Authorization: "Bearer session-token" },
    });
    const urls = axios.get.mock.calls.map(([url]) => url);
    expect(urls.some((url) => url.includes("{"))).toBe(false);
    // The cohort actually read is disclosed, not implied by the tab's title.
    expect(host.querySelector('[data-testid="studio-baseline-cohort-read"]').textContent)
      .toContain("Cohort read: Windows");
  });

  test("renders each deviation with its basis and lists the metrics nobody reported", async () => {
    mockApi();
    await render(WINDOWS_STUDIO, DEVIATION_SPEC);

    expect(host.querySelector('[data-testid="studio-baseline-cohort"]').textContent)
      .toContain("Baseline established");
    const deviation = host.querySelector('[data-testid="baseline-deviation-d-hot-cpu_usage"]').textContent;
    expect(deviation).toContain("cohort median 20%");
    expect(deviation).toContain("Well outside the cohort");
    expect(deviation).toContain("95% against a cohort median of 20% across 6 measured Windows endpoints");
    expect(host.querySelector('[data-testid="baseline-unmeasured-d-hot"]').textContent)
      .toContain("Disk: This endpoint has not reported this metric.");
    // An endpoint that reported nothing is not rendered as a clean row.
    expect(host.querySelector('[data-testid="baseline-device-d-silent"]').textContent)
      .toContain("nothing is compared and nothing is claimed");
    expect(host.querySelector('[data-testid="studio-baseline-boundary"]').textContent).toBe(BOUNDARY);
  });

  test("a metric the cohort never measured is not reported, never zero", async () => {
    mockApi();
    await render(WINDOWS_STUDIO, DEVIATION_SPEC);

    const median = host.querySelector('[data-testid="baseline-median-disk_usage"]');
    expect(median.textContent).toBe("Not reported");
    expect(median.textContent).not.toContain("0");
  });

  test("a cohort too small to define a baseline does not grade anyone", async () => {
    mockApi({ deviations: { ...DEVIATIONS, cohort: UNMEASURED_COHORT } });
    await render(WINDOWS_STUDIO, DEVIATION_SPEC);

    expect(host.querySelector('[data-testid="baseline-unestablished"]').textContent)
      .toContain("5 measured endpoints are needed");
    expect(host.querySelector('[data-testid="studio-baseline-cohort"]').textContent)
      .toContain("No baseline yet");
  });

  test("a cohort the API does not know is disclosed instead of shown as an empty estate", async () => {
    mockApi({ deviations: { platform: "windows", cohort: null, devices: [], note: "No endpoint in scope belongs to this cohort.", boundary: BOUNDARY } });
    await render(WINDOWS_STUDIO, DEVIATION_SPEC);

    expect(host.querySelector('[data-testid="studio-baseline-unknown-cohort"]').textContent)
      .toContain("No endpoint in scope belongs to this cohort.");
    expect(host.querySelector('[data-testid="studio-baseline-devices"]')).toBeNull();
  });

  test("the Endpoint Performance recurrence tab counts the endpoints sharing a shape", async () => {
    mockApi();
    await render({ id: "endpoint-performance", name: "Endpoint Performance Studio" }, RECURRENCE_SPEC);

    expect(axios.get).toHaveBeenCalledWith(`${BASE}/fleet-baseline/cohorts/windows/recurrence`, expect.any(Object));
    expect(host.querySelector('[data-testid="studio-baseline-devices"]')).toBeNull();
    expect(host.querySelector('[data-testid="studio-baseline-shapes"]').textContent)
      .toContain("3 endpoints above the median for CPU");
    expect(host.querySelector('[data-testid="baseline-shape-basis-0"]').textContent)
      .toBe("3 of 6 measured Windows endpoints sit more than 50% above the cohort median of 20% for CPU.");
  });

  test("the cohort contract tab discloses the thresholds and every cohort", async () => {
    mockApi();
    await render(WINDOWS_STUDIO, CONTRACT_SPEC);

    expect(axios.get).toHaveBeenCalledWith(`${BASE}/fleet-baseline/contract`, expect.any(Object));
    const thresholds = host.querySelector('[data-testid="studio-baseline-thresholds"]').textContent;
    expect(thresholds).toContain("Measured endpoints a baseline needs");
    expect(thresholds).toContain("±20% / ±50%");
    const cohorts = host.querySelector('[data-testid="studio-baseline-cohorts"]').textContent;
    expect(cohorts).toContain("Windows · 6/6 measured");
    // A cohort without a baseline says so rather than reading as comparable.
    expect(host.querySelector('[data-testid="studio-cohort-linux"]').textContent)
      .toContain("no baseline yet");
  });

  test("a contract that leaves its cohort unbound requests nothing and says why", async () => {
    mockApi();
    await render(WINDOWS_STUDIO, { ...DEVIATION_SPEC, params: {} });

    // The registry refuses this at import; the panel refuses it again on the wire.
    expect(axios.get).not.toHaveBeenCalled();
    const unbound = host.querySelector('[data-testid="studio-baseline-unbound"]');
    expect(unbound).not.toBeNull();
    expect(unbound.textContent).toContain("carries a value the registry never declared");
    expect(host.querySelector('[data-testid="studio-baseline-devices"]')).toBeNull();
    expect(host.querySelector('[data-testid="studio-baseline-cohort"]')).toBeNull();
  });

  test("a failed read states the failure instead of rendering an empty, clean cohort", async () => {
    axios.get.mockRejectedValue({ response: { data: { detail: "Cohort read refused." } } });
    await render(WINDOWS_STUDIO, DEVIATION_SPEC);

    expect(host.querySelector('[data-testid="studio-baseline-error"]').textContent)
      .toContain("Cohort read refused.");
    expect(host.querySelector('[data-testid="studio-baseline-devices"]')).toBeNull();
    expect(host.querySelector('[data-testid="studio-baseline-cohort"]')).toBeNull();
  });
});

describe("a shape raised as proposed work", () => {
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

  const render = (studio, spec) => act(async () => {
    root.render(<FleetBaselinePanel studio={studio} spec={spec} />);
    await Promise.resolve();
  });

  test("the proposals endpoint is recognised as its own view", () => {
    expect(fleetBaselineView("/fleet-baseline/cohorts/windows/proposed-changes")).toBe("proposals");
    expect(fleetBaselineView("/fleet-baseline/cohorts/windows/recurrence")).toBe("recurrence");
  });

  test("the tab reads the cohort its registry entry bound and shows what each shape would raise", async () => {
    mockApi();
    await render(WINDOWS_STUDIO, PROPOSAL_SPEC);

    expect(axios.get).toHaveBeenCalledWith(`${BASE}/fleet-baseline/cohorts/windows/proposed-changes`, expect.any(Object));
    const first = host.querySelector('[data-testid="baseline-proposal-0"]').textContent;
    expect(first).toContain("Raisable now");
    expect(first).toContain("Verification: Re-read the deviations view");
    expect(first).toContain("executed nothing");
    // The change is shown as a request, never as an applied repair.
    expect(first).toContain("nothing is executed on any endpoint");
    expect(first).not.toContain("Applied");
  });

  test("a shape that already has an open change names it instead of proposing a second", async () => {
    mockApi();
    await render(WINDOWS_STUDIO, PROPOSAL_SPEC);

    const second = host.querySelector('[data-testid="baseline-proposal-1"]').textContent;
    expect(second).toContain("Already raised");
    expect(second).toContain("CHG-OPEN01");
    expect(host.querySelector('[data-testid="baseline-proposal-title-1"]')).toBeNull();
  });

  test("no raisable shape is stated rather than rendered as a clean, empty panel", async () => {
    mockApi({ proposals: { ...PROPOSALS, shapes: [], proposable_count: 0, open_change_count: 0 } });
    await render(WINDOWS_STUDIO, PROPOSAL_SPEC);

    const list = host.querySelector('[data-testid="studio-baseline-proposals"]');
    expect(list.textContent).toContain("No shape in this cohort can raise a change");
    expect(list.textContent).toContain("a proposal may only cite evidence the deviation view already returns");
  });
});
