/* TopRisksStrip.jsx — horizontally scrolling AI risk callouts. */
import { useEffect, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { API, useAuth } from "@/App";
import { ChevronRight, Loader2 } from "lucide-react";

const SEVERITY_STYLE = {
  critical: "from-red-500/20 to-red-500/5 border-red-500/40 text-red-200",
  high: "from-amber-500/20 to-amber-500/5 border-amber-500/40 text-amber-200",
  medium: "from-sky-500/20 to-sky-500/5 border-sky-500/40 text-sky-200",
  low: "from-zinc-500/20 to-zinc-500/5 border-zinc-500/40 text-zinc-200",
};

export default function TopRisksStrip({ onApplyFilter }) {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [risks, setRisks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    axios.get(`${API}/devices/top-risks`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (live) setRisks(r.data?.risks || []); })
      .catch(() => { if (live) setRisks([]); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [token]);

  if (loading) return <div className="flex items-center gap-2 text-xs text-muted-foreground py-2"><Loader2 className="w-3 h-3 animate-spin" />Scanning fleet for risks…</div>;
  if (risks.length === 0) return null;

  return (
    <div className="flex items-stretch gap-2 overflow-x-auto pb-2 pt-1 -mx-1 px-1 snap-x" data-testid="top-risks-strip">
      {risks.map(r => {
        const style = SEVERITY_STYLE[r.severity] || SEVERITY_STYLE.low;
        return (
          <button
            key={r.id}
            data-testid={`top-risk-${r.id}`}
            onClick={() => {
              if (r.action_url) navigate(r.action_url);
              else if (r.action_filter && onApplyFilter) onApplyFilter(r.action_filter);
            }}
            className={`group snap-start flex-shrink-0 min-w-[280px] max-w-sm text-left p-3 rounded-lg border bg-gradient-to-br ${style} hover:scale-[1.015] transition-all`}
          >
            <div className="flex items-start gap-2">
              <span className="text-xl leading-none">{r.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold truncate">{r.title}</p>
                <p className="text-[10px] opacity-80 line-clamp-2 mt-0.5">{r.subtitle}</p>
                <div className="flex items-center gap-1 mt-1.5 text-[10px] opacity-90 group-hover:translate-x-1 transition-transform">
                  <span>{r.action_label}</span><ChevronRight className="w-3 h-3" />
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
