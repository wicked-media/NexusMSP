/**
 * The Knowledge & Help reader's learned ordering.
 *
 * The reader used to remember what a technician read in that technician's own
 * browser. It now learns through the shared workspace store
 * (`/workspace-learning/documentation`), so these tests pin the properties that
 * migration depends on: a guide and an article never share a key, a tool signal
 * never reorders documents, nothing moves below the shared evidence threshold,
 * this technician's own use outranks the team aggregate, "recently read" is this
 * technician's own history and never a colleague's, and the summary stays silent
 * until there is evidence.
 *
 * They run against the same index shape the server returns, because that index —
 * not a storage engine — is the contract now.
 */

import { LEARNING_MIN_SIGNALS, signalIndex } from "@/lib/workspaceLearning";
import {
  KNOWLEDGE_KINDS, KNOWLEDGE_MIN_SIGNALS, knowledgeCount, knowledgeHint, knowledgeTarget,
  rankKnowledge, recentlyRead, rememberKnowledge,
} from "./knowledgeLearning";

// The `@/` alias is a webpack/craco alias with no jest mapping, so every aliased
// module this suite reads is registered here. The module under test is the real
// one: these tests are about how the reader applies the shared ranking rules.
jest.mock("@/lib/workspaceLearning", () => jest.requireActual("../../lib/workspaceLearning"), { virtual: true });

/** One server index pair, exactly as `signalIndex` builds them from the API. */
const learning = ({ personal = [], team = [] } = {}) => ({
  personal: signalIndex(personal),
  team: signalIndex(team),
  memory: null,
  record: () => {},
  forget: async () => 0,
});

const view = (target, count, lastUsedAt = "2026-01-01T00:00:00+00:00") => ({
  surface: "view",
  target,
  count,
  last_used_at: lastUsedAt,
});

describe("evidence targets", () => {
  test("the reader uses the shared evidence threshold rather than one of its own", () => {
    expect(KNOWLEDGE_MIN_SIGNALS).toBe(LEARNING_MIN_SIGNALS);
  });

  test("namespaces a document by kind, so a guide and an article are never the same evidence", () => {
    expect(knowledgeTarget(KNOWLEDGE_KINDS.GUIDE, "Ticket Triage")).toBe("guide_ticket_triage");
    expect(knowledgeTarget(KNOWLEDGE_KINDS.ARTICLE, "Ticket Triage")).toBe("article_ticket_triage");
    expect(knowledgeTarget(KNOWLEDGE_KINDS.GUIDE, "ticket-triage"))
      .not.toBe(knowledgeTarget(KNOWLEDGE_KINDS.ARTICLE, "ticket-triage"));
  });

  test("refuses anything the server would reject instead of recording it", () => {
    expect(knowledgeTarget(KNOWLEDGE_KINDS.ARTICLE, "")).toBe("");
    expect(knowledgeTarget(KNOWLEDGE_KINDS.ARTICLE, "/*")).toBe("");
    // A category was recorded by the old browser-local store and read by nothing:
    // a target no surface ranks would still consume the server's key budget.
    expect(knowledgeTarget("category", "software")).toBe("");
    // The normalised target is the slug the server validates: lowercase, no
    // punctuation and never a leading digit.
    expect(knowledgeTarget(KNOWLEDGE_KINDS.ARTICLE, " 9 lives ")).toBe("article_lives");
  });
});

describe("recorded evidence", () => {
  test("records one view against the namespaced target", () => {
    const seen = [];
    const record = (surface, target) => seen.push(`${surface}:${target}`);
    rememberKnowledge(record, KNOWLEDGE_KINDS.GUIDE, "Ticket Triage");
    rememberKnowledge(record, KNOWLEDGE_KINDS.ARTICLE, "");
    expect(seen).toEqual(["view:guide_ticket_triage"]);
  });

  test("a store that is not there yet never breaks the reader", () => {
    expect(() => rememberKnowledge(undefined, KNOWLEDGE_KINDS.GUIDE, "ticket-triage")).not.toThrow();
  });
});

