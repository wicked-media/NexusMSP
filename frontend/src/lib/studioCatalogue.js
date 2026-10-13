/**
 * The Market Place index — one searchable catalogue over the whole studio fleet.
 *
 * Nexus now proposes 185+ studios across 14 products. They cannot each be a
 * sidebar link: 185 destinations is a navigation section nobody can read, which
 * is exactly how a capability becomes unfindable even though it exists. So the
 * fleet is presented the way a portfolio actually works — a catalogue you search
 * — and this module is the search.
 *
 * Two kinds of entry go into the index, and the distinction is the point:
 *
 * - an **admitted studio** (`kind: "studio"`) is a registry entry with an honest
 *   capability status and an operating surface at `/studios/<id>`;
 * - a **catalogue idea** (`kind: "proposal"`) is a proposal from
 *   `backend/app/services/studio_proposals.py` with the disposition the
 *   consolidation gave it. It has no operating surface, and the index never
 *   invents one — a plan that rendered as a shipped workspace is the failure this
 *   whole catalogue exists to prevent.
 *
 * The rules the ranking keeps:
 *
 * 1. **Every token must match.** Two words narrow a search; they never widen it.
 * 2. **A name beats a note.** A studio whose name matches outranks one whose
 *    build note happens to mention the same word.
 * 3. **A missing payload field is not a crash.** An older `/studios` payload with
 *    no `products[].tier` still indexes; the tier facet simply reports what it
 *    was told, and a tier label falls back to its declared default.
 * 4. **Nothing is hidden to make the counts tidy.** Facet counts are computed
 *    over the whole index, and the summary states how many of how many are shown.
 */

export const ENTRY_KINDS = { studio: "studio", proposal: "proposal" };

export const KIND_LABELS = {
  studio: "Admitted studio",
  proposal: "Catalogue idea",
};

/** The commercial tiers, in packaging order. */
export const TIER_ORDER = ["core", "specialist", "platform"];

/** Labels used when the payload declares no tier metadata of its own. */
export const DEFAULT_TIER_LABELS = {
  core: "Core",
  specialist: "Specialist",
  platform: "Platform",
};

export const NO_MATCH_DISCLOSURE =
  "No catalogue entry matches this search yet. Try a studio name, the problem it " +
  "solves (call quality, fibre, encryption, patching), a tier, or a product.";

export const UNKNOWN_TIER = "untiered";

/** What the facet says when the payload declared no tier for the entry. */
export const UNKNOWN_TIER_LABEL = "No tier declared";

/** Lowercase, trim, collapse runs of whitespace: the one normalisation. */
export function normalizeQuery(value) {
  return String(value ?? "").toLowerCase().trim().replace(/\s+/g, " ");
}

/** Every word of a query. Two words are two conditions, never a phrase. */
export function queryTokens(value) {
  const normalized = normalizeQuery(value);
  return normalized ? normalized.split(" ").filter(Boolean) : [];
}

export function tierLabel(tier, tiers = []) {
  const declared = (tiers || []).find((entry) => entry?.id === tier);
  if (declared?.label) return declared.label;
  return DEFAULT_TIER_LABELS[tier] || "";
}

/** Last path segment, so a citation reads as a file rather than a URL. */
function owningSurface(target) {
  const path = String(target || "");
  return path.split("/").filter(Boolean).pop() || "";
}

/**
 * Where a catalogue idea went, in the hub's own words. Empty for a proposed
 * studio, which is the honest answer: nothing was consolidated, it is still to
 * be built.
 */
export function entryTarget(proposal) {
  const target = proposal?.merges_into;
  switch (proposal?.disposition) {
    case "section":
      return target ? `Section of ${target}` : "";
    case "merged":
      return target ? `Merged into ${target}` : "";
    case "extend": {
      const owner = owningSurface(proposal?.already_exists_at);
      return owner ? `Extends ${owner}` : "";
    }
    case "served": {
      const owner = owningSurface(proposal?.already_exists_at);
      return owner ? `Already served by ${owner}` : "Already served";
    }
    default:
      return "";
  }
}

function gateTitles(proposal) {
  return (Array.isArray(proposal?.gates) ? proposal.gates : [])
    .map((gate) => gate?.title || gate?.id)
    .filter(Boolean);
}

/**
 * The fields a score can be earned from, kept apart rather than concatenated.
 *
 * A single haystack decides *whether* a token matches; these decide *how much it
 * counts*. A named gate or the surface an idea extends is evidence, a build note
 * is prose, so a search for "call quality" should reach the studio whose gate is
 * `carrier-call-path-evidence` before one whose note merely says "calls this
 * out". Matching is still substring-based per token — a catalogue is not a
 * search engine — but the ranking is not flat.
 */
function matchFields({ gates = [], facets = [], summary = "" }) {
  const clean = (values) => values.filter(Boolean).join(" ").toLowerCase();
  return {
    gatesText: clean(gates),
    facetsText: clean(facets),
    summaryText: clean([summary]),
  };
}

