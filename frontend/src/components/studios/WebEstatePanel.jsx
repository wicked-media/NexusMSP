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
 * Web Studio's Inventory tab, read through `GET /web-studio/fleet` — the fleet
 * command centre over the governed website record.
 *
 * The endpoint is careful about the difference between "nothing found" and "not
 * yet checked": each dimension comes with an `assessed` flag, so this panel
 * repeats that disclosure on the total rather than letting a zero read as a
 * clean bill of health. The `synergy` object the endpoint also returns is
 * another surface's connection state and is deliberately not rendered here.
 */

const ATTENTION_TONES = {
  healthy: "bg-emerald-500",
  attention: "bg-amber-500",
  critical: "bg-rose-500",
};

const NOT_ASSESSED = (dimension) =>
  `Not assessed: no website record carries ${dimension} evidence yet, so this figure reports nothing either way.`;

// The dimension's own `assessed` flag decides whether the count is a finding at
// all. A zero for an unassessed dimension would be read as "none found" by
// anyone scanning the numbers, so the figure is withheld instead of printed.
const assessedCount = (assessed, count) => (assessed ? count : "Not assessed");

export default function WebEstatePanel({ studio, spec }) {
  const { loading, data, error, reload, endpoint, unresolved } = useStudioObservation(spec);

  if (unresolved) return <ObservationUnbound spec={spec} />;

  const summary = data?.summary || {};
  const assessed = summary.assessed || {};
  const sites = Array.isArray(data?.sites) ? data.sites : [];

  const totals = [
    {
      label: "Managed websites",
      value: summary.managed_websites,
      detail: "Website records in the caller's scope, archived records excluded by the projection.",
    },
    {
      label: "Plugin updates recorded",
      value: assessedCount(assessed.plugins, summary.plugin_updates),
      detail: assessed.plugins
        ? "Counted from the plugin inventory recorded on each website record."
        : NOT_ASSESSED("plugin inventory"),
    },
    {
      label: "Security findings",
      value: assessedCount(assessed.security, summary.security_findings),
      detail: assessed.security
        ? "Findings recorded against the website records in scope."
        : NOT_ASSESSED("security findings"),
    },
    {
      label: "Backup warnings",
      value: assessedCount(assessed.backups, summary.backup_warnings),
      detail: assessed.backups
        ? "Website records whose recorded backup evidence is not current."
        : NOT_ASSESSED("backup evidence"),
    },
    {
      label: "Sites needing attention",
      value: summary.attention_count,
      detail: "Records the projection classified as attention or critical, with a named reason.",
    },
  ];

  return (
    <div className="space-y-3" data-testid="studio-web-estate">
      <ObservationHeader studio={studio} spec={spec} endpoint={endpoint} onRefresh={reload} />

      {loading && !data && <ObservationLoading label="Reading the website record…" />}
      {!loading && error && <ObservationError error={error} onRetry={reload} />}

      {!loading && !error && data && (
        <>
          <ObservedTotals totals={totals} />

          {sites.length === 0 ? (
            <ObservedEmpty
              title="No managed website record is in your scope"
              note="This projection returns the website records the caller may see, so an empty list means none is in scope — an observation, not a clean web estate."
            />
          ) : (
            <ObservedRows
              label="Observed websites"
              rows={sites.map((site) => {
                const reasons = Array.isArray(site.attention?.reasons) ? site.attention.reasons : [];
                return {
                  key: site.id,
                  label: site.name || site.primary_domain,
                  meta: [
                    <Observed key="client" value={site.client_name || site.client_id} what="client" />,
                    <Observed key="domain" value={site.primary_domain} what="primary domain" />,
                    <Observed key="platform" value={site.platform} what="platform" />,
                    <Observed key="wp" value={site.wordpress_version} what="WordPress version" />,
                    reasons[0] || null,
                  ].filter(Boolean),
                  status: site.attention?.level,
                  dotClass: statusDot(site.attention?.level, ATTENTION_TONES),
                  observedAt: site.last_health_check_at || site.last_wordpress_sync_at,
                };
              })}
            />
          )}
        </>
      )}

      <ObservationNote>
        Every figure on this tab is derived from evidence already stored on the website record, read
        with server-side tenant and client scope; a dimension that has never been assessed is
        reported as not assessed rather than as a zero. A row with no attention reason means the
        recorded evidence raises none — not a guarantee about the site — and nothing on this tab
        updates a website.
      </ObservationNote>
    </div>
  );
}
