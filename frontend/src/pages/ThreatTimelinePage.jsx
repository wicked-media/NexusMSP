import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Link, useNavigate } from "react-router-dom";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import {
  CheckCircle2, ChevronRight, Clock3, Eye, History,
  RefreshCw, Search, ShieldCheck, ShieldAlert, Ticket, Wrench,
} from "lucide-react";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { WorkspaceErrorState, WorkspaceLoadingState } from "@/components/WorkspaceState";

const SURFACE = "overflow-hidden rounded-2xl border border-border/70 bg-card/90 shadow-[0_18px_45px_-34px_rgba(0,0,0,0.95)]";

const SEVERITY = {
  critical: { label: "Critical", className: "border-rose-400/35 bg-rose-400/[0.1] text-rose-200" },
  high: { label: "High", className: "border-orange-400/35 bg-orange-400/[0.1] text-orange-200" },
  medium: { label: "Medium", className: "border-amber-400/35 bg-amber-400/[0.1] text-amber-200" },
  low: { label: "Low", className: "border-sky-400/35 bg-sky-400/[0.1] text-sky-200" },
  unknown: { label: "Unclassified", className: "border-border/80 bg-muted/30 text-muted-foreground" },
};

const CASE_STATUS = {
  new: { label: "Needs triage", className: "bg-rose-400/[0.12] text-rose-200" },
  investigating: { label: "Investigating", className: "bg-amber-400/[0.12] text-amber-200" },
  remediated: { label: "Evidence recorded", className: "bg-emerald-400/[0.12] text-emerald-200" },
  closed: { label: "Closed", className: "bg-muted/60 text-muted-foreground" },
};

const ACTION_CONFIG = {
  remediation_evidence_recorded: { title: "Remediation evidence recorded", icon: Wrench, tone: "emerald" },
  ticket_created: { title: "Incident ticket linked", icon: Ticket, tone: "sky" },
  alert_acknowledged: { title: "Case acknowledged", icon: Eye, tone: "amber" },
  case_closed: { title: "Case closed", icon: CheckCircle2, tone: "emerald" },
};

function textValue(value, fallback) {
  return ["string", "number", "boolean"].includes(typeof value) && String(value).trim() ? String(value) : fallback;
}

function relativeTime(value) {
  if (!value || Number.isNaN(new Date(value).getTime())) return "Time not recorded";
  return formatDistanceToNow(new Date(value), { addSuffix: true });
}

function normaliseAlert(alert) {
  const rawSeverity = String(alert?.severity || "unknown").toLowerCase();
  const severity = SEVERITY[rawSeverity] ? rawSeverity : "unknown";
  const rawStatus = String(alert?.status || "new").toLowerCase();
  const status = { open: "new", resolved: "remediated", dismissed: "closed" }[rawStatus] || rawStatus;
  return {
    ...alert,
    id: textValue(alert?.id || alert?.alert_id, "unidentified-alert"),
    title: textValue(alert?.title || alert?.summary, "Recorded security alert"),
    severity,
    status: CASE_STATUS[status] ? status : "new",
    endpoint: textValue(alert?.hostname || alert?.agent_hostname || alert?.device_name, "No linked endpoint"),
    deviceId: textValue(alert?.device_id, ""),
    client: textValue(alert?.organization || alert?.organization_name || alert?.client_name, "Scope controlled"),
    description: textValue(alert?.description || alert?.details, "No additional alert detail was recorded."),
  };
}

