/* ActivityTicker.jsx — Bloomberg-style scrolling ticker. */
import { useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";

const KIND_BG = {
  checkin: "bg-emerald-500/10 text-emerald-300",
  alert: "bg-red-500/10 text-red-300",
  maintenance: "bg-violet-500/10 text-violet-300",
};

function timeAgo(ts) {
  try {
    const d = new Date(ts);
    const s = Math.round((Date.now() - d.getTime()) / 1000);
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.round(s / 60)}m`;
    return `${Math.round(s / 3600)}h`;
  } catch { return "—"; }
}

export default function ActivityTicker() {
  const { token } = useAuth();
  const [events, setEvents] = useState([]);

  useEffect(() => {
    let live = true;
    const tick = () => axios.get(`${API}/devices/activity-ticker`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (live) setEvents(r.data?.events || []); })
      .catch(() => {});
    tick();
    const id = setInterval(tick, 20000);
    return () => { live = false; clearInterval(id); };
  }, [token]);

  if (events.length === 0) return null;
  const doubled = [...events, ...events];

  return (
    <div className="relative overflow-hidden border-y border-zinc-800/60 bg-zinc-950/40" data-testid="activity-ticker">
      <div className="flex items-center gap-2 absolute left-0 top-0 bottom-0 px-3 z-10 bg-zinc-950/90 border-r border-zinc-800/60">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-300">Live</span>
      </div>
      <div className="flex gap-6 py-2 pl-24 whitespace-nowrap animate-[ticker_60s_linear_infinite] hover:[animation-play-state:paused]">
        {doubled.map((e, i) => (
          <span key={i} className="inline-flex items-center gap-1.5 text-[11px]" data-testid={i < events.length ? `ticker-event-${i}` : undefined}>
            <span className="text-base">{e.icon}</span>
            <span className={`px-1.5 py-0.5 rounded ${KIND_BG[e.kind] || "bg-zinc-500/10 text-zinc-300"} font-mono uppercase text-[9px]`}>{e.kind}</span>
            <span className="text-zinc-200">{e.label}</span>
            {e.client && <span className="text-zinc-500">· {e.client}</span>}
            <span className="text-zinc-600">· {timeAgo(e.ts)} ago</span>
          </span>
        ))}
      </div>
      <style>{`@keyframes ticker { from { transform: translateX(0); } to { transform: translateX(-50%); } }`}</style>
    </div>
  );
}
