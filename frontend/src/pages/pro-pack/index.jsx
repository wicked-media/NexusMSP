// All Pro-Pack pages in one shared module to keep imports light.
// Each export is a default page used via lazy() in routes.js.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TicketModuleHeader } from "@/components/tickets/TicketWorkspaceShell";
import HeroTile from "@/components/HeroTile";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { TICKET_PRIORITY_STYLES } from "@/lib/ticketWorkspaceHelpers";
import { LOCAL_PREVIEW_TICKETS, isLocalTicketPreview, normaliseTriageQueue } from "@/lib/ticketPreviewData";
import { toast } from "sonner";
import {
  Inbox, Loader2, Plus, Trash2, AlertTriangle, CheckCircle, Save, Webhook, Send,
  Heart, Calendar, Phone, KeySquare, Briefcase, BookOpen,
  ShieldOff, ScanLine, BarChart3, BellRing, FileSpreadsheet, Activity, MapPin,
  Sparkles, RefreshCw, GitMerge, Workflow, Layers, Zap, Users, Receipt, ChevronRight,
  Shield, Clock,
} from "lucide-react";

const useApi = () => {
  const { token } = useAuth();
  return { headers: { Authorization: `Bearer ${token}` } };
};

const PageHeader = ({ title, subtitle, icon: Icon = Sparkles, children }) => (
  <div className="flex items-start justify-between mb-5">
    <div>
      <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
        <Icon className="w-6 h-6 text-violet-400" />{title}
      </h1>
      {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
    </div>
    {children && <div className="flex gap-2">{children}</div>}
  </div>
);

/* ============== TRIAGE QUEUE ============== */
export function TriageQueuePage({ embedded = false }) {
  const { headers } = useApi();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const load = () => axios.get(`${API}/pro-pack/triage-queue`, { headers })
    .then(r => { setData(normaliseTriageQueue(r.data, isLocalTicketPreview() ? LOCAL_PREVIEW_TICKETS : [])); setLoadError(false); })
    .catch(() => { setData(normaliseTriageQueue(null, isLocalTicketPreview() ? LOCAL_PREVIEW_TICKETS : [])); setLoadError(true); });
  useEffect(() => { load(); const i = setInterval(load, 30000); return () => clearInterval(i); }, []); // eslint-disable-line
  if (!data) return <div className="p-6 space-y-4"><TicketModuleHeader title="Triage queue" subtitle="Loading unassigned tickets…" /><Loader2 className="w-6 h-6 mx-auto my-12 animate-spin" /></div>;
  return (
    <div className="space-y-4" data-testid="triage-queue-page">
      {!embedded && <TicketModuleHeader
        title="Triage queue"
        subtitle={`${data.count} unassigned · oldest ${Math.floor(data.oldest_age_minutes / 60)}h ${data.oldest_age_minutes % 60}m · ordered for rapid ownership`}
        actions={
        <Button variant="outline" size="sm" onClick={load}><RefreshCw className="w-3.5 h-3.5 mr-1" />Refresh</Button>
        }
      />}
      {loadError && <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-200">Live triage data is unavailable. Showing the safe local queue.</div>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Object.entries(data.by_priority || {}).map(([priority, count]) => (
          <HeroTile
            key={priority}
            label={priority}
            value={count}
            icon={priority === "critical" ? AlertTriangle : Inbox}
            glow={priority === "critical" ? "rose" : priority === "high" ? "amber" : priority === "medium" ? "cyan" : "zinc"}
            subtitle={priority === "critical" ? "Immediate ownership" : priority === "high" ? "Priority review" : priority === "medium" ? "Planned response" : "Monitor queue"}
            testId={`triage-metric-${priority}`}
          />
        ))}
      </div>
      <Card className="overflow-hidden border-white/[0.08] bg-[#101217]/80"><CardContent className="p-0"><Table>
        <TableHeader><TableRow><TableHead>Ticket</TableHead><TableHead>Service brief</TableHead><TableHead>Client</TableHead><TableHead>Priority</TableHead><TableHead>Source</TableHead><TableHead>Age</TableHead><TableHead className="text-right">Next step</TableHead></TableRow></TableHeader>
        <TableBody>{(data.items || []).map(t => (
          <TableRow key={t.id} className="group cursor-pointer transition-colors hover:bg-cyan-500/[0.035]" onClick={() => navigate(`/tickets?ticket=${encodeURIComponent(t.id)}`)}>
            <TableCell className="font-mono text-xs">{t.ticket_number}</TableCell>
            <TableCell><p className="max-w-[440px] truncate font-medium text-foreground">{t.title}</p><p className="mt-0.5 text-[10px] text-muted-foreground">Unassigned · ready for technician ownership</p></TableCell>
            <TableCell className="text-sm text-muted-foreground">{t.client_name}</TableCell>
            <TableCell><Badge className={`text-[10px] capitalize ${TICKET_PRIORITY_STYLES[t.priority]?.badge || TICKET_PRIORITY_STYLES.medium.badge}`}>{t.priority}</Badge></TableCell>
            <TableCell><Badge variant="outline" className="text-[10px]">{t.source || "manual"}</Badge></TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground">{t.created_at?.slice(0, 16).replace("T", " ")}</TableCell>
            <TableCell className="text-right"><Button type="button" size="sm" variant="outline" className="h-8 border-cyan-500/20 text-xs text-cyan-200 opacity-70 transition-opacity group-hover:opacity-100" onClick={(event) => { event.stopPropagation(); navigate(`/tickets?ticket=${encodeURIComponent(t.id)}`); }} data-testid={`triage-review-${t.id}`}>Review & assign<ChevronRight className="ml-1 h-3.5 w-3.5" /></Button></TableCell>
          </TableRow>
        ))}</TableBody>
      </Table>{(data.items || []).length === 0 && <p className="py-12 text-center text-sm text-muted-foreground">No unassigned tickets need triage.</p>}</CardContent></Card>
    </div>
  );
}

