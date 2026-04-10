import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Flame, BarChart3, Clock, RefreshCw, Loader2, AlertTriangle,
  TrendingUp, Users, Target, Activity, Shield, Zap
} from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, CartesianGrid } from "recharts";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PRIORITY_COLORS = { critical: "text-red-400 bg-red-500/10 border-red-500/30", high: "text-orange-400 bg-orange-500/10 border-orange-500/30", medium: "text-amber-400 bg-amber-500/10 border-amber-500/30", low: "text-blue-400 bg-blue-500/10 border-blue-500/30" };

export default function IncidentHeatmapPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("heatmap");
  const [hoveredCell, setHoveredCell] = useState(null);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/incident-heatmap/data`, { headers });
      setData(res.data);
    } catch { toast.error("Failed to load heatmap data"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading || !data) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const maxCount = Math.max(...data.heatmap.map(c => c.count), 1);
  const getColor = (count) => {
    if (count === 0) return "bg-muted/30";
    const intensity = count / maxCount;
    if (intensity > 0.75) return "bg-red-500";
    if (intensity > 0.5) return "bg-orange-500";
    if (intensity > 0.25) return "bg-amber-400";
    return "bg-emerald-400/60";
  };

  const bp = data.by_priority || {};
  const totalByPriority = (bp.critical || 0) + (bp.high || 0) + (bp.medium || 0) + (bp.low || 0);
  const hourlyTotals = Array.from({ length: 24 }, (_, h) => ({
    hour: `${h}:00`,
    count: data.heatmap.filter(c => c.hour === h).reduce((s, c) => s + c.count, 0)
  }));

  return (
    <div className="space-y-5" data-testid="incident-heatmap-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-red-500 to-amber-600 flex items-center justify-center"><Flame className="w-5 h-5 text-white" /></div>
            Incident Heatmap
          </h1>
          <p className="text-muted-foreground mt-1">Visual pattern analysis — when and where incidents occur most</p>
        </div>
        <Button variant="outline" onClick={fetchData} data-testid="refresh-heatmap"><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: "Total Incidents", value: data.insights.total_incidents, icon: Flame, color: "text-red-400" },
          { label: "Peak Hour", value: data.insights.peak_hour, icon: Clock, color: "text-amber-400" },
          { label: "Busiest Day", value: data.insights.peak_day, icon: Target, color: "text-blue-400" },
          { label: "Top Category", value: data.insights.busiest_category, icon: Activity, color: "text-purple-400", small: true },
          { label: "Critical", value: bp.critical || 0, icon: AlertTriangle, color: "text-red-400" },
        ].map(st => (
          <Card key={st.label} className="border-border/40">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-1"><p className="text-xs text-muted-foreground uppercase tracking-wider">{st.label}</p><st.icon className={`w-4 h-4 ${st.color}`} /></div>
              <p className={`${st.small ? "text-lg" : "text-2xl"} font-bold ${st.color}`}>{st.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Priority Breakdown */}
      {totalByPriority > 0 && (
        <Card className="border-border/40">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-6">
              <span className="text-sm font-semibold">Priority Distribution</span>
              <div className="flex-1 flex items-center gap-3">
                {["critical", "high", "medium", "low"].map(p => {
                  const val = bp[p] || 0;
                  const pct = totalByPriority > 0 ? Math.round((val / totalByPriority) * 100) : 0;
                  const pc = PRIORITY_COLORS[p];
                  return (
                    <div key={p} className={`flex-1 p-2 rounded-lg border ${pc} text-center`}>
                      <p className="text-lg font-black">{val}</p>
                      <p className="text-[10px] capitalize">{p} ({pct}%)</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="heatmap">Heatmap Grid</TabsTrigger>
          <TabsTrigger value="hourly">Hourly Trend</TabsTrigger>
          <TabsTrigger value="breakdown">Category & Client</TabsTrigger>
        </TabsList>

        <TabsContent value="heatmap" className="mt-4">
          <Card className="border-border/40">
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Flame className="w-4 h-4 text-red-400" />Incident Density (Day x Hour)</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <div className="min-w-[700px]">
                  <div className="flex gap-[3px] mb-1 ml-14">
                    {Array.from({ length: 24 }, (_, i) => (
                      <div key={`k-${i}`} className="w-7 text-center text-[9px] text-muted-foreground font-mono">{i}</div>
                    ))}
                  </div>
                  {DAYS.map((day, dayIdx) => (
                    <div key={day} className="flex items-center gap-[3px] mb-[3px]">
                      <span className="w-12 text-xs text-muted-foreground text-right mr-1 font-medium">{day}</span>
                      {Array.from({ length: 24 }, (_, hour) => {
                        const cell = data.heatmap.find(c => c.day_idx === dayIdx && c.hour === hour);
                        const count = cell?.count || 0;
                        const isHovered = hoveredCell?.day === dayIdx && hoveredCell?.hour === hour;
                        return (
                          <div key={hour}
                            className={`w-7 h-7 rounded-sm ${getColor(count)} transition-all cursor-pointer ${isHovered ? "ring-2 ring-primary scale-110" : "hover:ring-1 hover:ring-primary/50"}`}
                            onMouseEnter={() => setHoveredCell({ day: dayIdx, hour, count })}
                            onMouseLeave={() => setHoveredCell(null)}
                            data-testid={`heatmap-${dayIdx}-${hour}`}
                          />
                        );
                      })}
                    </div>
                  ))}
                  {hoveredCell && (
                    <div className="mt-3 p-2 rounded-lg bg-muted/50 border text-center">
                      <span className="text-sm font-medium">{DAYS[hoveredCell.day]} at {hoveredCell.hour}:00</span>
                      <span className="text-sm ml-2 font-bold text-amber-400">{hoveredCell.count} incidents</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-4 justify-center">
                    <span className="text-xs text-muted-foreground">Less</span>
                    {["bg-muted/30", "bg-emerald-400/60", "bg-amber-400", "bg-orange-500", "bg-red-500"].map((c, i) => <div key={`k-${i}`} className={`w-5 h-5 rounded-sm ${c}`} />)}
                    <span className="text-xs text-muted-foreground">More</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="hourly" className="mt-4">
          <Card className="border-border/40">
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="w-4 h-4 text-blue-400" />Incidents by Hour of Day</CardTitle></CardHeader>
            <CardContent>
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hourlyTotals}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={1} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <RechartsTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="count" name="Incidents" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="breakdown" className="mt-4">
          <div className="grid grid-cols-2 gap-4">
            <Card className="border-border/40">
              <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Activity className="w-4 h-4 text-purple-400" />By Category</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {data.by_category.map(c => {
                  const pct = data.insights.total_incidents > 0 ? Math.round((c.count / data.insights.total_incidents) * 100) : 0;
                  return (
                    <div key={c.category} className="flex items-center gap-3 p-2 rounded-lg bg-muted/30" data-testid={`cat-${c.category}`}>
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium capitalize">{c.category}</span>
                          <span className="text-xs text-muted-foreground">{c.count} ({pct}%)</span>
                        </div>
                        <Progress value={pct} className="h-1.5" />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
            <Card className="border-border/40">
              <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Users className="w-4 h-4 text-blue-400" />Top 10 Clients</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {data.by_client.map((c, i) => (
                  <div key={c.client} className="flex items-center gap-3 p-2 rounded-lg bg-muted/30" data-testid={`client-incidents-${c.client}`}>
                    <span className="text-xs font-mono text-muted-foreground w-5">{i + 1}</span>
                    <span className="text-sm flex-1 truncate">{c.client}</span>
                    <Badge variant="outline" className="font-mono">{c.count}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
