import { useEffect, useState } from "react";
import axios from "axios";
import { API } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, DollarSign, RefreshCw, Save, Eye, FileText, XCircle, Plus } from "lucide-react";
import { toast } from "sonner";

export default function BillingTab({ token }) {
  const headers = { Authorization: `Bearer ${token}` };
  const [pricing, setPricing] = useState({});
  const [currency, setCurrency] = useState("AUD");
  const [fxRate, setFxRate] = useState(1.0);
  const [fxUpdatedAt, setFxUpdatedAt] = useState(null);
  const [billingPreview, setBillingPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshingFx, setRefreshingFx] = useState(false);
  const [savingPricing, setSavingPricing] = useState(false);
  const [syncingBilling, setSyncingBilling] = useState(false);
  const [autoBillBusy, setAutoBillBusy] = useState(null);
  const [autoBillDialog, setAutoBillDialog] = useState(null);
  const [autoBillFrequency, setAutoBillFrequency] = useState("monthly");

  const fetchBilling = async () => {
    setLoading(true);
    try {
      const [priceRes, previewRes] = await Promise.all([
        axios.get(`${API}/acronis/pricing`, { headers }),
        axios.get(`${API}/acronis/billing/preview`, { headers }),
      ]);
      setPricing(priceRes.data?.pricing || {});
      setCurrency(priceRes.data?.currency || "AUD");
      setFxRate(priceRes.data?.fx_rate_from_usd || 1.0);
      setFxUpdatedAt(priceRes.data?.fx_updated_at || null);
      setBillingPreview(previewRes.data);
    } catch { toast.error("Failed to load billing data"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchBilling(); /* eslint-disable-next-line */ }, []);

  const refreshFx = async (target) => {
    setRefreshingFx(true);
    try {
      const res = await axios.post(`${API}/acronis/fx/refresh`, { currency: target }, { headers });
      toast.success(`FX updated: 1 USD = ${res.data.fx_rate_from_usd} ${res.data.currency}`);
      await fetchBilling();
    } catch (e) { toast.error(e.response?.data?.detail || "FX refresh failed"); }
    finally { setRefreshingFx(false); }
  };

  const handlePriceChange = (code, field, value) => {
    setPricing(prev => ({
      ...prev,
      [code]: { ...prev[code], [field]: field === "enabled" ? value : parseFloat(value) || 0 },
    }));
  };

  const savePricing = async () => {
    setSavingPricing(true);
    try {
      await axios.post(`${API}/acronis/pricing`, { pricing, currency }, { headers });
      toast.success("Pricing saved — refreshing preview");
      await fetchBilling();
    } catch { toast.error("Failed to save pricing"); }
    finally { setSavingPricing(false); }
  };

  const syncBillingToLineItems = async (dryRun = false) => {
    setSyncingBilling(true);
    try {
      const res = await axios.post(`${API}/acronis/billing/sync`, { dry_run: dryRun }, { headers });
      const msg = dryRun
        ? `Preview: ${res.data.synced_count} clients would be billed ${currency} ${res.data.total_billed.toFixed(2)}`
        : `Synced ${res.data.synced_count} clients — ${currency} ${res.data.total_billed.toFixed(2)} billed`;
      toast.success(msg);
      if (res.data.skipped?.length) {
        toast.warning(`Skipped ${res.data.skipped.length}: ${res.data.skipped.map(s => s.reason).slice(0, 3).join(", ")}`);
      }
      if (!dryRun) fetchBilling();
    } catch (e) { toast.error(e.response?.data?.detail || "Billing sync failed"); }
    finally { setSyncingBilling(false); }
  };

  const handleToggleAutoBill = (row) => {
    if (row.auto_bill_recurring) disableAutoBill(row.client_id);
    else if ((row.active_recurring_invoices || []).length > 0) enableAutoBill(row.client_id, false);
    else { setAutoBillDialog(row); setAutoBillFrequency("monthly"); }
  };

  const enableAutoBill = async (clientId, createIfMissing) => {
    setAutoBillBusy(clientId);
    try {
      const res = await axios.post(
        `${API}/acronis/billing/client/${clientId}/link-to-recurring`,
        { create_if_missing: createIfMissing, frequency: autoBillFrequency, currency },
        { headers }
      );
      toast.success(res.data.message || "Linked");
      setAutoBillDialog(null);
      fetchBilling();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to link"); }
    finally { setAutoBillBusy(null); }
  };

  const disableAutoBill = async (clientId) => {
    setAutoBillBusy(clientId);
    try {
      const res = await axios.post(`${API}/acronis/billing/client/${clientId}/unlink-recurring`, {}, { headers });
      toast.success(`Auto-bill disabled on ${res.data.disabled_on} recurring invoice(s)`);
      fetchBilling();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to unlink"); }
    finally { setAutoBillBusy(null); }
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  return (
    <div className="space-y-4" data-testid="bcc-billing-tab">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-emerald-400" />Acronis Usage Billing
          </h2>
          <p className="text-xs text-muted-foreground">Sync Acronis tenant usage into client contracts as billable line items.</p>
          {fxUpdatedAt && currency !== "USD" && (
            <p className="text-[11px] text-muted-foreground mt-1">
              FX: 1 USD = <span className="text-emerald-400 font-semibold">{fxRate} {currency}</span> · updated {new Date(fxUpdatedAt).toLocaleString()}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={currency} onValueChange={refreshFx}>
            <SelectTrigger className="h-8 w-[120px] text-xs" data-testid="currency-select"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="AUD">AUD ($)</SelectItem>
              <SelectItem value="USD">USD ($)</SelectItem>
              <SelectItem value="EUR">EUR (€)</SelectItem>
              <SelectItem value="GBP">GBP (£)</SelectItem>
              <SelectItem value="NZD">NZD ($)</SelectItem>
              <SelectItem value="CAD">CAD ($)</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => refreshFx(currency)} disabled={refreshingFx} data-testid="refresh-fx-btn">
            {refreshingFx ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}Refresh FX
          </Button>
          <Button size="sm" variant="outline" onClick={() => syncBillingToLineItems(true)} disabled={syncingBilling} data-testid="dry-run-billing-btn">
            <Eye className="w-3 h-3 mr-1" />Dry Run
          </Button>
          <Button size="sm" onClick={() => syncBillingToLineItems(false)} disabled={syncingBilling || !(billingPreview?.linked_clients)} data-testid="sync-billing-btn">
            {syncingBilling ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <FileText className="w-3 h-3 mr-1" />}Sync to Line Items
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="pt-4 pb-3"><p className="text-2xl font-bold">{billingPreview?.linked_clients || 0}</p><p className="text-[11px] text-muted-foreground">Linked Clients</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><p className="text-2xl font-bold">{billingPreview?.period || "—"}</p><p className="text-[11px] text-muted-foreground">Billing Period</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><p className="text-2xl font-bold text-emerald-400">{currency} {(billingPreview?.grand_total || 0).toFixed(2)}</p><p className="text-[11px] text-muted-foreground">Total This Period</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><p className="text-2xl font-bold text-amber-400">{(billingPreview?.results || []).reduce((n, r) => n + (r.unknown_count || 0), 0)}</p><p className="text-[11px] text-muted-foreground">Unknown Offerings</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <DollarSign className="w-4 h-4" />Pricing Configuration
            <Badge variant="outline" className="text-[10px] ml-auto">{Object.keys(pricing).length} offering items</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-[400px] overflow-auto rounded border border-border/40">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Offering</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Unit Price ({currency})</TableHead>
                  <TableHead className="text-right">Markup %</TableHead>
                  <TableHead className="text-center">Enabled</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(pricing).sort((a, b) => (a[1].category || "").localeCompare(b[1].category || "")).map(([code, cfg]) => (
                  <TableRow key={code}>
                    <TableCell className="font-medium text-sm">{cfg.label}</TableCell>
                    <TableCell className="text-[11px] text-muted-foreground font-mono">{code}</TableCell>
                    <TableCell className="text-xs">{cfg.unit}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number" step="0.01" value={cfg.unit_price}
                        onChange={e => handlePriceChange(code, "unit_price", e.target.value)}
                        className="h-7 w-24 text-right text-sm ml-auto"
                        data-testid={`price-${code}`}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number" step="1" value={cfg.markup_pct || 0}
                        onChange={e => handlePriceChange(code, "markup_pct", e.target.value)}
                        className="h-7 w-20 text-right text-sm ml-auto"
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <input
                        type="checkbox"
                        checked={cfg.enabled !== false}
                        onChange={e => handlePriceChange(code, "enabled", e.target.checked)}
                        className="h-4 w-4"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex justify-end mt-3">
            <Button size="sm" onClick={savePricing} disabled={savingPricing} data-testid="save-pricing-btn">
              {savingPricing ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}Save Pricing
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Per-Client Billing Preview ({billingPreview?.period || "—"})</CardTitle>
        </CardHeader>
        <CardContent>
          {(billingPreview?.results || []).length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-6">
              No linked Acronis tenants. Link tenants to NexusOps clients in the <strong>Tenants</strong> tab first.
            </p>
          ) : (
            <div className="space-y-3">
              {billingPreview.results.map(r => (
                <div key={r.client_id} className="border border-border/50 rounded-md p-3 space-y-2" data-testid={`billing-${r.client_id}`}>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <p className="text-sm font-semibold flex items-center gap-2">
                        {r.client_name}
                        {r.auto_bill_recurring && (
                          <Badge variant="outline" className="text-[9px] border-sky-500/40 text-sky-400">
                            <RefreshCw className="w-2.5 h-2.5 mr-0.5" />Auto-Billed
                          </Badge>
                        )}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {r.contract_id ? <span className="text-emerald-400">✓ Contract: {r.contract_name}</span> : <span className="text-amber-400">⚠ No active contract</span>}
                        {r.unknown_count > 0 && <span className="ml-2 text-amber-400">· {r.unknown_count} unknown</span>}
                        {r.active_recurring_invoices?.length > 0 && <span className="ml-2"> · {r.active_recurring_invoices.length} recurring</span>}
                      </p>
                    </div>
                    <div className="flex items-start gap-3">
                      <Button
                        size="sm"
                        variant={r.auto_bill_recurring ? "outline" : "default"}
                        className={r.auto_bill_recurring ? "text-sky-400 border-sky-500/40 hover:bg-sky-500/10" : "bg-sky-600 hover:bg-sky-700"}
                        onClick={() => handleToggleAutoBill(r)}
                        disabled={autoBillBusy === r.client_id}
                        data-testid={`auto-bill-${r.client_id}`}
                      >
                        {autoBillBusy === r.client_id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> :
                          r.auto_bill_recurring ? <XCircle className="w-3 h-3 mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                        {r.auto_bill_recurring ? "Disable Auto-Bill" : "Link to Recurring"}
                      </Button>
                      <div className="text-right">
                        <p className="text-xl font-bold text-emerald-400">{currency} {r.total.toFixed(2)}</p>
                        <p className="text-[10px] text-muted-foreground">{r.line_items.filter(l => !l.unknown).length} items</p>
                      </div>
                    </div>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Offering</TableHead>
                        <TableHead className="text-xs text-right">Quantity</TableHead>
                        <TableHead className="text-xs text-right">Unit Price</TableHead>
                        <TableHead className="text-xs text-right">Line Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {r.line_items.map((li, idx) => (
                        <TableRow key={idx} className={li.unknown ? "opacity-50" : ""}>
                          <TableCell className="text-xs">
                            {li.label}
                            {li.unknown && <Badge variant="outline" className="ml-2 text-[9px] text-amber-400 border-amber-500/30">unknown</Badge>}
                            {li.markup_pct > 0 && <Badge variant="outline" className="ml-2 text-[9px]">+{li.markup_pct}%</Badge>}
                          </TableCell>
                          <TableCell className="text-xs text-right">{li.quantity} {li.unit}</TableCell>
                          <TableCell className="text-xs text-right">{currency} {li.unit_price.toFixed(4)}</TableCell>
                          <TableCell className="text-xs text-right font-semibold">{currency} {li.total.toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!autoBillDialog} onOpenChange={v => !v && setAutoBillDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="w-5 h-5 text-sky-400" />Link Acronis Billing to Recurring Invoice
            </DialogTitle>
            <DialogDescription>
              {autoBillDialog?.client_name} has no active recurring invoices. Create one now so Acronis usage auto-attaches every period?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="border rounded-md p-3 bg-sky-500/[0.04] border-sky-500/20 text-xs space-y-1">
              <p className="font-semibold">Scaffold summary</p>
              <p className="text-muted-foreground">Client: <span className="text-foreground">{autoBillDialog?.client_name}</span></p>
              <p className="text-muted-foreground">Current Acronis usage: <span className="text-emerald-400 font-semibold">{currency} {(autoBillDialog?.total || 0).toFixed(2)}</span></p>
            </div>
            <div>
              <label className="text-xs font-medium">Billing Frequency</label>
              <Select value={autoBillFrequency} onValueChange={setAutoBillFrequency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="annually">Annually</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAutoBillDialog(null)}>Cancel</Button>
            <Button
              onClick={() => enableAutoBill(autoBillDialog.client_id, true)}
              disabled={autoBillBusy === autoBillDialog?.client_id}
              className="bg-sky-600 hover:bg-sky-700"
              data-testid="confirm-auto-bill"
            >
              {autoBillBusy === autoBillDialog?.client_id ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}
              Create & Link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
