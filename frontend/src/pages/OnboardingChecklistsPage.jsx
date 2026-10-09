import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  ClipboardCheck, Plus, Trash2, ArrowUp, ArrowDown, Copy, Rocket,
  CheckCircle2, Circle, AlertTriangle, Link2, Loader2, Sparkles, ShieldCheck,
} from "lucide-react";

const ITEM_TYPES = [
  { value: "checkbox", label: "Checkbox" },
  { value: "text", label: "Text entry" },
  { value: "note", label: "Note" },
  { value: "link", label: "Link" },
  { value: "upload", label: "Upload" },
  { value: "equipment", label: "Equipment" },
  { value: "training", label: "Training" },
  { value: "document", label: "Document" },
  { value: "signoff", label: "Sign-off" },
  { value: "account", label: "Account setup" },
];

const RUN_STATUS_TONE = {
  not_started: "border-zinc-400/30 text-zinc-300",
  in_progress: "border-cyan-400/40 text-cyan-300",
  completed: "border-emerald-400/40 text-emerald-300",
  blocked: "border-amber-400/40 text-amber-300",
  archived: "border-zinc-500/30 text-zinc-500",
};

function emptyItem() {
  return { title: "", type: "checkbox", required: true, description: "", points: 0 };
}

function TemplateEditor({ template, services, onSaved, onCancel }) {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [form, setForm] = useState(() => ({
    name: template?.name || "",
    description: template?.description || "",
    category: template?.category || "onboarding",
    service_ids: template?.service_ids || [],
    service_tags: template?.service_tags || [],
    items: template?.items?.length ? template.items : [emptyItem()],
  }));
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving] = useState(false);

  const setItem = (index, patch) =>
    setForm((f) => ({ ...f, items: f.items.map((item, i) => (i === index ? { ...item, ...patch } : item)) }));
  const moveItem = (index, delta) =>
    setForm((f) => {
      const items = [...f.items];
      const target = index + delta;
      if (target < 0 || target >= items.length) return f;
      [items[index], items[target]] = [items[target], items[index]];
      return { ...f, items };
    });

  const save = async () => {
    if (!form.name.trim()) { toast.error("Give the checklist a name"); return; }
    if (!form.items.some((i) => i.title.trim())) { toast.error("Add at least one item"); return; }
    setSaving(true);
    try {
      const payload = { ...form, items: form.items.filter((i) => i.title.trim()) };
      const response = template?.id
        ? await axios.put(`${API}/onboarding-checklists/templates/${template.id}`, payload, { headers })
        : await axios.post(`${API}/onboarding-checklists/templates`, payload, { headers });
      toast.success(template?.id ? "Checklist updated" : "Checklist created");
      onSaved(response.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to save checklist");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card data-testid="checklist-editor">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-cyan-300" />
          {template?.id ? `Edit: ${template.name}` : "New checklist template"}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Fully customisable: your own items, order, evidence rules and service hooks — so nothing on a service gets missed.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Name</label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="New starter: Service Desk" data-testid="checklist-name" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Category</label>
            <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="onboarding" />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Description</label>
          <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What is this checklist for?" />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5" />Hook to services</label>
          <p className="text-[11px] text-muted-foreground mb-2">Linked services always carry this checklist so onboarding steps cannot be missed.</p>
          <div className="flex flex-wrap gap-1.5">
            {services.map((svc) => {
              const active = form.service_ids.includes(svc.id);
              return (
                <Button key={svc.id} type="button" size="sm" variant={active ? "default" : "outline"}
                  className="h-7 text-[11px]"
                  onClick={() => setForm((f) => ({
                    ...f,
                    service_ids: active ? f.service_ids.filter((id) => id !== svc.id) : [...f.service_ids, svc.id],
                  }))}>
                  {svc.name}
                </Button>
              );
            })}
            {!services.length && <span className="text-xs text-muted-foreground">No service tiers defined yet.</span>}
          </div>
          <div className="mt-2 flex gap-2">
            <Input value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="Add a service tag (e.g. m365)"
              onKeyDown={(e) => {
                if (e.key === "Enter" && tagInput.trim()) {
                  setForm((f) => ({ ...f, service_tags: [...new Set([...f.service_tags, tagInput.trim()])] }));
                  setTagInput("");
                }
              }} />
            <Button type="button" variant="outline" size="sm" onClick={() => {
              if (tagInput.trim()) {
                setForm((f) => ({ ...f, service_tags: [...new Set([...f.service_tags, tagInput.trim()])] }));
                setTagInput("");
              }
            }}>Add tag</Button>
          </div>
          {!!form.service_tags.length && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {form.service_tags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-[10px] cursor-pointer"
                  onClick={() => setForm((f) => ({ ...f, service_tags: f.service_tags.filter((t) => t !== tag) }))}>
                  {tag} ×
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Checklist items ({form.items.length})</label>
          {form.items.map((item, index) => (
            <div key={index} className="rounded-xl border border-border/60 bg-background/30 p-3 space-y-2" data-testid={`checklist-item-${index}`}>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-muted-foreground w-6">{index + 1}.</span>
                <Input value={item.title} onChange={(e) => setItem(index, { title: e.target.value })} placeholder="Item title" className="h-8 text-sm" />
                <Select value={item.type} onValueChange={(value) => setItem(index, { type: value })}>
                  <SelectTrigger className="h-8 w-[130px] text-[11px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ITEM_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => moveItem(index, -1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
                <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => moveItem(index, 1)}><ArrowDown className="h-3.5 w-3.5" /></Button>
                <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-red-400" onClick={() => setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== index) }))}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="flex items-center gap-3 pl-8">
                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <input type="checkbox" checked={item.required} onChange={(e) => setItem(index, { required: e.target.checked })} />
                  Required
                </label>
                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <input type="checkbox" checked={!!item.evidence_required} onChange={(e) => setItem(index, { evidence_required: e.target.checked })} />
                  Evidence required
                </label>
                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  Points
                  <Input type="number" min="0" value={item.points ?? 0} onChange={(e) => setItem(index, { points: Number(e.target.value) || 0 })} className="h-6 w-16 text-[11px]" />
                </label>
              </div>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setForm((f) => ({ ...f, items: [...f.items, emptyItem()] }))} data-testid="add-checklist-item">
            <Plus className="h-3.5 w-3.5 mr-1" />Add item
          </Button>
        </div>

        <div className="flex gap-2">
          <Button onClick={save} disabled={saving} data-testid="save-checklist">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <CheckCircle2 className="h-4 w-4 mr-1.5" />}
            {template?.id ? "Save changes" : "Create checklist"}
          </Button>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function OnboardingChecklistsPage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [templates, setTemplates] = useState([]);
  const [runs, setRuns] = useState([]);
  const [services, setServices] = useState([]);
  const [coverage, setCoverage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null | "new" | template object

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, rRes, sRes, cRes] = await Promise.all([
        axios.get(`${API}/onboarding-checklists/templates`, { headers }),
        axios.get(`${API}/onboarding-checklists/runs`, { headers }),
        axios.get(`${API}/service-tiers`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/onboarding-checklists/service-coverage`, { headers }).catch(() => ({ data: null })),
      ]);
      setTemplates(tRes.data);
      setRuns(rRes.data);
      setServices(sRes.data.map((t) => ({ id: t.id, name: t.name })));
      setCoverage(cRes.data);
    } catch {
      toast.error("Failed to load onboarding checklists");
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const launchRun = async (template) => {
    try {
      await axios.post(`${API}/onboarding-checklists/runs`, { template_id: template.id }, { headers });
      toast.success(`Checklist run launched: ${template.name}`);
      fetchAll();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to launch run");
    }
  };

  const duplicate = async (template) => {
    try {
      await axios.post(`${API}/onboarding-checklists/templates/${template.id}/duplicate`, {}, { headers });
      toast.success("Checklist duplicated");
      fetchAll();
    } catch {
      toast.error("Failed to duplicate checklist");
    }
  };

  const archive = async (template) => {
    try {
      await axios.delete(`${API}/onboarding-checklists/templates/${template.id}`, { headers });
      toast.success("Checklist archived");
      fetchAll();
    } catch {
      toast.error("Failed to archive checklist");
    }
  };

  const completeItem = async (run, item) => {
    const nextStatus = item.status === "completed" ? "pending" : "completed";
    try {
      await axios.post(`${API}/onboarding-checklists/runs/${run.id}/items/${item.item_id}`,
        { status: nextStatus }, { headers });
      fetchAll();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to update item");
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin" /></div>;

  return (
    <div className="space-y-5" data-testid="onboarding-checklists-page">
      <section className="flex flex-col gap-4 overflow-hidden rounded-2xl border border-primary/20 bg-[radial-gradient(circle_at_86%_0%,hsl(var(--primary)/0.2),transparent_38%),linear-gradient(120deg,hsl(var(--card)),hsl(var(--background)))] p-5 shadow-[0_16px_42px_-30px_hsl(var(--primary)/0.7)] sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary"><ClipboardCheck className="h-5 w-5" /></span>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Team workspace</p>
              <h1 className="text-2xl font-bold tracking-tight">Onboarding checklists</h1>
            </div>
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Build your own hugely customisable checklists, hook them to services, and launch runs for technicians — so nothing that matters gets missed.
          </p>
        </div>
        <Button onClick={() => setEditing("new")} data-testid="new-checklist">
          <Plus className="h-4 w-4 mr-1.5" />New checklist
        </Button>
      </section>

      {coverage && !!coverage.uncovered_service_ids?.length && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] px-4 py-3 text-xs text-amber-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{coverage.uncovered_service_ids.length} service(s) have no linked checklist yet — link one so onboarding steps cannot be missed.</span>
        </div>
      )}

      {editing && (
        <TemplateEditor
          template={editing === "new" ? null : editing}
          services={services}
          onSaved={() => { setEditing(null); fetchAll(); }}
          onCancel={() => setEditing(null)}
        />
      )}

      <Tabs defaultValue="templates">
        <TabsList>
          <TabsTrigger value="templates" data-testid="tab-templates">Templates ({templates.length})</TabsTrigger>
          <TabsTrigger value="runs" data-testid="tab-runs">Runs ({runs.length})</TabsTrigger>
          <TabsTrigger value="coverage" data-testid="tab-coverage">Service coverage</TabsTrigger>
        </TabsList>

        <TabsContent value="templates" className="mt-4 space-y-3">
          {!templates.length && (
            <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
              No checklist templates yet. Create your first one — add your own items and hook it to services.
            </CardContent></Card>
          )}
          {templates.map((template) => (
            <Card key={template.id} data-testid={`template-card-${template.id}`}>
              <CardContent className="p-4 flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm">{template.name}</p>
                    <Badge variant="outline" className="text-[9px]">v{template.version}</Badge>
                    <Badge variant="outline" className="text-[9px]">{template.items?.length || 0} items</Badge>
                    {!!template.usage_count && <Badge variant="outline" className="text-[9px] text-cyan-300 border-cyan-400/30">{template.usage_count} runs</Badge>}
                  </div>
                  {template.description && <p className="mt-1 text-xs text-muted-foreground">{template.description}</p>}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(template.service_ids || []).map((id) => (
                      <Badge key={id} className="text-[9px] bg-primary/10 text-primary border-primary/25">
                        {services.find((s) => s.id === id)?.name || id}
                      </Badge>
                    ))}
                    {(template.service_tags || []).map((tag) => (
                      <Badge key={tag} variant="outline" className="text-[9px]">{tag}</Badge>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" onClick={() => launchRun(template)} data-testid={`launch-${template.id}`}>
                    <Rocket className="h-3.5 w-3.5 mr-1" />Launch run
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditing(template)}>Edit</Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => duplicate(template)}><Copy className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-red-400" onClick={() => archive(template)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="runs" className="mt-4 space-y-3">
          {!runs.length && (
            <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
              No checklist runs yet. Launch one from a template to start tracking progress.
            </CardContent></Card>
          )}
          {runs.map((run) => (
            <Card key={run.id} data-testid={`run-card-${run.id}`}>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-sm">{run.template_name}</p>
                  <Badge variant="outline" className={`text-[9px] ${RUN_STATUS_TONE[run.status] || ""}`}>{run.status.replace("_", " ")}</Badge>
                  {run.technician_name && <Badge variant="outline" className="text-[9px]">{run.technician_name}</Badge>}
                  <span className="ml-auto text-xs text-muted-foreground">{run.progress?.completed}/{run.progress?.total} items · {run.progress?.percent || 0}%</span>
                </div>
                <div className="mt-3 space-y-1.5">
                  {(run.items || []).map((item) => (
                    <button key={item.item_id} type="button"
                      className="flex w-full items-center gap-2.5 rounded-lg border border-border/40 bg-background/20 px-3 py-2 text-left transition hover:border-primary/30"
                      onClick={() => completeItem(run, item)}
                      data-testid={`run-item-${run.id}-${item.item_id}`}>
                      {item.status === "completed"
                        ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                        : <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />}
                      <span className={`text-xs ${item.status === "completed" ? "line-through text-muted-foreground" : ""}`}>{item.title}</span>
                      {item.required && <Badge variant="outline" className="ml-auto text-[8px]">required</Badge>}
                      {item.evidence_required && <ShieldCheck className="h-3.5 w-3.5 text-cyan-300" />}
                      {!!item.points && <Badge variant="outline" className="text-[8px] text-amber-300 border-amber-400/30">+{item.points}</Badge>}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="coverage" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Service checklist coverage</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {coverage?.services?.length ? coverage.services.map((svc) => (
                <div key={svc.service_id} className="flex items-center gap-2 rounded-lg border border-border/50 px-3 py-2 text-xs">
                  {svc.covered
                    ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    : <AlertTriangle className="h-4 w-4 text-amber-400" />}
                  <span>{svc.service_name}</span>
                  <span className="ml-auto text-muted-foreground">{svc.template_count} checklist(s)</span>
                </div>
              )) : <p className="text-xs text-muted-foreground">No service tiers defined yet.</p>}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
