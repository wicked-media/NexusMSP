import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Users, 
  Monitor, 
  Ticket, 
  AlertTriangle, 
  DollarSign, 
  TrendingUp,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  Wifi,
  WifiOff,
  RefreshCw
} from "lucide-react";
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from "recharts";

const StatCard = ({ title, value, icon: Icon, trend, trendValue, iconBg, iconColor }) => (
  <Card className="card-hover">
    <CardContent className="p-6">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-3xl font-bold tracking-tight">{value}</p>
          {trend && (
            <div className={`flex items-center gap-1 text-xs ${trend === 'up' ? 'text-green-500' : 'text-red-500'}`}>
              {trend === 'up' ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
              <span>{trendValue}</span>
            </div>
          )}
        </div>
        <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${iconBg}`}>
          <Icon className={`w-6 h-6 ${iconColor}`} />
        </div>
      </div>
    </CardContent>
  </Card>
);

const AlertItem = ({ alert }) => {
  const severityColors = {
    critical: "text-red-500 bg-red-500/10 border-red-500/20",
    warning: "text-yellow-500 bg-yellow-500/10 border-yellow-500/20",
    info: "text-blue-500 bg-blue-500/10 border-blue-500/20"
  };

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/50 transition-smooth border border-transparent hover:border-border">
      <div className={`w-2 h-2 rounded-full mt-2 ${alert.severity === 'critical' ? 'bg-red-500' : alert.severity === 'warning' ? 'bg-yellow-500' : 'bg-blue-500'}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{alert.message}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-muted-foreground font-mono">{alert.device_name}</span>
          <span className="text-xs text-muted-foreground">•</span>
          <span className="text-xs text-muted-foreground">{alert.client_name}</span>
        </div>
      </div>
      <Badge variant="outline" className={severityColors[alert.severity]}>
        {alert.severity}
      </Badge>
    </div>
  );
};

