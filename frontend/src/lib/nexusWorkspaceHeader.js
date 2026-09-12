export function normaliseWorkspaceSignal(signal) {
  const value = String(signal || "").toLowerCase();
  if (!value) return "neutral";
  if (["critical", "error", "failed", "offline"].some(token => value.includes(token))) return "critical";
  if (["attention", "warning", "risk", "stale", "degraded"].some(token => value.includes(token))) return "attention";
  if (["working", "progress", "pending", "active"].some(token => value.includes(token))) return "working";
  if (["healthy", "steady", "ready", "connected", "verified", "live", "online"].some(token => value.includes(token))) return "healthy";
  return "neutral";
}
