// Seasonal delight windows for the ambient layer. Pure date logic so the
// effect renderer stays a dumb view and the rules stay testable.

export function seasonalMode(date = new Date()) {
  const month = date.getMonth() + 1; // 1-12
  const day = date.getDate();
  if (month === 12) return "snow";
  if (month === 10 && day >= 25) return "bats";
  if (month === 4 && day === 1) return "april";
  return null;
}

export const SEASONAL_COPY = {
  snow: { title: "Season's uptime", message: "Snow is falling. So are the alerts — mostly to zero." },
  bats: { title: "Spooky season", message: "Something is stirring in the ticket queue… 👻" },
  april: { title: "AI has resolved all tickets 🎉", message: "…April Fools. They're all still here. Happy hunting!" },
};
