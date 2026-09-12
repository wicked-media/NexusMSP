/* eslint-disable testing-library/no-unnecessary-act -- Native React createRoot requires act; this test does not use Testing Library. */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import AICopilotStrip from "../components/tickets/AICopilotStrip";
jest.mock("axios");
jest.mock("@/App", () => ({ API: "/api" }), { virtual: true });
jest.mock("@/components/ui/button", () => ({ Button: ({ variant: _variant, size: _size, ...props }) => require("react").createElement("button", props) }), { virtual: true });
let container;
let root;
const ticket = { id: "a", title: "Outlook", description: "Fails to open", status: "open" };
const headers = {};
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  axios.get.mockResolvedValue({ data: {} });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); jest.clearAllMocks(); });
async function render(value) { await act(async () => root.render(<AICopilotStrip ticket={value} headers={headers} />)); }
test("summary shows provenance and becomes stale when the source changes", async () => {
  axios.post.mockResolvedValue({ data: { summary: "Outlook fails to start." } });
  await render(ticket);
  await act(async () => container.querySelector('[data-testid="copilot-summarize"]').click());
  expect(container.textContent).toContain("Outlook fails to start.");
  expect(container.textContent).toContain("Does not include conversation or work history");
  await render({ ...ticket, description: "Now opens" });
  expect(container.textContent).toContain("Ticket changed");
});
test("late AI response cannot appear on a different ticket", async () => {
  let resolve;
  axios.post.mockReturnValue(new Promise(done => { resolve = done; }));
  await render(ticket);
  await act(async () => container.querySelector('[data-testid="copilot-summarize"]').click());
  await render({ ...ticket, id: "b", title: "Printer" });
  await act(async () => resolve({ data: { summary: "Old private request" } }));
  expect(container.textContent).not.toContain("Old private request");
});

test("briefing exposes one accountable next move and the operational facts behind it", async () => {
  await render({ ...ticket, created_at: "2026-09-07T00:00:00.000Z" });

  expect(container.textContent).toContain("Nexus case briefing");
  expect(container.textContent).toContain("Recommended next move");
  expect(container.textContent).toContain("Set an accountable technician");
  expect(container.textContent).toContain("Unassigned");
  expect(container.textContent).toContain("No SLA target");
});
