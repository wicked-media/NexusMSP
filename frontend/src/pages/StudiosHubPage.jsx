import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LayoutGrid, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { apiErrorMessage } from "@/lib/apiErrorMessage";
import {
  EMPTY_PRODUCT_DISCLOSURE,
  PROPOSALS_DISCLOSURE,
  PROPOSALS_HEADING,
  groupStudiosByProduct,
  isDeliveredProposal,
  productCoverage,
  proposalGates,
  proposalTarget,
} from "@/lib/studioProducts";

/**
 * `/studios` — the Studio Fleet hub.
 *
 * One listing, one status vocabulary, one spine: every studio in the fleet is
 * a registry entry with an honest capability status. Studios with open
 * admission say so here instead of presenting as ready.
 *
 * The listing is grouped by **product**, not flattened into one wall of cards:
 * Nexus presents a handful of major products and each holds the specialist
 * studios that operate it, so 130 operational problems never become 130
 * navigation entries (docs/NEXUS_INVENT_BATCH_5.md). A studio the server did
 * not file under a declared product is disclosed in its own section rather
 * than hidden.
 *
 * Each product also lists the catalogue the consolidation gave it
 * (docs/NEXUS_STUDIO_MERGE_REVIEW.md): a proposed studio is a plan and reads
 * like one, and an idea merged into capability the platform already owns says
 * where it went. Nothing here is rendered as delivered unless it is.
 */

const STATUS_STYLE = {
  Testing: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  "Production ready": "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  Implemented: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  "Partially implemented": "bg-blue-500/10 text-blue-400 border-blue-500/20",
  "In development": "bg-blue-500/10 text-blue-400 border-blue-500/20",
  "Architecture required": "bg-amber-500/10 text-amber-500 border-amber-500/20",
  "Discovery required": "bg-amber-500/10 text-amber-500 border-amber-500/20",
  "Production blocked": "bg-red-500/10 text-red-400 border-red-500/20",
};

const DELIVERED_PROPOSAL_TONE = "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
const UNBUILT_PROPOSAL_TONE = "bg-amber-500/10 text-amber-500 border-amber-500/20";

