const HEALTH_LABELS = {
  healthy: "Healthy",
  stable: "Stable",
  warning: "At risk",
  critical: "Critical",
};

const normaliseScore = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const score = Number(value);
  if (!Number.isFinite(score)) return null;
  return Math.min(100, Math.max(0, Math.round(score)));
};

export function buildEstateStatus(summary, phase = "ready") {
  if (phase === "loading") {
    return { label: "Checking", score: null, tone: "neutral", detail: "Checking" };
  }

  const score = normaliseScore(summary?.health_score);
  if (phase === "unavailable" || score === null) {
    return { label: "Unavailable", score: null, tone: "neutral", detail: "Unavailable" };
  }

  const tone = score < 50 ? "critical" : score < 75 ? "warning" : score < 90 ? "stable" : "healthy";
  const fallbackLabel = HEALTH_LABELS[tone];
  const label = typeof summary?.health_label === "string" && summary.health_label.trim()
    ? summary.health_label.trim()
    : fallbackLabel;

  return { label, score, tone, detail: `${label} · ${score}` };
}
