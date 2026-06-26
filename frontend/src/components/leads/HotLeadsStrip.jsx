/* HotLeadsStrip.jsx — top 5 highest-scoring leads as glowing cards. */
import { useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Flame, ChevronRight, Loader2 } from "lucide-react";
import InitialsAvatar from "./InitialsAvatar";
import { STATUS_CONFIG, money, timeAgo } from "./leadHelpers";

export default function HotLeadsStrip({ onOpen }) {
  const { token } = useAuth();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    axios.get(`${API}/lead-studio/hot`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (live) setList(r.data?.hot_leads || []); })
      .catch(() => { if (live) setList([]); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [token]);

  if (loading) return <div className="flex items-center gap-2 text-xs text-muted-foreground py-3"><Loader2 className="w-3 h-3 animate-spin" />Scoring leads…</div>;
  if (list.length === 0) return null;

  return (
    <div className="flex items-stretch gap-2 overflow-x-auto pb-2 pt-1 -mx-1 px-1 snap-x" data-testid="hot-leads-strip">
      <div className="flex items-center gap-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-orange-300 flex-shrink-0">
        <Flame className="w-3 h-3" />Hot
      </div>
      {list.map(l => {
        const cfg = STATUS_CONFIG[l.status] || STATUS_CONFIG.new;
        return (
          <button
            key={l.id}
            onClick={() => onOpen && onOpen(l.id)}
            data-testid={`hot-lead-${l.id}`}
            className="group snap-start flex-shrink-0 min-w-[220px] max-w-[260px] text-left p-2.5 rounded-lg border bg-gradient-to-br from-orange-500/15 to-orange-500/[0.03] border-orange-500/40 hover:scale-[1.02] hover:shadow-[0_0_15px_rgba(251,146,60,0.35)] transition-all"
          >
            <div className="flex items-start gap-2">
              <InitialsAvatar name={l.company_name} size={28} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-zinc-100 truncate">{l.company_name}</p>
                <p className="text-[10px] text-zinc-400 truncate">{l.contact_name || "—"}</p>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className={`text-[9px] px-1 py-0.5 rounded border ${cfg.pill}`}>{cfg.label}</span>
                  <span className="text-[10px] font-mono text-orange-300 ml-auto inline-flex items-center gap-0.5">
                    <Flame className="w-2.5 h-2.5" />{l.score}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-1 text-[10px] text-zinc-500">
                  <span>{money(l.estimated_value)}</span>
                  <span>{timeAgo(l.last_activity_at)}</span>
                </div>
              </div>
              <ChevronRight className="w-3 h-3 text-zinc-500 group-hover:translate-x-0.5 transition-transform flex-shrink-0" />
            </div>
          </button>
        );
      })}
    </div>
  );
}
