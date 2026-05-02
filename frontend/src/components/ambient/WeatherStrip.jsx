import { useEffect, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { API, useAuth } from "@/App";

// Static map so Tailwind JIT keeps the classes
const MOOD = {
  stormy:       { gradient: "from-rose-600 via-rose-500 to-rose-700",         label: "Stormy",         hint: "Critical fires lit · triage mode" },
  beach:        { gradient: "from-amber-300 via-sky-300 to-emerald-300",      label: "Beach Friday",   hint: "All clear · enjoy the wind-down" },
  rainy_monday: { gradient: "from-slate-500 via-slate-600 to-slate-700",      label: "Rainy Monday",   hint: "Heavy backlog · coffee + prioritise" },
  sunny:        { gradient: "from-amber-300 via-yellow-300 to-amber-400",     label: "Sunny",          hint: "Quiet day · get ahead of work" },
  neutral:      { gradient: "from-violet-500 via-indigo-500 to-sky-500",      label: "Steady",         hint: "Business as usual" },
};

export default function WeatherStrip() {
  const { token } = useAuth();
  const [mood, setMood] = useState(null);

  useEffect(() => {
    if (!token) return;
    axios.get(`${API}/ambient/weather-mode`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setMood(r.data?.mood || "neutral"))
      .catch(() => setMood("neutral"));
  }, [token]);

  if (!mood) return null;
  const cfg = MOOD[mood] || MOOD.neutral;

  return (
    <Link
      to="/atmosphere"
      className="block group"
      title={`${cfg.label} — ${cfg.hint} · click for details`}
      data-testid="weather-strip"
    >
      <div className={`h-1.5 rounded-full bg-gradient-to-r ${cfg.gradient} opacity-60 group-hover:opacity-90 transition-opacity`} />
      <div className="flex items-center justify-between mt-1 px-1 text-[10px] uppercase tracking-widest text-muted-foreground">
        <span>Weather: <span className="text-foreground/80">{cfg.label}</span></span>
        <span className="opacity-70">{cfg.hint}</span>
      </div>
    </Link>
  );
}
