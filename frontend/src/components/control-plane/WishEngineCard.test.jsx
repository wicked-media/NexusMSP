/* eslint-disable testing-library/no-unnecessary-act -- Native React createRoot requires act. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import WishEngineCard from "./WishEngineCard";

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("@/App", () => ({ API: "http://api.test" }), { virtual: true });
jest.mock("@/lib/wishEngine", () => jest.requireActual("../../lib/wishEngine"), { virtual: true });
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

const CLUSTER = {
  signature: "certificate close expiry shows",
  occurrences: 3,
  reporter_count: 2,
  surfaces: ["devices", "tickets"],
  member_signatures: ["certificate close expiry shows", "certificate expiry view"],
  span_days: 17,
  first_seen_at: "2026-09-01T09:00:00+00:00",
  representative_text: "I need one view that shows every certificate close to expiry",
  suggested_disposition: { disposition: "forge_tool", signals: ["view"], reason: "1 signal(s) point at forge tool." },
  disposition: null,
  promotion: {
    allowed: false,
    reason: "A person has to record what this request should become before it can be promoted.",
  },
};

const OVERVIEW = {
  mine: [{
    id: "wsh-1",
    text: "I shouldn't have to open five screens to find the device warranty",
    surface: "devices",
    signature: "device find five open screens warranty",
    context_ref: null,
    created_at: "2026-10-01T09:00:00+00:00",
    suggestion: { disposition: "shortcut", signals: ["screens"], reason: "1 signal(s) point at shortcut." },
  }],
  clusters: [CLUSTER],
  total_requests: 4,
  clustered_requests: 3,
  unclustered_requests: 1,
  cluster_min_occurrences: 2,
  dispositions: [
    { id: "shortcut", meaning: "The capability exists but takes too many steps." },
    { id: "forge_tool", meaning: "No Nexus capability covers this yet." },
  ],
  boundary: "The Wish Engine reports shapes of frustration, not people. Text is shown to reviewers only once at least two technicians reported the same shape.",
};

async function render() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<WishEngineCard headers={headers} onChanged={jest.fn()} />); });
  await act(async () => {});
  return container;
}

function setInput(element, value, prototype = window.HTMLInputElement.prototype) {
  const setter = Object.getOwnPropertyDescriptor(prototype, "value").set;
  setter.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  axios.get.mockReset();
  axios.post.mockReset();
  document.body.innerHTML = "";
});

test("the card reports patterns and counts without naming a technician", async () => {
  axios.get.mockResolvedValue({ data: OVERVIEW });
  const view = await render();

  expect(view.querySelector('[data-testid="wish-cluster-count"]').textContent).toBe("1 shared pattern");
  const cluster = view.querySelector('[data-testid="wish-cluster-certificate close expiry shows"]');
  expect(cluster.textContent).toContain("3 reports");
  expect(cluster.textContent).toContain("2 technician(s)");
  expect(cluster.textContent).toContain("devices, tickets");
  expect(cluster.textContent).toContain("17 days apart");
  expect(cluster.textContent).toContain("I need one view that shows every certificate close to expiry");
  expect(view.querySelector('[data-testid="wish-suggestion"]').textContent).toContain("Suggested: Forge tool");
  // The card never renders an author, and it states the two-report rule on screen.
  expect(view.textContent).not.toContain("tech-1");
  expect(view.querySelector('[data-testid="wish-boundary"]').textContent).toContain("not people");
  expect(view.querySelector('[data-testid="wish-mine"]').textContent).toContain("device warranty");
  expect(view.querySelector('[data-testid="wish-mine"]').textContent).toContain("Suggested: Shortcut");
});

test("an undecided pattern states that Nexus will not promote it alone", async () => {
  axios.get.mockResolvedValue({ data: OVERVIEW });
  const view = await render();
  expect(view.querySelector('[data-testid="wish-undecided"]').textContent).toContain("will not promote a shape nobody has decided on");
});

test("with no shared pattern the card explains the threshold instead of showing one", async () => {
  axios.get.mockResolvedValue({ data: { ...OVERVIEW, clusters: [], clustered_requests: 0, unclustered_requests: 4 } });
  const view = await render();
  expect(view.querySelector('[data-testid="wish-clusters"]').textContent).toBe("");
  expect(view.querySelector('[data-testid="wish-empty"]').textContent).toContain("at least 2 technicians");
  expect(view.querySelector('[data-testid="wish-empty"]').textContent).toContain("shared-need list");
});

test("a request the server would refuse is refused before it is sent", async () => {
  axios.get.mockResolvedValue({ data: OVERVIEW });
  const view = await render();

  await act(async () => { setInput(view.querySelector('[data-testid="wish-text"]'), "too short", window.HTMLTextAreaElement.prototype); });
  await act(async () => { view.querySelector('[data-testid="wish-submit"]').dispatchEvent(new MouseEvent("click", { bubbles: true })); });

  expect(view.querySelector('[data-testid="wish-form-errors"]').textContent).toContain("at least 12 characters");
  expect(axios.post).not.toHaveBeenCalled();
});

test("reporting a request posts the workspace it was felt in", async () => {
  axios.get.mockResolvedValue({ data: OVERVIEW });
  axios.post.mockResolvedValue({ data: { clustered: false, cluster: null, boundary: "kept with you" } });
  const view = await render();

  await act(async () => {
    setInput(view.querySelector('[data-testid="wish-text"]'), "I need a warranty field on the device panel without opening tickets", window.HTMLTextAreaElement.prototype);
  });
  await act(async () => { setInput(view.querySelector('[data-testid="wish-surface"]'), "devices"); });
  await act(async () => { view.querySelector('[data-testid="wish-submit"]').dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await act(async () => {});

  expect(axios.post).toHaveBeenCalledWith(
    "http://api.test/wish-engine/wishes",
    { text: "I need a warranty field on the device panel without opening tickets", surface: "devices", context_ref: null },
    { headers },
  );
});

test("a disposition without evidence is refused and a closed promotion gate is shown", async () => {
  axios.get.mockResolvedValue({ data: OVERVIEW });
  const view = await render();

  await act(async () => {
    view.querySelector('[data-testid="wish-review-certificate close expiry shows"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(view.querySelector('[data-testid="wish-promotion-gate"]').textContent).toContain("A person has to record");
  expect(view.querySelector('[data-testid="wish-promote-submit"]')).toBeNull();

  await act(async () => { view.querySelector('[data-testid="wish-disposition-submit"]').dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  expect(view.querySelector('[data-testid="wish-action-errors"]').textContent).toContain("at least 5 characters");
  expect(axios.post).not.toHaveBeenCalled();
});

test("recording a disposition posts to the pattern's own path", async () => {
  axios.get.mockResolvedValue({ data: OVERVIEW });
  axios.post.mockResolvedValue({ data: { cluster: CLUSTER } });
  const view = await render();

  await act(async () => {
    view.querySelector('[data-testid="wish-review-certificate close expiry shows"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await act(async () => { setInput(view.querySelector('[data-testid="wish-disposition-note"]'), "Two technicians in two workspaces"); });
  await act(async () => { view.querySelector('[data-testid="wish-disposition-submit"]').dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await act(async () => {});

  expect(axios.post).toHaveBeenCalledWith(
    "http://api.test/wish-engine/clusters/certificate%20close%20expiry%20shows/disposition",
    // The select defaults to the suggestion, and the reasoning travels with it.
    { disposition: "forge_tool", evidence_note: "Two technicians in two workspaces" },
    { headers },
  );
});

test("a reviewed pattern can be promoted into the idea registry", async () => {
  const decided = {
    ...CLUSTER,
    disposition: {
      disposition: "forge_tool",
      evidence_note: "Two technicians, two workspaces",
      decided_by: "Ops lead",
      occurrences_at_decision: 3,
      reporter_count_at_decision: 2,
      idea_id: null,
    },
    promotion: { allowed: true, reason: "A reviewed disposition with recorded evidence covers a shared pattern." },
  };
  axios.get.mockResolvedValue({ data: { ...OVERVIEW, clusters: [decided] } });
  axios.post.mockResolvedValue({ data: { idea: { title: "Certificate expiry view" }, policy: "Capturing a candidate does not approve it." } });
  const view = await render();

  const cluster = view.querySelector('[data-testid="wish-cluster-certificate close expiry shows"]');
  expect(cluster.querySelector('[data-testid="wish-recorded"]')).not.toBeNull();
  expect(cluster.textContent).toContain("decided by Ops lead");

  await act(async () => {
    view.querySelector('[data-testid="wish-review-certificate close expiry shows"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await act(async () => { setInput(view.querySelector('[data-testid="wish-promote-summary"]'), "Two workspaces and two technicians report the same need.", window.HTMLTextAreaElement.prototype); });
  await act(async () => { view.querySelector('[data-testid="wish-promote-submit"]').dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await act(async () => {});

  expect(axios.post).toHaveBeenCalledWith(
    "http://api.test/wish-engine/clusters/certificate%20close%20expiry%20shows/promote",
    {
      title: "I need one view that shows every certificate close to expiry",
      summary: "Two workspaces and two technicians report the same need.",
      horizon: "explore",
    },
    { headers },
  );
});
