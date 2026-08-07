import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Banknote,
  BarChart3,
  Bot,
  BriefcaseBusiness,
  CalendarRange,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  DollarSign,
  FileChartColumnIncreasing,
  Gauge,
  HeartPulse,
  Info,
  Lightbulb,
  Loader2,
  RefreshCw,
  Save,
  Scale,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
  WalletCards,
  XCircle,
} from "lucide-react";

import { API, useAuth } from "@/App";
import HeroTile from "@/components/HeroTile";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";


const money = (value, compact = false) => {
  if (value == null) return "Not assessed";
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: compact ? 0 : 2,
    notation: compact ? "compact" : "standard",
  }).format(Number(value) || 0);
};

const number = (value, digits = 0) => (
  value == null ? "Not assessed" : Number(value || 0).toFixed(digits)
);

const when = (value) => {
  if (!value) return "Time unavailable";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "Time unavailable"
    : new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
};

const severityTone = {
  critical: "border-rose-500/25 bg-rose-500/10 text-rose-600 dark:text-rose-300",
  high: "border-orange-500/25 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  medium: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  low: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
};

const qualityTone = {
  verified: {
    badge: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    icon: CheckCircle2,
    label: "Verified",
  },
  partial: {
    badge: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    icon: AlertTriangle,
    label: "Partial",
  },
  missing: {
    badge: "border-border bg-muted/50 text-muted-foreground",
    icon: XCircle,
    label: "Missing",
  },
};

function LoadingState() {
  return (
    <div className="flex min-h-[420px] items-center justify-center">
      <div className="text-center">
        <Loader2 className="mx-auto h-7 w-7 animate-spin text-emerald-500" />
        <p className="mt-3 text-sm font-medium">Building the owner briefing…</p>
        <p className="mt-1 text-xs text-muted-foreground">Correlating commercial and operational evidence</p>
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }) {
  return (
    <Card className="border-rose-500/20 bg-rose-500/[0.04]">
      <CardContent className="flex flex-col items-center px-5 py-14 text-center">
        <ShieldAlert className="h-9 w-9 text-rose-500" />
        <h2 className="mt-3 text-lg font-semibold">CEO Mode could not load</h2>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">{message}</p>
        <Button className="mt-5" onClick={onRetry}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button>
      </CardContent>
    </Card>
  );
}

function FlowMetric({ icon: Icon, label, value, detail, tone = "emerald", last = false }) {
  const tones = {
    emerald: "border-emerald-500/20 bg-emerald-500/[0.05] text-emerald-600 dark:text-emerald-300",
    cyan: "border-cyan-500/20 bg-cyan-500/[0.05] text-cyan-600 dark:text-cyan-300",
    violet: "border-violet-500/20 bg-violet-500/[0.05] text-violet-600 dark:text-violet-300",
    amber: "border-amber-500/20 bg-amber-500/[0.05] text-amber-700 dark:text-amber-300",
  };
  return (
    <>
      <div className={`relative min-w-0 flex-1 rounded-2xl border p-4 ${tones[tone]}`}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em]">{label}</p>
          <Icon className="h-4 w-4" />
        </div>
        <p className="mt-3 truncate text-2xl font-semibold tracking-tight text-foreground" title={value}>{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </div>
      {!last && <ArrowRight className="hidden h-5 w-5 shrink-0 text-muted-foreground/50 xl:block" />}
    </>
  );
}

function RiskCard({ item, onOpen }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(item.route)}
      className="group w-full rounded-xl border border-border/60 bg-background/40 p-3 text-left transition hover:border-amber-500/25 hover:bg-amber-500/[0.03]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={severityTone[item.severity] || severityTone.low}>{item.severity}</Badge>
            <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{item.source}</span>
          </div>
          <p className="mt-2 text-sm font-semibold text-foreground">{item.title}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p>
          <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-300">Owner decision: {item.decision}</p>
        </div>
        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
      </div>
    </button>
  );
}

