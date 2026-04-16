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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Activity, AlertTriangle, HardDrive, Thermometer, Cpu, Database, MemoryStick,
  RefreshCw, Loader2, Shield, Clock, Target, TrendingUp, Zap, Server,
  CheckCircle, ChevronRight, Wrench, ArrowLeft
} from "lucide-react";

const RISK_CONFIG = {
  critical: { color: "text-red-400", bg: "bg-red-500/10 border-red-500/30", icon: AlertTriangle },
  high: { color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/30", icon: TrendingUp },
  medium: { color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/30", icon: Clock },
  low: { color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/30", icon: Shield },
};
const TYPE_ICONS = { disk_failure: HardDrive, hardware_failure: Cpu, battery_failure: Activity, memory_failure: Database, psu_failure: Thermometer, ssd_wear: HardDrive, nic_failure: Activity, cooling_failure: Thermometer };

function HealthGauge({ score }) {
  const color = score >= 70 ? "text-emerald-400" : score >= 40 ? "text-amber-400" : "text-red-400";
  return (
    <div className="text-center">
      <div className="relative w-24 h-24 mx-auto">
        <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" className="text-muted/20" strokeWidth="8" />
          <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" className={color} strokeWidth="8" strokeDasharray={`${score * 2.83} ${283 - score * 2.83}`} strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center"><span className={`text-2xl font-black ${color}`}>{score}</span></div>
      </div>
      <Badge className={`mt-2 ${score >= 70 ? "bg-emerald-500/20 text-emerald-400" : score >= 40 ? "bg-amber-500/20 text-amber-400" : "bg-red-500/20 text-red-400"}`}>
        {score >= 70 ? "Healthy" : score >= 40 ? "Warning" : "Critical"}
      </Badge>
    </div>
  );
}

export default function PredictiveIntelPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [tab, setTab] = useState("predictions");
  const [failureData, setFailureData] = useState(null);
  const [maintDash, setMaintDash] = useState(null);
  const [loading, setLoading] = useState(true);
  const [riskFilter, setRiskFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selected, setSelected] = useState(null);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [deviceData, setDeviceData] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [f, m] = await Promise.allSettled([
        axios.get(`${API}/predictive-failure/overview`, { headers }),
        axios.get(`${API}/predictive/dashboard`, { headers }),
      ]);
      if (f.status === "fulfilled") setFailureData(f.value.data);
      if (m.status === "fulfilled") setMaintDash(m.value.data);
    } catch { toast.error("Failed to load"); }
    finally { setLoading(false); }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData(); }, [fetchData]);

  const analyzeDevice = async (deviceId) => {
    setAnalyzing(true);
    try {
      const res = await axios.post(`${API}/predictive/analyze/${deviceId}`, {}, { headers });
      setDeviceData(res.data);
      setSelectedDevice(deviceId);
      fetchData();
    } catch { toast.error("Analysis failed"); }
    finally { setAnalyzing(false); }
  };

  const analyzeAll = async () => {
    setAnalyzing(true);
    try {
      const res = await axios.post(`${API}/predictive/analyze-all`, {}, { headers });
      toast.success(`Analyzed ${res.data.analyzed} devices`);
      fetchData();
    } catch { toast.error("Batch analysis failed"); }
    finally { setAnalyzing(false); }
  };

  const resolveAlert = async (alertId) => {
    try { await axios.put(`${API}/predictive/alert/${alertId}/resolve`, {}, { headers }); toast.success("Alert resolved"); fetchData(); } catch { toast.error("Failed"); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  // Device detail view
  if (selectedDevice && deviceData) {
    const t = deviceData.telemetry || {};
    return (
      <div className="space-y-5" data-testid="device-prediction-detail">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => { setSelectedDevice(null); setDeviceData(null); }}><ArrowLeft className="w-4 h-4 mr-1" />Back</Button>
          <Server className="w-5 h-5 text-blue-400" />
          <div><h2 className="text-xl font-bold">{deviceData.device_name || "Device"}</h2><p className="text-sm text-muted-foreground">{deviceData.client_name}</p></div>
        </div>
        <div className="grid grid-cols-4 gap-4">
          <Card className="col-span-1"><CardContent className="pt-6"><HealthGauge score={deviceData.health_score || 0} /></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><Cpu className="w-6 h-6 mx-auto text-blue-400 mb-1" /><p className="text-2xl font-black">{t.cpu_usage || 0}%</p><p className="text-[10px] text-muted-foreground">CPU</p><Progress value={t.cpu_usage || 0} className="h-1 mt-2" /></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><MemoryStick className="w-6 h-6 mx-auto text-purple-400 mb-1" /><p className="text-2xl font-black">{t.memory_usage || 0}%</p><p className="text-[10px] text-muted-foreground">Memory</p><Progress value={t.memory_usage || 0} className="h-1 mt-2" /></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><HardDrive className="w-6 h-6 mx-auto text-amber-400 mb-1" /><p className="text-2xl font-black">{t.disk_usage || 0}%</p><p className="text-[10px] text-muted-foreground">Disk</p><Progress value={t.disk_usage || 0} className="h-1 mt-2" /></CardContent></Card>
        </div>
        {(deviceData.predictions || []).length > 0 && (
          <Card className="border-amber-500/20">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-amber-400 flex items-center gap-2"><AlertTriangle className="w-4 h-4" />Predicted Issues ({deviceData.predictions.length})</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {deviceData.predictions.map((p, i) => (
                <div key={`k-${i}`} className={`p-3 rounded-lg border ${p.severity === "critical" ? "bg-red-500/5 border-red-500/20" : p.severity === "high" ? "bg-amber-500/5 border-amber-500/20" : "bg-muted/20 border-border/30"}`}>
                  <div className="flex items-start justify-between">
                    <div><p className="font-medium text-sm">{p.component}</p><p className="text-xs text-muted-foreground mt-0.5">{p.description}</p><p className="text-xs mt-1"><span className="text-muted-foreground">Recommendation: </span>{p.recommendation}</p></div>
                    <Badge className={`${p.severity === "critical" ? "bg-red-500/20 text-red-400" : p.severity === "high" ? "bg-amber-500/20 text-amber-400" : "bg-blue-500/20 text-blue-400"} text-[10px]`}>{p.severity}</Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  const fs = failureData?.summary || {};
  const d = maintDash || {};
  const failureTypes = failureData ? [...new Set(failureData.predictions.map(p => p.failure_type))] : [];
  const filtered = failureData ? failureData.predictions.filter(p => (riskFilter === "all" || p.risk_level === riskFilter) && (typeFilter === "all" || p.failure_type === typeFilter)) : [];
  const urgentPredictions = failureData ? failureData.predictions.filter(p => p.days_until_failure <= 7) : [];

  return (
    <div className="space-y-5" data-testid="predictive-intel-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-rose-500 to-red-700 flex items-center justify-center"><Activity className="w-5 h-5 text-white" /></div>
            Predictive Intelligence
          </h1>
          <p className="text-muted-foreground mt-1">ML-powered failure predictions and proactive device health monitoring</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button>
          <Button onClick={analyzeAll} disabled={analyzing}>{analyzing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Zap className="w-4 h-4 mr-1" />}Analyze All</Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="predictions" data-testid="tab-predictions">Failure Predictions</TabsTrigger>
          <TabsTrigger value="monitoring" data-testid="tab-monitoring">Device Monitoring</TabsTrigger>
        </TabsList>

        <TabsContent value="predictions" className="mt-4 space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-5 gap-3">
            {[
              { label: "Predictions", value: fs.total_predictions || 0, icon: Target, color: "text-blue-400" },
              { label: "Critical Alerts", value: fs.critical || 0, icon: AlertTriangle, color: "text-red-400" },
              { label: "High Risk", value: fs.high || 0, icon: TrendingUp, color: "text-orange-400" },
              { label: "Prevented", value: fs.prevented_this_month || 0, icon: Shield, color: "text-emerald-400" },
              { label: "Model Accuracy", value: `${fs.accuracy_pct || 0}%`, icon: Zap, color: "text-purple-400" },
            ].map(st => (
              <Card key={st.label} className="border-border/40"><CardContent className="pt-4 pb-3"><div className="flex items-center justify-between mb-1"><p className="text-xs text-muted-foreground uppercase tracking-wider">{st.label}</p><st.icon className={`w-4 h-4 ${st.color}`} /></div><p className={`text-2xl font-bold ${st.color}`}>{st.value}</p></CardContent></Card>
            ))}
          </div>

          {urgentPredictions.length > 0 && (
            <Card className="border-red-500/30 bg-red-500/5"><CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-3 mb-2"><AlertTriangle className="w-5 h-5 text-red-400 animate-pulse" /><span className="text-sm font-bold text-red-400">URGENT: {urgentPredictions.length} failure{urgentPredictions.length !== 1 ? "s" : ""} predicted within 7 days</span></div>
              <div className="grid grid-cols-4 gap-2">
                {urgentPredictions.slice(0, 4).map(p => (
                  <div key={p.id} className="p-2 rounded-lg bg-red-500/10 border border-red-500/20 cursor-pointer hover:bg-red-500/15" onClick={() => setSelected(p)}><p className="text-sm font-semibold truncate">{p.device_name}</p><p className="text-[10px] text-muted-foreground">{p.prediction}</p><p className="text-xs font-bold text-red-400 mt-1">{p.days_until_failure}d remaining</p></div>
                ))}
              </div>
            </CardContent></Card>
          )}

          <div className="flex items-center gap-3">
            <Select value={riskFilter} onValueChange={setRiskFilter}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Risk</SelectItem><SelectItem value="critical">Critical</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem></SelectContent></Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Types</SelectItem>{failureTypes.map(t => <SelectItem key={t} value={t} className="capitalize">{t.replace(/_/g, " ")}</SelectItem>)}</SelectContent></Select>
          </div>

          {filtered.length === 0 ? (
            <Card className="border-dashed"><CardContent className="py-12 text-center"><Shield className="w-12 h-12 mx-auto text-muted-foreground/20 mb-3" /><p className="text-muted-foreground">No predictions match filters</p></CardContent></Card>
          ) : filtered.map(p => {
            const rc = RISK_CONFIG[p.risk_level] || RISK_CONFIG.medium;
            const Icon = TYPE_ICONS[p.failure_type] || AlertTriangle;
            return (
              <Card key={p.id} className={`${rc.bg} border transition-all hover:shadow-md cursor-pointer`} onClick={() => setSelected(p)}>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-lg bg-background/50 flex items-center justify-center border border-border/30"><Icon className={`w-6 h-6 ${rc.color}`} /></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1"><span className="font-semibold text-sm">{p.prediction}</span><Badge variant="outline" className={`text-[10px] capitalize ${rc.color}`}>{p.risk_level}</Badge></div>
                      <p className="text-xs text-muted-foreground">{p.device_name} — {p.client_name}</p>
                      <div className="flex items-center gap-4 mt-2"><div className="flex items-center gap-1.5"><span className="text-[10px] text-muted-foreground">Confidence:</span><Progress value={p.confidence_pct} className="w-16 h-1.5" /><span className="text-xs font-bold">{p.confidence_pct}%</span></div></div>
                    </div>
                    <div className="text-right flex-shrink-0"><div className={`text-2xl font-black ${p.days_until_failure <= 7 ? "text-red-400" : p.days_until_failure <= 14 ? "text-orange-400" : "text-amber-400"}`}>{p.days_until_failure}d</div><p className="text-[10px] text-muted-foreground">until failure</p></div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="monitoring" className="mt-4 space-y-4">
          <div className="grid grid-cols-4 gap-3">
            <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center"><AlertTriangle className="w-5 h-5 text-red-400" /></div><div><p className="text-xs text-muted-foreground">Active Alerts</p><p className="text-xl font-bold text-red-400">{d.active_alerts || 0}</p></div></div></CardContent></Card>
            <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center"><Shield className="w-5 h-5 text-amber-400" /></div><div><p className="text-xs text-muted-foreground">Critical Devices</p><p className="text-xl font-bold text-amber-400">{d.critical_devices || 0}</p></div></div></CardContent></Card>
            <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center"><CheckCircle className="w-5 h-5 text-emerald-400" /></div><div><p className="text-xs text-muted-foreground">Resolved</p><p className="text-xl font-bold">{d.resolved_alerts || 0}</p></div></div></CardContent></Card>
            <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center"><Server className="w-5 h-5 text-blue-400" /></div><div><p className="text-xs text-muted-foreground">Monitored</p><p className="text-xl font-bold">{d.total_monitored || 0}</p></div></div></CardContent></Card>
          </div>

          <Card className="border-red-500/20">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-red-400 flex items-center gap-2"><AlertTriangle className="w-4 h-4" />Active Alerts</CardTitle></CardHeader>
            <CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Device</TableHead><TableHead>Client</TableHead><TableHead>Issue</TableHead><TableHead>Severity</TableHead><TableHead>Recommendation</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>{(d.alerts || []).length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8"><CheckCircle className="w-8 h-8 mx-auto text-emerald-400 mb-2" /><p className="text-muted-foreground">No active alerts</p></TableCell></TableRow>
              ) : (d.alerts || []).map(a => (
                <TableRow key={a.id}><TableCell className="font-medium">{a.device_name}</TableCell><TableCell className="text-sm text-muted-foreground">{a.client_name}</TableCell><TableCell className="text-sm max-w-[200px] truncate">{a.description}</TableCell><TableCell><Badge className={`${a.severity === "critical" ? "bg-red-500/20 text-red-400" : "bg-amber-500/20 text-amber-400"} text-[10px]`}>{a.severity}</Badge></TableCell><TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{a.recommendation}</TableCell>
                  <TableCell><div className="flex gap-1"><Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => analyzeDevice(a.device_id)}>View</Button><Button variant="ghost" size="sm" className="h-7 text-xs text-emerald-400" onClick={() => resolveAlert(a.id)}>Resolve</Button></div></TableCell></TableRow>
              ))}</TableBody></Table></CardContent>
          </Card>

          {(d.at_risk_devices || []).length > 0 && (
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Shield className="w-4 h-4 text-amber-400" />At-Risk Devices</CardTitle></CardHeader>
              <CardContent className="space-y-2">{d.at_risk_devices.map(dev => (
                <div key={dev.device_id} className="flex items-center justify-between p-3 rounded-lg bg-muted/20 border border-border/30 cursor-pointer hover:bg-muted/30" onClick={() => analyzeDevice(dev.device_id)}>
                  <div className="flex items-center gap-3"><div className={`w-10 h-10 rounded-lg flex items-center justify-center ${dev.health_score < 30 ? "bg-red-500/10" : "bg-amber-500/10"}`}><span className={`text-lg font-black ${dev.health_score < 30 ? "text-red-400" : "text-amber-400"}`}>{dev.health_score}</span></div><div><p className="font-medium text-sm">{dev.device_name}</p><p className="text-xs text-muted-foreground">{dev.client_name}</p></div></div>
                  <Badge className={dev.health_score < 30 ? "bg-red-500/20 text-red-400" : "bg-amber-500/20 text-amber-400"}>{dev.status}</Badge>
                </div>
              ))}</CardContent></Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Prediction Detail Dialog */}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-lg" aria-describedby="pred-detail-desc">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Activity className="w-5 h-5 text-red-400" />Prediction Detail</DialogTitle><DialogDescription id="pred-detail-desc">ML-powered failure prediction details</DialogDescription></DialogHeader>
          {selected && (() => {
            const rc = RISK_CONFIG[selected.risk_level] || RISK_CONFIG.medium;
            const Icon = TYPE_ICONS[selected.failure_type] || AlertTriangle;
            return (
              <div className="space-y-4">
                <div className={`p-4 rounded-lg ${rc.bg} text-center`}><Icon className={`w-8 h-8 mx-auto ${rc.color} mb-2`} /><p className={`text-3xl font-black ${rc.color}`}>{selected.days_until_failure} days</p><p className="text-xs text-muted-foreground">until predicted failure</p></div>
                <Separator />
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-muted-foreground text-xs">Device</span><p className="font-medium">{selected.device_name}</p></div>
                  <div><span className="text-muted-foreground text-xs">Client</span><p className="font-medium">{selected.client_name}</p></div>
                  <div><span className="text-muted-foreground text-xs">Failure Type</span><p className="font-medium capitalize">{selected.failure_type?.replace(/_/g, " ")}</p></div>
                  <div><span className="text-muted-foreground text-xs">Confidence</span><div className="flex items-center gap-2"><Progress value={selected.confidence_pct} className="w-20 h-2" /><span className="font-bold">{selected.confidence_pct}%</span></div></div>
                </div>
                <Separator />
                <div className="p-3 rounded-lg bg-muted/30 border"><p className="text-xs font-semibold text-muted-foreground mb-1 flex items-center gap-1"><Wrench className="w-3 h-3" />Recommended Action</p><p className="text-sm font-medium">{selected.recommended_action}</p></div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
