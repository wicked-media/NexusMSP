import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import {
  Activity, AlertTriangle, ArrowRight, BarChart3, Bot, Boxes, Building2, CheckCircle2, CircuitBoard, Cloud,
  Database, ExternalLink, FileText, GitBranch, HardDrive, Loader2,
  Link2, LockKeyhole, Network, Phone, Radio, Receipt, RefreshCw, Search, Server,
  Settings, ShieldCheck, Sparkles, Ticket, Users, Waypoints, Workflow, XCircle,
} from "lucide-react";

import { API, useAuth } from "@/App";
import CippCommandCenterPage from "@/pages/CippCommandCenterPage";
import M365CommandCenter from "@/pages/M365CommandCenter";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";
import EventBackbonePanel from "@/components/control-plane/EventBackbonePanel";
import MicrosoftActionCentre from "@/components/control-plane/MicrosoftActionCentre";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";


const OPERATIONS_MODULES = [
  { id: "microsoft365", label: "Microsoft 365", description: "Tenants, identity, Exchange, Intune, Defender, licensing and security.", icon: Cloud, route: "/control-plane?module=microsoft365", tone: "cyan" },
  { id: "azure", label: "Azure", description: "Cloud connection readiness, tenant evidence and infrastructure operations.", icon: Server, route: "/settings?tab=integrations", tone: "sky" },
  { id: "voice", label: "Voice", description: "Yeastar PBXs, extensions, client mappings, synchronisation and billing.", icon: Phone, route: "/voice", tone: "violet" },
  { id: "backups", label: "Backups", description: "Protection coverage, restore verification, compliance and client billing.", icon: HardDrive, route: "/backup-center", tone: "emerald" },
  { id: "managed-assets", label: "Managed Assets", description: "Nexus Agent endpoints, health, patching, remote access and live actions.", icon: Boxes, route: "/devices", tone: "cyan" },
  { id: "network", label: "Network & DNS", description: "Sites, topology, DNS, domains, certificates and monitored services.", icon: Network, route: "/networking", tone: "sky" },
  { id: "billing", label: "Billing", description: "Invoices, recurring billing, commercial mappings and Xero workflows.", icon: Receipt, route: "/billing-dashboard", tone: "emerald" },
  { id: "automation", label: "Automation", description: "Runbooks, scripts, workflows, alert rules and self-healing actions.", icon: Workflow, route: "/automation-hub", tone: "amber" },
  { id: "documentation", label: "Documentation", description: "Knowledge, auto-documentation, client records and operational evidence.", icon: FileText, route: "/documentation-hub", tone: "violet" },
  { id: "ai", label: "AI Operations", description: "Copilot, triage, recommendations and technician-approved AI actions.", icon: Bot, route: "/auto-ops", tone: "cyan" },
];

const TONE_CLASSES = {
  cyan: "border-cyan-500/20 bg-cyan-500/[0.035] text-cyan-200",
  sky: "border-sky-500/20 bg-sky-500/[0.035] text-sky-200",
  emerald: "border-emerald-500/20 bg-emerald-500/[0.035] text-emerald-200",
  amber: "border-amber-500/20 bg-amber-500/[0.035] text-amber-200",
  violet: "border-violet-500/20 bg-violet-500/[0.035] text-violet-200",
};

