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
  ChevronRight, TrendingUp, Zap, Server, Laptop, Wifi, Eye
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell
} from "recharts";
import { formatDistanceToNow } from "date-fns";

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
        <div><h1 className="text-3xl font-bold tracking-tight">Dashboard</h1><p className="text-muted-foreground">Loading...</p></div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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

  // Quick search
  const quickSearchResults = searchQuery ? [
    ...tickets.filter(t => t.title?.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 3).map(t => ({ type: "ticket", label: t.title, sub: t.ticket_number, path: "/tickets" })),
    ...devices.filter(d => d.name?.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 3).map(d => ({ type: "device", label: d.name, sub: d.client_name, path: `/devices/${d.id}` })),
  ] : [];

  // Attention items - only show when something needs action
  const attentionItems = [];
  if ((enhancedStats?.sla_breaches || 0) > 0) attentionItems.push({ label: `${enhancedStats.sla_breaches} SLA Breach${enhancedStats.sla_breaches > 1 ? "es" : ""}`, color: "text-red-500 bg-red-500/10 border-red-500/20", icon: AlertCircle, path: "/tickets" });
  if (offlineDevices.length > 0) attentionItems.push({ label: `${offlineDevices.length} Offline Device${offlineDevices.length > 1 ? "s" : ""}`, color: "text-red-500 bg-red-500/10 border-red-500/20", icon: Monitor, path: "/devices" });
  if ((enhancedStats?.outstanding || 0) > 1000) attentionItems.push({ label: `$${(enhancedStats.outstanding || 0).toLocaleString()} Outstanding`, color: "text-orange-500 bg-orange-500/10 border-orange-500/20", icon: DollarSign, path: "/invoices" });
  if (needsPatching.length > 10) attentionItems.push({ label: `${needsPatching.length} Need Patching`, color: "text-amber-500 bg-amber-500/10 border-amber-500/20", icon: Shield, path: "/patch-hub" });
  if (criticalTickets.length > 0) attentionItems.push({ label: `${criticalTickets.length} Critical Ticket${criticalTickets.length > 1 ? "s" : ""}`, color: "text-red-500 bg-red-500/10 border-red-500/20", icon: Ticket, path: "/tickets" });
  if ((mspIntel?.urgentPredictions || []).length > 0) attentionItems.push({ label: `${mspIntel.urgentPredictions.length} Failure Prediction${mspIntel.urgentPredictions.length > 1 ? "s" : ""}`, color: "text-orange-500 bg-orange-500/10 border-orange-500/20", icon: AlertTriangle, path: "/predictive-failure" });

  const chartData = ticketTrends.length > 0 ? ticketTrends : [
    { date: "Mon", tickets: 12 }, { date: "Tue", tickets: 19 }, { date: "Wed", tickets: 15 },
    { date: "Thu", tickets: 22 }, { date: "Fri", tickets: 18 }, { date: "Sat", tickets: 8 }, { date: "Sun", tickets: 5 }
  ];

  return (
    <div className="space-y-5" data-testid="dashboard-page">
      {/* Quick Search Modal */}
      {searchOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-[20vh]" onClick={() => setSearchOpen(false)}>
          <div className="bg-card border rounded-xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()} data-testid="quick-search-modal">
            <div className="flex items-center gap-3 px-4 py-3 border-b">
              <Search className="w-5 h-5 text-muted-foreground" />
              <Input ref={searchRef} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search tickets, devices, clients..." className="border-0 shadow-none focus-visible:ring-0 text-base" />
              <kbd className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">ESC</kbd>
            </div>
            {searchQuery ? (
              <div className="p-2 max-h-64 overflow-y-auto">
                {quickSearchResults.length > 0 ? quickSearchResults.map((r, i) => (
                  <div key={`k-${i}`} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 cursor-pointer" onClick={() => { navigate(r.path); setSearchOpen(false); }}>
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
                  <div key={`k-${i}`} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 cursor-pointer" onClick={() => { navigate(item.path); setSearchOpen(false); }}>
                    <item.icon className={`w-4 h-4 ${item.color}`} /><span className="text-sm">{item.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ HEADER ═══ */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Welcome back, {user?.name || "Admin"}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setSearchOpen(true)} className="gap-2" data-testid="quick-search-btn">
            <Search className="w-4 h-4" /><span className="hidden md:inline">Search</span><kbd className="text-[9px] text-muted-foreground bg-muted px-1 rounded ml-1">Ctrl+K</kbd>
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate("/tickets")} data-testid="new-ticket-btn"><Plus className="w-4 h-4 mr-1" />Ticket</Button>
          <Button variant="outline" size="sm" onClick={() => navigate("/devices")} data-testid="new-device-btn"><Plus className="w-4 h-4 mr-1" />Device</Button>
          <Button variant="ghost" size="sm" onClick={fetchDashboardData} data-testid="refresh-dashboard"><RefreshCw className="w-4 h-4" /></Button>
        </div>
      </div>

      {/* ═══ ATTENTION BANNER — Only shows when something needs action ═══ */}
      {attentionItems.length > 0 && (
        <div className="flex gap-2 flex-wrap" data-testid="attention-banner">
          {attentionItems.map((item, i) => (
            <button key={`k-${i}`} onClick={() => navigate(item.path)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-semibold transition-all hover:scale-[1.02] hover:shadow-md ${item.color}`}
              data-testid={`attention-item-${i}`}>
              <item.icon className="w-3.5 h-3.5" />{item.label}<ChevronRight className="w-3 h-3 opacity-50" />
            </button>
          ))}
        </div>
      )}

      {/* ═══ KEY METRICS — 4 clean cards ═══ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="cursor-pointer hover:border-primary/30 transition-colors group" onClick={() => navigate("/clients")} data-testid="metric-clients">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Clients</p>
                <p className="text-3xl font-bold mt-1">{stats.total_clients}</p>
                <p className="text-xs text-muted-foreground mt-0.5">${stats.total_mrr?.toLocaleString() || 0} MRR</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center group-hover:scale-110 transition-transform">
                <Users className="w-6 h-6 text-blue-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:border-primary/30 transition-colors group" onClick={() => navigate("/devices")} data-testid="metric-devices">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Devices</p>
                <p className="text-3xl font-bold mt-1">{devices.length}</p>
                <div className="flex gap-2 mt-0.5">
                  <span className="text-xs text-emerald-500">{onlineDevices.length} online</span>
                  {offlineDevices.length > 0 && <span className="text-xs text-red-500">{offlineDevices.length} offline</span>}
                </div>
              </div>
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center group-hover:scale-110 transition-transform">
                <Monitor className="w-6 h-6 text-emerald-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:border-primary/30 transition-colors group" onClick={() => navigate("/tickets")} data-testid="metric-tickets">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Open Tickets</p>
                <p className="text-3xl font-bold mt-1">{stats.open_tickets}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{stats.in_progress_tickets} in progress</p>
              </div>
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform ${stats.open_tickets > 20 ? "bg-amber-500/10" : "bg-cyan-500/10"}`}>
                <Ticket className={`w-6 h-6 ${stats.open_tickets > 20 ? "text-amber-500" : "text-cyan-500"}`} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:border-primary/30 transition-colors group" onClick={() => navigate("/invoices")} data-testid="metric-revenue">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Revenue</p>
                <p className="text-3xl font-bold mt-1">${stats.total_mrr?.toLocaleString() || 0}</p>
                <div className="flex items-center gap-1 mt-0.5">
                  <ArrowUpRight className="w-3 h-3 text-emerald-500" /><span className="text-xs text-emerald-500">+12% MRR</span>
                </div>
              </div>
              <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center group-hover:scale-110 transition-transform">
                <DollarSign className="w-6 h-6 text-green-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ═══ MAIN CONTENT — 2-column layout ═══ */}
      <div className="grid grid-cols-12 gap-4">

        {/* LEFT: Ticket Trend Chart */}
        <Card className="col-span-8" data-testid="ticket-trend-chart">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2"><Activity className="w-4 h-4 text-blue-500" />Ticket Volume (7 Days)</CardTitle>
            <Badge variant="outline" className="text-[9px] text-muted-foreground">Auto-refresh 60s</Badge>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} /><stop offset="95%" stopColor="#3b82f6" stopOpacity={0} /></linearGradient></defs>
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} width={30} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                  <Area type="monotone" dataKey="tickets" stroke="#3b82f6" strokeWidth={2} fill="url(#tg)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* RIGHT: Device Health Donut */}
        <Card className="col-span-4" data-testid="device-health-card">
          <CardHeader className="pb-0">
            <CardTitle className="text-sm font-semibold flex items-center gap-2"><Monitor className="w-4 h-4 text-emerald-500" />Fleet Health</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="h-[120px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={[
                    { name: "Online", value: onlineDevices.length, color: "#22C55E" },
                    { name: "Warning", value: warningDevices.length, color: "#EAB308" },
                    { name: "Offline", value: offlineDevices.length, color: "#EF4444" }
                  ]} cx="50%" cy="50%" innerRadius={35} outerRadius={50} paddingAngle={4} dataKey="value">
                    {[{ color: "#22C55E" }, { color: "#EAB308" }, { color: "#EF4444" }].map((e, i) => <Cell key={`k-${i}`} fill={e.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-center gap-4 text-xs">
              <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-emerald-500" />{onlineDevices.length} Online</div>
              <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-amber-500" />{warningDevices.length} Warning</div>
              <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-red-500" />{offlineDevices.length} Offline</div>
            </div>
            <Separator className="my-3" />
            <div className="space-y-1.5">
              {[
                { icon: Server, label: "Servers", count: devices.filter(d => d.device_type === "server").length, color: "text-blue-400" },
                { icon: Monitor, label: "Workstations", count: devices.filter(d => d.device_type === "workstation").length, color: "text-purple-400" },
                { icon: Laptop, label: "Laptops", count: devices.filter(d => d.device_type === "laptop").length, color: "text-cyan-400" },
                { icon: Wifi, label: "Network", count: devices.filter(d => d.device_type === "network").length, color: "text-orange-400" },
              ].map((item, i) => (
                <div key={`k-${i}`} className="flex items-center justify-between">
                  <div className="flex items-center gap-2"><item.icon className={`w-3 h-3 ${item.color}`} /><span className="text-xs">{item.label}</span></div>
                  <span className="font-mono text-xs font-medium">{item.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ═══ OPERATIONAL INSIGHTS — Collapsible command strip ═══ */}
      {mspIntel && (
        <details className="group" data-testid="ops-insights">
          <summary className="cursor-pointer flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors py-1">
            <Eye className="w-4 h-4" />
            Operational Insights
            <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
            {(mspIntel.urgentPredictions || []).length > 0 && <Badge variant="destructive" className="text-[9px] h-4 px-1.5">{mspIntel.urgentPredictions.length} urgent</Badge>}
          </summary>
          <div className="grid grid-cols-3 gap-3 mt-3">
            {/* Failure Predictions */}
            <Card className="border-border/40">
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
                      <div key={p.id} className="flex items-center gap-2 p-1.5 rounded bg-red-500/5 border border-red-500/10">
                        <HardDrive className="w-3 h-3 text-red-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0"><p className="text-[11px] font-medium truncate">{p.device_name}</p><p className="text-[9px] text-muted-foreground truncate">{p.prediction}</p></div>
                        <span className="text-[11px] font-black text-red-400">{p.days_until_failure}d</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Backup Status */}
            <Card className="border-border/40">
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
                    <div className="grid grid-cols-3 gap-1 text-center">
                      <div className="p-1 rounded bg-emerald-500/10"><p className="text-xs font-bold text-emerald-400">{mspIntel.backup.successful}</p><p className="text-[8px] text-muted-foreground">OK</p></div>
                      <div className="p-1 rounded bg-red-500/10"><p className="text-xs font-bold text-red-400">{mspIntel.backup.failed}</p><p className="text-[8px] text-muted-foreground">Fail</p></div>
                      <div className="p-1 rounded bg-blue-500/10"><p className="text-xs font-bold text-blue-400">{mspIntel.backup.running}</p><p className="text-[8px] text-muted-foreground">Run</p></div>
                    </div>
                  </div>
                ) : <p className="text-[10px] text-muted-foreground text-center py-4">No backup data</p>}
              </CardContent>
            </Card>

            {/* Compliance */}
            <Card className="border-border/40">
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

      {/* ═══ BOTTOM ROW — Tickets + Alerts + Activity ═══ */}
      <div className="grid grid-cols-12 gap-4">
        {/* Open Tickets */}
        <Card className="col-span-5" data-testid="open-tickets-card">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2"><Ticket className="w-4 h-4" />Open Tickets</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate("/tickets")} className="text-[10px] h-5 px-2">{stats.open_tickets} total<ExternalLink className="w-2.5 h-2.5 ml-1" /></Button>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[220px]">
              {tickets.length > 0 ? tickets.map(t => (
                <div key={t.id} className="flex items-center gap-3 px-4 py-2 hover:bg-muted/50 cursor-pointer border-b border-border/30 last:border-0" onClick={() => navigate("/tickets")} data-testid={`dash-ticket-${t.id}`}>
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDot[t.status] || "bg-gray-400"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{t.title}</p>
                    <span className="text-[10px] text-muted-foreground">{t.client_name}</span>
                  </div>
                  <Badge className={`${priorityColors[t.priority]} text-[9px] shrink-0`}>{t.priority}</Badge>
                </div>
              )) : (
                <div className="text-center py-12 text-muted-foreground"><CheckCircle className="w-8 h-8 mx-auto mb-2 opacity-30" /><p className="text-sm">All clear!</p></div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Active Alerts */}
        <Card className="col-span-3" data-testid="alerts-card">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2"><AlertTriangle className={`w-4 h-4 ${alerts.length > 0 ? "text-amber-500" : "text-muted-foreground"}`} />Alerts</CardTitle>
            <Badge variant={alerts.length > 0 ? "destructive" : "secondary"} className="text-[9px] h-4">{alerts.length}</Badge>
          </CardHeader>
          <CardContent className="p-0 px-3">
            <ScrollArea className="h-[220px]">
              {alerts.length > 0 ? alerts.slice(0, 6).map(a => (
                <div key={a.id} className="flex items-start gap-2.5 py-2 border-b border-border/30 last:border-0">
                  <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${a.severity === "critical" ? "bg-red-500" : "bg-amber-500"}`} />
                  <div className="min-w-0"><p className="text-xs font-medium leading-tight truncate">{a.message}</p><span className="text-[10px] text-muted-foreground">{a.device_name}</span></div>
                </div>
              )) : (
                <div className="text-center py-12 text-muted-foreground"><CheckCircle className="w-8 h-8 mx-auto mb-2 opacity-30" /><p className="text-sm">No alerts</p></div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Activity Feed */}
        <Card className="col-span-4" data-testid="activity-feed-card">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2"><Zap className="w-4 h-4 text-cyan-500" />Activity</CardTitle>
            <Badge variant="outline" className="text-[9px] text-muted-foreground h-4">Live</Badge>
          </CardHeader>
          <CardContent className="p-0 px-3">
            <ScrollArea className="h-[220px]">
              {activityFeed.length > 0 ? activityFeed.map(item => {
                const iconMap = { ticket_note: MessageSquare, ticket_created: Ticket, alert: AlertTriangle };
                const colorMap = { ticket_note: "text-indigo-400", ticket_created: "text-cyan-400", alert: "text-amber-400" };
                const IconComp = iconMap[item.type] || Activity;
                return (
                  <div key={item.id} className="flex items-start gap-2.5 py-2 border-b border-border/30 last:border-0">
                    <IconComp className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${colorMap[item.type] || "text-gray-400"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{item.title}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{item.description}</p>
                    </div>
                    <span className="text-[9px] text-muted-foreground/60 shrink-0">{item.user}</span>
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
  );
}
