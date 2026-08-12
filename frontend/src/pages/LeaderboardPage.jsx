import { useState, useEffect, useCallback, useMemo } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Trophy, Star, Flame, Zap, Shield, Heart, Moon, Wrench, CheckCircle,
  Timer, Target, TrendingUp, Crown, RefreshCw, Loader2, Award, Users
} from "lucide-react";

const BADGE_ICONS = { zap: Zap, timer: Timer, heart: Heart, flame: Flame, shield: Shield, moon: Moon, wrench: Wrench, "check-circle": CheckCircle };
const LEVEL_COLORS = ["#71717a", "#a855f7", "#3b82f6", "#06b6d4", "#f59e0b", "#ef4444", "#ec4899"];

function XpBar({ current, nextLevel }) {
  if (!nextLevel) return <div className="text-xs text-emerald-400 font-bold">MAX LEVEL</div>;
  const prevMin = nextLevel.min_xp - 500;
  const progress = ((current - prevMin) / (nextLevel.min_xp - prevMin)) * 100;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{current} XP</span><span>{nextLevel.min_xp} XP</span>
      </div>
      <Progress value={Math.min(100, Math.max(0, progress))} className="h-1.5" />
    </div>
  );
}

function ActivityHeatmap({ data }) {
  if (!data || Object.keys(data).length === 0) return <p className="text-xs text-muted-foreground">No activity data</p>;
  const sorted = Object.entries(data).sort((a, b) => a[0].localeCompare(b[0]));
  const last52 = sorted.slice(-364);
  const maxVal = Math.max(1, ...last52.map(([, v]) => v));
  return (
    <div className="flex flex-wrap gap-[2px]">
      {last52.map(([date, val]) => {
        const intensity = val / maxVal;
        const bg = val === 0 ? "bg-muted/30" : intensity > 0.75 ? "bg-emerald-500" : intensity > 0.5 ? "bg-emerald-400/70" : intensity > 0.25 ? "bg-emerald-400/40" : "bg-emerald-400/20";
        return <div key={date} className={`w-2.5 h-2.5 rounded-sm ${bg}`} title={`${date}: ${val} actions`} />;
      })}
    </div>
  );
}

