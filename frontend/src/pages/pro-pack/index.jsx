// All Pro-Pack pages in one shared module to keep imports light.
// Each export is a default page used via lazy() in routes.js.
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Inbox, Loader2, Plus, Trash2, AlertTriangle, CheckCircle, Save, Webhook, Send,
  Heart, Calendar, ShoppingCart, Phone, KeySquare, Briefcase, BookOpen,
  ShieldOff, ScanLine, BarChart3, BellRing, FileSpreadsheet, Activity, MapPin,
  Sparkles, RefreshCw, GitMerge, Workflow, Layers, Zap
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
export function TriageQueuePage() {
  const { headers } = useApi();
  const [data, setData] = useState(null);
  const fetch = () => axios.get(`${API}/pro-pack/triage-queue`, { headers }).then(r => setData(r.data));
  useEffect(() => { fetch(); const i = setInterval(fetch, 30000); return () => clearInterval(i); }, []); // eslint-disable-line
  if (!data) return <Loader2 className="w-6 h-6 mx-auto my-12 animate-spin" />;
  return (
    <div className="p-6 space-y-4" data-testid="triage-queue-page">
      <PageHeader title="Triage Queue" subtitle={`${data.count} unassigned · oldest ${Math.floor(data.oldest_age_minutes / 60)}h ${data.oldest_age_minutes % 60}m`} icon={Inbox}>
        <Button variant="outline" size="sm" onClick={fetch}><RefreshCw className="w-3.5 h-3.5 mr-1" />Refresh</Button>
      </PageHeader>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.entries(data.by_priority).map(([k, v]) => (
          <Card key={k} className={k === "critical" ? "border-rose-500/30 bg-rose-500/[0.04]" : k === "high" ? "border-amber-500/30 bg-amber-500/[0.04]" : ""}>
            <CardContent className="pt-4 pb-3">
              <p className="text-[10px] uppercase text-muted-foreground">{k}</p>
              <p className="text-3xl font-bold mt-1 font-mono">{v}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card><CardContent className="p-0"><Table>
        <TableHeader><TableRow><TableHead>Ticket</TableHead><TableHead>Title</TableHead><TableHead>Client</TableHead><TableHead>Priority</TableHead><TableHead>Source</TableHead><TableHead>Age</TableHead></TableRow></TableHeader>
        <TableBody>{data.items.map(t => (
          <TableRow key={t.id} className="cursor-pointer hover:bg-muted/40" onClick={() => window.location.href = `/tickets?id=${t.id}`}>
            <TableCell className="font-mono text-xs">{t.ticket_number}</TableCell>
            <TableCell>{t.title}</TableCell>
            <TableCell>{t.client_name}</TableCell>
            <TableCell><Badge className={`text-[10px] capitalize ${t.priority === "critical" ? "bg-rose-500/20 text-rose-300" : t.priority === "high" ? "bg-amber-500/20 text-amber-300" : ""}`}>{t.priority}</Badge></TableCell>
            <TableCell><Badge variant="outline" className="text-[10px]">{t.source || "manual"}</Badge></TableCell>
            <TableCell className="text-xs">{t.created_at?.slice(0, 16).replace("T", " ")}</TableCell>
          </TableRow>
        ))}</TableBody>
      </Table></CardContent></Card>
    </div>
  );
}

/* ============== SERVICE CATALOG ============== */
export function ServiceCatalogPage() {
  const { headers } = useApi();
  const [items, setItems] = useState([]);
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", code: "", category: "managed_services", default_priority: "medium", sla_response_hours: 4, sla_resolve_hours: 24, billing_unit_price: 0, billing_unit: "each", is_active: true });
  const fetch = () => axios.get(`${API}/pro-pack/service-catalog`, { headers }).then(r => setItems(r.data));
  useEffect(() => { fetch(); }, []); // eslint-disable-line
  const save = async () => {
    try {
      if (editing) await axios.put(`${API}/pro-pack/service-catalog/${editing.id}`, form, { headers });
      else await axios.post(`${API}/pro-pack/service-catalog`, form, { headers });
      toast.success("Saved"); setShow(false); setEditing(null); fetch();
    } catch { toast.error("Save failed"); }
  };
  const del = async (id) => {
    if (!window.confirm("Delete this service?")) return;
    await axios.delete(`${API}/pro-pack/service-catalog/${id}`, { headers });
    fetch();
  };
  return (
    <div className="p-6 space-y-4" data-testid="service-catalog-page">
      <PageHeader title="Service Catalog" subtitle="Define services that auto-attach SLA and billing to tickets" icon={Briefcase}>
        <Button size="sm" onClick={() => { setEditing(null); setForm({ name: "", code: "", category: "managed_services", default_priority: "medium", sla_response_hours: 4, sla_resolve_hours: 24, billing_unit_price: 0, billing_unit: "each", is_active: true }); setShow(true); }} data-testid="new-service-btn"><Plus className="w-3.5 h-3.5 mr-1" />New Service</Button>
      </PageHeader>
      <Card><CardContent className="p-0"><Table>
        <TableHeader><TableRow><TableHead>Service</TableHead><TableHead>Code</TableHead><TableHead>Category</TableHead><TableHead>SLA Response</TableHead><TableHead>SLA Resolve</TableHead><TableHead className="text-right">Price</TableHead><TableHead></TableHead></TableRow></TableHeader>
        <TableBody>{items.map(s => (
          <TableRow key={s.id}>
            <TableCell className="font-medium">{s.name}</TableCell>
            <TableCell className="font-mono text-xs">{s.code}</TableCell>
            <TableCell><Badge variant="outline" className="text-[10px] capitalize">{s.category?.replace("_", " ")}</Badge></TableCell>
            <TableCell className="text-xs">{s.sla_response_hours}h</TableCell>
            <TableCell className="text-xs">{s.sla_resolve_hours}h</TableCell>
            <TableCell className="text-right font-mono">${s.billing_unit_price?.toFixed(2)}/{s.billing_unit}</TableCell>
            <TableCell className="text-right">
              <Button size="sm" variant="ghost" onClick={() => { setEditing(s); setForm(s); setShow(true); }}><Save className="w-3 h-3" /></Button>
              <Button size="sm" variant="ghost" onClick={() => del(s.id)}><Trash2 className="w-3 h-3 text-rose-400" /></Button>
            </TableCell>
          </TableRow>
        ))}</TableBody>
      </Table>{items.length === 0 && <p className="py-12 text-center text-muted-foreground text-sm">No services yet — click "New Service" to add the first one.</p>}</CardContent></Card>
      <Dialog open={show} onOpenChange={setShow}><DialogContent>
        <DialogHeader><DialogTitle>{editing ? "Edit" : "New"} Service</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3"><div><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div><div><Label>Code</Label><Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} /></div></div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Category</Label><Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="managed_services">Managed Services</SelectItem><SelectItem value="security">Security</SelectItem><SelectItem value="backup">Backup</SelectItem><SelectItem value="consulting">Consulting</SelectItem><SelectItem value="project">Project</SelectItem></SelectContent></Select></div>
            <div><Label>Default Priority</Label><Select value={form.default_priority} onValueChange={v => setForm({ ...form, default_priority: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="critical">Critical</SelectItem></SelectContent></Select></div>
            <div><Label>Unit</Label><Select value={form.billing_unit} onValueChange={v => setForm({ ...form, billing_unit: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="each">Each</SelectItem><SelectItem value="hour">Hour</SelectItem><SelectItem value="month">Month</SelectItem><SelectItem value="user">User</SelectItem></SelectContent></Select></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>SLA Response (h)</Label><Input type="number" step="0.5" value={form.sla_response_hours} onChange={e => setForm({ ...form, sla_response_hours: parseFloat(e.target.value) })} /></div>
            <div><Label>SLA Resolve (h)</Label><Input type="number" step="0.5" value={form.sla_resolve_hours} onChange={e => setForm({ ...form, sla_resolve_hours: parseFloat(e.target.value) })} /></div>
            <div><Label>Unit Price</Label><Input type="number" step="0.01" value={form.billing_unit_price} onChange={e => setForm({ ...form, billing_unit_price: parseFloat(e.target.value) })} /></div>
          </div>
          <div><Label>Description</Label><Textarea rows={2} value={form.description || ""} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
        </div>
        <DialogFooter><Button variant="ghost" onClick={() => setShow(false)}>Cancel</Button><Button onClick={save} data-testid="save-service-btn">Save</Button></DialogFooter>
      </DialogContent></Dialog>
    </div>
  );
}

/* ============== CUSTOMER HEALTH ============== */
export function CustomerHealthPage() {
  const { headers } = useApi();
  const [items, setItems] = useState([]);
  useEffect(() => { axios.get(`${API}/pro-pack/customer-health`, { headers }).then(r => setItems(r.data)); }, []); // eslint-disable-line
  return (
    <div className="p-6 space-y-4" data-testid="customer-health-page">
      <PageHeader title="Customer Health" subtitle="Composite score: open tickets, criticals, overdue invoices, CSAT" icon={Heart} />
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
          <Card key={s.key} className="cursor-pointer hover:border-violet-500/40 transition" onClick={() => window.location.href = s.link}>
            <CardContent className="pt-4 pb-3">
              <div className="text-3xl mb-1">{s.icon}</div>
              <p className={`text-xs font-medium uppercase tracking-wider ${s.color}`}>{s.label}</p>
              <p className="text-2xl font-bold font-mono mt-1">{fmt(s.value)}</p>
              <p className="text-[11px] text-muted-foreground">{s.count} item{s.count !== 1 && "s"}{s.suffix || ""}</p>
            </CardContent>
          </Card>
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
  const [data, setData] = useState(null);
  useEffect(() => { axios.get(`${API}/pro-pack/patch-tuesday?months=12`, { headers }).then(r => setData(r.data)); }, []); // eslint-disable-line
  if (!data) return <Loader2 className="w-6 h-6 mx-auto my-12 animate-spin" />;
  return (
    <div className="p-6 space-y-4" data-testid="patch-tuesday-page">
      <PageHeader title="Patch Tuesday Calendar" subtitle="2nd Tuesday each month — Microsoft's monthly security release" icon={Calendar} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {data.events.map(e => (
          <Card key={e.date} className={e.is_past ? "opacity-50" : e.days_until <= 7 ? "border-amber-500/40 bg-amber-500/[0.04]" : e.days_until <= 0 ? "border-rose-500/40" : ""}>
            <CardContent className="pt-4 pb-3">
              <p className="text-[10px] uppercase text-muted-foreground">{e.month}</p>
              <p className="text-3xl font-bold font-mono mt-1">{new Date(e.date).getDate()}</p>
              <p className="text-xs mt-1">{e.is_past ? "Past" : e.days_until === 0 ? "Today!" : `In ${e.days_until} days`}</p>
            </CardContent>
          </Card>
        ))}
      </div>
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
  const fetch = () => axios.get(`${API}/pro-pack/api-tokens`, { headers }).then(r => setItems(r.data));
  useEffect(() => { fetch(); }, []); // eslint-disable-line
  const save = async () => { try { const r = await axios.post(`${API}/pro-pack/api-tokens`, form, { headers }); setCreated(r.data); fetch(); setShow(false); } catch { toast.error("Create failed"); } };
  const revoke = async (id) => { if (!window.confirm("Revoke this token?")) return; await axios.delete(`${API}/pro-pack/api-tokens/${id}`, { headers }); fetch(); };
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
            <TableCell className="text-right">{t.is_active !== false && <Button size="sm" variant="ghost" onClick={() => revoke(t.id)}><Trash2 className="w-3 h-3 text-rose-400" /></Button>}</TableCell>
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
    </div>
  );
}

/* ============== 2FA ============== */
export function Security2FAPage() {
  const { headers } = useApi();
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState("");
  const [verified, setVerified] = useState(false);
  const start = async () => { try { const r = await axios.post(`${API}/pro-pack/2fa/setup`, {}, { headers }); setSetup(r.data); } catch { toast.error("Setup failed"); } };
  const verify = async () => { try { await axios.post(`${API}/pro-pack/2fa/verify`, { code }, { headers }); toast.success("2FA verified & enabled"); setVerified(true); } catch (e) { toast.error(e.response?.data?.detail || "Invalid code"); } };
  const disable = async () => { if (!window.confirm("Disable 2FA?")) return; await axios.delete(`${API}/pro-pack/2fa`, { headers }); setSetup(null); setVerified(false); toast.success("Disabled"); };
  return (
    <div className="p-6 space-y-4" data-testid="security-2fa-page">
      <PageHeader title="2FA / TOTP" subtitle="Time-based one-time passcode for technician sign-in" icon={ShieldOff} />
      <Card><CardContent className="pt-6 space-y-4">
        {!setup && !verified && <Button onClick={start} data-testid="start-2fa">Start 2FA Setup</Button>}
        {setup && !verified && (
          <>
            <p className="text-sm">1. Add the entry to your authenticator app (Google Authenticator, 1Password, Authy):</p>
            <code className="block p-3 bg-muted/30 rounded text-xs font-mono break-all">{setup.otpauth_uri}</code>
            <p className="text-sm">2. Or enter manually — secret: <code className="font-mono">{setup.secret}</code></p>
            <p className="text-sm">3. Enter the 6-digit code from your app:</p>
            <div className="flex gap-2"><Input value={code} onChange={e => setCode(e.target.value)} maxLength={6} className="w-32 font-mono text-center text-lg" data-testid="totp-input" /><Button onClick={verify} data-testid="verify-2fa">Verify</Button></div>
          </>
        )}
        {verified && <><p className="text-sm text-emerald-400 flex items-center gap-2"><CheckCircle className="w-4 h-4" />2FA is enabled on your account.</p><Button variant="outline" onClick={disable}>Disable 2FA</Button></>}
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
  const move = async (id, stage) => { await axios.post(`${API}/pro-pack/crm/leads/${id}/move-stage`, { stage }, { headers }); fetch(); };
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

/* ============== CYBER INSURANCE EXPORT (per client) ============== */
export function CyberInsurancePage() {
  const { headers } = useApi();
  const [clients, setClients] = useState([]);
  const [cid, setCid] = useState("");
  const [data, setData] = useState(null);
  useEffect(() => { axios.get(`${API}/clients`, { headers }).then(r => setClients(r.data)); }, []); // eslint-disable-line
  const load = async (id) => { setCid(id); const r = await axios.get(`${API}/pro-pack/cyber-insurance-export/${id}`, { headers }); setData(r.data); };
  return (
    <div className="p-6 space-y-4" data-testid="cyber-insurance-page">
      <PageHeader title="Cyber Insurance Compliance Export" subtitle="One-click control posture export for insurers" icon={FileSpreadsheet} />
      <Select value={cid} onValueChange={load}><SelectTrigger className="w-[400px]"><SelectValue placeholder="Select client to export" /></SelectTrigger><SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select>
      {data && <Card><CardHeader><CardTitle className="text-sm">{data.client_name} — Control Posture</CardTitle></CardHeader><CardContent>
        <Table><TableBody>
          {Object.entries(data.controls).map(([k, v]) => (
            <TableRow key={k}><TableCell className="capitalize text-xs">{k.replace(/_/g, " ")}</TableCell><TableCell className="font-mono text-sm">{typeof v === "boolean" ? (v ? "✓ Yes" : "✗ No") : String(v)}</TableCell></TableRow>
          ))}
        </TableBody></Table>
        <p className="text-[11px] text-muted-foreground mt-3">As of {new Date(data.as_of).toLocaleString()}. Submit this snapshot to your cyber-insurance broker.</p>
      </CardContent></Card>}
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
  const tiles = [
    { path: "/runbooks", label: "Runbooks", icon: Workflow, desc: "Step-by-step automated playbooks" },
    { path: "/scripting", label: "Scripts Library", icon: Zap, desc: "PowerShell / Bash script repo" },
    { path: "/git-scripts", label: "Git Scripts Sync", icon: Workflow, desc: "Pull scripts from Git repos" },
    { path: "/workflow-automation", label: "Workflow Builder", icon: Workflow, desc: "Visual workflow editor" },
    { path: "/alert-rules", label: "Alert Rules Engine", icon: BellRing, desc: "Alert routing & suppression rules" },
  ];
  return (
    <div className="p-6 space-y-4" data-testid="automation-hub-page">
      <PageHeader title="Automation Hub" subtitle="Runbooks · Scripts · Workflows · Alert routing" icon={Workflow} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">{tiles.map(t => (
        <Card key={t.path} className="cursor-pointer hover:border-violet-500/40" onClick={() => window.location.href = t.path}>
          <CardContent className="pt-5 pb-4">
            <t.icon className="w-7 h-7 mb-2 text-violet-400" />
            <p className="font-semibold">{t.label}</p>
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
    { path: "/roi-reports", label: "ROI Reports" },
    { path: "/revenue-tracker", label: "Revenue Tracker" },
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

/* ============== SLA HUB ============== */
export function SlaHubPage() {
  return (
    <div className="p-6 space-y-4" data-testid="sla-hub-page">
      <PageHeader title="SLA Hub" subtitle="Live timers + scheduled reports — one stop" icon={Activity} />
      <Tabs defaultValue="timers"><TabsList><TabsTrigger value="timers">Live Timers</TabsTrigger><TabsTrigger value="reports">Reports</TabsTrigger></TabsList>
        <TabsContent value="timers" className="mt-4"><Card><CardContent className="pt-6"><Button onClick={() => window.location.href = "/sla-timer"}>Open SLA Timer →</Button></CardContent></Card></TabsContent>
        <TabsContent value="reports" className="mt-4"><Card><CardContent className="pt-6"><Button onClick={() => window.location.href = "/sla-report-gen"}>Open SLA Reports →</Button></CardContent></Card></TabsContent>
      </Tabs>
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