function ProposalRow({ proposal }) {
  const delivered = isDeliveredProposal(proposal);
  const target = proposalTarget(proposal);
  const gates = proposalGates(proposal);

  return (
    <li
      className="flex flex-col gap-1 border-b border-border/40 pb-2 last:border-b-0"
      data-testid={`proposal-${proposal.id}`}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-xs font-medium">{proposal.title}</span>
        <span
          data-testid={`proposal-disposition-${proposal.id}`}
          className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${
            delivered ? DELIVERED_PROPOSAL_TONE : UNBUILT_PROPOSAL_TONE
          }`}
        >
          {proposal.disposition_label || proposal.disposition}
        </span>
        {target ? (
          <span className="text-[11px] text-muted-foreground">{target}</span>
        ) : null}
      </div>
      {gates.length > 0 ? (
        <p className="text-[11px] text-muted-foreground">
          Blocked on {gates.join(" · ")}
        </p>
      ) : null}
      {proposal.note ? (
        <p className="text-[11px] text-muted-foreground leading-relaxed">{proposal.note}</p>
      ) : null}
    </li>
  );
}

function ProposalList({ section }) {
  if (section.proposals.length === 0) return null;
  return (
    <div
      className="rounded-lg border border-border/60 bg-muted/10 p-3"
      data-testid={`product-proposals-${section.id}`}
    >
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {PROPOSALS_HEADING}
      </p>
      <p className="text-[11px] text-muted-foreground mt-1">{PROPOSALS_DISCLOSURE}</p>
      <ul className="mt-2 flex flex-col gap-2">
        {section.proposals.map((proposal) => (
          <ProposalRow key={proposal.id} proposal={proposal} />
        ))}
      </ul>
    </div>
  );
}

function StudioCard({ studio }) {
  return (
    <Card
      className="hover:border-cyan-500/40 transition-colors"
      data-testid={`studio-card-${studio.id}`}
    >
      <CardContent className="pt-4 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold text-sm">{studio.name}</p>
            <p className="text-[11px] text-muted-foreground">
              {studio.domain} · {studio.priority} / {studio.release} · {studio.owner}
            </p>
          </div>
          <Badge
            variant="outline"
            className={`text-[9px] whitespace-nowrap ${STATUS_STYLE[studio.status] || "bg-slate-500/10 text-slate-400 border-slate-500/20"}`}
          >
            {studio.status}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{studio.tagline}</p>
        <div className="flex flex-wrap gap-1">
          {studio.wired_tabs.length > 0 ? (
            studio.wired_tabs.map((tab) => (
              <span
                key={tab}
                className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
              >
                {tab}
              </span>
            ))
          ) : (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20">
              admission open
            </span>
          )}
        </div>
        <div className="mt-auto flex gap-2 pt-1">
          <Button size="sm" className="h-8 text-xs" asChild>
            <a href={`/studios/${studio.id}`}>Open studio</a>
          </Button>
          {studio.home_route && (
            <Button size="sm" variant="outline" className="h-8 text-xs" asChild>
              <a href={studio.home_route}>Operating surface</a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function StudiosHubPage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [fleet, setFleet] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await axios.get(`${API}/studios`, { headers });
      setFleet(res.data);
    } catch (err) {
      setError(apiErrorMessage(err, "The studio fleet contract could not be loaded."));
    }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  if (error) {
    return (
      <div className="space-y-4" data-testid="fleet-error">
        <OperationalPageHeader eyebrow="Platform" title="Studio Fleet" description={error} icon={ShieldAlert} tone="amber" />
        <Button variant="outline" onClick={load}><RefreshCw className="w-4 h-4 mr-1" />Retry</Button>
      </div>
    );
  }

  if (!fleet) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-10">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading studio contracts…
      </div>
    );
  }

  const sections = groupStudiosByProduct(fleet);
  const coverage = productCoverage(sections);

  return (
    <div className="space-y-6" data-testid="studios-hub">
      <OperationalPageHeader
        eyebrow="Platform · one operating model"
        title="Studio Fleet"
        description={`${fleet.count} studios across ${coverage.productCount} products on one shared spine. A studio exists when its capability is admitted and registered — tabs render only evidence-backed contracts.`}
        icon={LayoutGrid}
        tone="cyan"
        actions={
          <Button variant="outline" onClick={load}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
        }
      />

      <Card>
        <CardContent className="pt-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">The shared spine</p>
          <div className="flex flex-wrap gap-1.5">
            {fleet.spine.map((tab) => (
              <span key={tab.id} className="text-[11px] px-2 py-1 rounded border border-border/60 text-muted-foreground">
                {tab.label}
              </span>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {fleet.note}
          </p>
        </CardContent>
      </Card>

      <div className="space-y-8">
        {sections.map((section) => (
          <section key={section.id} className="space-y-3" data-testid={`product-section-${section.id}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-2">
              <div>
                <h2 className="text-sm font-semibold">{section.name}</h2>
                {section.tagline ? (
                  <p className="text-[11px] text-muted-foreground mt-0.5">{section.tagline}</p>
                ) : null}
              </div>
              <p className="text-[11px] text-muted-foreground whitespace-nowrap">
                {section.count} studio{section.count === 1 ? "" : "s"}
                {section.planCount > 0 ? ` · ${section.planCount} proposed` : ""}
                {section.consolidatedCount > 0
                  ? ` · ${section.consolidatedCount} consolidated`
                  : ""}
              </p>
            </div>

            {section.studios.length === 0 ? (
              // An empty product with proposals is a plan with a catalogue, not a
              // missing product, so the disclosure only stands alone when there is
              // nothing else to say.
              section.proposals.length === 0 ? (
                <p className="text-xs text-muted-foreground" data-testid={`product-empty-${section.id}`}>
                  {EMPTY_PRODUCT_DISCLOSURE}
                </p>
              ) : null
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {section.studios.map((studio) => (
                  <StudioCard key={studio.id} studio={studio} />
                ))}
              </div>
            )}

            <ProposalList section={section} />

            {section.disclosure ? (
              <p
                className="text-[11px] text-amber-500"
                data-testid={`product-disclosure-${section.id}`}
              >
                {section.disclosure}
              </p>
            ) : null}
          </section>
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground">
        {fleet.product_note || "Products are the navigation boundary: every studio belongs to exactly one."}{" "}
        {fleet.proposal_note ? `${fleet.proposal_note} ` : ""}
        Statuses come from the capability admission gate, not from UI presence —
        see docs/NEXUS_STUDIO_FLEET.md, docs/NEXUS_STUDIO_MERGE_REVIEW.md,
        docs/NEXUS_INVENT_BATCH_5.md and docs/NEXUS_MASTER_CAPABILITY_REGISTER.md.
      </p>
    </div>
  );
}
