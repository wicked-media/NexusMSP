import { useState, useEffect, useCallback, useMemo } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import HeroTile from "@/components/HeroTile";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import NexusBlackBox from "@/components/audit/NexusBlackBox";
import {
  ClipboardList, Search, Shield, Loader2, RefreshCw, AlertTriangle,
  Clock, Filter, Download, Activity,
  Lock, Ticket, DollarSign, Settings, Zap, Monitor, Users, Globe
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

export default function AuditTrailPage() {
  const { token } = useAuth();
  const [events, setEvents] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [sevFilter, setSevFilter] = useState("all");
  const [daysFilter, setDaysFilter] = useState("30");
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [exporting, setExporting] = useState(false);
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ days: daysFilter });
      if (catFilter !== "all") params.append("category", catFilter);
      if (sevFilter !== "all") params.append("severity", sevFilter);
      const [eRes, sRes] = await Promise.all([
        axios.get(`${API}/audit-trail/events?${params}`, { headers }),
        axios.get(`${API}/audit-trail/summary?${params}`, { headers }),
      ]);
      setEvents(eRes.data);
      setSummary(sRes.data);
    } catch { toast.error("Failed to load audit trail"); }
    finally { setLoading(false); }
  }, [headers, catFilter, sevFilter, daysFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = search
    ? events.filter(e => e.user?.toLowerCase().includes(search.toLowerCase()) || e.action?.toLowerCase().includes(search.toLowerCase()) || e.description?.toLowerCase().includes(search.toLowerCase()) || e.target?.toLowerCase().includes(search.toLowerCase()))
    : events;
  const filtersActive = Boolean(search) || catFilter !== "all" || sevFilter !== "all" || daysFilter !== "30";
  const clearFilters = () => { setSearch(""); setCatFilter("all"); setSevFilter("all"); setDaysFilter("30"); };

  const exportAudit = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ days: daysFilter });
      if (catFilter !== "all") params.append("category", catFilter);
      if (sevFilter !== "all") params.append("severity", sevFilter);
      if (search.trim()) params.append("search", search.trim());
      const response = await axios.get(`${API}/audit-trail/export?${params}`, { headers, responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `nexus-audit-trail-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Audit export downloaded");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Audit export could not be created");
    } finally {
      setExporting(false);
    }
  };

  // Build chart data from summary
  const catChartData = summary?.by_category?.slice(0, 8).map(c => ({ category: c.category, count: c.count })) || [];

  if (loading && !summary) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="space-y-5" data-testid="audit-trail-page">
      <OperationalPageHeader eyebrow="Governance and accountability" title="Audit Trail" description="Administrator-only, read-only operational evidence across tickets, assets, billing, security, and integrations." icon={ClipboardList} tone="amber" actions={<><Button variant="outline" size="sm" onClick={exportAudit} disabled={exporting} data-testid="export-audit-btn">{exporting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}Export CSV</Button><Button variant="outline" size="sm" onClick={fetchData} disabled={loading}><RefreshCw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button></>} />

      <NexusBlackBox headers={headers} />

      {/* HeroTile metric strip — shared with Dashboard, Tickets, and Devices */}
      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <HeroTile label="Total events" value={summary.total_events} icon={Activity} glow="violet" subtitle={`Last ${summary.window_days || daysFilter} days`} testId="audit-stat-total" />
          <HeroTile label="Last 24h" value={summary.last_24h} icon={Clock} glow="cyan" subtitle={`${summary.trend === "up" ? "Up" : summary.trend === "down" ? "Down" : "Level"} from previous day`} testId="audit-stat-24h" />
          <HeroTile label="Critical" value={summary.by_severity?.critical || 0} icon={AlertTriangle} glow={(summary.by_severity?.critical || 0) > 0 ? "rose" : "emerald"} subtitle="Requires review" testId="audit-stat-critical" />
          <HeroTile label="Warnings" value={summary.by_severity?.warning || 0} icon={AlertTriangle} glow={(summary.by_severity?.warning || 0) > 0 ? "amber" : "emerald"} subtitle="Needs attention" testId="audit-stat-warnings" />
          <HeroTile label="Active users" value={summary.by_user?.length || 0} icon={Users} glow="emerald" subtitle="Recorded actors" testId="audit-stat-users" />
          <HeroTile label="Categories" value={summary.by_category?.length || 0} icon={Filter} glow="indigo" subtitle="Activity sources" testId="audit-stat-categories" />
        </div>
      )}

      {/* Category Chart + Category Breakdown */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_350px]">
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
      <div className="rounded-2xl border border-border/60 bg-card/40 p-3 md:p-4" data-testid="audit-filter-bar">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold">Explore activity</p><p className="text-xs text-muted-foreground">Filter recorded events without losing context.</p></div><div className="flex items-center gap-2"><Badge variant="outline" className="text-xs">{filtered.length} events</Badge>{filtersActive && <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={clearFilters} data-testid="clear-audit-filters">Clear filters</Button>}</div></div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_150px_130px_120px]">
        <div className="relative"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input placeholder="Search events, users, actions..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" data-testid="audit-search" /></div>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All Categories</SelectItem>{(summary?.categories || []).map(c => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={sevFilter} onValueChange={setSevFilter}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All Severity</SelectItem><SelectItem value="critical">Critical</SelectItem><SelectItem value="warning">Warning</SelectItem><SelectItem value="info">Info</SelectItem></SelectContent>
        </Select>
        <Select value={daysFilter} onValueChange={setDaysFilter}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="7">Last 7 days</SelectItem><SelectItem value="30">Last 30 days</SelectItem><SelectItem value="90">Last 90 days</SelectItem><SelectItem value="365">Last year</SelectItem></SelectContent>
        </Select>
        </div>
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
                  <button key={e.id} type="button" onClick={() => setSelectedEvent(e)} className="flex w-full items-center gap-3 rounded-lg border border-transparent p-2.5 text-left transition-all hover:border-border/40 hover:bg-muted/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 group" data-testid={`audit-${e.id}`}>
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
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
      <Dialog open={Boolean(selectedEvent)} onOpenChange={(open) => !open && setSelectedEvent(null)}><DialogContent className="max-w-2xl" data-testid="audit-event-detail"><DialogHeader><DialogTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5 text-amber-300" />Audit event detail</DialogTitle></DialogHeader>{selectedEvent && <div className="space-y-4 text-sm"><div className="grid gap-3 sm:grid-cols-2"><div><p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Actor</p><p className="mt-1 font-medium">{selectedEvent.user}</p></div><div><p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Recorded</p><p className="mt-1">{new Date(selectedEvent.timestamp).toLocaleString()}</p></div><div><p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Action</p><p className="mt-1 capitalize">{selectedEvent.action?.replace(/_/g, " ")}</p></div><div><p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Target</p><p className="mt-1 break-all">{selectedEvent.target || "System"}</p></div></div><div className="rounded-lg border border-border/80 bg-muted/10 p-3"><p className="font-medium">{selectedEvent.description}</p><div className="mt-2 flex flex-wrap gap-2"><Badge variant="outline" className={SEV_COLORS[selectedEvent.severity] || SEV_COLORS.info}>{selectedEvent.severity}</Badge><Badge variant="outline">{selectedEvent.category}</Badge><Badge variant="outline">{selectedEvent.source?.replace(/_/g, " ")}</Badge></div></div>{Object.keys(selectedEvent.changes || {}).length > 0 && <div><p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Recorded changes</p><pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-border/70 bg-muted/20 p-3 text-xs">{JSON.stringify(selectedEvent.changes, null, 2)}</pre></div>}{Object.keys(selectedEvent.metadata || {}).length > 0 && <div><p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Supporting metadata</p><pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-border/70 bg-muted/20 p-3 text-xs">{JSON.stringify(selectedEvent.metadata, null, 2)}</pre></div>}<p className="text-xs text-muted-foreground">Entity: {selectedEvent.entity_type || "system"}{selectedEvent.entity_id ? ` / ${selectedEvent.entity_id}` : ""}</p></div>}</DialogContent></Dialog>
    </div>
  );
}