function buildTimeline(alerts) {
  const timeline = [];
  alerts.forEach((alert) => {
    timeline.push({ id: `${alert.id}-recorded`, alert, kind: "recorded", timestamp: alert.created_at, title: "Alert recorded", description: alert.description, tone: alert.severity });
    const actions = Array.isArray(alert.actions) ? alert.actions : [];
    const recordedActionTypes = new Set();
    actions.forEach((action, index) => {
      const rawType = textValue(action?.type, "case_note");
      recordedActionTypes.add(rawType);
      const config = ACTION_CONFIG[rawType] || { title: rawType.replace(/_/g, " "), tone: "sky" };
      timeline.push({ id: `${alert.id}-action-${index}`, alert, kind: rawType, timestamp: action?.at || action?.timestamp || null, title: config.title, description: textValue(action?.notes || action?.detail, "No additional action detail was recorded."), tone: config.tone, actor: textValue(action?.by || action?.actor, "") });
    });
    if (alert.acknowledged_at && !recordedActionTypes.has("alert_acknowledged")) timeline.push({ id: `${alert.id}-acknowledged`, alert, kind: "alert_acknowledged", timestamp: alert.acknowledged_at, title: "Case acknowledged", description: "The alert was moved into investigation.", tone: "amber", actor: textValue(alert.acknowledged_by, "") });
    if (alert.ticket_id && !recordedActionTypes.has("ticket_created")) timeline.push({ id: `${alert.id}-ticket`, alert, kind: "ticket_created", timestamp: alert.ticket_created_at || null, title: "Incident ticket linked", description: alert.ticket_number ? `Ticket ${alert.ticket_number} is linked to this alert.` : "An incident ticket is linked to this alert.", tone: "sky" });
    if (alert.remediated_at && !recordedActionTypes.has("remediation_evidence_recorded")) timeline.push({ id: `${alert.id}-remediated`, alert, kind: "remediation_evidence_recorded", timestamp: alert.remediated_at, title: "Remediation evidence recorded", description: textValue(alert.remediation_notes, "Remediation evidence was retained for closure review."), tone: "emerald", actor: textValue(alert.remediated_by, "") });
    if (alert.closed_at && !recordedActionTypes.has("case_closed")) timeline.push({ id: `${alert.id}-closed`, alert, kind: "case_closed", timestamp: alert.closed_at, title: "Case closed", description: textValue(alert.close_reason, "The internal alert case was closed with a recorded reason."), tone: "emerald", actor: textValue(alert.closed_by, "") });
  });
  return timeline.sort((left, right) => (right.timestamp ? new Date(right.timestamp).getTime() : 0) - (left.timestamp ? new Date(left.timestamp).getTime() : 0));
}

function TimelineMetric({ label, value, description, tone = "zinc", selected, onClick }) {
  const tones = {
    rose: "border-rose-400/30 bg-rose-400/[0.055] text-rose-200",
    amber: "border-amber-400/30 bg-amber-400/[0.055] text-amber-200",
    emerald: "border-emerald-400/30 bg-emerald-400/[0.055] text-emerald-200",
    zinc: "border-border/70 bg-card/90 text-foreground",
  };
  return <button type="button" onClick={onClick} aria-pressed={selected} className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"><Card className={`${SURFACE} h-full transition-all hover:-translate-y-0.5 ${tones[tone]} ${selected ? "ring-1 ring-primary/60" : ""}`}><CardContent className="p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p><p className="mt-1 text-xs text-muted-foreground">{description}</p></CardContent></Card></button>;
}

