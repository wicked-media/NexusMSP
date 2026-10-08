/* eslint-disable testing-library/no-unnecessary-act -- Native React createRoot requires act. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import FlowIntelligencePanel from "./FlowIntelligencePanel";

// The `@/` alias is a webpack/craco alias with no jest mapping, so every aliased
// import the panel makes is registered here. The outcome-contract rules under
// test are the real module, not a stub.
jest.mock("@/App", () => ({ API: "http://api.test" }), { virtual: true });
jest.mock("@/lib/flowIntelligence", () => jest.requireActual("../../lib/flowIntelligence"), { virtual: true });
jest.mock("axios");
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/components/ui/button", () => ({
  Button: ({ children, variant: _variant, size: _size, ...props }) => <button {...props}>{children}</button>,
}), { virtual: true });
jest.mock("@/components/ui/badge", () => ({
  Badge: ({ children, variant: _variant, ...props }) => <span {...props}>{children}</span>,
}), { virtual: true });

const headers = { Authorization: "Bearer test" };

const contractRow = {
  id: "oct-1",
  ticket_id: "tkt-1",
  outcome: "Sarah can open MYOB, reach the company database and generate an invoice.",
  preconditions: "MYOB licensed",
  dependencies: ["MYOB server"],
  acceptable_interruption: "Up to 10 minutes",
  verification_method: "customer_confirmed",
  rollback: "Restore the previous MYOB snapshot",
  evidence_days: 14,
  verified_at: null,
  evidence_expires_at: null,
  verification_kind: null,
  verification_history: [],
};

const breadcrumbPayload = {
  ticket_id: "tkt-1",
  kinds: ["hypothesis", "tested", "ruled_out", "finding", "next_step", "change"],
  breadcrumbs: [{ id: "bcr-1", kind: "ruled_out", text: "DNS resolution of the SQL host", scope_ref: "dev-1", created_at: "2026-10-08T01:00:00+00:00" }],
  changes_considered: 1,
  resume: {
    testing: "Direct TDS connection from the app server",
    ruled_out: ["DNS resolution of the SQL host"],
    findings: [],
    open_hypotheses: ["SQL failover misconfigured"],
    next_step: "Compare the service account permissions",
    resume_from: "2026-10-08T02:00:00+00:00",
  },
  stale: [{
    text: "DNS resolution of the SQL host",
    kind: "ruled_out",
    formed_at: "2026-10-08T01:00:00+00:00",
    reason: "possibly_stale",
    detail: "Network adapter configuration changed landed on this scope after this conclusion was formed.",
    change: { scope_ref: "dev-1", at: "2026-10-08T03:00:00+00:00", summary: "Network adapter configuration changed" },
  }],
  stale_count: 1,
  line: "You were testing: Direct TDS connection.",
};

const healthPayload = {
  ticket_id: "tkt-1",
  breadcrumbs_considered: 5,
  verdict: "stalled",
  reason: "2 diagnostic(s) repeated without new evidence after 35 minutes of investigation.",
  repeated_tests: 2,
  tests_since_conclusion: 3,
  distinct_tests: 1,
  unverified_assumptions: ["The print spooler is wedged"],
  scopes_tested: ["dev-1"],
  evidence_source_converged: true,
  minutes_investigating: 35,
  recommended_test: "Change the evidence source: repeat the same test from a known-good device.",
  boundary: "Nexus reports that the investigation is not reducing uncertainty and suggests one different test.",
};

function mockLoads({ contract = contractRow, status, breadcrumbs = breadcrumbPayload, health = healthPayload } = {}) {
  axios.get.mockImplementation((url) => {
    if (url.endsWith("/outcome-contract")) {
      return Promise.resolve({
        data: {
          contract,
          status: status || {
            status: "unverified",
            reason: "The contract is complete but no verification evidence has been recorded yet.",
            checks: [],
          },
          closeout_gate: {
            allowed: false,
            status: "unverified",
            reason: "The contract is complete but no verification evidence has been recorded yet.",
          },
          verification_kinds: ["automated_test", "technician_witnessed", "customer_confirmed", "monitoring_evidence"],
        },
      });
    }
    if (url.endsWith("/breadcrumbs")) return Promise.resolve({ data: breadcrumbs });
    if (url.endsWith("/investigation-health")) return Promise.resolve({ data: health });
    return Promise.reject(new Error(`unexpected ${url}`));
  });
}

async function render() {
  const view = document.createElement("div");
  document.body.appendChild(view);
  const root = createRoot(view);
  await act(async () => {
    root.render(<FlowIntelligencePanel ticketId="tkt-1" headers={headers} />);
  });
  // Let the resolved requests settle inside act so React never warns about a
  // state update that escaped the test's own flush.
  await act(async () => {});
  return view;
}

beforeEach(() => {
  axios.get.mockReset();
  axios.put.mockReset();
  axios.post.mockReset();
});

test("the panel renders the standing, the refused close-out and the restored investigation", async () => {
  mockLoads();
  const view = await render();

  expect(view.querySelector('[data-testid="flow-closeout-gate"]').textContent)
    .toContain("Close-out cannot claim this outcome");
  expect(view.querySelector('[data-testid="flow-contract-status"]').textContent).toBe("Not yet verified");
  expect(view.querySelector('[data-testid="flow-resume"]').textContent).toContain("You were testing");
  expect(view.querySelector('[data-testid="flow-resume"]').textContent).toContain("Compare the service account permissions");
  // A conclusion the record moved past is named, not silently trusted.
  expect(view.querySelector('[data-testid="flow-stale-count"]').textContent).toBe("1 to re-check");
  expect(view.querySelector('[data-testid="flow-stale-list"]').textContent).toContain("Possibly stale");

  // Dead End Detector: the verdict, its evidence and one different test.
  expect(view.querySelector('[data-testid="flow-dead-end-verdict"]').textContent).toBe("Investigation appears stalled");
  expect(view.querySelector('[data-testid="flow-dead-end-evidence"]').textContent).toContain("Evidence source:dev-1 only");
  expect(view.querySelector('[data-testid="flow-dead-end-recommendation"]').textContent)
    .toContain("repeat the same test from a known-good device");
});

test("an investigation without enough steps shows no dead-end verdict", async () => {
  mockLoads({ health: { verdict: "insufficient_evidence", reason: "Not enough recorded steps.", minutes_investigating: 4 } });
  const view = await render();
  expect(view.querySelector('[data-testid="flow-dead-end"]')).toBeNull();
});

test("a method written as the outcome is refused before any request is sent", async () => {
  mockLoads();
  const view = await render();

  const outcome = view.querySelector('[data-testid="flow-outcome-input"]');
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  await act(async () => { setValue.call(outcome, "Restart the MYOB service"); });
  await act(async () => {
    outcome.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    view.querySelector('[data-testid="flow-save-contract"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  expect(view.querySelector('[data-testid="flow-form-errors"]').textContent).toMatch(/method, not the outcome/);
  expect(axios.put).not.toHaveBeenCalled();
});

test("verifying the outcome posts the declared kind and a real observation", async () => {
  mockLoads();
  axios.post.mockResolvedValue({
    data: {
      contract: { ...contractRow, verification_history: [{ kind: "customer_confirmed" }] },
      status: { status: "verified", reason: "Outcome verified by customer confirmed.", checks: [] },
      closeout_gate: { allowed: true, status: "verified", reason: "Outcome verified and the evidence is still current." },
    },
  });
  const view = await render();

  const note = view.querySelector('[data-testid="flow-verify-note"]');
  const setInputValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  await act(async () => { setInputValue.call(note, "Sarah generated invoice INV-1043 in MYOB while we were on the call"); });
  await act(async () => {
    note.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    view.querySelector('[data-testid="flow-verify-submit"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  // Let the resolved request settle inside act so React never warns about a
  // state update that escaped the test's own flush.
  await act(async () => {});

  expect(axios.post).toHaveBeenCalledWith(
    "http://api.test/flow-intelligence/tickets/tkt-1/outcome-contract/verify",
    // The select defaults to the contract's own declared verification method.
    { kind: "customer_confirmed", evidence_note: "Sarah generated invoice INV-1043 in MYOB while we were on the call", evidence_days: 14 },
    { headers },
  );
  expect(view.querySelector('[data-testid="flow-closeout-gate"]').textContent).toContain("Verified outcome supports close-out");
});
