import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";
import { toast } from "sonner";
import {
  Activity, AlertTriangle, CheckCircle2, Cloud, FileCheck2, KeyRound,
  Layers, ListChecks, Lock, Plus, RefreshCw, Search, ShieldCheck,
  Sparkles, Users, XCircle,
} from "lucide-react";

const severityClasses = {
  critical: "border-rose-500/30 bg-rose-500/10 text-rose-200",
  high: "border-rose-500/30 bg-rose-500/10 text-rose-200",
  medium: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  low: "border-cyan-500/30 bg-cyan-500/10 text-cyan-100",
};

const connectionCopy = {
  not_configured: "Connection not configured",
  incomplete: "Connection details incomplete",
  configured_unverified: "Credentials saved - verification pending",
};

function statusLabel(mode) {
  return connectionCopy[mode] || "Verification pending";
}

function valueOrDash(loading, summary, value, suffix = "") {
  if (loading || !summary?.telemetry_available || value === null || value === undefined) return "-";
  return `${value}${suffix}`;
}

function EmptyEvidence({ title = "No verified Microsoft 365 evidence yet", description, action }) {
  return (
    <Card className="border-amber-500/30 bg-amber-500/[0.04]">
      <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
          <div>
            <p className="text-sm font-semibold text-amber-50">{title}</p>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">{description || "NexusMSP does not create demo tenants, posture scores, alert counts, or compliance results. Connect and verify Microsoft Graph before using this workspace for operational decisions."}</p>
          </div>
        </div>
        {action}
      </CardContent>
    </Card>
  );
}

