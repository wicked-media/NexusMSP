/* eslint-disable testing-library/no-unnecessary-act -- Native React createRoot requires act. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import ForgeDesignCard from "./ForgeDesignCard";

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("@/App", () => ({ API: "http://api.test" }), { virtual: true });
jest.mock("@/lib/nexusForge", () => jest.requireActual("../../lib/nexusForge"), { virtual: true });
jest.mock("axios");
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() } }));
jest.mock("@/components/ui/button", () => ({
  Button: ({ children, variant: _variant, size: _size, ...props }) => <button {...props}>{children}</button>,
}), { virtual: true });
jest.mock("@/components/ui/badge", () => ({
  Badge: ({ children, variant: _variant, ...props }) => <span {...props}>{children}</span>,
}), { virtual: true });
jest.mock("@/components/ui/input", () => ({
  Input: (props) => <input {...props} />,
}), { virtual: true });
jest.mock("@/components/ui/textarea", () => ({
  Textarea: ({ children, ...props }) => <textarea {...props}>{children}</textarea>,
}), { virtual: true });

const headers = { Authorization: "Bearer test" };

const CHECKS = [
  { id: "no_privileged_delivery", label: "No privileged delivery", status: "pass", detail: "The request composes capabilities." },
  { id: "write_verification", label: "Verification for state-changing steps", status: "needs_review", detail: "The composition reaches a state-changing capability." },
  { id: "blast_radius", label: "Blast radius", status: "fail", detail: "This design composes 30 capabilities. Split it." },
];

const REQUEST = {
  id: "frg-1",
  title: "Certificate expiry view",
  intent: "Show every certificate close to expiry with its dependent services",
  kind: "panel",
  expected_outcome: "One place to see expiring certificates",
  capability_refs: ["/api/devices"],
  capabilities: [{ id: "/api/devices", methods: ["GET", "POST"], mutating: true }],
  unresolved_capabilities: ["/api/imaginary-inventory"],
  scope: { tenant_enforced: true, permissions: ["devices.read"], data_classes: ["asset_metadata"] },
  sandbox_plan: "Run against the seeded sandbox tenant.",
  tests: ["An expiring certificate appears once"],
  verification: "",
  rollback: "Remove the panel registration and restore the previous layout.",
  review_interval_days: 90,
  checks: CHECKS,
  verdict: "needs_review",
  verdict_reason: "2 check(s) need a human decision: Verification for state-changing steps, Blast radius.",
  stage: "specified",
  review_history: [],
  versions: [],
  created_at: "2026-10-01T09:00:00+00:00",
  created_by: "Forge Tech",
};

const PAYLOAD = {
  requests: [REQUEST],
  tools: [],
  kinds: [{ id: "panel", meaning: "A contextual surface inside an existing workspace." }],
  summary: { total: 1, awaiting_review: 1, approved: 0, published: 0, failed: 0 },
  boundary: "Forge requests a technical design. It does not generate or deploy executable code.",
};

async function render() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<ForgeDesignCard headers={headers} onChanged={jest.fn()} />); });
  await act(async () => {});
  return container;
}

function setInput(element, value, prototype = window.HTMLInputElement.prototype) {
  const setter = Object.getOwnPropertyDescriptor(prototype, "value").set;
  setter.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function setSelect(element, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
  setter.call(element, value);
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

beforeEach(() => {
  axios.get.mockReset();
  axios.post.mockReset();
  document.body.innerHTML = "";
});

test("the card reports the verdict, the composition and the unserved capability", async () => {
  axios.get.mockResolvedValue({ data: PAYLOAD });
  const view = await render();

  const card = view.querySelector('[data-testid="forge-request-frg-1"]');
  expect(card.querySelector('[data-testid="forge-stage"]').textContent).toBe("Specified");
  expect(card.querySelector('[data-testid="forge-verdict"]').textContent).toBe("Needs a human decision");
  expect(card.textContent).toContain("1 pass · 1 to decide · 1 blocked");
  expect(card.textContent).toContain("/api/devices");
  expect(card.textContent).toContain("/api/imaginary-inventory (not served)");
  expect(view.querySelector('[data-testid="forge-boundary"]').textContent).toContain("does not generate or deploy executable code");
  expect(view.querySelector('[data-testid="forge-counts"]').textContent).toContain("1 designed");
});

test("an empty design record explains what has to exist before a tool is published", async () => {
  axios.get.mockResolvedValue({ data: { ...PAYLOAD, requests: [], summary: { total: 0, awaiting_review: 0, approved: 0, published: 0, failed: 0 } } });
  const view = await render();
  expect(view.querySelector('[data-testid="forge-empty"]').textContent).toContain("passing checklist");
  expect(view.querySelector('[data-testid="forge-empty"]').textContent).toContain("rollback retained");
});

test("the capability search lists what this API serves and composes it", async () => {
  axios.get.mockImplementation((url) => {
    if (url.endsWith("/nexus-forge/requests")) return Promise.resolve({ data: PAYLOAD });
    return Promise.resolve({
      data: {
        capabilities: [
          { id: "/api/devices", category: "devices", methods: ["GET", "POST"], mutating: true },
          { id: "/api/tickets/{ticket_id}", category: "tickets", methods: ["GET"], mutating: false },
        ],
        matched: 2,
        total: 40,
        truncated: true,
      },
    });
  });
  const view = await render();

  await act(async () => { setInput(view.querySelector('[data-testid="forge-capability-search"]'), "devices"); });
  await act(async () => { view.querySelector('[data-testid="forge-capability-search-submit"]').dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await act(async () => {});

  const results = view.querySelector('[data-testid="forge-capability-results"]');
  expect(results.textContent).toContain("/api/devices");
  expect(results.textContent).toContain("GET, POST · changes state");
  expect(results.textContent).toContain("read only");

  await act(async () => { view.querySelector('[data-testid="forge-add-/api/devices"]').dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  expect(view.querySelector('[data-testid="forge-composition"]').textContent).toContain("/api/devices");

  await act(async () => { view.querySelector('[data-testid="forge-remove-/api/devices"]').dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  expect(view.querySelector('[data-testid="forge-composition"]').textContent).toContain("Nothing composed yet");
});

test("a specification the checks would refuse is refused before it is sent", async () => {
  axios.get.mockResolvedValue({ data: PAYLOAD });
  const view = await render();

  await act(async () => { setInput(view.querySelector('[data-testid="forge-title"]'), "Certificate expiry view"); });
  await act(async () => {
    setInput(view.querySelector('[data-testid="forge-intent"]'), "Store the domain admin password so it can fix any device", window.HTMLTextAreaElement.prototype);
  });
  await act(async () => { view.querySelector('[data-testid="forge-submit"]').dispatchEvent(new MouseEvent("click", { bubbles: true })); });

  const errors = view.querySelector('[data-testid="forge-form-errors"]').textContent;
  expect(errors).toContain("Nexus cannot grant privilege");
  expect(errors).toContain("Compose at least one capability");
  expect(errors).toContain("Describe where the tool is proven first");
  expect(axios.post).not.toHaveBeenCalled();
});

test("a specification runs the checks and reports the verdict the server returned", async () => {
  axios.get.mockImplementation((url) => {
    if (url.endsWith("/nexus-forge/requests")) return Promise.resolve({ data: PAYLOAD });
    return Promise.resolve({ data: { capabilities: [{ id: "/api/devices", category: "devices", methods: ["GET"], mutating: false }], matched: 1, total: 1 } });
  });
  axios.post.mockResolvedValue({ data: { request: REQUEST, boundary: PAYLOAD.boundary } });
  const view = await render();

  // Compose the capability from the served catalogue, exactly as a technician would.
  await act(async () => { setInput(view.querySelector('[data-testid="forge-capability-search"]'), "devices"); });
  await act(async () => { view.querySelector('[data-testid="forge-capability-search-submit"]').dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await act(async () => {});
  await act(async () => { view.querySelector('[data-testid="forge-add-/api/devices"]').dispatchEvent(new MouseEvent("click", { bubbles: true })); });

  await act(async () => { setInput(view.querySelector('[data-testid="forge-title"]'), "Certificate expiry view"); });
  await act(async () => {
    setInput(view.querySelector('[data-testid="forge-intent"]'), "Show every certificate close to expiry and what depends on it", window.HTMLTextAreaElement.prototype);
  });
  await act(async () => {
    setInput(view.querySelector('[data-testid="forge-outcome"]'), "One place to see expiring certificates", window.HTMLTextAreaElement.prototype);
  });
  await act(async () => { setInput(view.querySelector('[data-testid="forge-permissions"]'), "devices.read"); });
  await act(async () => { setInput(view.querySelector('[data-testid="forge-data-classes"]'), "asset_metadata"); });
  await act(async () => { setInput(view.querySelector('[data-testid="forge-sandbox"]'), "Run against the seeded sandbox tenant for 14 days.", window.HTMLTextAreaElement.prototype); });
  await act(async () => { setInput(view.querySelector('[data-testid="forge-tests"]'), "An expiring certificate appears exactly once", window.HTMLTextAreaElement.prototype); });
  await act(async () => { setInput(view.querySelector('[data-testid="forge-rollback"]'), "Remove the panel registration and restore the layout.", window.HTMLTextAreaElement.prototype); });
  await act(async () => { view.querySelector('[data-testid="forge-submit"]').dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await act(async () => {});

  expect(axios.post).toHaveBeenCalledWith(
    "http://api.test/nexus-forge/requests",
    expect.objectContaining({
      title: "Certificate expiry view",
      kind: "panel",
      capability_refs: ["/api/devices"],
      scope: { tenant_enforced: true, permissions: ["devices.read"], data_classes: ["asset_metadata"] },
      review_interval_days: 90,
    }),
    { headers },
  );
});

test("opening a design shows every check and refuses to approve a blocked one", async () => {
  axios.get.mockResolvedValue({ data: PAYLOAD });
  const view = await render();

  await act(async () => { view.querySelector('[data-testid="forge-open-frg-1"]').dispatchEvent(new MouseEvent("click", { bubbles: true })); });

  const checks = view.querySelector('[data-testid="forge-checks"]');
  expect(checks.textContent).toContain("No privileged delivery");
  expect(checks.textContent).toContain("The composition reaches a state-changing capability.");
  expect(view.querySelector('[data-testid="forge-check-blast_radius"]').textContent).toContain("Fail");
  // A flagged-but-not-failed design can still be reviewed; nothing is approved silently.
  expect(view.querySelector('[data-testid="forge-review-decision"]')).not.toBeNull();
  expect(view.querySelector('[data-testid="forge-approval-blocked"]').textContent).toContain("cannot be approved");

  await act(async () => { setSelect(view.querySelector('[data-testid="forge-review-decision"]'), "approved"); });
  await act(async () => { setInput(view.querySelector('[data-testid="forge-review-note"]'), "Approving without a reason"); });
  await act(async () => { view.querySelector('[data-testid="forge-review-submit"]').dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  expect(axios.post).not.toHaveBeenCalled();
});

test("a design with no failing check is approved with the recorded reason", async () => {
  const clean = {
    ...REQUEST,
    checks: [
      { id: "no_privileged_delivery", label: "No privileged delivery", status: "pass", detail: "Composes capabilities." },
      { id: "write_verification", label: "Verification for state-changing steps", status: "needs_review", detail: "No verification stated." },
    ],
    verdict: "needs_review",
  };
  axios.get.mockResolvedValue({ data: { ...PAYLOAD, requests: [clean] } });
  axios.post.mockResolvedValue({ data: { request: { ...clean, stage: "approved" }, boundary: PAYLOAD.boundary } });
  const view = await render();

  await act(async () => { view.querySelector('[data-testid="forge-open-frg-1"]').dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await act(async () => { setSelect(view.querySelector('[data-testid="forge-review-decision"]'), "approved"); });
  await act(async () => { setInput(view.querySelector('[data-testid="forge-review-note"]'), "The verification gap is acceptable because the tool only previews records."); });
  await act(async () => { view.querySelector('[data-testid="forge-review-submit"]').dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await act(async () => {});

  expect(axios.post).toHaveBeenCalledWith(
    "http://api.test/nexus-forge/requests/frg-1/review",
    { decision: "approved", evidence_note: "The verification gap is acceptable because the tool only previews records." },
    { headers },
  );
});

test("a version is recorded only for an approved design, and the tool record shows it", async () => {
  const approved = { ...REQUEST, stage: "approved", verdict: "pass", checks: [], versions: [] };
  axios.get.mockResolvedValue({ data: { ...PAYLOAD, requests: [approved] } });
  const published = {
    ...approved,
    stage: "published",
    versions: [{ version: "1.0", note: "First release", supersedes: null, review_interval_days: 90, published_at: "2026-10-08T09:00:00+00:00" }],
  };
  axios.post.mockResolvedValue({
    data: {
      request: published,
      tools: [{ request_id: "frg-1", name: "Certificate expiry view", capabilities: ["/api/devices"], version_count: 1, latest_version: "1.0", review_interval_days: 90, next_review_at: "2027-01-06T09:00:00+00:00", review_due: false }],
      boundary: PAYLOAD.boundary,
    },
  });
  const view = await render();

  await act(async () => { view.querySelector('[data-testid="forge-open-frg-1"]').dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await act(async () => { setInput(view.querySelector('[data-testid="forge-publish-note"]'), "First release for the sandbox tenant"); });
  await act(async () => { view.querySelector('[data-testid="forge-publish-submit"]').dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await act(async () => {});

  expect(axios.post).toHaveBeenCalledWith(
    "http://api.test/nexus-forge/requests/frg-1/publish",
    { version: "1.0", evidence_note: "First release for the sandbox tenant" },
    { headers },
  );
});

test("a version older than the published one is refused before it is sent", async () => {
  const published = { ...REQUEST, stage: "published", verdict: "pass", checks: [], versions: [{ version: "1.0", review_interval_days: 90 }] };
  axios.get.mockResolvedValue({ data: { ...PAYLOAD, requests: [published] } });
  const view = await render();

  await act(async () => { view.querySelector('[data-testid="forge-open-frg-1"]').dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await act(async () => { setInput(view.querySelector('[data-testid="forge-publish-version"]'), "1.0"); });
  await act(async () => { setInput(view.querySelector('[data-testid="forge-publish-note"]'), "Re-releasing the same version"); });
  await act(async () => { view.querySelector('[data-testid="forge-publish-submit"]').dispatchEvent(new MouseEvent("click", { bubbles: true })); });

  expect(view.querySelector('[data-testid="forge-action-errors"]').textContent).toContain("never overwritten");
  expect(axios.post).not.toHaveBeenCalled();
});
