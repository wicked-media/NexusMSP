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
  Loader2, RefreshCw, AlertTriangle, TrendingUp, Heart, DollarSign,
  Users, Shield, ChevronRight, Target, ArrowUpRight, ArrowDownRight
} from "lucide-react";

export default function HealthRadarPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/health-radar/dashboard`, { headers });
      setData(res.data);
    } catch { toast.error("Failed to fetch radar data"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const getScoreColor = (score) => {
    if (score >= 80) return { text: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30" };
    if (score >= 60) return { text: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30" };
    return { text: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30" };
  };

  return (
    <div className="space-y-6" data-testid="health-radar-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Client Health & Opportunity Radar</h1>
          <p className="text-muted-foreground">Identify at-risk clients and upsell opportunities</p>
        </div>
        <Button variant="outline" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button>
      </div>

      {data && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center"><Users className="w-5 h-5 text-primary" /></div><div><p className="text-2xl font-bold">{data.summary.total_clients}</p><p className="text-xs text-muted-foreground">Total Clients</p></div></div></CardContent>
            </Card>
            <Card className="border-red-500/30">
              <CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center"><AlertTriangle className="w-5 h-5 text-red-400" /></div><div><p className="text-2xl font-bold text-red-400">{data.summary.at_risk_count}</p><p className="text-xs text-muted-foreground">At Risk</p></div></div></CardContent>
            </Card>
            <Card className="border-emerald-500/30">
              <CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center"><Heart className="w-5 h-5 text-emerald-400" /></div><div><p className="text-2xl font-bold text-emerald-400">{data.summary.healthy_count}</p><p className="text-xs text-muted-foreground">Healthy</p></div></div></CardContent>
            </Card>
            <Card className="border-cyan-500/30">
              <CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center"><TrendingUp className="w-5 h-5 text-cyan-400" /></div><div><p className="text-2xl font-bold text-cyan-400">${data.summary.total_potential_mrr?.toLocaleString()}</p><p className="text-xs text-muted-foreground">Potential MRR</p></div></div></CardContent>
            </Card>
          </div>

          <Tabs defaultValue="at-risk">
            <TabsList className="w-full grid grid-cols-3">
              <TabsTrigger value="at-risk"><AlertTriangle className="w-3 h-3 mr-1" />At Risk ({data.at_risk_clients.length})</TabsTrigger>
              <TabsTrigger value="opportunities"><TrendingUp className="w-3 h-3 mr-1" />Opportunities ({data.upsell_opportunities.length})</TabsTrigger>
              <TabsTrigger value="healthy"><Heart className="w-3 h-3 mr-1" />Healthy ({data.healthy_clients.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="at-risk">
              <ScrollArea className="h-[500px]">
                <div className="space-y-3">
                  {data.at_risk_clients.map(client => {
                    const sc = getScoreColor(client.health_score);
                    return (
                      <Card key={client.client_id} className={`${sc.border} border hover:bg-muted/20 transition-all`} data-testid={`risk-client-${client.client_id}`}>
                        <CardContent className="py-4">
                          <div className="flex items-start gap-4">
                            <div className="relative w-14 h-14 flex-shrink-0">
                              <svg className="w-14 h-14 -rotate-90" viewBox="0 0 36 36">
                                <path d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-muted/20" />
                                <path d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={`${client.health_score}, 100`} className={sc.text} />
                              </svg>
                              <span className={`absolute inset-0 flex items-center justify-center text-sm font-bold ${sc.text}`}>{client.health_score}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className="font-semibold text-sm">{client.client_name}</h3>
                                <Badge className={`${sc.bg} ${sc.text} text-[9px]`}>{client.status}</Badge>
                                {client.mrr > 0 && <Badge variant="outline" className="text-[9px]">${client.mrr.toLocaleString()}/mo</Badge>}
                              </div>
                              {client.risk_factors.length > 0 && (
                                <div className="flex flex-wrap gap-1 mb-2">
                                  {client.risk_factors.map((f, i) => (
                                    <Badge key={i} variant="outline" className="text-[9px] bg-red-500/5 border-red-500/20 text-red-400">{f}</Badge>
                                  ))}
                                </div>
                              )}
                              <div className="flex gap-4 text-[10px] text-muted-foreground">
                                <span>Tickets: {client.metrics.open_tickets} open</span>
                                <span>Devices: {client.metrics.devices} ({client.metrics.offline_devices} offline)</span>
                                <span>Contracts: {client.metrics.active_contracts}</span>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                  {data.at_risk_clients.length === 0 && (
                    <div className="text-center py-12 text-muted-foreground"><Shield className="w-12 h-12 mx-auto opacity-30 mb-3" /><p>No at-risk clients!</p></div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="opportunities">
              <ScrollArea className="h-[500px]">
                <div className="space-y-3">
                  {data.upsell_opportunities.map(client => (
                    <Card key={client.client_id} className="border-cyan-500/20 hover:bg-muted/20 transition-all" data-testid={`opp-client-${client.client_id}`}>
                      <CardContent className="py-4">
                        <div className="flex items-start gap-4">
                          <div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center flex-shrink-0">
                            <Target className="w-5 h-5 text-cyan-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2">
                              <h3 className="font-semibold text-sm">{client.client_name}</h3>
                              <Badge variant="outline" className="text-[9px] text-cyan-400 border-cyan-500/30">
                                <DollarSign className="w-2.5 h-2.5 mr-0.5" />
                                ${client.opportunities.reduce((s, o) => s + (o.potential_mrr || 0), 0).toLocaleString()} potential
                              </Badge>
                            </div>
                            <div className="space-y-1.5">
                              {client.opportunities.map((opp, i) => (
                                <div key={i} className="flex items-center gap-2 p-2 rounded bg-cyan-500/5 border border-cyan-500/10">
                                  <ArrowUpRight className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
                                  <span className="text-xs flex-1">{opp.description}</span>
                                  {opp.potential_mrr > 0 && <span className="text-xs font-mono text-cyan-400">${opp.potential_mrr}/mo</span>}
                                  <Badge variant="outline" className="text-[8px] capitalize">{opp.type}</Badge>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  {data.upsell_opportunities.length === 0 && (
                    <div className="text-center py-12 text-muted-foreground"><TrendingUp className="w-12 h-12 mx-auto opacity-30 mb-3" /><p>No opportunities identified</p></div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="healthy">
              <ScrollArea className="h-[500px]">
                <div className="space-y-2">
                  {data.healthy_clients.map(client => {
                    const sc = getScoreColor(client.health_score);
                    return (
                      <div key={client.client_id} className="flex items-center gap-4 p-3 rounded-lg border border-border/50 hover:bg-muted/20 transition-all" data-testid={`healthy-client-${client.client_id}`}>
                        <div className={`w-10 h-10 rounded-full ${sc.bg} flex items-center justify-center`}>
                          <span className={`text-sm font-bold ${sc.text}`}>{client.health_score}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm">{client.client_name}</p>
                          <div className="flex gap-3 text-[10px] text-muted-foreground">
                            <span>{client.metrics.devices} devices</span>
                            <span>{client.metrics.active_contracts} contracts</span>
                            <span>{client.metrics.open_tickets} open tickets</span>
                          </div>
                        </div>
                        {client.mrr > 0 && <span className="font-mono text-sm text-emerald-400">${client.mrr.toLocaleString()}/mo</span>}
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
