import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Activity, AlertTriangle, AppWindow, ArrowRight, CheckCircle2, CircleDollarSign, Clock,
  FileCheck2, Filter, Fingerprint, Gauge, Globe2, HelpCircle, History, Laptop2,
  LockKeyhole, Plus, Radar,
  RefreshCw, RotateCcw, Search, ServerCog, Settings2, ShieldAlert, ShieldCheck, Sparkles,
  TestTube2, TicketPlus, TriangleAlert, WifiOff, XCircle, Zap,
} from "lucide-react";
import { toast } from "sonner";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";
import NexusDnsAdvancedPanels from "@/components/nexus-dns/NexusDnsAdvancedPanels";
import NexusDnsRolloutPanel from "@/components/nexus-dns/NexusDnsRolloutPanel";

const tabValues = ["command", "activity", "policies", "coverage", "rollouts", "intelligence", "discovery", "incidents", "domains", "toolkit", "service", "safety"];
const defaultCategories = {
  malware: "block",
  phishing: "block",
  command_and_control: "block",
  newly_registered_domains: "audit",
  dynamic_dns: "audit",
  cryptomining: "block",
  adult: "allow",
  gambling: "allow",
  social_media: "allow",
  streaming: "allow",
  generative_ai: "allow",
  file_sharing: "audit",
};
const emptyPolicy = {
  name: "", description: "", scope_type: "client", scope_id: "", scope_name: "",
  mode: "audit", categories: defaultCategories, allow_domains: [], block_domains: [],
  schedule: "always", enabled: true, access_conditions: {
    managed_device: false, bitlocker_required: false, maximum_risk: "any", locations: [], roles: [],
  }, minimum_device_score: 0, uncertain_domain_action: "audit",
};
const statusClasses = {
  healthy: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
  warning: "border-amber-500/25 bg-amber-500/10 text-amber-300",
  critical: "border-rose-500/25 bg-rose-500/10 text-rose-300",
  block: "border-rose-500/25 bg-rose-500/10 text-rose-300",
  audit: "border-amber-500/25 bg-amber-500/10 text-amber-300",
  allow: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
};

