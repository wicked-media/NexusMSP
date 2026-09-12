import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import {
  ChevronRight,
  CircleDashed,
  ClipboardCheck,
  FlaskConical,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

import { API, useAuth } from "@/App";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import NexusVerifiedSequence from "@/components/NexusVerifiedSequence";
import { WorkspaceErrorState, WorkspaceLoadingState } from "@/components/WorkspaceState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const SURFACE = "overflow-hidden rounded-2xl border border-border/70 bg-card/90 shadow-[0_18px_45px_-34px_rgba(0,0,0,0.95)]";
const TONES = {
  emerald: "border-emerald-400/25 bg-emerald-400/[0.055] text-emerald-100",
  amber: "border-amber-400/25 bg-amber-400/[0.055] text-amber-100",
  rose: "border-rose-400/25 bg-rose-400/[0.055] text-rose-100",
  cyan: "border-cyan-400/25 bg-cyan-400/[0.055] text-cyan-100",
  zinc: "border-border/70 bg-muted/[0.08] text-foreground",
};

function safeList(value) { return Array.isArray(value) ? value : []; }
function human(value) { return String(value || "not proven").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatDate(value) {
  if (!value) return "No retained run";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time not recorded" : date.toLocaleString();
}

function statusTone(status) {
  if (["safe_to_run", "approved", "completed"].includes(status)) return "emerald";
  if (["blocked", "failed", "rejected"].includes(status)) return "rose";
  if (["ready_for_approval", "pending_review", "awaiting_approval", "waiting"].includes(status)) return "amber";
  return "zinc";
}

function Metric({ label, value, detail, tone = "zinc" }) {
  return <Card className={`${SURFACE} ${TONES[tone]}`}><CardContent className="p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.19em] text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p></CardContent></Card>;
}

function StateBadge({ state }) {
  return <Badge variant="outline" className={`text-[10px] ${TONES[statusTone(state)]}`}>{human(state)}</Badge>;
}

export default function NexusProvingGroundPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async ({ background = false } = {}) => {
    if (background) setRefreshing(true); else setLoading(true);
    setError("");
    try {
      const response = await axios.get(`${API}/nexus-proving-ground/overview`, { headers });
      setData(response.data || {});
    } catch (requestError) {
      const message = requestError?.response?.data?.detail || requestError?.message || "Nexus could not retrieve proving evidence. No workflow action was started.";
      setError(message);
      if (!background) toast.error("Nexus Proving Ground is unavailable. You can retry safely.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  const summary = data?.summary || {};
  const workflows = safeList(data?.workflows);
  const simulations = safeList(data?.simulations);
  const approvalQueue = safeList(data?.approval_queue);
  const runs = safeList(data?.runs);
  const readiness = data?.readiness || {};
  const stage = summary.blocked ? 2 : summary.configuration_gaps ? 3 : summary.ready_for_approval ? 4 : summary.safe_to_run ? 5 : 1;

  if (loading && !data) return <WorkspaceLoadingState className="mt-4" label="Assembling safe simulation evidence…" />;
  if (!loading && error && !data) return <WorkspaceErrorState className="mt-4" title="Nexus Proving Ground is unavailable" description={error} onRetry={load} retryLabel="Retry Proving Ground" onSecondaryAction={() => navigate("/workflow-automation")} secondaryLabel="Open Automation Studio" />;

  return <div className="space-y-5 pb-10" data-testid="nexus-proving-ground-page">
    <OperationalPageHeader
      eyebrow="Nexus Proving Ground · simulation before impact"
      title="Nexus Proving Ground"
      description="Build confidence from retained simulation, approval and rollback evidence—before a governed workflow can touch a customer environment."
      icon={FlaskConical}
      tone="violet"
      signal={summary.blocked ? "attention" : summary.configuration_gaps ? "steady" : "healthy"}
      actions={<><Button size="sm" variant="outline" className="rounded-xl" onClick={() => navigate("/workflow-automation?tab=simulations")}><PlayCircle className="mr-1.5 h-3.5 w-3.5" />Open simulation studio</Button><Button size="sm" className="rounded-xl" onClick={() => load({ background: true })} disabled={refreshing}><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />Refresh evidence</Button></>}
    />

    <Card className={`${SURFACE} border-violet-400/20 bg-violet-400/[0.035]`}><CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300">Safety boundary</p><p className="mt-1 text-sm font-semibold">A simulation is a proof step, never a permission bypass.</p><p className="mt-1 max-w-4xl text-xs leading-5 text-muted-foreground">{data?.boundary || "Nexus retains workflow evidence, configuration gaps, approval boundaries and rollback context here. It cannot run or approve anything from this workspace."}</p></div><Badge variant="outline" className="w-fit border-violet-400/25 bg-violet-400/[0.08] text-violet-200"><ShieldCheck className="mr-1.5 h-3.5 w-3.5" />Non-mutating evidence</Badge></CardContent></Card>

    {error && <Card className={`${SURFACE} border-amber-400/25 bg-amber-400/[0.04]`}><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold">The latest evidence refresh did not complete</p><p className="mt-1 text-xs text-muted-foreground">{error} Previously loaded proving evidence remains visible. No workflow or provider action was attempted.</p></div><Button size="sm" variant="outline" onClick={() => load({ background: true })}>Retry refresh</Button></CardContent></Card>}

    <NexusVerifiedSequence stages={["Define", "Simulate", "Review gaps", "Approve", "Execute elsewhere"]} complete={stage} label="Nexus workflow proof" />

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Workflow candidates" value={summary.workflows ?? workflows.length} detail={`${summary.workflows_ready ?? 0} enabled and approval-ready`} tone="cyan" /><Metric label="Simulation evidence" value={summary.simulations ?? simulations.length} detail={`${summary.safe_to_run ?? 0} with a retained safe outcome`} tone="emerald" /><Metric label="Approval boundaries" value={summary.approval_boundaries ?? approvalQueue.length} detail="Risky or governed work still needs review" tone="amber" /><Metric label="Configuration gaps" value={summary.configuration_gaps ?? 0} detail="Never hidden behind an apparent pass" tone={summary.configuration_gaps ? "rose" : "zinc"} /></div>

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.16fr)_minmax(340px,0.84fr)]">
      <Card className={SURFACE}><CardHeader className="border-b border-border/70 pb-3"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Recent proof evidence</p><CardTitle className="mt-1 text-base">Simulation ledger</CardTitle><p className="text-xs leading-5 text-muted-foreground">Each retained entry shows the planned safety state. Open Automation Studio to inspect the full workflow context or start another simulation.</p></CardHeader><CardContent className="max-h-[42rem] space-y-2 overflow-y-auto p-4">{simulations.length ? simulations.map((item) => <article key={item.id} className="rounded-xl border border-border/70 bg-muted/[0.08] p-4 transition-colors hover:bg-muted/[0.13]"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><StateBadge state={item.status} /><Badge variant="outline" className={`text-[10px] ${item.risk_level === "high" ? TONES.rose : item.risk_level === "medium" ? TONES.amber : TONES.zinc}`}>{human(item.risk_level)} risk</Badge>{item.requires_approval && <Badge variant="outline" className="border-amber-400/25 bg-amber-400/[0.06] text-[10px] text-amber-200">Approval required</Badge>}</div><p className="mt-2 text-sm font-semibold">{item.workflow_name}</p><p className="mt-1 text-xs text-muted-foreground">{item.client_name || "Scoped client"} · {item.steps} step{item.steps === 1 ? "" : "s"} · simulated {formatDate(item.simulated_at)}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{item.configuration_gaps ? `${item.configuration_gaps} configuration requirement${item.configuration_gaps === 1 ? "" : "s"} still need attention.` : "No configuration gap was recorded for this simulation."}</p></div><Button size="sm" variant="ghost" className="h-8 shrink-0 px-2 text-xs" onClick={() => navigate(`/workflow-automation?workflow=${encodeURIComponent(item.workflow_id)}`)}>Open workflow<ChevronRight className="ml-1 h-3.5 w-3.5" /></Button></div></article>) : <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center"><FlaskConical className="h-9 w-9 text-violet-300" /><p className="mt-4 text-sm font-semibold">No retained simulations are in this scope</p><p className="mt-1 max-w-md text-sm text-muted-foreground">Start in Automation Studio. Nexus will retain the proposed steps, missing configuration and approval requirement without executing the workflow.</p><Button size="sm" className="mt-4" onClick={() => navigate("/workflow-automation")}>Open Automation Studio</Button></div>}</CardContent></Card>

      <div className="space-y-5"><Card className={SURFACE}><CardHeader className="border-b border-border/70 pb-3"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-300">Review queue</p><CardTitle className="mt-1 text-base">Approval boundaries stay visible</CardTitle><p className="text-xs leading-5 text-muted-foreground">A simulated outcome does not automatically permit a live run.</p></CardHeader><CardContent className="max-h-[22rem] space-y-2 overflow-y-auto p-4">{approvalQueue.length ? approvalQueue.map((item) => <article key={item.id} className="rounded-xl border border-amber-400/20 bg-amber-400/[0.035] p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-semibold">{item.title}</p><p className="mt-1 text-xs text-muted-foreground">{item.client_name || "Scoped client"} · {formatDate(item.created_at)}</p></div><StateBadge state={item.status} /></div><p className="mt-2 text-[11px] text-muted-foreground">{human(item.risk_level)} risk · simulation {item.simulation_id || "not linked"}</p></article>) : <div className="flex min-h-36 flex-col items-center justify-center px-4 text-center"><ClipboardCheck className="h-7 w-7 text-emerald-300" /><p className="mt-3 text-sm font-medium">No workflow approval is awaiting you</p><p className="mt-1 text-xs text-muted-foreground">This is not a claim that every workflow is clear to run.</p></div>}</CardContent></Card>

        <Card className={SURFACE}><CardHeader className="border-b border-border/70 pb-3"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300">Production context</p><CardTitle className="mt-1 text-base">Launch proof is separate</CardTitle></CardHeader><CardContent className="max-h-[22rem] space-y-2 overflow-y-auto p-4"><p className="text-sm font-medium">{readiness.label || "Production-readiness evidence"}</p><p className="text-xs leading-5 text-muted-foreground">{readiness.detail || "No global readiness response is available."}</p>{safeList(readiness.items).length ? safeList(readiness.items).slice(0, 7).map((item) => <article key={item.id} className="rounded-xl border border-border/70 bg-muted/[0.08] p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-sm font-medium">{item.title}</p><p className="mt-1 text-[11px] text-muted-foreground">{item.owner || "Unassigned"} · {item.target_release || "Release not recorded"}</p></div><StateBadge state={item.status} /></div></article>) : <div className="rounded-xl border border-dashed border-border/70 p-4 text-xs leading-5 text-muted-foreground">Global production gates are intentionally unavailable for this role. Client-scoped proving evidence remains visible above.</div>}</CardContent></Card>
      </div>
    </div>

    <Card className={SURFACE}><CardHeader className="border-b border-border/70 pb-3"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-300">Active runtime evidence</p><CardTitle className="mt-1 text-base">Runs remain outside the proving boundary</CardTitle></CardHeader><CardContent className="p-4">{runs.length ? <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{runs.slice(0, 9).map((run) => <article key={run.id} className="rounded-xl border border-border/70 bg-muted/[0.08] p-3"><div className="flex items-start justify-between gap-2"><p className="text-sm font-medium">{run.workflow_name}</p><StateBadge state={run.status} /></div><p className="mt-2 text-xs text-muted-foreground">{run.client_name || "Scoped client"} · updated {formatDate(run.updated_at || run.created_at)}</p></article>)}</div> : <div className="flex min-h-28 items-center gap-3 rounded-xl border border-dashed border-border/70 px-4 text-sm text-muted-foreground"><CircleDashed className="h-5 w-5 text-sky-300" />No active workflow runs are retained in this scope. Proving Ground will not invent a runtime state.</div>}</CardContent></Card>
  </div>;
}
