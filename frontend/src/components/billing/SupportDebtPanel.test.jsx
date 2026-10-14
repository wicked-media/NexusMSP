/* eslint-disable testing-library/no-unnecessary-act -- Native React createRoot requires act. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import SupportDebtPanel from "./SupportDebtPanel";

jest.mock("@/App", () => ({ API: "http://api.test" }), { virtual: true });
jest.mock("@/lib/supportDebt", () => jest.requireActual("../../lib/supportDebt"), { virtual: true });
jest.mock("axios");
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/components/ui/card", () => ({
  Card: ({ children, ...props }) => <div {...props}>{children}</div>,
  CardHeader: ({ children, ...props }) => <div {...props}>{children}</div>,
  CardTitle: ({ children, ...props }) => <h3 {...props}>{children}</h3>,
  CardContent: ({ children, ...props }) => <div {...props}>{children}</div>,
}), { virtual: true });
jest.mock("@/components/ui/badge", () => ({
  Badge: ({ children, variant: _variant, ...props }) => <span {...props}>{children}</span>,
}), { virtual: true });
jest.mock("@/components/ui/button", () => ({
  Button: ({ children, variant: _variant, size: _size, ...props }) => <button {...props}>{children}</button>,
}), { virtual: true });

const headers = { Authorization: "Bearer test" };

function overview({ signatures, totals }) {
  return {
    window_days: 90,
    min_occurrences: 4,
    signatures,
    totals,
    by_client: [{ client_id: "cli-1", client_name: "ACME", signatures: 1, annual_hours: 16.2, annual_cost: 2430.0, costed_signatures: 1 }],
    evidence: { tickets_considered: 8, time_entries_considered: 8, tickets_with_recorded_labour: 8 },
    boundary: "Support Debt never invents a labour rate.",
  };
}

const costedRow = {
  client_id: "cli-1",
  client_name: "ACME",
  signature: "offline printer",
  label: "Printer offline again",
  occurrences: 6,
  ticket_ids: ["tkt-1"],
  hours: 4.0,
  cost: 600.0,
  cost_basis: "complete",
  categories: ["hardware"],
  first_seen: "2026-07-01T00:00:00+00:00",
  last_seen: "2026-10-06T00:00:00+00:00",
  window_days: 90,
  annual_hours: 16.2,
  annual_cost: 2430.0,
  annual_repeats: 24,
  source_fix: "Remove the source rather than scheduling the work again.",
  projection_basis: "Observed over 90 days and projected to a year.",
};

async function render() {
  const view = document.createElement("div");
  document.body.appendChild(view);
  const root = createRoot(view);
  await act(async () => {
    root.render(<SupportDebtPanel headers={headers} />);
  });
  // Let the resolved request settle inside act so React never warns about a
  // state update that escaped the test's own flush.
  await act(async () => {});
  return view;
}

beforeEach(() => {
  axios.get.mockReset();
});

test("a recorded figure is shown as a yearly management figure with its basis", async () => {
  axios.get.mockResolvedValue({
    data: overview({
      signatures: [costedRow],
      totals: { signatures: 1, recurring_tickets: 6, annual_hours: 16.2, annual_cost: 2430.0, costed_signatures: 1, uncosted_signatures: 0 },
    }),
  });
  const view = await render();

  expect(axios.get).toHaveBeenCalledWith("http://api.test/support-debt/overview?window_days=90", { headers });
  expect(view.querySelector('[data-testid="support-debt-headline"]').textContent).toContain("$2,430.00");
  expect(view.querySelector('[data-testid="support-debt-annual-cost"]').textContent).toBe("$2,430.00");
  const row = view.querySelector('[data-testid="support-debt-offline-printer"]');
  expect(row.textContent).toContain("6 repeats");
  expect(row.textContent).toContain("16.2h/yr");
  expect(row.textContent).toContain("Value recorded for all work");
  expect(row.textContent).toContain("Last seen 2026-10-06");
  expect(row.textContent).toContain("Remove the source");
  expect(view.textContent).toContain("never invents a labour rate");
});

test("unrecorded value is stated, never rendered as a zero dollar figure", async () => {
  axios.get.mockResolvedValue({
    data: overview({
      signatures: [{ ...costedRow, cost: null, cost_basis: "none", annual_cost: null, annual_repeats: 24, annual_hours: 16.2 }],
      totals: { signatures: 1, recurring_tickets: 6, annual_hours: 16.2, annual_cost: null, costed_signatures: 0, uncosted_signatures: 1 },
    }),
  });
  const view = await render();

  expect(view.querySelector('[data-testid="support-debt-annual-cost"]').textContent).toBe("Not recorded");
  expect(view.querySelector('[data-testid="support-debt-headline"]').textContent).toMatch(/no dollar figure is claimed/);
  expect(view.querySelector('[data-testid="support-debt-basis"]').textContent).toBe("Hours only — no rate recorded");
  expect(view.textContent).not.toContain("$0.00");
});

test("an empty window explains the evidence floor instead of reporting debt", async () => {
  axios.get.mockResolvedValue({
    data: overview({
      signatures: [],
      totals: { signatures: 0, recurring_tickets: 0, annual_hours: 0, annual_cost: null, costed_signatures: 0, uncosted_signatures: 0 },
    }),
  });
  const view = await render();

  expect(view.querySelector('[data-testid="support-debt-empty"]').textContent).toMatch(/at least 4 times/);
  expect(view.querySelector('[data-testid="support-debt-signatures"]')).toBeNull();
});
