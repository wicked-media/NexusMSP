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
 * Lead Studio's Inventory tab.
 *
 * The registry contract names `GET /leads`, the CRM's own lead records, so the
 * studio reads the pipeline that already exists instead of building a second
 * view of it. Two things this panel is careful about:
 *
 * 1. **It models only what the record carries.** A stage, owner, source or
 *    follow-up the lead record does not have is disclosed as not reported, so a
 *    sparse record cannot read as a lead with nothing outstanding.
 * 2. **It renders no money.** `estimated_value` is on the payload, but this
 *    panel has no verified currency convention and no rating behind it, so it
 *    is left unrendered rather than summed into a pipeline figure the studio
 *    cannot stand behind.
 */

const STAGE_TONES = {
  won: "bg-emerald-500",
  lost: "bg-rose-500",
  negotiation: "bg-sky-500",
  proposal: "bg-sky-500",
};

const TEXT = (value) => (value === null || value === undefined || value === "" ? null : String(value));

export default function LeadPipelinePanel({ studio, spec }) {
  const { loading, data, error, reload, endpoint, unresolved } = useStudioObservation(spec);

  if (unresolved) return <ObservationUnbound spec={spec} />;

  const leads = Array.isArray(data) ? data : [];
  const open = leads.filter((lead) => lead.status !== "won" && lead.status !== "lost").length;
  const converted = leads.filter((lead) => TEXT(lead.converted_to_client)).length;
  const withFollowUp = leads.filter((lead) => TEXT(lead.next_follow_up)).length;

  return (
    <div className="space-y-3" data-testid="studio-lead-pipeline">
      <ObservationHeader studio={studio} spec={spec} endpoint={endpoint} onRefresh={reload} />

      {loading && <ObservationLoading label="Reading the observed pipeline…" />}

      {!loading && error && <ObservationError error={error} onRetry={reload} />}

      {!loading && !error && leads.length === 0 && (
        <ObservedEmpty
          title="No lead record is in your scope"
          note="This projection returns every lead record the caller may read, so an empty list means the studio is observing an empty pipeline — not that the business has no pipeline."
        />
      )}

      {!loading && !error && leads.length > 0 && (
        <>
          <ObservedTotals
            totals={[
              { label: "Leads in scope", value: leads.length },
              {
                label: "Open",
                value: open,
                detail: "Records not yet marked won or lost — not a forecast.",
              },
              {
                label: "Converted to a client",
                value: converted,
                detail: "Records carrying a converted client, which is the record's own claim.",
              },
              {
                label: "With a follow-up recorded",
                value: withFollowUp,
                detail: "The rest carry no follow-up date rather than a missed one.",
              },
            ]}
          />
          <ObservedRows
            label="Observed leads, newest first"
            rows={leads.map((lead, index) => ({
              key: lead.id || `lead-${index}`,
              label: lead.company_name || lead.contact_name || lead.id,
              meta: [
                <Observed key="contact" value={TEXT(lead.contact_name)} what="contact" />,
                <Observed key="source" value={TEXT(lead.source)} what="source" />,
                <Observed
                  key="owner"
                  value={TEXT(lead.assigned_name || lead.assigned_to_name || lead.assigned_to)}
                  what="owner"
                />,
                <Observed
                  key="stage"
                  value={lead.pipeline_stage === null || lead.pipeline_stage === undefined
                    ? null
                    : `stage ${lead.pipeline_stage} of 6`}
                  what="stage"
                />,
              ],
              status: lead.status,
              dotClass: statusDot(lead.status, STAGE_TONES),
              observedAt: lead.last_contact || lead.updated_at || lead.created_at,
            }))}
          />
        </>
      )}

      <ObservationNote>
        This is the CRM's own lead record read through the Lead Studio projection with server-side
        tenant and client scope — not a second pipeline of it. A stage, owner or follow-up the record
        does not carry is shown as not reported rather than assumed, estimated value and the scoring,
        velocity and forecast views are separate projections this panel does not reproduce, and
        nothing on this tab moves a lead.
      </ObservationNote>
    </div>
  );
}
