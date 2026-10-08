import {
  LEARNING_ACTION,
  LEARNING_MIN_SIGNALS,
  LEARNING_VIEW,
  learningHint,
  preferredTarget,
  rankByUse,
  signalIndex,
  splitQuickActions,
} from "./clientWorkspaceLearning";

const rows = (surface, entries) => entries.map(([target, count]) => ({ surface, target, count, last_used_at: "2026-05-01T00:00:00+00:00" }));

const views = [
  { value: "billing" },
  { value: "subscriptions" },
];

describe("client workspace learning helpers", () => {
  test("indexes only well-formed evidence and ignores anything else", () => {
    const index = signalIndex([
      ...rows(LEARNING_VIEW, [["billing", 6]]),
      { surface: "click", target: "billing", count: 99 },
      { surface: LEARNING_ACTION, target: "", count: 3 },
      { surface: LEARNING_ACTION, target: "schedule", count: "4" },
      { surface: LEARNING_ACTION, target: "invoice", count: -2 },
      null,
    ]);

    expect(index.get("view:billing").count).toBe(6);
    expect(index.get("action:schedule").count).toBe(4);
    expect(index.get("action:invoice").count).toBe(0);
    expect(index.has("click:billing")).toBe(false);
    expect(index.size).toBe(3);
  });

  test("a workspace with no evidence keeps exactly the order it declares", () => {
    const ranked = rankByUse(views, { surface: LEARNING_VIEW, idOf: (view) => view.value });

    expect(ranked).toEqual(views);
    expect(preferredTarget(views, { surface: LEARNING_VIEW, idOf: (view) => view.value })).toBeNull();
  });

  test("a single accidental visit never reshapes the workspace", () => {
    const personal = signalIndex(rows(LEARNING_VIEW, [["subscriptions", LEARNING_MIN_SIGNALS - 1]]));

    const ranked = rankByUse(views, { surface: LEARNING_VIEW, personal, idOf: (view) => view.value });

    expect(ranked.map((view) => view.value)).toEqual(["billing", "subscriptions"]);
  });

  test("sustained use promotes the view that is actually used, highest first", () => {
    const personal = signalIndex(rows(LEARNING_VIEW, [["subscriptions", 5], ["billing", 9]]));
    const options = { surface: LEARNING_VIEW, personal, idOf: (view) => view.value };

    // The most used view is already the group's declared entry point, so the
    // group opens the same view it always did and claims nothing.
    expect(rankByUse(views, options).map((view) => view.value)).toEqual(["billing", "subscriptions"]);
    expect(preferredTarget(views, options)).toBeNull();

    // Once a different view is genuinely used, the group opens that one instead.
    const flipped = signalIndex(rows(LEARNING_VIEW, [["subscriptions", 9]]));
    expect(preferredTarget(views, { ...options, personal: flipped }).value).toBe("subscriptions");
    expect(preferredTarget(views, { ...options, personal: flipped, minimum: 20 })).toBeNull();
  });

  test("equal evidence keeps the declared hierarchy instead of shuffling it", () => {
    const personal = signalIndex(rows(LEARNING_VIEW, [["billing", 8]]));
    const options = { surface: LEARNING_VIEW, personal, idOf: (view) => view.value };

    const first = rankByUse(views, options).map((view) => view.value);
    const second = rankByUse(views, options).map((view) => view.value);

    expect(first).toEqual(["billing", "subscriptions"]);
    expect(second).toEqual(first);
  });

  test("a view and an action with the same name are never the same evidence", () => {
    const actions = [{ id: "billing" }, { id: "schedule" }];
    const personal = signalIndex(rows(LEARNING_VIEW, [["billing", 40]]));

    const ranked = rankByUse(actions, { surface: LEARNING_ACTION, personal, idOf: (action) => action.id });

    expect(ranked.map((action) => action.id)).toEqual(["billing", "schedule"]);
  });

  test("team habits help a new technician but never outrank that technician's own", () => {
    const team = signalIndex(rows(LEARNING_ACTION, [["warroom", 30]]));
    const personal = signalIndex(rows(LEARNING_ACTION, [["schedule", LEARNING_MIN_SIGNALS]]));
    const actions = [{ id: "warroom" }, { id: "schedule" }];

    const fromTeam = rankByUse(actions, { surface: LEARNING_ACTION, team, idOf: (action) => action.id });
    const fromMine = rankByUse(actions, { surface: LEARNING_ACTION, team, personal, idOf: (action) => action.id });

    expect(fromTeam.map((action) => action.id)).toEqual(["warroom", "schedule"]);
    expect(fromMine.map((action) => action.id)).toEqual(["schedule", "warroom"]);
  });

  test("an overflow action is promoted into the visible strip once it is really used", () => {
    const actions = [
      { id: "device" },
      { id: "email" },
      { id: "schedule" },
      { id: "health" },
      { id: "invoice" },
    ];
    const coldStart = splitQuickActions(actions, { surface: LEARNING_ACTION, idOf: (action) => action.id });

    expect(coldStart.visible.map((action) => action.id)).toEqual(["device", "email", "schedule"]);
    expect(coldStart.overflow.map((action) => action.id)).toEqual(["health", "invoice"]);

    const personal = signalIndex(rows(LEARNING_ACTION, [["health", 12]]));
    const learned = splitQuickActions(actions, { surface: LEARNING_ACTION, personal, idOf: (action) => action.id });

    expect(learned.visible.map((action) => action.id)).toEqual(["health", "device", "email"]);
    expect(learned.overflow.map((action) => action.id)).toEqual(["schedule", "invoice"]);
    expect(splitQuickActions(actions, { surface: LEARNING_ACTION, idOf: (action) => action.id, limit: 1 }).visible).toHaveLength(1);
  });

  test("the workspace only claims to be adapted when it has the evidence", () => {
    const thin = signalIndex(rows(LEARNING_ACTION, [["device", 2]]));
    const team = signalIndex(rows(LEARNING_ACTION, [["device", 9], ["health", 3]]));
    const personal = signalIndex(rows(LEARNING_ACTION, [["health", 6]]));

    expect(learningHint({ surface: LEARNING_ACTION, personal: thin })).toBeNull();

    const fromTeam = learningHint({ surface: LEARNING_ACTION, personal: thin, team });
    expect(fromTeam.tone).toBe("team");
    expect(fromTeam.signals).toBe(12);
    expect(fromTeam.detail).toContain("team");

    const mine = learningHint({ surface: LEARNING_ACTION, personal, team });
    expect(mine.tone).toBe("personal");
    expect(mine.signals).toBe(6);
    expect(mine.label).toBe("Adapted to your use");
  });
});
