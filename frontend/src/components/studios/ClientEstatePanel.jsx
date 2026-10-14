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
 * Client Studio's Inventory tab.
 *
 * The tab's registry contract names `GET /clients-enriched`, the projection the
 * Clients workspace already reads, so the studio shows the account rollup that
 * exists rather than a second idea of the book of business. Only the fields
 * this panel modelled are named; a value the API did not report is disclosed as
 * not reported, and a count the browser would have to invent is not shown at
 * all. No currency figure is rendered: this panel has no verified currency
 * convention and must not invent one.
 */

const RISK_TONES = {
  low: "bg-emerald-500",
  medium: "bg-amber-500",
  high: "bg-orange-500",
  critical: "bg-rose-500",
};

export default function ClientEstatePanel({ studio, spec }) {
  const { loading, data, error, reload, endpoint, unresolved } = useStudioObservation(spec);

  if (unresolved) return <ObservationUnbound spec={spec} />;

  const clients = Array.isArray(data?.clients) ? data.clients : [];
  const summary = data?.summary || {};

  return (
    <div className="space-y-3" data-testid="studio-client-estate">
      <ObservationHeader studio={studio} spec={spec} endpoint={endpoint} onRefresh={reload} />

      {loading && !data && <ObservationLoading label="Reading the client estate…" />}
      {!loading && error && <ObservationError error={error} onRetry={reload} />}

      {!loading && !error && data && (
        <>
          <ObservedTotals
            totals={[
              {
                label: "Clients in scope",
                value: summary.client_count,
                detail: "records inside the caller's server-side client scope",
              },
              {
                label: "Average health score",
                value: summary.avg_health,
                detail: "Nexus's own computed band over stored evidence",
              },
              {
                label: "At risk",
                value: summary.at_risk,
                detail: "clients whose computed band reaches at_risk or critical",
              },
              {
                label: "Endpoints assessed",
                value: summary.assessed_endpoints,
                detail: "devices carrying a recorded security assessment",
              },
              {
                label: "Patches pending",
                value: summary.patch_pending,
                detail: "outstanding patches across assessed endpoints",
              },
            ]}
          />

          {clients.length === 0 ? (
            <ObservedEmpty
              title="No client record is in your scope"
              note="This projection returns every client record the caller may see, so an empty list means none is in scope. It is not a claim that the business has no clients."
            />
          ) : (
            <ObservedRows
              label={`${clients.length} client record(s), in the order the API returned them`}
              rows={clients.map((client) => ({
                key: client.id,
                label: client.name,
                meta: [
                  <Observed key="tier" value={client.tier} what="tier" />,
                  <Observed key="lifecycle" value={client.lifecycle} what="lifecycle" />,
                  `${client.asset_count ?? 0} devices · ${client.open_tickets ?? 0} open tickets · ${client.active_contracts ?? 0} active contracts`,
                ],
                status: client.risk_level,
                dotClass: statusDot(client.risk_level, RISK_TONES),
                observedAt: client.last_activity,
              }))}
            />
          )}

          <ObservationNote>
            Every figure on this tab is the Clients projection's own rollup over canonical client, device,
            ticket and contract records, read with server-side tenant and client scope. A client with no
            linked device or ticket shows a real zero rather than an unmeasured value, and a field the API
            did not report is disclosed instead of blanked. Commercial value stays on the billing records
            this panel deliberately does not model, and nothing here changes a client record.
          </ObservationNote>
        </>
      )}
    </div>
  );
}
