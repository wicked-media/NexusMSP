import { useState, useEffect, useRef, useCallback } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Plus, Search, Loader2, FileText, Edit, Trash2, DollarSign, Package,
  Truck, CheckCircle, Clock, ArrowLeft, Send, XCircle, Eye, ShoppingCart,
  AlertTriangle, Scan, History, ChevronRight, PackageCheck, Box, RefreshCw,
  BellRing, Mail, Download, Copy, ThumbsUp, ThumbsDown, MessageSquare,
  BarChart3, TrendingUp, Printer, BookTemplate, Save, Layers
} from "lucide-react";
import { format } from "date-fns";

const STATUS_CONFIG = {
  draft: { label: "Draft", class: "bg-gray-500/20 text-gray-400 border-gray-500/30", icon: Clock, glow: "" },
  pending_approval: { label: "Pending Approval", class: "bg-purple-500/20 text-purple-400 border-purple-500/30", icon: Clock, glow: "ring-1 ring-purple-500/30 animate-pulse" },
  approved: { label: "Approved", class: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30", icon: ThumbsUp, glow: "" },
  rejected: { label: "Rejected", class: "bg-red-500/20 text-red-400 border-red-500/30", icon: ThumbsDown, glow: "" },
  submitted: { label: "Ordered", class: "bg-blue-500/20 text-blue-400 border-blue-500/30", icon: Send, glow: "ring-1 ring-blue-500/30" },
  partial: { label: "Partial", class: "bg-amber-500/20 text-amber-400 border-amber-500/30", icon: PackageCheck, glow: "ring-1 ring-amber-500/30 animate-pulse" },
  received: { label: "Received", class: "bg-green-500/20 text-green-400 border-green-500/30", icon: CheckCircle, glow: "" },
  cancelled: { label: "Cancelled", class: "bg-red-500/20 text-red-400 border-red-500/30", icon: XCircle, glow: "" },
};

const ITEM_STATUS_CONFIG = {
  pending: { label: "Pending", class: "bg-gray-500/20 text-gray-400", icon: Clock },
  partial: { label: "Partial", class: "bg-amber-500/20 text-amber-400", icon: PackageCheck },
  received: { label: "Received", class: "bg-green-500/20 text-green-400", icon: CheckCircle },
};

export default function PurchaseOrdersPage() {
  const { token } = useAuth();
  const [pos, setPos] = useState([]);
  const [products, setProducts] = useState([]);
  const [clients, setClients] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewPO, setViewPO] = useState(null);
  const [detailTab, setDetailTab] = useState("items");
  const [auditLog, setAuditLog] = useState([]);
  const [poNotes, setPoNotes] = useState([]);
  const [newNote, setNewNote] = useState("");
  const [receiveDialog, setReceiveDialog] = useState(false);
  const [receiveItems, setReceiveItems] = useState([]);
  const [scannerInput, setScannerInput] = useState("");
  const scanRef = useRef(null);
  const [approvalDialog, setApprovalDialog] = useState(null);
  const [approvalNotes, setApprovalNotes] = useState("");
  const [emailVendorDialog, setEmailVendorDialog] = useState(false);
  const [emailForm, setEmailForm] = useState({ email: "", subject: "", message: "" });
  const [spendAnalytics, setSpendAnalytics] = useState(null);
  const [analyticsTab, setAnalyticsTab] = useState("list");
  const [pdfLoading, setPdfLoading] = useState(false);
  const [form, setForm] = useState({
    vendor: "", vendor_id: "", vendor_contact: "", vendor_email: "", status: "draft",
    line_items: [], notes: "", ship_to: "", expected_delivery: "",
    client_id: "", client_name: "", shipping: "0", assigned_to: "", assigned_to_name: ""
  });

  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [posRes, prodRes, clientRes, statsRes, vendorRes, userRes] = await Promise.all([
        axios.get(`${API}/purchase-orders`, { headers }),
        axios.get(`${API}/products`, { headers }),
        axios.get(`${API}/clients`, { headers }),
        axios.get(`${API}/purchase-orders/stats`, { headers }),
        axios.get(`${API}/vendors`, { headers }),
        axios.get(`${API}/users`, { headers }),
      ]);
      setPos(posRes.data);
      setProducts(prodRes.data);
      setClients(clientRes.data);
      setStats(statsRes.data);
      setVendors(vendorRes.data);
      setUsers(userRes.data);
    } catch { toast.error("Failed to load data"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const fetchPODetail = async (poId) => {
    try {
      const [poRes, auditRes, notesRes] = await Promise.all([
        axios.get(`${API}/purchase-orders/${poId}`, { headers }),
        axios.get(`${API}/purchase-orders/${poId}/audit-log`, { headers }),
        axios.get(`${API}/purchase-orders/${poId}/notes`, { headers }),
      ]);
      setViewPO(poRes.data);
      setAuditLog(auditRes.data);
      setPoNotes(notesRes.data);
    } catch { toast.error("Failed to load PO details"); }
  };

  const fetchSpendAnalytics = async () => {
    try {
      const res = await axios.get(`${API}/purchase-orders/analytics/spend`, { headers });
      setSpendAnalytics(res.data);
    } catch { toast.error("Failed to load analytics"); }
  };

  const resetForm = () => setForm({
    vendor: "", vendor_id: "", vendor_contact: "", vendor_email: "", status: "draft",
    line_items: [], notes: "", ship_to: "", expected_delivery: "",
    client_id: "", client_name: "", shipping: "0", assigned_to: "", assigned_to_name: ""
  });

  const openCreate = (vendorPreset) => {
    setEditing(null);
    if (vendorPreset) {
      setForm({ ...resetFormObj(), vendor: vendorPreset.name, vendor_id: vendorPreset.id, vendor_contact: vendorPreset.contact_name || "", vendor_email: vendorPreset.email || "" });
    } else { resetForm(); }
    setIsFormOpen(true);
  };

  const resetFormObj = () => ({
    vendor: "", vendor_id: "", vendor_contact: "", vendor_email: "", status: "draft",
    line_items: [], notes: "", ship_to: "", expected_delivery: "",
    client_id: "", client_name: "", shipping: "0", assigned_to: "", assigned_to_name: ""
  });

  const openEdit = (po) => {
    setEditing(po);
    setForm({
      vendor: po.vendor, vendor_id: po.vendor_id || "", vendor_contact: po.vendor_contact || "",
      vendor_email: po.vendor_email || "", status: po.status,
      line_items: po.line_items || [], notes: po.notes || "",
      ship_to: po.ship_to || "", expected_delivery: po.expected_delivery || "",
      client_id: po.client_id || "", client_name: po.client_name || "",
      shipping: String(po.shipping || 0),
      assigned_to: po.assigned_to || "", assigned_to_name: po.assigned_to_name || "",
    });
    setIsFormOpen(true);
  };

  const addLineItem = () => setForm(f => ({
    ...f, line_items: [...f.line_items, { product_id: "", product_name: "", quantity: 1, unit_price: 0, received_qty: 0, status: "pending" }]
  }));

  const updateLineItem = (idx, field, value) => {
    setForm(f => {
      const items = [...f.line_items];
      items[idx] = { ...items[idx], [field]: value };
      if (field === "product_id") {
        const prod = products.find(p => p.id === value);
        if (prod) { items[idx].product_name = prod.name; items[idx].unit_price = prod.cost_price; }
      }
      return { ...f, line_items: items };
    });
  };

  const removeLineItem = (idx) => setForm(f => ({ ...f, line_items: f.line_items.filter((_, i) => i !== idx) }));
  const calcSubtotal = () => form.line_items.reduce((s, li) => s + (li.quantity * li.unit_price), 0);
  const calcTax = () => form.line_items.reduce((s, li) => {
    const prod = products.find(p => p.id === li.product_id);
    return s + (li.quantity * li.unit_price * (prod?.tax_rate || 0) / 100);
  }, 0);

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
      toast.success("Deleted");
      if (viewPO?.id === id) setViewPO(null);
      fetchData();
    } catch { toast.error("Failed to delete"); }
  };

  const handleStatusChange = async (po, newStatus) => {
    try {
      await axios.put(`${API}/purchase-orders/${po.id}`, { status: newStatus }, { headers });
      toast.success(`Status: ${newStatus}`);
      fetchData();
      if (viewPO?.id === po.id) fetchPODetail(po.id);
    } catch { toast.error("Failed to update status"); }
  };

  // --- Approval Workflow ---
  const handleSubmitForApproval = async (po) => {
    setApprovalDialog("submit");
    setApprovalNotes("");
  };

  const handleApprove = async () => {
    try {
      await axios.post(`${API}/purchase-orders/${viewPO.id}/approve`, { notes: approvalNotes }, { headers });
      toast.success("PO Approved!");
      setApprovalDialog(null);
      fetchPODetail(viewPO.id); fetchData();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const handleReject = async () => {
    try {
      await axios.post(`${API}/purchase-orders/${viewPO.id}/reject`, { reason: approvalNotes }, { headers });
      toast.success("PO Rejected");
      setApprovalDialog(null);
      fetchPODetail(viewPO.id); fetchData();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const handleSubmitApproval = async () => {
    try {
      await axios.post(`${API}/purchase-orders/${viewPO.id}/submit-for-approval`, {
        approver_id: approvalNotes ? "" : "", approver_name: ""
      }, { headers });
      toast.success("Submitted for approval");
      setApprovalDialog(null);
      fetchPODetail(viewPO.id); fetchData();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  // --- PDF ---
  const handleDownloadPdf = async (po) => {
    setPdfLoading(true);
    try {
      const res = await axios.get(`${API}/purchase-orders/${po.id}/pdf`, { headers, responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a"); a.href = url;
      a.download = `PO_${po.po_number}.pdf`; a.click();
      window.URL.revokeObjectURL(url);
      toast.success("PDF Downloaded");
    } catch { toast.error("Failed to generate PDF"); }
    finally { setPdfLoading(false); }
  };

  // --- Email Vendor ---
  const handleEmailVendor = async () => {
    try {
      await axios.post(`${API}/purchase-orders/${viewPO.id}/email-vendor`, emailForm, { headers });
      toast.success("PO emailed to vendor");
      setEmailVendorDialog(false);
      fetchPODetail(viewPO.id);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to email"); }
  };

  // --- Duplicate ---
  const handleDuplicate = async (po) => {
    try {
      const res = await axios.post(`${API}/purchase-orders/${po.id}/duplicate`, {}, { headers });
      toast.success(`Duplicated as ${res.data.po_number}`);
      fetchData();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  // --- Notes ---
  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    try {
      await axios.post(`${API}/purchase-orders/${viewPO.id}/notes`, { content: newNote, note_type: "general" }, { headers });
      setNewNote("");
      const res = await axios.get(`${API}/purchase-orders/${viewPO.id}/notes`, { headers });
      setPoNotes(res.data);
      toast.success("Note added");
    } catch { toast.error("Failed to add note"); }
  };

  // --- Receive Stock ---
  const openReceiveDialog = (po) => {
    const items = (po.line_items || []).filter(li => (li.received_qty || 0) < li.quantity);
    setReceiveItems(items.map(li => ({ ...li, receive_now: 0 })));
    setReceiveDialog(true);
  };

  const handleReceiveStock = async () => {
    if (!viewPO) return;
    const items = receiveItems.filter(ri => ri.receive_now > 0).map(ri => ({
      product_id: ri.product_id, product_name: ri.product_name, quantity: ri.receive_now
    }));
    if (items.length === 0) { toast.error("No items to receive"); return; }
    try {
      const res = await axios.post(`${API}/purchase-orders/${viewPO.id}/receive`, { items }, { headers });
      toast.success(res.data.message);
      setReceiveDialog(false);
      fetchPODetail(viewPO.id); fetchData();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to receive"); }
  };

  const handleScanReceive = (e) => {
    e.preventDefault();
    if (!scannerInput.trim()) return;
    const prod = products.find(p => p.barcode === scannerInput.trim() || p.sku === scannerInput.trim());
    if (prod) {
      setReceiveItems(prev => prev.map(ri =>
        ri.product_id === prod.id ? { ...ri, receive_now: Math.min(ri.receive_now + 1, ri.quantity - (ri.received_qty || 0)) } : ri
      ));
      toast.success(`Scanned: ${prod.name}`);
    } else { toast.error(`Product not found: ${scannerInput}`); }
    setScannerInput(""); scanRef.current?.focus();
  };

  const handleCheckEscalations = async () => {
    try {
      const res = await axios.post(`${API}/purchase-orders/check-escalations`, {}, { headers });
      toast.success(`${res.data.pings_sent} pings, ${res.data.escalations} escalations`);
    } catch { toast.error("Escalation check failed"); }
  };

  const filtered = pos
    .filter(p => statusFilter === "all" || p.status === statusFilter)
    .filter(p => !search || p.po_number?.toLowerCase().includes(search.toLowerCase()) || p.vendor?.toLowerCase().includes(search.toLowerCase()));

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  // ========== FORM DIALOG ==========
  const formDialog = (
    <Dialog open={isFormOpen} onOpenChange={v => { setIsFormOpen(v); if (!v) setEditing(null); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>{editing ? `Edit ${editing.po_number}` : "New Purchase Order"}</DialogTitle></DialogHeader>
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Vendor *</Label>
              <Select value={form.vendor_id || "__manual"} onValueChange={v => {
                if (v === "__manual") { setForm(f => ({ ...f, vendor_id: "", vendor: "", vendor_contact: "", vendor_email: "" })); return; }
                const vnd = vendors.find(x => x.id === v);
                if (vnd) setForm(f => ({ ...f, vendor_id: v, vendor: vnd.name, vendor_contact: vnd.contact_name || "", vendor_email: vnd.email || "" }));
              }}>
                <SelectTrigger data-testid="po-vendor-select"><SelectValue placeholder="Select vendor" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__manual">Type manually</SelectItem>
                  {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {!form.vendor_id && <Input className="mt-1" value={form.vendor} onChange={e => setForm({ ...form, vendor: e.target.value })} placeholder="Vendor name" data-testid="po-vendor" />}
            </div>
            <div><Label>Assigned Tech</Label>
              <Select value={form.assigned_to || "none"} onValueChange={v => { const u = users.find(x => x.id === v); setForm(f => ({ ...f, assigned_to: v === "none" ? "" : v, assigned_to_name: u?.name || "" })); }}>
                <SelectTrigger><SelectValue placeholder="Assign technician" /></SelectTrigger>
                <SelectContent><SelectItem value="none">Unassigned</SelectItem>{users.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Expected Delivery</Label><Input type="date" value={form.expected_delivery} onChange={e => setForm({ ...form, expected_delivery: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Client (optional)</Label>
              <Select value={form.client_id || "none"} onValueChange={v => { const c = clients.find(cl => cl.id === v); setForm({ ...form, client_id: v === "none" ? "" : v, client_name: c?.name || "" }); }}>
                <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent><SelectItem value="none">No client</SelectItem>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Ship To</Label><Input value={form.ship_to} onChange={e => setForm({ ...form, ship_to: e.target.value })} placeholder="Shipping address" /></div>
            <div><Label>Vendor Email</Label><Input value={form.vendor_email} onChange={e => setForm({ ...form, vendor_email: e.target.value })} /></div>
          </div>
          <Separator />
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-base font-semibold">Line Items</Label>
              <Button variant="outline" size="sm" onClick={addLineItem} data-testid="add-line-item"><Plus className="w-3 h-3 mr-1" />Add Item</Button>
            </div>
            {form.line_items.length === 0 ? (
              <div className="text-center py-6 border rounded-lg border-dashed text-muted-foreground text-sm">
                <ShoppingCart className="w-8 h-8 mx-auto mb-2 opacity-30" />No items yet.
              </div>
            ) : (
              <div className="space-y-2">
                {form.line_items.map((li, idx) => (
                  <div key={`k-${idx}`} className="grid grid-cols-12 gap-2 items-end p-2 rounded-lg border bg-muted/20">
                    <div className="col-span-5">
                      {idx === 0 && <Label className="text-xs">Product</Label>}
                      <Select value={li.product_id || "__none"} onValueChange={v => updateLineItem(idx, "product_id", v === "__none" ? "" : v)}>
                        <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                        <SelectContent><SelectItem value="__none">Custom item</SelectItem>{products.map(p => <SelectItem key={p.id} value={p.id}>{p.name} - ${p.cost_price?.toFixed(2)}</SelectItem>)}</SelectContent>
                      </Select>
                      {!li.product_id && <Input className="mt-1" value={li.product_name} onChange={e => updateLineItem(idx, "product_name", e.target.value)} placeholder="Item name" />}
                    </div>
                    <div className="col-span-2">{idx === 0 && <Label className="text-xs">Qty</Label>}<Input type="number" min="1" value={li.quantity} onChange={e => updateLineItem(idx, "quantity", parseInt(e.target.value) || 1)} /></div>
                    <div className="col-span-2">{idx === 0 && <Label className="text-xs">Unit Price</Label>}<Input type="number" step="0.01" value={li.unit_price} onChange={e => updateLineItem(idx, "unit_price", parseFloat(e.target.value) || 0)} /></div>
                    <div className="col-span-2 text-right">{idx === 0 && <Label className="text-xs block">Total</Label>}<p className="font-mono text-sm font-medium py-2">${(li.quantity * li.unit_price).toFixed(2)}</p></div>
                    <div className="col-span-1 text-right"><Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive" onClick={() => removeLineItem(idx)}><Trash2 className="w-3 h-3" /></Button></div>
                  </div>
                ))}
                <Separator />
                <div className="flex items-center gap-3 justify-end"><div><Label className="text-xs">Shipping ($)</Label><Input type="number" step="0.01" className="w-24" value={form.shipping} onChange={e => setForm({ ...form, shipping: e.target.value })} /></div></div>
                <div className="flex flex-col items-end gap-1 text-sm mt-2">
                  <div className="flex gap-8"><span className="text-muted-foreground">Subtotal</span><span className="font-mono">${calcSubtotal().toFixed(2)}</span></div>
                  <div className="flex gap-8"><span className="text-muted-foreground">Tax</span><span className="font-mono">${calcTax().toFixed(2)}</span></div>
                  <div className="flex gap-8"><span className="text-muted-foreground">Shipping</span><span className="font-mono">${(parseFloat(form.shipping) || 0).toFixed(2)}</span></div>
                  <div className="flex gap-8 text-base font-semibold"><span>Total</span><span className="font-mono text-green-500">${(calcSubtotal() + calcTax() + (parseFloat(form.shipping) || 0)).toFixed(2)}</span></div>
                </div>
              </div>
            )}
          </div>
          <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} /></div>
        </div>
        <DialogFooter><Button onClick={handleSave} data-testid="save-po-btn">{editing ? "Update" : "Create"} Purchase Order</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );

  // ========== RECEIVE STOCK DIALOG ==========
  const receiveStockDialog = (
    <Dialog open={receiveDialog} onOpenChange={setReceiveDialog}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Box className="w-5 h-5 text-green-400" />Receive Stock - {viewPO?.po_number}</DialogTitle></DialogHeader>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          <Card className="border-cyan-500/30 bg-cyan-500/5">
            <CardContent className="py-3">
              <form onSubmit={handleScanReceive} className="flex items-center gap-3">
                <Scan className="w-5 h-5 text-cyan-400 animate-pulse flex-shrink-0" />
                <Input ref={scanRef} value={scannerInput} onChange={e => setScannerInput(e.target.value)}
                  placeholder="Scan barcode to auto-add..." className="font-mono" data-testid="receive-scanner-input" autoFocus />
                <Button type="submit" size="sm">Scan</Button>
              </form>
            </CardContent>
          </Card>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Product</TableHead><TableHead className="text-right">Ordered</TableHead><TableHead className="text-right">Already Rcvd</TableHead><TableHead className="text-right">Receive Now</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {receiveItems.map((ri, idx) => {
                const remaining = ri.quantity - (ri.received_qty || 0);
                return (
                  <TableRow key={`k-${idx}`}>
                    <TableCell className="font-medium">{ri.product_name || "Item"}</TableCell>
                    <TableCell className="text-right font-mono">{ri.quantity}</TableCell>
                    <TableCell className="text-right font-mono">{ri.received_qty || 0}</TableCell>
                    <TableCell className="text-right">
                      <Input type="number" min="0" max={remaining} className="w-20 h-8 text-sm font-mono text-right ml-auto"
                        value={ri.receive_now} onChange={e => {
                          const v = Math.min(parseInt(e.target.value) || 0, remaining);
                          setReceiveItems(prev => prev.map((x, i) => i === idx ? { ...x, receive_now: v } : x));
                        }} data-testid={`receive-qty-${idx}`} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setReceiveItems(prev => prev.map(ri => ({ ...ri, receive_now: ri.quantity - (ri.received_qty || 0) })))}>Receive All</Button>
          <Button onClick={handleReceiveStock} className="bg-green-600 hover:bg-green-700" data-testid="confirm-receive-btn"><PackageCheck className="w-4 h-4 mr-1" />Confirm Receipt</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  // ========== APPROVAL DIALOG ==========
  const approvalDialogEl = (
    <Dialog open={!!approvalDialog} onOpenChange={v => { if (!v) setApprovalDialog(null); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {approvalDialog === "submit" && <><Send className="w-5 h-5 text-blue-400" />Submit for Approval</>}
            {approvalDialog === "approve" && <><ThumbsUp className="w-5 h-5 text-green-400" />Approve Purchase Order</>}
            {approvalDialog === "reject" && <><ThumbsDown className="w-5 h-5 text-red-400" />Reject Purchase Order</>}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {viewPO && (
            <div className="p-3 rounded-lg bg-muted/30 border text-sm">
              <p className="font-mono font-medium">{viewPO.po_number}</p>
              <p className="text-muted-foreground">Vendor: {viewPO.vendor} | Total: ${(viewPO.total || 0).toFixed(2)}</p>
            </div>
          )}
          <div>
            <Label>{approvalDialog === "reject" ? "Rejection Reason" : "Notes (optional)"}</Label>
            <Textarea value={approvalNotes} onChange={e => setApprovalNotes(e.target.value)} rows={3} placeholder={approvalDialog === "reject" ? "Reason for rejection..." : "Additional notes..."} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setApprovalDialog(null)}>Cancel</Button>
          {approvalDialog === "submit" && <Button onClick={handleSubmitApproval} className="bg-blue-600 hover:bg-blue-700" data-testid="confirm-submit-approval"><Send className="w-4 h-4 mr-1" />Submit</Button>}
          {approvalDialog === "approve" && <Button onClick={handleApprove} className="bg-green-600 hover:bg-green-700" data-testid="confirm-approve-btn"><ThumbsUp className="w-4 h-4 mr-1" />Approve</Button>}
          {approvalDialog === "reject" && <Button variant="destructive" onClick={handleReject} data-testid="confirm-reject-btn"><ThumbsDown className="w-4 h-4 mr-1" />Reject</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  // ========== EMAIL VENDOR DIALOG ==========
  const emailVendorDialogEl = (
    <Dialog open={emailVendorDialog} onOpenChange={setEmailVendorDialog}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Mail className="w-5 h-5 text-blue-400" />Email PO to Vendor</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Vendor Email</Label><Input value={emailForm.email} onChange={e => setEmailForm({ ...emailForm, email: e.target.value })} placeholder="vendor@example.com" data-testid="vendor-email-input" /></div>
          <div><Label>Subject</Label><Input value={emailForm.subject} onChange={e => setEmailForm({ ...emailForm, subject: e.target.value })} /></div>
          <div><Label>Message</Label><Textarea value={emailForm.message} onChange={e => setEmailForm({ ...emailForm, message: e.target.value })} rows={3} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setEmailVendorDialog(false)}>Cancel</Button>
          <Button onClick={handleEmailVendor} className="bg-blue-600 hover:bg-blue-700" data-testid="send-vendor-email-btn"><Send className="w-4 h-4 mr-1" />Send Email</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  // ========== DETAIL VIEW ==========
  if (viewPO) {
    const po = viewPO;
    const StatusIcon = STATUS_CONFIG[po.status]?.icon || Clock;
    const totalOrdered = (po.line_items || []).reduce((s, li) => s + li.quantity, 0);
    const totalReceived = (po.line_items || []).reduce((s, li) => s + (li.received_qty || 0), 0);
    const receivePct = totalOrdered > 0 ? Math.round((totalReceived / totalOrdered) * 100) : 0;
    const isOverdue = po.expected_delivery && new Date(po.expected_delivery) < new Date() && po.status !== "received" && po.status !== "cancelled";

    return (
      <div className="space-y-6" data-testid="po-detail">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => { setViewPO(null); setDetailTab("items"); }} data-testid="back-to-pos"><ArrowLeft className="w-4 h-4 mr-1" />Back</Button>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
          <span className="font-mono font-semibold text-lg">{po.po_number}</span>
          <Badge className={STATUS_CONFIG[po.status]?.class + " " + (STATUS_CONFIG[po.status]?.glow || "")}>
            <StatusIcon className="w-3 h-3 mr-1" />{STATUS_CONFIG[po.status]?.label}
          </Badge>
          {isOverdue && <Badge className="bg-red-500/20 text-red-400 border-red-500/30 animate-pulse"><AlertTriangle className="w-3 h-3 mr-1" />Overdue</Badge>}
          {po.escalated && <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30"><BellRing className="w-3 h-3 mr-1" />Escalated</Badge>}
        </div>

        {/* Approval Pipeline */}
        <Card className="border-slate-700/50 overflow-hidden">
          <CardContent className="py-3 px-4">
            <div className="flex items-center justify-between gap-2">
              {["draft", "pending_approval", "approved", "submitted", "partial", "received"].map((stage, i, arr) => {
                const isCurrent = po.status === stage;
                const isPast = arr.indexOf(po.status) > i;
                const isRejected = po.status === "rejected" && stage === "pending_approval";
                return (
                  <div key={stage} className="flex items-center gap-2 flex-1">
                    <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium transition-all ${
                      isCurrent ? "bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/40" :
                      isRejected ? "bg-red-500/20 text-red-400" :
                      isPast ? "bg-green-500/20 text-green-400" : "bg-muted/30 text-muted-foreground"
                    }`}>
                      {isPast ? <CheckCircle className="w-3 h-3" /> : isCurrent ? <Clock className="w-3 h-3 animate-pulse" /> : <div className="w-3 h-3 rounded-full border border-current opacity-40" />}
                      <span className="hidden md:inline">{STATUS_CONFIG[stage]?.label || stage}</span>
                    </div>
                    {i < arr.length - 1 && <div className={`h-0.5 flex-1 rounded ${isPast ? "bg-green-500/40" : "bg-muted/20"}`} />}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Receiving Progress */}
        {(po.status === "submitted" || po.status === "partial") && (
          <Card className="border-cyan-500/20 overflow-hidden">
            <CardContent className="py-3 px-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Receiving Progress</span>
                <span className="text-xs font-mono">{totalReceived} / {totalOrdered} items ({receivePct}%)</span>
              </div>
              <Progress value={receivePct} className="h-2" />
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-8 space-y-4">
            <Tabs value={detailTab} onValueChange={setDetailTab}>
              <TabsList>
                <TabsTrigger value="items" data-testid="tab-po-items">Items ({(po.line_items || []).length})</TabsTrigger>
                <TabsTrigger value="notes" data-testid="tab-po-notes">Notes ({poNotes.length})</TabsTrigger>
                <TabsTrigger value="audit" data-testid="tab-po-audit">Audit Trail ({auditLog.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="items">
                <Card className="mt-2">
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Item</TableHead><TableHead className="text-right">Ordered</TableHead>
                          <TableHead className="text-right">Received</TableHead>
                          <TableHead className="text-right">Pending</TableHead>
                          <TableHead className="text-right">Unit Price</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(po.line_items || []).map((li, i) => {
                          const pending = li.quantity - (li.received_qty || 0);
                          const itemStatus = li.status || (li.received_qty >= li.quantity ? "received" : li.received_qty > 0 ? "partial" : "pending");
                          const ItemIcon = ITEM_STATUS_CONFIG[itemStatus]?.icon || Clock;
                          return (
                            <TableRow key={`k-${i}`} data-testid={`po-line-item-${i}`}>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  {itemStatus === "pending" && <Box className="w-4 h-4 text-blue-400" />}
                                  {itemStatus === "partial" && <PackageCheck className="w-4 h-4 text-amber-400 animate-pulse" />}
                                  {itemStatus === "received" && <CheckCircle className="w-4 h-4 text-green-400" />}
                                  <span className="font-medium">{li.product_name || "Item"}</span>
                                </div>
                              </TableCell>
                              <TableCell className="text-right font-mono">{li.quantity}</TableCell>
                              <TableCell className="text-right font-mono font-bold text-green-400">{li.received_qty || 0}</TableCell>
                              <TableCell className="text-right font-mono">{pending > 0 ? <span className="text-amber-400">{pending}</span> : <span className="text-muted-foreground">0</span>}</TableCell>
                              <TableCell className="text-right font-mono">${(li.unit_price || 0).toFixed(2)}</TableCell>
                              <TableCell className="text-right font-mono font-medium">${((li.quantity || 0) * (li.unit_price || 0)).toFixed(2)}</TableCell>
                              <TableCell>
                                <Badge className={ITEM_STATUS_CONFIG[itemStatus]?.class + " text-xs"}>
                                  <ItemIcon className="w-3 h-3 mr-1" />{ITEM_STATUS_CONFIG[itemStatus]?.label}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                    <Separator />
                    <div className="p-4 flex flex-col items-end gap-1 text-sm">
                      <div className="flex gap-8"><span className="text-muted-foreground">Subtotal</span><span className="font-mono">${(po.subtotal || 0).toFixed(2)}</span></div>
                      <div className="flex gap-8"><span className="text-muted-foreground">Tax</span><span className="font-mono">${(po.tax || 0).toFixed(2)}</span></div>
                      <div className="flex gap-8"><span className="text-muted-foreground">Shipping</span><span className="font-mono">${(po.shipping || 0).toFixed(2)}</span></div>
                      <Separator className="w-48 my-1" />
                      <div className="flex gap-8 text-base"><span className="font-semibold">Total</span><span className="font-mono font-bold text-green-500">${(po.total || 0).toFixed(2)}</span></div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="notes">
                <Card className="mt-2">
                  <CardContent className="p-4 space-y-4">
                    <div className="flex gap-2">
                      <Textarea value={newNote} onChange={e => setNewNote(e.target.value)} placeholder="Add a note or comment..." rows={2} className="flex-1" data-testid="po-note-input" />
                      <Button onClick={handleAddNote} className="self-end" data-testid="add-po-note-btn"><MessageSquare className="w-4 h-4 mr-1" />Add</Button>
                    </div>
                    <Separator />
                    {poNotes.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground text-sm">No notes yet</div>
                    ) : (
                      <div className="space-y-3">
                        {poNotes.map(n => (
                          <div key={n.id} className="p-3 rounded-lg border bg-muted/20" data-testid={`po-note-${n.id}`}>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-medium">{n.user_name}</span>
                              <Badge variant="outline" className="text-[9px]">{n.note_type}</Badge>
                              <span className="text-[10px] text-muted-foreground ml-auto">{n.created_at ? format(new Date(n.created_at), "MMM d, HH:mm") : ""}</span>
                            </div>
                            <p className="text-sm">{n.content}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="audit">
                <Card className="mt-2">
                  <CardContent className="p-0">
                    {auditLog.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground text-sm">No audit entries yet</div>
                    ) : (
                      <Table>
                        <TableHeader><TableRow><TableHead>Action</TableHead><TableHead>Details</TableHead><TableHead>By</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {auditLog.map(l => (
                            <TableRow key={l.id}>
                              <TableCell><Badge variant="outline" className="text-xs capitalize">{l.action?.replace(/_/g, " ")}</Badge></TableCell>
                              <TableCell className="text-sm max-w-xs truncate">{l.details}</TableCell>
                              <TableCell className="text-sm font-medium">{l.user_name}</TableCell>
                              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{l.created_at ? format(new Date(l.created_at), "MMM d, HH:mm") : ""}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            {po.notes && <Card><CardHeader className="pb-2"><CardTitle className="text-sm">PO Notes</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">{po.notes}</p></CardContent></Card>}

            {/* Approval Info */}
            {po.approved_by_name && (
              <Card className="border-green-500/20">
                <CardContent className="py-3 px-4 flex items-center gap-3">
                  <ThumbsUp className="w-5 h-5 text-green-400" />
                  <div>
                    <p className="text-sm font-medium text-green-400">Approved by {po.approved_by_name}</p>
                    <p className="text-xs text-muted-foreground">{po.approved_at ? format(new Date(po.approved_at), "MMM d, yyyy HH:mm") : ""} {po.approval_notes ? `- ${po.approval_notes}` : ""}</p>
                  </div>
                </CardContent>
              </Card>
            )}
            {po.rejected_by_name && (
              <Card className="border-red-500/20">
                <CardContent className="py-3 px-4 flex items-center gap-3">
                  <ThumbsDown className="w-5 h-5 text-red-400" />
                  <div>
                    <p className="text-sm font-medium text-red-400">Rejected by {po.rejected_by_name}</p>
                    <p className="text-xs text-muted-foreground">{po.rejected_at ? format(new Date(po.rejected_at), "MMM d, yyyy HH:mm") : ""} {po.rejection_reason ? `- ${po.rejection_reason}` : ""}</p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="col-span-4 space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Details</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div><span className="text-muted-foreground block">Vendor</span><span className="font-medium">{po.vendor}</span></div>
                {po.vendor_email && <div><span className="text-muted-foreground block">Vendor Email</span><span className="font-medium text-blue-400">{po.vendor_email}</span></div>}
                <Separator />
                <div><span className="text-muted-foreground block">Assigned To</span><span className="font-medium">{po.assigned_to_name || "Unassigned"}</span></div>
                <Separator />
                <div><span className="text-muted-foreground block">Expected Delivery</span><span className={`font-medium ${isOverdue ? "text-red-400" : ""}`}>{po.expected_delivery || "N/A"}</span></div>
                {po.client_name && <><Separator /><div><span className="text-muted-foreground block">Client</span><span className="font-medium">{po.client_name}</span></div></>}
                <Separator />
                <div><span className="text-muted-foreground block">Created By</span><span className="font-medium">{po.created_by_name || "System"}</span></div>
                <div><span className="text-muted-foreground block">Created</span><span className="font-medium">{po.created_at ? format(new Date(po.created_at), "MMM d, yyyy HH:mm") : "N/A"}</span></div>
                {po.emailed_to && <><Separator /><div><span className="text-muted-foreground block">Emailed To</span><span className="font-medium text-blue-400">{po.emailed_to}</span><span className="block text-xs text-muted-foreground">{po.emailed_at ? format(new Date(po.emailed_at), "MMM d, HH:mm") : ""}</span></div></>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Actions</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {/* Approval Workflow */}
                {po.status === "draft" && (
                  <Button className="w-full bg-purple-600 hover:bg-purple-700" onClick={() => handleSubmitForApproval(po)} data-testid="submit-for-approval-btn">
                    <Send className="w-4 h-4 mr-1" />Submit for Approval
                  </Button>
                )}
                {po.status === "pending_approval" && (
                  <>
                    <Button className="w-full bg-green-600 hover:bg-green-700" onClick={() => { setApprovalDialog("approve"); setApprovalNotes(""); }} data-testid="approve-po-btn">
                      <ThumbsUp className="w-4 h-4 mr-1" />Approve
                    </Button>
                    <Button variant="destructive" className="w-full" onClick={() => { setApprovalDialog("reject"); setApprovalNotes(""); }} data-testid="reject-po-btn">
                      <ThumbsDown className="w-4 h-4 mr-1" />Reject
                    </Button>
                  </>
                )}
                {(po.status === "approved" || po.status === "draft") && (
                  <Button className="w-full bg-blue-600 hover:bg-blue-700" onClick={() => handleStatusChange(po, "submitted")} data-testid="submit-po">
                    <Send className="w-4 h-4 mr-1" />Submit to Vendor
                  </Button>
                )}
                {(po.status === "submitted" || po.status === "partial") && (
                  <Button className="w-full bg-green-600 hover:bg-green-700" onClick={() => openReceiveDialog(po)} data-testid="receive-stock-btn">
                    <PackageCheck className="w-4 h-4 mr-1" />Receive Stock
                  </Button>
                )}
                <Separator />
                {/* PDF & Email */}
                <Button variant="outline" className="w-full text-blue-400 border-blue-500/30 hover:bg-blue-500/10" onClick={() => handleDownloadPdf(po)} disabled={pdfLoading} data-testid="download-po-pdf">
                  {pdfLoading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}Download PDF
                </Button>
                <Button variant="outline" className="w-full text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" onClick={() => {
                  setEmailForm({ email: po.vendor_email || "", subject: `Purchase Order ${po.po_number}`, message: `Please find attached PO ${po.po_number}.` });
                  setEmailVendorDialog(true);
                }} data-testid="email-vendor-btn">
                  <Mail className="w-4 h-4 mr-1" />Email to Vendor
                </Button>
                <Separator />
                {/* Utility Actions */}
                <Button variant="outline" className="w-full" onClick={() => handleDuplicate(po)} data-testid="duplicate-po-btn">
                  <Copy className="w-4 h-4 mr-1" />Duplicate PO
                </Button>
                <Button variant="outline" className="w-full" onClick={() => openEdit(po)} data-testid="edit-po">
                  <Edit className="w-4 h-4 mr-1" />Edit
                </Button>
                {(po.status === "draft" || po.status === "submitted") && (
                  <Button variant="outline" className="w-full text-amber-400" onClick={() => handleStatusChange(po, "cancelled")}>
                    <XCircle className="w-4 h-4 mr-1" />Cancel PO
                  </Button>
                )}
                <Button variant="destructive" className="w-full" onClick={() => handleDelete(po.id)} data-testid="delete-po-btn">
                  <Trash2 className="w-4 h-4 mr-1" />Delete
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
        {formDialog}{receiveStockDialog}{approvalDialogEl}{emailVendorDialogEl}
      </div>
    );
  }

  // ========== ANALYTICS VIEW ==========
  if (analyticsTab === "analytics") {
    if (!spendAnalytics) fetchSpendAnalytics();
    return (
      <div className="space-y-6" data-testid="po-analytics">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">PO Spend Analytics</h1>
            <p className="text-muted-foreground">Overview of purchase order spending</p>
          </div>
          <Button variant="outline" onClick={() => setAnalyticsTab("list")} data-testid="back-to-po-list"><ArrowLeft className="w-4 h-4 mr-1" />Back to POs</Button>
        </div>
        {!spendAnalytics ? (
          <div className="flex items-center justify-center h-48"><Loader2 className="w-8 h-8 animate-spin" /></div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-4">
              <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Total Spend</p><p className="text-2xl font-bold text-green-500">${(spendAnalytics.total_spend || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p></CardContent></Card>
              <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Total POs</p><p className="text-2xl font-bold">{spendAnalytics.total_pos || 0}</p></CardContent></Card>
              <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Avg PO Value</p><p className="text-2xl font-bold">${(spendAnalytics.avg_po_value || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p></CardContent></Card>
            </div>
            <div className="grid grid-cols-2 gap-6">
              <Card>
                <CardHeader><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4" />Top Vendors by Spend</CardTitle></CardHeader>
                <CardContent>
                  {(spendAnalytics.top_vendors || []).length === 0 ? <p className="text-sm text-muted-foreground">No data</p> : (
                    <div className="space-y-2">
                      {spendAnalytics.top_vendors.map((v, i) => (
                        <div key={`k-${i}`} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                            <span className="text-sm font-medium">{v.vendor}</span>
                          </div>
                          <span className="font-mono text-sm">${v.spend.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="w-4 h-4" />Monthly Spend Trend</CardTitle></CardHeader>
                <CardContent>
                  {(spendAnalytics.monthly_spend || []).length === 0 ? <p className="text-sm text-muted-foreground">No data</p> : (
                    <div className="space-y-1">
                      {spendAnalytics.monthly_spend.map((m, i) => {
                        const maxSpend = Math.max(...spendAnalytics.monthly_spend.map(x => x.spend));
                        const pct = maxSpend > 0 ? (m.spend / maxSpend * 100) : 0;
                        return (
                          <div key={`k-${i}`} className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground w-16">{m.month}</span>
                            <div className="flex-1 h-5 bg-muted/20 rounded overflow-hidden">
                              <div className="h-full bg-blue-500/40 rounded transition-all" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs font-mono w-20 text-right">${m.spend.toLocaleString()}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
            <Card>
              <CardHeader><CardTitle className="text-sm">Status Breakdown</CardTitle></CardHeader>
              <CardContent>
                <div className="flex gap-4 flex-wrap">
                  {Object.entries(spendAnalytics.status_breakdown || {}).map(([status, count]) => (
                    <div key={status} className="flex items-center gap-2">
                      <Badge className={(STATUS_CONFIG[status]?.class || "bg-gray-500/20 text-gray-400") + " text-xs"}>{STATUS_CONFIG[status]?.label || status}</Badge>
                      <span className="font-mono text-sm font-bold">{count}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </>
        )}
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
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { setAnalyticsTab("analytics"); setSpendAnalytics(null); }} data-testid="po-analytics-btn">
            <BarChart3 className="w-4 h-4 mr-1" />Analytics
          </Button>
          <Button variant="outline" size="sm" onClick={handleCheckEscalations} data-testid="check-escalations-btn">
            <BellRing className="w-4 h-4 mr-1" />Check Escalations
          </Button>
          <Button onClick={() => openCreate(null)} data-testid="create-po-btn"><Plus className="w-4 h-4 mr-1" />New Purchase Order</Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center"><FileText className="w-5 h-5 text-blue-500" /></div><div><p className="text-xs text-muted-foreground">Total</p><p className="text-xl font-bold">{stats.total || 0}</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-gray-500/10 flex items-center justify-center"><Clock className="w-5 h-5 text-gray-400" /></div><div><p className="text-xs text-muted-foreground">Draft</p><p className="text-xl font-bold">{stats.draft || 0}</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center"><Send className="w-5 h-5 text-cyan-400" /></div><div><p className="text-xs text-muted-foreground">Ordered</p><p className="text-xl font-bold">{stats.submitted || 0}</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center"><PackageCheck className="w-5 h-5 text-amber-400" /></div><div><p className="text-xs text-muted-foreground">Partial</p><p className="text-xl font-bold">{stats.partial || 0}</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center"><DollarSign className="w-5 h-5 text-green-400" /></div><div><p className="text-xs text-muted-foreground">Total Value</p><p className="text-xl font-bold">${(stats.total_value || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p></div></div></CardContent></Card>
        {(stats.overdue || 0) > 0 && <Card className="border-red-500/30"><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center"><AlertTriangle className="w-5 h-5 text-red-400 animate-pulse" /></div><div><p className="text-xs text-muted-foreground">Overdue</p><p className="text-xl font-bold text-red-400">{stats.overdue}</p></div></div></CardContent></Card>}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search PO#, vendor..." value={search} onChange={e => setSearch(e.target.value)} data-testid="po-search" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[170px]" data-testid="po-status-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="pending_approval">Pending Approval</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="submitted">Ordered</SelectItem>
            <SelectItem value="partial">Partial</SelectItem>
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
                <TableHead>PO #</TableHead><TableHead>Vendor</TableHead><TableHead>Assigned</TableHead>
                <TableHead>Items</TableHead><TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead><TableHead>Delivery</TableHead><TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">{search || statusFilter !== "all" ? "No POs match filters" : "No purchase orders yet."}</TableCell></TableRow>
              ) : filtered.map(po => {
                const StatusIcon = STATUS_CONFIG[po.status]?.icon || Clock;
                const isOverdue = po.expected_delivery && new Date(po.expected_delivery) < new Date() && !["received", "cancelled"].includes(po.status);
                const totalOrdered = (po.line_items || []).reduce((s, li) => s + li.quantity, 0);
                const totalRcvd = (po.line_items || []).reduce((s, li) => s + (li.received_qty || 0), 0);
                return (
                  <TableRow key={po.id} className={`cursor-pointer hover:bg-muted/50 transition-colors ${isOverdue ? "bg-red-500/5" : ""}`} onClick={() => fetchPODetail(po.id)} data-testid={`po-row-${po.id}`}>
                    <TableCell className="font-mono font-medium">{po.po_number}</TableCell>
                    <TableCell className="font-medium">{po.vendor}</TableCell>
                    <TableCell className="text-sm">{po.assigned_to_name || <span className="text-muted-foreground">-</span>}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">{(po.line_items || []).length} items</Badge>
                        {totalRcvd > 0 && totalRcvd < totalOrdered && <span className="text-xs text-amber-400">{totalRcvd}/{totalOrdered} rcvd</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium">${(po.total || 0).toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge className={STATUS_CONFIG[po.status]?.class + " text-xs " + (STATUS_CONFIG[po.status]?.glow || "")}>
                        <StatusIcon className="w-3 h-3 mr-1" />{STATUS_CONFIG[po.status]?.label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {isOverdue && <AlertTriangle className="w-3 h-3 text-red-400 animate-pulse" />}
                        <span className={`text-sm ${isOverdue ? "text-red-400" : "text-muted-foreground"}`}>{po.expected_delivery || "-"}</span>
                      </div>
                    </TableCell>
                    <TableCell onClick={e => e.stopPropagation()}>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Download PDF" onClick={() => handleDownloadPdf(po)}><Download className="w-3 h-3" /></Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Duplicate" onClick={() => handleDuplicate(po)}><Copy className="w-3 h-3" /></Button>
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

      {formDialog}{receiveStockDialog}{approvalDialogEl}{emailVendorDialogEl}
    </div>
  );
}
