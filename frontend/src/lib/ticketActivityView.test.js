import { filterTicketActivity, isInternalTicketNote } from "./ticketActivityView";
const rows = [
  { id: "a", _type: "note", is_internal: true },
  { id: "b", _type: "note", visibility: "internal" },
  { id: "c", _type: "note", is_internal: false },
  { id: "d", _type: "email" },
];
test("both internal visibility formats stay out of the client filter", () => {
  expect(filterTicketActivity(rows, "client").map(row => row.id)).toEqual(["c", "d"]);
  expect(filterTicketActivity(rows, "internal").map(row => row.id)).toEqual(["a", "b"]);
  expect(filterTicketActivity(rows, "all")).toBe(rows);
  expect(isInternalTicketNote(rows[1])).toBe(true);
});
