/* Shared formatting helpers and display constants for the team chat workspace. */

export const OWN_BUBBLE_ACCENT = {
  emerald: "border-emerald-500/10 bg-emerald-500/[0.035]",
  cyan: "border-cyan-500/10 bg-cyan-500/[0.035]",
  violet: "border-violet-500/10 bg-violet-500/[0.035]",
  amber: "border-amber-500/10 bg-amber-500/[0.035]",
};

export const COMMON_EMOJIS = ["👍", "❤️", "😂", "🎉", "🔥", "🚀", "✅", "💯", "👏", "👀"];

export const TICKET_REGEX = /\/ticket\s+([\w-]+)/gi;
export const INVOICE_REGEX = /\/invoice\s+([\w-]+)/gi;
export const PO_REGEX = /\/po\s+([\w-]+)/gi;

export const initials = name => String(name || "?").split(/\s+/).filter(Boolean).map(part => part[0]).join("").slice(0, 2).toUpperCase();

export const avatarHue = value => {
  let hash = 0;
  for (const char of String(value || "")) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
};

export function avatarStyle(value) {
  return { backgroundColor: `hsl(${avatarHue(value)}, 48%, 38%)`, color: "white", fontSize: 11 };
}

export const formatTime = value => value ? new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";

export const formatRelative = value => {
  if (!value) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
};

export function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const notificationSummary = channel => {
  if (channel?.mute_until && new Date(channel.mute_until).getTime() > Date.now()) return `Muted until ${new Date(channel.mute_until).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  if (channel?.notify_level === "all") return "Every message";
  if (channel?.notify_level === "none" || channel?.is_muted) return "Notifications off";
  return "Mentions only";
};

export function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
