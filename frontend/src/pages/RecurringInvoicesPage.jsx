import { useState, useEffect, useCallback, Fragment } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  RefreshCw, Plus, Trash2, Play, Pause, Edit, DollarSign, Calendar,
  Receipt, TrendingUp, Loader2, Copy, Send, Clock, FileText, Users,
  CheckCircle, AlertTriangle, Zap, ChevronRight, Eye, BarChart3, Search, Cloud, Sparkles
} from "lucide-react";
import ReconcileDialog from "@/components/billing/ReconcileDialog";
import RecurringSmartActions, { ConsolidateButton } from "@/components/billing/RecurringSmartActions";
import HeroTile from "@/components/HeroTile";
import OperationalPageHeader from "@/components/OperationalPageHeader";

const FREQ_LABELS = { weekly: "Weekly", fortnightly: "Fortnightly", monthly: "Monthly", quarterly: "Quarterly", annually: "Annually" };
const TERMS_LABELS = { due_on_receipt: "Due on Receipt", net_7: "Net 7", net_14: "Net 14", net_30: "Net 30", net_45: "Net 45", net_60: "Net 60", net_90: "Net 90" };
const STATUS_STYLES = { active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", paused: "bg-amber-500/10 text-amber-400 border-amber-500/20", cancelled: "bg-red-500/10 text-red-400 border-red-500/20" };

const WORKFLOW_TONES = {
  emerald: { border: "border-emerald-400/25", background: "bg-[radial-gradient(circle_at_top_right,rgba(52,211,153,0.17),transparent_45%),linear-gradient(135deg,rgba(16,185,129,0.10),transparent)]", icon: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300", eyebrow: "text-emerald-300", badge: "border-emerald-500/30 bg-emerald-500/5 text-emerald-300" },
  cyan: { border: "border-cyan-400/25", background: "bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.17),transparent_45%),linear-gradient(135deg,rgba(6,182,212,0.10),transparent)]", icon: "border-cyan-400/25 bg-cyan-400/10 text-cyan-300", eyebrow: "text-cyan-300", badge: "border-cyan-400/30 bg-cyan-400/5 text-cyan-200" },
  violet: { border: "border-violet-400/25", background: "bg-[radial-gradient(circle_at_top_right,rgba(167,139,250,0.18),transparent_45%),linear-gradient(135deg,rgba(124,58,237,0.12),transparent)]", icon: "border-violet-400/25 bg-violet-400/10 text-violet-300", eyebrow: "text-violet-300", badge: "border-violet-400/30 bg-violet-400/5 text-violet-200" },
};

function WorkflowDialogHeader({ icon: Icon = RefreshCw, eyebrow, title, description, badge, tone = "emerald" }) {
  const palette = WORKFLOW_TONES[tone] || WORKFLOW_TONES.emerald;
  return (
    <DialogHeader className={`shrink-0 border-b border-white/[0.07] px-6 py-5 text-left ${palette.background}`}>
      <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${palette.eyebrow}`}>{eyebrow}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl border ${palette.icon}`}><Icon className="h-4 w-4" /></span>
        <DialogTitle className="text-2xl tracking-tight text-zinc-100">{title}</DialogTitle>
        {badge && <Badge variant="outline" className={`text-[10px] ${palette.badge}`}>{badge}</Badge>}
      </div>
      <DialogDescription className="mt-2 max-w-3xl">{description}</DialogDescription>
    </DialogHeader>
  );
}

function ClientAutocomplete({ clients, value, onValueChange, testId, placeholder = "Search for a client…" }) {
  const selectedName = clients.find((client) => client.id === value)?.name || "";
  const [query, setQuery] = useState(selectedName);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) setQuery(selectedName);
  }, [isOpen, selectedName]);

  const matches = clients
    .filter((client) => `${client.name || ""} ${client.email || ""} ${client.billing_email || ""}`.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 8);

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={query}
        onChange={(event) => { setQuery(event.target.value); setIsOpen(true); }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => window.setTimeout(() => setIsOpen(false), 150)}
        placeholder={placeholder}
        className="pl-9"
        data-testid={testId}
      />
      {isOpen && (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-border/80 bg-popover p-1 shadow-xl">
          {matches.length === 0 ? <p className="px-3 py-2 text-xs text-muted-foreground">No clients match that search.</p> : matches.map((client) => (
            <button
              key={client.id}
              type="button"
              className="flex w-full flex-col rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { setQuery(client.name || ""); setIsOpen(false); onValueChange(client); }}
            >
              <span className="text-sm font-medium">{client.name}</span>
              <span className="text-[10px] text-muted-foreground">{client.billing_email || client.email || "No billing email recorded"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function RecurringInvoicesPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const headers = { Authorization: `Bearer ${token}` };
  const [invoices, setInvoices] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [stats, setStats] = useState(null);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("recurring");
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [schedulerStatus, setSchedulerStatus] = useState(null);
  const [runningScheduler, setRunningScheduler] = useState(false);

  // Dialogs
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(null);
  const [showHistory, setShowHistory] = useState(null);
  const [showReconcile, setShowReconcile] = useState(null);
  const [showTemplateCreate, setShowTemplateCreate] = useState(false);
  const [showApplyTemplate, setShowApplyTemplate] = useState(null);
  const [generateTarget, setGenerateTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [confirmSchedulerRun, setConfirmSchedulerRun] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form
  const emptyForm = { client_id: "", client_name: "", description: "", frequency: "monthly", payment_terms: "net_30", tax_rate: "10", currency: "AUD", notes: "", auto_send: false, auto_send_email: "", include_acronis_usage: false, include_pax8_usage: false, start_date: new Date().toISOString().split("T")[0], line_items: [{ description: "", quantity: "1", rate: "", amount: "" }] };
  const [form, setForm] = useState(emptyForm);
  const [templateForm, setTemplateForm] = useState({ name: "", description: "", category: "managed_services", tax_rate: "10", payment_terms: "net_30", notes: "", line_items: [{ description: "", quantity: "1", rate: "", amount: "" }] });
  const [applyForm, setApplyForm] = useState({ client_id: "", client_name: "", frequency: "monthly", start_date: new Date().toISOString().split("T")[0], auto_send: false, auto_send_email: "" });

  const fetchData = useCallback(async () => {
    try {
      const results = await Promise.allSettled([
        axios.get(`${API}/recurring-invoices/list`, { headers }),
        axios.get(`${API}/recurring-invoices/stats`, { headers }),
        axios.get(`${API}/invoice-templates`, { headers }),
        axios.get(`${API}/clients`, { headers }),
        axios.get(`${API}/recurring-invoices/scheduler/status`, { headers }),
      ]);
      const data = (index, fallback) => results[index].status === "fulfilled" ? results[index].value.data : fallback;
      setInvoices(data(0, []));
      setStats(data(1, { mrr: 0, arr: 0, active: 0, due_this_week: 0 }));
      setTemplates(data(2, []));
      setClients(data(3, []));
      setSchedulerStatus(data(4, null));
      if (results.every(result => result.status === "rejected")) toast.error("Failed to load recurring billing data");
    } catch { toast.error("Failed to load recurring billing data"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const updateLineItem = (setter, items, idx, field, value) => {
    const updated = [...items];
    updated[idx] = { ...updated[idx], [field]: value };
    if (field === "quantity" || field === "rate") {
      const qty = parseFloat(updated[idx].quantity) || 0;
      const rate = parseFloat(updated[idx].rate) || 0;
      updated[idx].amount = (qty * rate).toFixed(2);
    }
    setter(prev => ({ ...prev, line_items: updated }));
  };

  const addLineItem = (setter) => setter(prev => ({ ...prev, line_items: [...prev.line_items, { description: "", quantity: "1", rate: "", amount: "" }] }));
  const removeLineItem = (setter, idx) => setter(prev => ({ ...prev, line_items: prev.line_items.filter((_, i) => i !== idx) }));

  const calcSubtotal = (items) => items.reduce((a, li) => a + (parseFloat(li.amount) || 0), 0);
  const hasValidLineItems = (items) => items?.length > 0 && items.every(li => li.description?.trim() && Number(li.quantity) > 0 && Number(li.rate) >= 0);

  const createRecurring = async () => {
    if (!form.client_id || !form.description.trim()) { toast.error("Client and description are required"); return; }
    if (!hasValidLineItems(form.line_items)) { toast.error("Each line needs a description, positive quantity, and valid rate"); return; }
    if (form.auto_send && !form.auto_send_email.trim()) { toast.error("Enter the invoice recipient email before enabling auto-send"); return; }
    setSaving(true);
    try {
      const data = { ...form, tax_rate: parseFloat(form.tax_rate) || 0, line_items: form.line_items.filter(li => li.description).map(li => ({ ...li, quantity: parseFloat(li.quantity) || 1, rate: parseFloat(li.rate) || 0, amount: parseFloat(li.amount) || 0 })) };
      await axios.post(`${API}/recurring-invoices/create`, data, { headers });
      toast.success("Recurring invoice created");
      setShowCreate(false);
      setForm(emptyForm);
      fetchData();
    } catch { toast.error("Failed to create"); }
    finally { setSaving(false); }
  };

  const saveEdit = async () => {
    if (!showEdit) return;
    if (!showEdit.description?.trim()) { toast.error("Description is required"); return; }
    if (!hasValidLineItems(showEdit.line_items)) { toast.error("Each line needs a description, positive quantity, and valid rate"); return; }
    if (showEdit.auto_send && !showEdit.auto_send_email?.trim()) { toast.error("Enter the invoice recipient email before enabling auto-send"); return; }
    setSaving(true);
    try {
      const data = {
        ...showEdit,
        tax_rate: parseFloat(showEdit.tax_rate) || 0,
        line_items: showEdit.line_items?.filter(li => li.description).map(li => ({ ...li, quantity: parseFloat(li.quantity) || 1, rate: parseFloat(li.rate) || 0, amount: parseFloat(li.amount) || 0 }))
      };
      if (data.indexation?.enabled) {
        // Persist via dedicated endpoint so next_apply is bootstrapped
        await axios.post(`${API}/billing-pro/recurring/${showEdit.id}/set-indexation`, {
          enabled: true, pct: parseFloat(data.indexation.pct) || 0,
          anniversary_date: data.indexation.anniversary_date,
        }, { headers });
      }
      await axios.put(`${API}/recurring-invoices/${showEdit.id}`, data, { headers });
      toast.success("Updated");
      setShowEdit(null);
      fetchData();
    } catch { toast.error("Failed to update"); }
    finally { setSaving(false); }
  };

  const toggleRI = async (id) => {
    try {
      const res = await axios.post(`${API}/recurring-invoices/${id}/toggle`, {}, { headers });
      toast.success(res.data.status === "active" ? "Activated" : "Paused");
      fetchData();
    } catch { toast.error("Failed"); }
  };

  const generateNow = async (id) => {
    try {
      const res = await axios.post(`${API}/recurring-invoices/${id}/generate-now`, {}, { headers });
      toast.success(res.data.message);
      setGenerateTarget(null);
      fetchData();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to generate"); }
  };

  const duplicateRI = async (id) => {
    try {
      await axios.post(`${API}/recurring-invoices/${id}/duplicate`, {}, { headers });
      toast.success("Duplicated");
      fetchData();
    } catch { toast.error("Failed"); }
  };

  const deleteRI = async (id) => {
    try {
      await axios.delete(`${API}/recurring-invoices/${id}`, { headers });
      toast.success("Deleted");
      setDeleteTarget(null);
      fetchData();
    } catch { toast.error("Failed"); }
  };

  const createTemplate = async () => {
    if (!templateForm.name.trim()) { toast.error("Name required"); return; }
    if (!hasValidLineItems(templateForm.line_items)) { toast.error("Each line needs a description, positive quantity, and valid rate"); return; }
    setSaving(true);
    try {
      const data = { ...templateForm, tax_rate: parseFloat(templateForm.tax_rate) || 0, line_items: templateForm.line_items.filter(li => li.description).map(li => ({ ...li, quantity: parseFloat(li.quantity) || 1, rate: parseFloat(li.rate) || 0, amount: parseFloat(li.amount) || 0 })) };
      await axios.post(`${API}/invoice-templates`, data, { headers });
      toast.success("Template created");
      setShowTemplateCreate(false);
      fetchData();
    } catch { toast.error("Failed"); }
    finally { setSaving(false); }
  };

  const applyTemplate = async () => {
    if (!showApplyTemplate || !applyForm.client_id) { toast.error("Select a client"); return; }
    if (applyForm.auto_send && !applyForm.auto_send_email.trim()) { toast.error("Enter the invoice recipient email before enabling auto-send"); return; }
    setSaving(true);
    try {
      await axios.post(`${API}/invoice-templates/${showApplyTemplate.id}/apply`, applyForm, { headers });
      toast.success("Recurring invoice created from template");
      setShowApplyTemplate(null);
      setTab("recurring");
      fetchData();
    } catch { toast.error("Failed"); }
    finally { setSaving(false); }
  };

  const deleteTemplate = async (id) => {
    if (!window.confirm("Delete this template?")) return;
    try {
      await axios.delete(`${API}/invoice-templates/${id}`, { headers });
      toast.success("Template deleted");
      fetchData();
    } catch { toast.error("Failed"); }
  };

  const runSchedulerNow = async () => {
    setRunningScheduler(true);
    try {
      const res = await axios.post(`${API}/recurring-invoices/scheduler/run-now`, {}, { headers });
      const generated = res.data.generated ?? (res.data.results || []).filter(result => result.status === "generated").length;
      const skipped = res.data.skipped_duplicates ?? (res.data.results || []).filter(result => result.status === "skipped").length;
      const failed = (res.data.results || []).filter(result => result.status === "error").length;
      if (failed > 0) {
        toast.error(`${failed} billing stream(s) failed${generated ? `; ${generated} invoice(s) still generated` : ""}`);
      } else if (generated > 0) {
        toast.success(`Generated ${generated} invoice(s)${skipped ? ` · ${skipped} already existed` : ""}`);
      } else if (skipped > 0) {
        toast.info(`${skipped} billing period(s) already had an invoice`);
      } else {
        toast.info("No invoices due for generation");
      }
      setConfirmSchedulerRun(false);
      fetchData();
    } catch { toast.error("Scheduler run failed"); }
    finally { setRunningScheduler(false); }
  };

  const filtered = invoices.filter(i => {
    if (filterStatus !== "all" && i.status !== filterStatus) return false;
    if (search && !i.client_name?.toLowerCase().includes(search.toLowerCase()) && !i.description?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  // Line Items Editor Component
  const LineItemsEditor = ({ items, setter }) => (
    <div className="rounded-xl border border-border/70 bg-muted/15 p-3">
      <div className="hidden grid-cols-12 gap-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:grid">
        <div className="col-span-5">Description</div><div className="col-span-2">Qty</div><div className="col-span-2">Rate</div><div className="col-span-2">Amount</div><div className="col-span-1"></div>
      </div>
      {items.map((li, idx) => (
        <div key={`li-${idx}`} className="mt-2 grid grid-cols-1 items-end gap-2 rounded-lg border border-border/60 bg-background/60 p-2 sm:grid-cols-12 sm:border-0 sm:bg-transparent sm:p-1">
          <div className="sm:col-span-5"><Label className="text-[10px] sm:hidden">Description</Label><Input className="h-9 text-xs" value={li.description} onChange={e => updateLineItem(setter, items, idx, "description", e.target.value)} placeholder="Service description" /></div>
          <div className="sm:col-span-2"><Label className="text-[10px] sm:hidden">Quantity</Label><Input className="h-9 text-xs font-mono" type="number" value={li.quantity} onChange={e => updateLineItem(setter, items, idx, "quantity", e.target.value)} /></div>
          <div className="sm:col-span-2"><Label className="text-[10px] sm:hidden">Unit rate</Label><Input className="h-9 text-xs font-mono" type="number" value={li.rate} onChange={e => updateLineItem(setter, items, idx, "rate", e.target.value)} placeholder="0.00" /></div>
          <div className="flex h-9 items-center justify-between text-xs font-mono font-bold sm:col-span-2 sm:justify-start"><span className="sm:hidden text-[10px] font-sans font-normal text-muted-foreground">Line total</span>${parseFloat(li.amount || 0).toFixed(2)}</div>
          <Button variant="ghost" size="sm" className="h-9 w-full text-destructive hover:bg-destructive/10 hover:text-destructive sm:col-span-1 sm:w-9 sm:p-0" onClick={() => removeLineItem(setter, idx)} disabled={items.length <= 1}><Trash2 className="h-3.5 w-3.5" /><span className="ml-1 sm:hidden">Remove line</span></Button>
        </div>
      ))}
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/60 pt-3"><Button type="button" variant="outline" size="sm" onClick={() => addLineItem(setter)}><Plus className="mr-1 h-3.5 w-3.5" />Add line</Button><div className="text-right text-sm"><span className="mr-3 text-xs text-muted-foreground">Subtotal</span><span className="font-mono font-bold">${calcSubtotal(items).toFixed(2)}</span></div></div>
    </div>
  );

  return (
    <div className="space-y-6" data-testid="recurring-invoices-page">
      <OperationalPageHeader
        eyebrow="Billing automation"
        title="Recurring Billing"
        description="Create auditable billing streams from client commitments, live subscription sources, and reusable templates. Generated invoices retain their source, approval, and delivery history."
        icon={RefreshCw}
        tone="emerald"
        actions={<>
          <Button variant="outline" size="sm" onClick={() => navigate("/billing-dashboard")} data-testid="goto-billing-command"><Sparkles className="w-3.5 h-3.5 mr-1" />Billing Command</Button>
          <Button variant="outline" onClick={() => { setShowTemplateCreate(true); setTemplateForm({ name: "", description: "", category: "managed_services", tax_rate: "10", payment_terms: "net_30", notes: "", line_items: [{ description: "", quantity: "1", rate: "", amount: "" }] }); }} data-testid="create-template-btn"><FileText className="w-4 h-4 mr-1" />New Template</Button>
          <Button onClick={() => { setShowCreate(true); setForm(emptyForm); }} data-testid="create-recurring-btn"><Plus className="w-4 h-4 mr-1" />New Recurring Invoice</Button>
        </>}
      />

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <HeroTile label="Monthly recurring revenue" value={`$${(stats.mrr || 0).toLocaleString()}`} icon={DollarSign} glow="emerald" animated={false} active={tab === "recurring" && filterStatus === "active"} onClick={() => { setTab("recurring"); setFilterStatus("active"); }} testId="recurring-metric-mrr" />
          <HeroTile label="Annual recurring revenue" value={`$${(stats.arr || 0).toLocaleString()}`} icon={TrendingUp} glow="cyan" animated={false} onClick={() => { setTab("recurring"); setFilterStatus("all"); }} testId="recurring-metric-arr" />
          <HeroTile label="Active billing streams" value={stats.active || 0} icon={RefreshCw} glow="violet" active={tab === "recurring" && filterStatus === "active"} onClick={() => { setTab("recurring"); setFilterStatus("active"); }} testId="recurring-metric-active" />
          <HeroTile label="Due this week" value={stats.due_this_week || 0} icon={Calendar} glow={stats.due_this_week > 0 ? "amber" : "emerald"} active={tab === "scheduler"} onClick={() => setTab("scheduler")} testId="recurring-metric-due" />
        </div>
      )}

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid h-auto w-full grid-cols-1 gap-1 rounded-2xl border border-border/70 bg-muted/30 p-1.5 sm:grid-cols-3">
          <TabsTrigger className="justify-start gap-1.5 rounded-xl px-3 py-2 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm" value="recurring" data-testid="tab-recurring"><Receipt className="h-3.5 w-3.5" />Recurring Invoices ({invoices.length})</TabsTrigger>
          <TabsTrigger className="justify-start gap-1.5 rounded-xl px-3 py-2 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm" value="templates" data-testid="tab-templates"><FileText className="h-3.5 w-3.5" />Invoice Templates ({templates.length})</TabsTrigger>
          <TabsTrigger className="justify-start gap-1.5 rounded-xl px-3 py-2 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm" value="scheduler" data-testid="tab-scheduler"><Zap className="h-3.5 w-3.5" />Auto-Scheduler</TabsTrigger>
        </TabsList>

        {/* RECURRING INVOICES TAB */}
        <TabsContent value="recurring" className="mt-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search client, description..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="paused">Paused</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client / Description</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Frequency</TableHead>
                    <TableHead>Next Due</TableHead>
                    <TableHead>Generated</TableHead>
                    <TableHead>Total Billed</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 && (
                    <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">No recurring invoices</TableCell></TableRow>
                  )}
                  {filtered.map(ri => (
                    <Fragment key={ri.id}>
                    <TableRow data-testid={`ri-row-${ri.id}`}>
                      <TableCell>
                        <p className="font-medium text-sm">{ri.client_name}</p>
                        <p className="text-[10px] text-muted-foreground truncate max-w-[200px]">{ri.description}</p>
                        {ri.auto_send && <Badge variant="outline" className="text-[8px] mt-0.5 border-blue-500/20 text-blue-400">Auto-send</Badge>}
                        {ri.include_acronis_usage && <Badge variant="outline" className="text-[8px] mt-0.5 border-sky-500/30 text-sky-400" data-testid={`acronis-badge-${ri.id}`}><Cloud className="w-2.5 h-2.5 mr-0.5" />Acronis Auto</Badge>}
                        {ri.include_pax8_usage && <Badge variant="outline" className="text-[8px] mt-0.5 border-indigo-500/30 text-indigo-400" data-testid={`pax8-badge-${ri.id}`}><Cloud className="w-2.5 h-2.5 mr-0.5" />Pax8 Auto</Badge>}
                      </TableCell>
                      <TableCell className="font-mono font-bold">${ri.amount?.toLocaleString()}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[9px] capitalize">{ri.frequency}</Badge></TableCell>
                      <TableCell className="text-xs">{ri.next_generation}</TableCell>
                      <TableCell className="text-sm font-mono">{ri.invoices_generated}x</TableCell>
                      <TableCell className="font-mono text-sm">${(ri.total_billed || 0).toLocaleString()}</TableCell>
                      <TableCell>
                        <Badge className={`${STATUS_STYLES[ri.status]} text-[9px] border`}>{ri.status}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 justify-end">
                          <Button size="sm" variant="ghost" title="Generate invoice now" onClick={() => setGenerateTarget(ri)} disabled={ri.status !== "active"} data-testid={`gen-${ri.id}`}><Zap className="w-3 h-3 text-amber-400" /></Button>
                          <Button size="sm" variant="ghost" title="Reconcile (bill-shock check)" onClick={() => setShowReconcile(ri)} data-testid={`reconcile-${ri.id}`}>
                            <DollarSign className="w-3 h-3 text-emerald-400" />
                          </Button>
                          <Button size="sm" variant="ghost" title={ri.status === "active" ? "Pause" : "Activate"} onClick={() => toggleRI(ri.id)}>{ri.status === "active" ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}</Button>
                          <Button size="sm" variant="ghost" title="Edit" onClick={() => setShowEdit({ ...ri, tax_rate: String(ri.tax_rate || 10) })}><Edit className="w-3 h-3" /></Button>
                          <Button size="sm" variant="ghost" title="History" onClick={() => setShowHistory(ri)}><Eye className="w-3 h-3" /></Button>
                          <Button size="sm" variant="ghost" title="Duplicate" onClick={() => duplicateRI(ri.id)}><Copy className="w-3 h-3" /></Button>
                          <Button size="sm" variant="ghost" title={ri.invoices_generated > 0 ? "Streams with invoice history are retained" : "Delete"} className="text-red-400" onClick={() => setDeleteTarget(ri)} disabled={ri.invoices_generated > 0}><Trash2 className="w-3 h-3" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    <TableRow key={`${ri.id}-smart`} className="border-b-0">
                      <TableCell colSpan={8} className="py-1.5 px-3 bg-gradient-to-r from-emerald-500/[0.03] to-transparent">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] uppercase tracking-wider text-emerald-400/70 flex items-center gap-1"><span className="inline-block w-1 h-1 rounded-full bg-emerald-400" />Smart:</span>
                          <RecurringSmartActions ri={ri} onReload={fetchData} />
                          <ConsolidateButton clientId={ri.client_id} clientName={ri.client_name} onDone={fetchData} />
                        </div>
                      </TableCell>
                    </TableRow>
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TEMPLATES TAB */}
        <TabsContent value="templates" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map(tpl => (
              <Card key={tpl.id} className="hover:border-primary/30 transition-colors" data-testid={`tpl-${tpl.id}`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span className="flex items-center gap-2"><FileText className="w-4 h-4 text-blue-400" />{tpl.name}</span>
                    <Badge variant="outline" className="text-[9px] capitalize">{tpl.category?.replace(/_/g, " ")}</Badge>
                  </CardTitle>
                  <p className="text-[10px] text-muted-foreground">{tpl.description}</p>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1 mb-3">
                    {(tpl.line_items || []).map((li, i) => (
                      <div key={`tli-${i}`} className="flex items-center justify-between text-xs">
                        <span className="truncate max-w-[200px]">{li.description}</span>
                        <span className="font-mono font-bold">${parseFloat(li.amount || 0).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                  <Separator className="mb-3" />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Tax: {tpl.tax_rate}% | {TERMS_LABELS[tpl.payment_terms] || tpl.payment_terms}</span>
                    <span>Used {tpl.usage_count || 0}x</span>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <Button size="sm" className="flex-1" onClick={() => { setShowApplyTemplate(tpl); setApplyForm({ client_id: "", client_name: "", frequency: "monthly", start_date: new Date().toISOString().split("T")[0], auto_send: false, auto_send_email: "" }); }} data-testid={`apply-${tpl.id}`}>
                      <Plus className="w-3 h-3 mr-1" />Use Template
                    </Button>
                    <Button size="sm" variant="ghost" className="text-red-400" onClick={() => deleteTemplate(tpl.id)}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                </CardContent>
              </Card>
            ))}
            {templates.length === 0 && <p className="col-span-3 text-center py-12 text-muted-foreground">No templates yet. Create one to speed up recurring invoice setup.</p>}
          </div>
        </TabsContent>

        {/* SCHEDULER TAB */}
        <TabsContent value="scheduler" className="mt-4 space-y-4">
          <Card data-testid="scheduler-panel">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center justify-between">
                <span className="flex items-center gap-2"><Zap className="w-4 h-4 text-amber-400" />Auto-Generation Scheduler</span>
                <div className="flex items-center gap-2">
                  <Badge className={`${schedulerStatus?.scheduler_active === false ? "border-rose-500/20 bg-rose-500/10 text-rose-300" : "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"} text-[9px] border`}>
                    <div className={`mr-1.5 h-1.5 w-1.5 rounded-full ${schedulerStatus?.scheduler_active === false ? "bg-rose-400" : "animate-pulse bg-emerald-400"}`} />{schedulerStatus?.scheduler_active === false ? "Inactive" : "Active"}
                  </Badge>
                  <Button size="sm" onClick={() => setConfirmSchedulerRun(true)} disabled={runningScheduler} data-testid="run-scheduler-btn">
                    {runningScheduler ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Play className="w-3 h-3 mr-1" />}
                    Run Now
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <HeroTile label="Due now" value={schedulerStatus?.due_now || 0} icon={Calendar} glow={schedulerStatus?.due_now ? "amber" : "emerald"} subtitle="Billing streams ready" />
                <HeroTile label="Auto-generated" value={schedulerStatus?.total_auto_generated || 0} icon={CheckCircle} glow="emerald" subtitle="All recorded runs" />
                <HeroTile label="Exceptions" value={schedulerStatus?.total_errors || 0} icon={AlertTriangle} glow={schedulerStatus?.total_errors ? "rose" : "emerald"} subtitle="Requires billing review" />
                <HeroTile label="Check interval" value={schedulerStatus?.check_interval_seconds ? `${schedulerStatus.check_interval_seconds / 60}m` : "5m"} icon={Clock} glow="cyan" animated={false} subtitle="Automatic scan cadence" />
              </div>

              <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/10 mb-4 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground text-sm">How it works:</p>
                <p>The scheduler checks every 5 minutes for active recurring invoices whose next generation date is today or earlier.</p>
                <p>When found, it automatically generates the invoice, updates the next generation date, and logs the event.</p>
                <p>Auto-send prepares the recipient details on the recurring billing record. Live email delivery requires a configured email provider and is verified separately.</p>
                <p className="pt-1 text-foreground/80">Last scheduler activity: {schedulerStatus?.last_activity_at ? `${new Date(schedulerStatus.last_activity_at).toLocaleString()} · ${schedulerStatus.last_activity_status || "processed"}` : "No generation activity recorded yet"}</p>
              </div>

              <p className="text-sm font-medium mb-2">Recent Activity</p>
              {(schedulerStatus?.recent_logs || []).length === 0 ? (
                <p className="text-center py-6 text-muted-foreground text-sm">No scheduler activity yet. Invoices will be auto-generated when due.</p>
              ) : (
                <div className="space-y-1.5">
                  {(schedulerStatus?.recent_logs || []).map((log, i) => (
                    <div key={`log-${i}`} className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs ${log.type === "recurring_invoice_error" ? "bg-red-500/5 border border-red-500/10" : "bg-emerald-500/5 border border-emerald-500/10"}`}>
                      <div className="flex items-center gap-2">
                        {log.type === "recurring_invoice_error" ? <AlertTriangle className="w-3 h-3 text-red-400" /> : <CheckCircle className="w-3 h-3 text-emerald-400" />}
                        <span className="font-medium">{log.client_name || "Unknown"}</span>
                        {log.invoice_number && <span className="font-mono text-muted-foreground">{log.invoice_number}</span>}
                      </div>
                      <div className="flex items-center gap-3">
                        {log.amount && <span className="font-mono font-bold">${log.amount?.toLocaleString()}</span>}
                        {log.delivery?.requested && <Badge variant="outline" className={`text-[9px] ${log.delivery.status === "sent" ? "border-emerald-500/30 text-emerald-400" : log.delivery.status === "simulated" ? "border-amber-500/30 text-amber-400" : "border-rose-500/30 text-rose-400"}`}>Email {log.delivery.status}</Badge>}
                        <span className="text-muted-foreground">{log.timestamp ? new Date(log.timestamp).toLocaleString() : ""}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* CREATE RECURRING DIALOG */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="flex max-h-[92vh] w-[calc(100vw-2rem)] max-w-5xl flex-col overflow-hidden border-emerald-400/25 bg-[linear-gradient(145deg,rgba(9,30,25,0.98),rgba(13,15,21,0.98))] p-0" aria-describedby="create-ri-desc">
          <WorkflowDialogHeader icon={RefreshCw} eyebrow="Revenue automation" title="Create recurring billing stream" badge="Auditable workflow" description="Set up a client billing commitment once. NexusMSP carries the source lines, schedule, delivery preferences, and future invoice history forward on every generation." />
          <div id="create-ri-desc" className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <section className="rounded-xl border border-emerald-400/15 bg-emerald-400/[0.035] p-4">
              <div className="mb-3"><Label className="text-base font-semibold">Billing profile</Label><p className="mt-0.5 text-xs text-muted-foreground">Choose the client, name the commitment, and establish the recurring cadence.</p></div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div><Label>Client *</Label>
                <ClientAutocomplete clients={clients} value={form.client_id} testId="ri-client-select" onValueChange={client => setForm(p => ({ ...p, client_id: client.id, client_name: client.name || "" }))} />
                <p className="mt-1 text-[10px] text-emerald-100/70">Search by client name or recorded billing email.</p>
              </div>
              <div><Label>Frequency</Label>
                <Select value={form.frequency} onValueChange={v => setForm(p => ({ ...p, frequency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(FREQ_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2"><Label>Commitment name *</Label><Input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="e.g., Monthly Managed IT Services" data-testid="ri-description" /><p className="mt-1 text-[10px] text-muted-foreground">This appears in billing operations and helps technicians identify the commercial agreement behind each generated invoice.</p></div>
              </div>
            </section>
            <section>
            <div className="mb-3"><Label className="text-base font-semibold">Recurring line items</Label><p className="mt-0.5 text-xs text-muted-foreground">Define the fixed commercial lines. Live Acronis or Pax8 sources can be appended automatically at each billing run.</p></div>
            <LineItemsEditor items={form.line_items} setter={setForm} />
            </section>
            <section className="rounded-xl border border-border/70 bg-muted/15 p-4">
              <div className="mb-3"><Label className="text-base font-semibold">Schedule and payment policy</Label><p className="mt-0.5 text-xs text-muted-foreground">These settings become part of the billing record and are retained with every generated invoice.</p></div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div><Label>Tax Rate (%)</Label><Input type="number" value={form.tax_rate} onChange={e => setForm(p => ({ ...p, tax_rate: e.target.value }))} /></div>
              <div><Label>Payment Terms</Label>
                <Select value={form.payment_terms} onValueChange={v => setForm(p => ({ ...p, payment_terms: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(TERMS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Start Date</Label><Input type="date" value={form.start_date} onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))} /></div>
            </div>
            </section>
            <section className="space-y-3">
              <div><Label className="text-base font-semibold">Delivery and live sources</Label><p className="mt-0.5 text-xs text-muted-foreground">Attach approved live usage when the invoice is generated and preserve each delivery attempt in the audit history.</p></div>
            <div className="flex flex-col gap-3 rounded-xl border border-border/70 p-4 sm:flex-row sm:items-center sm:gap-4">
              <Switch checked={form.auto_send} onCheckedChange={v => setForm(p => ({ ...p, auto_send: v }))} data-testid="ri-auto-send" />
              <div className="flex-1"><p className="text-sm font-medium">Auto-send invoices</p><p className="text-[10px] text-muted-foreground">Send through the shared Microsoft 365 mailbox; delivery is recorded for every invoice.</p></div>
              {form.auto_send && <Input value={form.auto_send_email} onChange={e => setForm(p => ({ ...p, auto_send_email: e.target.value }))} placeholder="accounts@client.com" className="w-full sm:w-72" />}
            </div>
            <div className="flex items-start gap-4 rounded-xl border border-sky-500/20 bg-sky-500/[0.03] p-4">
              <Switch checked={form.include_acronis_usage} onCheckedChange={v => setForm(p => ({ ...p, include_acronis_usage: v }))} data-testid="ri-acronis-auto-toggle" />
              <div className="flex-1 flex items-start gap-2">
                <Cloud className="w-4 h-4 text-sky-400 mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Auto-attach Acronis usage</p>
                  <p className="text-[10px] text-muted-foreground">
                    Pull live Acronis usage (workstations, servers, C2C storage, M365 etc.) for the linked client each time this invoice generates. Requires the client to be linked on the Backup Command Center → Tenants tab.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex items-start gap-4 rounded-xl border border-indigo-500/20 bg-indigo-500/[0.03] p-4">
              <Switch checked={form.include_pax8_usage} onCheckedChange={v => setForm(p => ({ ...p, include_pax8_usage: v }))} data-testid="ri-pax8-auto-toggle" />
              <div className="flex-1 flex items-start gap-2">
                <Cloud className="w-4 h-4 text-indigo-400 mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Auto-attach Pax8 / Microsoft subscriptions</p>
                  <p className="text-[10px] text-muted-foreground">
                    Pull live Microsoft / CSP subscription usage (seat counts × unit price) from Pax8 each generation. Requires the client to be linked on Pax8 Command Center → Companies tab.
                  </p>
                </div>
              </div>
            </div>
            </section>
            <section><Label className="text-base font-semibold">Internal billing note</Label><p className="mt-0.5 text-xs text-muted-foreground">Keep a short audit note for the billing team; it is not the client-facing invoice narrative.</p><Textarea className="mt-2" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="e.g., Agreement reference, approval context, or billing handover" rows={3} /></section>
          </div>
          <DialogFooter className="shrink-0 border-t border-white/[0.07] bg-black/10 px-6 py-4">
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400" onClick={createRecurring} disabled={saving} data-testid="ri-create-submit">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create audited billing stream"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* EDIT DIALOG */}
      <Dialog open={!!showEdit} onOpenChange={v => { if (!v) setShowEdit(null); }}>
        <DialogContent className="flex max-h-[92vh] w-[calc(100vw-2rem)] max-w-5xl flex-col overflow-hidden border-cyan-400/25 bg-[linear-gradient(145deg,rgba(9,22,30,0.98),rgba(13,15,21,0.98))] p-0" aria-describedby="edit-ri-desc">
          <WorkflowDialogHeader icon={Edit} eyebrow="Billing control" title="Edit recurring billing stream" badge="Changes audited" tone="cyan" description="Update the commercial commitment without losing its invoice history. Source attachments and annual indexation remain explicit before future generation runs." />
          {showEdit && (
            <div id="edit-ri-desc" className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
              <section className="rounded-xl border border-cyan-400/15 bg-cyan-400/[0.035] p-4"><Label className="text-base font-semibold">Billing commitment</Label><p className="mt-0.5 text-xs text-muted-foreground">This name stays visible in billing, contract, and generated-invoice audit trails.</p><Input className="mt-3" value={showEdit.description || ""} onChange={e => setShowEdit(p => ({ ...p, description: e.target.value }))} /></section>
              <section><div className="mb-3"><Label className="text-base font-semibold">Recurring line items</Label><p className="mt-0.5 text-xs text-muted-foreground">Updates apply to future invoice generations. Generated invoices keep their original locked lines.</p></div>
              <LineItemsEditor items={showEdit.line_items || []} setter={setShowEdit} />
              </section>
              <section className="rounded-xl border border-border/70 bg-muted/15 p-4"><div className="mb-3"><Label className="text-base font-semibold">Schedule and payment policy</Label><p className="mt-0.5 text-xs text-muted-foreground">The next run recalculates from this schedule while preserving the completed billing history.</p></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div><Label>Frequency</Label>
                  <Select value={showEdit.frequency} onValueChange={v => setShowEdit(p => ({ ...p, frequency: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(FREQ_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Tax Rate (%)</Label><Input type="number" value={showEdit.tax_rate} onChange={e => setShowEdit(p => ({ ...p, tax_rate: e.target.value }))} /></div>
                <div><Label>Payment Terms</Label>
                  <Select value={showEdit.payment_terms || "net_30"} onValueChange={v => setShowEdit(p => ({ ...p, payment_terms: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(TERMS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              </section>
              <section className="space-y-3"><div><Label className="text-base font-semibold">Delivery and source controls</Label><p className="mt-0.5 text-xs text-muted-foreground">These controls are recorded with the billing stream and visible to the team before the next run.</p></div>
              <div className="flex flex-col gap-3 rounded-xl border border-border/70 p-4 sm:flex-row sm:items-center sm:gap-4">
                <Switch checked={showEdit.auto_send} onCheckedChange={v => setShowEdit(p => ({ ...p, auto_send: v }))} />
                <div className="flex-1"><p className="text-sm font-medium">Auto-send invoices</p><p className="text-[10px] text-muted-foreground">Delivery is sent through the configured Microsoft 365 billing mailbox and recorded against the generated invoice.</p></div>
                {showEdit.auto_send && <Input value={showEdit.auto_send_email || ""} onChange={e => setShowEdit(p => ({ ...p, auto_send_email: e.target.value }))} placeholder="accounts@client.com" className="w-full sm:w-72" />}
              </div>
              <div className="flex items-start gap-4 rounded-xl border border-sky-500/20 bg-sky-500/[0.03] p-4">
                <Switch checked={!!showEdit.include_acronis_usage} onCheckedChange={v => setShowEdit(p => ({ ...p, include_acronis_usage: v }))} data-testid="ri-edit-acronis-auto-toggle" />
                <div className="flex-1 flex items-start gap-2">
                  <Cloud className="w-4 h-4 text-sky-400 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Auto-attach Acronis usage</p>
                    <p className="text-[10px] text-muted-foreground">Auto-attach live Acronis usage as line items each generation.</p>
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-4 rounded-xl border border-indigo-500/20 bg-indigo-500/[0.03] p-4">
                <Switch checked={!!showEdit.include_pax8_usage} onCheckedChange={v => setShowEdit(p => ({ ...p, include_pax8_usage: v }))} data-testid="ri-edit-pax8-auto-toggle" />
                <div className="flex-1 flex items-start gap-2">
                  <Cloud className="w-4 h-4 text-indigo-400 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Auto-attach Pax8 / Microsoft subscriptions</p>
                    <p className="text-[10px] text-muted-foreground">Live seat × unit-price subs attached each generation.</p>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] p-4 sm:flex-row sm:items-center sm:gap-4">
                <Switch
                  checked={!!showEdit.indexation?.enabled}
                  onCheckedChange={v => setShowEdit(p => ({ ...p, indexation: { ...(p.indexation || {}), enabled: v, pct: p.indexation?.pct ?? 3, anniversary_date: p.indexation?.anniversary_date || p.start_date || new Date().toISOString().slice(0, 10) } }))}
                  data-testid="ri-edit-indexation-toggle"
                />
                <div className="flex-1 flex items-start gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-400 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Auto CPI / Annual Indexation</p>
                    <p className="text-[10px] text-muted-foreground">Auto-bump unit prices on each anniversary.</p>
                  </div>
                </div>
                {showEdit.indexation?.enabled && (
                  <div className="flex items-center gap-2">
                    <Input type="number" step="0.1" className="w-20 h-8" value={showEdit.indexation?.pct ?? 3} onChange={e => setShowEdit(p => ({ ...p, indexation: { ...(p.indexation || {}), pct: parseFloat(e.target.value) || 0 } }))} data-testid="ri-indexation-pct" />
                    <span className="text-xs">%/yr</span>
                    <Input type="date" className="w-36 h-8" value={(showEdit.indexation?.anniversary_date || "").slice(0, 10)} onChange={e => setShowEdit(p => ({ ...p, indexation: { ...(p.indexation || {}), anniversary_date: e.target.value } }))} />
                  </div>
                )}
              </div>
              </section>
              <section><Label className="text-base font-semibold">Internal billing note</Label><p className="mt-0.5 text-xs text-muted-foreground">Record why the billing stream changed. The note remains available for billing review and audit.</p><Textarea className="mt-2" value={showEdit.notes || ""} onChange={e => setShowEdit(p => ({ ...p, notes: e.target.value }))} rows={3} /></section>
            </div>
          )}
          <DialogFooter className="shrink-0 border-t border-white/[0.07] bg-black/10 px-6 py-4">
            <Button variant="outline" onClick={() => setShowEdit(null)}>Cancel</Button>
            <Button className="bg-cyan-400 text-cyan-950 hover:bg-cyan-300" onClick={saveEdit} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save audited changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* HISTORY DIALOG */}
      <Dialog open={!!showHistory} onOpenChange={v => { if (!v) setShowHistory(null); }}>
        <DialogContent className="max-w-lg" aria-describedby="hist-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Clock className="w-5 h-5" />Generation History — {showHistory?.client_name}</DialogTitle>
            <DialogDescription id="hist-desc">{showHistory?.description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {(showHistory?.generation_history || []).length === 0 ? (
              <p className="text-center py-8 text-muted-foreground text-sm">No invoices generated yet</p>
            ) : (
              [...(showHistory?.generation_history || [])].reverse().map((h, i) => (
                <button key={`h-${i}`} type="button" onClick={() => { setShowHistory(null); navigate(`/invoices?invoice=${encodeURIComponent(h.invoice_id)}`); }} className="flex w-full items-center justify-between rounded-lg border p-3 text-left text-sm transition-colors hover:bg-muted/50">
                  <div><p className="font-mono font-medium">{h.invoice_number}</p><p className="text-[10px] text-muted-foreground">{new Date(h.generated_at).toLocaleDateString()} by {h.generated_by}</p>{h.delivery?.requested && <Badge variant="outline" className={`mt-1 text-[9px] ${h.delivery.status === "sent" ? "border-emerald-500/30 text-emerald-400" : h.delivery.status === "mocked" ? "border-amber-500/30 text-amber-400" : "border-rose-500/30 text-rose-400"}`}>Email {h.delivery.status}</Badge>}</div>
                  <div className="flex items-center gap-2"><span className="font-mono font-bold">${h.amount?.toLocaleString()}</span><ChevronRight className="h-4 w-4 text-muted-foreground" /></div>
                </button>
              ))
            )}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowHistory(null)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CREATE TEMPLATE DIALOG */}
      <Dialog open={showTemplateCreate} onOpenChange={setShowTemplateCreate}>
        <DialogContent className="flex max-h-[92vh] w-[calc(100vw-2rem)] max-w-5xl flex-col overflow-hidden border-violet-400/25 bg-[linear-gradient(145deg,rgba(22,15,40,0.98),rgba(13,15,21,0.98))] p-0" aria-describedby="create-tpl-desc">
          <WorkflowDialogHeader icon={FileText} eyebrow="Reusable revenue design" title="Create invoice template" badge="Reusable baseline" tone="violet" description="Build a repeatable billing baseline for a service package. Applying the template still requires a client, schedule, and delivery choice so every billing stream stays accountable." />
          <div id="create-tpl-desc" className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <section className="rounded-xl border border-violet-400/15 bg-violet-400/[0.035] p-4"><div className="mb-3"><Label className="text-base font-semibold">Template identity</Label><p className="mt-0.5 text-xs text-muted-foreground">Name the commercial baseline clearly enough for technicians to choose it safely.</p></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><Label>Template Name</Label><Input value={templateForm.name} onChange={e => setTemplateForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g., Standard MSP Monthly" data-testid="tpl-name" /></div>
              <div><Label>Category</Label>
                <Select value={templateForm.category} onValueChange={v => setTemplateForm(p => ({ ...p, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="managed_services">Managed Services</SelectItem>
                    <SelectItem value="security">Security</SelectItem>
                    <SelectItem value="backup">Backup & DR</SelectItem>
                    <SelectItem value="consulting">Consulting</SelectItem>
                    <SelectItem value="haas">Hardware-as-a-Service</SelectItem>
                    <SelectItem value="project">Project Work</SelectItem>
                    <SelectItem value="general">General</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2"><Label>Description</Label><Input value={templateForm.description} onChange={e => setTemplateForm(p => ({ ...p, description: e.target.value }))} placeholder="What is included in this reusable billing package?" /></div>
            </div></section>
            <section><div className="mb-3"><Label className="text-base font-semibold">Baseline line items</Label><p className="mt-0.5 text-xs text-muted-foreground">The template sets defaults only. You can refine client-specific quantities and live usage sources when it is applied.</p></div>
            <LineItemsEditor items={templateForm.line_items} setter={setTemplateForm} />
            </section>
            <section className="grid grid-cols-1 gap-3 rounded-xl border border-border/70 bg-muted/15 p-4 sm:grid-cols-2">
              <div><Label>Tax Rate (%)</Label><Input type="number" value={templateForm.tax_rate} onChange={e => setTemplateForm(p => ({ ...p, tax_rate: e.target.value }))} /></div>
              <div><Label>Payment Terms</Label>
                <Select value={templateForm.payment_terms} onValueChange={v => setTemplateForm(p => ({ ...p, payment_terms: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(TERMS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </section>
          </div>
          <DialogFooter className="shrink-0 border-t border-white/[0.07] bg-black/10 px-6 py-4">
            <Button variant="outline" onClick={() => setShowTemplateCreate(false)}>Cancel</Button>
            <Button className="bg-violet-400 text-violet-950 hover:bg-violet-300" onClick={createTemplate} disabled={saving} data-testid="tpl-create-submit">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create reusable template"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* APPLY TEMPLATE DIALOG */}
      <Dialog open={!!showApplyTemplate} onOpenChange={v => { if (!v) setShowApplyTemplate(null); }}>
        <DialogContent className="flex max-h-[92vh] w-[calc(100vw-2rem)] max-w-3xl flex-col overflow-hidden border-emerald-400/25 bg-[linear-gradient(145deg,rgba(9,30,25,0.98),rgba(13,15,21,0.98))] p-0" aria-describedby="apply-tpl-desc">
          <WorkflowDialogHeader icon={Plus} eyebrow="Template deployment" title="Create stream from template" badge="Client-specific" description={`Using ${showApplyTemplate?.name || "the selected template"}. Confirm the client, billing cadence, and delivery preference before the reusable baseline becomes a live billing commitment.`} />
          <div id="apply-tpl-desc" className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
            <section className="rounded-xl border border-emerald-400/15 bg-emerald-400/[0.035] p-4"><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div className="sm:col-span-2"><Label>Client *</Label>
              <ClientAutocomplete clients={clients} value={applyForm.client_id} testId="apply-client" onValueChange={client => setApplyForm(p => ({ ...p, client_id: client.id, client_name: client.name || "" }))} />
              <p className="mt-1 text-[10px] text-emerald-100/70">Search by client name or billing email.</p>
            </div>
            <div><Label>Frequency</Label>
              <Select value={applyForm.frequency} onValueChange={v => setApplyForm(p => ({ ...p, frequency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(FREQ_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Start Date</Label><Input type="date" value={applyForm.start_date} onChange={e => setApplyForm(p => ({ ...p, start_date: e.target.value }))} /></div>
            </div></section>
            <div className="flex flex-col gap-3 rounded-xl border border-border/70 p-4 sm:flex-row sm:items-center">
              <Switch checked={applyForm.auto_send} onCheckedChange={v => setApplyForm(p => ({ ...p, auto_send: v }))} />
              <div><p className="text-sm font-medium">Auto-send invoices</p><p className="text-[10px] text-muted-foreground">Delivery is recorded on each generated invoice.</p></div>
            </div>
            {applyForm.auto_send && <div><Label>Invoice recipient email</Label><Input type="email" value={applyForm.auto_send_email} onChange={e => setApplyForm(p => ({ ...p, auto_send_email: e.target.value }))} placeholder="accounts@client.com" /></div>}
          </div>
          <DialogFooter className="shrink-0 border-t border-white/[0.07] bg-black/10 px-6 py-4">
            <Button variant="outline" onClick={() => setShowApplyTemplate(null)}>Cancel</Button>
            <Button className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400" onClick={applyTemplate} disabled={saving} data-testid="apply-submit">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create billing stream"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!generateTarget} onOpenChange={open => !open && setGenerateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Generate an invoice now?</AlertDialogTitle>
            <AlertDialogDescription>
              This will create and send {generateTarget?.description || "the recurring invoice"} for {generateTarget?.client_name || "this client"} into the invoice queue. The next generation date will advance to the following period.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => generateTarget && generateNow(generateTarget.id)} data-testid="confirm-generate-recurring">Generate Invoice</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this billing stream?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes {deleteTarget?.description || "the recurring invoice"}. Streams with generated invoice history are retained for financial traceability and cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Stream</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleteTarget && deleteRI(deleteTarget.id)} data-testid="confirm-delete-recurring">Delete Stream</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmSchedulerRun} onOpenChange={setConfirmSchedulerRun}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run the recurring scheduler now?</AlertDialogTitle>
            <AlertDialogDescription>
              Every active billing stream due today or earlier will generate an invoice immediately. This creates financial records and advances each processed stream to its next billing date; configured email delivery is attempted separately and remains auditable on the generated invoice.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runSchedulerNow} data-testid="confirm-run-scheduler">Run Scheduler</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ReconcileDialog
        open={!!showReconcile}
        onOpenChange={v => { if (!v) setShowReconcile(null); }}
        recurringInvoice={showReconcile}
        token={token}
        onUpdated={fetchData}
      />
    </div>
  );
}
