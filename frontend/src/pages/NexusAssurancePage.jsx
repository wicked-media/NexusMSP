import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import NexusVerifiedSequence from "@/components/NexusVerifiedSequence";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { WorkspaceErrorState, WorkspaceLoadingState } from "@/components/WorkspaceState";
import StandardsAsCodePanel from "@/components/roadmap-tools/StandardsAsCodePanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronRight, CircleDashed, Eye, FileSearch, Gauge, RefreshCw, Search, ShieldCheck, ShieldQuestion } from "lucide-react";

const SURFACE = "overflow-hidden rounded-2xl border border-border/70 bg-card/90 shadow-[0_18px_45px_-34px_rgba(0,0,0,0.95)]";
const CONTROL_STATE = {
  covered: { label: "Evidence recorded", className: "border-emerald-400/30 bg-emerald-400/[0.08] text-emerald-200", icon: CheckCircle2 },
  gap: { label: "Needs attention", className: "border-amber-400/30 bg-amber-400/[0.08] text-amber-200", icon: AlertTriangle },
  not_assessed: { label: "Not proven", className: "border-border/70 bg-muted/30 text-muted-foreground", icon: ShieldQuestion },
};
const FINDING_TONE = {
  high: "border-rose-400/35 bg-rose-400/[0.07] text-rose-200",
  medium: "border-amber-400/35 bg-amber-400/[0.07] text-amber-200",
  low: "border-sky-400/35 bg-sky-400/[0.07] text-sky-200",
};
const SOURCE_LABELS = {
  clients: "Client register",
  devices: "Device register",
  nexus_agents: "Nexus Agent",
  subscriptions: "Services & subscriptions",
  backup_jobs: "Backup Centre",
  backup_verifications: "Recovery verification",
  cipp_hygiene_cache: "Microsoft Control Plane",
};

function textValue(value, fallback = "Not recorded") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function formatEvidenceTime(value) {
  if (!value) return "Evaluation time not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Evaluation time not recorded" : date.toLocaleString();
}

function evidenceSources(control) {
  const sources = Array.isArray(control?.provenance?.sources) ? control.provenance.sources : [];
  return sources.map((source) => SOURCE_LABELS[source] || source).join(" · ") || "Source not recorded";
}

function EvidenceMetric({ label, value, description, tone = "zinc", selected, onClick }) {
  const tones = {
    emerald: "border-emerald-400/30 bg-emerald-400/[0.055] text-emerald-200",
    amber: "border-amber-400/30 bg-amber-400/[0.055] text-amber-200",
    rose: "border-rose-400/30 bg-rose-400/[0.055] text-rose-200",
    zinc: "border-border/70 bg-card/90 text-foreground",
  };
  return <button type="button" onClick={onClick} aria-pressed={selected} className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"><Card className={`${SURFACE} h-full transition-all hover:-translate-y-0.5 ${tones[tone]} ${selected ? "ring-1 ring-primary/60" : ""}`}><CardContent className="p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p><p className="mt-1 text-xs text-muted-foreground">{description}</p></CardContent></Card></button>;
}

function Detail({ label, children }) {
  return <div className="rounded-xl border border-border/70 bg-muted/[0.1] p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p><div className="mt-1.5 text-sm">{children}</div></div>;
}

