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
  useStudioObservation,
} from "./StudioObservationKit";

/**
 * Communications Studio's Inventory tab, rendered over the recorded
 * customer-feedback projection that already exists (`GET /csat/dashboard`).
 *
 * The one thing this panel has to get right is the API's own empty state: when
 * nothing has been answered, the endpoint returns `avg_score: 0` with
 * `total_responses: 0`, and painting that as "0/5" would turn "nobody answered"
 * into "everyone said we were terrible". So the panel branches on the response
 * count first, and a score is only ever shown when responses exist.
 *
 * A record of what customers answered is also not a measure of Nexus's
 * delivery, and correspondence/notification delivery evidence is a separate
 * dimension this tab does not yet claim — both are said on the panel rather
 * than left for the reader to assume.
 */

/** Compose "<n> response(s)" only from a reported count. */
function responsesText(count) {
  return typeof count === "number" ? `${count} response${count === 1 ? "" : "s"}` : null;
}

/** Compose "<n>/5 average" only when the API reported a number. */
function averageText(avg) {
  return typeof avg === "number" ? `${avg}/5 average` : null;
}

export default function CommunicationsPanel({ studio, spec }) {
  const { loading, data, error, reload, endpoint, unresolved } = useStudioObservation(spec);

  if (unresolved) return <ObservationUnbound spec={spec} />;

  const totalResponses = typeof data?.total_responses === "number" ? data.total_responses : null;
  const byClient = Array.isArray(data?.by_client) ? data.by_client : [];
  const byTech = Array.isArray(data?.by_tech) ? data.by_tech : [];
  const distribution = data?.distribution || {};
  const distributionParts = [5, 4, 3, 2, 1]
    .filter((score) => typeof distribution[score] === "number" && distribution[score] > 0)
    .map((score) => `${score}: ${distribution[score]}`);
  const scored = Boolean(totalResponses);

  const totals = [
    { label: "Responses recorded", value: totalResponses },
    {
      label: "Average score",
      // Never a headline over nothing: the average is only ever shown when the
      // API also reported that responses exist.
      value: scored ? data.avg_score : null,
      detail: scored
        ? "The average of the survey responses customers actually submitted. A small number of responses is not a representative score."
        : null,
    },
    { label: "Clients with responses", value: data ? byClient.length : null },
    { label: "Technicians with responses", value: data ? byTech.length : null },
  ];

  return (
    <div className="space-y-3" data-testid="studio-communications-csat">
      <ObservationHeader studio={studio} spec={spec} endpoint={endpoint} onRefresh={reload} />

      {loading && <ObservationLoading label="Reading recorded customer feedback…" />}

      {!loading && error && <ObservationError error={error} onRetry={reload} />}

      {!loading && !error && data && !scored && (
        <ObservedEmpty
          title="No survey response is recorded in your scope"
          note="The CSAT projection answers with a zero average and no responses, and this panel states that instead of showing 0/5 — nobody answering is a response rate, not a satisfaction score."
          testId="studio-communications-empty"
        />
      )}

      {!loading && !error && data && scored && (
        <>
          <ObservedTotals totals={totals} testId="studio-communications-totals" />
          <ObservedRows
            rows={byClient.map((client) => ({
              key: client.name,
              label: client.name,
              meta: [
                <Observed key="count" value={responsesText(client.count)} what="response count" />,
                <Observed key="avg" value={averageText(client.avg)} what="average score" />,
              ],
              status: null,
              observedAt: null,
            }))}
            testId="studio-communications-clients"
            label="Averages by the client each response belongs to"
          />
          <ObservationNote testId="studio-communications-distribution">
            {distributionParts.length > 0
              ? `Recorded response distribution: ${distributionParts.join(" · ")}.`
              : "No response was recorded in any score band, so there is no distribution to show."}
          </ObservationNote>
        </>
      )}

      <ObservationNote testId="studio-communications-boundary">
        This projection is the recorded customer-feedback evidence Communications Studio is admitted
        for (CSAT/NPS), read with server-side tenant and client scope. It is a record of what
        customers answered rather than a measure of Nexus's delivery, correspondence and notification
        delivery evidence is a separate dimension this tab does not yet claim, a client or technician
        that has not been answered reports nothing rather than a score, and nothing on this tab sends
        a message.
      </ObservationNote>
    </div>
  );
}
