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
  Building2,
  CalendarRange,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Copy,
  DollarSign,
  Download,
  FileChartColumnIncreasing,
  FileSpreadsheet,
  Gauge,
  HeartPulse,
  Info,
  Landmark,
  Lightbulb,
  LineChart,
  Loader2,
  Percent,
  Receipt,
  RefreshCw,
  Save,
  Scale,
  ShieldAlert,
  Sparkles,
  Star,
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
import WorkspaceActionMenu, { WorkspaceActionMenuItem } from "@/components/WorkspaceActionMenu";
import WorkspaceControlBar from "@/components/WorkspaceControlBar";
import {
  ExecutiveCommandRail,
  ExecutivePortfolioTable,
  MarginReadout,
  MrrTargetCard,
  OwnerWatchlistPanel,
  ReceivablesAgingCard,
  RenewalCalendarCard,
  RevenueConcentrationCard,
  RevenueTrendCard,
} from "@/components/executive/ExecutiveWorkspaceKit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/design-system";
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
import {
  EXECUTIVE_PERIODS,
  briefingPack,
  buildExecutiveSearchIndex,
  executivePeriodLabel,
  mrrTargetGrowth,
  overdueShare,
} from "@/lib/executiveBriefing";

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
  // The API reports a source it could not measure as insufficient evidence,
  // never as a verified zero.
  insufficient_evidence: {
    badge: "border-border bg-muted/50 text-muted-foreground",
    icon: XCircle,
    label: "Not measurable",
  },
};

/**
 * The owner's one-click launcher. Every entry is an existing, routed workspace
 * that already owns its own evidence — the cockpit never duplicates a page, it
 * just removes the navigation tax from getting to one.
 */
const OWNER_WORKSPACES = [
  { label: "Financial analytics", detail: "Margin, trend and mix by client", route: "/financial-analytics", icon: LineChart, keywords: "margin trend mix" },
  { label: "Revenue forecast", detail: "Pipeline-weighted forward view", route: "/revenue-forecast", icon: TrendingUp, keywords: "forecast pipeline bookings" },
  { label: "Contract profitability", detail: "Agreement-level contribution", route: "/contract-profit", icon: Receipt, keywords: "agreement profitability contract" },
  { label: "Cost per ticket", detail: "Service cost by queue and client", route: "/cost-per-ticket", icon: FileSpreadsheet, keywords: "cost ticket labour" },
  { label: "Commercial reports", detail: "Board and finance packs", route: "/reports?tab=commercial", icon: FileChartColumnIncreasing, keywords: "reports pack board" },
  { label: "Clients", detail: "Every account and its health", route: "/clients", icon: Building2, keywords: "accounts customers portfolio" },
  { label: "Invoices", detail: "Ledger, ageing and collections", route: "/invoices", icon: Landmark, keywords: "billing receivables collections" },
  { label: "Quarterly reviews", detail: "Client QBR drafts and exports", route: "/qbr", icon: ClipboardCheck, keywords: "qbr review quarterly" },
  { label: "SaaS spend", detail: "Software cost exposure", route: "/saas-spend", icon: WalletCards, keywords: "software spend licences" },
  { label: "Profitability heatmap", detail: "Where the money actually is", route: "/profitability-heatmap", icon: Percent, keywords: "heatmap profitability" },
  { label: "Purchase orders", detail: "Committed cost and vendors", route: "/purchase-orders", icon: Banknote, keywords: "procurement vendors committed" },
  { label: "Scheduled reports", detail: "Recurring owner delivery", route: "/scheduled-reports", icon: CalendarRange, keywords: "schedule recurring delivery" },
];

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

