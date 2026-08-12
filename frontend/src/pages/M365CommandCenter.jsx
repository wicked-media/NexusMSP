import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";
import { toast } from "sonner";
import {
  Activity, AlertTriangle, Building2, CheckCircle2, Cloud, ExternalLink,
  FileCheck2, KeyRound, Link2, ListChecks, Loader2, Lock, Plus,
  Mail, MonitorSmartphone, RefreshCw, Search, Share2, ShieldCheck, Sparkles, UserPlus, Users,
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

export default function M365CommandCenter({ embedded = false, initialTab = "overview" }) {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [tab, setTab] = useState(initialTab);
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
  useEffect(() => { setTab(initialTab); }, [initialTab]);

  const hasEvidence = Boolean(summary?.telemetry_available);
  return (
    <div className={embedded ? "space-y-5" : "space-y-5 p-6"} data-testid="m365-page">
      {!embedded && <OperationalPageHeader
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
      />}

      {!embedded && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
        <HeroTile label="Tenants" value={valueOrDash(loading, summary, summary?.tenants)} icon={Cloud} glow="cyan" subtitle="Verified Graph inventory" />
        <HeroTile label="Users" value={valueOrDash(loading, summary, summary?.users)} icon={Users} glow="violet" subtitle="Provider-recorded identities" />
        <HeroTile label="MFA coverage" value={valueOrDash(loading, summary, summary?.avg_mfa_pct, "%")} icon={KeyRound} glow="emerald" subtitle="Verified evidence only" />
        <HeroTile label="Secure score" value={valueOrDash(loading, summary, summary?.avg_secure_score)} icon={ShieldCheck} glow="sky" subtitle="No estimated scores" />
        <HeroTile label="Score trend" value={valueOrDash(loading, summary, summary?.secure_trend)} icon={Activity} glow="cyan" subtitle="Recorded snapshots" />
        <HeroTile label="Risky sign-ins" value={valueOrDash(loading, summary, summary?.risky_signins_30d)} icon={AlertTriangle} glow="amber" subtitle="Provider-recorded" />
        <HeroTile label="GDAP expiring" value={valueOrDash(loading, summary, summary?.gdap_expiring_30d)} icon={KeyRound} glow="rose" subtitle="Verified relationships" />
      </div>}

      {!hasEvidence && <EmptyEvidence action={<Button size="sm" onClick={() => setTab("connection")}><Lock className="mr-1.5 h-3.5 w-3.5" />Set up connection</Button>} />}

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-muted/40 p-1">
          <TabsTrigger value="overview"><Cloud className="mr-1.5 h-3.5 w-3.5" />Tenants</TabsTrigger>
          <TabsTrigger value="exchange"><Mail className="mr-1.5 h-3.5 w-3.5" />Exchange</TabsTrigger>
          <TabsTrigger value="intune"><MonitorSmartphone className="mr-1.5 h-3.5 w-3.5" />Intune</TabsTrigger>
          <TabsTrigger value="collaboration"><Share2 className="mr-1.5 h-3.5 w-3.5" />Collaboration</TabsTrigger>
          <TabsTrigger value="licensing"><FileCheck2 className="mr-1.5 h-3.5 w-3.5" />Licensing</TabsTrigger>
          <TabsTrigger value="standards"><ListChecks className="mr-1.5 h-3.5 w-3.5" />Guardrails</TabsTrigger>
          <TabsTrigger value="gdap"><KeyRound className="mr-1.5 h-3.5 w-3.5" />GDAP</TabsTrigger>
          <TabsTrigger value="security"><ShieldCheck className="mr-1.5 h-3.5 w-3.5" />Security</TabsTrigger>
          <TabsTrigger value="detections"><AlertTriangle className="mr-1.5 h-3.5 w-3.5" />Detection drafts</TabsTrigger>
          <TabsTrigger value="connection"><Lock className="mr-1.5 h-3.5 w-3.5" />Connection</TabsTrigger>
        </TabsList>

        <TabsContent value="overview"><TenantsTab headers={headers} hasEvidence={hasEvidence} onSetup={() => setTab("connection")} /></TabsContent>
        <TabsContent value="exchange"><ExchangePostureTab headers={headers} onSetup={() => setTab("connection")} /></TabsContent>
        <TabsContent value="intune"><IntunePostureTab headers={headers} onSetup={() => setTab("connection")} /></TabsContent>
        <TabsContent value="collaboration"><CollaborationPostureTab headers={headers} onSetup={() => setTab("connection")} /></TabsContent>
        <TabsContent value="licensing"><LicensingPostureTab headers={headers} onSetup={() => setTab("connection")} /></TabsContent>
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

function ExchangePostureTab({ headers, onSetup }) {
  const [posture, setPosture] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/m365/exchange/posture`, { headers });
      setPosture(response.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Exchange posture evidence could not be loaded");
    } finally { setLoading(false); }
  }, [headers]);
  useEffect(() => { load(); }, [load]);

  if (loading && !posture) return <div className="py-10 text-center text-sm text-muted-foreground">Loading Exchange evidence…</div>;
  if (!posture?.telemetry_available) return <EmptyEvidence title="Exchange posture is waiting for verified evidence" description="Nexus needs a read-only Graph synchronisation for mailbox inventory, forwarding or inbox-rule evidence, and transport rules. A saved credential never becomes a pretend mail-security result." action={<Button size="sm" onClick={onSetup}><KeyRound className="mr-1.5 h-3.5 w-3.5" />Open Microsoft connection</Button>} />;
  const summary = posture.summary || {};
  return <div className="space-y-4" data-testid="m365-exchange-posture">
    <Card className="border-sky-500/20 bg-sky-500/[0.035]"><CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between"><div className="flex gap-3"><Mail className="mt-0.5 h-5 w-5 shrink-0 text-sky-600 dark:text-sky-200" /><div><p className="text-sm font-semibold">Exchange & mailbox governance</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Read-only Microsoft evidence is joined to the tenant and client record. Containment, deletion and forwarding changes remain governed actions—not one-click mailbox mutations.</p></div></div><Button size="sm" variant="outline" onClick={load} disabled={loading}><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh evidence</Button></CardContent></Card>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><HeroTile label="Mailboxes" value={summary.mailboxes ?? 0} icon={Mail} glow="sky" subtitle="Provider-recorded" /><HeroTile label="External forwarding" value={summary.external_forwards ?? 0} icon={AlertTriangle} glow={(summary.external_forwards || 0) ? "rose" : "emerald"} subtitle="Requires technician review" /><HeroTile label="Inbox rules" value={summary.mailbox_rules ?? 0} icon={ListChecks} glow="violet" subtitle="Observed rule evidence" /><HeroTile label="Transport rules" value={summary.transport_rules ?? 0} icon={Activity} glow="cyan" subtitle="Exchange mail flow" /><HeroTile label="Audit unknown" value={summary.audit_unknown ?? 0} icon={ShieldCheck} glow={(summary.audit_unknown || 0) ? "amber" : "emerald"} subtitle="Check provider evidence" /></div>
    <Card className="overflow-hidden border-rose-500/20"><CardHeader className="border-b border-rose-500/15"><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-200" />Forwarding and mailbox-rule review</CardTitle><p className="mt-1 text-xs text-muted-foreground">Nexus flags evidence that needs validation. It does not assert malicious intent, disable a rule or alter delivery.</p></CardHeader><CardContent className="p-0">{(posture.attention || []).length === 0 ? <div className="p-6 text-center text-sm text-emerald-700 dark:text-emerald-100"><CheckCircle2 className="mx-auto mb-2 h-5 w-5" />No external-forwarding evidence is currently recorded in this scope.</div> : <Table><TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Mailbox / subject</TableHead><TableHead>Destination or detail</TableHead><TableHead>Severity</TableHead><TableHead>Observed</TableHead></TableRow></TableHeader><TableBody>{posture.attention.map((item, index) => <TableRow key={`${item.id || item.subject}-${index}`}><TableCell><Badge variant="outline" className="capitalize">{String(item.kind || "evidence").replace("_", " ")}</Badge></TableCell><TableCell className="font-medium">{item.subject}</TableCell><TableCell className="max-w-[320px] truncate text-sm text-muted-foreground" title={item.detail}>{item.detail}</TableCell><TableCell><Badge variant="outline" className={severityClasses[item.severity] || severityClasses.medium}>{item.severity}</Badge></TableCell><TableCell className="text-xs text-muted-foreground">{item.observed_at ? new Date(item.observed_at).toLocaleString() : "Not supplied"}</TableCell></TableRow>)}</TableBody></Table>}</CardContent></Card>
    <Card className="border-violet-500/15 bg-violet-500/[0.025]"><CardContent className="p-4"><p className="text-sm font-semibold">Safety boundary</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{posture.boundary}</p></CardContent></Card>
  </div>;
}

function IntunePostureTab({ headers, onSetup }) {
  const [posture, setPosture] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/m365/intune/posture`, { headers });
      setPosture(response.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Intune posture evidence could not be loaded");
    } finally { setLoading(false); }
  }, [headers]);
  useEffect(() => { load(); }, [load]);

  if (loading && !posture) return <div className="py-10 text-center text-sm text-muted-foreground">Loading Intune evidence…</div>;
  if (!posture?.telemetry_available) return <EmptyEvidence title="Intune compliance is waiting for verified evidence" description="Nexus needs a read-only Graph synchronisation for managed devices, compliance state and BitLocker or encryption posture. Nexus Agent and Intune remain separate source records until they are explicitly correlated." action={<Button size="sm" onClick={onSetup}><KeyRound className="mr-1.5 h-3.5 w-3.5" />Open Microsoft connection</Button>} />;
  const summary = posture.summary || {};
  return <div className="space-y-4" data-testid="m365-intune-posture">
    <Card className="border-cyan-500/20 bg-cyan-500/[0.035]"><CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between"><div className="flex gap-3"><MonitorSmartphone className="mt-0.5 h-5 w-5 shrink-0 text-cyan-600 dark:text-cyan-200" /><div><p className="text-sm font-semibold">Intune & device compliance</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Microsoft compliance evidence remains distinct from Nexus Agent telemetry until identity correlation is verified. That avoids treating two similarly named devices as the same asset.</p></div></div><Button size="sm" variant="outline" onClick={load} disabled={loading}><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh evidence</Button></CardContent></Card>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><HeroTile label="Managed devices" value={summary.devices ?? 0} icon={MonitorSmartphone} glow="cyan" subtitle="Provider-recorded" /><HeroTile label="Compliant" value={summary.compliant ?? 0} icon={CheckCircle2} glow="emerald" subtitle="Current evidence only" /><HeroTile label="Needs attention" value={summary.needs_attention ?? 0} icon={AlertTriangle} glow={(summary.needs_attention || 0) ? "rose" : "emerald"} subtitle="Compliance evidence" /><HeroTile label="Encryption review" value={summary.encryption_review ?? 0} icon={ShieldCheck} glow={(summary.encryption_review || 0) ? "amber" : "emerald"} subtitle="Validate BitLocker posture" /><HeroTile label="Stale sync" value={summary.stale ?? 0} icon={Activity} glow={(summary.stale || 0) ? "amber" : "emerald"} subtitle="24+ hours or provider flag" /></div>
    <Card className="overflow-hidden border-amber-500/20"><CardHeader className="border-b border-amber-500/15"><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-200" />Compliance review queue</CardTitle><p className="mt-1 text-xs text-muted-foreground">Review non-compliance before using an approved Intune or Nexus Agent remediation workflow.</p></CardHeader><CardContent className="p-0">{(posture.attention || []).length === 0 ? <div className="p-6 text-center text-sm text-emerald-700 dark:text-emerald-100"><CheckCircle2 className="mx-auto mb-2 h-5 w-5" />No non-compliant Intune device evidence is currently recorded.</div> : <Table><TableHeader><TableRow><TableHead>Device</TableHead><TableHead>Primary user</TableHead><TableHead>Compliance</TableHead><TableHead>Encryption</TableHead><TableHead>Last evidence</TableHead></TableRow></TableHeader><TableBody>{posture.attention.map((item, index) => <TableRow key={`${item.id || item.device_name}-${index}`}><TableCell className="font-medium">{item.device_name}</TableCell><TableCell className="text-sm text-muted-foreground">{item.primary_user || "Not supplied"}</TableCell><TableCell><Badge variant="outline" className={String(item.compliance_state).toLowerCase() === "compliant" ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-200" : "border-amber-500/30 text-amber-700 dark:text-amber-200"}>{item.compliance_state}</Badge></TableCell><TableCell className="capitalize text-sm text-muted-foreground">{item.encryption_state}</TableCell><TableCell className="text-xs text-muted-foreground">{item.last_sync ? new Date(item.last_sync).toLocaleString() : "Not supplied"}</TableCell></TableRow>)}</TableBody></Table>}</CardContent></Card>
    <Card className="border-violet-500/15 bg-violet-500/[0.025]"><CardContent className="p-4"><p className="text-sm font-semibold">Safety boundary</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{posture.boundary}</p></CardContent></Card>
  </div>;
}

