import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Network, Server, Monitor, Laptop, Wifi, Loader2, RefreshCw, Globe, Printer, HardDrive, Shield, Users, AlertTriangle } from "lucide-react";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import HeroTile from "@/components/HeroTile";

const DEVICE_ICONS = { server: Server, workstation: Monitor, laptop: Laptop, router: Globe, switch: Network, firewall: Shield, printer: Printer, other: HardDrive };
const STATUS_COLORS = { online: "#10b981", offline: "#ef4444", warning: "#f59e0b", unknown: "#6b7280" };

function TopologyCanvas({ topology }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !topology?.nodes?.length) return;
    const ctx = canvas.getContext("2d");
    canvas.width = canvas.offsetWidth;
    canvas.height = Math.max(canvas.offsetHeight, 500);
    const W = canvas.width, H = canvas.height;

    // Center nodes
    const offsetX = W / 2;
    const offsetY = 80;

    ctx.clearRect(0, 0, W, H);

    // Draw edges
    topology.edges?.forEach(e => {
      const src = topology.nodes.find(n => n.id === e.source);
      const tgt = topology.nodes.find(n => n.id === e.target);
      if (!src || !tgt) return;
      ctx.beginPath();
      ctx.moveTo(src.x + offsetX, src.y + offsetY);
      ctx.lineTo(tgt.x + offsetX, tgt.y + offsetY);
      ctx.strokeStyle = e.type === "uplink" ? "rgba(59,130,246,0.4)" : "rgba(100,100,100,0.25)";
      ctx.lineWidth = e.type === "uplink" ? 2 : 1;
      ctx.stroke();
    });

    // Draw nodes
    topology.nodes.forEach(n => {
      const x = n.x + offsetX;
      const y = n.y + offsetY;
      const color = STATUS_COLORS[n.status] || STATUS_COLORS.unknown;

      // Glow
      ctx.beginPath();
      ctx.arc(x, y, 24, 0, Math.PI * 2);
      ctx.fillStyle = color + "15";
      ctx.fill();

      // Circle
      ctx.beginPath();
      ctx.arc(x, y, 18, 0, Math.PI * 2);
      ctx.fillStyle = "#1a1a2e";
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Icon text
      const icon = n.type?.[0]?.toUpperCase() || "?";
      ctx.fillStyle = color;
      ctx.font = "bold 12px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(icon, x, y);

      // Label
      ctx.fillStyle = "#e5e7eb";
      ctx.font = "11px system-ui";
      ctx.fillText(n.label, x, y + 30);

      // IP
      if (n.ip) {
        ctx.fillStyle = "#6b7280";
        ctx.font = "9px monospace";
        ctx.fillText(n.ip, x, y + 42);
      }

      // Status dot
      ctx.beginPath();
      ctx.arc(x + 14, y - 14, 4, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    });
  }, [topology]);

  return <canvas ref={canvasRef} className="w-full h-[500px] rounded-lg" />;
}

export default function TopologyPage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState("");
  const [topology, setTopology] = useState(null);
  const [loading, setLoading] = useState(true);
  const [topoLoading, setTopoLoading] = useState(false);

  const loadClients = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/topology/all`, { headers });
      setClients(res.data);
      setSelectedClient(current => current || res.data[0]?.client_id || "");
    } catch { toast.error("Failed to load topology data"); }
    finally { setLoading(false); }
  }, [headers]);

  const loadTopology = useCallback(async (clientId) => {
    if (!clientId) return;
    setTopoLoading(true);
    try {
      const res = await axios.get(`${API}/topology/${clientId}`, { headers });
      setTopology(res.data);
    } catch { toast.error("Failed to load topology"); }
    finally { setTopoLoading(false); }
  }, [headers]);

  useEffect(() => { loadClients(); }, [loadClients]);
  useEffect(() => { loadTopology(selectedClient); }, [selectedClient, loadTopology]);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const selectedClientSummary = clients.find(client => client.client_id === selectedClient);
  const topologyStats = topology?.stats || {};

  return (
    <div className="space-y-6" data-testid="topology-page">
      <OperationalPageHeader
        eyebrow="Network workspace · topology"
        title="Network topology"
        description="Visual maps of each client network, with a current device health snapshot for fast triage and documentation."
        icon={Network}
        tone="sky"
        actions={(
          <>
            <Select value={selectedClient} onValueChange={setSelectedClient}>
              <SelectTrigger className="w-[280px]" data-testid="client-select"><SelectValue placeholder="Select client..." /></SelectTrigger>
              <SelectContent>{clients.map(c => <SelectItem key={c.client_id} value={c.client_id}>{c.client_name} ({c.device_count} devices)</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={async () => { await loadClients(); await loadTopology(selectedClient); }} disabled={loading || topoLoading} data-testid="topology-refresh-btn">
              {topoLoading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}Refresh
            </Button>
          </>
        )}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <HeroTile label="Client networks" value={clients.length} icon={Users} glow="sky" subtitle="Available topology maps" />
        <HeroTile label="Selected devices" value={topologyStats.total_devices ?? selectedClientSummary?.device_count ?? 0} icon={Monitor} glow="indigo" subtitle={topology?.client_name || "Select a client"} />
        <HeroTile label="Online" value={topologyStats.online ?? 0} icon={Wifi} glow="emerald" subtitle="Nodes reporting normally" />
        <HeroTile label="Offline" value={topologyStats.offline ?? 0} icon={AlertTriangle} glow={(topologyStats.offline ?? 0) > 0 ? "rose" : "zinc"} subtitle={(topologyStats.offline ?? 0) > 0 ? "Review device connectivity" : "No offline nodes"} />
        <HeroTile label="Topology health" value={selectedClientSummary?.health_pct ?? 0} suffix="%" icon={Network} glow="violet" subtitle="Selected client health" />
      </div>

      {/* Client Cards */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {clients.slice(0, 10).map(c => (
          <Card key={c.client_id}
            className={`cursor-pointer transition-all hover:border-primary/30 ${selectedClient === c.client_id ? "border-primary ring-1 ring-primary" : ""}`}
            onClick={() => setSelectedClient(c.client_id)}>
            <CardContent className="p-3">
              <p className="font-medium text-sm truncate">{c.client_name}</p>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-muted-foreground">{c.device_count} devices</span>
                <span className={`text-xs font-bold ${c.health_pct >= 90 ? "text-emerald-400" : c.health_pct >= 70 ? "text-amber-400" : "text-red-400"}`}>{c.health_pct}%</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Topology Map */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            <span className="flex items-center gap-2"><Network className="w-4 h-4" />{topology?.client_name || "Select a client"}</span>
            {topology?.stats && (
              <div className="flex gap-3 text-[10px]">
                <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-400" />{topology.stats.online} Online</span>
                <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-red-400" />{topology.stats.offline} Offline</span>
                <span className="text-muted-foreground">{topology.stats.total_devices} total</span>
              </div>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {topoLoading ? (
            <div className="flex items-center justify-center h-[500px]"><Loader2 className="w-8 h-8 animate-spin" /></div>
          ) : topology?.nodes?.length > 0 ? (
            <TopologyCanvas topology={topology} />
          ) : (
            <div className="flex items-center justify-center h-[500px] text-muted-foreground"><Network className="w-12 h-12 opacity-20 mr-3" /><span>No devices found for this client</span></div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
