import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, HardDrive, Shield, CheckCircle, XCircle, AlertTriangle, Clock, RefreshCw, Users, Bell, Link2, Activity, Server, Play, Wifi, WifiOff, FilterX } from "lucide-react";

export default function BackupCommandCenterPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [tab, setTab] = useState("overview");
  const [connected, setConnected] = useState(null);
  const [usageSummary, setUsageSummary] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [backupStatuses, setBackupStatuses] = useState(null);
  const [activities, setActivities] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState([]);
  const [linkDialog, setLinkDialog] = useState(null);
  const [linkClientId, setLinkClientId] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // all | failed | warning | ok
  const [runningId, setRunningId] = useState(null);

  const fetchAll = async () => {
    try {
      const [configRes, summaryRes, custRes, alertRes, statusRes, actRes, clientsRes] = await Promise.all([
        axios.get(`${API}/acronis/config`, { headers }).catch(() => ({ data: { connected: false } })),
        axios.get(`${API}/acronis/usage-summary`, { headers }).catch(() => ({ data: {} })),
        axios.get(`${API}/acronis/customers`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/acronis/alerts`, { headers }).catch(() => ({ data: { items: [] } })),
        axios.get(`${API}/acronis/backup-statuses`, { headers }).catch(() => ({ data: {} })),
        axios.get(`${API}/acronis/activities`, { headers }).catch(() => ({ data: { items: [] } })),
        axios.get(`${API}/clients`, { headers }).catch(() => ({ data: [] })),
      ]);
      setConnected(configRes.data?.connected);
      setUsageSummary(summaryRes.data);
      setCustomers(Array.isArray(custRes.data) ? custRes.data : []);
      setAlerts(alertRes.data?.items || []);
      setBackupStatuses(statusRes.data);
      setActivities(actRes.data?.items || []);
      setClients(clientsRes.data || []);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await axios.post(`${API}/acronis/sync`, {}, { headers });
      toast.success(`Synced: ${res.data.tenants_synced} tenants, ${res.data.resources_synced} resources`);
      fetchAll();
    } catch { toast.error("Sync failed"); }
    finally { setSyncing(false); }
  };

  const handleLink = async () => {
    if (!linkDialog || !linkClientId) return;
    try {
      await axios.post(`${API}/acronis/customers/${linkDialog.id}/link`, { client_id: linkClientId, acronis_tenant_id: linkDialog.acronis_tenant_id }, { headers });
      toast.success(`Linked ${linkDialog.name} to NexusOps client`);
      setLinkDialog(null);
      setLinkClientId("");
      fetchAll();
    } catch { toast.error("Link failed"); }
  };

  const handleRunBackup = async (machine) => {
    if (!machine?.resource_id && !(machine?.backup_application_ids?.length)) {
      toast.error("Missing resource/application IDs");
      return;
    }
    setRunningId(machine.resource_id);
    try {
      const payload = machine.backup_application_ids?.length
        ? { application_ids: machine.backup_application_ids, resource_id: machine.resource_id }
        : { resource_id: machine.resource_id };
      const res = await axios.post(`${API}/acronis/backup/run`, payload, { headers });
      toast.success(res.data?.message || `Backup triggered for ${machine.machine_name}`);
      setTimeout(fetchAll, 2500);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to trigger backup");
    } finally {
      setRunningId(null);
    }
  };

  const openStatusTab = (filter) => {
    setStatusFilter(filter);
    setTab("statuses");
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const s = usageSummary || {};
  const bs = backupStatuses || {};
  const critAlerts = alerts.filter(a => ["critical", "error"].includes(a.severity));

  return (
    <div className="space-y-5" data-testid="backup-command-center">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Backup Command Center</h1>
          <p className="text-sm text-muted-foreground">
            Acronis Cyber Cloud — {connected ?
              <span className="text-emerald-400">Connected ({s.data_source === "live" ? "Live" : "Cached"})</span> :
              <span className="text-red-400">Not Connected — Configure in Settings &gt; Integrations</span>}
          </p>
        </div>
        <Button onClick={handleSync} disabled={syncing} data-testid="sync-acronis-btn">
          {syncing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}Sync Acronis
        </Button>
      </div>

      <div className="grid grid-cols-6 gap-3">
        <Card><CardContent className="pt-4 pb-3"><Users className="w-5 h-5 text-blue-400 mb-1" /><p className="text-2xl font-bold">{s.total_tenants || customers.length || 0}</p><p className="text-[11px] text-muted-foreground">Tenants</p></CardContent></Card>
        <Card className="cursor-pointer hover:border-violet-500/40 transition-colors" onClick={() => openStatusTab("all")} data-testid="card-total-machines"><CardContent className="pt-4 pb-3"><Server className="w-5 h-5 text-violet-400 mb-1" /><p className="text-2xl font-bold">{bs.total_machines || s.total_resources || 0}</p><p className="text-[11px] text-muted-foreground">Machines</p></CardContent></Card>
        <Card className="cursor-pointer hover:border-emerald-500/40 transition-colors" onClick={() => openStatusTab("ok")} data-testid="card-healthy"><CardContent className="pt-4 pb-3"><CheckCircle className="w-5 h-5 text-emerald-400 mb-1" /><p className="text-2xl font-bold text-emerald-400">{bs.healthy || s.protected_resources || 0}</p><p className="text-[11px] text-muted-foreground">Healthy</p></CardContent></Card>
        <Card className={`cursor-pointer hover:border-red-500/60 transition-colors ${bs.failed > 0 ? "border-red-500/20" : ""}`} onClick={() => openStatusTab("failed")} data-testid="card-failed"><CardContent className="pt-4 pb-3"><XCircle className="w-5 h-5 text-red-400 mb-1" /><p className="text-2xl font-bold text-red-400">{bs.failed || 0}</p><p className="text-[11px] text-muted-foreground">Failed</p></CardContent></Card>
        <Card className={`cursor-pointer hover:border-amber-500/60 transition-colors ${bs.warning > 0 ? "border-amber-500/20" : ""}`} onClick={() => openStatusTab("warning")} data-testid="card-warning"><CardContent className="pt-4 pb-3"><AlertTriangle className="w-5 h-5 text-amber-400 mb-1" /><p className="text-2xl font-bold text-amber-400">{bs.warning || 0}</p><p className="text-[11px] text-muted-foreground">Warning</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><Bell className="w-5 h-5 text-orange-400 mb-1" /><p className="text-2xl font-bold">{alerts.length}</p><p className="text-[11px] text-muted-foreground">Alerts</p></CardContent></Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="overview"><Users className="w-3 h-3 mr-1" />Tenants ({customers.length})</TabsTrigger>
          <TabsTrigger value="statuses"><HardDrive className="w-3 h-3 mr-1" />Backup Status ({bs.total_machines || 0})</TabsTrigger>
          <TabsTrigger value="activities"><Activity className="w-3 h-3 mr-1" />Activities ({activities.length})</TabsTrigger>
          <TabsTrigger value="alerts"><Bell className="w-3 h-3 mr-1" />Alerts ({alerts.length})</TabsTrigger>
        </TabsList>

        {/* Tenants Tab */}
        <TabsContent value="overview">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Acronis Tenant</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Linked Client</TableHead><TableHead className="text-center">Machines</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {customers.map((c, i) => {
                const tenantStats = (bs.tenant_summary || {})[c.name] || {};
                return (
                  <TableRow key={c.id || i} data-testid={`tenant-${c.id}`}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px] capitalize">{c.kind || "customer"}</Badge></TableCell>
                    <TableCell><Badge variant={c.enabled !== false ? "default" : "destructive"} className="text-[10px]">{c.enabled !== false ? "Active" : "Disabled"}</Badge></TableCell>
                    <TableCell>
                      {c.linked_client_name ? (
                        <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 border text-[10px]">{c.linked_client_name}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not linked</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {tenantStats.total ? (
                        <div className="flex items-center justify-center gap-1">
                          <span className="text-sm">{tenantStats.total}</span>
                          {tenantStats.ok > 0 && <span className="text-emerald-400 text-[10px]">{tenantStats.ok}ok</span>}
                          {tenantStats.failed > 0 && <span className="text-red-400 text-[10px]">{tenantStats.failed}fail</span>}
                        </div>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => { setLinkDialog(c); setLinkClientId(c.linked_client_id || ""); }} data-testid={`link-btn-${c.id}`}>
                        <Link2 className="w-3 h-3 mr-1" />{c.linked_client_name ? "Change" : "Link"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {customers.length === 0 && <p className="text-center text-muted-foreground py-8">No tenants. Click "Sync Acronis" to pull data.</p>}
        </TabsContent>

        {/* Backup Status Tab */}
        <TabsContent value="statuses">
          {statusFilter !== "all" && (
            <div className="flex items-center justify-between mb-3 px-3 py-2 rounded-md bg-muted/40 border" data-testid="status-filter-banner">
              <p className="text-xs text-muted-foreground">
                Filtering by status: <span className={`font-semibold capitalize ${statusFilter === "failed" ? "text-red-400" : statusFilter === "warning" ? "text-amber-400" : "text-emerald-400"}`}>{statusFilter}</span>
                {" "}— showing {(bs.machines || []).filter(m => m.backup_health === statusFilter).length} of {(bs.machines || []).length} machines
              </p>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => setStatusFilter("all")} data-testid="clear-status-filter-btn">
                <FilterX className="w-3 h-3 mr-1" />Clear filter
              </Button>
            </div>
          )}
          <Table>
            <TableHeader><TableRow>
              <TableHead>Machine</TableHead><TableHead>Tenant</TableHead><TableHead>Agent</TableHead><TableHead>Status</TableHead><TableHead>Applied Plans</TableHead><TableHead>Last Backup</TableHead><TableHead>Last Success</TableHead><TableHead>Next Backup</TableHead><TableHead className="text-right">Action</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {(bs.machines || [])
                .filter(m => statusFilter === "all" ? true : m.backup_health === statusFilter)
                .map((m, i) => (
                <TableRow key={m.resource_id || i} data-testid={`machine-${m.resource_id}`}>
                  <TableCell className="font-medium text-sm">{m.machine_name}</TableCell>
                  <TableCell className="text-sm">{m.tenant_name}</TableCell>
                  <TableCell>
                    {m.agent_online === true ? (
                      <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 border text-[10px] gap-1" data-testid={`agent-online-${m.resource_id}`}>
                        <Wifi className="w-3 h-3" />Online
                      </Badge>
                    ) : m.agent_online === false ? (
                      <Badge className="bg-red-500/15 text-red-400 border-red-500/30 border text-[10px] gap-1" data-testid={`agent-offline-${m.resource_id}`}>
                        <WifiOff className="w-3 h-3" />Offline
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">—</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={m.backup_health === "ok" ? "default" : m.backup_health === "failed" ? "destructive" : "secondary"}
                      className={`text-[10px] capitalize ${m.backup_health === "ok" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : m.backup_health === "failed" ? "" : m.backup_health === "warning" ? "bg-amber-500/15 text-amber-400 border-amber-500/30" : ""}`}>
                      {m.backup_health}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs max-w-[200px] truncate" title={m.plan_names}>{m.plan_names || "No plans"}</TableCell>
                  <TableCell className="text-[11px] text-muted-foreground">{m.last_backup ? m.last_backup.slice(0, 16).replace("T", " ") : "Never"}</TableCell>
                  <TableCell className="text-[11px] text-muted-foreground">{m.last_success ? m.last_success.slice(0, 16).replace("T", " ") : "Never"}</TableCell>
                  <TableCell className="text-[11px] text-muted-foreground">{m.next_backup ? m.next_backup.slice(0, 16).replace("T", " ") : "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[11px]"
                      disabled={runningId === m.resource_id || (m.policy_count === 0) || m.agent_online === false}
                      title={m.policy_count === 0 ? "No backup plan applied" : m.agent_online === false ? "Agent is offline" : "Run backup now"}
                      onClick={() => handleRunBackup(m)}
                      data-testid={`run-backup-btn-${m.resource_id}`}
                    >
                      {runningId === m.resource_id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Play className="w-3 h-3 mr-1" />}
                      Run Backup
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {(!bs.machines || bs.machines.length === 0) && <p className="text-center text-muted-foreground py-8">No backup statuses available. Click "Sync Acronis" to pull data.</p>}
          {bs.machines?.length > 0 && statusFilter !== "all" && bs.machines.filter(m => m.backup_health === statusFilter).length === 0 && (
            <p className="text-center text-muted-foreground py-8">No machines match the "{statusFilter}" filter.</p>
          )}
        </TabsContent>

        {/* Activities Tab */}
        <TabsContent value="activities">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Resource</TableHead><TableHead>Tenant</TableHead><TableHead>Plan</TableHead><TableHead>Type</TableHead><TableHead>State</TableHead><TableHead>Started</TableHead><TableHead>Completed</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {activities.map((a, i) => (
                <TableRow key={a.id || i}>
                  <TableCell className="font-medium text-sm">{a.resource_name || "—"}</TableCell>
                  <TableCell className="text-sm">{a.tenant_name}</TableCell>
                  <TableCell className="text-xs max-w-[150px] truncate">{a.plan_name || "—"}</TableCell>
                  <TableCell className="text-xs">{a.activity_type || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={a.state === "completed" ? "default" : a.state === "failed" ? "destructive" : a.state === "started" || a.state === "running" ? "secondary" : "outline"}
                      className={`text-[10px] capitalize ${a.state === "completed" ? "bg-emerald-500/15 text-emerald-400" : a.state === "started" || a.state === "running" ? "bg-blue-500/15 text-blue-400" : ""}`}>
                      {a.state}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-[11px] text-muted-foreground">{a.started_at ? a.started_at.slice(0, 16).replace("T", " ") : "—"}</TableCell>
                  <TableCell className="text-[11px] text-muted-foreground">{a.completed_at ? a.completed_at.slice(0, 16).replace("T", " ") : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {activities.length === 0 && <p className="text-center text-muted-foreground py-8">No recent activities</p>}
        </TabsContent>

        {/* Alerts Tab */}
        <TabsContent value="alerts">
          {alerts.length > 0 ? (
            <div className="space-y-2">
              {alerts.map((alert, i) => {
                const details = alert.details || {};
                const severity = alert.severity || details.severity || "info";
                const category = details.category || alert.type || "";
                const desc = details.description || "";
                const fields = details.fields || {};
                return (
                  <Card key={alert.id || i} className={severity === "critical" || severity === "error" ? "border-red-500/30" : severity === "warning" ? "border-amber-500/20" : ""}>
                    <CardContent className="py-3">
                      <div className="flex items-start gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${severity === "critical" || severity === "error" ? "bg-red-500/15" : severity === "warning" ? "bg-amber-500/15" : "bg-blue-500/15"}`}>
                          <AlertTriangle className={`w-4 h-4 ${severity === "critical" || severity === "error" ? "text-red-400" : severity === "warning" ? "text-amber-400" : "text-blue-400"}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <Badge variant={severity === "critical" || severity === "error" ? "destructive" : "secondary"} className="text-[9px] capitalize">{severity}</Badge>
                            {category && <span className="text-xs text-muted-foreground">{category}</span>}
                          </div>
                          <p className="text-sm">{desc}</p>
                          {fields.Subject && <p className="text-[11px] text-muted-foreground mt-0.5">Subject: {fields.Subject}</p>}
                          {fields.Recipient && <p className="text-[11px] text-muted-foreground">To: {fields.Recipient}</p>}
                          {fields.Time && <p className="text-[10px] text-muted-foreground mt-0.5">{fields.Time}</p>}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : <p className="text-center text-muted-foreground py-8">No active alerts</p>}
        </TabsContent>
      </Tabs>

      {/* Link Dialog */}
      <Dialog open={!!linkDialog} onOpenChange={v => !v && setLinkDialog(null)}>
        <DialogContent aria-describedby="link-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Link2 className="w-5 h-5" />Link Acronis Tenant</DialogTitle>
            <DialogDescription id="link-desc">Map "{linkDialog?.name}" to a NexusOps client for unified reporting</DialogDescription>
          </DialogHeader>
          <div>
            <Select value={linkClientId} onValueChange={setLinkClientId}>
              <SelectTrigger data-testid="link-client-select"><SelectValue placeholder="Select a NexusOps client..." /></SelectTrigger>
              <SelectContent>
                {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLinkDialog(null)}>Cancel</Button>
            <Button onClick={handleLink} disabled={!linkClientId} data-testid="confirm-link-btn"><Link2 className="w-4 h-4 mr-1" />Link</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
