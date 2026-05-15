import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  Users, Monitor, Ticket, AlertTriangle, DollarSign, Clock, ArrowUpRight,
  RefreshCw, MessageSquare, Activity, AlertCircle, CheckCircle, XCircle,
  Shield, HardDrive, ExternalLink, Plus, Search, Terminal, UserCog, CalendarDays,
  ChevronRight, TrendingUp, Zap, Server, Laptop, Wifi, Eye, Cpu, BarChart3, Sparkles,
  Lock, Unlock, RotateCcw
} from "lucide-react";
import { toast } from "sonner";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell
} from "recharts";
import { formatDistanceToNow } from "date-fns";
import { PageShell } from "@/components/design-system";
import HeroTile from "@/components/HeroTile";
import { Responsive, WidthProvider } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import "@/styles/dashboard-grid.css";

const ResponsiveGridLayout = WidthProvider(Responsive);

// Default widget layout (lg breakpoint = 12 cols)
const DEFAULT_LAYOUT_LG = [
  { i: "team-pins",   x: 0, y: 0,  w: 12, h: 2, minH: 1, minW: 4 },
  { i: "hero-banner", x: 0, y: 2,  w: 12, h: 3, minH: 2, minW: 6 },
  { i: "standup",     x: 0, y: 5,  w: 12, h: 3, minH: 2, minW: 4 },
  { i: "threat",      x: 0, y: 8,  w: 12, h: 2, minH: 1, minW: 4 },
  { i: "sla-radar",   x: 0, y: 10, w: 12, h: 3, minH: 2, minW: 4 },
  { i: "blueprint",   x: 0, y: 13, w: 6,  h: 5, minH: 3, minW: 3 },
  { i: "churn",       x: 6, y: 13, w: 6,  h: 5, minH: 3, minW: 3 },
  { i: "huntress",    x: 0, y: 18, w: 12, h: 4, minH: 2, minW: 4 },
  { i: "attention",   x: 0, y: 22, w: 12, h: 2, minH: 1, minW: 4 },
  { i: "ticket-trend",x: 0, y: 24, w: 8,  h: 6, minH: 4, minW: 4 },
  { i: "fleet-health",x: 8, y: 24, w: 4,  h: 6, minH: 4, minW: 3 },
  { i: "ops-insights",x: 0, y: 30, w: 12, h: 6, minH: 3, minW: 6 },
  { i: "open-tix",    x: 0, y: 36, w: 5,  h: 7, minH: 4, minW: 3 },
  { i: "alerts",      x: 5, y: 36, w: 3,  h: 7, minH: 4, minW: 2 },
  { i: "activity",    x: 8, y: 36, w: 4,  h: 7, minH: 4, minW: 3 },
];

const LAYOUT_STORAGE_KEY = "nx-dashboard-layout-v1";
import TeamPinsStrip from "@/components/dashboard/TeamPinsStrip";
import { StandupDigestBanner } from "@/components/ai/StandupDigestBanner";
import { BlueprintInsightsTile } from "@/components/ai/BlueprintInsightsTile";
import { ThreatRadarTicker } from "@/components/ai/ThreatRadarTicker";
import { ChurnRiskTile } from "@/components/ai/ChurnRiskTile";
import { SLARadarTile } from "@/components/ai/SLARadarTile";
import { CoffeeBreakToggle } from "@/components/ai/CoffeeBreakToggle";
import { HuntressSummaryCard } from "@/components/security/HuntressSummaryCard";
import WeatherStrip from "@/components/ambient/WeatherStrip";

