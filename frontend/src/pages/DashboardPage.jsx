import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  Users, Monitor, Ticket, AlertTriangle, Clock,
  RefreshCw, MessageSquare, Activity, AlertCircle, CheckCircle,
  Shield, HardDrive, ExternalLink, Plus,
  ChevronDown, ChevronRight, TrendingUp, Zap, Server, Laptop, Wifi, Eye, Cpu, Sparkles,
  Lock, Unlock, RotateCcw, X, PlusCircle, LayoutGrid, Mail
} from "lucide-react";
import { toast } from "sonner";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell
} from "recharts";
import { formatDistanceToNow } from "date-fns";
import { PageShell } from "@/components/design-system";
import { Responsive, WidthProvider } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import "@/styles/dashboard-grid.css";
import "@/styles/dashboard-ticker.css";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator
} from "@/components/ui/dropdown-menu";
import TeamPinsStrip from "@/components/dashboard/TeamPinsStrip";
import WhatsNewTile from "@/components/dashboard/WhatsNewTile";
import { BlueprintInsightsTile } from "@/components/ai/BlueprintInsightsTile";
import { ThreatRadarTicker } from "@/components/ai/ThreatRadarTicker";
import { ChurnRiskTile } from "@/components/ai/ChurnRiskTile";
import { SLARadarTile } from "@/components/ai/SLARadarTile";
import { HuntressSummaryCard } from "@/components/security/HuntressSummaryCard";
import WeatherStrip from "@/components/ambient/WeatherStrip";
import MissionControlOverview from "@/components/dashboard/MissionControlOverview";
import NexusBrainBriefing from "@/components/dashboard/NexusBrainBriefing";
import NexusDaily from "@/components/dashboard/NexusDaily";
import DailyNocReviewDialog from "@/components/dashboard/DailyNocReviewDialog";

const ResponsiveGridLayout = WidthProvider(Responsive);

// Widget metadata — label + icon for the "Add Widget" picker
const WIDGET_META = {
  "live-ticker":  { label: "Live Operations Ticker",  icon: Activity },
  "cross-bridge": { label: "Cross-Module Bridge",    icon: AlertTriangle },
  "team-pins":    { label: "Team Pins / NOC Strip",  icon: Users },
  "whats-new":    { label: "What's New",              icon: Sparkles },
  "threat":       { label: "Threat Radar",           icon: Shield },
  "sla-radar":    { label: "SLA Radar",              icon: Clock },
  "blueprint":    { label: "Blueprint Insights",     icon: Eye },
  "churn":        { label: "Churn Risk",             icon: TrendingUp },
  "huntress":     { label: "Huntress Security",      icon: Shield },
  "ticket-trend": { label: "Ticket Volume Chart",    icon: Activity },
  "fleet-health": { label: "Fleet Health",           icon: Cpu },
  "ops-insights": { label: "Operational Insights",   icon: Eye },
  "open-tix":     { label: "Open Tickets",           icon: Ticket },
  "alerts":       { label: "Alerts",                 icon: AlertTriangle },
  "activity":     { label: "Activity Feed",          icon: Zap },
};

// Technician-first default (lg breakpoint = 12 cols).  The dashboard starts
// with one predictable visual rhythm: full-width status strips, then paired
// work cards.  Less frequent executive/AI widgets remain available through
// Customise rather than crowding the first screen.
const DEFAULT_LAYOUT_LG = [
  { i: "live-ticker", x: 0, y: 0,  w: 12, h: 1, minH: 1, minW: 6 },
  { i: "open-tix",    x: 0, y: 1,  w: 6,  h: 7, minH: 5, minW: 4 },
  { i: "sla-radar",   x: 6, y: 1,  w: 6,  h: 7, minH: 5, minW: 4 },
  { i: "alerts",      x: 0, y: 8,  w: 6,  h: 7, minH: 5, minW: 4 },
  { i: "activity",    x: 6, y: 8,  w: 6,  h: 7, minH: 5, minW: 4 },
  { i: "ticket-trend",x: 0, y: 15, w: 6,  h: 6, minH: 4, minW: 4 },
  { i: "fleet-health",x: 6, y: 15, w: 6,  h: 6, minH: 4, minW: 4 },
  { i: "ops-insights",x: 0, y: 21, w: 12, h: 5, minH: 4, minW: 6 },
  { i: "team-pins",   x: 0, y: 26, w: 12, h: 3, minH: 2, minW: 6 },
  { i: "blueprint",   x: 0, y: 29, w: 12, h: 4, minH: 3, minW: 4 },
  { i: "threat",      x: 0, y: 33, w: 12, h: 2, minH: 1, minW: 6 },
  // Optional modules retain placements so restoring them from Customise is
  // immediate and never causes widget overlap.
  { i: "cross-bridge",x: 0, y: 35, w: 12, h: 5, minH: 3, minW: 6 },
  { i: "whats-new",   x: 0, y: 40, w: 6,  h: 5, minH: 4, minW: 4 },
  { i: "churn",       x: 6, y: 40, w: 6,  h: 5, minH: 3, minW: 4 },
  { i: "huntress",    x: 0, y: 45, w: 12, h: 4, minH: 2, minW: 6 },
];

