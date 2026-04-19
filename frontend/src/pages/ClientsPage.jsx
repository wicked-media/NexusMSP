import { useState, useEffect, useMemo, useRef } from "react";
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
  Activity, ChevronRight, Send, RefreshCw, Filter, X, TrendingUp, TrendingDown
} from "lucide-react";
import { Link } from "react-router-dom";
import { AreaChart, Area, ResponsiveContainer } from "recharts";

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
  return (
    <div className={`border-l-2 pl-4 border-${color}-500`}>
      <div className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">{label}</div>
      <div className="flex items-baseline gap-2">
        <div className="text-2xl font-light tracking-tighter text-zinc-100 mt-0.5">{value}</div>
        {trend && <span className={`text-[10px] font-mono ${trend.startsWith("+") ? "text-emerald-400" : trend.startsWith("-") ? "text-rose-400" : "text-zinc-500"}`}>{trend}</span>}
      </div>
    </div>
  );
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
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4 px-6 py-4 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-10">
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
              <Button onClick={createClient} data-testid="create-client-btn"><Plus className="w-4 h-4 mr-1" />Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

function ClientDetailPane({ client, detail, activity, healthDetail, tab, setTab, loading }) {
  const mrrData = client.mrr_trend || [];
  const tierGrad = TIER_COLORS[client.tier] || TIER_COLORS.standard;

  return (
    <div className="flex flex-col h-full" data-testid="client-detail-pane">
      {/* Header */}
      <div className="px-6 py-4 border-b border-zinc-800 flex items-start gap-4 bg-gradient-to-br from-zinc-900/40 to-transparent">
        <div className={`w-14 h-14 rounded-md bg-gradient-to-br ${tierGrad} flex items-center justify-center text-xl font-bold text-white shrink-0`}>
          {client.name?.slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{client.name}</h1>
            <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${LIFECYCLE_COLORS[client.lifecycle] || LIFECYCLE_COLORS.active}`}>{(client.lifecycle || "active").replace("_", " ")}</span>
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-400 font-mono">{client.tier}</span>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-zinc-500 font-mono mt-1">
            {client.industry && <span>{client.industry}</span>}
            {client.email && <span className="flex items-center gap-1"><Mail className="w-2.5 h-2.5" />{client.email}</span>}
            {client.phone && <span className="flex items-center gap-1"><Phone className="w-2.5 h-2.5" />{client.phone}</span>}
            {client.address && <span className="flex items-center gap-1 truncate"><MapPin className="w-2.5 h-2.5" />{client.address}</span>}
          </div>
          <div className="flex items-center gap-1 mt-2">
            <IntegrationChip type="rmm" active={client.integrations.rmm} />
            <IntegrationChip type="acronis" active={client.integrations.acronis} />
            <IntegrationChip type="pax8" active={client.integrations.pax8} />
            <IntegrationChip type="m365" active={client.integrations.m365} />
            {client.last_activity && <span className="text-[10px] text-zinc-500 ml-2 font-mono">last activity {formatDistanceToNow(new Date(client.last_activity), { addSuffix: true })}</span>}
          </div>
        </div>
        <HealthDial score={client.health_score} size={56} />
      </div>

      {/* Quick metrics strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-0 border-b border-zinc-800">
        <div className="px-4 py-3 border-r border-zinc-800">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Monthly Recurring</div>
          <div className="text-lg font-light mt-0.5">${client.mrr.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          <div className="mt-1"><Sparkline data={mrrData} color="#818cf8" /></div>
        </div>
        <div className="px-4 py-3 border-r border-zinc-800">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Open Tickets</div>
          <div className={`text-lg font-light mt-0.5 ${client.open_tickets > 10 ? "text-amber-400" : ""}`}>{client.open_tickets}</div>
          <div className="text-[10px] text-zinc-500 font-mono mt-1">{client.open_tickets > 10 ? "⚠ high volume" : "within range"}</div>
        </div>
        <div className="px-4 py-3 border-r border-zinc-800">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Assets</div>
          <div className="text-lg font-light mt-0.5">{client.asset_count}</div>
          <div className="text-[10px] text-emerald-400 font-mono mt-1">{client.assets_online}/{client.asset_count} online</div>
        </div>
        <div className="px-4 py-3 border-r border-zinc-800">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Contacts</div>
          <div className="text-lg font-light mt-0.5">{client.contact_count}</div>
          <div className="text-[10px] text-zinc-500 font-mono mt-1">{client.active_contracts} active contracts</div>
        </div>
        <div className="px-4 py-3">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">AR Overdue</div>
          <div className={`text-lg font-light mt-0.5 ${client.overdue_count > 0 ? "text-rose-400" : "text-emerald-400"}`}>${client.overdue_amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          <div className="text-[10px] text-zinc-500 font-mono mt-1">{client.overdue_count} invoice{client.overdue_count !== 1 ? "s" : ""}</div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col min-h-0">
        <TabsList className="h-auto rounded-none border-b border-zinc-800 bg-transparent p-0 justify-start gap-1 px-6">
          {[
            { v: "overview", l: "Overview" },
            { v: "tickets", l: "Tickets" },
            { v: "assets", l: "Assets" },
            { v: "contacts", l: "Contacts" },
            { v: "billing", l: "Billing" },
            { v: "integrations", l: "Integrations" },
            { v: "activity", l: "Activity" },
          ].map(t => (
            <TabsTrigger key={t.v} value={t.v} className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-indigo-500 data-[state=active]:text-zinc-100 text-zinc-500 rounded-none py-2 px-3 text-xs tracking-wide uppercase font-medium shadow-none" data-testid={`tab-${t.v}`}>{t.l}</TabsTrigger>
          ))}
        </TabsList>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <TabsContent value="overview" className="mt-0 space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="border border-zinc-800 rounded-md p-4 bg-zinc-950">
                <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2 flex items-center gap-1"><Sparkles className="w-3 h-3 text-indigo-400" />Next Best Action</div>
                <p className="text-sm text-zinc-300">
                  {client.overdue_count > 0 ? <>Client has <strong className="text-rose-400">${client.overdue_amount.toLocaleString()} overdue</strong>. Send SMS reminder or start a dunning chase.</> :
                    client.open_tickets > 10 ? <>Ticket volume is <strong className="text-amber-400">{client.open_tickets}</strong> — book a QBR to understand what's causing the pressure.</> :
                    client.health_score < 70 ? <>Health score <strong className="text-amber-400">{client.health_score}</strong> — review breakdown and mitigate.</> :
                    <>All green. Consider scheduling the next QBR or proposing an upsell.</>}
                </p>
              </div>
              <div className="border border-zinc-800 rounded-md p-4 bg-zinc-950">
                <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2 flex items-center gap-1"><Zap className="w-3 h-3 text-amber-400" />Quick Actions</div>
                <div className="flex flex-wrap gap-2">
                  <Link to={`/tickets?clientId=${client.id}`}><Button size="sm" variant="outline" className="h-7 text-xs" data-testid="qa-new-ticket"><Ticket className="w-3 h-3 mr-1" />New Ticket</Button></Link>
                  <Link to={`/invoices?clientId=${client.id}`}><Button size="sm" variant="outline" className="h-7 text-xs"><DollarSign className="w-3 h-3 mr-1" />New Invoice</Button></Link>
                  <Button size="sm" variant="outline" className="h-7 text-xs"><Send className="w-3 h-3 mr-1" />Send SMS</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs"><Mail className="w-3 h-3 mr-1" />Email</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs"><Timer className="w-3 h-3 mr-1" />Start Timer</Button>
                </div>
              </div>
            </div>

            <div className="border border-zinc-800 rounded-md p-4 bg-zinc-950">
              <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-3 flex items-center justify-between">
                <span>Health Score Breakdown</span>
                {healthDetail && <span className="text-zinc-400 font-mono">{healthDetail.health_score}/100</span>}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {healthDetail?.breakdown ? [
                  { k: "tickets", max: 30, label: "Tickets" },
                  { k: "sla", max: 20, label: "SLA" },
                  { k: "devices", max: 20, label: "Devices" },
                  { k: "payments", max: 20, label: "Payments" },
                  { k: "contracts", max: 10, label: "Contracts" },
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

            <div className="border border-zinc-800 rounded-md p-4 bg-zinc-950">
              <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-3 flex items-center gap-1"><Activity className="w-3 h-3" />Recent Activity</div>
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
          </TabsContent>

          <TabsContent value="tickets" className="mt-0">
            <div className="border border-zinc-800 rounded-md p-6 text-center text-sm text-zinc-500">
              <Ticket className="w-8 h-8 mx-auto mb-3 opacity-40" />
              Deep ticket view — <Link className="text-indigo-400 hover:underline" to={`/tickets?clientId=${client.id}`}>open full Tickets page</Link>
            </div>
          </TabsContent>

          <TabsContent value="assets" className="mt-0">
            <div className="border border-zinc-800 rounded-md p-6 text-center text-sm text-zinc-500">
              <HardDrive className="w-8 h-8 mx-auto mb-3 opacity-40" />
              <Link className="text-indigo-400 hover:underline" to={`/devices?clientId=${client.id}`}>Open {client.asset_count} devices</Link>
            </div>
          </TabsContent>

          <TabsContent value="contacts" className="mt-0">
            <div className="border border-zinc-800 rounded-md p-6 text-center text-sm text-zinc-500">
              <Users className="w-8 h-8 mx-auto mb-3 opacity-40" />
              <Link className="text-indigo-400 hover:underline" to={`/contacts?clientId=${client.id}`}>Open {client.contact_count} contacts</Link>
            </div>
          </TabsContent>

          <TabsContent value="billing" className="mt-0 space-y-2">
            <div className="border border-zinc-800 rounded-md p-6 text-center text-sm text-zinc-500">
              <DollarSign className="w-8 h-8 mx-auto mb-3 opacity-40" />
              <Link className="text-indigo-400 hover:underline" to={`/invoices?clientId=${client.id}`}>Open invoices & recurring</Link>
            </div>
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
