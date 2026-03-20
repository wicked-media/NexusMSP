import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Layers, DollarSign, AlertTriangle, TrendingUp } from "lucide-react";
import { toast } from "sonner";

export default function LicenseManagementPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await axios.get(`${API}/license-management/overview`, { headers });
        setData(res.data);
      } catch (e) { toast.error("Failed to load license data"); }
      setLoading(false);
    };
    fetchData();
  }, []);

  if (loading || !data) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  const { summary, licenses } = data;
  const wastedCost = licenses.reduce((acc, l) => acc + (l.available * l.unit_cost), 0);

  return (
    <div className="space-y-6" data-testid="license-management-page">
      <div><h1 className="text-2xl font-bold tracking-tight">License Management</h1><p className="text-muted-foreground text-sm mt-1">Track software licenses across all clients</p></div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card><CardContent className="pt-5"><p className="text-3xl font-bold">{summary.utilization_pct}%</p><p className="text-xs text-muted-foreground">Utilization Rate</p><Progress value={summary.utilization_pct} className="mt-2" /></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><Layers className="w-6 h-6 text-primary" /><div><p className="text-2xl font-bold">{summary.total_licenses}</p><p className="text-xs text-muted-foreground">License Types</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><DollarSign className="w-6 h-6 text-emerald-500" /><div><p className="text-2xl font-bold">${summary.total_monthly_cost.toLocaleString()}</p><p className="text-xs text-muted-foreground">Monthly Cost</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><AlertTriangle className="w-6 h-6 text-amber-500" /><div><p className="text-2xl font-bold">{summary.wasted_licenses}</p><p className="text-xs text-muted-foreground">Unused Licenses</p></div></CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3"><TrendingUp className="w-6 h-6 text-red-500" /><div><p className="text-2xl font-bold">${wastedCost.toFixed(0)}</p><p className="text-xs text-muted-foreground">Wasted/month</p></div></CardContent></Card>
      </div>

      <Card><CardHeader><CardTitle className="text-lg">All Licenses</CardTitle></CardHeader>
        <CardContent><div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="border-b text-left text-muted-foreground"><th className="pb-3 font-medium">Product</th><th className="pb-3 font-medium">Client</th><th className="pb-3 font-medium">Vendor</th><th className="pb-3 font-medium">Used / Purchased</th><th className="pb-3 font-medium">Utilization</th><th className="pb-3 font-medium">Monthly Cost</th><th className="pb-3 font-medium">Renewal</th></tr></thead>
          <tbody>{licenses.map(l => {
            const utilPct = l.purchased > 0 ? Math.round(l.used / l.purchased * 100) : 0;
            return (
              <tr key={l.id} className="border-b border-border/50 hover:bg-muted/30" data-testid={`license-${l.id}`}>
                <td className="py-2 font-medium">{l.product_name}</td>
                <td className="py-2 text-muted-foreground">{l.client_name}</td>
                <td className="py-2"><Badge variant="outline">{l.vendor}</Badge></td>
                <td className="py-2">{l.used} / {l.purchased}{l.available > 3 && <span className="text-amber-500 text-xs ml-1">({l.available} unused)</span>}</td>
                <td className="py-2"><div className="w-20"><Progress value={utilPct} className={utilPct < 60 ? "[&>div]:bg-red-500" : utilPct < 80 ? "[&>div]:bg-amber-500" : ""} /><span className="text-[10px] text-muted-foreground">{utilPct}%</span></div></td>
                <td className="py-2">${l.monthly_cost.toLocaleString()}</td>
                <td className="py-2 text-xs text-muted-foreground">{l.renewal_date}</td>
              </tr>
            );
          })}</tbody>
        </table></div></CardContent>
      </Card>
    </div>
  );
}
