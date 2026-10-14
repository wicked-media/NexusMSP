import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import {
  Plus, Loader2, Edit, Trash2, Tag, ChevronDown, ChevronRight, AlertCircle, RefreshCw, Folder, ListTree, Hash, Save, BriefcaseBusiness, ArchiveRestore, CircleDollarSign
} from "lucide-react";

const PRIORITY_COLORS = {
  critical: "bg-red-500/20 text-red-400 border-red-500/30",
  high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  medium: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  low: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
};

const ICONS = ["monitor", "code", "wifi", "shield", "mail", "cloud", "user-plus", "clipboard", "server", "phone", "printer", "database", "lock", "settings", "zap", "folder"];

const DEFAULT_SCHEME = {
  incident: { prefix: "INC", description: "Incidents" },
  service_request: { prefix: "SR", description: "Service Requests" },
  problem: { prefix: "PRB", description: "Problems" },
  change_request: { prefix: "CHG", description: "Change Requests" },
  alert: { prefix: "ALR", description: "Alerts/Monitoring" },
  task: { prefix: "TSK", description: "Tasks" },
  default: { prefix: "TKT", description: "Default/Other" },
};

const EMPTY_LABOUR_TYPE = { name: "", code: "", description: "", hourly_rate: "", billable_default: true, sort_order: 0 };

