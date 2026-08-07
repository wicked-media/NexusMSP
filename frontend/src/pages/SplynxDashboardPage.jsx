import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2, Wifi, WifiOff, AlertTriangle, CheckCircle, Search,
  Activity, Users, Server, RefreshCw, ArrowDownRight, DollarSign,
  Ban, ShieldAlert, Settings, Play
} from "lucide-react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend
} from "recharts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";

const STATUS_COLORS = {
  active: "#10b981",
  disabled: "#ef4444",
  pending: "#f59e0b",
  blocked: "#ef4444",
  stopped: "#dc2626",
  archived: "#6b7280",
};

export default function SplynxDashboardPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [configured, setConfigured] = useState(false);
  const [search, setSearch] = useState("");
  const [mainTab, setMainTab] = useState("overview");
  const [nonPayment, setNonPayment] = useState(null);
  const [suspendSettings, setSuspendSettings] = useState(null);
  const [settingsDialog, setSettingsDialog] = useState(false);
  const [actionClientId, setActionClientId] = useState("");
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [res, npRes, ssRes, configRes] = await Promise.all([
        axios.get(`${API}/splynx/overview`, { headers }),
        axios.get(`${API}/splynx/non-payment`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/settings/splynx-suspend`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/settings/splynx`, { headers }).catch(() => ({ data: { configured: false } })),
      ]);
      setData(res.data);
      setNonPayment(npRes.data);
      setSuspendSettings(ssRes.data || { auto_suspend_enabled: false, grace_days: 14, notify_before_suspend_days: 7, notify_client: true });
      setConfigured(Boolean(configRes.data?.configured));
    } catch {
      setData({ linked_clients: 0, total_services: 0, active_services: 0, suspended_services: 0, clients: [] });
      setNonPayment(null);
      setSuspendSettings({ auto_suspend_enabled: false, grace_days: 14, notify_before_suspend_days: 7, notify_client: true });
      setLoadError("ISP health data could not be loaded. Check the Splynx connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleSuspend = async (clientId) => {
    setActionClientId(clientId);
    try {
      const r = await axios.post(`${API}/splynx/suspend/${clientId}`, { reason: "Non-payment" }, { headers });
      toast.success(r.data.message);
      fetchData();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
    finally { setActionClientId(""); }
  };

  const handleUnsuspend = async (clientId) => {
    setActionClientId(clientId);
    try {
      const r = await axios.post(`${API}/splynx/unsuspend/${clientId}`, {}, { headers });
      toast.success(r.data.message);
      fetchData();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
    finally { setActionClientId(""); }
  };

  const handleAutoSuspendCheck = async () => {
    try {
      const r = await axios.post(`${API}/splynx/auto-suspend-check`, {}, { headers });
      toast.success(r.data.message);
      fetchData();
    } catch { toast.error("Auto-suspend check failed"); }
  };

  const handleSaveSuspendSettings = async () => {
    try {
      await axios.put(`${API}/settings/splynx-suspend`, suspendSettings, { headers });
      toast.success("Settings saved");
      setSettingsDialog(false);
    } catch { toast.error("Failed"); }
  };

  useEffect(() => { fetchData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
    </div>
  );

  const pendingServices = (data?.total_services || 0) - (data?.active_services || 0) - (data?.suspended_services || 0);
  const healthPercent = data?.total_services > 0 ? Math.round((data.active_services / data.total_services) * 100) : 0;

  const pieData = [
    { name: "Active", value: data?.active_services || 0, color: "#10b981" },
    { name: "Suspended", value: data?.suspended_services || 0, color: "#ef4444" },
    { name: "Other", value: Math.max(0, pendingServices), color: "#f59e0b" },
  ].filter(d => d.value > 0);

  const clientsWithIssues = (data?.clients || []).filter(c => c.suspended > 0);

  // Service type distribution
  const typeMap = {};
  (data?.clients || []).forEach(client => {
    (client.services || []).forEach(s => {
      const t = s.type || "other";
      if (!typeMap[t]) typeMap[t] = { active: 0, suspended: 0 };
      if (s.status === "active") typeMap[t].active++;
      else typeMap[t].suspended++;
    });
  });
  const barData = Object.entries(typeMap).map(([type, counts]) => ({
    name: type.charAt(0).toUpperCase() + type.slice(1),
    Active: counts.active,
    Suspended: counts.suspended,
  }));

  const filteredClients = (data?.clients || []).filter(c =>
    !search || c.client_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6" data-testid="splynx-dashboard">
      <OperationalPageHeader
        eyebrow="Network workspace - ISP billing"
        title="ISP service health"
        description="Splynx service availability, overdue billing exposure and customer links in one auditable operational view."
        icon={Activity}
        tone="sky"
        actions={(
          <>
            <Button variant="outline" size="sm" onClick={fetchData} data-testid="refresh-splynx">
              <RefreshCw className="w-4 h-4 mr-1" />Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/settings?tab=integrations&anchor=splynx-settings-card")} data-testid="splynx-provider-settings-btn">
              <Settings className="w-4 h-4 mr-1" />Provider Settings
            </Button>
            <Button variant="outline" size="sm" onClick={() => setSettingsDialog(true)} data-testid="suspend-settings-btn">
              <ShieldAlert className="w-4 h-4 mr-1" />Billing Controls
            </Button>
          </>
        )}
      />

      {loadError && (
        <Card className="border-red-500/30 bg-red-500/5" data-testid="splynx-load-error">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="flex items-center gap-2 text-sm text-red-200"><AlertTriangle className="w-4 h-4 text-red-400" />{loadError}</div>
            <Button variant="outline" size="sm" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-1" />Try again</Button>
          </CardContent>
        </Card>
      )}

      {!configured && !loadError && (
        <Card className="border-sky-500/25 bg-sky-500/5" data-testid="splynx-setup-guidance">
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold">Connect Splynx before monitoring services</p>
              <p className="mt-1 text-xs text-muted-foreground">Add the provider URL and API credentials, test the connection, then link each customer from their NexusMSP client profile.</p>
            </div>
            <Button size="sm" onClick={() => navigate("/settings?tab=integrations&anchor=splynx-settings-card")}><Settings className="w-4 h-4 mr-1" />Configure Splynx</Button>
          </CardContent>
        </Card>
      )}

      <Tabs value={mainTab} onValueChange={setMainTab}>
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-splynx-overview"><Activity className="w-3 h-3 mr-1" />Service Health</TabsTrigger>
          <TabsTrigger value="nonpayment" data-testid="tab-splynx-nonpayment"><DollarSign className="w-3 h-3 mr-1" />Non-Payment {nonPayment?.total_overdue_count > 0 && <Badge className="ml-1 bg-red-500/20 text-red-400 text-[10px] px-1">{nonPayment.total_overdue_count}</Badge>}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">

      {/* Fleet summary */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <HeroTile label="Service health" value={healthPercent} suffix="%" icon={Activity} glow={healthPercent >= 90 ? "emerald" : healthPercent >= 70 ? "amber" : "rose"} subtitle="Active service coverage" testId="stat-health" />
        <HeroTile label="Linked clients" value={data?.linked_clients || 0} icon={Users} glow="sky" subtitle="Customer profiles mapped" testId="stat-linked" />
        <HeroTile label="Monitored services" value={data?.total_services || 0} icon={Server} glow="indigo" subtitle="Across linked clients" testId="stat-total-services" />
        <HeroTile label="Active services" value={data?.active_services || 0} icon={Wifi} glow="emerald" subtitle="Provider reports active" testId="stat-active-services" />
        <HeroTile label="Suspended" value={data?.suspended_services || 0} icon={WifiOff} glow={(data?.suspended_services || 0) > 0 ? "rose" : "zinc"} subtitle="Requires a review" testId="stat-suspended" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Service Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
                    {pieData.map((entry, i) => <Cell key={`k-${i}`} fill={entry.color} />)}
                  </Pie>
                  <Tooltip formatter={(value) => [value, "Services"]} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-muted-foreground">No service data available</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Services by Type</CardTitle>
          </CardHeader>
          <CardContent>
            {barData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={barData}>
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="Active" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Suspended" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-muted-foreground">No service type data</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Clients Needing Attention */}
      {clientsWithIssues.length > 0 && (
        <Card className="border-red-500/30">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-400" />
              <CardTitle className="text-base text-red-400">Clients Needing Attention ({clientsWithIssues.length})</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {clientsWithIssues.map(client => (
                <button key={client.client_id} type="button" className="flex w-full items-center justify-between rounded-lg border border-red-500/10 bg-red-500/5 px-3 py-2 text-left transition-colors hover:bg-red-500/10" onClick={() => navigate(`/clients?client=${client.client_id}`)} data-testid={`issue-client-${client.client_id}`}>
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-8 rounded-full bg-red-500" />
                    <div>
                      <p className="text-sm font-medium">{client.client_name}</p>
                      <p className="text-xs text-muted-foreground">Splynx ID: {client.splynx_id}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="flex items-center gap-1">
                        <ArrowDownRight className="w-3 h-3 text-red-400" />
                        <span className="text-sm font-bold text-red-400">{client.suspended} suspended</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{client.active} active of {client.total}</p>
                    </div>
                    <div className="flex gap-1">
                      {(client.services || []).map((s, i) => (
                        <div key={`k-${i}`} className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[s.status] || "#6b7280" }}
                          title={`${s.description}: ${s.status}`} />
                      ))}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* All Clients */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">All Linked Clients</CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search clients..." value={search} onChange={e => setSearch(e.target.value)} data-testid="search-clients" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px]">
            <div className="space-y-1">
              {filteredClients.map(client => {
                const healthBar = client.total > 0 ? (client.active / client.total) * 100 : 0;
                return (
                  <button key={client.client_id} type="button" className="flex w-full items-center justify-between rounded-lg border border-transparent px-3 py-3 text-left transition-colors hover:border-border hover:bg-muted/30"
                    onClick={() => navigate(`/clients?client=${client.client_id}`)} data-testid={`client-row-${client.client_id}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-2.5 h-2.5 rounded-full ${client.has_suspended ? "bg-red-500 animate-pulse" : "bg-emerald-500"}`} />
                      <div>
                        <p className="text-sm font-medium">{client.client_name}</p>
                        <p className="text-xs text-muted-foreground">ID: {client.splynx_id}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-emerald-400 border-emerald-500/30 text-[10px]">
                          <CheckCircle className="w-3 h-3 mr-1" />{client.active} active
                        </Badge>
                        {client.suspended > 0 && (
                          <Badge variant="outline" className="text-red-400 border-red-500/30 text-[10px]">
                            <WifiOff className="w-3 h-3 mr-1" />{client.suspended} down
                          </Badge>
                        )}
                      </div>
                      <div className="w-24">
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${healthBar >= 90 ? "bg-emerald-500" : healthBar >= 50 ? "bg-yellow-500" : "bg-red-500"}`}
                            style={{ width: `${healthBar}%` }} />
                        </div>
                        <p className="text-[10px] text-muted-foreground text-right mt-0.5">{Math.round(healthBar)}%</p>
                      </div>
                    </div>
                  </button>
                );
              })}
              {filteredClients.length === 0 && (
                <div className="py-12 text-center text-muted-foreground">
                  {data?.linked_clients === 0
                    ? "No clients linked to Splynx. Link clients in the Clients page."
                    : "No clients match your search."
                  }
                </div>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      </TabsContent>

      {/* NON-PAYMENT TAB */}
      <TabsContent value="nonpayment">
        <div className="space-y-4 mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Non-payment review</p>
              <p className="text-xs text-muted-foreground">Review overdue accounts before any service action is taken.</p>
            </div>
            <Button variant="outline" size="sm" onClick={handleAutoSuspendCheck} className="border-red-500/30 text-red-300 hover:bg-red-500/10" data-testid="auto-suspend-check-btn">
              <ShieldAlert className="w-4 h-4 mr-1" />Run auto-suspend check
            </Button>
          </div>

          {/* Billing exposure */}
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <HeroTile label="Total overdue" value={`$${Number(nonPayment?.total_overdue || 0).toLocaleString()}`} animated={false} icon={DollarSign} glow="rose" subtitle="Across linked accounts" testId="splynx-overdue-total" />
            <HeroTile label="Overdue customers" value={nonPayment?.total_overdue_count || 0} icon={AlertTriangle} glow="amber" subtitle="Require a payment review" testId="splynx-overdue-clients" />
            <HeroTile label="Suspended clients" value={nonPayment?.total_suspended || 0} icon={Ban} glow={(nonPayment?.total_suspended || 0) > 0 ? "rose" : "zinc"} subtitle="Recorded by NexusMSP" testId="splynx-suspended-clients" />
            <HeroTile label="Auto-suspend" value={nonPayment?.auto_suspend_enabled ? "Enabled" : "Off"} animated={false} icon={ShieldAlert} glow={nonPayment?.auto_suspend_enabled ? "sky" : "zinc"} subtitle={`Grace period: ${nonPayment?.grace_days || 14} days`} testId="splynx-auto-suspend" />
          </div>

          {/* Customer Table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><DollarSign className="w-4 h-4 text-red-400" />Overdue customers - payment tracker</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Customer</TableHead><TableHead>Email</TableHead><TableHead className="text-right">Unpaid Invoices</TableHead><TableHead className="text-right">Overdue Amount</TableHead><TableHead>Oldest Due</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {(nonPayment?.customers || []).length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">No overdue customers</TableCell></TableRow>
                  ) : (nonPayment?.customers || []).map(c => (
                    <TableRow key={c.client_id} className={`${c.is_suspended ? "bg-red-500/5" : ""} cursor-pointer hover:bg-muted/40`} onClick={() => navigate(`/clients?client=${c.client_id}`)} data-testid={`np-customer-${c.client_id}`}>
                      <TableCell className="font-medium">{c.client_name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{c.client_email || "-"}</TableCell>
                      <TableCell className="text-right font-mono font-bold text-amber-400">{c.unpaid_invoices}</TableCell>
                      <TableCell className="text-right font-mono font-bold text-red-400">${c.overdue_amount?.toFixed(2)}</TableCell>
                      <TableCell className="text-sm">{c.oldest_due_date || "-"}</TableCell>
                      <TableCell>
                        {c.is_suspended ? (
                          <Badge className="bg-red-500/20 text-red-400 border-red-500/30 animate-pulse"><Ban className="w-3 h-3 mr-1" />Suspended</Badge>
                        ) : (
                          <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30"><AlertTriangle className="w-3 h-3 mr-1" />Overdue</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {c.is_suspended ? (
                          <Button size="sm" variant="outline" className="text-green-400 border-green-500/30 hover:bg-green-500/10" disabled={actionClientId === c.client_id} onClick={(event) => { event.stopPropagation(); handleUnsuspend(c.client_id); }} data-testid={`unsuspend-${c.client_id}`}>
                            {actionClientId === c.client_id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Play className="w-3 h-3 mr-1" />}Unsuspend
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" className="text-red-400 border-red-500/30 hover:bg-red-500/10" disabled={actionClientId === c.client_id} onClick={(event) => { event.stopPropagation(); handleSuspend(c.client_id); }} data-testid={`suspend-${c.client_id}`}>
                            {actionClientId === c.client_id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Ban className="w-3 h-3 mr-1" />}Suspend
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="border-blue-500/20">
            <CardContent className="py-3 px-4">
              <p className="text-xs text-muted-foreground">
                <strong>How it works:</strong> Non-payment data is synced from Splynx invoices. When auto-suspend is enabled,
                customers past the grace period are automatically suspended in Splynx and notifications are sent to admins.
                Grace period: <strong>{nonPayment?.grace_days || 14} days</strong>.
              </p>
            </CardContent>
          </Card>
        </div>
      </TabsContent>
      </Tabs>

      {/* SUSPEND SETTINGS DIALOG */}
      <Dialog open={settingsDialog} onOpenChange={setSettingsDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Settings className="w-5 h-5" />Auto-Suspend Settings</DialogTitle></DialogHeader>
          {suspendSettings && (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/20">
                <div><Label>Auto-Suspend Enabled</Label><p className="text-xs text-muted-foreground">Automatically suspend overdue customers past grace period</p></div>
                <Switch checked={suspendSettings.auto_suspend_enabled || false} onCheckedChange={v => setSuspendSettings({ ...suspendSettings, auto_suspend_enabled: v })} data-testid="auto-suspend-toggle" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Grace Period (days)</Label><Input type="number" value={suspendSettings.grace_days || 14} onChange={e => setSuspendSettings({ ...suspendSettings, grace_days: parseInt(e.target.value) || 14 })} data-testid="grace-days-input" /></div>
                <div><Label>Warn Before (days)</Label><Input type="number" value={suspendSettings.notify_before_suspend_days || 7} onChange={e => setSuspendSettings({ ...suspendSettings, notify_before_suspend_days: parseInt(e.target.value) || 7 })} /></div>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/20">
                <div><Label>Notify Client</Label><p className="text-xs text-muted-foreground">Send notification to client before suspension</p></div>
                <Switch checked={suspendSettings.notify_client || false} onCheckedChange={v => setSuspendSettings({ ...suspendSettings, notify_client: v })} />
              </div>
            </div>
          )}
          <DialogFooter><Button onClick={handleSaveSuspendSettings} data-testid="save-suspend-settings"><CheckCircle className="w-4 h-4 mr-1" />Save Settings</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
