import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Sparkles, RefreshCw, ChevronDown, ChevronUp, Loader2, Settings2, Sun, Sunrise, Moon } from "lucide-react";

// Match #PREFIX-NUMBER or bare PREFIX-NUMBER tokens (INC-1234 / SR-0001).
const TICKET_RE = /(#?)([A-Z]{2,5}-\d{2,8})\b/g;

function LinkifiedDigest({ text }) {
  if (!text) return null;
  const out = [];
  text.split("\n").forEach((line, li) => {
    let last = 0;
    const parts = [];
    line.replace(TICKET_RE, (match, hash, ref, offset) => {
      if (offset > last) parts.push(line.slice(last, offset));
      parts.push(
        <Link
          key={`${li}-${offset}`}
          to={`/tickets?ticket=${encodeURIComponent(ref)}`}
          className="text-sky-400 hover:text-sky-300 underline decoration-sky-500/40 hover:decoration-sky-300 underline-offset-2 font-mono"
          data-testid={`digest-ticket-link-${ref}`}
        >
          #{ref}
        </Link>
      );
      last = offset + match.length;
      return match;
    });
    if (last < line.length) parts.push(line.slice(last));
    out.push(
      <div key={li} className="leading-relaxed">
        {parts.length ? parts : <>&nbsp;</>}
      </div>
    );
  });
  return <div className="text-xs text-zinc-300 font-sans space-y-1" data-testid="digest-body">{out}</div>;
}

const SLOT_ICON = { morning: Sunrise, afternoon: Sun, evening: Moon };
const SLOT_DEFAULT_LABEL = { morning: "Morning Standup", afternoon: "Midday Pulse", evening: "End-of-Day Wrap" };

/**
 * Time-aware Standup Digest banner for the Dashboard.
 * Auto-rotates morning / afternoon / evening based on local hour.
 */
export function StandupDigestBanner() {
  const { token } = useAuth();
  const [digest, setDigest] = useState(null);
  const [expanded, setExpanded] = useState(true);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/ai/standup-digest`, { headers: { Authorization: `Bearer ${token}` } });
      setDigest(res.data);
    } catch {
      setDigest({ ai_brief: "Unable to generate digest right now.", stats: {} });
    } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const s = digest?.stats || {};
  const slot = digest?.slot || "morning";
  const label = digest?.slot_label || SLOT_DEFAULT_LABEL[slot] || "Standup";
  const Icon = SLOT_ICON[slot] || Sun;
  const needsAiSetup = digest?.ai_status === "not_configured";
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
          <Icon className="w-3.5 h-3.5" />
        </div>
        <div className="flex-1">
          <div className={`text-[10px] uppercase tracking-widest font-semibold ${t.accent} flex items-center gap-2`} data-testid={`standup-slot-${slot}`}>
            {label} · {new Date().toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })}
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
          ) : needsAiSetup ? (
            <div className="flex flex-col gap-3 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.06] p-3 sm:flex-row sm:items-center sm:justify-between" data-testid="digest-ai-setup-state">
              <div><p className="text-xs font-semibold text-cyan-100">Connect an AI provider to generate this brief</p><p className="mt-1 text-[11px] text-muted-foreground">The operational totals above are live. Configure a provider when you want NexusMSP to add an AI-written technician summary.</p></div>
              <Button asChild size="sm" variant="outline" className="shrink-0 border-cyan-400/30 text-cyan-100 hover:bg-cyan-400/10"><Link to="/settings?tab=ai&anchor=ai-config-card"><Settings2 className="mr-1.5 h-3.5 w-3.5" />Configure AI</Link></Button>
            </div>
          ) : (
            <LinkifiedDigest text={digest?.ai_brief} />
          )}
        </div>
      )}
    </div>
  );
}
