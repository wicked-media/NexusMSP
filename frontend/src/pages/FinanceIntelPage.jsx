import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { PageShell } from "@/components/design-system";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Package, Boxes, DollarSign, Percent, AlertTriangle, TrendingDown, Sparkles, Plus, ShieldAlert, Zap } from "lucide-react";
import { toast } from "sonner";

function useApi(token) {
  return useMemo(() => ({
    get: (p) => axios.get(`${API}${p}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.data),
    post: (p, b) => axios.post(`${API}${p}`, b || {}, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.data),
    put: (p, b) => axios.put(`${API}${p}`, b || {}, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.data),
    del: (p) => axios.delete(`${API}${p}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.data),
  }), [token]);
}
function useFetch(api, path, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const reload = () => {
    if (!path) { setLoading(false); return; }
    setLoading(true);
    api.get(path).then(setData).catch((e) => toast.error(e.response?.data?.detail || e.message)).finally(() => setLoading(false));
  };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [path, ...deps]);
  return { data, loading, reload };
}
const fmt$ = (n) => `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

function L({ label }) {
  return <div className="py-10 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />{label}</div>;
}

export default function FinanceIntelPage() {
  const { token } = useAuth();
  const api = useApi(token);
  const [tab, setTab] = useState("margin");
  return (
    <PageShell>
      <div className="space-y-4" data-testid="finance-intel-page">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-emerald-400 mb-1 flex items-center gap-2">
            <DollarSign className="w-3 h-3" />Finance Intelligence
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Products, invoices & revenue intelligence</h1>
          <p className="text-sm text-muted-foreground">Margin · Kits · Client price book · Cash flow · Late-risk · Drift · Dispute scan.</p>
        </div>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="margin" data-testid="tab-margin"><Percent className="w-3 h-3 mr-1" />Product margin</TabsTrigger>
            <TabsTrigger value="kits" data-testid="tab-kits"><Boxes className="w-3 h-3 mr-1" />Kits & bundles</TabsTrigger>
            <TabsTrigger value="pricebook" data-testid="tab-pricebook"><Package className="w-3 h-3 mr-1" />Client price book</TabsTrigger>
            <TabsTrigger value="drift" data-testid="tab-drift"><TrendingDown className="w-3 h-3 mr-1" />Subscription drift</TabsTrigger>
            <TabsTrigger value="cashflow" data-testid="tab-cashflow"><DollarSign className="w-3 h-3 mr-1" />Cash flow forecast</TabsTrigger>
            <TabsTrigger value="late" data-testid="tab-late"><AlertTriangle className="w-3 h-3 mr-1" />Late-payment risk</TabsTrigger>
            <TabsTrigger value="invmargin" data-testid="tab-invmargin"><Percent className="w-3 h-3 mr-1" />Invoice margin</TabsTrigger>
          </TabsList>
          <TabsContent value="margin"><MarginView api={api} /></TabsContent>
          <TabsContent value="kits"><KitsView api={api} /></TabsContent>
          <TabsContent value="pricebook"><PriceBookView api={api} /></TabsContent>
          <TabsContent value="drift"><DriftView api={api} /></TabsContent>
          <TabsContent value="cashflow"><CashFlowView api={api} /></TabsContent>
          <TabsContent value="late"><LateRiskView api={api} /></TabsContent>
          <TabsContent value="invmargin"><InvoiceMarginView api={api} /></TabsContent>
        </Tabs>
      </div>
    </PageShell>
  );
}

/* ─── 1 Product Margin ─── */
function MarginView({ api }) {
  const { data, loading } = useFetch(api, "/finance/product-margin-insights");
  if (loading) return <L label="Scoring product margins…" />;
  const d = data || {};
  const summary = d.summary || {};
  return (
    <div className="space-y-3 mt-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Products" value={summary.count} color="sky" />
        <Stat label="Low margin" value={summary.low_margin_count} color="rose" />
        <Stat label="Cost erosion" value={summary.cost_erosion_count} color="amber" />
        <Stat label="Avg margin" value={`${summary.avg_margin_pct}%`} color="emerald" />
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border/40">
                <tr><th className="p-2 text-left">Product</th><th className="p-2 text-left">SKU</th><th className="p-2 text-right">Cost</th><th className="p-2 text-right">Retail</th><th className="p-2 text-right">Margin</th><th className="p-2 text-right">Cost Δ</th><th className="p-2 text-left">Status</th></tr>
              </thead>
              <tbody>
                {(d.products || []).slice(0, 50).map((p) => (
                  <tr key={p.id} className="border-b border-border/20 hover:bg-muted/30">
                    <td className="p-2">{p.name}</td>
                    <td className="p-2 text-muted-foreground">{p.sku}</td>
                    <td className="p-2 text-right">{fmt$(p.cost_price)}</td>
                    <td className="p-2 text-right">{fmt$(p.retail_price)}</td>
                    <td className={`p-2 text-right ${p.margin_pct < 10 ? "text-rose-400" : p.margin_pct < 25 ? "text-amber-400" : "text-emerald-400"}`}>{p.margin_pct}%</td>
                    <td className={`p-2 text-right ${p.cost_change_pct > 5 ? "text-amber-400" : "text-muted-foreground"}`}>{p.cost_change_pct != null ? `${p.cost_change_pct > 0 ? "+" : ""}${p.cost_change_pct}%` : "–"}</td>
                    <td className="p-2">
                      {p.status === "low_margin" && <Badge variant="outline" className="text-rose-400 border-rose-500/40 text-[10px]">LOW MARGIN</Badge>}
                      {p.status === "cost_up" && <Badge variant="outline" className="text-amber-400 border-amber-500/40 text-[10px]">COST UP</Badge>}
                      {p.status === "ok" && <Badge variant="outline" className="text-emerald-400 border-emerald-500/40 text-[10px]">OK</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ─── 2 Kits ─── */
function KitsView({ api }) {
  const { data, loading, reload } = useFetch(api, "/product-kits");
  const { data: products } = useFetch(api, "/products");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(null);
  const kits = data?.kits || [];
  const plist = Array.isArray(products) ? products : (products?.products || []);

  const save = async (k) => {
    try {
      if (k.id) await api.put(`/product-kits/${k.id}`, k);
      else await api.post("/product-kits", k);
      toast.success("Saved");
      setOpen(false); reload();
    } catch (e) { toast.error(e.message); }
  };
  const del = async (id) => { if (!window.confirm("Delete kit?")) return; await api.del(`/product-kits/${id}`); reload(); };

  if (loading) return <L label="Loading kits…" />;
  return (
    <div className="space-y-3 mt-3">
      <Button size="sm" variant="outline" className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
        onClick={() => { setDraft({ name: "", description: "", items: [], labor_hours: 0, labor_rate: 150 }); setOpen(true); }}
        data-testid="new-kit-btn"><Plus className="w-3 h-3 mr-1" />New kit</Button>
      {kits.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
          <Boxes className="w-10 h-10 mx-auto mb-2 opacity-50" />No kits yet. Create "New Hire Setup" or similar.
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {kits.map((k) => (
            <Card key={k.id} data-testid={`kit-${k.id}`}>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-sm">{k.name}</div>
                  <Badge variant="outline" className="text-emerald-400 border-emerald-500/40 text-[10px]">{k.margin_pct}% margin</Badge>
                </div>
                <div className="text-xs text-muted-foreground">{k.description}</div>
                <div className="text-xs">{(k.items || []).length} items{k.labor_hours > 0 && ` · ${k.labor_hours}h labor`}</div>
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">{fmt$(k.total_retail)}</div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => { setDraft(k); setOpen(true); }}>Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => del(k.id)} className="text-rose-400">Delete</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {open && draft && <KitEditor open={open} draft={draft} products={plist} onClose={() => setOpen(false)} onSave={save} />}
    </div>
  );
}

function KitEditor({ open, draft, products, onClose, onSave }) {
  const [d, setD] = useState(draft);
  const set = (k, v) => setD((x) => ({ ...x, [k]: v }));
  const addItem = () => set("items", [...(d.items || []), { product_id: products[0]?.id, quantity: 1 }]);
  const updItem = (i, k, v) => { const next = [...d.items]; next[i] = { ...next[i], [k]: v }; set("items", next); };
  const rmItem = (i) => set("items", d.items.filter((_, idx) => idx !== i));
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle className="text-base">{d.id ? "Edit kit" : "New kit"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Name" value={d.name} onChange={(e) => set("name", e.target.value)} data-testid="kit-name" />
          <Input placeholder="Description" value={d.description || ""} onChange={(e) => set("description", e.target.value)} />
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Products</div>
            {(d.items || []).map((it, i) => (
              <div key={i} className="flex items-center gap-2">
                <Select value={it.product_id} onValueChange={(v) => updItem(i, "product_id", v)}>
                  <SelectTrigger className="flex-1" data-testid={`kit-item-${i}`}><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-60">
                    {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input type="number" min={1} value={it.quantity} onChange={(e) => updItem(i, "quantity", parseInt(e.target.value) || 1)} className="w-20" />
                <Button size="sm" variant="ghost" onClick={() => rmItem(i)} className="text-rose-400">×</Button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={addItem} data-testid="kit-add-item"><Plus className="w-3 h-3 mr-1" />Add product</Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-[10px] uppercase text-muted-foreground">Labor hours</label><Input type="number" value={d.labor_hours || 0} onChange={(e) => set("labor_hours", parseFloat(e.target.value) || 0)} /></div>
            <div><label className="text-[10px] uppercase text-muted-foreground">Rate/hr</label><Input type="number" value={d.labor_rate || 150} onChange={(e) => set("labor_rate", parseFloat(e.target.value) || 150)} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="outline" className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" onClick={() => onSave(d)} data-testid="kit-save">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── 3 Client Price Book ─── */
function PriceBookView({ api }) {
  const { data: clients } = useFetch(api, "/clients");
  const list = Array.isArray(clients) ? clients : (clients?.clients || []);
  const [cid, setCid] = useState("");
  useEffect(() => { if (!cid && list[0]) setCid(list[0].id); }, [list, cid]);
  const { data, loading, reload } = useFetch(api, cid ? `/clients/${cid}/price-book` : null, [cid]);
  const { data: products } = useFetch(api, "/products");
  const plist = Array.isArray(products) ? products : (products?.products || []);
  const [draft, setDraft] = useState({ product_id: "", override_price: 0, reason: "" });

  const save = async () => {
    if (!draft.product_id) return toast.error("pick a product");
    try {
      await api.post(`/clients/${cid}/price-book`, draft);
      toast.success("Saved");
      setDraft({ product_id: "", override_price: 0, reason: "" });
      reload();
    } catch (e) { toast.error(e.message); }
  };
  const del = async (pid) => { await api.del(`/clients/${cid}/price-book/${pid}`); reload(); };

  return (
    <div className="space-y-3 mt-3">
      <Select value={cid} onValueChange={setCid}>
        <SelectTrigger className="max-w-sm" data-testid="pricebook-client"><SelectValue placeholder="Pick client" /></SelectTrigger>
        <SelectContent className="max-h-72">{list.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
      </Select>
      {loading ? <L label="Loading overrides…" /> : (
        <>
          <Card><CardContent className="p-3 space-y-2">
            <div className="text-[10px] uppercase tracking-widest text-emerald-400">Add override</div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <Select value={draft.product_id} onValueChange={(v) => setDraft({ ...draft, product_id: v })}>
                <SelectTrigger data-testid="pricebook-product"><SelectValue placeholder="Product" /></SelectTrigger>
                <SelectContent className="max-h-72">{plist.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
              <Input type="number" placeholder="Override price" value={draft.override_price} onChange={(e) => setDraft({ ...draft, override_price: parseFloat(e.target.value) || 0 })} data-testid="pricebook-price" />
              <Input placeholder="Reason (optional)" value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} />
              <Button size="sm" variant="outline" className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" onClick={save} data-testid="pricebook-save">Save</Button>
            </div>
          </CardContent></Card>
          <Card><CardContent className="p-0">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border/40">
                <tr><th className="p-2 text-left">Product</th><th className="p-2 text-right">Standard</th><th className="p-2 text-right">Override</th><th className="p-2 text-right">Δ</th><th className="p-2 text-left">Reason</th><th className="p-2"></th></tr>
              </thead>
              <tbody>
                {(data?.overrides || []).map((o) => (
                  <tr key={o.product_id} className="border-b border-border/20">
                    <td className="p-2">{o.product_name}</td>
                    <td className="p-2 text-right">{fmt$(o.standard_price)}</td>
                    <td className="p-2 text-right">{fmt$(o.override_price)}</td>
                    <td className={`p-2 text-right ${o.delta_pct < 0 ? "text-rose-400" : "text-emerald-400"}`}>{o.delta_pct > 0 ? "+" : ""}{o.delta_pct}%</td>
                    <td className="p-2 text-muted-foreground">{o.reason || "—"}</td>
                    <td className="p-2"><Button size="sm" variant="ghost" className="text-rose-400" onClick={() => del(o.product_id)}>×</Button></td>
                  </tr>
                ))}
                {(data?.overrides || []).length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No overrides — this client uses standard pricing.</td></tr>}
              </tbody>
            </table>
          </CardContent></Card>
        </>
      )}
    </div>
  );
}

/* ─── 4 Subscription Drift ─── */
function DriftView({ api }) {
  const { data, loading } = useFetch(api, "/subscription-drift");
  if (loading) return <L label="Scanning Pax8 vs M365 usage…" />;
  const d = data || {};
  return (
    <div className="space-y-3 mt-3">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Stat label="Findings" value={d.count || 0} color="amber" />
        <Stat label="Monthly waste" value={fmt$(d.total_monthly_waste_aud)} color="rose" />
        <Stat label="Annual waste" value={fmt$(d.annual_waste_aud)} color="rose" />
      </div>
      {(d.findings || []).length === 0 ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No drift detected. Licenses are aligned with active users.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {(d.findings || []).map((f, i) => (
            <Card key={i} className="border-l-2 border-l-amber-500/60">
              <CardContent className="p-3 flex items-center gap-3 flex-wrap">
                <TrendingDown className="w-4 h-4 text-amber-400" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{f.client_name} · {f.product_name}</div>
                  <div className="text-xs text-muted-foreground">{f.seats_used}/{f.seats_paid} seats used · <span className="text-rose-400">{f.unused_seats} unused</span></div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-rose-400">{fmt$(f.wasted_monthly_aud)}/mo</div>
                  <Badge variant="outline" className="text-[10px]">{f.recommendation}</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── 5 Cash Flow ─── */
function CashFlowView({ api }) {
  const { data, loading } = useFetch(api, "/finance/cash-flow-forecast");
  if (loading) return <L label="Forecasting cash flow…" />;
  const d = data || {};
  return (
    <div className="space-y-3 mt-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {["30d", "60d", "90d"].map((k) => (
          <Card key={k}>
            <CardContent className="p-4">
              <div className="text-[10px] uppercase tracking-widest text-emerald-400">Next {k}</div>
              <div className="text-2xl font-semibold mt-1">{fmt$(d.projected?.[k])}</div>
              <div className="text-xs text-muted-foreground mt-1">Risk-adjusted: {fmt$(d.risk_adjusted?.[k])}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card><CardContent className="p-3 text-xs text-muted-foreground">
        Projections include open-invoice balances (weighted by churn risk) and active recurring-invoice generations.
        Total open balance: <span className="text-foreground font-medium">{fmt$(d.total_open_invoice_balance)}</span>
      </CardContent></Card>
    </div>
  );
}

/* ─── 6 Late Payment Risk ─── */
function LateRiskView({ api }) {
  const { data, loading } = useFetch(api, "/finance/invoices/late-payment-risk");
  if (loading) return <L label="Scoring late-payment risk…" />;
  const s = data?.summary || {};
  return (
    <div className="space-y-3 mt-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Total open" value={s.total} color="sky" />
        <Stat label="High risk" value={s.high_risk} color="rose" />
        <Stat label="Medium" value={s.medium_risk} color="amber" />
        <Stat label="Low" value={s.low_risk} color="emerald" />
      </div>
      <Card><CardContent className="p-0">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border/40">
            <tr><th className="p-2 text-left">Invoice</th><th className="p-2 text-left">Client</th><th className="p-2 text-right">Balance</th><th className="p-2 text-right">Score</th><th className="p-2 text-left">Band</th><th className="p-2 text-left">Reasons</th></tr>
          </thead>
          <tbody>
            {(data?.invoices || []).map((i) => (
              <tr key={i.id} className="border-b border-border/20">
                <td className="p-2 font-mono text-[10px]">{i.invoice_number}</td>
                <td className="p-2">{i.client_name}</td>
                <td className="p-2 text-right">{fmt$(i.total - (i.amount_paid || 0))}</td>
                <td className={`p-2 text-right font-semibold ${i.band === "high" ? "text-rose-400" : i.band === "medium" ? "text-amber-400" : "text-emerald-400"}`}>{i.score}</td>
                <td className="p-2"><Badge variant="outline" className={`text-[10px] uppercase ${i.band === "high" ? "text-rose-400 border-rose-500/40" : i.band === "medium" ? "text-amber-400 border-amber-500/40" : "text-emerald-400 border-emerald-500/40"}`}>{i.band}</Badge></td>
                <td className="p-2 text-muted-foreground text-[11px]">{(i.reasons || []).join(" · ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}

/* ─── 7 Invoice Margin ─── */
function InvoiceMarginView({ api }) {
  const { data, loading } = useFetch(api, "/finance/margin-overview?days=90");
  if (loading) return <L label="Calculating 90-day margins…" />;
  const d = data || {};
  return (
    <div className="space-y-3 mt-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Revenue 90d" value={fmt$(d.total_revenue)} color="emerald" />
        <Stat label="Cost 90d" value={fmt$(d.total_cost)} color="rose" />
        <Stat label="Profit" value={fmt$(d.total_profit)} color="emerald" />
        <Stat label="Margin %" value={`${d.margin_pct || 0}%`} color="sky" />
      </div>
      <Card><CardContent className="p-0">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border/40">
            <tr><th className="p-2 text-left">Client</th><th className="p-2 text-right">Revenue</th><th className="p-2 text-right">Cost</th><th className="p-2 text-right">Profit</th><th className="p-2 text-right">Margin %</th></tr>
          </thead>
          <tbody>
            {(d.clients || []).map((c) => (
              <tr key={c.client_id} className="border-b border-border/20">
                <td className="p-2">{c.client_name}</td>
                <td className="p-2 text-right">{fmt$(c.revenue)}</td>
                <td className="p-2 text-right text-muted-foreground">{fmt$(c.cost)}</td>
                <td className="p-2 text-right">{fmt$(c.profit)}</td>
                <td className={`p-2 text-right font-semibold ${c.margin_pct < 20 ? "text-rose-400" : c.margin_pct < 40 ? "text-amber-400" : "text-emerald-400"}`}>{c.margin_pct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}

function Stat({ label, value, color = "sky" }) {
  return (
    <Card><CardContent className="p-3">
      <div className={`text-[10px] uppercase tracking-widest text-${color}-400`}>{label}</div>
      <div className="text-xl font-semibold mt-1">{value}</div>
    </CardContent></Card>
  );
}
