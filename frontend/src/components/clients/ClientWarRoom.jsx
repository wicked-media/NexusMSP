import { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import HeroTile from "@/components/HeroTile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Activity, AlertTriangle, Cpu, HardDrive, Loader2, Monitor, RefreshCw,
  Sparkles, Ticket, Users, Wifi, WifiOff, Zap,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const SEV_TONES = {
  critical: { glow: "rose", label: "CRITICAL", text: "text-rose-300", bg: "bg-rose-500/10 border-rose-500/30" },
  warning:  { glow: "amber", label: "WARNING", text: "text-amber-300", bg: "bg-amber-500/10 border-amber-500/30" },
  ok:       { glow: "emerald", label: "NOMINAL", text: "text-emerald-300", bg: "bg-emerald-500/10 border-emerald-500/30" },
};

function DeviceTile({ device }) {
  const status = device.status || "unknown";
  const cpu = Number(device.cpu_load || 0);
  const mem = Number(device.memory_pct || 0);
  const dsk = Number(device.disk_pct || 0);
  const isWarn = cpu > 85 || mem > 85 || dsk > 90;
  const ring = status === "offline" ? "border-rose-500/40 bg-rose-500/5" :
               isWarn ? "border-amber-500/40 bg-amber-500/5" :
               status === "online" ? "border-emerald-500/30 bg-emerald-500/5" :
               "border-zinc-800 bg-zinc-900/40";
  return (
    <div className={`relative rounded-md border ${ring} px-2.5 py-2`} data-testid={`war-room-device-${device.id}`}>
      <div className="flex items-center gap-1.5">
        {status === "online"
          ? <Wifi className="w-3 h-3 text-emerald-400 shrink-0" />
          : <WifiOff className="w-3 h-3 text-rose-400 shrink-0" />}
        <span className="text-xs font-mono truncate flex-1">{device.hostname || device.name || "—"}</span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-500 font-mono">
        <span className={cpu > 85 ? "text-amber-400" : ""}><Cpu className="w-2.5 h-2.5 inline mr-0.5" />{cpu ? `${Math.round(cpu)}%` : "—"}</span>
        <span className={mem > 85 ? "text-amber-400" : ""}>RAM {mem ? `${Math.round(mem)}%` : "—"}</span>
        <span className={dsk > 90 ? "text-rose-400" : ""}><HardDrive className="w-2.5 h-2.5 inline mr-0.5" />{dsk ? `${Math.round(dsk)}%` : "—"}</span>
      </div>
    </div>
  );
}

const PRIO_COLOR = {
  critical: "text-rose-400 border-rose-500/30",
  urgent: "text-rose-400 border-rose-500/30",
  p1: "text-rose-400 border-rose-500/30",
  high: "text-amber-400 border-amber-500/30",
  medium: "text-cyan-400 border-cyan-500/30",
  low: "text-zinc-400 border-zinc-500/30",
};

export default function ClientWarRoom({ clientId }) {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [commentary, setCommentary] = useState(null);
  const [commentaryLoading, setCommentaryLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const intervalRef = useRef(null);

  const headers = { Authorization: `Bearer ${token}` };

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const r = await axios.get(`${API}/clients/${clientId}/war-room`, { headers });
      setData(r.data);
    } catch { /* keep previous */ }
    finally { if (!silent) setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, token]);

  const loadCommentary = useCallback(async () => {
    setCommentaryLoading(true);
    try {
      const r = await axios.get(`${API}/clients/${clientId}/war-room/commentary`, { headers });
      setCommentary(r.data);
    } catch { /* ignore */ }
    finally { setCommentaryLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, token]);

  useEffect(() => { load(false); loadCommentary(); }, [load, loadCommentary]);

  // Auto-refresh every 15s
  useEffect(() => {
    if (!autoRefresh) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => load(true), 15000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, load]);

  if (loading) return (
    <div className="flex items-center justify-center py-12 text-zinc-500">
      <Loader2 className="w-5 h-5 mr-2 animate-spin" />Initialising war room…
    </div>
  );
  if (!data) return <div className="p-6 text-sm text-zinc-500">War room unavailable.</div>;

  const m = data.metrics;
  const sev = SEV_TONES[data.severity] || SEV_TONES.ok;

  return (
    <div className="space-y-4" data-testid="client-war-room">
      {/* Severity banner */}
      <div className={`rounded-md border ${sev.bg} px-4 py-2 flex items-center justify-between`} data-testid="war-room-severity">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${data.severity === "critical" ? "bg-rose-400 animate-pulse" : data.severity === "warning" ? "bg-amber-400" : "bg-emerald-400"}`} />
          <span className={`text-[10px] uppercase tracking-widest font-bold ${sev.text}`}>{sev.label}</span>
          <span className="text-xs text-zinc-400">— live operational view, refresh every 15s</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-500 font-mono">
            {data.computed_at ? `updated ${formatDistanceToNow(new Date(data.computed_at), { addSuffix: true })}` : "—"}
          </span>
          <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => setAutoRefresh(v => !v)} data-testid="war-room-toggle-refresh">
            <RefreshCw className={`w-3 h-3 mr-1 ${autoRefresh ? "animate-spin-slow" : ""}`} />
            {autoRefresh ? "Live" : "Paused"}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => load(false)} data-testid="war-room-refresh-now">Refresh now</Button>
        </div>
      </div>

      {/* Hero tile metric strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <HeroTile label="Devices Online" value={`${m.devices_online}/${m.devices_total}`} icon={Monitor} glow="emerald" animated={false} testId="war-tile-online" />
        <HeroTile label="Devices Offline" value={m.devices_offline} icon={WifiOff} glow={m.devices_offline > 0 ? "rose" : "zinc"} testId="war-tile-offline" />
        <HeroTile label="Warning State" value={m.devices_warning} icon={AlertTriangle} glow={m.devices_warning > 0 ? "amber" : "zinc"} testId="war-tile-warning" />
        <HeroTile label="Open Tickets" value={m.open_tickets} icon={Ticket} glow="cyan" subtitle={`${m.tickets_critical} critical`} testId="war-tile-tickets" />
        <HeroTile label="SLA Breached" value={m.tickets_breached} icon={AlertTriangle} glow={m.tickets_breached > 0 ? "rose" : "emerald"} testId="war-tile-breached" />
        <HeroTile label="MTTR (7d)" value={m.mttr_7d_minutes ? `${m.mttr_7d_minutes}m` : "—"} icon={Zap} glow="violet" animated={false} testId="war-tile-mttr" />
      </div>

      {/* AI Commentary banner */}
      <Card className="border-violet-500/30 bg-gradient-to-br from-violet-500/10 via-fuchsia-500/5 to-transparent" data-testid="war-room-commentary">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-md bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] uppercase tracking-widest font-bold text-violet-300">NOC AI Commentary</span>
                <Button size="sm" variant="ghost" className="h-6 text-[10px] text-violet-300" onClick={loadCommentary} disabled={commentaryLoading} data-testid="war-room-regen">
                  {commentaryLoading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                  Regenerate
                </Button>
              </div>
              <p className="text-sm text-zinc-200 leading-relaxed" data-testid="war-room-commentary-text">
                {commentaryLoading && !commentary ? "Analysing…" : commentary?.commentary || "—"}
              </p>
              {commentary?.source && (
                <span className="text-[9px] text-zinc-500 font-mono uppercase tracking-widest mt-1 inline-block">source: {commentary.source}</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quad-grid — devices · tickets · oncall · activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Devices */}
        <Card data-testid="war-room-devices">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Monitor className="w-4 h-4" />Device Telemetry</CardTitle>
          </CardHeader>
          <CardContent>
            {data.devices.length === 0 ? (
              <p className="text-xs text-zinc-500">No devices linked.</p>
            ) : (
              <ScrollArea className="h-[280px] pr-2">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {data.devices.map(d => <DeviceTile key={d.id} device={d} />)}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        {/* Open tickets */}
        <Card data-testid="war-room-tickets">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Ticket className="w-4 h-4" />Active Tickets</CardTitle>
          </CardHeader>
          <CardContent>
            {data.open_tickets.length === 0 ? (
              <p className="text-xs text-zinc-500">No open tickets.</p>
            ) : (
              <ScrollArea className="h-[280px] pr-2">
                <div className="space-y-1">
                  {data.open_tickets.map(t => (
                    <div key={t.id} className="flex items-center gap-2 py-1.5 border-b border-zinc-900 last:border-0" data-testid={`war-room-ticket-${t.id}`}>
                      <Badge variant="outline" className={`text-[9px] uppercase ${PRIO_COLOR[t.priority] || PRIO_COLOR.medium}`}>{t.priority || "med"}</Badge>
                      <span className="text-xs flex-1 truncate">{t.title}</span>
                      <span className="text-[10px] text-zinc-500 font-mono shrink-0">{t.assigned_to_name || "Unassigned"}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        {/* On-call presence */}
        <Card data-testid="war-room-oncall">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Users className="w-4 h-4" />On-Call & Available</CardTitle>
          </CardHeader>
          <CardContent>
            {data.oncall.length === 0 ? (
              <p className="text-xs text-zinc-500">No technicians active.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {data.oncall.map(t => (
                  <div key={t.id} className="flex items-center gap-2 px-2 py-1.5 rounded border border-zinc-800 bg-zinc-900/40" data-testid={`war-room-tech-${t.id}`}>
                    <div className="relative">
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-[10px] font-bold text-white">
                        {(t.name || "?").slice(0, 2).toUpperCase()}
                      </div>
                      {t.on_call_status && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-zinc-950" />}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs truncate">{t.name}</div>
                      <div className="text-[9px] text-zinc-500 font-mono uppercase">{t.on_call_status ? "on-call" : "active"}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Live activity */}
        <Card data-testid="war-room-activity">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Activity className="w-4 h-4" />Live Activity (24h)</CardTitle>
          </CardHeader>
          <CardContent>
            {data.activity.length === 0 ? (
              <p className="text-xs text-zinc-500">No activity in the last 24 hours.</p>
            ) : (
              <ScrollArea className="h-[280px] pr-2">
                <div className="space-y-1">
                  {data.activity.map((a, i) => (
                    <div key={`act-${i}`} className="flex items-center gap-2 py-1.5 border-b border-zinc-900 last:border-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />
                      <span className="text-xs flex-1 truncate">{a.title}</span>
                      <span className="text-[10px] text-zinc-500 font-mono shrink-0">
                        {a.timestamp ? formatDistanceToNow(new Date(a.timestamp), { addSuffix: true }) : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
