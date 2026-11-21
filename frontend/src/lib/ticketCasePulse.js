const TERMINAL_STATUSES = new Set(["resolved", "closed", "cancelled", "completed"]);
const INCIDENT_TYPES = new Set(["incident", "problem"]);

function asDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function minutesBetween(later, earlier) {
  if (!later || !earlier) return null;
  return Math.round((later.getTime() - earlier.getTime()) / 60_000);
}

function isInternalNote(note) {
  if (!note) return false;
  if (note.is_internal === true) return true;
  return String(note.visibility || "").toLowerCase() === "internal";
}

function isFailedEmail(email) {
  const status = String(email?.delivery_status || email?.status || "").toLowerCase();
  return ["failed", "bounced", "error"].includes(status);
}

function latestDate(dates) {
  return dates
    .filter(Boolean)
    .reduce((latest, date) => (!latest || date > latest ? date : latest), null);
}

/**
 * The last piece of recorded work on the ticket. This is deliberately limited
 * to stored note/email/time/activity timestamps: the UI must not infer
 * customer silence from a field that simply was never recorded.
 */
function lastRecordedTouch(ticket, notes, emails, timeEntries) {
  const dates = [
    asDate(ticket.last_activity_at),
    asDate(ticket.updated_at),
    asDate(ticket.created_at),
    ...notes.map(note => asDate(note.created_at || note.updated_at)),
    ...emails.map(email => asDate(email.sent_at || email.created_at)),
    ...timeEntries.map(entry => asDate(entry.created_at || entry.updated_at)),
  ];
  return latestDate(dates);
}

export function formatPulseDuration(minutes) {
  if (minutes == null || !Number.isFinite(Number(minutes))) return "—";
  const total = Math.max(0, Math.round(Math.abs(Number(minutes))));
  if (total < 60) return `${total}m`;
  const hours = Math.floor(total / 60);
  const remainder = total % 60;
  if (hours < 24) return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const leftover = hours % 24;
  return leftover ? `${days}d ${leftover}h` : `${days}d`;
}

