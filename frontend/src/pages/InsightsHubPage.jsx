import { useEffect, useState, useMemo, useCallback } from "react";
import axios from "axios";
import { Link, useSearchParams } from "react-router-dom";
import { API, useAuth } from "@/App";
import { PageShell } from "@/components/design-system";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Brain, Battery, ShieldCheck, AlertOctagon, DollarSign,
  Award, BookOpen, Mic, Loader2, RefreshCw, Server, Sparkles, ChevronRight, Download,
} from "lucide-react";
import { toast } from "sonner";

const fmt$ = (n) => `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

function useApi(token) {
  return useMemo(() => ({
    get: (path) => axios.get(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.data),
    post: (path, body) => axios.post(`${API}${path}`, body || {}, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.data),
  }), [token]);
}

export default function InsightsHubPage() {
  const { token } = useAuth();
  const api = useApi(token);
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const [tab, setTab] = useState(requestedTab === "runbooks" ? "runbooks" : "overload");

  const selectTab = (nextTab) => {
    setTab(nextTab);
    setSearchParams(nextTab === "overload" ? {} : { tab: nextTab }, { replace: true });
  };

  return (
    <PageShell>
      <div className="space-y-5" data-testid="insights-hub-page">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-violet-400 mb-1 flex items-center gap-2">
              <Sparkles className="w-3 h-3" />Insights Hub
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Cross-cutting Intelligence</h1>
            <p className="text-sm text-muted-foreground">9 cross-tenant analytics surfaces — built from your live data.</p>
          </div>
        </div>

        <Tabs value={tab} onValueChange={selectTab} className="w-full">
          <TabsList className="flex-wrap h-auto" data-testid="insights-tabs">
            <TabsTrigger value="overload" data-testid="tab-overload"><Brain className="w-3 h-3 mr-1" />Tech Load</TabsTrigger>
            <TabsTrigger value="patches" data-testid="tab-patches"><AlertOctagon className="w-3 h-3 mr-1" />Patch Anomalies</TabsTrigger>
            <TabsTrigger value="trajectory" data-testid="tab-trajectory"><Server className="w-3 h-3 mr-1" />Device Trajectory</TabsTrigger>
            <TabsTrigger value="battery" data-testid="tab-battery"><Battery className="w-3 h-3 mr-1" />Battery Wall</TabsTrigger>
            <TabsTrigger value="ar" data-testid="tab-ar"><DollarSign className="w-3 h-3 mr-1" />Aged AR</TabsTrigger>
            <TabsTrigger value="xp" data-testid="tab-xp"><Award className="w-3 h-3 mr-1" />Skills XP</TabsTrigger>
            <TabsTrigger value="vault" data-testid="tab-vault"><ShieldCheck className="w-3 h-3 mr-1" />Insurance Vault</TabsTrigger>
            <TabsTrigger value="brief" data-testid="tab-brief"><Mic className="w-3 h-3 mr-1" />Voice Brief</TabsTrigger>
            <TabsTrigger value="runbooks" data-testid="tab-runbooks"><BookOpen className="w-3 h-3 mr-1" />Runbooks</TabsTrigger>
          </TabsList>

          <TabsContent value="overload"><CognitiveLoadView api={api} /></TabsContent>
          <TabsContent value="patches"><PatchAnomaliesView api={api} /></TabsContent>
          <TabsContent value="trajectory"><HealthTrajectoryView api={api} /></TabsContent>
          <TabsContent value="battery"><BatteryWallView api={api} /></TabsContent>
          <TabsContent value="ar"><AgedARView api={api} /></TabsContent>
          <TabsContent value="xp"><SkillsXPView api={api} /></TabsContent>
          <TabsContent value="vault"><InsuranceVaultView api={api} /></TabsContent>
          <TabsContent value="brief"><VoiceBriefView api={api} /></TabsContent>
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
  return <div className="py-12 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />{label}</div>;
}

function useFetch(api, path, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => {
    setLoading(true);
    api.get(path).then(setData).catch((e) => toast.error(e.response?.data?.detail || e.message)).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, path, ...deps]);
  useEffect(() => { reload(); }, [reload]);
  return { data, loading, reload };
}

/* ─────────── 1. Cognitive Load ─────────── */
function CognitiveLoadView({ api }) {
  const { data, loading, reload } = useFetch(api, "/team/cognitive-load");
  if (loading) return <Loader label="Scoring tech load…" />;
  const team = data?.team || [];
  return (
    <Card className="mt-3" data-testid="cognitive-load-card">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm">Tech Cognitive Load — auto-pause when score ≥ 85</CardTitle>
        <Button variant="ghost" size="sm" onClick={reload}><RefreshCw className="w-3.5 h-3.5" /></Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>Tech</TableHead><TableHead className="text-right">Open</TableHead><TableHead className="text-right">Crit</TableHead><TableHead className="text-right">High</TableHead><TableHead className="text-right">Score</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>
            {team.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No technicians found</TableCell></TableRow>}
            {team.map((t) => (
              <TableRow key={t.tech_id} data-testid={`overload-row-${t.tech_id}`}>
                <TableCell className="font-medium">{t.name}</TableCell>
                <TableCell className="text-right font-mono">{t.open_tickets}</TableCell>
                <TableCell className="text-right font-mono text-rose-400">{t.critical}</TableCell>
                <TableCell className="text-right font-mono text-amber-400">{t.high}</TableCell>
                <TableCell className="text-right font-mono font-bold">{t.score}</TableCell>
                <TableCell><Badge variant="outline" className={STATUS_COLOURS[t.status]}>{t.status}{t.auto_pause ? " · paused" : ""}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* ─────────── 2. Patch Anomalies ─────────── */
function PatchAnomaliesView({ api }) {
  const { data, loading, reload } = useFetch(api, "/patches/anomalies");
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
  const rows = data?.anomalies || [];
  return (
    <Card className="mt-3" data-testid="patch-anomalies-card">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm">Patches causing tickets at 3+ clients (last {data?.scan_window_days || 60}d)</CardTitle>
        <Button variant="outline" size="sm" className="text-rose-400 border-rose-500/30 hover:bg-rose-500/10"
          onClick={broadcast} disabled={broadcasting || rows.length === 0} data-testid="patch-broadcast-btn">
          {broadcasting ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <AlertOctagon className="w-3.5 h-3.5 mr-1" />}
          Broadcast
        </Button>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? <div className="text-center py-8 text-sm text-emerald-400">No cross-client patch issues detected.</div> :
          <div className="space-y-3">
            {rows.map((r) => (
              <div key={r.patch_id} className={`rounded-md border p-3 ${r.severity === "critical" ? "border-rose-500/40 bg-rose-500/5" : "border-amber-500/40 bg-amber-500/5"}`} data-testid={`anomaly-${r.patch_id}`}>
                <div className="flex items-center justify-between">
                  <div className="font-mono font-bold text-base">{r.patch_id}</div>
                  <Badge variant="outline" className={r.severity === "critical" ? "text-rose-400 border-rose-500/40" : "text-amber-400 border-amber-500/40"}>{r.severity} · {r.affected_clients} clients · {r.tickets_seen} tickets</Badge>
                </div>
                {r.title_samples?.length > 0 && <div className="text-xs text-muted-foreground mt-1 truncate">e.g. {r.title_samples[0]}</div>}
                <div className="mt-2 flex flex-wrap gap-1">
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
function HealthTrajectoryView({ api }) {
  const { data, loading } = useFetch(api, "/device-health-trajectory");
  if (loading) return <Loader label="Calculating device replacement timelines…" />;
  const buckets = data?.buckets || {};
  const totals = data?.totals || {};
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mt-3" data-testid="health-trajectory-card">
      {Object.keys(TRAJ_STYLE).map((b) => {
        const s = TRAJ_STYLE[b];
        return (
          <Card key={b} className={s.card}>
            <CardHeader className="pb-2"><CardTitle className={`text-xs uppercase tracking-widest ${s.title}`}>{s.label} <span className="ml-2 font-mono text-base text-foreground">{totals[b] || 0}</span></CardTitle></CardHeader>
            <CardContent className="text-xs space-y-1.5 max-h-72 overflow-y-auto">
              {(buckets[b] || []).slice(0, 12).map((d) => (
                <div key={d.device_id} className="flex items-center justify-between border-b border-border/30 pb-1">
                  <div className="truncate"><div className="font-medium truncate">{d.name}</div><div className="text-[10px] text-muted-foreground truncate">{d.client_name} · age {d.age_days || "?"}d · err {d.errors}</div></div>
                  <div className={`font-mono ml-2 ${s.score}`}>{d.score}</div>
                </div>
              ))}
              {(buckets[b] || []).length === 0 && <div className="text-muted-foreground text-center py-3">None</div>}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/* ─────────── 4. Battery Wall ─────────── */
function BatteryWallView({ api }) {
  const { data, loading } = useFetch(api, "/device-battery-wall");
  if (loading) return <Loader label="Inspecting laptop batteries…" />;
  const rows = data?.devices || [];
  return (
    <Card className="mt-3" data-testid="battery-wall-card">
      <CardHeader className="pb-2"><CardTitle className="text-sm">Top 20 laptops with degraded batteries</CardTitle></CardHeader>
      <CardContent>
        {rows.length === 0 ? <div className="text-center py-8 text-sm text-muted-foreground">No degraded batteries detected.</div> :
          <Table>
            <TableHeader><TableRow><TableHead>Device</TableHead><TableHead>Client</TableHead><TableHead className="text-right">Health %</TableHead><TableHead className="text-right">Cycles</TableHead><TableHead>Recommend</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.device_id} data-testid={`battery-${r.device_id}`}>
                  <TableCell className="font-medium">{r.name}{r.inferred && <Badge variant="outline" className="ml-2 text-[9px] text-muted-foreground">inferred</Badge>}</TableCell>
                  <TableCell className="text-muted-foreground">{r.client_name}</TableCell>
                  <TableCell className={`text-right font-mono font-bold ${r.battery_health < 50 ? "text-rose-400" : r.battery_health < 70 ? "text-amber-400" : "text-emerald-400"}`}>{r.battery_health}%</TableCell>
                  <TableCell className="text-right font-mono">{r.battery_cycles || "—"}</TableCell>
                  <TableCell><Badge variant="outline" className={r.recommend === "replace" ? "text-rose-400 border-rose-500/40" : "text-amber-400 border-amber-500/40"}>{r.recommend}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>}
      </CardContent>
    </Card>
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
function AgedARView({ api }) {
  const { data, loading } = useFetch(api, "/aged-ar-heatmap");
  if (loading) return <Loader label="Bucketing AR…" />;
  const totals = data?.bucket_totals || {};
  const buckets = data?.buckets || {};
  return (
    <div className="space-y-3 mt-3" data-testid="aged-ar-card">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {Object.keys(AR_STYLE).map((k) => {
          const s = AR_STYLE[k];
          return (
            <div key={k} className={`rounded-lg border p-3 ${s.box}`}>
              <div className={`text-[10px] uppercase tracking-widest ${s.title}`}>{s.label}</div>
              <div className="text-lg font-mono font-bold mt-1">{fmt$(totals[k])}</div>
              <div className="text-[10px] text-muted-foreground">{(buckets[k] || []).length} invoices</div>
            </div>
          );
        })}
      </div>
      <div className="text-right text-xs text-muted-foreground">Total outstanding: <span className="font-mono font-bold text-foreground">{fmt$(data?.total_outstanding)}</span></div>
      {Object.keys(buckets).map((k) => {
        const s = AR_STYLE[k];
        return (buckets[k] || []).length > 0 && (
          <Card key={k}>
            <CardHeader className="pb-2"><CardTitle className={`text-xs uppercase tracking-widest ${s.title}`}>{s.label}</CardTitle></CardHeader>
            <CardContent>
              <Table>
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
              </Table>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/* ─────────── 6. Skills XP ─────────── */
function SkillsXPView({ api }) {
  const { data, loading } = useFetch(api, "/team/xp");
  if (loading) return <Loader label="Calculating XP from closed tickets…" />;
  const team = data?.team || [];
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mt-3" data-testid="skills-xp-card">
      {team.length === 0 && <div className="text-center py-8 text-sm text-muted-foreground col-span-3">No closed tickets yet.</div>}
      {team.map((t) => (
        <Card key={t.tech} className="border-violet-500/20 bg-violet-500/[0.03]">
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
function InsuranceVaultView({ api }) {
  const { token } = useAuth();
  const { data, loading, reload } = useFetch(api, "/security/insurance-vault");
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
  const c = data?.controls || {};
  const stats = [
    { k: "MFA coverage", v: c.mfa_coverage_pct || 0, tone: PCT_TONE(c.mfa_coverage_pct || 0, 95, 80) },
    { k: "EDR coverage", v: c.edr_coverage_pct || 0, tone: PCT_TONE(c.edr_coverage_pct || 0, 95, 80) },
    { k: "Encryption", v: c.encryption_pct || 0, tone: PCT_TONE(c.encryption_pct || 0, 90, 70) },
    { k: "Patched ≤ 30d", v: c.patched_within_30_days_pct || 0, tone: PCT_TONE(c.patched_within_30_days_pct || 0, 85, 60) },
  ];
  const tierTone = data?.tier === "insurable" ? "emerald" : data?.tier === "needs-improvement" ? "amber" : "rose";
  const tt = TONE_CLASS[tierTone];
  return (
    <div className="space-y-3 mt-3" data-testid="insurance-vault-card">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Badge variant="outline" className={`${tt.txt} ${tt.bdr} ${tt.bg} text-base px-4 py-1`}>
          <ShieldCheck className="w-4 h-4 mr-2" />Score {data?.score}/100 · {data?.tier}
        </Badge>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
            onClick={downloadPdf} disabled={downloading} data-testid="vault-download-pdf-btn">
            {downloading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-1" />}
            Download PDF
          </Button>
          <Button size="sm" variant="ghost" onClick={reload}><RefreshCw className="w-3.5 h-3.5" /></Button>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((s) => (
          <Card key={s.k}><CardContent className="p-4">
            <div className={`text-[10px] uppercase tracking-widest ${TONE_CLASS[s.tone].txt}`}>{s.k}</div>
            <div className="text-2xl font-mono font-bold mt-1">{s.v}%</div>
          </CardContent></Card>
        ))}
      </div>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-widest text-muted-foreground">Last restore drill</CardTitle></CardHeader>
        <CardContent className="text-sm">
          {data?.last_restore_drill ?
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <Badge variant="outline" className="text-emerald-400 border-emerald-500/40">{data.last_restore_drill.status}</Badge>
              <span>{data.last_restore_drill.scope}</span>
              <span className="text-muted-foreground">at {(data.last_restore_drill.completed_at || "").slice(0, 16)}</span>
              {data.last_restore_drill.outcome && <span className="text-muted-foreground italic">— {data.last_restore_drill.outcome}</span>}
            </div>
            : <div className="text-xs text-rose-400">⚠ No completed restore drill on record. Insurer will ask for this.</div>}
        </CardContent>
      </Card>
      <div className="text-[10px] text-muted-foreground">Open security alerts: {c.open_security_alerts ?? 0} · Devices counted: {data?.device_count}</div>
    </div>
  );
}

/* ─────────── 8. Voice Brief ─────────── */
function VoiceBriefView({ api }) {
  const [text, setText] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const generate = async () => {
    setLoading(true);
    try { const r = await api.post("/voice/morning-brief"); setText(r.text); setStats(r.stats); }
    catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { generate(); /* eslint-disable-next-line */ }, []);
  return (
    <Card className="mt-3" data-testid="voice-brief-card">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2"><Mic className="w-4 h-4 text-violet-400" />Morning Voice Brief — radio script</CardTitle>
        <Button variant="outline" size="sm" onClick={generate} disabled={loading} className="text-violet-400 border-violet-500/30 hover:bg-violet-500/10" data-testid="voice-brief-regen">
          {loading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}Regenerate
        </Button>
      </CardHeader>
      <CardContent>
        {loading && !text && <Loader label="Drafting overnight brief…" />}
        {stats && (
          <div className="flex flex-wrap gap-2 text-[10px] mb-3">
            <Badge variant="outline">{stats.new_tickets} new tickets</Badge>
            {stats.critical > 0 && <Badge variant="outline" className="text-rose-400 border-rose-500/40">{stats.critical} critical</Badge>}
            {stats.backup_failures > 0 && <Badge variant="outline" className="text-amber-400 border-amber-500/40">{stats.backup_failures} backup fails</Badge>}
            <Badge variant="outline">{stats.huntress_alerts} Huntress alerts</Badge>
          </div>
        )}
        {text && <div className="text-sm leading-relaxed bg-muted/20 border border-border/40 rounded-md p-4 whitespace-pre-wrap" data-testid="voice-brief-text">{text}</div>}
      </CardContent>
    </Card>
  );
}

/* ─────────── 9. Runbooks ─────────── */
function RunbooksView({ api }) {
  const [q, setQ] = useState("");
  const { data, loading, reload } = useFetch(api, `/runbooks${q ? `?q=${encodeURIComponent(q)}` : ""}`, [q]);
  if (loading) return <Loader label="Loading runbooks…" />;
  const rows = Array.isArray(data) ? data : [];
  return (
    <Card className="mt-3" data-testid="runbooks-card">
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm">Run-Book Marketplace · {rows.length} published</CardTitle>
        <div className="flex gap-2 items-center">
          <Input placeholder="search title/tag/category…" value={q} onChange={(e) => setQ(e.target.value)} className="h-7 text-xs w-56" data-testid="runbook-search" />
          <Button variant="ghost" size="sm" onClick={reload}><RefreshCw className="w-3.5 h-3.5" /></Button>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? <div className="text-center py-8 text-sm text-muted-foreground">No runbooks yet — promote a resolved ticket to publish one.</div> :
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {rows.map((r) => (
              <Card key={r.id} className="border-border/60" data-testid={`runbook-${r.id}`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2 flex-wrap"><BookOpen className="w-3.5 h-3.5 text-violet-400" />{r.title}{r.category && <Badge variant="outline" className="text-[10px]">{r.category}</Badge>}</CardTitle>
                  {r.summary && <p className="text-xs text-muted-foreground mt-1">{r.summary}</p>}
                </CardHeader>
                <CardContent className="space-y-1.5 text-xs">
                  {(r.steps || []).slice(0, 8).map((s, i) => (
                    <div key={`k-${i}`} className="flex gap-2"><span className="text-violet-400 font-mono">{i + 1}.</span><div><div className="font-medium">{s.step}</div><div className="text-muted-foreground">{s.detail}</div></div></div>
                  ))}
                  <div className="flex gap-1 flex-wrap mt-2">
                    {(r.tags || []).map((t) => <Badge key={t} variant="outline" className="text-[10px]">#{t}</Badge>)}
                    {r.source_ticket_number && <Link to={`/tickets?ticket=${r.source_ticket_id}`} className="text-[10px] text-violet-400 hover:underline ml-auto inline-flex items-center">from {r.source_ticket_number}<ChevronRight className="w-3 h-3" /></Link>}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>}
      </CardContent>
    </Card>
  );
}
