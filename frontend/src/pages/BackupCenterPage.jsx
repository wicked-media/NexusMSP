import { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  HardDrive, CheckCircle, XCircle, Clock, AlertTriangle, Search, RefreshCw, Loader2,
  Shield, Database, Play, Activity, ExternalLink, Zap, Cloud, Wifi, WifiOff,
  Ghost, Skull, AlertCircle, Sparkles, Pause, RotateCw, Eye, Settings,
  Server, ArrowUpRight, Trash2, FileQuestion, Bell, StopCircle, Wand2,
  Users, DollarSign,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import ChangePlanDialog from "@/components/backups/ChangePlanDialog";
import TenantsTab from "@/components/backups/TenantsTab";
import BackupStatusTab from "@/components/backups/BackupStatusTab";
import BillingTab from "@/components/backups/BillingTab";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";

const STATUS_ICON = { success: CheckCircle, failed: XCircle, running: Clock, warning: AlertTriangle };
const STATUS_COLOR = { success: "text-emerald-400 bg-emerald-500/10", failed: "text-red-400 bg-red-500/10", running: "text-blue-400 bg-blue-500/10", warning: "text-amber-400 bg-amber-500/10" };
const complianceColors = { compliant: "default", non_compliant: "destructive", no_backup: "outline" };

/** ── Animated counter — ticks up to target value ── */
function AnimatedCounter({ value, suffix = "", duration = 800 }) {
  const [display, setDisplay] = useState(0);
  const startRef = useRef(null);
  useEffect(() => {
    startRef.current = null;
    const start = display;
    const target = Number(value) || 0;
    const raf = (ts) => {
      if (!startRef.current) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const progress = Math.min(1, elapsed / duration);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(start + (target - start) * eased));
      if (progress < 1) requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return <>{display}{suffix}</>;
}

/** ── Live running-backup card with animated progress ring + shimmer ── */
function RunningBackupCard({ activity, onCancel }) {
  const pct = Math.max(0, Math.min(100, Math.round(activity.progress || 0)));
  const transferred = activity.transferred_bytes ? (activity.transferred_bytes / 1e9).toFixed(2) : null;
  const total = activity.total_bytes ? (activity.total_bytes / 1e9).toFixed(2) : null;
  const speedMB = activity.speed_bps ? (activity.speed_bps / 1e6).toFixed(1) : null;
  const canCancel = activity.policy_id && (activity.resource_id || (activity.context && activity.context.id));

  return (
    <Card className="relative overflow-hidden border-cyan-500/40 bg-gradient-to-br from-cyan-500/[0.06] via-blue-500/[0.04] to-violet-500/[0.06]" data-testid={`running-backup-${activity.id}`}>
      {/* Shimmer line */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-400 to-transparent animate-pulse" />
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {/* Animated ring */}
          <div className="relative w-14 h-14 flex-shrink-0">
            <svg viewBox="0 0 56 56" className="w-14 h-14 -rotate-90">
              <circle cx="28" cy="28" r="24" stroke="currentColor" strokeWidth="3" fill="none" className="text-muted/20" />
              <circle
                cx="28" cy="28" r="24" stroke="url(#grad-cyan)" strokeWidth="3" fill="none"
                strokeDasharray={`${(pct / 100) * 150.8} 150.8`}
                strokeLinecap="round"
                className="transition-all duration-700"
              />
              <defs>
                <linearGradient id="grad-cyan" x1="0" x2="1" y1="0" y2="1">
                  <stop offset="0%" stopColor="#22d3ee" />
                  <stop offset="100%" stopColor="#7c3aed" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[11px] font-bold font-mono text-cyan-300">{pct}%</span>
            </div>
            {/* Pulsing dot */}
            <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />
            <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-cyan-400" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-sm font-semibold truncate">{activity.resource_name || "Unknown"}</span>
              <Badge variant="outline" className="text-[9px] border-cyan-500/40 text-cyan-300">
                {(activity.activity_type || "backup").replace("_", " ")}
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground truncate">{activity.plan_name || "Backup plan"}</p>

            {activity.phase && (
              <p className="text-[10px] text-cyan-300/80 font-mono mt-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse mr-1" />
                {activity.phase}
              </p>
            )}

            {/* CRT-style scrolling stats */}
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-mono text-muted-foreground/80">
              {transferred && total && <span>📦 {transferred}/{total} GB</span>}
              {speedMB && <span>⚡ {speedMB} MB/s</span>}
              {activity.tenant_name && <span className="truncate max-w-[140px]">🏢 {activity.tenant_name}</span>}
            </div>

            {/* Progress bar with shimmer */}
            <div className="mt-2 h-1 rounded-full bg-muted/30 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cyan-400 via-blue-400 to-violet-400 transition-all duration-700 relative"
                style={{ width: `${pct}%` }}
              >
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-pulse" />
              </div>
            </div>

            {/* Action buttons */}
            <div className="mt-2 flex items-center justify-end gap-1">
              {canCancel && onCancel && (
                <Button
                  variant="ghost" size="sm"
                  className="h-6 px-2 text-[10px] text-rose-300 hover:bg-rose-500/15 hover:text-rose-200"
                  onClick={() => onCancel(activity)}
                  title="Stop this backup (Acronis: cancel run)"
                  data-testid={`cancel-backup-${activity.id}`}
                >
                  <StopCircle className="w-3 h-3 mr-1" />Stop
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** ── Hero metric tile with glow ── */
function HeroMetric({ label, value, icon: Icon, glow = "cyan", suffix = "", subtitle, animated = true }) {
  const glowMap = {
    cyan: "from-cyan-500/20 to-blue-600/10 border-cyan-500/30 text-cyan-300 shadow-cyan-500/20",
    emerald: "from-emerald-500/20 to-green-600/10 border-emerald-500/30 text-emerald-300 shadow-emerald-500/20",
    rose: "from-rose-500/20 to-red-600/10 border-rose-500/30 text-rose-300 shadow-rose-500/20",
    amber: "from-amber-500/20 to-orange-600/10 border-amber-500/30 text-amber-300 shadow-amber-500/20",
    violet: "from-violet-500/20 to-fuchsia-600/10 border-violet-500/30 text-violet-300 shadow-violet-500/20",
  };
  return (
    <Card className={`relative overflow-hidden border bg-gradient-to-br ${glowMap[glow]} shadow-lg`}>
      <div className="absolute -top-6 -right-6 w-20 h-20 rounded-full bg-current opacity-10 blur-2xl" />
      <CardContent className="p-4 relative">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] uppercase tracking-widest font-semibold opacity-80">{label}</span>
          <Icon className="w-4 h-4 opacity-80" />
        </div>
        <p className="text-3xl font-bold tracking-tighter font-mono">
          {animated ? <AnimatedCounter value={typeof value === "number" ? value : 0} suffix={suffix} /> : value}
        </p>
        {subtitle && <p className="text-[10px] opacity-70 mt-0.5">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}

export default function BackupCenterPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [tab, setTab] = useState("dashboard");
  const [dashData, setDashData] = useState(null);
  const [compData, setCompData] = useState(null);
  const [verifyData, setVerifyData] = useState(null);
  const [acronisUsage, setAcronisUsage] = useState(null);
  const [agentsHealth, setAgentsHealth] = useState(null);
  const [acronisAlerts, setAcronisAlerts] = useState([]);
  const [orphans, setOrphans] = useState(null);
  const [liveActivities, setLiveActivities] = useState({ running: [], recent: [], stats: {} });
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [planTargets, setPlanTargets] = useState([]);
  const [selectedOrphans, setSelectedOrphans] = useState([]);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [backupStatuses, setBackupStatuses] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [dash, comp, verify, usage, agents, alerts] = await Promise.allSettled([
        axios.get(`${API}/backup-dashboard/overview`, { headers }),
        axios.get(`${API}/backup-compliance/dashboard`, { headers }),
        axios.get(`${API}/backup-verify/overview`, { headers }),
        axios.get(`${API}/acronis/usage-summary`, { headers }),
        axios.get(`${API}/acronis/agents/health`, { headers }),
        axios.get(`${API}/acronis/alerts`, { headers }),
      ]);
      // Map jobs to backups for compatibility
      if (dash.status === "fulfilled") {
        const d = dash.value.data;
        setDashData({ summary: d.summary, backups: d.jobs || [] });
      }
      if (comp.status === "fulfilled") setCompData(comp.value.data);
      if (verify.status === "fulfilled") setVerifyData(verify.value.data);
      if (usage.status === "fulfilled") setAcronisUsage(usage.value.data);
      if (agents.status === "fulfilled") setAgentsHealth(agents.value.data);
      if (alerts.status === "fulfilled") setAcronisAlerts(alerts.value.data?.items || []);
    } catch { toast.error("Failed to load backup data"); }
    finally { setLoading(false); }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch live activities every 5s when on Live tab
  const fetchLive = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/acronis/live-activities`, { headers });
      setLiveActivities(r.data || { running: [], recent: [], stats: {} });
    } catch { /* silent */ }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData(); fetchLive(); }, [fetchData, fetchLive]);
  useEffect(() => {
    if (tab !== "live") return;
    const id = setInterval(fetchLive, 5000);
    return () => clearInterval(id);
  }, [tab, fetchLive]);

  const handleScanOrphans = async () => {
    setScanning(true);
    try {
      const r = await axios.get(`${API}/acronis/orphans?stale_days=30`, { headers });
      setOrphans(r.data);
      toast.success(`Scan complete · ${r.data?.totals?.total_orphans || 0} orphan items found`);
    } catch (e) { toast.error(e.response?.data?.detail || "Orphan scan failed"); }
    finally { setScanning(false); }
  };

  const handleDismissAlert = async (alertId) => {
    try {
      await axios.post(`${API}/acronis/alerts/${alertId}/dismiss`, {}, { headers });
      setAcronisAlerts(prev => prev.filter(a => a.id !== alertId));
      toast.success("Alert dismissed");
    } catch (e) { toast.error(e.response?.data?.detail || "Dismiss failed"); }
  };

  const handleOpenAcronis = async (resourceId, alertId) => {
    try {
      const r = await axios.get(`${API}/acronis/console-link`, {
        params: { resource_id: resourceId || "", alert_id: alertId || "" },
        headers,
      });
      if (r.data?.url) window.open(r.data.url, "_blank");
      else toast.error("Acronis console URL not available");
    } catch { toast.error("Failed to open console"); }
  };

  const handleCancelBackup = async (activity) => {
    if (!activity.policy_id || !activity.resource_id) {
      toast.error("Missing policy or resource id — cannot cancel");
      return;
    }
    setCancelTarget(activity);
  };

  const confirmCancelBackup = async () => {
    const activity = cancelTarget;
    if (!activity) return;
    try {
      await axios.post(
        `${API}/acronis/backup/cancel`,
        { policy_id: activity.policy_id, resource_ids: [activity.resource_id] },
        { headers },
      );
      toast.success(`Stopping backup for ${activity.resource_name}`);
      setTimeout(fetchLive, 2000);
    } catch (e) { toast.error(e.response?.data?.detail || "Cancel failed"); }
    finally { setCancelTarget(null); }
  };

  const openApplyPlan = (resources) => {
    if (!resources || resources.length === 0) {
      toast.error("No resources selected");
      return;
    }
    setPlanTargets(resources);
    setPlanDialogOpen(true);
  };

  const toggleOrphanSelection = (resource) => {
    setSelectedOrphans(prev => {
      const exists = prev.find(r => (r.resource_id || r.id) === (resource.resource_id || resource.id));
      return exists
        ? prev.filter(r => (r.resource_id || r.id) !== (resource.resource_id || resource.id))
        : [...prev, resource];
    });
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const ds = dashData?.summary || {};
  const cs = compData?.stats || {};
  const vs = verifyData?.summary || {};
  const ah = agentsHealth?.summary || {};
  const liveCount = liveActivities.running?.length || 0;

  return (
    <div className="space-y-5" data-testid="backup-center-page">
      {/* Hero */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-cyan-500 via-blue-600 to-violet-700 flex items-center justify-center shadow-lg shadow-cyan-500/30">
              <HardDrive className="w-5 h-5 text-white" />
            </div>
            Backup Command Center
            {liveCount > 0 && (
              <Badge className="bg-cyan-500/20 text-cyan-300 border-cyan-500/40 animate-pulse gap-1">
                <Activity className="w-3 h-3" />
                {liveCount} running
              </Badge>
            )}
          </h1>
          <p className="text-muted-foreground mt-1 flex items-center gap-2">
            <Cloud className="w-3.5 h-3.5 text-cyan-400" />
            Acronis-powered · live monitoring · orphan detection · restore verification
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => handleOpenAcronis()} data-testid="open-acronis-console">
            <ExternalLink className="w-4 h-4 mr-2" />Open Acronis Cloud
          </Button>
          <Button variant="outline" onClick={() => { fetchData(); fetchLive(); }}>
            <RefreshCw className="w-4 h-4 mr-2" />Refresh
          </Button>
        </div>
      </div>

      {/* Hero metric strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <HeroMetric label="Total Backups" value={ds.total_jobs || 0} icon={Database} glow="cyan" subtitle="all machines · Acronis" />
        <HeroMetric label="Successful" value={ds.successful || 0} icon={CheckCircle} glow="emerald" subtitle={`${ds.success_rate || 0}% success rate`} />
        <HeroMetric label="Failed" value={ds.failed || 0} icon={XCircle} glow="rose" subtitle={ds.failed ? "needs attention" : "all healthy"} />
        <HeroMetric label="Running" value={liveCount} icon={Activity} glow="violet" subtitle="live now" />
        <HeroMetric label="Online Agents" value={ah.online || 0} icon={Wifi} glow="emerald" subtitle={`${ah.online_pct || 0}% of ${ah.total || 0}`} />
        <HeroMetric label="Active Alerts" value={acronisAlerts.length} icon={Bell} glow={acronisAlerts.length > 0 ? "amber" : "cyan"} subtitle={acronisUsage?.critical_alerts ? `${acronisUsage.critical_alerts} critical` : "Acronis"} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap h-auto gap-1 max-w-full">
          <TabsTrigger value="dashboard" data-testid="tab-dashboard">
            <Database className="w-3.5 h-3.5 mr-1" />Dashboard
          </TabsTrigger>
          <TabsTrigger value="live" data-testid="tab-live" className="relative">
            <Activity className="w-3.5 h-3.5 mr-1" />Live
            {liveCount > 0 && <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />}
          </TabsTrigger>
          <TabsTrigger value="tenants" data-testid="tab-tenants">
            <Users className="w-3.5 h-3.5 mr-1" />Tenants
          </TabsTrigger>
          <TabsTrigger value="status" data-testid="tab-status">
            <Server className="w-3.5 h-3.5 mr-1" />Backup Status
          </TabsTrigger>
          <TabsTrigger value="acronis" data-testid="tab-acronis">
            <Cloud className="w-3.5 h-3.5 mr-1" />Acronis Console
          </TabsTrigger>
          <TabsTrigger value="orphans" data-testid="tab-orphans">
            <Ghost className="w-3.5 h-3.5 mr-1" />Orphans
            {orphans && orphans.totals?.total_orphans > 0 && (
              <Badge variant="destructive" className="ml-1.5 h-4 text-[9px] px-1">{orphans.totals.total_orphans}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="compliance" data-testid="tab-compliance">
            <Shield className="w-3.5 h-3.5 mr-1" />Compliance
          </TabsTrigger>
          <TabsTrigger value="billing" data-testid="tab-billing">
            <DollarSign className="w-3.5 h-3.5 mr-1" />Billing
          </TabsTrigger>
          <TabsTrigger value="verify" data-testid="tab-verify">
            <CheckCircle className="w-3.5 h-3.5 mr-1" />Verify
          </TabsTrigger>
        </TabsList>

        {/* DASHBOARD */}
        <TabsContent value="dashboard" className="mt-4 space-y-4">
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search backups..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="running">Running</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Tenant</TableHead><TableHead>Machine</TableHead><TableHead>Plan</TableHead><TableHead>Last Backup</TableHead><TableHead>Next Run</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(dashData?.backups || []).length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-12">
                      <Cloud className="w-10 h-10 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">No backup data from Acronis yet.</p>
                      <p className="text-[11px] mt-1 opacity-70">Once Acronis returns resource statuses, machines and their plans will appear here in real time.</p>
                    </TableCell></TableRow>
                  )}
                  {(dashData?.backups || []).filter(b => (statusFilter === "all" || b.status === statusFilter) && (!search || b.client_name?.toLowerCase().includes(search.toLowerCase()) || b.device_name?.toLowerCase().includes(search.toLowerCase()))).map((b, i) => {
                    const Ico = STATUS_ICON[b.status] || Clock;
                    return (
                      <TableRow key={`k-${b.id || i}`} data-testid={`backup-row-${b.id || i}`}>
                        <TableCell className="text-sm">{b.client_name || "—"}</TableCell>
                        <TableCell className="font-medium">{b.device_name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground truncate max-w-[260px]" title={b.plan_names || ""}>{b.plan_names || "—"}</TableCell>
                        <TableCell className="text-xs">{b.last_run ? new Date(b.last_run).toLocaleString() : "Never"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{b.next_run ? new Date(b.next_run).toLocaleString() : "—"}</TableCell>
                        <TableCell><Badge className={`text-[10px] ${STATUS_COLOR[b.status] || ""}`}><Ico className="w-3 h-3 mr-1" />{b.status}</Badge></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* LIVE */}
        <TabsContent value="live" className="mt-4 space-y-4">
          <Card className="border-cyan-500/30 bg-cyan-500/[0.02]">
            <CardContent className="py-3 px-4 flex items-center gap-3">
              <div className="relative">
                <Zap className="w-5 h-5 text-cyan-400" />
                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-cyan-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-cyan-300">Live Activity Stream</p>
                <p className="text-[11px] text-muted-foreground">Auto-refresh every 5s · {liveCount} running · {(liveActivities.recent || []).length} recent</p>
              </div>
              <Badge variant="outline" className="text-[10px] border-cyan-500/40 text-cyan-300 gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                LIVE
              </Badge>
            </CardContent>
          </Card>

          {/* Running */}
          {liveCount === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Activity className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No backups running right now</p>
                <p className="text-[11px] mt-1 opacity-70">Live activities will appear here when Acronis kicks off a backup.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {liveActivities.running.map(a => <RunningBackupCard key={a.id} activity={a} onCancel={handleCancelBackup} />)}
            </div>
          )}

          {/* Recent */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Recent (last 30)</p>
            <Card>
              <CardContent className="p-0">
                <ScrollArea className="h-[400px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>State</TableHead>
                        <TableHead>Resource</TableHead>
                        <TableHead>Plan</TableHead>
                        <TableHead>Tenant</TableHead>
                        <TableHead>Started</TableHead>
                        <TableHead>Type</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(liveActivities.recent || []).map(a => {
                        const stateColor = (a.state || "").toLowerCase().includes("complet") ? "text-emerald-400" :
                          (a.state || "").toLowerCase().includes("fail") ? "text-red-400" :
                          (a.state || "").toLowerCase().includes("cancel") ? "text-amber-400" : "text-muted-foreground";
                        return (
                          <TableRow key={a.id}>
                            <TableCell><span className={`text-xs font-mono capitalize ${stateColor}`}>{a.state}</span></TableCell>
                            <TableCell className="text-sm">{a.resource_name}</TableCell>
                            <TableCell className="text-xs">{a.plan_name}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{a.tenant_name}</TableCell>
                            <TableCell className="text-xs">{a.started_at ? formatDistanceToNow(new Date(a.started_at), { addSuffix: true }) : "-"}</TableCell>
                            <TableCell><Badge variant="outline" className="text-[10px] capitalize">{(a.activity_type || "").replace("_", " ")}</Badge></TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* TENANTS */}
        <TabsContent value="tenants" className="mt-4">
          <TenantsTab token={token} backupStatuses={backupStatuses} />
        </TabsContent>

        {/* BACKUP STATUS (per-machine) */}
        <TabsContent value="status" className="mt-4">
          <BackupStatusTab token={token} onDataChange={setBackupStatuses} />
        </TabsContent>

        {/* ACRONIS CONSOLE */}
        <TabsContent value="acronis" className="mt-4 space-y-4">
          <Card className="border-amber-500/20 bg-amber-500/[0.03]">
            <CardContent className="py-2.5 px-4 flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-xs font-medium text-amber-300">Acronis API limitations</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Acronis Cyber Cloud's public API supports <strong>Run Now</strong>, <strong>Stop running backup</strong>, and <strong>Apply / change backup plan</strong> — but
                  does <strong>not</strong> expose Pause/Resume or one-off scheduling. Schedules are baked into the policy itself; to change cadence, edit the policy in Acronis Cloud or apply a different plan from here.
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Quick Actions panel */}
            <Card className="lg:col-span-1 bg-gradient-to-br from-cyan-500/5 to-blue-500/5 border-cyan-500/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Settings className="w-4 h-4 text-cyan-400" />
                  Acronis Quick Actions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => handleOpenAcronis()}>
                  <ExternalLink className="w-3.5 h-3.5 mr-2 text-blue-400" />Open Acronis Cloud Console
                </Button>
                <Button variant="outline" size="sm" className="w-full justify-start" onClick={fetchLive}>
                  <RotateCw className="w-3.5 h-3.5 mr-2 text-cyan-400" />Refresh Live Activities
                </Button>
                <Button variant="outline" size="sm" className="w-full justify-start" onClick={fetchData}>
                  <Server className="w-3.5 h-3.5 mr-2 text-emerald-400" />Sync Agent Status
                </Button>
                <Button variant="outline" size="sm" className="w-full justify-start" onClick={handleScanOrphans} disabled={scanning}>
                  {scanning ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Ghost className="w-3.5 h-3.5 mr-2 text-violet-400" />}
                  Run Orphan Scan
                </Button>
              </CardContent>
            </Card>

            {/* Agent Health */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span className="flex items-center gap-2"><Wifi className="w-4 h-4 text-emerald-400" />Agent Health</span>
                  {ah.total && <span className="text-[11px] text-muted-foreground font-normal">{ah.online}/{ah.total} online · {ah.online_pct}%</span>}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
                    <div className="flex items-center gap-2 mb-1"><Wifi className="w-3.5 h-3.5 text-emerald-400" /><span className="text-[10px] uppercase tracking-widest text-emerald-300">Online</span></div>
                    <p className="text-2xl font-bold text-emerald-300 font-mono"><AnimatedCounter value={ah.online || 0} /></p>
                  </div>
                  <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
                    <div className="flex items-center gap-2 mb-1"><WifiOff className="w-3.5 h-3.5 text-amber-400" /><span className="text-[10px] uppercase tracking-widest text-amber-300">Offline</span></div>
                    <p className="text-2xl font-bold text-amber-300 font-mono"><AnimatedCounter value={ah.offline_recent || 0} /></p>
                  </div>
                  <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/5">
                    <div className="flex items-center gap-2 mb-1"><Skull className="w-3.5 h-3.5 text-rose-400" /><span className="text-[10px] uppercase tracking-widest text-rose-300">Stale ({">"}24h)</span></div>
                    <p className="text-2xl font-bold text-rose-300 font-mono"><AnimatedCounter value={ah.stale || 0} /></p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Active Alerts */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Bell className="w-4 h-4 text-amber-400" />
                Active Acronis Alerts
                <Badge variant="outline" className="ml-auto text-[10px]">{acronisAlerts.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {acronisAlerts.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  <CheckCircle className="w-8 h-8 mx-auto mb-2 text-emerald-400 opacity-70" />
                  No active alerts — all clear!
                </p>
              ) : (
                <ScrollArea className="h-[300px]">
                  <div className="space-y-2">
                    {acronisAlerts.slice(0, 50).map(alert => {
                      const sev = (alert.severity || "info").toLowerCase();
                      const sevColor = sev === "critical" || sev === "error" ? "text-rose-400 border-rose-500/30 bg-rose-500/10" :
                        sev === "warning" ? "text-amber-400 border-amber-500/30 bg-amber-500/10" :
                        "text-cyan-400 border-cyan-500/30 bg-cyan-500/10";
                      return (
                        <div key={alert.id} className="flex items-start gap-3 p-3 rounded-lg border border-border/40 hover:bg-muted/20 transition-colors" data-testid={`alert-${alert.id}`}>
                          <AlertCircle className={`w-4 h-4 flex-shrink-0 mt-0.5 ${sev === "critical" || sev === "error" ? "text-rose-400" : sev === "warning" ? "text-amber-400" : "text-cyan-400"}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-sm font-medium truncate">{alert.type || alert.name || "Alert"}</span>
                              <Badge variant="outline" className={`text-[9px] capitalize ${sevColor}`}>{sev}</Badge>
                            </div>
                            <p className="text-[11px] text-muted-foreground truncate">{alert.message || alert.description}</p>
                            {alert.created_at && (
                              <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                                <Clock className="w-2.5 h-2.5 inline mr-1" />
                                {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true })}
                              </p>
                            )}
                          </div>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleOpenAcronis(null, alert.id)} title="Open in Acronis">
                              <ArrowUpRight className="w-3 h-3" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 hover:bg-emerald-500/10" onClick={() => handleDismissAlert(alert.id)} title="Dismiss" data-testid={`dismiss-alert-${alert.id}`}>
                              <CheckCircle className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ORPHANS */}
        <TabsContent value="orphans" className="mt-4 space-y-4">
          <Card className="border-violet-500/30 bg-gradient-to-br from-violet-500/5 to-fuchsia-500/5">
            <CardContent className="py-4 px-5">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-700 flex items-center justify-center shadow-lg shadow-violet-500/30">
                  <Ghost className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-sm flex items-center gap-2">
                    Orphan & Zombie Hunter
                    <Sparkles className="w-3 h-3 text-violet-400" />
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Find unprotected resources, stale backups, zombie plans pointing to deleted machines, and offline agents that may still be billed.
                  </p>
                </div>
                <Button onClick={handleScanOrphans} disabled={scanning} className="bg-violet-600 hover:bg-violet-700" data-testid="run-orphan-scan-btn">
                  {scanning ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Scanning...</> : <><Search className="w-4 h-4 mr-2" />Run Scan</>}
                </Button>
              </div>
            </CardContent>
          </Card>

          {!orphans ? (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                <Ghost className="w-16 h-16 mx-auto mb-4 opacity-30 text-violet-400" />
                <p className="font-medium">Click "Run Scan" to hunt for orphaned backup files in Acronis</p>
                <p className="text-xs mt-1 opacity-70">Scan checks resources, applications, and agents — usually completes in 5-10 seconds.</p>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <HeroMetric label="Unprotected" value={orphans.totals.unprotected || 0} icon={FileQuestion} glow="rose" subtitle="No backup policy" />
                <HeroMetric label="Stale Backups" value={orphans.totals.stale || 0} icon={Clock} glow="amber" subtitle={`${orphans.stale_threshold_days}+ days old`} />
                <HeroMetric label="Zombie Plans" value={orphans.totals.zombie_apps || 0} icon={Skull} glow="violet" subtitle="Missing resource" />
                <HeroMetric label="Offline Agents" value={orphans.totals.offline_consuming || 0} icon={WifiOff} glow="rose" subtitle="May still bill" />
              </div>

              {/* Unprotected */}
              {orphans.unprotected?.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center justify-between">
                      <span className="flex items-center gap-2"><FileQuestion className="w-4 h-4 text-rose-400" />Unprotected Resources ({orphans.unprotected.length})</span>
                      <div className="flex gap-2">
                        {selectedOrphans.length > 0 && (
                          <Button
                            size="sm" variant="outline"
                            className="h-7 text-xs border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10"
                            onClick={() => openApplyPlan(selectedOrphans)}
                            data-testid="apply-plan-bulk-btn"
                          >
                            <Wand2 className="w-3 h-3 mr-1" />
                            Apply Plan to {selectedOrphans.length} selected
                          </Button>
                        )}
                        {selectedOrphans.length > 0 && (
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedOrphans([])}>
                            Clear
                          </Button>
                        )}
                      </div>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ScrollArea className="h-[280px]">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-8"></TableHead>
                            <TableHead>Resource</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Tenant</TableHead>
                            <TableHead>Severity</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {orphans.unprotected.map(u => {
                            const isSelected = selectedOrphans.find(s => s.resource_id === u.resource_id);
                            return (
                              <TableRow key={u.resource_id} className={isSelected ? "bg-cyan-500/5" : ""}>
                                <TableCell className="px-2">
                                  <input
                                    type="checkbox"
                                    checked={!!isSelected}
                                    onChange={() => toggleOrphanSelection(u)}
                                    className="w-3.5 h-3.5 rounded border-border"
                                    data-testid={`orphan-select-${u.resource_id}`}
                                  />
                                </TableCell>
                                <TableCell className="font-medium text-sm">{u.resource_name}</TableCell>
                                <TableCell className="text-xs capitalize">{u.resource_type}</TableCell>
                                <TableCell className="text-xs text-muted-foreground">{u.tenant_name || "-"}</TableCell>
                                <TableCell><Badge variant="destructive" className="text-[10px]">{u.severity}</Badge></TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    variant="ghost" size="sm"
                                    className="h-7 px-2 text-cyan-300 hover:bg-cyan-500/10"
                                    onClick={() => openApplyPlan([u])}
                                    title="Apply backup plan to this resource"
                                    data-testid={`apply-plan-${u.resource_id}`}
                                  >
                                    <Wand2 className="w-3 h-3 mr-1" />Apply Plan
                                  </Button>
                                  <Button
                                    variant="ghost" size="sm" className="h-7 w-7 p-0"
                                    onClick={() => handleOpenAcronis(u.resource_id)}
                                    title="Open in Acronis"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  </CardContent>
                </Card>
              )}

              {/* Stale */}
              {orphans.stale?.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2"><Clock className="w-4 h-4 text-amber-400" />Stale Backups ({orphans.stale.length})</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ScrollArea className="h-[280px]">
                      <Table>
                        <TableHeader><TableRow><TableHead>Resource</TableHead><TableHead>Last Backup</TableHead><TableHead>Days Stale</TableHead><TableHead>Tenant</TableHead><TableHead>Severity</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {orphans.stale.map(s => (
                            <TableRow key={s.resource_id}>
                              <TableCell className="font-medium text-sm">{s.resource_name}</TableCell>
                              <TableCell className="text-xs">{s.last_backup ? new Date(s.last_backup).toLocaleDateString() : "Never"}</TableCell>
                              <TableCell><Badge variant="outline" className="text-[10px] font-mono">{s.days_stale}d</Badge></TableCell>
                              <TableCell className="text-xs text-muted-foreground">{s.tenant_name || "-"}</TableCell>
                              <TableCell><Badge variant={s.severity === "critical" ? "destructive" : "outline"} className="text-[10px]">{s.severity}</Badge></TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  </CardContent>
                </Card>
              )}

              {/* Zombie apps */}
              {orphans.zombie_apps?.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2"><Skull className="w-4 h-4 text-violet-400" />Zombie Backup Plans ({orphans.zombie_apps.length})</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ScrollArea className="h-[280px]">
                      <Table>
                        <TableHeader><TableRow><TableHead>Plan</TableHead><TableHead>Missing Resource</TableHead><TableHead>Severity</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {orphans.zombie_apps.map(z => (
                            <TableRow key={z.application_id}>
                              <TableCell className="font-medium text-sm">{z.policy_name || "(unnamed plan)"}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{z.missing_resource_name}</TableCell>
                              <TableCell><Badge variant="outline" className="text-[10px]">{z.severity}</Badge></TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  </CardContent>
                </Card>
              )}

              {/* Offline consuming */}
              {orphans.offline_consuming?.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2"><WifiOff className="w-4 h-4 text-rose-400" />Long-Offline Agents ({orphans.offline_consuming.length})</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ScrollArea className="h-[280px]">
                      <Table>
                        <TableHeader><TableRow><TableHead>Agent</TableHead><TableHead>Last Seen</TableHead><TableHead>Days Offline</TableHead><TableHead>Tenant</TableHead><TableHead>Severity</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {orphans.offline_consuming.map(o => (
                            <TableRow key={o.agent_id}>
                              <TableCell className="font-medium text-sm">{o.agent_name}</TableCell>
                              <TableCell className="text-xs">{o.last_seen ? new Date(o.last_seen).toLocaleDateString() : "-"}</TableCell>
                              <TableCell><Badge variant="outline" className="text-[10px] font-mono">{o.days_offline}d</Badge></TableCell>
                              <TableCell className="text-xs text-muted-foreground">{o.tenant_name || "-"}</TableCell>
                              <TableCell><Badge variant="outline" className="text-[10px]">{o.severity}</Badge></TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  </CardContent>
                </Card>
              )}

              {orphans.totals.total_orphans === 0 && (
                <Card>
                  <CardContent className="py-12 text-center">
                    <CheckCircle className="w-16 h-16 mx-auto mb-3 text-emerald-400 opacity-80" />
                    <p className="font-semibold text-emerald-300">All clean!</p>
                    <p className="text-xs text-muted-foreground mt-1">No orphans, zombies or stale backups detected.</p>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* COMPLIANCE */}
        <TabsContent value="compliance" className="mt-4 space-y-4">
          {!compData ? <p className="text-muted-foreground text-center py-12">No compliance data</p> : <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <Card><CardContent className="pt-4 pb-3 text-center"><HardDrive className="w-4 h-4 mx-auto mb-1" /><p className="text-xl font-bold">{cs.total_devices}</p><p className="text-xs text-muted-foreground">Total Devices</p></CardContent></Card>
              <Card><CardContent className="pt-4 pb-3 text-center"><CheckCircle className="w-4 h-4 mx-auto mb-1 text-green-500" /><p className="text-xl font-bold text-green-500">{cs.compliant}</p><p className="text-xs text-muted-foreground">Compliant</p></CardContent></Card>
              <Card><CardContent className="pt-4 pb-3 text-center"><XCircle className="w-4 h-4 mx-auto mb-1 text-red-500" /><p className="text-xl font-bold text-red-500">{cs.non_compliant}</p><p className="text-xs text-muted-foreground">Non-Compliant</p></CardContent></Card>
              <Card><CardContent className="pt-4 pb-3 text-center"><AlertTriangle className="w-4 h-4 mx-auto mb-1 text-amber-500" /><p className="text-xl font-bold text-amber-500">{cs.no_backup}</p><p className="text-xs text-muted-foreground">No Backup</p></CardContent></Card>
              <Card><CardContent className="pt-4 pb-3 text-center"><Shield className="w-4 h-4 mx-auto mb-1 text-primary" /><p className="text-xl font-bold">{cs.compliance_pct}%</p><p className="text-xs text-muted-foreground">Compliance Rate</p></CardContent></Card>
            </div>
            <Card>
              <CardHeader><CardTitle className="text-base">Device Backup Status</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>Device</TableHead><TableHead>Client</TableHead><TableHead>Type</TableHead><TableHead>Last Backup</TableHead><TableHead>RPO</TableHead><TableHead>RTO</TableHead><TableHead>Size</TableHead><TableHead>Compliance</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(compData.devices || []).map(d => (
                      <TableRow key={d.device_id}>
                        <TableCell className="font-medium">{d.device_name}</TableCell>
                        <TableCell className="text-sm">{d.client_name}</TableCell>
                        <TableCell className="capitalize text-xs">{d.device_type}</TableCell>
                        <TableCell className="text-xs">{d.last_backup ? new Date(d.last_backup).toLocaleString() : "Never"}</TableCell>
                        <TableCell>{d.rpo_hours ? `${d.rpo_hours}h` : "-"}</TableCell>
                        <TableCell>{d.rto_hours ? `${d.rto_hours}h` : "-"}</TableCell>
                        <TableCell>{d.size_gb ? `${d.size_gb}GB` : "-"}</TableCell>
                        <TableCell><Badge variant={complianceColors[d.compliance]} className="capitalize text-xs">{d.compliance?.replace("_", " ")}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>}
        </TabsContent>

        {/* BILLING */}
        <TabsContent value="billing" className="mt-4">
          <BillingTab token={token} />
        </TabsContent>

        {/* VERIFICATION */}
        <TabsContent value="verify" className="mt-4 space-y-4">
          {!verifyData ? <p className="text-muted-foreground text-center py-12">No verification data</p> : <>
            <div className="flex items-center justify-between"><div /><Button><Play className="w-4 h-4 mr-1" />Run Test</Button></div>
            <div className="grid grid-cols-4 gap-4">
              <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Total Tests</div><div className="text-3xl font-bold mt-1">{vs.total_tests}</div></CardContent></Card>
              <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Pass Rate</div><div className="text-3xl font-bold text-green-500 mt-1">{vs.pass_rate_pct}%</div></CardContent></Card>
              <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Failed</div><div className="text-3xl font-bold text-red-500 mt-1">{vs.failed}</div></CardContent></Card>
              <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Avg Restore</div><div className="text-3xl font-bold mt-1">{vs.avg_restore_time_min}m</div></CardContent></Card>
            </div>
            <div className="space-y-2">
              {(verifyData.tests || []).map(t => (
                <Card key={t.id}>
                  <CardContent className="pt-3 pb-3">
                    <div className="flex items-center gap-4">
                      {t.result === "pass" ? <CheckCircle className="w-5 h-5 text-green-500" /> : <XCircle className="w-5 h-5 text-red-500" />}
                      <div className="flex-1">
                        <div className="flex items-center gap-2"><span className="font-medium text-sm">{t.client_name}</span><Badge variant="outline" className="text-xs">{t.backup_type}</Badge><Badge variant="secondary" className="text-xs">{t.backup_solution}</Badge></div>
                        <div className="text-xs text-muted-foreground">Restore: {t.restore_time_minutes}min | Integrity: {t.data_integrity_check} {t.notes && `| ${t.notes}`}</div>
                      </div>
                      <Badge variant={t.result === "pass" ? "default" : "destructive"}>{t.result}</Badge>
                      <span className="text-xs text-muted-foreground">{new Date(t.tested_at).toLocaleDateString()}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>}
        </TabsContent>
      </Tabs>

      <ChangePlanDialog
        open={planDialogOpen}
        onOpenChange={setPlanDialogOpen}
        token={token}
        resources={planTargets}
        onApplied={() => {
          setSelectedOrphans([]);
          // Re-scan orphans after apply
          if (orphans) handleScanOrphans();
        }}
      />

      {/* Cancel Backup Confirmation */}
      <Dialog open={!!cancelTarget} onOpenChange={v => !v && setCancelTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <StopCircle className="w-5 h-5 text-rose-400" />
              Stop Running Backup?
            </DialogTitle>
            <DialogDescription>
              You're about to stop the backup of <strong>{cancelTarget?.resource_name}</strong>.
              <br /><br />
              <span className="text-amber-300 text-xs">
                ⚠️ Acronis only supports stop, not pause. The current run will be cancelled and any partial data discarded.
                The next scheduled run will proceed normally.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)}>Keep Running</Button>
            <Button className="bg-rose-600 hover:bg-rose-700" onClick={confirmCancelBackup} data-testid="confirm-cancel-backup">
              <StopCircle className="w-4 h-4 mr-2" />Stop Backup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
