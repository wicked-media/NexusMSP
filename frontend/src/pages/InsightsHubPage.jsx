import { useEffect, useState, useMemo, useCallback } from "react";
import axios from "axios";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { API, useAuth } from "@/App";
import { PageShell } from "@/components/design-system";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";
import SecondBrainView from "@/components/insights/SecondBrainView";
import { WorkspaceErrorState, WorkspaceLoadingState } from "@/components/WorkspaceState";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Brain, Battery, ShieldCheck, AlertOctagon, DollarSign,
  Award, BookOpen, Mic, Loader2, RefreshCw, Server, Sparkles, ChevronRight, Download, BrainCircuit, Copy,
} from "lucide-react";
import { toast } from "sonner";

const fmt$ = (n) => `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const INSIGHT_SURFACE = "overflow-hidden rounded-2xl border border-border/70 bg-card/90 shadow-[0_18px_45px_-34px_rgba(0,0,0,0.95)]";
const LEGACY_INSIGHT_DESTINATIONS = {
  overload: "/team-hub?tab=command&view=capacity",
  patches: "/patch-compliance",
  trajectory: "/devices",
  battery: "/devices",
  ar: "/reports?tab=commercial",
  xp: "/team-hub?tab=command&view=skills",
  vault: "/compliance?tab=insurance",
  brief: "/voice",
};

function InsightNotice({ icon: Icon = Sparkles, title, description, action }) {
  return (
    <Card className={`${INSIGHT_SURFACE} border-dashed`}>
      <CardContent className="flex flex-col items-center gap-3 px-6 py-10 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-sky-400/20 bg-sky-400/[0.08]"><Icon className="h-5 w-5 text-sky-300" /></span>
        <div><h2 className="text-base font-semibold">{title}</h2><p className="mt-1 max-w-lg text-sm text-muted-foreground">{description}</p></div>
        {action}
      </CardContent>
    </Card>
  );
}

function useApi(token) {
  return useMemo(() => ({
    get: (path) => axios.get(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.data),
    post: (path, body) => axios.post(`${API}${path}`, body || {}, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.data),
  }), [token]);
}

export default function InsightsHubPage() {
  const { token } = useAuth();
  const api = useApi(token);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const validTabs = ["brain", "runbooks"];
  const [tab, setTab] = useState(validTabs.includes(requestedTab) ? requestedTab : "brain");

  useEffect(() => {
    const destination = LEGACY_INSIGHT_DESTINATIONS[requestedTab];
    if (destination) navigate(destination, { replace: true });
  }, [navigate, requestedTab]); // Legacy insight links now open their authoritative workspace.

  const selectTab = (nextTab) => {
    setTab(nextTab);
    setSearchParams(nextTab === "brain" ? {} : { tab: nextTab }, { replace: true });
  };

  return (
    <PageShell>
      <div className="space-y-5" data-testid="insights-hub-page">
        <OperationalPageHeader
          eyebrow="Nexus Intelligence · tenant-private evidence"
          title="Operational memory, made useful"
          description="Find repeat demand, knowledge gaps, reusable outcomes and documented operational decisions—always linked back to the Nexus records that support them. Suggestions never change systems, tickets or client records automatically."
          icon={BrainCircuit}
          tone="violet"
          signal="recommendation"
          actions={<><Button asChild variant="outline" size="sm"><Link to="/documentation-hub?tab=library"><BookOpen className="mr-1.5 h-3.5 w-3.5" />Knowledge library</Link></Button><Button variant="outline" size="sm" onClick={() => selectTab("runbooks")}><BookOpen className="mr-1.5 h-3.5 w-3.5" />Runbooks</Button><Button size="sm" onClick={() => selectTab("brain")}><BrainCircuit className="mr-1.5 h-3.5 w-3.5" />Ask Nexus Memory</Button></>}
        />

        <Tabs value={tab} onValueChange={selectTab} className="w-full">
          <TabsList className="grid h-auto w-full max-w-xl grid-cols-2 gap-1 rounded-2xl border border-border/70 bg-muted/30 p-1.5" data-testid="insights-tabs">
            <TabsTrigger className="justify-center gap-1.5 rounded-xl px-3 py-2 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm" value="brain" data-testid="tab-brain"><BrainCircuit className="w-3.5 h-3.5" />Second Brain</TabsTrigger>
            <TabsTrigger className="justify-center gap-1.5 rounded-xl px-3 py-2 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm" value="runbooks" data-testid="tab-runbooks"><BookOpen className="w-3.5 h-3.5" />Runbooks</TabsTrigger>
          </TabsList>

          <TabsContent value="brain"><SecondBrainView api={api} /></TabsContent>
          <TabsContent value="runbooks"><RunbooksView api={api} /></TabsContent>
        </Tabs>
      </div>
    </PageShell>
  );
}

const STATUS_COLOURS = {
  burnout: "text-rose-400 border-rose-500/40 bg-rose-500/10",
  stretched: "text-amber-400 border-amber-500/40 bg-amber-500/10",
  healthy: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10",
  available: "text-sky-400 border-sky-500/40 bg-sky-500/10",
};

function Loader({ label = "Loading…" }) {
  return <WorkspaceLoadingState className="mt-4" label={label} />;
}

function InsightFetchError({ error, onRetry, title = "Insight data is unavailable" }) {
  return <WorkspaceErrorState className="mt-4" title={title} description={error || "Nexus could not retrieve this insight. No operational state has been changed."} onRetry={onRetry} retryLabel="Retry insight" />;
}

function useFetch(api, path, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reload = useCallback(() => {
    setLoading(true);
    setError("");
    api.get(path).then(setData).catch((e) => {
      const message = e.response?.data?.detail || e.message || "Nexus could not retrieve this insight.";
      setError(message);
      toast.error(message);
    }).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, path, ...deps]);
  useEffect(() => { reload(); }, [reload]);
  return { data, loading, error, reload };
}

/* ─────────── 1. Cognitive Load ─────────── */
function _CognitiveLoadView({ api }) {
  const { data, loading, error, reload } = useFetch(api, "/team/cognitive-load");
  if (loading) return <Loader label="Scoring tech load…" />;
  if (error) return <InsightFetchError error={error} onRetry={reload} title="Technician load is unavailable" />;
  const team = Object.values((data?.team || []).reduce((unique, technician) => {
    const key = technician.tech_id || technician.email || technician.name;
    const existing = unique[key];
    unique[key] = !existing || Number(technician.score || 0) > Number(existing.score || 0) ? technician : existing;
    return unique;
  }, {}));
  const attentionCount = team.filter((technician) => ["stretched", "burnout"].includes(technician.status)).length;
  const availableCount = team.filter((technician) => technician.status === "available").length;
  return (
    <div className="mt-4 space-y-4" data-testid="cognitive-load-card">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <HeroTile label="Technicians" value={team.length} icon={Brain} glow="violet" subtitle="Current workspace roster" />
        <HeroTile label="Available" value={availableCount} icon={ShieldCheck} glow="emerald" subtitle="No current load signal" />
        <HeroTile label="Needs review" value={attentionCount} icon={AlertOctagon} glow={attentionCount ? "amber" : "emerald"} subtitle="Stretched or overloaded" />
        <HeroTile label="Highest load" value={team.reduce((highest, technician) => Math.max(highest, Number(technician.score || 0)), 0)} icon={BrainCircuit} glow="sky" subtitle="Evidence-based score" />
      </div>
      <div className="flex flex-col gap-3 rounded-2xl border border-violet-400/20 bg-violet-400/[0.045] p-4 shadow-[0_16px_36px_-34px_rgba(139,92,246,0.55)] sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300">Assignment guardrail</p><h2 className="mt-1 text-sm font-semibold">Technician load</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Nexus flags a score of 85+ for assignment review. It does not pause work or reassign tickets automatically.</p></div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm" className="rounded-xl"><Link to="/team-hub?view=capacity">Review capacity</Link></Button>
          <Button variant="outline" size="sm" className="rounded-xl" onClick={reload} data-testid="refresh-tech-load"><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Refresh load</Button>
        </div>
      </div>
      {team.length === 0 ? <InsightNotice icon={Brain} title="No technician load evidence yet" description="Ticket assignment and priority data will appear here as technicians take work." /> : <Card className={INSIGHT_SURFACE}>
      <CardHeader className="border-b border-border/60 bg-gradient-to-r from-violet-400/[0.07] to-transparent pb-3">
        <CardTitle className="text-sm">Load evidence by technician</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto"><Table>
          <TableHeader><TableRow><TableHead>Tech</TableHead><TableHead className="text-right">Open</TableHead><TableHead className="text-right">Crit</TableHead><TableHead className="text-right">High</TableHead><TableHead className="text-right">Score</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>
            {team.map((t) => {
              const technicianKey = t.tech_id || t.email || t.name;
              return (
              <TableRow key={technicianKey} data-testid={`overload-row-${technicianKey}`}>
                <TableCell className="font-medium">{t.name}</TableCell>
                <TableCell className="text-right font-mono">{t.open_tickets}</TableCell>
                <TableCell className="text-right font-mono text-rose-400">{t.critical}</TableCell>
                <TableCell className="text-right font-mono text-amber-400">{t.high}</TableCell>
                <TableCell className="text-right font-mono font-bold">{t.score}</TableCell>
                <TableCell><Badge variant="outline" className={STATUS_COLOURS[t.status]}>{t.status}{t.auto_pause ? " · review" : ""}</Badge></TableCell>
              </TableRow>
              );
            })}
          </TableBody>
        </Table></div>
      </CardContent>
      </Card>}
    </div>
  );
}

/* ─────────── 2. Patch Anomalies ─────────── */
function _PatchAnomaliesView({ api }) {
  const { data, loading, error, reload } = useFetch(api, "/patches/anomalies");
  const [broadcasting, setBroadcasting] = useState(false);
  const broadcast = async () => {
    setBroadcasting(true);
    try {
      const r = await api.post("/patches/anomalies/broadcast");
      if (r.newly_broadcast === 0) toast.info("No new patch anomalies to broadcast.");
      else toast.success(`Broadcast ${r.newly_broadcast} alert(s)${r.webhooks_configured ? "" : " (in-app only — configure Slack/Teams in TRMM settings for webhook delivery)"}`);
      reload();
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setBroadcasting(false); }
  };
  if (loading) return <Loader label="Scanning cross-tenant patch tickets…" />;
  if (error) return <InsightFetchError error={error} onRetry={reload} title="Patch anomaly evidence is unavailable" />;
  const rows = data?.anomalies || [];
  return (
    <Card className={`mt-4 ${INSIGHT_SURFACE}`} data-testid="patch-anomalies-card">
      <CardHeader className="flex flex-col gap-3 border-b border-border/60 bg-gradient-to-r from-rose-400/[0.07] to-transparent pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-300">Cross-client safety signal</p><CardTitle className="mt-1 text-sm">Patch anomalies</CardTitle><p className="mt-1 text-xs leading-5 text-muted-foreground">Patches linked to tickets at three or more clients in the last {data?.scan_window_days || 60} days. Review the source tickets before communicating or changing policy.</p></div>
        <Button variant="outline" size="sm" className="text-rose-400 border-rose-500/30 hover:bg-rose-500/10"
          onClick={broadcast} disabled={broadcasting || rows.length === 0} data-testid="patch-broadcast-btn">
          {broadcasting ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <AlertOctagon className="w-3.5 h-3.5 mr-1" />}
          Broadcast
        </Button>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? <InsightNotice icon={ShieldCheck} title="No cross-client patch anomaly is open" description="Nexus has not found a patch tied to service demand at three or more clients in the current evidence window." /> :
          <div className="space-y-3">
            {rows.map((r) => (
              <div key={r.patch_id} className={`rounded-2xl border p-4 shadow-[0_16px_36px_-34px_rgba(0,0,0,0.9)] ${r.severity === "critical" ? "border-rose-500/40 bg-rose-500/[0.055]" : "border-amber-500/40 bg-amber-500/[0.055]"}`} data-testid={`anomaly-${r.patch_id}`}>
                <div className="flex items-center justify-between">
                  <div className="font-mono font-bold text-base">{r.patch_id}</div>
                  <Badge variant="outline" className={r.severity === "critical" ? "text-rose-400 border-rose-500/40" : "text-amber-400 border-amber-500/40"}>{r.severity} · {r.affected_clients} clients · {r.tickets_seen} tickets</Badge>
                </div>
                {r.title_samples?.length > 0 && <div className="text-xs text-muted-foreground mt-1 truncate">e.g. {r.title_samples[0]}</div>}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {r.tickets.slice(0, 5).map((t, i) => <Link key={`k-${i}`} to={`/tickets?ticket=${t.ticket_id}`} className="text-[10px] text-violet-400 hover:underline border border-violet-500/30 rounded px-1.5 py-0.5">{t.ticket_number} · {t.client_name}</Link>)}
                </div>
              </div>
            ))}
          </div>}
      </CardContent>
    </Card>
  );
}

/* ─────────── 3. Health Trajectory ─────────── */
const TRAJ_STYLE = {
  replace_now_30: { card: "border-rose-500/30", title: "text-rose-400", score: "text-rose-400", label: "Replace 0-30d" },
  replace_30_90: { card: "border-amber-500/30", title: "text-amber-400", score: "text-amber-400", label: "Replace 30-90d" },
  replace_90_365: { card: "border-sky-500/30", title: "text-sky-400", score: "text-sky-400", label: "Replace 90-365d" },
  healthy: { card: "border-emerald-500/30", title: "text-emerald-400", score: "text-emerald-400", label: "Healthy" },
};
function _HealthTrajectoryView({ api }) {
  const { data, loading, error, reload } = useFetch(api, "/device-health-trajectory");
  if (loading) return <Loader label="Calculating device replacement timelines…" />;
  if (error) return <InsightFetchError error={error} onRetry={reload} title="Device trajectory is unavailable" />;
  const buckets = data?.buckets || {};
  const totals = data?.totals || {};
  const fleetTotal = Object.values(totals).reduce((sum, value) => sum + Number(value || 0), 0);

  return (
    <div className="mt-3 space-y-4" data-testid="health-trajectory-card">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <HeroTile label="Replace now" value={totals.replace_now_30 || 0} icon={AlertOctagon} glow="rose" subtitle="Act within 30 days" />
        <HeroTile label="Plan next" value={totals.plan_next_90 || 0} icon={Server} glow="amber" subtitle="Plan within 90 days" />
        <HeroTile label="Lifecycle queue" value={totals.monitor || 0} icon={RefreshCw} glow="violet" subtitle="Monitor for replacement" />
        <HeroTile label="Healthy fleet" value={totals.healthy || fleetTotal} icon={ShieldCheck} glow="emerald" subtitle={`${fleetTotal} assessed endpoints`} />
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-sky-400/20 bg-sky-400/[0.045] px-4 py-3 shadow-[0_16px_36px_-34px_rgba(56,189,248,0.42)] sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold">Replacement evidence</h2>
          <p className="text-xs text-muted-foreground">Open an asset directly to review its health, telemetry, and remediation history before planning replacement.</p>
        </div>
        <Button size="sm" variant="outline" onClick={reload} className="shrink-0">
          <RefreshCw className="mr-2 h-3.5 w-3.5" />Refresh trajectory
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        {Object.keys(TRAJ_STYLE).map((b) => {
          const s = TRAJ_STYLE[b];
          return (
            <Card key={b} className={`${INSIGHT_SURFACE} ${s.card}`}>
              <CardHeader className="pb-2"><CardTitle className={`text-xs uppercase tracking-widest ${s.title}`}>{s.label} <span className="ml-2 font-mono text-base text-foreground">{totals[b] || 0}</span></CardTitle></CardHeader>
              <CardContent className="max-h-72 space-y-1.5 overflow-y-auto text-xs">
                {(buckets[b] || []).slice(0, 12).map((d) => (
                  <Link key={d.device_id} to={`/devices/${d.device_id}`} className="flex items-center justify-between border-b border-border/30 pb-1 transition-colors hover:text-primary">
                    <div className="min-w-0"><div className="truncate font-medium">{d.name}</div><div className="truncate text-[10px] text-muted-foreground">{d.client_name} · age {d.age_days || "?"}d · err {d.errors}</div></div>
                    <div className={`ml-2 font-mono ${s.score}`}>{d.score}</div>
                  </Link>
                ))}
                {(buckets[b] || []).length === 0 && <div className="py-3 text-center text-muted-foreground">None</div>}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────── 4. Battery Wall ─────────── */
function _BatteryWallView({ api }) {
  const { data, loading, error, reload } = useFetch(api, "/device-battery-wall");
  if (loading) return <Loader label="Inspecting laptop batteries…" />;
  if (error) return <InsightFetchError error={error} onRetry={reload} title="Battery health is unavailable" />;
  const rows = data?.devices || [];
  const replaceCount = rows.filter((row) => row.recommend === "replace").length;
  const planCount = rows.filter((row) => row.recommend !== "replace").length;
  const averageHealth = rows.length
    ? Math.round(rows.reduce((sum, row) => sum + Number(row.battery_health || 0), 0) / rows.length)
    : 100;

  return (
    <div className="mt-3 space-y-4" data-testid="battery-wall-card">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <HeroTile label="Replace now" value={replaceCount} icon={AlertOctagon} glow="rose" subtitle="Critically degraded batteries" />
        <HeroTile label="Plan refresh" value={planCount} icon={Battery} glow="amber" subtitle="Monitor or schedule replacement" />
        <HeroTile label="Average health" value={averageHealth} suffix="%" icon={Battery} glow={averageHealth < 70 ? "amber" : "emerald"} subtitle="Across flagged laptops" />
        <HeroTile label="Devices reviewed" value={rows.length} icon={Server} glow="cyan" subtitle="Top 20 at-risk devices" />
      </div>

      <Card className={INSIGHT_SURFACE}>
      <CardHeader className="flex flex-col gap-3 border-b border-border/60 bg-gradient-to-r from-amber-400/[0.07] to-transparent pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300">Endpoint lifecycle signal</p>
          <CardTitle className="text-sm">Battery replacement queue</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">Prioritised from the latest endpoint telemetry. Open the asset to confirm diagnostics before approving a replacement.</p>
        </div>
        <Button size="sm" variant="outline" onClick={reload} className="shrink-0"><RefreshCw className="mr-2 h-3.5 w-3.5" />Refresh readings</Button>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? <InsightNotice icon={Battery} title="No degraded batteries need review" description="Nexus has not found a laptop battery that meets the current replacement threshold." /> :
          <div className="overflow-x-auto"><Table>
            <TableHeader><TableRow><TableHead>Device</TableHead><TableHead>Client</TableHead><TableHead className="text-right">Health %</TableHead><TableHead className="text-right">Cycles</TableHead><TableHead>Recommendation</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.device_id} data-testid={`battery-${r.device_id}`}>
                  <TableCell className="font-medium">{r.name}{r.inferred && <Badge variant="outline" className="ml-2 text-[9px] text-muted-foreground">inferred</Badge>}</TableCell>
                  <TableCell className="text-muted-foreground">{r.client_name}</TableCell>
                  <TableCell className={`text-right font-mono font-bold ${r.battery_health < 50 ? "text-rose-400" : r.battery_health < 70 ? "text-amber-400" : "text-emerald-400"}`}>{r.battery_health}%</TableCell>
                  <TableCell className="text-right font-mono">{r.battery_cycles || "—"}</TableCell>
                  <TableCell><Badge variant="outline" className={r.recommend === "replace" ? "text-rose-400 border-rose-500/40" : "text-amber-400 border-amber-500/40"}>{r.recommend}</Badge></TableCell>
                  <TableCell className="text-right"><Button asChild size="sm" variant="ghost"><Link to={`/devices/${r.device_id}`}>Open asset<ChevronRight className="ml-1 h-3.5 w-3.5" /></Link></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table></div>}
      </CardContent>
      </Card>
    </div>
  );
}

/* ─────────── 5. Aged AR Heatmap ─────────── */
const AR_STYLE = {
  current: { box: "border-emerald-500/30 bg-emerald-500/5", title: "text-emerald-400", num: "text-emerald-400", label: "Current" },
  "1_30": { box: "border-sky-500/30 bg-sky-500/5", title: "text-sky-400", num: "text-sky-400", label: "1-30d" },
  "31_60": { box: "border-amber-500/30 bg-amber-500/5", title: "text-amber-400", num: "text-amber-400", label: "31-60d" },
  "61_90": { box: "border-orange-500/30 bg-orange-500/5", title: "text-orange-400", num: "text-orange-400", label: "61-90d" },
  over_90: { box: "border-rose-500/30 bg-rose-500/5", title: "text-rose-400", num: "text-rose-400", label: "Over 90d" },
};
function _AgedARView({ api }) {
  const { data, loading, error, reload } = useFetch(api, "/aged-ar-heatmap");
  if (loading) return <Loader label="Bucketing AR…" />;
  if (error) return <InsightFetchError error={error} onRetry={reload} title="Receivables evidence is unavailable" />;
  const totals = data?.bucket_totals || {};
  const buckets = data?.buckets || {};
  const invoiceCount = Object.values(buckets).reduce((count, invoices) => count + invoices.length, 0);
  return (
    <div className="space-y-4 mt-3" data-testid="aged-ar-card">
      <div className="flex flex-col gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.045] px-4 py-3 shadow-[0_16px_36px_-34px_rgba(52,211,153,0.45)] sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300">Finance attention</p><h2 className="mt-1 text-sm font-semibold">Aged receivables</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Use the bucket view to prioritise collections. It surfaces balances only; it does not send reminders or change invoice status.</p></div>
        <div className="flex flex-wrap gap-2"><Button asChild size="sm" variant="outline" className="rounded-xl"><Link to="/billing-dashboard">Open billing</Link></Button><Button size="sm" variant="outline" onClick={reload} className="rounded-xl"><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Refresh AR</Button></div>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {Object.keys(AR_STYLE).map((k) => {
          const s = AR_STYLE[k];
          return (
            <div key={k} className={`rounded-2xl border p-3 shadow-[0_14px_30px_-28px_rgba(0,0,0,0.9)] ${s.box}`}>
              <div className={`text-[10px] uppercase tracking-widest ${s.title}`}>{s.label}</div>
              <div className="text-lg font-mono font-bold mt-1">{fmt$(totals[k])}</div>
              <div className="text-[10px] text-muted-foreground">{(buckets[k] || []).length} invoices</div>
            </div>
          );
        })}
      </div>
      <div className="text-right text-xs text-muted-foreground">Total outstanding: <span className="font-mono font-bold text-foreground">{fmt$(data?.total_outstanding)}</span></div>
      {invoiceCount === 0 ? <InsightNotice icon={DollarSign} title="No outstanding invoices need collection" description="There are no invoices in the currently returned receivables buckets. Use Billing to review drafting or recently settled invoices." action={<Button asChild size="sm" variant="outline" className="rounded-xl"><Link to="/billing-dashboard">Open billing</Link></Button>} /> : Object.keys(buckets).map((k) => {
        const s = AR_STYLE[k];
        return (buckets[k] || []).length > 0 && (
          <Card key={k} className={`${INSIGHT_SURFACE} ${s.box}`}>
            <CardHeader className="border-b border-border/50 pb-3"><CardTitle className={`text-xs uppercase tracking-widest ${s.title}`}>{s.label}</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto"><Table>
                <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Client</TableHead><TableHead className="text-right">Days</TableHead><TableHead className="text-right">Balance</TableHead></TableRow></TableHeader>
                <TableBody>
                  {buckets[k].map((r) => (
                    <TableRow key={r.invoice_id}>
                      <TableCell className="font-mono">{r.invoice_number}</TableCell>
                      <TableCell>{r.client_name}</TableCell>
                      <TableCell className={`text-right font-mono ${s.num}`}>{r.days_overdue}</TableCell>
                      <TableCell className="text-right font-mono">{fmt$(r.balance)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table></div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/* ─────────── 6. Skills XP ─────────── */
function _SkillsXPView({ api }) {
  const { data, loading, error, reload } = useFetch(api, "/team/xp");
  if (loading) return <Loader label="Calculating XP from closed tickets…" />;
  if (error) return <InsightFetchError error={error} onRetry={reload} title="Skills evidence is unavailable" />;
  const team = data?.team || [];
  return (
    <div className="mt-3 space-y-4" data-testid="skills-xp-card">
      <div className="flex flex-col gap-3 rounded-2xl border border-violet-400/20 bg-violet-400/[0.045] px-4 py-3 shadow-[0_16px_36px_-34px_rgba(139,92,246,0.5)] sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300">Capability evidence</p><h2 className="mt-1 text-sm font-semibold">Skills XP</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Recorded outcome evidence from resolved work. This is not a performance grade and does not make staffing decisions automatically.</p></div>
        <Button size="sm" variant="outline" onClick={reload} className="rounded-xl"><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Refresh skills</Button>
      </div>
      {team.length === 0 ? <InsightNotice icon={Award} title="No resolved-work evidence yet" description="Skill evidence will appear once technicians close tickets with a classified outcome." /> : <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
      {team.map((t) => (
        <Card key={t.tech} className={`${INSIGHT_SURFACE} border-violet-500/20 bg-violet-500/[0.03]`}>
          <CardHeader className="pb-2 flex flex-row items-start justify-between">
            <CardTitle className="text-sm">{t.tech}</CardTitle>
            <Badge variant="outline" className="text-violet-400 border-violet-500/40 bg-violet-500/10"><Award className="w-3 h-3 mr-1" />Lvl {t.level} · {t.total_xp.toLocaleString()} XP</Badge>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {t.top_skills.map((s) => (
              <div key={s.skill} className="flex items-center justify-between text-xs">
                <div className="text-muted-foreground capitalize">{s.skill}</div>
                <div className="font-mono">{s.xp.toLocaleString()} XP</div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
      </div>}
    </div>
  );
}

/* ─────────── 7. Insurance Vault ─────────── */
const PCT_TONE = (v, hi, mid) => v >= hi ? "emerald" : v >= mid ? "amber" : "rose";
const TONE_CLASS = {
  emerald: { bdr: "border-emerald-500/40", txt: "text-emerald-400", bg: "bg-emerald-500/10" },
  amber: { bdr: "border-amber-500/40", txt: "text-amber-400", bg: "bg-amber-500/10" },
  rose: { bdr: "border-rose-500/40", txt: "text-rose-400", bg: "bg-rose-500/10" },
};
function _InsuranceVaultView({ api }) {
  const { token } = useAuth();
  const { data, loading, error, reload } = useFetch(api, "/security/insurance-vault");
  const [downloading, setDownloading] = useState(false);
  const downloadPdf = async () => {
    setDownloading(true);
    try {
      const r = await axios.get(`${API}/security/insurance-vault.pdf`, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: "blob",
      });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a");
      a.href = url; a.download = `insurance-vault-${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click(); URL.revokeObjectURL(url);
      toast.success("Evidence pack downloaded");
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setDownloading(false); }
  };
  if (loading) return <Loader label="Aggregating cyber-insurance evidence…" />;
  if (error) return <InsightFetchError error={error} onRetry={reload} title="Insurance evidence is unavailable" />;
  const c = data?.controls || {};
  const stats = [
    { k: "MFA coverage", v: c.mfa_coverage_pct ?? null, tone: PCT_TONE(c.mfa_coverage_pct ?? 0, 95, 80) },
    { k: "EDR coverage", v: c.edr_coverage_pct ?? null, tone: PCT_TONE(c.edr_coverage_pct ?? 0, 95, 80) },
    { k: "Encryption", v: c.encryption_pct ?? null, tone: PCT_TONE(c.encryption_pct ?? 0, 90, 70) },
    { k: "Patched ≤ 30d", v: c.patched_within_30_days_pct ?? null, tone: PCT_TONE(c.patched_within_30_days_pct ?? 0, 85, 60) },
  ];
  const tierTone = data?.readiness_state === "ready_for_review" ? "emerald" : data?.readiness_state === "evidence_gaps" ? "amber" : "rose";
  const tt = TONE_CLASS[tierTone];
  const readinessLabel = data?.readiness_state === "ready_for_review" ? "Ready for review" : data?.readiness_state === "evidence_gaps" ? "Evidence gaps" : "Not assessed";
  return (
    <div className="space-y-4 mt-3" data-testid="insurance-vault-card">
      <div className="flex flex-col gap-3 rounded-2xl border border-sky-400/20 bg-sky-400/[0.045] px-4 py-3 shadow-[0_16px_36px_-34px_rgba(56,189,248,0.45)] sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-300">Evidence readiness</p><h2 className="mt-1 text-sm font-semibold">Insurance evidence vault</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">A point-in-time evidence pack for review. Verify insurer-specific requirements before relying on it for underwriting or a claim.</p></div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
            onClick={downloadPdf} disabled={downloading} data-testid="vault-download-pdf-btn">
            {downloading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-1" />}
            Download PDF
          </Button>
          <Button size="sm" variant="outline" onClick={reload} className="rounded-xl"><RefreshCw className="mr-1.5 w-3.5 h-3.5" />Refresh evidence</Button>
        </div>
      </div>
      <Badge variant="outline" className={`${tt.txt} ${tt.bdr} ${tt.bg} rounded-xl px-3 py-1.5 text-sm`}>
        <ShieldCheck className="mr-2 h-4 w-4" />{data?.readiness_score == null ? "Evidence not assessed" : `Readiness ${data.readiness_score}/100`} · {readinessLabel}
      </Badge>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((s) => (
          <Card key={s.k} className={`${INSIGHT_SURFACE} ${TONE_CLASS[s.tone].bdr}`}><CardContent className="p-4">
            <div className={`text-[10px] uppercase tracking-widest ${TONE_CLASS[s.tone].txt}`}>{s.k}</div>
            <div className="text-2xl font-mono font-bold mt-1">{s.v == null ? "—" : `${s.v}%`}</div>
          </CardContent></Card>
        ))}
      </div>
      <Card className={INSIGHT_SURFACE}>
        <CardHeader className="border-b border-border/60 pb-3"><CardTitle className="text-xs uppercase tracking-widest text-muted-foreground">Last restore drill</CardTitle></CardHeader>
        <CardContent className="text-sm">
          {data?.last_restore_drill ?
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <Badge variant="outline" className="text-emerald-400 border-emerald-500/40">{data.last_restore_drill.status}</Badge>
              <span>{data.last_restore_drill.scope}</span>
              <span className="text-muted-foreground">at {(data.last_restore_drill.completed_at || "").slice(0, 16)}</span>
              {data.last_restore_drill.outcome && <span className="text-muted-foreground italic">— {data.last_restore_drill.outcome}</span>}
            </div>
            : <div className="flex items-center gap-2 text-xs text-rose-400"><AlertOctagon className="h-3.5 w-3.5" />No completed restore drill is on record. Confirm the evidence requirement before a review.</div>}
        </CardContent>
      </Card>
      <div className="text-[10px] text-muted-foreground">Open security alerts: {c.open_security_alerts ?? 0} · Devices counted: {data?.device_count}</div>
    </div>
  );
}

