import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Loader2, Users, Monitor, Ticket, DollarSign, AlertTriangle, Phone,
  Clock, TrendingUp, BarChart3, UserCheck, Download, FileText, Shield,
  CheckCircle, XCircle, Timer, Target, Zap
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, AreaChart, Area, LineChart, Line
} from "recharts";

const COLORS = ["#3B82F6", "#22C55E", "#EAB308", "#EF4444", "#8B5CF6", "#EC4899", "#F97316", "#06B6D4"];
const chartTooltipStyle = {
  backgroundColor: "hsl(217, 33%, 17%)", border: "1px solid hsl(217, 33%, 25%)",
  borderRadius: "8px", color: "hsl(210, 40%, 98%)"
};
const statusColorMap = { open: "#3B82F6", in_progress: "#EAB308", resolved: "#22C55E", closed: "#6B7280" };
const priorityColorMap = { critical: "#EF4444", high: "#F97316", medium: "#EAB308", low: "#22C55E" };

function exportCSV(data, filename) {
  if (!data || data.length === 0) { toast.error("No data to export"); return; }
  const headers = Object.keys(data[0]);
  const csv = [headers.join(","), ...data.map(row => headers.map(h => {
    const val = row[h];
    if (typeof val === "string" && (val.includes(",") || val.includes('"'))) return `"${val.replace(/"/g, '""')}"`;
    return val ?? "";
  }).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${filename}_${new Date().toISOString().split("T")[0]}.csv`;
  a.click(); URL.revokeObjectURL(url);
  toast.success(`Exported ${data.length} rows`);
}

export default function ReportsPage() {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");
  const [techData, setTechData] = useState([]);
  const [ticketData, setTicketData] = useState(null);
  const [clientData, setClientData] = useState([]);
  const [revenueData, setRevenueData] = useState(null);
  const [deviceData, setDeviceData] = useState(null);
  const [dateRange, setDateRange] = useState("30d");
  const [tickets, setTickets] = useState([]);

  const headers = { Authorization: `Bearer ${token}` };

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [techRes, ticketRes, clientRes, revRes, devRes, ticketsRes] = await Promise.all([
        axios.get(`${API}/reports/technician-utilization`, { headers }),
        axios.get(`${API}/reports/ticket-analytics`, { headers }),
        axios.get(`${API}/reports/client-analytics`, { headers }),
        axios.get(`${API}/reports/revenue`, { headers }),
        axios.get(`${API}/reports/device-analytics`, { headers }),
        axios.get(`${API}/tickets`, { headers }),
      ]);
      setTechData(techRes.data);
      setTicketData(ticketRes.data);
      setClientData(clientRes.data);
      setRevenueData(revRes.data);
      setDeviceData(devRes.data);
      setTickets(ticketsRes.data);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Computed SLA stats
  const slaStats = {
    total: tickets.length,
    withinSLA: tickets.filter(t => !t.sla_due || new Date(t.sla_due) > new Date(t.resolved_at || Date.now())).length,
    breached: tickets.filter(t => t.sla_due && new Date(t.sla_due) < new Date(t.resolved_at || Date.now())).length,
    avgResolutionHours: tickets.filter(t => t.resolved_at).length > 0
      ? Math.round(tickets.filter(t => t.resolved_at).reduce((s, t) => s + (new Date(t.resolved_at) - new Date(t.created_at)) / 3600000, 0) / tickets.filter(t => t.resolved_at).length)
      : 0,
    byPriority: ["critical", "high", "medium", "low"].map(p => {
      const pTickets = tickets.filter(t => t.priority === p);
      const resolved = pTickets.filter(t => t.resolved_at);
      return {
        priority: p,
        total: pTickets.length,
        resolved: resolved.length,
        avgHours: resolved.length > 0 ? Math.round(resolved.reduce((s, t) => s + (new Date(t.resolved_at) - new Date(t.created_at)) / 3600000, 0) / resolved.length) : 0,
        slaRate: pTickets.length > 0 ? Math.round(pTickets.filter(t => !t.sla_due || new Date(t.sla_due) > new Date(t.resolved_at || Date.now())).length / pTickets.length * 100) : 100
      };
    })
  };
  const slaComplianceRate = slaStats.total > 0 ? Math.round(slaStats.withinSLA / slaStats.total * 100) : 100;

  // Profitability data
  const profitData = clientData.map(c => ({
    name: c.name,
    revenue: c.mrr || 0,
    tickets: c.ticket_count || 0,
    devices: c.device_count || 0,
    costPerTicket: c.ticket_count > 0 ? Math.round((c.mrr || 0) / c.ticket_count) : 0,
  })).sort((a, b) => b.revenue - a.revenue);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="space-y-6" data-testid="reports-page">
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-bold tracking-tight">Reports & Analytics</h1><p className="text-muted-foreground">Comprehensive business intelligence</p></div>
        <div className="flex gap-2">
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-[130px]" data-testid="date-range-select"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 Days</SelectItem>
              <SelectItem value="30d">Last 30 Days</SelectItem>
              <SelectItem value="90d">Last 90 Days</SelectItem>
              <SelectItem value="365d">Last Year</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview" className="gap-1"><BarChart3 className="w-4 h-4" />Overview</TabsTrigger>
          <TabsTrigger value="technicians" className="gap-1"><UserCheck className="w-4 h-4" />Technicians</TabsTrigger>
          <TabsTrigger value="tickets" className="gap-1"><Ticket className="w-4 h-4" />Tickets</TabsTrigger>
          <TabsTrigger value="sla" className="gap-1"><Shield className="w-4 h-4" />SLA Compliance</TabsTrigger>
          <TabsTrigger value="revenue" className="gap-1"><DollarSign className="w-4 h-4" />Revenue</TabsTrigger>
          <TabsTrigger value="profitability" className="gap-1"><Target className="w-4 h-4" />Profitability</TabsTrigger>
          <TabsTrigger value="devices" className="gap-1"><Monitor className="w-4 h-4" />Devices</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card><CardContent className="p-4 flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center"><Ticket className="w-5 h-5 text-blue-500" /></div><div><p className="text-2xl font-bold">{ticketData?.total_tickets || 0}</p><p className="text-xs text-muted-foreground">Total Tickets</p></div></CardContent></Card>
            <Card><CardContent className="p-4 flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center"><DollarSign className="w-5 h-5 text-green-500" /></div><div><p className="text-2xl font-bold">${revenueData?.total_revenue?.toLocaleString() || 0}</p><p className="text-xs text-muted-foreground">Total Revenue</p></div></CardContent></Card>
            <Card><CardContent className="p-4 flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center"><Users className="w-5 h-5 text-purple-500" /></div><div><p className="text-2xl font-bold">{clientData.length}</p><p className="text-xs text-muted-foreground">Active Clients</p></div></CardContent></Card>
            <Card><CardContent className="p-4 flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center"><Shield className="w-5 h-5 text-emerald-500" /></div><div><p className="text-2xl font-bold">{slaComplianceRate}%</p><p className="text-xs text-muted-foreground">SLA Compliance</p></div></CardContent></Card>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Ticket Volume by Status</CardTitle></CardHeader>
              <CardContent>
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                    <PieChart>
                      <Pie data={ticketData?.by_status || []} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={3} dataKey="count" nameKey="status">
                        {(ticketData?.by_status || []).map((e, i) => <Cell key={`k-${i}`} fill={statusColorMap[e.status] || COLORS[i]} />)}
                      </Pie>
                      <Tooltip contentStyle={chartTooltipStyle} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Revenue Trend</CardTitle></CardHeader>
              <CardContent>
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                    <AreaChart data={revenueData?.monthly_trend || []}>
                      <defs><linearGradient id="rg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#22C55E" stopOpacity={0.3} /><stop offset="95%" stopColor="#22C55E" stopOpacity={0} /></linearGradient></defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                      <Tooltip contentStyle={chartTooltipStyle} />
                      <Area type="monotone" dataKey="revenue" stroke="#22C55E" fill="url(#rg)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Technicians Tab */}
        <TabsContent value="technicians" className="space-y-4">
          <div className="flex justify-end"><Button variant="outline" size="sm" onClick={() => exportCSV(techData.map(t => ({ Name: t.name, Role: t.role, "Open Tickets": t.open_tickets, "Resolved": t.resolved_tickets, "Avg Response (h)": t.avg_response_hours || 0, Utilization: `${t.utilization || 0}%` })), "technician_report")} data-testid="export-tech-csv"><Download className="w-4 h-4 mr-2" />Export CSV</Button></div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Technician</TableHead><TableHead>Role</TableHead><TableHead className="text-center">Open</TableHead><TableHead className="text-center">Resolved</TableHead><TableHead className="text-center">Avg Response</TableHead><TableHead>Utilization</TableHead></TableRow></TableHeader>
                <TableBody>
                  {techData.map(tech => (
                    <TableRow key={tech.id}>
                      <TableCell className="font-medium">{tech.name}</TableCell>
                      <TableCell><Badge variant="outline">{tech.role}</Badge></TableCell>
                      <TableCell className="text-center font-mono">{tech.open_tickets}</TableCell>
                      <TableCell className="text-center font-mono">{tech.resolved_tickets}</TableCell>
                      <TableCell className="text-center font-mono">{tech.avg_response_hours || 0}h</TableCell>
                      <TableCell><div className="flex items-center gap-2"><Progress value={tech.utilization || 0} className="h-2 w-20" /><span className="text-xs font-mono">{tech.utilization || 0}%</span></div></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Technician Workload</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                  <BarChart data={techData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <YAxis dataKey="name" type="category" width={100} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <Tooltip contentStyle={chartTooltipStyle} />
                    <Bar dataKey="open_tickets" name="Open" fill="#3B82F6" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="resolved_tickets" name="Resolved" fill="#22C55E" radius={[0, 4, 4, 0]} />
                    <Legend />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tickets Tab */}
        <TabsContent value="tickets" className="space-y-4">
          <div className="flex justify-end"><Button variant="outline" size="sm" onClick={() => exportCSV((ticketData?.by_priority || []).map(p => ({ Priority: p.priority, Count: p.count, Percentage: `${ticketData?.total_tickets ? Math.round(p.count / ticketData.total_tickets * 100) : 0}%` })), "ticket_report")} data-testid="export-tickets-csv"><Download className="w-4 h-4 mr-2" />Export CSV</Button></div>
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">By Priority</CardTitle></CardHeader>
              <CardContent>
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                    <PieChart>
                      <Pie data={ticketData?.by_priority || []} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={3} dataKey="count" nameKey="priority">
                        {(ticketData?.by_priority || []).map((e, i) => <Cell key={`k-${i}`} fill={priorityColorMap[e.priority] || COLORS[i]} />)}
                      </Pie>
                      <Tooltip contentStyle={chartTooltipStyle} /><Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">By Category</CardTitle></CardHeader>
              <CardContent>
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                    <BarChart data={ticketData?.by_category || []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="category" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                      <Tooltip contentStyle={chartTooltipStyle} />
                      <Bar dataKey="count" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* SLA Compliance Tab */}
        <TabsContent value="sla" className="space-y-4" data-testid="sla-tab">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card><CardContent className="p-4 text-center"><div className="w-16 h-16 rounded-full mx-auto mb-2 flex items-center justify-center border-4 border-emerald-500/30"><span className="text-xl font-bold text-emerald-500">{slaComplianceRate}%</span></div><p className="text-xs text-muted-foreground">Overall SLA Rate</p></CardContent></Card>
            <Card><CardContent className="p-4 flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center"><CheckCircle className="w-5 h-5 text-green-500" /></div><div><p className="text-2xl font-bold text-green-500">{slaStats.withinSLA}</p><p className="text-xs text-muted-foreground">Within SLA</p></div></CardContent></Card>
            <Card><CardContent className="p-4 flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center"><XCircle className="w-5 h-5 text-red-500" /></div><div><p className="text-2xl font-bold text-red-500">{slaStats.breached}</p><p className="text-xs text-muted-foreground">Breached</p></div></CardContent></Card>
            <Card><CardContent className="p-4 flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center"><Timer className="w-5 h-5 text-blue-500" /></div><div><p className="text-2xl font-bold">{slaStats.avgResolutionHours}h</p><p className="text-xs text-muted-foreground">Avg Resolution</p></div></CardContent></Card>
          </div>
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between"><CardTitle className="text-base">SLA by Priority</CardTitle>
              <Button variant="outline" size="sm" onClick={() => exportCSV(slaStats.byPriority.map(p => ({ Priority: p.priority, Total: p.total, Resolved: p.resolved, "Avg Hours": p.avgHours, "SLA Rate": `${p.slaRate}%` })), "sla_report")} data-testid="export-sla-csv"><Download className="w-4 h-4 mr-2" />Export CSV</Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Priority</TableHead><TableHead className="text-center">Total</TableHead><TableHead className="text-center">Resolved</TableHead><TableHead className="text-center">Avg Resolution</TableHead><TableHead>SLA Compliance</TableHead></TableRow></TableHeader>
                <TableBody>
                  {slaStats.byPriority.map(p => (
                    <TableRow key={p.priority}>
                      <TableCell><Badge style={{ backgroundColor: `${priorityColorMap[p.priority]}20`, color: priorityColorMap[p.priority] }} className="capitalize">{p.priority}</Badge></TableCell>
                      <TableCell className="text-center font-mono">{p.total}</TableCell>
                      <TableCell className="text-center font-mono">{p.resolved}</TableCell>
                      <TableCell className="text-center font-mono">{p.avgHours}h</TableCell>
                      <TableCell><div className="flex items-center gap-2"><Progress value={p.slaRate} className="h-2 w-24" /><span className={`text-xs font-mono font-bold ${p.slaRate >= 90 ? "text-green-500" : p.slaRate >= 70 ? "text-amber-500" : "text-red-500"}`}>{p.slaRate}%</span></div></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">SLA Performance by Priority</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                  <BarChart data={slaStats.byPriority}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="priority" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} domain={[0, 100]} />
                    <Tooltip contentStyle={chartTooltipStyle} />
                    <Bar dataKey="slaRate" name="SLA Rate %" radius={[4, 4, 0, 0]}>
                      {slaStats.byPriority.map((e, i) => <Cell key={`k-${i}`} fill={e.slaRate >= 90 ? "#22C55E" : e.slaRate >= 70 ? "#EAB308" : "#EF4444"} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Revenue Tab */}
        <TabsContent value="revenue" className="space-y-4">
          <div className="flex justify-end"><Button variant="outline" size="sm" onClick={() => exportCSV((revenueData?.monthly_trend || []).map(m => ({ Month: m.month, Revenue: `$${m.revenue}`, Invoices: m.invoices })), "revenue_report")} data-testid="export-revenue-csv"><Download className="w-4 h-4 mr-2" />Export CSV</Button></div>
          <div className="grid grid-cols-3 gap-4">
            <Card><CardContent className="p-4 text-center"><p className="text-3xl font-bold text-green-500">${revenueData?.total_revenue?.toLocaleString() || 0}</p><p className="text-xs text-muted-foreground">Total Revenue</p></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><p className="text-3xl font-bold">${revenueData?.mrr?.toLocaleString() || 0}</p><p className="text-xs text-muted-foreground">Monthly Recurring</p></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><p className="text-3xl font-bold">{revenueData?.total_invoices || 0}</p><p className="text-xs text-muted-foreground">Total Invoices</p></CardContent></Card>
          </div>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Monthly Revenue Trend</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                  <AreaChart data={revenueData?.monthly_trend || []}>
                    <defs><linearGradient id="rvg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#22C55E" stopOpacity={0.3} /><stop offset="95%" stopColor="#22C55E" stopOpacity={0} /></linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <Tooltip contentStyle={chartTooltipStyle} />
                    <Area type="monotone" dataKey="revenue" stroke="#22C55E" strokeWidth={2} fill="url(#rvg)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Profitability Tab */}
        <TabsContent value="profitability" className="space-y-4" data-testid="profitability-tab">
          <div className="flex justify-end"><Button variant="outline" size="sm" onClick={() => exportCSV(profitData.map(p => ({ Client: p.name, "MRR ($)": p.revenue, Tickets: p.tickets, Devices: p.devices, "Revenue/Ticket ($)": p.costPerTicket })), "profitability_report")} data-testid="export-profit-csv"><Download className="w-4 h-4 mr-2" />Export CSV</Button></div>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Client Profitability Analysis</CardTitle></CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[400px]">
                <Table>
                  <TableHeader><TableRow><TableHead>Client</TableHead><TableHead className="text-right">MRR</TableHead><TableHead className="text-center">Tickets</TableHead><TableHead className="text-center">Devices</TableHead><TableHead className="text-right">Revenue/Ticket</TableHead><TableHead>Health</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {profitData.map(p => {
                      const health = p.costPerTicket >= 200 ? "high" : p.costPerTicket >= 50 ? "medium" : p.tickets === 0 ? "new" : "low";
                      const healthColors = { high: "bg-emerald-500/10 text-emerald-500", medium: "bg-amber-500/10 text-amber-500", low: "bg-red-500/10 text-red-500", new: "bg-blue-500/10 text-blue-500" };
                      return (
                        <TableRow key={p.name}>
                          <TableCell className="font-medium">{p.name}</TableCell>
                          <TableCell className="text-right font-mono">${p.revenue.toLocaleString()}</TableCell>
                          <TableCell className="text-center font-mono">{p.tickets}</TableCell>
                          <TableCell className="text-center font-mono">{p.devices}</TableCell>
                          <TableCell className="text-right font-mono">${p.costPerTicket}</TableCell>
                          <TableCell><Badge className={healthColors[health]}>{health === "high" ? "Profitable" : health === "medium" ? "Average" : health === "low" ? "At Risk" : "New"}</Badge></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Revenue per Client</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                  <BarChart data={profitData.slice(0, 10)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={10} angle={-20} textAnchor="end" height={50} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <Tooltip contentStyle={chartTooltipStyle} />
                    <Bar dataKey="revenue" name="MRR ($)" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="tickets" name="Tickets" fill="#EF4444" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Devices Tab */}
        <TabsContent value="devices" className="space-y-4">
          <div className="flex justify-end"><Button variant="outline" size="sm" onClick={() => exportCSV((deviceData?.by_type || []).map(d => ({ Type: d.type, Count: d.count })), "device_report")} data-testid="export-devices-csv"><Download className="w-4 h-4 mr-2" />Export CSV</Button></div>
          <div className="grid grid-cols-3 gap-4">
            <Card><CardContent className="p-4 text-center"><p className="text-3xl font-bold">{deviceData?.total_devices || 0}</p><p className="text-xs text-muted-foreground">Total Devices</p></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><p className="text-3xl font-bold text-emerald-500">{deviceData?.online || 0}</p><p className="text-xs text-muted-foreground">Online</p></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><p className="text-3xl font-bold text-red-500">{deviceData?.offline || 0}</p><p className="text-xs text-muted-foreground">Offline</p></CardContent></Card>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Devices by Type</CardTitle></CardHeader>
              <CardContent>
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                    <PieChart>
                      <Pie data={deviceData?.by_type || []} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={3} dataKey="count" nameKey="type">
                        {(deviceData?.by_type || []).map((_, i) => <Cell key={`k-${i}`} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={chartTooltipStyle} /><Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Devices by OS</CardTitle></CardHeader>
              <CardContent>
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                    <BarChart data={deviceData?.by_os || []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="os" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                      <Tooltip contentStyle={chartTooltipStyle} />
                      <Bar dataKey="count" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
