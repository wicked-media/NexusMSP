import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Activity, Heart, Shield, Monitor, DollarSign, AlertTriangle, TrendingUp,
  TrendingDown, Users, RefreshCw, Loader2, ChevronRight, ChevronDown, ChevronUp,
  Target, Zap, Bell, Settings, Camera, ArrowUp, ArrowDown, Check, X,
  HardDrive, Ticket, CreditCard, Lock, Search, FileText, Wifi
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from "recharts";

const chartStyle = { backgroundColor: "hsl(217, 33%, 17%)", border: "1px solid hsl(217, 33%, 25%)", borderRadius: "8px", color: "hsl(210, 40%, 98%)" };

const STATUS_CONFIG = {
  thriving: { color: "bg-emerald-500/20 text-emerald-400", ring: "ring-emerald-500/30", gradient: "from-emerald-500 to-emerald-600", label: "Thriving" },
  healthy: { color: "bg-blue-500/20 text-blue-400", ring: "ring-blue-500/30", gradient: "from-blue-500 to-blue-600", label: "Healthy" },
  needs_attention: { color: "bg-amber-500/20 text-amber-400", ring: "ring-amber-500/30", gradient: "from-amber-500 to-amber-600", label: "Needs Attention" },
  at_risk: { color: "bg-orange-500/20 text-orange-400", ring: "ring-orange-500/30", gradient: "from-orange-500 to-orange-600", label: "At Risk" },
  critical: { color: "bg-red-500/20 text-red-400", ring: "ring-red-500/30", gradient: "from-red-500 to-red-600", label: "Critical" },
};

function HealthGauge({ score, size = 64 }) {
  const color = score >= 85 ? "#22c55e" : score >= 70 ? "#3b82f6" : score >= 50 ? "#eab308" : score >= 30 ? "#f97316" : "#ef4444";
  const pct = Math.min(100, Math.max(0, score));
  const r = (size / 2) - 6;
  const dash = pct * 2.51;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg className="-rotate-90" width={size} height={size} viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" className="text-muted/15" strokeWidth="7" />
        <circle cx="50" cy="50" r="40" fill="none" stroke={color} strokeWidth="7" strokeDasharray={`${dash} ${251 - dash}`} strokeLinecap="round" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-lg font-black" style={{ color }}>{score}</span>
    </div>
  );
}

function MetricBar({ label, value, icon: Icon, color }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`w-7 h-7 rounded-md flex items-center justify-center ${color.split(" ")[0]}`}><Icon className={`w-3.5 h-3.5 ${color.split(" ")[1]}`} /></div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5"><span className="text-[11px] text-muted-foreground">{label}</span><span className="text-xs font-bold">{value}</span></div>
        <Progress value={value} className="h-1" />
      </div>
    </div>
  );
}