export default function DashboardPage() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [enhancedStats, setEnhancedStats] = useState(null);
  const [ticketTrends, setTicketTrends] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [activityFeed, setActivityFeed] = useState([]);
  const [devices, setDevices] = useState([]);
  const [mspIntel, setMspIntel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef(null);
  const autoRefreshRef = useRef(null);
  const [now] = useState(new Date());

  const headers = { Authorization: `Bearer ${token}` };

  const fetchDashboardData = async () => {
    try {
      const [statsRes, trendsRes, alertsRes, ticketsRes, activityRes, enhancedRes, devicesRes] = await Promise.all([
        axios.get(`${API}/dashboard/stats`, { headers }),
        axios.get(`${API}/dashboard/ticket-trends`, { headers }),
        axios.get(`${API}/alerts?status=active`, { headers }),
        axios.get(`${API}/tickets?status=open`, { headers }),
        axios.get(`${API}/dashboard/activity-feed?limit=15`, { headers }),
        axios.get(`${API}/dashboard/enhanced-stats`, { headers }),
        axios.get(`${API}/devices`, { headers }),
      ]);
      setStats(statsRes.data);
      setEnhancedStats(enhancedRes.data);
      setTicketTrends(trendsRes.data);
      setAlerts(alertsRes.data);
      setTickets(ticketsRes.data.slice(0, 8));
      setActivityFeed(activityRes.data);
      setDevices(devicesRes.data);

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
    } finally {
      setLoading(false);
    }
  };

  // Dashboard widget layout — persisted per user in localStorage
  const [editMode, setEditMode] = useState(false);
  const [layouts, setLayouts] = useState(() => {
    try {
      const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch { /* ignore */ }
    return { lg: DEFAULT_LAYOUT_LG };
  });
  const onLayoutChange = (_currentLayout, allLayouts) => {
    setLayouts(allLayouts);
    try { localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(allLayouts)); } catch { /* */ }
  };
  const resetLayout = () => {
    setLayouts({ lg: DEFAULT_LAYOUT_LG });
    try { localStorage.removeItem(LAYOUT_STORAGE_KEY); } catch { /* */ }
    toast.success("Dashboard layout reset to defaults");
  };

  useEffect(() => { fetchDashboardData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    autoRefreshRef.current = setInterval(fetchDashboardData, 60000);
    return () => clearInterval(autoRefreshRef.current);
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(true); }
      if (e.key === 'Escape') setSearchOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => { if (searchOpen && searchRef.current) searchRef.current.focus(); }, [searchOpen]);

  if (loading || !stats) {
    return (
      <div className="space-y-6" data-testid="dashboard-loading">
        <div className="h-32 rounded-2xl bg-gradient-to-br from-emerald-500/5 via-transparent to-blue-500/5 animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Card key={`k-${i}`}><CardContent className="p-6"><div className="h-16 rounded bg-muted animate-pulse" /></CardContent></Card>)}
        </div>
      </div>
    );
  }

  const onlineDevices = devices.filter(d => d.status === "online");
  const warningDevices = devices.filter(d => d.status === "warning");
  const offlineDevices = devices.filter(d => d.status === "offline");
  const criticalTickets = tickets.filter(t => t.priority === "critical");
  const needsPatching = devices.filter(d => (d.pending_patches || 0) > 0);
  const statusDot = { open: "bg-blue-500", in_progress: "bg-amber-500", resolved: "bg-emerald-500", closed: "bg-gray-400" };
  const priorityColors = { critical: "bg-red-500/10 text-red-500", high: "bg-orange-500/10 text-orange-500", medium: "bg-amber-500/10 text-amber-500", low: "bg-blue-500/10 text-blue-500" };
  const greeting = now.getHours() < 12 ? "Good Morning" : now.getHours() < 17 ? "Good Afternoon" : "Good Evening";

  const quickSearchResults = searchQuery ? [
    ...tickets.filter(t => t.title?.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 3).map(t => ({ type: "ticket", label: t.title, sub: t.ticket_number, path: "/tickets" })),
    ...devices.filter(d => d.name?.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 3).map(d => ({ type: "device", label: d.name, sub: d.client_name, path: `/devices/${d.id}` })),
  ] : [];

  const attentionItems = [];
  if ((enhancedStats?.sla_breaches || 0) > 0) attentionItems.push({ label: `${enhancedStats.sla_breaches} SLA Breach${enhancedStats.sla_breaches > 1 ? "es" : ""}`, color: "text-red-400", bg: "bg-red-500/10", borderColor: "border-red-500/20", icon: AlertCircle, path: "/tickets" });
  if (offlineDevices.length > 0) attentionItems.push({ label: `${offlineDevices.length} Offline Device${offlineDevices.length > 1 ? "s" : ""}`, color: "text-red-400", bg: "bg-red-500/10", borderColor: "border-red-500/20", icon: Monitor, path: "/devices" });
  if ((enhancedStats?.outstanding || 0) > 1000) attentionItems.push({ label: `$${(enhancedStats.outstanding || 0).toLocaleString()} Outstanding`, color: "text-orange-400", bg: "bg-orange-500/10", borderColor: "border-orange-500/20", icon: DollarSign, path: "/invoices" });
  if (needsPatching.length > 10) attentionItems.push({ label: `${needsPatching.length} Need Patching`, color: "text-amber-400", bg: "bg-amber-500/10", borderColor: "border-amber-500/20", icon: Shield, path: "/patch-hub" });
  if (criticalTickets.length > 0) attentionItems.push({ label: `${criticalTickets.length} Critical Ticket${criticalTickets.length > 1 ? "s" : ""}`, color: "text-red-400", bg: "bg-red-500/10", borderColor: "border-red-500/20", icon: Ticket, path: "/tickets" });
  if ((mspIntel?.urgentPredictions || []).length > 0) attentionItems.push({ label: `${mspIntel.urgentPredictions.length} Failure Prediction${mspIntel.urgentPredictions.length > 1 ? "s" : ""}`, color: "text-orange-400", bg: "bg-orange-500/10", borderColor: "border-orange-500/20", icon: AlertTriangle, path: "/predictive-failure" });

  const chartData = ticketTrends.length > 0 ? ticketTrends : [
    { date: "Mon", tickets: 12 }, { date: "Tue", tickets: 19 }, { date: "Wed", tickets: 15 },
    { date: "Thu", tickets: 22 }, { date: "Fri", tickets: 18 }, { date: "Sat", tickets: 8 }, { date: "Sun", tickets: 5 }
  ];

  return (
    <PageShell>
    <WeatherStrip />
    <div className="flex-1 overflow-y-auto p-6 space-y-5" data-testid="dashboard-page">

      {/* Command Bridge Header — matches all module Command Centers */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-violet-400" />Operations Command Bridge
          </h1>
          <p className="text-sm text-zinc-500">{greeting}, {user?.name?.split(" ")[0] || "Operator"} — live cross-module situational awareness</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setSearchOpen(true)} data-testid="bridge-search-btn">
            <Search className="w-3 h-3 mr-1" />Quick Search <kbd className="ml-1 text-[9px] bg-zinc-800 px-1 rounded">⌘K</kbd>
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => navigate("/tickets")} data-testid="bridge-tickets-btn"><Ticket className="w-3 h-3 mr-1" />Tickets</Button>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => navigate("/devices")} data-testid="bridge-devices-btn"><Monitor className="w-3 h-3 mr-1" />Devices</Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={fetchDashboardData} data-testid="bridge-refresh-btn"><RefreshCw className="w-3 h-3 mr-1" />Refresh</Button>
        </div>
      </div>

      {/* HeroTile Command Strip — same as every other module */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <HeroTile label="Open Tickets" value={stats.open_tickets || 0} icon={Ticket} glow={(stats.open_tickets || 0) > 20 ? "amber" : "cyan"} testId="bridge-tile-tickets" />
        <HeroTile label="Devices Online" value={onlineDevices.length} icon={Monitor} glow="emerald" testId="bridge-tile-online" />
        <HeroTile label="Devices Offline" value={offlineDevices.length} icon={Server} glow={offlineDevices.length > 0 ? "rose" : "zinc"} testId="bridge-tile-offline" />
        <HeroTile label="Critical Alerts" value={(alerts || []).filter(a => a.severity === "critical").length} icon={AlertTriangle} glow={(alerts || []).filter(a => a.severity === "critical").length > 0 ? "rose" : "emerald"} testId="bridge-tile-critical" />
        <HeroTile label="Clients" value={stats.total_clients || 0} icon={Users} glow="violet" testId="bridge-tile-clients" />
        <HeroTile label="MRR" value={`$${(stats.total_mrr || 0).toLocaleString()}`} icon={DollarSign} glow="emerald" animated={false} testId="bridge-tile-mrr" />
      </div>

      {/* Cross-module Command Bridge — top "Needs Attention" from each module */}
      <Card className="border-violet-500/20 bg-gradient-to-br from-card via-card to-violet-500/[0.02]" data-testid="command-bridge">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-violet-400" />Cross-Module Bridge</CardTitle>
          <span className="text-[10px] uppercase tracking-widest font-mono text-zinc-500">live · auto-refresh 60s</span>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Tickets column */}
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

          {/* Devices column */}
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

          {/* Alerts column */}
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-widest font-mono text-amber-300 flex items-center gap-1 mb-1"><AlertCircle className="w-3 h-3" />Alerts</div>
            {(alerts || []).slice(0, 3).map(a => (
              <button key={a.id} onClick={() => navigate("/security")} className={`w-full text-left px-2.5 py-1.5 rounded border ${a.severity === "critical" ? "border-rose-500/30 bg-rose-500/5" : "border-amber-500/30 bg-amber-500/5"} hover:brightness-125 transition`} data-testid={`bridge-al-${a.id}`}>
                <div className={`text-xs font-medium truncate ${a.severity === "critical" ? "text-rose-300" : "text-amber-300"}`}>{a.title || a.message}</div>
                <div className="text-[10px] text-zinc-500 truncate uppercase tracking-widest">{a.severity || "info"}</div>
              </button>
            ))}
            {(alerts || []).length === 0 && <p className="text-[10px] text-emerald-400/80 px-2 py-1.5">No active alerts</p>}
          </div>

          {/* Predictions / Compliance column */}
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

      <TeamPinsStrip />
      {/* Quick Search Modal */}
      {searchOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[20vh]" onClick={() => setSearchOpen(false)}>
          <div className="bg-card border border-border/50 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()} data-testid="quick-search-modal" style={{ boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)" }}>
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border/40">
              <Search className="w-5 h-5 text-muted-foreground" />
              <Input ref={searchRef} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search tickets, devices, clients..." className="border-0 shadow-none focus-visible:ring-0 text-base" />
              <kbd className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">ESC</kbd>
            </div>
            {searchQuery ? (
              <div className="p-2 max-h-64 overflow-y-auto">
                {quickSearchResults.length > 0 ? quickSearchResults.map((r, i) => (
                  <div key={`k-${i}`} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors" onClick={() => { navigate(r.path); setSearchOpen(false); }}>
                    {r.type === "ticket" ? <Ticket className="w-4 h-4 text-blue-500" /> : <Monitor className="w-4 h-4 text-emerald-500" />}
                    <div><p className="text-sm font-medium">{r.label}</p><p className="text-[10px] text-muted-foreground">{r.sub}</p></div>
                  </div>
                )) : <p className="text-sm text-muted-foreground text-center py-4">No results</p>}
              </div>
            ) : (
              <div className="p-3 space-y-1">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider px-2 mb-2">Quick Actions</p>
                {[
                  { icon: Ticket, label: "New Ticket", path: "/tickets", color: "text-blue-500" },
                  { icon: Users, label: "New Client", path: "/clients", color: "text-emerald-500" },
                  { icon: Monitor, label: "Add Device", path: "/devices", color: "text-purple-500" },
                  { icon: Terminal, label: "Run Script", path: "/scripting", color: "text-orange-500" },
                  { icon: CalendarDays, label: "Schedule", path: "/scheduling", color: "text-cyan-500" },
                  { icon: UserCog, label: "Technicians", path: "/technicians", color: "text-pink-500" },
                ].map((item, i) => (
                  <div key={`k-${i}`} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors" onClick={() => { navigate(item.path); setSearchOpen(false); }}>
                    <item.icon className={`w-4 h-4 ${item.color}`} /><span className="text-sm">{item.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Widget Edit Mode bar */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2 text-[11px] text-zinc-500">
          {editMode ? (
            <><Unlock className="w-3 h-3 text-violet-400" /><span className="text-violet-300 font-medium">Edit mode active</span> — drag widgets by their header, resize from the bottom-right corner</>
          ) : (
            <><Lock className="w-3 h-3" />Layout locked · click <strong className="text-zinc-300">Customise</strong> to rearrange</>
          )}
        </div>
        <div className="flex gap-2">
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
        layouts={layouts}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
        cols={{ lg: 12, md: 12, sm: 8, xs: 4, xxs: 2 }}
        rowHeight={48}
        margin={[12, 12]}
        containerPadding={[0, 0]}
        isDraggable={editMode}
        isResizable={editMode}
        draggableHandle=".nx-widget-handle"
        onLayoutChange={onLayoutChange}
        useCSSTransforms
      >

      <div key="hero-banner" className="nx-widget-card nx-widget-handle">
      <div className="relative overflow-hidden rounded-2xl border border-border/30" data-testid="dashboard-hero">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/8 via-blue-500/5 to-violet-500/8" />
        <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: "repeating-linear-gradient(0deg, rgba(255,255,255,.15) 0px, rgba(255,255,255,.15) 1px, transparent 1px, transparent 40px), repeating-linear-gradient(90deg, rgba(255,255,255,.15) 0px, rgba(255,255,255,.15) 1px, transparent 1px, transparent 40px)" }} />
        <div className="relative px-6 py-5 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{greeting}, <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">{user?.name?.split(" ")[0] || "Admin"}</span></h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {now.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })} — {stats.total_clients} clients, {devices.length} devices, {stats.open_tickets} open tickets
            </p>
          </div>
          <div className="flex gap-2">
            <CoffeeBreakToggle />
            <Button variant="outline" size="sm" onClick={() => setSearchOpen(true)} className="gap-2 backdrop-blur-md border-border/40" data-testid="quick-search-btn">
              <Search className="w-4 h-4" /><span className="hidden md:inline">Search</span><kbd className="text-[9px] text-muted-foreground bg-muted/80 px-1 rounded ml-1">Ctrl+K</kbd>
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/tickets")} className="backdrop-blur-md border-border/40" data-testid="new-ticket-btn"><Plus className="w-4 h-4 mr-1" />Ticket</Button>
            <Button variant="ghost" size="sm" onClick={fetchDashboardData} data-testid="refresh-dashboard"><RefreshCw className="w-4 h-4" /></Button>
          </div>
        </div>
      </div>

      {/* Morning Standup Digest */}
      <StandupDigestBanner />
      <ThreatRadarTicker />
      <SLARadarTile />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <BlueprintInsightsTile />
        <ChurnRiskTile />
      </div>

      {/* Huntress Security Snapshot */}
      <HuntressSummaryCard compact />

      {/* Attention Banner */}
      {attentionItems.length > 0 && (
        <div className="flex gap-2 flex-wrap" data-testid="attention-banner">
          {attentionItems.map((item, i) => (
            <button key={`k-${i}`} onClick={() => navigate(item.path)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-semibold transition-all hover:scale-[1.03] hover:shadow-lg ${item.bg} ${item.borderColor} ${item.color}`}
              style={{ boxShadow: "0 0 12px rgba(0,0,0,0.1)" }}
              data-testid={`attention-item-${i}`}>
              <item.icon className="w-3.5 h-3.5" />{item.label}<ChevronRight className="w-3 h-3 opacity-50" />
            </button>
          ))}
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-8 overflow-hidden" data-testid="ticket-trend-chart">
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

        <Card className="col-span-4" data-testid="device-health-card">
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

      {/* Operational Insights */}
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
                <Button variant="ghost" size="sm" onClick={() => navigate("/compliance-frameworks")} className="text-[10px] h-5 px-1.5">View<ExternalLink className="w-2.5 h-2.5 ml-0.5" /></Button>
              </CardHeader>
              <CardContent className="pt-0">
                {mspIntel.frameworks ? (
                  <div className="space-y-2">
                    {mspIntel.frameworks.slice(0, 4).map(fw => (
                      <div key={fw.id || fw.name}>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[10px] font-medium">{fw.name}</span>
                          <span className={`text-[10px] font-bold ${fw.compliance_pct >= 80 ? "text-emerald-400" : fw.compliance_pct >= 60 ? "text-amber-400" : "text-red-400"}`}>{Math.round(fw.compliance_pct)}%</span>
                        </div>
                        <Progress value={fw.compliance_pct} className="h-1" />
                      </div>
                    ))}
                  </div>
                ) : <p className="text-[10px] text-muted-foreground text-center py-4">No compliance data</p>}
              </CardContent>
            </Card>
          </div>
        </details>
      )}

      {/* Bottom Row: Tickets + Alerts + Activity */}
      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-5" data-testid="open-tickets-card">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2"><Ticket className="w-4 h-4 text-blue-400" />Open Tickets</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate("/tickets")} className="text-[10px] h-5 px-2">{stats.open_tickets} total<ExternalLink className="w-2.5 h-2.5 ml-1" /></Button>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[240px]">
              {tickets.length > 0 ? tickets.map(t => (
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

        <Card className="col-span-3" data-testid="alerts-card">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2"><AlertTriangle className={`w-4 h-4 ${alerts.length > 0 ? "text-amber-400" : "text-muted-foreground"}`} />Alerts</CardTitle>
            <Badge variant={alerts.length > 0 ? "destructive" : "secondary"} className={`text-[9px] h-4 ${alerts.length > 0 ? "animate-pulse" : ""}`}>{alerts.length}</Badge>
          </CardHeader>
          <CardContent className="p-0 px-3">
            <ScrollArea className="h-[240px]">
              {alerts.length > 0 ? alerts.slice(0, 6).map(a => (
                <div key={a.id} className="flex items-start gap-2.5 py-2.5 border-b border-border/20 last:border-0">
                  <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${a.severity === "critical" ? "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.4)]" : "bg-amber-500 shadow-[0_0_6px_rgba(234,179,8,0.4)]"}`} />
                  <div className="min-w-0"><p className="text-xs font-medium leading-tight truncate">{a.message}</p><span className="text-[10px] text-muted-foreground">{a.device_name}</span></div>
                </div>
              )) : (
                <div className="text-center py-12 text-muted-foreground"><CheckCircle className="w-8 h-8 mx-auto mb-2 opacity-30" /><p className="text-sm">No alerts</p></div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="col-span-4" data-testid="activity-feed-card">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2"><Zap className="w-4 h-4 text-cyan-400" />Activity</CardTitle>
            <div className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /><span className="text-[9px] text-muted-foreground">Live</span></div>
          </CardHeader>
          <CardContent className="p-0 px-3">
            <ScrollArea className="h-[240px]">
              {activityFeed.length > 0 ? activityFeed.map((item, i) => {
                const iconMap = { ticket_note: MessageSquare, ticket_created: Ticket, alert: AlertTriangle };
                const colorMap = { ticket_note: "text-indigo-400", ticket_created: "text-cyan-400", alert: "text-amber-400" };
                const bgMap = { ticket_note: "bg-indigo-500/10", ticket_created: "bg-cyan-500/10", alert: "bg-amber-500/10" };
                const IconComp = iconMap[item.type] || Activity;
                return (
                  <div key={item.id} className="flex items-start gap-3 py-2.5 border-b border-border/20 last:border-0 group/feed hover:bg-muted/20 transition-colors rounded px-1 -mx-1">
                    <div className={`w-7 h-7 rounded-lg ${bgMap[item.type] || "bg-zinc-500/10"} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                      <IconComp className={`w-3.5 h-3.5 ${colorMap[item.type] || "text-gray-400"}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{item.title}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{item.description}</p>
                    </div>
                    <span className="text-[9px] text-muted-foreground/60 shrink-0 pt-0.5">{item.user}</span>
                  </div>
                );
              }) : (
                <div className="text-center py-12 text-muted-foreground"><Activity className="w-8 h-8 mx-auto mb-2 opacity-30" /><p className="text-sm">No recent activity</p></div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
    </PageShell>
  );
}
