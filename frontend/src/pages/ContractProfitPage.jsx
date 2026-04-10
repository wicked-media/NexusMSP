import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { DollarSign, TrendingUp, TrendingDown, AlertTriangle, CheckCircle } from "lucide-react";

const statusColors = { profitable: "default", marginal: "secondary", unprofitable: "destructive" };

export default function ContractProfitPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    axios.get(`${API}/contract-profit/overview`, { headers })
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!data) return null;

  const { summary, contracts } = data;

  return (
    <div className="space-y-6" data-testid="contract-profit-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Contract Profitability</h1>
        <p className="text-muted-foreground text-sm mt-1">Analyze the real profitability of each service contract</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card><CardContent className="pt-4 pb-3 text-center">
          <p className="text-xl font-bold">{summary.total_contracts}</p>
          <p className="text-xs text-muted-foreground">Active Contracts</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <p className="text-xl font-bold text-green-500">{summary.profitable}</p>
          <p className="text-xs text-muted-foreground">Profitable</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <p className="text-xl font-bold text-amber-500">{summary.marginal}</p>
          <p className="text-xs text-muted-foreground">Marginal</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <p className="text-xl font-bold text-red-500">{summary.unprofitable}</p>
          <p className="text-xs text-muted-foreground">Unprofitable</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <TrendingUp className="w-4 h-4 mx-auto mb-1 text-green-500" />
          <p className="text-xl font-bold text-green-500">${summary.total_profit.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">Total Profit</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <p className={`text-xl font-bold ${summary.net >= 0 ? "text-green-500" : "text-red-500"}`}>${summary.net.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">Net P&L</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Contract Analysis</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Client</TableHead><TableHead>Contract</TableHead><TableHead className="text-right">Monthly Value</TableHead>
              <TableHead className="text-right">Hours Used</TableHead><TableHead className="text-right">Cost</TableHead>
              <TableHead className="text-right">Profit</TableHead><TableHead className="text-right">Margin</TableHead><TableHead>Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {contracts.map((c, i) => (
                <TableRow key={`k-${i}`} data-testid={`contract-row-${i}`}>
                  <TableCell className="font-medium">{c.client_name}</TableCell>
                  <TableCell className="text-sm">{c.contract_name}</TableCell>
                  <TableCell className="text-right font-mono">${c.monthly_value.toLocaleString()}</TableCell>
                  <TableCell className="text-right">{c.hours_used}h</TableCell>
                  <TableCell className="text-right font-mono">${c.total_cost.toLocaleString()}</TableCell>
                  <TableCell className={`text-right font-mono font-bold ${c.profit >= 0 ? "text-green-500" : "text-red-500"}`}>
                    ${c.profit.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={c.margin_pct >= 20 ? "text-green-500" : c.margin_pct >= 0 ? "text-amber-500" : "text-red-500"}>
                      {c.margin_pct}%
                    </span>
                  </TableCell>
                  <TableCell><Badge variant={statusColors[c.status]} className="capitalize text-xs">{c.status}</Badge></TableCell>
                </TableRow>
              ))}
              {contracts.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No active contracts</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
