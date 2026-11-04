import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Cpu,
  HardDrive,
  Radio,
  RefreshCw,
  ShieldCheck,
  Ticket,
} from "lucide-react";

import { API, useAuth } from "@/App";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { WorkspaceErrorState, WorkspaceLoadingState } from "@/components/WorkspaceState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const SURFACE = "overflow-hidden rounded-2xl border border-border/70 bg-card/90 shadow-[0_18px_45px_-34px_rgba(0,0,0,0.95)]";
const STATES = {
  healthy: "border-emerald-400/25 bg-emerald-400/[0.055] text-emerald-100",
  observed: "border-cyan-400/25 bg-cyan-400/[0.055] text-cyan-100",
  attention: "border-amber-400/25 bg-amber-400/[0.055] text-amber-100",
  not_proven: "border-border/70 bg-muted/[0.08] text-foreground",
  unavailable: "border-rose-400/25 bg-rose-400/[0.055] text-rose-100",
};

function safeList(value) { return Array.isArray(value) ? value : []; }
function human(value) { return String(value || "not proven").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatDate(value) {
  if (!value) return "No observation retained";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time not recorded" : date.toLocaleString();
}
function stateIcon(state) { return state === "healthy" ? CheckCircle2 : state === "attention" ? AlertTriangle : state === "observed" ? Radio : CircleDashed; }

function SignalCard({ signal, onOpen }) {
  const Icon = stateIcon(signal.state);
  return <Card className={`${SURFACE} ${STATES[signal.state] || STATES.not_proven}`}><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><span className="rounded-xl border border-current/20 bg-background/30 p-2"><Icon className="h-4 w-4" /></span><Badge variant="outline" className={`text-[10px] ${STATES[signal.state] || STATES.not_proven}`}>{human(signal.state)}</Badge></div><p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{signal.label}</p><p className="mt-1 text-2xl font-semibold tracking-tight">{signal.value}</p><p className="mt-2 min-h-10 text-xs leading-5 text-muted-foreground">{signal.detail}</p>{signal.route ? <Button variant="ghost" size="sm" className="mt-3 h-8 px-0 text-xs" onClick={() => onOpen(signal.route)}>Open evidence<ArrowUpRight className="ml-1.5 h-3.5 w-3.5" /></Button> : <p className="mt-3 text-[11px] text-muted-foreground">This is the current authenticated request, not a separate health record.</p>}</CardContent></Card>;
}

export default function NexusPulsePage() {
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
      const response = await axios.get(`${API}/nexus-pulse/overview`, { headers });
      setData(response.data || {});
    } catch (requestError) {
      const message = requestError?.response?.data?.detail || requestError?.message || "Nexus could not retrieve the scoped operational evidence.";
      setError(message);
      if (!background) toast.error("Nexus Pulse is unavailable. You can retry safely.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  const signals = safeList(data?.signals);
  const attention = safeList(data?.attention);
  const freshness = safeList(data?.freshness);
  const summary = data?.summary || {};
  const overallState = data?.overall_state || "not_proven";

  if (loading && !data) return <WorkspaceLoadingState className="mt-4" label="Collecting scoped operational evidence…" />;
  if (!loading && error && !data) return <WorkspaceErrorState className="mt-4" title="Nexus Pulse is unavailable" description={error} onRetry={load} retryLabel="Retry Pulse" onSecondaryAction={() => navigate("/")} secondaryLabel="Open Dashboard" />;

  return <div className="space-y-5 pb-10" data-testid="nexus-pulse-page">
    <OperationalPageHeader
      eyebrow="Nexus Pulse · retained operational evidence"
      title="Nexus Pulse"
      description="A calm, scope-aware view of what Nexus has actually observed across fleet, service work and recovery—not an invented all-clear."
      icon={Activity}
      tone="cyan"
      signal={overallState === "attention" ? "attention" : overallState === "healthy" ? "healthy" : "steady"}
      actions={<Button size="sm" className="rounded-xl" onClick={() => load({ background: true })} disabled={refreshing}><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />Refresh pulse</Button>}
    />

    <Card className={`${SURFACE} ${STATES[overallState] || STATES.not_proven}`}><CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Evidence boundary</p><p className="mt-1 text-sm font-semibold">Pulse reports freshness and uncertainty as clearly as attention.</p><p className="mt-1 max-w-4xl text-xs leading-5 text-muted-foreground">{data?.boundary || "Nexus shows the latest retained evidence in your permitted scope. Missing data remains not proven, and a healthy job does not become a proven recovery."}</p></div><Badge variant="outline" className={`w-fit text-[10px] ${STATES[overallState] || STATES.not_proven}`}><Radio className="mr-1.5 h-3.5 w-3.5" />{human(overallState)}</Badge></CardContent></Card>

    {error && <Card className={`${SURFACE} border-amber-400/25 bg-amber-400/[0.04]`}><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold">The latest Pulse refresh did not complete</p><p className="mt-1 text-xs text-muted-foreground">{error} Previously retrieved observations remain visible. No action was attempted.</p></div><Button size="sm" variant="outline" onClick={() => load({ background: true })}>Retry refresh</Button></CardContent></Card>}

    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{signals.map((signal) => <SignalCard key={signal.id} signal={signal} onOpen={navigate} />)}</div>

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
      <Card className={SURFACE}><CardHeader className="border-b border-border/70 pb-3"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-300">Needs a decision</p><CardTitle className="mt-1 text-base">Attention queue</CardTitle><p className="text-xs leading-5 text-muted-foreground">These are evidence gaps and observed failures. They are not silently remediated from Pulse.</p></CardHeader><CardContent className="max-h-[40rem] space-y-2 overflow-y-auto p-4">{attention.length ? attention.map((item) => <button type="button" key={item.id} onClick={() => navigate(item.route)} className="w-full rounded-xl border border-border/70 bg-muted/[0.08] p-4 text-left transition-colors hover:border-cyan-400/30 hover:bg-muted/[0.13] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-semibold">{item.label}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p></div><ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" /></div><p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Open source evidence</p></button>) : <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center"><ShieldCheck className="h-9 w-9 text-emerald-300" /><p className="mt-4 text-sm font-semibold">No attention item is retained in this scope</p><p className="mt-1 max-w-md text-sm text-muted-foreground">That is not a platform-wide all-clear. Use the signal states above to see where evidence is merely unavailable or not proven.</p></div>}</CardContent></Card>

      <div className="space-y-5"><Card className={SURFACE}><CardHeader className="border-b border-border/70 pb-3"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-300">Current estate</p><CardTitle className="mt-1 text-base">Scoped operating picture</CardTitle></CardHeader><CardContent className="grid gap-2 p-4 sm:grid-cols-2"><div className="rounded-xl border border-border/70 bg-muted/[0.08] p-3"><Cpu className="h-4 w-4 text-cyan-300" /><p className="mt-3 text-xl font-semibold">{summary.fresh_devices ?? 0}/{summary.devices ?? 0}</p><p className="mt-1 text-xs text-muted-foreground">Fresh device observations</p></div><div className="rounded-xl border border-border/70 bg-muted/[0.08] p-3"><Radio className="h-4 w-4 text-emerald-300" /><p className="mt-3 text-xl font-semibold">{summary.online_agents ?? 0}/{summary.agents ?? 0}</p><p className="mt-1 text-xs text-muted-foreground">Nexus Agents within window</p></div><div className="rounded-xl border border-border/70 bg-muted/[0.08] p-3"><Ticket className="h-4 w-4 text-amber-300" /><p className="mt-3 text-xl font-semibold">{summary.open_tickets ?? 0}</p><p className="mt-1 text-xs text-muted-foreground">Open service records</p></div><div className="rounded-xl border border-border/70 bg-muted/[0.08] p-3"><HardDrive className="h-4 w-4 text-violet-300" /><p className="mt-3 text-xl font-semibold">{summary.backup_attention ?? 0}</p><p className="mt-1 text-xs text-muted-foreground">Backup jobs needing review</p></div></CardContent></Card>

        <Card className={SURFACE}><CardHeader className="border-b border-border/70 pb-3"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Observation trail</p><CardTitle className="mt-1 text-base">Freshness, not animation</CardTitle><p className="text-xs leading-5 text-muted-foreground">A current card is useful only when it shows when Nexus last observed the underlying source.</p></CardHeader><CardContent className="max-h-[22rem] space-y-2 overflow-y-auto p-4">{freshness.length ? freshness.slice(0, 12).map((item, index) => <div key={`${item.source}-${item.observed_at}-${index}`} className="flex items-start gap-3 rounded-xl border border-border/70 bg-muted/[0.08] p-3"><Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" /><div className="min-w-0"><p className="text-sm font-medium">{item.source}</p><p className="mt-1 text-xs text-muted-foreground">{formatDate(item.observed_at)} · {human(item.state)}</p></div></div>) : <div className="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">No timestamped observation is retained in this scope yet. Pulse will keep that uncertainty visible.</div>}</CardContent></Card>
      </div>
    </div>
  </div>;
}
