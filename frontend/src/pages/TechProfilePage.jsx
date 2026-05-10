import { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { PageShell } from "@/components/design-system";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Trophy, Target, Brain, Save, Star, Clock, Award, X, Plus, Bell } from "lucide-react";
import { PresenceDot } from "@/components/presence/PresenceDot";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

export default function TechProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [profile, setProfile] = useState(null);
  const [achievements, setAchievements] = useState(null);
  const [quests, setQuests] = useState(null);
  const [presence, setPresence] = useState(null);
  const [bucket, setBucket] = useState("");
  const [bucketLoading, setBucketLoading] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [bioDraft, setBioDraft] = useState("");
  const [tzDraft, setTzDraft] = useState("");
  const [whDraft, setWhDraft] = useState("");
  const [onCallDraft, setOnCallDraft] = useState(false);
  const [specDraft, setSpecDraft] = useState([]);
  const [certDraft, setCertDraft] = useState([]);
  const [newSpec, setNewSpec] = useState("");
  const [newCert, setNewCert] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const techId = id || user?.id;
  const isMe = techId === user?.id;

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
      if (p) {
        setBioDraft(p.bio || "");
        setTzDraft(p.timezone || "");
        setWhDraft(p.working_hours || "");
        setOnCallDraft(!!p.on_call);
        setSpecDraft(p.specialties || []);
        setCertDraft(p.certifications || []);
      }
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

  const saveProfileExtras = async () => {
    setSavingProfile(true);
    try {
      await axios.put(`${API}/technicians/${techId}/profile`, {
        bio: bioDraft, timezone: tzDraft, working_hours: whDraft,
        on_call: onCallDraft, specialties: specDraft, certifications: certDraft,
      }, { headers });
      toast.success("Profile saved");
      setEditingProfile(false);
      setProfile(p => ({ ...p, bio: bioDraft, timezone: tzDraft, working_hours: whDraft, on_call: onCallDraft, specialties: specDraft, certifications: certDraft }));
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
    finally { setSavingProfile(false); }
  };
  const addSpec = () => { const s = newSpec.trim(); if (!s) return; if (!specDraft.includes(s)) setSpecDraft([...specDraft, s]); setNewSpec(""); };
  const addCert = () => { const s = newCert.trim(); if (!s) return; if (!certDraft.includes(s)) setCertDraft([...certDraft, s]); setNewCert(""); };

  if (!profile) return <PageShell><div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-violet-400" /></div></PageShell>;

  const xpPct = Math.round((profile.total_xp % 500) / 5);

  return (
    <PageShell>
      <div className="space-y-4" data-testid="tech-profile-page">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-violet-400 mb-1 flex items-center gap-2">
            <Trophy className="w-3 h-3" />Tech Profile
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{profile.name}</h1>
          <p className="text-sm text-muted-foreground">{profile.email} · Level {profile.level} · {achievements?.total_unlocked || 0}/{achievements?.total_available || 0} achievements unlocked</p>
        </div>

        <Card className="border-violet-500/30 bg-gradient-to-br from-violet-900/10 to-slate-900">
          <CardContent className="p-6 flex items-center gap-5">
            <div className="w-20 h-20 rounded-full bg-violet-500/20 border-2 border-violet-500/50 flex items-center justify-center text-3xl font-bold relative shrink-0">
              {profile.name?.charAt(0) || "?"}
              <span className="absolute -bottom-1 -right-1"><PresenceDot led={presence?.led || "offline"} size={14} /></span>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-violet-400 border-violet-500/40 bg-violet-500/10"><Trophy className="w-3 h-3 mr-1" />Level {profile.level}</Badge>
                <Badge variant="outline" className="text-amber-400 border-amber-500/40 bg-amber-500/10">{achievements?.total_unlocked || 0}/{achievements?.total_available || 0} 🏆</Badge>
                <Badge variant="outline" className="text-emerald-400 border-emerald-500/40 bg-emerald-500/10">{profile.closed_tickets} closed</Badge>
                <Badge variant="outline" className="text-sky-400 border-sky-500/40 bg-sky-500/10">{profile.avg_resolve_hours ?? "—"}h avg</Badge>
              </div>
              <div className="mt-3 flex items-center gap-3 text-xs">
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-violet-500 to-emerald-500 transition-all" style={{ width: `${xpPct}%` }} />
                </div>
                <span className="font-mono">{profile.total_xp.toLocaleString()} XP</span>
                <span className="text-muted-foreground">{profile.next_level_in} to next</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview" data-testid="profile-tab-overview">Overview</TabsTrigger>
            <TabsTrigger value="about" data-testid="profile-tab-about">About</TabsTrigger>
            <TabsTrigger value="achievements" data-testid="profile-tab-achievements">Achievements</TabsTrigger>
            <TabsTrigger value="quests" data-testid="profile-tab-quests">Daily Quests</TabsTrigger>
            {techId === user?.id && <TabsTrigger value="bucket" data-testid="profile-tab-bucket">Brain Bucket</TabsTrigger>}
          </TabsList>

          <TabsContent value="overview" className="mt-4 space-y-3">
            {/* Stat strip — 4 cards now (closed, open, avg resolve, CSAT) */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card data-testid="profile-stat-closed"><CardContent className="p-4">
                <div className="text-[10px] uppercase text-emerald-400 tracking-widest">Closed</div>
                <div className="text-3xl font-mono font-bold mt-1">{profile.closed_tickets}</div>
              </CardContent></Card>
              <Card data-testid="profile-stat-open"><CardContent className="p-4">
                <div className="text-[10px] uppercase text-amber-400 tracking-widest">Open</div>
                <div className="text-3xl font-mono font-bold mt-1">{profile.open_tickets}</div>
              </CardContent></Card>
              <Card data-testid="profile-stat-avg"><CardContent className="p-4">
                <div className="text-[10px] uppercase text-sky-400 tracking-widest">Avg resolve</div>
                <div className="text-3xl font-mono font-bold mt-1">{profile.avg_resolve_hours ?? "—"}<span className="text-sm">h</span></div>
              </CardContent></Card>
              <Card data-testid="profile-stat-csat"><CardContent className="p-4">
                <div className="text-[10px] uppercase text-amber-400 tracking-widest flex items-center gap-1"><Star className="w-3 h-3 fill-current" />CSAT</div>
                <div className="text-3xl font-mono font-bold mt-1">
                  {profile.csat_avg != null ? <>{profile.csat_avg}<span className="text-sm text-muted-foreground">/5</span></> : "—"}
                </div>
                {profile.csat_count > 0 && <div className="text-[10px] text-muted-foreground">{profile.csat_count} response{profile.csat_count === 1 ? "" : "s"}</div>}
              </CardContent></Card>
            </div>

            {/* Two-column: skills radar + recent closed */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <Card>
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

              <Card data-testid="profile-recent-closed">
                <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-emerald-400" />Recent closed</CardTitle></CardHeader>
                <CardContent className="space-y-1">
                  {(!profile.recent_closed || profile.recent_closed.length === 0) ? (
                    <div className="text-xs text-muted-foreground text-center py-4">No closed tickets yet</div>
                  ) : profile.recent_closed.map(t => (
                    <button key={t.id} onClick={() => navigate(`/tickets?ticket=${t.ticket_number}`)} className="w-full flex items-center gap-2 text-left p-1.5 rounded hover:bg-white/[0.03]">
                      <code className="text-[10px] font-mono text-zinc-500 w-[78px] shrink-0">{t.ticket_number}</code>
                      <span className="text-xs flex-1 truncate">{t.title}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">{t.client_name}</span>
                      <span className="text-[10px] text-muted-foreground/70 shrink-0">{t.resolved_at && formatDistanceToNow(new Date(t.resolved_at), { addSuffix: true })}</span>
                    </button>
                  ))}
                </CardContent>
              </Card>
            </div>

            {/* Activity heatmap (7d × 24h) */}
            <Card data-testid="profile-heatmap">
              <CardHeader className="pb-2"><CardTitle className="text-sm">Activity heatmap (recent)</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  {(() => {
                    const max = Math.max(1, ...(profile.activity_heatmap || []).flat());
                    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
                    return (
                      <div className="inline-block">
                        <div className="flex">
                          <div className="w-10" />
                          {Array.from({ length: 24 }).map((_, h) => (
                            <div key={h} className="w-3 text-center text-[8px] font-mono text-zinc-600">{h % 6 === 0 ? h : ""}</div>
                          ))}
                        </div>
                        {(profile.activity_heatmap || []).map((row, di) => (
                          <div key={di} className="flex items-center gap-1">
                            <div className="w-10 text-[10px] font-mono text-zinc-500">{days[di]}</div>
                            {row.map((v, hi) => {
                              const op = v ? Math.min(0.95, 0.15 + (v / max) * 0.8) : 0.04;
                              return <div key={hi} className="w-3 h-3 m-px rounded-sm" style={{ background: `rgba(139,92,246,${op})` }} title={`${days[di]} ${hi}:00 — ${v} events`} />;
                            })}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ABOUT tab — editable for self / admins */}
          <TabsContent value="about" className="mt-4 space-y-3">
            <Card data-testid="profile-about-card">
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-sm">About</CardTitle>
                {isMe && (
                  editingProfile ? (
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => setEditingProfile(false)}>Cancel</Button>
                      <Button size="sm" onClick={saveProfileExtras} disabled={savingProfile} data-testid="profile-save-btn">
                        {savingProfile ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}Save
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setEditingProfile(true)} data-testid="profile-edit-btn">Edit</Button>
                  )
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-xs flex items-center gap-1.5"><Bell className="w-3 h-3" />On-call status</Label>
                  {editingProfile ? (
                    <div className="flex items-center gap-2 mt-1">
                      <Switch checked={onCallDraft} onCheckedChange={setOnCallDraft} data-testid="profile-oncall-toggle" />
                      <span className="text-xs text-muted-foreground">{onCallDraft ? "Available for after-hours pages" : "Not on-call"}</span>
                    </div>
                  ) : (
                    <Badge className={profile.on_call ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : "bg-zinc-500/15 text-zinc-400 border-zinc-500/30"}>
                      {profile.on_call ? "On-call" : "Off-call"}
                    </Badge>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Working hours</Label>
                    {editingProfile
                      ? <Input value={whDraft} onChange={e => setWhDraft(e.target.value)} placeholder="09:00–17:00 AEST" data-testid="profile-wh-input" />
                      : <p className="text-sm font-mono mt-1">{profile.working_hours || "—"}</p>}
                  </div>
                  <div>
                    <Label className="text-xs">Timezone</Label>
                    {editingProfile
                      ? <Input value={tzDraft} onChange={e => setTzDraft(e.target.value)} placeholder="Australia/Sydney" data-testid="profile-tz-input" />
                      : <p className="text-sm font-mono mt-1">{profile.timezone || "—"}</p>}
                  </div>
                </div>

                <div>
                  <Label className="text-xs">Bio</Label>
                  {editingProfile
                    ? <Textarea value={bioDraft} onChange={e => setBioDraft(e.target.value)} rows={3} placeholder="A short blurb your teammates will see" data-testid="profile-bio-input" />
                    : <p className="text-sm text-muted-foreground mt-1 italic">{profile.bio || "No bio yet."}</p>}
                </div>

                <div>
                  <Label className="text-xs flex items-center gap-1.5"><Award className="w-3 h-3 text-violet-400" />Specialties</Label>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {(editingProfile ? specDraft : profile.specialties || []).map(s => (
                      <Badge key={s} variant="outline" className="text-violet-300 border-violet-500/40 bg-violet-500/10 gap-1" data-testid={`spec-${s}`}>
                        {s}
                        {editingProfile && <button onClick={() => setSpecDraft(specDraft.filter(x => x !== s))}><X className="w-2.5 h-2.5" /></button>}
                      </Badge>
                    ))}
                    {!profile.specialties?.length && !editingProfile && <span className="text-xs text-muted-foreground italic">No specialties listed</span>}
                  </div>
                  {editingProfile && (
                    <div className="flex gap-1.5 mt-2">
                      <Input value={newSpec} onChange={e => setNewSpec(e.target.value)} onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addSpec())} placeholder="e.g. Network, M365, MacOS" className="h-7 text-xs" data-testid="profile-new-spec" />
                      <Button size="sm" variant="outline" className="h-7 px-2" onClick={addSpec}><Plus className="w-3 h-3" /></Button>
                    </div>
                  )}
                </div>

                <div>
                  <Label className="text-xs flex items-center gap-1.5"><Trophy className="w-3 h-3 text-amber-400" />Certifications</Label>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {(editingProfile ? certDraft : profile.certifications || []).map(c => (
                      <Badge key={c} variant="outline" className="text-amber-300 border-amber-500/40 bg-amber-500/10 gap-1" data-testid={`cert-${c}`}>
                        {c}
                        {editingProfile && <button onClick={() => setCertDraft(certDraft.filter(x => x !== c))}><X className="w-2.5 h-2.5" /></button>}
                      </Badge>
                    ))}
                    {!profile.certifications?.length && !editingProfile && <span className="text-xs text-muted-foreground italic">No certifications listed</span>}
                  </div>
                  {editingProfile && (
                    <div className="flex gap-1.5 mt-2">
                      <Input value={newCert} onChange={e => setNewCert(e.target.value)} onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addCert())} placeholder="e.g. CompTIA Network+, AZ-104" className="h-7 text-xs" data-testid="profile-new-cert" />
                      <Button size="sm" variant="outline" className="h-7 px-2" onClick={addCert}><Plus className="w-3 h-3" /></Button>
                    </div>
                  )}
                </div>
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
                  <Button onClick={saveBucket} disabled={bucketLoading} variant="outline" size="sm" className="mt-2 text-violet-400 border-violet-500/30 hover:bg-violet-500/10" data-testid="brain-bucket-save">
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
