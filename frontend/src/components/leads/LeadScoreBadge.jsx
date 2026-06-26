/* LeadScoreBadge.jsx — 0-100 score chip with sub-score tooltip. */
import { Flame, ChevronDown } from "lucide-react";
import { useState } from "react";

function colorFor(score) {
  if (score >= 80) return "bg-orange-500/20 text-orange-300 border-orange-500/40";
  if (score >= 60) return "bg-amber-500/20 text-amber-300 border-amber-500/40";
  if (score >= 40) return "bg-sky-500/20 text-sky-300 border-sky-500/40";
  return "bg-zinc-500/20 text-zinc-400 border-zinc-500/30";
}

export default function LeadScoreBadge({ score, sub = {}, compact = false }) {
  const [open, setOpen] = useState(false);
  if (score == null) return null;
  const hot = score >= 80;
  return (
    <span className="relative inline-block" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} data-testid={`lead-score-${score}`}>
      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-mono ${colorFor(score)}`}>
        {hot && <Flame className="w-2.5 h-2.5" />}
        {score}
        {!compact && <ChevronDown className="w-2.5 h-2.5 opacity-50" />}
      </span>
      {open && sub && (sub.engagement != null) && (
        <div className="absolute z-50 left-0 top-full mt-1 w-44 bg-zinc-900/95 border border-violet-500/40 rounded-lg p-2 shadow-xl text-[10px] space-y-0.5 pointer-events-none">
          <Row k="Engagement" v={sub.engagement} />
          <Row k="Budget" v={sub.budget} />
          <Row k="Fit" v={sub.fit} />
          <Row k="Urgency" v={sub.urgency} />
        </div>
      )}
    </span>
  );
}

function Row({ k, v }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-zinc-400">{k}</span>
      <div className="flex items-center gap-1">
        <span className="w-12 h-1 rounded bg-zinc-800 overflow-hidden inline-block">
          <span className="block h-full bg-violet-400" style={{ width: `${Math.min(100, v || 0)}%` }} />
        </span>
        <span className="font-mono w-6 text-right text-zinc-200">{v ?? 0}</span>
      </div>
    </div>
  );
}