export default function ClientHealthPage() {
  const { token } = useAuth();
  const [dashboard, setDashboard] = useState(null);
  const [allScores, setAllScores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedClient, setSelectedClient] = useState(null);
  const [clientDetail, setClientDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [settingsDialog, setSettingsDialog] = useState(false);
  const [alertConfig, setAlertConfig] = useState(null);
  const [snapshotting, setSnapshotting] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [dRes, sRes] = await Promise.all([
        axios.get(`${API}/client-health/dashboard`, { headers }),
        axios.get(`${API}/client-health/scores`, { headers }),
      ]);
      setDashboard(dRes.data);
      setAllScores(sRes.data);
    } catch { toast.error("Failed to load health data"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const loadClientDetail = async (clientId) => {
    setDetailLoading(true);
    try {
      const res = await axios.get(`${API}/client-health/${clientId}/detail`, { headers });
      setClientDetail(res.data);
    } catch { toast.error("Failed to load client detail"); }
    finally { setDetailLoading(false); }
  };

  const handleSnapshot = async () => {
    setSnapshotting(true);
    try {
      const res = await axios.post(`${API}/client-health/snapshot`, {}, { headers });
      toast.success(res.data.message);
    } catch { toast.error("Failed to take snapshot"); }
    finally { setSnapshotting(false); }
  };

  const loadAlertConfig = async () => {
    try { const r = await axios.get(`${API}/client-health/alert-config`, { headers }); setAlertConfig(r.data); }
    catch { setAlertConfig({ critical_threshold: 30, warning_threshold: 50, notify_on_decline: true, decline_amount: 10, notify_email: "", auto_create_ticket: true }); }
  };

  const saveAlertConfig = async () => {
    try { await axios.put(`${API}/client-health/alert-config`, alertConfig, { headers }); toast.success("Alert settings saved"); setSettingsDialog(false); }
    catch { toast.error("Failed"); }
  };

  if (loading || !dashboard) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const d = dashboard;
  const dist = d.distribution || {};
  const filtered = allScores.filter(c => {
    if (statusFilter !== "all" && c.status !== statusFilter) return false;
    if (search && !c.client_name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const radarData = clientDetail ? [
    { metric: "Tickets", value: clientDetail.metrics?.ticket_health || 0 },
    { metric: "Devices", value: clientDetail.metrics?.device_health || 0 },
    { metric: "Payments", value: clientDetail.metrics?.payment_health || 0 },
    { metric: "Backups", value: clientDetail.metrics?.backup_health || 0 },
    { metric: "Security", value: clientDetail.metrics?.security_health || 0 },
    { metric: "Engagement", value: clientDetail.metrics?.engagement || 0 },
    ...(clientDetail.metrics?.network_health != null ? [{ metric: "Network", value: clientDetail.metrics.network_health }] : []),
    ...(clientDetail.metrics?.m365_hygiene != null ? [{ metric: "M365", value: clientDetail.metrics.m365_hygiene }] : []),
  ] : [];

  return (
    <div className="space-y-5" data-testid="client-health-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-600 flex items-center justify-center"><Heart className="w-5 h-5 text-white" /></div>
            Client Health Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">{d.total} clients monitored | Average health: <span className={`font-bold ${d.avg_health >= 70 ? "text-emerald-400" : d.avg_health >= 50 ? "text-amber-400" : "text-red-400"}`}>{d.avg_health}/100</span></p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { loadAlertConfig(); setSettingsDialog(true); }} data-testid="alert-settings-btn"><Bell className="w-4 h-4 mr-1" />Alert Settings</Button>
          <Button variant="outline" size="sm" onClick={handleSnapshot} disabled={snapshotting} data-testid="take-snapshot-btn">
            {snapshotting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Camera className="w-4 h-4 mr-1" />}Snapshot
          </Button>
          <Button variant="outline" size="sm" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-7 gap-3">
        <Card className="col-span-2 border-border/40">
          <CardContent className="pt-4 pb-3 flex items-center gap-4">
            <HealthGauge score={d.avg_health} size={72} />
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Average Health</p>
              <p className="text-2xl font-bold">{d.avg_health}<span className="text-sm text-muted-foreground">/100</span></p>
              <p className="text-xs text-muted-foreground">{d.total} clients</p>
            </div>
          </CardContent>
        </Card>
        {["thriving", "healthy", "needs_attention", "at_risk", "critical"].map(s => {
          const cfg = STATUS_CONFIG[s];
          const count = dist[s] || 0;
          return (
            <Card key={s} className={`border-border/40 cursor-pointer transition-all hover:ring-1 ${cfg.ring} ${statusFilter === s ? "ring-1 " + cfg.ring : ""}`}
              onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{cfg.label}</p>
                </div>
                <p className={`text-2xl font-bold ${cfg.color.split(" ")[1]}`}>{count}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Revenue Alert */}
      {d.at_risk_revenue > 0 && (
        <Card className="border-red-500/20 bg-red-500/5">
          <CardContent className="py-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center"><DollarSign className="w-5 h-5 text-red-400" /></div>
            <div className="flex-1">
              <p className="text-sm font-bold text-red-400">${d.at_risk_revenue?.toLocaleString()} Monthly Revenue at Risk</p>
              <p className="text-xs text-muted-foreground">{(d.at_risk || []).length} clients with health below 50 — proactive outreach recommended</p>
            </div>
            <Badge className="bg-red-500/20 text-red-400">{((d.at_risk_revenue / Math.max(d.total_monthly_revenue, 1)) * 100).toFixed(1)}% of MRR</Badge>
          </CardContent>
        </Card>
      )}

      {/* Active Alerts */}
      {(d.alerts || []).length > 0 && (
        <Card className="border-amber-500/20">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-400" />Active Health Alerts ({d.alerts.length})</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {d.alerts.slice(0, 6).map(a => (
                <div key={a.id} className={`p-2.5 rounded-lg border ${a.severity === "critical" ? "bg-red-500/5 border-red-500/20" : "bg-amber-500/5 border-amber-500/20"} cursor-pointer hover:ring-1 ring-border/40`}
                  onClick={() => { setSelectedClient(allScores.find(s => s.client_id === a.client_id)); loadClientDetail(a.client_id); }}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold">{a.client_name}</span>
                    <Badge className={`text-[9px] ${a.severity === "critical" ? "bg-red-500/20 text-red-400" : "bg-amber-500/20 text-amber-400"}`}>{a.health_score}</Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">{a.message}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-[1fr_380px] gap-4">
        {/* Left: Client Table */}
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="relative flex-1"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input placeholder="Search clients..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" data-testid="health-search" /></div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Statuses</SelectItem>{Object.entries(STATUS_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <Card>
            <CardContent className="p-0">
              <ScrollArea className="h-[520px]">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Client</TableHead><TableHead>Health</TableHead><TableHead>Status</TableHead><TableHead className="text-center">Tickets</TableHead><TableHead className="text-center">Devices</TableHead><TableHead className="text-right">MRR</TableHead><TableHead>Risk Factors</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map(c => {
                      const cfg = STATUS_CONFIG[c.status] || STATUS_CONFIG.needs_attention;
                      const isSelected = selectedClient?.client_id === c.client_id;
                      return (
                        <TableRow key={c.client_id} className={`cursor-pointer transition-all ${isSelected ? "bg-primary/5 ring-1 ring-primary/20" : "hover:bg-muted/30"}`}
                          onClick={() => { setSelectedClient(c); loadClientDetail(c.client_id); }} data-testid={`health-row-${c.client_id}`}>
                          <TableCell>
                            <div className="font-medium text-sm">{c.client_name}</div>
                            {c.tier && <Badge variant="outline" className="text-[9px] mt-0.5">{c.tier}</Badge>}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2 w-20">
                              <Progress value={c.health_score} className="h-2" />
                              <span className="text-xs font-mono font-bold">{c.health_score}</span>
                            </div>
                          </TableCell>
                          <TableCell><Badge className={`${cfg.color} text-[10px]`}>{cfg.label}</Badge></TableCell>
                          <TableCell className="text-center">
                            <span className="text-xs font-mono">{c.details?.open_tickets || 0}</span>
                            {c.details?.critical_tickets > 0 && <span className="text-[9px] text-red-400 ml-0.5">({c.details.critical_tickets}!)</span>}
                          </TableCell>
                          <TableCell className="text-center text-xs font-mono">{c.details?.online_devices || 0}/{c.details?.devices || 0}</TableCell>
                          <TableCell className="text-right text-xs font-mono">${(c.mrr || 0).toLocaleString()}</TableCell>
                          <TableCell>
                            <div className="flex gap-0.5">
                              {(c.risk_factors || []).slice(0, 2).map((rf, i) => (
                                <Badge key={i} className={`text-[8px] ${rf.severity === "critical" ? "bg-red-500/20 text-red-400" : "bg-amber-500/20 text-amber-400"}`}>{rf.factor.slice(0, 25)}</Badge>
                              ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Right: Client Detail Panel */}
        <div className="space-y-3">
          {!selectedClient ? (
            <Card className="border-dashed h-full flex items-center justify-center">
              <CardContent className="text-center py-16">
                <Heart className="w-12 h-12 mx-auto text-muted-foreground/20 mb-3" />
                <p className="font-medium">Select a Client</p>
                <p className="text-xs text-muted-foreground mt-1">Click a client row to view detailed health breakdown</p>
              </CardContent>
            </Card>
          ) : detailLoading ? (
            <Card className="h-full flex items-center justify-center"><CardContent><Loader2 className="w-8 h-8 animate-spin mx-auto" /></CardContent></Card>
          ) : clientDetail ? (
            <>
              <Card className={`border-border/40 ring-1 ${STATUS_CONFIG[clientDetail.status]?.ring || ""}`}>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-3 mb-3">
                    <HealthGauge score={clientDetail.health_score} size={56} />
                    <div className="flex-1">
                      <h3 className="font-bold text-lg">{clientDetail.client_name}</h3>
                      <div className="flex items-center gap-2">
                        <Badge className={STATUS_CONFIG[clientDetail.status]?.color + " text-[10px]"}>{STATUS_CONFIG[clientDetail.status]?.label}</Badge>
                        {clientDetail.tier && <Badge variant="outline" className="text-[9px]">{clientDetail.tier}</Badge>}
                        {clientDetail.industry && <Badge variant="outline" className="text-[9px]">{clientDetail.industry}</Badge>}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold">${(clientDetail.mrr || 0).toLocaleString()}</p>
                      <p className="text-[10px] text-muted-foreground">MRR</p>
                    </div>
                  </div>

                  {/* Radar Chart */}
                  <div className="h-[180px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={radarData} cx="50%" cy="50%" outerRadius={65}>
                        <PolarGrid stroke="hsl(var(--border))" />
                        <PolarAngleAxis dataKey="metric" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                        <Radar name="Health" dataKey="value" stroke="#06b6d4" fill="#06b6d4" fillOpacity={0.15} strokeWidth={2} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* Metric Breakdown */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Health Breakdown</CardTitle></CardHeader>
                <CardContent className="space-y-2.5">
                  <MetricBar label="Ticket Health" value={clientDetail.metrics?.ticket_health || 0} icon={Ticket} color="bg-blue-500/15 text-blue-400" />
                  <MetricBar label="Device Uptime" value={clientDetail.metrics?.device_health || 0} icon={Monitor} color="bg-cyan-500/15 text-cyan-400" />
                  <MetricBar label="Payment Health" value={clientDetail.metrics?.payment_health || 0} icon={CreditCard} color="bg-emerald-500/15 text-emerald-400" />
                  <MetricBar label="Backup Health" value={clientDetail.metrics?.backup_health || 0} icon={HardDrive} color="bg-purple-500/15 text-purple-400" />
                  <MetricBar label="Security Posture" value={clientDetail.metrics?.security_health || 0} icon={Shield} color="bg-red-500/15 text-red-400" />
                  {clientDetail.metrics?.network_health != null && (
                    <MetricBar label="Network Health" value={clientDetail.metrics.network_health} icon={Wifi} color="bg-indigo-500/15 text-indigo-400" />
                  )}
                  {clientDetail.metrics?.m365_hygiene != null && (
                    <MetricBar label="M365 Hygiene" value={clientDetail.metrics.m365_hygiene} icon={Lock} color="bg-sky-500/15 text-sky-400" />
                  )}
                  <MetricBar label="Engagement" value={clientDetail.metrics?.engagement || 0} icon={Activity} color="bg-amber-500/15 text-amber-400" />
                </CardContent>
              </Card>

              {/* Risk / Positive Factors */}
              {(clientDetail.risk_factors?.length > 0 || clientDetail.positive_factors?.length > 0) && (
                <Card>
                  <CardContent className="pt-3 pb-3 space-y-2">
                    {clientDetail.risk_factors?.map((rf, i) => (
                      <div key={`r-${i}`} className="flex items-center gap-2 text-xs">
                        <AlertTriangle className={`w-3 h-3 flex-shrink-0 ${rf.severity === "critical" ? "text-red-400" : "text-amber-400"}`} />
                        <span className="flex-1">{rf.factor}</span>
                        <Badge className={`text-[8px] ${rf.severity === "critical" ? "bg-red-500/20 text-red-400" : "bg-amber-500/20 text-amber-400"}`}>{rf.impact}</Badge>
                      </div>
                    ))}
                    {clientDetail.positive_factors?.map((pf, i) => (
                      <div key={`p-${i}`} className="flex items-center gap-2 text-xs">
                        <Check className="w-3 h-3 flex-shrink-0 text-emerald-400" />
                        <span className="flex-1">{pf.factor}</span>
                        <Badge className="text-[8px] bg-emerald-500/20 text-emerald-400">{pf.impact}</Badge>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Key Stats */}
              <Card>
                <CardContent className="pt-3 pb-3">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {[
                      { label: "Open Tickets", val: clientDetail.details?.open_tickets || 0, color: "text-amber-400" },
                      { label: "Devices Online", val: `${clientDetail.details?.online_devices || 0}/${clientDetail.details?.devices || 0}`, color: "text-cyan-400" },
                      { label: "Backup Rate", val: `${clientDetail.details?.backup_success_rate || 0}%`, color: "text-purple-400" },
                      { label: "Overdue Invoices", val: clientDetail.details?.overdue_invoices || 0, color: "text-red-400" },
                      { label: "Security Alerts", val: clientDetail.details?.security_alerts || 0, color: "text-red-400" },
                      { label: "Expiring Contracts", val: clientDetail.details?.expiring_contracts || 0, color: "text-amber-400" },
                    ].map(s => (
                      <div key={s.label} className="p-2 rounded-lg bg-muted/10">
                        <p className={`text-base font-bold ${s.color}`}>{s.val}</p>
                        <p className="text-[9px] text-muted-foreground">{s.label}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          ) : null}
        </div>
      </div>

      {/* Alert Settings Dialog */}
      <Dialog open={settingsDialog} onOpenChange={setSettingsDialog}>
        <DialogContent aria-describedby="alert-config-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Bell className="w-5 h-5 text-amber-400" />Health Alert Settings</DialogTitle>
            <DialogDescription id="alert-config-desc">Configure thresholds and notification rules for client health monitoring</DialogDescription>
          </DialogHeader>
          {alertConfig && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs">Critical Threshold (score below)</Label><Input type="number" value={alertConfig.critical_threshold} onChange={e => setAlertConfig({ ...alertConfig, critical_threshold: parseInt(e.target.value) })} /></div>
                <div><Label className="text-xs">Warning Threshold (score below)</Label><Input type="number" value={alertConfig.warning_threshold} onChange={e => setAlertConfig({ ...alertConfig, warning_threshold: parseInt(e.target.value) })} /></div>
              </div>
              <Separator />
              <div className="space-y-3">
                <div className="flex items-center justify-between"><div><Label className="text-sm">Notify on Score Decline</Label><p className="text-[11px] text-muted-foreground">Alert when any client's health drops by this amount</p></div><Switch checked={alertConfig.notify_on_decline} onCheckedChange={v => setAlertConfig({ ...alertConfig, notify_on_decline: v })} /></div>
                {alertConfig.notify_on_decline && <div><Label className="text-xs">Decline Amount</Label><Input type="number" value={alertConfig.decline_amount} onChange={e => setAlertConfig({ ...alertConfig, decline_amount: parseInt(e.target.value) })} className="max-w-[100px]" /></div>}
                <div className="flex items-center justify-between"><div><Label className="text-sm">Auto-Create Ticket</Label><p className="text-[11px] text-muted-foreground">Automatically create a ticket when health drops below critical</p></div><Switch checked={alertConfig.auto_create_ticket} onCheckedChange={v => setAlertConfig({ ...alertConfig, auto_create_ticket: v })} /></div>
              </div>
              <div><Label className="text-xs">Notification Email</Label><Input value={alertConfig.notify_email || ""} onChange={e => setAlertConfig({ ...alertConfig, notify_email: e.target.value })} placeholder="alerts@company.com" /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsDialog(false)}>Cancel</Button>
            <Button onClick={saveAlertConfig} data-testid="save-alert-config"><Check className="w-4 h-4 mr-1" />Save Settings</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
