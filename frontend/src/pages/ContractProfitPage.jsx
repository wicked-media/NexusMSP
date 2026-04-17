import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { DollarSign, TrendingUp, AlertTriangle, Loader2, RefreshCw, Clock, Users, Ticket } from "lucide-react";

export default function ContractProfitPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try { const res = await axios.get(`${API}/contract-profit/overview`, { headers }); setData(res.data); }
    catch { toast.error("Failed to load data"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading || !data) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const { summary, contracts } = data;
  const marginColor = (m) => m > 20 ? "text-emerald-400" : m >= 0 ? "text-amber-400" : "text-red-400";

  return (
    <div className="space-y-5" data-testid="contract-profit-page">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><TrendingUp className="w-6 h-6 text-emerald-400" />Contract Profitability</h1><p className="text-muted-foreground mt-1">Monthly margin analysis per contract</p></div>
        <Button variant="outline" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
      </div>

      <div className="grid grid-cols-6 gap-3">
        {[
          { label: "Total Contracts", value: summary.total_contracts, icon: Users, color: "text-blue-400", bg: "bg-blue-500/10" },
          { label: "Profitable", value: summary.profitable, icon: TrendingUp, color: "text-emerald-400", bg: "bg-emerald-500/10" },
          { label: "Marginal", value: summary.marginal, icon: Clock, color: "text-amber-400", bg: "bg-amber-500/10" },
          { label: "Unprofitable", value: summary.unprofitable, icon: AlertTriangle, color: "text-red-400", bg: "bg-red-500/10" },
          { label: "Total Profit", value: `$${summary.total_profit?.toLocaleString()}`, icon: DollarSign, color: "text-emerald-400", bg: "bg-emerald-500/10" },
          { label: "Net P&L", value: `$${summary.net?.toLocaleString()}`, icon: TrendingUp, color: summary.net >= 0 ? "text-emerald-400" : "text-red-400", bg: summary.net >= 0 ? "bg-emerald-500/10" : "bg-red-500/10" },
        ].map((s, i) => (
          <Card key={`s-${i}`}><CardContent className="p-3 flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl ${s.bg} flex items-center justify-center`}><s.icon className={`w-4 h-4 ${s.color}`} /></div>
            <div><p className="text-lg font-bold">{s.value}</p><p className="text-[9px] text-muted-foreground uppercase tracking-wider">{s.label}</p></div>
          </CardContent></Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Client</TableHead><TableHead>Contract</TableHead><TableHead>Monthly Value</TableHead><TableHead>Hours Used</TableHead><TableHead>Tickets</TableHead><TableHead>Cost</TableHead><TableHead>Profit</TableHead><TableHead>Margin</TableHead><TableHead>Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {contracts.length === 0 && <TableRow><TableCell colSpan={9} className="text-center py-12 text-muted-foreground">No active contracts</TableCell></TableRow>}
              {contracts.map((c, i) => (
                <TableRow key={`c-${i}`} className={c.status === "unprofitable" ? "bg-red-500/5" : ""}>
                  <TableCell className="font-medium">{c.client_name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c.contract_name}</TableCell>
                  <TableCell className="font-mono">${c.monthly_value?.toLocaleString()}</TableCell>
                  <TableCell className="font-mono">{c.hours_used}h{c.included_hours ? <span className="text-muted-foreground">/{c.included_hours}h</span> : ""}</TableCell>
                  <TableCell>{c.tickets_this_month}</TableCell>
                  <TableCell className="font-mono">${c.total_cost?.toLocaleString()}</TableCell>
                  <TableCell className={`font-mono font-bold ${c.profit >= 0 ? "text-emerald-400" : "text-red-400"}`}>${c.profit?.toLocaleString()}</TableCell>
                  <TableCell><span className={`font-mono font-bold ${marginColor(c.margin_pct)}`}>{c.margin_pct}%</span></TableCell>
                  <TableCell><Badge className={`text-[9px] border capitalize ${c.status === "profitable" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : c.status === "marginal" ? "bg-amber-500/10 text-amber-400 border-amber-500/20" : "bg-red-500/10 text-red-400 border-red-500/20"}`}>{c.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
