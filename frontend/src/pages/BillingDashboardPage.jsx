import { useState, useEffect, useCallback, useMemo } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  Loader2, DollarSign, TrendingUp, AlertTriangle, CheckCircle,
  Clock, CreditCard, Flame, Zap, Send, ArrowUpRight, ArrowDownRight,
  BarChart3, Users, FileText, Receipt, ShoppingCart, Target, Banknote,
  Trophy, ChevronRight, Activity, RefreshCw, MoreHorizontal, ChevronDown, Calculator, Layers3
} from "lucide-react";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import HeroTile from "@/components/HeroTile";
import OperationalPageHeader from "@/components/OperationalPageHeader";

const STREAK_CONFIG = {
  starter: { label: "Getting Started", color: "text-gray-400", bg: "bg-gray-500/10", ring: "" },
  warming: { label: "Warming Up", color: "text-amber-400", bg: "bg-amber-500/10", ring: "ring-1 ring-amber-500/30" },
  hot: { label: "On Fire!", color: "text-orange-400", bg: "bg-orange-500/10", ring: "ring-1 ring-orange-500/40" },
  fire: { label: "Blazing!", color: "text-red-400", bg: "bg-red-500/10", ring: "ring-2 ring-red-500/50 animate-pulse" },
  legendary: { label: "LEGENDARY", color: "text-yellow-300", bg: "bg-yellow-500/10", ring: "ring-2 ring-yellow-400/60 animate-pulse" },
};

