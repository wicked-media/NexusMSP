import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Trophy, Coins, PawPrint, Palette, Tag, ShoppingCart, Sparkles,
  Loader2, CheckCircle2, Lock, Shirt,
} from "lucide-react";

const KIND_LABEL = { pet: "Pets", skin: "Skins", title: "Titles" };
const KIND_ICON = { pet: PawPrint, skin: Palette, title: Tag };
const RARITY_TONE = {
  common: "border-zinc-400/30 text-zinc-300",
  rare: "border-cyan-400/40 text-cyan-300",
  epic: "border-violet-400/40 text-violet-300",
  legendary: "border-amber-400/50 text-amber-300",
};


function AchievementCard({ achievement, earned }) {
  return (
    <div className={`rounded-xl border p-3 text-center transition-all ${earned ? "border-amber-500/40 bg-amber-500/5" : "border-border/40 opacity-50"}`}
      data-testid={`achievement-${achievement.id}`}>
      <Trophy className={`mx-auto h-5 w-5 mb-1 ${earned ? "text-amber-400" : "text-muted-foreground"}`} />
      <p className="text-[11px] font-bold leading-tight">{achievement.name}</p>
      <p className="text-[9px] text-muted-foreground mt-0.5 leading-snug">{achievement.description}</p>
    </div>
  );
}

function RewardCard({ item, owned, points, onPurchase, onEquip, equipped }) {
  const Icon = KIND_ICON[item.kind] || Sparkles;
  const affordable = points >= (item.price_points || 0);
  return (
    <div className={`group relative overflow-hidden rounded-2xl border p-4 transition hover:scale-[1.015] ${RARITY_TONE[item.rarity] || ""} ${owned ? "bg-background/40" : "bg-card/30"}`}
      style={item.accent ? { borderColor: `${item.accent}40` } : undefined}
      data-testid={`reward-${item.id}`}>
      <div className="flex items-start justify-between">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl border text-2xl"
          style={item.accent ? { borderColor: `${item.accent}50`, background: `${item.accent}15` } : undefined}>
          {item.emoji || <Icon className="h-5 w-5" />}
        </span>
        <Badge variant="outline" className={`text-[8px] uppercase tracking-wide ${RARITY_TONE[item.rarity] || ""}`}>{item.rarity}</Badge>
      </div>
      <p className="mt-2 text-sm font-bold leading-tight">{item.name}</p>
      <p className="mt-1 text-[10px] text-muted-foreground leading-snug min-h-[26px]">{item.description}</p>
      <div className="mt-3 flex items-center justify-between">
        <span className="flex items-center gap-1 text-xs font-bold text-amber-300">
          <Coins className="h-3.5 w-3.5" />{item.price_points?.toLocaleString?.() ?? item.price_points}
        </span>
        {owned ? (
          <Button size="sm" variant={equipped ? "default" : "outline"} className="h-7 text-[10px]"
            onClick={() => onEquip(item, !equipped)} data-testid={`equip-${item.id}`}>
            {equipped ? "Equipped" : "Equip"}
          </Button>
        ) : (
          <Button size="sm" className="h-7 text-[10px]" disabled={!affordable}
            onClick={() => onPurchase(item)} data-testid={`buy-${item.id}`}>
            <ShoppingCart className="h-3 w-3 mr-1" />Buy
          </Button>
        )}
      </div>
    </div>
  );
}