function LabourTypesPanel({ headers }) {
  const [labourTypes, setLabourTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_LABOUR_TYPE);
  const [saving, setSaving] = useState(false);

  const fetchLabourTypes = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await axios.get(`${API}/labour-types`, { headers });
      setLabourTypes(Array.isArray(response.data) ? response.data : response.data?.labour_types || []);
    } catch (error) {
      setLoadError(error.response?.status === 403
        ? "You can log time, but an administrator must manage the organisation labour-type catalogue."
        : error.response?.data?.detail || "Could not load labour types.");
    } finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { fetchLabourTypes(); }, [fetchLabourTypes]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_LABOUR_TYPE, sort_order: labourTypes.filter(type => type.is_active !== false).length + 1 });
    setDialogOpen(true);
  };
  const openEdit = (type) => {
    setEditing(type);
    setForm({
      name: type.name || "", code: type.code || "", description: type.description || "",
      hourly_rate: String(type.hourly_rate ?? ""), billable_default: type.billable_default !== false,
      sort_order: type.sort_order ?? 0,
    });
    setDialogOpen(true);
  };
  const save = async () => {
    if (!form.name.trim()) { toast.error("A labour type name is required"); return; }
    if (form.hourly_rate === "" || !Number.isFinite(Number(form.hourly_rate)) || Number(form.hourly_rate) < 0) { toast.error("Enter a valid hourly rate"); return; }
    setSaving(true);
    const payload = { ...form, hourly_rate: Number(form.hourly_rate), sort_order: Number(form.sort_order) || 0 };
    try {
      if (editing) {
        await axios.put(`${API}/labour-types/${editing.id}`, { ...payload, expected_version: editing.version }, { headers });
        toast.success("Labour type updated");
      } else {
        await axios.post(`${API}/labour-types`, payload, { headers });
        toast.success("Labour type created");
      }
      setDialogOpen(false);
      await fetchLabourTypes();
    } catch (error) { toast.error(error.response?.data?.detail || "Could not save labour type"); }
    finally { setSaving(false); }
  };
  const setActive = async (type, isActive) => {
    try {
      if (isActive) {
        await axios.put(`${API}/labour-types/${type.id}`, { is_active: true, expected_version: type.version }, { headers });
        toast.success("Labour type restored");
      } else {
        await axios.delete(`${API}/labour-types/${type.id}?expected_version=${encodeURIComponent(type.version)}`, { headers });
        toast.success("Labour type archived; historic time remains unchanged");
      }
      await fetchLabourTypes();
    } catch (error) { toast.error(error.response?.data?.detail || "Could not update labour type"); }
  };

  if (loading) return <Card><CardContent className="flex min-h-48 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-cyan-300" /></CardContent></Card>;
  if (loadError) return <Card className="border-amber-400/20"><CardContent className="flex min-h-48 flex-col items-center justify-center gap-3 text-center"><AlertCircle className="h-6 w-6 text-amber-300" /><p className="max-w-md text-sm text-muted-foreground">{loadError}</p><Button variant="outline" size="sm" onClick={fetchLabourTypes}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Try again</Button></CardContent></Card>;

  const active = labourTypes.filter(type => type.is_active !== false);
  const archived = labourTypes.filter(type => type.is_active === false);
  return <div className="space-y-4" data-testid="labour-types-settings">
    <Card className="overflow-hidden border-cyan-400/20 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.09),transparent_42%),rgba(8,12,20,0.42)]">
      <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex min-w-0 items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-400/10"><BriefcaseBusiness className="h-5 w-5 text-cyan-200" /></span><div><p className="font-semibold text-cyan-50">Labour type catalogue</p><p className="mt-1 max-w-xl text-xs leading-5 text-zinc-400">Set the names, default billability and rates technicians select when recording work. Nexus snapshots those values on the time entry, so changing this catalogue never rewrites history.</p></div></div>
        <Button onClick={openCreate} data-testid="create-labour-type"><Plus className="mr-1.5 h-4 w-4" />New labour type</Button>
      </CardContent>
    </Card>
    <div className="grid gap-3 sm:grid-cols-3">
      <Card><CardContent className="flex items-center gap-3 p-4"><BriefcaseBusiness className="h-5 w-5 text-cyan-300" /><div><p className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">Active types</p><p className="text-xl font-semibold">{active.length}</p></div></CardContent></Card>
      <Card><CardContent className="flex items-center gap-3 p-4"><CircleDollarSign className="h-5 w-5 text-emerald-300" /><div><p className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">Default billable</p><p className="text-xl font-semibold">{active.filter(type => type.billable_default !== false).length}</p></div></CardContent></Card>
      <Card><CardContent className="flex items-center gap-3 p-4"><ArchiveRestore className="h-5 w-5 text-zinc-400" /><div><p className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">Archived</p><p className="text-xl font-semibold">{archived.length}</p></div></CardContent></Card>
    </div>
    <div className="space-y-2">
      {active.map(type => <Card key={type.id} className="border-white/[0.08] transition hover:border-cyan-300/25"><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{type.name}</p>{type.code && <Badge variant="outline" className="font-mono text-[10px]">{type.code}</Badge>}<Badge variant="outline" className={type.billable_default !== false ? "border-emerald-400/25 text-emerald-200" : "border-zinc-500/30 text-zinc-400"}>{type.billable_default !== false ? "Billable by default" : "Non-billable by default"}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{type.description || "No description"} <span className="text-zinc-600">· Order {type.sort_order || 0}</span></p></div><div className="flex items-center gap-2"><span className="rounded-lg border border-cyan-400/15 bg-cyan-400/[0.05] px-2 py-1 font-mono text-xs text-cyan-100">${Number(type.hourly_rate || 0).toFixed(2)}/hr</span><Button variant="ghost" size="sm" onClick={() => openEdit(type)}><Edit className="mr-1 h-3.5 w-3.5" />Edit</Button><Button variant="ghost" size="sm" className="text-zinc-400 hover:text-amber-200" onClick={() => setActive(type, false)}><ArchiveRestore className="mr-1 h-3.5 w-3.5" />Archive</Button></div></CardContent></Card>)}
      {!active.length && <Card className="border-dashed"><CardContent className="py-12 text-center"><BriefcaseBusiness className="mx-auto mb-3 h-8 w-8 text-zinc-600" /><p className="text-sm text-muted-foreground">No labour types are configured. Technicians will use their trusted default rate until you add one.</p><Button className="mt-4" onClick={openCreate}>Create first labour type</Button></CardContent></Card>}
      {archived.length > 0 && <div className="pt-3"><p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Archived</p>{archived.map(type => <div key={type.id} className="mb-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 opacity-75"><span className="text-sm line-through">{type.name}</span><Button variant="ghost" size="sm" onClick={() => setActive(type, true)}><ArchiveRestore className="mr-1 h-3.5 w-3.5" />Restore</Button></div>)}</div>}
    </div>
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogContent><DialogHeader><DialogTitle>{editing ? "Edit labour type" : "New labour type"}</DialogTitle></DialogHeader><div className="space-y-4"><div className="grid gap-3 sm:grid-cols-[1fr_130px]"><div><Label>Name *</Label><Input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="e.g. Remote support" data-testid="labour-type-name" /></div><div><Label>Code</Label><Input value={form.code} onChange={event => setForm({ ...form, code: event.target.value.toUpperCase() })} placeholder="REMOTE" maxLength={24} /></div></div><div><Label>Description</Label><Textarea value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} rows={2} placeholder="When should a technician select this?" /></div><div className="grid gap-3 sm:grid-cols-2"><div><Label>Hourly rate *</Label><Input type="number" min="0" step="0.01" value={form.hourly_rate} onChange={event => setForm({ ...form, hourly_rate: event.target.value })} data-testid="labour-type-rate" /></div><div><Label>Display order</Label><Input type="number" min="0" value={form.sort_order} onChange={event => setForm({ ...form, sort_order: event.target.value })} /></div></div><label className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.025] p-3 text-sm"><input type="checkbox" checked={form.billable_default} onChange={event => setForm({ ...form, billable_default: event.target.checked })} />Billable by default</label></div><DialogFooter><Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button><Button disabled={saving} onClick={save}>{saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{editing ? "Save changes" : "Create labour type"}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}

