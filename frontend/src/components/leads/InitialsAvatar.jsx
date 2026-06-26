/* InitialsAvatar.jsx — deterministic-color initials circle. */
import { avatarColor, initialsOf } from "./leadHelpers";

export default function InitialsAvatar({ name = "", size = 32, className = "" }) {
  const color = avatarColor(name);
  const fontSize = Math.max(10, Math.round(size * 0.4));
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full text-white font-semibold flex-shrink-0 ${color} ${className}`}
      style={{ width: size, height: size, fontSize }}
      title={name}
    >
      {initialsOf(name) || "?"}
    </span>
  );
}
