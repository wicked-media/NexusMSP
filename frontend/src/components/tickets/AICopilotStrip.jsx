import { useEffect, useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Sparkles, ChevronRight, Loader2, Zap, RefreshCw, ArrowRight } from "lucide-react";
import { differenceInHours, formatDistanceToNow } from "date-fns";
import { API } from "@/App";

/**
 * AI Co-Pilot Strip — Linear/Plain-style banner at the top of a ticket detail.
 *
 * Renders a single line that summarises the situation + suggests the *next*
 * action a tech should take. Pure presentational; opens the detail tabs
 * (or fires actions) via the provided handlers.
 *
 * Heuristics-first (zero-cost): age, SLA, blocker, device telemetry hooks,
 * patches, status. AI summarisation is opt-in via the "Summarise" button.
 */
export default function AICopilotStrip({ ticket, deviceStatus, headers, onActionClick }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [burndown, setBurndown] = useState(null);

  useEffect(() => {
    if (!ticket?.id) return;
    let alive = true;
    axios.get(`${API}/tickets/${ticket.id}/burndown`, { headers })
      .then(r => alive && setBurndown(r.data))
      .catch(() => {});
    return () => { alive = false; };
  }, [ticket?.id, headers]);

  const generateSummary = async () => {
    setLoading(true);
    try {
      const r = await axios.post(`${API}/ai/proofread`, { text: `Summarise this support ticket in 1 sentence. Title: ${ticket.title}. Description: ${(ticket.description || "").slice(0, 1500)}` }, { headers });
      const d = r.data || {};
      const text = typeof d === "string" ? d : (d.improved || d.corrected || d.text || d.summary || null);
      setSummary(typeof text === "string" ? text : null);
    } catch { /* graceful fallback to heuristics */ }
    finally { setLoading(false); }
  };

  // Heuristic next-best-action
  const nextAction = (() => {
    if (ticket.blocked_by_ticket_number) return { label: `Resolve ${ticket.blocked_by_ticket_number} first`, tone: "rose", target: "blocker" };
    if (burndown?.breach) return { label: "SLA breached — escalate now", tone: "rose", target: "escalate" };
    if (burndown?.pct >= 75 && !burndown?.is_resolved) return { label: `${burndown.pct}% of SLA used — pick this up`, tone: "amber", target: "ack" };
    if (deviceStatus && (deviceStatus.status || "").toLowerCase() !== "online") return { label: "Device is offline — try Wake-on-LAN", tone: "amber", target: "wol" };
    if (deviceStatus?.needs_reboot) return { label: "Device needs reboot — schedule a window", tone: "cyan", target: "reboot" };
    if (deviceStatus?.checks_failing > 0) return { label: `${deviceStatus.checks_failing} check${deviceStatus.checks_failing === 1 ? "" : "s"} failing — investigate`, tone: "amber", target: "checks" };
    if (deviceStatus?.patches_pending > 0) return { label: `${deviceStatus.patches_pending} patches pending — install`, tone: "cyan", target: "patches" };
    if (!ticket.assignee_id) return { label: "Unassigned — pick this up or route", tone: "violet", target: "assign" };
    if (ticket.status === "open") return { label: "Acknowledge with first reply", tone: "violet", target: "reply" };
    if (ticket.status === "in_progress" && ticket.note_count === 0) return { label: "Add a status update note", tone: "violet", target: "note" };
    if (ticket.status === "resolved" && !ticket.csat_sent) return { label: "Send CSAT survey", tone: "emerald", target: "csat" };
    return { label: "Continue working — looks healthy", tone: "emerald", target: "none" };
  })();

  const toneStyle = {
    rose:    { bar: "from-rose-500/20 to-rose-500/0",       chip: "bg-rose-500/15 text-rose-300 border-rose-500/30" },
    amber:   { bar: "from-amber-500/20 to-amber-500/0",     chip: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
    cyan:    { bar: "from-cyan-500/20 to-cyan-500/0",       chip: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30" },
    violet:  { bar: "from-violet-500/20 to-violet-500/0",   chip: "bg-violet-500/15 text-violet-300 border-violet-500/30" },
    emerald: { bar: "from-emerald-500/20 to-emerald-500/0", chip: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  }[nextAction.tone];

  const ageHours = ticket.created_at ? Math.max(0, differenceInHours(new Date(), new Date(ticket.created_at))) : null;
  const ageLabel = ageHours == null ? "" : ageHours < 24 ? `${ageHours}h old` : `${Math.round(ageHours / 24)}d old`;

  return (
    <div data-testid="ai-copilot-strip" className={`relative overflow-hidden rounded-xl border border-white/[0.06] bg-gradient-to-r ${toneStyle.bar}`}>
      {/* Subtle scanline */}
      <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "repeating-linear-gradient(180deg, rgba(255,255,255,0.015) 0px, rgba(255,255,255,0.015) 1px, transparent 1px, transparent 3px)" }} />

      <div className="relative flex items-center gap-3 px-4 py-2.5">
        {/* Brand icon */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500/30 to-cyan-500/30 border border-white/10 flex items-center justify-center">
            <Sparkles className="w-3.5 h-3.5 text-violet-300" />
          </div>
          <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-violet-300/80">Co-Pilot</span>
        </div>

        {/* Stats strip */}
        <div className="flex items-center gap-3 text-[11px] text-zinc-500 font-mono">
          {ageLabel && <span data-testid="copilot-age">{ageLabel}</span>}
          {burndown?.available && (
            <span data-testid="copilot-sla">
              SLA <span className={burndown.breach ? "text-rose-400" : burndown.pct > 75 ? "text-amber-400" : "text-emerald-400"}>{burndown.pct}%</span>
            </span>
          )}
          {ticket.note_count != null && <span>{ticket.note_count} notes</span>}
          {deviceStatus && <span className={`${(deviceStatus.status || "").toLowerCase() === "online" ? "text-emerald-400" : "text-rose-400"}`}>● {deviceStatus.status || "?"}</span>}
        </div>

        <div className="flex-1" />

        {/* Optional summary text */}
        {summary && (
          <span className="text-[12px] text-zinc-300 truncate max-w-md italic" data-testid="copilot-summary">"{summary}"</span>
        )}

        {/* Next best action chip */}
        <button
          onClick={() => onActionClick?.(nextAction.target)}
          className={`group/cta flex items-center gap-1.5 px-2.5 py-1 rounded-md border ${toneStyle.chip} text-[11px] font-medium hover:scale-[1.02] transition-transform`}
          data-testid={`copilot-action-${nextAction.target}`}
        >
          <Zap className="w-3 h-3" />
          {nextAction.label}
          <ArrowRight className="w-3 h-3 opacity-50 group-hover/cta:translate-x-0.5 transition-transform" />
        </button>

        {/* Summarise toggle */}
        <Button
          variant="ghost" size="sm" className="h-7 px-2 text-[10px] font-mono uppercase tracking-wider text-zinc-400 hover:text-violet-300 hover:bg-violet-500/10"
          onClick={generateSummary} disabled={loading}
          data-testid="copilot-summarize"
        >
          {loading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : summary ? <RefreshCw className="w-3 h-3 mr-1" /> : <Sparkles className="w-3 h-3 mr-1" />}
          {summary ? "Re-summarise" : "Summarise"}
        </Button>
      </div>
    </div>
  );
}
