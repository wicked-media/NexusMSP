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
 * Client Studio's evidence-backed portfolio brief.
 *
 * This is deliberately an adapter over `/client-health/dashboard`, not a
 * second health calculation.  The Client Health service already joins the
 * tenant/client-scoped canonical records and discloses missing dimensions.
 */

const STATUS_TONES = {
  healthy: "bg-emerald-500",
  watch: "bg-amber-500",
  at_risk: "bg-orange-500",
  critical: "bg-rose-500",
  unassessed: "bg-slate-400",
};

function clientRow(client) {
  const health = client?.health_score;
  return {
    key: client?.client_id,
    label: client?.client_name || "Client name not reported",
    meta: [
      <Observed key="status" value={client?.status} what="health band" />,
      <Observed key="score" value={health} what="health score" />,
      <Observed key="coverage" value={client?.evidence_coverage_pct} what="evidence coverage" />,
      `${client?.details?.open_tickets ?? "Not reported"} open tickets · ${client?.details?.devices ?? "Not reported"} managed devices`,
    ],
    status: client?.status || "unassessed",
    dotClass: statusDot(client?.status, STATUS_TONES),
    action: client?.client_id ? <a className="inline-flex h-7 items-center rounded-md border border-border bg-background px-2.5 text-[11px] font-medium hover:bg-muted" href={`/clients?client=${encodeURIComponent(client.client_id)}`}>Open client</a> : null,
  };
}

export default function ClientPortfolioPanel({ studio, spec }) {
  const { loading, data, error, reload, endpoint, unresolved } = useStudioObservation(spec);

  if (unresolved) return <ObservationUnbound spec={spec} />;

  const atRisk = Array.isArray(data?.at_risk) ? data.at_risk : [];
  const topClients = Array.isArray(data?.top_clients) ? data.top_clients : [];
  const alerts = Array.isArray(data?.alerts) ? data.alerts : [];

  return (
    <div className="space-y-3" data-testid="studio-client-portfolio">
      <ObservationHeader studio={studio} spec={spec} endpoint={endpoint} onRefresh={reload} />

      {loading && !data && <ObservationLoading label="Reading client health evidence…" />}
      {!loading && error && <ObservationError error={error} onRetry={reload} />}

      {!loading && !error && data && (
        <>
          <ObservedTotals
            totals={[
              { label: "Clients in scope", value: data.total, detail: "canonical client records inside server-side scope" },
              { label: "Assessed clients", value: data.assessed_clients, detail: "clients with sufficient independent evidence" },
              { label: "Average health", value: data.avg_health, detail: "only across assessed clients" },
              { label: "At risk", value: atRisk.length, detail: "lowest-scoring assessed clients, limited by the source" },
              { label: "Recorded critical alerts", value: alerts.length, detail: "computed from recorded evidence, not a provider certification" },
            ]}
          />

          {atRisk.length === 0 && topClients.length === 0 ? (
            <ObservedEmpty
              title="No assessed client health record is in scope"
              note="This does not claim the portfolio is healthy. Client health needs independent observed dimensions; the source reports missing evidence as unassessed."
            />
          ) : (
            <>
              {atRisk.length > 0 && <ObservedRows label="Priority client review" rows={atRisk.map(clientRow)} />}
              {topClients.length > 0 && <ObservedRows label="Highest assessed client health" rows={topClients.map(clientRow)} />}
            </>
          )}

          {alerts.length > 0 && (
            <ObservedRows
              label="Recorded critical evidence requiring review"
              rows={alerts.map((alert) => ({
                key: alert.id,
                label: alert.client_name || "Client not reported",
                meta: [
                  <Observed key="severity" value={alert.severity} what="severity" />,
                  <Observed key="evidence" value={alert.message} what="risk signal" />,
                  <Observed key="source" value={alert.source} what="evidence source" />,
                ],
                status: alert.severity,
                dotClass: statusDot(alert.severity, STATUS_TONES),
              }))}
            />
          )}

          <ObservationNote>
            This is the same Client Health projection used by the operational Clients workspace. It reads
            canonical client, device, ticket, invoice, contract, backup, security, Microsoft and network
            evidence inside server-side scope; it does not create a customer register, invent a score for
            incomplete evidence, or treat an empty alert list as proof that no issue exists.
          </ObservationNote>
        </>
      )}
    </div>
  );
}
