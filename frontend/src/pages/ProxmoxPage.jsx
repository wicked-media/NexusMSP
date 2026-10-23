import { useState, useEffect, useCallback, useMemo } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Server, Play, Square, RotateCcw, Power, RefreshCw, CheckCircle, XCircle, Archive, Calendar, Loader2, ShieldAlert, Boxes, Container, Activity, CircleAlert, CircleCheck, Database, Clock3, Network, Search, SlidersHorizontal } from "lucide-react";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import WorkspaceActionMenu, { WorkspaceActionMenuItem } from "@/components/WorkspaceActionMenu";
import { apiErrorMessage } from "@/lib/apiErrorMessage";

/** A cadence an operator can read, or null when the server did not report one. */
function intervalLabel(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value % 60 === 0) return `${value / 60} hour${value === 60 ? "" : "s"}`;
  return `${value} minute${value === 1 ? "" : "s"}`;
}

/**
 * What this studio may claim about automatic reconciliation — nothing more.
 *
 * The server reconciles the guest inventory from Proxmox itself on a schedule,
 * so the schedule and the last pass are the honest statement. When the schedule
 * is switched off (or was never reported) the studio says so instead of letting
 * a manual Sync inventory imply the inventory keeps itself current.
 */
function reconciliationStatement(reconciliation) {
  if (!reconciliation || typeof reconciliation !== "object") return null;
  if (!reconciliation.enabled) {
    return (
      "Automatic reconciliation is switched off for this platform, so this inventory "
      + "only changes when an operator runs Sync inventory."
    );
  }
  const interval = intervalLabel(reconciliation.interval_minutes);
  const lastPass = reconciliation.last_run_at
    ? `${String(reconciliation.last_run_at).substring(0, 16).replace("T", " ")} UTC`
    : null;
  return `Nexus reconciles this inventory from Proxmox itself${interval ? ` every ${interval}` : ""}, so it stays current without pressing sync.`
    + (lastPass ? ` Last automatic pass ${lastPass}.` : "");
}