function ScenarioDialog({ open, onOpenChange, data, headers, windowDays }) {
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
        window: windowDays,
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
              This model excludes tax, financing, supplier inflation, sales pipeline conversion, and payment timing. Its assumptions are returned with the result, and it uses the {executivePeriodLabel(windowDays)} baseline.
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

/**
 * The owner records the goal; Nexus then measures the run rate against it. The
 * dialog states what the goal will be measured against and that it is the
 * owner's own recorded statement, so a saved goal is never mistaken for a
 * Nexus forecast.
 */
function MrrTargetDialog({ open, onOpenChange, goal, onSave, onClear, saving }) {
  const [target, setTarget] = useState("");
  const [month, setMonth] = useState("");
  const [note, setNote] = useState("");
  const recorded = Boolean(goal && goal.state !== "not_recorded");

  useEffect(() => {
    if (!open) return;
    setTarget(goal?.target_mrr != null ? String(goal.target_mrr) : "");
    setMonth(goal?.target_month || "");
    setNote(goal?.note || "");
  }, [open, goal]);

  const submit = () => {
    const amount = Number(target);
    if (!target || Number.isNaN(amount) || amount <= 0) {
      toast.error("Record the monthly recurring revenue goal as an amount above $0");
      return;
    }
    onSave({ target_mrr: amount, target_month: month || null, note });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 ring-1 ring-amber-500/20">
            <Target className="h-5 w-5 text-amber-500" />
          </div>
          <DialogTitle>Recurring revenue goal</DialogTitle>
          <DialogDescription>
            Record the monthly recurring revenue this business is steering toward. It is a recorded owner statement, not a Nexus estimate,
            and progress is measured against the same contract-backed MRR the briefing already reports. Recording also captures today's run
            rate as the goal's starting line, so progress can be stated as growth since the goal was recorded.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5 py-2">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="mrr-goal-amount">Monthly recurring revenue goal (AUD)</Label>
              <Input
                id="mrr-goal-amount"
                data-testid="executive-mrr-target-input"
                type="number"
                min="1"
                step="100"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                placeholder="e.g. 60000"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mrr-goal-month">Target month (optional)</Label>
              <Input
                id="mrr-goal-month"
                data-testid="executive-mrr-target-month"
                type="month"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="mrr-goal-note">Owner note (optional)</Label>
            <Input
              id="mrr-goal-note"
              data-testid="executive-mrr-target-note"
              value={note}
              maxLength={280}
              onChange={(event) => setNote(event.target.value)}
              placeholder="e.g. Board plan: new managed services tier"
            />
          </div>
          <div className="flex gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <span>
              {recorded && goal?.starting_mrr == null
                ? "This goal was recorded without a starting run rate, so Nexus states its distance to target but not growth since it was set. "
                  + "Updating it keeps that absence; clear it and record it again to capture today's run rate as the starting line. "
                : `${recorded ? "Revising the goal keeps the run rate it was originally recorded against" : "Saving captures today's contract-backed MRR as the goal's starting line"}, `
                  + "so growth since it was recorded can be stated. "}
              Contract-backed MRR is the recorded monthly contract value, falling back to a client's own MRR where no contract value exists.
              With a target month, Nexus states the arithmetic step needed to close the gap — never that the growth will happen. Leave the month
              blank and Nexus states the gap without inventing a pace.
            </span>
          </div>
        </div>
        <DialogFooter className="flex-wrap gap-2">
          {recorded && (
            <Button variant="ghost" className="mr-auto text-muted-foreground" onClick={onClear} disabled={saving} data-testid="executive-mrr-target-clear-goal">
              Clear recorded goal
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving} data-testid="executive-mrr-target-save">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Target className="mr-2 h-4 w-4" />}
            {recorded ? "Update goal" : "Record goal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BoardBriefDialog({ open, onOpenChange, data, onSave, onDownload, saving }) {
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
          <DialogDescription>Board-ready talking points assembled from current Nexus evidence for {data?.period?.label?.toLowerCase()}. Review every point before external use.</DialogDescription>
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
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={onDownload}><Download className="mr-2 h-4 w-4" />Download owner pack</Button>
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
  const [windowDays, setWindowDays] = useState(30);
  const [scenarioOpen, setScenarioOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [watchedOnly, setWatchedOnly] = useState(false);
  const [watchBusy, setWatchBusy] = useState("");
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalBusy, setGoalBusy] = useState(false);

  const load = useCallback(async (days = windowDays) => {
    setLoading(true);
    setError("");
    try {
      const response = await axios.get(`${API}/executive/overview`, { headers, params: { window: days } });
      setData(response.data);
    } catch (requestError) {
      setError(requestError.response?.data?.detail || "The executive evidence service did not return a briefing.");
    } finally {
      setLoading(false);
    }
  }, [headers, windowDays]);

  useEffect(() => { load(windowDays); }, [load, windowDays]);

  const saveBoard = async () => {
    setSaving(true);
    try {
      const response = await axios.post(`${API}/executive/board-snapshots`, {}, { headers });
      toast.success(`${response.data.title} saved`);
      setBoardOpen(false);
      await load(windowDays);
    } catch (requestError) {
      toast.error(requestError.response?.data?.detail || "Board snapshot could not be saved");
    } finally {
      setSaving(false);
    }
  };

  /**
   * Recording or clearing the goal refreshes the whole briefing afterwards: the
   * goal also feeds the decision queue and the evidence-confidence card, and a
   * stale copy of either would contradict the card the owner just changed.
   */
  const recordGoal = useCallback(async (payload) => {
    setGoalBusy(true);
    try {
      const response = await axios.put(`${API}/executive/mrr-target`, payload, { headers });
      setData((current) => (current ? { ...current, mrr_target: response.data.mrr_target } : current));
      toast.success(response.data.created ? "Revenue goal recorded" : "Revenue goal updated");
      setGoalOpen(false);
      await load(windowDays);
    } catch (requestError) {
      toast.error(requestError.response?.data?.detail || "The revenue goal could not be recorded");
    } finally {
      setGoalBusy(false);
    }
  }, [headers, load, windowDays]);

  const clearGoal = useCallback(async () => {
    setGoalBusy(true);
    try {
      const response = await axios.delete(`${API}/executive/mrr-target`, { headers });
      setData((current) => (current ? { ...current, mrr_target: response.data.mrr_target } : current));
      toast.success(`Revenue goal of ${money(response.data.removed_target_mrr, true)} cleared · nothing is assumed in its place`);
      setGoalOpen(false);
      await load(windowDays);
    } catch (requestError) {
      toast.error(requestError.response?.data?.detail || "The revenue goal could not be cleared");
    } finally {
      setGoalBusy(false);
    }
  }, [headers, load, windowDays]);

  const toggleWatch = useCallback(async (client, isWatched) => {
    if (!client?.client_id) return;
    setWatchBusy(client.client_id);
    try {
      if (isWatched) {
        await axios.delete(`${API}/executive/watchlist/${client.client_id}`, { headers });
        setData((current) => (current
          ? { ...current, watchlist: (current.watchlist || []).filter((row) => String(row.client_id) !== String(client.client_id)) }
          : current));
        toast.success(`${client.client_name} removed from your watchlist`);
      } else {
        const response = await axios.post(`${API}/executive/watchlist`, { client_id: client.client_id }, { headers });
        setData((current) => (current
          ? {
            ...current,
            watchlist: [
              response.data.watchlist,
              ...(current.watchlist || []).filter((row) => String(row.client_id) !== String(client.client_id)),
            ],
          }
          : current));
        toast.success(`${client.client_name} added to your watchlist`);
      }
    } catch (requestError) {
      toast.error(requestError.response?.data?.detail || "The watchlist could not be updated");
    } finally {
      setWatchBusy("");
    }
  }, [headers]);

  const downloadPack = useCallback((payload = data) => {
    if (!payload) return;
    const pack = briefingPack(payload);
    try {
      const blob = new Blob([pack.lines.join("\n")], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `nexus-executive-briefing-${new Date().toISOString().slice(0, 10)}.txt`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success("Owner pack downloaded");
    } catch {
      toast.error("This browser blocked the download. Use the board brief instead.");
    }
  }, [data]);

  const copyPack = useCallback(async () => {
    if (!data) return;
    const pack = briefingPack(data);
    try {
      await navigator.clipboard.writeText(pack.lines.join("\n"));
      toast.success("Owner summary copied");
    } catch {
      toast.error("Clipboard access was refused by the browser");
    }
  }, [data]);

  const summary = data?.summary || {};
  const financial = data?.financial || {};
  const team = data?.team || {};
  const board = data?.board_brief || {};
  const topDecision = data?.risk_items?.[0];
  const watchlist = useMemo(() => data?.watchlist || [], [data]);
  const goalGrowth = mrrTargetGrowth(data?.mrr_target);

  const searchIndex = useMemo(() => buildExecutiveSearchIndex({
    portfolio: data?.portfolio || [],
    watchlist,
    risks: data?.risk_items || [],
    renewals: data?.renewals?.rows || [],
    workspaces: OWNER_WORKSPACES,
  }), [data, watchlist]);

  const atRiskShare = overdueShare(data?.receivables);

  const signal = (() => {
    if (error) return { state: "attention", label: "Briefing unavailable", description: "Nexus could not load the current owner evidence." };
    if (!data) return null;
    if (summary.critical_risk_count) return { state: "critical", label: `${summary.critical_risk_count} critical decision${summary.critical_risk_count === 1 ? "" : "s"}`, description: "An owner decision is evidenced as critical." };
    if (summary.risk_count) return { state: "attention", label: `${summary.risk_count} decision${summary.risk_count === 1 ? "" : "s"} waiting`, description: "Recorded evidence needs an owner decision." };
    return { state: "healthy", label: "No owner risk evidenced", description: "Every loaded evidence source is in range." };
  })();

  return (
    <div className="space-y-5 p-6" data-testid="executive-page">
      <OperationalPageHeader
        eyebrow="Owner intelligence"
        title="Executive"
        description="One cockpit for revenue quality, cash exposure, customer resilience, capacity and the decisions only an owner can make."
        icon={BriefcaseBusiness}
        tone="emerald"
        signal={signal?.state}
        signalLabel={signal?.label}
        signalDescription={signal?.description}
        meta={data ? [
          <span key="period">{data.period?.label}</span>,
          <span key="generated">Generated {when(data.generated_at)}</span>,
          data.mrr_target?.state !== "not_recorded" && data.mrr_target
            ? <span key="goal">Goal {data.mrr_target.progress_pct}%</span>
            : <span key="goal">No revenue goal recorded</span>,
          // Growth is only stated when the goal carries the run rate it was
          // recorded against; a legacy goal says nothing rather than measuring
          // from a starting line nobody recorded.
          goalGrowth
            ? (
              <span key="goal-growth" data-testid="executive-header-goal-growth">
                {`Run rate ${goalGrowth.direction === "down" ? "-" : goalGrowth.direction === "up" ? "+" : ""}${Math.abs(goalGrowth.growth).toLocaleString("en-AU")} since the goal was recorded`}
              </span>
            )
            : null,
          <span key="watchlist">{watchlist.length} watched</span>,
        ] : undefined}
        actions={(
          <>
            <Button variant="outline" size="sm" onClick={() => setScenarioOpen(true)}><Scale className="mr-1.5 h-3.5 w-3.5" />MSP Simulator</Button>
            <Button variant="outline" size="sm" onClick={() => load(windowDays)} disabled={loading}><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
            <Button size="sm" onClick={() => setBoardOpen(true)} data-testid="executive-board-button"><FileChartColumnIncreasing className="mr-1.5 h-3.5 w-3.5" />Board briefing</Button>
            <WorkspaceActionMenu label="Owner tools" testId="executive-owner-tools">
              <WorkspaceActionMenuItem icon={Download} onSelect={() => downloadPack()} disabled={!data} testId="executive-download-pack">Download owner pack</WorkspaceActionMenuItem>
              <WorkspaceActionMenuItem icon={Copy} onSelect={copyPack} disabled={!data}>Copy summary to clipboard</WorkspaceActionMenuItem>
              <WorkspaceActionMenuItem icon={Save} onSelect={saveBoard} disabled={!data || saving}>Save board snapshot</WorkspaceActionMenuItem>
              <WorkspaceActionMenuItem icon={Target} onSelect={() => setGoalOpen(true)} disabled={!data}>Record revenue goal</WorkspaceActionMenuItem>
              <WorkspaceActionMenuItem icon={CircleHelp} onSelect={() => navigate("/help/ceo-mode")}>Open CEO Mode guide</WorkspaceActionMenuItem>
            </WorkspaceActionMenu>
          </>
        )}
      />

      <WorkspaceControlBar data-testid="executive-control-bar">
        <div className="flex items-center gap-2" role="group" aria-label="Owner reporting period">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Period</span>
          {EXECUTIVE_PERIODS.map((period) => {
            const active = Number(windowDays) === period.days;
            return (
              <Button
                key={period.days}
                type="button"
                size="sm"
                variant={active ? "default" : "outline"}
                aria-pressed={active}
                className="h-8"
                onClick={() => setWindowDays(period.days)}
                data-testid={`executive-period-${period.days}`}
              >
                {period.label}
              </Button>
            );
          })}
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="hidden items-center gap-1.5 sm:flex">
            <CalendarRange className="h-3.5 w-3.5" />
            {data?.period?.label || executivePeriodLabel(windowDays)}
          </span>
          {atRiskShare != null && (
            <span className={atRiskShare > 10 ? "font-medium text-rose-500" : ""}>{atRiskShare}% of the open ledger is overdue</span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={watchedOnly ? "default" : "outline"}
            aria-pressed={watchedOnly}
            className="h-8"
            onClick={() => setWatchedOnly((current) => !current)}
            data-testid="executive-watched-only"
          >
            <Star className={`mr-1.5 h-3.5 w-3.5 ${watchedOnly ? "fill-current" : ""}`} />
            Watched only
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => downloadPack()} disabled={!data} data-testid="executive-owner-pack">
            <Download className="mr-1.5 h-3.5 w-3.5" />Owner pack
          </Button>
        </div>
      </WorkspaceControlBar>

      {error && !data ? <ErrorState error={error} title="The owner briefing could not load" description="Nexus could not read the commercial and operational evidence for this window. Nothing is hidden — the briefing is simply not available until the read succeeds." icon={<ShieldAlert className="h-9 w-9" />} retryLabel="Retry" onRetry={() => load(windowDays)} className="rounded-xl border border-rose-500/20 bg-rose-500/[0.04]" /> : !data ? (
        <div className="space-y-5"><LoadingState label="Building the owner briefing…" rows={5} /></div>
      ) : (
        <>
          {error && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3 text-xs text-amber-800 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error} Showing the last briefing that loaded.</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="executive-kpi-strip">
            <HeroTile label="Contract MRR" value={money(summary.mrr, true)} icon={DollarSign} glow="emerald" animated={false} subtitle={`${money(summary.arr, true)} annual run rate`} testId="executive-mrr" />
            <HeroTile label="Contribution" value={summary.service_contribution == null ? "—" : money(summary.service_contribution, true)} icon={TrendingUp} glow={summary.service_contribution == null ? "zinc" : "cyan"} animated={false} subtitle={summary.contribution_margin_pct == null ? "Direct costs not assessed" : `${summary.contribution_margin_pct}% recorded margin`} testId="executive-contribution" />
            <HeroTile label="Cash outlook · 30d" value={money(summary.net_cash_30d, true)} icon={Banknote} glow={summary.net_cash_30d < 0 ? "rose" : "emerald"} animated={false} subtitle="Receivables less open POs" testId="executive-cash" />
            <HeroTile label="Customer health" value={number(summary.average_client_health, 0)} icon={HeartPulse} glow={summary.average_client_health == null ? "zinc" : summary.average_client_health < 60 ? "rose" : "violet"} animated={false} subtitle={`${summary.assessed_clients || 0}/${summary.total_clients || 0} assessed`} testId="executive-health" />
            <HeroTile label="Team load" value={summary.staff_capacity_pct == null ? "Not assessed" : `${summary.staff_capacity_pct}%`} icon={Gauge} glow={summary.staff_capacity_pct == null ? "zinc" : summary.staff_capacity_pct > 90 ? "rose" : "amber"} animated={false} subtitle={`Aggregate load across ${data.period?.label?.toLowerCase() || "the period"}`} testId="executive-capacity" />
            <HeroTile label="Owner risks" value={summary.risk_count || 0} icon={ShieldAlert} glow={summary.critical_risk_count ? "rose" : summary.risk_count ? "amber" : "emerald"} subtitle={`${summary.critical_risk_count || 0} critical`} testId="executive-risks" />
          </div>

          <Card className="overflow-hidden border-emerald-500/15 bg-gradient-to-br from-emerald-500/[0.07] via-card to-card shadow-[0_22px_70px_rgba(16,185,129,0.06)]" data-testid="executive-owner-pulse">
            <CardContent className="p-5 md:p-6">
              <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr] lg:items-center">
                <div>
                  <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-600 dark:text-emerald-300"><Sparkles className="h-3.5 w-3.5" />Owner pulse · {data.period?.label}</div>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">{board.headline}</h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                    Nexus separates recorded business evidence from estimates. {data.concentration?.detail || "Concentration is not measurable yet."} Statements below link back to the workspace that owns them.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => setBoardOpen(true)}><FileChartColumnIncreasing className="mr-2 h-4 w-4" />Open board brief</Button>
                    <Button size="sm" variant="outline" onClick={() => setScenarioOpen(true)}><Scale className="mr-2 h-4 w-4" />Stress-test the plan</Button>
                    <Button size="sm" variant="outline" onClick={() => { setSearchQuery(""); navigate("/clients"); }}><Building2 className="mr-2 h-4 w-4" />Open portfolio</Button>
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

          <ExecutiveCommandRail
            index={searchIndex}
            workspaces={OWNER_WORKSPACES}
            query={searchQuery}
            onQueryChange={setSearchQuery}
            onNavigate={(route) => { setSearchQuery(""); navigate(route); }}
          />

          <div className="grid gap-5 xl:grid-cols-[1.4fr_0.6fr]">
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

            <MrrTargetCard
              goal={data.mrr_target}
              busy={goalBusy}
              onEdit={() => setGoalOpen(true)}
              onClear={clearGoal}
            />
          </div>

          <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
            <Card data-testid="executive-decisions">
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

          <div className="grid gap-5 xl:grid-cols-2">
            <ReceivablesAgingCard receivables={data.receivables} onOpen={navigate} />
            <RevenueConcentrationCard concentration={data.concentration} onOpen={navigate} />
          </div>

          <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
            <RevenueTrendCard trend={data.revenue_trend} onOpen={navigate} />
            <RenewalCalendarCard renewals={data.renewals} onOpen={navigate} />
          </div>

          <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
            <ExecutivePortfolioTable
              portfolio={data.portfolio}
              watchlist={watchlist}
              watchedOnly={watchedOnly}
              busyClientId={watchBusy}
              onOpen={navigate}
              onToggleWatch={(client, isWatched) => toggleWatch(client, isWatched)}
            />

            <div className="space-y-5">
              <OwnerWatchlistPanel
                watchlist={watchlist}
                busyClientId={watchBusy}
                onOpen={navigate}
                onRemove={(row) => toggleWatch({ client_id: row.client_id, client_name: row.client_name }, true)}
              />
              <MarginReadout summary={summary} />
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-[1fr_1fr_1.2fr]">
            <Card data-testid="executive-team-capacity">
              <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4 text-cyan-500" />Team capacity</CardTitle></CardHeader>
              <CardContent>
                <div className="flex items-end justify-between gap-4">
                  <div><p className="text-3xl font-semibold">{team.capacity_pct == null ? "—" : `${team.capacity_pct}%`}</p><p className="mt-1 text-xs text-muted-foreground">aggregate recorded load</p></div>
                  <Badge variant="outline">{team.active_service_team || 0} service team</Badge>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${team.capacity_pct > 90 ? "bg-rose-500" : team.capacity_pct > 75 ? "bg-amber-500" : "bg-cyan-500"}`} style={{ width: `${Math.min(team.capacity_pct || 0, 100)}%` }} /></div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-muted/30 p-3"><p className="text-[10px] uppercase text-muted-foreground">Recorded</p><p className="mt-1 font-semibold">{team.recorded_hours || 0}h</p></div>
                  <div className="rounded-lg bg-muted/30 p-3"><p className="text-[10px] uppercase text-muted-foreground">Billable</p><p className="mt-1 font-semibold">{team.billable_hours || 0}h</p></div>
                </div>
                <div className="mt-3 flex gap-2 text-[11px] leading-5 text-muted-foreground"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-500" />{team.method}</div>
              </CardContent>
            </Card>

            <Card data-testid="executive-data-quality">
              <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><ClipboardCheck className="h-4 w-4 text-emerald-500" />Evidence confidence</CardTitle></CardHeader>
              <CardContent className="space-y-2.5">
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

            <Card className="overflow-hidden border-violet-500/15" data-testid="executive-board-card">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-500/10 ring-1 ring-violet-500/20"><Bot className="h-5 w-5 text-violet-500" /></span>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-500">Monthly operating rhythm</p>
                    <CardTitle className="mt-0.5 text-base">AI Board Meeting</CardTitle>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
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
                <Button size="sm" className="w-full" onClick={() => setBoardOpen(true)}>Review briefing<ArrowRight className="ml-2 h-4 w-4" /></Button>
                {data.recent_board_snapshots?.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3 text-xs text-muted-foreground">
                    <Save className="h-3.5 w-3.5" /><span>Latest retained briefing:</span><span className="font-medium text-foreground">{data.recent_board_snapshots[0].title}</span><span>·</span><span>{when(data.recent_board_snapshots[0].created_at)}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {data && <ScenarioDialog open={scenarioOpen} onOpenChange={setScenarioOpen} data={data} headers={headers} windowDays={windowDays} />}
      {data && (
        <MrrTargetDialog
          open={goalOpen}
          onOpenChange={setGoalOpen}
          goal={data.mrr_target}
          onSave={recordGoal}
          onClear={clearGoal}
          saving={goalBusy}
        />
      )}
      {data && <BoardBriefDialog open={boardOpen} onOpenChange={setBoardOpen} data={data} onSave={saveBoard} onDownload={() => downloadPack()} saving={saving} />}
    </div>
  );
}
