import { useState, useEffect, useCallback, useMemo } from "react";
import axios from "axios";
import { Link, useNavigate } from "react-router-dom";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Loader2, Settings, Zap, MessageSquare, Clock, DollarSign, CheckCircle,
  AlertTriangle, RefreshCw, Activity, Search, ShieldCheck, Eye, ChevronRight
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { WorkspaceErrorState, WorkspaceLoadingState } from "@/components/WorkspaceState";

const SOC_SURFACE = "overflow-hidden rounded-2xl border border-border/70 bg-card/90 shadow-[0_18px_45px_-34px_rgba(0,0,0,0.95)]";

export function SmartAutomationPage() {
  const { token } = useAuth();
  const [settings, setSettings] = useState(null);
  const [recon, setRecon] = useState(null);
  const [loading, setLoading] = useState(true);
  const [thankYouResult, setThankYouResult] = useState(null);
  const [staleResult, setStaleResult] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsRes, reconRes] = await Promise.all([
        axios.get(`${API}/automation/settings`, { headers }),
        axios.get(`${API}/automation/billing-recon`, { headers }),
      ]);
      setSettings(settingsRes.data);
      setRecon(reconRes.data);
    } catch { toast.error("Failed to load"); }
    finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const saveSettings = async () => {
    try {
      await axios.put(`${API}/automation/settings`, settings, { headers });
      toast.success("Settings saved");
    } catch { toast.error("Failed to save"); }
  };

  const runThankYou = async () => {
    setActionLoading("thank_you");
    try {
      const res = await axios.post(`${API}/automation/check-thank-you`, {}, { headers });
      setThankYouResult(res.data);
      toast.success(res.data.message);
    } catch { toast.error("Failed"); }
    finally { setActionLoading(null); }
  };

  const runStaleCheck = async () => {
    setActionLoading("stale");
    try {
      const res = await axios.post(`${API}/automation/check-stale-tickets`, {}, { headers });
      setStaleResult(res.data);
      toast.success(res.data.message);
    } catch { toast.error("Failed"); }
    finally { setActionLoading(null); }
  };

  if (loading || !settings) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const reconSummary = recon?.summary || {};

  return (
    <div className="space-y-6" data-testid="smart-automation">
      <OperationalPageHeader
        eyebrow="Automation · governed ticket and billing signals"
        title="Smart Automation"
        description="Review suggested routine work and billing variance before an approved workflow makes a customer-facing change."
        icon={Zap}
        tone="cyan"
        signal={(reconSummary.potential_revenue_loss || 0) > 0 ? "attention" : "steady"}
        actions={<Button asChild variant="outline" size="sm" className="rounded-xl"><Link to="/automation-hub">Automation hub<ChevronRight className="ml-1.5 h-3.5 w-3.5" /></Link></Button>}
      />

      <div className="grid grid-cols-12 gap-6">
        {/* Automation Settings */}
        <div className="col-span-5 space-y-4">
          <Card data-testid="automation-settings">
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Settings className="w-4 h-4" />Automation Settings</CardTitle></CardHeader>
            <CardContent className="space-y-5">
              {/* Thank You Detection */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div><Label className="text-sm font-semibold flex items-center gap-2"><MessageSquare className="w-4 h-4 text-green-400" />Thank You Detection</Label><p className="text-xs text-muted-foreground mt-0.5">Auto-close tickets with thank-you replies</p></div>
                  <Switch checked={settings.thank_you_detection} onCheckedChange={v => setSettings({ ...settings, thank_you_detection: v })} data-testid="toggle-thank-you" />
                </div>
                <div><Label className="text-xs">Keywords (comma-separated)</Label><Input value={(settings.thank_you_keywords || []).join(", ")} onChange={e => setSettings({ ...settings, thank_you_keywords: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })} className="text-sm" data-testid="thank-you-keywords" /></div>
                <Button size="sm" onClick={runThankYou} disabled={actionLoading === "thank_you"} data-testid="run-thank-you">
                  {actionLoading === "thank_you" ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Zap className="w-3 h-3 mr-1" />}Run Now
                </Button>
                {thankYouResult && <div className="p-2 rounded bg-green-500/10 border border-green-500/20 text-xs text-green-400">Scanned {thankYouResult.scanned} tickets, auto-closed {thankYouResult.closed}</div>}
              </div>
              <Separator />
              {/* Stale Ticket Reminders */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div><Label className="text-sm font-semibold flex items-center gap-2"><Clock className="w-4 h-4 text-amber-400" />Stale Ticket Reminders</Label><p className="text-xs text-muted-foreground mt-0.5">Auto-ping clients on inactive tickets</p></div>
                  <Switch checked={settings.stale_ticket_enabled} onCheckedChange={v => setSettings({ ...settings, stale_ticket_enabled: v })} data-testid="toggle-stale" />
                </div>
                <div className="flex items-center gap-2"><Label className="text-xs whitespace-nowrap">Stale after</Label><Input type="number" min="1" max="30" value={settings.stale_ticket_days} onChange={e => setSettings({ ...settings, stale_ticket_days: parseInt(e.target.value) || 3 })} className="w-16 text-sm" /><span className="text-xs text-muted-foreground">days</span></div>
                <Button size="sm" onClick={runStaleCheck} disabled={actionLoading === "stale"} data-testid="run-stale-check">
                  {actionLoading === "stale" ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}Check Now
                </Button>
                {staleResult && <div className="p-2 rounded bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400">Found {staleResult.stale_count} stale tickets, pinged {staleResult.pinged}</div>}
              </div>
              <Separator />
              <Button onClick={saveSettings} className="w-full" data-testid="save-automation-settings">Save Settings</Button>
            </CardContent>
          </Card>
        </div>

        {/* Billing Reconciliation */}
        <div className="col-span-7 space-y-4">
          <Card data-testid="billing-recon">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2"><DollarSign className="w-4 h-4 text-green-400" />Billing Reconciliation</CardTitle>
                <Button variant="outline" size="sm" onClick={fetchData}><RefreshCw className="w-3 h-3 mr-1" />Refresh</Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-4 gap-3">
                <div className="p-2 rounded-lg bg-muted/20 text-center"><p className="text-[10px] text-muted-foreground">Clients</p><p className="text-lg font-bold">{reconSummary.total_clients || 0}</p></div>
                <div className="p-2 rounded-lg bg-green-500/10 text-center"><p className="text-[10px] text-muted-foreground">Matched</p><p className="text-lg font-bold text-green-400">{reconSummary.matched || 0}</p></div>
                <div className="p-2 rounded-lg bg-amber-500/10 text-center"><p className="text-[10px] text-muted-foreground">Over</p><p className="text-lg font-bold text-amber-400">{reconSummary.over_provisioned || 0}</p></div>
                <div className="p-2 rounded-lg bg-red-500/10 text-center"><p className="text-[10px] text-muted-foreground">Under</p><p className="text-lg font-bold text-red-400">{reconSummary.under_provisioned || 0}</p></div>
              </div>
              {(reconSummary.potential_revenue_loss || 0) > 0 && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-400" />
                  <div><p className="text-sm font-medium text-red-400">Potential Revenue Loss</p><p className="text-xs text-muted-foreground">${reconSummary.potential_revenue_loss} from {reconSummary.total_over_agents} unbilled agents</p></div>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Client</TableHead><TableHead className="text-right">Contracted</TableHead><TableHead className="text-right">Actual</TableHead><TableHead className="text-right">Diff</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Impact</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(recon?.reconciliation || []).length === 0 ? <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground text-sm">No reconciliation data</TableCell></TableRow> :
                  (recon?.reconciliation || []).map((r, i) => (
                    <TableRow key={`k-${i}`} className={r.status === "over" ? "bg-amber-500/5" : r.status === "under" ? "bg-red-500/5" : ""} data-testid={`recon-${i}`}>
                      <TableCell className="font-medium text-sm">{r.client_name}</TableCell>
                      <TableCell className="text-right font-mono">{r.contracted_seats}</TableCell>
                      <TableCell className="text-right font-mono">{r.actual_agents}</TableCell>
                      <TableCell className="text-right font-mono font-bold">
                        <span className={r.difference > 0 ? "text-amber-400" : r.difference < 0 ? "text-red-400" : "text-green-400"}>
                          {r.difference > 0 ? "+" : ""}{r.difference}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] ${r.status === "match" ? "bg-green-500/20 text-green-400" : r.status === "over" ? "bg-amber-500/20 text-amber-400" : "bg-red-500/20 text-red-400"}`}>
                          {r.status === "match" ? <CheckCircle className="w-3 h-3 mr-1" /> : <AlertTriangle className="w-3 h-3 mr-1" />}
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className={`text-right font-mono text-xs ${r.revenue_impact > 0 ? "text-amber-400" : r.revenue_impact < 0 ? "text-green-400" : ""}`}>${r.revenue_impact.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

const REALTIME_SEVERITY = {
  critical: { label: "Critical", className: "border-rose-400/35 bg-rose-400/[0.1] text-rose-200", dot: "bg-rose-400" },
  high: { label: "High", className: "border-orange-400/35 bg-orange-400/[0.1] text-orange-200", dot: "bg-orange-400" },
  medium: { label: "Medium", className: "border-amber-400/35 bg-amber-400/[0.1] text-amber-200", dot: "bg-amber-400" },
  low: { label: "Low", className: "border-sky-400/35 bg-sky-400/[0.1] text-sky-200", dot: "bg-sky-400" },
  unknown: { label: "Unclassified", className: "border-border/80 bg-muted/30 text-muted-foreground", dot: "bg-muted-foreground" },
};

const REALTIME_STATUS = {
  new: { label: "New", className: "bg-rose-400/[0.12] text-rose-200" },
  investigating: { label: "Investigating", className: "bg-amber-400/[0.12] text-amber-200" },
  blocked: { label: "Containment recorded", className: "bg-emerald-400/[0.12] text-emerald-200" },
  resolved: { label: "Resolved", className: "bg-emerald-400/[0.12] text-emerald-200" },
  observed: { label: "Observed", className: "bg-sky-400/[0.12] text-sky-200" },
};

function relativeRealtimeTime(value) {
  if (!value || Number.isNaN(new Date(value).getTime())) return "Time not recorded";
  return formatDistanceToNow(new Date(value), { addSuffix: true });
}

function eventText(value, fallback) {
  return ["string", "number", "boolean"].includes(typeof value) && String(value).trim() ? String(value) : fallback;
}

function normaliseRealtimeEvent(event, index) {
  const severityValue = String(event?.severity || event?.risk || "unknown").toLowerCase();
  const severity = REALTIME_SEVERITY[severityValue] ? severityValue : "unknown";
  const sourceStatus = String(event?.status || (event?.action === "blocked" ? "blocked" : "observed")).toLowerCase();
  const status = REALTIME_STATUS[sourceStatus] ? sourceStatus : "observed";
  const title = eventText(event?.title || event?.event_name || event?.type || event?.message, "Observed security signal");
  return {
    ...event,
    id: eventText(event?.id || event?.event_id, `${event?.timestamp || event?.created_at || "event"}-${index}`),
    title,
    severity,
    status,
    source: eventText(event?.source || event?.provider, "Nexus recorded evidence"),
    endpoint: eventText(event?.hostname || event?.agent_hostname || event?.device_name || event?.endpoint, "No endpoint recorded"),
    deviceId: eventText(event?.device_id, ""),
    client: eventText(event?.client_name || event?.organization || event?.organization_name || event?.tenant_name, "Scope controlled"),
    timestamp: event?.timestamp || event?.created_at || event?.detected_at || null,
    detail: eventText(event?.description || event?.details || event?.message, "No additional evidence detail was recorded."),
    action: eventText(event?.action, "observed"),
  };
}

function RealtimeMetric({ label, value, description, tone = "zinc", onClick, selected }) {
  const tones = {
    rose: "border-rose-400/30 bg-rose-400/[0.055] text-rose-200",
    amber: "border-amber-400/30 bg-amber-400/[0.055] text-amber-200",
    emerald: "border-emerald-400/30 bg-emerald-400/[0.055] text-emerald-200",
    zinc: "border-border/70 bg-card/90 text-foreground",
  };
  return (
    <button type="button" onClick={onClick} aria-pressed={selected} className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70">
      <Card className={`${SOC_SURFACE} h-full transition-all hover:-translate-y-0.5 ${tones[tone]} ${selected ? "ring-1 ring-primary/60" : ""}`}>
        <CardContent className="p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p><p className="mt-1 text-xs text-muted-foreground">{description}</p></CardContent>
      </Card>
    </button>
  );
}

export default function SocRealtimePage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [events, setEvents] = useState([]);
  const [feedType, setFeedType] = useState("polling");
  const [evidenceState, setEvidenceState] = useState("recorded_events_only");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [selectedEvent, setSelectedEvent] = useState(null);

  const loadEvents = useCallback(async ({ background = false } = {}) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    setLoadError("");
    try {
      const response = await axios.get(`${API}/soc-realtime/events`, { headers });
      const rawEvents = Array.isArray(response.data?.events) ? response.data.events : [];
      setEvents(rawEvents.map(normaliseRealtimeEvent));
      setFeedType(response.data?.feed_type || "polling");
      setEvidenceState(response.data?.evidence_state || "recorded_events_only");
      setLastRefreshed(new Date());
    } catch (error) {
      setLoadError(error?.response?.data?.detail || error?.message || "Nexus could not retrieve recorded SOC event evidence. No response action has been attempted.");
      if (!background) toast.error("SOC realtime evidence is unavailable. You can retry safely.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [headers]);

  useEffect(() => {
    loadEvents();
    const intervalId = window.setInterval(() => loadEvents({ background: true }), 30000);
    return () => window.clearInterval(intervalId);
  }, [loadEvents]);

  const filteredEvents = events
    .filter((event) => severityFilter === "all" || event.severity === severityFilter)
    .filter((event) => statusFilter === "all" || event.status === statusFilter)
    .filter((event) => actionFilter === "all" || event.action === actionFilter)
    .filter((event) => !search.trim() || [event.title, event.source, event.endpoint, event.client, event.detail].some((value) => String(value || "").toLowerCase().includes(search.trim().toLowerCase())));

  const counts = {
    critical: events.filter((event) => event.severity === "critical" && !["resolved", "blocked"].includes(event.status)).length,
    investigating: events.filter((event) => event.status === "investigating").length,
    blocked: events.filter((event) => event.action === "blocked" || event.status === "blocked").length,
  };
  const filtersActive = Boolean(search.trim() || severityFilter !== "all" || statusFilter !== "all" || actionFilter !== "all");
  const clearFilters = () => { setSearch(""); setSeverityFilter("all"); setStatusFilter("all"); setActionFilter("all"); };

  if (loading && !lastRefreshed) return <WorkspaceLoadingState className="mt-4" label="Loading scoped SOC realtime evidence…" />;
  if (!loading && loadError && events.length === 0) return <WorkspaceErrorState className="mt-4" title="SOC realtime evidence is unavailable" description={loadError} onRetry={loadEvents} retryLabel="Retry SOC evidence" onSecondaryAction={() => navigate("/security-dashboard")} secondaryLabel="Open Security Dashboard" />;

  return (
    <div className="space-y-5" data-testid="soc-realtime">
      <OperationalPageHeader
        eyebrow="Security operations · timed evidence snapshots"
        title="SOC Realtime"
        description="A continuously refreshed, scoped view of recorded security signals. Response work remains in governed SOC workflows."
        icon={Activity}
        tone="amber"
        signal={counts.critical > 0 ? "critical" : counts.investigating > 0 ? "attention" : "steady"}
        actions={<><Button asChild variant="outline" size="sm" className="rounded-xl"><Link to="/soc-feed">SOC alert feed<ChevronRight className="ml-1.5 h-3.5 w-3.5" /></Link></Button><Button size="sm" className="rounded-xl" onClick={() => loadEvents({ background: true })} disabled={refreshing} data-testid="soc-realtime-refresh"><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />Refresh snapshot</Button></>}
      />

      <Card className={`${SOC_SURFACE} border-amber-400/20 bg-amber-400/[0.035]`} data-testid="soc-realtime-evidence-state">
        <CardContent className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-300">Signal freshness</p><p className="mt-1 text-sm font-medium">This is a {feedType === "polling" ? "polling" : feedType} evidence view, not an endpoint-health guarantee.</p><p className="mt-1 text-xs text-muted-foreground">Nexus refreshes this scope every 30 seconds while it is open. Missing or delayed events remain uncertainty, not an all-clear.</p></div>
          <div className="flex flex-wrap gap-2"><Badge variant="outline" className="border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-200">Scoped evidence · available</Badge><Badge variant="outline" className="text-muted-foreground">{evidenceState === "recorded_events_only" ? "Stored evidence only" : "Evidence state not classified"}</Badge><Badge variant="outline" className="text-muted-foreground">{lastRefreshed ? `Refreshed ${relativeRealtimeTime(lastRefreshed)}` : "Refresh time not recorded"}</Badge></div>
        </CardContent>
      </Card>

      {loadError && <Card className={`${SOC_SURFACE} border-amber-400/25 bg-amber-400/[0.04]`}><CardContent className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium">The last refresh did not complete</p><p className="mt-1 text-xs text-muted-foreground">{loadError} Previously retrieved evidence remains visible below.</p></div><Button size="sm" variant="outline" onClick={() => loadEvents({ background: true })}>Retry refresh</Button></CardContent></Card>}

      <div className="grid gap-3 sm:grid-cols-3" aria-label="SOC realtime summary">
        <RealtimeMetric label="Critical now" value={counts.critical} description="Open critical signals" tone="rose" selected={severityFilter === "critical"} onClick={() => { setSeverityFilter("critical"); setStatusFilter("all"); setActionFilter("all"); }} />
        <RealtimeMetric label="Under investigation" value={counts.investigating} description="Needs a documented response" tone="amber" selected={statusFilter === "investigating"} onClick={() => { setStatusFilter("investigating"); setSeverityFilter("all"); setActionFilter("all"); }} />
        <RealtimeMetric label="Containment recorded" value={counts.blocked} description="Recorded, not automatically verified" tone="emerald" selected={actionFilter === "blocked"} onClick={() => { setActionFilter("blocked"); setSeverityFilter("all"); setStatusFilter("all"); }} />
      </div>

      <Card className={SOC_SURFACE}>
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-end lg:justify-between">
          <div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-300">Live evidence queue</p><p className="mt-1 text-sm font-medium">{filteredEvents.length} of {events.length} recorded event{events.length === 1 ? "" : "s"} shown</p><p className="mt-1 text-xs text-muted-foreground">Event totals are limited to the server-recorded snapshot returned for this client scope.</p></div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"><div className="relative min-w-0 sm:w-72"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Search signal, source, endpoint or client" value={search} onChange={(event) => setSearch(event.target.value)} data-testid="soc-realtime-search" /></div><Select value={severityFilter} onValueChange={setSeverityFilter}><SelectTrigger className="w-full sm:w-[142px]" aria-label="Filter realtime events by severity"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All severity</SelectItem><SelectItem value="critical">Critical</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent></Select><Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-full sm:w-[156px]" aria-label="Filter realtime events by status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All states</SelectItem><SelectItem value="new">New</SelectItem><SelectItem value="investigating">Investigating</SelectItem><SelectItem value="blocked">Containment recorded</SelectItem><SelectItem value="resolved">Resolved</SelectItem><SelectItem value="observed">Observed</SelectItem></SelectContent></Select>{filtersActive && <Button variant="ghost" size="sm" className="text-xs" onClick={clearFilters} data-testid="soc-realtime-clear-filters">Clear filters</Button>}</div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {filteredEvents.length === 0 ? (
          <Card className={`${SOC_SURFACE} border-dashed`} data-testid="soc-realtime-empty-state"><CardContent className="flex min-h-72 flex-col items-center justify-center px-6 py-12 text-center">{filtersActive ? <><Search className="h-8 w-8 text-muted-foreground" /><p className="mt-4 text-sm font-semibold">No recorded events match this view</p><p className="mt-1 max-w-md text-sm text-muted-foreground">Broaden the filters or clear them to return to the complete scoped event snapshot.</p><Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>Clear filters</Button></> : <><ShieldCheck className="h-9 w-9 text-emerald-300" /><p className="mt-4 text-sm font-semibold">No realtime event evidence recorded in this scope</p><p className="mt-1 max-w-lg text-sm text-muted-foreground">Nexus has no stored realtime event evidence to show. This does not prove every source, endpoint, or provider is healthy.</p><div className="mt-4 flex flex-wrap justify-center gap-2"><Button asChild size="sm"><Link to="/security-dashboard">Review security posture</Link></Button><Button variant="outline" size="sm" onClick={() => loadEvents({ background: true })}>Refresh snapshot</Button></div></>}</CardContent></Card>
        ) : filteredEvents.map((event) => {
          const severity = REALTIME_SEVERITY[event.severity] || REALTIME_SEVERITY.unknown;
          const status = REALTIME_STATUS[event.status] || REALTIME_STATUS.observed;
          return <Card key={event.id} className={`${SOC_SURFACE} transition-all hover:-translate-y-0.5 hover:bg-muted/30 ${event.severity === "critical" && event.status !== "resolved" ? "border-rose-400/30 bg-rose-400/[0.035]" : ""}`} data-testid={`soc-realtime-event-${event.id}`}><CardContent className="px-4 py-4"><div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between"><span className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${severity.dot} ${event.severity === "critical" && event.status !== "resolved" ? "animate-pulse" : ""}`} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">{event.title}</span><Badge variant="outline" className={`text-[10px] ${severity.className}`}>{severity.label}</Badge><Badge className={`text-[10px] ${status.className}`}>{status.label}</Badge><Badge variant="outline" className="text-[10px] text-muted-foreground">{event.source}</Badge></div><div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground"><span className="font-mono">{event.endpoint}</span><span>{event.client}</span><span>{relativeRealtimeTime(event.timestamp)}</span>{event.action !== "observed" && <span>Action: {event.action}</span>}</div><p className="mt-2 line-clamp-2 max-w-4xl text-xs leading-5 text-muted-foreground">{event.detail}</p></div><Button size="sm" variant="ghost" className="h-8 shrink-0 px-2 text-xs" onClick={() => setSelectedEvent(event)} data-testid={`review-soc-realtime-event-${event.id}`}><Eye className="mr-1.5 h-3.5 w-3.5" />Review evidence</Button></div></CardContent></Card>;
        })}
      </div>

      <Dialog open={Boolean(selectedEvent)} onOpenChange={(open) => !open && setSelectedEvent(null)}>
        <NexusWorkflowDialog eyebrow="SOC realtime evidence" title={selectedEvent?.title || "Security signal"} description="Review the captured signal before opening a governed alert response workflow." icon={Activity} tone="amber" className="max-w-3xl" data-testid="soc-realtime-detail" footer={<><Button variant="outline" asChild><Link to="/soc-feed">Open SOC alert feed<ChevronRight className="ml-1.5 h-3.5 w-3.5" /></Link></Button><Button onClick={() => setSelectedEvent(null)}>Done</Button></>}>
          {selectedEvent && <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-2"><RealtimeDetail label="Severity"><Badge variant="outline" className={REALTIME_SEVERITY[selectedEvent.severity]?.className}>{REALTIME_SEVERITY[selectedEvent.severity]?.label || "Unclassified"}</Badge></RealtimeDetail><RealtimeDetail label="Recorded state"><Badge className={REALTIME_STATUS[selectedEvent.status]?.className}>{REALTIME_STATUS[selectedEvent.status]?.label || "Observed"}</Badge></RealtimeDetail><RealtimeDetail label="Evidence source">{selectedEvent.source}</RealtimeDetail><RealtimeDetail label="Recorded">{relativeRealtimeTime(selectedEvent.timestamp)}</RealtimeDetail><RealtimeDetail label="Endpoint"><span className="font-mono text-xs">{selectedEvent.endpoint}</span></RealtimeDetail><RealtimeDetail label="Client scope">{selectedEvent.client}</RealtimeDetail>{selectedEvent.action !== "observed" && <RealtimeDetail label="Recorded action">{selectedEvent.action}</RealtimeDetail>}</div><section className="rounded-xl border border-border/70 bg-muted/[0.12] p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Captured event detail</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground/90">{selectedEvent.detail}</p></section><section className="rounded-xl border border-sky-400/20 bg-sky-400/[0.05] p-4"><p className="font-medium">Response remains governed</p><p className="mt-1 text-sm text-muted-foreground">A realtime record is evidence, not approval to contain, close, or alter a provider case. Use SOC Alert Feed to start an audited response.</p></section></div>}
        </NexusWorkflowDialog>
      </Dialog>
    </div>
  );
}

function RealtimeDetail({ label, children }) {
  return <div className="rounded-xl border border-border/70 bg-muted/[0.1] p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p><div className="mt-1.5 text-sm">{children}</div></div>;
}
