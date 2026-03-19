import { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Monitor, Wifi, WifiOff, AlertTriangle, Clock, Users, Loader2, RefreshCw, Zap } from "lucide-react";

function formatTimer(seconds) {
  if (seconds <= 0) return "BREACHED";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export default function WallboardPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState(new Date());
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/wallboard/data`, { headers });
      setData(res.data);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); const iv = setInterval(fetchData, 15000); return () => clearInterval(iv); }, [fetchData]);
  useEffect(() => { const iv = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(iv); }, []);

  if (loading) return <div className="flex items-center justify-center h-screen bg-black"><Loader2 className="w-12 h-12 animate-spin text-primary" /></div>;

  const d = data || {};
  const tickets = d.tickets || {};
  const devices = d.devices || {};
  const queue = tickets.queue || [];
  const techs = d.technicians || [];

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-4 space-y-4" data-testid="wallboard-page">
      {/* Header Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Monitor className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-2xl font-black tracking-tight">NexusOps NOC</h1>
            <p className="text-xs text-zinc-500">Live Network Operations Center</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-3xl font-mono font-black text-primary">{clock.toLocaleTimeString()}</p>
          <p className="text-xs text-zinc-500">{clock.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
        </div>
      </div>

      {/* Top Stats */}
      <div className="grid grid-cols-6 gap-3">
        {[
          { label: "Open Tickets", value: tickets.open || 0, color: "text-blue-400", bg: "bg-blue-500/10" },
          { label: "Critical", value: tickets.critical || 0, color: tickets.critical > 0 ? "text-red-400 animate-pulse" : "text-emerald-400", bg: tickets.critical > 0 ? "bg-red-500/10" : "bg-emerald-500/10" },
          { label: "High Priority", value: tickets.high || 0, color: "text-amber-400", bg: "bg-amber-500/10" },
          { label: "Resolved Today", value: tickets.resolved_today || 0, color: "text-emerald-400", bg: "bg-emerald-500/10" },
          { label: "Devices Online", value: `${devices.online || 0}/${devices.total || 0}`, color: "text-cyan-400", bg: "bg-cyan-500/10" },
          { label: "Uptime", value: `${devices.uptime_pct || 0}%`, color: "text-emerald-400", bg: "bg-emerald-500/10" },
        ].map((s, i) => (
          <div key={i} className={`${s.bg} rounded-xl p-4 border border-zinc-800/50`}>
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{s.label}</p>
            <p className={`text-3xl font-black ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-4 gap-3" style={{ height: "calc(100vh - 260px)" }}>
        {/* Ticket Queue */}
        <div className="col-span-2 bg-zinc-900/50 rounded-xl border border-zinc-800/50 overflow-hidden flex flex-col">
          <div className="px-4 py-2 border-b border-zinc-800/50 flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Live Ticket Queue</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {queue.map(t => {
              const breached = t.sla_breached;
              const atRisk = !breached && t.sla_remaining_seconds < 1800;
              return (
                <div key={t.id} className={`px-4 py-2.5 border-b border-zinc-800/20 flex items-center gap-3 ${breached ? "bg-red-500/5" : atRisk ? "bg-amber-500/5" : ""}`}>
                  <Badge className={`text-[10px] ${
                    t.priority === "critical" ? "bg-red-500/20 text-red-400" :
                    t.priority === "high" ? "bg-amber-500/20 text-amber-400" :
                    t.priority === "medium" ? "bg-blue-500/20 text-blue-400" : "bg-zinc-500/20 text-zinc-400"
                  }`}>{t.priority}</Badge>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{t.ticket_number ? `#${t.ticket_number}` : ""} {t.title}</p>
                    <p className="text-[10px] text-zinc-500">{t.client_name} &middot; {t.assigned_to_name || "Unassigned"}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-xs font-mono font-bold ${breached ? "text-red-400" : atRisk ? "text-amber-400" : "text-emerald-400"}`}>
                      <Clock className="w-3 h-3 inline mr-1" />
                      {formatTimer(t.sla_remaining_seconds || 0)}
                    </p>
                  </div>
                </div>
              );
            })}
            {queue.length === 0 && <p className="text-center text-zinc-600 py-12">Queue empty</p>}
          </div>
        </div>

        {/* Tech Status */}
        <div className="bg-zinc-900/50 rounded-xl border border-zinc-800/50 overflow-hidden flex flex-col">
          <div className="px-4 py-2 border-b border-zinc-800/50 flex items-center gap-2">
            <Users className="w-4 h-4 text-blue-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Technicians</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {techs.map(t => (
              <div key={t.id} className="px-4 py-3 border-b border-zinc-800/20 flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full ${t.status === "available" ? "bg-emerald-400" : t.status === "active" ? "bg-blue-400" : "bg-red-400"}`} />
                <div className="flex-1">
                  <p className="text-sm font-medium">{t.name}</p>
                  <p className="text-[10px] text-zinc-500">{t.active_tickets} active &middot; {t.total_open} open</p>
                </div>
                <Badge className={`text-[10px] ${
                  t.status === "available" ? "bg-emerald-500/20 text-emerald-400" :
                  t.status === "active" ? "bg-blue-500/20 text-blue-400" : "bg-red-500/20 text-red-400"}`}>
                  {t.status}
                </Badge>
              </div>
            ))}
          </div>
        </div>

        {/* Device Health */}
        <div className="bg-zinc-900/50 rounded-xl border border-zinc-800/50 overflow-hidden flex flex-col">
          <div className="px-4 py-2 border-b border-zinc-800/50 flex items-center gap-2">
            <Monitor className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Infrastructure</span>
          </div>
          <div className="p-4 flex-1 flex flex-col justify-center items-center gap-4">
            <div className="relative w-32 h-32">
              <svg className="w-32 h-32 -rotate-90" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="40" fill="none" stroke="#27272a" strokeWidth="8" />
                <circle cx="50" cy="50" r="40" fill="none" stroke="#22d3ee" strokeWidth="8"
                  strokeDasharray={`${(devices.uptime_pct || 0) * 2.51} 251`} strokeLinecap="round" />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-black text-cyan-400">{devices.uptime_pct || 0}%</span>
                <span className="text-[9px] text-zinc-500">UPTIME</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 w-full">
              <div className="text-center">
                <div className="flex items-center justify-center gap-1 text-emerald-400">
                  <Wifi className="w-4 h-4" />
                  <span className="text-xl font-black">{devices.online || 0}</span>
                </div>
                <p className="text-[10px] text-zinc-500">Online</p>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-1 text-red-400">
                  <WifiOff className="w-4 h-4" />
                  <span className="text-xl font-black">{devices.offline || 0}</span>
                </div>
                <p className="text-[10px] text-zinc-500">Offline</p>
              </div>
            </div>
            {devices.active_alerts > 0 && (
              <div className="w-full p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 animate-pulse" />
                <span className="text-xs text-amber-400 font-bold">{devices.active_alerts} Active Alerts</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
