import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HoldToConfirmButton } from "@/components/ui/hold-to-confirm-button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { PageShell } from "@/components/design-system";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import HeroTile from "@/components/HeroTile";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Plus, Search, FileText, Loader2, Send, Check, ArrowLeft,
  AlertTriangle, Clock, XCircle, CheckCircle, Trash2, Edit,
  Receipt, TrendingUp, Eye, Banknote, RefreshCw, ArrowRightLeft, Ban,
  Building2, Wallet, Printer, Download, Mail, Copy, BarChart3, Shield, Timer, Users, Smartphone, Zap, FileSpreadsheet, CheckSquare, PackagePlus, Ticket, ChevronsUpDown
} from "lucide-react";
import LateRiskBadge from "@/components/invoices/LateRiskBadge";
import { format, formatDistanceToNow, isPast, parseISO } from "date-fns";
import { PaymentPromiseButton } from "@/components/ai/PaymentPromiseButton";
import { InvoiceExplainerButton } from "@/components/ai/InvoiceExplainerButton";
import { InvoiceAIBundle } from "@/components/ai/InvoiceAIBundle";
import { InvoiceDetailSmartActions } from "@/components/invoices/InvoicesSmartBar";

const PAYMENT_STATUS = {
  unpaid: { label: "Not Paid", class: "bg-red-500/20 text-red-400 border-red-500/30", icon: XCircle },
  partial: { label: "Partial", class: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", icon: Clock },
  paid: { label: "Paid", class: "bg-green-500/20 text-green-400 border-green-500/30", icon: CheckCircle },
  split: { label: "Split across payers", class: "bg-violet-500/20 text-violet-200 border-violet-400/30", icon: Users },
};

const STATUS_CONFIG = {
  draft: { label: "Draft", class: "bg-gray-500/10 text-gray-400 border-gray-500/20" },
  sent: { label: "Sent", class: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  paid: { label: "Paid", class: "bg-green-500/10 text-green-400 border-green-500/20" },
  overdue: { label: "Overdue", class: "bg-red-500/10 text-red-400 border-red-500/20" },
  split_billed: { label: "Split billing source", class: "bg-violet-500/10 text-violet-200 border-violet-400/25" },
  cancelled: { label: "Cancelled", class: "bg-gray-500/10 text-gray-500 border-gray-500/20" },
};

const RECURRING_INTERVAL_OPTIONS = [
  { value: "weekly", label: "Weekly", detail: "Every 7 days" },
  { value: "biweekly", label: "Bi-Weekly", detail: "Every 14 days" },
  { value: "monthly", label: "Monthly", detail: "Once each month" },
  { value: "quarterly", label: "Quarterly", detail: "Every 3 months" },
  { value: "semi-annual", label: "Semi-Annual", detail: "Every 6 months" },
  { value: "annually", label: "Annually", detail: "Once each year" },
];

const normaliseInvoice = (invoice) => ({
  ...invoice,
  line_items: (invoice?.line_items || []).map((line) => {
    const quantity = Number(line.quantity ?? 1);
    const unitPrice = Number(line.unit_price ?? line.rate ?? 0);
    return {
      ...line,
      name: line.name || line.description || "Invoice item",
      description: line.description || line.name || "",
      quantity,
      unit_price: unitPrice,
      total: Number(line.total ?? line.amount ?? (quantity * unitPrice)),
    };
  }),
});

function ClientAutocomplete({
  clients,
  value,
  onValueChange,
  placeholder = "Search clients…",
  testId,
  excludeClientId = "",
  emptyMessage = "No matching clients found.",
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const availableClients = clients.filter((client) => client.id !== excludeClientId);
  const normalizedQuery = query.trim().toLowerCase();
  const matchingClients = normalizedQuery
    ? availableClients.filter((client) => [client.name, client.email, client.contact_name]
      .filter(Boolean)
      .some((field) => field.toLowerCase().includes(normalizedQuery)))
    : availableClients;
  const selectedClient = availableClients.find((client) => client.id === value)
    || clients.find((client) => client.id === value);

  return (
    <Popover open={open} onOpenChange={(nextOpen) => {
      setOpen(nextOpen);
      if (!nextOpen) setQuery("");
    }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          data-testid={testId}
          className="h-10 w-full justify-between border-white/10 bg-black/10 px-3 text-left font-normal hover:border-cyan-400/35 hover:bg-cyan-400/[0.04]"
        >
          <span className={selectedClient ? "truncate text-zinc-100" : "truncate text-muted-foreground"}>
            {selectedClient?.name || placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-cyan-300/70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[18rem] overflow-hidden border-cyan-400/25 bg-[#0b151d] p-0 shadow-2xl"
      >
        <Command shouldFilter={false}>
          <CommandInput
            autoFocus
            placeholder="Type a client name, email, or contact…"
            data-testid={`${testId}-search`}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {matchingClients.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>
            ) : (
              <CommandGroup heading={`${matchingClients.length} matching client${matchingClients.length === 1 ? "" : "s"}`}>
              {matchingClients.map((client) => (
                <CommandItem
                  key={client.id}
                  value={`${client.name || ""} ${client.email || ""} ${client.contact_name || ""}`}
                  onSelect={() => {
                    onValueChange(client.id);
                    setQuery("");
                    setOpen(false);
                  }}
                  className="py-2"
                >
                  <Check className={`mt-0.5 h-4 w-4 shrink-0 ${value === client.id ? "opacity-100 text-emerald-300" : "opacity-0"}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{client.name}</span>
                    {(client.email || client.contact_name) && <span className="block truncate text-[11px] text-muted-foreground">{client.email || client.contact_name}</span>}
                  </span>
                </CommandItem>
              ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function SearchableSelect({
  options,
  value,
  onValueChange,
  placeholder = "Choose an option…",
  searchPlaceholder = "Type to search…",
  emptyMessage = "No matching options found.",
  testId,
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const matchingOptions = normalizedQuery
    ? options.filter((option) => `${option.label || ""} ${option.detail || ""} ${option.searchText || ""}`.toLowerCase().includes(normalizedQuery))
    : options;
  const selectedOption = options.find((option) => option.value === value);

  return (
    <Popover open={open} onOpenChange={(nextOpen) => {
      if (disabled) return;
      setOpen(nextOpen);
      if (!nextOpen) setQuery("");
    }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-disabled={disabled}
          disabled={disabled}
          data-testid={testId}
          className="h-10 w-full justify-between border-white/10 bg-black/10 px-3 text-left font-normal hover:border-cyan-400/35 hover:bg-cyan-400/[0.04] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className={selectedOption ? "truncate text-zinc-100" : "truncate text-muted-foreground"}>{selectedOption?.label || placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-cyan-300/70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-[18rem] overflow-hidden border-cyan-400/25 bg-[#0b151d] p-0 shadow-2xl">
        <Command shouldFilter={false}>
          <CommandInput autoFocus placeholder={searchPlaceholder} data-testid={`${testId}-search`} value={query} onValueChange={setQuery} />
          <CommandList>
            {matchingOptions.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>
            ) : (
              <CommandGroup heading={`${matchingOptions.length} matching option${matchingOptions.length === 1 ? "" : "s"}`}>
                {matchingOptions.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    onSelect={() => {
                      onValueChange(option.value);
                      setQuery("");
                      setOpen(false);
                    }}
                    className="py-2"
                  >
                    <Check className={`mt-0.5 h-4 w-4 shrink-0 ${value === option.value ? "opacity-100 text-emerald-300" : "opacity-0"}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{option.label}</span>
                      {option.detail && <span className="block truncate text-[11px] text-muted-foreground">{option.detail}</span>}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function InvoicesPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [invoices, setInvoices] = useState([]);
  const [clients, setClients] = useState([]);
  const [products, setProducts] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPayment, setFilterPayment] = useState("all");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewInvoice, setViewInvoice] = useState(null);
  const [invoiceActivity, setInvoiceActivity] = useState([]);
  const [invoiceActivityError, setInvoiceActivityError] = useState("");
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ amount: "", method: "manual", reference: "", notes: "", date: "" });
  const [payingInvoice, setPayingInvoice] = useState(null);
  const [splitBillingOpen, setSplitBillingOpen] = useState(false);
  const [splitBillingInvoice, setSplitBillingInvoice] = useState(null);
  const [splitAllocations, setSplitAllocations] = useState([]);
  const [splitBillingBusy, setSplitBillingBusy] = useState(false);
  const [xeroStatus, setXeroStatus] = useState({ connected: false, configured: false, org_name: null });
  const [reconciliation, setReconciliation] = useState({ pending_count: 0, pending_total: 0, by_method: [] });
  const [billingProfileOpen, setBillingProfileOpen] = useState(false);
  const [billingProfileClient, setBillingProfileClient] = useState("");
  const [billingProfile, setBillingProfile] = useState({ billing_email: "", payment_terms_days: 30, purchase_order_required: false, default_payment_method: "bank_transfer", xero_contact_id: "" });
  const [settlementOpen, setSettlementOpen] = useState(false);
  const [settlementForm, setSettlementForm] = useState({ method: "eftpos", date: new Date().toISOString().slice(0, 10), reference: "" });
  const [moveDialog, setMoveDialog] = useState(false);
  const [moveTarget, setMoveTarget] = useState("");
  const [movingInvoice, setMovingInvoice] = useState(null);
  const [voidDialog, setVoidDialog] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [voidingInvoice, setVoidingInvoice] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState(null);
  const [pdfPreviewInvoice, setPdfPreviewInvoice] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  // Enhanced state
  const [detailTab, setDetailTab] = useState("items");
  const [emailHistory, setEmailHistory] = useState([]);
  const [emailDialog, setEmailDialog] = useState(false);
  const [emailForm, setEmailForm] = useState({ email: "", subject: "", message: "" });
  const [emailInvoiceTarget, setEmailInvoiceTarget] = useState(null);
  const [disputeScan, setDisputeScan] = useState(null);
  // SMS reminder state
  const [smsDialog, setSmsDialog] = useState(false);
  const [smsTemplates, setSmsTemplates] = useState([]);
  const [smsForm, setSmsForm] = useState({ to: "", template_key: "overdue_invoice", message: "" });
  const [smsSending, setSmsSending] = useState(false);
  const [smsHistory, setSmsHistory] = useState([]);
  const [creditNoteDialog, setCreditNoteDialog] = useState(false);
  const [creditNoteForm, setCreditNoteForm] = useState({ reason: "", line_items: [], subtotal: 0, tax: 0, total: 0 });
  const [revenueAnalytics, setRevenueAnalytics] = useState(null);
  const [topView, setTopView] = useState("list"); // list | revenue
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkConfirmAction, setBulkConfirmAction] = useState(null);
  const [form, setForm] = useState({
    client_id: "", contract_id: "", ticket_id: "", ticket_number: "", ticket_title: "", invoice_name: "", due_date: "", notes: "",
    line_items: [], tax_rate: "0", discount_pct: "0", discount_amount: "0",
    is_recurring: false, recurring_interval: "monthly",
    recurring_start_date: "", recurring_end_date: ""
  });
  const processedStripeSession = useRef(null);

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [invResult, clientResult, productResult, ticketResult, statsResult, xeroResult, reconciliationResult] = await Promise.allSettled([
        axios.get(`${API}/invoices`, { headers }),
        axios.get(`${API}/clients`, { headers }),
        axios.get(`${API}/products`, { headers }),
        axios.get(`${API}/tickets`, { headers }),
        axios.get(`${API}/invoices/stats/summary`, { headers }),
        axios.get(`${API}/xero/status`, { headers }),
        axios.get(`${API}/billing/reconciliation/summary`, { headers }),
      ]);
      if (invResult.status !== "fulfilled") throw invResult.reason;
      setInvoices((invResult.value.data || []).map(normaliseInvoice));
      setClients(clientResult.status === "fulfilled" ? clientResult.value.data : []);
      setProducts(productResult.status === "fulfilled" ? productResult.value.data : []);
      setTickets(ticketResult.status === "fulfilled" ? ticketResult.value.data : []);
      setStats(statsResult.status === "fulfilled" ? statsResult.value.data : {});
      setXeroStatus(xeroResult.status === "fulfilled" ? xeroResult.value.data : { connected: false, configured: false, org_name: null });
      setReconciliation(reconciliationResult.status === "fulfilled" ? reconciliationResult.value.data : { pending_count: 0, pending_total: 0, by_method: [] });
      if ([clientResult, productResult, ticketResult].some(result => result.status === "rejected")) {
        toast.warning("Invoices loaded, but one optional client, product, or ticket lookup is temporarily unavailable");
      }
    } catch {
      setLoadError("NexusMSP could not load invoices and the required billing records. No invoice changes have been made.");
      toast.error("Failed to load invoices");
    }
    finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const resetForm = () => setForm({
    client_id: "", contract_id: "", ticket_id: "", ticket_number: "", ticket_title: "", invoice_name: "", due_date: "", notes: "",
    line_items: [], tax_rate: "0",
    is_recurring: false, recurring_interval: "monthly",
    recurring_start_date: "", recurring_end_date: ""
  });

  const viewInvoiceDetail = useCallback(async (inv) => {
    setViewInvoice(inv);
    setDetailTab("items");
    setInvoiceActivityError("");
    try {
      const [actRes, emailRes] = await Promise.all([
        axios.get(`${API}/invoices/${inv.id}/activity-log`, { headers }).catch(error => {
          setInvoiceActivityError(error.response?.status === 403 ? "Invoice audit history is available to billing administrators." : "Invoice audit history could not be loaded.");
          return { data: [] };
        }),
        axios.get(`${API}/invoices/${inv.id}/email-history`, { headers }).catch(() => ({ data: [] })),
      ]);
      setInvoiceActivity(actRes.data);
      setEmailHistory(emailRes.data);
    } catch { setInvoiceActivity([]); setEmailHistory([]); setInvoiceActivityError("Invoice history could not be loaded."); }
  }, [headers]);

  const openCreate = () => {
    setEditing(null);
    resetForm();
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);
    setForm((current) => ({ ...current, due_date: dueDate.toISOString().slice(0, 10) }));
    setIsFormOpen(true);
  };

  // Chat and other workspaces can deep-link directly to a specific invoice.
  useEffect(() => {
    const invoiceId = searchParams.get("invoice");
    if (!invoiceId || viewInvoice?.id === invoiceId || invoices.length === 0) return;
    const target = invoices.find(invoice => invoice.id === invoiceId || invoice.invoice_number === invoiceId);
    if (target) viewInvoiceDetail(target);
  }, [invoices, searchParams, viewInvoice?.id, viewInvoiceDetail]);

  // Stripe payment callback
  useEffect(() => {
    const success = searchParams.get("payment_success");
    const sessionId = searchParams.get("session_id");
    if (success !== "true" || !sessionId || invoices.length === 0 || processedStripeSession.current === sessionId) return;
    const inv = invoices.find(invoice => invoice.stripe_session_id === sessionId);
    if (!inv) return;
    processedStripeSession.current = sessionId;
    axios.get(`${API}/invoices/${inv.id}/payment-status?session_id=${sessionId}`, { headers })
      .then(() => {
        toast.success("Payment processed successfully!");
        return fetchAll();
      })
      .catch(error => {
        processedStripeSession.current = null;
        console.error(error);
      });
  }, [fetchAll, headers, invoices, searchParams]);
  const openEdit = (inv) => {
    setEditing(inv);
    setForm({
      client_id: inv.client_id, contract_id: inv.contract_id || "", ticket_id: inv.ticket_id || "", ticket_number: inv.ticket_number || "", ticket_title: inv.ticket_title || "", due_date: inv.due_date,
      invoice_name: inv.invoice_name || "", notes: inv.notes || "", line_items: normaliseInvoice(inv).line_items, tax_rate: String(inv.tax_rate || 0),
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
        if (prod) { items[idx].name = prod.name; items[idx].unit_price = prod.sell_price ?? prod.retail_price ?? 0; items[idx].description = prod.sku || ""; }
      }
      items[idx].total = (items[idx].quantity || 0) * (items[idx].unit_price || 0);
      return { ...f, line_items: items };
    });
  };

  const removeLineItem = (idx) => setForm(f => ({ ...f, line_items: f.line_items.filter((_, i) => i !== idx) }));
  const handleBulkAction = async (action, confirmed = false) => {
    if (selectedIds.size === 0) return;
    if (["delete", "void"].includes(action) && !confirmed) {
      setBulkConfirmAction(action);
      return;
    }
    setBulkBusy(true);
    try {
      const res = await axios.post(`${API}/billing-pro/invoices/bulk-action`, { invoice_ids: [...selectedIds], action }, { headers });
      const n = res.data.updated ?? res.data.deleted ?? 0;
      toast.success(`${action.replace("_", " ")} → ${n} invoice(s)`);
      setSelectedIds(new Set());
      setBulkConfirmAction(null);
      fetchAll();
    } catch (e) { toast.error(e.response?.data?.detail || "Bulk action failed"); }
    finally { setBulkBusy(false); }
  };

  const handleExportCsv = async () => {
    setBulkBusy(true);
    try {
      const ids = [...selectedIds];
      const res = await axios.post(`${API}/billing-pro/invoices/export-csv`,
        ids.length > 0 ? { invoice_ids: ids } : { filter: { status: filterStatus } },
        { headers });
      const blob = new Blob([res.data.csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = res.data.filename || "invoices.csv"; a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${res.data.count} invoice(s)`);
    } catch { toast.error("Export failed"); }
    finally { setBulkBusy(false); }
  };

  const handleSave = async () => {
    if (!form.client_id) { toast.error("Client is required"); return; }
    if (!form.due_date) { toast.error("Due date is required"); return; }
    if (form.line_items.length === 0) { toast.error("Add at least one invoice line before saving"); return; }
    if (form.line_items.some(line => !line.name?.trim() || Number(line.quantity) <= 0 || Number(line.unit_price) < 0)) {
      toast.error("Each line needs a name, positive quantity, and valid unit price"); return;
    }
    const payload = {
      ...form,
      tax_rate: parseFloat(form.tax_rate) || 0,
      discount_pct: parseFloat(form.discount_pct) || 0,
      discount_amount: parseFloat(form.discount_amount) || 0,
      line_items: form.line_items.map(li => {
        const q = li.quantity || 0;
        const u = li.unit_price || 0;
        const dpct = parseFloat(li.discount_pct) || 0;
        const tpct = parseFloat(li.tax_rate) || 0;
        const lineTotal = q * u * (1 - dpct / 100);
        return { ...li, discount_pct: dpct, tax_rate: tpct, total: lineTotal };
      })
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
    try { await axios.delete(`${API}/invoices/${id}`, { headers }); toast.success("Deleted"); setDeleteTarget(null); fetchAll(); if (viewInvoice?.id === id) setViewInvoice(null); }
    catch { toast.error("Failed"); }
  };

  const handleStatusChange = async (inv, status) => {
    try {
      await axios.put(`${API}/invoices/${inv.id}`, { status }, { headers });
      toast.success(status === "sent" ? "Invoice marked as sent" : `Status: ${status}`);
      fetchAll();
      if (viewInvoice?.id === inv.id) setViewInvoice({ ...viewInvoice, status, ...(status === "sent" ? { sent_at: new Date().toISOString() } : {}) });
    } catch (e) { toast.error(e.response?.data?.detail || "Unable to update invoice status"); }
  };

  const openPaymentDialog = (inv, method = "eftpos") => {
    const balance = Math.max(0, (inv.total || 0) - (inv.amount_paid || 0));
    setPayingInvoice(inv);
    setPaymentForm({
      amount: String(balance.toFixed(2)),
      method,
      reference: "",
      notes: "",
      date: new Date().toISOString().split("T")[0],
    });
    setIsPaymentOpen(true);
  };

  const openBillingProfile = async (clientId = form.client_id || clients[0]?.id || "") => {
    if (!clientId) { toast.info("Create or select a client first"); return; }
    setBillingProfileClient(clientId);
    try {
      const response = await axios.get(`${API}/clients/${clientId}/billing-profile`, { headers });
      setBillingProfile(response.data);
      setBillingProfileOpen(true);
    } catch (error) { toast.error(error.response?.data?.detail || "Could not load billing profile"); }
  };

  const saveBillingProfile = async () => {
    try {
      await axios.put(`${API}/clients/${billingProfileClient}/billing-profile`, billingProfile, { headers });
      toast.success("Client billing profile saved");
      setBillingProfileOpen(false);
      fetchAll();
    } catch (error) { toast.error(error.response?.data?.detail || "Could not save billing profile"); }
  };

  const closeSettlement = async () => {
    try {
      const response = await axios.post(`${API}/billing/reconciliation/settlements`, settlementForm, { headers });
      toast.success(`Settlement ${response.data.id} created — ready for Xero reconciliation`);
      setSettlementOpen(false); setSettlementForm(f => ({ ...f, reference: "" })); fetchAll();
    } catch (error) { toast.error(error.response?.data?.detail || "Could not close settlement"); }
  };

  const handleManualPayment = async () => {
    if (!paymentForm.amount || parseFloat(paymentForm.amount) <= 0) { toast.error("Enter valid amount"); return; }
    const remaining = (payingInvoice?.total || 0) - (payingInvoice?.amount_paid || 0);
    if (parseFloat(paymentForm.amount) > remaining + 0.001) { toast.error(`Payment cannot exceed the remaining balance of $${remaining.toFixed(2)}`); return; }
    try {
      await axios.post(
        `${API}/invoices/${payingInvoice.id}/record-payment`,
        { ...paymentForm, idempotency_key: crypto.randomUUID() },
        { headers },
      );
      toast.success("Payment recorded");
      setIsPaymentOpen(false);
      fetchAll();
      if (viewInvoice?.id === payingInvoice.id) {
        const updated = await axios.get(`${API}/invoices/${payingInvoice.id}`, { headers });
        setViewInvoice(updated.data);
      }
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const openSplitBilling = (inv) => {
    if (inv.is_split_parent || inv.is_split_child) {
      toast.info("This invoice is already part of a split-billing record");
      return;
    }
    setSplitBillingInvoice(inv);
    setSplitAllocations([{ payer_client_id: inv.client_id || "", amount: String(Number(inv.total || 0).toFixed(2)), description: "Primary payer allocation" }]);
    setSplitBillingOpen(true);
  };

  const updateSplitAllocation = (index, field, value) => {
    setSplitAllocations(current => current.map((allocation, allocationIndex) => (
      allocationIndex === index ? { ...allocation, [field]: value } : allocation
    )));
  };

  const removeSplitAllocation = (index) => {
    setSplitAllocations(current => current.filter((_, allocationIndex) => allocationIndex !== index));
  };

  const totalSplitAllocated = splitAllocations.reduce((sum, allocation) => sum + (parseFloat(allocation.amount) || 0), 0);

  const handleCreateSplitBilling = async () => {
    if (!splitBillingInvoice) return;
    const sourceTotal = Number(splitBillingInvoice.total || 0);
    if (splitAllocations.length < 2) { toast.error("Add at least two customer payers"); return; }
    if (splitAllocations.some(allocation => !allocation.payer_client_id || !(parseFloat(allocation.amount) > 0))) {
      toast.error("Each allocation needs a customer and a positive amount"); return;
    }
    if (Math.abs(totalSplitAllocated - sourceTotal) > 0.005) {
      toast.error(`Allocations must equal $${sourceTotal.toFixed(2)}`); return;
    }
    if (new Set(splitAllocations.map(allocation => allocation.payer_client_id)).size < 2) {
      toast.error("Select at least two different customer payers"); return;
    }
    setSplitBillingBusy(true);
    try {
      const response = await axios.post(`${API}/invoices/${splitBillingInvoice.id}/split-billing`, { allocations: splitAllocations }, { headers });
      toast.success(`${response.data.payer_invoices?.length || 0} payer invoices created`);
      setSplitBillingOpen(false);
      setSplitBillingInvoice(null);
      setSplitAllocations([]);
      setViewInvoice(response.data.parent);
      setDetailTab("split");
      fetchAll();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not create split-billing invoices");
    } finally {
      setSplitBillingBusy(false);
    }
  };

  const openSplitPayerInvoice = async (invoiceId) => {
    try {
      const response = await axios.get(`${API}/invoices/${invoiceId}`, { headers });
      viewInvoiceDetail(response.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not open the payer invoice");
    }
  };

  const openInvoiceEmail = (invoice) => {
    const client = clients.find(clientItem => clientItem.id === invoice.client_id);
    setEmailInvoiceTarget(invoice);
    setEmailForm({ email: client?.email || "", subject: `Invoice ${invoice.invoice_number}`, message: "" });
    setEmailDialog(true);
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
    if (!emailForm.email.trim()) { toast.error("Enter the recipient email address"); return; }
    const invoiceTarget = emailInvoiceTarget || viewInvoice;
    if (!invoiceTarget) return;
    try {
      const response = await axios.post(
        `${API}/invoices/${invoiceTarget.id}/email`,
        { ...emailForm, idempotency_key: crypto.randomUUID() },
        { headers },
      );
      if (response.data?.sent) toast.success("Invoice emailed");
      else toast.warning(response.data?.message || "Email delivery is not configured");
      setEmailDialog(false);
      setEmailInvoiceTarget(null);
      const [invoiceRes, historyRes] = await Promise.all([
        axios.get(`${API}/invoices/${invoiceTarget.id}`, { headers }),
        axios.get(`${API}/invoices/${invoiceTarget.id}/email-history`, { headers }),
      ]);
      if (viewInvoice?.id === invoiceTarget.id) {
        setViewInvoice(invoiceRes.data);
        setEmailHistory(historyRes.data);
      }
      setInvoices(current => current.map(invoice => invoice.id === invoiceRes.data.id ? invoiceRes.data : invoice));
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
      const urlWithToken = `${API}/invoices/${inv.id}/pdf?token=${encodeURIComponent(token)}`;
      const res = await axios.get(urlWithToken, { headers, responseType: "blob" });
      if (res.data?.type && !res.data.type.includes("pdf")) throw new Error("Invoice PDF was not returned");
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      setPdfPreviewUrl(url);
    } catch { toast.error("Failed to generate invoice PDF"); }
    finally { setPdfLoading(false); }
  };

  const handlePdfDownload = async (inv) => {
    try {
      const urlWithToken = `${API}/invoices/${inv.id}/pdf/download?token=${encodeURIComponent(token)}`;
      const res = await axios.get(urlWithToken, { headers, responseType: "blob" });
      if (res.data?.type && !res.data.type.includes("pdf")) throw new Error("Invoice PDF was not returned");
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      const a = document.createElement("a"); a.href = url; a.download = `${inv.invoice_number || "invoice"}.pdf`; a.click();
      window.URL.revokeObjectURL(url); toast.success("PDF downloaded");
    } catch { toast.error("Failed to download invoice PDF"); }
  };

  const closePdfPreview = () => {
    if (pdfPreviewUrl) window.URL.revokeObjectURL(pdfPreviewUrl);
    setPdfPreviewUrl(null); setPdfPreviewInvoice(null);
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
    .filter(i => !search || i.invoice_number?.toLowerCase().includes(search.toLowerCase()) || i.invoice_name?.toLowerCase().includes(search.toLowerCase()) || i.client_name?.toLowerCase().includes(search.toLowerCase()));

  const getEffectiveStatus = (inv) => {
    if (inv.is_split_parent) return "split_billed";
    if (inv.payment_status === "paid") return "paid";
    if (inv.due_date && isPast(parseISO(inv.due_date)) && inv.payment_status !== "paid") return "overdue";
    return inv.status;
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  if (loadError) {
    return (
      <PageShell data-testid="invoices-load-error">
        <Card className="mx-auto mt-10 max-w-2xl border-rose-500/30 bg-rose-500/[0.045]">
          <CardContent className="flex flex-col items-center gap-4 px-6 py-10 text-center">
            <AlertTriangle className="h-10 w-10 text-rose-300" />
            <div><h1 className="text-lg font-semibold">Invoice workspace is unavailable</h1><p className="mt-1 max-w-lg text-sm text-muted-foreground">{loadError}</p></div>
            <Button onClick={fetchAll} data-testid="retry-invoices-load"><RefreshCw className="mr-2 h-4 w-4" />Retry invoices</Button>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  // ========== SHARED DIALOGS ==========
  const dialogs = (
    <>
      {/* CREATE/EDIT */}
      <Dialog open={isFormOpen} onOpenChange={v => { setIsFormOpen(v); if (!v) setEditing(null); }}>
        <DialogContent className="flex max-h-[92vh] max-w-5xl flex-col overflow-hidden border-cyan-400/25 bg-[linear-gradient(145deg,rgba(9,22,30,0.98),rgba(13,15,21,0.98))] p-0">
          <DialogHeader className="shrink-0 border-b border-cyan-400/15 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.17),transparent_45%),linear-gradient(135deg,rgba(16,185,129,0.10),transparent)] px-6 py-5 text-left">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Billing document workspace</p>
            <div className="flex flex-wrap items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-400/25 bg-emerald-400/10"><Receipt className="h-4 w-4 text-emerald-300" /></span><DialogTitle className="text-2xl tracking-tight text-zinc-100">{editing ? `Edit ${editing.invoice_number}` : "Create invoice"}</DialogTitle><Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/5 text-[10px] text-emerald-300">Product catalogue linked</Badge></div>
            <DialogDescription>Build a client-ready invoice from the product catalogue. Link one related ticket to keep all invoice lines, billing events, and audit activity traceable to the service record.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5 pr-6">
            <div className="grid grid-cols-4 gap-3">
              <div className="col-span-4 rounded-xl border border-cyan-400/15 bg-cyan-400/[0.035] p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4"><div className="min-w-0 flex-1"><Label>Invoice name <span className="font-normal text-muted-foreground">(internal)</span></Label><Input value={form.invoice_name} onChange={e => setForm({ ...form, invoice_name: e.target.value })} maxLength={160} placeholder="e.g. July 2026 managed services" data-testid="invoice-name" /><p className="mt-1 text-[10px] leading-relaxed text-cyan-200/75">A searchable workspace label for technicians. It does not replace the formal invoice number or client-facing notes.</p></div><Badge variant="outline" className="shrink-0 border-cyan-400/20 bg-cyan-400/[0.05] text-[10px] text-cyan-100">Optional</Badge></div>
              </div>
              <div className="col-span-2">
                <div className="flex items-center justify-between"><Label>Client *</Label>{form.client_id && <button type="button" className="text-[11px] font-medium text-emerald-300 hover:text-emerald-200" onClick={() => openBillingProfile(form.client_id)}>Billing profile</button>}</div>
                <ClientAutocomplete
                  clients={clients}
                  value={form.client_id}
                  testId="invoice-client"
                  placeholder="Search for a client…"
                  onValueChange={v => setForm(current => {
                  const linkedTicket = tickets.find(ticket => ticket.id === current.ticket_id);
                  const ticketBelongsToClient = !linkedTicket || linkedTicket.client_id === v;
                  return ticketBelongsToClient
                    ? { ...current, client_id: v }
                    : { ...current, client_id: v, ticket_id: "", ticket_number: "", ticket_title: "" };
                  })}
                />
                <p className="mt-1 text-[10px] text-cyan-200/75">Start typing to find a client by name, billing email, or contact.</p>
              </div>
              <div className="col-span-2">
                <Label className="flex items-center gap-1.5">Related ticket <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <SearchableSelect
                  testId="invoice-ticket-select"
                  value={form.ticket_id || "__none"}
                  placeholder="Search a related ticket…"
                  searchPlaceholder="Search ticket number or title…"
                  emptyMessage="No tickets match the selected client."
                  options={[
                    { value: "__none", label: "No ticket linked", detail: "Keep this as account-level billing", searchText: "account billing none" },
                    ...tickets
                      .filter(ticket => !form.client_id || ticket.client_id === form.client_id)
                      .map(ticket => ({
                        value: ticket.id,
                        label: `${ticket.ticket_number || "Ticket"} — ${ticket.title || "Untitled"}`,
                        detail: ticket.status ? `Status: ${ticket.status.replace(/_/g, " ")}` : "Service ticket",
                        searchText: `${ticket.ticket_number || ""} ${ticket.title || ""}`,
                      })),
                  ]}
                  onValueChange={v => {
                    const ticket = tickets.find(item => item.id === v);
                    setForm(current => ({
                      ...current,
                      ticket_id: v === "__none" ? "" : v,
                      ticket_number: ticket?.ticket_number || "",
                      ticket_title: ticket?.title || "",
                      client_id: v === "__none" ? current.client_id : (ticket?.client_id || current.client_id),
                    }));
                  }}
                />
                <p className="mt-1 text-[10px] text-cyan-200/80">One ticket applies to every line and billing event on this invoice.</p>
              </div>
              <div><Label>Due Date *</Label><Input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} data-testid="invoice-due-date" /></div>
              <div><Label>Tax Rate (%)</Label><Input type="number" step="0.01" value={form.tax_rate} onChange={e => setForm({ ...form, tax_rate: e.target.value })} /></div>
              <div><Label>Discount %</Label><Input type="number" step="0.1" value={form.discount_pct} onChange={e => setForm({ ...form, discount_pct: e.target.value })} data-testid="invoice-discount-pct" /></div>
              <div className="flex items-end"><div className={`w-full rounded-lg border px-3 py-2 text-xs ${form.ticket_id ? "border-cyan-400/20 bg-cyan-400/[0.05] text-cyan-100" : "border-white/[0.08] bg-white/[0.025] text-zinc-500"}`}><span className="font-semibold">{form.ticket_id ? form.ticket_number || "Ticket linked" : "No ticket link"}</span><p className="mt-0.5 text-[10px] opacity-80">{form.ticket_id ? "Invoice and ticket audits are connected." : "Use for account-level billing."}</p></div></div>
            </div>
            <Separator />
            <div>
              <div className="flex items-center justify-between mb-2">
                <div><Label className="text-base font-semibold">Line items</Label><p className="mt-0.5 text-xs text-muted-foreground">Choose a catalogue product to automatically apply its name, SKU and sell price, or add a manual billing line.</p></div>
                <div className="flex items-center gap-1.5">
                  {form.client_id && (
                    <Button
                      variant="outline" size="sm"
                      className="border-violet-500/30 text-violet-300 hover:bg-violet-500/10"
                      onClick={async () => {
                        try {
                          const r = await axios.get(`${API}/billing-pro/invoices/smart-suggest?client_id=${form.client_id}&days=30`, { headers });
                          if (!r.data.suggestions?.length) { toast.info("No un-invoiced billable activity in last 30 days"); return; }
                          const newLines = r.data.suggestions.map(s => ({
                            name: s.description, description: "", quantity: s.quantity,
                            unit_price: s.unit_price, total: s.total, product_id: s.product_id || ""
                          }));
                          setForm(p => ({ ...p, line_items: [...p.line_items, ...newLines] }));
                          toast.success(`Added ${newLines.length} suggested line(s) — $${r.data.total.toFixed(2)}`);
                        } catch { toast.error("Suggest failed"); }
                      }}
                      data-testid="ai-smart-suggest"
                    ><Zap className="w-3 h-3 mr-1" />AI Smart-Suggest</Button>
                  )}
                  <Button variant="outline" size="sm" onClick={addLineItem} data-testid="add-inv-line-item"><PackagePlus className="w-3 h-3 mr-1" />Add catalogue line</Button>
                </div>
              </div>
              {form.line_items.length === 0 ? (
                <div className="text-center py-6 border rounded-lg border-dashed text-muted-foreground text-sm"><Receipt className="w-8 h-8 mx-auto mb-2 opacity-30" />No items. Add from product catalog or manually.</div>
              ) : (
                <div className="space-y-2">
                  {form.line_items.map((li, idx) => (
                    <div key={`k-${idx}`} className="grid grid-cols-12 gap-2 items-end p-2 rounded-lg border bg-muted/20">
                      <div className="col-span-3">
                        {idx === 0 && <Label className="text-xs">Product / Item</Label>}
                        <SearchableSelect
                          testId={`invoice-line-product-${idx}`}
                          value={li.product_id || ""}
                          placeholder="Search catalogue…"
                          searchPlaceholder="Search product name or SKU…"
                          emptyMessage="No catalogue products found."
                          options={products.map(product => ({
                            value: product.id,
                            label: product.name || "Untitled product",
                            detail: `${product.sku || "No SKU"} · $${(product.sell_price ?? product.retail_price ?? 0).toFixed(2)}`,
                            searchText: `${product.name || ""} ${product.sku || ""}`,
                          }))}
                          onValueChange={v => updateLineItem(idx, "product_id", v)}
                        />
                      </div>
                      <div className="col-span-2">{idx === 0 && <Label className="text-xs">Name</Label>}<Input value={li.name} onChange={e => updateLineItem(idx, "name", e.target.value)} placeholder="Item name" /></div>
                      <div className="col-span-1">{idx === 0 && <Label className="text-xs">Qty</Label>}<Input type="number" min="1" step="0.01" value={li.quantity} onChange={e => updateLineItem(idx, "quantity", parseFloat(e.target.value) || 0)} /></div>
                      <div className="col-span-2">{idx === 0 && <Label className="text-xs">Unit Price</Label>}<Input type="number" step="0.01" value={li.unit_price} onChange={e => updateLineItem(idx, "unit_price", parseFloat(e.target.value) || 0)} /></div>
                      <div className="col-span-1">{idx === 0 && <Label className="text-xs">Disc %</Label>}<Input type="number" step="0.1" value={li.discount_pct || 0} onChange={e => updateLineItem(idx, "discount_pct", parseFloat(e.target.value) || 0)} data-testid={`line-disc-${idx}`} /></div>
                      <div className="col-span-1">{idx === 0 && <Label className="text-xs">Tax %</Label>}<Input type="number" step="0.1" value={li.tax_rate || ""} onChange={e => updateLineItem(idx, "tax_rate", parseFloat(e.target.value) || 0)} placeholder="—" data-testid={`line-tax-${idx}`} /></div>
                      <div className="col-span-1 text-right">{idx === 0 && <Label className="text-xs block">Total</Label>}<p className="font-mono text-sm font-medium py-2">${(((li.quantity || 0) * (li.unit_price || 0)) * (1 - (parseFloat(li.discount_pct) || 0) / 100)).toFixed(2)}</p></div>
                      <div className="col-span-1 text-right"><Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive" onClick={() => removeLineItem(idx)}><Trash2 className="w-3 h-3" /></Button></div>
                    </div>
                  ))}
                  <div className="flex flex-col items-end gap-1 text-sm mt-2">
                    {(() => {
                      const sub = form.line_items.reduce((s, li) => s + ((li.quantity || 0) * (li.unit_price || 0)) * (1 - (parseFloat(li.discount_pct) || 0) / 100), 0);
                      const dpct = parseFloat(form.discount_pct) || 0;
                      const dAmt = sub * dpct / 100;
                      const after = Math.max(0, sub - dAmt);
                      const tax = after * ((parseFloat(form.tax_rate) || 0) / 100);
                      return (
                        <>
                          <div className="flex gap-8"><span className="text-muted-foreground">Subtotal</span><span className="font-mono">${sub.toFixed(2)}</span></div>
                          {dpct > 0 && <div className="flex gap-8 text-amber-400"><span>Discount ({dpct}%)</span><span className="font-mono">-${dAmt.toFixed(2)}</span></div>}
                          <div className="flex gap-8"><span className="text-muted-foreground">Tax ({form.tax_rate || 0}%)</span><span className="font-mono">${tax.toFixed(2)}</span></div>
                          <div className="flex gap-8 text-base font-semibold"><span>Total</span><span className="font-mono text-green-500">${(after + tax).toFixed(2)}</span></div>
                        </>
                      );
                    })()}
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
                    <SearchableSelect
                      testId="recurring-interval"
                      value={form.recurring_interval}
                      onValueChange={v => setForm({ ...form, recurring_interval: v })}
                      options={RECURRING_INTERVAL_OPTIONS}
                      placeholder="Search frequency…"
                      searchPlaceholder="Search frequency…"
                    />
                  </div>
                  <div><Label className="text-xs">Start Date</Label><Input type="date" value={form.recurring_start_date} onChange={e => setForm({ ...form, recurring_start_date: e.target.value })} /></div>
                  <div><Label className="text-xs">End Date (optional)</Label><Input type="date" value={form.recurring_end_date} onChange={e => setForm({ ...form, recurring_end_date: e.target.value })} /></div>
                </div>
              )}
            </div>
          </div>
          <DialogFooter className="shrink-0 border-t border-white/[0.07] bg-black/10 px-6 py-4"><p className="mr-auto text-xs text-zinc-500">Saved invoices remain drafts until you explicitly send or mark them as sent.</p><Button variant="success" onClick={handleSave} data-testid="save-invoice-btn">{editing ? "Save audited changes" : "Create draft invoice"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MANUAL PAYMENT */}
      <Dialog open={isPaymentOpen} onOpenChange={setIsPaymentOpen}>
        <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-3xl overflow-hidden p-0">
          <DialogHeader className="border-b border-border/80 px-6 py-5">
            <div className="flex items-start gap-3 pr-6">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10"><Banknote className="h-5 w-5 text-emerald-300" /></span>
              <div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300">Billing workflow</p><DialogTitle className="mt-1">Record customer payment</DialogTitle><DialogDescription className="mt-1">Create the auditable payment record here, then reconcile it with Xero once the bank feed or terminal settlement is available.</DialogDescription></div>
            </div>
          </DialogHeader>
          <div className="space-y-5 px-6 py-5">
            {payingInvoice && <div className="grid gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.035] p-4 sm:grid-cols-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">Invoice</p><p className="mt-1 font-mono text-sm font-semibold">{payingInvoice.invoice_number}</p></div><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Client</p><p className="mt-1 truncate text-sm font-medium">{payingInvoice.client_name || "Unassigned client"}</p></div><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Remaining balance</p><p className="mt-1 text-sm font-semibold text-emerald-300">${Math.max(0, (payingInvoice.total || 0) - (payingInvoice.amount_paid || 0)).toFixed(2)}</p></div></div>}
            <div className="grid gap-4 sm:grid-cols-2"><div><Label>Payment amount ($)</Label><Input className="mt-1" type="number" min="0.01" step="0.01" value={paymentForm.amount} onChange={e => setPaymentForm({ ...paymentForm, amount: e.target.value })} data-testid="payment-amount" /></div><div><Label>Payment date</Label><Input className="mt-1" type="date" value={paymentForm.date} onChange={e => setPaymentForm({ ...paymentForm, date: e.target.value })} /></div></div>
            <div><Label>Payment method</Label>
              <Select value={paymentForm.method} onValueChange={v => setPaymentForm({ ...paymentForm, method: v })}>
                <SelectTrigger className="mt-1" data-testid="payment-method"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="eftpos">EFTPOS terminal</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="bank_transfer">Bank transfer / EFT</SelectItem>
                  <SelectItem value="xero_reconciled">Already reconciled in Xero</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="rounded-md border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-xs text-muted-foreground">{paymentForm.method === "eftpos" ? "Record the EFTPOS terminal receipt or settlement reference so the payment can be matched in Xero." : paymentForm.method === "cash" ? "Record the receipt number or till reference. Cash payments should be reconciled with the daily cash-up." : paymentForm.method === "xero_reconciled" ? "Use this only after the payment is matched in Xero; include the Xero payment or bank-feed reference." : "Include the banking or remittance reference so finance can reconcile the payment in Xero."}</p>
            <div><Label>Reference</Label><Input className="mt-1" value={paymentForm.reference} onChange={e => setPaymentForm({ ...paymentForm, reference: e.target.value })} placeholder={paymentForm.method === "eftpos" ? "Terminal receipt / settlement ID" : "Payment or remittance reference"} data-testid="payment-reference" /></div>
            <div><Label>Internal notes</Label><Textarea className="mt-1" value={paymentForm.notes} onChange={e => setPaymentForm({ ...paymentForm, notes: e.target.value })} placeholder="Optional reconciliation, remittance, or customer notes" rows={3} /></div>
          </div>
          <DialogFooter className="border-t border-border/80 px-6 py-4"><Button variant="outline" onClick={() => setIsPaymentOpen(false)}>Cancel</Button><Button onClick={handleManualPayment} data-testid="confirm-payment-btn"><Check className="mr-1.5 h-4 w-4" />Record audited payment</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={splitBillingOpen} onOpenChange={(open) => { setSplitBillingOpen(open); if (!open && !splitBillingBusy) { setSplitBillingInvoice(null); setSplitAllocations([]); } }}>
        <DialogContent className="flex max-h-[92vh] w-[calc(100vw-2rem)] max-w-4xl flex-col overflow-hidden border-violet-400/25 bg-[linear-gradient(145deg,rgba(18,14,34,0.99),rgba(9,20,29,0.99))] p-0">
          <DialogHeader className="shrink-0 border-b border-violet-400/20 bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,0.19),transparent_45%),linear-gradient(135deg,rgba(34,211,238,0.08),transparent)] px-6 py-5 text-left">
            <div className="flex items-start gap-3 pr-6">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-violet-400/30 bg-violet-500/10"><Users className="h-5 w-5 text-violet-200" /></span>
              <div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-200">Shared billing workflow</p><DialogTitle className="mt-1 text-2xl tracking-tight text-zinc-100">Split billing across customers</DialogTitle><DialogDescription className="mt-1">Create one auditable payer invoice per customer. The source draft remains available as a locked allocation ledger and is excluded from receivables to prevent double counting.</DialogDescription></div>
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
            {splitBillingInvoice && (() => {
              const sourceTotal = Number(splitBillingInvoice.total || 0);
              const remaining = Math.round((sourceTotal - totalSplitAllocated) * 100) / 100;
              const isBalanced = Math.abs(remaining) < 0.005;
              return (
                <>
                  <div className="grid gap-3 rounded-xl border border-violet-400/20 bg-violet-500/[0.055] p-4 sm:grid-cols-3">
                    <div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-200">Source draft</p><p className="mt-1 font-mono text-sm font-semibold text-zinc-100">{splitBillingInvoice.invoice_number}</p></div>
                    <div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Original customer</p><p className="mt-1 truncate text-sm font-medium text-zinc-100">{splitBillingInvoice.client_name || "Unassigned"}</p></div>
                    <div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Amount to allocate</p><p className="mt-1 text-sm font-semibold text-violet-100">${sourceTotal.toFixed(2)} <span className="text-xs font-normal text-violet-200/70">tax inclusive</span></p></div>
                  </div>
                  <div className="rounded-xl border border-sky-500/20 bg-sky-500/[0.045] px-4 py-3 text-xs leading-relaxed text-sky-100"><span className="font-semibold">How it works:</span> allocate the full gross total between at least two different customers. Each payer receives their own PDF, email history, payment ledger and Xero reconciliation trail. Tax is apportioned from the source invoice’s tax profile.</div>
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-end justify-between gap-3"><div><Label className="text-base font-semibold text-zinc-100">Payer allocations</Label><p className="mt-1 text-xs text-muted-foreground">Use customer search to select who is responsible for each portion.</p></div><Button type="button" variant="outline" className="border-violet-400/30 text-violet-100 hover:bg-violet-500/10" onClick={() => setSplitAllocations(current => [...current, { payer_client_id: "", amount: "", description: "" }])} data-testid="add-split-payer"><Plus className="mr-1.5 h-4 w-4" />Add payer</Button></div>
                    {splitAllocations.map((allocation, index) => (
                      <div key={`split-allocation-form-${index}`} className="grid gap-3 rounded-xl border border-white/[0.09] bg-black/[0.14] p-4 md:grid-cols-12 md:items-end">
                        <div className="md:col-span-5"><Label className="text-xs">Customer payer</Label><div className="mt-1"><ClientAutocomplete clients={clients} value={allocation.payer_client_id} onValueChange={(value) => updateSplitAllocation(index, "payer_client_id", value)} placeholder="Search customer, email, or contact…" testId={`split-payer-client-${index}`} /></div></div>
                        <div className="md:col-span-2"><Label className="text-xs">Gross amount ($)</Label><Input className="mt-1 font-mono" type="number" min="0.01" step="0.01" value={allocation.amount} onChange={(event) => updateSplitAllocation(index, "amount", event.target.value)} placeholder="0.00" data-testid={`split-payer-amount-${index}`} /></div>
                        <div className="md:col-span-4"><Label className="text-xs">Allocation detail <span className="font-normal text-muted-foreground">(optional)</span></Label><Input className="mt-1" value={allocation.description || ""} onChange={(event) => updateSplitAllocation(index, "description", event.target.value)} placeholder="e.g. hardware contribution" data-testid={`split-payer-description-${index}`} /></div>
                        <div className="flex justify-end md:col-span-1"><Button type="button" variant="ghost" size="sm" className="h-10 w-10 p-0 text-zinc-400 hover:bg-rose-500/10 hover:text-rose-300 disabled:opacity-35" disabled={splitAllocations.length <= 1} onClick={() => removeSplitAllocation(index)} title="Remove payer" aria-label="Remove payer"><Trash2 className="h-4 w-4" /></Button></div>
                      </div>
                    ))}
                  </div>
                  <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${isBalanced ? "border-emerald-500/25 bg-emerald-500/[0.055]" : "border-amber-500/25 bg-amber-500/[0.055]"}`}>
                    <div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Allocation check</p><p className={`mt-1 text-sm font-semibold ${isBalanced ? "text-emerald-200" : "text-amber-200"}`}>{isBalanced ? "Balanced — ready to create payer invoices" : remaining > 0 ? `$${remaining.toFixed(2)} still needs a payer` : `$${Math.abs(remaining).toFixed(2)} over-allocated`}</p></div>
                    <div className="text-right text-xs"><p className="text-muted-foreground">Allocated <span className="font-mono text-zinc-100">${totalSplitAllocated.toFixed(2)}</span></p><p className="mt-1 text-muted-foreground">Source <span className="font-mono text-zinc-100">${sourceTotal.toFixed(2)}</span></p></div>
                  </div>
                </>
              );
            })()}
          </div>
          <DialogFooter className="shrink-0 border-t border-violet-400/15 bg-black/20 px-6 py-4"><p className="mr-auto max-w-lg text-xs text-zinc-500">This cannot be reversed automatically. If a payer invoice has already been sent or paid, use the normal credit-note process for corrections.</p><Button variant="outline" onClick={() => setSplitBillingOpen(false)} disabled={splitBillingBusy}>Cancel</Button><Button onClick={handleCreateSplitBilling} disabled={splitBillingBusy || splitAllocations.length < 2} data-testid="confirm-split-billing-btn">{splitBillingBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Users className="mr-1.5 h-4 w-4" />}Create payer invoices</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={billingProfileOpen} onOpenChange={setBillingProfileOpen}>
        <NexusWorkflowDialog eyebrow="Billing controls" title="Client billing profile" description="Set the defaults that keep billing, approval and Xero matching consistent for this client." icon={Building2} tone="cyan" className="max-w-lg" footer={<><Button variant="outline" onClick={() => setBillingProfileOpen(false)}>Cancel</Button><Button onClick={saveBillingProfile}>Save billing profile</Button></>}>
          <div className="space-y-4">
            <div><Label>Client</Label><ClientAutocomplete clients={clients} value={billingProfileClient} onValueChange={openBillingProfile} placeholder="Search for a client…" testId="billing-profile-client" /></div>
            <div className="grid grid-cols-2 gap-3"><div><Label>Billing email</Label><Input type="email" value={billingProfile.billing_email || ""} onChange={e => setBillingProfile({ ...billingProfile, billing_email: e.target.value })} placeholder="accounts@client.com" /></div><div><Label>Payment terms (days)</Label><Input type="number" min="0" max="365" value={billingProfile.payment_terms_days ?? 30} onChange={e => setBillingProfile({ ...billingProfile, payment_terms_days: e.target.value })} /></div></div>
            <div className="grid grid-cols-2 gap-3"><div><Label>Default payment method</Label><Select value={billingProfile.default_payment_method || "bank_transfer"} onValueChange={v => setBillingProfile({ ...billingProfile, default_payment_method: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="bank_transfer">Bank transfer / EFT</SelectItem><SelectItem value="eftpos">EFTPOS terminal</SelectItem><SelectItem value="cash">Cash</SelectItem></SelectContent></Select></div><div><Label>Xero contact ID</Label><Input value={billingProfile.xero_contact_id || ""} onChange={e => setBillingProfile({ ...billingProfile, xero_contact_id: e.target.value })} placeholder="Optional, after Xero sync" /></div></div>
            <label className="flex items-start gap-3 rounded-lg border border-border/70 bg-muted/20 p-3 text-sm"><Switch checked={Boolean(billingProfile.purchase_order_required)} onCheckedChange={v => setBillingProfile({ ...billingProfile, purchase_order_required: v })} /><span><span className="block font-medium">Purchase order required</span><span className="text-xs text-muted-foreground">Keep a PO requirement visible before billing this client.</span></span></label>
          </div>
        </NexusWorkflowDialog>
      </Dialog>

      <Dialog open={settlementOpen} onOpenChange={setSettlementOpen}>
        <NexusWorkflowDialog eyebrow="Reconciliation workflow" title="Close payment settlement" description="Groups a day’s EFTPOS or cash records into an auditable settlement. It remains pending until matched in Xero." icon={Check} tone="emerald" className="max-w-md" footer={<><Button variant="outline" onClick={() => setSettlementOpen(false)}>Cancel</Button><Button onClick={closeSettlement}><Check className="mr-1 h-4 w-4" />Close settlement</Button></>}>
          <div className="space-y-3"><div><Label>Method</Label><Select value={settlementForm.method} onValueChange={v => setSettlementForm({ ...settlementForm, method: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="eftpos">EFTPOS terminal</SelectItem><SelectItem value="cash">Cash</SelectItem></SelectContent></Select></div><div><Label>Settlement date</Label><Input type="date" value={settlementForm.date} onChange={e => setSettlementForm({ ...settlementForm, date: e.target.value })} /></div><div><Label>Settlement / deposit reference</Label><Input value={settlementForm.reference} onChange={e => setSettlementForm({ ...settlementForm, reference: e.target.value })} placeholder="Terminal batch or bank deposit ID" /></div></div>
        </NexusWorkflowDialog>
      </Dialog>

      {/* MOVE CLIENT */}
      <Dialog open={moveDialog} onOpenChange={v => { setMoveDialog(v); if (!v) setMovingInvoice(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Move Invoice to Different Client</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {movingInvoice && <div className="p-3 rounded-lg bg-muted/30 border text-sm"><p className="font-mono font-medium">{movingInvoice.invoice_number}</p><p className="text-muted-foreground">Currently: {movingInvoice.client_name} | ${(movingInvoice.total || 0).toFixed(2)}</p></div>}
            {movingInvoice?.ticket_id && <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2 text-xs leading-relaxed text-amber-100">This invoice is linked to a service ticket. Unlink or relink the ticket first so the invoice cannot be moved to a different client while retaining an invalid ticket relationship.</div>}
            <div><Label>Move to Client *</Label>
              <ClientAutocomplete clients={clients} value={moveTarget} onValueChange={setMoveTarget} placeholder="Search for a new client…" testId="move-target-client" excludeClientId={movingInvoice?.client_id || ""} />
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
      <Dialog open={emailDialog} onOpenChange={(open) => { setEmailDialog(open); if (!open) setEmailInvoiceTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Mail className="w-5 h-5 text-blue-400" />Email {emailInvoiceTarget?.invoice_number || viewInvoice?.invoice_number || "Invoice"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Recipient Email</Label><Input value={emailForm.email} onChange={e => setEmailForm({ ...emailForm, email: e.target.value })} placeholder="client@example.com" data-testid="invoice-email-input" /></div>
            <div><Label>Subject</Label><Input value={emailForm.subject} onChange={e => setEmailForm({ ...emailForm, subject: e.target.value })} /></div>
            <div><Label>Message (optional)</Label><Textarea value={emailForm.message} onChange={e => setEmailForm({ ...emailForm, message: e.target.value })} rows={3} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailDialog(false)}>Cancel</Button>
            <Button variant="info" onClick={handleEmailInvoice} data-testid="send-invoice-email-btn"><Send className="w-4 h-4 mr-1" />Send</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DISPUTE-RISK REVIEW */}
      <Dialog open={Boolean(disputeScan)} onOpenChange={open => !open && setDisputeScan(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Shield className="w-5 h-5 text-rose-400" />Dispute-risk review</DialogTitle>
            <p className="text-sm text-muted-foreground">{disputeScan?.invoice_number} · Review these items before sending or chasing payment.</p>
          </DialogHeader>
          <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
            {disputeScan?.summary && <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">{disputeScan.summary}</div>}
            {(!disputeScan?.flags?.length && !disputeScan?.ai_risks?.length) && <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300">No risks were found in this invoice.</div>}
            {disputeScan?.flags?.map((flag, index) => (
              <div key={`flag-${index}`} className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <div className="mb-1 flex items-center gap-2"><Badge variant="outline" className="border-amber-500/40 text-amber-300">{flag.severity || "Review"}</Badge><span className="font-medium text-sm">{flag.line || "Invoice check"}</span></div>
                <p className="text-sm text-muted-foreground">{flag.risk}</p>
              </div>
            ))}
            {disputeScan?.ai_risks?.map((risk, index) => (
              <div key={`ai-${index}`} className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
                <div className="mb-1 flex items-center gap-2"><Badge variant="outline" className="border-rose-500/40 text-rose-300">AI · {risk.severity || "Review"}</Badge><span className="font-medium text-sm">{risk.line || "Invoice check"}</span></div>
                <p className="text-sm text-muted-foreground">{risk.reason}</p>
                {risk.justification && <p className="mt-2 border-l-2 border-rose-500/40 pl-3 text-xs text-muted-foreground">Suggested response: {risk.justification}</p>}
              </div>
            ))}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setDisputeScan(null)}>Close review</Button></DialogFooter>
        </DialogContent>
      </Dialog>

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
            <Button variant="warning" onClick={handleCreateCreditNote} data-testid="create-credit-note-btn"><Receipt className="w-4 h-4 mr-1" />Issue Credit Note</Button>
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
            <Button variant="success" onClick={handleSendInvoiceSms} disabled={smsSending} data-testid="send-invoice-sms-btn">
              {smsSending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Send className="w-4 h-4 mr-1" />}Send SMS
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(bulkConfirmAction)} onOpenChange={open => !open && setBulkConfirmAction(null)}>
        <NexusWorkflowDialog
          eyebrow="Billing record control"
          title={bulkConfirmAction === "delete" ? "Delete selected invoices" : "Void selected invoices"}
          description={bulkConfirmAction === "delete"
            ? `Delete ${selectedIds.size} selected invoice${selectedIds.size === 1 ? "" : "s"}? This cannot be undone.`
            : `Void ${selectedIds.size} selected invoice${selectedIds.size === 1 ? "" : "s"}?`}
          icon={bulkConfirmAction === "delete" ? Trash2 : Ban}
          tone="amber"
          testId="invoice-bulk-confirm-dialog"
          footer={<><Button variant="outline" onClick={() => setBulkConfirmAction(null)} disabled={bulkBusy}>Cancel</Button><Button variant="destructive" onClick={() => handleBulkAction(bulkConfirmAction, true)} disabled={bulkBusy}>{bulkBusy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{bulkConfirmAction === "delete" ? "Delete invoices" : "Void invoices"}</Button></>}
        >
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.045] p-3 text-sm text-muted-foreground">
            {bulkConfirmAction === "delete" ? "Deleted invoices can no longer be recovered from Nexus. Confirm only after any required financial correction has been made." : "Voiding preserves the billing record and audit history while preventing further collection or reconciliation activity."}
          </div>
        </NexusWorkflowDialog>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={open => !open && setDeleteTarget(null)}>
        <NexusWorkflowDialog
          eyebrow="Billing record control"
          title={`Delete ${deleteTarget?.invoice_number || "draft invoice"}?`}
          description="This permanently removes the unpaid draft invoice. Sent, paid, and voided invoices remain as financial history."
          icon={Trash2}
          tone="amber"
          testId="invoice-delete-dialog"
          footer={<><Button variant="outline" onClick={() => setDeleteTarget(null)}>Keep invoice</Button><HoldToConfirmButton onComplete={() => deleteTarget && handleDelete(deleteTarget.id)} data-testid="confirm-delete-invoice">Hold to delete draft</HoldToConfirmButton></>}
        >
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.045] p-3 text-sm text-muted-foreground">Nexus keeps sent, paid, and voided invoices as financial history. This option is deliberately limited to removable drafts.</div>
        </NexusWorkflowDialog>
      </Dialog>
    </>
  );
  if (viewInvoice) {
    const inv = viewInvoice;
    const isSplitParent = Boolean(inv.is_split_parent);
    const pStatus = isSplitParent ? "split" : (inv.payment_status || "unpaid");
    const canDelete = pStatus === "unpaid" && ["draft", "pending_approval"].includes(inv.status);
    const canEditFinancialRecord = pStatus === "unpaid" && ["draft", "pending_approval"].includes(inv.status) && !isSplitParent;
    const canVoid = pStatus === "unpaid" && !["cancelled", "voided"].includes(inv.status);
    const PayIcon = PAYMENT_STATUS[pStatus]?.icon || XCircle;
    const balance = isSplitParent ? 0 : (inv.total || 0) - (inv.amount_paid || 0);
    const isOverdue = !isSplitParent && inv.due_date && isPast(parseISO(inv.due_date)) && pStatus !== "paid";

    return (
      <div className="space-y-4" data-testid="invoice-detail">
        <Card className="sticky top-0 z-30 overflow-hidden rounded-2xl border border-white/[0.09] bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_34%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.10),transparent_30%),linear-gradient(135deg,rgba(17,19,24,0.98),rgba(10,12,17,0.98))] shadow-[0_22px_65px_rgba(0,0,0,0.34)] backdrop-blur-xl" data-testid="invoice-console-header">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.17em] text-cyan-300/85"><span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" /></span>Live billing record <span className="text-zinc-600">/</span><span className="text-zinc-400">Finance operations</span></div>
            <div className="flex flex-wrap items-center gap-2.5">
              <Button variant="ghost" size="sm" className="h-9 w-9 rounded-lg p-0 text-zinc-400 hover:bg-white/[0.06] hover:text-white" onClick={() => { setViewInvoice(null); setDetailTab("items"); }} data-testid="back-to-invoices" aria-label="Back to invoices" title="Back to invoices"><ArrowLeft className="h-4 w-4" /></Button>
              <Badge className="h-6 border-white/[0.10] bg-black/30 px-2.5 font-mono text-[10px] tracking-wide text-zinc-200">{inv.invoice_number}</Badge>
              <Badge className={PAYMENT_STATUS[pStatus]?.class}><PayIcon className="mr-1 h-3 w-3" />{PAYMENT_STATUS[pStatus]?.label}</Badge>
              <Badge className={STATUS_CONFIG[getEffectiveStatus(inv)]?.class}>{STATUS_CONFIG[getEffectiveStatus(inv)]?.label}</Badge>
              {isOverdue && <Badge className="animate-pulse border-red-500/30 bg-red-500/20 text-red-400"><AlertTriangle className="mr-1 h-3 w-3" />Overdue</Badge>}
              {inv.is_recurring && <Badge className="border-cyan-500/30 bg-cyan-500/10 text-cyan-200"><RefreshCw className="mr-1 h-3 w-3" />Recurring</Badge>}
              <div className="order-last basis-full min-w-0 pt-1 lg:order-none lg:ml-2 lg:basis-auto lg:flex-1">
                <p className="truncate text-xl font-semibold tracking-tight text-white">{inv.invoice_name || inv.client_name || "Client invoice"}</p>
                <p className="mt-1 text-xs text-zinc-400">{isSplitParent ? <><span>Source record retained for audit</span><span className="px-1.5 text-zinc-600">/</span><span className="text-violet-200">{(inv.split_billing?.allocations || []).length} payer invoice{(inv.split_billing?.allocations || []).length === 1 ? "" : "s"} issued</span></> : <>{inv.invoice_name && <><span>{inv.client_name || "Client invoice"}</span><span className="px-1.5 text-zinc-600">/</span></>}Due {inv.due_date ? format(parseISO(inv.due_date), "MMM d, yyyy") : "date not set"} <span className="px-1.5 text-zinc-600">/</span> Balance <span className={balance > 0 ? "font-mono text-amber-200" : "font-mono text-emerald-200"}>${Math.max(0, balance).toFixed(2)}</span></>}</p>
              </div>
              {balance > 0 && <Button variant="success" className="h-9 rounded-lg px-3" onClick={() => openPaymentDialog(inv)} data-testid="header-record-payment-btn"><Banknote className="mr-1.5 h-3.5 w-3.5" />Record payment</Button>}
              {!isSplitParent && <Button variant="info" size="sm" className="h-9 rounded-lg px-3" onClick={() => openInvoiceEmail(inv)} data-testid="header-email-invoice-btn"><Mail className="mr-1.5 h-3.5 w-3.5" />Email</Button>}
              <Button variant="outline" size="sm" className="h-9 rounded-lg border-white/[0.12] bg-black/10 px-3 text-zinc-100 hover:border-white/[0.20] hover:bg-white/[0.08]" onClick={() => handlePdfPreview(inv)} data-testid="header-preview-invoice-btn"><Eye className="mr-1.5 h-3.5 w-3.5" />Preview</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.08] pt-3">
              <span className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.10] px-2.5 py-1 text-xs font-medium text-emerald-100">{inv.client_name || "No customer"}</span>
              {inv.ticket_id && <Link to={`/tickets?ticket=${encodeURIComponent(inv.ticket_id)}`} className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/25 bg-cyan-400/[0.08] px-2.5 py-1 text-xs font-medium text-cyan-100 transition hover:border-cyan-300/45 hover:bg-cyan-400/[0.14]" data-testid="invoice-linked-ticket"><Ticket className="h-3 w-3" />{inv.ticket_number || "Linked ticket"}</Link>}
              {isSplitParent && <span className="inline-flex items-center gap-1.5 rounded-lg border border-violet-400/25 bg-violet-500/[0.08] px-2.5 py-1 text-xs font-medium text-violet-100"><Users className="h-3 w-3" />Split-billing ledger</span>}
              {inv.is_split_child && <span className="inline-flex items-center gap-1.5 rounded-lg border border-violet-400/25 bg-violet-500/[0.08] px-2.5 py-1 text-xs font-medium text-violet-100"><Users className="h-3 w-3" />Split payer invoice</span>}
              <span className="rounded-lg bg-white/[0.05] px-2.5 py-1 font-mono text-[10px] text-zinc-400">Total ${(inv.total || 0).toFixed(2)}</span>
              <span className="rounded-lg bg-white/[0.05] px-2.5 py-1 font-mono text-[10px] text-zinc-400">Paid ${(inv.amount_paid || 0).toFixed(2)}</span>
              <div className="ml-auto flex flex-wrap gap-2"><InvoiceAIBundle invoiceId={inv.id} /><InvoiceExplainerButton invoiceId={inv.id} invoiceNumber={inv.invoice_number} />{balance > 0 && <PaymentPromiseButton invoiceId={inv.id} />}</div>
            </div>
          </CardContent>
        </Card>

        {/* Payment Progress Bar */}
        {balance > 0 && (
          <Card className="overflow-hidden border border-cyan-400/[0.14] bg-[linear-gradient(135deg,rgba(34,211,238,0.06),rgba(16,185,129,0.04))]">
            <CardContent className="py-3 px-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Payment Progress</span>
                <span className="text-xs font-mono">${(inv.amount_paid || 0).toFixed(2)} / ${(inv.total || 0).toFixed(2)}</span>
              </div>
              <Progress value={inv.total > 0 ? ((inv.amount_paid || 0) / inv.total * 100) : 0} className="h-2" />
            </CardContent>
          </Card>
        )}

        {/* Smart Actions (AI Reminder, Payment Plan, Late Fee, Pay-Now Link, Reissue) */}
        <Card className="border border-emerald-500/20 bg-[linear-gradient(135deg,rgba(16,185,129,0.09),rgba(34,211,238,0.05))]">
          <CardContent className="p-3">
            <InvoiceDetailSmartActions invoice={inv} onReload={async () => {
              const updated = await axios.get(`${API}/invoices/${inv.id}`, { headers });
              setViewInvoice(updated.data);
              fetchAll();
            }} />
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <div className="space-y-4 xl:col-span-8">
            <Tabs value={detailTab} onValueChange={setDetailTab}>
              <TabsList className="h-auto w-full justify-start gap-0 overflow-x-auto rounded-xl border border-white/[0.08] bg-black/[0.14] p-1">
                <TabsTrigger value="items" className="h-9 shrink-0 rounded-lg px-3 text-xs data-[state=active]:bg-cyan-500/[0.14] data-[state=active]:text-cyan-100" data-testid="tab-inv-items">Line Items</TabsTrigger>
                <TabsTrigger value="payments" className="h-9 shrink-0 rounded-lg px-3 text-xs data-[state=active]:bg-cyan-500/[0.14] data-[state=active]:text-cyan-100" data-testid="tab-inv-payments">Payments ({(inv.payments || []).length})</TabsTrigger>
                {isSplitParent && <TabsTrigger value="split" className="h-9 shrink-0 rounded-lg px-3 text-xs data-[state=active]:bg-violet-500/[0.14] data-[state=active]:text-violet-100" data-testid="tab-inv-split-billing">Payer invoices ({(inv.split_billing?.allocations || []).length})</TabsTrigger>}
                <TabsTrigger value="emails" className="h-9 shrink-0 rounded-lg px-3 text-xs data-[state=active]:bg-cyan-500/[0.14] data-[state=active]:text-cyan-100" data-testid="tab-inv-emails">Emails ({emailHistory.length})</TabsTrigger>
                <TabsTrigger value="audit" className="h-9 shrink-0 rounded-lg px-3 text-xs data-[state=active]:bg-cyan-500/[0.14] data-[state=active]:text-cyan-100" data-testid="tab-inv-audit">Audit ({invoiceActivity.length})</TabsTrigger>
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
                        <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Method</TableHead><TableHead>Reference</TableHead><TableHead>Reconciliation</TableHead><TableHead>Notes</TableHead><TableHead>Recorded By</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {(inv.payments || []).map((p, i) => (
                            <TableRow key={`k-${i}`}>
                              <TableCell className="text-sm">{p.date ? (String(p.date).length === 10 ? format(parseISO(p.date), "MMM d, yyyy") : format(new Date(p.date), "MMM d, yyyy h:mm a")) : "-"}</TableCell>
                              <TableCell><Badge variant="outline" className="capitalize text-xs">{(p.method || "").replace(/_/g, " ")}</Badge></TableCell>
                              <TableCell className="text-sm font-mono">{p.reference || p.session_id?.slice(0, 12) || "-"}</TableCell>
                              <TableCell><Badge variant="outline" className={`text-[10px] ${p.reconciliation_status === "matched" ? "border-emerald-500/30 text-emerald-400" : p.reconciliation_status === "settled_pending_xero" ? "border-sky-500/30 text-sky-300" : "border-amber-500/30 text-amber-300"}`}>{p.reconciliation_status === "matched" ? "Matched in Xero" : p.reconciliation_status === "settled_pending_xero" ? "Settlement queued" : "Awaiting Xero"}</Badge></TableCell>
                              <TableCell className="max-w-48 truncate text-sm text-muted-foreground" title={p.notes || ""}>{p.notes || "-"}</TableCell>
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

              {isSplitParent && (
                <TabsContent value="split">
                  <Card className="mt-2 overflow-hidden border-violet-400/20 bg-[linear-gradient(135deg,rgba(139,92,246,0.08),rgba(34,211,238,0.035))]">
                    <CardHeader className="border-b border-violet-400/15 pb-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <CardTitle className="flex items-center gap-2 text-sm text-violet-100"><Users className="h-4 w-4 text-violet-300" />Split-billing payer ledger</CardTitle>
                          <p className="mt-1 text-xs text-muted-foreground">This source record is retained for audit only. Payments and customer-facing documents live on the payer invoices below.</p>
                        </div>
                        <Badge variant="outline" className="border-violet-400/30 bg-violet-500/10 text-violet-100">Allocated ${(inv.split_billing?.source_total || inv.total || 0).toFixed(2)}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 p-4">
                      {(inv.split_billing?.allocations || []).map((allocation) => {
                        const allocationPaid = Number(allocation.amount_paid || 0);
                        const allocationAmount = Number(allocation.amount || 0);
                        const allocationBalance = Math.max(0, allocationAmount - allocationPaid);
                        const isAllocationPaid = allocation.payment_status === "paid" || allocationBalance <= 0;
                        return (
                          <div key={allocation.id || allocation.invoice_id} className="rounded-xl border border-white/[0.09] bg-black/[0.16] p-3.5" data-testid={`split-allocation-${allocation.invoice_id}`}>
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2"><p className="font-medium text-zinc-100">{allocation.payer_client_name || "Customer payer"}</p><Badge variant="outline" className={isAllocationPaid ? "border-emerald-500/35 text-emerald-300" : "border-amber-500/35 text-amber-200"}>{isAllocationPaid ? "Paid" : "Awaiting payment"}</Badge></div>
                                <p className="mt-1 text-xs text-muted-foreground">{allocation.invoice_number || "Payer invoice"}{allocation.description ? ` · ${allocation.description}` : ""}</p>
                              </div>
                              <div className="grid grid-cols-3 gap-4 text-right text-xs">
                                <div><p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Allocated</p><p className="mt-1 font-mono text-sm font-semibold text-zinc-100">${allocationAmount.toFixed(2)}</p></div>
                                <div><p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Paid</p><p className="mt-1 font-mono text-sm font-semibold text-emerald-300">${allocationPaid.toFixed(2)}</p></div>
                                <div><p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Outstanding</p><p className={`mt-1 font-mono text-sm font-semibold ${allocationBalance > 0 ? "text-amber-200" : "text-emerald-300"}`}>${allocationBalance.toFixed(2)}</p></div>
                              </div>
                              <div className="flex shrink-0 gap-2">
                                <Button variant="outline" size="sm" className="border-violet-400/25 text-violet-100 hover:bg-violet-500/10" onClick={() => openSplitPayerInvoice(allocation.invoice_id)} data-testid={`open-split-invoice-${allocation.invoice_id}`}><Eye className="mr-1.5 h-3.5 w-3.5" />Open</Button>
                                <Button variant="outline" size="sm" className="border-cyan-400/25 text-cyan-100 hover:bg-cyan-400/[0.08]" onClick={async () => { try { const response = await axios.get(`${API}/invoices/${allocation.invoice_id}`, { headers }); openInvoiceEmail(response.data); } catch { toast.error("Could not prepare the payer invoice email"); } }} data-testid={`email-split-invoice-${allocation.invoice_id}`}><Mail className="mr-1.5 h-3.5 w-3.5" />Email</Button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                </TabsContent>
              )}

              <TabsContent value="emails">
                <Card className="mt-2">
                  <CardContent className="p-0">
                    {emailHistory.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground text-sm">No delivery attempts yet</div>
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
                              <TableCell>
                                {em.delivery_status === "failed" ? <Badge className="bg-rose-500/20 text-rose-400 text-xs">Failed</Badge>
                                  : em.delivery_status === "mocked" ? <Badge className="bg-amber-500/20 text-amber-400 text-xs">Simulated</Badge>
                                  : em.sent ? <Badge className="bg-green-500/20 text-green-400 text-xs">Sent</Badge>
                                  : <Badge className="bg-muted text-muted-foreground text-xs">Queued</Badge>}
                              </TableCell>
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
                      <div className="text-center py-8 text-muted-foreground text-sm">{invoiceActivityError || "No audit entries"}</div>
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

          <div className="space-y-4 xl:col-span-4">
            <Card className="overflow-hidden border border-white/[0.08] bg-[linear-gradient(135deg,rgba(255,255,255,0.035),rgba(255,255,255,0.012))]">
              <CardHeader className="border-b border-white/[0.07] pb-3"><CardTitle className="flex items-center gap-2 text-sm text-zinc-100"><span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />Billing details</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div><span className="text-muted-foreground block">Client</span><span className="font-medium">{inv.client_name}</span></div>
                <Separator />
                <div><span className="text-muted-foreground block">Due Date</span><span className={`font-medium ${isOverdue ? "text-red-500" : ""}`}>{inv.due_date ? format(parseISO(inv.due_date), "MMM d, yyyy") : "N/A"}</span></div>
                <Separator />
                <div><span className="text-muted-foreground block">Created</span><span className="font-medium">{inv.created_at ? format(new Date(inv.created_at), "MMM d, yyyy") : "N/A"}</span></div>
                {inv.paid_date && <><Separator /><div><span className="text-muted-foreground block">Paid Date</span><span className="font-medium text-green-500">{format(parseISO(inv.paid_date), "MMM d, yyyy")}</span></div></>}
                {inv.last_emailed_to && <><Separator /><div><span className="text-muted-foreground block">Last email attempt</span><span className="font-medium text-blue-400">{inv.last_emailed_to}</span><span className="block text-xs text-muted-foreground">{inv.last_emailed_at ? format(new Date(inv.last_emailed_at), "MMM d, HH:mm") : ""}</span>{inv.last_email_delivery_status && <Badge variant="outline" className={`mt-1 text-[10px] ${inv.last_email_delivery_status === "sent" ? "border-emerald-500/40 text-emerald-400" : inv.last_email_delivery_status === "failed" ? "border-rose-500/40 text-rose-400" : "border-amber-500/40 text-amber-400"}`}>{inv.last_email_delivery_status}</Badge>}</div></>}
                {inv.late_fee_applied && <><Separator /><div><span className="text-muted-foreground block">Late Fees</span><span className="font-medium text-amber-400">${(inv.total_late_fees || 0).toFixed(2)}</span></div></>}
                {pStatus !== "paid" && (
                  <>
                    <Separator />
                    <div>
                      <span className="text-muted-foreground block mb-1">Late-payment risk</span>
                      <LateRiskBadge invoiceId={inv.id} token={token} />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
            <Card className="overflow-hidden border border-white/[0.08] bg-[linear-gradient(135deg,rgba(255,255,255,0.035),rgba(255,255,255,0.012))]">
              <CardHeader className="border-b border-white/[0.07] pb-3"><CardTitle className="flex items-center gap-2 text-sm text-zinc-100"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Invoice controls</CardTitle></CardHeader>
              <CardContent className="space-y-2 [&>button]:h-9 [&>button]:justify-start [&>button]:rounded-lg">
                {!isSplitParent && pStatus !== "paid" && <Button variant="success" className="w-full" onClick={() => openPaymentDialog(inv)} data-testid="record-payment-btn"><Banknote className="mr-1.5 h-4 w-4" />Record payment</Button>}
                {!isSplitParent && !inv.is_split_child && pStatus === "unpaid" && ["draft", "pending_approval"].includes(inv.status) && <Button variant="outline" className="w-full border-violet-400/30 bg-violet-500/[0.07] text-violet-100 hover:border-violet-300/45 hover:bg-violet-500/[0.14]" onClick={() => openSplitBilling(inv)} data-testid="split-billing-btn"><Users className="mr-1.5 h-4 w-4" />Split billing across clients</Button>}
                {isSplitParent && <div className="rounded-lg border border-violet-400/25 bg-violet-500/[0.07] px-3 py-2 text-xs text-violet-100"><span className="font-medium">Payer invoices issued.</span> Open the Payer invoices tab to email each customer or record their payment.</div>}
                <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-xs text-muted-foreground"><span className="font-medium text-sky-300">Xero</span> {xeroStatus.connected ? `Connected to ${xeroStatus.org_name || "your organisation"}. Reconcile payments after they are recorded.` : xeroStatus.configured ? "Setup is incomplete. Finish Xero OAuth before relying on sync or reconciliation." : "Not connected. Configure Xero before relying on sync or reconciliation."}</div>
                <Button variant="info" className="w-full" onClick={() => navigate(xeroStatus.connected ? "/xero" : "/settings?tab=integrations")} data-testid="open-xero-btn"><Building2 className="mr-1.5 h-4 w-4" />{xeroStatus.connected ? "Open Xero hub" : xeroStatus.configured ? "Finish Xero setup" : "Configure Xero"}</Button>
                <Separator />
                <Button variant="outline" className="w-full border-white/[0.12] bg-black/10 text-zinc-100 hover:border-white/[0.20] hover:bg-white/[0.08]" onClick={() => handlePdfPreview(inv)} data-testid="preview-pdf-btn">
                  <Eye className="mr-1.5 h-4 w-4" />Preview PDF
                </Button>
                <Button variant="outline" className="w-full border-white/[0.12] bg-black/10 text-zinc-100 hover:border-white/[0.20] hover:bg-white/[0.08]" onClick={() => handlePdfDownload(inv)} data-testid="download-pdf-detail-btn">
                  <Download className="mr-1.5 h-4 w-4" />Download PDF
                </Button>
                <Button
                  variant="outline"
                  className="w-full text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
                  onClick={() => window.open(`${API}/invoices/${inv.id}/dispute-shield.pdf?token=${encodeURIComponent(token)}`, "_blank")}
                  data-testid={`dispute-shield-btn-${inv.id}`}
                >
                  <Shield className="w-4 h-4 mr-1" />Dispute Shield
                </Button>
                <Button
                  variant="outline"
                  className="w-full text-rose-400 border-rose-500/30 hover:bg-rose-500/10"
                  onClick={async () => {
                    try {
                      const r = await axios.post(`${API}/invoices/${inv.id}/dispute-scan`, {}, { headers: { Authorization: `Bearer ${token}` } });
                      const total = (r.data.flags || []).length + (r.data.ai_risks || []).length;
                      toast.success(`Scanned · ${total} risk(s) found`);
                      setDisputeScan({
                        invoice_number: inv.invoice_number,
                        flags: r.data.flags || [],
                        ai_risks: r.data.ai_risks || [],
                        summary: r.data.ai_summary || "",
                      });
                    } catch (e) {
                      toast.error(e.response?.data?.detail || e.message);
                    }
                  }}
                  data-testid={`dispute-scan-btn-${inv.id}`}
                >
                  <Zap className="w-4 h-4 mr-1" />Pre-scan Risks (AI)
                </Button>
                {!isSplitParent && <Button variant="outline" className="w-full text-sky-400 border-sky-500/30 hover:bg-sky-500/10" onClick={() => openInvoiceEmail(inv)} data-testid="email-invoice-btn">
                  <Mail className="w-4 h-4 mr-1" />Email Invoice
                </Button>}
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
                {canEditFinancialRecord && <Button variant="outline" className="w-full" onClick={() => { setMovingInvoice(inv); setMoveTarget(""); setMoveDialog(true); }} data-testid="move-invoice-btn">
                  <ArrowRightLeft className="w-4 h-4 mr-1" />Move to Client
                </Button>}
                {canEditFinancialRecord && <Button variant="outline" className="w-full" onClick={() => openEdit(inv)} data-testid="edit-invoice-btn"><Edit className="w-4 h-4 mr-1" />Edit</Button>}
                {canVoid && (
                  <Button variant="outline" className="w-full text-amber-500 hover:text-amber-400" onClick={() => { setVoidingInvoice(inv); setVoidReason(""); setVoidDialog(true); }} data-testid="void-invoice-btn">
                    <Ban className="w-4 h-4 mr-1" />Void Invoice
                  </Button>
                )}
                {canDelete && <Button variant="destructive" className="w-full" onClick={() => setDeleteTarget(inv)} data-testid="delete-invoice-btn"><Trash2 className="w-4 h-4 mr-1" />Delete</Button>}
              </CardContent>
            </Card>
          </div>
        </div>
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
    <PageShell className="nx-page-stage" data-testid="invoices-page">
      <div className="flex-1 space-y-6 overflow-y-auto">
      <div className="nx-ambient-surface flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/[0.09] bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.14),transparent_36%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.10),transparent_30%),linear-gradient(135deg,rgba(17,19,24,0.98),rgba(10,12,17,0.98))] p-5 shadow-[0_16px_42px_rgba(0,0,0,0.18)]" data-nx-signal={(stats.unpaid || 0) > 0 || (stats.total_outstanding || 0) > 0 ? "attention" : "healthy"}>
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Finance operations</p>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/25 bg-emerald-500/10"><Receipt className="h-5 w-5 text-emerald-300" /></span>
            <div><h1 className="text-2xl font-bold tracking-tight">Invoices</h1><p className="text-sm text-muted-foreground">Billing command centre · {invoices.length} invoices</p></div>
          </div>
        </div>
        <div className="flex w-full flex-wrap gap-2 xl:w-auto xl:justify-end">
          <Button variant="outline" size="sm" className="h-9 rounded-lg border-white/[0.12] bg-black/10 text-zinc-100 hover:border-white/[0.20] hover:bg-white/[0.08]" onClick={() => navigate("/billing-dashboard")} data-testid="goto-billing-command"><Zap className="w-3.5 h-3.5 mr-1.5" />Billing Command</Button>
          <Button variant="info" size="sm" className="h-9 rounded-lg" onClick={() => navigate(xeroStatus.connected ? "/xero" : "/settings?tab=integrations")} data-testid="invoice-xero-button"><Building2 className="w-3.5 h-3.5 mr-1.5" />{xeroStatus.connected ? "Xero connected" : xeroStatus.configured ? "Finish Xero setup" : "Configure Xero"}</Button>
          <Button variant="outline" size="sm" className="h-9 rounded-lg border-white/[0.12] bg-black/10 text-zinc-100 hover:border-white/[0.20] hover:bg-white/[0.08]" onClick={() => navigate("/reports?tab=commercial")} data-testid="aging-report-btn">
            <Timer className="w-4 h-4 mr-1" />Receivables Report
          </Button>
          <Button variant="outline" size="sm" className="h-9 rounded-lg border-white/[0.12] bg-black/10 text-zinc-100 hover:border-white/[0.20] hover:bg-white/[0.08]" onClick={() => { setTopView("revenue"); setRevenueAnalytics(null); }} data-testid="revenue-analytics-btn">
            <BarChart3 className="w-4 h-4 mr-1" />Revenue Analytics
          </Button>
          <Button variant="success" className="h-9 rounded-lg px-3" onClick={openCreate} data-testid="create-invoice-btn"><Plus className="w-4 h-4 mr-1.5" />New Invoice</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <HeroTile label="All invoices" value={stats.total || 0} icon={FileText} glow="cyan" testId="stat-total" />
        <HeroTile label="Paid" value={stats.paid || 0} icon={CheckCircle} glow="emerald" testId="stat-paid" />
        <HeroTile label="Unpaid" value={stats.unpaid || 0} icon={XCircle} glow={stats.unpaid > 0 ? "rose" : "emerald"} testId="stat-unpaid" />
        <HeroTile label="Collected" value={`$${(stats.total_collected || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} icon={TrendingUp} glow="emerald" animated={false} testId="stat-collected" />
        <HeroTile label="Outstanding" value={`$${(stats.total_outstanding || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} icon={AlertTriangle} glow={stats.total_outstanding > 0 ? "amber" : "emerald"} animated={false} testId="stat-outstanding" />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <HeroTile label="Xero finance link" value={xeroStatus.connected ? "Connected" : xeroStatus.configured ? "Finish setup" : "Not connected"} subtitle={xeroStatus.connected ? (xeroStatus.org_name || "Open reconciliation hub") : "Configure OAuth before sync"} icon={Building2} glow="sky" animated={false} onClick={() => navigate(xeroStatus.connected ? "/xero" : "/settings?tab=integrations")} testId="xero-finance-tile" />
        <HeroTile label="Reconciliation queue" value={`$${Number(reconciliation.pending_total || 0).toFixed(2)}`} subtitle={`${reconciliation.pending_count} payment${reconciliation.pending_count === 1 ? "" : "s"} awaiting Xero match`} icon={Wallet} glow="amber" animated={false} onClick={() => reconciliation.pending_count ? setSettlementOpen(true) : toast.info("No payments are ready to settle")} testId="reconciliation-tile" />
        <HeroTile label="Client billing controls" value={clients.length} subtitle="Terms, PO and billing contact defaults" icon={Users} glow="emerald" onClick={() => openBillingProfile()} testId="billing-profile-tile" />
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

      {/* Bulk Actions Toolbar (visible when items selected) */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-cyan-500/10 border border-cyan-500/30" data-testid="bulk-toolbar">
          <CheckSquare className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-medium text-cyan-300">{selectedIds.size} selected</span>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())} className="h-7">Clear</Button>
          <div className="ml-auto flex items-center gap-1.5">
            <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => handleBulkAction("mark_sent")} data-testid="bulk-mark-sent" className="h-7"><Send className="w-3 h-3 mr-1" />Mark Sent</Button>
            <Button size="sm" variant="outline" disabled={bulkBusy} onClick={handleExportCsv} data-testid="bulk-export-csv" className="h-7"><FileSpreadsheet className="w-3 h-3 mr-1" />Export CSV</Button>
            <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => handleBulkAction("void")} className="h-7 border-amber-500/30 text-amber-300"><Ban className="w-3 h-3 mr-1" />Void</Button>
            <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => handleBulkAction("delete")} className="h-7 border-rose-500/30 text-rose-300"><Trash2 className="w-3 h-3 mr-1" />Delete</Button>
          </div>
        </div>
      )}

      {/* Invoice Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && filtered.every(inv => selectedIds.has(inv.id))}
                    onChange={e => {
                      if (e.target.checked) setSelectedIds(new Set(filtered.map(i => i.id)));
                      else setSelectedIds(new Set());
                    }}
                    data-testid="bulk-select-all"
                  />
                </TableHead>
                <TableHead>Invoice #</TableHead><TableHead>Client</TableHead><TableHead>Due Date</TableHead>
                <TableHead className="text-right">Total</TableHead><TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Balance</TableHead><TableHead>Payment</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={10} className="text-center py-12 text-muted-foreground">No invoices found</TableCell></TableRow>
              ) : filtered.map(inv => {
                const isSplitParent = Boolean(inv.is_split_parent);
                const pStatus = isSplitParent ? "split" : (inv.payment_status || "unpaid");
                const PayIcon = PAYMENT_STATUS[pStatus]?.icon || XCircle;
                const effectiveStatus = getEffectiveStatus(inv);
                const balance = isSplitParent ? 0 : (inv.total || 0) - (inv.amount_paid || 0);
                const isOverdue = !isSplitParent && inv.due_date && isPast(parseISO(inv.due_date)) && pStatus !== "paid";
                return (
                  <TableRow key={inv.id} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => viewInvoiceDetail(inv)} data-testid={`invoice-row-${inv.id}`}>
                    <TableCell onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(inv.id)}
                        onChange={e => {
                          const next = new Set(selectedIds);
                          if (e.target.checked) next.add(inv.id); else next.delete(inv.id);
                          setSelectedIds(next);
                        }}
                        data-testid={`select-${inv.id}`}
                      />
                    </TableCell>
                    <TableCell><p className="font-mono font-medium">{inv.invoice_number}</p>{inv.invoice_name && <p className="mt-0.5 max-w-[17rem] truncate text-xs text-muted-foreground" title={inv.invoice_name}>{inv.invoice_name}</p>}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">{inv.client_name}
                        {inv.is_recurring && <RefreshCw className="w-3 h-3 text-purple-500" />}
                        {isSplitParent && <Users className="h-3 w-3 text-violet-300" />}
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
                        {!isSplitParent && pStatus !== "paid" && <Button variant="ghost" size="sm" className="h-7 text-emerald-400 hover:text-emerald-300 text-xs px-2" onClick={() => openPaymentDialog(inv)} data-testid={`pay-btn-${inv.id}`}><Banknote className="w-3 h-3 mr-1" />Record</Button>}
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-blue-400" title="Preview PDF" onClick={() => handlePdfPreview(inv)} data-testid={`print-btn-${inv.id}`}><Printer className="w-3 h-3" /></Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-emerald-400" title="Download" onClick={() => handlePdfDownload(inv)} data-testid={`download-btn-${inv.id}`}><Download className="w-3 h-3" /></Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Clone" onClick={() => handleCloneInvoice(inv)}><Copy className="w-3 h-3" /></Button>
                        {pStatus === "unpaid" && ["draft", "pending_approval"].includes(inv.status) && <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" title="Delete draft" onClick={() => setDeleteTarget(inv)}><Trash2 className="w-3 h-3" /></Button>}
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
