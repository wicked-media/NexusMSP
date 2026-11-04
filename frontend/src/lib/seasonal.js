// Seasonal moments are intentionally restrained. Nexus is an operational
// environment, so whimsical full-screen overlays are not allowed to compete
// with alerts, evidence or technician actions.

export function seasonalMode(date = new Date()) {
  const month = date.getMonth() + 1; // 1-12
  if (month === 12) return "snow";
  if (month === 4 && date.getDate() === 1) return "april";
  return null;
}

export const SEASONAL_COPY = {
  snow: { title: "Season's uptime", message: "Snow is falling. So are the alerts — mostly to zero." },
  april: { title: "AI has resolved all tickets 🎉", message: "…April Fools. They're all still here. Happy hunting!" },
};
