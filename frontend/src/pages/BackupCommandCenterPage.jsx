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
import { Loader2, HardDrive, Shield, CheckCircle, XCircle, AlertTriangle, Clock, RefreshCw, Users, Bell, Link2, Activity, Server, Play, Wifi, WifiOff, FilterX, DollarSign, Save, Download, Eye, FileText, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";

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
  const [pricing, setPricing] = useState({});
  const [currency, setCurrency] = useState("AUD");
  const [fxRate, setFxRate] = useState(1.0);
  const [fxUpdatedAt, setFxUpdatedAt] = useState(null);
  const [refreshingFx, setRefreshingFx] = useState(false);
  const [billingPreview, setBillingPreview] = useState(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [savingPricing, setSavingPricing] = useState(false);
  const [syncingBilling, setSyncingBilling] = useState(false);
  const [autoBillBusy, setAutoBillBusy] = useState(null);
  const [autoBillDialog, setAutoBillDialog] = useState(null);
  const [autoBillFrequency, setAutoBillFrequency] = useState("monthly");

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

  const handleBulkRunBackup = async () => {
    const machines = (bs.machines || []).filter(m =>
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
    // Combine all application_ids across machines into one request
    const allAppIds = [...new Set(machines.flatMap(m => m.backup_application_ids || []))];
    try {
      const res = await axios.post(`${API}/acronis/backup/run`, { application_ids: allAppIds }, { headers });
      toast.success(res.data?.message || `Bulk backup triggered for ${machines.length} machines`);
      setTimeout(fetchAll, 3000);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Bulk backup failed");
    } finally {
      setRunningId(null);
    }
  };

  const openStatusTab = (filter) => {
    setStatusFilter(filter);
    setTab("statuses");
  };

  const fetchBilling = async () => {
    setBillingLoading(true);
    try {
      const [priceRes, previewRes] = await Promise.all([
        axios.get(`${API}/acronis/pricing`, { headers }),
        axios.get(`${API}/acronis/billing/preview`, { headers }),
      ]);
      setPricing(priceRes.data?.pricing || {});
      setCurrency(priceRes.data?.currency || "AUD");
      setFxRate(priceRes.data?.fx_rate_from_usd || 1.0);
      setFxUpdatedAt(priceRes.data?.fx_updated_at || null);
      setBillingPreview(previewRes.data);
    } catch (e) {
      toast.error("Failed to load billing data");
    } finally {
      setBillingLoading(false);
    }
  };

  const refreshFx = async (targetCurrency) => {
    setRefreshingFx(true);
    try {
      const res = await axios.post(`${API}/acronis/fx/refresh`, { currency: targetCurrency }, { headers });
      toast.success(`FX updated: 1 USD = ${res.data.fx_rate_from_usd} ${res.data.currency}`);
      await fetchBilling();
    } catch (e) {
      toast.error(e.response?.data?.detail || "FX refresh failed");
    } finally {
      setRefreshingFx(false);
    }
  };

  useEffect(() => {
    if (tab === "billing" && !billingPreview) fetchBilling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const handlePriceChange = (code, field, value) => {
    setPricing(prev => ({
      ...prev,
      [code]: { ...prev[code], [field]: field === "enabled" ? value : parseFloat(value) || 0 }
    }));
  };

  const savePricing = async () => {
    setSavingPricing(true);
    try {
      await axios.post(`${API}/acronis/pricing`, { pricing, currency }, { headers });
      toast.success("Pricing saved — refreshing preview");
      await fetchBilling();
    } catch { toast.error("Failed to save pricing"); }
    finally { setSavingPricing(false); }
  };

  const syncBillingToLineItems = async (dryRun = false) => {
    setSyncingBilling(true);
    try {
      const res = await axios.post(`${API}/acronis/billing/sync`, { dry_run: dryRun }, { headers });
      const msg = dryRun
        ? `Preview: ${res.data.synced_count} clients would be billed ${currency} ${res.data.total_billed.toFixed(2)}`
        : `Synced ${res.data.synced_count} clients — ${currency} ${res.data.total_billed.toFixed(2)} billed`;
      toast.success(msg);
      if (res.data.skipped?.length) {
        toast.warning(`Skipped ${res.data.skipped.length} client(s): ${res.data.skipped.map(s => s.reason).slice(0, 3).join(", ")}`);
      }
      if (!dryRun) fetchBilling();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Billing sync failed");
    } finally {
      setSyncingBilling(false);
    }
  };

  const handleToggleAutoBill = (clientRow) => {
    if (clientRow.auto_bill_recurring) {
      // already on — disable directly
      disableAutoBill(clientRow.client_id);
    } else if ((clientRow.active_recurring_invoices || []).length > 0) {
      // active RIs exist — enable on all directly
      enableAutoBill(clientRow.client_id, false);
    } else {
      // no RIs yet — ask whether to create a scaffold
      setAutoBillDialog(clientRow);
      setAutoBillFrequency("monthly");
    }
  };

  const enableAutoBill = async (clientId, createIfMissing) => {
    setAutoBillBusy(clientId);
    try {
      const res = await axios.post(
        `${API}/acronis/billing/client/${clientId}/link-to-recurring`,
        { create_if_missing: createIfMissing, frequency: autoBillFrequency, currency },
        { headers }
      );
      toast.success(res.data.message || "Linked");
      setAutoBillDialog(null);
      fetchBilling();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to link");
    } finally {
      setAutoBillBusy(null);
    }
  };

  const disableAutoBill = async (clientId) => {
    setAutoBillBusy(clientId);
    try {
      const res = await axios.post(`${API}/acronis/billing/client/${clientId}/unlink-recurring`, {}, { headers });
      toast.success(`Auto-bill disabled on ${res.data.disabled_on} recurring invoice(s)`);
      fetchBilling();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to unlink");
    } finally {
      setAutoBillBusy(null);
    }
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
          <TabsTrigger value="billing" data-testid="tab-billing"><DollarSign className="w-3 h-3 mr-1" />Billing</TabsTrigger>
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
              <div className="flex items-center gap-2">
                {(statusFilter === "failed" || statusFilter === "warning") && (
                  <Button
                    size="sm"
                    className="h-7 px-3 text-[11px] bg-red-500/15 hover:bg-red-500/25 text-red-400 border border-red-500/30"
                    disabled={runningId === "__bulk__"}
                    onClick={handleBulkRunBackup}
                    data-testid="bulk-run-backup-btn"
                  >
                    {runningId === "__bulk__" ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Play className="w-3 h-3 mr-1" />}
                    Run Backup on All Online
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => setStatusFilter("all")} data-testid="clear-status-filter-btn">
                  <FilterX className="w-3 h-3 mr-1" />Clear filter
                </Button>
              </div>
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

        {/* Billing Tab */}
        <TabsContent value="billing" className="space-y-5">
          {billingLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <h2 className="text-lg font-semibold flex items-center gap-2"><DollarSign className="w-4 h-4" />Acronis Usage Billing</h2>
                  <p className="text-xs text-muted-foreground">Sync Acronis tenant usage into client contracts as billable line items — accurate, auditable, per-client.</p>
                  {fxUpdatedAt && currency !== "USD" && (
                    <p className="text-[11px] text-muted-foreground mt-1">
                      FX: 1 USD = <span className="text-emerald-400 font-semibold">{fxRate} {currency}</span> · updated {new Date(fxUpdatedAt).toLocaleString()}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Select value={currency} onValueChange={v => refreshFx(v)}>
                    <SelectTrigger className="h-8 w-[120px] text-xs" data-testid="currency-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="AUD">AUD ($)</SelectItem>
                      <SelectItem value="USD">USD ($)</SelectItem>
                      <SelectItem value="EUR">EUR (€)</SelectItem>
                      <SelectItem value="GBP">GBP (£)</SelectItem>
                      <SelectItem value="NZD">NZD ($)</SelectItem>
                      <SelectItem value="CAD">CAD ($)</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button size="sm" variant="outline" onClick={() => refreshFx(currency)} disabled={refreshingFx} data-testid="refresh-fx-btn">
                    {refreshingFx ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                    Refresh FX
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => fetchBilling()} disabled={billingLoading} data-testid="refresh-billing-btn">
                    <RefreshCw className="w-3 h-3 mr-1" />Refresh
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => syncBillingToLineItems(true)} disabled={syncingBilling} data-testid="dry-run-billing-btn">
                    <Eye className="w-3 h-3 mr-1" />Dry Run
                  </Button>
                  <Button size="sm" onClick={() => syncBillingToLineItems(false)} disabled={syncingBilling || !(billingPreview?.linked_clients)} data-testid="sync-billing-btn">
                    {syncingBilling ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <FileText className="w-3 h-3 mr-1" />}
                    Sync to Line Items
                  </Button>
                </div>
              </div>

              {/* Summary */}
              <div className="grid grid-cols-4 gap-3">
                <Card><CardContent className="pt-4 pb-3"><p className="text-2xl font-bold">{billingPreview?.linked_clients || 0}</p><p className="text-[11px] text-muted-foreground">Linked Clients</p></CardContent></Card>
                <Card><CardContent className="pt-4 pb-3"><p className="text-2xl font-bold">{billingPreview?.period || "—"}</p><p className="text-[11px] text-muted-foreground">Billing Period</p></CardContent></Card>
                <Card><CardContent className="pt-4 pb-3"><p className="text-2xl font-bold text-emerald-400">{currency} {(billingPreview?.grand_total || 0).toFixed(2)}</p><p className="text-[11px] text-muted-foreground">Total This Period</p></CardContent></Card>
                <Card><CardContent className="pt-4 pb-3"><p className="text-2xl font-bold text-amber-400">{(billingPreview?.results || []).reduce((n, r) => n + (r.unknown_count || 0), 0)}</p><p className="text-[11px] text-muted-foreground">Unknown Offerings</p></CardContent></Card>
              </div>

              {/* Pricing Config */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <DollarSign className="w-4 h-4" />Pricing Configuration
                    <Badge variant="outline" className="text-[10px] ml-auto">{Object.keys(pricing).length} offering items</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Offering</TableHead><TableHead>Code</TableHead><TableHead>Unit</TableHead>
                        <TableHead className="text-right">Unit Price ({currency})</TableHead>
                        <TableHead className="text-right">Markup %</TableHead>
                        <TableHead className="text-center">Enabled</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.entries(pricing).sort((a, b) => (a[1].category || "").localeCompare(b[1].category || "")).map(([code, cfg]) => (
                        <TableRow key={code}>
                          <TableCell className="font-medium text-sm">{cfg.label}</TableCell>
                          <TableCell className="text-[11px] text-muted-foreground font-mono">{code}</TableCell>
                          <TableCell className="text-xs">{cfg.unit}</TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number" step="0.01"
                              value={cfg.unit_price}
                              onChange={e => handlePriceChange(code, "unit_price", e.target.value)}
                              className="h-7 w-24 text-right text-sm ml-auto"
                              data-testid={`price-input-${code}`}
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number" step="1"
                              value={cfg.markup_pct || 0}
                              onChange={e => handlePriceChange(code, "markup_pct", e.target.value)}
                              className="h-7 w-20 text-right text-sm ml-auto"
                            />
                          </TableCell>
                          <TableCell className="text-center">
                            <input
                              type="checkbox"
                              checked={cfg.enabled !== false}
                              onChange={e => handlePriceChange(code, "enabled", e.target.checked)}
                              className="h-4 w-4"
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <div className="flex justify-end mt-3">
                    <Button size="sm" onClick={savePricing} disabled={savingPricing} data-testid="save-pricing-btn">
                      {savingPricing ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
                      Save Pricing
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Per-client preview */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Per-Client Billing Preview ({billingPreview?.period || "—"})</CardTitle>
                </CardHeader>
                <CardContent>
                  {(billingPreview?.results || []).length === 0 ? (
                    <p className="text-center text-sm text-muted-foreground py-6">
                      No linked Acronis tenants. Go to the <button className="underline" onClick={() => setTab("overview")}>Tenants tab</button> and link tenants to NexusOps clients first.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {billingPreview.results.map(r => (
                        <div key={r.client_id} className="border rounded-md p-3 space-y-2" data-testid={`billing-client-${r.client_id}`}>
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-semibold flex items-center gap-2">
                                {r.client_name}
                                {r.auto_bill_recurring && (
                                  <Badge variant="outline" className="text-[9px] border-sky-500/40 text-sky-400" data-testid={`auto-bill-badge-${r.client_id}`}>
                                    <RefreshCw className="w-2.5 h-2.5 mr-0.5" />Auto-Billed via Recurring
                                  </Badge>
                                )}
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                {r.contract_id ? (
                                  <span className="text-emerald-400">✓ Contract: {r.contract_name}</span>
                                ) : (
                                  <span className="text-amber-400">⚠ No active contract — will skip on sync</span>
                                )}
                                {r.unknown_count > 0 && <span className="ml-2 text-amber-400">· {r.unknown_count} unknown offerings</span>}
                                {r.active_recurring_invoices?.length > 0 && (
                                  <span className="ml-2 text-muted-foreground">· {r.active_recurring_invoices.length} active recurring invoice{r.active_recurring_invoices.length !== 1 ? "s" : ""}</span>
                                )}
                              </p>
                            </div>
                            <div className="flex items-start gap-3">
                              <Button
                                size="sm"
                                variant={r.auto_bill_recurring ? "outline" : "default"}
                                className={r.auto_bill_recurring ? "text-sky-400 border-sky-500/40 hover:bg-sky-500/10" : "bg-sky-600 hover:bg-sky-700"}
                                onClick={() => handleToggleAutoBill(r)}
                                disabled={autoBillBusy === r.client_id}
                                data-testid={`auto-bill-toggle-${r.client_id}`}
                              >
                                {autoBillBusy === r.client_id ? (
                                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                ) : r.auto_bill_recurring ? (
                                  <XCircle className="w-3 h-3 mr-1" />
                                ) : (
                                  <RefreshCw className="w-3 h-3 mr-1" />
                                )}
                                {r.auto_bill_recurring ? "Disable Auto-Bill" : "Link to Recurring Invoice"}
                              </Button>
                              <div className="text-right">
                                <p className="text-xl font-bold text-emerald-400">{currency} {r.total.toFixed(2)}</p>
                                <p className="text-[10px] text-muted-foreground">{r.line_items.filter(l => !l.unknown).length} billable items</p>
                              </div>
                            </div>
                          </div>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-xs">Offering</TableHead>
                                <TableHead className="text-xs text-right">Quantity</TableHead>
                                <TableHead className="text-xs text-right">Unit Price</TableHead>
                                <TableHead className="text-xs text-right">Line Total</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {r.line_items.map((li, idx) => (
                                <TableRow key={idx} className={li.unknown ? "opacity-50" : ""}>
                                  <TableCell className="text-xs">
                                    {li.label}
                                    {li.unknown && <Badge variant="outline" className="ml-2 text-[9px] text-amber-400 border-amber-500/30">unknown — no price set</Badge>}
                                    {li.markup_pct > 0 && <Badge variant="outline" className="ml-2 text-[9px]">+{li.markup_pct}% markup</Badge>}
                                  </TableCell>
                                  <TableCell className="text-xs text-right">{li.quantity} {li.unit}</TableCell>
                                  <TableCell className="text-xs text-right">{currency} {li.unit_price.toFixed(4)}</TableCell>
                                  <TableCell className="text-xs text-right font-semibold">{currency} {li.total.toFixed(2)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
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
      {/* Auto-Bill via Recurring — create scaffold dialog */}
      <Dialog open={!!autoBillDialog} onOpenChange={v => !v && setAutoBillDialog(null)}>
        <DialogContent aria-describedby="auto-bill-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><RefreshCw className="w-5 h-5 text-sky-400" />Link Acronis Billing to Recurring Invoice</DialogTitle>
            <DialogDescription id="auto-bill-desc">
              {autoBillDialog?.client_name} has no active recurring invoices yet. Create one now so Acronis usage auto-attaches every period?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="border rounded-md p-3 bg-sky-500/[0.04] border-sky-500/20 text-xs space-y-1">
              <p className="font-semibold">Scaffold summary</p>
              <p className="text-muted-foreground">Client: <span className="text-foreground">{autoBillDialog?.client_name}</span></p>
              <p className="text-muted-foreground">Current Acronis usage: <span className="text-emerald-400 font-semibold">{currency} {(autoBillDialog?.total || 0).toFixed(2)}</span></p>
              <p className="text-muted-foreground">Will be auto-attached as line items each time the recurring invoice generates.</p>
            </div>
            <div>
              <label className="text-xs font-medium">Billing Frequency</label>
              <Select value={autoBillFrequency} onValueChange={setAutoBillFrequency}>
                <SelectTrigger data-testid="auto-bill-frequency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="annually">Annually</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAutoBillDialog(null)}>Cancel</Button>
            <Button
              onClick={() => enableAutoBill(autoBillDialog.client_id, true)}
              disabled={autoBillBusy === autoBillDialog?.client_id}
              className="bg-sky-600 hover:bg-sky-700"
              data-testid="confirm-auto-bill-create-btn"
            >
              {autoBillBusy === autoBillDialog?.client_id ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}
              Create & Link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
