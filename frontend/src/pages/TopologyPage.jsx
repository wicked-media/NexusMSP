import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Network, Monitor, Wifi, WifiOff, Loader2, RefreshCw, ZoomIn, ZoomOut } from "lucide-react";

const TYPE_ICONS = {
  router: { color: "#f43f5e", label: "R" }, firewall: { color: "#f97316", label: "FW" },
  gateway: { color: "#a855f7", label: "GW" }, switch: { color: "#3b82f6", label: "SW" },
  server: { color: "#06b6d4", label: "SV" }, workstation: { color: "#22c55e", label: "WS" },
  laptop: { color: "#84cc16", label: "LP" }, printer: { color: "#6b7280", label: "PR" },
  other: { color: "#9ca3af", label: "?" },
};

export default function TopologyPage() {
  const { token } = useAuth();
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState(null);
  const [topology, setTopology] = useState(null);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 400, y: 50 });
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    axios.get(`${API}/topology/all`, { headers }).then(r => setClients(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, [token]);

  const loadTopology = async (clientId) => {
    setSelectedClient(clientId);
    try {
      const res = await axios.get(`${API}/topology/${clientId}`, { headers });
      setTopology(res.data);
    } catch { toast.error("Failed to load topology"); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="space-y-5" data-testid="topology-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3"><Network className="w-8 h-8 text-cyan-400" />Network Topology</h1>
          <p className="text-muted-foreground">{clients.length} clients with devices</p>
        </div>
      </div>

      {!selectedClient && (
        <div className="grid grid-cols-3 gap-3">
          {clients.map(c => (
            <Card key={c.client_id} className="cursor-pointer hover:border-primary/50 transition-all" onClick={() => loadTopology(c.client_id)} data-testid={`topo-client-${c.client_id}`}>
              <CardContent className="pt-4 flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-cyan-500/10 flex items-center justify-center">
                  <Network className="w-6 h-6 text-cyan-400" />
                </div>
                <div className="flex-1">
                  <p className="font-medium">{c.client_name}</p>
                  <p className="text-xs text-muted-foreground">{c.device_count} devices &middot; {c.online_count} online</p>
                </div>
                <Badge className={c.health_pct >= 80 ? "bg-emerald-500/20 text-emerald-400" : c.health_pct >= 50 ? "bg-amber-500/20 text-amber-400" : "bg-red-500/20 text-red-400"}>
                  {c.health_pct}%
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selectedClient && topology && (
        <>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => { setSelectedClient(null); setTopology(null); }}>Back</Button>
            <h2 className="text-lg font-bold">{topology.client_name}</h2>
            <div className="ml-auto flex gap-1">
              <Badge>{topology.stats?.total_devices || 0} devices</Badge>
              <Badge className="bg-emerald-500/20 text-emerald-400">{topology.stats?.online || 0} online</Badge>
              <Badge className="bg-red-500/20 text-red-400">{topology.stats?.offline || 0} offline</Badge>
              <Button variant="outline" size="sm" onClick={() => setZoom(z => Math.min(2, z + 0.2))}><ZoomIn className="w-3 h-3" /></Button>
              <Button variant="outline" size="sm" onClick={() => setZoom(z => Math.max(0.3, z - 0.2))}><ZoomOut className="w-3 h-3" /></Button>
            </div>
          </div>

          <Card>
            <CardContent className="p-0 overflow-hidden" style={{ height: 500 }}>
              <svg width="100%" height="100%" viewBox="-400 -50 1000 550">
                <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
                  {/* Edges */}
                  {topology.edges.map((e, i) => {
                    const src = topology.nodes.find(n => n.id === e.source);
                    const tgt = topology.nodes.find(n => n.id === e.target);
                    if (!src || !tgt) return null;
                    return <line key={i} x1={src.x} y1={src.y} x2={tgt.x} y2={tgt.y}
                      stroke="#374151" strokeWidth="1.5" strokeDasharray={e.type === "uplink" ? "none" : "4 2"} />;
                  })}
                  {/* Nodes */}
                  {topology.nodes.map(n => {
                    const cfg = TYPE_ICONS[n.type] || TYPE_ICONS.other;
                    const online = n.status === "online";
                    return (
                      <g key={n.id} transform={`translate(${n.x}, ${n.y})`}>
                        <circle r="22" fill={online ? cfg.color + "33" : "#1f1f2e"} stroke={online ? cfg.color : "#4b5563"} strokeWidth="2" />
                        <text textAnchor="middle" dy="5" fontSize="10" fontWeight="bold" fill={online ? cfg.color : "#6b7280"}>{cfg.label}</text>
                        <text textAnchor="middle" y="36" fontSize="8" fill="#9ca3af">{n.label}</text>
                        {n.ip && <text textAnchor="middle" y="46" fontSize="7" fill="#6b7280">{n.ip}</text>}
                        <circle r="5" cx="16" cy="-16" fill={online ? "#22c55e" : "#ef4444"} />
                      </g>
                    );
                  })}
                </g>
              </svg>
            </CardContent>
          </Card>

          {/* Legend */}
          <div className="flex gap-4 flex-wrap">
            {Object.entries(TYPE_ICONS).map(([type, cfg]) => (
              <div key={type} className="flex items-center gap-1.5">
                <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold border" style={{ borderColor: cfg.color, color: cfg.color }}>{cfg.label}</div>
                <span className="text-xs text-muted-foreground capitalize">{type}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
