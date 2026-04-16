import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Loader2, DollarSign, TrendingUp, AlertTriangle, CheckCircle,
  Clock, CreditCard, Flame, Zap, Send, ArrowUpRight, ArrowDownRight,
  BarChart3, Users, FileText, Receipt, ShoppingCart, Target, Banknote,
  Trophy, ChevronRight, Activity
} from "lucide-react";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";

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
  const [chasingId, setChasingId] = useState(null);
  const navigate = useNavigate();
  const headers = { Authorization: `Bearer ${token}` };

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/billing-dashboard/metrics`, { headers });
      setMetrics(res.data);
    } catch { toast.error("Failed to load billing metrics"); }
    finally { setLoading(false); }
  }, [token]);

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

  if (loading || !metrics) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  }

  const m = metrics;
  const streakCfg = STREAK_CONFIG[m.streak.level] || STREAK_CONFIG.starter;
  const healthColor = m.payment_health_score >= 80 ? "text-green-400" : m.payment_health_score >= 60 ? "text-amber-400" : m.payment_health_score >= 40 ? "text-orange-400" : "text-red-400";

  return (
    <div className="space-y-6" data-testid="billing-dashboard">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Billing Command Center</h1>
          <p className="text-muted-foreground">Real-time financial pulse of your MSP</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate("/invoices")} data-testid="go-to-invoices">
            <Receipt className="w-4 h-4 mr-1" />Invoices
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate("/purchase-orders")} data-testid="go-to-pos">
            <ShoppingCart className="w-4 h-4 mr-1" />Purchase Orders
          </Button>
        </div>
      </div>

      {/* Row 1: MRR/ARR + Health + Streak */}
      <div className="grid grid-cols-12 gap-4">
        {/* MRR/ARR */}
        <Card className="col-span-4 border-purple-500/20 overflow-hidden relative" data-testid="mrr-arr-card">
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
        <Card className="col-span-4 overflow-hidden relative" data-testid="health-score-card">
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
        <Card className={`col-span-4 overflow-hidden relative ${streakCfg.ring}`} data-testid="streak-card">
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
        <Card className="cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => navigate("/invoices")} data-testid="stat-total-invoiced">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center"><DollarSign className="w-4 h-4 text-blue-400" /></div>
              <div><p className="text-[10px] text-muted-foreground">Total Invoiced</p><p className="text-lg font-bold font-mono">${m.total_invoiced.toLocaleString()}</p></div>
            </div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => navigate("/invoices")} data-testid="stat-collected">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center"><CheckCircle className="w-4 h-4 text-green-400" /></div>
              <div><p className="text-[10px] text-muted-foreground">Collected</p><p className="text-lg font-bold font-mono text-green-400">${m.total_collected.toLocaleString()}</p></div>
            </div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:bg-muted/30 transition-colors" data-testid="stat-outstanding">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center"><AlertTriangle className="w-4 h-4 text-red-400" /></div>
              <div><p className="text-[10px] text-muted-foreground">Outstanding</p><p className="text-lg font-bold font-mono text-red-400">${m.total_outstanding.toLocaleString()}</p></div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="stat-collection-rate">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center"><Target className="w-4 h-4 text-emerald-400" /></div>
              <div><p className="text-[10px] text-muted-foreground">Collection Rate</p><p className="text-lg font-bold font-mono text-emerald-400">{m.collection_rate}%</p></div>
            </div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => navigate("/purchase-orders")} data-testid="stat-po-spend">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center"><ShoppingCart className="w-4 h-4 text-purple-400" /></div>
              <div><p className="text-[10px] text-muted-foreground">PO Spend</p><p className="text-lg font-bold font-mono">${m.total_po_spend.toLocaleString()}</p></div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="stat-overdue">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${m.overdue_count > 0 ? "bg-red-500/10" : "bg-green-500/10"}`}>
                {m.overdue_count > 0 ? <Clock className="w-4 h-4 text-red-400 animate-pulse" /> : <CheckCircle className="w-4 h-4 text-green-400" />}
              </div>
              <div><p className="text-[10px] text-muted-foreground">Overdue</p><p className={`text-lg font-bold font-mono ${m.overdue_count > 0 ? "text-red-400" : "text-green-400"}`}>{m.overdue_count}</p></div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 3: Cash Flow Forecast */}
      <Card className="border-slate-700/40" data-testid="cash-flow-forecast">
        <CardContent className="py-4 px-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <Zap className="w-4 h-4 text-cyan-400" />30-Day Cash Flow Forecast
            </div>
            <Badge variant="outline" className={`text-xs ${m.cash_flow_forecast.net_30d >= 0 ? "text-green-400 border-green-500/30" : "text-red-400 border-red-500/30"}`}>
              Net: ${m.cash_flow_forecast.net_30d.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </Badge>
          </div>
          <div className="grid grid-cols-3 gap-6 mt-3">
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
      <div className="grid grid-cols-12 gap-4">
        {/* Overdue Alerts */}
        <Card className="col-span-7 border-red-500/10" data-testid="overdue-alerts-card">
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
        <Card className="col-span-5" data-testid="monthly-trend-card">
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
      <div className="grid grid-cols-12 gap-4">
        {/* Top Debtors */}
        <Card className="col-span-5" data-testid="top-debtors-card">
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
                    <div key={`k-${i}`} className="flex items-center gap-3" data-testid={`debtor-${i}`}>
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
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Payments */}
        <Card className="col-span-7" data-testid="recent-payments-card">
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
                    <TableRow key={`k-${i}`}>
                      <TableCell className="font-mono text-sm">{p.invoice_number}</TableCell>
                      <TableCell className="text-sm">{p.client_name}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px] capitalize">{(p.method || "").replace(/_/g, " ")}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{p.date ? format(new Date(p.date), "MMM d, HH:mm") : "-"}</TableCell>
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
          <div className="flex items-center gap-2">
            {[
              { label: "Draft", count: m.counts.draft, color: "bg-gray-500/20 text-gray-400 border-gray-500/30" },
              { label: "Sent", count: m.counts.sent, color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
              { label: "Overdue", count: m.counts.overdue, color: "bg-red-500/20 text-red-400 border-red-500/30" },
              { label: "Paid", count: m.counts.paid, color: "bg-green-500/20 text-green-400 border-green-500/30" },
            ].map((stage, i, arr) => (
              <div key={stage.label} className="flex items-center gap-2 flex-1">
                <div className={`flex-1 p-3 rounded-lg border ${stage.color} text-center`}>
                  <p className="text-2xl font-bold">{stage.count}</p>
                  <p className="text-[10px] uppercase tracking-wider">{stage.label}</p>
                </div>
                {i < arr.length - 1 && <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
