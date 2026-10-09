import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Shield, BookOpen, Database, Cloud, DollarSign, Mail, MessageSquare,
  Activity, CircleDot, AlertTriangle, ArrowRight, CheckCircle2, ExternalLink, Phone,
  Settings as SettingsIcon, RefreshCw, Loader2, Plug, Search, SlidersHorizontal, Wifi, Wrench,
} from "lucide-react";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";

const ICON_BY_KEY = {
  huntress: Shield,
  hudu: BookOpen,
  acronis: Database,
  pax8: Cloud,
  domotz: Activity,
  stripe: DollarSign,
  xero: DollarSign,
  microsoft365: Mail,
  sms: MessageSquare,
  splynx: Cloud,
  syncro: Cloud,
  suped: Shield,
  yeastar: Phone,
  unifi: Wifi,
  cipp: Cloud,
  microsoft_partner_center: Cloud,
  synergy_wholesale: Cloud,
  supabase_artifacts: Database,
  nexus_agent: Activity,
  nexus_elevate: Shield,
};

const CATEGORY_TONE = {
  security: "text-orange-400 border-orange-500/30 bg-orange-500/5",
  documentation: "text-emerald-400 border-emerald-500/30 bg-emerald-500/5",
  backup: "text-sky-400 border-sky-500/30 bg-sky-500/5",
  billing: "text-indigo-400 border-indigo-500/30 bg-indigo-500/5",
  payments: "text-violet-400 border-violet-500/30 bg-violet-500/5",
  accounting: "text-violet-400 border-violet-500/30 bg-violet-500/5",
  email: "text-cyan-400 border-cyan-500/30 bg-cyan-500/5",
  messaging: "text-cyan-400 border-cyan-500/30 bg-cyan-500/5",
  network: "text-emerald-400 border-emerald-500/30 bg-emerald-500/5",
  "psa-sync": "text-zinc-400 border-border",
  isp: "text-amber-400 border-amber-500/30 bg-amber-500/5",
  "remote-access": "text-sky-400 border-sky-500/30 bg-sky-500/5",
  voice: "text-cyan-400 border-cyan-500/30 bg-cyan-500/5",
};

const CONNECTION_STYLE = {
  verified: { label: "Verified", className: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
  configured_unverified: { label: "Needs verification", className: "border-sky-500/30 text-sky-300" },
  stale: { label: "Sync overdue", className: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  failed: { label: "Needs attention", className: "bg-rose-500/15 text-rose-300 border-rose-500/30" },
  not_configured: { label: "Not connected", className: "border-amber-500/30 text-amber-300" },
};

const CATEGORY_LABEL = {
  security: "Security",
  documentation: "Documentation",
  backup: "Backup",
  billing: "Billing",
  payments: "Payments",
  accounting: "Accounting",
  email: "Email",
  messaging: "Messaging",
  network: "Network",
  "psa-sync": "PSA sync",
  isp: "ISP",
  "remote-access": "Remote access",
  voice: "Voice",
};

const MANAGEMENT_OWNER_LABEL = {
  settings_configuration: "Configuration in Settings",
  operations_health: "Operations & health workspace",
};

const CONNECTION_DETAILS = {
  verified: {
    summary: "A recent test or synchronisation verified this connection.",
    panelClassName: "border-emerald-500/20 bg-emerald-500/[0.035]",
    iconClassName: "text-emerald-300",
    Icon: CheckCircle2,
  },
  configured_unverified: {
    summary: "Settings are saved, but Nexus has not verified this connection yet.",
    panelClassName: "border-sky-500/20 bg-sky-500/[0.035]",
    iconClassName: "text-sky-300",
    Icon: CircleDot,
  },
  stale: {
    summary: "This connection was previously active, but its latest synchronisation is overdue.",
    panelClassName: "border-amber-500/20 bg-amber-500/[0.035]",
    iconClassName: "text-amber-300",
    Icon: AlertTriangle,
  },
  failed: {
    summary: "The most recent connection test or synchronisation reported a problem.",
    panelClassName: "border-rose-500/20 bg-rose-500/[0.035]",
    iconClassName: "text-rose-300",
    Icon: AlertTriangle,
  },
  not_configured: {
    summary: "No connection settings are saved for this integration.",
    panelClassName: "border-border/70 bg-muted/[0.12]",
    iconClassName: "text-muted-foreground",
    Icon: SettingsIcon,
  },
};

const STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "setup", label: "Setup required" },
  { key: "verify", label: "Verification pending" },
  { key: "verified", label: "Verified" },
  { key: "attention", label: "Needs attention" },
];

