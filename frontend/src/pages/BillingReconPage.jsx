import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  DollarSign, AlertTriangle, Clock, FileText, Loader2, RefreshCw,
  TrendingUp, Receipt, CreditCard, Users
} from "lucide-react";

export default function BillingReconPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/billing-recon/overview`, { headers });
      setData(res.data);
    } catch { toast.error("Failed to load billing data"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const d = data || {};
  const unbilledTime = d.unbilled_time || {};
  const products = d.uninvoiced_products || {};
  const overages = d.contract_overages || [];
  const overdue = d.overdue_invoices || {};

  return (
    <div className="space-y-5" data-testid="billing-recon-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3"><Receipt className="w-8 h-8 text-emerald-400" />Billing Reconciliation</h1>
          <p className="text-muted-foreground">Find unbilled work, products, and overdue invoices</p>
        </div>
        <Button variant="outline" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
      </div>

      {/* Total recoverable */}
      <Card className="border-emerald-500/20 bg-emerald-500/5">
        <CardContent className="py-4 flex items-center gap-4">
          <DollarSign className="w-8 h-8 text-emerald-400" />
          <div>
            <p className="text-sm text-muted-foreground">Total Recoverable Revenue</p>
            <p className="text-3xl font-black text-emerald-400">${(d.total_recoverable || 0).toLocaleString()}</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Unbilled Time", value: `$${(unbilledTime.total_amount || 0).toLocaleString()}`, sub: `${unbilledTime.total_entries || 0} entries`, icon: Clock, color: "text-amber-400", bg: "bg-amber-500/10" },
          { label: "Uninvoiced Products", value: `$${(products.total_amount || 0).toLocaleString()}`, sub: `${products.total_tickets || 0} tickets`, icon: FileText, color: "text-blue-400", bg: "bg-blue-500/10" },
          { label: "Contract Overages", value: overages.length, sub: "clients over hours", icon: TrendingUp, color: "text-violet-400", bg: "bg-violet-500/10" },
          { label: "Overdue Invoices", value: `$${(overdue.total_amount || 0).toLocaleString()}`, sub: `${overdue.total_count || 0} invoices`, icon: AlertTriangle, color: "text-red-400", bg: "bg-red-500/10" },
        ].map((s, i) => {
          const Icon = s.icon;
          return (
            <Card key={`k-${i}`}>
              <CardContent className="pt-4">
                <div className={`w-8 h-8 rounded-lg ${s.bg} flex items-center justify-center mb-2`}><Icon className={`w-4 h-4 ${s.color}`} /></div>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className={`text-xl font-black ${s.color}`}>{s.value}</p>
                <p className="text-[10px] text-muted-foreground">{s.sub}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Unbilled time */}
      {(unbilledTime.entries || []).length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-amber-400 flex items-center gap-2"><Clock className="w-4 h-4" />Unbilled Time Entries ({unbilledTime.total_entries})</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {(unbilledTime.entries || []).map((e, i) => (
              <div key={`k-${i}`} className="flex items-center justify-between p-2 bg-muted/20 rounded text-sm">
                <div>
                  <p className="font-medium">{e.description || "Time entry"}</p>
                  <p className="text-xs text-muted-foreground">{e.user_name} &middot; {e.client_name} &middot; {e.date}</p>
                </div>
                <span className="font-mono font-bold text-amber-400">{e.hours || 0}h &times; ${e.rate || 0} = ${((e.hours || 0) * (e.rate || 0)).toFixed(2)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Contract overages */}
      {overages.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-violet-400 flex items-center gap-2"><TrendingUp className="w-4 h-4" />Contract Hour Overages</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {overages.map((o, i) => (
              <div key={`k-${i}`} className="flex items-center justify-between p-2 bg-muted/20 rounded text-sm">
                <div>
                  <p className="font-medium">{o.contract_name}</p>
                  <p className="text-xs text-muted-foreground">Used {o.hours_used}h of {o.included_hours}h included</p>
                </div>
                <div className="text-right">
                  <span className="font-mono font-bold text-violet-400">{o.overage_hours}h over</span>
                  <p className="text-xs text-muted-foreground">${o.overage_value?.toLocaleString()} billable</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Overdue */}
      {(overdue.invoices || []).length > 0 && (
        <Card className="border-red-500/20">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-red-400 flex items-center gap-2"><AlertTriangle className="w-4 h-4" />Overdue Invoices</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {(overdue.invoices || []).map((inv, i) => (
              <div key={`k-${i}`} className="flex items-center justify-between p-2 bg-red-500/5 rounded text-sm">
                <div>
                  <p className="font-medium">{inv.invoice_number}</p>
                  <p className="text-xs text-muted-foreground">{inv.client_name} &middot; Due: {inv.due_date}</p>
                </div>
                <span className="font-mono font-bold text-red-400">${inv.total?.toLocaleString()}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
