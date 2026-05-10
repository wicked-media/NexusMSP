import { useState, useEffect, useCallback, useMemo } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import HeroTile from "@/components/HeroTile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import {
  Sparkles, Search, Loader2, Users, Shield, AlertTriangle, Zap, Activity,
  Crown, Lock, Unlock, History, Clock, Target, ChevronRight, RefreshCw,
  TrendingUp, ArrowUpRight, ArrowDownRight, ShieldAlert, Flame, UserPlus,
  Network, Calendar, Trophy, BarChart3,
} from "lucide-react";

// Lazy-load embedded pages so they only initialise when their tab is opened
import { lazy, Suspense } from "react";
const TechniciansPage = lazy(() => import("@/pages/TechniciansPage"));
const TechRosterPage = lazy(() => import("@/pages/TechRosterPage"));
const SkillsMatrixPage = lazy(() => import("@/pages/SkillsMatrixPage"));
const TechUtilizationPage = lazy(() => import("@/pages/TechUtilizationPage"));
const LeaderboardPage = lazy(() => import("@/pages/LeaderboardPage"));

function LazyPanel({ children }) {
  return (
    <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-zinc-500" /></div>}>
      {children}
    </Suspense>
  );
}

// ---------- Skill radar (CSS-only, 8 axes) -----------------------------------
const SKILL_AXES = ["networking", "cloud", "security", "endpoints", "backup", "m365", "voip", "hardware"];

function SkillRadar({ skills, size = 120, color = "#a78bfa" }) {
  const cx = size / 2, cy = size / 2;
  const radius = size / 2 - 14;
  const n = SKILL_AXES.length;
  const points = SKILL_AXES.map((axis, i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const v = (skills?.[axis] || 0) / 100;
    return [cx + Math.cos(angle) * radius * v, cy + Math.sin(angle) * radius * v];
  });
  const poly = points.map(p => p.join(",")).join(" ");
  // Concentric grid
  const grid = [0.25, 0.5, 0.75, 1].map(scale => {
    const gridPts = SKILL_AXES.map((_, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      return [cx + Math.cos(angle) * radius * scale, cy + Math.sin(angle) * radius * scale];
    });
    return gridPts.map(p => p.join(",")).join(" ");
  });
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block">
      {grid.map((g, i) => (
        <polygon key={`g-${i}`} points={g} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={0.5} />
      ))}
      {SKILL_AXES.map((_, i) => {
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius;
        return <line key={`a-${i}`} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth={0.5} />;
      })}
      <polygon points={poly} fill={color} fillOpacity={0.25} stroke={color} strokeWidth={1.4} strokeLinejoin="round" />
      {points.map((p, i) => (<circle key={`p-${i}`} cx={p[0]} cy={p[1]} r={2} fill={color} />))}
    </svg>
  );
}

const STATE_COLORS = {
  idle:       "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
  active:     "text-cyan-300 border-cyan-500/30 bg-cyan-500/10",
  busy:       "text-amber-300 border-amber-500/30 bg-amber-500/10",
  overloaded: "text-rose-300 border-rose-500/30 bg-rose-500/10",
};

