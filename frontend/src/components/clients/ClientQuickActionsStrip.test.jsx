/* eslint-disable testing-library/no-unnecessary-act -- Native React createRoot requires act. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import { signalIndex } from "@/lib/clientWorkspaceLearning";
import ClientQuickActionsStrip from "./ClientQuickActionsStrip";

// The `@/` alias is a webpack/craco alias with no jest mapping, so every aliased
// import the strip makes is registered here. The ranking rules are the real
// module: this test is about how the strip applies them.
jest.mock("@/lib/clientWorkspaceLearning", () => jest.requireActual("../../lib/clientWorkspaceLearning"), { virtual: true });
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("react-router-dom", () => ({ useNavigate: jest.fn() }), { virtual: true });
jest.mock("@/components/ui/button", () => ({
  Button: ({ children, variant: _variant, size: _size, asChild: _asChild, ...props }) => <button {...props}>{children}</button>,
}), { virtual: true });
jest.mock("@/components/ui/badge", () => ({
  Badge: ({ children, variant: _variant, ...props }) => <span {...props}>{children}</span>,
}), { virtual: true });
// Radix renders menu content only while open; that difference is exactly what
// tells a promoted action apart from one still in the overflow menu.
jest.mock("@/components/ui/dropdown-menu", () => {
  const { createContext, useContext, useState } = require("react");
  const MenuContext = createContext({ open: false, toggle: () => {} });
  return {
    DropdownMenu: ({ children }) => {
      const [open, setOpen] = useState(false);
      return <MenuContext.Provider value={{ open, toggle: () => setOpen((current) => !current) }}><div>{children}</div></MenuContext.Provider>;
    },
    DropdownMenuTrigger: ({ children }) => {
      const { toggle } = useContext(MenuContext);
      return <span onClick={toggle}>{children}</span>;
    },
    DropdownMenuContent: ({ children }) => {
      const { open } = useContext(MenuContext);
      return open ? <div>{children}</div> : null;
    },
    DropdownMenuItem: ({ children, onSelect, ...props }) => (
      <button type="button" {...props} onClick={() => onSelect?.()}>{children}</button>
    ),
    DropdownMenuLabel: ({ children }) => <div>{children}</div>,
    DropdownMenuSeparator: () => <hr />,
  };
}, { virtual: true });

const { useNavigate } = require("react-router-dom");

const CLIENT = {
  id: "cl_1",
  name: "Northwind",
  email: "accounts@northwind.test",
  phone: "0400 000 000",
  website: "https://northwind.test",
  address: "1 Example Street, Melbourne",
};

const actionEvidence = (target, count) => signalIndex([
  { surface: "action", target, count, last_used_at: "2026-05-01T00:00:00+00:00" },
]);

describe("ClientQuickActionsStrip", () => {
  let host;
  let root;
  let navigate;

  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    navigate = jest.fn();
    useNavigate.mockReturnValue(navigate);
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
    <ClientQuickActionsStrip client={CLIENT} onOpenWarRoom={jest.fn()} {...props} />,
  ));

  const click = (testId) => act(async () => {
    host.querySelector(`[data-testid="${testId}"]`).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  test("cold start is exactly the designed strip and claims nothing", async () => {
    await render();

    expect(host.querySelector('[data-testid="qa-create-ticket"]').textContent).toContain("Create ticket");
    expect(host.querySelector('[data-testid="qa-add-device"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="qa-send-email"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="qa-schedule"]')).not.toBeNull();
    // Actions that did not earn a slot stay in the overflow menu, closed.
    expect(host.querySelector('[data-testid="qa-health"]')).toBeNull();
    expect(host.querySelector('[data-testid="client-quick-actions-learning"]')).toBeNull();
  });

  test("an overflow action is promoted into the strip once it is really used", async () => {
    await render({ personal: actionEvidence("health", 12) });

    expect(host.querySelector('[data-testid="qa-health"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="qa-schedule"]')).toBeNull();

    const chip = host.querySelector('[data-testid="client-quick-actions-learning"]');
    expect(chip.textContent).toContain("Adapted to your use");
    expect(chip.getAttribute("data-learning-tone")).toBe("personal");
    expect(chip.getAttribute("title")).toContain("Nothing here changes what you can access");
  });

  test("running a promoted action records the evidence and does the work", async () => {
    const onRecordAction = jest.fn();
    await render({ personal: actionEvidence("health", 12), onRecordAction });

    await click("qa-health");

    expect(onRecordAction).toHaveBeenCalledWith("action", "health");
    expect(navigate).toHaveBeenCalledWith("/client-health/cl_1");
  });

  test("an action nobody uses is one menu away, and still records what is used", async () => {
    const onRecordAction = jest.fn();
    await render({ onRecordAction });

    await click("qa-more-actions");
    await click("qa-warroom");

    expect(onRecordAction).toHaveBeenCalledWith("action", "warroom");
    expect(navigate).not.toHaveBeenCalled();
  });

  test("a technician can forget what Nexus learned, and is told what happened", async () => {
    const onForgetLearning = jest.fn().mockResolvedValue(12);
    await render({ personal: actionEvidence("health", 12), onForgetLearning });

    await click("qa-more-actions");
    await click("qa-forget-learning");

    expect(onForgetLearning).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(
      "12 learned shortcut signals forgotten",
      expect.objectContaining({ description: expect.stringContaining("back to the Nexus default order") }),
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  test("a failed forget is reported instead of silently pretending to reset", async () => {
    const onForgetLearning = jest.fn().mockRejectedValue(new Error("offline"));
    await render({ personal: actionEvidence("health", 12), onForgetLearning });

    await click("qa-more-actions");
    await click("qa-forget-learning");

    expect(toast.error).toHaveBeenCalledWith("Nexus could not forget the learned ordering. Nothing has been changed.");
    expect(toast.success).not.toHaveBeenCalled();
  });
});
