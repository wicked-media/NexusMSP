/**
 * Learned workspace ordering helpers, shared by every Nexus workspace.
 *
 * Nexus workspaces are larger than one screen: the client workspace has six
 * navigation groups and ten quick actions, the ticket workspace has twelve
 * detail tabs and a desk-tools menu, the voice workspace has a catalogue of
 * provider interfaces. Each workspace records which views a technician opens and
 * which actions they run, then ranks itself with that evidence — its own
 * navigation, and which actions stay visible.
 *
 * These helpers are deliberately pure and deliberately conservative:
 *
 *   - Nothing moves until there is real evidence (`minimum`), so a first-time
 *     technician sees exactly the designed workspace, not an empty guess.
 *   - Ties and unknown items keep the order the workspace declares, which keeps
 *     a hand-authored hierarchy (a warning before an invoice) meaningful.
 *   - Personal evidence always outranks the team aggregate, so another
 *     technician's habits can never override yours.
 *
 * Evidence is partitioned per workspace by the server, so these helpers never
 * need to know which workspace they are ranking: the indexes they are handed
 * already contain one workspace's evidence and nothing else. A view named
 * `billing` in the invoice workspace is therefore never confused with an action
 * named `billing` in the client workspace.
 *
 * The learning is presentation only. It cannot reveal a record, grant access or
 * promote an action the technician could not already run.
 *
 * A workspace slug must exist in the server's registry before it can remember
 * anything, so these names are the contract, not a label.
 */

export const LEARNING_VIEW = "view";
export const LEARNING_ACTION = "action";

/**
 * The workspaces that may remember how they are used. The backend owns the
 * authoritative registry and rejects any slug that is not in it, so a typo here
 * fails loudly in development instead of quietly creating a parallel memory.
 */
export const LEARNING_WORKSPACES = Object.freeze({
  CLIENT: "client",
  TICKETS: "tickets",
  INVOICES: "invoices",
  VOICE: "voice",
  DEVICES: "devices",
  PURCHASE_ORDERS: "purchase_orders",
  // The conversation workspace learns which channels, threads and tools a
  // technician actually opens. This slug exists in the server registry
  // (backend/app/routers/workspace_learning.py), which is the authority.
  CHAT: "chat",
  // The documentation reader (Knowledge Base, Help Centre and the hub in front
  // of them) learns which guides and articles a technician opens, under the
  // shared store like every other workspace. It was browser-local until this
  // slug existed: the guides that a reader finds useful are exactly the guides a
  // colleague should be shown, and a technician who changes machine should not
  // start from the authored order again. The kind is part of the target slug
  // (components/knowledge/knowledgeLearning.js) so a guide and an article with
  // the same name are never the same piece of evidence.
  DOCUMENTATION: "documentation",
});

/**
 * Signals needed before the workspace reorders itself. Set above a single
 * accidental click so one mistaken visit never reshapes the workspace, and low
 * enough that a technician's real habit shows up within a working day.
 */
export const LEARNING_MIN_SIGNALS = 4;

/** Quick actions always visible in the strip before it starts overflowing. */
export const VISIBLE_ACTION_SLOTS = 3;

const SURFACES = new Set([LEARNING_VIEW, LEARNING_ACTION]);

/**
 * Normalise a workspace target into the short lowercase identifier the server
 * accepts (`^[a-z][a-z0-9_]{0,47}$`).
 *
 * Most workspaces already name their targets that way. The voice workspace is
 * the exception: its provider interfaces are dotted identifiers such as
 * `extension.list`, which describe the interface perfectly but are not legal
 * slugs. Normalising in one place lets a component hand over the provider's own
 * identifier while recording and ranking still resolve to one key — and it means
 * an unusable target is dropped instead of being sent to the server to fail.
 */
export function learningSlug(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .slice(0, 48)
    .replace(/_+$/, "");
}

function safeCount(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function targetId(item, idOf) {
  if (typeof idOf === "function") return idOf(item);
  if (item && typeof item === "object") return item.id ?? item.value ?? item.target;
  return item;
}

/**
 * Index signal rows by `surface:target`.
 *
 * Accepts the rows `/client-workspace/learning` returns, and ignores anything
 * that is not shaped like recorded evidence instead of guessing at it.
 */
export function signalIndex(rows) {
  const index = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const surface = String(row?.surface || "").toLowerCase();
    const target = String(row?.target || "").trim().toLowerCase();
    if (!SURFACES.has(surface) || !target) return;
    index.set(`${surface}:${target}`, {
      count: safeCount(row?.count),
      lastUsedAt: row?.last_used_at || null,
    });
  });
  return index;
}

export function evidenceFor(surface, id, personal = new Map(), team = new Map()) {
  const target = learningSlug(id);
  if (!target) return { mine: 0, theirs: 0 };
  const key = `${surface}:${target}`;
  return {
    mine: personal.get(key)?.count || 0,
    theirs: team.get(key)?.count || 0,
  };
}

/**
 * Rank candidate items by observed use.
 *
 * Items ranked by this technician's own use come first, then items the team
 * uses, then everything else in its declared order. `surface` is required: a
 * view named `billing` and an action named `billing` are different evidence and
 * must never be confused.
 */
