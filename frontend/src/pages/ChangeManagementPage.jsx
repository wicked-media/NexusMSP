import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CheckCircle2, ChevronDown, ClipboardCheck, Clock3, Eye, FileText, GitBranch, History, Loader2, MoreHorizontal, Play, Plus, RefreshCw, RotateCcw, Snowflake, BellOff, XCircle } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";

const EMPTY_FORM = { title: "", description: "", category: "standard", risk_level: "medium", impact: "", rollback_plan: "", client_id: "", scheduled_date: "", maintenance_window: "" };
const STATUS_STYLE = {
  pending_review: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  approved: "border-sky-500/30 bg-sky-500/10 text-sky-200",
  implementing: "border-violet-500/30 bg-violet-500/10 text-violet-200",
  completed: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  rejected: "border-rose-500/30 bg-rose-500/10 text-rose-200",
  rollback: "border-rose-500/30 bg-rose-500/10 text-rose-200",
};
const RISK_STYLE = { high: "border-rose-500/30 bg-rose-500/10 text-rose-200", medium: "border-amber-500/30 bg-amber-500/10 text-amber-200", low: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" };
const CHANGE_VIEWS = new Set(["pending_review", "approved", "implementing", "history", "all"]);
const label = (value) => String(value || "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const displayDate = (value) => value ? new Date(value).toLocaleString() : "Not recorded";

export default function ChangeManagementPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [changes, setChanges] = useState([]);
  const [stats, setStats] = useState(null);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [clientQuery, setClientQuery] = useState("");
  const requestedTab = searchParams.get("view");
  const [tab, setTab] = useState(CHANGE_VIEWS.has(requestedTab) ? requestedTab : "pending_review");
  const [search, setSearch] = useState("");
  const [details, setDetails] = useState(null);
  const [actionDialog, setActionDialog] = useState(null);
  const [actionNote, setActionNote] = useState("");
  const [busy, setBusy] = useState(false);

  const fetchData = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const [changeResponse, statsResponse, clientResponse] = await Promise.all([
        axios.get(`${API}/change-management`, { headers }),
        axios.get(`${API}/change-management/stats`, { headers }),
        axios.get(`${API}/clients`, { headers }),
      ]);
      setChanges(changeResponse.data || []);
      setStats(statsResponse.data || null);
      setClients(clientResponse.data || []);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Change records could not be loaded");
    } finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    const nextTab = CHANGE_VIEWS.has(requestedTab) ? requestedTab : "pending_review";
    if (nextTab !== tab) setTab(nextTab);
  }, [requestedTab, tab]);

  const selectTab = (nextTab) => {
    setTab(nextTab);
    const nextParams = new URLSearchParams(searchParams);
    if (nextTab === "pending_review") nextParams.delete("view");
    else nextParams.set("view", nextTab);
    setSearchParams(nextParams, { replace: true });
  };

  const loadDetails = useCallback(async (changeId) => {
    try {
      const response = await axios.get(`${API}/change-management/${changeId}`, { headers });
      setDetails(response.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || "The current change record could not be loaded");
    }
  }, [headers]);

  const create = async () => {
    const matchingClient = clients.find((client) => client.id === form.client_id);
    setBusy(true);
    try {
      await axios.post(`${API}/change-management`, { ...form, client_name: matchingClient?.name || "" }, { headers });
      toast.success("Change request submitted for review");
      setShowCreate(false);
      setForm(EMPTY_FORM);
      setClientQuery("");
      await fetchData({ quiet: true });
    } catch (error) {
      toast.error(error.response?.data?.detail || "Change request could not be submitted");
    } finally { setBusy(false); }
  };

  const openAction = (change, action) => {
    setActionNote("");
    setActionDialog({ change, action });
  };

  const runAction = async () => {
    if (!actionDialog) return;
    const { change, action } = actionDialog;
    if (["approve", "implement", "reject", "complete", "rollback"].includes(action) && actionNote.trim().length < 8) {
      toast.error("Record an audit note of at least 8 characters before continuing.");
      return;
    }
    const payload = action === "reject" ? { reason: actionNote.trim() } : action === "complete" || action === "rollback" ? { notes: actionNote.trim() } : { note: actionNote.trim() };
    setBusy(true);
    try {
      const response = await axios.post(`${API}/change-management/${change.id}/${action}`, payload, { headers });
      toast.success(response.data?.message || "Change updated");
      setActionDialog(null);
      if (details?.id === change.id) await loadDetails(change.id);
      await fetchData({ quiet: true });
    } catch (error) {
      toast.error(error.response?.data?.detail || "Change action could not be completed");
    } finally { setBusy(false); }
  };

  const filtered = changes
    .filter((change) => tab === "all" || tab === "history" ? (tab === "history" ? ["completed", "rejected", "rollback"].includes(change.status) : true) : change.status === tab)
    .filter((change) => !search || [change.id, change.title, change.client_name, change.requested_by].filter(Boolean).join(" ").toLowerCase().includes(search.toLowerCase()));
  const actionConfig = actionDialog?.action === "reject" ? { title: "Reject change request", confirm: "Reject change", icon: XCircle, help: "Explain why this request cannot proceed. The reason becomes part of the permanent approval record." }
    : actionDialog?.action === "complete" ? { title: "Complete change", confirm: "Complete and audit", icon: CheckCircle2, help: "Record the implementation outcome and the validation performed before closing this change." }
      : actionDialog?.action === "rollback" ? { title: "Roll back change", confirm: "Record rollback", icon: RotateCcw, help: "Record why rollback was required and the resulting endpoint or service state." }
        : actionDialog?.action === "implement" ? { title: "Start implementation", confirm: "Start implementation", icon: Play, help: "This moves an approved change into implementation and records the technician who began it." }
          : { title: "Approve change request", confirm: "Approve change", icon: ClipboardCheck, help: "Record the independent reviewer, the decision rationale, and any CAB reference in the change history." };
  const ActionIcon = actionConfig?.icon || ClipboardCheck;

  return (
    <div className="space-y-6" data-testid="change-management-page">
      <OperationalPageHeader
        eyebrow="Service governance · controlled change lifecycle"
        title="Change Management"
        description="Plan, independently review, implement, and record client-impacting work with a complete lifecycle history."
        icon={GitBranch}
        tone="indigo"
        actions={<>
          <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="gap-1.5" data-testid="change-workspace-more"><MoreHorizontal className="h-3.5 w-3.5" />Workspace<ChevronDown className="h-3 w-3" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-56"><DropdownMenuItem onClick={() => navigate("/change-freezes")}><Snowflake className="mr-2 h-4 w-4" />Change freeze calendar</DropdownMenuItem><DropdownMenuItem onClick={() => navigate("/alert-rules")}><BellOff className="mr-2 h-4 w-4" />Alert rules engine</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
          <Button variant="outline" size="sm" onClick={() => fetchData()} disabled={loading}><RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
          <Button size="sm" onClick={() => setShowCreate(true)}><Plus className="mr-1 h-4 w-4" />New change</Button>
        </>}
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-6">
        <HeroTile label="All changes" value={stats?.total ?? "—"} icon={GitBranch} glow="indigo" subtitle="Recorded lifecycle" active={tab === "all"} onClick={() => selectTab("all")} />
        <HeroTile label="Awaiting review" value={stats?.pending_review ?? "—"} icon={Clock3} glow={(stats?.pending_review || 0) > 0 ? "amber" : "zinc"} subtitle="CAB decision required" active={tab === "pending_review"} onClick={() => selectTab("pending_review")} />
        <HeroTile label="Approved" value={stats?.approved ?? "—"} icon={ClipboardCheck} glow="sky" subtitle="Ready to schedule" active={tab === "approved"} onClick={() => selectTab("approved")} />
        <HeroTile label="Implementing" value={stats?.implementing ?? "—"} icon={Play} glow={(stats?.implementing || 0) > 0 ? "violet" : "zinc"} subtitle="Live controlled work" active={tab === "implementing"} onClick={() => selectTab("implementing")} />
        <HeroTile label="Completed" value={stats?.completed ?? "—"} icon={CheckCircle2} glow="emerald" subtitle="Validated outcomes" active={tab === "history"} onClick={() => selectTab("history")} />
        <HeroTile label="Rolled back" value={stats?.rollback ?? "—"} icon={RotateCcw} glow={(stats?.rollback || 0) > 0 ? "rose" : "zinc"} subtitle="Review implementation evidence" active={tab === "history"} onClick={() => selectTab("history")} />
      </div>

      <Card><CardContent className="p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><Tabs value={tab} onValueChange={selectTab}><TabsList><TabsTrigger value="pending_review">Review</TabsTrigger><TabsTrigger value="approved">Approved</TabsTrigger><TabsTrigger value="implementing">Implementing</TabsTrigger><TabsTrigger value="history">History</TabsTrigger><TabsTrigger value="all">All</TabsTrigger></TabsList></Tabs><div className="relative w-full lg:w-80"><Eye className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search change, client, requester…" /></div></div></CardContent></Card>

      <Card><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Change</TableHead><TableHead>Client</TableHead><TableHead>Type & risk</TableHead><TableHead>Schedule</TableHead><TableHead>Requester</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Controls</TableHead></TableRow></TableHeader><TableBody>{loading ? <TableRow><TableCell colSpan={7} className="py-12 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></TableCell></TableRow> : filtered.length === 0 ? <TableRow><TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">No change records match this view.</TableCell></TableRow> : filtered.map((change) => <TableRow key={change.id} data-testid={`change-${change.id}`}><TableCell><button className="max-w-64 text-left" onClick={() => setDetails(change)}><p className="font-mono text-[10px] text-muted-foreground">{change.id}</p><p className="mt-0.5 truncate font-medium hover:text-primary">{change.title}</p></button></TableCell><TableCell className="text-sm">{change.client_name || <span className="text-muted-foreground">Internal</span>}</TableCell><TableCell><div className="flex flex-wrap gap-1"><Badge variant="outline" className="text-[10px]">{label(change.category)}</Badge><Badge variant="outline" className={`text-[10px] ${RISK_STYLE[change.risk_level] || ""}`}>{label(change.risk_level)}</Badge></div></TableCell><TableCell className="text-xs text-muted-foreground">{change.scheduled_date || "Not scheduled"}{change.maintenance_window && <p className="mt-1">{change.maintenance_window}</p>}</TableCell><TableCell className="text-sm">{change.requested_by || "Unknown"}</TableCell><TableCell><Badge variant="outline" className={`text-[10px] ${STATUS_STYLE[change.status] || ""}`}>{label(change.status)}</Badge></TableCell><TableCell><div className="flex justify-end gap-1"><Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => setDetails(change)}><Eye className="mr-1 h-3.5 w-3.5" />View</Button>{change.status === "pending_review" && <><Button size="sm" className="h-8 px-2" onClick={() => openAction(change, "approve")} title="Approve"><CheckCircle2 className="h-3.5 w-3.5" /></Button><Button variant="destructive" size="sm" className="h-8 px-2" onClick={() => openAction(change, "reject")} title="Reject"><XCircle className="h-3.5 w-3.5" /></Button></>}{change.status === "approved" && <Button size="sm" className="h-8 px-2" onClick={() => openAction(change, "implement")}><Play className="mr-1 h-3.5 w-3.5" />Start</Button>}{change.status === "implementing" && <><Button size="sm" className="h-8 px-2" onClick={() => openAction(change, "complete")}><CheckCircle2 className="mr-1 h-3.5 w-3.5" />Complete</Button><Button variant="outline" size="sm" className="h-8 px-2" onClick={() => openAction(change, "rollback")}><RotateCcw className="h-3.5 w-3.5" /></Button></>}</div></TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card>

      <Dialog open={showCreate} onOpenChange={setShowCreate}><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle className="flex items-center gap-2"><GitBranch className="h-5 w-5 text-indigo-400" />Submit a controlled change</DialogTitle></DialogHeader><div className="grid gap-4 md:grid-cols-2"><div className="space-y-4 md:col-span-2"><div><Label htmlFor="change-title">Change title</Label><Input id="change-title" className="mt-1" value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="e.g. Replace edge firewall after hours" /></div><div><Label htmlFor="change-description">Implementation brief</Label><Textarea id="change-description" className="mt-1" rows={4} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="Describe the business reason, technical scope, systems affected and expected outcome." /></div></div><div><Label>Change type</Label><Select value={form.category} onValueChange={(value) => setForm((current) => ({ ...current, category: value }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{["standard", "normal", "emergency", "expedited"].map((value) => <SelectItem key={value} value={value}>{label(value)}</SelectItem>)}</SelectContent></Select></div><div><Label>Risk level</Label><Select value={form.risk_level} onValueChange={(value) => setForm((current) => ({ ...current, risk_level: value }))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{["low", "medium", "high"].map((value) => <SelectItem key={value} value={value}>{label(value)}</SelectItem>)}</SelectContent></Select></div><div className="md:col-span-2"><Label htmlFor="change-client">Client (optional)</Label><Input id="change-client" className="mt-1" list="change-client-options" value={clientQuery} onChange={(event) => { const match = clients.find((client) => client.name.toLowerCase() === event.target.value.toLowerCase()); setClientQuery(event.target.value); setForm((current) => ({ ...current, client_id: match?.id || "" })); }} placeholder="Type to find a client" /><datalist id="change-client-options">{clients.map((client) => <option key={client.id} value={client.name} />)}</datalist></div><div><Label htmlFor="change-date">Planned date</Label><Input id="change-date" className="mt-1" type="date" value={form.scheduled_date} onChange={(event) => setForm((current) => ({ ...current, scheduled_date: event.target.value }))} /></div><div><Label htmlFor="change-window">Maintenance window</Label><Input id="change-window" className="mt-1" value={form.maintenance_window} onChange={(event) => setForm((current) => ({ ...current, maintenance_window: event.target.value }))} placeholder="e.g. 19:00–20:00 AEST" /></div><div className="md:col-span-2"><Label htmlFor="change-impact">Impact assessment {form.category !== "standard" && <span className="text-amber-300">(required)</span>}</Label><Textarea id="change-impact" className="mt-1" rows={3} value={form.impact} onChange={(event) => setForm((current) => ({ ...current, impact: event.target.value }))} placeholder="Who and what could be affected? Include customer communication or outage impact." /></div><div className="md:col-span-2"><Label htmlFor="change-rollback">Rollback plan {form.risk_level !== "low" && <span className="text-amber-300">(required)</span>}</Label><Textarea id="change-rollback" className="mt-1" rows={3} value={form.rollback_plan} onChange={(event) => setForm((current) => ({ ...current, rollback_plan: event.target.value }))} placeholder="State the decision point, reversal steps, owner and validation needed to restore service." /></div></div><DialogFooter><Button variant="outline" onClick={() => setShowCreate(false)} disabled={busy}>Cancel</Button><Button onClick={create} disabled={busy || form.title.trim().length < 5 || form.description.trim().length < 12}>{busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Submit for review</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={!!details} onOpenChange={(open) => !open && setDetails(null)}><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle className="flex items-center gap-2"><FileText className="h-5 w-5 text-indigo-400" />{details?.title}</DialogTitle></DialogHeader>{details && <div className="space-y-5"><div className="flex flex-wrap gap-2"><Badge variant="outline" className={STATUS_STYLE[details.status]}>{label(details.status)}</Badge><Badge variant="outline" className={RISK_STYLE[details.risk_level]}>{label(details.risk_level)} risk</Badge><Badge variant="outline">{label(details.category)}</Badge></div><div className="grid gap-4 sm:grid-cols-2"><Card><CardContent className="p-3"><p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Client & schedule</p><p className="mt-2 text-sm">{details.client_name || "Internal change"}</p><p className="mt-1 text-xs text-muted-foreground">{details.scheduled_date || "No planned date"}{details.maintenance_window ? ` · ${details.maintenance_window}` : ""}</p></CardContent></Card><Card><CardContent className="p-3"><p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Request record</p><p className="mt-2 text-sm">Requested by {details.requested_by || "Unknown"}</p><p className="mt-1 text-xs text-muted-foreground">{displayDate(details.created_at)}</p></CardContent></Card></div><section><p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Implementation brief</p><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{details.description}</p></section><section><p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Impact assessment</p><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{details.impact || "Not recorded"}</p></section><section><p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Rollback plan</p><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{details.rollback_plan || "Not recorded"}</p></section><section><p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"><History className="h-3 w-3" />Lifecycle evidence</p><div className="mt-2 space-y-2">{(details.activity || []).length === 0 ? <p className="text-sm text-muted-foreground">No lifecycle events were recorded on this legacy change.</p> : details.activity.map((event, index) => <div key={`${event.at}-${index}`} className="rounded-lg border border-border bg-muted/20 p-3"><div className="flex items-center justify-between gap-3"><p className="text-sm font-medium">{label(event.action)}</p><p className="text-[10px] text-muted-foreground">{displayDate(event.at)}</p></div><p className="mt-1 text-xs text-muted-foreground">{event.by || "System"}{event.note ? ` · ${event.note}` : ""}</p></div>)}</div></section></div>}</DialogContent></Dialog>

      <Dialog open={!!actionDialog} onOpenChange={(open) => !open && setActionDialog(null)}>
        <NexusWorkflowDialog
          eyebrow="Controlled change"
          title={actionConfig?.title || "Change decision"}
          description={actionConfig?.help}
          icon={ActionIcon}
          tone={actionDialog?.action === "reject" || actionDialog?.action === "rollback" ? "amber" : "cyan"}
          footer={<><Button variant="outline" onClick={() => setActionDialog(null)} disabled={busy}>Cancel</Button><Button variant={actionDialog?.action === "reject" || actionDialog?.action === "rollback" ? "destructive" : "default"} onClick={runAction} disabled={busy}>{busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}{actionConfig?.confirm}</Button></>}
        >
          <div className="space-y-5">
            <div className="rounded-xl border border-border bg-muted/20 p-4 text-sm"><p className="font-medium">{actionDialog?.change.title}</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">{actionDialog?.change.id}</p></div>
            <div><Label htmlFor="change-action-note">{["reject", "complete", "rollback"].includes(actionDialog?.action) ? "Required evidence note" : "Required CAB or implementation note"}</Label><Textarea id="change-action-note" className="mt-2" rows={5} value={actionNote} onChange={(event) => setActionNote(event.target.value)} placeholder={actionDialog?.action === "complete" ? "Record validation tests, observed outcome and client communication." : actionDialog?.action === "rollback" ? "Record the rollback trigger, actions taken and recovered state." : actionDialog?.action === "reject" ? "Explain why this change cannot proceed and what is needed next." : "Add relevant decision or handover context."} /></div>
          </div>
        </NexusWorkflowDialog>
      </Dialog>
    </div>
  );
}
