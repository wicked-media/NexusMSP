/**
 * Browser payloads for late-payment communication actions.
 *
 * Commercial values (recipient, amount, customer name, due date and portal
 * URL) belong to the server-owned invoice/payment records.  These helpers
 * intentionally accept only stable Nexus identifiers.
 */

function requiredId(value, label) {
  const id = String(value || "").trim();
  if (!id) throw new Error(`${label} is required`);
  return id;
}

export function buildLatePaymentReminderPayload(invoiceId) {
  return { invoice_id: requiredId(invoiceId, "Invoice ID") };
}

export function buildLatePaymentConfirmationPayload(invoiceId, paymentTransactionId) {
  return {
    invoice_id: requiredId(invoiceId, "Invoice ID"),
    payment_transaction_id: requiredId(paymentTransactionId, "Payment transaction ID"),
  };
}
