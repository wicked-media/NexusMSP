/* eslint-disable testing-library/no-unnecessary-act -- Native React createRoot requires act. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import { signalIndex } from "@/lib/workspaceLearning";
import InvoiceDetailTabs from "./InvoiceDetailTabs";

// The `@/` alias is a webpack/craco alias with no jest mapping, so every aliased
// import the tab bar makes is registered here. The ranking rules themselves are
// the real module: this test is about how the bar applies them.
jest.mock("@/lib/workspaceLearning", () => jest.requireActual("../../lib/workspaceLearning"), { virtual: true });
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/components/ui/badge", () => ({
  Badge: ({ children, variant: _variant, ...props }) => <span {...props}>{children}</span>,
}), { virtual: true });
jest.mock("@/components/ui/tabs", () => ({
  TabsList: ({ children, ...props }) => <div {...props}>{children}</div>,
  TabsTrigger: ({ children, value, ...props }) => <button data-value={value} {...props}>{children}</button>,
}), { virtual: true });

const COUNTS = { payments: 2, split: 1, emails: 3, audit: 7 };

const viewEvidence = (target, count) => signalIndex([
  { surface: "view", target, count, last_used_at: "2026-05-01T00:00:00+00:00" },
]);

describe("InvoiceDetailTabs", () => {
  let host;
  let root;

  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
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
    <InvoiceDetailTabs counts={COUNTS} {...props} />,
  ));

  const visibleTabs = () => [...host.querySelectorAll("[data-value]")].map((node) => node.getAttribute("data-value"));

  test("cold start keeps the declared tabs, their counts and their test ids", async () => {
    await render();

    expect(visibleTabs()).toEqual(["items", "payments", "emails", "audit"]);
    expect(host.querySelector('[data-testid="tab-inv-payments"]').textContent).toBe("Payments (2)");
    expect(host.querySelector('[data-testid="tab-inv-emails"]').textContent).toBe("Emails (3)");
    expect(host.querySelector('[data-testid="tab-inv-audit"]').textContent).toBe("Audit (7)");
    expect(host.querySelector('[data-testid="tab-inv-items"]').textContent).toBe("Line Items");
    // The payer-invoice tab only exists for a split parent.
    expect(host.querySelector('[data-testid="tab-inv-split-billing"]')).toBeNull();
    expect(host.querySelector('[data-testid="invoice-detail-tabs-learning"]')).toBeNull();
  });

  test("a split parent still gets its payer-invoice tab, in its learned position", async () => {
    await render({ isSplitParent: true, personal: viewEvidence("split", 6) });

    expect(visibleTabs()).toEqual(["split", "items", "payments", "emails", "audit"]);
    expect(host.querySelector('[data-testid="tab-inv-split-billing"]').textContent).toBe("Payer invoices (1)");
  });

  test("sustained use leads the bar and the workspace says so", async () => {
    await render({ personal: viewEvidence("payments", 9) });

    expect(visibleTabs()).toEqual(["payments", "items", "emails", "audit"]);
    const chip = host.querySelector('[data-testid="invoice-detail-tabs-learning"]');
    expect(chip.textContent).toContain("Adapted to your use");
    expect(chip.getAttribute("data-learning-tone")).toBe("personal");
    expect(chip.getAttribute("title")).toContain("Nothing here changes what you can access");
  });

  test("a stray click does not move the bar", async () => {
    await render({ personal: viewEvidence("audit", 2), team: viewEvidence("emails", 3) });

    expect(visibleTabs()).toEqual(["items", "payments", "emails", "audit"]);
    expect(host.querySelector('[data-testid="invoice-detail-tabs-learning"]')).toBeNull();
  });

  test("the team's habit orders the bar for a technician with none of their own", async () => {
    await render({ team: viewEvidence("audit", 20) });

    expect(visibleTabs()).toEqual(["audit", "items", "payments", "emails"]);
    expect(host.querySelector('[data-testid="invoice-detail-tabs-learning"]').getAttribute("data-learning-tone")).toBe("team");
  });

  test("opening a view records it and leaving it alone records nothing", async () => {
    const onRecordAction = jest.fn();
    await render({ onRecordAction });

    const audit = host.querySelector('[data-value="audit"]');
    await act(async () => {
      audit.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onRecordAction).toHaveBeenCalledWith("view", "audit");
  });

  test("a technician can forget the learned ordering, and a failure is reported", async () => {
    const onForgetLearning = jest.fn().mockResolvedValue(5);
    await render({ personal: viewEvidence("payments", 9), onForgetLearning });

    await act(async () => {
      host.querySelector('[data-testid="invoice-forget-learning"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onForgetLearning).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(
      "5 learned tab signals forgotten",
      expect.objectContaining({ description: expect.stringContaining("back to the Nexus default order") }),
    );

    const failing = jest.fn().mockRejectedValue(new Error("offline"));
    await render({ personal: viewEvidence("payments", 9), onForgetLearning: failing });
    await act(async () => {
      host.querySelector('[data-testid="invoice-forget-learning"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(toast.error).toHaveBeenCalledWith("Nexus could not forget the learned ordering. Nothing has been changed.");
  });
});
