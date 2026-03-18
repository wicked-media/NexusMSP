import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { DollarSign, TrendingUp, AlertTriangle, CheckCircle, XCircle, RefreshCw, ArrowUpRight, Target, BarChart3 } from "lucide-react";

export default function GradientPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [reconciliation, setReconciliation] = useState(null);
  const [opportunities, setOpportunities] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, oRes] = await Promise.all([
        axios.get(`${API}/gradient/reconciliation`, { headers }),
        axios.get(`${API}/gradient/revenue-opportunities`, { headers }),
      ]);
      setReconciliation(rRes.data);
      setOpportunities(oRes.data);
    } catch { toast.error("Failed to load Gradient data"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const s = reconciliation?.summary || {};
  const statusIcon = { matched: <CheckCircle className="w-3 h-3 text-emerald-500" />, under_billed: <AlertTriangle className="w-3 h-3 text-amber-500" />, over_billed: <XCircle className="w-3 h-3 text-red-500" /> };
  const statusClass = { matched: "bg-emerald-500/10 text-emerald-500", under_billed: "bg-amber-500/10 text-amber-500", over_billed: "bg-red-500/10 text-red-500" };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-bold tracking-tight">Gradient MSP</h1><p className="text-muted-foreground">Billing reconciliation & revenue optimization</p></div>
        <Button variant="outline" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total Billed", value: `$${s.total_billed?.toLocaleString() || 0}`, icon: DollarSign, color: "text-blue-500" },
          { label: "Actual Usage", value: `$${s.total_actual_usage?.toLocaleString() || 0}`, icon: BarChart3, color: "text-violet-500" },
          { label: "Missed Revenue", value: `$${s.missed_revenue?.toLocaleString() || 0}`, icon: AlertTriangle, color: "text-amber-500" },
          { label: "Revenue Opportunities", value: `$${opportunities?.total_potential_mrr?.toLocaleString() || 0}`, icon: TrendingUp, color: "text-emerald-500" },
        ].map((c, i) => (
          <Card key={i}><CardContent className="pt-4"><div className="flex items-center gap-3"><c.icon className={`w-8 h-8 ${c.color}`} /><div><p className="text-xs text-muted-foreground">{c.label}</p><p className="text-xl font-bold">{c.value}</p></div></div></CardContent></Card>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card className="border-emerald-500/20"><CardContent className="pt-3 text-center"><p className="text-2xl font-bold text-emerald-500">{s.matched_count || 0}</p><p className="text-xs text-muted-foreground">Matched</p></CardContent></Card>
        <Card className="border-amber-500/20"><CardContent className="pt-3 text-center"><p className="text-2xl font-bold text-amber-500">{s.under_billed_count || 0}</p><p className="text-xs text-muted-foreground">Under-Billed</p></CardContent></Card>
        <Card className="border-red-500/20"><CardContent className="pt-3 text-center"><p className="text-2xl font-bold text-red-500">{s.over_billed_count || 0}</p><p className="text-xs text-muted-foreground">Over-Billed</p></CardContent></Card>
      </div>

      <Tabs defaultValue="reconciliation">
        <TabsList><TabsTrigger value="reconciliation">Reconciliation ({reconciliation?.items?.length || 0})</TabsTrigger><TabsTrigger value="opportunities">Revenue Opportunities ({opportunities?.opportunities?.length || 0})</TabsTrigger></TabsList>

        <TabsContent value="reconciliation">
          <Table>
            <TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Vendor</TableHead><TableHead>Billed Qty</TableHead><TableHead>Actual Qty</TableHead><TableHead>$/Unit</TableHead><TableHead>Billed</TableHead><TableHead>Actual</TableHead><TableHead>Variance</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {(reconciliation?.items || []).map(item => (
                <TableRow key={item.id} className={item.status === "under_billed" ? "bg-amber-500/[0.02]" : item.status === "over_billed" ? "bg-red-500/[0.02]" : ""}>
                  <TableCell className="text-sm font-medium">{item.client_name}</TableCell>
                  <TableCell className="text-sm">{item.vendor}</TableCell>
                  <TableCell>{item.billed_quantity}</TableCell>
                  <TableCell className="font-medium">{item.actual_quantity}</TableCell>
                  <TableCell>${item.unit_price}</TableCell>
                  <TableCell>${item.billed_total}</TableCell>
                  <TableCell className="font-medium">${item.actual_total}</TableCell>
                  <TableCell className={item.variance > 0 ? "text-amber-500 font-medium" : item.variance < 0 ? "text-red-500" : ""}>{item.variance > 0 ? "+" : ""}{item.variance !== 0 ? `$${item.variance}` : "-"}</TableCell>
                  <TableCell><div className="flex items-center gap-1">{statusIcon[item.status]}<Badge className={statusClass[item.status] + " text-[9px]"}>{item.status?.replace("_", " ")}</Badge></div></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="opportunities">
          <div className="space-y-3">
            {(opportunities?.opportunities || []).map(o => (
              <Card key={o.id} className="hover:border-emerald-500/30 transition-colors">
                <CardContent className="pt-4 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2"><span className="font-medium">{o.client_name}</span><Badge variant="outline" className="text-[10px]">{o.service}</Badge><Badge variant="outline" className={o.confidence === "high" ? "text-emerald-500 text-[9px]" : o.confidence === "medium" ? "text-yellow-500 text-[9px]" : "text-[9px]"}>{o.confidence}</Badge></div>
                    <p className="text-xs text-muted-foreground mt-1">{o.reason} | Est. {o.estimated_devices} {o.category} devices @ ${o.price_per_unit}/unit</p>
                  </div>
                  <div className="text-right"><p className="text-lg font-bold text-emerald-500">${o.potential_mrr}/mo</p><Button size="sm" className="h-6 text-[10px] mt-1"><ArrowUpRight className="w-3 h-3 mr-1" />Quote</Button></div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
