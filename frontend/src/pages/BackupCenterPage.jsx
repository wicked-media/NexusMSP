import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  HardDrive, CheckCircle, XCircle, Clock, AlertTriangle, Search, RefreshCw, Loader2,
  Shield, Database, Play, Activity, ExternalLink, Zap, Cloud, Wifi, WifiOff,
  Ghost, Skull, AlertCircle, Sparkles, RotateCw, Eye, Settings,
  Server, ArrowUpRight, Trash2, FileQuestion, Bell, StopCircle, Wand2,
  Users, DollarSign, ChevronLeft, ChevronRight, Gauge, LockKeyhole, Route,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import ChangePlanDialog from "@/components/backups/ChangePlanDialog";
import TenantsTab from "@/components/backups/TenantsTab";
import BackupStatusTab from "@/components/backups/BackupStatusTab";
import BillingTab from "@/components/backups/BillingTab";
import HeroTile, { AnimatedCounter as _AC } from "@/components/HeroTile";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { Responsive, WidthProvider } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import "@/styles/dashboard-grid.css";
import "@/styles/dashboard-ticker.css";
import { useWidgetGrid } from "@/hooks/useWidgetGrid";

const BackupResponsiveGridLayout = WidthProvider(Responsive);

const ORPHAN_WIDGET_META = {
  "metrics":     { label: "Orphan Metric Tiles",     icon: FileQuestion },
  "unprotected": { label: "Unprotected Resources",   icon: FileQuestion },
  "stale":       { label: "Stale Backups",           icon: Clock },
  "zombies":     { label: "Zombie Plans",            icon: Skull },
  "offline":     { label: "Long-Offline Agents",     icon: WifiOff },
};
const ORPHAN_DEFAULT_LAYOUT = [
  { i: "metrics",     x: 0, y: 0,  w: 12, h: 2, minH: 2, minW: 6 },
  { i: "unprotected", x: 0, y: 2,  w: 12, h: 7, minH: 4, minW: 6 },
  { i: "stale",       x: 0, y: 9,  w: 12, h: 7, minH: 4, minW: 6 },
  { i: "zombies",     x: 0, y: 16, w: 12, h: 7, minH: 4, minW: 6 },
  { i: "offline",     x: 0, y: 23, w: 12, h: 7, minH: 4, minW: 6 },
];

const STATUS_ICON = { success: CheckCircle, failed: XCircle, running: Clock, warning: AlertTriangle };
const STATUS_COLOR = { success: "text-emerald-400 bg-emerald-500/10", failed: "text-red-400 bg-red-500/10", running: "text-blue-400 bg-blue-500/10", warning: "text-amber-400 bg-amber-500/10" };
const complianceColors = { compliant: "default", non_compliant: "destructive", no_backup: "outline", not_assessed: "secondary" };

// Re-export for legacy local references in this file
const AnimatedCounter = _AC;

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
/** ── Hero metric — delegates to the canonical HeroTile component ── */
function HeroMetric(props) { return <HeroTile {...props} />; }
/* legacy local impl preserved below for reference, no longer used */

function BackupOperationsTicker({ items, onNavigate, statusText = "Select an item to investigate" }) {
  const repeatedItems = [...items, ...items];

  return (
    <div className="nx-live-ticker" data-testid="backup-assurance-strip" aria-label="Live backup operations ticker">
      <div className="nx-live-ticker__label">
        <Activity className="h-3.5 w-3.5" />
        <span>Live backup</span>
        <span className="nx-live-ticker__pulse" />
      </div>
      <div className="nx-live-ticker__viewport">
        <div className="nx-live-ticker__track">
          {repeatedItems.map((item, index) => {
            const Icon = item.icon;
            return (
              <button
                key={`${item.key}-${index}`}
                type="button"
                onClick={() => onNavigate(item.action)}
                className={`nx-live-ticker__item nx-live-ticker__item--${item.tone}`}
                data-testid={index < items.length ? `backup-ticker-${item.key}` : undefined}
                title={item.title}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="font-medium">{item.label}</span>
                <span className="nx-live-ticker__detail">{item.detail}</span>
              </button>
            );
          })}
        </div>
      </div>
      <span className="nx-live-ticker__refresh">{statusText}</span>
    </div>
  );
}

