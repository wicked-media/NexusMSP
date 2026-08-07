// Canonical presentation for the standard Nexus service tiers. These colours
// are intentionally held in the UI layer so existing customer agreements keep
// their stored data while every Nexus surface communicates the same service
// level at a glance. Custom tiers continue to use their configured colour.
const STANDARD_TIER_VISUALS = {
  bronze: { color: "#c58b5a", label: "Bronze", level: "Service level 1" },
  silver: { color: "#c7ccd5", label: "Silver", level: "Service level 2" },
  gold: { color: "#f4cf57", label: "Gold", level: "Service level 3" },
  platinum: { color: "#e0e5ec", label: "Platinum", level: "Service level 4" },
  diamond: { color: "#c4b5fd", label: "Diamond", level: "Service level 5" },
};

export function getServiceTierVisual(tier = {}) {
  const standard = STANDARD_TIER_VISUALS[String(tier.slug || "").toLowerCase()];
  return {
    color: standard?.color || tier.color || "#a78bfa",
    label: standard?.label || tier.name || "Service",
    level: standard?.level || "Managed service",
    isStandard: Boolean(standard),
  };
}
