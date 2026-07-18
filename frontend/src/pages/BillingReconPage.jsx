import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import HeroTile from "@/components/HeroTile";
import {
  DollarSign, AlertTriangle, Clock, FileText, Loader2, RefreshCw,
  TrendingUp, Receipt, CreditCard, Users
} from "lucide-react";

export default function BillingReconPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
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
  const supplierVariances = d.supplier_invoice_variances || {};

  return (
    <div className="space-y-6" data-testid="billing-recon-page">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center"><Receipt className="w-4 h-4 text-amber-300" /></span>
          <div><h1 className="text-2xl font-bold tracking-tight">Billing Reconciliation</h1><p className="text-sm text-muted-foreground">Surface recoverable work and resolve revenue leakage.</p></div>
        </div>
        <Button variant="outline" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <HeroTile label="Recoverable revenue" value={`$${(d.total_recoverable || 0).toLocaleString()}`} icon={DollarSign} glow="emerald" animated={false} onClick={() => fetchData()} testId="recon-metric-recoverable" />
        <HeroTile label="Unbilled time" value={`$${(unbilledTime.total_amount || 0).toLocaleString()}`} icon={Clock} glow="amber" animated={false} subtitle={`${unbilledTime.total_entries || 0} entries`} onClick={() => navigate("/time-tracking")} testId="recon-metric-time" />
        <HeroTile label="Uninvoiced products" value={`$${(products.total_amount || 0).toLocaleString()}`} icon={FileText} glow="cyan" animated={false} subtitle={`${products.total_tickets || 0} tickets`} onClick={() => navigate("/tickets")} testId="recon-metric-products" />
        <HeroTile label="Contract overages" value={overages.length} icon={TrendingUp} glow="violet" subtitle="Clients over hours" onClick={() => navigate("/contracts")} testId="recon-metric-overages" />
        <HeroTile label="Overdue invoices" value={`$${(overdue.total_amount || 0).toLocaleString()}`} icon={AlertTriangle} glow={(overdue.total_count || 0) > 0 ? "rose" : "emerald"} animated={false} subtitle={`${overdue.total_count || 0} invoices`} onClick={() => navigate("/invoices")} testId="recon-metric-overdue" />
        <HeroTile label="Supplier variances" value={`$${(supplierVariances.total_amount || 0).toLocaleString()}`} icon={Receipt} glow={(supplierVariances.total_count || 0) > 0 ? "amber" : "emerald"} animated={false} subtitle={`${supplierVariances.total_count || 0} POs`} onClick={() => navigate("/purchase-orders")} testId="recon-metric-supplier-variance" />
      </div>

      {(supplierVariances.purchase_orders || []).length > 0 && (
        <Card className="border-amber-500/20">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-amber-400 flex items-center gap-2"><Receipt className="w-4 h-4" />Supplier Invoice Variances</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {(supplierVariances.purchase_orders || []).map((po, i) => {
              const match = po.vendor_invoice_match || {};
              const review = match.review;
              return <button type="button" key={po.id || `supplier-variance-${i}`} onClick={() => navigate(`/purchase-orders?po=${encodeURIComponent(po.id)}`)} className="flex w-full items-center justify-between rounded p-2 text-left text-sm bg-amber-500/5 transition-colors hover:bg-amber-500/10">
                <div><p className="font-medium">{po.po_number || "Purchase order"} · {po.vendor || "Supplier"}</p><p className="text-xs text-muted-foreground">Invoice {match.invoice_number || "—"}{review ? ` · ${review.status === "accepted" ? "Accepted" : "Supplier follow-up"}` : " · Review required"}</p></div>
                <span className="font-mono font-bold text-amber-400">{match.variance > 0 ? "+" : "-"}${Math.abs(match.variance || 0).toFixed(2)}</span>
              </button>;
            })}
          </CardContent>
        </Card>
      )}

      {/* Unbilled time */}
      {(unbilledTime.entries || []).length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-amber-400 flex items-center gap-2"><Clock className="w-4 h-4" />Unbilled Time Entries ({unbilledTime.total_entries})</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {(unbilledTime.entries || []).map((e, i) => (
              <button type="button" key={`k-${i}`} onClick={() => navigate("/time-tracking")} className="flex w-full items-center justify-between rounded p-2 text-left text-sm bg-muted/20 transition-colors hover:bg-muted/50">
                <div>
                  <p className="font-medium">{e.description || "Time entry"}</p>
                  <p className="text-xs text-muted-foreground">{e.user_name} &middot; {e.client_name} &middot; {e.date}</p>
                </div>
                <span className="font-mono font-bold text-amber-400">{e.hours || 0}h &times; ${e.rate || 0} = ${((e.hours || 0) * (e.rate || 0)).toFixed(2)}</span>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Ticket products awaiting invoice conversion */}
      {(products.tickets || []).length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-cyan-400 flex items-center gap-2"><FileText className="w-4 h-4" />Ticket Products Awaiting Invoice</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {(products.tickets || []).map((ticket, i) => {
              const productTotal = (ticket.products || []).reduce((sum, product) => sum + Number(product.price || 0) * Number(product.quantity || 1), 0);
              return <button type="button" key={ticket.id || `product-${i}`} onClick={() => navigate(`/tickets?ticket=${encodeURIComponent(ticket.id)}`)} className="flex w-full items-center justify-between rounded p-2 text-left text-sm bg-cyan-500/5 transition-colors hover:bg-cyan-500/10">
                <div><p className="font-medium">{ticket.ticket_number || "Ticket"} · {ticket.title || "Product work"}</p><p className="text-xs text-muted-foreground">{ticket.client_name} · {(ticket.products || []).length} product line{(ticket.products || []).length === 1 ? "" : "s"}</p></div>
                <span className="font-mono font-bold text-cyan-400">${productTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </button>;
            })}
          </CardContent>
        </Card>
      )}

      {/* Contract overages */}
      {overages.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-violet-400 flex items-center gap-2"><TrendingUp className="w-4 h-4" />Contract Hour Overages</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {overages.map((o, i) => (
              <button type="button" key={`k-${i}`} onClick={() => o.contract_id && navigate(`/contracts?contract=${encodeURIComponent(o.contract_id)}`)} className="flex w-full items-center justify-between rounded p-2 text-left text-sm bg-muted/20 transition-colors hover:bg-muted/50">
                <div>
                  <p className="font-medium">{o.contract_name}</p>
                  <p className="text-xs text-muted-foreground">Used {o.hours_used}h of {o.included_hours}h included</p>
                </div>
                <div className="text-right">
                  <span className="font-mono font-bold text-violet-400">{o.overage_hours}h over</span>
                  <p className="text-xs text-muted-foreground">${o.overage_value?.toLocaleString()} billable</p>
                </div>
              </button>
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
              <button type="button" key={`k-${i}`} onClick={() => navigate(`/invoices?invoice=${encodeURIComponent(inv.id)}`)} className="flex w-full items-center justify-between rounded p-2 text-left text-sm bg-red-500/5 transition-colors hover:bg-red-500/10">
                <div>
                  <p className="font-medium">{inv.invoice_number}</p>
                  <p className="text-xs text-muted-foreground">{inv.client_name} &middot; Due: {inv.due_date}</p>
                </div>
                <span className="font-mono font-bold text-red-400">${inv.total?.toLocaleString()}</span>
              </button>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
