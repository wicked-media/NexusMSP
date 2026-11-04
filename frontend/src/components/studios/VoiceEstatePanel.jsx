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
 * Voice Studio's Inventory tab: the PBXs the voice integration has linked,
 * read through the projection that already owns them (`GET /yeastar/pbxs`).
 *
 * The studio does not keep its own list of customer PBXs: it observes the voice
 * integration's records with server-side scope, so the workspace and the studio
 * cannot disagree about which PBXs exist or which are switched off.
 *
 * Two boundaries this panel is careful about:
 *
 * 1. **No credential material, ever.** The endpoint already strips
 *    `client_secret`, but it still returns `client_api_id` and the PBX URL, and
 *    neither belongs on a studio screen — so the panel renders neither, and only
 *    names the fields it modelled.
 * 2. **Switched off is a state, not a fault.** A linked-but-disabled PBX is
 *    counted separately from a healthy one, and a PBX that has never synced
 *    reports nothing rather than reading as a clean, current record.
 */

const ONLINE_DOTS = { online: "bg-emerald-500" };

/** Compose "<n> extensions" only when the projection reported the count. */
function extensionText(value) {
  return value === null || value === undefined || value === "" ? null : `${value} extensions`;
}

function billableText(value) {
  return value === null || value === undefined || value === "" ? null : `${value} billable`;
}

export default function VoiceEstatePanel({ studio, spec }) {
  const { loading, data, error, reload, endpoint, unresolved } = useStudioObservation(spec);

  if (unresolved) {
    return <ObservationUnbound spec={spec} />;
  }

  const pbxs = Array.isArray(data) ? data : [];
  const online = pbxs.filter((pbx) => pbx.status === "online").length;
  const enabled = pbxs.filter((pbx) => pbx.enabled === true).length;
  const reporting = pbxs.filter(
    (pbx) => pbx.extension_count !== null && pbx.extension_count !== undefined,
  );
  const extensionTotal = reporting.reduce((sum, pbx) => sum + Number(pbx.extension_count || 0), 0);

  return (
    <div className="space-y-3" data-testid="studio-voice-estate">
      <ObservationHeader studio={studio} spec={spec} endpoint={endpoint} onRefresh={reload} />

      {loading && <ObservationLoading label="Reading observed PBXs…" />}

      {!loading && error && <ObservationError error={error} onRetry={reload} />}

      {!loading && !error && pbxs.length === 0 && (
        <ObservedEmpty
          title="No PBX is linked in your scope"
          note={
            "This projection returns the voice integration's own PBX records inside your tenant and " +
            "client scope, so an empty read means nothing is linked here — not that the estate has no " +
            "voice. Nexus states that rather than showing a clean, empty voice estate."
          }
        />
      )}

      {!loading && !error && pbxs.length > 0 && (
        <>
          <ObservedTotals
            totals={[
              { label: "PBXs in scope", value: pbxs.length },
              {
                label: "Reporting online",
                value: online,
                detail: "Counted from the status the last observation recorded.",
              },
              {
                label: "Enabled for sync",
                value: enabled,
                detail:
                  enabled === pbxs.length
                    ? "Every linked PBX is switched on."
                    : `${pbxs.length - enabled} linked PBX(s) are switched off — a configuration state, not a fault.`,
              },
              {
                label: "Extensions reported",
                value: reporting.length > 0 ? extensionTotal : null,
                detail:
                  reporting.length === pbxs.length
                    ? "Every PBX reported an extension count."
                    : `${pbxs.length - reporting.length} PBX(s) have not reported an extension count.`,
              },
            ]}
          />
          <ObservedRows
            label="Linked PBXs"
            rows={pbxs.map((pbx) => ({
              key: pbx.id,
              label: pbx.name || pbx.pbx_url,
              meta: [
                <Observed key="client" value={pbx.client_name || pbx.client_id} what="client" />,
                <Observed key="extensions" value={extensionText(pbx.extension_count)} what="extension count" />,
                <Observed
                  key="billable"
                  value={billableText(pbx.billable_extension_count)}
                  what="billable extension count"
                />,
              ],
              status: pbx.status,
              dotClass: statusDot(pbx.status, ONLINE_DOTS),
              observedAt: pbx.last_sync || pbx.updated_at || pbx.created_at,
            }))}
          />
        </>
      )}

      <ObservationNote>
        These are the voice integration's own PBX records, read with server-side tenant and client
        scope; credential material is never returned or rendered on this tab. A PBX that has not
        synced reports nothing rather than a clean state, a switched-off PBX is disclosed as switched
        off, and nothing here changes a PBX.
      </ObservationNote>
    </div>
  );
}
