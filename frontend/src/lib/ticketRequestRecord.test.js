import { buildTicketRequestRecord, formatTicketRequestSource } from "./ticketRequestRecord";

describe("ticket request record", () => {
  test("keeps the source request metadata and formats a recorded source", () => {
    expect(buildTicketRequestRecord({
      description: "VPN is disconnected for the sales team.",
      source: "agent_contact_form",
      contact_name: "Taylor Nguyen",
      contact_email: "taylor@example.com",
      created_at: "2026-09-08T01:05:00.000Z",
    }, { hostname: "SALES-LT-04" })).toMatchObject({
      description: "VPN is disconnected for the sales team.",
      source: "Agent Contact Form",
      requester: { name: "Taylor Nguyen", email: "taylor@example.com" },
      deviceName: "SALES-LT-04",
    });
  });

  test("does not invent a request source, requester, device, or timestamp", () => {
    const record = buildTicketRequestRecord({ description: "Please investigate." });

    expect(record.source).toBeNull();
    expect(record.requester).toBeNull();
    expect(record.deviceName).toBeNull();
    expect(record.capturedAt).toBeNull();
  });

  test("handles legacy source labels and malformed dates safely", () => {
    expect(formatTicketRequestSource("walk-in")).toBe("Walk In");
    expect(buildTicketRequestRecord({ source: "portal", created_at: "not-a-date" }).capturedAt).toBeNull();
  });
});
