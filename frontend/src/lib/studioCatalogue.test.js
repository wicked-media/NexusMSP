/**
 * Market Place catalogue tests.
 *
 * The catalogue is the only way a technician will find one of 185+ studios, so
 * these tests pin the behaviour that makes it usable rather than the shape of the
 * payload: an admitted studio is rankable and openable, a plan is searchable but
 * never pretends to be shipped, two words narrow rather than widen, and a
 * catalogue with no tier metadata still indexes.
 */

import {
  CATALOGUE_QUERY_KEYS,
  ENTRY_KINDS,
  NO_MATCH_DISCLOSURE,
  buildCatalogueIndex,
  catalogueQueryString,
  parseCatalogueQuery,
  catalogueFacets,
  catalogueSummary,
  filterCatalogue,
  isCatalogueFiltered,
  normalizeQuery,
  queryTokens,
  scoreEntry,
  searchCatalogue,
  tierLabel,
} from "./studioCatalogue";

const FLEET = {
  tiers: [
    { id: "core", label: "Core", blurb: "Everyday MSP operations." },
    { id: "specialist", label: "Specialist", blurb: "Advanced capability." },
    { id: "platform", label: "Platform", blurb: "Shared engines." },
  ],
  products: [
    {
      id: "nexus-communications",
      name: "Nexus Communications",
      tagline: "Voice, telecom and messaging.",
      tier: "specialist",
      tier_label: "Specialist",
      studios: ["voice"],
      count: 1,
      planned_studios: ["contact-centre"],
      proposal_count: 2,
      proposals: [
        {
          id: "contact-centre",
          title: "Contact Centre Studio",
          product: "nexus-communications",
          disposition: "studio",
          disposition_label: "Proposed studio",
          gates: [{ id: "carrier-call-path-evidence", title: "Carrier-to-agent call-path evidence" }],
          merges_into: null,
          already_exists_at: null,
          covers: [],
          note: "Diagnosing a customer call from carrier to agent is the gate.",
        },
        {
          id: "voice-quality",
          title: "Voice Quality Studio",
          product: "nexus-communications",
          disposition: "section",
          disposition_label: "Section of a studio",
          gates: [{ id: "carrier-call-path-evidence", title: "Carrier-to-agent call-path evidence" }],
          merges_into: "voice",
          already_exists_at: null,
          covers: [],
          note: "Jitter and MOS are a view over the voice studio.",
        },
      ],
    },
    {
      id: "nexus-endpoint",
      name: "Nexus Endpoint",
      tagline: "One endpoint estate.",
      tier: "core",
      tier_label: "Core",
      studios: ["devices"],
      count: 1,
      planned_studios: ["edge"],
      proposal_count: 1,
      proposals: [
        {
          id: "edge",
          title: "Edge Studio",
          product: "nexus-endpoint",
          disposition: "studio",
          disposition_label: "Proposed studio",
          gates: [{ id: "edge-node-inventory", title: "Edge node and local-application inventory" }],
          merges_into: null,
          already_exists_at: null,
          covers: [],
          note: "Edge nodes and remote gateways with resident applications.",
        },
      ],
    },
  ],
  studios: [
    {
      id: "voice",
      name: "Voice Studio",
      domain: "Voice",
      product: "nexus-endpoint",
      product_name: "Nexus Endpoint",
      status: "Partially implemented",
      tagline: "Call records and queue evidence.",
      home_route: "/voice",
      wired_tabs: ["overview"],
      provider: { name: "yeastar" },
      owner: "Communications",
    },
    {
      id: "devices",
      name: "Devices Studio",
      domain: "Endpoints",
      product: "nexus-endpoint",
      product_name: "Nexus Endpoint",
      status: "Partially implemented",
      tagline: "The managed endpoint estate.",
      home_route: "/devices",
      wired_tabs: ["overview", "inventory"],
      provider: { name: "nexus_agent" },
      owner: "Endpoint",
    },
  ],
};

