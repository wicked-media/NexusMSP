import { useEffect, useState, useMemo } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { API, useAuth } from "@/App";
import { PageShell } from "@/components/design-system";
import HeroTile from "@/components/HeroTile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Siren, DollarSign, AlertTriangle, Trophy, TrendingUp, RefreshCw,
  Loader2, Flame, Heart, Server, CalendarCheck, Zap, Crown, Sparkles, Activity,
} from "lucide-react";
import { toast } from "sonner";

const fmt$ = (n) => `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

function useApi(token) {
  return useMemo(() => ({
    get: (path) => axios.get(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.data),
    post: (path, body) => axios.post(`${API}${path}`, body || {}, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.data),
    put: (path, body) => axios.put(`${API}${path}`, body || {}, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.data),
  }), [token]);
}

function useFetch(api, path) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const reload = () => {
    setLoading(true);
    api.get(path).then(setData).catch((e) => toast.error(e.response?.data?.detail || e.message)).finally(() => setLoading(false));
  };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [path]);
  return { data, loading, reload };
}

export default function CommandCenterPage() {
  const { token } = useAuth();
  const api = useApi(token);
  const [tab, setTab] = useState("center");

  return (
    <PageShell>
      <div className="space-y-4" data-testid="command-center-page">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-rose-400 mb-1 flex items-center gap-2">
            <Siren className="w-3 h-3" />Command Center
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">What's on fire right now</h1>
          <p className="text-sm text-muted-foreground">Compound intelligence across SLA, sentiment, finance and team health.</p>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex-wrap h-auto" data-testid="command-tabs">
            <TabsTrigger value="center" data-testid="tab-center"><Flame className="w-3 h-3 mr-1" />Right now</TabsTrigger>
            <TabsTrigger value="automation" data-testid="tab-automation"><Zap className="w-3 h-3 mr-1" />Automation</TabsTrigger>
            <TabsTrigger value="risk" data-testid="tab-risk"><AlertTriangle className="w-3 h-3 mr-1" />Revenue at Risk</TabsTrigger>
            <TabsTrigger value="unbilled" data-testid="tab-unbilled"><DollarSign className="w-3 h-3 mr-1" />Unbilled Dollars</TabsTrigger>
            <TabsTrigger value="pricing" data-testid="tab-pricing"><AlertTriangle className="w-3 h-3 mr-1" />Pricing Compliance</TabsTrigger>
            <TabsTrigger value="monday" data-testid="tab-monday"><CalendarCheck className="w-3 h-3 mr-1" />Monday Prep</TabsTrigger>
            <TabsTrigger value="leaderboard" data-testid="tab-leaderboard"><Trophy className="w-3 h-3 mr-1" />Leaderboard</TabsTrigger>
            <TabsTrigger value="streaks" data-testid="tab-streaks"><Crown className="w-3 h-3 mr-1" />Streaks</TabsTrigger>
            <TabsTrigger value="capacity" data-testid="tab-capacity"><Server className="w-3 h-3 mr-1" />Capacity 90d</TabsTrigger>
          </TabsList>

          <TabsContent value="center"><CommandView api={api} /></TabsContent>
          <TabsContent value="automation"><AutomationView api={api} /></TabsContent>
          <TabsContent value="risk"><RiskView api={api} /></TabsContent>
          <TabsContent value="unbilled"><UnbilledView api={api} /></TabsContent>
          <TabsContent value="pricing"><PricingView api={api} /></TabsContent>
          <TabsContent value="monday"><MondayView api={api} /></TabsContent>
          <TabsContent value="leaderboard"><LeaderboardView api={api} /></TabsContent>
          <TabsContent value="streaks"><StreaksView api={api} /></TabsContent>
          <TabsContent value="capacity"><CapacityView api={api} /></TabsContent>
        </Tabs>
      </div>
    </PageShell>
  );
}

function Loader({ label }) {
  return <div className="py-12 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />{label}</div>;
}

/* ─ 1 Command Center ─ */
function CommandView({ api }) {
  const { data, loading, reload } = useFetch(api, "/command-center");
  if (loading) return <Loader label="Gathering signals…" />;
  const d = data || {};
  return (
    <div className="space-y-3 mt-3" data-testid="command-center-card">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="SLA hot tickets" value={d.sla_hot_count || 0} tone={d.sla_hot_count > 0 ? "rose" : "emerald"} />
        <StatTile label="Sentiment escalations 24h" value={d.sentiment_escalations_24h || 0} tone={d.sentiment_escalations_24h > 0 ? "amber" : "emerald"} />
        <StatTile label="Patch anomalies" value={d.patch_anomaly_count || 0} tone={d.patch_anomaly_count > 0 ? "rose" : "emerald"} />
        <StatTile label="Overloaded techs" value={(d.overloaded_techs || []).length} tone={(d.overloaded_techs || []).length > 0 ? "amber" : "emerald"} />
      </div>
      <div className="flex items-center justify-end"><Button variant="ghost" size="sm" onClick={reload}><RefreshCw className="w-3.5 h-3.5" /></Button></div>
      {d.sla_hot?.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Flame className="w-4 h-4 text-rose-400" />SLA hot tickets</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Ticket</TableHead><TableHead>Client</TableHead><TableHead>Title</TableHead><TableHead>Priority</TableHead><TableHead className="text-right">Age %</TableHead></TableRow></TableHeader>
              <TableBody>
                {d.sla_hot.map(t => (
                  <TableRow key={t.ticket_id}>
                    <TableCell className="font-mono text-xs">{t.ticket_number}</TableCell>
                    <TableCell className="text-xs">{t.client_name}</TableCell>
                    <TableCell className="text-xs"><Link to={`/tickets?ticket=${t.ticket_id}`} className="hover:underline">{t.title}</Link></TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px] capitalize">{t.priority}</Badge></TableCell>
                    <TableCell className="text-right font-mono text-xs text-rose-400">{t.age_pct}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {d.overloaded_techs?.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Heart className="w-4 h-4 text-amber-400" />Overloaded technicians</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {d.overloaded_techs.map(t => (
                <div key={t.tech} className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-xs" data-testid={`overload-${t.tech}`}>
                  <div className="font-medium">{t.tech}</div>
                  <div className="text-amber-400 font-mono">{t.score} load · {t.count} open</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatTile({ label, value, tone = "sky", format }) {
  const glow = { rose: "rose", amber: "amber", emerald: "emerald", sky: "sky", violet: "violet" }[tone] || "sky";
  const display = format ? format(value) : value;
  return <HeroTile label={label} value={display} icon={Activity} glow={glow} animated={typeof display === "number"} />;
}

/* ─ Automation scheduler ─ */
function AutomationView({ api }) {
  const [settings, setSettings] = useState(null);
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const [s, l] = await Promise.all([api.get("/ops/settings"), api.get("/ops/tick-log")]);
      setSettings(s); setLog(l.ticks || []);
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);

  const toggle = async (enabled) => {
    try { const s = await api.put("/ops/settings", { ...settings, enabled }); setSettings(s); toast.success(`Scheduler ${enabled ? "enabled" : "paused"}`); }
    catch (e) { toast.error(e.response?.data?.detail || e.message); }
  };

  const runNow = async () => {
    setRunning(true);
    try { const r = await api.post("/ops/nightly-tick"); toast.success(`Tick complete · ${Object.keys(r.results || {}).length} reactions ran`); reload(); }
    catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setRunning(false); }
  };

  const setInterval_ = async (mins) => {
    try { const s = await api.put("/ops/settings", { ...settings, interval_minutes: mins }); setSettings(s); toast.success(`Interval set to ${mins} min`); }
    catch (e) { toast.error(e.response?.data?.detail || e.message); }
  };

  if (loading) return <Loader label="Loading scheduler…" />;

  return (
    <div className="space-y-3 mt-3" data-testid="automation-card">
      <Card className="border-violet-500/30 bg-violet-500/[0.03]">
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Zap className="w-4 h-4 text-violet-400" />Zero-touch chain reactions</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Badge variant="outline" className={settings?.enabled ? "text-emerald-400 border-emerald-500/40 bg-emerald-500/10" : "text-muted-foreground"} data-testid="automation-status">
              {settings?.enabled ? "● Running" : "○ Paused"}
            </Badge>
            <span className="text-muted-foreground text-xs">Interval: <span className="font-mono text-foreground">{settings?.interval_minutes} min</span></span>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="outline" onClick={() => toggle(!settings?.enabled)} data-testid="automation-toggle-btn">{settings?.enabled ? "Pause" : "Resume"}</Button>
              <Button size="sm" variant="outline" onClick={runNow} disabled={running} className="text-violet-400 border-violet-500/30 hover:bg-violet-500/10" data-testid="automation-run-now-btn">
                {running ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}Run now
              </Button>
            </div>
          </div>
          <div className="flex gap-1.5 items-center text-xs">
            <span className="text-muted-foreground">Interval:</span>
            {[5, 15, 30, 60].map(m => (
              <Button key={m} size="sm" variant={settings?.interval_minutes === m ? "default" : "outline"} className="h-6 px-2 text-[11px]" onClick={() => setInterval_(m)}>{m}m</Button>
            ))}
          </div>
          <div className="text-xs text-muted-foreground">Runs 5 reactions: Apology Queue scan · SLA Auto-page · Promise Reconcile · Patch Broadcast · (more coming). All run as '<span className="font-mono">auto-scheduler</span>' identity.</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Recent ticks</CardTitle></CardHeader>
        <CardContent>
          {log.length === 0 ? <div className="text-sm text-muted-foreground text-center py-4">No tick history yet.</div> :
            <Table>
              <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Triggered by</TableHead><TableHead>Results</TableHead></TableRow></TableHeader>
              <TableBody>
                {log.map((t, i) => (
                  <TableRow key={`k-${i}`} data-testid={`tick-row-${i}`}>
                    <TableCell className="font-mono text-xs">{(t.started_at || "").slice(0, 19).replace("T", " ")}</TableCell>
                    <TableCell className="text-xs">{t.triggered_by}</TableCell>
                    <TableCell className="text-xs">
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(t.results || {}).map(([k, v]) => (
                          <Badge key={k} variant="outline" className="text-[10px]">{k}: {Object.values(v).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0)}</Badge>
                        ))}
                        {Object.keys(t.errors || {}).length > 0 && <Badge variant="outline" className="text-rose-400 border-rose-500/40 text-[10px]">{Object.keys(t.errors).length} error(s)</Badge>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          }
        </CardContent>
      </Card>
    </div>
  );
}

/* ─ 2 Revenue at Risk ─ */
function RiskView({ api }) {
  const { data, loading } = useFetch(api, "/finance/revenue-at-risk");
  if (loading) return <Loader label="Calculating revenue at risk…" />;
  const d = data || {};
  const b = d.breakdown || {};
  return (
    <div className="space-y-3 mt-3" data-testid="revenue-at-risk-card">
      <div className={`rounded-xl border border-rose-500/40 bg-rose-500/5 p-6 text-center`}>
        <div className="text-[10px] uppercase tracking-widest text-rose-400">Total revenue at risk</div>
        <div className="text-5xl font-mono font-bold mt-2" data-testid="total-at-risk">{fmt$(d.total_at_risk)}</div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Aged AR" value={fmt$(b.aged_ar)} tone="amber" />
        <StatTile label=">60 days overdue" value={fmt$(b.overdue_60plus)} tone="rose" />
        <StatTile label="Cold estimates (weighted)" value={fmt$(b.cold_estimates_risk_weighted)} tone="amber" />
        <StatTile label="High-churn annual risk" value={fmt$(b.high_churn_annual_risk)} tone="rose" />
      </div>
      {d.top_churn_clients?.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Top churn-risk clients</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Client</TableHead><TableHead className="text-right">MRR</TableHead><TableHead className="text-right">Churn score</TableHead><TableHead className="text-right">At risk</TableHead></TableRow></TableHeader>
              <TableBody>
                {d.top_churn_clients.map(c => (
                  <TableRow key={c.client_id}>
                    <TableCell><Link to={`/clients?id=${c.client_id}`} className="hover:underline">{c.name}</Link></TableCell>
                    <TableCell className="text-right font-mono">{fmt$(c.mrr)}</TableCell>
                    <TableCell className="text-right font-mono text-rose-400">{c.churn_score}/100</TableCell>
                    <TableCell className="text-right font-mono font-bold">{fmt$(c.at_risk)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ─ 3 Unbilled ─ */
function UnbilledView({ api }) {
  const { data, loading } = useFetch(api, "/finance/unbilled-dollars");
  if (loading) return <Loader label="Summing unbilled time…" />;
  const d = data || {};
  return (
    <div className="space-y-3 mt-3" data-testid="unbilled-dollars-card">
      <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-6 text-center">
        <div className="text-[10px] uppercase tracking-widest text-emerald-400">Unbilled right now</div>
        <div className="text-5xl font-mono font-bold mt-2" data-testid="unbilled-total">{fmt$(d.total_dollars)}</div>
        <div className="text-xs text-muted-foreground mt-1">{d.total_minutes || 0} minutes logged · window {d.window_days || 90} days</div>
      </div>
      {d.by_client?.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">By client</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Client</TableHead><TableHead className="text-right">Tickets</TableHead><TableHead className="text-right">Minutes</TableHead><TableHead className="text-right">Dollars</TableHead></TableRow></TableHeader>
              <TableBody>
                {d.by_client.map(c => (
                  <TableRow key={c.client_id}><TableCell>{c.client_name}</TableCell><TableCell className="text-right font-mono">{c.tickets}</TableCell><TableCell className="text-right font-mono">{c.minutes}</TableCell><TableCell className="text-right font-mono font-bold text-emerald-400">{fmt$(c.dollars)}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ─ 4 Pricing compliance ─ */
function PricingView({ api }) {
  const { data, loading } = useFetch(api, "/finance/pricing-compliance");
  if (loading) return <Loader label="Scanning estimates…" />;
  const d = data || {};
  return (
    <div className="space-y-3 mt-3" data-testid="pricing-compliance-card">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatTile label="Under-priced" value={fmt$(d.total_underpriced_dollars)} tone="amber" />
        <StatTile label="Below margin" value={fmt$(d.total_below_margin_dollars)} tone="rose" />
        <StatTile label="Total violations" value={d.total_violations} tone="amber" />
      </div>
      {d.top_violations?.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Top violations</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Estimate</TableHead><TableHead>Client</TableHead><TableHead>Item</TableHead><TableHead>Kind</TableHead><TableHead className="text-right">$ gap</TableHead></TableRow></TableHeader>
              <TableBody>
                {d.top_violations.map((v, i) => (
                  <TableRow key={`k-${i}`}><TableCell className="font-mono">{v.estimate_number}</TableCell><TableCell>{v.client_name}</TableCell><TableCell>{v.item}</TableCell><TableCell><Badge variant="outline" className={v.kind === "below_margin" ? "text-rose-400 border-rose-500/40" : "text-amber-400 border-amber-500/40"}>{v.kind}</Badge></TableCell><TableCell className="text-right font-mono font-bold">{fmt$(v.gap_dollars)}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ─ 5 Monday prep ─ */
function MondayView({ api }) {
  const { data, loading } = useFetch(api, "/briefings/monday-prep");
  if (loading) return <Loader label="Drafting Monday pack…" />;
  const d = data || {};
  return (
    <div className="space-y-3 mt-3" data-testid="monday-prep-card">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <StatTile label="New last week" value={d.tickets?.new || 0} tone="sky" />
        <StatTile label="Closed last week" value={d.tickets?.closed || 0} tone="emerald" />
        <StatTile label="Criticals open" value={d.tickets?.criticals_open || 0} tone={d.tickets?.criticals_open > 0 ? "rose" : "emerald"} />
        <StatTile label="Overdue invoices" value={fmt$(d.finance?.overdue_total)} tone="amber" />
      </div>
      {d.focus_areas?.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Zap className="w-4 h-4 text-violet-400" />Focus this week</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm">
              {d.focus_areas.map((f, i) => <li key={`k-${i}`} className="flex items-start gap-2" data-testid={`focus-${i}`}><span className="text-violet-400 mt-1">•</span>{f}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ─ 6 Leaderboard ─ */
function LeaderboardView({ api }) {
  const { data, loading } = useFetch(api, "/team/leaderboard");
  if (loading) return <Loader label="Tallying XP…" />;
  const rows = data?.leaderboard || [];
  return (
    <Card className="mt-3" data-testid="leaderboard-card">
      <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Trophy className="w-4 h-4 text-amber-400" />Team Leaderboard</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead className="w-12">Rank</TableHead><TableHead>Tech</TableHead><TableHead className="text-right">Level</TableHead><TableHead className="text-right">XP</TableHead><TableHead className="text-right">Closed</TableHead><TableHead className="text-right">Drills</TableHead><TableHead className="text-right">Runbooks</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map(r => (
              <TableRow key={r.tech_id} data-testid={`leader-${r.tech_id}`}>
                <TableCell className="font-mono font-bold">{r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : `#${r.rank}`}</TableCell>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="text-right font-mono"><Badge variant="outline" className="text-violet-400 border-violet-500/40">Lvl {r.level}</Badge></TableCell>
                <TableCell className="text-right font-mono font-bold">{(r.total_xp || 0).toLocaleString()}</TableCell>
                <TableCell className="text-right font-mono text-muted-foreground">{r.closed_tickets}</TableCell>
                <TableCell className="text-right font-mono text-muted-foreground">{r.drills_led}</TableCell>
                <TableCell className="text-right font-mono text-muted-foreground">{r.runbooks_published}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* ─ 7 Streaks ─ */
