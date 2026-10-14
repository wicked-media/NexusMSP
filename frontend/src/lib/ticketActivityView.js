export function isInternalTicketNote(item) {
  return item._type === "note" && (item.is_internal === true || item.visibility === "internal");
}
export function filterTicketActivity(items, filter) {
  if (filter === "internal") return items.filter(isInternalTicketNote);
  if (filter === "client") return items.filter(item => !isInternalTicketNote(item));
  return items;
}
