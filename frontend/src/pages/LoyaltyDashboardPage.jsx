import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Loader2, RefreshCw, Trophy, Crown, Star, Gift, DollarSign,
  Users, TrendingUp, ArrowUpRight, Target, Percent, Zap
} from "lucide-react";

const tierConfig = {
  platinum: { label: "Platinum", color: "text-slate-300", bg: "bg-gradient-to-r from-slate-300/20 to-slate-500/20", border: "border-slate-400/30", icon: Crown },
  gold: { label: "Gold", color: "text-yellow-400", bg: "bg-gradient-to-r from-yellow-400/20 to-amber-500/20", border: "border-yellow-500/30", icon: Crown },
  silver: { label: "Silver", color: "text-slate-400", bg: "bg-gradient-to-r from-slate-400/20 to-slate-500/20", border: "border-slate-500/30", icon: Star },
  bronze: { label: "Bronze", color: "text-amber-600", bg: "bg-gradient-to-r from-amber-600/20 to-amber-700/20", border: "border-amber-600/30", icon: Trophy },
};

export default function LoyaltyDashboardPage({ embedded = false }) {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [proposals, setProposals] = useState(null);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [loyRes, propRes] = await Promise.all([
        axios.get(`${API}/loyalty/dashboard`, { headers }),
        axios.get(`${API}/contracts/auto-renewal-proposals`, { headers }).catch(() => ({ data: null })),
      ]);
      setData(loyRes.data);
      setProposals(propRes.data);
    } catch { toast.error("Failed to fetch data"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="space-y-6" data-testid="loyalty-dashboard-page">
      {!embedded && (
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Client Loyalty & Renewals</h1>
            <p className="text-muted-foreground">Track loyalty tiers, rewards, and contract renewal proposals</p>
          </div>
          <Button variant="outline" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button>
        </div>
      )}

      {embedded && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 px-4 py-3">
          <div><p className="text-sm font-semibold">Client loyalty & renewals</p><p className="text-xs text-muted-foreground">Loyalty tiers, rewards, and contract renewal proposals.</p></div>
          <Button variant="outline" size="sm" onClick={fetchData}><RefreshCw className="w-3.5 h-3.5 mr-1" />Refresh</Button>
        </div>
      )}

      <Tabs defaultValue="loyalty">
        <TabsList className="grid grid-cols-2 w-full max-w-md">
          <TabsTrigger value="loyalty"><Trophy className="w-3 h-3 mr-1" />Loyalty Tiers</TabsTrigger>
          <TabsTrigger value="renewals"><TrendingUp className="w-3 h-3 mr-1" />Auto-Renewal Proposals</TabsTrigger>
        </TabsList>

        <TabsContent value="loyalty" className="space-y-4">
          {data && (
            <>
              {/* Tier Summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Object.entries(tierConfig).map(([key, cfg]) => {
                  const Icon = cfg.icon;
                  return (
                    <Card key={key} className={`${cfg.border} border`}>
                      <CardContent className="pt-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-lg ${cfg.bg} flex items-center justify-center`}>
                            <Icon className={`w-5 h-5 ${cfg.color}`} />
                          </div>
                          <div>
                            <p className={`text-2xl font-bold ${cfg.color}`}>{data.tier_counts[key]}</p>
                            <p className="text-xs text-muted-foreground">{cfg.label}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {/* Client Loyalty List */}
              <Card>
                <CardHeader><CardTitle className="text-base">Client Loyalty Rankings</CardTitle></CardHeader>
                <CardContent className="p-0">
                  <ScrollArea className="h-[500px]">
                    <div className="space-y-1 p-4">
                      {data.clients.map((client, i) => {
                        const tc = tierConfig[client.tier] || tierConfig.bronze;
                        const Icon = tc.icon;
                        return (
                          <div key={client.client_id} className={`flex items-center gap-4 p-3 rounded-lg border ${tc.border} hover:bg-muted/20 transition-all`}
                            data-testid={`loyalty-client-${client.client_id}`}>
                            <div className="w-8 text-center font-bold text-muted-foreground text-sm">#{i + 1}</div>
                            <div className={`w-10 h-10 rounded-lg ${tc.bg} flex items-center justify-center`}>
                              <Icon className={`w-5 h-5 ${tc.color}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="font-medium text-sm">{client.client_name}</p>
                                <Badge className={`${tc.bg} ${tc.color} text-[9px] ${tc.border}`}>{tc.label}</Badge>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {client.active_contracts} contract{client.active_contracts !== 1 ? "s" : ""} &middot; ${client.total_spend.toLocaleString()} total spend
                              </p>
                            </div>
                            <div className="text-right">
                              <p className={`font-bold text-lg ${tc.color}`}>{client.loyalty_points.toLocaleString()}</p>
                              <p className="text-[10px] text-muted-foreground">points</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="renewals" className="space-y-4">
          {proposals && (
            <>
              {/* Renewal Summary */}
              <div className="grid grid-cols-3 gap-4">
                <Card className="border-blue-500/30">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center"><DollarSign className="w-5 h-5 text-blue-400" /></div>
                      <div><p className="text-2xl font-bold text-blue-400">${proposals.total_current_mrr.toLocaleString()}</p><p className="text-xs text-muted-foreground">Current MRR (Expiring)</p></div>
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-emerald-500/30">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center"><TrendingUp className="w-5 h-5 text-emerald-400" /></div>
                      <div><p className="text-2xl font-bold text-emerald-400">${proposals.total_potential_mrr.toLocaleString()}</p><p className="text-xs text-muted-foreground">Potential New MRR</p></div>
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-cyan-500/30">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center"><ArrowUpRight className="w-5 h-5 text-cyan-400" /></div>
                      <div><p className="text-2xl font-bold text-cyan-400">+${proposals.total_upsell_potential.toLocaleString()}</p><p className="text-xs text-muted-foreground">Upsell Potential</p></div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Proposals */}
              <Card>
                <CardHeader><CardTitle className="text-base">Smart Renewal Proposals</CardTitle></CardHeader>
                <CardContent>
                  <ScrollArea className="h-[450px]">
                    <div className="space-y-3">
                      {proposals.proposals.map(proposal => (
                        <Card key={proposal.contract_id} className={`${proposal.days_remaining <= 14 ? "border-red-500/30" : proposal.days_remaining <= 30 ? "border-amber-500/30" : "border-border/50"}`}
                          data-testid={`renewal-proposal-${proposal.contract_id}`}>
                          <CardContent className="py-4">
                            <div className="flex items-start justify-between mb-3">
                              <div>
                                <div className="flex items-center gap-2">
                                  <p className="font-semibold text-sm">{proposal.contract_name}</p>
                                  <Badge className={`text-[9px] ${proposal.days_remaining <= 14 ? "bg-red-500/20 text-red-400" : proposal.days_remaining <= 30 ? "bg-amber-500/20 text-amber-400" : "bg-blue-500/20 text-blue-400"}`}>
                                    {proposal.days_remaining} days left
                                  </Badge>
                                  {proposal.auto_renew && <Badge variant="outline" className="text-[9px] text-emerald-400 border-emerald-500/30">Auto-Renew</Badge>}
                                </div>
                                <p className="text-xs text-muted-foreground">{proposal.client_name} &middot; Expires: {proposal.end_date?.split("T")[0]}</p>
                              </div>
                              <div className="text-right">
                                <p className="font-mono text-sm">${proposal.current_value.toLocaleString()}/mo</p>
                                <p className="text-xs text-muted-foreground capitalize">{proposal.sla_tier} SLA</p>
                              </div>
                            </div>
                            {proposal.upsell_opportunities.length > 0 && (
                              <div className="space-y-1.5">
                                <p className="text-[10px] font-semibold text-cyan-400 uppercase tracking-wider">Upsell Opportunities</p>
                                {proposal.upsell_opportunities.map((u, i) => (
                                  <div key={`k-${i}`} className="flex items-center gap-2 p-2 rounded bg-cyan-500/5 border border-cyan-500/10">
                                    <Zap className="w-3 h-3 text-cyan-400 flex-shrink-0" />
                                    <span className="text-xs flex-1">{u.description}</span>
                                    <span className="text-xs font-mono text-cyan-400">+${u.additional_mrr.toLocaleString()}/mo</span>
                                  </div>
                                ))}
                                <div className="flex items-center justify-between pt-2 border-t border-border/50 mt-2">
                                  <span className="text-xs font-semibold">Recommended New Value</span>
                                  <span className="font-mono font-bold text-emerald-400">${proposal.recommended_new_value.toLocaleString()}/mo</span>
                                </div>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                      {proposals.proposals.length === 0 && (
                        <div className="text-center py-12 text-muted-foreground"><Target className="w-12 h-12 mx-auto opacity-30 mb-3" /><p>No contracts expiring in the next 60 days</p></div>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
