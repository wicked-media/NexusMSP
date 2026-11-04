import { ArrowUpRight, ShieldCheck } from "lucide-react";
import {
  ObservationError,
  ObservationHeader,
  ObservationLoading,
  ObservationNote,
  ObservationUnbound,
  ObservedEmpty,
  ObservedTotals,
  useStudioObservation,
} from "./StudioObservationKit";

const STATE_LABELS = {
  configuration: "Configure",
  provider_required: "Provider required",
  reference_only: "Reference only",
  verification_required: "Verification required",
  draft_only: "Draft only",
  evidence_required: "Evidence required",
};

/**
 * A route-backed Microsoft command catalogue. It intentionally navigates into
 * context-aware Control Plane workflows instead of turning tenant-changing
 * operations into blind buttons at the Studio level.
 */
export default function MicrosoftOperationsPanel({ studio, spec }) {
  const { loading, data, error, reload, endpoint, unresolved } = useStudioObservation(spec);
  if (unresolved) return <ObservationUnbound spec={spec} />;

  const capabilities = Array.isArray(data?.capabilities) ? data.capabilities : null;
  const connection = data?.connection || {};

  return (
    <div className="space-y-4" data-testid="studio-microsoft-operations">
      <ObservationHeader studio={studio} spec={spec} endpoint={endpoint} onRefresh={reload} />
      {loading && <ObservationLoading label="Reading governed Microsoft capabilities…" />}
      {!loading && error && <ObservationError error={error} onRetry={reload} />}
      {!loading && !error && capabilities && (
        <>
          <ObservedTotals totals={[
            { label: "Connection state", value: String(connection.state || "not_configured").replaceAll("_", " "), detail: "Saved credentials are not proof of provider authority." },
            { label: "Capabilities in this area", value: capabilities.length, detail: "Each remains tenant-scoped and permission-checked server-side." },
            { label: "Last connection test", value: connection.last_tested_at, detail: "Not reported until a connection test records evidence." },
            { label: "Last provider sync", value: connection.last_sync, detail: "A missing timestamp is a coverage gap, not a clean sync." },
          ]} />
          {capabilities.length ? (
            <div className="grid gap-3 xl:grid-cols-2" data-testid="studio-microsoft-capability-list">
              {capabilities.map((capability) => (
                <section key={capability.id} className="rounded-xl border border-border/70 bg-card p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{capability.label}</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{capability.description}</p>
                    </div>
                    <span className="shrink-0 rounded-full border border-border/70 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {STATE_LABELS[capability.execution_state] || capability.execution_state}
                    </span>
                  </div>
                  <div className="space-y-1.5 text-[11px] text-muted-foreground">
                    <p><span className="font-medium text-foreground">Permissions:</span> {(capability.permissions || []).join(" · ") || "Not reported"}</p>
                    <p><span className="font-medium text-foreground">Prerequisites:</span> {(capability.requires || []).join(" · ") || "Not reported"}</p>
                    <p className="font-mono text-[10px] leading-4">{(capability.routes || []).join("\n")}</p>
                  </div>
                  {capability.href ? (
                    <a className="inline-flex h-8 items-center rounded-md border border-border/70 px-3 text-xs font-medium transition-colors hover:border-cyan-400/40 hover:bg-cyan-400/[0.05]" href={capability.href}>
                      Open governed workflow <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" />
                    </a>
                  ) : null}
                </section>
              ))}
            </div>
          ) : (
            <ObservedEmpty
              title="No Microsoft capability is registered for this area"
              note="Nexus will not substitute a generic provider action for a missing capability contract."
              testId="studio-microsoft-capabilities-empty"
            />
          )}
          <div className="flex items-start gap-2 rounded-xl border border-sky-500/20 bg-sky-500/[0.04] p-3 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
            <p>Microsoft tenant actions remain available only from the contextual workflow after Nexus verifies the technician permission, Nexus client mapping, provider state and any required approval.</p>
          </div>
          <ObservationNote>{data?.boundary}</ObservationNote>
        </>
      )}
    </div>
  );
}
