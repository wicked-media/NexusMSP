import AdmissionContractBrief from "./AdmissionContractBrief";
import ClientDigitalTwinOverview from "./ClientDigitalTwinOverview";

/**
 * The adopted Client Studio Overview projection.
 *
 * The admission contract is intentionally composed first, inside the same
 * projection region, so it cannot be separated from the surface it governs.
 */
export default function ClientOverviewProjection({ client, activity, healthDetail, onNavigate }) {
  return (
    <div className="space-y-3" data-testid="client-overview-projection">
      <AdmissionContractBrief />
      <ClientDigitalTwinOverview
        client={client}
        activity={activity}
        healthDetail={healthDetail}
        onNavigate={onNavigate}
      />
    </div>
  );
}