/* ============== SERVICE CATALOG ============== */
export function ServiceCatalogPage() {
  const { headers } = useApi();
  const [items, setItems] = useState([]);
  const [usage, setUsage] = useState({});
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState(null);
  const [archiveCandidate, setArchiveCandidate] = useState(null);
  const [form, setForm] = useState({ name: "", code: "", category: "managed_services", default_priority: "medium", sla_response_hours: 4, sla_resolve_hours: 24, billing_unit_price: 0, billing_unit: "each", is_active: true });
  const fetch = () => { setLoading(true); return Promise.all([axios.get(`${API}/pro-pack/service-catalog`, { headers }), axios.get(`${API}/pro-pack/service-catalog/usage/summary`, { headers }).catch(() => ({ data: { usage: [] } }))]).then(([services, usageResult]) => { setItems(services.data || []); setUsage(Object.fromEntries((usageResult.data?.usage || []).map(row => [row.service_id, row]))); }).catch(() => toast.error("Could not load the service catalog")).finally(() => setLoading(false)); };
  useEffect(() => { fetch(); }, []); // eslint-disable-line
  const save = async () => {
    if (!form.name.trim() || !form.code.trim()) { toast.error("Service name and code are required"); return; }
    try {
      if (editing) await axios.put(`${API}/pro-pack/service-catalog/${editing.id}`, form, { headers });
      else await axios.post(`${API}/pro-pack/service-catalog`, form, { headers });
      toast.success("Saved"); setShow(false); setEditing(null); fetch();
    } catch (error) { toast.error(error.response?.data?.detail || "Save failed"); }
  };
  const del = async (id) => {
    try {
      await axios.delete(`${API}/pro-pack/service-catalog/${id}`, { headers });
      toast.success("Service archived");
      setArchiveCandidate(null);
      fetch();
    } catch (error) { toast.error(error.response?.data?.detail || "Service could not be archived"); }
  };
  const activeItems = items.filter(s => s.is_active !== false);
  const visibleItems = items.filter(s => (showArchived || s.is_active !== false) && `${s.name} ${s.code} ${s.category}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="space-y-5" data-testid="service-catalog-page">
      <div className="rounded-2xl border border-cyan-500/20 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.15),transparent_35%),radial-gradient(circle_at_top_left,rgba(16,185,129,0.08),transparent_28%),linear-gradient(135deg,rgba(17,19,24,0.98),rgba(10,12,17,0.98))] p-5 shadow-[0_22px_65px_rgba(0,0,0,0.20)] md:p-6"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-300">Service policy register</p><h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight"><Briefcase className="h-6 w-6 text-cyan-200" />Service Catalog</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Every policy applies an auditable service classification, SLA targets, routing defaults and billable context at ticket intake. Historic tickets retain the policy snapshot.</p></div><Button onClick={() => { setEditing(null); setForm({ name: "", code: "", category: "managed_services", default_priority: "medium", sla_response_hours: 4, sla_resolve_hours: 24, billing_unit_price: 0, billing_unit: "each", is_active: true }); setShow(true); }} data-testid="new-service-btn"><Plus className="mr-2 h-4 w-4" />New service policy</Button></div></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <HeroTile label="Active policies" value={activeItems.length} icon={Briefcase} glow="cyan" subtitle="Available during ticket intake" testId="service-catalog-stat-active" />
        <HeroTile label="Billable services" value={activeItems.filter(s => Number(s.billing_unit_price || 0) > 0).length} icon={Receipt} glow="emerald" subtitle="With a billable unit price" testId="service-catalog-stat-billable" />
        <HeroTile label="Priority services" value={activeItems.filter(s => ["critical", "high"].includes(s.default_priority)).length} icon={AlertTriangle} glow="amber" subtitle="High or critical by default" testId="service-catalog-stat-priority" />
        <HeroTile label="Archived" value={items.filter(s => s.is_active === false).length} icon={Layers} glow="sky" subtitle="Kept for historic ticket context" testId="service-catalog-stat-archived" />
      </div>
      <Card className="overflow-hidden border-border/70"><CardContent className="p-0"><div className="flex flex-col gap-3 border-b border-border/60 p-3 md:flex-row md:items-center md:justify-between"><Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search service name, code, or category" className="max-w-md" data-testid="service-catalog-search" /><div className="flex items-center gap-2"><Switch checked={showArchived} onCheckedChange={setShowArchived} /><span className="text-xs text-muted-foreground">Show archived</span><Button size="sm" variant="outline" onClick={fetch}><RefreshCw className="mr-1 h-3.5 w-3.5" />Refresh</Button></div></div><Table>
        <TableHeader><TableRow><TableHead>Service policy</TableHead><TableHead>Code</TableHead><TableHead>Ticket defaults</TableHead><TableHead>SLA response</TableHead><TableHead>SLA resolve</TableHead><TableHead>Ticket evidence</TableHead><TableHead className="text-right">Billable context</TableHead><TableHead></TableHead></TableRow></TableHeader>
        <TableBody>{visibleItems.map(s => (
          <TableRow key={s.id} className={s.is_active === false ? "opacity-55" : ""}>
            <TableCell><div className="font-medium">{s.name}</div><div className="mt-0.5 text-[10px] text-muted-foreground line-clamp-1">{s.description || "No service description"}</div></TableCell>
            <TableCell className="font-mono text-xs">{s.code}</TableCell>
            <TableCell><div className="flex flex-wrap gap-1"><Badge variant="outline" className="text-[10px] capitalize">{s.category?.replace("_", " ")}</Badge><Badge variant="outline" className="text-[10px] capitalize">{s.default_priority}</Badge>{s.is_active === false && <Badge variant="outline" className="border-amber-500/25 text-[9px] text-amber-300">archived</Badge>}</div></TableCell>
            <TableCell className="text-xs">{s.sla_response_hours}h</TableCell>
            <TableCell className="text-xs">{s.sla_resolve_hours}h</TableCell>
            <TableCell><div className="text-xs font-medium">{usage[s.id]?.tickets || 0} tickets</div><div className="mt-0.5 text-[10px] text-muted-foreground">{usage[s.id]?.open_tickets || 0} open{usage[s.id]?.last_used_at ? ` · last ${new Date(usage[s.id].last_used_at).toLocaleDateString()}` : ""}</div></TableCell>
            <TableCell className="text-right font-mono">${Number(s.billing_unit_price || 0).toFixed(2)}/{s.billing_unit}</TableCell>
            <TableCell className="text-right">
              <Button size="sm" variant="ghost" onClick={() => { setEditing(s); setForm(s); setShow(true); }}><Save className="w-3 h-3" /></Button>
              {s.is_active !== false && <Button size="sm" variant="ghost" onClick={() => setArchiveCandidate(s)} aria-label={`Archive ${s.name}`}><Trash2 className="w-3 h-3 text-rose-400" /></Button>}
            </TableCell>
          </TableRow>
        ))}</TableBody>
      </Table>{loading ? <p className="py-12 text-center text-muted-foreground text-sm"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading services…</p> : visibleItems.length === 0 && <p className="py-12 text-center text-muted-foreground text-sm">No matching services. Create one to make intake consistent.</p>}</CardContent></Card>
      <Dialog open={show} onOpenChange={setShow}><DialogContent className="max-w-3xl gap-0 overflow-hidden border-cyan-500/25 bg-[linear-gradient(145deg,rgba(9,22,30,0.98),rgba(13,15,21,0.98))] p-0">
        <DialogHeader className="border-b border-cyan-400/15 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.17),transparent_45%),linear-gradient(135deg,rgba(16,185,129,0.08),transparent)] px-6 py-5 pr-14">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Service policy workspace</p>
          <DialogTitle className="mt-1 flex items-center gap-2 text-xl text-zinc-100"><span className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-400/10"><Briefcase className="h-4 w-4 text-cyan-200" /></span>{editing ? "Refine service policy" : "Create service policy"}</DialogTitle>
          <DialogDescription className="mt-2 max-w-xl">Define the default ticket treatment, SLA commitment and billable unit once. Every ticket keeps an auditable snapshot of this policy.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[68vh] space-y-5 overflow-y-auto px-6 py-5">
          <section className="space-y-3"><div><p className="text-xs font-semibold text-zinc-200">Policy identity</p><p className="mt-0.5 text-[11px] text-zinc-500">Use a clear client-facing name and a short internal code.</p></div>
            <div className="grid gap-3 md:grid-cols-[1fr_180px]"><div><Label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Service name</Label><Input autoFocus placeholder="e.g. Managed endpoint support" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div><div><Label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Policy code</Label><Input placeholder="MS-ENDPOINT" value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} /></div></div>
            <div><Label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Technician guidance</Label><Textarea rows={3} placeholder="Explain when this policy should be selected and any included work." value={form.description || ""} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
          </section>
          <section className="grid gap-3 border-y border-white/[0.07] py-5 md:grid-cols-3"><div><Label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Service category</Label><Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="managed_services">Managed Services</SelectItem><SelectItem value="security">Security</SelectItem><SelectItem value="backup">Backup</SelectItem><SelectItem value="consulting">Consulting</SelectItem><SelectItem value="project">Project</SelectItem></SelectContent></Select></div>
            <div><Label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Default priority</Label><Select value={form.default_priority} onValueChange={v => setForm({ ...form, default_priority: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="critical">Critical</SelectItem></SelectContent></Select></div>
            <div><Label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Billing unit</Label><Select value={form.billing_unit} onValueChange={v => setForm({ ...form, billing_unit: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="each">Each</SelectItem><SelectItem value="hour">Hour</SelectItem><SelectItem value="month">Month</SelectItem><SelectItem value="user">User</SelectItem></SelectContent></Select></div>
          </section>
          <section className="grid gap-3 md:grid-cols-3"><div className="rounded-xl border border-cyan-500/15 bg-cyan-500/[0.04] p-3"><Label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-200">Response target</Label><div className="flex items-center gap-2"><Input className="bg-black/15" type="number" min="0" step="0.5" value={form.sla_response_hours} onChange={e => setForm({ ...form, sla_response_hours: Number(e.target.value) })} /><span className="text-xs text-zinc-500">hours</span></div></div>
            <div className="rounded-xl border border-cyan-500/15 bg-cyan-500/[0.04] p-3"><Label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-200">Resolution target</Label><div className="flex items-center gap-2"><Input className="bg-black/15" type="number" min="0" step="0.5" value={form.sla_resolve_hours} onChange={e => setForm({ ...form, sla_resolve_hours: Number(e.target.value) })} /><span className="text-xs text-zinc-500">hours</span></div></div>
            <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/[0.04] p-3"><Label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-200">Unit price</Label><div className="flex items-center gap-2"><span className="text-sm text-zinc-500">$</span><Input className="bg-black/15" type="number" min="0" step="0.01" value={form.billing_unit_price} onChange={e => setForm({ ...form, billing_unit_price: Number(e.target.value) })} /></div></div>
          </section>
          <div className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-black/15 p-4"><div><p className="text-sm font-medium text-zinc-100">Available for new tickets</p><p className="mt-1 max-w-lg text-xs text-zinc-500">Turning this off preserves historic reporting and ticket snapshots, but removes this policy from future intake.</p></div><Switch checked={form.is_active !== false} onCheckedChange={is_active => setForm({ ...form, is_active })} /></div>
        </div>
        <DialogFooter className="border-t border-white/[0.07] bg-black/10 px-6 py-4"><Button variant="ghost" onClick={() => setShow(false)}>Cancel</Button><Button className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400" onClick={save} data-testid="save-service-btn"><Save className="mr-2 h-4 w-4" />{editing ? "Save policy" : "Create policy"}</Button></DialogFooter>
      </DialogContent></Dialog>
      <AlertDialog open={Boolean(archiveCandidate)} onOpenChange={(open) => !open && setArchiveCandidate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive service policy?</AlertDialogTitle>
            <AlertDialogDescription>
              {archiveCandidate?.name || "This service"} will stay on historic tickets and reports, but will no longer be available during new ticket intake.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-3 text-sm text-muted-foreground">
            This does not cancel active work or alter existing billing records.
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep active</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => del(archiveCandidate.id)}>Archive policy</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ============== CUSTOMER HEALTH ============== */
export function CustomerHealthPage({ embedded = false }) {
  const { headers } = useApi();
  const [items, setItems] = useState([]);
  useEffect(() => { axios.get(`${API}/pro-pack/customer-health`, { headers }).then(r => setItems(r.data)); }, []); // eslint-disable-line
  return (
    <div className="p-6 space-y-4" data-testid="customer-health-page">
      {!embedded && <PageHeader title="Customer Health" subtitle="Composite score: open tickets, criticals, overdue invoices, CSAT" icon={Heart} />}
      <Card><CardContent className="p-0"><Table>
        <TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Score</TableHead><TableHead>Open Tickets</TableHead><TableHead>Critical</TableHead><TableHead>Overdue Invoices</TableHead></TableRow></TableHeader>
        <TableBody>{items.map(c => (
          <TableRow key={c.client_id}>
            <TableCell className="font-medium">{c.client_name}</TableCell>
            <TableCell><div className="flex items-center gap-2">
              <div className="w-24 h-2 rounded bg-muted overflow-hidden"><div className={`h-full ${c.score >= 80 ? "bg-emerald-500" : c.score >= 60 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${c.score}%` }} /></div>
              <span className="font-mono text-sm w-10">{c.score}</span>
            </div></TableCell>
            <TableCell className="text-center font-mono">{c.open_tickets}</TableCell>
            <TableCell className="text-center font-mono text-rose-400">{c.critical}</TableCell>
            <TableCell className="text-center font-mono text-amber-400">{c.overdue_invoices}</TableCell>
          </TableRow>
        ))}</TableBody>
      </Table></CardContent></Card>
    </div>
  );
}

/* ============== QUOTE TO CASH ============== */
export function QuoteToCashPage() {
  const { headers } = useApi();
  const [data, setData] = useState(null);
  useEffect(() => { axios.get(`${API}/pro-pack/quote-to-cash`, { headers }).then(r => setData(r.data)); }, []); // eslint-disable-line
  if (!data) return <Loader2 className="w-6 h-6 mx-auto my-12 animate-spin" />;
  const fmt = (n) => `$${(n || 0).toLocaleString()}`;
  const stageIcons = { leads: Users, estimates: FileSpreadsheet, contracts: Briefcase, invoices: Receipt, recurring: RefreshCw };
  const stageGlows = { leads: "cyan", estimates: "sky", contracts: "violet", invoices: "amber", recurring: "emerald" };
  const stages = [
    { key: "leads", label: "Leads", icon: "🎯", color: "text-cyan-400", value: data.leads.value, count: data.leads.count, link: "/leads" },
    { key: "estimates", label: "Estimates", icon: "📋", color: "text-blue-400", value: data.estimates.value, count: data.estimates.count, link: "/estimates" },
    { key: "contracts", label: "Contracts", icon: "📝", color: "text-violet-400", value: data.contracts.active_mrr, count: data.contracts.count, link: "/contracts", suffix: " MRR" },
    { key: "invoices", label: "Invoices", icon: "🧾", color: "text-amber-400", value: data.invoices.outstanding, count: data.invoices.count, link: "/invoices", suffix: " outstanding" },
    { key: "recurring", label: "Recurring", icon: "🔁", color: "text-emerald-400", value: data.recurring.mrr_aud, count: data.recurring.count, link: "/recurring-invoices", suffix: " MRR" },
  ];
  return (
    <div className="p-6 space-y-4" data-testid="qtc-page">
      <PageHeader title="Quote → Cash Pipeline" subtitle="End-to-end revenue funnel: lead → invoice → MRR" icon={Workflow} />
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        {stages.map(s => (
          <HeroTile key={s.key} label={s.label} value={fmt(s.value)} icon={stageIcons[s.key]} glow={stageGlows[s.key]} animated={false} subtitle={`${s.count} item${s.count !== 1 ? "s" : ""}${s.suffix || ""}`} onClick={() => window.location.href = s.link} testId={`qtc-stage-${s.key}`} />
        ))}
      </div>
      <Card><CardHeader><CardTitle className="text-sm">Estimate Conversion</CardTitle></CardHeader><CardContent>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div className="border rounded-md p-3"><p className="text-[10px] uppercase text-muted-foreground">Drafts</p><p className="text-2xl font-bold mt-1">{data.estimates.draft}</p></div>
          <div className="border rounded-md p-3"><p className="text-[10px] uppercase text-muted-foreground">Sent</p><p className="text-2xl font-bold mt-1 text-cyan-400">{data.estimates.sent}</p></div>
          <div className="border rounded-md p-3"><p className="text-[10px] uppercase text-muted-foreground">Accepted</p><p className="text-2xl font-bold mt-1 text-emerald-400">{data.estimates.accepted}</p></div>
        </div>
      </CardContent></Card>
    </div>
  );
}

/* ============== NOTIFY CHANNELS ============== */
export function NotifyChannelsPage() {
  const { headers } = useApi();
  const [items, setItems] = useState([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ name: "", kind: "slack", webhook_url: "", events: ["ticket_created", "sla_breach", "invoice_paid"] });
  const fetch = () => axios.get(`${API}/pro-pack/notify-channels`, { headers }).then(r => setItems(r.data));
  useEffect(() => { fetch(); }, []); // eslint-disable-line
  const save = async () => { try { await axios.post(`${API}/pro-pack/notify-channels`, form, { headers }); toast.success("Channel saved"); setShow(false); setForm({ name: "", kind: "slack", webhook_url: "", events: ["ticket_created"] }); fetch(); } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); } };
  const test = async (id) => { try { const r = await axios.post(`${API}/pro-pack/notify-channels/${id}/test`, {}, { headers }); toast.success(`Test sent — HTTP ${r.data.status_code}`); } catch (e) { toast.error(e.response?.data?.detail || "Test failed"); } };
  const del = async (id) => { await axios.delete(`${API}/pro-pack/notify-channels/${id}`, { headers }); fetch(); };
  return (
    <div className="p-6 space-y-4" data-testid="notify-channels-page">
      <PageHeader title="Slack / Teams / Discord Webhooks" subtitle="Push real-time NexusOps events to your team channels" icon={Webhook}>
        <Button size="sm" onClick={() => setShow(true)} data-testid="new-channel-btn"><Plus className="w-3.5 h-3.5 mr-1" />New Channel</Button>
      </PageHeader>
      <Card><CardContent className="p-0"><Table>
        <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Kind</TableHead><TableHead>Webhook</TableHead><TableHead>Events</TableHead><TableHead></TableHead></TableRow></TableHeader>
        <TableBody>{items.map(c => (
          <TableRow key={c.id}>
            <TableCell className="font-medium">{c.name}</TableCell>
            <TableCell><Badge variant="outline" className="text-[10px] capitalize">{c.kind}</Badge></TableCell>
            <TableCell className="text-xs text-muted-foreground font-mono truncate max-w-[260px]">{c.webhook_url}</TableCell>
            <TableCell className="text-xs">{(c.events || []).join(", ")}</TableCell>
            <TableCell className="text-right">
              <Button size="sm" variant="ghost" onClick={() => test(c.id)} data-testid={`test-${c.id}`}><Send className="w-3 h-3 mr-1" />Test</Button>
              <Button size="sm" variant="ghost" onClick={() => del(c.id)}><Trash2 className="w-3 h-3 text-rose-400" /></Button>
            </TableCell>
          </TableRow>
        ))}</TableBody>
      </Table></CardContent></Card>
      <Dialog open={show} onOpenChange={setShow}><DialogContent>
        <DialogHeader><DialogTitle>New Webhook Channel</DialogTitle><DialogDescription>Pick destination, paste the incoming-webhook URL, and you're live.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div><Label>Channel Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. #ops-alerts" data-testid="ch-name" /></div>
          <div><Label>Platform</Label><Select value={form.kind} onValueChange={v => setForm({ ...form, kind: v })}><SelectTrigger data-testid="ch-kind"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="slack">Slack</SelectItem><SelectItem value="teams">Microsoft Teams</SelectItem><SelectItem value="discord">Discord</SelectItem></SelectContent></Select></div>
          <div><Label>Incoming Webhook URL</Label><Input value={form.webhook_url} onChange={e => setForm({ ...form, webhook_url: e.target.value })} placeholder="https://hooks.slack.com/services/..." data-testid="ch-url" /></div>
        </div>
        <DialogFooter><Button variant="ghost" onClick={() => setShow(false)}>Cancel</Button><Button onClick={save} data-testid="save-channel">Add Channel</Button></DialogFooter>
      </DialogContent></Dialog>
    </div>
  );
}

/* ============== PATCH TUESDAY ============== */
export function PatchTuesdayPage() {
  const { headers } = useApi();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const load = () => axios.get(`${API}/pro-pack/patch-tuesday?months=12`, { headers })
    .then(r => setData(r.data))
    .catch(() => toast.error("Could not load the Patch Tuesday calendar"));
  useEffect(() => { load(); }, []); // eslint-disable-line
  if (!data) return <Loader2 className="w-6 h-6 mx-auto my-12 animate-spin" />;
  const events = data.events || [];
  const upcoming = events.filter(event => !event.is_past);
  const nextPatch = upcoming[0];
  const thisWeek = upcoming.filter(event => event.days_until <= 7).length;
  return (
    <div className="space-y-5" data-testid="patch-tuesday-page">
      <section className="rounded-2xl border border-sky-500/20 bg-gradient-to-br from-sky-500/[0.10] via-background to-background p-5 md:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div><p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-sky-300">Patch operations</p><h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight"><Calendar className="h-6 w-6 text-sky-300" />Patch Tuesday</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Plan around Microsoft release dates, then schedule approved Windows updates through an auditable Nexus Agent maintenance window.</p></div>
          <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={load} data-testid="refresh-patch-calendar"><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Refresh</Button><Button size="sm" onClick={() => navigate("/maintenance-scheduler")} data-testid="open-patch-manager"><Shield className="mr-1.5 h-3.5 w-3.5" />Schedule maintenance</Button></div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <HeroTile label="Next release" value={nextPatch ? new Date(`${nextPatch.date}T00:00:00`).getDate() : "-"} subtitle={nextPatch ? nextPatch.month : "No release scheduled"} icon={Calendar} glow="sky" animated={false} testId="patch-tuesday-next-release" />
        <HeroTile label="Days to prepare" value={nextPatch ? Math.max(nextPatch.days_until, 0) : "-"} subtitle={nextPatch?.days_until === 0 ? "Release day" : "Until the next release"} icon={Clock} glow={nextPatch?.days_until <= 7 ? "amber" : "cyan"} animated={false} testId="patch-tuesday-days-until" />
        <HeroTile label="Release this week" value={thisWeek} subtitle={thisWeek ? "Review approval rings" : "No release this week"} icon={AlertTriangle} glow={thisWeek ? "amber" : "emerald"} animated={false} testId="patch-tuesday-this-week" />
        <HeroTile label="Planning horizon" value={upcoming.length} subtitle="Upcoming monthly releases" icon={Shield} glow="emerald" animated={false} testId="patch-tuesday-upcoming" />
      </div>

      <Card className="overflow-hidden border-border/70"><CardHeader className="border-b border-border/60 py-4"><CardTitle className="text-sm">Release calendar</CardTitle><p className="text-xs text-muted-foreground">Each entry is the second Tuesday of the month. Schedule selected assets when an approved update window is ready.</p></CardHeader><CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
        {events.map(e => {
          const isImmediate = !e.is_past && e.days_until <= 7;
          return <button type="button" key={e.date} onClick={() => navigate("/maintenance-scheduler")} className={`rounded-xl border p-4 text-left transition-colors hover:border-sky-500/40 hover:bg-sky-500/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${e.is_past ? "border-border/50 opacity-55" : isImmediate ? "border-amber-500/40 bg-amber-500/[0.04]" : "border-border/70 bg-card/40"}`} data-testid={`patch-release-${e.date}`}>
            <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{e.month}</p><p className="mt-1 text-3xl font-semibold tabular-nums">{new Date(`${e.date}T00:00:00`).getDate()}</p></div><Badge variant="outline" className={e.is_past ? "border-border/60 text-muted-foreground" : isImmediate ? "border-amber-500/30 text-amber-300" : "border-sky-500/30 text-sky-300"}>{e.is_past ? "Completed" : e.days_until === 0 ? "Release day" : `In ${e.days_until} days`}</Badge></div>
            <p className="mt-3 text-xs text-muted-foreground">Open Maintenance to select assets, queue approved updates, and retain endpoint result evidence.</p>
          </button>;
        })}
      </CardContent></Card>
    </div>
  );
}

/* ============== API TOKENS ============== */
export function ApiTokensPage() {
  const { headers } = useApi();
  const [items, setItems] = useState([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ name: "", scopes: ["read"] });
  const [created, setCreated] = useState(null);
  const [revokeCandidate, setRevokeCandidate] = useState(null);
  const fetch = () => axios.get(`${API}/pro-pack/api-tokens`, { headers }).then(r => setItems(r.data));
  useEffect(() => { fetch(); }, []); // eslint-disable-line
  const save = async () => { try { const r = await axios.post(`${API}/pro-pack/api-tokens`, form, { headers }); setCreated(r.data); fetch(); setShow(false); } catch { toast.error("Create failed"); } };
  const revoke = async (id) => { try { await axios.delete(`${API}/pro-pack/api-tokens/${id}`, { headers }); toast.success("API token revoked"); setRevokeCandidate(null); fetch(); } catch (error) { toast.error(error.response?.data?.detail || "Token could not be revoked"); } };
  return (
    <div className="p-6 space-y-4" data-testid="api-tokens-page">
      <PageHeader title="API Tokens" subtitle="Programmatic access — sha256-hashed at rest" icon={KeySquare}>
        <Button size="sm" onClick={() => setShow(true)} data-testid="new-token-btn"><Plus className="w-3.5 h-3.5 mr-1" />New Token</Button>
      </PageHeader>
      {created && (
        <Card className="border-emerald-500/40 bg-emerald-500/[0.04]"><CardContent className="pt-4 pb-3">
          <p className="text-sm font-semibold mb-1">Token created — copy it now! It will not be shown again.</p>
          <code className="block bg-black/20 p-2 rounded text-xs font-mono break-all">{created.token}</code>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => setCreated(null)}>Dismiss</Button>
        </CardContent></Card>
      )}
      <Card><CardContent className="p-0"><Table>
        <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Preview</TableHead><TableHead>Scopes</TableHead><TableHead>Created</TableHead><TableHead></TableHead></TableRow></TableHeader>
        <TableBody>{items.map(t => (
          <TableRow key={t.id} className={t.is_active === false ? "opacity-50" : ""}>
            <TableCell>{t.name}</TableCell>
            <TableCell className="font-mono text-xs">{t.secret_preview}</TableCell>
            <TableCell><div className="flex gap-1 flex-wrap">{(t.scopes || []).map(s => <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>)}</div></TableCell>
            <TableCell className="text-xs">{t.created_at?.slice(0, 10)}</TableCell>
            <TableCell className="text-right">{t.is_active !== false && <Button size="sm" variant="ghost" onClick={() => setRevokeCandidate(t)} aria-label={`Revoke ${t.name}`}><Trash2 className="w-3 h-3 text-rose-400" /></Button>}</TableCell>
          </TableRow>
        ))}</TableBody>
      </Table></CardContent></Card>
      <Dialog open={show} onOpenChange={setShow}><DialogContent>
        <DialogHeader><DialogTitle>New API Token</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name / Purpose</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Zapier integration" /></div>
          <div><Label>Scopes</Label>
            <div className="flex gap-2 flex-wrap">{["read", "write", "admin", "billing", "tickets", "devices"].map(s => (
              <Badge key={s} variant={form.scopes.includes(s) ? "default" : "outline"} className="cursor-pointer" onClick={() => setForm({ ...form, scopes: form.scopes.includes(s) ? form.scopes.filter(x => x !== s) : [...form.scopes, s] })}>{s}</Badge>
            ))}</div>
          </div>
        </div>
        <DialogFooter><Button variant="ghost" onClick={() => setShow(false)}>Cancel</Button><Button onClick={save} data-testid="confirm-create-token">Create</Button></DialogFooter>
      </DialogContent></Dialog>
      <AlertDialog open={Boolean(revokeCandidate)} onOpenChange={(open) => !open && setRevokeCandidate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API token?</AlertDialogTitle>
            <AlertDialogDescription>
              {revokeCandidate?.name || "This token"} will stop authenticating immediately. Any integration using it must be updated with a replacement token.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/[0.06] p-3 text-sm text-muted-foreground">This action is logged and cannot be undone.</div>
          <AlertDialogFooter><AlertDialogCancel>Keep token</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => revoke(revokeCandidate.id)}>Revoke token</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ============== 2FA ============== */
export function Security2FAPage() {
  const { headers } = useApi();
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState("");
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(true);
  const [disableMode, setDisableMode] = useState(false);
  const [password, setPassword] = useState("");
  useEffect(() => {
    axios.get(`${API}/pro-pack/2fa`, { headers })
      .then(r => setVerified(Boolean(r.data?.enabled)))
      .catch(() => toast.error("Could not load 2FA status"))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const start = async () => { try { const r = await axios.post(`${API}/pro-pack/2fa/setup`, {}, { headers }); setSetup(r.data); setCode(""); } catch { toast.error("Setup failed"); } };
  const verify = async () => { try { await axios.post(`${API}/pro-pack/2fa/verify`, { code }, { headers }); toast.success("2FA is now protecting your sign-in"); setSetup(null); setVerified(true); } catch (e) { toast.error(e.response?.data?.detail || "Invalid code"); } };
  const disable = async () => {
    try {
      await axios.delete(`${API}/pro-pack/2fa`, { headers, data: { password } });
      setSetup(null); setVerified(false); setDisableMode(false); setPassword(""); toast.success("2FA disabled");
    } catch (e) { toast.error(e.response?.data?.detail || "Could not disable 2FA"); }
  };
  return (
    <div className="p-6 space-y-4" data-testid="security-2fa-page">
      <PageHeader title="2FA / TOTP" subtitle="Time-based one-time passcode for technician sign-in" icon={ShieldOff} />
      <Card><CardContent className="pt-6 space-y-4">
        {loading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Checking account protection…</div>}
        {!loading && !setup && !verified && <div className="space-y-3"><p className="text-sm text-muted-foreground">Protect your NexusMSP account with any TOTP authenticator app. Once enrolled, a code is required for every password sign-in.</p><Button onClick={start} data-testid="start-2fa">Set up authenticator app</Button></div>}
        {setup && !verified && (
          <>
            <p className="text-sm">1. Add the entry to your authenticator app (Google Authenticator, 1Password, Authy):</p>
            <code className="block p-3 bg-muted/30 rounded text-xs font-mono break-all">{setup.otpauth_uri}</code>
            <p className="text-sm">2. Or enter manually — secret: <code className="font-mono">{setup.secret}</code></p>
            <p className="text-sm">3. Enter the 6-digit code from your app:</p>
            <div className="flex flex-wrap gap-2"><Input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="w-36 font-mono text-center text-lg tracking-[0.25em]" data-testid="totp-input" /><Button onClick={verify} disabled={code.length !== 6} data-testid="verify-2fa">Verify & enable</Button><Button variant="ghost" onClick={() => setSetup(null)}>Cancel</Button></div>
          </>
        )}
        {!loading && verified && <div className="space-y-3 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-4"><p className="text-sm text-emerald-400 flex items-center gap-2"><CheckCircle className="w-4 h-4" />Authenticator protection is active. A code is required at your next password sign-in.</p>{!disableMode ? <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setDisableMode(true)}>Disable 2FA</Button> : <div className="flex flex-wrap items-end gap-2 border-t border-border/60 pt-3"><div className="space-y-1"><Label className="text-xs">Confirm current password to disable</Label><Input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-64" /></div><Button variant="destructive" disabled={!password} onClick={disable}>Confirm disable</Button><Button variant="ghost" onClick={() => { setDisableMode(false); setPassword(""); }}>Cancel</Button></div>}</div>}
      </CardContent></Card>
    </div>
  );
}

/* ============== SAAS SPEND ============== */
export function SaasSpendPage() {
  const { headers } = useApi();
  const [data, setData] = useState(null);
  useEffect(() => { axios.get(`${API}/pro-pack/saas-spend`, { headers }).then(r => setData(r.data)); }, []); // eslint-disable-line
  if (!data) return <Loader2 className="w-6 h-6 mx-auto my-12 animate-spin" />;
  return (
    <div className="p-6 space-y-4" data-testid="saas-spend-page">
      <PageHeader title="SaaS Spend Tracker" subtitle="Aggregated subscription spend across all clients" icon={Layers} />
      <div className="grid grid-cols-2 gap-3">
        <Card><CardContent className="pt-4"><p className="text-[10px] uppercase">Total Monthly</p><p className="text-3xl font-bold text-cyan-400 font-mono mt-1">${data.grand_monthly.toLocaleString()}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-[10px] uppercase">Total Annual</p><p className="text-3xl font-bold text-emerald-400 font-mono mt-1">${data.grand_annual.toLocaleString()}</p></CardContent></Card>
      </div>
      <Card><CardContent className="p-0"><Table>
        <TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Monthly Total</TableHead><TableHead>Top Vendors</TableHead></TableRow></TableHeader>
        <TableBody>{data.by_client.map(c => (
          <TableRow key={c.client_id}>
            <TableCell className="font-medium">{c.client_name}</TableCell>
            <TableCell className="font-mono">${c.monthly_total.toLocaleString()}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{Object.entries(c.by_vendor).slice(0, 5).map(([v, amt]) => `${v}: $${amt}`).join(" · ")}</TableCell>
          </TableRow>
        ))}</TableBody>
      </Table></CardContent></Card>
    </div>
  );
}

/* ============== DEFENDER HEALTH ============== */
export function DefenderHealthPage() {
  const { headers } = useApi();
  const [data, setData] = useState(null);
  useEffect(() => { axios.get(`${API}/pro-pack/defender-health`, { headers }).then(r => setData(r.data)); }, []); // eslint-disable-line
  if (!data) return <Loader2 className="w-6 h-6 mx-auto my-12 animate-spin" />;
  return (
    <div className="p-6 space-y-4" data-testid="defender-health-page">
      <PageHeader title="Defender / AV Health" subtitle="Endpoint anti-virus posture across all managed devices" icon={Activity} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="pt-4"><p className="text-[10px] uppercase">Total Devices</p><p className="text-3xl font-bold font-mono mt-1">{data.summary.total_devices}</p></CardContent></Card>
        <Card className="border-emerald-500/30"><CardContent className="pt-4"><p className="text-[10px] uppercase text-emerald-300">Healthy</p><p className="text-3xl font-bold text-emerald-400 font-mono mt-1">{data.summary.healthy}</p></CardContent></Card>
        <Card className="border-rose-500/30"><CardContent className="pt-4"><p className="text-[10px] uppercase text-rose-300">Unhealthy</p><p className="text-3xl font-bold text-rose-400 font-mono mt-1">{data.summary.unhealthy}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-[10px] uppercase">Coverage</p><p className="text-3xl font-bold text-cyan-400 font-mono mt-1">{data.summary.coverage_pct}%</p></CardContent></Card>
      </div>
      <Card><CardContent className="p-0"><Table>
        <TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Total</TableHead><TableHead>Healthy</TableHead><TableHead>Unhealthy</TableHead><TableHead>Unknown</TableHead></TableRow></TableHeader>
        <TableBody>{data.by_client.map(c => (
          <TableRow key={c.client_id}>
            <TableCell>{c.client_name}</TableCell>
            <TableCell className="font-mono">{c.total}</TableCell>
            <TableCell className="font-mono text-emerald-400">{c.healthy}</TableCell>
            <TableCell className="font-mono text-rose-400">{c.unhealthy}</TableCell>
            <TableCell className="font-mono text-muted-foreground">{c.unknown}</TableCell>
          </TableRow>
        ))}</TableBody>
      </Table></CardContent></Card>
    </div>
  );
}

/* ============== STOCKTAKE MOBILE ============== */
export function StocktakeMobilePage() {
  const { headers } = useApi();
  const [sessionId, setSessionId] = useState(`session-${new Date().toISOString().slice(0, 10)}`);
  const [sku, setSku] = useState("");
  const [qty, setQty] = useState(1);
  const [data, setData] = useState({ scans: [], total_diff: 0 });
  const refresh = () => axios.get(`${API}/pro-pack/stocktake/session/${sessionId}`, { headers }).then(r => setData(r.data));
  useEffect(() => { refresh(); }, [sessionId]); // eslint-disable-line
  const scan = async () => {
    try { await axios.post(`${API}/pro-pack/stocktake/scan`, { sku_or_barcode: sku, qty_counted: qty, session_id: sessionId }, { headers }); toast.success(`Counted ${sku}: ${qty}`); setSku(""); setQty(1); refresh(); } catch (e) { toast.error(e.response?.data?.detail || "Scan failed"); }
  };
  const commit = async () => { if (!window.confirm(`Apply ${data.scans.length} stock adjustments?`)) return; await axios.post(`${API}/pro-pack/stocktake/session/${sessionId}/commit`, {}, { headers }); toast.success("Committed"); refresh(); };
  return (
    <div className="p-6 space-y-4 max-w-2xl mx-auto" data-testid="stocktake-mobile-page">
      <PageHeader title="Stocktake (Mobile)" subtitle="Scan barcode → enter count → commit at end" icon={ScanLine} />
      <Card><CardContent className="pt-4 space-y-3">
        <div><Label className="text-xs">Session</Label><Input value={sessionId} onChange={e => setSessionId(e.target.value)} className="font-mono text-xs" /></div>
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2"><Label className="text-xs">SKU / Barcode</Label><Input value={sku} onChange={e => setSku(e.target.value)} placeholder="Scan or type" autoFocus data-testid="scan-sku" /></div>
          <div><Label className="text-xs">Qty</Label><Input type="number" value={qty} onChange={e => setQty(parseInt(e.target.value) || 1)} data-testid="scan-qty" /></div>
        </div>
        <Button onClick={scan} className="w-full" disabled={!sku} data-testid="scan-submit"><ScanLine className="w-4 h-4 mr-1" />Record Count</Button>
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-sm flex items-center justify-between">Session Scans · <Badge variant="outline">{data.scans?.length || 0} items · diff {data.total_diff}</Badge></CardTitle></CardHeader>
        <CardContent className="p-0"><Table>
          <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Expected</TableHead><TableHead>Counted</TableHead><TableHead>Diff</TableHead></TableRow></TableHeader>
          <TableBody>{(data.scans || []).map(s => (
            <TableRow key={s.id}><TableCell>{s.product_name}</TableCell><TableCell className="font-mono">{s.expected}</TableCell><TableCell className="font-mono">{s.counted}</TableCell><TableCell className={`font-mono ${s.diff < 0 ? "text-rose-400" : s.diff > 0 ? "text-emerald-400" : ""}`}>{s.diff > 0 ? "+" : ""}{s.diff}</TableCell></TableRow>
          ))}</TableBody>
        </Table></CardContent></Card>
      <Button onClick={commit} disabled={!data.scans?.length} className="w-full" data-testid="commit-stocktake"><CheckCircle className="w-4 h-4 mr-1" />Commit & Adjust Stock</Button>
    </div>
  );
}

/* ============== CRM PIPELINE ============== */
export function CrmPipelinePage() {
  const { headers } = useApi();
  const [data, setData] = useState(null);
  const fetch = () => axios.get(`${API}/pro-pack/crm/pipeline`, { headers }).then(r => setData(r.data));
  useEffect(() => { fetch(); }, []); // eslint-disable-line
  const move = async (id, stage) => {
    try {
      await axios.post(`${API}/pro-pack/crm/leads/${id}/move-stage`, { stage }, { headers });
      toast.success(`Lead moved to ${stage}`);
      fetch();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not move the lead");
    }
  };
  if (!data) return <Loader2 className="w-6 h-6 mx-auto my-12 animate-spin" />;
  return (
    <div className="p-6 space-y-4" data-testid="crm-pipeline-page">
      <PageHeader title="CRM Pipeline" subtitle={`Open pipeline value: $${data.total_pipeline_value.toLocaleString()}`} icon={MapPin} />
      <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
        {data.buckets.map(b => (
          <Card key={b.stage} className={b.stage === "won" ? "border-emerald-500/30" : b.stage === "lost" ? "border-rose-500/30" : ""}>
            <CardHeader className="pb-2"><CardTitle className="text-xs uppercase capitalize">{b.stage}<Badge variant="outline" className="ml-2 text-[9px]">{b.count}</Badge></CardTitle></CardHeader>
            <CardContent className="space-y-2 px-2 pb-3">
              <p className="text-[11px] text-muted-foreground font-mono">${b.value.toLocaleString()}</p>
              {b.leads.map(L => (
                <div key={L.id} className="text-xs p-2 rounded border bg-muted/30">
                  <p className="font-medium truncate">{L.name}</p>
                  <p className="text-[10px] text-muted-foreground">${(L.value || 0).toLocaleString()}</p>
                  <Select onValueChange={s => move(L.id, s)}><SelectTrigger className="h-6 text-[10px] mt-1"><SelectValue placeholder="Move" /></SelectTrigger><SelectContent>{data.stages.filter(s => s !== L.stage).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ============== DR PLANS ============== */
export function DRPlansPage() {
  const { headers } = useApi();
  const [items, setItems] = useState([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ client_id: "", name: "", rto_hours: 4, rpo_hours: 1, primary_contact: "", after_hours_contact: "" });
  const fetch = () => axios.get(`${API}/pro-pack/dr-plans`, { headers }).then(r => setItems(r.data));
  useEffect(() => { fetch(); }, []); // eslint-disable-line
  const save = async () => { try { await axios.post(`${API}/pro-pack/dr-plans`, form, { headers }); toast.success("DR plan created"); setShow(false); fetch(); } catch { toast.error("Create failed"); } };
  return (
    <div className="p-6 space-y-4" data-testid="dr-plans-page">
      <PageHeader title="Disaster Recovery Plans" subtitle="Per-client RTO/RPO + ransomware/outage scenarios" icon={ShieldOff}>
        <Button size="sm" onClick={() => setShow(true)}><Plus className="w-3.5 h-3.5 mr-1" />New Plan</Button>
      </PageHeader>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{items.map(p => (
        <Card key={p.id}><CardHeader><CardTitle className="text-sm">{p.name}</CardTitle></CardHeader><CardContent className="text-xs space-y-1">
          <p><span className="text-muted-foreground">RTO:</span> {p.rto_hours}h · <span className="text-muted-foreground">RPO:</span> {p.rpo_hours}h</p>
          <p><span className="text-muted-foreground">Primary:</span> {p.primary_contact || "—"}</p>
          <p><span className="text-muted-foreground">After hours:</span> {p.after_hours_contact || "—"}</p>
          <p><span className="text-muted-foreground">Next test:</span> {p.next_test_due}</p>
          <p className="font-medium mt-2">Scenarios: {(p.scenarios || []).map(s => s.name).join(", ")}</p>
        </CardContent></Card>
      ))}</div>
      <Dialog open={show} onOpenChange={setShow}><DialogContent>
        <DialogHeader><DialogTitle>New DR Plan</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Plan Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3"><div><Label>RTO (hours)</Label><Input type="number" step="0.5" value={form.rto_hours} onChange={e => setForm({ ...form, rto_hours: parseFloat(e.target.value) })} /></div><div><Label>RPO (hours)</Label><Input type="number" step="0.5" value={form.rpo_hours} onChange={e => setForm({ ...form, rpo_hours: parseFloat(e.target.value) })} /></div></div>
          <div><Label>Primary Contact</Label><Input value={form.primary_contact} onChange={e => setForm({ ...form, primary_contact: e.target.value })} /></div>
          <div><Label>After-Hours Contact</Label><Input value={form.after_hours_contact} onChange={e => setForm({ ...form, after_hours_contact: e.target.value })} /></div>
        </div>
        <DialogFooter><Button variant="ghost" onClick={() => setShow(false)}>Cancel</Button><Button onClick={save}>Create</Button></DialogFooter>
      </DialogContent></Dialog>
    </div>
  );
}

/* ============== ASSET PRINT BATCH (placeholder simple list) ============== */
export function AssetPrintBatchPage() {
  return (
    <div className="p-6" data-testid="asset-print-batch-page">
      <PageHeader title="Asset Tag Batch Print" subtitle="Select multiple assets and print their QR labels in one PDF" icon={ScanLine} />
      <Card><CardContent className="pt-6 text-sm text-muted-foreground">Use the QR Asset Tags page to print individual labels. Bulk batch printing pulls from your asset selection — wired into POST <code className="font-mono">/api/pro-pack/assets/print-batch</code>.</CardContent></Card>
    </div>
  );
}

/* ============== AUTOMATION HUB ============== */
export function AutomationHubPage() {
  const { headers } = useApi();
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState(null);
  const [refreshing, setRefreshing] = useState(true);
  const refresh = async () => {
    setRefreshing(true);
    try {
      const [runbooks, scripts, workflows, workflowStats, alertStats] = await Promise.all([
        axios.get(`${API}/runbooks`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/scripts`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/workflows`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/workflows/stats/overview`, { headers }).catch(() => ({ data: {} })),
        axios.get(`${API}/alert-rules/stats`, { headers }).catch(() => ({ data: {} })),
      ]);
      setSnapshot({
        runbooks: (runbooks.data || []).filter(item => item.enabled !== false).length,
        scripts: (scripts.data || []).length,
        workflows: (workflows.data || []).filter(item => item.enabled !== false).length,
        simulations: workflowStats.data?.simulations || 0,
        approvals: workflowStats.data?.pending_approvals || 0,
        alertRules: alertStats.data?.active || 0,
      });
    } catch {
      toast.error("Automation status could not be refreshed");
    } finally {
      setRefreshing(false);
    }
  };
  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const tiles = [
    { path: "/runbooks", label: "Runbooks", icon: Workflow, desc: "Step-by-step automated playbooks", count: snapshot?.runbooks, countLabel: "enabled" },
    { path: "/scripting", label: "Scripts Library", icon: Zap, desc: "PowerShell / Bash script repo", count: snapshot?.scripts, countLabel: "available" },
    { path: "/git-scripts", label: "Git Scripts Sync", icon: Workflow, desc: "Pull scripts from Git repos" },
    { path: "/workflow-automation", label: "Automation Studio", icon: Workflow, desc: "No-code and JSON orchestration with safe simulation", count: snapshot?.workflows, countLabel: "active" },
    { path: "/workflow-automation?tab=marketplace", label: "Automation Marketplace", icon: Layers, desc: "Verified onboarding, security, compliance, and recovery packs" },
    { path: "/workflow-automation?tab=simulations", label: "Simulation History", icon: Sparkles, desc: "Before/after, risk, rollback, and approval evidence", count: snapshot?.simulations, countLabel: "recorded" },
    { path: "/change-management", label: "Change Governance", icon: GitMerge, desc: "Independent approval and implementation audit", count: snapshot?.approvals, countLabel: "awaiting review" },
    { path: "/alert-rules", label: "Alert Rules Engine", icon: BellRing, desc: "Alert routing & suppression rules", count: snapshot?.alertRules, countLabel: "enabled" },
  ];
  return (
    <div className="space-y-6" data-testid="automation-hub-page">
      <OperationalPageHeader
        eyebrow="Automation workspace · orchestration and governance"
        title="Automation"
        description="Build governed workflows, install verified packs, run scripts and runbooks, and preview every material change before approval."
        icon={Workflow}
        tone="violet"
        actions={<><Button variant="outline" size="sm" onClick={refresh} disabled={refreshing} data-testid="automation-hub-refresh"><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />Refresh status</Button><Button size="sm" onClick={() => navigate("/workflow-automation")}><Sparkles className="mr-1.5 h-4 w-4" />Open Studio</Button></>}
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <HeroTile label="Enabled runbooks" value={snapshot?.runbooks ?? "—"} icon={Workflow} glow="violet" animated={false} onClick={() => navigate("/runbooks")} testId="automation-hub-runbooks" />
        <HeroTile label="Scripts" value={snapshot?.scripts ?? "—"} icon={Zap} glow="amber" animated={false} onClick={() => navigate("/scripting")} testId="automation-hub-scripts" />
        <HeroTile label="Simulations" value={snapshot?.simulations ?? "—"} icon={Sparkles} glow="sky" animated={false} subtitle="Zero-change previews" onClick={() => navigate("/workflow-automation?tab=simulations")} testId="automation-hub-workflows" />
        <HeroTile label="Awaiting approval" value={snapshot?.approvals ?? "—"} icon={GitMerge} glow={(snapshot?.approvals || 0) ? "rose" : "emerald"} animated={false} subtitle="Change review queue" onClick={() => navigate("/change-management")} testId="automation-hub-alert-rules" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">{tiles.map(t => (
        <Card
          key={t.path}
          role="button"
          tabIndex={0}
          aria-label={`${t.label}: ${t.desc}`}
          className="cursor-pointer border-border/80 transition-all hover:-translate-y-0.5 hover:border-violet-500/40 hover:shadow-lg hover:shadow-violet-500/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60"
          onClick={() => navigate(t.path)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              navigate(t.path);
            }
          }}
        >
          <CardContent className="pt-5 pb-4">
            <div className="mb-2 flex items-start justify-between"><t.icon className="w-7 h-7 text-violet-400" />{typeof t.count === "number" && <Badge variant="outline" className="text-[10px] border-violet-500/30 text-violet-300">{t.count} {t.countLabel}</Badge>}</div>
            <p className="font-semibold flex items-center gap-1.5">{t.label}<ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /></p>
            <p className="text-xs text-muted-foreground mt-1">{t.desc}</p>
          </CardContent>
        </Card>
      ))}</div>
    </div>
  );
}

