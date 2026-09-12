import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import NexusVerifiedSequence from "@/components/NexusVerifiedSequence";
import { WorkspaceErrorState, WorkspaceLoadingState } from "@/components/WorkspaceState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ApplicationPolicyDialog from "@/components/application-manager/ApplicationPolicyDialog";
import ApplicationActionPlanDialog from "@/components/application-manager/ApplicationActionPlanDialog";
import { ApplicationMetric, ApplicationStateBadge, applicationStateMeta } from "@/components/application-manager/ApplicationManagerPrimitives";
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardCheck, Database, Layers3, RefreshCw, Search, ShieldCheck, ShieldQuestion, Sparkles } from "lucide-react";
import { toast } from "sonner";

const SURFACE = "overflow-hidden rounded-2xl border border-border/70 bg-card/90 shadow-[0_18px_45px_-34px_rgba(0,0,0,0.95)]";

function applicationTone(application) {
  if (application?.update?.state === "outdated") return "border-rose-400/30 bg-rose-400/[0.045]";
  if (["stale", "unverified"].includes(application?.inventory?.state)) return "border-amber-400/30 bg-amber-400/[0.045]";
  if (application?.policy?.state === "conflict") return "border-rose-400/30 bg-rose-400/[0.045]";
  return "border-border/70 bg-muted/[0.07]";
}

function stageFor(data) {
  if (!data) return 1;
  const summary = data.summary || {};
  if (summary.outdated_applications) return 3;
  if (summary.not_collected_devices || summary.stale_inventory_devices || summary.unverified_inventory_devices) return 2;
  return 4;
}

function displayDate(value) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleString();
}

