/* AccountBriefingDialog.jsx + ExpansionEngineTile + RenewalForecastTile + ChurnRadar + Lifecycle + ActivityHeatmap + HoursBurndown + Achievements + ContractWatch + ScorecardCard + ComplianceCard + AccountPlanCanvas + StakeholderMap + RenewalWatchTable + MyAccountsTable
   One file for fast wiring. */
import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { Loader2, Sparkles, TrendingUp, RefreshCw, Trophy, Flag, AlertTriangle, Crown, FileDown, Shield, Wand2, ChevronRight, Calendar, Activity as ActivityIcon, Save, Plus, Trash2, Award, Gem, Pencil, Mail, Phone, CircleAlert } from "lucide-react";
import { healthColor, moneyShort, tierMeta } from "./clientStudioHelpers";
import { getServiceTierVisual } from "@/lib/serviceTierVisuals";
import { toast } from "sonner";

export function AccountBriefingDialog({ clientId, open, onClose }) {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!open || !clientId) return;
    setData(null);
    axios.get(`${API}/client-studio/${clientId}/account-briefing`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setData(r.data)).catch(() => setData({ briefing: [], summary: "Failed to load" }));
  }, [open, clientId, token]);
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-violet-300" />30-second briefing</DialogTitle></DialogHeader>
        {!data ? <div className="flex items-center gap-2 text-xs"><Loader2 className="w-3 h-3 animate-spin" />Generating…</div>
        : (
          <div className="space-y-3">
            <p className="text-sm text-zinc-200 leading-relaxed bg-violet-500/5 border border-violet-500/30 rounded p-3" data-testid="briefing-summary">{data.summary}</p>
            <ul className="space-y-1.5 text-xs">
              {(data.briefing || []).map((b, i) => <li key={i} className="flex items-start gap-2 text-zinc-200" dangerouslySetInnerHTML={{ __html: `<span class='text-violet-300'>•</span> ${b.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}` }} />)}
            </ul>
          </div>
        )}
        <DialogFooter><Button variant="ghost" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ExpansionEngineTile({ clientId }) {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!clientId) return;
    axios.get(`${API}/client-studio/${clientId}/expansion`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setData(r.data)).catch(() => setData({ opportunities: [], total_arr_uplift: null }));
  }, [clientId, token]);
  if (!data) return <Card className="p-4 flex items-center gap-2 text-xs"><Loader2 className="w-3 h-3 animate-spin" />Scanning expansion opportunities…</Card>;
  return (
    <Card className="p-3 bg-gradient-to-br from-emerald-500/10 to-emerald-500/[0.03] border-emerald-500/30" data-testid="expansion-engine-tile">
      <div className="flex items-center gap-2 mb-2">
        <TrendingUp className="w-3.5 h-3.5 text-emerald-300" />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-200">Expansion Opportunities</p>
        <span className="ml-auto text-[10px] font-mono text-emerald-300">{Number.isFinite(data.total_arr_uplift) ? `+${moneyShort(data.total_arr_uplift)}/yr` : "Pricing required"}</span>
      </div>
      <div className="space-y-1.5">
        {(data.opportunities || []).slice(0, 5).map(o => (
          <div key={o.id} className="flex items-start gap-2 text-[11px] p-1.5 rounded hover:bg-emerald-500/10" data-testid={`expansion-opp-${o.id}`}>
            <span className="text-base leading-none">{o.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-zinc-100">{o.title}</p>
              <p className="text-[10px] text-zinc-400 line-clamp-1">{o.reason}</p>
            </div>
            <span className="text-[10px] font-mono text-emerald-300 flex-shrink-0">{Number.isFinite(o.arr_uplift) ? `+${moneyShort(o.arr_uplift)}` : "Rate card"}</span>
          </div>
        ))}
        {data.opportunities?.length === 0 && <p className="text-[11px] text-zinc-500">No coverage gaps were identified from recorded subscriptions.</p>}
      </div>
    </Card>
  );
}

export function RenewalForecastTile({ clientId }) {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!clientId) return;
    axios.get(`${API}/client-studio/${clientId}/renewal-forecast`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setData(r.data)).catch(() => setData(null));
  }, [clientId, token]);
  if (!data) return <Card className="p-4 flex items-center gap-2 text-xs"><Loader2 className="w-3 h-3 animate-spin" />Forecasting renewal…</Card>;
  const assessed = Number.isFinite(data.probability);
  const color = !assessed ? "text-slate-300 border-slate-500/40 bg-slate-500/10"
              : data.probability >= 75 ? "text-emerald-300 border-emerald-500/40 bg-emerald-500/10"
              : data.probability >= 50 ? "text-amber-300 border-amber-500/40 bg-amber-500/10"
              : "text-red-300 border-red-500/40 bg-red-500/10";
  return (
    <Card className={`p-3 border ${color}`} data-testid="renewal-forecast-tile">
      <div className="flex items-center gap-2 mb-2">
        <RefreshCw className="w-3.5 h-3.5" />
        <p className="text-[11px] font-semibold uppercase tracking-wider">Renewal Forecast</p>
        <span className="ml-auto text-[10px] uppercase font-semibold">{data.verdict}</span>
      </div>
      <div className="flex items-baseline gap-2 mb-2">
        <p className="text-3xl font-mono font-bold">{assessed ? `${data.probability}%` : "Not assessed"}</p>
        <p className="text-[10px] opacity-70">{assessed ? "evidence-backed estimate" : "renewal history is not connected"}</p>
      </div>
      <ul className="text-[10px] opacity-90 space-y-0.5">
        {(data.reasoning || []).map((r, i) => <li key={i}>• {r}</li>)}
      </ul>
    </Card>
  );
}

