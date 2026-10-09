import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, CalendarClock, CheckCircle2, Clock3, Loader2, Pencil, Plus, RefreshCw, UserRound } from "lucide-react";
import { toast } from "sonner";

import { API } from "@/App";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";

const FILTERS = [
  ["open", "Open"],
  ["overdue", "Overdue"],
  ["completed", "Completed"],
  ["all", "All"],
];

const toLocalInput = (value) => {
  const date = value ? new Date(value) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const newRequestKey = () => window.crypto?.randomUUID?.() || `follow-up-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const isOverdue = (item) => item.status === "open" && item.due_at && new Date(item.due_at).getTime() < Date.now();

const dueLabel = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Deadline unavailable";
  return formatDistanceToNow(date, { addSuffix: true });
};

const emptyForm = (currentUserId) => ({
  title: "",
  note: "",
  kind: "task",
  priority: "normal",
  due_at: toLocalInput(),
  owner_id: currentUserId || "",
  request_key: newRequestKey(),
});

/**
 * A compact account-commitment register. It is intentionally separate from
 * tickets and projects: a follow-up explains who owns a customer promise and
 * when it is due; it does not create operational work on its own.
 */
export default function ClientFollowUpsPanel({ clientId, token, currentUserId, currentUserName }) {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [followUps, setFollowUps] = useState([]);
  const [owners, setOwners] = useState([]);
  const [filter, setFilter] = useState("open");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [editor, setEditor] = useState(null);
  const [form, setForm] = useState(() => emptyForm(currentUserId));
  const [saving, setSaving] = useState(false);
  const [pendingId, setPendingId] = useState(null);
  const requestVersion = useRef(0);
  const writePending = useRef(false);

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setLoadError(false);
    try {
      const response = await axios.get(`${API}/clients/${clientId}/follow-ups`, { headers, timeout: 15000 });
      if (version !== requestVersion.current) return;
      setFollowUps(Array.isArray(response.data?.follow_ups) ? response.data.follow_ups : []);
      setOwners(Array.isArray(response.data?.owners) ? response.data.owners : []);
    } catch (error) {
      if (version !== requestVersion.current) return;
      setLoadError(true);
      toast.error(error.response?.data?.detail || "Could not load client follow-ups");
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [clientId, headers]);

  useEffect(() => {
    load();
    return () => { requestVersion.current += 1; };
  }, [load]);

  const ownerOptions = useMemo(() => {
    const collected = [...owners];
    if (currentUserId && !collected.some((owner) => owner.id === currentUserId)) {
      collected.unshift({ id: currentUserId, name: currentUserName || "Me" });
    }
    return collected;
  }, [owners, currentUserId, currentUserName]);

  const filtered = useMemo(() => followUps
    .filter((item) => {
      if (filter === "all") return true;
      if (filter === "overdue") return isOverdue(item);
      return item.status === filter;
    })
    .sort((a, b) => new Date(a.due_at || 0) - new Date(b.due_at || 0)), [followUps, filter]);

  const openCreate = () => {
    setForm(emptyForm(currentUserId));
    setEditor("create");
  };

  const openEdit = (item) => {
    setForm({
      title: item.title || "",
      note: item.note || "",
      kind: item.kind || "task",
      priority: item.priority || "normal",
      due_at: toLocalInput(item.due_at),
      owner_id: item.owner_id || currentUserId || "",
      request_key: "",
    });
    setEditor(item);
  };

  const save = async () => {
    if (writePending.current || !editor) return;
    if (!form.title.trim()) return toast.error("Give this follow-up a clear next action");
    const due = new Date(form.due_at);
    if (Number.isNaN(due.getTime())) return toast.error("Choose a valid due date and time");
    writePending.current = true;
    setSaving(true);
    try {
      if (editor === "create") {
        const response = await axios.post(`${API}/clients/${clientId}/follow-ups`, {
          title: form.title,
          note: form.note,
          kind: form.kind,
          priority: form.priority,
          due_at: due.toISOString(),
          owner_id: form.owner_id || undefined,
          idempotency_key: form.request_key,
        }, { headers });
        toast.success(response.data?.created === false ? "Existing follow-up restored" : "Follow-up assigned");
      } else {
        await axios.put(`${API}/clients/${clientId}/follow-ups/${editor.id}`, {
          title: form.title,
          note: form.note,
          kind: form.kind,
          priority: form.priority,
          due_at: due.toISOString(),
          owner_id: form.owner_id,
          expected_version: editor.version,
        }, { headers });
        toast.success("Follow-up updated");
      }
      setEditor(null);
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not save follow-up");
    } finally {
      writePending.current = false;
      setSaving(false);
    }
  };

  const mutate = async (item, change, successMessage) => {
    if (writePending.current || (item.status === "completed" && change.status === "completed")) return;
    writePending.current = true;
    setPendingId(item.id);
    try {
      await axios.put(`${API}/clients/${clientId}/follow-ups/${item.id}`, {
        ...change,
        expected_version: item.version,
      }, { headers });
      toast.success(successMessage);
      await load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not update follow-up");
    } finally {
      writePending.current = false;
      setPendingId(null);
    }
  };

  if (loadError) {
    return <section role="alert" className="space-y-3 rounded-2xl border border-amber-500/25 bg-card p-5">
      <h2 className="font-semibold">Follow-ups could not be loaded</h2>
      <p className="text-sm text-muted-foreground">Nexus has not changed any account commitments. Reload the register before creating or updating a follow-up.</p>
      <Button variant="outline" onClick={load}><RefreshCw className="mr-2 h-4 w-4" />Retry loading follow-ups</Button>
    </section>;
  }

  return <section className="space-y-4" data-testid="client-follow-ups-panel">
    <div className="flex flex-col gap-4 overflow-hidden rounded-2xl border border-sky-500/20 bg-[linear-gradient(135deg,rgba(8,47,73,0.28),rgba(9,9,11,0.94))] p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-300">Account commitments</p><h2 className="mt-1 text-base font-semibold">Every next action has an owner</h2><p className="mt-1 max-w-2xl text-xs text-muted-foreground">Capture the promise, assign a team member and retain completion evidence on the client record—without creating a duplicate ticket or project.</p></div>
      <Button size="sm" className="shrink-0" onClick={openCreate} disabled={loading || saving} data-testid="client-follow-up-add"><Plus className="mr-1.5 h-4 w-4" />Add follow-up</Button>
    </div>

    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/35 px-3 py-2">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter client follow-ups">
        {FILTERS.map(([value, label]) => <Button key={value} type="button" size="sm" variant={filter === value ? "default" : "ghost"} className="h-7 px-2.5 text-[11px]" onClick={() => setFilter(value)}>{label}{value === "overdue" && followUps.filter(isOverdue).length > 0 ? ` · ${followUps.filter(isOverdue).length}` : ""}</Button>)}
      </div>
      <span className="text-[11px] text-muted-foreground">{followUps.filter((item) => item.status === "open").length} active · {followUps.filter(isOverdue).length} overdue</span>
    </div>

    {loading ? <div className="flex items-center justify-center rounded-2xl border border-border/70 py-12 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading account commitments…</div> : filtered.length === 0 ? <div className="rounded-2xl border border-dashed border-border/70 px-5 py-10 text-center"><CalendarClock className="mx-auto h-7 w-7 text-muted-foreground" /><p className="mt-3 text-sm font-medium">{filter === "overdue" ? "No overdue follow-ups" : "No follow-ups in this view"}</p><p className="mt-1 text-xs text-muted-foreground">{filter === "open" ? "Use Add follow-up above to assign the first accountable action before the customer conversation is lost." : "Change the filter or use Add follow-up above to record a new client commitment."}</p></div> : <div className="space-y-2">{filtered.map((item) => {
      const overdue = isOverdue(item);
      const complete = item.status === "completed";
      const updating = pendingId === item.id;
      return <article key={item.id} className={`group rounded-2xl border p-4 transition ${overdue ? "border-amber-500/30 bg-amber-500/[0.055]" : complete ? "border-emerald-500/20 bg-emerald-500/[0.025]" : "border-border/70 bg-card/55 hover:border-sky-500/25"}`} data-testid={`client-follow-up-${item.id}`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className={`text-sm font-semibold ${complete ? "text-muted-foreground line-through" : "text-foreground"}`}>{item.title}</h3><span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] ${overdue ? "border-amber-400/30 bg-amber-400/10 text-amber-200" : complete ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-sky-400/25 bg-sky-400/[0.07] text-sky-200"}`}>{overdue ? "Overdue" : complete ? "Complete" : item.kind || "Task"}</span>{item.priority === "high" && !complete && <span className="text-[10px] font-medium text-amber-300">High priority</span>}</div>{item.note && <p className="mt-1.5 max-w-3xl whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{item.note}</p>}</div><div className="flex shrink-0 flex-wrap items-center gap-2">{!complete && item.status !== "cancelled" && <Button size="sm" className="h-8 text-xs" disabled={updating} onClick={() => mutate(item, { status: "completed" }, "Follow-up completed")}><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Complete</Button>}<Button variant="outline" size="sm" className="h-8 text-xs" disabled={updating} onClick={() => openEdit(item)}><Pencil className="mr-1.5 h-3.5 w-3.5" />Edit</Button></div></div>
        <div className="mt-3 flex flex-col gap-2 border-t border-white/[0.06] pt-3 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><div className="flex flex-wrap items-center gap-x-4 gap-y-1"><span className={`inline-flex items-center gap-1.5 ${overdue ? "text-amber-200" : ""}`}>{overdue ? <AlertTriangle className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}{dueLabel(item.due_at)}</span><span className="inline-flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5" />{item.owner_name || "Unassigned"}</span>{complete && item.completed_by_name && <span className="inline-flex items-center gap-1.5 text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" />Completed by {item.completed_by_name}</span>}</div>{!complete && item.status !== "cancelled" && <Select value={item.owner_id || ""} onValueChange={(owner_id) => mutate(item, { owner_id }, "Follow-up reassigned")} disabled={updating}><SelectTrigger className="h-7 w-[190px] bg-background/40 text-[11px]"><SelectValue placeholder="Reassign owner" /></SelectTrigger><SelectContent>{ownerOptions.map((owner) => <SelectItem key={owner.id} value={owner.id}>{owner.name || "Unnamed technician"}</SelectItem>)}</SelectContent></Select>}</div>
      </article>;
    })}</div>}

    <Dialog open={Boolean(editor)} onOpenChange={(open) => !open && setEditor(null)}><NexusWorkflowDialog eyebrow="Client follow-up workflow" title={editor === "create" ? "Assign a client follow-up" : "Update client follow-up"} description="Keep a customer commitment clear: one accountable owner, one due date, and a safe record of completion." icon={CalendarClock} tone="sky" className="max-w-2xl" footer={<><Button variant="outline" onClick={() => setEditor(null)} disabled={saving}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CalendarClock className="mr-1.5 h-4 w-4" />}{editor === "create" ? "Assign follow-up" : "Save follow-up"}</Button></>}><div className="grid gap-4"><div className="grid gap-2"><Label htmlFor="client-follow-up-title">Next action</Label><Input id="client-follow-up-title" value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="e.g. Review service coverage with the client" autoFocus /></div><div className="grid gap-4 sm:grid-cols-2"><div className="grid gap-2"><Label>Type</Label><Select value={form.kind} onValueChange={(kind) => setForm((current) => ({ ...current, kind }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="task">Task</SelectItem><SelectItem value="call">Call</SelectItem><SelectItem value="meeting">Meeting</SelectItem><SelectItem value="review">Review</SelectItem></SelectContent></Select></div><div className="grid gap-2"><Label>Priority</Label><Select value={form.priority} onValueChange={(priority) => setForm((current) => ({ ...current, priority }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="normal">Normal</SelectItem><SelectItem value="high">High</SelectItem></SelectContent></Select></div></div><div className="grid gap-4 sm:grid-cols-2"><div className="grid gap-2"><Label htmlFor="client-follow-up-due">Due date and time</Label><Input id="client-follow-up-due" type="datetime-local" value={form.due_at} onChange={(event) => setForm((current) => ({ ...current, due_at: event.target.value }))} /></div><div className="grid gap-2"><Label>Accountable owner</Label><Select value={form.owner_id || currentUserId || undefined} onValueChange={(owner_id) => setForm((current) => ({ ...current, owner_id }))}><SelectTrigger><SelectValue placeholder="Choose a technician" /></SelectTrigger><SelectContent>{ownerOptions.map((owner) => <SelectItem key={owner.id} value={owner.id}>{owner.name || "Unnamed technician"}</SelectItem>)}</SelectContent></Select></div></div><div className="grid gap-2"><Label htmlFor="client-follow-up-note">Context (internal)</Label><Textarea id="client-follow-up-note" rows={4} value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} placeholder="What was promised, context the next owner needs, or the expected outcome." /></div></div></NexusWorkflowDialog></Dialog>
  </section>;
}
