/**
 * DeviceCommandStrip — HeroTile metrics + Smart Inbox above the device list.
 */
import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import HeroTile from "@/components/HeroTile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import {
  Monitor, WifiOff, Wifi, AlertTriangle, Download, HardDrive, DollarSign, Zap,
  Inbox, ChevronRight, Loader2, RefreshCw,
} from "lucide-react";

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
      const [s, i] = await Promise.all([
        axios.get(`${API}/devices/intel/stats`, { headers }),
        axios.get(`${API}/devices/smart-inbox`, { headers }),
      ]);
      setStats(s.data);
      setInbox(i.data.items || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
    // eslint-disable-next-line
  }, [API]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3" data-testid="device-command-strip">
      {/* HeroTile metric strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <HeroTile label="Online" value={stats?.online ?? "—"} icon={Wifi} glow="emerald" testId="dev-tile-online" />
        <HeroTile label="Offline" value={stats?.offline ?? 0} icon={WifiOff} glow={stats?.offline ? "rose" : "zinc"} testId="dev-tile-offline" />
        <HeroTile label="Critical" value={stats?.warning ?? 0} icon={AlertTriangle} glow={stats?.warning ? "amber" : "zinc"} testId="dev-tile-warning" />
        <HeroTile label="Patches Pending" value={stats?.patches_pending ?? 0} icon={Download} glow="cyan" testId="dev-tile-patches" />
        <HeroTile label="Disk At-Risk" value={stats?.disk_at_risk ?? 0} icon={HardDrive} glow={stats?.disk_at_risk ? "rose" : "emerald"} testId="dev-tile-disk" />
        <HeroTile label="MTTR (30d)" value={stats?.mttr_30d_minutes ? `${stats.mttr_30d_minutes}m` : "—"} icon={Zap} glow="violet" animated={false} testId="dev-tile-mttr" />
      </div>

      {/* Smart Inbox */}
      <Card className="border-violet-500/20 bg-gradient-to-br from-card via-card to-violet-500/[0.02]" data-testid="device-smart-inbox">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Inbox className="w-4 h-4 text-violet-400" />Needs Attention
            <Badge variant="outline" className="text-[9px] uppercase">{inbox.length}</Badge>
          </CardTitle>
          <Button variant="ghost" size="sm" className="h-7 text-[10px]" onClick={load} data-testid="smart-inbox-refresh">
            {loading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}Refresh
          </Button>
        </CardHeader>
        <CardContent className="pt-0">
          {loading && inbox.length === 0 ? (
            <div className="py-4 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-zinc-500" /></div>
          ) : inbox.length === 0 ? (
            <p className="text-xs text-emerald-400/80 text-center py-4">All systems nominal — no fleet-wide issues 🎉</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {inbox.slice(0, 12).map((it, i) => {
                const Icon = KIND_ICON[it.kind] || AlertTriangle;
                return (
                  <button
                    key={`${it.device_id}-${i}`}
                    onClick={() => navigate(`/devices/${it.device_id}`)}
                    className={`text-left flex items-center gap-2 px-2.5 py-2 rounded border ${SEV_TONE[it.severity]} hover:brightness-125 transition`}
                    data-testid={`inbox-item-${it.device_id}-${it.kind}`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium truncate">{it.device_name}</div>
                      <div className="text-[10px] opacity-80 truncate">{it.title}</div>
                    </div>
                    <ChevronRight className="w-3 h-3 opacity-40 shrink-0" />
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
