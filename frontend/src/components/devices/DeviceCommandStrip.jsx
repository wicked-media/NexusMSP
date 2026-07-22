/**
 * Fleet health summary and actionable attention queue for Managed Assets.
 */
import { useCallback, useEffect, useState } from "react";
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

export default function DeviceCommandStrip({ headers, API }) {
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

  return (
    <div className="space-y-3" data-testid="device-command-strip">
      <MetricStrip columns={6}>
        <MetricTile label="Online" value={stats?.online ?? "—"} accent="emerald" icon={<Wifi className="h-2.5 w-2.5 text-emerald-400" />} testid="dev-tile-online" />
        <MetricTile label="Offline" value={stats?.offline ?? 0} accent={stats?.offline ? "rose" : "slate"} icon={<WifiOff className="h-2.5 w-2.5 text-rose-400" />} testid="dev-tile-offline" />
        <MetricTile label="Critical" value={stats?.warning ?? 0} accent={stats?.warning ? "amber" : "slate"} icon={<AlertTriangle className="h-2.5 w-2.5 text-amber-400" />} testid="dev-tile-warning" />
        <MetricTile label="Patches Pending" value={stats?.patches_pending ?? 0} accent="cyan" icon={<Download className="h-2.5 w-2.5 text-cyan-400" />} testid="dev-tile-patches" />
        <MetricTile label="Disk At Risk" value={stats?.disk_at_risk ?? 0} accent={stats?.disk_at_risk ? "rose" : "emerald"} icon={<HardDrive className="h-2.5 w-2.5 text-rose-400" />} testid="dev-tile-disk" />
        <MetricTile label="MTTR · 30d" value={stats?.mttr_30d_minutes ? `${stats.mttr_30d_minutes}m` : "—"} accent="sky" icon={<Zap className="h-2.5 w-2.5 text-sky-400" />} testid="dev-tile-mttr" />
      </MetricStrip>

      <Card className="border-cyan-500/20 bg-gradient-to-br from-card via-card to-cyan-500/[0.04]" data-testid="device-smart-inbox">
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
            <p className="py-4 text-center text-xs text-emerald-300/80">All systems nominal — no fleet-wide issues.</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
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