export default function TicketSettingsPage() {
  const { token } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState(requestedTab === "labour" ? "labour" : requestedTab === "categories" ? "categories" : "numbering");
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedCat, setExpandedCat] = useState(null);
  const [catDialog, setCatDialog] = useState(false);
  const [editingCat, setEditingCat] = useState(null);
  const [issueDialog, setIssueDialog] = useState(false);
  const [issueCatId, setIssueCatId] = useState(null);
  const [catForm, setCatForm] = useState({ name: "", description: "", icon: "folder", color: "#3b82f6", sort_order: 99 });
  const [issueForm, setIssueForm] = useState({ name: "", description: "", priority: "medium" });

  // Ticket numbering state
  const [numberingScheme, setNumberingScheme] = useState(DEFAULT_SCHEME);
  const [padDigits, setPadDigits] = useState(4);
  const [separator, setSeparator] = useState("-");
  const [numberingSaving, setNumberingSaving] = useState(false);
  const [workPrefixes, setWorkPrefixes] = useState({ sla_prefix: "SLA-", workshop_prefix: "WS-", cabling_prefix: "CW-" });
  const [workPrefixesSaving, setWorkPrefixesSaving] = useState(false);

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const fetchCategories = useCallback(async () => {
    setLoading(true);
    try {
      const [catRes, numRes, workPrefixesRes] = await Promise.all([
        axios.get(`${API}/ticket-categories/all`, { headers }),
        axios.get(`${API}/ticket-numbering`, { headers }),
        axios.get(`${API}/settings/job-numbering`, { headers }).catch(() => ({ data: null })),
      ]);
      setCategories(catRes.data);
      if (numRes.data.scheme) setNumberingScheme(numRes.data.scheme);
      if (numRes.data.pad_digits) setPadDigits(numRes.data.pad_digits);
      if (numRes.data.separator) setSeparator(numRes.data.separator);
      if (workPrefixesRes.data) setWorkPrefixes(current => ({ ...current, ...workPrefixesRes.data }));
    } catch { toast.error("Failed to load settings"); }
    finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { fetchCategories(); }, [fetchCategories]);

  useEffect(() => {
    if (["numbering", "categories", "labour"].includes(requestedTab)) {
      setActiveTab(requestedTab);
    }
  }, [requestedTab]);

  const handleTabChange = (nextTab) => {
    setActiveTab(nextTab);
    const nextParams = new URLSearchParams(searchParams);
    if (nextTab === "numbering") nextParams.delete("tab");
    else nextParams.set("tab", nextTab);
    setSearchParams(nextParams, { replace: true });
  };

  const openAddCategory = () => {
    setEditingCat(null);
    setCatForm({ name: "", description: "", icon: "folder", color: "#3b82f6", sort_order: categories.length + 1 });
    setCatDialog(true);
  };

  const openEditCategory = (cat) => {
    setEditingCat(cat);
    setCatForm({ name: cat.name, description: cat.description || "", icon: cat.icon || "folder", color: cat.color || "#3b82f6", sort_order: cat.sort_order || 0 });
    setCatDialog(true);
  };

  const handleSaveCategory = async () => {
    if (!catForm.name) { toast.error("Category name is required"); return; }
    try {
      if (editingCat) {
        await axios.put(`${API}/ticket-categories/${editingCat.id}`, catForm, { headers });
        toast.success("Category updated");
      } else {
        await axios.post(`${API}/ticket-categories`, { ...catForm, issue_types: [] }, { headers });
        toast.success("Category created");
      }
      setCatDialog(false); fetchCategories();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to save category"); }
  };

  const handleDeleteCategory = async (catId) => {
    try {
      await axios.delete(`${API}/ticket-categories/${catId}`, { headers });
      toast.success("Category deactivated");
      fetchCategories();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to delete"); }
  };

  const openAddIssue = (catId) => {
    setIssueCatId(catId);
    setIssueForm({ name: "", description: "", priority: "medium" });
    setIssueDialog(true);
  };

  const handleAddIssue = async () => {
    if (!issueForm.name) { toast.error("Issue name is required"); return; }
    try {
      await axios.post(`${API}/ticket-categories/${issueCatId}/issue-types`, issueForm, { headers });
      toast.success("Issue type added");
      setIssueDialog(false); fetchCategories();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to add issue type"); }
  };

  const handleDeleteIssue = async (catId, issueId) => {
    try {
      await axios.delete(`${API}/ticket-categories/${catId}/issue-types/${issueId}`, { headers });
      toast.success("Issue type removed");
      fetchCategories();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to remove issue type"); }
  };

  const toggleExpand = (catId) => setExpandedCat(expandedCat === catId ? null : catId);

  const displaySeparator = separator === "none" ? "" : separator;
  const activeCats = categories.filter(c => c.is_active);
  const inactiveCats = categories.filter(c => !c.is_active);

  const handleSaveNumbering = async () => {
    setNumberingSaving(true);
    try {
      await axios.put(`${API}/ticket-numbering`, { scheme: numberingScheme, pad_digits: padDigits, separator: displaySeparator }, { headers });
      toast.success("Ticket numbering scheme saved");
    } catch { toast.error("Failed to save numbering scheme"); }
    finally { setNumberingSaving(false); }
  };

  const updatePrefix = (typeKey, prefix) => {
    setNumberingScheme(prev => ({
      ...prev,
      [typeKey]: { ...prev[typeKey], prefix: prefix.toUpperCase().replace(/[^A-Z0-9]/g, "") }
    }));
  };

  const handleSaveWorkPrefixes = async () => {
    setWorkPrefixesSaving(true);
    try {
      await axios.put(`${API}/settings/job-numbering`, workPrefixes, { headers });
      toast.success("Work order prefixes saved");
    } catch { toast.error("Failed to save work order prefixes"); }
    finally { setWorkPrefixesSaving(false); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="space-y-6" data-testid="ticket-settings-page">
      <OperationalPageHeader
        eyebrow="Service desk standards"
        title="Ticket Configuration"
        description="Set the numbering, categories and issue types that make ticket intake consistent across the service desk."
        icon={ListTree}
        tone="sky"
        actions={<Button variant="outline" size="sm" onClick={fetchCategories}><RefreshCw className="mr-1.5 h-4 w-4" />Refresh</Button>}
      />

      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList>
          <TabsTrigger value="numbering"><Hash className="w-3 h-3 mr-1" />Ticket Numbering</TabsTrigger>
          <TabsTrigger value="categories"><Tag className="w-3 h-3 mr-1" />Categories & Issues</TabsTrigger>
          <TabsTrigger value="labour"><BriefcaseBusiness className="w-3 h-3 mr-1" />Labour Types</TabsTrigger>
        </TabsList>

        {/* ===== NUMBERING SCHEME TAB ===== */}
        <TabsContent value="numbering" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Hash className="w-5 h-5 text-primary" />Ticket Number Scheme</CardTitle>
              <p className="text-sm text-muted-foreground">Configure how ticket numbers are generated based on ticket type. Inspired by Halo PSA, Syncro, and Flamingo MSP.</p>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Global settings */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Separator Character</Label>
                  <Select value={separator} onValueChange={setSeparator}>
                    <SelectTrigger data-testid="separator-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="-">Hyphen ( - )</SelectItem>
                      <SelectItem value="#">Hash ( # )</SelectItem>
                      <SelectItem value="none">None</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Number Padding (digits)</Label>
                  <Select value={String(padDigits)} onValueChange={v => setPadDigits(parseInt(v))}>
                    <SelectTrigger data-testid="padding-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="3">3 digits (001)</SelectItem>
                      <SelectItem value="4">4 digits (0001)</SelectItem>
                      <SelectItem value="5">5 digits (00001)</SelectItem>
                      <SelectItem value="6">6 digits (000001)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Separator />

              {/* Per-type prefix config */}
              <div className="space-y-3">
                <Label className="text-sm font-semibold">Prefix by Ticket Type</Label>
                <div className="grid grid-cols-1 gap-2">
                  {Object.entries(numberingScheme).map(([typeKey, config]) => {
                    const exampleNum = `${config.prefix}${displaySeparator}${"1".padStart(padDigits, "0")}`;
                    return (
                      <div key={typeKey} className="flex items-center gap-4 py-2 px-3 rounded-lg bg-muted/30 border border-border/50" data-testid={`numbering-${typeKey}`}>
                        <div className="w-40">
                          <p className="text-sm font-medium capitalize">{typeKey.replace(/_/g, " ")}</p>
                          <p className="text-[10px] text-muted-foreground">{config.description}</p>
                        </div>
                        <div className="flex-1">
                          <Input
                            value={config.prefix}
                            onChange={e => updatePrefix(typeKey, e.target.value)}
                            className="h-8 w-28 font-mono text-sm uppercase"
                            maxLength={6}
                            data-testid={`prefix-${typeKey}`}
                          />
                        </div>
                        <div className="w-40 text-right">
                          <Badge variant="outline" className="font-mono text-xs">{exampleNum}</Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={handleSaveNumbering} disabled={numberingSaving} data-testid="save-numbering-btn">
                  <Save className="w-4 h-4 mr-1" />{numberingSaving ? "Saving..." : "Save Numbering Scheme"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Preview Card */}
          <Card className="border-primary/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Preview Examples</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3">
                {Object.entries(numberingScheme).map(([typeKey, config]) => (
                  <div key={typeKey} className="flex items-center gap-2 py-1.5 px-3 rounded-lg bg-muted/50 border">
                    <span className="text-xs text-muted-foreground capitalize">{typeKey.replace(/_/g, " ")}:</span>
                    <Badge className="font-mono bg-primary/10 text-primary border-primary/20">{config.prefix}{displaySeparator}{"42".padStart(padDigits, "0")}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-sky-500/20" data-testid="work-order-prefixes-card">
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Hash className="w-5 h-5 text-sky-300" />Work order prefixes</CardTitle><p className="text-sm text-muted-foreground">Prefixes for SLA, workshop, and cabling work orders. Keep these alongside ticket numbering so technicians can find all numbering rules together.</p></CardHeader>
            <CardContent className="space-y-4"><div className="grid grid-cols-1 gap-4 md:grid-cols-3"><div className="space-y-2"><Label>SLA work</Label><Input value={workPrefixes.sla_prefix} onChange={e => setWorkPrefixes(current => ({ ...current, sla_prefix: e.target.value }))} placeholder="SLA-" /><p className="text-xs text-muted-foreground">Example: {workPrefixes.sla_prefix || "SLA-"}00001</p></div><div className="space-y-2"><Label>Workshop work</Label><Input value={workPrefixes.workshop_prefix} onChange={e => setWorkPrefixes(current => ({ ...current, workshop_prefix: e.target.value }))} placeholder="WS-" /><p className="text-xs text-muted-foreground">Example: {workPrefixes.workshop_prefix || "WS-"}00001</p></div><div className="space-y-2"><Label>Cabling / WISP work</Label><Input value={workPrefixes.cabling_prefix} onChange={e => setWorkPrefixes(current => ({ ...current, cabling_prefix: e.target.value }))} placeholder="CW-" /><p className="text-xs text-muted-foreground">Example: {workPrefixes.cabling_prefix || "CW-"}00001</p></div></div><div className="flex justify-end"><Button onClick={handleSaveWorkPrefixes} disabled={workPrefixesSaving}>{workPrefixesSaving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}{workPrefixesSaving ? "Saving..." : "Save work order prefixes"}</Button></div></CardContent>
          </Card>
        </TabsContent>

        {/* ===== CATEGORIES TAB ===== */}
        <TabsContent value="categories" className="space-y-4">
          <div className="flex items-center justify-between">
            <div />
            <Button onClick={openAddCategory} data-testid="add-category-btn"><Plus className="w-4 h-4 mr-1" />Add Category</Button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <Card><CardContent className="pt-4"><div className="flex items-center gap-2"><Folder className="w-5 h-5 text-blue-500" /><div><p className="text-xs text-muted-foreground">Categories</p><p className="text-xl font-bold">{activeCats.length}</p></div></div></CardContent></Card>
            <Card><CardContent className="pt-4"><div className="flex items-center gap-2"><ListTree className="w-5 h-5 text-emerald-500" /><div><p className="text-xs text-muted-foreground">Total Issue Types</p><p className="text-xl font-bold">{activeCats.reduce((acc, c) => acc + (c.issue_types?.length || 0), 0)}</p></div></div></CardContent></Card>
            <Card><CardContent className="pt-4"><div className="flex items-center gap-2"><AlertCircle className="w-5 h-5 text-amber-500" /><div><p className="text-xs text-muted-foreground">Inactive Categories</p><p className="text-xl font-bold">{inactiveCats.length}</p></div></div></CardContent></Card>
          </div>

          {/* Categories List */}
          <div className="space-y-2">
            {activeCats.map(cat => {
              const isExpanded = expandedCat === cat.id;
              const issueCount = cat.issue_types?.length || 0;
              return (
                <Card key={cat.id} className={`transition-all ${isExpanded ? "border-primary/40" : ""}`} data-testid={`category-card-${cat.id}`}>
                  <CardContent className="py-0">
                    <div className="flex items-center justify-between py-4 cursor-pointer" onClick={() => toggleExpand(cat.id)}>
                      <div className="flex items-center gap-3">
                        {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: cat.color + "20" }}>
                          <Tag className="w-4 h-4" style={{ color: cat.color }} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-semibold">{cat.name}</p>
                            <Badge variant="secondary" className="text-[10px]">{issueCount} issue{issueCount !== 1 ? "s" : ""}</Badge>
                          </div>
                          {cat.description && <p className="text-xs text-muted-foreground">{cat.description}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                        <Button variant="ghost" size="sm" className="h-7" onClick={() => openAddIssue(cat.id)} data-testid={`add-issue-${cat.id}`}><Plus className="w-3 h-3 mr-1" />Issue</Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEditCategory(cat)} data-testid={`edit-cat-${cat.id}`}><Edit className="w-3 h-3" /></Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => handleDeleteCategory(cat.id)} data-testid={`delete-cat-${cat.id}`}><Trash2 className="w-3 h-3" /></Button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="pb-4 pl-12 space-y-1">
                        {(cat.issue_types || []).map(issue => {
                          const pc = PRIORITY_COLORS[issue.priority] || PRIORITY_COLORS.medium;
                          return (
                            <div key={issue.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors" data-testid={`issue-${issue.id}`}>
                              <div className="flex items-center gap-3">
                                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cat.color }} />
                                <span className="text-sm">{issue.name}</span>
                                <Badge className={`text-[10px] ${pc}`}>{issue.priority}</Badge>
                              </div>
                              <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive opacity-0 group-hover:opacity-100 hover:opacity-100" onClick={() => handleDeleteIssue(cat.id, issue.id)} data-testid={`delete-issue-${issue.id}`}><Trash2 className="w-3 h-3" /></Button>
                            </div>
                          );
                        })}
                        {issueCount === 0 && <p className="text-sm text-muted-foreground py-2">No issue types defined. Click "+ Issue" to add one.</p>}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
            {activeCats.length === 0 && (
              <Card className="border-dashed"><CardContent className="py-12 text-center">
                <Tag className="w-12 h-12 mx-auto text-muted-foreground mb-3 opacity-30" />
                <p className="text-muted-foreground mb-3">No ticket categories configured</p>
                <Button onClick={openAddCategory}><Plus className="w-4 h-4 mr-1" />Create First Category</Button>
              </CardContent></Card>
            )}
          </div>

          {inactiveCats.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-2">Inactive Categories</h3>
              <div className="space-y-2">
                {inactiveCats.map(cat => (
                  <Card key={cat.id} className="opacity-60">
                    <CardContent className="py-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Tag className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm line-through">{cat.name}</span>
                        <Badge variant="outline" className="text-[10px]">{cat.issue_types?.length || 0} issues</Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="labour" className="space-y-4">
          <LabourTypesPanel headers={headers} />
        </TabsContent>
      </Tabs>

      {/* CATEGORY DIALOG */}
      <Dialog open={catDialog} onOpenChange={v => { setCatDialog(v); if (!v) setEditingCat(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingCat ? "Edit Category" : "New Ticket Category"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Category Name *</Label><Input value={catForm.name} onChange={e => setCatForm({ ...catForm, name: e.target.value })} placeholder="e.g. Hardware, Network, Security" data-testid="cat-name-input" /></div>
            <div><Label>Description</Label><Textarea value={catForm.description} onChange={e => setCatForm({ ...catForm, description: e.target.value })} rows={2} placeholder="Brief description of this category" /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Icon</Label>
                <Select value={catForm.icon} onValueChange={v => setCatForm({ ...catForm, icon: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{ICONS.map(i => <SelectItem key={`k-${i}`} value={i}>{i}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Color</Label><Input type="color" value={catForm.color} onChange={e => setCatForm({ ...catForm, color: e.target.value })} className="h-10 cursor-pointer" data-testid="cat-color-input" /></div>
              <div><Label>Sort Order</Label><Input type="number" value={catForm.sort_order} onChange={e => setCatForm({ ...catForm, sort_order: parseInt(e.target.value) || 0 })} /></div>
            </div>
          </div>
          <DialogFooter><Button onClick={handleSaveCategory} data-testid="save-category-btn">{editingCat ? "Update" : "Create"} Category</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ISSUE TYPE DIALOG */}
      <Dialog open={issueDialog} onOpenChange={setIssueDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Issue Type</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Issue Name *</Label><Input value={issueForm.name} onChange={e => setIssueForm({ ...issueForm, name: e.target.value })} placeholder="e.g. Broken Equipment, Password Reset" data-testid="issue-name-input" /></div>
            <div><Label>Description</Label><Textarea value={issueForm.description} onChange={e => setIssueForm({ ...issueForm, description: e.target.value })} rows={2} placeholder="Optional description" /></div>
            <div><Label>Default Priority</Label>
              <Select value={issueForm.priority} onValueChange={v => setIssueForm({ ...issueForm, priority: v })}>
                <SelectTrigger data-testid="issue-priority-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter><Button onClick={handleAddIssue} data-testid="save-issue-btn">Add Issue Type</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
