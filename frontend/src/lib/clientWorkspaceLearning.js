/**
 * Client workspace learning helpers.
 *
 * The client workspace is larger than one screen: six navigation groups, more
 * than a dozen views, and ten quick actions. Nexus records which views a
 * technician opens and which actions they run, then uses that evidence to rank
 * the workspace — its own navigation, and which quick actions stay visible.
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
 * The learning is presentation only. It cannot reveal a client, grant access or
 * promote an action the technician could not already run.
 */

export const LEARNING_VIEW = "view";
export const LEARNING_ACTION = "action";

/**
 * Signals needed before the workspace reorders itself. Set above a single
 * accidental click so one mistaken visit never reshapes the workspace, and low
 * enough that a technician's real habit shows up within a working day.
 */
export const LEARNING_MIN_SIGNALS = 4;

/** Quick actions always visible in the strip before it starts overflowing. */
export const VISIBLE_ACTION_SLOTS = 3;

const SURFACES = new Set([LEARNING_VIEW, LEARNING_ACTION]);

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

function evidenceFor(surface, id, personal, team) {
  if (!id) return { mine: 0, theirs: 0 };
  const key = `${surface}:${String(id).trim().toLowerCase()}`;
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
