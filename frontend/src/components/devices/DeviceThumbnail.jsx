/* DeviceThumbnail.jsx — OS-aware mini icon with type accent. */
import { Server, Monitor, Laptop, Wifi, Smartphone, HardDrive } from "lucide-react";

const TYPE_MAP = {
  server: { Icon: Server, ring: "ring-violet-500/40", bg: "bg-violet-500/10", color: "text-violet-300" },
  workstation: { Icon: Monitor, ring: "ring-sky-500/40", bg: "bg-sky-500/10", color: "text-sky-300" },
  laptop: { Icon: Laptop, ring: "ring-emerald-500/40", bg: "bg-emerald-500/10", color: "text-emerald-300" },
  network: { Icon: Wifi, ring: "ring-amber-500/40", bg: "bg-amber-500/10", color: "text-amber-300" },
  mobile: { Icon: Smartphone, ring: "ring-pink-500/40", bg: "bg-pink-500/10", color: "text-pink-300" },
  nas: { Icon: HardDrive, ring: "ring-cyan-500/40", bg: "bg-cyan-500/10", color: "text-cyan-300" },
};

function osBadge(os = "") {
  const s = (os || "").toLowerCase();
  if (s.includes("win")) return "W";
  if (s.includes("mac") || s.includes("osx") || s.includes("darwin")) return "";
  if (s.includes("ubuntu") || s.includes("debian") || s.includes("centos") || s.includes("rhel") || s.includes("linux")) return "L";
  if (s.includes("ios") || s.includes("android")) return "M";
  return "?";
}

export default function DeviceThumbnail({ type = "workstation", os = "", size = 28 }) {
  const t = TYPE_MAP[type] || TYPE_MAP.workstation;
  const Icon = t.Icon;
  return (
    <span
      className={`relative inline-flex items-center justify-center rounded-md ring-1 ${t.ring} ${t.bg}`}
      style={{ width: size, height: size }}
    >
      <Icon className={`w-3.5 h-3.5 ${t.color}`} />
      <span
        className="absolute -bottom-1 -right-1 text-[8px] font-mono px-1 leading-none py-[1px] bg-zinc-900 text-zinc-300 rounded-sm border border-zinc-700"
        style={{ minWidth: 11, height: 11, lineHeight: "9px" }}
      >
        {osBadge(os)}
      </span>
    </span>
  );
}