function matchesStatusFilter(integration, filter) {
  if (filter === "all") return true;
  if (filter === "setup") return integration.connection_state === "not_configured";
  if (filter === "verify") return integration.connection_state === "configured_unverified";
  if (filter === "verified") return integration.connection_state === "verified";
  return ["failed", "stale"].includes(integration.connection_state);
}

function getConnectionSettingsPath(integration) {
  if (integration.settings_path) return integration.settings_path;
  if (integration.settings_anchor) return `/settings?tab=integrations&anchor=${integration.settings_anchor}`;
  return null;
}

function formatTimestamp(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
}

function connectionEvidence(integration) {
  const testStatus = String(integration.last_test_status || "").trim();
  if (testStatus) return `Last test: ${testStatus.slice(0, 70)}`;
  const syncedAt = formatTimestamp(integration.last_synced_at);
  if (syncedAt) return `Last sync: ${syncedAt}`;
  return "No test or synchronisation evidence recorded.";
}

function providerEvidence(integration) {
  const evidence = integration.evidence;
  if (!evidence || typeof evidence !== "object") return null;
  if (typeof evidence.graph_verified_tenant_count === "number") {
    const count = evidence.graph_verified_tenant_count;
    return `Graph evidence: ${count} verified tenant${count === 1 ? "" : "s"}`;
  }
  if (Object.prototype.hasOwnProperty.call(evidence, "private_bucket_ready")) {
    return evidence.private_bucket_ready ? "Private storage evidence: ready" : "Private storage evidence: needs review";
  }
  if (evidence.release_version) return `Release evidence: ${evidence.release_version}`;
  if (Object.prototype.hasOwnProperty.call(evidence, "release_available")) {
    return evidence.release_available ? "Release evidence: available" : "Release evidence: not available";
  }
  if (Object.prototype.hasOwnProperty.call(evidence, "native_enabled")) {
    return evidence.native_enabled ? "Native capability: enabled" : "Native capability: disabled";
  }
  if (evidence.credential_storage) return `Credential storage: ${String(evidence.credential_storage).replaceAll("_", " ")}`;
  return null;
}

function IntegrationHealth({ integration }) {
  const detail = CONNECTION_DETAILS[integration.connection_state] || CONNECTION_DETAILS.not_configured;
  const DetailIcon = detail.Icon;
  const evidence = connectionEvidence(integration);
  const providerStatus = providerEvidence(integration);
  return (
    <div className={`rounded-xl border p-3 ${detail.panelClassName}`}>
      <div className="flex items-start gap-2.5">
        <DetailIcon className={`mt-0.5 h-4 w-4 shrink-0 ${detail.iconClassName}`} aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Connection health</p>
          <p className="mt-1 text-xs leading-5 text-foreground/90">{detail.summary}</p>
          <p className="mt-1.5 truncate font-mono text-[10px] text-muted-foreground" title={evidence}>{evidence}</p>
          {providerStatus && <p className="mt-1 truncate text-[10px] font-medium text-violet-200/90" title={providerStatus}>{providerStatus}</p>}
        </div>
      </div>
    </div>
  );
}

