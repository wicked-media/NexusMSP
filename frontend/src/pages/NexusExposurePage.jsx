import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import NexusVerifiedSequence from "@/components/NexusVerifiedSequence";
import CertificateIntelPanel from "@/components/roadmap-tools/CertificateIntelPanel";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { WorkspaceErrorState, WorkspaceLoadingState } from "@/components/WorkspaceState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  Eye,
  FileSearch,
  Globe2,
  Radar,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldQuestion,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

const SURFACE = "overflow-hidden rounded-2xl border border-border/70 bg-card/90 shadow-[0_18px_45px_-34px_rgba(0,0,0,0.95)]";
const SEVERITY = {
  critical: "border-rose-400/35 bg-rose-400/[0.08] text-rose-200",
  high: "border-orange-400/35 bg-orange-400/[0.08] text-orange-200",
  medium: "border-amber-400/35 bg-amber-400/[0.08] text-amber-200",
  low: "border-sky-400/35 bg-sky-400/[0.08] text-sky-200",
  unclassified: "border-border/70 bg-muted/35 text-muted-foreground",
};
const SOURCE_STATES = {
  observed: { label: "Evidence available", className: "border-emerald-400/30 bg-emerald-400/[0.08] text-emerald-200", icon: CheckCircle2 },
  not_assessed: { label: "Not assessed", className: "border-amber-400/30 bg-amber-400/[0.08] text-amber-200", icon: ShieldQuestion },
  unavailable: { label: "Unavailable", className: "border-rose-400/30 bg-rose-400/[0.08] text-rose-200", icon: TriangleAlert },
  not_connected: { label: "Not connected", className: "border-border/70 bg-muted/30 text-muted-foreground", icon: CircleDashed },
};

function formatTime(value) {
  if (!value) return "Time not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time not recorded" : date.toLocaleString();
}

function text(value, fallback = "Not recorded") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function ExposureMetric({ label, value, description, tone = "zinc", selected, onClick }) {
  const tones = {
    rose: "border-rose-400/30 bg-rose-400/[0.055] text-rose-200",
    orange: "border-orange-400/30 bg-orange-400/[0.055] text-orange-200",
    amber: "border-amber-400/30 bg-amber-400/[0.055] text-amber-200",
    zinc: "border-border/70 bg-card/90 text-foreground",
  };
  return <button type="button" onClick={onClick} aria-pressed={selected} className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"><Card className={`${SURFACE} h-full transition-all hover:-translate-y-0.5 ${tones[tone]} ${selected ? "ring-1 ring-primary/60" : ""}`}><CardContent className="p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p><p className="mt-1 text-xs text-muted-foreground">{description}</p></CardContent></Card></button>;
}

function Detail({ label, children }) {
  return <div className="rounded-xl border border-border/70 bg-muted/[0.1] p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p><div className="mt-1.5 text-sm">{children}</div></div>;
}

