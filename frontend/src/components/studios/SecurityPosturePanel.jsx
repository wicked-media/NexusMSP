import {
  ObservationError,
  ObservationHeader,
  ObservationLoading,
  ObservationNote,
  ObservationUnbound,
  Observed,
  ObservedEmpty,
  ObservedRows,
  ObservedTotals,
  statusDot,
  useStudioObservation,
} from "./StudioObservationKit";

/**
 * Security Studio's Inventory tab: the persisted security evidence the Security
 * Dashboard already serves, read rather than re-derived.
 *
 * Two disclosures are the reason this panel is not just a row of numbers:
 *
 * - the projection's percentage and score are ``null`` until an endpoint has
 *   actually been assessed, so an unmeasured estate must not render as 0% or a
 *   score of zero;
 * - identity threat coverage is reported as ``identity_alerts: null`` with
 *   ``identity_source_configured: false``, which means no identity source is
 *   wired at all. Zero identity alerts and "nobody is measuring identity" look
 *   identical in a naive render and are completely different facts.
 *
 * The at-risk list is the projection's own subset (assessed endpoints with
 * pending patches); the incident list beside it is deliberately not modelled
 * here, because this panel would have to guess a shape the SOC workspace owns.
 */
export default function SecurityPosturePanel({ studio, spec }) {
  const { loading, data, error, reload, endpoint, unresolved } = useStudioObservation(spec);
  if (unresolved) return <ObservationUnbound spec={spec} />;

  const summary = data?.summary || {};
  const atRisk = Array.isArray(data?.devices_at_risk) ? data.devices_at_risk : [];
  const percent = (value) => (typeof value === "number" ? `${value}%` : value);

  const totals = [
    {
      label: "Agent-assessed endpoints",
      value: summary.security_assessed_endpoints,
      detail:
        "Endpoints with a recorded agent security assessment. The endpoints in scope are " +
        "the projection's own total; unassessed: not measured, so a large scope with few " +
        "assessed endpoints is a coverage gap, not a clean estate.",
    },
    {
      label: "Reported security score",
      value: summary.security_score,
      detail: "Average of the recorded assessed scores. Not reported means nothing has been assessed yet, never a score of zero.",
    },
    {
      label: "Reported patch compliance",
      value: percent(summary.patch_compliance_pct),
      detail: "Share of assessed endpoints the agent reported with no pending patches. Not reported means no endpoint has been assessed.",
    },
    {
      label: "Active threats",
      value: summary.active_threats,
      detail: "Open SOC alerts plus unresolved threat events in scope. This counts recorded detections; it is not a statement that none exist.",
    },
    {
      label: "Canary triggers",
      value: summary.canary_triggers,
      detail: "Unresolved canary triggers recorded in scope.",
    },
    {
      label: "Identity alerts",
      value: summary.identity_alerts,
      detail: summary.identity_source_configured
        ? "Open identity alerts from the configured identity source."
        : "No identity threat source is configured, so identity is unmeasured rather than at zero alerts.",
    },
    {
      label: "Endpoints reporting online",
      value: summary.endpoints_online,
      detail: "Agent-managed endpoints whose last reported status was online.",
    },
    {
      label: "Evidence state",
      value: summary.evidence_state,
      detail: "Whether the projection found any assessed endpoint behind it. not_assessed means every figure above is a coverage statement, not a posture.",
    },
  ];

  const rows = atRisk.map((device) => ({
    key: device.id,
    label: device.name,
    meta: [
      <Observed key="client" value={device.client_name} what="client" />,
      <Observed key="status" value={device.status ? `endpoint ${device.status}` : null} what="endpoint status" />,
      <Observed
        key="pending"
        value={typeof device.pending_patches === "number" ? `${device.pending_patches} pending patch(es)` : null}
        what="pending patches"
      />,
    ],
    status: device.patch_status,
    // The row's tone is the patch verdict it reports, so a device that is online
    // but patched behind never reads as a green row.
    dotClass: statusDot(device.patch_status, {
      current: "bg-emerald-500",
      needs_attention: "bg-amber-500",
      stale: "bg-amber-500",
      not_assessed: "bg-slate-500",
    }),
    observedAt: null,
  }));

  return (
    <div className="space-y-3" data-testid="studio-security-posture">
      <ObservationHeader studio={studio} spec={spec} endpoint={endpoint} onRefresh={reload} />
      {loading && <ObservationLoading label="Reading recorded security evidence…" />}
      {!loading && error && <ObservationError error={error} onRetry={reload} />}
      {!loading && !error && (
        <>
          <ObservedTotals totals={totals} />
          {atRisk.length > 0 ? (
            <ObservedRows label="Assessed endpoints carrying pending patches" rows={rows} />
          ) : (
            <ObservedEmpty
              title="No assessed endpoint is carrying pending patches"
              note={
                "That is the projection's at-risk subset, not a clean estate: an endpoint the " +
                "agent has never assessed is absent from this list and from every figure above. " +
                "Outstanding incidents are listed in the Security Operations workspace, which " +
                "this panel does not paraphrase."
              }
            />
          )}
          <ObservationNote testId="studio-security-evidence-source">
            Source: <span className="font-mono">{data?.source || "not-reported"}</span> — recorded Nexus
            evidence only. This projection refuses to generate scores or invent threat history, so
            every figure here is something an agent or a detection actually recorded.
          </ObservationNote>
          <ObservationNote>
            This is the evidence Security Studio was admitted against, read with server-side tenant
            and client scope. Per-endpoint observation times are not part of this projection, so the
            rows disclose that rather than implying freshness; containment, response and rollback
            remain separate, approval-gated actions that nothing on this tab performs.
          </ObservationNote>
        </>
      )}
    </div>
  );
}
