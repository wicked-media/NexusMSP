import {
  buildLatePaymentConfirmationPayload,
  buildLatePaymentReminderPayload,
} from "./latePaymentPayloads";

describe("late payment communication payloads", () => {
  test("reminders submit only the stable invoice identifier", () => {
    expect(buildLatePaymentReminderPayload(" invoice-a ")).toEqual({ invoice_id: "invoice-a" });
    expect(Object.keys(buildLatePaymentReminderPayload("invoice-a"))).toEqual(["invoice_id"]);
  });

  test("payment confirmations submit only the canonical invoice and payment transaction identifiers", () => {
    expect(buildLatePaymentConfirmationPayload("invoice-a", "payment-a")).toEqual({
      invoice_id: "invoice-a",
      payment_transaction_id: "payment-a",
    });
  });

  test("communication payloads fail before a request without stable identifiers", () => {
    expect(() => buildLatePaymentReminderPayload("")).toThrow("Invoice ID is required");
    expect(() => buildLatePaymentConfirmationPayload("invoice-a", "")).toThrow("Payment transaction ID is required");
  });
});
