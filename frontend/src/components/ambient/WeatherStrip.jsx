import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { API, useAuth } from "@/App";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { displayTemperature, formatWeatherFreshness, getWeatherMotionKind } from "@/lib/weatherPresentation";
import "@/styles/weather-strip.css";
import { CalendarDays, ChevronRight, Clock3, Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSun, Droplets, Loader2, MapPin, Snowflake, Sun, ThermometerSun, Wind } from "lucide-react";

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

function forecastDateLabel(date, timezone) {
  try { return new Intl.DateTimeFormat("en-AU", { timeZone: timezone, weekday: "long", day: "numeric", month: "short" }).format(new Date(`${date}T12:00:00Z`)); } catch { return date; }
}

function forecastHourLabel(value) {
  const match = String(value || "").match(/T(\d{2}):(\d{2})/);
  if (!match) return "--:--";
  return `${match[1]}:${match[2]}`;
}

function WeatherGlyph({ kind, isDay = true, className = "", iconClassName = "" }) {
  const Icon = iconFor(kind, isDay);
  const motionKind = getWeatherMotionKind(kind);

  return <span className={`nx-weather-glyph nx-weather-glyph--${motionKind} ${className}`}>
    <Icon className={iconClassName} aria-hidden="true" />
    {motionKind !== "clear" && motionKind !== "cloud" && motionKind !== "storm" && <span className="nx-weather-glyph__detail" />}
  </span>;
}

