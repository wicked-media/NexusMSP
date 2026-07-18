import { useState, useEffect, useMemo } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { DollarSign, HardDrive, Users, Loader2, TrendingUp, Database, BarChart3, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
import HeroTile from "@/components/HeroTile";

export default function UsageBillingPage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    axios.get(`${API}/usage-billing/overview`, { headers }).then(r => setData(r.data)).catch(() => toast.error("Failed to load")).finally(() => setLoading(false));
  }, [headers]);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  if (!data) return null;

  const s = data.summary;

  return (
    <div className="space-y-6" data-testid="usage-billing-page">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="w-9 h-9 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center"><Database className="w-4 h-4 text-sky-300" /></span>
          <div><h1 className="text-2xl font-bold tracking-tight">Usage Billing</h1><p className="text-sm text-muted-foreground">Metered services, device counts, and per-unit revenue by client.</p></div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate("/recurring-invoices")} data-testid="usage-go-recurring"><TrendingUp className="w-4 h-4 mr-1" />Recurring</Button>
          <Button variant="outline" size="sm" onClick={() => navigate("/invoices")} data-testid="usage-go-invoices"><DollarSign className="w-4 h-4 mr-1" />Invoices</Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <HeroTile label="Usage MRR" value={`$${(s.total_mrr || 0).toLocaleString()}`} icon={DollarSign} glow="emerald" animated={false} onClick={() => navigate("/recurring-invoices")} testId="usage-metric-mrr" />
        <HeroTile label="Clients on plans" value={s.total_clients || 0} icon={Users} glow="cyan" testId="usage-metric-clients" />
        <HeroTile label="Average per device" value={`$${(s.avg_per_device || 0).toFixed(2)}`} icon={HardDrive} glow="violet" animated={false} testId="usage-metric-device" />
        <HeroTile label="Overages this month" value={`$${(s.overages_this_month || 0).toLocaleString()}`} icon={Zap} glow={(s.overages_this_month || 0) > 0 ? "amber" : "emerald"} animated={false} onClick={() => navigate("/invoices")} testId="usage-metric-overages" />
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
