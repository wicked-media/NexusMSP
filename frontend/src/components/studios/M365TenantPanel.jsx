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
 * M365 Studio's Inventory tab: the observed Microsoft tenant records.
 *
 * The studio was admitted on explicit client→tenant mapping, consent state and
 * licence evidence, so its Inventory reads the projection that already carries
 * that mapping (`GET /m365/tenants`) instead of counting tenants again. Only the
 * fields this payload is known to carry are named, and each goes through the
 * kit's `Observed`, so a tenant that has not reported a figure reads as not
 * reported rather than as a zero — a zero MFA percentage and an unreported MFA
 * percentage are very different statements about a customer's estate.
 *
 * Nothing here is a status: this projection carries no health verdict, so the
 * rows deliberately render no tone, and it carries no observation timestamp, so
 * no time is shown rather than a time invented to fill the column.
 */

/** Compose "<value> <unit>" only when the provider reported the number. */
function measured(value, unit) {
  return value === null || value === undefined || value === "" ? null : `${value} ${unit}`;
}

// The collection stores the display name as `name` (the Control Plane lists it
// that way) while other Microsoft records carry `tenant_name`; both are read so a
// mapped tenant is never labelled with its GUID while its name sits in the
// payload unread.
function tenantName(tenant) {
  return tenant.tenant_name || tenant.name || null;
}

function tenantKey(tenant) {
  return tenant.tenant_id || tenant.id || null;
}

function rowFor(tenant) {
  return {
    key: tenantKey(tenant),
    label: tenantName(tenant) || tenantKey(tenant),
    meta: [
      <Observed key="tenant-id" value={tenantKey(tenant)} what="tenant id" />,
      <Observed key="domain" value={tenant.default_domain || tenant.domain} what="default domain" />,
      <Observed key="users" value={measured(tenant.users_count, "users")} what="user count" />,
      <Observed
        key="mfa"
        value={measured(tenant.mfa_enrolled_pct, "% MFA enrolled")}
        what="MFA enrolment"
      />,
      <Observed
        key="secure-score"
        value={
          tenant.secure_score === null || tenant.secure_score === undefined
            ? null
            : `Secure Score ${tenant.secure_score}`
        }
        what="Secure Score"
      />,
    ],
    // This projection reports no verdict and no observation time; inventing
    // either would be a claim the API never made.
    status: null,
    observedAt: null,
  };
}

export default function M365TenantPanel({ studio, spec }) {
  const { loading, data, error, reload, endpoint, unresolved } = useStudioObservation(spec);

  if (unresolved) return <ObservationUnbound spec={spec} />;

  const tenants = Array.isArray(data) ? data : [];
  const withUsers = tenants.filter((tenant) => tenant.users_count !== null && tenant.users_count !== undefined).length;
  const withScore = tenants.filter((tenant) => tenant.secure_score !== null && tenant.secure_score !== undefined).length;

  return (
    <div className="space-y-3" data-testid="studio-m365-tenants">
      <ObservationHeader studio={studio} spec={spec} endpoint={endpoint} onRefresh={reload} />

      {loading && <ObservationLoading label="Reading observed Microsoft tenants…" />}

      {!loading && error && <ObservationError error={error} onRetry={reload} />}

      {!loading && !error && tenants.length === 0 && (
        <ObservedEmpty
          title="No Microsoft tenant record is in your scope"
          note="Tenant mapping is per client, so an empty read means nothing is mapped or observed in your scope — not that the customer's Microsoft estate is clean."
        />
      )}

      {!loading && !error && tenants.length > 0 && (
        <>
          <ObservedTotals
            totals={[
              {
                label: "Tenants in scope",
                value: tenants.length,
                detail: "records this tenant/client scope permits",
              },
              {
                label: "Tenants reporting a user count",
                value: withUsers,
                detail: `${tenants.length - withUsers} tenant record(s) carry no reported user count.`,
              },
              {
                label: "Tenants reporting a Secure Score",
                value: withScore,
                detail: "A tenant that has not reported one is not a tenant with a zero score.",
              },
            ]}
          />
          <ObservedRows label="Observed tenants" rows={tenants.map(rowFor)} />
        </>
      )}

      <ObservationNote>
        These are the Microsoft tenant records the graph connection already observed, read with
        server-side tenant and client scope — the mapping and licence evidence this studio was
        admitted on, not a second inventory of it. A figure the provider has not reported is shown
        as not reported rather than as zero, no credential or token is rendered, and nothing on
        this tab changes a tenant.
      </ObservationNote>
    </div>
  );
}
