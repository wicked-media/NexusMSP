import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { DollarSign, TrendingUp, AlertTriangle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

export default function ClientBudgetPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const headers = { Authorization: `Bearer ${token}` };
  useEffect(() => { axios.get(`${API}/client-budget/overview`, { headers }).then(r => setData(r.data)); }, []);

  if (!data) return <div className="p-6 text-muted-foreground">Loading...</div>;
  const s = data.summary;
  return (
    <div className="space-y-6" data-testid="client-budget-page">
      <div><h1 className="text-2xl font-bold">Client Budget Tracker</h1><p className="text-muted-foreground text-sm">Track IT budgets, spending, and forecast overruns per client</p></div>
      <div className="grid grid-cols-4 gap-4">
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Total Annual Budget</div><div className="text-2xl font-bold mt-1">${(s.total_annual_budget / 1000).toFixed(0)}k</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">YTD Spent</div><div className="text-2xl font-bold mt-1">${(s.total_ytd_spent / 1000).toFixed(0)}k</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Avg Utilization</div><div className="text-2xl font-bold mt-1">{s.avg_utilization_pct}%</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground flex items-center gap-1"><AlertTriangle className="w-4 h-4 text-red-500" />Over Budget</div><div className="text-2xl font-bold text-red-500 mt-1">{s.clients_over_budget}</div></CardContent></Card>
      </div>
      <Card><CardHeader className="pb-2"><CardTitle className="text-base">Budget vs Spend by Client</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data.budgets}>
              <XAxis dataKey="client_name" tick={{ fontSize: 10 }} angle={-15} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${v/1000}k`} />
              <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, color: 'hsl(var(--card-foreground))' }} formatter={v => `$${v.toLocaleString()}`} />
              <Bar dataKey="annual_budget" fill="#3b82f6" name="Annual Budget" radius={[4, 4, 0, 0]} />
              <Bar dataKey="ytd_spent" fill="#22c55e" name="YTD Spent" radius={[4, 4, 0, 0]} />
              <Bar dataKey="forecast_eoy" fill="#f59e0b" name="EOY Forecast" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <div className="space-y-3">
        {data.budgets.map(b => (
          <Card key={b.id}><CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div><h3 className="font-semibold">{b.client_name}</h3><div className="text-sm text-muted-foreground">Budget: ${b.annual_budget.toLocaleString()} | Spent: ${b.ytd_spent.toLocaleString()} | Forecast: ${b.forecast_eoy.toLocaleString()}</div></div>
              <Badge variant={b.status === "over_budget" ? "destructive" : "default"}>{b.status.replace("_", " ")}</Badge>
            </div>
            <Progress value={b.ytd_spent / b.annual_budget * 100} className="mt-2 h-2" />
            <div className="grid grid-cols-4 gap-2 mt-3">
              {b.categories.map(c => (
                <div key={c.name} className="text-xs"><span className="text-muted-foreground">{c.name}:</span> ${c.spent.toLocaleString()} / ${c.budget.toLocaleString()}</div>
              ))}
            </div>
          </CardContent></Card>
        ))}
      </div>
    </div>
  );
}
