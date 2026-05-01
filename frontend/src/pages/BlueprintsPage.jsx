import { useEffect, useMemo, useState, useCallback } from "react";
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
import { Clipboard, Plus, Trash2, Edit2, Loader2, ListChecks, Wand2, GripVertical, X } from "lucide-react";

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

const EMPTY_BP = {
  name: "", description: "", icon: "Clipboard", color: "sky",
  default_priority: "", default_category: "", default_status: "",
  sla_minutes: "", require_completion: false, fields: [], checklist: [],
};

const slugify = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export default function BlueprintsPage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [bps, setBps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
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

  return (
    <div className="p-6 space-y-5" data-testid="blueprints-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-light tracking-tight flex items-center gap-3">
            <Clipboard className="w-7 h-7 text-sky-500" />
            Ticket Blueprints
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Reusable worksheets + checklists that auto-apply to new tickets. Assign per-client as a default workflow.
          </p>
        </div>
        <Button onClick={openCreate} variant="outline" className="text-sky-400 border-sky-500/30 hover:bg-sky-500/10" data-testid="blueprints-new-btn">
          <Plus className="w-4 h-4 mr-1" /> New Blueprint
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Loading…</div>
          ) : bps.length === 0 ? (
            <div className="p-16 text-center text-sm text-muted-foreground">
              No blueprints yet. Create one to standardise how tickets get triaged and filled out.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Fields</TableHead>
                  <TableHead>Checklist</TableHead>
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
