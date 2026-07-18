import {
  channelDisplayName,
  filterChatChannels,
  groupChatMessages,
  totalUnread,
} from "./teamChatHelpers";

describe("team chat helpers", () => {
  const channels = [
    { id: "team-1", kind: "team", display_name: "Service Desk", unread_count: 2 },
    { id: "dm-1", kind: "dm", display_name: "Alex Smith", unread_count: 0 },
    { id: "group-1", kind: "group_dm", name: "Escalations", unread_count: 3 },
  ];

  test("separates chats, teams, and unread activity", () => {
    expect(filterChatChannels(channels, "teams").map(channel => channel.id)).toEqual(["team-1"]);
    expect(filterChatChannels(channels, "chat").map(channel => channel.id)).toEqual(["dm-1", "group-1"]);
    expect(filterChatChannels(channels, "activity").map(channel => channel.id)).toEqual(["team-1", "group-1"]);
  });

  test("uses safe display names for legacy direct messages", () => {
    expect(channelDisplayName({ kind: "dm", name: "dm:user-1:user-2" })).toBe("Direct message");
    expect(channelDisplayName({ kind: "team", name: "service-desk" })).toBe("Service Desk");
  });

  test("groups consecutive posts while preserving day boundaries", () => {
    const groups = groupChatMessages([
      { id: "1", user_id: "a", ts: "2026-07-13T01:00:00Z" },
      { id: "2", user_id: "a", ts: "2026-07-13T01:02:00Z" },
      { id: "3", user_id: "a", ts: "2026-07-14T01:02:00Z" },
    ]);

    expect(groups.map(group => group.type)).toEqual(["day", "message", "message", "day", "message"]);
    expect(groups[2].compact).toBe(true);
    expect(groups[4].compact).toBe(false);
  });

  test("totals unread conversation counts", () => {
    expect(totalUnread(channels)).toBe(5);
  });
});
