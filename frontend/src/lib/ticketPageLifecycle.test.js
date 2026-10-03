/** @jest-environment node */
// Exercise the real page handlers with controlled network/state dependencies.
// This isolates request ordering without mounting unrelated ticket integrations.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const source = fs.readFileSync(path.join(__dirname, "../pages/TicketsPage.jsx"), "utf8");
test("handover briefing keeps a distinct per-ticket sibling identity", () => {
  const interpolation = String.fromCharCode(36);
  // Briefing and handover are one merged dialog surface since fbc3c90. It
  // keeps a per-ticket prefixed key, and no ticket-scoped sibling may fall
  // back to the bare ticket id or same-render sibling keys would collide.
  expect(source).toContain(`key={\`handover-${interpolation}{viewingTicket.id}\`}`);
  expect(source).not.toContain('key={viewingTicket.id}');
});

function handler(name, context) {
  const marker = `  const ${name} = `;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Missing handler ${name}`);
  const end = source.indexOf("\n  const ", start + marker.length);
  if (end < 0) throw new Error(`Missing handler boundary ${name}`);
  return vm.runInNewContext(`${source.slice(start, end)}\n${name};`, context);
}
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
test("adding products rejects invalid quantities and prevents duplicate concurrent stock mutations", async () => {
  const pending = deferred();
  const context = {
    addItemProduct: "product-a", viewingTicket: { id: "ticket-a" }, addItemQty: 2,
    addingItemRef: { current: false }, setAddingItem: jest.fn(),
    axios: { post: jest.fn(() => pending.promise) }, API: "/api", headers: {},
    setTicketProducts: jest.fn(), setAddItemProduct: jest.fn(), setAddItemQty: jest.fn(),
    toast: { error: jest.fn(), success: jest.fn() },
  };
  const add = handler("handleAddItemToTicket", context);
  const first = add();
  await add();
  expect(context.axios.post).toHaveBeenCalledTimes(1);
  pending.resolve({ data: { id: "line-a" } });
  await first;
  expect(context.addingItemRef.current).toBe(false);
  context.addItemQty = -2;
  await add();
  expect(context.axios.post).toHaveBeenCalledTimes(1);
  expect(context.toast.error).toHaveBeenCalled();
});
function detailContext(get) {
  const state = {};
  const setters = {};
  const names = ["ViewingTicket", "DetailTab", "ToolsOpen", "Suggestions", "AiAnalysis", "DeviceStatus", "Enrichment", "ClientContacts", "TicketParticipants", "TicketSubscribers", "TicketNotes", "TicketEmails", "ChildTickets", "TimeEntries", "AuditLog", "TicketAttachments", "TicketProducts", "TicketPurchaseOrders", "TicketSms", "WorksheetItems", "SuggestionsLoading", "EmailSignature", "EmailForm", "SmsForm", "Scripts", "SmsTemplates", "SmsConfig"];
  names.forEach(name => { setters[`set${name}`] = value => { state[name] = typeof value === "function" ? value(state[name]) : value; }; });
  return { state, context: {
    ...setters, ticketDetailRequestRef: { current: 0 }, clients: [], user: {},
    axios: { get, post: jest.fn().mockResolvedValue({}) }, API: "/api", headers: {},
    localPreviewTicketDetail: () => ({}), localPreviewCollection: rows => rows,
    collectionFromResponse: data => Array.isArray(data) ? data : [], LOCAL_PREVIEW_SCRIPTS: [],
    toast: { error: jest.fn() },
  } };
}
test("late ticket response cannot replace the currently opened ticket", async () => {
  const slow = deferred();
  const { context, state } = detailContext(jest.fn(url => url.includes("/tickets/a/") ? slow.promise : Promise.resolve({ data: [{ id: "b" }] })));
  const load = handler("fetchTicketDetail", context);
  const first = load({ id: "a", title: "First", ticket_number: "1" });
  await load({ id: "b", title: "Second", ticket_number: "2" });
  slow.resolve({ data: [{ id: "a" }] });
  await first;
  expect(state.ViewingTicket.id).toBe("b");
  expect(state.TicketNotes).toEqual([{ id: "b" }]);
  expect(state.EmailForm.subject).toBe("Re: 2 - Second");
});
test("switch clears previous details even when the next load fails", async () => {
  const get = jest.fn().mockResolvedValue({ data: [{ id: "a" }] });
  const { context, state } = detailContext(get);
  const load = handler("fetchTicketDetail", context);
  await load({ id: "a" });
  get.mockRejectedValue(new Error("offline"));
  await load({ id: "b" });
  expect(state.TicketNotes).toEqual([]);
  expect(state.TicketEmails).toEqual([]);
  expect(state.WorksheetItems).toEqual([]);
  expect(context.toast.error).toHaveBeenCalledTimes(1);
});
test("late contacts cannot fill the next ticket's recipient", async () => {
  const contacts = deferred();
  const { context, state } = detailContext(jest.fn(url => url === "/api/clients/client-a/contacts" ? contacts.promise : Promise.resolve({ data: [] })));
  const load = handler("fetchTicketDetail", context);
  await load({ id: "a", client_id: "client-a" });
  await load({ id: "b", client_id: "client-b" });
  contacts.resolve({ data: [{ id: "contact-a", email: "wrong@example.test" }] });
  await contacts.promise;
  expect(state.ClientContacts).toEqual([]);
  expect(state.EmailForm.to).toBe("");
});
function createContext(post) {
  return {
    createTicketPendingRef: { current: false }, setCreatingTicket: jest.fn(),
    formData: { title: "New ticket", client_id: "client-a" }, clients: [], createClientContacts: [],
    axios: { post }, API: "/api", headers: {}, STANDARD_SERVICE_KIT: "standard",
    toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn() },
    setIsCreateOpen: jest.fn(), setFormData: jest.fn(), fetchTickets: jest.fn(), fetchTicketDetail: jest.fn(),
  };
}
test("same-tick repeated Create submits only once and unlocks after completion", async () => {
  const pending = deferred();
  const context = createContext(jest.fn(() => pending.promise));
  const create = handler("handleCreateTicket", context);
  const first = create();
  await create();
  expect(context.axios.post).toHaveBeenCalledTimes(1);
  pending.resolve({ data: { id: "created", ticket_number: "123" } });
  await first;
  expect(context.createTicketPendingRef.current).toBe(false);
  expect(context.fetchTicketDetail).toHaveBeenCalledWith({ id: "created", ticket_number: "123" });
});
test("refresh failure after successful creation never reports creation failed", async () => {
  const context = createContext(jest.fn().mockResolvedValue({ data: { id: "created", ticket_number: "123" } }));
  context.fetchTickets.mockRejectedValue(new Error("offline"));
  await handler("handleCreateTicket", context)();
  expect(context.toast.error).not.toHaveBeenCalled();
  expect(context.toast.warning).toHaveBeenCalledWith(expect.stringContaining("was created"), expect.any(Object));
  expect(context.createTicketPendingRef.current).toBe(false);
});
test("unconfirmed creation unlocks and warns to check before retrying", async () => {
  const context = createContext(jest.fn().mockRejectedValue(new Error("connection lost")));
  await handler("handleCreateTicket", context)();
  expect(context.toast.error).toHaveBeenCalledWith("Ticket creation could not be confirmed", expect.any(Object));
  expect(context.createTicketPendingRef.current).toBe(false);
  expect(context.setFormData).not.toHaveBeenCalled();
});
