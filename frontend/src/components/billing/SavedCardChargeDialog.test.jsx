/* eslint-disable testing-library/no-unnecessary-act -- Native React createRoot requires act. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import { toast } from "sonner";
import SavedCardChargeDialog from "./SavedCardChargeDialog";

// The `@/` alias is a webpack/craco alias with no jest mapping, so every aliased
// import the dialog makes is registered here. The card rules themselves are the
// real module: this test is about how the dialog applies them.
jest.mock("@/lib/savedCardPayment", () => jest.requireActual("../../lib/savedCardPayment"), { virtual: true });
jest.mock("axios", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/lib/apiErrorMessage", () => ({
  apiErrorMessage: (error, fallback) => error?.response?.data?.detail || fallback,
}), { virtual: true });
jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }) => (open ? <div>{children}</div> : null),
}), { virtual: true });
jest.mock("@/components/NexusWorkflowDialog", () => ({
  __esModule: true,
  default: ({ children, footer }) => <div>{children}{footer}</div>,
}), { virtual: true });
jest.mock("@/components/ui/badge", () => ({
  Badge: ({ children, variant: _variant, ...props }) => <span {...props}>{children}</span>,
}), { virtual: true });
jest.mock("@/components/ui/button", () => ({
  Button: ({ children, variant: _variant, size: _size, ...props }) => <button {...props}>{children}</button>,
}), { virtual: true });
jest.mock("@/components/ui/input", () => ({
  Input: (props) => <input {...props} />,
}), { virtual: true });
jest.mock("@/components/ui/label", () => ({
  Label: ({ children, ...props }) => <label {...props}>{children}</label>,
}), { virtual: true });
jest.mock("@/components/ui/select", () => ({
  Select: ({ children }) => <div>{children}</div>,
  SelectTrigger: ({ children, ...props }) => <div {...props}>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }) => <div>{children}</div>,
  SelectItem: ({ children, value, ...props }) => <div data-value={value} {...props}>{children}</div>,
}), { virtual: true });

const CARD = { id: "pm_1", brand: "visa", last4: "4242", exp_month: 4, exp_year: 2029, is_default: true };
// An invoice the workspace has already proven chargeable: sent, partly paid.
const INVOICE = {
  id: "inv_1", invoice_number: "INV-1001", status: "sent", payment_status: "unpaid",
  total: 250, amount_paid: 50, currency: "AUD", client_id: "cl_1", client_name: "Northwind",
};
const BASE = "http://api.test/clients/cl_1/payment-methods";
const HEADERS = { Authorization: "Bearer session" };

describe("SavedCardChargeDialog", () => {
  let host;
  let root;

  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    axios.get.mockReset();
    axios.post.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    delete global.IS_REACT_ACT_ENVIRONMENT;
  });

  const render = (props = {}) => act(async () => root.render(
    <SavedCardChargeDialog
      open
      onOpenChange={jest.fn()}
      base={BASE}
      headers={HEADERS}
      clientName="Northwind"
      invoice={INVOICE}
      methods={[CARD]}
      {...props}
    />,
  ));

  const click = (testId) => act(async () => {
    host.querySelector(`[data-testid="${testId}"]`).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  test("names the invoice and its balance, then charges the card the workspace chose", async () => {
    axios.post.mockResolvedValue({ data: { status: "processing", message: "Card charged." } });
    await render();

    // The workspace opens on a decided invoice, so no picker is offered — the
    // invoice and its outstanding balance are stated instead.
    expect(host.textContent).toContain("INV-1001");
    expect(host.textContent).toContain("Visa •••• 4242");
    expect(host.querySelector('[data-testid="saved-card-charge-amount"]').value).toBe("200.00");
    expect(host.querySelector('[data-testid="saved-card-charge-invoice"]')).toBeNull();

    await click("saved-card-charge-submit");

    expect(axios.post).toHaveBeenCalledWith(
      `${BASE}/pm_1/charge`,
      { invoice_id: "inv_1", amount: 200 },
      { headers: HEADERS },
    );
    // A submitted charge is not a settled invoice, and the dialog says so until
    // the signed provider webhook confirms it.
    expect(host.querySelector('[data-testid="saved-card-charge-outcome"]').textContent)
      .toContain("credited only when the provider confirms");
  });

  test("reports a bank that requires authentication instead of implying payment", async () => {
    axios.post.mockResolvedValue({ data: { status: "requires_action", message: "Needs authentication." } });
    await render();

    await click("saved-card-charge-submit");

    const outcome = host.querySelector('[data-testid="saved-card-charge-outcome"]');
    expect(outcome.textContent).toContain("requires authentication");
    expect(outcome.textContent).toContain("nothing has been credited to this invoice");
    // The charge cannot be resubmitted blindly against a decided outcome.
    expect(host.querySelector('[data-testid="saved-card-charge-submit"]')).toBeNull();
  });

  test("reads the client's cards itself when the caller has not loaded them", async () => {
    axios.get.mockResolvedValue({
      data: { methods: [CARD, { id: "pm_2", brand: "mastercard", last4: "4444", is_default: false }], stripe_configured: true },
    });
    await render({ methods: null });

    expect(axios.get).toHaveBeenCalledWith(BASE, { headers: HEADERS });
    expect(host.textContent).toContain("Visa •••• 4242");
    expect(host.textContent).toContain("Mastercard •••• 4444");
    // The default card is pre-chosen, so an inattentive click cannot silently
    // charge the wrong stored card.
    await click("saved-card-charge-submit");
    expect(axios.post.mock.calls[0][0]).toBe(`${BASE}/pm_1/charge`);
  });

  test("states that no card is on file and offers to save one", async () => {
    axios.get.mockResolvedValue({ data: { methods: [], stripe_configured: true } });
    const onAddCard = jest.fn();
    await render({ methods: null, onAddCard });

    expect(host.querySelector('[data-testid="saved-card-charge-empty"]').textContent)
      .toContain("No card is saved for Northwind");
    expect(host.querySelector('[data-testid="saved-card-charge-submit"]').disabled).toBe(true);

    await click("saved-card-charge-add");
    expect(onAddCard).toHaveBeenCalled();
  });

  test("reports a role that may not see saved cards rather than showing none saved", async () => {
    axios.get.mockRejectedValue({ response: { status: 403 } });
    await render({ methods: null });

    expect(host.querySelector('[data-testid="saved-card-charge-error"]').textContent)
      .toContain("cannot view saved cards");
    expect(host.querySelector('[data-testid="saved-card-charge-empty"]')).toBeNull();
  });
});