/* ─────────── 8. Voice Brief ─────────── */
function _VoiceBriefView({ api }) {
  const [text, setText] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const generate = useCallback(async () => {
    setLoading(true);
    setError("");
    try { const r = await api.post("/voice/morning-brief"); setText(r.text); setStats(r.stats); }
    catch (e) { const message = e.response?.data?.detail || e.message || "Nexus could not prepare the voice brief."; setError(message); toast.error(message); }
    finally { setLoading(false); }
  }, [api]);
  useEffect(() => { generate(); }, [generate]);
  const copyBrief = async () => {
    try { await navigator.clipboard.writeText(text || ""); toast.success("Brief copied"); }
    catch { toast.error("Nexus could not copy the brief."); }
  };
  if (loading && !text) return <Loader label="Drafting overnight brief…" />;
  if (error && !text) return <InsightFetchError error={error} onRetry={generate} title="Voice brief is unavailable" />;
  return (
    <Card className={`mt-3 ${INSIGHT_SURFACE}`} data-testid="voice-brief-card">
      <CardHeader className="flex flex-col gap-3 border-b border-border/60 bg-gradient-to-r from-violet-400/[0.07] to-transparent pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300">Shift handover</p><CardTitle className="mt-1 flex items-center gap-2 text-sm"><Mic className="h-4 w-4 text-violet-400" />Morning voice brief</CardTitle><p className="mt-1 text-xs leading-5 text-muted-foreground">Drafted from existing operational records for review before use. It does not send or change any records.</p></div>
        <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={copyBrief} disabled={!text} className="rounded-xl"><Copy className="mr-1.5 h-3.5 w-3.5" />Copy brief</Button><Button variant="outline" size="sm" onClick={generate} disabled={loading} className="rounded-xl text-violet-400 border-violet-500/30 hover:bg-violet-500/10" data-testid="voice-brief-regen">{loading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}Regenerate</Button></div>
      </CardHeader>
      <CardContent>
        {stats && (
          <div className="flex flex-wrap gap-2 text-[10px] mb-3">
            <Badge variant="outline">{stats.new_tickets} new tickets</Badge>
            {stats.critical > 0 && <Badge variant="outline" className="text-rose-400 border-rose-500/40">{stats.critical} critical</Badge>}
            {stats.backup_failures > 0 && <Badge variant="outline" className="text-amber-400 border-amber-500/40">{stats.backup_failures} backup fails</Badge>}
            <Badge variant="outline">{stats.huntress_alerts} Huntress alerts</Badge>
          </div>
        )}
        {text ? <div className="whitespace-pre-wrap rounded-2xl border border-border/60 bg-muted/20 p-4 text-sm leading-relaxed" data-testid="voice-brief-text">{text}</div> : <InsightNotice icon={Mic} title="No handover brief was returned" description="Refresh the brief once the overnight ticket and monitoring data is available." action={<Button variant="outline" size="sm" onClick={generate} className="rounded-xl">Refresh brief</Button>} />}
      </CardContent>
    </Card>
  );
}

