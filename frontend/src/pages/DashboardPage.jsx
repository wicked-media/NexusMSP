import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import {
  Users, Monitor, Ticket, AlertTriangle, DollarSign, TrendingUp, Clock, ArrowUpRight, ArrowDownRight,
  RefreshCw, MessageSquare, Activity, Package, ShoppingCart, AlertCircle, CheckCircle, XCircle,
  FileText, CreditCard, Zap, Server, Laptop, Wifi, Shield, ShieldAlert, HardDrive, Cpu, MemoryStick,
  Download, ExternalLink, Plus
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
  const { token } = useAuth();
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
  const [loading, setLoading] = useState(true);

  const headers = { Authorization: `Bearer ${token}` };

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const [statsRes, trendsRes, healthRes, alertsRes, ticketsRes, activityRes, enhancedRes, devicesRes, devStatsRes] = await Promise.all([
        axios.get(`${API}/dashboard/stats`, { headers }),
        axios.get(`${API}/dashboard/ticket-trends`, { headers }),
        axios.get(`${API}/dashboard/device-health`, { headers }),
        axios.get(`${API}/alerts?status=active`, { headers }),
        axios.get(`${API}/tickets?status=open`, { headers }),
        axios.get(`${API}/dashboard/activity-feed?limit=20`, { headers }),
        axios.get(`${API}/dashboard/enhanced-stats`, { headers }),
        axios.get(`${API}/devices`, { headers }),
        axios.get(`${API}/devices/stats/summary`, { headers }).catch(() => ({ data: {} })),
      ]);
      setStats(statsRes.data);
      setEnhancedStats(enhancedRes.data);
      setTicketTrends(trendsRes.data);
      setDeviceHealth(healthRes.data);
      setAlerts(alertsRes.data);
      setTickets(ticketsRes.data.slice(0, 8));
      setActivityFeed(activityRes.data);
      setDevices(devicesRes.data);
      setDeviceStats(devStatsRes.data);
    } catch (error) {
      console.error("Failed to fetch dashboard data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDashboardData(); }, []);

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

  const priorityColors = { critical: "bg-red-500/10 text-red-500", high: "bg-orange-500/10 text-orange-500", medium: "bg-amber-500/10 text-amber-500", low: "bg-blue-500/10 text-blue-500" };
  const statusDot = { open: "bg-blue-500", in_progress: "bg-amber-500", resolved: "bg-emerald-500", closed: "bg-gray-400" };

  return (
    <div className="space-y-6" data-testid="dashboard-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">MSP Command Center</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate("/devices")}><Plus className="w-4 h-4 mr-1" />Add Device</Button>
          <Button variant="outline" size="sm" onClick={() => navigate("/tickets")}><Ticket className="w-4 h-4 mr-1" />New Ticket</Button>
          <Button variant="outline" size="sm" onClick={fetchDashboardData} data-testid="refresh-dashboard"><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
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
          <div className={`p-3 rounded-lg border cursor-pointer hover:border-red-500/50 transition-colors ${(enhancedStats.outstanding || 0) > 0 ? "bg-red-500/5 border-red-500/20" : "bg-muted/30"}`} onClick={() => navigate("/invoices")}>
            <div className="flex items-center gap-2 mb-1"><XCircle className="w-3.5 h-3.5 text-red-500" /><span className="text-[10px] text-muted-foreground uppercase tracking-wider">Outstanding</span></div>
            <p className="text-lg font-bold text-red-500">${(enhancedStats.outstanding || 0).toLocaleString()}</p>
          </div>
          <div className={`p-3 rounded-lg border cursor-pointer hover:border-orange-500/50 transition-colors ${(enhancedStats.sla_breaches || 0) > 0 ? "bg-orange-500/5 border-orange-500/20" : "bg-muted/30"}`} onClick={() => navigate("/tickets")}>
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

      {/* Device Fleet Overview + Charts */}
      <div className="grid grid-cols-12 gap-4">
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
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <DevIcon className="w-4 h-4 text-muted-foreground" />
                          <div><p className="font-medium text-sm">{d.name}</p><p className="text-[10px] text-muted-foreground">{d.os}</p></div>
                        </div>
                      </TableCell>
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
                      <TableCell>
                        <Badge className={`text-[9px] capitalize ${d.status === "online" ? "bg-emerald-500/10 text-emerald-500" : d.status === "warning" ? "bg-amber-500/10 text-amber-500" : "bg-red-500/10 text-red-500"}`}>{d.status}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* System Health Donut + Fleet Breakdown */}
        <div className="col-span-4 space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base font-semibold">System Health</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[160px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={[
                        { name: "Online", value: onlineDevices.length, color: "#22C55E" },
                        { name: "Warning", value: warningDevices.length, color: "#EAB308" },
                        { name: "Offline", value: offlineDevices.length, color: "#EF4444" }
                      ]}
                      cx="50%" cy="50%" innerRadius={45} outerRadius={65} paddingAngle={4} dataKey="value"
                    >
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base font-semibold">Fleet Breakdown</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {[
                { label: "Servers", icon: Server, count: devices.filter(d => d.device_type === "server").length, color: "text-blue-500" },
                { label: "Workstations", icon: Monitor, count: devices.filter(d => d.device_type === "workstation").length, color: "text-purple-500" },
                { label: "Laptops", icon: Laptop, count: devices.filter(d => d.device_type === "laptop").length, color: "text-cyan-500" },
                { label: "Network", icon: Wifi, count: devices.filter(d => d.device_type === "network").length, color: "text-orange-500" },
              ].map((item, i) => (
                <div key={i} className="flex items-center justify-between py-1">
                  <div className="flex items-center gap-2"><item.icon className={`w-4 h-4 ${item.color}`} /><span className="text-sm">{item.label}</span></div>
                  <span className="font-mono text-sm font-bold">{item.count}</span>
                </div>
              ))}
              <Separator />
              <div className="flex items-center justify-between py-1">
                <div className="flex items-center gap-2"><Cpu className="w-4 h-4 text-muted-foreground" /><span className="text-sm text-muted-foreground">Avg CPU</span></div>
                <span className="font-mono text-sm">{deviceStats.avg_cpu || 0}%</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <div className="flex items-center gap-2"><MemoryStick className="w-4 h-4 text-muted-foreground" /><span className="text-sm text-muted-foreground">Avg RAM</span></div>
                <span className="font-mono text-sm">{deviceStats.avg_ram || 0}%</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Ticket Trends + Open Tickets */}
      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-8">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold">Ticket Volume (7 Days)</CardTitle>
            <Badge variant="outline" className="text-[10px]">Trend</Badge>
          </CardHeader>
          <CardContent>
            <div className="h-[240px]">
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

        <Card className="col-span-4">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold flex items-center gap-2"><Ticket className="w-4 h-4" />Open Tickets</CardTitle>
            <Badge variant="secondary" className="text-[10px]">{stats.open_tickets}</Badge>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[260px]">
              <div className="space-y-0">
                {tickets.length > 0 ? tickets.map(t => (
                  <div key={t.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 cursor-pointer border-b border-border/50" onClick={() => navigate("/tickets")} data-testid={`dash-ticket-${t.id}`}>
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot[t.status] || "bg-gray-400"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{t.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-muted-foreground">{t.client_name}</span>
                        {t.device_name && <><span className="text-[10px] text-muted-foreground">|</span><span className="text-[10px] text-muted-foreground font-mono">{t.device_name}</span></>}
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
      </div>

      {/* Alerts + Activity */}
      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-5">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-500" />Active Alerts</CardTitle>
            <Badge variant={alerts.length > 0 ? "destructive" : "secondary"} className="text-[10px]">{alerts.length}</Badge>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[240px]">
              <div className="space-y-2">
                {alerts.length > 0 ? alerts.map(a => (
                  <div key={a.id} className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-muted/50 border border-transparent hover:border-border">
                    <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${a.severity === "critical" ? "bg-red-500" : a.severity === "warning" ? "bg-amber-500" : "bg-blue-500"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{a.message}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-muted-foreground font-mono">{a.device_name}</span>
                        <span className="text-[10px] text-muted-foreground">{a.client_name}</span>
                      </div>
                    </div>
                    <Badge variant="outline" className={`text-[9px] ${a.severity === "critical" ? "text-red-500 border-red-500/30" : "text-amber-500 border-amber-500/30"}`}>{a.severity}</Badge>
                  </div>
                )) : (
                  <div className="text-center py-12 text-muted-foreground"><CheckCircle className="w-8 h-8 mx-auto mb-2 opacity-30" /><p className="text-sm">No active alerts</p></div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="col-span-7">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold flex items-center gap-2"><Activity className="w-4 h-4 text-cyan-500" />Activity Feed</CardTitle>
            <Badge variant="outline" className="text-[10px] text-muted-foreground">Live</Badge>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[240px]">
              <div className="space-y-1">
                {activityFeed.length > 0 ? activityFeed.map(item => {
                  const iconMap = { ticket_note: MessageSquare, ticket_created: Ticket, alert: AlertTriangle };
                  const colorMap = { ticket_note: "text-indigo-400 bg-indigo-500/10", ticket_created: "text-cyan-400 bg-cyan-500/10", alert: "text-amber-400 bg-amber-500/10" };
                  const IconComp = iconMap[item.type] || Activity;
                  const color = colorMap[item.type] || "text-gray-400 bg-muted";
                  return (
                    <div key={item.id} className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-muted/50">
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
