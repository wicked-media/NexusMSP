import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useSearchParams } from "react-router-dom";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState, LoadingState } from "@/components/design-system";
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  LayoutGrid,
  RefreshCw,
  Search,
  SearchX,
  ShieldAlert,
} from "lucide-react";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { apiErrorMessage } from "@/lib/apiErrorMessage";
import {
  ENTRY_KINDS,
  KIND_LABELS,
  NO_MATCH_DISCLOSURE,
  UNKNOWN_TIER,
  buildCatalogueIndex,
  catalogueFacets,
  catalogueQueryString,
  catalogueSummary,
  isCatalogueFiltered,
  searchCatalogue,
  tierLabel,
} from "@/lib/studioCatalogue";
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
 * `/studios` — Nexus Studios: one searchable catalogue of the studio fleet.
 *
 * Nexus proposes 185+ studios across 14 products in three commercial tiers.
 * Listing one navigation entry per studio is how a capability becomes
 * unfindable, so the fleet is presented as a catalogue a technician searches
 * (docs/NEXUS_INVENT_BATCH_6.md) and the sidebar carries one link to it.
 *
 * The catalogue is still two different things, and it says so:
 *
 * - an **admitted studio** is a registry entry with an honest capability status
 *   and an operating surface; the index links to `/studios/<id>`;
 * - a **catalogue idea** is a proposal from the consolidation register with the
 *   disposition it was given, and it renders as a plan — never as a shipped
 *   workspace. A plan that has no surface does not get a button that opens
 *   nothing.
 *
 * Two views, one index: with no search or facet set, the fleet reads as the
 * product sections it always did, because the product is the navigation
 * boundary. As soon as the technician narrows anything, the page answers with a
 * ranked flat list over admitted studios *and* catalogue ideas, which is the
 * whole point of a catalogue — the batch-6 communications studios sit beside the
 * Voice Studio that already owns voice, and one search finds both.
 *
 * The filters live in the address (`?q=`, `?tier=`, `?kind=`), not in component
 * state: a narrowed catalogue is a link a technician can paste to a colleague,
 * and it is how the command palette hands a topic over. The contract itself is
 * `parseCatalogueQuery`/`catalogueQueryString` in `@/lib/studioCatalogue`, so the
 * page and the palette cannot disagree about what a catalogue URL means.
 */

/**
 * A status is a claim about capability, so it reads through the design system's
 * own chip scale (`--nx-chip-*`) rather than a fixed Tailwind literal: the light
 * theme restates each hue deep enough to stay legible on the card it sits on
 * (docs/NEXUS_EXPERIENCE_STANDARD.md).
 */
const STATUS_TONE = {
  Testing: "border-chip-emerald/30 bg-chip-emerald/5 text-chip-emerald",
  "Production ready": "border-chip-emerald/30 bg-chip-emerald/5 text-chip-emerald",
  Implemented: "border-chip-sky/30 bg-chip-sky/5 text-chip-sky",
  "Partially implemented": "border-chip-sky/30 bg-chip-sky/5 text-chip-sky",
  "In development": "border-chip-sky/30 bg-chip-sky/5 text-chip-sky",
  "Architecture required": "border-chip-amber/30 bg-chip-amber/5 text-chip-amber",
  "Discovery required": "border-chip-amber/30 bg-chip-amber/5 text-chip-amber",
  "Production blocked": "border-chip-rose/30 bg-chip-rose/5 text-chip-rose",
};

/** Delivered capability is the only tone that may read as success. */
const DELIVERED_PROPOSAL_TONE = "border-chip-emerald/30 bg-chip-emerald/5 text-chip-emerald";
const UNBUILT_PROPOSAL_TONE = "border-chip-amber/30 bg-chip-amber/5 text-chip-amber";
const NEUTRAL_TONE = "border-border bg-muted/40 text-muted-foreground";
const CHIP = "rounded border px-1.5 py-0.5 text-[10px]";

