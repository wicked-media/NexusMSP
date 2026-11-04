import {
  channelLearningTarget,
  isTypingTarget,
  rankChatSurfaces,
  rememberRecentConversation,
  surfaceTarget,
  unreadAnchorIndex,
} from "./chatLearning";

// Jest has no "@" module mapping in this project; the established convention is
// to point the alias at the real module virtually so the helpers under test are
// the shipped ones.
jest.mock("@/lib/workspaceLearning", () => jest.requireActual("../../lib/workspaceLearning"), { virtual: true });

const { signalIndex } = require("../../lib/workspaceLearning");

describe("chat learning helpers", () => {
  test("an unnamed conversation still records a stable, unambiguous target", () => {
    const target = channelLearningTarget({ id: "3f2a91c4-77de-4c1a-9f30-2b7d1a6e5c88", kind: "team" });
    expect(target).toMatch(/^team_[a-z0-9_]+$/);
    expect(target).not.toContain("-");
    expect(target.length).toBeLessThanOrEqual(48);
    expect(channelLearningTarget(null)).toBe("");
    expect(channelLearningTarget({ kind: "team" })).toBe("");
  });

  test("a named conversation records one stable, bounded slug", () => {
    expect(channelLearningTarget({ id: "abc", kind: "team", name: "Backup Operations" })).toBe("team_backup_operations");
    expect(channelLearningTarget({ id: "abc", kind: "dm", other_user_name: "Ada Byron" })).toBe("dm_ada_byron");
  });

  test("a declared surface is dropped when it is not already a usable slug", () => {
    expect(surfaceTarget("posts")).toBe("posts");
    expect(surfaceTarget("Work Rooms")).toBe("");
    expect(surfaceTarget("9lives")).toBe("");
    expect(surfaceTarget("")).toBe("");
  });

  test("recent conversations deduplicate and keep the newest first", () => {
    const list = rememberRecentConversation([{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }], { id: "b", name: "Beta" });
    expect(list.map((item) => item.id)).toEqual(["b", "a"]);
    expect(rememberRecentConversation([{ id: "a" }], {})).toEqual([{ id: "a" }]);
  });

  test("the unread marker only appears when there is something unread inside the page", () => {
    const messages = [{ id: "1" }, { id: "2" }, { id: "3" }, { id: "4" }];
    expect(unreadAnchorIndex(messages, 2)).toBe(2);
    expect(unreadAnchorIndex(messages, 0)).toBe(-1);
    expect(unreadAnchorIndex(messages, 99)).toBe(-1);
    expect(unreadAnchorIndex([], 2)).toBe(-1);
  });

  test("single-key shortcuts never steal a field the technician is typing in", () => {
    expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTypingTarget({ tagName: "input" })).toBe(true);
    expect(isTypingTarget({ isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", closest: () => null })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  test("ranking keeps the declared order without evidence and leads with use once there is", () => {
    const declared = [{ id: "inbox" }, { id: "channels" }, { id: "clients" }];
    expect(rankChatSurfaces(declared, { surface: "view" }).map((item) => item.id)).toEqual(["inbox", "channels", "clients"]);

    const personal = signalIndex([{ surface: "view", target: "clients", count: 9 }]);
    expect(rankChatSurfaces(declared, { surface: "view", learning: { personal } }).map((item) => item.id))
      .toEqual(["clients", "inbox", "channels"]);
  });
});
