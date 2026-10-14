const compact = (value) => String(value ?? "").trim();

/**
 * The customer-facing Connections API evolves independently from the core
 * collaboration workspace. Keep that payload boundary small and explicit so
 * the Team Chat UI never has to guess from presentation labels.
 */
export function normaliseDirectChatRequest(value) {
  const request = value || {};
  const context = request.context || {};

  return {
    ...request,
    id: compact(request.id || request.request_id),
    status: compact(request.status || "pending").toLowerCase(),
    customerName: compact(
      request.customer_name
      || request.requester_name
      || request.contact_name
      || request.user_name
      || request.requester?.name,
    ) || "Customer",
    customerEmail: compact(request.customer_email || request.requester_email || request.contact_email || request.requester?.email),
    clientName: compact(request.client_name || request.client?.name || context.client_name),
    subject: compact(request.subject || request.title || "Direct chat request"),
    message: compact(request.message || request.reason || request.body),
    ticketReference: compact(request.ticket_reference || request.ticket_number || context.ticket_reference || context.ticket_id || request.ticket_id),
    ticketId: compact(request.ticket_id || context.ticket_id),
    deviceName: compact(request.device_name || request.device?.name || context.device_name || context.device_id || request.device_id),
    deviceId: compact(request.device_id || context.device_id),
    createdAt: request.created_at || request.requested_at || request.ts || null,
  };
}

export function isPendingDirectChatRequest(request) {
  return normaliseDirectChatRequest(request).status === "pending";
}

export function directChatRequestContext(request) {
  const item = normaliseDirectChatRequest(request);
  return [
    item.clientName && { label: "Client", value: item.clientName, tone: "cyan" },
    item.ticketReference && { label: "Ticket", value: item.ticketReference, tone: "violet" },
    item.deviceName && { label: "Device", value: item.deviceName, tone: "emerald" },
  ].filter(Boolean);
}
