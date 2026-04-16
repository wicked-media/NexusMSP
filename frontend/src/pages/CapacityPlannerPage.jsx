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
  Users, TrendingUp, AlertTriangle, Target, RefreshCw, Loader2,
  BarChart3, Clock, Monitor, Zap, ArrowUp, ArrowDown
} from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, CartesianGrid, LineChart, Line, Legend } from "recharts";

export default function CapacityPlannerPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("overview");
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/capacity-planner/overview`, { headers });
      setData(res.data);
    } catch { toast.error("Failed to load capacity data"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading || !data) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const c = data.current;
  const f = data.forecast;
  const utilizationColor = c.utilization_pct >= 90 ? "text-red-400" : c.utilization_pct >= 75 ? "text-amber-400" : "text-emerald-400";
  const utilizationBg = c.utilization_pct >= 90 ? "border-red-500/30 bg-red-500/5" : c.utilization_pct >= 75 ? "border-amber-500/30 bg-amber-500/5" : "border-emerald-500/30 bg-emerald-500/5";

  return (
    <div className="space-y-5" data-testid="capacity-planner-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-cyan-500 flex items-center justify-center"><Users className="w-5 h-5 text-white" /></div>
            Resource Capacity Planner
          </h1>
          <p className="text-muted-foreground mt-1">Forecast technician headcount based on ticket trends and workload</p>
        </div>
        <Button variant="outline" onClick={fetchData} data-testid="refresh-capacity"><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: "Technicians", value: c.technicians, icon: Users, color: "text-blue-400" },
          { label: "Tickets/Tech", value: c.tickets_per_tech, icon: Target, color: "text-amber-400" },
          { label: "Devices/Tech", value: c.devices_per_tech, icon: Monitor, color: "text-cyan-400" },
          { label: "Total Devices", value: c.total_devices, icon: BarChart3, color: "text-purple-400" },
          { label: "Total Clients", value: c.total_clients, icon: Users, color: "text-emerald-400" },
        ].map(st => (
          <Card key={st.label} className="border-border/40">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-1"><p className="text-xs text-muted-foreground uppercase tracking-wider">{st.label}</p><st.icon className={`w-4 h-4 ${st.color}`} /></div>
              <p className={`text-2xl font-bold ${st.color}`}>{st.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Utilization Gauge */}
      <Card className={`${utilizationBg} border`}>
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold">Team Utilization</span>
              {f.hiring_needed && <Badge variant="destructive" className="text-[10px] animate-pulse">Hiring Needed</Badge>}
            </div>
            <span className={`text-lg font-black ${utilizationColor}`}>{c.utilization_pct}%</span>
          </div>
          <Progress value={c.utilization_pct} className="h-3" />
          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span>Current team: <strong className="text-foreground">{c.technicians} techs</strong></span>
              <span>Recommended: <strong className={f.hiring_needed ? "text-amber-400" : "text-emerald-400"}>{f.recommended_techs} techs</strong></span>
            </div>
            {f.bottleneck !== "none" && (
              <Badge variant="outline" className="text-xs text-amber-400">Bottleneck: {f.bottleneck.replace(/_/g, " ")}</Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Forecast Alert */}
      {f.hiring_needed && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
              <div>
                <p className="text-sm font-bold text-amber-400">Capacity Alert</p>
                <p className="text-xs text-muted-foreground">Current workload exceeds optimal capacity. Consider hiring {f.recommended_techs - c.technicians} additional technician{f.recommended_techs - c.technicians > 1 ? "s" : ""} to maintain service quality.</p>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <div className="text-right">
                  <p className="text-lg font-black text-foreground">{c.technicians}</p>
                  <p className="text-[10px] text-muted-foreground">current</p>
                </div>
                <ArrowUp className="w-4 h-4 text-amber-400" />
                <div className="text-right">
                  <p className="text-lg font-black text-amber-400">{f.recommended_techs}</p>
                  <p className="text-[10px] text-muted-foreground">recommended</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Capacity Trend</TabsTrigger>
          <TabsTrigger value="workload">Workload Analysis</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <Card className="border-border/40">
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="w-4 h-4 text-blue-400" />Capacity Trend (6 Months)</CardTitle></CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.trend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <RechartsTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="tech_hours_used" name="Hours Used" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="tech_hours_available" name="Hours Available" fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} opacity={0.3} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <Separator className="my-4" />
              <div className="grid grid-cols-3 gap-4">
                {data.trend.slice(-3).map(t => {
                  const usage = t.tech_hours_available > 0 ? Math.round((t.tech_hours_used / t.tech_hours_available) * 100) : 0;
                  return (
                    <div key={t.month} className="p-3 rounded-lg bg-muted/30 border border-border/20">
                      <p className="text-xs text-muted-foreground">{t.month}</p>
                      <p className="text-lg font-bold">{usage}%</p>
                      <Progress value={usage} className="h-1.5 mt-1" />
                      <p className="text-[10px] text-muted-foreground mt-1">{t.tech_hours_used}h / {t.tech_hours_available}h</p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="workload" className="mt-4">
          <div className="grid grid-cols-2 gap-4">
            <Card className="border-border/40">
              <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Target className="w-4 h-4 text-amber-400" />Workload Ratios</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex items-center justify-between text-sm mb-1"><span>Tickets per Tech</span><span className={`font-bold ${c.tickets_per_tech > 30 ? "text-red-400" : "text-emerald-400"}`}>{c.tickets_per_tech}</span></div>
                  <Progress value={Math.min((c.tickets_per_tech / 50) * 100, 100)} className="h-2" />
                  <p className="text-[10px] text-muted-foreground mt-1">{c.tickets_per_tech > 30 ? "Above optimal threshold (30)" : "Within healthy range"}</p>
                </div>
                <Separator />
                <div>
                  <div className="flex items-center justify-between text-sm mb-1"><span>Devices per Tech</span><span className={`font-bold ${c.devices_per_tech > 40 ? "text-red-400" : "text-emerald-400"}`}>{c.devices_per_tech}</span></div>
                  <Progress value={Math.min((c.devices_per_tech / 60) * 100, 100)} className="h-2" />
                  <p className="text-[10px] text-muted-foreground mt-1">{c.devices_per_tech > 40 ? "Above optimal threshold (40)" : "Within healthy range"}</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-border/40">
              <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Zap className="w-4 h-4 text-purple-400" />Scaling Scenarios</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {[
                  { label: "Add 1 Tech", newTicketsPerTech: Math.round((c.tickets_per_tech * c.technicians) / (c.technicians + 1) * 10) / 10, newDevicesPerTech: Math.round((c.devices_per_tech * c.technicians) / (c.technicians + 1) * 10) / 10, delta: 1 },
                  { label: "Add 2 Techs", newTicketsPerTech: Math.round((c.tickets_per_tech * c.technicians) / (c.technicians + 2) * 10) / 10, newDevicesPerTech: Math.round((c.devices_per_tech * c.technicians) / (c.technicians + 2) * 10) / 10, delta: 2 },
                  { label: "Remove 1 Tech", newTicketsPerTech: c.technicians > 1 ? Math.round((c.tickets_per_tech * c.technicians) / (c.technicians - 1) * 10) / 10 : "N/A", newDevicesPerTech: c.technicians > 1 ? Math.round((c.devices_per_tech * c.technicians) / (c.technicians - 1) * 10) / 10 : "N/A", delta: -1 },
                ].map(scenario => (
                  <div key={scenario.label} className="p-3 rounded-lg border border-border/20 bg-muted/20">
                    <div className="flex items-center gap-2 mb-2">
                      {scenario.delta > 0 ? <ArrowUp className="w-3 h-3 text-emerald-400" /> : <ArrowDown className="w-3 h-3 text-red-400" />}
                      <span className="text-sm font-semibold">{scenario.label}</span>
                      <Badge variant="outline" className="text-[10px] ml-auto">{c.technicians + scenario.delta} techs</Badge>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <span>Tickets/Tech: <strong>{scenario.newTicketsPerTech}</strong></span>
                      <span>Devices/Tech: <strong>{scenario.newDevicesPerTech}</strong></span>
                    </div>
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
