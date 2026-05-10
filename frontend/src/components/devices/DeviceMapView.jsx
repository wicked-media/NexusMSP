/**
 * DeviceMapView — geographic site map of devices clustered by client.
 * Pure SVG (no extra deps). Pulsing heat-spots show outage severity.
 */
import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Globe2, Wifi, WifiOff } from "lucide-react";
import { useNavigate } from "react-router-dom";

const SEV_COLOR = { ok: "#10b981", warning: "#f59e0b", critical: "#f43f5e" };

export default function DeviceMapView({ sites }) {
  const navigate = useNavigate();
  // Project lat/lng to a 1000x500 SVG using simple equirectangular mapping
  const points = useMemo(() => {
    if (!sites || sites.length === 0) return [];
    const lats = sites.map(s => s.lat).filter(v => v != null);
    const lngs = sites.map(s => s.lng).filter(v => v != null);
    if (lats.length === 0) return [];
    const padLat = 2, padLng = 3;
    const minLat = Math.min(...lats) - padLat, maxLat = Math.max(...lats) + padLat;
    const minLng = Math.min(...lngs) - padLng, maxLng = Math.max(...lngs) + padLng;
    const W = 1000, H = 500;
    return sites.map(s => ({
      ...s,
      x: ((s.lng - minLng) / Math.max(0.0001, (maxLng - minLng))) * W,
      y: H - ((s.lat - minLat) / Math.max(0.0001, (maxLat - minLat))) * H,
    }));
  }, [sites]);

  return (
    <Card className="border-violet-500/20 bg-gradient-to-br from-card via-card to-violet-500/[0.02]" data-testid="device-map-view">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2"><Globe2 className="w-4 h-4 text-violet-400" />Site Map</CardTitle>
        <div className="flex items-center gap-3 text-[10px] font-mono text-zinc-400">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400" />OK</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" />Warning</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-400 animate-pulse" />Critical</span>
        </div>
      </CardHeader>
      <CardContent>
        {points.length === 0 ? (
          <p className="text-sm text-zinc-500 text-center py-8">No site data — link devices to clients with addresses.</p>
        ) : (
          <div className="relative rounded-md border border-zinc-800 bg-zinc-950/40 overflow-hidden">
            <svg viewBox="0 0 1000 500" className="w-full h-[420px]" preserveAspectRatio="xMidYMid meet">
              <defs>
                <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
                  <path d="M 50 0 L 0 0 0 50" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="0.5" />
                </pattern>
                <radialGradient id="glow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="rgba(139,92,246,0.4)" />
                  <stop offset="100%" stopColor="rgba(139,92,246,0)" />
                </radialGradient>
              </defs>
              <rect width="1000" height="500" fill="url(#grid)" />
              {points.map((p) => {
                const color = SEV_COLOR[p.severity] || SEV_COLOR.ok;
                const r = 4 + Math.min(15, p.total / 4);
                return (
                  <g key={p.client_id} className="cursor-pointer" onClick={() => navigate(`/clients/${p.client_id}`)}>
                    {/* Pulse ring for critical/warning */}
                    {p.severity !== "ok" && (
                      <circle cx={p.x} cy={p.y} r={r + 8} fill={color} opacity="0.2">
                        <animate attributeName="r" values={`${r};${r + 18};${r}`} dur="2s" repeatCount="indefinite" />
                        <animate attributeName="opacity" values="0.4;0;0.4" dur="2s" repeatCount="indefinite" />
                      </circle>
                    )}
                    <circle cx={p.x} cy={p.y} r={r} fill={color} stroke="rgba(255,255,255,0.4)" strokeWidth="1" />
                    <text x={p.x} y={p.y - r - 4} textAnchor="middle" fill="rgba(255,255,255,0.9)" fontSize="11" fontFamily="monospace">{p.client_name}</text>
                    <text x={p.x} y={p.y + r + 12} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="9" fontFamily="monospace">{p.online}/{p.total}</text>
                  </g>
                );
              })}
            </svg>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
