import { useState, useEffect } from "react";
import { useAuth } from "@/App";
import axios from "axios";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Trophy, Award, Crown, Star, Zap, Target, Shield, Gem, Rocket,
  Layers, Cake, Calendar, CreditCard, Monitor, Wifi, DollarSign,
  Medal, TrendingUp, Users, Flame, CheckCircle
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const API = process.env.REACT_APP_BACKEND_URL;

const ICON_MAP = { trophy: Trophy, target: Target, zap: Zap, award: Award, crown: Crown, gem: Gem, "dollar-sign": DollarSign, "credit-card": CreditCard, banknote: DollarSign, monitor: Monitor, wifi: Wifi, calendar: Calendar, shield: Shield, star: Star, cake: Cake, rocket: Rocket, layers: Layers };
function AchIcon({ icon, className = "w-5 h-5" }) {
  const Icon = ICON_MAP[icon] || Trophy;
  return <Icon className={className} />;
}

export default function LeaderboardPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [leaderboard, setLeaderboard] = useState(null);
  const [achievements, setAchievements] = useState([]);
  const [techs, setTechs] = useState([]);
  const [techAchievements, setTechAchievements] = useState({});
  const [period, setPeriod] = useState("monthly");
  const [tab, setTab] = useState("rankings");

  useEffect(() => {
    fetchAll();
  }, [period]);

  const fetchAll = async () => {
    try {
      const [lbRes, achRes, techRes] = await Promise.all([
        axios.get(`${API}/api/technicians/leaderboard?period=${period}`, { headers }),
        axios.get(`${API}/api/achievements`, { headers }),
        axios.get(`${API}/api/technicians/overview`, { headers }),
      ]);
      setLeaderboard(lbRes.data);
      setAchievements(achRes.data);
      const techList = techRes.data || [];
      setTechs(techList);

      // Fetch achievements for each tech
      const achMap = {};
      await Promise.all(techList.map(async (t) => {
        try {
          const r = await axios.get(`${API}/api/technicians/${t.id}/achievements`, { headers });
          achMap[t.id] = r.data;
        } catch { achMap[t.id] = []; }
      }));
      setTechAchievements(achMap);
    } catch {}
  };

  // Calculate badge rankings
  const badgeRankings = techs
    .map(t => ({
      ...t,
      badges: (techAchievements[t.id] || []).length,
      earnedBadges: techAchievements[t.id] || [],
    }))
    .sort((a, b) => b.badges - a.badges);

  // Use leaderboard data - backend returns { leaderboard: [...] }
  const rankings = (leaderboard?.leaderboard || []).map(r => ({
    ...r, tech_id: r.id, tickets_closed: r.closed_this_month || 0, avg_resolution_hours: r.avg_resolution_hours || 0
  }));

  // Badge rarity - how many techs have each badge
  const badgeRarity = achievements.map(a => {
    const owners = techs.filter(t => (techAchievements[t.id] || []).some(e => e.achievement_id === a.id));
    return { ...a, ownerCount: owners.length, owners, rarity: owners.length === 0 ? "Legendary" : owners.length <= 1 ? "Epic" : owners.length <= 3 ? "Rare" : "Common" };
  });

  // Badge of the Month - most recently earned unique badge
  const allEarned = Object.values(techAchievements).flat().sort((a, b) => (b.awarded_at || "").localeCompare(a.awarded_at || ""));
  const badgeOfMonth = allEarned[0];
  const badgeOfMonthDef = badgeOfMonth ? achievements.find(a => a.id === badgeOfMonth.achievement_id) : null;

  // Top 3 podium
  const podium = rankings.slice(0, 3);

  const rarityColors = { Legendary: "text-amber-400 border-amber-400/30 bg-amber-500/10", Epic: "text-purple-400 border-purple-400/30 bg-purple-500/10", Rare: "text-blue-400 border-blue-400/30 bg-blue-500/10", Common: "text-zinc-400 border-zinc-400/30 bg-zinc-500/10" };

  return (
    <div className="space-y-6" data-testid="leaderboard-page">
      <div>
        <h1 className="text-4xl font-bold tracking-tight">Leaderboard</h1>
        <p className="text-muted-foreground mt-1">Company gamification wall - rankings, achievements & badge spotlight</p>
      </div>

      {/* Badge of the Month Spotlight */}
      {badgeOfMonth && badgeOfMonthDef && (
        <Card className="border-amber-500/30 bg-gradient-to-r from-amber-500/5 to-transparent" data-testid="badge-of-month">
          <CardContent className="py-5 flex items-center gap-6">
            <div className="w-20 h-20 rounded-2xl flex items-center justify-center shadow-lg" style={{ backgroundColor: (badgeOfMonthDef.color || "#f59e0b") + "20", color: badgeOfMonthDef.color, boxShadow: `0 0 30px ${badgeOfMonthDef.color}25` }}>
              <AchIcon icon={badgeOfMonthDef.icon} className="w-10 h-10" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest text-amber-500 font-semibold">Badge of the Month</p>
              <h2 className="text-2xl font-bold mt-1">{badgeOfMonthDef.name}</h2>
              <p className="text-sm text-muted-foreground">{badgeOfMonthDef.description}</p>
              <p className="text-xs text-muted-foreground mt-1">Earned by <strong className="text-foreground">{badgeOfMonth.user_name}</strong> {badgeOfMonth.awarded_at ? formatDistanceToNow(new Date(badgeOfMonth.awarded_at), { addSuffix: true }) : ""}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="rankings" data-testid="tab-rankings"><Trophy className="w-3.5 h-3.5 mr-1" />Ticket Rankings</TabsTrigger>
          <TabsTrigger value="badges" data-testid="tab-badges"><Award className="w-3.5 h-3.5 mr-1" />Badge Leaderboard</TabsTrigger>
          <TabsTrigger value="rarity" data-testid="tab-rarity"><Gem className="w-3.5 h-3.5 mr-1" />Badge Rarity</TabsTrigger>
          <TabsTrigger value="feed" data-testid="tab-feed"><Flame className="w-3.5 h-3.5 mr-1" />Activity Feed</TabsTrigger>
        </TabsList>

        {/* TICKET RANKINGS TAB */}
        <TabsContent value="rankings" className="space-y-4 mt-4">
          <div className="flex gap-2 mb-4">
            {["weekly", "monthly", "quarterly", "yearly"].map(p => (
              <Badge key={p} variant={period === p ? "default" : "outline"} className="cursor-pointer capitalize" onClick={() => setPeriod(p)} data-testid={`period-${p}`}>{p}</Badge>
            ))}
          </div>

          {/* Podium */}
          {podium.length >= 3 && (
            <div className="flex items-end justify-center gap-4 mb-8 h-56" data-testid="podium">
              {[podium[1], podium[0], podium[2]].map((r, i) => {
                const heights = ["h-32", "h-44", "h-24"];
                const medals = ["text-zinc-300", "text-amber-400", "text-amber-700"];
                const positions = [2, 1, 3];
                return (
                  <div key={r.tech_id} className="flex flex-col items-center gap-2">
                    <div className="relative">
                      {r.avatar ? (
                        <img src={r.avatar} alt={r.name} className={`w-14 h-14 rounded-full object-cover border-2 ${i === 1 ? "border-amber-400 shadow-lg shadow-amber-500/30" : "border-muted"}`} />
                      ) : (
                        <div className={`w-14 h-14 rounded-full bg-primary/20 flex items-center justify-center text-lg font-bold ${i === 1 ? "ring-2 ring-amber-400" : ""}`}>{r.name?.charAt(0)}</div>
                      )}
                      <div className={`absolute -top-2 -right-2 w-6 h-6 rounded-full bg-card border flex items-center justify-center text-xs font-bold ${medals[i]}`}>{positions[i]}</div>
                    </div>
                    <p className="text-sm font-medium text-center">{r.name}</p>
                    <div className={`${heights[i]} w-24 rounded-t-lg bg-gradient-to-t ${i === 1 ? "from-amber-500/20 to-amber-500/5 border-amber-500/30" : "from-muted/50 to-muted/20 border-muted/30"} border flex flex-col items-center justify-center`}>
                      <p className="text-2xl font-bold">{r.tickets_closed}</p>
                      <p className="text-[10px] text-muted-foreground">closed</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Full Rankings Table */}
          <Card>
            <CardContent className="p-0">
              <div className="space-y-1 p-2">
                {rankings.map((r, i) => (
                  <div key={r.tech_id} className={`flex items-center gap-4 p-3 rounded-lg transition-colors ${i === 0 ? "bg-amber-500/5 border border-amber-500/20" : "hover:bg-muted/30"}`} data-testid={`ranking-${i}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${i === 0 ? "bg-amber-500 text-black" : i === 1 ? "bg-zinc-300 text-black" : i === 2 ? "bg-amber-700 text-white" : "bg-muted text-muted-foreground"}`}>{i + 1}</div>
                    {r.avatar ? (
                      <img src={r.avatar} alt={r.name} className="w-10 h-10 rounded-full object-cover" />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center font-semibold">{r.name?.charAt(0)}</div>
                    )}
                    <div className="flex-1">
                      <p className="font-medium">{r.name}</p>
                      <p className="text-xs text-muted-foreground">{r.job_title || "Technician"}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold">{r.tickets_closed}</p>
                      <p className="text-[10px] text-muted-foreground">tickets closed</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-muted-foreground">{r.avg_resolution_hours?.toFixed(1) || "0"}h</p>
                      <p className="text-[10px] text-muted-foreground">avg resolve</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Trophy className="w-3.5 h-3.5 text-amber-500" />
                      <span className="text-sm">{(techAchievements[r.tech_id] || []).length}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* BADGE LEADERBOARD TAB */}
        <TabsContent value="badges" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 gap-3">
            {badgeRankings.map((t, i) => (
              <Card key={t.id} className={i === 0 ? "border-amber-500/30" : ""} data-testid={`badge-rank-${i}`}>
                <CardContent className="py-4 flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${i === 0 ? "bg-amber-500 text-black" : i === 1 ? "bg-zinc-300 text-black" : i === 2 ? "bg-amber-700 text-white" : "bg-muted text-muted-foreground"}`}>{i + 1}</div>
                  {t.avatar ? (
                    <img src={t.avatar} alt={t.name} className="w-12 h-12 rounded-full object-cover" />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-primary/15 flex items-center justify-center font-bold text-lg">{t.name?.charAt(0)}</div>
                  )}
                  <div className="flex-1">
                    <p className="font-semibold">{t.name}</p>
                    <p className="text-xs text-muted-foreground">{t.job_title || "Technician"} {t.badges > 0 ? `| ${t.badges} badge${t.badges > 1 ? "s" : ""}` : ""}</p>
                  </div>
                  <div className="flex gap-1.5 flex-wrap justify-end max-w-[400px]">
                    {t.earnedBadges.map(e => {
                      const def = achievements.find(a => a.id === e.achievement_id) || {};
                      return (
                        <div key={e.id} className="w-9 h-9 rounded-full flex items-center justify-center" style={{ backgroundColor: (def.color || "#8b5cf6") + "20", color: def.color }} title={e.achievement_name}>
                          <AchIcon icon={def.icon} className="w-4 h-4" />
                        </div>
                      );
                    })}
                    {t.badges === 0 && <span className="text-xs text-muted-foreground italic">No badges yet</span>}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* BADGE RARITY TAB */}
        <TabsContent value="rarity" className="space-y-4 mt-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {badgeRarity.sort((a, b) => a.ownerCount - b.ownerCount).map(badge => (
              <Card key={badge.id} className={`${rarityColors[badge.rarity]}`} data-testid={`rarity-${badge.id}`}>
                <CardContent className="py-4 flex flex-col items-center gap-2">
                  <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ backgroundColor: badge.color + "20", color: badge.color, boxShadow: `0 0 20px ${badge.color}15` }}>
                    <AchIcon icon={badge.icon} className="w-7 h-7" />
                  </div>
                  <p className="text-sm font-semibold text-center">{badge.name}</p>
                  <Badge variant="outline" className={`text-[10px] ${rarityColors[badge.rarity]}`}>{badge.rarity}</Badge>
                  <p className="text-xs text-muted-foreground text-center">{badge.description}</p>
                  <p className="text-[10px] text-muted-foreground">{badge.ownerCount}/{techs.length} technicians</p>
                  {badge.owners.length > 0 && (
                    <div className="flex -space-x-2 mt-1">
                      {badge.owners.slice(0, 5).map(o => (
                        o.avatar ? <img key={o.id} src={o.avatar} alt={o.name} className="w-6 h-6 rounded-full border-2 border-card object-cover" /> :
                        <div key={o.id} className="w-6 h-6 rounded-full bg-primary/20 border-2 border-card flex items-center justify-center text-[9px] font-bold">{o.name?.charAt(0)}</div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* ACTIVITY FEED TAB */}
        <TabsContent value="feed" className="space-y-3 mt-4">
          <h3 className="text-sm font-semibold flex items-center gap-2"><Flame className="w-4 h-4 text-orange-500" />Recent Achievements</h3>
          {allEarned.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">No achievements earned yet. Start closing tickets!</div>
          ) : (
            <div className="space-y-2">
              {allEarned.slice(0, 50).map((e, i) => {
                const def = achievements.find(a => a.id === e.achievement_id) || {};
                return (
                  <div key={e.id || i} className="flex items-center gap-4 p-3 rounded-lg border bg-card hover:bg-muted/20 transition-colors" data-testid={`feed-${i}`}>
                    <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: (def.color || "#8b5cf6") + "20", color: def.color }}>
                      <AchIcon icon={def.icon} className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm"><strong>{e.user_name}</strong> earned <strong style={{ color: def.color }}>{e.achievement_name}</strong></p>
                      <p className="text-xs text-muted-foreground">{def.description}{e.note && ` | ${e.note}`}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">{e.awarded_at ? formatDistanceToNow(new Date(e.awarded_at), { addSuffix: true }) : ""}</p>
                      <Badge variant="outline" className="text-[9px]">{e.awarded_by === "System" ? "Auto" : "Admin"}</Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
