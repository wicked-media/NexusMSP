import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2, Users, Monitor, Ticket, DollarSign, AlertTriangle, Phone,
  Clock, TrendingUp, BarChart3, UserCheck
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from "recharts";

const COLORS = ["#3B82F6", "#22C55E", "#EAB308", "#EF4444", "#8B5CF6", "#EC4899", "#F97316", "#06B6D4"];
const chartTooltipStyle = {
  backgroundColor: "hsl(217, 33%, 17%)", border: "1px solid hsl(217, 33%, 25%)",
  borderRadius: "8px", color: "hsl(210, 40%, 98%)"
};

const statusColorMap = { open: "#3B82F6", in_progress: "#EAB308", resolved: "#22C55E", closed: "#6B7280" };
const priorityColorMap = { critical: "#EF4444", high: "#F97316", medium: "#EAB308", low: "#22C55E" };

export default function ReportsPage() {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("technicians");
  const [techData, setTechData] = useState([]);
  const [ticketData, setTicketData] = useState(null);
  const [clientData, setClientData] = useState([]);
  const [revenueData, setRevenueData] = useState(null);
  const [deviceData, setDeviceData] = useState(null);
  const [dateRange, setDateRange] = useState("30d");

  const headers = { Authorization: `Bearer ${token}` };

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [techRes, ticketRes, clientRes, revRes, devRes] = await Promise.all([
        axios.get(`${API}/reports/technician-utilization`, { headers }),
        axios.get(`${API}/reports/ticket-analytics`, { headers }),
        axios.get(`${API}/reports/client-analytics`, { headers }),
        axios.get(`${API}/reports/revenue`, { headers }),
        axios.get(`${API}/reports/device-analytics`, { headers }),
      ]);
      setTechData(techRes.data);
      setTicketData(ticketRes.data);
      setClientData(clientRes.data);
      setRevenueData(revRes.data);
      setDeviceData(devRes.data);
    } catch (error) {
      console.error("Failed to fetch reports:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, [dateRange]);

  if (loading) {
    return <div className="flex items-center justify-center h-[60vh]"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6" data-testid="reports-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Reports & Analytics</h1>
          <p className="text-muted-foreground">Select a report category to view detailed analytics</p>
        </div>
        <Select value={dateRange} onValueChange={setDateRange}>
          <SelectTrigger className="w-[150px]" data-testid="reports-date-range"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="90d">Last 90 days</SelectItem>
            <SelectItem value="year">This Year</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-5 w-full">
          <TabsTrigger value="technicians" data-testid="tab-technicians"><UserCheck className="w-4 h-4 mr-1.5" />Technicians</TabsTrigger>
          <TabsTrigger value="tickets" data-testid="tab-tickets"><Ticket className="w-4 h-4 mr-1.5" />Tickets</TabsTrigger>
          <TabsTrigger value="clients" data-testid="tab-clients"><Users className="w-4 h-4 mr-1.5" />Clients</TabsTrigger>
          <TabsTrigger value="revenue" data-testid="tab-revenue"><DollarSign className="w-4 h-4 mr-1.5" />Revenue</TabsTrigger>
          <TabsTrigger value="devices" data-testid="tab-devices"><Monitor className="w-4 h-4 mr-1.5" />Devices</TabsTrigger>
        </TabsList>

        {/* ---- TECHNICIAN UTILIZATION ---- */}
        <TabsContent value="technicians" className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Total Techs</p><p className="text-2xl font-bold">{techData.length}</p></CardContent></Card>
            <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Total Billable Hours</p><p className="text-2xl font-bold">{techData.reduce((s, t) => s + t.billable_hours, 0).toFixed(1)}h</p></CardContent></Card>
            <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Avg Utilization</p><p className="text-2xl font-bold">{(techData.reduce((s, t) => s + t.utilization, 0) / (techData.length || 1)).toFixed(0)}%</p></CardContent></Card>
            <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Total Revenue</p><p className="text-2xl font-bold">${techData.reduce((s, t) => s + t.revenue, 0).toLocaleString()}</p></CardContent></Card>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-lg">Hours by Technician</CardTitle></CardHeader>
              <CardContent>
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={techData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(217,33%,25%)" horizontal={false} />
                      <XAxis type="number" stroke="hsl(215,20%,65%)" fontSize={12} />
                      <YAxis type="category" dataKey="name" stroke="hsl(215,20%,65%)" fontSize={12} width={100} />
                      <Tooltip contentStyle={chartTooltipStyle} />
                      <Legend />
                      <Bar dataKey="billable_hours" name="Billable" fill="#22C55E" radius={[0,4,4,0]} />
                      <Bar dataKey="total_hours" name="Total" fill="#3B82F6" radius={[0,4,4,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-lg">Technician Details</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Name</TableHead><TableHead>Hours</TableHead><TableHead>Utilization</TableHead><TableHead>Tickets</TableHead><TableHead>Revenue</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {techData.map(t => (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium">{t.name}</TableCell>
                        <TableCell>{t.billable_hours}h / {t.total_hours}h</TableCell>
                        <TableCell><Badge variant="outline" className={t.utilization >= 70 ? "text-green-500 border-green-500/30" : t.utilization >= 40 ? "text-yellow-500 border-yellow-500/30" : "text-red-500 border-red-500/30"}>{t.utilization}%</Badge></TableCell>
                        <TableCell>{t.tickets_resolved}/{t.tickets_assigned}</TableCell>
                        <TableCell>${t.revenue.toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ---- TICKET ANALYTICS ---- */}
        <TabsContent value="tickets" className="space-y-6">
          {ticketData && (<>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Total Tickets</p><p className="text-2xl font-bold">{ticketData.total}</p></CardContent></Card>
              <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Avg Resolution</p><p className="text-2xl font-bold">{ticketData.avg_resolution_hours}h</p></CardContent></Card>
              <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">SLA Compliance</p><p className="text-2xl font-bold">{ticketData.sla_compliance}%</p></CardContent></Card>
              <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Categories</p><p className="text-2xl font-bold">{ticketData.by_category.length}</p></CardContent></Card>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader><CardTitle className="text-lg">Tickets by Status</CardTitle></CardHeader>
                <CardContent>
                  <div className="h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={ticketData.by_status} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value" label={({name, value}) => `${name}: ${value}`} labelLine={false}>
                          {ticketData.by_status.map((e, i) => <Cell key={i} fill={statusColorMap[e.name] || COLORS[i % COLORS.length]} />)}
                        </Pie>
                        <Tooltip contentStyle={chartTooltipStyle} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-lg">Tickets by Priority</CardTitle></CardHeader>
                <CardContent>
                  <div className="h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={ticketData.by_priority}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(217,33%,25%)" />
                        <XAxis dataKey="name" stroke="hsl(215,20%,65%)" fontSize={12} />
                        <YAxis stroke="hsl(215,20%,65%)" fontSize={12} />
                        <Tooltip contentStyle={chartTooltipStyle} />
                        <Bar dataKey="value" name="Tickets" radius={[4,4,0,0]}>
                          {ticketData.by_priority.map((e, i) => <Cell key={i} fill={priorityColorMap[e.name] || COLORS[i]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>
            <Card>
              <CardHeader><CardTitle className="text-lg">Tickets by Client</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow><TableHead>Client</TableHead><TableHead className="text-right">Tickets</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {ticketData.by_client.slice(0, 10).map((c, i) => (
                      <TableRow key={i}><TableCell>{c.name}</TableCell><TableCell className="text-right font-mono">{c.value}</TableCell></TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>)}
        </TabsContent>

        {/* ---- CLIENT ANALYTICS ---- */}
        <TabsContent value="clients" className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Total Clients</p><p className="text-2xl font-bold">{clientData.length}</p></CardContent></Card>
            <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Total MRR</p><p className="text-2xl font-bold">${clientData.reduce((s, c) => s + c.mrr, 0).toLocaleString()}</p></CardContent></Card>
            <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Total Devices</p><p className="text-2xl font-bold">{clientData.reduce((s, c) => s + c.total_devices, 0)}</p></CardContent></Card>
            <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Open Tickets</p><p className="text-2xl font-bold">{clientData.reduce((s, c) => s + c.open_tickets, 0)}</p></CardContent></Card>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-lg">MRR by Client</CardTitle></CardHeader>
              <CardContent>
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={clientData.filter(c => c.mrr > 0).slice(0, 8)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(217,33%,25%)" />
                      <XAxis dataKey="name" stroke="hsl(215,20%,65%)" fontSize={11} angle={-15} textAnchor="end" height={60} />
                      <YAxis stroke="hsl(215,20%,65%)" fontSize={12} tickFormatter={v => `$${v}`} />
                      <Tooltip contentStyle={chartTooltipStyle} formatter={v => [`$${v}`, "MRR"]} />
                      <Bar dataKey="mrr" fill="#22C55E" radius={[4,4,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-lg">Tickets by Client</CardTitle></CardHeader>
              <CardContent>
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={clientData.filter(c => c.total_tickets > 0).slice(0, 8)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(217,33%,25%)" />
                      <XAxis dataKey="name" stroke="hsl(215,20%,65%)" fontSize={11} angle={-15} textAnchor="end" height={60} />
                      <YAxis stroke="hsl(215,20%,65%)" fontSize={12} />
                      <Tooltip contentStyle={chartTooltipStyle} />
                      <Legend />
                      <Bar dataKey="total_tickets" name="Total" fill="#3B82F6" radius={[4,4,0,0]} />
                      <Bar dataKey="open_tickets" name="Open" fill="#EF4444" radius={[4,4,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader><CardTitle className="text-lg">Client Details</CardTitle></CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[400px]">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Client</TableHead><TableHead>Industry</TableHead><TableHead>MRR</TableHead><TableHead>Devices</TableHead><TableHead>Tickets</TableHead><TableHead>Billable Rev</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {clientData.map(c => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">{c.name}</TableCell>
                        <TableCell className="capitalize">{c.industry}</TableCell>
                        <TableCell>${c.mrr.toLocaleString()}</TableCell>
                        <TableCell>{c.online_devices}/{c.total_devices}</TableCell>
                        <TableCell>{c.open_tickets}/{c.total_tickets}</TableCell>
                        <TableCell>${c.billable_revenue.toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- REVENUE & BILLING ---- */}
        <TabsContent value="revenue" className="space-y-6">
          {revenueData && (<>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Monthly MRR</p><p className="text-2xl font-bold">${revenueData.total_mrr.toLocaleString()}</p></CardContent></Card>
              <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Annual Run Rate</p><p className="text-2xl font-bold">${revenueData.annual_run_rate.toLocaleString()}</p></CardContent></Card>
              <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Outstanding</p><p className="text-2xl font-bold text-yellow-500">${revenueData.outstanding.toLocaleString()}</p></CardContent></Card>
              <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Billable Revenue</p><p className="text-2xl font-bold text-green-500">${revenueData.billable_revenue.toLocaleString()}</p></CardContent></Card>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader><CardTitle className="text-lg">MRR by Client</CardTitle></CardHeader>
                <CardContent>
                  <div className="h-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={revenueData.mrr_by_client.slice(0, 8)}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(217,33%,25%)" />
                        <XAxis dataKey="name" stroke="hsl(215,20%,65%)" fontSize={11} angle={-15} textAnchor="end" height={60} />
                        <YAxis stroke="hsl(215,20%,65%)" fontSize={12} tickFormatter={v => `$${v}`} />
                        <Tooltip contentStyle={chartTooltipStyle} formatter={v => [`$${v}`, "MRR"]} />
                        <Bar dataKey="mrr" fill="#22C55E" radius={[4,4,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-lg">Invoices by Status</CardTitle></CardHeader>
                <CardContent>
                  <div className="h-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={Object.entries(revenueData.invoices_by_status).map(([k,v]) => ({name:k, value:v}))} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value" label={({name, value}) => `${name}: ${value}`} labelLine={false}>
                          {Object.keys(revenueData.invoices_by_status).map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                        </Pie>
                        <Tooltip contentStyle={chartTooltipStyle} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>
          </>)}
        </TabsContent>

        {/* ---- DEVICE ANALYTICS ---- */}
        <TabsContent value="devices" className="space-y-6">
          {deviceData && (<>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Total Devices</p><p className="text-2xl font-bold">{deviceData.total}</p></CardContent></Card>
              <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Device Types</p><p className="text-2xl font-bold">{deviceData.by_type.length}</p></CardContent></Card>
              <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Total Alerts</p><p className="text-2xl font-bold">{deviceData.total_alerts}</p></CardContent></Card>
              <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Active Alerts</p><p className="text-2xl font-bold text-red-500">{deviceData.active_alerts}</p></CardContent></Card>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader><CardTitle className="text-lg">Devices by Status</CardTitle></CardHeader>
                <CardContent>
                  <div className="h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={deviceData.by_status} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value" label={({name, value}) => `${name}: ${value}`} labelLine={false}>
                          {deviceData.by_status.map((e, i) => <Cell key={i} fill={e.name === "online" ? "#22C55E" : e.name === "offline" ? "#EF4444" : "#EAB308"} />)}
                        </Pie>
                        <Tooltip contentStyle={chartTooltipStyle} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-lg">Devices by Type</CardTitle></CardHeader>
                <CardContent>
                  <div className="h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={deviceData.by_type}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(217,33%,25%)" />
                        <XAxis dataKey="name" stroke="hsl(215,20%,65%)" fontSize={12} />
                        <YAxis stroke="hsl(215,20%,65%)" fontSize={12} />
                        <Tooltip contentStyle={chartTooltipStyle} />
                        <Bar dataKey="value" name="Count" fill="#8B5CF6" radius={[4,4,0,0]}>
                          {deviceData.by_type.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>
            <Card>
              <CardHeader><CardTitle className="text-lg">Devices by Client</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow><TableHead>Client</TableHead><TableHead className="text-right">Devices</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {deviceData.by_client.map((c, i) => (
                      <TableRow key={i}><TableCell>{c.name}</TableCell><TableCell className="text-right font-mono">{c.value}</TableCell></TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>)}
        </TabsContent>
      </Tabs>
    </div>
  );
}