function studioEntry(studio, product, tiers) {
  const tier = product?.tier || "";
  const tierLabelText = product?.tier_label || tierLabel(tier, tiers);
  const facets = [
    studio?.id,
    product?.name,
    tierLabelText,
    studio?.domain,
    studio?.status,
    studio?.provider?.name,
    studio?.owner,
  ];
  const fields = matchFields({ facets, summary: studio?.tagline });
  const searchText = [
    studio?.name,
    studio?.tagline,
    ...facets,
    (studio?.wired_tabs || []).join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return {
    ...fields,
    key: `studio:${studio?.id}`,
    id: studio?.id,
    kind: ENTRY_KINDS.studio,
    name: studio?.name || studio?.id || "",
    productId: product?.id || studio?.product || "",
    productName: product?.name || studio?.product_name || "",
    tier,
    tierLabel: tierLabelText,
    status: studio?.status || "",
    disposition: "",
    dispositionLabel: "",
    summary: studio?.tagline || "",
    target: "",
    gates: [],
    href: studio?.id ? `/studios/${studio.id}` : null,
    homeRoute: studio?.home_route || null,
    searchText,
  };
}

function proposalEntry(proposal, product, tiers) {
  const tier = product?.tier || "";
  const tierLabelText = product?.tier_label || tierLabel(tier, tiers);
  const gates = gateTitles(proposal);
  const facets = [
    proposal?.id,
    product?.name,
    tierLabelText,
    proposal?.disposition,
    entryTarget(proposal),
    (proposal?.covers || []).join(" "),
    proposal?.merges_into,
  ];
  const fields = matchFields({ gates, facets, summary: proposal?.note });
  const searchText = [
    proposal?.title,
    proposal?.note,
    proposal?.disposition_label,
    ...facets,
    ...gates,
    (proposal?.sources || []).join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return {
    ...fields,
    key: `proposal:${proposal?.id}`,
    id: proposal?.id,
    kind: ENTRY_KINDS.proposal,
    name: proposal?.title || proposal?.id || "",
    productId: product?.id || proposal?.product || "",
    productName: product?.name || "",
    tier,
    tierLabel: tierLabelText,
    status: proposal?.disposition_label || proposal?.disposition || "",
    disposition: proposal?.disposition || "",
    dispositionLabel: proposal?.disposition_label || "",
    summary: proposal?.note || "",
    target: entryTarget(proposal),
    gates,
    // A proposal has no operating surface. A section of a registered studio may
    // point at that studio's, because that studio owns the domain.
    href:
      proposal?.disposition === "section" && proposal?.merges_into
        ? `/studios/${proposal.merges_into}`
        : null,
    homeRoute: null,
    searchText,
  };
}

/**
 * Flatten a `/studios` payload into searchable entries.
 *
 * @param {{products?: Array<object>, studios?: Array<object>, tiers?: Array<object>}} fleet
 * @returns {Array<object>} admitted studios first, then catalogue ideas, each in
 *   the order the registry declared it.
 */
export function buildCatalogueIndex(fleet) {
  const products = Array.isArray(fleet?.products) ? fleet.products : [];
  const studios = Array.isArray(fleet?.studios) ? fleet.studios : [];
  const tiers = Array.isArray(fleet?.tiers) ? fleet.tiers : [];
  const byId = new Map(products.map((product) => [product?.id, product]));

  const studioEntries = studios.map((studio) =>
    studioEntry(studio, byId.get(studio?.product), tiers),
  );
  const proposalEntries = products.flatMap((product) =>
    (Array.isArray(product?.proposals) ? product.proposals : []).map((proposal) =>
      proposalEntry(proposal, product, tiers),
    ),
  );

  return [...studioEntries, ...proposalEntries];
}

/** Rank one entry against a token list, or -1 when a token is missing. */
export function scoreEntry(entry, tokens) {
  if (!tokens.length) return 0;
  const name = normalizeQuery(entry?.name);
  const text = String(entry?.searchText || "");
  const gates = String(entry?.gatesText || "");
  const facets = String(entry?.facetsText || "");
  const summary = String(entry?.summaryText || "");
  let score = 0;
  for (const token of tokens) {
    // Every token must match somewhere, or the entry is not a result at all.
    if (!text.includes(token)) return -1;
    // …and where it matched decides how much it counts: the name first, then the
    // gate blocking it, then the packaging around it, then the prose.
    if (name === token) score += 120;
    else if (name.startsWith(token)) score += 80;
    else if (name.includes(token)) score += 50;
    else if (gates.includes(token)) score += 30;
    else if (facets.includes(token)) score += 20;
    else if (summary.includes(token)) score += 10;
    else score += 5;
  }
  // An admitted studio outranks a plan that matches just as well: one can be
  // opened, the other is still to be built.
  if (entry?.kind === ENTRY_KINDS.studio) score += 5;
  return score;
}

/** Apply the facets a technician can see: tier, product and entry kind. */
export function filterCatalogue(entries, { tier = "", productId = "", kind = "" } = {}) {
  return (entries || []).filter((entry) => {
    if (tier && entry.tier !== tier) return false;
    if (productId && entry.productId !== productId) return false;
    if (kind && entry.kind !== kind) return false;
    return true;
  });
}

function tierRank(tier) {
  const rank = TIER_ORDER.indexOf(tier);
  return rank === -1 ? TIER_ORDER.length : rank;
}

/**
 * Search the catalogue: facets first, then every query token, then ranking.
 *
 * @returns {Array<object>} matching entries, best first. An empty query returns
 *   the facet-filtered catalogue in index order rather than a meaningless ranking.
 */
export function searchCatalogue(entries, { query = "", tier = "", productId = "", kind = "" } = {}) {
  const faceted = filterCatalogue(entries, { tier, productId, kind });
  const tokens = queryTokens(query);
  if (!tokens.length) return faceted;

  return faceted
    .map((entry, index) => ({ entry, index, score: scoreEntry(entry, tokens) }))
    .filter((scored) => scored.score >= 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        tierRank(left.entry.tier) - tierRank(right.entry.tier) ||
        left.entry.name.localeCompare(right.entry.name) ||
        left.index - right.index,
    )
    .map((scored) => scored.entry);
}

/**
 * Chip counts for the whole index, so a facet never disappears because the
 * current search narrowed it away.
 */
export function catalogueFacets(entries) {
  const all = entries || [];
  const tierCounts = new Map();
  const productCounts = new Map();
  const kindCounts = new Map();

  for (const entry of all) {
    const tier = entry.tier || UNKNOWN_TIER;
    if (!tierCounts.has(tier)) {
      tierCounts.set(tier, {
        id: tier,
        label: entry.tierLabel || (tier === UNKNOWN_TIER ? UNKNOWN_TIER_LABEL : tier),
        count: 0,
      });
    }
    tierCounts.get(tier).count += 1;

    if (!productCounts.has(entry.productId)) {
      productCounts.set(entry.productId, {
        id: entry.productId,
        name: entry.productName || entry.productId,
        tier: entry.tier,
        count: 0,
      });
    }
    productCounts.get(entry.productId).count += 1;

    if (!kindCounts.has(entry.kind)) {
      kindCounts.set(entry.kind, { id: entry.kind, label: KIND_LABELS[entry.kind] || entry.kind, count: 0 });
    }
    kindCounts.get(entry.kind).count += 1;
  }

  return {
    total: all.length,
    tiers: [...tierCounts.values()].sort(
      (left, right) => tierRank(left.id) - tierRank(right.id) || left.label.localeCompare(right.label),
    ),
    products: [...productCounts.values()].sort(
      (left, right) => tierRank(left.tier) - tierRank(right.tier) || left.name.localeCompare(right.name),
    ),
    kinds: [...kindCounts.values()].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

/**
 * The catalogue's address contract.
 *
 * The catalogue is the only way a technician will find one of 185+ studios, and a
 * search that cannot be sent to a colleague is a search they will type again. So
 * the three filters the hub owns live in the address rather than in component
 * state: `q` for the words, `tier` for the packaging and `kind` for what the
 * entry is. Anything else the address carries belongs to another surface and is
 * left exactly as it was found.
 */
export const CATALOGUE_QUERY_KEYS = { query: "q", tier: "tier", kind: "kind" };

/** Read the three catalogue filters from a query string. Never throws. */
export function parseCatalogueQuery(search) {
  const params = new URLSearchParams(String(search ?? ""));
  const read = (key) => (params.get(key) || "").trim();
  return {
    query: read(CATALOGUE_QUERY_KEYS.query),
    tier: read(CATALOGUE_QUERY_KEYS.tier),
    kind: read(CATALOGUE_QUERY_KEYS.kind),
  };
}

/**
 * The query string for these filters, merged into whatever the address already
 * carried. An empty filter is removed rather than written as `q=`, so a cleared
 * catalogue reads as a plain `/studios` instead of a URL holding three empty
 * parameters. Returns "" when nothing is set, which is what `setSearchParams`
 * takes to clear the address.
 */
export function catalogueQueryString({ query = "", tier = "", kind = "" } = {}, search = "") {
  const params = new URLSearchParams(String(search ?? ""));
  const pairs = [
    [CATALOGUE_QUERY_KEYS.query, query],
    [CATALOGUE_QUERY_KEYS.tier, tier],
    [CATALOGUE_QUERY_KEYS.kind, kind],
  ];
  for (const [key, value] of pairs) {
    const trimmed = String(value ?? "").trim();
    if (trimmed) params.set(key, trimmed);
    else params.delete(key);
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** Is any facet or query narrowing the catalogue right now? */
export function isCatalogueFiltered({ query = "", tier = "", productId = "", kind = "" } = {}) {
  return Boolean(queryTokens(query).length || tier || productId || kind);
}

/** One honest line about what the technician is looking at. */
export function catalogueSummary(all, visible) {
  const entries = all || [];
  const shown = visible || [];
  const studios = shown.filter((entry) => entry.kind === ENTRY_KINDS.studio).length;
  const ideas = shown.length - studios;
  const counts =
    `${shown.length} of ${entries.length} catalogue entr${entries.length === 1 ? "y" : "ies"}`
    + ` · ${studios} admitted studio${studios === 1 ? "" : "s"}`
    + ` · ${ideas} catalogue idea${ideas === 1 ? "" : "s"}`;
  return counts;
}
