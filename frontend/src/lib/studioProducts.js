/**
 * Nexus studio fleet — product grouping.
 *
 * Nexus presents a handful of major products, each holding the specialist
 * studios that operate it, instead of one navigation entry per studio
 * (docs/NEXUS_INVENT_BATCH_5.md; `app/services/studio_registry.py` enforces the
 * same rule server-side). The `/studios` payload carries the declaration in
 * `products` and each studio's `product` id; this module turns the two into the
 * sections the hub renders.
 *
 * Two rules matter more than the layout:
 *
 * 1. **The server's declaration is the order.** Products render in the order the
 *    registry declares them, so the taxonomy is one statement in one place.
 * 2. **A studio is never hidden to make the grouping tidy.** A studio whose
 *    product is missing or not declared falls into an explicit ungrouped
 *    section that says so, because a studio that vanished from the hub would be
 *    a capability nobody can find — exactly the fragmentation the products exist
 *    to prevent.
 *
 * Each product also carries the consolidated catalogue
 * (`app/services/studio_proposals.py`): every idea batches 2-5 proposed, once,
 * with the disposition the consolidation gave it. The hub counts the proposed
 * studios separately from the ideas consolidated into capability the platform
 * already owns, because "we plan to build this" and "we decided not to build
 * this" are different statements and only one of them is a plan.
 */

export const UNGROUPED_PRODUCT_ID = "ungrouped";

export const UNGROUPED_LABEL = "Not in a declared product";

export const UNGROUPED_DISCLOSURE =
  "These studios are in the fleet but their product is not declared in the registry contract, " +
  "so they are listed here rather than filed under a product that does not own them.";

export const EMPTY_PRODUCT_DISCLOSURE =
  "No studio is admitted in this product yet. The product is declared — it is a plan, not a " +
  "delivered capability.";

export const PROPOSALS_HEADING = "Catalogue and consolidations";

export const PROPOSALS_DISCLOSURE =
  "Every catalogue idea this product holds, once, with what it became: a proposed studio, a " +
  "section of a studio that already exists, a merge into a shared work item, a named gap on an " +
  "existing surface, or capability that is already delivered.";

/** A disposition that is not "studio" is not a proposed studio and is not a plan. */
export function isProposedStudio(proposal) {
  return proposal?.disposition === "studio";
}

/** Delivered capability is the only disposition that may read as success. */
export function isDeliveredProposal(proposal) {
  return proposal?.disposition === "served";
}

/** Last path segment, so "extends backend/app/routers/estimates.py" reads as "estimates.py". */
function owningSurface(proposal) {
  const path = String(proposal?.already_exists_at || "");
  return path.split("/").filter(Boolean).pop() || "";
}

/**
 * Where a proposal went. Returns "" for a proposed studio, which is the honest
 * answer: nothing was consolidated, it is still to be built.
 */
export function proposalTarget(proposal) {
  const target = proposal?.merges_into;
  switch (proposal?.disposition) {
    case "section":
      return target ? `Section of ${target}` : "";
    case "merged":
      return target ? `Merged into ${target}` : "";
    case "extend": {
      const owner = owningSurface(proposal);
      return owner ? `Extends ${owner}` : "";
    }
    case "served": {
      const owner = owningSurface(proposal);
      return owner ? `Already served by ${owner}` : "Already served";
    }
    default:
      return "";
  }
}

/** The gate titles blocking a proposal, never a fabricated one. */
export function proposalGates(proposal) {
  const gates = Array.isArray(proposal?.gates) ? proposal.gates : [];
  return gates.map((gate) => gate?.title || gate?.id).filter(Boolean);
}

function proposalList(product) {
  return Array.isArray(product?.proposals) ? product.proposals : [];
}

/**
 * Group a `/studios` payload into product sections.
 *
 * @param {{products?: Array<object>, studios?: Array<object>}} fleet
 * @returns {Array<{id: string, name: string, tagline: string, planCount: number,
 *   proposals: Array<object>, proposalCount: number, consolidatedCount: number,
 *   studios: Array<object>, ungrouped?: boolean, disclosure?: string}>}
 */
export function groupStudiosByProduct(fleet) {
  const products = Array.isArray(fleet?.products) ? fleet.products : [];
  const studios = Array.isArray(fleet?.studios) ? fleet.studios : [];

  const buckets = new Map();
  for (const product of products) {
    // A declared product with no admitted studio still renders: hiding it would
    // make a planned product indistinguishable from a missing one.
    buckets.set(product.id, []);
  }

  const ungrouped = [];
  for (const studio of studios) {
    const bucket = buckets.get(studio?.product);
    if (bucket) bucket.push(studio);
    else ungrouped.push(studio);
  }

  const sections = products.map((product) => {
    const proposals = proposalList(product);
    return {
      id: product.id,
      name: product.name,
      tagline: product.tagline || "",
      planCount: Array.isArray(product.planned_studios) ? product.planned_studios.length : 0,
      proposals,
      proposalCount: proposals.length,
      // Consolidated: everything the server did NOT leave as a proposed studio.
      consolidatedCount: proposals.filter((proposal) => !isProposedStudio(proposal)).length,
      count: buckets.get(product.id).length,
      studios: buckets.get(product.id),
    };
  });

  if (ungrouped.length > 0) {
    sections.push({
      id: UNGROUPED_PRODUCT_ID,
      name: UNGROUPED_LABEL,
      tagline: "",
      planCount: 0,
      proposals: [],
      proposalCount: 0,
      consolidatedCount: 0,
      count: ungrouped.length,
      studios: ungrouped,
      ungrouped: true,
      disclosure: UNGROUPED_DISCLOSURE,
    });
  }

  return sections;
}

/** One honest line about how many studios the products actually hold. */
export function productCoverage(sections) {
  const placed = (sections || []).filter((section) => !section.ungrouped);
  const ungrouped = (sections || []).find((section) => section.ungrouped);
  return {
    productCount: placed.length,
    studioCount: (sections || []).reduce((total, section) => total + section.count, 0),
    consolidatedCount: placed.reduce(
      (total, section) => total + (section.consolidatedCount || 0),
      0,
    ),
    ungroupedCount: ungrouped ? ungrouped.count : 0,
  };
}