function IntegrationActions({ integration }) {
  const settingsPath = getConnectionSettingsPath(integration);
  const workspacePath = integration.command_center;
  const needsSetup = integration.connection_state === "not_configured";
  const connectionControlsLiveInWorkspace = integration.management_owner === "operations_health" && settingsPath === workspacePath;
  const primary = needsSetup && settingsPath
    ? { to: settingsPath, label: connectionControlsLiveInWorkspace ? "Configure connection" : "Configure in settings", kind: "settings", testId: `io-settings-${integration.key}` }
    : workspacePath
      ? { to: workspacePath, label: "Open workspace", kind: "workspace", testId: `io-open-${integration.key}` }
      : settingsPath
        ? { to: settingsPath, label: "Connection settings", kind: "settings", testId: `io-settings-${integration.key}` }
        : null;
  const secondary = primary?.kind === "settings" && workspacePath && settingsPath !== workspacePath
    ? { to: workspacePath, label: "Open workspace", kind: "workspace", testId: `io-open-${integration.key}` }
    : primary?.kind === "workspace" && settingsPath && settingsPath !== workspacePath
      ? { to: settingsPath, label: "Connection settings", kind: "settings", testId: `io-settings-${integration.key}` }
      : null;
  const PrimaryIcon = primary?.kind === "workspace" ? ExternalLink : SettingsIcon;
  const SecondaryIcon = secondary?.kind === "workspace" ? ExternalLink : SettingsIcon;

  return (
    <div className="mt-auto flex flex-wrap gap-2 border-t border-border/70 pt-3">
      {primary && <Button size="sm" className="min-w-[148px] flex-1" asChild data-testid={primary.testId}>
        <Link to={primary.to} aria-label={`${primary.label}: ${integration.name}`}><PrimaryIcon className="mr-1.5 h-3.5 w-3.5" />{primary.label}</Link>
      </Button>}
      {secondary && <Button size="sm" variant="outline" className="min-w-[148px] flex-1" asChild data-testid={secondary.testId}>
        <Link to={secondary.to} aria-label={`${secondary.label}: ${integration.name}`}><SecondaryIcon className="mr-1.5 h-3.5 w-3.5" />{secondary.label}</Link>
      </Button>}
    </div>
  );
}

function IntegrationCard({ integration }) {
  const Icon = ICON_BY_KEY[integration.key] || Plug;
  const categoryTone = CATEGORY_TONE[integration.category] || "text-zinc-400 border-border";
  const connection = CONNECTION_STYLE[integration.connection_state] || CONNECTION_STYLE.not_configured;
  return (
    <Card className="group flex min-h-[330px] flex-col overflow-hidden border-border/80 bg-card/80 transition duration-200 hover:-translate-y-0.5 hover:border-violet-400/35 hover:shadow-[0_18px_50px_-32px_rgba(139,92,246,0.7)]" data-testid={`io-tile-${integration.key}`}>
      <CardContent className="flex h-full flex-1 flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${categoryTone}`}><Icon className="h-5 w-5" aria-hidden="true" /></div>
          <Badge variant="outline" className={`shrink-0 text-[10px] ${connection.className}`}><CircleDot className="mr-1 h-2.5 w-2.5" aria-hidden="true" />{connection.label}</Badge>
        </div>
        <div className="min-h-[68px]">
          <Badge variant="outline" className={`mb-2 text-[9px] font-semibold uppercase tracking-[0.12em] ${categoryTone}`}>{CATEGORY_LABEL[integration.category] || integration.category}</Badge>
          <h2 className="text-sm font-semibold leading-5 text-foreground">{integration.name}</h2>
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{integration.description}</p>
          <p className="mt-2 flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground"><SettingsIcon className="h-3 w-3" aria-hidden="true" />{MANAGEMENT_OWNER_LABEL[integration.management_owner] || MANAGEMENT_OWNER_LABEL.settings_configuration}</p>
        </div>
        <IntegrationHealth integration={integration} />
        <IntegrationActions integration={integration} />
      </CardContent>
    </Card>
  );
}

