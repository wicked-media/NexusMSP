/* AnomalyInbox.jsx — rolling stream of unusual behavior. */
import { useEffect, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { API, useAuth } from "@/App";
import { Card } from "@/components/ui/card";
import { AlertOctagon, Loader2 } from "lucide-react";

const SEV = {
  critical: "border-l-red-500 bg-red-500/5",
  high: "border-l-amber-500 bg-amber-500/5",
  medium: "border-l-sky-500 bg-sky-500/5",
  low: "border-l-zinc-500 bg-zinc-500/5",
};

function timeAgo(ts) {
  try {
    const s = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    return `${Math.round(s / 86400)}d ago`;
  } catch { return "—"; }
}

export default function AnomalyInbox() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    const tick = () => axios.get(`${API}/devices/anomalies?limit=20`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (live) setList(r.data?.anomalies || []); }).catch(() => {});
    tick();
    setLoading(false);
    const id = setInterval(tick, 25000);
    return () => { live = false; clearInterval(id); };
  }, [token]);

  if (loading) return <div className="flex items-center justify-center py-6 gap-2 text-xs text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" />Loading anomalies…</div>;

  return (
    <Card className="bg-zinc-900/40 border-zinc-800/60" data-testid="anomaly-inbox">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/60">
        <AlertOctagon className="w-3.5 h-3.5 text-amber-300" />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300">Anomaly Inbox</p>
        <span className="ml-auto text-[10px] text-zinc-500">{list.length}</span>
      </div>
      <div className="max-h-[260px] overflow-y-auto">
        {list.length === 0 && <p className="px-3 py-4 text-[11px] text-zinc-500">No anomalies right now.</p>}
        {list.map(a => (
          <button
            key={a.id}
            onClick={() => a.device_id && navigate(`/devices/${a.device_id}`)}
            className={`w-full text-left px-3 py-2 border-l-2 hover:bg-zinc-800/40 transition-colors ${SEV[a.severity] || SEV.low}`}
            data-testid={`anomaly-row-${a.id}`}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-[11px] text-zinc-100 line-clamp-1">{a.title}</p>
              <span className="text-[10px] text-zinc-500 flex-shrink-0">{timeAgo(a.created_at)}</span>
            </div>
            <p className="text-[10px] text-zinc-400 mt-0.5">{a.device_name} · {a.category}</p>
          </button>
        ))}
      </div>
    </Card>
  );
}
