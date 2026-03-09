import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Plus, Search, FileText, Loader2, DollarSign, Send, Check, ArrowLeft,
  CreditCard, AlertTriangle, Clock, XCircle, CheckCircle, Trash2, Edit,
  Receipt, TrendingUp, Eye, Banknote
} from "lucide-react";
import { format, formatDistanceToNow, isPast, parseISO } from "date-fns";

const PAYMENT_STATUS = {
  unpaid: { label: "Not Paid", class: "bg-red-500/20 text-red-400 border-red-500/30", icon: XCircle },
  partial: { label: "Partial", class: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", icon: Clock },
  paid: { label: "Paid", class: "bg-green-500/20 text-green-400 border-green-500/30", icon: CheckCircle },
};

const STATUS_CONFIG = {
  draft: { label: "Draft", class: "bg-gray-500/10 text-gray-400 border-gray-500/20" },
  sent: { label: "Sent", class: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  paid: { label: "Paid", class: "bg-green-500/10 text-green-400 border-green-500/20" },
  overdue: { label: "Overdue", class: "bg-red-500/10 text-red-400 border-red-500/20" },
  cancelled: { label: "Cancelled", class: "bg-gray-500/10 text-gray-500 border-gray-500/20" },
};

export default function InvoicesPage() {
  const { token } = useAuth();
  const [searchParams] = useSearchParams();
  const [invoices, setInvoices] = useState([]);
  const [clients, setClients] = useState([]);
  const [products, setProducts] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPayment, setFilterPayment] = useState("all");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewInvoice, setViewInvoice] = useState(null);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ amount: "", method: "manual", reference: "" });
  const [payingInvoice, setPayingInvoice] = useState(null);
  const [form, setForm] = useState({
    client_id: "", contract_id: "", due_date: "", notes: "",
    line_items: [], tax_rate: "0"
  });

  const headers = { Authorization: `Bearer ${token}` };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [invRes, clientRes, prodRes, statsRes] = await Promise.all([
        axios.get(`${API}/invoices`, { headers }),
        axios.get(`${API}/clients`, { headers }),
        axios.get(`${API}/products`, { headers }),
        axios.get(`${API}/invoices/stats/summary`, { headers }),
      ]);
      setInvoices(invRes.data);
      setClients(clientRes.data);
      setProducts(prodRes.data);
      setStats(statsRes.data);
    } catch { toast.error("Failed to load invoices"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Check for Stripe payment callback
  useEffect(() => {
    const success = searchParams.get("payment_success");
    const sessionId = searchParams.get("session_id");
    if (success === "true" && sessionId) {
      // Verify payment status
      const checkPayment = async () => {
        try {
          const inv = invoices.find(i => i.stripe_session_id === sessionId);
          if (inv) {
            await axios.get(`${API}/invoices/${inv.id}/payment-status?session_id=${sessionId}`, { headers });
            toast.success("Payment processed successfully!");
            fetchAll();
          }
        } catch (e) { console.error(e); }
      };
      if (invoices.length > 0) checkPayment();
    }
  }, [searchParams, invoices.length]);

  const resetForm = () => setForm({ client_id: "", contract_id: "", due_date: "", notes: "", line_items: [], tax_rate: "0" });

  const openCreate = () => { setEditing(null); resetForm(); setIsFormOpen(true); };
  const openEdit = (inv) => {
    setEditing(inv);
    setForm({
      client_id: inv.client_id, contract_id: inv.contract_id || "", due_date: inv.due_date,
      notes: inv.notes || "", line_items: inv.line_items || [], tax_rate: String(inv.tax_rate || 0)
    });
    setIsFormOpen(true);
  };

  const addLineItem = () => setForm(f => ({ ...f, line_items: [...f.line_items, { name: "", description: "", quantity: 1, unit_price: 0, product_id: "" }] }));

  const updateLineItem = (idx, field, value) => {
    setForm(f => {
      const items = [...f.line_items];
      items[idx] = { ...items[idx], [field]: value };
      if (field === "product_id" && value) {
        const prod = products.find(p => p.id === value);
        if (prod) {
          items[idx].name = prod.name;
          items[idx].unit_price = prod.retail_price;
          items[idx].description = prod.sku || "";
        }
      }
      items[idx].total = (items[idx].quantity || 0) * (items[idx].unit_price || 0);
      return { ...f, line_items: items };
    });
  };

  const removeLineItem = (idx) => setForm(f => ({ ...f, line_items: f.line_items.filter((_, i) => i !== idx) }));

  const calcSubtotal = () => form.line_items.reduce((s, li) => s + ((li.quantity || 0) * (li.unit_price || 0)), 0);

  const handleSave = async () => {
    if (!form.client_id) { toast.error("Client is required"); return; }
    if (!form.due_date) { toast.error("Due date is required"); return; }
    const payload = {
      ...form,
      tax_rate: parseFloat(form.tax_rate) || 0,
      line_items: form.line_items.map(li => ({ ...li, total: (li.quantity || 0) * (li.unit_price || 0) }))
    };
    try {
      if (editing) {
        const subtotal = payload.line_items.reduce((s, li) => s + li.total, 0);
        const tax = subtotal * (payload.tax_rate / 100);
        await axios.put(`${API}/invoices/${editing.id}`, { ...payload, subtotal, tax, total: subtotal + tax }, { headers });
        toast.success("Invoice updated");
      } else {
        await axios.post(`${API}/invoices`, payload, { headers });
        toast.success("Invoice created");
      }
      setIsFormOpen(false); fetchAll();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to save"); }
  };

  const handleDelete = async (id) => {
    try { await axios.delete(`${API}/invoices/${id}`, { headers }); toast.success("Deleted"); fetchAll(); if (viewInvoice?.id === id) setViewInvoice(null); }
    catch { toast.error("Failed"); }
  };

  const handleStatusChange = async (inv, status) => {
    try { await axios.put(`${API}/invoices/${inv.id}`, { status }, { headers }); toast.success(`Status: ${status}`); fetchAll(); if (viewInvoice?.id === inv.id) setViewInvoice({ ...viewInvoice, status }); }
    catch { toast.error("Failed"); }
  };

  const handleStripePayment = async (inv) => {
    try {
      const res = await axios.post(`${API}/invoices/${inv.id}/pay`, { origin_url: window.location.origin }, { headers });
      if (res.data.url) window.location.href = res.data.url;
    } catch (e) { toast.error(e.response?.data?.detail || "Payment failed"); }
  };

  const handleManualPayment = async () => {
    if (!paymentForm.amount || parseFloat(paymentForm.amount) <= 0) { toast.error("Enter valid amount"); return; }
    try {
      await axios.post(`${API}/invoices/${payingInvoice.id}/record-payment`, paymentForm, { headers });
      toast.success("Payment recorded");
      setIsPaymentOpen(false);
      fetchAll();
      if (viewInvoice?.id === payingInvoice.id) {
        const updated = await axios.get(`${API}/invoices/${payingInvoice.id}`, { headers });
        setViewInvoice(updated.data);
      }
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const filtered = invoices
    .filter(i => filterStatus === "all" || i.status === filterStatus)
    .filter(i => filterPayment === "all" || (i.payment_status || "unpaid") === filterPayment)
    .filter(i => !search || i.invoice_number?.toLowerCase().includes(search.toLowerCase()) || i.client_name?.toLowerCase().includes(search.toLowerCase()));

  const getEffectiveStatus = (inv) => {
    if (inv.payment_status === "paid") return "paid";
    if (inv.due_date && isPast(parseISO(inv.due_date)) && inv.payment_status !== "paid") return "overdue";
    return inv.status;
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  // ========== DETAIL VIEW ==========
  if (viewInvoice) {
    const inv = viewInvoice;
    const pStatus = inv.payment_status || "unpaid";
    const PayIcon = PAYMENT_STATUS[pStatus]?.icon || XCircle;
    const balance = (inv.total || 0) - (inv.amount_paid || 0);
    return (
      <div className="space-y-6" data-testid="invoice-detail">
        <Button variant="ghost" size="sm" onClick={() => setViewInvoice(null)} data-testid="back-to-invoices"><ArrowLeft className="w-4 h-4 mr-1" />Back to Invoices</Button>
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-8 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-2xl font-mono">{inv.invoice_number}</CardTitle>
                    <p className="text-muted-foreground mt-1">Client: <span className="font-medium text-foreground">{inv.client_name}</span></p>
                  </div>
                  <div className="flex gap-2">
                    <Badge className={PAYMENT_STATUS[pStatus]?.class}><PayIcon className="w-3 h-3 mr-1" />{PAYMENT_STATUS[pStatus]?.label}</Badge>
                    <Badge className={STATUS_CONFIG[inv.status]?.class}>{STATUS_CONFIG[inv.status]?.label}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Price</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(inv.line_items || []).map((li, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{li.name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{li.description || "-"}</TableCell>
                        <TableCell className="text-right">{li.quantity}</TableCell>
                        <TableCell className="text-right font-mono">${(li.unit_price || 0).toFixed(2)}</TableCell>
                        <TableCell className="text-right font-mono font-medium">${((li.quantity || 0) * (li.unit_price || 0)).toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <Separator className="my-3" />
                <div className="flex flex-col items-end gap-1 text-sm">
                  <div className="flex gap-12"><span className="text-muted-foreground">Subtotal</span><span className="font-mono">${(inv.subtotal || 0).toFixed(2)}</span></div>
                  <div className="flex gap-12"><span className="text-muted-foreground">Tax ({inv.tax_rate || 0}%)</span><span className="font-mono">${(inv.tax || 0).toFixed(2)}</span></div>
                  <Separator className="w-48 my-1" />
                  <div className="flex gap-12 text-base"><span className="font-semibold">Total</span><span className="font-mono font-bold">${(inv.total || 0).toFixed(2)}</span></div>
                  {(inv.amount_paid || 0) > 0 && <div className="flex gap-12"><span className="text-green-500">Amount Paid</span><span className="font-mono text-green-500">-${(inv.amount_paid || 0).toFixed(2)}</span></div>}
                  {balance > 0 && <div className="flex gap-12 text-lg"><span className="font-bold text-red-500">Balance Due</span><span className="font-mono font-bold text-red-500">${balance.toFixed(2)}</span></div>}
                </div>
              </CardContent>
            </Card>

            {/* Payment History */}
            {(inv.payments || []).length > 0 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Banknote className="w-4 h-4" />Payment History</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Method</TableHead><TableHead>Reference</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {(inv.payments || []).map((p, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-sm">{p.date ? format(new Date(p.date), "MMM d, yyyy h:mm a") : "-"}</TableCell>
                          <TableCell><Badge variant="outline" className="capitalize text-xs">{p.method}</Badge></TableCell>
                          <TableCell className="text-sm">{p.reference || p.session_id?.slice(0, 12) || "-"}</TableCell>
                          <TableCell className="text-right font-mono font-medium text-green-500">${(p.amount || 0).toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
            {inv.notes && <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Notes</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">{inv.notes}</p></CardContent></Card>}
          </div>

          <div className="col-span-4 space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Details</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div><span className="text-muted-foreground block">Due Date</span><span className={`font-medium ${inv.due_date && isPast(parseISO(inv.due_date)) && pStatus !== "paid" ? "text-red-500" : ""}`}>{inv.due_date ? format(parseISO(inv.due_date), "MMM d, yyyy") : "N/A"}</span></div>
                <Separator />
                <div><span className="text-muted-foreground block">Created</span><span className="font-medium">{inv.created_at ? format(new Date(inv.created_at), "MMM d, yyyy") : "N/A"}</span></div>
                {inv.paid_date && <><Separator /><div><span className="text-muted-foreground block">Paid Date</span><span className="font-medium text-green-500">{format(parseISO(inv.paid_date), "MMM d, yyyy")}</span></div></>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Actions</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {pStatus !== "paid" && (
                  <>
                    <Button className="w-full bg-green-600 hover:bg-green-700" onClick={() => handleStripePayment(inv)} data-testid="stripe-pay-btn">
                      <CreditCard className="w-4 h-4 mr-1" />Pay with Stripe
                    </Button>
                    <Button variant="outline" className="w-full" onClick={() => { setPayingInvoice(inv); setPaymentForm({ amount: String(balance.toFixed(2)), method: "manual", reference: "" }); setIsPaymentOpen(true); }} data-testid="record-payment-btn">
                      <Banknote className="w-4 h-4 mr-1" />Record Manual Payment
                    </Button>
                  </>
                )}
                {inv.status === "draft" && <Button variant="outline" className="w-full" onClick={() => handleStatusChange(inv, "sent")}><Send className="w-4 h-4 mr-1" />Mark as Sent</Button>}
                <Button variant="outline" className="w-full" onClick={() => openEdit(inv)} data-testid="edit-invoice-btn"><Edit className="w-4 h-4 mr-1" />Edit</Button>
                <Button variant="destructive" className="w-full" onClick={() => handleDelete(inv.id)}><Trash2 className="w-4 h-4 mr-1" />Delete</Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // ========== LIST VIEW ==========
  return (
    <div className="space-y-6" data-testid="invoices-page">
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-bold tracking-tight">Invoices</h1><p className="text-muted-foreground">{invoices.length} invoices</p></div>
        <Button onClick={openCreate} data-testid="create-invoice-btn"><Plus className="w-4 h-4 mr-1" />New Invoice</Button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center"><FileText className="w-5 h-5 text-blue-500" /></div><div><p className="text-xs text-muted-foreground">Total</p><p className="text-xl font-bold">{stats.total || 0}</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center"><CheckCircle className="w-5 h-5 text-green-500" /></div><div><p className="text-xs text-muted-foreground">Paid</p><p className="text-xl font-bold text-green-500">{stats.paid || 0}</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center"><XCircle className="w-5 h-5 text-red-500" /></div><div><p className="text-xs text-muted-foreground">Unpaid</p><p className="text-xl font-bold text-red-500">{stats.unpaid || 0}</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center"><TrendingUp className="w-5 h-5 text-green-500" /></div><div><p className="text-xs text-muted-foreground">Collected</p><p className="text-xl font-bold">${(stats.total_collected || 0).toLocaleString(undefined, { minimumFractionDigits: 0 })}</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center"><AlertTriangle className="w-5 h-5 text-orange-500" /></div><div><p className="text-xs text-muted-foreground">Outstanding</p><p className="text-xl font-bold text-orange-500">${(stats.total_outstanding || 0).toLocaleString(undefined, { minimumFractionDigits: 0 })}</p></div></div></CardContent></Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search invoice #, client..." value={search} onChange={e => setSearch(e.target.value)} data-testid="invoice-search" />
        </div>
        <Select value={filterPayment} onValueChange={setFilterPayment}>
          <SelectTrigger className="w-[140px]" data-testid="payment-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Payments</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="unpaid">Not Paid</SelectItem>
            <SelectItem value="partial">Partial</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Invoice Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead><TableHead>Client</TableHead><TableHead>Due Date</TableHead>
                <TableHead className="text-right">Total</TableHead><TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Balance</TableHead><TableHead>Payment</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center py-12 text-muted-foreground">No invoices found</TableCell></TableRow>
              ) : filtered.map(inv => {
                const pStatus = inv.payment_status || "unpaid";
                const PayIcon = PAYMENT_STATUS[pStatus]?.icon || XCircle;
                const effectiveStatus = getEffectiveStatus(inv);
                const balance = (inv.total || 0) - (inv.amount_paid || 0);
                const isOverdue = inv.due_date && isPast(parseISO(inv.due_date)) && pStatus !== "paid";
                return (
                  <TableRow key={inv.id} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setViewInvoice(inv)} data-testid={`invoice-row-${inv.id}`}>
                    <TableCell className="font-mono font-medium">{inv.invoice_number}</TableCell>
                    <TableCell>{inv.client_name}</TableCell>
                    <TableCell className={isOverdue ? "text-red-500 font-medium" : ""}>{inv.due_date ? format(parseISO(inv.due_date), "MMM d, yyyy") : "-"}{isOverdue && <AlertTriangle className="w-3 h-3 inline ml-1" />}</TableCell>
                    <TableCell className="text-right font-mono">${(inv.total || 0).toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono text-green-500">${(inv.amount_paid || 0).toFixed(2)}</TableCell>
                    <TableCell className={`text-right font-mono font-medium ${balance > 0 ? 'text-red-500' : 'text-green-500'}`}>${balance.toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge className={PAYMENT_STATUS[pStatus]?.class + " text-[10px]"}>
                        <PayIcon className="w-3 h-3 mr-1" />{PAYMENT_STATUS[pStatus]?.label}
                      </Badge>
                    </TableCell>
                    <TableCell><Badge className={STATUS_CONFIG[effectiveStatus]?.class + " text-[10px]"}>{STATUS_CONFIG[effectiveStatus]?.label}</Badge></TableCell>
                    <TableCell>
                      <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                        {pStatus !== "paid" && <Button variant="ghost" size="sm" className="h-7 text-green-500 hover:text-green-400 text-xs px-2" onClick={() => handleStripePayment(inv)} data-testid={`pay-btn-${inv.id}`}><CreditCard className="w-3 h-3 mr-1" />Pay</Button>}
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => handleDelete(inv.id)}><Trash2 className="w-3 h-3" /></Button>
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
          <DialogHeader><DialogTitle>{editing ? `Edit ${editing.invoice_number}` : "New Invoice"}</DialogTitle></DialogHeader>
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Client *</Label>
                <Select value={form.client_id} onValueChange={v => setForm({ ...form, client_id: v })}>
                  <SelectTrigger data-testid="invoice-client"><SelectValue placeholder="Select client" /></SelectTrigger>
                  <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Due Date *</Label><Input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} data-testid="invoice-due-date" /></div>
              <div><Label>Tax Rate (%)</Label><Input type="number" step="0.01" value={form.tax_rate} onChange={e => setForm({ ...form, tax_rate: e.target.value })} /></div>
            </div>
            <Separator />
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-base font-semibold">Line Items</Label>
                <Button variant="outline" size="sm" onClick={addLineItem} data-testid="add-inv-line-item"><Plus className="w-3 h-3 mr-1" />Add Item</Button>
              </div>
              {form.line_items.length === 0 ? (
                <div className="text-center py-6 border rounded-lg border-dashed text-muted-foreground text-sm"><Receipt className="w-8 h-8 mx-auto mb-2 opacity-30" />No items. Add from product catalog or manually.</div>
              ) : (
                <div className="space-y-2">
                  {form.line_items.map((li, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-end p-2 rounded-lg border bg-muted/20">
                      <div className="col-span-4">
                        {idx === 0 && <Label className="text-xs">Product / Item</Label>}
                        <Select value={li.product_id || ""} onValueChange={v => updateLineItem(idx, "product_id", v)}>
                          <SelectTrigger><SelectValue placeholder="Select or type below" /></SelectTrigger>
                          <SelectContent>{products.map(p => <SelectItem key={p.id} value={p.id}>{p.name} - ${p.retail_price.toFixed(2)}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-2">
                        {idx === 0 && <Label className="text-xs">Name</Label>}
                        <Input value={li.name} onChange={e => updateLineItem(idx, "name", e.target.value)} placeholder="Item name" />
                      </div>
                      <div className="col-span-1">
                        {idx === 0 && <Label className="text-xs">Qty</Label>}
                        <Input type="number" min="1" value={li.quantity} onChange={e => updateLineItem(idx, "quantity", parseInt(e.target.value) || 1)} />
                      </div>
                      <div className="col-span-2">
                        {idx === 0 && <Label className="text-xs">Unit Price</Label>}
                        <Input type="number" step="0.01" value={li.unit_price} onChange={e => updateLineItem(idx, "unit_price", parseFloat(e.target.value) || 0)} />
                      </div>
                      <div className="col-span-2 text-right">
                        {idx === 0 && <Label className="text-xs block">Total</Label>}
                        <p className="font-mono text-sm font-medium py-2">${((li.quantity || 0) * (li.unit_price || 0)).toFixed(2)}</p>
                      </div>
                      <div className="col-span-1 text-right">
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive" onClick={() => removeLineItem(idx)}><Trash2 className="w-3 h-3" /></Button>
                      </div>
                    </div>
                  ))}
                  <div className="flex flex-col items-end gap-1 text-sm mt-2">
                    <div className="flex gap-8"><span className="text-muted-foreground">Subtotal</span><span className="font-mono">${calcSubtotal().toFixed(2)}</span></div>
                    <div className="flex gap-8"><span className="text-muted-foreground">Tax ({form.tax_rate || 0}%)</span><span className="font-mono">${(calcSubtotal() * (parseFloat(form.tax_rate) || 0) / 100).toFixed(2)}</span></div>
                    <div className="flex gap-8 text-base font-semibold"><span>Total</span><span className="font-mono text-green-500">${(calcSubtotal() * (1 + (parseFloat(form.tax_rate) || 0) / 100)).toFixed(2)}</span></div>
                  </div>
                </div>
              )}
            </div>
            <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Invoice notes..." rows={2} /></div>
          </div>
          <DialogFooter><Button onClick={handleSave} data-testid="save-invoice-btn">{editing ? "Update" : "Create"} Invoice</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MANUAL PAYMENT DIALOG */}
      <Dialog open={isPaymentOpen} onOpenChange={setIsPaymentOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Record Payment</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Amount ($)</Label><Input type="number" step="0.01" value={paymentForm.amount} onChange={e => setPaymentForm({ ...paymentForm, amount: e.target.value })} data-testid="payment-amount" /></div>
            <div><Label>Method</Label>
              <Select value={paymentForm.method} onValueChange={v => setPaymentForm({ ...paymentForm, method: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual / Cash</SelectItem>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="check">Check</SelectItem>
                  <SelectItem value="credit_card">Credit Card (offline)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Reference / Check #</Label><Input value={paymentForm.reference} onChange={e => setPaymentForm({ ...paymentForm, reference: e.target.value })} placeholder="Optional reference" /></div>
          </div>
          <DialogFooter><Button onClick={handleManualPayment} data-testid="confirm-payment-btn"><Check className="w-4 h-4 mr-1" />Confirm Payment</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
