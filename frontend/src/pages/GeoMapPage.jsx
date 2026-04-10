import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, User, Navigation } from "lucide-react";

export default function GeoMapPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const headers = { Authorization: `Bearer ${token}` };
  useEffect(() => { axios.get(`${API}/geo-map/data`, { headers }).then(r => setData(r.data)); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <div className="p-6 text-muted-foreground">Loading...</div>;
  const s = data.summary;
  return (
    <div className="space-y-6" data-testid="geo-map-page">
      <div><h1 className="text-2xl font-bold">Geo Map</h1><p className="text-muted-foreground text-sm">Client sites and technician locations</p></div>
      <div className="grid grid-cols-4 gap-4">
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Client Sites</div><div className="text-3xl font-bold mt-1">{s.total_sites}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">On-Site Techs</div><div className="text-3xl font-bold text-blue-500 mt-1">{s.active_techs}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">Available</div><div className="text-3xl font-bold text-green-500 mt-1">{s.available_techs}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-sm text-muted-foreground">En Route</div><div className="text-3xl font-bold text-yellow-500 mt-1">{s.open_dispatch}</div></CardContent></Card>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><MapPin className="w-4 h-4" />Client Sites</CardTitle></CardHeader>
          <CardContent><div className="space-y-2">
            {data.sites.map(site => (
              <div key={site.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50">
                <div className={`w-3 h-3 rounded-full ${site.status === "critical" ? "bg-red-500" : site.status === "warning" ? "bg-yellow-500" : "bg-green-500"}`} />
                <div className="flex-1"><div className="text-sm font-medium">{site.name}</div><div className="text-xs text-muted-foreground">{site.device_count} devices | {site.active_alerts} alerts</div></div>
                <Badge variant={site.status === "critical" ? "destructive" : site.status === "warning" ? "secondary" : "default"} className="text-xs">{site.status}</Badge>
              </div>
            ))}
          </div></CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><User className="w-4 h-4" />Technicians</CardTitle></CardHeader>
          <CardContent><div className="space-y-2">
            {data.technicians.map(tech => (
              <div key={tech.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50">
                <div className={`w-3 h-3 rounded-full ${tech.status === "on_site" ? "bg-blue-500" : tech.status === "available" ? "bg-green-500" : "bg-yellow-500"}`} />
                <div className="flex-1"><div className="text-sm font-medium">{tech.name}</div><div className="text-xs text-muted-foreground">{tech.current_location} | {tech.active_tickets} tickets</div></div>
                <Badge variant="outline" className="text-xs">{tech.status.replace("_", " ")}</Badge>
                {tech.eta_minutes && <span className="text-xs text-muted-foreground">ETA: {tech.eta_minutes}min</span>}
              </div>
            ))}
          </div></CardContent>
        </Card>
      </div>
    </div>
  );
}
