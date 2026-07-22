import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CloudSun, Loader2, MapPin, Save, Search, ThermometerSun } from "lucide-react";
import { toast } from "sonner";

const EMPTY_SETTINGS = { configured: false, location: null, temperature_unit: "celsius" };
const locationLabel = (location) => [location?.name, location?.admin1, location?.country].filter(Boolean).join(", ");
const displayTemperature = (value) => Number.isFinite(Number(value)) ? Math.round(Number(value)) : "--";

export default function WeatherClockSettingsCard() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [settings, setSettings] = useState(EMPTY_SETTINGS);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    let live = true;
    axios.get(`${API}/ambient/weather-settings`, { headers })
      .then(({ data }) => { if (live) setSettings({ ...EMPTY_SETTINGS, ...data }); })
      .catch(() => { if (live) toast.error("Could not load weather settings"); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [headers]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) { setResults([]); setSearching(false); return undefined; }
    let live = true;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const { data } = await axios.get(`${API}/ambient/weather-search`, { params: { q: term }, headers });
        if (live) setResults(data.results || []);
      } catch (error) {
        if (live) { setResults([]); toast.error(error.response?.data?.detail || "Location search is unavailable"); }
      } finally { if (live) setSearching(false); }
    }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [query, headers]);

  const selectLocation = (location) => {
    setSettings(current => ({ ...current, configured: true, location }));
    setQuery(locationLabel(location));
    setResults([]);
    setPreview(null);
  };

  const save = async () => {
    if (!settings.location?.name) { toast.error("Search for and select a location first"); return; }
    setSaving(true);
    try {
      const { data } = await axios.put(`${API}/ambient/weather-settings`, { location: settings.location, temperature_unit: settings.temperature_unit }, { headers });
      setSettings(data);
      const weather = await axios.get(`${API}/ambient/weather`, { headers });
      setPreview(weather.data);
      toast.success("Weather and local clock settings saved");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not save weather settings");
    } finally { setSaving(false); }
  };

  const current = preview?.current;
  const unit = preview?.units?.temperature || (settings.temperature_unit === "fahrenheit" ? "°F" : "°C");

  return (
    <Card id="weather-clock-settings-card" data-testid="weather-clock-settings-card" className="overflow-visible border-cyan-500/20 bg-gradient-to-br from-cyan-500/[0.07] via-background to-background">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div><CardTitle className="flex items-center gap-2"><CloudSun className="h-5 w-5 text-cyan-300" />Weather & local clock</CardTitle><CardDescription className="mt-1.5 max-w-2xl">Set one office location for the dashboard’s live current temperature, compact forecast, and timezone-aware clock. The data is displayed to your technicians; no weather API key is required.</CardDescription></div>
          {settings.location && <Badge variant="outline" className="w-fit border-cyan-400/25 bg-cyan-400/10 text-cyan-200"><MapPin className="mr-1 h-3 w-3" />{settings.location.timezone}</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
          <div className="relative space-y-2"><Label htmlFor="weather-location">Office location</Label><div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input id="weather-location" value={query} onChange={event => setQuery(event.target.value)} className="pl-9" placeholder="Search suburb, city, or postcode" autoComplete="off" data-testid="weather-location-search" />{searching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-cyan-300" />}</div>
            {results.length > 0 && <div className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-border bg-popover p-1 shadow-2xl" data-testid="weather-location-results">{results.map(result => <button type="button" key={result.id} onClick={() => selectLocation(result)} className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-cyan-500/10"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" /><span className="min-w-0"><span className="block truncate text-sm font-medium">{locationLabel(result)}</span><span className="mt-0.5 block text-xs text-muted-foreground">{result.timezone}</span></span></button>)}</div>}
            <p className="text-xs text-muted-foreground">Choose a result so NexusMSP can save the location’s coordinates and timezone accurately.</p>
          </div>
          <div className="space-y-2"><Label>Temperature unit</Label><Select value={settings.temperature_unit} onValueChange={temperature_unit => { setSettings(current => ({ ...current, temperature_unit })); setPreview(null); }}><SelectTrigger data-testid="weather-temperature-unit"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="celsius">Celsius (°C)</SelectItem><SelectItem value="fahrenheit">Fahrenheit (°F)</SelectItem></SelectContent></Select><p className="text-xs text-muted-foreground">Applies to the dashboard strip and forecast.</p></div>
        </div>

        {settings.location && <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-background/55 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex min-w-0 items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-400/10"><MapPin className="h-4 w-4 text-cyan-200" /></span><div className="min-w-0"><p className="truncate text-sm font-semibold">{locationLabel(settings.location)}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{settings.location.timezone} · {Number(settings.location.latitude).toFixed(3)}, {Number(settings.location.longitude).toFixed(3)}</p></div></div><Button onClick={save} disabled={saving || loading} data-testid="save-weather-clock-settings-btn">{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save location</Button></div>}

        {current && <div className="grid gap-3 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.06] p-4 sm:grid-cols-[1fr_auto] sm:items-center" data-testid="weather-clock-preview"><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-300/20 bg-background/50"><ThermometerSun className="h-5 w-5 text-cyan-200" /></span><div><p className="text-sm font-semibold">Live dashboard preview</p><p className="mt-0.5 text-xs text-muted-foreground">{current.label} in {settings.location?.name} · Feels like {displayTemperature(current.apparent_temperature)}{unit}</p></div></div><p className="text-2xl font-semibold tracking-tight text-cyan-100">{displayTemperature(current.temperature)}{unit}</p></div>}
      </CardContent>
    </Card>
  );
}
