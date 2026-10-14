/* eslint-disable testing-library/no-unnecessary-act -- Native React createRoot requires act. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import { signalIndex } from "@/lib/workspaceLearning";
import ManagedAssetToolsMenu from "./ManagedAssetToolsMenu";

jest.mock("@/lib/workspaceLearning", () => jest.requireActual("../../lib/workspaceLearning"), { virtual: true });
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("react-router-dom", () => ({ useNavigate: jest.fn() }), { virtual: true });
jest.mock("@/components/ui/button", () => ({
  Button: ({ children, variant: _variant, size: _size, asChild: _asChild, ...props }) => <button {...props}>{children}</button>,
}), { virtual: true });
// Radix renders menu content only while open.
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
      <button type="button" data-menu-item="true" {...props} onClick={() => onSelect?.()}>{children}</button>
    ),
    DropdownMenuLabel: ({ children }) => <div>{children}</div>,
    DropdownMenuSeparator: () => <hr />,
  };
}, { virtual: true });

const { useNavigate } = require("react-router-dom");

const toolEvidence = (target, count) => signalIndex([
  { surface: "action", target, count, last_used_at: "2026-05-01T00:00:00+00:00" },
]);

describe("ManagedAssetToolsMenu", () => {
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

  const render = (props = {}) => act(async () => root.render(<ManagedAssetToolsMenu {...props} />));

  const click = (testId) => act(async () => {
    host.querySelector(`[data-testid="${testId}"]`).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  const menuLabels = () => [...host.querySelectorAll("[data-menu-item]")].map((node) => node.textContent);

  test("cold start is the declared tools menu and claims nothing", async () => {
    await render();

    await click("managed-assets-more");

    expect(menuLabels()).toEqual(["NexusOps Agent", "Maintenance", "Patch Tuesday"]);
    expect(host.querySelector('[data-testid="devices-forget-learning"]')).toBeNull();
  });

  test("the tool a technician actually opens leads the menu", async () => {
    await render({ personal: toolEvidence("patch_tuesday", 6) });

    await click("managed-assets-more");

    expect(menuLabels().slice(0, 3)).toEqual(["Patch Tuesday", "NexusOps Agent", "Maintenance"]);
  });

  test("opening a tool records the tool slug and goes there", async () => {
    const onRecordAction = jest.fn();
    await render({ onRecordAction });

    await click("managed-assets-more");
    const maintenance = [...host.querySelectorAll("[data-menu-item]")].find((node) => node.textContent.includes("Maintenance"));
    await act(async () => {
      maintenance.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // A path is not an identifier: the recorded target is the bounded slug.
    expect(onRecordAction).toHaveBeenCalledWith("action", "maintenance");
    expect(navigate).toHaveBeenCalledWith("/maintenance-scheduler");
  });

  test("a technician can forget the learned ordering, and is told what happened", async () => {
    const onForgetLearning = jest.fn().mockResolvedValue(4);
    await render({ personal: toolEvidence("patch_tuesday", 6), onForgetLearning });

    await click("managed-assets-more");
    await click("devices-forget-learning");

    expect(onForgetLearning).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(
      "4 learned signals forgotten",
      expect.objectContaining({ description: expect.stringContaining("back to the Nexus default order") }),
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  test("a failed forget is reported instead of silently pretending to reset", async () => {
    const onForgetLearning = jest.fn().mockRejectedValue(new Error("offline"));
    await render({ personal: toolEvidence("patch_tuesday", 6), onForgetLearning });

    await click("managed-assets-more");
    await click("devices-forget-learning");

    expect(toast.error).toHaveBeenCalledWith("Nexus could not forget the learned ordering. Nothing has been changed.");
    expect(toast.success).not.toHaveBeenCalled();
  });
});
