import { buildTicketPulse, buildTicketQueueNextMove, formatPulseDuration } from "./ticketCasePulse";

const NOW = new Date("2026-11-15T12:00:00.000Z");

function ticket(overrides = {}) {
  return {
    id: "ticket-1",
    status: "open",
    ticket_type: "incident",
    priority: "medium",
    created_at: "2026-11-15T10:00:00.000Z",
    sla_due: "2026-11-15T14:00:00.000Z",
    assigned_to: "tech-1",
    assigned_name: "Alex Technician",
    ...overrides,
  };
}

describe("ticket case pulse", () => {
  test("measures the SLA runway from persisted timestamps", () => {
    const pulse = buildTicketPulse(ticket(), {}, NOW);

    expect(pulse.state).toBe("critical");
    expect(pulse.remainingMinutes).toBe(120);
    expect(pulse.elapsedMinutes).toBe(120);
    expect(pulse.totalMinutes).toBe(240);
    expect(pulse.progressPct).toBe(50);
  });

  test("asks for ownership before anything else when no technician is recorded", () => {
    const pulse = buildTicketPulse(ticket({ assigned_to: null, assigned_name: null }), {}, NOW);

    expect(pulse.nextMove.action).toBe("claim");
    expect(pulse.nextMove.cta).toBe("Claim ticket");
  });

  test("prioritises a recovery update when the SLA has already passed", () => {
    const pulse = buildTicketPulse(ticket({ sla_due: "2026-11-15T11:00:00.000Z" }), {}, NOW);

    expect(pulse.state).toBe("overdue");
    expect(pulse.nextMove.action).toBe("reply");
    expect(pulse.nextMove.cta).toBe("Send recovery update");
    expect(pulse.nextMove.detail).toContain("1h");
  });

  test("uses only customer-visible notes and emails for the update count", () => {
    const pulse = buildTicketPulse(ticket({ sla_due: "2026-11-15T16:00:00.000Z", device_ids: ["device-1", "device-2"], total_time_minutes: 30 }), {
      notes: [
        { id: "note-1", visibility: "internal", created_at: "2026-11-15T10:30:00.000Z" },
        { id: "note-2", visibility: "public", created_at: "2026-11-15T11:00:00.000Z" },
      ],
      emails: [
        { id: "email-1", sent_at: "2026-11-15T11:15:00.000Z", delivery_status: "sent" },
        { id: "email-2", sent_at: "2026-11-15T11:20:00.000Z", delivery_status: "failed" },
      ],
      timeEntries: [{ minutes: 25 }, { minutes: 35 }],
    }, NOW);

    expect(pulse.metrics.customerUpdates).toBe(2);
    expect(pulse.metrics.recordedMinutes).toBe(60);
    expect(pulse.metrics.deviceCount).toBe(2);
    expect(pulse.lastTouch).toEqual(new Date("2026-11-15T11:20:00.000Z"));
    expect(pulse.nextMove.title).toBe("Keep the record moving");
  });

  test("asks for a checkpoint when work is paused", () => {
    const pulse = buildTicketPulse(ticket({ status: "on_hold", sla_due: "2026-11-15T16:00:00.000Z" }), {
      notes: [{ id: "note-1", visibility: "public", created_at: "2026-11-15T10:30:00.000Z" }],
    }, NOW);

    expect(pulse.nextMove.title).toBe("Record the next checkpoint");
    expect(pulse.nextMove.action).toBe("reply");
  });

  test("suggests an endpoint when an incident has evidence gaps", () => {
    const pulse = buildTicketPulse(ticket({ sla_due: "2026-11-15T16:00:00.000Z" }), {
      notes: [{ id: "note-1", visibility: "public", created_at: "2026-11-15T10:30:00.000Z" }],
    }, NOW);

    expect(pulse.nextMove.action).toBe("devices");
    expect(pulse.nextMove.cta).toBe("Link endpoint");
  });

  test("marks a resolved ticket resolved rather than closed", () => {
    const pulse = buildTicketPulse(ticket({
      status: "resolved",
      resolved_at: "2026-11-15T11:00:00.000Z",
    }), {}, NOW);

    expect(pulse.state).toBe("complete");
    expect(pulse.nextMove.detail).toContain("resolved");
    expect(pulse.nextMove.detail).not.toContain("closed");
  });

  test("marks terminal tickets complete without inventing a next action", () => {
    const pulse = buildTicketPulse(ticket({
      status: "closed",
      closed_at: "2026-11-15T11:00:00.000Z",
    }), {}, NOW);

    expect(pulse.state).toBe("complete");
    expect(pulse.nextMove.action).toBeNull();
    expect(pulse.progressPct).toBe(25);
  });

  test("gives queue rows one short next move from persisted fields", () => {
    expect(buildTicketQueueNextMove(ticket({ assigned_to: null, assigned_name: null }), NOW)).toMatchObject({ key: "claim", label: "Claim", tone: "claim" });
    expect(buildTicketQueueNextMove(ticket({ sla_due: "2026-11-15T11:00:00.000Z" }), NOW)).toMatchObject({ key: "recover", label: "Recovery", tone: "critical" });
    expect(buildTicketQueueNextMove(ticket({ sla_due: "2026-11-15T16:00:00.000Z", last_technician_reply_at: "2026-11-15T11:00:00.000Z", device_id: "device-1" }), NOW)).toMatchObject({ key: "add_update", label: "Add update" });
  });

  test("surfaces first update, endpoint and terminal queue states without inventing activity", () => {
    expect(buildTicketQueueNextMove(ticket({ sla_due: "2026-11-15T16:00:00.000Z" }), NOW)).toMatchObject({ key: "first_update", label: "First update" });
    expect(buildTicketQueueNextMove(ticket({ sla_due: "2026-11-15T16:00:00.000Z", last_technician_reply_at: "2026-11-15T11:00:00.000Z" }), NOW)).toMatchObject({ key: "endpoint", label: "Link endpoint" });
    expect(buildTicketQueueNextMove(ticket({ status: "closed", closed_at: "2026-11-15T11:00:00.000Z" }), NOW)).toMatchObject({ key: "complete", label: "Complete", tone: "complete" });
  });

  test("advances past recovery once a technician update is recorded after the breach", () => {
    const breached = ticket({ sla_due: "2026-11-15T11:00:00.000Z", last_technician_reply_at: "2026-11-15T11:30:00.000Z", device_id: "device-1" });
    expect(buildTicketQueueNextMove(breached, NOW)).toMatchObject({ key: "next_checkpoint", label: "Next checkpoint" });
    expect(buildTicketQueueNextMove({ ...breached, device_id: null, device_ids: [] }, NOW)).toMatchObject({ key: "endpoint", label: "Link endpoint" });
    expect(buildTicketPulse(breached, { notes: [{ visibility: "public", created_at: "2026-11-15T11:30:00.000Z" }] }, NOW).nextMove.title).toBe("Set the next checkpoint");
  });

  test("shows the stored promise on an overdue case and flags a missed one", () => {
    const promised = ticket({
      sla_due: "2026-11-15T11:00:00.000Z",
      last_technician_reply_at: "2026-11-15T11:30:00.000Z",
      next_checkpoint_at: "2026-11-15T14:00:00.000Z",
      device_id: "device-1",
    });
    expect(buildTicketQueueNextMove(promised, NOW)).toMatchObject({
      key: "promised",
      label: "Promised 2h",
      tone: "attention",
    });
    const pulse = buildTicketPulse(promised, {
      notes: [{ visibility: "public", created_at: "2026-11-15T11:30:00.000Z" }],
    }, NOW);
    expect(pulse.nextMove.title).toBe("Next update promised");
    expect(pulse.nextCheckpoint).toEqual(new Date("2026-11-15T14:00:00.000Z"));
    expect(pulse.checkpointMinutes).toBe(120);

    const missed = { ...promised, next_checkpoint_at: "2026-11-15T11:15:00.000Z" };
    expect(buildTicketQueueNextMove(missed, NOW)).toMatchObject({
      key: "checkpoint_due",
      label: "Promise late",
      tone: "critical",
    });
    expect(buildTicketQueueNextMove(missed, NOW).detail).toContain("45m");
    expect(buildTicketPulse(missed, {
      notes: [{ visibility: "public", created_at: "2026-11-15T11:30:00.000Z" }],
    }, NOW).nextMove.title).toBe("Send the promised update");

    const healthySlaMissed = {
      ...missed,
      sla_due: "2026-11-15T16:00:00.000Z",
    };
    expect(buildTicketQueueNextMove(healthySlaMissed, NOW)).toMatchObject({ key: "checkpoint_due", label: "Promise late" });
    expect(buildTicketPulse(healthySlaMissed, {
      notes: [{ visibility: "public", created_at: "2026-11-15T11:30:00.000Z" }],
    }, NOW).nextMove.title).toBe("Send the promised update");
  });

  test("marks a near-target queue row and a stale row distinctly", () => {
    expect(buildTicketQueueNextMove(ticket({ sla_due: "2026-11-15T13:00:00.000Z", last_technician_reply_at: "2026-11-15T11:00:00.000Z", device_id: "device-1" }), NOW)).toMatchObject({ key: "protect", label: "Due soon" });
    expect(buildTicketQueueNextMove(ticket({ sla_due: "2026-11-15T20:00:00.000Z", last_technician_reply_at: "2026-11-15T06:00:00.000Z", last_activity_at: "2026-11-15T06:00:00.000Z", device_id: "device-1" }), NOW)).toMatchObject({ key: "catch_up", label: "Catch up" });
  });

  test("formats short, long and overdue durations", () => {
    expect(formatPulseDuration(0)).toBe("0m");
    expect(formatPulseDuration(90)).toBe("1h 30m");
    expect(formatPulseDuration(-1500)).toBe("1d 1h");
    expect(formatPulseDuration(null)).toBe("—");
  });
});
