/* eslint-disable testing-library/no-unnecessary-act -- Native React createRoot requires act. */
import { act } from "react";
import { createRoot } from "react-dom/client";

import TicketServicePulse from "./TicketServicePulse";

function liveTicket(overrides = {}) {
  const now = Date.now();
  return {
    id: "ticket-1",
    ticket_number: "INC-0100",
    status: "open",
    ticket_type: "incident",
    priority: "high",
    title: "Email is unavailable",
    assigned_to: null,
    created_at: new Date(now - 60 * 60 * 1000).toISOString(),
    sla_due: new Date(now + 4 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

async function renderPulse(ticket, props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<TicketServicePulse ticket={ticket} {...props} />);
  });
  return { root };
}

describe("TicketServicePulse", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("makes the missing owner the next accountable move", async () => {
    const onClaim = jest.fn();
    const { root } = await renderPulse(liveTicket(), { onClaim });

    expect(document.body.textContent).toContain("Give this request an owner");
    const action = document.querySelector('[data-testid="ticket-next-move-action"]');
    await act(async () => {
      action.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onClaim).toHaveBeenCalledTimes(1);
    root.unmount();
  });

  test("shows the exact promised next update on the ticket", async () => {
    const promisedAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const { root } = await renderPulse(liveTicket({
      assigned_to: "tech-1",
      assigned_name: "Alex Technician",
      next_checkpoint_at: promisedAt,
    }), {
      notes: [{ visibility: "public", created_at: new Date().toISOString() }],
    });

    const promise = document.querySelector('[data-testid="ticket-pulse-next-checkpoint"]');
    expect(promise).not.toBeNull();
    expect(promise.textContent).toContain("Next update promised");
    expect(promise.textContent).toContain("in 2h");
    root.unmount();
  });

  test("does not offer work on a closed record", async () => {
    const { root } = await renderPulse(liveTicket({
      status: "closed",
      assigned_to: "tech-1",
      assigned_name: "Alex Technician",
      closed_at: new Date().toISOString(),
    }));

    expect(document.body.textContent).toContain("Service record complete");
    expect(document.querySelector('[data-testid="ticket-next-move-action"]')).toBeNull();
    expect(document.querySelector('[data-testid="ticket-pulse-countdown"]').textContent).toContain("Closed");
    root.unmount();
  });
});
