import { useState, useEffect, useCallback, useMemo } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Link, useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  AlertTriangle, Activity, Search, Ticket, CheckCircle, XCircle, Clock, Eye,
  Wrench, RefreshCw, Zap, ShieldCheck, FileText, ChevronRight
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { WorkspaceErrorState, WorkspaceLoadingState } from "@/components/WorkspaceState";

const SURFACE = "overflow-hidden rounded-2xl border border-border/70 bg-card/90 shadow-[0_18px_45px_-34px_rgba(0,0,0,0.95)]";

const SEV = {
  critical: { class: "bg-red-500/20 text-red-400 border-red-500/30", dot: "bg-red-500" },
  high: { class: "bg-orange-500/20 text-orange-400 border-orange-500/30", dot: "bg-orange-500" },
  medium: { class: "bg-amber-500/20 text-amber-400 border-amber-500/30", dot: "bg-amber-500" },
  low: { class: "bg-blue-500/20 text-blue-400 border-blue-500/30", dot: "bg-blue-500" },
};

const STATUS_CONFIG = {
  new: { label: "New", class: "bg-red-500/20 text-red-400", icon: AlertTriangle },
  investigating: { label: "Investigating", class: "bg-amber-500/20 text-amber-400", icon: Eye },
  remediated: { label: "Remediated", class: "bg-green-500/20 text-green-400", icon: CheckCircle },
  closed: { label: "Closed", class: "bg-gray-500/20 text-gray-400", icon: XCircle },
};

function relativeTime(value) {
  if (!value || Number.isNaN(new Date(value).getTime())) return "Time not recorded";
  return formatDistanceToNow(new Date(value), { addSuffix: true });
}

function sourceLabel(alert) {
  return alert.source === "huntress" ? "Huntress" : "Nexus evidence";
}

function getErrorMessage(error, fallback) {
  return error?.response?.data?.detail || error?.message || fallback;
}

function normaliseAlert(alert) {
  const rawSeverity = String(alert?.severity || "low").toLowerCase();
  const rawStatus = String(alert?.status || "new").toLowerCase();
  const status = { open: "new", resolved: "remediated", dismissed: "closed" }[rawStatus] || rawStatus;
  return {
    ...alert,
    severity: SEV[rawSeverity] ? rawSeverity : "low",
    status: STATUS_CONFIG[status] ? status : "new",
    hostname: alert?.hostname || alert?.agent_hostname || "No endpoint linked",
    organization: alert?.organization || alert?.organization_name || alert?.client_name || "No client linked",
  };
}

