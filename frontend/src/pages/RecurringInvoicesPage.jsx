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

const FREQ_LABELS = { weekly: "Weekly", fortnightly: "Fortnightly", monthly: "Monthly", quarterly: "Quarterly", annually: "Annually" };
const TERMS_LABELS = { due_on_receipt: "Due on Receipt", net_7: "Net 7", net_14: "Net 14", net_30: "Net 30", net_45: "Net 45", net_60: "Net 60", net_90: "Net 90" };
const STATUS_STYLES = { active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", paused: "bg-amber-500/10 text-amber-400 border-amber-500/20", cancelled: "bg-red-500/10 text-red-400 border-red-500/20" };

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
    <div className="space-y-2">
      <div className="grid grid-cols-12 gap-2 text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
        <div className="col-span-5">Description</div><div className="col-span-2">Qty</div><div className="col-span-2">Rate</div><div className="col-span-2">Amount</div><div className="col-span-1"></div>
      </div>
      {items.map((li, idx) => (
        <div key={`li-${idx}`} className="grid grid-cols-12 gap-2 items-center">
          <Input className="col-span-5 h-8 text-xs" value={li.description} onChange={e => updateLineItem(setter, items, idx, "description", e.target.value)} placeholder="Service description" />
          <Input className="col-span-2 h-8 text-xs font-mono" type="number" value={li.quantity} onChange={e => updateLineItem(setter, items, idx, "quantity", e.target.value)} />
          <Input className="col-span-2 h-8 text-xs font-mono" type="number" value={li.rate} onChange={e => updateLineItem(setter, items, idx, "rate", e.target.value)} placeholder="0.00" />
          <div className="col-span-2 text-xs font-mono font-bold">${parseFloat(li.amount || 0).toFixed(2)}</div>
          <Button variant="ghost" size="sm" className="col-span-1 h-8 w-8 p-0" onClick={() => removeLineItem(setter, idx)} disabled={items.length <= 1}><Trash2 className="w-3 h-3" /></Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => addLineItem(setter)} className="mt-1"><Plus className="w-3 h-3 mr-1" />Add Line</Button>
      <div className="text-right font-mono text-sm font-bold mt-2">Subtotal: ${calcSubtotal(items).toFixed(2)}</div>
    </div>
  );

  return (
    <div className="space-y-6" data-testid="recurring-invoices-page">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="w-9 h-9 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center"><RefreshCw className="w-4 h-4 text-violet-300" /></span>
          <div><h1 className="text-2xl font-bold tracking-tight">Recurring Billing</h1><p className="text-sm text-muted-foreground">Contracts, templates, automated generation, and revenue health.</p></div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate("/billing-pro")} data-testid="goto-billing-pro" className="border-violet-500/30 text-violet-300 hover:bg-violet-500/10"><Sparkles className="w-3.5 h-3.5 mr-1" />Billing Pro</Button>
          <Button variant="outline" onClick={() => { setShowTemplateCreate(true); setTemplateForm({ name: "", description: "", category: "managed_services", tax_rate: "10", payment_terms: "net_30", notes: "", line_items: [{ description: "", quantity: "1", rate: "", amount: "" }] }); }} data-testid="create-template-btn"><FileText className="w-4 h-4 mr-1" />New Template</Button>
          <Button onClick={() => { setShowCreate(true); setForm(emptyForm); }} data-testid="create-recurring-btn"><Plus className="w-4 h-4 mr-1" />New Recurring Invoice</Button>
        </div>
      </div>

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
        <TabsList>
          <TabsTrigger value="recurring" data-testid="tab-recurring">Recurring Invoices ({invoices.length})</TabsTrigger>
          <TabsTrigger value="templates" data-testid="tab-templates">Invoice Templates ({templates.length})</TabsTrigger>
          <TabsTrigger value="scheduler" data-testid="tab-scheduler">Auto-Scheduler</TabsTrigger>
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
                  <Badge className="bg-emerald-500/10 text-emerald-400 text-[9px] border border-emerald-500/20">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5 animate-pulse" />Active
                  </Badge>
                  <Button size="sm" onClick={() => setConfirmSchedulerRun(true)} disabled={runningScheduler} data-testid="run-scheduler-btn">
                    {runningScheduler ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Play className="w-3 h-3 mr-1" />}
                    Run Now
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-3 mb-4">
                <div className="p-3 rounded-lg border bg-card text-center">
                  <p className="text-2xl font-bold text-amber-400">{schedulerStatus?.due_now || 0}</p>
                  <p className="text-[10px] text-muted-foreground uppercase">Due Now</p>
                </div>
                <div className="p-3 rounded-lg border bg-card text-center">
                  <p className="text-2xl font-bold text-emerald-400">{schedulerStatus?.total_auto_generated || 0}</p>
                  <p className="text-[10px] text-muted-foreground uppercase">Auto-Generated</p>
                </div>
                <div className="p-3 rounded-lg border bg-card text-center">
                  <p className="text-2xl font-bold text-red-400">{schedulerStatus?.total_errors || 0}</p>
                  <p className="text-[10px] text-muted-foreground uppercase">Errors</p>
                </div>
                <div className="p-3 rounded-lg border bg-card text-center">
                  <p className="text-lg font-bold">{schedulerStatus?.check_interval_seconds ? `${schedulerStatus.check_interval_seconds / 60}m` : "5m"}</p>
                  <p className="text-[10px] text-muted-foreground uppercase">Check Interval</p>
                </div>
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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" aria-describedby="create-ri-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><RefreshCw className="w-5 h-5 text-blue-400" />New Recurring Invoice</DialogTitle>
            <DialogDescription id="create-ri-desc">Set up automated recurring billing for a client</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Client</Label>
                <Select value={form.client_id} onValueChange={v => { const c = clients.find(x => x.id === v); setForm(p => ({ ...p, client_id: v, client_name: c?.name || "" })); }}>
                  <SelectTrigger data-testid="ri-client-select"><SelectValue placeholder="Select client..." /></SelectTrigger>
                  <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Frequency</Label>
                <Select value={form.frequency} onValueChange={v => setForm(p => ({ ...p, frequency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(FREQ_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Description</Label><Input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="e.g., Monthly Managed IT Services" data-testid="ri-description" /></div>
            <Separator />
            <Label className="text-sm font-medium">Line Items</Label>
            <LineItemsEditor items={form.line_items} setter={setForm} />
            <Separator />
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Tax Rate (%)</Label><Input type="number" value={form.tax_rate} onChange={e => setForm(p => ({ ...p, tax_rate: e.target.value }))} /></div>
              <div><Label>Payment Terms</Label>
                <Select value={form.payment_terms} onValueChange={v => setForm(p => ({ ...p, payment_terms: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(TERMS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Start Date</Label><Input type="date" value={form.start_date} onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))} /></div>
            </div>
            <div className="flex items-center gap-4 p-3 rounded-lg border">
              <Switch checked={form.auto_send} onCheckedChange={v => setForm(p => ({ ...p, auto_send: v }))} data-testid="ri-auto-send" />
              <div className="flex-1"><p className="text-sm font-medium">Auto-send invoices</p><p className="text-[10px] text-muted-foreground">Send through the shared Microsoft 365 mailbox; delivery is recorded for every invoice.</p></div>
              {form.auto_send && <Input value={form.auto_send_email} onChange={e => setForm(p => ({ ...p, auto_send_email: e.target.value }))} placeholder="accounts@client.com" className="w-64" />}
            </div>
            <div className="flex items-center gap-4 p-3 rounded-lg border bg-sky-500/[0.03] border-sky-500/20">
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
            <div className="flex items-center gap-4 p-3 rounded-lg border bg-indigo-500/[0.03] border-indigo-500/20">
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
            <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Invoice notes..." rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={createRecurring} disabled={saving} data-testid="ri-create-submit">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create Recurring Invoice"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* EDIT DIALOG */}
      <Dialog open={!!showEdit} onOpenChange={v => { if (!v) setShowEdit(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" aria-describedby="edit-ri-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Edit className="w-5 h-5" />Edit Recurring Invoice</DialogTitle>
            <DialogDescription id="edit-ri-desc">Update the recurring invoice settings</DialogDescription>
          </DialogHeader>
          {showEdit && (
            <div className="space-y-4">
              <div><Label>Description</Label><Input value={showEdit.description || ""} onChange={e => setShowEdit(p => ({ ...p, description: e.target.value }))} /></div>
              <Label className="text-sm font-medium">Line Items</Label>
              <LineItemsEditor items={showEdit.line_items || []} setter={setShowEdit} />
              <div className="grid grid-cols-3 gap-3">
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
              <div className="flex items-center gap-4 p-3 rounded-lg border">
                <Switch checked={showEdit.auto_send} onCheckedChange={v => setShowEdit(p => ({ ...p, auto_send: v }))} />
                <div><p className="text-sm font-medium">Auto-send</p></div>
                {showEdit.auto_send && <Input value={showEdit.auto_send_email || ""} onChange={e => setShowEdit(p => ({ ...p, auto_send_email: e.target.value }))} placeholder="accounts@client.com" className="w-64" />}
              </div>
              <div className="flex items-center gap-4 p-3 rounded-lg border bg-sky-500/[0.03] border-sky-500/20">
                <Switch checked={!!showEdit.include_acronis_usage} onCheckedChange={v => setShowEdit(p => ({ ...p, include_acronis_usage: v }))} data-testid="ri-edit-acronis-auto-toggle" />
                <div className="flex-1 flex items-start gap-2">
                  <Cloud className="w-4 h-4 text-sky-400 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Auto-attach Acronis usage</p>
                    <p className="text-[10px] text-muted-foreground">Auto-attach live Acronis usage as line items each generation.</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4 p-3 rounded-lg border bg-indigo-500/[0.03] border-indigo-500/20">
                <Switch checked={!!showEdit.include_pax8_usage} onCheckedChange={v => setShowEdit(p => ({ ...p, include_pax8_usage: v }))} data-testid="ri-edit-pax8-auto-toggle" />
                <div className="flex-1 flex items-start gap-2">
                  <Cloud className="w-4 h-4 text-indigo-400 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Auto-attach Pax8 / Microsoft subscriptions</p>
                    <p className="text-[10px] text-muted-foreground">Live seat × unit-price subs attached each generation.</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4 p-3 rounded-lg border bg-emerald-500/[0.03] border-emerald-500/20">
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
              <div><Label>Notes</Label><Textarea value={showEdit.notes || ""} onChange={e => setShowEdit(p => ({ ...p, notes: e.target.value }))} rows={2} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEdit(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save Changes"}</Button>
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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" aria-describedby="create-tpl-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileText className="w-5 h-5 text-blue-400" />New Invoice Template</DialogTitle>
            <DialogDescription id="create-tpl-desc">Create a reusable billing template</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
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
            </div>
            <div><Label>Description</Label><Input value={templateForm.description} onChange={e => setTemplateForm(p => ({ ...p, description: e.target.value }))} placeholder="Template description..." /></div>
            <Separator />
            <Label className="text-sm font-medium">Line Items</Label>
            <LineItemsEditor items={templateForm.line_items} setter={setTemplateForm} />
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Tax Rate (%)</Label><Input type="number" value={templateForm.tax_rate} onChange={e => setTemplateForm(p => ({ ...p, tax_rate: e.target.value }))} /></div>
              <div><Label>Payment Terms</Label>
                <Select value={templateForm.payment_terms} onValueChange={v => setTemplateForm(p => ({ ...p, payment_terms: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(TERMS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTemplateCreate(false)}>Cancel</Button>
            <Button onClick={createTemplate} disabled={saving} data-testid="tpl-create-submit">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create Template"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* APPLY TEMPLATE DIALOG */}
      <Dialog open={!!showApplyTemplate} onOpenChange={v => { if (!v) setShowApplyTemplate(null); }}>
        <DialogContent className="max-w-md" aria-describedby="apply-tpl-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Plus className="w-5 h-5 text-emerald-400" />Create from Template</DialogTitle>
            <DialogDescription id="apply-tpl-desc">Using: {showApplyTemplate?.name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Client</Label>
              <Select value={applyForm.client_id} onValueChange={v => { const c = clients.find(x => x.id === v); setApplyForm(p => ({ ...p, client_id: v, client_name: c?.name || "" })); }}>
                <SelectTrigger data-testid="apply-client"><SelectValue placeholder="Select client..." /></SelectTrigger>
                <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Frequency</Label>
              <Select value={applyForm.frequency} onValueChange={v => setApplyForm(p => ({ ...p, frequency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(FREQ_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Start Date</Label><Input type="date" value={applyForm.start_date} onChange={e => setApplyForm(p => ({ ...p, start_date: e.target.value }))} /></div>
            <div className="flex items-center gap-3 p-3 rounded-lg border">
              <Switch checked={applyForm.auto_send} onCheckedChange={v => setApplyForm(p => ({ ...p, auto_send: v }))} />
              <span className="text-sm">Auto-send invoices when generated (delivery is recorded)</span>
            </div>
            {applyForm.auto_send && <div><Label>Invoice recipient email</Label><Input type="email" value={applyForm.auto_send_email} onChange={e => setApplyForm(p => ({ ...p, auto_send_email: e.target.value }))} placeholder="accounts@client.com" /></div>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowApplyTemplate(null)}>Cancel</Button>
            <Button onClick={applyTemplate} disabled={saving} data-testid="apply-submit">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create Recurring Invoice"}</Button>
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
