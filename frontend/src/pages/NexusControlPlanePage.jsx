import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import {
  Activity, AlertTriangle, BarChart3, Bot, Boxes, Building2, CheckCircle2, CircuitBoard, Cloud,
  Database, ExternalLink, FileText, GitBranch, HardDrive, Lightbulb, Loader2,
  Link2, LockKeyhole, Network, Phone, Radio, Receipt, RefreshCw, Search, Server,
  Plus, Send, Settings, ShieldCheck, Sparkles, Ticket, Users, Waypoints, Workflow, XCircle,
} from "lucide-react";

import { API, useAuth } from "@/App";
import CippCommandCenterPage from "@/pages/CippCommandCenterPage";
import M365CommandCenter from "@/pages/M365CommandCenter";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { WorkspaceErrorState, WorkspaceLoadingState } from "@/components/WorkspaceState";
import HeroTile from "@/components/HeroTile";
import EventBackbonePanel from "@/components/control-plane/EventBackbonePanel";
import MicrosoftActionCentre from "@/components/control-plane/MicrosoftActionCentre";
import MicrosoftCapabilityMap from "@/components/control-plane/MicrosoftCapabilityMap";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

const ROADMAP_TONES = {
  planned: {
    column: "border-zinc-700/80 bg-zinc-900/35",
    badge: "border-zinc-600 bg-zinc-800/70 text-zinc-200",
    icon: GitBranch,
    iconClass: "text-zinc-300",
  },
  in_progress: {
    column: "border-cyan-500/20 bg-cyan-500/[0.025]",
    badge: "border-cyan-500/30 bg-cyan-500/10 text-cyan-100",
    icon: Waypoints,
    iconClass: "text-cyan-300",
  },
  testing: {
    column: "border-amber-500/20 bg-amber-500/[0.025]",
    badge: "border-amber-500/30 bg-amber-500/10 text-amber-100",
    icon: Activity,
    iconClass: "text-amber-300",
  },
  released: {
    column: "border-emerald-500/20 bg-emerald-500/[0.025]",
    badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-100",
    icon: CheckCircle2,
    iconClass: "text-emerald-300",
  },
};

