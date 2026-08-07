import {
  chatAuthorName,
  channelDisplayName,
  extractOperationalContext,
  filterChatChannels,
  groupChatMessages,
  isLivePresence,
  repairDisplayText,
  totalUnread,
} from "./teamChatHelpers";

describe("team chat helpers", () => {
  const channels = [
    { id: "team-1", kind: "team", display_name: "Service Desk", unread_count: 2 },
    { id: "dm-1", kind: "dm", display_name: "Alex Smith", unread_count: 0 },
    { id: "group-1", kind: "group_dm", name: "Escalations", unread_count: 3 },
    { id: "object-1", kind: "object", display_name: "TKT-1042 · Mail flow", unread_count: 1 },
  ];

  test("separates chats, teams, and unread activity", () => {
    expect(filterChatChannels(channels, "teams").map(channel => channel.id)).toEqual(["team-1"]);
    expect(filterChatChannels(channels, "chat").map(channel => channel.id)).toEqual(["dm-1", "group-1"]);
    expect(filterChatChannels(channels, "work").map(channel => channel.id)).toEqual(["object-1"]);
    expect(filterChatChannels(channels, "activity").map(channel => channel.id)).toEqual(["team-1", "group-1", "object-1"]);
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
    expect(totalUnread(channels)).toBe(6);
  });

  test("counts active presence states without treating away or offline users as online", () => {
    expect(isLivePresence("active")).toBe(true);
    expect(isLivePresence("busy")).toBe(true);
    expect(isLivePresence("dnd")).toBe(true);
    expect(isLivePresence("away")).toBe(false);
    expect(isLivePresence("offline")).toBe(false);
  });

  test("extracts linked operational work across ticket families", () => {
    expect(extractOperationalContext([
      { body: "Investigating /ticket INC-0015 and change CHG-0001" },
      { body: "Duplicate INC-0015 with INV-100 and PO-009" },
      { body: "Follow-up SR-101 and INV-100" },
    ])).toEqual({
      tickets: 3,
      invoices: 1,
      purchaseOrders: 1,
    });
  });

  test("uses current Nexus naming for legacy system authors", () => {
    expect(chatAuthorName("NexusOps")).toBe("Nexus Automation");
    expect(chatAuthorName("Anything", true)).toBe("Nexus Automation");
    expect(chatAuthorName("Alex Thompson")).toBe("Alex Thompson");
  });

  test("repairs historic UTF-8 display corruption without changing clean text", () => {
    expect(repairDisplayText("Nexus collaboration")).toBe("Nexus collaboration");
    expect(repairDisplayText("ðŸš€ Ready")).toBe("🚀 Ready");
  });
});
