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
  ArrowRight, ChevronRight, Eye, Fingerprint,
  KeyRound, MapPin, RefreshCw, Search, ShieldAlert, ShieldCheck, UserRound,
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
const TYPE_LABELS = {
  impossible_travel: "Impossible travel", brute_force: "Brute-force activity", mfa_fatigue: "MFA fatigue",
  token_theft: "Token theft", privilege_escalation: "Privilege escalation", suspicious_login: "Suspicious sign-in",
  password_spray: "Password spray", account_compromise: "Possible account compromise", session_hijack: "Session hijack",
};
const MFA = {
  bypassed: { label: "Bypassed", className: "border-rose-400/35 bg-rose-400/[0.1] text-rose-200" },
  challenged: { label: "Challenged", className: "border-amber-400/35 bg-amber-400/[0.1] text-amber-200" },
  not_configured: { label: "Not configured", className: "border-rose-400/35 bg-rose-400/[0.1] text-rose-200" },
  not_enrolled: { label: "Not enrolled", className: "border-rose-400/35 bg-rose-400/[0.1] text-rose-200" },
  passed: { label: "Passed", className: "border-emerald-400/35 bg-emerald-400/[0.1] text-emerald-200" },
  unknown: { label: "Not reported", className: "border-border/80 bg-muted/30 text-muted-foreground" },
};

function textValue(value, fallback = "Not recorded") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function relativeTime(value) {
  if (!value) return "Time not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time not recorded" : formatDistanceToNow(date, { addSuffix: true });
}

function normaliseThreat(threat, index) {
  const severity = String(threat?.severity || "unknown").toLowerCase();
  const mfaStatus = String(threat?.mfa_status || threat?.mfa || "unknown").toLowerCase().replace(/\s+/g, "_");
  const status = String(threat?.status || "new").toLowerCase().replace(/\s+/g, "_");
  return {
    id: textValue(threat?.id || threat?.alert_id || threat?.incident_id, `identity-threat-${index}`),
    type: String(threat?.type || threat?.incident_type || threat?.category || "identity_signal").toLowerCase().replace(/\s+/g, "_"),
    user: textValue(threat?.user || threat?.user_principal_name || threat?.affected_user || threat?.user_email, "Identity not recorded"),
    details: textValue(threat?.details || threat?.summary || threat?.title || threat?.description, "No additional provider detail was retained."),
    sourceIp: textValue(threat?.source_ip || threat?.ip || threat?.ip_address, "Not reported"),
    location: textValue(threat?.location || threat?.source_location || threat?.geo, "Not reported"),
    mfaStatus: MFA[mfaStatus] ? mfaStatus : "unknown",
    severity: SEVERITY[severity] ? severity : "unknown",
    status,
    detectedAt: threat?.detected_at || threat?.created_at || threat?.observed_at || null,
    provider: textValue(threat?.provider || threat?.source || threat?._source, "Connected identity source"),
    client: textValue(threat?.client_name || threat?.organization || threat?.org_name, "Scoped client not recorded"),
  };
}

function Metric({ label, value, description, tone = "zinc", selected, onClick }) {
  const tones = {
    rose: "border-rose-400/30 bg-rose-400/[0.055] text-rose-200",
    amber: "border-amber-400/30 bg-amber-400/[0.055] text-amber-200",
    emerald: "border-emerald-400/30 bg-emerald-400/[0.055] text-emerald-200",
    zinc: "border-border/70 bg-card/90 text-foreground",
  };
  return <button type="button" onClick={onClick} aria-pressed={selected} className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"><Card className={`${SURFACE} h-full transition-all hover:-translate-y-0.5 ${tones[tone]} ${selected ? "ring-1 ring-primary/60" : ""}`}><CardContent className="p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p><p className="mt-1 text-xs text-muted-foreground">{description}</p></CardContent></Card></button>;
}

function Detail({ label, children }) {
  return <div className="rounded-xl border border-border/70 bg-muted/[0.1] p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p><div className="mt-1.5 text-sm">{children}</div></div>;
}