function ScenarioDialog({ open, onOpenChange, data, headers }) {
  const clients = useMemo(() => data?.model_context?.clients || [], [data]);
  const biggest = useMemo(() => {
    const mrr = data?.model_context?.client_mrr || {};
    return [...clients].sort((a, b) => Number(mrr[b.id] || 0) - Number(mrr[a.id] || 0))[0]?.id || "none";
  }, [clients, data]);
  const [name, setName] = useState("Resilience test");
  const [lostClientId, setLostClientId] = useState("none");
  const [pricing, setPricing] = useState(0);
  const [newCost, setNewCost] = useState("");
  const [cashReserve, setCashReserve] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (open && lostClientId === "none" && biggest) setLostClientId(biggest);
  }, [open, biggest, lostClientId]);

  const run = async () => {
    setRunning(true);
    try {
      const response = await axios.post(`${API}/executive/scenarios`, {
        name,
        lost_client_id: lostClientId === "none" ? null : lostClientId,
        pricing_change_pct: pricing,
        new_monthly_cost: Number(newCost || 0),
        cash_reserve: cashReserve === "" ? null : Number(cashReserve),
      }, { headers });
      setResult(response.data);
      toast.success("Scenario modelled · no operational changes made");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Scenario could not be modelled");
    } finally {
      setRunning(false);
    }
  };

  const close = (value) => {
    onOpenChange(value);
    if (!value) setResult(null);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 ring-1 ring-violet-500/20">
            <Scale className="h-5 w-5 text-violet-500" />
          </div>
          <DialogTitle>MSP Simulator</DialogTitle>
          <DialogDescription>Stress-test revenue and cost decisions against the current owner baseline. Nothing here executes or changes billing.</DialogDescription>
        </DialogHeader>
        {!result ? (
          <div className="space-y-5 py-2">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="scenario-name">Scenario name</Label>
                <Input id="scenario-name" value={name} onChange={(event) => setName(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Client loss test</Label>
                <Select value={lostClientId} onValueChange={setLostClientId}>
                  <SelectTrigger><SelectValue placeholder="Do not remove a client" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No client loss</SelectItem>
                    {clients.map(client => (
                      <SelectItem key={client.id} value={client.id}>{client.name} · {money(data.model_context.client_mrr?.[client.id], true)} MRR</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label>Pricing change</Label>
                  <p className="mt-1 text-xs text-muted-foreground">Applied to remaining contract-backed MRR.</p>
                </div>
                <Badge variant="outline" className={pricing >= 0 ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300"}>{pricing > 0 ? "+" : ""}{pricing}%</Badge>
              </div>
              <Slider className="mt-5" min={-25} max={25} step={1} value={[pricing]} onValueChange={([value]) => setPricing(value)} />
              <div className="mt-2 flex justify-between text-[10px] text-muted-foreground"><span>-25%</span><span>Current</span><span>+25%</span></div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="scenario-cost">New monthly cost (AUD)</Label>
                <Input id="scenario-cost" type="number" min="0" value={newCost} onChange={(event) => setNewCost(event.target.value)} placeholder="e.g. 9000 for a new hire" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="scenario-cash">Cash reserve (optional)</Label>
                <Input id="scenario-cash" type="number" min="0" value={cashReserve} onChange={(event) => setCashReserve(event.target.value)} placeholder="Used only for runway" />
              </div>
            </div>
            <div className="flex gap-3 rounded-xl border border-cyan-500/20 bg-cyan-500/[0.05] p-3 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-cyan-500" />
              This model excludes tax, financing, supplier inflation, sales pipeline conversion, and payment timing. Its assumptions are returned with the result.
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2" data-testid="executive-scenario-result">
            <div className="grid gap-3 sm:grid-cols-3">
              <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Baseline MRR</p><p className="mt-1 text-2xl font-semibold">{money(result.baseline_mrr, true)}</p></CardContent></Card>
              <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Projected MRR</p><p className="mt-1 text-2xl font-semibold">{money(result.projected_mrr, true)}</p></CardContent></Card>
              <Card className={result.mrr_delta < 0 ? "border-rose-500/20" : "border-emerald-500/20"}><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Monthly movement</p><p className={`mt-1 text-2xl font-semibold ${result.mrr_delta < 0 ? "text-rose-500" : "text-emerald-500"}`}>{result.mrr_delta > 0 ? "+" : ""}{money(result.mrr_delta, true)}</p></CardContent></Card>
            </div>
            {result.lost_client && (
              <div className="rounded-xl border border-rose-500/20 bg-rose-500/[0.04] p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-500">Client loss</p>
                <p className="mt-1 font-semibold">{result.lost_client.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">{money(result.lost_client.mrr)} MRR removed before the pricing model.</p>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border/60 p-4"><p className="text-xs text-muted-foreground">Projected service contribution</p><p className="mt-1 text-xl font-semibold">{money(result.projected_service_contribution, true)}</p><p className="mt-1 text-[11px] text-muted-foreground">Unavailable until direct costs are recorded.</p></div>
              <div className="rounded-xl border border-border/60 p-4"><p className="text-xs text-muted-foreground">Cash runway</p><p className="mt-1 text-xl font-semibold">{result.cash_runway_months == null ? "Not applicable" : `${result.cash_runway_months} months`}</p><p className="mt-1 text-[11px] text-muted-foreground">Calculated only for a negative modelled contribution.</p></div>
            </div>
            <div>
              <p className="text-sm font-semibold">Model assumptions</p>
              <ul className="mt-2 space-y-2">
                {result.assumptions.map(item => <li key={item} className="flex gap-2 text-xs text-muted-foreground"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-500" />{item}</li>)}
              </ul>
            </div>
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-3 text-xs text-amber-800 dark:text-amber-200">{result.warning}</div>
          </div>
        )}
        <DialogFooter>
          {result ? (
            <>
              <Button variant="outline" onClick={() => setResult(null)}>Adjust inputs</Button>
              <Button onClick={() => close(false)}>Done</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => close(false)}>Cancel</Button>
              <Button onClick={run} disabled={running}>{running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}Model scenario</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BoardBriefDialog({ open, onOpenChange, data, onSave, saving }) {
  const brief = data?.board_brief || {};
  const sections = [
    { label: "Wins", icon: TrendingUp, items: brief.wins, tone: "text-emerald-500" },
    { label: "Risks", icon: ShieldAlert, items: brief.risks, tone: "text-rose-500" },
    { label: "Owner decisions", icon: ClipboardCheck, items: brief.decisions, tone: "text-amber-500" },
    { label: "Outlook", icon: BarChart3, items: brief.outlook, tone: "text-violet-500" },
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 ring-1 ring-emerald-500/20"><FileChartColumnIncreasing className="h-5 w-5 text-emerald-500" /></div>
          <DialogTitle>AI Board Meeting</DialogTitle>
          <DialogDescription>Board-ready talking points assembled from current Nexus evidence. Review every point before external use.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.08] via-background to-background p-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-600 dark:text-emerald-300">Executive headline</p>
            <p className="mt-2 text-xl font-semibold tracking-tight">{brief.headline}</p>
            <p className="mt-2 text-xs text-muted-foreground">Prepared {when(data?.generated_at)} · {data?.period?.label}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {sections.map(section => {
              const Icon = section.icon;
              return (
                <Card key={section.label}>
                  <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Icon className={`h-4 w-4 ${section.tone}`} />{section.label}</CardTitle></CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {(section.items || []).map(item => <li key={item} className="flex gap-2 text-sm text-muted-foreground"><span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${section.tone.replace("text-", "bg-")}`} />{item}</li>)}
                    </ul>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <div className="flex gap-3 rounded-xl border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground"><Info className="mt-0.5 h-4 w-4 shrink-0" />{brief.method}</div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={onSave} disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save board snapshot</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ExecutivePage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scenarioOpen, setScenarioOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await axios.get(`${API}/executive/overview`, { headers });
      setData(response.data);
    } catch (requestError) {
      setError(requestError.response?.data?.detail || "The executive evidence service did not return a briefing.");
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  const saveBoard = async () => {
    setSaving(true);
    try {
      const response = await axios.post(`${API}/executive/board-snapshots`, {}, { headers });
      toast.success(`${response.data.title} saved`);
      setBoardOpen(false);
      await load();
    } catch (requestError) {
      toast.error(requestError.response?.data?.detail || "Board snapshot could not be saved");
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) return <div className="space-y-5 p-6"><LoadingState /></div>;

  const summary = data?.summary || {};
  const financial = data?.financial || {};
  const team = data?.team || {};
  const board = data?.board_brief || {};
  const topDecision = data?.risk_items?.[0];

  return (
    <div className="space-y-5 p-6" data-testid="executive-page">
      <OperationalPageHeader
        eyebrow="Owner intelligence"
        title="CEO Mode"
        description="Revenue, commercial resilience, customer success, capacity, cash outlook, and owner decisions—without the operational noise."
        icon={BriefcaseBusiness}
        tone="emerald"
        actions={(
          <>
            <Badge variant="outline" className="gap-1.5 border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Live evidence</Badge>
            <Button variant="outline" size="sm" onClick={() => navigate("/help/ceo-mode")}><CircleHelp className="mr-1.5 h-3.5 w-3.5" />Guide</Button>
            <Button variant="outline" size="sm" onClick={() => setScenarioOpen(true)}><Scale className="mr-1.5 h-3.5 w-3.5" />MSP Simulator</Button>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
            <Button size="sm" onClick={() => setBoardOpen(true)}><FileChartColumnIncreasing className="mr-1.5 h-3.5 w-3.5" />Board briefing</Button>
          </>
        )}
      />

      {error ? <ErrorState message={error} onRetry={load} /> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <HeroTile label="Contract MRR" value={money(summary.mrr, true)} icon={DollarSign} glow="emerald" animated={false} subtitle={`${money(summary.arr, true)} annual run rate`} testId="executive-mrr" />
            <HeroTile label="Contribution" value={summary.service_contribution == null ? "—" : money(summary.service_contribution, true)} icon={TrendingUp} glow={summary.service_contribution == null ? "zinc" : "cyan"} animated={false} subtitle={summary.contribution_margin_pct == null ? "Direct costs not assessed" : `${summary.contribution_margin_pct}% recorded margin`} testId="executive-contribution" />
            <HeroTile label="Cash outlook · 30d" value={money(summary.net_cash_30d, true)} icon={Banknote} glow={summary.net_cash_30d < 0 ? "rose" : "emerald"} animated={false} subtitle="Receivables less open POs" testId="executive-cash" />
            <HeroTile label="Customer health" value={number(summary.average_client_health, 0)} icon={HeartPulse} glow={summary.average_client_health == null ? "zinc" : summary.average_client_health < 60 ? "rose" : "violet"} animated={false} subtitle={`${summary.assessed_clients || 0}/${summary.total_clients || 0} assessed`} testId="executive-health" />
            <HeroTile label="Team load" value={summary.staff_capacity_pct == null ? "Not assessed" : `${summary.staff_capacity_pct}%`} icon={Gauge} glow={summary.staff_capacity_pct == null ? "zinc" : summary.staff_capacity_pct > 90 ? "rose" : "amber"} animated={false} subtitle="Aggregate recorded capacity" testId="executive-capacity" />
            <HeroTile label="Owner risks" value={summary.risk_count || 0} icon={ShieldAlert} glow={summary.critical_risk_count ? "rose" : summary.risk_count ? "amber" : "emerald"} subtitle={`${summary.critical_risk_count || 0} critical`} testId="executive-risks" />
          </div>

          <Card className="overflow-hidden border-emerald-500/15 bg-gradient-to-br from-emerald-500/[0.07] via-card to-card shadow-[0_22px_70px_rgba(16,185,129,0.06)]" data-testid="executive-owner-pulse">
            <CardContent className="p-5 md:p-6">
              <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr] lg:items-center">
                <div>
                  <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-600 dark:text-emerald-300"><Sparkles className="h-3.5 w-3.5" />Owner pulse · {data.period?.label}</div>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">{board.headline}</h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                    Nexus has separated recorded business evidence from estimates. The recommended next move is shown only when a source record supports it.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => setBoardOpen(true)}><FileChartColumnIncreasing className="mr-2 h-4 w-4" />Open board brief</Button>
                    <Button size="sm" variant="outline" onClick={() => setScenarioOpen(true)}><Scale className="mr-2 h-4 w-4" />Stress-test the plan</Button>
                  </div>
                </div>
                <div className="rounded-2xl border border-border/60 bg-background/50 p-4">
                  <div className="flex items-center gap-2 text-xs font-semibold"><Target className="h-4 w-4 text-amber-500" />Next owner decision</div>
                  {topDecision ? (
                    <>
                      <p className="mt-2 text-sm font-semibold">{topDecision.decision}</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{topDecision.title}</p>
                      <Button variant="ghost" size="sm" className="mt-2 -ml-2 h-8 text-xs" onClick={() => navigate(topDecision.route)}>Open source<ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Button>
                    </>
                  ) : (
                    <div className="mt-3 flex gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />No critical or high-priority owner decision is currently evidenced.</div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="executive-business-flow">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-500">MSP economy</p><CardTitle className="mt-1 text-base">How the business is moving</CardTitle></div>
                <Badge variant="outline"><CalendarRange className="mr-1.5 h-3 w-3" />{data.period?.label}</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
                <FlowMetric icon={WalletCards} label="Contract revenue" value={money(financial.contract_mrr, true)} detail="Active agreements and client fallback MRR" tone="emerald" />
                <FlowMetric icon={TrendingDown} label="Recorded direct cost" value={money(financial.recorded_direct_cost, true)} detail="Only explicit source costs are counted" tone="amber" />
                <FlowMetric icon={Activity} label="Service contribution" value={money(financial.service_contribution, true)} detail={financial.contribution_margin_pct == null ? "Awaiting cost coverage" : `${financial.contribution_margin_pct}% contribution margin`} tone="cyan" />
                <FlowMetric icon={Banknote} label="30-day net outlook" value={money(financial.net_cash_30d, true)} detail={`${money(financial.incoming_30d, true)} in · ${money(financial.open_po_commitments, true)} committed`} tone="violet" last />
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
            <Card data-testid="executive-risks">
              <CardHeader className="border-b border-border/60 pb-4">
                <div className="flex items-center justify-between gap-3">
                  <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-500">Decision queue</p><CardTitle className="mt-1 text-base">What needs an owner</CardTitle></div>
                  <Badge variant="outline">{data.risk_items?.length || 0} evidenced</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 pt-4">
                {data.risk_items?.length ? data.risk_items.slice(0, 6).map(item => <RiskCard key={item.id} item={item} onOpen={navigate} />) : (
                  <div className="flex flex-col items-center py-10 text-center"><CheckCircle2 className="h-8 w-8 text-emerald-500" /><p className="mt-3 text-sm font-semibold">No owner risks are currently evidenced</p><p className="mt-1 text-xs text-muted-foreground">Refresh after the next billing, contract, project, or health change.</p></div>
                )}
              </CardContent>
            </Card>

            <Card data-testid="executive-profit-killers">
              <CardHeader className="border-b border-border/60 pb-4">
                <div className="flex items-center justify-between gap-3">
                  <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-500">Commercial fit</p><CardTitle className="mt-1 text-base">Service burden outliers</CardTitle></div>
                  <Badge variant="outline" className="border-amber-500/20 text-amber-700 dark:text-amber-300"><Lightbulb className="mr-1 h-3 w-3" />Explainable</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 pt-4">
                {data.profit_killers?.length ? data.profit_killers.slice(0, 6).map(item => (
                  <button key={item.client_id} type="button" onClick={() => navigate(item.route)} className="group w-full rounded-xl border border-border/60 bg-background/40 p-3 text-left transition hover:border-amber-500/25 hover:bg-amber-500/[0.03]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{item.client_name}</p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.explanation}</p>
                        <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                          <span>{item.tickets_30d} tickets</span><span>·</span><span>{item.after_hours_tickets_30d} after-hours</span><span>·</span><span>{item.recorded_hours_30d}h recorded</span>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-3">
                          <div><div className="flex justify-between text-[10px]"><span>MRR share</span><span>{item.revenue_share_pct}%</span></div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(item.revenue_share_pct, 100)}%` }} /></div></div>
                          <div><div className="flex justify-between text-[10px]"><span>Service burden</span><span>{item.service_burden_share_pct}%</span></div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-amber-500" style={{ width: `${Math.min(item.service_burden_share_pct, 100)}%` }} /></div></div>
                        </div>
                      </div>
                      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5" />
                    </div>
                  </button>
                )) : (
                  <div className="flex flex-col items-center py-10 text-center"><CheckCircle2 className="h-8 w-8 text-emerald-500" /><p className="mt-3 text-sm font-semibold">No disproportionate burden detected</p><p className="mt-1 max-w-sm text-xs text-muted-foreground">Nexus compares contract-backed MRR with ticket and recorded-time burden—it does not invent profit.</p></div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
            <Card data-testid="executive-client-success">
              <CardHeader className="border-b border-border/60 pb-4">
                <div className="flex items-center justify-between gap-3">
                  <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-500">Customer success</p><CardTitle className="mt-1 text-base">Portfolio resilience</CardTitle></div>
                  <Button size="sm" variant="ghost" onClick={() => navigate("/clients")}>Open clients<ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-border/60">
                  {(data.portfolio || []).slice(0, 8).map(client => (
                    <button key={client.client_id} type="button" onClick={() => navigate(client.route)} className="grid w-full grid-cols-[1fr_auto] gap-4 px-4 py-3 text-left transition hover:bg-muted/25 sm:grid-cols-[1fr_100px_100px_100px] sm:items-center">
                      <div className="min-w-0"><p className="truncate text-sm font-medium">{client.client_name}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{client.evidence_coverage_pct}% evidence coverage</p></div>
                      <div className="hidden text-right sm:block"><p className="text-[10px] uppercase text-muted-foreground">MRR</p><p className="text-sm font-semibold">{money(client.mrr, true)}</p></div>
                      <div className="hidden text-right sm:block"><p className="text-[10px] uppercase text-muted-foreground">Health</p><p className={`text-sm font-semibold ${client.health_score == null ? "text-muted-foreground" : client.health_score < 50 ? "text-rose-500" : client.health_score < 70 ? "text-amber-500" : "text-emerald-500"}`}>{client.health_score ?? "—"}</p></div>
                      <div className="flex items-center justify-end gap-2"><span className="text-xs text-muted-foreground">{client.tickets_30d} ticket{client.tickets_30d === 1 ? "" : "s"}</span><ChevronRight className="h-4 w-4 text-muted-foreground" /></div>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            <div className="space-y-5">
              <Card data-testid="executive-team-capacity">
                <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4 text-cyan-500" />Team capacity</CardTitle></CardHeader>
                <CardContent>
                  <div className="flex items-end justify-between gap-4">
                    <div><p className="text-3xl font-semibold">{team.capacity_pct == null ? "—" : `${team.capacity_pct}%`}</p><p className="mt-1 text-xs text-muted-foreground">aggregate recorded load</p></div>
                    <Badge variant="outline">{team.active_service_team || 0} service team</Badge>
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${team.capacity_pct > 90 ? "bg-rose-500" : team.capacity_pct > 75 ? "bg-amber-500" : "bg-cyan-500"}`} style={{ width: `${Math.min(team.capacity_pct || 0, 100)}%` }} /></div>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div className="rounded-lg bg-muted/30 p-3"><p className="text-[10px] uppercase text-muted-foreground">Recorded</p><p className="mt-1 font-semibold">{team.recorded_hours_30d || 0}h</p></div>
                    <div className="rounded-lg bg-muted/30 p-3"><p className="text-[10px] uppercase text-muted-foreground">Billable</p><p className="mt-1 font-semibold">{team.billable_hours_30d || 0}h</p></div>
                  </div>
                  <div className="mt-3 flex gap-2 text-[11px] leading-5 text-muted-foreground"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-500" />{team.method}</div>
                </CardContent>
              </Card>

              <Card data-testid="executive-data-quality">
                <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><ClipboardCheck className="h-4 w-4 text-emerald-500" />Evidence confidence</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {(data.data_quality || []).map(item => {
                    const config = qualityTone[item.state] || qualityTone.missing;
                    const Icon = config.icon;
                    return (
                      <div key={item.id} className="rounded-xl border border-border/60 p-3">
                        <div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold">{item.label}</p><Badge variant="outline" className={config.badge}><Icon className="mr-1 h-3 w-3" />{config.label}</Badge></div>
                        <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">{item.detail}</p>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </div>
          </div>

          <Card className="overflow-hidden border-violet-500/15" data-testid="executive-board-card">
            <CardContent className="p-5 md:p-6">
              <div className="grid gap-5 lg:grid-cols-[0.7fr_1.3fr] lg:items-center">
                <div>
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-500/10 ring-1 ring-violet-500/20"><Bot className="h-5 w-5 text-violet-500" /></div>
                  <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-500">Monthly operating rhythm</p>
                  <h2 className="mt-1 text-xl font-semibold">AI Board Meeting</h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">A concise, evidence-labelled brief of wins, risks, owner decisions, and outlook. Save a point-in-time snapshot after review.</p>
                  <Button className="mt-4" onClick={() => setBoardOpen(true)}>Review briefing<ArrowRight className="ml-2 h-4 w-4" /></Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    { label: "Wins", icon: TrendingUp, items: board.wins, tone: "text-emerald-500" },
                    { label: "Risks", icon: AlertTriangle, items: board.risks, tone: "text-rose-500" },
                    { label: "Decisions", icon: ClipboardCheck, items: board.decisions, tone: "text-amber-500" },
                    { label: "Outlook", icon: BarChart3, items: board.outlook, tone: "text-violet-500" },
                  ].map(section => {
                    const Icon = section.icon;
                    return (
                      <div key={section.label} className="rounded-xl border border-border/60 bg-muted/15 p-3">
                        <p className="flex items-center gap-2 text-xs font-semibold"><Icon className={`h-3.5 w-3.5 ${section.tone}`} />{section.label}</p>
                        <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{section.items?.[0] || "No current evidence."}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
              {data.recent_board_snapshots?.length > 0 && (
                <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border/60 pt-4 text-xs text-muted-foreground">
                  <Save className="h-3.5 w-3.5" /><span>Latest retained briefing:</span><span className="font-medium text-foreground">{data.recent_board_snapshots[0].title}</span><span>·</span><span>{when(data.recent_board_snapshots[0].created_at)}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {data && <ScenarioDialog open={scenarioOpen} onOpenChange={setScenarioOpen} data={data} headers={headers} />}
      {data && <BoardBriefDialog open={boardOpen} onOpenChange={setBoardOpen} data={data} onSave={saveBoard} saving={saving} />}
    </div>
  );
}
