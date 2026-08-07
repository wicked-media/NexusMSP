/* AccountBriefingDialog.jsx + ExpansionEngineTile + RenewalForecastTile + ChurnRadar + Lifecycle + ActivityHeatmap + HoursBurndown + Achievements + ContractWatch + ScorecardCard + ComplianceCard + AccountPlanCanvas + StakeholderMap + RenewalWatchTable + MyAccountsTable
   One file for fast wiring. */
import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Loader2, Sparkles, TrendingUp, RefreshCw, Trophy, Flag, AlertTriangle, Crown, FileDown, Shield, Wand2, ChevronRight, Calendar, Activity as ActivityIcon, Save, Plus, Trash2 } from "lucide-react";
import { healthColor, moneyShort, tierMeta } from "./clientStudioHelpers";
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
  useEffect(() => {
    if (!clientId) return;
    setLoading(true);
    axios.get(`${API}/client-studio/${clientId}/account-plan`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setPlan({ goals: [], risks: [], opportunities: [], people: [], next_actions: [], ...(r.data || {}) }))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [clientId, token]);

  const save = async () => {
    setSaving(true);
    try {
      await axios.post(`${API}/client-studio/${clientId}/account-plan`, plan, { headers: { Authorization: `Bearer ${token}` } });
      toast.success("Account plan saved");
    } catch { toast.error("Failed to save"); }
    finally { setSaving(false); }
  };
  const generate = async () => {
    setGenerating(true);
    try {
      const r = await axios.post(`${API}/client-studio/${clientId}/account-plan/generate`, {}, { headers: { Authorization: `Bearer ${token}` } });
      setPlan({ goals: [], risks: [], opportunities: [], people: [], next_actions: [], ...(r.data || {}) });
      toast.success("AI-drafted 90-day plan");
    } catch { toast.error("Failed to generate"); }
    finally { setGenerating(false); }
  };
  const updateList = (key, idx, value) => setPlan(p => ({ ...p, [key]: p[key].map((it, i) => i === idx ? value : it) }));
  const addItem = (key) => setPlan(p => ({ ...p, [key]: [...(p[key] || []), key === "opportunities" ? { title: "", value: 0 } : ""] }));
  const removeItem = (key, idx) => setPlan(p => ({ ...p, [key]: p[key].filter((_, i) => i !== idx) }));

  if (loading) return <Card className="p-4 flex items-center gap-2 text-xs"><Loader2 className="w-3 h-3 animate-spin" />Loading plan…</Card>;
  const sections = [
    { key: "goals", label: "🎯 Goals", placeholder: "e.g. Grow ARR to $X by Q4" },
    { key: "risks", label: "⚠️ Risks", placeholder: "e.g. Renewal at risk due to ticket volume" },
    { key: "opportunities", label: "💡 Opportunities", placeholder: "{title, value}", isObj: true },
    { key: "people", label: "👥 People", placeholder: "e.g. Sarah Chen — CFO, champion" },
    { key: "next_actions", label: "🚀 Next Actions", placeholder: "e.g. Schedule QBR within 14 days" },
  ];
  return (
    <Card className="p-4 bg-zinc-900/40 border-zinc-800/60" data-testid="account-plan-canvas">
      <div className="flex items-center gap-2 mb-3">
        <Flag className="w-3.5 h-3.5 text-violet-300" />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300">Strategic Account Plan</p>
        <Button size="sm" variant="outline" className="ml-auto h-7 text-[11px]" onClick={generate} disabled={generating} data-testid="account-plan-ai-generate">
          {generating ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Wand2 className="w-3 h-3 mr-1" />}AI-generate
        </Button>
        <Button size="sm" className="h-7 text-[11px] bg-violet-600 hover:bg-violet-500" onClick={save} disabled={saving} data-testid="account-plan-save">
          {saving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />}Save
        </Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {sections.map(s => (
          <div key={s.key} className="bg-zinc-950/40 rounded p-2.5" data-testid={`plan-section-${s.key}`}>
            <p className="text-[10px] uppercase tracking-wider text-zinc-400 mb-1.5">{s.label}</p>
            <div className="space-y-1.5">
              {(plan[s.key] || []).map((it, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  {s.isObj ? (
                    <>
                      <Input value={it?.title || ""} onChange={e => updateList(s.key, i, { ...it, title: e.target.value })} placeholder="Opportunity title" className="text-xs h-7" />
                      <Input type="number" value={it?.value ?? ""} onChange={e => updateList(s.key, i, { ...it, value: e.target.value === "" ? null : Number(e.target.value) })} className="text-xs h-7 w-24" placeholder="Rate card" />
                    </>
                  ) : (
                    <Input value={it || ""} onChange={e => updateList(s.key, i, e.target.value)} placeholder={s.placeholder} className="text-xs h-7" />
                  )}
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-red-300" onClick={() => removeItem(s.key, i)}><Trash2 className="w-3 h-3" /></Button>
                </div>
              ))}
              <Button variant="ghost" size="sm" className="h-6 text-[10px] text-violet-300" onClick={() => addItem(s.key)}><Plus className="w-3 h-3 mr-1" />Add</Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function StakeholderMapCard({ clientId }) {
  const { token } = useAuth();
  const [list, setList] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", title: "", email: "", role: "influencer", relationship_strength: 50, sentiment: null });
  const reload = useCallback(() => axios.get(`${API}/client-studio/${clientId}/stakeholders`, { headers: { Authorization: `Bearer ${token}` } })
    .then(r => setList(r.data || [])).catch(() => setList([])), [clientId, token]);
  useEffect(() => { if (clientId) reload(); }, [clientId, reload]);
  const add = async () => {
    if (!form.name.trim()) return;
    try {
      await axios.post(`${API}/client-studio/${clientId}/stakeholders`, form, { headers: { Authorization: `Bearer ${token}` } });
      setForm({ name: "", title: "", email: "", role: "influencer", relationship_strength: 50, sentiment: null });
      setShowAdd(false);
      reload();
      toast.success("Stakeholder added");
    } catch { toast.error("Failed"); }
  };
  const remove = async (id) => {
    await axios.delete(`${API}/client-studio/stakeholders/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    reload();
  };
  const ROLE_COLOR = {
    decision_maker: "bg-violet-500/20 text-violet-200 border-violet-500/40",
    champion: "bg-emerald-500/20 text-emerald-200 border-emerald-500/40",
    influencer: "bg-sky-500/20 text-sky-200 border-sky-500/40",
    blocker: "bg-red-500/20 text-red-200 border-red-500/40",
    gatekeeper: "bg-amber-500/20 text-amber-200 border-amber-500/40",
  };
  return (
    <Card className="p-3 bg-zinc-900/40 border-zinc-800/60" data-testid="stakeholder-map-card">
      <div className="flex items-center gap-2 mb-2">
        <Crown className="w-3.5 h-3.5 text-amber-300" />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300">Stakeholder Map</p>
        <Button size="sm" variant="ghost" className="ml-auto h-6 text-[10px] text-violet-300" onClick={() => setShowAdd(true)} data-testid="stakeholder-add-btn"><Plus className="w-3 h-3 mr-0.5" />Add</Button>
      </div>
      <div className="space-y-2">
        {list.length === 0 && <p className="text-[11px] text-zinc-500">No stakeholders mapped yet.</p>}
        {list.map(s => (
          <div key={s.id} className="bg-zinc-950/40 rounded p-2 flex items-center gap-2" data-testid={`stakeholder-${s.id}`}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold text-zinc-100 truncate">{s.name}</p>
                <span className={`text-[9px] px-1 py-0.5 rounded border ${ROLE_COLOR[s.role] || ROLE_COLOR.influencer}`}>{(s.role || "").replace('_', ' ')}</span>
              </div>
              <p className="text-[10px] text-zinc-500 truncate">{s.title || ""}{s.email ? ` · ${s.email}` : ""}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[9px] text-zinc-500 w-12">Strength</span>
                <div className="h-1 flex-1 rounded bg-zinc-800 overflow-hidden">
                  <div className="h-full bg-emerald-500" style={{ width: `${s.relationship_strength || 50}%` }} />
                </div>
                <span className="text-[9px] font-mono text-zinc-400 w-6 text-right">{s.relationship_strength || 50}</span>
              </div>
            </div>
            <Button variant="ghost" size="icon" className="h-6 w-6 text-zinc-500 hover:text-red-300" onClick={() => remove(s.id)}><Trash2 className="w-3 h-3" /></Button>
          </div>
        ))}
      </div>
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Stakeholder</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Input placeholder="Name *" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} data-testid="stakeholder-name-input" />
            <Input placeholder="Title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            <Input placeholder="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} className="w-full p-2 rounded bg-zinc-900 border border-zinc-800 text-xs">
              <option value="decision_maker">Decision Maker</option>
              <option value="champion">Champion</option>
              <option value="influencer">Influencer</option>
              <option value="blocker">Blocker</option>
              <option value="gatekeeper">Gatekeeper</option>
            </select>
            <div className="text-[10px] text-zinc-400">Relationship strength: {form.relationship_strength}</div>
            <input type="range" min="0" max="100" value={form.relationship_strength} onChange={e => setForm(f => ({ ...f, relationship_strength: Number(e.target.value) }))} className="w-full" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={add} className="bg-violet-600 hover:bg-violet-500" data-testid="stakeholder-add-confirm">Add</Button>
          </DialogFooter>
        </DialogContent>
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
          return (
            <button key={a.id} onClick={() => onOpen && onOpen(a.id)} className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded hover:bg-violet-500/10 text-[11px]" data-testid={`my-account-${a.id}`}>
              <span>{m.icon}</span>
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
