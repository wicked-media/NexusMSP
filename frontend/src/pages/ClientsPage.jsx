import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import {
  Search, Building2, Users, HardDrive, Ticket, DollarSign, AlertTriangle,
  Mail, Phone, MapPin, Plus, Loader2, Cloud, Shield, Sparkles, Timer, Zap,
  Activity, ChevronRight, Send, RefreshCw, Filter, X, TrendingUp, TrendingDown,
  Link as LinkIcon, UserPlus, KeyRound, Lock, Unlock, UserX, ExternalLink
} from "lucide-react";
import { Link } from "react-router-dom";
import { AreaChart, Area, ResponsiveContainer } from "recharts";
import { ClientAIBundle } from "@/components/ai/ClientAIBundle";
import { Client360Subscriptions, Client360Security, Client360Billing, Client360Assets } from "@/components/clients/Client360Tabs";
import ClientWarRoom from "@/components/clients/ClientWarRoom";
import HeroTile from "@/components/HeroTile";
import { ClientProfilePictureUploader, ClientCoverImage } from "@/components/clients/ClientProfileAssets";
import ClientDocumentsTab from "@/components/clients/ClientDocumentsTab";
import ClientNotesTab from "@/components/clients/ClientNotesTab";
import ClientQuickActionsStrip from "@/components/clients/ClientQuickActionsStrip";
import ClientServiceTierChip from "@/components/clients/ClientServiceTierChip";
import { Responsive, WidthProvider } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import "@/styles/dashboard-grid.css";
import { useWidgetGrid } from "@/hooks/useWidgetGrid";

const ClientResponsiveGridLayout = WidthProvider(Responsive);

const CLIENT_OVERVIEW_WIDGET_META = {
  "nba":      { label: "Next Best Action",     icon: Sparkles },
  "quick":    { label: "Quick Actions Tiles",  icon: Zap },
  "health":   { label: "Health Score Breakdown", icon: Activity },
  "activity": { label: "Recent Activity",      icon: Activity },
};
const CLIENT_OVERVIEW_DEFAULT_LAYOUT = [
  { i: "nba",      x: 0, y: 0, w: 6,  h: 3, minH: 2, minW: 4 },
  { i: "quick",    x: 6, y: 0, w: 6,  h: 3, minH: 2, minW: 4 },
  { i: "health",   x: 0, y: 3, w: 12, h: 4, minH: 3, minW: 6 },
  { i: "activity", x: 0, y: 7, w: 12, h: 6, minH: 3, minW: 6 },
];

const LIFECYCLE_COLORS = {
  prospect: "text-violet-400 border-violet-500/30 bg-violet-500/5",
  onboarding: "text-sky-400 border-sky-500/30 bg-sky-500/5",
  active: "text-emerald-400 border-emerald-500/30 bg-emerald-500/5",
  at_risk: "text-amber-400 border-amber-500/30 bg-amber-500/5",
  churned: "text-rose-400 border-rose-500/30 bg-rose-500/5",
};

const TIER_COLORS = {
  platinum: "from-fuchsia-500 to-indigo-500",
  gold: "from-amber-400 to-orange-500",
  silver: "from-zinc-300 to-zinc-500",
  standard: "from-zinc-500 to-zinc-700",
};

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
    acronis: { label: "ACR", color: "text-sky-400 border-sky-500/40", tip: "Acronis Cyber Cloud" },
    pax8: { label: "PX8", color: "text-indigo-400 border-indigo-500/40", tip: "Pax8 / Microsoft CSP" },
    m365: { label: "365", color: "text-blue-400 border-blue-500/40", tip: "Microsoft 365" },
    rmm: { label: "RMM", color: "text-emerald-400 border-emerald-500/40", tip: "RMM agent installed" },
    suped: { label: "SUP", color: "text-fuchsia-400 border-fuchsia-500/40", tip: "Suped DMARC" },
    cipp: { label: "CIPP", color: "text-orange-400 border-orange-500/40", tip: "CIPP — M365 management" },
  };
  const cfg = map[type];
  if (!cfg) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`font-mono text-[10px] h-5 px-1.5 rounded border flex items-center ${active ? cfg.color : "text-zinc-600 border-zinc-800 opacity-60"}`}>{cfg.label}</span>
      </TooltipTrigger>
      <TooltipContent><span className="text-xs">{cfg.tip} {active ? "· linked" : "· not linked"}</span></TooltipContent>
    </Tooltip>
  );
}