const SEVERITY_CONFIG = {
  critical: { label: "Critical", class: "bg-red-500/20 text-red-400 border-red-500/30" },
  high: { label: "High", class: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  medium: { label: "Medium", class: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  low: { label: "Low", class: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
};

function normalizeBillingMetrics(payload = {}) {
  const number = (value) => Number(value) || 0;
  return {
    ...payload,
    mrr: number(payload.mrr),
    arr: number(payload.arr),
    total_invoiced: number(payload.total_invoiced),
    total_collected: number(payload.total_collected),
    total_outstanding: number(payload.total_outstanding),
    collection_rate: number(payload.collection_rate),
    payment_health_score: payload.payment_health_score == null ? 50 : number(payload.payment_health_score),
    total_po_spend: number(payload.total_po_spend),
    streak: {
      current: number(payload.streak?.current),
      best: number(payload.streak?.best),
      level: payload.streak?.level || "starter",
    },
    overdue_alerts: Array.isArray(payload.overdue_alerts)
      ? payload.overdue_alerts.map(item => ({ ...item, balance: number(item.balance), total: number(item.total), days_overdue: number(item.days_overdue) }))
      : [],
    recent_payments: Array.isArray(payload.recent_payments)
      ? payload.recent_payments.map(item => ({ ...item, amount: number(item.amount) }))
      : [],
    monthly_trend: Array.isArray(payload.monthly_trend)
      ? payload.monthly_trend.map(item => ({ ...item, invoiced: number(item.invoiced), collected: number(item.collected) }))
      : [],
    top_debtors: Array.isArray(payload.top_debtors)
      ? payload.top_debtors.map(item => ({ ...item, balance: number(item.balance), invoices: number(item.invoices) }))
      : [],
    overdue_count: number(payload.overdue_count),
    counts: {
      total_invoices: number(payload.counts?.total_invoices),
      draft: number(payload.counts?.draft),
      sent: number(payload.counts?.sent),
      paid: number(payload.counts?.paid),
      overdue: number(payload.counts?.overdue),
    },
    cash_flow_forecast: {
      incoming_30d: number(payload.cash_flow_forecast?.incoming_30d),
      outgoing_30d: number(payload.cash_flow_forecast?.outgoing_30d),
      net_30d: number(payload.cash_flow_forecast?.net_30d),
    },
  };
}

function formatPaymentDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : format(date, "MMM d, HH:mm");
}

function HealthGauge({ score }) {
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;
  const color = score >= 80 ? "#22c55e" : score >= 60 ? "#f59e0b" : score >= 40 ? "#f97316" : "#ef4444";

  return (
    <div className="relative w-36 h-36 mx-auto">
      <svg className="w-36 h-36 -rotate-90" viewBox="0 0 128 128">
        <circle cx="64" cy="64" r={radius} fill="none" stroke="currentColor" strokeWidth="8" className="text-muted/20" />
        <circle cx="64" cy="64" r={radius} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={strokeDashoffset}
          style={{ transition: "stroke-dashoffset 1.5s ease-in-out" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold" style={{ color }}>{score}</span>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Health</span>
      </div>
    </div>
  );
}

function MiniGauge({ value, max, label, color }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono" style={{ color }}>{pct.toFixed(0)}%</span>
      </div>
      <div className="h-1.5 bg-muted/20 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

export default function BillingDashboardPage() {
  const { token } = useAuth();
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [chasingId, setChasingId] = useState(null);
  const navigate = useNavigate();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await axios.get(`${API}/billing-dashboard/metrics`, { headers });
      setMetrics(normalizeBillingMetrics(res.data));
    } catch (error) {
      const message = error.response?.data?.detail || "Failed to load billing metrics";
      setMetrics(null);
      setLoadError(message);
      toast.error(message);
    }
    finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { fetchMetrics(); }, [fetchMetrics]);

  const handleChase = async (invoiceId) => {
    setChasingId(invoiceId);
    try {
      const res = await axios.post(`${API}/billing-dashboard/chase/${invoiceId}`, {}, { headers });
      toast.success(res.data.message);
      fetchMetrics();
    } catch (e) { toast.error(e.response?.data?.detail || "Chase failed"); }
    finally { setChasingId(null); }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  }

  if (loadError || !metrics) {
    return (
      <div className="space-y-6" data-testid="billing-dashboard-error">
        <OperationalPageHeader
          eyebrow="Financial operations"
          title="Billing Command"
          description="Revenue, collections, cash flow, and financial follow-through across NexusMSP."
          icon={Banknote}
          tone="emerald"
          actions={<Button variant="outline" size="sm" onClick={fetchMetrics}><RefreshCw className="mr-1.5 h-4 w-4" />Retry</Button>}
        />
        <Card className="border-rose-500/20 bg-rose-500/[0.04]">
          <CardContent className="flex min-h-56 flex-col items-center justify-center p-8 text-center">
            <AlertTriangle className="h-8 w-8 text-rose-300" />
            <h2 className="mt-3 text-base font-semibold">Billing metrics are temporarily unavailable</h2>
            <p className="mt-1 max-w-lg text-sm text-muted-foreground">{loadError || "The metrics response was empty."}</p>
            <Button className="mt-4" onClick={fetchMetrics}><RefreshCw className="mr-2 h-4 w-4" />Try again</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const m = metrics;
  const streakCfg = STREAK_CONFIG[m.streak.level] || STREAK_CONFIG.starter;
  const healthColor = m.payment_health_score >= 80 ? "text-green-400" : m.payment_health_score >= 60 ? "text-amber-400" : m.payment_health_score >= 40 ? "text-orange-400" : "text-red-400";
  const billingSignal = m.payment_health_score < 40 || m.overdue_count > 0
    ? "critical"
    : m.payment_health_score < 80
      ? "attention"
      : "healthy";

  return (
    <div className="nx-page-stage space-y-6" data-testid="billing-dashboard">
      <OperationalPageHeader
        eyebrow="Financial operations"
        title="Billing Command"
        description="Revenue, collections, cash flow, and financial follow-through across NexusMSP."
        icon={Banknote}
        tone="emerald"
        signal={billingSignal}
        actions={<>
          <Button variant="outline" size="sm" onClick={fetchMetrics} disabled={loading} data-testid="refresh-billing-dashboard">
            <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate("/invoices")} data-testid="go-to-invoices">
            <Receipt className="w-4 h-4 mr-1" />Invoices
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate("/recurring-invoices")} data-testid="go-to-recurring">
            <RefreshCw className="w-4 h-4 mr-1" />Recurring
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate("/purchase-orders")} data-testid="go-to-pos">
            <ShoppingCart className="w-4 h-4 mr-1" />Purchase Orders
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5" data-testid="billing-workspace-more"><MoreHorizontal className="h-3.5 w-3.5" />More<ChevronDown className="h-3 w-3 opacity-60" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => navigate("/estimates")} className="gap-2.5"><FileText className="h-4 w-4 text-sky-300" />Estimates</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/quote-to-cash")} className="gap-2.5"><Target className="h-4 w-4 text-violet-300" />Quote to cash</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/billing-recon")} className="gap-2.5"><CheckCircle className="h-4 w-4 text-emerald-300" />Reconciliation</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/services-subscriptions")} className="gap-2.5"><Layers3 className="h-4 w-4 text-cyan-300" />Services & subscriptions</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/usage-billing")} className="gap-2.5"><Activity className="h-4 w-4 text-cyan-300" />Usage billing</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/billing-portal")} className="gap-2.5"><CreditCard className="h-4 w-4 text-amber-300" />Payment portal</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/proposals")} className="gap-2.5"><FileText className="h-4 w-4 text-indigo-300" />Proposals & quotes</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/invoice-templates")} className="gap-2.5"><Receipt className="h-4 w-4 text-rose-300" />Document templates</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/finance-intel")} className="gap-2.5"><BarChart3 className="h-4 w-4 text-violet-300" />Finance intelligence</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/late-payment")} className="gap-2.5"><AlertTriangle className="h-4 w-4 text-rose-300" />Late-payment assistant</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/pricing-calc")} className="gap-2.5"><Calculator className="h-4 w-4 text-emerald-300" />Pricing calculator</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/xero")} className="gap-2.5"><ArrowUpRight className="h-4 w-4 text-sky-300" />Xero synchronisation</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>}
      />

      {/* Row 1: MRR/ARR + Health + Streak */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* MRR/ARR */}
        <Card
          className="relative cursor-pointer overflow-hidden border-purple-500/20 transition hover:-translate-y-0.5 hover:border-purple-400/40 hover:shadow-[0_18px_45px_rgba(139,92,246,0.10)]"
          role="button"
          tabIndex={0}
          aria-label="Open recurring billing"
          onClick={() => navigate("/recurring-invoices")}
          onKeyDown={event => { if (event.key === "Enter" || event.key === " ") navigate("/recurring-invoices"); }}
          data-testid="mrr-arr-card"
        >
          <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-purple-500 via-cyan-500 to-purple-500" />
          <CardContent className="pt-5 space-y-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <TrendingUp className="w-4 h-4 text-purple-400" />Recurring Revenue
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">MRR</p>
                <p className="text-2xl font-bold text-purple-400 font-mono">${m.mrr.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">ARR</p>
                <p className="text-2xl font-bold text-cyan-400 font-mono">${m.arr.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
              </div>
            </div>
            <MiniGauge value={m.total_collected} max={m.total_invoiced} label="Collection Progress" color="#22c55e" />
          </CardContent>
        </Card>

        {/* Health Score */}
        <Card
          className="relative cursor-pointer overflow-hidden transition hover:-translate-y-0.5 hover:border-emerald-400/30 hover:shadow-[0_18px_45px_rgba(16,185,129,0.08)]"
          role="button"
          tabIndex={0}
          aria-label="Open billing reconciliation"
          onClick={() => navigate("/billing-recon")}
          onKeyDown={event => { if (event.key === "Enter" || event.key === " ") navigate("/billing-recon"); }}
          data-testid="health-score-card"
        >
          <div className={`absolute top-0 left-0 w-full h-0.5 ${m.payment_health_score >= 80 ? "bg-green-500" : m.payment_health_score >= 60 ? "bg-amber-500" : "bg-red-500"}`} />
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              <Activity className="w-4 h-4" />Payment Health
            </div>
            <HealthGauge score={m.payment_health_score} />
            <p className={`text-center text-xs mt-2 ${healthColor}`}>
              {m.payment_health_score >= 80 ? "Excellent" : m.payment_health_score >= 60 ? "Good" : m.payment_health_score >= 40 ? "Needs Attention" : "Critical"}
            </p>
          </CardContent>
        </Card>

        {/* Collection Streak */}
        <Card
          className={`relative cursor-pointer overflow-hidden transition hover:-translate-y-0.5 hover:border-orange-400/30 hover:shadow-[0_18px_45px_rgba(249,115,22,0.08)] ${streakCfg.ring}`}
          role="button"
          tabIndex={0}
          aria-label="Open invoice collections"
          onClick={() => navigate("/invoices")}
          onKeyDown={event => { if (event.key === "Enter" || event.key === " ") navigate("/invoices"); }}
          data-testid="streak-card"
        >
          <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-orange-500 via-red-500 to-yellow-500" />
          <CardContent className="pt-5 text-center">
            <div className="flex items-center justify-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              <Flame className="w-4 h-4 text-orange-400" />Cash Collection Streak
            </div>
            <div className="relative inline-block">
              <div className={`w-24 h-24 rounded-full ${streakCfg.bg} flex items-center justify-center mx-auto`}>
                <div className="text-center">
                  <Flame className={`w-7 h-7 mx-auto ${streakCfg.color} ${m.streak.current > 0 ? "animate-bounce" : ""}`} />
                  <span className={`text-3xl font-bold ${streakCfg.color}`}>{m.streak.current}</span>
                </div>
              </div>
            </div>
            <p className={`text-sm font-semibold mt-2 ${streakCfg.color}`}>{streakCfg.label}</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              {m.streak.current === 0 ? "Make a collection today to start your streak!" : `${m.streak.current} consecutive day${m.streak.current > 1 ? "s" : ""} with payments`}
            </p>
            <div className="flex items-center justify-center gap-1 mt-2">
              <Trophy className="w-3 h-3 text-yellow-500" />
              <span className="text-[10px] text-muted-foreground">Best: {m.streak.best} days</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <HeroTile label="Total invoiced" value={`$${m.total_invoiced.toLocaleString()}`} icon={DollarSign} glow="cyan" animated={false} onClick={() => navigate("/invoices")} testId="stat-total-invoiced" />
        <HeroTile label="Collected" value={`$${m.total_collected.toLocaleString()}`} icon={CheckCircle} glow="emerald" animated={false} onClick={() => navigate("/invoices")} testId="stat-collected" />
        <HeroTile label="Outstanding" value={`$${m.total_outstanding.toLocaleString()}`} icon={AlertTriangle} glow={m.total_outstanding > 0 ? "rose" : "emerald"} animated={false} onClick={() => navigate("/invoices")} testId="stat-outstanding" />
        <HeroTile label="Collection rate" value={m.collection_rate} suffix="%" icon={Target} glow="emerald" onClick={() => navigate("/invoices")} testId="stat-collection-rate" />
        <HeroTile label="Purchase order spend" value={`$${m.total_po_spend.toLocaleString()}`} icon={ShoppingCart} glow="violet" animated={false} onClick={() => navigate("/purchase-orders")} testId="stat-po-spend" />
        <HeroTile label="Overdue" value={m.overdue_count} icon={Clock} glow={m.overdue_count > 0 ? "rose" : "emerald"} onClick={() => navigate("/invoices")} testId="stat-overdue" />
      </div>

      {/* Row 3: Cash Flow Forecast */}
      <Card
        className="cursor-pointer border-slate-700/40 transition hover:border-cyan-400/25 hover:bg-cyan-400/[0.02]"
        role="button"
        tabIndex={0}
        aria-label="Open finance intelligence"
        onClick={() => navigate("/finance-intel")}
        onKeyDown={event => { if (event.key === "Enter" || event.key === " ") navigate("/finance-intel"); }}
        data-testid="cash-flow-forecast"
      >
        <CardContent className="py-4 px-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <Zap className="w-4 h-4 text-cyan-400" />30-Day Cash Flow Forecast
            </div>
            <Badge variant="outline" className={`text-xs ${m.cash_flow_forecast.net_30d >= 0 ? "text-green-400 border-green-500/30" : "text-red-400 border-red-500/30"}`}>
              Net: ${m.cash_flow_forecast.net_30d.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </Badge>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
            <div className="flex items-center gap-3">
              <ArrowUpRight className="w-5 h-5 text-green-400" />
              <div><p className="text-xs text-muted-foreground">Expected Incoming</p><p className="text-xl font-bold text-green-400 font-mono">${m.cash_flow_forecast.incoming_30d.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p></div>
            </div>
            <div className="flex items-center gap-3">
              <ArrowDownRight className="w-5 h-5 text-red-400" />
              <div><p className="text-xs text-muted-foreground">Expected Outgoing (POs)</p><p className="text-xl font-bold text-red-400 font-mono">${m.cash_flow_forecast.outgoing_30d.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p></div>
            </div>
            <div className="flex items-center gap-3">
              <Banknote className={`w-5 h-5 ${m.cash_flow_forecast.net_30d >= 0 ? "text-green-400" : "text-red-400"}`} />
              <div><p className="text-xs text-muted-foreground">Net Cash Flow</p><p className={`text-xl font-bold font-mono ${m.cash_flow_forecast.net_30d >= 0 ? "text-green-400" : "text-red-400"}`}>${m.cash_flow_forecast.net_30d.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p></div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Row 4: Overdue Alerts + Monthly Trend */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        {/* Overdue Alerts */}
        <Card className="border-red-500/10 xl:col-span-7" data-testid="overdue-alerts-card">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400" />Overdue Alerts
                {m.overdue_count > 0 && <Badge className="bg-red-500/20 text-red-400 text-[10px]">{m.overdue_count}</Badge>}
              </CardTitle>
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => navigate("/invoices")}>View All<ChevronRight className="w-3 h-3 ml-1" /></Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {m.overdue_alerts.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-400 opacity-50" />
                No overdue invoices - great job!
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Invoice</TableHead><TableHead>Client</TableHead><TableHead className="text-right">Balance</TableHead><TableHead>Overdue</TableHead><TableHead></TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {m.overdue_alerts.slice(0, 8).map(alert => (
                    <TableRow key={alert.id} data-testid={`overdue-alert-${alert.id}`}>
                      <TableCell className="font-mono text-sm">{alert.invoice_number}</TableCell>
                      <TableCell className="text-sm">{alert.client_name}</TableCell>
                      <TableCell className="text-right font-mono text-sm text-red-400">${alert.balance.toFixed(2)}</TableCell>
                      <TableCell>
                        <Badge className={SEVERITY_CONFIG[alert.severity]?.class + " text-[10px]"}>
                          {alert.days_overdue}d
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" className="h-7 text-xs text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
                          onClick={() => handleChase(alert.id)} disabled={chasingId === alert.id} data-testid={`chase-btn-${alert.id}`}>
                          {chasingId === alert.id ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Send className="w-3 h-3 mr-1" />}
                          Chase
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Monthly Trend */}
        <Card className="xl:col-span-5" data-testid="monthly-trend-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="w-4 h-4 text-blue-400" />Monthly Revenue Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {m.monthly_trend.map((month, i) => {
                const maxVal = Math.max(...m.monthly_trend.map(x => Math.max(x.invoiced, x.collected)), 1);
                const invPct = (month.invoiced / maxVal) * 100;
                const colPct = (month.collected / maxVal) * 100;
                return (
                  <div key={`k-${i}`} className="space-y-0.5">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-muted-foreground w-14">{month.month}</span>
                      <span className="text-muted-foreground">
                        <span className="text-blue-400">${month.invoiced.toLocaleString()}</span>
                        <span className="mx-1">/</span>
                        <span className="text-green-400">${month.collected.toLocaleString()}</span>
                      </span>
                    </div>
                    <div className="relative h-4 bg-muted/10 rounded overflow-hidden">
                      <div className="absolute inset-y-0 left-0 bg-blue-500/25 rounded transition-all duration-700" style={{ width: `${invPct}%` }} />
                      <div className="absolute inset-y-0 left-0 bg-green-500/50 rounded transition-all duration-700" style={{ width: `${colPct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 mt-3 text-[10px] text-muted-foreground">
              <div className="flex items-center gap-1"><div className="w-3 h-2 rounded bg-blue-500/25" />Invoiced</div>
              <div className="flex items-center gap-1"><div className="w-3 h-2 rounded bg-green-500/50" />Collected</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 5: Top Debtors + Recent Payments */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        {/* Top Debtors */}
        <Card className="xl:col-span-5" data-testid="top-debtors-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Users className="w-4 h-4 text-red-400" />Top Debtors</CardTitle>
          </CardHeader>
          <CardContent>
            {m.top_debtors.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-sm">No outstanding balances</div>
            ) : (
              <div className="space-y-2">
                {m.top_debtors.map((d, i) => {
                  const maxDebt = m.top_debtors[0]?.balance || 1;
                  const pct = (d.balance / maxDebt) * 100;
                  return (
                    <button
                      type="button"
                      key={`${d.client_id || d.client}-${i}`}
                      className="flex w-full items-center gap-3 rounded-lg p-1.5 text-left transition hover:bg-white/[0.035] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-rose-300"
                      onClick={() => d.client_id ? navigate(`/clients?client=${encodeURIComponent(d.client_id)}`) : navigate("/invoices")}
                      data-testid={`debtor-${i}`}
                    >
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                        i === 0 ? "bg-red-500/20 text-red-400" : i < 3 ? "bg-orange-500/20 text-orange-400" : "bg-muted/30 text-muted-foreground"
                      }`}>{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium truncate">{d.client}</span>
                          <span className="font-mono text-red-400 ml-2">${d.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                        </div>
                        <div className="h-1 bg-muted/10 rounded-full overflow-hidden mt-0.5">
                          <div className="h-full bg-red-500/30 rounded-full transition-all duration-700" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                      <span className="text-[10px] text-muted-foreground">{d.invoices} inv</span>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Payments */}
        <Card className="xl:col-span-7" data-testid="recent-payments-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Banknote className="w-4 h-4 text-green-400" />Recent Payments</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {m.recent_payments.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">No payments recorded yet</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Invoice</TableHead><TableHead>Client</TableHead><TableHead>Method</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Amount</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {m.recent_payments.slice(0, 8).map((p, i) => (
                    <TableRow
                      key={`${p.invoice_id || p.invoice_number}-${i}`}
                      className={p.invoice_id ? "cursor-pointer hover:bg-emerald-500/[0.04]" : ""}
                      onClick={() => p.invoice_id && navigate(`/invoices?invoice=${encodeURIComponent(p.invoice_id)}`)}
                    >
                      <TableCell className="font-mono text-sm">{p.invoice_number}</TableCell>
                      <TableCell className="text-sm">{p.client_name}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px] capitalize">{(p.method || "").replace(/_/g, " ")}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatPaymentDate(p.date)}</TableCell>
                      <TableCell className="text-right font-mono text-green-400">${p.amount.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Invoice Pipeline */}
      <Card data-testid="invoice-pipeline">
        <CardContent className="py-4 px-5">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            <FileText className="w-4 h-4" />Invoice Pipeline
          </div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {[
              { label: "Draft", count: m.counts.draft, color: "bg-gray-500/20 text-gray-400 border-gray-500/30" },
              { label: "Sent", count: m.counts.sent, color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
              { label: "Overdue", count: m.counts.overdue, color: "bg-red-500/20 text-red-400 border-red-500/30" },
              { label: "Paid", count: m.counts.paid, color: "bg-green-500/20 text-green-400 border-green-500/30" },
            ].map(stage => (
              <button
                type="button"
                key={stage.label}
                className={`rounded-lg border p-3 text-center transition hover:-translate-y-0.5 hover:brightness-125 ${stage.color}`}
                onClick={() => navigate("/invoices")}
                aria-label={`Open ${stage.label.toLowerCase()} invoices`}
                data-testid={`invoice-pipeline-${stage.label.toLowerCase()}`}
              >
                  <p className="text-2xl font-bold">{stage.count}</p>
                  <p className="text-[10px] uppercase tracking-wider">{stage.label}</p>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
