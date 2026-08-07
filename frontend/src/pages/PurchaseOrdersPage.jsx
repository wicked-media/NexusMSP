import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { toast } from "sonner";
import {
  Plus, Search, Loader2, FileText, Edit, Trash2, DollarSign, CheckCircle, Clock, ArrowLeft, Send, XCircle, Eye, ShoppingCart,
  AlertTriangle, Scan, PackageCheck, Box,
  BellRing, Mail, Download, Copy, ThumbsUp, ThumbsDown, MessageSquare,
  BarChart3, TrendingUp, Save, Layers, Check, ChevronsUpDown,
  MoreHorizontal, ChevronDown, Building2, Paperclip, RotateCcw, Settings2
} from "lucide-react";
import { format } from "date-fns";
import { PdfViewerDialog } from "@/components/PdfViewerDialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import HeroTile from "@/components/HeroTile";
import OperationalPageHeader from "@/components/OperationalPageHeader";
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

function SearchableSelect({
  options,
  value,
  onValueChange,
  placeholder = "Choose an option…",
  searchPlaceholder = "Type to search…",
  emptyMessage = "No matching options found.",
  testId,
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

export default function PurchaseOrdersPage() {
  const { token, user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [pos, setPos] = useState([]);
  const [products, setProducts] = useState([]);
  const [clients, setClients] = useState([]);
  const [tickets, setTickets] = useState([]);
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
  const [receiptMeta, setReceiptMeta] = useState({ packing_slip_number: "", evidence_reference: "" });
  const [returnDialog, setReturnDialog] = useState(false);
  const [returnItems, setReturnItems] = useState([]);
  const [returnForm, setReturnForm] = useState({ reason: "", rma_number: "", supplier_credit_number: "", notes: "" });
  const [approvalPolicyOpen, setApprovalPolicyOpen] = useState(false);
  const [approvalPolicy, setApprovalPolicy] = useState({ enabled: true, threshold: 1000, require_separation: true, require_assigned_approver_above_threshold: true, approver_roles: ["admin", "owner", "finance"] });
  const [scannerInput, setScannerInput] = useState("");
  const scanRef = useRef(null);
  const handledVendorPreset = useRef(false);
  const handledPODetailPreset = useRef(false);
  const [approvalDialog, setApprovalDialog] = useState(null);
  const [approvalNotes, setApprovalNotes] = useState("");
  const [approvalApprover, setApprovalApprover] = useState("");
  const [destructiveAction, setDestructiveAction] = useState(null);
  const [emailVendorDialog, setEmailVendorDialog] = useState(false);
  const [emailForm, setEmailForm] = useState({ email: "", subject: "", message: "" });
  const [spendAnalytics, setSpendAnalytics] = useState(null);
  const [analyticsTab, setAnalyticsTab] = useState("list");
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfViewer, setPdfViewer] = useState({ open: false, url: "", title: "", downloadUrl: "" });
  const [vendorInvoiceDialog, setVendorInvoiceDialog] = useState(false);
  const [vendorInvoiceForm, setVendorInvoiceForm] = useState({ invoice_number: "", invoice_date: "", supplier_total: "", notes: "" });
  const [vendorInvoiceReviewDialog, setVendorInvoiceReviewDialog] = useState(false);
  const [vendorInvoiceReview, setVendorInvoiceReview] = useState({ decision: "accepted", notes: "" });
  const [form, setForm] = useState({
    vendor: "", vendor_id: "", vendor_contact: "", vendor_email: "", status: "draft",
    line_items: [], notes: "", ship_to: "", expected_delivery: "",
    client_id: "", client_name: "", ticket_id: "", ticket_number: "", ticket_title: "", shipping: "0", assigned_to: "", assigned_to_name: ""
  });

  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [poResult, productResult, clientResult, statsResult, vendorResult, userResult, ticketResult, policyResult] = await Promise.allSettled([
        axios.get(`${API}/purchase-orders`, { headers }),
        axios.get(`${API}/products`, { headers }),
        axios.get(`${API}/clients`, { headers }),
        axios.get(`${API}/purchase-orders/stats`, { headers }),
        axios.get(`${API}/vendors`, { headers }),
        axios.get(`${API}/users`, { headers }),
        axios.get(`${API}/tickets`, { headers }),
        axios.get(`${API}/settings/po-approval`, { headers }),
      ]);
      if (poResult.status !== "fulfilled") throw poResult.reason;
      setPos(poResult.value.data || []);
      setProducts(productResult.status === "fulfilled" ? productResult.value.data : []);
      setClients(clientResult.status === "fulfilled" ? clientResult.value.data : []);
      setStats(statsResult.status === "fulfilled" ? statsResult.value.data : {});
      setVendors(vendorResult.status === "fulfilled" ? vendorResult.value.data : []);
      setUsers(userResult.status === "fulfilled" ? userResult.value.data : []);
      setTickets(ticketResult.status === "fulfilled" ? ticketResult.value.data : []);
      if (policyResult.status === "fulfilled") setApprovalPolicy(policyResult.value.data);
      if ([productResult, clientResult, vendorResult, userResult, ticketResult].some(result => result.status === "rejected")) {
        toast.warning("Purchase orders loaded, but one optional lookup is temporarily unavailable");
      }
    } catch { toast.error("Failed to load purchase orders"); }
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
    client_id: "", client_name: "", ticket_id: "", ticket_number: "", ticket_title: "", shipping: "0", assigned_to: "", assigned_to_name: ""
  });

  const openCreate = (vendorPreset) => {
    setEditing(null);
    if (vendorPreset) {
      setForm({ ...resetFormObj(), vendor: vendorPreset.name, vendor_id: vendorPreset.id, vendor_contact: vendorPreset.contact_name || "", vendor_email: vendorPreset.email || "" });
    } else { resetForm(); }
    setIsFormOpen(true);
  };

  useEffect(() => {
    const poId = searchParams.get("po");
    if (!poId || handledPODetailPreset.current) return;
    handledPODetailPreset.current = true;
    fetchPODetail(poId);
    setSearchParams({});
  }, [searchParams, setSearchParams]); // handles deep links from billing reconciliation

  useEffect(() => {
    const vendorId = searchParams.get("vendor");
    if (!vendorId || handledVendorPreset.current || vendors.length === 0) return;
    const vendor = vendors.find(v => v.id === vendorId);
    handledVendorPreset.current = true;
    if (!vendor) {
      toast.error("That vendor could not be found");
      setSearchParams({});
      return;
    }
    openCreate(vendor);
    setSearchParams({});
  }, [vendors, searchParams, setSearchParams]); // handles the explicit Vendor → Create PO hand-off once

  const resetFormObj = () => ({
    vendor: "", vendor_id: "", vendor_contact: "", vendor_email: "", status: "draft",
    line_items: [], notes: "", ship_to: "", expected_delivery: "",
    client_id: "", client_name: "", ticket_id: "", ticket_number: "", ticket_title: "",
    shipping: "0", assigned_to: "", assigned_to_name: ""
  });

  const openEdit = (po) => {
    setEditing(po);
    setForm({
      vendor: po.vendor, vendor_id: po.vendor_id || "", vendor_contact: po.vendor_contact || "",
      vendor_email: po.vendor_email || "", status: po.status,
      line_items: po.line_items || [], notes: po.notes || "",
      ship_to: po.ship_to || "", expected_delivery: po.expected_delivery || "",
      client_id: po.client_id || "", client_name: po.client_name || "",
      ticket_id: po.ticket_id || "", ticket_number: po.ticket_number || "", ticket_title: po.ticket_title || "",
      shipping: String(po.shipping || 0),
      assigned_to: po.assigned_to || "", assigned_to_name: po.assigned_to_name || "",
    });
    setIsFormOpen(true);
  };

  const addLineItem = () => setForm(f => {
    const relatedTicket = tickets.find(ticket => ticket.id === f.ticket_id);
    const hasRelatedTicket = Boolean(f.ticket_id);
    return {
      ...f,
      line_items: [...f.line_items, {
        product_id: "", product_name: "", quantity: 1, unit_price: 0, received_qty: 0, status: "pending",
        destination_type: hasRelatedTicket ? "ticket" : "stock",
        destination_ticket_id: hasRelatedTicket ? f.ticket_id : "",
        destination_ticket_number: hasRelatedTicket ? f.ticket_number : "",
        destination_ticket_title: hasRelatedTicket ? f.ticket_title : "",
        destination_technician_id: hasRelatedTicket ? (relatedTicket?.assigned_to || "") : "",
        destination_technician_name: hasRelatedTicket ? (relatedTicket?.assigned_name || "") : "",
        arrival_notified: false,
      }],
    };
  });

  const updateLineItem = (idx, field, value) => {
    setForm(f => {
      const items = [...f.line_items];
      items[idx] = { ...items[idx], [field]: value };
      if (field === "product_id") {
        const prod = products.find(p => p.id === value);
        if (prod) { items[idx].product_name = prod.name; items[idx].unit_price = prod.cost_price; }
      }
      if (field === "destination_type" && value === "stock") {
        Object.assign(items[idx], {
          destination_ticket_id: "", destination_ticket_number: "", destination_ticket_title: "",
          destination_technician_id: "", destination_technician_name: "",
        });
      }
      if (field === "destination_ticket_id") {
        const ticket = tickets.find(t => t.id === value);
        Object.assign(items[idx], {
          destination_ticket_id: value,
          destination_ticket_number: ticket?.ticket_number || "",
          destination_ticket_title: ticket?.title || "",
          destination_technician_id: ticket?.assigned_to || "",
          destination_technician_name: ticket?.assigned_name || "",
        });
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
    if (form.line_items.length === 0) { toast.error("Add at least one line item before saving"); return; }
    if (form.line_items.some(item => !item.product_name?.trim() || Number(item.quantity) < 1)) {
      toast.error("Each line needs an item name and a quantity of at least one"); return;
    }
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
    setApprovalApprover("");
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
      const approver = users.find(user => user.id === approvalApprover);
      await axios.post(`${API}/purchase-orders/${viewPO.id}/submit-for-approval`, {
        approver_id: approver?.id || "", approver_name: approver?.name || ""
      }, { headers });
      toast.success(approver ? `Sent to ${approver.name} for approval` : "Submitted for approval");
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
  const handlePreviewPdf = (po) => {
    setPdfViewer({
      open: true,
      url: `${API}/purchase-orders/${po.id}/pdf/preview?token=${encodeURIComponent(token)}`,
      title: `PO ${po.po_number}`,
      downloadUrl: `${API}/purchase-orders/${po.id}/pdf/preview?token=${encodeURIComponent(token)}&download=true`,
    });
  };

  // --- Email Vendor ---
  const handleEmailVendor = async () => {
    if (!emailForm.email.trim()) { toast.error("Enter a vendor email address"); return; }
    try {
      await axios.post(
        `${API}/purchase-orders/${viewPO.id}/email-vendor`,
        { ...emailForm, idempotency_key: crypto.randomUUID() },
        { headers },
      );
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
    const items = (po.line_items || []).map((li, line_index) => ({ ...li, line_index })).filter(li => (li.received_qty || 0) < li.quantity);
    setReceiveItems(items.map(li => ({ ...li, receive_now: 0, serial_numbers_text: "", batch_number: "" })));
    setReceiptMeta({ packing_slip_number: "", evidence_reference: "" });
    setReceiveDialog(true);
  };

  const handleReceiveStock = async () => {
    if (!viewPO) return;
    const items = receiveItems.filter(ri => ri.receive_now > 0).map(ri => ({
      line_index: ri.line_index,
      product_id: ri.product_id,
      product_name: ri.product_name,
      quantity: ri.receive_now,
      batch_number: ri.batch_number || "",
      serial_numbers: String(ri.serial_numbers_text || "").split(/\r?\n|,/).map(value => value.trim()).filter(Boolean),
    }));
    if (items.length === 0) { toast.error("No items to receive"); return; }
    try {
      const res = await axios.post(
        `${API}/purchase-orders/${viewPO.id}/receive`,
        { items, ...receiptMeta, idempotency_key: crypto.randomUUID() },
        { headers },
      );
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
      const hasOpenLine = receiveItems.some(ri => ri.product_id === prod.id && ri.receive_now < (ri.quantity - (ri.received_qty || 0)));
      if (!hasOpenLine) {
        toast.error(`No remaining ${prod.name} lines to receive`);
        setScannerInput("");
        return;
      }
      setReceiveItems(prev => {
        // Receive a single matching line at a time. The same product can be
        // ordered for two tickets, so incrementing every match would assign a
        // scan to the wrong technician-owned line.
        const targetIndex = prev.findIndex(ri => ri.product_id === prod.id && ri.receive_now < (ri.quantity - (ri.received_qty || 0)));
        if (targetIndex < 0) return prev;
        return prev.map((ri, index) => index === targetIndex
          ? { ...ri, receive_now: Math.min(ri.receive_now + 1, ri.quantity - (ri.received_qty || 0)) }
          : ri
        );
      });
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

  const isDeliveryOverdue = (po) => Boolean(po.expected_delivery && new Date(po.expected_delivery) < new Date() && !["received", "cancelled"].includes(po.status));
  const requiresSupplierInvoice = (po) => ["submitted", "partial", "received"].includes(po.status);
  const hasActiveSupplierVariance = (po) => po.vendor_invoice_match?.status === "variance" && po.vendor_invoice_match?.review?.status !== "accepted";
  const filtered = pos
    .filter(p => statusFilter === "all" ||
      (statusFilter === "overdue" ? isDeliveryOverdue(p) :
        statusFilter === "invoice_variance" ? hasActiveSupplierVariance(p) :
          statusFilter === "invoice_unmatched" ? requiresSupplierInvoice(p) && !p.vendor_invoice_match : p.status === statusFilter))
    .filter(p => !search || p.po_number?.toLowerCase().includes(search.toLowerCase()) || p.vendor?.toLowerCase().includes(search.toLowerCase()));
  const overdueCount = pos.filter(isDeliveryOverdue).length;
  const supplierInvoiceVarianceCount = pos.filter(hasActiveSupplierVariance).length;
  const hasFilters = search || statusFilter !== "all";
  const applyStatusFilter = (status) => setStatusFilter(status);
  const requestDestructiveAction = (type, po) => setDestructiveAction({ type, po });
  const confirmDestructiveAction = async () => {
    if (!destructiveAction) return;
    const { type, po } = destructiveAction;
    setDestructiveAction(null);
    if (type === "cancel") await handleStatusChange(po, "cancelled");
    if (type === "delete") await handleDelete(po.id);
  };

  const openReturnDialog = (po) => {
    const items = (po.line_items || [])
      .map((line, line_index) => ({ ...line, line_index, return_now: 0, serial_numbers_text: "" }))
      .filter(line => Number(line.received_qty || 0) > Number(line.returned_qty || 0));
    setReturnItems(items);
    setReturnForm({ reason: "", rma_number: "", supplier_credit_number: "", notes: "" });
    setReturnDialog(true);
  };

  const handleReturnStock = async () => {
    const items = returnItems.filter(item => Number(item.return_now) > 0).map(item => ({
      line_index: item.line_index,
      quantity: Number(item.return_now),
      serial_numbers: String(item.serial_numbers_text || "").split(/\r?\n|,/).map(value => value.trim()).filter(Boolean),
    }));
    if (!items.length) { toast.error("Choose at least one item to return"); return; }
    if (returnForm.reason.trim().length < 5) { toast.error("Add a clear return or RMA reason"); return; }
    try {
      const response = await axios.post(
        `${API}/purchase-orders/${viewPO.id}/returns`,
        { ...returnForm, items, idempotency_key: crypto.randomUUID() },
        { headers },
      );
      toast.success(response.data.message);
      setReturnDialog(false);
      fetchPODetail(viewPO.id); fetchData();
    } catch (error) { toast.error(error.response?.data?.detail || "Failed to record supplier return"); }
  };

  const handleUploadEvidence = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !viewPO) return;
    const payload = new FormData();
    payload.append("file", file);
    payload.append("category", "procurement");
    try {
      await axios.post(`${API}/purchase-orders/${viewPO.id}/attachments`, payload, { headers });
      toast.success("Evidence attached to the purchase order");
      fetchPODetail(viewPO.id);
    } catch (error) { toast.error(error.response?.data?.detail || "Could not attach evidence"); }
  };

  const handleQueueSupplierBill = async () => {
    try {
      const response = await axios.post(
        `${API}/purchase-orders/${viewPO.id}/supplier-bill/sync`,
        { idempotency_key: crypto.randomUUID() },
        { headers },
      );
      response.data.xero_connected ? toast.success("Supplier bill queued for Xero") : toast.warning("Supplier bill prepared; connect Xero to send it");
      fetchPODetail(viewPO.id); fetchData();
    } catch (error) { toast.error(error.response?.data?.detail || "Could not prepare the supplier bill"); }
  };

  const saveApprovalPolicy = async () => {
    try {
      const response = await axios.put(`${API}/settings/po-approval`, approvalPolicy, { headers });
      setApprovalPolicy(response.data);
      setApprovalPolicyOpen(false);
      toast.success("Procurement approval policy saved");
    } catch (error) { toast.error(error.response?.data?.detail || "Could not save procurement policy"); }
  };

  const openVendorInvoiceMatch = (po) => {
    const existing = po.vendor_invoice_match;
    setVendorInvoiceForm({
      invoice_number: existing?.invoice_number || "",
      invoice_date: existing?.invoice_date || new Date().toISOString().slice(0, 10),
      supplier_total: existing?.supplier_total?.toString() || po.total?.toString() || "0",
      notes: existing?.notes || "",
    });
    setVendorInvoiceDialog(true);
  };

  const handleVendorInvoiceMatch = async () => {
    if (!vendorInvoiceForm.invoice_number.trim()) { toast.error("Enter the supplier invoice number"); return; }
    if (vendorInvoiceForm.supplier_total === "" || Number.isNaN(Number(vendorInvoiceForm.supplier_total))) { toast.error("Enter a valid supplier invoice total"); return; }
    try {
      const res = await axios.post(`${API}/purchase-orders/${viewPO.id}/vendor-invoice-match`, {
        ...vendorInvoiceForm,
        supplier_total: Number(vendorInvoiceForm.supplier_total),
      }, { headers });
      toast.success(res.data.vendor_invoice_match.status === "matched" ? "Supplier invoice matched" : "Supplier invoice saved with a variance");
      setVendorInvoiceDialog(false);
      fetchPODetail(viewPO.id); fetchData();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to record supplier invoice"); }
  };

  const openVendorInvoiceReview = (po) => {
    const review = po.vendor_invoice_match?.review;
    setVendorInvoiceReview({ decision: review?.status || "accepted", notes: review?.notes || "" });
    setVendorInvoiceReviewDialog(true);
  };

  const handleVendorInvoiceReview = async () => {
    try {
      const res = await axios.post(`${API}/purchase-orders/${viewPO.id}/vendor-invoice-match/review`, vendorInvoiceReview, { headers });
      toast.success(res.data.vendor_invoice_match.review.status === "accepted" ? "Variance accepted and logged" : "Variance marked for supplier follow-up");
      setVendorInvoiceReviewDialog(false);
      fetchPODetail(viewPO.id); fetchData();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to save variance review"); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  // ========== FORM DIALOG ==========
  const formDialog = (
    <Dialog open={isFormOpen} onOpenChange={v => { setIsFormOpen(v); if (!v) setEditing(null); }}>
      <DialogContent className="flex max-h-[92vh] max-w-5xl flex-col overflow-hidden border-cyan-400/25 bg-[linear-gradient(145deg,rgba(9,22,30,0.98),rgba(13,15,21,0.98))] p-0">
        <DialogHeader className="shrink-0 border-b border-cyan-400/15 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.17),transparent_45%),linear-gradient(135deg,rgba(16,185,129,0.10),transparent)] px-6 py-5 pr-14">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Procurement workspace</p>
          <DialogTitle className="mt-1 flex items-center gap-2 text-2xl tracking-tight text-zinc-100"><span className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-400/25 bg-emerald-400/10"><ShoppingCart className="h-4 w-4 text-emerald-300" /></span>{editing ? `Edit ${editing.po_number}` : "Create purchase order"}</DialogTitle>
          <p className="mt-2 text-sm text-zinc-400">Link vendor, client, ticket and catalogue items in one auditable procurement record. Approvals, receiving, supplier invoices, and exceptions are retained in the PO history.</p>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5 pr-6">
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Vendor *</Label>
              <SearchableSelect
                testId="po-vendor-select"
                value={form.vendor_id || "__manual"}
                placeholder="Search a vendor…"
                searchPlaceholder="Search vendor name or email…"
                options={[
                  { value: "__manual", label: "Type vendor manually", detail: "Enter a supplier not yet in NexusMSP", searchText: "manual new supplier" },
                  ...vendors.map(vendor => ({ value: vendor.id, label: vendor.name || "Untitled vendor", detail: vendor.email || vendor.contact_name || "Vendor record", searchText: `${vendor.name || ""} ${vendor.email || ""} ${vendor.contact_name || ""}` })),
                ]}
                onValueChange={v => {
                  if (v === "__manual") { setForm(f => ({ ...f, vendor_id: "", vendor: "", vendor_contact: "", vendor_email: "" })); return; }
                  const vnd = vendors.find(x => x.id === v);
                  if (vnd) setForm(f => ({ ...f, vendor_id: v, vendor: vnd.name, vendor_contact: vnd.contact_name || "", vendor_email: vnd.email || "" }));
                }}
              />
              {!form.vendor_id && <Input className="mt-1" value={form.vendor} onChange={e => setForm({ ...form, vendor: e.target.value })} placeholder="Vendor name" data-testid="po-vendor" />}
            </div>
            <div><Label>Assigned Tech</Label>
              <SearchableSelect
                testId="po-assigned-tech"
                value={form.assigned_to || "none"}
                placeholder="Search technicians…"
                searchPlaceholder="Search technician name or email…"
                options={[
                  { value: "none", label: "Unassigned", detail: "No receiving technician notified", searchText: "none unassigned" },
                  ...users.map(user => ({ value: user.id, label: user.name || "Unnamed technician", detail: user.email || user.role || "Technician", searchText: `${user.name || ""} ${user.email || ""} ${user.role || ""}` })),
                ]}
                onValueChange={v => { const u = users.find(x => x.id === v); setForm(f => ({ ...f, assigned_to: v === "none" ? "" : v, assigned_to_name: u?.name || "" })); }}
              />
            </div>
            <div><Label>Expected Delivery</Label><Input type="date" value={form.expected_delivery} onChange={e => setForm({ ...form, expected_delivery: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Client (optional)</Label>
              <SearchableSelect
                testId="po-client-select"
                value={form.client_id || "none"}
                placeholder="Search a client…"
                searchPlaceholder="Search client name or email…"
                options={[
                  { value: "none", label: "No client", detail: "Keep this as stock or general procurement", searchText: "none stock procurement" },
                  ...clients.map(client => ({ value: client.id, label: client.name || "Unnamed client", detail: client.email || client.contact_name || "Client record", searchText: `${client.name || ""} ${client.email || ""} ${client.contact_name || ""}` })),
                ]}
                onValueChange={v => { const c = clients.find(cl => cl.id === v); setForm(current => ({ ...current, client_id: v === "none" ? "" : v, client_name: c?.name || "", ...(v !== "none" && current.ticket_id && tickets.find(ticket => ticket.id === current.ticket_id)?.client_id !== v ? { ticket_id: "", ticket_number: "", ticket_title: "" } : {}) })); }}
              />
            </div>
            <div><Label>Related Ticket</Label>
              <SearchableSelect
                testId="po-ticket-select"
                value={form.ticket_id || "none"}
                placeholder="Search a related ticket…"
                searchPlaceholder="Search ticket number or title…"
                emptyMessage="No tickets match the selected client."
                options={[
                  { value: "none", label: "No related ticket", detail: "Use for stock or general procurement", searchText: "none stock procurement" },
                  ...tickets
                    .filter(ticket => !form.client_id || ticket.client_id === form.client_id)
                    .map(ticket => ({ value: ticket.id, label: `${ticket.ticket_number || "Ticket"} — ${ticket.title || "Untitled"}`, detail: ticket.status ? `Status: ${ticket.status.replace(/_/g, " ")}` : "Service ticket", searchText: `${ticket.ticket_number || ""} ${ticket.title || ""}` })),
                ]}
                onValueChange={v => {
                  const ticket = tickets.find(t => t.id === v);
                  setForm(f => ({ ...f,
                    ticket_id: v === "none" ? "" : v,
                    ticket_number: ticket?.ticket_number || "",
                    ticket_title: ticket?.title || "",
                    client_id: v === "none" ? f.client_id : (ticket?.client_id || f.client_id),
                    client_name: v === "none" ? f.client_name : (ticket?.client_name || f.client_name),
                  }));
                }}
              />
            </div>
            <div><Label>Ship To</Label><Input value={form.ship_to} onChange={e => setForm({ ...form, ship_to: e.target.value })} placeholder="Shipping address" /></div>
          </div>
          <div><Label>Vendor Email</Label><Input value={form.vendor_email} onChange={e => setForm({ ...form, vendor_email: e.target.value })} /></div>
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
                  <div key={`k-${idx}`} className="grid grid-cols-12 gap-2 items-end p-3 rounded-xl border border-white/[0.08] bg-muted/20">
                    <div className="col-span-12 lg:col-span-3">
                      {idx === 0 && <Label className="text-xs">Product</Label>}
                      <SearchableSelect
                        testId={`po-line-product-${idx}`}
                        value={li.product_id || "__none"}
                        placeholder="Search catalogue…"
                        searchPlaceholder="Search product name or SKU…"
                        options={[
                          { value: "__none", label: "Custom item", detail: "Type the item manually", searchText: "manual custom" },
                          ...products.map(product => ({
                            value: product.id,
                            label: product.name || "Untitled product",
                            detail: `${product.sku || "No SKU"} · $${(product.cost_price ?? 0).toFixed(2)}`,
                            searchText: `${product.name || ""} ${product.sku || ""}`,
                          })),
                        ]}
                        onValueChange={value => updateLineItem(idx, "product_id", value === "__none" ? "" : value)}
                      />
                      {!li.product_id && <Input className="mt-1" value={li.product_name} onChange={e => updateLineItem(idx, "product_name", e.target.value)} placeholder="Item name" />}
                    </div>
                    <div className="col-span-6 lg:col-span-2">
                      {idx === 0 && <Label className="text-xs">Receive to</Label>}
                      <Select value={li.destination_type || "stock"} onValueChange={v => updateLineItem(idx, "destination_type", v)}>
                        <SelectTrigger data-testid={`po-line-destination-${idx}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="stock">Stock inventory</SelectItem>
                          <SelectItem value="ticket">Linked ticket</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-6 lg:col-span-3">
                      {idx === 0 && <Label className="text-xs">Ticket owner</Label>}
                      {li.destination_type === "ticket" ? (
                        <SearchableSelect
                          testId={`po-line-ticket-${idx}`}
                          value={li.destination_ticket_id || "__none"}
                          placeholder="Search ticket owner…"
                          searchPlaceholder="Search ticket number or title…"
                          options={[
                            { value: "__none", label: "Choose a ticket", detail: "Parts will remain unassigned", searchText: "none unassigned" },
                            ...tickets.map(ticket => ({
                              value: ticket.id,
                              label: `${ticket.ticket_number || "Ticket"} — ${ticket.title || "Untitled"}`,
                              detail: ticket.status ? `Status: ${ticket.status.replace(/_/g, " ")}` : "Service ticket",
                              searchText: `${ticket.ticket_number || ""} ${ticket.title || ""}`,
                            })),
                          ]}
                          onValueChange={value => updateLineItem(idx, "destination_ticket_id", value === "__none" ? "" : value)}
                        />
                      ) : (
                        <div className="flex h-10 items-center rounded-md border border-dashed border-emerald-500/25 bg-emerald-500/[0.04] px-3 text-xs text-emerald-300">
                          Available to stock on receipt
                        </div>
                      )}
                    </div>
                    <div className="col-span-4 lg:col-span-1">{idx === 0 && <Label className="text-xs">Qty</Label>}<Input type="number" min="1" value={li.quantity} onChange={e => updateLineItem(idx, "quantity", parseInt(e.target.value) || 1)} /></div>
                    <div className="col-span-5 lg:col-span-1">{idx === 0 && <Label className="text-xs">Unit price</Label>}<Input type="number" step="0.01" value={li.unit_price} onChange={e => updateLineItem(idx, "unit_price", parseFloat(e.target.value) || 0)} /></div>
                    <div className="col-span-2 lg:col-span-1 text-right"><p className="font-mono text-sm font-medium py-2">${(li.quantity * li.unit_price).toFixed(2)}</p></div>
                    <div className="col-span-1 text-right"><Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive" onClick={() => removeLineItem(idx)} aria-label="Remove line item"><Trash2 className="w-3 h-3" /></Button></div>
                    {li.destination_type === "ticket" && li.destination_ticket_id && (
                      <div className="col-span-12 flex items-center gap-2 rounded-lg border border-cyan-500/20 bg-cyan-500/[0.05] px-3 py-2 text-xs text-cyan-100">
                        <BellRing className="h-3.5 w-3.5 text-cyan-300" />
                        When this full line is receipted, {li.destination_technician_name || "the ticket technician"} will be notified that the parts are ready.
                      </div>
                    )}
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
        <DialogFooter className="shrink-0 border-t border-white/[0.07] bg-black/10 px-6 py-4"><p className="mr-auto text-xs text-zinc-500">New orders begin as drafts and move through approval before they are sent to a vendor.</p><Button className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400" onClick={handleSave} data-testid="save-po-btn">{editing ? "Save audited changes" : "Create draft purchase order"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );

  // ========== RECEIVE STOCK DIALOG ==========
  const receiveStockDialog = (
    <Dialog open={receiveDialog} onOpenChange={setReceiveDialog}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Box className="w-5 h-5 text-green-400" />Receive Stock - {viewPO?.po_number}</DialogTitle>
          <p className="text-sm text-muted-foreground">Enter only what arrived today. The remaining balance stays open on this PO.</p>
        </DialogHeader>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border bg-muted/20 px-3 py-2"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Lines open</p><p className="font-mono text-lg font-semibold">{receiveItems.length}</p></div>
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Outstanding</p><p className="font-mono text-lg font-semibold text-amber-400">{receiveItems.reduce((sum, ri) => sum + Math.max(0, ri.quantity - (ri.received_qty || 0)), 0)}</p></div>
            <div className="rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-2"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Receiving now</p><p className="font-mono text-lg font-semibold text-green-400">{receiveItems.reduce((sum, ri) => sum + (Number(ri.receive_now) || 0), 0)}</p></div>
          </div>
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
              <TableRow><TableHead>Product</TableHead><TableHead>Destination</TableHead><TableHead className="text-right">Ordered</TableHead><TableHead className="text-right">Already Rcvd</TableHead><TableHead className="text-right">Remaining</TableHead><TableHead className="text-right">Receive Now</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {receiveItems.map((ri, idx) => {
                const remaining = ri.quantity - (ri.received_qty || 0);
                const product = products.find(p => p.id === ri.product_id);
                const tracksStock = product?.track_inventory ?? ["hardware", "accessories", "networking", "security"].includes(String(product?.category || "").toLowerCase());
                return (
                  <TableRow key={`k-${idx}`}>
                    <TableCell className="font-medium"><div className="flex items-center gap-2"><span>{ri.product_name || "Item"}</span>{product && <Badge variant="outline" className={tracksStock ? "border-green-500/30 text-green-400 text-[10px]" : "text-muted-foreground text-[10px]"}>{tracksStock ? "Stock tracked" : "No stock change"}</Badge>}</div></TableCell>
                    <TableCell>
                      {ri.destination_type === "ticket" ? (
                        <div className="space-y-1">
                          <Badge variant="outline" className="border-cyan-500/30 bg-cyan-500/[0.06] text-[10px] text-cyan-200">Ticket owned</Badge>
                          <p className="max-w-40 truncate text-xs font-medium text-cyan-100">{ri.destination_ticket_number || "Linked ticket"}</p>
                          <p className="max-w-40 truncate text-[10px] text-muted-foreground">{ri.destination_technician_name ? `${ri.destination_technician_name} will be notified` : "Team notification on receipt"}</p>
                        </div>
                      ) : (
                        <Badge variant="outline" className="border-emerald-500/25 bg-emerald-500/[0.04] text-[10px] text-emerald-300">Stock inventory</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono">{ri.quantity}</TableCell>
                    <TableCell className="text-right font-mono">{ri.received_qty || 0}</TableCell>
                    <TableCell className="text-right font-mono text-amber-400">{remaining}</TableCell>
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
          <div className="grid gap-3 md:grid-cols-2">
            <div><Label>Packing slip number</Label><Input value={receiptMeta.packing_slip_number} onChange={event => setReceiptMeta(current => ({ ...current, packing_slip_number: event.target.value }))} placeholder="Delivery docket or packing slip" data-testid="po-packing-slip" /></div>
            <div><Label>Evidence reference</Label><Input value={receiptMeta.evidence_reference} onChange={event => setReceiptMeta(current => ({ ...current, evidence_reference: event.target.value }))} placeholder="Shelf, photo, courier, or attachment reference" /></div>
          </div>
          {receiveItems.filter(item => Number(item.receive_now) > 0).map((item, index) => (
            <Card key={`receive-evidence-${item.line_index}`} className="border-cyan-500/20 bg-cyan-500/[0.04]">
              <CardContent className="grid gap-3 p-3 md:grid-cols-2">
                <div className="md:col-span-2"><p className="text-xs font-medium text-cyan-100">{item.product_name || item.name || `Line ${index + 1}`} · {item.receive_now} arriving</p></div>
                <div><Label>Batch / lot number</Label><Input value={item.batch_number || ""} onChange={event => setReceiveItems(current => current.map(line => line.line_index === item.line_index ? { ...line, batch_number: event.target.value } : line))} placeholder="Optional batch or shipment reference" /></div>
                <div><Label>Serial numbers</Label><Textarea rows={2} value={item.serial_numbers_text || ""} onChange={event => setReceiveItems(current => current.map(line => line.line_index === item.line_index ? { ...line, serial_numbers_text: event.target.value } : line))} placeholder="Optional · one per line or comma separated" /></div>
              </CardContent>
            </Card>
          ))}
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
          {approvalDialog === "submit" && (
            <div>
              <Label>Route to approver</Label>
              <SearchableSelect
                testId="po-approver-select"
                value={approvalApprover || "management"}
                placeholder="Search approvers…"
                searchPlaceholder="Search approver name or email…"
                options={[
                  { value: "management", label: "Management queue", detail: "Use the default approval queue", searchText: "default management queue" },
                  ...users
                    .filter(user => user.is_admin || (approvalPolicy.approver_roles || []).includes(String(user.role || "").toLowerCase()))
                    .map(user => ({ value: user.id, label: user.name || "Unnamed approver", detail: user.email || user.role || "Approver", searchText: `${user.name || ""} ${user.email || ""} ${user.role || ""}` })),
                ]}
                onValueChange={value => setApprovalApprover(value === "management" ? "" : value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">Choosing a person sends them an in-app approval notification.</p>
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

  const returnStockDialog = (
    <Dialog open={returnDialog} onOpenChange={setReturnDialog}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col overflow-hidden border-amber-400/25 bg-[linear-gradient(145deg,rgba(24,19,10,0.98),rgba(12,14,19,0.98))] p-0">
        <DialogHeader className="border-b border-amber-400/15 px-6 py-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-300">Audited supplier return</p>
          <DialogTitle className="mt-1 flex items-center gap-2"><RotateCcw className="h-5 w-5 text-amber-300" />Return items from {viewPO?.po_number}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 overflow-y-auto px-6 py-5">
          <div className="grid gap-3 md:grid-cols-2">
            <div><Label>RMA number</Label><Input value={returnForm.rma_number} onChange={event => setReturnForm(current => ({ ...current, rma_number: event.target.value }))} placeholder="Optional supplier RMA" /></div>
            <div><Label>Supplier credit number</Label><Input value={returnForm.supplier_credit_number} onChange={event => setReturnForm(current => ({ ...current, supplier_credit_number: event.target.value }))} placeholder="Optional credit reference" /></div>
            <div className="md:col-span-2"><Label>Reason *</Label><Textarea value={returnForm.reason} onChange={event => setReturnForm(current => ({ ...current, reason: event.target.value }))} placeholder="Why the stock is being returned" rows={2} /></div>
          </div>
          {returnItems.map(item => {
            const available = Number(item.received_qty || 0) - Number(item.returned_qty || 0);
            return (
              <Card key={`return-${item.line_index}`} className="border-white/[0.08] bg-black/10">
                <CardContent className="grid gap-3 p-3 md:grid-cols-[1fr_8rem]">
                  <div><p className="font-medium">{item.product_name || item.name || "Purchase-order item"}</p><p className="text-xs text-muted-foreground">{available} available to return{item.received_serials?.length ? ` · ${item.received_serials.length} serial(s) recorded` : ""}</p></div>
                  <div><Label>Return now</Label><Input type="number" min="0" max={available} value={item.return_now} onChange={event => setReturnItems(current => current.map(line => line.line_index === item.line_index ? { ...line, return_now: Math.min(Number(event.target.value) || 0, available) } : line))} /></div>
                  {Number(item.return_now) > 0 && item.received_serials?.length > 0 && <div className="md:col-span-2"><Label>Returned serial numbers</Label><Textarea rows={2} value={item.serial_numbers_text} onChange={event => setReturnItems(current => current.map(line => line.line_index === item.line_index ? { ...line, serial_numbers_text: event.target.value } : line))} placeholder="One per line or comma separated" /></div>}
                </CardContent>
              </Card>
            );
          })}
          <div><Label>Internal notes</Label><Textarea value={returnForm.notes} onChange={event => setReturnForm(current => ({ ...current, notes: event.target.value }))} rows={2} placeholder="Supplier conversation, courier, or credit expectations" /></div>
        </div>
        <DialogFooter className="border-t border-white/[0.08] px-6 py-4"><Button variant="outline" onClick={() => setReturnDialog(false)}>Cancel</Button><Button className="bg-amber-500 text-amber-950 hover:bg-amber-400" onClick={handleReturnStock} data-testid="confirm-po-return"><RotateCcw className="mr-1.5 h-4 w-4" />Record return</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );

  const approvalPolicyDialog = (
    <Dialog open={approvalPolicyOpen} onOpenChange={setApprovalPolicyOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Settings2 className="h-5 w-5 text-cyan-300" />Procurement approval policy</DialogTitle><p className="text-sm text-muted-foreground">Set who can approve purchase orders and when the creator must be separated from the approver.</p></DialogHeader>
        <div className="space-y-4">
          <label className="flex items-center justify-between rounded-xl border p-3"><span><span className="block text-sm font-medium">Approval workflow</span><span className="block text-xs text-muted-foreground">Require an approval stage before ordering.</span></span><input type="checkbox" checked={approvalPolicy.enabled} onChange={event => setApprovalPolicy(current => ({ ...current, enabled: event.target.checked }))} /></label>
          <div><Label>High-value threshold</Label><Input type="number" min="0" step="0.01" value={approvalPolicy.threshold} onChange={event => setApprovalPolicy(current => ({ ...current, threshold: Number(event.target.value) || 0 }))} /><p className="mt-1 text-xs text-muted-foreground">Orders at or above this value enforce the controls below.</p></div>
          <label className="flex items-center justify-between rounded-xl border p-3"><span><span className="block text-sm font-medium">Separate creator and approver</span><span className="block text-xs text-muted-foreground">Prevents high-value self-approval.</span></span><input type="checkbox" checked={approvalPolicy.require_separation} onChange={event => setApprovalPolicy(current => ({ ...current, require_separation: event.target.checked }))} /></label>
          <label className="flex items-center justify-between rounded-xl border p-3"><span><span className="block text-sm font-medium">Named approver required</span><span className="block text-xs text-muted-foreground">High-value orders cannot use an unassigned queue.</span></span><input type="checkbox" checked={approvalPolicy.require_assigned_approver_above_threshold} onChange={event => setApprovalPolicy(current => ({ ...current, require_assigned_approver_above_threshold: event.target.checked }))} /></label>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setApprovalPolicyOpen(false)}>Cancel</Button><Button onClick={saveApprovalPolicy}><Save className="mr-1.5 h-4 w-4" />Save policy</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );

  const destructiveActionDialog = (
    <AlertDialog open={Boolean(destructiveAction)} onOpenChange={open => !open && setDestructiveAction(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{destructiveAction?.type === "delete" ? `Delete ${destructiveAction?.po?.po_number}?` : `Cancel ${destructiveAction?.po?.po_number}?`}</AlertDialogTitle>
          <AlertDialogDescription>
            {destructiveAction?.type === "delete"
              ? "This permanently removes the draft purchase-order record. Its deletion evidence remains in the audit log. Ordered or received purchase orders cannot be deleted."
              : "This stops further ordering and receiving on this purchase order. The order stays in the audit trail as cancelled."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep Purchase Order</AlertDialogCancel>
          <AlertDialogAction className={destructiveAction?.type === "delete" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : "bg-amber-600 text-white hover:bg-amber-700"} onClick={confirmDestructiveAction} data-testid="confirm-po-destructive-action">
            {destructiveAction?.type === "delete" ? "Delete Draft" : "Cancel Purchase Order"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  const pdfViewerDialogEl = (
    <PdfViewerDialog
      open={pdfViewer.open}
      onOpenChange={value => setPdfViewer(current => ({ ...current, open: value }))}
      pdfUrl={pdfViewer.url}
      title={pdfViewer.title}
      downloadUrl={pdfViewer.downloadUrl}
    />
  );

  // ========== DETAIL VIEW ==========
  if (viewPO) {
    const po = viewPO;
    const StatusIcon = STATUS_CONFIG[po.status]?.icon || Clock;
    const totalOrdered = (po.line_items || []).reduce((s, li) => s + li.quantity, 0);
    const totalReceived = (po.line_items || []).reduce((s, li) => s + (li.received_qty || 0), 0);
    const receivePct = totalOrdered > 0 ? Math.round((totalReceived / totalOrdered) * 100) : 0;
    const isOverdue = po.expected_delivery && new Date(po.expected_delivery) < new Date() && po.status !== "received" && po.status !== "cancelled";
    const vendorInvoiceMatch = po.vendor_invoice_match;
    const canApprove = Boolean(user?.is_admin || (approvalPolicy.approver_roles || []).includes(String(user?.role || "").toLowerCase()));

    return (
      <div className="space-y-4" data-testid="po-detail">
        <Card className="sticky top-0 z-30 overflow-hidden rounded-2xl border border-white/[0.09] bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_34%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.10),transparent_30%),linear-gradient(135deg,rgba(17,19,24,0.98),rgba(10,12,17,0.98))] shadow-[0_22px_65px_rgba(0,0,0,0.34)] backdrop-blur-xl" data-testid="po-console-header">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.17em] text-cyan-300/85"><span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" /></span>Live procurement record <span className="text-zinc-600">/</span><span className="text-zinc-400">Supply operations</span></div>
            <div className="flex flex-wrap items-center gap-2.5">
              <Button variant="ghost" size="sm" className="h-9 w-9 rounded-lg p-0 text-zinc-400 hover:bg-white/[0.06] hover:text-white" onClick={() => { setViewPO(null); setDetailTab("items"); }} data-testid="back-to-pos" aria-label="Back to purchase orders" title="Back to purchase orders"><ArrowLeft className="h-4 w-4" /></Button>
              <Badge className="h-6 border-white/[0.10] bg-black/30 px-2.5 font-mono text-[10px] tracking-wide text-zinc-200">{po.po_number}</Badge>
              <Badge className={STATUS_CONFIG[po.status]?.class + " " + (STATUS_CONFIG[po.status]?.glow || "")}><StatusIcon className="mr-1 h-3 w-3" />{STATUS_CONFIG[po.status]?.label}</Badge>
              {isOverdue && <Badge className="animate-pulse border-red-500/30 bg-red-500/20 text-red-400"><AlertTriangle className="mr-1 h-3 w-3" />Overdue</Badge>}
              {po.escalated && <Badge className="border-orange-500/30 bg-orange-500/20 text-orange-400"><BellRing className="mr-1 h-3 w-3" />Escalated</Badge>}
              {vendorInvoiceMatch && <Badge className={vendorInvoiceMatch.status === "matched" || vendorInvoiceMatch.review?.status === "accepted" ? "border-emerald-500/30 bg-emerald-500/20 text-emerald-400" : "border-amber-500/30 bg-amber-500/20 text-amber-400"}><DollarSign className="mr-1 h-3 w-3" />{vendorInvoiceMatch.status === "matched" ? "Invoice matched" : vendorInvoiceMatch.review?.status === "accepted" ? "Variance accepted" : "Invoice variance"}</Badge>}
              <div className="order-last basis-full min-w-0 pt-1 lg:order-none lg:ml-2 lg:basis-auto lg:flex-1"><p className="truncate text-xl font-semibold tracking-tight text-white">{po.vendor || "Vendor purchase order"}</p><p className="mt-1 text-xs text-zinc-400">Expected {po.expected_delivery || "delivery date not set"} <span className="px-1.5 text-zinc-600">/</span> Total <span className="font-mono text-emerald-200">${(po.total || 0).toFixed(2)}</span></p></div>
              {(po.status === "submitted" || po.status === "partial") && <Button className="h-9 rounded-lg bg-emerald-500 px-3 text-emerald-950 shadow-[0_8px_20px_rgba(16,185,129,0.22)] hover:bg-emerald-400" onClick={() => openReceiveDialog(po)} data-testid="header-receive-stock-btn"><PackageCheck className="mr-1.5 h-3.5 w-3.5" />Receive stock</Button>}
              {["approved", "submitted", "partial"].includes(po.status) && <Button variant="outline" size="sm" className="h-9 rounded-lg border-cyan-400/25 bg-cyan-500/[0.08] px-3 text-cyan-100 hover:border-cyan-300/40 hover:bg-cyan-500/[0.16]" onClick={() => { setEmailForm({ email: po.vendor_email || "", subject: `Purchase Order ${po.po_number}`, message: `Please find attached PO ${po.po_number}.` }); setEmailVendorDialog(true); }} data-testid="header-email-po-btn"><Mail className="mr-1.5 h-3.5 w-3.5" />Email</Button>}
              <Button variant="outline" size="sm" className="h-9 rounded-lg border-white/[0.12] bg-black/10 px-3 text-zinc-100 hover:border-white/[0.20] hover:bg-white/[0.08]" onClick={() => handlePreviewPdf(po)} data-testid="header-preview-po-btn"><Eye className="mr-1.5 h-3.5 w-3.5" />Preview</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.08] pt-3"><span className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.10] px-2.5 py-1 text-xs font-medium text-emerald-100">{po.vendor || "No vendor"}</span><span className="rounded-lg bg-white/[0.05] px-2.5 py-1 font-mono text-[10px] text-zinc-400">{totalReceived} / {totalOrdered} received</span>{po.client_name && <span className="rounded-lg bg-white/[0.05] px-2.5 py-1 text-[10px] text-zinc-400">For {po.client_name}</span>}<span className="ml-auto rounded-lg bg-white/[0.05] px-2.5 py-1 font-mono text-[10px] text-zinc-400">${(po.total || 0).toFixed(2)}</span></div>
          </CardContent>
        </Card>

        {/* Approval Pipeline */}
        <Card className="overflow-hidden border border-cyan-400/[0.14] bg-[linear-gradient(135deg,rgba(34,211,238,0.06),rgba(16,185,129,0.04))]">
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
          <Card className="overflow-hidden border border-cyan-400/[0.14] bg-[linear-gradient(135deg,rgba(34,211,238,0.06),rgba(16,185,129,0.04))]">
            <CardContent className="py-3 px-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Receiving Progress</span>
                <span className="text-xs font-mono">{totalReceived} / {totalOrdered} items ({receivePct}%)</span>
              </div>
              <Progress value={receivePct} className="h-2" />
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <div className="space-y-4 xl:col-span-8">
            <Tabs value={detailTab} onValueChange={setDetailTab}>
              <TabsList className="h-auto w-full justify-start gap-0 overflow-x-auto rounded-xl border border-white/[0.08] bg-black/[0.14] p-1">
                <TabsTrigger value="items" className="h-9 shrink-0 rounded-lg px-3 text-xs data-[state=active]:bg-cyan-500/[0.14] data-[state=active]:text-cyan-100" data-testid="tab-po-items">Items ({(po.line_items || []).length})</TabsTrigger>
                <TabsTrigger value="notes" className="h-9 shrink-0 rounded-lg px-3 text-xs data-[state=active]:bg-cyan-500/[0.14] data-[state=active]:text-cyan-100" data-testid="tab-po-notes">Notes ({poNotes.length})</TabsTrigger>
                <TabsTrigger value="audit" className="h-9 shrink-0 rounded-lg px-3 text-xs data-[state=active]:bg-cyan-500/[0.14] data-[state=active]:text-cyan-100" data-testid="tab-po-audit">Audit Trail ({auditLog.length})</TabsTrigger>
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
                          <TableHead>Destination</TableHead>
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
                                {li.destination_type === "ticket" ? (
                                  <div className="space-y-1">
                                    <Badge variant="outline" className="border-cyan-500/30 bg-cyan-500/[0.06] text-[10px] text-cyan-200">Ticket owned</Badge>
                                    <p className="max-w-48 truncate text-xs text-cyan-100">{li.destination_ticket_number || "Linked ticket"}</p>
                                    {li.arrival_notified ? <p className="text-[10px] text-emerald-300">Technician notified</p> : <p className="text-[10px] text-muted-foreground">Alert on full receipt</p>}
                                  </div>
                                ) : (
                                  <Badge variant="outline" className="border-emerald-500/25 bg-emerald-500/[0.04] text-[10px] text-emerald-300">Stock inventory</Badge>
                                )}
                              </TableCell>
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

          <div className="space-y-4 xl:col-span-4">
            <Card className="overflow-hidden border border-white/[0.08] bg-[linear-gradient(135deg,rgba(255,255,255,0.035),rgba(255,255,255,0.012))]">
              <CardHeader className="border-b border-white/[0.07] pb-3"><CardTitle className="flex items-center gap-2 text-sm text-zinc-100"><span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />Procurement details</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div><span className="text-muted-foreground block">Vendor</span><span className="font-medium">{po.vendor}</span></div>
                {po.vendor_email && <div><span className="text-muted-foreground block">Vendor Email</span><span className="font-medium text-blue-400">{po.vendor_email}</span></div>}
                <Separator />
                <div><span className="text-muted-foreground block">Assigned To</span><span className="font-medium">{po.assigned_to_name || "Unassigned"}</span></div>
                <Separator />
                <div><span className="text-muted-foreground block">Expected Delivery</span><span className={`font-medium ${isOverdue ? "text-red-400" : ""}`}>{po.expected_delivery || "N/A"}</span></div>
                {po.client_name && <><Separator /><div><span className="text-muted-foreground block">Client</span><span className="font-medium">{po.client_name}</span></div></>}
                {po.ticket_id && <><Separator /><div><span className="text-muted-foreground block">Related Ticket</span><Link className="font-medium text-primary hover:underline" to={`/tickets?ticket=${encodeURIComponent(po.ticket_id)}`}>{po.ticket_number || "Open ticket"}{po.ticket_title ? ` · ${po.ticket_title}` : ""}</Link></div></>}
                <Separator />
                <div><span className="text-muted-foreground block">Created By</span><span className="font-medium">{po.created_by_name || "System"}</span></div>
                <div><span className="text-muted-foreground block">Created</span><span className="font-medium">{po.created_at ? format(new Date(po.created_at), "MMM d, yyyy HH:mm") : "N/A"}</span></div>
                {po.emailed_to && <><Separator /><div><span className="text-muted-foreground block">Emailed To</span><span className="font-medium text-blue-400">{po.emailed_to}</span><span className="block text-xs text-muted-foreground">{po.emailed_at ? format(new Date(po.emailed_at), "MMM d, HH:mm") : ""}</span></div></>}
                {(po.attachments || []).length > 0 && <><Separator /><div><span className="mb-1.5 block text-muted-foreground">Evidence</span><div className="space-y-1">{po.attachments.map(file => <a key={file.id} href={file.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-md border border-white/[0.08] px-2 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/[0.06]"><Paperclip className="h-3 w-3" /><span className="truncate">{file.name}</span></a>)}</div></div></>}
                {(po.return_events || []).length > 0 && <><Separator /><div><span className="text-muted-foreground block">Returns / RMAs</span><span className="font-medium text-amber-300">{po.return_events.length} audited return event{po.return_events.length === 1 ? "" : "s"}</span></div></>}
              </CardContent>
            </Card>
            <Card className={vendorInvoiceMatch?.status === "variance" ? "border-amber-500/30" : vendorInvoiceMatch ? "border-emerald-500/25" : ""}>
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><DollarSign className="w-4 h-4" />Supplier invoice match</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {vendorInvoiceMatch ? <>
                  <div className="flex justify-between gap-3"><span className="text-muted-foreground">Invoice</span><span className="font-mono font-medium">{vendorInvoiceMatch.invoice_number}</span></div>
                  {vendorInvoiceMatch.invoice_date && <div className="flex justify-between gap-3"><span className="text-muted-foreground">Invoice date</span><span>{vendorInvoiceMatch.invoice_date}</span></div>}
                  <div className="flex justify-between gap-3"><span className="text-muted-foreground">Supplier total</span><span className="font-mono">${(vendorInvoiceMatch.supplier_total || 0).toFixed(2)}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-muted-foreground">PO total</span><span className="font-mono">${(vendorInvoiceMatch.expected_total || 0).toFixed(2)}</span></div>
                  <Separator />
                  <div className={`flex justify-between gap-3 font-medium ${vendorInvoiceMatch.status === "matched" ? "text-emerald-400" : "text-amber-400"}`}><span>{vendorInvoiceMatch.status === "matched" ? "Matched" : "Variance"}</span><span className="font-mono">{vendorInvoiceMatch.status === "matched" ? "$0.00" : `${vendorInvoiceMatch.variance > 0 ? "+" : "-"}$${Math.abs(vendorInvoiceMatch.variance || 0).toFixed(2)}`}</span></div>
                  {vendorInvoiceMatch.notes && <p className="text-xs text-muted-foreground pt-1">{vendorInvoiceMatch.notes}</p>}
                  {vendorInvoiceMatch.status === "variance" && <>
                    <Separator />
                    {vendorInvoiceMatch.review ? <div className={`rounded-md px-2.5 py-2 text-xs ${vendorInvoiceMatch.review.status === "accepted" ? "bg-emerald-500/10 text-emerald-300" : "bg-amber-500/10 text-amber-300"}`}>
                      <p className="font-medium">{vendorInvoiceMatch.review.status === "accepted" ? "Variance accepted" : "Supplier follow-up required"}</p>
                      <p className="mt-0.5 opacity-80">{vendorInvoiceMatch.review.reviewed_by_name || "System"}{vendorInvoiceMatch.review.notes ? ` · ${vendorInvoiceMatch.review.notes}` : ""}</p>
                    </div> : <p className="text-xs text-amber-300">Review required before this variance is considered closed.</p>}
                  </>}
                </> : <p className="text-sm text-muted-foreground">No supplier invoice has been matched to this PO yet.</p>}
              </CardContent>
            </Card>
            <Card className="overflow-hidden border border-white/[0.08] bg-[linear-gradient(135deg,rgba(255,255,255,0.035),rgba(255,255,255,0.012))]">
              <CardHeader className="border-b border-white/[0.07] pb-3"><CardTitle className="flex items-center gap-2 text-sm text-zinc-100"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Purchase controls</CardTitle></CardHeader>
              <CardContent className="space-y-2 [&>button]:h-9 [&>button]:justify-start [&>button]:rounded-lg">
                {/* Approval Workflow */}
                {po.status === "draft" && (
                  <Button className="w-full bg-cyan-500 text-cyan-950 hover:bg-cyan-400" onClick={() => handleSubmitForApproval(po)} data-testid="submit-for-approval-btn">
                    <Send className="mr-1.5 h-4 w-4" />Submit for approval
                  </Button>
                )}
                {po.status === "pending_approval" && canApprove && (
                  <>
                    <Button className="w-full bg-emerald-500 text-emerald-950 hover:bg-emerald-400" onClick={() => { setApprovalDialog("approve"); setApprovalNotes(""); }} data-testid="approve-po-btn">
                      <ThumbsUp className="mr-1.5 h-4 w-4" />Approve
                    </Button>
                    <Button variant="destructive" className="w-full" onClick={() => { setApprovalDialog("reject"); setApprovalNotes(""); }} data-testid="reject-po-btn">
                      <ThumbsDown className="w-4 h-4 mr-1" />Reject
                    </Button>
                  </>
                )}
                {po.status === "approved" && (
                  <>
                    <Button className="w-full bg-cyan-500 text-cyan-950 hover:bg-cyan-400" onClick={() => {
                      setEmailForm({ email: po.vendor_email || "", subject: `Purchase Order ${po.po_number}`, message: `Please find attached PO ${po.po_number}.` });
                      setEmailVendorDialog(true);
                    }} data-testid="email-and-submit-po">
                      <Mail className="w-4 h-4 mr-1" />Email PO & Mark Ordered
                    </Button>
                    <Button variant="outline" className="w-full" onClick={() => handleStatusChange(po, "submitted")} data-testid="submit-po">
                      <Send className="w-4 h-4 mr-1" />Mark as Ordered (no email)
                    </Button>
                  </>
                )}
                {(po.status === "submitted" || po.status === "partial") && (
                  <Button variant="outline" className="w-full text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" onClick={() => {
                    setEmailForm({ email: po.vendor_email || "", subject: `Purchase Order ${po.po_number}`, message: `Please find attached PO ${po.po_number}.` });
                    setEmailVendorDialog(true);
                  }} data-testid="email-po-vendor">
                    <Mail className="w-4 h-4 mr-1" />Email PO to Vendor
                  </Button>
                )}
                {(po.status === "submitted" || po.status === "partial") && (
                  <Button className="w-full bg-emerald-500 text-emerald-950 hover:bg-emerald-400" onClick={() => openReceiveDialog(po)} data-testid="receive-stock-btn">
                    <PackageCheck className="mr-1.5 h-4 w-4" />Receive Stock
                  </Button>
                )}
                {(po.status === "partial" || po.status === "received") && (po.line_items || []).some(item => Number(item.received_qty || 0) > Number(item.returned_qty || 0)) && (
                  <Button variant="outline" className="w-full border-amber-500/30 text-amber-300 hover:bg-amber-500/10" onClick={() => openReturnDialog(po)} data-testid="return-po-stock-btn">
                    <RotateCcw className="mr-1.5 h-4 w-4" />Return / RMA items
                  </Button>
                )}
                <Button variant="outline" className="w-full text-amber-400 border-amber-500/30 hover:bg-amber-500/10" onClick={() => openVendorInvoiceMatch(po)} data-testid="match-vendor-invoice-btn">
                  <DollarSign className="w-4 h-4 mr-1" />{vendorInvoiceMatch ? "Review Supplier Invoice" : "Match Supplier Invoice"}
                </Button>
                {vendorInvoiceMatch?.status === "variance" && <Button variant="outline" className="w-full" onClick={() => openVendorInvoiceReview(po)} data-testid="review-supplier-invoice-variance">
                  <CheckCircle className="w-4 h-4 mr-1" />{vendorInvoiceMatch.review ? "Update Variance Review" : "Review Invoice Variance"}
                </Button>}
                {vendorInvoiceMatch && (vendorInvoiceMatch.status === "matched" || vendorInvoiceMatch.review?.status === "accepted") && (
                  <Button variant="outline" className="w-full border-sky-500/30 text-sky-300 hover:bg-sky-500/10" onClick={handleQueueSupplierBill} data-testid="queue-xero-supplier-bill">
                    <Building2 className="mr-1.5 h-4 w-4" />{po.supplier_bill_sync?.status === "queued" ? "Supplier bill queued" : po.supplier_bill_sync?.status === "needs_connection" ? "Connect Xero to send bill" : "Queue supplier bill for Xero"}
                  </Button>
                )}
                <label className="flex h-9 w-full cursor-pointer items-center rounded-lg border border-white/[0.12] bg-black/10 px-3 text-sm text-zinc-100 hover:border-cyan-400/30 hover:bg-cyan-500/[0.06]">
                  <Paperclip className="mr-1.5 h-4 w-4" />Attach invoice or receiving evidence
                  <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.csv,.docx,.xlsx" onChange={handleUploadEvidence} data-testid="po-evidence-upload" />
                </label>
                <Separator />
                {/* PDF & Email */}
                <Button variant="outline" className="w-full border-white/[0.12] bg-black/10 text-zinc-100 hover:border-white/[0.20] hover:bg-white/[0.08]" onClick={() => handlePreviewPdf(po)} data-testid="preview-po-pdf">
                  <Eye className="mr-1.5 h-4 w-4" />Preview PDF
                </Button>
                <Button variant="outline" className="w-full border-white/[0.12] bg-black/10 text-zinc-100 hover:border-white/[0.20] hover:bg-white/[0.08]" onClick={() => handleDownloadPdf(po)} disabled={pdfLoading} data-testid="download-po-pdf">
                  {pdfLoading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}Download PDF
                </Button>
                <Separator />
                {/* Utility Actions */}
                <Button variant="outline" className="w-full" onClick={() => handleDuplicate(po)} data-testid="duplicate-po-btn">
                  <Copy className="w-4 h-4 mr-1" />Duplicate PO
                </Button>
                {(po.status === "draft" || po.status === "rejected") && <Button variant="outline" className="w-full" onClick={() => openEdit(po)} data-testid="edit-po">
                  <Edit className="w-4 h-4 mr-1" />Edit
                </Button>}
                {["draft", "rejected", "approved", "submitted"].includes(po.status) && !((po.line_items || []).some(item => Number(item.received_qty || 0) > 0)) && (
                  <Button variant="outline" className="w-full text-amber-400" onClick={() => requestDestructiveAction("cancel", po)} data-testid="cancel-po-btn">
                    <XCircle className="w-4 h-4 mr-1" />Cancel PO
                  </Button>
                )}
                {(po.status === "draft" || po.status === "rejected") && <Button variant="destructive" className="w-full" onClick={() => requestDestructiveAction("delete", po)} data-testid="delete-po-btn">
                  <Trash2 className="w-4 h-4 mr-1" />Delete
                </Button>}
              </CardContent>
            </Card>
          </div>
        </div>
        {formDialog}{receiveStockDialog}{returnStockDialog}{approvalDialogEl}{approvalPolicyDialog}{emailVendorDialogEl}{destructiveActionDialog}{pdfViewerDialogEl}
        <Dialog open={vendorInvoiceDialog} onOpenChange={setVendorInvoiceDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Match supplier invoice</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">Record the supplier invoice against {po.po_number}. This does not alter the PO total or create a customer invoice.</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><Label>Supplier invoice number *</Label><Input value={vendorInvoiceForm.invoice_number} onChange={e => setVendorInvoiceForm({ ...vendorInvoiceForm, invoice_number: e.target.value })} placeholder="e.g. INV-10482" data-testid="supplier-invoice-number" /></div>
              <div><Label>Invoice date</Label><Input type="date" value={vendorInvoiceForm.invoice_date} onChange={e => setVendorInvoiceForm({ ...vendorInvoiceForm, invoice_date: e.target.value })} /></div>
              <div><Label>Supplier total *</Label><Input type="number" min="0" step="0.01" value={vendorInvoiceForm.supplier_total} onChange={e => setVendorInvoiceForm({ ...vendorInvoiceForm, supplier_total: e.target.value })} data-testid="supplier-invoice-total" /></div>
              <div className="col-span-2"><Label>Internal notes</Label><Textarea rows={3} value={vendorInvoiceForm.notes} onChange={e => setVendorInvoiceForm({ ...vendorInvoiceForm, notes: e.target.value })} placeholder="Reason for a variance, receiving note, or approval reference..." /></div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setVendorInvoiceDialog(false)}>Cancel</Button><Button onClick={handleVendorInvoiceMatch} data-testid="save-supplier-invoice-match">Save match</Button></DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={vendorInvoiceReviewDialog} onOpenChange={setVendorInvoiceReviewDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Review supplier invoice variance</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">Record the internal decision for the variance on {po.po_number}. This remains an audit record and does not change billing automatically.</p>
            <div className="space-y-3">
              <div><Label>Decision</Label><Select value={vendorInvoiceReview.decision} onValueChange={value => setVendorInvoiceReview({ ...vendorInvoiceReview, decision: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="accepted">Accept variance</SelectItem><SelectItem value="follow_up">Supplier follow-up required</SelectItem></SelectContent></Select></div>
              <div><Label>Review notes</Label><Textarea rows={3} value={vendorInvoiceReview.notes} onChange={e => setVendorInvoiceReview({ ...vendorInvoiceReview, notes: e.target.value })} placeholder="Approval rationale, supplier contact, or next step..." /></div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setVendorInvoiceReviewDialog(false)}>Cancel</Button><Button onClick={handleVendorInvoiceReview} data-testid="save-supplier-invoice-review">Save review</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ========== ANALYTICS VIEW ==========
  if (analyticsTab === "analytics") {
    if (!spendAnalytics) fetchSpendAnalytics();
    return (
      <div className="space-y-6" data-testid="po-analytics">
        <OperationalPageHeader
          eyebrow="Procurement intelligence"
          title="PO Spend Analytics"
          description="Track supplier concentration, monthly commitments, and purchase-order status from the same audited procurement ledger."
          icon={BarChart3}
          tone="emerald"
          actions={<Button variant="outline" size="sm" onClick={() => setAnalyticsTab("list")} data-testid="back-to-po-list"><ArrowLeft className="w-4 h-4 mr-1" />Back to POs</Button>}
        />
        {!spendAnalytics ? (
          <div className="flex items-center justify-center h-48"><Loader2 className="w-8 h-8 animate-spin" /></div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <HeroTile label="Total spend" value={`$${(spendAnalytics.total_spend || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`} icon={DollarSign} glow="emerald" subtitle="Audited purchase orders" />
              <HeroTile label="Purchase orders" value={spendAnalytics.total_pos || 0} icon={ShoppingCart} glow="cyan" subtitle="Across all suppliers" />
              <HeroTile label="Average PO value" value={`$${(spendAnalytics.avg_po_value || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`} icon={TrendingUp} glow="violet" subtitle="Mean committed value" />
            </div>
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
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
      <OperationalPageHeader
        eyebrow="Procurement operations"
        title="Purchase Orders"
        description={`Create, approve, receive, and audit ${pos.length} purchase order${pos.length === 1 ? "" : "s"} from one connected procurement workspace.`}
        icon={ShoppingCart}
        tone="emerald"
        actions={<>
          <Button variant="outline" size="sm" onClick={() => { setAnalyticsTab("analytics"); setSpendAnalytics(null); }} data-testid="po-analytics-btn">
            <BarChart3 className="w-4 h-4 mr-1" />Analytics
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5" data-testid="po-workspace-tools">
                <MoreHorizontal className="w-4 h-4" />
                Tools
                <ChevronDown className="w-3.5 h-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem asChild className="gap-2" data-testid="po-tools-vendors">
                <Link to="/vendors"><Building2 className="w-4 h-4" />Vendors</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="gap-2" data-testid="po-tools-vendor-scorecard">
                <Link to="/vendor-scorecard"><BarChart3 className="w-4 h-4" />Vendor scorecard</Link>
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-2" onSelect={() => setApprovalPolicyOpen(true)} data-testid="po-tools-approval-policy">
                <Settings2 className="w-4 h-4" />Approval policy
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" onClick={handleCheckEscalations} data-testid="check-escalations-btn">
            <BellRing className="w-4 h-4 mr-1" />Check Escalations
          </Button>
          <Button size="sm" onClick={() => openCreate(null)} data-testid="create-po-btn"><Plus className="w-4 h-4 mr-1.5" />New Purchase Order</Button>
        </>}
      />

      {/* Shared ticket-style metric strip */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <HeroTile label="All purchase orders" value={stats.total || 0} icon={FileText} glow="cyan" active={statusFilter === "all" && !search} onClick={() => { setSearch(""); applyStatusFilter("all"); }} testId="po-stat-total" />
        <HeroTile label="Awaiting approval" value={stats.pending_approval || 0} icon={Clock} glow="amber" active={statusFilter === "pending_approval"} onClick={() => applyStatusFilter("pending_approval")} testId="po-stat-pending-approval" />
        <HeroTile label="Ordered" value={stats.submitted || 0} icon={Send} glow="cyan" active={statusFilter === "submitted"} onClick={() => applyStatusFilter("submitted")} testId="po-stat-ordered" />
        <HeroTile label="Receiving" value={stats.partial || 0} icon={PackageCheck} glow="amber" active={statusFilter === "partial"} onClick={() => applyStatusFilter("partial")} testId="po-stat-receiving" />
        <HeroTile label="Overdue delivery" value={overdueCount} icon={AlertTriangle} glow={overdueCount > 0 ? "rose" : "emerald"} active={search === "" && statusFilter === "overdue"} onClick={() => { setSearch(""); setStatusFilter("overdue"); }} testId="po-stat-overdue" />
        <HeroTile label="Invoice variances" value={supplierInvoiceVarianceCount} icon={AlertTriangle} glow={supplierInvoiceVarianceCount > 0 ? "amber" : "emerald"} active={statusFilter === "invoice_variance"} onClick={() => { setSearch(""); setStatusFilter("invoice_variance"); }} testId="po-stat-invoice-variance" />
      </div>

      {/* Procurement queue controls */}
      <Card className="border-border/60">
      <CardContent className="py-3 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search PO#, vendor..." value={search} onChange={e => setSearch(e.target.value)} data-testid="po-search" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[170px]" data-testid="po-status-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="overdue">Overdue Delivery</SelectItem>
            <SelectItem value="invoice_variance">Supplier Invoice Variance</SelectItem>
            <SelectItem value="invoice_unmatched">Supplier Invoice Unmatched</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="pending_approval">Pending Approval</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="submitted">Ordered</SelectItem>
            <SelectItem value="partial">Partial</SelectItem>
            <SelectItem value="received">Received</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground ml-auto">Showing <span className="font-semibold text-foreground">{filtered.length}</span> of {pos.length}</span>
        {hasFilters && <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setSearch(""); setStatusFilter("all"); }}>Clear filters</Button>}
      </CardContent>
      </Card>

      {/* PO Table */}
      <Card className="overflow-hidden border-border/60">
        <CardHeader className="pb-3 border-b border-border/50 flex flex-row items-center justify-between">
          <div><CardTitle className="text-sm flex items-center gap-2"><Layers className="w-4 h-4 text-violet-400" />Purchase queue</CardTitle><p className="text-xs text-muted-foreground mt-1">Open an order to approve, email, receive, or audit its history.</p></div>
          <Badge variant="outline" className="font-mono text-[10px]">{filtered.length} visible</Badge>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO #</TableHead><TableHead>Vendor</TableHead><TableHead>Assigned</TableHead>
                <TableHead>Items</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Supplier invoice</TableHead>
                <TableHead>Status</TableHead><TableHead>Delivery</TableHead><TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center py-12 text-muted-foreground">{search || statusFilter !== "all" ? "No POs match filters" : "No purchase orders yet."}</TableCell></TableRow>
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
                      {po.vendor_invoice_match ? (
                        <Badge className={po.vendor_invoice_match.status === "matched" || po.vendor_invoice_match.review?.status === "accepted" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs" : "bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs"}>
                          <DollarSign className="w-3 h-3 mr-1" />{po.vendor_invoice_match.status === "matched" ? "Matched" : po.vendor_invoice_match.review?.status === "accepted" ? "Accepted" : `${po.vendor_invoice_match.variance > 0 ? "+" : "-"}$${Math.abs(po.vendor_invoice_match.variance || 0).toFixed(2)}`}
                        </Badge>
                      ) : requiresSupplierInvoice(po) ? <Badge variant="outline" className="text-xs text-amber-400 border-amber-500/30">Unmatched</Badge> : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
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
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Preview PDF" onClick={() => handlePreviewPdf(po)}><Eye className="w-3 h-3 text-violet-400" /></Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Download PDF" onClick={() => handleDownloadPdf(po)}><Download className="w-3 h-3" /></Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Duplicate" onClick={() => handleDuplicate(po)}><Copy className="w-3 h-3" /></Button>
                        {po.status === "draft" && <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" title="Delete draft" onClick={() => requestDestructiveAction("delete", po)}><Trash2 className="w-3 h-3" /></Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {formDialog}{receiveStockDialog}{returnStockDialog}{approvalDialogEl}{approvalPolicyDialog}{emailVendorDialogEl}{destructiveActionDialog}
      {pdfViewerDialogEl}
    </div>
  );
}
