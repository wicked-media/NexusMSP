/* RiskHeatmapCanvas.jsx — 2D matrix (Client × Type) of aggregate health. */
import { useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Loader2 } from "lucide-react";

const COLOR_MAP = {
  emerald: "bg-emerald-500/40 hover:bg-emerald-500/60 border-emerald-500/40",
  amber: "bg-amber-500/40 hover:bg-amber-500/60 border-amber-500/40",
  red: "bg-red-500/40 hover:bg-red-500/60 border-red-500/40",
  empty: "bg-zinc-800/40 border-zinc-700/40 hover:bg-zinc-700/30",
};

export default function RiskHeatmapCanvas({ onCellClick }) {
  const { token } = useAuth();
  const [data, setData] = useState({ cells: [], clients: [], types: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    axios.get(`${API}/devices/risk-heatmap`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (live) setData(r.data || { cells: [], clients: [], types: [] }); })
      .catch(() => { if (live) setData({ cells: [], clients: [], types: [] }); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [token]);

  if (loading) return <div className="flex items-center justify-center py-12 gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Computing risk matrix…</div>;
  if (data.clients.length === 0) return <div className="py-12 text-center text-muted-foreground text-sm">No devices to map.</div>;

  const cellMap = {};
  data.cells.forEach(c => { cellMap[`${c.client}|${c.type}`] = c; });

  return (
    <div className="overflow-x-auto" data-testid="risk-heatmap-canvas">
      <table className="border-separate border-spacing-1">
        <thead>
          <tr>
            <th className="text-[10px] text-zinc-500 text-left pl-1 pr-3">Client \ Type</th>
            {data.types.map(t => (
              <th key={t} className="text-[10px] text-zinc-400 uppercase tracking-wider px-1 capitalize">{t}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.clients.map(c => (
            <tr key={c}>
              <td className="text-[11px] text-zinc-200 pr-3 truncate max-w-[160px]">{c}</td>
              {data.types.map(t => {
                const cell = cellMap[`${c}|${t}`];
                const color = cell ? COLOR_MAP[cell.color] : COLOR_MAP.empty;
                return (
                  <td key={t} className="p-0">
                    <button
                      onClick={() => cell && onCellClick && onCellClick({ client: c, type: t })}
                      className={`w-14 h-12 rounded border ${color} flex flex-col items-center justify-center transition-all hover:scale-105 ${cell ? "cursor-pointer" : "cursor-default"}`}
                      title={cell ? `${cell.count} devices · health ${cell.avg_health} · ${cell.offline} offline` : "No devices"}
                      data-testid={`heatmap-cell-${c}-${t}`}
                      disabled={!cell}
                    >
                      {cell && (
                        <>
                          <span className="text-sm font-mono font-semibold text-zinc-100">{cell.count}</span>
                          <span className="text-[8px] text-zinc-300">{cell.avg_health}%</span>
                        </>
                      )}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-3 mt-3 text-[10px] text-zinc-500">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500/60" />Healthy ≥80</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-500/60" />Watch 60-79</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500/60" />Critical &lt;60</span>
      </div>
    </div>
  );
}