function WeatherOutlookDialog({ open, onOpenChange, weather, now }) {
  if (!weather?.current || !weather?.location) return null;

  const { current, location, units } = weather;
  const forecast = Array.isArray(weather.outlook) && weather.outlook.length > 0
    ? weather.outlook
    : (Array.isArray(weather.forecast) ? weather.forecast : []);
  const hourly = Array.isArray(weather.hourly) ? weather.hourly.slice(0, 12) : [];
  const place = [location.name, location.admin1].filter(Boolean).join(", ");
  const temperatureUnit = units?.temperature || "°C";
  const freshLabel = formatWeatherFreshness(weather.freshness?.retrieved_at || weather.refreshed_at || current.observed_at, now);
  const outlookLabel = forecast.length >= 7 ? "7-day outlook" : "Forecast outlook";

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex h-[min(760px,calc(100vh-1.5rem))] max-h-[calc(100vh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-5xl flex-col gap-0 overflow-hidden border-cyan-300/20 bg-[linear-gradient(155deg,rgba(5,18,32,0.99),rgba(10,14,24,0.99)_60%,rgba(7,30,38,0.99))] p-0 sm:rounded-2xl" data-testid="weather-outlook-dialog">
      <DialogHeader className="shrink-0 border-b border-cyan-100/[0.09] bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.18),transparent_44%),linear-gradient(135deg,rgba(14,116,144,0.12),transparent)] px-5 py-5 pr-14 text-left sm:px-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-200/75">Office outlook</p>
        <DialogTitle className="mt-1 flex items-center gap-2 text-xl text-cyan-50"><CalendarDays className="h-5 w-5 text-cyan-300" />{place}</DialogTitle>
        <DialogDescription className="mt-1.5 max-w-2xl">Live conditions and the forecast for your configured office location. {freshLabel}.</DialogDescription>
      </DialogHeader>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
        <section className="relative overflow-hidden rounded-2xl border border-cyan-200/[0.13] bg-[linear-gradient(120deg,rgba(8,47,73,0.72),rgba(12,20,31,0.62)_58%,rgba(15,118,110,0.16))] p-5">
          <div className="absolute -right-12 -top-16 h-40 w-40 rounded-full bg-cyan-300/10 blur-3xl" />
          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <span className="flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-200/15 bg-slate-950/25"><WeatherGlyph kind={current.icon} isDay={current.is_day} className="h-10 w-10" iconClassName="h-8 w-8 text-cyan-100" /></span>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-100/65">Right now</p>
                <div className="mt-0.5 flex items-baseline gap-2"><strong className="text-4xl font-semibold tracking-[-0.04em] text-white">{displayTemperature(current.temperature)}{temperatureUnit}</strong><span className="text-sm font-medium text-cyan-100/80">{current.label}</span></div>
                <p className="mt-1 text-xs text-slate-300">Feels {displayTemperature(current.apparent_temperature)}{temperatureUnit} · {displayTemperature(current.wind_speed)} {units?.wind_speed || "km/h"} wind</p>
              </div>
            </div>
            <div className="flex items-center gap-2 self-start rounded-full border border-cyan-100/[0.10] bg-black/15 px-3 py-1.5 text-[11px] font-medium text-cyan-100/75 sm:self-auto"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,.85)]" />{freshLabel}</div>
          </div>
        </section>

        {hourly.length > 0 && <section className="mt-6">
          <div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-semibold text-foreground">Next 12 hours</h3><p className="mt-0.5 text-xs text-muted-foreground">Local time · temperature and conditions</p></div><Clock3 className="h-4 w-4 text-cyan-300/80" /></div>
          <div className="scrollbar-thin flex gap-2 overflow-x-auto pb-2">{hourly.map((hour) => <div key={hour.time} className="min-w-[76px] rounded-xl border border-white/[0.07] bg-white/[0.035] px-2.5 py-3 text-center"><p className="font-mono text-[11px] font-medium text-cyan-100/80">{forecastHourLabel(hour.time)}</p><WeatherGlyph kind={hour.icon} isDay={hour.is_day} className="mx-auto my-2 h-5 w-5" iconClassName="h-4 w-4 text-cyan-200" /><p className="text-sm font-semibold">{displayTemperature(hour.temperature)}{temperatureUnit}</p><p className="mt-1 text-[10px] text-muted-foreground">{hour.precipitation_probability != null ? `${Math.round(hour.precipitation_probability)}% rain` : hour.label}</p></div>)}</div>
        </section>}

        {forecast.length > 0 && <section className="mt-6">
          <div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-semibold text-foreground">{outlookLabel}</h3><p className="mt-0.5 text-xs text-muted-foreground">Use it to plan field work, customer visits, and site windows.</p></div><ThermometerSun className="h-4 w-4 text-cyan-300/80" /></div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{forecast.map((day) => <div key={day.date} className="rounded-xl border border-white/[0.07] bg-white/[0.035] px-3.5 py-3"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-foreground">{forecastLabel(day.date, location.timezone)}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{forecastDateLabel(day.date, location.timezone)}</p></div><WeatherGlyph kind={day.icon} className="h-5 w-5" iconClassName="h-4 w-4 text-cyan-200" /></div><p className="mt-3 text-xs font-medium text-slate-200">{day.label}</p><div className="mt-2 flex items-end justify-between gap-2"><p className="text-base font-semibold">{displayTemperature(day.low)}° <span className="text-muted-foreground">/</span> {displayTemperature(day.high)}°</p>{day.precipitation_probability != null && <span className="flex items-center gap-1 text-[10px] text-cyan-100/70"><Droplets className="h-3 w-3 text-cyan-300" />{Math.round(day.precipitation_probability)}%</span>}</div></div>)}</div>
        </section>}
      </div>

      <DialogFooter className="shrink-0 border-t border-cyan-100/[0.08] bg-black/10 px-5 py-4 sm:px-6"><Link to="/settings?tab=weather&anchor=weather-clock-settings-card" className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/20 bg-cyan-300/[0.08] px-3.5 py-2 text-xs font-semibold text-cyan-100 transition-colors hover:border-cyan-200/35 hover:bg-cyan-300/[0.14]">Weather & local clock settings<ChevronRight className="h-3.5 w-3.5" /></Link></DialogFooter>
    </DialogContent>
  </Dialog>;
}

