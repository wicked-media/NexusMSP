/* ClientTierBadge.jsx — visible everywhere a client appears */
import { tierMeta } from "./clientStudioHelpers";
import { Crown } from "lucide-react";

export default function ClientTierBadge({ tier, vip = false, size = "sm" }) {
  const m = tierMeta(tier);
  const sizing = size === "xs"
    ? "text-[9px] px-1 py-0.5"
    : "text-[10px] px-1.5 py-0.5";
  return (
    <span className={`inline-flex items-center gap-1 rounded border ${m.chip} ${sizing}`} data-testid={`client-tier-${tier || "bronze"}`}>
      <span>{m.icon}</span>
      <span className="uppercase tracking-wider font-semibold">{m.label}</span>
      {vip && <Crown className="w-2.5 h-2.5 text-yellow-300 ml-0.5" />}
    </span>
  );
}