describe("ranking", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const rank = (state) => rankKnowledge(state, items, {
    kind: KNOWLEDGE_KINDS.ARTICLE,
    idOf: (item) => item.id,
  }).map((item) => item.id);

  test("nothing moves below the evidence threshold, and real use does", () => {
    expect(rank(learning({ personal: [view("article_c", KNOWLEDGE_MIN_SIGNALS - 1)] }))).toEqual(["a", "b", "c"]);
    expect(rank(learning({ personal: [view("article_c", KNOWLEDGE_MIN_SIGNALS)] }))).toEqual(["c", "a", "b"]);
  });

  test("this technician's own use outranks the team aggregate", () => {
    const state = learning({
      personal: [view("article_b", KNOWLEDGE_MIN_SIGNALS)],
      team: [view("article_c", 40)],
    });
    expect(rank(state)).toEqual(["b", "c", "a"]);
  });

  test("the team's use outranks having no evidence at all", () => {
    expect(rank(learning({ team: [view("article_c", 9)] }))).toEqual(["c", "a", "b"]);
  });

  test("evidence from the other library never reorders this one", () => {
    expect(rank(learning({ personal: [view("guide_c", 20)] }))).toEqual(["a", "b", "c"]);
  });

  test("a tool signal in the same workspace never reorders documents", () => {
    const state = learning({
      personal: [{ surface: "action", target: "article_c", count: 20, last_used_at: "2026-01-01T00:00:00+00:00" }],
    });
    expect(rank(state)).toEqual(["a", "b", "c"]);
  });
});

describe("recently read", () => {
  const items = [{ id: "first" }, { id: "second" }, { id: "never" }];
  const recent = (state, limit) => recentlyRead(state, items, {
    kind: KNOWLEDGE_KINDS.ARTICLE,
    idOf: (item) => item.id,
    limit,
  }).map((item) => item.id);

  test("is newest first, personal only, and never invents history", () => {
    const state = learning({
      personal: [
        view("article_first", 1, "2026-01-01T00:00:00+00:00"),
        view("article_second", 1, "2026-02-01T00:00:00+00:00"),
      ],
      // A guide the whole team reads is not this technician's reading history,
      // and presenting it as such would attribute a colleague's visit to them.
      team: [view("article_never", 30, "2026-03-01T00:00:00+00:00")],
    });
    expect(recent(state)).toEqual(["second", "first"]);
  });

  test("honours the caller's limit", () => {
    const state = learning({ personal: [view("article_first", 1), view("article_second", 1)] });
    expect(recent(state, 1)).toEqual(["first"]);
    expect(recent(learning(), 4)).toEqual([]);
  });
});

describe("opened counts", () => {
  test("the badge counts this technician's own opens, and nothing else", () => {
    const state = learning({ personal: [view("guide_x", 3)], team: [view("guide_x", 17)] });
    expect(knowledgeCount(state, KNOWLEDGE_KINDS.GUIDE, "x")).toBe(3);
    expect(knowledgeCount(state, KNOWLEDGE_KINDS.ARTICLE, "x")).toBe(0);
    expect(knowledgeCount(undefined, KNOWLEDGE_KINDS.GUIDE, "x")).toBe(0);
  });
});

describe("the memory statement stays honest", () => {
  test("silent until there is real evidence", () => {
    expect(knowledgeHint(learning())).toBeNull();
    expect(knowledgeHint(learning({ personal: [view("article_a", KNOWLEDGE_MIN_SIGNALS - 1)] }))).toBeNull();
  });

  test("names this technician's own use when the order is personal", () => {
    const hint = knowledgeHint(learning({ personal: [view("article_a", KNOWLEDGE_MIN_SIGNALS)] }));
    expect(hint.tone).toBe("personal");
    expect(hint.label).toBe("Adapted to your use");
    expect(hint.detail).toContain("Nothing here changes what you can access");
  });

  test("names the team when the order comes from colleagues", () => {
    const hint = knowledgeHint(learning({ team: [view("article_a", 12)] }));
    expect(hint.tone).toBe("team");
    expect(hint.label).toBe("Shaped by your team");
    expect(hint.detail).toContain("your team");
  });

  test("counts both libraries as one reader, because they are one workspace", () => {
    const state = learning({ personal: [view("guide_a", 2), view("article_b", 2)] });
    expect(knowledgeHint(state).signals).toBe(4);
  });
});