export default function SocFeedPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [sourceFailures, setSourceFailures] = useState([]);
  const [providerState, setProviderState] = useState({ known: false, configured: false });
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [search, setSearch] = useState("");
  const [sevFilter, setSevFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [detailAlert, setDetailAlert] = useState(null);
  const [ticketDialog, setTicketDialog] = useState(false);
  const [ticketForm, setTicketForm] = useState({ title: "", description: "", priority: "high" });
  const [remediateDialog, setRemediateDialog] = useState(false);
  const [remediateNotes, setRemediateNotes] = useState("");
  const [closeDialog, setCloseDialog] = useState(false);
  const [closeReason, setCloseReason] = useState("");
  const [actionLoading, setActionLoading] = useState(null);
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    setSourceFailures([]);

    const [socResult, statusResult] = await Promise.allSettled([
      axios.get(`${API}/soc/alerts`, { headers }),
      axios.get(`${API}/huntress/status`, { headers }),
    ]);
    const failures = [];
    const socList = socResult.status === "fulfilled" && Array.isArray(socResult.value.data) ? socResult.value.data.map(normaliseAlert) : [];
    if (socResult.status === "rejected") failures.push("Nexus alert evidence");

    const providerConfigured = statusResult.status === "fulfilled" && statusResult.value.data?.configured === true;
    setProviderState({ known: statusResult.status === "fulfilled", configured: providerConfigured });
    if (statusResult.status === "rejected") failures.push("Huntress connection status");

    let huntAlerts = [];
    let providerRetrieved = false;
    if (providerConfigured) {
      const [incidentsResult] = await Promise.allSettled([
        axios.get(`${API}/huntress/incident-reports?limit=500`, { headers }),
      ]);
      if (incidentsResult.status === "fulfilled") {
        providerRetrieved = true;
        const incidents = Array.isArray(incidentsResult.value.data) ? incidentsResult.value.data : [];
        huntAlerts = incidents.map((incident) => normaliseAlert({
          id: `hunt-${incident.id}`,
          title: incident.summary || incident.title || "Huntress incident",
          description: incident.description || incident.summary || "",
          severity: (incident.severity || "low").toLowerCase(),
          status: ["resolved", "closed"].includes(String(incident.status || "").toLowerCase()) ? "remediated" : "new",
          hostname: incident.agent_hostname || incident.hostname || "No endpoint linked",
          organization: incident.organization_name || incident.organization_id || "No client linked",
          created_at: incident.detected_at || incident.created_at,
          source: "huntress",
          _providerIncidentId: incident.id,
        }));
      } else {
        failures.push("Huntress incident feed");
      }
    }

    if (socResult.status !== "fulfilled" && !providerRetrieved) {
      setAlerts([]);
      setLoadError("Nexus could not retrieve the current alert evidence. No acknowledgement, ticket, remediation, or containment action has been attempted.");
      toast.error("SOC evidence is unavailable. You can retry safely.");
    } else {
      const byId = new Map();
      [...socList, ...huntAlerts].forEach((alert) => byId.set(alert.id, alert));
      setAlerts([...byId.values()].sort((left, right) => {
        const severity = { critical: 0, high: 1, medium: 2, low: 3 };
        return (severity[left.severity] ?? 4) - (severity[right.severity] ?? 4)
          || String(right.created_at || "").localeCompare(String(left.created_at || ""));
      }));
      setLastRefreshed(new Date());
    }
    setSourceFailures(failures);
    setLoading(false);
  }, [headers]);

  useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

  const handleAcknowledge = async (alertId) => {
    setActionLoading(alertId);
    try {
      await axios.post(`${API}/soc/alerts/${alertId}/acknowledge`, {}, { headers });
      toast.success("Acknowledgement recorded. The alert is now under investigation.");
      fetchAlerts();
    } catch (error) { toast.error(getErrorMessage(error, "Nexus could not record the acknowledgement.")); }
    finally { setActionLoading(null); }
  };

  const handleCreateTicket = async () => {
    if (!selectedAlert) return;
    setActionLoading(`ticket-${selectedAlert.id}`);
    try {
      const res = await axios.post(`${API}/soc/alerts/${selectedAlert.id}/create-ticket`, ticketForm, { headers });
      toast.success(res.data?.existing ? `Existing ticket ${res.data.ticket_number || "retained"}` : `Ticket ${res.data?.ticket_number || "created"}`);
      setTicketDialog(false);
      fetchAlerts();
    } catch (error) { toast.error(getErrorMessage(error, "Nexus could not create the ticket.")); }
    finally { setActionLoading(null); }
  };

  const handleRemediate = async () => {
    if (!selectedAlert) return;
    setActionLoading(`remediate-${selectedAlert.id}`);
    try {
      await axios.post(`${API}/soc/alerts/${selectedAlert.id}/remediate`, { notes: remediateNotes.trim() }, { headers });
      toast.success("Remediation evidence recorded. The case is ready for closure review.");
      setRemediateDialog(false);
      fetchAlerts();
    } catch (error) { toast.error(getErrorMessage(error, "Nexus could not record the remediation evidence.")); }
    finally { setActionLoading(null); }
  };

  const handleClose = async () => {
    if (!selectedAlert) return;
    setActionLoading(`close-${selectedAlert.id}`);
    try {
      await axios.post(`${API}/soc/alerts/${selectedAlert.id}/close`, { reason: closeReason.trim() }, { headers });
      toast.success("Internal alert case closed with a recorded reason.");
      setCloseDialog(false);
      setCloseReason("");
      fetchAlerts();
    } catch (error) { toast.error(getErrorMessage(error, "Nexus could not close the internal alert case.")); }
    finally { setActionLoading(null); }
  };

  const filtered = alerts
    .filter(a => sevFilter === "all" || a.severity === sevFilter)
    .filter(a => statusFilter === "all" || a.status === statusFilter)
    .filter(a => !search || [a.title, a.hostname, a.organization, a.ticket_number, a.mitre_attack].filter(Boolean).some((value) => String(value).toLowerCase().includes(search.toLowerCase())));

  const counts = {
    critical: alerts.filter(a => a.severity === "critical" && ["new", "investigating"].includes(a.status)).length,
    high: alerts.filter(a => a.severity === "high" && ["new", "investigating"].includes(a.status)).length,
    open: alerts.filter(a => ["new", "investigating"].includes(a.status)).length,
  };

  const filtersActive = Boolean(search.trim() || sevFilter !== "all" || statusFilter !== "all");
  const clearFilters = () => { setSearch(""); setSevFilter("all"); setStatusFilter("all"); };
  const nexusEvidenceAvailable = !sourceFailures.includes("Nexus alert evidence");

  if (loading && alerts.length === 0) return <WorkspaceLoadingState className="mt-4" label="Loading scoped SOC evidence…" />;
  if (!loading && loadError) return <WorkspaceErrorState className="mt-4" title="SOC evidence is unavailable" description={loadError} onRetry={fetchAlerts} retryLabel="Retry SOC evidence" onSecondaryAction={() => navigate("/security-dashboard")} secondaryLabel="Open Security Dashboard" />;

  return (
    <div className="space-y-5" data-testid="soc-feed">
      <OperationalPageHeader
        eyebrow="Security operations · recorded evidence"
        title="SOC Alert Feed"
        description="Triage the scoped evidence Nexus has recorded. Internal response steps retain their owner, reason, and audit trail."
        icon={ShieldCheck}
        tone="amber"
        signal={counts.critical > 0 ? "critical" : counts.open > 0 ? "attention" : "steady"}
        actions={<><Button asChild variant="outline" size="sm" className="rounded-xl"><Link to="/security-dashboard">Security dashboard<ChevronRight className="ml-1.5 h-3.5 w-3.5" /></Link></Button><Button size="sm" className="rounded-xl" onClick={fetchAlerts} disabled={loading} data-testid="soc-feed-refresh"><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh evidence</Button></>}
      />

      <Card className={`${SURFACE} border-amber-400/20 bg-amber-400/[0.035]`} data-testid="soc-evidence-context">
        <CardContent className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-300">Evidence state</p><p className="mt-1 text-sm font-medium">A clear queue is not a blanket health claim.</p><p className="mt-1 text-xs text-muted-foreground">This feed contains only stored, scoped Nexus evidence and connected provider incidents. It never treats an unavailable source as healthy.</p></div>
          <div className="flex flex-wrap gap-2"><Badge variant="outline" className={nexusEvidenceAvailable ? "border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-200" : "border-amber-400/25 bg-amber-400/[0.08] text-amber-100"}>Nexus alerts · {nexusEvidenceAvailable ? "available" : "unavailable"}</Badge><Badge variant="outline" className={!providerState.known ? "border-amber-400/25 bg-amber-400/[0.08] text-amber-100" : providerState.configured ? "border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-200" : "text-muted-foreground"}>Huntress · {!providerState.known ? "status unavailable" : providerState.configured ? "connected feed" : "not connected"}</Badge></div>
        </CardContent>
      </Card>

      {sourceFailures.length > 0 && <Card className={`${SURFACE} border-amber-400/25 bg-amber-400/[0.04]`} data-testid="soc-source-status"><CardContent className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300">Partial evidence view</p><p className="mt-1 text-sm font-medium">{sourceFailures.join(" and ")} {sourceFailures.length === 1 ? "is" : "are"} currently unavailable.</p><p className="mt-1 text-xs text-muted-foreground">Unavailable sources are not represented as a healthy zero.</p></div><Button variant="outline" size="sm" className="shrink-0 rounded-xl" onClick={fetchAlerts}>Retry sources</Button></CardContent></Card>}

      <div className="grid gap-3 sm:grid-cols-3" aria-label="SOC queue summary">
        <button type="button" onClick={() => { setSevFilter("critical"); setStatusFilter("all"); }} aria-pressed={sevFilter === "critical"} className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"><Card className={`${SURFACE} transition-all hover:-translate-y-0.5 hover:border-rose-400/35 ${sevFilter === "critical" ? "border-rose-400/40 bg-rose-500/[0.06]" : ""}`}><CardContent className="flex items-center gap-3 p-4"><span className={`h-2.5 w-2.5 rounded-full bg-rose-400 ${counts.critical > 0 ? "animate-pulse" : ""}`} /><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Critical open</p><p className="mt-1 text-2xl font-semibold text-rose-300">{counts.critical}</p></div><ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" /></CardContent></Card></button>
        <button type="button" onClick={() => { setSevFilter("high"); setStatusFilter("all"); }} aria-pressed={sevFilter === "high"} className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"><Card className={`${SURFACE} transition-all hover:-translate-y-0.5 hover:border-orange-400/35 ${sevFilter === "high" ? "border-orange-400/40 bg-orange-500/[0.06]" : ""}`}><CardContent className="flex items-center gap-3 p-4"><span className="h-2.5 w-2.5 rounded-full bg-orange-400" /><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">High open</p><p className="mt-1 text-2xl font-semibold text-orange-300">{counts.high}</p></div><ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" /></CardContent></Card></button>
        <button type="button" onClick={() => setStatusFilter("new")} aria-pressed={statusFilter === "new"} className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"><Card className={`${SURFACE} transition-all hover:-translate-y-0.5 hover:border-amber-400/35 ${statusFilter === "new" ? "border-amber-400/40 bg-amber-500/[0.06]" : ""}`}><CardContent className="flex items-center gap-3 p-4"><Activity className="h-4 w-4 text-amber-300" /><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Needs triage</p><p className="mt-1 text-2xl font-semibold text-amber-200">{counts.open}</p></div><ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" /></CardContent></Card></button>
      </div>

      <Card className={SURFACE}>
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-end lg:justify-between">
          <div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-300">Triage queue</p><p className="mt-1 text-sm font-medium">{filtered.length} of {alerts.length} recorded alert{alerts.length === 1 ? "" : "s"} shown</p><p className="mt-1 text-xs text-muted-foreground">{lastRefreshed ? `Refreshed ${relativeTime(lastRefreshed)}` : "No refresh time recorded"}</p></div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"><div className="relative min-w-0 sm:w-72"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Search alert, client, endpoint or ticket" value={search} onChange={e => setSearch(e.target.value)} data-testid="alert-search" /></div><Select value={sevFilter} onValueChange={setSevFilter}><SelectTrigger className="w-full sm:w-[142px]" aria-label="Filter by severity"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All severity</SelectItem><SelectItem value="critical">Critical</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent></Select><Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-full sm:w-[152px]" aria-label="Filter by status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All status</SelectItem><SelectItem value="new">New</SelectItem><SelectItem value="investigating">Investigating</SelectItem><SelectItem value="remediated">Evidence recorded</SelectItem><SelectItem value="closed">Closed</SelectItem></SelectContent></Select>{filtersActive && <Button variant="ghost" size="sm" className="text-xs" onClick={clearFilters} data-testid="soc-clear-filters">Clear filters</Button>}</div>
        </CardContent>
      </Card>

      {/* Alert List */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <Card className={`${SURFACE} border-dashed`} data-testid="soc-empty-state"><CardContent className="flex min-h-72 flex-col items-center justify-center px-6 py-12 text-center">{filtersActive ? <><Search className="h-8 w-8 text-muted-foreground" /><p className="mt-4 text-sm font-semibold">No recorded alerts match this view</p><p className="mt-1 max-w-md text-sm text-muted-foreground">Try a broader search or clear the filters to return to the full scoped queue.</p><Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>Clear filters</Button></> : <><ShieldCheck className="h-9 w-9 text-emerald-300" /><p className="mt-4 text-sm font-semibold">No recorded security alerts in this scope</p><p className="mt-1 max-w-lg text-sm text-muted-foreground">Nexus has no stored alert evidence requiring triage here. This does not prove every endpoint or provider source is healthy.</p><div className="mt-4 flex flex-wrap justify-center gap-2"><Button asChild size="sm"><Link to="/security-dashboard">Review security posture</Link></Button><Button variant="outline" size="sm" onClick={fetchAlerts}>Refresh evidence</Button></div></>}</CardContent></Card>
        ) : filtered.map(alert => {
          const StatusIcon = STATUS_CONFIG[alert.status]?.icon || Clock;
          const isInternalAlert = alert.source !== "huntress";
          return (
            <Card key={alert.id} className={`${SURFACE} transition-all hover:-translate-y-0.5 hover:bg-muted/30 ${alert.severity === "critical" && alert.status === "new" ? "border-red-500/30 bg-red-500/5" : ""}`} data-testid={`alert-${alert.id}`}>
              <CardContent className="px-4 py-4">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${SEV[alert.severity]?.dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{alert.title || "Untitled security alert"}</span>
                      <Badge variant="outline" className={SEV[alert.severity]?.class + " text-[10px]"}>{alert.severity}</Badge>
                      <Badge className={STATUS_CONFIG[alert.status]?.class + " text-[10px]"}><StatusIcon className="w-3 h-3 mr-1" />{STATUS_CONFIG[alert.status]?.label}</Badge>
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">{sourceLabel(alert)}</Badge>
                      {alert.mitre_attack && <Badge variant="outline" className="text-[10px] font-mono">{alert.mitre_attack}</Badge>}
                      {alert.ticket_number && <Badge variant="outline" className="text-[10px] text-green-400 border-green-500/30"><Ticket className="w-3 h-3 mr-1" />{alert.ticket_number}</Badge>}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="font-mono">{alert.hostname}</span>
                      <span>{alert.organization}</span>
                      <span>{relativeTime(alert.created_at)}</span>
                      {alert.assigned_to && <span>Owner: {alert.assigned_to}</span>}
                    </div>
                    {alert.description && <p className="mt-2 line-clamp-2 max-w-4xl text-xs leading-5 text-muted-foreground">{alert.description}</p>}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2 xl:justify-end">
                    <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setDetailAlert(alert)} data-testid={`view-alert-${alert.id}`}>
                      <FileText className="mr-1.5 h-3.5 w-3.5" />Review
                    </Button>
                    {isInternalAlert && alert.status === "new" && (
                      <Button size="sm" variant="outline" className="h-8 px-2 text-xs" onClick={() => handleAcknowledge(alert.id)} disabled={actionLoading === alert.id} data-testid={`ack-${alert.id}`}>
                        <Eye className="mr-1.5 h-3.5 w-3.5" />Acknowledge
                      </Button>
                    )}
                    {isInternalAlert && !alert.ticket_id && !alert.ticket_number && (
                      <Button size="sm" variant="outline" className="h-8 border-sky-400/30 px-2 text-xs text-sky-300 hover:bg-sky-400/[0.08]" onClick={() => {
                        setSelectedAlert(alert);
                        setTicketForm({ title: `[SOC] ${alert.title || "Security alert"}`, description: `${alert.description || "No additional alert description was recorded."}\n\nHost: ${alert.hostname}\nClient: ${alert.organization}\nSeverity: ${alert.severity}\nMITRE: ${alert.mitre_attack || "Not recorded"}\nEvidence source: Nexus recorded alert`, priority: alert.severity === "critical" ? "critical" : alert.severity === "high" ? "high" : "medium" });
                        setTicketDialog(true);
                      }} data-testid={`create-ticket-${alert.id}`}>
                        <Ticket className="mr-1.5 h-3.5 w-3.5" />Create ticket
                      </Button>
                    )}
                    {isInternalAlert && alert.status === "investigating" && (
                      <Button size="sm" variant="outline" className="h-8 border-emerald-400/30 px-2 text-xs text-emerald-300 hover:bg-emerald-400/[0.08]" onClick={() => { setSelectedAlert(alert); setRemediateNotes(""); setRemediateDialog(true); }} data-testid={`remediate-${alert.id}`}>
                        <Wrench className="mr-1.5 h-3.5 w-3.5" />Record evidence
                      </Button>
                    )}
                    {isInternalAlert && alert.status === "remediated" && (
                      <Button size="sm" variant="outline" className="h-8 px-2 text-xs" onClick={() => { setSelectedAlert(alert); setCloseReason(""); setCloseDialog(true); }} data-testid={`close-${alert.id}`}>
                        <CheckCircle className="mr-1.5 h-3.5 w-3.5" />Close case
                      </Button>
                    )}
                    {!isInternalAlert && <Button asChild size="sm" variant="outline" className="h-8 px-2 text-xs"><Link to="/security-dashboard">Provider workflow<ChevronRight className="ml-1.5 h-3.5 w-3.5" /></Link></Button>}
                  </div>
                </div>
                {alert.remediation_steps && alert.status !== "closed" && (
                  <div className="ml-5 mt-3 rounded-xl border border-dashed border-border/80 bg-muted/[0.14] p-3">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Recorded recommended actions</p>
                    <ul className="text-[11px] space-y-0.5 text-muted-foreground">{(alert.remediation_steps || []).map((s, i) => <li key={`k-${i}`} className="flex items-start gap-1"><Zap className="w-3 h-3 mt-0.5 text-amber-400 flex-shrink-0" />{s}</li>)}</ul>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={Boolean(detailAlert)} onOpenChange={(open) => !open && setDetailAlert(null)}>
        <NexusWorkflowDialog eyebrow="SOC evidence" title={detailAlert?.title || "Security alert"} description="Review the captured evidence before starting or closing response work." icon={FileText} tone="amber" className="max-w-3xl" data-testid="soc-alert-detail" footer={<Button onClick={() => setDetailAlert(null)}>Done</Button>}>
          {detailAlert && <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <DetailField label="Severity"><Badge variant="outline" className={SEV[detailAlert.severity]?.class}>{detailAlert.severity}</Badge></DetailField>
              <DetailField label="Case state"><Badge variant="outline" className={STATUS_CONFIG[detailAlert.status]?.class}>{STATUS_CONFIG[detailAlert.status]?.label || detailAlert.status}</Badge></DetailField>
              <DetailField label="Evidence source">{sourceLabel(detailAlert)}</DetailField>
              <DetailField label="Recorded">{relativeTime(detailAlert.created_at)}</DetailField>
              <DetailField label="Endpoint"><span className="font-mono text-xs">{detailAlert.hostname}</span></DetailField>
              <DetailField label="Client">{detailAlert.organization}</DetailField>
              {detailAlert.mitre_attack && <DetailField label="MITRE technique"><span className="font-mono text-xs">{detailAlert.mitre_attack}</span></DetailField>}
              {detailAlert.ticket_number && <DetailField label="Linked ticket">{detailAlert.ticket_number}</DetailField>}
            </div>
            <section className="rounded-xl border border-border/70 bg-muted/[0.12] p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Recorded detail</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground/90">{detailAlert.description || "No additional description was recorded for this alert."}</p></section>
            {detailAlert.remediation_notes && <section className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.05] p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-200">Remediation evidence</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground/90">{detailAlert.remediation_notes}</p></section>}
            {detailAlert.source === "huntress" && <section className="rounded-xl border border-sky-400/20 bg-sky-400/[0.05] p-4"><p className="font-medium">Provider-sourced evidence</p><p className="mt-1 text-sm text-muted-foreground">Nexus keeps this feed read-only until a governed provider response workflow verifies the scope, decision, and audit reason.</p><Button asChild variant="outline" size="sm" className="mt-3"><Link to="/security-dashboard">Open provider workflow<ChevronRight className="ml-1.5 h-3.5 w-3.5" /></Link></Button></section>}
          </div>}
        </NexusWorkflowDialog>
      </Dialog>

      <Dialog open={ticketDialog} onOpenChange={(open) => !open && setTicketDialog(false)}>
        <NexusWorkflowDialog eyebrow="Incident response" title="Create ticket from security alert" description="Nexus preserves the alert context so the response can be assigned, timed, and audited without re-keying the evidence." icon={Ticket} tone="cyan" className="max-w-2xl" data-testid="soc-ticket-workflow" footer={<><Button variant="outline" onClick={() => setTicketDialog(false)}>Cancel</Button><Button onClick={handleCreateTicket} disabled={!ticketForm.title.trim() || actionLoading === `ticket-${selectedAlert?.id}`} data-testid="confirm-create-ticket"><Ticket className="mr-2 h-4 w-4" />Create incident ticket</Button></>}>
          <div className="space-y-4">
            <div className="rounded-xl border border-sky-400/20 bg-sky-400/[0.05] p-4 text-sm"><p className="font-medium">{selectedAlert?.hostname} · {selectedAlert?.organization}</p><p className="mt-1 text-xs text-muted-foreground">Severity and recorded evidence context will be retained with the ticket.</p></div>
            <div className="space-y-2"><Label htmlFor="soc-ticket-title">Ticket title</Label><Input id="soc-ticket-title" value={ticketForm.title} onChange={e => setTicketForm({ ...ticketForm, title: e.target.value })} data-testid="ticket-title" /></div>
            <div className="space-y-2"><Label htmlFor="soc-ticket-description">Technician brief</Label><Textarea id="soc-ticket-description" value={ticketForm.description} onChange={e => setTicketForm({ ...ticketForm, description: e.target.value })} rows={7} /></div>
            <div className="max-w-xs space-y-2"><Label htmlFor="soc-ticket-priority">Priority</Label><Select value={ticketForm.priority} onValueChange={v => setTicketForm({ ...ticketForm, priority: v })}><SelectTrigger id="soc-ticket-priority"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="critical">Critical</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent></Select></div>
          </div>
        </NexusWorkflowDialog>
      </Dialog>

      <Dialog open={remediateDialog} onOpenChange={(open) => !open && setRemediateDialog(false)}>
        <NexusWorkflowDialog eyebrow="Evidence-led response" title="Record remediation evidence" description="Record what was verified or the external provider case that confirms the remediation. This does not claim a provider action was completed." icon={Wrench} tone="emerald" className="max-w-2xl" data-testid="soc-remediation-workflow" footer={<><Button variant="outline" onClick={() => setRemediateDialog(false)}>Cancel</Button><Button onClick={handleRemediate} disabled={remediateNotes.trim().length < 8 || actionLoading === `remediate-${selectedAlert?.id}`} data-testid="confirm-remediate"><CheckCircle className="mr-2 h-4 w-4" />Record evidence</Button></>}>
          <div className="space-y-4">
            {selectedAlert && <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.05] p-4 text-sm"><p className="font-medium">{selectedAlert.title}</p><p className="mt-1 text-xs text-muted-foreground">{selectedAlert.hostname} · {selectedAlert.organization}</p></div>}
            <div className="space-y-2"><Label htmlFor="soc-remediation-notes">Remediation evidence</Label><Textarea id="soc-remediation-notes" value={remediateNotes} onChange={e => setRemediateNotes(e.target.value)} rows={6} placeholder="Describe the verification performed, action taken, or external provider case reference." /><p className="text-xs text-muted-foreground">At least 8 characters are required so the audit trail explains the decision.</p></div>
          </div>
        </NexusWorkflowDialog>
      </Dialog>

      <Dialog open={closeDialog} onOpenChange={(open) => !open && setCloseDialog(false)}>
        <NexusWorkflowDialog eyebrow="Case closure" title="Close internal alert case" description="Close only after the evidence has been reviewed. A reason is retained as part of the alert audit history." icon={CheckCircle} tone="emerald" className="max-w-2xl" data-testid="soc-close-workflow" footer={<><Button variant="outline" onClick={() => setCloseDialog(false)}>Keep case open</Button><Button onClick={handleClose} disabled={closeReason.trim().length < 8 || actionLoading === `close-${selectedAlert?.id}`}><CheckCircle className="mr-2 h-4 w-4" />Close internal case</Button></>}>
          <div className="space-y-4">
            <div className="rounded-xl border border-border/70 bg-muted/[0.15] p-4 text-sm"><p className="font-medium">{selectedAlert?.title}</p><p className="mt-1 text-xs text-muted-foreground">{selectedAlert?.hostname} · evidence recorded {relativeTime(selectedAlert?.remediated_at)}</p></div>
            <div className="space-y-2"><Label htmlFor="soc-close-reason">Closure reason</Label><Textarea id="soc-close-reason" value={closeReason} onChange={e => setCloseReason(e.target.value)} rows={5} placeholder="State what is resolved, verified, or where the provider confirmation can be found." /><p className="text-xs text-muted-foreground">At least 8 characters are required to preserve the closure rationale.</p></div>
          </div>
        </NexusWorkflowDialog>
      </Dialog>
    </div>
  );
}

function DetailField({ label, children }) {
  return <div className="rounded-xl border border-border/70 bg-muted/[0.1] p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p><div className="mt-1.5 text-sm">{children}</div></div>;
}
