import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { EmptyState, MetricStrip, MetricTile } from "@/components/design-system";
import { AlertTriangle, CircleDollarSign, Loader2, Pencil, PieChart, Plus, RefreshCw, Trash2, TrendingUp } from "lucide-react";
import { toast } from "sonner";

const CATEGORY_PRESETS = ["Hardware", "Software/Licenses", "Labor/Support", "Projects"];
const emptyForm = () => ({ client_id: "", annual_budget: "", ytd_spent: "", notes: "", categories: [] });
const money = (value) => `$${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const statusStyle = { on_track: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300", over_pace: "border-amber-500/25 bg-amber-500/10 text-amber-300", over_budget: "border-rose-500/25 bg-rose-500/10 text-rose-300" };

export default function ClientBudgetPage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [data, setData] = useState(null);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm());

  const load = useCallback(async (showToast = false) => {
    setRefreshing(true);
    try {
      const [budgetResponse, clientResponse] = await Promise.all([
        axios.get(`${API}/client-budget/overview`, { headers }),
        axios.get(`${API}/clients`, { headers }),
      ]);
      setData(budgetResponse.data);
      setClients(clientResponse.data || []);
      if (showToast) toast.success("Client budget evidence refreshed");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Client budgets could not be loaded");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setDialogOpen(true); };
  const openEdit = (budget) => { setEditing(budget); setForm({ client_id: budget.client_id, annual_budget: String(budget.annual_budget || ""), ytd_spent: String(budget.ytd_spent || ""), notes: budget.notes || "", categories: (budget.categories || []).map(category => ({ ...category })) }); setDialogOpen(true); };
  const addPreset = () => setForm(current => ({ ...current, categories: [...current.categories, ...CATEGORY_PRESETS.filter(name => !current.categories.some(category => category.name === name)).map(name => ({ name, budget: "", spent: "" }))] }));
  const addCategory = () => setForm(current => ({ ...current, categories: [...current.categories, { name: "", budget: "", spent: "" }] }));
  const updateCategory = (index, field, value) => setForm(current => ({ ...current, categories: current.categories.map((category, categoryIndex) => categoryIndex === index ? { ...category, [field]: value } : category) }));
  const removeCategory = (index) => setForm(current => ({ ...current, categories: current.categories.filter((_, categoryIndex) => categoryIndex !== index) }));

  const save = async () => {
    if (!form.client_id || Number(form.annual_budget) <= 0) { toast.error("Select a client and enter an annual budget above $0"); return; }
    if (form.categories.some(category => !String(category.name || "").trim())) { toast.error("Name each budget category or remove the blank row"); return; }
    const payload = { ...form, annual_budget: Number(form.annual_budget), ytd_spent: Number(form.ytd_spent || 0), categories: form.categories.map(category => ({ name: category.name.trim(), budget: Number(category.budget || 0), spent: Number(category.spent || 0) })) };
    setSaving(true);
    try {
      if (editing) await axios.put(`${API}/client-budget/${editing.id}`, payload, { headers });
      else await axios.post(`${API}/client-budget`, payload, { headers });
      toast.success(editing ? "Client budget updated" : "Client budget created");
      setDialogOpen(false);
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Client budget could not be saved");
    } finally { setSaving(false); }
  };

  const remove = async (budget) => {
    if (!window.confirm(`Remove the IT budget for ${budget.client_name}? This deletes the configured planning record.`)) return;
    try { await axios.delete(`${API}/client-budget/${budget.id}`, { headers }); toast.success("Client budget removed"); await load(); }
    catch (error) { toast.error(error.response?.data?.detail || "Client budget could not be removed"); }
  };

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  const summary = data?.summary || { total_annual_budget: 0, total_ytd_spent: 0, avg_utilization_pct: 0, clients_over_budget: 0, configured_clients: 0 };
  const budgets = data?.budgets || [];

  return <div className="space-y-5" data-testid="client-budget-page">
    <OperationalPageHeader eyebrow="Financial planning" title="Client IT Budgets" description="Explicit, client-linked planning records. Values are configured and auditable—NexusMSP does not invent client budgets or spending." icon={CircleDollarSign} tone="emerald" actions={<><Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing}><RefreshCw className={`mr-1 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />Refresh</Button><Button size="sm" onClick={openCreate}><Plus className="mr-1 h-4 w-4" />Configure budget</Button></>} />
    <MetricStrip columns={5}>
      <MetricTile label="Configured clients" value={summary.configured_clients || 0} accent="sky" icon={<CircleDollarSign />} testid="budget-configured" />
      <MetricTile label="Annual budget" value={money(summary.total_annual_budget)} accent="emerald" icon={<CircleDollarSign />} testid="budget-annual" />
      <MetricTile label="YTD spend" value={money(summary.total_ytd_spent)} accent="violet" icon={<TrendingUp />} testid="budget-ytd" />
      <MetricTile label="Average utilisation" value={`${summary.avg_utilization_pct || 0}%`} accent="amber" icon={<PieChart />} testid="budget-utilization" />
      <MetricTile label="Forecast over budget" value={summary.clients_over_budget || 0} accent="rose" icon={<AlertTriangle />} testid="budget-over" />
    </MetricStrip>
    {budgets.length === 0 ? <Card><CardContent><EmptyState icon={<CircleDollarSign className="h-10 w-10" />} title="No client budgets configured" description="Create a budget only when the client has approved a planning amount. It will remain linked to that client and visible in the audit trail." action={<Button onClick={openCreate}><Plus className="mr-1 h-4 w-4" />Configure first budget</Button>} /></CardContent></Card> : <div className="grid gap-4 lg:grid-cols-2">{budgets.map(budget => <BudgetCard key={budget.id} budget={budget} onEdit={() => openEdit(budget)} onDelete={() => remove(budget)} />)}</div>}
    <BudgetDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} form={form} setForm={setForm} clients={editing ? clients : clients.filter(client => !budgets.some(budget => budget.client_id === client.id))} saving={saving} onSave={save} onAddPreset={addPreset} onAddCategory={addCategory} onUpdateCategory={updateCategory} onRemoveCategory={removeCategory} />
  </div>;
}