/* ============== DOCUMENTATION HUB ============== */
export function DocumentationHubPage() {
  const tiles = [
    { path: "/knowledge-base", label: "Knowledge Base", icon: BookOpen, desc: "Public KB articles" },
    { path: "/documentation", label: "IT Docs", icon: BookOpen, desc: "Internal IT documentation per client" },
    { path: "/auto-documentation", label: "Auto-Docs", icon: BookOpen, desc: "Auto-generated from devices" },
    { path: "/help", label: "Help Center", icon: BookOpen, desc: "User-facing help" },
    { path: "/capacity-planner", label: "Capacity Planner", icon: BarChart3, desc: "Capacity forecast" },
  ];
  return (
    <div className="p-6 space-y-4" data-testid="documentation-hub-page">
      <PageHeader title="Knowledge & Documentation Hub" subtitle="All your docs in one place" icon={BookOpen} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">{tiles.map(t => (
        <Card key={t.path} className="cursor-pointer hover:border-violet-500/40" onClick={() => window.location.href = t.path}>
          <CardContent className="pt-5 pb-4"><t.icon className="w-7 h-7 mb-2 text-cyan-400" /><p className="font-semibold">{t.label}</p><p className="text-xs text-muted-foreground mt-1">{t.desc}</p></CardContent>
        </Card>
      ))}</div>
    </div>
  );
}