describe("Market Place catalogue", () => {
  test("indexes admitted studios and catalogue ideas separately", () => {
    const entries = buildCatalogueIndex(FLEET);
    expect(entries.map((entry) => entry.key)).toEqual([
      "studio:voice",
      "studio:devices",
      "proposal:contact-centre",
      "proposal:voice-quality",
      "proposal:edge",
    ]);
    const voice = entries.find((entry) => entry.id === "voice");
    expect(voice.kind).toBe(ENTRY_KINDS.studio);
    // The studio's own product is read from the declaration, not the studio row.
    expect(voice.productId).toBe("nexus-endpoint");
    expect(voice.tier).toBe("core");
    expect(voice.href).toBe("/studios/voice");
  });

  test("never gives a plan an operating surface of its own", () => {
    const entries = buildCatalogueIndex(FLEET);
    const idea = entries.find((entry) => entry.id === "contact-centre");
    expect(idea.kind).toBe(ENTRY_KINDS.proposal);
    expect(idea.href).toBeNull();
    expect(idea.status).toBe("Proposed studio");
    expect(idea.gates).toEqual(["Carrier-to-agent call-path evidence"]);
    // A section of a registered studio may point at the studio that owns the
    // domain, because that surface is where the section will live.
    const section = entries.find((entry) => entry.id === "voice-quality");
    expect(section.href).toBe("/studios/voice");
    expect(section.target).toBe("Section of voice");
  });

  test("finds a capability by the problem it solves, not just its name", () => {
    const entries = buildCatalogueIndex(FLEET);
    const byProblem = searchCatalogue(entries, { query: "carrier call" });
    expect(byProblem.map((entry) => entry.id)).toEqual(["contact-centre", "voice-quality"]);
    const byProvider = searchCatalogue(entries, { query: "yeastar" });
    expect(byProvider.map((entry) => entry.id)).toEqual(["voice"]);
  });

  test("narrows with every token rather than widening", () => {
    const entries = buildCatalogueIndex(FLEET);
    expect(searchCatalogue(entries, { query: "voice" }).map((entry) => entry.id))
      .toEqual(["voice", "voice-quality"]);
    // The second word is a second condition: the admitted Voice Studio falls
    // away because nothing in its own text says "quality".
    expect(searchCatalogue(entries, { query: "voice quality" }).map((entry) => entry.id))
      .toEqual(["voice-quality"]);
    expect(searchCatalogue(entries, { query: "voice quantum" })).toEqual([]);
  });

  test("ranks a name match above a note that happens to mention the word", () => {
    const entries = buildCatalogueIndex(FLEET);
    // "Edge Studio" is the name; the contact-centre note mentions "carrier",
    // and the endpoint gate names local applications.
    expect(searchCatalogue(entries, { query: "edge" }).map((entry) => entry.id)[0]).toBe("edge");
    // An admitted studio outranks a plan on an equally good match.
    const ranked = searchCatalogue(entries, { query: "studio" });
    expect(ranked[0].kind).toBe(ENTRY_KINDS.studio);
  });

  test("ranks evidence above prose when both mention the word", () => {
    // One idea's gate names fibre, another only mentions it in a build note. The
    // gate is the checkable statement, so it is the one that ranks first.
    const fleet = {
      studios: [],
      products: [{
        id: "nexus-example", name: "Nexus Example", tier: "core", tier_label: "Core",
        studios: [], count: 0, planned_studios: [], proposal_count: 2,
        proposals: [
          {
            id: "noted", title: "Noted Studio", product: "nexus-example",
            disposition: "studio", disposition_label: "Proposed studio",
            gates: [{ id: "other", title: "Something else entirely" }],
            covers: [], note: "Its note mentions fibre in prose.",
          },
          {
            id: "gated", title: "Gated Studio", product: "nexus-example",
            disposition: "studio", disposition_label: "Proposed studio",
            gates: [{ id: "fibre", title: "Fibre run inventory" }],
            covers: [], note: null,
          },
        ],
      }],
    };
    const entries = buildCatalogueIndex(fleet);
    expect(searchCatalogue(entries, { query: "fibre" }).map((entry) => entry.id))
      .toEqual(["gated", "noted"]);
    // A name still beats both.
    expect(scoreEntry(entries.find((entry) => entry.id === "gated"), ["fibre"]))
      .toBeGreaterThan(scoreEntry(entries.find((entry) => entry.id === "noted"), ["fibre"]));
  });

  test("filters by tier, product and kind without hiding the rest of the index", () => {
    const entries = buildCatalogueIndex(FLEET);
    const specialist = filterCatalogue(entries, { tier: "specialist" });
    expect(specialist.map((entry) => entry.id)).toEqual(["contact-centre", "voice-quality"]);
    expect(filterCatalogue(entries, { productId: "nexus-endpoint" })).toHaveLength(3);
    expect(filterCatalogue(entries, { kind: ENTRY_KINDS.studio })).toHaveLength(2);

    const facets = catalogueFacets(entries);
    expect(facets.total).toBe(5);
    // Counts come from the whole index, so a chip cannot vanish mid-search.
    // Voice Studio is filed under Nexus Endpoint by the declaration even though
    // its own row says Nexus Endpoint too, so core holds three entries.
    expect(facets.tiers).toEqual([
      { id: "core", label: "Core", count: 3 },
      { id: "specialist", label: "Specialist", count: 2 },
    ]);
    expect(facets.kinds).toEqual([
      { id: "proposal", label: "Catalogue idea", count: 3 },
      { id: "studio", label: "Admitted studio", count: 2 },
    ]);
    expect(facets.products.map((product) => product.id))
      .toEqual(["nexus-endpoint", "nexus-communications"]);
  });

  test("combines a facet with a query", () => {
    const entries = buildCatalogueIndex(FLEET);
    expect(
      searchCatalogue(entries, { query: "studio", tier: "specialist" }).map((entry) => entry.id),
    ).toEqual(["contact-centre", "voice-quality"]);
    // Every entry is its own kind of studio, so the facet is what narrows here;
    // equal scores are broken by name, and the plan ranks below the two admitted
    // studios it ties with.
    expect(
      searchCatalogue(entries, { query: "studio", tier: "core" }).map((entry) => entry.id),
    ).toEqual(["devices", "voice", "edge"]);
    expect(
      searchCatalogue(entries, { query: "studio", kind: ENTRY_KINDS.proposal })
        .map((entry) => entry.id),
    ).toEqual(["edge", "contact-centre", "voice-quality"]);
  });

  test("reports what is shown out of what exists", () => {
    const entries = buildCatalogueIndex(FLEET);
    expect(catalogueSummary(entries, entries)).toBe(
      "5 of 5 catalogue entries · 2 admitted studios · 3 catalogue ideas",
    );
    const one = searchCatalogue(entries, { query: "contact", tier: "specialist" });
    expect(catalogueSummary(entries, one)).toBe(
      "1 of 5 catalogue entries · 0 admitted studios · 1 catalogue idea",
    );
    expect(isCatalogueFiltered({ query: "  " })).toBe(false);
    expect(isCatalogueFiltered({ query: "voice" })).toBe(true);
    expect(isCatalogueFiltered({ tier: "core" })).toBe(true);
    expect(isCatalogueFiltered({})).toBe(false);
  });

  test("normalises a query the one way, so two spellings agree", () => {
    expect(normalizeQuery("  Voice   QUALITY ")).toBe("voice quality");
    expect(queryTokens("  Voice   QUALITY ")).toEqual(["voice", "quality"]);
    expect(queryTokens("")).toEqual([]);
  });

  test("indexes a payload that carries no tiers at all", () => {
    const legacy = {
      // The omitted keys are the packaging this payload never declared.
      products: FLEET.products.map(({ tier: _tier, tier_label: _tierLabel, ...rest }) => rest),
      studios: FLEET.studios,
    };
    const entries = buildCatalogueIndex(legacy);
    expect(entries).toHaveLength(5);
    for (const entry of entries) {
      expect(entry.tier).toBe("");
      expect(entry.tierLabel).toBe("");
    }
    expect(catalogueFacets(entries).tiers).toEqual([
      { id: "untiered", label: "No tier declared", count: 5 },
    ]);
    // Every catalogue idea still says what blocks it, which is the part a
    // technician needs even when the packaging is missing.
    expect(entries.find((entry) => entry.id === "edge").gates).toHaveLength(1);
  });

  test("survives a payload with no products or studios", () => {
    expect(buildCatalogueIndex({})).toEqual([]);
    expect(buildCatalogueIndex(null)).toEqual([]);
    expect(searchCatalogue([], { query: "voice" })).toEqual([]);
    expect(catalogueFacets([]).total).toBe(0);
  });

  test("falls back to a declared tier label and discloses an empty search", () => {
    expect(tierLabel("specialist", FLEET.tiers)).toBe("Specialist");
    expect(tierLabel("core", [])).toBe("Core");
    expect(tierLabel("platinum", [])).toBe("");
    expect(NO_MATCH_DISCLOSURE).toMatch(/No catalogue entry matches/);
  });
});

