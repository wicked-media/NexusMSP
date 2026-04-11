import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  ClipboardList, Search, Shield, User, Loader2, RefreshCw, AlertTriangle,
  Clock, TrendingUp, TrendingDown, Filter, Download, Activity,
  Lock, Ticket, DollarSign, Settings, Zap, Monitor, Users, Globe, ArrowUp, ArrowDown
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const chartStyle = { backgroundColor: "hsl(217, 33%, 17%)", border: "1px solid hsl(217, 33%, 25%)", borderRadius: "8px", color: "hsl(210, 40%, 98%)" };

const CAT_COLORS = {
  auth: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  security: "bg-red-500/15 text-red-400 border-red-500/20",
  tickets: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  billing: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  clients: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
  automation: "bg-purple-500/15 text-purple-400 border-purple-500/20",
  monitoring: "bg-orange-500/15 text-orange-400 border-orange-500/20",
  devices: "bg-sky-500/15 text-sky-400 border-sky-500/20",
  admin: "bg-pink-500/15 text-pink-400 border-pink-500/20",
  integrations: "bg-violet-500/15 text-violet-400 border-violet-500/20",
};
const CAT_ICONS = {
  auth: Lock, security: Shield, tickets: Ticket, billing: DollarSign,
  clients: Users, automation: Zap, monitoring: Monitor, devices: Monitor,
  admin: Settings, integrations: Globe,
};
const SEV_COLORS = {
  critical: "bg-red-500/20 text-red-400 border-red-500/30",
  warning: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  info: "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

function exportCSV(data) {
  if (!data?.length) { toast.error("No data"); return; }
  const headers = ["timestamp", "user", "category", "action", "severity", "description", "target", "ip_address"];
  const csv = [headers.join(","), ...data.map(e => headers.map(h => { const v = e[h] || ""; return typeof v === "string" && v.includes(",") ? `"${v}"` : v; }).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "audit_trail.csv"; a.click();
  toast.success(`Exported ${data.length} events`);
}

export default function AuditTrailPage() {
  const { token } = useAuth();
  const [events, setEvents] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [sevFilter, setSevFilter] = useState("all");
  const [daysFilter, setDaysFilter] = useState("30");
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ days: daysFilter });
      if (catFilter !== "all") params.append("category", catFilter);
      if (sevFilter !== "all") params.append("severity", sevFilter);
      const [eRes, sRes] = await Promise.all([
        axios.get(`${API}/audit-trail/events?${params}`, { headers }),
        axios.get(`${API}/audit-trail/summary`, { headers }),
      ]);
      setEvents(eRes.data);
      setSummary(sRes.data);
    } catch { toast.error("Failed to load audit trail"); }
    finally { setLoading(false); }
  }, [token, catFilter, sevFilter, daysFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = search
    ? events.filter(e => e.user?.toLowerCase().includes(search.toLowerCase()) || e.action?.toLowerCase().includes(search.toLowerCase()) || e.description?.toLowerCase().includes(search.toLowerCase()) || e.target?.toLowerCase().includes(search.toLowerCase()))
    : events;

  // Build chart data from summary
  const catChartData = summary?.by_category?.slice(0, 8).map(c => ({ category: c.category, count: c.count })) || [];

  if (loading && !summary) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="space-y-5" data-testid="audit-trail-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center"><ClipboardList className="w-5 h-5 text-white" /></div>
            Audit Trail
          </h1>
          <p className="text-muted-foreground mt-1">Complete system activity log with compliance-grade event tracking</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => exportCSV(filtered)} data-testid="export-audit-btn"><Download className="w-4 h-4 mr-1" />Export CSV</Button>
          <Button variant="outline" size="sm" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
        </div>
      </div>

      {/* Stats Row */}
      {summary && (
        <div className="grid grid-cols-6 gap-3">
          <Card className="border-border/40">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-1"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Events</p><Activity className="w-4 h-4 text-foreground" /></div>
              <p className="text-2xl font-bold">{summary.total_events}</p>
            </CardContent>
          </Card>
          <Card className="border-border/40">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-1"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Last 24h</p><Clock className="w-4 h-4 text-blue-400" /></div>
              <p className="text-2xl font-bold text-blue-400">{summary.last_24h}</p>
              <div className="flex items-center gap-1 mt-0.5">
                {summary.trend === "up" ? <ArrowUp className="w-3 h-3 text-red-400" /> : <ArrowDown className="w-3 h-3 text-emerald-400" />}
                <span className="text-[10px] text-muted-foreground">vs {summary.prev_24h} prev</span>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/40">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-1"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Critical</p><AlertTriangle className="w-4 h-4 text-red-400" /></div>
              <p className="text-2xl font-bold text-red-400">{summary.by_severity?.critical || 0}</p>
            </CardContent>
          </Card>
          <Card className="border-border/40">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-1"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Warnings</p><AlertTriangle className="w-4 h-4 text-amber-400" /></div>
              <p className="text-2xl font-bold text-amber-400">{summary.by_severity?.warning || 0}</p>
            </CardContent>
          </Card>
          <Card className="border-border/40 col-span-2">
            <CardContent className="pt-4 pb-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Top Users</p>
              <div className="flex flex-wrap gap-2">
                {summary.by_user?.slice(0, 5).map(u => (
                  <Badge key={u.user} variant="outline" className="gap-1 text-[10px]">
                    <User className="w-2.5 h-2.5" />{u.user}: {u.count}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Category Chart + Category Breakdown */}
      <div className="grid grid-cols-[1fr_350px] gap-4">
        <Card className="border-border/40">
          <CardHeader className="pb-1"><CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Events by Category</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[200px]"><ResponsiveContainer width="100%" height="100%">
              <BarChart data={catChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="category" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} />
                <Tooltip contentStyle={chartStyle} />
                <Bar dataKey="count" fill="#3B82F6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer></div>
          </CardContent>
        </Card>
        <Card className="border-border/40">
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Category Breakdown</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {summary?.by_category?.map(c => {
              const CatIcon = CAT_ICONS[c.category] || Activity;
              return (
                <div key={c.category} className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/20 cursor-pointer" onClick={() => setCatFilter(catFilter === c.category ? "all" : c.category)}>
                  <CatIcon className="w-3.5 h-3.5" />
                  <span className="text-xs flex-1 capitalize">{c.category}</span>
                  <Badge className={`text-[9px] ${CAT_COLORS[c.category] || ""}`}>{c.count}</Badge>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-center">
        <div className="relative flex-1 max-w-sm"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input placeholder="Search events, users, actions..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" data-testid="audit-search" /></div>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All Categories</SelectItem>{(summary?.categories || []).map(c => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={sevFilter} onValueChange={setSevFilter}>
          <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All Severity</SelectItem><SelectItem value="critical">Critical</SelectItem><SelectItem value="warning">Warning</SelectItem><SelectItem value="info">Info</SelectItem></SelectContent>
        </Select>
        <Select value={daysFilter} onValueChange={setDaysFilter}>
          <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="7">Last 7 days</SelectItem><SelectItem value="30">Last 30 days</SelectItem><SelectItem value="90">Last 90 days</SelectItem><SelectItem value="365">Last year</SelectItem></SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} events</span>
      </div>

      {/* Event Timeline */}
      <Card className="border-border/40">
        <CardContent className="p-0">
          <ScrollArea className="h-[500px]">
            <div className="p-3 space-y-1">
              {loading ? (
                <div className="flex items-center justify-center h-32"><Loader2 className="w-6 h-6 animate-spin" /></div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground"><ClipboardList className="w-10 h-10 mx-auto mb-2 opacity-30" /><p>No events found</p></div>
              ) : filtered.map(e => {
                const CatIcon = CAT_ICONS[e.category] || Activity;
                return (
                  <div key={e.id} className="flex items-center gap-3 p-2.5 rounded-lg border border-transparent hover:border-border/40 hover:bg-muted/10 transition-all group" data-testid={`audit-${e.id}`}>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${CAT_COLORS[e.category]?.split(" ")[0] || "bg-muted/20"}`}>
                      <CatIcon className="w-4 h-4" />
                    </div>
                    <Badge className={`text-[9px] w-[65px] justify-center flex-shrink-0 ${SEV_COLORS[e.severity] || SEV_COLORS.info}`}>{e.severity}</Badge>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm"><strong>{e.user}</strong> <span className="text-muted-foreground">{e.action?.replace(/_/g, " ")}</span></p>
                      <p className="text-[11px] text-muted-foreground truncate">{e.description}</p>
                    </div>
                    {e.target && <Badge variant="outline" className="text-[9px] font-mono flex-shrink-0">{e.target}</Badge>}
                    <div className="text-right flex-shrink-0">
                      <p className="text-[10px] text-muted-foreground whitespace-nowrap">{new Date(e.timestamp).toLocaleDateString()}</p>
                      <p className="text-[9px] text-muted-foreground/60">{new Date(e.timestamp).toLocaleTimeString()}</p>
                    </div>
                    {e.ip_address && <span className="text-[9px] text-muted-foreground/40 font-mono opacity-0 group-hover:opacity-100 transition-opacity">{e.ip_address}</span>}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