function formatDate(value) {
  if (!value) return "Not yet";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function SectionTitle({ icon: Icon, eyebrow, title, description, action }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-300"><Icon className="h-3.5 w-3.5" />{eyebrow}</p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

function EmptyState({ icon: Icon, title, body, action }) {
  return (
    <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.015] px-6 py-10 text-center">
      <Icon className="mx-auto h-7 w-7 text-sky-300" />
      <p className="mt-3 font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export default function DnsMonitorPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get("tab");
  const activeTab = tabValues.includes(requestedTab) ? requestedTab : "command";
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState(null);
  const [policies, setPolicies] = useState([]);
  const [events, setEvents] = useState([]);
  const [coverage, setCoverage] = useState({ devices: [], summary: {} });
  const [settings, setSettings] = useState(null);
  const [domains, setDomains] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [clients, setClients] = useState([]);
  const [audit, setAudit] = useState([]);
  const [rolloutData, setRolloutData] = useState({ deployments: [], summary: {} });
  const [exceptionData, setExceptionData] = useState({ exceptions: [], summary: {} });
  const [search, setSearch] = useState("");
  const [eventAction, setEventAction] = useState("all");
  const [eventSeverity, setEventSeverity] = useState("all");
  const [policyOpen, setPolicyOpen] = useState(false);
  const [policyForm, setPolicyForm] = useState(emptyPolicy);
  const [simulatePolicy, setSimulatePolicy] = useState(null);
  const [simulation, setSimulation] = useState({
    domain: "", category: "phishing",
    context: { managed_device: false, bitlocker_enabled: false, device_score: 0, identity_risk: "low", location: "", role: "" },
  });
  const [simulationResult, setSimulationResult] = useState(null);
  const [forecastPolicy, setForecastPolicy] = useState(null);
  const [forecastResult, setForecastResult] = useState(null);
  const [deployOpen, setDeployOpen] = useState(false);
  const [deployment, setDeployment] = useState({ all_eligible: true, device_ids: [], mode: "visibility", ring: "canary", reason: "Initial Nexus DNS visibility rollout" });
  const [preview, setPreview] = useState(null);
  const [domainOpen, setDomainOpen] = useState(false);
  const [domainForm, setDomainForm] = useState({ domain: "", client_id: "", check_interval_minutes: "60" });
  const [emergencyReason, setEmergencyReason] = useState("");
  const [eventActionTarget, setEventActionTarget] = useState(null);
  const [eventActionMode, setEventActionMode] = useState("ticket");
  const [eventActionReason, setEventActionReason] = useState("");
  const [eventAllowMinutes, setEventAllowMinutes] = useState("30");
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async (quiet = false) => {
    // Auth is hydrated by the app shell. Avoid issuing an initial unauthenticated
    // request (and a misleading error toast) while that token is still loading.
    if (!token) return;
    if (!quiet) setLoading(true);
    try {
      const [overviewRes, policyRes, eventRes, coverageRes, settingsRes, domainRes, alertRes, clientRes, auditRes, rolloutRes, exceptionRes] = await Promise.all([
        axios.get(`${API}/nexus-dns/overview`, { headers }),
        axios.get(`${API}/nexus-dns/policies`, { headers }),
        axios.get(`${API}/nexus-dns/events`, { headers }),
        axios.get(`${API}/nexus-dns/coverage`, { headers }),
        axios.get(`${API}/nexus-dns/settings`, { headers }),
        axios.get(`${API}/dns-monitor/domains`, { headers }),
        axios.get(`${API}/dns-monitor/alerts`, { headers }),
        axios.get(`${API}/clients`, { headers }),
        axios.get(`${API}/nexus-dns/audit?limit=100`, { headers }),
        axios.get(`${API}/nexus-dns/deployments?limit=100`, { headers }),
        axios.get(`${API}/nexus-dns/exceptions?include_expired=true`, { headers }),
      ]);
      setOverview(overviewRes.data);
      setPolicies(policyRes.data || []);
      setEvents(eventRes.data || []);
      setCoverage(coverageRes.data || { devices: [], summary: {} });
      setSettings(settingsRes.data);
      setDomains(domainRes.data || []);
      setAlerts(alertRes.data || []);
      setClients(clientRes.data || []);
      setAudit(auditRes.data || []);
      setRolloutData(rolloutRes.data || { deployments: [], summary: {} });
      setExceptionData(exceptionRes.data || { exceptions: [], summary: {} });
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Unable to load Nexus DNS");
    } finally {
      setLoading(false);
    }
  }, [headers, token]);

  useEffect(() => {
    if (token) fetchData();
  }, [fetchData, token]);

  const switchTab = value => {
    const next = new URLSearchParams(params);
    next.set("tab", value);
    setParams(next, { replace: true });
  };

  const filteredEvents = useMemo(() => events.filter(event => {
    const haystack = `${event.domain || ""} ${event.client_name || ""} ${event.device_name || ""} ${event.user_name || ""}`.toLowerCase();
    return (!search.trim() || haystack.includes(search.trim().toLowerCase()))
      && (eventAction === "all" || event.action === eventAction)
      && (eventSeverity === "all" || event.severity === eventSeverity);
  }), [events, search, eventAction, eventSeverity]);

  const submitPolicy = async () => {
    if (!policyForm.name.trim()) return toast.error("Give the policy a clear name");
    setSaving(true);
    try {
      await axios.post(`${API}/nexus-dns/policies`, policyForm, { headers });
      toast.success("Draft DNS policy created");
      setPolicyOpen(false);
      setPolicyForm(emptyPolicy);
      fetchData(true);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Unable to create policy");
    } finally { setSaving(false); }
  };

  const runSimulation = async () => {
    if (!simulatePolicy) return;
    setSaving(true);
    try {
      const response = await axios.post(`${API}/nexus-dns/policies/${simulatePolicy.id}/simulate`, simulation, { headers });
      setSimulationResult(response.data);
      toast.success("Simulation completed without changing DNS");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Simulation failed");
    } finally { setSaving(false); }
  };

  const runForecast = async policy => {
    setSaving(true);
    try {
      const response = await axios.post(`${API}/nexus-dns/policies/${policy.id}/forecast`, { days: 7 }, { headers });
      setForecastPolicy(policy);
      setForecastResult(response.data);
      toast.success("Seven-day impact forecast generated without changing DNS");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Unable to forecast policy impact");
    } finally { setSaving(false); }
  };

  const previewDeployment = async () => {
    setSaving(true);
    try {
      const response = await axios.post(`${API}/nexus-dns/deployments/preview`, deployment, { headers });
      setPreview(response.data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Unable to preview deployment");
    } finally { setSaving(false); }
  };

  const queueDeployment = async () => {
    setSaving(true);
    try {
      const response = await axios.post(`${API}/nexus-dns/deployments`, deployment, { headers });
      toast.success(`${response.data.device_count} endpoint configuration(s) queued`);
      setDeployOpen(false);
      setPreview(null);
      switchTab("rollouts");
      fetchData(true);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Unable to queue deployment");
    } finally { setSaving(false); }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      const payload = {
        deployment_mode: settings.deployment_mode,
        resolver_endpoints: settings.resolver_endpoints || [],
        dns_transport: settings.dns_transport,
        fail_behavior: settings.fail_behavior,
        retention_days: Number(settings.retention_days),
        domain_redaction: settings.domain_redaction,
        regional_storage: settings.regional_storage,
        consent_notice: settings.consent_notice,
        bypass_detection: settings.bypass_detection,
        local_policy_cache: settings.local_policy_cache,
        canary_ring_percent: Number(settings.canary_ring_percent),
        network_mode_enabled: settings.network_mode_enabled,
        logging_profile: settings.logging_profile,
        zero_trust_enabled: settings.zero_trust_enabled,
        lookalike_monitoring: settings.lookalike_monitoring,
        service_tier: settings.service_tier,
        billing_model: settings.billing_model,
        custom_block_page_enabled: settings.custom_block_page_enabled,
        block_page_title: settings.block_page_title,
        block_page_message: settings.block_page_message,
        block_page_support_url: settings.block_page_support_url,
        block_page_request_access: settings.block_page_request_access,
        block_page_require_mfa: settings.block_page_require_mfa,
      };
      const response = await axios.put(`${API}/nexus-dns/settings`, payload, { headers });
      setSettings(response.data);
      toast.success("Nexus DNS safety settings saved");
      fetchData(true);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Unable to save settings");
    } finally { setSaving(false); }
  };

  const testResolvers = async () => {
    try {
      const response = await axios.post(`${API}/nexus-dns/resolvers/test`, { resolver_endpoints: settings.resolver_endpoints || [] }, { headers });
      const invalid = response.data.results?.some(item => !item.syntax_valid);
      toast[invalid ? "error" : "success"](invalid ? "One or more resolver endpoints are invalid" : "Endpoint format valid; trusted health attestation is still required");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Resolver test failed");
    }
  };

  const emergencyDisable = async () => {
    try {
      await axios.post(`${API}/nexus-dns/emergency/disable`, { reason: emergencyReason }, { headers });
      toast.success("Emergency visibility rollback queued");
      setEmergencyReason("");
      fetchData(true);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Emergency disable failed");
    }
  };

  const addDomain = async () => {
    const client = clients.find(item => item.id === domainForm.client_id);
    if (!domainForm.domain.trim()) return toast.error("Enter a domain");
    try {
      await axios.post(`${API}/dns-monitor/domains`, {
        domain: domainForm.domain.trim().toLowerCase(),
        client_id: client?.id || "",
        client_name: client?.name || "",
        check_interval_minutes: Number(domainForm.check_interval_minutes),
      }, { headers });
      toast.success("Domain baseline added");
      setDomainOpen(false);
      setDomainForm({ domain: "", client_id: "", check_interval_minutes: "60" });
      fetchData(true);
    } catch (error) { toast.error(error?.response?.data?.detail || "Unable to add domain"); }
  };

  const submitEventAction = async () => {
    if (!eventActionTarget) return;
    setSaving(true);
    try {
      if (eventActionMode === "allow") {
        await axios.post(`${API}/nexus-dns/events/${eventActionTarget.id}/temporary-allow`, {
          minutes: Number(eventAllowMinutes),
          reason: eventActionReason,
        }, { headers });
        toast.success("Expiring DNS exception created");
      } else {
        const response = await axios.post(`${API}/nexus-dns/events/${eventActionTarget.id}/create-ticket`, {
          notes: eventActionReason,
        }, { headers });
        toast.success(`Incident ${response.data.ticket_number} created`);
      }
      setEventActionTarget(null);
      setEventActionReason("");
      fetchData(true);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Unable to complete the DNS action");
    } finally { setSaving(false); }
  };

  const checkDomain = async id => {
    try {
      await axios.post(`${API}/dns-monitor/check/${id}`, {}, { headers });
      toast.success("DNS record check recorded");
      fetchData(true);
    } catch { toast.error("DNS check failed"); }
  };

  const acknowledgeAlert = async id => {
    try {
      await axios.post(`${API}/dns-monitor/alerts/${id}/acknowledge`, {}, { headers });
      toast.success("DNS record alert acknowledged");
      fetchData(true);
    } catch { toast.error("Unable to acknowledge alert"); }
  };

  if (loading || !overview || !settings) {
    return <div className="flex h-72 items-center justify-center"><RefreshCw className="h-7 w-7 animate-spin text-sky-300" /></div>;
  }

  const metrics = overview.metrics || {};
  const openRecordAlerts = alerts.filter(item => !item.acknowledged);

  return (
    <div className="space-y-6" data-testid="nexus-dns-page">
      <OperationalPageHeader
        eyebrow="Nexus protective DNS"
        title="Nexus DNS"
        description="Multi-tenant DNS visibility, explainable policy and staged endpoint protection through the Nexus Agent—with safety gates before enforcement."
        icon={Radar}
        tone="sky"
        statusLabel={overview.edge_ready ? "Resolver edge configured" : "Resolver setup required"}
        statusTone={overview.edge_ready ? "emerald" : "amber"}
        actions={(
          <>
            <Button variant="outline" onClick={() => navigate("/help/nexus-dns-setup")}><HelpCircle className="mr-2 h-4 w-4" />Setup guide</Button>
            <Button variant="outline" onClick={() => fetchData()}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
            <Button onClick={() => { setDeployOpen(true); setPreview(null); }} data-testid="deploy-nexus-dns"><Zap className="mr-2 h-4 w-4" />Deploy protection</Button>
          </>
        )}
      />

      <div className={`rounded-xl border p-4 ${overview.edge_ready ? "border-emerald-500/25 bg-emerald-500/[0.055]" : "border-amber-500/25 bg-amber-500/[0.055]"}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            {overview.edge_ready ? <ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-300" /> : <TriangleAlert className="mt-0.5 h-5 w-5 text-amber-300" />}
            <div>
              <p className="font-medium">{overview.edge_ready ? "Resolver edge configured; staged protection is available" : "Control plane ready; live DNS enforcement is intentionally locked"}</p>
              <p className="mt-1 text-sm text-muted-foreground">{overview.edge_ready ? "Use the canary ring first. Verified resolver evidence—not configuration alone—drives block reporting." : "Add a regional DoH or DoT resolver, complete trusted health validation, then start with visibility and audit modes."}</p>
            </div>
          </div>
          <Button variant="outline" onClick={() => switchTab("safety")}><ServerCog className="mr-2 h-4 w-4" />Configure edge</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <HeroTile label="Eligible endpoints" value={metrics.eligible_endpoints || 0} icon={Laptop2} glow="sky" subtitle={`${metrics.online_endpoints || 0} online now`} />
        <HeroTile label="DNS enrolled" value={metrics.dns_enrolled_endpoints || 0} icon={ShieldCheck} glow="emerald" subtitle="Agent policy channel" />
        <HeroTile label="Active policies" value={metrics.active_policies || 0} icon={FileCheck2} glow="violet" subtitle="Hierarchical controls" />
        <HeroTile label="Verified blocks" value={metrics.verified_blocks || 0} icon={ShieldAlert} glow={metrics.verified_blocks ? "rose" : "zinc"} subtitle="Resolver-attested only" />
        <HeroTile label="Needs attention" value={(metrics.open_incidents || 0) + (metrics.record_alerts || 0)} icon={AlertTriangle} glow={(metrics.open_incidents || metrics.record_alerts) ? "amber" : "zinc"} subtitle="Threats + record changes" />
      </div>

      <Tabs value={activeTab} onValueChange={switchTab} className="space-y-5">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 bg-muted/60 p-1.5 sm:grid-cols-3 lg:grid-cols-6">
          <TabsTrigger value="command" className="gap-2 py-2.5"><Gauge className="h-4 w-4" />Command</TabsTrigger>
          <TabsTrigger value="activity" className="gap-2 py-2.5"><Activity className="h-4 w-4" />Query activity</TabsTrigger>
          <TabsTrigger value="policies" className="gap-2 py-2.5"><ShieldCheck className="h-4 w-4" />Policies</TabsTrigger>
          <TabsTrigger value="coverage" className="gap-2 py-2.5"><Laptop2 className="h-4 w-4" />Coverage</TabsTrigger>
          <TabsTrigger value="rollouts" className="gap-2 py-2.5"><History className="h-4 w-4" />Rollouts</TabsTrigger>
          <TabsTrigger value="intelligence" className="gap-2 py-2.5"><Fingerprint className="h-4 w-4" />Intelligence</TabsTrigger>
          <TabsTrigger value="discovery" className="gap-2 py-2.5"><AppWindow className="h-4 w-4" />Discovery</TabsTrigger>
          <TabsTrigger value="incidents" className="gap-2 py-2.5"><ShieldAlert className="h-4 w-4" />Incidents</TabsTrigger>
          <TabsTrigger value="domains" className="gap-2 py-2.5"><Globe2 className="h-4 w-4" />Domains</TabsTrigger>
          <TabsTrigger value="toolkit" className="gap-2 py-2.5"><TestTube2 className="h-4 w-4" />Toolkit</TabsTrigger>
          <TabsTrigger value="service" className="gap-2 py-2.5"><CircleDollarSign className="h-4 w-4" />Service</TabsTrigger>
          <TabsTrigger value="safety" className="gap-2 py-2.5"><Settings2 className="h-4 w-4" />Safety & privacy</TabsTrigger>
        </TabsList>

        <TabsContent value="command" className="space-y-5">
          <div className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
            <Card className="border-sky-500/15">
              <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Radar className="h-5 w-5 text-sky-300" />Protection readiness</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {overview.readiness?.map(item => (
                  <div key={item.key} className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-black/10 p-3">
                    {item.ready ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-300" /> : <XCircle className="h-5 w-5 shrink-0 text-amber-300" />}
                    <div className="min-w-0 flex-1"><p className="text-sm font-medium">{item.label}</p><p className="text-xs text-muted-foreground">{item.detail}</p></div>
                    <Badge variant="outline" className={item.ready ? statusClasses.allow : statusClasses.audit}>{item.ready ? "Ready" : "Action needed"}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Sparkles className="h-5 w-5 text-violet-300" />Correlation advantage</CardTitle></CardHeader>
              <CardContent className="space-y-4 text-sm">
                <p className="text-muted-foreground">Nexus DNS is designed to correlate a domain with the client, user, endpoint, Defender posture, recent change, ticket and assigned policy—not just produce a block list.</p>
                {["Device and signed-in user context", "Client policy and contract scope", "Defender and Nexus Shield posture", "Ticket creation with preserved evidence"].map(item => <div key={item} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-sky-300" />{item}</div>)}
                <Button variant="outline" className="w-full" onClick={() => switchTab("activity")}>Open evidence stream<ArrowRight className="ml-2 h-4 w-4" /></Button>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardContent className="p-5">
              <SectionTitle icon={AlertTriangle} eyebrow="Live attention" title="Recent security evidence" description="Only authenticated resolver events appear as verified DNS activity. Record-monitor alerts remain available in the Domains tab." />
              <div className="mt-4">
                {events.length ? events.slice(0, 5).map(event => (
                  <div key={event.id} className="flex flex-col gap-2 border-b border-white/[0.06] py-3 last:border-0 sm:flex-row sm:items-center">
                    <Badge variant="outline" className={statusClasses[event.action] || ""}>{event.action}</Badge>
                    <span className="font-mono text-sm">{event.domain}</span>
                    <span className="flex-1 text-xs text-muted-foreground">{event.client_name || "Unlinked client"} · {event.device_name || "Unknown endpoint"}</span>
                    <span className="text-xs text-muted-foreground">{formatDate(event.observed_at)}</span>
                  </div>
                )) : <EmptyState icon={Radar} title="No authenticated query events yet" body="This is expected before a resolver edge and endpoint policy are deployed. NexusMSP will not fabricate DNS blocks to make the dashboard look active." action={<Button variant="outline" onClick={() => switchTab("coverage")}>Review endpoint coverage</Button>} />}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity" className="space-y-4">
          <SectionTitle icon={Activity} eyebrow="Explainable protection" title="Query activity and incident evidence" description="Search by domain, client, endpoint or user. Every block should answer what matched, which policy acted and what the technician can safely do next." />
          <Card><CardContent className="p-4">
            <div className="grid gap-3 md:grid-cols-[1fr_190px_190px]">
              <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search domain, client, endpoint or user…" /></div>
              <Select value={eventAction} onValueChange={setEventAction}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All decisions</SelectItem><SelectItem value="block">Blocked</SelectItem><SelectItem value="audit">Audited</SelectItem><SelectItem value="allow">Allowed</SelectItem></SelectContent></Select>
              <Select value={eventSeverity} onValueChange={setEventSeverity}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All severities</SelectItem><SelectItem value="critical">Critical</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent></Select>
            </div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            {filteredEvents.length ? filteredEvents.map(event => (
              <div key={event.id} className="rounded-lg border border-white/[0.07] p-4 [&+&]:mt-3">
                <div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className={statusClasses[event.action] || ""}>{event.action}</Badge><Badge variant="outline">{event.severity}</Badge><span className="font-mono font-medium">{event.domain}</span><span className="ml-auto text-xs text-muted-foreground">{formatDate(event.observed_at)}</span></div>
                <p className="mt-3 text-sm">{event.reason || "Resolver policy decision"}</p>
                <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3"><span>Client: {event.client_name || "Unlinked"}</span><span>Endpoint: {event.device_name || "Unknown"}</span><span>User: {event.user_name || "Not reported"}</span></div>
                <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => { setEventActionTarget(event); setEventActionMode("allow"); setEventActionReason(""); }}><Clock className="mr-1.5 h-3.5 w-3.5" />Temporary allow</Button><Button size="sm" variant="outline" onClick={() => { setEventActionTarget(event); setEventActionMode("ticket"); setEventActionReason(`Investigate the Nexus DNS ${event.action} decision for ${event.domain}.`); }}><TicketPlus className="mr-1.5 h-3.5 w-3.5" />Create incident ticket</Button></div>
              </div>
            )) : <EmptyState icon={Filter} title="No events match this view" body={events.length ? "Clear the search or filters to see the authenticated evidence stream." : "Query activity will appear after a resolver edge and endpoint policy begin reporting signed evidence."} />}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="policies" className="space-y-4">
          <SectionTitle icon={ShieldCheck} eyebrow="Layered policy" title="Protect at the right scope" description="Policy precedence runs from global to MSP, client, site, group, user and device. More specific rules win and every decision remains explainable." action={<Button onClick={() => setPolicyOpen(true)}><Plus className="mr-2 h-4 w-4" />New policy</Button>} />
          <div className="grid gap-4 xl:grid-cols-2">
            {policies.map(policy => (
              <Card key={policy.id} className="border-white/[0.08]">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{policy.name}</h3><Badge variant="outline" className={statusClasses[policy.mode] || ""}>{policy.mode}</Badge><Badge variant="outline">{policy.delivery_status || "draft"}</Badge></div><p className="mt-2 text-sm text-muted-foreground">{policy.description}</p></div>
                    <ShieldCheck className="h-5 w-5 shrink-0 text-sky-300" />
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-white/[0.03] p-3"><p className="text-muted-foreground">Scope</p><p className="mt-1 font-medium capitalize">{policy.scope_type} · {policy.scope_name || "Inherited"}</p></div><div className="rounded-lg bg-white/[0.03] p-3"><p className="text-muted-foreground">Schedule</p><p className="mt-1 font-medium capitalize">{policy.schedule || "Always"}</p></div></div>
                  <div className="mt-4 flex flex-wrap gap-1.5">{Object.entries(policy.categories || {}).filter(([, action]) => action !== "allow").slice(0, 7).map(([category, action]) => <Badge key={category} variant="outline" className={statusClasses[action] || ""}>{category.replaceAll("_", " ")} · {action}</Badge>)}</div>
                  <div className="mt-4 flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => { setSimulatePolicy(policy); setSimulationResult(null); }}><TestTube2 className="mr-2 h-4 w-4" />Simulate</Button><Button variant="outline" size="sm" onClick={() => runForecast(policy)} disabled={saving}><History className="mr-2 h-4 w-4" />Forecast 7 days</Button><Button size="sm" onClick={() => { setDeployment(value => ({ ...value, mode: policy.mode === "block" ? "audit" : policy.mode })); setDeployOpen(true); setPreview(null); }}><Zap className="mr-2 h-4 w-4" />Stage rollout</Button></div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="coverage" className="space-y-4">
          <SectionTitle icon={Laptop2} eyebrow="Existing Nexus Agent" title="Endpoint and network coverage" description="Endpoint mode uses the installed Nexus Agent. Network mode is separately controlled for appliances, guest devices and equipment without an agent." action={<Button onClick={() => { setDeployOpen(true); setPreview(null); }}><Zap className="mr-2 h-4 w-4" />Deploy</Button>} />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <HeroTile label="Agent records" value={coverage.summary?.total || 0} icon={Laptop2} glow="sky" subtitle="Active registrations" />
            <HeroTile label="Windows eligible" value={coverage.summary?.eligible || 0} icon={CheckCircle2} glow="emerald" subtitle="Endpoint mode" />
            <HeroTile label="Online now" value={coverage.summary?.online || 0} icon={Activity} glow="cyan" subtitle="Last 3 minutes" />
            <HeroTile label="DNS enrolled" value={coverage.summary?.enrolled || 0} icon={ShieldCheck} glow="violet" subtitle="Configuration staged" />
          </div>
          <Card><CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] text-sm"><thead><tr className="border-b border-white/[0.08] text-left text-xs text-muted-foreground"><th className="p-4">Endpoint</th><th className="p-4">Client</th><th className="p-4">Agent</th><th className="p-4">DNS mode</th><th className="p-4">Bypass</th><th className="p-4">Last seen</th></tr></thead>
                <tbody>{coverage.devices?.map(device => <tr key={device.device_id} className="border-b border-white/[0.05] last:border-0"><td className="p-4"><div className="flex items-center gap-2">{device.online ? <Activity className="h-4 w-4 text-emerald-300" /> : <WifiOff className="h-4 w-4 text-zinc-500" />}<div><p className="font-medium">{device.hostname}</p><p className="text-xs text-muted-foreground">{device.eligible ? "Eligible" : "Unsupported OS"}</p></div></div></td><td className="p-4 text-muted-foreground">{device.client_name || "Unlinked"}</td><td className="p-4 font-mono text-xs">{device.agent_version || "Unknown"}</td><td className="p-4"><Badge variant="outline" className={device.dns_enrolled ? statusClasses.audit : ""}>{device.mode.replaceAll("_", " ")}</Badge></td><td className="p-4 text-muted-foreground">{device.bypass_status.replaceAll("_", " ")}</td><td className="p-4 text-xs text-muted-foreground">{formatDate(device.last_seen)}</td></tr>)}</tbody>
              </table>
            </div>
            {!coverage.devices?.length && <div className="p-4"><EmptyState icon={Laptop2} title="No Nexus Agent endpoints found" body="Generate a client-bound installer from Managed Assets, enrol a Windows endpoint, then return here to stage DNS visibility." /></div>}
          </CardContent></Card>
        </TabsContent>

        <NexusDnsRolloutPanel
          rolloutData={rolloutData}
          exceptionData={exceptionData}
          headers={headers}
          onRefresh={fetchData}
          onDeploy={() => { setDeployOpen(true); setPreview(null); }}
        />

        <TabsContent value="domains" className="space-y-4">
          <SectionTitle icon={Globe2} eyebrow="Authoritative DNS watch" title="Domain records and change evidence" description="Preserved from the original DNS monitor: baseline A, MX, TXT, NS and other records, link domains to clients and acknowledge unexpected changes." action={<Button onClick={() => setDomainOpen(true)}><Plus className="mr-2 h-4 w-4" />Add domain</Button>} />
          {openRecordAlerts.length > 0 && <Card className="border-rose-500/20"><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><AlertTriangle className="h-5 w-5 text-rose-300" />Record changes requiring review</CardTitle></CardHeader><CardContent className="space-y-2">{openRecordAlerts.map(alert => <div key={alert.id} className="flex flex-col gap-3 rounded-lg border border-white/[0.07] p-3 sm:flex-row sm:items-center"><Badge variant="outline" className={statusClasses[alert.severity] || ""}>{alert.severity}</Badge><div className="flex-1"><p className="text-sm font-medium">{alert.domain} · {alert.record_type}</p><p className="text-xs text-muted-foreground">{alert.message}</p></div><Button size="sm" variant="outline" onClick={() => acknowledgeAlert(alert.id)}>Acknowledge</Button></div>)}</CardContent></Card>}
          <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-sm"><thead><tr className="border-b border-white/[0.08] text-left text-xs text-muted-foreground"><th className="p-4">Domain</th><th className="p-4">Client</th><th className="p-4">Status</th><th className="p-4">Records</th><th className="p-4">Interval</th><th className="p-4">Last checked</th><th className="p-4">Action</th></tr></thead><tbody>{domains.map(domain => <tr key={domain.id} className="border-b border-white/[0.05] last:border-0"><td className="p-4 font-mono font-medium">{domain.domain}</td><td className="p-4 text-muted-foreground">{domain.client_name || "Unlinked"}</td><td className="p-4"><Badge variant="outline" className={statusClasses[domain.status] || ""}>{domain.status || "unknown"}</Badge></td><td className="p-4"><div className="flex flex-wrap gap-1">{Object.keys(domain.records || {}).map(record => <Badge key={record} variant="outline">{record}</Badge>)}</div></td><td className="p-4 text-muted-foreground">{domain.check_interval_minutes}m</td><td className="p-4 text-xs text-muted-foreground">{formatDate(domain.last_checked)}</td><td className="p-4"><Button size="sm" variant="outline" onClick={() => checkDomain(domain.id)}><Activity className="mr-1.5 h-3.5 w-3.5" />Check</Button></td></tr>)}</tbody></table></div></CardContent></Card>
        </TabsContent>

        <NexusDnsAdvancedPanels clients={clients} policies={policies} />

        <TabsContent value="safety" className="space-y-4">
          <SectionTitle icon={LockKeyhole} eyebrow="Safety before enforcement" title="Resolver edge, privacy and emergency control" description="Configure Australian data handling, fail behaviour, policy caching and staged rings. A saved endpoint is not considered healthy until trusted probe evidence is returned." action={<Button onClick={saveSettings} disabled={saving}><FileCheck2 className="mr-2 h-4 w-4" />Save settings</Button>} />
          <div className="grid gap-4 xl:grid-cols-2">
            <Card><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><ServerCog className="h-5 w-5 text-sky-300" />Regional resolver edge</CardTitle></CardHeader><CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>Transport</Label><Select value={settings.dns_transport} onValueChange={value => setSettings(current => ({ ...current, dns_transport: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="doh">DNS over HTTPS (DoH)</SelectItem><SelectItem value="dot">DNS over TLS (DoT)</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label>Deployment mode</Label><Select value={settings.deployment_mode} onValueChange={value => setSettings(current => ({ ...current, deployment_mode: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="visibility">Visibility only</SelectItem><SelectItem value="audit">Audit policy</SelectItem><SelectItem value="block" disabled={!settings.resolver_endpoints?.length}>Blocking (requires edge)</SelectItem></SelectContent></Select></div></div>
              <div className="space-y-2"><Label>Resolver endpoints · one per line</Label><Textarea rows={4} value={(settings.resolver_endpoints || []).join("\n")} onChange={event => setSettings(current => ({ ...current, resolver_endpoints: event.target.value.split("\n").map(value => value.trim()).filter(Boolean) }))} placeholder={settings.dns_transport === "doh" ? "https://dns-au.example.com/dns-query" : "dns-au.example.com:853"} /></div>
              <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={testResolvers}><TestTube2 className="mr-2 h-4 w-4" />Validate configuration</Button><Badge variant="outline" className={settings.edge_ready ? statusClasses.allow : statusClasses.audit}>{settings.edge_ready ? "Edge configured" : "Health attestation pending"}</Badge></div>
            </CardContent></Card>
            <Card><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><RotateCcw className="h-5 w-5 text-emerald-300" />Resilience and rollout</CardTitle></CardHeader><CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>Resolver failure</Label><Select value={settings.fail_behavior} onValueChange={value => setSettings(current => ({ ...current, fail_behavior: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="open">Fail open · preserve internet</SelectItem><SelectItem value="closed">Fail closed · strict protection</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label>Canary ring</Label><Select value={String(settings.canary_ring_percent)} onValueChange={value => setSettings(current => ({ ...current, canary_ring_percent: Number(value) }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">1% of endpoints</SelectItem><SelectItem value="5">5% of endpoints</SelectItem><SelectItem value="10">10% of endpoints</SelectItem><SelectItem value="25">25% of endpoints</SelectItem></SelectContent></Select></div></div>
              {[["local_policy_cache", "Last-known-good policy cache", "Keep safe decisions during a brief control-plane outage."], ["bypass_detection", "Bypass detection", "Report adapter, browser and VPN attempts to evade assigned DNS."], ["network_mode_enabled", "Network mode", "Prepare coverage for appliances and devices without an agent."]].map(([key, title, body]) => <div key={key} className="flex items-center justify-between gap-4 rounded-lg border border-white/[0.07] p-3"><div><p className="text-sm font-medium">{title}</p><p className="text-xs text-muted-foreground">{body}</p></div><Switch checked={Boolean(settings[key])} onCheckedChange={checked => setSettings(current => ({ ...current, [key]: checked }))} /></div>)}
            </CardContent></Card>
            <Card><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><LockKeyhole className="h-5 w-5 text-violet-300" />Privacy and Australian handling</CardTitle></CardHeader><CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>Query retention (days)</Label><Input type="number" min="0" max="365" value={settings.retention_days} onChange={event => setSettings(current => ({ ...current, retention_days: Number(event.target.value) }))} /></div><div className="space-y-2"><Label>Regional storage</Label><Select value={settings.regional_storage} onValueChange={value => setSettings(current => ({ ...current, regional_storage: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="australia">Australia</SelectItem><SelectItem value="tenant_default">Tenant default region</SelectItem></SelectContent></Select></div></div>
              <div className="space-y-2"><Label>Logging profile</Label><Select value={settings.logging_profile} onValueChange={value => setSettings(current => ({ ...current, logging_profile: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="security_only">Security only · threats and policy decisions</SelectItem><SelectItem value="categorised">Categorised · store category, not full domain</SelectItem><SelectItem value="full_audit">Full audit · named query evidence</SelectItem><SelectItem value="private">Private · aggregate counters only</SelectItem><SelectItem value="custom">Custom client profile</SelectItem></SelectContent></Select></div>
              {[["domain_redaction", "Redact domain detail", "Reduce query detail retained for privacy-sensitive clients."], ["consent_notice", "Endpoint consent notice", "Show the client-facing purpose and retention notice."]].map(([key, title, body]) => <div key={key} className="flex items-center justify-between gap-4 rounded-lg border border-white/[0.07] p-3"><div><p className="text-sm font-medium">{title}</p><p className="text-xs text-muted-foreground">{body}</p></div><Switch checked={Boolean(settings[key])} onCheckedChange={checked => setSettings(current => ({ ...current, [key]: checked }))} /></div>)}
            </CardContent></Card>
            <Card><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Fingerprint className="h-5 w-5 text-cyan-300" />Identity-aware protection</CardTitle></CardHeader><CardContent className="space-y-4">
              {[["zero_trust_enabled", "Zero-trust DNS conditions", "Evaluate policy using the signed-in user, device management, security posture, location and schedule when that evidence is available."], ["lookalike_monitoring", "Lookalike-domain monitoring", "Continuously compare observed domains with monitored client brands and authoritative domains."]].map(([key, title, body]) => <div key={key} className="flex items-center justify-between gap-4 rounded-lg border border-white/[0.07] p-3"><div><p className="text-sm font-medium">{title}</p><p className="text-xs text-muted-foreground">{body}</p></div><Switch checked={Boolean(settings[key])} onCheckedChange={checked => setSettings(current => ({ ...current, [key]: checked }))} /></div>)}
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-3 text-xs text-amber-100/80">Enabling the control plane does not silently enforce Windows Zero Trust DNS. Endpoint rollout remains a separate simulation, canary and approval workflow.</div>
            </CardContent></Card>
            <Card><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><CircleDollarSign className="h-5 w-5 text-emerald-300" />Managed service package</CardTitle></CardHeader><CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>Service tier</Label><Select value={settings.service_tier} onValueChange={value => setSettings(current => ({ ...current, service_tier: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="essentials">Essentials</SelectItem><SelectItem value="business">Business</SelectItem><SelectItem value="secure">Secure</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label>Billing model</Label><Select value={settings.billing_model} onValueChange={value => setSettings(current => ({ ...current, billing_model: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="endpoint">Per endpoint</SelectItem><SelectItem value="user">Per user</SelectItem><SelectItem value="site">Per protected site</SelectItem></SelectContent></Select></div></div>
              <p className="text-xs text-muted-foreground">The Service tab shows attested usage and the billable quantity for agreement reconciliation.</p>
            </CardContent></Card>
            <Card><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Globe2 className="h-5 w-5 text-sky-300" />Client block experience</CardTitle></CardHeader><CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-4 rounded-lg border border-white/[0.07] p-3"><div><p className="text-sm font-medium">Branded block page</p><p className="text-xs text-muted-foreground">Explain the policy decision and provide an audited request path.</p></div><Switch checked={Boolean(settings.custom_block_page_enabled)} onCheckedChange={checked => setSettings(current => ({ ...current, custom_block_page_enabled: checked }))} /></div>
              <div className="space-y-2"><Label>Page title</Label><Input value={settings.block_page_title || ""} onChange={event => setSettings(current => ({ ...current, block_page_title: event.target.value }))} /></div>
              <div className="space-y-2"><Label>Client guidance</Label><Textarea rows={3} value={settings.block_page_message || ""} onChange={event => setSettings(current => ({ ...current, block_page_message: event.target.value }))} /></div>
              <div className="space-y-2"><Label>Support URL</Label><Input value={settings.block_page_support_url || ""} onChange={event => setSettings(current => ({ ...current, block_page_support_url: event.target.value }))} placeholder="https://support.example.com" /></div>
              {[["block_page_request_access", "Allow temporary access requests", "Capture business reason, manager and expiry as audit evidence."], ["block_page_require_mfa", "Require MFA before request", "Do not accept a bypass request until the requester is verified."]].map(([key, title, body]) => <div key={key} className="flex items-center justify-between gap-4 rounded-lg border border-white/[0.07] p-3"><div><p className="text-sm font-medium">{title}</p><p className="text-xs text-muted-foreground">{body}</p></div><Switch checked={Boolean(settings[key])} onCheckedChange={checked => setSettings(current => ({ ...current, [key]: checked }))} /></div>)}
            </CardContent></Card>
            <Card className="border-rose-500/20"><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><ShieldAlert className="h-5 w-5 text-rose-300" />Break-glass control</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm text-muted-foreground">Move enrolled endpoints back to visibility mode and queue restoration of safe DNS. The reason and technician identity are immutable audit evidence.</p><Textarea value={emergencyReason} onChange={event => setEmergencyReason(event.target.value)} placeholder="Required reason for emergency disable" rows={3} /><Button variant="destructive" onClick={emergencyDisable}><ShieldAlert className="mr-2 h-4 w-4" />Emergency disable</Button></CardContent></Card>
          </div>
          <Card><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><History className="h-5 w-5 text-sky-300" />Nexus DNS audit trail</CardTitle></CardHeader><CardContent>{audit.length ? audit.slice(0, 20).map(item => <div key={item.id} className="flex flex-col gap-1 border-b border-white/[0.06] py-3 last:border-0 sm:flex-row sm:items-center"><Badge variant="outline">{item.action.replaceAll("_", " ")}</Badge><span className="flex-1 text-sm">{item.actor}</span><span className="text-xs text-muted-foreground">{formatDate(item.occurred_at)}</span></div>) : <EmptyState icon={History} title="No DNS control changes yet" body="Settings, simulations, staged deployments, temporary allows and emergency actions will be recorded here." />}</CardContent></Card>
        </TabsContent>
      </Tabs>

      <Dialog open={policyOpen} onOpenChange={setPolicyOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-sky-300" />Create Nexus DNS policy</DialogTitle><DialogDescription>Build a clearly scoped draft. Simulation and staged rollout are separate steps so a saved rule cannot silently change client DNS.</DialogDescription></DialogHeader>
          <div className="grid max-h-[65vh] gap-4 overflow-y-auto pr-1 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2"><Label>Policy name</Label><Input value={policyForm.name} onChange={event => setPolicyForm(current => ({ ...current, name: event.target.value }))} placeholder="High-confidence client protection" /></div>
            <div className="space-y-2 sm:col-span-2"><Label>Purpose and technician guidance</Label><Textarea value={policyForm.description} onChange={event => setPolicyForm(current => ({ ...current, description: event.target.value }))} placeholder="What this policy protects and when to create an exception" /></div>
            <div className="space-y-2"><Label>Scope</Label><Select value={policyForm.scope_type} onValueChange={value => setPolicyForm(current => ({ ...current, scope_type: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["global", "msp", "client", "site", "group", "user", "device"].map(value => <SelectItem key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>Client / scope name</Label>{policyForm.scope_type === "client" ? <Select value={policyForm.scope_id || "none"} onValueChange={value => { const client = clients.find(item => item.id === value); setPolicyForm(current => ({ ...current, scope_id: value === "none" ? "" : value, scope_name: client?.name || "" })); }}><SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger><SelectContent><SelectItem value="none">Choose later</SelectItem>{clients.map(client => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}</SelectContent></Select> : <Input value={policyForm.scope_name} onChange={event => setPolicyForm(current => ({ ...current, scope_name: event.target.value }))} placeholder="All managed clients" />}</div>
            <div className="space-y-2"><Label>Starting mode</Label><Select value={policyForm.mode} onValueChange={value => setPolicyForm(current => ({ ...current, mode: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="visibility">Visibility</SelectItem><SelectItem value="audit">Audit</SelectItem><SelectItem value="block" disabled={!overview.edge_ready}>Block · edge required</SelectItem></SelectContent></Select></div>
            <div className="space-y-2"><Label>Schedule</Label><Select value={policyForm.schedule} onValueChange={value => setPolicyForm(current => ({ ...current, schedule: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="always">Always</SelectItem><SelectItem value="business_hours">Business hours</SelectItem><SelectItem value="after_hours">After hours</SelectItem></SelectContent></Select></div>
            <div className="space-y-2"><Label>Minimum device score</Label><Input type="number" min="0" max="100" value={policyForm.minimum_device_score} onChange={event => setPolicyForm(current => ({ ...current, minimum_device_score: Number(event.target.value) }))} /></div>
            <div className="space-y-2"><Label>Unknown domain decision</Label><Select value={policyForm.uncertain_domain_action} onValueChange={value => setPolicyForm(current => ({ ...current, uncertain_domain_action: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="allow">Allow</SelectItem><SelectItem value="audit">Audit for review</SelectItem><SelectItem value="block" disabled={!overview.edge_ready}>Block · edge required</SelectItem></SelectContent></Select></div>
            <div className="space-y-2"><Label>Allowed location labels</Label><Input value={(policyForm.access_conditions?.locations || []).join(", ")} onChange={event => setPolicyForm(current => ({ ...current, access_conditions: { ...current.access_conditions, locations: event.target.value.split(",").map(value => value.trim()).filter(Boolean) } }))} placeholder="Office, Australia, Trusted VPN" /></div>
            <div className="space-y-2"><Label>Allowed role labels</Label><Input value={(policyForm.access_conditions?.roles || []).join(", ")} onChange={event => setPolicyForm(current => ({ ...current, access_conditions: { ...current.access_conditions, roles: event.target.value.split(",").map(value => value.trim()).filter(Boolean) } }))} placeholder="Finance, Executive, Technician" /></div>
            <div className="space-y-2 sm:col-span-2"><Label>Always allow domains</Label><Textarea rows={3} value={(policyForm.allow_domains || []).join("\n")} onChange={event => setPolicyForm(current => ({ ...current, allow_domains: event.target.value.split(/[,\n]/).map(value => value.trim().toLowerCase()).filter(Boolean) }))} placeholder={"trusted-vendor.com\nrequired-client-service.com"} /><p className="text-xs text-muted-foreground">One domain per line. These explicit exceptions remain visible in policy evidence.</p></div>
            <div className="space-y-2 sm:col-span-2"><Label>Always block domains</Label><Textarea rows={3} value={(policyForm.block_domains || []).join("\n")} onChange={event => setPolicyForm(current => ({ ...current, block_domains: event.target.value.split(/[,\n]/).map(value => value.trim().toLowerCase()).filter(Boolean) }))} placeholder={"known-phishing.example\nunapproved-remote-tool.example"} /><p className="text-xs text-muted-foreground">Use explicit entries for confirmed business policy or threat intelligence, then simulate before rollout.</p></div>
            <div className="space-y-2 sm:col-span-2"><Label>Maximum identity risk</Label><Select value={policyForm.access_conditions?.maximum_risk || "any"} onValueChange={value => setPolicyForm(current => ({ ...current, access_conditions: { ...current.access_conditions, maximum_risk: value } }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="any">Any reported risk</SelectItem><SelectItem value="low">Low only</SelectItem><SelectItem value="medium">Medium or lower</SelectItem></SelectContent></Select></div>
            {[["managed_device", "Require managed device", "Use endpoint-management evidence before granting access."], ["bitlocker_required", "Require BitLocker", "Use Nexus Agent posture evidence when available."]].map(([key, title, body]) => <div key={key} className="flex items-center justify-between gap-4 rounded-lg border border-white/[0.07] p-3 sm:col-span-2"><div><p className="text-sm font-medium">{title}</p><p className="text-xs text-muted-foreground">{body}</p></div><Switch checked={Boolean(policyForm.access_conditions?.[key])} onCheckedChange={checked => setPolicyForm(current => ({ ...current, access_conditions: { ...current.access_conditions, [key]: checked } }))} /></div>)}
            <div className="space-y-2 sm:col-span-2"><Label>Category decisions</Label><div className="grid gap-2 sm:grid-cols-2">{Object.entries(policyForm.categories).map(([category, action]) => <div key={category} className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.07] p-2.5"><span className="text-sm capitalize">{category.replaceAll("_", " ")}</span><Select value={action} onValueChange={value => setPolicyForm(current => ({ ...current, categories: { ...current.categories, [category]: value } }))}><SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="allow">Allow</SelectItem><SelectItem value="audit">Audit</SelectItem><SelectItem value="block">Block</SelectItem></SelectContent></Select></div>)}</div></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setPolicyOpen(false)}>Cancel</Button><Button onClick={submitPolicy} disabled={saving}><FileCheck2 className="mr-2 h-4 w-4" />Save draft policy</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(simulatePolicy)} onOpenChange={open => { if (!open) setSimulatePolicy(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><TestTube2 className="h-5 w-5 text-violet-300" />Simulate {simulatePolicy?.name}</DialogTitle><DialogDescription>Preview the explainable decision. This never sends a DNS request or changes an endpoint.</DialogDescription></DialogHeader>
          <div className="max-h-[68vh] space-y-4 overflow-y-auto pr-1">
            <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>Domain</Label><Input value={simulation.domain} onChange={event => setSimulation(current => ({ ...current, domain: event.target.value }))} placeholder="example-phishing.test" /></div><div className="space-y-2"><Label>Known category</Label><Select value={simulation.category} onValueChange={value => setSimulation(current => ({ ...current, category: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.keys(defaultCategories).map(value => <SelectItem key={value} value={value}>{value.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select></div></div>
            <div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Identity and device context</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>Role</Label><Input value={simulation.context.role} onChange={event => setSimulation(current => ({ ...current, context: { ...current.context, role: event.target.value } }))} placeholder="Finance" /></div><div className="space-y-2"><Label>Location</Label><Input value={simulation.context.location} onChange={event => setSimulation(current => ({ ...current, context: { ...current.context, location: event.target.value } }))} placeholder="Office" /></div><div className="space-y-2"><Label>Device score</Label><Input type="number" min="0" max="100" value={simulation.context.device_score} onChange={event => setSimulation(current => ({ ...current, context: { ...current.context, device_score: Number(event.target.value) } }))} /></div><div className="space-y-2"><Label>Identity risk</Label><Select value={simulation.context.identity_risk} onValueChange={value => setSimulation(current => ({ ...current, context: { ...current.context, identity_risk: value } }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">None reported</SelectItem><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="critical">Critical</SelectItem></SelectContent></Select></div></div></div>
            {[["managed_device", "Managed device"], ["bitlocker_enabled", "BitLocker enabled"]].map(([key, label]) => <div key={key} className="flex items-center justify-between rounded-lg border border-white/[0.07] p-3"><span className="text-sm font-medium">{label}</span><Switch checked={Boolean(simulation.context[key])} onCheckedChange={checked => setSimulation(current => ({ ...current, context: { ...current.context, [key]: checked } }))} /></div>)}
            {simulationResult && <div className="rounded-lg border border-violet-500/20 bg-violet-500/[0.05] p-4"><div className="flex items-center gap-2"><Badge variant="outline" className={statusClasses[simulationResult.action] || ""}>{simulationResult.action}</Badge><span className="font-mono text-sm">{simulationResult.domain}</span></div><p className="mt-2 text-sm">{simulationResult.reason}</p>{simulationResult.conditions_evaluated?.map(condition => <div key={condition.key} className="mt-2 flex items-center justify-between rounded-md bg-black/10 px-3 py-2 text-xs"><span>{condition.label}: {String(condition.actual)}</span><Badge variant="outline" className={condition.passed ? statusClasses.allow : statusClasses.block}>{condition.passed ? "Pass" : "Fail"}</Badge></div>)}<p className="mt-2 text-xs text-muted-foreground">{simulationResult.note}</p></div>}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setSimulatePolicy(null)}>Close</Button><Button onClick={runSimulation} disabled={saving}><TestTube2 className="mr-2 h-4 w-4" />Run simulation</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(forecastPolicy)} onOpenChange={open => { if (!open) { setForecastPolicy(null); setForecastResult(null); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><History className="h-5 w-5 text-sky-300" />Policy impact forecast</DialogTitle><DialogDescription>{forecastPolicy?.name}. Historical evidence only; no DNS policy or endpoint changed.</DialogDescription></DialogHeader>
          {forecastResult && <div className="space-y-4"><div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><div className="rounded-lg bg-white/[0.03] p-3"><p className="text-xs text-muted-foreground">Queries analysed</p><p className="mt-1 text-xl font-semibold">{forecastResult.query_count}</p></div><div className="rounded-lg bg-white/[0.03] p-3"><p className="text-xs text-muted-foreground">Would block</p><p className="mt-1 text-xl font-semibold">{forecastResult.would_block_queries}</p></div><div className="rounded-lg bg-white/[0.03] p-3"><p className="text-xs text-muted-foreground">Endpoints</p><p className="mt-1 text-xl font-semibold">{forecastResult.affected_endpoints}</p></div><div className="rounded-lg bg-white/[0.03] p-3"><p className="text-xs text-muted-foreground">Clients</p><p className="mt-1 text-xl font-semibold">{forecastResult.affected_clients}</p></div></div><div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Top affected domains</p>{forecastResult.top_domains?.length ? forecastResult.top_domains.map(item => <div key={item.domain} className="mt-2 flex items-center justify-between rounded-lg border border-white/[0.06] px-3 py-2"><span className="font-mono text-sm">{item.domain}</span><Badge variant="outline">{item.count} queries</Badge></div>) : <p className="mt-2 text-sm text-muted-foreground">No historical query would have been blocked by this policy.</p>}</div><p className="text-xs text-muted-foreground">{forecastResult.note}</p></div>}
          <DialogFooter><Button onClick={() => { setForecastPolicy(null); setForecastResult(null); }}>Close forecast</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deployOpen} onOpenChange={setDeployOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Zap className="h-5 w-5 text-sky-300" />Stage Nexus DNS deployment</DialogTitle><DialogDescription>Preview endpoint impact and rollback before anything is queued. Blocking remains locked until the resolver edge is ready.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>Mode</Label><Select value={deployment.mode} onValueChange={value => { setDeployment(current => ({ ...current, mode: value })); setPreview(null); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="visibility">Visibility</SelectItem><SelectItem value="audit">Audit</SelectItem><SelectItem value="block" disabled={!overview.edge_ready}>Block · edge required</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label>Deployment ring</Label><Select value={deployment.ring} onValueChange={value => { setDeployment(current => ({ ...current, ring: value })); setPreview(null); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="canary">Canary</SelectItem><SelectItem value="pilot">Pilot</SelectItem><SelectItem value="broad">Broad</SelectItem></SelectContent></Select></div></div>
            <div className="space-y-2"><Label>Audit reason</Label><Textarea value={deployment.reason} onChange={event => setDeployment(current => ({ ...current, reason: event.target.value }))} rows={2} /></div>
            {preview && <div className="rounded-xl border border-sky-500/20 bg-sky-500/[0.045] p-4"><div className="flex items-center justify-between"><p className="font-medium">{preview.eligible_count} eligible endpoint(s)</p><Badge variant="outline" className={preview.can_proceed ? statusClasses.allow : statusClasses.audit}>{preview.can_proceed ? "Ready to queue" : "Review required"}</Badge></div>{preview.warnings?.map(warning => <p key={warning} className="mt-2 flex items-start gap-2 text-sm text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{warning}</p>)}<p className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Rollback plan</p><ol className="mt-2 space-y-1 text-xs text-muted-foreground">{preview.rollback_plan?.map((step, index) => <li key={step}>{index + 1}. {step}</li>)}</ol></div>}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setDeployOpen(false)}>Cancel</Button>{!preview ? <Button onClick={previewDeployment} disabled={saving}><Search className="mr-2 h-4 w-4" />Preview impact</Button> : <Button onClick={queueDeployment} disabled={saving || !preview.can_proceed || preview.eligible_count === 0}><Zap className="mr-2 h-4 w-4" />Queue configuration</Button>}</DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={domainOpen} onOpenChange={setDomainOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Globe2 className="h-5 w-5 text-sky-300" />Add monitored domain</DialogTitle><DialogDescription>Capture an authoritative DNS baseline and connect changes to the correct client record.</DialogDescription></DialogHeader>
          <div className="space-y-4"><div className="space-y-2"><Label>Domain</Label><Input value={domainForm.domain} onChange={event => setDomainForm(current => ({ ...current, domain: event.target.value }))} placeholder="example.com" /></div><div className="space-y-2"><Label>Client</Label><Select value={domainForm.client_id || "none"} onValueChange={value => setDomainForm(current => ({ ...current, client_id: value === "none" ? "" : value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Unlinked</SelectItem>{clients.map(client => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Check interval</Label><Select value={domainForm.check_interval_minutes} onValueChange={value => setDomainForm(current => ({ ...current, check_interval_minutes: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="15">Every 15 minutes</SelectItem><SelectItem value="30">Every 30 minutes</SelectItem><SelectItem value="60">Hourly</SelectItem><SelectItem value="360">Every 6 hours</SelectItem></SelectContent></Select></div></div>
          <DialogFooter><Button variant="outline" onClick={() => setDomainOpen(false)}>Cancel</Button><Button onClick={addDomain}><Plus className="mr-2 h-4 w-4" />Add domain</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(eventActionTarget)} onOpenChange={open => { if (!open) setEventActionTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">{eventActionMode === "allow" ? <Clock className="h-5 w-5 text-amber-300" /> : <TicketPlus className="h-5 w-5 text-sky-300" />}{eventActionMode === "allow" ? "Create expiring DNS exception" : "Create DNS incident ticket"}</DialogTitle>
            <DialogDescription>{eventActionTarget?.domain} · {eventActionTarget?.client_name || "Unlinked client"}. The source event and technician identity will be retained as audit evidence.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {eventActionMode === "allow" && <div className="space-y-2"><Label>Exception duration</Label><Select value={eventAllowMinutes} onValueChange={setEventAllowMinutes}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="15">15 minutes</SelectItem><SelectItem value="30">30 minutes</SelectItem><SelectItem value="60">1 hour</SelectItem><SelectItem value="240">4 hours</SelectItem><SelectItem value="1440">24 hours</SelectItem></SelectContent></Select></div>}
            <div className="space-y-2"><Label>{eventActionMode === "allow" ? "Required business reason" : "Investigation brief"}</Label><Textarea rows={4} value={eventActionReason} onChange={event => setEventActionReason(event.target.value)} placeholder={eventActionMode === "allow" ? "Why is this domain required and who approved it?" : "Add verified context for the assigned technician"} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setEventActionTarget(null)}>Cancel</Button><Button onClick={submitEventAction} disabled={saving || eventActionReason.trim().length < 4}>{eventActionMode === "allow" ? <Clock className="mr-2 h-4 w-4" /> : <TicketPlus className="mr-2 h-4 w-4" />}{eventActionMode === "allow" ? "Create temporary allow" : "Create incident ticket"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
