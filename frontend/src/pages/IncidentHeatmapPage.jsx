import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Flame, BarChart3, Clock } from "lucide-react";

const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function IncidentHeatmapPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    axios.get(`${API}/incident-heatmap/data`, { headers }).then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!data) return null;

  const maxCount = Math.max(...data.heatmap.map(c => c.count), 1);
  const getColor = (count) => {
    if (count === 0) return "bg-muted";
    const intensity = count / maxCount;
    if (intensity > 0.75) return "bg-red-500";
    if (intensity > 0.5) return "bg-orange-500";
    if (intensity > 0.25) return "bg-amber-400";
    return "bg-green-400";
  };

  return (
    <div className="space-y-6" data-testid="incident-heatmap-page">
      <div><h1 className="text-2xl font-bold tracking-tight">Incident Heatmap</h1>
        <p className="text-muted-foreground text-sm mt-1">Visual pattern analysis of when incidents occur</p></div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-4 pb-3 text-center"><Flame className="w-5 h-5 mx-auto mb-1 text-red-500" />
          <p className="text-xl font-bold">{data.insights.total_incidents}</p><p className="text-xs text-muted-foreground">Total Incidents</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><Clock className="w-5 h-5 mx-auto mb-1 text-amber-500" />
          <p className="text-xl font-bold">{data.insights.peak_hour}</p><p className="text-xs text-muted-foreground">Peak Hour</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <p className="text-xl font-bold">{data.insights.peak_day}</p><p className="text-xs text-muted-foreground">Busiest Day</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <p className="text-xl font-bold">{data.insights.busiest_category}</p><p className="text-xs text-muted-foreground">Top Category</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Flame className="w-4 h-4" />Heatmap (Day x Hour)</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <div className="min-w-[700px]">
              <div className="flex gap-0.5 mb-1 ml-12">
                {Array.from({ length: 24 }, (_, i) => (
                  <div key={i} className="w-6 text-center text-[9px] text-muted-foreground">{i}</div>
                ))}
              </div>
              {days.map((day, dayIdx) => (
                <div key={day} className="flex items-center gap-0.5 mb-0.5">
                  <span className="w-10 text-xs text-muted-foreground text-right mr-1">{day}</span>
                  {Array.from({ length: 24 }, (_, hour) => {
                    const cell = data.heatmap.find(c => c.day_idx === dayIdx && c.hour === hour);
                    const count = cell?.count || 0;
                    return (
                      <div key={hour} className={`w-6 h-6 rounded-sm ${getColor(count)} transition-colors cursor-pointer hover:ring-1 hover:ring-primary`}
                        title={`${day} ${hour}:00 - ${count} incidents`} data-testid={`heatmap-${dayIdx}-${hour}`} />
                    );
                  })}
                </div>
              ))}
              <div className="flex items-center gap-2 mt-4 justify-center">
                <span className="text-xs text-muted-foreground">Less</span>
                <div className="w-4 h-4 rounded-sm bg-muted" />
                <div className="w-4 h-4 rounded-sm bg-green-400" />
                <div className="w-4 h-4 rounded-sm bg-amber-400" />
                <div className="w-4 h-4 rounded-sm bg-orange-500" />
                <div className="w-4 h-4 rounded-sm bg-red-500" />
                <span className="text-xs text-muted-foreground">More</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">By Category</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.by_category.map(c => (
              <div key={c.category} className="flex items-center justify-between p-2 rounded bg-muted/30" data-testid={`cat-${c.category}`}>
                <span className="text-sm capitalize">{c.category}</span>
                <Badge variant="outline">{c.count}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Top 10 Clients</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.by_client.map(c => (
              <div key={c.client} className="flex items-center justify-between p-2 rounded bg-muted/30" data-testid={`client-incidents-${c.client}`}>
                <span className="text-sm">{c.client}</span>
                <Badge variant="outline">{c.count}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
