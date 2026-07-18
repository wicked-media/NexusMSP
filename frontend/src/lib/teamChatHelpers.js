export const PRESENCE_META = {
  active: { label: "Available", dot: "bg-emerald-500", text: "text-emerald-400" },
  busy: { label: "Busy", dot: "bg-rose-500", text: "text-rose-400" },
  dnd: { label: "Do not disturb", dot: "bg-rose-500", text: "text-rose-400" },
  break: { label: "On a break", dot: "bg-amber-500", text: "text-amber-400" },
  away: { label: "Away", dot: "bg-amber-500", text: "text-amber-400" },
  offline: { label: "Offline", dot: "bg-zinc-500", text: "text-zinc-500" },
};

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
    if (mode === "chat" && channel.kind === "team") return false;
    if (mode === "teams" && channel.kind !== "team") return false;
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
