import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import {
  Search, Building2, Users, HardDrive, Ticket, DollarSign, AlertTriangle,
  Mail, Phone, MapPin, Plus, Loader2, Cloud, Shield, Sparkles,
  Activity, ChevronRight, RefreshCw, Filter, X,
  Link as LinkIcon, UserPlus, KeyRound, Lock, Unlock, UserX, ExternalLink, MoreHorizontal,
  ChevronDown, BarChart3, Scale, Globe, FileText, ArrowRight, CheckCircle2, Rocket, Pencil, Trash2, Star, Save
} from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ClientAIBundle } from "@/components/ai/ClientAIBundle";
import { Client360Subscriptions, Client360Security, Client360Billing, Client360Assets } from "@/components/clients/Client360Tabs";
import ClientWarRoom from "@/components/clients/ClientWarRoom";
import HeroTile from "@/components/HeroTile";
import { MetricStrip, MetricTile } from "@/components/design-system";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { ClientProfilePictureUploader, ClientCoverImage } from "@/components/clients/ClientProfileAssets";
import ClientDocumentsTab from "@/components/clients/ClientDocumentsTab";
import ClientNotesTab from "@/components/clients/ClientNotesTab";
import ClientAccountAlerts from "@/components/clients/ClientAccountAlerts";
import ClientActivityFeed from "@/components/clients/ClientActivityFeed";
import ClientQuickActionsStrip from "@/components/clients/ClientQuickActionsStrip";
import ClientServiceTierChip from "@/components/clients/ClientServiceTierChip";
import ClientPulseWall from "@/components/clients/ClientPulseWall";
import ClientUniverseMap from "@/components/clients/ClientUniverseMap";
import ClientFabricPanel from "@/components/clients/ClientFabricPanel";
import {
  AccountBriefingDialog, ExpansionEngineTile, RenewalForecastTile, ChurnRadarCard,
  LifecycleTimelineCard, ActivityHeatmapCard, HoursBurndownCard, AchievementsCard,
  ContractWatchCard, ScorecardCard, ComplianceCard, AccountPlanCanvas, StakeholderMapCard,
  RenewalWatchTable, MyAccountsTable
} from "@/components/clients/ClientStudioWidgets";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import ConfidenceLens from "@/components/confidence/ConfidenceLens";
import { WorkspaceErrorState, WorkspaceLoadingState } from "@/components/WorkspaceState";

const LIFECYCLE_COLORS = {
  prospect: "text-violet-400 border-violet-500/30 bg-violet-500/5",
  onboarding: "text-sky-400 border-sky-500/30 bg-sky-500/5",
  active: "text-emerald-400 border-emerald-500/30 bg-emerald-500/5",
  at_risk: "text-amber-400 border-amber-500/30 bg-amber-500/5",
  churned: "text-rose-400 border-rose-500/30 bg-rose-500/5",
};

const CLIENT_WORKSPACE_GROUPS = [
  {
    id: "command",
    label: "Command",
    description: "Health, priorities, strategy and AI guidance.",
    icon: Building2,
    tabs: [
      { value: "overview", label: "Digital twin" },
      { value: "fabric", label: "Nexus Fabric" },
      { value: "studio", label: "Growth studio" },
      { value: "plan", label: "Strategic plan" },
      { value: "ai", label: "AI insights" },
    ],
  },
  {
    id: "service",
    label: "Service",
    description: "Support history, collaboration and account notes.",
    icon: Ticket,
    tabs: [
      { value: "tickets", label: "Tickets & jobs" },
      { value: "warroom", label: "War room" },
      { value: "notes", label: "Notes" },
    ],
  },
  {
    id: "technology",
    label: "Technology",
    description: "Assets, security posture and connected services.",
    icon: HardDrive,
    tabs: [
      { value: "assets", label: "Managed assets" },
      { value: "security", label: "Security" },
      { value: "integrations", label: "Integrations" },
      { value: "cipp", label: "Microsoft 365" },
    ],
  },
  {
    id: "commercial",
    label: "Commercial",
    description: "People, services, contracts and account billing.",
    icon: DollarSign,
    tabs: [
      { value: "contacts", label: "Contacts" },
      { value: "subscriptions", label: "Subscriptions" },
      { value: "billing", label: "Billing" },
    ],
  },
  {
    id: "knowledge",
    label: "Knowledge",
    description: "Client documents and service blueprints.",
    icon: FileText,
    tabs: [
      { value: "documents", label: "Documents" },
      { value: "blueprints", label: "Blueprints" },
    ],
  },
  {
    id: "audit",
    label: "Audit",
    description: "One attributable operational timeline.",
    icon: Activity,
    tabs: [{ value: "activity", label: "Operational timeline" }],
  },
];

const CLIENT_TAB_VALUES = new Set(CLIENT_WORKSPACE_GROUPS.flatMap((group) => group.tabs.map((tab) => tab.value)));

function HealthDial({ score, size = 44 }) {
  const s = Math.max(0, Math.min(100, score || 0));
  const color = s >= 85 ? "#34d399" : s >= 70 ? "#fbbf24" : s >= 50 ? "#fb923c" : "#fb7185";
  const stroke = 4, r = (size / 2) - stroke;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - s / 100);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 600ms ease-out" }}
      />
      <text x="50%" y="54%" dominantBaseline="middle" textAnchor="middle" fontSize={size * 0.32} fontWeight="600" fill={color} fontFamily="monospace">{s}</text>
    </svg>
  );
}

function IntegrationChip({ type, active }) {
  const map = {
    acronis: { label: "Backup", color: "text-sky-300 border-sky-500/30 bg-sky-500/[0.06]", tip: "Acronis Cyber Cloud" },
    pax8: { label: "Pax8", color: "text-indigo-300 border-indigo-500/30 bg-indigo-500/[0.06]", tip: "Pax8 / Microsoft CSP" },
    m365: { label: "Microsoft 365", color: "text-blue-300 border-blue-500/30 bg-blue-500/[0.06]", tip: "Microsoft 365" },
    rmm: { label: "Nexus Agent", color: "text-emerald-300 border-emerald-500/30 bg-emerald-500/[0.06]", tip: "Nexus Agent installed" },
    yeastar: { label: "Voice", color: "text-cyan-300 border-cyan-500/30 bg-cyan-500/[0.06]", tip: "Yeastar PBX linked" },
    suped: { label: "DMARC", color: "text-fuchsia-300 border-fuchsia-500/30 bg-fuchsia-500/[0.06]", tip: "Suped DMARC" },
    nexus_dmarc: { label: "Nexus DMARC", color: "text-violet-300 border-violet-500/30 bg-violet-500/[0.06]", tip: "Nexus-owned DMARC evidence and sender intelligence" },
    cipp: { label: "Control Plane", color: "text-cyan-300 border-cyan-500/30 bg-cyan-500/[0.06]", tip: "Nexus Control Plane — Microsoft 365" },
  };
  const cfg = map[type];
  if (!cfg) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[10px] font-medium ${active ? cfg.color : "border-zinc-800 bg-black/10 text-zinc-600 opacity-70"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-current shadow-[0_0_7px_currentColor]" : "bg-zinc-700"}`} />
          {cfg.label}
        </span>
      </TooltipTrigger>
      <TooltipContent><span className="text-xs">{cfg.tip} {active ? "· linked" : "· not linked"}</span></TooltipContent>
    </Tooltip>
  );
}

function ClientListItem({ client, selected, onClick }) {
  const agentReporting = client.assets_assessed > 0;

  return (
    <button
      onClick={onClick}
      data-testid={`client-list-item-${client.id}`}
      className={`w-full text-left flex items-center gap-3 border-b border-zinc-800/80 px-4 py-3.5 transition-colors
        ${selected ? "bg-zinc-900 border-l-2 border-l-indigo-500 pl-[14px]" : "hover:bg-zinc-900/50 border-l-2 border-l-transparent pl-[14px]"}`}
    >
      <HealthDial score={client.health_score} size={36} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-zinc-100 truncate">{client.name}</span>
          {client.lifecycle && client.lifecycle !== "active" && (
            <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${LIFECYCLE_COLORS[client.lifecycle] || LIFECYCLE_COLORS.active}`}>{client.lifecycle.replace("_", " ")}</span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2.5 text-[11px] text-zinc-500">
          {client.industry && <span className="truncate max-w-[108px]">{client.industry}</span>}
          <span className={client.open_tickets > 10 ? "text-amber-400" : ""}><Ticket className="mr-0.5 inline h-3 w-3" />{client.open_tickets || 0}</span>
          <span><HardDrive className="mr-0.5 inline h-3 w-3" />{client.asset_count || 0}</span>
          {client.patch_pending > 0 && <span className="text-amber-400"><Shield className="mr-0.5 inline h-3 w-3" />{client.patch_pending}</span>}
          {client.overdue_count > 0 && <span className="text-rose-400"><AlertTriangle className="mr-0.5 inline h-3 w-3" />{client.overdue_count}</span>}
        </div>
        <div className={`mt-1.5 flex items-center gap-1.5 text-[10px] font-medium ${agentReporting ? "text-emerald-400" : "text-zinc-500"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${agentReporting ? "bg-emerald-400 shadow-[0_0_7px_rgba(52,211,153,0.65)]" : "bg-zinc-600"}`} />
          {agentReporting ? `Agent reporting ${client.assets_assessed}/${client.asset_count || 0}` : "Agent not reporting"}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[10px] uppercase tracking-wide text-zinc-500">MRR</p>
        <p className="mt-0.5 font-mono text-xs font-medium text-zinc-200">${(client.mrr || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
      </div>
    </button>
  );
}

function TopMetric({ label, value, trend, color = "indigo" }) {
  // Delegate to HeroTile for platform-wide consistency. Map legacy color → glow tone.
  const accentMap = { indigo: "violet", violet: "violet", emerald: "emerald", amber: "amber", rose: "rose", red: "rose", sky: "sky", cyan: "cyan", zinc: "zinc" };
  return <MetricTile label={label} value={value} trend={trend} accent={accentMap[color] || "violet"} testid={`clients-metric-${label.toLowerCase().replace(/\s+/g, "-")}`} />;
}

function ClientQuickSearch({ clients = [], activeClientId, onSelect, onBrowsePortfolio }) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const activeClient = useMemo(() => clients.find((client) => client.id === activeClientId), [clients, activeClientId]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return clients
      .filter((client) => !needle || `${client.name || ""} ${client.industry || ""} ${client.email || ""}`.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [clients, query]);

  const chooseClient = (client) => {
    onSelect(client.id);
    setQuery("");
    setExpanded(false);
  };

  return (
    <section className="mx-6 mb-5 overflow-visible rounded-2xl border border-primary/15 bg-[radial-gradient(circle_at_top_left,rgba(139,92,246,0.14),transparent_32%),linear-gradient(135deg,hsl(var(--nx-surface-raised)/0.92),hsl(var(--nx-surface)/0.94))] px-5 py-4 shadow-[0_18px_46px_rgba(0,0,0,0.16)]" aria-label="Client finder">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex shrink-0 items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 shadow-sm"><Search className="h-4 w-4 text-primary" /></span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">Client command</p>
            <p className="mt-0.5 text-sm font-semibold text-foreground">{activeClient ? "Client switcher" : "Open a client"}</p>
            <p className="text-xs text-muted-foreground">{activeClient ? `Viewing ${activeClient.name}` : "Find any account without leaving this workspace."}</p>
          </div>
        </div>
        <div className="relative min-w-0 flex-1 lg:max-w-3xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onFocus={() => setExpanded(true)}
            onBlur={() => window.setTimeout(() => setExpanded(false), 120)}
            onChange={(event) => { setQuery(event.target.value); setExpanded(true); }}
            placeholder="Search clients by name, industry, or primary email..."
            className="h-12 rounded-xl border-primary/20 bg-background/85 pl-10 pr-24 shadow-sm focus-visible:ring-primary/30"
            data-testid="client-quick-search-input"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:block">{clients.length} clients</span>
          {expanded && (
            <div className="absolute z-50 mt-2 max-h-[360px] w-full overflow-y-auto rounded-2xl border border-primary/20 bg-popover p-1.5 shadow-2xl" data-testid="client-quick-search-results">
              {matches.length ? matches.map((client) => {
                const active = client.id === activeClientId;
                return (
                  <button key={client.id} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => chooseClient(client)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${active ? "bg-primary/10 ring-1 ring-primary/20" : "hover:bg-muted/55"}`} data-testid={`client-quick-search-result-${client.id}`}>
                    <HealthDial score={client.health_score} size={34} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">{client.name}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">{[client.industry, client.email].filter(Boolean).join(" - ") || "Client profile"}</span>
                      <span className="mt-1.5 flex flex-wrap gap-1.5">
                        <span className="rounded border border-border/70 bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">{client.open_tickets || 0} open ticket{client.open_tickets === 1 ? "" : "s"}</span>
                        <span className={`rounded border px-1.5 py-0.5 text-[10px] ${client.assets_assessed > 0 ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-300" : "border-border/70 bg-background text-muted-foreground"}`}>{client.assets_assessed > 0 ? "Agent reporting" : "Agent not linked"}</span>
                      </span>
                    </span>
                    <span className={`shrink-0 text-[10px] uppercase tracking-wide ${active ? "text-primary" : "text-muted-foreground"}`}>{active ? "Open" : "View"}</span>
                  </button>
                );
              }) : <div className="px-4 py-9 text-center text-sm text-muted-foreground">No client matches "{query}".</div>}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {activeClient && <Button variant="outline" size="sm" onClick={onBrowsePortfolio} data-testid="browse-client-portfolio">Browse portfolio</Button>}
          <p className="text-xs text-muted-foreground lg:max-w-48">Start typing, then select an account to open its live profile.</p>
        </div>
      </div>
    </section>
  );
}