export default function NexusAssurancePage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [clientFilter, setClientFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [showAllFindings, setShowAllFindings] = useState(false);
  const [showAllControls, setShowAllControls] = useState(false);
  const [selectedEvidence, setSelectedEvidence] = useState(null);

  const loadAssurance = useCallback(async ({ background = false } = {}) => {
    if (background) setRefreshing(true); else setLoading(true);
    setLoadError("");
    try {
      const response = await axios.get(`${API}/assurance/overview`, { headers });
      setData(response.data || {});
    } catch (error) {
      setLoadError(error?.response?.data?.detail || error?.message || "Nexus could not retrieve the scoped assurance evidence. No remediation action has been started.");
      if (!background) toast.error("Nexus Assurance is unavailable. You can retry safely.");
    } finally { setLoading(false); setRefreshing(false); }
  }, [headers]);

  useEffect(() => { loadAssurance(); }, [loadAssurance]);

  const controls = useMemo(() => Array.isArray(data?.controls) ? data.controls : [], [data]);
  const findings = useMemo(() => Array.isArray(data?.findings) ? data.findings : [], [data]);
  const coverage = useMemo(() => Array.isArray(data?.coverage) ? data.coverage : [], [data]);
  const summary = data?.summary || {};
  const clients = useMemo(() => {
    const items = new Map();
    controls.forEach((control) => {
      if (control?.client_id) items.set(control.client_id, textValue(control.client_name, control.client_id));
    });
    findings.forEach((finding) => {
      if (finding?.client_id) items.set(finding.client_id, textValue(finding.client_name, finding.client_id));
    });
    return [...items.entries()].map(([id, name]) => ({ id, name })).sort((left, right) => left.name.localeCompare(right.name));
  }, [controls, findings]);
  const stateCounts = useMemo(() => ({
    evidenced: controls.filter((item) => item.status === "covered").length,
    attention: controls.filter((item) => item.status === "gap").length,
    notProven: controls.filter((item) => item.status === "not_assessed").length,
  }), [controls]);
  const filteredControls = controls
    .filter((item) => clientFilter === "all" || item.client_id === clientFilter)
    .filter((item) => stateFilter === "all" || item.status === stateFilter)
    .filter((item) => !search.trim() || [item.client_name, item.label, item.detail, item.control_id].some((value) => String(value || "").toLowerCase().includes(search.trim().toLowerCase())))
    .sort((left, right) => ({ gap: 0, not_assessed: 1, covered: 2 }[left.status] ?? 3) - ({ gap: 0, not_assessed: 1, covered: 2 }[right.status] ?? 3));
  const filteredFindings = findings
    .filter((item) => clientFilter === "all" || item.client_id === clientFilter)
    .filter((item) => !search.trim() || [item.client_name, item.title, item.domain, item.next_step].some((value) => String(value || "").toLowerCase().includes(search.trim().toLowerCase())));
  const filteredCoverage = coverage.filter((item) => clientFilter === "all" || item.client_id === clientFilter);
  const filtersActive = clientFilter !== "all" || stateFilter !== "all" || Boolean(search.trim());
  const clearFilters = () => { setClientFilter("all"); setStateFilter("all"); setSearch(""); setShowAllFindings(false); setShowAllControls(false); };
  const visibleFindings = showAllFindings ? filteredFindings : filteredFindings.slice(0, 6);
  const visibleControls = showAllControls ? filteredControls : filteredControls.slice(0, 12);
  const assuranceStage = !data ? 1 : stateCounts.attention ? 3 : stateCounts.notProven ? 2 : 4;

  if (loading && !data) return <WorkspaceLoadingState className="mt-4" label="Building scoped assurance evidence…" />;
  if (!loading && loadError && !data) return <WorkspaceErrorState className="mt-4" title="Nexus Assurance is unavailable" description={loadError} onRetry={loadAssurance} retryLabel="Retry assurance" onSecondaryAction={() => navigate("/clients")} secondaryLabel="Open Clients" />;

  return <div className="space-y-5" data-testid="nexus-assurance">
    <OperationalPageHeader eyebrow="Nexus Assurance · declared services versus retained proof" title="Nexus Assurance" description="Know what Nexus can evidence, what needs attention, and what has not yet been proven—across the services each client relies on." icon={ShieldCheck} tone="emerald" signal={stateCounts.attention ? "attention" : stateCounts.notProven ? "steady" : "healthy"} actions={<><Button variant="outline" size="sm" className="rounded-xl" asChild><Link to="/backup-center?tab=verify">Recovery evidence<ChevronRight className="ml-1.5 h-3.5 w-3.5" /></Link></Button><Button size="sm" className="rounded-xl" onClick={() => loadAssurance({ background: true })} disabled={refreshing} data-testid="nexus-assurance-refresh"><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />Refresh proof</Button></>} />

    <Card className={`${SURFACE} border-emerald-400/20 bg-emerald-400/[0.035]`} data-testid="nexus-assurance-boundary"><CardContent className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300">Evidence boundary</p><p className="mt-1 text-sm font-medium">Nexus Assurance never turns missing data into a pass.</p><p className="mt-1 max-w-4xl text-xs text-muted-foreground">{textValue(data?.boundary, "Nexus compares declared client scope with retained operational evidence. A missing integration, stale observation or unlinked service remains visible as not proven.")}</p></div><div className="flex flex-wrap gap-2"><Badge variant="outline" className="border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-200">Scoped evidence · available</Badge><Badge variant="outline" className="text-muted-foreground">Evaluated {formatEvidenceTime(data?.generated_at)}</Badge></div></CardContent></Card>

    {loadError && <Card className={`${SURFACE} border-amber-400/25 bg-amber-400/[0.04]`}><CardContent className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium">The last proof refresh did not complete</p><p className="mt-1 text-xs text-muted-foreground">{loadError} Previously retrieved assurance evidence remains available below.</p></div><Button size="sm" variant="outline" onClick={() => loadAssurance({ background: true })}>Retry refresh</Button></CardContent></Card>}

    <NexusVerifiedSequence stages={["Declare", "Observe", "Compare", "Remediate", "Prove"]} complete={assuranceStage} label="Nexus Assurance" />

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Nexus Assurance summary"><EvidenceMetric label="Clients examined" value={summary.clients || clients.length} description="Within your permitted client scope" tone="zinc" selected={clientFilter === "all" && stateFilter === "all"} onClick={clearFilters} /><EvidenceMetric label="Evidence recorded" value={stateCounts.evidenced} description="Controls with current retained evidence" tone="emerald" selected={stateFilter === "covered"} onClick={() => setStateFilter("covered")} /><EvidenceMetric label="Needs attention" value={stateCounts.attention} description="Declared scope and evidence do not match" tone="amber" selected={stateFilter === "gap"} onClick={() => setStateFilter("gap")} /><EvidenceMetric label="Not proven" value={stateCounts.notProven} description="No evidence claim can be made" tone="rose" selected={stateFilter === "not_assessed"} onClick={() => setStateFilter("not_assessed")} /></div>

    <StandardsAsCodePanel />
    <Card className={SURFACE}><CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300">Assurance lens</p><p className="mt-1 text-sm font-medium">{filteredFindings.length} attention item{filteredFindings.length === 1 ? "" : "s"} · {filteredControls.length} control record{filteredControls.length === 1 ? "" : "s"} in view</p><p className="mt-1 text-xs text-muted-foreground">Filter the evidence, review the reason, then hand off to the source workspace for governed work.</p></div><div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"><div className="relative min-w-0 sm:w-72"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Search client, control or evidence" value={search} onChange={(event) => setSearch(event.target.value)} data-testid="nexus-assurance-search" /></div><Select value={clientFilter} onValueChange={setClientFilter}><SelectTrigger className="w-full sm:w-[190px]" aria-label="Filter assurance by client"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All permitted clients</SelectItem>{clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}</SelectContent></Select><Select value={stateFilter} onValueChange={setStateFilter}><SelectTrigger className="w-full sm:w-[165px]" aria-label="Filter assurance by evidence state"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All evidence states</SelectItem><SelectItem value="covered">Evidence recorded</SelectItem><SelectItem value="gap">Needs attention</SelectItem><SelectItem value="not_assessed">Not proven</SelectItem></SelectContent></Select>{filtersActive && <Button size="sm" variant="ghost" className="text-xs" onClick={clearFilters} data-testid="nexus-assurance-clear-filters">Clear filters</Button>}</div></CardContent></Card>

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]"><Card className={SURFACE} data-testid="nexus-assurance-attention"><CardContent className="p-0"><div className="flex flex-col gap-3 border-b border-border/70 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-300">Where Nexus needs a decision</p><h2 className="mt-1 text-base font-semibold">Assurance attention board</h2><p className="mt-1 text-xs text-muted-foreground">These are evidence gaps or mismatches, not automatic proof of a service failure.</p></div><Badge variant="outline" className="w-fit border-amber-400/25 bg-amber-400/[0.06] text-amber-200">{filteredFindings.length} to review</Badge></div><div className="space-y-2 p-4">{visibleFindings.length ? visibleFindings.map((finding) => <article key={finding.id} className="flex flex-col gap-3 rounded-xl border border-border/70 bg-muted/[0.08] p-4 transition-colors hover:bg-muted/[0.13]"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap gap-2"><Badge variant="outline" className={`text-[10px] ${FINDING_TONE[finding.severity] || FINDING_TONE.low}`}>{textValue(finding.severity, "attention")}</Badge><Badge variant="outline" className="text-[10px] capitalize">{textValue(finding.domain, "assurance")}</Badge></div><p className="mt-2 text-sm font-semibold">{textValue(finding.title)}</p><p className="mt-1 text-xs text-muted-foreground">{textValue(finding.client_name, "Scoped client")} · Expected {finding.expected ?? "—"} / observed {finding.observed ?? "—"}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{textValue(finding.next_step, "Review the source evidence before treating this control as complete.")}</p></div><Button size="sm" variant="ghost" className="h-8 shrink-0 px-2 text-xs" onClick={() => setSelectedEvidence({ kind: "finding", ...finding })} data-testid={`nexus-assurance-review-${finding.id}`}><Eye className="mr-1.5 h-3.5 w-3.5" />Review</Button></div></article>) : <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center"><ShieldCheck className="h-9 w-9 text-emerald-300" /><p className="mt-4 text-sm font-semibold">No attention items match this view</p><p className="mt-1 max-w-md text-sm text-muted-foreground">This does not mean every customer service is proven. Review the evidence-state filters to see controls that still need source evidence.</p>{filtersActive && <Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>Clear filters</Button>}</div>}{filteredFindings.length > 6 && <div className="pt-2 text-center"><Button variant="ghost" size="sm" onClick={() => setShowAllFindings((current) => !current)}>{showAllFindings ? "Show priority six" : `Show all ${filteredFindings.length} attention items`}</Button></div>}</div></CardContent></Card>

      <Card className={SURFACE} data-testid="nexus-assurance-estate"><CardContent className="p-0"><div className="border-b border-border/70 p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-300">Managed estate evidence</p><h2 className="mt-1 text-base font-semibold">What is currently linked</h2><p className="mt-1 text-xs text-muted-foreground">A compact portfolio view of managed endpoints, recent agent evidence and active service records.</p></div><div className="max-h-[36rem] space-y-2 overflow-y-auto p-4">{filteredCoverage.length ? filteredCoverage.map((client) => { const status = CONTROL_STATE[client.status] || CONTROL_STATE.not_assessed; const StatusIcon = status.icon; return <button key={client.client_id} type="button" onClick={() => { setClientFilter(client.client_id); setStateFilter("all"); }} className="w-full rounded-xl border border-border/70 bg-muted/[0.08] p-3 text-left transition-colors hover:bg-muted/[0.14] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{textValue(client.client_name, client.client_id)}</p><p className="mt-1 text-xs text-muted-foreground">{client.active_agents ?? 0} active agent record{client.active_agents === 1 ? "" : "s"} / {client.expected_endpoints ?? 0} managed endpoint{client.expected_endpoints === 1 ? "" : "s"}</p><p className="mt-1 text-xs text-muted-foreground">{client.active_subscriptions ?? 0} active service record{client.active_subscriptions === 1 ? "" : "s"} linked</p></div><Badge variant="outline" className={`shrink-0 text-[10px] ${status.className}`}><StatusIcon className="mr-1 h-3 w-3" />{status.label}</Badge></div></button>; }) : <div className="py-14 text-center text-sm text-muted-foreground"><Gauge className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />No managed-estate evidence is available for this view.</div>}</div></CardContent></Card></div>

    <Card className={SURFACE} data-testid="nexus-assurance-proof-map"><CardContent className="p-0"><div className="flex flex-col gap-3 border-b border-border/70 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-300">Control proof map</p><h2 className="mt-1 text-base font-semibold">Evidence, gaps and unknowns—without a second source of truth</h2><p className="mt-1 text-xs text-muted-foreground">Priority controls appear first. Each review keeps the source workspace responsible for governed remediation.</p></div><Badge variant="outline" className="w-fit text-muted-foreground">{filteredControls.length} controls in view</Badge></div><div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">{visibleControls.length ? visibleControls.map((control) => { const state = CONTROL_STATE[control.status] || CONTROL_STATE.not_assessed; const StateIcon = state.icon; return <article key={control.id} className="rounded-xl border border-border/70 bg-muted/[0.08] p-4 transition-colors hover:bg-muted/[0.13]"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-semibold">{textValue(control.client_name, "Scoped client")}</p><p className="mt-1 text-xs font-medium text-foreground/90">{textValue(control.label)}</p></div><Badge variant="outline" className={`shrink-0 text-[10px] ${state.className}`}><StateIcon className="mr-1 h-3 w-3" />{state.label}</Badge></div><p className="mt-3 min-h-10 text-xs leading-5 text-muted-foreground">{textValue(control.detail)}</p><p className="mt-2 truncate text-[10px] text-muted-foreground">Evidence: {evidenceSources(control)}</p><div className="mt-3 flex items-center justify-between gap-2"><p className="text-[11px] text-muted-foreground">Expected {control.expected ?? "—"} · observed {control.observed ?? "—"}</p><Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setSelectedEvidence({ kind: "control", ...control })}>Evidence<ChevronRight className="ml-1 h-3.5 w-3.5" /></Button></div></article>; }) : <div className="col-span-full flex min-h-56 flex-col items-center justify-center text-center"><CircleDashed className="h-9 w-9 text-muted-foreground" /><p className="mt-4 text-sm font-semibold">No retained control evidence matches this view</p><p className="mt-1 text-sm text-muted-foreground">Clear the filters or connect and retain the appropriate source evidence.</p></div>}</div>{filteredControls.length > 12 && <div className="border-t border-border/70 px-4 py-3 text-center"><Button size="sm" variant="ghost" onClick={() => setShowAllControls((current) => !current)}>{showAllControls ? "Show priority 12 controls" : `Show all ${filteredControls.length} controls`}</Button></div>}</CardContent></Card>

    <Dialog open={Boolean(selectedEvidence)} onOpenChange={(open) => !open && setSelectedEvidence(null)}><NexusWorkflowDialog eyebrow={selectedEvidence?.kind === "finding" ? "Assurance attention item" : "Retained control evidence"} title={selectedEvidence?.title || selectedEvidence?.label || "Assurance evidence"} description="Review the recorded scope and evidence before beginning the governed work in its source workspace." icon={FileSearch} tone="emerald" className="max-w-3xl" footer={<><Button variant="outline" asChild><Link to={selectedEvidence?.route || "/clients"}>Open source workspace<ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Link></Button><Button onClick={() => setSelectedEvidence(null)}>Done</Button></>}>
      {selectedEvidence && <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-2"><Detail label="Client scope">{textValue(selectedEvidence.client_name, "Scoped client")}</Detail><Detail label="Evidence state">{selectedEvidence.kind === "control" ? <Badge variant="outline" className={CONTROL_STATE[selectedEvidence.status]?.className}>{CONTROL_STATE[selectedEvidence.status]?.label || "Not proven"}</Badge> : <Badge variant="outline" className={FINDING_TONE[selectedEvidence.severity] || FINDING_TONE.low}>{textValue(selectedEvidence.severity, "attention")}</Badge>}</Detail><Detail label="Expected">{selectedEvidence.expected ?? "Not declared"}</Detail><Detail label="Observed">{selectedEvidence.observed ?? "Not recorded"}</Detail>{selectedEvidence.kind === "control" && <Detail label="Control">{textValue(selectedEvidence.label)}</Detail>}{selectedEvidence.kind === "control" && <Detail label="Evidence sources">{evidenceSources(selectedEvidence)}</Detail>}{selectedEvidence.kind === "finding" && <Detail label="Domain">{textValue(selectedEvidence.domain, "Assurance")}</Detail>}</div><section className="rounded-xl border border-border/70 bg-muted/[0.12] p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Recorded evidence</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground/90">{textValue(selectedEvidence.detail || selectedEvidence.next_step)}</p></section>{selectedEvidence.kind === "control" && selectedEvidence.provenance?.boundary && <section className="rounded-xl border border-sky-400/20 bg-sky-400/[0.04] p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-200">Evidence boundary</p><p className="mt-2 text-sm leading-6 text-muted-foreground">{selectedEvidence.provenance.boundary}</p></section>}<section className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.05] p-4"><p className="font-medium">Continue through the source workflow</p><p className="mt-1 text-sm text-muted-foreground">Nexus Assurance makes the gap visible and keeps its provenance. The source workspace owns any investigation, approval, change, remediation and audit record.</p></section></div>}
    </NexusWorkflowDialog></Dialog>
  </div>;
}
