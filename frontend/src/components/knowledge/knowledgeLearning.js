/**
 * Learned ordering for the Knowledge & Help reader.
 *
 * The reader used to remember what a technician read in that technician's own
 * browser, because documentation was not in the server's workspace registry and
 * this surface may not invent a key space of its own. It is in the registry now
 * (`documentation`, see `backend/app/routers/workspace_learning.py`), so the
 * reader learns exactly like every other Nexus workspace: one bounded counter
 * per technician, workspace, surface and target, owned by the server, read back
 * as this technician's own evidence plus a tenant-wide aggregate that never names
 * anyone.
 *
 * That change is worth stating plainly, because the old design had a real
 * limitation and the new one does not:
 *
 *   - The guides a reader finds useful are, by and large, the guides their
 *     colleague needs too, and a technician who moves machine should not start
 *     from the authored order again.
 *   - The store is tenant-scoped and owner-only for personal rows, so nothing
 *     here crosses a tenant boundary or exposes one technician to another.
 *   - It is still presentation only. It reorders documents the page already
 *     fetched under the caller's permissions, and can never reveal a guide,
 *     grant access or promote anything the technician could not already open.
 *
 * Two details are specific to this reader:
 *
 *   - The reader hosts two libraries (product guides and knowledge articles) in
 *     one hub, and a guide and an article can genuinely share a name. The kind is
 *     therefore part of the target slug, so reading the guide `ticket-triage`
 *     never counts as reading the article `ticket-triage`.
 *   - Both libraries are one workspace, so one index and one hint describe the
 *     reader as a whole, which is what a hub that searches both at once should
 *     say.
 *
 * Ranking stays deliberately conservative, and the thresholds live in one place:
 * nothing moves below the shared `LEARNING_MIN_SIGNALS`, this technician's own
 * use always outranks the team aggregate, and ties keep the order the library
 * declared.
 */

import {
  LEARNING_MIN_SIGNALS,
  LEARNING_VIEW,
  evidenceFor,
  learningHint,
  learningSlug,
  rankByUse,
  recentlyUsed,
} from "@/lib/workspaceLearning";

/** The two documents a reader can open. A guide and an article are not the same key. */
export const KNOWLEDGE_KINDS = Object.freeze({
  GUIDE: "guide",
  ARTICLE: "article",
});

/**
 * Opening a document is a view, the same surface every other workspace uses for
 * "this technician went here". The reader has no tool worth ranking yet, so it
 * writes one surface and does not leave half-used evidence behind: a target that
 * nothing reads would still consume the server's per-surface budget.
 */
export const KNOWLEDGE_SURFACE = LEARNING_VIEW;

/** Shared threshold, re-exported so the reader's UI never invents its own. */
export const KNOWLEDGE_MIN_SIGNALS = LEARNING_MIN_SIGNALS;

/**
 * Normalise one document into the single target slug the server stores.
 *
 * Returns an empty string for anything unusable — an unknown kind or a value
 * that normalises away — and every helper below treats that as "no evidence"
 * rather than recording a key that would rank the wrong thing.
 */
export function knowledgeTarget(kind, value) {
  if (!Object.values(KNOWLEDGE_KINDS).includes(kind)) return "";
  const slug = learningSlug(value);
  return slug ? `${kind}_${slug}` : "";
}

/**
 * Record one document open.
 *
 * Takes the writer rather than the whole learning snapshot on purpose: the write
 * is a side effect that must fire exactly once per open, so callers depend on the
 * stable `record` callback instead of on an object that changes identity every
 * time the server answers a read.
 */
export function rememberKnowledge(record, kind, value) {
  const target = knowledgeTarget(kind, value);
  if (target) record?.(KNOWLEDGE_SURFACE, target);
}

/** How many times this technician has opened one document, for an honest badge. */
export function knowledgeCount(learning, kind, value) {
  return evidenceFor(KNOWLEDGE_SURFACE, knowledgeTarget(kind, value), learning?.personal, learning?.team).mine;
}

/**
 * Rank documents by observed use: this technician's own first, then the team's,
 * then everything else in the order the library declared.
 */
export function rankKnowledge(learning, items, { kind, idOf } = {}) {
  return rankByUse(items, {
    surface: KNOWLEDGE_SURFACE,
    personal: learning?.personal,
    team: learning?.team,
    idOf: (item) => knowledgeTarget(kind, idOf ? idOf(item) : item),
  });
}

/** The documents this technician has actually opened, most recent first. */
export function recentlyRead(learning, items, { kind, idOf, limit = 4 } = {}) {
  return recentlyUsed(items, {
    surface: KNOWLEDGE_SURFACE,
    personal: learning?.personal,
    idOf: (item) => knowledgeTarget(kind, idOf ? idOf(item) : item),
    limit,
  });
}

/**
 * An honest one-line description of what the ordering is based on, or `null`
 * when there is not enough evidence — in which case the reader must not claim to
 * be adapted to anything. Says whether the order is the technician's own or the
 * team's, because those are different claims.
 */
export function knowledgeHint(learning) {
  return learningHint({
    personal: learning?.personal,
    team: learning?.team,
    surface: KNOWLEDGE_SURFACE,
  });
}
