import { useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { useLocation } from "react-router-dom";

/** Background hook — sends heartbeat every 20s + auto-detects busy_state from URL. */
export function usePresenceHeartbeat() {
  const { token } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    const detectBusyState = () => {
      const path = location.pathname + location.search;
      const ticketMatch = path.match(/ticket=([\w-]+)/);
      if (ticketMatch) return `ticket:${ticketMatch[1]}`;
      if (path.includes("/war-room")) return "warroom";
      if (path.includes("/remote-tools") || path.includes("/devices/")) return "remote";
      return null;
    };

    const ping = async () => {
      try {
        await axios.post(`${API}/presence/heartbeat`, { busy_state: detectBusyState() },
          { headers: { Authorization: `Bearer ${token}` } });
      } catch (_) { /* swallow */ }
    };

    ping();
    const interval = setInterval(() => { if (!cancelled) ping(); }, 20000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [token, location.pathname, location.search]);
}

const LED_COLOURS = {
  active: { bg: "bg-emerald-500", ring: "ring-emerald-500/40", pulse: true, label: "Active" },
  busy: { bg: "bg-rose-500", ring: "ring-rose-500/40", pulse: false, label: "On a ticket" },
  dnd: { bg: "bg-orange-500", ring: "ring-orange-500/40", pulse: false, label: "Do not disturb" },
  break: { bg: "bg-blue-500", ring: "ring-blue-500/40", pulse: true, label: "On break" },
  away: { bg: "bg-yellow-500", ring: "ring-yellow-500/40", pulse: true, label: "Away" },
  offline: { bg: "bg-zinc-600", ring: "ring-zinc-600/40", pulse: false, label: "Offline" },
};

export function PresenceDot({ led = "offline", size = 8, showLabel = false, className = "" }) {
  const c = LED_COLOURS[led] || LED_COLOURS.offline;
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`} title={c.label}>
      <span className={`relative inline-block rounded-full ${c.bg} ring-2 ${c.ring}`}
        style={{ width: size, height: size }}>
        {c.pulse && <span className={`absolute inset-0 rounded-full ${c.bg} animate-ping opacity-60`} />}
      </span>
      {showLabel && <span className="text-[10px] text-muted-foreground">{c.label}</span>}
    </span>
  );
}
