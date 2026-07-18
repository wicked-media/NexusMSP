import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { DollarSign, TrendingUp, AlertTriangle, Loader2, RefreshCw, Clock, Users, Ticket } from "lucide-react";
import HeroTile from "@/components/HeroTile";

export default function ContractProfitPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const navigate = useNavigate();

  const fetchData = useCallback(async () => {
    try { const res = await axios.get(`${API}/contract-profit/overview`, { headers }); setData(res.data); }
    catch { toast.error("Failed to load data"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading || !data) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const { summary, contracts } = data;
  const marginColor = (m) => m > 20 ? "text-emerald-400" : m >= 0 ? "text-amber-400" : "text-red-400";
  const filteredContracts = contracts.filter((contract) => filter === "all" || contract.status === filter);

  return (
    <div className="space-y-5" data-testid="contract-profit-page">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div><h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><TrendingUp className="w-6 h-6 text-emerald-400" />Contract Profitability</h1><p className="text-muted-foreground mt-1">Monthly margin analysis per contract</p></div>
        <div className="flex gap-2"><Button variant="outline" onClick={() => navigate("/contracts")}>Contracts</Button><Button variant="outline" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button></div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[
          { label: "Total contracts", value: summary.total_contracts, icon: Users, glow: "cyan", filter: "all", subtitle: "Active agreements" },
          { label: "Profitable", value: summary.profitable, icon: TrendingUp, glow: "emerald", filter: "profitable", subtitle: "Above target margin" },
          { label: "Marginal", value: summary.marginal, icon: Clock, glow: "amber", filter: "marginal", subtitle: "Watch delivery cost" },
          { label: "Unprofitable", value: summary.unprofitable, icon: AlertTriangle, glow: "rose", filter: "unprofitable", subtitle: "Needs intervention" },
          { label: "Total profit", value: `$${summary.total_profit?.toLocaleString()}`, icon: DollarSign, glow: "emerald", subtitle: "This month", animated: false },
          { label: "Net P&L", value: `$${summary.net?.toLocaleString()}`, icon: TrendingUp, glow: summary.net >= 0 ? "emerald" : "rose", subtitle: "This month", animated: false },
        ].map((s, i) => (
          <HeroTile key={`s-${i}`} label={s.label} value={s.value} icon={s.icon} glow={s.glow} subtitle={s.subtitle} animated={s.animated !== false} active={s.filter && filter === s.filter} onClick={s.filter ? () => setFilter(s.filter) : undefined} />
        ))}
      </div>

      <Card className="overflow-hidden border-border/70">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/[0.025] px-4 py-3"><div className="flex gap-1.5">{[["all", "All"], ["profitable", "Profitable"], ["marginal", "Marginal"], ["unprofitable", "Needs attention"]].map(([value, label]) => <Button key={value} size="sm" variant={filter === value ? "secondary" : "ghost"} className="h-7 text-[11px]" onClick={() => setFilter(value)}>{label}</Button>)}</div><span className="text-xs text-muted-foreground">Showing {filteredContracts.length} contracts</span></div>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Client</TableHead><TableHead>Contract</TableHead><TableHead>Monthly Value</TableHead><TableHead>Hours Used</TableHead><TableHead>Tickets</TableHead><TableHead>Cost</TableHead><TableHead>Profit</TableHead><TableHead>Margin</TableHead><TableHead>Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filteredContracts.length === 0 && <TableRow><TableCell colSpan={9} className="text-center py-12 text-muted-foreground">No contracts match this view</TableCell></TableRow>}
              {filteredContracts.map((c, i) => (
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
