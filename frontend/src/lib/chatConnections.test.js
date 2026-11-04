import {
  directChatRequestContext,
  isPendingDirectChatRequest,
  normaliseDirectChatRequest,
} from "./chatConnections";

describe("customer chat connection payloads", () => {
  test("normalises request context without depending on display labels", () => {
    const request = normaliseDirectChatRequest({
      request_id: "request-42",
      requester: { name: "Sarah Jones", email: "sarah@example.com" },
      client: { name: "Northwind" },
      title: "Outlook needs help",
      reason: "Mail has stopped opening",
      context: { ticket_id: "TKT-48291", device_name: "SARAH-LT" },
    });

    expect(request).toMatchObject({
      id: "request-42",
      status: "pending",
      customerName: "Sarah Jones",
      clientName: "Northwind",
      subject: "Outlook needs help",
      message: "Mail has stopped opening",
      ticketReference: "TKT-48291",
      deviceName: "SARAH-LT",
    });
    expect(isPendingDirectChatRequest(request)).toBe(true);
    expect(directChatRequestContext(request)).toEqual([
      { label: "Client", value: "Northwind", tone: "cyan" },
      { label: "Ticket", value: "TKT-48291", tone: "violet" },
      { label: "Device", value: "SARAH-LT", tone: "emerald" },
    ]);
  });

  test("keeps a decided request out of the pending inbox", () => {
    expect(isPendingDirectChatRequest({ id: "request-43", status: "accepted" })).toBe(false);
  });
});