export default function TechRewardsPage() {
  const { token, user } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [me, setMe] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [achievements, setAchievements] = useState([]);
  const [earned, setEarned] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [meRes, catRes, achRes, lbRes] = await Promise.all([
        axios.get(`${API}/tech-rewards/me`, { headers }),
        axios.get(`${API}/tech-rewards/catalog`, { headers }),
        axios.get(`${API}/achievements`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/tech-rewards/leaderboard`, { headers }).catch(() => ({ data: [] })),
      ]);
      setMe(meRes.data);
      setCatalog(catRes.data);
      setAchievements(achRes.data);
      setLeaderboard(lbRes.data);
      const earnedRes = await axios.get(`${API}/technicians/${user?.id || meRes.data.user_id}/achievements`, { headers }).catch(() => ({ data: [] }));
      setEarned(earnedRes.data);
    } catch {
      toast.error("Failed to load rewards");
    } finally {
      setLoading(false);
    }
  }, [headers, user]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const purchase = async (item) => {
    try {
      await axios.post(`${API}/tech-rewards/purchase`, { item_id: item.id }, { headers });
      toast.success(`${item.emoji || "✨"} ${item.name} unlocked!`);
      fetchAll();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to purchase reward");
    }
  };

  const equip = async (item, equipState) => {
    try {
      await axios.post(`${API}/tech-rewards/equip`, { item_id: item.id, equip: equipState }, { headers });
      toast.success(equipState ? `${item.name} equipped` : `${item.name} unequipped`);
      fetchAll();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to update loadout");
    }
  };

  const checkAchievements = async () => {
    try {
      const { data } = await axios.post(`${API}/technicians/${user?.id}/achievements/check`, {}, { headers });
      if (data.newly_awarded?.length) {
        toast.success(`Unlocked: ${data.newly_awarded.join(", ")} (+${data.points_earned || 0} points)`);
      } else {
        toast.info("No new achievements yet — keep going!");
      }
      fetchAll();
    } catch {
      toast.error("Failed to check achievements");
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin" /></div>;

  const points = me?.points || { balance: 0, lifetime_earned: 0, lifetime_spent: 0 };
  const earnedIds = new Set(earned.map((e) => e.achievement_id));
  const equippedByKind = {
    pet: me?.equipped_pet?.item_id,
    skin: me?.equipped_skin?.item_id,
    title: me?.equipped_title?.item_id,
  };

  return (
    <div className="space-y-5" data-testid="tech-rewards-page">
      <section className="flex flex-col gap-4 overflow-hidden rounded-2xl border border-primary/20 bg-[radial-gradient(circle_at_86%_0%,hsl(var(--primary)/0.22),transparent_38%),linear-gradient(120deg,hsl(var(--card)),hsl(var(--background)))] p-5 shadow-[0_16px_42px_-30px_hsl(var(--primary)/0.7)] sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary"><Trophy className="h-5 w-5" /></span>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Achievements &amp; rewards</p>
              <h1 className="text-2xl font-bold tracking-tight">Earn points. Adopt pets. Flex skins.</h1>
            </div>
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Every achievement and completed checklist earns points — spend them on pets, profile skins and titles that are uniquely yours.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-xl border border-amber-400/30 bg-amber-400/[0.08] px-4 py-2 text-center">
            <p className="text-xl font-black text-amber-300 flex items-center gap-1.5 justify-center"><Coins className="h-4 w-4" />{points.balance?.toLocaleString?.() ?? points.balance}</p>
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide">points balance</p>
          </div>
          <Button variant="outline" size="sm" onClick={checkAchievements} data-testid="check-achievements">
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />Check achievements
          </Button>
        </div>
      </section>

      {/* Equipped loadout */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Shirt className="h-4 w-4 text-cyan-300" />My loadout</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {["pet", "skin", "title"].map((kind) => {
            const equipped = me?.[`equipped_${kind}`];
            return (
              <div key={kind} className="flex min-w-[180px] flex-1 items-center gap-3 rounded-xl border border-border/60 bg-background/30 px-3 py-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg border text-xl"
                  style={equipped?.accent ? { borderColor: `${equipped.accent}50`, background: `${equipped.accent}15` } : undefined}>
                  {equipped?.emoji || (kind === "pet" ? "🐾" : kind === "skin" ? "🎨" : "🏷️")}
                </span>
                <div>
                  <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{KIND_LABEL[kind].slice(0, -1)}</p>
                  <p className="text-xs font-semibold">{equipped?.name || "Nothing equipped"}</p>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Tabs defaultValue="shop">
        <TabsList>
          <TabsTrigger value="shop" data-testid="tab-shop">Reward shop</TabsTrigger>
          <TabsTrigger value="achievements" data-testid="tab-achievements">Achievements ({earned.length}/{achievements.length})</TabsTrigger>
          <TabsTrigger value="inventory" data-testid="tab-inventory">Inventory ({me?.inventory?.length || 0})</TabsTrigger>
          <TabsTrigger value="leaderboard" data-testid="tab-leaderboard">Points leaderboard</TabsTrigger>
        </TabsList>

        <TabsContent value="shop" className="mt-4 space-y-5">
          {["pet", "skin", "title"].map((kind) => {
            const items = catalog.filter((i) => i.kind === kind);
            if (!items.length) return null;
            const Icon = KIND_ICON[kind];
            return (
              <div key={kind}>
                <div className="mb-2 flex items-center gap-2">
                  <Icon className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-bold">{KIND_LABEL[kind]}</h2>
                  <span className="h-px flex-1 bg-border/60" />
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {items.map((item) => (
                    <RewardCard key={item.id} item={item} owned={item.owned} points={points.balance}
                      equipped={equippedByKind[item.kind] === item.id}
                      onPurchase={purchase} onEquip={equip} />
                  ))}
                </div>
              </div>
            );
          })}
        </TabsContent>

        <TabsContent value="achievements" className="mt-4">
          <Card>
            <CardContent className="p-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                {achievements.map((a) => (
                  <AchievementCard key={a.id} achievement={a} earned={earnedIds.has(a.id)} />
                ))}
                {!achievements.length && <p className="col-span-full py-8 text-center text-xs text-muted-foreground">No achievements defined.</p>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="inventory" className="mt-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(me?.inventory || []).map((row) => (
              <div key={row.id} className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/30 px-3 py-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg border text-xl"
                  style={row.accent ? { borderColor: `${row.accent}50`, background: `${row.accent}15` } : undefined}>
                  {row.emoji || "✨"}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold truncate">{row.name}</p>
                  <p className="text-[9px] text-muted-foreground">{row.kind}{row.equipped ? " · equipped" : ""}</p>
                </div>
                {row.equipped
                  ? <CheckCircle2 className="ml-auto h-4 w-4 text-emerald-400" />
                  : <Button size="sm" variant="outline" className="ml-auto h-7 text-[10px]" onClick={() => equip(row, true)}>Equip</Button>}
              </div>
            ))}
            {!me?.inventory?.length && (
              <div className="col-span-full rounded-xl border border-border/50 py-12 text-center">
                <Lock className="mx-auto h-6 w-6 text-muted-foreground opacity-40" />
                <p className="mt-2 text-xs text-muted-foreground">Nothing owned yet — earn points and visit the shop!</p>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="leaderboard" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2.5 w-12">#</th>
                    <th className="px-4 py-2.5">Technician</th>
                    <th className="px-4 py-2.5">Companion</th>
                    <th className="px-4 py-2.5 text-right">Earned</th>
                    <th className="px-4 py-2.5 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((row, index) => (
                    <tr key={row.user_id} className="border-b border-border/30 last:border-0" data-testid={`points-rank-${index + 1}`}>
                      <td className="px-4 py-2.5 font-mono font-bold">{index + 1}</td>
                      <td className="px-4 py-2.5 font-medium">{row.user_id}</td>
                      <td className="px-4 py-2.5 text-lg">{row.equipped_pet?.emoji || "—"}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-amber-300">{row.earned?.toLocaleString?.() ?? row.earned}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{row.balance?.toLocaleString?.() ?? row.balance}</td>
                    </tr>
                  ))}
                  {!leaderboard.length && (
                    <tr><td colSpan={5} className="px-4 py-10 text-center text-xs text-muted-foreground">No points earned yet.</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
