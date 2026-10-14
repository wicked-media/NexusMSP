/* eslint-disable testing-library/no-unnecessary-act -- Native React createRoot requires act. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";

import FleetBaselinePage from "./FleetBaselinePage";

// The `@/` alias is a webpack/craco alias with no jest mapping, so every aliased
// module the page reaches is registered here. Router state is mocked because the
// two studios link to this page with query strings, which is the contract this
// test exists to pin.
let mockParams = new URLSearchParams("");
const mockSetParams = jest.fn();

jest.mock("axios", () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock("react-router-dom", () => ({
  __esModule: true,
  useSearchParams: () => [mockParams, mockSetParams],
}), { virtual: true });
jest.mock("@/App", () => ({
  __esModule: true,
  API: "http://api.test/api",
  useAuth: () => ({ token: "session-token" }),
}), { virtual: true });
jest.mock("@/lib/apiErrorMessage", () => ({
  apiErrorMessage: (error, fallback) => error?.response?.data?.detail || fallback,
}), { virtual: true });
// The `@` alias has no jest mapping, so the shared rendering kit resolves
// through the real module: the assertions below are about the disclosures this
// page and a studio's Diagnostics tab both produce.
jest.mock("@/components/fleet/FleetBaselineKit", () => jest.requireActual("../components/fleet/FleetBaselineKit"), { virtual: true });
jest.mock("@/components/OperationalPageHeader", () => ({
  __esModule: true,
  default: ({ title, description, actions }) => (
    <header><h1>{title}</h1><p>{description}</p>{actions}</header>
  ),
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
jest.mock("@/components/ui/card", () => ({
  Card: ({ children, className, ...props }) => <section className={className} {...props}>{children}</section>,
  CardContent: ({ children, className, ...props }) => <div className={className} {...props}>{children}</div>,
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
    memory_usage: { label: "Memory", measured_count: 6, median: 40, spread: 3, unit: "%", established: true, reason: null },
    // A metric nobody reported: the row must say so rather than showing 0%.
    disk_usage: { label: "Disk", measured_count: 0, median: null, spread: null, unit: "%", established: false, reason: "No endpoint in this cohort reported this metric." },
  },
  bands: { critical: 0, degraded: 0, watch: 0, healthy: 6, unknown: 0 },
};

const LINUX_COHORT = {
  platform: "linux",
  label: "Linux",
  device_count: 2,
  measured_device_count: 2,
  baseline_established: false,
  minimum_devices: 5,
  unestablished_reason: "2 of 2 endpoints reported a metric; 5 measured endpoints are needed before a cohort baseline exists.",
  metrics: {
    cpu_usage: { label: "CPU", measured_count: 2, median: 11, spread: 2, unit: "%", established: false, reason: "Only 2 of the 5 measured endpoints needed to define this baseline reported it." },
    memory_usage: { label: "Memory", measured_count: 2, median: 30, spread: 2, unit: "%", established: false, reason: "Only 2 of the 5 measured endpoints needed to define this baseline reported it." },
    disk_usage: { label: "Disk", measured_count: 0, median: null, spread: null, unit: "%", established: false, reason: "No endpoint in this cohort reported this metric." },
  },
  bands: { critical: 0, degraded: 0, watch: 0, healthy: 2, unknown: 0 },
};

const CONTRACT = {
  cohorts: [WINDOWS_COHORT, LINUX_COHORT],
  metrics: [
    { key: "cpu_usage", label: "CPU", unit: "%" },
    { key: "memory_usage", label: "Memory", unit: "%" },
    { key: "disk_usage", label: "Disk", unit: "%" },
  ],
  minimum_cohort_devices: 5,
  minimum_recurring_devices: 2,
  strong_deviation_ratio: 0.5,
  notable_deviation_ratio: 0.2,
  device_count: 8,
  note: "A cohort is the caller's own scoped estate, grouped by operating system.",
  boundary: BOUNDARY,
};

function device(overrides) {
  return {
    client_id: "client-a",
    platform: "windows",
    status: "online",
    band: "unknown",
    score: null,
    samples: null,
    last_seen: null,
    cohort: "windows",
    cohort_established: true,
    deviations: [],
    unmeasured: [],
    verdict: "not_measured",
    ...overrides,
  };
}

const DEVIATIONS = {
  platform: "windows",
  cohort: WINDOWS_COHORT,
  devices: [
    device({
      device_id: "d-disk",
      name: "Disk-bound endpoint",
      hostname: "disk.example.test",
      band: "degraded",
      samples: 14,
      verdict: "cohort_not_established",
      deviations: [
        {
          metric: "disk_usage", label: "Disk", unit: "%", value: 92,
          cohort_median: null, delta: null, verdict: "cohort_not_established",
          basis: "No endpoint in this cohort reported this metric.",
        },
        {
          metric: "cpu_usage", label: "CPU", unit: "%", value: 95,
          cohort_median: 20, delta: 75, verdict: "strong",
          basis: "95% against a cohort median of 20% across 6 measured Windows endpoints (CPU).",
        },
      ],
    }),
    device({
      device_id: "d-silent",
      name: "Silent endpoint",
      hostname: "silent.example.test",
      verdict: "not_measured",
      unmeasured: [
        { metric: "cpu_usage", label: "CPU", reason: "This endpoint has not reported this metric." },
        { metric: "memory_usage", label: "Memory", reason: "This endpoint has not reported this metric." },
        { metric: "disk_usage", label: "Disk", reason: "This endpoint has not reported this metric." },
      ],
    }),
  ],
  note: "Devices are ordered by the worst verdict they carry.",
  boundary: BOUNDARY,
};

const LINUX_DEVIATIONS = {
  platform: "linux",
  cohort: LINUX_COHORT,
  devices: [
    device({
      device_id: "l-hot",
      name: "Hot Linux box",
      hostname: "hot.example.test",
      platform: "linux",
      cohort: "linux",
      cohort_established: false,
      verdict: "cohort_not_established",
      deviations: [
        {
          metric: "cpu_usage", label: "CPU", unit: "%", value: 80,
          cohort_median: null, delta: null, verdict: "cohort_not_established",
          basis: "Only 2 of the 5 measured endpoints needed to define this baseline reported it.",
        },
      ],
    }),
  ],
  note: "Devices are ordered by the worst verdict they carry.",
  boundary: BOUNDARY,
};

const RECURRENCE = {
  platform: "windows",
  cohort: WINDOWS_COHORT,
  shapes: [
    {
      id: "windows|cpu_usage|above|strong",
      platform: "windows",
      metric: "cpu_usage",
      label: "CPU",
      direction: "above",
      verdict: "strong",
      device_count: 3,
      device_ids: ["a", "b", "c"],
      device_names: ["Alpha", "Bravo", "Charlie"],
      cohort_median: 20,
      basis: "3 of 6 measured Windows endpoints sit more than 50% above the cohort median of 20% for CPU.",
    },
  ],
  minimum_devices: 2,
  note: "A shape needs at least two endpoints before it is reported as shared.",
  boundary: BOUNDARY,
};

const EMPTY_RECURRENCE = { ...RECURRENCE, shapes: [] };

function mockApi({ deviations = DEVIATIONS, recurrence = RECURRENCE } = {}) {
  axios.get.mockImplementation((url) => {
    if (url.endsWith("/fleet-baseline/contract")) return Promise.resolve({ data: CONTRACT });
    if (url.includes("/deviations")) return Promise.resolve({ data: deviations });
    if (url.includes("/recurrence")) return Promise.resolve({ data: recurrence });
    return Promise.reject(new Error(`unexpected url ${url}`));
  });
}

describe("FleetBaselinePage estate comparison", () => {
  let host;
  let root;

  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    axios.get.mockReset();
    mockSetParams.mockReset();
    mockParams = new URLSearchParams("");
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    delete global.IS_REACT_ACT_ENVIRONMENT;
  });

  const render = () => act(async () => root.render(<FleetBaselinePage />));
  const flush = () => act(async () => { await Promise.resolve(); });
  const click = (testId) => act(async () => {
    const node = host.querySelector(`[data-testid="${testId}"]`);
    expect(node).not.toBeNull();
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  test("reads the contract and the first cohort, scoped to the session token", async () => {
    mockApi();
    await render();
    await flush();

    expect(axios.get).toHaveBeenCalledWith(`${BASE}/fleet-baseline/contract`, {
      headers: { Authorization: "Bearer session-token" },
    });
    expect(axios.get).toHaveBeenCalledWith(`${BASE}/fleet-baseline/cohorts/windows/deviations`, {
      headers: { Authorization: "Bearer session-token" },
    });
    // The thresholds a verdict can be reproduced from are on screen.
    const thresholds = host.querySelector('[data-testid="fleet-baseline-thresholds"]').textContent;
    expect(thresholds).toContain("Measured endpoints a baseline needs");
    expect(thresholds).toContain("±20% / ±50%");
  });

  test("renders a metric the cohort never measured as not reported, never as zero", async () => {
    mockApi();
    await render();
    await flush();

    const median = host.querySelector('[data-testid="baseline-median-disk_usage"]');
    expect(median.textContent).toBe("Not reported");
    expect(median.textContent).not.toContain("0");
    expect(host.querySelector('[data-testid="baseline-reason-disk_usage"]').textContent)
      .toBe("No endpoint in this cohort reported this metric.");
    // A reported metric still states its median and the endpoints behind it.
    expect(host.querySelector('[data-testid="baseline-median-cpu_usage"]').textContent).toBe("20%");
    expect(host.querySelector('[data-testid="baseline-metric-cpu_usage"]').textContent).toContain("6 measured endpoints");
    // A cohort whose baseline is established says so; it is not silently green.
    expect(host.querySelector('[data-testid="baseline-cohort"]').textContent).toContain("Baseline established");
  });

  test("states a cohort that cannot define a baseline instead of grading against it", async () => {
    mockParams = new URLSearchParams("?platform=linux");
    mockApi({ deviations: LINUX_DEVIATIONS });
    await render();
    await flush();

    expect(axios.get).toHaveBeenCalledWith(`${BASE}/fleet-baseline/cohorts/linux/deviations`, {
      headers: { Authorization: "Bearer session-token" },
    });
    const cohort = host.querySelector('[data-testid="baseline-cohort"]').textContent;
    expect(cohort).toContain("No baseline yet");
    expect(host.querySelector('[data-testid="baseline-unestablished"]').textContent)
      .toContain("5 measured endpoints are needed");
    // The device is disclosed as ungraded rather than as inside the band.
    const row = host.querySelector('[data-testid="baseline-device-l-hot"]').textContent;
    expect(row).toContain("No cohort baseline yet");
    expect(row).not.toContain("Within the cohort band");
    expect(host.querySelector('[data-testid="baseline-deviation-l-hot-cpu_usage"]').textContent)
      .toContain("no cohort median");
  });

  test("shows each deviation with its basis and never presents a gap as a fault", async () => {
    mockApi();
    await render();
    await flush();

    const strong = host.querySelector('[data-testid="baseline-deviation-d-disk-cpu_usage"]').textContent;
    expect(strong).toContain("cohort median 20%");
    expect(strong).toContain("+75");
    expect(strong).toContain("Well outside the cohort");
    expect(strong).toContain("95% against a cohort median of 20% across 6 measured Windows endpoints");
    // Unmeasured metrics are listed with their reason rather than shown as clean.
    const unmeasured = host.querySelector('[data-testid="baseline-unmeasured-d-silent"]').textContent;
    expect(unmeasured).toContain("Not reported by this endpoint");
    expect(unmeasured).toContain("Disk: This endpoint has not reported this metric.");
    // The honest boundary sentence is on the page verbatim.
    expect(host.querySelector('[data-testid="fleet-baseline-boundary"]').textContent).toBe(BOUNDARY);
    expect(host.querySelector('[data-testid="fleet-baseline-note"]').textContent)
      .toBe("Devices are ordered by the worst verdict they carry.");
  });

  test("the recurrence view counts the endpoints sharing a shape and quotes its basis", async () => {
    mockParams = new URLSearchParams("?platform=windows&view=recurrence");
    mockApi();
    await render();
    await flush();

    expect(axios.get).toHaveBeenCalledWith(`${BASE}/fleet-baseline/cohorts/windows/recurrence`, {
      headers: { Authorization: "Bearer session-token" },
    });
    expect(host.querySelector('[data-testid="baseline-devices"]')).toBeNull();
    expect(host.querySelector('[data-testid="baseline-shapes"]').textContent).toContain("3 endpoints above the median for CPU");
    expect(host.querySelector('[data-testid="baseline-shape-basis-0"]').textContent)
      .toBe("3 of 6 measured Windows endpoints sit more than 50% above the cohort median of 20% for CPU.");
    expect(host.querySelector('[data-testid="baseline-shape-0"]').textContent).toContain("Alpha, Bravo, Charlie");
  });

  test("says when no shape is shared rather than showing an empty recurring list", async () => {
    mockParams = new URLSearchParams("?view=recurrence");
    mockApi({ recurrence: EMPTY_RECURRENCE });
    await render();
    await flush();

    expect(host.querySelector('[data-testid="baseline-shapes"]').textContent)
      .toContain("one machine's bad day is not a recurring problem");
  });

  test("switching cohort re-reads that cohort rather than reusing the previous one", async () => {
    mockApi();
    await render();
    await flush();

    await click("cohort-linux");

    expect(mockSetParams).toHaveBeenCalledWith({ platform: "linux" });
  });

  test("a failed read states the failure instead of rendering an empty, clean estate", async () => {
    axios.get.mockRejectedValue({ response: { data: { detail: "Cohort read refused." } } });
    await render();
    await flush();

    const error = host.querySelector('[data-testid="fleet-baseline-error"]');
    expect(error).not.toBeNull();
    expect(error.textContent).toContain("Cohort read refused.");
    expect(host.querySelector('[data-testid="baseline-devices"]')).toBeNull();
  });
});
