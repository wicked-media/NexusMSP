import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DollarSign, TrendingUp, TrendingDown, BarChart3 } from "lucide-react";

const statusColors = { highly_profitable: "text-green-500", profitable: "text-green-400", marginal: "text-amber-500", unprofitable: "text-red-500" };

export default function ProfitabilityHeatmapPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    axios.get(`${API}/profitability-heatmap/data`, { headers }).then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!data) return null;

  return (
    <div className="space-y-6" data-testid="profitability-heatmap-page">
      <div><h1 className="text-2xl font-bold tracking-tight">Client Profitability Heatmap</h1>
        <p className="text-muted-foreground text-sm mt-1">Visual profit/loss grid across all clients</p></div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        <Card><CardContent className="pt-4 pb-3 text-center"><p className="text-xl font-bold">{data.summary.total_clients}</p><p className="text-xs text-muted-foreground">Clients</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><p className="text-xl font-bold">${data.summary.total_mrr.toLocaleString()}</p><p className="text-xs text-muted-foreground">MRR</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><p className="text-xl font-bold">${data.summary.total_cost.toLocaleString()}</p><p className="text-xs text-muted-foreground">Cost</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><p className={`text-xl font-bold ${data.summary.total_profit >= 0 ? "text-green-500" : "text-red-500"}`}>${data.summary.total_profit.toLocaleString()}</p><p className="text-xs text-muted-foreground">Net Profit</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><p className="text-xl font-bold">{data.summary.avg_margin}%</p><p className="text-xs text-muted-foreground">Avg Margin</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><TrendingUp className="w-4 h-4 mx-auto mb-1 text-green-500" /><p className="text-xl font-bold text-green-500">{data.summary.profitable}</p><p className="text-xs text-muted-foreground">Profitable</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><TrendingDown className="w-4 h-4 mx-auto mb-1 text-red-500" /><p className="text-xl font-bold text-red-500">{data.summary.unprofitable}</p><p className="text-xs text-muted-foreground">Unprofitable</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Profitability Grid</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {data.clients.map(c => (
              <div key={c.client_id} className={`p-4 rounded-lg border-2 ${c.margin_pct > 50 ? "border-green-500 bg-green-500/5" : c.margin_pct > 20 ? "border-green-400/50 bg-green-400/5" : c.margin_pct > 0 ? "border-amber-500/50 bg-amber-500/5" : "border-red-500 bg-red-500/5"}`}
                data-testid={`profit-card-${c.client_id}`}>
                <p className="font-medium text-sm mb-1 truncate">{c.client_name}</p>
                <p className={`text-lg font-bold ${statusColors[c.status]}`}>{c.margin_pct}%</p>
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>Rev: ${c.mrr.toLocaleString()}</span>
                  <span>Cost: ${c.cost.toLocaleString()}</span>
                </div>
                <p className={`text-xs font-medium mt-1 ${c.profit >= 0 ? "text-green-500" : "text-red-500"}`}>Profit: ${c.profit.toLocaleString()}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Detailed Breakdown</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Industry</TableHead><TableHead>MRR</TableHead><TableHead>Cost</TableHead><TableHead>Profit</TableHead><TableHead>Margin</TableHead><TableHead>Devices</TableHead><TableHead>Tickets</TableHead></TableRow></TableHeader>
            <TableBody>{data.clients.map(c => (
              <TableRow key={c.client_id} data-testid={`profit-row-${c.client_id}`}>
                <TableCell className="font-medium">{c.client_name}</TableCell>
                <TableCell className="text-xs">{c.industry}</TableCell>
                <TableCell className="font-mono">${c.mrr.toLocaleString()}</TableCell>
                <TableCell className="font-mono">${c.cost.toLocaleString()}</TableCell>
                <TableCell className={`font-mono font-bold ${c.profit >= 0 ? "text-green-500" : "text-red-500"}`}>${c.profit.toLocaleString()}</TableCell>
                <TableCell><span className={statusColors[c.status]}>{c.margin_pct}%</span></TableCell>
                <TableCell>{c.devices}</TableCell>
                <TableCell>{c.tickets}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
