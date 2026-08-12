/**
 * Browser extensions and embedded browser tooling can emit partial keyboard
 * events. Keep global shortcuts defensive so a non-user event cannot break a
 * workspace that happens to be open at the time.
 */
export function keyboardKey(event) {
  return String(event?.key || "");
}

export function keyboardKeyLower(event) {
  return keyboardKey(event).toLowerCase();
}
