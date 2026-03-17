import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2, Wifi, WifiOff, AlertTriangle, CheckCircle, Search,
  Activity, Users, Server, RefreshCw, ArrowDownRight
} from "lucide-react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend
} from "recharts";

const STATUS_COLORS = {
  active: "#10b981",
  disabled: "#ef4444",
  pending: "#f59e0b",
  blocked: "#ef4444",
  stopped: "#dc2626",
  archived: "#6b7280",
};

export default function SplynxDashboardPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/splynx/overview`, { headers });
      setData(res.data);
    } catch {
      setData({ linked_clients: 0, total_services: 0, active_services: 0, suspended_services: 0, clients: [] });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
    </div>
  );

  const pendingServices = (data?.total_services || 0) - (data?.active_services || 0) - (data?.suspended_services || 0);
  const healthPercent = data?.total_services > 0 ? Math.round((data.active_services / data.total_services) * 100) : 0;

  const pieData = [
    { name: "Active", value: data?.active_services || 0, color: "#10b981" },
    { name: "Suspended", value: data?.suspended_services || 0, color: "#ef4444" },
    { name: "Other", value: Math.max(0, pendingServices), color: "#f59e0b" },
  ].filter(d => d.value > 0);

  const clientsWithIssues = (data?.clients || []).filter(c => c.suspended > 0);

  // Service type distribution
  const typeMap = {};
  (data?.clients || []).forEach(client => {
    (client.services || []).forEach(s => {
      const t = s.type || "other";
      if (!typeMap[t]) typeMap[t] = { active: 0, suspended: 0 };
      if (s.status === "active") typeMap[t].active++;
      else typeMap[t].suspended++;
    });
  });
  const barData = Object.entries(typeMap).map(([type, counts]) => ({
    name: type.charAt(0).toUpperCase() + type.slice(1),
    Active: counts.active,
    Suspended: counts.suspended,
  }));

  const filteredClients = (data?.clients || []).filter(c =>
    !search || c.client_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6" data-testid="splynx-dashboard">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">ISP Service Health</h1>
          <p className="text-muted-foreground">Splynx integration overview across all linked clients</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData} data-testid="refresh-splynx">
          <RefreshCw className="w-4 h-4 mr-1" />Refresh
        </Button>
      </div>

      {/* Top Stats */}
      <div className="grid grid-cols-5 gap-3">
        <Card data-testid="stat-health">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <p className={`text-3xl font-black ${healthPercent >= 90 ? "text-emerald-400" : healthPercent >= 70 ? "text-yellow-400" : "text-red-400"}`}>
                  {healthPercent}%
                </p>
                <p className="text-[11px] text-muted-foreground">Service Health</p>
              </div>
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${healthPercent >= 90 ? "bg-emerald-500/10" : healthPercent >= 70 ? "bg-yellow-500/10" : "bg-red-500/10"}`}>
                <Activity className={`w-6 h-6 ${healthPercent >= 90 ? "text-emerald-400" : healthPercent >= 70 ? "text-yellow-400" : "text-red-400"}`} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="stat-linked">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-3xl font-black">{data?.linked_clients || 0}</p>
                <p className="text-[11px] text-muted-foreground">Linked Clients</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center">
                <Users className="w-6 h-6 text-blue-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="stat-total-services">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-3xl font-black">{data?.total_services || 0}</p>
                <p className="text-[11px] text-muted-foreground">Total Services</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-indigo-500/10 flex items-center justify-center">
                <Server className="w-6 h-6 text-indigo-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="stat-active-services">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-3xl font-black text-emerald-400">{data?.active_services || 0}</p>
                <p className="text-[11px] text-muted-foreground">Active Services</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                <Wifi className="w-6 h-6 text-emerald-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className={data?.suspended_services > 0 ? "border-red-500/40" : ""} data-testid="stat-suspended">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <p className={`text-3xl font-black ${data?.suspended_services > 0 ? "text-red-400" : "text-muted-foreground"}`}>
                  {data?.suspended_services || 0}
                </p>
                <p className="text-[11px] text-muted-foreground">Suspended</p>
              </div>
              <div className={`w-12 h-12 rounded-xl ${data?.suspended_services > 0 ? "bg-red-500/10" : "bg-muted/30"} flex items-center justify-center`}>
                <WifiOff className={`w-6 h-6 ${data?.suspended_services > 0 ? "text-red-400" : "text-muted-foreground"}`} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Service Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
                    {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip formatter={(value) => [value, "Services"]} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-muted-foreground">No service data available</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Services by Type</CardTitle>
          </CardHeader>
          <CardContent>
            {barData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={barData}>
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="Active" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Suspended" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-muted-foreground">No service type data</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Clients Needing Attention */}
      {clientsWithIssues.length > 0 && (
        <Card className="border-red-500/30">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-400" />
              <CardTitle className="text-base text-red-400">Clients Needing Attention ({clientsWithIssues.length})</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {clientsWithIssues.map(client => (
                <div key={client.client_id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-red-500/5 border border-red-500/10" data-testid={`issue-client-${client.client_id}`}>
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-8 rounded-full bg-red-500" />
                    <div>
                      <p className="text-sm font-medium">{client.client_name}</p>
                      <p className="text-xs text-muted-foreground">Splynx ID: {client.splynx_id}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="flex items-center gap-1">
                        <ArrowDownRight className="w-3 h-3 text-red-400" />
                        <span className="text-sm font-bold text-red-400">{client.suspended} suspended</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{client.active} active of {client.total}</p>
                    </div>
                    <div className="flex gap-1">
                      {(client.services || []).map((s, i) => (
                        <div key={i} className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[s.status] || "#6b7280" }}
                          title={`${s.description}: ${s.status}`} />
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* All Clients */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">All Linked Clients</CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search clients..." value={search} onChange={e => setSearch(e.target.value)} data-testid="search-clients" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px]">
            <div className="space-y-1">
              {filteredClients.map(client => {
                const healthBar = client.total > 0 ? (client.active / client.total) * 100 : 0;
                return (
                  <div key={client.client_id} className="flex items-center justify-between py-3 px-3 rounded-lg hover:bg-muted/30 transition-colors border border-transparent hover:border-border"
                    data-testid={`client-row-${client.client_id}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-2.5 h-2.5 rounded-full ${client.has_suspended ? "bg-red-500 animate-pulse" : "bg-emerald-500"}`} />
                      <div>
                        <p className="text-sm font-medium">{client.client_name}</p>
                        <p className="text-xs text-muted-foreground">ID: {client.splynx_id}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-emerald-400 border-emerald-500/30 text-[10px]">
                          <CheckCircle className="w-3 h-3 mr-1" />{client.active} active
                        </Badge>
                        {client.suspended > 0 && (
                          <Badge variant="outline" className="text-red-400 border-red-500/30 text-[10px]">
                            <WifiOff className="w-3 h-3 mr-1" />{client.suspended} down
                          </Badge>
                        )}
                      </div>
                      <div className="w-24">
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${healthBar >= 90 ? "bg-emerald-500" : healthBar >= 50 ? "bg-yellow-500" : "bg-red-500"}`}
                            style={{ width: `${healthBar}%` }} />
                        </div>
                        <p className="text-[10px] text-muted-foreground text-right mt-0.5">{Math.round(healthBar)}%</p>
                      </div>
                    </div>
                  </div>
                );
              })}
              {filteredClients.length === 0 && (
                <div className="py-12 text-center text-muted-foreground">
                  {data?.linked_clients === 0
                    ? "No clients linked to Splynx. Link clients in the Clients page."
                    : "No clients match your search."
                  }
                </div>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
