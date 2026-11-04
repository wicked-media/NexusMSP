import {
  cardBrandLabel,
  cardExpiryLabel,
  chargeableInvoices,
  defaultPaymentMethod,
  formatMoney,
  invoiceBalance,
  isInvoiceChargeable,
  savedCardSummary,
  suggestedChargeAmount,
} from "./savedCardPayment";

describe("saved customer cards", () => {
  test("labels known brands and falls back for anything Stripe does not name", () => {
    expect(cardBrandLabel("visa")).toBe("Visa");
    expect(cardBrandLabel("MASTERCARD")).toBe("Mastercard");
    expect(cardBrandLabel("amex")).toBe("American Express");
    expect(cardBrandLabel("")).toBe("Card");
    expect(cardBrandLabel(null)).toBe("Card");
    expect(cardBrandLabel("unknown_network")).toBe("Card");
  });

  test("formats expiry and never invents one when Stripe reported none", () => {
    expect(cardExpiryLabel({ exp_month: 4, exp_year: 2029 })).toBe("Expires 04/29");
    expect(cardExpiryLabel({ exp_month: 12, exp_year: 2030 })).toBe("Expires 12/30");
    expect(cardExpiryLabel({ exp_month: 13, exp_year: 2030 })).toBe("Expiry not reported");
    expect(cardExpiryLabel({ exp_month: 4 })).toBe("Expiry not reported");
    expect(cardExpiryLabel({})).toBe("Expiry not reported");
  });

  test("computes a balance that cannot go negative or pick up float drift", () => {
    expect(invoiceBalance({ total: 100, amount_paid: 30 })).toBe(70);
    expect(invoiceBalance({ total: 0.1, amount_paid: 0.2 })).toBe(0);
    expect(invoiceBalance({ total: 250.555, amount_paid: 0.005 })).toBe(250.55);
    expect(invoiceBalance({})).toBe(0);
  });

  test("offers only invoices a charge could actually settle", () => {
    const invoices = [
      { id: "open", status: "sent", total: 100, amount_paid: 0 },
      { id: "overdue", status: "overdue", payment_status: "unpaid", total: 50, amount_paid: 10 },
      { id: "paid-by-field", status: "sent", payment_status: "paid", total: 50, amount_paid: 0 },
      { id: "partial-but-paid", status: "paid", total: 50, amount_paid: 50 },
      { id: "voided", status: "void", total: 50, amount_paid: 0 },
      { id: "cancelled", status: "cancelled", total: 50, amount_paid: 0 },
      { id: "settled", status: "sent", total: 50, amount_paid: 50 },
      { status: "sent", total: 50, amount_paid: 0 },
    ];

    expect(chargeableInvoices(invoices).map((invoice) => invoice.id)).toEqual(["open", "overdue"]);
    expect(isInvoiceChargeable({ id: "open", status: "sent", total: 10, amount_paid: 0 })).toBe(true);
    expect(isInvoiceChargeable({ id: "void", status: "VOID", total: 10, amount_paid: 0 })).toBe(false);
    expect(isInvoiceChargeable(null)).toBe(false);
    expect(chargeableInvoices(undefined)).toEqual([]);
  });

  test("uses the default card, then the oldest, and says so when there is none", () => {
    const oldest = { id: "a", is_default: false };
    const newest = { id: "b", is_default: false };
    const chosen = { id: "c", is_default: true };

    expect(defaultPaymentMethod([oldest, newest, chosen])).toBe(chosen);
    expect(defaultPaymentMethod([oldest, newest])).toBe(oldest);
    expect(defaultPaymentMethod([])).toBeNull();
    expect(defaultPaymentMethod(undefined)).toBeNull();
  });

  test("suggests the outstanding balance as a two-decimal amount", () => {
    expect(suggestedChargeAmount({ total: 100, amount_paid: 25 })).toBe("75.00");
    expect(suggestedChargeAmount({ total: 100, amount_paid: 100 })).toBe("0.00");
  });

  test("summarises the card the invoice workspace would charge", () => {
    expect(savedCardSummary([
      { id: "a", brand: "visa", last4: "4242", exp_month: 4, exp_year: 2029, is_default: false },
      { id: "b", brand: "mastercard", last4: "4444", exp_month: 1, exp_year: 2031, is_default: true },
    ])).toEqual({
      id: "b",
      label: "Mastercard •••• 4444",
      expiry: "Expires 01/31",
      isDefault: true,
    });

    expect(savedCardSummary([{ id: "a", brand: "visa", last4: "4242" }])).toEqual({
      id: "a",
      label: "Visa •••• 4242",
      expiry: "Expiry not reported",
      isDefault: false,
    });

    // No card is null, not a blank label, so a caller can state the absence.
    expect(savedCardSummary([])).toBeNull();
    expect(savedCardSummary(undefined)).toBeNull();
  });

  test("renders an amount in a currency the runtime cannot format instead of blanking", () => {
    expect(formatMoney(12.5, "not-a-currency")).toBe("NOT-A-CURRENCY 12.50");
    expect(formatMoney(undefined, "not-a-currency")).toBe("NOT-A-CURRENCY 0.00");
    expect(formatMoney(1234.5, "AUD")).toMatch(/1[,.]?234/);
  });
});