export default function IdentityThreatPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedThreat, setSelectedThreat] = useState(null);

  const loadThreats = useCallback(async ({ background = false } = {}) => {
    if (background) setRefreshing(true); else setLoading(true);
    setLoadError("");
    try {
      const response = await axios.get(`${API}/soc/identity-threats`, { headers });
      setPayload(response.data || {});
      setLastRefreshed(new Date());
    } catch (error) {
      setLoadError(error?.response?.data?.detail || error?.message || "Nexus could not retrieve scoped identity evidence. No response action has been attempted.");
      if (!background) toast.error("Identity threat evidence is unavailable. You can retry safely.");
    } finally { setLoading(false); setRefreshing(false); }
  }, [headers]);

  useEffect(() => { loadThreats(); }, [loadThreats]);

  const threats = useMemo(() => (Array.isArray(payload?.threats) ? payload.threats : []).map(normaliseThreat), [payload]);
  const sourceConfigured = payload?.source_configured === true;
  const counts = useMemo(() => ({
    critical: threats.filter((threat) => threat.severity === "critical" && !["closed", "resolved", "dismissed"].includes(threat.status)).length,
    active: threats.filter((threat) => !["closed", "resolved", "dismissed"].includes(threat.status)).length,
    mfaRisk: threats.filter((threat) => ["bypassed", "not_configured", "not_enrolled"].includes(threat.mfaStatus)).length,
    compromise: threats.filter((threat) => threat.type.includes("compromise") || threat.status.includes("compromise")).length,
  }), [threats]);
  const filteredThreats = threats
    .filter((threat) => severityFilter === "all" || threat.severity === severityFilter)
    .filter((threat) => statusFilter === "all" || (statusFilter === "active" ? !["closed", "resolved", "dismissed"].includes(threat.status) : statusFilter === "mfa-risk" ? ["bypassed", "not_configured", "not_enrolled"].includes(threat.mfaStatus) : statusFilter === "possible-compromise" ? threat.type.includes("compromise") || threat.status.includes("compromise") : threat.status === statusFilter))
    .filter((threat) => !search.trim() || [threat.type, threat.user, threat.details, threat.sourceIp, threat.location, threat.client].some((value) => value.toLowerCase().includes(search.trim().toLowerCase())));
  const filtersActive = Boolean(search.trim() || severityFilter !== "all" || statusFilter !== "all");
  const clearFilters = () => { setSearch(""); setSeverityFilter("all"); setStatusFilter("all"); };

  if (loading && !payload) return <WorkspaceLoadingState className="mt-4" label="Loading scoped identity-threat evidence…" />;
  if (!loading && loadError && !payload) return <WorkspaceErrorState className="mt-4" title="Identity-threat evidence is unavailable" description={loadError} onRetry={loadThreats} retryLabel="Retry evidence" onSecondaryAction={() => navigate("/security-dashboard")} secondaryLabel="Open Security Dashboard" />;

  return <div className="space-y-5" data-testid="identity-threats">
    <OperationalPageHeader eyebrow="Security operations · provider-backed identity evidence" title="Identity Threats" description="Review recorded identity signals from connected sources, then continue response work through the governed SOC workflow." icon={Fingerprint} tone="amber" signal={counts.critical > 0 ? "critical" : counts.active > 0 ? "attention" : "steady"} actions={<><Button asChild variant="outline" size="sm" className="rounded-xl"><Link to="/soc-realtime">Realtime evidence<ChevronRight className="ml-1.5 h-3.5 w-3.5" /></Link></Button><Button size="sm" className="rounded-xl" onClick={() => loadThreats({ background: true })} disabled={refreshing} data-testid="identity-threats-refresh"><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />Refresh evidence</Button></>} />

    <Card className={`${SURFACE} ${sourceConfigured ? "border-sky-400/20 bg-sky-400/[0.035]" : "border-amber-400/20 bg-amber-400/[0.035]"}`} data-testid="identity-threats-evidence-state"><CardContent className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div><p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${sourceConfigured ? "text-sky-300" : "text-amber-300"}`}>Evidence source</p><p className="mt-1 text-sm font-medium">{sourceConfigured ? "Identity evidence is connected and scoped." : "No identity telemetry provider is connected."}</p><p className="mt-1 text-xs text-muted-foreground">{sourceConfigured ? "Nexus shows recorded provider evidence only; a clear feed is not a claim that every identity system is healthy." : "Connect a supported provider to display identity incidents. Nexus will not fabricate threat history or MFA exposure."}</p></div><div className="flex flex-wrap gap-2"><Badge variant="outline" className={sourceConfigured ? "border-sky-400/25 bg-sky-400/[0.08] text-sky-200" : "border-amber-400/25 bg-amber-400/[0.08] text-amber-200"}>{sourceConfigured ? "Provider evidence · connected" : "Provider evidence · not connected"}</Badge><Badge variant="outline" className="text-muted-foreground">{lastRefreshed ? `Refreshed ${relativeTime(lastRefreshed)}` : "Refresh time not recorded"}</Badge></div></CardContent></Card>

    {loadError && <Card className={`${SURFACE} border-amber-400/25 bg-amber-400/[0.04]`}><CardContent className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium">The last identity-evidence refresh did not complete</p><p className="mt-1 text-xs text-muted-foreground">{loadError} Previously retrieved evidence remains visible below.</p></div><Button size="sm" variant="outline" onClick={() => loadThreats({ background: true })}>Retry refresh</Button></CardContent></Card>}

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Identity threat summary"><Metric label="Critical active" value={counts.critical} description="Critical evidence not yet closed" tone="rose" selected={severityFilter === "critical"} onClick={() => { setSeverityFilter("critical"); setStatusFilter("all"); }} /><Metric label="Active signals" value={counts.active} description="Provider cases needing review" tone="amber" selected={statusFilter === "active"} onClick={() => { setStatusFilter("active"); setSeverityFilter("all"); }} /><Metric label="MFA risk signals" value={counts.mfaRisk} description="Only provider-reported MFA risk" tone="amber" selected={statusFilter === "mfa-risk"} onClick={() => { setStatusFilter("mfa-risk"); setSeverityFilter("all"); }} /><Metric label="Possible compromise" value={counts.compromise} description="Signals labelled by the provider" tone="rose" selected={statusFilter === "possible-compromise"} onClick={() => { setStatusFilter("possible-compromise"); setSeverityFilter("all"); }} /></div>

    <Card className={SURFACE}><CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-300">Identity evidence</p><p className="mt-1 text-sm font-medium">{filteredThreats.length} of {threats.length} provider record{threats.length === 1 ? "" : "s"} shown</p><p className="mt-1 text-xs text-muted-foreground">Search is limited to the currently permitted client scope; response actions stay in SOC Alert Feed.</p></div><div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"><div className="relative min-w-0 sm:w-72"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Search identity, signal, IP or location" value={search} onChange={(event) => setSearch(event.target.value)} data-testid="identity-threats-search" /></div><Select value={severityFilter} onValueChange={setSeverityFilter}><SelectTrigger className="w-full sm:w-[142px]" aria-label="Filter identity evidence by severity"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All severity</SelectItem><SelectItem value="critical">Critical</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent></Select><Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-full sm:w-[160px]" aria-label="Filter identity evidence by state"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All evidence states</SelectItem><SelectItem value="active">Active signals</SelectItem><SelectItem value="mfa-risk">MFA risk signals</SelectItem><SelectItem value="possible-compromise">Possible compromise</SelectItem><SelectItem value="new">Needs triage</SelectItem><SelectItem value="investigating">Investigating</SelectItem><SelectItem value="closed">Closed</SelectItem></SelectContent></Select>{filtersActive && <Button variant="ghost" size="sm" className="text-xs" onClick={clearFilters} data-testid="identity-threats-clear-filters">Clear filters</Button>}</div></CardContent></Card>

    <section className="grid gap-3" aria-label="Identity evidence cases">{filteredThreats.length === 0 ? <Card className={`${SURFACE} border-dashed`} data-testid="identity-threats-empty-state"><CardContent className="flex min-h-72 flex-col items-center justify-center px-6 py-12 text-center">{filtersActive ? <><Search className="h-8 w-8 text-muted-foreground" /><p className="mt-4 text-sm font-semibold">No identity evidence matches this view</p><p className="mt-1 max-w-md text-sm text-muted-foreground">Broaden the filters or clear them to return to the scoped provider record.</p><Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>Clear filters</Button></> : sourceConfigured ? <><ShieldCheck className="h-9 w-9 text-emerald-300" /><p className="mt-4 text-sm font-semibold">No provider-backed identity incidents are recorded in this scope</p><p className="mt-1 max-w-lg text-sm text-muted-foreground">A clear evidence feed does not prove that every identity system, sign-in path, or account is healthy.</p><div className="mt-4 flex flex-wrap justify-center gap-2"><Button asChild size="sm"><Link to="/soc-feed">Open SOC alert feed</Link></Button><Button variant="outline" size="sm" onClick={() => loadThreats({ background: true })}>Refresh evidence</Button></div></> : <><Fingerprint className="h-9 w-9 text-amber-300" /><p className="mt-4 text-sm font-semibold">Connect identity telemetry to begin evidence collection</p><p className="mt-1 max-w-lg text-sm text-muted-foreground">Connect a supported identity provider in Settings. Nexus will then surface only the recorded, client-scoped incidents that provider supplies.</p><Button asChild className="mt-4" size="sm"><Link to="/settings?tab=integrations">Open integrations<ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Link></Button></>}</CardContent></Card> : filteredThreats.map((threat) => {
      const severity = SEVERITY[threat.severity] || SEVERITY.unknown;
      const mfa = MFA[threat.mfaStatus] || MFA.unknown;
      const isCritical = threat.severity === "critical" && !["closed", "resolved", "dismissed"].includes(threat.status);
      return <article key={threat.id} data-testid={`identity-threat-${threat.id}`}><Card className={`${SURFACE} transition-all hover:-translate-y-0.5 hover:bg-muted/30 ${isCritical ? "border-rose-400/30 bg-rose-400/[0.035]" : ""}`}><CardContent className="p-4"><div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className={`text-[10px] ${severity.className}`}>{severity.label}</Badge><Badge variant="outline" className="text-[10px]">{TYPE_LABELS[threat.type] || threat.type.replace(/_/g, " ")}</Badge><Badge className="text-[10px] capitalize">{threat.status.replace(/_/g, " ")}</Badge></div><div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2"><p className="flex items-center gap-2 text-sm font-semibold"><UserRound className="h-4 w-4 text-sky-300" />{threat.user}</p><span className="text-xs text-muted-foreground">Recorded {relativeTime(threat.detectedAt)}</span></div><p className="mt-2 max-w-4xl text-sm leading-6 text-muted-foreground">{threat.details}</p><div className="mt-3 flex flex-wrap gap-2"><Badge variant="outline" className="font-mono text-[10px]">IP · {threat.sourceIp}</Badge><Badge variant="outline" className="text-[10px]"><MapPin className="mr-1 h-3 w-3" />{threat.location}</Badge><Badge variant="outline" className={`text-[10px] ${mfa.className}`}><KeyRound className="mr-1 h-3 w-3" />MFA · {mfa.label}</Badge><Badge variant="outline" className="text-[10px]">{threat.provider}</Badge></div></div><Button size="sm" variant="ghost" className="h-8 shrink-0 px-2 text-xs" onClick={() => setSelectedThreat(threat)} data-testid={`review-identity-threat-${threat.id}`}><Eye className="mr-1.5 h-3.5 w-3.5" />Review evidence</Button></div></CardContent></Card></article>;
    })}</section>

    <Dialog open={Boolean(selectedThreat)} onOpenChange={(open) => !open && setSelectedThreat(null)}><NexusWorkflowDialog eyebrow="Provider-backed identity evidence" title={selectedThreat ? (TYPE_LABELS[selectedThreat.type] || selectedThreat.type.replace(/_/g, " ")) : "Identity signal"} description="Review the retained evidence before starting or continuing the governed response workflow." icon={ShieldAlert} tone="amber" className="max-w-3xl" footer={<><Button variant="outline" asChild><Link to="/soc-feed">Open SOC alert feed<ChevronRight className="ml-1.5 h-3.5 w-3.5" /></Link></Button><Button onClick={() => setSelectedThreat(null)}>Done</Button></>}>
      {selectedThreat && <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-2"><Detail label="Identity"><span className="font-mono text-xs">{selectedThreat.user}</span></Detail><Detail label="Recorded"><span>{relativeTime(selectedThreat.detectedAt)}</span></Detail><Detail label="Severity"><Badge variant="outline" className={SEVERITY[selectedThreat.severity]?.className}>{SEVERITY[selectedThreat.severity]?.label || "Unclassified"}</Badge></Detail><Detail label="Case state"><Badge className="capitalize">{selectedThreat.status.replace(/_/g, " ")}</Badge></Detail><Detail label="Source IP"><span className="font-mono text-xs">{selectedThreat.sourceIp}</span></Detail><Detail label="Location">{selectedThreat.location}</Detail><Detail label="MFA evidence"><Badge variant="outline" className={MFA[selectedThreat.mfaStatus]?.className}>{MFA[selectedThreat.mfaStatus]?.label || "Not reported"}</Badge></Detail><Detail label="Provider">{selectedThreat.provider}</Detail></div><section className="rounded-xl border border-border/70 bg-muted/[0.12] p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Captured provider detail</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground/90">{selectedThreat.details}</p></section><section className="rounded-xl border border-sky-400/20 bg-sky-400/[0.05] p-4"><p className="font-medium">Response remains governed</p><p className="mt-1 text-sm text-muted-foreground">This workspace records provider evidence; it does not declare remediation. Continue in SOC Alert Feed so approvals, reasons, permissions, and audit records are applied consistently.</p></section></div>}
    </NexusWorkflowDialog></Dialog>
  </div>;
}
