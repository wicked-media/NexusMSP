import { useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Sparkles, RefreshCw, ChevronDown, ChevronUp, Loader2, Sun } from "lucide-react";

/**
 * 7am Morning Standup Digest banner for the Dashboard.
 * One-click generate, collapse/expand, refresh.
 */
export function StandupDigestBanner() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [digest, setDigest] = useState(null);
  const [expanded, setExpanded] = useState(true);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/ai/standup-digest?hours=12`, { headers });
      setDigest(res.data);
    } catch {
      setDigest({ ai_brief: "Unable to generate digest right now.", stats: {} });
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const s = digest?.stats || {};
  const urgencyTone =
    (s.critical_open || 0) > 0 || (s.sla_breaches || 0) > 0 ? "rose" :
    (s.failed_backups || 0) > 0 || (s.offline_devices || 0) > 5 ? "amber" : "emerald";
  const toneMap = {
    rose: { border: "border-rose-500/30", bg: "bg-rose-500/5", accent: "text-rose-400", icon: "text-rose-400" },
    amber: { border: "border-amber-500/30", bg: "bg-amber-500/5", accent: "text-amber-400", icon: "text-amber-400" },
    emerald: { border: "border-emerald-500/30", bg: "bg-emerald-500/5", accent: "text-emerald-400", icon: "text-emerald-400" },
  };
  const t = toneMap[urgencyTone];

  return (
    <div className={`rounded-2xl border ${t.border} ${t.bg} overflow-hidden`} data-testid="standup-digest-banner">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <div className={`w-7 h-7 rounded-lg bg-zinc-900 border ${t.border} flex items-center justify-center ${t.icon}`}>
          <Sun className="w-3.5 h-3.5" />
        </div>
        <div className="flex-1">
          <div className={`text-[10px] uppercase tracking-widest font-semibold ${t.accent} flex items-center gap-2`}>
            Morning Standup · {new Date().toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })}
            <Sparkles className="w-3 h-3" />
          </div>
          {!expanded && digest?.ai_brief && (
            <div className="text-xs text-zinc-300 truncate mt-0.5">{digest.ai_brief.split("\n")[0]}</div>
          )}
        </div>
        <div className="flex items-center gap-3 text-[10px] font-mono">
          <span className={`${(s.critical_open || 0) > 0 ? "text-rose-400" : "text-zinc-500"}`}>{s.critical_open || 0} CRIT</span>
          <span className={`${(s.sla_breaches || 0) > 0 ? "text-amber-400" : "text-zinc-500"}`}>{s.sla_breaches || 0} SLA</span>
          <span className={`${(s.failed_backups || 0) > 0 ? "text-rose-400" : "text-zinc-500"}`}>{s.failed_backups || 0} BKP</span>
          <span className={`${(s.offline_devices || 0) > 0 ? "text-amber-400" : "text-zinc-500"}`}>{s.offline_devices || 0} OFF</span>
        </div>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading} data-testid="digest-refresh">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)} data-testid="digest-toggle">
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </Button>
      </div>
      {expanded && (
        <div className="border-t border-zinc-800 px-4 py-3 bg-zinc-950/60">
          {loading ? (
            <div className="flex items-center justify-center py-6 text-zinc-500">
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating brief…
            </div>
          ) : (
            <pre className="whitespace-pre-wrap text-xs text-zinc-300 font-sans leading-relaxed" data-testid="digest-body">{digest?.ai_brief}</pre>
          )}
        </div>
      )}
    </div>
  );
}