// ---------- Smart Tech Finder Tab --------------------------------------------
function TechFinderTab({ headers, capacity }) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [intent, setIntent] = useState(null);
  const initial = capacity?.techs?.slice(0, 6) || [];

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!query.trim()) { setResults([]); setIntent(null); return; }
    setLoading(true);
    try {
      const r = await axios.post(`${API}/tech-intel/find`, { query }, { headers });
      setResults(r.data.results || []);
      setIntent(r.data.intent || null);
    } catch (err) {
      toast.error("Search failed");
    } finally { setLoading(false); }
  };

  const display = results.length ? results : initial;

  return (
    <div className="space-y-4" data-testid="tech-finder-tab">
      <form onSubmit={submit} className="relative">
        <Sparkles className="w-4 h-4 absolute left-3 top-3 text-violet-400" />
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder='Try: "L2 with VMware experience available now" or "Senior network engineer for Auckland site"'
          className="pl-10 pr-24 h-11 bg-zinc-950 border-violet-500/30 focus-visible:border-violet-400"
          data-testid="tech-finder-input"
        />
        <Button
          type="submit"
          size="sm"
          className="absolute right-1.5 top-1.5 h-8"
          variant="outline"
          data-testid="tech-finder-submit"
          disabled={loading}
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3 mr-1" />}
          {loading ? "" : "Find"}
        </Button>
      </form>

      {intent && (
        <div className="text-[10px] font-mono text-zinc-500 flex flex-wrap gap-1.5" data-testid="tech-finder-intent">
          <span className="text-zinc-400 uppercase tracking-widest">parsed intent:</span>
          {(intent.skills || []).map(s => <Badge key={s} variant="outline" className="text-[10px] text-violet-300 border-violet-500/40">{s}</Badge>)}
          {intent.level && <Badge variant="outline" className="text-[10px] text-cyan-300 border-cyan-500/40">{intent.level}</Badge>}
          {intent.needs_available && <Badge variant="outline" className="text-[10px] text-emerald-300 border-emerald-500/40">available now</Badge>}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {display.map(t => (
          <TechResultCard key={t.id} tech={t} />
        ))}
        {display.length === 0 && (
          <p className="text-sm text-zinc-500 col-span-full text-center py-12">No technicians match. Try simpler keywords.</p>
        )}
      </div>
    </div>
  );
}

function TechResultCard({ tech }) {
  const wl = tech.workload || {};
  const stateClass = STATE_COLORS[wl.state] || STATE_COLORS.active;
  return (
    <Card className="bg-zinc-950/60 border-zinc-800 hover:border-violet-500/40 transition-colors" data-testid={`tech-card-${tech.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="relative shrink-0">
            <div className="w-12 h-12 rounded-md bg-gradient-to-br from-violet-500 via-fuchsia-500 to-pink-500 flex items-center justify-center text-white font-bold">
              {(tech.name || "?").slice(0, 2).toUpperCase()}
            </div>
            {tech.on_call_status && (
              <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-zinc-950 animate-pulse" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-zinc-100 truncate">{tech.name}</span>
              {tech.is_admin && <Crown className="w-3 h-3 text-amber-400" />}
            </div>
            <div className="text-[11px] text-zinc-500 font-mono">{tech.job_title}</div>
            <div className="flex flex-wrap gap-1 mt-1">
              <Badge variant="outline" className={`text-[9px] uppercase ${stateClass}`} data-testid={`tech-state-${tech.id}`}>
                {wl.state || "—"} · {wl.utilization_pct ?? 0}%
              </Badge>
              {tech.match_score != null && (
                <Badge variant="outline" className="text-[9px] uppercase text-violet-300 border-violet-500/40">
                  match {tech.match_score}
                </Badge>
              )}
            </div>
          </div>
          <SkillRadar skills={tech.skills} size={84} />
        </div>
        <div className="mt-3 pt-3 border-t border-zinc-900 grid grid-cols-3 gap-2 text-center">
          <div><div className="text-base font-bold text-cyan-300 font-mono">{wl.open_tickets ?? 0}</div><div className="text-[9px] uppercase tracking-widest text-zinc-500">open</div></div>
          <div><div className={`text-base font-bold font-mono ${wl.overdue ? "text-rose-300" : "text-zinc-400"}`}>{wl.overdue ?? 0}</div><div className="text-[9px] uppercase tracking-widest text-zinc-500">overdue</div></div>
          <div><div className="text-base font-bold text-emerald-300 font-mono">{tech.on_call_status ? "ON" : "—"}</div><div className="text-[9px] uppercase tracking-widest text-zinc-500">on-call</div></div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- Capacity Cockpit Tab --------------------------------------------
function CapacityCockpitTab({ capacity }) {
  if (!capacity) return null;
  return (
    <div className="space-y-4" data-testid="capacity-cockpit-tab">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <HeroTile label="Total Techs" value={capacity.summary.total} icon={Users} glow="violet" />
        <HeroTile label="Idle" value={capacity.summary.idle || 0} icon={Activity} glow="emerald" />
        <HeroTile label="Active" value={capacity.summary.active || 0} icon={Activity} glow="cyan" />
        <HeroTile label="Busy" value={capacity.summary.busy || 0} icon={Flame} glow="amber" />
        <HeroTile label="Overloaded" value={capacity.summary.overloaded || 0} icon={AlertTriangle} glow={capacity.summary.overloaded ? "rose" : "zinc"} />
        <HeroTile label="Avg Utilisation" value={`${capacity.summary.avg_util}%`} icon={TrendingUp} glow="violet" animated={false} />
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Activity className="w-4 h-4" />Live Workload</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            {capacity.techs.map(t => {
              const w = t.workload || {};
              const fillColor =
                w.state === "overloaded" ? "from-rose-500 to-red-500" :
                w.state === "busy" ? "from-amber-500 to-orange-500" :
                w.state === "active" ? "from-cyan-500 to-blue-500" :
                "from-emerald-500 to-green-500";
              return (
                <div key={t.id} className="flex items-center gap-3 px-2 py-2 rounded-md hover:bg-zinc-900/50" data-testid={`capacity-row-${t.id}`}>
                  <div className="w-28 truncate">
                    <div className="text-xs font-medium truncate">{t.name}</div>
                    <div className="text-[10px] text-zinc-500 font-mono">{t.job_title}</div>
                  </div>
                  <div className="flex-1 h-2.5 rounded-full bg-zinc-900 overflow-hidden">
                    <div className={`h-full bg-gradient-to-r ${fillColor} transition-all`} style={{ width: `${Math.min(100, w.utilization_pct || 0)}%` }} />
                  </div>
                  <div className="w-12 text-right text-xs font-mono text-zinc-300">{w.utilization_pct ?? 0}%</div>
                  <div className="w-20 text-right">
                    <Badge variant="outline" className={`text-[9px] uppercase ${STATE_COLORS[w.state]}`}>{w.state}</Badge>
                  </div>
                  <div className="w-24 text-right text-[10px] font-mono text-zinc-500">{w.open_tickets ?? 0} open · {w.overdue ?? 0} late</div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- Permission Matrix Tab --------------------------------------------
const PERM_COLORS = {
  none:  "bg-zinc-900 text-zinc-700",
  read:  "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30",
  write: "bg-violet-500/20 text-violet-300 border border-violet-500/40",
  admin: "bg-rose-500/20 text-rose-300 border border-rose-500/40",
};
const PERM_INITIAL = { none: "·", read: "R", write: "W", admin: "A" };

function PermissionMatrixTab({ headers, presets }) {
  const [matrix, setMatrix] = useState(null);
  const [loading, setLoading] = useState(true);
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffData, setDiffData] = useState(null);
  const [selectedTech, setSelectedTech] = useState(null);
  const [selectedPreset, setSelectedPreset] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/tech-intel/permission-matrix`, { headers });
      setMatrix(r.data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  const openDiff = async (techId, presetName) => {
    try {
      const r = await axios.post(`${API}/tech-intel/permission-diff`, {
        tech_id: techId, target_preset: presetName,
      }, { headers });
      setDiffData(r.data);
      setDiffOpen(true);
    } catch { toast.error("Diff failed"); }
  };

  const applyDiff = async () => {
    if (!diffData) return;
    try {
      const target = presets[diffData.target_preset];
      await axios.put(`${API}/technicians/${diffData.tech.id}/permissions`, {
        permissions: target, job_title: diffData.target_preset,
      }, { headers });
      toast.success(`Promoted ${diffData.tech.name} → ${diffData.target_preset}`);
      setDiffOpen(false); setDiffData(null);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Apply failed"); }
  };

  if (loading || !matrix) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-zinc-500" /></div>;

  return (
    <div className="space-y-4" data-testid="permission-matrix-tab">
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2"><Shield className="w-4 h-4" />Permission Heatmap</CardTitle>
          <div className="flex items-center gap-3 text-[10px] font-mono">
            {Object.entries(PERM_COLORS).map(([k]) => (
              <span key={k} className="flex items-center gap-1">
                <span className={`w-3 h-3 rounded ${PERM_COLORS[k]}`} />
                {k}
              </span>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr>
                  <th className="text-left px-2 py-2 sticky left-0 bg-zinc-950 z-10 min-w-[160px]">Technician</th>
                  {matrix.modules.map(m => (
                    <th key={m} className="px-1 py-2 text-[9px] uppercase tracking-widest text-zinc-500 font-mono whitespace-nowrap" style={{ writingMode: "vertical-rl", textOrientation: "mixed", height: "100px" }}>{m.replace(/_/g, " ")}</th>
                  ))}
                  <th className="px-2 py-2 text-[9px] uppercase tracking-widest text-zinc-500 font-mono">Promote to</th>
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map(row => (
                  <tr key={row.tech_id} className="border-t border-zinc-900 hover:bg-zinc-900/40" data-testid={`perm-row-${row.tech_id}`}>
                    <td className="px-2 py-1.5 sticky left-0 bg-zinc-950 z-10">
                      <div className="flex items-center gap-1.5">
                        {row.is_admin && <Crown className="w-3 h-3 text-amber-400 shrink-0" />}
                        <span className="font-medium truncate">{row.name}</span>
                      </div>
                      <div className="text-[10px] text-zinc-500 font-mono">{row.job_title}</div>
                    </td>
                    {matrix.modules.map(m => (
                      <td key={m} className="px-0.5 py-0.5 text-center">
                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded text-[9px] font-bold font-mono ${PERM_COLORS[row.cells[m]] || PERM_COLORS.none}`}>
                          {PERM_INITIAL[row.cells[m]] || "·"}
                        </span>
                      </td>
                    ))}
                    <td className="px-2 py-1.5">
                      <Select value="" onValueChange={(v) => v && openDiff(row.tech_id, v)}>
                        <SelectTrigger className="h-7 text-[10px] w-[140px]" data-testid={`promote-${row.tech_id}`}>
                          <SelectValue placeholder="Preview…" />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.keys(presets || {}).map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Diff dialog */}
      <Dialog open={diffOpen} onOpenChange={setDiffOpen}>
        <DialogContent className="max-w-2xl" data-testid="permission-diff-dialog">
          <DialogHeader>
            <DialogTitle>Permission Diff Preview</DialogTitle>
            <DialogDescription>{diffData ? `Promote ${diffData.tech.name} → ${diffData.target_preset}` : ""}</DialogDescription>
          </DialogHeader>
          {diffData && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-emerald-300 font-bold mb-2 flex items-center gap-1"><ArrowUpRight className="w-3 h-3" />{diffData.grants.length} New Permissions</div>
                <ScrollArea className="h-[260px] pr-2">
                  <div className="space-y-1">
                    {diffData.grants.length === 0 && <p className="text-xs text-zinc-500">No new grants.</p>}
                    {diffData.grants.map((g, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded border border-emerald-500/20 bg-emerald-500/5">
                        <span className="font-mono text-emerald-300">+ {g.module}</span>
                        <span className="text-zinc-400 ml-auto uppercase tracking-widest text-[9px]">{g.action}</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-rose-300 font-bold mb-2 flex items-center gap-1"><ArrowDownRight className="w-3 h-3" />{diffData.revokes.length} Permissions Removed</div>
                <ScrollArea className="h-[260px] pr-2">
                  <div className="space-y-1">
                    {diffData.revokes.length === 0 && <p className="text-xs text-zinc-500">No revokes.</p>}
                    {diffData.revokes.map((g, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded border border-rose-500/20 bg-rose-500/5">
                        <span className="font-mono text-rose-300">− {g.module}</span>
                        <span className="text-zinc-400 ml-auto uppercase tracking-widest text-[9px]">{g.action}</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDiffOpen(false)}>Cancel</Button>
            <Button onClick={applyDiff} variant="outline" className="text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/10" data-testid="apply-diff-btn">Apply Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- Role Drift Tab ----------------------------------------------------
function RoleDriftTab({ headers }) {
  const [drift, setDrift] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/tech-intel/role-drift`, { headers });
      setDrift(r.data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [headers]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-zinc-500" /></div>;

  return (
    <div className="space-y-3" data-testid="role-drift-tab">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500">AI analysis of last 30 days. Compares actual ticket workload against assigned role.</p>
        <Button size="sm" variant="ghost" onClick={load} className="h-7 text-[10px]" data-testid="drift-refresh"><RefreshCw className="w-3 h-3 mr-1" />Re-analyse</Button>
      </div>
      {(drift?.drift || []).length === 0 ? (
        <Card className="border-emerald-500/20 bg-emerald-500/5">
          <CardContent className="p-6 text-center">
            <Shield className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
            <p className="text-sm text-emerald-300">All technicians correctly aligned with their role permissions.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {drift.drift.map(d => (
            <Card key={d.tech_id} className={d.flag === "upgrade" ? "border-amber-500/30 bg-amber-500/5" : "border-zinc-700 bg-zinc-900/40"} data-testid={`drift-card-${d.tech_id}`}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className={`w-10 h-10 rounded-md flex items-center justify-center shrink-0 ${d.flag === "upgrade" ? "bg-amber-500/20" : "bg-zinc-800"}`}>
                  {d.flag === "upgrade" ? <TrendingUp className="w-5 h-5 text-amber-400" /> : <ArrowDownRight className="w-5 h-5 text-zinc-400" />}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{d.name}</span>
                    <Badge variant="outline" className="text-[10px] text-zinc-400">{d.current_title}</Badge>
                    <Badge variant="outline" className={`text-[10px] uppercase ${d.flag === "upgrade" ? "text-amber-300 border-amber-500/40" : "text-zinc-300 border-zinc-500/40"}`}>{d.flag}</Badge>
                  </div>
                  <p className="text-xs text-zinc-400 mt-1">{d.rationale}</p>
                </div>
                <div className="text-right text-[10px] font-mono text-zinc-500">
                  <div>{d.crit_30d} critical · {d.total_30d} total</div>
                  <div>last 30 days</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- JIT Elevation Tab -------------------------------------------------
function JITElevationTab({ headers, capacity, presets, onAfterChange }) {
  const [active, setActive] = useState([]);
  const [loading, setLoading] = useState(true);
  const [grantOpen, setGrantOpen] = useState(false);
  const [breakGlassOpen, setBreakGlassOpen] = useState(false);
  const [grantForm, setGrantForm] = useState({ tech_id: "", preset: "Senior Engineer", duration_minutes: 240, reason: "" });
  const [bgForm, setBgForm] = useState({ duration_minutes: 15, reason: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/permission-elevation/active`, { headers });
      setActive(r.data.active || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [headers]);
  useEffect(() => { load(); const i = setInterval(load, 30000); return () => clearInterval(i); }, [load]);

  const grant = async () => {
    if (!grantForm.tech_id || !grantForm.reason) { toast.error("Tech and reason required"); return; }
    try {
      await axios.post(`${API}/permission-elevation/grant`, grantForm, { headers });
      toast.success("Elevation granted");
      setGrantOpen(false);
      setGrantForm({ tech_id: "", preset: "Senior Engineer", duration_minutes: 240, reason: "" });
      load(); onAfterChange?.();
    } catch (e) { toast.error(e.response?.data?.detail || "Grant failed"); }
  };

  const revoke = async (id) => {
    try {
      await axios.delete(`${API}/permission-elevation/${id}`, { headers });
      toast.success("Elevation revoked");
      load(); onAfterChange?.();
    } catch { toast.error("Revoke failed"); }
  };

  const breakGlass = async () => {
    if (!bgForm.reason || bgForm.reason.length < 10) { toast.error("Detailed reason required (10+ chars)"); return; }
    try {
      await axios.post(`${API}/permission-elevation/break-glass`, bgForm, { headers });
      toast.success("BREAK GLASS active");
      setBreakGlassOpen(false);
      setBgForm({ duration_minutes: 15, reason: "" });
      load(); onAfterChange?.();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  return (
    <div className="space-y-4" data-testid="jit-elevation-tab">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-zinc-500">Grant elevated permissions for a fixed window. Auto-reverts on expiry. Every action audited.</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="h-8 text-xs text-violet-300 border-violet-500/40 hover:bg-violet-500/10" onClick={() => setGrantOpen(true)} data-testid="jit-grant-btn">
            <Unlock className="w-3 h-3 mr-1" />Grant Elevation
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs text-rose-300 border-rose-500/40 hover:bg-rose-500/10" onClick={() => setBreakGlassOpen(true)} data-testid="jit-bg-btn">
            <ShieldAlert className="w-3 h-3 mr-1" />Break Glass
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-zinc-500" /></div>
      ) : active.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-sm text-zinc-500">No active elevations.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {active.map(e => (
            <Card key={e.id} className={`${e.break_glass ? "border-rose-500/40 bg-rose-500/5" : "border-violet-500/30 bg-violet-500/5"}`} data-testid={`elev-${e.id}`}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`w-10 h-10 rounded-md flex items-center justify-center shrink-0 ${e.break_glass ? "bg-rose-500/20" : "bg-violet-500/20"}`}>
                  {e.break_glass ? <ShieldAlert className="w-5 h-5 text-rose-400" /> : <Unlock className="w-5 h-5 text-violet-400" />}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{e.tech_name}</span>
                    <Badge variant="outline" className={`text-[10px] ${e.break_glass ? "text-rose-300 border-rose-500/40" : "text-violet-300 border-violet-500/40"}`}>{e.preset}</Badge>
                    {e.break_glass && <Badge variant="outline" className="text-[10px] text-rose-300 border-rose-500/40 animate-pulse">BREAK GLASS</Badge>}
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">
                    granted by {e.granted_by_name} · expires in {e.expires_in_minutes}m · reason: {e.reason}
                  </div>
                </div>
                <Button size="sm" variant="ghost" className="text-rose-400 h-7 text-[10px]" onClick={() => revoke(e.id)} data-testid={`revoke-${e.id}`}><Lock className="w-3 h-3 mr-1" />Revoke now</Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Grant dialog */}
      <Dialog open={grantOpen} onOpenChange={setGrantOpen}>
        <DialogContent data-testid="jit-grant-dialog">
          <DialogHeader>
            <DialogTitle>Grant Just-in-Time Elevation</DialogTitle>
            <DialogDescription>Auto-reverts on expiry. Logged in audit trail.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={grantForm.tech_id} onValueChange={v => setGrantForm({ ...grantForm, tech_id: v })}>
              <SelectTrigger data-testid="jit-grant-tech"><SelectValue placeholder="Select technician" /></SelectTrigger>
              <SelectContent>
                {(capacity?.techs || []).map(t => <SelectItem key={t.id} value={t.id}>{t.name} · {t.job_title}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={grantForm.preset} onValueChange={v => setGrantForm({ ...grantForm, preset: v })}>
              <SelectTrigger data-testid="jit-grant-preset"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.keys(presets || {}).map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input
              type="number"
              min={5} max={1440}
              value={grantForm.duration_minutes}
              onChange={e => setGrantForm({ ...grantForm, duration_minutes: Number(e.target.value) })}
              placeholder="Duration (minutes)"
              data-testid="jit-grant-duration"
            />
            <Textarea
              value={grantForm.reason}
              onChange={e => setGrantForm({ ...grantForm, reason: e.target.value })}
              placeholder="Reason (required, audited)"
              data-testid="jit-grant-reason"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setGrantOpen(false)}>Cancel</Button>
            <Button onClick={grant} variant="outline" className="text-violet-300 border-violet-500/40 hover:bg-violet-500/10" data-testid="jit-grant-confirm"><Zap className="w-3 h-3 mr-1" />Grant</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Break-glass dialog */}
      <Dialog open={breakGlassOpen} onOpenChange={setBreakGlassOpen}>
        <DialogContent className="border-rose-500/40 bg-zinc-950" data-testid="jit-bg-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-300"><ShieldAlert className="w-5 h-5" />BREAK GLASS — Self Admin</DialogTitle>
            <DialogDescription>Grants you full admin for the chosen window. Heavily audited. Use only for true emergencies.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              type="number"
              min={5} max={60}
              value={bgForm.duration_minutes}
              onChange={e => setBgForm({ ...bgForm, duration_minutes: Number(e.target.value) })}
              placeholder="Duration (minutes, max 60)"
              data-testid="jit-bg-duration"
            />
            <Textarea
              value={bgForm.reason}
              onChange={e => setBgForm({ ...bgForm, reason: e.target.value })}
              placeholder="Detailed reason (required, audited, 10+ chars)"
              data-testid="jit-bg-reason"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBreakGlassOpen(false)}>Cancel</Button>
            <Button onClick={breakGlass} variant="outline" className="text-rose-300 border-rose-500/40 hover:bg-rose-500/10" data-testid="jit-bg-confirm"><ShieldAlert className="w-3 h-3 mr-1" />Activate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- Audit Timeline Tab ------------------------------------------------
function AuditTimelineTab({ headers }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/tech-intel/audit-timeline`, { headers });
      setEvents(r.data.events || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [headers]);
  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => {
    const out = {};
    for (const e of events) {
      const key = (e.timestamp || "").slice(0, 10) || "—";
      out[key] = out[key] || [];
      out[key].push(e);
    }
    return out;
  }, [events]);

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-zinc-500" /></div>;

  return (
    <div className="space-y-4" data-testid="audit-timeline-tab">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500">Permission/role/elevation events. Newest first.</p>
        <Button size="sm" variant="ghost" onClick={load} className="h-7 text-[10px]"><RefreshCw className="w-3 h-3 mr-1" />Refresh</Button>
      </div>
      {events.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-sm text-zinc-500">No audit events yet.</CardContent></Card>
      ) : (
        <div className="relative pl-8">
          <div className="absolute left-3 top-0 bottom-0 w-px bg-zinc-800" />
          {Object.entries(groups).map(([day, evs]) => (
            <div key={day} className="mb-6">
              <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-mono mb-2">{day}</div>
              {evs.map((e) => {
                const isBG = e.action === "break_glass_activated";
                const isGrant = e.action === "elevation_granted";
                const dotColor = isBG ? "bg-rose-400" : isGrant ? "bg-violet-400" : "bg-cyan-400";
                return (
                  <div key={e.id} className="relative mb-2 ml-2 group" data-testid={`audit-${e.id}`}>
                    <div className={`absolute -left-7 top-2 w-3 h-3 rounded-full ${dotColor} ring-4 ring-zinc-950`} />
                    <div className="px-3 py-2 rounded-md bg-zinc-900/40 border border-zinc-800 group-hover:border-zinc-600 transition-colors">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className={`text-[9px] uppercase ${isBG ? "text-rose-300 border-rose-500/40" : "text-cyan-300 border-cyan-500/40"}`}>{e.action.replace(/_/g, " ")}</Badge>
                        <span className="text-xs">{e.actor_name} → {e.target_name}</span>
                        <span className="text-[10px] text-zinc-500 font-mono ml-auto">{e.timestamp ? formatDistanceToNow(new Date(e.timestamp), { addSuffix: true }) : "—"}</span>
                      </div>
                      {e.detail && (
                        <div className="mt-1 text-[10px] text-zinc-500 font-mono">
                          {Object.entries(e.detail).filter(([k]) => !["elevation_id"].includes(k)).map(([k, v]) => (
                            <span key={k} className="mr-3">{k}: {String(v).slice(0, 80)}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Main page --------------------------------------------------------
export default function TechCommandCenter() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [tab, setTab] = useState("directory");
  const [capacity, setCapacity] = useState(null);
  const [presets, setPresets] = useState({});

  const loadCapacity = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/tech-intel/capacity`, { headers });
      setCapacity(r.data);
    } catch { /* ignore */ }
  }, [headers]);

  const loadPresets = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/technicians/permission-presets`, { headers });
      setPresets(r.data || {});
    } catch { /* ignore */ }
  }, [headers]);

  useEffect(() => { loadCapacity(); loadPresets(); }, [loadCapacity, loadPresets]);

  return (
    <div className="space-y-6 p-6" data-testid="tech-command-center">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-violet-400" />Team Command Center
          </h1>
          <p className="text-sm text-zinc-500">One place for everything: directory · invites · capacity · permissions · skills · utilisation · leaderboard · audit</p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/10"
            onClick={() => setTab("directory")}
            data-testid="tcc-invite-btn"
          >
            <UserPlus className="w-3 h-3 mr-1" />Invite / Add Tech
          </Button>
          <Button size="sm" variant="ghost" onClick={loadCapacity} className="h-8 text-xs" data-testid="tcc-refresh-btn"><RefreshCw className="w-3 h-3 mr-1" />Refresh</Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-transparent border-b border-zinc-800 rounded-none w-full justify-start gap-1 p-0 h-auto overflow-x-auto">
          {[
            { v: "directory",  l: "Directory",       Icon: Users },
            { v: "find",       l: "Smart Finder",    Icon: Sparkles },
            { v: "capacity",   l: "Capacity",        Icon: Activity },
            { v: "roster",     l: "On-Call",         Icon: Calendar },
            { v: "skills",     l: "Skills",          Icon: Network },
            { v: "utilization", l: "Utilisation",    Icon: BarChart3 },
            { v: "leaderboard", l: "Leaderboard",    Icon: Trophy },
            { v: "matrix",     l: "Permissions",     Icon: Shield },
            { v: "drift",      l: "Role Drift",      Icon: Target },
            { v: "jit",        l: "JIT",             Icon: Zap },
            { v: "audit",      l: "Audit",           Icon: History },
          ].map(t => (
            <TabsTrigger key={t.v} value={t.v}
              className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-violet-500 data-[state=active]:text-zinc-100 text-zinc-500 rounded-none py-2 px-3 text-xs uppercase tracking-wider whitespace-nowrap"
              data-testid={`tcc-tab-${t.v}`}>
              <t.Icon className="w-3 h-3 mr-1" />{t.l}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="directory" className="mt-4"><LazyPanel><TechniciansPage /></LazyPanel></TabsContent>
        <TabsContent value="find" className="mt-4"><TechFinderTab headers={headers} capacity={capacity} /></TabsContent>
        <TabsContent value="capacity" className="mt-4"><CapacityCockpitTab capacity={capacity} /></TabsContent>
        <TabsContent value="roster" className="mt-4"><LazyPanel><TechRosterPage /></LazyPanel></TabsContent>
        <TabsContent value="skills" className="mt-4"><LazyPanel><SkillsMatrixPage /></LazyPanel></TabsContent>
        <TabsContent value="utilization" className="mt-4"><LazyPanel><TechUtilizationPage /></LazyPanel></TabsContent>
        <TabsContent value="leaderboard" className="mt-4"><LazyPanel><LeaderboardPage /></LazyPanel></TabsContent>
        <TabsContent value="matrix" className="mt-4"><PermissionMatrixTab headers={headers} presets={presets} /></TabsContent>
        <TabsContent value="drift" className="mt-4"><RoleDriftTab headers={headers} /></TabsContent>
        <TabsContent value="jit" className="mt-4"><JITElevationTab headers={headers} capacity={capacity} presets={presets} onAfterChange={loadCapacity} /></TabsContent>
        <TabsContent value="audit" className="mt-4"><AuditTimelineTab headers={headers} /></TabsContent>
      </Tabs>
    </div>
  );
}
