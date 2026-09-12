import {
  buildTicketQueueSignals, collectionFromResponse, matchTicketByReference, TICKET_PRIORITY_STYLES, TICKET_STATUS_STYLES,
  ticketHasStaleActivity,
  ticketModuleForPath, ticketToolAvailability, ticketWorkspaceToolForPath,
} from "./ticketWorkspaceHelpers";

describe("ticket workspace helpers", () => {
  test("maps ticket routes to the shared module navigation", () => {
    expect(ticketModuleForPath("/tickets")).toBe("queue");
    expect(ticketModuleForPath("/triage-queue")).toBe("triage");
    expect(ticketModuleForPath("/sla-hub")).toBe("sla");
    expect(ticketModuleForPath("/sla-timer")).toBe("sla");
    expect(ticketModuleForPath("/sla-report-gen")).toBe("sla");
    expect(ticketModuleForPath("/dispatch-board")).toBe("dispatch");
    expect(ticketWorkspaceToolForPath("/workshop-bench")).toMatchObject({
      id: "workshop",
      label: "Legacy workshop records",
    });
    expect(ticketWorkspaceToolForPath("/blueprints")?.id).toBe("blueprints");
  });

  test("only exposes device actions when a device is linked", () => {
    expect(ticketToolAvailability({ id: "t1" }, [{ id: "s1" }]).remote).toBe(false);
    expect(ticketToolAvailability({ id: "t1", device_id: "d1" }, []).remote).toBe(true);
    expect(ticketToolAvailability({ id: "t1", device_ids: ["d2"] }, [{ id: "s1" }]).scripts).toBe(true);
  });

  test("opens tickets from either their internal id or displayed ticket number", () => {
    const tickets = [{ id: "ticket-123", ticket_number: "INC-1042" }];
    expect(matchTicketByReference(tickets, "ticket-123")).toBe(tickets[0]);
    expect(matchTicketByReference(tickets, "#inc-1042")).toBe(tickets[0]);
    expect(matchTicketByReference(tickets, "missing")).toBeNull();
  });

  test("provides one shared semantic treatment for status and priority", () => {
    expect(TICKET_PRIORITY_STYLES.critical.badge).toContain("rose");
    expect(TICKET_PRIORITY_STYLES.low.badge).toContain("emerald");
    expect(TICKET_STATUS_STYLES.in_progress).toContain("amber");
    expect(TICKET_STATUS_STYLES.resolved).toContain("emerald");
  });

  test("keeps collection responses safe when an API returns an envelope or invalid payload", () => {
    const tickets = [{ id: "ticket-1" }];
    expect(collectionFromResponse(tickets)).toBe(tickets);
    expect(collectionFromResponse({ tickets }, ["tickets"])).toBe(tickets);
    expect(collectionFromResponse({ items: tickets })).toBe(tickets);
    expect(collectionFromResponse("<!doctype html>")).toEqual([]);
  });

  test("builds queue recovery from documented SLA, ownership and activity fields", () => {
    const now = new Date("2026-09-08T12:00:00.000Z");
    const tickets = [
      { id: "breached", status: "open", priority: "high", sla_due: "2026-09-08T10:00:00.000Z", updated_at: "2026-09-08T11:30:00.000Z", assigned_to: "tech-1" },
      { id: "unassigned", status: "open", priority: "medium", created_at: "2026-09-08T08:00:00.000Z", updated_at: "2026-09-08T11:30:00.000Z" },
      { id: "stale", status: "in_progress", priority: "low", created_at: "2026-09-08T03:00:00.000Z", updated_at: "2026-09-08T06:00:00.000Z", assigned_to: "tech-2" },
      { id: "closed", status: "closed", priority: "critical", sla_due: "2026-09-08T10:00:00.000Z", updated_at: "2026-09-08T06:00:00.000Z" },
    ];

    const signals = buildTicketQueueSignals(tickets, now);
    expect(signals.find(signal => signal.attention === "sla_breach").count).toBe(1);
    expect(signals.find(signal => signal.attention === "critical_high").count).toBe(1);
    expect(signals.find(signal => signal.attention === "unassigned").count).toBe(1);
    expect(signals.find(signal => signal.attention === "no_response").tickets.map(ticket => ticket.id)).toEqual(["stale"]);
    expect(ticketHasStaleActivity({ status: "open", created_at: "2026-09-08T03:00:00.000Z", updated_at: "2026-09-08T11:00:00.000Z" }, now)).toBe(false);
  });
});