export function ChurnRadarCard({ clientId }) {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!clientId) return;
    axios.get(`${API}/client-studio/${clientId}/churn-radar`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setData(r.data)).catch(() => setData(null));
  }, [clientId, token]);
  if (!data) return <Card className="p-4 flex items-center gap-2 text-xs"><Loader2 className="w-3 h-3 animate-spin" /></Card>;
  // 6-axis radar polygon
  const axes = data.axes || [];
  if (!Number.isFinite(data.overall_health) || axes.length < 2) return <Card className="p-3 bg-zinc-900/40 border-zinc-800/60" data-testid="churn-radar-card"><div className="flex items-center gap-2"><ActivityIcon className="w-3.5 h-3.5 text-slate-300" /><p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300">Churn Risk Radar</p></div><p className="mt-3 text-xs text-zinc-400">Not assessed. Connect at least two recorded evidence sources before showing a churn-risk indicator.</p></Card>;
  const n = axes.length || 6;
  const cx = 110, cy = 110, R = 90;
  const points = axes.map((a, i) => {
    const angle = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const r = (a.value / 100) * R;
    return `${cx + Math.cos(angle) * r},${cy + Math.sin(angle) * r}`;
  }).join(" ");
  return (
    <Card className="p-3 bg-zinc-900/40 border-zinc-800/60" data-testid="churn-radar-card">
      <div className="flex items-center gap-2 mb-2">
        <ActivityIcon className="w-3.5 h-3.5 text-violet-300" />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300">Churn Risk Radar</p>
        <span className="ml-auto text-[10px] font-semibold" style={{ color: healthColor(data.overall_health) }}>{data.risk_label} risk</span>
      </div>
      <div className="flex items-center gap-3">
        <svg width={220} height={220} viewBox="0 0 220 220">
          {[0.25, 0.5, 0.75, 1].map(p => <circle key={p} cx={cx} cy={cy} r={R * p} fill="none" stroke="#3f3f46" strokeWidth="0.5" />)}
          {axes.map((a, i) => {
            const angle = -Math.PI / 2 + (i / n) * Math.PI * 2;
            const x = cx + Math.cos(angle) * R;
            const y = cy + Math.sin(angle) * R;
            return <line key={a.axis} x1={cx} y1={cy} x2={x} y2={y} stroke="#3f3f46" strokeWidth="0.5" />;
          })}
          <polygon points={points} fill="rgba(167,139,250,0.3)" stroke="#a78bfa" strokeWidth="1.5" />
          {axes.map((a, i) => {
            const angle = -Math.PI / 2 + (i / n) * Math.PI * 2;
            const tx = cx + Math.cos(angle) * (R + 14);
            const ty = cy + Math.sin(angle) * (R + 14);
            return <text key={a.axis} x={tx} y={ty} fontSize="9" fill="#a1a1aa" textAnchor="middle" dominantBaseline="middle">{a.axis}</text>;
          })}
        </svg>
        <div className="flex-1 space-y-0.5 text-[10px]">
          {axes.map(a => (
            <div key={a.axis} className="flex items-center justify-between">
              <span className="text-zinc-400">{a.axis}</span>
              <span className="font-mono text-zinc-200">{a.value}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

export function LifecycleTimelineCard({ clientId }) {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!clientId) return;
    axios.get(`${API}/client-studio/${clientId}/lifecycle`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setData(r.data)).catch(() => setData({ milestones: [] }));
  }, [clientId, token]);
  if (!data) return <Card className="p-4 flex items-center gap-2 text-xs"><Loader2 className="w-3 h-3 animate-spin" /></Card>;
  return (
    <Card className="p-3 bg-zinc-900/40 border-zinc-800/60" data-testid="lifecycle-timeline-card">
      <div className="flex items-center gap-2 mb-3">
        <Flag className="w-3.5 h-3.5 text-violet-300" />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300">Customer Lifecycle</p>
      </div>
      <div className="space-y-2">
        {(data.milestones || []).map(m => (
          <div key={m.id} className="flex items-center gap-3 text-xs" data-testid={`lifecycle-milestone-${m.id}`}>
            <span className="text-base">{m.icon}</span>
            <div className="flex-1">
              <p className="text-zinc-100">{m.label}</p>
              <p className="text-[10px] text-zinc-500">{(m.at || "").slice(0, 10)}</p>
            </div>
            {m.future && <span className="text-[9px] uppercase text-amber-300">Upcoming</span>}
          </div>
        ))}
        {!(data.milestones || []).length && <p className="text-[11px] text-zinc-500">No milestones yet.</p>}
      </div>
    </Card>
  );
}

export function ActivityHeatmapCard({ clientId }) {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!clientId) return;
    axios.get(`${API}/client-studio/${clientId}/activity-heatmap?days=90`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setData(r.data)).catch(() => setData(null));
  }, [clientId, token]);
  if (!data) return <Card className="p-4 flex items-center gap-2 text-xs"><Loader2 className="w-3 h-3 animate-spin" /></Card>;
  const max = Math.max(data.max || 1, 1);
  return (
    <Card className="p-3 bg-zinc-900/40 border-zinc-800/60" data-testid="activity-heatmap-card">
      <div className="flex items-center gap-2 mb-2">
        <Calendar className="w-3.5 h-3.5 text-violet-300" />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300">90-day Activity</p>
      </div>
      <div className="flex flex-wrap gap-0.5">
        {(data.days || []).map(d => {
          const opacity = d.count === 0 ? 0.08 : 0.25 + (d.count / max) * 0.75;
          return <div key={d.date} title={`${d.date} · ${d.count}`} className="w-2.5 h-2.5 rounded-sm" style={{ background: `rgba(139,92,246,${opacity})` }} />;
        })}
      </div>
    </Card>
  );
}