/* ─────────── 9. Runbooks ─────────── */
function RunbooksView({ api }) {
  const [q, setQ] = useState("");
  const { data, loading, error, reload } = useFetch(api, `/runbooks${q ? `?q=${encodeURIComponent(q)}` : ""}`, [q]);
  if (loading) return <Loader label="Loading runbooks…" />;
  if (error) return <InsightFetchError error={error} onRetry={reload} title="Runbooks are unavailable" />;
  const rows = Array.isArray(data) ? data : [];
  return (
    <Card className={`mt-3 ${INSIGHT_SURFACE}`} data-testid="runbooks-card">
      <CardHeader className="flex flex-col gap-3 border-b border-border/60 bg-gradient-to-r from-sky-400/[0.07] to-transparent pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-300">Reusable operational knowledge</p><CardTitle className="mt-1 text-sm">Runbook library · {rows.length} published</CardTitle><p className="mt-1 text-xs text-muted-foreground">Ticket-derived procedures that are published for technician reuse.</p></div>
        <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
          <Input aria-label="Search runbooks" placeholder="Search title, tag, or category…" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 min-w-0 text-xs sm:w-64" data-testid="runbook-search" />
          <Button variant="outline" size="sm" onClick={reload} className="shrink-0 rounded-xl"><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Refresh</Button>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? <InsightNotice icon={BookOpen} title={q ? "No runbooks match this search" : "No runbooks have been published"} description={q ? "Try a title, tag, or category from the documented work." : "Promote verified resolution knowledge from Documentation Hub to give technicians a reusable starting point."} action={<Button asChild size="sm" variant="outline" className="rounded-xl"><Link to="/documentation-hub">Open documentation</Link></Button>} /> :
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {rows.map((r) => (
              <Card key={r.id} className="rounded-2xl border-border/60 bg-muted/[0.12] transition-colors hover:border-sky-400/30" data-testid={`runbook-${r.id}`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2 flex-wrap"><BookOpen className="w-3.5 h-3.5 text-violet-400" />{r.title}<Badge variant="outline" className="border-emerald-500/25 bg-emerald-500/10 text-[10px] text-emerald-300">Published</Badge>{r.category && <Badge variant="outline" className="text-[10px]">{r.category}</Badge>}</CardTitle>
                  {r.summary && <p className="mt-1 text-xs text-muted-foreground">{r.summary.startsWith("Draft procedure created from resolved ticket") ? "Starter procedure from a resolved ticket. Validate and refine each step before relying on it in a live incident." : r.summary}</p>}
                </CardHeader>
                <CardContent className="space-y-1.5 text-xs">
                  {(r.steps || []).slice(0, 8).map((s, i) => (
                    <div key={`k-${i}`} className="flex gap-2"><span className="text-violet-400 font-mono">{i + 1}.</span><div><div className="font-medium">{s.step}</div><div className="text-muted-foreground">{s.detail}</div></div></div>
                  ))}
                  <div className="flex gap-1 flex-wrap mt-2">
                    {(r.tags || []).map((t) => <Badge key={t} variant="outline" className="text-[10px]">#{t}</Badge>)}
                    {r.source_ticket_number && <Link to={`/tickets?ticket=${r.source_ticket_id}`} className="ml-auto inline-flex items-center text-[10px] text-violet-400 hover:underline">Ticket-derived · {r.source_ticket_number}<ChevronRight className="w-3 h-3" /></Link>}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>}
      </CardContent>
    </Card>
  );
}