function BudgetCard({ budget, onEdit, onDelete }) {
  const utilisation = budget.annual_budget > 0 ? Math.round((budget.ytd_spent / budget.annual_budget) * 100) : 0;
  const forecast = budget.annual_budget > 0 ? Math.round((budget.forecast_eoy / budget.annual_budget) * 100) : 0;
  return <Card className={budget.status === "over_budget" ? "border-rose-500/25" : ""} data-testid={`budget-${budget.id}`}><CardHeader className="pb-3"><div className="flex items-start justify-between gap-3"><div><CardTitle className="text-base">{budget.client_name}</CardTitle><p className="mt-1 text-xs text-muted-foreground">Forecast {money(budget.forecast_eoy)} by year end</p></div><div className="flex items-center gap-1"><Badge variant="outline" className={`text-[10px] capitalize ${statusStyle[budget.status] || statusStyle.on_track}`}>{(budget.status || "on_track").replaceAll("_", " ")}</Badge><Button variant="ghost" size="icon" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /><span className="sr-only">Edit budget</span></Button><Button variant="ghost" size="icon" className="text-rose-300 hover:text-rose-200" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /><span className="sr-only">Delete budget</span></Button></div></div></CardHeader><CardContent className="space-y-4"><div><div className="mb-1 flex justify-between text-xs"><span className="text-muted-foreground">YTD spend {money(budget.ytd_spent)} of {money(budget.annual_budget)}</span><span className="font-semibold">{utilisation}%</span></div><Progress value={Math.min(utilisation, 100)} className="h-2" /><div className="mt-1 flex justify-between text-[11px] text-muted-foreground"><span>Monthly run-rate {money(budget.monthly_spent)}</span><span>Forecast {forecast}%</span></div></div>{(budget.categories || []).length > 0 && <div className="space-y-2 border-t border-border/60 pt-3">{budget.categories.map(category => { const percentage = category.budget > 0 ? Math.round((category.spent / category.budget) * 100) : 0; return <div key={category.name}><div className="mb-1 flex justify-between text-[11px]"><span>{category.name}</span><span className="text-muted-foreground">{money(category.spent)} / {money(category.budget)} ({percentage}%)</span></div><Progress value={Math.min(percentage, 100)} className="h-1.5" /></div>; })}</div>}{budget.notes && <p className="border-t border-border/60 pt-3 text-xs text-muted-foreground">{budget.notes}</p>}</CardContent></Card>;
}

