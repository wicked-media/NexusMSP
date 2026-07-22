import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { MetricStrip, MetricTile } from "@/components/design-system";
import { BarChart3, CircleHelp, Clock3, DollarSign, Loader2, MoreHorizontal, RefreshCw, Route, ShoppingCart, TimerReset, Users } from "lucide-react";
import { toast } from "sonner";

export default function BenchmarkingPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (showToast = false) => {
    setRefreshing(true);
    try {
      const response = await axios.get(`${API}/benchmarking/overview`, { headers });
      setData(response.data);
      if (showToast) toast.success("Service performance refreshed");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Service performance could not be loaded");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [headers]);

  useEffect(() => { load(); }, [load]);
  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  const overall = data?.overall || {};
  const priorities = data?.resolution_times || {};
  const technicians = data?.tech_performance || [];

  return <div className="space-y-5" data-testid="benchmarking-page">
    <OperationalPageHeader eyebrow="Planning and lifecycle" title="Service Performance" description="Measured from your resolved tickets and SLA evidence. External industry claims are intentionally withheld until NexusMSP has an attributable configured source." icon={BarChart3} tone="sky" actions={<><DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="sm"><MoreHorizontal className="mr-1 h-4 w-4" />Workspace</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => navigate("/expiry-tracker")}><TimerReset className="mr-2 h-4 w-4" />Expiry Centre</DropdownMenuItem><DropdownMenuItem onClick={() => navigate("/procurement-planner")}><ShoppingCart className="mr-2 h-4 w-4" />Procurement Planner</DropdownMenuItem><DropdownMenuItem onClick={() => navigate("/client-budget")}><DollarSign className="mr-2 h-4 w-4" />Client IT Budgets</DropdownMenuItem><DropdownMenuItem onClick={() => navigate("/dispatch-board?tab=availability")}><Route className="mr-2 h-4 w-4" />Dispatch availability</DropdownMenuItem></DropdownMenuContent></DropdownMenu><Button size="sm" onClick={() => load(true)} disabled={refreshing}><RefreshCw className={`mr-1 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />Refresh evidence</Button></>} />
    <MetricStrip columns={5}>
      <MetricTile label="Resolved tickets" value={overall.total_resolved || 0} accent="emerald" icon={<BarChart3 />} testid="performance-resolved" />
      <MetricTile label="All tickets" value={overall.total_tickets || 0} accent="sky" icon={<Clock3 />} testid="performance-total" />
      <MetricTile label="SLA compliance" value={overall.sla_compliance == null ? "—" : `${overall.sla_compliance}%`} trend={overall.sla_sample_size ? `${overall.sla_sample_size} evaluated` : "No SLA evidence yet"} accent="amber" icon={<TimerReset />} testid="performance-sla" />
      <MetricTile label="Team average resolved" value={overall.team_average_resolved == null ? "—" : overall.team_average_resolved} accent="violet" icon={<Users />} testid="performance-average" />
      <MetricTile label="Technicians" value={technicians.length} accent="zinc" icon={<Users />} testid="performance-technicians" />
    </MetricStrip>
    <Card className="border-sky-500/15 bg-sky-500/[0.035]"><CardContent className="flex items-start gap-3 py-4 text-sm text-muted-foreground"><CircleHelp className="mt-0.5 h-5 w-5 shrink-0 text-sky-300" /><p>{data?.comparison_note || "External comparisons are unavailable until an attributable source is configured."}</p></CardContent></Card>
    <section><div className="mb-3"><h2 className="text-base font-semibold">Average time to resolution</h2><p className="mt-1 text-sm text-muted-foreground">Only resolved or closed tickets with both creation and resolution timestamps are included.</p></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{["critical", "high", "medium", "low"].map(priority => { const metric = priorities[priority] || {}; return <Card key={priority}><CardContent className="pt-5"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{priority}</p><p className="mt-2 text-2xl font-semibold">{metric.average_hours == null ? "—" : `${metric.average_hours}h`}</p><p className="mt-1 text-xs text-muted-foreground">{metric.sample_size || 0} completed ticket{metric.sample_size === 1 ? "" : "s"} with timing evidence</p></CardContent></Card>; })}</div></section>
    <Card><CardHeader className="pb-3"><CardTitle className="text-base">Technician workload evidence</CardTitle><p className="text-sm text-muted-foreground">Resolved counts are compared with the current internal team average, never a fabricated industry baseline.</p></CardHeader><CardContent className="space-y-2">{technicians.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">No technician records available.</div> : technicians.map(technician => { const hasBaseline = typeof technician.vs_team_average === "number"; return <div key={technician.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-muted/20 px-4 py-3"><div className="min-w-[180px] flex-1"><p className="font-medium">{technician.name}</p><p className="mt-0.5 text-xs text-muted-foreground">{technician.active} active ticket{technician.active === 1 ? "" : "s"}</p></div><div className="text-right"><p className="text-sm font-semibold">{technician.resolved} resolved</p><p className="mt-0.5 text-xs text-muted-foreground">{!hasBaseline ? "No team baseline" : `${technician.vs_team_average >= 0 ? "+" : ""}${technician.vs_team_average} vs internal average`}</p></div><Badge variant="outline" className={`text-[10px] ${!hasBaseline ? "border-border text-muted-foreground" : technician.vs_team_average >= 0 ? "border-emerald-500/25 text-emerald-300" : "border-amber-500/25 text-amber-300"}`}>{!hasBaseline ? "unavailable" : technician.vs_team_average >= 0 ? "above average" : "below average"}</Badge></div>; })}</CardContent></Card>
  </div>;
}
