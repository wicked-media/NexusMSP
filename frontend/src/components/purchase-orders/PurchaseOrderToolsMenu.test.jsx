/* eslint-disable testing-library/no-unnecessary-act -- Native React createRoot requires act. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import { signalIndex } from "@/lib/workspaceLearning";
import PurchaseOrderToolsMenu from "./PurchaseOrderToolsMenu";

// The `@/` alias is a webpack/craco alias with no jest mapping, so every aliased
// import the menu makes is registered here. The ranking rules themselves are the
// real module: this test is about how the menu applies them.
jest.mock("@/lib/workspaceLearning", () => jest.requireActual("../../lib/workspaceLearning"), { virtual: true });
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/components/WorkspaceActionMenu", () => {
  const { useState, createElement } = require("react");
  // The trigger owns the open/closed state, exactly like the real dropdown, so a
  // closed menu renders no items. It is named like a component because it is one.
  const Menu = ({ children, testId }) => {
    const [open, setOpen] = useState(false);
    return createElement(
      "div",
      null,
      createElement("button", { type: "button", "data-testid": testId, onClick: () => setOpen((current) => !current) }, "More"),
      open ? createElement("div", null, children) : null,
    );
  };
  const Item = ({ children, icon: _icon, onSelect, testId }) => createElement(
    "button",
    { type: "button", "data-testid": testId, "data-menu-item": "true", onClick: () => onSelect?.() },
    children,
  );
  return { __esModule: true, default: Menu, WorkspaceActionMenuItem: Item };
}, { virtual: true });
jest.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenuItem: ({ children, onSelect, ...props }) => {
    const { createElement } = require("react");
    return createElement("button", { type: "button", ...props, onClick: () => onSelect?.() }, children);
  },
  DropdownMenuSeparator: () => null,
}), { virtual: true });

const toolEvidence = (target, count) => signalIndex([
  { surface: "action", target, count, last_used_at: "2026-05-01T00:00:00+00:00" },
]);

const DECLARED = ["po-analytics-btn", "po-tools-vendors", "po-tools-vendor-scorecard", "po-tools-approval-policy", "check-escalations-btn"];

describe("PurchaseOrderToolsMenu", () => {
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

  const render = (props = {}) => act(async () => root.render(<PurchaseOrderToolsMenu {...props} />));

  const tools = () => [...host.querySelectorAll("[data-menu-item='true']")]
    .map((node) => node.getAttribute("data-testid"));

  const click = (testId) => act(async () => {
    host.querySelector(`[data-testid="${testId}"]`).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  test("cold start is the declared menu and claims nothing", async () => {
    await render();

    expect(host.querySelector("[data-menu-item='true']")).toBeNull();
    await click("po-workspace-tools");
    expect(tools()).toEqual(DECLARED);
    expect(host.querySelector('[data-testid="po-forget-learning"]')).toBeNull();
  });

  test("a tool the technician really uses leads the menu", async () => {
    await render({ personal: toolEvidence("approval_policy", 9), onForgetLearning: jest.fn() });

    await click("po-workspace-tools");
    expect(tools()).toEqual([
      "po-tools-approval-policy", "po-analytics-btn", "po-tools-vendors", "po-tools-vendor-scorecard", "check-escalations-btn",
    ]);
    // Everything is still reachable: the menu is reordered, never shortened.
    expect([...tools()].sort()).toEqual([...DECLARED].sort());
    expect(host.querySelector('[data-testid="po-forget-learning"]')).not.toBeNull();
  });

  test("evidence that changes nothing is not reported as a change", async () => {
    // Analytics is already first, and a team staple alone must not claim more.
    await render({ personal: toolEvidence("analytics", 9), onForgetLearning: jest.fn() });

    await click("po-workspace-tools");
    expect(tools()).toEqual(DECLARED);
    expect(host.querySelector('[data-testid="po-forget-learning"]')).toBeNull();
  });

  test("a stray click or two does not move the menu", async () => {
    await render({ personal: toolEvidence("check_escalations", 2) });

    await click("po-workspace-tools");
    expect(tools()).toEqual(DECLARED);
  });

  test("the team's staple is used while the technician has no habit of their own", async () => {
    await render({ team: toolEvidence("vendor_scorecard", 12), onForgetLearning: jest.fn() });

    await click("po-workspace-tools");
    expect(tools()[0]).toBe("po-tools-vendor-scorecard");
  });

  test("using a tool records it and still does the work", async () => {
    const onRecordAction = jest.fn();
    const onCheckEscalations = jest.fn();
    await render({ onRecordAction, onCheckEscalations });

    await click("po-workspace-tools");
    await click("check-escalations-btn");

    expect(onRecordAction).toHaveBeenCalledWith("action", "check_escalations");
    expect(onCheckEscalations).toHaveBeenCalled();
  });

  test("a technician can forget the learned ordering, and is told what happened", async () => {
    const onForgetLearning = jest.fn().mockResolvedValue(5);
    await render({ personal: toolEvidence("approval_policy", 9), onForgetLearning });

    await click("po-workspace-tools");
    await click("po-forget-learning");

    expect(onForgetLearning).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(
      "5 learned tool signals forgotten",
      expect.objectContaining({ description: expect.stringContaining("back to the Nexus default order") }),
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  test("a failed forget is reported instead of silently pretending to reset", async () => {
    const onForgetLearning = jest.fn().mockRejectedValue(new Error("offline"));
    await render({ personal: toolEvidence("approval_policy", 9), onForgetLearning });

    await click("po-workspace-tools");
    await click("po-forget-learning");

    expect(toast.error).toHaveBeenCalledWith("Nexus could not forget the learned ordering. Nothing has been changed.");
    expect(toast.success).not.toHaveBeenCalled();
  });
});
