import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
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
import HeroTile, { AnimatedCounter as _AC } from "@/components/HeroTile";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
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

const BACKUP_TABS = new Set(["dashboard", "live", "tenants", "status", "acronis", "orphans", "compliance", "billing", "verify"]);

export default function BackupCenterPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const [tab, setTab] = useState(() => BACKUP_TABS.has(requestedTab) ? requestedTab : "dashboard");
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
  const [selectedZombies, setSelectedZombies] = useState([]);
  const [selectedAgents, setSelectedAgents] = useState([]);
  const [cleaning, setCleaning] = useState(false);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [backupStatuses, setBackupStatuses] = useState(null);
  const [verificationCompletion, setVerificationCompletion] = useState(null);
  const [verificationSaving, setVerificationSaving] = useState(false);
  const [verificationRequest, setVerificationRequest] = useState(null);
  const [verificationRequestSaving, setVerificationRequestSaving] = useState(false);
  const [clients, setClients] = useState([]);
  const [acronisConfig, setAcronisConfig] = useState(null);

  useEffect(() => {
    if (requestedTab && BACKUP_TABS.has(requestedTab)) setTab(requestedTab);
  }, [requestedTab]);

  const selectTab = useCallback((nextTab) => {
    setTab(nextTab);
    const nextParams = new URLSearchParams(searchParams);
    if (nextTab === "dashboard") nextParams.delete("tab");
    else nextParams.set("tab", nextTab);
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  const openDashboardFilter = (nextFilter) => {
    setStatusFilter(nextFilter);
    selectTab("dashboard");
  };

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
      const [dash, comp, verify, usage, agents, alerts, clientList, config] = await Promise.allSettled([
        axios.get(`${API}/backup-dashboard/overview`, { headers }),
        axios.get(`${API}/backup-compliance/dashboard`, { headers }),
        axios.get(`${API}/backup-verify/overview`, { headers }),
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

  const handleRemoveZombie = async (z) => {
    if (!window.confirm(`Remove zombie plan "${z.policy_name || "(unnamed)"}"? This unassigns it from the missing resource.`)) return;
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

  const handleBulkCleanupZombies = async () => {
    if (selectedZombies.length === 0) { toast.error("No zombie plans selected"); return; }
    if (!window.confirm(`Permanently remove ${selectedZombies.length} zombie backup plan(s)? This cannot be undone.`)) return;
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

  const handleRemoveAgent = async (a) => {
    if (!window.confirm(`Uninstall offline agent "${a.agent_name}" (${a.days_offline}d offline)? This frees up the storage but cannot be undone.`)) return;
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

  const handleBulkCleanupAgents = async () => {
    if (selectedAgents.length === 0) { toast.error("No agents selected"); return; }
    if (!window.confirm(`Permanently uninstall ${selectedAgents.length} offline agent(s)? This cannot be undone.`)) return;
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
  const ah = agentsHealth?.summary || {};
  const liveCount = liveActivities.running?.length || 0;
  const sourceIssues = [
    !acronisConfig?.configured ? acronisConfig?.error || "Acronis API credentials have not been configured." : null,
    agentsHealth?.error ? `Agent health: ${agentsHealth.error}` : null,
    liveActivities?.error ? `Live activity feed: ${liveActivities.error}` : null,
  ].filter(Boolean);
  const backupSourceUnavailable = sourceIssues.length > 0;
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
          if (action === "settings") window.location.assign("/settings?tab=integrations&anchor=acronis-settings-card");
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
            <Button size="sm" variant="outline" className="shrink-0 border-rose-400/35 text-rose-100 hover:bg-rose-500/10" onClick={() => window.location.assign("/settings?tab=integrations&anchor=acronis-settings-card")}>Open Acronis settings</Button>
          </CardContent>
        </Card>
      )}

      {/* Hero metric strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <HeroMetric label="Total backups" value={ds.total_jobs || 0} icon={Database} glow="cyan" subtitle="All protected workloads" onClick={() => openDashboardFilter("all")} />
        <HeroMetric label="Successful" value={ds.successful || 0} icon={CheckCircle} glow="emerald" subtitle={`${ds.success_rate || 0}% success rate`} onClick={() => openDashboardFilter("success")} />
        <HeroMetric label="Failed" value={ds.failed || 0} icon={XCircle} glow="rose" subtitle={ds.failed ? "Needs attention" : "All healthy"} onClick={() => openDashboardFilter("failed")} />
        <HeroMetric label="Running" value={liveCount} icon={Activity} glow={backupSourceUnavailable ? "rose" : "violet"} subtitle={backupSourceUnavailable ? "Source unavailable" : "Live now"} onClick={() => backupSourceUnavailable ? window.location.assign("/settings?tab=integrations&anchor=acronis-settings-card") : selectTab("live")} />
        <HeroMetric label="Online agents" value={ah.online || 0} icon={Wifi} glow={backupSourceUnavailable ? "rose" : "emerald"} subtitle={backupSourceUnavailable ? "Source unavailable" : `${ah.online_pct || 0}% of ${ah.total || 0}`} onClick={() => backupSourceUnavailable ? window.location.assign("/settings?tab=integrations&anchor=acronis-settings-card") : selectTab("status")} />
        <HeroMetric label="Active alerts" value={acronisAlerts.length} icon={Bell} glow={backupSourceUnavailable ? "rose" : acronisAlerts.length > 0 ? "amber" : "cyan"} subtitle={backupSourceUnavailable ? "Source unavailable" : acronisUsage?.critical_alerts ? `${acronisUsage.critical_alerts} critical` : "Acronis monitoring"} onClick={() => backupSourceUnavailable ? window.location.assign("/settings?tab=integrations&anchor=acronis-settings-card") : selectTab("acronis")} />
      </div>

      <Tabs value={tab} onValueChange={selectTab}>
        <TabsList className="grid h-auto w-full grid-cols-2 gap-2 bg-transparent p-0 sm:grid-cols-3 xl:grid-cols-9">
          <TabsTrigger value="dashboard" data-testid="tab-dashboard" className="h-10 justify-start rounded-xl border border-border/60 bg-muted/20 px-3 text-xs data-[state=active]:border-sky-500/35 data-[state=active]:bg-sky-500/10 data-[state=active]:text-sky-100">
            <Database className="w-3.5 h-3.5 mr-1" />Dashboard
          </TabsTrigger>
          <TabsTrigger value="live" data-testid="tab-live" className="relative h-10 justify-start rounded-xl border border-border/60 bg-muted/20 px-3 text-xs data-[state=active]:border-sky-500/35 data-[state=active]:bg-sky-500/10 data-[state=active]:text-sky-100">
            <Activity className="w-3.5 h-3.5 mr-1" />Live
            {liveCount > 0 && <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />}
          </TabsTrigger>
          <TabsTrigger value="tenants" data-testid="tab-tenants" className="h-10 justify-start rounded-xl border border-border/60 bg-muted/20 px-3 text-xs data-[state=active]:border-sky-500/35 data-[state=active]:bg-sky-500/10 data-[state=active]:text-sky-100">
            <Users className="w-3.5 h-3.5 mr-1" />Tenants
          </TabsTrigger>
          <TabsTrigger value="status" data-testid="tab-status" className="h-10 justify-start rounded-xl border border-border/60 bg-muted/20 px-3 text-xs data-[state=active]:border-sky-500/35 data-[state=active]:bg-sky-500/10 data-[state=active]:text-sky-100">
            <Server className="w-3.5 h-3.5 mr-1" />Backup Status
          </TabsTrigger>
          <TabsTrigger value="acronis" data-testid="tab-acronis" className="h-10 justify-start rounded-xl border border-border/60 bg-muted/20 px-3 text-xs data-[state=active]:border-sky-500/35 data-[state=active]:bg-sky-500/10 data-[state=active]:text-sky-100">
            <Cloud className="w-3.5 h-3.5 mr-1" />Acronis Console
          </TabsTrigger>
          <TabsTrigger value="orphans" data-testid="tab-orphans" className="h-10 justify-start rounded-xl border border-border/60 bg-muted/20 px-3 text-xs data-[state=active]:border-sky-500/35 data-[state=active]:bg-sky-500/10 data-[state=active]:text-sky-100">
            <Ghost className="w-3.5 h-3.5 mr-1" />Orphans
            {orphans && orphans.totals?.total_orphans > 0 && (
              <Badge variant="destructive" className="ml-1.5 h-4 text-[9px] px-1">{orphans.totals.total_orphans}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="compliance" data-testid="tab-compliance" className="h-10 justify-start rounded-xl border border-border/60 bg-muted/20 px-3 text-xs data-[state=active]:border-sky-500/35 data-[state=active]:bg-sky-500/10 data-[state=active]:text-sky-100">
            <Shield className="w-3.5 h-3.5 mr-1" />Compliance
          </TabsTrigger>
          <TabsTrigger value="billing" data-testid="tab-billing" className="h-10 justify-start rounded-xl border border-border/60 bg-muted/20 px-3 text-xs data-[state=active]:border-sky-500/35 data-[state=active]:bg-sky-500/10 data-[state=active]:text-sky-100">
            <DollarSign className="w-3.5 h-3.5 mr-1" />Billing
          </TabsTrigger>
          <TabsTrigger value="verify" data-testid="tab-verify" className="h-10 justify-start rounded-xl border border-border/60 bg-muted/20 px-3 text-xs data-[state=active]:border-sky-500/35 data-[state=active]:bg-sky-500/10 data-[state=active]:text-sky-100">
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
          ) : orphans.data_source === "error" ? (
            <Card className="border-rose-500/30 bg-rose-500/[0.045]" data-testid="orphan-scan-error">
              <CardContent className="flex flex-col gap-3 py-8 text-center sm:items-center">
                <AlertTriangle className="mx-auto h-10 w-10 text-rose-300" />
                <div><p className="font-semibold text-rose-100">Acronis scan unavailable</p><p className="mt-1 max-w-xl text-xs text-muted-foreground">{orphans.error || "NexusMSP could not retrieve Acronis resources. No cleanup recommendations are being shown because the scan is incomplete."}</p></div>
                <Button variant="outline" onClick={handleScanOrphans} disabled={scanning}>{scanning && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Retry scan</Button>
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
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <Card><CardContent className="pt-4 pb-3 text-center"><HardDrive className="w-4 h-4 mx-auto mb-1" /><p className="text-xl font-bold">{cs.total_devices}</p><p className="text-xs text-muted-foreground">Total Devices</p></CardContent></Card>
              <Card><CardContent className="pt-4 pb-3 text-center"><CheckCircle className="w-4 h-4 mx-auto mb-1 text-green-500" /><p className="text-xl font-bold text-green-500">{cs.compliant}</p><p className="text-xs text-muted-foreground">Compliant</p></CardContent></Card>
              <Card><CardContent className="pt-4 pb-3 text-center"><XCircle className="w-4 h-4 mx-auto mb-1 text-red-500" /><p className="text-xl font-bold text-red-500">{cs.non_compliant}</p><p className="text-xs text-muted-foreground">Non-Compliant</p></CardContent></Card>
              <Card><CardContent className="pt-4 pb-3 text-center"><AlertTriangle className="w-4 h-4 mx-auto mb-1 text-amber-500" /><p className="text-xl font-bold text-amber-500">{cs.evidence_available ? cs.no_backup : cs.not_assessed}</p><p className="text-xs text-muted-foreground">{cs.evidence_available ? "No Backup" : "Not Assessed"}</p></CardContent></Card>
              <Card><CardContent className="pt-4 pb-3 text-center"><Shield className="w-4 h-4 mx-auto mb-1 text-primary" /><p className="text-xl font-bold">{cs.compliance_pct}%</p><p className="text-xs text-muted-foreground">Verified Compliance Rate</p></CardContent></Card>
            </div>
            {!cs.evidence_available && <p className="text-xs text-muted-foreground">No backup source has reported to NexusMSP yet. Connect or sync Acronis before treating any device as protected or unprotected.</p>}
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
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="max-w-2xl text-xs text-muted-foreground">Schedule a customer-specific recovery test, then record the measured restore outcome. Both actions are written to the audit trail.</p><Button onClick={openVerificationRequest} data-testid="run-backup-verification"><Play className="mr-1 h-4 w-4" />Schedule test</Button></div>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
              <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Total Tests</div><div className="text-3xl font-bold mt-1">{vs.total_tests}</div></CardContent></Card>
              <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Pass Rate</div><div className="text-3xl font-bold text-green-500 mt-1">{vs.pass_rate_pct}%</div></CardContent></Card>
              <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Pending</div><div className="text-3xl font-bold text-amber-400 mt-1">{vs.pending || 0}</div></CardContent></Card>
              <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Failed</div><div className="text-3xl font-bold text-red-500 mt-1">{vs.failed}</div></CardContent></Card>
              <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Avg Restore</div><div className="text-3xl font-bold mt-1">{vs.avg_restore_time_min != null ? `${vs.avg_restore_time_min}m` : "Not measured"}</div></CardContent></Card>
            </div>
            <div className="space-y-2">
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
          </>}
        </TabsContent>
      </Tabs>

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