export default function ProxmoxPage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [nodes, setNodes] = useState([]);
  const [vms, setVms] = useState([]);
  const [backups, setBackups] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [connection, setConnection] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);
  const [backupDialog, setBackupDialog] = useState(false);
  const [backupForm, setBackupForm] = useState({ vm_id: "", vm_name: "", type: "full", storage: "local-zfs", retention_days: 30 });
  const [scheduleDialog, setScheduleDialog] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({ name: "", schedule: "0 2 * * *", type: "full", storage: "local-zfs", retention_days: 30, vms: [] });
  const [guestQuery, setGuestQuery] = useState("");
  const [guestState, setGuestState] = useState("all");
  const [guestType, setGuestType] = useState("all");
  const [guestSort, setGuestSort] = useState("name");

  const fetchData = useCallback(async () => {
    try {
      const [cRes, nRes, vRes, bRes, sRes] = await Promise.all([
        axios.get(`${API}/proxmox/connection`, { headers }),
        axios.get(`${API}/proxmox/nodes`, { headers }),
        axios.get(`${API}/proxmox/vms`, { headers }),
        axios.get(`${API}/proxmox/backups`, { headers }),
        axios.get(`${API}/proxmox/backup-schedules`, { headers }),
      ]);
      setConnection(cRes.data); setNodes(nRes.data); setVms(vRes.data); setBackups(bRes.data); setSchedules(sRes.data);
    } catch { toast.error("Failed to load Proxmox data"); }
    finally { /* retain the existing data while a refresh is in flight */ }
  }, [headers]);
  useEffect(() => { fetchData(); }, [fetchData]);

  const handleVmAction = async (vmId, action) => {
    setActionLoading(`${vmId}-${action}`);
    try {
      // The backend reports what actually happened: verified, simulated,
      // awaiting approval, unverified or blocked. Never claim more than that.
      const res = await axios.post(`${API}/proxmox/vms/${vmId}/action`, { action }, { headers });
      const { status, message } = res.data || {};
      if (status === "simulated") toast.info(message || `Simulated ${action} — Nexus did not call Proxmox; nothing changed.`);
      else if (status === "pending_approval") toast.warning(message || `${action} is awaiting admin approval. Nothing has been executed.`);
      else if (status === "completed_unverified") toast.warning(message || `${action} completed, but the observed state did not match — review the evidence.`);
      else toast.success(message || `VM ${action} verified`);
      fetchData();
    } catch (err) {
      // A refused or failed attempt is still recorded server-side; show why.
      toast.error(apiErrorMessage(err, `Could not ${action} VM. Nothing was changed.`));
      fetchData();
    }
    finally { setActionLoading(null); }
  };

  const handleCreateBackup = async () => {
    try { await axios.post(`${API}/proxmox/backups`, backupForm, { headers }); toast.success("Backup started"); setBackupDialog(false); fetchData(); } catch { toast.error("Failed"); }
  };

  const handleCreateSchedule = async () => {
    try { await axios.post(`${API}/proxmox/backup-schedules`, scheduleForm, { headers }); toast.success("Schedule created"); setScheduleDialog(false); fetchData(); } catch { toast.error("Failed"); }
  };

  // Observation is an explicit operator action, never a silent write: the studio
  // reports how many guests Proxmox actually reported for each connection, and
  // says plainly when a connection could not be observed at all.
  const handleSyncInventory = async () => {
    const targets = (connection?.connections || []).filter(entry => entry.configured);
    if (targets.length === 0) {
      toast.info("No Proxmox connection is configured, so there is no cluster to observe. Add one in Infrastructure, then sync.");
      return;
    }
    setSyncing(true);
    const observed = [];
    const failures = [];
    try {
      for (const target of targets) {
        try {
          const res = await axios.post(`${API}/proxmox/servers/${target.server_id}/sync`, {}, { headers });
          observed.push(res.data || {});
        } catch (err) {
          failures.push(apiErrorMessage(err, `${target.name || target.server_id} could not be observed. Nothing was stored.`));
        }
      }
      fetchData();
      const guestCount = observed.reduce((total, row) => total + (row.observed || 0), 0);
      const removed = observed.reduce((total, row) => total + (row.removed || 0), 0);
      const summary = `Proxmox reported ${guestCount} guest${guestCount === 1 ? "" : "s"} across ${observed.length} connection${observed.length === 1 ? "" : "s"}.`
        + (removed ? ` ${removed} stored guest${removed === 1 ? "" : "s"} were no longer reported and left the inventory.` : "");
      if (failures.length === 0) toast.success(summary);
      else if (observed.length === 0) toast.error(failures[0]);
      else toast.warning(`${summary} ${failures.length} connection${failures.length === 1 ? "" : "s"} could not be observed: ${failures[0]}`);
    } finally {
      setSyncing(false);
    }
  };

  const reconciliation = reconciliationStatement(connection?.reconciliation);

  const statusColor = { running: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20", stopped: "bg-red-500/10 text-red-500 border-red-500/20", suspended: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20" };
  const configuredConnections = (connection?.connections || []).filter(item => item.configured);
  const onlineNodes = nodes.filter(node => node.status === "online");
  const runningGuests = vms.filter(vm => vm.status === "running");
  const containers = vms.filter(vm => ["lxc", "container"].includes(String(vm.type || "").toLowerCase()));
  const activeAlerts = (connection?.connections || []).filter(item => item.configured && item.health !== "ok");
  const average = (items, field) => {
    const values = items.map(item => Number(item[field])).filter(Number.isFinite);
    return values.length ? Math.round(values.reduce((total, value) => total + value, 0) / values.length) : null;
  };
  const latestObservation = nodes.map(node => node.observed_at).filter(Boolean).sort().at(-1) || null;
  const overviewCards = [
    { label: "Connections", value: configuredConnections.length, detail: configuredConnections.length ? `${configuredConnections.length} provider connection${configuredConnections.length === 1 ? "" : "s"} scoped to your estate` : "No provider connection", icon: Boxes, tone: "cyan" },
    { label: "Nodes", value: nodes.length, detail: nodes.length ? `${onlineNodes.length} online · ${nodes.length - onlineNodes.length} unavailable` : "No node observation", icon: Server, tone: onlineNodes.length === nodes.length && nodes.length ? "emerald" : "amber" },
    { label: "Virtual machines", value: vms.length - containers.length, detail: vms.length ? `${runningGuests.filter(vm => !["lxc", "container"].includes(String(vm.type || "").toLowerCase())).length} running` : "No guest inventory", icon: Activity, tone: "violet" },
    { label: "Containers", value: containers.length, detail: containers.length ? `${containers.filter(item => item.status === "running").length} running` : "No LXC inventory", icon: Container, tone: "cyan" },
    { label: "Average CPU", value: average(nodes, "cpu_usage") === null ? "—" : `${average(nodes, "cpu_usage")}%`, detail: nodes.length ? "Across observed nodes" : "Requires node telemetry", icon: Activity, tone: "emerald" },
    { label: "Average memory", value: average(nodes, "memory_usage") === null ? "—" : `${average(nodes, "memory_usage")}%`, detail: nodes.length ? "Across observed nodes" : "Requires node telemetry", icon: Database, tone: "amber" },
    { label: "Connection health", value: activeAlerts.length ? `${activeAlerts.length} issue${activeAlerts.length === 1 ? "" : "s"}` : configuredConnections.length ? "Healthy" : "—", detail: activeAlerts.length ? "Provider health needs attention" : configuredConnections.length ? "All configured connections answered" : "No connection to assess", icon: activeAlerts.length ? CircleAlert : CircleCheck, tone: activeAlerts.length ? "rose" : "emerald" },
    { label: "Last provider observation", value: latestObservation ? "Current" : "—", detail: latestObservation ? new Date(latestObservation).toLocaleString() : "No provider observation received", icon: Clock3, tone: latestObservation ? "cyan" : "muted" },
  ];
  const visibleGuests = vms
    .filter(vm => {
      const type = String(vm.type || "").toLowerCase();
      const matchesQuery = !guestQuery.trim() || [vm.name, vm.vmid, vm.node_name, vm.client_name, vm.ip_address]
        .some(value => String(value || "").toLowerCase().includes(guestQuery.trim().toLowerCase()));
      return matchesQuery && (guestState === "all" || vm.status === guestState) && (guestType === "all" || type === guestType);
    })
    .sort((left, right) => {
      if (guestSort === "cpu") return Number(right.cpu_usage || 0) - Number(left.cpu_usage || 0);
      if (guestSort === "memory") return Number(right.memory_usage || 0) - Number(left.memory_usage || 0);
      if (guestSort === "state") return String(left.status || "").localeCompare(String(right.status || ""));
      return String(left.name || "").localeCompare(String(right.name || ""));
    });

  return (
    <div className="space-y-6">
      <OperationalPageHeader eyebrow="Infrastructure operations · virtual estate" title="Proxmox" description="Manage virtual machines, protected backup jobs and scheduled infrastructure work." icon={Server} tone="cyan" signal={nodes.some(node => node.status === "warning") ? "attention" : nodes.length ? "ready" : undefined} actions={<>
          <Button variant="outline" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
          <Button variant="outline" onClick={() => setScheduleDialog(true)} disabled={!vms.length} data-testid="create-schedule-btn"><Calendar className="w-4 h-4 mr-1" />Schedule</Button>
          <Button onClick={() => setBackupDialog(true)} disabled={!vms.length} data-testid="create-backup-btn"><Archive className="w-4 h-4 mr-1" />New backup</Button>
          <WorkspaceActionMenu label="More" testId="proxmox-more-menu">
            <WorkspaceActionMenuItem icon={RefreshCw} onSelect={handleSyncInventory} disabled={syncing} testId="sync-inventory-btn">
              {syncing ? "Syncing inventory..." : "Sync inventory"}
            </WorkspaceActionMenuItem>
          </WorkspaceActionMenu>
        </>} />

      {connection?.configured && reconciliation && (
        <p className="text-xs text-muted-foreground -mt-3" data-testid="proxmox-reconciliation-note">{reconciliation}</p>
      )}

      {connection && !connection.configured && (
        <Card data-testid="proxmox-unconfigured-banner" className="border-dashed border-cyan-500/35 bg-cyan-500/[0.035]">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-4">
            <div className="flex max-w-3xl items-start gap-3">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
              <div>
                <p className="font-medium text-sm">No Proxmox connection configured</p>
                <p className="mt-1 text-xs text-muted-foreground">This studio is empty rather than demo data. Add a scoped, token-authenticated connection; Nexus will validate it server-side, observe real nodes and guests, and keep credentials out of the browser.</p>
              </div>
            </div>
            <a href="/infrastructure" className="inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-cyan-500/35 px-3 text-sm font-medium text-cyan-300 transition-colors hover:bg-cyan-500/10"><Network className="mr-2 h-4 w-4" />Configure connection</a>
          </CardContent>
        </Card>
      )}

      {connection?.connections?.some(c => c.configured && c.health !== "ok") && (
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="pt-4 flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-yellow-500 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-sm">A configured connection is not answering</p>
              <ul className="text-xs text-muted-foreground mt-1 space-y-1">
                {connection.connections.filter(c => c.configured && c.health !== "ok").map(c => (
                  <li key={c.server_id}>{c.name || c.host}: {c.error || `health: ${c.health}`}</li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      <section aria-label="Proxmox infrastructure overview" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="proxmox-overview-cards">
        {overviewCards.map(card => {
          const Icon = card.icon;
          const tone = card.tone === "rose" ? "text-rose-300 border-rose-500/25 bg-rose-500/[0.04]" : card.tone === "amber" ? "text-amber-300 border-amber-500/25 bg-amber-500/[0.04]" : card.tone === "emerald" ? "text-emerald-300 border-emerald-500/25 bg-emerald-500/[0.04]" : card.tone === "muted" ? "text-muted-foreground border-border/60 bg-muted/20" : "text-cyan-300 border-cyan-500/25 bg-cyan-500/[0.04]";
          return <Card key={card.label} className={`border ${tone}`}><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{card.label}</p><p className="mt-2 text-2xl font-semibold tracking-tight">{card.value}</p></div><Icon className="h-5 w-5" /></div><p className="mt-2 min-h-8 text-xs leading-4 text-muted-foreground">{card.detail}</p></CardContent></Card>;
        })}
      </section>

      {nodes.length > 0 && <section aria-label="Observed Proxmox nodes" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2"><div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-300">Node telemetry</p><h2 className="mt-1 text-base font-semibold">Provider-observed node health</h2></div><p className="text-xs text-muted-foreground">Observed server-side · {latestObservation ? new Date(latestObservation).toLocaleString() : "timestamp unavailable"}</p></div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {nodes.map(n => (
          <Card key={n.id} className={n.status !== "online" ? "border-amber-500/30" : "border-border/60"}><CardContent className="pt-4">
            <div className="flex items-center justify-between mb-3"><div className="flex items-center gap-2"><Server className="w-5 h-5 text-blue-500" /><span className="font-semibold">{n.name}</span></div><Badge className={n.status === "online" ? "bg-emerald-500/10 text-emerald-500" : "bg-yellow-500/10 text-yellow-500"}>{n.status}</Badge></div>
            <div className="grid grid-cols-3 gap-2 text-sm"><div><p className="text-[10px] text-muted-foreground">CPU</p><p className="font-medium">{Number.isFinite(Number(n.cpu_usage)) ? `${Math.round(Number(n.cpu_usage))}%` : "—"}</p></div><div><p className="text-[10px] text-muted-foreground">RAM</p><p className="font-medium">{Number.isFinite(Number(n.memory_usage)) ? `${Math.round(Number(n.memory_usage))}%` : "—"}</p></div><div><p className="text-[10px] text-muted-foreground">Disk</p><p className="font-medium">{Number.isFinite(Number(n.disk_usage)) ? `${Math.round(Number(n.disk_usage))}%` : "—"}</p></div></div>
            <p className="text-xs text-muted-foreground mt-2">{n.vm_count} VMs | {n.ip}</p>
          </CardContent></Card>
        ))}
      </div></section>}

      <Tabs defaultValue="vms">
        <TabsList><TabsTrigger value="vms">Virtual Machines ({vms.length})</TabsTrigger><TabsTrigger value="backups">Backups ({backups.length})</TabsTrigger><TabsTrigger value="schedules">Schedules ({schedules.length})</TabsTrigger></TabsList>

        <TabsContent value="vms">
          <div className="mb-3 flex flex-col gap-2 rounded-xl border border-border/60 bg-card/40 p-3 lg:flex-row lg:items-center lg:justify-between" data-testid="proxmox-guest-controls">
            <div className="relative min-w-0 flex-1 lg:max-w-md"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={guestQuery} onChange={event => setGuestQuery(event.target.value)} className="pl-9" placeholder="Search name, VMID, node, client or IP" aria-label="Search Proxmox guests" /></div>
            <div className="flex flex-wrap gap-2"><Select value={guestState} onValueChange={setGuestState}><SelectTrigger className="w-[132px]"><SlidersHorizontal className="mr-2 h-3.5 w-3.5" /><SelectValue placeholder="State" /></SelectTrigger><SelectContent><SelectItem value="all">All states</SelectItem><SelectItem value="running">Running</SelectItem><SelectItem value="stopped">Stopped</SelectItem><SelectItem value="suspended">Suspended</SelectItem></SelectContent></Select><Select value={guestType} onValueChange={setGuestType}><SelectTrigger className="w-[132px]"><SelectValue placeholder="Type" /></SelectTrigger><SelectContent><SelectItem value="all">All types</SelectItem><SelectItem value="qemu">Virtual machines</SelectItem><SelectItem value="lxc">Containers</SelectItem></SelectContent></Select><Select value={guestSort} onValueChange={setGuestSort}><SelectTrigger className="w-[150px]"><SelectValue placeholder="Sort" /></SelectTrigger><SelectContent><SelectItem value="name">Sort: name</SelectItem><SelectItem value="state">Sort: state</SelectItem><SelectItem value="cpu">Sort: CPU use</SelectItem><SelectItem value="memory">Sort: memory use</SelectItem></SelectContent></Select></div>
          </div>
          <Table>
            <TableHeader><TableRow><TableHead>VM</TableHead><TableHead>Node</TableHead><TableHead>Client</TableHead><TableHead>OS</TableHead><TableHead>vCPU</TableHead><TableHead>RAM</TableHead><TableHead>IP</TableHead><TableHead>Backup</TableHead><TableHead className="w-[200px]">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {visibleGuests.map(vm => (
                <TableRow key={vm.id} data-testid={`vm-row-${vm.id}`}>
                  <TableCell><div className="flex items-center gap-2"><div className={`w-2 h-2 rounded-full ${vm.status === "running" ? "bg-emerald-500" : vm.status === "stopped" ? "bg-red-500" : "bg-yellow-500"}`} /><div><p className="font-medium">{vm.name}</p><p className="text-[10px] text-muted-foreground">ID: {vm.vmid} | {vm.type?.toUpperCase()}</p></div><Badge className={statusColor[vm.status] + " text-[9px]"}>{vm.status}</Badge></div></TableCell>
                  <TableCell className="text-xs">{vm.node_name}</TableCell>
                  <TableCell className="text-sm">{vm.client_name}</TableCell>
                  <TableCell className="text-xs">{vm.os}</TableCell>
                  <TableCell>{vm.vcpu}</TableCell>
                  <TableCell>{vm.ram_gb}GB</TableCell>
                  <TableCell className="text-xs font-mono">{vm.ip_address}</TableCell>
                  {/* A guest Proxmox has not told Nexus anything about is 'unknown', never 'off'. */}
                  <TableCell>{vm.backup_enabled === true ? <Badge className="bg-emerald-500/10 text-emerald-500 text-[9px]">{vm.backup_schedule}</Badge> : vm.backup_enabled === false ? <Badge className="bg-red-500/10 text-red-500 text-[9px]">off</Badge> : <Badge variant="outline" className="text-[9px] text-muted-foreground">unknown</Badge>}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {vm.status !== "running" && <Button size="sm" className="h-7 bg-emerald-600 hover:bg-emerald-700 text-[11px] px-2.5 gap-1" onClick={() => handleVmAction(vm.id, "start")} disabled={!!actionLoading} data-testid={`start-vm-${vm.id}`}>{actionLoading === `${vm.id}-start` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}Start</Button>}
                      {vm.status === "running" && <>
                        <Button size="sm" variant="outline" className="h-7 text-[11px] px-2 text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/10 gap-1" onClick={() => handleVmAction(vm.id, "reboot")} disabled={!!actionLoading} data-testid={`reboot-vm-${vm.id}`}><RotateCcw className="w-3 h-3" />Reboot</Button>
                        <Button size="sm" variant="outline" className="h-7 text-[11px] px-2 text-blue-400 border-blue-500/30 hover:bg-blue-500/10 gap-1" onClick={() => handleVmAction(vm.id, "shutdown")} disabled={!!actionLoading} data-testid={`shutdown-vm-${vm.id}`}><Power className="w-3 h-3" />Shutdown</Button>
                        <Button size="sm" variant="outline" className="h-7 text-[11px] px-2 text-red-400 border-red-500/30 hover:bg-red-500/10 gap-1" onClick={() => handleVmAction(vm.id, "stop")} disabled={!!actionLoading} data-testid={`stop-vm-${vm.id}`}><Square className="w-3 h-3" />Stop</Button>
                      </>}
                      <Button size="sm" variant="outline" className="h-7 text-[11px] px-2 gap-1" onClick={() => { setBackupForm({ vm_id: vm.id, vm_name: vm.name, type: "full", storage: "local-zfs", retention_days: 30 }); setBackupDialog(true); }} data-testid={`backup-vm-${vm.id}`}><Archive className="w-3 h-3" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {visibleGuests.length === 0 && <TableRow><TableCell colSpan={9} className="py-12 text-center"><p className="font-medium">{vms.length ? "No guests match these filters" : "No Proxmox guests observed yet"}</p><p className="mt-1 text-xs text-muted-foreground">{vms.length ? "Adjust the search or filters to widen the result set." : "Configure a connection, then sync inventory to populate this scoped list."}</p></TableCell></TableRow>}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="backups">
          <Table>
            <TableHeader><TableRow><TableHead>VM</TableHead><TableHead>Type</TableHead><TableHead>Size</TableHead><TableHead>Duration</TableHead><TableHead>Storage</TableHead><TableHead>Status</TableHead><TableHead>Verified</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
            <TableBody>
              {backups.map(b => (
                <TableRow key={b.id}><TableCell className="font-medium">{b.vm_name}</TableCell><TableCell><Badge variant="outline" className="text-[10px] capitalize">{b.type}</Badge></TableCell><TableCell>{b.size_gb} GB</TableCell><TableCell>{b.duration_minutes}m</TableCell><TableCell className="text-xs font-mono">{b.storage}</TableCell>                <TableCell><Badge className={b.status === "completed" ? "bg-emerald-500/10 text-emerald-500" : (b.status === "running" || b.status === "requested") ? "bg-blue-500/10 text-blue-500" : "bg-red-500/10 text-red-500"}>{b.status}</Badge></TableCell><TableCell>{b.verified ? <CheckCircle className="w-4 h-4 text-emerald-500" /> : <XCircle className="w-4 h-4 text-muted-foreground" />}</TableCell><TableCell className="text-xs">{b.created_at?.substring(0, 16).replace("T", " ")}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="schedules">
          <div className="space-y-3">
            {schedules.map(s => (
              <Card key={s.id}><CardContent className="pt-4 flex items-center justify-between"><div><div className="flex items-center gap-2"><span className="font-medium">{s.name}</span><Badge variant="outline" className={s.enabled ? "text-emerald-500" : "text-muted-foreground"}>{s.enabled ? "Active" : "Disabled"}</Badge><Badge variant="outline" className="text-[10px] capitalize">{s.type}</Badge></div><p className="text-xs text-muted-foreground mt-1">Cron: {s.schedule} | Storage: {s.storage} | Retention: {s.retention_days}d | {s.vms?.length || 0} VMs</p></div>{s.last_run && <span className="text-xs text-muted-foreground">Last: {s.last_run.substring(0, 16).replace("T", " ")}</span>}</CardContent></Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={backupDialog} onOpenChange={setBackupDialog}>
        <DialogContent><DialogHeader><DialogTitle>Create Backup</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>VM</Label><Select value={backupForm.vm_id} onValueChange={v => { const vm = vms.find(x => x.id === v); setBackupForm({ ...backupForm, vm_id: v, vm_name: vm?.name || "" }); }}><SelectTrigger data-testid="backup-vm-select"><SelectValue placeholder="Select VM" /></SelectTrigger><SelectContent>{vms.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent></Select>
              {vms.length === 0 ? <p className="text-xs text-muted-foreground mt-1">No Proxmox guest has been observed yet, so there is nothing to back up. Sync a connection inventory first.</p> : null}</div>
            <div className="grid grid-cols-2 gap-3"><div><Label>Type</Label><Select value={backupForm.type} onValueChange={v => setBackupForm({ ...backupForm, type: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="full">Full</SelectItem><SelectItem value="incremental">Incremental</SelectItem><SelectItem value="differential">Differential</SelectItem></SelectContent></Select></div><div><Label>Retention (days)</Label><Input type="number" value={backupForm.retention_days} onChange={e => setBackupForm({ ...backupForm, retention_days: parseInt(e.target.value) || 30 })} /></div></div>
          </div>
          <DialogFooter><Button onClick={handleCreateBackup} disabled={!backupForm.vm_id} data-testid="submit-backup-btn"><Archive className="w-4 h-4 mr-1" />Create Backup</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={scheduleDialog} onOpenChange={setScheduleDialog}>
        <DialogContent><DialogHeader><DialogTitle>Create Backup Schedule</DialogTitle></DialogHeader>
          <div className="space-y-3"><div><Label>Name</Label><Input value={scheduleForm.name} onChange={e => setScheduleForm({ ...scheduleForm, name: e.target.value })} /></div><div className="grid grid-cols-2 gap-3"><div><Label>Cron</Label><Input value={scheduleForm.schedule} onChange={e => setScheduleForm({ ...scheduleForm, schedule: e.target.value })} placeholder="0 2 * * *" /></div><div><Label>Type</Label><Select value={scheduleForm.type} onValueChange={v => setScheduleForm({ ...scheduleForm, type: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="full">Full</SelectItem><SelectItem value="incremental">Incremental</SelectItem></SelectContent></Select></div></div></div>
          <DialogFooter><Button onClick={handleCreateSchedule}><Calendar className="w-4 h-4 mr-1" />Create</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
