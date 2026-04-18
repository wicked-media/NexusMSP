import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, DollarSign, TrendingUp, AlertTriangle, Users, BarChart3 } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

export default function RevenueForecastPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    axios.get(`${API}/revenue-forecast/dashboard`, { headers }).then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  if (!data) return null;
  const { summary, forecast, churn_risks } = data;

  return (
    <div className="space-y-5" data-testid="revenue-forecast-page">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Revenue Forecaster</h1>
        <p className="text-sm text-muted-foreground">MRR/ARR projections with churn prediction and growth analysis</p>
      </div>

      <div className="grid grid-cols-5 gap-3">
        <Card><CardContent className="pt-4 pb-3"><DollarSign className="w-5 h-5 text-emerald-400 mb-1" /><p className="text-2xl font-bold">${summary.current_mrr.toLocaleString()}</p><p className="text-[11px] text-muted-foreground">Current MRR</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><DollarSign className="w-5 h-5 text-blue-400 mb-1" /><p className="text-2xl font-bold">${summary.current_arr.toLocaleString()}</p><p className="text-[11px] text-muted-foreground">Current ARR</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><TrendingUp className="w-5 h-5 text-emerald-400 mb-1" /><p className="text-2xl font-bold">${summary.projected_arr_12m.toLocaleString()}</p><p className="text-[11px] text-muted-foreground">Projected ARR (12m)</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><Users className="w-5 h-5 text-primary mb-1" /><p className="text-2xl font-bold">{summary.total_clients}</p><p className="text-[11px] text-muted-foreground">Total Clients</p></CardContent></Card>
        <Card className="border-red-500/20"><CardContent className="pt-4 pb-3"><AlertTriangle className="w-5 h-5 text-red-400 mb-1" /><p className="text-2xl font-bold text-red-400">{summary.churn_risks}</p><p className="text-[11px] text-muted-foreground">Churn Risks</p></CardContent></Card>
      </div>

      {/* MRR Forecast Chart */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><BarChart3 className="w-4 h-4" />12-Month MRR Projection</CardTitle></CardHeader>
        <CardContent>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
              <AreaChart data={forecast}>
                <defs>
                  <linearGradient id="mrrGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="month" tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "#64748b", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0" }} formatter={(v) => [`$${v.toLocaleString()}`, "MRR"]} />
                <Area type="monotone" dataKey="mrr" stroke="#10b981" strokeWidth={2} fill="url(#mrrGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        {/* Forecast Table */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Monthly Projections</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Month</TableHead><TableHead className="text-right">MRR</TableHead><TableHead className="text-right">ARR</TableHead><TableHead className="text-right">Growth</TableHead></TableRow></TableHeader>
              <TableBody>
                {forecast.map((f, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium text-sm">{f.month}</TableCell>
                    <TableCell className="text-right font-mono text-sm">${f.mrr.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono text-sm">${f.arr.toLocaleString()}</TableCell>
                    <TableCell className={`text-right text-sm ${f.growth_pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>{f.growth_pct > 0 ? "+" : ""}{f.growth_pct}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Churn Risks */}
        <Card className={churn_risks.length > 0 ? "border-red-500/20" : ""}>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-red-400" />Churn Risk Clients</CardTitle></CardHeader>
          <CardContent>
            {churn_risks.length > 0 ? (
              <Table>
                <TableHeader><TableRow><TableHead>Client</TableHead><TableHead className="text-right">MRR</TableHead><TableHead className="text-center">Tickets</TableHead><TableHead className="text-center">Sentiment</TableHead><TableHead>Risk</TableHead></TableRow></TableHeader>
                <TableBody>
                  {churn_risks.map(c => (
                    <TableRow key={c.client_id}>
                      <TableCell className="font-medium text-sm">{c.client_name}</TableCell>
                      <TableCell className="text-right font-mono text-sm">${c.mrr.toLocaleString()}</TableCell>
                      <TableCell className="text-center">{c.open_tickets}</TableCell>
                      <TableCell className="text-center"><span className={c.sentiment < 50 ? "text-red-400" : "text-amber-400"}>{c.sentiment}/100</span></TableCell>
                      <TableCell><Badge variant={c.risk === "high" ? "destructive" : "secondary"} className="text-[10px] capitalize">{c.risk}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-center text-muted-foreground py-8">No churn risks detected</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
