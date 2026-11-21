/* eslint-disable testing-library/no-unnecessary-act -- Native React createRoot requires act. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";

import HealthRadarPage, { evidenceConnectionFor } from "./HealthRadarPage";

const mockNavigate = jest.fn();

jest.mock("axios", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock(
  "@/App",
  () => ({ __esModule: true, API: "http://api.test/api", useAuth: () => ({ token: "test-token" }) }),
  { virtual: true },
);
jest.mock(
  "react-router-dom",
  () => ({ __esModule: true, useNavigate: () => mockNavigate }),
  { virtual: true },
);
jest.mock("@/components/ui/dropdown-menu", () => {
  const { createContext, useContext, useState } = require("react");
  const MenuContext = createContext({ open: false, toggle: () => {} });
  return {
    DropdownMenu: ({ children }) => {
      const [open, setOpen] = useState(false);
      return <MenuContext.Provider value={{ open, toggle: () => setOpen((current) => !current) }}><div>{children}</div></MenuContext.Provider>;
    },
    DropdownMenuTrigger: ({ children }) => {
      const { toggle } = useContext(MenuContext);
      return <span onClick={toggle}>{children}</span>;
    },
    DropdownMenuContent: ({ children }) => {
      const { open } = useContext(MenuContext);
      return open ? <div>{children}</div> : null;
    },
    DropdownMenuItem: ({ children, onSelect, ...props }) => (
      <button type="button" {...props} onClick={() => onSelect?.()}>{children}</button>
    ),
    DropdownMenuLabel: ({ children }) => <div>{children}</div>,
    DropdownMenuSeparator: () => <hr />,
  };
}, { virtual: true });

const unassessedClient = {
  client_id: "client-1",
  client_name: "Empty Evidence Ltd",
  health_score: null,
  status: "not_assessed",
  evidence_state: "not_assessed",
  evidence_coverage_pct: 0,
  assessed_dimensions: [],
  missing_sources: ["ticket", "device", "payment", "backup", "security", "m365", "network"],
  mrr: 0,
  risk_factors: [],
  opportunities: [],
  metrics: {
    open_tickets: 0,
    critical_tickets: 0,
    total_tickets: 0,
    recent_tickets_30d: 0,
    devices: 0,
    offline_devices: 0,
    active_contracts: 0,
    expiring_contracts: 0,
    overdue_invoices: 0,
    outstanding_amount: 0,
  },
};

const emptyRadar = {
  summary: {
    total_clients: 1,
    assessed_count: 0,
    not_assessed_count: 1,
    at_risk_count: 0,
    healthy_count: 0,
    total_potential_mrr: 0,
    avg_health_score: null,
    evidence_policy: "A client is scored only when at least two independent evidence dimensions are recorded.",
  },
  at_risk_clients: [],
  upsell_opportunities: [],
  healthy_clients: [],
  unassessed_clients: [unassessedClient],
};

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<HealthRadarPage embedded />);
  });
  await settle();
  return root;
}

async function openTab(label) {
  const tab = [...document.querySelectorAll('[role="tab"]')].find((node) => node.textContent.includes(label));
  await act(async () => {
    tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    tab.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("HealthRadarPage", () => {
  afterEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("reports an unobserved client as not assessed instead of zero", async () => {
    axios.get.mockResolvedValue({ data: emptyRadar });

    await renderPage();
    await openTab("Not assessed");

    const text = document.body.textContent;
    expect(axios.get).toHaveBeenCalledWith(
      "http://api.test/api/health-radar/dashboard",
      expect.objectContaining({ headers: { Authorization: "Bearer test-token" } }),
    );
    expect(text).toContain("Not assessed");
    expect(text).toContain("1 account(s) currently have no score.");
    expect(text).toContain("Evidence coverage");
    expect(text).toContain("0%");
    expect(text).toContain("Missing: tickets, devices, payments, backups, security, Microsoft 365, network");
    expect(text).toContain("Connect evidence");
    expect(text).not.toContain("0/100");
    expect(text).not.toContain("No at-risk clients!");

    axios.post.mockResolvedValue({ data: { recorded: true } });
    const trigger = document.querySelector('[data-testid="connect-evidence-client-1"]');
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const deviceChoice = document.querySelector('[data-testid="connect-evidence-device"]');
    await act(async () => {
      deviceChoice.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(axios.post).toHaveBeenCalledWith(
      "http://api.test/api/health-radar/evidence-actions",
      { client_id: "client-1", source: "device" },
      expect.objectContaining({ headers: { Authorization: "Bearer test-token" } }),
    );
    expect(mockNavigate).toHaveBeenCalledWith("/nexus-agent?client=client-1&installer=1");
  });

  it("routes missing evidence sources to their connection workspace", () => {
    expect(evidenceConnectionFor("device", "client-1")).toBe("/nexus-agent?client=client-1&installer=1");
    expect(evidenceConnectionFor("backup", "client-1")).toBe("/backup-center");
    expect(evidenceConnectionFor("m365", "client-1")).toContain("module=microsoft365");
    expect(evidenceConnectionFor("unknown", "client-1")).toBeNull();
  });

});
