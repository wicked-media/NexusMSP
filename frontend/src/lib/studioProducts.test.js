import {
  UNGROUPED_PRODUCT_ID,
  UNGROUPED_DISCLOSURE,
  groupStudiosByProduct,
  isDeliveredProposal,
  isProposedStudio,
  productCoverage,
  proposalGates,
  proposalTarget,
} from "./studioProducts";

const FLEET = {
  count: 4,
  products: [
    {
      id: "nexus-endpoint", name: "Nexus Endpoint", tagline: "One endpoint estate.",
      planned_studios: ["windows", "apple", "linux"],
      proposals: [
        {
          id: "windows", title: "Windows Studio", product: "nexus-endpoint",
          disposition: "studio", disposition_label: "Proposed studio",
          gates: [{ id: "fleet-baseline", title: "Fleet baseline projection" }],
          merges_into: null, already_exists_at: null, covers: [],
        },
        {
          id: "browser-management", title: "Browser Management Studio",
          product: "nexus-endpoint", disposition: "studio",
          disposition_label: "Proposed studio",
          gates: [{ id: "endpoint-enumeration-consent", title: "Enumeration and consent" }],
          merges_into: null, already_exists_at: null, covers: ["browser"],
        },
      ],
    },
    {
      id: "nexus-commerce", name: "Nexus Commerce", tagline: "Commercial operations.",
      planned_studios: ["stockroom"],
      proposals: [
        {
          id: "stockroom", title: "Stockroom Studio", product: "nexus-commerce",
          disposition: "studio", disposition_label: "Proposed studio",
          gates: [{ id: "stock-ownership", title: "Per-location stock ownership" }],
          merges_into: null, already_exists_at: null, covers: [],
        },
        {
          id: "quoting", title: "Quoting Studio", product: "nexus-commerce",
          disposition: "extend", disposition_label: "Extends an existing surface",
          gates: [{ id: "commercial-source-of-truth", title: "Owned commercial source of truth" }],
          merges_into: null, already_exists_at: "backend/app/routers/estimates.py", covers: [],
        },
        {
          id: "customer-profitability", title: "Customer Profitability Studio",
          product: "nexus-commerce", disposition: "section",
          disposition_label: "Section of a studio", gates: [], merges_into: "finance",
          already_exists_at: null, covers: [],
        },
        {
          id: "dispatch", title: "Dispatch Studio", product: "nexus-commerce",
          disposition: "served", disposition_label: "Already served",
          gates: [], merges_into: null,
          already_exists_at: "backend/app/routers/dispatch_board.py", covers: [],
        },
      ],
    },
    {
      id: "nexus-knowledge", name: "Nexus Knowledge", tagline: "Documentation.",
      planned_studios: [], proposals: [],
    },
  ],
  studios: [
    { id: "devices", name: "Devices Studio", product: "nexus-endpoint", product_name: "Nexus Endpoint" },
    { id: "finance", name: "Finance Studio", product: "nexus-commerce", product_name: "Nexus Commerce" },
    { id: "agent", name: "Agent Studio", product: "nexus-endpoint", product_name: "Nexus Endpoint" },
    { id: "wrangled", name: "Unfiled Studio", product: "nexus-imaginary", product_name: "Nexus Imaginary" },
  ],
};

test("sections follow the server's product declaration order, not studio order", () => {
  const sections = groupStudiosByProduct(FLEET);
  expect(sections.map((section) => section.id)).toEqual([
    "nexus-endpoint",
    "nexus-commerce",
    "nexus-knowledge",
    UNGROUPED_PRODUCT_ID,
  ]);
});

test("each studio is filed under its own product exactly once", () => {
  const sections = groupStudiosByProduct(FLEET);
  const endpoint = sections.find((section) => section.id === "nexus-endpoint");
  const commerce = sections.find((section) => section.id === "nexus-commerce");
  expect(endpoint.studios.map((studio) => studio.id)).toEqual(["devices", "agent"]);
  expect(commerce.studios.map((studio) => studio.id)).toEqual(["finance"]);
  const filed = sections.flatMap((section) => section.studios.map((studio) => studio.id));
  expect(filed.sort()).toEqual(["agent", "devices", "finance", "wrangled"]);
});

test("a studio whose product is not declared is disclosed, never dropped", () => {
  const sections = groupStudiosByProduct(FLEET);
  const ungrouped = sections.find((section) => section.ungrouped);
  expect(ungrouped.id).toBe(UNGROUPED_PRODUCT_ID);
  expect(ungrouped.studios.map((studio) => studio.id)).toEqual(["wrangled"]);
  expect(ungrouped.disclosure).toBe(UNGROUPED_DISCLOSURE);
});

