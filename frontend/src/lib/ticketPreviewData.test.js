import { buildTriageQueue, normaliseTriageQueue } from "./ticketPreviewData";

describe("ticket preview data", () => {
  const tickets = [
    { id: "1", priority: "critical", status: "open", assigned_to: null, created_at: "2026-01-01T00:00:00Z" },
    { id: "2", priority: "high", status: "in_progress", assigned_to: "tech-1", created_at: "2026-01-02T00:00:00Z" },
    { id: "3", priority: "low", status: "resolved", assigned_to: null, created_at: "2026-01-03T00:00:00Z" },
  ];

  test("builds a triage queue from active unassigned tickets", () => {
    const queue = buildTriageQueue(tickets);
    expect(queue.items.map(ticket => ticket.id)).toEqual(["1"]);
    expect(queue.by_priority.critical).toBe(1);
    expect(queue.count).toBe(1);
  });

  test("normalises incomplete and invalid triage payloads", () => {
    expect(normaliseTriageQueue([], tickets).count).toBe(1);
    expect(normaliseTriageQueue({ items: [] }, tickets)).toEqual({
      count: 0,
      oldest_age_minutes: 0,
      by_priority: { critical: 0, high: 0, medium: 0, low: 0 },
      items: [],
    });
  });
});