export default function NexusApplicationManagerPage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [data, setData] = useState(null);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [planWarning, setPlanWarning] = useState("");
  const [search, setSearch] = useState("");
  const [updateFilter, setUpdateFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const [policyOpen, setPolicyOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);

  const load = useCallback(async ({ background = false } = {}) => {
    if (background) setRefreshing(true); else setLoading(true);
    setError("");
    setPlanWarning("");
    try {
      const overview = await axios.get(`${API}/application-manager/overview`, { headers });
      setData(overview.data || {});
      const actionPlans = await axios.get(`${API}/application-manager/action-plans`, { headers }).catch((requestError) => {
        setPlanWarning(requestError.response?.data?.detail || "Action-plan history is not available yet.");
        return { data: { plans: [] } };
      });
      setPlans(Array.isArray(actionPlans.data?.plans) ? actionPlans.data.plans : []);
    } catch (requestError) {
      setError(requestError.response?.data?.detail || requestError.message || "Nexus could not retrieve scoped application evidence. No endpoint work was started.");
      if (!background) toast.error("Nexus Application Manager is unavailable. You can retry safely.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  const applications = useMemo(() => Array.isArray(data?.applications) ? data.applications : [], [data]);
  const clients = useMemo(() => {
    const entries = new Map();
    applications.forEach((application) => (application.clients || []).forEach((client) => {
      if (client?.id) entries.set(client.id, client.name || client.id);
    }));
    return [...entries.entries()].map(([id, name]) => ({ id, name })).sort((left, right) => left.name.localeCompare(right.name));
  }, [applications]);
  const filteredApplications = useMemo(() => applications
    .filter((application) => clientFilter === "all" || (application.clients || []).some((client) => client.id === clientFilter))
    .filter((application) => updateFilter === "all" || application.update?.state === updateFilter)
    .filter((application) => {
      const query = search.trim().toLowerCase();
      if (!query) return true;
      return [application.app_name, application.publisher, ...(application.versions || []), ...(application.clients || []).map((client) => client.name)].some((value) => String(value || "").toLowerCase().includes(query));
    }), [applications, clientFilter, search, updateFilter]);
  const selected = filteredApplications.find((application) => application.id === selectedId) || applications.find((application) => application.id === selectedId) || filteredApplications[0] || null;
  const summary = data?.summary || {};
  const permissions = data?.permissions || {};
  const canRecordPolicy = Boolean(permissions.can_record_policy);
  const canStagePlan = Boolean(permissions.can_stage_plan);
  const filtersActive = Boolean(search.trim()) || updateFilter !== "all" || clientFilter !== "all";
  const clearFilters = () => { setSearch(""); setUpdateFilter("all"); setClientFilter("all"); };

  if (loading && !data) return <WorkspaceLoadingState className="mt-4" label="Correlating scoped application inventory and update evidence…" />;
  if (!loading && error && !data) return <WorkspaceErrorState className="mt-4" title="Nexus Application Manager is unavailable" description={error} onRetry={load} retryLabel="Retry application evidence" onSecondaryAction={() => window.location.assign("/devices")} secondaryLabel="Open Devices" />;

  return <div className="space-y-5" data-testid="nexus-application-manager">
    <OperationalPageHeader eyebrow="Managed assets · application intelligence" title="Nexus Application Manager" description="Observe what is installed, separate update evidence from policy intent, and stage one scoped plan at a time—without pretending a package action has run." icon={Layers3} tone="violet" signal={summary.outdated_applications ? "attention" : "steady"} actions={<><Button size="sm" variant="outline" className="rounded-xl" asChild><Link to="/third-party-patching">Patch evidence<ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Link></Button>{canRecordPolicy && <Button size="sm" variant="outline" className="rounded-xl" onClick={() => setPolicyOpen(true)}><ShieldCheck className="mr-1.5 h-3.5 w-3.5" />Record approval</Button>}<Button size="sm" className="rounded-xl" onClick={() => load({ background: true })} disabled={refreshing}><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />Refresh evidence</Button></>} />

    <Card className={`${SURFACE} border-violet-400/25 bg-violet-400/[0.04]`} data-testid="application-manager-boundary"><CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-200">Evidence and execution boundary</p><p className="mt-1 text-sm font-semibold">Nexus does not turn an inventory record or approval policy into an endpoint change.</p><p className="mt-1 max-w-4xl text-xs leading-5 text-muted-foreground">{data?.boundary || "Nexus will keep evidence and decisions distinct until an approved execution provider is connected."}</p></div><div className="flex flex-wrap gap-2"><Badge variant="outline" className="border-sky-400/25 bg-sky-400/[0.06] text-sky-200">Inventory · {data?.capabilities?.inventory || "not collected"}</Badge><Badge variant="outline" className="border-amber-400/25 bg-amber-400/[0.06] text-amber-200">Execution · not configured</Badge>{!canRecordPolicy && <Badge variant="outline" className="text-muted-foreground">Approval policies · view only</Badge>}{!canStagePlan && <Badge variant="outline" className="text-muted-foreground">Plan staging · permission required</Badge>}</div></CardContent></Card>

    {error && <Card className={`${SURFACE} border-amber-400/25 bg-amber-400/[0.04]`}><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium">The latest refresh did not complete</p><p className="mt-1 text-xs text-muted-foreground">{error} The last retained application evidence remains visible below.</p></div><Button size="sm" variant="outline" onClick={() => load({ background: true })}>Retry refresh</Button></CardContent></Card>}

    <NexusVerifiedSequence stages={["Collect", "Correlate", "Approve", "Stage", "Prove"]} complete={stageFor(data)} label="Application management" />

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><ApplicationMetric icon={Database} label="Observed applications" value={summary.applications || 0} detail={`${summary.installations || 0} installations in view`} tone="sky" /><ApplicationMetric icon={CheckCircle2} label="Fresh inventory" value={summary.fresh_inventory_devices || 0} detail="Endpoints with current software collection" tone="emerald" onClick={() => setUpdateFilter("all")} /><ApplicationMetric icon={AlertTriangle} label="Updates available" value={summary.outdated_applications || 0} detail="Fresh trusted evidence only" tone="rose" selected={updateFilter === "outdated"} onClick={() => setUpdateFilter("outdated")} /><ApplicationMetric icon={ShieldQuestion} label="Unverified inventory" value={(summary.stale_inventory_devices || 0) + (summary.unverified_inventory_devices || 0)} detail="Needs a fresh collection time" tone="amber" /><ApplicationMetric icon={ClipboardCheck} label="Governed plans" value={plans.length} detail="Retained plans; no execution" tone="slate" /></div>

    <Card className={SURFACE}><CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-200">Application estate</p><p className="mt-1 text-sm font-semibold">{filteredApplications.length} application{filteredApplications.length === 1 ? "" : "s"} in this view</p><p className="mt-1 text-xs text-muted-foreground">Prioritised by fresh update evidence, then collection confidence. Click an application to inspect its endpoint-level evidence.</p></div><div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"><div className="relative min-w-0 sm:w-64"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search app, publisher or version" data-testid="application-manager-search" /></div><Select value={clientFilter} onValueChange={setClientFilter}><SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All permitted clients</SelectItem>{clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}</SelectContent></Select><Select value={updateFilter} onValueChange={setUpdateFilter}><SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All update states</SelectItem><SelectItem value="outdated">Update available</SelectItem><SelectItem value="current">Current evidence</SelectItem><SelectItem value="partially_observed">Partially observed</SelectItem><SelectItem value="stale">Evidence stale</SelectItem><SelectItem value="not_assessed">Not assessed</SelectItem></SelectContent></Select>{filtersActive && <Button size="sm" variant="ghost" onClick={clearFilters}>Clear filters</Button>}</div></CardContent></Card>

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]"><Card className={SURFACE} data-testid="application-manager-inventory"><CardContent className="p-0"><div className="flex flex-col gap-2 border-b border-border/70 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-200">Observed application catalogue</p><h2 className="mt-1 text-base font-semibold">What the endpoints have actually reported</h2></div><Badge variant="outline" className="w-fit text-muted-foreground">{filteredApplications.length} in view</Badge></div><div className="max-h-[46rem] space-y-2 overflow-y-auto p-4">{filteredApplications.length ? filteredApplications.map((application) => <button key={application.id} type="button" onClick={() => setSelectedId(application.id)} className={`w-full rounded-xl border p-4 text-left transition-all hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 ${applicationTone(application)} ${selected?.id === application.id ? "ring-1 ring-primary/60" : ""}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{application.app_name}</p><p className="mt-1 truncate text-xs text-muted-foreground">{application.publisher || "Publisher not reported"} · {application.device_count} endpoint{application.device_count === 1 ? "" : "s"} · {application.client_count} client{application.client_count === 1 ? "" : "s"}</p></div><ApplicationStateBadge state={application.update?.state} /></div><div className="mt-3 flex flex-wrap gap-2"><ApplicationStateBadge compact state={application.inventory?.state} /><ApplicationStateBadge compact state={application.policy?.state} /><Badge variant="outline" className="text-[10px] text-muted-foreground">{(application.versions || []).length ? `${application.versions.length} version${application.versions.length === 1 ? "" : "s"}` : "Version not reported"}</Badge></div></button>) : <div className="flex min-h-80 flex-col items-center justify-center p-8 text-center"><Database className="h-9 w-9 text-muted-foreground" /><p className="mt-4 text-sm font-semibold">No observed applications match this view</p><p className="mt-1 max-w-md text-sm text-muted-foreground">Nexus will not manufacture software inventory. Collect it with an enrolled agent or an approved provider, then refresh this view.</p>{filtersActive && <Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>Clear filters</Button>}</div>}</div></CardContent></Card>

      <Card className={SURFACE} data-testid="application-manager-detail"><CardContent className="p-0">{selected ? <><div className="border-b border-border/70 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-200">Application evidence dossier</p><h2 className="mt-1 truncate text-lg font-semibold">{selected.app_name}</h2><p className="mt-1 text-xs text-muted-foreground">{selected.publisher || "Publisher not reported"}</p></div><div className="flex flex-wrap gap-2"><ApplicationStateBadge state={selected.update?.state} /><ApplicationStateBadge state={selected.inventory?.state} /></div></div><div className="mt-4 flex flex-wrap gap-2">{canStagePlan && <Button size="sm" className="rounded-xl" onClick={() => setPlanOpen(true)}><ClipboardCheck className="mr-1.5 h-3.5 w-3.5" />Stage governed plan</Button>}{canRecordPolicy && <Button size="sm" variant="outline" className="rounded-xl" onClick={() => setPolicyOpen(true)}><ShieldCheck className="mr-1.5 h-3.5 w-3.5" />Record approval</Button>}</div></div><div className="space-y-4 p-4"><section className="rounded-xl border border-border/70 bg-muted/[0.08] p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-200">Update health</p><p className="mt-1 text-sm font-semibold">{applicationStateMeta(selected.update?.state).label}</p></div>{selected.update?.highest_severity && <Badge variant="outline" className="border-rose-400/30 bg-rose-400/[0.06] text-rose-200 capitalize">{selected.update.highest_severity}</Badge>}</div><p className="mt-2 text-xs leading-5 text-muted-foreground">{selected.update?.message}</p><p className="mt-3 text-xs text-muted-foreground">Observed {selected.update?.observed_installations || 0} of {selected.update?.total_installations || 0} installation(s) · {selected.update?.outdated_installations || 0} update(s) available</p>{selected.update?.latest_versions?.length ? <p className="mt-1 font-mono text-xs text-muted-foreground">Latest: {selected.update.latest_versions.join(", ")}</p> : null}</section><section className="rounded-xl border border-border/70 bg-muted/[0.08] p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-200">Approval and rollout intent</p><div className="mt-2 flex items-center justify-between gap-3"><p className="text-sm font-semibold">{applicationStateMeta(selected.policy?.state).label}</p><Badge variant="outline" className="text-[10px] text-muted-foreground">{selected.policy?.record_count || 0} matching record{selected.policy?.record_count === 1 ? "" : "s"}</Badge></div><p className="mt-2 text-xs leading-5 text-muted-foreground">{selected.policy?.message}</p>{selected.policy?.record && <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2"><p><span className="text-muted-foreground">Target version:</span> {selected.policy.record.target_version || "Not recorded"}</p><p><span className="text-muted-foreground">Rollout ring:</span> {selected.policy.record.rollout_ring || "Not recorded"}</p></div>}</section><section><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Endpoint evidence</p><p className="mt-1 text-xs text-muted-foreground">Only the endpoint’s collected inventory is shown.</p></div><Badge variant="outline" className="text-muted-foreground">{selected.installations?.length || 0}</Badge></div><div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">{(selected.installations || []).map((item) => <div key={`${item.device_id}-${item.version}-${item.source}`} className="rounded-lg border border-border/60 bg-muted/[0.06] p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-medium">{item.device_name}</p><p className="mt-1 truncate text-xs text-muted-foreground">{item.client_name} · {item.version || "Version not reported"}</p></div><ApplicationStateBadge compact state={item.inventory_state} /></div><p className="mt-2 text-[11px] text-muted-foreground">{item.source} · collected {displayDate(item.observed_at)}</p></div>)}</div></section></div></> : <div className="flex min-h-96 flex-col items-center justify-center p-8 text-center"><Sparkles className="h-9 w-9 text-violet-200" /><p className="mt-4 text-sm font-semibold">Select an observed application</p><p className="mt-1 max-w-sm text-sm text-muted-foreground">Its inventory, update evidence and approval record will stay distinct here so a technician can make an informed next decision.</p></div>}</CardContent></Card></div>

    <Card className={SURFACE} data-testid="application-manager-plans"><CardContent className="p-0"><div className="flex flex-col gap-3 border-b border-border/70 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-200">Governed plan register</p><h2 className="mt-1 text-base font-semibold">Plans are retained, not executed</h2><p className="mt-1 text-xs text-muted-foreground">Every plan has a client/site boundary, actor, reason and a clear non-execution state.</p></div><Badge variant="outline" className="w-fit border-amber-400/25 bg-amber-400/[0.06] text-amber-200">Execution not configured</Badge></div>{planWarning && <div className="border-b border-amber-400/20 bg-amber-400/[0.04] px-4 py-3 text-xs text-amber-100">{planWarning}</div>}<div className="divide-y divide-border/70">{plans.length ? plans.slice(0, 12).map((plan) => <div key={plan.id} className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{plan.application_name}</p><Badge variant="outline" className="capitalize">{plan.action_type}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{plan.targets?.length || 0} endpoint{plan.targets?.length === 1 ? "" : "s"} · client {plan.client_id || "not recorded"} · {displayDate(plan.created_at)}</p><p className="mt-1 max-w-3xl text-xs text-muted-foreground">{plan.reason}</p></div><div className="flex shrink-0 flex-wrap gap-2"><Badge variant="outline" className="border-amber-400/25 bg-amber-400/[0.06] text-amber-200">Approval not requested</Badge><Badge variant="outline" className="text-muted-foreground">Not executed</Badge></div></div>) : <div className="flex min-h-40 flex-col items-center justify-center p-6 text-center"><ClipboardCheck className="h-8 w-8 text-muted-foreground" /><p className="mt-3 text-sm font-semibold">No governed application plans yet</p><p className="mt-1 max-w-md text-sm text-muted-foreground">Select an observed application and stage a scoped plan when a technician has a documented reason and a linked approval path.</p></div>}</div></CardContent></Card>

    <ApplicationPolicyDialog open={policyOpen} onOpenChange={setPolicyOpen} application={selected} headers={headers} onSaved={() => load({ background: true })} />
    <ApplicationActionPlanDialog open={planOpen} onOpenChange={setPlanOpen} application={selected} headers={headers} onSaved={() => load({ background: true })} />
  </div>;
}
