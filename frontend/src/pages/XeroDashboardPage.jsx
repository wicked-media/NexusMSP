import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  DollarSign, TrendingUp, AlertTriangle, CheckCircle, FileText, Users,
  RefreshCw, Loader2, CreditCard, Receipt, Search, BarChart3, Clock, Plus,
  Send, Ban, History, Repeat, ArrowRight, Pause, Play, XCircle, Mail,
  Pencil, Trash2, Zap, CalendarDays, Percent, Shield, ChevronDown, ChevronUp,
  Palette, Eye, Download, Link2, Copy
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart as RePieChart,
  Pie, Cell, Legend, AreaChart, Area
} from "recharts";
import { PdfViewerDialog } from "@/components/PdfViewerDialog";

const STATUS_COLORS = {
  PAID: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/30" },
  AUTHORISED: { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/30" },
  DRAFT: { bg: "bg-zinc-500/10", text: "text-zinc-400", border: "border-zinc-500/30" },
  VOIDED: { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/30" },
  OVERDUE: { bg: "bg-orange-500/10", text: "text-orange-400", border: "border-orange-500/30" },
  SENT: { bg: "bg-cyan-500/10", text: "text-cyan-400", border: "border-cyan-500/30" },
  APPROVED: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/30" },
  DECLINED: { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/30" },
  CONVERTED: { bg: "bg-purple-500/10", text: "text-purple-400", border: "border-purple-500/30" },
};
const PIE_COLORS = ["#10b981", "#3b82f6", "#6b7280", "#ef4444", "#f59e0b", "#8b5cf6"];
const FREQ_LABELS = { weekly: "Weekly", fortnightly: "Fortnightly", monthly: "Monthly", quarterly: "Quarterly", yearly: "Annually" };
const FREQ_SHORT = { weekly: "wk", fortnightly: "2wk", monthly: "mo", quarterly: "qtr", yearly: "yr" };

function StatusBadge({ status }) {
  const sc = STATUS_COLORS[status] || STATUS_COLORS.DRAFT;
  return <Badge className={`${sc.bg} ${sc.text} ${sc.border} text-[10px]`}>{status}</Badge>;
}

function AgingBar({ label, amount, total, color }) {
  const pct = total > 0 ? Math.min((amount / total) * 100, 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs"><span className="text-muted-foreground">{label}</span><span className="font-mono" style={{ color }}>${amount.toLocaleString("en", { minimumFractionDigits: 0 })}</span></div>
      <div className="h-2 bg-muted/20 rounded-full overflow-hidden"><div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: color }} /></div>
    </div>
  );
}

function LineItemsEditor({ items, onChange }) {
  const update = (i, field, value) => { const next = [...items]; next[i] = { ...next[i], [field]: value }; onChange(next); };
  const remove = (i) => { const next = items.filter((_, j) => j !== i); onChange(next.length ? next : [{ description: "", quantity: 1, unit_price: 0 }]); };
  const add = () => onChange([...items, { description: "", quantity: 1, unit_price: 0 }]);
  return (
    <div className="space-y-2">
      <Label>Line Items</Label>
      {items.map((item, i) => (
        <div key={`li-${i}`} className="grid grid-cols-12 gap-2">
          <Input className="col-span-6" placeholder="Description" value={item.description} onChange={e => update(i, "description", e.target.value)} />
          <Input className="col-span-2" type="number" placeholder="Qty" value={item.quantity} onChange={e => update(i, "quantity", Number(e.target.value))} />
          <Input className="col-span-3" type="number" step="0.01" placeholder="Unit Price" value={item.unit_price} onChange={e => update(i, "unit_price", Number(e.target.value))} />
          <Button variant="ghost" size="sm" className="h-9 w-9 p-0 col-span-1" onClick={() => remove(i)}><XCircle className="w-4 h-4 text-muted-foreground" /></Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="text-xs" onClick={add}><Plus className="w-3 h-3 mr-1" />Add Line</Button>
      <div className="text-right text-sm font-mono text-muted-foreground">
        Subtotal: ${items.reduce((s, i) => s + (i.quantity || 0) * (i.unit_price || 0), 0).toLocaleString("en", { minimumFractionDigits: 2 })}
      </div>
    </div>
  );
}

export default function XeroDashboardPage() {
  const { token } = useAuth();
  const [activeTab, setActiveTab] = useState("overview");
  const [dashboard, setDashboard] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [estimates, setEstimates] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [syncHistory, setSyncHistory] = useState([]);
  const [forecast, setForecast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  // Filters
  const [invSearch, setInvSearch] = useState("");
  const [invStatus, setInvStatus] = useState("all");
  const [estSearch, setEstSearch] = useState("");
  const [recSearch, setRecSearch] = useState("");
  const [recFilter, setRecFilter] = useState("all");
  // Expanded recurring detail
  const [expandedRec, setExpandedRec] = useState(null);
  const [recHistory, setRecHistory] = useState([]);
  // Branding
  const [brandingTemplates, setBrandingTemplates] = useState({ builtin: [], custom: [] });
  const [brandingSettings, setBrandingSettings] = useState({});
  const [activeBrandingDoc, setActiveBrandingDoc] = useState("invoice");
  const [brandingForm, setBrandingForm] = useState({});
  const [brandingPreview, setBrandingPreview] = useState(null);
  const [savingBranding, setSavingBranding] = useState(false);
  // Invoice PDF Themes
  const [pdfThemes, setPdfThemes] = useState([]);
  const [activePdfTheme, setActivePdfTheme] = useState("theme-modern");
  const [savingTheme, setSavingTheme] = useState(false);
  // Dialogs
  const [payDialog, setPayDialog] = useState(null);
  const [payAmount, setPayAmount] = useState("");
  const [createInvDialog, setCreateInvDialog] = useState(false);
  const [createEstDialog, setCreateEstDialog] = useState(false);
  const [recDialog, setRecDialog] = useState({ open: false, editing: null });
  const [emailDialog, setEmailDialog] = useState(null);
  const [emailForm, setEmailForm] = useState({ to_email: "", subject: "", message: "" });
  const [emailSending, setEmailSending] = useState(false);
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [payLinkDialog, setPayLinkDialog] = useState(null);
  const [payLinkResult, setPayLinkResult] = useState(null);
  const [generatingLink, setGeneratingLink] = useState(false);
  const [paymentLinks, setPaymentLinks] = useState([]);
  const [confirmingTransfer, setConfirmingTransfer] = useState(null);

  const emptyInvForm = { client_name: "", reference: "", due_date: "", line_items: [{ description: "", quantity: 1, unit_price: 0 }] };
  const emptyEstForm = { title: "", client_name: "", valid_until: "", notes: "", line_items: [{ description: "", quantity: 1, unit_price: 0 }] };
  const emptyRecForm = { client_name: "", description: "", frequency: "monthly", payment_terms: 14, contract_start: "", contract_end: "", escalation_percent: 0, auto_send: false, auto_generate: true, notes: "", email: "", tax_rate: 10, line_items: [{ description: "", quantity: 1, unit_price: 0 }] };

  const [invForm, setInvForm] = useState(emptyInvForm);
  const [estForm, setEstForm] = useState(emptyEstForm);
  const [recForm, setRecForm] = useState(emptyRecForm);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [dRes, iRes, cRes, aRes, eRes, rRes, sRes, fRes] = await Promise.all([
        axios.get(`${API}/xero/dashboard`, { headers }),
        axios.get(`${API}/xero/invoices`, { headers }),
        axios.get(`${API}/xero/contacts`, { headers }),
        axios.get(`${API}/xero/accounts`, { headers }),
        axios.get(`${API}/xero/estimates`, { headers }),
        axios.get(`${API}/xero/recurring`, { headers }),
        axios.get(`${API}/xero/sync-history`, { headers }),
        axios.get(`${API}/xero/recurring/forecast`, { headers }),
      ]);
      setDashboard(dRes.data); setInvoices(iRes.data); setContacts(cRes.data);
      setAccounts(aRes.data); setEstimates(eRes.data); setRecurring(rRes.data);
      setSyncHistory(sRes.data); setForecast(fRes.data);
      // Fetch payment links
      axios.get(`${API}/payment-links`, { headers }).then(r => setPaymentLinks(r.data)).catch(() => {});
    } catch { toast.error("Failed to load financial data"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const fetchBranding = async () => {
    try {
      const [tplRes, setRes, pdfThemesRes, activeThemeRes] = await Promise.all([
        axios.get(`${API}/doc-branding/templates`, { headers }),
        axios.get(`${API}/doc-branding/settings`, { headers }),
        axios.get(`${API}/invoice-themes`, { headers }),
        axios.get(`${API}/invoice-themes/active`, { headers }),
      ]);
      setBrandingTemplates(tplRes.data);
      setBrandingSettings(setRes.data);
      const current = setRes.data[activeBrandingDoc] || {};
      setBrandingForm(current);
      setPdfThemes(pdfThemesRes.data || []);
      setActivePdfTheme(activeThemeRes.data?.active_theme_id || "theme-modern");
    } catch {}
  };

  const handleSetPdfTheme = async (themeId) => {
    setSavingTheme(true);
    try {
      await axios.put(`${API}/invoice-themes/active`, { theme_id: themeId }, { headers });
      setActivePdfTheme(themeId);
      toast.success("Invoice PDF theme updated");
    } catch { toast.error("Failed to update theme"); }
    finally { setSavingTheme(false); }
  };

  const handleSaveBranding = async () => {
    setSavingBranding(true);
    try {
      await axios.put(`${API}/doc-branding/settings/${activeBrandingDoc}`, brandingForm, { headers });
      toast.success(`${activeBrandingDoc.replace("_", " ")} branding saved`);
      fetchBranding();
    } catch { toast.error("Failed to save branding"); }
    finally { setSavingBranding(false); }
  };

  const handlePreviewTemplate = async (templateId) => {
    try {
      const res = await axios.get(`${API}/doc-branding/preview/${templateId}?doc_type=${activeBrandingDoc}`, { headers });
      setBrandingPreview(res.data.preview_html);
    } catch { toast.error("Failed to generate preview"); }
  };

  const handleSync = async () => { setSyncing(true); try { await axios.post(`${API}/xero/sync`, {}, { headers }); toast.success("Xero sync completed"); fetchAll(); } catch { toast.error("Sync failed"); } finally { setSyncing(false); } };

  const handlePay = async () => { if (!payDialog || !payAmount) return; try { await axios.put(`${API}/xero/invoices/${payDialog.id}/pay`, { amount: parseFloat(payAmount) }, { headers }); toast.success("Payment recorded"); setPayDialog(null); setPayAmount(""); fetchAll(); } catch { toast.error("Payment failed"); } };

  const handleSendInvoice = async (inv) => { try { await axios.post(`${API}/xero/invoices/${inv.id}/send`, {}, { headers }); toast.success(`Invoice ${inv.invoice_number} sent`); fetchAll(); } catch { toast.error("Failed to send"); } };
  const handleVoidInvoice = async (inv) => { try { await axios.put(`${API}/xero/invoices/${inv.id}/void`, {}, { headers }); toast.success(`Invoice ${inv.invoice_number} voided`); fetchAll(); } catch { toast.error("Failed to void"); } };

  const handleCreateInvoice = async () => { if (!invForm.client_name) { toast.error("Client name required"); return; } try { await axios.post(`${API}/xero/invoices`, invForm, { headers }); toast.success("Invoice created"); setCreateInvDialog(false); setInvForm(emptyInvForm); fetchAll(); } catch { toast.error("Failed to create invoice"); } };
  const handleCreateEstimate = async () => { if (!estForm.title || !estForm.client_name) { toast.error("Title and client required"); return; } try { await axios.post(`${API}/xero/estimates`, estForm, { headers }); toast.success("Estimate created"); setCreateEstDialog(false); setEstForm(emptyEstForm); fetchAll(); } catch { toast.error("Failed to create estimate"); } };
  const handleConvertEstimate = async (est) => { try { await axios.post(`${API}/xero/estimates/${est.id}/convert`, {}, { headers }); toast.success(`Estimate ${est.estimate_number} converted to invoice`); fetchAll(); } catch { toast.error("Conversion failed"); } };

  // Recurring handlers
  const openRecDialog = (rec = null) => {
    if (rec) {
      setRecForm({ client_name: rec.client_name || "", description: rec.description || "", frequency: rec.frequency || "monthly", payment_terms: rec.payment_terms || 14, contract_start: rec.contract_start || "", contract_end: rec.contract_end || "", escalation_percent: rec.escalation_percent || 0, auto_send: rec.auto_send || false, auto_generate: rec.auto_generate !== false, notes: rec.notes || "", email: rec.email || "", tax_rate: rec.tax_rate || 10, line_items: rec.line_items?.length ? rec.line_items : [{ description: "", quantity: 1, unit_price: 0 }] });
      setRecDialog({ open: true, editing: rec });
    } else {
      setRecForm(emptyRecForm);
      setRecDialog({ open: true, editing: null });
    }
  };
  const handleSaveRecurring = async () => {
    if (!recForm.client_name || !recForm.description) { toast.error("Client and description required"); return; }
    try {
      if (recDialog.editing) {
        await axios.put(`${API}/xero/recurring/${recDialog.editing.id}`, recForm, { headers });
        toast.success("Recurring template updated");
      } else {
        await axios.post(`${API}/xero/recurring`, recForm, { headers });
        toast.success("Recurring template created");
      }
      setRecDialog({ open: false, editing: null }); setRecForm(emptyRecForm); fetchAll();
    } catch { toast.error("Failed to save recurring template"); }
  };
  const handleDeleteRecurring = async (rec) => { try { await axios.delete(`${API}/xero/recurring/${rec.id}`, { headers }); toast.success("Template deleted"); if (expandedRec?.id === rec.id) setExpandedRec(null); fetchAll(); } catch { toast.error("Failed to delete"); } };
  const handleToggleRecurring = async (rec) => { try { const res = await axios.put(`${API}/xero/recurring/${rec.id}/toggle`, {}, { headers }); toast.success(`Recurring invoice ${res.data.status}`); fetchAll(); } catch { toast.error("Failed to toggle"); } };
  const handleGenerateNow = async (rec) => { try { const res = await axios.post(`${API}/xero/recurring/${rec.id}/generate`, {}, { headers }); toast.success(`Invoice ${res.data.invoice_number} generated`); fetchAll(); } catch { toast.error("Failed to generate"); } };
  const handleBatchGenerate = async () => { setBatchGenerating(true); try { const res = await axios.post(`${API}/xero/recurring/batch-generate`, {}, { headers }); toast.success(res.data.message); fetchAll(); } catch { toast.error("Batch generate failed"); } finally { setBatchGenerating(false); } };
  const toggleExpandRec = async (rec) => {
    if (expandedRec?.id === rec.id) { setExpandedRec(null); return; }
    setExpandedRec(rec);
    try { const res = await axios.get(`${API}/xero/recurring/${rec.id}/history`, { headers }); setRecHistory(res.data); } catch { setRecHistory([]); }
  };

  // Email handler
  const openEmailDialog = (inv) => { setEmailDialog(inv); setEmailForm({ to_email: "", subject: `Invoice ${inv.invoice_number} from NexusOps`, message: `Please find attached invoice ${inv.invoice_number} for $${inv.total?.toLocaleString("en", { minimumFractionDigits: 2 })}.\n\nPayment is due by ${inv.due_date}.\n\nThank you for your business.` }); };
  const handleSendEmail = async () => {
    if (!emailForm.to_email) { toast.error("Recipient email required"); return; }
    setEmailSending(true);
    try {
      const res = await axios.post(`${API}/xero/invoices/${emailDialog.id}/email`, emailForm, { headers });
      toast.success(res.data.message || `Invoice emailed to ${emailForm.to_email}`);
      setEmailDialog(null); fetchAll();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to send email"); }
    finally { setEmailSending(false); }
  };

  // PDF viewer state
  const [pdfViewer, setPdfViewer] = useState({ open: false, url: "", title: "", downloadUrl: "", emailInvoiceId: null });

  // PDF download & preview
  const downloadPdf = (inv) => {
    const a = document.createElement("a");
    a.href = `${API}/invoices/${inv.id}/pdf/download?token=${token}`;
    a.target = "_blank";
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => document.body.removeChild(a), 200);
    toast.success(`Downloading ${inv.invoice_number}.pdf`);
  };
  const previewPdf = (inv) => {
    setPdfViewer({
      open: true,
      url: `${API}/invoices/${inv.id}/pdf?token=${token}`,
      title: `Invoice ${inv.invoice_number}`,
      downloadUrl: `${API}/invoices/${inv.id}/pdf/download?token=${token}`,
      emailInvoiceId: inv.id,
    });
  };
  const previewThemePdf = (themeId) => {
    setPdfViewer({
      open: true,
      url: `${API}/invoice-themes/${themeId}/preview-pdf?token=${token}`,
      title: `Theme Preview`,
      downloadUrl: "",
      emailInvoiceId: null,
    });
  };

  // Payment link generation
  const generatePaymentLink = async (inv) => {
    setGeneratingLink(true);
    setPayLinkResult(null);
    try {
      const res = await axios.post(`${API}/payment-links`, {
        invoice_id: inv.id,
        expires_days: 14,
        allowed_methods: ["card", "becs", "bank_transfer"],
      }, { headers });
      const linkUrl = `${window.location.origin}/pay/${res.data.token}`;
      setPayLinkResult({ ...res.data, url: linkUrl });
      setPayLinkDialog(inv);
      fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to generate payment link");
    } finally {
      setGeneratingLink(false);
    }
  };

  // Payment link management
  const revokePaymentLink = async (linkId) => {
    try {
      await axios.delete(`${API}/payment-links/${linkId}`, { headers });
      toast.success("Payment link revoked");
      fetchAll();
    } catch { toast.error("Failed to revoke link"); }
  };

  const confirmBankTransfer = async (linkId, paymentId) => {
    setConfirmingTransfer(paymentId);
    try {
      await axios.post(`${API}/payment-links/${linkId}/confirm-transfer`, { payment_id: paymentId }, { headers });
      toast.success("Bank transfer confirmed — invoice updated");
      fetchAll();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to confirm"); }
    finally { setConfirmingTransfer(null); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const d = dashboard || {};
  const fc = forecast || { mrr: 0, arr: 0, active_count: 0, forecast: [] };
  const filteredInvoices = invoices.filter(inv => (!invSearch || inv.client_name?.toLowerCase().includes(invSearch.toLowerCase()) || inv.invoice_number?.toLowerCase().includes(invSearch.toLowerCase())) && (invStatus === "all" || inv.status === invStatus));
  const filteredEstimates = estimates.filter(est => !estSearch || est.client_name?.toLowerCase().includes(estSearch.toLowerCase()) || est.title?.toLowerCase().includes(estSearch.toLowerCase()));
  const filteredRecurring = recurring.filter(r => (!recSearch || r.client_name?.toLowerCase().includes(recSearch.toLowerCase()) || r.description?.toLowerCase().includes(recSearch.toLowerCase())) && (recFilter === "all" || r.status === recFilter));
  const pieData = Object.entries(d.by_status || {}).map(([status, data]) => ({ name: status, value: data.count, total: data.total }));
  const aging = d.aging || {};
  const agingTotal = (aging.current || 0) + (aging["30_days"] || 0) + (aging["60_days"] || 0) + (aging["90_plus"] || 0);
  const dueCount = recurring.filter(r => r.status === "active" && r.next_generation <= new Date().toISOString().split("T")[0]).length;

  return (
    <div className="space-y-5" data-testid="xero-dashboard">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Finance Center</h1>
          <p className="text-muted-foreground">Xero-powered accounting, invoicing & recurring billing</p>
        </div>
        <div className="flex items-center gap-2">
          {d.last_sync && <span className="text-xs text-muted-foreground">Last sync: {new Date(d.last_sync).toLocaleString()}</span>}
          <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing} data-testid="sync-xero-btn">
            <RefreshCw className={`w-4 h-4 mr-1 ${syncing ? "animate-spin" : ""}`} />{syncing ? "Syncing..." : "Sync Xero"}
          </Button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: "Total Revenue", value: d.total_revenue, color: "text-emerald-400", bg: "bg-emerald-500/10", icon: TrendingUp },
          { label: "Collected", value: d.total_paid, color: "text-blue-400", bg: "bg-blue-500/10", icon: CheckCircle },
          { label: "Outstanding", value: d.total_outstanding, color: "text-amber-400", bg: "bg-amber-500/10", icon: Clock },
          { label: "Overdue", value: d.total_overdue, color: "text-red-400", bg: "bg-red-500/10", icon: AlertTriangle, danger: d.total_overdue > 0 },
          { label: "Recurring MRR", value: fc.mrr, color: "text-violet-400", bg: "bg-violet-500/10", icon: Repeat },
        ].map((s, i) => {
          const Icon = s.icon;
          return (
            <Card key={`stat-${i}`} className={s.danger ? "border-red-500/40" : ""} data-testid={`stat-${s.label.toLowerCase().replace(/\s/g, "-")}`}>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className={`text-2xl font-black ${s.color}`}>${(s.value || 0).toLocaleString("en", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
                    <p className="text-[11px] text-muted-foreground">{s.label}</p>
                  </div>
                  <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center`}><Icon className={`w-5 h-5 ${s.color}`} /></div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap h-auto w-full gap-1">
          <TabsTrigger value="overview" data-testid="tab-overview"><BarChart3 className="w-3 h-3 mr-1" />Overview</TabsTrigger>
          <TabsTrigger value="invoices" data-testid="tab-invoices"><Receipt className="w-3 h-3 mr-1" />Invoices ({invoices.length})</TabsTrigger>
          <TabsTrigger value="estimates" data-testid="tab-estimates"><FileText className="w-3 h-3 mr-1" />Estimates ({estimates.length})</TabsTrigger>
          <TabsTrigger value="recurring" data-testid="tab-recurring"><Repeat className="w-3 h-3 mr-1" />Recurring ({recurring.length})</TabsTrigger>
          <TabsTrigger value="contacts" data-testid="tab-contacts"><Users className="w-3 h-3 mr-1" />Contacts ({contacts.length})</TabsTrigger>
          <TabsTrigger value="accounts" data-testid="tab-accounts"><DollarSign className="w-3 h-3 mr-1" />Accounts ({accounts.length})</TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history"><History className="w-3 h-3 mr-1" />Sync Log</TabsTrigger>
          <TabsTrigger value="aging" data-testid="tab-aging"><AlertTriangle className="w-3 h-3 mr-1" />Aging</TabsTrigger>
          <TabsTrigger value="pay-links" data-testid="tab-pay-links"><Link2 className="w-3 h-3 mr-1" />Pay Links ({paymentLinks.length})</TabsTrigger>
          <TabsTrigger value="branding" data-testid="tab-branding" onClick={() => { if (!brandingTemplates.builtin.length) fetchBranding(); }}><Palette className="w-3 h-3 mr-1" />Branding</TabsTrigger>
        </TabsList>

        {/* ============ OVERVIEW TAB ============ */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Monthly Revenue</CardTitle></CardHeader>
              <CardContent>
                {(d.monthly_revenue || []).length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={d.monthly_revenue}>
                      <defs><linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.3} /><stop offset="95%" stopColor="#10b981" stopOpacity={0} /></linearGradient></defs>
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={v => [`$${v.toLocaleString()}`, "Revenue"]} /><Area type="monotone" dataKey="revenue" stroke="#10b981" fill="url(#revGrad)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : <div className="h-[220px] flex items-center justify-center text-muted-foreground">No revenue data</div>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Invoice Status Breakdown</CardTitle></CardHeader>
              <CardContent>
                {pieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <RePieChart><Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">{pieData.map((_, i) => <Cell key={`pie-${i}`} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}</Pie><Tooltip /><Legend /></RePieChart>
                  </ResponsiveContainer>
                ) : <div className="h-[220px] flex items-center justify-center text-muted-foreground">No invoice data</div>}
              </CardContent>
            </Card>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Collection Rate</CardTitle></CardHeader>
              <CardContent>
                <div className="flex items-center gap-4">
                  <div className="relative w-24 h-24">
                    <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
                      <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="8" className="text-muted/20" />
                      <circle cx="50" cy="50" r="40" fill="none" stroke={d.collection_rate >= 80 ? "#10b981" : d.collection_rate >= 50 ? "#f59e0b" : "#ef4444"} strokeWidth="8" strokeLinecap="round"
                        strokeDasharray={2 * Math.PI * 40} strokeDashoffset={2 * Math.PI * 40 * (1 - (d.collection_rate || 0) / 100)} style={{ transition: "stroke-dashoffset 1s ease-in-out" }} />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center"><span className="text-xl font-bold">{d.collection_rate || 0}%</span></div>
                  </div>
                  <div className="space-y-1 text-sm">
                    <p className="text-muted-foreground">Invoices: <span className="font-mono text-foreground">{d.invoice_count || 0}</span></p>
                    <p className="text-muted-foreground">Contacts: <span className="font-mono text-foreground">{d.contacts_count || 0}</span></p>
                    <p className="text-muted-foreground">Estimates: <span className="font-mono text-foreground">{d.estimates_count || 0}</span></p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Receivables Aging</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <AgingBar label="Current" amount={aging.current || 0} total={agingTotal} color="#10b981" />
                <AgingBar label="1-30 Days" amount={aging["30_days"] || 0} total={agingTotal} color="#f59e0b" />
                <AgingBar label="31-60 Days" amount={aging["60_days"] || 0} total={agingTotal} color="#f97316" />
                <AgingBar label="90+ Days" amount={aging["90_plus"] || 0} total={agingTotal} color="#ef4444" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Recent Activity</CardTitle></CardHeader>
              <CardContent>
                <ScrollArea className="h-[140px]">
                  <div className="space-y-2">
                    {syncHistory.slice(0, 6).map(e => (
                      <div key={e.id} className="flex items-start gap-2 text-xs">
                        <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${e.status === "success" ? "bg-emerald-400" : "bg-amber-400"}`} />
                        <div><p className="text-muted-foreground">{e.message}</p><p className="text-[10px] text-muted-foreground/60">{new Date(e.timestamp).toLocaleString()}</p></div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ============ INVOICES TAB ============ */}
        <TabsContent value="invoices" className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search invoices..." value={invSearch} onChange={e => setInvSearch(e.target.value)} data-testid="search-invoices" /></div>
            <Select value={invStatus} onValueChange={setInvStatus}><SelectTrigger className="w-[150px]" data-testid="inv-status-filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Status</SelectItem><SelectItem value="DRAFT">Draft</SelectItem><SelectItem value="AUTHORISED">Authorised</SelectItem><SelectItem value="PAID">Paid</SelectItem><SelectItem value="VOIDED">Voided</SelectItem></SelectContent></Select>
            <Button size="sm" onClick={() => setCreateInvDialog(true)} data-testid="create-invoice-btn"><Plus className="w-4 h-4 mr-1" />New Invoice</Button>
          </div>
          <Card>
            <ScrollArea className="h-[420px]">
              <Table>
                <TableHeader><TableRow><TableHead>Invoice #</TableHead><TableHead>Client</TableHead><TableHead>Date</TableHead><TableHead>Due</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Due</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                  {filteredInvoices.map(inv => {
                    const isOverdue = inv.status === "AUTHORISED" && inv.due_date < new Date().toISOString().split("T")[0];
                    return (
                      <TableRow key={inv.id} data-testid={`invoice-${inv.id}`}>
                        <TableCell className="font-mono text-sm">{inv.invoice_number}</TableCell>
                        <TableCell>{inv.client_name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{inv.date}</TableCell>
                        <TableCell className={`text-sm ${isOverdue ? "text-red-400 font-medium" : "text-muted-foreground"}`}>{inv.due_date}</TableCell>
                        <TableCell><StatusBadge status={isOverdue ? "OVERDUE" : inv.status} /></TableCell>
                        <TableCell className="text-right font-mono">${inv.total?.toLocaleString("en", { minimumFractionDigits: 2 })}</TableCell>
                        <TableCell className={`text-right font-mono ${inv.amount_due > 0 ? "text-amber-400" : "text-emerald-400"}`}>${inv.amount_due?.toLocaleString("en", { minimumFractionDigits: 2 })}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => previewPdf(inv)} title="Preview PDF" data-testid={`preview-${inv.id}`}><Eye className="w-3.5 h-3.5 text-violet-400" /></Button>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => downloadPdf(inv)} title="Download PDF" data-testid={`pdf-${inv.id}`}><Download className="w-3.5 h-3.5 text-blue-400" /></Button>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEmailDialog(inv)} title="Email Invoice" data-testid={`email-${inv.id}`}><Mail className="w-3.5 h-3.5 text-cyan-400" /></Button>
                            {inv.amount_due > 0 && inv.status !== "VOIDED" && <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => generatePaymentLink(inv)} title="Payment Link" disabled={generatingLink} data-testid={`paylink-${inv.id}`}><Link2 className="w-3.5 h-3.5 text-amber-400" /></Button>}
                            {inv.status === "DRAFT" && <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleSendInvoice(inv)} title="Mark Sent"><Send className="w-3.5 h-3.5 text-blue-400" /></Button>}
                            {inv.amount_due > 0 && inv.status !== "DRAFT" && inv.status !== "VOIDED" && <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setPayDialog(inv); setPayAmount(String(inv.amount_due)); }} title="Record Payment" data-testid={`pay-${inv.id}`}><CreditCard className="w-3.5 h-3.5 text-emerald-400" /></Button>}
                            {inv.status !== "PAID" && inv.status !== "VOIDED" && <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleVoidInvoice(inv)} title="Void"><Ban className="w-3.5 h-3.5 text-red-400" /></Button>}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          </Card>
        </TabsContent>

        {/* ============ ESTIMATES TAB ============ */}
        <TabsContent value="estimates" className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search estimates..." value={estSearch} onChange={e => setEstSearch(e.target.value)} data-testid="search-estimates" /></div>
            <Button size="sm" onClick={() => setCreateEstDialog(true)} data-testid="create-estimate-btn"><Plus className="w-4 h-4 mr-1" />New Estimate</Button>
          </div>
          <Card>
            <ScrollArea className="h-[420px]">
              <Table>
                <TableHeader><TableRow><TableHead>Estimate #</TableHead><TableHead>Title</TableHead><TableHead>Client</TableHead><TableHead>Status</TableHead><TableHead>Valid Until</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                <TableBody>
                  {filteredEstimates.map(est => (
                    <TableRow key={est.id} data-testid={`estimate-${est.id}`}>
                      <TableCell className="font-mono text-sm">{est.estimate_number}</TableCell><TableCell className="font-medium">{est.title}</TableCell><TableCell>{est.client_name}</TableCell>
                      <TableCell><StatusBadge status={est.status} /></TableCell><TableCell className="text-sm text-muted-foreground">{est.valid_until}</TableCell>
                      <TableCell className="text-right font-mono">${est.total?.toLocaleString("en", { minimumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setPdfViewer({ open: true, url: `${API}/estimates/${est.id}/pdf?token=${token}`, title: `Estimate ${est.estimate_number}`, downloadUrl: `${API}/estimates/${est.id}/pdf/download?token=${token}` })} title="Preview PDF"><Eye className="w-3.5 h-3.5 text-violet-400" /></Button>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { const a = document.createElement("a"); a.href = `${API}/estimates/${est.id}/pdf/download?token=${token}`; a.target = "_blank"; document.body.appendChild(a); a.click(); setTimeout(() => document.body.removeChild(a), 200); }} title="Download PDF"><Download className="w-3.5 h-3.5 text-blue-400" /></Button>
                          {est.status !== "CONVERTED" && est.status !== "DECLINED" && <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px]" onClick={() => handleConvertEstimate(est)} data-testid={`convert-${est.id}`}><ArrowRight className="w-3 h-3 mr-1 text-purple-400" />Convert</Button>}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </Card>
        </TabsContent>

        {/* ============ RECURRING TAB (ENHANCED) ============ */}
        <TabsContent value="recurring" className="space-y-4" data-testid="recurring-tab-content">
          {/* KPI row */}
          <div className="grid grid-cols-5 gap-3">
            {[
              { label: "Monthly MRR", value: fc.mrr, color: "text-violet-400", bg: "bg-violet-500/10", icon: Repeat },
              { label: "Annual ARR", value: fc.arr, color: "text-emerald-400", bg: "bg-emerald-500/10", icon: TrendingUp },
              { label: "Active Templates", value: fc.active_count, color: "text-blue-400", bg: "bg-blue-500/10", icon: FileText, isCurrency: false },
              { label: "Due for Generation", value: dueCount, color: dueCount > 0 ? "text-amber-400" : "text-zinc-400", bg: dueCount > 0 ? "bg-amber-500/10" : "bg-zinc-500/10", icon: CalendarDays, isCurrency: false },
              { label: "Total Templates", value: recurring.length, color: "text-zinc-400", bg: "bg-zinc-500/10", icon: Receipt, isCurrency: false },
            ].map((s, i) => {
              const Icon = s.icon;
              return (
                <Card key={`rec-stat-${i}`} data-testid={`rec-stat-${s.label.toLowerCase().replace(/\s/g, "-")}`}>
                  <CardContent className="pt-3 pb-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className={`text-xl font-black ${s.color}`}>{s.isCurrency !== false ? `$${(s.value || 0).toLocaleString("en", { minimumFractionDigits: 0 })}` : s.value}</p>
                        <p className="text-[10px] text-muted-foreground">{s.label}</p>
                      </div>
                      <div className={`w-8 h-8 rounded-lg ${s.bg} flex items-center justify-center`}><Icon className={`w-4 h-4 ${s.color}`} /></div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Forecast Chart */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">12-Month Revenue Forecast (Recurring Only)</CardTitle></CardHeader>
            <CardContent>
              {fc.forecast?.length > 0 ? (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={fc.forecast}>
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={v => [`$${v.toLocaleString()}`, "Projected"]} />
                    <Bar dataKey="projected" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <div className="h-[180px] flex items-center justify-center text-muted-foreground">No forecast data</div>}
            </CardContent>
          </Card>

          {/* Actions bar */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search templates..." value={recSearch} onChange={e => setRecSearch(e.target.value)} data-testid="search-recurring" /></div>
            <Select value={recFilter} onValueChange={setRecFilter}><SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Status</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="paused">Paused</SelectItem></SelectContent></Select>
            {dueCount > 0 && <Button size="sm" variant="outline" onClick={handleBatchGenerate} disabled={batchGenerating} data-testid="batch-generate-btn"><Zap className={`w-4 h-4 mr-1 ${batchGenerating ? "animate-pulse" : ""}`} />Generate Due ({dueCount})</Button>}
            <Button size="sm" onClick={() => openRecDialog()} data-testid="create-recurring-btn"><Plus className="w-4 h-4 mr-1" />New Template</Button>
          </div>

          {/* Template Cards */}
          <div className="space-y-2">
            {filteredRecurring.map(rec => {
              const isExpanded = expandedRec?.id === rec.id;
              const isDue = rec.status === "active" && rec.next_generation <= new Date().toISOString().split("T")[0];
              const collectionRate = rec.total_billed > 0 ? Math.round(((rec.total_collected || 0) / rec.total_billed) * 100) : 0;
              return (
                <Card key={rec.id} className={`transition-all ${isDue ? "border-amber-500/40" : ""} ${rec.status === "paused" ? "opacity-60" : ""}`} data-testid={`recurring-${rec.id}`}>
                  <CardContent className="py-3 px-4">
                    {/* Main Row */}
                    <div className="flex items-center gap-4 cursor-pointer" onClick={() => toggleExpandRec(rec)}>
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${rec.status === "active" ? "bg-violet-500/10" : "bg-muted/30"}`}>
                        <Repeat className={`w-5 h-5 ${rec.status === "active" ? "text-violet-400" : "text-muted-foreground"}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-sm">{rec.client_name}</p>
                          <Badge variant={rec.status === "active" ? "default" : "secondary"} className="text-[9px]">{rec.status}</Badge>
                          {isDue && <Badge className="bg-amber-500/15 text-amber-400 text-[9px] border-amber-500/30">DUE</Badge>}
                          {rec.auto_send && <Badge className="bg-cyan-500/10 text-cyan-400 text-[9px] border-cyan-500/30">AUTO-SEND</Badge>}
                          {rec.escalation_percent > 0 && <Badge className="bg-purple-500/10 text-purple-400 text-[9px] border-purple-500/30"><Percent className="w-2 h-2 mr-0.5" />{rec.escalation_percent}% p.a.</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground">{rec.description}</p>
                      </div>
                      <div className="flex items-center gap-5 flex-shrink-0">
                        <div className="text-right">
                          <p className="font-mono font-bold text-lg">${rec.amount?.toLocaleString()}<span className="text-xs text-muted-foreground font-normal">/{FREQ_SHORT[rec.frequency] || rec.frequency}</span></p>
                          <p className="text-[10px] text-muted-foreground">Next: {rec.next_generation} | {rec.invoices_generated}x generated</p>
                        </div>
                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleToggleRecurring(rec)} title={rec.status === "active" ? "Pause" : "Resume"}>
                            {rec.status === "active" ? <Pause className="w-3.5 h-3.5 text-amber-400" /> : <Play className="w-3.5 h-3.5 text-emerald-400" />}
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleGenerateNow(rec)} title="Generate Invoice Now" data-testid={`generate-${rec.id}`}>
                            <Zap className="w-3.5 h-3.5 text-violet-400" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openRecDialog(rec)} title="Edit"><Pencil className="w-3.5 h-3.5 text-blue-400" /></Button>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleDeleteRecurring(rec)} title="Delete"><Trash2 className="w-3.5 h-3.5 text-red-400" /></Button>
                        </div>
                        {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                      </div>
                    </div>
                    {/* Expanded Detail */}
                    {isExpanded && (
                      <div className="mt-4 pt-3 border-t space-y-4">
                        <div className="grid grid-cols-4 gap-4">
                          <div>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Contract Period</p>
                            <p className="text-sm font-mono">{rec.contract_start || "N/A"} {rec.contract_end ? `to ${rec.contract_end}` : "(Open-ended)"}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Payment Terms</p>
                            <p className="text-sm font-mono">{rec.payment_terms || 14} days</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Total Billed</p>
                            <p className="text-sm font-mono text-emerald-400">${(rec.total_billed || 0).toLocaleString()}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Collection Rate</p>
                            <p className={`text-sm font-mono ${collectionRate >= 80 ? "text-emerald-400" : collectionRate >= 50 ? "text-amber-400" : "text-red-400"}`}>{collectionRate}%</p>
                          </div>
                        </div>
                        {rec.notes && <div><p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Notes</p><p className="text-xs text-muted-foreground">{rec.notes}</p></div>}
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Line Items</p>
                          <div className="space-y-1">
                            {(rec.line_items || []).map((li, i) => (
                              <div key={`detail-li-${i}`} className="flex justify-between text-xs">
                                <span>{li.description}</span>
                                <span className="font-mono">{li.quantity} x ${li.unit_price?.toLocaleString()} = ${((li.quantity || 0) * (li.unit_price || 0)).toLocaleString()}</span>
                              </div>
                            ))}
                            <Separator className="my-1" />
                            <div className="flex justify-between text-xs font-medium"><span>Subtotal</span><span className="font-mono">${(rec.sub_total || 0).toLocaleString()}</span></div>
                            <div className="flex justify-between text-xs text-muted-foreground"><span>Tax ({rec.tax_rate || 10}%)</span><span className="font-mono">${(rec.tax || 0).toLocaleString()}</span></div>
                            <div className="flex justify-between text-sm font-bold"><span>Total</span><span className="font-mono">${(rec.amount || 0).toLocaleString()}</span></div>
                          </div>
                        </div>
                        {/* Generated Invoice History */}
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Generated Invoice History</p>
                          {recHistory.length > 0 ? (
                            <div className="space-y-1">
                              {recHistory.slice(0, 5).map(inv => (
                                <div key={inv.id} className="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-muted/10">
                                  <span className="font-mono">{inv.invoice_number}</span>
                                  <span className="text-muted-foreground">{inv.date}</span>
                                  <StatusBadge status={inv.status} />
                                  <span className="font-mono">${inv.total?.toLocaleString()}</span>
                                  <span className={`font-mono ${inv.amount_due > 0 ? "text-amber-400" : "text-emerald-400"}`}>{inv.amount_due > 0 ? `$${inv.amount_due?.toLocaleString()} due` : "Paid"}</span>
                                </div>
                              ))}
                            </div>
                          ) : <p className="text-xs text-muted-foreground">No invoices generated yet from this template</p>}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
            {filteredRecurring.length === 0 && <div className="text-center py-12 text-muted-foreground">No recurring templates found</div>}
          </div>
        </TabsContent>

        {/* ============ CONTACTS TAB ============ */}
        <TabsContent value="contacts">
          <Card><ScrollArea className="h-[420px]"><Table>
            <TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Account #</TableHead><TableHead>Xero ID</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Balance Due</TableHead><TableHead className="text-right">Overdue</TableHead></TableRow></TableHeader>
            <TableBody>
              {contacts.map(c => (
                <TableRow key={c.id} data-testid={`contact-${c.id}`}><TableCell className="font-medium">{c.client_name || c.name}</TableCell><TableCell className="font-mono text-sm">{c.account_number}</TableCell><TableCell className="font-mono text-xs text-muted-foreground">{c.xero_contact_id}</TableCell><TableCell><Badge className="bg-emerald-500/10 text-emerald-400 text-[10px]">{c.status}</Badge></TableCell><TableCell className="text-right font-mono">${c.balance_due?.toLocaleString("en", { minimumFractionDigits: 2 })}</TableCell><TableCell className={`text-right font-mono ${c.overdue_amount > 0 ? "text-red-400" : "text-muted-foreground"}`}>${c.overdue_amount?.toLocaleString("en", { minimumFractionDigits: 2 })}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table></ScrollArea></Card>
        </TabsContent>

        {/* ============ ACCOUNTS TAB ============ */}
        <TabsContent value="accounts">
          <Card><Table>
            <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Balance</TableHead></TableRow></TableHeader>
            <TableBody>
              {accounts.map(a => (<TableRow key={a.id} data-testid={`account-${a.id}`}><TableCell className="font-mono">{a.code}</TableCell><TableCell className="font-medium">{a.name}</TableCell><TableCell><Badge variant="outline" className="text-[10px]">{a.type}</Badge></TableCell><TableCell><Badge className="bg-emerald-500/10 text-emerald-400 text-[10px]">{a.status}</Badge></TableCell><TableCell className="text-right font-mono">${a.balance?.toLocaleString("en", { minimumFractionDigits: 2 })}</TableCell></TableRow>))}
            </TableBody>
          </Table></Card>
        </TabsContent>

        {/* ============ SYNC HISTORY TAB ============ */}
        <TabsContent value="history">
          <Card>
            <CardHeader className="pb-2"><div className="flex items-center justify-between"><CardTitle className="text-sm">Xero Sync History</CardTitle><Button size="sm" variant="outline" onClick={handleSync} disabled={syncing} data-testid="trigger-sync-btn"><RefreshCw className={`w-3 h-3 mr-1 ${syncing ? "animate-spin" : ""}`} />Trigger Sync</Button></div></CardHeader>
            <CardContent><ScrollArea className="h-[380px]"><div className="space-y-2">
              {syncHistory.map(e => (
                <div key={e.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted/20 transition-colors" data-testid={`sync-${e.id}`}>
                  <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${e.status === "success" ? "bg-emerald-400" : "bg-amber-400"}`} />
                  <div className="flex-1 min-w-0"><div className="flex items-center gap-2"><Badge variant="outline" className="text-[9px] px-1.5">{e.event_type}</Badge><span className="text-[10px] text-muted-foreground">{new Date(e.timestamp).toLocaleString()}</span></div><p className="text-sm mt-0.5">{e.message}</p></div>
                </div>
              ))}
            </div></ScrollArea></CardContent>
          </Card>
        </TabsContent>

        {/* ============ AGING TAB ============ */}
        <TabsContent value="aging" className="space-y-4">
          <div className="grid grid-cols-4 gap-3">
            {[{ label: "Current", amount: aging.current || 0, color: "text-emerald-400" }, { label: "1-30 Days", amount: aging["30_days"] || 0, color: "text-amber-400" }, { label: "31-60 Days", amount: aging["60_days"] || 0, color: "text-orange-400" }, { label: "90+ Days", amount: aging["90_plus"] || 0, color: "text-red-400" }].map((b, i) => (
              <Card key={`aging-${i}`}><CardContent className="pt-4 pb-3"><p className="text-[11px] text-muted-foreground">{b.label}</p><p className={`text-2xl font-black ${b.color}`}>${b.amount.toLocaleString("en", { minimumFractionDigits: 0 })}</p></CardContent></Card>
            ))}
          </div>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Overdue Invoices</CardTitle></CardHeader>
            <CardContent><Table>
              <TableHeader><TableRow><TableHead>Invoice #</TableHead><TableHead>Client</TableHead><TableHead>Due Date</TableHead><TableHead>Days Overdue</TableHead><TableHead className="text-right">Amount Due</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {invoices.filter(inv => inv.status === "AUTHORISED" && inv.due_date < new Date().toISOString().split("T")[0]).map(inv => {
                  const daysOverdue = Math.floor((new Date() - new Date(inv.due_date)) / (1000 * 60 * 60 * 24));
                  return (
                    <TableRow key={inv.id}><TableCell className="font-mono">{inv.invoice_number}</TableCell><TableCell>{inv.client_name}</TableCell><TableCell className="text-red-400">{inv.due_date}</TableCell><TableCell><Badge variant="destructive" className="text-[10px]">{daysOverdue}d overdue</Badge></TableCell><TableCell className="text-right font-mono text-red-400">${inv.amount_due?.toLocaleString("en", { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell className="text-right"><div className="flex items-center justify-end gap-1"><Button variant="ghost" size="sm" className="h-7 px-2 text-[10px]" onClick={() => openEmailDialog(inv)}><Mail className="w-3 h-3 mr-1" />Send Reminder</Button><Button variant="ghost" size="sm" className="h-7 px-2 text-[10px]" onClick={() => { setPayDialog(inv); setPayAmount(String(inv.amount_due)); }}><CreditCard className="w-3 h-3 mr-1" />Record Payment</Button></div></TableCell></TableRow>
                  );
                })}
                {invoices.filter(inv => inv.status === "AUTHORISED" && inv.due_date < new Date().toISOString().split("T")[0]).length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No overdue invoices</TableCell></TableRow>}
              </TableBody>
            </Table></CardContent>
          </Card>
        </TabsContent>

        {/* ============ PAYMENT LINKS TAB ============ */}
        <TabsContent value="pay-links" className="space-y-4" data-testid="pay-links-tab">
          {/* Summary Stats */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: "Active Links", value: paymentLinks.filter(l => l.status === "active").length, color: "text-blue-400", bg: "bg-blue-500/10" },
              { label: "Completed", value: paymentLinks.filter(l => l.status === "completed").length, color: "text-emerald-400", bg: "bg-emerald-500/10" },
              { label: "Pending Transfers", value: paymentLinks.reduce((n, l) => n + (l.payments || []).filter(p => p.status === "awaiting_confirmation").length, 0), color: "text-amber-400", bg: "bg-amber-500/10" },
              { label: "Expired / Revoked", value: paymentLinks.filter(l => l.status === "expired" || l.status === "revoked").length, color: "text-red-400", bg: "bg-red-500/10" },
            ].map(s => (
              <Card key={s.label} className="border-border/30">
                <CardContent className="pt-4 pb-4 text-center">
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Pending Bank Transfers Queue */}
          {paymentLinks.some(l => (l.payments || []).some(p => p.status === "awaiting_confirmation")) && (
            <Card className="border-amber-500/30 bg-amber-500/5" data-testid="pending-transfers-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2"><Clock className="w-4 h-4 text-amber-400" />Pending Bank Transfer Confirmations</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead className="text-xs">Invoice</TableHead>
                    <TableHead className="text-xs">Payer</TableHead>
                    <TableHead className="text-xs">Reference</TableHead>
                    <TableHead className="text-xs">Bank</TableHead>
                    <TableHead className="text-xs text-right">Amount</TableHead>
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs text-right">Action</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {paymentLinks.flatMap(link => 
                      (link.payments || []).filter(p => p.status === "awaiting_confirmation").map(p => (
                        <TableRow key={p.id}>
                          <TableCell className="font-mono text-xs font-bold">{link.invoice_number}</TableCell>
                          <TableCell className="text-xs">{p.payer_name || "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{p.reference || "—"}</TableCell>
                          <TableCell className="text-xs">{p.bank_name || "—"}</TableCell>
                          <TableCell className="text-right font-mono text-xs font-bold text-amber-400">${p.amount?.toFixed(2)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{p.initiated_at ? new Date(p.initiated_at).toLocaleDateString() : "—"}</TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" className="h-7 text-xs" onClick={() => confirmBankTransfer(link.id, p.id)} disabled={confirmingTransfer === p.id} data-testid={`confirm-transfer-${p.id}`}>
                              {confirmingTransfer === p.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <CheckCircle className="w-3 h-3 mr-1" />}Confirm
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* All Payment Links Table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">All Payment Links</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="text-xs">Invoice</TableHead>
                  <TableHead className="text-xs">Client</TableHead>
                  <TableHead className="text-xs">Balance</TableHead>
                  <TableHead className="text-xs">Payments</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Methods</TableHead>
                  <TableHead className="text-xs">Expires</TableHead>
                  <TableHead className="text-xs">Created</TableHead>
                  <TableHead className="text-xs text-right">Actions</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {paymentLinks.length === 0 ? (
                    <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No payment links generated yet. Click the link icon on any invoice to create one.</TableCell></TableRow>
                  ) : paymentLinks.map(link => {
                    const paidTotal = (link.payments || []).filter(p => p.status === "paid").reduce((s, p) => s + (p.amount || 0), 0);
                    const pendingTotal = (link.payments || []).filter(p => p.status === "awaiting_confirmation").reduce((s, p) => s + (p.amount || 0), 0);
                    const statusColors = { active: "bg-blue-500/20 text-blue-400", completed: "bg-emerald-500/20 text-emerald-400", expired: "bg-red-500/20 text-red-400", revoked: "bg-zinc-500/20 text-zinc-400" };
                    return (
                      <TableRow key={link.id} data-testid={`paylink-row-${link.id}`}>
                        <TableCell className="font-mono text-xs font-bold">{link.invoice_number}</TableCell>
                        <TableCell className="text-xs">{link.client_name}</TableCell>
                        <TableCell className="text-xs">
                          <span className="font-mono">${link.balance_at_creation?.toFixed(2)}</span>
                          {paidTotal > 0 && <span className="text-emerald-400 ml-1 text-[10px]">(-${paidTotal.toFixed(2)} paid)</span>}
                          {pendingTotal > 0 && <span className="text-amber-400 ml-1 text-[10px]">(${pendingTotal.toFixed(2)} pending)</span>}
                        </TableCell>
                        <TableCell className="text-xs">{(link.payments || []).length} txn{(link.payments || []).length !== 1 ? "s" : ""}</TableCell>
                        <TableCell><Badge className={`text-[10px] ${statusColors[link.status] || "bg-muted"}`}>{link.status}</Badge></TableCell>
                        <TableCell className="text-[10px]">{(link.allowed_methods || []).map(m => m === "bank_transfer" ? "Bank" : m === "becs" ? "BECS" : "Card").join(", ")}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{link.expires_at ? new Date(link.expires_at).toLocaleDateString() : "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{link.created_at ? new Date(link.created_at).toLocaleDateString() : "—"}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {link.status === "active" && (
                              <>
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Copy Link" onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/pay/${link.token}`); toast.success("Payment link copied"); }} data-testid={`copy-link-${link.id}`}><Copy className="w-3.5 h-3.5" /></Button>
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-400" title="Revoke" onClick={() => revokePaymentLink(link.id)} data-testid={`revoke-link-${link.id}`}><XCircle className="w-3.5 h-3.5" /></Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============ BRANDING TAB ============ */}
        <TabsContent value="branding" className="space-y-4" data-testid="branding-tab-content">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold">Document Branding & Templates</h3>
              <p className="text-sm text-muted-foreground">Customize the look of your invoices, purchase orders, estimates, and letterheads</p>
            </div>
          </div>

          {/* Doc Type Selector */}
          <div className="flex gap-2">
            {[
              { key: "invoice", label: "Invoice", icon: Receipt },
              { key: "purchase_order", label: "Purchase Order", icon: CreditCard },
              { key: "estimate", label: "Estimate", icon: FileText },
              { key: "letterhead", label: "Letterhead", icon: FileText },
            ].map(dt => (
              <Button key={dt.key} variant={activeBrandingDoc === dt.key ? "default" : "outline"} size="sm" onClick={() => {
                setActiveBrandingDoc(dt.key);
                setBrandingForm(brandingSettings[dt.key] || {});
                setBrandingPreview(null);
              }} data-testid={`branding-doc-${dt.key}`}>
                <dt.icon className="w-3 h-3 mr-1" />{dt.label}
              </Button>
            ))}
          </div>

          <div className="grid grid-cols-[1fr_350px] gap-4">
            {/* Settings Form */}
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm">Company Details & Settings</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-xs">Company Name</Label><Input value={brandingForm.company_name || ""} onChange={e => setBrandingForm(p => ({...p, company_name: e.target.value}))} placeholder="Your Company Pty Ltd" data-testid="branding-company-name" /></div>
                  <div><Label className="text-xs">ABN / Tax ID</Label><Input value={brandingForm.company_abn || ""} onChange={e => setBrandingForm(p => ({...p, company_abn: e.target.value}))} placeholder="12 345 678 901" /></div>
                </div>
                <div><Label className="text-xs">Company Address</Label><Input value={brandingForm.company_address || ""} onChange={e => setBrandingForm(p => ({...p, company_address: e.target.value}))} placeholder="123 Business St, Suite 100, Sydney NSW 2000" /></div>
                <div className="grid grid-cols-3 gap-3">
                  <div><Label className="text-xs">Phone</Label><Input value={brandingForm.company_phone || ""} onChange={e => setBrandingForm(p => ({...p, company_phone: e.target.value}))} placeholder="+61 2 9000 0000" /></div>
                  <div><Label className="text-xs">Email</Label><Input value={brandingForm.company_email || ""} onChange={e => setBrandingForm(p => ({...p, company_email: e.target.value}))} placeholder="accounts@company.com" /></div>
                  <div><Label className="text-xs">Website</Label><Input value={brandingForm.company_website || ""} onChange={e => setBrandingForm(p => ({...p, company_website: e.target.value}))} placeholder="https://company.com" /></div>
                </div>
                <Separator />
                <div><Label className="text-xs">Footer Text</Label><Input value={brandingForm.footer_text || ""} onChange={e => setBrandingForm(p => ({...p, footer_text: e.target.value}))} placeholder="Thank you for your business" /></div>
                <div><Label className="text-xs">Payment Instructions</Label><Textarea rows={2} value={brandingForm.payment_instructions || ""} onChange={e => setBrandingForm(p => ({...p, payment_instructions: e.target.value}))} placeholder="Bank: ANZ | BSB: 012-345 | Acc: 1234 5678" /></div>
                <div><Label className="text-xs">Bank Details</Label><Input value={brandingForm.bank_details || ""} onChange={e => setBrandingForm(p => ({...p, bank_details: e.target.value}))} placeholder="BSB: 012-345 | Account: 1234 5678" /></div>
                <div><Label className="text-xs">Terms & Conditions</Label><Textarea rows={2} value={brandingForm.terms_conditions || ""} onChange={e => setBrandingForm(p => ({...p, terms_conditions: e.target.value}))} placeholder="Payment due within 30 days..." /></div>
                <Button onClick={handleSaveBranding} disabled={savingBranding} className="w-full" data-testid="save-branding-btn">
                  {savingBranding ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-1" />}
                  Save {activeBrandingDoc.replace("_", " ")} Settings
                </Button>
              </CardContent>
            </Card>

            {/* Template Selection + Preview */}
            <div className="space-y-3">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Select Template</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {(brandingTemplates.builtin || []).map(tpl => (
                    <div key={tpl.id}
                      onClick={() => { setBrandingForm(p => ({...p, active_template_id: tpl.id})); handlePreviewTemplate(tpl.id); }}
                      className={`p-3 rounded-lg border cursor-pointer transition-all ${brandingForm.active_template_id === tpl.id ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-border/40 hover:border-border"}`}
                      data-testid={`tpl-select-${tpl.id}`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-sm">{tpl.name}</p>
                          <p className="text-xs text-muted-foreground">{tpl.description}</p>
                        </div>
                        <div className="flex gap-1">
                          {Object.values(tpl.color_scheme || {}).slice(0, 3).map((c, i) => (
                            <div key={`cs-${i}`} className="w-4 h-4 rounded-full border border-border/50" style={{ backgroundColor: c }} />
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                  {(brandingTemplates.custom || []).map(tpl => (
                    <div key={tpl.id}
                      onClick={() => { setBrandingForm(p => ({...p, active_template_id: tpl.id})); handlePreviewTemplate(tpl.id); }}
                      className={`p-3 rounded-lg border cursor-pointer transition-all ${brandingForm.active_template_id === tpl.id ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-border/40 hover:border-border"}`}
                    >
                      <div className="flex items-center justify-between">
                        <div><p className="font-semibold text-sm">{tpl.name}</p><p className="text-xs text-muted-foreground">{tpl.description}</p></div>
                        <Badge variant="outline" className="text-[9px]">Custom</Badge>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {brandingPreview && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Eye className="w-3 h-3" />Preview</CardTitle></CardHeader>
                  <CardContent>
                    <div className="border rounded-lg overflow-hidden" style={{ transform: "scale(0.55)", transformOrigin: "top left", height: "420px", width: "182%" }}>
                      <div dangerouslySetInnerHTML={{ __html: brandingPreview }} />
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>

          {/* Invoice PDF Theme Picker */}
          <Separator className="my-4" />
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-lg font-bold flex items-center gap-2"><Palette className="w-5 h-5" />Invoice PDF Theme</h3>
                <p className="text-sm text-muted-foreground">Choose the visual style for generated PDF invoices</p>
              </div>
              {savingTheme && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            </div>
            <div className="grid grid-cols-5 gap-3" data-testid="pdf-theme-grid">
              {pdfThemes.map(theme => {
                const isActive = activePdfTheme === theme.id;
                const colors = theme.preview_colors || {};
                return (
                  <div key={theme.id}
                    onClick={() => handleSetPdfTheme(theme.id)}
                    className={`relative rounded-xl border-2 cursor-pointer transition-all overflow-hidden ${isActive ? "border-primary ring-2 ring-primary/30 shadow-lg" : "border-border/40 hover:border-border hover:shadow-md"}`}
                    data-testid={`pdf-theme-${theme.id}`}
                  >
                    {/* Mini preview */}
                    <div className="h-24 relative">
                      <div className="absolute inset-x-0 top-0 h-8" style={{ backgroundColor: colors.header || "#10b981" }} />
                      <div className="absolute inset-x-0 top-8 h-1" style={{ backgroundColor: colors.accent || "#06b6d4" }} />
                      <div className="absolute left-2 top-1.5 w-4 h-4 rounded bg-white/30" />
                      <div className="absolute left-7 top-2 h-2 w-12 rounded bg-white/40" />
                      <div className="absolute right-2 top-2 h-2 w-8 rounded bg-white/20" />
                      {/* Line items mock */}
                      <div className="absolute inset-x-2 top-11 space-y-1">
                        <div className="h-1.5 rounded bg-muted-foreground/10" />
                        <div className="h-1.5 rounded bg-muted-foreground/5 w-4/5" />
                        <div className="h-1.5 rounded bg-muted-foreground/10" />
                        <div className="h-1.5 rounded bg-muted-foreground/5 w-3/5" />
                      </div>
                      {/* Total */}
                      <div className="absolute bottom-1 right-2 h-2 w-10 rounded" style={{ backgroundColor: colors.accent || "#06b6d4", opacity: 0.3 }} />
                    </div>
                    {/* Label */}
                    <div className="p-2 bg-card">
                      <div className="flex items-center justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-xs truncate">{theme.name}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{theme.description}</p>
                        </div>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 flex-shrink-0" onClick={e => { e.stopPropagation(); previewThemePdf(theme.id); }} title="Preview PDF" data-testid={`theme-preview-${theme.id}`}>
                          <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                      {isActive && <Badge className="mt-1 bg-primary/10 text-primary border-primary/20 text-[9px]">Active</Badge>}
                      {!theme.is_builtin && <Badge variant="outline" className="mt-1 text-[9px] ml-1">Custom</Badge>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* ============ DIALOGS ============ */}

      {/* Pay Dialog */}
      <Dialog open={!!payDialog} onOpenChange={v => { if (!v) setPayDialog(null); }}>
        <DialogContent><DialogHeader><DialogTitle>Record Payment - {payDialog?.invoice_number}</DialogTitle><DialogDescription>Record a payment against this invoice</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Client: {payDialog?.client_name}</p>
            <p className="text-sm">Total: <span className="font-mono font-bold">${payDialog?.total?.toLocaleString("en", { minimumFractionDigits: 2 })}</span></p>
            <p className="text-sm">Due: <span className="font-mono font-bold text-amber-400">${payDialog?.amount_due?.toLocaleString("en", { minimumFractionDigits: 2 })}</span></p>
            <div><Label>Payment Amount</Label><Input type="number" step="0.01" value={payAmount} onChange={e => setPayAmount(e.target.value)} data-testid="pay-amount" /></div>
          </div>
          <DialogFooter><Button onClick={handlePay} data-testid="confirm-pay-btn"><CreditCard className="w-4 h-4 mr-1" />Record Payment</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Email Invoice Dialog */}
      <Dialog open={!!emailDialog} onOpenChange={v => { if (!v) setEmailDialog(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Email Invoice - {emailDialog?.invoice_number}</DialogTitle><DialogDescription>Send this invoice to the client via email</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <Card className="bg-muted/10"><CardContent className="py-3 px-4">
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Client:</span><span className="font-medium">{emailDialog?.client_name}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Amount:</span><span className="font-mono font-bold">${emailDialog?.total?.toLocaleString("en", { minimumFractionDigits: 2 })}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Due Date:</span><span>{emailDialog?.due_date}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Status:</span><StatusBadge status={emailDialog?.status || "DRAFT"} /></div>
            </CardContent></Card>
            <div><Label>Recipient Email *</Label><Input type="email" value={emailForm.to_email} onChange={e => setEmailForm(p => ({ ...p, to_email: e.target.value }))} placeholder="client@company.com" data-testid="email-to" /></div>
            <div><Label>Subject</Label><Input value={emailForm.subject} onChange={e => setEmailForm(p => ({ ...p, subject: e.target.value }))} /></div>
            <div><Label>Message</Label><Textarea rows={4} value={emailForm.message} onChange={e => setEmailForm(p => ({ ...p, message: e.target.value }))} /></div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Shield className="w-3 h-3" />Invoice PDF will be auto-attached (Resend integration)</div>
          </div>
          <DialogFooter><Button onClick={handleSendEmail} disabled={emailSending} data-testid="send-email-btn">{emailSending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Mail className="w-4 h-4 mr-1" />}{emailSending ? "Sending..." : "Send Invoice Email"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Invoice Dialog */}
      <Dialog open={createInvDialog} onOpenChange={setCreateInvDialog}>
        <DialogContent className="max-w-lg"><DialogHeader><DialogTitle>New Invoice</DialogTitle><DialogDescription>Create a new Xero invoice</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div><Label>Client Name *</Label><Input value={invForm.client_name} onChange={e => setInvForm(p => ({ ...p, client_name: e.target.value }))} data-testid="inv-client" /></div>
            <div className="grid grid-cols-2 gap-3"><div><Label>Reference</Label><Input value={invForm.reference} onChange={e => setInvForm(p => ({ ...p, reference: e.target.value }))} /></div><div><Label>Due Date</Label><Input type="date" value={invForm.due_date} onChange={e => setInvForm(p => ({ ...p, due_date: e.target.value }))} /></div></div>
            <Separator />
            <LineItemsEditor items={invForm.line_items} onChange={items => setInvForm(p => ({ ...p, line_items: items }))} />
          </div>
          <DialogFooter><Button onClick={handleCreateInvoice} data-testid="submit-invoice-btn"><Plus className="w-4 h-4 mr-1" />Create Invoice</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Estimate Dialog */}
      <Dialog open={createEstDialog} onOpenChange={setCreateEstDialog}>
        <DialogContent className="max-w-lg"><DialogHeader><DialogTitle>New Estimate</DialogTitle><DialogDescription>Create a new project estimate</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div><Label>Title *</Label><Input value={estForm.title} onChange={e => setEstForm(p => ({ ...p, title: e.target.value }))} data-testid="est-title" /></div>
            <div className="grid grid-cols-2 gap-3"><div><Label>Client Name *</Label><Input value={estForm.client_name} onChange={e => setEstForm(p => ({ ...p, client_name: e.target.value }))} data-testid="est-client" /></div><div><Label>Valid Until</Label><Input type="date" value={estForm.valid_until} onChange={e => setEstForm(p => ({ ...p, valid_until: e.target.value }))} /></div></div>
            <div><Label>Notes</Label><Textarea rows={2} value={estForm.notes} onChange={e => setEstForm(p => ({ ...p, notes: e.target.value }))} /></div>
            <Separator />
            <LineItemsEditor items={estForm.line_items} onChange={items => setEstForm(p => ({ ...p, line_items: items }))} />
          </div>
          <DialogFooter><Button onClick={handleCreateEstimate} data-testid="submit-estimate-btn"><Plus className="w-4 h-4 mr-1" />Create Estimate</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Recurring Template Dialog (Create/Edit) */}
      <Dialog open={recDialog.open} onOpenChange={v => { if (!v) setRecDialog({ open: false, editing: null }); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{recDialog.editing ? "Edit Recurring Template" : "New Recurring Template"}</DialogTitle><DialogDescription>Configure automated recurring invoicing for a client</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Client Name *</Label><Input value={recForm.client_name} onChange={e => setRecForm(p => ({ ...p, client_name: e.target.value }))} data-testid="rec-client" /></div>
              <div><Label>Billing Email</Label><Input type="email" value={recForm.email} onChange={e => setRecForm(p => ({ ...p, email: e.target.value }))} placeholder="billing@client.com" /></div>
            </div>
            <div><Label>Service Description *</Label><Input value={recForm.description} onChange={e => setRecForm(p => ({ ...p, description: e.target.value }))} placeholder="e.g. Managed IT Services - Monthly" /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Frequency</Label>
                <Select value={recForm.frequency} onValueChange={v => setRecForm(p => ({ ...p, frequency: v }))}>
                  <SelectTrigger data-testid="rec-frequency"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="weekly">Weekly</SelectItem><SelectItem value="fortnightly">Fortnightly</SelectItem><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="quarterly">Quarterly</SelectItem><SelectItem value="yearly">Annually</SelectItem></SelectContent>
                </Select>
              </div>
              <div><Label>Payment Terms (days)</Label><Input type="number" value={recForm.payment_terms} onChange={e => setRecForm(p => ({ ...p, payment_terms: Number(e.target.value) }))} /></div>
              <div><Label>Tax Rate (%)</Label><Input type="number" step="0.1" value={recForm.tax_rate} onChange={e => setRecForm(p => ({ ...p, tax_rate: Number(e.target.value) }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Contract Start</Label><Input type="date" value={recForm.contract_start} onChange={e => setRecForm(p => ({ ...p, contract_start: e.target.value }))} /></div>
              <div><Label>Contract End <span className="text-muted-foreground text-xs">(leave blank for open-ended)</span></Label><Input type="date" value={recForm.contract_end} onChange={e => setRecForm(p => ({ ...p, contract_end: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Annual Escalation (%)</Label><Input type="number" step="0.5" value={recForm.escalation_percent} onChange={e => setRecForm(p => ({ ...p, escalation_percent: Number(e.target.value) }))} /><p className="text-[10px] text-muted-foreground mt-0.5">Auto price increase on anniversary</p></div>
              <div className="flex flex-col justify-center gap-2">
                <div className="flex items-center gap-2"><Switch checked={recForm.auto_generate} onCheckedChange={v => setRecForm(p => ({ ...p, auto_generate: v }))} /><Label className="text-sm">Auto-generate invoices</Label></div>
              </div>
              <div className="flex flex-col justify-center gap-2">
                <div className="flex items-center gap-2"><Switch checked={recForm.auto_send} onCheckedChange={v => setRecForm(p => ({ ...p, auto_send: v }))} /><Label className="text-sm">Auto-send to client</Label></div>
              </div>
            </div>
            <div><Label>Internal Notes</Label><Textarea rows={2} value={recForm.notes} onChange={e => setRecForm(p => ({ ...p, notes: e.target.value }))} placeholder="Service level details, contract terms, etc." /></div>
            <Separator />
            <LineItemsEditor items={recForm.line_items} onChange={items => setRecForm(p => ({ ...p, line_items: items }))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecDialog({ open: false, editing: null })}>Cancel</Button>
            <Button onClick={handleSaveRecurring} data-testid="submit-recurring-btn">{recDialog.editing ? <><Pencil className="w-4 h-4 mr-1" />Update Template</> : <><Plus className="w-4 h-4 mr-1" />Create Template</>}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment Link Dialog */}
      <Dialog open={!!payLinkDialog} onOpenChange={v => { if (!v) { setPayLinkDialog(null); setPayLinkResult(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Link2 className="w-5 h-5 text-amber-400" />Payment Link Generated</DialogTitle>
            <DialogDescription>One-time payment link for {payLinkDialog?.invoice_number}</DialogDescription>
          </DialogHeader>
          {payLinkResult && (
            <div className="space-y-4">
              <Card className="bg-muted/10"><CardContent className="py-3 px-4 space-y-1">
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Invoice:</span><span className="font-mono font-bold">{payLinkResult.invoice_number}</span></div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Balance:</span><span className="font-mono text-amber-400">${payLinkResult.balance_at_creation?.toFixed(2)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Expires:</span><span className="text-xs">{new Date(payLinkResult.expires_at).toLocaleDateString()}</span></div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Methods:</span><span className="text-xs">Card, BECS, Bank Transfer</span></div>
              </CardContent></Card>
              <div className="space-y-2">
                <Label className="text-xs">Payment Link URL</Label>
                <div className="flex gap-2">
                  <Input value={payLinkResult.url} readOnly className="font-mono text-xs" data-testid="payment-link-url" />
                  <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(payLinkResult.url); toast.success("Link copied!"); }} data-testid="copy-payment-link"><Copy className="w-4 h-4" /></Button>
                </div>
                <p className="text-[10px] text-muted-foreground">Share this link with your client. They can pay via card, BECS direct debit, or manual bank transfer. The link expires after {payLinkResult.expires_days} days or once fully paid.</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPayLinkDialog(null); setPayLinkResult(null); }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PDF Viewer Dialog */}
      <PdfViewerDialog
        open={pdfViewer.open}
        onOpenChange={v => setPdfViewer(p => ({ ...p, open: v }))}
        pdfUrl={pdfViewer.url}
        title={pdfViewer.title}
        downloadUrl={pdfViewer.downloadUrl}
        onEmail={pdfViewer.emailInvoiceId ? async (email) => {
          try {
            await axios.post(`${API}/xero/invoices/${pdfViewer.emailInvoiceId}/email`, { to_email: email, subject: `Invoice - ${pdfViewer.title}`, message: `Please find attached ${pdfViewer.title}.` }, { headers });
            toast.success(`Email sent to ${email}`);
          } catch { toast.error("Failed to send email"); }
        } : undefined}
      />
    </div>
  );
}
