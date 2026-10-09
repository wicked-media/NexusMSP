import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import NexusVerifiedSequence from "@/components/NexusVerifiedSequence";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { WorkspaceErrorState, WorkspaceLoadingState } from "@/components/WorkspaceState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, CheckCircle2, ChevronRight, CircleDashed, Database, Eye, FileSearch, RefreshCw, Search, ShieldCheck, ShieldQuestion } from "lucide-react";

const SURFACE = "overflow-hidden rounded-2xl border border-border/70 bg-card/90 shadow-[0_18px_45px_-34px_rgba(0,0,0,0.95)]";

const SEVERITY_TONE = {
  critical: "border-rose-400/45 bg-rose-400/[0.09] text-rose-200",
  high: "border-rose-400/35 bg-rose-400/[0.07] text-rose-200",
  medium: "border-amber-400/35 bg-amber-400/[0.07] text-amber-200",
  low: "border-sky-400/35 bg-sky-400/[0.07] text-sky-200",
};

const SOURCE_STATE = {
  observed: { label: "Evidence observed", className: "border-emerald-400/30 bg-emerald-400/[0.08] text-emerald-200", icon: CheckCircle2 },
  partial: { label: "Partial capture", className: "border-amber-400/30 bg-amber-400/[0.08] text-amber-200", icon: CircleDashed },
  not_observed: { label: "Not observed", className: "border-border/70 bg-muted/30 text-muted-foreground", icon: ShieldQuestion },
};

const CATEGORY_TONE = {
  ownership: "text-rose-200 border-rose-400/20 bg-rose-400/[0.04]",
  identity: "text-sky-200 border-sky-400/20 bg-sky-400/[0.04]",
  contacts: "text-violet-200 border-violet-400/20 bg-violet-400/[0.04]",
  operational: "text-amber-200 border-amber-400/20 bg-amber-400/[0.04]",
};

function textValue(value, fallback = "Not recorded") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function formatTime(value) {
  if (!value) return "Evaluation time not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Evaluation time not recorded" : date.toLocaleString();
}

function scoreLabel(value) {
  return typeof value === "number" ? `${value}%` : "Not assessed";
}

function severityLabel(value) {
  return textValue(value, "attention").replace(/_/g, " ");
}

function EvidenceMetric({ label, value, description, tone = "zinc", selected, onClick }) {
  const tones = {
    emerald: "border-emerald-400/30 bg-emerald-400/[0.055] text-emerald-200",
    amber: "border-amber-400/30 bg-amber-400/[0.055] text-amber-200",
    rose: "border-rose-400/30 bg-rose-400/[0.055] text-rose-200",
    sky: "border-sky-400/30 bg-sky-400/[0.055] text-sky-200",
    zinc: "border-border/70 bg-card/90 text-foreground",
  };
  return <button type="button" onClick={onClick} aria-pressed={selected} className={`rounded-2xl border p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 ${tones[tone] || tones.zinc} ${selected ? "ring-1 ring-primary/70" : ""}`}>
    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] opacity-75">{label}</p>
    <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
    <p className="mt-1 min-h-8 text-xs leading-5 text-muted-foreground">{description}</p>
  </button>;
}

function Detail({ label, children }) {
  return <div className="rounded-xl border border-border/70 bg-muted/[0.1] p-3">
    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
    <div className="mt-1.5 text-sm leading-5 text-foreground/90">{children || "Not recorded"}</div>
  </div>;
}

