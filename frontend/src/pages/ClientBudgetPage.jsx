import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { DollarSign, TrendingUp, AlertTriangle, Loader2, Target, BarChart3, PieChart, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

export default function ClientBudgetPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    axios.get(`${API}/client-budget/overview`, { headers }).then(r => setData(r.data)).catch(() => toast.error("Failed")).finally(() => setLoading(false));
  }, []);

  if (loading || !data) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const s = data.summary;
  const budgets = data.budgets;
  const onTrack = budgets.filter(b => b.status === "on_track").length;
  const overBudget = budgets.filter(b => b.status === "over_budget");
  const totalRemaining = budgets.reduce((sum, b) => sum + Math.max(0, b.annual_budget - b.ytd_spent), 0);

  return (
    <div className="space-y-5" data-testid="client-budget-page">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-green-500 flex items-center justify-center"><DollarSign className="w-5 h-5 text-white" /></div>
          Client IT Budget Tracker
        </h1>
        <p className="text-muted-foreground mt-1">Track IT budgets, spending by category, and forecast overruns per client</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-6 gap-3">
        {[
          { label: "Annual Budget", value: `$${(s.total_annual_budget / 1000).toFixed(0)}k`, icon: DollarSign, color: "text-foreground" },
          { label: "YTD Spent", value: `$${(s.total_ytd_spent / 1000).toFixed(0)}k`, icon: TrendingUp, color: "text-blue-400" },
          { label: "Remaining", value: `$${(totalRemaining / 1000).toFixed(0)}k`, icon: Target, color: "text-emerald-400" },
          { label: "Avg Utilization", value: `${s.avg_utilization_pct}%`, icon: BarChart3, color: s.avg_utilization_pct > 90 ? "text-amber-400" : "text-cyan-400" },
          { label: "On Track", value: onTrack, icon: Target, color: "text-emerald-400" },
          { label: "Over Budget", value: s.clients_over_budget, icon: AlertTriangle, color: s.clients_over_budget > 0 ? "text-red-400" : "text-emerald-400" },
        ].map(st => (
          <Card key={st.label} className="border-border/40">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-1"><p className="text-xs text-muted-foreground uppercase tracking-wider">{st.label}</p><st.icon className={`w-4 h-4 ${st.color}`} /></div>
              <p className={`text-2xl font-bold ${st.color}`}>{st.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Chart */}
      <Card className="border-border/40">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Budget vs Spend Comparison</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={budgets}>
              <XAxis dataKey="client_name" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} angle={-15} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={v => `$${v / 1000}k`} />
              <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, color: 'hsl(var(--card-foreground))' }} formatter={v => `$${v.toLocaleString()}`} />
              <Bar dataKey="annual_budget" fill="#3b82f6" name="Annual Budget" radius={[4, 4, 0, 0]} />
              <Bar dataKey="ytd_spent" fill="#22c55e" name="YTD Spent" radius={[4, 4, 0, 0]} />
              <Bar dataKey="forecast_eoy" fill="#f59e0b" name="EOY Forecast" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Client Budget Cards */}
      <div className="space-y-3">
        {budgets.sort((a, b) => (b.ytd_spent / b.annual_budget) - (a.ytd_spent / a.annual_budget)).map(b => {
          const pct = Math.round(b.ytd_spent / b.annual_budget * 100);
          const isOver = b.status === "over_budget";
          const isExpanded = expandedId === b.id;
          const forecastOverBudget = b.forecast_eoy > b.annual_budget;
          return (
            <Card key={b.id} className={`border-border/40 cursor-pointer transition-all hover:shadow-md ${isOver ? "border-red-500/20" : ""}`} onClick={() => setExpandedId(isExpanded ? null : b.id)} data-testid={`budget-${b.id}`}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isOver ? "bg-red-500/10" : "bg-emerald-500/10"}`}>
                      {isOver ? <AlertTriangle className="w-4 h-4 text-red-400" /> : <DollarSign className="w-4 h-4 text-emerald-400" />}
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm">{b.client_name}</h3>
                      <p className="text-xs text-muted-foreground">Budget: ${b.annual_budget.toLocaleString()} | Monthly: ${b.monthly_budget?.toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge className={isOver ? "bg-red-500/15 text-red-400" : "bg-emerald-500/15 text-emerald-400"}>{b.status.replace("_", " ")}</Badge>
                    {forecastOverBudget && <Badge className="bg-amber-500/15 text-amber-400 text-[10px]"><ArrowUpRight className="w-3 h-3 mr-1" />Forecast over</Badge>}
                  </div>
                </div>
                <div className="flex items-center gap-3 mb-2">
                  <Progress value={Math.min(pct, 100)} className={`flex-1 h-2.5 ${pct > 100 ? "[&>div]:bg-red-500" : pct > 80 ? "[&>div]:bg-amber-500" : ""}`} />
                  <span className={`text-sm font-bold ${pct > 100 ? "text-red-400" : pct > 80 ? "text-amber-400" : "text-emerald-400"}`}>{pct}%</span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Spent: ${b.ytd_spent.toLocaleString()}</span>
                  <span>Remaining: ${Math.max(0, b.annual_budget - b.ytd_spent).toLocaleString()}</span>
                  <span>Forecast EOY: ${b.forecast_eoy.toLocaleString()}</span>
                </div>
                {isExpanded && (
                  <>
                    <Separator className="my-3" />
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Spend by Category</p>
                    <div className="grid grid-cols-4 gap-3">
                      {(b.categories || []).map(c => {
                        const catPct = c.budget ? Math.round(c.spent / c.budget * 100) : 0;
                        return (
                          <div key={c.name} className="p-2.5 rounded-lg border border-border/30">
                            <p className="text-xs font-semibold">{c.name}</p>
                            <Progress value={Math.min(catPct, 100)} className={`h-1.5 my-1 ${catPct > 100 ? "[&>div]:bg-red-500" : ""}`} />
                            <div className="flex justify-between text-[10px] text-muted-foreground">
                              <span>${c.spent.toLocaleString()}</span>
                              <span className={catPct > 100 ? "text-red-400 font-bold" : ""}>{catPct}%</span>
                              <span>${c.budget.toLocaleString()}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