export default function NexusControlPlanePage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [params, setParams] = useSearchParams();
  const module = params.get("module") || "overview";
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [foundation, setFoundation] = useState(null);
  const [foundationLoading, setFoundationLoading] = useState(false);
  const [coreRebuilding, setCoreRebuilding] = useState(false);
  const [query, setQuery] = useState(params.get("search") || "");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState(null);
  const microsoftView = ["actions", "security", "connections", "capabilities"].includes(params.get("view"))
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
    if (["actions", "security", "connections", "capabilities"].includes(next)) updated.set("view", next);
    else updated.delete("view");
    if (next !== "actions") updated.delete("action");
    setParams(updated, { replace: true });
  };

  const loadOverview = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setLoadError("");
    try {
      const response = await axios.get(`${API}/control-plane/overview`, { headers });
      setOverview(response.data);
    } catch (error) {
      const message = error.response?.data?.detail || "Nexus Control Plane could not load its provider overview.";
      setLoadError(`${message} No provider, tenant or billing configuration has been changed.`);
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
  const nextAction = !stats.m365_tenants
    ? {
      label: "Connect the first Microsoft tenant",
      description: "Microsoft 365 is not yet in the verified control scope, so tenant actions and identity evidence remain unavailable.",
      route: "/settings?tab=integrations&anchor=cipp-settings-card",
      action: "Open Microsoft connection",
      tone: "amber",
    }
    : stats.open_tickets > 0
      ? {
        label: "Review open service work",
        description: `${stats.open_tickets} service record${stats.open_tickets === 1 ? " is" : "s are"} currently open across the connected estate.`,
        route: "/tickets",
        action: "Open service desk",
        tone: "cyan",
      }
      : {
        label: "Control scope is ready",
        description: "No immediate Control Plane action is evidenced. Use the command tabs to investigate providers, automation or the activity record.",
        route: "/control-plane?module=operations",
        action: "Explore providers",
        tone: "emerald",
      };
  const controlPlaneSignal = !stats.m365_tenants
    ? "attention"
    : (stats.open_tickets || 0) > 0 || (stats.open_invoices || 0) > 0
      ? "working"
      : "healthy";
  if (loading && !overview) return <WorkspaceLoadingState label="Loading Control Plane evidence" />;
  if (loadError && !overview) return <WorkspaceErrorState title="Control Plane needs attention" description={loadError} onRetry={loadOverview} retryLabel="Retry Control Plane" />;
  return (
    <div className="nx-page-stage space-y-5 p-6" data-testid="nexus-control-plane">
      <OperationalPageHeader
        eyebrow="Multi-tenant operations fabric"
        title="Nexus Control Plane"
        description="One control surface for Microsoft 365, connected infrastructure, client context, automation, billing and auditable technician actions."
        icon={Boxes}
        tone="cyan"
        signal={controlPlaneSignal}
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

      <Card className="nx-ambient-surface overflow-hidden border-cyan-500/20 bg-gradient-to-r from-cyan-500/[0.06] via-card to-emerald-500/[0.04]" data-nx-signal={controlPlaneSignal}>
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

      {!loading && <Card className={nextAction.tone === "emerald" ? "border-emerald-500/25 bg-emerald-500/[0.045]" : nextAction.tone === "amber" ? "border-amber-500/25 bg-amber-500/[0.045]" : "border-cyan-500/25 bg-cyan-500/[0.045]"} data-testid="control-plane-next-action">
        <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border ${nextAction.tone === "emerald" ? "border-emerald-500/25 bg-emerald-500/[0.09] text-emerald-300" : nextAction.tone === "amber" ? "border-amber-500/25 bg-amber-500/[0.09] text-amber-300" : "border-cyan-500/25 bg-cyan-500/[0.09] text-cyan-300"}`}>
              {nextAction.tone === "emerald" ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            </div>
            <div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Recommended next action</p><p className="mt-1 text-sm font-semibold">{nextAction.label}</p><p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">{nextAction.description}</p></div>
          </div>
          <Button size="sm" className="shrink-0" variant={nextAction.tone === "emerald" ? "outline" : "default"} asChild><Link to={nextAction.route}>{nextAction.action}<ExternalLink className="ml-1.5 h-3.5 w-3.5" /></Link></Button>
        </CardContent>
      </Card>}

      <Tabs value={module} onValueChange={selectModule} className="space-y-4">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 rounded-xl border border-border/70 bg-muted/30 p-1.5" data-testid="control-plane-tabs" aria-label="Control Plane workspaces">
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
                <Button size="sm" variant={microsoftView === "capabilities" ? "default" : "ghost"} onClick={() => selectMicrosoftView("capabilities")}>Nexus 365</Button>
                <Button size="sm" variant={microsoftView === "tenant-operations" ? "default" : "ghost"} onClick={() => selectMicrosoftView("tenant-operations")}>Tenant operations</Button>
                <Button size="sm" variant={microsoftView === "actions" ? "default" : "ghost"} onClick={() => selectMicrosoftView("actions")}>Action centre</Button>
                <Button size="sm" variant={microsoftView === "security" ? "default" : "ghost"} onClick={() => selectMicrosoftView("security")}>Security & guardrails</Button>
                <Button size="sm" variant={microsoftView === "connections" ? "default" : "ghost"} onClick={() => selectMicrosoftView("connections")}>Connections</Button>
              </div>
            </CardContent>
          </Card>
          {microsoftView === "capabilities" && <MicrosoftCapabilityMap providerConnected={Boolean(overview?.compatibility?.cipp_adapter_configured || overview?.compatibility?.m365_graph_configured)} tenantCount={stats.m365_tenants ?? 0} />}
          {microsoftView === "tenant-operations" && <CippCommandCenterPage embedded />}
          {microsoftView === "actions" && <MicrosoftActionCentre />}
          {microsoftView === "security" && <M365CommandCenter embedded initialTab="security" />}
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
            headers={headers}
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

function ProductRoadmapBoard({ roadmap }) {
  if (!roadmap?.items?.length) return null;
  const summary = roadmap.summary || {};
  const releasedPct = summary.total
    ? Math.round(((summary.released || 0) / summary.total) * 100)
    : 0;

  return (
    <Card className="overflow-hidden border-violet-500/20 bg-gradient-to-br from-violet-500/[0.045] via-card to-cyan-500/[0.025]" data-testid="foundation-roadmap">
      <CardHeader className="border-b border-border/70">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="flex items-center gap-2 text-base"><GitBranch className="h-4 w-4 text-violet-300" />{roadmap.name}</CardTitle>
              <Badge variant="outline" className="border-violet-500/25 bg-violet-500/[0.08] text-violet-100">Source of truth · v{roadmap.version}</Badge>
            </div>
            <CardDescription className="mt-1 max-w-4xl">Major product work is sequenced behind declared Nexus Core dependencies. Live evidence is shown on every item, but release promotion remains a deliberate product decision.</CardDescription>
          </div>
          <div className="min-w-52 rounded-xl border border-border/70 bg-black/10 p-3">
            <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">Released baseline</span><span className="font-semibold text-emerald-200">{summary.released || 0} / {summary.total || 0}</span></div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-400" style={{ width: `${releasedPct}%` }} /></div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
          {(roadmap.columns || []).map((column) => {
            const tone = ROADMAP_TONES[column.id] || ROADMAP_TONES.planned;
            const ColumnIcon = tone.icon;
            const items = roadmap.items.filter((item) => item.status === column.id);
            return (
              <section key={column.id} className={`min-w-0 rounded-2xl border p-3 ${tone.column}`} data-testid={`roadmap-${column.id}`}>
                <div className="mb-3 flex items-start gap-2">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-black/10"><ColumnIcon className={`h-3.5 w-3.5 ${tone.iconClass}`} /></div>
                  <div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold">{column.label}</p><Badge variant="outline" className={tone.badge}>{items.length}</Badge></div><p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">{column.description}</p></div>
                </div>
                <div className="space-y-2">
                  {items.map((item) => (
                    <Link key={item.id} to={item.route} className="group block rounded-xl border border-border/70 bg-card/70 p-3 transition hover:border-cyan-500/30 hover:bg-cyan-500/[0.035]">
                      <div className="flex items-start justify-between gap-2">
                        <div><p className="text-sm font-semibold">{item.name}</p><p className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Phase {item.phase} · {item.owner}</p></div>
                        <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition group-hover:text-cyan-200" />
                      </div>
                      <p className="mt-2 text-[11px] leading-4 text-muted-foreground">{item.summary}</p>
                      <div className={`mt-2 rounded-lg border p-2 ${item.evidence?.verified ? "border-emerald-500/20 bg-emerald-500/[0.04]" : "border-border/70 bg-black/10"}`}>
                        <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Live evidence</p>
                        <p className="mt-1 text-[10px] leading-4">{item.evidence?.summary}</p>
                      </div>
                      <p className="mt-2 text-[10px] leading-4"><span className="font-semibold text-cyan-200">Release gate:</span> <span className="text-muted-foreground">{item.release_gate}</span></p>
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {(roadmap.policy || []).map((item) => <div key={item} className="flex gap-2 rounded-lg border border-border/70 bg-muted/15 p-2.5"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-300" /><p className="text-[10px] leading-4 text-muted-foreground">{item}</p></div>)}
        </div>
      </CardContent>
    </Card>
  );
}

const IDEA_AXIS_LABELS = {
  saves_time: "Save time",
  reduces_stress: "Reduce stress",
  increases_confidence: "Increase confidence",
  creates_opportunity: "Create opportunity",
};

function IdeaVault({ registry, headers, onChanged }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [capturing, setCapturing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: "", summary: "", category: "general", horizon: "explore",
    value_axes: { saves_time: true, reduces_stress: false, increases_confidence: true, creates_opportunity: false },
  });
  const filtered = useMemo(() => {
    const ideas = registry?.items || [];
    const needle = search.trim().toLowerCase();
    return ideas.filter((idea) => {
      if (status !== "all" && idea.status !== status) return false;
      return !needle || `${idea.number || ""} ${idea.title} ${idea.summary} ${idea.category}`.toLowerCase().includes(needle);
    });
  }, [registry?.items, search, status]);

  const captureIdea = async () => {
    if (form.title.trim().length < 3 || form.summary.trim().length < 10) {
      toast.info("Add a clear title and a short explanation of the idea");
      return;
    }
    setSaving(true);
    try {
      await axios.post(`${API}/core/ideas`, form, { headers });
      toast.success("Idea captured in Nexus Foundation");
      setForm({ title: "", summary: "", category: "general", horizon: "explore", value_axes: { saves_time: true, reduces_stress: false, increases_confidence: true, creates_opportunity: false } });
      setCapturing(false);
      await onChanged();
    } catch (error) {
      toast.error(error.response?.data?.detail || "The idea could not be captured");
    } finally {
      setSaving(false);
    }
  };

  if (!registry) return null;
  return (
    <Card className="overflow-hidden border-amber-500/20 bg-gradient-to-br from-amber-500/[0.04] via-card to-violet-500/[0.025]" data-testid="nexus-idea-vault">
      <CardHeader className="border-b border-border/70">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-400/25 bg-amber-500/10 text-amber-300"><Lightbulb className="h-4 w-4" /></span>
            <div><div className="flex flex-wrap items-center gap-2"><CardTitle className="text-base">Nexus Ideas</CardTitle><Badge variant="outline">{registry.summary?.total || 0} retained</Badge></div><CardDescription className="mt-1 max-w-3xl">A durable product inbox. Capturing an idea does not approve, schedule, or release it; promotion into the roadmap remains a deliberate decision.</CardDescription></div>
          </div>
          <Button size="sm" className="gap-1.5" onClick={() => setCapturing((value) => !value)}><Plus className="h-3.5 w-3.5" />Capture idea</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {Object.entries(IDEA_AXIS_LABELS).map(([axis, label]) => <div key={axis} className="rounded-xl border border-border/65 bg-background/25 p-3"><p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p><p className="mt-1 font-mono text-xl font-semibold text-amber-200">{registry.summary?.axis_counts?.[axis] || 0}</p><p className="mt-0.5 text-[9px] text-muted-foreground">ideas pass this filter</p></div>)}
        </div>

        {capturing && <section className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.035] p-4" data-testid="idea-capture-form">
          <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-cyan-300" /><div><p className="text-sm font-semibold">Capture the opportunity</p><p className="text-[10px] text-muted-foreground">Keep the idea concise; validation and roadmap decisions happen later.</p></div></div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <div><label className="mb-1 block text-[10px] font-medium">Idea title</label><Input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="What should Nexus make possible?" data-testid="idea-title" /></div>
            <div><label className="mb-1 block text-[10px] font-medium">Category</label><Input value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} placeholder="foundation, automation, experience…" data-testid="idea-category" /></div>
            <div className="lg:col-span-2"><label className="mb-1 block text-[10px] font-medium">Why it matters</label><Textarea value={form.summary} onChange={(event) => setForm((current) => ({ ...current, summary: event.target.value }))} rows={3} placeholder="Describe the user problem and the outcome, without prescribing unnecessary implementation." data-testid="idea-summary" /></div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {Object.entries(IDEA_AXIS_LABELS).map(([axis, label]) => <label key={axis} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-xs transition ${form.value_axes[axis] ? "border-emerald-400/25 bg-emerald-500/[0.06] text-emerald-100" : "border-border/60 bg-background/25 text-muted-foreground"}`}><input type="checkbox" checked={form.value_axes[axis]} onChange={(event) => setForm((current) => ({ ...current, value_axes: { ...current.value_axes, [axis]: event.target.checked } }))} className="h-3.5 w-3.5 accent-emerald-500" />{label}</label>)}
          </div>
          <div className="mt-4 flex justify-end gap-2"><Button variant="outline" size="sm" onClick={() => setCapturing(false)}>Cancel</Button><Button size="sm" className="gap-1.5" onClick={captureIdea} disabled={saving}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}Save to idea vault</Button></div>
        </section>}

        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Search ideas by number, title, category, or outcome…" data-testid="idea-search" /></div>
          <div className="flex flex-wrap gap-1.5">{["all", ...(registry.statuses || [])].map((value) => <button key={value} type="button" onClick={() => setStatus(value)} className={`rounded-lg border px-2.5 py-2 text-[10px] capitalize transition ${status === value ? "border-amber-400/30 bg-amber-500/[0.08] text-amber-100" : "border-border/60 bg-background/25 text-muted-foreground hover:text-foreground"}`}>{value.replaceAll("_", " ")}</button>)}</div>
        </div>

        <div className="grid max-h-[540px] gap-2 overflow-y-auto pr-1 md:grid-cols-2 xl:grid-cols-3" data-testid="idea-list">
          {filtered.map((idea) => <article key={idea.id} className="rounded-xl border border-border/65 bg-background/25 p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-amber-300">{idea.number ? `Idea ${idea.number}` : "Team idea"} · {idea.category}</p><h4 className="mt-1 truncate text-sm font-semibold">{idea.title}</h4></div><Badge variant="outline" className="shrink-0 capitalize text-[9px]">{idea.status}</Badge></div><p className="mt-2 line-clamp-3 text-[10px] leading-4 text-muted-foreground">{idea.summary}</p><div className="mt-3 flex flex-wrap gap-1">{Object.entries(idea.value_axes || {}).filter(([, enabled]) => enabled).map(([axis]) => <span key={axis} className="rounded-md border border-emerald-400/15 bg-emerald-500/[0.04] px-1.5 py-1 text-[8px] text-emerald-200">{IDEA_AXIS_LABELS[axis]}</span>)}</div></article>)}
          {!filtered.length && <div className="col-span-full rounded-xl border border-dashed border-border p-8 text-center text-xs text-muted-foreground">No ideas match this filter.</div>}
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">{(registry.policy || []).map((item) => <div key={item} className="flex gap-2 rounded-lg border border-border/60 bg-muted/10 p-2.5"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" /><p className="text-[9px] leading-4 text-muted-foreground">{item}</p></div>)}</div>
      </CardContent>
    </Card>
  );
}

function FoundationPanel({ data, loading, reload, rebuildCore, coreRebuilding, headers }) {
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

      <ProductRoadmapBoard roadmap={data.roadmap} />

      <IdeaVault registry={data.idea_registry} headers={headers} onChanged={reload} />

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
          <div className="grid gap-3 rounded-xl border border-border/70 bg-black/10 p-3 lg:grid-cols-[180px_1fr]">
            <div className="flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-3">
              <Building2 className="h-4 w-4 text-emerald-300" />
              <div><p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-emerald-300">Canonical root</p><p className="mt-0.5 text-sm font-semibold capitalize">{coreSchema.canonical_tree?.root || "client"}</p></div>
            </div>
            <div className="flex flex-wrap content-center gap-1.5">
              {(coreSchema.canonical_tree?.children || (coreSchema.canonical_path || []).filter((entity) => entity !== "client")).map((entity) => (
                <Badge key={entity} variant="outline" className="border-cyan-500/20 bg-cyan-500/[0.04] px-2.5 py-1.5 capitalize text-cyan-100">{entity}</Badge>
              ))}
            </div>
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
