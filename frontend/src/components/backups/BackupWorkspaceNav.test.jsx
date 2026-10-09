/* eslint-disable testing-library/no-unnecessary-act -- Native React createRoot requires act. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import BackupWorkspaceNav from "./BackupWorkspaceNav";

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, variant: _variant, size: _size, asChild: _asChild, ...props }) => <button {...props}>{children}</button>,
}), { virtual: true });
jest.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }) => children,
  DropdownMenuContent: ({ children }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect, ...props }) => <button onClick={onSelect} {...props}>{children}</button>,
  DropdownMenuLabel: ({ children, ...props }) => <div {...props}>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
}), { virtual: true });

describe("BackupWorkspaceNav", () => {
  let host;
  let root;

  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    delete global.IS_REACT_ACT_ENVIRONMENT;
  });

  test("keeps frequent backup destinations visible and selects them", async () => {
    const onSelect = jest.fn();
    await act(async () => root.render(
      <BackupWorkspaceNav activeTab="dashboard" onSelect={onSelect} onOpenAcronis={jest.fn()} onOpenSettings={jest.fn()} />,
    ));

    expect(host.querySelector('[data-testid="tab-dashboard"]').className).toContain("bg-primary/[0.12]");

    await act(async () => {
      host.querySelector('[data-testid="tab-live"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSelect).toHaveBeenCalledWith("live");
  });

  test("names the active secondary workspace in the tools trigger", async () => {
    await act(async () => root.render(
      <BackupWorkspaceNav activeTab="billing" onSelect={jest.fn()} onOpenAcronis={jest.fn()} onOpenSettings={jest.fn()} />,
    ));

    expect(host.querySelector('[data-testid="backup-tools-menu"]').textContent).toContain("Usage billing");
  });
});