function BackupLifecycleNavigator({ activeTab, onSelect, orphanCount = 0 }) {
  const groups = [
    {
      label: "Operate", description: "See protection and live activity", tone: "sky",
      items: [["dashboard", "Overview", Database], ["live", "Live activity", Activity], ["status", "Coverage", Server]],
    },
    {
      label: "Organise", description: "Keep tenant data clean", tone: "violet",
      items: [["tenants", "Tenant mapping", Users], ["acronis", "Provider health", Cloud], ["orphans", "Hygiene", Ghost]],
    },
    {
      label: "Assure", description: "Prove recoverability", tone: "emerald",
      items: [["compliance", "Assurance", Shield], ["verify", "Recovery tests", CheckCircle]],
    },
    {
      label: "Bill", description: "Reconcile protected usage", tone: "amber",
      items: [["billing", "Usage billing", DollarSign]],
    },
  ];

  const toneClasses = {
    sky: "data-[active=true]:border-sky-400/45 data-[active=true]:bg-sky-500/10 data-[active=true]:text-sky-100",
    violet: "data-[active=true]:border-violet-400/45 data-[active=true]:bg-violet-500/10 data-[active=true]:text-violet-100",
    emerald: "data-[active=true]:border-emerald-400/45 data-[active=true]:bg-emerald-500/10 data-[active=true]:text-emerald-100",
    amber: "data-[active=true]:border-amber-400/45 data-[active=true]:bg-amber-500/10 data-[active=true]:text-amber-100",
  };

  return (
    <nav className="grid gap-3 lg:grid-cols-4" aria-label="Backup Centre workflow" data-testid="backup-lifecycle-navigator">
      {groups.map((group) => (
        <section key={group.label} className="rounded-2xl border border-border/60 bg-muted/[0.12] p-3">
          <div className="mb-2"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{group.label}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{group.description}</p></div>
          <div className="flex flex-wrap gap-1.5">
            {group.items.map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                data-active={activeTab === value}
                onClick={() => onSelect(value)}
                className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-transparent px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border hover:bg-muted/50 hover:text-foreground ${toneClasses[group.tone]}`}
                data-testid={`tab-${value}`}
              >
                <Icon className="h-3.5 w-3.5" />{label}
                {value === "orphans" && orphanCount > 0 && <span className="rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-rose-200">{orphanCount}</span>}
              </button>
            ))}
          </div>
        </section>
      ))}
    </nav>
  );
}

const BACKUP_TABS = new Set(["dashboard", "live", "tenants", "status", "acronis", "orphans", "compliance", "billing", "verify"]);
const BACKUP_STATUS_FILTERS = new Set(["all", "success", "failed", "running"]);

export default function BackupCenterPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const headers = { Authorization: `Bearer ${token}` };
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const requestedStatusFilter = searchParams.get("status");
  const [tab, setTab] = useState(() => BACKUP_TABS.has(requestedTab) ? requestedTab : "dashboard");
  const [dashData, setDashData] = useState(null);
  const [compData, setCompData] = useState(null);
  const [verifyData, setVerifyData] = useState(null);
  const [assuranceData, setAssuranceData] = useState(null);
  const [assuranceClientId, setAssuranceClientId] = useState("");
  const [assuranceLoading, setAssuranceLoading] = useState(false);
  const [acronisUsage, setAcronisUsage] = useState(null);
  const [agentsHealth, setAgentsHealth] = useState(null);
  const [acronisAlerts, setAcronisAlerts] = useState([]);
  const [orphans, setOrphans] = useState(null);
  const [liveActivities, setLiveActivities] = useState({ running: [], recent: [], stats: {} });
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [statusFilter, setStatusFilter] = useState(() => BACKUP_STATUS_FILTERS.has(requestedStatusFilter) ? requestedStatusFilter : "all");
  const [search, setSearch] = useState("");
  const [dashboardPage, setDashboardPage] = useState(1);
  const [dashboardPageSize, setDashboardPageSize] = useState(25);
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [planTargets, setPlanTargets] = useState([]);
  const [selectedOrphans, setSelectedOrphans] = useState([]);
  const [selectedZombies, setSelectedZombies] = useState([]);
  const [selectedAgents, setSelectedAgents] = useState([]);
  const [cleaning, setCleaning] = useState(false);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [orphanCleanupTarget, setOrphanCleanupTarget] = useState(null);
  const [backupStatuses, setBackupStatuses] = useState(null);
  const [verificationCompletion, setVerificationCompletion] = useState(null);
  const [verificationSaving, setVerificationSaving] = useState(false);
  const [verificationRequest, setVerificationRequest] = useState(null);
  const [verificationRequestSaving, setVerificationRequestSaving] = useState(false);
  const [clients, setClients] = useState([]);
  const [acronisConfig, setAcronisConfig] = useState(null);
  const [simulationRequest, setSimulationRequest] = useState(null);
  const [simulationSaving, setSimulationSaving] = useState(false);
  const [simulationResult, setSimulationResult] = useState(null);

  useEffect(() => {
    if (requestedTab && BACKUP_TABS.has(requestedTab)) setTab(requestedTab);
  }, [requestedTab]);

  useEffect(() => {
    if (BACKUP_STATUS_FILTERS.has(requestedStatusFilter)) setStatusFilter(requestedStatusFilter);
    else setStatusFilter("all");
  }, [requestedStatusFilter]);

  useEffect(() => {
    setDashboardPage(1);
  }, [search, statusFilter, dashboardPageSize]);

  const selectTab = useCallback((nextTab) => {
    setTab(nextTab);
    const nextParams = new URLSearchParams(searchParams);
    if (nextTab === "dashboard") nextParams.delete("tab");
    else nextParams.set("tab", nextTab);
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  const selectStatusFilter = useCallback((nextFilter) => {
    const nextParams = new URLSearchParams(searchParams);
    if (nextFilter === "all") nextParams.delete("status");
    else nextParams.set("status", nextFilter);
    setStatusFilter(nextFilter);
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  const openDashboardFilter = (nextFilter) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("tab");
    if (nextFilter === "all") nextParams.delete("status");
    else nextParams.set("status", nextFilter);
    setStatusFilter(nextFilter);
    setTab("dashboard");
    setSearchParams(nextParams, { replace: true });
  };

  const openAcronisSettings = () => navigate("/settings?tab=integrations&anchor=acronis-settings-card");

  // ── Widget grid (Orphans tab) ────────────────────────────────────────
  const orphanGrid = useWidgetGrid({
    storageKey: "nx-orphan-layout-v1",
    hiddenKey:  "nx-orphan-hidden-v1",
    defaultLayout: ORPHAN_DEFAULT_LAYOUT,
    widgetMeta: ORPHAN_WIDGET_META,
    label: "Orphans",
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [dash, comp, verify, assurance, usage, agents, alerts, clientList, config] = await Promise.allSettled([
        axios.get(`${API}/backup-dashboard/overview`, { headers }),
        axios.get(`${API}/backup-compliance/dashboard`, { headers }),
        axios.get(`${API}/backup-verify/overview`, { headers }),
        axios.get(`${API}/backup-assurance/overview`, { headers }),
        axios.get(`${API}/acronis/usage-summary`, { headers }),
        axios.get(`${API}/acronis/agents/health`, { headers }),
        axios.get(`${API}/acronis/alerts`, { headers }),
        axios.get(`${API}/clients`, { headers }),
        axios.get(`${API}/acronis/config`, { headers }),
      ]);
      // Map jobs to backups for compatibility
      if (dash.status === "fulfilled") {
        const d = dash.value.data;
        setDashData({ summary: d.summary, backups: d.jobs || [] });
      }
      if (comp.status === "fulfilled") setCompData(comp.value.data);
      if (verify.status === "fulfilled") setVerifyData(verify.value.data);
      if (assurance.status === "fulfilled") setAssuranceData(assurance.value.data);
      if (usage.status === "fulfilled") setAcronisUsage(usage.value.data);
      if (agents.status === "fulfilled") setAgentsHealth(agents.value.data);
      if (alerts.status === "fulfilled") setAcronisAlerts(alerts.value.data?.items || []);
      if (clientList.status === "fulfilled") setClients(clientList.value.data || []);
      if (config.status === "fulfilled") setAcronisConfig(config.value.data || {});
      else setAcronisConfig({ configured: false, error: "Unable to load Acronis connection status" });
    } catch { toast.error("Failed to load backup data"); }
    finally { setLoading(false); }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch live activities every 5s when on Live tab
  const fetchLive = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/acronis/live-activities`, { headers });
      setLiveActivities(r.data || { running: [], recent: [], stats: {} });
    } catch (error) {
      setLiveActivities({ running: [], recent: [], stats: {}, error: error.response?.data?.detail || "Live activity feed unavailable" });
    }
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
      if (r.data?.data_source === "error") {
        toast.error("Orphan scan could not reach Acronis. No cleanup actions were performed.");
      } else {
        toast.success(`Scan complete · ${r.data?.totals?.total_orphans || 0} orphan items found`);
      }
    } catch (e) { toast.error(e.response?.data?.detail || "Orphan scan failed"); }
    finally { setScanning(false); }
  };

  const openVerificationRequest = () => {
    if (!clients.length) { toast.error("Add or load a customer before scheduling a recovery test"); return; }
    setVerificationRequest({ client_id: "", backup_type: "Recovery test", backup_solution: "Acronis", notes: "" });
  };

  const submitVerificationRequest = async () => {
    if (!verificationRequest?.client_id) { toast.error("Choose the customer whose recovery evidence is being tested"); return; }
    setVerificationRequestSaving(true);
    try {
      const response = await axios.post(`${API}/backup-verify/run`, verificationRequest, { headers });
      if (response.data?.status !== "scheduled") throw new Error(response.data?.message || "Verification could not be scheduled");
      toast.success(response.data.message || "Backup verification scheduled");
      setVerificationRequest(null);
      await fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Could not schedule backup verification");
    } finally { setVerificationRequestSaving(false); }
  };

  const openVerificationCompletion = (test) => setVerificationCompletion({ test, result: "pass", restore_time_minutes: "", data_integrity_check: "passed", notes: test.notes || "" });
  const completeVerification = async () => {
    if (!verificationCompletion?.test?.id) return;
    setVerificationSaving(true);
    try {
      const response = await axios.put(`${API}/backup-verify/${verificationCompletion.test.id}`, {
        result: verificationCompletion.result,
        restore_time_minutes: verificationCompletion.restore_time_minutes,
        data_integrity_check: verificationCompletion.data_integrity_check,
        notes: verificationCompletion.notes,
      }, { headers });
      if (response.data?.status !== "completed") throw new Error(response.data?.message || "Could not record verification");
      toast.success("Restore verification outcome recorded");
      setVerificationCompletion(null);
      await fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Could not record verification");
    } finally { setVerificationSaving(false); }
  };

  const openRecoverySimulation = () => {
    if (!clients.length) { toast.error("Add or load a customer before simulating recovery"); return; }
    setSimulationRequest({ client_id: "", workload: "", target_rto_hours: "4", target_rpo_hours: "24", data_size_gb: "", dependencies: "", assumptions: "" });
  };

  const submitRecoverySimulation = async () => {
    if (!simulationRequest?.client_id || !simulationRequest?.workload.trim()) {
      toast.error("Choose a customer and describe the workload being recovered");
      return;
    }
    setSimulationSaving(true);
    try {
      const response = await axios.post(`${API}/backup-assurance/simulate`, simulationRequest, { headers });
      setSimulationResult(response.data?.simulation || null);
      setSimulationRequest(null);
      toast.success(response.data?.message || "Recovery simulation recorded");
      await fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not simulate recovery");
    } finally { setSimulationSaving(false); }
  };

  const changeAssuranceScope = async (value) => {
    const clientId = value === "all" ? "" : value;
    setAssuranceClientId(clientId);
    setAssuranceLoading(true);
    try {
      const response = await axios.get(`${API}/backup-assurance/overview`, { headers, params: clientId ? { client_id: clientId } : {} });
      setAssuranceData(response.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not recalculate recovery assurance");
    } finally { setAssuranceLoading(false); }
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

  const toggleZombieSelection = (z) => {
    setSelectedZombies(prev => prev.find(s => s.application_id === z.application_id) ? prev.filter(s => s.application_id !== z.application_id) : [...prev, z]);
  };
  const toggleAgentSelection = (a) => {
    setSelectedAgents(prev => prev.find(s => s.agent_id === a.agent_id) ? prev.filter(s => s.agent_id !== a.agent_id) : [...prev, a]);
  };

  const handleRemoveZombie = async (z, confirmed = false) => {
    if (!confirmed) { setOrphanCleanupTarget({ kind: "zombie", item: z, bulk: false }); return; }
    try {
      await axios.delete(`${API}/acronis/applications/${z.application_id}`, { headers });
      toast.success("Zombie plan removed");
      setOrphans(prev => prev ? {
        ...prev,
        zombie_apps: prev.zombie_apps.filter(x => x.application_id !== z.application_id),
        totals: { ...prev.totals, zombie_apps: Math.max(0, (prev.totals.zombie_apps || 0) - 1), total_orphans: Math.max(0, (prev.totals.total_orphans || 0) - 1) },
      } : prev);
    } catch (e) { toast.error(e.response?.data?.detail || "Remove failed"); }
  };

  const handleBulkCleanupZombies = async (confirmed = false) => {
    if (selectedZombies.length === 0) { toast.error("No zombie plans selected"); return; }
    if (!confirmed) { setOrphanCleanupTarget({ kind: "zombie", bulk: true }); return; }
    setCleaning(true);
    try {
      const ids = selectedZombies.map(z => z.application_id);
      const r = await axios.post(`${API}/acronis/orphans/cleanup`, { application_ids: ids }, { headers });
      const { removed = [], failed = [] } = r.data || {};
      toast.success(`Removed ${removed.length} of ${ids.length}${failed.length ? ` · ${failed.length} failed` : ""}`);
      setOrphans(prev => prev ? {
        ...prev,
        zombie_apps: prev.zombie_apps.filter(x => !removed.includes(x.application_id)),
        totals: { ...prev.totals, zombie_apps: Math.max(0, (prev.totals.zombie_apps || 0) - removed.length), total_orphans: Math.max(0, (prev.totals.total_orphans || 0) - removed.length) },
      } : prev);
      setSelectedZombies([]);
    } catch (e) { toast.error(e.response?.data?.detail || "Bulk cleanup failed"); }
    finally { setCleaning(false); }
  };

  const handleRemoveAgent = async (a, confirmed = false) => {
    if (!confirmed) { setOrphanCleanupTarget({ kind: "agent", item: a, bulk: false }); return; }
    try {
      await axios.delete(`${API}/acronis/agents/${a.agent_id}`, { headers });
      toast.success("Agent removed");
      setOrphans(prev => prev ? {
        ...prev,
        offline_consuming: prev.offline_consuming.filter(x => x.agent_id !== a.agent_id),
        totals: { ...prev.totals, offline_consuming: Math.max(0, (prev.totals.offline_consuming || 0) - 1), total_orphans: Math.max(0, (prev.totals.total_orphans || 0) - 1) },
      } : prev);
    } catch (e) { toast.error(e.response?.data?.detail || "Remove failed"); }
  };

  const handleBulkCleanupAgents = async (confirmed = false) => {
    if (selectedAgents.length === 0) { toast.error("No agents selected"); return; }
    if (!confirmed) { setOrphanCleanupTarget({ kind: "agent", bulk: true }); return; }
    setCleaning(true);
    try {
      const ids = selectedAgents.map(a => a.agent_id);
      const r = await axios.post(`${API}/acronis/agents/cleanup`, { agent_ids: ids }, { headers });
      const { removed = [], failed = [] } = r.data || {};
      toast.success(`Removed ${removed.length} of ${ids.length}${failed.length ? ` · ${failed.length} failed` : ""}`);
      setOrphans(prev => prev ? {
        ...prev,
        offline_consuming: prev.offline_consuming.filter(x => !removed.includes(x.agent_id)),
        totals: { ...prev.totals, offline_consuming: Math.max(0, (prev.totals.offline_consuming || 0) - removed.length), total_orphans: Math.max(0, (prev.totals.total_orphans || 0) - removed.length) },
      } : prev);
      setSelectedAgents([]);
    } catch (e) { toast.error(e.response?.data?.detail || "Bulk cleanup failed"); }
    finally { setCleaning(false); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const ds = dashData?.summary || {};
  const cs = compData?.stats || {};
  const vs = verifyData?.summary || {};
  const assurance = assuranceData?.confidence || { score: null, label: "Not assessed", evidence_coverage: 0, components: [], gaps: [] };
  const simulations = assuranceData?.simulations || [];
  const ah = agentsHealth?.summary || {};
  const liveCount = liveActivities.running?.length || 0;
  const sourceIssues = [
    !acronisConfig?.configured ? acronisConfig?.error || "Acronis API credentials have not been configured." : null,
    agentsHealth?.error ? `Agent health: ${agentsHealth.error}` : null,
    liveActivities?.error ? `Live activity feed: ${liveActivities.error}` : null,
  ].filter(Boolean);
  const backupSourceUnavailable = !loading && sourceIssues.length > 0;
  const backupTickerItems = [
    {
      key: "activity",
      icon: Activity,
      label: "Backup activity",
      detail: backupSourceUnavailable ? "Feed unavailable" : liveCount ? `${liveCount} run${liveCount === 1 ? "" : "s"} in progress` : "Standing by",
      tone: backupSourceUnavailable ? "critical" : "healthy",
      action: backupSourceUnavailable ? "settings" : "live",
      title: backupSourceUnavailable ? "Open Acronis integration settings" : "Open live backup activity",
    },
    {
      key: "failures",
      icon: XCircle,
      label: "Failed backups",
      detail: `${ds.failed || 0} need${ds.failed === 1 ? "s" : ""} attention`,
      tone: ds.failed ? "critical" : "healthy",
      action: "failed",
      title: "Review failed backups",
    },
    {
      key: "coverage",
      icon: Shield,
      label: "Protection coverage",
      detail: backupSourceUnavailable
        ? "Source unavailable"
        : cs.evidence_available
        ? `${cs.no_backup || 0} asset${cs.no_backup === 1 ? "" : "s"} without backup`
        : `${cs.not_assessed || 0} asset${cs.not_assessed === 1 ? "" : "s"} awaiting evidence`,
      tone: backupSourceUnavailable ? "critical" : cs.evidence_available && !cs.no_backup ? "healthy" : "warning",
      action: backupSourceUnavailable ? "settings" : "compliance",
      title: backupSourceUnavailable ? "Open Acronis integration settings" : "Open protection coverage",
    },
    {
      key: "recovery",
      icon: CheckCircle,
      label: "Recovery verification",
      detail: `${vs.pending || 0} test${vs.pending === 1 ? "" : "s"} pending`,
      tone: vs.pending ? "warning" : "healthy",
      action: "verify",
      title: "Open recovery evidence",
    },
    {
      key: "agents",
      icon: Wifi,
      label: "Backup agents",
      detail: backupSourceUnavailable ? "Status unavailable" : `${ah.online || 0}/${ah.total || 0} online`,
      tone: backupSourceUnavailable ? "critical" : ah.total && ah.online < ah.total ? "warning" : "healthy",
      action: backupSourceUnavailable ? "settings" : "status",
      title: backupSourceUnavailable ? "Open Acronis integration settings" : "Open backup agent status",
    },
    {
      key: "alerts",
      icon: Bell,
      label: "Acronis alerts",
      detail: backupSourceUnavailable ? "Monitoring unavailable" : acronisAlerts.length ? `${acronisAlerts.length} active alert${acronisAlerts.length === 1 ? "" : "s"}` : "No active alerts",
      tone: backupSourceUnavailable ? "critical" : acronisAlerts.length ? "warning" : "healthy",
      action: backupSourceUnavailable ? "settings" : "acronis",
      title: backupSourceUnavailable ? "Open Acronis integration settings" : "Open Acronis alerts",
    },
  ];
  const normalizedBackupSearch = search.trim().toLowerCase();
  const filteredBackups = (dashData?.backups || []).filter((backup) => {
    const matchesStatus = statusFilter === "all" || backup.status === statusFilter;
    if (!matchesStatus) return false;
    if (!normalizedBackupSearch) return true;
    return [
      backup.client_name,
      backup.device_name,
      backup.plan_names,
      backup.status,
    ].some((value) => String(value || "").toLowerCase().includes(normalizedBackupSearch));
  });
  const dashboardTotalPages = Math.max(1, Math.ceil(filteredBackups.length / dashboardPageSize));
  const dashboardSafePage = Math.min(dashboardPage, dashboardTotalPages);
  const dashboardStartIndex = (dashboardSafePage - 1) * dashboardPageSize;
  const dashboardPageBackups = filteredBackups.slice(dashboardStartIndex, dashboardStartIndex + dashboardPageSize);
  const dashboardRangeStart = filteredBackups.length ? dashboardStartIndex + 1 : 0;
  const dashboardRangeEnd = Math.min(dashboardStartIndex + dashboardPageSize, filteredBackups.length);

  return (
    <div className="space-y-5" data-testid="backup-center-page">
      <OperationalPageHeader
        eyebrow="Data protection"
        title="Backup Centre"
        description="Monitor protected assets, investigate backup exceptions, validate recoverability, and retain auditable recovery evidence."
        icon={HardDrive}
        tone="sky"
        actions={<>
          <Button variant="outline" onClick={openVerificationRequest} data-testid="header-schedule-recovery-test"><Play className="mr-1.5 h-4 w-4" />Recovery test</Button>
          <Button variant="outline" onClick={() => handleOpenAcronis()} data-testid="open-acronis-console"><ExternalLink className="mr-1.5 h-4 w-4" />Acronis Cloud</Button>
          <Button variant="outline" onClick={() => { fetchData(); fetchLive(); }}><RefreshCw className="mr-1.5 h-4 w-4" />Refresh</Button>
        </>}
      />

      <BackupOperationsTicker
        items={backupTickerItems}
        statusText={backupSourceUnavailable ? "Acronis source needs attention" : "Select an item to investigate"}
        onNavigate={(action) => {
          if (action === "settings") openAcronisSettings();
          else if (action === "failed") openDashboardFilter("failed");
          else selectTab(action);
        }}
      />

      {backupSourceUnavailable && (
        <Card className="border-rose-500/30 bg-rose-500/[0.045]" data-testid="backup-source-warning">
          <CardContent className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
              <div><p className="text-sm font-semibold text-rose-100">Backup source unavailable</p><p className="mt-0.5 text-xs text-muted-foreground">{sourceIssues[0]}</p></div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button size="sm" variant="ghost" className="text-rose-100 hover:bg-rose-500/10" onClick={() => { fetchData(); fetchLive(); }}>Retry connection</Button>
              <Button size="sm" variant="outline" className="border-rose-400/35 text-rose-100 hover:bg-rose-500/10" onClick={openAcronisSettings}>Open Acronis settings</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Hero metric strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <HeroMetric label="Total backups" value={ds.total_jobs || 0} icon={Database} glow="cyan" subtitle="All protected workloads" onClick={() => openDashboardFilter("all")} />
        <HeroMetric label="Successful" value={ds.successful || 0} icon={CheckCircle} glow="emerald" subtitle={`${ds.success_rate || 0}% success rate`} onClick={() => openDashboardFilter("success")} />
        <HeroMetric label="Failed" value={ds.failed || 0} icon={XCircle} glow="rose" subtitle={ds.failed ? "Needs attention" : "All healthy"} onClick={() => openDashboardFilter("failed")} />
        <HeroMetric label="Running" value={liveCount} icon={Activity} glow={backupSourceUnavailable ? "rose" : "violet"} subtitle={backupSourceUnavailable ? "Source unavailable" : "Live now"} onClick={() => backupSourceUnavailable ? openAcronisSettings() : selectTab("live")} />
        <HeroMetric label="Online agents" value={ah.online || 0} icon={Wifi} glow={backupSourceUnavailable ? "rose" : "emerald"} subtitle={backupSourceUnavailable ? "Source unavailable" : `${ah.online_pct || 0}% of ${ah.total || 0}`} onClick={() => backupSourceUnavailable ? openAcronisSettings() : selectTab("status")} />
        <HeroMetric label="Active alerts" value={acronisAlerts.length} icon={Bell} glow={backupSourceUnavailable ? "rose" : acronisAlerts.length > 0 ? "amber" : "cyan"} subtitle={backupSourceUnavailable ? "Source unavailable" : acronisUsage?.critical_alerts ? `${acronisUsage.critical_alerts} critical` : "Acronis monitoring"} onClick={() => backupSourceUnavailable ? openAcronisSettings() : selectTab("acronis")} />
      </div>

      <Tabs value={tab} onValueChange={selectTab}>
        <BackupLifecycleNavigator activeTab={tab} onSelect={selectTab} orphanCount={orphans?.totals?.total_orphans || 0} />

        {/* DASHBOARD */}
        <TabsContent value="dashboard" className="mt-4 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search customer, machine, plan or status..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                aria-label="Search backup records"
                data-testid="backup-dashboard-search"
              />
            </div>
            <Select value={statusFilter} onValueChange={selectStatusFilter}>
              <SelectTrigger className="w-full sm:w-44" aria-label="Filter backup status" data-testid="backup-status-filter"><SelectValue /></SelectTrigger>
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
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Tenant</TableHead><TableHead>Machine</TableHead><TableHead>Plan</TableHead><TableHead>Last Backup</TableHead><TableHead>Next Run</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {filteredBackups.length === 0 && (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-12">
                        <Cloud className="w-10 h-10 mx-auto mb-2 opacity-30" />
                        <p className="text-sm">{(dashData?.backups || []).length ? "No backup records match these filters." : "No backup data from Acronis yet."}</p>
                        <p className="text-[11px] mt-1 opacity-70">
                          {(dashData?.backups || []).length ? "Adjust the search or status filter to widen the result set." : "Once Acronis returns resource statuses, machines and their plans will appear here in real time."}
                        </p>
                      </TableCell></TableRow>
                    )}
                    {dashboardPageBackups.map((b, i) => {
                      const Ico = STATUS_ICON[b.status] || Clock;
                      return (
                        <TableRow key={`k-${b.id || dashboardStartIndex + i}`} data-testid={`backup-row-${b.id || dashboardStartIndex + i}`}>
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
              </div>
              <div className="flex flex-col gap-3 border-t border-border/60 bg-muted/[0.12] px-4 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid="backup-dashboard-pagination">
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>Showing <strong className="text-foreground">{dashboardRangeStart}–{dashboardRangeEnd}</strong> of <strong className="text-foreground">{filteredBackups.length}</strong></span>
                  <Select value={String(dashboardPageSize)} onValueChange={(value) => setDashboardPageSize(Number(value))}>
                    <SelectTrigger className="h-8 w-[112px]" aria-label="Backup rows per page"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="25">25 per page</SelectItem>
                      <SelectItem value="50">50 per page</SelectItem>
                      <SelectItem value="100">100 per page</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between gap-2 sm:justify-end">
                  <span className="mr-1 text-xs text-muted-foreground">Page {dashboardSafePage} of {dashboardTotalPages}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={() => setDashboardPage(Math.max(1, dashboardSafePage - 1))}
                    disabled={dashboardSafePage <= 1}
                    aria-label="Previous backup page"
                  >
                    <ChevronLeft className="mr-1 h-3.5 w-3.5" />Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={() => setDashboardPage(Math.min(dashboardTotalPages, dashboardSafePage + 1))}
                    disabled={dashboardSafePage >= dashboardTotalPages}
                    aria-label="Next backup page"
                  >
                    Next<ChevronRight className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
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
        <TabsContent value="orphans" className="mt-4 space-y-3">
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
                    Find unprotected resources, stale backups, zombie plans pointing to deleted machines, and offline agents still consuming storage. Tick rows and click <strong className="text-rose-300">Remove Selected</strong> to clean up at the click of a button.
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
              {/* Customise toolbar */}
              <orphanGrid.EditBar testIdPrefix="orphans-" />

              <BackupResponsiveGridLayout
                className={`layout ${orphanGrid.editMode ? "nx-edit-mode" : ""}`}
                layouts={orphanGrid.visibleLayouts}
                breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
                cols={{ lg: 12, md: 12, sm: 8, xs: 4, xxs: 2 }}
                rowHeight={48}
                margin={[12, 12]}
                containerPadding={[0, 0]}
                isDraggable={orphanGrid.editMode}
                isResizable={orphanGrid.editMode}
                onLayoutChange={orphanGrid.onLayoutChange}
                draggableCancel=".nx-widget-hide,button,a,input,kbd,select,[role='combobox']"
                useCSSTransforms
                compactType="vertical"
              >
                {!orphanGrid.hiddenWidgets.has("metrics") && (
                  <div key="metrics" className="nx-widget-card">
                    <orphanGrid.HideBtn id="metrics" />
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 h-full">
                      <HeroMetric label="Unprotected" value={orphans.totals.unprotected || 0} icon={FileQuestion} glow="rose" subtitle="No backup policy" />
                      <HeroMetric label="Stale Backups" value={orphans.totals.stale || 0} icon={Clock} glow="amber" subtitle={`${orphans.stale_threshold_days || 30}+ days old`} />
                      <HeroMetric label="Zombie Plans" value={orphans.totals.zombie_apps || 0} icon={Skull} glow="violet" subtitle="Missing resource" />
                      <HeroMetric label="Offline Agents" value={orphans.totals.offline_consuming || 0} icon={WifiOff} glow="rose" subtitle="May still bill" />
                    </div>
                  </div>
                )}

                {!orphanGrid.hiddenWidgets.has("unprotected") && orphans.unprotected?.length > 0 && (
                  <div key="unprotected" className="nx-widget-card">
                    <orphanGrid.HideBtn id="unprotected" />
                    <Card className="h-full flex flex-col">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center justify-between">
                          <span className="flex items-center gap-2"><FileQuestion className="w-4 h-4 text-rose-400" />Unprotected Resources ({orphans.unprotected.length})</span>
                          <div className="flex gap-2">
                            {selectedOrphans.length > 0 && (
                              <>
                                <Button size="sm" variant="outline" className="h-7 text-xs border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10" onClick={() => openApplyPlan(selectedOrphans)} data-testid="apply-plan-bulk-btn">
                                  <Wand2 className="w-3 h-3 mr-1" />Apply Plan to {selectedOrphans.length}
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedOrphans([])}>Clear</Button>
                              </>
                            )}
                          </div>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-0 flex-1 min-h-0">
                        <ScrollArea className="h-full">
                          <Table>
                            <TableHeader>
                              <TableRow><TableHead className="w-8"></TableHead><TableHead>Resource</TableHead><TableHead>Type</TableHead><TableHead>Tenant</TableHead><TableHead>Severity</TableHead><TableHead className="text-right">Actions</TableHead></TableRow>
                            </TableHeader>
                            <TableBody>
                              {orphans.unprotected.map(u => {
                                const isSelected = selectedOrphans.find(s => s.resource_id === u.resource_id);
                                return (
                                  <TableRow key={u.resource_id} className={isSelected ? "bg-cyan-500/5" : ""}>
                                    <TableCell className="px-2">
                                      <input type="checkbox" checked={!!isSelected} onChange={() => toggleOrphanSelection(u)} className="w-3.5 h-3.5 rounded border-border" data-testid={`orphan-select-${u.resource_id}`} />
                                    </TableCell>
                                    <TableCell className="font-medium text-sm">{u.resource_name}</TableCell>
                                    <TableCell className="text-xs capitalize">{u.resource_type}</TableCell>
                                    <TableCell className="text-xs text-muted-foreground">{u.tenant_name || "-"}</TableCell>
                                    <TableCell><Badge variant="destructive" className="text-[10px]">{u.severity}</Badge></TableCell>
                                    <TableCell className="text-right">
                                      <Button variant="ghost" size="sm" className="h-7 px-2 text-cyan-300 hover:bg-cyan-500/10" onClick={() => openApplyPlan([u])} data-testid={`apply-plan-${u.resource_id}`}>
                                        <Wand2 className="w-3 h-3 mr-1" />Apply Plan
                                      </Button>
                                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleOpenAcronis(u.resource_id)} title="Open in Acronis"><ExternalLink className="w-3 h-3" /></Button>
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
                )}

                {!orphanGrid.hiddenWidgets.has("stale") && orphans.stale?.length > 0 && (
                  <div key="stale" className="nx-widget-card">
                    <orphanGrid.HideBtn id="stale" />
                    <Card className="h-full flex flex-col">
                      <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Clock className="w-4 h-4 text-amber-400" />Stale Backups ({orphans.stale.length})</CardTitle></CardHeader>
                      <CardContent className="p-0 flex-1 min-h-0">
                        <ScrollArea className="h-full">
                          <Table>
                            <TableHeader><TableRow><TableHead>Resource</TableHead><TableHead>Last Backup</TableHead><TableHead>Days Stale</TableHead><TableHead>Tenant</TableHead><TableHead>Severity</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                            <TableBody>
                              {orphans.stale.map(s => (
                                <TableRow key={s.resource_id}>
                                  <TableCell className="font-medium text-sm">{s.resource_name}</TableCell>
                                  <TableCell className="text-xs">{s.last_backup ? new Date(s.last_backup).toLocaleDateString() : "Never"}</TableCell>
                                  <TableCell><Badge variant="outline" className="text-[10px] font-mono">{s.days_stale}d</Badge></TableCell>
                                  <TableCell className="text-xs text-muted-foreground">{s.tenant_name || "-"}</TableCell>
                                  <TableCell><Badge variant={s.severity === "critical" ? "destructive" : "outline"} className="text-[10px]">{s.severity}</Badge></TableCell>
                                  <TableCell className="text-right">
                                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleOpenAcronis(s.resource_id)} title="Open in Acronis"><ExternalLink className="w-3 h-3" /></Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  </div>
                )}

                {/* ─── ZOMBIE PLANS — with bulk + per-row delete ──────── */}
                {!orphanGrid.hiddenWidgets.has("zombies") && orphans.zombie_apps?.length > 0 && (
                  <div key="zombies" className="nx-widget-card">
                    <orphanGrid.HideBtn id="zombies" />
                    <Card className="h-full flex flex-col border-violet-500/30">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center justify-between flex-wrap gap-2">
                          <span className="flex items-center gap-2"><Skull className="w-4 h-4 text-violet-400" />Zombie Backup Plans ({orphans.zombie_apps.length})</span>
                          <div className="flex gap-1.5 items-center">
                            <Button
                              size="sm" variant="outline"
                              className="h-7 text-[11px]"
                              onClick={() => setSelectedZombies(selectedZombies.length === orphans.zombie_apps.length ? [] : [...orphans.zombie_apps])}
                              data-testid="zombies-select-all-btn"
                            >
                              {selectedZombies.length === orphans.zombie_apps.length ? "Deselect All" : "Select All"}
                            </Button>
                            {selectedZombies.length > 0 && (
                              <Button
                                size="sm" variant="destructive"
                                className="h-7 text-[11px]"
                                onClick={handleBulkCleanupZombies}
                                disabled={cleaning}
                                data-testid="zombies-bulk-cleanup-btn"
                              >
                                {cleaning ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Trash2 className="w-3 h-3 mr-1" />}
                                Remove {selectedZombies.length} Selected
                              </Button>
                            )}
                          </div>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-0 flex-1 min-h-0">
                        <ScrollArea className="h-full">
                          <Table>
                            <TableHeader>
                              <TableRow><TableHead className="w-8"></TableHead><TableHead>Plan</TableHead><TableHead>Missing Resource</TableHead><TableHead>Severity</TableHead><TableHead className="text-right">Action</TableHead></TableRow>
                            </TableHeader>
                            <TableBody>
                              {orphans.zombie_apps.map(z => {
                                const isSelected = !!selectedZombies.find(s => s.application_id === z.application_id);
                                return (
                                  <TableRow key={z.application_id} className={isSelected ? "bg-violet-500/10" : ""}>
                                    <TableCell className="px-2">
                                      <input type="checkbox" checked={isSelected} onChange={() => toggleZombieSelection(z)} className="w-3.5 h-3.5 rounded border-border" data-testid={`zombie-select-${z.application_id}`} />
                                    </TableCell>
                                    <TableCell className="font-medium text-sm">{z.policy_name || "(unnamed plan)"}</TableCell>
                                    <TableCell className="text-xs text-muted-foreground">{z.missing_resource_name}</TableCell>
                                    <TableCell><Badge variant="outline" className="text-[10px]">{z.severity}</Badge></TableCell>
                                    <TableCell className="text-right">
                                      <Button variant="ghost" size="sm" className="h-7 px-2 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10" onClick={() => handleRemoveZombie(z)} data-testid={`zombie-remove-${z.application_id}`}>
                                        <Trash2 className="w-3 h-3 mr-1" />Remove
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
                  </div>
                )}

                {/* ─── OFFLINE AGENTS — with bulk + per-row uninstall ──────── */}
                {!orphanGrid.hiddenWidgets.has("offline") && orphans.offline_consuming?.length > 0 && (
                  <div key="offline" className="nx-widget-card">
                    <orphanGrid.HideBtn id="offline" />
                    <Card className="h-full flex flex-col border-rose-500/30">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center justify-between flex-wrap gap-2">
                          <span className="flex items-center gap-2"><WifiOff className="w-4 h-4 text-rose-400" />Long-Offline Agents ({orphans.offline_consuming.length})</span>
                          <div className="flex gap-1.5 items-center">
                            <Button
                              size="sm" variant="outline"
                              className="h-7 text-[11px]"
                              onClick={() => setSelectedAgents(selectedAgents.length === orphans.offline_consuming.length ? [] : [...orphans.offline_consuming])}
                              data-testid="agents-select-all-btn"
                            >
                              {selectedAgents.length === orphans.offline_consuming.length ? "Deselect All" : "Select All"}
                            </Button>
                            {selectedAgents.length > 0 && (
                              <Button
                                size="sm" variant="destructive"
                                className="h-7 text-[11px]"
                                onClick={handleBulkCleanupAgents}
                                disabled={cleaning}
                                data-testid="agents-bulk-cleanup-btn"
                              >
                                {cleaning ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Trash2 className="w-3 h-3 mr-1" />}
                                Uninstall {selectedAgents.length} Selected
                              </Button>
                            )}
                          </div>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-0 flex-1 min-h-0">
                        <ScrollArea className="h-full">
                          <Table>
                            <TableHeader>
                              <TableRow><TableHead className="w-8"></TableHead><TableHead>Agent</TableHead><TableHead>Last Seen</TableHead><TableHead>Days Offline</TableHead><TableHead>Tenant</TableHead><TableHead>Severity</TableHead><TableHead className="text-right">Action</TableHead></TableRow>
                            </TableHeader>
                            <TableBody>
                              {orphans.offline_consuming.map(o => {
                                const isSelected = !!selectedAgents.find(s => s.agent_id === o.agent_id);
                                return (
                                  <TableRow key={o.agent_id} className={isSelected ? "bg-rose-500/10" : ""}>
                                    <TableCell className="px-2">
                                      <input type="checkbox" checked={isSelected} onChange={() => toggleAgentSelection(o)} className="w-3.5 h-3.5 rounded border-border" data-testid={`agent-select-${o.agent_id}`} />
                                    </TableCell>
                                    <TableCell className="font-medium text-sm">{o.agent_name}</TableCell>
                                    <TableCell className="text-xs">{o.last_seen ? new Date(o.last_seen).toLocaleDateString() : "-"}</TableCell>
                                    <TableCell><Badge variant="outline" className="text-[10px] font-mono">{o.days_offline}d</Badge></TableCell>
                                    <TableCell className="text-xs text-muted-foreground">{o.tenant_name || "-"}</TableCell>
                                    <TableCell><Badge variant="outline" className="text-[10px]">{o.severity}</Badge></TableCell>
                                    <TableCell className="text-right">
                                      <Button variant="ghost" size="sm" className="h-7 px-2 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10" onClick={() => handleRemoveAgent(o)} data-testid={`agent-remove-${o.agent_id}`}>
                                        <Trash2 className="w-3 h-3 mr-1" />Uninstall
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
                  </div>
                )}
              </BackupResponsiveGridLayout>

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
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              <HeroMetric label="Total devices" value={cs.total_devices || 0} icon={HardDrive} glow="cyan" subtitle="Assets in assessment scope" />
              <HeroMetric label="Compliant" value={cs.compliant || 0} icon={CheckCircle} glow="emerald" subtitle="Backup evidence verified" />
              <HeroMetric label="Non-compliant" value={cs.non_compliant || 0} icon={XCircle} glow="rose" subtitle="Policy requirements missed" />
              <HeroMetric label={cs.evidence_available ? "No backup" : "Not assessed"} value={cs.evidence_available ? cs.no_backup || 0 : cs.not_assessed || 0} icon={AlertTriangle} glow="amber" subtitle={cs.evidence_available ? "Protection gap detected" : "Awaiting source evidence"} />
              <HeroMetric label="Verified rate" value={cs.compliance_pct || 0} suffix="%" icon={Shield} glow="sky" subtitle="Evidence-backed coverage" />
            </div>
            {!cs.evidence_available && <Card className="border-amber-500/25 bg-amber-500/[0.035]"><CardContent className="flex items-start gap-3 py-3"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" /><div><p className="text-sm font-medium text-amber-100">Compliance evidence is still pending</p><p className="mt-0.5 text-xs text-muted-foreground">No backup source has reported to NexusMSP yet. Connect or sync Acronis before treating any device as protected or unprotected.</p></div></CardContent></Card>}
            <Card>
              <CardHeader><CardTitle className="text-base">Device Backup Status</CardTitle></CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
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
                </div>
              </CardContent>
            </Card>
          </>}
        </TabsContent>

        {/* BILLING */}
        <TabsContent value="billing" className="mt-4">
          <BillingTab token={token} onOpenTenants={() => selectTab("tenants")} />
        </TabsContent>

        {/* VERIFICATION */}
        <TabsContent value="verify" className="mt-4 space-y-4">
          {!verifyData ? <p className="text-muted-foreground text-center py-12">No verification data</p> : <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold">Guaranteed Recovery workspace</p><p className="mt-1 max-w-3xl text-xs text-muted-foreground">Prove that protected workloads can be recovered. Confidence uses observed provider and restore evidence; missing telemetry remains visibly unassessed.</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={openRecoverySimulation} data-testid="simulate-recovery"><Route className="mr-1.5 h-4 w-4" />Simulate recovery</Button><Button onClick={openVerificationRequest} data-testid="run-backup-verification"><Play className="mr-1 h-4 w-4" />Schedule test</Button></div></div>

            <Card className="overflow-hidden border-cyan-500/20 bg-[linear-gradient(135deg,rgba(6,182,212,0.07),rgba(59,130,246,0.025),rgba(15,23,42,0.18))]">
              <CardHeader className="border-b border-cyan-500/15">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Recovery assurance</p><CardTitle className="mt-1 flex items-center gap-2 text-lg"><Gauge className="h-5 w-5 text-cyan-300" />Backup Confidence</CardTitle><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Success is not enough. Nexus separates backup execution, data integrity, measured recovery, immutability and verification freshness.</p></div>
                  <div className="flex min-w-[220px] flex-col gap-2"><Select value={assuranceClientId || "all"} onValueChange={changeAssuranceScope} disabled={assuranceLoading}><SelectTrigger aria-label="Recovery assurance customer scope" className="h-9 border-cyan-400/20 bg-black/15 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All managed clients</SelectItem>{clients.map(client => <SelectItem key={client.id} value={client.id}>{client.name || client.company_name || client.id}</SelectItem>)}</SelectContent></Select><div className="rounded-2xl border border-cyan-400/20 bg-black/15 p-4 text-right"><p className="text-4xl font-semibold tracking-tight text-cyan-100">{assuranceLoading ? <Loader2 className="ml-auto h-8 w-8 animate-spin" /> : assurance.score == null ? "—" : `${assurance.score}%`}</p><p className="mt-1 text-xs font-medium text-cyan-200">{assurance.label}</p><p className="mt-1 text-[11px] text-muted-foreground">{assurance.evidence_coverage}% evidence coverage</p></div></div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 p-4">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  {(assurance.components || []).map(component => <div key={component.id} className="rounded-xl border border-white/[0.09] bg-black/[0.12] p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold">{component.label}</span><span className={`text-sm font-semibold ${component.score == null ? "text-muted-foreground" : component.score >= 90 ? "text-emerald-300" : component.score >= 60 ? "text-amber-300" : "text-rose-300"}`}>{component.score == null ? "—" : `${component.score}%`}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><div className={`h-full rounded-full ${component.score == null ? "bg-zinc-600" : component.score >= 90 ? "bg-emerald-400" : component.score >= 60 ? "bg-amber-400" : "bg-rose-400"}`} style={{ width: `${component.score == null ? 0 : component.score}%` }} /></div><p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{component.detail}</p>{component.gap && <p className="mt-2 text-[10px] text-amber-200/80">Not assessed · {component.gap}</p>}</div>)}
                </div>
                <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center"><div className="rounded-xl border border-white/[0.08] bg-black/[0.10] p-3"><p className="text-xs font-medium">Evidence boundary</p><p className="mt-1 text-[11px] text-muted-foreground">{assuranceData?.engine_boundary?.statement || "Nexus orchestrates recovery evidence while connected backup providers remain authoritative for backup execution."}</p></div><Badge variant="outline" className="h-7 border-violet-400/25 px-3 text-violet-200"><LockKeyhole className="mr-1.5 h-3.5 w-3.5" />Native engine: {assuranceData?.engine_boundary?.native_engine_status || "roadmap"}</Badge></div>
              </CardContent>
            </Card>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              <HeroMetric label="Total tests" value={vs.total_tests || 0} icon={Database} glow="cyan" subtitle="Recorded recovery evidence" />
              <HeroMetric label="Pass rate" value={vs.pass_rate_pct || 0} suffix="%" icon={CheckCircle} glow="emerald" subtitle="Verified successful restores" />
              <HeroMetric label="Pending" value={vs.pending || 0} icon={Clock} glow="amber" subtitle="Outcome still required" />
              <HeroMetric label="Failed" value={vs.failed || 0} icon={XCircle} glow="rose" subtitle="Recovery exceptions" />
              <HeroMetric label="Average restore" value={vs.avg_restore_time_min != null ? vs.avg_restore_time_min : "—"} suffix={vs.avg_restore_time_min != null ? "m" : ""} animated={vs.avg_restore_time_min != null} icon={Activity} glow="violet" subtitle={vs.avg_restore_time_min != null ? "Measured recovery time" : "No measured result yet"} />
            </div>
            <div className="space-y-2">
              {(verifyData.tests || []).length === 0 && (
                <Card className="border-sky-500/20 bg-sky-500/[0.025]">
                  <CardContent className="py-10 text-center">
                    <CheckCircle className="mx-auto h-10 w-10 text-sky-300/70" />
                    <p className="mt-3 text-sm font-semibold">No recovery evidence recorded yet</p>
                    <p className="mx-auto mt-1 max-w-lg text-xs text-muted-foreground">Schedule the first customer recovery test to start measuring restore time, integrity, and pass-rate evidence.</p>
                    <Button className="mt-4" size="sm" onClick={openVerificationRequest}><Play className="mr-1.5 h-3.5 w-3.5" />Schedule first test</Button>
                  </CardContent>
                </Card>
              )}
              {(verifyData.tests || []).map(t => (
                <Card key={t.id}>
                  <CardContent className="pt-3 pb-3">
                    <div className="flex items-center gap-4">
                      {t.result === "pass" ? <CheckCircle className="w-5 h-5 text-green-500" /> : t.result === "pending" ? <Clock className="w-5 h-5 text-amber-400" /> : <XCircle className="w-5 h-5 text-red-500" />}
                      <div className="flex-1">
                        <div className="flex items-center gap-2"><span className="font-medium text-sm">{t.client_name}</span><Badge variant="outline" className="text-xs">{t.backup_type}</Badge><Badge variant="secondary" className="text-xs">{t.backup_solution}</Badge></div>
                        <div className="text-xs text-muted-foreground">Restore: {t.restore_time_minutes != null ? `${t.restore_time_minutes}min` : "Awaiting test"} | Integrity: {t.data_integrity_check || "Awaiting test"} {t.notes && `| ${t.notes}`}</div>
                      </div>
                      <Badge variant={t.result === "pass" ? "default" : t.result === "pending" ? "outline" : "destructive"} className={t.result === "pending" ? "border-amber-500/30 text-amber-300" : ""}>{t.result}</Badge>
                      <span className="text-xs text-muted-foreground">{new Date(t.tested_at).toLocaleDateString()}</span>
                      {t.result === "pending" && <Button variant="outline" size="sm" onClick={() => openVerificationCompletion(t)} data-testid={`complete-backup-verification-${t.id}`}>Record outcome</Button>}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card className="border-violet-500/20 bg-violet-500/[0.025]">
              <CardHeader><div className="flex items-center justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><Route className="h-4 w-4 text-violet-300" />Recovery simulations</CardTitle><p className="mt-1 text-xs text-muted-foreground">Read-only previews retain targets, assumptions, evidence and blockers. They never initiate a restore.</p></div><Button size="sm" variant="outline" onClick={openRecoverySimulation}>New simulation</Button></div></CardHeader>
              <CardContent className="space-y-2">
                {simulations.length === 0 ? <div className="rounded-xl border border-white/[0.08] bg-black/[0.10] p-5 text-center text-xs text-muted-foreground">No recovery simulation has been recorded yet.</div> : simulations.slice(0, 6).map(item => <button type="button" key={item.id} onClick={() => setSimulationResult(item)} className="flex w-full flex-col gap-2 rounded-xl border border-white/[0.08] bg-black/[0.10] p-3 text-left transition-colors hover:border-violet-400/25 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">{item.client_name}</span><Badge variant="outline" className="text-[10px]">{item.workload}</Badge></div><p className="mt-1 text-[11px] text-muted-foreground">RTO {item.target_rto_hours}h · RPO {item.target_rpo_hours}h · {item.blockers?.length || 0} blocker{item.blockers?.length === 1 ? "" : "s"}</p></div><div className="flex items-center gap-2"><Badge variant="outline" className={item.readiness === "ready_with_evidence" ? "border-emerald-400/30 text-emerald-200" : item.readiness === "gaps_detected" ? "border-amber-400/30 text-amber-200" : "border-rose-400/30 text-rose-200"}>{String(item.readiness || "not_assessed").replaceAll("_", " ")}</Badge><Eye className="h-4 w-4 text-muted-foreground" /></div></button>)}
              </CardContent>
            </Card>
          </>}
        </TabsContent>
      </Tabs>

      <Dialog open={!!simulationRequest} onOpenChange={(open) => { if (!open && !simulationSaving) setSimulationRequest(null); }}>
        <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto border-violet-400/20 bg-background p-0" data-testid="recovery-simulation-dialog">
          <DialogHeader className="border-b border-violet-400/15 bg-[linear-gradient(135deg,rgba(139,92,246,0.13),rgba(15,23,42,0.94))] px-6 py-5 pr-14">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300">Recovery assurance</p>
            <DialogTitle className="mt-1 flex items-center gap-2 text-xl"><span className="flex h-9 w-9 items-center justify-center rounded-xl border border-violet-400/25 bg-violet-400/10"><Route className="h-4 w-4 text-violet-300" /></span>Simulate customer recovery</DialogTitle>
            <DialogDescription>Preview whether current evidence supports the required RTO and RPO. This records a plan only—no provider call, restore, failover or production change occurs.</DialogDescription>
          </DialogHeader>
          {simulationRequest && <div className="space-y-4 px-6 py-5">
            <div className="rounded-xl border border-amber-400/20 bg-amber-500/[0.05] p-3 text-xs text-amber-100"><AlertTriangle className="mr-2 inline h-4 w-4" />Simulation results are evidence-dependent estimates, not a recovery guarantee. Validate them with a measured restore test.</div>
            <div><label className="text-sm font-medium">Customer</label><Select value={simulationRequest.client_id} onValueChange={(client_id) => setSimulationRequest(current => ({ ...current, client_id }))}><SelectTrigger className="mt-1"><SelectValue placeholder="Choose customer" /></SelectTrigger><SelectContent>{clients.map(client => <SelectItem key={client.id} value={client.id}>{client.name || client.company_name || client.id}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="text-sm font-medium">Workload or service</label><Input className="mt-1" value={simulationRequest.workload} onChange={event => setSimulationRequest(current => ({ ...current, workload: event.target.value }))} placeholder="e.g. Finance SQL and application server" /></div>
            <div className="grid gap-3 sm:grid-cols-3"><div><label className="text-sm font-medium">Target RTO</label><div className="relative"><Input className="mt-1 pr-12" type="number" min="0.1" max="720" step="0.1" value={simulationRequest.target_rto_hours} onChange={event => setSimulationRequest(current => ({ ...current, target_rto_hours: event.target.value }))} /><span className="absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-[11px] text-muted-foreground">hours</span></div></div><div><label className="text-sm font-medium">Target RPO</label><div className="relative"><Input className="mt-1 pr-12" type="number" min="0.1" max="720" step="0.1" value={simulationRequest.target_rpo_hours} onChange={event => setSimulationRequest(current => ({ ...current, target_rpo_hours: event.target.value }))} /><span className="absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-[11px] text-muted-foreground">hours</span></div></div><div><label className="text-sm font-medium">Protected data</label><div className="relative"><Input className="mt-1 pr-9" type="number" min="0" value={simulationRequest.data_size_gb} onChange={event => setSimulationRequest(current => ({ ...current, data_size_gb: event.target.value }))} placeholder="Optional" /><span className="absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-[11px] text-muted-foreground">GB</span></div></div></div>
            <div><label className="text-sm font-medium">Dependencies in restore order</label><Input className="mt-1" value={simulationRequest.dependencies} onChange={event => setSimulationRequest(current => ({ ...current, dependencies: event.target.value }))} placeholder="Domain Controller, DNS, Application Server" /><p className="mt-1 text-[11px] text-muted-foreground">Separate dependencies with commas. The workload is restored after these services.</p></div>
            <div><label className="text-sm font-medium">Assumptions and recovery constraints</label><Textarea className="mt-1 min-h-20" value={simulationRequest.assumptions} onChange={event => setSimulationRequest(current => ({ ...current, assumptions: event.target.value }))} placeholder="Available bandwidth, alternate site, credentials, licensing, maintenance window…" /></div>
          </div>}
          <DialogFooter className="border-t bg-muted/20 px-6 py-4"><Button variant="outline" onClick={() => setSimulationRequest(null)} disabled={simulationSaving}>Cancel</Button><Button onClick={submitRecoverySimulation} disabled={simulationSaving || !simulationRequest?.client_id || !simulationRequest?.workload.trim()}>{simulationSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Record simulation</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!simulationResult} onOpenChange={(open) => { if (!open) setSimulationResult(null); }}>
        <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto border-cyan-400/20 bg-background p-0" data-testid="recovery-simulation-result-dialog">
          <DialogHeader className="border-b border-cyan-400/15 bg-[linear-gradient(135deg,rgba(6,182,212,0.12),rgba(15,23,42,0.94))] px-6 py-5 pr-14">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Recorded recovery preview</p>
            <DialogTitle className="mt-1 flex items-center gap-2 text-xl"><Gauge className="h-5 w-5 text-cyan-300" />{simulationResult?.client_name} · {simulationResult?.workload}</DialogTitle>
            <DialogDescription>Explainable recovery readiness based on the evidence Nexus could observe when this simulation was created.</DialogDescription>
          </DialogHeader>
          {simulationResult && <div className="space-y-4 px-6 py-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><div className="rounded-xl border border-white/[0.08] bg-black/[0.10] p-3"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Readiness</p><p className="mt-1 text-sm font-semibold capitalize">{String(simulationResult.readiness).replaceAll("_", " ")}</p></div><div className="rounded-xl border border-white/[0.08] bg-black/[0.10] p-3"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">RTO</p><p className="mt-1 text-sm font-semibold capitalize">{simulationResult.rto_status?.replaceAll("_", " ")}</p><p className="text-[10px] text-muted-foreground">Target {simulationResult.target_rto_hours}h</p></div><div className="rounded-xl border border-white/[0.08] bg-black/[0.10] p-3"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">RPO</p><p className="mt-1 text-sm font-semibold capitalize">{simulationResult.rpo_status?.replaceAll("_", " ")}</p><p className="text-[10px] text-muted-foreground">Target {simulationResult.target_rpo_hours}h</p></div><div className="rounded-xl border border-white/[0.08] bg-black/[0.10] p-3"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Immutability</p><p className="mt-1 text-sm font-semibold capitalize">{simulationResult.immutability?.replaceAll("_", " ")}</p></div></div>
            <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-cyan-400/15 bg-cyan-500/[0.035] p-4"><p className="text-xs font-semibold text-cyan-100">Recovery estimate</p><p className="mt-2 text-2xl font-semibold">{simulationResult.estimated_restore_range_minutes ? `${simulationResult.estimated_restore_range_minutes[0]}–${simulationResult.estimated_restore_range_minutes[1]} min` : "Not enough evidence"}</p><p className="mt-1 text-[11px] text-muted-foreground">Based on {simulationResult.evidence?.successful_restore_tests || 0} successful measured restore test{simulationResult.evidence?.successful_restore_tests === 1 ? "" : "s"}.</p></div><div className="rounded-xl border border-violet-400/15 bg-violet-500/[0.035] p-4"><p className="text-xs font-semibold text-violet-100">Recovery staging</p><p className="mt-2 text-2xl font-semibold">{simulationResult.required_staging_storage_gb == null ? "Not supplied" : `${simulationResult.required_staging_storage_gb} GB`}</p><p className="mt-1 text-[11px] text-muted-foreground">Includes a 20% planning allowance; validate against the recovery platform.</p></div></div>
            <div className="rounded-xl border border-white/[0.08] bg-black/[0.10] p-4"><p className="text-xs font-semibold">Recommended restore order</p><div className="mt-3 flex flex-wrap items-center gap-2">{(simulationResult.restore_order || []).map((step, index) => <div key={`${step}-${index}`} className="flex items-center gap-2"><span className="rounded-lg border border-cyan-400/20 bg-cyan-500/[0.05] px-2.5 py-1.5 text-xs">{index + 1}. {step}</span>{index < simulationResult.restore_order.length - 1 && <ArrowUpRight className="h-3.5 w-3.5 rotate-45 text-muted-foreground" />}</div>)}</div></div>
            <div className="rounded-xl border border-amber-400/20 bg-amber-500/[0.04] p-4"><p className="text-xs font-semibold text-amber-100">Evidence blockers</p>{(simulationResult.blockers || []).length ? <ul className="mt-2 space-y-2">{simulationResult.blockers.map((blocker, index) => <li key={index} className="flex gap-2 text-xs text-muted-foreground"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />{blocker}</li>)}</ul> : <p className="mt-2 text-xs text-emerald-200">Current observed evidence supports the supplied targets. Complete a live recovery test before relying on this plan.</p>}</div>
            {simulationResult.assumptions && <div><p className="text-xs font-semibold">Recorded assumptions</p><p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{simulationResult.assumptions}</p></div>}
            <p className="rounded-lg border border-white/[0.07] bg-muted/10 p-3 text-[11px] text-muted-foreground">{simulationResult.notice}</p>
          </div>}
          <DialogFooter className="border-t bg-muted/20 px-6 py-4"><Button onClick={() => setSimulationResult(null)}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!verificationRequest} onOpenChange={(open) => { if (!open) setVerificationRequest(null); }}>
        <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto border-sky-400/20 bg-background p-0" data-testid="backup-verification-request-dialog">
          <DialogHeader className="border-b border-sky-400/15 bg-[linear-gradient(135deg,rgba(14,165,233,0.12),rgba(15,23,42,0.94))] px-6 py-5 pr-14">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-300">Recovery assurance</p>
            <DialogTitle className="mt-1 flex items-center gap-2 text-xl"><span className="flex h-9 w-9 items-center justify-center rounded-xl border border-sky-400/25 bg-sky-400/10"><Play className="h-4 w-4 text-sky-300" /></span>Schedule a recovery test</DialogTitle>
            <DialogDescription>Choose the customer and recovery scope before creating the request. NexusMSP will log the request and the eventual outcome as audit evidence.</DialogDescription>
          </DialogHeader>
          {verificationRequest && <div className="space-y-4 px-6 py-5">
            <div><label className="text-sm font-medium">Customer</label><Select value={verificationRequest.client_id} onValueChange={(client_id) => setVerificationRequest((current) => ({ ...current, client_id }))}><SelectTrigger className="mt-1"><SelectValue placeholder="Choose customer" /></SelectTrigger><SelectContent>{clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name || client.company_name || client.id}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-3 sm:grid-cols-2"><div><label className="text-sm font-medium">Recovery scope</label><Select value={verificationRequest.backup_type} onValueChange={(backup_type) => setVerificationRequest((current) => ({ ...current, backup_type }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Recovery test">Recovery test</SelectItem><SelectItem value="File restore">File restore</SelectItem><SelectItem value="System recovery">System recovery</SelectItem><SelectItem value="Application recovery">Application recovery</SelectItem></SelectContent></Select></div><div><label className="text-sm font-medium">Backup solution</label><Select value={verificationRequest.backup_solution} onValueChange={(backup_solution) => setVerificationRequest((current) => ({ ...current, backup_solution }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Acronis">Acronis</SelectItem><SelectItem value="Veeam">Veeam</SelectItem><SelectItem value="Microsoft 365">Microsoft 365</SelectItem><SelectItem value="Other">Other</SelectItem></SelectContent></Select></div></div>
            <div><label className="text-sm font-medium">Technician brief</label><Input className="mt-1" value={verificationRequest.notes} onChange={(event) => setVerificationRequest((current) => ({ ...current, notes: event.target.value }))} placeholder="What should be restored and what must be validated?" /></div>
          </div>}
          <DialogFooter className="border-t bg-muted/20 px-6 py-4"><Button variant="outline" onClick={() => setVerificationRequest(null)} disabled={verificationRequestSaving}>Cancel</Button><Button onClick={submitVerificationRequest} disabled={verificationRequestSaving || !verificationRequest?.client_id}>{verificationRequestSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Schedule test</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!verificationCompletion} onOpenChange={(open) => { if (!open) setVerificationCompletion(null); }}>
        <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto border-emerald-400/20 bg-background p-0">
          <DialogHeader className="border-b border-emerald-400/15 bg-[linear-gradient(135deg,rgba(16,185,129,0.12),rgba(15,23,42,0.94))] px-6 py-5 pr-14">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300">Recovery evidence</p>
            <DialogTitle className="mt-1 flex items-center gap-2 text-xl"><span className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-400/25 bg-emerald-400/10"><CheckCircle className="h-4 w-4 text-emerald-300" /></span>Record restore verification</DialogTitle>
            <DialogDescription>Document the measured restore result. This becomes audit evidence for the selected backup verification request.</DialogDescription>
          </DialogHeader>
          {verificationCompletion && <div className="space-y-4 px-6 py-5">
            <div className="rounded-lg border border-border/70 bg-muted/20 p-3 text-sm"><p className="font-medium">{verificationCompletion.test.client_name}</p><p className="mt-1 text-xs text-muted-foreground">{verificationCompletion.test.backup_solution} · {verificationCompletion.test.backup_type}</p></div>
            <div className="grid gap-3 sm:grid-cols-2"><div><label className="text-sm font-medium">Outcome</label><Select value={verificationCompletion.result} onValueChange={(result) => setVerificationCompletion((current) => ({ ...current, result }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pass">Pass</SelectItem><SelectItem value="fail">Fail</SelectItem></SelectContent></Select></div><div><label className="text-sm font-medium">Restore time (minutes)</label><Input className="mt-1" type="number" min="0" value={verificationCompletion.restore_time_minutes} onChange={(event) => setVerificationCompletion((current) => ({ ...current, restore_time_minutes: event.target.value }))} placeholder="e.g. 18" /></div></div>
            <div><label className="text-sm font-medium">Integrity check</label><Select value={verificationCompletion.data_integrity_check} onValueChange={(data_integrity_check) => setVerificationCompletion((current) => ({ ...current, data_integrity_check }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="passed">Passed</SelectItem><SelectItem value="failed">Failed</SelectItem><SelectItem value="not_applicable">Not applicable</SelectItem></SelectContent></Select></div>
            <div><label className="text-sm font-medium">Technician notes</label><Input className="mt-1" value={verificationCompletion.notes} onChange={(event) => setVerificationCompletion((current) => ({ ...current, notes: event.target.value }))} placeholder="What was restored and what was validated?" /></div>
          </div>}
          <DialogFooter className="border-t bg-muted/20 px-6 py-4"><Button variant="outline" onClick={() => setVerificationCompletion(null)}>Cancel</Button><Button onClick={completeVerification} disabled={verificationSaving || !verificationCompletion?.restore_time_minutes}>{verificationSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save verification</Button></DialogFooter>
        </DialogContent>
      </Dialog>
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

      <Dialog open={Boolean(orphanCleanupTarget)} onOpenChange={(open) => !open && setOrphanCleanupTarget(null)}>
        <NexusWorkflowDialog
          eyebrow="Backup estate hygiene"
          title={orphanCleanupTarget?.kind === "zombie" ? "Remove zombie backup plan?" : "Uninstall offline backup agent?"}
          description={orphanCleanupTarget?.kind === "zombie"
            ? `${orphanCleanupTarget?.bulk ? selectedZombies.length : 1} plan${(orphanCleanupTarget?.bulk ? selectedZombies.length : 1) === 1 ? "" : "s"} will be unassigned from missing resources.`
            : `${orphanCleanupTarget?.bulk ? selectedAgents.length : 1} offline agent${(orphanCleanupTarget?.bulk ? selectedAgents.length : 1) === 1 ? "" : "s"} will be removed from the backup estate.`}
          icon={orphanCleanupTarget?.kind === "zombie" ? Skull : WifiOff}
          tone="amber"
          className="max-w-xl"
          data-testid="backup-orphan-cleanup-workflow"
          footer={<><Button variant="outline" onClick={() => setOrphanCleanupTarget(null)} disabled={cleaning}>Keep records</Button><Button variant="destructive" disabled={cleaning} onClick={async () => { const target = orphanCleanupTarget; setOrphanCleanupTarget(null); if (target?.kind === "zombie") await (target.bulk ? handleBulkCleanupZombies(true) : handleRemoveZombie(target.item, true)); else await (target?.bulk ? handleBulkCleanupAgents(true) : handleRemoveAgent(target?.item, true)); }}>{cleaning && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{orphanCleanupTarget?.kind === "zombie" ? "Remove plan" : "Uninstall agent"}</Button></>}
        >
          <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3 text-sm text-muted-foreground">This is an irreversible cleanup. Nexus retains the audit evidence, but the backup resource or assignment will no longer consume platform capacity.</div>
        </NexusWorkflowDialog>
      </Dialog>

      {/* Cancel Backup Confirmation */}
      <Dialog open={!!cancelTarget} onOpenChange={v => !v && setCancelTarget(null)}>
        <DialogContent className="max-w-xl overflow-hidden border-rose-400/20 bg-background p-0">
          <DialogHeader className="border-b border-rose-400/15 bg-[linear-gradient(135deg,rgba(244,63,94,0.12),rgba(15,23,42,0.94))] px-6 py-5 pr-14">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-rose-300">Backup safeguard</p>
            <DialogTitle className="mt-1 flex items-center gap-2 text-xl">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-rose-400/25 bg-rose-400/10"><StopCircle className="h-4 w-4 text-rose-300" /></span>
              Stop running backup?
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
          <DialogFooter className="border-t bg-muted/20 px-6 py-4">
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