function StreaksView({ api }) {
  const { data, loading } = useFetch(api, "/team/streaks");
  if (loading) return <Loader label="Counting streaks…" />;
  const rows = data?.streaks || [];
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3" data-testid="streaks-card">
      {rows.length === 0 && <div className="text-sm text-muted-foreground col-span-3 text-center py-8">No drills recorded yet.</div>}
      {rows.map(r => (
        <Card key={r.tech} className="border-amber-500/20 bg-amber-500/[0.03]">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="font-medium">{r.tech}</div>
              <div className="text-4xl">{r.current_week_streak > 0 ? "🔥" : "💤"}</div>
            </div>
            <div className="text-xs text-muted-foreground mt-1">Current streak: <span className="font-mono font-bold text-amber-400">{r.current_week_streak} week{r.current_week_streak === 1 ? "" : "s"}</span></div>
            <div className="text-[10px] text-muted-foreground mt-1">{r.total_drills} total drills</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ─ 8 Capacity ─ */
function CapacityView({ api }) {
  const { data, loading } = useFetch(api, "/forecasting/capacity");
  if (loading) return <Loader label="Forecasting capacity…" />;
  const d = data || {};
  return (
    <div className="space-y-3 mt-3" data-testid="capacity-card">
      <div className="rounded-xl border border-violet-500/40 bg-violet-500/5 p-5">
        <div className="text-[10px] uppercase tracking-widest text-violet-400">Next 90 days headline</div>
        <div className="text-base font-medium mt-1 flex items-center gap-2"><Sparkles className="w-4 h-4 text-violet-400" />{d.headline}</div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card><CardContent className="p-4">
          <div className="text-[10px] uppercase text-sky-400 tracking-widest">Team</div>
          <div className="text-base mt-1">{d.team?.current_techs} techs · avg load {d.team?.avg_load_per_tech}</div>
          {d.team?.extra_techs_needed_90d > 0 && <Badge variant="outline" className="text-rose-400 border-rose-500/40 mt-2">+{d.team.extra_techs_needed_90d} tech needed</Badge>}
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-[10px] uppercase text-rose-400 tracking-widest">Device replacement</div>
          <div className="text-sm mt-1">{d.devices?.replace_in_30 || 0} in 30d · {d.devices?.replace_in_90 || 0} in 90d · {d.devices?.replace_in_365 || 0} in 365d</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-[10px] uppercase text-amber-400 tracking-widest">Backup</div>
          <div className="text-sm mt-1">Last drill: {d.backup?.last_drill_days_ago ?? "never"} days ago</div>
          {d.backup?.refresh_required && <Badge variant="outline" className="text-rose-400 border-rose-500/40 mt-2">Refresh required</Badge>}
        </CardContent></Card>
      </div>
    </div>
  );
}
