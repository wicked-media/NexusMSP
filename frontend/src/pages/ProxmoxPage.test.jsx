/* eslint-disable testing-library/no-unnecessary-act -- Native React createRoot requires act. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import { toast } from "sonner";

import ProxmoxPage from "./ProxmoxPage";

// The `@/` alias has no jest mapping, so every aliased module the page reaches
// is registered here with the smallest stand-in that keeps the page's own
// behaviour — what it requests, what it renders and what it tells the operator
// — under test.
jest.mock("axios", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() } }));
jest.mock("@/App", () => ({ __esModule: true, API: "http://api.test/api", useAuth: () => ({ token: "session-token" }) }), { virtual: true });
jest.mock("@/lib/apiErrorMessage", () => jest.requireActual("../lib/apiErrorMessage"), { virtual: true });
jest.mock("@/components/OperationalPageHeader", () => ({
  __esModule: true,
  default: ({ title, actions }) => (
    <header>
      <h1>{title}</h1>
      {actions}
    </header>
  ),
}), { virtual: true });
jest.mock("@/components/WorkspaceActionMenu", () => ({
  __esModule: true,
  default: ({ children, testId }) => <div data-testid={testId}>{children}</div>,
  WorkspaceActionMenuItem: ({ children, onSelect, testId, disabled }) => (
    <button type="button" data-testid={testId} disabled={disabled} onClick={onSelect}>{children}</button>
  ),
}), { virtual: true });
jest.mock("@/components/ui/card", () => ({
  Card: ({ children, className, ...props }) => <section className={className} {...props}>{children}</section>,
  CardContent: ({ children, className, ...props }) => <div className={className} {...props}>{children}</div>,
}), { virtual: true });
jest.mock("@/components/ui/button", () => ({
  Button: ({ children, className, ...props }) => <button type="button" className={className} {...props}>{children}</button>,
}), { virtual: true });
jest.mock("@/components/ui/input", () => ({ Input: (props) => <input {...props} /> }), { virtual: true });
jest.mock("@/components/ui/badge", () => ({
  Badge: ({ children, className, ...props }) => <span className={className} {...props}>{children}</span>,
}), { virtual: true });
jest.mock("@/components/ui/label", () => ({ Label: ({ children, ...props }) => <label {...props}>{children}</label> }), { virtual: true });
jest.mock("@/components/ui/select", () => ({
  Select: ({ children }) => <div>{children}</div>,
  SelectContent: ({ children }) => <div>{children}</div>,
  SelectItem: ({ children, value }) => <div data-value={value}>{children}</div>,
  SelectTrigger: ({ children, ...props }) => <div {...props}>{children}</div>,
  SelectValue: () => null,
}), { virtual: true });
jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }) => <div>{children}</div>,
  DialogHeader: ({ children }) => <div>{children}</div>,
  DialogTitle: ({ children }) => <h2>{children}</h2>,
  DialogFooter: ({ children }) => <div>{children}</div>,
}), { virtual: true });
jest.mock("@/components/ui/table", () => ({
  Table: ({ children }) => <table>{children}</table>,
  TableBody: ({ children }) => <tbody>{children}</tbody>,
  TableCell: ({ children, ...props }) => <td {...props}>{children}</td>,
  TableHead: ({ children }) => <th>{children}</th>,
  TableHeader: ({ children }) => <thead>{children}</thead>,
  TableRow: ({ children }) => <tr>{children}</tr>,
}), { virtual: true });
jest.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children, defaultValue }) => <div data-default-tab={defaultValue}>{children}</div>,
  TabsContent: ({ children }) => <div>{children}</div>,
  TabsList: ({ children }) => <div>{children}</div>,
  TabsTrigger: ({ children }) => <div>{children}</div>,
}), { virtual: true });

const BASE = "http://api.test/api";

const STOPPED_VM = {
  id: "vm-1",
  name: "DC-PRIMARY",
  vmid: 100,
  type: "qemu",
  node_name: "pve-node01",
  client_name: "Acme",
  os: "Windows Server 2022",
  vcpu: 4,
  ram_gb: 16,
  ip_address: "10.0.1.5",
  status: "stopped",
  backup_enabled: false,
  backup_schedule: "none",
};

const RUNNING_VM = { ...STOPPED_VM, status: "running" };

const UNCONFIGURED = { configured: false, mode: "unconfigured", connections: [], note: "" };

function seedGet({ connection = UNCONFIGURED, vms = [] } = {}) {
  const payload = (data) => Promise.resolve({ data });
  axios.get.mockImplementation((url) => {
    if (url === `${BASE}/proxmox/connection`) return payload(connection);
    if (url === `${BASE}/proxmox/nodes`) return payload([]);
    if (url === `${BASE}/proxmox/vms`) return payload(vms);
    if (url === `${BASE}/proxmox/backups`) return payload([]);
    if (url === `${BASE}/proxmox/backup-schedules`) return payload([]);
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

describe("ProxmoxPage provider honesty", () => {
  let host;
  let root;

  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    axios.get.mockReset();
    axios.post.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
    toast.info.mockReset();
    toast.warning.mockReset();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    delete global.IS_REACT_ACT_ENVIRONMENT;
  });

  const render = () => act(async () => {
    root.render(<ProxmoxPage />);
    await flush();
  });

  const click = async (testId) => act(async () => {
    const node = host.querySelector(`[data-testid="${testId}"]`);
    expect(node).not.toBeNull();
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
  });

  test("states that nothing is configured instead of showing demo inventory", async () => {
    seedGet();
    await render();

    const banner = host.querySelector('[data-testid="proxmox-unconfigured-banner"]');
    expect(banner).not.toBeNull();
    expect(banner.textContent).toContain("No Proxmox connection configured");
    expect(banner.textContent).toContain("empty rather than demo data");
    // The configured-connection health warning must not appear either.
    expect(host.textContent).not.toContain("A configured connection is not answering");
  });

  test("surfaces the server's refusal when execution has no connection", async () => {
    seedGet({ vms: [STOPPED_VM] });
    const detail = "No Proxmox connection is configured for this virtual machine, so nothing was executed. Configure the connection in Infrastructure, or request a simulation instead.";
    axios.post.mockRejectedValue({ response: { data: { detail } } });

    await render();
    await click(`start-vm-${STOPPED_VM.id}`);

    expect(axios.post).toHaveBeenCalledWith(
      `${BASE}/proxmox/vms/${STOPPED_VM.id}/action`,
      { action: "start" },
      expect.any(Object),
    );
    expect(toast.error).toHaveBeenCalledWith(detail);
    expect(toast.success).not.toHaveBeenCalled();
  });

  test("reports a simulation as a simulation, never as an execution", async () => {
    seedGet({ vms: [STOPPED_VM] });
    axios.post.mockResolvedValue({
      data: {
        status: "simulated",
        executed: false,
        message: "Simulation only — Nexus did not call Proxmox and nothing was changed.",
      },
    });

    await render();
    await click(`start-vm-${STOPPED_VM.id}`);

    expect(toast.info).toHaveBeenCalledWith("Simulation only — Nexus did not call Proxmox and nothing was changed.");
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  test("tells the operator a destructive action is awaiting approval", async () => {
    seedGet({ vms: [RUNNING_VM] });
    axios.post.mockResolvedValue({
      data: {
        status: "pending_approval",
        executed: false,
        message: "'stop' is destructive, so it is awaiting independent admin approval. Nothing has been executed.",
      },
    });

    await render();
    await click(`stop-vm-${RUNNING_VM.id}`);

    expect(toast.warning).toHaveBeenCalledWith("'stop' is destructive, so it is awaiting independent admin approval. Nothing has been executed.");
    expect(toast.success).not.toHaveBeenCalled();
  });

  test("shows a verified outcome as verified", async () => {
    seedGet({ vms: [STOPPED_VM] });
    axios.post.mockResolvedValue({
      data: {
        status: "completed",
        executed: true,
        verified: true,
        message: "Proxmox confirmed 'start'; outcome verified.",
      },
    });

    await render();
    await click(`start-vm-${STOPPED_VM.id}`);

    expect(toast.success).toHaveBeenCalledWith("Proxmox confirmed 'start'; outcome verified.");
    expect(toast.error).not.toHaveBeenCalled();
  });

  test("observes the configured connection and reports what Proxmox reported", async () => {
    seedGet({
      connection: {
        configured: true,
        mode: "execute",
        connections: [{ server_id: "pve-1", name: "Acme PVE", configured: true, health: "ok" }],
      },
    });
    axios.post.mockResolvedValue({ data: { observed: 2, created: 2, updated: 0, removed: 0 } });

    await render();
    await click("sync-inventory-btn");

    expect(axios.post).toHaveBeenCalledWith(`${BASE}/proxmox/servers/pve-1/sync`, {}, expect.any(Object));
    expect(toast.success).toHaveBeenCalledWith("Proxmox reported 2 guests across 1 connection.");
    expect(toast.error).not.toHaveBeenCalled();
  });

  test("says there is no cluster to observe instead of pretending to sync", async () => {
    seedGet();

    await render();
    await click("sync-inventory-btn");

    expect(axios.post).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith(
      "No Proxmox connection is configured, so there is no cluster to observe. Add one in Infrastructure, then sync.",
    );
  });

  test("states a connection that could not be observed rather than claiming an inventory", async () => {
    seedGet({
      connection: {
        configured: true,
        mode: "execute",
        connections: [{ server_id: "pve-1", name: "Acme PVE", configured: true, health: "unreachable" }],
      },
    });
    axios.post.mockRejectedValue({ response: { data: { detail: "Nexus could not reach the Proxmox API; no change was made." } } });

    await render();
    await click("sync-inventory-btn");

    expect(toast.error).toHaveBeenCalledWith("Nexus could not reach the Proxmox API; no change was made.");
    expect(toast.success).not.toHaveBeenCalled();
  });

  const CONFIGURED = {
    configured: true,
    mode: "execute",
    connections: [{ server_id: "pve-1", name: "Acme PVE", configured: true, health: "ok" }],
  };

  test("states that the inventory reconciles itself instead of implying a manual-only sync", async () => {
    seedGet({
      connection: {
        ...CONFIGURED,
        reconciliation: { enabled: true, interval_minutes: 30, last_run_at: "2026-10-12T02:00:00+00:00" },
      },
      vms: [STOPPED_VM],
    });

    await render();

    const note = host.querySelector('[data-testid="proxmox-reconciliation-note"]');
    expect(note).not.toBeNull();
    expect(note.textContent).toContain("reconciles this inventory from Proxmox itself every 30 minutes");
    expect(note.textContent).toContain("without pressing sync");
    expect(note.textContent).toContain("Last automatic pass 2026-10-12 02:00 UTC");
    // It reports the schedule; it does not attempt an observation.
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("states an hourly-or-longer schedule in hours", async () => {
    seedGet({
      connection: {
        ...CONFIGURED,
        reconciliation: { enabled: true, interval_minutes: 120, last_run_at: null },
      },
    });

    await render();

    const note = host.querySelector('[data-testid="proxmox-reconciliation-note"]');
    expect(note.textContent).toContain("every 2 hours");
    expect(note.textContent).not.toContain("Last automatic pass");
  });

  test("says automatic reconciliation is switched off rather than implying it runs", async () => {
    seedGet({
      connection: {
        ...CONFIGURED,
        reconciliation: { enabled: false, interval_minutes: 30, last_run_at: null },
      },
    });

    await render();

    const note = host.querySelector('[data-testid="proxmox-reconciliation-note"]');
    expect(note.textContent).toContain("Automatic reconciliation is switched off");
    expect(note.textContent).not.toContain("without pressing sync");
  });

  test("claims no schedule at all when the server did not report one", async () => {
    seedGet({ connection: CONFIGURED });

    await render();

    expect(host.querySelector('[data-testid="proxmox-reconciliation-note"]')).toBeNull();
    expect(host.textContent).not.toContain("reconciles this inventory");
  });

  test("never claims a backup is off for a guest the provider did not describe", async () => {
    seedGet({ vms: [{ ...STOPPED_VM, backup_enabled: undefined, backup_schedule: undefined }] });

    await render();

    expect(host.textContent).toContain("unknown");
    expect(host.textContent).not.toContain("off");
  });
});