const DEFAULT_HIDDEN_WIDGETS = new Set(["cross-bridge", "whats-new", "churn", "huntress"]);
const LAYOUT_STORAGE_KEY = "nx-dashboard-layout-v7";
const HIDDEN_STORAGE_KEY = "nx-dashboard-hidden-v7";
export default function DashboardPage() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const dashboardStorageSuffix = user?.id || "anonymous";
  const layoutStorageKey = `${LAYOUT_STORAGE_KEY}:${dashboardStorageSuffix}`;
  const hiddenStorageKey = `${HIDDEN_STORAGE_KEY}:${dashboardStorageSuffix}`;
  const [stats, setStats] = useState(null);
  const [enhancedStats, setEnhancedStats] = useState(null);
  const [ticketTrends, setTicketTrends] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [activityFeed, setActivityFeed] = useState([]);
  const [devices, setDevices] = useState([]);
  const [mspIntel, setMspIntel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState(null);
  const [missionControl, setMissionControl] = useState(null);
  const [nexusBrain, setNexusBrain] = useState(null);
  const [dailyReviewOpen, setDailyReviewOpen] = useState(false);
  const autoRefreshRef = useRef(null);

  const headers = { Authorization: `Bearer ${token}` };

  const fetchDashboardData = async () => {
    setDashboardError(null);
    try {
      const [statsRes, trendsRes, alertsRes, ticketsRes, activityRes, enhancedRes, devicesRes, missionRes, brainRes] = await Promise.all([
        axios.get(`${API}/dashboard/stats`, { headers }),
        axios.get(`${API}/dashboard/ticket-trends`, { headers }),
        axios.get(`${API}/alerts?status=active`, { headers }),
        axios.get(`${API}/tickets?status=open`, { headers }),
        axios.get(`${API}/dashboard/activity-feed?limit=15`, { headers }),
        // Enhanced financial widgets must never prevent the core operational
        // dashboard from loading when an imported record is incomplete.
        axios.get(`${API}/dashboard/enhanced-stats`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/devices`, { headers }),
        axios.get(`${API}/mission-control/overview`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/mission-control/brain`, { headers }).catch(() => ({ data: null })),
      ]);
      setStats(statsRes.data);
      setEnhancedStats(enhancedRes.data || null);
      setTicketTrends(trendsRes.data);
      const liveAgentAlerts = (devicesRes.data || [])
        .filter(device => device.security_assessed_at)
        .flatMap(device => {
          const pending = Number(device.pending_patches || 0);
          const items = [];
          if (device.status === "offline") items.push({ id: `agent-offline-${device.id}`, device_id: device.id, device_name: device.name, severity: "critical", title: "Agent-reported endpoint offline", message: `${device.name} is offline`, source: "nexus-agent" });
          if (pending > 0) items.push({ id: `agent-patches-${device.id}`, device_id: device.id, device_name: device.name, severity: pending > 10 ? "critical" : "warning", title: "Pending Windows updates", message: `${device.name}: ${pending} pending update${pending === 1 ? "" : "s"}`, source: "nexus-agent" });
          return items;
        });
      setAlerts([...(alertsRes.data || []), ...liveAgentAlerts]);
      setTickets(ticketsRes.data.slice(0, 8));
      setActivityFeed(activityRes.data);
      setDevices(devicesRes.data);
      setMissionControl(missionRes.data);
      setNexusBrain(brainRes.data);

      const [backupRes, predRes, compFwRes] = await Promise.all([
        axios.get(`${API}/backup-dashboard/overview`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/predictive-failure/overview`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/compliance-frameworks/overview`, { headers }).catch(() => ({ data: null })),
      ]);
      setMspIntel({
        backup: backupRes.data?.summary,
        urgentPredictions: (predRes.data?.predictions || []).filter(p => p.days_until_failure <= 7),
        complianceFw: compFwRes.data?.summary,
        frameworks: compFwRes.data?.frameworks,
      });
    } catch (error) {
      console.error("Failed to fetch dashboard data:", error);
      setDashboardError("NexusMSP could not load the operational dashboard. Your work has not been changed.");
    } finally {
      setLoading(false);
    }
  };

  // Dashboard widget layout — persisted per user in localStorage
  const [editMode, setEditMode] = useState(false);
  const [layouts, setLayouts] = useState({ lg: DEFAULT_LAYOUT_LG });
  const [hiddenWidgets, setHiddenWidgets] = useState(new Set(DEFAULT_HIDDEN_WIDGETS));
  useEffect(() => {
    try {
      const savedLayout = localStorage.getItem(layoutStorageKey);
      const parsed = savedLayout ? JSON.parse(savedLayout) : null;
      setLayouts(parsed?.lg?.some(item => item.i === "open-tix") ? parsed : { lg: DEFAULT_LAYOUT_LG });
      const savedHidden = localStorage.getItem(hiddenStorageKey);
      setHiddenWidgets(savedHidden ? new Set(JSON.parse(savedHidden)) : new Set(DEFAULT_HIDDEN_WIDGETS));
    } catch {
      setLayouts({ lg: DEFAULT_LAYOUT_LG });
      setHiddenWidgets(new Set(DEFAULT_HIDDEN_WIDGETS));
    }
  }, [layoutStorageKey, hiddenStorageKey]);
  const persistHidden = (next) => {
    try { localStorage.setItem(hiddenStorageKey, JSON.stringify([...next])); } catch { /* */ }
  };
  const hideWidget = (id) => {
    setHiddenWidgets(prev => {
      const next = new Set(prev); next.add(id); persistHidden(next); return next;
    });
    toast.success(`${WIDGET_META[id]?.label || id} hidden`, { description: "Re-add it from + Add Widget" });
  };
  const showWidget = (id) => {
    setHiddenWidgets(prev => {
      const next = new Set(prev); next.delete(id); persistHidden(next); return next;
    });
    toast.success(`${WIDGET_META[id]?.label || id} restored`);
  };
  const onLayoutChange = (_currentLayout, allLayouts) => {
    setLayouts(allLayouts);
    try { localStorage.setItem(layoutStorageKey, JSON.stringify(allLayouts)); } catch { /* */ }
  };
  const resetLayout = () => {
    setLayouts({ lg: DEFAULT_LAYOUT_LG });
    setHiddenWidgets(new Set(DEFAULT_HIDDEN_WIDGETS));
    try {
      localStorage.removeItem(layoutStorageKey);
      localStorage.removeItem(hiddenStorageKey);
    } catch { /* */ }
    toast.success("Dashboard layout reset to defaults");
  };

  // Filter the visible layout by removing hidden widget entries
  const visibleLayouts = (() => {
    const filtered = {};
    Object.keys(layouts).forEach(bp => {
      filtered[bp] = (layouts[bp] || []).filter(l => !hiddenWidgets.has(l.i));
    });
    return filtered;
  })();
  const hiddenList = Object.keys(WIDGET_META).filter(id => hiddenWidgets.has(id));

  useEffect(() => { fetchDashboardData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    autoRefreshRef.current = setInterval(fetchDashboardData, 60000);
    return () => clearInterval(autoRefreshRef.current);
  }, []);

  if (loading) {
    return (
      <div className="space-y-6" data-testid="dashboard-loading">
        <div className="h-32 rounded-2xl bg-gradient-to-br from-emerald-500/5 via-transparent to-blue-500/5 animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Card key={`k-${i}`}><CardContent className="p-6"><div className="h-16 rounded bg-muted animate-pulse" /></CardContent></Card>)}
        </div>
      </div>
    );
  }

  if (dashboardError || !stats) {
    return (
      <Card className="mx-auto mt-10 max-w-2xl border-rose-500/30 bg-rose-500/[0.045]" data-testid="dashboard-load-error">
        <CardContent className="flex flex-col items-center gap-4 px-6 py-10 text-center">
          <AlertTriangle className="h-10 w-10 text-rose-300" />
          <div><h1 className="text-lg font-semibold">Dashboard data is unavailable</h1><p className="mt-1 max-w-lg text-sm text-muted-foreground">{dashboardError || "The dashboard did not return the information needed to render this workspace."}</p></div>
          <Button onClick={fetchDashboardData} data-testid="retry-dashboard-load"><RefreshCw className="mr-2 h-4 w-4" />Retry dashboard</Button>
        </CardContent>
      </Card>
    );
  }

  const onlineDevices = devices.filter(d => d.status === "online");
  const warningDevices = devices.filter(d => d.status === "warning");
  const offlineDevices = devices.filter(d => d.status === "offline");
  const criticalTickets = tickets.filter(t => t.priority === "critical");
  const myTickets = tickets.filter(t => t.assigned_to === user?.id || (!t.assigned_to && !t.assigned_name));
  const queueTickets = (myTickets.length ? myTickets : tickets)
    .slice()
    .sort((a, b) => ({ critical: 0, high: 1, medium: 2, low: 3 }[a.priority] ?? 4) - ({ critical: 0, high: 1, medium: 2, low: 3 }[b.priority] ?? 4));
  const needsPatching = devices.filter(d => (d.pending_patches || 0) > 0);
  const statusDot = { open: "bg-blue-500", in_progress: "bg-amber-500", resolved: "bg-emerald-500", closed: "bg-gray-400" };
  const priorityColors = { critical: "bg-red-500/10 text-red-500", high: "bg-orange-500/10 text-orange-500", medium: "bg-amber-500/10 text-amber-500", low: "bg-blue-500/10 text-blue-500" };
  const ticketPath = (ticket) => `/tickets?ticket=${encodeURIComponent(ticket.ticket_number || ticket.id)}`;
  const alertPath = (alert) => alert.device_id ? `/devices/${alert.device_id}` : "/security-dashboard";

  const openCommandPalette = () => window.dispatchEvent(new CustomEvent("nexus:open-command-palette"));

  const tickerItems = [
    ...offlineDevices.slice(0, 4).map(device => ({ tone: "critical", icon: Monitor, label: `${device.name || device.hostname} is offline`, detail: device.client_name || "Endpoint", path: `/devices/${device.id}` })),
    ...needsPatching.slice(0, 4).map(device => ({ tone: "warning", icon: Shield, label: `${device.name || device.hostname} has ${device.pending_patches} pending patch${Number(device.pending_patches) === 1 ? "" : "es"}`, detail: device.client_name || "Patch management", path: `/devices/${device.id}` })),
    ...criticalTickets.slice(0, 4).map(ticket => ({ tone: "critical", icon: Ticket, label: `${ticket.ticket_number || "Ticket"}: ${ticket.title}`, detail: ticket.client_name || "Critical ticket", path: ticketPath(ticket) })),
    ...(alerts || []).filter(alert => alert.severity === "critical" || alert.severity === "warning").slice(0, 4).map(alert => ({ tone: alert.severity === "critical" ? "critical" : "warning", icon: AlertTriangle, label: alert.title || alert.message || "Active alert", detail: alert.device_name || alert.source || "Monitoring", path: alertPath(alert) })),
  ];
  if (!tickerItems.length) tickerItems.push({ tone: "healthy", icon: CheckCircle, label: "All monitored services are nominal", detail: `${onlineDevices.length} endpoints reporting online`, path: "/devices" });

  const chartData = ticketTrends;

  return (
    <PageShell>
    <WeatherStrip />
    <div className="flex-1 overflow-y-auto p-6 space-y-5" data-testid="dashboard-page">

      <NexusDaily
        missionControl={missionControl}
        nexusBrain={nexusBrain}
        user={user}
        navigate={navigate}
        onOpenCommand={openCommandPalette}
        onOpenDailyReview={() => setDailyReviewOpen(true)}
        onRefresh={fetchDashboardData}
      />
      <DailyNocReviewDialog
        open={dailyReviewOpen}
        onOpenChange={setDailyReviewOpen}
        token={token}
      />

      <details className="group rounded-2xl border border-border/70 bg-card/70 p-3" data-testid="dashboard-deep-operations">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-2 py-1.5 text-left outline-none transition hover:bg-muted/35">
          <div>
            <p className="text-xs font-semibold text-foreground">Mission Control evidence and Nexus Brain</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">Open the full operating health, workstreams, completed automations, approvals and cross-client correlations.</p>
          </div>
          <span className="flex shrink-0 items-center gap-2 text-[10px] font-medium text-primary">
            Open full intelligence <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" />
          </span>
        </summary>
        <div className="mt-3 space-y-4 border-t border-border/70 pt-4">
          <MissionControlOverview data={missionControl} navigate={navigate} onOpenCommand={openCommandPalette} detailOnly />
          <NexusBrainBriefing data={nexusBrain} navigate={navigate} />
        </div>
      </details>

      <details className="group rounded-2xl border border-white/[0.07] bg-[#0f1116] p-3" data-testid="dashboard-operational-detail">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-2 py-1.5 text-left outline-none transition hover:bg-white/[0.025]">
        <div>
          <p className="text-xs font-semibold text-zinc-200">Operational analytics and custom widgets</p>
          <p className="mt-0.5 text-[10px] text-zinc-500">Open the live ticker, SLA evidence, fleet analytics and personalised workspace when you need deeper context.</p>
        </div>
        <span className="flex shrink-0 items-center gap-2 text-[10px] font-medium text-cyan-200">
          Open detail <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" />
        </span>
      </summary>
      <div className="mt-3 space-y-3 border-t border-white/[0.06] pt-3">

      {/* Widget Edit Mode bar */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2 text-[11px] text-zinc-500">
          {editMode ? (
            <><Unlock className="w-3 h-3 text-violet-400" /><span className="text-violet-300 font-medium">Edit mode active</span> — drag widgets, resize from the bottom-right, or click <X className="inline w-3 h-3 mx-0.5 text-rose-400" /> to hide{hiddenWidgets.size > 0 ? <> · <span className="text-amber-300">{hiddenWidgets.size} hidden</span></> : null}</>
          ) : (
            <><Lock className="w-3 h-3" />Layout locked · click <strong className="text-zinc-300">Customise</strong> to rearrange{hiddenWidgets.size > 0 ? <> · <span className="text-amber-300/80">{hiddenWidgets.size} widget{hiddenWidgets.size > 1 ? "s" : ""} hidden</span></> : null}</>
          )}
        </div>
        <div className="flex gap-2">
          {editMode && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-7 text-[10px] text-emerald-300 border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20" data-testid="add-widget-btn">
                  <PlusCircle className="w-3 h-3 mr-1" />Add Widget{hiddenList.length > 0 ? ` (${hiddenList.length})` : ""}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-zinc-500">
                  {hiddenList.length === 0 ? "All widgets visible" : `${hiddenList.length} hidden widget${hiddenList.length > 1 ? "s" : ""}`}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {hiddenList.length === 0 ? (
                  <div className="px-3 py-4 text-[11px] text-zinc-500 text-center">
                    <LayoutGrid className="w-5 h-5 mx-auto mb-1.5 opacity-40" />
                    Hide widgets via the <X className="inline w-3 h-3 mx-0.5 text-rose-400" /> button to see them here
                  </div>
                ) : (
                  hiddenList.map(id => {
                    const meta = WIDGET_META[id];
                    const Icon = meta?.icon || LayoutGrid;
                    return (
                      <DropdownMenuItem key={id} onClick={() => showWidget(id)} className="cursor-pointer" data-testid={`add-widget-${id}`}>
                        <Icon className="w-3.5 h-3.5 mr-2 text-violet-400" />
                        <span className="flex-1 text-xs">{meta?.label || id}</span>
                        <Plus className="w-3 h-3 text-emerald-400" />
                      </DropdownMenuItem>
                    );
                  })
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {editMode && (
            <Button size="sm" variant="ghost" className="h-7 text-[10px] text-zinc-400" onClick={resetLayout} data-testid="reset-layout-btn">
              <RotateCcw className="w-3 h-3 mr-1" />Reset
            </Button>
          )}
          <Button size="sm" variant="outline" className={`h-7 text-[10px] ${editMode ? "text-violet-300 border-violet-500/40 bg-violet-500/10" : ""}`} onClick={() => setEditMode(e => !e)} data-testid="customise-layout-btn">
            {editMode ? <><Lock className="w-3 h-3 mr-1" />Lock</> : <><Unlock className="w-3 h-3 mr-1" />Customise</>}
          </Button>
        </div>
      </div>

      {/* Draggable / resizable widget grid */}
      <ResponsiveGridLayout
        className={`layout ${editMode ? "nx-edit-mode" : ""}`}
        layouts={visibleLayouts}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
        cols={{ lg: 12, md: 12, sm: 8, xs: 4, xxs: 2 }}
        rowHeight={48}
        margin={[12, 12]}
        containerPadding={[0, 0]}
        isDraggable={editMode}
        isResizable={editMode}
        onLayoutChange={onLayoutChange}
        draggableCancel=".nx-widget-hide,button,a,input,kbd"
        useCSSTransforms
        compactType="vertical"
      >

      {!hiddenWidgets.has("live-ticker") && (
      <div key="live-ticker" className="nx-widget-card">
        <button onClick={(e) => { e.stopPropagation(); hideWidget("live-ticker"); }} className="nx-widget-hide" data-testid="hide-widget-live-ticker" aria-label="Hide Live Operations Ticker"><X className="w-3 h-3" /></button>
        <LiveOpsTicker items={tickerItems} onNavigate={navigate} />
      </div>
      )}

      {!hiddenWidgets.has("cross-bridge") && (
      <div key="cross-bridge" className="nx-widget-card">
        <button onClick={(e) => { e.stopPropagation(); hideWidget("cross-bridge"); }} className="nx-widget-hide" data-testid="hide-widget-cross-bridge" aria-label="Hide Cross-Module Bridge"><X className="w-3 h-3" /></button>
        <Card className="border-violet-500/20 bg-gradient-to-br from-card via-card to-violet-500/[0.02] h-full" data-testid="command-bridge">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-violet-400" />Cross-Module Bridge</CardTitle>
            <span className="text-[10px] uppercase tracking-widest font-mono text-zinc-500">live · auto-refresh 60s</span>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <div className="text-[10px] uppercase tracking-widest font-mono text-cyan-300 flex items-center gap-1 mb-1"><Ticket className="w-3 h-3" />Tickets</div>
              {criticalTickets.slice(0, 3).map(t => (
                <button key={t.id} onClick={() => navigate("/tickets")} className="w-full text-left px-2.5 py-1.5 rounded border border-rose-500/30 bg-rose-500/5 hover:brightness-125 transition" data-testid={`bridge-tk-${t.id}`}>
                  <div className="text-xs font-medium text-rose-300 truncate">{t.title}</div>
                  <div className="text-[10px] text-zinc-500 truncate">#{t.ticket_number} · {t.client_name}</div>
                </button>
              ))}
              {criticalTickets.length === 0 && <p className="text-[10px] text-emerald-400/80 px-2 py-1.5">No critical tickets</p>}
            </div>
            <div className="space-y-1.5">
              <div className="text-[10px] uppercase tracking-widest font-mono text-emerald-300 flex items-center gap-1 mb-1"><Monitor className="w-3 h-3" />Devices</div>
              {offlineDevices.slice(0, 3).map(d => (
                <button key={d.id} onClick={() => navigate(`/devices/${d.id}`)} className="w-full text-left px-2.5 py-1.5 rounded border border-rose-500/30 bg-rose-500/5 hover:brightness-125 transition" data-testid={`bridge-dev-${d.id}`}>
                  <div className="text-xs font-medium text-rose-300 truncate">{d.name || d.hostname}</div>
                  <div className="text-[10px] text-zinc-500 truncate">{d.client_name} · offline</div>
                </button>
              ))}
              {warningDevices.slice(0, Math.max(0, 3 - offlineDevices.length)).map(d => (
                <button key={d.id} onClick={() => navigate(`/devices/${d.id}`)} className="w-full text-left px-2.5 py-1.5 rounded border border-amber-500/30 bg-amber-500/5 hover:brightness-125 transition" data-testid={`bridge-dev-${d.id}`}>
                  <div className="text-xs font-medium text-amber-300 truncate">{d.name || d.hostname}</div>
                  <div className="text-[10px] text-zinc-500 truncate">{d.client_name} · warning</div>
                </button>
              ))}
              {offlineDevices.length === 0 && warningDevices.length === 0 && <p className="text-[10px] text-emerald-400/80 px-2 py-1.5">All devices nominal</p>}
            </div>
            <div className="space-y-1.5">
              <div className="text-[10px] uppercase tracking-widest font-mono text-amber-300 flex items-center gap-1 mb-1"><AlertCircle className="w-3 h-3" />Alerts</div>
              {(alerts || []).slice(0, 3).map(a => (
                <button key={a.id} onClick={() => navigate("/security-dashboard")} className={`w-full text-left px-2.5 py-1.5 rounded border ${a.severity === "critical" ? "border-rose-500/30 bg-rose-500/5" : "border-amber-500/30 bg-amber-500/5"} hover:brightness-125 transition`} data-testid={`bridge-al-${a.id}`}>
                  <div className={`text-xs font-medium truncate ${a.severity === "critical" ? "text-rose-300" : "text-amber-300"}`}>{a.title || a.message}</div>
                  <div className="text-[10px] text-zinc-500 truncate uppercase tracking-widest">{a.severity || "info"}</div>
                </button>
              ))}
              {(alerts || []).length === 0 && <p className="text-[10px] text-emerald-400/80 px-2 py-1.5">No active alerts</p>}
            </div>
            <div className="space-y-1.5">
              <div className="text-[10px] uppercase tracking-widest font-mono text-violet-300 flex items-center gap-1 mb-1"><Zap className="w-3 h-3" />Predictions</div>
              {(mspIntel?.urgentPredictions || []).slice(0, 3).map((p, i) => (
                <button key={`p-${i}`} onClick={() => navigate("/predictive-failure")} className="w-full text-left px-2.5 py-1.5 rounded border border-violet-500/30 bg-violet-500/5 hover:brightness-125 transition" data-testid={`bridge-pred-${i}`}>
                  <div className="text-xs font-medium text-violet-300 truncate">{p.device_name || "Device"}</div>
                  <div className="text-[10px] text-zinc-500 truncate">{p.failure_type || "predicted failure"} · {p.days_until_failure}d</div>
                </button>
              ))}
              {(mspIntel?.urgentPredictions || []).length === 0 && <p className="text-[10px] text-emerald-400/80 px-2 py-1.5">No urgent predictions</p>}
            </div>
          </CardContent>
        </Card>
      </div>
      )}

      {!hiddenWidgets.has("team-pins") && (
      <div key="team-pins" className="nx-widget-card">
        <button onClick={(e) => { e.stopPropagation(); hideWidget("team-pins"); }} className="nx-widget-hide" data-testid="hide-widget-team-pins" aria-label="Hide Team Pins"><X className="w-3 h-3" /></button>
        <TeamPinsStrip />
      </div>
      )}

      {!hiddenWidgets.has("whats-new") && (
      <div key="whats-new" className="nx-widget-card">
        <button onClick={(e) => { e.stopPropagation(); hideWidget("whats-new"); }} className="nx-widget-hide" data-testid="hide-widget-whats-new" aria-label="Hide What's New"><X className="w-3 h-3" /></button>
        <WhatsNewTile />
      </div>
      )}
      {!hiddenWidgets.has("threat") && (
      <div key="threat" className="nx-widget-card">
        <button onClick={(e) => { e.stopPropagation(); hideWidget("threat"); }} className="nx-widget-hide" data-testid="hide-widget-threat" aria-label="Hide Threat Radar"><X className="w-3 h-3" /></button>
        <ThreatRadarTicker />
      </div>
      )}
      {!hiddenWidgets.has("sla-radar") && (
      <div key="sla-radar" className="nx-widget-card">
        <button onClick={(e) => { e.stopPropagation(); hideWidget("sla-radar"); }} className="nx-widget-hide" data-testid="hide-widget-sla-radar" aria-label="Hide SLA Radar"><X className="w-3 h-3" /></button>
        <SLARadarTile />
      </div>
      )}
      {!hiddenWidgets.has("blueprint") && (
      <div key="blueprint" className="nx-widget-card">
        <button onClick={(e) => { e.stopPropagation(); hideWidget("blueprint"); }} className="nx-widget-hide" data-testid="hide-widget-blueprint" aria-label="Hide Blueprint Insights"><X className="w-3 h-3" /></button>
        <BlueprintInsightsTile />
      </div>
      )}
      {!hiddenWidgets.has("churn") && (
      <div key="churn" className="nx-widget-card">
        <button onClick={(e) => { e.stopPropagation(); hideWidget("churn"); }} className="nx-widget-hide" data-testid="hide-widget-churn" aria-label="Hide Churn Risk"><X className="w-3 h-3" /></button>
        <ChurnRiskTile />
      </div>
      )}

      {/* Huntress Security Snapshot */}
      {!hiddenWidgets.has("huntress") && (
      <div key="huntress" className="nx-widget-card">
        <button onClick={(e) => { e.stopPropagation(); hideWidget("huntress"); }} className="nx-widget-hide" data-testid="hide-widget-huntress" aria-label="Hide Huntress Snapshot"><X className="w-3 h-3" /></button>
        <HuntressSummaryCard compact />
      </div>
      )}

      {/* Ticket Volume Chart */}
      {!hiddenWidgets.has("ticket-trend") && (
      <div key="ticket-trend" className="nx-widget-card">
        <button onClick={(e) => { e.stopPropagation(); hideWidget("ticket-trend"); }} className="nx-widget-hide" data-testid="hide-widget-ticket-trend" aria-label="Hide Ticket Volume"><X className="w-3 h-3" /></button>
        <Card className="h-full overflow-hidden" data-testid="ticket-trend-chart">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2"><Activity className="w-4 h-4 text-blue-400" />Ticket Volume (7 Days)</CardTitle>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <Badge variant="outline" className="text-[9px] text-muted-foreground border-border/40">Live</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3b82f6" stopOpacity={0.35} /><stop offset="100%" stopColor="#3b82f6" stopOpacity={0} /></linearGradient>
                    <linearGradient id="strokeGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#3b82f6" /><stop offset="100%" stopColor="#8b5cf6" /></linearGradient>
                  </defs>
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} width={30} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.3)" }} />
                  <Area type="monotone" dataKey="tickets" stroke="url(#strokeGrad)" strokeWidth={2.5} fill="url(#tg)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
      )}

      {/* Fleet Health */}
      {!hiddenWidgets.has("fleet-health") && (
      <div key="fleet-health" className="nx-widget-card">
        <button onClick={(e) => { e.stopPropagation(); hideWidget("fleet-health"); }} className="nx-widget-hide" data-testid="hide-widget-fleet-health" aria-label="Hide Fleet Health"><X className="w-3 h-3" /></button>
        <Card className="h-full" data-testid="device-health-card">
          <CardHeader className="pb-0">
            <CardTitle className="text-sm font-semibold flex items-center gap-2"><Cpu className="w-4 h-4 text-emerald-400" />Fleet Health</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="h-[130px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={[
                    { name: "Online", value: onlineDevices.length, color: "#22C55E" },
                    { name: "Warning", value: warningDevices.length, color: "#EAB308" },
                    { name: "Offline", value: offlineDevices.length, color: "#EF4444" }
                  ]} cx="50%" cy="50%" innerRadius={38} outerRadius={55} paddingAngle={4} dataKey="value">
                    {[{ color: "#22C55E" }, { color: "#EAB308" }, { color: "#EF4444" }].map((e, i) => <Cell key={`k-${i}`} fill={e.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-center gap-4 text-xs mb-3">
              <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(34,197,94,0.4)]" />{onlineDevices.length} Online</div>
              <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-[0_0_6px_rgba(234,179,8,0.4)]" />{warningDevices.length} Warning</div>
              <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.4)]" />{offlineDevices.length} Offline</div>
            </div>
            <Separator className="mb-3 opacity-30" />
            <div className="space-y-2">
              {[
                { icon: Server, label: "Servers", count: devices.filter(d => d.device_type === "server").length, color: "text-blue-400", bg: "bg-blue-500/10" },
                { icon: Monitor, label: "Workstations", count: devices.filter(d => d.device_type === "workstation").length, color: "text-purple-400", bg: "bg-purple-500/10" },
                { icon: Laptop, label: "Laptops", count: devices.filter(d => d.device_type === "laptop").length, color: "text-cyan-400", bg: "bg-cyan-500/10" },
                { icon: Wifi, label: "Network", count: devices.filter(d => d.device_type === "network").length, color: "text-orange-400", bg: "bg-orange-500/10" },
              ].map((item, i) => (
                <div key={`k-${i}`} className="flex items-center justify-between group/row hover:bg-muted/30 rounded-lg px-2 py-1 -mx-2 transition-colors">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-6 h-6 rounded-md ${item.bg} flex items-center justify-center`}><item.icon className={`w-3 h-3 ${item.color}`} /></div>
                    <span className="text-xs">{item.label}</span>
                  </div>
                  <span className="font-mono text-xs font-bold">{item.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
      )}

      {/* Operational Insights */}
      {!hiddenWidgets.has("ops-insights") && (
      <div key="ops-insights" className="nx-widget-card">
      <button onClick={(e) => { e.stopPropagation(); hideWidget("ops-insights"); }} className="nx-widget-hide" data-testid="hide-widget-ops-insights" aria-label="Hide Operational Insights"><X className="w-3 h-3" /></button>
      {mspIntel && (
        <details className="group" open data-testid="ops-insights">
          <summary className="cursor-pointer flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors py-1">
            <Eye className="w-4 h-4" />
            Operational Insights
            <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
            {(mspIntel.urgentPredictions || []).length > 0 && <Badge variant="destructive" className="text-[9px] h-4 px-1.5 animate-pulse">{mspIntel.urgentPredictions.length} urgent</Badge>}
          </summary>
          <div className="grid grid-cols-3 gap-3 mt-3">
            <Card className="border-border/30 overflow-hidden">
              <div className="h-0.5 bg-gradient-to-r from-red-500 to-orange-500" />
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-xs font-semibold flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 text-red-400" />Failure Predictions</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => navigate("/predictive-failure")} className="text-[10px] h-5 px-1.5">View<ExternalLink className="w-2.5 h-2.5 ml-0.5" /></Button>
              </CardHeader>
              <CardContent className="pt-0">
                {(mspIntel.urgentPredictions || []).length === 0 ? (
                  <div className="text-center py-4"><CheckCircle className="w-5 h-5 mx-auto text-emerald-400/40 mb-1" /><p className="text-[10px] text-emerald-400">All clear</p></div>
                ) : (
                  <div className="space-y-1.5">
                    {mspIntel.urgentPredictions.slice(0, 3).map(p => (
                      <div key={p.id} className="flex items-center gap-2 p-2 rounded-lg bg-red-500/5 border border-red-500/10">
                        <HardDrive className="w-3 h-3 text-red-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0"><p className="text-[11px] font-medium truncate">{p.device_name}</p><p className="text-[9px] text-muted-foreground truncate">{p.prediction}</p></div>
                        <span className="text-[11px] font-black text-red-400">{p.days_until_failure}d</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/30 overflow-hidden">
              <div className="h-0.5 bg-gradient-to-r from-blue-500 to-cyan-500" />
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-xs font-semibold flex items-center gap-1.5"><HardDrive className="w-3.5 h-3.5 text-blue-400" />Backups</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => navigate("/backup-dashboard")} className="text-[10px] h-5 px-1.5">View<ExternalLink className="w-2.5 h-2.5 ml-0.5" /></Button>
              </CardHeader>
              <CardContent className="pt-0">
                {mspIntel.backup ? (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className={`text-xl font-black ${mspIntel.backup.success_rate >= 90 ? "text-emerald-400" : mspIntel.backup.success_rate >= 70 ? "text-amber-400" : "text-red-400"}`}>{mspIntel.backup.success_rate}%</span>
                      <span className="text-[10px] text-muted-foreground">{mspIntel.backup.total_jobs} jobs</span>
                    </div>
                    <Progress value={mspIntel.backup.success_rate} className="h-1.5 mb-2" />
                    <div className="grid grid-cols-3 gap-1.5 text-center">
                      <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/10"><p className="text-xs font-bold text-emerald-400">{mspIntel.backup.successful}</p><p className="text-[8px] text-muted-foreground">OK</p></div>
                      <div className="p-1.5 rounded-lg bg-red-500/10 border border-red-500/10"><p className="text-xs font-bold text-red-400">{mspIntel.backup.failed}</p><p className="text-[8px] text-muted-foreground">Fail</p></div>
                      <div className="p-1.5 rounded-lg bg-blue-500/10 border border-blue-500/10"><p className="text-xs font-bold text-blue-400">{mspIntel.backup.running}</p><p className="text-[8px] text-muted-foreground">Run</p></div>
                    </div>
                  </div>
                ) : <p className="text-[10px] text-muted-foreground text-center py-4">No backup data</p>}
              </CardContent>
            </Card>

            <Card className="border-border/30 overflow-hidden">
              <div className="h-0.5 bg-gradient-to-r from-emerald-500 to-teal-500" />
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-xs font-semibold flex items-center gap-1.5"><Shield className="w-3.5 h-3.5 text-emerald-400" />Compliance</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => navigate("/compliance?tab=overview")} className="text-[10px] h-5 px-1.5">View<ExternalLink className="w-2.5 h-2.5 ml-0.5" /></Button>
              </CardHeader>
              <CardContent className="pt-0">
                {mspIntel.frameworks ? (
                  <div className="space-y-2">
                    {mspIntel.frameworks.slice(0, 4).map(fw => {
                      const rawPercentage = Number(fw.compliance_pct);
                      const percentage = Number.isFinite(rawPercentage) && rawPercentage >= 0 && rawPercentage <= 100 ? Math.round(rawPercentage) : null;
                      const needsEvidenceReview = fw.evidence_state === "data_quality_issue" || percentage === null;
                      return (
                        <div key={fw.id || fw.name}>
                          <div className="flex items-center justify-between gap-2 mb-0.5">
                            <span className="min-w-0 truncate text-[10px] font-medium">{fw.name}</span>
                            {needsEvidenceReview ? <span className="shrink-0 text-[9px] font-semibold text-amber-400">Review evidence</span> : <span className={`shrink-0 text-[10px] font-bold ${percentage >= 80 ? "text-emerald-400" : percentage >= 60 ? "text-amber-400" : "text-red-400"}`}>{percentage}%</span>}
                          </div>
                          <Progress value={percentage ?? 0} className="h-1" />
                        </div>
                      );
                    })}
                  </div>
                ) : <p className="text-[10px] text-muted-foreground text-center py-4">No compliance data</p>}
              </CardContent>
            </Card>
          </div>
        </details>
      )}
      </div>
      )}

      {/* Bottom Row: Tickets + Alerts + Activity */}
      {!hiddenWidgets.has("open-tix") && (
      <div key="open-tix" className="nx-widget-card">
        <button onClick={(e) => { e.stopPropagation(); hideWidget("open-tix"); }} className="nx-widget-hide" data-testid="hide-widget-open-tix" aria-label="Hide Open Tickets"><X className="w-3 h-3" /></button>
        <Card className="h-full" data-testid="open-tickets-card">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2"><Ticket className="w-4 h-4 text-blue-400" />{myTickets.length ? "My Queue" : "Open Tickets"}</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate("/tickets")} className="text-[10px] h-5 px-2">{myTickets.length ? `${myTickets.length} mine` : `${stats.open_tickets} total`}<ExternalLink className="w-2.5 h-2.5 ml-1" /></Button>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[240px]">
              {queueTickets.length > 0 ? queueTickets.map(t => (
                <div key={t.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 cursor-pointer border-b border-border/20 last:border-0 transition-colors" onClick={() => navigate("/tickets")} data-testid={`dash-ticket-${t.id}`}>
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot[t.status] || "bg-gray-400"} shadow-[0_0_4px_rgba(59,130,246,0.3)]`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{t.title}</p>
                    <span className="text-[10px] text-muted-foreground">{t.client_name} {t.created_at ? `- ${formatDistanceToNow(new Date(t.created_at), { addSuffix: true })}` : ""}</span>
                  </div>
                  <Badge className={`${priorityColors[t.priority]} text-[9px] shrink-0`}>{t.priority}</Badge>
                </div>
              )) : (
                <div className="text-center py-12 text-muted-foreground"><CheckCircle className="w-8 h-8 mx-auto mb-2 opacity-30" /><p className="text-sm">All clear!</p></div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
      )}

      {!hiddenWidgets.has("alerts") && (
      <div key="alerts" className="nx-widget-card">
        <button onClick={(e) => { e.stopPropagation(); hideWidget("alerts"); }} className="nx-widget-hide" data-testid="hide-widget-alerts" aria-label="Hide Alerts"><X className="w-3 h-3" /></button>
        <Card className="h-full" data-testid="alerts-card">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2"><AlertTriangle className={`w-4 h-4 ${alerts.length > 0 ? "text-amber-400" : "text-muted-foreground"}`} />Alerts</CardTitle>
            <Badge variant={alerts.length > 0 ? "destructive" : "secondary"} className={`text-[9px] h-4 ${alerts.length > 0 ? "animate-pulse" : ""}`}>{alerts.length}</Badge>
          </CardHeader>
          <CardContent className="p-0 px-3">
            <ScrollArea className="h-[240px]">
              {alerts.length > 0 ? alerts.slice(0, 6).map(a => (
                <button key={a.id} onClick={() => navigate(a.device_id ? `/devices/${a.device_id}` : "/security-dashboard")} className="group flex w-full items-start gap-2.5 rounded px-1 py-2.5 text-left border-b border-border/20 last:border-0 hover:bg-muted/40 transition-colors" data-testid={`dashboard-alert-${a.id}`}>
                  <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${a.severity === "critical" ? "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.4)]" : "bg-amber-500 shadow-[0_0_6px_rgba(234,179,8,0.4)]"}`} />
                  <div className="min-w-0 flex-1"><p className="text-xs font-medium leading-tight truncate">{a.message || a.title || "Active alert"}</p><span className="text-[10px] text-muted-foreground">{a.device_name || a.source || "Security queue"}</span></div><ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/60 group-hover:translate-x-0.5 transition-transform" />
                </button>
              )) : (
                <div className="text-center py-12 text-muted-foreground"><CheckCircle className="w-8 h-8 mx-auto mb-2 opacity-30" /><p className="text-sm">No alerts</p></div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
      )}

      {!hiddenWidgets.has("activity") && (
      <div key="activity" className="nx-widget-card">
        <button onClick={(e) => { e.stopPropagation(); hideWidget("activity"); }} className="nx-widget-hide" data-testid="hide-widget-activity" aria-label="Hide Activity Feed"><X className="w-3 h-3" /></button>
        <Card className="h-full" data-testid="activity-feed-card">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2"><Zap className="w-4 h-4 text-cyan-400" />Activity</CardTitle>
            <div className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /><span className="text-[9px] text-muted-foreground">Live</span></div>
          </CardHeader>
          <CardContent className="p-0 px-3">
            <ScrollArea className="h-[240px]">
              {activityFeed.length > 0 ? activityFeed.map((item, i) => {
                const iconMap = { ticket_note: MessageSquare, ticket_created: Ticket, ticket_email: Mail, alert: AlertTriangle };
                const colorMap = { ticket_note: "text-indigo-400", ticket_created: "text-cyan-400", ticket_email: "text-sky-400", alert: "text-amber-400" };
                const bgMap = { ticket_note: "bg-indigo-500/10", ticket_created: "bg-cyan-500/10", ticket_email: "bg-sky-500/10", alert: "bg-amber-500/10" };
                const IconComp = iconMap[item.type] || Activity;
                const activityPath = item.ref_id ? item.ref_type === "device" ? `/devices/${item.ref_id}` : item.ref_type === "ticket" ? `/tickets?ticket=${encodeURIComponent(item.ref_id)}` : null : null;
                return (
                  <button key={item.id} disabled={!activityPath} onClick={() => activityPath && navigate(activityPath)} className={`flex w-full items-start gap-3 border-b border-border/20 py-2.5 text-left last:border-0 rounded px-1 -mx-1 transition-colors ${activityPath ? "group/feed hover:bg-muted/40 cursor-pointer" : "cursor-default"}`} aria-label={activityPath ? `Open ${item.title}` : undefined}>
                    <div className={`w-7 h-7 rounded-lg ${bgMap[item.type] || "bg-zinc-500/10"} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                      <IconComp className={`w-3.5 h-3.5 ${colorMap[item.type] || "text-gray-400"}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{item.title}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{item.description}</p><p className="mt-0.5 text-[9px] text-muted-foreground/70">{item.timestamp ? formatDistanceToNow(new Date(item.timestamp), { addSuffix: true }) : "Recent"}</p>
                    </div>
                    <span className="text-[9px] text-muted-foreground/60 shrink-0 pt-0.5">{activityPath ? <ChevronRight className="h-3.5 w-3.5" /> : item.user}</span>
                  </button>
                );
              }) : (
                <div className="text-center py-12 text-muted-foreground"><Activity className="w-8 h-8 mx-auto mb-2 opacity-30" /><p className="text-sm">No recent activity</p></div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
      )}

      </ResponsiveGridLayout>
      </div>
      </details>
    </div>
    </PageShell>
  );
}

function LiveOpsTicker({ items, onNavigate }) {
  const repeated = [...items, ...items];
  return (
    <div className="nx-live-ticker h-full" data-testid="live-ops-ticker">
      <div className="nx-live-ticker__label"><Activity className="w-3.5 h-3.5" /><span>Live ops</span><span className="nx-live-ticker__pulse" /></div>
      <div className="nx-live-ticker__viewport">
        <div className="nx-live-ticker__track">
          {repeated.map((item, index) => {
            const Icon = item.icon || Activity;
            return <button key={`${item.label}-${index}`} onClick={() => onNavigate(item.path)} className={`nx-live-ticker__item nx-live-ticker__item--${item.tone}`}>
              <Icon className="w-3.5 h-3.5 shrink-0" /><span className="font-medium">{item.label}</span><span className="nx-live-ticker__detail">{item.detail}</span>
            </button>;
          })}
        </div>
      </div>
      <span className="nx-live-ticker__refresh">Refreshes every minute</span>
    </div>
  );
}
