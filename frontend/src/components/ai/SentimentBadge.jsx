import { useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Badge } from "@/components/ui/badge";
import { Heart, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

/** Inline sentiment scorer — shows a badge on the ticket detail header. */
export function SentimentBadge({ ticketId, auto = false }) {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/tickets/${ticketId}/sentiment`, { headers: { Authorization: `Bearer ${token}` } });
      setData(r.data);
      if (r.data?.flag === "escalating") toast.warning(`⚠ Client sentiment is escalating: ${r.data.reasoning}`, { duration: 6000 });
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setLoading(false); }
  };

  if (!data) {
    return (
      <button
        type="button"
        onClick={run}
        disabled={loading}
        className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-violet-500/30 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20"
        data-testid="sentiment-check-btn"
      >
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Heart className="w-3 h-3" />}
        {loading ? "Analysing…" : "Check sentiment"}
      </button>
    );
  }

  const toneByScore = (s) => {
    if (!s) return "text-zinc-400 border-zinc-700";
    if (s >= 4) return "text-rose-400 border-rose-500/40 bg-rose-500/10";
    if (s === 3) return "text-amber-400 border-amber-500/40 bg-amber-500/10";
    return "text-emerald-400 border-emerald-500/40 bg-emerald-500/10";
  };
  const label = data.trend === "insufficient_data" ? "not enough replies" :
    data.trend === "worsening" ? "🚨 escalating" :
    data.trend === "improving" ? "improving" : data.trend;

  return (
    <Badge variant="outline" className={toneByScore(data.latest_score)} data-testid="sentiment-badge" title={data.reasoning || ""}>
      {data.flag === "escalating" && <AlertTriangle className="w-3 h-3 mr-1" />}
      Sentiment: {label} {data.latest_score ? `· ${data.latest_score}/5` : ""}
    </Badge>
  );
}
