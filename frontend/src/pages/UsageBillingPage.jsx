import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { DollarSign, HardDrive, Users, Loader2, TrendingUp, Database, BarChart3, Zap } from "lucide-react";

export default function UsageBillingPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get(`${API}/usage-billing/overview`, { headers }).then(r => setData(r.data)).catch(() => toast.error("Failed to load")).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  if (!data) return null;

  const s = data.summary;

  return (
    <div className="space-y-5" data-testid="usage-billing-page">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Usage-Based Billing</h1>
        <p className="text-sm text-muted-foreground">Track metered services, device counts, and per-unit billing across all clients</p>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Card><CardContent className="pt-4 pb-3"><DollarSign className="w-5 h-5 text-emerald-400 mb-1" /><p className="text-2xl font-bold">${s.total_mrr.toLocaleString()}</p><p className="text-[11px] text-muted-foreground">Total MRR</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><Users className="w-5 h-5 text-blue-400 mb-1" /><p className="text-2xl font-bold">{s.total_clients}</p><p className="text-[11px] text-muted-foreground">Clients on Usage Plans</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><HardDrive className="w-5 h-5 text-violet-400 mb-1" /><p className="text-2xl font-bold">${s.avg_per_device.toFixed(2)}</p><p className="text-[11px] text-muted-foreground">Avg Per Device</p></CardContent></Card>
        <Card className="border-amber-500/20"><CardContent className="pt-4 pb-3"><Zap className="w-5 h-5 text-amber-400 mb-1" /><p className="text-2xl font-bold text-amber-400">${s.overages_this_month.toLocaleString()}</p><p className="text-[11px] text-muted-foreground">Overages This Month</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><BarChart3 className="w-4 h-4" />Client Usage Plans</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Client</TableHead><TableHead>Plan</TableHead><TableHead className="text-center">Devices</TableHead><TableHead className="text-center">Users</TableHead>
              <TableHead className="text-right">Base Fee</TableHead><TableHead className="text-right">Per Device</TableHead><TableHead className="text-right">Overage</TableHead>
              <TableHead className="text-right">MRR</TableHead><TableHead>Storage</TableHead><TableHead>Next Invoice</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {data.plans.map(p => (
                <TableRow key={p.id} data-testid={`usage-plan-${p.id}`}>
                  <TableCell className="font-medium">{p.client_name}</TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px] capitalize">{(p.plan_type || "").replace("_", " ")}</Badge></TableCell>
                  <TableCell className="text-center">{p.device_count}</TableCell>
                  <TableCell className="text-center">{p.user_count}</TableCell>
                  <TableCell className="text-right font-mono">${p.base_fee.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono">${p.per_device_rate.toFixed(2)}</TableCell>
                  <TableCell className="text-right">{p.overage_amount > 0 ? <span className="font-mono text-amber-400">${p.overage_amount.toFixed(2)}</span> : <span className="text-muted-foreground">$0</span>}</TableCell>
                  <TableCell className="text-right font-mono font-semibold">${p.current_mrr.toLocaleString()}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Database className="w-3 h-3 text-muted-foreground" />
                      <span className="text-xs">{p.storage_gb}GB</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{p.next_invoice}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
