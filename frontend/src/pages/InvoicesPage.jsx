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
import { Switch } from "@/components/ui/switch";
import { PageShell, MetricStrip, MetricTile } from "@/components/design-system";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Plus, Search, FileText, Loader2, DollarSign, Send, Check, ArrowLeft,
  CreditCard, AlertTriangle, Clock, XCircle, CheckCircle, Trash2, Edit,
  Receipt, TrendingUp, Eye, Banknote, RefreshCw, ArrowRightLeft, Ban,
  Building2, Wallet, Printer, Download, Mail, Copy, BarChart3,
  Calendar, ChevronRight, MessageSquare, Timer, Users, PieChart, Smartphone
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
  const [invoiceActivity, setInvoiceActivity] = useState([]);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ amount: "", method: "manual", reference: "", notes: "", date: "" });
  const [payingInvoice, setPayingInvoice] = useState(null);
  const [moveDialog, setMoveDialog] = useState(false);
  const [moveTarget, setMoveTarget] = useState("");
  const [movingInvoice, setMovingInvoice] = useState(null);
  const [voidDialog, setVoidDialog] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [voidingInvoice, setVoidingInvoice] = useState(null);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState(null);
  const [pdfPreviewInvoice, setPdfPreviewInvoice] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  // Enhanced state
  const [detailTab, setDetailTab] = useState("items");
  const [emailHistory, setEmailHistory] = useState([]);
  const [emailDialog, setEmailDialog] = useState(false);
  const [emailForm, setEmailForm] = useState({ email: "", subject: "", message: "" });
  // SMS reminder state
  const [smsDialog, setSmsDialog] = useState(false);
  const [smsTemplates, setSmsTemplates] = useState([]);
  const [smsForm, setSmsForm] = useState({ to: "", template_key: "overdue_invoice", message: "" });
  const [smsSending, setSmsSending] = useState(false);
  const [smsHistory, setSmsHistory] = useState([]);
  const [creditNoteDialog, setCreditNoteDialog] = useState(false);
  const [creditNoteForm, setCreditNoteForm] = useState({ reason: "", line_items: [], subtotal: 0, tax: 0, total: 0 });
  const [agingReport, setAgingReport] = useState(null);
  const [revenueAnalytics, setRevenueAnalytics] = useState(null);
  const [topView, setTopView] = useState("list"); // list | aging | revenue
  const [form, setForm] = useState({
    client_id: "", contract_id: "", due_date: "", notes: "",
    line_items: [], tax_rate: "0",
    is_recurring: false, recurring_interval: "monthly",
    recurring_start_date: "", recurring_end_date: ""
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

  // Stripe payment callback
  useEffect(() => {
    const success = searchParams.get("payment_success");
    const sessionId = searchParams.get("session_id");
    if (success === "true" && sessionId) {
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

  const resetForm = () => setForm({
    client_id: "", contract_id: "", due_date: "", notes: "",
    line_items: [], tax_rate: "0",
    is_recurring: false, recurring_interval: "monthly",
    recurring_start_date: "", recurring_end_date: ""
  });

  const viewInvoiceDetail = async (inv) => {
    setViewInvoice(inv);
    setDetailTab("items");
    try {
      const [actRes, emailRes] = await Promise.all([
        axios.get(`${API}/invoices/${inv.id}/activity-log`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/invoices/${inv.id}/email-history`, { headers }).catch(() => ({ data: [] })),
      ]);
      setInvoiceActivity(actRes.data);
      setEmailHistory(emailRes.data);
    } catch { setInvoiceActivity([]); setEmailHistory([]); }
  };

  const openCreate = () => { setEditing(null); resetForm(); setIsFormOpen(true); };
  const openEdit = (inv) => {
    setEditing(inv);
    setForm({
      client_id: inv.client_id, contract_id: inv.contract_id || "", due_date: inv.due_date,
      notes: inv.notes || "", line_items: inv.line_items || [], tax_rate: String(inv.tax_rate || 0),
      is_recurring: inv.is_recurring || false, recurring_interval: inv.recurring_interval || "monthly",
      recurring_start_date: inv.recurring_start_date || "", recurring_end_date: inv.recurring_end_date || ""
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
        if (prod) { items[idx].name = prod.name; items[idx].unit_price = prod.retail_price; items[idx].description = prod.sku || ""; }
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
      ...form, tax_rate: parseFloat(form.tax_rate) || 0,
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

  const handleMoveClient = async () => {
    if (!moveTarget) { toast.error("Select a target client"); return; }
    try {
      const res = await axios.post(`${API}/invoices/${movingInvoice.id}/move-client`, { client_id: moveTarget }, { headers });
      toast.success(res.data.message); setMoveDialog(false); fetchAll();
      if (viewInvoice?.id === movingInvoice.id) { const updated = await axios.get(`${API}/invoices/${movingInvoice.id}`, { headers }); setViewInvoice(updated.data); }
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to move invoice"); }
  };

  const handleVoidInvoice = async () => {
    try {
      await axios.post(`${API}/invoices/${voidingInvoice.id}/void`, { reason: voidReason }, { headers });
      toast.success("Invoice voided"); setVoidDialog(false); fetchAll();
      if (viewInvoice?.id === voidingInvoice.id) { const updated = await axios.get(`${API}/invoices/${voidingInvoice.id}`, { headers }); setViewInvoice(updated.data); }
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to void invoice"); }
  };

  // --- Email Invoice ---
  const handleEmailInvoice = async () => {
    if (!viewInvoice) return;
    try {
      await axios.post(`${API}/invoices/${viewInvoice.id}/email`, emailForm, { headers });
      toast.success("Invoice emailed");
      setEmailDialog(false);
      const res = await axios.get(`${API}/invoices/${viewInvoice.id}/email-history`, { headers });
      setEmailHistory(res.data);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to email"); }
  };

  // --- SMS Reminder for Invoice ---
  const openSmsDialog = async (inv) => {
    const client = clients.find(c => c.id === inv.client_id);
    const phone = client?.mobile || client?.phone || "";
    setSmsForm({ to: phone, template_key: "overdue_invoice", message: "" });
    setSmsDialog(true);
    // Lazy-load templates + history
    try {
      const [tRes, hRes] = await Promise.all([
        axios.get(`${API}/sms/templates?category=billing`, { headers }),
        axios.get(`${API}/sms/messages?client_id=${inv.client_id}`, { headers }).catch(() => ({ data: [] })),
      ]);
      setSmsTemplates(tRes.data || []);
      setSmsHistory((hRes.data || []).filter(m => (m.custom_ref || "") === `inv-${inv.id}`));
    } catch { setSmsTemplates([]); }
  };

  const handleSendInvoiceSms = async () => {
    if (!viewInvoice) return;
    if (!smsForm.to.trim()) { toast.error("Mobile number required"); return; }
    setSmsSending(true);
    try {
      const res = await axios.post(`${API}/invoices/${viewInvoice.id}/send-sms-reminder`, {
        to: smsForm.to.trim(),
        template_key: smsForm.template_key || "overdue_invoice",
        message: smsForm.message || undefined,
      }, { headers });
      toast.success(`SMS reminder sent to ${res.data?.to || smsForm.to}`);
      setSmsDialog(false);
      // Refresh invoice to show last_sms_reminder_at
      const updated = await axios.get(`${API}/invoices/${viewInvoice.id}`, { headers });
      setViewInvoice(updated.data);
      fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to send SMS");
    } finally {
      setSmsSending(false);
    }
  };

  // --- Clone Invoice ---
  const handleCloneInvoice = async (inv) => {
    try {
      const res = await axios.post(`${API}/invoices/${inv.id}/clone`, {}, { headers });
      toast.success(`Cloned as ${res.data.invoice_number}`);
      fetchAll();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to clone"); }
  };

  // --- Credit Note ---
  const handleCreateCreditNote = async () => {
    if (!viewInvoice) return;
    try {
      await axios.post(`${API}/credit-notes`, {
        invoice_id: viewInvoice.id,
        client_id: viewInvoice.client_id,
        client_name: viewInvoice.client_name,
        ...creditNoteForm,
      }, { headers });
      toast.success("Credit note created");
      setCreditNoteDialog(false);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  // --- PDF ---
  const handlePdfPreview = async (inv) => {
    setPdfLoading(true); setPdfPreviewInvoice(inv);
    try {
      const res = await axios.get(`${API}/invoices/${inv.id}/pdf`, { headers, responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      setPdfPreviewUrl(url);
    } catch { toast.error("Failed to generate PDF"); }
    finally { setPdfLoading(false); }
  };

  const handlePdfDownload = async (inv) => {
    try {
      const res = await axios.get(`${API}/invoices/${inv.id}/pdf/download`, { headers, responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a"); a.href = url; a.download = `${inv.invoice_number || "invoice"}.pdf`; a.click();
      window.URL.revokeObjectURL(url); toast.success("PDF downloaded");
    } catch { toast.error("Failed to download PDF"); }
  };

  const closePdfPreview = () => {
    if (pdfPreviewUrl) window.URL.revokeObjectURL(pdfPreviewUrl);
    setPdfPreviewUrl(null); setPdfPreviewInvoice(null);
  };

  // --- Aging Report ---
  const fetchAgingReport = async () => {
    try {
      const res = await axios.get(`${API}/invoices/aging-report`, { headers });
      setAgingReport(res.data);
    } catch { toast.error("Failed to load aging report"); }
  };

  // --- Revenue Analytics ---
  const fetchRevenueAnalytics = async () => {
    try {
      const res = await axios.get(`${API}/invoices/analytics/revenue`, { headers });
      setRevenueAnalytics(res.data);
    } catch { toast.error("Failed to load analytics"); }
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

  // ========== SHARED DIALOGS ==========
  const dialogs = (
    <>
      {/* CREATE/EDIT */}
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
                    <div key={`k-${idx}`} className="grid grid-cols-12 gap-2 items-end p-2 rounded-lg border bg-muted/20">
                      <div className="col-span-4">
                        {idx === 0 && <Label className="text-xs">Product / Item</Label>}
                        <Select value={li.product_id || ""} onValueChange={v => updateLineItem(idx, "product_id", v)}>
                          <SelectTrigger><SelectValue placeholder="Select or type below" /></SelectTrigger>
                          <SelectContent>{products.map(p => <SelectItem key={p.id} value={p.id}>{p.name} - ${p.retail_price?.toFixed(2)}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-2">{idx === 0 && <Label className="text-xs">Name</Label>}<Input value={li.name} onChange={e => updateLineItem(idx, "name", e.target.value)} placeholder="Item name" /></div>
                      <div className="col-span-1">{idx === 0 && <Label className="text-xs">Qty</Label>}<Input type="number" min="1" value={li.quantity} onChange={e => updateLineItem(idx, "quantity", parseInt(e.target.value) || 1)} /></div>
                      <div className="col-span-2">{idx === 0 && <Label className="text-xs">Unit Price</Label>}<Input type="number" step="0.01" value={li.unit_price} onChange={e => updateLineItem(idx, "unit_price", parseFloat(e.target.value) || 0)} /></div>
                      <div className="col-span-2 text-right">{idx === 0 && <Label className="text-xs block">Total</Label>}<p className="font-mono text-sm font-medium py-2">${((li.quantity || 0) * (li.unit_price || 0)).toFixed(2)}</p></div>
                      <div className="col-span-1 text-right"><Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive" onClick={() => removeLineItem(idx)}><Trash2 className="w-3 h-3" /></Button></div>
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
            <Separator />
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div><Label className="text-base font-semibold flex items-center gap-2"><RefreshCw className="w-4 h-4" />Recurring Invoice</Label><p className="text-xs text-muted-foreground mt-0.5">Auto-generate this invoice on a schedule</p></div>
                <Switch checked={form.is_recurring} onCheckedChange={v => setForm({ ...form, is_recurring: v })} data-testid="recurring-toggle" />
              </div>
              {form.is_recurring && (
                <div className="grid grid-cols-3 gap-3 p-3 rounded-lg border bg-muted/20">
                  <div><Label className="text-xs">Frequency</Label>
                    <Select value={form.recurring_interval} onValueChange={v => setForm({ ...form, recurring_interval: v })}>
                      <SelectTrigger data-testid="recurring-interval"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="weekly">Weekly</SelectItem><SelectItem value="biweekly">Bi-Weekly</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem><SelectItem value="quarterly">Quarterly</SelectItem>
                        <SelectItem value="semi-annual">Semi-Annual</SelectItem><SelectItem value="annually">Annually</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label className="text-xs">Start Date</Label><Input type="date" value={form.recurring_start_date} onChange={e => setForm({ ...form, recurring_start_date: e.target.value })} /></div>
                  <div><Label className="text-xs">End Date (optional)</Label><Input type="date" value={form.recurring_end_date} onChange={e => setForm({ ...form, recurring_end_date: e.target.value })} /></div>
                </div>
              )}
            </div>
          </div>
          <DialogFooter><Button onClick={handleSave} data-testid="save-invoice-btn">{editing ? "Update" : "Create"} Invoice</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MANUAL PAYMENT */}
      <Dialog open={isPaymentOpen} onOpenChange={setIsPaymentOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Record Payment</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Amount ($)</Label><Input type="number" step="0.01" value={paymentForm.amount} onChange={e => setPaymentForm({ ...paymentForm, amount: e.target.value })} data-testid="payment-amount" /></div>
            <div><Label>Payment Method</Label>
              <Select value={paymentForm.method} onValueChange={v => setPaymentForm({ ...paymentForm, method: v })}>
                <SelectTrigger data-testid="payment-method"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem><SelectItem value="bank_transfer">Bank Transfer / EFT</SelectItem>
                  <SelectItem value="check">Check / Cheque</SelectItem><SelectItem value="credit_card_offline">Credit Card (Offline)</SelectItem>
                  <SelectItem value="paypal">PayPal</SelectItem><SelectItem value="wire">Wire Transfer</SelectItem><SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Reference</Label><Input value={paymentForm.reference} onChange={e => setPaymentForm({ ...paymentForm, reference: e.target.value })} placeholder="Reference number" data-testid="payment-reference" /></div>
            <div><Label>Payment Date</Label><Input type="date" value={paymentForm.date} onChange={e => setPaymentForm({ ...paymentForm, date: e.target.value })} /></div>
          </div>
          <DialogFooter><Button onClick={handleManualPayment} data-testid="confirm-payment-btn"><Check className="w-4 h-4 mr-1" />Confirm Payment</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MOVE CLIENT */}
      <Dialog open={moveDialog} onOpenChange={v => { setMoveDialog(v); if (!v) setMovingInvoice(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Move Invoice to Different Client</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {movingInvoice && <div className="p-3 rounded-lg bg-muted/30 border text-sm"><p className="font-mono font-medium">{movingInvoice.invoice_number}</p><p className="text-muted-foreground">Currently: {movingInvoice.client_name} | ${(movingInvoice.total || 0).toFixed(2)}</p></div>}
            <div><Label>Move to Client *</Label>
              <Select value={moveTarget} onValueChange={setMoveTarget}>
                <SelectTrigger data-testid="move-target-client"><SelectValue placeholder="Select new client" /></SelectTrigger>
                <SelectContent>{clients.filter(c => c.id !== movingInvoice?.client_id).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveDialog(false)}>Cancel</Button>
            <Button onClick={handleMoveClient} data-testid="confirm-move-btn"><ArrowRightLeft className="w-4 h-4 mr-1" />Move</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* VOID */}
      <Dialog open={voidDialog} onOpenChange={v => { setVoidDialog(v); if (!v) setVoidingInvoice(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Void Invoice</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {voidingInvoice && <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20 text-sm"><p className="font-medium text-red-400">This will cancel the invoice permanently.</p><p className="text-muted-foreground mt-1">{voidingInvoice.invoice_number} - ${(voidingInvoice.total || 0).toFixed(2)}</p></div>}
            <div><Label>Reason</Label><Textarea value={voidReason} onChange={e => setVoidReason(e.target.value)} placeholder="Enter reason..." rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidDialog(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleVoidInvoice} data-testid="confirm-void-btn"><Ban className="w-4 h-4 mr-1" />Void</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PDF PREVIEW */}
      <Dialog open={!!pdfPreviewUrl} onOpenChange={v => { if (!v) closePdfPreview(); }}>
        <DialogContent className="max-w-4xl h-[85vh] flex flex-col">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle className="flex items-center gap-2"><FileText className="w-5 h-5" />Preview: {pdfPreviewInvoice?.invoice_number}</DialogTitle>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => { if (pdfPreviewUrl) { const w = window.open(pdfPreviewUrl, "_blank"); if (w) w.addEventListener("load", () => w.print()); } }} data-testid="print-pdf-btn"><Printer className="w-4 h-4 mr-1" />Print</Button>
                <Button size="sm" variant="outline" onClick={() => pdfPreviewInvoice && handlePdfDownload(pdfPreviewInvoice)} data-testid="download-invoice-pdf-btn"><Download className="w-4 h-4 mr-1" />Download</Button>
              </div>
            </div>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            {pdfLoading ? <div className="flex items-center justify-center h-full"><Loader2 className="w-8 h-8 animate-spin" /></div> : <iframe src={pdfPreviewUrl} className="w-full h-full rounded-lg border" title="Invoice PDF" />}
          </div>
        </DialogContent>
      </Dialog>

      {/* EMAIL INVOICE */}
      <Dialog open={emailDialog} onOpenChange={setEmailDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Mail className="w-5 h-5 text-blue-400" />Email Invoice</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Recipient Email</Label><Input value={emailForm.email} onChange={e => setEmailForm({ ...emailForm, email: e.target.value })} placeholder="client@example.com" data-testid="invoice-email-input" /></div>
            <div><Label>Subject</Label><Input value={emailForm.subject} onChange={e => setEmailForm({ ...emailForm, subject: e.target.value })} /></div>
            <div><Label>Message (optional)</Label><Textarea value={emailForm.message} onChange={e => setEmailForm({ ...emailForm, message: e.target.value })} rows={3} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailDialog(false)}>Cancel</Button>
            <Button onClick={handleEmailInvoice} className="bg-blue-600 hover:bg-blue-700" data-testid="send-invoice-email-btn"><Send className="w-4 h-4 mr-1" />Send</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CREDIT NOTE */}
      <Dialog open={creditNoteDialog} onOpenChange={setCreditNoteDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Receipt className="w-5 h-5 text-amber-400" />Issue Credit Note</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {viewInvoice && <div className="p-3 rounded-lg bg-muted/30 border text-sm"><p className="font-mono">{viewInvoice.invoice_number}</p><p className="text-muted-foreground">{viewInvoice.client_name} | ${(viewInvoice.total || 0).toFixed(2)}</p></div>}
            <div><Label>Reason</Label><Textarea value={creditNoteForm.reason} onChange={e => setCreditNoteForm({ ...creditNoteForm, reason: e.target.value })} placeholder="Reason for credit..." rows={2} /></div>
            <div><Label>Credit Amount ($)</Label><Input type="number" step="0.01" value={creditNoteForm.total} onChange={e => setCreditNoteForm({ ...creditNoteForm, total: parseFloat(e.target.value) || 0, subtotal: parseFloat(e.target.value) || 0 })} data-testid="credit-note-amount" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreditNoteDialog(false)}>Cancel</Button>
            <Button onClick={handleCreateCreditNote} className="bg-amber-600 hover:bg-amber-700" data-testid="create-credit-note-btn"><Receipt className="w-4 h-4 mr-1" />Issue Credit Note</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* SMS REMINDER */}
      <Dialog open={smsDialog} onOpenChange={setSmsDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Smartphone className="w-5 h-5 text-emerald-400" />Send SMS Reminder</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {viewInvoice && (
              <div className="p-3 rounded-lg bg-muted/30 border text-sm" data-testid="sms-invoice-summary">
                <p className="font-mono">{viewInvoice.invoice_number}</p>
                <p className="text-muted-foreground">{viewInvoice.client_name} · ${(viewInvoice.total || 0).toFixed(2)}</p>
                {viewInvoice.due_date && <p className="text-xs text-muted-foreground">Due {format(parseISO(viewInvoice.due_date), "MMM d, yyyy")}</p>}
                {viewInvoice.last_sms_reminder_at && (
                  <p className="text-[11px] text-amber-400 mt-1">Last reminder sent {formatDistanceToNow(new Date(viewInvoice.last_sms_reminder_at), { addSuffix: true })} ({viewInvoice.sms_reminders_sent || 1} total)</p>
                )}
              </div>
            )}
            <div>
              <Label>Mobile Number</Label>
              <Input value={smsForm.to} onChange={e => setSmsForm({ ...smsForm, to: e.target.value })} placeholder="04xx xxx xxx" data-testid="sms-invoice-to-input" />
            </div>
            <div>
              <Label>Template</Label>
              <Select value={smsForm.template_key} onValueChange={v => setSmsForm({ ...smsForm, template_key: v })}>
                <SelectTrigger data-testid="sms-invoice-template-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {smsTemplates.length === 0 && <SelectItem value="overdue_invoice">Overdue Invoice Reminder</SelectItem>}
                  {smsTemplates.map(t => (
                    <SelectItem key={t.key} value={t.key}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">Template placeholders (client_name, invoice_number, amount, days_overdue, payment_link) are auto-filled.</p>
            </div>
            <div>
              <Label>Override message (optional)</Label>
              <Textarea value={smsForm.message} onChange={e => setSmsForm({ ...smsForm, message: e.target.value })} rows={3} placeholder="Leave blank to use the selected template" data-testid="sms-invoice-override-input" />
            </div>
            {smsHistory.length > 0 && (
              <div className="border rounded-lg p-2 bg-muted/20 max-h-32 overflow-y-auto space-y-1" data-testid="sms-invoice-history">
                <p className="text-[11px] font-semibold text-muted-foreground">Recent SMS for this invoice</p>
                {smsHistory.slice(0, 5).map(m => (
                  <div key={m.id} className="text-[11px] border-l-2 border-emerald-500/40 pl-2">
                    <span className="text-muted-foreground">{m.sent_at?.slice(0, 16).replace("T", " ")} · </span>
                    <span className={m.direction === "inbound" ? "text-emerald-400 font-medium" : ""}>{m.direction === "inbound" ? "← " : "→ "}</span>
                    <span>{(m.message || "").slice(0, 80)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSmsDialog(false)}>Cancel</Button>
            <Button onClick={handleSendInvoiceSms} disabled={smsSending} className="bg-emerald-600 hover:bg-emerald-700" data-testid="send-invoice-sms-btn">
              {smsSending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Send className="w-4 h-4 mr-1" />}Send SMS
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
  if (viewInvoice) {
    const inv = viewInvoice;
    const pStatus = inv.payment_status || "unpaid";
    const PayIcon = PAYMENT_STATUS[pStatus]?.icon || XCircle;
    const balance = (inv.total || 0) - (inv.amount_paid || 0);
    const isOverdue = inv.due_date && isPast(parseISO(inv.due_date)) && pStatus !== "paid";

    return (
      <div className="space-y-6" data-testid="invoice-detail">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => { setViewInvoice(null); setDetailTab("items"); }} data-testid="back-to-invoices"><ArrowLeft className="w-4 h-4 mr-1" />Back</Button>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
          <span className="font-mono font-semibold text-lg">{inv.invoice_number}</span>
          <Badge className={PAYMENT_STATUS[pStatus]?.class}><PayIcon className="w-3 h-3 mr-1" />{PAYMENT_STATUS[pStatus]?.label}</Badge>
          <Badge className={STATUS_CONFIG[getEffectiveStatus(inv)]?.class}>{STATUS_CONFIG[getEffectiveStatus(inv)]?.label}</Badge>
          {isOverdue && <Badge className="bg-red-500/20 text-red-400 border-red-500/30 animate-pulse"><AlertTriangle className="w-3 h-3 mr-1" />Overdue</Badge>}
          {inv.is_recurring && <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30"><RefreshCw className="w-3 h-3 mr-1" />Recurring</Badge>}
        </div>

        {/* Payment Progress Bar */}
        {balance > 0 && (
          <Card className="border-slate-700/50 overflow-hidden">
            <CardContent className="py-3 px-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Payment Progress</span>
                <span className="text-xs font-mono">${(inv.amount_paid || 0).toFixed(2)} / ${(inv.total || 0).toFixed(2)}</span>
              </div>
              <Progress value={inv.total > 0 ? ((inv.amount_paid || 0) / inv.total * 100) : 0} className="h-2" />
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-8 space-y-4">
            <Tabs value={detailTab} onValueChange={setDetailTab}>
              <TabsList>
                <TabsTrigger value="items" data-testid="tab-inv-items">Line Items</TabsTrigger>
                <TabsTrigger value="payments" data-testid="tab-inv-payments">Payments ({(inv.payments || []).length})</TabsTrigger>
                <TabsTrigger value="emails" data-testid="tab-inv-emails">Emails ({emailHistory.length})</TabsTrigger>
                <TabsTrigger value="audit" data-testid="tab-inv-audit">Audit ({invoiceActivity.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="items">
                <Card className="mt-2">
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Price</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {(inv.line_items || []).map((li, i) => (
                          <TableRow key={`k-${i}`}>
                            <TableCell className="font-medium">{li.name}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{li.description || "-"}</TableCell>
                            <TableCell className="text-right">{li.quantity}</TableCell>
                            <TableCell className="text-right font-mono">${(li.unit_price || 0).toFixed(2)}</TableCell>
                            <TableCell className="text-right font-mono font-medium">${((li.quantity || 0) * (li.unit_price || 0)).toFixed(2)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <Separator />
                    <div className="p-4 flex flex-col items-end gap-1 text-sm">
                      <div className="flex gap-12"><span className="text-muted-foreground">Subtotal</span><span className="font-mono">${(inv.subtotal || 0).toFixed(2)}</span></div>
                      <div className="flex gap-12"><span className="text-muted-foreground">Tax ({inv.tax_rate || 0}%)</span><span className="font-mono">${(inv.tax || 0).toFixed(2)}</span></div>
                      <Separator className="w-48 my-1" />
                      <div className="flex gap-12 text-base"><span className="font-semibold">Total</span><span className="font-mono font-bold">${(inv.total || 0).toFixed(2)}</span></div>
                      {(inv.amount_paid || 0) > 0 && <div className="flex gap-12"><span className="text-green-500">Amount Paid</span><span className="font-mono text-green-500">-${(inv.amount_paid || 0).toFixed(2)}</span></div>}
                      {balance > 0 && <div className="flex gap-12 text-lg"><span className="font-bold text-red-500">Balance Due</span><span className="font-mono font-bold text-red-500">${balance.toFixed(2)}</span></div>}
                      {balance <= 0 && inv.total > 0 && <div className="text-green-500 font-bold text-lg mt-1">PAID IN FULL</div>}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="payments">
                <Card className="mt-2">
                  <CardContent className="p-0">
                    {(inv.payments || []).length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground text-sm">No payments recorded</div>
                    ) : (
                      <Table>
                        <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Method</TableHead><TableHead>Reference</TableHead><TableHead>Recorded By</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {(inv.payments || []).map((p, i) => (
                            <TableRow key={`k-${i}`}>
                              <TableCell className="text-sm">{p.date ? format(new Date(p.date), "MMM d, yyyy h:mm a") : "-"}</TableCell>
                              <TableCell><Badge variant="outline" className="capitalize text-xs">{(p.method || "").replace(/_/g, " ")}</Badge></TableCell>
                              <TableCell className="text-sm font-mono">{p.reference || p.session_id?.slice(0, 12) || "-"}</TableCell>
                              <TableCell className="text-sm">{p.recorded_by || "-"}</TableCell>
                              <TableCell className="text-right font-mono font-medium text-green-500">${(p.amount || 0).toFixed(2)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="emails">
                <Card className="mt-2">
                  <CardContent className="p-0">
                    {emailHistory.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground text-sm">No emails sent yet</div>
                    ) : (
                      <Table>
                        <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>To</TableHead><TableHead>Subject</TableHead><TableHead>Sent By</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {emailHistory.map((em, i) => (
                            <TableRow key={em.id || i}>
                              <TableCell className="text-xs">{em.created_at ? format(new Date(em.created_at), "MMM d, HH:mm") : "-"}</TableCell>
                              <TableCell className="text-sm">{em.email}</TableCell>
                              <TableCell className="text-sm max-w-xs truncate">{em.subject}</TableCell>
                              <TableCell className="text-sm">{em.sent_by_name}</TableCell>
                              <TableCell>{em.sent ? <Badge className="bg-green-500/20 text-green-400 text-xs">Sent</Badge> : <Badge className="bg-amber-500/20 text-amber-400 text-xs">Queued</Badge>}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="audit">
                <Card className="mt-2">
                  <CardContent className="p-0">
                    {invoiceActivity.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground text-sm">No audit entries</div>
                    ) : (
                      <div className="p-4 space-y-2">
                        {invoiceActivity.map((log, i) => (
                          <div key={log.id || i} className="flex items-start gap-3 p-2.5 rounded-lg border bg-muted/20">
                            <div className="mt-0.5">
                              {log.action === "created" && <Plus className="w-3.5 h-3.5 text-green-500" />}
                              {log.action === "updated" && <Edit className="w-3.5 h-3.5 text-blue-500" />}
                              {log.action === "payment_recorded" && <Banknote className="w-3.5 h-3.5 text-amber-500" />}
                              {log.action === "voided" && <Ban className="w-3.5 h-3.5 text-red-500" />}
                              {!["created", "updated", "payment_recorded", "voided"].includes(log.action) && <FileText className="w-3.5 h-3.5 text-zinc-500" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium">{log.user_name}</span>
                                <Badge variant="outline" className="text-[9px] capitalize">{(log.action || "").replace(/_/g, " ")}</Badge>
                              </div>
                              <p className="text-[11px] text-muted-foreground mt-0.5">{log.details}</p>
                            </div>
                            <span className="text-[9px] text-muted-foreground whitespace-nowrap">{log.created_at ? formatDistanceToNow(new Date(log.created_at), { addSuffix: true }) : ""}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            {inv.notes && <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Notes</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">{inv.notes}</p></CardContent></Card>}
          </div>

          <div className="col-span-4 space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Details</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div><span className="text-muted-foreground block">Client</span><span className="font-medium">{inv.client_name}</span></div>
                <Separator />
                <div><span className="text-muted-foreground block">Due Date</span><span className={`font-medium ${isOverdue ? "text-red-500" : ""}`}>{inv.due_date ? format(parseISO(inv.due_date), "MMM d, yyyy") : "N/A"}</span></div>
                <Separator />
                <div><span className="text-muted-foreground block">Created</span><span className="font-medium">{inv.created_at ? format(new Date(inv.created_at), "MMM d, yyyy") : "N/A"}</span></div>
                {inv.paid_date && <><Separator /><div><span className="text-muted-foreground block">Paid Date</span><span className="font-medium text-green-500">{format(parseISO(inv.paid_date), "MMM d, yyyy")}</span></div></>}
                {inv.last_emailed_to && <><Separator /><div><span className="text-muted-foreground block">Last Emailed</span><span className="font-medium text-blue-400">{inv.last_emailed_to}</span><span className="block text-xs text-muted-foreground">{inv.last_emailed_at ? format(new Date(inv.last_emailed_at), "MMM d, HH:mm") : ""}</span></div></>}
                {inv.late_fee_applied && <><Separator /><div><span className="text-muted-foreground block">Late Fees</span><span className="font-medium text-amber-400">${(inv.total_late_fees || 0).toFixed(2)}</span></div></>}
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
                    <Button variant="outline" className="w-full" onClick={() => { setPayingInvoice(inv); setPaymentForm({ amount: String(balance.toFixed(2)), method: "cash", reference: "", notes: "", date: new Date().toISOString().split("T")[0] }); setIsPaymentOpen(true); }} data-testid="record-payment-btn">
                      <Banknote className="w-4 h-4 mr-1" />Record Manual Payment
                    </Button>
                  </>
                )}
                <Separator />
                <Button variant="outline" className="w-full text-blue-400 border-blue-500/30 hover:bg-blue-500/10" onClick={() => handlePdfPreview(inv)} data-testid="preview-pdf-btn">
                  <Eye className="w-4 h-4 mr-1" />Preview PDF
                </Button>
                <Button variant="outline" className="w-full text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" onClick={() => handlePdfDownload(inv)} data-testid="download-pdf-detail-btn">
                  <Download className="w-4 h-4 mr-1" />Download PDF
                </Button>
                <Button variant="outline" className="w-full text-sky-400 border-sky-500/30 hover:bg-sky-500/10" onClick={() => {
                  const client = clients.find(c => c.id === inv.client_id);
                  setEmailForm({ email: client?.email || "", subject: `Invoice ${inv.invoice_number}`, message: "" });
                  setEmailDialog(true);
                }} data-testid="email-invoice-btn">
                  <Mail className="w-4 h-4 mr-1" />Email Invoice
                </Button>
                {pStatus !== "paid" && (
                  <Button variant="outline" className="w-full text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" onClick={() => openSmsDialog(inv)} data-testid="sms-reminder-btn">
                    <Smartphone className="w-4 h-4 mr-1" />Send SMS Reminder
                    {inv.sms_reminders_sent > 0 && <Badge variant="outline" className="ml-2 text-[10px] h-4 text-emerald-400 border-emerald-500/40">{inv.sms_reminders_sent}</Badge>}
                  </Button>
                )}
                <Separator />
                <Button variant="outline" className="w-full" onClick={() => handleCloneInvoice(inv)} data-testid="clone-invoice-btn">
                  <Copy className="w-4 h-4 mr-1" />Clone Invoice
                </Button>
                <Button variant="outline" className="w-full text-amber-400 border-amber-500/30 hover:bg-amber-500/10" onClick={() => {
                  setCreditNoteForm({ reason: "", total: 0, subtotal: 0, tax: 0, line_items: [] });
                  setCreditNoteDialog(true);
                }} data-testid="credit-note-btn">
                  <Receipt className="w-4 h-4 mr-1" />Issue Credit Note
                </Button>
                {inv.status === "draft" && <Button variant="outline" className="w-full" onClick={() => handleStatusChange(inv, "sent")}><Send className="w-4 h-4 mr-1" />Mark as Sent</Button>}
                <Button variant="outline" className="w-full" onClick={() => { setMovingInvoice(inv); setMoveTarget(""); setMoveDialog(true); }} data-testid="move-invoice-btn">
                  <ArrowRightLeft className="w-4 h-4 mr-1" />Move to Client
                </Button>
                <Button variant="outline" className="w-full" onClick={() => openEdit(inv)} data-testid="edit-invoice-btn"><Edit className="w-4 h-4 mr-1" />Edit</Button>
                {inv.status !== "cancelled" && (
                  <Button variant="outline" className="w-full text-amber-500 hover:text-amber-400" onClick={() => { setVoidingInvoice(inv); setVoidReason(""); setVoidDialog(true); }} data-testid="void-invoice-btn">
                    <Ban className="w-4 h-4 mr-1" />Void Invoice
                  </Button>
                )}
                <Button variant="destructive" className="w-full" onClick={() => handleDelete(inv.id)}><Trash2 className="w-4 h-4 mr-1" />Delete</Button>
              </CardContent>
            </Card>
          </div>
        </div>
        {dialogs}
      </div>
    );
  }

  // ========== AGING REPORT VIEW ==========
  if (topView === "aging") {
    if (!agingReport) fetchAgingReport();
    const bucketLabels = { current: "Current", "30": "1-30 Days", "60": "31-60 Days", "90": "61-90 Days", "120_plus": "120+ Days" };
    const bucketColors = { current: "text-green-400", "30": "text-blue-400", "60": "text-amber-400", "90": "text-orange-400", "120_plus": "text-red-400" };
    return (
      <div className="space-y-6" data-testid="aging-report">
        <div className="flex items-center justify-between">
          <div><h1 className="text-3xl font-bold tracking-tight">Aging Report</h1><p className="text-muted-foreground">Outstanding invoices by age</p></div>
          <Button variant="outline" onClick={() => setTopView("list")} data-testid="back-to-invoices-list"><ArrowLeft className="w-4 h-4 mr-1" />Back</Button>
        </div>
        {!agingReport ? <div className="flex items-center justify-center h-48"><Loader2 className="w-8 h-8 animate-spin" /></div> : (
          <>
            <div className="grid grid-cols-5 gap-3">
              {Object.entries(bucketLabels).map(([key, label]) => {
                const b = agingReport.buckets?.[key] || {};
                return (
                  <Card key={key} className={b.total > 0 ? "border-" + bucketColors[key].replace("text-", "") + "/30" : ""}>
                    <CardContent className="pt-4">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className={`text-xl font-bold font-mono ${b.total > 0 ? bucketColors[key] : ""}`}>${(b.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                      <p className="text-xs text-muted-foreground">{b.count || 0} invoices</p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            <Card>
              <CardHeader><CardTitle className="text-sm">Grand Total Outstanding: <span className="text-red-400 font-mono">${(agingReport.grand_total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></CardTitle></CardHeader>
              <CardContent>
                {Object.entries(agingReport.buckets || {}).map(([key, bucket]) => {
                  if (!bucket.invoices?.length) return null;
                  return (
                    <div key={key} className="mb-4">
                      <h3 className={`text-sm font-semibold mb-2 ${bucketColors[key]}`}>{bucketLabels[key]} ({bucket.count})</h3>
                      <Table>
                        <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Client</TableHead><TableHead>Due Date</TableHead><TableHead className="text-right">Balance</TableHead><TableHead className="text-right">Days Overdue</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {bucket.invoices.slice(0, 10).map(inv => (
                            <TableRow key={inv.id} className="cursor-pointer hover:bg-muted/50" onClick={() => viewInvoiceDetail(inv)}>
                              <TableCell className="font-mono">{inv.invoice_number}</TableCell>
                              <TableCell>{inv.client_name}</TableCell>
                              <TableCell>{inv.due_date || "-"}</TableCell>
                              <TableCell className="text-right font-mono text-red-400">${(inv.balance || ((inv.total || 0) - (inv.amount_paid || 0))).toFixed(2)}</TableCell>
                              <TableCell className="text-right font-mono">{inv.days_overdue || 0}d</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </>
        )}
        {dialogs}
      </div>
    );
  }

  // ========== REVENUE ANALYTICS VIEW ==========
  if (topView === "revenue") {
    if (!revenueAnalytics) fetchRevenueAnalytics();
    return (
      <div className="space-y-6" data-testid="revenue-analytics">
        <div className="flex items-center justify-between">
          <div><h1 className="text-3xl font-bold tracking-tight">Revenue Analytics</h1><p className="text-muted-foreground">Financial performance overview</p></div>
          <Button variant="outline" onClick={() => setTopView("list")} data-testid="back-to-invoices-list"><ArrowLeft className="w-4 h-4 mr-1" />Back</Button>
        </div>
        {!revenueAnalytics ? <div className="flex items-center justify-center h-48"><Loader2 className="w-8 h-8 animate-spin" /></div> : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Total Revenue</p><p className="text-2xl font-bold text-green-500">${(revenueAnalytics.total_revenue || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p></CardContent></Card>
              <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Total Collected</p><p className="text-2xl font-bold text-blue-400">${(revenueAnalytics.total_collected || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p></CardContent></Card>
              <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Outstanding</p><p className="text-2xl font-bold text-red-400">${(revenueAnalytics.outstanding || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p></CardContent></Card>
              <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Collection Rate</p><p className="text-2xl font-bold text-emerald-400">{revenueAnalytics.collection_rate || 0}%</p></CardContent></Card>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Card className="border-purple-500/20">
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">Monthly Recurring Revenue (MRR)</p>
                  <p className="text-3xl font-bold text-purple-400">${(revenueAnalytics.mrr || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                </CardContent>
              </Card>
              <Card className="border-cyan-500/20">
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">Annual Recurring Revenue (ARR)</p>
                  <p className="text-3xl font-bold text-cyan-400">${(revenueAnalytics.arr || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                </CardContent>
              </Card>
            </div>
            <div className="grid grid-cols-2 gap-6">
              <Card>
                <CardHeader><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4" />Monthly Revenue Trend</CardTitle></CardHeader>
                <CardContent>
                  {(revenueAnalytics.monthly_revenue || []).length === 0 ? <p className="text-sm text-muted-foreground">No data</p> : (
                    <div className="space-y-1">
                      {revenueAnalytics.monthly_revenue.map((m, i) => {
                        const maxRev = Math.max(...revenueAnalytics.monthly_revenue.map(x => x.revenue));
                        const pct = maxRev > 0 ? (m.revenue / maxRev * 100) : 0;
                        const colPct = maxRev > 0 ? (m.collected / maxRev * 100) : 0;
                        return (
                          <div key={`k-${i}`} className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground w-16">{m.month}</span>
                            <div className="flex-1 h-5 bg-muted/20 rounded overflow-hidden relative">
                              <div className="h-full bg-blue-500/30 rounded absolute" style={{ width: `${pct}%` }} />
                              <div className="h-full bg-green-500/50 rounded absolute" style={{ width: `${colPct}%` }} />
                            </div>
                            <span className="text-xs font-mono w-20 text-right">${m.revenue.toLocaleString()}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Users className="w-4 h-4" />Top Clients by Revenue</CardTitle></CardHeader>
                <CardContent>
                  {(revenueAnalytics.top_clients || []).length === 0 ? <p className="text-sm text-muted-foreground">No data</p> : (
                    <div className="space-y-2">
                      {revenueAnalytics.top_clients.map((c, i) => (
                        <div key={`k-${i}`} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                            <span className="text-sm font-medium">{c.client}</span>
                          </div>
                          <span className="font-mono text-sm">${c.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}
        {dialogs}
      </div>
    );
  }

  // ========== LIST VIEW ==========
  return (
    <PageShell data-testid="invoices-page">
      <MetricStrip columns={5}>
        <MetricTile label="Total" value={stats.total || 0} accent="indigo" icon={<FileText className="w-2.5 h-2.5 text-indigo-400" />} testid="stat-total" />
        <MetricTile label="Paid" value={stats.paid || 0} accent="emerald" icon={<CheckCircle className="w-2.5 h-2.5 text-emerald-400" />} testid="stat-paid" />
        <MetricTile label="Unpaid" value={stats.unpaid || 0} accent={stats.unpaid > 0 ? "rose" : "emerald"} icon={<XCircle className="w-2.5 h-2.5 text-rose-400" />} testid="stat-unpaid" />
        <MetricTile label="Collected" value={`$${(stats.total_collected || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} accent="emerald" icon={<TrendingUp className="w-2.5 h-2.5 text-emerald-400" />} testid="stat-collected" />
        <MetricTile label="Outstanding" value={`$${(stats.total_outstanding || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} accent={stats.total_outstanding > 0 ? "amber" : "emerald"} icon={<AlertTriangle className="w-2.5 h-2.5 text-amber-400" />} testid="stat-outstanding" />
      </MetricStrip>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Invoices</h1>
          <p className="text-[11px] text-zinc-500 font-mono uppercase tracking-wider">{invoices.length} invoices</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { setTopView("aging"); setAgingReport(null); }} data-testid="aging-report-btn">
            <Timer className="w-4 h-4 mr-1" />Aging Report
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setTopView("revenue"); setRevenueAnalytics(null); }} data-testid="revenue-analytics-btn">
            <BarChart3 className="w-4 h-4 mr-1" />Revenue Analytics
          </Button>
          <Button onClick={openCreate} data-testid="create-invoice-btn"><Plus className="w-4 h-4 mr-1" />New Invoice</Button>
        </div>
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
            <SelectItem value="all">All Payments</SelectItem><SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="unpaid">Not Paid</SelectItem><SelectItem value="partial">Partial</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem><SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="sent">Sent</SelectItem><SelectItem value="paid">Paid</SelectItem>
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
                  <TableRow key={inv.id} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => viewInvoiceDetail(inv)} data-testid={`invoice-row-${inv.id}`}>
                    <TableCell className="font-mono font-medium">{inv.invoice_number}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">{inv.client_name}
                        {inv.is_recurring && <RefreshCw className="w-3 h-3 text-purple-500" />}
                      </div>
                    </TableCell>
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
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-blue-400" title="Preview PDF" onClick={() => handlePdfPreview(inv)} data-testid={`print-btn-${inv.id}`}><Printer className="w-3 h-3" /></Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-emerald-400" title="Download" onClick={() => handlePdfDownload(inv)} data-testid={`download-btn-${inv.id}`}><Download className="w-3 h-3" /></Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Clone" onClick={() => handleCloneInvoice(inv)}><Copy className="w-3 h-3" /></Button>
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

      {dialogs}
      </div>
    </PageShell>
  );
}