export default function LeaderboardPage() {
  const { token } = useAuth();
  const [leaderboard, setLeaderboard] = useState([]);
  const [stats, setStats] = useState(null);
  const [selectedTech, setSelectedTech] = useState(null);
  const [profile, setProfile] = useState(null);
  const [heatmap, setHeatmap] = useState({});
  const [loading, setLoading] = useState(true);
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [lRes, sRes] = await Promise.all([
        axios.get(`${API}/gamification/leaderboard`, { headers }),
        axios.get(`${API}/gamification/stats`, { headers }),
      ]);
      setLeaderboard(lRes.data);
      setStats(sRes.data);
    } catch { toast.error("Failed to fetch leaderboard"); }
    finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const viewProfile = async (userId) => {
    try {
      const [pRes, hRes] = await Promise.all([
        axios.get(`${API}/gamification/profile/${userId}`, { headers }),
        axios.get(`${API}/gamification/activity/${userId}`, { headers }),
      ]);
      setProfile(pRes.data);
      setHeatmap(hRes.data);
      setSelectedTech(userId);
    } catch { toast.error("Failed to load profile"); }
  };

  const recalculate = async (userId) => {
    try {
      await axios.post(`${API}/gamification/recalculate/${userId}`, {}, { headers });
      toast.success("XP recalculated from ticket history");
      viewProfile(userId);
      fetchAll();
    } catch { toast.error("Failed"); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  // PROFILE VIEW
  if (selectedTech && profile) {
    const lvl = profile.level_info || {};
    return (
      <div className="space-y-5" data-testid="tech-profile">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => { setSelectedTech(null); setProfile(null); }} data-testid="back-leaderboard">Back</Button>
          <Trophy className="w-6 h-6 text-amber-400" />
          <div>
            <h1 className="text-2xl font-bold">{profile.user_name || "Technician"}</h1>
            <p className="text-sm text-muted-foreground">Level {lvl.level} &middot; {lvl.title}</p>
          </div>
          <Badge className="ml-auto text-lg px-4 py-1 bg-amber-500/20 text-amber-400 border-amber-500/30">{profile.total_xp || 0} XP</Badge>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="border-amber-500/20">
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Star className="w-4 h-4 text-amber-400" />Experience</CardTitle></CardHeader>
            <CardContent>
              <div className="text-center mb-4">
                <div className="text-4xl font-black" style={{ color: LEVEL_COLORS[lvl.level - 1] || "#fff" }}>{profile.total_xp || 0}</div>
                <p className="text-xs text-muted-foreground mt-1">Total XP</p>
              </div>
              <XpBar current={profile.total_xp || 0} nextLevel={lvl.next_level} />
              <Button size="sm" variant="outline" className="w-full mt-3" onClick={() => recalculate(selectedTech)} data-testid="recalculate-btn"><RefreshCw className="w-3 h-3 mr-1" />Recalculate from History</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Award className="w-4 h-4 text-purple-400" />Badges ({(profile.badges_earned || []).length}/{(profile.all_badges || []).length})</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2">
                {(profile.all_badges || []).map(b => {
                  const earned = (profile.badges_earned || []).some(e => e.id === b.id);
                  const Icon = BADGE_ICONS[b.icon] || Star;
                  return (
                    <div key={b.id} className={`p-2 rounded-lg border text-center transition-all ${earned ? "border-amber-500/40 bg-amber-500/5" : "border-border/30 opacity-40"}`}>
                      <Icon className="w-5 h-5 mx-auto mb-1" style={{ color: earned ? b.color : "#666" }} />
                      <p className="text-[10px] font-bold">{b.name}</p>
                      <p className="text-[9px] text-muted-foreground">{b.description}</p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Target className="w-4 h-4 text-emerald-400" />Activity Heatmap</CardTitle></CardHeader>
            <CardContent>
              <ActivityHeatmap data={heatmap} />
              <Separator className="my-3" />
              <div className="space-y-1">
                <p className="text-xs font-semibold">Recent XP</p>
                <ScrollArea className="h-32">
                  {(profile.xp_history || []).slice(-10).reverse().map((h, i) => (
                    <div key={`k-${i}`} className="flex items-center justify-between py-1 text-xs border-b border-border/20">
                      <span className="text-muted-foreground">{h.reason}</span>
                      <Badge className="bg-amber-500/20 text-amber-400 text-[10px]">+{h.xp} XP</Badge>
                    </div>
                  ))}
                </ScrollArea>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // LEADERBOARD VIEW
  return (
    <div className="space-y-5" data-testid="leaderboard-page">
      <section className="flex flex-col gap-4 overflow-hidden rounded-2xl border border-primary/20 bg-[radial-gradient(circle_at_86%_0%,hsl(var(--primary)/0.2),transparent_38%),linear-gradient(120deg,hsl(var(--card)),hsl(var(--background)))] p-5 shadow-[0_16px_42px_-30px_hsl(var(--primary)/0.7)] sm:flex-row sm:items-center sm:justify-between">
        <div><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary"><Trophy className="h-5 w-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Team contribution</p><h1 className="text-2xl font-bold tracking-tight">Recognition board</h1></div></div><p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">Celebrate service outcomes and sustained contribution. Recognition is earned from accountable work—not simply time spent in the platform.</p></div>
        <div className="flex flex-wrap items-center gap-2"><div className="rounded-xl border border-border/70 bg-background/60 px-3 py-2 text-center"><p className="text-lg font-bold text-primary">{stats?.total_techs || 0}</p><p className="text-[10px] text-muted-foreground">technicians</p></div><div className="rounded-xl border border-border/70 bg-background/60 px-3 py-2 text-center"><p className="text-lg font-bold">{stats?.total_xp_awarded?.toLocaleString() || 0}</p><p className="text-[10px] text-muted-foreground">recognition XP</p></div><Button variant="outline" size="sm" onClick={fetchAll}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Refresh</Button></div>
      </section>

      {/* Top 3 Podium */}
      {leaderboard.length >= 1 && (
        <div className="grid gap-3 sm:grid-cols-3">
          {[1, 0, 2].map((idx) => {
            const t = leaderboard[idx];
            if (!t) return <div key={`k-${idx}`} />;
            const pos = idx + 1;
            const colors = ["border-amber-500/40 bg-amber-500/5", "border-zinc-400/40 bg-zinc-400/5", "border-orange-500/40 bg-orange-500/5"];
            const crowns = [<Crown key="g" className="w-6 h-6 text-amber-400" />, <Crown key="s" className="w-5 h-5 text-zinc-400" />, <Crown key="b" className="w-5 h-5 text-orange-400" />];
            const lvl = t.level_info || {};
            return (
              <Card key={`k-${idx}`} className={`${colors[idx]} cursor-pointer hover:scale-[1.02] transition-transform`}
                onClick={() => viewProfile(t.user_id)} data-testid={`podium-${pos}`}>
                <CardContent className="pt-5 text-center">
                  <div className="flex justify-center mb-2">{crowns[idx]}</div>
                  <div className="text-3xl font-black">#{pos}</div>
                  <p className="font-bold text-lg mt-1">{t.user_name || "Unknown"}</p>
                  <p className="text-xs text-muted-foreground">Level {lvl.level} {lvl.title}</p>
                  <div className="text-2xl font-black text-amber-400 mt-2">{(t.total_xp || 0).toLocaleString()} XP</div>
                  <div className="flex justify-center gap-1 mt-2 flex-wrap">
                    {(t.badges_earned || []).slice(0, 4).map(b => {
                      const Icon = BADGE_ICONS[b.icon] || Star;
                      return <Icon key={b.id} className="w-4 h-4" style={{ color: b.color }} />;
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Full Rankings */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow><TableHead className="w-12">#</TableHead><TableHead>Technician</TableHead><TableHead>Level</TableHead><TableHead>Badges</TableHead><TableHead className="text-right">XP</TableHead><TableHead></TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {leaderboard.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-12">
                  <Users className="w-10 h-10 mx-auto text-muted-foreground mb-2 opacity-30" />
                  <p className="text-muted-foreground">No gamification data yet. Resolve tickets to earn XP!</p>
                </TableCell></TableRow>
              ) : leaderboard.map((t, i) => {
                const lvl = t.level_info || {};
                return (
                  <TableRow key={t.user_id} className="cursor-pointer hover:bg-muted/30" onClick={() => viewProfile(t.user_id)} data-testid={`rank-${i + 1}`}>
                    <TableCell className="font-mono font-bold">{i + 1}</TableCell>
                    <TableCell className="font-bold">{t.user_name || "Unknown"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" style={{ borderColor: LEVEL_COLORS[lvl.level - 1] || "#666", color: LEVEL_COLORS[lvl.level - 1] || "#666" }}>
                        Lv.{lvl.level} {lvl.title}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">{(t.badges_earned || []).map(b => { const Icon = BADGE_ICONS[b.icon] || Star; return <Icon key={b.id} className="w-3.5 h-3.5" style={{ color: b.color }} />; })}</div>
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold text-amber-400">{(t.total_xp || 0).toLocaleString()}</TableCell>
                    <TableCell><TrendingUp className="w-4 h-4 text-muted-foreground" /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