export default function WeatherStrip({ compact = false }) {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [weather, setWeather] = useState(null);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [outlookOpen, setOutlookOpen] = useState(false);

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

  if (!weather && !error) return compact ? null : <div className="flex min-h-12 items-center rounded-xl border border-border/60 bg-card/45 px-4 text-xs text-muted-foreground" data-testid="weather-strip"><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin text-cyan-300" />Loading local weather...</div>;
  if (error) return compact
    ? <Link to="/settings?tab=weather&anchor=weather-clock-settings-card" className="hidden h-9 items-center gap-2 rounded-lg px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:flex" data-testid="weather-strip"><Cloud className="h-4 w-4 text-amber-400" /><span className="hidden xl:inline">Weather unavailable</span></Link>
    : <Link to="/settings?tab=weather&anchor=weather-clock-settings-card" className="flex min-h-12 items-center justify-between rounded-xl border border-amber-400/25 bg-amber-400/[0.06] px-4 text-sm transition-colors hover:bg-amber-400/[0.1]" data-testid="weather-strip"><span className="text-amber-100">Weather is currently unavailable</span><span className="text-xs text-amber-200/80">Retry or check settings</span></Link>;
  if (!weather?.configured || !weather.current) return compact
    ? <Link to="/settings?tab=weather&anchor=weather-clock-settings-card" className="hidden h-9 items-center gap-2 rounded-lg px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:flex" data-testid="weather-strip"><MapPin className="h-4 w-4 text-cyan-300" /><span className="hidden xl:inline">Set office weather</span></Link>
    : <Link to="/settings?tab=weather&anchor=weather-clock-settings-card" className="group flex min-h-12 items-center gap-3 rounded-xl border border-cyan-400/20 bg-gradient-to-r from-cyan-400/[0.09] via-background to-background px-4 transition-colors hover:border-cyan-400/35 hover:bg-cyan-400/[0.1]" data-testid="weather-strip"><span className="flex h-7 w-7 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-400/10"><MapPin className="h-4 w-4 text-cyan-200" /></span><div><p className="text-xs font-semibold">Set your office weather</p><p className="text-[11px] text-muted-foreground">Choose a location for the dashboard forecast and local clock.</p></div><span className="ml-auto text-xs font-medium text-cyan-200">Configure</span></Link>;

  const { current, location, units } = weather;
  const forecast = Array.isArray(weather.forecast) ? weather.forecast : [];
  const temperatureUnit = units?.temperature || "°C";
  const place = [location.name, location.admin1].filter(Boolean).join(", ");
  const freshness = formatWeatherFreshness(weather.freshness?.retrieved_at || weather.refreshed_at || current.observed_at, now);

  if (compact) return <>
    <button type="button" onClick={() => setOutlookOpen(true)} className="group hidden h-9 items-center gap-2 rounded-lg border border-transparent px-2.5 text-left text-xs text-muted-foreground transition-colors hover:border-border/70 hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 lg:flex" aria-label={`Open weather outlook for ${place}`} data-testid="weather-strip">
      <WeatherGlyph kind={current.icon} isDay={current.is_day} className="h-4 w-4" iconClassName="h-4 w-4 text-cyan-300" />
      <span className="font-semibold text-foreground">{displayTemperature(current.temperature)}{temperatureUnit}</span>
      <span className="hidden max-w-28 truncate xl:inline">{place}</span>
      <span className="hidden font-mono text-[10px] text-muted-foreground 2xl:inline">{formatClock(location.timezone, now)}</span>
    </button>
    <WeatherOutlookDialog open={outlookOpen} onOpenChange={setOutlookOpen} weather={weather} now={now} />
  </>;

  return <>
    <button type="button" onClick={() => setOutlookOpen(true)} className="group block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-background" aria-label={`Open weather outlook for ${place}`} data-testid="weather-strip">
      <div className="nx-weather-strip relative overflow-hidden rounded-xl border border-cyan-300/[0.18] bg-[linear-gradient(110deg,rgba(6,52,78,0.68),rgba(15,23,42,0.84)_44%,rgba(8,61,62,0.46))] transition duration-200 ease-out group-hover:-translate-y-px group-hover:border-cyan-200/[0.34] group-hover:brightness-110">
        <span className="nx-weather-strip__aurora nx-weather-strip__aurora--one" /><span className="nx-weather-strip__aurora nx-weather-strip__aurora--two" /><span className="nx-weather-strip__grid" />
        <div className="relative flex min-h-[68px] flex-wrap items-center gap-x-3.5 gap-y-2 px-3.5 py-2.5 lg:flex-nowrap">
          <div className="flex shrink-0 items-center gap-2.5"><span className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-200/[0.16] bg-slate-950/25"><WeatherGlyph kind={current.icon} isDay={current.is_day} className="h-6 w-6" iconClassName="h-5 w-5 text-cyan-100" /></span><div><p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-cyan-100/65">Office weather</p><p className="mt-0.5 text-[1.45rem] font-semibold leading-none tracking-[-0.045em] text-white">{displayTemperature(current.temperature)}{temperatureUnit}</p></div></div>
          <div className="min-w-[175px] flex-1 lg:border-l lg:border-white/[0.08] lg:pl-3.5"><div className="flex items-center gap-2"><p className="truncate text-sm font-semibold text-slate-100">{current.label}</p><span className="hidden h-1 w-1 rounded-full bg-cyan-200/55 sm:inline-block" /><span className="hidden truncate text-xs text-cyan-100/70 sm:inline">{place}</span></div><p className="mt-1 flex items-center gap-2 text-[10px] text-slate-300/80"><span className="inline-flex items-center gap-1"><ThermometerSun className="h-3 w-3 text-cyan-300/80" />Feels {displayTemperature(current.apparent_temperature)}{temperatureUnit}</span><span className="inline-flex items-center gap-1"><Wind className="h-3 w-3 text-cyan-300/80" />{displayTemperature(current.wind_speed)} {units?.wind_speed || "km/h"}</span></p></div>
          {forecast.length > 0 && <div className="hidden items-center gap-1.5 border-l border-white/[0.08] pl-3.5 md:flex">{forecast.slice(0, 3).map(day => <span key={day.date} className="rounded-lg px-1.5 py-1 text-center transition-colors group-hover:bg-white/[0.045]"><span className="block text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-300/65">{forecastLabel(day.date, location.timezone)}</span><WeatherGlyph kind={day.icon} className="mx-auto my-0.5 h-4 w-4" iconClassName="h-3.5 w-3.5 text-cyan-200" /><span className="block text-[10px] font-medium text-slate-100">{displayTemperature(day.low)}°<span className="text-slate-500">/</span>{displayTemperature(day.high)}°</span></span>)}</div>}
          <div className="ml-auto flex shrink-0 items-center gap-2 border-l border-white/[0.08] pl-3.5 text-right"><div><p className="font-mono text-lg font-semibold tracking-tight text-cyan-50">{formatClock(location.timezone, now)}</p><p className="mt-0.5 flex items-center justify-end gap-1 text-[9px] font-medium uppercase tracking-[0.08em] text-emerald-100/70"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,.78)]" />{freshness}<span className="hidden text-cyan-100/55 xl:inline">· {formatDate(location.timezone, now)} · Local</span></p></div><span className="flex h-7 w-7 items-center justify-center rounded-lg border border-cyan-200/10 bg-white/[0.035] text-cyan-100/75 transition-colors group-hover:border-cyan-100/25 group-hover:text-cyan-50"><ChevronRight className="h-4 w-4" /></span></div>
        </div>
      </div>
    </button>
    <WeatherOutlookDialog open={outlookOpen} onOpenChange={setOutlookOpen} weather={weather} now={now} />
  </>;
}