const RecentTicket = ({ ticket }) => {
  const priorityColors = {
    critical: "priority-critical",
    high: "priority-high",
    medium: "priority-medium",
    low: "priority-low"
  };

  const statusColors = {
    open: "bg-blue-500",
    in_progress: "bg-yellow-500",
    resolved: "bg-green-500"
  };

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-smooth border border-transparent hover:border-border">
      <div className={`w-2 h-2 rounded-full ${statusColors[ticket.status]}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{ticket.title}</p>
        <p className="text-xs text-muted-foreground truncate">{ticket.client_name}</p>
      </div>
      <Badge className={`${priorityColors[ticket.priority]} text-xs`}>
        {ticket.priority}
      </Badge>
    </div>
  );
};

export default function DashboardPage() {
  const { token } = useAuth();
  const [stats, setStats] = useState(null);
  const [ticketTrends, setTicketTrends] = useState([]);
  const [deviceHealth, setDeviceHealth] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);

  const headers = { Authorization: `Bearer ${token}` };

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const [statsRes, trendsRes, healthRes, alertsRes, ticketsRes] = await Promise.all([
        axios.get(`${API}/dashboard/stats`, { headers }),
        axios.get(`${API}/dashboard/ticket-trends`, { headers }),
        axios.get(`${API}/dashboard/device-health`, { headers }),
        axios.get(`${API}/alerts?status=active`, { headers }),
        axios.get(`${API}/tickets?status=open`, { headers })
      ]);
      
      setStats(statsRes.data);
      setTicketTrends(trendsRes.data);
      setDeviceHealth(healthRes.data);
      setAlerts(alertsRes.data);
      setTickets(ticketsRes.data.slice(0, 5));
    } catch (error) {
      console.error("Failed to fetch dashboard data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  if (loading || !stats) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
            <p className="text-muted-foreground">Loading...</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map(i => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="h-24 skeleton-shimmer rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8" data-testid="dashboard-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">Welcome to your command center</p>
        </div>
        <Button variant="outline" onClick={fetchDashboardData} data-testid="refresh-dashboard">
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Total Clients"
          value={stats.total_clients}
          icon={Users}
          iconBg="metric-icon-blue"
          iconColor="text-primary"
          trend="up"
          trendValue="+2 this month"
        />
        <StatCard
          title="Online Devices"
          value={`${stats.online_devices}/${stats.total_devices}`}
          icon={Monitor}
          iconBg="metric-icon-green"
          iconColor="text-green-500"
        />
        <StatCard
          title="Open Tickets"
          value={stats.open_tickets}
          icon={Ticket}
          iconBg="metric-icon-yellow"
          iconColor="text-yellow-500"
          trend={stats.open_tickets > 5 ? "up" : "down"}
          trendValue={stats.open_tickets > 5 ? "High volume" : "Under control"}
        />
        <StatCard
          title="Monthly Revenue"
          value={`$${stats.total_mrr.toLocaleString()}`}
          icon={DollarSign}
          iconBg="metric-icon-blue"
          iconColor="text-primary"
          trend="up"
          trendValue="+12% vs last month"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Ticket Trends Chart */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-lg font-semibold">Ticket Volume Trend</CardTitle>
            <Badge variant="outline" className="text-muted-foreground">Last 7 days</Badge>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={ticketTrends.length > 0 ? ticketTrends : [
                  { date: "Mon", tickets: 12 },
                  { date: "Tue", tickets: 19 },
                  { date: "Wed", tickets: 15 },
                  { date: "Thu", tickets: 22 },
                  { date: "Fri", tickets: 18 },
                  { date: "Sat", tickets: 8 },
                  { date: "Sun", tickets: 5 },
                ]}>
                  <defs>
                    <linearGradient id="ticketGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(217, 33%, 25%)" />
                  <XAxis 
                    dataKey="date" 
                    stroke="hsl(215, 20%, 65%)" 
                    fontSize={12}
                    tickLine={false}
                  />
                  <YAxis 
                    stroke="hsl(215, 20%, 65%)" 
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: 'hsl(217, 33%, 17%)',
                      border: '1px solid hsl(217, 33%, 25%)',
                      borderRadius: '8px',
                      color: 'hsl(210, 40%, 98%)'
                    }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="tickets" 
                    stroke="hsl(217, 91%, 60%)" 
                    strokeWidth={2}
                    fill="url(#ticketGradient)" 
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Device Health Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-semibold">System Health</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={deviceHealth.length > 0 ? deviceHealth : [
                      { name: "Online", value: stats.online_devices, color: "#22C55E" },
                      { name: "Warning", value: 2, color: "#EAB308" },
                      { name: "Offline", value: stats.offline_devices, color: "#EF4444" }
                    ]}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={70}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {(deviceHealth.length > 0 ? deviceHealth : [
                      { name: "Online", value: stats.online_devices, color: "#22C55E" },
                      { name: "Warning", value: 2, color: "#EAB308" },
                      { name: "Offline", value: stats.offline_devices, color: "#EF4444" }
                    ]).map((entry, index) => (
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
            <div className="flex justify-center gap-4 mt-2">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span className="text-xs text-muted-foreground">Online</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-yellow-500" />
                <span className="text-xs text-muted-foreground">Warning</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500" />
                <span className="text-xs text-muted-foreground">Offline</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Active Alerts */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-500" />
              Active Alerts
            </CardTitle>
            <Badge variant="destructive">{alerts.length}</Badge>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[280px]">
              <div className="space-y-2">
                {alerts.length > 0 ? alerts.map(alert => (
                  <AlertItem key={alert.id} alert={alert} />
                )) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>No active alerts</p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Recent Tickets */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Ticket className="w-5 h-5 text-primary" />
              Open Tickets
            </CardTitle>
            <Badge variant="secondary">{stats.open_tickets}</Badge>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[280px]">
              <div className="space-y-2">
                {tickets.length > 0 ? tickets.map(ticket => (
                  <RecentTicket key={ticket.id} ticket={ticket} />
                )) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Ticket className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>No open tickets</p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
