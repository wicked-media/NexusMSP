/**
 * Presentation and eligibility rules for a client's saved cards.
 *
 * Kept out of the components so the rules that decide whether a card may be
 * charged and how a masked card is described can be unit tested without
 * rendering. Every surface that shows saved cards — the client Billing tab and
 * the invoice workspace — reads them from here rather than restating them, so a
 * charge can never be offered in one place and refused in another.
 */

const BRAND_LABELS = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
  diners: "Diners Club",
  jcb: "JCB",
  unionpay: "UnionPay",
};

/** A brand label that never falls back to an empty string. */
export function cardBrandLabel(brand) {
  return BRAND_LABELS[String(brand || "").trim().toLowerCase()] || "Card";
}

/** `Expires 04/29`, or an explicit statement when Stripe reported no expiry. */
export function cardExpiryLabel(method) {
  const month = Number(method?.exp_month);
  const year = Number(method?.exp_year);
  if (!Number.isInteger(month) || !Number.isInteger(year) || month < 1 || month > 12 || year < 2000) {
    return "Expiry not reported";
  }
  const shortYear = year % 100;
  return `Expires ${String(month).padStart(2, "0")}/${String(shortYear).padStart(2, "0")}`;
}

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

/** Outstanding balance, floored at zero so an overpaid invoice never goes negative. */
export function invoiceBalance(invoice) {
  return Math.max(round2(round2(invoice?.total) - round2(invoice?.amount_paid)), 0);
}

const CLOSED_STATUSES = new Set(["cancelled", "void", "voided", "paid", "written_off"]);

/**
 * Whether a saved card may be charged against this invoice.
 *
 * Voided, cancelled and already-paid invoices are excluded here as well as
 * server-side: the UI must not offer a charge the API will refuse.
 */
export function isInvoiceChargeable(invoice) {
  if (!invoice || !invoice.id) return false;
  const status = String(invoice.status || "").trim().toLowerCase();
  if (CLOSED_STATUSES.has(status)) return false;
  if (String(invoice.payment_status || "").trim().toLowerCase() === "paid") return false;
  return invoiceBalance(invoice) > 0;
}

/** The chargeable invoices, in the order Nexus served them. */
export function chargeableInvoices(invoices) {
  return (Array.isArray(invoices) ? invoices : []).filter(isInvoiceChargeable);
}

/** The card a charge uses unless another is marked default: default first, else the oldest. */
export function defaultPaymentMethod(methods) {
  const list = Array.isArray(methods) ? methods : [];
  return list.find((method) => method.is_default) || list[0] || null;
}

/** The largest amount Nexus will accept for this invoice, as a form value. */
export function suggestedChargeAmount(invoice) {
  return invoiceBalance(invoice).toFixed(2);
}

/**
 * The one-line description of the card a charge would use, or null when the
 * client has no card on file. Callers render an explicit "no card on file"
 * statement instead of an empty label, so an unconfigured client is never
 * mistaken for a saved card that failed to load.
 */
export function savedCardSummary(methods) {
  const method = defaultPaymentMethod(methods);
  if (!method) return null;
  return {
    id: method.id,
    label: `${cardBrandLabel(method.brand)} •••• ${method.last4}`,
    expiry: cardExpiryLabel(method),
    isDefault: Boolean(method.is_default),
  };
}

/**
 * Currency for an amount and code, falling back to a plain statement when the
 * code is not one the runtime knows. Amounts are never rendered as `NaN` and a
 * currency the browser cannot format never blanks the page.
 */
export function formatMoney(amount, currency = "AUD") {
  const code = String(currency || "AUD").toUpperCase();
  const value = Number(amount) || 0;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(value);
  } catch {
    return `${code} ${value.toFixed(2)}`;
  }
}