export default function ThreatTimelinePage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [caseFilter, setCaseFilter] = useState("all");
  const [selectedItem, setSelectedItem] = useState(null);

  const loadTimeline = useCallback(async ({ background = false } = {}) => {
    if (background) setRefreshing(true); else setLoading(true);
    setLoadError("");
    try {
      const response = await axios.get(`${API}/soc/alerts`, { headers });
      setAlerts((Array.isArray(response.data) ? response.data : []).map(normaliseAlert));
      setLastRefreshed(new Date());
    } catch (error) {
      setLoadError(error?.response?.data?.detail || error?.message || "Nexus could not retrieve the scoped alert history. No response action has been attempted.");
      if (!background) toast.error("Threat timeline evidence is unavailable. You can retry safely.");
    } finally { setLoading(false); setRefreshing(false); }
  }, [headers]);

  useEffect(() => { loadTimeline(); }, [loadTimeline]);

  const timeline = useMemo(() => buildTimeline(alerts), [alerts]);
  const filteredItems = timeline
    .filter((item) => severityFilter === "all" || item.alert.severity === severityFilter)
    .filter((item) => caseFilter === "all" || (caseFilter === "open" ? ["new", "investigating"].includes(item.alert.status) : caseFilter === "outcomes" ? ["remediated", "closed"].includes(item.alert.status) : item.alert.status === caseFilter))
    .filter((item) => !search.trim() || [item.title, item.description, item.alert.title, item.alert.endpoint, item.alert.client, item.alert.mitre_attack].some((value) => String(value || "").toLowerCase().includes(search.trim().toLowerCase())));
  const counts = {
    open: alerts.filter((alert) => ["new", "investigating"].includes(alert.status)).length,
    critical: alerts.filter((alert) => alert.severity === "critical" && ["new", "investigating"].includes(alert.status)).length,
    outcomes: alerts.filter((alert) => ["remediated", "closed"].includes(alert.status)).length,
  };
  const filtersActive = Boolean(search.trim() || severityFilter !== "all" || caseFilter !== "all");
  const clearFilters = () => { setSearch(""); setSeverityFilter("all"); setCaseFilter("all"); };

  if (loading && !lastRefreshed) return <WorkspaceLoadingState className="mt-4" label="Loading scoped threat-history evidence…" />;
  if (!loading && loadError && alerts.length === 0) return <WorkspaceErrorState className="mt-4" title="Threat history is unavailable" description={loadError} onRetry={loadTimeline} retryLabel="Retry threat history" onSecondaryAction={() => navigate("/security-dashboard")} secondaryLabel="Open Security Dashboard" />;

  return <div className="space-y-5" data-testid="threat-timeline">
    <OperationalPageHeader eyebrow="Security operations · chronological case evidence" title="Threat Timeline" description="Follow the recorded lifecycle of scoped internal alert cases without turning historical evidence into a live-health claim." icon={History} tone="amber" signal={counts.critical > 0 ? "critical" : counts.open > 0 ? "attention" : "steady"} actions={<><Button asChild variant="outline" size="sm" className="rounded-xl"><Link to="/soc-realtime">Realtime evidence<ChevronRight className="ml-1.5 h-3.5 w-3.5" /></Link></Button><Button size="sm" className="rounded-xl" onClick={() => loadTimeline({ background: true })} disabled={refreshing} data-testid="threat-timeline-refresh"><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />Refresh history</Button></>} />

    <Card className={`${SURFACE} border-amber-400/20 bg-amber-400/[0.035]`} data-testid="threat-timeline-evidence-state"><CardContent className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-300">History scope</p><p className="mt-1 text-sm font-medium">This is the recorded lifecycle of internal Nexus alert cases.</p><p className="mt-1 text-xs text-muted-foreground">It does not invent provider history, make an external containment claim, or represent missing evidence as a quiet environment.</p></div><div className="flex flex-wrap gap-2"><Badge variant="outline" className="border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-200">Scoped cases · available</Badge><Badge variant="outline" className="text-muted-foreground">{lastRefreshed ? `Refreshed ${relativeTime(lastRefreshed)}` : "Refresh time not recorded"}</Badge></div></CardContent></Card>

    {loadError && <Card className={`${SURFACE} border-amber-400/25 bg-amber-400/[0.04]`}><CardContent className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium">The last history refresh did not complete</p><p className="mt-1 text-xs text-muted-foreground">{loadError} Previously retrieved case evidence remains visible below.</p></div><Button size="sm" variant="outline" onClick={() => loadTimeline({ background: true })}>Retry refresh</Button></CardContent></Card>}

    <div className="grid gap-3 sm:grid-cols-3" aria-label="Threat timeline summary"><TimelineMetric label="Critical active" value={counts.critical} description="Critical cases not yet closed" tone="rose" selected={severityFilter === "critical"} onClick={() => { setSeverityFilter("critical"); setCaseFilter("all"); }} /><TimelineMetric label="Open cases" value={counts.open} description="New or under investigation" tone="amber" selected={caseFilter === "open"} onClick={() => { setCaseFilter("open"); setSeverityFilter("all"); }} /><TimelineMetric label="Recorded outcomes" value={counts.outcomes} description="Evidence recorded or closed" tone="emerald" selected={caseFilter === "outcomes"} onClick={() => { setCaseFilter("outcomes"); setSeverityFilter("all"); }} /></div>

    <Card className={SURFACE}><CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-300">Case history</p><p className="mt-1 text-sm font-medium">{filteredItems.length} of {timeline.length} recorded history item{timeline.length === 1 ? "" : "s"} shown</p><p className="mt-1 text-xs text-muted-foreground">Entries are ordered by their recorded timestamps; entries without a time are placed after timed evidence.</p></div><div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"><div className="relative min-w-0 sm:w-72"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Search case, endpoint, client or MITRE" value={search} onChange={(event) => setSearch(event.target.value)} data-testid="threat-timeline-search" /></div><Select value={severityFilter} onValueChange={setSeverityFilter}><SelectTrigger className="w-full sm:w-[142px]" aria-label="Filter threat history by severity"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All severity</SelectItem><SelectItem value="critical">Critical</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent></Select><Select value={caseFilter} onValueChange={setCaseFilter}><SelectTrigger className="w-full sm:w-[152px]" aria-label="Filter threat history by case state"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All case states</SelectItem><SelectItem value="open">Open cases</SelectItem><SelectItem value="outcomes">Recorded outcomes</SelectItem><SelectItem value="new">Needs triage</SelectItem><SelectItem value="investigating">Investigating</SelectItem><SelectItem value="remediated">Evidence recorded</SelectItem><SelectItem value="closed">Closed</SelectItem></SelectContent></Select>{filtersActive && <Button variant="ghost" size="sm" className="text-xs" onClick={clearFilters} data-testid="threat-timeline-clear-filters">Clear filters</Button>}</div></CardContent></Card>

    <section className="relative space-y-3" aria-label="Threat timeline event history">{filteredItems.length === 0 ? <Card className={`${SURFACE} border-dashed`} data-testid="threat-timeline-empty-state"><CardContent className="flex min-h-72 flex-col items-center justify-center px-6 py-12 text-center">{filtersActive ? <><Search className="h-8 w-8 text-muted-foreground" /><p className="mt-4 text-sm font-semibold">No recorded history matches this view</p><p className="mt-1 max-w-md text-sm text-muted-foreground">Broaden the filters or clear them to return to the scoped case record.</p><Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>Clear filters</Button></> : <><ShieldCheck className="h-9 w-9 text-emerald-300" /><p className="mt-4 text-sm font-semibold">No internal alert history recorded in this scope</p><p className="mt-1 max-w-lg text-sm text-muted-foreground">Nexus has no stored internal alert cases to place on this history. This does not prove every security source or endpoint is healthy.</p><div className="mt-4 flex flex-wrap justify-center gap-2"><Button asChild size="sm"><Link to="/soc-feed">Open SOC alert feed</Link></Button><Button variant="outline" size="sm" onClick={() => loadTimeline({ background: true })}>Refresh history</Button></div></>}</CardContent></Card> : <><div className="absolute bottom-4 left-5 top-4 hidden w-px bg-border/70 sm:block" />{filteredItems.map((item) => {
      const severity = SEVERITY[item.alert.severity] || SEVERITY.unknown;
      const StatusIcon = item.kind === "case_closed" ? CheckCircle2 : item.kind === "remediation_evidence_recorded" ? Wrench : item.kind === "ticket_created" ? Ticket : item.kind === "alert_acknowledged" ? Eye : ShieldAlert;
      return <article key={item.id} className="relative flex gap-3 sm:gap-4" data-testid={`threat-timeline-item-${item.id}`}><div className="relative z-10 mt-4 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-background"><StatusIcon className={`h-4 w-4 ${item.tone === "emerald" ? "text-emerald-300" : item.tone === "amber" ? "text-amber-300" : item.tone === "sky" ? "text-sky-300" : item.alert.severity === "critical" ? "text-rose-300" : "text-orange-300"}`} /></div><Card className={`${SURFACE} flex-1 transition-all hover:-translate-y-0.5 hover:bg-muted/30 ${item.alert.severity === "critical" && item.alert.status !== "closed" ? "border-rose-400/30 bg-rose-400/[0.035]" : ""}`}><CardContent className="px-4 py-4"><div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">{item.title}</span><Badge variant="outline" className={`text-[10px] ${severity.className}`}>{severity.label}</Badge><Badge className={`text-[10px] ${CASE_STATUS[item.alert.status]?.className}`}>{CASE_STATUS[item.alert.status]?.label || item.alert.status}</Badge>{item.alert.mitre_attack && <Badge variant="outline" className="text-[10px] font-mono">{item.alert.mitre_attack}</Badge>}</div><p className="mt-1.5 text-xs font-medium text-foreground/90">{item.alert.title}</p><div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground"><span className="font-mono">{item.alert.endpoint}</span><span>{item.alert.client}</span><span>{relativeTime(item.timestamp)}</span>{item.actor && <span>By {item.actor}</span>}</div><p className="mt-2 line-clamp-2 max-w-4xl text-xs leading-5 text-muted-foreground">{item.description}</p></div><Button size="sm" variant="ghost" className="h-8 shrink-0 px-2 text-xs" onClick={() => setSelectedItem(item)} data-testid={`review-threat-timeline-${item.id}`}><Eye className="mr-1.5 h-3.5 w-3.5" />Review evidence</Button></div></CardContent></Card></article>;
    })}</>}</section>

    <Dialog open={Boolean(selectedItem)} onOpenChange={(open) => !open && setSelectedItem(null)}><NexusWorkflowDialog eyebrow="Chronological case evidence" title={selectedItem?.title || "Threat history item"} description="Review the recorded history before moving into the governed response workflow." icon={Clock3} tone="amber" className="max-w-3xl" data-testid="threat-timeline-detail" footer={<><Button variant="outline" asChild><Link to="/soc-feed">Open SOC alert feed<ChevronRight className="ml-1.5 h-3.5 w-3.5" /></Link></Button><Button onClick={() => setSelectedItem(null)}>Done</Button></>}>
      {selectedItem && <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-2"><TimelineDetail label="History event">{selectedItem.title}</TimelineDetail><TimelineDetail label="Recorded">{relativeTime(selectedItem.timestamp)}</TimelineDetail><TimelineDetail label="Case state"><Badge className={CASE_STATUS[selectedItem.alert.status]?.className}>{CASE_STATUS[selectedItem.alert.status]?.label || selectedItem.alert.status}</Badge></TimelineDetail><TimelineDetail label="Severity"><Badge variant="outline" className={SEVERITY[selectedItem.alert.severity]?.className}>{SEVERITY[selectedItem.alert.severity]?.label || "Unclassified"}</Badge></TimelineDetail><TimelineDetail label="Endpoint">{selectedItem.alert.deviceId ? <Link to={`/devices/${encodeURIComponent(selectedItem.alert.deviceId)}`} className="font-mono text-xs text-sky-300 hover:underline">{selectedItem.alert.endpoint}</Link> : <span className="font-mono text-xs">{selectedItem.alert.endpoint}</span>}</TimelineDetail><TimelineDetail label="Client scope">{selectedItem.alert.client}</TimelineDetail>{selectedItem.alert.ticket_number && <TimelineDetail label="Linked ticket">{selectedItem.alert.ticket_number}</TimelineDetail>}{selectedItem.alert.mitre_attack && <TimelineDetail label="MITRE technique"><span className="font-mono text-xs">{selectedItem.alert.mitre_attack}</span></TimelineDetail>}</div><section className="rounded-xl border border-border/70 bg-muted/[0.12] p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Captured history detail</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground/90">{selectedItem.description}</p></section><section className="rounded-xl border border-sky-400/20 bg-sky-400/[0.05] p-4"><p className="font-medium">Response remains governed</p><p className="mt-1 text-sm text-muted-foreground">Timeline evidence records what Nexus knows about an internal case. Start or continue response work in SOC Alert Feed so permissions, reasons, and audit records are applied consistently.</p></section></div>}
    </NexusWorkflowDialog></Dialog>
  </div>;
}

function TimelineDetail({ label, children }) {
  return <div className="rounded-xl border border-border/70 bg-muted/[0.1] p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p><div className="mt-1.5 text-sm">{children}</div></div>;
}
