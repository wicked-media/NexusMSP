/**
 * Chat workspace: learned presentation helpers.
 *
 * Nexus chat records which sections, rails, tools and conversations a technician
 * actually opens, then ranks those surfaces with that evidence — the same
 * conservative contract every other workspace uses (`@/lib/workspaceLearning`):
 * nothing moves without real evidence, ties keep the declared order, and the
 * memory is presentation only. It cannot reveal a conversation, grant access or
 * promote an action the technician could not already run.
 *
 * Everything here is pure so the ranking, the recent list and the unread marker
 * can be verified without rendering the workspace.
 */
import { LEARNING_WORKSPACES, learningSlug, rankByUse } from "@/lib/workspaceLearning";

/**
 * The workspace slug chat remembers under, taken from the shared registry rather
 * than written out again: the server owns the authoritative list of slugs it will
 * accept (backend/app/routers/workspace_learning.py), so the name is the
 * contract, not a label, and it cannot drift from the list it is checked against.
 */
export const CHAT_WORKSPACE = LEARNING_WORKSPACES.CHAT;

/** Which surface a signal belongs to. Views are places, actions are commands. */
export const CHAT_VIEW = "view";
export const CHAT_ACTION = "action";

/** Local, device-only list of conversations this technician opened recently. */
export const CHAT_RECENT_KEY = "nexus_chat_recent";
export const CHAT_RECENT_MAX = 6;
export const CHAT_RECENT_VISIBLE = 3;

/**
 * A stable, slug-safe identifier for one conversation.
 *
 * Order of preference: an explicit slug, then the conversation's name (which
 * reads well in the learned-memory copy), then its stable Nexus ID. The ID form
 * is a last resort, not a fallback we avoid: it is deterministic and unique, and
 * the channel kind prefix keeps the target a legal slug even when an ID starts
 * with a digit. Nothing is recorded when no candidate produces a usable slug,
 * and an unrecorded conversation simply keeps its declared place.
 */
export function channelLearningTarget(channel) {
  if (!channel || typeof channel !== "object") return "";
  const kind = learningSlug(channel.kind) || "chat";
  const candidates = [
    channel.slug,
    channel.name && `${kind} ${channel.name}`,
    channel.other_user_name && `dm ${channel.other_user_name}`,
    channel.id && `${kind} ${channel.id}`,
  ];
  for (const candidate of candidates) {
    const slug = learningSlug(candidate);
    if (/^[a-z][a-z0-9_]{2,47}$/.test(slug)) return slug;
  }
  return "";
}

/**
 * The slug for a declared chat surface (a section, a rail tab, a tool).
 *
 * Declared surfaces are hand-written identifiers, so this is strict: a value
 * only qualifies when it is *already* a legal slug. Silently rewriting an odd
 * name would record evidence under a key nobody recognises, which is worse than
 * not learning from that surface at all.
 */
export function surfaceTarget(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw !== learningSlug(raw)) return "";
  return /^[a-z][a-z0-9_]{2,47}$/.test(raw) ? raw : "";
}

/**
 * Rank items by observed use, using the evidence partition for this workspace.
 * Kept as a thin named wrapper so a chat surface can never accidentally rank
 * with the wrong surface kind.
 */
export function rankChatSurfaces(items, { surface, learning, idOf }) {
  return rankByUse(items, {
    surface,
    personal: learning?.personal,
    team: learning?.team,
    idOf: idOf || ((item) => (typeof item === "string" ? item : item?.id)),
  });
}

/**
 * Record one conversation as recently opened.
 *
 * Pure and deduplicating: the same conversation moves to the front instead of
 * appearing twice, the list is capped, and entries without a usable id are
 * ignored. This is a device-local convenience list, not shared state.
 */
export function rememberRecentConversation(list, entry) {
  const id = entry?.id;
  if (!id) return Array.isArray(list) ? list.slice(0, CHAT_RECENT_MAX) : [];
  const rest = (Array.isArray(list) ? list : []).filter((item) => item?.id !== id);
  return [{ id, name: entry.name || "", kind: entry.kind || "team", at: entry.at || null }, ...rest].slice(0, CHAT_RECENT_MAX);
}

/** Read the device-local recent list, tolerating absent or damaged storage. */
export function readRecentConversations(storage) {
  try {
    const raw = storage?.getItem?.(CHAT_RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => item && item.id).slice(0, CHAT_RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/** Persist the device-local recent list. Storage restrictions are not an error. */
export function writeRecentConversations(storage, list) {
  try {
    storage?.setItem?.(CHAT_RECENT_KEY, JSON.stringify((Array.isArray(list) ? list : []).slice(0, CHAT_RECENT_MAX)));
  } catch {
    // A private-mode or quota-restricted browser must not break the workspace.
  }
}

/**
 * Index of the first message a technician has not read yet.
 *
 * Derived from the conversation's own unread count against the loaded page of
 * messages, because the API does not return per-message read state for every
 * participant. Returns -1 when there is nothing to mark, so the caller renders
 * no divider rather than guessing.
 */
export function unreadAnchorIndex(messages, unreadCount) {
  const list = Array.isArray(messages) ? messages : [];
  const count = Number(unreadCount);
  if (!list.length || !Number.isFinite(count) || count <= 0) return -1;
  const index = list.length - Math.min(count, list.length);
  return index > 0 ? index : -1;
}

/**
 * True when a keystroke belongs to a field the technician is typing into, so
 * single-key shortcuts never steal input.
 */
export function isTypingTarget(target) {
  if (!target || typeof target !== "object") return false;
  const tag = String(target.tagName || "").toLowerCase();
  if (["input", "textarea", "select"].includes(tag)) return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest?.("[contenteditable='true'],[role='textbox']"));
}

/** The keyboard contract the chat workspace honours, used by the cheat sheet. */
export const CHAT_SHORTCUTS = Object.freeze([
  {
    id: "search",
    label: "Search every conversation",
    keys: ["Ctrl", "K"],
    detail: "Opens message search without leaving the conversation you are in.",
  },
  {
    id: "composer",
    label: "Jump to the composer",
    keys: ["/"],
    detail: "Focuses the message box, then type. Works from anywhere in the workspace.",
  },
  {
    id: "next-conversation",
    label: "Next conversation",
    keys: ["Alt", "↓"],
    detail: "Moves down the visible list and opens its most recent message.",
  },
  {
    id: "previous-conversation",
    label: "Previous conversation",
    keys: ["Alt", "↑"],
    detail: "Moves up the visible list.",
  },
  {
    id: "unread",
    label: "Next unread conversation",
    keys: ["Alt", "U"],
    detail: "Jumps to the next conversation with unread messages.",
  },
  {
    id: "shortcuts",
    label: "This shortcut sheet",
    keys: ["?"],
    detail: "Opens the keyboard reference, including what Nexus has learned here.",
  },
  {
    id: "escape",
    label: "Close the open panel",
    keys: ["Esc"],
    detail: "Closes the thread, context rail or a dialog, in that order.",
  },
  {
    id: "send",
    label: "Send the message",
    keys: ["Enter"],
    detail: "Shift + Enter starts a new line. Change this in chat settings.",
  },
  {
    id: "edit-last",
    label: "Edit your last message",
    keys: ["↑"],
    detail: "Only when the composer is empty, so it never fights your typing.",
  },
]);

/** Dense key list for the composer footer, hidden from assistive technology. */
export function shortcutHint() {
  return "⌘K search · / compose · ? shortcuts";
}
