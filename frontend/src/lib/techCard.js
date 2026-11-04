// Shareable technician trading card, built as a pure SVG string so it can be
// tested without a DOM and downloaded without a canvas dependency.

const RARITY_FILLS = {
  common: "#94a3b8",
  rare: "#60a5fa",
  epic: "#c084fc",
  legendary: "#fbbf24",
};

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildTechCardSvg(profile = {}) {
  const name = esc(profile.name || "Unknown Tech");
  const title = esc(profile.equipped_title ? `${profile.equipped_title.emoji || ""} ${profile.equipped_title.name || ""}`.trim() : "Rookie Technician");
  const pet = esc(profile.equipped_pet ? `${profile.equipped_pet.emoji || "🐾"} ${profile.equipped_pet.name || ""}`.trim() : "No companion");
  const points = Number(profile.points?.balance ?? profile.points?.lifetime_earned ?? 0).toLocaleString();
  const closed = Number(profile.closed_tickets ?? 0);
  const level = Number(profile.level ?? 1);
  const badges = Number(profile.badges_earned ?? profile.total_unlocked ?? 0);
  const rarity = profile.rarity || "rare";
  const accent = RARITY_FILLS[rarity] || RARITY_FILLS.rare;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="600" viewBox="0 0 420 600">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a"/><stop offset="100%" stop-color="#1e1b4b"/>
    </linearGradient>
  </defs>
  <rect width="420" height="600" rx="24" fill="url(#bg)" stroke="${accent}" stroke-width="3"/>
  <rect x="18" y="18" width="384" height="564" rx="16" fill="none" stroke="${accent}" stroke-opacity="0.35"/>
  <circle cx="210" cy="150" r="64" fill="${accent}" fill-opacity="0.18" stroke="${accent}" stroke-width="2"/>
  <text x="210" y="170" font-family="system-ui, sans-serif" font-size="52" text-anchor="middle" fill="#e2e8f0">${esc((profile.name || "?").charAt(0).toUpperCase())}</text>
  <text x="210" y="256" font-family="system-ui, sans-serif" font-size="28" font-weight="700" text-anchor="middle" fill="#f8fafc">${name}</text>
  <text x="210" y="286" font-family="system-ui, sans-serif" font-size="15" text-anchor="middle" fill="${accent}">${title}</text>
  <g font-family="system-ui, sans-serif" font-size="14" fill="#cbd5e1">
    <text x="60" y="350">Level</text><text x="360" y="350" text-anchor="end" fill="#f8fafc">${level}</text>
    <text x="60" y="386">Tickets closed</text><text x="360" y="386" text-anchor="end" fill="#f8fafc">${closed}</text>
    <text x="60" y="422">Points</text><text x="360" y="422" text-anchor="end" fill="#f8fafc">${points}</text>
    <text x="60" y="458">Badges</text><text x="360" y="458" text-anchor="end" fill="#f8fafc">${badges}</text>
    <text x="60" y="494">Companion</text><text x="360" y="494" text-anchor="end" fill="#f8fafc">${pet}</text>
  </g>
  <rect x="60" y="522" width="300" height="34" rx="17" fill="${accent}" fill-opacity="0.16" stroke="${accent}" stroke-opacity="0.6"/>
  <text x="210" y="544" font-family="system-ui, sans-serif" font-size="13" letter-spacing="2" text-anchor="middle" fill="${accent}">NEXUSMSP · TECH TRADING CARD</text>
</svg>`;
}

export function techCardFilename(profile = {}) {
  const slug = String(profile.name || "tech").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `nexus-tech-card-${slug || "tech"}.svg`;
}
