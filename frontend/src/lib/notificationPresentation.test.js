import {
  coalesceStateNotifications,
  notificationRecordIds,
  selectedNotificationRecordIds,
} from "./notificationPresentation";

describe("notification presentation", () => {
  test("coalesces repeated state alerts for the same operational record", () => {
    const notifications = coalesceStateNotifications([
      { id: "older", type: "sla_breach", ref_type: "ticket", ref_id: "ticket-1", read: true, created_at: "2026-09-01T00:00:00Z" },
      { id: "newer", type: "sla_breach", ref_type: "ticket", ref_id: "ticket-1", read: false, created_at: "2026-09-02T00:00:00Z" },
    ]);

    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ id: "newer", occurrence_count: 2, read: false });
    expect(notificationRecordIds(notifications[0])).toEqual(["newer", "older"]);
  });

  test("keeps event notifications and records without stable references separate", () => {
    const notifications = coalesceStateNotifications([
      { id: "chat-1", type: "thread_reply", ref_type: "conversation", ref_id: "same" },
      { id: "chat-2", type: "thread_reply", ref_type: "conversation", ref_id: "same" },
      { id: "system-1", type: "system" },
      { id: "system-2", type: "system" },
    ]);

    expect(notifications).toHaveLength(4);
  });

  test("coalesces byte-for-byte duplicate state events even when legacy record ids differ", () => {
    const duplicate = {
      type: "ticket_assigned",
      ref_type: "ticket",
      title: "Ticket Assigned: Migration",
      message: "You were assigned SR-0003 - Migration",
      created_at: "2026-09-02T00:00:00Z",
      read: false,
    };
    const notifications = coalesceStateNotifications([
      { ...duplicate, id: "one", ref_id: "legacy-ticket" },
      { ...duplicate, id: "two", ref_id: "current-ticket", created_at: "2026-09-03T00:00:00Z" },
    ]);

    expect(notifications).toHaveLength(1);
    expect(notifications[0].occurrence_count).toBe(2);
    expect(notificationRecordIds(notifications[0])).toEqual(["two", "one"]);
  });

  test("expands selected presentation rows back to every retained record id", () => {
    const notifications = coalesceStateNotifications([
      { id: "one", type: "device_offline", ref_type: "device", ref_id: "device-1" },
      { id: "two", type: "device_offline", ref_type: "device", ref_id: "device-1" },
      { id: "three", type: "system" },
    ]);

    expect(selectedNotificationRecordIds(notifications, new Set([notifications[0].id]))).toEqual(["one", "two"]);
  });
});
