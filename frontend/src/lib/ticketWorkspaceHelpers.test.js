import {
  collectionFromResponse, matchTicketByReference, TICKET_PRIORITY_STYLES, TICKET_STATUS_STYLES,
  ticketModuleForPath, ticketToolAvailability,
} from "./ticketWorkspaceHelpers";

describe("ticket workspace helpers", () => {
  test("maps ticket routes to the shared module navigation", () => {
    expect(ticketModuleForPath("/tickets")).toBe("queue");
    expect(ticketModuleForPath("/triage-queue")).toBe("triage");
    expect(ticketModuleForPath("/sla-hub")).toBe("sla");
    expect(ticketModuleForPath("/sla-timer")).toBe("sla");
    expect(ticketModuleForPath("/sla-report-gen")).toBe("sla");
    expect(ticketModuleForPath("/dispatch-board")).toBe("dispatch");
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
});
