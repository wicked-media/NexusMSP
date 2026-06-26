/* LeadActivityTicker.jsx — Bloomberg-style stream for leads. */
import { useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { timeAgo } from "./leadHelpers";

const KIND_BG = {
  email: "bg-sky-500/15 text-sky-300",
  call: "bg-emerald-500/15 text-emerald-300",
  note: "bg-zinc-500/15 text-zinc-300",
  meeting: "bg-violet-500/15 text-violet-300",
  stage_change: "bg-amber-500/15 text-amber-300",
  proposal_sent: "bg-pink-500/15 text-pink-300",
  merged_into_ticket: "bg-orange-500/15 text-orange-300",
};

export default function LeadActivityTicker() {
  const { token } = useAuth();
  const [events, setEvents] = useState([]);

  useEffect(() => {
    let live = true;
    const tick = () => axios.get(`${API}/lead-studio/activity-ticker`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (live) setEvents(r.data?.events || []); }).catch(() => {});
    tick();
    const id = setInterval(tick, 25000);
    return () => { live = false; clearInterval(id); };
  }, [token]);

  if (events.length === 0) return null;
  const doubled = [...events, ...events];
  return (
    <div className="relative overflow-hidden border-y border-zinc-800/60 bg-zinc-950/40" data-testid="lead-activity-ticker">
      <div className="flex items-center gap-2 absolute left-0 top-0 bottom-0 px-3 z-10 bg-zinc-950/90 border-r border-zinc-800/60">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-300">CRM Live</span>
      </div>
      <div className="flex gap-6 py-2 pl-28 whitespace-nowrap animate-[leadticker_70s_linear_infinite] hover:[animation-play-state:paused]">
        {doubled.map((e, i) => (
          <span key={i} className="inline-flex items-center gap-1.5 text-[11px]">
            <span className="text-base">{e.icon}</span>
            <span className={`px-1.5 py-0.5 rounded font-mono uppercase text-[9px] ${KIND_BG[e.kind] || "bg-zinc-500/15 text-zinc-300"}`}>{e.kind.replace('_', ' ')}</span>
            <span className="text-zinc-200">{e.label}</span>
            <span className="text-zinc-500">· {e.lead_name}</span>
            {e.user && <span className="text-zinc-600">· {e.user}</span>}
            <span className="text-zinc-600">· {timeAgo(e.ts)}</span>
          </span>
        ))}
      </div>
      <style>{`@keyframes leadticker { from { transform: translateX(0); } to { transform: translateX(-50%); } }`}</style>
    </div>
  );
}
