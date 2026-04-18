import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, DollarSign, TrendingUp, AlertTriangle, PieChart } from "lucide-react";

const CAT_COLORS = { Hardware: "bg-blue-500", "Software/Licenses": "bg-violet-500", "Labor/Support": "bg-emerald-500", Projects: "bg-amber-500" };

export default function ClientBudgetPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get(`${API}/client-budget/overview`, { headers }).then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  if (!data) return null;
  const s = data.summary;

  return (
    <div className="space-y-5" data-testid="client-budget-page">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Client IT Budget Tracker</h1>
        <p className="text-sm text-muted-foreground">Track annual IT budgets, spend by category, and forecast end-of-year totals</p>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Card><CardContent className="pt-4 pb-3"><DollarSign className="w-5 h-5 text-blue-400 mb-1" /><p className="text-2xl font-bold">${(s.total_annual_budget / 1000).toFixed(0)}k</p><p className="text-[11px] text-muted-foreground">Total Annual Budget</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><TrendingUp className="w-5 h-5 text-emerald-400 mb-1" /><p className="text-2xl font-bold">${(s.total_ytd_spent / 1000).toFixed(0)}k</p><p className="text-[11px] text-muted-foreground">YTD Spent</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><PieChart className="w-5 h-5 text-violet-400 mb-1" /><p className="text-2xl font-bold">{s.avg_utilization_pct}%</p><p className="text-[11px] text-muted-foreground">Avg Utilization</p></CardContent></Card>
        <Card className="border-red-500/20"><CardContent className="pt-4 pb-3"><AlertTriangle className="w-5 h-5 text-red-400 mb-1" /><p className="text-2xl font-bold text-red-400">{s.clients_over_budget}</p><p className="text-[11px] text-muted-foreground">Over Budget Pace</p></CardContent></Card>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {data.budgets.map(b => {
          const pct = b.annual_budget > 0 ? Math.round(b.ytd_spent / b.annual_budget * 100) : 0;
          const monthPct = Math.round((new Date().getMonth() + 1) / 12 * 100);
          const isOverPace = pct > monthPct + 5;
          const forecastPct = b.annual_budget > 0 ? Math.round(b.forecast_eoy / b.annual_budget * 100) : 0;

          return (
            <Card key={b.id} className={isOverPace ? "border-red-500/20" : ""} data-testid={`budget-${b.id}`}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">{b.client_name}</CardTitle>
                  <Badge variant={b.status === "over_budget" ? "destructive" : "default"} className="text-[10px] capitalize">{(b.status || "on_track").replace("_", " ")}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Overall progress */}
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">YTD Spend: ${b.ytd_spent.toLocaleString()} / ${b.annual_budget.toLocaleString()}</span>
                    <span className={isOverPace ? "text-red-400 font-semibold" : "text-muted-foreground"}>{pct}%</span>
                  </div>
                  <Progress value={Math.min(pct, 100)} className="h-2" />
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                    <span>Monthly: ${b.monthly_spent?.toLocaleString()} / ${b.monthly_budget?.toLocaleString()}</span>
                    <span>Forecast EOY: ${b.forecast_eoy?.toLocaleString()} ({forecastPct}%)</span>
                  </div>
                </div>

                {/* Category breakdown */}
                <div className="space-y-1.5">
                  {(b.categories || []).map(cat => {
                    const catPct = cat.budget > 0 ? Math.round(cat.spent / cat.budget * 100) : 0;
                    return (
                      <div key={cat.name} className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${CAT_COLORS[cat.name] || "bg-gray-400"}`} />
                        <span className="text-[11px] w-28 text-muted-foreground">{cat.name}</span>
                        <div className="flex-1"><Progress value={Math.min(catPct, 100)} className="h-1.5" /></div>
                        <span className="text-[10px] font-mono w-16 text-right">${(cat.spent / 1000).toFixed(1)}k</span>
                        <span className="text-[10px] text-muted-foreground w-8 text-right">{catPct}%</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