export default function IntegrationsOverviewPage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await axios.get(`${API}/integrations-overview`, { headers });
      setData(res.data);
    } catch (e) {
      setLoadError(e.response?.data?.detail || "Integration status is unavailable.");
      toast.error(e.response?.data?.detail || "Failed to load integrations");
    } finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  const integrationTiles = useMemo(() => data?.tiles || [], [data]);
  const configured = data?.configured_count || 0;
  const total = data?.total || 0;
  const verified = data?.verified_count || 0;
  const setupRequired = Math.max(0, total - configured);
  const verificationPending = integrationTiles.filter((tile) => tile.connection_state === "configured_unverified").length;
  const needsAttention = integrationTiles.filter((tile) => ["failed", "stale"].includes(tile.connection_state)).length;
  const filterCounts = { all: total, setup: setupRequired, verify: verificationPending, verified, attention: needsAttention };
  const categories = useMemo(
    () => [...new Set(integrationTiles.map((tile) => tile.category).filter(Boolean))]
      .sort((left, right) => (CATEGORY_LABEL[left] || left).localeCompare(CATEGORY_LABEL[right] || right)),
    [integrationTiles],
  );
  const tiles = integrationTiles.filter((tile) => {
    if (!matchesStatusFilter(tile, statusFilter)) return false;
    if (categoryFilter !== "all" && tile.category !== categoryFilter) return false;
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return [tile.name, tile.description, tile.category]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });
  const hasActiveFilters = Boolean(search.trim()) || statusFilter !== "all" || categoryFilter !== "all";
  const initialLoading = loading && !data;

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setCategoryFilter("all");
  };

  return (
    <div className="p-6 space-y-5" data-testid="integrations-overview-page">
      <OperationalPageHeader
        eyebrow="Integration control"
        title="Integrations"
        description="A single operational catalogue for connection health and service workspaces. Credentials, scopes, notification rules, and connection tests stay in Settings."
        icon={Plug}
        tone="violet"
        actions={<>
          <Badge variant="outline" className={needsAttention > 0 ? "border-amber-500/30 bg-amber-500/[0.07] text-amber-200" : verificationPending > 0 ? "border-sky-500/30 bg-sky-500/[0.07] text-sky-200" : "border-emerald-500/30 bg-emerald-500/[0.07] text-emerald-200"} aria-live="polite">
            {initialLoading ? "Checking connection health" : needsAttention > 0 ? `${needsAttention} needs attention` : verificationPending > 0 ? `${verificationPending} verification pending` : `${verified} verified`}
          </Badge>
          <Button size="sm" variant="outline" asChild>
            <Link to="/settings?tab=integrations"><SettingsIcon className="mr-1.5 h-3.5 w-3.5" />Connection settings</Link>
          </Button>
          <Button size="sm" variant="outline" onClick={load} disabled={loading} data-testid="io-refresh-btn">
            {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}{loading ? "Refreshing" : "Refresh"}
          </Button>
        </>}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <HeroTile label="Catalogue" value={initialLoading ? "—" : total} icon={Plug} glow="violet" subtitle="Available service connections" onClick={() => setStatusFilter("all")} active={statusFilter === "all"} testId="io-metric-total" />
        <HeroTile label="Setup required" value={initialLoading ? "—" : setupRequired} icon={SettingsIcon} glow="sky" subtitle="No connection settings saved" onClick={() => setStatusFilter("setup")} active={statusFilter === "setup"} testId="io-metric-setup" />
        <HeroTile label="Verified" value={initialLoading ? "—" : verified} icon={CheckCircle2} glow="emerald" subtitle="Recent test or synchronisation" onClick={() => setStatusFilter("verified")} active={statusFilter === "verified"} testId="io-metric-verified" />
        <HeroTile label="Needs attention" value={initialLoading ? "—" : needsAttention} icon={AlertTriangle} glow="amber" subtitle="Failed or overdue evidence" onClick={() => setStatusFilter("attention")} active={statusFilter === "attention"} testId="io-metric-attention" />
      </div>

      <Card className="overflow-hidden border-violet-500/20 bg-violet-500/[0.025]" data-testid="io-connection-workflow">
        <CardContent className="p-0">
          <div className="flex flex-col gap-4 border-b border-violet-500/15 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-violet-500/25 bg-violet-500/[0.09]"><Wrench className="h-4 w-4 text-violet-200" aria-hidden="true" /></div>
              <div>
                <p className="text-sm font-semibold">One predictable connection workflow</p>
                <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">Saved settings are not verification. Configure a connection in Settings, verify it there, then use the matching workspace for live operations.</p>
              </div>
            </div>
            <Button size="sm" variant="outline" className="shrink-0" asChild><Link to="/settings?tab=integrations"><SettingsIcon className="mr-1.5 h-3.5 w-3.5" />Open connection settings</Link></Button>
          </div>
          <div className="grid gap-px bg-violet-500/10 md:grid-cols-3">
            {[
              ["01", "Configure in Settings", "Save credentials, scopes, and policy without exposing secrets in operational workspaces.", SettingsIcon, "text-sky-200"],
              ["02", "Verify the connection", "Run the provider connection test or first synchronisation. Only that evidence can mark the connection verified.", CheckCircle2, "text-emerald-200"],
              ["03", "Operate in the workspace", "Use the connected service workspace for supported actions, evidence, and ongoing health.", ArrowRight, "text-violet-200"],
            ].map(([number, title, description, StepIcon, tone]) => (
              <div key={number} className="bg-card/30 px-5 py-4">
                <div className="flex items-start gap-3">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-current/20 bg-black/10 text-[10px] font-bold ${tone}`}>{number}</span>
                  <div className="min-w-0"><p className="flex items-center gap-1.5 text-sm font-medium"><StepIcon className={`h-3.5 w-3.5 ${tone}`} aria-hidden="true" />{title}</p><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{description}</p></div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">

        {(needsAttention > 0 || verificationPending > 0) && (
          <div className="flex flex-col gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3 sm:flex-row sm:items-center sm:justify-between" role="status">
            <div className="flex min-w-0 items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
              <p className="text-xs leading-5 text-amber-100/90"><span className="font-semibold">{needsAttention > 0 ? "Connection review needed." : "Connection verification pending."}</span> {needsAttention > 0 ? "Failed, overdue, and unverified connections are deliberately kept distinct from verified ones." : "Settings are saved, but the provider connection still needs a test or first synchronisation."}</p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setStatusFilter(needsAttention > 0 ? "attention" : "verify")} className="shrink-0 text-amber-200 hover:bg-amber-500/10 hover:text-amber-100">{needsAttention > 0 ? "Review attention" : "Review pending"}</Button>
          </div>
        )}

        {loadError && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-500/25 bg-rose-500/[0.05] px-4 py-3 text-sm text-rose-100" role="alert">
            <span>{loadError}</span>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>Retry</Button>
          </div>
        )}

        <Card className="border-border/80" data-testid="io-catalogue-filters">
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="relative min-w-0 flex-1 lg:max-w-xl">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input className="h-10 pl-9" placeholder="Search integrations, service type, or workspace" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search integrations" data-testid="io-search" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                  <label htmlFor="io-category-filter" className="sr-only">Filter by category</label>
                  <select id="io-category-filter" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="h-9 rounded-md border border-border bg-background px-2.5 text-xs text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-violet-400/50" data-testid="io-category-filter">
                    <option value="all">All categories</option>
                    {categories.map((category) => <option key={category} value={category}>{CATEGORY_LABEL[category] || category}</option>)}
                  </select>
                </div>
                {hasActiveFilters && <Button type="button" size="sm" variant="ghost" onClick={clearFilters} data-testid="io-clear-filters">Clear filters</Button>}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
              <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Connection state</span>
              {STATUS_FILTERS.map((filter) => (
                <Button key={filter.key} type="button" onClick={() => setStatusFilter(filter.key)} variant={statusFilter === filter.key ? "secondary" : "outline"} size="sm" className={`h-8 text-[10px] font-semibold uppercase tracking-[0.08em] ${statusFilter === filter.key ? "border-violet-400/35 bg-violet-500/[0.14] text-violet-100" : ""}`} aria-pressed={statusFilter === filter.key} data-testid={`io-filter-${filter.key}`}>
                  {filter.label}<span className="ml-1.5 opacity-70">{filterCounts[filter.key]}</span>
                </Button>
              ))}
              <p className="ml-auto text-xs text-muted-foreground" aria-live="polite">Showing <span className="font-medium text-foreground">{tiles.length}</span> of {total}</p>
            </div>
          </CardContent>
        </Card>

        {initialLoading ? (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground" role="status" aria-live="polite"><Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />Loading integration catalogue…</div>
        ) : tiles.length === 0 ? (
          <Card className="border-dashed border-border/80"><CardContent className="p-10 text-center"><Search className="mx-auto h-7 w-7 text-muted-foreground/60" aria-hidden="true" /><p className="mt-3 text-sm font-medium">No integrations match this view</p><p className="mt-1 text-xs text-muted-foreground">Clear the search or status filters to return to the complete catalogue.</p>{hasActiveFilters && <Button type="button" variant="outline" size="sm" className="mt-4" onClick={clearFilters}>Clear filters</Button>}</CardContent></Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" aria-label="Integration catalogue">
            {tiles.map((integration) => <IntegrationCard key={integration.key} integration={integration} />)}
          </div>
        )}
      </div>
    </div>
  );
}