function CollaborationPostureTab({ headers, onSetup }) {
  const [posture, setPosture] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/m365/collaboration/posture`, { headers });
      setPosture(response.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Collaboration posture evidence could not be loaded");
    } finally { setLoading(false); }
  }, [headers]);
  useEffect(() => { load(); }, [load]);

  if (loading && !posture) return <div className="py-10 text-center text-sm text-muted-foreground">Loading collaboration evidence…</div>;
  if (!posture?.telemetry_available) return <EmptyEvidence title="Collaboration governance is waiting for verified evidence" description="Nexus needs Graph synchronisation for SharePoint sites, Teams, guest access and Entra guest sign-in evidence. This view does not estimate sharing posture from a tenant connection." action={<Button size="sm" onClick={onSetup}><KeyRound className="mr-1.5 h-3.5 w-3.5" />Open Microsoft connection</Button>} />;
  const summary = posture.summary || {};
  return <div className="space-y-4" data-testid="m365-collaboration-posture">
    <Card className="border-violet-500/20 bg-violet-500/[0.035]"><CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between"><div className="flex gap-3"><Share2 className="mt-0.5 h-5 w-5 shrink-0 text-violet-600 dark:text-violet-200" /><div><p className="text-sm font-semibold">Teams, SharePoint & guest governance</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Review collaboration exposure alongside the owning tenant, client, support history and future approval-gated changes.</p></div></div><Button size="sm" variant="outline" onClick={load} disabled={loading}><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh evidence</Button></CardContent></Card>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><HeroTile label="SharePoint sites" value={summary.sharepoint_sites ?? 0} icon={Cloud} glow="sky" subtitle="Provider-recorded" /><HeroTile label="Teams" value={summary.teams ?? 0} icon={Users} glow="violet" subtitle="Governed collaboration" /><HeroTile label="Guest users" value={summary.guest_users ?? 0} icon={Users} glow="cyan" subtitle="Entra evidence" /><HeroTile label="External sites" value={summary.external_sites ?? 0} icon={Share2} glow={(summary.external_sites || 0) ? "amber" : "emerald"} subtitle="Validate sharing need" /><HeroTile label="External teams" value={summary.external_teams ?? 0} icon={AlertTriangle} glow={(summary.external_teams || 0) ? "amber" : "emerald"} subtitle="Guest/external access" /><HeroTile label="Dormant guests" value={summary.dormant_guests ?? 0} icon={Activity} glow={(summary.dormant_guests || 0) ? "rose" : "emerald"} subtitle="90+ days or stale" /></div>
    <Card className="overflow-hidden border-amber-500/20"><CardHeader className="border-b border-amber-500/15"><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-200" />Collaboration access review</CardTitle><p className="mt-1 text-xs text-muted-foreground">External sharing and dormant guests are review signals, not proof of a problem. Record a reason and approval before changing access.</p></CardHeader><CardContent className="p-0">{(posture.attention || []).length === 0 ? <div className="p-6 text-center text-sm text-emerald-700 dark:text-emerald-100"><CheckCircle2 className="mx-auto mb-2 h-5 w-5" />No external-sharing or dormant-guest evidence is currently recorded.</div> : <Table><TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Resource or identity</TableHead><TableHead>Evidence</TableHead><TableHead>Severity</TableHead><TableHead>Observed</TableHead></TableRow></TableHeader><TableBody>{posture.attention.map((item, index) => <TableRow key={`${item.id || item.subject}-${index}`}><TableCell><Badge variant="outline" className="capitalize">{String(item.kind || "evidence").replace("_", " ")}</Badge></TableCell><TableCell className="font-medium">{item.subject}</TableCell><TableCell className="max-w-[300px] truncate text-sm text-muted-foreground" title={item.detail}>{item.detail}</TableCell><TableCell><Badge variant="outline" className={severityClasses[item.severity] || severityClasses.medium}>{item.severity}</Badge></TableCell><TableCell className="text-xs text-muted-foreground">{item.observed_at ? new Date(item.observed_at).toLocaleString() : "Not supplied"}</TableCell></TableRow>)}</TableBody></Table>}</CardContent></Card>
    <Card className="border-violet-500/15 bg-violet-500/[0.025]"><CardContent className="p-4"><p className="text-sm font-semibold">Safety boundary</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{posture.boundary}</p></CardContent></Card>
  </div>;
}

function LicensingPostureTab({ headers, onSetup }) {
  const [posture, setPosture] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/m365/licensing/posture`, { headers });
      setPosture(response.data);
    } catch (error) { toast.error(error.response?.data?.detail || "Microsoft licence evidence could not be loaded"); }
    finally { setLoading(false); }
  }, [headers]);
  useEffect(() => { load(); }, [load]);
  if (loading && !posture) return <div className="py-10 text-center text-sm text-muted-foreground">Loading Microsoft licence evidence…</div>;
  if (!posture?.telemetry_available) return <EmptyEvidence title="Microsoft licence posture is waiting for verified evidence" description="Nexus needs provider-recorded SKU inventory and user licence assignments before it can identify waste, stock pressure or a reconciliation opportunity. It will not estimate commercial exposure from a tenant connection." action={<Button size="sm" onClick={onSetup}><KeyRound className="mr-1.5 h-3.5 w-3.5" />Open Microsoft connection</Button>} />;
  const summary = posture.summary || {};
  return <div className="space-y-4" data-testid="m365-licensing-posture">
    <Card className="border-emerald-500/20 bg-emerald-500/[0.035]"><CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between"><div className="flex gap-3"><FileCheck2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-200" /><div><p className="text-sm font-semibold">Microsoft licensing & revenue protection</p><p className="mt-1 text-xs leading-5 text-muted-foreground">See provider-recorded assignments first, then turn approved changes into a Nexus service and billing reconciliation. This avoids treating every unassigned seat as a billing error.</p></div></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={load} disabled={loading}><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh</Button><Button size="sm" variant="outline" onClick={() => window.location.assign("/control-plane?module=microsoft365&view=actions&action=change-licences")}>Preview licence change</Button></div></CardContent></Card>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><HeroTile label="Microsoft SKUs" value={summary.skus ?? 0} icon={FileCheck2} glow="cyan" subtitle="Provider-recorded" /><HeroTile label="Active users" value={summary.active_users ?? 0} icon={Users} glow="sky" subtitle="Identity evidence" /><HeroTile label="Unlicensed active" value={summary.unlicensed_active ?? 0} icon={AlertTriangle} glow={(summary.unlicensed_active || 0) ? "amber" : "emerald"} subtitle="Review entitlement" /><HeroTile label="Disabled + licensed" value={summary.disabled_licensed ?? 0} icon={KeyRound} glow={(summary.disabled_licensed || 0) ? "amber" : "emerald"} subtitle="Potential reclaim" /><HeroTile label="Low-stock SKUs" value={summary.low_stock_skus ?? 0} icon={Activity} glow={(summary.low_stock_skus || 0) ? "rose" : "emerald"} subtitle="Two or fewer seats" /></div>
    <Card className="overflow-hidden border-amber-500/20"><CardHeader className="border-b border-amber-500/15"><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-200" />Licensing review queue</CardTitle><p className="mt-1 text-xs text-muted-foreground">These are evidence-led review signals. A technician still validates customer intent, contract coverage and billing treatment before changing a licence.</p></CardHeader><CardContent className="p-0">{(posture.attention || []).length === 0 ? <div className="p-6 text-center text-sm text-emerald-700 dark:text-emerald-100"><CheckCircle2 className="mx-auto mb-2 h-5 w-5" />No licence-review evidence is currently recorded.</div> : <Table><TableHeader><TableRow><TableHead>Signal</TableHead><TableHead>Subject</TableHead><TableHead>Evidence</TableHead><TableHead>Severity</TableHead></TableRow></TableHeader><TableBody>{posture.attention.map((item, index) => <TableRow key={`${item.id || item.subject}-${index}`}><TableCell><Badge variant="outline" className="capitalize">{String(item.kind || "evidence").replaceAll("_", " ")}</Badge></TableCell><TableCell className="font-medium">{item.subject}</TableCell><TableCell className="text-sm text-muted-foreground">{item.detail}</TableCell><TableCell><Badge variant="outline" className={severityClasses[item.severity] || severityClasses.medium}>{item.severity}</Badge></TableCell></TableRow>)}</TableBody></Table>}</CardContent></Card>
    <Card className="border-violet-500/15 bg-violet-500/[0.025]"><CardContent className="p-4"><p className="text-sm font-semibold">Safety boundary</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{posture.boundary}</p></CardContent></Card>
  </div>;
}

