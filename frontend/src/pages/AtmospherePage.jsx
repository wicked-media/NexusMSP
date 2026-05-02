import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { PageShell } from "@/components/design-system";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sparkles, Loader2, Flame, Cloud, Rocket, Skull, Heart, Wifi,
  Crown, Cake, Zap, Film, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

function useApi(token) {
  return useMemo(() => ({
    get: (p) => axios.get(`${API}${p}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.data),
    post: (p, b) => axios.post(`${API}${p}`, b || {}, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.data),
  }), [token]);
}

function useFetch(api, path, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const reload = () => {
    if (!path) { setLoading(false); return; }
    setLoading(true);
    api.get(path).then(setData).catch((e) => toast.error(e.response?.data?.detail || e.message)).finally(() => setLoading(false));
  };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [path, ...deps]);
  return { data, loading, reload };
}

function L({ label }) {
  return <div className="py-12 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />{label}</div>;
}

function Kicker({ icon: Icon, color = "violet", children }) {
  return (
    <div className={`text-[10px] uppercase tracking-widest text-${color}-400 mb-1 flex items-center gap-2`}>
      {Icon && <Icon className="w-3 h-3" />}{children}
    </div>
  );
}

export default function AtmospherePage() {
  const { token } = useAuth();
  const api = useApi(token);
  const [tab, setTab] = useState("ambient");

  return (
    <PageShell>
      <div className="space-y-4" data-testid="atmosphere-page">
        <div>
          <Kicker icon={Sparkles} color="violet">Atmosphere</Kicker>
          <h1 className="text-2xl font-semibold tracking-tight">Ambient signals & quirky tools</h1>
          <p className="text-sm text-muted-foreground">Friday reels · weather mode · threat dragon · graveyards · client trading cards.</p>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="ambient" data-testid="tab-ambient"><Cloud className="w-3 h-3 mr-1" />Ambient</TabsTrigger>
            <TabsTrigger value="reel" data-testid="tab-reel"><Film className="w-3 h-3 mr-1" />Friday Reel</TabsTrigger>
            <TabsTrigger value="dragon" data-testid="tab-dragon"><Flame className="w-3 h-3 mr-1" />Threat Dragon</TabsTrigger>
            <TabsTrigger value="launches" data-testid="tab-launches"><Rocket className="w-3 h-3 mr-1" />Launches</TabsTrigger>
            <TabsTrigger value="graveyard" data-testid="tab-graveyard"><Skull className="w-3 h-3 mr-1" />Graveyard</TabsTrigger>
            <TabsTrigger value="client" data-testid="tab-client"><Crown className="w-3 h-3 mr-1" />Client Cards</TabsTrigger>
          </TabsList>

          <TabsContent value="ambient"><AmbientView api={api} /></TabsContent>
          <TabsContent value="reel"><FridayReelView api={api} /></TabsContent>
          <TabsContent value="dragon"><DragonView api={api} /></TabsContent>
          <TabsContent value="launches"><LaunchesView api={api} /></TabsContent>
          <TabsContent value="graveyard"><GraveyardView api={api} /></TabsContent>
          <TabsContent value="client"><ClientCardsView api={api} /></TabsContent>
        </Tabs>
      </div>
    </PageShell>
  );
}

/* ───────────── Ambient Weather Mode ───────────── */
const MOOD_GRADIENT = {
  stormy: "from-rose-900 via-slate-900 to-rose-950",
  beach: "from-amber-200/20 via-sky-300/20 to-emerald-200/20",
  rainy_monday: "from-slate-700 via-slate-900 to-slate-950",
  sunny: "from-amber-200/20 via-sky-200/20 to-amber-100/20",
  neutral: "from-slate-800 via-slate-900 to-slate-950",
};

function AmbientView({ api }) {
  const { data, loading, reload } = useFetch(api, "/ambient/weather-mode");
  if (loading) return <L label="Reading the room…" />;
  const d = data || {};
  const gradient = MOOD_GRADIENT[d.mood] || MOOD_GRADIENT.neutral;
  return (
    <div className="space-y-3 mt-3">
      <Card className="overflow-hidden">
        <div className={`bg-gradient-to-br ${gradient} p-10`}>
          <div className="text-[10px] uppercase tracking-widest text-white/60">Mood signal</div>
          <h2 className="text-3xl font-semibold tracking-tight mt-1 capitalize" data-testid="ambient-mood">{(d.mood || "neutral").replace("_", " ")}</h2>
          <p className="text-sm text-white/70 mt-2 max-w-xl">{describeMood(d.mood)}</p>
        </div>
        <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Open critical" value={d.stats?.open_critical || 0} color="rose" />
          <Stat label="Open total" value={d.stats?.open_total || 0} color="amber" />
          <Stat label="Huntress alerts" value={d.stats?.huntress_open || 0} color="violet" />
          <Stat label="Hour" value={d.hour ?? "-"} color="sky" />
        </CardContent>
      </Card>
      <Button variant="outline" size="sm" onClick={reload} data-testid="ambient-reload"><RefreshCw className="w-3 h-3 mr-1" />Refresh</Button>
    </div>
  );
}

function describeMood(m) {
  const map = {
    stormy: "Critical fires lit. Triage mode — keep the cockpit busy.",
    beach: "Friday afternoon vibes. Quiet, sunny, well-earned wind-down.",
    rainy_monday: "Heavy backlog Monday. Coffee, prioritise, breathe.",
    sunny: "Bright and clear. Get ahead while it's quiet.",
    neutral: "Steady hum. Business as usual.",
  };
  return map[m] || "Steady hum.";
}

function Stat({ label, value, color = "violet" }) {
  return (
    <div className="border border-border/40 rounded p-3">
      <div className={`text-[10px] uppercase tracking-widest text-${color}-400`}>{label}</div>
      <div className="text-xl font-semibold mt-1">{value}</div>
    </div>
  );
}

/* ───────────── Friday Wrap-up Reel ───────────── */
function FridayReelView({ api }) {
  const { data, loading, reload } = useFetch(api, "/wrap-up/friday-reel");
  if (loading) return <L label="Rolling the projector…" />;
  const d = data || {};
  const scenes = (d.storyboard || "").split(/\n+/).map(s => s.trim()).filter(Boolean).slice(0, 5);
  return (
    <div className="space-y-3 mt-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">A 5-scene week-in-review for the team.</p>
        <Button variant="outline" size="sm" onClick={reload} data-testid="reel-reload"><RefreshCw className="w-3 h-3 mr-1" />Re-roll</Button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Closed" value={d.stats?.closed ?? "-"} color="emerald" />
        <Stat label="Critical wins" value={d.stats?.criticals ?? "-"} color="rose" />
        <Stat label="Drills" value={d.stats?.drills ?? "-"} color="sky" />
        <Stat label="Runbooks" value={d.stats?.runbooks ?? "-"} color="violet" />
      </div>
      {scenes.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2" data-testid="reel-scenes">
          {scenes.map((s, idx) => (
            <Card key={idx} className="bg-gradient-to-br from-violet-900/20 via-slate-900 to-rose-900/10">
              <CardContent className="p-3">
                <div className="text-[10px] uppercase tracking-widest text-violet-400">Scene {idx + 1}</div>
                <p className="text-sm mt-1 leading-relaxed">{s.replace(/^\d+[\.\)]\s*/, "")}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">Storyboard not generated — Claude key may be missing or quiet week.</CardContent></Card>
      )}
      {d.top_critical_wins?.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <Kicker color="rose">Top Critical Wins</Kicker>
            {d.top_critical_wins.map((t, i) => (
              <div key={i} className="text-sm border-l-2 border-rose-500/40 pl-2">
                <div className="font-medium">{t.title}</div>
                <div className="text-xs text-muted-foreground">{t.client_name} · {t.assignee_name || "team"} · {t.ticket_number}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ───────────── Threat Dragon ───────────── */
function DragonView({ api }) {
  const { data, loading, reload } = useFetch(api, "/security/threat-dragon");
  if (loading) return <L label="Waking the dragon…" />;
  const d = data || {};
  const size = d.size_pct || 30;
  return (
    <div className="space-y-3 mt-3">
      <Card>
        <CardContent className="p-8 text-center space-y-3">
          <div style={{ fontSize: `${Math.max(60, size * 1.5)}px`, lineHeight: 1 }} data-testid="dragon-emoji">{d.emoji || "🐉"}</div>
          <h2 className="text-2xl font-semibold tracking-tight">{d.label}</h2>
          <div className="flex items-center justify-center gap-2 text-xs">
            <Badge variant="outline">Open: {d.open_alerts ?? 0}</Badge>
            <Badge variant="outline" className="text-rose-400 border-rose-500/40">Critical: {d.critical_alerts ?? 0}</Badge>
            <Badge variant="outline">Size: {size}%</Badge>
          </div>
          <Button variant="outline" size="sm" onClick={reload} data-testid="dragon-reload"><RefreshCw className="w-3 h-3 mr-1" />Check again</Button>
        </CardContent>
      </Card>
    </div>
  );
}

/* ───────────── Recent Launches ───────────── */
function LaunchesView({ api }) {
  const { data, loading, reload } = useFetch(api, "/ambient/recent-launches");
  const fire = async () => {
    try {
      await api.post("/ambient/launch-event", { kind: "celebration", label: "Manual launch 🚀" });
      toast.success("🚀 Launch recorded!");
      reload();
    } catch (e) { toast.error(e.message); }
  };
  if (loading) return <L label="Counting rockets…" />;
  const rows = data || [];
  return (
    <div className="space-y-3 mt-3">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={fire} className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" data-testid="launch-fire-btn">
          <Rocket className="w-3 h-3 mr-1" />Fire a launch
        </Button>
        <p className="text-xs text-muted-foreground">Mark a celebratory moment — keeps morale visible.</p>
      </div>
      {rows.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">No launches yet — fire one!</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <Card key={r.id}><CardContent className="p-3 flex items-center gap-3">
              <Rocket className="w-4 h-4 text-emerald-400" />
              <div className="flex-1">
                <div className="text-sm font-medium">{r.label}</div>
                <div className="text-xs text-muted-foreground">{r.user_name} · {new Date(r.ts).toLocaleString()}</div>
              </div>
              <Badge variant="outline">{r.kind}</Badge>
            </CardContent></Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────────── Device Graveyard ───────────── */
function GraveyardView({ api }) {
  const { data, loading } = useFetch(api, "/device-graveyard");
  if (loading) return <L label="Polishing tombstones…" />;
  const tombs = data?.tombstones || [];
  return (
    <div className="space-y-3 mt-3">
      <p className="text-sm text-muted-foreground">{tombs.length} retired devices · each one served bravely.</p>
      {tombs.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">No decommissioned devices yet.</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {tombs.map((t) => (
            <Card key={t.id} className="bg-gradient-to-b from-slate-900 to-slate-950">
              <CardContent className="p-4 text-center space-y-2">
                <Skull className="w-6 h-6 mx-auto text-zinc-400" />
                <div className="text-sm font-semibold">{t.name}</div>
                <div className="text-xs text-muted-foreground">{t.client_name} · {t.device_type}</div>
                <div className="text-xs italic text-zinc-300">"{t.epitaph}"</div>
                {t.lifespan_days != null && <Badge variant="outline" className="text-[10px]">{t.lifespan_days} days</Badge>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────────── Client Cards (Trading / Mood / Pet / Birthdays / Family / Slow Internet) ───────────── */
function ClientCardsView({ api }) {
  const { data: clients } = useFetch(api, "/clients");
  const [clientId, setClientId] = useState("");

  useEffect(() => {
    const list = Array.isArray(clients) ? clients : (clients?.clients || []);
    if (!clientId && list[0]) setClientId(list[0].id);
  }, [clients, clientId]);

  const list = Array.isArray(clients) ? clients : (clients?.clients || []);

  return (
    <div className="space-y-3 mt-3">
      <div className="flex items-center gap-2 max-w-md">
        <Select value={clientId} onValueChange={setClientId}>
          <SelectTrigger data-testid="client-card-select"><SelectValue placeholder="Pick a client" /></SelectTrigger>
          <SelectContent className="max-h-72">
            {list.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {clientId && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <TradingCard api={api} clientId={clientId} />
          <MoodRing api={api} clientId={clientId} />
          <PasswordPet api={api} clientId={clientId} />
          <BirthdayRadar api={api} clientId={clientId} />
          <SlowInternet api={api} clientId={clientId} />
          <FamilyTree api={api} clientId={clientId} />
        </div>
      )}
    </div>
  );
}

function TradingCard({ api, clientId }) {
  const { data, loading } = useFetch(api, `/clients/${clientId}/trading-card`, [clientId]);
  if (loading) return <Card><CardContent className="p-4"><L label="…" /></CardContent></Card>;
  const d = data || {};
  const rarityColor = { legendary: "amber", epic: "violet", rare: "sky", common: "zinc" }[d.rarity] || "zinc";
  return (
    <Card className={`bg-gradient-to-br from-${rarityColor}-900/20 to-slate-950 border-${rarityColor}-500/30`}>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <Kicker icon={Crown} color={rarityColor}>Trading Card · {d.rarity}</Kicker>
          <Badge variant="outline" className={`text-${rarityColor}-400 border-${rarityColor}-500/40`}>{d.rarity}</Badge>
        </div>
        <h3 className="text-base font-semibold">{d.name}</h3>
        <p className="text-xs text-muted-foreground italic">"{d.tagline}"</p>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <Stat label="LTV" value={`$${Math.round(d.stats?.ltv_revenue || 0).toLocaleString()}`} color={rarityColor} />
          <Stat label="Closed" value={d.stats?.tickets_resolved} color={rarityColor} />
          <Stat label="Years" value={d.stats?.years_partnered} color={rarityColor} />
          <Stat label="Devices" value={d.stats?.devices} color={rarityColor} />
          <Stat label="Churn" value={`${d.stats?.churn_score ?? "-"}`} color={rarityColor} />
          <Stat label="Longest" value={`${d.stats?.longest_resolution_hrs ?? 0}h`} color={rarityColor} />
        </div>
      </CardContent>
    </Card>
  );
}

function MoodRing({ api, clientId }) {
  const { data, loading } = useFetch(api, `/clients/${clientId}/mood-ring`, [clientId]);
  if (loading) return <Card><CardContent className="p-4"><L label="…" /></CardContent></Card>;
  const d = data || {};
  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <Kicker icon={Heart} color={d.colour || "zinc"}>Mood Ring · 30-day</Kicker>
        <div className={`w-20 h-20 rounded-full mx-auto bg-${d.colour || "zinc"}-500/30 border-4 border-${d.colour || "zinc"}-500/60`} />
        <div className="text-center">
          <div className="text-base font-semibold capitalize">{d.label}</div>
          {d.score && <div className="text-xs text-muted-foreground">Avg score: {d.score} · {d.samples} samples</div>}
        </div>
      </CardContent>
    </Card>
  );
}

function PasswordPet({ api, clientId }) {
  const { data, loading } = useFetch(api, `/security/password-pet/${clientId}`, [clientId]);
  if (loading) return <Card><CardContent className="p-4"><L label="…" /></CardContent></Card>;
  const d = data || {};
  const c = d.health >= 80 ? "emerald" : d.health >= 50 ? "amber" : "rose";
  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <Kicker color={c}>Password Pet</Kicker>
        <div className="text-5xl text-center" data-testid="password-pet-emoji">{d.emoji}</div>
        <div className="text-center text-sm">Health: <span className={`text-${c}-400 font-semibold`}>{d.health}</span> · {d.state}</div>
        <div className="text-xs text-muted-foreground text-center">MFA {d.stats?.mfa_pct}% · {d.stats?.weak} weak · {d.stats?.breached} breached</div>
      </CardContent>
    </Card>
  );
}

function BirthdayRadar({ api, clientId }) {
  const { data, loading } = useFetch(api, `/clients/${clientId}/birthdays`, [clientId]);
  if (loading) return <Card><CardContent className="p-4"><L label="…" /></CardContent></Card>;
  const items = data?.upcoming || [];
  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <Kicker icon={Cake} color="rose">Birthday Radar</Kicker>
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">No birthdays in the next 60 days.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {items.slice(0, 5).map((b, i) => (
              <li key={i} className="flex justify-between">
                <span>{b.name}</span>
                <span className="text-xs text-muted-foreground">in {b.days_until}d</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function SlowInternet({ api, clientId }) {
  const [r, setR] = useState(null);
  const [loading, setLoading] = useState(false);
  const run = async () => {
    setLoading(true);
    try {
      const res = await api.post(`/network/slow-internet/${clientId}`);
      setR(res);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  };
  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <Kicker icon={Wifi} color="sky">Slow Internet Detective</Kicker>
        <Button size="sm" variant="outline" onClick={run} disabled={loading} className="text-sky-400 border-sky-500/30 hover:bg-sky-500/10" data-testid="slow-internet-run">
          {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Zap className="w-3 h-3 mr-1" />}Diagnose
        </Button>
        {r && (
          <>
            <div className="text-sm font-semibold">{r.verdict}</div>
            <div className="text-xs text-muted-foreground">Confidence: {Math.round((r.confidence || 0) * 100)}%</div>
            <div className="text-xs">Ping {r.metrics?.avg_ping_ms}ms · Jitter {r.metrics?.jitter_ms}ms · {r.metrics?.speed_down_mbps}Mbps</div>
            {r.reasons?.length > 0 && (
              <ul className="text-xs text-muted-foreground list-disc ml-4">
                {r.reasons.map((x, i) => <li key={i}>{x}</li>)}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function FamilyTree({ api, clientId }) {
  const { data, loading } = useFetch(api, `/device-family-tree/${clientId}`, [clientId]);
  if (loading) return <Card><CardContent className="p-4"><L label="…" /></CardContent></Card>;
  const fam = data?.families || [];
  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <Kicker color="emerald">Device Family Tree</Kicker>
        {fam.length === 0 ? (
          <p className="text-xs text-muted-foreground">No devices.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {fam.slice(0, 6).map((f, i) => (
              <li key={i} className="flex justify-between">
                <span className="truncate">{f.family}</span>
                <span className="text-muted-foreground">×{f.count}{f.avg_age_years ? ` · ${f.avg_age_years}y` : ""}{f.offline_count ? ` · ${f.offline_count} off` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