export function rankByUse(items, {
  surface,
  personal = new Map(),
  team = new Map(),
  idOf,
  minimum = LEARNING_MIN_SIGNALS,
} = {}) {
  const list = Array.isArray(items) ? items : [];
  const scored = list.map((item, index) => {
    const { mine, theirs } = evidenceFor(surface, targetId(item, idOf), personal, team);
    // Three tiers, so this technician's own habit always beats the team's, and
    // the team's habit always beats having no evidence at all.
    const tier = mine >= minimum ? 0 : theirs >= minimum ? 1 : 2;
    return { item, index, tier, count: mine >= minimum ? mine : theirs };
  });
  const known = scored.filter((entry) => entry.tier < 2);
  const rest = scored.filter((entry) => entry.tier === 2);
  known.sort((left, right) => left.tier - right.tier || right.count - left.count || left.index - right.index);
  return [...known, ...rest].map((entry) => entry.item);
}

/**
 * The items this technician opened most recently, newest first.
 *
 * Only the caller's own evidence is read. The team aggregate carries a
 * last-used timestamp, but it answers "when did anyone last use this" — showing
 * it as one technician's reading history would attribute a colleague's activity
 * to them, so a workspace that means *you* must pass `personal`.
 */
export function recentlyUsed(items, {
  surface,
  personal = new Map(),
  idOf,
  limit = 5,
} = {}) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const target = learningSlug(targetId(item, idOf));
      return { item, entry: target ? personal.get(`${surface}:${target}`) : null };
    })
    .filter(({ entry }) => Boolean(entry))
    .sort((left, right) => String(right.entry.lastUsedAt || "").localeCompare(String(left.entry.lastUsedAt || "")))
    .slice(0, Math.max(0, Number(limit) || 0))
    .map(({ item }) => item);
}

/**
 * The item a workspace group should open for this technician.
 *
 * Returns `null` when there is no evidence, or when the group's declared first
 * view is already the most used one — in both cases the caller's fallback is the
 * correct answer, and the workspace must not pretend it rearranged anything.
 */
export function preferredTarget(items, options = {}) {
  const list = Array.isArray(items) ? items : [];
  const ranked = rankByUse(list, options);
  if (!ranked.length) return null;
  const choice = ranked[0];
  if (choice === list[0]) return null;
  return choice;
}

/**
 * The item with the strongest real evidence, or `null` when nothing has earned it.
 *
 * `preferredTarget` answers "should the workspace change anything?", which reads
 * a declared-first item as "no change". Some surfaces need the other question —
 * "which item has a technician actually chosen?" — because their designed
 * default is not the declared-first item (the voice console opens on the
 * read-only Extension roster rather than the alphabetically first family).
 */
export function mostUsed(items, {
  surface,
  personal = new Map(),
  team = new Map(),
  idOf,
  minimum = LEARNING_MIN_SIGNALS,
} = {}) {
  const ranked = rankByUse(items, { surface, personal, team, idOf, minimum });
  return ranked.find((item) => {
    const { mine, theirs } = evidenceFor(surface, targetId(item, idOf), personal, team);
    return mine >= minimum || theirs >= minimum;
  }) || null;
}

/**
 * The items the workspace has gathered enough evidence for.
 *
 * This is the "may leave the overflow menu" primitive: an item a technician or
 * their team genuinely uses earns a place in the visible bar, and one that is
 * not really used stays exactly where the workspace declared it.
 */
export function promotedItems(items, options = {}) {
  const {
    surface,
    personal = new Map(),
    team = new Map(),
    idOf,
    minimum = LEARNING_MIN_SIGNALS,
  } = options;
  return (Array.isArray(items) ? items : []).filter((item) => {
    const { mine, theirs } = evidenceFor(surface, targetId(item, idOf), personal, team);
    return mine >= minimum || theirs >= minimum;
  });
}

/** Split quick actions into the visible strip and the overflow menu. */
export function splitQuickActions(actions, options = {}) {
  const ranked = rankByUse(actions, options);
  const limit = Math.max(0, Number(options.limit ?? VISIBLE_ACTION_SLOTS) || 0);
  return { visible: ranked.slice(0, limit), overflow: ranked.slice(limit) };
}

/**
 * Honest description of what the ranking is based on, or `null` when there is
 * not enough evidence — in which case the workspace must not claim to be smart.
 */
export function learningHint({
  personal = new Map(),
  team = new Map(),
  surface,
  minimum = LEARNING_MIN_SIGNALS,
} = {}) {
  const sum = (index) => [...index.entries()]
    .filter(([key]) => !surface || key.startsWith(`${surface}:`))
    .reduce((total, [, value]) => total + value.count, 0);
  const personalSignals = sum(personal);
  const teamSignals = sum(team);

  if (personalSignals >= minimum) {
    return {
      tone: "personal",
      label: "Adapted to your use",
      detail: `Ranked by what you open most in this workspace (${personalSignals} recorded signal${personalSignals === 1 ? "" : "s"}). Nothing here changes what you can access.`,
      signals: personalSignals,
    };
  }
  if (teamSignals >= minimum) {
    return {
      tone: "team",
      label: "Shaped by your team",
      detail: `Ordered by what your team uses most (${teamSignals} recorded signals). It becomes personal to you as you use the workspace.`,
      signals: teamSignals,
    };
  }
  return null;
}
