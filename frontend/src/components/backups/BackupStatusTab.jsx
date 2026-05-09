import { useEffect, useState } from "react";
import axios from "axios";
import { API } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Play, Wifi, WifiOff, Search, FilterX, HardDrive } from "lucide-react";
import { toast } from "sonner";

export default function BackupStatusTab({ token, onDataChange }) {
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [runningId, setRunningId] = useState(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/acronis/backup-statuses`, { headers });
      setData(r.data);
      onDataChange?.(r.data);
    } catch { toast.error("Failed to load backup statuses"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); /* eslint-disable-next-line */ }, []);

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
      const res = await axios.post(`${API}/acronis/backup/run`, payload, { headers });
      toast.success(res.data?.message || `Backup triggered for ${m.machine_name}`);
      setTimeout(fetchData, 2500);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to trigger backup");
    } finally {
      setRunningId(null);
    }
  };

  const handleBulkRun = async () => {
    const machines = (data?.machines || []).filter(m =>
      (statusFilter === "all" || m.backup_health === statusFilter) &&
      m.agent_online === true &&
      (m.backup_application_ids?.length || 0) > 0
    );
    if (!machines.length) {
      toast.error("No eligible machines (must be online with applied backup plans)");
      return;
    }
    if (!window.confirm(`Trigger backup for ${machines.length} online machine(s)?`)) return;
    setRunningId("__bulk__");
    const allAppIds = [...new Set(machines.flatMap(m => m.backup_application_ids || []))];
    try {
      const res = await axios.post(`${API}/acronis/backup/run`, { application_ids: allAppIds }, { headers });
      toast.success(res.data?.message || `Bulk backup triggered for ${machines.length} machines`);
      setTimeout(fetchData, 3000);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Bulk backup failed");
    } finally {
      setRunningId(null);
    }
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  const machines = (data?.machines || [])
    .filter(m => statusFilter === "all" || m.backup_health === statusFilter)
    .filter(m => !search ||
      (m.machine_name || "").toLowerCase().includes(search.toLowerCase()) ||
      (m.tenant_name || "").toLowerCase().includes(search.toLowerCase())
    );

  return (
    <div className="space-y-3" data-testid="bcc-status-tab">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-[200px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search machine or tenant..." value={search} onChange={e => setSearch(e.target.value)} data-testid="status-search" />
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
            disabled={runningId === "__bulk__"}
            onClick={handleBulkRun}
            data-testid="bulk-run-backup"
          >
            {runningId === "__bulk__" ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Play className="w-3.5 h-3.5 mr-1" />}
            Run on All Online ({statusFilter})
          </Button>
        )}
        {statusFilter !== "all" && (
          <Button size="sm" variant="ghost" onClick={() => setStatusFilter("all")}>
            <FilterX className="w-3.5 h-3.5 mr-1" />Clear
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
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
              {machines.map((m, i) => (
                <TableRow key={m.resource_id || i} data-testid={`machine-${m.resource_id}`}>
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
          {machines.length === 0 && (
            <div className="py-12 text-center text-muted-foreground">
              <HardDrive className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No machines match the current filter</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