export default function NexusExposurePage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [clientFilter, setClientFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState(null);
  const [discoveryOpen, setDiscoveryOpen] = useState(false);

  const load = useCallback(async ({ background = false } = {}) => {
    if (background) setRefreshing(true); else setLoading(true);
    setLoadError("");
    try {
      const response = await axios.get(`${API}/nexus-exposure/overview`, { headers });
      setData(response.data || {});
    } catch (error) {
      setLoadError(error?.response?.data?.detail || error?.message || "Nexus could not retrieve the scoped exposure evidence. No discovery or remediation action was started.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  const exposures = useMemo(() => Array.isArray(data?.exposures) ? data.exposures : [], [data]);
  const coverage = useMemo(() => Array.isArray(data?.coverage) ? data.coverage : [], [data]);
  const sources = useMemo(() => Array.isArray(data?.sources) ? data.sources : [], [data]);
  const summary = data?.summary || {};
  const clients = useMemo(() => {
    const entries = new Map();
    [...exposures, ...coverage].forEach((item) => {
      if (item?.client_id) entries.set(item.client_id, text(item.client_name, item.client_id));
    });
    return [...entries.entries()].map(([id, name]) => ({ id, name })).sort((left, right) => left.name.localeCompare(right.name));
  }, [coverage, exposures]);
  const filteredExposures = useMemo(() => exposures
    .filter((item) => clientFilter === "all" || item.client_id === clientFilter)
    .filter((item) => severityFilter === "all" || item.severity === severityFilter)
    .filter((item) => !search.trim() || [item.client_name, item.title, item.detail, item.domain, item.asset, item.source, item.category].some((value) => String(value || "").toLowerCase().includes(search.trim().toLowerCase()))), [clientFilter, exposures, search, severityFilter]);
  const filteredCoverage = useMemo(() => coverage
    .filter((item) => clientFilter === "all" || item.client_id === clientFilter)
    .filter((item) => !search.trim() || [item.client_name, item.title, item.detail, item.source].some((value) => String(value || "").toLowerCase().includes(search.trim().toLowerCase()))), [clientFilter, coverage, search]);
  const filtersActive = clientFilter !== "all" || severityFilter !== "all" || Boolean(search.trim());
  const visibleExposures = showAll ? filteredExposures : filteredExposures.slice(0, 8);
  const clearFilters = () => { setClientFilter("all"); setSeverityFilter("all"); setSearch(""); setShowAll(false); };
  const hasObservedEvidence = sources.some((source) => source.state === "observed");
  const sequenceComplete = exposures.length ? 3 : hasObservedEvidence ? 2 : 1;

  if (loading && !data) return <WorkspaceLoadingState className="mt-4" label="Assembling retained exposure evidence…" />;
  if (!loading && loadError && !data) return <WorkspaceErrorState className="mt-4" title="Nexus Exposure is unavailable" description={loadError} onRetry={load} retryLabel="Retry Exposure" onSecondaryAction={() => navigate("/nexus-shield")} secondaryLabel="Open Nexus Shield" />;

  return <div className="space-y-5" data-testid="nexus-exposure-page">
    <OperationalPageHeader
      eyebrow="Nexus Exposure · external assets and accountable evidence"
      title="Nexus Exposure"
      description="Prioritise recorded asset, certificate, domain-authentication, website and endpoint evidence—without turning unknowns into a false attack-surface score."
      icon={Radar}
      tone="amber"
      signal={summary.critical ? "attention" : summary.observed ? "steady" : "healthy"}
      actions={<><Button variant="outline" size="sm" className="rounded-xl" onClick={() => setDiscoveryOpen(true)}><Sparkles className="mr-1.5 h-3.5 w-3.5" />Prepare discovery</Button><Button size="sm" className="rounded-xl" onClick={() => load({ background: true })} disabled={refreshing} data-testid="nexus-exposure-refresh"><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />Refresh evidence</Button></>}
    />

    <Card className={`${SURFACE} border-amber-400/20 bg-amber-400/[0.035]`} data-testid="nexus-exposure-boundary"><CardContent className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-300">Discovery boundary</p><p className="mt-1 text-sm font-medium">This workspace reads retained evidence. It does not scan from the page.</p><p className="mt-1 max-w-4xl text-xs text-muted-foreground">{text(data?.boundary, "Nexus Exposure keeps evidence in the owner workspace. No domain, IP address, provider, DNS record or external service is queried by simply opening this view.")}</p></div><Badge variant="outline" className="w-fit border-amber-400/25 bg-amber-400/[0.08] text-amber-200"><ShieldCheck className="mr-1.5 h-3.5 w-3.5" />Scope-first evidence</Badge></CardContent></Card>

    {loadError && <Card className={`${SURFACE} border-amber-400/25 bg-amber-400/[0.04]`}><CardContent className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium">The latest evidence refresh did not complete</p><p className="mt-1 text-xs text-muted-foreground">{loadError} Previously retrieved records remain visible below.</p></div><Button size="sm" variant="outline" onClick={() => load({ background: true })}>Retry refresh</Button></CardContent></Card>}

    <NexusVerifiedSequence stages={["Inventory", "Observe", "Prioritise", "Govern", "Verify"]} complete={sequenceComplete} label="Nexus Exposure" />

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Nexus Exposure summary"><ExposureMetric label="Managed assets" value={summary.assets || 0} description="Domains, certificates and web assets" selected={clientFilter === "all" && severityFilter === "all"} onClick={clearFilters} /><ExposureMetric label="Critical" value={summary.critical || 0} description="Source-led response required" tone="rose" selected={severityFilter === "critical"} onClick={() => setSeverityFilter("critical")} /><ExposureMetric label="High" value={summary.high || 0} description="Prioritise accountable review" tone="orange" selected={severityFilter === "high"} onClick={() => setSeverityFilter("high")} /><ExposureMetric label="Observed signals" value={summary.observed || 0} description="Retained evidence to investigate" tone="amber" selected={severityFilter === "all" && clientFilter !== "all"} onClick={() => setSeverityFilter("all")} /><ExposureMetric label="Not proven" value={summary.not_assessed || 0} description="Coverage stays explicitly unknown" tone="zinc" selected={false} onClick={() => { setSeverityFilter("all"); setSearch(""); }} /></div>

    <CertificateIntelPanel />

    <Card className={SURFACE}><CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-300">Exposure lens</p><p className="mt-1 text-sm font-medium">{filteredExposures.length} observed signal{filteredExposures.length === 1 ? "" : "s"} · {filteredCoverage.length} coverage gap{filteredCoverage.length === 1 ? "" : "s"} in view</p><p className="mt-1 text-xs text-muted-foreground">Filter the evidence, inspect its provenance, then continue in the source workflow for any governed action.</p></div><div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"><div className="relative min-w-0 sm:w-72"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Search client, domain or evidence" value={search} onChange={(event) => setSearch(event.target.value)} data-testid="nexus-exposure-search" /></div><Select value={clientFilter} onValueChange={setClientFilter}><SelectTrigger className="w-full sm:w-[190px]" aria-label="Filter exposure by client"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All permitted clients</SelectItem>{clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}</SelectContent></Select><Select value={severityFilter} onValueChange={setSeverityFilter}><SelectTrigger className="w-full sm:w-[155px]" aria-label="Filter exposure by severity"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All severities</SelectItem><SelectItem value="critical">Critical</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent></Select>{filtersActive && <Button size="sm" variant="ghost" className="text-xs" onClick={clearFilters}>Clear filters</Button>}</div></CardContent></Card>

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(330px,0.7fr)]"><Card className={SURFACE} data-testid="nexus-exposure-board"><CardContent className="p-0"><div className="flex flex-col gap-3 border-b border-border/70 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-300">Observed exposure signals</p><h2 className="mt-1 text-base font-semibold">Prioritised by retained evidence</h2><p className="mt-1 text-xs text-muted-foreground">Signals are not an instruction to change a client service. Review the source before containment, renewal or remediation.</p></div><Badge variant="outline" className="w-fit border-amber-400/25 bg-amber-400/[0.06] text-amber-200">{filteredExposures.length} to review</Badge></div><div className="space-y-2 p-4">{visibleExposures.length ? visibleExposures.map((item) => <article key={item.id} className="rounded-xl border border-border/70 bg-muted/[0.08] p-4 transition-colors hover:bg-muted/[0.13]"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className={`text-[10px] ${SEVERITY[item.severity] || SEVERITY.unclassified}`}>{item.severity}</Badge><Badge variant="outline" className="text-[10px]">{item.category}</Badge><Badge variant="outline" className="text-[10px] text-muted-foreground">{item.source}</Badge></div><p className="mt-2 text-sm font-semibold">{item.title}</p><p className="mt-1 text-xs text-muted-foreground">{text(item.client_name, "Scoped client")} · {item.domain || item.asset || "Affected record not linked"}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{item.detail}</p></div><Button size="sm" variant="ghost" className="h-8 shrink-0 px-2 text-xs" onClick={() => setSelected(item)} data-testid={`nexus-exposure-review-${item.id}`}><Eye className="mr-1.5 h-3.5 w-3.5" />Review</Button></div></article>) : <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center"><ShieldCheck className="h-9 w-9 text-emerald-300" /><p className="mt-4 text-sm font-semibold">No observed signals match this view</p><p className="mt-1 max-w-md text-sm text-muted-foreground">This is not proof that every asset is safe. Check coverage below and connect the appropriate source evidence before making that claim.</p>{filtersActive && <Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>Clear filters</Button>}</div>}{filteredExposures.length > 8 && <div className="pt-2 text-center"><Button variant="ghost" size="sm" onClick={() => setShowAll((current) => !current)}>{showAll ? "Show priority eight" : `Show all ${filteredExposures.length} signals`}</Button></div>}</div></CardContent></Card>

      <Card className={SURFACE} data-testid="nexus-exposure-sources"><CardContent className="p-0"><div className="border-b border-border/70 p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-300">Evidence coverage</p><h2 className="mt-1 text-base font-semibold">What Nexus can—and cannot—see</h2><p className="mt-1 text-xs text-muted-foreground">A quiet source may be unassessed or unavailable. It is never silently counted as zero risk.</p></div><div className="max-h-[39rem] space-y-2 overflow-y-auto p-4">{sources.map((source) => { const state = SOURCE_STATES[source.state] || SOURCE_STATES.not_assessed; const Icon = state.icon; return <article key={source.key} className="rounded-xl border border-border/70 bg-muted/[0.08] p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-semibold">{source.label}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{source.detail}</p></div><Badge variant="outline" className={`shrink-0 text-[10px] ${state.className}`}><Icon className="mr-1 h-3 w-3" />{state.label}</Badge></div><div className="mt-3 flex items-center justify-between gap-3"><span className="text-[11px] text-muted-foreground">{source.records || 0} retained record{source.records === 1 ? "" : "s"}</span><Button asChild size="sm" variant="ghost" className="h-8 px-2 text-xs"><Link to={source.route || "/settings?tab=integrations"}>Open source queue<ArrowRight className="ml-1 h-3.5 w-3.5" /></Link></Button></div></article>; })}</div></CardContent></Card></div>

    <Card className={SURFACE} data-testid="nexus-exposure-coverage"><CardContent className="p-0"><div className="flex flex-col gap-3 border-b border-border/70 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-300">Unknowns stay visible</p><h2 className="mt-1 text-base font-semibold">Evidence gaps and unassessed coverage</h2><p className="mt-1 text-xs text-muted-foreground">These rows do not say an asset is exposed. They say Nexus cannot yet make a strong claim either way.</p></div><Badge variant="outline" className="w-fit text-muted-foreground">{filteredCoverage.length} not proven</Badge></div><div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">{filteredCoverage.length ? filteredCoverage.map((item) => <article key={item.id} className="rounded-xl border border-border/70 bg-muted/[0.08] p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold">{item.title}</p><p className="mt-1 text-xs text-muted-foreground">{text(item.client_name, "Scoped client")} · {item.source}</p></div><Badge variant="outline" className="shrink-0 border-border/70 text-[10px] text-muted-foreground">{item.evidence_state === "stale" ? "Stale" : "Unknown"}</Badge></div><p className="mt-3 min-h-10 text-xs leading-5 text-muted-foreground">{item.detail}</p><div className="mt-3 flex items-center justify-between gap-2"><p className="text-[11px] text-muted-foreground">{formatTime(item.observed_at)}</p><Button asChild size="sm" variant="ghost" className="h-8 px-2 text-xs"><Link to={item.source_route || "/settings?tab=integrations"}>Open source queue<ArrowRight className="ml-1 h-3.5 w-3.5" /></Link></Button></div></article>) : <div className="col-span-full flex min-h-48 flex-col items-center justify-center text-center"><BadgeCheck className="h-8 w-8 text-emerald-300" /><p className="mt-3 text-sm font-semibold">No coverage gaps match this view</p><p className="mt-1 text-sm text-muted-foreground">Review the source cards as connector availability still affects what Nexus can prove.</p></div>}</div></CardContent></Card>

    <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}><NexusWorkflowDialog eyebrow="Nexus Exposure evidence" title={selected?.title || "Exposure signal"} description="Validate the recorded scope and provenance before changing a customer service, external provider or security state." icon={FileSearch} tone="amber" className="max-w-3xl" footer={<><Button variant="outline" asChild><Link to={selected?.source_route || "/nexus-shield"}>Open source workflow<ExternalLink className="ml-1.5 h-3.5 w-3.5" /></Link></Button><Button onClick={() => setSelected(null)}>Done</Button></>}>
      {selected && <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-2"><Detail label="Client scope">{text(selected.client_name, "Scoped client")}</Detail><Detail label="Severity"><Badge variant="outline" className={SEVERITY[selected.severity] || SEVERITY.unclassified}>{selected.severity}</Badge></Detail><Detail label="Source">{selected.source}</Detail><Detail label="Observed">{formatTime(selected.observed_at)}</Detail><Detail label="Reachability"><Badge variant="outline" className="border-border/70 text-muted-foreground">{selected.reachability === "unknown" ? "Not assessed" : selected.reachability}</Badge></Detail><Detail label="Source record">{selected.source_record_id || "Not recorded"}</Detail></div><section className="rounded-xl border border-border/70 bg-muted/[0.12] p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Retained evidence</p><p className="mt-2 text-sm leading-6 text-foreground/90">{selected.detail}</p><ul className="mt-3 space-y-1 text-xs leading-5 text-muted-foreground">{(selected.evidence || []).map((item) => <li key={item}>• {item}</li>)}</ul></section><section className="rounded-xl border border-amber-400/20 bg-amber-400/[0.04] p-4"><p className="font-medium">Continue through the source workflow</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{selected.next_step || "Validate the source record, policy, approval and client scope before deciding on a governed action. Nexus Exposure does not close or remediate the underlying record."}</p></section></div>}
    </NexusWorkflowDialog></Dialog>

    <Dialog open={discoveryOpen} onOpenChange={setDiscoveryOpen}><NexusWorkflowDialog eyebrow="Nexus Exposure · discovery preparation" title="Make discovery authorised before it is technical" description="Prepare the correct source workflow first. Nexus Exposure intentionally cannot scan arbitrary domains, external addresses or providers." icon={Globe2} tone="amber" className="max-w-2xl" footer={<><Button variant="ghost" onClick={() => setDiscoveryOpen(false)}>Close</Button><Button asChild><Link to="/web-studio">Open managed asset register<ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Link></Button></>}><div className="grid gap-2 sm:grid-cols-3">{["1 Confirm ownership", "2 Choose source", "3 Approve work"].map((label, index) => <div key={label} className={`rounded-xl border px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider ${index === 0 ? "border-amber-400/30 bg-amber-400/[0.08] text-amber-200" : "border-border bg-muted/30 text-muted-foreground"}`}>{label}</div>)}</div><section className="rounded-xl border border-border/70 bg-muted/[0.12] p-4"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Before discovery</p><ol className="mt-3 space-y-3 text-sm leading-6"><li>1. Confirm the client-owned asset is registered with a stable Nexus client relationship.</li><li>2. Record the purpose, approved scope, owner and the safe recovery/response route.</li><li>3. Use the owning source workspace for an explicitly approved check or provider action.</li><li>4. Retain the resulting evidence, then return here to prioritise—not to infer—risk.</li></ol></section><section className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-4"><p className="text-sm font-medium">Why no scan button?</p><p className="mt-1 text-xs leading-5 text-muted-foreground">External discovery can create legal, customer-impact and security risk. Nexus will add it only with verified client ownership, action permission, timeout/rate control, idempotency and an audit trail. Until then, this workspace stays evidence-first.</p></section></NexusWorkflowDialog></Dialog>
  </div>;
}
