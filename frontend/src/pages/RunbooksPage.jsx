import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  Workflow, Play, Plus, Trash2, Power, PowerOff, Loader2, RefreshCw,
  Zap, Clock, Settings, ChevronRight, Copy, ToggleLeft, ToggleRight, BookOpen, Search, ExternalLink, ThumbsUp, Pencil
} from "lucide-react";

export default function RunbooksPage() {
  const { token } = useAuth();
  const [runbooks, setRunbooks] = useState([]);
  const [knowledgeRunbooks, setKnowledgeRunbooks] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", trigger: {}, conditions: [], actions: [] });
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [editingKnowledgeRunbook, setEditingKnowledgeRunbook] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(() => searchParams.get("tab") === "knowledge" ? "knowledge" : "automation");
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, tRes, lRes, kRes] = await Promise.all([
        axios.get(`${API}/automation`, { headers }),
        axios.get(`${API}/automation/templates`, { headers }),
        axios.get(`${API}/automation/logs`, { headers }),
        axios.get(`${API}/runbooks`, { headers }).catch(() => ({ data: [] })),
      ]);
      setRunbooks(rRes.data);
      setTemplates(tRes.data);
      setLogs(lRes.data);
      setKnowledgeRunbooks((Array.isArray(kRes.data) ? kRes.data : []).filter((runbook) => runbook.source_ticket_id || (runbook.steps || []).length > 0));
    } catch { toast.error("Failed to load runbooks"); }
    finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const createRunbook = async () => {
    try {
      await axios.post(`${API}/automation`, form, { headers });
      toast.success("Runbook created");
      setShowCreate(false);
      setForm({ name: "", description: "", trigger: {}, conditions: [], actions: [] });
      fetchAll();
    } catch { toast.error("Failed to create"); }
  };

  const applyTemplate = (tmpl) => {
    setForm({ ...tmpl, name: tmpl.name, description: tmpl.description });
    setShowCreate(true);
  };

  const testRunbook = async (id) => {
    try {
      const res = await axios.post(`${API}/automation/${id}/test`, {}, { headers });
      toast.success("Runbook test completed");
      fetchAll();
    } catch { toast.error("Test failed"); }
  };

  const toggleRunbook = async (id, enabled) => {
    try {
      await axios.put(`${API}/automation/${id}`, { enabled: !enabled }, { headers });
      toast.success(enabled ? "Disabled" : "Enabled");
      fetchAll();
    } catch { toast.error("Failed to toggle"); }
  };

  const deleteRunbook = async (id) => {
    try { await axios.delete(`${API}/automation/${id}`, { headers }); toast.success("Deleted"); fetchAll(); }
    catch { toast.error("Failed to delete"); }
  };

  const selectTab = (nextTab) => {
    setTab(nextTab);
    setSearchParams(nextTab === "automation" ? {} : { tab: nextTab }, { replace: true });
  };

  const visibleKnowledgeRunbooks = knowledgeRunbooks.filter((runbook) => {
    const query = knowledgeQuery.trim().toLowerCase();
    if (!query) return true;
    return [runbook.title, runbook.name, runbook.summary, runbook.category, runbook.source_ticket_number, ...(runbook.tags || [])]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query);
  });

  const copyKnowledgeSteps = async (runbook) => {
    const text = [
      runbook.title || runbook.name,
      runbook.summary || "",
      "",
      ...(runbook.steps || []).map((step, index) => `${index + 1}. ${step.step || "Step"}${step.detail ? ` — ${step.detail}` : ""}`),
    ].filter(Boolean).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Runbook copied to clipboard");
    } catch {
      toast.error("Could not copy the runbook");
    }
  };

  const markKnowledgeRunbookHelpful = async (runbook) => {
    try {
      const response = await axios.post(`${API}/knowledge-runbooks/${runbook.id}/helpful`, {}, { headers });
      setKnowledgeRunbooks((current) => current.map((item) => item.id === runbook.id ? { ...item, helpful_votes: response.data.helpful_votes, marked_helpful: true } : item));
      toast.success(response.data.already_marked ? "You already marked this procedure helpful" : "Thanks — feedback recorded");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not record feedback");
    }
  };

  const openKnowledgeEditor = (runbook) => {
    setEditingKnowledgeRunbook({
      ...runbook,
      tagsText: (runbook.tags || []).join(", "),
      stepsText: (runbook.steps || []).map((step) => `${step.step || ""} | ${step.detail || ""}`.trim()).join("\n"),
    });
  };

  const saveKnowledgeRunbook = async () => {
    if (!editingKnowledgeRunbook) return;
    const steps = editingKnowledgeRunbook.stepsText.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
      const [step, ...detail] = line.split("|");
      return { step: step.trim(), detail: detail.join("|").trim() };
    }).filter((step) => step.step);
    try {
      const response = await axios.put(`${API}/knowledge-runbooks/${editingKnowledgeRunbook.id}`, {
        title: editingKnowledgeRunbook.title.trim(),
        summary: editingKnowledgeRunbook.summary.trim(),
        category: editingKnowledgeRunbook.category.trim() || "general",
        tags: editingKnowledgeRunbook.tagsText.split(",").map((tag) => tag.trim()).filter(Boolean),
        steps,
      }, { headers });
      setKnowledgeRunbooks((current) => current.map((runbook) => runbook.id === response.data.id ? { ...runbook, ...response.data } : runbook));
      setEditingKnowledgeRunbook(null);
      toast.success("Knowledge runbook updated");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not update the knowledge runbook");
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="space-y-5" data-testid="runbooks-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3"><Workflow className="w-8 h-8 text-violet-400" />Runbooks</h1>
          <p className="text-muted-foreground">{knowledgeRunbooks.length} knowledge procedures &middot; {runbooks.length} automation runbooks</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchAll}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
          {tab !== "knowledge" && <Button onClick={() => setShowCreate(true)} data-testid="create-runbook-btn"><Plus className="w-4 h-4 mr-1" />New Automation</Button>}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {[["knowledge", "Knowledge"], ["automation", "Automation"], ["templates", "Templates"], ["logs", "Logs"]].map(([value, label]) => (
          <Button key={value} variant={tab === value ? "default" : "outline"} size="sm" onClick={() => selectTab(value)}>{label}</Button>
        ))}
      </div>

      {tab === "knowledge" && (
        <div className="space-y-3" data-testid="knowledge-runbooks">
          <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-card/40 px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input value={knowledgeQuery} onChange={(event) => setKnowledgeQuery(event.target.value)} placeholder="Search by procedure, tag, category, or ticket number…" className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0" data-testid="knowledge-runbooks-search" />
            <span className="shrink-0 text-xs text-muted-foreground">{visibleKnowledgeRunbooks.length} shown</span>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {visibleKnowledgeRunbooks.map((runbook) => (
            <Card key={runbook.id} className="border-sky-500/20">
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold flex items-center gap-2"><BookOpen className="h-4 w-4 text-sky-400" />{runbook.title || runbook.name}</p>
                    {runbook.summary && <p className="mt-1 text-xs text-muted-foreground">{runbook.summary}</p>}
                  </div>
                  <Badge variant="outline" className="shrink-0 border-sky-500/30 text-sky-300">Proven fix</Badge>
                </div>
                <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
                  {(runbook.steps || []).slice(0, 3).map((step, index) => (
                    <div key={`${runbook.id}-${index}`} className="flex gap-2 text-xs"><span className="font-mono text-sky-400">{index + 1}.</span><div><span className="font-medium">{step.step}</span>{step.detail && <span className="text-muted-foreground"> — {step.detail}</span>}</div></div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                  {runbook.source_ticket_number && <span>From ticket {runbook.source_ticket_number}</span>}
                  <span>{runbook.use_count || 0} uses</span>
                  <span>{runbook.helpful_votes || 0} helpful</span>
                  {(runbook.tags || []).map((tag) => <Badge key={`${runbook.id}-${tag}`} variant="outline" className="h-5 text-[10px]">#{tag}</Badge>)}
                </div>
                <div className="mt-3 flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => copyKnowledgeSteps(runbook)}><Copy className="mr-1.5 h-3 w-3" />Copy steps</Button>
                  <Button variant="ghost" size="sm" className="text-sky-300 hover:text-sky-100" onClick={() => openKnowledgeEditor(runbook)}><Pencil className="mr-1.5 h-3 w-3" />Edit</Button>
                  <Button variant="ghost" size="sm" className="text-sky-300 hover:text-sky-100" onClick={() => markKnowledgeRunbookHelpful(runbook)} disabled={runbook.marked_helpful}><ThumbsUp className="mr-1.5 h-3 w-3" />Helpful</Button>
                  {runbook.source_ticket_id && <Button variant="ghost" size="sm" className="text-sky-300 hover:text-sky-100" onClick={() => { window.location.assign(`/tickets?ticket=${runbook.source_ticket_id}`); }}><ExternalLink className="mr-1.5 h-3 w-3" />Source ticket</Button>}
                </div>
              </CardContent>
            </Card>
          ))}
          {visibleKnowledgeRunbooks.length === 0 && (
            <Card className="xl:col-span-2"><CardContent className="py-12 text-center">
              <BookOpen className="mx-auto mb-2 h-10 w-10 text-muted-foreground opacity-30" />
              <p className="text-muted-foreground">{knowledgeRunbooks.length === 0 ? "No proven fixes yet. Resolve a ticket and promote its fix into a reusable runbook." : "No knowledge runbooks match that search."}</p>
            </CardContent></Card>
          )}
          </div>
        </div>
      )}

      <Dialog open={!!editingKnowledgeRunbook} onOpenChange={(open) => !open && setEditingKnowledgeRunbook(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><BookOpen className="h-4 w-4 text-sky-400" />Refine knowledge runbook</DialogTitle></DialogHeader>
          {editingKnowledgeRunbook && <div className="space-y-3">
            <div><Label>Title</Label><Input value={editingKnowledgeRunbook.title || ""} onChange={(event) => setEditingKnowledgeRunbook({ ...editingKnowledgeRunbook, title: event.target.value })} /></div>
            <div><Label>Summary</Label><Textarea rows={2} value={editingKnowledgeRunbook.summary || ""} onChange={(event) => setEditingKnowledgeRunbook({ ...editingKnowledgeRunbook, summary: event.target.value })} /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><div><Label>Category</Label><Input value={editingKnowledgeRunbook.category || ""} onChange={(event) => setEditingKnowledgeRunbook({ ...editingKnowledgeRunbook, category: event.target.value })} /></div><div><Label>Tags</Label><Input placeholder="windows, defender, patching" value={editingKnowledgeRunbook.tagsText || ""} onChange={(event) => setEditingKnowledgeRunbook({ ...editingKnowledgeRunbook, tagsText: event.target.value })} /></div></div>
            <div><Label>Steps</Label><Textarea rows={7} className="font-mono text-xs" placeholder="Step title | Detail\nValidate result | Confirm the issue is resolved" value={editingKnowledgeRunbook.stepsText || ""} onChange={(event) => setEditingKnowledgeRunbook({ ...editingKnowledgeRunbook, stepsText: event.target.value })} /><p className="mt-1 text-[11px] text-muted-foreground">One step per line. Put the explanatory detail after a vertical bar.</p></div>
          </div>}
          <DialogFooter><Button variant="outline" onClick={() => setEditingKnowledgeRunbook(null)}>Cancel</Button><Button onClick={saveKnowledgeRunbook}>Save changes</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {tab === "automation" && (
        <div className="grid grid-cols-2 gap-3">
          {runbooks.map(rb => (
            <Card key={rb.id} className={`${rb.enabled ? "border-violet-500/20" : "opacity-60"}`}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-bold flex items-center gap-2">
                      {rb.enabled ? <Power className="w-4 h-4 text-emerald-400" /> : <PowerOff className="w-4 h-4 text-zinc-500" />}
                      {rb.name}
                    </p>
                    <p className="text-xs text-muted-foreground">{rb.description}</p>
                  </div>
                  <Badge className={rb.enabled ? "bg-emerald-500/20 text-emerald-400" : "bg-zinc-500/20 text-zinc-400"}>{rb.enabled ? "Active" : "Disabled"}</Badge>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                  <Zap className="w-3 h-3" />Trigger: {rb.trigger?.type || "manual"}
                  <span>&middot;</span>
                  <span>{(rb.actions || []).length} actions</span>
                  <span>&middot;</span>
                  <span>Run {rb.run_count || 0}x</span>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => testRunbook(rb.id)} data-testid={`test-rb-${rb.id}`}><Play className="w-3 h-3 mr-1" />Test</Button>
                  <Button variant="outline" size="sm" onClick={() => toggleRunbook(rb.id, rb.enabled)}>{rb.enabled ? "Disable" : "Enable"}</Button>
                  <Button variant="outline" size="sm" className="text-red-400 hover:text-red-300" onClick={() => deleteRunbook(rb.id)}><Trash2 className="w-3 h-3" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {runbooks.length === 0 && (
            <Card className="col-span-2"><CardContent className="py-12 text-center">
              <Workflow className="w-10 h-10 mx-auto text-muted-foreground mb-2 opacity-30" />
              <p className="text-muted-foreground">No runbooks yet. Create one or use a template.</p>
            </CardContent></Card>
          )}
        </div>
      )}

      {tab === "templates" && (
        <div className="grid grid-cols-2 gap-3">
          {templates.map((t, i) => (
            <Card key={`k-${i}`} className="hover:border-violet-500/20 transition-all">
              <CardContent className="pt-4">
                <p className="font-bold">{t.name}</p>
                <p className="text-xs text-muted-foreground mb-3">{t.description}</p>
                <div className="space-y-1 mb-3">
                  <p className="text-[10px] text-muted-foreground">Trigger: {t.trigger?.type}</p>
                  {(t.actions || []).map((a, j) => (
                    <div key={`k-${j}`} className="text-[10px] flex items-center gap-1"><ChevronRight className="w-3 h-3 text-violet-400" />{a.type}</div>
                  ))}
                </div>
                <Button size="sm" onClick={() => applyTemplate(t)} data-testid={`use-template-${i}`}><Copy className="w-3 h-3 mr-1" />Use Template</Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {tab === "logs" && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Runbook</TableHead><TableHead>Status</TableHead><TableHead>Results</TableHead><TableHead>When</TableHead></TableRow></TableHeader>
              <TableBody>
                {logs.map(l => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{l.runbook_name}</TableCell>
                    <TableCell><Badge className="bg-blue-500/20 text-blue-400 text-[10px]">{l.status}</Badge></TableCell>
                    <TableCell className="text-xs">{(l.results || []).length} actions executed</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{l.executed_at?.slice(0, 16)}</TableCell>
                  </TableRow>
                ))}
                {logs.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No executions yet</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Create Runbook</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} data-testid="rb-name" /></div>
            <div><Label>Description</Label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} /></div>
            <div>
              <Label>Trigger Type</Label>
              <Select value={form.trigger?.type || ""} onValueChange={v => setForm({ ...form, trigger: { ...form.trigger, type: v } })}>
                <SelectTrigger><SelectValue placeholder="Select trigger" /></SelectTrigger>
                <SelectContent>
                  {["device_metric", "sla_countdown", "device_created", "device_offline", "ticket_created", "onboarding_completed"].map(t => (
                    <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={createRunbook} data-testid="save-runbook-btn">Create Runbook</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
