import { Check, Circle, ShieldCheck } from "lucide-react";

const defaultStages = ["Detected", "Diagnosed", "Fixed", "Verified", "Documented", "Billed"];

/**
 * A compact, reusable expression of Nexus' accountable-work promise.
 * It deliberately communicates state without relying on animation or colour alone.
 */
export default function NexusVerifiedSequence({ stages = defaultStages, complete = 0, label = "Nexus Verified", className = "" }) {
  const safeComplete = Math.max(0, Math.min(Number(complete) || 0, stages.length));
  const isFinished = safeComplete === stages.length;

  return <section className={`nexus-verified-sequence ${className}`.trim()} aria-label={`${label} workflow`}>
    <div className="nexus-verified-sequence__stages" role="list">
      {stages.map((stage, index) => {
        const state = index < safeComplete ? "complete" : index === safeComplete && !isFinished ? "active" : "pending";
        return <div className="nexus-verified-sequence__stage" data-state={state} key={stage} role="listitem">
          <span className="nexus-verified-sequence__marker" aria-hidden="true">
            {state === "complete" ? <Check /> : <Circle />}
          </span>
          <span>{stage}</span>
        </div>;
      })}
    </div>
    <div className="nexus-verified-sequence__seal" data-complete={isFinished} role="status" aria-live="polite">
      <ShieldCheck aria-hidden="true" />
      <span>
        <strong>{isFinished ? label : "Nexus in progress"}</strong>
        <small>{isFinished ? "Accountable outcome recorded" : `${safeComplete} of ${stages.length} stages complete`}</small>
      </span>
    </div>
  </section>;
}
