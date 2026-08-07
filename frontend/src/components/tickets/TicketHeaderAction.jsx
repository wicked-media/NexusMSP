import { Button } from "@/components/ui/button";

const TONES = {
  neutral: "border-white/[0.12] bg-black/10 text-zinc-100 hover:border-white/[0.20] hover:bg-white/[0.08]",
  accent: "border-cyan-400/25 bg-cyan-500/[0.08] text-cyan-100 hover:border-cyan-300/40 hover:bg-cyan-500/[0.16]",
  success: "border-emerald-400/25 bg-emerald-500 text-emerald-950 shadow-[0_8px_20px_rgba(16,185,129,0.22)] hover:bg-emerald-400",
  warning: "border-amber-400/35 bg-amber-400/15 text-amber-100 shadow-[0_8px_20px_rgba(245,158,11,0.12)] hover:bg-amber-400/25",
  compact: "w-9 border-white/[0.12] bg-black/10 text-zinc-100 hover:border-white/[0.20] hover:bg-white/[0.08]",
};

/**
 * Shared header action for SLA, Workshop and Cabling tickets.
 * Keep the visual grammar identical while allowing each workflow to expose
 * its own safe, context-specific action.
 */
export default function TicketHeaderAction({ icon: Icon, tone = "neutral", children, className = "", ...props }) {
  const compact = tone === "compact";
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={`h-9 rounded-lg border px-3 text-xs font-medium transition-colors ${TONES[tone] || TONES.neutral} ${compact ? "p-0" : ""} ${className}`}
      {...props}
    >
      {Icon && <Icon className={compact ? "h-3.5 w-3.5" : "mr-1.5 h-3.5 w-3.5"} />}
      {!compact && children}
    </Button>
  );
}
