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
 * Documentation Studio's Inventory tab: the documents the knowledge store
 * actually holds, read through the projection the studio was admitted against
 * (`GET /documentation`).
 *
 * The panel models the record's scope, category, editor and edit time — and
 * deliberately not its body. A documentation page's `content` is not this tab's
 * evidence, and rendering it would put arbitrary document text on a fleet
 * screen; `last_edited_by` is an internal identifier, so the display name is the
 * reportable field. A page with no client is shared MSP knowledge, which is a
 * real state rather than a missing value, so it is named as such instead of
 * being disclosed as unreported.
 *
 * Freshness and broken-link confidence are the reason this studio exists and are
 * not part of this projection: the panel says the dimension is not assessed
 * rather than implying a document is current because it has an edit time.
 */

export default function DocumentationInventoryPanel({ studio, spec }) {
  const { loading, data, error, reload, endpoint, unresolved } = useStudioObservation(spec);

  if (unresolved) {
    return <ObservationUnbound spec={spec} />;
  }

  const pages = Array.isArray(data) ? data : [];
  const shared = pages.filter((page) => !page.client_id).length;
  const clientScoped = pages.length - shared;
  const templates = pages.filter((page) => page.is_template === true).length;

  return (
    <div className="space-y-3" data-testid="studio-documentation-inventory">
      <ObservationHeader studio={studio} spec={spec} endpoint={endpoint} onRefresh={reload} />

      {loading && <ObservationLoading label="Reading observed documents…" />}

      {!loading && error && <ObservationError error={error} onRetry={reload} />}

      {!loading && !error && pages.length === 0 && (
        <ObservedEmpty
          title="No documentation page is in your scope"
          note={
            "This projection returns the pages your tenant and client scope permits, plus the " +
            "knowledge shared across every client. An empty read means nothing is authored or " +
            "visible here — never that documentation is complete."
          }
        />
      )}

      {!loading && !error && pages.length > 0 && (
        <>
          <ObservedTotals
            totals={[
              { label: "Documents in scope", value: pages.length },
              {
                label: "Shared (not client-linked)",
                value: shared,
                detail: "Readable by every technician, because a shared page has no client boundary.",
              },
              { label: "Client-scoped", value: clientScoped },
              {
                label: "Templates",
                value: templates,
                detail:
                  "The default list excludes templates, so a non-zero count here means the " +
                  "projection was asked for them explicitly.",
              },
            ]}
          />
          <ObservedRows
            label="Observed documents"
            rows={pages.map((page) => {
              const tags = Array.isArray(page.tags) && page.tags.length > 0
                ? `tags: ${page.tags.join(", ")}`
                : null;
              return {
                key: page.id,
                label: page.title,
                meta: [
                  // No client id means shared knowledge, which is a state Nexus
                  // can name; a client id with no recorded name is not reported.
                  page.client_id
                    ? <Observed value={page.client_name} what="client name" />
                    : "Shared MSP knowledge",
                  <Observed value={page.category} what="category" />,
                  <Observed value={page.last_edited_by_name} what="last editor" />,
                  tags && <Observed value={tags} what="tags" />,
                ].filter(Boolean),
                observedAt: page.updated_at,
              };
            })}
          />
        </>
      )}

      <ObservationNote>
        These are the knowledge store's own records, read with server-side scope: a client-restricted
        technician sees their clients' pages and the shared knowledge, never another client's. This
        projection carries an edit time but no freshness, confidence or broken-link verdict, so Nexus
        states no such claim here — that dimension is not yet assessed — and nothing on this tab
        edits, publishes or deletes a document.
      </ObservationNote>
    </div>
  );
}