export function HoursBurndownCard({ clientId }) {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!clientId) return;
    axios.get(`${API}/client-studio/${clientId}/hours-burndown`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setData(r.data)).catch(() => setData(null));
  }, [clientId, token]);
  if (!data) return <Card className="p-4 flex items-center gap-2 text-xs"><Loader2 className="w-3 h-3 animate-spin" /></Card>;
  const assessed = Number.isFinite(data.pct);
  const pct = assessed ? Math.min(100, data.pct) : 0;
  const color = pct > 90 ? "bg-red-500" : pct > 70 ? "bg-amber-400" : "bg-emerald-500";
  return (
    <Card className="p-3 bg-zinc-900/40 border-zinc-800/60" data-testid="hours-burndown-card">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300 mb-2">Retainer Hours</p>
      <div className="flex items-baseline gap-2 mb-1">
        <p className="text-2xl font-mono font-bold text-zinc-100">{assessed ? `${data.used}h` : "Not set"}</p>
        <p className="text-[11px] text-zinc-500">{assessed ? `used / ${data.purchased}h` : "No retainer allocation recorded"}</p>
        <p className="ml-auto text-[10px] font-mono text-zinc-400">{assessed ? `${data.remaining}h left` : "—"}</p>
      </div>
      <div className="h-1.5 rounded bg-zinc-800 overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </Card>
  );
}

export function AchievementsCard({ clientId }) {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!clientId) return;
    axios.get(`${API}/client-studio/${clientId}/achievements`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setData(r.data)).catch(() => setData({ achievements: [] }));
  }, [clientId, token]);
  if (!data) return <Card className="p-4 flex items-center gap-2 text-xs"><Loader2 className="w-3 h-3 animate-spin" /></Card>;
  return (
    <Card className="p-3 bg-zinc-900/40 border-zinc-800/60" data-testid="achievements-card">
      <div className="flex items-center gap-2 mb-2">
        <Trophy className="w-3.5 h-3.5 text-amber-300" />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300">Achievements</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(data.achievements || []).map(a => (
          <span key={a.id} className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-200" data-testid={`achievement-${a.id}`}>
            <span>{a.icon}</span>{a.title}
          </span>
        ))}
        {!(data.achievements || []).length && <p className="text-[11px] text-zinc-500">No achievements yet — first one is coming!</p>}
      </div>
    </Card>
  );
}

export function ContractWatchCard({ clientId }) {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!clientId) return;
    axios.get(`${API}/client-studio/${clientId}/contracts`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setData(r.data)).catch(() => setData({ contracts: [] }));
  }, [clientId, token]);
  if (!data) return <Card className="p-4 flex items-center gap-2 text-xs"><Loader2 className="w-3 h-3 animate-spin" /></Card>;
  return (
    <Card className="p-3 bg-zinc-900/40 border-zinc-800/60" data-testid="contract-watch-card">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300 mb-2">Contract Watch</p>
      <div className="space-y-1.5">
        {(data.contracts || []).map(c => {
          const days = c.days_to_renewal;
          const urgent = days !== null && days <= 60;
          return (
            <button type="button" key={c.id} onClick={() => { window.location.assign(`/contracts?contract=${encodeURIComponent(c.id)}`); }} className="flex w-full items-center justify-between rounded p-1.5 text-left text-[11px] transition-colors hover:bg-zinc-800/40">
              <div className="min-w-0">
                <p className="text-zinc-100 truncate">{c.name || c.title || "Contract"}</p>
                <p className="text-[10px] text-zinc-500">{c.type || "—"} · {moneyShort(c.value || 0)}/mo</p>
              </div>
              <span className={`text-[10px] font-mono ml-2 ${urgent ? "text-red-300" : "text-zinc-400"}`}>{days != null ? `${days}d` : "—"}</span>
            </button>
          );
        })}
        {!(data.contracts || []).length && <p className="text-[11px] text-zinc-500">No contracts on file.</p>}
      </div>
    </Card>
  );
}

