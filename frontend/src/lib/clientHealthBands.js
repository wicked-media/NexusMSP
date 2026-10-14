/**
 * Client health bands — one definition for every Clients workspace surface.
 *
 * The authoritative health engine is `_calc_health` in
 * `backend/app/routers/clients.py`. It stores a 0-100 `health_score` and serves
 * the `risk_level` derived from these exact floors:
 *
 *   healthy    score >= 75
 *   attention  score >= 50
 *   at_risk    score >= 25
 *   critical   score <  25
 *
 * Before this module the directory filter said "Healthy 85+", the health dial
 * used 85/70/50, the account banner used 85/60 and the portfolio attention
 * queue used 70/60. One account could therefore read "healthy" in the engine
 * and "needs attention" on screen, and a score of 80 was excluded from every
 * filter labelled healthy. The floors below are asserted against the engine in
 * `clientHealthBands.test.js`; change the engine and this module together
 * rather than adding a fifth set of numbers to a page.
 */
const BAND_DEFINITIONS = [
  {
    key: "healthy",
    floor: 75,
    label: "Healthy",
    description: "Recorded service, coverage and commercial evidence are all in range.",
    // Ambient surface hue. `at_risk` shares the critical hue on purpose: the
    // engine only rates an account at_risk when scored commitments are failing.
    signal: "healthy",
    // Ring colour for the health dial. Kept in one place so the dial agrees
    // with the band the engine assigned.
    dial: "#34d399",
    tone: "text-emerald-300",
    badge: "border-emerald-400/30 bg-emerald-500/[0.10] text-emerald-100",
  },
  {
    key: "attention",
    floor: 50,
    label: "Needs attention",
    description: "One or more scored dimensions have slipped and should be reviewed.",
    signal: "attention",
    dial: "#fbbf24",
    tone: "text-amber-300",
    badge: "border-amber-400/30 bg-amber-500/[0.10] text-amber-100",
  },
  {
    key: "at_risk",
    floor: 25,
    label: "At risk",
    description: "Scored evidence shows a service or commercial commitment failing.",
    signal: "critical",
    dial: "#fb923c",
    tone: "text-orange-300",
    badge: "border-orange-400/30 bg-orange-500/[0.10] text-orange-100",
  },
  {
    key: "critical",
    floor: 0,
    label: "Critical",
    description: "The account needs an owner now; multiple dimensions are failing.",
    signal: "critical",
    dial: "#fb7185",
    tone: "text-rose-300",
    badge: "border-rose-400/30 bg-rose-500/[0.10] text-rose-100",
  },
];

/** Bands ordered from best to worst, which is also the lookup order. */
export const CLIENT_HEALTH_BANDS = Object.freeze(
  BAND_DEFINITIONS.map((band) => Object.freeze({
    ...band,
    // Generated from the floor so a label can never quote a threshold the
    // engine does not use.
    filterLabel: band.floor > 0 ? `${band.label} ${band.floor}+` : band.label,
  })),
);

/** `{ healthy: 75, attention: 50, at_risk: 25, critical: 0 }` */
export const CLIENT_HEALTH_BAND_FLOORS = Object.freeze(
  Object.fromEntries(CLIENT_HEALTH_BANDS.map((band) => [band.key, band.floor])),
);

/** Directory filter options derived from the bands, so labels cannot drift. */
export const CLIENT_HEALTH_FILTER_OPTIONS = Object.freeze([
  Object.freeze({ value: "all", label: "All health" }),
  ...CLIENT_HEALTH_BANDS.map((band) => Object.freeze({ value: band.key, label: band.filterLabel })),
]);

/** Accepts `at_risk`, `at-risk`, `AT RISK` and similar stored spellings. */
export function normaliseRiskLevel(value) {
  const raw = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return raw || null;
}

export function healthBandByKey(key) {
  const normalised = normaliseRiskLevel(key);
  if (!normalised) return null;
  return CLIENT_HEALTH_BANDS.find((band) => band.key === normalised) || null;
}

/**
 * The band a score falls in, or null when the score is missing or unusable.
 * A score of 0 is a real critical score and is never treated as absent.
 */
export function healthBand(score) {
  if (score === null || score === undefined || score === "" || typeof score === "boolean") return null;
  const numeric = Number(score);
  if (!Number.isFinite(numeric)) return null;
  return CLIENT_HEALTH_BANDS.find((band) => numeric >= band.floor) || CLIENT_HEALTH_BANDS[CLIENT_HEALTH_BANDS.length - 1];
}

/**
 * The band Nexus serves for a client: the engine's own `risk_level` wins when
 * present, otherwise the score is banded locally. Returns null when neither is
 * recorded, so callers can say "not scored" instead of guessing.
 */
export function resolveClientHealthBand(client) {
  if (!client || typeof client !== "object") return null;
  const declared = healthBandByKey(client.risk_level ?? client.riskLevel);
  if (declared) return declared;
  return healthBand(client.health_score ?? client.healthScore);
}