/** The declared packaging for a tier id, so a card states only what the server said. */
function declaredTier(fleet, tierId) {
  return (
    (Array.isArray(fleet?.tiers) ? fleet.tiers : []).find((entry) => entry?.id === tierId) || null
  );
}

function Chip({ tone = NEUTRAL_TONE, children, className = "", ...props }) {
  return (
    <span className={`${CHIP} ${tone} ${className}`} {...props}>
      {children}
    </span>
  );
}

/** One figure in the portfolio rail. Derived from the payload, never invented. */
function StatTile({ label, value, hint, testid }) {
  return (
    <div className="bg-card/80 px-4 py-3.5" data-testid={testid}>
      <dt className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1.5 text-2xl font-semibold leading-none tabular-nums">{value}</dd>
      {hint ? <p className="mt-1.5 text-[10px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * A tier is the commercial packaging of the same portfolio, so it is presented
 * as a statement rather than a control: the facet chips below are the control,
 * and the same action in two places is how a screen starts contradicting itself.
 */
function TierCard({ tier, productCount, testid }) {
  const studios = Number(tier.studio_count || 0);
  const planned = Number(tier.planned_count || 0);
  return (
    <li
      className="nx-card relative overflow-hidden rounded-xl border border-border/60 bg-card/60 p-4"
      data-testid={testid}
    >
      <span
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent"
        aria-hidden="true"
      />
      <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
        {tier.label || tier.id}
      </p>
      {tier.blurb ? (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{tier.blurb}</p>
      ) : null}
      <p className="mt-3 text-[11px] text-foreground">
        {productCount} product{productCount === 1 ? "" : "s"}
        {studios > 0 ? ` · ${studios} studio${studios === 1 ? "" : "s"}` : ""}
        {planned > 0 ? ` · ${planned} proposed` : ""}
      </p>
    </li>
  );
}

function ProposalRow({ proposal }) {
  const delivered = isDeliveredProposal(proposal);
  const target = proposalTarget(proposal);
  const gates = proposalGates(proposal);

  return (
    <li
      className="flex flex-col gap-1 border-b border-border/40 pb-2.5 last:border-b-0 last:pb-0"
      data-testid={`proposal-${proposal.id}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium">{proposal.title}</span>
        <Chip
          tone={delivered ? DELIVERED_PROPOSAL_TONE : UNBUILT_PROPOSAL_TONE}
          className="whitespace-nowrap"
          data-testid={`proposal-disposition-${proposal.id}`}
        >
          {proposal.disposition_label || proposal.disposition}
        </Chip>
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
        <p className="text-[11px] leading-relaxed text-muted-foreground">{proposal.note}</p>
      ) : null}
    </li>
  );
}

function ProposalList({ section }) {
  if (section.proposals.length === 0) return null;
  return (
    <details
      className="group rounded-xl border border-border/60 bg-muted/[0.12]"
      data-testid={`product-proposals-${section.id}`}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 marker:hidden">
        <span className="min-w-0">
          <span className="block text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Portfolio decisions
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">
            {section.proposals.length} proposal{section.proposals.length === 1 ? "" : "s"} and consolidation decision{section.proposals.length === 1 ? "" : "s"}
          </span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-2 text-[11px] font-medium text-foreground">
          Review register <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="border-t border-border/60 px-4 pb-4 pt-3.5">
        <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {PROPOSALS_HEADING}
        </p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{PROPOSALS_DISCLOSURE}</p>
        <ul className="mt-3 flex flex-col gap-3">
          {section.proposals.map((proposal) => (
            <ProposalRow key={proposal.id} proposal={proposal} />
          ))}
        </ul>
      </div>
    </details>
  );
}

function StudioCard({ studio, tier }) {
  const wiredCount = studio.wired_tabs.length;
  const tabCount = studio.spine.length;
  const canLaunch = Boolean(studio.home_route);
  return (
    <Card
      className="nx-card flex flex-col hover:border-primary/40"
      data-testid={`studio-card-${studio.id}`}
    >
      <CardContent className="flex flex-1 flex-col gap-3 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-tight">{studio.name}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {studio.domain} · {studio.priority} / {studio.release} · {studio.owner}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Badge
              variant="outline"
              className={`whitespace-nowrap text-[9px] ${STATUS_TONE[studio.status] || NEUTRAL_TONE}`}
            >
              {studio.status}
            </Badge>
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {wiredCount}/{tabCount} areas live
            </span>
          </div>
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">{studio.tagline}</p>

        {tier ? <Chip tone={NEUTRAL_TONE}>{tier}</Chip> : null}

        <div className="rounded-lg border border-border/60 bg-muted/[0.16] px-3 py-2">
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Technician readiness
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {wiredCount > 0
              ? `${wiredCount} evidence-backed area${wiredCount === 1 ? "" : "s"} available now${canLaunch ? "; the linked workspace is ready to use." : "."}`
              : "admission open — no live operating area is admitted yet; review the contract before planning work here."}
          </p>
          {wiredCount > 0 ? <p className="mt-1 text-[10px] text-muted-foreground">Live: {studio.wired_tabs.join(" · ")}</p> : null}
        </div>

        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          <Button size="sm" className="h-8 text-xs" asChild>
            <a href={`/studios/${studio.id}`}>Studio brief</a>
          </Button>
          {canLaunch && (
            <Button size="sm" variant="outline" className="h-8 text-xs" asChild>
              <a href={studio.home_route}>Open workspace <ArrowUpRight className="ml-1 h-3 w-3" /></a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** A small launch card for the working surfaces technicians can use today. */
function ReadyStudioCard({ studio }) {
  const wiredCount = studio.wired_tabs.length;
  return (
    <li className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-card/65 p-3 transition-colors hover:border-primary/40" data-testid={`ready-studio-${studio.id}`}>
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold tracking-tight">{studio.name}</p>
        <p className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {wiredCount} live area{wiredCount === 1 ? "" : "s"}
        </p>
      </div>
      <Button size="sm" className="h-7 shrink-0 text-[11px]" asChild>
          <a href={studio.home_route}>Open workspace <ArrowUpRight className="ml-1 h-3 w-3" /></a>
      </Button>
    </li>
  );
}

const PRIORITY_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 };

/**
 * The delivery rail deliberately reports admission gaps rather than making a
 * roadmap look like an operational queue. It answers a platform-owner's
 * question ("where is the next real boundary?") without creating a pretend
 * technician action for work that has not been admitted.
 */
function DeliveryQueueCard({ studio }) {
  const pendingTabs = (Array.isArray(studio.spine) ? studio.spine : [])
    .filter((tabId) => !(Array.isArray(studio.wired_tabs) ? studio.wired_tabs : []).includes(tabId));
  const nextArea = pendingTabs[0] || null;
  const isOpen = studio.admission_state !== "complete" || studio.wired_tabs.length === 0;

  return (
    <li
      className="flex min-w-0 flex-col gap-2 rounded-xl border border-border/60 bg-card/65 p-3"
      data-testid={`studio-delivery-${studio.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold tracking-tight">{studio.name}</p>
          <p className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {studio.priority || "Unprioritised"} · {studio.status}
          </p>
        </div>
        <Chip tone={isOpen ? UNBUILT_PROPOSAL_TONE : NEUTRAL_TONE} className="shrink-0 whitespace-nowrap">
          {isOpen ? "Admission open" : `${pendingTabs.length} area${pendingTabs.length === 1 ? "" : "s"} pending`}
        </Chip>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {nextArea
          ? `Next unadmitted area: ${nextArea}. Review scope, evidence source and safety gates before implementation.`
          : "No additional area is declared in the shared spine."}
      </p>
      <div className="mt-auto flex items-center justify-between gap-2 pt-0.5">
        <span className="text-[10px] text-muted-foreground">
          {studio.wired_tabs.length}/{studio.spine.length} live
        </span>
        <Button size="sm" variant="outline" className="h-7 text-[11px]" asChild>
          <a href={`/studios/${studio.id}`}>Review brief <ArrowUpRight className="ml-1 h-3 w-3" /></a>
        </Button>
      </div>
    </li>
  );
}

/**
 * One catalogue search result.
 *
 * An admitted studio says its status and can be opened. A catalogue idea says
 * the disposition it was given and what blocks it, and only renders a link when
 * a registered studio actually owns that surface — a plan that opens nothing is
 * worse than a plan that says it is a plan.
 */
function CatalogueRow({ entry }) {
  const admitted = entry.kind === ENTRY_KINDS.studio;
  const tone = admitted
    ? STATUS_TONE[entry.status] || NEUTRAL_TONE
    : entry.disposition === "served"
      ? DELIVERED_PROPOSAL_TONE
      : UNBUILT_PROPOSAL_TONE;

  return (
    <li
      className="nx-card flex flex-col gap-2.5 rounded-xl border border-border/60 bg-card/50 p-4 hover:border-primary/40"
      data-testid={`catalogue-result-${entry.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {KIND_LABELS[entry.kind] || entry.kind}
          </p>
          <p className="mt-1 text-sm font-semibold tracking-tight">{entry.name}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {entry.productName}
            {entry.tierLabel ? ` · ${entry.tierLabel}` : ""}
          </p>
        </div>
        <Chip tone={tone} className="shrink-0 whitespace-nowrap">
          {entry.status}
        </Chip>
      </div>

      {entry.summary ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{entry.summary}</p>
      ) : null}
      {entry.target ? <p className="text-[11px] text-muted-foreground">{entry.target}</p> : null}
      {entry.gates.length > 0 ? (
        <Chip tone={UNBUILT_PROPOSAL_TONE} className="w-fit">
          Blocked on {entry.gates.join(" · ")}
        </Chip>
      ) : null}

      {entry.href ? (
        <Button size="sm" variant="outline" className="mt-auto h-7 w-fit text-xs" asChild>
          <a href={entry.href}>{admitted ? "Open studio" : "Open the studio that owns it"}</a>
        </Button>
      ) : (
        <p className="mt-auto text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70">
          No operating surface yet
        </p>
      )}
    </li>
  );
}

/** A toggle chip that keeps the shared Button contract and states its state. */
function FacetChip({ active, label, count, testid, onClick }) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "default" : "outline"}
      className="h-7 gap-1.5 rounded-full px-3 text-[11px]"
      aria-pressed={active}
      onClick={onClick}
      data-testid={testid}
    >
      {label}
      {/* The count is a fact, not decoration: dimming it with a sub-1 opacity dropped it
          to about 3:1 on the light theme's filled chip, so it now reads at the same
          weight as the label and takes its hierarchy from size and tabular figures. */}
      <span className="text-[10px] tabular-nums">{count}</span>
    </Button>
  );
}

export default function StudiosHubPage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [params, setParams] = useSearchParams();
  const [fleet, setFleet] = useState(null);
  const [error, setError] = useState(null);

  // The address is the state: every filter below reads from it, so a pasted
  // link opens the same catalogue it was copied from.
  const query = params.get("q") || "";
  const tier = params.get("tier") || "";
  const kind = params.get("kind") || "";

  const applyFilters = useCallback(
    (updates) => {
      setParams(
        catalogueQueryString({ query, tier, kind, ...updates }, params),
        // Typing is not navigation: replacing the entry keeps the back button
        // pointing at the workspace the technician arrived from.
        { replace: true },
      );
    },
    [params, query, setParams, tier, kind],
  );

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

  // The index is built from whatever the payload carries, so an older response
  // with no tier metadata still searches — it simply has no tier facet.
  const entries = useMemo(() => buildCatalogueIndex(fleet), [fleet]);
  const facets = useMemo(() => catalogueFacets(entries), [entries]);
  const filtered = isCatalogueFiltered({ query, tier, kind });
  const visible = useMemo(
    () => searchCatalogue(entries, { query, tier, kind }),
    [entries, query, tier, kind],
  );
  const declaredTiers = useMemo(
    () => facets.tiers.filter((entry) => entry.id !== UNKNOWN_TIER),
    [facets],
  );
  // How many products each tier actually holds, counted over the whole index.
  const tierProducts = useMemo(() => {
    const counts = new Map();
    for (const entry of facets.products) {
      if (!entry.tier) continue;
      counts.set(entry.tier, (counts.get(entry.tier) || 0) + 1);
    }
    return counts;
  }, [facets]);

  const clear = useCallback(() => applyFilters({ query: "", tier: "", kind: "" }), [applyFilters]);

  if (error) {
    return (
      <div className="space-y-4">
        <OperationalPageHeader
          eyebrow="Platform"
          title="Nexus Studios"
          description="The studio fleet contract could not be read, so no catalogue is shown and nothing about the fleet has been inferred from the failure."
          icon={ShieldAlert}
          tone="amber"
        />
        <Card>
          <CardContent className="p-0">
            <ErrorState
              icon={<ShieldAlert className="h-7 w-7" />}
              title="Nexus Studios could not be loaded"
              description="No studio, product or catalogue idea is shown. Retry the read before treating the fleet as empty."
              error={error}
              onRetry={load}
              retryLabel="Retry the fleet read"
              testid="fleet-error"
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!fleet) {
    return (
      <div className="space-y-4">
        <OperationalPageHeader
          eyebrow="Platform · one operating model"
          title="Nexus Studios"
          description="Reading the studio fleet contract. No count is shown until the contract has been read."
          icon={LayoutGrid}
          tone="cyan"
        />
        <Card>
          <CardContent className="p-0">
            <LoadingState label="Reading the studio fleet contract…" rows={4} testid="fleet-loading" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const sections = groupStudiosByProduct(fleet);
  const coverage = productCoverage(sections);
  const ideaCount = entries.length - fleet.count;
  const productsById = new Map(
    (Array.isArray(fleet.products) ? fleet.products : []).map((product) => [product.id, product]),
  );

  const stats = [
    {
      id: "studios",
      label: "Admitted studios",
      value: fleet.count,
      hint: "Each with a status and an operating surface",
    },
    {
      id: "products",
      label: "Products",
      value: coverage.productCount,
      hint: "The navigation boundary",
    },
    ...(declaredTiers.length > 0
      ? [{ id: "tiers", label: "Tiers", value: declaredTiers.length, hint: "Commercial packaging" }]
      : []),
    {
      id: "ideas",
      label: "Catalogue ideas",
      value: ideaCount,
      hint: "Proposed, consolidated or already served",
    },
  ];
  const readyStudios = (Array.isArray(fleet.studios) ? fleet.studios : [])
    .filter((studio) => studio.home_route && studio.wired_tabs.length > 0)
    .sort((left, right) => right.wired_tabs.length - left.wired_tabs.length || left.name.localeCompare(right.name))
    .slice(0, 4);
  const deliveryQueue = (Array.isArray(fleet.studios) ? fleet.studios : [])
    .filter((studio) => {
      const spine = Array.isArray(studio.spine) ? studio.spine : [];
      const wired = Array.isArray(studio.wired_tabs) ? studio.wired_tabs : [];
      return studio.admission_state !== "complete" || wired.length < spine.length;
    })
    .sort((left, right) => {
      const priority = (PRIORITY_ORDER[left.priority] ?? 99) - (PRIORITY_ORDER[right.priority] ?? 99);
      if (priority !== 0) return priority;
      const leftGaps = left.spine.length - left.wired_tabs.length;
      const rightGaps = right.spine.length - right.wired_tabs.length;
      return rightGaps - leftGaps || left.name.localeCompare(right.name);
    })
    .slice(0, 6);
  const masterRegister = fleet.master_register;

  return (
    <div className="space-y-6" data-testid="studios-hub">
      <OperationalPageHeader
        eyebrow="Platform · one operating model"
        title="Nexus Studios"
        description={`${fleet.count} Studios across ${coverage.productCount} product families on one shared operating spine, plus ${ideaCount} catalogue ideas. Product families organise the portfolio; a Studio is the specialist operating capability a technician opens when the work calls for it.`}
        icon={LayoutGrid}
        tone="cyan"
        actions={
          <Button variant="outline" onClick={load}>
            <RefreshCw className="mr-1 h-4 w-4" />Refresh
          </Button>
        }
      />

      {/* The portfolio statement: what the fleet is, and how it is packaged. */}
      <Card className="nx-ambient-surface" data-testid="nexus-studios-masthead">
        <CardContent className="p-5 md:p-6">
          <div className="flex flex-col gap-6 2xl:flex-row 2xl:items-start 2xl:justify-between">
            <div className="max-w-xl space-y-3">
              <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-muted-foreground">
                The Nexus Studios portfolio
              </p>
              <h2 className="text-xl font-semibold tracking-tight">
                {fleet.count} Studios, {coverage.productCount} product families, one operating model
              </h2>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {fleet.product_note ||
                  "Products are the navigation boundary: every studio belongs to exactly one."}{" "}
                Search the catalogue to reach any of them by name, by the problem it solves, or by
                the gate holding it back.
              </p>
              <div className="flex flex-wrap gap-1.5">
                <Chip tone={NEUTRAL_TONE}>
                  {coverage.studioCount} studios filed
                </Chip>
                {coverage.consolidatedCount > 0 ? (
                  <Chip tone={DELIVERED_PROPOSAL_TONE}>
                    {coverage.consolidatedCount} ideas consolidated
                  </Chip>
                ) : null}
                {coverage.ungroupedCount > 0 ? (
                  <Chip tone={UNBUILT_PROPOSAL_TONE}>
                    {coverage.ungroupedCount} ungrouped
                  </Chip>
                ) : null}
              </div>
            </div>

            <dl
              className="grid w-full grid-cols-2 gap-px overflow-hidden rounded-xl border border-border/60 bg-border/40 sm:grid-cols-4 2xl:w-[32rem]"
              data-testid="nexus-studios-stats"
            >
              {stats.map((stat) => (
                <StatTile
                  key={stat.id}
                  label={stat.label}
                  value={stat.value}
                  hint={stat.hint}
                  testid={`nexus-studios-stat-${stat.id}`}
                />
              ))}
            </dl>
          </div>

          {declaredTiers.length > 0 ? (
            <ul className="mt-5 grid gap-3 sm:grid-cols-3" data-testid="nexus-studios-tiers">
              {declaredTiers.map((facet) => (
                <TierCard
                  key={facet.id}
                  tier={declaredTier(fleet, facet.id) || facet}
                  productCount={tierProducts.get(facet.id) || 0}
                  testid={`tier-card-${facet.id}`}
                />
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      {masterRegister ? (
        <details className="group rounded-2xl border border-border/60 bg-card/65" data-testid="nexus-studios-master-register">
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-4 px-5 py-4 marker:hidden md:px-6">
            <span className="min-w-0">
              <span className="block text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">Portfolio accountability</span>
              <span className="mt-1 block text-sm font-semibold tracking-tight">{masterRegister.total} requirements tracked without turning plans into product claims</span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-2 text-[11px] font-medium text-foreground">
              Review register <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
            </span>
          </summary>
          <div className="border-t border-border/60 px-5 pb-5 pt-4 md:px-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-2xl">
                <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">Master Studio Register</p>
                <h2 className="mt-1 text-base font-semibold tracking-tight">{masterRegister.total} requirements, one accountable portfolio</h2>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {masterRegister.evidence_backed_matches ?? masterRegister.canonical_matches} requirements resolve to an admitted Studio or proposal. {masterRegister.portfolio_parent_decisions || 0} are assigned to a reviewed portfolio parent and remain explicitly pending capability delivery.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Chip tone={DELIVERED_PROPOSAL_TONE}><CheckCircle2 className="mr-1 inline h-3 w-3" />{masterRegister.canonical_matches} accounted</Chip>
                {masterRegister.portfolio_parent_decisions > 0 ? <Chip tone={UNBUILT_PROPOSAL_TONE}>{masterRegister.portfolio_parent_decisions} delivery plans</Chip> : null}
              </div>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{masterRegister.disclosure}</p>
          </div>
        </details>
      ) : null}

      {readyStudios.length > 0 ? (
        <section className="nx-ambient-surface rounded-2xl border border-border/60 p-5 md:p-6" data-testid="nexus-studios-ready-now">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">Technician launchpad</p>
              <h2 className="mt-1 text-base font-semibold tracking-tight">Quick launch</h2>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                Jump directly into a proven operating surface. Use the Studio brief only when you need scope, dependencies or evidence boundaries.
              </p>
            </div>
            <Chip tone={DELIVERED_PROPOSAL_TONE}><Activity className="mr-1 inline h-3 w-3" />{readyStudios.length} ready now</Chip>
          </div>
          <ul className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {readyStudios.map((studio) => <ReadyStudioCard key={studio.id} studio={studio} />)}
          </ul>
        </section>
      ) : null}

      {deliveryQueue.length > 0 ? (
        <section className="rounded-2xl border border-border/60 bg-card/50 p-5 md:p-6" data-testid="nexus-studios-delivery-queue">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">Admission queue</p>
              <h2 className="mt-1 text-base font-semibold tracking-tight">Finish the right operating boundaries next</h2>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                This is a portfolio view, not a technician task list. It names the highest-priority Studios with undisclosed operating areas so delivery can be sequenced without representing planned capability as live.
              </p>
            </div>
            <Chip tone={UNBUILT_PROPOSAL_TONE}>{deliveryQueue.length} Studio{deliveryQueue.length === 1 ? "" : "s"} needing admission work</Chip>
          </div>
          <ul className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {deliveryQueue.map((studio) => <DeliveryQueueCard key={studio.id} studio={studio} />)}
          </ul>
        </section>
      ) : null}

      <Card data-testid="catalogue-search-card">
        <CardContent className="space-y-3.5 p-5 md:p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                Find the right tool
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Search the job, the capability, a product, or an admission gate. Every result makes clear whether it is ready to operate or still a plan.
              </p>
            </div>
            {filtered ? (
              <Button variant="outline" size="sm" onClick={clear} data-testid="catalogue-clear">
                Clear
              </Button>
            ) : null}
          </div>

          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => applyFilters({ query: event.target.value })}
              placeholder="Search studios, catalogue ideas, the problem they solve or a gate…"
              aria-label="Search the studio catalogue"
              className="pl-9"
              data-testid="catalogue-search"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Show
            </span>
            <FacetChip
              active={kind === ""}
              label="Everything"
              count={facets.total}
              testid="catalogue-kind-all"
              onClick={() => applyFilters({ kind: "" })}
            />
            {facets.kinds.map((facet) => (
              <FacetChip
                key={facet.id}
                active={kind === facet.id}
                label={facet.label}
                count={facet.count}
                testid={`catalogue-kind-${facet.id}`}
                onClick={() => applyFilters({ kind: kind === facet.id ? "" : facet.id })}
              />
            ))}
          </div>

          {declaredTiers.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Tier
              </span>
              <FacetChip
                active={tier === ""}
                label="All tiers"
                count={facets.total}
                testid="catalogue-tier-all"
                onClick={() => applyFilters({ tier: "" })}
              />
              {declaredTiers.map((facet) => (
                <FacetChip
                  key={facet.id}
                  active={tier === facet.id}
                  label={facet.label}
                  count={facet.count}
                  testid={`catalogue-tier-${facet.id}`}
                  onClick={() => applyFilters({ tier: tier === facet.id ? "" : facet.id })}
                />
              ))}
            </div>
          ) : null}

          <p className="text-[11px] text-muted-foreground" data-testid="catalogue-summary">
            {catalogueSummary(entries, visible)}
            {fleet.tier_note ? ` · ${fleet.tier_note}` : ""}
          </p>
        </CardContent>
      </Card>

      {filtered ? (
        visible.length === 0 ? (
          <EmptyState
            icon={<SearchX className="h-8 w-8" />}
            title="No catalogue entry matches this search yet"
            description={NO_MATCH_DISCLOSURE}
            testid="catalogue-empty"
            action={
              <Button variant="outline" size="sm" onClick={clear}>
                Clear the search
              </Button>
            }
          />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2" data-testid="catalogue-results">
            {visible.map((entry) => (
              <CatalogueRow key={entry.key} entry={entry} />
            ))}
          </ul>
        )
      ) : (
        <>
          <nav className="rounded-2xl border border-border/60 bg-card/50 p-4 md:p-5" aria-label="Nexus Studio product families" data-testid="nexus-studios-product-directory">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">Browse product families</p>
                <p className="mt-1 text-xs text-muted-foreground">Jump to the Studio family that owns the work. Planning decisions stay collapsed until you need them.</p>
              </div>
              <span className="text-[11px] text-muted-foreground">{sections.length} families</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {sections.map((section) => (
                <a
                  key={section.id}
                  href={`#studio-product-${section.id}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/40 px-2.5 py-1.5 text-[11px] font-medium text-foreground transition hover:border-primary/40 hover:bg-primary/[0.06]"
                >
                  {section.name}<span className="text-muted-foreground">{section.count}</span>
                </a>
              ))}
            </div>
          </nav>

          <Card>
            <CardContent className="p-5 md:p-6">
              <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                The shared spine
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {fleet.spine.map((tab) => (
                  <Chip key={tab.id} tone={NEUTRAL_TONE} className="text-[11px]">
                    {tab.label}
                  </Chip>
                ))}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{fleet.note}</p>
            </CardContent>
          </Card>

          <div className="space-y-10">
            {sections.map((section, index) => {
              const product = productsById.get(section.id);
              const sectionTier = product
                ? product.tier_label || tierLabel(product.tier, fleet.tiers)
                : "";
              return (
                <section id={`studio-product-${section.id}`} key={section.id} className="scroll-mt-20 space-y-4" data-testid={`product-section-${section.id}`}>
                  <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border/60 pb-3">
                    <div className="flex items-baseline gap-3">
                      <span className="font-mono text-[11px] text-muted-foreground/70 tabular-nums">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div>
                        <h2 className="text-base font-semibold tracking-tight">{section.name}</h2>
                        {section.tagline ? (
                          <p className="mt-0.5 text-[11px] text-muted-foreground">{section.tagline}</p>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {sectionTier ? <Chip tone={NEUTRAL_TONE}>{sectionTier}</Chip> : null}
                      <p className="whitespace-nowrap text-[11px] text-muted-foreground">
                        {section.count} studio{section.count === 1 ? "" : "s"}
                        {section.planCount > 0 ? ` · ${section.planCount} proposed` : ""}
                        {section.consolidatedCount > 0
                          ? ` · ${section.consolidatedCount} consolidated`
                          : ""}
                      </p>
                    </div>
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
                        <StudioCard
                          key={studio.id}
                          studio={studio}
                          tier={studio.tier_label || tierLabel(studio.tier, fleet.tiers)}
                        />
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
              );
            })}
          </div>
        </>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {fleet.product_note || "Products are the navigation boundary: every studio belongs to exactly one."}{" "}
        {fleet.proposal_note ? `${fleet.proposal_note} ` : ""}
        Statuses come from the capability admission gate, not from UI presence —
        see docs/NEXUS_STUDIO_FLEET.md, docs/NEXUS_STUDIO_MERGE_REVIEW.md,
        docs/NEXUS_INVENT_BATCH_5.md, docs/NEXUS_INVENT_BATCH_6.md and
        docs/NEXUS_MASTER_CAPABILITY_REGISTER.md.
      </p>
    </div>
  );
}
