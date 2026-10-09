function firstText(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() || null;
}

export function formatTicketRequestSource(source) {
  if (typeof source !== "string" || !source.trim()) return null;

  return source
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

/**
 * Keeps the original request separate from technician interpretation. Every
 * field returned here comes from an existing ticket/device record; missing
 * metadata remains explicitly unknown rather than being guessed.
 */
export function buildTicketRequestRecord(ticket = {}, deviceStatus = null) {
  const source = formatTicketRequestSource(firstText(
    ticket.source,
    ticket.ticket_source,
    ticket.created_via,
    ticket.origin,
    ticket.ingestion_source,
  ));
  const requesterName = firstText(ticket.contact_name, ticket.requester_name, ticket.requester);
  const requesterEmail = firstText(ticket.contact_email, ticket.requester_email, ticket.email);
  const requester = requesterName || requesterEmail
    ? { name: requesterName, email: requesterEmail }
    : null;
  const deviceName = firstText(
    deviceStatus?.name,
    deviceStatus?.hostname,
    ticket.device_name,
    ticket.device_hostname,
  );
  const rawCreatedAt = firstText(ticket.created_at, ticket.received_at, ticket.submitted_at);
  const parsedCreatedAt = rawCreatedAt ? new Date(rawCreatedAt) : null;
  const capturedAt = parsedCreatedAt && Number.isFinite(parsedCreatedAt.getTime()) ? parsedCreatedAt : null;

  return {
    description: firstText(ticket.description),
    source,
    requester,
    deviceName,
    capturedAt,
  };
}
