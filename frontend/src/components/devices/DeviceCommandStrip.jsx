/**
 * Fleet health summary and actionable attention queue for Managed Assets.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { AlertTriangle, ChevronRight, Download, HardDrive, Inbox, Loader2, RefreshCw, Wifi, WifiOff, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricStrip, MetricTile } from "@/components/design-system";

const SEV_TONE = {
  critical: "border-rose-500/30 bg-rose-500/5 text-rose-300",
  warning: "border-amber-500/30 bg-amber-500/5 text-amber-300",
  info: "border-cyan-500/30 bg-cyan-500/5 text-cyan-300",
};

const KIND_ICON = {
  failing_checks: AlertTriangle,
  offline_long: WifiOff,
  disk_low: HardDrive,
  patches_pending: Download,
};

function numericSignal(device, ...keys) {
  for (const key of keys) {
    const value = Number(device?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function isAtRisk(device) {
  const status = String(device?.status || "").toLowerCase();
  return ["warning", "critical", "needs_attention", "degraded"].includes(status)
    || numericSignal(device, "cpu_usage", "cpu_load") >= 90
    || numericSignal(device, "memory_usage", "memory_pct") >= 90
    || numericSignal(device, "disk_usage", "disk_pct") >= 90
    || numericSignal(device, "checks_failing") > 0;
}

function formatOperationalDuration(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value < 60) return `${Math.round(value)}m`;
  const totalHours = Math.round(value / 60);
  if (totalHours < 24) return `${totalHours}h`;
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours ? `${days}d ${hours}h` : `${days}d`;
}

export default function DeviceCommandStrip({ headers, API, devices = [], telemetry = {} }) {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [inbox, setInbox] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statsResponse, inboxResponse] = await Promise.all([
        axios.get(`${API}/devices/intel/stats`, { headers }),
        axios.get(`${API}/devices/smart-inbox`, { headers }),
      ]);
      setStats(statsResponse.data);
      setInbox(inboxResponse.data.items || []);
    } catch {
      // The page remains usable when a supplementary fleet insight is unavailable.
    } finally {
      setLoading(false);
    }
  }, [API, headers]);

  useEffect(() => { load(); }, [load]);

  // The command strip must describe the exact fleet shown below it. The
  // server summary remains useful for MTTR, but device counts are derived from
  // the same scoped list that powers the directory to prevent stale or mixed
  // signal aliases from making the two views disagree.
  const fleet = useMemo(() => {
    const scopedDevices = Array.isArray(devices) ? devices : [];
    return {
      online: scopedDevices.filter(device => device.status === "online").length,
      offline: scopedDevices.filter(device => device.status === "offline").length,
      atRisk: scopedDevices.filter(isAtRisk).length,
      patchesPending: scopedDevices.reduce((total, device) => total + numericSignal(device, "pending_patches", "patches_pending"), 0),
      diskAtRisk: scopedDevices.filter(device => numericSignal(device, "disk_usage", "disk_pct") >= 90).length,
    };
  }, [devices]);
  const currentTelemetry = Number(telemetry.current || 0);
  const needsCheckIn = Number(telemetry.stale || 0) + Number(telemetry.awaitingTelemetry || 0);

  return (
    <div className="space-y-3" data-testid="device-command-strip">
      <section className="nx-fleet-telemetry" aria-label="Fleet telemetry summary">
        <div className="nx-fleet-telemetry__head">
          <div><Wifi className="h-4 w-4" /><p>Fleet telemetry</p><span>Truthful evidence from the managed fleet</span></div>
          <small>{currentTelemetry} current · {needsCheckIn} need check-in</small>
        </div>
        <div className="nx-fleet-telemetry__metrics">
          <MetricStrip columns={6}>
            <MetricTile label="Fresh" value={currentTelemetry} accent={currentTelemetry ? "emerald" : "amber"} icon={<Wifi className="h-2.5 w-2.5 text-emerald-400" />} testid="dev-tile-online" />
            <MetricTile label="Needs check-in" value={needsCheckIn} accent={needsCheckIn ? "amber" : "slate"} icon={<WifiOff className="h-2.5 w-2.5 text-amber-400" />} testid="dev-tile-offline" />
            <MetricTile label="At Risk" value={fleet.atRisk} accent={fleet.atRisk ? "amber" : "slate"} icon={<AlertTriangle className="h-2.5 w-2.5 text-amber-400" />} testid="dev-tile-warning" />
            <MetricTile label="Patches" value={fleet.patchesPending} accent="cyan" icon={<Download className="h-2.5 w-2.5 text-cyan-400" />} testid="dev-tile-patches" />
            <MetricTile label="Disk risk" value={fleet.diskAtRisk} accent={fleet.diskAtRisk ? "rose" : "emerald"} icon={<HardDrive className="h-2.5 w-2.5 text-rose-400" />} testid="dev-tile-disk" />
            <MetricTile label="MTTR · 30d" value={formatOperationalDuration(stats?.mttr_30d_minutes)} accent="sky" icon={<Zap className="h-2.5 w-2.5 text-sky-400" />} testid="dev-tile-mttr" />
          </MetricStrip>
        </div>
      </section>

      <Card className="nx-fleet-priority-queue border-cyan-500/20 bg-gradient-to-br from-card via-card to-cyan-500/[0.04]" data-testid="device-smart-inbox">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Inbox className="h-4 w-4 text-cyan-300" />
            Needs Attention
            <Badge variant="outline" className="text-[9px] uppercase">{inbox.length}</Badge>
          </CardTitle>
          <Button variant="ghost" size="sm" className="h-7 text-[10px]" onClick={load} data-testid="smart-inbox-refresh">
            {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />} Refresh
          </Button>
        </CardHeader>
        <CardContent className="pt-0">
          {loading && inbox.length === 0 ? (
            <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : inbox.length === 0 ? (
            <p className={`py-4 text-center text-xs ${needsCheckIn ? "text-amber-200/90" : "text-emerald-300/80"}`}>{needsCheckIn ? `${needsCheckIn} asset${needsCheckIn === 1 ? " needs" : "s need"} a fresh check-in before Nexus can confirm fleet health.` : "All observed fleet signals are nominal — no active attention items."}</p>
          ) : (
            <div className={`grid grid-cols-1 gap-2 ${inbox.length > 1 ? "md:grid-cols-2" : ""} ${inbox.length > 2 ? "lg:grid-cols-3" : ""}`}>
              {inbox.slice(0, 12).map((item, index) => {
                const Icon = KIND_ICON[item.kind] || AlertTriangle;
                return (
                  <button key={`${item.device_id}-${index}`} onClick={() => navigate(`/devices/${item.device_id}`)} className={`flex items-center gap-2 rounded border px-2.5 py-2 text-left transition hover:brightness-125 ${SEV_TONE[item.severity] || SEV_TONE.info}`} data-testid={`inbox-item-${item.device_id}-${item.kind}`}>
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <div className="min-w-0 flex-1"><div className="truncate text-xs font-medium">{item.device_name}</div><div className="truncate text-[10px] opacity-80">{item.title}</div></div>
                    <ChevronRight className="h-3 w-3 shrink-0 opacity-40" />
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
