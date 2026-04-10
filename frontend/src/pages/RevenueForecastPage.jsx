import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DollarSign, TrendingUp, AlertTriangle, Users } from "lucide-react";

export default function RevenueForecastPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    axios.get(`${API}/revenue-forecast/dashboard`, { headers }).then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!data) return null;
  const { summary, forecast, churn_risks } = data;

  return (
    <div className="space-y-6" data-testid="revenue-forecast-page">
      <div><h1 className="text-2xl font-bold tracking-tight">Recurring Revenue Forecaster</h1>
        <p className="text-muted-foreground text-sm mt-1">MRR/ARR projections with churn prediction</p></div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card><CardContent className="pt-4 pb-3 text-center"><DollarSign className="w-5 h-5 mx-auto mb-1 text-green-500" />
          <p className="text-xl font-bold">${summary.current_mrr.toLocaleString()}</p><p className="text-xs text-muted-foreground">Current MRR</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><DollarSign className="w-5 h-5 mx-auto mb-1 text-blue-500" />
          <p className="text-xl font-bold">${summary.current_arr.toLocaleString()}</p><p className="text-xs text-muted-foreground">Current ARR</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><TrendingUp className="w-5 h-5 mx-auto mb-1 text-emerald-500" />
          <p className="text-xl font-bold">${summary.projected_arr_12m.toLocaleString()}</p><p className="text-xs text-muted-foreground">Projected ARR (12m)</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><Users className="w-5 h-5 mx-auto mb-1 text-primary" />
          <p className="text-xl font-bold">{summary.total_clients}</p><p className="text-xs text-muted-foreground">Total Clients</p></CardContent></Card>
        <Card className="border-red-500/30"><CardContent className="pt-4 pb-3 text-center"><AlertTriangle className="w-5 h-5 mx-auto mb-1 text-red-500" />
          <p className="text-xl font-bold text-red-500">{summary.churn_risks}</p><p className="text-xs text-muted-foreground">Churn Risks</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">12-Month MRR Forecast</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Month</TableHead><TableHead className="text-right">MRR</TableHead><TableHead className="text-right">ARR</TableHead><TableHead className="text-right">Growth</TableHead></TableRow></TableHeader>
            <TableBody>
              {forecast.map((f, i) => (
                <TableRow key={`k-${i}`} data-testid={`forecast-row-${i}`}>
                  <TableCell className="font-medium">{f.month}</TableCell>
                  <TableCell className="text-right font-mono">${f.mrr.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono">${f.arr.toLocaleString()}</TableCell>
                  <TableCell className={`text-right ${f.growth_pct >= 0 ? "text-green-500" : "text-red-500"}`}>{f.growth_pct > 0 ? "+" : ""}{f.growth_pct}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {churn_risks.length > 0 && (
        <Card className="border-red-500/30">
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-red-500" />Churn Risk Clients</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Client</TableHead><TableHead>MRR</TableHead><TableHead>Open Tickets</TableHead><TableHead>Sentiment</TableHead><TableHead>Risk</TableHead></TableRow></TableHeader>
              <TableBody>
                {churn_risks.map(c => (
                  <TableRow key={c.client_id} data-testid={`churn-${c.client_id}`}>
                    <TableCell className="font-medium">{c.client_name}</TableCell>
                    <TableCell className="font-mono">${c.mrr.toLocaleString()}</TableCell>
                    <TableCell>{c.open_tickets}</TableCell>
                    <TableCell className={c.sentiment < 50 ? "text-red-500" : "text-amber-500"}>{c.sentiment}/100</TableCell>
                    <TableCell><Badge variant={c.risk === "high" ? "destructive" : "secondary"} className="capitalize">{c.risk}</Badge></TableCell>
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
