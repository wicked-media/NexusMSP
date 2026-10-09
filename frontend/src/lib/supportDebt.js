// Pure presentation helpers for Nexus Support Debt.
//
// The backend derives every figure and discloses its basis; these helpers only
// decide how to label it. A figure Nexus could not derive is never rendered as a
// zero, because "$0 of avoidable labour" and "no rate was recorded" are very
// different statements to a manager.

export const SUPPORT_DEBT_WINDOWS = [60, 90, 180, 365];

const BASIS_PRESENTATION = {
  complete: { tone: "emerald", label: "Value recorded for all work" },
  partial: { tone: "amber", label: "Value recorded for some work" },
  none: { tone: "zinc", label: "Hours only — no rate recorded" },
};

/** How complete the recorded-value basis is. An unknown basis claims nothing. */
export function costBasis(basis) {
  const key = String(basis || "").trim().toLowerCase();
  const found = BASIS_PRESENTATION[key];
  if (found) return { key, ...found };
  return { key: key || "unknown", tone: "zinc", label: "Value basis not stated" };
}

/** Money is either recorded or explicitly not recorded — never a substituted zero. */
export function formatMoney(value) {
  if (value === null || value === undefined) return "Not recorded";
  const number = Number(value);
  if (!Number.isFinite(number)) return "Not recorded";
  return `$${number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatHours(value) {
  if (value === null || value === undefined) return "Not recorded";
  const number = Number(value);
  if (!Number.isFinite(number)) return "Not recorded";
  return `${number.toLocaleString(undefined, { maximumFractionDigits: 1 })}h`;
}

export function formatWindow(days) {
  const value = Number(days);
  if (!Number.isFinite(value) || value <= 0) return "Unknown window";
  return value === 365 ? "a year" : `${value} days`;
}

/** The one-line management statement, with the basis caveat attached. */
export function supportDebtHeadline(totals) {
  if (!totals || !totals.signatures) {
    return "No recurring work pattern has repeated often enough to be called support debt yet.";
  }
  const patterns = `${totals.signatures} recurring pattern${totals.signatures === 1 ? "" : "s"}`;
  const hours = formatHours(totals.annual_hours);
  if (totals.annual_cost === null || totals.annual_cost === undefined) {
    return `${patterns}, about ${hours} of labour a year. No labour rate was recorded, so no dollar figure is claimed.`;
  }
  const caveat = totals.uncosted_signatures
    ? ` ${totals.uncosted_signatures} pattern(s) carry no recorded value and are counted in hours only.`
    : "";
  return `${patterns}, about ${hours} a year, of which ${formatMoney(totals.annual_cost)} carries recorded value.${caveat}`;
}

/** Which rows deserve attention first, by the figure that is actually available. */
export function signaturePressure(signature) {
  if (!signature) return "zinc";
  if (signature.annual_cost === null || signature.annual_cost === undefined) {
    return Number(signature.annual_hours || 0) >= 8 ? "amber" : "zinc";
  }
  const cost = Number(signature.annual_cost);
  if (cost >= 2000) return "rose";
  if (cost >= 500) return "amber";
  return "emerald";
}

/** When the pattern was last seen, from the evidence rather than a guess. */
export function lastSeenLabel(signature) {
  if (!signature?.last_seen) return "No dated occurrence";
  return `Last seen ${String(signature.last_seen).slice(0, 10)}`;
}
