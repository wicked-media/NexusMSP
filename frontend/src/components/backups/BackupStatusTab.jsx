import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { API } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, Play, RefreshCw, Wifi, WifiOff, Search, FilterX, HardDrive } from "lucide-react";
import { toast } from "sonner";

export default function BackupStatusTab({ token, onDataChange }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [runningId, setRunningId] = useState(null);
  const [bulkRunTarget, setBulkRunTarget] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const r = await axios.get(`${API}/acronis/backup-statuses`, { headers: { Authorization: `Bearer ${token}` } });
      setData(r.data);
      onDataChange?.(r.data);
    } catch (error) {
      const message = error.response?.data?.detail || "Nexus could not load the Acronis backup-status feed.";
      setLoadError(message);
      toast.error(message);
    }
    finally { setLoading(false); }
  }, [onDataChange, token]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { setPage(1); }, [search, statusFilter]);

  const normalizedSearch = search.trim().toLowerCase();
  const matchesSearch = (machine) => !normalizedSearch || [
    machine.machine_name,
    machine.tenant_name,
    machine.plan_names,
    machine.backup_health,
  ].some((value) => String(value || "").toLowerCase().includes(normalizedSearch));
  const machines = (data?.machines || [])
    .filter((machine) => statusFilter === "all" || machine.backup_health === statusFilter)
    .filter(matchesSearch);
  const eligibleBulkMachines = machines.filter((machine) => machine.agent_online === true && (machine.backup_application_ids?.length || 0) > 0);

  const handleRun = async (m) => {
    if (!m.resource_id && !(m.backup_application_ids?.length)) {
      toast.error("Missing resource/application IDs");
      return;
    }
    setRunningId(m.resource_id);
    try {
      const payload = m.backup_application_ids?.length
        ? { application_ids: m.backup_application_ids, resource_id: m.resource_id }
        : { resource_id: m.resource_id };
      const res = await axios.post(`${API}/acronis/backup/run`, payload, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(res.data?.message || `Backup triggered for ${m.machine_name}`);
      setTimeout(fetchData, 2500);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to trigger backup");
    } finally {
      setRunningId(null);
    }
  };

  const handleBulkRun = async (confirmed = false) => {
    if (!eligibleBulkMachines.length) {
      toast.error("No eligible machines (must be online with applied backup plans)");
      return;
    }
    if (!confirmed) {
      setBulkRunTarget({ count: eligibleBulkMachines.length, planCount: new Set(eligibleBulkMachines.flatMap((machine) => machine.backup_application_ids || [])).size });
      return;
    }
    setRunningId("__bulk__");
    const allAppIds = [...new Set(eligibleBulkMachines.flatMap(m => m.backup_application_ids || []))];
    try {
      const res = await axios.post(`${API}/acronis/backup/run`, { application_ids: allAppIds }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(res.data?.message || `Bulk backup triggered for ${eligibleBulkMachines.length} machines`);
      setBulkRunTarget(null);
      setTimeout(fetchData, 3000);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Bulk backup failed");
    } finally {
      setRunningId(null);
    }
  };

  if (loading && !data) {
    return <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground" role="status"><Loader2 className="h-5 w-5 animate-spin" />Loading backup agent status…</div>;
  }

  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(machines.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const pagedMachines = machines.slice(startIndex, startIndex + pageSize);
  const rangeStart = machines.length ? startIndex + 1 : 0;
  const rangeEnd = Math.min(startIndex + pageSize, machines.length);

  return (
    <div className="space-y-3" data-testid="bcc-status-tab">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-[200px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search machine, tenant, plan or status..." value={search} onChange={e => setSearch(e.target.value)} data-testid="status-search" aria-label="Search backup status records" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]" data-testid="status-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status ({data?.total_machines || 0})</SelectItem>
            <SelectItem value="ok">Healthy ({data?.healthy || 0})</SelectItem>
            <SelectItem value="failed">Failed ({data?.failed || 0})</SelectItem>
            <SelectItem value="warning">Warning ({data?.warning || 0})</SelectItem>
          </SelectContent>
        </Select>
        {(statusFilter === "failed" || statusFilter === "warning") && (
          <Button
            size="sm"
            className="bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30"
            disabled={runningId === "__bulk__" || eligibleBulkMachines.length === 0}
            onClick={handleBulkRun}
            data-testid="bulk-run-backup"
            title={eligibleBulkMachines.length ? "Queue backups for eligible machines in the visible filtered result" : "No visible machines are both online and assigned a backup plan"}
          >
            {runningId === "__bulk__" ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Play className="w-3.5 h-3.5 mr-1" />}
            Queue eligible ({eligibleBulkMachines.length})
          </Button>
        )}
        {statusFilter !== "all" && (
          <Button size="sm" variant="ghost" onClick={() => setStatusFilter("all")}>
            <FilterX className="w-3.5 h-3.5 mr-1" />Clear
          </Button>
        )}
      </div>

      {loadError && <Card className="border-amber-400/25 bg-amber-500/[0.045]" data-testid="backup-status-feed-warning"><CardContent className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-2.5"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" /><div><p className="text-sm font-semibold text-amber-100">Backup status feed needs attention</p><p className="mt-0.5 text-xs text-muted-foreground">{data ? "Showing the last successfully loaded result. " : "No status result is available yet. "}{loadError}</p></div></div><Button size="sm" variant="outline" className="w-fit border-amber-400/25 text-amber-100 hover:bg-amber-500/10" onClick={fetchData}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Retry feed</Button></CardContent></Card>}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Machine</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Applied Plans</TableHead>
                  <TableHead>Last Backup</TableHead>
                  <TableHead>Last Success</TableHead>
                  <TableHead>Next Backup</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedMachines.map((m, i) => (
                  <TableRow key={m.resource_id || startIndex + i} data-testid={`machine-${m.resource_id}`}>
                    <TableCell className="font-medium text-sm">{m.machine_name}</TableCell>
                    <TableCell className="text-sm">{m.tenant_name}</TableCell>
                    <TableCell>
                      {m.agent_online === true ? (
                        <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30 border text-[10px] gap-1">
                          <Wifi className="w-3 h-3" />Online
                        </Badge>
                      ) : m.agent_online === false ? (
                        <Badge className="bg-rose-500/15 text-rose-300 border-rose-500/30 border text-[10px] gap-1">
                          <WifiOff className="w-3 h-3" />Offline
                        </Badge>
                      ) : <Badge variant="outline" className="text-[10px]">—</Badge>}
                    </TableCell>
                    <TableCell>
                      <Badge className={`text-[10px] capitalize ${
                        m.backup_health === "ok" ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" :
                        m.backup_health === "failed" ? "bg-rose-500/15 text-rose-300 border-rose-500/30" :
                        m.backup_health === "warning" ? "bg-amber-500/15 text-amber-300 border-amber-500/30" :
                        "bg-muted/30 text-muted-foreground"
                      }`}>
                        {m.backup_health}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs max-w-[200px] truncate" title={m.plan_names}>{m.plan_names || "No plans"}</TableCell>
                    <TableCell className="text-[11px] text-muted-foreground">{m.last_backup ? m.last_backup.slice(0, 16).replace("T", " ") : "Never"}</TableCell>
                    <TableCell className="text-[11px] text-muted-foreground">{m.last_success ? m.last_success.slice(0, 16).replace("T", " ") : "Never"}</TableCell>
                    <TableCell className="text-[11px] text-muted-foreground">{m.next_backup ? m.next_backup.slice(0, 16).replace("T", " ") : "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm" variant="outline" className="h-7 px-2 text-[11px]"
                        disabled={runningId === m.resource_id || m.policy_count === 0 || m.agent_online === false}
                        title={m.policy_count === 0 ? "No backup plan applied" : m.agent_online === false ? "Agent offline" : "Run backup now"}
                        onClick={() => handleRun(m)}
                        data-testid={`run-backup-${m.resource_id}`}
                      >
                        {runningId === m.resource_id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Play className="w-3 h-3 mr-1" />}
                        Run
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {machines.length === 0 && (
            <div className="py-12 text-center text-muted-foreground">
              <HardDrive className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No machines match the current filter</p>
            </div>
          )}
          {machines.length > 0 && (
            <div className="flex flex-col gap-2 border-t border-border/60 bg-muted/[0.12] px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between" data-testid="backup-status-pagination">
              <span>Showing <strong className="text-foreground">{rangeStart}–{rangeEnd}</strong> of <strong className="text-foreground">{machines.length}</strong> machines</span>
              <div className="flex items-center justify-between gap-2 sm:justify-end">
                <span className="mr-1">Page {safePage} of {totalPages}</span>
                <Button variant="outline" size="sm" className="h-8" onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage <= 1} aria-label="Previous backup status page"><ChevronLeft className="mr-1 h-3.5 w-3.5" />Previous</Button>
                <Button variant="outline" size="sm" className="h-8" onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage >= totalPages} aria-label="Next backup status page">Next<ChevronRight className="ml-1 h-3.5 w-3.5" /></Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(bulkRunTarget)} onOpenChange={(open) => !open && setBulkRunTarget(null)}>
        <NexusWorkflowDialog
          eyebrow="Backup recovery"
          title="Run backups across affected machines?"
          description="This queues a backup run for every eligible online machine in the current filtered view. Review the scope before proceeding."
          icon={Play}
          tone="amber"
          footer={<><Button variant="outline" onClick={() => setBulkRunTarget(null)}>Cancel</Button><Button onClick={() => handleBulkRun(true)} disabled={runningId === "__bulk__"}>{runningId === "__bulk__" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Queue {bulkRunTarget?.count || 0} backups</Button></>}
        >
          <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-4"><p className="text-2xl font-semibold">{bulkRunTarget?.count || 0}</p><p className="mt-1 text-sm text-muted-foreground">eligible online machines</p></div><div className="rounded-xl border border-border bg-muted/20 p-4"><p className="text-2xl font-semibold">{bulkRunTarget?.planCount || 0}</p><p className="mt-1 text-sm text-muted-foreground">backup application assignments</p></div></div>
        </NexusWorkflowDialog>
      </Dialog>
    </div>
  );
}