function BudgetDialog({ open, onOpenChange, editing, form, setForm, clients, saving, onSave, onAddPreset, onAddCategory, onUpdateCategory, onRemoveCategory }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-3xl gap-0 overflow-hidden border-emerald-500/25 bg-[linear-gradient(145deg,rgba(8,29,23,0.98),rgba(13,15,21,0.98))] p-0"><DialogHeader className="border-b border-emerald-400/15 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.16),transparent_45%),linear-gradient(135deg,rgba(56,189,248,0.07),transparent)] px-6 py-5 pr-14"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300">Client planning record</p><DialogTitle className="mt-1 flex items-center gap-2 text-xl text-zinc-100"><span className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-400/25 bg-emerald-400/10"><CircleDollarSign className="h-4 w-4 text-emerald-200" /></span>{editing ? "Refine client IT budget" : "Configure client IT budget"}</DialogTitle><DialogDescription className="mt-2">Enter approved planning amounts and actual YTD spend. The forecast is calculated from the recorded run rate and every change is audited.</DialogDescription></DialogHeader><div className="max-h-[68vh] space-y-5 overflow-y-auto px-6 py-5"><div className="grid gap-4 md:grid-cols-3"><Field label="Client *"><Select value={form.client_id || "select-client"} onValueChange={client_id => setForm(current => ({ ...current, client_id: client_id === "select-client" ? "" : client_id }))}><SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger><SelectContent><SelectItem value="select-client">Select client</SelectItem>{clients.map(client => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}</SelectContent></Select></Field><Field label="Annual budget *"><Input type="number" min="0" step="0.01" value={form.annual_budget} onChange={event => setForm(current => ({ ...current, annual_budget: event.target.value }))} placeholder="0.00" /></Field><Field label="Actual YTD spend"><Input type="number" min="0" step="0.01" value={form.ytd_spent} onChange={event => setForm(current => ({ ...current, ytd_spent: event.target.value }))} placeholder="0.00" /></Field></div><Field label="Planning notes"><Textarea rows={3} value={form.notes} onChange={event => setForm(current => ({ ...current, notes: event.target.value }))} placeholder="Approved scope, exclusions, client reference, or review date." /></Field><section className="space-y-3 border-t border-white/[0.07] pt-5"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-medium text-zinc-100">Budget categories</p><p className="mt-0.5 text-xs text-zinc-500">Optional. These are recorded planning allocations, not estimates generated by NexusMSP.</p></div><div className="flex gap-2"><Button type="button" variant="outline" size="sm" onClick={onAddPreset}>Add common categories</Button><Button type="button" variant="outline" size="sm" onClick={onAddCategory}><Plus className="mr-1 h-3.5 w-3.5" />Category</Button></div></div>{form.categories.map((category, index) => <div key={`${category.name}-${index}`} className="grid gap-2 rounded-xl border border-white/[0.08] bg-black/10 p-3 md:grid-cols-[1fr_150px_150px_auto]"><Input value={category.name} onChange={event => onUpdateCategory(index, "name", event.target.value)} placeholder="Category name" /><Input type="number" min="0" step="0.01" value={category.budget} onChange={event => onUpdateCategory(index, "budget", event.target.value)} placeholder="Allocated budget" /><Input type="number" min="0" step="0.01" value={category.spent} onChange={event => onUpdateCategory(index, "spent", event.target.value)} placeholder="YTD spend" /><Button type="button" variant="ghost" size="icon" className="text-rose-300 hover:text-rose-200" onClick={() => onRemoveCategory(index)}><Trash2 className="h-4 w-4" /><span className="sr-only">Remove category</span></Button></div>)}</section></div><DialogFooter className="border-t border-white/[0.07] bg-black/10 px-6 py-4"><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button className="bg-emerald-400 text-emerald-950 hover:bg-emerald-300" onClick={onSave} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{editing ? "Save budget" : "Create budget"}</Button></DialogFooter></DialogContent></Dialog>;
}

function Field({ label, children }) { return <div><Label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">{label}</Label>{children}</div>; }
