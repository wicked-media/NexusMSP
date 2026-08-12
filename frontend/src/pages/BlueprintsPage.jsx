import { useEffect, useMemo, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Clipboard, Plus, Trash2, Edit2, Loader2, ListChecks, Wand2, GripVertical, X, Sparkles, Users, ChevronRight, Send, GitBranch, Monitor } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import HeroTile from "@/components/HeroTile";

const FIELD_TYPES = [
  { value: "text", label: "Short text" },
  { value: "textarea", label: "Long text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "select", label: "Dropdown" },
  { value: "checkbox", label: "Checkbox" },
];

const PRIORITY_OPTS = ["low", "medium", "high", "critical"];
const STATUS_OPTS = ["open", "in_progress", "on_hold"];
const BLUEPRINT_TABS = ["library", "patterns"];

const EMPTY_BP = {
  name: "", description: "", icon: "Clipboard", color: "sky",
  default_priority: "", default_category: "", default_status: "",
  sla_minutes: "", require_completion: false, fields: [], checklist: [], child_templates: [],
};

const slugify = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export default function BlueprintsPage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const resolvedTab = BLUEPRINT_TABS.includes(requestedTab) ? requestedTab : (searchParams.get("pattern") ? "patterns" : "library");
  const [activeTab, setActiveTab] = useState(resolvedTab);
  const [bps, setBps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_BP);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/blueprints?active_only=false`, { headers });
      setBps(res.data || []);
    } catch { toast.error("Load failed"); }
    finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setActiveTab(resolvedTab); }, [resolvedTab]);

  const selectTab = (nextTab) => {
    const nextParams = new URLSearchParams(searchParams);
    if (nextTab === "library") nextParams.delete("tab");
    else nextParams.set("tab", nextTab);
    setSearchParams(nextParams, { replace: true });
  };

  const openCreate = () => { setEditing(null); setForm(EMPTY_BP); setOpen(true); };
  const openEdit = (bp) => {
    setEditing(bp);
    setForm({
      ...EMPTY_BP, ...bp,
      sla_minutes: bp.sla_minutes ?? "",
      default_priority: bp.default_priority || "",
      default_category: bp.default_category || "",
      default_status: bp.default_status || "",
      fields: bp.fields || [],
      checklist: bp.checklist || [],
      child_templates: bp.child_templates || [],
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error("Name required"); return; }
    setSaving(true);
    try {
      const body = {
        ...form,
        sla_minutes: form.sla_minutes ? Number(form.sla_minutes) : null,
        default_priority: form.default_priority || null,
        default_category: form.default_category || null,
        default_status: form.default_status || null,
      };
      if (editing) {
        await axios.put(`${API}/blueprints/${editing.id}`, body, { headers });
        toast.success("Blueprint updated");
      } else {
        await axios.post(`${API}/blueprints`, body, { headers });
        toast.success("Blueprint created");
      }
      setOpen(false); load();
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setSaving(false); }
  };

  const remove = async (bp) => {
    if (!window.confirm(`Archive "${bp.name}"?`)) return;
    try {
      await axios.delete(`${API}/blueprints/${bp.id}`, { headers });
      toast.success("Archived"); load();
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
  };

  const installStarterLibrary = async () => {
    setInstalling(true);
    try {
      const response = await axios.post(`${API}/blueprints/install-starter-library`, {}, { headers });
      const count = response.data?.installed?.length || 0;
      toast.success(count ? `${count} MSP starter blueprints installed` : "Starter library is already installed");
      await load();
    } catch (error) { toast.error(error.response?.data?.detail || "Could not install starter blueprints"); }
    finally { setInstalling(false); }
  };

  const addField = () => setForm((f) => ({ ...f, fields: [...f.fields, { key: "", label: "", type: "text", required: false, placeholder: "", options: [] }] }));
  const updateField = (i, patch) => setForm((f) => {
    const nf = [...f.fields]; nf[i] = { ...nf[i], ...patch };
    if (patch.label !== undefined && !nf[i].key) nf[i].key = slugify(patch.label);
    return { ...f, fields: nf };
  });
  const removeField = (i) => setForm((f) => ({ ...f, fields: f.fields.filter((_, idx) => idx !== i) }));

  const addChecklistItem = () => setForm((f) => ({ ...f, checklist: [...f.checklist, { id: `cl-${Date.now()}-${f.checklist.length}`, label: "", required: false }] }));
  const updateChecklist = (i, patch) => setForm((f) => {
    const nc = [...f.checklist]; nc[i] = { ...nc[i], ...patch }; return { ...f, checklist: nc };
  });
  const removeChecklist = (i) => setForm((f) => ({ ...f, checklist: f.checklist.filter((_, idx) => idx !== i) }));

  const addChildTemplate = () => setForm((f) => ({
    ...f,
    child_templates: [...f.child_templates, {
      id: `child-${Date.now()}-${f.child_templates.length}`,
      title: "",
      description: "",
      priority: "medium",
      category: "onboarding",
      blueprint_id: "",
      per_device: false,
      required: true,
    }],
  }));
  const updateChildTemplate = (i, patch) => setForm((f) => {
    const child_templates = [...f.child_templates];
    child_templates[i] = { ...child_templates[i], ...patch };
    return { ...f, child_templates };
  });
  const removeChildTemplate = (i) => setForm((f) => ({ ...f, child_templates: f.child_templates.filter((_, idx) => idx !== i) }));

  return (
    <div className="space-y-5" data-testid="blueprints-page">
      <div className="rounded-2xl border border-sky-500/20 bg-gradient-to-br from-sky-500/[0.10] via-background to-background p-5 md:p-6"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-sky-300">Service design</p><h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight"><Clipboard className="h-6 w-6 text-sky-300" />Ticket Blueprints</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Reusable ticket playbooks with intake fields, completion gates, and client-ready defaults.</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={installStarterLibrary} disabled={installing} data-testid="install-starter-blueprints">{installing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}Install MSP starters</Button><Button onClick={openCreate} data-testid="blueprints-new-btn"><Plus className="mr-2 h-4 w-4" />New blueprint</Button></div></div></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <HeroTile label="Active blueprints" value={bps.filter(bp => bp.active !== false).length} icon={Clipboard} glow="sky" subtitle="Ready for ticket intake" testId="blueprints-stat-active" />
        <HeroTile label="Completion gates" value={bps.filter(bp => bp.require_completion && bp.active !== false).length} icon={ListChecks} glow="amber" subtitle="Require technician sign-off" testId="blueprints-stat-gates" />
        <HeroTile label="Worksheet fields" value={bps.reduce((total, bp) => total + (bp.fields?.length || 0), 0)} icon={Wand2} glow="violet" subtitle="Structured intake prompts" testId="blueprints-stat-fields" />
        <HeroTile label="Starter library" value={bps.filter(bp => bp.starter_template && bp.active !== false).length} icon={Sparkles} glow="emerald" subtitle="MSP-ready templates" testId="blueprints-stat-starters" />
      </div>

      <Tabs value={activeTab} onValueChange={selectTab}>
        <TabsList>
          <TabsTrigger value="library" data-testid="blueprints-tab-library"><Clipboard className="w-3 h-3 mr-1" />Library</TabsTrigger>
          <TabsTrigger value="patterns" data-testid="blueprints-tab-patterns"><Sparkles className="w-3 h-3 mr-1" />Pattern Discovery</TabsTrigger>
        </TabsList>

        <TabsContent value="library" className="mt-4">
          <Card className="overflow-hidden border-border/70">
            <CardContent className="p-0">
          {loading ? (
            <div className="p-12 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Loading…</div>
          ) : bps.length === 0 ? (
            <div className="p-16 text-center text-sm text-muted-foreground">
              <Clipboard className="mx-auto mb-3 h-8 w-8 text-sky-400/60" />No blueprints yet. Install the MSP starter library or create a focused workflow from scratch.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Fields</TableHead>
                  <TableHead>Checklist</TableHead>
                  <TableHead>Delivery plan</TableHead>
                  <TableHead>Defaults</TableHead>
                  <TableHead>Gates</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bps.map((bp) => (
                  <TableRow key={bp.id} data-testid={`blueprint-row-${bp.id}`}>
                    <TableCell>
                      <div className="font-medium">{bp.name}</div>
                      <div className="text-[10px] text-muted-foreground line-clamp-1">{bp.description}</div>
                    </TableCell>
                    <TableCell><Badge variant="outline">{(bp.fields || []).length} fields</Badge></TableCell>
                    <TableCell><Badge variant="outline">{(bp.checklist || []).length} items</Badge></TableCell>
                    <TableCell>{bp.child_templates?.length ? <Badge variant="outline" className="border-cyan-500/25 bg-cyan-500/[0.06] text-cyan-200"><GitBranch className="mr-1 h-3 w-3" />{bp.child_templates.length} child task{bp.child_templates.length === 1 ? "" : "s"}</Badge> : <span className="text-[10px] text-muted-foreground">Ticket only</span>}</TableCell>
                    <TableCell className="text-[10px] text-muted-foreground">
                      {bp.default_priority && <Badge variant="outline" className="mr-1 text-[9px]">p:{bp.default_priority}</Badge>}
                      {bp.default_category && <Badge variant="outline" className="mr-1 text-[9px]">{bp.default_category}</Badge>}
                      {bp.sla_minutes && <Badge variant="outline" className="text-[9px]">SLA: {bp.sla_minutes}m</Badge>}
                    </TableCell>
                    <TableCell>
                      {bp.require_completion && <Badge variant="outline" className="text-amber-400 border-amber-500/30 text-[9px]"><ListChecks className="w-2.5 h-2.5 mr-0.5" />Block resolve</Badge>}
                    </TableCell>
                    <TableCell>
                      {bp.active !== false ? <Badge variant="outline" className="text-emerald-400 border-emerald-500/30 text-[9px]">active</Badge> : <Badge variant="outline" className="text-zinc-500 text-[9px]">archived</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(bp)} data-testid={`blueprint-edit-${bp.id}`}><Edit2 className="w-3 h-3" /></Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-rose-400" onClick={() => remove(bp)} data-testid={`blueprint-delete-${bp.id}`}><Trash2 className="w-3 h-3" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="patterns" className="mt-4">
          <PatternsPanel
            onCreated={() => load()}
            initialTokens={searchParams.get("t") ? searchParams.get("t").split(",") : null}
            onConsumed={() => {
              const nextParams = new URLSearchParams(searchParams);
              nextParams.delete("pattern");
              nextParams.delete("t");
              nextParams.set("tab", "patterns");
              setSearchParams(nextParams, { replace: true });
            }}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="blueprint-dialog">
          <DialogHeader><DialogTitle>{editing ? `Edit · ${editing.name}` : "New Blueprint"}</DialogTitle></DialogHeader>
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Name *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="New Employee Onboarding" data-testid="blueprint-form-name" />
              </div>
              <div>
                <Label>Default category</Label>
                <Input value={form.default_category} onChange={(e) => setForm({ ...form, default_category: e.target.value })} placeholder="onboarding" />
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Short description for techs" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Default priority</Label>
                <Select value={form.default_priority || "__none"} onValueChange={(v) => setForm({ ...form, default_priority: v === "__none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">—</SelectItem>
                    {PRIORITY_OPTS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Default status</Label>
                <Select value={form.default_status || "__none"} onValueChange={(v) => setForm({ ...form, default_status: v === "__none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">—</SelectItem>
                    {STATUS_OPTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>SLA (minutes)</Label>
                <Input type="number" value={form.sla_minutes || ""} onChange={(e) => setForm({ ...form, sla_minutes: e.target.value })} placeholder="240" />
              </div>
            </div>

            <div className="flex items-center gap-2 bg-muted/30 rounded-md p-3">
              <Switch checked={form.require_completion} onCheckedChange={(v) => setForm({ ...form, require_completion: v })} data-testid="blueprint-form-require" />
              <div>
                <div className="text-sm font-medium">Block resolve until checklist is complete</div>
                <div className="text-[10px] text-muted-foreground">Techs can't close the ticket unless all required checklist items are done and required fields are filled.</div>
              </div>
            </div>

            {/* Worksheet fields */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Wand2 className="w-4 h-4 text-sky-400" />
                  <div className="text-sm font-medium">Worksheet fields</div>
                </div>
                <Button size="sm" variant="outline" onClick={addField} className="text-sky-400 border-sky-500/30 hover:bg-sky-500/10" data-testid="blueprint-add-field"><Plus className="w-3 h-3 mr-1" />Add field</Button>
              </div>
              {form.fields.length === 0 ? (
                <div className="text-xs text-muted-foreground py-3 text-center bg-muted/20 rounded-md border border-dashed border-zinc-800">No fields yet</div>
              ) : (
                <div className="space-y-2">
                  {form.fields.map((f, i) => (
                    <div key={i} className="border border-zinc-800 rounded-md p-2.5 space-y-2" data-testid={`blueprint-field-${i}`}>
                      <div className="grid grid-cols-12 gap-2 items-end">
                        <div className="col-span-4">
                          <Label className="text-[10px]">Label</Label>
                          <Input value={f.label} onChange={(e) => updateField(i, { label: e.target.value })} className="h-8 text-xs" />
                        </div>
                        <div className="col-span-3">
                          <Label className="text-[10px]">Type</Label>
                          <Select value={f.type} onValueChange={(v) => updateField(i, { type: v })}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>{FIELD_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div className="col-span-3">
                          <Label className="text-[10px]">Placeholder</Label>
                          <Input value={f.placeholder || ""} onChange={(e) => updateField(i, { placeholder: e.target.value })} className="h-8 text-xs" />
                        </div>
                        <div className="col-span-1 flex items-center gap-1">
                          <Switch checked={f.required} onCheckedChange={(v) => updateField(i, { required: v })} />
                          <span className="text-[9px] text-muted-foreground">req</span>
                        </div>
                        <div className="col-span-1 text-right">
                          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-rose-400" onClick={() => removeField(i)}><X className="w-3 h-3" /></Button>
                        </div>
                      </div>
                      {f.type === "select" && (
                        <div>
                          <Label className="text-[10px]">Options (comma separated)</Label>
                          <Input value={(f.options || []).join(", ")} onChange={(e) => updateField(i, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} className="h-8 text-xs" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Checklist */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <ListChecks className="w-4 h-4 text-amber-400" />
                  <div className="text-sm font-medium">Checklist</div>
                </div>
                <Button size="sm" variant="outline" onClick={addChecklistItem} className="text-amber-400 border-amber-500/30 hover:bg-amber-500/10" data-testid="blueprint-add-checklist"><Plus className="w-3 h-3 mr-1" />Add item</Button>
              </div>
              {form.checklist.length === 0 ? (
                <div className="text-xs text-muted-foreground py-3 text-center bg-muted/20 rounded-md border border-dashed border-zinc-800">No checklist items yet</div>
              ) : (
                <div className="space-y-1.5">
                  {form.checklist.map((c, i) => (
                    <div key={c.id} className="flex items-center gap-2 bg-muted/30 rounded px-2 py-1" data-testid={`blueprint-checklist-${i}`}>
                      <GripVertical className="w-3 h-3 text-zinc-600 flex-shrink-0" />
                      <Input value={c.label} onChange={(e) => updateChecklist(i, { label: e.target.value })} placeholder="Checklist item" className="h-8 text-xs flex-1" />
                      <div className="flex items-center gap-1">
                        <Switch checked={c.required} onCheckedChange={(v) => updateChecklist(i, { required: v })} />
                        <span className="text-[9px] text-muted-foreground">req</span>
                      </div>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-rose-400" onClick={() => removeChecklist(i)}><X className="w-3 h-3" /></Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Delivery plan */}
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.035] p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-2.5"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyan-500/25 bg-cyan-500/10"><GitBranch className="h-4 w-4 text-cyan-200" /></span><div><p className="text-sm font-semibold">Onboarding delivery plan</p><p className="mt-1 max-w-xl text-[11px] leading-relaxed text-muted-foreground">Turn this blueprint into a parent service ticket with accountable child work. Use “per managed device” to create one linked child for every asset discovered during client onboarding.</p></div></div>
                <Button size="sm" variant="outline" onClick={addChildTemplate} className="border-cyan-500/30 text-cyan-200 hover:bg-cyan-500/10" data-testid="blueprint-add-child-template"><Plus className="mr-1 h-3 w-3" />Add child work</Button>
              </div>
              {!form.child_templates.length ? <div className="mt-3 rounded-lg border border-dashed border-cyan-500/20 bg-black/10 px-3 py-3 text-xs text-muted-foreground">This remains a single-ticket blueprint. Add child work to make it a reusable parent-and-child delivery plan.</div> : <div className="mt-3 space-y-3">{form.child_templates.map((child, i) => (
                <div key={child.id || i} className="rounded-xl border border-white/[0.08] bg-black/[0.13] p-3" data-testid={`blueprint-child-template-${i}`}>
                  <div className="mb-2 flex items-center justify-between"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-200">Child work {i + 1}</p><Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-rose-300 hover:text-rose-200" onClick={() => removeChildTemplate(i)} aria-label={`Remove child work ${i + 1}`}><Trash2 className="h-3.5 w-3.5" /></Button></div>
                  <div className="grid gap-2.5 md:grid-cols-12">
                    <div className="md:col-span-5"><Label className="text-[10px]">Child ticket title</Label><Input value={child.title} onChange={(e) => updateChildTemplate(i, { title: e.target.value })} placeholder="Managed device enrolment" className="mt-1 h-8 text-xs" /></div>
                    <div className="md:col-span-3"><Label className="text-[10px]">Priority</Label><Select value={child.priority || "medium"} onValueChange={(value) => updateChildTemplate(i, { priority: value })}><SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent>{PRIORITY_OPTS.map((priority) => <SelectItem key={priority} value={priority}>{priority}</SelectItem>)}</SelectContent></Select></div>
                    <div className="md:col-span-4"><Label className="text-[10px]">Category</Label><Input value={child.category || ""} onChange={(e) => updateChildTemplate(i, { category: e.target.value })} placeholder="onboarding" className="mt-1 h-8 text-xs" /></div>
                    <div className="md:col-span-12"><Label className="text-[10px]">Child blueprint / worksheet <span className="font-normal text-muted-foreground">(optional)</span></Label><Select value={child.blueprint_id || "__none"} onValueChange={(value) => updateChildTemplate(i, { blueprint_id: value === "__none" ? "" : value })}><SelectTrigger className="mt-1 h-8 text-xs"><SelectValue placeholder="Use a simple linked child ticket" /></SelectTrigger><SelectContent><SelectItem value="__none">No extra worksheet — simple linked ticket</SelectItem>{bps.filter((bp) => bp.active !== false).map((bp) => <SelectItem key={bp.id} value={bp.id}>{bp.name}</SelectItem>)}</SelectContent></Select><p className="mt-1 text-[10px] text-muted-foreground">A linked blueprint copies its required fields and completion checklist onto this child ticket.</p></div>
                    <div className="md:col-span-12"><Label className="text-[10px]">Work brief</Label><Textarea rows={2} value={child.description || ""} onChange={(e) => updateChildTemplate(i, { description: e.target.value })} placeholder="Describe what the technician must complete and record." className="mt-1 text-xs" /></div>
                    <div className="md:col-span-12 flex flex-wrap gap-x-5 gap-y-2 pt-0.5"><label className="flex cursor-pointer items-center gap-2 text-xs"><Switch checked={Boolean(child.per_device)} onCheckedChange={(value) => updateChildTemplate(i, { per_device: value })} /><Monitor className="h-3.5 w-3.5 text-cyan-200" />Create once per managed device</label><label className="flex cursor-pointer items-center gap-2 text-xs"><Switch checked={child.required !== false} onCheckedChange={(value) => updateChildTemplate(i, { required: value })} /><ListChecks className="h-3.5 w-3.5 text-amber-200" />Required for delivery</label></div>
                  </div>
                </div>
              ))}</div>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !form.name.trim()} variant="outline" className="text-sky-400 border-sky-500/30 hover:bg-sky-500/10" data-testid="blueprint-save-btn">
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              {editing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PatternsPanel({ onCreated, initialTokens, onConsumed }) {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [patterns, setPatterns] = useState([]);
  const [totalScanned, setTotalScanned] = useState(0);
  const [loading, setLoading] = useState(true);
  const [minTix, setMinTix] = useState(2);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [draft, setDraft] = useState(null);
  const [sourceTix, setSourceTix] = useState([]);
  const [draftEngine, setDraftEngine] = useState("");
  const [pattern, setPattern] = useState(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [pushToAll, setPushToAll] = useState(true);
  const [makeDefault, setMakeDefault] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/blueprint-patterns?min_tickets=${minTix}&limit=12`, { headers });
      setPatterns(res.data?.patterns || []);
      setTotalScanned(res.data?.total_scanned || 0);
    } catch { toast.error("Failed to detect patterns"); }
    finally { setLoading(false); }
  }, [headers, minTix]);

  useEffect(() => { load(); }, [load]);

  // Auto-open suggest dialog if landing here with ?t=tok1,tok2 from the dashboard tile
  useEffect(() => {
    if (!initialTokens || initialTokens.length < 2 || patterns.length === 0) return;
    const match = patterns.find((p) =>
      p.tokens[0] === initialTokens[0] && p.tokens[1] === initialTokens[1]
    );
    if (match) {
      openSuggest(match);
      onConsumed && onConsumed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patterns, initialTokens]);

  const openSuggest = async (p) => {
    setPattern(p);
    setSuggesting(true);
    setSuggestOpen(true);
    setDraft(null);
    try {
      const res = await axios.post(`${API}/blueprint-patterns/suggest`, {
        tokens: p.tokens,
        sample_ticket_ids: p.sample_ticket_ids,
      }, { headers });
      setDraft(res.data.draft);
      setSourceTix(res.data.source_tickets || []);
      setDraftEngine(res.data.ai_model || "");
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
      setSuggestOpen(false);
    } finally { setSuggesting(false); }
  };

  const saveDraft = async () => {
    if (!draft?.name) return;
    setSavingDraft(true);
    try {
      const res = await axios.post(`${API}/blueprints`, draft, { headers });
      const newBp = res.data;
      if (pushToAll && pattern?.affected_client_ids?.length) {
        await axios.post(`${API}/blueprints/${newBp.id}/push-to-clients`, {
          client_ids: pattern.affected_client_ids,
          make_default: makeDefault,
        }, { headers });
        toast.success(`"${newBp.name}" saved + pushed to ${pattern.affected_client_ids.length} client(s)`);
      } else {
        toast.success(`"${newBp.name}" saved to library`);
      }
      setSuggestOpen(false);
      setDraft(null);
      onCreated && onCreated();
      load();
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setSavingDraft(false); }
  };

  if (loading) return <div className="p-12 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Scanning resolved tickets across all clients…</div>;

  return (
    <div className="space-y-4" data-testid="patterns-panel">
      <div className="flex flex-col gap-3 rounded-xl border border-violet-500/20 bg-violet-500/[0.035] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-sm font-semibold">Pattern discovery</p><p className="mt-1 text-xs text-muted-foreground">Scanned <span className="font-mono text-sky-300">{totalScanned}</span> resolved and closed tickets across your MSP. Review a generated draft before publishing it to the library.</p></div>
        <div className="flex items-center gap-2">
          <Label className="text-[10px] text-muted-foreground">Min tickets</Label>
          <Input type="number" value={minTix} onChange={(e) => setMinTix(parseInt(e.target.value) || 3)} className="h-7 w-14 text-xs" min={2} max={50} />
          <Button size="sm" variant="outline" onClick={load} data-testid="patterns-refresh"><Loader2 className="w-3 h-3 mr-1" style={{ display: "none" }} />Rescan</Button>
        </div>
      </div>

      {patterns.length === 0 ? (
        <div className="p-16 text-center text-sm text-muted-foreground bg-muted/20 rounded-xl border border-dashed border-zinc-800">
          No recurring patterns detected yet. Resolve more tickets to start seeing patterns.
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {patterns.map((p) => (
            <Card key={p.key} className="border-zinc-800 hover:border-violet-500/30 transition-colors" data-testid={`pattern-${p.key}`}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-base font-medium flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-violet-400 flex-shrink-0" />
                      {p.name_guess}
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{p.tokens.join(" + ")}</div>
                  </div>
                  <div className="flex gap-2 text-right">
                    <Badge variant="outline" className="text-xs">
                      {p.ticket_count} <span className="ml-1 text-[9px] text-muted-foreground">tix</span>
                    </Badge>
                    <Badge variant="outline" className="text-xs text-emerald-400 border-emerald-500/30">
                      <Users className="w-2.5 h-2.5 mr-0.5" />{p.client_count}
                    </Badge>
                  </div>
                </div>

                {p.related_blueprints?.length > 0 && (
                  <div className="text-[10px] text-amber-400 bg-amber-500/5 border border-amber-500/20 rounded px-2 py-1">
                    Similar to: {p.related_blueprints.map((b) => b.name).join(", ")}
                  </div>
                )}

                <div className="space-y-0.5">
                  {p.sample_titles.slice(0, 3).map((t, i) => (
                    <div key={i} className="text-[11px] text-muted-foreground line-clamp-1">· {t}</div>
                  ))}
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-zinc-800">
                  <div className="text-[10px] text-muted-foreground">
                    {p.top_category && <Badge variant="outline" className="text-[9px] mr-1">{p.top_category}</Badge>}
                    Affects {p.client_count} client{p.client_count === 1 ? "" : "s"}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px] text-violet-400 border-violet-500/30 hover:bg-violet-500/10"
                    onClick={() => openSuggest(p)}
                    data-testid={`pattern-gen-${p.key}`}
                  >
                    <Wand2 className="w-3 h-3 mr-1" /> Generate Blueprint
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={suggestOpen} onOpenChange={(v) => { setSuggestOpen(v); if (!v) { setDraft(null); setPattern(null); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="pattern-suggest-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-violet-400" /> Cross-client Blueprint Draft
            </DialogTitle>
          </DialogHeader>
          {suggesting ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
              Reading {pattern?.ticket_count} tickets across {pattern?.client_count} client(s) to draft a shared blueprint…
            </div>
          ) : !draft ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No draft yet.</div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-md bg-violet-500/5 border border-violet-500/20 p-3">
                <div className="text-[10px] uppercase tracking-widest text-violet-400 mb-1">Pattern · learned from {sourceTix.length} tickets across {pattern?.client_count} clients</div>
                {draftEngine && <div className="mb-2 text-[10px] text-muted-foreground">Draft source: {draftEngine}</div>}
                <div className="flex flex-wrap gap-1 mt-1">
                  {sourceTix.slice(0, 10).map((t) => (
                    <span key={t.id} className="text-[10px] font-mono bg-muted/40 rounded px-1.5 py-0.5">
                      #{t.ticket_number} · {(t.client_name || "").slice(0, 14)}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <Label className="text-xs">Name</Label>
                <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} data-testid="pattern-draft-name" />
              </div>
              <div>
                <Label className="text-xs">Description</Label>
                <Textarea rows={2} value={draft.description || ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="bg-muted/30 rounded px-3 py-2">
                  <div className="text-[10px] uppercase text-muted-foreground">Priority</div>
                  <div className="font-medium">{draft.default_priority || "—"}</div>
                </div>
                <div className="bg-muted/30 rounded px-3 py-2">
                  <div className="text-[10px] uppercase text-muted-foreground">Category</div>
                  <div className="font-medium">{draft.default_category || "—"}</div>
                </div>
                <div className="bg-muted/30 rounded px-3 py-2">
                  <div className="text-[10px] uppercase text-muted-foreground">SLA</div>
                  <div className="font-medium">{draft.sla_minutes ? `${draft.sla_minutes}m` : "—"}</div>
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1"><Wand2 className="w-3 h-3" /> Fields ({(draft.fields || []).length})</div>
                <div className="space-y-1">
                  {(draft.fields || []).map((f) => (
                    <div key={f.key} className="flex items-center justify-between bg-muted/30 rounded px-2 py-1 text-xs">
                      <div><span className="font-medium">{f.label}</span>{f.required && <span className="text-rose-400 ml-1">*</span>}<span className="text-[10px] text-muted-foreground font-mono ml-2">{f.key}</span></div>
                      <span className="text-[10px] text-muted-foreground">{f.type}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1"><ListChecks className="w-3 h-3" /> Checklist ({(draft.checklist || []).length})</div>
                <div className="space-y-1">
                  {(draft.checklist || []).map((c) => (
                    <div key={c.id} className="flex items-center gap-2 bg-muted/30 rounded px-2 py-1 text-xs">
                      <ChevronRight className="w-3 h-3 text-muted-foreground" />
                      <span className="flex-1">{c.label}</span>
                      {c.required && <span className="text-rose-400 text-[9px]">required</span>}
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-md p-3 space-y-2">
                <div className="text-sm font-medium flex items-center gap-2">
                  <Send className="w-4 h-4 text-emerald-400" /> Push to clients
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <Switch checked={pushToAll} onCheckedChange={setPushToAll} data-testid="pattern-push-toggle" />
                  <span>Assign this blueprint to all <span className="text-emerald-400 font-medium">{pattern?.client_count || 0}</span> affected client(s)</span>
                </div>
                {pushToAll && (
                  <div className="flex items-center gap-2 text-xs pl-6">
                    <Switch checked={makeDefault} onCheckedChange={setMakeDefault} data-testid="pattern-default-toggle" />
                    <span>Also set as the <strong>default</strong> for those clients (auto-applies to future tickets)</span>
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSuggestOpen(false)}>Cancel</Button>
            <Button onClick={saveDraft} disabled={!draft || savingDraft} variant="outline" className="text-violet-400 border-violet-500/30 hover:bg-violet-500/10" data-testid="pattern-save-btn">
              {savingDraft ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Sparkles className="w-4 h-4 mr-1" />}
              {pushToAll ? `Save & Push to ${pattern?.client_count || 0}` : "Save to library"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
