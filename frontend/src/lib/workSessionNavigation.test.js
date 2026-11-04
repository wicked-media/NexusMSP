import { canStartWorkSession, workSessionPath, workSessionTicketId } from "./workSessionNavigation";

describe("work session navigation", () => {
  test("uses a stable ticket ID rather than a display ticket number", () => {
    const ticket = { id: "ticket-7", ticket_number: "TKT-0007", status: "open" };

    expect(workSessionTicketId(ticket)).toBe("ticket-7");
    expect(workSessionPath(ticket)).toBe("/work-session?ticket=ticket-7");
  });

  test("keeps malformed or missing ticket context on the safe selector route", () => {
    expect(workSessionTicketId({ ticket_number: "TKT-0007" })).toBeNull();
    expect(workSessionPath({ ticket_number: "TKT-0007" })).toBe("/work-session");
  });

  test("does not offer a new work session for terminal tickets", () => {
    expect(canStartWorkSession({ id: "ticket-open", status: "in progress" })).toBe(true);
    expect(canStartWorkSession({ id: "ticket-closed", status: "closed" })).toBe(false);
    expect(canStartWorkSession({ id: "ticket-resolved", status: "resolved" })).toBe(false);
  });
});