/* ============== FINANCIAL ANALYTICS HUB ============== */
export function FinancialAnalyticsHubPage() {
  const tiles = [
    { path: "/financial-reports", label: "Financial Reports" },
    { path: "/revenue-forecast", label: "Revenue Forecast" },
    { path: "/rpe-dashboard", label: "Revenue / Endpoint" },
    { path: "/contract-profit", label: "Contract Profit" },
    { path: "/profitability-heatmap", label: "Profitability Map" },
    { path: "/cost-per-ticket", label: "Cost / Ticket" },
    { path: "/saas-spend", label: "SaaS Spend" },
  ];
  return (
    <div className="p-6 space-y-4" data-testid="financial-analytics-hub-page">
      <PageHeader title="Financial Analytics" subtitle="Reports · Forecasts · Profitability · Cost" icon={BarChart3} />
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">{tiles.map(t => (
        <Card key={t.path} className="cursor-pointer hover:border-emerald-500/40" onClick={() => window.location.href = t.path}>
          <CardContent className="pt-5 pb-4"><p className="font-semibold">{t.label}</p></CardContent>
        </Card>
      ))}</div>
    </div>
  );
}

/* ============== PHONE INTEGRATION SETTINGS ============== */
export function PhoneIntegrationPage() {
  const { headers } = useApi();
  const [hookUrl] = useState(`${API}/pro-pack/phone/inbound`);
  const test = async () => { try { const r = await axios.post(`${API}/pro-pack/phone/inbound`, { caller_number: "+61400000000", caller_name: "Test Caller" }, { headers }); toast.success(`Test ticket: ${r.data.ticket_number}`); } catch { toast.error("Test failed"); } };
  return (
    <div className="p-6 space-y-4" data-testid="phone-integration-page">
      <PageHeader title="Phone System Integration" subtitle="3CX / RingCentral / Twilio inbound webhook" icon={Phone} />
      <Card><CardContent className="pt-6 space-y-3">
        <div><Label className="text-xs">Inbound webhook URL — POST this from your PBX:</Label>
          <code className="block p-2 bg-muted/30 rounded text-xs font-mono break-all">{hookUrl}</code>
        </div>
        <p className="text-xs text-muted-foreground">Body: <code className="font-mono">{`{caller_number, caller_name, callee_number}`}</code> — creates a draft ticket auto-linked to the caller's client.</p>
        <Button onClick={test} data-testid="test-phone-hook">Send Test Call</Button>
      </CardContent></Card>
    </div>
  );
}