export function ScorecardCard({ clientId, onExport }) {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!clientId) return;
    axios.get(`${API}/client-studio/${clientId}/scorecard`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setData(r.data)).catch(() => setData(null));
  }, [clientId, token]);
  if (!data) return <Card className="p-4 flex items-center gap-2 text-xs"><Loader2 className="w-3 h-3 animate-spin" /></Card>;
  return (
    <Card className="p-3 bg-gradient-to-br from-violet-500/10 to-indigo-500/[0.03] border-violet-500/30" data-testid="scorecard-card">
      <div className="flex items-center gap-2 mb-2">
        <FileDown className="w-3.5 h-3.5 text-violet-300" />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-violet-200">MSP Scorecard</p>
        <Button size="sm" variant="ghost" className="ml-auto h-6 text-[10px]" onClick={() => onExport && onExport(data)}>Export</Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(data.metrics || []).map(m => (
          <div key={m.label} className="bg-zinc-950/40 rounded p-1.5">
            <p className="text-[9px] text-zinc-500 uppercase">{m.label}</p>
            <p className="text-sm font-mono font-semibold text-zinc-100">{m.value}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function ComplianceCard({ clientId }) {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!clientId) return;
    axios.get(`${API}/client-studio/${clientId}/compliance`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setData(r.data)).catch(() => setData(null));
  }, [clientId, token]);
  if (!data) return <Card className="p-4 flex items-center gap-2 text-xs"><Loader2 className="w-3 h-3 animate-spin" /></Card>;
  return (
    <Card className="p-3 bg-zinc-900/40 border-zinc-800/60" data-testid="compliance-card">
      <div className="flex items-center gap-2 mb-2">
        <Shield className="w-3.5 h-3.5 text-sky-300" />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300">Compliance</p>
        <span className="ml-auto text-[10px] font-mono text-sky-300">{Number.isFinite(data.overall_score) ? `${data.overall_score}%` : "Not assessed"}</span>
      </div>
      <div className="space-y-1.5">
        {(data.frameworks || []).map(f => (
          <div key={f.name} data-testid={`compliance-fw-${f.name.replace(/\s/g, '-')}`}>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-zinc-200">{f.icon} {f.name}</span>
              <span className="font-mono text-zinc-300">{Number.isFinite(f.score) ? `${f.score}%` : "Not assessed"}</span>
            </div>
            <div className="h-1 rounded bg-zinc-800 overflow-hidden">
              <div className="h-full transition-all" style={{ width: `${Number.isFinite(f.score) ? f.score : 0}%`, background: healthColor(f.score) }} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function AccountPlanCanvas({ clientId }) {
  const { token } = useAuth();
  const [plan, setPlan] = useState({ goals: [], risks: [], opportunities: [], people: [], next_actions: [] });
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  const [loadedClientId, setLoadedClientId] = useState(null);
  const operation = useRef(false);
  const currentClient = useRef(clientId);
  currentClient.current = clientId;
  useEffect(() => {
    if (!clientId) return;
    const controller = new AbortController();
    setLoading(true);
    setLoadError(false);
    setLoadedClientId(null);
    setPlan({ goals: [], risks: [], opportunities: [], people: [], next_actions: [] });
    axios.get(`${API}/client-studio/${clientId}/account-plan`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, timeout: 15000 })
      .then(r => {
        if (controller.signal.aborted) return;
        setPlan({ goals: [], risks: [], opportunities: [], people: [], next_actions: [], ...(r.data || {}) });
        setLoadedClientId(clientId);
      })
      .catch(() => { if (!controller.signal.aborted) setLoadError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [clientId, token, reload]);

  const save = async () => {
    if (operation.current || loadedClientId !== clientId || loadError) return;
    operation.current = true;
    setSaving(true);
    try {
      await axios.post(`${API}/client-studio/${clientId}/account-plan`, plan, { headers: { Authorization: `Bearer ${token}` } });
      toast.success("Account plan saved");
    } catch { toast.error("Failed to save"); }
    finally { operation.current = false; setSaving(false); }
  };
  const generate = async () => {
    if (operation.current || loadedClientId !== clientId || loadError) return;
    operation.current = true;
    setGenerating(true);
    try {
      const r = await axios.post(`${API}/client-studio/${clientId}/account-plan/generate`, {}, { headers: { Authorization: `Bearer ${token}` } });
      if (currentClient.current !== clientId) return;
      setPlan({ goals: [], risks: [], opportunities: [], people: [], next_actions: [], ...(r.data || {}) });
      toast.success("Evidence-based starter plan saved");
    } catch { toast.error("Failed to generate"); }
    finally { operation.current = false; setGenerating(false); }
  };
  const updateList = (key, idx, value) => setPlan(p => ({ ...p, [key]: p[key].map((it, i) => i === idx ? value : it) }));
  const addItem = (key) => setPlan(p => ({ ...p, [key]: [...(p[key] || []), key === "opportunities" ? { title: "", value: 0 } : ""] }));
  const removeItem = (key, idx) => setPlan(p => ({ ...p, [key]: p[key].filter((_, i) => i !== idx) }));

  if (loadError) return <Card className="p-4 space-y-3" role="alert"><p>Account plan could not be loaded. Editing is disabled to protect the existing plan.</p><Button variant="outline" onClick={() => setReload(value => value + 1)}>Retry loading plan</Button></Card>;
  if (loading || loadedClientId !== clientId) return <Card className="p-4 flex items-center gap-2 text-xs"><Loader2 className="w-3 h-3 animate-spin" />Loading plan…</Card>;
  const sections = [
    {
      key: "goals",
      label: "Business outcomes",
      description: "What the client is trying to achieve with their technology.",
      placeholder: "e.g. Enable a secure second site before Q4",
      addLabel: "Add outcome",
      accent: "text-cyan-200 border-cyan-400/20 bg-cyan-400/[0.04]",
    },
    {
      key: "risks",
      label: "Account risks",
      description: "A recorded concern that needs ownership or review.",
      placeholder: "e.g. Renewal discussion has not been scheduled",
      addLabel: "Add risk",
      accent: "text-amber-200 border-amber-400/20 bg-amber-400/[0.04]",
    },
    {
      key: "opportunities",
      label: "Commercial opportunities",
      description: "Potential work that still needs validation, pricing or approval.",
      placeholder: "Opportunity title",
      addLabel: "Add opportunity",
      isObj: true,
      accent: "text-violet-200 border-violet-400/20 bg-violet-400/[0.04]",
    },
    {
      key: "people",
      label: "Relationship cues",
      description: "Useful context for the account team; map people in Stakeholder Map.",
      placeholder: "e.g. Finance lead prefers a concise monthly review",
      addLabel: "Add cue",
      accent: "text-emerald-200 border-emerald-400/20 bg-emerald-400/[0.04]",
    },
    {
      key: "next_actions",
      label: "Next commitments",
      description: "A clear promise or follow-through item. Assign it in Follow-ups.",
      placeholder: "e.g. Confirm the QBR attendee list by Friday",
      addLabel: "Add commitment",
      accent: "text-sky-200 border-sky-400/20 bg-sky-400/[0.04]",
    },
  ];
  const populatedSections = sections.filter((section) => (plan[section.key] || []).length > 0).length;
  const hasPlanContent = populatedSections > 0;
  const updatedAt = plan.updated_at && !Number.isNaN(new Date(plan.updated_at).getTime())
    ? new Date(plan.updated_at).toLocaleString()
    : null;
  return (
    <Card className="overflow-hidden border-violet-400/20 bg-[linear-gradient(145deg,rgba(39,24,62,0.34),rgba(9,12,20,0.66)_55%,rgba(8,20,29,0.48))] shadow-[0_14px_42px_rgba(0,0,0,0.18)]" data-testid="account-plan-canvas">
      <div className="border-b border-white/[0.07] px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-violet-400/25 bg-violet-400/10 text-violet-200"><Flag className="h-4 w-4" /></span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-violet-200">Client success workspace</p>
              <h3 className="mt-1 text-sm font-semibold text-zinc-100">Strategic account plan</h3>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-zinc-400">Keep account context deliberate: outcomes, risks, commercial work, relationship cues and the next commitments.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" className="h-8 border-violet-400/20 bg-violet-400/[0.04] text-[11px] text-violet-100 hover:bg-violet-400/[0.1]" onClick={generate} disabled={generating || saving || hasPlanContent} data-testid="account-plan-ai-generate" title="Starter plans are available only for an empty plan, so recorded work is never overwritten.">
              {generating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Wand2 className="mr-1.5 h-3.5 w-3.5" />}Use evidence starter
            </Button>
            <Button size="sm" className="h-8 bg-violet-600 text-[11px] hover:bg-violet-500" onClick={save} disabled={saving || generating} data-testid="account-plan-save">
              {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}Save changes
            </Button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.07] bg-black/15 px-3 py-2.5">
          <div className="min-w-[116px]">
            <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-zinc-500">Plan coverage</p>
            <p className="mt-0.5 text-xs font-medium text-zinc-200">{populatedSections} of {sections.length} areas recorded</p>
          </div>
          <div className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-zinc-800/90"><div className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-violet-400 to-fuchsia-300 transition-all duration-500" style={{ width: `${(populatedSections / sections.length) * 100}%` }} /></div>
          <p className="text-[10px] text-zinc-500">{updatedAt ? `Last saved ${updatedAt}` : "No plan has been saved yet"}</p>
        </div>
      </div>
      <div className="p-4 sm:p-5">
        {!hasPlanContent && <div className="mb-4 rounded-xl border border-dashed border-violet-400/25 bg-violet-400/[0.04] p-3.5" data-testid="account-plan-empty-state"><div className="flex gap-3"><Wand2 className="mt-0.5 h-4 w-4 shrink-0 text-violet-200" /><div><p className="text-xs font-semibold text-zinc-100">Start from evidence or build deliberately</p><p className="mt-1 text-[11px] leading-5 text-zinc-400">The starter uses recorded service evidence only. You can instead add exactly the context your account team needs—nothing is inferred or sent to the client.</p></div></div></div>}
        <fieldset disabled={saving || generating} className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {sections.map((section) => (
            <section key={section.key} className="rounded-xl border border-white/[0.07] bg-black/15 p-3.5 transition-colors hover:border-white/[0.12]" data-testid={`plan-section-${section.key}`}>
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <div className={`inline-flex rounded-md border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.13em] ${section.accent}`}>{section.label}</div>
                  <p className="mt-2 text-[11px] leading-4 text-zinc-500">{section.description}</p>
                </div>
                <span className="shrink-0 rounded-full border border-white/[0.08] bg-black/10 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">{(plan[section.key] || []).length}</span>
              </div>
              <div className="space-y-2">
                {(plan[section.key] || []).map((item, index) => (
                  <div key={index} className={section.isObj ? "grid grid-cols-[minmax(0,1fr)_112px_auto] items-center gap-2" : "flex items-center gap-2"}>
                    {section.isObj ? <>
                      <Input aria-label={`Opportunity ${index + 1} title`} value={item?.title || ""} onChange={(event) => updateList(section.key, index, { ...item, title: event.target.value })} placeholder={section.placeholder} className="h-8 text-xs" />
                      <Input aria-label={`Opportunity ${index + 1} estimated value`} type="number" min="0" value={item?.value ?? ""} onChange={(event) => updateList(section.key, index, { ...item, value: event.target.value === "" ? null : Number(event.target.value) })} className="h-8 text-xs" placeholder="Est. value" />
                    </> : <Input aria-label={`${section.label} item ${index + 1}`} value={item || ""} onChange={(event) => updateList(section.key, index, event.target.value)} placeholder={section.placeholder} className="h-8 text-xs" />}
                    <Button variant="ghost" size="icon" aria-label={`Remove ${section.label.toLowerCase()} item ${index + 1}`} className="h-8 w-8 shrink-0 text-zinc-500 hover:bg-rose-500/10 hover:text-rose-200" onClick={() => removeItem(section.key, index)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                ))}
                <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px] text-violet-200 hover:bg-violet-400/[0.08] hover:text-violet-100" onClick={() => addItem(section.key)}><Plus className="mr-1 h-3 w-3" />{section.addLabel}</Button>
              </div>
            </section>
          ))}
        </fieldset>
      </div>
    </Card>
  );
}

export function StakeholderMapCard({ clientId }) {
  const { token } = useAuth();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [editor, setEditor] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", title: "", email: "", phone: "", role: "influencer", relationship_strength: 50, sentiment: "", notes: "" });
  const loadRequest = useRef(0);
  const reload = useCallback(async () => {
    if (!clientId) return;
    const request = ++loadRequest.current;
    setLoading(true);
    setLoadError(false);
    try {
      const response = await axios.get(`${API}/client-studio/${clientId}/stakeholders`, { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 });
      if (request !== loadRequest.current) return;
      setList(Array.isArray(response.data) ? response.data : []);
    } catch {
      if (request === loadRequest.current) setLoadError(true);
    } finally {
      if (request === loadRequest.current) setLoading(false);
    }
  }, [clientId, token]);
  useEffect(() => { reload(); }, [reload]);
  const resetForm = () => setForm({ name: "", title: "", email: "", phone: "", role: "influencer", relationship_strength: 50, sentiment: "", notes: "" });
  const openCreate = () => { resetForm(); setEditor({ mode: "create" }); };
  const openEdit = (stakeholder) => {
    setForm({
      name: stakeholder.name || "",
      title: stakeholder.title || "",
      email: stakeholder.email || "",
      phone: stakeholder.phone || "",
      role: stakeholder.role || "influencer",
      relationship_strength: Number.isFinite(Number(stakeholder.relationship_strength)) ? Number(stakeholder.relationship_strength) : 50,
      sentiment: stakeholder.sentiment == null ? "" : String(stakeholder.sentiment),
      notes: stakeholder.notes || "",
    });
    setEditor(stakeholder);
  };
  const save = async () => {
    if (saving) return;
    if (!form.name.trim()) return toast.error("Stakeholder name is required");
    const payload = {
      name: form.name.trim(),
      title: form.title.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      role: form.role,
      relationship_strength: Math.max(0, Math.min(100, Number(form.relationship_strength) || 0)),
      sentiment: form.sentiment === "" ? null : Number(form.sentiment),
      notes: form.notes.trim(),
    };
    setSaving(true);
    try {
      if (editor?.id) await axios.put(`${API}/client-studio/stakeholders/${editor.id}`, payload, { headers: { Authorization: `Bearer ${token}` } });
      else await axios.post(`${API}/client-studio/${clientId}/stakeholders`, payload, { headers: { Authorization: `Bearer ${token}` } });
      setEditor(null);
      await reload();
      toast.success(editor?.id ? "Stakeholder updated" : "Stakeholder added");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not save stakeholder");
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!deleting?.id || saving) return;
    setSaving(true);
    try {
      await axios.delete(`${API}/client-studio/stakeholders/${deleting.id}`, { headers: { Authorization: `Bearer ${token}` } });
      setDeleting(null);
      await reload();
      toast.success("Stakeholder removed");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not remove stakeholder");
    } finally {
      setSaving(false);
    }
  };
  const ROLE_COLOR = {
    decision_maker: "bg-violet-500/20 text-violet-200 border-violet-500/40",
    champion: "bg-emerald-500/20 text-emerald-200 border-emerald-500/40",
    influencer: "bg-sky-500/20 text-sky-200 border-sky-500/40",
    blocker: "bg-red-500/20 text-red-200 border-red-500/40",
    gatekeeper: "bg-amber-500/20 text-amber-200 border-amber-500/40",
  };
  const relationship = (value) => Math.max(0, Math.min(100, Number.isFinite(Number(value)) ? Number(value) : 50));
  const outlook = (value) => {
    if (!Number.isFinite(Number(value))) return { label: "Outlook not recorded", className: "border-zinc-700 bg-zinc-800/50 text-zinc-400" };
    if (Number(value) >= 67) return { label: "Positive outlook", className: "border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-200" };
    if (Number(value) >= 34) return { label: "Neutral outlook", className: "border-sky-400/25 bg-sky-400/[0.08] text-sky-200" };
    return { label: "At-risk outlook", className: "border-amber-400/25 bg-amber-400/[0.08] text-amber-200" };
  };
  const roleLabel = (role) => String(role || "influencer").replaceAll("_", " ");
  const isEditing = Boolean(editor?.id);
  return (
    <Card className="overflow-hidden border-amber-400/20 bg-[linear-gradient(145deg,rgba(47,34,20,0.32),rgba(9,12,20,0.66)_55%,rgba(10,24,27,0.42))] shadow-[0_14px_42px_rgba(0,0,0,0.16)]" data-testid="stakeholder-map-card">
      <div className="flex flex-wrap items-start gap-3 border-b border-white/[0.07] px-4 py-4">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-amber-400/25 bg-amber-400/[0.09] text-amber-200"><Crown className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-amber-200">Relationship intelligence</p><span className="rounded-full border border-white/[0.08] bg-black/10 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">{list.length}</span></div>
          <h3 className="mt-1 text-sm font-semibold text-zinc-100">Stakeholder map</h3>
          <p className="mt-1 text-[11px] leading-5 text-zinc-400">Map the people who shape a renewal, escalation, business outcome or buying decision.</p>
        </div>
        <Button size="sm" className="h-8 bg-amber-500/90 text-[11px] text-zinc-950 hover:bg-amber-400" onClick={openCreate} data-testid="stakeholder-add-btn"><Plus className="mr-1.5 h-3.5 w-3.5" />Add stakeholder</Button>
      </div>
      <div className="p-4">
        {loading ? <div className="flex items-center gap-2 py-7 text-xs text-zinc-400"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading relationship context</div> : null}
        {loadError ? <div className="rounded-xl border border-rose-400/20 bg-rose-400/[0.05] p-3" role="alert"><div className="flex items-start gap-2"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-200" /><div className="min-w-0"><p className="text-xs font-semibold text-rose-100">Stakeholder map could not be loaded</p><p className="mt-1 text-[11px] leading-4 text-zinc-400">Nothing has been changed. Retry before editing relationship information.</p><Button variant="outline" size="sm" className="mt-3 h-7 text-[10px]" onClick={reload}>Retry</Button></div></div></div> : null}
        {!loading && !loadError && list.length === 0 ? <div className="rounded-xl border border-dashed border-amber-400/25 bg-amber-400/[0.035] p-4 text-center"><Crown className="mx-auto h-5 w-5 text-amber-200" /><p className="mt-2 text-xs font-semibold text-zinc-100">No stakeholder context recorded</p><p className="mx-auto mt-1 max-w-sm text-[11px] leading-5 text-zinc-400">Keep the operational contact directory in People. Use this map for the relationship context that helps a technician or account manager make the right next move.</p><Button variant="outline" size="sm" className="mt-3 h-8 border-amber-400/20 text-[11px] text-amber-100 hover:bg-amber-400/[0.08]" onClick={openCreate}><Plus className="mr-1.5 h-3.5 w-3.5" />Map first stakeholder</Button></div> : null}
        {!loading && !loadError && list.length > 0 ? <div className="space-y-2.5">{list.map((stakeholder) => {
          const strength = relationship(stakeholder.relationship_strength);
          const sentiment = outlook(stakeholder.sentiment);
          return <article key={stakeholder.id} className="group rounded-xl border border-white/[0.07] bg-black/15 p-3 transition hover:border-amber-400/25 hover:bg-amber-400/[0.035]" data-testid={`stakeholder-${stakeholder.id}`}>
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-400/20 bg-amber-400/[0.08] text-sm font-semibold text-amber-100">{String(stakeholder.name || "?").slice(0, 1).toUpperCase()}</div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5"><p className="min-w-0 truncate text-xs font-semibold text-zinc-100">{stakeholder.name}</p><span className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] ${ROLE_COLOR[stakeholder.role] || ROLE_COLOR.influencer}`}>{roleLabel(stakeholder.role)}</span><span className={`rounded border px-1.5 py-0.5 text-[9px] ${sentiment.className}`}>{sentiment.label}</span></div>
                {(stakeholder.title || stakeholder.email || stakeholder.phone) ? <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] text-zinc-500"><span>{stakeholder.title || "Title not recorded"}</span>{stakeholder.email ? <span className="truncate" data-sensitive="email">{stakeholder.email}</span> : null}{stakeholder.phone ? <span data-sensitive="phone">{stakeholder.phone}</span> : null}</div> : <p className="mt-1 text-[10px] text-zinc-500">Contact channel not recorded</p>}
                <div className="mt-3 flex items-center gap-2"><span className="w-20 shrink-0 text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Relationship</span><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800"><div className="h-full rounded-full bg-gradient-to-r from-amber-400 via-emerald-400 to-cyan-300 transition-all duration-500" style={{ width: `${strength}%` }} /></div><span className="w-7 text-right font-mono text-[10px] text-zinc-400">{strength}</span></div>
                {stakeholder.notes ? <p className="mt-3 border-l border-amber-400/25 pl-2.5 text-[11px] leading-4 text-zinc-400">{stakeholder.notes}</p> : null}
              </div>
              <div className="flex shrink-0 items-center gap-0.5"><Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-400 hover:bg-amber-400/[0.08] hover:text-amber-100" onClick={() => openEdit(stakeholder)} aria-label={`Edit ${stakeholder.name}`}><Pencil className="h-3.5 w-3.5" /></Button>{stakeholder.email ? <Button asChild variant="ghost" size="icon" className="h-8 w-8 text-zinc-400 hover:bg-cyan-400/[0.08] hover:text-cyan-100" title={`Email ${stakeholder.name}`}><a href={`mailto:${stakeholder.email}`} aria-label={`Email ${stakeholder.name}`}><Mail className="h-3.5 w-3.5" /></a></Button> : null}{stakeholder.phone ? <Button asChild variant="ghost" size="icon" className="h-8 w-8 text-zinc-400 hover:bg-cyan-400/[0.08] hover:text-cyan-100" title={`Call ${stakeholder.name}`}><a href={`tel:${stakeholder.phone}`} aria-label={`Call ${stakeholder.name}`}><Phone className="h-3.5 w-3.5" /></a></Button> : null}<Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-500 opacity-100 hover:bg-rose-400/[0.08] hover:text-rose-200 sm:opacity-0 sm:group-hover:opacity-100" onClick={() => setDeleting(stakeholder)} aria-label={`Remove ${stakeholder.name}`}><Trash2 className="h-3.5 w-3.5" /></Button></div>
            </div>
          </article>;
        })}</div> : null}
      </div>
      <Dialog open={Boolean(editor)} onOpenChange={(open) => !open && !saving && setEditor(null)}>
        <NexusWorkflowDialog eyebrow="Client success · relationship context" title={isEditing ? "Edit stakeholder" : "Map a stakeholder"} description="Capture the people who influence outcomes without duplicating the operational contact directory. These notes stay internal to your Nexus team." icon={Crown} tone="amber" className="max-w-2xl" contentClassName="space-y-5" data-testid="stakeholder-editor" footer={<><Button variant="outline" onClick={() => setEditor(null)} disabled={saving}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Crown className="mr-1.5 h-4 w-4" />}{isEditing ? "Save stakeholder" : "Add stakeholder"}</Button></>}>
          <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.05] px-3 py-2.5 text-[11px] leading-5 text-zinc-400">Use <span className="font-medium text-zinc-200">People</span> for day-to-day contacts. Map only the relationship context that helps account work: decision makers, champions, influencers, blockers and gatekeepers.</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2 sm:col-span-2"><Label htmlFor="stakeholder-name">Name</Label><Input id="stakeholder-name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. Taylor Morgan" autoFocus data-testid="stakeholder-name-input" /></div>
            <div className="grid gap-2"><Label htmlFor="stakeholder-title">Title</Label><Input id="stakeholder-title" value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="e.g. Chief Financial Officer" /></div>
            <div className="grid gap-2"><Label htmlFor="stakeholder-role">Relationship role</Label><select id="stakeholder-role" value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none transition focus-visible:ring-1 focus-visible:ring-ring"><option value="decision_maker">Decision maker</option><option value="champion">Champion</option><option value="influencer">Influencer</option><option value="blocker">Blocker</option><option value="gatekeeper">Gatekeeper</option></select></div>
            <div className="grid gap-2"><Label htmlFor="stakeholder-email">Email</Label><Input id="stakeholder-email" type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} placeholder="name@client.example" /></div>
            <div className="grid gap-2"><Label htmlFor="stakeholder-phone">Direct number</Label><Input id="stakeholder-phone" type="tel" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} placeholder="+61 …" /></div>
            <div className="grid gap-2 sm:col-span-2"><div className="flex items-center justify-between gap-3"><Label htmlFor="stakeholder-strength">Manual relationship strength</Label><span className="font-mono text-xs text-amber-200">{form.relationship_strength}/100</span></div><input id="stakeholder-strength" type="range" min="0" max="100" value={form.relationship_strength} onChange={(event) => setForm((current) => ({ ...current, relationship_strength: Number(event.target.value) }))} className="accent-amber-400" /><p className="text-[11px] leading-4 text-muted-foreground">This is a deliberate internal assessment—not a client score or an inferred sentiment.</p></div>
            <div className="grid gap-2 sm:col-span-2"><Label htmlFor="stakeholder-outlook">Manual relationship outlook</Label><select id="stakeholder-outlook" value={form.sentiment} onChange={(event) => setForm((current) => ({ ...current, sentiment: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none transition focus-visible:ring-1 focus-visible:ring-ring"><option value="">Not recorded</option><option value="75">Positive</option><option value="50">Neutral</option><option value="25">At risk</option></select></div>
            <div className="grid gap-2 sm:col-span-2"><Label htmlFor="stakeholder-notes">Internal relationship context</Label><Textarea id="stakeholder-notes" rows={4} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder="What should the next technician or account manager know before they engage this person?" /></div>
          </div>
        </NexusWorkflowDialog>
      </Dialog>
      <Dialog open={Boolean(deleting)} onOpenChange={(open) => !open && !saving && setDeleting(null)}>
        <NexusWorkflowDialog eyebrow="Client success · deliberate removal" title={`Remove ${deleting?.name || "stakeholder"}?`} description="This removes the relationship record from Nexus. It does not delete a separate People directory contact or historical audit entry." icon={Trash2} tone="rose" className="max-w-xl" footer={<><Button variant="outline" onClick={() => setDeleting(null)} disabled={saving}>Keep stakeholder</Button><Button variant="destructive" onClick={remove} disabled={saving}>{saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1.5 h-4 w-4" />}Remove stakeholder</Button></>}><p className="text-sm text-muted-foreground">Only remove a record when the relationship context is no longer useful or was recorded in error.</p></NexusWorkflowDialog>
      </Dialog>
    </Card>
  );
}

export function RenewalWatchTable({ onOpen }) {
  const { token } = useAuth();
  const [data, setData] = useState([]);
  useEffect(() => {
    axios.get(`${API}/client-studio/renewal-watch`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setData(r.data?.at_risk || [])).catch(() => setData([]));
  }, [token]);
  if (data.length === 0) return null;
  return (
    <Card className="p-3 bg-amber-500/5 border-amber-500/30" data-testid="renewal-watch-table">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-300" />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-200">Renewal Watch · next 90 days</p>
        <span className="ml-auto text-[10px] font-mono text-amber-300">{data.length} accounts</span>
      </div>
      <div className="space-y-1.5">
        {data.slice(0, 8).map(r => (
          <button key={r.client_id} onClick={() => onOpen && onOpen(r.client_id)} className="w-full text-left p-2 rounded bg-zinc-950/40 hover:bg-violet-500/10 flex items-center gap-2 text-[11px]" data-testid={`renewal-watch-row-${r.client_id}`}>
            <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase ${r.risk_level === "high" ? "bg-red-500/20 text-red-200" : r.risk_level === "medium" ? "bg-amber-500/20 text-amber-200" : "bg-zinc-500/20 text-zinc-300"}`}>{r.risk_level}</span>
            <span className="text-zinc-100 flex-1 truncate">{r.client_name}</span>
            <span className="text-zinc-400 font-mono">{r.days_to_renewal}d · {moneyShort(r.value)}/mo</span>
            <span className="text-violet-300 text-[10px]">{r.suggested_action}</span>
            <ChevronRight className="w-3 h-3 text-zinc-500" />
          </button>
        ))}
      </div>
    </Card>
  );
}

export function MyAccountsTable({ onOpen }) {
  const { token } = useAuth();
  const [accounts, setAccounts] = useState([]);
  useEffect(() => {
    axios.get(`${API}/client-studio/my-accounts`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setAccounts(r.data?.accounts || [])).catch(() => setAccounts([]));
  }, [token]);
  return (
    <Card className="p-3 bg-zinc-900/40 border-zinc-800/60" data-testid="my-accounts-table">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300 mb-2">My Accounts ({accounts.length})</p>
      {accounts.length === 0 && <p className="text-[11px] text-zinc-500">No accounts assigned to you yet.</p>}
      <div className="space-y-1">
        {accounts.map(a => {
          const m = tierMeta(a.tier);
          const TierIcon = { award: Award, crown: Crown, gem: Gem, shield: Shield }[m.icon] || Shield;
          const tierVisual = getServiceTierVisual({ slug: a.tier, name: m.label });
          return (
            <button key={a.id} onClick={() => onOpen && onOpen(a.id)} className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded hover:bg-violet-500/10 text-[11px]" data-testid={`my-account-${a.id}`}>
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border bg-black/10" style={{ color: tierVisual.color, borderColor: `${tierVisual.color}55` }}><TierIcon className="h-3 w-3" /></span>
              <span className="text-zinc-100 flex-1 truncate flex items-center gap-1.5">
                {a.name}
                {a.vip && <Crown className="w-2.5 h-2.5 text-yellow-300" />}
              </span>
              <span className="font-mono text-zinc-400">{moneyShort(a.mrr)}</span>
              {a.alerts.length > 0 && <span className="text-[9px] px-1 py-0.5 rounded bg-red-500/20 text-red-200">{a.alerts.length}</span>}
            </button>
          );
        })}
      </div>
    </Card>
  );
}
