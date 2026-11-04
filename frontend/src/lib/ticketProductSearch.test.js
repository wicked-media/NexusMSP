import { ticketProductMatches } from "./ticketProductSearch";

const product = { name: "Office Handset", sku: "TEL-104", barcode: "931234567890", manufacturer: "Yealink", category: "Hardware" };
test("ticket products support partial, case insensitive, multi-field search", () => {
  expect(ticketProductMatches(product, "tel-10")).toBe(true);
  expect(ticketProductMatches(product, "931234")).toBe(true);
  expect(ticketProductMatches(product, "YEALINK handset")).toBe(true);
  expect(ticketProductMatches(product, "printer")).toBe(false);
});
test("inactive products are excluded and an empty query returns active records", () => {
  expect(ticketProductMatches(product, "")).toBe(true);
  expect(ticketProductMatches({ ...product, is_active: false }, "handset")).toBe(false);
});
