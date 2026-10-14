const WEATHER_MOTION_KIND = {
  clear: "clear",
  "partly-cloudy": "cloud",
  cloudy: "cloud",
  fog: "fog",
  drizzle: "precipitation",
  rain: "precipitation",
  sleet: "precipitation",
  snow: "snow",
  storm: "storm",
};

export function getWeatherMotionKind(kind) {
  return WEATHER_MOTION_KIND[kind] || "cloud";
}

export function formatWeatherFreshness(value, now = new Date()) {
  if (!value) return "Live conditions";
  const refreshedAt = new Date(value);
  const currentTime = new Date(now);
  const elapsedMs = currentTime.getTime() - refreshedAt.getTime();

  if (!Number.isFinite(elapsedMs) || elapsedMs < -60_000) return "Live conditions";

  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  if (elapsedMinutes < 1) return "Updated just now";
  if (elapsedMinutes < 60) return `Updated ${elapsedMinutes}m ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  return `Updated ${elapsedHours}h ago`;
}

export function displayTemperature(value) {
  const normalised = typeof value === "string" ? value.trim() : value;
  if (normalised === null || normalised === undefined || normalised === "" || typeof normalised === "boolean") return "--";
  return Number.isFinite(Number(normalised)) ? Math.round(Number(normalised)) : "--";
}
