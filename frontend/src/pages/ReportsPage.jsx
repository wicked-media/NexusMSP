import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, TrendingUp, Users, Monitor, Ticket, DollarSign, AlertTriangle } from "lucide-react";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend
} from "recharts";

const COLORS = ['#3B82F6', '#22C55E', '#EAB308', '#EF4444', '#8B5CF6', '#EC4899'];

export default function ReportsPage() {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [clients, setClients] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [devices, setDevices] = useState([]);
  const [dateRange, setDateRange] = useState("7d");

  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [statsRes, clientsRes, ticketsRes, devicesRes] = await Promise.all([
        axios.get(`${API}/dashboard/stats`, { headers }),
        axios.get(`${API}/clients`, { headers }),
        axios.get(`${API}/tickets`, { headers }),
        axios.get(`${API}/devices`, { headers })
      ]);
      setStats(statsRes.data);
      setClients(clientsRes.data);
      setTickets(ticketsRes.data);
      setDevices(devicesRes.data);
    } catch (error) {
      console.error("Failed to fetch report data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [dateRange]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Prepare chart data
  const ticketsByStatus = [
    { name: "Open", value: stats?.open_tickets || 0, color: "#3B82F6" },
    { name: "In Progress", value: stats?.in_progress_tickets || 0, color: "#EAB308" },
    { name: "Resolved", value: stats?.resolved_tickets || 0, color: "#22C55E" }
  ];

  const ticketsByPriority = [
    { name: "Critical", count: tickets.filter(t => t.priority === "critical").length, color: "#EF4444" },
    { name: "High", count: tickets.filter(t => t.priority === "high").length, color: "#F97316" },
    { name: "Medium", count: tickets.filter(t => t.priority === "medium").length, color: "#EAB308" },
    { name: "Low", count: tickets.filter(t => t.priority === "low").length, color: "#22C55E" }
  ];

  const devicesByStatus = [
    { name: "Online", value: stats?.online_devices || 0, color: "#22C55E" },
    { name: "Warning", value: devices.filter(d => d.status === "warning").length, color: "#EAB308" },
    { name: "Offline", value: stats?.offline_devices || 0, color: "#EF4444" }
  ];

  const clientsByIndustry = clients.reduce((acc, client) => {
    const industry = client.industry || "Other";
    const existing = acc.find(i => i.name === industry);
    if (existing) {
      existing.value++;
      existing.mrr += client.mrr || 0;
    } else {
      acc.push({ name: industry, value: 1, mrr: client.mrr || 0 });
    }
    return acc;
  }, []);

  const revenueByClient = clients
    .filter(c => c.mrr > 0)
    .sort((a, b) => b.mrr - a.mrr)
    .slice(0, 5)
    .map(c => ({ name: c.name.substring(0, 15), mrr: c.mrr }));

  return (
    <div className="space-y-8" data-testid="reports-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Reports & Analytics</h1>
          <p className="text-muted-foreground">Comprehensive business insights</p>
        </div>
        <Select value={dateRange} onValueChange={setDateRange}>
          <SelectTrigger className="w-[150px]" data-testid="reports-date-range">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="90d">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total MRR</p>
                <p className="text-2xl font-bold">${stats?.total_mrr?.toLocaleString()}</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-green-500" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active Clients</p>
                <p className="text-2xl font-bold">{stats?.total_clients}</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Users className="w-5 h-5 text-blue-500" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Managed Devices</p>
                <p className="text-2xl font-bold">{stats?.total_devices}</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <Monitor className="w-5 h-5 text-purple-500" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active Alerts</p>
                <p className="text-2xl font-bold">{stats?.active_alerts}</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-yellow-500/10 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-yellow-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Tickets by Status */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Tickets by Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={ticketsByStatus}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={4}
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${value}`}
                    labelLine={false}
                  >
                    {ticketsByStatus.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: 'hsl(217, 33%, 17%)',
                      border: '1px solid hsl(217, 33%, 25%)',
                      borderRadius: '8px',
                      color: 'hsl(210, 40%, 98%)'
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Tickets by Priority */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Tickets by Priority</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ticketsByPriority} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(217, 33%, 25%)" horizontal={false} />
                  <XAxis type="number" stroke="hsl(215, 20%, 65%)" fontSize={12} />
                  <YAxis type="category" dataKey="name" stroke="hsl(215, 20%, 65%)" fontSize={12} width={70} />
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: 'hsl(217, 33%, 17%)',
                      border: '1px solid hsl(217, 33%, 25%)',
                      borderRadius: '8px',
                      color: 'hsl(210, 40%, 98%)'
                    }}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {ticketsByPriority.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Device Health */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Device Health Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={devicesByStatus}
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  >
                    {devicesByStatus.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: 'hsl(217, 33%, 17%)',
                      border: '1px solid hsl(217, 33%, 25%)',
                      borderRadius: '8px',
                      color: 'hsl(210, 40%, 98%)'
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Top Revenue Clients */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Top Clients by MRR</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenueByClient}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(217, 33%, 25%)" />
                  <XAxis dataKey="name" stroke="hsl(215, 20%, 65%)" fontSize={11} angle={-15} textAnchor="end" height={60} />
                  <YAxis stroke="hsl(215, 20%, 65%)" fontSize={12} tickFormatter={(v) => `$${v}`} />
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: 'hsl(217, 33%, 17%)',
                      border: '1px solid hsl(217, 33%, 25%)',
                      borderRadius: '8px',
                      color: 'hsl(210, 40%, 98%)'
                    }}
                    formatter={(value) => [`$${value}`, 'MRR']}
                  />
                  <Bar dataKey="mrr" fill="#22C55E" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Clients by Industry */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Clients by Industry</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={clientsByIndustry}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(217, 33%, 25%)" />
                <XAxis dataKey="name" stroke="hsl(215, 20%, 65%)" fontSize={12} />
                <YAxis stroke="hsl(215, 20%, 65%)" fontSize={12} />
                <Tooltip 
                  contentStyle={{
                    backgroundColor: 'hsl(217, 33%, 17%)',
                    border: '1px solid hsl(217, 33%, 25%)',
                    borderRadius: '8px',
                    color: 'hsl(210, 40%, 98%)'
                  }}
                  formatter={(value, name) => [name === 'mrr' ? `$${value}` : value, name === 'mrr' ? 'Total MRR' : 'Clients']}
                />
                <Legend />
                <Bar dataKey="value" name="Clients" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="mrr" name="Total MRR" fill="#22C55E" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
