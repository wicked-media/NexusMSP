/* eslint-disable testing-library/no-unnecessary-act -- Native React createRoot requires act. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import { signalIndex } from "@/lib/workspaceLearning";
import { TicketModuleHeader, TicketWorkspaceTabs } from "./TicketWorkspaceShell";

// The `@/` alias is a webpack/craco alias with no jest mapping, so every aliased
// import the shell makes is registered here. The ranking rules themselves are the
// real module: this test is about how the tab bar applies them.
jest.mock("@/lib/workspaceLearning", () => jest.requireActual("../../lib/workspaceLearning"), { virtual: true });
jest.mock("@/lib/ticketWorkspaceHelpers", () => jest.requireActual("../../lib/ticketWorkspaceHelpers"), { virtual: true });
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("react-router-dom", () => ({ Link: ({ children }) => <span>{children}</span>, useLocation: () => ({ pathname: "/tickets" }) }), { virtual: true });
jest.mock("@/components/NexusWorkspaceHeader", () => ({ __esModule: true, default: () => <div /> }), { virtual: true });
jest.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }) => <div>{children}</div>,
  SheetContent: ({ children }) => <div>{children}</div>,
  SheetDescription: ({ children }) => <div>{children}</div>,
  SheetHeader: ({ children }) => <div>{children}</div>,
  SheetTitle: ({ children }) => <div>{children}</div>,
}), { virtual: true });
jest.mock("@/components/ui/badge", () => ({
  Badge: ({ children, variant: _variant, ...props }) => <span {...props}>{children}</span>,
}), { virtual: true });
jest.mock("@/components/ui/button", () => ({
  Button: ({ children, variant: _variant, size: _size, asChild: _asChild, ...props }) => <button {...props}>{children}</button>,
}), { virtual: true });
// Radix renders tab panels and menu content only when selected/opened; that
// difference is exactly what tells a promoted view apart from a held one.
jest.mock("@/components/ui/tabs", () => ({
  TabsList: ({ children, ...props }) => <div {...props}>{children}</div>,
  TabsTrigger: ({ children, value, ...props }) => <button data-value={value} {...props}>{children}</button>,
}), { virtual: true });
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
    DropdownMenuItem: ({ children, onSelect, asChild: _asChild, ...props }) => (
      <button type="button" data-menu-item="true" {...props} onClick={() => onSelect?.()}>{children}</button>
    ),
    DropdownMenuLabel: ({ children, ...props }) => <div {...props}>{children}</div>,
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuGroup: ({ children }) => <div>{children}</div>,
  };
}, { virtual: true });

const viewEvidence = (target, count) => signalIndex([
  { surface: "view", target, count, last_used_at: "2026-05-01T00:00:00+00:00" },
]);

describe("TicketWorkspaceTabs", () => {
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
    <TicketWorkspaceTabs activeTab="conversation" onTabChange={jest.fn()} counts={{}} {...props} />,
  ));

  const visibleTabs = () => [...host.querySelectorAll("[data-value]")].map((node) => node.getAttribute("data-value"));

  const heldViews = () => [...host.querySelectorAll("[data-menu-item]")].map((node) => node.textContent);

  const click = (testId) => act(async () => {
    host.querySelector(`[data-testid="${testId}"]`).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  const clickByText = (text) => act(async () => {
    const item = [...host.querySelectorAll("button")].find((node) => node.textContent.includes(text));
    item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  test("cold start is exactly the declared tab bar and claims nothing", async () => {
    await render();

    expect(visibleTabs()).toEqual(["conversation", "worksheets", "attachments", "time", "timeline"]);
    expect(host.querySelector('[data-testid="ticket-workspace-tabs-learning"]')).toBeNull();
    // Views that did not earn a slot stay behind More, which is closed.
    expect(host.querySelector('[data-testid="ticket-forget-learning"]')).toBeNull();
  });

  test("a view the technician really uses is promoted into the bar", async () => {
    await render({ personal: viewEvidence("audit", 9) });

    // The used view leads, and the bar grows by exactly the one promoted slot.
    expect(visibleTabs()).toEqual(["audit", "conversation", "worksheets", "attachments", "time", "timeline"]);

    const chip = host.querySelector('[data-testid="ticket-workspace-tabs-learning"]');
    expect(chip.textContent).toContain("Adapted to your use");
    expect(chip.getAttribute("data-learning-tone")).toBe("personal");
    expect(chip.getAttribute("title")).toContain("Nothing here changes what you can access");

    // A promoted view is no longer the More menu's business; the rest still are.
    await click("ticket-more-tabs");
    const held = heldViews();
    expect(held.some((label) => label.includes("Audit log"))).toBe(false);
    expect(held.some((label) => label.includes("Blueprint / worksheet"))).toBe(true);
    expect(held.some((label) => label.includes("Historical matches"))).toBe(true);
  });

  test("a view with only a stray click or two does not move the bar", async () => {
    await render({ personal: viewEvidence("audit", 2) });

    expect(visibleTabs()).toEqual(["conversation", "worksheets", "attachments", "time", "timeline"]);
    expect(host.querySelector('[data-testid="ticket-workspace-tabs-learning"]')).toBeNull();
  });

  test("a technician's own habit outranks what the team uses", async () => {
    await render({
      team: viewEvidence("items", 40),
      personal: viewEvidence("audit", 4),
    });

    // Two views were earned a slot: the technician's own habit first, then the
    // team's staple. Both come from the More menu, so nothing is lost either way.
    expect(visibleTabs()).toEqual(["audit", "items", "conversation", "worksheets", "attachments", "time", "timeline"]);
  });

  test("opening a view records it as a view and switches the workspace", async () => {
    const onRecordAction = jest.fn();
    const onTabChange = jest.fn();
    await render({ onRecordAction, onTabChange });

    await click("ticket-more-tabs");
    await clickByText("Blueprint / worksheet");

    expect(onRecordAction).toHaveBeenCalledWith("view", "blueprint");
    expect(onTabChange).toHaveBeenCalledWith("blueprint");
  });

  test("a tab already in the bar records its own evidence", async () => {
    const onRecordAction = jest.fn();
    await render({ onRecordAction });

    const attachments = [...host.querySelectorAll("[data-value]")].find((node) => node.getAttribute("data-value") === "attachments");
    await act(async () => {
      attachments.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onRecordAction).toHaveBeenCalledWith("view", "attachments");
  });

  test("a technician can forget what Nexus learned, and is told what happened", async () => {
    const onForgetLearning = jest.fn().mockResolvedValue(11);
    await render({ personal: viewEvidence("audit", 9), onForgetLearning });

    await click("ticket-more-tabs");
    await click("ticket-forget-learning");

    expect(onForgetLearning).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(
      "11 learned tab signals forgotten",
      expect.objectContaining({ description: expect.stringContaining("back to the Nexus default order") }),
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  test("a failed forget is reported instead of silently pretending to reset", async () => {
    const onForgetLearning = jest.fn().mockRejectedValue(new Error("offline"));
    await render({ personal: viewEvidence("audit", 9), onForgetLearning });

    await click("ticket-more-tabs");
    await click("ticket-forget-learning");

    expect(toast.error).toHaveBeenCalledWith("Nexus could not forget the learned ordering. Nothing has been changed.");
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe("TicketModuleHeader desk tools", () => {
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
    <TicketModuleHeader title="Service Desk" subtitle="Live queue" {...props} />,
  ));

  const tools = () => [...host.querySelectorAll("[data-testid^='ticket-tool-']")]
    .map((node) => node.getAttribute("data-testid").replace("ticket-tool-", ""));

  const click = (testId) => act(async () => {
    host.querySelector(`[data-testid="${testId}"]`).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  test("cold start is the declared desk-tools menu, grouped as written, claiming nothing", async () => {
    await render();

    // The menu opens on nothing until it is asked for; opening it shows the
    // declared order inside the authored workflow groups.
    expect(host.querySelector("[data-testid^='ticket-tool-']")).toBeNull();
    await click("ticket-module-more");
    expect(tools()).toEqual(["blueprints", "catalog", "escalations", "routing", "workshop"]);
    expect(host.querySelector('[data-testid="ticket-tools-learning"]')).toBeNull();
    expect(host.querySelector('[data-testid="ticket-tools-forget-learning"]')).toBeNull();
  });

  test("a tool the technician really opens leads its own group, and the menu says why", async () => {
    await render({ personal: viewEvidence("catalog", 9), onForgetLearning: jest.fn() });

    await click("ticket-module-more");
    // Only the group that actually changed is reordered: the other two keep the
    // author's order, so a hand-authored workflow hierarchy survives learning.
    expect(tools()).toEqual(["catalog", "blueprints", "escalations", "routing", "workshop"]);

    const chip = host.querySelector('[data-testid="ticket-tools-learning"]');
    expect(chip.textContent).toContain("Adapted to your use");
    expect(chip.getAttribute("data-learning-tone")).toBe("personal");
    expect(chip.getAttribute("title")).toContain("Nothing here changes what you can access");
  });

  test("evidence that changes nothing is not reported as a change", async () => {
    // Workshop is the only tool in its group and is already first; the console
    // must not claim the menu was adapted when every group reads as declared.
    await render({ personal: viewEvidence("workshop", 9), onForgetLearning: jest.fn() });

    await click("ticket-module-more");
    expect(tools()).toEqual(["blueprints", "catalog", "escalations", "routing", "workshop"]);
    expect(host.querySelector('[data-testid="ticket-tools-learning"]')).toBeNull();
    expect(host.querySelector('[data-testid="ticket-tools-forget-learning"]')).toBeNull();
  });

  test("a tool with only a stray click or two does not move the menu", async () => {
    await render({ personal: viewEvidence("catalog", 2) });

    await click("ticket-module-more");
    expect(tools()).toEqual(["blueprints", "catalog", "escalations", "routing", "workshop"]);
    expect(host.querySelector('[data-testid="ticket-tools-learning"]')).toBeNull();
  });

  test("opening a desk tool records it as a view without closing the workspace", async () => {
    const onRecordAction = jest.fn();
    await render({ onRecordAction });

    await click("ticket-module-more");
    await click("ticket-tool-catalog");

    expect(onRecordAction).toHaveBeenCalledWith("view", "catalog");
  });

  test("a technician can forget the learned tool ordering, and is told what happened", async () => {
    const onForgetLearning = jest.fn().mockResolvedValue(7);
    await render({ personal: viewEvidence("catalog", 9), onForgetLearning });

    await click("ticket-module-more");
    await click("ticket-tools-forget-learning");

    expect(onForgetLearning).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(
      "7 learned tool signals forgotten",
      expect.objectContaining({ description: expect.stringContaining("back to the Nexus default order") }),
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  test("a failed forget is reported instead of silently pretending to reset", async () => {
    const onForgetLearning = jest.fn().mockRejectedValue(new Error("offline"));
    await render({ personal: viewEvidence("catalog", 9), onForgetLearning });

    await click("ticket-module-more");
    await click("ticket-tools-forget-learning");

    expect(toast.error).toHaveBeenCalledWith("Nexus could not forget the learned ordering. Nothing has been changed.");
    expect(toast.success).not.toHaveBeenCalled();
  });
});
