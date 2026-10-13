/* eslint-disable testing-library/no-unnecessary-act -- Native React createRoot requires act. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import { toast } from "sonner";

import ExecutivePage from "./ExecutivePage";

// The `@/` alias is a webpack/craco alias with no jest mapping, so every aliased
// module the page reaches is registered here. The executive component kit and the
// briefing helpers are the real modules: this test is about what the cockpit does
// with a real briefing payload, not about how a kit sub-component looks.
const mockNavigate = jest.fn();

jest.mock("axios", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() } }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("react-router-dom", () => ({ __esModule: true, useNavigate: () => mockNavigate }), { virtual: true });
jest.mock("@/App", () => ({ __esModule: true, API: "http://api.test/api", useAuth: () => ({ token: "session-token" }) }), { virtual: true });
jest.mock("@/lib/executiveBriefing", () => jest.requireActual("../lib/executiveBriefing"), { virtual: true });
jest.mock("@/components/executive/ExecutiveWorkspaceKit", () => jest.requireActual("../components/executive/ExecutiveWorkspaceKit"), { virtual: true });
jest.mock("@/components/HeroTile", () => ({
  __esModule: true,
  default: ({ label, value, subtitle, testId }) => (
    <div data-testid={testId}>{label}: {value}{subtitle ? ` · ${subtitle}` : ""}</div>
  ),
}), { virtual: true });
jest.mock("@/components/OperationalPageHeader", () => ({
  __esModule: true,
  default: ({ title, signal, meta, actions }) => (
    <header>
      <h1>{title}</h1>
      {signal ? <span data-testid="executive-signal">{signal}</span> : null}
      {meta ? <p data-testid="executive-header-meta">{meta}</p> : null}
      {actions}
    </header>
  ),
}), { virtual: true });
jest.mock("@/components/WorkspaceActionMenu", () => ({
  __esModule: true,
  default: ({ children }) => <div data-testid="executive-owner-tools">{children}</div>,
  WorkspaceActionMenuItem: ({ children, icon: _icon, onSelect, disabled = false, testId }) => (
    <button type="button" data-testid={testId} disabled={disabled} onClick={onSelect}>{children}</button>
  ),
}), { virtual: true });
jest.mock("@/components/WorkspaceControlBar", () => ({
  __esModule: true,
  default: ({ children, ...props }) => <section {...props}>{children}</section>,
}), { virtual: true });
jest.mock("@/components/ui/badge", () => ({
  Badge: ({ children, variant: _variant, className, ...props }) => <span className={className} {...props}>{children}</span>,
}), { virtual: true });
jest.mock("@/components/ui/button", () => ({
  Button: ({ children, variant: _variant, size: _size, className, ...props }) => <button className={className} {...props}>{children}</button>,
}), { virtual: true });
jest.mock("@/components/ui/card", () => ({
  Card: ({ children, className, ...props }) => <section className={className} {...props}>{children}</section>,
  CardContent: ({ children, className, ...props }) => <div className={className} {...props}>{children}</div>,
  CardHeader: ({ children, className, ...props }) => <div className={className} {...props}>{children}</div>,
  CardTitle: ({ children, className, ...props }) => <h3 className={className} {...props}>{children}</h3>,
}), { virtual: true });
jest.mock("@/components/ui/input", () => ({
  Input: (props) => <input {...props} />,
}), { virtual: true });
jest.mock("@/components/ui/label", () => ({
  Label: ({ children, ...props }) => <label {...props}>{children}</label>,
}), { virtual: true });
jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }) => <div>{children}</div>,
  DialogDescription: ({ children }) => <p>{children}</p>,
  DialogFooter: ({ children }) => <div>{children}</div>,
  DialogHeader: ({ children }) => <div>{children}</div>,
  DialogTitle: ({ children }) => <h2>{children}</h2>,
}), { virtual: true });
jest.mock("@/components/ui/select", () => ({
  Select: ({ children }) => <div>{children}</div>,
  SelectContent: ({ children }) => <div>{children}</div>,
  SelectItem: ({ children, value, ...props }) => <div data-value={value} {...props}>{children}</div>,
  SelectTrigger: ({ children, ...props }) => <div {...props}>{children}</div>,
  SelectValue: () => null,
}), { virtual: true });
jest.mock("@/components/ui/slider", () => ({
  Slider: ({ value }) => <div data-testid="scenario-slider" data-value={value?.[0]} />,
}), { virtual: true });

const BASE = "http://api.test/api";

const NO_GOAL = {
  state: "not_recorded",
  target_mrr: null,
  target_month: null,
  target_month_label: null,
  note: "",
  recorded_at: null,
  recorded_by: null,
  current_mrr: 42000,
  starting_mrr: null,
  starting_recorded_at: null,
  growth: null,
  growth_pct: null,
  progress_pct: null,
  gap: null,
  months_remaining: null,
  required_monthly_growth: null,
  required_growth_pct_per_month: null,
  revisions: [],
  method: "Progress is contract-backed MRR divided by the revenue goal the owner recorded.",
};

const OVERVIEW = {
  generated_at: "2026-08-20T09:00:00+00:00",
  period: { days: 30, label: "Trailing 30 days", options: [] },
  summary: {
    mrr: 42000,
    arr: 504000,
    service_contribution: null,
    contribution_margin_pct: null,
    net_cash_30d: -1500,
    average_client_health: null,
    assessed_clients: 0,
    total_clients: 2,
    staff_capacity_pct: null,
    top_client_name: "Anchor Freight",
    top_client_share_pct: 71.4,
    oldest_overdue_days: 172,
    risk_count: 2,
    critical_risk_count: 1,
  },
  financial: { contract_mrr: 42000, recorded_direct_cost: null, service_contribution: null, contribution_margin_pct: null, net_cash_30d: -1500, incoming_30d: 6000, open_po_commitments: 7500 },
  team: { active_service_team: 3, window_days: 30, recorded_hours: 0, billable_hours: 0, available_hours_model: 480, capacity_pct: null, method: "Aggregate time evidence only." },
  risk_items: [
    { id: "revenue-concentration", severity: "high", title: "71.4% of contract MRR sits with one client", detail: "Anchor is 71.4% of contract-backed MRR.", decision: "Agree a diversification plan.", route: "/clients?client=a", source: "Contract register" },
    { id: "aged-receivables", severity: "high", title: "Oldest overdue invoice is 172 days past its due date", detail: "$900 is overdue.", decision: "Decide write-off or escalation.", route: "/invoices", source: "Invoice ledger" },
  ],
  profit_killers: [],
  portfolio: [
    { client_id: "a", client_name: "Anchor Freight", mrr: 30000, health_score: 42, evidence_coverage_pct: 60, tickets_30d: 9, service_burden_share_pct: 82, route: "/clients?client=a" },
    { client_id: "b", client_name: "Beacon Legal", mrr: 12000, health_score: null, evidence_coverage_pct: 20, tickets_30d: 0, service_burden_share_pct: null, route: "/clients?client=b" },
  ],
  board_brief: { headline: "1 critical owner decision needs attention.", wins: [], risks: ["71.4% of contract MRR sits with one client"], decisions: ["Agree a diversification plan."], outlook: [], method: "Deterministic briefing from current Nexus records." },
  data_quality: [
    { id: "profit", label: "Direct cost coverage", state: "missing", detail: "Add unit cost data before treating contribution as profit." },
    { id: "renewals", label: "Renewal calendar", state: "insufficient_evidence", detail: "No contract records an end date inside 180 days." },
  ],
  receivables: {
    state: "verified",
    outstanding_total: 2500,
    overdue_total: 900,
    oldest_overdue_days: 172,
    method: "Open invoice balances aged from the due date recorded on each invoice.",
    buckets: [
      { key: "not_due", label: "Not yet due", count: 1, total: 1000, share_pct: 40, overdue: false },
      { key: "overdue_1_30", label: "1-30 days overdue", count: 0, total: 0, share_pct: 0, overdue: true },
      { key: "overdue_31_60", label: "31-60 days overdue", count: 0, total: 0, share_pct: 0, overdue: true },
      { key: "overdue_61_90", label: "61-90 days overdue", count: 0, total: 0, share_pct: 0, overdue: true },
      { key: "overdue_90_plus", label: "90+ days overdue", count: 1, total: 900, share_pct: 36, overdue: true },
      { key: "undated", label: "No due date recorded", count: 1, total: 600, share_pct: 24, overdue: false },
    ],
  },
  concentration: {
    state: "verified",
    total: 42000,
    client_count: 2,
    top_client: { client_id: "a", name: "Anchor Freight", mrr: 30000, share_pct: 71.4 },
    top_three_share_pct: 100,
    level: "dependency",
    detail: "Anchor Freight is 71.4% of $42,000 contract-backed MRR; the three largest accounts together are 100%.",
    method: "Recorded contract monthly value plus client fallback MRR. It is not a churn probability.",
  },
  renewals: {
    state: "verified",
    window_days: 180,
    total_value: 500,
    rows: [{ contract_id: "c1", client_id: "a", client_name: "Anchor Freight", value: 500, end_date: "2026-09-01", days_until: 12, urgency: "immediate", route: "/clients?client=a" }],
    method: "Active contracts with a recorded end date inside 180 days.",
  },
  revenue_trend: {
    state: "insufficient_evidence",
    recorded_months: 1,
    months: [
      { key: "2026-06", label: "Jun 2026", invoiced: 0, collected: 0, count: 0 },
      { key: "2026-07", label: "Jul 2026", invoiced: 5000, collected: 2000, count: 2 },
    ],
    method: "Invoiced and paid totals per month, keyed on the invoice's recorded created date.",
  },
  mrr_target: {
    ...NO_GOAL,
    state: "in_progress",
    target_mrr: 60000,
    target_month: "2027-02",
    target_month_label: "Feb 2027",
    note: "Board plan",
    recorded_at: "2026-08-01T00:00:00+00:00",
    recorded_by: "Owner",
    starting_mrr: 36000,
    starting_recorded_at: "2026-08-01T00:00:00+00:00",
    growth: 6000,
    growth_pct: 16.7,
    progress_pct: 70,
    gap: 18000,
    months_remaining: 6,
    required_monthly_growth: 3000,
    required_growth_pct_per_month: 7.1,
  },
  watchlist: [],
  recent_board_snapshots: [],
  model_context: { client_mrr: { a: 30000, b: 12000 }, clients: [{ id: "a", name: "Anchor Freight" }, { id: "b", name: "Beacon Legal" }] },
};

describe("ExecutivePage cockpit", () => {
  let host;
  let root;
  const blobUrls = [];

  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    axios.get.mockReset();
    axios.post.mockReset();
    axios.put.mockReset();
    axios.delete.mockReset();
    mockNavigate.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
    axios.get.mockResolvedValue({ data: OVERVIEW });
    global.URL.createObjectURL = jest.fn(() => {
      const url = `blob:pack-${blobUrls.length}`;
      blobUrls.push(url);
      return url;
    });
    global.URL.revokeObjectURL = jest.fn();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    delete global.IS_REACT_ACT_ENVIRONMENT;
  });

  const render = () => act(async () => root.render(<ExecutivePage />));

  const click = (testId) => act(async () => {
    const node = host.querySelector(`[data-testid="${testId}"]`);
    expect(node).not.toBeNull();
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  test("states the owner's decisions, cash exposure and evidence gaps from the loaded briefing", async () => {
    await render();

    expect(axios.get).toHaveBeenCalledWith(`${BASE}/executive/overview`, {
      headers: { Authorization: "Bearer session-token" },
      params: { window: 30 },
    });

    const text = host.textContent;
    // Recorded evidence is shown.
    expect(text).toContain("Agree a diversification plan.");
    expect(text).toContain("Anchor Freight");
    // An absent figure is never rendered as zero or as healthy.
    expect(host.querySelector('[data-testid="executive-contribution"]').textContent).toContain("Direct costs not assessed");
    // The concentration level is the one the API returned, stated with its arithmetic.
    expect(text).toContain("Single-client dependency");
    expect(text).toContain("Anchor Freight is 71.4% of $42,000 contract-backed MRR");
    expect(host.querySelector('[data-testid="executive-margin-readout"]').textContent).toContain("Not assessed");
    // A source the API could not measure is labelled as such, never as verified.
    const confidence = host.querySelector('[data-testid="executive-data-quality"]').textContent;
    expect(confidence).toContain("Not measurable");
    expect(confidence).not.toContain("Verified");
    // Undated debt is disclosed rather than treated as current.
    expect(host.querySelector('[data-testid="executive-aging-undated"]').textContent).toContain("$600");
    expect(host.querySelector('[data-testid="executive-aging-overdue_90_plus"]').textContent).toContain("$900");
    // A single recorded month is not drawn as a trend.
    expect(text).toContain("Needs two recorded months");
    // The header signal follows the evidenced risk count, not an optimistic default.
    expect(host.querySelector('[data-testid="executive-signal"]').textContent).toBe("critical");
  });

  test("re-reads the briefing for the owner's selected period", async () => {
    await render();
    axios.get.mockClear();

    await click("executive-period-90");

    expect(axios.get).toHaveBeenCalledWith(`${BASE}/executive/overview`, {
      headers: { Authorization: "Bearer session-token" },
      params: { window: 90 },
    });
  });

  test("pins an account to the owner watchlist and can filter the portfolio to it", async () => {
    axios.post.mockResolvedValue({
      data: { created: true, watchlist: { client_id: "a", client_name: "Anchor Freight", note: "", created_at: "2026-08-20T09:00:00+00:00" } },
    });
    await render();

    expect(host.querySelector('[data-testid="executive-watchlist"]').textContent).toContain("Pin an account from the portfolio");

    await click("executive-watch-a");

    expect(axios.post).toHaveBeenCalledWith(
      `${BASE}/executive/watchlist`,
      { client_id: "a" },
      { headers: { Authorization: "Bearer session-token" } },
    );
    expect(host.querySelector('[data-testid="executive-watchlist"]').textContent).toContain("Anchor Freight");

    await click("executive-watched-only");
    const portfolio = host.querySelector('[data-testid="executive-portfolio"]').textContent;
    expect(portfolio).toContain("Anchor Freight");
    expect(portfolio).not.toContain("Beacon Legal");

    axios.delete.mockResolvedValue({ data: { removed: true } });
    await click("executive-unwatch-a");
    expect(axios.delete).toHaveBeenCalledWith(`${BASE}/executive/watchlist/a`, {
      headers: { Authorization: "Bearer session-token" },
    });
    expect(host.querySelector('[data-testid="executive-watchlist"]').textContent).not.toContain("Anchor Freight");
  });

  test("measures the recorded owner goal against the same contract-backed MRR the briefing reports", async () => {
    await render();

    const card = host.querySelector('[data-testid="executive-mrr-target"]');
    expect(card.textContent).toContain("70%");
    expect(card.textContent).toContain("of a $60,000 monthly goal by Feb 2027");
    // The run rate the goal is measured against is the one the KPI strip reports.
    expect(card.textContent).toContain("$42,000");
    expect(card.textContent).toContain("$18,000");
    expect(card.textContent).toContain("$3,000/mo");
    expect(card.textContent).toContain("not a forecast that the step will happen");
    // Progress is also stated as growth from the run rate the goal recorded.
    const growth = host.querySelector('[data-testid="executive-mrr-target-growth"]');
    expect(growth.textContent).toContain("Starting run rate");
    expect(growth.textContent).toContain("$36,000");
    expect(growth.textContent).toContain("$6,000");
    expect(growth.textContent).toContain("16.7%");
    expect(growth.textContent).toContain("since the goal was recorded");
    // The header states the goal's progress alongside the period.
    const meta = host.querySelector('[data-testid="executive-header-meta"]').textContent;
    expect(meta).toContain("Goal 70%");
    expect(meta).toContain("Run rate +6,000 since the goal was recorded");
  });

  test("states that a goal carries no starting run rate instead of inventing one", async () => {
    const legacyGoal = { ...OVERVIEW.mrr_target, starting_mrr: null, starting_recorded_at: null, growth: null, growth_pct: null };
    axios.get.mockResolvedValue({ data: { ...OVERVIEW, mrr_target: legacyGoal } });
    await render();

    const growth = host.querySelector('[data-testid="executive-mrr-target-growth"]');
    expect(growth.textContent).toContain("No starting run rate was recorded with this goal");
    expect(growth.textContent).not.toContain("$");
    expect(host.querySelector('[data-testid="executive-mrr-target-starting"]')).toBeNull();
    // No growth is stated in the header either, and the goal's distance is unchanged.
    expect(host.querySelector('[data-testid="executive-header-goal-growth"]')).toBeNull();
    expect(host.querySelector('[data-testid="executive-mrr-target-progress"]').textContent).toBe("70%");
  });

  test("records a goal through the review dialog and re-reads the briefing afterwards", async () => {
    const revisedGoal = {
      ...NO_GOAL,
      state: "in_progress",
      target_mrr: 90000,
      target_month: "2027-02",
      target_month_label: "Feb 2027",
      note: "Board plan",
      recorded_by: "Owner",
      progress_pct: 46.7,
      gap: 48000,
      months_remaining: 6,
      required_monthly_growth: 4800,
    };
    axios.put.mockResolvedValue({ data: { created: true, mrr_target: revisedGoal } });
    // The briefing the page re-reads after the write reports the goal the API just recorded.
    axios.get.mockReset();
    axios.get.mockResolvedValueOnce({ data: OVERVIEW });
    axios.get.mockResolvedValue({ data: { ...OVERVIEW, mrr_target: revisedGoal } });
    await render();

    await click("executive-mrr-target-update");
    const amount = host.querySelector('[data-testid="executive-mrr-target-input"]');
    // The dialog opens on the recorded goal, so the owner can see what they are revising.
    expect(amount.value).toBe("60000");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(amount, "90000");
      amount.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("executive-mrr-target-save");

    expect(axios.put).toHaveBeenCalledWith(
      `${BASE}/executive/mrr-target`,
      { target_mrr: 90000, target_month: "2027-02", note: "Board plan" },
      { headers: { Authorization: "Bearer session-token" } },
    );
    // The card takes the recalculated figure the API returned, and the briefing is re-read
    // so the decision queue and evidence card cannot contradict it.
    expect(host.querySelector('[data-testid="executive-mrr-target"]').textContent).toContain("46.7%");
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  test("refuses to record a goal without an amount", async () => {
    axios.get.mockResolvedValue({ data: { ...OVERVIEW, mrr_target: NO_GOAL } });
    await render();

    await click("executive-mrr-target-update");
    await click("executive-mrr-target-save");

    expect(axios.put).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Record the monthly recurring revenue goal as an amount above $0");
  });

  test("states that no goal is recorded instead of showing 0% of an unset target", async () => {
    axios.get.mockResolvedValue({ data: { ...OVERVIEW, mrr_target: NO_GOAL } });
    await render();

    expect(host.querySelector('[data-testid="executive-mrr-target-empty"]').textContent).toContain("No revenue goal is recorded");
    // No target exists, so no progress figure and no clear action are offered.
    expect(host.querySelector('[data-testid="executive-mrr-target-progress"]')).toBeNull();
    expect(host.querySelector('[data-testid="executive-mrr-target-clear"]')).toBeNull();
    expect(host.querySelector('[data-testid="executive-header-meta"]').textContent).toContain("No revenue goal recorded");
  });

  test("clears the recorded goal and re-reads the briefing", async () => {
    axios.get.mockReset();
    axios.get.mockResolvedValueOnce({ data: OVERVIEW });
    axios.get.mockResolvedValue({ data: { ...OVERVIEW, mrr_target: NO_GOAL } });
    axios.delete.mockResolvedValue({ data: { cleared: true, removed_target_mrr: 60000, mrr_target: NO_GOAL } });
    await render();

    await click("executive-mrr-target-clear");

    expect(axios.delete).toHaveBeenCalledWith(`${BASE}/executive/mrr-target`, {
      headers: { Authorization: "Bearer session-token" },
    });
    expect(host.querySelector('[data-testid="executive-mrr-target-empty"]')).not.toBeNull();
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  test("downloads a plain-text owner pack that names each evidence state", async () => {
    const created = [];
    const originalCreate = document.createElement.bind(document);
    jest.spyOn(document, "createElement").mockImplementation((tag) => {
      const element = originalCreate(tag);
      if (tag === "a") {
        element.click = jest.fn();
        created.push(element);
      }
      return element;
    });

    await render();
    await click("executive-owner-pack");

    expect(global.URL.createObjectURL).toHaveBeenCalledTimes(1);
    const blob = global.URL.createObjectURL.mock.calls[0][0];
    expect(blob.type).toContain("text/plain");
    const packText = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    expect(packText).toContain("Service contribution: not assessed — direct costs are not recorded");
    expect(packText).toContain("Oldest overdue invoice: 172 days");
    expect(packText).toContain("Revenue concentration: Anchor Freight is 71.4%");
    expect(packText).toContain("Recorded MRR goal: $60,000 by Feb 2027");
    expect(packText).toContain("required step $3,000/month over 6 months");
    expect(created[0].download).toMatch(/^nexus-executive-briefing-\d{4}-\d{2}-\d{2}\.txt$/);
    expect(created[0].click).toHaveBeenCalled();

    document.createElement.mockRestore();
  });
});