function Sparkline({ data, color = "#818cf8" }) {
  if (!data || data.every(d => !d.value)) return <div className="h-7 w-20 opacity-30 flex items-end"><div className="h-0.5 w-full bg-zinc-700" /></div>;
  return (
    <div className="h-7 w-20">
      <ResponsiveContainer width="100%" height="100%" minWidth={60} minHeight={20}>
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
          <defs>
            <linearGradient id="sp" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.4} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.5} fill="url(#sp)" dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function ClientListItem({ client, selected, onClick }) {
  const mrrSeries = client.mrr_trend || [];
  const firstVal = mrrSeries.find(m => m.value > 0)?.value || 0;
  const lastVal = mrrSeries[mrrSeries.length - 1]?.value || 0;
  const delta = firstVal > 0 ? ((lastVal - firstVal) / firstVal) * 100 : 0;

  return (
    <button
      onClick={onClick}
      data-testid={`client-list-item-${client.id}`}
      className={`w-full text-left flex items-center gap-3 px-4 py-3 border-b border-zinc-800/80 transition-colors
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
        <div className="flex items-center gap-3 mt-1 text-[11px] text-zinc-500 font-mono">
          {client.industry && <span className="truncate max-w-[80px]">{client.industry}</span>}
          {client.open_tickets > 0 && <span className={client.open_tickets > 10 ? "text-amber-400" : ""}><Ticket className="w-2.5 h-2.5 inline mr-0.5" />{client.open_tickets}</span>}
          <span><HardDrive className="w-2.5 h-2.5 inline mr-0.5" />{client.asset_count}</span>
          {client.overdue_count > 0 && <span className="text-rose-400"><AlertTriangle className="w-2.5 h-2.5 inline mr-0.5" />{client.overdue_count}</span>}
        </div>
        <div className="flex items-center gap-1 mt-1.5">
          <IntegrationChip type="rmm" active={client.integrations.rmm} />
          <IntegrationChip type="acronis" active={client.integrations.acronis} />
          <IntegrationChip type="pax8" active={client.integrations.pax8} />
          <IntegrationChip type="m365" active={client.integrations.m365} />
        </div>
      </div>
      <div className="flex flex-col items-end gap-0.5 shrink-0">
        <div className="font-mono text-xs text-zinc-200">${client.mrr.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
        <div className="flex items-center gap-1">
          {delta !== 0 && (
            <span className={`text-[9px] font-mono ${delta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {delta >= 0 ? "▲" : "▼"}{Math.abs(delta).toFixed(0)}%
            </span>
          )}
          <Sparkline data={mrrSeries} color={delta >= 0 ? "#34d399" : "#fb7185"} />
        </div>
      </div>
    </button>
  );
}

function TopMetric({ label, value, trend, color = "indigo" }) {
  // Delegate to HeroTile for platform-wide consistency. Map legacy color → glow tone.
  const glowMap = { indigo: "violet", violet: "violet", emerald: "emerald", amber: "amber", rose: "rose", red: "rose", sky: "cyan", cyan: "cyan", zinc: "zinc" };
  return <HeroTile label={label} value={value} subtitle={trend} glow={glowMap[color] || "violet"} animated={typeof value === "number"} />;
}

