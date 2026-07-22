import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { API, useAuth } from "@/App";
import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSun, Loader2, MapPin, Snowflake, Sun } from "lucide-react";

const iconFor = (kind, isDay = true) => {
  if (kind === "storm") return CloudLightning;
  if (kind === "snow") return Snowflake;
  if (kind === "rain") return CloudRain;
  if (kind === "drizzle") return CloudDrizzle;
  if (kind === "fog") return CloudFog;
  if (kind === "cloudy") return Cloud;
  if (kind === "clear") return isDay ? Sun : CloudSun;
  return CloudSun;
};

function formatClock(timezone, now) {
  try { return new Intl.DateTimeFormat("en-AU", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(now); } catch { return "--:--"; }
}
function formatDate(timezone, now) {
  try { return new Intl.DateTimeFormat("en-AU", { timeZone: timezone, weekday: "short", day: "numeric", month: "short" }).format(now); } catch { return ""; }
}
function forecastLabel(date, timezone) {
  try { return new Intl.DateTimeFormat("en-AU", { timeZone: timezone, weekday: "short" }).format(new Date(`${date}T12:00:00Z`)); } catch { return date; }
}
const displayTemperature = (value) => Number.isFinite(Number(value)) ? Math.round(Number(value)) : "--";

export default function WeatherStrip() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [weather, setWeather] = useState(null);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const { data } = await axios.get(`${API}/ambient/weather`, { headers });
        if (live) { setWeather(data); setError(false); }
      } catch { if (live) setError(true); }
    };
    load();
    const refresh = setInterval(load, 10 * 60 * 1000);
    return () => { live = false; clearInterval(refresh); };
  }, [headers]);

  useEffect(() => {
    const ticker = setInterval(() => setNow(new Date()), 30 * 1000);
    return () => clearInterval(ticker);
  }, []);

  if (!weather && !error) return <div className="flex min-h-12 items-center rounded-xl border border-border/60 bg-card/45 px-4 text-xs text-muted-foreground" data-testid="weather-strip"><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin text-cyan-300" />Loading local weather...</div>;
  if (error) return <Link to="/settings?tab=weather&anchor=weather-clock-settings-card" className="flex min-h-12 items-center justify-between rounded-xl border border-amber-400/25 bg-amber-400/[0.06] px-4 text-sm transition-colors hover:bg-amber-400/[0.1]" data-testid="weather-strip"><span className="text-amber-100">Weather is currently unavailable</span><span className="text-xs text-amber-200/80">Retry or check settings</span></Link>;
  if (!weather?.configured || !weather.current) return <Link to="/settings?tab=weather&anchor=weather-clock-settings-card" className="group flex min-h-12 items-center gap-3 rounded-xl border border-cyan-400/20 bg-gradient-to-r from-cyan-400/[0.09] via-background to-background px-4 transition-colors hover:border-cyan-400/35 hover:bg-cyan-400/[0.1]" data-testid="weather-strip"><span className="flex h-7 w-7 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-400/10"><MapPin className="h-4 w-4 text-cyan-200" /></span><div><p className="text-xs font-semibold">Set your office weather</p><p className="text-[11px] text-muted-foreground">Choose a location for the dashboard forecast and local clock.</p></div><span className="ml-auto text-xs font-medium text-cyan-200">Configure</span></Link>;

  const { current, forecast, location, units } = weather;
  const CurrentIcon = iconFor(current.icon, current.is_day);
  const temperatureUnit = units?.temperature || "°C";
  const place = [location.name, location.admin1].filter(Boolean).join(", ");
  return <Link to="/settings?tab=weather&anchor=weather-clock-settings-card" className="group block" title="Open Weather & local clock settings" data-testid="weather-strip"><div className="relative overflow-hidden rounded-xl border border-cyan-400/20 bg-[linear-gradient(110deg,rgba(6,182,212,0.12),rgba(15,23,42,0.18)_45%,rgba(20,184,166,0.08))] transition duration-200 group-hover:-translate-y-px group-hover:border-cyan-300/35 group-hover:brightness-110"><div className="relative flex min-h-[58px] flex-wrap items-center gap-x-4 gap-y-2 px-3.5 py-2.5 lg:flex-nowrap"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-300/20 bg-slate-950/20"><CurrentIcon className="h-5 w-5 text-cyan-200" /></span><div className="shrink-0"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-200/75">Current conditions</p><p className="text-lg font-semibold leading-tight text-foreground">{displayTemperature(current.temperature)}{temperatureUnit}</p></div><div className="min-w-[150px] flex-1 border-l border-white/10 pl-4"><p className="truncate text-sm font-semibold">{current.label}</p><p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted-foreground"><MapPin className="h-3 w-3 text-cyan-300" />{place} · Feels {displayTemperature(current.apparent_temperature)}{temperatureUnit} · {displayTemperature(current.wind_speed)} {units?.wind_speed || "km/h"}</p></div><div className="hidden items-center gap-2 border-l border-white/10 pl-4 sm:flex">{forecast.map(day => { const ForecastIcon = iconFor(day.icon); return <span key={day.date} className="flex min-w-11 flex-col items-center"><span className="text-[9px] font-medium text-muted-foreground">{forecastLabel(day.date, location.timezone)}</span><ForecastIcon className="my-0.5 h-3.5 w-3.5 text-cyan-200" /><span className="text-[10px] font-medium">{displayTemperature(day.low)}°/{displayTemperature(day.high)}°</span></span>; })}</div><div className="ml-auto shrink-0 border-l border-white/10 pl-4 text-right"><p className="font-mono text-xl font-semibold tracking-tight text-cyan-50">{formatClock(location.timezone, now)}</p><p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-cyan-200/70">{formatDate(location.timezone, now)} · Local time</p></div></div></div></Link>;
}
