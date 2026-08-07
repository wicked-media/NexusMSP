import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { DollarSign, TrendingUp, TrendingDown, AlertTriangle, Loader2, RefreshCw, ArrowUpRight, ArrowDownRight } from "lucide-react";

export default function ProfitabilityHeatmapPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/profitability-heatmap/data`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setData(res.data);
    } catch { toast.error("Failed to load profitability data"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading || !data) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const { summary, clients } = data;
  const marginColor = (m) => m > 50 ? "text-emerald-400" : m > 20 ? "text-blue-400" : m > 0 ? "text-amber-400" : "text-red-400";
  const statusBg = (s) => s === "highly_profitable" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : s === "profitable" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" : s === "marginal" ? "bg-amber-500/10 text-amber-400 border-amber-500/20" : "bg-red-500/10 text-red-400 border-red-500/20";

  return (
    <div className="space-y-5" data-testid="profitability-page">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><DollarSign className="w-6 h-6 text-emerald-400" />Client Profitability</h1><p className="text-muted-foreground mt-1">Revenue vs cost analysis per client</p></div>
        <Button variant="outline" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
      </div>

      <div className="grid grid-cols-5 gap-3">
        {[
          { label: "Total MRR", value: `$${summary.total_mrr?.toLocaleString()}`, icon: DollarSign, color: "text-blue-400", bg: "bg-blue-500/10" },
          { label: "Total Cost", value: `$${summary.total_cost?.toLocaleString()}`, icon: TrendingDown, color: "text-amber-400", bg: "bg-amber-500/10" },
          { label: "Net Profit", value: `$${summary.total_profit?.toLocaleString()}`, icon: TrendingUp, color: "text-emerald-400", bg: "bg-emerald-500/10" },
          { label: "Avg Margin", value: `${summary.avg_margin}%`, icon: TrendingUp, color: summary.avg_margin > 30 ? "text-emerald-400" : "text-amber-400", bg: summary.avg_margin > 30 ? "bg-emerald-500/10" : "bg-amber-500/10" },
          { label: "Unprofitable", value: summary.unprofitable, icon: AlertTriangle, color: summary.unprofitable > 0 ? "text-red-400" : "text-emerald-400", bg: summary.unprofitable > 0 ? "bg-red-500/10" : "bg-emerald-500/10" },
        ].map((s, i) => (
          <Card key={`s-${i}`}><CardContent className="p-3 flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl ${s.bg} flex items-center justify-center`}><s.icon className={`w-4 h-4 ${s.color}`} /></div>
            <div><p className="text-lg font-bold">{s.value}</p><p className="text-[9px] text-muted-foreground uppercase tracking-wider">{s.label}</p></div>
          </CardContent></Card>
        ))}
      </div>

      {/* Visual Heatmap Grid */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Profitability Heatmap</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-5 gap-2">
            {clients.map(c => {
              const bg = c.margin_pct > 50 ? "bg-emerald-500/20 border-emerald-500/30" : c.margin_pct > 20 ? "bg-blue-500/15 border-blue-500/30" : c.margin_pct > 0 ? "bg-amber-500/15 border-amber-500/30" : "bg-red-500/20 border-red-500/30";
              return (
                <div key={c.client_id} className={`p-3 rounded-xl border transition-all hover:scale-[1.02] ${bg}`} data-testid={`heatmap-${c.client_id}`}>
                  <p className="font-medium text-sm truncate">{c.client_name}</p>
                  <p className={`text-xl font-bold font-mono mt-1 ${marginColor(c.margin_pct)}`}>{c.margin_pct}%</p>
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                    <span>${c.mrr?.toLocaleString()} rev</span>
                    <span>${c.cost?.toLocaleString()} cost</span>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Detailed Table */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Client Breakdown</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Client</TableHead><TableHead>Revenue</TableHead><TableHead>Cost</TableHead><TableHead>Profit</TableHead><TableHead>Margin</TableHead><TableHead>Devices</TableHead><TableHead>Tickets</TableHead><TableHead>Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {clients.map(c => (
                <TableRow key={c.client_id}>
                  <TableCell className="font-medium">{c.client_name}</TableCell>
                  <TableCell className="font-mono">${c.mrr?.toLocaleString()}</TableCell>
                  <TableCell className="font-mono">${c.cost?.toLocaleString()}</TableCell>
                  <TableCell className="font-mono font-bold">
                    <span className={c.profit >= 0 ? "text-emerald-400" : "text-red-400"}>{c.profit >= 0 ? <ArrowUpRight className="w-3 h-3 inline mr-0.5" /> : <ArrowDownRight className="w-3 h-3 inline mr-0.5" />}${Math.abs(c.profit)?.toLocaleString()}</span>
                  </TableCell>
                  <TableCell><span className={`font-mono font-bold ${marginColor(c.margin_pct)}`}>{c.margin_pct}%</span></TableCell>
                  <TableCell>{c.devices}</TableCell>
                  <TableCell>{c.tickets}</TableCell>
                  <TableCell><Badge className={`${statusBg(c.status)} text-[9px] border capitalize`}>{c.status?.replace(/_/g, " ")}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