export default function ClientsPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState({ summary: null, clients: [] });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [lifecycleFilter, setLifecycleFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState("all");
  const [integrationFilter, setIntegrationFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [activity, setActivity] = useState([]);
  const [healthDetail, setHealthDetail] = useState(null);
  const [detailTab, setDetailTab] = useState("overview");
  const [detailLoading, setDetailLoading] = useState(false);
  const [createDialog, setCreateDialog] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", industry: "", email: "", phone: "", tier: "standard", lifecycle: "active" });
  const searchRef = useRef(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/clients-enriched`, { headers });
      setData(res.data || { summary: null, clients: [] });
      if (!selectedId && res.data?.clients?.length) {
        setSelectedId(res.data.clients[0].id);
      }
    } catch {
      toast.error("Failed to load clients");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); /* eslint-disable-line */ }, []);

  const fetchDetail = async (id) => {
    if (!id) return;
    setDetailLoading(true);
    try {
      const [cRes, aRes, hRes] = await Promise.all([
        axios.get(`${API}/clients/${id}`, { headers }),
        axios.get(`${API}/clients/${id}/activity-timeline`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/clients/${id}/health`, { headers }).catch(() => ({ data: null })),
      ]);
      setDetail(cRes.data);
      setActivity(aRes.data || []);
      setHealthDetail(hRes.data);
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
        if (filtered[next]) setSelectedId(filtered[next].id);
      } else if (e.key === "n" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setCreateDialog(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line
  }, [selectedId, data]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return (data.clients || []).filter(c => {
      if (q && !(`${c.name} ${c.industry || ""} ${c.email || ""}`.toLowerCase().includes(q))) return false;
      if (lifecycleFilter !== "all" && c.lifecycle !== lifecycleFilter) return false;
      if (riskFilter !== "all" && c.risk_level !== riskFilter) return false;
      if (integrationFilter !== "all" && !c.integrations[integrationFilter]) return false;
      return true;
    });
  }, [data, search, lifecycleFilter, riskFilter, integrationFilter]);

  const selectedClient = useMemo(() => data.clients?.find(c => c.id === selectedId), [data, selectedId]);

  const createClient = async () => {
    if (!createForm.name) { toast.error("Name required"); return; }
    try {
      await axios.post(`${API}/clients`, createForm, { headers });
      toast.success("Client created");
      setCreateDialog(false);
      setCreateForm({ name: "", industry: "", email: "", phone: "", tier: "standard", lifecycle: "active" });
      fetchData();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  if (loading) return <div className="p-8 flex items-center gap-2 text-zinc-500"><Loader2 className="w-4 h-4 animate-spin" />Loading portfolio...</div>;

  const s = data.summary || {};

  return (
    <TooltipProvider delayDuration={200}>
      <div className="min-h-[calc(100vh-64px)] bg-zinc-950 text-zinc-100 flex flex-col" data-testid="clients-page">
        {/* Portfolio metric strip */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 px-6 py-4 sticky top-0 z-10 bg-zinc-950/90 backdrop-blur-md border-b border-zinc-900/60">
          <TopMetric label="Clients" value={s.client_count || 0} trend={s.prospects ? `+${s.prospects} prospect${s.prospects !== 1 ? "s" : ""}` : null} color="indigo" />
          <TopMetric label="Portfolio MRR" value={`$${(s.total_mrr || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} color="emerald" />
          <TopMetric label="Avg Health" value={`${s.avg_health || 0}`} color={s.avg_health >= 80 ? "emerald" : s.avg_health >= 60 ? "amber" : "rose"} />
          <TopMetric label="At Risk" value={s.at_risk || 0} trend={s.at_risk ? "requires attention" : "healthy"} color={s.at_risk ? "amber" : "emerald"} />
          <TopMetric label="Acronis Linked" value={`${s.with_acronis || 0}/${s.client_count || 0}`} color="sky" />
          <TopMetric label="Pax8 Linked" value={`${s.with_pax8 || 0}/${s.client_count || 0}`} color="indigo" />
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Master list */}
          <aside className="w-full md:w-[40%] lg:w-[32%] border-r border-zinc-800 flex flex-col bg-zinc-950">
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
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setCreateDialog(true)} data-testid="new-client-btn">
                  <Plus className="w-4 h-4" />
                </Button>
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
                  </SelectContent>
                </Select>
                {(search || lifecycleFilter !== "all" || riskFilter !== "all" || integrationFilter !== "all") && (
                  <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] text-zinc-500" onClick={() => { setSearch(""); setLifecycleFilter("all"); setRiskFilter("all"); setIntegrationFilter("all"); }}>
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
              {filtered.length === 0 ? (
                <div className="p-8 text-center text-sm text-zinc-500">
                  <Filter className="w-8 h-8 mx-auto mb-3 opacity-40" />
                  No clients match these filters.
                </div>
              ) : (
                filtered.map(c => (
                  <ClientListItem key={c.id} client={c} selected={selectedId === c.id} onClick={() => setSelectedId(c.id)} />
                ))
              )}
            </div>
          </aside>

          {/* Detail pane */}
          <main className="flex-1 bg-zinc-900/30 overflow-y-auto relative">
            {!selectedClient ? (
              <div className="h-full flex items-center justify-center text-zinc-500 text-sm">Select a client to view details</div>
            ) : (
              <ClientDetailPane
                client={selectedClient}
                detail={detail}
                activity={activity}
                healthDetail={healthDetail}
                tab={detailTab}
                setTab={setDetailTab}
                loading={detailLoading}
              />
            )}
          </main>
        </div>

        {/* Create dialog */}
        <Dialog open={createDialog} onOpenChange={setCreateDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Client</DialogTitle>
              <DialogDescription>Add a new client to your portfolio.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Input placeholder="Client name" value={createForm.name} onChange={e => setCreateForm({ ...createForm, name: e.target.value })} data-testid="new-client-name" />
              <Input placeholder="Industry (e.g. Legal, Healthcare)" value={createForm.industry} onChange={e => setCreateForm({ ...createForm, industry: e.target.value })} />
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="Primary email" value={createForm.email} onChange={e => setCreateForm({ ...createForm, email: e.target.value })} />
                <Input placeholder="Phone" value={createForm.phone} onChange={e => setCreateForm({ ...createForm, phone: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Select value={createForm.lifecycle} onValueChange={v => setCreateForm({ ...createForm, lifecycle: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="prospect">Prospect</SelectItem>
                    <SelectItem value="onboarding">Onboarding</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={createForm.tier} onValueChange={v => setCreateForm({ ...createForm, tier: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">Standard</SelectItem>
                    <SelectItem value="silver">Silver</SelectItem>
                    <SelectItem value="gold">Gold</SelectItem>
                    <SelectItem value="platinum">Platinum</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setCreateDialog(false)}>Cancel</Button>
              <Button onClick={createClient} variant="outline" className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" data-testid="create-client-btn"><Plus className="w-4 h-4 mr-1" />Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

function ClientOverviewGrid({ client, activity, healthDetail }) {
  const grid = useWidgetGrid({
    storageKey: "nx-client-overview-layout-v1",
    hiddenKey:  "nx-client-overview-hidden-v1",
    defaultLayout: CLIENT_OVERVIEW_DEFAULT_LAYOUT,
    widgetMeta: CLIENT_OVERVIEW_WIDGET_META,
    label: "Client Overview",
  });

  return (
    <>
      <grid.EditBar testIdPrefix="client-overview-" />
      <ClientResponsiveGridLayout
        className={`layout ${grid.editMode ? "nx-edit-mode" : ""}`}
        layouts={grid.visibleLayouts}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
        cols={{ lg: 12, md: 12, sm: 8, xs: 4, xxs: 2 }}
        rowHeight={48}
        margin={[12, 12]}
        containerPadding={[0, 0]}
        isDraggable={grid.editMode}
        isResizable={grid.editMode}
        onLayoutChange={grid.onLayoutChange}
        draggableCancel=".nx-widget-hide,button,a,input,kbd,select,[role='combobox']"
        useCSSTransforms
        compactType="vertical"
      >
        {!grid.hiddenWidgets.has("nba") && (
          <div key="nba" className="nx-widget-card">
            <grid.HideBtn id="nba" />
            <div className="border border-zinc-800 rounded-md p-4 bg-zinc-950 h-full">
              <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-indigo-400" />Next Best Action
              </div>
              <p className="text-sm text-zinc-300">
                {client.overdue_count > 0 ? <>Client has <strong className="text-rose-400">${(client.overdue_amount || 0).toLocaleString()} overdue</strong>. Send SMS reminder or start a dunning chase.</> :
                  client.open_tickets > 10 ? <>Ticket volume is <strong className="text-amber-400">{client.open_tickets}</strong> — book a QBR to understand what's causing the pressure.</> :
                  client.health_score < 70 ? <>Health score <strong className="text-amber-400">{client.health_score}</strong> — review breakdown and mitigate.</> :
                  <>All green. Consider scheduling the next QBR or proposing an upsell.</>}
              </p>
            </div>
          </div>
        )}

        {!grid.hiddenWidgets.has("quick") && (
          <div key="quick" className="nx-widget-card">
            <grid.HideBtn id="quick" />
            <div className="border border-zinc-800 rounded-md p-4 bg-zinc-950 h-full">
              <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2 flex items-center gap-1">
                <Zap className="w-3 h-3 text-amber-400" />Quick Actions
              </div>
              <div className="flex flex-wrap gap-2">
                <Link to={`/tickets?clientId=${client.id}`}><Button size="sm" variant="outline" className="h-7 text-xs" data-testid="qa-new-ticket"><Ticket className="w-3 h-3 mr-1" />New Ticket</Button></Link>
                <Link to={`/invoices?clientId=${client.id}`}><Button size="sm" variant="outline" className="h-7 text-xs"><DollarSign className="w-3 h-3 mr-1" />New Invoice</Button></Link>
                <Button size="sm" variant="outline" className="h-7 text-xs"><Send className="w-3 h-3 mr-1" />Send SMS</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs"><Mail className="w-3 h-3 mr-1" />Email</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs"><Timer className="w-3 h-3 mr-1" />Start Timer</Button>
              </div>
            </div>
          </div>
        )}

        {!grid.hiddenWidgets.has("health") && (
          <div key="health" className="nx-widget-card">
            <grid.HideBtn id="health" />
            <div className="border border-zinc-800 rounded-md p-4 bg-zinc-950 h-full overflow-auto">
              <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-3 flex items-center justify-between">
                <span>Health Score Breakdown</span>
                {healthDetail && <span className="text-zinc-400 font-mono">{healthDetail.health_score}/100</span>}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {healthDetail?.breakdown ? [
                  { k: "tickets", max: 30, label: "Tickets" },
                  { k: "sla", max: 20, label: "SLA" },
                  { k: "devices", max: healthDetail.breakdown.m365_hygiene != null ? 15 : 20, label: "Devices" },
                  { k: "payments", max: 20, label: "Payments" },
                  { k: "contracts", max: healthDetail.breakdown.m365_hygiene != null ? 5 : 10, label: "Contracts" },
                  ...(healthDetail.breakdown.m365_hygiene != null ? [{ k: "m365_hygiene", max: 10, label: "M365" }] : []),
                ].map(({ k, max, label }) => {
                  const v = healthDetail.breakdown[k] ?? 0;
                  const pct = (v / max) * 100;
                  const color = pct >= 85 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-rose-500";
                  return (
                    <div key={k} className="text-xs" data-testid={`health-breakdown-${k}`}>
                      <div className="flex justify-between">
                        <span className="text-zinc-500 uppercase tracking-wider text-[10px]">{label}</span>
                        <span className="font-mono text-zinc-400 text-[10px]">{v}/{max}</span>
                      </div>
                      <div className="h-1 bg-zinc-800 rounded overflow-hidden mt-1">
                        <div className={`h-full ${color}`} style={{ width: `${Math.min(100, pct)}%`, transition: "width 600ms" }} />
                      </div>
                    </div>
                  );
                }) : (
                  <div className="col-span-5 text-xs text-zinc-500">Calculating…</div>
                )}
              </div>
              <p className="text-[11px] text-zinc-500 mt-3">Composite score derived from ticket velocity, SLA adherence, device uptime, payment timeliness, and contract status.</p>
            </div>
          </div>
        )}

        {!grid.hiddenWidgets.has("activity") && (
          <div key="activity" className="nx-widget-card">
            <grid.HideBtn id="activity" />
            <div className="border border-zinc-800 rounded-md p-4 bg-zinc-950 h-full overflow-auto">
              <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-3 flex items-center gap-1">
                <Activity className="w-3 h-3" />Recent Activity
              </div>
              {activity.length === 0 ? (
                <p className="text-sm text-zinc-500">No recent activity.</p>
              ) : (
                <div className="space-y-2">
                  {activity.slice(0, 8).map((a, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs py-1 border-b border-zinc-900 last:border-0" data-testid={`activity-row-${i}`}>
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${a.type === "ticket" ? "bg-indigo-400" : a.type === "invoice" ? "bg-emerald-400" : "bg-amber-400"}`} />
                      <span className="text-zinc-300 flex-1 truncate">{a.title}</span>
                      {a.amount != null && <span className="font-mono text-zinc-500">${a.amount}</span>}
                      <span className="text-[10px] text-zinc-600 font-mono">{a.timestamp ? formatDistanceToNow(new Date(a.timestamp), { addSuffix: true }) : "—"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </ClientResponsiveGridLayout>
    </>
  );
}

function ClientDetailPane({ client: clientProp, detail, activity, healthDetail, tab, setTab, loading }) {
  const { token, user } = useAuth();
  const [clientLocal, setClientLocal] = useState(clientProp);
  useEffect(() => { setClientLocal(clientProp); }, [clientProp]);
  const client = clientLocal || clientProp;
  const mrrData = client.mrr_trend || [];
  const tierGrad = TIER_COLORS[client.tier] || TIER_COLORS.standard;
  const isAdmin = user?.role === "admin" || user?.is_admin;
  const applyClientPatch = (patch) => setClientLocal(c => ({ ...c, ...patch }));

  return (
    <div className="flex flex-col h-full" data-testid="client-detail-pane">
      {/* Cover banner */}
      <div className="px-6 pt-4">
        <ClientCoverImage client={client} onUpdated={applyClientPatch} />
      </div>

      {/* Header */}
      <div className="px-6 pb-3 -mt-4 flex items-start gap-4">
        <ClientProfilePictureUploader client={client} onUpdated={applyClientPatch} size={88} />
        <div className="flex-1 min-w-0 pt-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold tracking-tight">{client.name}</h1>
            <ClientServiceTierChip client={client} isAdmin={isAdmin} onUpdated={applyClientPatch} />
            <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${LIFECYCLE_COLORS[client.lifecycle] || LIFECYCLE_COLORS.active}`}>{(client.lifecycle || "active").replace("_", " ")}</span>
            {client.vip && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-amber-400/40 bg-amber-500/10 text-amber-300 font-bold">VIP</span>}
          </div>
          <div className="flex items-center gap-4 text-[11px] text-zinc-500 font-mono mt-1 flex-wrap">
            {client.industry && <span>{client.industry}</span>}
            {client.email && <span className="flex items-center gap-1"><Mail className="w-2.5 h-2.5" />{client.email}</span>}
            {client.phone && <span className="flex items-center gap-1"><Phone className="w-2.5 h-2.5" />{client.phone}</span>}
            {client.address && <span className="flex items-center gap-1 truncate max-w-[280px]"><MapPin className="w-2.5 h-2.5" />{client.address}</span>}
            {client.website && (
              <a href={client.website.startsWith("http") ? client.website : `https://${client.website}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-cyan-400">
                <ExternalLink className="w-2.5 h-2.5" />{client.website.replace(/^https?:\/\//, "")}
              </a>
            )}
          </div>
          <div className="flex items-center gap-1 mt-2 flex-wrap">
            <IntegrationChip type="rmm" active={client.integrations.rmm} />
            <IntegrationChip type="acronis" active={client.integrations.acronis} />
            <IntegrationChip type="pax8" active={client.integrations.pax8} />
            <IntegrationChip type="m365" active={client.integrations.m365} />
            {client.last_activity && <span className="text-[10px] text-zinc-500 ml-2 font-mono">last activity {formatDistanceToNow(new Date(client.last_activity), { addSuffix: true })}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <HealthDial score={client.health_score} size={56} />
          <button
            type="button"
            className="text-[10px] px-2 py-1 rounded border border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
            onClick={() => window.open(`${API}/clients/${client.id}/health-certificate.pdf?token=${encodeURIComponent(token)}`, "_blank")}
            data-testid={`health-cert-btn-${client.id}`}
          >
            ★ Certificate
          </button>
        </div>
      </div>

      {/* Quick Actions strip */}
      <div className="px-6 pb-3 border-b border-zinc-800">
        <ClientQuickActionsStrip client={client} />
      </div>

      {/* Quick metrics strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 px-6 py-4 border-b border-zinc-800">
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

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col min-h-0">
        <TabsList className="h-auto rounded-none border-b border-zinc-800 bg-transparent p-0 justify-start gap-1 px-6">
          {[
            { v: "overview", l: "Overview" },
            { v: "warroom", l: "War Room" },
            { v: "tickets", l: "Tickets" },
            { v: "assets", l: "Assets" },
            { v: "documents", l: "Documents" },
            { v: "notes", l: "Notes" },
            { v: "subscriptions", l: "Subscriptions" },
            { v: "security", l: "Security" },
            { v: "contacts", l: "Contacts" },
            { v: "billing", l: "Billing" },
            { v: "blueprints", l: "Blueprints" },
            { v: "ai", l: "AI Insights" },
            { v: "integrations", l: "Integrations" },
            { v: "cipp", l: "M365 / CIPP" },
            { v: "activity", l: "Activity" },
          ].map(t => (
            <TabsTrigger key={t.v} value={t.v} className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-indigo-500 data-[state=active]:text-zinc-100 text-zinc-500 rounded-none py-2 px-3 text-xs tracking-wide uppercase font-medium shadow-none" data-testid={`tab-${t.v}`}>{t.l}</TabsTrigger>
          ))}
        </TabsList>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <TabsContent value="overview" className="mt-0 space-y-3">
            <ClientOverviewGrid client={client} activity={activity} healthDetail={healthDetail} />
          </TabsContent>

          <TabsContent value="tickets" className="mt-0">
            <div className="border border-zinc-800 rounded-md p-6 text-center text-sm text-zinc-500">
              <Ticket className="w-8 h-8 mx-auto mb-3 opacity-40" />
              Deep ticket view — <Link className="text-indigo-400 hover:underline" to={`/tickets?clientId=${client.id}`}>open full Tickets page</Link>
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
            <div className="border border-zinc-800 rounded-md p-6 text-center text-sm text-zinc-500">
              <Users className="w-8 h-8 mx-auto mb-3 opacity-40" />
              <Link className="text-indigo-400 hover:underline" to={`/contacts?clientId=${client.id}`}>Open {client.contact_count} contacts</Link>
            </div>
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
          </TabsContent>

          <TabsContent value="cipp" className="mt-0">
            <CippTenantPanel client={client} />
          </TabsContent>

          <TabsContent value="activity" className="mt-0">
            <div className="space-y-1">
              {activity.map((a, i) => (
                <div key={i} className="flex items-center gap-2 text-xs py-2 border-b border-zinc-900">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${a.type === "ticket" ? "bg-indigo-400" : a.type === "invoice" ? "bg-emerald-400" : "bg-amber-400"}`} />
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
    } catch (e) { toast.error(e.response?.data?.detail || "Couldn't load CIPP tenants"); }
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
    if (!window.confirm("Unlink this tenant from the client?")) return;
    try {
      await axios.delete(`${API}/clients/${client.id}/link-cipp-tenant`, { headers });
      toast.success("Unlinked");
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

  const doReset = async (u) => {
    const pw = window.prompt(`Reset password for ${u.userPrincipalName}. Leave blank for auto-generated:`, "");
    if (pw === null) return;
    try {
      await axios.post(`${API}/cipp/tenants/${tenantId}/users/${u.id}/reset-password`, { password: pw, mustChange: true }, { headers });
      toast.success("Password reset");
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const doToggleSignin = async (u) => {
    if (!window.confirm(`${u.accountEnabled ? "Block" : "Unblock"} sign-in for ${u.userPrincipalName}?`)) return;
    try {
      await axios.post(`${API}/cipp/tenants/${tenantId}/users/${u.id}/block-signin`, { enable: !u.accountEnabled }, { headers });
      toast.success(`Sign-in ${u.accountEnabled ? "blocked" : "unblocked"}`);
      const res = await axios.get(`${API}/cipp/tenants/${tenantId}/users`, { headers });
      setUsers(res.data || []);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const doOffboard = async (u) => {
    if (!window.confirm(`Offboard ${u.userPrincipalName}? Removes licenses, disables sign-in, converts mailbox to shared, resets password, hides from GAL.`)) return;
    try {
      await axios.post(`${API}/cipp/tenants/${tenantId}/users/${u.id}/offboard`, {
        convertToShared: true, removeLicenses: true, resetPassword: true, revokeSessions: true, disableUser: true, removeGroups: true, hideFromGAL: true,
      }, { headers });
      toast.success(`${u.userPrincipalName} offboarded`);
      const res = await axios.get(`${API}/cipp/tenants/${tenantId}/users`, { headers });
      setUsers(res.data || []);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  if (!tenantId) {
    return (
      <div className="border border-zinc-800 rounded-md p-6 bg-zinc-950" data-testid="client-cipp-unlinked">
        <div className="flex items-center gap-2 mb-2"><Cloud className="w-4 h-4 text-orange-400" /><span className="font-medium">CIPP · M365 tenant</span></div>
        <p className="text-sm text-zinc-400 mb-3">No CIPP tenant linked to this client. Link a tenant to manage users and licenses in M365.</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" onClick={openLink} data-testid="client-cipp-link-btn"><LinkIcon className="w-3 h-3 mr-1" />Link tenant</Button>
          <Button size="sm" variant="outline" asChild><Link to="/settings?tab=integrations&anchor=cipp-settings-card"><ExternalLink className="w-3 h-3 mr-1" />Configure CIPP</Link></Button>
        </div>

        <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
          <DialogContent data-testid="client-cipp-link-dialog">
            <DialogHeader>
              <DialogTitle>Link CIPP tenant</DialogTitle>
              <DialogDescription>Map {client.name} to an M365 tenant managed by CIPP.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <select
                value={selectedTenantId}
                onChange={(e) => setSelectedTenantId(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm"
                data-testid="client-cipp-link-tenant-select"
              >
                <option value="">Select a CIPP tenant…</option>
                {tenants.map(t => <option key={t.customerId} value={t.customerId}>{t.displayName} ({t.defaultDomainName})</option>)}
              </select>
              {tenants.length === 0 && <p className="text-xs text-muted-foreground">No tenants returned — make sure CIPP is configured in Settings.</p>}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setLinkOpen(false)}>Cancel</Button>
              <Button variant="outline" className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" onClick={doLink} disabled={busy || !selectedTenantId} data-testid="client-cipp-link-submit">Link</Button>
            </DialogFooter>
          </DialogContent>
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
              <Cloud className="w-4 h-4 text-orange-400" />
              <span className="font-medium">{clientDoc?.cipp_tenant_display || tenantId}</span>
              <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-500/30">Linked</Badge>
            </div>
            <div className="text-[11px] text-zinc-500 font-mono mt-0.5">{clientDoc?.cipp_tenant_domain || ""}</div>
            <div className="text-[10px] text-zinc-600 font-mono">tenant: {tenantId}</div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" onClick={() => setCreateOpen(true)} data-testid="client-cipp-create-user"><UserPlus className="w-3 h-3 mr-1" />Create user</Button>
            <Button size="sm" variant="outline" asChild><Link to="/cipp"><ExternalLink className="w-3 h-3 mr-1" />CIPP Center</Link></Button>
            <Button size="sm" variant="ghost" className="text-rose-400" onClick={doUnlink} data-testid="client-cipp-unlink"><X className="w-3 h-3 mr-1" />Unlink</Button>
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
            {hygiene?.grade && (
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
              <HealthDial score={hygiene.score || 0} size={120} />
              <div className="text-[10px] text-zinc-500 font-mono mt-2">{hygiene.total_users} users · {hygiene.counts?.enabled_users || 0} active</div>
            </div>
            <div className="space-y-3">
              {/* dim breakdown */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {hygiene.breakdown && Object.entries(hygiene.breakdown).map(([k, v]) => {
                  const pct = v.max ? (v.earned / v.max) * 100 : 0;
                  const color = pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-rose-500";
                  return (
                    <div key={k} className="text-xs" data-testid={`hygiene-dim-${k}`}>
                      <div className="flex justify-between">
                        <span className="text-zinc-500 uppercase tracking-wider text-[9px]">{k.replace(/_/g, " ")}</span>
                        <span className="text-[9px] font-mono text-zinc-400">{v.earned}/{v.max}</span>
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
                        <span className="text-[10px] text-zinc-500 font-mono shrink-0">{r.impact}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* upsell hint */}
              {hygiene.score < 70 && (
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
                      <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => doReset(u)} data-testid={`client-cipp-user-reset-${u.id}`}><RefreshCw className="w-3 h-3 mr-0.5" />Reset</Button>
                      <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => doToggleSignin(u)} data-testid={`client-cipp-user-block-${u.id}`}>
                        {u.accountEnabled ? <><Lock className="w-3 h-3 mr-0.5" />Block</> : <><Unlock className="w-3 h-3 mr-0.5" />Unblock</>}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 text-[10px] text-rose-400" onClick={() => doOffboard(u)} data-testid={`client-cipp-user-offboard-${u.id}`}><UserX className="w-3 h-3 mr-0.5" />Offboard</Button>
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
        <DialogContent className="max-w-xl" data-testid="client-cipp-create-dialog">
          <DialogHeader>
            <DialogTitle>Create M365 user</DialogTitle>
            <DialogDescription>{clientDoc?.cipp_tenant_display}</DialogDescription>
          </DialogHeader>
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
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={doCreateUser} disabled={busy} data-testid="client-cipp-create-submit">{busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <UserPlus className="w-4 h-4 mr-1" />}Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* License dialog */}
      <Dialog open={!!licenseDialog} onOpenChange={() => setLicenseDialog(null)}>
        <DialogContent data-testid="client-cipp-license-dialog">
          <DialogHeader><DialogTitle>Manage licenses · {licenseDialog?.userPrincipalName}</DialogTitle></DialogHeader>
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
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLicenseDialog(null)}>Cancel</Button>
            <Button onClick={doAssignLicense} disabled={busy || (licAdd.length === 0 && licRemove.length === 0)} data-testid="client-cipp-license-submit">
              {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <KeyRound className="w-4 h-4 mr-1" />}Apply
            </Button>
          </DialogFooter>
        </DialogContent>
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
