import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Plus, Search, Loader2, FileText, Edit, Trash2, DollarSign, Package,
  Truck, CheckCircle, Clock, ArrowLeft, Send, XCircle, Eye, ShoppingCart
} from "lucide-react";
import { format } from "date-fns";

const STATUS_CONFIG = {
  draft: { label: "Draft", class: "bg-gray-500/20 text-gray-400 border-gray-500/30", icon: Clock },
  submitted: { label: "Submitted", class: "bg-blue-500/20 text-blue-400 border-blue-500/30", icon: Send },
  received: { label: "Received", class: "bg-green-500/20 text-green-400 border-green-500/30", icon: CheckCircle },
  cancelled: { label: "Cancelled", class: "bg-red-500/20 text-red-400 border-red-500/30", icon: XCircle },
};

export default function PurchaseOrdersPage() {
  const { token } = useAuth();
  const [pos, setPos] = useState([]);
  const [products, setProducts] = useState([]);
  const [clients, setClients] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewPO, setViewPO] = useState(null);
  const [form, setForm] = useState({
    vendor: "", vendor_contact: "", vendor_email: "", status: "draft",
    line_items: [], notes: "", ship_to: "", expected_delivery: "",
    client_id: "", client_name: "", shipping: "0"
  });

  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [posRes, prodRes, clientRes, statsRes] = await Promise.all([
        axios.get(`${API}/purchase-orders`, { headers }),
        axios.get(`${API}/products`, { headers }),
        axios.get(`${API}/clients`, { headers }),
        axios.get(`${API}/purchase-orders/stats`, { headers }),
      ]);
      setPos(posRes.data);
      setProducts(prodRes.data);
      setClients(clientRes.data);
      setStats(statsRes.data);
    } catch { toast.error("Failed to load data"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const resetForm = () => setForm({
    vendor: "", vendor_contact: "", vendor_email: "", status: "draft",
    line_items: [], notes: "", ship_to: "", expected_delivery: "",
    client_id: "", client_name: "", shipping: "0"
  });

  const openCreate = () => { setEditing(null); resetForm(); setIsFormOpen(true); };

  const openEdit = (po) => {
    setEditing(po);
    setForm({
      vendor: po.vendor, vendor_contact: po.vendor_contact || "", vendor_email: po.vendor_email || "",
      status: po.status, line_items: po.line_items || [], notes: po.notes || "",
      ship_to: po.ship_to || "", expected_delivery: po.expected_delivery || "",
      client_id: po.client_id || "", client_name: po.client_name || "",
      shipping: String(po.shipping || 0)
    });
    setIsFormOpen(true);
  };

  const addLineItem = () => {
    setForm(f => ({
      ...f,
      line_items: [...f.line_items, { product_id: "", product_name: "", quantity: 1, unit_price: 0 }]
    }));
  };

  const updateLineItem = (idx, field, value) => {
    setForm(f => {
      const items = [...f.line_items];
      items[idx] = { ...items[idx], [field]: value };
      if (field === "product_id") {
        const prod = products.find(p => p.id === value);
        if (prod) {
          items[idx].product_name = prod.name;
          items[idx].unit_price = prod.cost_price;
        }
      }
      return { ...f, line_items: items };
    });
  };

  const removeLineItem = (idx) => {
    setForm(f => ({ ...f, line_items: f.line_items.filter((_, i) => i !== idx) }));
  };

  const calcSubtotal = () => form.line_items.reduce((s, li) => s + (li.quantity * li.unit_price), 0);
  const calcTax = () => {
    return form.line_items.reduce((s, li) => {
      const prod = products.find(p => p.id === li.product_id);
      return s + (li.quantity * li.unit_price * (prod?.tax_rate || 0) / 100);
    }, 0);
  };

  const handleSave = async () => {
    if (!form.vendor) { toast.error("Vendor is required"); return; }
    const subtotal = calcSubtotal();
    const tax = calcTax();
    const shipping = parseFloat(form.shipping) || 0;
    const payload = { ...form, subtotal, tax, shipping, total: subtotal + tax + shipping };
    try {
      if (editing) {
        await axios.put(`${API}/purchase-orders/${editing.id}`, payload, { headers });
        toast.success("Purchase order updated");
      } else {
        await axios.post(`${API}/purchase-orders`, payload, { headers });
        toast.success("Purchase order created");
      }
      setIsFormOpen(false); fetchData();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to save"); }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API}/purchase-orders/${id}`, { headers });
      toast.success("Purchase order deleted");
      fetchData();
      if (viewPO?.id === id) setViewPO(null);
    } catch { toast.error("Failed to delete"); }
  };

  const handleStatusChange = async (po, newStatus) => {
    try {
      await axios.put(`${API}/purchase-orders/${po.id}`, { status: newStatus }, { headers });
      toast.success(`Status updated to ${newStatus}`);
      fetchData();
      if (viewPO?.id === po.id) setViewPO({ ...viewPO, status: newStatus });
    } catch { toast.error("Failed to update status"); }
  };

  const filtered = pos
    .filter(p => statusFilter === "all" || p.status === statusFilter)
    .filter(p => !search || p.po_number?.toLowerCase().includes(search.toLowerCase()) || p.vendor?.toLowerCase().includes(search.toLowerCase()));

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  // ========== DETAIL VIEW ==========
  if (viewPO) {
    const po = viewPO;
    const StatusIcon = STATUS_CONFIG[po.status]?.icon || Clock;
    return (
      <div className="space-y-6" data-testid="po-detail">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setViewPO(null)} data-testid="back-to-pos"><ArrowLeft className="w-4 h-4 mr-1" />Back to Purchase Orders</Button>
        </div>
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-8 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-2xl font-mono">{po.po_number}</CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">Vendor: {po.vendor}</p>
                  </div>
                  <Badge className={STATUS_CONFIG[po.status]?.class}><StatusIcon className="w-3 h-3 mr-1" />{STATUS_CONFIG[po.status]?.label}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead><TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Unit Price</TableHead><TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(po.line_items || []).map((li, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{li.product_name || "Item"}</TableCell>
                        <TableCell className="text-right">{li.quantity}</TableCell>
                        <TableCell className="text-right font-mono">${(li.unit_price || 0).toFixed(2)}</TableCell>
                        <TableCell className="text-right font-mono font-medium">${((li.quantity || 0) * (li.unit_price || 0)).toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <Separator className="my-3" />
                <div className="flex flex-col items-end gap-1 text-sm">
                  <div className="flex gap-8"><span className="text-muted-foreground">Subtotal</span><span className="font-mono">${(po.subtotal || 0).toFixed(2)}</span></div>
                  <div className="flex gap-8"><span className="text-muted-foreground">Tax</span><span className="font-mono">${(po.tax || 0).toFixed(2)}</span></div>
                  <div className="flex gap-8"><span className="text-muted-foreground">Shipping</span><span className="font-mono">${(po.shipping || 0).toFixed(2)}</span></div>
                  <Separator className="w-48 my-1" />
                  <div className="flex gap-8 text-base"><span className="font-semibold">Total</span><span className="font-mono font-bold text-green-500">${(po.total || 0).toFixed(2)}</span></div>
                </div>
              </CardContent>
            </Card>
            {po.notes && <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Notes</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">{po.notes}</p></CardContent></Card>}
          </div>
          <div className="col-span-4 space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Details</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div><span className="text-muted-foreground block">Vendor Contact</span><span className="font-medium">{po.vendor_contact || "N/A"}</span></div>
                <Separator />
                <div><span className="text-muted-foreground block">Vendor Email</span><span className="font-medium">{po.vendor_email || "N/A"}</span></div>
                <Separator />
                <div><span className="text-muted-foreground block">Ship To</span><span className="font-medium">{po.ship_to || "N/A"}</span></div>
                <Separator />
                <div><span className="text-muted-foreground block">Expected Delivery</span><span className="font-medium">{po.expected_delivery || "N/A"}</span></div>
                {po.client_name && <><Separator /><div><span className="text-muted-foreground block">Client</span><span className="font-medium">{po.client_name}</span></div></>}
                <Separator />
                <div><span className="text-muted-foreground block">Created By</span><span className="font-medium">{po.created_by_name || "System"}</span></div>
                <div><span className="text-muted-foreground block">Created</span><span className="font-medium">{po.created_at ? format(new Date(po.created_at), "MMM d, yyyy") : "N/A"}</span></div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Actions</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {po.status === "draft" && <Button className="w-full bg-blue-600 hover:bg-blue-700" onClick={() => handleStatusChange(po, "submitted")} data-testid="submit-po"><Send className="w-4 h-4 mr-1" />Submit to Vendor</Button>}
                {po.status === "submitted" && <Button className="w-full bg-green-600 hover:bg-green-700" onClick={() => handleStatusChange(po, "received")} data-testid="receive-po"><CheckCircle className="w-4 h-4 mr-1" />Mark Received</Button>}
                {(po.status === "draft" || po.status === "submitted") && <Button variant="outline" className="w-full" onClick={() => handleStatusChange(po, "cancelled")}><XCircle className="w-4 h-4 mr-1" />Cancel</Button>}
                <Button variant="outline" className="w-full" onClick={() => openEdit(po)} data-testid="edit-po"><Edit className="w-4 h-4 mr-1" />Edit</Button>
                <Button variant="destructive" className="w-full" onClick={() => handleDelete(po.id)} data-testid="delete-po"><Trash2 className="w-4 h-4 mr-1" />Delete</Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // ========== LIST VIEW ==========
  return (
    <div className="space-y-6" data-testid="purchase-orders-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Purchase Orders</h1>
          <p className="text-muted-foreground">{pos.length} purchase orders</p>
        </div>
        <Button onClick={openCreate} data-testid="create-po-btn"><Plus className="w-4 h-4 mr-1" />New Purchase Order</Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center"><FileText className="w-5 h-5 text-blue-500" /></div><div><p className="text-xs text-muted-foreground">Total Orders</p><p className="text-xl font-bold">{stats.total || 0}</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-yellow-500/10 flex items-center justify-center"><Clock className="w-5 h-5 text-yellow-500" /></div><div><p className="text-xs text-muted-foreground">Draft</p><p className="text-xl font-bold">{stats.draft || 0}</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center"><DollarSign className="w-5 h-5 text-green-500" /></div><div><p className="text-xs text-muted-foreground">Total Value</p><p className="text-xl font-bold">${(stats.total_value || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center"><Truck className="w-5 h-5 text-orange-500" /></div><div><p className="text-xs text-muted-foreground">Pending Value</p><p className="text-xl font-bold">${(stats.pending_value || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p></div></div></CardContent></Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search PO#, vendor..." value={search} onChange={e => setSearch(e.target.value)} data-testid="po-search" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]" data-testid="po-status-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="submitted">Submitted</SelectItem>
            <SelectItem value="received">Received</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* PO Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO #</TableHead><TableHead>Vendor</TableHead><TableHead>Client</TableHead>
                <TableHead>Items</TableHead><TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead><TableHead>Created</TableHead><TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">{search || statusFilter !== "all" ? "No purchase orders match your filters" : "No purchase orders yet."}</TableCell></TableRow>
              ) : filtered.map(po => {
                const StatusIcon = STATUS_CONFIG[po.status]?.icon || Clock;
                return (
                  <TableRow key={po.id} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setViewPO(po)} data-testid={`po-row-${po.id}`}>
                    <TableCell className="font-mono font-medium">{po.po_number}</TableCell>
                    <TableCell className="font-medium">{po.vendor}</TableCell>
                    <TableCell className="text-sm">{po.client_name || "-"}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{(po.line_items || []).length} items</Badge></TableCell>
                    <TableCell className="text-right font-mono font-medium">${(po.total || 0).toFixed(2)}</TableCell>
                    <TableCell><Badge className={STATUS_CONFIG[po.status]?.class + " text-xs"}><StatusIcon className="w-3 h-3 mr-1" />{STATUS_CONFIG[po.status]?.label}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{po.created_at ? format(new Date(po.created_at), "MMM d") : "-"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(po)}><Edit className="w-3 h-3" /></Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => handleDelete(po.id)}><Trash2 className="w-3 h-3" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* CREATE/EDIT DIALOG */}
      <Dialog open={isFormOpen} onOpenChange={v => { setIsFormOpen(v); if (!v) setEditing(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>{editing ? `Edit ${editing.po_number}` : "New Purchase Order"}</DialogTitle></DialogHeader>
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Vendor *</Label><Input value={form.vendor} onChange={e => setForm({ ...form, vendor: e.target.value })} placeholder="Vendor name" data-testid="po-vendor" /></div>
              <div><Label>Vendor Contact</Label><Input value={form.vendor_contact} onChange={e => setForm({ ...form, vendor_contact: e.target.value })} placeholder="Contact person" /></div>
              <div><Label>Vendor Email</Label><Input value={form.vendor_email} onChange={e => setForm({ ...form, vendor_email: e.target.value })} placeholder="vendor@email.com" /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Client (optional)</Label>
                <Select value={form.client_id} onValueChange={v => { const c = clients.find(cl => cl.id === v); setForm({ ...form, client_id: v, client_name: c?.name || "" }); }}>
                  <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                  <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Ship To</Label><Input value={form.ship_to} onChange={e => setForm({ ...form, ship_to: e.target.value })} placeholder="Shipping address" /></div>
              <div><Label>Expected Delivery</Label><Input type="date" value={form.expected_delivery} onChange={e => setForm({ ...form, expected_delivery: e.target.value })} /></div>
            </div>

            <Separator />

            {/* Line Items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-base font-semibold">Line Items</Label>
                <Button variant="outline" size="sm" onClick={addLineItem} data-testid="add-line-item"><Plus className="w-3 h-3 mr-1" />Add Item</Button>
              </div>
              {form.line_items.length === 0 ? (
                <div className="text-center py-6 border rounded-lg border-dashed text-muted-foreground text-sm">
                  <ShoppingCart className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  No items added yet. Click "Add Item" to begin.
                </div>
              ) : (
                <div className="space-y-2">
                  {form.line_items.map((li, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-end p-2 rounded-lg border bg-muted/20">
                      <div className="col-span-5">
                        {idx === 0 && <Label className="text-xs">Product</Label>}
                        <Select value={li.product_id} onValueChange={v => updateLineItem(idx, "product_id", v)}>
                          <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                          <SelectContent>{products.map(p => <SelectItem key={p.id} value={p.id}>{p.name} - ${p.cost_price.toFixed(2)}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-2">
                        {idx === 0 && <Label className="text-xs">Qty</Label>}
                        <Input type="number" min="1" value={li.quantity} onChange={e => updateLineItem(idx, "quantity", parseInt(e.target.value) || 1)} />
                      </div>
                      <div className="col-span-2">
                        {idx === 0 && <Label className="text-xs">Unit Price</Label>}
                        <Input type="number" step="0.01" value={li.unit_price} onChange={e => updateLineItem(idx, "unit_price", parseFloat(e.target.value) || 0)} />
                      </div>
                      <div className="col-span-2 text-right">
                        {idx === 0 && <Label className="text-xs block">Total</Label>}
                        <p className="font-mono text-sm font-medium py-2">${(li.quantity * li.unit_price).toFixed(2)}</p>
                      </div>
                      <div className="col-span-1 text-right">
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive" onClick={() => removeLineItem(idx)}><Trash2 className="w-3 h-3" /></Button>
                      </div>
                    </div>
                  ))}
                  <Separator />
                  <div className="flex items-center gap-3 justify-end">
                    <div><Label className="text-xs">Shipping ($)</Label><Input type="number" step="0.01" className="w-24" value={form.shipping} onChange={e => setForm({ ...form, shipping: e.target.value })} /></div>
                  </div>
                  <div className="flex flex-col items-end gap-1 text-sm mt-2">
                    <div className="flex gap-8"><span className="text-muted-foreground">Subtotal</span><span className="font-mono">${calcSubtotal().toFixed(2)}</span></div>
                    <div className="flex gap-8"><span className="text-muted-foreground">Tax</span><span className="font-mono">${calcTax().toFixed(2)}</span></div>
                    <div className="flex gap-8"><span className="text-muted-foreground">Shipping</span><span className="font-mono">${(parseFloat(form.shipping) || 0).toFixed(2)}</span></div>
                    <div className="flex gap-8 text-base font-semibold"><span>Total</span><span className="font-mono text-green-500">${(calcSubtotal() + calcTax() + (parseFloat(form.shipping) || 0)).toFixed(2)}</span></div>
                  </div>
                </div>
              )}
            </div>

            <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Internal notes..." rows={2} /></div>
          </div>
          <DialogFooter><Button onClick={handleSave} data-testid="save-po-btn">{editing ? "Update" : "Create"} Purchase Order</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
