import { AlertTriangle, CheckCircle2, ShieldQuestion, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { riskTone } from "@/lib/remoteSessionStudio";

/**
 * Nexus Remote session risk.
 *
 * Presentation only: the score, band and factors are computed server-side from
 * the governed session record. The badge exists so a technician can read *why*
 * a session scores what it does, then act on the list rather than the number.
 */

const BAND_LABEL = {
  low: "Low",
  medium: "Medium",
  elevated: "Elevated",
  high: "High",
};

const BAND_ICON = {
  low: ShieldCheck,
  medium: ShieldQuestion,
  elevated: AlertTriangle,
  high: AlertTriangle,
};

export default function NexusRemoteRiskBadge({ risk, compact = false, testid = "remote-session-risk" }) {
  if (!risk || risk.band === "not_native") return null;
  const band = BAND_LABEL[risk.band] ? risk.band : "medium";
  const Icon = BAND_ICON[band];
  const raised = (risk.factors || []).filter((factor) => factor.state === "raised");
  const satisfied = (risk.factors || []).filter((factor) => factor.state === "satisfied");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
          aria-label={`Session risk ${BAND_LABEL[band]} — ${risk.score} of 100. ${raised.length} factor(s) raised.`}
          data-testid={`${testid}-trigger`}
        >
          <Badge variant="outline" className={`gap-1 ${riskTone(band)}`} data-testid={testid}>
            <Icon className="h-3 w-3" aria-hidden="true" />
            <span className={compact ? "" : "uppercase tracking-[0.12em]"}>{BAND_LABEL[band]}</span>
            <span className="font-mono text-[9px] opacity-80">{risk.score}</span>
            {risk.requires_step_up && <span className="text-[9px] uppercase">step-up</span>}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80" data-testid={`${testid}-factors`}>
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Session risk</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Derived only from this session&rsquo;s recorded consent, scope and transport evidence.
        </p>
        {risk.requires_step_up && (
          <p className="mt-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-2 py-1.5 text-[11px] text-amber-100">
            Step-up approval is advised before further privileged action in this session.
          </p>
        )}
        <div className="mt-3 space-y-1.5">
          {raised.map((factor) => (
            <div key={factor.key} className="flex items-start gap-2 rounded-lg border border-border/60 px-2 py-1.5" data-testid={`${testid}-factor-${factor.key}`}>
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-300" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-foreground">{factor.label} <span className="font-mono text-[9px] text-amber-300">+{factor.weight}</span></p>
                <p className="text-[10px] leading-4 text-muted-foreground">{factor.detail}</p>
              </div>
            </div>
          ))}
          {satisfied.map((factor) => (
            <div key={factor.key} className="flex items-start gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.04] px-2 py-1.5" data-testid={`${testid}-factor-${factor.key}`}>
              <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-300" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-foreground">{factor.label}</p>
                <p className="text-[10px] leading-4 text-muted-foreground">{factor.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
