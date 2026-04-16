import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Activity, AlertTriangle, HardDrive, Thermometer, Cpu, Database,
  RefreshCw, Loader2, Shield, Clock, Target, TrendingUp, Zap,
  CheckCircle, ChevronRight, Wrench
} from "lucide-react";

const RISK_CONFIG = {
  critical: { color: "text-red-400", bg: "bg-red-500/10 border-red-500/30", icon: AlertTriangle },
  high: { color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/30", icon: TrendingUp },
  medium: { color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/30", icon: Clock },
  low: { color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/30", icon: Shield },
};
const TYPE_ICONS = { disk_failure: HardDrive, hardware_failure: Cpu, battery_failure: Activity, memory_failure: Database, psu_failure: Thermometer, ssd_wear: HardDrive, nic_failure: Activity, cooling_failure: Thermometer };

export default function PredictiveFailurePage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [riskFilter, setRiskFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [tab, setTab] = useState("predictions");
  const [selected, setSelected] = useState(null);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/predictive-failure/overview`, { headers });
      setData(res.data);
    } catch { toast.error("Failed to load predictions"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading || !data) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const s = data.summary;
  const failureTypes = [...new Set(data.predictions.map(p => p.failure_type))];
  const filtered = data.predictions.filter(p => {
    if (riskFilter !== "all" && p.risk_level !== riskFilter) return false;
    if (typeFilter !== "all" && p.failure_type !== typeFilter) return false;
    return true;
  });

  const typeBreakdown = failureTypes.map(t => ({
    type: t,
    count: data.predictions.filter(p => p.failure_type === t).length,
    critical: data.predictions.filter(p => p.failure_type === t && p.risk_level === "critical").length,
  }));

  const urgentPredictions = data.predictions.filter(p => p.days_until_failure <= 7);
  const avgConfidence = Math.round(data.predictions.reduce((s, p) => s + (p.confidence_pct || 0), 0) / Math.max(data.predictions.length, 1));

  return (
    <div className="space-y-5" data-testid="predictive-failure-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-rose-500 to-red-700 flex items-center justify-center"><Activity className="w-5 h-5 text-white" /></div>
            Predictive Failure Detection
          </h1>
          <p className="text-muted-foreground mt-1">ML-powered hardware failure predictions from telemetry data</p>
        </div>
        <Button variant="outline" onClick={fetchData} data-testid="refresh-predictions"><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: "Predictions", value: s.total_predictions, icon: Target, color: "text-blue-400" },
          { label: "Critical Alerts", value: s.critical, icon: AlertTriangle, color: "text-red-400" },
          { label: "High Risk", value: s.high || 0, icon: TrendingUp, color: "text-orange-400" },
          { label: "Prevented", value: s.prevented_this_month, icon: Shield, color: "text-emerald-400", sub: "this month" },
          { label: "Model Accuracy", value: `${s.accuracy_pct}%`, icon: Zap, color: "text-purple-400" },
        ].map(st => (
          <Card key={st.label} className="border-border/40">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-1"><p className="text-xs text-muted-foreground uppercase tracking-wider">{st.label}</p><st.icon className={`w-4 h-4 ${st.color}`} /></div>
              <p className={`text-2xl font-bold ${st.color}`}>{st.value}</p>
              {st.sub && <p className="text-[10px] text-muted-foreground">{st.sub}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Urgent Alerts Banner */}
      {urgentPredictions.length > 0 && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3 mb-2">
              <AlertTriangle className="w-5 h-5 text-red-400 animate-pulse" />
              <span className="text-sm font-bold text-red-400">URGENT: {urgentPredictions.length} failure{urgentPredictions.length !== 1 ? "s" : ""} predicted within 7 days</span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {urgentPredictions.slice(0, 4).map(p => (
                <div key={p.id} className="p-2 rounded-lg bg-red-500/10 border border-red-500/20 cursor-pointer hover:bg-red-500/15 transition-colors" onClick={() => setSelected(p)}>
                  <p className="text-sm font-semibold truncate">{p.device_name}</p>
                  <p className="text-[10px] text-muted-foreground">{p.prediction}</p>
                  <p className="text-xs font-bold text-red-400 mt-1">{p.days_until_failure}d remaining</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="predictions">All Predictions</TabsTrigger>
          <TabsTrigger value="types">By Failure Type</TabsTrigger>
        </TabsList>

        <TabsContent value="predictions" className="mt-4 space-y-3">
          <div className="flex items-center gap-3">
            <Select value={riskFilter} onValueChange={setRiskFilter}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Risk</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {failureTypes.map(t => <SelectItem key={t} value={t} className="capitalize">{t.replace(/_/g, " ")}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {filtered.length === 0 ? (
            <Card className="border-dashed"><CardContent className="py-12 text-center"><Shield className="w-12 h-12 mx-auto text-muted-foreground/20 mb-3" /><p className="text-muted-foreground">No predictions match your filters</p></CardContent></Card>
          ) : filtered.map(p => {
            const rc = RISK_CONFIG[p.risk_level] || RISK_CONFIG.medium;
            const Icon = TYPE_ICONS[p.failure_type] || AlertTriangle;
            return (
              <Card key={p.id} className={`${rc.bg} border transition-all hover:shadow-md cursor-pointer`} onClick={() => setSelected(p)} data-testid={`prediction-${p.id}`}>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-lg bg-background/50 flex items-center justify-center border border-border/30">
                      <Icon className={`w-6 h-6 ${rc.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-sm">{p.prediction}</span>
                        <Badge variant="outline" className={`text-[10px] capitalize ${rc.color}`}>{p.risk_level}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{p.device_name} — {p.client_name}</p>
                      <div className="flex items-center gap-4 mt-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-muted-foreground">Confidence:</span>
                          <Progress value={p.confidence_pct} className="w-16 h-1.5" />
                          <span className="text-xs font-bold">{p.confidence_pct}%</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground">Data points: {p.data_points_analyzed?.toLocaleString()}</span>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className={`text-2xl font-black ${p.days_until_failure <= 7 ? "text-red-400" : p.days_until_failure <= 14 ? "text-orange-400" : "text-amber-400"}`}>{p.days_until_failure}d</div>
                      <p className="text-[10px] text-muted-foreground">until failure</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="types" className="mt-4">
          <div className="grid grid-cols-2 gap-4">
            {typeBreakdown.map(t => {
              const Icon = TYPE_ICONS[t.type] || AlertTriangle;
              return (
                <Card key={t.type} className="border-border/40">
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-lg bg-muted/50 flex items-center justify-center"><Icon className="w-5 h-5 text-muted-foreground" /></div>
                      <div>
                        <p className="font-semibold capitalize text-sm">{t.type.replace(/_/g, " ")}</p>
                        <p className="text-xs text-muted-foreground">{t.count} prediction{t.count !== 1 ? "s" : ""}</p>
                      </div>
                      {t.critical > 0 && <Badge variant="destructive" className="ml-auto text-[10px]">{t.critical} critical</Badge>}
                    </div>
                    <div className="space-y-1">
                      {data.predictions.filter(p => p.failure_type === t.type).map(p => (
                        <div key={p.id} className="flex items-center justify-between p-1.5 rounded bg-muted/20 text-xs cursor-pointer hover:bg-muted/40" onClick={() => setSelected(p)}>
                          <span className="truncate flex-1">{p.device_name}</span>
                          <span className={`font-bold ${p.days_until_failure <= 7 ? "text-red-400" : "text-amber-400"}`}>{p.days_until_failure}d</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      {/* Prediction Detail Dialog */}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-lg" aria-describedby="prediction-detail-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Activity className="w-5 h-5 text-red-400" />Prediction Detail</DialogTitle>
            <DialogDescription id="prediction-detail-desc">ML-powered failure prediction details</DialogDescription>
          </DialogHeader>
          {selected && (() => {
            const rc = RISK_CONFIG[selected.risk_level] || RISK_CONFIG.medium;
            const Icon = TYPE_ICONS[selected.failure_type] || AlertTriangle;
            return (
              <div className="space-y-4">
                <div className={`p-4 rounded-lg ${rc.bg} text-center`}>
                  <Icon className={`w-8 h-8 mx-auto ${rc.color} mb-2`} />
                  <p className={`text-3xl font-black ${rc.color}`}>{selected.days_until_failure} days</p>
                  <p className="text-xs text-muted-foreground">until predicted failure</p>
                </div>
                <Separator />
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-muted-foreground text-xs">Device</span><p className="font-medium">{selected.device_name}</p></div>
                  <div><span className="text-muted-foreground text-xs">Client</span><p className="font-medium">{selected.client_name}</p></div>
                  <div><span className="text-muted-foreground text-xs">Failure Type</span><p className="font-medium capitalize">{selected.failure_type?.replace(/_/g, " ")}</p></div>
                  <div><span className="text-muted-foreground text-xs">Risk Level</span><Badge className={`${rc.color} bg-transparent border capitalize`}>{selected.risk_level}</Badge></div>
                  <div><span className="text-muted-foreground text-xs">Confidence</span><div className="flex items-center gap-2"><Progress value={selected.confidence_pct} className="w-20 h-2" /><span className="font-bold">{selected.confidence_pct}%</span></div></div>
                  <div><span className="text-muted-foreground text-xs">Data Points</span><p className="font-medium">{selected.data_points_analyzed?.toLocaleString()}</p></div>
                </div>
                <Separator />
                <div className="p-3 rounded-lg bg-muted/30 border">
                  <p className="text-xs font-semibold text-muted-foreground mb-1 flex items-center gap-1"><Wrench className="w-3 h-3" />Recommended Action</p>
                  <p className="text-sm font-medium">{selected.recommended_action}</p>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
