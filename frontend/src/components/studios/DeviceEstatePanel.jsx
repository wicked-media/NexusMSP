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
 * Devices Studio's Inventory tab: the canonical endpoint estate, read through
 * the projection the studio was admitted against (`GET /devices`).
 *
 * The panel models a small, named set of the device record's fields and prints
 * the kit's not-reported disclosure for any of them the API did not return, so
 * an endpoint whose agent has never reported a version cannot look like one
 * that reported nothing wrong. The projection already excludes archived
 * (retired) records, which the totals and the empty state both say out loud —
 * a retired endpoint was not observed, it was retired.
 */

const ONLINE_DOTS = { online: "bg-emerald-500" };

export default function DeviceEstatePanel({ studio, spec }) {
  const { loading, data, error, reload, endpoint, unresolved } = useStudioObservation(spec);

  if (unresolved) {
    return <ObservationUnbound spec={spec} />;
  }

  const devices = Array.isArray(data) ? data : [];
  const online = devices.filter((device) => device.status === "online").length;
  const reportingVersion = devices.filter((device) => Boolean(device.agent_version)).length;

  return (
    <div className="space-y-3" data-testid="studio-device-estate">
      <ObservationHeader studio={studio} spec={spec} endpoint={endpoint} onRefresh={reload} />

      {loading && <ObservationLoading label="Reading the observed endpoint estate…" />}

      {!loading && error && <ObservationError error={error} onRetry={reload} />}

      {!loading && !error && devices.length === 0 && (
        <ObservedEmpty
          title="No endpoint record is in your scope"
          note={
            "This projection returns the canonical device records your tenant and client scope "
            + "permits, excluding archived (retired) endpoints. An empty read means exactly that: "
            + "nothing is observed here, which is not a claim that the estate is healthy or empty."
          }
        />
      )}

      {!loading && !error && devices.length > 0 && (
        <>
          <ObservedTotals
            totals={[
              {
                label: "Endpoints in scope",
                value: devices.length,
                detail: "Archived (retired) records are excluded by this projection.",
              },
              {
                label: "Reporting online",
                value: online,
                detail: "Counted from the status the last observation recorded.",
              },
              {
                label: "Agent version reported",
                value: reportingVersion,
                detail: `${devices.length - reportingVersion} endpoint(s) have not reported one.`,
              },
            ]}
          />
          <ObservedRows
            label="Observed endpoints"
            rows={devices.map((device) => ({
              key: device.id,
              label: device.name || device.hostname || device.id,
              meta: [
                <Observed value={device.client_name || device.client_id} what="client" />,
                <Observed value={device.os} what="operating system" />,
                <Observed value={device.ip_address} what="IP address" />,
                <Observed value={device.agent_version} what="agent version" />,
              ],
              status: device.status,
              dotClass: statusDot(device.status, ONLINE_DOTS),
              observedAt: device.last_seen || device.last_heartbeat,
            }))}
          />
        </>
      )}

      <ObservationNote>
        This is the canonical device record read through the Devices projection with server-side
        tenant and client scope — not a second inventory of it. A field the endpoint did not return
        is shown as not reported rather than guessed or filled with zero, and nothing on this tab
        changes an endpoint.
      </ObservationNote>
    </div>
  );
}
