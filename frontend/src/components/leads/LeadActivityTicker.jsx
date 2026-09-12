/* LeadActivityTicker.jsx — calm, scan-friendly stream of recent CRM movement. */
import { useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { timeAgo } from "./leadHelpers";
import { ArrowRightLeft, FileCheck2, Mail, MessageSquareText, Phone, Radio, UsersRound } from "lucide-react";

const KIND_STYLE = {
  email: { icon: Mail, label: "Email", tone: "text-sky-300 bg-sky-400/[0.08] border-sky-400/15" },
  call: { icon: Phone, label: "Call", tone: "text-emerald-300 bg-emerald-400/[0.08] border-emerald-400/15" },
  note: { icon: MessageSquareText, label: "Note", tone: "text-zinc-300 bg-white/[0.04] border-white/[0.08]" },
  meeting: { icon: UsersRound, label: "Meeting", tone: "text-violet-300 bg-violet-400/[0.08] border-violet-400/15" },
  stage_change: { icon: ArrowRightLeft, label: "Stage change", tone: "text-amber-300 bg-amber-400/[0.08] border-amber-400/15" },
  proposal_sent: { icon: FileCheck2, label: "Proposal sent", tone: "text-fuchsia-300 bg-fuchsia-400/[0.08] border-fuchsia-400/15" },
  merged_into_ticket: { icon: ArrowRightLeft, label: "Ticket hand-off", tone: "text-orange-300 bg-orange-400/[0.08] border-orange-400/15" },
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
  return (
    <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-zinc-950/45" data-testid="lead-activity-ticker">
      <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-50 motion-safe:animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          <Radio className="h-3.5 w-3.5 text-emerald-300" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300">Live CRM signal</span>
        </div>
        <span className="text-[10px] text-zinc-600">Updates every 25 seconds</span>
      </div>
      <div className="grid divide-y divide-white/[0.06] md:grid-cols-2 md:divide-x md:divide-y-0 xl:grid-cols-4">
        {events.slice(0, 4).map((event, index) => {
          const style = KIND_STYLE[event.kind] || KIND_STYLE.note;
          const Icon = style.icon;
          return (
            <div key={event.id || `${event.kind}-${event.ts}-${index}`} className="min-w-0 px-3.5 py-3 transition-colors hover:bg-white/[0.025]">
              <div className="flex items-start gap-2.5">
                <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${style.tone}`}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[10px] font-medium text-zinc-500">{style.label}</p>
                    <span className="shrink-0 text-[9px] text-zinc-600">{timeAgo(event.ts)}</span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] font-medium text-zinc-200">{event.label}</p>
                  <p className="mt-0.5 truncate text-[10px] text-zinc-500">
                    {event.lead_name}{event.user ? ` · ${event.user}` : ""}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
