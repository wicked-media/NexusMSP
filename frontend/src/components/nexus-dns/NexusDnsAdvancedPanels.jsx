import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Activity, AlertTriangle, AppWindow, ArrowRight, BarChart3, CheckCircle2, CircleDollarSign,
  Clock3, Database, FileSearch, Fingerprint, Gauge, Globe2, History, Laptop2, Network,
  PlayCircle, Radar, RefreshCw, Search, ServerCog, ShieldAlert, ShieldCheck, Sparkles,
  TestTube2, Users2, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import HeroTile from "@/components/HeroTile";

const riskTone = {
  high: "border-rose-500/25 bg-rose-500/10 text-rose-200",
  elevated: "border-orange-500/25 bg-orange-500/10 text-orange-200",
  watch: "border-amber-500/25 bg-amber-500/10 text-amber-200",
  low: "border-emerald-500/25 bg-emerald-500/10 text-emerald-200",
};

function formatDate(value) {
  if (!value) return "Not yet";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function SectionHeading({ icon: Icon, eyebrow, title, body, action }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-300">
          <Icon className="h-3.5 w-3.5" />{eyebrow}
        </p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{body}</p>
      </div>
      {action}
    </div>
  );
}

function HonestEmpty({ icon: Icon, title, body }) {
  return (
    <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.015] px-6 py-9 text-center">
      <Icon className="mx-auto h-7 w-7 text-sky-300" />
      <p className="mt-3 font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function SignalRow({ signal }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-white/[0.06] bg-black/10 p-3">
      <div className={`mt-0.5 flex h-7 min-w-7 items-center justify-center rounded-full text-xs font-semibold ${signal.points > 0 ? "bg-rose-500/15 text-rose-200" : "bg-emerald-500/15 text-emerald-200"}`}>
        {signal.points > 0 ? `+${signal.points}` : "0"}
      </div>
      <div>
        <p className="text-sm font-medium">{signal.label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{signal.evidence}</p>
      </div>
    </div>
  );
}

