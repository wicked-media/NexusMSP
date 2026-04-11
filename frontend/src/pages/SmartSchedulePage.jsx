import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  MapPin, Calendar, Clock, Users, Route, Navigation, ArrowLeft,
  Wifi, RefreshCw, Loader2, ChevronRight, Zap
} from "lucide-react";

const STATUS_COLORS = {
  scheduled: "bg-blue-500/20 text-blue-400", en_route: "bg-amber-500/20 text-amber-400",
  on_site: "bg-purple-500/20 text-purple-400", completed: "bg-emerald-500/20 text-emerald-400",
  cancelled: "bg-red-500/20 text-red-400",
};

export default function SmartSchedulePage() {
  const { token } = useAuth();
  const [events, setEvents] = useState([]);
  const [mapData, setMapData] = useState({ markers: [], zones: {} });
  const [availability, setAvailability] = useState([]);
  const [optimResult, setOptimResult] = useState(null);
  const [selectedTech, setSelectedTech] = useState("");
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState("map"); // map | calendar | optimize
  const headers = { Authorization: `Bearer ${token}` };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [eRes, mRes, aRes] = await Promise.all([
        axios.get(`${API}/scheduling/calendar`, { headers }),
        axios.get(`${API}/scheduling/map-data`, { headers }),
        axios.get(`${API}/scheduling/technician-availability`, { headers }),
      ]);
      setEvents(eRes.data);
      setMapData(mRes.data);
      setAvailability(aRes.data);
    } catch { toast.error("Failed to fetch scheduling data"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const optimizeRoute = async () => {
    if (!selectedTech) { toast.error("Select a technician first"); return; }
    try {
      const res = await axios.post(`${API}/scheduling/optimize-route`, { technician_id: selectedTech }, { headers });
      setOptimResult(res.data);
      toast.success(`Route optimized! Saving ${res.data.savings_km}km / ${res.data.savings_min} min`);
    } catch { toast.error("Failed to optimize"); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const fieldEvents = events.filter(e => e.type === "field_job");
  const workshopEvents = events.filter(e => e.type === "workshop");
  const zones = Object.entries(mapData.zones || {});

  return (
    <div className="space-y-5" data-testid="smart-schedule-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3"><Navigation className="w-8 h-8 text-cyan-400" />Smart Scheduling</h1>
          <p className="text-muted-foreground">{fieldEvents.length} field jobs &middot; {workshopEvents.length} workshop &middot; {zones.length} zones</p>
        </div>
        <div className="flex gap-2">
          {["map", "calendar", "optimize"].map(m => (
            <Button key={m} variant={viewMode === m ? "default" : "outline"} size="sm" onClick={() => setViewMode(m)} data-testid={`view-${m}`}>
              {m === "map" && <MapPin className="w-3 h-3 mr-1" />}
              {m === "calendar" && <Calendar className="w-3 h-3 mr-1" />}
              {m === "optimize" && <Route className="w-3 h-3 mr-1" />}
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </Button>
          ))}
          <Button variant="outline" size="sm" onClick={fetchAll}><RefreshCw className="w-4 h-4" /></Button>
        </div>
      </div>

      {/* Tech Availability */}
      <div className="grid grid-cols-6 gap-2">
        {availability.slice(0, 6).map(t => (
          <Card key={t.id} className={`cursor-pointer transition-all ${selectedTech === t.id ? "border-cyan-500 bg-cyan-500/5" : "hover:border-primary/30"}`}
            onClick={() => setSelectedTech(t.id)} data-testid={`tech-${t.id}`}>
            <CardContent className="p-3">
              <p className="text-sm font-bold truncate">{t.name}</p>
              <div className="flex items-center gap-2 mt-1">
                <Badge className={t.available ? "bg-emerald-500/20 text-emerald-400 text-[10px]" : "bg-red-500/20 text-red-400 text-[10px]"}>
                  {t.available ? "Available" : "Busy"}
                </Badge>
                <span className="text-[10px] text-muted-foreground">{t.jobs_today}j / {t.open_tickets}t</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* MAP VIEW */}
      {viewMode === "map" && (
        <div className="grid grid-cols-3 gap-4">
          <Card className="col-span-2">
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><MapPin className="w-4 h-4 text-cyan-400" />Job Map ({mapData.markers?.length || 0} jobs)</CardTitle></CardHeader>
            <CardContent>
              {/* Zone-based visual map */}
              <div className="grid grid-cols-3 gap-3 min-h-[400px]">
                {zones.map(([zone, coords]) => {
                  const jobsInZone = (mapData.markers || []).filter(m => m.zone === zone);
                  return (
                    <Card key={zone} className="border-dashed hover:border-cyan-500/30 transition-all">
                      <CardContent className="p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <MapPin className="w-4 h-4 text-cyan-400" />
                          <span className="font-bold text-sm">{zone}</span>
                          <Badge className="text-[10px] bg-cyan-500/10 text-cyan-400 ml-auto">{jobsInZone.length}</Badge>
                        </div>
                        <div className="space-y-1.5">
                          {jobsInZone.map(j => (
                            <div key={j.id} className="p-2 rounded bg-muted/20 border border-border/30 text-xs">
                              <div className="flex items-center gap-1.5">
                                <Wifi className="w-3 h-3 text-cyan-400 flex-shrink-0" />
                                <span className="font-medium truncate">{j.customer}</span>
                              </div>
                              <p className="text-muted-foreground truncate">{j.address}</p>
                              <div className="flex items-center justify-between mt-1">
                                <Badge className={`${STATUS_COLORS[j.status] || STATUS_COLORS.scheduled} text-[9px]`}>{j.status}</Badge>
                                <span className="text-[10px] text-muted-foreground">{j.technician}</span>
                              </div>
                            </div>
                          ))}
                          {jobsInZone.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">No jobs</p>}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
                {zones.length === 0 && <div className="col-span-3 flex items-center justify-center h-48 text-muted-foreground">No zones configured yet. Create field jobs with zone assignments.</div>}
              </div>
            </CardContent>
          </Card>
          <div className="space-y-4">
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Zone Summary</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {zones.map(([zone]) => {
                  const count = (mapData.markers || []).filter(m => m.zone === zone).length;
                  return (
                    <div key={zone} className="flex items-center justify-between text-sm p-2 rounded bg-muted/20">
                      <span className="flex items-center gap-2"><MapPin className="w-3 h-3 text-cyan-400" />{zone}</span>
                      <Badge variant="outline">{count} jobs</Badge>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* CALENDAR VIEW */}
      {viewMode === "calendar" && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Calendar className="w-4 h-4 text-blue-400" />Weekly Schedule</CardTitle></CardHeader>
          <CardContent>
            {/* Visual Weekly Calendar */}
            {(() => {
              const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
              const hours = Array.from({ length: 10 }, (_, i) => i + 7); // 7am - 4pm
              const today = new Date();
              const weekStart = new Date(today);
              weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7));
              const getEventsForDayHour = (dayIdx, hour) => {
                const d = new Date(weekStart); d.setDate(weekStart.getDate() + dayIdx);
                const dateStr = d.toISOString().split("T")[0];
                return events.filter(e => e.date === dateStr && parseInt((e.time || "08:00").split(":")[0]) === hour);
              };
              return (
                <div className="overflow-x-auto" data-testid="visual-calendar">
                  <div className="grid grid-cols-[60px_repeat(7,1fr)] gap-0 min-w-[700px]">
                    {/* Header Row */}
                    <div className="h-10" />
                    {days.map((day, i) => {
                      const d = new Date(weekStart); d.setDate(weekStart.getDate() + i);
                      const isToday = d.toDateString() === today.toDateString();
                      return (
                        <div key={day} className={`h-10 flex items-center justify-center text-xs font-bold border-b border-border/30 ${isToday ? "text-cyan-400 bg-cyan-500/5" : "text-muted-foreground"}`}>
                          {day} {d.getDate()}
                        </div>
                      );
                    })}
                    {/* Time Rows */}
                    {hours.map(hour => (
                      <>
                        <div key={`h-${hour}`} className="h-16 flex items-start justify-end pr-2 pt-1 text-[10px] text-muted-foreground/60 font-mono border-r border-border/20">
                          {hour}:00
                        </div>
                        {days.map((_, dayIdx) => {
                          const dayEvents = getEventsForDayHour(dayIdx, hour);
                          return (
                            <div key={`${hour}-${dayIdx}`} className="h-16 border-b border-r border-border/10 p-0.5 hover:bg-muted/5 transition-colors relative">
                              {dayEvents.map(ev => (
                                <div key={ev.id} className={`rounded px-1.5 py-0.5 text-[10px] leading-tight mb-0.5 truncate cursor-pointer ${ev.type === "field_job" ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/20" : "bg-purple-500/20 text-purple-300 border border-purple-500/20"}`} title={`${ev.title} - ${ev.technician}`}>
                                  <span className="font-bold">{ev.time?.slice(0,5)}</span> {ev.title?.slice(0, 20)}
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </>
                    ))}
                  </div>
                </div>
              );
            })()}
            {/* Event count summary below calendar */}
            <Separator className="my-3" />
            <Table>
              <TableHeader>
                <TableRow><TableHead>Type</TableHead><TableHead>Title</TableHead><TableHead>Date</TableHead><TableHead>Time</TableHead><TableHead>Zone</TableHead><TableHead>Technician</TableHead><TableHead>Status</TableHead><TableHead>Duration</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {events.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No scheduled events</TableCell></TableRow>
                ) : events.slice(0, 20).map(e => (
                  <TableRow key={e.id}>
                    <TableCell><Badge className={e.type === "field_job" ? "bg-cyan-500/20 text-cyan-400" : "bg-purple-500/20 text-purple-400"} style={{ fontSize: "10px" }}>{e.type === "field_job" ? "FIELD" : "WORKSHOP"}</Badge></TableCell>
                    <TableCell className="font-medium text-sm max-w-[250px] truncate">{e.title}</TableCell>
                    <TableCell className="font-mono text-sm">{e.date}</TableCell>
                    <TableCell className="text-sm">{e.time}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{e.zone || "-"}</Badge></TableCell>
                    <TableCell className="text-sm">{e.technician}</TableCell>
                    <TableCell><Badge className={`${STATUS_COLORS[e.status] || STATUS_COLORS.scheduled} text-[10px]`}>{e.status}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{e.duration} min</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* OPTIMIZE VIEW */}
      {viewMode === "optimize" && (
        <div className="space-y-4">
          <Card className="border-cyan-500/20">
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Route className="w-4 h-4 text-cyan-400" />Route Optimization</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <Select value={selectedTech || "__none"} onValueChange={v => setSelectedTech(v === "__none" ? "" : v)}>
                  <SelectTrigger className="w-60" data-testid="optim-tech"><SelectValue placeholder="Select technician" /></SelectTrigger>
                  <SelectContent>{availability.map(t => <SelectItem key={t.id} value={t.id}>{t.name} ({t.jobs_today} jobs today)</SelectItem>)}</SelectContent>
                </Select>
                <Button onClick={optimizeRoute} disabled={!selectedTech} data-testid="optimize-btn" className="bg-cyan-600 hover:bg-cyan-700"><Zap className="w-4 h-4 mr-1" />Optimize Route</Button>
              </div>
            </CardContent>
          </Card>

          {optimResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-3">
                <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-black text-cyan-400">{optimResult.total_distance_km} km</p><p className="text-xs text-muted-foreground">Optimized Distance</p></CardContent></Card>
                <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-black text-amber-400">{optimResult.total_travel_min} min</p><p className="text-xs text-muted-foreground">Travel Time</p></CardContent></Card>
                <Card className="border-emerald-500/20"><CardContent className="pt-4 text-center"><p className="text-2xl font-black text-emerald-400">{optimResult.savings_km} km</p><p className="text-xs text-muted-foreground">Distance Saved</p></CardContent></Card>
                <Card className="border-emerald-500/20"><CardContent className="pt-4 text-center"><p className="text-2xl font-black text-emerald-400">{optimResult.savings_min} min</p><p className="text-xs text-muted-foreground">Time Saved</p></CardContent></Card>
              </div>
              <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Optimized Order</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {(optimResult.optimized_jobs || []).map((j, i) => (
                    <div key={j.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/20 border border-border/30">
                      <div className="w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center text-sm font-bold text-cyan-400">{i + 1}</div>
                      <div className="flex-1">
                        <p className="font-medium text-sm">{j.customer_name}</p>
                        <p className="text-xs text-muted-foreground">{j.service_address || j.zone}</p>
                      </div>
                      <Badge variant="outline" className="text-xs">{j.zone}</Badge>
                      {i < (optimResult.optimized_jobs || []).length - 1 && <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