export function formatCheckpointTime(value) {
  const date = asDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function nextMoveFor({ ticket, terminal, remainingMinutes, customerUpdates, deviceCount, due, lastTechnicianReply, nextCheckpoint, checkpointMinutes }) {
  if (terminal) {
    return {
      tone: "complete",
      title: "Service record complete",
      detail: `The ticket is ${String(ticket.status || "").toLowerCase() === "closed" ? "closed" : "resolved"} and its conversation, effort and resolution evidence remain available.`,
      action: null,
      cta: null,
    };
  }
  if (!ticket.assigned_to && !ticket.assignee_id) {
    return {
      tone: "attention",
      title: "Give this request an owner",
      detail: "No accountable technician is recorded yet. Claim it before the next customer update.",
      action: "claim",
      cta: "Claim ticket",
    };
  }
  const recoveryAlreadySent = Boolean(lastTechnicianReply && due && lastTechnicianReply > due);
  if (remainingMinutes != null && remainingMinutes < 0 && !recoveryAlreadySent) {
    return {
      tone: "critical",
      title: "Recover the service promise",
      detail: `The SLA target passed ${formatPulseDuration(remainingMinutes)} ago. Send a recovery update before closing the record.`,
      action: "reply",
      cta: "Send recovery update",
    };
  }
  if (customerUpdates === 0) {
    return {
      tone: "attention",
      title: "Set the customer expectation",
      detail: "No customer-visible update is recorded yet. Acknowledge the request and state the next checkpoint.",
      action: "reply",
      cta: "Send first update",
    };
  }
  if (String(ticket.status || "").toLowerCase() === "on_hold") {
    return {
      tone: "attention",
      title: "Record the next checkpoint",
      detail: "Work is paused. Document the dependency or the date this ticket will move again.",
      action: "reply",
      cta: "Add checkpoint",
    };
  }
  if (deviceCount === 0 && INCIDENT_TYPES.has(String(ticket.ticket_type || "").toLowerCase())) {
    return {
      tone: "attention",
      title: "Attach the affected endpoint",
      detail: "No managed endpoint is linked, so device health and remote evidence cannot be attached to this incident.",
      action: "devices",
      cta: "Link endpoint",
    };
  }
  if (nextCheckpoint && checkpointMinutes != null && checkpointMinutes < 0) {
    return {
      tone: "critical",
      title: "Send the promised update",
      detail: `The promised update was due ${formatCheckpointTime(nextCheckpoint)} (${formatPulseDuration(checkpointMinutes)} ago). Publish an update and set a new checkpoint.`,
      action: "reply",
      cta: "Send promised update",
    };
  }
  if (remainingMinutes != null && remainingMinutes >= 0 && remainingMinutes <= 120) {
    return {
      tone: "attention",
      title: "Protect the remaining window",
      detail: `Only ${formatPulseDuration(remainingMinutes)} remain before the SLA target. Send a concise status update.`,
      action: "reply",
      cta: "Send status update",
    };
  }
  if (remainingMinutes != null && remainingMinutes < 0) {
    if (nextCheckpoint) {
      return {
        tone: checkpointMinutes != null && checkpointMinutes <= 120 ? "attention" : "healthy",
        title: "Next update promised",
        detail: `The client was promised the next update at ${formatCheckpointTime(nextCheckpoint)}${checkpointMinutes != null ? ` (in ${formatPulseDuration(checkpointMinutes)})` : ""}. Keep the checkpoint or send an update earlier.`,
        action: "reply",
        cta: "Add update",
      };
    }
    return {
      tone: "attention",
      title: "Set the next checkpoint",
      detail: "A recovery update is recorded, but the SLA target is still in the past. Agree the next checkpoint and close the loop.",
      action: "reply",
      cta: "Add checkpoint",
    };
  }
  return {
    tone: "healthy",
    title: "Keep the record moving",
    detail: "A customer update is recorded and the SLA window is intact. Capture the next concrete step.",
    action: "reply",
    cta: "Add update",
  };
}

/**
 * Build the service pulse from ticket facts that already exist in the API
 * response and the detail workspace. No score, sentiment or SLA value is
 * invented when the source field is absent.
 */
/**
 * The queue cannot see notes or emails, so it uses the same persisted SLA,
 * ownership, public-reply and device fields as the detail pulse without
 * pretending to know the full conversation. Labels are deliberately short
 * enough for one dense row.
 */
export function buildTicketQueueNextMove(ticket = {}, nowInput = new Date()) {
  const now = asDate(nowInput) || new Date();
  const status = String(ticket.status || "").toLowerCase();
  if (TERMINAL_STATUSES.has(status)) {
    return {
      key: "complete",
      label: "Complete",
      detail: status === "closed" ? "Closed with its resolution evidence retained." : "Resolved with its resolution evidence retained.",
      tone: "complete",
    };
  }

  const due = asDate(ticket.sla_due || ticket.sla_due_at);
  const remainingMinutes = due ? minutesBetween(due, now) : null;
  const lastTechnicianReply = asDate(ticket.last_technician_reply_at);
  const recoveryAlreadySent = Boolean(lastTechnicianReply && due && lastTechnicianReply > due);
  const nextCheckpoint = asDate(ticket.next_checkpoint_at);
  const checkpointMinutes = nextCheckpoint ? minutesBetween(nextCheckpoint, now) : null;
  const deviceCount = new Set(
    [...(ticket.device_ids || []), ticket.device_id]
      .filter(Boolean)
      .map(String),
  ).size;

  if (!ticket.assigned_to && !ticket.assignee_id) {
    return {
      key: "claim",
      label: "Claim",
      detail: "No accountable technician is recorded yet.",
      tone: "claim",
    };
  }
  if (remainingMinutes != null && remainingMinutes < 0 && !recoveryAlreadySent) {
    return {
      key: "recover",
      label: "Recovery",
      detail: `The SLA target passed ${formatPulseDuration(remainingMinutes)} ago.`,
      tone: "critical",
    };
  }
  if (!ticket.last_technician_reply_at) {
    return {
      key: "first_update",
      label: "First update",
      detail: "No technician update is recorded on this ticket yet.",
      tone: "attention",
    };
  }
  if (status === "on_hold") {
    return {
      key: "checkpoint",
      label: "Checkpoint",
      detail: "Work is paused; record the dependency or restart date.",
      tone: "attention",
    };
  }
  if (deviceCount === 0 && INCIDENT_TYPES.has(String(ticket.ticket_type || "").toLowerCase())) {
    return {
      key: "endpoint",
      label: "Link endpoint",
      detail: "This incident has no linked managed endpoint.",
      tone: "attention",
    };
  }
  if (nextCheckpoint && checkpointMinutes != null && checkpointMinutes < 0) {
    return {
      key: "checkpoint_due",
      label: "Promise late",
      detail: `The promised update was due ${formatCheckpointTime(nextCheckpoint)} (${formatPulseDuration(checkpointMinutes)} ago).`,
      tone: "critical",
    };
  }
  if (remainingMinutes != null && remainingMinutes >= 0 && remainingMinutes <= 120) {
    return {
      key: "protect",
      label: "Due soon",
      detail: `${formatPulseDuration(remainingMinutes)} remain before the SLA target.`,
      tone: "critical",
    };
  }
  if (remainingMinutes != null && remainingMinutes < 0) {
    if (nextCheckpoint) {
      return {
        key: "promised",
        label: checkpointMinutes != null && checkpointMinutes < 1 ? "Promise due" : `Promised ${formatPulseDuration(checkpointMinutes)}`,
        detail: `The client was promised the next update at ${formatCheckpointTime(nextCheckpoint)}.`,
        tone: checkpointMinutes != null && checkpointMinutes <= 120 ? "attention" : "healthy",
      };
    }
    return {
      key: "next_checkpoint",
      label: "Next checkpoint",
      detail: "A recovery update is recorded, but the SLA target is still in the past. Agree the next checkpoint and close the loop.",
      tone: "attention",
    };
  }
  const lastActivity = asDate(ticket.last_activity_at || ticket.last_technician_reply_at || ticket.updated_at || ticket.created_at);
  const staleMinutes = minutesBetween(now, lastActivity);
  if (staleMinutes != null && staleMinutes >= 240) {
    return {
      key: "catch_up",
      label: "Catch up",
      detail: `No activity has been recorded for ${formatPulseDuration(staleMinutes)}.`,
      tone: "attention",
    };
  }
  return {
    key: "add_update",
    label: "Add update",
    detail: "Capture the next concrete step on the record.",
    tone: "healthy",
  };
}

export function buildTicketPulse(ticket = {}, context = {}, nowInput = new Date()) {
  const now = asDate(nowInput) || new Date();
  const notes = Array.isArray(context.notes) ? context.notes : [];
  const emails = Array.isArray(context.emails) ? context.emails : [];
  const timeEntries = Array.isArray(context.timeEntries) ? context.timeEntries : [];
  const terminal = TERMINAL_STATUSES.has(String(ticket.status || "").toLowerCase());
  const created = asDate(ticket.created_at);
  const due = asDate(ticket.sla_due || ticket.sla_due_at);
  const completed = asDate(ticket.closed_at || ticket.resolved_at);
  const lastTechnicianReply = asDate(ticket.last_technician_reply_at);
  const nextCheckpoint = asDate(ticket.next_checkpoint_at);
  const checkpointMinutes = nextCheckpoint ? minutesBetween(nextCheckpoint, now) : null;
  const customerUpdates = notes.filter(note => !isInternalNote(note)).length + emails.filter(email => !isFailedEmail(email)).length;
  const timeMinutes = timeEntries.reduce((total, entry) => {
    const minutes = Number(entry.minutes ?? entry.duration_minutes ?? 0);
    return total + (Number.isFinite(minutes) && minutes > 0 ? minutes : 0);
  }, 0);
  const recordedMinutes = Math.max(Number(ticket.total_time_minutes) || 0, timeMinutes);
  const deviceIds = new Set(
    [...(ticket.device_ids || []), ticket.device_id]
      .filter(Boolean)
      .map(String),
  );
  const deviceCount = Number.isFinite(Number(context.deviceCount))
    ? Math.max(0, Number(context.deviceCount))
    : deviceIds.size;

  const totalMinutes = minutesBetween(due, created);
  const elapsedMinutes = minutesBetween(terminal ? (completed || now) : now, created);
  const remainingMinutes = terminal ? 0 : minutesBetween(due, now);
  const progressPct = totalMinutes && totalMinutes > 0 && elapsedMinutes != null
    ? Math.min(100, Math.max(0, Math.round((elapsedMinutes / totalMinutes) * 100)))
    : null;

  let state = "untracked";
  if (terminal) state = "complete";
  else if (remainingMinutes == null) state = "untracked";
  else if (remainingMinutes < 0) state = "overdue";
  else if (remainingMinutes <= 120) state = "critical";
  else if (remainingMinutes <= 480) state = "attention";
  else state = "healthy";

  const nextMove = nextMoveFor({
    ticket,
    terminal,
    remainingMinutes,
    customerUpdates,
    deviceCount,
    due,
    lastTechnicianReply,
    nextCheckpoint,
    checkpointMinutes,
  });

  return {
    terminal,
    state,
    created,
    due,
    completed,
    totalMinutes,
    elapsedMinutes,
    remainingMinutes,
    progressPct,
    nextCheckpoint,
    checkpointMinutes,
    lastTouch: lastRecordedTouch(ticket, notes, emails, timeEntries),
    metrics: {
      customerUpdates,
      recordedMinutes,
      deviceCount,
    },
    nextMove,
  };
}