function providerStatus(status) {
  if (["verified", "connected"].includes(status)) return { label: status === "verified" ? "Verified" : "Connected", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" };
  if (status === "configured") return { label: "Configured", className: "border-cyan-500/30 bg-cyan-500/10 text-cyan-200" };
  if (status === "setup_required" || status === "not_configured") return { label: "Setup required", className: "border-amber-500/30 bg-amber-500/10 text-amber-200" };
  return { label: "No verified evidence", className: "border-zinc-700 bg-zinc-800/40 text-zinc-300" };
}

function timeAgo(value) {
  if (!value) return "No verified sync";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No verified sync";
  return date.toLocaleString();
}

export default function NexusControlPlanePage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [params, setParams] = useSearchParams();
  const module = params.get("module") || "overview";
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [foundation, setFoundation] = useState(null);
  const [foundationLoading, setFoundationLoading] = useState(false);
  const [coreRebuilding, setCoreRebuilding] = useState(false);
  const [query, setQuery] = useState(params.get("search") || "");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState(null);
  const microsoftView = ["actions", "security", "connections"].includes(params.get("view"))
    ? params.get("view")
    : "tenant-operations";

  const selectModule = (next) => {
    const updated = new URLSearchParams(params);
    if (next === "overview") updated.delete("module");
    else updated.set("module", next);
    setParams(updated, { replace: true });
  };

  const selectMicrosoftView = (next) => {
    const updated = new URLSearchParams(params);
    updated.set("module", "microsoft365");
    if (["actions", "security", "connections"].includes(next)) updated.set("view", next);
    else updated.delete("view");
    if (next !== "actions") updated.delete("action");
    setParams(updated, { replace: true });
  };

  const loadOverview = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const response = await axios.get(`${API}/control-plane/overview`, { headers });
      setOverview(response.data);
    } catch (error) {
      toast.error("Nexus Control Plane could not load its provider overview");
    } finally {
      setLoading(false);
    }
  }, [headers, token]);

  useEffect(() => {
    if (token) loadOverview();
  }, [loadOverview, token]);

  const loadFoundation = useCallback(async () => {
    if (!token) return;
    setFoundationLoading(true);
    try {
      const response = await axios.get(`${API}/control-plane/foundation`, { headers });
      setFoundation(response.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Platform foundation status could not be loaded");
    } finally {
      setFoundationLoading(false);
    }
  }, [headers, token]);

  const rebuildCore = useCallback(async () => {
    if (!token) return;
    setCoreRebuilding(true);
    try {
      const response = await axios.post(`${API}/core/relationships/rebuild`, {}, { headers });
      const result = response.data;
      toast.success(`Nexus Core indexed ${result.entities} entities and ${result.relationships} relationships`);
      await loadFoundation();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Nexus Core relationships could not be rebuilt");
    } finally {
      setCoreRebuilding(false);
    }
  }, [headers, loadFoundation, token]);

  useEffect(() => {
    if (module === "foundation" && !foundation && token) loadFoundation();
  }, [foundation, loadFoundation, module, token]);

  const runSearch = useCallback(async (value = query) => {
    const term = value.trim();
    if (term.length < 2) {
      toast.info("Enter at least two characters to search NexusMSP");
      return;
    }
    setSearching(true);
    try {
      const response = await axios.get(`${API}/control-plane/search?q=${encodeURIComponent(term)}`, { headers });
      setResults(response.data);
      const updated = new URLSearchParams(params);
      updated.set("module", "search");
      updated.set("search", term);
      setParams(updated, { replace: true });
    } catch (error) {
      toast.error(error.response?.data?.detail || "Nexus-wide search could not be completed");
    } finally {
      setSearching(false);
    }
  }, [headers, params, query, setParams]);

  useEffect(() => {
    const initial = params.get("search");
    if (initial?.trim().length >= 2 && !results) runSearch(initial);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = overview?.stats || {};
  return (
    <div className="space-y-5 p-6" data-testid="nexus-control-plane">
      <OperationalPageHeader
        eyebrow="Multi-tenant operations fabric"
        title="Nexus Control Plane"
        description="One control surface for Microsoft 365, connected infrastructure, client context, automation, billing and auditable technician actions."
        icon={Boxes}
        tone="cyan"
        actions={<>
          <Badge variant="outline" className="border-cyan-500/30 bg-cyan-500/[0.08] text-cyan-100">
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />Operations fabric
          </Badge>
          <Button variant="outline" size="sm" asChild>
            <Link to="/settings?tab=integrations"><Settings className="mr-1.5 h-3.5 w-3.5" />Connections</Link>
          </Button>
          <Button variant="outline" size="sm" onClick={loadOverview} disabled={loading}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh
          </Button>
        </>}
      />

      <Card className="overflow-hidden border-cyan-500/20 bg-gradient-to-r from-cyan-500/[0.06] via-card to-emerald-500/[0.04]">
        <CardContent className="flex flex-col gap-4 p-4 xl:flex-row xl:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-semibold"><Search className="h-4 w-4 text-cyan-300" />Search the entire operation</div>
            <p className="mt-1 text-xs text-muted-foreground">Find a client, person, endpoint, ticket, invoice, PBX, backup job, product or knowledge record from one place.</p>
          </div>
          <div className="flex w-full gap-2 xl:max-w-2xl">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && runSearch()}
              placeholder='Try "Aaron Smith", "Printer", an invoice number or a client'
              className="h-10 border-cyan-500/20 bg-black/15"
              data-testid="control-plane-search"
            />
            <Button className="h-10" onClick={() => runSearch()} disabled={searching}>
              {searching ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Search className="mr-1.5 h-4 w-4" />}Search
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <HeroTile label="Connected providers" value={loading ? "—" : stats.connected_providers ?? 0} icon={CheckCircle2} glow="emerald" subtitle="Verified or configured" />
        <HeroTile label="Microsoft tenants" value={loading ? "—" : stats.m365_tenants ?? 0} icon={Building2} glow="cyan" subtitle="Tenant control scope" />
        <HeroTile label="Managed assets" value={loading ? "—" : stats.managed_assets ?? 0} icon={Boxes} glow="sky" subtitle="Nexus Agent endpoints" />
        <HeroTile label="Open service work" value={loading ? "—" : stats.open_tickets ?? 0} icon={Ticket} glow="amber" subtitle="Active tickets" />
        <HeroTile label="Open invoices" value={loading ? "—" : stats.open_invoices ?? 0} icon={Receipt} glow="violet" subtitle="Commercial follow-up" />
      </div>

      <Tabs value={module} onValueChange={selectModule} className="space-y-4">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 bg-muted/40 p-1 md:grid-cols-6" data-testid="control-plane-tabs">
          <TabsTrigger value="overview"><BarChart3 className="mr-1.5 h-3.5 w-3.5" />Command</TabsTrigger>
          <TabsTrigger value="microsoft365"><Cloud className="mr-1.5 h-3.5 w-3.5" />Microsoft 365</TabsTrigger>
          <TabsTrigger value="operations"><Boxes className="mr-1.5 h-3.5 w-3.5" />Providers</TabsTrigger>
          <TabsTrigger value="foundation"><CircuitBoard className="mr-1.5 h-3.5 w-3.5" />Foundation</TabsTrigger>
          <TabsTrigger value="search"><Search className="mr-1.5 h-3.5 w-3.5" />Search</TabsTrigger>
          <TabsTrigger value="activity"><Activity className="mr-1.5 h-3.5 w-3.5" />Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Provider health</CardTitle>
                <CardDescription>Connection state is evidence-based; NexusMSP does not label an unverified provider healthy.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {(overview?.providers || []).map((provider) => {
                  const status = providerStatus(provider.status);
                  return (
                    <Link key={provider.id} to={provider.route} className="flex items-center gap-3 rounded-xl border border-border/70 bg-muted/15 p-3 transition hover:border-cyan-500/30 hover:bg-cyan-500/[0.04]">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-500/20 bg-cyan-500/[0.06]"><Cloud className="h-4 w-4 text-cyan-200" /></div>
                      <div className="min-w-0 flex-1"><p className="text-sm font-medium">{provider.name}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{provider.detail}</p></div>
                      <Badge variant="outline" className={status.className}>{status.label}</Badge>
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                    </Link>
                  );
                })}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Control-plane pulse</CardTitle>
                <CardDescription>Current operational scope across the connected Nexus fabric.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <PulseRow label="Clients in scope" value={stats.clients ?? 0} icon={Users} />
                <PulseRow label="Microsoft identities" value={stats.m365_users ?? 0} icon={Cloud} />
                <PulseRow label="Open service records" value={stats.open_tickets ?? 0} icon={Ticket} />
                <PulseRow label="Last provider sync" value={timeAgo(stats.last_sync)} icon={RefreshCw} small />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Operations launchpad</CardTitle>
              <CardDescription>Move from a cross-platform signal to the owning operational workspace without losing client context.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              {OPERATIONS_MODULES.slice(0, 5).map((item) => <ModuleCard item={item} key={item.id} />)}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="microsoft365" className="space-y-4">
          <Card className="border-cyan-500/20 bg-cyan-500/[0.035]">
            <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
              <div><p className="text-sm font-semibold">Microsoft 365 control module</p><p className="mt-1 text-xs text-muted-foreground">Tenant administration and provider-verified security evidence now share one Microsoft workspace.</p></div>
              <div className="flex flex-wrap rounded-lg border border-border/70 bg-black/15 p-1">
                <Button size="sm" variant={microsoftView === "tenant-operations" ? "default" : "ghost"} onClick={() => selectMicrosoftView("tenant-operations")}>Tenant operations</Button>
                <Button size="sm" variant={microsoftView === "actions" ? "default" : "ghost"} onClick={() => selectMicrosoftView("actions")}>Action centre</Button>
                <Button size="sm" variant={microsoftView === "security" ? "default" : "ghost"} onClick={() => selectMicrosoftView("security")}>Security & guardrails</Button>
                <Button size="sm" variant={microsoftView === "connections" ? "default" : "ghost"} onClick={() => selectMicrosoftView("connections")}>Connections</Button>
              </div>
            </CardContent>
          </Card>
          {microsoftView === "tenant-operations" && <CippCommandCenterPage embedded />}
          {microsoftView === "actions" && <MicrosoftActionCentre />}
          {microsoftView === "security" && <M365CommandCenter embedded />}
          {microsoftView === "connections" && <M365CommandCenter embedded initialTab="connection" />}
        </TabsContent>

        <TabsContent value="operations">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {OPERATIONS_MODULES.map((item) => <ModuleCard item={item} key={item.id} />)}
          </div>
        </TabsContent>

        <TabsContent value="foundation">
          <FoundationPanel
            data={foundation}
            loading={foundationLoading}
            reload={loadFoundation}
            rebuildCore={rebuildCore}
            coreRebuilding={coreRebuilding}
          />
        </TabsContent>

        <TabsContent value="search">
          <SearchResults results={results} query={query} runSearch={runSearch} searching={searching} />
        </TabsContent>

        <TabsContent value="activity">
          <Card>
            <CardHeader><CardTitle className="text-base">Cross-platform activity</CardTitle><CardDescription>Recent actions retained by NexusMSP across connected operational domains.</CardDescription></CardHeader>
            <CardContent className="space-y-2">
              {(overview?.recent_activity || []).map((item, index) => (
                <div className="flex gap-3 rounded-xl border border-border/70 bg-muted/15 p-3" key={item.id || `${item.timestamp}-${index}`}>
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyan-500/20 bg-cyan-500/[0.06]"><Activity className="h-3.5 w-3.5 text-cyan-200" /></div>
                  <div className="min-w-0 flex-1"><p className="text-sm font-medium">{item.description || item.entity_name || item.action || "Recorded activity"}</p><p className="mt-1 text-xs text-muted-foreground">{item.user_name || item.user_email || "System"} · {item.entity_type || "platform"} · {timeAgo(item.timestamp)}</p></div>
                </div>
              ))}
              {!overview?.recent_activity?.length && <div className="py-12 text-center text-sm text-muted-foreground">No retained activity is available yet.</div>}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function FoundationPanel({ data, loading, reload, rebuildCore, coreRebuilding }) {
  if (loading && !data) {
    return <Card><CardContent className="flex min-h-72 items-center justify-center"><Loader2 className="mr-2 h-5 w-5 animate-spin text-cyan-300" />Inspecting the shared Nexus platform contracts…</CardContent></Card>;
  }
  if (!data) {
    return <Card><CardContent className="flex min-h-72 flex-col items-center justify-center text-center"><CircuitBoard className="h-8 w-8 text-cyan-300" /><p className="mt-3 text-sm font-semibold">Foundation evidence is unavailable</p><p className="mt-1 text-xs text-muted-foreground">Refresh after the API is available. No readiness state will be invented.</p><Button className="mt-4" variant="outline" onClick={reload}>Try again</Button></CardContent></Card>;
  }

  const summary = data.summary || {};
  const statusTone = {
    operational: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    partial: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    planned: "border-zinc-700 bg-zinc-800/50 text-zinc-300",
  };
  const statusIcon = {
    operational: CheckCircle2,
    partial: Waypoints,
    planned: GitBranch,
  };
  const coreSchema = data.core_model?.schema || {};
  const core = data.core_model?.integrity || {};
  const coreHealthy = core.status === "healthy";
  const populatedCoverage = (core.coverage || []).filter((item) => item.records > 0);

  return (
    <div className="space-y-4" data-testid="platform-foundation">
      <Card className="border-cyan-500/20 bg-cyan-500/[0.035]">
        <CardContent className="flex flex-col gap-4 p-5 xl:flex-row xl:items-center">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-cyan-500/25 bg-cyan-500/[0.08]"><CircuitBoard className="h-5 w-5 text-cyan-200" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Shared operating foundation</p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight">One contract underneath every Nexus module</h2>
            <p className="mt-1 max-w-4xl text-sm leading-6 text-muted-foreground">Nexus DNS, Remote, Control, Voice, Backups, Finance and Automation should share identity, events, permissions, audit and workflow semantics. This view separates operational evidence from migration targets so architecture work remains honest and testable.</p>
          </div>
          <Button variant="outline" size="sm" onClick={reload} disabled={loading}><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh evidence</Button>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <HeroTile label="Operational contracts" value={summary.operational ?? 0} icon={ShieldCheck} glow="emerald" subtitle="Backed by retained evidence" />
        <HeroTile label="In transition" value={summary.partial ?? 0} icon={Waypoints} glow="amber" subtitle="Useful, not yet complete" />
        <HeroTile label="Planned foundations" value={summary.planned ?? 0} icon={GitBranch} glow="violet" subtitle="No false deployment claims" />
        <HeroTile label="Governed event subjects" value={summary.event_subjects ?? 0} icon={Radio} glow="cyan" subtitle={`Schema v${summary.schema_version || 1}`} />
      </div>

      <EventBackbonePanel contract={data.event_contract} />

      <Card className="overflow-hidden border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.055] via-card to-cyan-500/[0.035]" data-testid="nexus-core-model">
        <CardHeader className="border-b border-border/70">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="flex items-center gap-2 text-base"><Link2 className="h-4 w-4 text-emerald-300" />Nexus Core relationship model</CardTitle>
                <Badge variant="outline" className={coreHealthy ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-amber-500/30 bg-amber-500/10 text-amber-200"}>
                  {coreHealthy ? "Integrity healthy" : core.status === "not_indexed" ? "Initial index required" : "Review required"}
                </Badge>
              </div>
              <CardDescription className="mt-1">A rebuildable compatibility index gives every module the same object identity and evidence-backed links without rewriting its source data.</CardDescription>
            </div>
            <Button size="sm" onClick={rebuildCore} disabled={coreRebuilding}>
              {coreRebuilding ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
              {coreRebuilding ? "Rebuilding index" : core.last_rebuilt_at ? "Rebuild relationships" : "Build relationship index"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border/70 bg-black/10 p-3">
            {(coreSchema.canonical_path || []).map((entity, index, values) => (
              <div className="flex items-center gap-1.5" key={entity}>
                <Badge variant="outline" className="border-cyan-500/20 bg-cyan-500/[0.04] capitalize text-cyan-100">{entity}</Badge>
                {index < values.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
              </div>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <ContractField label="Canonical entities" value={core.entities ?? 0} />
            <ContractField label="Relationships" value={core.relationships ?? 0} />
            <ContractField label="Client-linked coverage" value={`${core.client_linked_pct ?? 0}%`} />
            <ContractField label="Integrity anomalies" value={core.anomaly_count ?? 0} />
          </div>
          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-muted-foreground">Source coverage</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {populatedCoverage.slice(0, 10).map((item) => (
                  <div key={item.source} className="rounded-lg border border-border/70 bg-muted/15 p-2.5">
                    <div className="flex items-center justify-between gap-3"><code className="truncate text-[11px] text-cyan-100">{item.source}</code><span className="text-[11px] font-semibold">{item.coverage_pct}%</span></div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${item.coverage_pct === 100 ? "bg-emerald-400" : "bg-amber-400"}`} style={{ width: `${Math.max(2, item.coverage_pct)}%` }} /></div>
                    <p className="mt-1.5 text-[10px] text-muted-foreground">{item.client_linked} of {item.records} canonical records linked</p>
                  </div>
                ))}
                {!populatedCoverage.length && <div className="rounded-xl border border-dashed border-border p-5 text-center text-xs text-muted-foreground sm:col-span-2">Build the index to measure current source coverage.</div>}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-muted-foreground">Integrity evidence</p>
              <div className="mt-2 space-y-2">
                {(core.anomalies || []).slice(0, 4).map((item, index) => (
                  <div key={`${item.type}-${item.source_id}-${index}`} className="flex gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-2.5">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
                    <div className="min-w-0"><p className="text-xs font-medium">{item.message}</p><p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{item.source_collection} · {item.source_id}</p></div>
                  </div>
                ))}
                {!core.anomaly_count && core.status !== "not_indexed" && <div className="flex gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-3"><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-300" /><p className="text-xs leading-5 text-muted-foreground">Every generated relationship resolves to a current canonical object.</p></div>}
                {core.status === "not_indexed" && <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs leading-5 text-muted-foreground">No integrity run exists yet. The first governed rebuild will create a retained baseline.</div>}
              </div>
            </div>
          </div>
          {core.last_rebuilt_at && <p className="text-[10px] text-muted-foreground">Last rebuilt {timeAgo(core.last_rebuilt_at)} by {core.generated_by || "Nexus System"} · Run {core.id}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">The shared platform contracts</CardTitle><CardDescription>These are product invariants, not separate Nexus workspaces.</CardDescription></CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {(data.principles || []).map((principle, index) => (
            <div key={principle} className="flex items-center gap-3 rounded-xl border border-border/70 bg-muted/15 p-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyan-500/20 bg-cyan-500/[0.05] text-xs font-semibold text-cyan-200">{index + 1}</div>
              <p className="text-sm font-medium">{principle}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader><CardTitle className="text-base">Capability readiness</CardTitle><CardDescription>Evidence and next engineering boundary for each shared service.</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            {(data.capabilities || []).map((capability) => {
              const Icon = statusIcon[capability.status] || GitBranch;
              return (
                <div key={capability.id} className="rounded-xl border border-border/70 bg-muted/15 p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-500/20 bg-cyan-500/[0.05]"><Icon className="h-4 w-4 text-cyan-200" /></div>
                    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">{capability.name}</p><Badge variant="outline" className={statusTone[capability.status]}>{capability.status}</Badge><span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">{capability.owner}</span></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{capability.evidence}</p><p className="mt-2 text-xs leading-5"><span className="font-semibold text-cyan-200">Next:</span> {capability.next}</p></div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Radio className="h-4 w-4 text-cyan-300" />Unified event envelope</CardTitle><CardDescription>Durable today; broker-ready without coupling modules to a transport.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <ContractField label="Transport now" value={data.event_contract?.transport} />
                <ContractField label="Target" value={data.event_contract?.target_transport} />
                <ContractField label="Correlation" value={summary.correlation_header} />
                <ContractField label="Schema" value={`v${summary.schema_version || 1}`} />
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-muted-foreground">Required fields</p>
                <div className="mt-2 flex flex-wrap gap-1.5">{(data.event_contract?.required_fields || []).map((field) => <Badge key={field} variant="outline" className="font-mono text-[10px]">{field}</Badge>)}</div>
              </div>
              <div className="space-y-2">
                {(data.event_contract?.subjects || []).slice(0, 6).map((item) => <div key={item.subject} className="rounded-lg border border-border/70 p-2.5"><div className="flex items-center justify-between gap-2"><code className="text-xs text-cyan-200">{item.subject}</code><Badge variant="outline" className="text-[9px]">{item.owner}</Badge></div><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{item.description}</p></div>)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><LockKeyhole className="h-4 w-4 text-amber-300" />Non-negotiable guardrails</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {(data.guardrails || []).map((item) => <div key={item} className="flex gap-2 rounded-lg border border-border/70 bg-muted/15 p-2.5"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" /><p className="text-xs leading-5 text-muted-foreground">{item}</p></div>)}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Database className="h-4 w-4 text-cyan-300" />Technology transition map</CardTitle><CardDescription>The destination architecture, with no big-bang rewrite and no claim that target infrastructure already exists.</CardDescription></CardHeader>
        <CardContent className="space-y-2">
          {(data.technology_path || []).map((item) => (
            <div key={item.layer} className="grid gap-2 rounded-xl border border-border/70 bg-muted/15 p-3 lg:grid-cols-[150px_1fr_1fr]">
              <div><p className="text-sm font-semibold">{item.layer}</p><p className="mt-1 text-[11px] leading-4 text-cyan-200">{item.decision}</p></div>
              <div className="rounded-lg border border-border/60 bg-black/10 p-2.5"><p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Current</p><p className="mt-1 text-xs leading-5">{item.current}</p></div>
              <div className="rounded-lg border border-cyan-500/15 bg-cyan-500/[0.025] p-2.5"><p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-cyan-300">Target</p><p className="mt-1 text-xs leading-5">{item.target}</p></div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function ContractField({ label, value }) {
  return <div className="rounded-lg border border-border/70 bg-muted/15 p-2.5"><p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">{label}</p><p className="mt-1 truncate font-mono text-[11px] text-cyan-100">{value || "Not available"}</p></div>;
}

function PulseRow({ label, value, icon: Icon, small = false }) {
  return <div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-500/20 bg-cyan-500/[0.05]"><Icon className="h-4 w-4 text-cyan-200" /></div><div className="min-w-0 flex-1"><p className="text-xs text-muted-foreground">{label}</p><p className={`${small ? "truncate text-sm" : "text-lg"} font-semibold`}>{value}</p></div></div>;
}

function ModuleCard({ item }) {
  const Icon = item.icon;
  return (
    <Link to={item.route} className={`group rounded-2xl border p-4 transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/10 ${TONE_CLASSES[item.tone]}`}>
      <div className="flex items-start justify-between gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl border border-current/20 bg-black/10"><Icon className="h-4 w-4" /></div><ExternalLink className="h-3.5 w-3.5 opacity-40 transition group-hover:opacity-100" /></div>
      <p className="mt-4 text-sm font-semibold text-foreground">{item.label}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.description}</p>
    </Link>
  );
}

function SearchResults({ results, query, runSearch, searching }) {
  if (searching) return <Card><CardContent className="flex min-h-64 items-center justify-center"><Loader2 className="mr-2 h-5 w-5 animate-spin text-cyan-300" />Searching the Nexus fabric…</CardContent></Card>;
  if (!results) return <Card><CardContent className="flex min-h-64 flex-col items-center justify-center text-center"><Search className="h-8 w-8 text-cyan-300" /><p className="mt-3 text-sm font-semibold">Search across every connected workspace</p><p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">Use the search bar above for clients, people, devices, tickets, invoices, PBXs, backup jobs, products and documentation.</p>{query.trim().length >= 2 && <Button className="mt-4" onClick={() => runSearch()}>Search for “{query.trim()}”</Button>}</CardContent></Card>;
  const groups = Object.entries(results.groups || {}).filter(([, items]) => items.length);
  return (
    <div className="space-y-4">
      <Card className="border-cyan-500/20 bg-cyan-500/[0.035]"><CardContent className="flex items-center justify-between gap-3 p-4"><div><p className="text-sm font-semibold">{results.count} result{results.count === 1 ? "" : "s"} for “{results.query}”</p><p className="mt-1 text-xs text-muted-foreground">Results stay linked to their owning workspace and audit context.</p></div><Badge variant="outline" className="border-cyan-500/30 text-cyan-100">{groups.length} categories</Badge></CardContent></Card>
      {groups.map(([group, items]) => (
        <Card key={group}>
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{group.replaceAll("_", " ")} · {items.length}</CardTitle></CardHeader>
          <CardContent className="grid gap-2 md:grid-cols-2">
            {items.map((item, index) => (
              <Link to={item.route} key={`${item.kind}-${item.id || index}`} className="flex items-center gap-3 rounded-xl border border-border/70 bg-muted/15 p-3 transition hover:border-cyan-500/30 hover:bg-cyan-500/[0.04]">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-500/20 bg-cyan-500/[0.05]"><Search className="h-3.5 w-3.5 text-cyan-200" /></div>
                <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate text-sm font-medium">{item.title}</p><Badge variant="outline" className="h-5 shrink-0 text-[9px]">{item.kind}</Badge></div><p className="mt-1 truncate text-xs text-muted-foreground">{item.subtitle || "Open operational record"}</p></div>
                {item.status && <Badge variant="outline" className="hidden text-[10px] sm:inline-flex">{item.status}</Badge>}
              </Link>
            ))}
          </CardContent>
        </Card>
      ))}
      {!groups.length && <Card><CardContent className="flex min-h-52 flex-col items-center justify-center text-center"><XCircle className="h-7 w-7 text-muted-foreground" /><p className="mt-3 text-sm font-semibold">No connected records matched</p><p className="mt-1 text-xs text-muted-foreground">Try a client name, email, hostname, serial number, ticket number, invoice number or product SKU.</p></CardContent></Card>}
    </div>
  );
}
