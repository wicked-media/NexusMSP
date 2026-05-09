import { useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Sparkles, Settings, Hash, TrendingUp, Calendar, Warehouse, ShoppingCart,
  Layers, FileCheck, Receipt, DollarSign, Percent, Plus, Trash2,
  ArrowRightLeft, Save, Upload, Download, Loader2, CheckCircle, XCircle, Calculator
} from "lucide-react";

export default function BillingProPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [tab, setTab] = useState("numbering");

  return (
    <div className="space-y-5 p-6" data-testid="billing-pro-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-emerald-500 via-cyan-600 to-violet-700 flex items-center justify-center shadow-lg shadow-emerald-500/30">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            Billing Pro
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">Best-in-class controls for invoices, products & recurring billing.</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="numbering"><Hash className="w-3.5 h-3.5 mr-1" />Numbering</TabsTrigger>
          <TabsTrigger value="approval"><FileCheck className="w-3.5 h-3.5 mr-1" />Approval</TabsTrigger>
          <TabsTrigger value="tax"><Receipt className="w-3.5 h-3.5 mr-1" />Tax / GST</TabsTrigger>
          <TabsTrigger value="mrr"><TrendingUp className="w-3.5 h-3.5 mr-1" />MRR Analytics</TabsTrigger>
          <TabsTrigger value="calendar"><Calendar className="w-3.5 h-3.5 mr-1" />Generation Calendar</TabsTrigger>
          <TabsTrigger value="warehouses"><Warehouse className="w-3.5 h-3.5 mr-1" />Warehouses</TabsTrigger>
          <TabsTrigger value="po"><ShoppingCart className="w-3.5 h-3.5 mr-1" />Purchase Orders</TabsTrigger>
          <TabsTrigger value="snapshot"><Layers className="w-3.5 h-3.5 mr-1" />Inventory Snapshot</TabsTrigger>
          <TabsTrigger value="import"><Upload className="w-3.5 h-3.5 mr-1" />Bulk Import</TabsTrigger>
        </TabsList>
        <TabsContent value="numbering"><NumberingPanel headers={headers} /></TabsContent>
        <TabsContent value="approval"><ApprovalPanel headers={headers} /></TabsContent>
        <TabsContent value="tax"><TaxPanel headers={headers} /></TabsContent>
        <TabsContent value="mrr"><MRRPanel headers={headers} /></TabsContent>
        <TabsContent value="calendar"><CalendarPanel headers={headers} /></TabsContent>
        <TabsContent value="warehouses"><WarehousesPanel headers={headers} /></TabsContent>
        <TabsContent value="po"><POPanel headers={headers} /></TabsContent>
        <TabsContent value="snapshot"><SnapshotPanel headers={headers} /></TabsContent>
        <TabsContent value="import"><BulkImportPanel headers={headers} /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ============== Numbering Panel ============== */
function NumberingPanel({ headers }) {
  const [cfg, setCfg] = useState(null);
  const [preview, setPreview] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    axios.get(`${API}/billing-pro/numbering`, { headers }).then(r => setCfg(r.data));
  }, []); // eslint-disable-line

  const previewNum = async () => {
    try {
      const r = await axios.post(`${API}/billing-pro/numbering/preview`, cfg, { headers });
      setPreview(r.data.sample);
    } catch (e) { toast.error(e.response?.data?.detail || "Preview failed"); }
  };

  const save = async () => {
    setSaving(true);
    try {
      await axios.put(`${API}/billing-pro/numbering`, cfg, { headers });
      toast.success("Numbering saved — applies to next invoice created");
    } catch { toast.error("Save failed"); }
    finally { setSaving(false); }
  };

  if (!cfg) return <Loader2 className="w-6 h-6 animate-spin mx-auto my-12" />;
  return (
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Hash className="w-4 h-4" />Smart Invoice Numbering</CardTitle></CardHeader><CardContent className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Format String</Label>
          <Input value={cfg.format} onChange={e => setCfg({ ...cfg, format: e.target.value })} data-testid="numbering-format" />
          <p className="text-[11px] text-muted-foreground mt-1">Tokens: <code>{"{YYYY}"}</code> <code>{"{YY}"}</code> <code>{"{MM}"}</code> <code>{"{FY}"}</code> <code>{"{CLIENT}"}</code> <code>{"{SEQ:05d}"}</code></p>
        </div>
        <div>
          <Label>Next Sequence #</Label>
          <Input type="number" value={cfg.next_seq} onChange={e => setCfg({ ...cfg, next_seq: parseInt(e.target.value) || 1 })} />
        </div>
        <div>
          <Label>Fiscal-Year Start Month</Label>
          <Select value={String(cfg.fy_start_month)} onValueChange={v => setCfg({ ...cfg, fy_start_month: parseInt(v) })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Array.from({ length: 12 }, (_, i) => <SelectItem key={i + 1} value={String(i + 1)}>{new Date(2000, i, 1).toLocaleString("default", { month: "long" })}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between border rounded-md px-3 py-2">
          <Label>Reset sequence on new FY?</Label>
          <Switch checked={cfg.fy_reset} onCheckedChange={v => setCfg({ ...cfg, fy_reset: v })} />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={previewNum} data-testid="preview-numbering"><Sparkles className="w-3.5 h-3.5 mr-1" />Preview</Button>
        {preview && <Badge className="text-base bg-emerald-500/10 text-emerald-300 border-emerald-500/30">{preview}</Badge>}
        <Button onClick={save} disabled={saving} className="ml-auto" data-testid="save-numbering">
          {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}Save
        </Button>
      </div>
    </CardContent></Card>
  );
}

/* ============== Approval Panel ============== */
function ApprovalPanel({ headers }) {
  const [cfg, setCfg] = useState(null);
  useEffect(() => { axios.get(`${API}/billing-pro/settings/approval`, { headers }).then(r => setCfg(r.data)); }, []); // eslint-disable-line
  const save = async () => {
    try { await axios.put(`${API}/billing-pro/settings/approval`, cfg, { headers }); toast.success("Approval settings saved"); } catch { toast.error("Save failed"); }
  };
  if (!cfg) return <Loader2 className="w-6 h-6 animate-spin mx-auto my-12" />;
  return (
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><FileCheck className="w-4 h-4" />Invoice Approval Workflow</CardTitle></CardHeader><CardContent className="space-y-4">
      <p className="text-xs text-muted-foreground">Invoices over the threshold below will be marked <Badge variant="outline">pending_approval</Badge> and require manager sign-off before they can be sent.</p>
      <div className="flex items-center justify-between border rounded-md px-3 py-2">
        <Label>Enable approval workflow</Label>
        <Switch checked={cfg.enabled} onCheckedChange={v => setCfg({ ...cfg, enabled: v })} data-testid="approval-enabled" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Threshold Amount</Label>
          <Input type="number" value={cfg.threshold} onChange={e => setCfg({ ...cfg, threshold: parseFloat(e.target.value) || 0 })} data-testid="approval-threshold" />
        </div>
        <div>
          <Label>Approver Role</Label>
          <Select value={cfg.approver_role} onValueChange={v => setCfg({ ...cfg, approver_role: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="manager">Manager</SelectItem>
              <SelectItem value="owner">Owner</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button onClick={save} data-testid="save-approval"><Save className="w-4 h-4 mr-1" />Save</Button>
    </CardContent></Card>
  );
}

/* ============== Tax / GST Compliance Panel ============== */
function TaxPanel({ headers }) {
  const [cfg, setCfg] = useState(null);
  useEffect(() => { axios.get(`${API}/billing-pro/settings/tax-compliance`, { headers }).then(r => setCfg(r.data)); }, []); // eslint-disable-line
  const save = async () => {
    try { await axios.put(`${API}/billing-pro/settings/tax-compliance`, cfg, { headers }); toast.success("Tax compliance settings saved"); } catch { toast.error("Save failed"); }
  };
  if (!cfg) return <Loader2 className="w-6 h-6 animate-spin mx-auto my-12" />;
  return (
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Receipt className="w-4 h-4" />Tax-Invoice Compliance (AU/NZ GST)</CardTitle></CardHeader><CardContent className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Country</Label>
          <Select value={cfg.country} onValueChange={v => setCfg({ ...cfg, country: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="AU">Australia</SelectItem>
              <SelectItem value="NZ">New Zealand</SelectItem>
              <SelectItem value="UK">United Kingdom</SelectItem>
              <SelectItem value="US">United States</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{cfg.country === "NZ" ? "NZBN / GST Number" : "ABN / VAT Number"}</Label>
          <Input value={cfg.abn} onChange={e => setCfg({ ...cfg, abn: e.target.value })} data-testid="abn-input" />
        </div>
        <div>
          <Label>GST/VAT %</Label>
          <Input type="number" step="0.01" value={cfg.gst_pct} onChange={e => setCfg({ ...cfg, gst_pct: parseFloat(e.target.value) || 0 })} />
        </div>
        <div className="flex items-center justify-between border rounded-md px-3 py-2">
          <Label>GST Registered</Label>
          <Switch checked={cfg.gst_registered} onCheckedChange={v => setCfg({ ...cfg, gst_registered: v })} />
        </div>
        <div className="col-span-2"><Label>Company Name (printed on invoice)</Label><Input value={cfg.company_name} onChange={e => setCfg({ ...cfg, company_name: e.target.value })} /></div>
        <div className="col-span-2"><Label>Company Address</Label><Textarea rows={2} value={cfg.company_address} onChange={e => setCfg({ ...cfg, company_address: e.target.value })} /></div>
        <div><Label>Phone</Label><Input value={cfg.company_phone} onChange={e => setCfg({ ...cfg, company_phone: e.target.value })} /></div>
        <div className="flex items-center justify-between border rounded-md px-3 py-2">
          <Label>Show "Tax Invoice" Label</Label>
          <Switch checked={cfg.show_tax_invoice_label} onCheckedChange={v => setCfg({ ...cfg, show_tax_invoice_label: v })} />
        </div>
        <div className="col-span-2 border-t pt-3 mt-2"><h4 className="text-sm font-semibold mb-2">Bank Details (for direct deposit)</h4></div>
        <div><Label>Bank Name</Label><Input value={cfg.bank_name} onChange={e => setCfg({ ...cfg, bank_name: e.target.value })} /></div>
        <div><Label>BSB / Sort Code</Label><Input value={cfg.bsb} onChange={e => setCfg({ ...cfg, bsb: e.target.value })} /></div>
        <div><Label>Account Number</Label><Input value={cfg.account_number} onChange={e => setCfg({ ...cfg, account_number: e.target.value })} /></div>
        <div><Label>Account Name</Label><Input value={cfg.account_name} onChange={e => setCfg({ ...cfg, account_name: e.target.value })} /></div>
      </div>
      <Button onClick={save} data-testid="save-tax"><Save className="w-4 h-4 mr-1" />Save</Button>
    </CardContent></Card>
  );
}

/* ============== MRR Analytics Panel ============== */
function MRRPanel({ headers }) {
  const [data, setData] = useState(null);
  useEffect(() => { axios.get(`${API}/billing-pro/recurring/mrr-analytics`, { headers }).then(r => setData(r.data)); }, []); // eslint-disable-line
  if (!data) return <Loader2 className="w-6 h-6 animate-spin mx-auto my-12" />;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-emerald-500/30 bg-emerald-500/[0.03]"><CardContent className="pt-4 pb-3"><p className="text-[11px] text-emerald-300 uppercase">Current MRR</p><p className="text-3xl font-bold text-emerald-400 font-mono mt-1">${data.current_mrr.toLocaleString()}</p><p className="text-[11px] text-muted-foreground mt-1">{data.active_count} active</p></CardContent></Card>
        <Card className="border-cyan-500/30 bg-cyan-500/[0.03]"><CardContent className="pt-4 pb-3"><p className="text-[11px] text-cyan-300 uppercase">New MRR</p><p className="text-3xl font-bold text-cyan-400 font-mono mt-1">${data.new_mrr_this_month.toLocaleString()}</p><p className="text-[11px] text-muted-foreground mt-1">this month</p></CardContent></Card>
        <Card className="border-amber-500/30 bg-amber-500/[0.03]"><CardContent className="pt-4 pb-3"><p className="text-[11px] text-amber-300 uppercase">Paused</p><p className="text-3xl font-bold text-amber-400 font-mono mt-1">${data.paused_mrr.toLocaleString()}</p><p className="text-[11px] text-muted-foreground mt-1">{data.paused_count} paused</p></CardContent></Card>
        <Card className="border-rose-500/30 bg-rose-500/[0.03]"><CardContent className="pt-4 pb-3"><p className="text-[11px] text-rose-300 uppercase">Churned</p><p className="text-3xl font-bold text-rose-400 font-mono mt-1">${data.cancelled_mrr.toLocaleString()}</p><p className="text-[11px] text-muted-foreground mt-1">{data.cancelled_count} cancelled</p></CardContent></Card>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-sm">MRR Trend — last 13 months</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-end gap-1 h-40">
            {data.by_month.map(m => {
              const max = Math.max(...data.by_month.map(x => x.mrr), 1);
              const h = Math.max(2, (m.mrr / max) * 100);
              return (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-1" title={`${m.month}: $${m.mrr.toLocaleString()}`}>
                  <div className="text-[10px] text-muted-foreground font-mono">{m.mrr ? `$${(m.mrr / 1000).toFixed(0)}k` : ""}</div>
                  <div className="w-full rounded-t bg-gradient-to-t from-cyan-500 to-emerald-400 transition-all" style={{ height: `${h}%` }} />
                  <div className="text-[10px] text-muted-foreground">{m.month.slice(5)}</div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ============== Generation Calendar ============== */
function CalendarPanel({ headers }) {
  const [data, setData] = useState(null);
  useEffect(() => { axios.get(`${API}/billing-pro/recurring/calendar?months=3`, { headers }).then(r => setData(r.data)); }, []); // eslint-disable-line
  if (!data) return <Loader2 className="w-6 h-6 animate-spin mx-auto my-12" />;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Forecast of recurring invoices to be generated through {new Date(data.horizon).toLocaleDateString()} · {data.total_events} events.</p>
      {data.months.map(m => (
        <Card key={m.month}>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center justify-between">
            <span>{new Date(m.month + "-01").toLocaleString("default", { month: "long", year: "numeric" })}</span>
            <span className="font-mono text-emerald-400">${m.total.toFixed(2)} · {m.count} invoice{m.count !== 1 ? "s" : ""}</span>
          </CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Client</TableHead><TableHead>Description</TableHead><TableHead>Frequency</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
              <TableBody>{m.events.map((e, i) => (
                <TableRow key={i}><TableCell className="text-sm">{e.date}</TableCell><TableCell>{e.client_name}</TableCell><TableCell className="text-xs text-muted-foreground">{e.description}</TableCell><TableCell><Badge variant="outline" className="text-[10px]">{e.frequency}</Badge></TableCell><TableCell className="text-right font-mono">{e.currency} {e.amount.toFixed(2)}</TableCell></TableRow>
              ))}</TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ============== Warehouses ============== */
function WarehousesPanel({ headers }) {
  const [items, setItems] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", code: "", address: "", is_default: false });
  const fetch = () => axios.get(`${API}/billing-pro/warehouses`, { headers }).then(r => setItems(r.data));
  useEffect(() => { fetch(); }, []); // eslint-disable-line
  const create = async () => {
    if (!form.name) return toast.error("Name required");
    try { await axios.post(`${API}/billing-pro/warehouses`, form, { headers }); toast.success("Location added"); setShowAdd(false); setForm({ name: "", code: "", address: "", is_default: false }); fetch(); } catch { toast.error("Create failed"); }
  };
  const remove = async (id) => {
    if (!window.confirm("Delete this location?")) return;
    try { await axios.delete(`${API}/billing-pro/warehouses/${id}`, { headers }); toast.success("Deleted"); fetch(); } catch { toast.error("Delete failed"); }
  };
  return (
    <Card><CardHeader><CardTitle className="flex items-center justify-between"><span className="flex items-center gap-2"><Warehouse className="w-4 h-4" />Stock Locations</span><Button size="sm" onClick={() => setShowAdd(true)} data-testid="add-warehouse"><Plus className="w-3.5 h-3.5 mr-1" />Add Location</Button></CardTitle></CardHeader><CardContent>
      <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Code</TableHead><TableHead>Address</TableHead><TableHead>Default</TableHead><TableHead></TableHead></TableRow></TableHeader>
        <TableBody>{items.map(w => <TableRow key={w.id} data-testid={`wh-${w.id}`}>
          <TableCell className="font-medium">{w.name}</TableCell>
          <TableCell><Badge variant="outline" className="text-[10px] font-mono">{w.code || "—"}</Badge></TableCell>
          <TableCell className="text-xs text-muted-foreground">{w.address || "—"}</TableCell>
          <TableCell>{w.is_default && <Badge className="bg-emerald-500/10 text-emerald-300 border-emerald-500/30">Default</Badge>}</TableCell>
          <TableCell><Button size="sm" variant="ghost" onClick={() => remove(w.id)}><Trash2 className="w-3.5 h-3.5 text-rose-400" /></Button></TableCell>
        </TableRow>)}</TableBody></Table>
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Stock Location</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Tech Van #1" data-testid="wh-name" /></div>
            <div><Label>Short Code</Label><Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="e.g. VAN1" maxLength={8} /></div>
            <div><Label>Address</Label><Textarea rows={2} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></div>
            <div className="flex items-center justify-between border rounded-md px-3 py-2"><Label>Set as Default</Label><Switch checked={form.is_default} onCheckedChange={v => setForm({ ...form, is_default: v })} /></div>
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button><Button onClick={create} data-testid="confirm-add-wh">Add</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </CardContent></Card>
  );
}

/* ============== Purchase Orders ============== */
function POPanel({ headers }) {
  const [pos, setPos] = useState([]);
  const fetch = () => axios.get(`${API}/billing-pro/purchase-orders`, { headers }).then(r => setPos(r.data));
  useEffect(() => { fetch(); }, []); // eslint-disable-line
  const updateStatus = async (id, status) => {
    try { await axios.put(`${API}/billing-pro/purchase-orders/${id}/status`, { status }, { headers }); toast.success(`Marked ${status}`); fetch(); } catch (e) { toast.error(e.response?.data?.detail || "Update failed"); }
  };
  if (!pos.length) return <Card><CardContent className="py-12 text-center text-muted-foreground"><ShoppingCart className="w-10 h-10 mx-auto mb-2 opacity-30" /><p>No purchase orders yet.</p><p className="text-[11px] mt-1 opacity-70">Generate one from a low-stock product in the Inventory Snapshot tab.</p></CardContent></Card>;
  return (
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><ShoppingCart className="w-4 h-4" />Purchase Orders</CardTitle></CardHeader><CardContent>
      <Table><TableHeader><TableRow><TableHead>PO #</TableHead><TableHead>Vendor</TableHead><TableHead>Items</TableHead><TableHead>Total</TableHead><TableHead>Status</TableHead><TableHead>Expected</TableHead><TableHead></TableHead></TableRow></TableHeader>
        <TableBody>{pos.map(po => <TableRow key={po.id}>
          <TableCell className="font-mono text-xs">{po.po_number}</TableCell>
          <TableCell>{po.vendor}</TableCell>
          <TableCell className="text-xs">{(po.items || []).map(i => `${i.product_name} ×${i.quantity}`).join(", ")}</TableCell>
          <TableCell className="font-mono">{po.currency} {po.total?.toFixed(2)}</TableCell>
          <TableCell><Badge variant="outline" className={`text-[10px] capitalize ${po.status === "received" ? "border-emerald-500/30 text-emerald-300" : po.status === "sent" ? "border-cyan-500/30 text-cyan-300" : po.status === "cancelled" ? "border-rose-500/30 text-rose-300" : "border-muted"}`}>{po.status}</Badge></TableCell>
          <TableCell className="text-xs">{po.expected_date}</TableCell>
          <TableCell className="text-right">
            {po.status === "draft" && <Button size="sm" variant="outline" onClick={() => updateStatus(po.id, "sent")}>Mark Sent</Button>}
            {po.status === "sent" && <Button size="sm" variant="outline" onClick={() => updateStatus(po.id, "received")} className="border-emerald-500/30 text-emerald-300"><CheckCircle className="w-3 h-3 mr-1" />Receive</Button>}
            {(po.status === "draft" || po.status === "sent") && <Button size="sm" variant="ghost" onClick={() => updateStatus(po.id, "cancelled")}><XCircle className="w-3 h-3 text-rose-400" /></Button>}
          </TableCell>
        </TableRow>)}</TableBody></Table>
    </CardContent></Card>
  );
}

/* ============== Inventory Snapshot ============== */
function SnapshotPanel({ headers }) {
  const [data, setData] = useState(null);
  const [creatingPo, setCreatingPo] = useState(null);
  const fetch = () => axios.get(`${API}/billing-pro/products/inventory/snapshot`, { headers }).then(r => setData(r.data));
  useEffect(() => { fetch(); }, []); // eslint-disable-line
  const createPo = async (productId) => {
    setCreatingPo(productId);
    try { const r = await axios.post(`${API}/billing-pro/products/${productId}/create-po`, {}, { headers }); toast.success(`Created ${r.data.po_number}`); fetch(); } catch (e) { toast.error(e.response?.data?.detail || "PO failed"); }
    finally { setCreatingPo(null); }
  };
  if (!data) return <Loader2 className="w-6 h-6 animate-spin mx-auto my-12" />;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="pt-4 pb-3"><p className="text-[10px] uppercase text-muted-foreground">Total Units</p><p className="text-3xl font-bold font-mono mt-1">{data.total_units.toLocaleString()}</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><p className="text-[10px] uppercase text-muted-foreground">Cost Value</p><p className="text-3xl font-bold font-mono mt-1">${data.total_value_cost.toLocaleString()}</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><p className="text-[10px] uppercase text-muted-foreground">Retail Value</p><p className="text-3xl font-bold text-emerald-400 font-mono mt-1">${data.total_value_retail.toLocaleString()}</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3"><p className="text-[10px] uppercase text-muted-foreground">Potential Margin</p><p className="text-3xl font-bold text-cyan-400 font-mono mt-1">${data.potential_margin.toLocaleString()}</p></CardContent></Card>
      </div>
      <Card><CardHeader><CardTitle className="text-sm">By Category</CardTitle></CardHeader><CardContent>
        <Table><TableHeader><TableRow><TableHead>Category</TableHead><TableHead className="text-right">Units</TableHead><TableHead className="text-right">Cost Value</TableHead><TableHead className="text-right">Retail Value</TableHead></TableRow></TableHeader>
          <TableBody>{data.by_category.map(c => <TableRow key={c.category}>
            <TableCell className="font-medium">{c.category}</TableCell>
            <TableCell className="text-right font-mono">{c.units}</TableCell>
            <TableCell className="text-right font-mono">${c.value_cost.toFixed(2)}</TableCell>
            <TableCell className="text-right font-mono text-emerald-400">${c.value_retail.toFixed(2)}</TableCell>
          </TableRow>)}</TableBody></Table>
      </CardContent></Card>
      <Card className={data.low_stock_count ? "border-amber-500/30" : ""}><CardHeader><CardTitle className="text-sm flex items-center justify-between"><span>Low Stock Alerts</span><Badge variant="outline" className="text-[10px]">{data.low_stock_count}</Badge></CardTitle></CardHeader><CardContent>
        {data.low_stock.length === 0 ? <p className="text-center text-muted-foreground py-6 text-sm">All stock above reorder levels — no action needed.</p> :
          <Table><TableHeader><TableRow><TableHead>Product</TableHead><TableHead>SKU</TableHead><TableHead>Vendor</TableHead><TableHead className="text-right">In Stock</TableHead><TableHead className="text-right">Reorder At</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>{data.low_stock.map(p => <TableRow key={p.id}>
              <TableCell className="font-medium">{p.name}</TableCell>
              <TableCell className="font-mono text-xs">{p.sku}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{p.vendor || "—"}</TableCell>
              <TableCell className="text-right font-mono text-rose-400">{p.qty}</TableCell>
              <TableCell className="text-right font-mono text-amber-400">{p.reorder}</TableCell>
              <TableCell className="text-right"><Button size="sm" disabled={creatingPo === p.id} onClick={() => createPo(p.id)} data-testid={`auto-po-${p.id}`}>{creatingPo === p.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <ShoppingCart className="w-3 h-3 mr-1" />}Auto-PO</Button></TableCell>
            </TableRow>)}</TableBody></Table>}
      </CardContent></Card>
    </div>
  );
}

/* ============== Bulk CSV Import ============== */
function BulkImportPanel({ headers }) {
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const sample = "Name,SKU,Category,Vendor,Cost Price,Retail Price,Stock,Reorder,Tax Rate,Description\nDell Latitude 5530,DELL-LAT5530,Hardware,Dell,1200,1700,5,2,10,Business laptop";
  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = ev => setCsv(ev.target.result);
    reader.readAsText(f);
  };
  const submit = async () => {
    setBusy(true);
    try { const r = await axios.post(`${API}/billing-pro/products/bulk-import`, { csv_text: csv }, { headers }); setResult(r.data); toast.success(`Imported ${r.data.inserted} new, updated ${r.data.updated}`); }
    catch (e) { toast.error(e.response?.data?.detail || "Import failed"); }
    finally { setBusy(false); }
  };
  return (
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Upload className="w-4 h-4" />Bulk Product Import (CSV)</CardTitle></CardHeader><CardContent className="space-y-3">
      <p className="text-xs text-muted-foreground">Migrate from Syncro/Halo/Ninja. Required column: <code>Name</code>. Recognised columns: SKU, Category, Vendor, Cost Price, Retail Price, Stock, Reorder, Tax Rate, Description, Unit. Existing SKUs are updated.</p>
      <div className="flex items-center gap-2">
        <Input type="file" accept=".csv" onChange={onFile} data-testid="csv-file" />
        <Button variant="outline" size="sm" onClick={() => setCsv(sample)}>Use Sample</Button>
      </div>
      <Textarea rows={10} value={csv} onChange={e => setCsv(e.target.value)} placeholder="Paste CSV here…" className="font-mono text-xs" data-testid="csv-text" />
      <div className="flex items-center justify-between">
        <Button onClick={submit} disabled={busy || !csv} data-testid="run-import">{busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Upload className="w-4 h-4 mr-1" />}Import</Button>
        {result && <Badge className="bg-emerald-500/10 text-emerald-300 border-emerald-500/30">+{result.inserted} new · ~{result.updated} updated · {result.errors.length} errors</Badge>}
      </div>
      {result?.errors?.length > 0 && (
        <div className="text-xs space-y-1 max-h-40 overflow-auto border rounded p-2 bg-rose-500/[0.04] border-rose-500/30">
          {result.errors.slice(0, 20).map((e, i) => <p key={i}>Row {e.row}: {e.error}</p>)}
        </div>
      )}
    </CardContent></Card>
  );
}
