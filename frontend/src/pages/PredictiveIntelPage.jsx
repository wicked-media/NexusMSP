import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Activity, AlertTriangle, ArrowLeft, CheckCircle2, ChevronRight, Cpu, HardDrive,
  Loader2, MemoryStick, RefreshCw, Server, ShieldCheck, Target, Thermometer, TrendingUp, Zap,
} from "lucide-react";

const RISK_CONFIG = {
  critical: { color: "text-red-400", bg: "bg-red-500/10 border-red-500/30" },
  high: { color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/30" },
  medium: { color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/30" },
  low: { color: "text-sky-400", bg: "bg-sky-500/10 border-sky-500/30" },
};

const TYPE_ICONS = {
  disk_capacity: HardDrive,
  disk_failure: HardDrive,
  cpu_pressure: Cpu,
  hardware_failure: Cpu,
  memory_pressure: MemoryStick,
  memory_failure: MemoryStick,
  thermal: Thermometer,
  cooling_failure: Thermometer,
};

const isNumber = (value) => Number.isFinite(value);
const metric = (value) => (isNumber(value) ? `${value}%` : "—");

function MetricTile({ icon: Icon, label, value, tone = "sky" }) {
  const tones = {
    sky: "bg-sky-500/10 text-sky-300",
    amber: "bg-amber-500/10 text-amber-300",
    red: "bg-red-500/10 text-red-300",
    emerald: "bg-emerald-500/10 text-emerald-300",
  };
  return (
    <Card className="border-border/60 bg-card/80 shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div><p className="text-[11px] font-medium uppercase tracking-[0.13em] text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p></div>
          <div className={`rounded-xl p-2 ${tones[tone]}`}><Icon className="h-4 w-4" /></div>
        </div>
      </CardContent>
    </Card>
  );
}

function HealthGauge({ score }) {
  const assessed = isNumber(score);
  const value = assessed ? score : 0;
  const tone = !assessed ? "text-muted-foreground" : score >= 70 ? "text-emerald-400" : score >= 40 ? "text-amber-400" : "text-red-400";
  const label = !assessed ? "Not assessed" : score >= 70 ? "Healthy" : score >= 40 ? "Warning" : "Critical";
  return (
    <div className="text-center">
      <div className="relative mx-auto h-24 w-24">
        <svg className="h-24 w-24 -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" className="text-muted/20" strokeWidth="8" />
          <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" className={tone} strokeWidth="8" strokeDasharray={`${value * 2.83} ${283 - value * 2.83}`} strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center"><span className={`text-2xl font-semibold ${tone}`}>{assessed ? score : "—"}</span></div>
      </div>
      <Badge className={`mt-2 ${assessed ? "bg-muted text-foreground" : "bg-muted text-muted-foreground"}`}>{label}</Badge>
    </div>
  );
}

export default function PredictiveIntelPage({ embedded = false }) {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [tab, setTab] = useState("forecasts");
  const [failureData, setFailureData] = useState(null);
  const [monitoring, setMonitoring] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [assessing, setAssessing] = useState(false);
  const [riskFilter, setRiskFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedForecast, setSelectedForecast] = useState(null);
  const [deviceData, setDeviceData] = useState(null);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    try {
      const [forecasts, health] = await Promise.all([
        axios.get(`${API}/predictive-failure/overview`, { headers }),
        axios.get(`${API}/predictive/dashboard`, { headers }),
      ]);
      setFailureData(forecasts.data);
      setMonitoring(health.data);
    } catch {
      toast.error("Predictive Intelligence could not be refreshed.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const assessDevice = async (deviceId) => {
    setAssessing(true);
    try {
      const response = await axios.post(`${API}/predictive/analyze/${deviceId}`, {}, { headers });
      setDeviceData(response.data);
      if (response.data.evidence_state !== "assessed") toast.message("Assessment is pending an agent telemetry check-in.");
      await load(true);
    } catch {
      toast.error("The device assessment could not be completed.");
    } finally {
      setAssessing(false);
    }
  };

  const assessAll = async () => {
    setAssessing(true);
    try {
      const response = await axios.post(`${API}/predictive/analyze-all`, {}, { headers });
      const { analyzed, not_assessed } = response.data;
      if (analyzed) toast.success(`Assessed ${analyzed} enrolled device${analyzed === 1 ? "" : "s"}.`);
      else toast.message("No endpoints have enough agent telemetry to assess yet.");
      if (not_assessed) toast.message(`${not_assessed} endpoint${not_assessed === 1 ? " is" : "s are"} awaiting telemetry.`);
      await load(true);
    } catch {
      toast.error("The batch assessment could not be completed.");
    } finally {
      setAssessing(false);
    }
  };

  const resolveAlert = async (alertId) => {
    try {
      await axios.put(`${API}/predictive/alert/${alertId}/resolve`, {}, { headers });
      toast.success("Condition alert resolved and recorded.");
      await load(true);
    } catch {
      toast.error("The alert could not be resolved.");
    }
  };

  const predictions = useMemo(() => failureData?.predictions || [], [failureData]);
  const forecastTypes = useMemo(() => [...new Set(predictions.map((item) => item.failure_type).filter(Boolean))], [predictions]);
  const filteredForecasts = useMemo(() => predictions.filter((item) => (
    (riskFilter === "all" || item.risk_level === riskFilter)
    && (typeFilter === "all" || item.failure_type === typeFilter)
  )), [predictions, riskFilter, typeFilter]);
  const urgentForecasts = useMemo(() => predictions.filter((item) => isNumber(item.days_until_failure) && item.days_until_failure <= 7), [predictions]);
  const summary = failureData?.summary || {};
  const dash = monitoring || {};

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /></div>;

  if (deviceData) {
    const telemetry = deviceData.telemetry || {};
    return (
      <div className="space-y-5" data-testid="device-prediction-detail">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => setDeviceData(null)}><ArrowLeft className="mr-1 h-4 w-4" />Back to Predictive Intelligence</Button>
          {assessing && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        <OperationalPageHeader eyebrow="Device condition assessment" title={deviceData.device_name || "Managed endpoint"} description={deviceData.message || "Current observed telemetry condition."} icon={Activity} tone="sky" />
        <div className="grid gap-3 md:grid-cols-4">
          <Card className="border-border/60"><CardContent className="p-5"><HealthGauge score={deviceData.health_score} /></CardContent></Card>
          <MetricTile icon={Cpu} label="Observed CPU" value={metric(telemetry.cpu_usage)} />
          <MetricTile icon={MemoryStick} label="Observed memory" value={metric(telemetry.memory_usage)} tone="amber" />
          <MetricTile icon={HardDrive} label="Observed disk" value={metric(telemetry.disk_usage)} tone="red" />
        </div>
        {deviceData.evidence_state !== "assessed" && <Card className="border-dashed"><CardContent className="p-5 text-sm text-muted-foreground"><span className="font-medium text-foreground">Assessment pending.</span> {deviceData.message || "The endpoint needs a trusted agent check-in with CPU, memory, disk, or temperature telemetry."}</CardContent></Card>}
        {(deviceData.predictions || []).length > 0 && <Card className="border-amber-500/20"><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><AlertTriangle className="h-4 w-4 text-amber-400" />Observed threshold conditions</CardTitle></CardHeader><CardContent className="space-y-2">
          {deviceData.predictions.map((condition, index) => <div key={`${condition.type}-${index}`} className="rounded-xl border border-border/60 bg-muted/20 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{condition.component}</p><p className="mt-1 text-sm text-muted-foreground">{condition.description}</p><p className="mt-2 text-xs text-muted-foreground"><span className="font-medium text-foreground">Recommended next step:</span> {condition.recommendation}</p></div><Badge variant="outline" className="capitalize">{condition.severity}</Badge></div></div>)}
        </CardContent></Card>}
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="predictive-intel-page">
      {!embedded && <OperationalPageHeader eyebrow="Managed assets - condition intelligence" title="Predictive Intelligence" description="NexusMSP evaluates current agent-reported thresholds. Failure forecasts, accuracy, and prevention results only appear when a validated provider supplies attributable historical evidence." icon={Activity} tone="sky" actions={<><Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing}><RefreshCw className={`mr-1 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />Refresh</Button><Button size="sm" onClick={assessAll} disabled={assessing}>{assessing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Zap className="mr-1 h-4 w-4" />}Assess enrolled devices</Button></>} />}
      {embedded && <div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing}><RefreshCw className={`mr-1 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />Refresh</Button><Button size="sm" onClick={assessAll} disabled={assessing}>{assessing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Zap className="mr-1 h-4 w-4" />}Assess enrolled devices</Button></div>}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList><TabsTrigger value="forecasts">Provider forecasts</TabsTrigger><TabsTrigger value="monitoring">Device monitoring</TabsTrigger></TabsList>

        <TabsContent value="forecasts" className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <MetricTile icon={Target} label="Provider forecasts" value={summary.total_predictions || 0} />
            <MetricTile icon={AlertTriangle} label="Critical forecasts" value={summary.critical || 0} tone="red" />
            <MetricTile icon={TrendingUp} label="High risk" value={summary.high || 0} tone="amber" />
            <MetricTile icon={ShieldCheck} label="Verified prevention" value={summary.prevented_this_month ?? "—"} tone="emerald" />
            <MetricTile icon={Zap} label="Validated accuracy" value={isNumber(summary.accuracy_pct) ? `${summary.accuracy_pct}%` : "—"} tone="emerald" />
          </div>
          {urgentForecasts.length > 0 && <Card className="border-red-500/30 bg-red-500/5"><CardContent className="p-4"><div className="flex items-center gap-2 text-sm font-semibold text-red-300"><AlertTriangle className="h-4 w-4" />{urgentForecasts.length} provider forecast{urgentForecasts.length === 1 ? "" : "s"} due within seven days</div></CardContent></Card>}
          <div className="flex flex-wrap gap-2"><Select value={riskFilter} onValueChange={setRiskFilter}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All risk</SelectItem><SelectItem value="critical">Critical</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem></SelectContent></Select><Select value={typeFilter} onValueChange={setTypeFilter}><SelectTrigger className="w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All forecast types</SelectItem>{forecastTypes.map((type) => <SelectItem key={type} value={type}>{type.replace(/_/g, " ")}</SelectItem>)}</SelectContent></Select></div>
          {!filteredForecasts.length ? <Card className="border-dashed"><CardContent className="p-10 text-center"><ShieldCheck className="mx-auto h-10 w-10 text-muted-foreground/30" /><p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">{failureData?.message || "No provider-backed forecasts match the selected filters."}</p></CardContent></Card> : filteredForecasts.map((forecast) => {
            const config = RISK_CONFIG[forecast.risk_level] || RISK_CONFIG.medium;
            const Icon = TYPE_ICONS[forecast.failure_type] || Activity;
            return <Card key={forecast.id} className={`cursor-pointer border ${config.bg} transition hover:brightness-110`} onClick={() => setSelectedForecast(forecast)}><CardContent className="flex items-center gap-4 p-4"><div className="rounded-xl border border-border/60 bg-background/60 p-3"><Icon className={`h-5 w-5 ${config.color}`} /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{forecast.prediction}</p><Badge variant="outline" className={`capitalize ${config.color}`}>{forecast.risk_level}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{forecast.device_name} · {forecast.client_name}</p>{isNumber(forecast.confidence_pct) && <p className="mt-2 text-xs text-muted-foreground">Provider confidence: <span className="font-medium text-foreground">{forecast.confidence_pct}%</span></p>}</div><div className="text-right"><p className={`text-xl font-semibold ${config.color}`}>{isNumber(forecast.days_until_failure) ? `${forecast.days_until_failure}d` : "—"}</p><p className="text-[11px] text-muted-foreground">forecast window</p></div><ChevronRight className="h-4 w-4 text-muted-foreground" /></CardContent></Card>;
          })}
        </TabsContent>

        <TabsContent value="monitoring" className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><MetricTile icon={AlertTriangle} label="Active conditions" value={dash.active_alerts || 0} tone="red" /><MetricTile icon={Activity} label="Critical endpoints" value={dash.critical_devices || 0} tone="amber" /><MetricTile icon={CheckCircle2} label="Resolved conditions" value={dash.resolved_alerts || 0} tone="emerald" /><MetricTile icon={Server} label="Agent-assessed endpoints" value={dash.total_monitored || 0} /></div>
          <Card className="border-border/60"><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Activity className="h-4 w-4 text-sky-300" />Active agent-backed conditions</CardTitle></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Device</TableHead><TableHead>Client</TableHead><TableHead>Observed condition</TableHead><TableHead>Severity</TableHead><TableHead>Next step</TableHead><TableHead /></TableRow></TableHeader><TableBody>{!(dash.alerts || []).length ? <TableRow><TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">No active agent-backed threshold conditions.</TableCell></TableRow> : dash.alerts.map((alert) => <TableRow key={alert.id}><TableCell className="font-medium">{alert.device_name}</TableCell><TableCell>{alert.client_name || "—"}</TableCell><TableCell className="max-w-64 truncate">{alert.description}</TableCell><TableCell><Badge variant="outline" className="capitalize">{alert.severity}</Badge></TableCell><TableCell className="max-w-64 truncate text-muted-foreground">{alert.recommendation}</TableCell><TableCell><div className="flex justify-end gap-1"><Button variant="outline" size="sm" onClick={() => assessDevice(alert.device_id)}>Assess</Button><Button variant="ghost" size="sm" onClick={() => resolveAlert(alert.id)}>Resolve</Button></div></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
          {(dash.at_risk_devices || []).length > 0 && <Card className="border-border/60"><CardHeader className="pb-2"><CardTitle className="text-sm">Endpoints requiring attention</CardTitle></CardHeader><CardContent className="space-y-2">{dash.at_risk_devices.map((device) => <button type="button" key={device.device_id} onClick={() => assessDevice(device.device_id)} className="flex w-full items-center justify-between rounded-xl border border-border/60 bg-muted/20 p-3 text-left transition hover:bg-muted/35"><div><p className="font-medium">{device.device_name}</p><p className="text-xs text-muted-foreground">{device.client_name || "Unassigned client"}</p></div><div className="text-right"><p className="font-semibold">{device.health_score}</p><p className="text-[11px] text-muted-foreground">health score</p></div></button>)}</CardContent></Card>}
          {dash.evidence_state === "not_assessed" && <Card className="border-dashed"><CardContent className="p-5 text-sm text-muted-foreground">{dash.message || "Connect the Nexus Agent and wait for a telemetry check-in to begin device condition assessments."}</CardContent></Card>}
        </TabsContent>
      </Tabs>

      <Dialog open={!!selectedForecast} onOpenChange={(open) => !open && setSelectedForecast(null)}>
        <DialogContent className="max-w-lg"><DialogHeader><DialogTitle className="flex items-center gap-2"><Target className="h-5 w-5 text-sky-300" />Provider forecast detail</DialogTitle><DialogDescription>Forecast data supplied by the recorded provider source.</DialogDescription></DialogHeader>{selectedForecast && <div className="space-y-4 text-sm"><div className="rounded-xl border border-border/60 bg-muted/30 p-4"><p className="font-medium">{selectedForecast.prediction}</p><p className="mt-2 text-muted-foreground">{selectedForecast.device_name} · {selectedForecast.client_name}</p></div><div className="grid grid-cols-2 gap-3"><div><p className="text-xs text-muted-foreground">Forecast window</p><p className="font-medium">{isNumber(selectedForecast.days_until_failure) ? `${selectedForecast.days_until_failure} days` : "Not supplied"}</p></div><div><p className="text-xs text-muted-foreground">Provider confidence</p><p className="font-medium">{isNumber(selectedForecast.confidence_pct) ? `${selectedForecast.confidence_pct}%` : "Not supplied"}</p></div></div><div><p className="text-xs text-muted-foreground">Recommended action</p><p className="mt-1 font-medium">{selectedForecast.recommended_action || "Review the provider evidence and schedule the appropriate technician action."}</p></div></div>}</DialogContent>
      </Dialog>
    </div>
  );
}