export default function ClientsPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const clientIdFromUrl = searchParams.get("client");
  const tabFromUrl = searchParams.get("view");
  const onboardingPrompt = searchParams.get("onboarding") === "prompt";
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState({ summary: null, clients: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState("");
  const [lifecycleFilter, setLifecycleFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState("all");
  const [integrationFilter, setIntegrationFilter] = useState("all");
  const [tierFilter, setTierFilter] = useState("all");
  const [tierOptions, setTierOptions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [activity, setActivity] = useState([]);
  const [onboardingSession, setOnboardingSession] = useState(null);
  const [healthDetail, setHealthDetail] = useState(null);
  const [detailTab, setDetailTab] = useState(CLIENT_TAB_VALUES.has(tabFromUrl) ? tabFromUrl : "overview");
  const [detailLoading, setDetailLoading] = useState(false);
  const [createDialog, setCreateDialog] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", industry: "", email: "", phone: "", tier: "standard", lifecycle: "active" });
  const searchRef = useRef(null);

  const openClient = useCallback((id, { preserveView = false } = {}) => {
    setSelectedId(id || null);
    if (!preserveView) setDetailTab("overview");
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (id) next.set("client", id);
      else next.delete("client");
      if (!preserveView || !id) next.delete("view");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const changeDetailTab = useCallback((nextTab) => {
    const safeTab = CLIENT_TAB_VALUES.has(nextTab) ? nextTab : "overview";
    setDetailTab(safeTab);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (selectedId) next.set("client", selectedId);
      if (safeTab === "overview") next.delete("view");
      else next.set("view", safeTab);
      return next;
    }, { replace: true });
  }, [selectedId, setSearchParams]);

  const fetchData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await axios.get(`${API}/clients-enriched`, { headers });
      setData(res.data || { summary: null, clients: [] });
      if (res.data?.clients?.length) {
        const requestedClient = res.data.clients.find(client => client.id === clientIdFromUrl);
        if (requestedClient) openClient(requestedClient.id, { preserveView: true });
        else if (clientIdFromUrl) openClient(null);
      }
    } catch {
      setLoadError("Nexus could not load the client portfolio. No client information has been changed.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); /* eslint-disable-line */ }, []);

  // Load tiers once for the filter dropdown
  useEffect(() => {
    axios.get(`${API}/service-tiers`, { headers })
      .then(r => setTierOptions((r.data || []).filter(t => t.is_active)))
      .catch(() => setTierOptions([]));
    // eslint-disable-next-line
  }, []);

  const fetchDetail = async (id) => {
    if (!id) return;
    setDetailLoading(true);
    try {
      const [cRes, aRes, hRes, oRes] = await Promise.all([
        axios.get(`${API}/clients/${id}`, { headers }),
        axios.get(`${API}/clients/${id}/timeline?limit=300`, { headers }).catch(() => ({ data: { events: [] } })),
        axios.get(`${API}/clients/${id}/health`, { headers }).catch(() => ({ data: null })),
        axios.get(`${API}/onboarding-enhanced/sessions?client_id=${encodeURIComponent(id)}`, { headers }).catch(() => ({ data: { sessions: [] } })),
      ]);
      setDetail(cRes.data);
      setActivity(aRes.data?.events || []);
      setHealthDetail(hRes.data);
      setOnboardingSession((oRes.data?.sessions || []).find((session) => session.status === "in_progress" || session.status === "paused") || null);
    } catch {
      toast.error("Failed to load client");
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => { if (selectedId) fetchDetail(selectedId); /* eslint-disable-line */ }, [selectedId]);

  // Keyboard shortcut: / focuses search; j/k navigate; Esc clears selection
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key === "j" || e.key === "k") {
        const idx = filtered.findIndex(c => c.id === selectedId);
        const next = e.key === "j" ? Math.min(idx + 1, filtered.length - 1) : Math.max(idx - 1, 0);
        if (filtered[next]) openClient(filtered[next].id);
      } else if (e.key === "n" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setCreateDialog(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line
  }, [selectedId, data, openClient]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return (data.clients || []).filter(c => {
      if (q && !(`${c.name} ${c.industry || ""} ${c.email || ""}`.toLowerCase().includes(q))) return false;
      if (lifecycleFilter !== "all" && c.lifecycle !== lifecycleFilter) return false;
      if (riskFilter !== "all" && c.risk_level !== riskFilter) return false;
      if (integrationFilter !== "all" && !c.integrations[integrationFilter]) return false;
      if (tierFilter === "untiered" && c.service_tier_id) return false;
      if (tierFilter !== "all" && tierFilter !== "untiered" && c.service_tier_id !== tierFilter) return false;
      return true;
    });
  }, [data, search, lifecycleFilter, riskFilter, integrationFilter, tierFilter]);

  const selectedClient = useMemo(() => data.clients?.find(c => c.id === selectedId), [data, selectedId]);
  const onboardingProgress = onboardingSession
    ? Math.round((Object.values(onboardingSession.steps || {}).filter((step) => step.status === "completed").length / Math.max(Object.keys(onboardingSession.steps || {}).length, 1)) * 100)
    : 0;

  const createClient = async () => {
    if (!createForm.name) { toast.error("Name required"); return; }
    try {
      const response = await axios.post(`${API}/clients`, createForm, { headers });
      const createdClient = response.data;
      setCreateDialog(false);
      setCreateForm({ name: "", industry: "", email: "", phone: "", tier: "standard", lifecycle: "active" });
      setSelectedId(createdClient.id);
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.set("client", createdClient.id);
        next.set("onboarding", "prompt");
        return next;
      });
      await fetchData();
      toast.success(`${createdClient.name} created — ready for onboarding`);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const dismissOnboardingPrompt = () => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("onboarding");
      return next;
    });
  };

  const startClientOnboarding = async () => {
    if (!selectedClient) return;
    try {
      const response = await axios.post(`${API}/onboarding-enhanced/sessions`, {
        client_id: selectedClient.id,
        client_name: selectedClient.name,
        template: selectedClient.lifecycle === "prospect" ? "small_office" : "mid_market",
      }, { headers });
      dismissOnboardingPrompt();
      toast.success("Client Onboarding is ready");
      navigate(`/onboarding?session=${encodeURIComponent(response.data.id)}`);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not start client onboarding");
    }
  };

  if (loading) return <WorkspaceLoadingState label="Loading client portfolio" />;
  if (loadError) return <WorkspaceErrorState title="Client portfolio is unavailable" description={loadError} onRetry={fetchData} retryLabel="Retry clients" />;

  const s = data.summary || {};
  const attentionClients = (data.clients || [])
    .filter(client => client.patch_pending > 0 || client.risk_level === "critical" || client.risk_level === "at_risk")
    .sort((a, b) => (b.patch_pending || 0) - (a.patch_pending || 0) || (a.health_score || 0) - (b.health_score || 0));
  const clientWorkspaceSignal = attentionClients.some(client => client.risk_level === "critical" || (client.health_score || 100) < 60)
    ? "critical"
    : attentionClients.length > 0 || (s.patch_pending || 0) > 0
      ? "attention"
      : (s.client_count || 0) > 0
        ? "healthy"
        : "recommendation";

  return (
    <TooltipProvider delayDuration={200}>
      <div className="min-h-[calc(100vh-64px)] bg-zinc-950 text-zinc-100 flex flex-col" data-testid="clients-page">
        <div className="px-6 pt-6">
          <OperationalPageHeader
            eyebrow="Client operations"
            title="Clients"
            description="Manage account health, service tiers, subscriptions, risks, documents, and client communications from one operational workspace."
            icon={Building2}
            tone="violet"
            signal={clientWorkspaceSignal}
            actions={<>
              <Button variant="outline" size="sm" onClick={fetchData} data-testid="refresh-clients-btn"><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5" data-testid="clients-workspace-more"><MoreHorizontal className="h-3.5 w-3.5" />Workspace<ChevronDown className="h-3 w-3 opacity-60" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onClick={() => navigate("/client-insights")} className="gap-2.5"><BarChart3 className="h-4 w-4 text-violet-300" />Client insights</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate("/client-compare")} className="gap-2.5"><Scale className="h-4 w-4 text-sky-300" />Compare clients</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate("/client-portal")} className="gap-2.5"><Globe className="h-4 w-4 text-cyan-300" />Client portal</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button size="sm" onClick={() => setCreateDialog(true)} data-testid="new-client-btn"><Plus className="w-4 h-4 mr-1" />New client</Button>
            </>}
          />
        </div>
        <div className="px-6 py-5 border-b border-zinc-900/60">
          <MetricStrip columns={4}>
            <TopMetric label="Clients" value={s.client_count || 0} trend={s.prospects ? `+${s.prospects} prospect${s.prospects !== 1 ? "s" : ""}` : "managed portfolio"} color="indigo" />
            <TopMetric label="Assessed Endpoints" value={s.assessed_endpoints || 0} trend="Nexus Agent evidence" color="sky" />
            <TopMetric label="Patch Exposure" value={s.patch_pending || 0} trend={(s.patch_pending || 0) > 0 ? "updates need review" : "no agent-reported updates"} color={(s.patch_pending || 0) > 0 ? "amber" : "emerald"} />
            <TopMetric label="Needs Attention" value={attentionClients.length} trend={attentionClients.length ? "service risk identified" : "all clear"} color={attentionClients.length ? "rose" : "emerald"} />
          </MetricStrip>
        </div>
        <ClientQuickSearch clients={data.clients || []} activeClientId={selectedId} onSelect={openClient} onBrowsePortfolio={() => openClient(null)} />

        <div className="flex min-h-0 flex-1">
          {/* Master list */}
          {!selectedClient && <aside className="flex w-full flex-col border-r border-zinc-800 bg-zinc-950 md:w-[42%] lg:w-[420px] lg:max-w-[44%]">
            <div className="border-b border-zinc-800 px-3 py-2 space-y-2">
              <div className="flex items-center gap-2">
                <Search className="w-4 h-4 text-zinc-500 shrink-0" />
                <Input
                  ref={searchRef}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search clients (press /)..."
                  className="h-8 bg-transparent border-0 focus-visible:ring-0 focus-visible:border-0 px-1 text-sm"
                  data-testid="clients-search-input"
                />
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <Select value={lifecycleFilter} onValueChange={setLifecycleFilter}>
                  <SelectTrigger className="h-6 text-[11px] bg-zinc-900 border-zinc-800 w-auto gap-1" data-testid="filter-lifecycle"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All stages</SelectItem>
                    <SelectItem value="prospect">Prospect</SelectItem>
                    <SelectItem value="onboarding">Onboarding</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="at_risk">At Risk</SelectItem>
                    <SelectItem value="churned">Churned</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={riskFilter} onValueChange={setRiskFilter}>
                  <SelectTrigger className="h-6 text-[11px] bg-zinc-900 border-zinc-800 w-auto gap-1" data-testid="filter-risk"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All health</SelectItem>
                    <SelectItem value="healthy">Healthy 85+</SelectItem>
                    <SelectItem value="attention">Needs attention</SelectItem>
                    <SelectItem value="at_risk">At risk</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={integrationFilter} onValueChange={setIntegrationFilter}>
                  <SelectTrigger className="h-6 text-[11px] bg-zinc-900 border-zinc-800 w-auto gap-1" data-testid="filter-integration"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All integrations</SelectItem>
                    <SelectItem value="acronis">Acronis linked</SelectItem>
                    <SelectItem value="pax8">Pax8 linked</SelectItem>
                    <SelectItem value="m365">M365 linked</SelectItem>
                    <SelectItem value="rmm">RMM active</SelectItem>
                    <SelectItem value="yeastar">Yeastar PBX linked</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={tierFilter} onValueChange={setTierFilter}>
                  <SelectTrigger className="h-6 text-[11px] bg-zinc-900 border-zinc-800 w-auto gap-1" data-testid="filter-tier"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All tiers</SelectItem>
                    <SelectItem value="untiered">Untiered</SelectItem>
                    {tierOptions.map(t => (
                      <SelectItem key={t.id} value={t.id} data-testid={`filter-tier-${t.slug}`}>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ background: t.color }} />
                          {t.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(search || lifecycleFilter !== "all" || riskFilter !== "all" || integrationFilter !== "all" || tierFilter !== "all") && (
                  <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] text-zinc-500" onClick={() => { setSearch(""); setLifecycleFilter("all"); setRiskFilter("all"); setIntegrationFilter("all"); setTierFilter("all"); }}>
                    <X className="w-2.5 h-2.5 mr-1" />Clear
                  </Button>
                )}
              </div>
              <div className="text-[10px] text-zinc-500 font-mono flex justify-between px-1">
                <span>{filtered.length} of {data.clients?.length || 0}</span>
                <span>press j/k to navigate · / search · ⌘N new</span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {!search && lifecycleFilter === "all" && riskFilter === "all" && integrationFilter === "all" && tierFilter === "all" && attentionClients.length > 0 && (
                <div className="p-3 border-b border-amber-500/20 bg-amber-500/[0.04]">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-amber-300 font-semibold mb-2"><AlertTriangle className="w-3 h-3" />Needs attention</div>
                  <div className="flex flex-wrap gap-1.5">
                    {attentionClients.slice(0, 4).map(client => <button key={client.id} onClick={() => openClient(client.id)} className="text-[10px] px-2 py-1 rounded border border-amber-500/20 text-amber-200 hover:bg-amber-500/10">{client.name}{client.patch_pending ? ` · ${client.patch_pending} patches` : ""}</button>)}
                  </div>
                </div>
              )}
              {filtered.length === 0 ? (
                <div className="p-8 text-center text-sm text-zinc-500">
                  <Filter className="w-8 h-8 mx-auto mb-3 opacity-40" />
                  No clients match these filters.
                </div>
              ) : (
                filtered.map(c => (
                  <ClientListItem key={c.id} client={c} selected={selectedId === c.id} onClick={() => openClient(c.id)} />
                ))
              )}
            </div>
          </aside>}

          {/* Detail pane */}
          <main className={`relative overflow-y-auto bg-zinc-900/30 ${selectedClient ? "w-full" : "flex-1"}`}>
            {!selectedClient ? (
              <div className="p-4 space-y-4" data-testid="client-studio-home">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-violet-300" />Client Studio
                    </h2>
                    <p className="text-xs text-muted-foreground">Pick a client from the sidebar, or explore the universe below.</p>
                  </div>
                </div>
                <RenewalWatchTable onOpen={openClient} />
                <MyAccountsTable onOpen={openClient} />
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-zinc-400 mb-2 px-1">Universe Map</p>
                  <ClientUniverseMap />
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-zinc-400 mb-2 px-1">Pulse Wall</p>
                  <ClientPulseWall search={search} tierFilter={tierFilter} />
                </div>
              </div>
            ) : (
              <>
                {onboardingPrompt && (
                  <section className="mx-4 mt-4 overflow-hidden rounded-2xl border border-cyan-400/25 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.16),transparent_42%),linear-gradient(135deg,rgba(8,28,36,0.96),rgba(12,14,20,0.98))] p-4 shadow-[0_16px_40px_rgba(0,0,0,0.18)]" data-testid="client-onboarding-prompt">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="flex items-start gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-400/25 bg-emerald-400/10"><Rocket className="h-5 w-5 text-emerald-300" /></span>
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300">Recommended next mission</p>
                          <h2 className="mt-1 text-base font-semibold text-foreground">Set up {selectedClient.name} with Client Onboarding</h2>
                          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">Create one linked, auditable delivery plan for contacts, assets, security, services, billing, documentation and go-live checks.</p>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <Button variant="outline" size="sm" onClick={dismissOnboardingPrompt}>I’ll do this later</Button>
                        <Button size="sm" onClick={startClientOnboarding} data-testid="start-client-onboarding"><Rocket className="mr-1.5 h-4 w-4" />Start Client Onboarding</Button>
                      </div>
                    </div>
                  </section>
                )}
                {onboardingSession && !onboardingPrompt && (
                  <section className="mx-4 mt-4 overflow-hidden rounded-2xl border border-sky-400/20 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.13),transparent_42%),linear-gradient(135deg,rgba(10,25,34,0.96),rgba(12,14,20,0.98))] p-4 shadow-sm" data-testid="client-active-onboarding">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="flex items-start gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-400/10"><Rocket className="h-5 w-5 text-cyan-200" /></span>
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300">Active client onboarding</p>
                          <h2 className="mt-1 text-base font-semibold text-foreground">{onboardingProgress}% ready · Step {onboardingSession.current_step || 1} of {onboardingSession.total_steps || 8}</h2>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">Owner: <span className="font-medium text-foreground">{onboardingSession.owner_name || onboardingSession.created_by || "Unassigned"}</span> · Last activity by {onboardingSession.last_activity_by || onboardingSession.created_by || "Nexus"} {onboardingSession.last_activity_at ? formatDistanceToNow(new Date(onboardingSession.last_activity_at), { addSuffix: true }) : "recently"}.</p>
                        </div>
                      </div>
                      <Button size="sm" onClick={() => navigate(`/onboarding?session=${encodeURIComponent(onboardingSession.id)}`)} data-testid="continue-client-onboarding"><Rocket className="mr-1.5 h-4 w-4" />Continue onboarding</Button>
                    </div>
                  </section>
                )}
                <ClientDetailPane
                  client={selectedClient}
                  detail={detail}
                  activity={activity}
                  healthDetail={healthDetail}
                  tab={detailTab}
                  setTab={changeDetailTab}
                  loading={detailLoading}
                  onClose={() => openClient(null)}
                />
              </>
            )}
          </main>
        </div>

        {/* Create dialog */}
        <Dialog open={createDialog} onOpenChange={setCreateDialog}>
          <NexusWorkflowDialog eyebrow="Client operations" title="Create a new client" description="Start the canonical Nexus relationship that tickets, assets, services, contracts, billing, integrations, and audit records will use." icon={Building2} tone="violet" className="max-w-2xl" data-testid="new-client-dialog" footer={<><Button variant="outline" onClick={() => setCreateDialog(false)}>Cancel</Button><Button onClick={createClient} data-testid="create-client-btn"><Plus className="mr-1.5 h-4 w-4" />Create client record</Button></>}>
            <div className="space-y-5">
              <section>
                <div className="mb-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Organisation</p>
                  <p className="mt-1 text-xs text-muted-foreground">The identity technicians will see throughout NexusMSP.</p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1.5 md:col-span-2">
                    <span className="text-xs font-medium text-foreground">Client name <span className="text-rose-400">*</span></span>
                    <Input placeholder="Organisation or trading name" value={createForm.name} onChange={e => setCreateForm({ ...createForm, name: e.target.value })} data-testid="new-client-name" />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-xs font-medium text-foreground">Industry</span>
                    <Input placeholder="Legal, healthcare, manufacturing…" value={createForm.industry} onChange={e => setCreateForm({ ...createForm, industry: e.target.value })} />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-xs font-medium text-foreground">Lifecycle stage</span>
                    <Select value={createForm.lifecycle} onValueChange={v => setCreateForm({ ...createForm, lifecycle: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="prospect">Prospect</SelectItem>
                        <SelectItem value="onboarding">Onboarding</SelectItem>
                        <SelectItem value="active">Active client</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                </div>
              </section>

              <section className="rounded-xl border border-border/70 bg-card/30 p-4">
                <div className="mb-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Primary contact channel</p>
                  <p className="mt-1 text-xs text-muted-foreground">Used as the initial account contact until people are added to the client record.</p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className="text-xs font-medium text-foreground">Primary email</span>
                    <Input type="email" placeholder="support@client.example" value={createForm.email} onChange={e => setCreateForm({ ...createForm, email: e.target.value })} />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-xs font-medium text-foreground">Phone</span>
                    <Input placeholder="+61 …" value={createForm.phone} onChange={e => setCreateForm({ ...createForm, phone: e.target.value })} />
                  </label>
                </div>
              </section>

              <section className="flex flex-col gap-3 rounded-xl border border-primary/15 bg-primary/[0.035] p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-medium text-foreground">Initial service tier</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">This can be refined later through the managed service-tier catalogue.</p>
                </div>
                <Select value={createForm.tier} onValueChange={v => setCreateForm({ ...createForm, tier: v })}>
                  <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">Standard</SelectItem>
                    <SelectItem value="silver">Silver</SelectItem>
                    <SelectItem value="gold">Gold</SelectItem>
                    <SelectItem value="platinum">Platinum</SelectItem>
                  </SelectContent>
                </Select>
              </section>
            </div>
          </NexusWorkflowDialog>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

function ClientWorkspaceNavigation({ value, onChange }) {
  const activeGroup = CLIENT_WORKSPACE_GROUPS.find((group) => group.tabs.some((tab) => tab.value === value)) || CLIENT_WORKSPACE_GROUPS[0];
  const ActiveIcon = activeGroup.icon;

  return (
    <div className="border-b border-border/75 bg-[linear-gradient(180deg,rgba(24,24,27,0.72),rgba(9,9,11,0.3))]" data-testid="client-workspace-navigation">
      <div className="grid grid-cols-2 gap-1.5 p-2 sm:grid-cols-3 xl:grid-cols-6">
        {CLIENT_WORKSPACE_GROUPS.map((group) => {
          const Icon = group.icon;
          const active = group.id === activeGroup.id;
          return (
            <button
              key={group.id}
              type="button"
              onClick={() => onChange(group.tabs[0].value)}
              className={`group flex min-w-0 items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition ${
                active
                  ? "border-primary/30 bg-primary/[0.11] text-foreground shadow-[0_8px_24px_rgba(45,212,191,0.06)]"
                  : "border-transparent text-muted-foreground hover:border-border/80 hover:bg-muted/35 hover:text-foreground"
              }`}
              data-testid={`client-nav-group-${group.id}`}
            >
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${active ? "border-primary/25 bg-primary/10 text-primary" : "border-border/70 bg-background/45 group-hover:text-primary"}`}>
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold">{group.label}</span>
                <span className="mt-0.5 block truncate text-[9px] uppercase tracking-[0.12em] opacity-60">{group.tabs.length} view{group.tabs.length === 1 ? "" : "s"}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-col gap-3 border-t border-white/[0.05] px-3 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          <ActiveIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">{activeGroup.label} workspace</p>
            <p className="truncate text-xs text-muted-foreground">{activeGroup.description}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={`${activeGroup.label} views`}>
          {activeGroup.tabs.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={value === item.value}
              onClick={() => onChange(item.value)}
              className={`h-8 rounded-lg border px-3 text-[11px] font-medium transition ${
                value === item.value
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-border/60 bg-background/35 text-muted-foreground hover:border-primary/20 hover:text-foreground"
              }`}
              data-testid={`tab-${item.value}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ClientDigitalTwinOverview({ client, activity, healthDetail, onNavigate }) {
  const integrations = client.integrations || {};
  const nextAction = client.overdue_count > 0
    ? {
        eyebrow: "Commercial exception",
        title: `Reconcile $${(client.overdue_amount || 0).toLocaleString()} overdue`,
        body: "Review the affected invoices, record correspondence, and keep the collection trail attributable.",
        action: "Open billing",
        tab: "billing",
        tone: "rose",
      }
    : client.open_tickets > 10
      ? {
          eyebrow: "Service pressure",
          title: `${client.open_tickets} open tickets need review`,
          body: "Inspect repeat demand, ownership, SLA exposure, and whether a coordinated response is required.",
          action: "Review service work",
          tab: "tickets",
          tone: "amber",
        }
      : client.health_score < 70
        ? {
            eyebrow: "Health intervention",
            title: `Restore the client health score from ${client.health_score}`,
            body: "Use the evidence breakdown to identify the weakest operational relationship before taking action.",
            action: "Open security posture",
            tab: "security",
            tone: "amber",
          }
        : !integrations.rmm || !integrations.m365 || !integrations.acronis
          ? {
              eyebrow: "Coverage gap",
              title: "Complete the client service map",
              body: "One or more core management, Microsoft, or backup relationships are not yet linked to this account.",
              action: "Review integrations",
              tab: "integrations",
              tone: "cyan",
            }
          : {
              eyebrow: "Account opportunity",
              title: "Prepare the next client review",
              body: "The account is stable. Review outcomes, renewal readiness, and the next evidence-backed improvement.",
              action: "Open growth studio",
              tab: "studio",
              tone: "emerald",
            };

  const toneClasses = {
    rose: "border-rose-500/25 from-rose-500/[0.11]",
    amber: "border-amber-500/25 from-amber-500/[0.11]",
    cyan: "border-cyan-500/25 from-cyan-500/[0.11]",
    emerald: "border-emerald-500/25 from-emerald-500/[0.11]",
  };

  const relationships = [
    { label: "People", value: client.contact_count || 0, detail: "contacts", healthy: (client.contact_count || 0) > 0, tab: "contacts" },
    { label: "Managed estate", value: client.asset_count || 0, detail: `${client.assets_online || 0} online`, healthy: (client.asset_count || 0) > 0, tab: "assets" },
    { label: "Agreements", value: client.active_contracts || 0, detail: "active", healthy: (client.active_contracts || 0) > 0, tab: "subscriptions" },
    { label: "Microsoft 365", value: integrations.m365 ? "Linked" : "Missing", detail: "tenant relationship", healthy: !!integrations.m365, tab: "cipp" },
    { label: "Voice", value: integrations.yeastar ? "Linked" : "Missing", detail: "PBX relationship", healthy: !!integrations.yeastar, tab: "integrations" },
    { label: "Backups", value: integrations.acronis ? "Linked" : "Missing", detail: "protection source", healthy: !!integrations.acronis, tab: "integrations" },
  ];

  const breakdown = healthDetail?.breakdown;
  const dimensions = breakdown ? [
    { key: "tickets", label: "Tickets", max: 30 },
    { key: "sla", label: "SLA", max: 20 },
    { key: "devices", label: "Devices", max: breakdown.m365_hygiene != null ? 15 : 20 },
    { key: "payments", label: "Payments", max: 20 },
    { key: "contracts", label: "Contracts", max: breakdown.m365_hygiene != null ? 5 : 10 },
    ...(breakdown.m365_hygiene != null ? [{ key: "m365_hygiene", label: "Microsoft 365", max: 10 }] : []),
  ] : [];

  return (
    <div className="space-y-4" data-testid="client-digital-twin-overview">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.35fr)]">
        <section className={`rounded-2xl border bg-gradient-to-br ${toneClasses[nextAction.tone]} to-card/45 p-5 shadow-sm`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-primary">{nextAction.eyebrow}</p>
              <h3 className="mt-2 text-lg font-semibold tracking-tight text-foreground">{nextAction.title}</h3>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{nextAction.body}</p>
            </div>
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
              <Sparkles className="h-4.5 w-4.5" />
            </span>
          </div>
          <Button type="button" size="sm" className="mt-5 gap-1.5" onClick={() => onNavigate(nextAction.tab)} data-testid="client-next-best-action">
            {nextAction.action}<ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </section>

        <section className="rounded-2xl border border-border/70 bg-card/35 p-5 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-primary">Relationship coverage</p>
              <h3 className="mt-1 text-base font-semibold text-foreground">Client digital twin</h3>
            </div>
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"><CheckCircle2 className="h-3 w-3 text-emerald-400" />Live Nexus relationships</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3">
            {relationships.map((relationship) => (
              <button
                key={relationship.label}
                type="button"
                onClick={() => onNavigate(relationship.tab)}
                className="group rounded-xl border border-border/70 bg-background/35 p-3 text-left transition hover:border-primary/25 hover:bg-primary/[0.05]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] uppercase tracking-[0.13em] text-muted-foreground">{relationship.label}</span>
                  <span className={`h-1.5 w-1.5 rounded-full ${relationship.healthy ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.65)]" : "bg-amber-400"}`} />
                </div>
                <p className={`mt-2 text-sm font-semibold ${relationship.healthy ? "text-foreground" : "text-amber-300"}`}>{relationship.value}</p>
                <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{relationship.detail}</p>
              </button>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-border/70 bg-card/35 p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-primary">Evidence-backed health</p>
            <p className="mt-1 text-sm text-muted-foreground">A transparent score derived from operational records, never an unexplained estimate.</p>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-background/45 px-3 py-2">
            <span className="text-[10px] uppercase tracking-[0.13em] text-muted-foreground">Current score</span>
            <span className="font-mono text-sm font-semibold text-foreground">{healthDetail?.health_score ?? client.health_score ?? "—"}/100</span>
          </div>
        </div>
        {dimensions.length ? (
          <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            {dimensions.map(({ key, label, max }) => {
              const value = breakdown[key] ?? 0;
              const percentage = Math.min(100, (value / max) * 100);
              const color = percentage >= 85 ? "bg-emerald-400" : percentage >= 60 ? "bg-amber-400" : "bg-rose-400";
              return (
                <div key={key} data-testid={`health-breakdown-${key}`}>
                  <div className="flex items-center justify-between gap-2 text-[10px]">
                    <span className="uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
                    <span className="font-mono text-foreground">{value}/{max}</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className={`h-full rounded-full ${color}`} style={{ width: `${percentage}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-5 rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">Health evidence is still being assembled for this account.</div>
        )}
      </section>

      <ClientActivityFeed
        activity={activity}
        limit={10}
        compact
        title="Operational timeline"
        description="The latest attributable tickets, correspondence, billing, asset, change, and audit events for this client."
      />
    </div>
  );
}

function ClientContactsPanel({ clientId, token, onCountChange }) {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const empty = { name: "", email: "", phone: "", role: "general", is_primary: false };
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState(null);
  const [form, setForm] = useState(empty);
  const [deleting, setDeleting] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/clients/${clientId}/contacts`, { headers });
      const rows = Array.isArray(response.data) ? response.data : [];
      setContacts(rows);
      onCountChange?.(rows.length);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not load client contacts");
    } finally { setLoading(false); }
  }, [clientId, headers, onCountChange]);

  useEffect(() => { load(); }, [load]);
  const openCreate = () => { setEditor("create"); setForm({ ...empty, is_primary: contacts.length === 0 }); };
  const openEdit = (contact) => { setEditor(contact); setForm({ ...empty, ...contact }); };
  const save = async () => {
    if (!form.name.trim()) return toast.error("Contact name is required");
    setSaving(true);
    try {
      if (editor === "create") await axios.post(`${API}/clients/${clientId}/contacts`, form, { headers });
      else await axios.put(`${API}/clients/${clientId}/contacts/${editor.id}`, form, { headers });
      toast.success(editor === "create" ? "Contact added" : "Contact updated");
      setEditor(null); await load();
    } catch (error) { toast.error(error.response?.data?.detail || "Could not save contact"); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (!deleting) return;
    setSaving(true);
    try {
      await axios.delete(`${API}/clients/${clientId}/contacts/${deleting.id}`, { headers });
      toast.success(`${deleting.name} removed from this client`);
      setDeleting(null); await load();
    } catch (error) { toast.error(error.response?.data?.detail || "Could not remove contact"); }
    finally { setSaving(false); }
  };

  return <section className="space-y-4" data-testid="client-contacts-panel">
    <div className="flex flex-col gap-3 rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/[0.08] via-card to-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">People & contact channels</p><h2 className="mt-1 text-base font-semibold">Contacts are part of the client record</h2><p className="mt-1 text-xs text-muted-foreground">Keep the primary person, email and phone details accurate for tickets, approvals and service updates.</p></div>
      <Button size="sm" onClick={openCreate} data-testid="client-contact-add"><Plus className="mr-1.5 h-4 w-4" />Add contact</Button>
    </div>
    {loading ? <div className="flex items-center justify-center rounded-2xl border border-border/70 py-12 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading contacts…</div> : contacts.length === 0 ? <div className="rounded-2xl border border-dashed border-border/70 px-5 py-10 text-center"><Users className="mx-auto h-7 w-7 text-muted-foreground" /><p className="mt-3 text-sm font-medium">No contacts yet</p><p className="mt-1 text-xs text-muted-foreground">Add the main person technicians should contact before working this account.</p><Button size="sm" className="mt-4" onClick={openCreate}><Plus className="mr-1.5 h-4 w-4" />Add first contact</Button></div> : <div className="grid gap-3 lg:grid-cols-2">{contacts.map((contact) => <article key={contact.id} className="group rounded-2xl border border-border/70 bg-card/55 p-4 transition hover:border-primary/30 hover:bg-primary/[0.025]">
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-semibold">{contact.name || "Unnamed contact"}</p>{contact.is_primary && <Badge className="border-amber-400/30 bg-amber-400/10 text-amber-200"><Star className="mr-1 h-3 w-3" />Primary</Badge>}</div><p className="mt-1 text-xs capitalize text-muted-foreground">{String(contact.role || "general").replace(/_/g, " ")}</p></div><div className="flex gap-1"><Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(contact)} aria-label={`Edit ${contact.name}`}><Pencil className="h-3.5 w-3.5" /></Button><Button variant="ghost" size="icon" className="h-8 w-8 text-rose-300 hover:bg-rose-500/10 hover:text-rose-200" onClick={() => setDeleting(contact)} aria-label={`Delete ${contact.name}`}><Trash2 className="h-3.5 w-3.5" /></Button></div></div>
      <div className="mt-4 grid gap-2 text-xs">{contact.email ? <a className="flex items-center gap-2 text-sky-300 hover:underline" href={`mailto:${contact.email}`}><Mail className="h-3.5 w-3.5" />{contact.email}</a> : <p className="flex items-center gap-2 text-muted-foreground"><Mail className="h-3.5 w-3.5" />No email recorded</p>}{contact.phone ? <a className="flex items-center gap-2 text-emerald-300 hover:underline" href={`tel:${contact.phone}`}><Phone className="h-3.5 w-3.5" />{contact.phone}</a> : <p className="flex items-center gap-2 text-muted-foreground"><Phone className="h-3.5 w-3.5" />No phone recorded</p>}</div>
    </article>)}</div>}
    <Dialog open={Boolean(editor)} onOpenChange={(open) => !open && setEditor(null)}><NexusWorkflowDialog eyebrow="Client contact workflow" title={editor === "create" ? "Add a client contact" : "Edit client contact"} description="Keep operational contact details correct before they are used for tickets, approvals or customer updates." icon={Users} tone="sky" className="max-w-xl" footer={<><Button variant="outline" onClick={() => setEditor(null)} disabled={saving}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}{editor === "create" ? "Add contact" : "Save changes"}</Button></>}><div className="grid gap-4"><div className="grid gap-2"><Label htmlFor="client-contact-name">Full name</Label><Input id="client-contact-name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. Sarah Jones" autoFocus /></div><div className="grid gap-4 sm:grid-cols-2"><div className="grid gap-2"><Label htmlFor="client-contact-email">Email</Label><Input id="client-contact-email" type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} placeholder="sarah@client.com" /></div><div className="grid gap-2"><Label htmlFor="client-contact-phone">Phone</Label><Input id="client-contact-phone" type="tel" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} placeholder="0400 000 000" /></div></div><div className="grid gap-2"><Label>Contact role</Label><Select value={form.role} onValueChange={(role) => setForm((current) => ({ ...current, role }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="general">General contact</SelectItem><SelectItem value="technical">Technical contact</SelectItem><SelectItem value="billing">Billing contact</SelectItem><SelectItem value="authorised">Authorised approver</SelectItem></SelectContent></Select></div><label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/70 bg-muted/[0.14] p-3"><input type="checkbox" className="mt-0.5" checked={Boolean(form.is_primary)} onChange={(event) => setForm((current) => ({ ...current, is_primary: event.target.checked }))} /><span><span className="text-sm font-medium">Primary contact</span><span className="mt-0.5 block text-xs text-muted-foreground">Use this person as the main contact for the account.</span></span></label></div></NexusWorkflowDialog></Dialog>
    <Dialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}><NexusWorkflowDialog eyebrow="Client contact workflow" title="Remove client contact" description={`Remove ${deleting?.name || "this contact"} from this client record. Tickets and historical audit evidence are retained.`} icon={Trash2} tone="amber" className="max-w-lg" footer={<><Button variant="outline" onClick={() => setDeleting(null)} disabled={saving}>Keep contact</Button><Button variant="destructive" onClick={remove} disabled={saving}>{saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1.5 h-4 w-4" />}Remove contact</Button></>}><p className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3 text-sm text-muted-foreground">This changes the current client contact list only. Nexus retains related ticket, approval and audit history.</p></NexusWorkflowDialog></Dialog>
  </section>;
}

function ClientDetailPane({ client: clientProp, detail: _detail, activity, healthDetail, tab, setTab, loading: _loading, onClose }) {
  const { token, user } = useAuth();
  const [clientLocal, setClientLocal] = useState(clientProp);
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [ticketHistory, setTicketHistory] = useState([]);
  const [ticketHistoryLoading, setTicketHistoryLoading] = useState(false);
  const [serviceJobHistory, setServiceJobHistory] = useState({ workshop: [], field: [] });
  const [serviceJobHistoryLoading, setServiceJobHistoryLoading] = useState(false);
  useEffect(() => { setClientLocal(clientProp); }, [clientProp]);
  useEffect(() => {
    if (!clientProp?.id) return;
    setTicketHistoryLoading(true);
    axios.get(`${API}/tickets?client_id=${encodeURIComponent(clientProp.id)}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(response => setTicketHistory((response.data || []).sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0))))
      .catch(() => setTicketHistory([]))
      .finally(() => setTicketHistoryLoading(false));
  }, [clientProp?.id, token]);
  useEffect(() => {
    if (!clientProp?.id) return;
    setServiceJobHistoryLoading(true);
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      axios.get(`${API}/workshop/jobs?client_id=${encodeURIComponent(clientProp.id)}`, { headers }),
      axios.get(`${API}/field-jobs?client_id=${encodeURIComponent(clientProp.id)}`, { headers }),
    ])
      .then(([workshop, field]) => setServiceJobHistory({
        workshop: (workshop.data || []).sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0)),
        field: (field.data || []).sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0)),
      }))
      .catch(() => setServiceJobHistory({ workshop: [], field: [] }))
      .finally(() => setServiceJobHistoryLoading(false));
  }, [clientProp?.id, token]);
  const client = clientLocal || clientProp;
  const mrrData = client.mrr_trend || [];
  const isAdmin = user?.role === "admin" || user?.is_admin;
  const applyClientPatch = (patch) => setClientLocal(c => ({ ...c, ...patch }));

  return (
    <div className="flex min-h-full flex-col gap-4 p-4 sm:p-5" data-testid="client-detail-pane">
      {/* Cover banner */}
      <section className="nx-ambient-surface overflow-hidden rounded-2xl border border-white/[0.08] bg-[radial-gradient(circle_at_top_right,rgba(45,212,191,0.12),transparent_38%),linear-gradient(135deg,rgba(15,23,42,0.95),rgba(9,12,18,0.98))] shadow-[0_18px_55px_rgba(0,0,0,0.2)]" data-nx-signal={client.health_score < 60 ? "critical" : client.health_score < 85 ? "attention" : "healthy"}>
        <ClientCoverImage client={client} onUpdated={applyClientPatch}>
          <ClientAccountAlerts client={client} />
        </ClientCoverImage>

      {/* Header */}
      <div className="relative -mt-12 grid grid-cols-1 gap-5 px-5 pb-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-end">
        <div className="shrink-0 self-start rounded-2xl bg-background/95 p-1.5 text-center shadow-xl ring-1 ring-white/10">
          <ClientProfilePictureUploader client={client} onUpdated={applyClientPatch} size={88} />
          <p className="mt-1.5 text-[9px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Business logo</p>
        </div>
        <div className="min-w-0 flex-1 pt-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{client.name}</h1>
            <ClientServiceTierChip client={client} isAdmin={isAdmin} onUpdated={applyClientPatch} />
            <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${LIFECYCLE_COLORS[client.lifecycle] || LIFECYCLE_COLORS.active}`}>{(client.lifecycle || "active").replace("_", " ")}</span>
            <button
              type="button"
              onClick={async () => {
                try {
                  const newVip = !client.vip;
                  await axios.post(`${API}/client-studio/${client.id}/vip`, { vip: newVip }, { headers: { Authorization: `Bearer ${token}` } });
                  applyClientPatch({ vip: newVip });
                  toast.success(newVip ? "VIP enabled ⭐" : "VIP removed");
                } catch { toast.error("Failed to toggle VIP"); }
              }}
              data-testid="vip-toggle-btn"
              className={`inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[10px] font-semibold uppercase tracking-wide transition-colors ${client.vip ? "border-amber-400/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20" : "border-zinc-700 text-zinc-500 hover:border-amber-400/40 hover:text-amber-300"}`}
              title={client.vip ? "Remove VIP status" : "Mark as VIP"}
            >
              ⭐ VIP
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
            {client.industry && <span>{client.industry}</span>}
            {client.email && <span className="flex items-center gap-1" data-sensitive="email"><Mail className="w-2.5 h-2.5" />{client.email}</span>}
            {client.phone && <span className="flex items-center gap-1" data-sensitive="phone"><Phone className="w-2.5 h-2.5" />{client.phone}</span>}
            {client.address && <span className="flex items-center gap-1 truncate max-w-[280px]" data-sensitive="address"><MapPin className="w-2.5 h-2.5" />{client.address}</span>}
            {client.website && (
              <a href={client.website.startsWith("http") ? client.website : `https://${client.website}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-cyan-400">
                <ExternalLink className="w-2.5 h-2.5" />{client.website.replace(/^https?:\/\//, "")}
              </a>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5 rounded-xl border border-white/[0.07] bg-black/15 p-2">
            <IntegrationChip type="rmm" active={client.integrations.rmm} />
            <IntegrationChip type="acronis" active={client.integrations.acronis} />
            <IntegrationChip type="pax8" active={client.integrations.pax8} />
            <IntegrationChip type="m365" active={client.integrations.m365} />
            <IntegrationChip type="yeastar" active={client.integrations.yeastar} />
            {client.last_activity && <span className="ml-1 text-[10px] text-muted-foreground">Last activity {formatDistanceToNow(new Date(client.last_activity), { addSuffix: true })}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-black/20 px-2.5 py-1.5">
            <div><p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Service health</p><p className="mt-0.5 text-xs text-foreground">Live account score</p></div>
            <HealthDial score={client.health_score} size={54} />
          </div>
          <ConfidenceLens entityType="client" entityId={client.id} token={token} API={API} variant="compact" />
          {onClose && (
            <button
              type="button"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border/70 bg-background/45 px-3 text-xs text-muted-foreground hover:border-primary/35 hover:bg-muted/50 hover:text-foreground"
              onClick={onClose}
              data-testid="back-to-studio-home-btn"
              title="Return to the client portfolio"
            >
              ← All clients
            </button>
          )}
          <button
            type="button"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border/70 bg-background/45 px-3 text-xs text-foreground hover:border-primary/35 hover:bg-muted/50"
            onClick={() => setBriefingOpen(true)}
            data-testid="ai-briefing-btn"
          >
            ✨ AI Brief
          </button>
          <button
            type="button"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 text-xs text-amber-100 hover:bg-amber-500/20"
            onClick={() => window.open(`${API}/clients/${client.id}/health-certificate.pdf?token=${encodeURIComponent(token)}`, "_blank")}
            data-testid={`health-cert-btn-${client.id}`}
          >
            ★ Certificate
          </button>
        </div>
      </div>
      </section>
      <AccountBriefingDialog clientId={client.id} open={briefingOpen} onClose={() => setBriefingOpen(false)} />

      {/* Quick Actions strip */}
      <section className="rounded-2xl border border-primary/15 bg-[linear-gradient(135deg,rgba(45,212,191,0.055),rgba(9,9,11,0.72))] p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Client command bar</p><p className="mt-1 text-sm text-muted-foreground">Start a traceable operational action without leaving this record.</p></div>
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"><CheckCircle2 className="h-3 w-3 text-emerald-400" />Every action remains linked to {client.name}</span>
        </div>
        <ClientQuickActionsStrip client={client} onOpenWarRoom={() => setTab("warroom")} />
      </section>

      {/* Quick metrics strip */}
      <section className="rounded-2xl border border-border/70 bg-card/25 p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Account pulse</p><p className="mt-1 text-sm text-muted-foreground">Commercial, service and asset context at a glance.</p></div></div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <HeroTile
          label="Monthly Recurring"
          value={`$${client.mrr.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          glow="violet"
          animated={false}
          subtitle={mrrData.length ? "trending" : "—"}
          testId="client-mrr-tile"
        />
        <HeroTile
          label="Open Tickets"
          value={client.open_tickets}
          glow={client.open_tickets > 10 ? "amber" : "cyan"}
          subtitle={client.open_tickets > 10 ? "high volume" : "within range"}
          testId="client-open-tickets-tile"
        />
        <HeroTile
          label="Assets"
          value={client.asset_count}
          glow="emerald"
          subtitle={`${client.assets_online}/${client.asset_count} online`}
          testId="client-assets-tile"
        />
        <HeroTile
          label="Contacts"
          value={client.contact_count}
          glow="cyan"
          subtitle={`${client.active_contracts} active contracts`}
          testId="client-contacts-tile"
        />
        <HeroTile
          label="AR Overdue"
          value={`$${client.overdue_amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          glow={client.overdue_count > 0 ? "rose" : "emerald"}
          animated={false}
          subtitle={`${client.overdue_count} invoice${client.overdue_count !== 1 ? "s" : ""}`}
          testId="client-overdue-tile"
        />
      </div>
      </section>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/70 bg-card/25 shadow-sm">
        <ClientWorkspaceNavigation value={tab} onChange={setTab} />

        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          <TabsContent value="overview" className="mt-0 space-y-3">
            <ClientDigitalTwinOverview client={client} activity={activity} healthDetail={healthDetail} onNavigate={setTab} />
          </TabsContent>

          <TabsContent value="fabric" className="mt-0 space-y-3">
            <ClientFabricPanel clientId={client.id} clientName={client.name} token={token} API={API} isAdmin={isAdmin} />
          </TabsContent>

          <TabsContent value="studio" className="mt-0 space-y-3">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <RenewalForecastTile clientId={client.id} />
              <ExpansionEngineTile clientId={client.id} />
              <HoursBurndownCard clientId={client.id} />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <ChurnRadarCard clientId={client.id} />
              <LifecycleTimelineCard clientId={client.id} />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <ActivityHeatmapCard clientId={client.id} />
              <StakeholderMapCard clientId={client.id} />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <AchievementsCard clientId={client.id} />
              <ContractWatchCard clientId={client.id} />
              <ComplianceCard clientId={client.id} />
            </div>
            <ScorecardCard clientId={client.id} onExport={(_d) => { try { window.print(); } catch {} }} />
          </TabsContent>

          <TabsContent value="plan" className="mt-0 space-y-3">
            <AccountPlanCanvas clientId={client.id} />
          </TabsContent>

          <TabsContent value="tickets" className="mt-0">
            <div className="mb-3 overflow-hidden rounded-xl border border-cyan-500/15 bg-[linear-gradient(135deg,rgba(12,25,33,0.58),rgba(11,13,18,0.92))]">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
                <div><p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-cyan-300">Client service history</p><p className="mt-1 text-sm text-zinc-400">Support tickets, workshop repairs and field work retained together for operational review and audit.</p></div>
                <Link to={`/tickets?clientId=${client.id}`}><Button variant="outline" size="sm" className="h-9 border-cyan-500/25 bg-cyan-500/[0.06] text-cyan-100 hover:bg-cyan-500/[0.14]"><Ticket className="mr-1.5 h-3.5 w-3.5" />Open full queue</Button></Link>
              </div>
              <div className="divide-y divide-white/[0.06]">
                {ticketHistoryLoading ? <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading ticket history</div> : ticketHistory.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">No ticket history has been recorded for this client.</div> : ticketHistory.slice(0, 30).map(ticket => {
                  const closed = ["closed", "resolved"].includes(String(ticket.status || "").toLowerCase());
                  return <Link key={ticket.id} to={`/tickets?ticket=${encodeURIComponent(ticket.id)}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-white/[0.035]">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${closed ? "bg-emerald-400" : ticket.priority === "critical" ? "bg-rose-400" : "bg-cyan-400"}`} />
                    <span className="w-20 shrink-0 font-mono text-[11px] text-zinc-400">{ticket.ticket_number || ticket.id?.slice(0, 8)}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">{ticket.title || "Untitled ticket"}</span>
                    <Badge variant="outline" className={`shrink-0 text-[9px] uppercase ${closed ? "border-emerald-500/25 bg-emerald-500/[0.07] text-emerald-300" : "border-cyan-500/25 bg-cyan-500/[0.07] text-cyan-300"}`}>{closed ? "Closed" : String(ticket.status || "Open").replace("_", " ")}</Badge>
                    <span className="hidden text-right text-[10px] text-zinc-500 sm:block">{closed && ticket.closed_by_name ? <><span className="block">Closed by {ticket.closed_by_name}</span><span>{ticket.closed_at ? new Date(ticket.closed_at).toLocaleDateString() : ""}</span></> : ticket.updated_at ? new Date(ticket.updated_at).toLocaleDateString() : ""}</span>
                  </Link>;
                })}
              </div>
            </div>
            <div className="mb-3 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/35">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
                <div><p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-cyan-300">Linked service jobs</p><p className="mt-1 text-sm text-zinc-400">Workshop and on-site work created against this client. Conversations and audit history remain with each job.</p></div>
                <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-500"><span>{serviceJobHistory.workshop.length} workshop</span><span className="text-zinc-700">|</span><span>{serviceJobHistory.field.length} field</span></div>
              </div>
              {serviceJobHistoryLoading ? <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading linked service jobs</div> : serviceJobHistory.workshop.length + serviceJobHistory.field.length === 0 ? <div className="py-8 text-center text-sm text-zinc-500">No linked workshop or field jobs have been recorded for this client yet.</div> : <div className="divide-y divide-white/[0.06]">
                {serviceJobHistory.workshop.map(job => {
                  const complete = ["collected", "cancelled"].includes(String(job.repair_status || "").toLowerCase());
                  return <Link key={`workshop-${job.id}`} to={`/tickets?service_type=workshop&service_job=${encodeURIComponent(job.id)}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-white/[0.035]" title="Open this workshop job">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${complete ? "bg-emerald-400" : "bg-amber-400"}`} />
                    <Badge variant="outline" className="shrink-0 border-amber-500/25 bg-amber-500/[0.07] text-[9px] uppercase text-amber-300">Workshop</Badge>
                    <span className="w-20 shrink-0 font-mono text-[11px] text-zinc-400">{job.job_number || job.id?.slice(0, 8)}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">{[job.device_brand, job.device_model].filter(Boolean).join(" ") || job.device_type || job.fault_description || "Workshop repair"}</span>
                    <Badge variant="outline" className={`shrink-0 text-[9px] uppercase ${complete ? "border-emerald-500/25 bg-emerald-500/[0.07] text-emerald-300" : "border-amber-500/25 bg-amber-500/[0.07] text-amber-300"}`}>{String(job.repair_status || "checked in").replaceAll("_", " ")}</Badge>
                    <span className="hidden text-right text-[10px] text-zinc-500 sm:block">{job.updated_at ? new Date(job.updated_at).toLocaleDateString() : ""}</span>
                  </Link>;
                })}
                {serviceJobHistory.field.map(job => {
                  const complete = ["completed", "cancelled"].includes(String(job.field_status || "").toLowerCase());
                  return <Link key={`field-${job.id}`} to={`/tickets?service_type=field&service_job=${encodeURIComponent(job.id)}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-white/[0.035]" title="Open this field job">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${complete ? "bg-emerald-400" : "bg-cyan-400"}`} />
                    <Badge variant="outline" className="shrink-0 border-cyan-500/25 bg-cyan-500/[0.07] text-[9px] uppercase text-cyan-300">Field</Badge>
                    <span className="w-20 shrink-0 font-mono text-[11px] text-zinc-400">{job.job_number || job.id?.slice(0, 8)}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">{job.description || job.job_category || "Field service job"}</span>
                    <Badge variant="outline" className={`shrink-0 text-[9px] uppercase ${complete ? "border-emerald-500/25 bg-emerald-500/[0.07] text-emerald-300" : "border-cyan-500/25 bg-cyan-500/[0.07] text-cyan-300"}`}>{String(job.field_status || "scheduled").replaceAll("_", " ")}</Badge>
                    <span className="hidden text-right text-[10px] text-zinc-500 sm:block">{job.scheduled_date || (job.updated_at ? new Date(job.updated_at).toLocaleDateString() : "")}</span>
                  </Link>;
                })}
              </div>}
            </div>
            <div className="border border-zinc-800 rounded-md p-6 text-center text-sm text-zinc-500">
              <Ticket className="w-8 h-8 mx-auto mb-3 opacity-40" />
              Deep ticket view — <Link className="text-indigo-400 hover:underline" to={`/tickets?clientId=${client.id}`}>open full Tickets page</Link>
            </div>}
            <div className="rounded-xl border border-cyan-500/20 bg-[linear-gradient(135deg,rgba(8,47,73,0.28),rgba(9,9,11,0.96))] p-4" data-testid="client-voice-service-card">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><Phone className="h-4 w-4 text-cyan-300" /><span className="font-medium">Voice / Yeastar PBX</span></div>
                <Badge variant="outline" className={client.integrations.yeastar ? (client.voice?.status === "online" ? "border-emerald-500/30 text-emerald-300" : "border-amber-500/30 text-amber-300") : "text-zinc-500"}>{client.integrations.yeastar ? (client.voice?.status === "online" ? "Online" : "Needs review") : "Not linked"}</Badge>
              </div>
              {client.integrations.yeastar ? <div className="mb-3 grid grid-cols-3 gap-2 text-center"><div className="rounded-lg border border-white/[0.06] bg-black/15 p-2"><p className="text-lg font-semibold">{client.voice?.pbx_count || 0}</p><p className="text-[9px] uppercase tracking-wider text-zinc-500">PBXs</p></div><div className="rounded-lg border border-white/[0.06] bg-black/15 p-2"><p className="text-lg font-semibold">{client.voice?.extension_count || 0}</p><p className="text-[9px] uppercase tracking-wider text-zinc-500">Extensions</p></div><div className="rounded-lg border border-white/[0.06] bg-black/15 p-2"><p className="text-lg font-semibold text-emerald-300">{client.voice?.billable_extension_count || 0}</p><p className="text-[9px] uppercase tracking-wider text-zinc-500">Billable</p></div></div> : <p className="mb-3 text-xs text-zinc-500">No PBX is attached to this client. Linking one keeps extensions, billing, and activity isolated to this account.</p>}
              <Link to={`/voice?tab=pbxs&clientId=${encodeURIComponent(client.id)}`} className="inline-flex items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200 hover:underline">{client.integrations.yeastar ? "Open this client’s PBXs" : "Link a PBX in Voice"} <ChevronRight className="h-3 w-3" /></Link>
            </div>
          </TabsContent>

          <TabsContent value="warroom" className="mt-0">
            <ClientWarRoom clientId={client.id} />
          </TabsContent>

          <TabsContent value="assets" className="mt-0">
            <Client360Assets clientId={client.id} token={token} />
          </TabsContent>

          <TabsContent value="documents" className="mt-0">
            <ClientDocumentsTab client={client} />
          </TabsContent>

          <TabsContent value="notes" className="mt-0">
            <ClientNotesTab client={client} />
          </TabsContent>

          <TabsContent value="subscriptions" className="mt-0">
            <Client360Subscriptions clientId={client.id} token={token} />
          </TabsContent>

          <TabsContent value="security" className="mt-0">
            <Client360Security clientId={client.id} token={token} />
          </TabsContent>

          <TabsContent value="contacts" className="mt-0">
            <ClientContactsPanel
              clientId={client.id}
              token={token}
              onCountChange={(contact_count) => applyClientPatch({ contact_count })}
            />
          </TabsContent>

          <TabsContent value="billing" className="mt-0 space-y-2">
            <Client360Billing clientId={client.id} token={token} />
          </TabsContent>

          <TabsContent value="blueprints" className="mt-0">
            <ClientBlueprintsPanel clientId={client.id} />
          </TabsContent>

          <TabsContent value="ai" className="mt-0">
            <ClientAIBundle clientId={client.id} />
          </TabsContent>

          <TabsContent value="integrations" className="mt-0 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="border border-zinc-800 rounded-md p-4 bg-zinc-950">
              <div className="flex items-center gap-2 mb-2"><Cloud className="w-4 h-4 text-sky-400" /><span className="font-medium">Acronis</span>
                <Badge variant="outline" className={client.integrations.acronis ? "text-emerald-400 border-emerald-500/30" : "text-zinc-500"}>{client.integrations.acronis ? "Linked" : "Not linked"}</Badge>
              </div>
              <Link to="/backup-compliance" className="text-xs text-indigo-400 hover:underline">Manage in Backup Command Center →</Link>
            </div>
            <div className="border border-zinc-800 rounded-md p-4 bg-zinc-950">
              <div className="flex items-center gap-2 mb-2"><Cloud className="w-4 h-4 text-indigo-400" /><span className="font-medium">Pax8 / Microsoft CSP</span>
                <Badge variant="outline" className={client.integrations.pax8 ? "text-emerald-400 border-emerald-500/30" : "text-zinc-500"}>{client.integrations.pax8 ? "Linked" : "Not linked"}</Badge>
              </div>
              <Link to="/pax8" className="text-xs text-indigo-400 hover:underline">Manage in Pax8 Command Center →</Link>
            </div>
            <div className="border border-zinc-800 rounded-md p-4 bg-zinc-950">
              <div className="flex items-center gap-2 mb-2"><Shield className="w-4 h-4 text-blue-400" /><span className="font-medium">Microsoft 365</span>
                <Badge variant="outline" className={client.integrations.m365 ? "text-emerald-400 border-emerald-500/30" : "text-zinc-500"}>{client.integrations.m365 ? "Linked" : "Not linked"}</Badge>
              </div>
            </div>
            <div className="border border-zinc-800 rounded-md p-4 bg-zinc-950">
              <div className="flex items-center gap-2 mb-2"><HardDrive className="w-4 h-4 text-emerald-400" /><span className="font-medium">RMM Agent</span>
                <Badge variant="outline" className={client.integrations.rmm ? "text-emerald-400 border-emerald-500/30" : "text-zinc-500"}>{client.integrations.rmm ? "Active" : "Inactive"}</Badge>
              </div>
              <p className="text-[11px] text-zinc-500">{client.asset_count} agents ({client.assets_online} online)</p>
            </div>
            <div className="rounded-xl border border-cyan-400/20 bg-gradient-to-br from-cyan-500/[0.08] via-zinc-950 to-zinc-950 p-4 shadow-[0_16px_36px_rgba(8,145,178,0.08)] [&>a]:hidden [&>p.mt-2]:hidden [&>div.mt-3.grid]:hidden" data-testid="client-voice-service-card">
              <div className="flex items-start justify-between gap-3"><div className="flex items-center gap-2"><Phone className="h-4 w-4 text-cyan-300" /><span className="font-medium text-zinc-100">Voice services</span></div>
                <Badge variant="outline" className={client.voice?.linked ? (client.voice?.status === "online" ? "border-emerald-400/30 text-emerald-300" : "border-amber-400/30 text-amber-300") : "border-zinc-700 text-zinc-500"}>{client.voice?.linked ? (client.voice?.status === "online" ? "Online" : "Needs review") : "Not linked"}</Badge>
              </div>
              {client.voice?.linked ? <div className="mt-3"><p className="text-[11px] text-zinc-400">{client.voice.pbx_count} PBX{client.voice.pbx_count === 1 ? "" : "s"} linked / {client.voice.online_count} online</p><div className="mt-3 grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg border border-white/5 bg-black/20 px-2.5 py-2"><p className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Extensions</p><p className="mt-1 font-semibold text-zinc-100">{client.voice.extension_count}</p></div><div className="rounded-lg border border-white/5 bg-black/20 px-2.5 py-2"><p className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Billable</p><p className="mt-1 font-semibold text-cyan-200">{client.voice.billable_extension_count}</p></div></div><Link to={`/voice?tab=pbxs&clientId=${encodeURIComponent(client.id)}`} className="mt-3 inline-flex items-center text-xs font-medium text-cyan-300 transition-colors hover:text-cyan-100">Open linked PBXs <span aria-hidden="true" className="ml-1">→</span></Link></div> : <div className="mt-2.5"><p className="text-[11px] leading-relaxed text-zinc-500">Link this client to a Yeastar PBX to govern extensions and prepare recurring billing.</p><Link to={`/voice?tab=pbxs&clientId=${encodeURIComponent(client.id)}`} className="mt-3 inline-flex items-center text-xs font-medium text-cyan-300 transition-colors hover:text-cyan-100">Link a PBX <span aria-hidden="true" className="ml-1">→</span></Link></div>}
              {client.voice?.linked ? <><p className="mt-2 text-[11px] text-zinc-400">{client.voice.pbx_count} PBX{client.voice.pbx_count === 1 ? "" : "s"} linked · {client.voice.online_count} online</p><div className="mt-3 grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg border border-white/5 bg-black/20 px-2.5 py-2"><p className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Extensions</p><p className="mt-1 font-semibold text-zinc-100">{client.voice.extension_count}</p></div><div className="rounded-lg border border-white/5 bg-black/20 px-2.5 py-2"><p className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Billable</p><p className="mt-1 font-semibold text-cyan-200">{client.voice.billable_extension_count}</p></div></div></> : <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">Link this client to a Yeastar PBX to govern extensions and prepare recurring billing.</p>}
              <Link to="/voice" className="text-xs text-cyan-400 hover:underline">Manage in Voice workspace →</Link>
            </div>
          </TabsContent>

          <TabsContent value="cipp" className="mt-0">
            <CippTenantPanel client={client} />
          </TabsContent>

          <TabsContent value="activity" className="mt-0">
            <ClientActivityFeed activity={activity} title="Nexus Timeline" description="The client’s complete operational chronology across service, correspondence, assets, remote sessions, automation, backups, billing, documentation, governance, and platform events." />
            <div className="hidden space-y-1">
              {activity.map((a, i) => (
                <div key={i} className="flex items-center gap-2 text-xs py-2 border-b border-zinc-900">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${a.type === "ticket" ? "bg-indigo-400" : a.type === "invoice" ? "bg-emerald-400" : a.type === "email" ? (a.status === "sent" || a.status === "received" ? "bg-violet-400" : "bg-rose-400") : "bg-amber-400"}`} />
                  <span className="uppercase tracking-wider text-[10px] text-zinc-500 w-16 font-mono">{a.type.replace("_", " ")}</span>
                  <span className="text-zinc-300 flex-1 truncate">{a.title}</span>
                  {a.amount != null && <span className="font-mono text-zinc-500">${a.amount}</span>}
                  <span className="text-[10px] text-zinc-600 font-mono">{a.timestamp ? formatDistanceToNow(new Date(a.timestamp), { addSuffix: true }) : "—"}</span>
                </div>
              ))}
              {activity.length === 0 && <p className="text-sm text-zinc-500 text-center py-12">No activity yet.</p>}
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

function CippTenantPanel({ client }) {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };

  const [clientDoc, setClientDoc] = useState(null);
  const [tenants, setTenants] = useState([]);
  const [users, setUsers] = useState([]);
  const [licenses, setLicenses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [licenseDialog, setLicenseDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [createForm, setCreateForm] = useState({ displayName: "", userPrincipalName: "", password: "", firstName: "", lastName: "", usageLocation: "AU", licenses: [], mustChangePassword: true });
  const [licAdd, setLicAdd] = useState([]);
  const [licRemove, setLicRemove] = useState([]);
  const [unlinkConfirmOpen, setUnlinkConfirmOpen] = useState(false);
  const [resetDialog, setResetDialog] = useState(null);
  const [resetPassword, setResetPassword] = useState("");
  const [signInDialog, setSignInDialog] = useState(null);
  const [offboardDialog, setOffboardDialog] = useState(null);

  const loadClient = async () => {
    try {
      const res = await axios.get(`${API}/clients/${client.id}`, { headers });
      setClientDoc(res.data);
    } catch { /* ignore */ }
  };

  useEffect(() => { loadClient(); }, [client.id]); // eslint-disable-line

  const tenantId = clientDoc?.cipp_tenant_id;

  const [hygiene, setHygiene] = useState(null);
  const [loadingHygiene, setLoadingHygiene] = useState(false);

  const loadHygiene = async (force = false) => {
    if (!tenantId) return;
    setLoadingHygiene(true);
    try {
      const r = await axios.get(`${API}/cipp/tenants/${tenantId}/hygiene${force ? "?force=true" : ""}`, { headers });
      setHygiene(r.data);
    } catch (e) { /* ignore — keep previous */ }
    finally { setLoadingHygiene(false); }
  };

  useEffect(() => {
    if (!tenantId) { setHygiene(null); return; }
    loadHygiene(false);
    // eslint-disable-next-line
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) { setUsers([]); setLicenses([]); return; }
    (async () => {
      setLoading(true);
      try {
        const [u, l] = await Promise.all([
          axios.get(`${API}/cipp/tenants/${tenantId}/users`, { headers }).catch(() => ({ data: [] })),
          axios.get(`${API}/cipp/tenants/${tenantId}/licenses`, { headers }).catch(() => ({ data: [] })),
        ]);
        setUsers(u.data || []);
        setLicenses(l.data || []);
      } finally { setLoading(false); }
    })();
    // eslint-disable-next-line
  }, [tenantId]);

  const openLink = async () => {
    setLinkOpen(true);
    try {
      const r = await axios.get(`${API}/cipp/tenants`, { headers });
      setTenants(r.data || []);
    } catch (e) { toast.error(e.response?.data?.detail || "Couldn't load Microsoft tenants"); }
  };

  const doLink = async () => {
    if (!selectedTenantId) { toast.error("Pick a tenant"); return; }
    const t = tenants.find(x => x.customerId === selectedTenantId);
    setBusy(true);
    try {
      await axios.post(`${API}/clients/${client.id}/link-cipp-tenant`, {
        tenant_id: t.customerId,
        tenant_display: t.displayName,
        tenant_domain: t.defaultDomainName,
      }, { headers });
      toast.success("Tenant linked");
      setLinkOpen(false);
      loadClient();
    } catch (e) { toast.error(e.response?.data?.detail || "Link failed"); }
    finally { setBusy(false); }
  };

  const doUnlink = async () => {
    try {
      await axios.delete(`${API}/clients/${client.id}/link-cipp-tenant`, { headers });
      toast.success("Unlinked");
      setUnlinkConfirmOpen(false);
      loadClient();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const doCreateUser = async () => {
    if (!createForm.displayName || !createForm.userPrincipalName || !createForm.password) {
      toast.error("Display name, UPN, and password are required"); return;
    }
    setBusy(true);
    try {
      await axios.post(`${API}/cipp/tenants/${tenantId}/users`, createForm, { headers });
      toast.success(`User ${createForm.userPrincipalName} created`);
      setCreateOpen(false);
      setCreateForm({ displayName: "", userPrincipalName: "", password: "", firstName: "", lastName: "", usageLocation: "AU", licenses: [], mustChangePassword: true });
      const u = await axios.get(`${API}/cipp/tenants/${tenantId}/users`, { headers });
      setUsers(u.data || []);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  const doAssignLicense = async () => {
    setBusy(true);
    try {
      await axios.post(`${API}/cipp/tenants/${tenantId}/users/${licenseDialog.id}/assign-license`,
        { addLicenses: licAdd, removeLicenses: licRemove }, { headers });
      toast.success("Licenses updated");
      setLicenseDialog(null); setLicAdd([]); setLicRemove([]);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  const doReset = async () => {
    if (!resetDialog) return;
    setBusy(true);
    try {
      await axios.post(`${API}/cipp/tenants/${tenantId}/users/${resetDialog.id}/reset-password`, { password: resetPassword, mustChange: true }, { headers });
      toast.success("Password reset");
      setResetDialog(null);
      setResetPassword("");
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  const doToggleSignin = async () => {
    if (!signInDialog) return;
    const u = signInDialog;
    setBusy(true);
    try {
      await axios.post(`${API}/cipp/tenants/${tenantId}/users/${u.id}/block-signin`, { enable: !u.accountEnabled }, { headers });
      toast.success(`Sign-in ${u.accountEnabled ? "blocked" : "unblocked"}`);
      setSignInDialog(null);
      const res = await axios.get(`${API}/cipp/tenants/${tenantId}/users`, { headers });
      setUsers(res.data || []);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  const doOffboard = async () => {
    if (!offboardDialog) return;
    const u = offboardDialog;
    setBusy(true);
    try {
      await axios.post(`${API}/cipp/tenants/${tenantId}/users/${u.id}/offboard`, {
        convertToShared: true, removeLicenses: true, resetPassword: true, revokeSessions: true, disableUser: true, removeGroups: true, hideFromGAL: true,
      }, { headers });
      toast.success(`${u.userPrincipalName} offboarded`);
      setOffboardDialog(null);
      const res = await axios.get(`${API}/cipp/tenants/${tenantId}/users`, { headers });
      setUsers(res.data || []);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  if (!tenantId) {
    return (
      <div className="border border-zinc-800 rounded-md p-6 bg-zinc-950" data-testid="client-cipp-unlinked">
        <div className="flex items-center gap-2 mb-2"><Cloud className="w-4 h-4 text-cyan-400" /><span className="font-medium">Nexus Control Plane · Microsoft 365</span></div>
        <p className="text-sm text-zinc-400 mb-3">No Microsoft tenant is linked to this client. Link one to manage identities and licences in Nexus Control Plane.</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" onClick={openLink} data-testid="client-cipp-link-btn"><LinkIcon className="w-3 h-3 mr-1" />Link tenant</Button>
          <Button size="sm" variant="outline" asChild><Link to="/settings?tab=integrations&anchor=cipp-settings-card"><ExternalLink className="w-3 h-3 mr-1" />Configure provider</Link></Button>
        </div>

        <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
          <NexusWorkflowDialog
            eyebrow="Client Microsoft setup"
            title="Link Microsoft tenant"
            description={`Map ${client.name} to the correct Microsoft 365 tenant in Nexus Control Plane.`}
            icon={LinkIcon}
            tone="cyan"
            data-testid="client-cipp-link-dialog"
            footer={<><Button variant="outline" onClick={() => setLinkOpen(false)}>Cancel</Button><Button onClick={doLink} disabled={busy || !selectedTenantId} data-testid="client-cipp-link-submit">Link tenant</Button></>}
          >
            <div className="space-y-2">
              <select
                value={selectedTenantId}
                onChange={(e) => setSelectedTenantId(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm"
                data-testid="client-cipp-link-tenant-select"
              >
                <option value="">Select a Microsoft tenant…</option>
                {tenants.map(t => <option key={t.customerId} value={t.customerId}>{t.displayName} ({t.defaultDomainName})</option>)}
              </select>
              {tenants.length === 0 && <p className="text-xs text-muted-foreground">No tenants returned — verify the Microsoft tenant provider in Settings.</p>}
            </div>
          </NexusWorkflowDialog>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="client-cipp-linked">
      <div className="border border-zinc-800 rounded-md p-4 bg-zinc-950">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <Cloud className="w-4 h-4 text-cyan-400" />
              <span className="font-medium">{clientDoc?.cipp_tenant_display || tenantId}</span>
              <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-500/30">Linked</Badge>
            </div>
            <div className="text-[11px] text-zinc-500 font-mono mt-0.5">{clientDoc?.cipp_tenant_domain || ""}</div>
            <div className="text-[10px] text-zinc-600 font-mono">tenant: {tenantId}</div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" onClick={() => setCreateOpen(true)} data-testid="client-cipp-create-user"><UserPlus className="w-3 h-3 mr-1" />Create user</Button>
            <Button size="sm" variant="outline" asChild><Link to="/control-plane?module=microsoft365"><ExternalLink className="w-3 h-3 mr-1" />Control Plane</Link></Button>
            <Button size="sm" variant="ghost" className="text-rose-400" onClick={() => setUnlinkConfirmOpen(true)} data-testid="client-cipp-unlink"><X className="w-3 h-3 mr-1" />Unlink</Button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 pt-3">
          <div className="rounded border border-zinc-800 p-2 bg-zinc-900/50">
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">Users</div>
            <div className="text-lg font-semibold">{users.length}</div>
          </div>
          <div className="rounded border border-zinc-800 p-2 bg-zinc-900/50">
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">Licensed</div>
            <div className="text-lg font-semibold">{users.filter(u => u.licenses_count > 0).length}</div>
          </div>
          <div className="rounded border border-zinc-800 p-2 bg-zinc-900/50">
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">Blocked</div>
            <div className="text-lg font-semibold">{users.filter(u => !u.accountEnabled).length}</div>
          </div>
        </div>
      </div>

      {/* M365 Hygiene card */}
      <div className="border border-zinc-800 rounded-md p-4 bg-zinc-950" data-testid="client-cipp-hygiene">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-amber-400" />
            <span className="font-medium">M365 Hygiene</span>
            {hygiene?.grade && typeof hygiene.score === "number" && (
              <span className={`text-[10px] uppercase tracking-widest font-mono px-1.5 py-0.5 rounded border ${
                hygiene.score >= 75 ? "text-emerald-400 border-emerald-500/30" :
                hygiene.score >= 50 ? "text-amber-400 border-amber-500/30" :
                "text-rose-400 border-rose-500/30"
              }`}>Grade {hygiene.grade}</span>
            )}
          </div>
          <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => loadHygiene(true)} disabled={loadingHygiene} data-testid="client-cipp-hygiene-refresh">
            {loadingHygiene ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}Recompute
          </Button>
        </div>

        {loadingHygiene && !hygiene ? (
          <div className="flex items-center justify-center py-6 text-zinc-500"><Loader2 className="w-4 h-4 mr-2 animate-spin" />Analysing tenant…</div>
        ) : !hygiene ? (
          <div className="text-xs text-zinc-500">Hygiene not yet computed. Click Recompute to analyse.</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-4">
            <div className="flex flex-col items-center justify-center">
              {typeof hygiene.score === "number" ? <HealthDial score={hygiene.score} size={120} /> : <div className="flex h-[120px] w-[120px] items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/5 px-4 text-center text-xs text-amber-200">Evidence coverage<br />{hygiene.evidence_coverage_pct || 0}%</div>}
              {typeof hygiene.score !== "number" && <div className="mt-1 text-center text-[10px] text-amber-300">No tenant score until coverage reaches 60%</div>}
              <div className="text-[10px] text-zinc-500 font-mono mt-2">{hygiene.total_users} users · {hygiene.counts?.enabled_users || 0} active</div>
            </div>
            <div className="space-y-3">
              {/* dim breakdown */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {hygiene.breakdown && Object.entries(hygiene.breakdown).map(([k, v]) => {
                  const assessed = v.status === "assessed" && typeof v.earned === "number";
                  const pct = assessed && v.max ? (v.earned / v.max) * 100 : 0;
                  const color = !assessed ? "bg-zinc-700" : pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-rose-500";
                  return (
                    <div key={k} className="text-xs" data-testid={`hygiene-dim-${k}`}>
                      <div className="flex justify-between">
                        <span className="text-zinc-500 uppercase tracking-wider text-[9px]">{k.replace(/_/g, " ")}</span>
                        <span className="text-[9px] font-mono text-zinc-400">{assessed ? `${v.earned}/${v.max}` : "unassessed"}</span>
                      </div>
                      <div className="h-1 bg-zinc-800 rounded overflow-hidden mt-1">
                        <div className={`h-full ${color}`} style={{ width: `${pct}%`, transition: "width 600ms" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* risks */}
              {(hygiene.risks || []).length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Top risks</div>
                  <div className="space-y-1">
                    {hygiene.risks.slice(0, 5).map((r, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <span className={`w-1 h-1 rounded-full mt-1.5 shrink-0 ${r.severity === "critical" ? "bg-rose-400" : r.severity === "warning" ? "bg-amber-400" : "bg-zinc-500"}`} />
                        <span className="text-zinc-300 flex-1">{r.factor}</span>
                        {typeof r.impact === "number" && <span className="text-[10px] text-zinc-500 font-mono shrink-0">{r.impact}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* upsell hint */}
              {typeof hygiene.score === "number" && hygiene.score < 70 && (
                <div className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
                  💡 Upsell opportunity: bundle MFA enforcement, license cleanup, and offboarding hygiene as a Security Posture Package.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="border border-zinc-800 rounded-md overflow-hidden bg-zinc-950">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-zinc-500"><Loader2 className="w-4 h-4 mr-2 animate-spin" />Loading users…</div>
        ) : users.length === 0 ? (
          <div className="text-center py-8 text-xs text-zinc-500">No users returned for this tenant.</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-zinc-900/60">
              <tr className="text-[10px] uppercase tracking-wider text-zinc-500">
                <th className="text-left px-3 py-2">Display</th>
                <th className="text-left px-3 py-2">UPN</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Licenses</th>
                <th className="text-right px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-zinc-900" data-testid={`client-cipp-user-${u.id}`}>
                  <td className="px-3 py-2">{u.displayName || "—"}</td>
                  <td className="px-3 py-2 font-mono text-zinc-400">{u.userPrincipalName}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className={u.accountEnabled ? "text-emerald-400 border-emerald-500/30" : "text-rose-400 border-rose-500/30"}>
                      {u.accountEnabled ? "Enabled" : "Blocked"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 font-mono">{u.licenses_count}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex gap-1 justify-end flex-wrap">
                      <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => { setLicenseDialog(u); setLicAdd([]); setLicRemove([]); }} data-testid={`client-cipp-user-licenses-${u.id}`}><KeyRound className="w-3 h-3 mr-0.5" />Licenses</Button>
                      <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => { setResetDialog(u); setResetPassword(""); }} data-testid={`client-cipp-user-reset-${u.id}`}><RefreshCw className="w-3 h-3 mr-0.5" />Reset</Button>
                      <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setSignInDialog(u)} data-testid={`client-cipp-user-block-${u.id}`}>
                        {u.accountEnabled ? <><Lock className="w-3 h-3 mr-0.5" />Block</> : <><Unlock className="w-3 h-3 mr-0.5" />Unblock</>}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 text-[10px] text-rose-400" onClick={() => setOffboardDialog(u)} data-testid={`client-cipp-user-offboard-${u.id}`}><UserX className="w-3 h-3 mr-0.5" />Offboard</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create user dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <NexusWorkflowDialog
          eyebrow="Client Microsoft setup"
          title="Create Microsoft 365 user"
          description={`Create the identity in ${clientDoc?.cipp_tenant_display || "the linked tenant"}, then assign the required licences.`}
          icon={UserPlus}
          tone="cyan"
          className="max-w-xl"
          data-testid="client-cipp-create-dialog"
          footer={<><Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button><Button onClick={doCreateUser} disabled={busy} data-testid="client-cipp-create-submit">{busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <UserPlus className="w-4 h-4 mr-1" />}Create user</Button></>}
        >
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Input placeholder="First name" value={createForm.firstName} onChange={e => setCreateForm({ ...createForm, firstName: e.target.value })} />
              <Input placeholder="Last name" value={createForm.lastName} onChange={e => setCreateForm({ ...createForm, lastName: e.target.value })} />
            </div>
            <Input placeholder="Display name *" value={createForm.displayName} onChange={e => setCreateForm({ ...createForm, displayName: e.target.value })} data-testid="client-cipp-create-display" />
            <Input placeholder={`user@${clientDoc?.cipp_tenant_domain || "domain.com"} *`} value={createForm.userPrincipalName} onChange={e => setCreateForm({ ...createForm, userPrincipalName: e.target.value })} data-testid="client-cipp-create-upn" />
            <div className="grid grid-cols-2 gap-3">
              <Input type="password" placeholder="Password *" value={createForm.password} onChange={e => setCreateForm({ ...createForm, password: e.target.value })} data-testid="client-cipp-create-pw" />
              <Input placeholder="Usage location (AU)" value={createForm.usageLocation} onChange={e => setCreateForm({ ...createForm, usageLocation: e.target.value.toUpperCase() })} maxLength={2} />
            </div>
            {licenses.length > 0 && (
              <div>
                <div className="text-xs mb-1">Assign licenses</div>
                <div className="border border-zinc-800 rounded p-2 space-y-1 max-h-32 overflow-y-auto">
                  {licenses.map(l => (
                    <label key={l.skuId} className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={createForm.licenses.includes(l.skuId)}
                        onChange={(e) => setCreateForm(f => ({ ...f, licenses: e.target.checked ? [...f.licenses, l.skuId] : f.licenses.filter(x => x !== l.skuId) }))}
                      />
                      <span className="font-mono">{l.skuPartNumber || l.skuId}</span>
                      <span className="text-zinc-500 ml-auto">{l.consumedUnits}/{l.consumedUnits + (l.available ?? 0)}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={createForm.mustChangePassword} onChange={e => setCreateForm({ ...createForm, mustChangePassword: e.target.checked })} />
              Force password change at next sign-in
            </label>
          </div>
        </NexusWorkflowDialog>
      </Dialog>

      {/* License dialog */}
      <Dialog open={!!licenseDialog} onOpenChange={() => setLicenseDialog(null)}>
        <NexusWorkflowDialog
          eyebrow="Client Microsoft licensing"
          title="Manage licences"
          description={`Review licence changes for ${licenseDialog?.userPrincipalName || "this user"} before applying them to the linked tenant.`}
          icon={KeyRound}
          tone="emerald"
          data-testid="client-cipp-license-dialog"
          footer={<><Button variant="outline" onClick={() => setLicenseDialog(null)}>Cancel</Button><Button onClick={doAssignLicense} disabled={busy || (licAdd.length === 0 && licRemove.length === 0)} data-testid="client-cipp-license-submit">{busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <KeyRound className="w-4 h-4 mr-1" />}Apply changes</Button></>}
        >
          <div className="space-y-3">
            <div>
              <div className="text-xs mb-1">Add</div>
              <div className="border border-zinc-800 rounded p-2 space-y-1 max-h-40 overflow-y-auto">
                {licenses.map(l => (
                  <label key={`a${l.skuId}`} className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={licAdd.includes(l.skuId)} onChange={(e) => setLicAdd(a => e.target.checked ? [...a, l.skuId] : a.filter(x => x !== l.skuId))} />
                    <span className="font-mono">{l.skuPartNumber || l.skuId}</span>
                    <span className="ml-auto text-zinc-500">avail: {l.available ?? 0}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs mb-1">Remove</div>
              <div className="border border-zinc-800 rounded p-2 space-y-1 max-h-40 overflow-y-auto">
                {licenses.map(l => (
                  <label key={`r${l.skuId}`} className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={licRemove.includes(l.skuId)} onChange={(e) => setLicRemove(a => e.target.checked ? [...a, l.skuId] : a.filter(x => x !== l.skuId))} />
                    <span className="font-mono">{l.skuPartNumber || l.skuId}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </NexusWorkflowDialog>
      </Dialog>

      <Dialog open={unlinkConfirmOpen} onOpenChange={setUnlinkConfirmOpen}>
        <NexusWorkflowDialog eyebrow="Client Microsoft setup" title="Unlink Microsoft tenant?" description={`Disconnect ${clientDoc?.cipp_tenant_display || "the linked tenant"} from ${client.name}. Nexus will retain existing client and audit records.`} icon={X} tone="amber" className="max-w-lg" data-testid="client-cipp-unlink-workflow" footer={<><Button variant="outline" onClick={() => setUnlinkConfirmOpen(false)}>Keep linked</Button><Button variant="destructive" onClick={doUnlink} disabled={busy}>Unlink tenant</Button></>}><p className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3 text-sm text-muted-foreground">This stops Microsoft administration from the client record. It does not delete the Microsoft tenant.</p></NexusWorkflowDialog>
      </Dialog>

      <Dialog open={Boolean(resetDialog)} onOpenChange={(open) => !open && setResetDialog(null)}>
        <NexusWorkflowDialog eyebrow="Sensitive identity action" title="Reset user password" description={`Reset ${resetDialog?.userPrincipalName || "this user's"} password and require a new password at next sign-in.`} icon={KeyRound} tone="amber" className="max-w-lg" data-testid="client-cipp-reset-workflow" footer={<><Button variant="outline" onClick={() => setResetDialog(null)}>Cancel</Button><Button onClick={doReset} disabled={busy}>{busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <KeyRound className="mr-1.5 h-4 w-4" />}Reset password</Button></>}><div className="space-y-2"><Label htmlFor="cipp-reset-password">Temporary password <span className="text-muted-foreground">(optional)</span></Label><Input id="cipp-reset-password" type="password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} placeholder="Leave blank to generate securely" autoFocus /><p className="text-xs text-muted-foreground">Nexus will require the user to change this password after their next successful sign-in.</p></div></NexusWorkflowDialog>
      </Dialog>

      <Dialog open={Boolean(signInDialog)} onOpenChange={(open) => !open && setSignInDialog(null)}>
        <NexusWorkflowDialog eyebrow="Sensitive identity action" title={`${signInDialog?.accountEnabled ? "Block" : "Unblock"} user sign-in?`} description={`${signInDialog?.userPrincipalName || "This user"} will ${signInDialog?.accountEnabled ? "no longer be able to sign in" : "be able to sign in again"} to the linked Microsoft tenant.`} icon={signInDialog?.accountEnabled ? Lock : Unlock} tone="amber" className="max-w-lg" data-testid="client-cipp-signin-workflow" footer={<><Button variant="outline" onClick={() => setSignInDialog(null)}>Cancel</Button><Button variant={signInDialog?.accountEnabled ? "destructive" : "default"} onClick={doToggleSignin} disabled={busy}>{busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : signInDialog?.accountEnabled ? <Lock className="mr-1.5 h-4 w-4" /> : <Unlock className="mr-1.5 h-4 w-4" />}{signInDialog?.accountEnabled ? "Block sign-in" : "Unblock sign-in"}</Button></>}><p className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3 text-sm text-muted-foreground">This action is attributable to your Nexus session and recorded in the identity audit trail.</p></NexusWorkflowDialog>
      </Dialog>

      <Dialog open={Boolean(offboardDialog)} onOpenChange={(open) => !open && setOffboardDialog(null)}>
        <NexusWorkflowDialog eyebrow="High-impact identity workflow" title="Offboard Microsoft 365 user" description={`Prepare a safe departure workflow for ${offboardDialog?.userPrincipalName || "this user"}. Review the actions Nexus will apply before proceeding.`} icon={UserX} tone="amber" className="max-w-xl" data-testid="client-cipp-offboard-workflow" footer={<><Button variant="outline" onClick={() => setOffboardDialog(null)}>Cancel</Button><Button variant="destructive" onClick={doOffboard} disabled={busy}>{busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <UserX className="mr-1.5 h-4 w-4" />}Offboard user</Button></>}><div className="grid gap-2 sm:grid-cols-2">{["Disable sign-in and revoke active sessions", "Reset password and remove group membership", "Convert mailbox to shared and hide it from the GAL", "Remove assigned Microsoft licences"].map((action) => <div key={action} className="flex items-start gap-2 rounded-xl border border-amber-400/15 bg-amber-400/[0.04] p-3 text-sm text-muted-foreground"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />{action}</div>)}</div></NexusWorkflowDialog>
      </Dialog>
    </div>
  );
}

function ClientBlueprintsPanel({ clientId }) {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [allBps, setAllBps] = useState([]);
  const [selected, setSelected] = useState([]);
  const [defaultId, setDefaultId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [allRes, cliRes] = await Promise.all([
        axios.get(`${API}/blueprints?active_only=true`, { headers }),
        axios.get(`${API}/clients/${clientId}/blueprints`, { headers }),
      ]);
      setAllBps(allRes.data || []);
      setSelected(cliRes.data?.blueprint_ids || []);
      setDefaultId(cliRes.data?.default_blueprint_id || "");
    } catch (e) { toast.error("Load failed"); }
    finally { setLoading(false); }
  }, [headers, clientId]);

  useEffect(() => { load(); }, [load]);

  const toggle = (id) => {
    setSelected((prev) => {
      const has = prev.includes(id);
      const next = has ? prev.filter((x) => x !== id) : [...prev, id];
      if (has && defaultId === id) setDefaultId("");
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      await axios.put(`${API}/clients/${clientId}/blueprints`, { blueprint_ids: selected, default_blueprint_id: defaultId || null }, { headers });
      toast.success("Blueprints saved");
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="p-6 text-center text-sm text-zinc-500"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</div>;

  return (
    <div className="space-y-4" data-testid="client-blueprints-panel">
      <div className="border border-zinc-800 rounded-md p-4 bg-zinc-950">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-medium">Assigned Blueprints</div>
            <div className="text-[11px] text-zinc-500">The default blueprint is auto-applied to every new ticket for this client.</div>
          </div>
          <Button size="sm" variant="outline" onClick={save} disabled={saving} className="text-sky-400 border-sky-500/30 hover:bg-sky-500/10" data-testid="client-blueprints-save">
            {saving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}Save
          </Button>
        </div>
        {allBps.length === 0 ? (
          <div className="text-xs text-zinc-500 py-6 text-center">
            No blueprints yet. <Link to="/blueprints" className="text-sky-400 underline">Create one</Link>.
          </div>
        ) : (
          <div className="space-y-1.5">
            {allBps.map((bp) => {
              const picked = selected.includes(bp.id);
              const isDefault = defaultId === bp.id;
              return (
                <div key={bp.id} className={`flex items-center gap-2 rounded px-2 py-1.5 ${picked ? "bg-sky-500/5 border border-sky-500/20" : "bg-zinc-900/40 border border-zinc-800"}`} data-testid={`client-bp-row-${bp.id}`}>
                  <input type="checkbox" checked={picked} onChange={() => toggle(bp.id)} className="accent-sky-500" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{bp.name}</div>
                    <div className="text-[10px] text-zinc-500">{(bp.fields || []).length} fields · {(bp.checklist || []).length} items</div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={`h-7 text-[10px] ${isDefault ? "text-amber-400" : "text-zinc-500"}`}
                    disabled={!picked}
                    onClick={() => setDefaultId(isDefault ? "" : bp.id)}
                    data-testid={`client-bp-default-${bp.id}`}
                  >
                    {isDefault ? "★ Default" : "Set default"}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
