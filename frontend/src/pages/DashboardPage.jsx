import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  Users, Monitor, Ticket, AlertTriangle, DollarSign, TrendingUp, Clock, ArrowUpRight, ArrowDownRight,
  RefreshCw, MessageSquare, Activity, Package, ShoppingCart, AlertCircle, CheckCircle, XCircle,
  FileText, CreditCard, Zap, Server, Laptop, Wifi, Shield, ShieldAlert, HardDrive, Cpu, MemoryStick,
  Download, ExternalLink, Plus, ShieldCheck, ShieldX, Search, Terminal, UserCog, CalendarDays,
  BellOff, Flame, Calculator, Building2, BarChart3, Brain, DatabaseBackup, ChevronRight
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar
} from "recharts";
import { formatDistanceToNow } from "date-fns";

const StatCard = ({ title, value, icon: Icon, trend, trendValue, iconBg, iconColor, onClick }) => (
  <Card className="cursor-pointer hover:border-primary/30 transition-colors" onClick={onClick}>
    <CardContent className="p-5">
      <div className="flex items-start justify-between">
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{title}</p>
          <p className="text-2xl font-bold tracking-tight">{value}</p>
          {trend && (
            <div className={`flex items-center gap-1 text-xs ${trend === 'up' ? 'text-emerald-500' : 'text-red-500'}`}>
              {trend === 'up' ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
              <span>{trendValue}</span>
            </div>
          )}
        </div>
        <div className={`w-11 h-11 rounded-lg flex items-center justify-center ${iconBg || "bg-primary/10"}`}>
          <Icon className={`w-5 h-5 ${iconColor || "text-primary"}`} />
        </div>
      </div>
    </CardContent>
  </Card>
);

export default function DashboardPage() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [enhancedStats, setEnhancedStats] = useState(null);
  const [ticketTrends, setTicketTrends] = useState([]);
  const [deviceHealth, setDeviceHealth] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [activityFeed, setActivityFeed] = useState([]);
  const [devices, setDevices] = useState([]);
  const [deviceStats, setDeviceStats] = useState({});
  const [compliance, setCompliance] = useState(null);
  const [mspIntel, setMspIntel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef(null);
  const autoRefreshRef = useRef(null);

  const headers = { Authorization: `Bearer ${token}` };

  const fetchDashboardData = async () => {
    try {
      const [statsRes, trendsRes, healthRes, alertsRes, ticketsRes, activityRes, enhancedRes, devicesRes, devStatsRes, complianceRes] = await Promise.all([
        axios.get(`${API}/dashboard/stats`, { headers }),
        axios.get(`${API}/dashboard/ticket-trends`, { headers }),
        axios.get(`${API}/dashboard/device-health`, { headers }),
        axios.get(`${API}/alerts?status=active`, { headers }),
        axios.get(`${API}/tickets?status=open`, { headers }),
        axios.get(`${API}/dashboard/activity-feed?limit=20`, { headers }),
        axios.get(`${API}/dashboard/enhanced-stats`, { headers }),
        axios.get(`${API}/devices`, { headers }),
        axios.get(`${API}/devices/stats/summary`, { headers }).catch(() => ({ data: {} })),
        axios.get(`${API}/suped/compliance-dashboard`, { headers }).catch(() => ({ data: null })),
      ]);
      setStats(statsRes.data);
      setEnhancedStats(enhancedRes.data);
      setTicketTrends(trendsRes.data);
      setDeviceHealth(healthRes.data);
      setAlerts(alertsRes.data);
      setTickets(ticketsRes.data.slice(0, 10));
      setActivityFeed(activityRes.data);
      setDevices(devicesRes.data);
      setDeviceStats(devStatsRes.data);
      setCompliance(complianceRes.data);

      // Cross-module MSP Intelligence
      const [backupRes, predRes, vendorRes, slaRes, aiRes, suppressRes, compFwRes, capacityRes, incidentRes] = await Promise.all([
        axios.get(`${API}/backup-dashboard/overview`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/predictive-failure/overview`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/vendor-scorecard/overview`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/sla-penalties/dashboard`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/ai-resolution/suggestions`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/alert-suppression/stats`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/compliance-frameworks/overview`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/capacity-planner/overview`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/incident-heatmap/data`, { headers }).catch(() => ({ data: null })),
      ]);
      setMspIntel({
        backup: backupRes.data?.summary,
        predictions: predRes.data?.summary,
        urgentPredictions: (predRes.data?.predictions || []).filter(p => p.days_until_failure <= 7),
        vendors: vendorRes.data?.summary,
        slaPenalties: slaRes.data?.stats,
        aiResolution: aiRes.data?.summary,
        suppression: suppressRes.data,
        complianceFw: compFwRes.data?.summary,
        frameworks: compFwRes.data?.frameworks,
        capacity: capacityRes.data?.current,
        incidents: incidentRes.data?.insights,
      });
    } catch (error) {
      console.error("Failed to fetch dashboard data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDashboardData(); }, []);

  // Auto-refresh every 60s
  useEffect(() => {
    autoRefreshRef.current = setInterval(() => { fetchDashboardData(); }, 60000);
    return () => clearInterval(autoRefreshRef.current);
  }, []);

  // Keyboard shortcut for quick search
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
      <div className="space-y-6">
        <div><h1 className="text-3xl font-bold tracking-tight">Dashboard</h1><p className="text-muted-foreground">Loading...</p></div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Card key={i}><CardContent className="p-6"><div className="h-20 rounded bg-muted animate-pulse" /></CardContent></Card>)}
        </div>
      </div>
    );
  }

  const onlineDevices = devices.filter(d => d.status === "online");
  const warningDevices = devices.filter(d => d.status === "warning");
  const offlineDevices = devices.filter(d => d.status === "offline");
  const criticalDevices = devices.filter(d => (d.cpu_usage || 0) >= 90 || (d.memory_usage || 0) >= 90 || (d.disk_usage || 0) >= 90);
  const needsPatching = devices.filter(d => (d.pending_patches || 0) > 0);
  const lowCompliance = devices.filter(d => d.compliance_score != null && d.compliance_score < 70);

  // SLA breach countdown - tickets approaching SLA
  const slaTickets = tickets.filter(t => t.sla_due).map(t => {
    const due = new Date(t.sla_due);
    const now = new Date();
    const diff = due - now;
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    return { ...t, sla_remaining: diff, sla_hours: hours, sla_mins: mins, sla_breached: diff < 0 };
  }).sort((a, b) => a.sla_remaining - b.sla_remaining).slice(0, 5);

  const priorityColors = { critical: "bg-red-500/10 text-red-500", high: "bg-orange-500/10 text-orange-500", medium: "bg-amber-500/10 text-amber-500", low: "bg-blue-500/10 text-blue-500" };
  const statusDot = { open: "bg-blue-500", in_progress: "bg-amber-500", resolved: "bg-emerald-500", closed: "bg-gray-400" };

  // Quick search results
  const quickSearchResults = searchQuery ? [
    ...tickets.filter(t => t.title?.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 3).map(t => ({ type: "ticket", label: t.title, sub: t.ticket_number, path: "/tickets" })),
    ...devices.filter(d => d.name?.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 3).map(d => ({ type: "device", label: d.name, sub: d.client_name, path: `/devices/${d.id}` })),
  ] : [];

  return (
    <div className="space-y-6" data-testid="dashboard-page">
      {/* Quick Search Modal */}
      {searchOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-[20vh]" onClick={() => setSearchOpen(false)}>
          <div className="bg-card border rounded-xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()} data-testid="quick-search-modal">
            <div className="flex items-center gap-3 px-4 py-3 border-b">
              <Search className="w-5 h-5 text-muted-foreground" />
              <Input ref={searchRef} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search tickets, devices, clients..."
                className="border-0 shadow-none focus-visible:ring-0 text-base" />
              <kbd className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">ESC</kbd>
            </div>
            {searchQuery && (
              <div className="p-2 max-h-64 overflow-y-auto">
                {quickSearchResults.length > 0 ? quickSearchResults.map((r, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 cursor-pointer" onClick={() => { navigate(r.path); setSearchOpen(false); }}>
                    {r.type === "ticket" ? <Ticket className="w-4 h-4 text-blue-500" /> : <Monitor className="w-4 h-4 text-emerald-500" />}
                    <div><p className="text-sm font-medium">{r.label}</p><p className="text-[10px] text-muted-foreground">{r.sub}</p></div>
                  </div>
                )) : <p className="text-sm text-muted-foreground text-center py-4">No results</p>}
              </div>
            )}
            {!searchQuery && (
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
                  <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 cursor-pointer" onClick={() => { navigate(item.path); setSearchOpen(false); }}>
                    <item.icon className={`w-4 h-4 ${item.color}`} /><span className="text-sm">{item.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Header with Quick Actions */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">Welcome back, {user?.name || "Admin"}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setSearchOpen(true)} className="gap-2" data-testid="quick-search-btn">
            <Search className="w-4 h-4" /><span className="hidden md:inline">Search</span><kbd className="text-[9px] text-muted-foreground bg-muted px-1 rounded ml-1">Ctrl+K</kbd>
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate("/tickets")}><Plus className="w-4 h-4 mr-1" />Ticket</Button>
          <Button variant="outline" size="sm" onClick={() => navigate("/devices")}><Plus className="w-4 h-4 mr-1" />Device</Button>
          <Button variant="outline" size="sm" onClick={() => fetchDashboardData()} data-testid="refresh-dashboard"><RefreshCw className="w-4 h-4" /></Button>
        </div>
      </div>

      {/* Top Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
        <StatCard title="Total Clients" value={stats.total_clients} icon={Users} iconBg="bg-blue-500/10" iconColor="text-blue-500" trend="up" trendValue="+2 this month" onClick={() => navigate("/clients")} />
        <StatCard title="Managed Devices" value={`${onlineDevices.length}/${devices.length}`} icon={Monitor} iconBg="bg-emerald-500/10" iconColor="text-emerald-500" onClick={() => navigate("/devices")} />
        <StatCard title="Open Tickets" value={stats.open_tickets} icon={Ticket} iconBg="bg-amber-500/10" iconColor="text-amber-500" trend={stats.open_tickets > 10 ? "up" : "down"} trendValue={stats.open_tickets > 10 ? "High volume" : "Under control"} onClick={() => navigate("/tickets")} />
        <StatCard title="Revenue (MRR)" value={`$${stats.total_mrr?.toLocaleString() || 0}`} icon={DollarSign} iconBg="bg-green-500/10" iconColor="text-green-500" trend="up" trendValue="+12%" onClick={() => navigate("/invoices")} />
        <StatCard title="Active Alerts" value={alerts.length} icon={AlertTriangle} iconBg={alerts.length > 0 ? "bg-red-500/10" : "bg-emerald-500/10"} iconColor={alerts.length > 0 ? "text-red-500" : "text-emerald-500"} onClick={() => navigate("/devices")} />
      </div>

      {/* Operational Alerts Row */}
      {enhancedStats && (
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          <div className="p-3 rounded-lg border bg-muted/30 cursor-pointer hover:border-green-500/50 transition-colors" onClick={() => navigate("/invoices")}>
            <div className="flex items-center gap-2 mb-1"><CreditCard className="w-3.5 h-3.5 text-green-500" /><span className="text-[10px] text-muted-foreground uppercase tracking-wider">Collected</span></div>
            <p className="text-lg font-bold">${(enhancedStats.total_collected || 0).toLocaleString()}</p>
          </div>
          <div className={`p-3 rounded-lg border cursor-pointer hover:border-red-500/50 transition-colors ${(enhancedStats.outstanding || 0) > 0 ? "bg-red-500/5 border-red-500/20 pulse-critical" : "bg-muted/30"}`} onClick={() => navigate("/invoices")}>
            <div className="flex items-center gap-2 mb-1"><XCircle className="w-3.5 h-3.5 text-red-500" /><span className="text-[10px] text-muted-foreground uppercase tracking-wider">Outstanding</span></div>
            <p className="text-lg font-bold text-red-500">${(enhancedStats.outstanding || 0).toLocaleString()}</p>
          </div>
          <div className={`p-3 rounded-lg border cursor-pointer hover:border-orange-500/50 transition-colors ${(enhancedStats.sla_breaches || 0) > 0 ? "bg-orange-500/5 border-orange-500/20 pulse-warning" : "bg-muted/30"}`} onClick={() => navigate("/tickets")}>
            <div className="flex items-center gap-2 mb-1"><AlertCircle className="w-3.5 h-3.5 text-orange-500" /><span className="text-[10px] text-muted-foreground uppercase tracking-wider">SLA Breaches</span></div>
            <p className={`text-lg font-bold ${(enhancedStats.sla_breaches || 0) > 0 ? "text-orange-500" : "text-emerald-500"}`}>{enhancedStats.sla_breaches || 0}</p>
          </div>
          <div className={`p-3 rounded-lg border cursor-pointer hover:border-amber-500/50 transition-colors ${needsPatching.length > 0 ? "bg-amber-500/5 border-amber-500/20" : "bg-muted/30"}`} onClick={() => navigate("/devices")}>
            <div className="flex items-center gap-2 mb-1"><Download className="w-3.5 h-3.5 text-amber-500" /><span className="text-[10px] text-muted-foreground uppercase tracking-wider">Need Patching</span></div>
            <p className={`text-lg font-bold ${needsPatching.length > 0 ? "text-amber-500" : "text-emerald-500"}`}>{needsPatching.length}</p>
          </div>
          <div className={`p-3 rounded-lg border cursor-pointer hover:border-red-500/50 transition-colors ${lowCompliance.length > 0 ? "bg-red-500/5 border-red-500/20" : "bg-muted/30"}`} onClick={() => navigate("/devices")}>
            <div className="flex items-center gap-2 mb-1"><ShieldAlert className="w-3.5 h-3.5 text-red-500" /><span className="text-[10px] text-muted-foreground uppercase tracking-wider">Low Compliance</span></div>
            <p className={`text-lg font-bold ${lowCompliance.length > 0 ? "text-red-500" : "text-emerald-500"}`}>{lowCompliance.length}</p>
          </div>
          <div className="p-3 rounded-lg border bg-muted/30 cursor-pointer hover:border-purple-500/50 transition-colors" onClick={() => navigate("/purchase-orders")}>
            <div className="flex items-center gap-2 mb-1"><ShoppingCart className="w-3.5 h-3.5 text-purple-500" /><span className="text-[10px] text-muted-foreground uppercase tracking-wider">Pending POs</span></div>
            <p className="text-lg font-bold">{enhancedStats.pending_purchase_orders || 0}</p>
          </div>
        </div>
      )}

      {/* SLA Countdown + Device Fleet */}
      <div className="grid grid-cols-12 gap-4">

        {/* MSP Intelligence Hub - Command Center Strip */}
        {mspIntel && (
          <div className="col-span-12 space-y-4" data-testid="msp-intelligence-hub">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center"><Brain className="w-4 h-4 text-white" /></div>
              <h2 className="text-lg font-bold tracking-tight">MSP Command Center</h2>
              <Badge variant="outline" className="text-[10px] ml-1">Cross-Module Intelligence</Badge>
            </div>

            {/* 8-Tile Intelligence Strip */}
            <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
              {[
                { label: "Backup Health", value: mspIntel.backup ? `${mspIntel.backup.success_rate}%` : "N/A", icon: HardDrive, color: (mspIntel.backup?.success_rate || 0) >= 90 ? "text-emerald-400" : (mspIntel.backup?.success_rate || 0) >= 70 ? "text-amber-400" : "text-red-400", bg: (mspIntel.backup?.success_rate || 0) >= 90 ? "border-emerald-500/20" : "border-red-500/20", path: "/backup-dashboard" },
                { label: "Failure Alerts", value: mspIntel.predictions?.critical || 0, icon: AlertTriangle, color: (mspIntel.predictions?.critical || 0) > 0 ? "text-red-400" : "text-emerald-400", bg: (mspIntel.predictions?.critical || 0) > 0 ? "border-red-500/20 bg-red-500/5" : "border-border/30", path: "/predictive-failure" },
                { label: "AI Resolved", value: mspIntel.aiResolution ? `${mspIntel.aiResolution.auto_resolved}/${mspIntel.aiResolution.total}` : "0", icon: Zap, color: "text-purple-400", bg: "border-purple-500/20", path: "/ai-resolution" },
                { label: "Noise Silenced", value: mspIntel.suppression ? mspIntel.suppression.total_suppressed?.toLocaleString() : "0", icon: BellOff, color: "text-amber-400", bg: "border-amber-500/20", path: "/alert-suppression" },
                { label: "SLA Penalties", value: mspIntel.slaPenalties ? `$${mspIntel.slaPenalties.pending_credits?.toLocaleString()}` : "$0", icon: Calculator, color: (mspIntel.slaPenalties?.pending_credits || 0) > 0 ? "text-red-400" : "text-emerald-400", bg: (mspIntel.slaPenalties?.pending_credits || 0) > 0 ? "border-red-500/20" : "border-border/30", path: "/sla-penalties" },
                { label: "Compliance", value: mspIntel.complianceFw ? `${Math.round(mspIntel.complianceFw.avg_compliance_pct)}%` : "N/A", icon: Shield, color: (mspIntel.complianceFw?.avg_compliance_pct || 0) >= 80 ? "text-emerald-400" : "text-amber-400", bg: "border-border/30", path: "/compliance-frameworks" },
                { label: "Team Util", value: mspIntel.capacity ? `${mspIntel.capacity.utilization_pct}%` : "N/A", icon: Users, color: (mspIntel.capacity?.utilization_pct || 0) >= 90 ? "text-red-400" : (mspIntel.capacity?.utilization_pct || 0) >= 75 ? "text-amber-400" : "text-emerald-400", bg: "border-border/30", path: "/capacity-planner" },
                { label: "Incidents", value: mspIntel.incidents?.total_incidents || 0, icon: Flame, color: (mspIntel.incidents?.total_incidents || 0) > 20 ? "text-red-400" : "text-blue-400", bg: "border-border/30", path: "/incident-heatmap" },
              ].map(tile => (
                <div key={tile.label} className={`p-2.5 rounded-lg border ${tile.bg} bg-card cursor-pointer hover:bg-muted/50 transition-all hover:scale-[1.02]`} onClick={() => navigate(tile.path)} data-testid={`intel-${tile.label.toLowerCase().replace(/\s/g, "-")}`}>
                  <div className="flex items-center justify-between mb-0.5"><tile.icon className={`w-3.5 h-3.5 ${tile.color}`} /><ChevronRight className="w-3 h-3 text-muted-foreground/50" /></div>
                  <p className={`text-lg font-black leading-tight ${tile.color}`}>{tile.value}</p>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wider mt-0.5">{tile.label}</p>
                </div>
              ))}
            </div>

            {/* Expanded Intelligence Cards */}
            <div className="grid grid-cols-3 gap-3">
              {/* Urgent Predictions */}
              <Card className="border-border/40">
                <CardHeader className="pb-2 flex flex-row items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-red-400" />Urgent Failures</CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => navigate("/predictive-failure")} className="text-xs h-6 px-2">View <ExternalLink className="w-3 h-3 ml-1" /></Button>
                </CardHeader>
                <CardContent>
                  {(mspIntel.urgentPredictions || []).length === 0 ? (
                    <div className="text-center py-4"><ShieldCheck className="w-6 h-6 mx-auto text-emerald-400/30 mb-1" /><p className="text-xs text-emerald-400">No urgent failures</p></div>
                  ) : (
                    <div className="space-y-1.5">
                      {mspIntel.urgentPredictions.slice(0, 4).map(p => (
                        <div key={p.id} className="flex items-center gap-2 p-1.5 rounded bg-red-500/5 border border-red-500/10">
                          <HardDrive className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate">{p.device_name}</p>
                            <p className="text-[10px] text-muted-foreground truncate">{p.prediction}</p>
                          </div>
                          <span className="text-xs font-black text-red-400">{p.days_until_failure}d</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Backup Status */}
              <Card className="border-border/40">
                <CardHeader className="pb-2 flex flex-row items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2"><HardDrive className="w-4 h-4 text-blue-400" />Backup Status</CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => navigate("/backup-dashboard")} className="text-xs h-6 px-2">View <ExternalLink className="w-3 h-3 ml-1" /></Button>
                </CardHeader>
                <CardContent>
                  {mspIntel.backup ? (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-2xl font-black ${mspIntel.backup.success_rate >= 90 ? "text-emerald-400" : mspIntel.backup.success_rate >= 70 ? "text-amber-400" : "text-red-400"}`}>{mspIntel.backup.success_rate}%</span>
                        <span className="text-xs text-muted-foreground">{mspIntel.backup.total_jobs} jobs</span>
                      </div>
                      <Progress value={mspIntel.backup.success_rate} className="h-2 mb-2" />
                      <div className="grid grid-cols-3 gap-1.5 text-center">
                        <div className="p-1.5 rounded bg-emerald-500/10 border border-emerald-500/20"><p className="text-sm font-bold text-emerald-400">{mspIntel.backup.successful}</p><p className="text-[9px] text-muted-foreground">OK</p></div>
                        <div className="p-1.5 rounded bg-red-500/10 border border-red-500/20"><p className="text-sm font-bold text-red-400">{mspIntel.backup.failed}</p><p className="text-[9px] text-muted-foreground">Failed</p></div>
                        <div className="p-1.5 rounded bg-blue-500/10 border border-blue-500/20"><p className="text-sm font-bold text-blue-400">{mspIntel.backup.running}</p><p className="text-[9px] text-muted-foreground">Running</p></div>
                      </div>
                    </div>
                  ) : <p className="text-xs text-muted-foreground text-center py-4">No backup data</p>}
                </CardContent>
              </Card>

              {/* Compliance Posture */}
              <Card className="border-border/40">
                <CardHeader className="pb-2 flex flex-row items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2"><Shield className="w-4 h-4 text-emerald-400" />Compliance Posture</CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => navigate("/compliance-frameworks")} className="text-xs h-6 px-2">View <ExternalLink className="w-3 h-3 ml-1" /></Button>
                </CardHeader>
                <CardContent>
                  {mspIntel.frameworks ? (
                    <div className="space-y-2">
                      {mspIntel.frameworks.slice(0, 4).map(fw => (
                        <div key={fw.id || fw.name}>
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-xs font-medium">{fw.name}</span>
                            <span className={`text-xs font-bold ${fw.compliance_pct >= 80 ? "text-emerald-400" : fw.compliance_pct >= 60 ? "text-amber-400" : "text-red-400"}`}>{Math.round(fw.compliance_pct)}%</span>
                          </div>
                          <Progress value={fw.compliance_pct} className="h-1.5" />
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-xs text-muted-foreground text-center py-4">No compliance data</p>}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
        {/* SLA Countdown Widget */}
        <Card className="col-span-4" data-testid="sla-countdown-widget">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold flex items-center gap-2"><Clock className="w-4 h-4 text-orange-500" />SLA Countdown</CardTitle>
            <Badge variant="outline" className="text-[10px]">{slaTickets.length} approaching</Badge>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[220px]">
              {slaTickets.length > 0 ? (
                <div className="space-y-3">
                  {slaTickets.map(t => {
                    const pct = t.sla_breached ? 100 : Math.max(0, Math.min(100, 100 - (t.sla_remaining / (4 * 3600000)) * 100));
                    const color = t.sla_breached ? "text-red-500" : t.sla_hours < 1 ? "text-orange-500" : t.sla_hours < 4 ? "text-amber-500" : "text-emerald-500";
                    return (
                      <div key={t.id} className="space-y-1 cursor-pointer hover:bg-muted/50 p-2 rounded-lg" onClick={() => navigate("/tickets")} data-testid={`sla-ticket-${t.id}`}>
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium truncate max-w-[200px]">{t.title}</p>
                          <span className={`text-xs font-mono font-bold ${color}`}>
                            {t.sla_breached ? "BREACHED" : `${t.sla_hours}h ${t.sla_mins}m`}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground">{t.ticket_number}</span>
                          <Badge className={`${priorityColors[t.priority]} text-[9px]`}>{t.priority}</Badge>
                        </div>
                        <Progress value={pct} className="h-1" />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground"><CheckCircle className="w-8 h-8 mx-auto mb-2 opacity-30" /><p className="text-sm">All SLAs on track</p></div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Device Fleet */}
        <Card className="col-span-8">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold flex items-center gap-2"><Monitor className="w-4 h-4" />Device Fleet Overview</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate("/devices")} className="text-xs">View All <ExternalLink className="w-3 h-3 ml-1" /></Button>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Device</TableHead><TableHead>Client</TableHead><TableHead className="text-center">CPU</TableHead>
                  <TableHead className="text-center">RAM</TableHead><TableHead className="text-center">Disk</TableHead>
                  <TableHead>Security</TableHead><TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...criticalDevices, ...warningDevices, ...offlineDevices, ...onlineDevices.filter(d => !criticalDevices.includes(d))].slice(0, 8).map(d => {
                  const DevIcon = d.device_type === "server" ? Server : d.device_type === "laptop" ? Laptop : d.device_type === "network" ? Wifi : Monitor;
                  const usageColor = v => v >= 90 ? "text-red-500 font-bold" : v >= 70 ? "text-amber-500" : "text-emerald-500";
                  return (
                    <TableRow key={d.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/devices/${d.id}`)} data-testid={`dash-device-${d.id}`}>
                      <TableCell><div className="flex items-center gap-2"><DevIcon className="w-4 h-4 text-muted-foreground" /><div><p className="font-medium text-sm">{d.name}</p><p className="text-[10px] text-muted-foreground">{d.os}</p></div></div></TableCell>
                      <TableCell className="text-xs">{d.client_name}</TableCell>
                      <TableCell className={`text-center text-xs font-mono ${usageColor(d.cpu_usage || 0)}`}>{Math.round(d.cpu_usage || 0)}%</TableCell>
                      <TableCell className={`text-center text-xs font-mono ${usageColor(d.memory_usage || 0)}`}>{Math.round(d.memory_usage || 0)}%</TableCell>
                      <TableCell className={`text-center text-xs font-mono ${usageColor(d.disk_usage || 0)}`}>{Math.round(d.disk_usage || 0)}%</TableCell>
                      <TableCell>
                        {d.compliance_score != null ? (
                          <Badge className={`text-[9px] ${d.compliance_score >= 90 ? "bg-emerald-500/10 text-emerald-500" : d.compliance_score >= 70 ? "bg-amber-500/10 text-amber-500" : "bg-red-500/10 text-red-500"}`}>
                            <Shield className="w-2.5 h-2.5 mr-0.5" />{d.compliance_score}%
                          </Badge>
                        ) : "-"}
                      </TableCell>
                      <TableCell><Badge className={`text-[9px] capitalize ${d.status === "online" ? "bg-emerald-500/10 text-emerald-500" : d.status === "warning" ? "bg-amber-500/10 text-amber-500" : "bg-red-500/10 text-red-500"}`}>{d.status}</Badge></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-12 gap-4">
        {/* System Health + Fleet Breakdown */}
        <div className="col-span-4 space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base font-semibold">System Health</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[150px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={[
                      { name: "Online", value: onlineDevices.length, color: "#22C55E" },
                      { name: "Warning", value: warningDevices.length, color: "#EAB308" },
                      { name: "Offline", value: offlineDevices.length, color: "#EF4444" }
                    ]} cx="50%" cy="50%" innerRadius={40} outerRadius={60} paddingAngle={4} dataKey="value">
                      {[{ color: "#22C55E" }, { color: "#EAB308" }, { color: "#EF4444" }].map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex justify-center gap-4">
                <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-emerald-500" /><span className="text-xs">{onlineDevices.length} Online</span></div>
                <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-amber-500" /><span className="text-xs">{warningDevices.length} Warning</span></div>
                <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-red-500" /><span className="text-xs">{offlineDevices.length} Offline</span></div>
              </div>
              <Separator className="my-3" />
              <div className="space-y-2">
                {[
                  { label: "Servers", icon: Server, count: devices.filter(d => d.device_type === "server").length, color: "text-blue-500" },
                  { label: "Workstations", icon: Monitor, count: devices.filter(d => d.device_type === "workstation").length, color: "text-purple-500" },
                  { label: "Laptops", icon: Laptop, count: devices.filter(d => d.device_type === "laptop").length, color: "text-cyan-500" },
                  { label: "Network", icon: Wifi, count: devices.filter(d => d.device_type === "network").length, color: "text-orange-500" },
                ].map((item, i) => (
                  <div key={i} className="flex items-center justify-between py-0.5">
                    <div className="flex items-center gap-2"><item.icon className={`w-3.5 h-3.5 ${item.color}`} /><span className="text-xs">{item.label}</span></div>
                    <span className="font-mono text-xs font-bold">{item.count}</span>
                  </div>
                ))}
                <Separator />
                <div className="flex items-center justify-between py-0.5"><div className="flex items-center gap-2"><Cpu className="w-3.5 h-3.5 text-muted-foreground" /><span className="text-xs text-muted-foreground">Avg CPU</span></div><span className="font-mono text-xs">{deviceStats.avg_cpu || 0}%</span></div>
                <div className="flex items-center justify-between py-0.5"><div className="flex items-center gap-2"><MemoryStick className="w-3.5 h-3.5 text-muted-foreground" /><span className="text-xs text-muted-foreground">Avg RAM</span></div><span className="font-mono text-xs">{deviceStats.avg_ram || 0}%</span></div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Ticket Trends Chart */}
        <Card className="col-span-8">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold">Ticket Volume (7 Days)</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">Auto-refresh: 60s</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={ticketTrends.length > 0 ? ticketTrends : [
                  { date: "Mon", tickets: 12 }, { date: "Tue", tickets: 19 }, { date: "Wed", tickets: 15 },
                  { date: "Thu", tickets: 22 }, { date: "Fri", tickets: 18 }, { date: "Sat", tickets: 8 }, { date: "Sun", tickets: 5 }
                ]}>
                  <defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} /><stop offset="95%" stopColor="#3b82f6" stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  <Area type="monotone" dataKey="tickets" stroke="#3b82f6" strokeWidth={2} fill="url(#tg)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bottom Row - Tickets + Alerts + Activity */}
      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-4">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold flex items-center gap-2"><Ticket className="w-4 h-4" />Open Tickets</CardTitle>
            <Badge variant="secondary" className="text-[10px]">{stats.open_tickets}</Badge>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[240px]">
              <div className="space-y-0">
                {tickets.length > 0 ? tickets.map(t => (
                  <div key={t.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 cursor-pointer border-b border-border/50" onClick={() => navigate("/tickets")} data-testid={`dash-ticket-${t.id}`}>
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot[t.status] || "bg-gray-400"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{t.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-muted-foreground">{t.client_name}</span>
                        {t.device_name && <span className="text-[10px] text-muted-foreground font-mono">| {t.device_name}</span>}
                      </div>
                    </div>
                    <Badge className={`${priorityColors[t.priority]} text-[9px]`}>{t.priority}</Badge>
                  </div>
                )) : (
                  <div className="text-center py-12 text-muted-foreground"><CheckCircle className="w-8 h-8 mx-auto mb-2 opacity-30" /><p className="text-sm">All clear!</p></div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="col-span-3">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-500" />Active Alerts</CardTitle>
            <Badge variant={alerts.length > 0 ? "destructive" : "secondary"} className="text-[10px]">{alerts.length}</Badge>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[220px]">
              <div className="space-y-2">
                {alerts.length > 0 ? alerts.slice(0, 8).map(a => (
                  <div key={a.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted/50 border border-transparent hover:border-border">
                    <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${a.severity === "critical" ? "bg-red-500" : "bg-amber-500"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{a.message}</p>
                      <span className="text-[10px] text-muted-foreground">{a.device_name}</span>
                    </div>
                  </div>
                )) : (
                  <div className="text-center py-12 text-muted-foreground"><CheckCircle className="w-8 h-8 mx-auto mb-2 opacity-30" /><p className="text-sm">No alerts</p></div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="col-span-5">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold flex items-center gap-2"><Activity className="w-4 h-4 text-cyan-500" />Activity Feed</CardTitle>
            <Badge variant="outline" className="text-[10px] text-muted-foreground">Live</Badge>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[220px]">
              <div className="space-y-1">
                {activityFeed.length > 0 ? activityFeed.map(item => {
                  const iconMap = { ticket_note: MessageSquare, ticket_created: Ticket, alert: AlertTriangle };
                  const colorMap = { ticket_note: "text-indigo-400 bg-indigo-500/10", ticket_created: "text-cyan-400 bg-cyan-500/10", alert: "text-amber-400 bg-amber-500/10" };
                  const IconComp = iconMap[item.type] || Activity;
                  const color = colorMap[item.type] || "text-gray-400 bg-muted";
                  return (
                    <div key={item.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted/50">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${color}`}><IconComp className="w-3.5 h-3.5" /></div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.title}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{item.description}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-[10px] text-muted-foreground">{item.user}</p>
                        {item.timestamp && <p className="text-[10px] text-muted-foreground/70">{(() => { try { const d = new Date(item.timestamp); return isNaN(d.getTime()) ? "" : formatDistanceToNow(d, { addSuffix: true }); } catch { return ""; } })()}</p>}
                      </div>
                    </div>
                  );
                }) : (
                  <div className="text-center py-12 text-muted-foreground"><Activity className="w-8 h-8 mx-auto mb-2 opacity-30" /><p className="text-sm">No recent activity</p></div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