export default function NexusDataQualityPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [clientFilter, setClientFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [showAll, setShowAll] = useState(false);
  const [selectedFinding, setSelectedFinding] = useState(null);

  const headers = useMemo(() => (token ? { Authorization: `Bearer ${token}` } : {}), [token]);
  const loadDataQuality = useCallback(async ({ background = false } = {}) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    setLoadError("");
    try {
      const response = await axios.get(`${API}/data-quality/overview`, { headers });
      setData(response.data || null);
    } catch (error) {
      const message = error?.response?.data?.detail || error?.message || "Nexus could not retrieve the retained records needed for this review.";
      setLoadError(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [headers]);

  useEffect(() => { loadDataQuality(); }, [loadDataQuality]);

  const summary = data?.summary || {};
  const findings = useMemo(() => Array.isArray(data?.findings) ? data.findings : [], [data]);
  const sources = useMemo(() => Array.isArray(data?.sources) ? data.sources : [], [data]);
  const categories = useMemo(() => Array.isArray(data?.categories) ? data.categories : [], [data]);
  const clients = useMemo(() => Array.isArray(data?.clients) ? data.clients : [], [data]);
  const filteredFindings = useMemo(() => findings.filter((finding) => {
    const term = search.trim().toLowerCase();
    const matchesSearch = !term || [finding.title, finding.detail, finding.client_name, finding.object?.label, finding.object?.type, finding.category]
      .some((value) => String(value || "").toLowerCase().includes(term));
    return matchesSearch
      && (clientFilter === "all" || finding.client_id === clientFilter)
      && (categoryFilter === "all" || finding.category === categoryFilter)
      && (severityFilter === "all" || finding.severity === severityFilter);
  }).sort((left, right) => (
    ({ critical: 0, high: 1, medium: 2, low: 3 }[left.severity] ?? 4) - ({ critical: 0, high: 1, medium: 2, low: 3 }[right.severity] ?? 4)
  )), [findings, search, clientFilter, categoryFilter, severityFilter]);
  const visibleFindings = showAll ? filteredFindings : filteredFindings.slice(0, 8);
  const filtersActive = Boolean(search.trim()) || clientFilter !== "all" || categoryFilter !== "all" || severityFilter !== "all";
  const clearFilters = () => { setSearch(""); setClientFilter("all"); setCategoryFilter("all"); setSeverityFilter("all"); setShowAll(false); };
  const observedSources = Number(summary.sources_observed || 0);
  const partialSources = Number(summary.sources_partial || 0);
  const capturePartial = summary.capture_state === "partial";
  const stage = summary.state === "not_assessed" ? 1 : summary.findings || capturePartial ? 3 : 5;

  if (loading && !data) return <WorkspaceLoadingState className="mt-4" label="Evaluating retained, scoped data evidence…" />;
  if (!loading && loadError && !data) return <WorkspaceErrorState className="mt-4" title="Nexus Data Quality is unavailable" description={loadError} onRetry={loadDataQuality} retryLabel="Retry evaluation" onSecondaryAction={() => navigate("/clients")} secondaryLabel="Open Clients" />;

  return <div className="space-y-5" data-testid="nexus-data-quality">
    <OperationalPageHeader
      eyebrow="Nexus Data Quality · evidence before automation"
      title="Nexus Data Quality"
      description="Find the records that could make work unreliable—without guessing, overwriting source data or creating a second system of record."
      icon={Database}
      tone="sky"
      signal={summary.state === "attention_required" ? "attention" : summary.state === "observed_clean" ? "healthy" : "steady"}
      actions={<><Button size="sm" variant="outline" className="rounded-xl" onClick={() => navigate("/clients")}>Client records<ChevronRight className="ml-1.5 h-3.5 w-3.5" /></Button><Button size="sm" className="rounded-xl" onClick={() => loadDataQuality({ background: true })} disabled={refreshing} data-testid="nexus-data-quality-refresh"><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />Refresh evidence</Button></>}
    />

    <Card className={`${SURFACE} border-sky-400/20 bg-sky-400/[0.035]`} data-testid="nexus-data-quality-boundary"><CardContent className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-300">Evidence boundary</p><p className="mt-1 text-sm font-medium">{capturePartial ? "The review window is incomplete." : "A clean signal is not a fabricated claim."}</p><p className="mt-1 max-w-4xl text-xs leading-5 text-muted-foreground">{textValue(data?.boundary, "Nexus evaluates only the retained records and deterministic checks shown in this workspace.")}</p></div><div className="flex flex-wrap gap-2"><Badge variant="outline" className="border-sky-400/25 bg-sky-400/[0.08] text-sky-200">{data?.scope?.mode === "all_clients" ? "All-client review" : "Restricted client review"}</Badge>{capturePartial && <Badge variant="outline" className="border-amber-400/30 bg-amber-400/[0.08] text-amber-200">{partialSources} source{partialSources === 1 ? "" : "s"} capped</Badge>}<Badge variant="outline" className="text-muted-foreground">Evaluated {formatTime(data?.generated_at)}</Badge></div></CardContent></Card>

    {loadError && <Card className={`${SURFACE} border-amber-400/25 bg-amber-400/[0.04]`}><CardContent className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium">The latest refresh did not complete</p><p className="mt-1 text-xs text-muted-foreground">{loadError} Previously retrieved evidence remains visible; no source data was changed.</p></div><Button size="sm" variant="outline" onClick={() => loadDataQuality({ background: true })}>Retry refresh</Button></CardContent></Card>}

    <NexusVerifiedSequence stages={["Observe", "Validate", "Review", "Correct", "Prove"]} complete={stage} label="Nexus Data Quality" />

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Nexus Data Quality summary">
      <EvidenceMetric label="Records examined" value={summary.records_examined || 0} description={capturePartial ? "Captured in the current limited review window" : "Within the current permitted client scope"} tone="zinc" selected={!filtersActive} onClick={clearFilters} />
      <EvidenceMetric label="Observed signal" value={scoreLabel(summary.observed_quality_signal)} description="Deterministic checks passed; not a compliance score" tone={summary.observed_quality_signal == null ? "zinc" : summary.observed_quality_signal >= 90 ? "emerald" : "amber"} selected={severityFilter === "all" && categoryFilter === "all"} onClick={() => { setSeverityFilter("all"); setCategoryFilter("all"); }} />
      <EvidenceMetric label="Needs review" value={summary.findings || 0} description={`${summary.affected_records || 0} retained record${summary.affected_records === 1 ? "" : "s"} affected`} tone={summary.findings ? "amber" : "emerald"} selected={severityFilter !== "all" || categoryFilter !== "all"} onClick={() => { setSeverityFilter("all"); setCategoryFilter("all"); setShowAll(true); }} />
      <EvidenceMetric label="Sources observed" value={`${observedSources + partialSources}/${sources.length}`} description={capturePartial ? `${partialSources} source${partialSources === 1 ? "" : "s"} reached the review limit` : `${summary.sources_not_observed || 0} source${summary.sources_not_observed === 1 ? "" : "s"} not observed in this scope`} tone={observedSources || partialSources ? "sky" : "zinc"} selected={false} onClick={() => document.getElementById("nexus-data-quality-sources")?.scrollIntoView({ behavior: "smooth", block: "start" })} />
    </div>

    <Card className={SURFACE}><CardContent className="flex flex-col gap-3 p-4 xl:flex-row xl:items-end xl:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-300">Quality lens</p><p className="mt-1 text-sm font-medium">{filteredFindings.length} review item{filteredFindings.length === 1 ? "" : "s"} in view</p><p className="mt-1 text-xs text-muted-foreground">Filter the evidence, inspect why it is flagged, then correct it in the source workspace.</p></div><div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"><div className="relative min-w-0 sm:w-72"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Search record, client or check" value={search} onChange={(event) => setSearch(event.target.value)} data-testid="nexus-data-quality-search" /></div><Select value={clientFilter} onValueChange={setClientFilter}><SelectTrigger className="w-full sm:w-[190px]" aria-label="Filter data quality by client"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All permitted clients</SelectItem>{clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}</SelectContent></Select><Select value={categoryFilter} onValueChange={setCategoryFilter}><SelectTrigger className="w-full sm:w-[180px]" aria-label="Filter data quality by category"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All quality areas</SelectItem>{categories.map((category) => <SelectItem key={category.id} value={category.id}>{category.label}</SelectItem>)}</SelectContent></Select><Select value={severityFilter} onValueChange={setSeverityFilter}><SelectTrigger className="w-full sm:w-[155px]" aria-label="Filter data quality by severity"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All severities</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent></Select>{filtersActive && <Button size="sm" variant="ghost" className="text-xs" onClick={clearFilters} data-testid="nexus-data-quality-clear-filters">Clear filters</Button>}</div></CardContent></Card>

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.24fr)_minmax(320px,0.76fr)]">
      <Card className={SURFACE} data-testid="nexus-data-quality-findings"><CardContent className="p-0"><div className="flex flex-col gap-3 border-b border-border/70 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-300">Review before changing</p><h2 className="mt-1 text-base font-semibold">Data quality attention board</h2><p className="mt-1 text-xs text-muted-foreground">Each signal is a retained evidence discrepancy—not an instruction to merge, archive or overwrite a record.</p></div><Badge variant="outline" className="w-fit border-amber-400/25 bg-amber-400/[0.06] text-amber-200">{filteredFindings.length} to review</Badge></div><div className="space-y-2 p-4">{visibleFindings.length ? visibleFindings.map((finding) => <article key={finding.id} className="flex flex-col gap-3 rounded-xl border border-border/70 bg-muted/[0.08] p-4 transition-colors hover:bg-muted/[0.13]"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap gap-2"><Badge variant="outline" className={`capitalize text-[10px] ${SEVERITY_TONE[finding.severity] || SEVERITY_TONE.low}`}>{severityLabel(finding.severity)}</Badge><Badge variant="outline" className={`text-[10px] ${CATEGORY_TONE[finding.category] || ""}`}>{textValue(finding.category, "quality").replace(/_/g, " ")}</Badge></div><p className="mt-2 text-sm font-semibold">{textValue(finding.title)}</p><p className="mt-1 text-xs text-muted-foreground">{textValue(finding.client_name, "Global ownership review")} · {textValue(finding.object?.type, "record")} · {textValue(finding.object?.label, "Retained record")}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{textValue(finding.detail)}</p></div><Button size="sm" variant="ghost" className="h-8 shrink-0 px-2 text-xs" onClick={() => setSelectedFinding(finding)} data-testid={`nexus-data-quality-review-${finding.id}`}><Eye className="mr-1.5 h-3.5 w-3.5" />Review</Button></div></article>) : <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center">{summary.state === "observed_clean" ? <ShieldCheck className="h-9 w-9 text-emerald-300" /> : <CircleDashed className="h-9 w-9 text-muted-foreground" />}<p className="mt-4 text-sm font-semibold">{summary.state === "observed_clean" ? "No quality signals match this view" : capturePartial ? "The captured review window has no signals" : "No retained data evidence is available for this view"}</p><p className="mt-1 max-w-md text-sm text-muted-foreground">{summary.state === "observed_clean" ? "This only means Nexus found no issue in the deterministic checks shown. It does not prove every record is complete." : capturePartial ? "One or more sources reached the review limit. Inspect source coverage before treating this view as complete." : "Nexus will not generate sample problems or treat missing sources as healthy."}</p>{filtersActive && <Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>Clear filters</Button>}</div>}{filteredFindings.length > 8 && <div className="pt-2 text-center"><Button variant="ghost" size="sm" onClick={() => setShowAll((current) => !current)}>{showAll ? "Show priority eight" : `Show all ${filteredFindings.length} review items`}</Button></div>}</div></CardContent></Card>

      <div className="space-y-5"><Card className={SURFACE} id="nexus-data-quality-sources" data-testid="nexus-data-quality-sources"><CardContent className="p-0"><div className="border-b border-border/70 p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-300">Source coverage</p><h2 className="mt-1 text-base font-semibold">What Nexus actually examined</h2><p className="mt-1 text-xs text-muted-foreground">No provider, cache or empty collection is silently represented as a clean dataset.</p></div><div className="space-y-2 p-4">{sources.map((source) => { const state = SOURCE_STATE[source.state] || SOURCE_STATE.not_observed; const SourceIcon = state.icon; return <article key={source.id} className="rounded-xl border border-border/70 bg-muted/[0.08] p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-semibold">{textValue(source.label)}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{textValue(source.detail)}</p></div><Badge variant="outline" className={`shrink-0 text-[10px] ${state.className}`}><SourceIcon className="mr-1 h-3 w-3" />{source.record_count || 0}</Badge></div><p className="mt-2 text-[10px] text-muted-foreground">{state.label}</p></article>; })}</div></CardContent></Card>
        <Card className={SURFACE} data-testid="nexus-data-quality-categories"><CardContent className="p-0"><div className="border-b border-border/70 p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300">Quality map</p><h2 className="mt-1 text-base font-semibold">Which data relationship needs care?</h2></div><div className="space-y-2 p-4">{categories.map((category) => <button key={category.id} type="button" onClick={() => { setCategoryFilter(category.id); setShowAll(true); }} className={`w-full rounded-xl border p-3 text-left transition-colors hover:bg-muted/[0.13] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 ${categoryFilter === category.id ? "border-primary/50 bg-primary/[0.06]" : "border-border/70 bg-muted/[0.08]"}`}><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold">{category.label}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{category.detail}</p></div><Badge variant="outline" className={`shrink-0 text-[10px] ${category.finding_count ? "border-amber-400/25 bg-amber-400/[0.06] text-amber-200" : "text-muted-foreground"}`}>{category.finding_count || 0}</Badge></div></button>)}</div></CardContent></Card></div>
    </div>

    <Dialog open={Boolean(selectedFinding)} onOpenChange={(open) => !open && setSelectedFinding(null)}><NexusWorkflowDialog eyebrow="Retained data-quality evidence" title={selectedFinding?.title || "Data-quality review"} description="Inspect the scope and evidence, then use the owning workspace for a governed correction. This review does not change any record." icon={FileSearch} tone="sky" className="max-w-3xl" footer={<><Button variant="outline" onClick={() => { const route = selectedFinding?.route || "/clients"; setSelectedFinding(null); navigate(route); }}>Open source workspace<ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Button><Button onClick={() => setSelectedFinding(null)}>Done</Button></>}>
      {selectedFinding && <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-2"><Detail label="Client scope">{selectedFinding.client_name || "All-client ownership review"}</Detail><Detail label="Severity"><Badge variant="outline" className={`capitalize ${SEVERITY_TONE[selectedFinding.severity] || SEVERITY_TONE.low}`}>{severityLabel(selectedFinding.severity)}</Badge></Detail><Detail label="Record type">{textValue(selectedFinding.object?.type, "Record").replace(/_/g, " ")}</Detail><Detail label="Record label">{textValue(selectedFinding.object?.label, "Retained record")}</Detail><Detail label="Expected">{selectedFinding.expected ?? "Not declared"}</Detail><Detail label="Observed">{selectedFinding.observed ?? "Not recorded"}</Detail></div><section className="rounded-xl border border-border/70 bg-muted/[0.12] p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Recorded evidence</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground/90">{textValue(selectedFinding.detail)}</p></section><section className="rounded-xl border border-sky-400/20 bg-sky-400/[0.04] p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-200">Evidence boundary</p><p className="mt-2 text-sm leading-6 text-muted-foreground">{textValue(selectedFinding.provenance?.boundary, "Nexus has retained a deterministic signal only. Verify the source history before making any correction.")}</p><p className="mt-2 text-xs text-muted-foreground">Sources: {(selectedFinding.provenance?.sources || []).join(" · ") || "Not recorded"}</p></section><section className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.05] p-4"><p className="font-medium">Correct through the owning workflow</p><p className="mt-1 text-sm text-muted-foreground">Use the source workspace to validate, merge, archive or update a record under its existing permissions and audit trail. Nexus Data Quality remains a transparent review layer.</p></section></div>}
    </NexusWorkflowDialog></Dialog>
  </div>;
}