test("a declared product with no admitted studio still renders as a plan", () => {
  const sections = groupStudiosByProduct(FLEET);
  const knowledge = sections.find((section) => section.id === "nexus-knowledge");
  expect(knowledge.studios).toEqual([]);
  expect(knowledge.count).toBe(0);
  // No ungrouped section is invented when every studio is filed.
  expect(groupStudiosByProduct({ ...FLEET, studios: FLEET.studios.slice(0, 3) }))
    .toHaveLength(3);
});

test("a payload with no products degrades to an explicit ungrouped list", () => {
  const sections = groupStudiosByProduct({ studios: FLEET.studios });
  expect(sections).toHaveLength(1);
  expect(sections[0].ungrouped).toBe(true);
  expect(sections[0].studios).toHaveLength(4);
  expect(sections[0].proposals).toEqual([]);
  expect(groupStudiosByProduct(undefined)).toEqual([]);
  expect(groupStudiosByProduct({})).toEqual([]);
});

test("planned studios are counted as proposals, not as capability", () => {
  const sections = groupStudiosByProduct(FLEET);
  const endpoint = sections.find((section) => section.id === "nexus-endpoint");
  expect(endpoint.planCount).toBe(3);
  expect(endpoint.count).toBe(2);
  expect(sections.find((section) => section.id === "nexus-knowledge").planCount).toBe(0);
});

test("consolidated ideas are counted apart from proposed studios", () => {
  const sections = groupStudiosByProduct(FLEET);
  const endpoint = sections.find((section) => section.id === "nexus-endpoint");
  const commerce = sections.find((section) => section.id === "nexus-commerce");
  // Two proposed studios and nothing consolidated: a plan with no merge.
  expect(endpoint.proposalCount).toBe(2);
  expect(endpoint.consolidatedCount).toBe(0);
  // One proposed studio and three ideas the consolidation resolved elsewhere.
  expect(commerce.proposalCount).toBe(4);
  expect(commerce.consolidatedCount).toBe(3);
  expect(sections.find((section) => section.id === "nexus-knowledge").proposalCount).toBe(0);
});

test("a consolidated proposal says where it went; a proposed studio says nothing", () => {
  expect(proposalTarget({ disposition: "merged", merges_into: "devops" })).toBe("Merged into devops");
  expect(proposalTarget({ disposition: "section", merges_into: "finance" })).toBe("Section of finance");
  expect(proposalTarget({ disposition: "extend", already_exists_at: "backend/app/routers/estimates.py" }))
    .toBe("Extends estimates.py");
  expect(proposalTarget({ disposition: "served", already_exists_at: "backend/app/routers/dispatch_board.py" }))
    .toBe("Already served by dispatch_board.py");
  expect(proposalTarget({ disposition: "studio" })).toBe("");
  // A disposition the client does not know is never given a confident sentence.
  expect(proposalTarget({ disposition: "something-new" })).toBe("");
  expect(proposalTarget(undefined)).toBe("");
});

test("proposal gates are named, and no gate is invented", () => {
  expect(proposalGates({ gates: [{ id: "stock-ownership", title: "Per-location stock ownership" }] }))
    .toEqual(["Per-location stock ownership"]);
  // A gate with no title still names itself rather than rendering as blank.
  expect(proposalGates({ gates: [{ id: "stock-ownership" }] })).toEqual(["stock-ownership"]);
  expect(proposalGates({ gates: [] })).toEqual([]);
  expect(proposalGates(undefined)).toEqual([]);
});

test("only a proposed studio is a plan and only served work reads as delivered", () => {
  expect(isProposedStudio({ disposition: "studio" })).toBe(true);
  expect(isProposedStudio({ disposition: "extend" })).toBe(false);
  expect(isProposedStudio(undefined)).toBe(false);
  expect(isDeliveredProposal({ disposition: "served" })).toBe(true);
  expect(isDeliveredProposal({ disposition: "section" })).toBe(false);
  expect(isDeliveredProposal(undefined)).toBe(false);
});

test("productCoverage counts every studio and reports the ungrouped ones", () => {
  expect(productCoverage(groupStudiosByProduct(FLEET))).toEqual({
    productCount: 3,
    studioCount: 4,
    consolidatedCount: 3,
    ungroupedCount: 1,
  });
  expect(productCoverage([])).toEqual({
    productCount: 0, studioCount: 0, consolidatedCount: 0, ungroupedCount: 0,
  });
});

test("a product payload without proposals degrades to an empty catalogue", () => {
  const sections = groupStudiosByProduct({
    products: [{ id: "nexus-endpoint", name: "Nexus Endpoint" }],
    studios: [{ id: "devices", product: "nexus-endpoint" }],
  });
  expect(sections).toHaveLength(1);
  expect(sections[0].proposals).toEqual([]);
  expect(sections[0].proposalCount).toBe(0);
  expect(sections[0].consolidatedCount).toBe(0);
  expect(sections[0].planCount).toBe(0);
  expect(productCoverage(sections).consolidatedCount).toBe(0);
});
