export const PRESENCE_META = {
  active: { label: "Available", dot: "bg-emerald-500", text: "text-emerald-400" },
  busy: { label: "Busy", dot: "bg-rose-500", text: "text-rose-400" },
  dnd: { label: "Do not disturb", dot: "bg-rose-500", text: "text-rose-400" },
  break: { label: "On a break", dot: "bg-amber-500", text: "text-amber-400" },
  away: { label: "Away", dot: "bg-amber-500", text: "text-amber-400" },
  offline: { label: "Offline", dot: "bg-zinc-500", text: "text-zinc-500" },
};

const LIVE_PRESENCE_STATES = new Set(["active", "busy", "dnd"]);
const OPERATIONAL_REFERENCE_PATTERNS = {
  tickets: /\b(?:TKT(?:-CHAT)?|INC|CHG|REQ|PRB|SR)-[A-Z0-9-]+\b/gi,
  invoices: /\bINV-[A-Z0-9-]+\b/gi,
  purchaseOrders: /\bPO-[A-Z0-9-]+\b/gi,
};

// Some early chat system records were written through a non-UTF-8 pipeline.
// Keep the original audit record untouched, but make historic notices readable
// anywhere they are presented in Nexus Chat.
const WINDOWS_1252_BYTES = {
  "\u20ac": 0x80, "\u201a": 0x82, "\u0192": 0x83, "\u201e": 0x84,
  "\u2026": 0x85, "\u2020": 0x86, "\u2021": 0x87, "\u02c6": 0x88,
  "\u2030": 0x89, "\u0160": 0x8a, "\u2039": 0x8b, "\u0152": 0x8c,
  "\u017d": 0x8e, "\u2018": 0x91, "\u2019": 0x92, "\u201c": 0x93,
  "\u201d": 0x94, "\u2022": 0x95, "\u2013": 0x96, "\u2014": 0x97,
  "\u02dc": 0x98, "\u2122": 0x99, "\u0161": 0x9a, "\u203a": 0x9b,
  "\u0153": 0x9c, "\u017e": 0x9e, "\u0178": 0x9f,
};

export function repairDisplayText(value) {
  const text = String(value ?? "");
  if (!/[\u00e2\u00c3\u00c2\u00f0]/.test(text)) return text;

  const bytes = [];
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code <= 0x7f || (code >= 0x80 && code <= 0x9f) || (code >= 0xa0 && code <= 0xff)) {
      bytes.push(code);
    } else if (Object.prototype.hasOwnProperty.call(WINDOWS_1252_BYTES, char)) {
      bytes.push(WINDOWS_1252_BYTES[char]);
    } else {
      return text;
    }
  }

  try {
    return decodeURIComponent(bytes.map(byte => `%${byte.toString(16).padStart(2, "0")}`).join(""));
  } catch {
    return text;
  }
}

export function isLivePresence(value) {
  return LIVE_PRESENCE_STATES.has(String(value || "").toLowerCase());
}

export function chatAuthorName(value, isSystem = false) {
  const name = String(value || "").trim();
  if (isSystem || name.toLowerCase() === "nexusops") return "Nexus Automation";
  return name || "Technician";
}

export function extractOperationalContext(messages = []) {
  const references = {
    tickets: new Set(),
    invoices: new Set(),
    purchaseOrders: new Set(),
  };

  messages.forEach(message => {
    const body = repairDisplayText(message?.body || "");
    Object.entries(OPERATIONAL_REFERENCE_PATTERNS).forEach(([kind, pattern]) => {
      for (const match of body.matchAll(pattern)) references[kind].add(match[0].toUpperCase());
    });
  });

  return Object.fromEntries(
    Object.entries(references).map(([kind, values]) => [kind, values.size]),
  );
}

export function channelDisplayName(channel) {
  if (!channel) return "Conversation";
  if (channel.display_name) return channel.display_name;
  if (channel.kind === "dm" && String(channel.name || "").startsWith("dm:")) return "Direct message";
  return String(channel.name || "Conversation").replace(/-/g, " ").replace(/\b\w/g, char => char.toUpperCase());
}

export function filterChatChannels(channels, mode, query = "") {
  const term = query.trim().toLowerCase();
  return channels.filter(channel => {
    if (mode === "activity" && !(channel.unread_count > 0)) return false;
    if (mode === "chat" && !["dm", "group_dm"].includes(channel.kind)) return false;
    if (mode === "teams" && channel.kind !== "team") return false;
    if (mode === "work" && channel.kind !== "object") return false;
    if (!term) return true;
    const haystack = `${channelDisplayName(channel)} ${channel.last_message?.body || ""}`.toLowerCase();
    return haystack.includes(term);
  });
}

export function groupChatMessages(messages) {
  const groups = [];
  let day = null;
  let previousUser = null;
  let previousTimestamp = 0;

  messages.filter(message => !message.thread_id).forEach(message => {
    const currentDay = String(message.ts || "").slice(0, 10) || "unknown";
    if (currentDay !== day) {
      groups.push({ type: "day", day: currentDay, key: `day-${currentDay}` });
      day = currentDay;
      previousUser = null;
      previousTimestamp = 0;
    }
    const timestamp = Date.parse(message.ts || "") || 0;
    const compact = previousUser === message.user_id && timestamp - previousTimestamp < 5 * 60 * 1000;
    groups.push({ type: "message", message, compact, key: message.id });
    previousUser = message.user_id;
    previousTimestamp = timestamp;
  });

  return groups;
}

export function totalUnread(channels) {
  return channels.reduce((total, channel) => total + Number(channel.unread_count || 0), 0);
}