/**
 * The address is the catalogue's state, so what a catalogue URL means is worth
 * pinning: the page, the command palette and any pasted link all go through
 * these two functions rather than each deciding for themselves.
 */
describe("Market Place address", () => {
  test("reads the three keys it owns and ignores the rest", () => {
    expect(parseCatalogueQuery("?q=call+quality&tier=core&view=kept")).toEqual({
      query: "call quality",
      tier: "core",
      kind: "",
    });
    // Nothing to read is not an error: a plain `/studios` is a valid catalogue.
    expect(parseCatalogueQuery("")).toEqual({ query: "", tier: "", kind: "" });
    expect(parseCatalogueQuery(undefined)).toEqual({ query: "", tier: "", kind: "" });
    expect(CATALOGUE_QUERY_KEYS.query).toBe("q");
  });

  test("writes a link that survives a round trip", () => {
    const search = catalogueQueryString(
      { query: "  fibre  ", tier: "specialist", kind: "studio" },
      "?view=kept",
    );
    expect(parseCatalogueQuery(search)).toEqual({
      query: "fibre",
      tier: "specialist",
      kind: "studio",
    });
    // Another surface's parameter is not the catalogue's to remove.
    expect(new URLSearchParams(search).get("view")).toBe("kept");
  });

  test("clears by removing its own keys rather than writing them empty", () => {
    const narrowed = catalogueQueryString({ query: "fibre" }, "?view=kept");
    expect(catalogueQueryString({ query: "", tier: "", kind: "" }, narrowed)).toBe("?view=kept");
    // An unfiltered catalogue is a plain path, which is what the page writes back.
    expect(catalogueQueryString({}, "")).toBe("");
  });
});
