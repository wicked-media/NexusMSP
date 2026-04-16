import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  UserCog, Clock, DollarSign, Ticket, TrendingUp, BarChart3,
  AlertTriangle, CheckCircle, Loader2, Target, Zap, Users
} from "lucide-react";

export default function TechUtilizationPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    axios.get(`${API}/tech-utilization/dashboard`, { headers })
      .then(r => setData(r.data)).catch(() => toast.error("Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  if (!data) return null;

  const { summary: s, technicians: techs } = data;
  const topPerformer = techs[0];
  const underUtilized = techs.filter(t => t.utilization_pct < 50);
  const overUtilized = techs.filter(t => t.utilization_pct > 90);

  return (
    <div className="space-y-5" data-testid="tech-utilization-page">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center"><UserCog className="w-5 h-5 text-white" /></div>
          Technician Utilization & Profitability
        </h1>
        <p className="text-muted-foreground mt-1">Billable vs non-billable hours, utilization heatmaps, and revenue per technician</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-6 gap-3">
        {[
          { label: "Technicians", value: s.total_techs, icon: Users, color: "text-foreground" },
          { label: "Total Hours", value: `${s.total_hours_logged}h`, icon: Clock, color: "text-blue-400" },
          { label: "Billable Hours", value: `${s.total_billable_hours}h`, icon: DollarSign, color: "text-emerald-400" },
          { label: "Avg Utilization", value: `${s.avg_utilization}%`, icon: Target, color: s.avg_utilization >= 70 ? "text-emerald-400" : "text-amber-400" },
          { label: "Total Revenue", value: `$${s.total_revenue.toLocaleString()}`, icon: TrendingUp, color: "text-cyan-400" },
          { label: "Under-Utilized", value: underUtilized.length, icon: AlertTriangle, color: underUtilized.length > 0 ? "text-red-400" : "text-emerald-400" },
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
      <Card className="border-border/40">
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold">Team Utilization Target (70%)</span>
            <span className={`text-sm font-bold ${s.avg_utilization >= 70 ? "text-emerald-400" : "text-amber-400"}`}>{s.avg_utilization}%</span>
          </div>
          <div className="relative">
            <Progress value={s.avg_utilization} className="h-4" />
            <div className="absolute top-0 left-[70%] h-4 w-0.5 bg-white/50" title="70% target" />
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
            <span>0%</span><span>Target: 70%</span><span>100%</span>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="table">
        <TabsList>
          <TabsTrigger value="table">Detailed View</TabsTrigger>
          <TabsTrigger value="cards">Card View</TabsTrigger>
          <TabsTrigger value="alerts">Alerts ({underUtilized.length + overUtilized.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="table" className="mt-4">
          <Card className="border-border/40">
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>#</TableHead><TableHead>Technician</TableHead><TableHead>Total</TableHead><TableHead>Billable</TableHead><TableHead>Non-Bill</TableHead><TableHead>Utilization</TableHead><TableHead>Revenue</TableHead><TableHead>Active</TableHead><TableHead>Resolved</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {techs.map((t, i) => (
                    <TableRow key={t.user_id} data-testid={`util-row-${t.user_id}`} className={t.utilization_pct < 50 ? "bg-red-500/5" : t.utilization_pct > 90 ? "bg-amber-500/5" : ""}>
                      <TableCell className="font-mono text-xs">{i + 1}</TableCell>
                      <TableCell>
                        <div><span className="font-semibold text-sm">{t.name}</span></div>
                        {t.job_title && <span className="text-[10px] text-muted-foreground">{t.job_title}</span>}
                      </TableCell>
                      <TableCell className="font-mono">{t.total_hours}h</TableCell>
                      <TableCell className="font-mono text-emerald-400">{t.billable_hours}h</TableCell>
                      <TableCell className="font-mono text-muted-foreground">{t.non_billable_hours}h</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={t.utilization_pct} className={`h-2 w-20 ${t.utilization_pct < 50 ? "[&>div]:bg-red-500" : t.utilization_pct > 90 ? "[&>div]:bg-amber-500" : ""}`} />
                          <span className={`text-xs font-bold ${t.utilization_pct < 50 ? "text-red-400" : t.utilization_pct > 90 ? "text-amber-400" : "text-emerald-400"}`}>{t.utilization_pct}%</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-cyan-400">${t.revenue_generated.toLocaleString()}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{t.active_tickets}</Badge></TableCell>
                      <TableCell className="text-emerald-400">{t.resolved_tickets}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cards" className="mt-4">
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
            {techs.map((t, i) => (
              <Card key={t.user_id} className={`border-border/40 ${i === 0 ? "border-amber-500/30" : ""}`}>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm ${i === 0 ? "bg-gradient-to-br from-amber-500 to-orange-600" : "bg-gradient-to-br from-slate-600 to-slate-700"}`}>
                      {t.name?.charAt(0) || "?"}
                    </div>
                    <div>
                      <p className="font-semibold text-sm">{t.name}</p>
                      <p className="text-[10px] text-muted-foreground">{t.job_title || "Technician"} {t.hourly_rate ? `| $${t.hourly_rate}/hr` : ""}</p>
                    </div>
                    {i === 0 && <Badge className="ml-auto bg-amber-500/20 text-amber-400 text-[10px]">Top Performer</Badge>}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center mb-3">
                    <div className="p-2 rounded bg-muted/30"><p className="text-xs font-bold text-emerald-400">{t.billable_hours}h</p><p className="text-[9px] text-muted-foreground">Billable</p></div>
                    <div className="p-2 rounded bg-muted/30"><p className="text-xs font-bold">{t.total_hours}h</p><p className="text-[9px] text-muted-foreground">Total</p></div>
                    <div className="p-2 rounded bg-muted/30"><p className="text-xs font-bold text-cyan-400">${t.revenue_generated.toLocaleString()}</p><p className="text-[9px] text-muted-foreground">Revenue</p></div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Progress value={t.utilization_pct} className="flex-1 h-2" />
                    <span className="text-xs font-bold">{t.utilization_pct}%</span>
                  </div>
                  <div className="flex justify-between mt-2 text-[10px] text-muted-foreground">
                    <span>{t.active_tickets} active tickets</span><span>{t.resolved_tickets} resolved</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="alerts" className="mt-4 space-y-3">
          {underUtilized.length > 0 && (
            <Card className="border-red-500/20">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2 text-red-400"><AlertTriangle className="w-4 h-4" />Under-Utilized (&lt;50%)</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {underUtilized.map(t => (
                  <div key={t.user_id} className="flex items-center justify-between p-2 rounded-lg bg-red-500/5 border border-red-500/10">
                    <div><span className="font-medium text-sm">{t.name}</span><span className="text-xs text-muted-foreground ml-2">{t.billable_hours}h billable / {t.total_hours}h total</span></div>
                    <Badge className="bg-red-500/20 text-red-400">{t.utilization_pct}%</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          {overUtilized.length > 0 && (
            <Card className="border-amber-500/20">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2 text-amber-400"><Zap className="w-4 h-4" />Over-Utilized (&gt;90%) — Burnout Risk</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {overUtilized.map(t => (
                  <div key={t.user_id} className="flex items-center justify-between p-2 rounded-lg bg-amber-500/5 border border-amber-500/10">
                    <div><span className="font-medium text-sm">{t.name}</span><span className="text-xs text-muted-foreground ml-2">{t.billable_hours}h billable / {t.total_hours}h total</span></div>
                    <Badge className="bg-amber-500/20 text-amber-400">{t.utilization_pct}%</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          {underUtilized.length === 0 && overUtilized.length === 0 && (
            <Card className="border-emerald-500/20"><CardContent className="py-12 text-center">
              <CheckCircle className="w-12 h-12 mx-auto text-emerald-400/30 mb-3" />
              <p className="text-emerald-400 font-semibold">All technicians within healthy utilization range</p>
            </CardContent></Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