export default function NexusDnsAdvancedPanels({ clients = [], policies = [] }) {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({});
  const [lookalikes, setLookalikes] = useState([]);
  const [shadowApps, setShadowApps] = useState({ applications: [], unknown_count: 0, catalog_size: 0 });
  const [incidents, setIncidents] = useState([]);
  const [resolverMetrics, setResolverMetrics] = useState({ summary: {}, samples: [] });
  const [service, setService] = useState({ usage: {}, tiers: [] });
  const [responseCodes, setResponseCodes] = useState([]);
  const [tunnelling, setTunnelling] = useState({ findings: [] });
  const [unmanaged, setUnmanaged] = useState({ devices: [] });
  const [domain, setDomain] = useState("");
  const [domainClient, setDomainClient] = useState("");
  const [domainResult, setDomainResult] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [working, setWorking] = useState(false);
  const [shadowTarget, setShadowTarget] = useState(null);
  const [shadowDecision, setShadowDecision] = useState({ decision: "review", owner: "", reason: "", add_to_inventory: true });
  const [playbook, setPlaybook] = useState(null);
  const [toolkit, setToolkit] = useState({ domain: "", tool: "resolve", policy_id: "", client_id: "" });
  const [toolkitResult, setToolkitResult] = useState(null);
  const [privateZones, setPrivateZones] = useState([]);
  const [zoneOpen, setZoneOpen] = useState(false);
  const [zoneForm, setZoneForm] = useState({ client_id: "", name: "", zone: "", records: [], enabled: true });

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [summaryRes, lookalikeRes, shadowRes, incidentRes, metricRes, serviceRes, codeRes, tunnelRes, unmanagedRes, privateZoneRes] = await Promise.all([
        axios.get(`${API}/nexus-dns/intelligence/summary`, { headers }),
        axios.get(`${API}/nexus-dns/lookalikes`, { headers }),
        axios.get(`${API}/nexus-dns/shadow-apps`, { headers }),
        axios.get(`${API}/nexus-dns/incidents`, { headers }),
        axios.get(`${API}/nexus-dns/resolver-metrics`, { headers }),
        axios.get(`${API}/nexus-dns/service`, { headers }),
        axios.get(`${API}/nexus-dns/response-codes`, { headers }),
        axios.get(`${API}/nexus-dns/tunnelling`, { headers }),
        axios.get(`${API}/nexus-dns/unmanaged-devices`, { headers }),
        axios.get(`${API}/nexus-dns/private-zones`, { headers }),
      ]);
      setSummary(summaryRes.data || {});
      setLookalikes(lookalikeRes.data || []);
      setShadowApps(shadowRes.data || { applications: [] });
      setIncidents(incidentRes.data || []);
      setResolverMetrics(metricRes.data || { summary: {}, samples: [] });
      setService(serviceRes.data || { usage: {}, tiers: [] });
      setResponseCodes(codeRes.data || []);
      setTunnelling(tunnelRes.data || { findings: [] });
      setUnmanaged(unmanagedRes.data || { devices: [] });
      setPrivateZones(privateZoneRes.data || []);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Unable to load advanced Nexus DNS controls");
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  const analyseDomain = async () => {
    if (!domain.trim()) return toast.error("Enter a domain to analyse");
    setWorking(true);
    try {
      const response = await axios.post(`${API}/nexus-dns/intelligence/analyse`, { domain, client_id: domainClient }, { headers });
      setDomainResult(response.data);
      const timelineResponse = await axios.get(`${API}/nexus-dns/domains/${encodeURIComponent(response.data.domain)}/timeline`, { headers });
      setTimeline(timelineResponse.data?.events || []);
      toast.success("Domain intelligence refreshed");
      load(true);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Unable to analyse the domain");
    } finally {
      setWorking(false);
    }
  };

  const scanLookalikes = async () => {
    if (!domain.trim()) return toast.error("Enter the protected domain first");
    setWorking(true);
    try {
      const response = await axios.post(`${API}/nexus-dns/lookalikes/scan`, { domain, client_id: domainClient }, { headers });
      toast.success(`${response.data.active_count || 0} active lookalike candidate(s) found`);
      load(true);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Unable to scan lookalike domains");
    } finally {
      setWorking(false);
    }
  };

  const saveShadowDecision = async () => {
    if (!shadowTarget || shadowDecision.reason.trim().length < 4) return toast.error("Add a decision reason");
    setWorking(true);
    try {
      await axios.post(`${API}/nexus-dns/shadow-apps/${shadowTarget.id}/decision`, shadowDecision, { headers });
      toast.success("SaaS decision saved and audited");
      setShadowTarget(null);
      load(true);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Unable to save the SaaS decision");
    } finally {
      setWorking(false);
    }
  };

  const previewPlaybook = async incident => {
    setWorking(true);
    try {
      const response = await axios.post(`${API}/nexus-dns/incidents/${incident.id}/playbook/preview`, { domain: incident.domain }, { headers });
      setPlaybook(response.data);
      toast.success("Containment preview generated; no action was executed");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Unable to preview containment");
    } finally {
      setWorking(false);
    }
  };

  const runToolkit = async () => {
    if (!toolkit.domain.trim()) return toast.error("Enter a domain");
    setWorking(true);
    try {
      const response = await axios.post(`${API}/nexus-dns/toolkit/run`, toolkit, { headers });
      setToolkitResult(response.data);
      toast.success("Diagnostic completed without changing the endpoint");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "DNS diagnostic failed");
    } finally {
      setWorking(false);
    }
  };

  const createPrivateZone = async () => {
    if (!zoneForm.client_id || !zoneForm.name.trim() || !zoneForm.zone.trim()) return toast.error("Choose a client and enter the private application and zone");
    setWorking(true);
    try {
      await axios.post(`${API}/nexus-dns/private-zones`, zoneForm, { headers });
      toast.success("Tenant-isolated private zone created");
      setZoneOpen(false);
      setZoneForm({ client_id: "", name: "", zone: "", records: [], enabled: true });
      load(true);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Unable to create the private zone");
    } finally {
      setWorking(false);
    }
  };

  if (loading) {
    return <TabsContent value="intelligence"><div className="flex h-64 items-center justify-center"><RefreshCw className="h-6 w-6 animate-spin text-sky-300" /></div></TabsContent>;
  }

  return (
    <>
      <TabsContent value="intelligence" className="space-y-5">
        <SectionHeading
          icon={Fingerprint}
          eyebrow="Explainable domain intelligence"
          title="Know why a domain is risky"
          body="Analyse live DNS, registration, certificate, record volatility and similarity evidence. Missing signals remain visibly unavailable instead of being replaced with invented confidence."
          action={<Button variant="outline" onClick={() => load()}><RefreshCw className="mr-2 h-4 w-4" />Refresh intelligence</Button>}
        />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <HeroTile label="Analysed domains" value={summary.analysed_domains || 0} icon={Globe2} glow="sky" subtitle="Transparent scoring" />
          <HeroTile label="High risk" value={summary.high_risk_domains || 0} icon={ShieldAlert} glow={summary.high_risk_domains ? "rose" : "zinc"} subtitle="70 or higher" />
          <HeroTile label="Watch list" value={summary.watch_domains || 0} icon={Radar} glow="amber" subtitle="Requires context" />
          <HeroTile label="Lookalikes" value={summary.active_lookalikes || 0} icon={FileSearch} glow={summary.active_lookalikes ? "orange" : "zinc"} subtitle="Active candidates" />
          <HeroTile label="Threat domains" value={summary.threat_domains_30d || 0} icon={Activity} glow="violet" subtitle="Last 30 days" />
        </div>
        <Card className="border-sky-500/15">
          <CardContent className="p-5">
            <div className="grid gap-3 lg:grid-cols-[1fr_240px_auto_auto]">
              <div className="space-y-2"><Label>Domain or URL</Label><Input value={domain} onChange={event => setDomain(event.target.value)} placeholder="example.com" onKeyDown={event => { if (event.key === "Enter") analyseDomain(); }} /></div>
              <div className="space-y-2"><Label>Client context</Label><Select value={domainClient || "none"} onValueChange={value => setDomainClient(value === "none" ? "" : value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No client selected</SelectItem>{clients.map(client => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}</SelectContent></Select></div>
              <Button className="self-end" onClick={analyseDomain} disabled={working}><Search className="mr-2 h-4 w-4" />Analyse domain</Button>
              <Button className="self-end" variant="outline" onClick={scanLookalikes} disabled={working}><Radar className="mr-2 h-4 w-4" />Scan lookalikes</Button>
            </div>
          </CardContent>
        </Card>
        {domainResult && (
          <div className="grid gap-4 xl:grid-cols-[.8fr_1.2fr]">
            <Card className="overflow-hidden">
              <CardHeader className="border-b border-white/[0.06] bg-white/[0.02]">
                <div className="flex items-center justify-between gap-3">
                  <div><CardTitle className="font-mono text-lg">{domainResult.domain}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{domainResult.recommended_action}</p></div>
                  <div className={`flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-2xl border ${riskTone[domainResult.risk_level] || riskTone.low}`}><span className="text-2xl font-bold">{domainResult.risk_score}</span><span className="text-[10px] uppercase tracking-wider">{domainResult.risk_level}</span></div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 p-5">
                {(domainResult.signals || []).length ? domainResult.signals.map(signal => <SignalRow key={signal.key} signal={signal} />) : <HonestEmpty icon={CheckCircle2} title="No deterministic risk signal" body="The current checks found no scored signal. This is not a guarantee of safety; normal monitoring continues." />}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-white/[0.03] p-3"><p className="text-muted-foreground">Registration age</p><p className="mt-1 font-medium">{domainResult.registration?.age_days == null ? "Unavailable" : `${domainResult.registration.age_days} days`}</p></div>
                  <div className="rounded-lg bg-white/[0.03] p-3"><p className="text-muted-foreground">TLS certificate</p><p className="mt-1 font-medium">{domainResult.certificate?.present ? `${domainResult.certificate.age_days ?? "Unknown"} days old` : "Unavailable"}</p></div>
                  <div className="rounded-lg bg-white/[0.03] p-3"><p className="text-muted-foreground">Affected tenants</p><p className="mt-1 font-medium">{domainResult.affected_tenant_count || 0}</p></div>
                  <div className="rounded-lg bg-white/[0.03] p-3"><p className="text-muted-foreground">DNSSEC key</p><p className="mt-1 font-medium">{domainResult.dnssec_present ? "Observed" : "Not observed"}</p></div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><History className="h-5 w-5 text-sky-300" />Nexus Domain Timeline</CardTitle></CardHeader>
              <CardContent>
                {timeline.length ? timeline.slice(0, 15).map(item => <div key={`${item.id}-${item.occurred_at}`} className="relative border-l border-sky-500/20 pb-5 pl-5 last:pb-0"><span className="absolute -left-1.5 top-1 h-3 w-3 rounded-full border-2 border-background bg-sky-400" /><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{String(item.event_type || "event").replaceAll("_", " ")}</Badge><span className="text-xs text-muted-foreground">{formatDate(item.occurred_at)}</span></div><p className="mt-2 text-sm">{item.summary}</p></div>) : <HonestEmpty icon={History} title="Timeline starts here" body="Queries, DNS changes, risk analyses, lookalikes, access requests, tickets and containment evidence for this domain will collect on one line of sight." />}
              </CardContent>
            </Card>
          </div>
        )}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Radar className="h-5 w-5 text-orange-300" />Active lookalike candidates</CardTitle></CardHeader>
          <CardContent>{lookalikes.length ? lookalikes.map(item => <div key={item.id} className="flex flex-col gap-2 border-b border-white/[0.06] py-3 last:border-0 sm:flex-row sm:items-center"><Badge variant="outline" className={item.active ? riskTone.high : riskTone.low}>{item.active ? "Active" : "Not observed"}</Badge><div className="flex-1"><p className="font-mono text-sm">{item.domain}</p><p className="text-xs text-muted-foreground">{item.reason} of {item.protected_domain}</p></div><span className="text-xs text-muted-foreground">{formatDate(item.checked_at)}</span></div>) : <HonestEmpty icon={Radar} title="No active lookalikes recorded" body="Scan a protected client domain to check realistic substitution and adjacent-label candidates with live DNS evidence." />}</CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="discovery" className="space-y-5">
        <SectionHeading icon={AppWindow} eyebrow="SaaS and unmanaged discovery" title="Turn DNS evidence into an application inventory" body="Discover cloud applications from authenticated query evidence, assign an owner and make an audited approve, block or review decision. Network mode also identifies devices that do not run an agent." />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <HeroTile label="Discovered apps" value={shadowApps.applications?.length || 0} icon={AppWindow} glow="sky" subtitle={`${shadowApps.catalog_size || 0} known patterns`} />
          <HeroTile label="Needs decision" value={shadowApps.unknown_count || 0} icon={AlertTriangle} glow={shadowApps.unknown_count ? "amber" : "zinc"} subtitle="Owner not confirmed" />
          <HeroTile label="Unmanaged devices" value={unmanaged.devices?.length || 0} icon={Network} glow="violet" subtitle={unmanaged.status === "ready" ? "Network mode evidence" : "Awaiting network mode"} />
          <HeroTile label="Tunnel candidates" value={tunnelling.findings?.length || 0} icon={Activity} glow={tunnelling.findings?.length ? "rose" : "zinc"} subtitle={`${tunnelling.events_analysed || 0} events analysed`} />
        </div>
        <div className="grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><AppWindow className="h-5 w-5 text-sky-300" />Application decisions</CardTitle></CardHeader>
            <CardContent>{shadowApps.applications?.length ? shadowApps.applications.map(app => <div key={app.id} className="rounded-xl border border-white/[0.07] p-4 [&+&]:mt-3"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{app.category}</Badge><h3 className="font-semibold">{app.name}</h3><Badge variant="outline" className={app.decision === "block" ? riskTone.high : app.decision === "approve" ? riskTone.low : riskTone.watch}>{app.decision}</Badge><span className="ml-auto text-xs text-muted-foreground">{app.query_count} queries</span></div><div className="mt-3 grid grid-cols-3 gap-2 text-xs text-muted-foreground"><span>{app.client_count} clients</span><span>{app.device_count} devices</span><span>Owner: {app.owner || "Unassigned"}</span></div><Button size="sm" variant="outline" className="mt-3" onClick={() => { setShadowTarget(app); setShadowDecision({ decision: app.decision || "review", owner: app.owner || "", reason: "", add_to_inventory: Boolean(app.inventory_linked) }); }}>Review decision<ArrowRight className="ml-2 h-3.5 w-3.5" /></Button></div>) : <HonestEmpty icon={AppWindow} title="No authenticated SaaS usage yet" body="Nexus DNS will not manufacture a Shadow IT list. Applications appear only when endpoint or resolver query evidence matches a known service." />}</CardContent>
          </Card>
          <div className="space-y-4">
            <Card><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Activity className="h-5 w-5 text-rose-300" />Tunnelling analysis</CardTitle></CardHeader><CardContent>{tunnelling.findings?.length ? tunnelling.findings.slice(0, 8).map(item => <div key={item.id} className="border-b border-white/[0.06] py-3 last:border-0"><div className="flex items-center justify-between gap-2"><span className="font-mono text-sm">{item.domain}</span><Badge variant="outline" className={riskTone[item.score >= 75 ? "high" : "watch"]}>{item.score}/100</Badge></div><p className="mt-1 text-xs text-muted-foreground">{item.query_count} queries · entropy {item.label_entropy} · {item.long_queries} long queries</p></div>) : <HonestEmpty icon={Activity} title="No tunnel candidate claimed" body={tunnelling.note || "Query-volume and entropy evidence is required before a candidate can appear."} />}</CardContent></Card>
            <Card><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Network className="h-5 w-5 text-violet-300" />Unmanaged devices</CardTitle></CardHeader><CardContent>{unmanaged.devices?.length ? unmanaged.devices.slice(0, 8).map(item => <div key={item.id} className="border-b border-white/[0.06] py-3 last:border-0"><p className="text-sm font-medium">{item.device_type}</p><p className="mt-1 font-mono text-xs text-muted-foreground">{item.identity} · {item.query_count} queries</p></div>) : <HonestEmpty icon={Network} title="Awaiting network-mode telemetry" body={unmanaged.note || "Enable network mode at a controlled site to identify IoT and other non-agent devices."} />}</CardContent></Card>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="incidents" className="space-y-5">
        <SectionHeading icon={ShieldAlert} eyebrow="Campaign correlation" title="One incident, not hundreds of duplicate alerts" body="Cluster DNS evidence by domain across clients, users and endpoints. Preview the complete containment plan before any approval-gated change can run." />
        {incidents.length ? incidents.map(incident => (
          <Card key={incident.id} className="border-rose-500/15">
            <CardContent className="p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rose-500/10"><ShieldAlert className="h-5 w-5 text-rose-300" /></div>
                <div className="flex-1"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className={riskTone.high}>{incident.severity}</Badge><span className="font-mono font-medium">{incident.domain}</span><span className="text-xs text-muted-foreground">{incident.event_count} related events</span></div><p className="mt-2 text-sm">{incident.title}</p><p className="mt-1 text-xs text-muted-foreground">Patient zero: {incident.patient_zero} · {incident.clients.length} clients · {incident.endpoints.length} endpoints · {incident.users.length} users</p></div>
                <Button onClick={() => previewPlaybook(incident)} disabled={working}><PlayCircle className="mr-2 h-4 w-4" />Preview containment</Button>
              </div>
            </CardContent>
          </Card>
        )) : <HonestEmpty icon={ShieldCheck} title="No clustered DNS incident" body="High and critical query events will be grouped into one operational incident with patient-zero context, affected tenants and a safe previewable response plan." />}
      </TabsContent>

      <TabsContent value="toolkit" className="space-y-5">
        <SectionHeading icon={TestTube2} eyebrow="Technician diagnostics" title="Troubleshoot DNS without leaving NexusMSP" body="Resolve records, compare public resolvers, inspect CNAME chains, check DNSSEC evidence or explain a policy result. Diagnostics are recorded and never alter an endpoint." />
        <Card className="border-sky-500/15"><CardContent className="p-5"><div className="grid gap-3 lg:grid-cols-[1fr_190px_230px_auto]"><div className="space-y-2"><Label>Domain</Label><Input value={toolkit.domain} onChange={event => setToolkit(current => ({ ...current, domain: event.target.value }))} placeholder="example.com" onKeyDown={event => { if (event.key === "Enter") runToolkit(); }} /></div><div className="space-y-2"><Label>Diagnostic</Label><Select value={toolkit.tool} onValueChange={value => setToolkit(current => ({ ...current, tool: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="resolve">Resolve records</SelectItem><SelectItem value="compare">Compare resolvers</SelectItem><SelectItem value="cname">Trace CNAME</SelectItem><SelectItem value="dnssec">DNSSEC evidence</SelectItem><SelectItem value="policy">Policy explanation</SelectItem><SelectItem value="categorise">Categorise domain</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label>Policy context</Label><Select value={toolkit.policy_id || "none"} onValueChange={value => setToolkit(current => ({ ...current, policy_id: value === "none" ? "" : value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No policy selected</SelectItem>{policies.map(policy => <SelectItem key={policy.id} value={policy.id}>{policy.name}</SelectItem>)}</SelectContent></Select></div><Button className="self-end" onClick={runToolkit} disabled={working}><TestTube2 className="mr-2 h-4 w-4" />Run diagnostic</Button></div></CardContent></Card>
        {toolkitResult && <Card><CardHeader><div className="flex items-center justify-between"><CardTitle className="flex items-center gap-2 text-lg"><FileSearch className="h-5 w-5 text-sky-300" />{toolkitResult.tool.replaceAll("_", " ")} · {toolkitResult.domain}</CardTitle><Badge variant="outline">{toolkitResult.duration_ms}ms</Badge></div></CardHeader><CardContent><pre className="max-h-[430px] overflow-auto rounded-xl border border-white/[0.06] bg-black/25 p-4 text-xs leading-relaxed text-slate-300">{JSON.stringify(toolkitResult.result, null, 2)}</pre><p className="mt-3 text-xs text-muted-foreground">Run by {toolkitResult.ran_by} at {formatDate(toolkitResult.ran_at)}. Endpoint changed: no.</p></CardContent></Card>}
        <div className="grid gap-4 xl:grid-cols-[.9fr_1.1fr]">
          <Card><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Gauge className="h-5 w-5 text-emerald-300" />Resolver performance</CardTitle></CardHeader><CardContent>{resolverMetrics.status === "awaiting_probe" ? <HonestEmpty icon={Gauge} title="Awaiting trusted probe data" body={resolverMetrics.note} /> : <div className="grid grid-cols-2 gap-3"><div className="rounded-lg bg-white/[0.03] p-4"><p className="text-xs text-muted-foreground">Average latency</p><p className="mt-2 text-2xl font-semibold">{resolverMetrics.summary?.latency_ms}ms</p></div><div className="rounded-lg bg-white/[0.03] p-4"><p className="text-xs text-muted-foreground">Cache hit rate</p><p className="mt-2 text-2xl font-semibold">{resolverMetrics.summary?.cache_hit_rate}%</p></div><div className="rounded-lg bg-white/[0.03] p-4"><p className="text-xs text-muted-foreground">Upstream failures</p><p className="mt-2 text-2xl font-semibold">{resolverMetrics.summary?.upstream_failures}</p></div><div className="rounded-lg bg-white/[0.03] p-4"><p className="text-xs text-muted-foreground">Fallbacks</p><p className="mt-2 text-2xl font-semibold">{resolverMetrics.summary?.fallbacks}</p></div></div>}</CardContent></Card>
          <Card><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><ServerCog className="h-5 w-5 text-violet-300" />Response explanation</CardTitle></CardHeader><CardContent className="grid gap-2 sm:grid-cols-2">{responseCodes.map(code => <div key={code.key} className="rounded-lg border border-white/[0.06] p-3"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{code.rcode}</Badge>{code.ede != null && <Badge variant="outline">EDE {code.ede}</Badge>}<span className="text-sm font-medium">{code.label}</span></div><p className="mt-2 text-xs text-muted-foreground">{code.explanation}</p></div>)}</CardContent></Card>
        </div>
        <Card>
          <CardHeader><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle className="flex items-center gap-2 text-lg"><Network className="h-5 w-5 text-cyan-300" />Private applications and split DNS</CardTitle><p className="mt-1 text-sm text-muted-foreground">Create client-bound private namespaces. The client ID is the tenant-isolation key, so another tenant can never resolve this zone through policy inheritance.</p></div><Button onClick={() => setZoneOpen(true)}><Network className="mr-2 h-4 w-4" />Add private zone</Button></div></CardHeader>
          <CardContent>{privateZones.length ? <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-sm"><thead><tr className="border-b border-white/[0.07] text-left text-xs text-muted-foreground"><th className="pb-3">Application</th><th className="pb-3">Private zone</th><th className="pb-3">Client</th><th className="pb-3">Records</th><th className="pb-3">State</th></tr></thead><tbody>{privateZones.map(zone => <tr key={zone.id} className="border-b border-white/[0.05] last:border-0"><td className="py-3 font-medium">{zone.name}</td><td className="py-3 font-mono text-xs">{zone.zone}</td><td className="py-3 text-muted-foreground">{zone.client_name}</td><td className="py-3 text-muted-foreground">{zone.records?.length || 0}</td><td className="py-3"><Badge variant="outline" className={zone.enabled ? riskTone.low : riskTone.watch}>{zone.enabled ? "Enabled" : "Paused"}</Badge></td></tr>)}</tbody></table></div> : <HonestEmpty icon={Network} title="No private zones configured" body="Add an internal application, Azure private resource, VPN namespace, remote desktop gateway or site appliance only after selecting the owning client." />}</CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="service" className="space-y-5">
        <SectionHeading icon={CircleDollarSign} eyebrow="Product and usage" title="Package Nexus DNS as a managed service" body="Keep the operational controls in one product while exposing clear tiers, billable quantities and reconciliation evidence for agreements and recurring invoices." />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <HeroTile label="Selected tier" value={service.tier || "essentials"} icon={ShieldCheck} glow="sky" subtitle="Saved in Safety & privacy" />
          <HeroTile label="Billing model" value={service.billing_model || "endpoint"} icon={CircleDollarSign} glow="emerald" subtitle="Endpoint, user or site" />
          <HeroTile label="Billable quantity" value={service.billable_quantity || 0} icon={BarChart3} glow="violet" subtitle={service.reconciliation_status?.replaceAll("_", " ")} />
          <HeroTile label="Active sites" value={service.usage?.site || 0} icon={Network} glow="cyan" subtitle={`${service.usage?.endpoint || 0} endpoints · ${service.usage?.user || 0} users`} />
        </div>
        <div className="grid gap-4 xl:grid-cols-3">
          {service.tiers?.map(tier => <Card key={tier.id} className={tier.id === service.tier ? "border-sky-500/30 bg-sky-500/[0.035]" : ""}><CardHeader><div className="flex items-center justify-between gap-2"><CardTitle className="text-lg">{tier.name}</CardTitle>{tier.id === service.tier && <Badge variant="outline" className={riskTone.low}>Current</Badge>}</div></CardHeader><CardContent className="space-y-3">{tier.features.map(feature => <div key={feature} className="flex items-start gap-2 text-sm"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" />{feature}</div>)}</CardContent></Card>)}
        </div>
        <Card><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Database className="h-5 w-5 text-sky-300" />Billing evidence</CardTitle></CardHeader><CardContent><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-lg bg-white/[0.03] p-4"><p className="text-xs text-muted-foreground">Enrolled endpoints</p><p className="mt-2 text-2xl font-semibold">{service.usage?.endpoint || 0}</p></div><div className="rounded-lg bg-white/[0.03] p-4"><p className="text-xs text-muted-foreground">Observed users</p><p className="mt-2 text-2xl font-semibold">{service.usage?.user || 0}</p></div><div className="rounded-lg bg-white/[0.03] p-4"><p className="text-xs text-muted-foreground">Protected sites</p><p className="mt-2 text-2xl font-semibold">{service.usage?.site || 0}</p></div></div><p className="mt-4 text-sm text-muted-foreground">The selected billing model produces the billable quantity. Agreement mapping and recurring-invoice reconciliation should use this attested usage snapshot rather than a manually entered count.</p></CardContent></Card>
      </TabsContent>

      <Dialog open={zoneOpen} onOpenChange={setZoneOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Network className="h-5 w-5 text-cyan-300" />Add tenant-isolated private zone</DialogTitle><DialogDescription>Bind the namespace to the correct client before any private record is added. This form creates the zone boundary; records can then be reviewed inside that client context.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Owning client</Label><Select value={zoneForm.client_id || "none"} onValueChange={value => setZoneForm(current => ({ ...current, client_id: value === "none" ? "" : value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Select client</SelectItem>{clients.map(client => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>Private application name</Label><Input value={zoneForm.name} onChange={event => setZoneForm(current => ({ ...current, name: event.target.value }))} placeholder="Accounting RDP Gateway" /></div>
            <div className="space-y-2"><Label>Private DNS zone</Label><Input value={zoneForm.zone} onChange={event => setZoneForm(current => ({ ...current, zone: event.target.value }))} placeholder="corp.example.internal" /></div>
            <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/[0.04] p-3 text-xs text-cyan-100/80">The stored tenant isolation key is the selected client ID. Cross-client fallback is not permitted.</div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setZoneOpen(false)}>Cancel</Button><Button onClick={createPrivateZone} disabled={working}><Network className="mr-2 h-4 w-4" />Create private zone</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(shadowTarget)} onOpenChange={open => { if (!open) setShadowTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><AppWindow className="h-5 w-5 text-sky-300" />Review {shadowTarget?.name}</DialogTitle><DialogDescription>Make an accountable SaaS decision and optionally add it to the client application inventory.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>Decision</Label><Select value={shadowDecision.decision} onValueChange={value => setShadowDecision(current => ({ ...current, decision: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="approve">Approve</SelectItem><SelectItem value="block">Block</SelectItem><SelectItem value="review">Keep under review</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label>Business owner</Label><Input value={shadowDecision.owner} onChange={event => setShadowDecision(current => ({ ...current, owner: event.target.value }))} placeholder="Department or person" /></div></div>
            <div className="space-y-2"><Label>Decision reason</Label><Textarea rows={4} value={shadowDecision.reason} onChange={event => setShadowDecision(current => ({ ...current, reason: event.target.value }))} placeholder="Business purpose, risk acceptance or reason for blocking" /></div>
            <button type="button" onClick={() => setShadowDecision(current => ({ ...current, add_to_inventory: !current.add_to_inventory }))} className="flex w-full items-center justify-between rounded-lg border border-white/[0.07] p-3 text-left"><span><span className="block text-sm font-medium">Add to application inventory</span><span className="text-xs text-muted-foreground">Link the decision to the client operational record.</span></span>{shadowDecision.add_to_inventory ? <CheckCircle2 className="h-5 w-5 text-emerald-300" /> : <XCircle className="h-5 w-5 text-muted-foreground" />}</button>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShadowTarget(null)}>Cancel</Button><Button onClick={saveShadowDecision} disabled={working}>Save audited decision</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(playbook)} onOpenChange={open => { if (!open) setPlaybook(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-rose-300" />Containment simulation</DialogTitle><DialogDescription>{playbook?.domain}. This is a preview only; no policy, endpoint or identity action has run.</DialogDescription></DialogHeader>
          <div className="max-h-[62vh] space-y-2 overflow-y-auto pr-1">
            {playbook?.steps?.map(step => <div key={step.order} className="flex items-start gap-3 rounded-lg border border-white/[0.07] p-3"><div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-500/10 text-xs font-semibold text-sky-200">{step.order}</div><div className="flex-1"><p className="text-sm font-medium">{step.action}</p><p className="mt-1 text-xs text-muted-foreground">{step.owner} · {step.approval ? "Technician approval required" : "Runs after approved workflow starts"}</p></div><Badge variant="outline" className={step.available ? riskTone.low : riskTone.watch}>{step.available ? "Available" : "Setup needed"}</Badge></div>)}
            {playbook?.configuration_gaps?.length > 0 && <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.045] p-4"><p className="text-sm font-medium text-amber-100">Configuration gaps</p>{playbook.configuration_gaps.map(gap => <p key={gap} className="mt-1 text-xs text-amber-100/70">{gap}</p>)}</div>}
          </div>
          <DialogFooter><Button onClick={() => setPlaybook(null)}>Close simulation</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