export default function M365CommandCenter() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [tab, setTab] = useState("overview");
  const [summary, setSummary] = useState(null);
  const [connection, setConnection] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryResponse, connectionResponse] = await Promise.all([
        axios.get(`${API}/m365/tenants/health/summary`, { headers }),
        axios.get(`${API}/m365/connection`, { headers }),
      ]);
      setSummary(summaryResponse.data);
      setConnection(connectionResponse.data);
    } catch (error) {
      toast.error("Microsoft 365 workspace could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  const hasEvidence = Boolean(summary?.telemetry_available);
  return (
    <div className="space-y-5 p-6" data-testid="m365-page">
      <OperationalPageHeader
        eyebrow="Microsoft cloud operations"
        title="Microsoft 365"
        description="Provider-backed Microsoft 365 evidence, guardrail planning, and connection readiness in one auditable workspace."
        icon={Cloud}
        tone="sky"
        actions={<>
          <Badge variant="outline" className={hasEvidence ? "border-emerald-500/35 text-emerald-200" : "border-amber-500/35 text-amber-200"}>
            {hasEvidence ? "Verified telemetry" : statusLabel(connection?.mode)}
          </Badge>
          <Button size="sm" variant="outline" onClick={() => setTab("connection")}><Lock className="mr-1.5 h-3.5 w-3.5" />Connection</Button>
          <Button size="sm" variant="outline" onClick={load} disabled={loading} data-testid="m365-refresh"><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
        </>}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
        <HeroTile label="Tenants" value={valueOrDash(loading, summary, summary?.tenants)} icon={Cloud} glow="cyan" subtitle="Verified Graph inventory" />
        <HeroTile label="Users" value={valueOrDash(loading, summary, summary?.users)} icon={Users} glow="violet" subtitle="Provider-recorded identities" />
        <HeroTile label="MFA coverage" value={valueOrDash(loading, summary, summary?.avg_mfa_pct, "%")} icon={KeyRound} glow="emerald" subtitle="Verified evidence only" />
        <HeroTile label="Secure score" value={valueOrDash(loading, summary, summary?.avg_secure_score)} icon={ShieldCheck} glow="sky" subtitle="No estimated scores" />
        <HeroTile label="Score trend" value={valueOrDash(loading, summary, summary?.secure_trend)} icon={Activity} glow="cyan" subtitle="Recorded snapshots" />
        <HeroTile label="Risky sign-ins" value={valueOrDash(loading, summary, summary?.risky_signins_30d)} icon={AlertTriangle} glow="amber" subtitle="Provider-recorded" />
        <HeroTile label="GDAP expiring" value={valueOrDash(loading, summary, summary?.gdap_expiring_30d)} icon={KeyRound} glow="rose" subtitle="Verified relationships" />
      </div>

      {!hasEvidence && <EmptyEvidence action={<Button size="sm" onClick={() => setTab("connection")}><Lock className="mr-1.5 h-3.5 w-3.5" />Set up connection</Button>} />}

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 bg-muted/40 p-1 md:grid-cols-6">
          <TabsTrigger value="overview"><Cloud className="mr-1.5 h-3.5 w-3.5" />Tenants</TabsTrigger>
          <TabsTrigger value="standards"><ListChecks className="mr-1.5 h-3.5 w-3.5" />Guardrails</TabsTrigger>
          <TabsTrigger value="gdap"><KeyRound className="mr-1.5 h-3.5 w-3.5" />GDAP</TabsTrigger>
          <TabsTrigger value="security"><ShieldCheck className="mr-1.5 h-3.5 w-3.5" />Security</TabsTrigger>
          <TabsTrigger value="detections"><AlertTriangle className="mr-1.5 h-3.5 w-3.5" />Detection drafts</TabsTrigger>
          <TabsTrigger value="connection"><Lock className="mr-1.5 h-3.5 w-3.5" />Connection</TabsTrigger>
        </TabsList>

        <TabsContent value="overview"><TenantsTab headers={headers} hasEvidence={hasEvidence} onSetup={() => setTab("connection")} /></TabsContent>
        <TabsContent value="standards"><StandardsTab headers={headers} /></TabsContent>
        <TabsContent value="gdap"><GdapTab headers={headers} /></TabsContent>
        <TabsContent value="security"><SecurityTab headers={headers} /></TabsContent>
        <TabsContent value="detections"><DetectionDraftsTab headers={headers} /></TabsContent>
        <TabsContent value="connection"><ConnectionTab headers={headers} connection={connection} onSaved={load} /></TabsContent>
      </Tabs>
    </div>
  );
}

function TenantsTab({ headers, hasEvidence, onSetup }) {
  const [tenants, setTenants] = useState([]);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/m365/tenants`, { headers });
      setTenants(response.data);
    } catch (error) {
      toast.error("Verified tenant inventory could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [headers]);
  useEffect(() => { load(); }, [load]);

  const runSearch = async () => {
    if (query.trim().length < 2) {
      setSearch(null);
      return;
    }
    try {
      const response = await axios.get(`${API}/m365/search?q=${encodeURIComponent(query)}`, { headers });
      setSearch(response.data);
    } catch (error) {
      toast.error("Microsoft 365 search is unavailable until provider evidence is connected");
    }
  };

  if (!hasEvidence && !loading) {
    return <EmptyEvidence title="Tenant inventory is waiting for a verified synchronisation" description="A saved app registration is not proof of a working integration. Verify Microsoft Graph token access and install the Nexus synchronisation provider before tenant, user, score and GDAP data appear here." action={<Button size="sm" onClick={onSetup}>Open connection setup</Button>} />;
  }

  return (
    <div className="space-y-3">
      <Card><CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
        <div><p className="text-sm font-semibold">Verified tenant inventory</p><p className="mt-1 text-xs text-muted-foreground">Only data written by a verified Microsoft Graph or Partner Center provider is displayed.</p></div>
        <div className="flex gap-2"><Input className="w-72" placeholder="Search verified tenants, users or GDAP roles" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && runSearch()} /><Button variant="outline" onClick={runSearch}><Search className="mr-1.5 h-3.5 w-3.5" />Search</Button></div>
      </CardContent></Card>
      {search && <Card><CardContent className="p-4 text-xs"><p className="font-medium">{search.count} verified result{search.count === 1 ? "" : "s"}</p><div className="mt-2 space-y-1 text-muted-foreground">{[...search.tenants, ...search.users, ...search.gdap].slice(0, 10).map((item) => <p key={`${item.id}-${item.tenant_id || ""}`}>{item.name || item.display_name || item.tenant_name} {item.default_domain || item.upn ? `- ${item.default_domain || item.upn}` : ""}</p>)}</div></CardContent></Card>}
      {loading ? <div className="py-10 text-center text-sm text-muted-foreground">Loading verified tenant inventory...</div> : <Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Tenant</TableHead><TableHead>Primary domain</TableHead><TableHead className="text-right">Users</TableHead><TableHead className="text-right">MFA</TableHead><TableHead className="text-right">Secure Score</TableHead></TableRow></TableHeader><TableBody>{tenants.map((tenant) => <TableRow key={tenant.id}><TableCell className="font-medium">{tenant.name}</TableCell><TableCell className="font-mono text-xs">{tenant.default_domain || "-"}</TableCell><TableCell className="text-right">{tenant.users_count ?? "-"}</TableCell><TableCell className="text-right">{tenant.mfa_enrolled_pct === undefined ? "-" : `${tenant.mfa_enrolled_pct}%`}</TableCell><TableCell className="text-right">{tenant.secure_score ?? "-"}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>}
    </div>
  );
}

function StandardsTab({ headers }) {
  const [standards, setStandards] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { const response = await axios.get(`${API}/m365/standards`, { headers }); setStandards(response.data); }
    catch (error) { toast.error("Microsoft 365 guardrail library could not be loaded"); }
    finally { setLoading(false); }
  }, [headers]);
  useEffect(() => { load(); }, [load]);

  const togglePlan = async (standard) => {
    try {
      const response = await axios.put(`${API}/m365/standards/${standard.id}`, { enabled: !standard.enabled }, { headers });
      setStandards((current) => current.map((item) => item.id === standard.id ? response.data : item));
      toast.success(standard.enabled ? "Guardrail removed from plan" : "Guardrail added to plan");
    } catch (error) { toast.error(error.response?.data?.detail || "Unable to update guardrail plan"); }
  };

  const groups = standards.reduce((result, standard) => {
    (result[standard.category] ||= []).push(standard);
    return result;
  }, {});
  return (
    <div className="space-y-3">
      <Card className="border-cyan-500/25 bg-cyan-500/[0.04]"><CardContent className="flex gap-3 p-4"><FileCheck2 className="mt-0.5 h-5 w-5 text-cyan-300" /><div><p className="text-sm font-semibold">Reference guardrails, not fabricated compliance</p><p className="mt-1 text-xs leading-5 text-muted-foreground">These are MSP-reviewed planning controls. Enabling one stores an internal plan only; it does not evaluate a tenant, apply a Microsoft policy, or claim remediation until a verified provider can prove the result.</p></div></CardContent></Card>
      {loading ? <div className="py-10 text-center text-sm text-muted-foreground">Loading reference guardrails...</div> : Object.entries(groups).map(([category, items]) => <Card key={category}><CardContent className="space-y-2 p-4"><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{category}</p>{items.map((standard) => <div className="flex items-center gap-3 rounded-lg border border-border/70 bg-muted/15 p-3" key={standard.id}><Switch checked={standard.enabled} onCheckedChange={() => togglePlan(standard)} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">{standard.name}</p><Badge variant="outline" className={severityClasses[standard.severity]}>{standard.severity}</Badge>{standard.enabled && <Badge variant="outline" className="border-cyan-500/30 text-cyan-100">planned</Badge>}</div><p className="mt-1 text-xs text-muted-foreground">{standard.description}</p></div><Badge variant="outline" className="hidden border-zinc-700 text-[10px] text-muted-foreground sm:inline-flex">Reference only</Badge></div>)}</CardContent></Card>)}
    </div>
  );
}

function GdapTab({ headers }) {
  const [relationships, setRelationships] = useState([]);
  const [templates, setTemplates] = useState([]);
  useEffect(() => {
    Promise.all([axios.get(`${API}/m365/gdap`, { headers }), axios.get(`${API}/m365/gdap/role-templates`, { headers })]).then(([relationshipsResponse, templatesResponse]) => { setRelationships(relationshipsResponse.data); setTemplates(templatesResponse.data); }).catch(() => toast.error("GDAP data could not be loaded"));
  }, [headers]);
  return <div className="space-y-3">
    <Card className="border-cyan-500/25 bg-cyan-500/[0.04]"><CardContent className="p-4"><p className="text-sm font-semibold">GDAP least-privilege reference</p><p className="mt-1 text-xs text-muted-foreground">Templates help technicians scope Partner Center relationships. NexusMSP will not extend a relationship or label one active without provider-confirmed evidence.</p></CardContent></Card>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{templates.map((template) => <Card key={template.id}><CardContent className="p-4"><p className="text-sm font-medium">{template.name}</p><p className="mt-2 text-xs text-muted-foreground">{template.roles.length} scoped roles</p><p className="mt-2 text-xs leading-5 text-zinc-300">{template.roles.join(" · ")}</p></CardContent></Card>)}</div>
    {relationships.length === 0 ? <EmptyEvidence title="No verified GDAP relationships" description="Create or renew GDAP relationships in Partner Center. They will appear here only after the Microsoft provider retrieves and validates them." /> : <Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Tenant</TableHead><TableHead>Roles</TableHead><TableHead>Expiry</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{relationships.map((relationship) => <TableRow key={relationship.id}><TableCell className="font-medium">{relationship.tenant_name}</TableCell><TableCell>{relationship.role_count} roles</TableCell><TableCell>{relationship.expires_in_days} days</TableCell><TableCell><Badge variant="outline">{relationship.status}</Badge></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>}
  </div>;
}

function SecurityTab({ headers }) {
  const [mfa, setMfa] = useState(null);
  const [trend, setTrend] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [aitm, setAitm] = useState(null);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    try {
      const [mfaResponse, trendResponse, templateResponse, aitmResponse] = await Promise.all([
        axios.get(`${API}/m365/mfa-analytics`, { headers }), axios.get(`${API}/m365/secure-score/trend`, { headers }), axios.get(`${API}/m365/ca-templates`, { headers }), axios.get(`${API}/m365/aitm-page`, { headers }),
      ]);
      setMfa(mfaResponse.data); setTrend(trendResponse.data); setTemplates(templateResponse.data); setAitm(aitmResponse.data);
    } catch (error) { toast.error("Microsoft 365 security references could not be loaded"); }
  }, [headers]);
  useEffect(() => { load(); }, [load]);
  const saveAitm = async () => { setSaving(true); try { const response = await axios.put(`${API}/m365/aitm-page`, aitm, { headers }); setAitm(response.data); toast.success("Manual reference snippet saved"); } catch { toast.error("Could not save the reference snippet"); } finally { setSaving(false); } };
  return <div className="grid gap-3 xl:grid-cols-2">
    <Card><CardContent className="p-4"><div className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-emerald-300" /><p className="text-sm font-semibold">MFA coverage</p></div>{mfa?.telemetry_available ? <><p className="mt-4 text-3xl font-light text-emerald-200">{mfa.mfa_pct}%</p><p className="mt-1 text-xs text-muted-foreground">{mfa.no_mfa_admin_count} administrator accounts and {mfa.no_mfa_users.length} users need MFA review.</p></> : <p className="mt-3 text-xs leading-5 text-muted-foreground">No verified identity evidence has been received. MFA coverage will remain blank instead of being estimated.</p>}</CardContent></Card>
    <Card><CardContent className="p-4"><div className="flex items-center gap-2"><Activity className="h-4 w-4 text-cyan-300" /><p className="text-sm font-semibold">Secure Score history</p></div>{trend?.series?.length ? <p className="mt-3 text-xs text-muted-foreground">{trend.series.length} provider-recorded score snapshots are available for reporting.</p> : <p className="mt-3 text-xs leading-5 text-muted-foreground">No recorded score history has been received. NexusMSP will not interpolate a chart from current values.</p>}</CardContent></Card>
    <Card className="xl:col-span-2"><CardContent className="p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold">Conditional Access reference library</p><p className="mt-1 text-xs text-muted-foreground">Review templates before creating the matching policies in Microsoft Entra. Deployment remains disabled until a provider can deploy and read back policy state.</p></div><Badge variant="outline" className="border-zinc-700 text-muted-foreground">Reference only</Badge></div><div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{templates.map((template) => <div className="rounded-lg border border-border/70 bg-muted/15 p-3" key={template.id}><div className="flex items-center justify-between gap-2"><p className="text-sm font-medium">{template.name}</p><Badge variant="outline" className={severityClasses[template.severity]}>{template.severity}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{template.category} - {template.source}</p></div>)}</div></CardContent></Card>
    <Card className="xl:col-span-2"><CardContent className="space-y-3 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold">Sign-in warning reference</p><p className="mt-1 text-xs text-muted-foreground">Create a branded warning snippet for manual Entra configuration. Saving it in NexusMSP does not inject or deploy it to Microsoft.</p></div>{aitm && <Switch checked={Boolean(aitm.enabled)} onCheckedChange={(enabled) => setAitm({ ...aitm, enabled })} />}</div>{aitm && <><div className="grid gap-3 md:grid-cols-3"><div><Label>Organisation name</Label><Input value={aitm.company_name || ""} onChange={(event) => setAitm({ ...aitm, company_name: event.target.value })} /></div><div><Label>Banner colour</Label><Input type="color" value={aitm.primary_color || "#DC2626"} onChange={(event) => setAitm({ ...aitm, primary_color: event.target.value })} /></div><div className="md:col-span-3"><Label>Warning message</Label><Textarea rows={2} value={aitm.warning_text || ""} onChange={(event) => setAitm({ ...aitm, warning_text: event.target.value })} /></div></div><div className="flex flex-wrap items-center gap-3"><Button size="sm" onClick={saveAitm} disabled={saving}>{saving ? <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileCheck2 className="mr-1.5 h-3.5 w-3.5" />}Save reference</Button>{aitm.deployment_note && <span className="text-xs text-muted-foreground">{aitm.deployment_note}</span>}</div>{aitm.css && <pre className="max-h-48 overflow-auto rounded-lg border border-border/70 bg-black/20 p-3 text-xs text-cyan-100">{aitm.css}</pre>}</>}</CardContent></Card>
  </div>;
}

function DetectionDraftsTab({ headers }) {
  const [drafts, setDrafts] = useState([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", expression: "", severity: "medium" });
  const load = useCallback(async () => { try { const response = await axios.get(`${API}/m365/scripted-alerts`, { headers }); setDrafts(response.data); } catch { toast.error("Detection drafts could not be loaded"); } }, [headers]);
  useEffect(() => { load(); }, [load]);
  const create = async () => { try { await axios.post(`${API}/m365/scripted-alerts`, form, { headers }); toast.success("Detection draft saved"); setCreating(false); setForm({ name: "", expression: "", severity: "medium" }); load(); } catch (error) { toast.error(error.response?.data?.detail || "Unable to save draft"); } };
  const remove = async (id) => { try { await axios.delete(`${API}/m365/scripted-alerts/${id}`, { headers }); load(); toast.success("Detection draft removed"); } catch { toast.error("Unable to remove draft"); } };
  return <div className="space-y-3"><Card className="border-amber-500/30 bg-amber-500/[0.04]"><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="text-sm font-semibold">Detection rule drafts</p><p className="mt-1 text-xs text-muted-foreground">Drafts are auditable planning records only. They do not inspect Microsoft logs, fire alerts, create tickets, or invoke webhooks until an evaluated telemetry provider is connected.</p></div><Button size="sm" onClick={() => setCreating(true)}><Plus className="mr-1.5 h-3.5 w-3.5" />New draft</Button></CardContent></Card>{drafts.length === 0 ? <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">No detection rule drafts saved.</CardContent></Card> : drafts.map((draft) => <Card key={draft.id}><CardContent className="flex items-center gap-3 p-4"><Badge variant="outline" className={severityClasses[draft.severity]}>{draft.severity}</Badge><div className="min-w-0 flex-1"><p className="text-sm font-medium">{draft.name}</p><p className="mt-1 truncate font-mono text-xs text-muted-foreground">{draft.expression}</p></div><Badge variant="outline" className="border-zinc-700 text-muted-foreground">Not evaluated</Badge><Button size="sm" variant="ghost" onClick={() => remove(draft.id)}>Remove</Button></CardContent></Card>)}<Dialog open={creating} onOpenChange={setCreating}><DialogContent><DialogHeader><DialogTitle>New Microsoft 365 detection draft</DialogTitle></DialogHeader><div className="space-y-3"><div><Label>Name</Label><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="External inbox forwarding" /></div><div><Label>Expression or provider query plan</Label><Textarea rows={4} value={form.expression} onChange={(event) => setForm({ ...form, expression: event.target.value })} placeholder="Describe the Microsoft audit signal to evaluate" /></div><div><Label>Severity</Label><Input value={form.severity} onChange={(event) => setForm({ ...form, severity: event.target.value })} placeholder="medium" /></div></div><DialogFooter><Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button><Button onClick={create}>Save draft</Button></DialogFooter></DialogContent></Dialog></div>;
}

function ConnectionTab({ headers, connection, onSaved }) {
  const [form, setForm] = useState({ app_id: "", tenant_id: "", app_secret: "", partner_center_account: "" });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); try { const payload = Object.fromEntries(Object.entries(form).filter(([, value]) => value.trim())); const response = await axios.put(`${API}/m365/connection`, payload, { headers }); setResult(response.data); setForm({ app_id: "", tenant_id: "", app_secret: "", partner_center_account: "" }); onSaved?.(); toast.success("Connection details saved for verification"); } catch { toast.error("Unable to save Microsoft 365 connection details"); } finally { setBusy(false); } };
  const test = async () => { setBusy(true); try { const response = await axios.post(`${API}/m365/connection/test`, {}, { headers }); setResult(response.data); } catch { toast.error("Connection check could not be completed"); } finally { setBusy(false); } };
  return <div className="grid gap-4 xl:grid-cols-[1fr_1.15fr]"><Card className="border-cyan-500/25 bg-cyan-500/[0.04]"><CardContent className="p-5"><div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-cyan-300" /><p className="text-sm font-semibold">Technician setup path</p></div><ol className="mt-4 space-y-3 text-xs leading-5 text-muted-foreground"><li><span className="mr-2 font-semibold text-cyan-200">01</span>Create a dedicated Microsoft Entra app registration for the MSP integration.</li><li><span className="mr-2 font-semibold text-cyan-200">02</span>Grant only the Microsoft Graph application permissions required by the synchronisation provider, then obtain tenant admin consent.</li><li><span className="mr-2 font-semibold text-cyan-200">03</span>Create and securely store a client secret; record the App (client) ID and Directory (tenant) ID.</li><li><span className="mr-2 font-semibold text-cyan-200">04</span>Save the connection below, then install and verify the Nexus Microsoft Graph synchronisation provider.</li></ol><p className="mt-4 rounded-lg border border-amber-500/25 bg-amber-500/[0.05] p-3 text-xs leading-5 text-amber-100">Saving credentials does not establish a live connection. This workspace remains evidence-free until a provider can authenticate, retrieve data, and record its verification.</p></CardContent></Card><Card><CardContent className="space-y-4 p-5"><div className="flex flex-wrap items-center gap-2"><Lock className="h-4 w-4 text-cyan-300" /><p className="text-sm font-semibold">Connection details</p><Badge variant="outline" className="border-amber-500/30 text-amber-100">{statusLabel(connection?.mode)}</Badge></div><div className="grid gap-3 md:grid-cols-2"><div><Label>App (client) ID</Label><Input value={form.app_id} onChange={(event) => setForm({ ...form, app_id: event.target.value })} placeholder={connection?.app_id || "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"} /></div><div><Label>Directory (tenant) ID</Label><Input value={form.tenant_id} onChange={(event) => setForm({ ...form, tenant_id: event.target.value })} placeholder={connection?.tenant_id || "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"} /></div><div><Label>Client secret</Label><Input type="password" value={form.app_secret} onChange={(event) => setForm({ ...form, app_secret: event.target.value })} placeholder={connection?.secret_configured ? "A secret is stored - enter a new value only to rotate it" : "Enter client secret"} /></div><div><Label>Partner Center account (optional)</Label><Input value={form.partner_center_account} onChange={(event) => setForm({ ...form, partner_center_account: event.target.value })} placeholder={connection?.partner_center_account || "operations@example.com"} /></div></div><div className="flex flex-wrap gap-2"><Button onClick={save} disabled={busy}>{busy ? <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Lock className="mr-1.5 h-3.5 w-3.5" />}Save for verification</Button><Button variant="outline" onClick={test} disabled={busy}>Check readiness</Button></div>{result && <div className={`rounded-lg border p-3 text-xs leading-5 ${result.ok ? "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-100" : "border-amber-500/30 bg-amber-500/[0.05] text-amber-100"}`}><p className="font-medium">{result.ok ? "Verification complete" : result.reason || result.message || "Verification pending"}</p>{result.next_steps?.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5">{result.next_steps.map((step) => <li key={step}>{step}</li>)}</ul>}</div>}</CardContent></Card></div>;
}