function StandardsTab({ headers }) {
  const [standards, setStandards] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [planning, setPlanning] = useState(null);
  const [planTenants, setPlanTenants] = useState([]);
  const [planSchedule, setPlanSchedule] = useState("168");
  const [savingPlan, setSavingPlan] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try { const [response, tenantsResponse] = await Promise.all([axios.get(`${API}/m365/standards`, { headers }), axios.get(`${API}/m365/tenants`, { headers })]); setStandards(response.data); setTenants(tenantsResponse.data || []); }
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
  const openPlan = (standard) => { setPlanning(standard); setPlanTenants(standard.assigned_tenants || []); setPlanSchedule(String(standard.schedule_hours || 168)); };
  const savePlan = async () => {
    if (!planning) return;
    const schedule = Number(planSchedule);
    if (!Number.isInteger(schedule) || schedule < 1 || schedule > 8760) { toast.error("Choose a review cadence between 1 and 8,760 hours"); return; }
    setSavingPlan(true);
    try {
      const response = await axios.put(`${API}/m365/standards/${planning.id}`, { enabled: true, assigned_tenants: planTenants, schedule_hours: schedule, actions: ["manual_review"] }, { headers });
      setStandards((current) => current.map((item) => item.id === planning.id ? response.data : item));
      setPlanning(null); toast.success("Guardrail review plan saved — no Microsoft policy changed");
    } catch (error) { toast.error(error.response?.data?.detail || "Unable to save guardrail plan"); }
    finally { setSavingPlan(false); }
  };
  return (
    <div className="space-y-3">
      <Card className="border-cyan-500/25 bg-cyan-500/[0.04]"><CardContent className="flex gap-3 p-4"><FileCheck2 className="mt-0.5 h-5 w-5 text-cyan-300" /><div><p className="text-sm font-semibold">Reference guardrails, not fabricated compliance</p><p className="mt-1 text-xs leading-5 text-muted-foreground">These are MSP-reviewed planning controls. Enabling one stores an internal plan only; it does not evaluate a tenant, apply a Microsoft policy, or claim remediation until a verified provider can prove the result.</p></div></CardContent></Card>
      {loading ? <div className="py-10 text-center text-sm text-muted-foreground">Loading reference guardrails...</div> : Object.entries(groups).map(([category, items]) => <Card key={category}><CardContent className="space-y-2 p-4"><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{category}</p>{items.map((standard) => <div className="flex items-center gap-3 rounded-lg border border-border/70 bg-muted/15 p-3" key={standard.id}><Switch checked={standard.enabled} onCheckedChange={() => togglePlan(standard)} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">{standard.name}</p><Badge variant="outline" className={severityClasses[standard.severity]}>{standard.severity}</Badge>{standard.enabled && <Badge variant="outline" className="border-cyan-500/30 text-cyan-100">planned</Badge>}</div><p className="mt-1 text-xs text-muted-foreground">{standard.description}</p>{standard.enabled && <p className="mt-1 text-[11px] text-cyan-700 dark:text-cyan-200">{standard.assigned_tenants?.length ? `${standard.assigned_tenants.length} tenant${standard.assigned_tenants.length === 1 ? "" : "s"} in scope` : "All eligible tenants when evidence is connected"} · review every {standard.schedule_hours || 168}h</p>}</div><div className="flex shrink-0 flex-col items-end gap-2"><Badge variant="outline" className="hidden border-zinc-700 text-[10px] text-muted-foreground sm:inline-flex">Reference only</Badge><Button size="sm" variant="outline" onClick={() => openPlan(standard)}>Plan scope</Button></div></div>)}</CardContent></Card>)}
      <Dialog open={Boolean(planning)} onOpenChange={(open) => !open && setPlanning(null)}><DialogContent className="max-w-xl"><DialogHeader><DialogTitle>Plan guardrail review</DialogTitle><DialogDescription>{planning?.name} becomes a Nexus review plan only. It will not evaluate or deploy a Microsoft policy until verified provider evidence and an approved executor are available.</DialogDescription></DialogHeader>{planning && <div className="space-y-4"><div className="grid gap-2"><Label htmlFor="guardrail-cadence">Review cadence (hours)</Label><Input id="guardrail-cadence" type="number" min="1" max="8760" value={planSchedule} onChange={(event) => setPlanSchedule(event.target.value)} /><p className="text-xs text-muted-foreground">168 hours is weekly. This controls review planning, not an automatic Microsoft change.</p></div><div><Label className="mb-2 block">Tenant scope</Label>{tenants.length === 0 ? <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-3 text-xs text-muted-foreground">No verified Microsoft tenants are available yet. Save this as an all-eligible-tenant plan and scope it after synchronisation.</div> : <div className="max-h-52 space-y-2 overflow-y-auto rounded-lg border border-border/70 p-3">{tenants.map((tenant) => <label key={tenant.id} className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-cyan-500" checked={planTenants.includes(tenant.id)} onChange={(event) => setPlanTenants((current) => event.target.checked ? [...current, tenant.id] : current.filter((id) => id !== tenant.id))} />{tenant.name || tenant.tenant_name || tenant.id}<span className="ml-auto text-xs text-muted-foreground">{tenant.default_domain || ""}</span></label>)}</div>}<p className="mt-2 text-xs text-muted-foreground">No selected tenants means all eligible tenants once verified evidence is available.</p></div></div>}<DialogFooter><Button variant="outline" onClick={() => setPlanning(null)}>Cancel</Button><Button onClick={savePlan} disabled={savingPlan}>{savingPlan ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ListChecks className="mr-1.5 h-4 w-4" />}Save review plan</Button></DialogFooter></DialogContent></Dialog>
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
  const [securityPosture, setSecurityPosture] = useState(null);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    try {
      const [mfaResponse, trendResponse, templateResponse, aitmResponse, postureResponse] = await Promise.all([
        axios.get(`${API}/m365/mfa-analytics`, { headers }), axios.get(`${API}/m365/secure-score/trend`, { headers }), axios.get(`${API}/m365/ca-templates`, { headers }), axios.get(`${API}/m365/aitm-page`, { headers }), axios.get(`${API}/m365/security/posture`, { headers }),
      ]);
      setMfa(mfaResponse.data); setTrend(trendResponse.data); setTemplates(templateResponse.data); setAitm(aitmResponse.data); setSecurityPosture(postureResponse.data);
    } catch (error) { toast.error("Microsoft 365 security references could not be loaded"); }
  }, [headers]);
  useEffect(() => { load(); }, [load]);
  const saveAitm = async () => { setSaving(true); try { const response = await axios.put(`${API}/m365/aitm-page`, aitm, { headers }); setAitm(response.data); toast.success("Manual reference snippet saved"); } catch { toast.error("Could not save the reference snippet"); } finally { setSaving(false); } };
  return <div className="grid gap-3 xl:grid-cols-2">
    <Card className="overflow-hidden border-rose-500/20 bg-rose-500/[0.025] xl:col-span-2"><CardHeader className="border-b border-rose-500/15"><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4 text-rose-600 dark:text-rose-200" />Defender, Entra risk & Conditional Access</CardTitle><p className="mt-1 text-xs text-muted-foreground">Microsoft evidence is correlated in Nexus Shield; this tenant view shows the control-plane posture without duplicating investigation or containment.</p></CardHeader><CardContent className="p-4">{securityPosture?.telemetry_available ? <><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><HeroTile label="Open alerts" value={securityPosture.summary?.open_alerts ?? 0} icon={AlertTriangle} glow={(securityPosture.summary?.open_alerts || 0) ? "amber" : "emerald"} subtitle="Defender evidence" /><HeroTile label="High severity" value={securityPosture.summary?.high_alerts ?? 0} icon={AlertTriangle} glow={(securityPosture.summary?.high_alerts || 0) ? "rose" : "emerald"} subtitle="Needs review" /><HeroTile label="Identity risks" value={securityPosture.summary?.identity_risks ?? 0} icon={KeyRound} glow={(securityPosture.summary?.identity_risks || 0) ? "rose" : "emerald"} subtitle="Entra evidence" /><HeroTile label="CA policies" value={securityPosture.summary?.conditional_access_policies ?? 0} icon={ShieldCheck} glow="cyan" subtitle="Provider-recorded" /><HeroTile label="Report-only" value={securityPosture.summary?.report_only_policies ?? 0} icon={FileCheck2} glow={(securityPosture.summary?.report_only_policies || 0) ? "amber" : "emerald"} subtitle="Review before enforce" /><HeroTile label="Risky devices" value={securityPosture.summary?.defender_devices_at_risk ?? 0} icon={MonitorSmartphone} glow={(securityPosture.summary?.defender_devices_at_risk || 0) ? "rose" : "emerald"} subtitle="Defender evidence" /></div><div className="mt-4 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => window.location.assign("/nexus-shield?tab=xdr")}><ShieldCheck className="mr-1.5 h-3.5 w-3.5" />Investigate in Shield XDR</Button><p className="self-center text-xs text-muted-foreground">{securityPosture.boundary}</p></div></> : <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-muted-foreground">No verified Defender, Entra risk or Conditional Access evidence has arrived. Nexus will not calculate a security posture from an untested tenant connection.</p><Button size="sm" variant="outline" onClick={() => window.location.assign("/control-plane?module=microsoft365&view=connections")}>Open Microsoft connection</Button></div>}</CardContent></Card>
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
  const [form, setForm] = useState({
    app_id: "",
    partner_tenant_id: "",
    app_secret: "",
    partner_center_account: "",
    admin_consent_redirect_uri: "",
    connection_strategy: "partner_center",
  });
  const [manual, setManual] = useState({
    tenant_id: "",
    tenant_name: "",
    default_domain: "",
    client_id: "",
    consent_method: "gdap",
  });
  const [onboarding, setOnboarding] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tenantQuery, setTenantQuery] = useState("");
  const [tenantFilter, setTenantFilter] = useState("all");

  const loadOnboarding = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/m365/onboarding`, { headers });
      setOnboarding(response.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Microsoft tenant onboarding could not be loaded");
    }
  }, [headers]);

  useEffect(() => { loadOnboarding(); }, [loadOnboarding]);

  const save = async () => {
    setBusy(true);
    try {
      const payload = Object.fromEntries(
        Object.entries(form).filter(([, value]) => typeof value === "string" && value.trim()),
      );
      const response = await axios.put(`${API}/m365/connection`, payload, { headers });
      setResult(response.data);
      setForm((current) => ({
        ...current,
        app_id: "",
        partner_tenant_id: "",
        app_secret: "",
        partner_center_account: "",
        admin_consent_redirect_uri: "",
      }));
      await loadOnboarding();
      onSaved?.();
      toast.success("Partner Center connection details saved");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to save Microsoft 365 connection details");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      const response = await axios.post(`${API}/m365/connection/test`, {}, { headers });
      setResult(response.data);
      if (response.data.ok) toast.success("Partner Center connection verified");
      else toast.warning(response.data.reason || "Partner Center needs attention");
      await loadOnboarding();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Connection check could not be completed");
    } finally {
      setBusy(false);
    }
  };

  const discover = async () => {
    setBusy(true);
    try {
      const response = await axios.post(`${API}/m365/onboarding/discover`, {}, { headers });
      toast.success(response.data.message || "Partner Center tenants discovered");
      setResult({ ok: true, message: `${response.data.discovered} tenants discovered; ${response.data.auto_mapped} mapped automatically.` });
      await loadOnboarding();
      onSaved?.();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Partner Center customer discovery failed");
    } finally {
      setBusy(false);
    }
  };

  const addTenant = async () => {
    if (!manual.tenant_id.trim() || !manual.tenant_name.trim()) {
      toast.error("Tenant ID and tenant name are required");
      return;
    }
    setBusy(true);
    try {
      await axios.post(`${API}/m365/onboarding/tenants`, manual, { headers });
      toast.success("Individual Microsoft tenant added");
      setManual({ tenant_id: "", tenant_name: "", default_domain: "", client_id: "", consent_method: "gdap" });
      await loadOnboarding();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Tenant could not be added");
    } finally {
      setBusy(false);
    }
  };

  const mapTenant = async (tenant, clientId) => {
    try {
      await axios.put(
        `${API}/m365/onboarding/tenants/${tenant.id}/mapping`,
        { client_id: clientId === "__none__" ? "" : clientId },
        { headers },
      );
      toast.success(clientId === "__none__" ? "Tenant mapping removed" : "Tenant mapped to Nexus client");
      await loadOnboarding();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Tenant mapping could not be changed");
    }
  };

  const summary = onboarding?.summary || {};
  const savedConnection = onboarding?.connection || connection || {};
  const filteredTenants = useMemo(() => {
    const term = tenantQuery.trim().toLowerCase();
    return (onboarding?.tenants || []).filter((tenant) => {
      const matchesSearch = !term || [
        tenant.tenant_name,
        tenant.tenant_id,
        tenant.default_domain,
        tenant.client_name,
        tenant.source,
      ].some((value) => String(value || "").toLowerCase().includes(term));
      const matchesFilter = tenantFilter === "all"
        || (tenantFilter === "needs_mapping" && !tenant.mapped)
        || (tenantFilter === "needs_access" && !tenant.graph_verified)
        || (tenantFilter === "ready" && tenant.mapped && tenant.graph_verified);
      return matchesSearch && matchesFilter;
    });
  }, [onboarding?.tenants, tenantFilter, tenantQuery]);

  return (
    <div className="space-y-4" data-testid="m365-multitenant-onboarding">
      <Card className="overflow-hidden border-cyan-500/25 bg-gradient-to-br from-cyan-500/[0.07] via-card to-emerald-500/[0.025]">
        <CardContent className="p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-cyan-300" />
                <p className="text-sm font-semibold">Multi-tenant Microsoft onboarding</p>
                <Badge variant="outline" className="border-cyan-500/30 text-cyan-100">Recommended</Badge>
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                Connect the MSP partner tenant once, discover the customer tenants visible in Partner Center, then map each tenant to its Nexus client. Add individual tenants only when they are outside your CSP relationship.
              </p>
              <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.05] p-3 text-xs leading-5 text-amber-100">
                Partner Center discovery identifies the tenants; it does not silently grant Microsoft Graph control. Nexus tracks GDAP or customer-admin consent separately and keeps actions blocked until access is verified.
              </p>
            </div>
            <div className="grid min-w-full grid-cols-2 gap-2 sm:grid-cols-5 xl:min-w-[470px]">
              <OnboardingMetric label="Discovered" value={summary.discovered ?? 0} />
              <OnboardingMetric label="Mapped" value={summary.mapped ?? 0} />
              <OnboardingMetric label="Graph ready" value={summary.graph_connected ?? 0} />
              <OnboardingMetric label="Need mapping" value={summary.needs_mapping ?? 0} />
              <OnboardingMetric label="Need access" value={summary.needs_access ?? 0} />
            </div>
          </div>
        </CardContent>
      </Card>

      <MicrosoftSyncReadiness headers={headers} />

      <div className="grid gap-4 2xl:grid-cols-[1.25fr_.75fr]">
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Cloud className="h-4 w-4 text-cyan-300" />
                <div>
                  <p className="text-sm font-semibold">Partner Center bulk discovery</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">One MSP connection, then import every eligible CSP customer tenant.</p>
                </div>
              </div>
              <Badge variant="outline" className={savedConnection?.last_test_status === "success" ? "border-emerald-500/30 text-emerald-200" : "border-amber-500/30 text-amber-100"}>
                {savedConnection?.last_test_status === "success" ? "Partner Center verified" : statusLabel(savedConnection?.mode)}
              </Badge>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label>MSP partner tenant ID</Label>
                <Input name="nexus-m365-partner-tenant-id" autoComplete="off" value={form.partner_tenant_id} onChange={(event) => setForm({ ...form, partner_tenant_id: event.target.value })} placeholder={savedConnection?.partner_tenant_id || "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"} />
              </div>
              <div>
                <Label>App (client) ID</Label>
                <Input name="nexus-m365-application-id" autoComplete="off" value={form.app_id} onChange={(event) => setForm({ ...form, app_id: event.target.value })} placeholder={savedConnection?.app_id || "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"} />
              </div>
              <div>
                <Label>Client secret</Label>
                <Input name="nexus-m365-client-secret" autoComplete="new-password" type="password" value={form.app_secret} onChange={(event) => setForm({ ...form, app_secret: event.target.value })} placeholder={savedConnection?.secret_configured ? "Stored — enter only to rotate" : "Enter client secret"} />
              </div>
              <div>
                <Label>Partner operator account</Label>
                <Input value={form.partner_center_account} onChange={(event) => setForm({ ...form, partner_center_account: event.target.value })} placeholder={savedConnection?.partner_center_account || "operations@example.com"} />
              </div>
              <div className="md:col-span-2">
                <Label>Admin-consent redirect URI (individual fallback)</Label>
                <Input value={form.admin_consent_redirect_uri} onChange={(event) => setForm({ ...form, admin_consent_redirect_uri: event.target.value })} placeholder={savedConnection?.admin_consent_redirect_uri || "https://nexus.example.com/api/m365/consent/callback"} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={save} disabled={busy}>
                {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Lock className="mr-1.5 h-3.5 w-3.5" />}
                Save connection
              </Button>
              <Button variant="outline" onClick={test} disabled={busy || !savedConnection?.secret_configured}>Test Partner Center</Button>
              <Button variant="outline" onClick={discover} disabled={busy || !savedConnection?.secret_configured}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />Discover customers
              </Button>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
              <span>Last connection test: {savedConnection?.last_tested_at ? new Date(savedConnection.last_tested_at).toLocaleString() : "Not tested"}</span>
              <span>Last customer discovery: {savedConnection?.last_discovery_at ? new Date(savedConnection.last_discovery_at).toLocaleString() : "Not run"}</span>
            </div>
            {result && (
              <div className={`rounded-lg border p-3 text-xs leading-5 ${result.ok ? "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-100" : "border-amber-500/30 bg-amber-500/[0.05] text-amber-100"}`}>
                <p className="font-medium">{result.message || result.reason || "Partner Center needs attention"}</p>
                {result.next_steps?.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5">{result.next_steps.map((step) => <li key={step}>{step}</li>)}</ul>}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardContent className="space-y-4 p-5">
            <div className="flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-emerald-300" />
              <div>
                <p className="text-sm font-semibold">Add one tenant</p>
                <p className="mt-0.5 text-xs text-muted-foreground">For non-CSP customers or staged onboarding.</p>
              </div>
            </div>
            <div className="grid gap-3">
              <div><Label>Tenant ID</Label><Input value={manual.tenant_id} onChange={(event) => setManual({ ...manual, tenant_id: event.target.value })} placeholder="Directory tenant GUID" /></div>
              <div><Label>Tenant name</Label><Input value={manual.tenant_name} onChange={(event) => setManual({ ...manual, tenant_name: event.target.value })} placeholder="Contoso Australia" /></div>
              <div><Label>Primary domain</Label><Input value={manual.default_domain} onChange={(event) => setManual({ ...manual, default_domain: event.target.value })} placeholder="contoso.com.au" /></div>
              <div>
                <Label>Nexus client</Label>
                <Select value={manual.client_id || "__none__"} onValueChange={(value) => setManual({ ...manual, client_id: value === "__none__" ? "" : value })}>
                  <SelectTrigger><SelectValue placeholder="Map later" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Map later</SelectItem>
                    {(onboarding?.clients || []).map((client) => <SelectItem value={client.id} key={client.id}>{client.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Access path</Label>
                <Select value={manual.consent_method} onValueChange={(value) => setManual({ ...manual, consent_method: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gdap">GDAP (recommended)</SelectItem>
                    <SelectItem value="customer_admin">Customer admin consent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button className="w-full" onClick={addTenant} disabled={busy}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />Add tenant for verification
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-col gap-2 border-b border-border/70 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold">Tenant onboarding registry</p>
              <p className="mt-1 text-xs text-muted-foreground">Discovery, client ownership and Microsoft access are deliberately separate, auditable states.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={loadOnboarding} disabled={busy} data-testid="m365-registry-refresh">
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />Refresh registry
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href="https://partner.microsoft.com/dashboard/commerce2/customers/list" target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />Open Partner Center
                </a>
              </Button>
            </div>
          </div>
          {onboarding?.tenants?.length > 0 && (
            <div className="grid gap-3 border-b border-border/70 bg-muted/[0.08] p-4 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-center">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={tenantQuery}
                  onChange={(event) => setTenantQuery(event.target.value)}
                  placeholder="Search tenant, domain, ID or linked client"
                  className="pl-9"
                  data-testid="m365-tenant-registry-search"
                />
              </div>
              <Select value={tenantFilter} onValueChange={setTenantFilter}>
                <SelectTrigger data-testid="m365-tenant-registry-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All tenants</SelectItem>
                  <SelectItem value="needs_mapping">Needs client mapping</SelectItem>
                  <SelectItem value="needs_access">Needs Microsoft access</SelectItem>
                  <SelectItem value="ready">Operationally ready</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground md:text-right">
                Showing <span className="font-medium text-foreground">{filteredTenants.length}</span> of {onboarding.tenants.length}
              </p>
            </div>
          )}
          {!onboarding ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading tenant registry</div>
          ) : onboarding.tenants.length === 0 ? (
            <div className="py-12 text-center">
              <Cloud className="mx-auto h-8 w-8 text-muted-foreground/60" />
              <p className="mt-3 text-sm font-medium">No Microsoft tenants onboarded</p>
              <p className="mt-1 text-xs text-muted-foreground">Save Partner Center credentials and discover customers, or add one tenant manually.</p>
            </div>
          ) : filteredTenants.length === 0 ? (
            <div className="py-12 text-center">
              <Search className="mx-auto h-8 w-8 text-muted-foreground/60" />
              <p className="mt-3 text-sm font-medium">No tenants match this view</p>
              <p className="mt-1 text-xs text-muted-foreground">Change the search or readiness filter to see other onboarding records.</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={() => { setTenantQuery(""); setTenantFilter("all"); }}>Reset registry filters</Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Nexus client</TableHead>
                  <TableHead>Microsoft access</TableHead>
                  <TableHead className="text-right">Next step</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTenants.map((tenant) => (
                  <TableRow key={tenant.id}>
                    <TableCell>
                      <p className="text-sm font-medium">{tenant.tenant_name || tenant.tenant_id}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{tenant.default_domain || tenant.tenant_id}</p>
                    </TableCell>
                    <TableCell><Badge variant="outline" className="capitalize">{String(tenant.source || "manual").replaceAll("_", " ")}</Badge></TableCell>
                    <TableCell className="min-w-[220px]">
                      <Select value={tenant.client_id || "__none__"} onValueChange={(value) => mapTenant(tenant, value)}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="Choose client" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Not mapped</SelectItem>
                          {(onboarding.clients || []).map((client) => <SelectItem value={client.id} key={client.id}>{client.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell><AccessBadge status={tenant.access_status} /></TableCell>
                    <TableCell className="text-right">
                      {tenant.access_status === "connected" ? (
                        <span className="inline-flex items-center text-xs text-emerald-200"><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Ready</span>
                      ) : tenant.access_status === "consent_required" ? (
                        savedConnection?.app_id && savedConnection?.admin_consent_redirect_uri ? (
                          <Button variant="outline" size="sm" asChild>
                            <a href={`https://login.microsoftonline.com/${encodeURIComponent(tenant.tenant_id)}/adminconsent?client_id=${encodeURIComponent(savedConnection.app_id)}&redirect_uri=${encodeURIComponent(savedConnection.admin_consent_redirect_uri)}`} target="_blank" rel="noreferrer">
                              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />Request consent
                            </a>
                          </Button>
                        ) : <span className="text-xs text-amber-200">Configure consent URI</span>
                      ) : (
                        <Button variant="outline" size="sm" asChild>
                          <a href="https://partner.microsoft.com/dashboard/commerce2/customers/list" target="_blank" rel="noreferrer">
                            <Link2 className="mr-1.5 h-3.5 w-3.5" />Review GDAP
                          </a>
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="border-cyan-500/20 bg-cyan-500/[0.035]">
        <CardContent className="p-5">
          <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-cyan-300" /><p className="text-sm font-semibold">Technician setup path</p></div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {[
              ["01", "Register the partner app", "Create the app in your MSP partner tenant and grant only required Partner Center permissions."],
              ["02", "Discover CSP customers", "Test the connection, then import the customer tenants Partner Center exposes."],
              ["03", "Map client ownership", "Link each Microsoft tenant to the canonical Nexus client record."],
              ["04", "Verify operational access", "Establish least-privilege GDAP or customer-admin consent before actions are enabled."],
            ].map(([number, title, copy]) => (
              <div key={number} className="rounded-xl border border-border/70 bg-black/10 p-4">
                <p className="text-xs font-semibold text-cyan-200">{number}</p>
                <p className="mt-2 text-sm font-medium">{title}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{copy}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-border/60 pt-4">
            <Button variant="outline" size="sm" asChild>
              <a href="https://learn.microsoft.com/en-us/partner-center/developer/set-up-api-access-in-partner-center" target="_blank" rel="noreferrer">
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />Partner Center API setup
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href="https://learn.microsoft.com/en-us/partner-center/developer/partner-center-authentication" target="_blank" rel="noreferrer">
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />Authentication guide
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href="https://learn.microsoft.com/en-us/partner-center/security/partner-security-requirements" target="_blank" rel="noreferrer">
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />Partner security requirements
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MicrosoftSyncReadiness({ headers }) {
  const [readiness, setReadiness] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { const response = await axios.get(`${API}/m365/sync/readiness`, { headers }); setReadiness(response.data); }
    catch (error) { toast.error(error.response?.data?.detail || "Microsoft collector readiness could not be loaded"); }
    finally { setLoading(false); }
  }, [headers]);
  useEffect(() => { load(); }, [load]);
  const stateClass = (status) => status === "evidence_active" ? "border-emerald-500/25 text-emerald-700 dark:text-emerald-200" : status === "ready_to_connect" ? "border-cyan-500/25 text-cyan-700 dark:text-cyan-200" : "border-amber-500/25 text-amber-700 dark:text-amber-200";
  const stateLabel = (status) => status === "evidence_active" ? "Evidence active" : status === "ready_to_connect" ? "Ready to connect" : "Connection required";
  return <Card className="border-violet-500/20 bg-violet-500/[0.025]" data-testid="m365-sync-readiness"><CardHeader className="border-b border-violet-500/15 pb-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-sm"><Activity className="h-4 w-4 text-violet-600 dark:text-violet-200" />Nexus Microsoft Collector</CardTitle><CardDescription className="mt-1">A least-privilege evidence plan for the Nexus 365 capabilities above. Each stream remains read-only until a separately approved action workflow is used.</CardDescription></div><Button size="sm" variant="outline" onClick={load} disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}<span className="sr-only">Refresh collector readiness</span></Button></div></CardHeader><CardContent className="p-4">{loading && !readiness ? <p className="py-5 text-center text-sm text-muted-foreground">Inspecting collector readiness…</p> : <><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">{(readiness?.streams || []).map((stream) => <div key={stream.id} className="rounded-xl border border-border/70 bg-background/55 p-3"><div className="flex items-start justify-between gap-2"><p className="text-sm font-medium">{stream.label}</p><Badge variant="outline" className={`shrink-0 text-[10px] ${stateClass(stream.status)}`}>{stateLabel(stream.status)}</Badge></div><p className="mt-2 text-2xl font-semibold text-violet-700 dark:text-violet-100">{stream.records || 0}</p><p className="mt-0.5 text-[10px] text-muted-foreground">verified records</p><div className="mt-3 flex flex-wrap gap-1">{(stream.permissions || []).map((permission) => <span key={permission} className="rounded-md border border-border/70 bg-muted/25 px-1.5 py-1 text-[9px] text-muted-foreground">{permission}</span>)}</div><p className="mt-3 text-[10px] leading-4 text-muted-foreground">Feeds: {(stream.feeds || []).join(" · ")}</p></div>)}</div><p className="mt-4 rounded-lg border border-violet-500/15 bg-violet-500/[0.035] p-3 text-xs leading-5 text-muted-foreground">{readiness?.boundary}</p></>}</CardContent></Card>;
}

function OnboardingMetric({ label, value }) {
  return (
    <div className="rounded-xl border border-border/70 bg-black/15 px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}

function AccessBadge({ status }) {
  if (status === "connected") return <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-100">Graph verified</Badge>;
  if (status === "consent_required") return <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-100">Admin consent required</Badge>;
  return <Badge variant="outline" className="border-cyan-500/30 bg-cyan-500/10 text-cyan-100">GDAP required</Badge>;
}
