const asPercent = value => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric) : null;
};

export const buildRemoteTelemetrySnapshot = ({ performance = [], device = {}, now = Date.now() } = {}) => {
  const latest = performance[0] || device || {};
  const observedAt = latest.timestamp || latest.observed_at || device?.last_heartbeat || device?.last_seen;
  const observedAtMs = Date.parse(observedAt || "");

  return {
    cpu: asPercent(latest.cpu ?? latest.cpu_usage ?? latest.cpu_percent ?? device?.cpu_usage),
    memory: asPercent(latest.memory ?? latest.memory_usage ?? latest.memory_percent ?? device?.memory_usage),
    disk: asPercent(latest.disk ?? latest.disk_usage ?? latest.disk_percent ?? device?.disk_usage),
    ageMinutes: Number.isFinite(observedAtMs) ? Math.max(0, Math.round((now - observedAtMs) / 60000)) : null,
    observedAt,
  };
};

export const telemetryTone = (metric, value) => {
  if (value === null) return "muted";
  const critical = metric === "disk" ? 95 : 90;
  const warning = metric === "disk" ? 85 : 75;
  if (value >= critical) return "rose";
  if (value >= warning) return "amber";
  return "emerald";
};
