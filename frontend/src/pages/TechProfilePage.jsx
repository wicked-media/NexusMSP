import { useEffect, useState, useMemo } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { PageShell } from "@/components/design-system";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2, Trophy, Target, Brain, Save } from "lucide-react";
import { PresenceDot } from "@/components/presence/PresenceDot";
import { toast } from "sonner";

export default function TechProfilePage() {
  const { id } = useParams();
  const { token, user } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [profile, setProfile] = useState(null);
  const [achievements, setAchievements] = useState(null);
  const [quests, setQuests] = useState(null);
  const [presence, setPresence] = useState(null);
  const [bucket, setBucket] = useState("");
  const [bucketLoading, setBucketLoading] = useState(false);
  const techId = id || user?.id;

  useEffect(() => {
    if (!techId || !token) return;
    let alive = true;
    Promise.all([
      axios.get(`${API}/team/${techId}/profile`, { headers }).then(r => r.data).catch(() => null),
      axios.get(`${API}/team/${techId}/achievements`, { headers }).then(r => r.data).catch(() => null),
      axios.get(`${API}/team/${techId}/daily-quests`, { headers }).then(r => r.data).catch(() => null),
      axios.get(`${API}/presence`, { headers }).then(r => r.data?.users || []).catch(() => []),
    ]).then(([p, a, q, pr]) => {
      if (!alive) return;
      setProfile(p); setAchievements(a); setQuests(q);
      setPresence((pr || []).find(x => x.user_id === techId));
    });
    if (techId === user?.id) {
      axios.get(`${API}/team/${techId}/brain-bucket`, { headers })
        .then(r => setBucket(r.data?.notes || "")).catch(() => {});
    }
    return () => { alive = false; };
  }, [techId, token, headers, user?.id]);

  const saveBucket = async () => {
    setBucketLoading(true);
    try {
      await axios.post(`${API}/team/${techId}/brain-bucket`, { notes: bucket }, { headers });
      toast.success("Brain bucket saved");
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setBucketLoading(false); }
  };

  if (!profile) return <PageShell><div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-violet-400" /></div></PageShell>;

  const xpPct = Math.round((profile.total_xp % 500) / 5);

  return (
    <PageShell>
      <div className="space-y-4" data-testid="tech-profile-page">
        <div className="rounded-xl border border-violet-500/30 bg-gradient-to-br from-violet-900/20 to-slate-900 p-6 flex items-center gap-5">
          <div className="w-20 h-20 rounded-full bg-violet-500/20 border-2 border-violet-500/50 flex items-center justify-center text-3xl font-bold relative">
            {profile.name?.charAt(0) || "?"}
            <span className="absolute -bottom-1 -right-1"><PresenceDot led={presence?.led || "offline"} size={14} /></span>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">{profile.name}</h1>
              <Badge variant="outline" className="text-violet-400 border-violet-500/40 bg-violet-500/10"><Trophy className="w-3 h-3 mr-1" />Level {profile.level}</Badge>
              <Badge variant="outline" className="text-amber-400 border-amber-500/40">{achievements?.total_unlocked || 0}/{achievements?.total_available || 0} 🏆</Badge>
            </div>
            <div className="text-xs text-muted-foreground mt-1">{profile.email}</div>
            <div className="mt-3 flex items-center gap-3 text-xs">
              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-violet-500 to-emerald-500 transition-all" style={{ width: `${xpPct}%` }} />
              </div>
              <span className="font-mono">{profile.total_xp.toLocaleString()} XP</span>
              <span className="text-muted-foreground">{profile.next_level_in} to next</span>
            </div>
          </div>
        </div>

        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview" data-testid="profile-tab-overview">Overview</TabsTrigger>
            <TabsTrigger value="achievements" data-testid="profile-tab-achievements">Achievements</TabsTrigger>
            <TabsTrigger value="quests" data-testid="profile-tab-quests">Daily Quests</TabsTrigger>
            {techId === user?.id && <TabsTrigger value="bucket" data-testid="profile-tab-bucket">Brain Bucket</TabsTrigger>}
          </TabsList>

          <TabsContent value="overview" className="mt-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Card><CardContent className="p-4">
                <div className="text-[10px] uppercase text-emerald-400 tracking-widest">Closed</div>
                <div className="text-3xl font-mono font-bold mt-1">{profile.closed_tickets}</div>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <div className="text-[10px] uppercase text-amber-400 tracking-widest">Open</div>
                <div className="text-3xl font-mono font-bold mt-1">{profile.open_tickets}</div>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <div className="text-[10px] uppercase text-sky-400 tracking-widest">Avg resolve</div>
                <div className="text-3xl font-mono font-bold mt-1">{profile.avg_resolve_hours ?? "—"}<span className="text-sm">h</span></div>
              </CardContent></Card>
            </div>
            <Card className="mt-3">
              <CardHeader className="pb-2"><CardTitle className="text-sm">Skills radar</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {profile.skills_radar.length === 0 && <div className="text-sm text-muted-foreground text-center py-4">No skill XP yet — close some tickets!</div>}
                {profile.skills_radar.map(s => {
                  const max = profile.skills_radar[0]?.xp || 1;
                  return (
                    <div key={s.skill}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="capitalize font-medium">{s.skill}</span>
                        <span className="font-mono text-muted-foreground">{s.xp.toLocaleString()} XP</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-0.5">
                        <div className="h-full bg-gradient-to-r from-violet-500 to-emerald-500" style={{ width: `${(s.xp / max) * 100}%` }} />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="achievements" className="mt-4">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {[...(achievements?.earned || []), ...(achievements?.locked || [])].map(a => (
                <Card key={a.key} className={a.earned ? "border-amber-500/30 bg-amber-500/[0.05]" : "opacity-50"}>
                  <CardContent className="p-3 text-center">
                    <div className="text-3xl mb-1">{a.icon}</div>
                    <div className="text-xs font-bold">{a.title}</div>
                    <Badge variant="outline" className={`text-[9px] mt-1 ${a.rarity === "legendary" ? "text-amber-400 border-amber-500/40" : a.rarity === "epic" ? "text-violet-400 border-violet-500/40" : a.rarity === "rare" ? "text-sky-400 border-sky-500/40" : "text-muted-foreground"}`}>{a.rarity}</Badge>
                    <div className="text-[10px] text-muted-foreground mt-1">{a.description}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="quests" className="mt-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Target className="w-4 h-4 text-emerald-400" />Today's quests</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {(quests?.quests || []).map(q => {
                  const done = (quests?.completed_keys || []).includes(q.key);
                  return (
                    <div key={q.key} className={`border rounded p-2 flex items-center gap-3 ${done ? "border-emerald-500/40 bg-emerald-500/5 line-through opacity-70" : "border-border"}`}>
                      <div className="text-2xl">{q.icon}</div>
                      <div className="flex-1">
                        <div className="text-sm">{q.title}</div>
                        <div className="text-[10px] text-muted-foreground">+{q.xp} XP</div>
                      </div>
                      {done && <Badge variant="outline" className="text-emerald-400 border-emerald-500/40">Complete</Badge>}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </TabsContent>

          {techId === user?.id && (
            <TabsContent value="bucket" className="mt-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Brain className="w-4 h-4 text-violet-400" />Private brain bucket</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground mb-2">Only you can see this. Drop random fix notes, command snippets, ideas — AI can later mine it for runbook material if you choose to publish.</p>
                  <Textarea value={bucket} onChange={e => setBucket(e.target.value)} rows={14} className="font-mono text-xs" placeholder="Paste anything…" data-testid="brain-bucket-textarea" />
                  <Button onClick={saveBucket} disabled={bucketLoading} variant="outline" size="sm" className="mt-2 text-violet-400 border-violet-500/30" data-testid="brain-bucket-save">
                    {bucketLoading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />}Save
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      </div>
    </PageShell>
  );
}
