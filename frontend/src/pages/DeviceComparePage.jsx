/**
 * DeviceComparePage — side-by-side comparison of 2-4 devices.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, BarChart3, X, Plus } from "lucide-react";

const ROW = (label, fn, fmt = (v) => v ?? "—") => ({ label, fn, fmt });

const ROWS = [
  ROW("Status", d => d.device.status),
  ROW("OS", d => d.device.os || d.device.os_name),
  ROW("Model", d => d.device.model),
  ROW("CPU", d => d.device.processor),
  ROW("RAM", d => d.device.ram_gb ? `${d.device.ram_gb} GB` : "—"),
  ROW("Disk", d => d.device.storage_total_gb ? `${d.device.storage_total_gb} GB` : "—"),
  ROW("Health Score", d => d.health_score, v => v != null ? `${v}/100` : "—"),
  ROW("Lifecycle", d => d.lifecycle?.label),
  ROW("Failure Risk", d => `${d.failure_risk?.risk_pct}% (${d.failure_risk?.verdict})`),
  ROW("Tickets (all-time)", d => d.ticket_count),
  ROW("CPU Load", d => d.device.cpu_load, v => v != null ? `${Math.round(v)}%` : "—"),
  ROW("Memory Use", d => d.device.memory_pct, v => v != null ? `${Math.round(v)}%` : "—"),
  ROW("Disk Use", d => d.device.disk_pct, v => v != null ? `${Math.round(v)}%` : "—"),
  ROW("Patches Pending", d => d.device.patches_pending),
  ROW("Checks Failing", d => d.device.checks_failing),
  ROW("Last Seen", d => d.device.last_seen),
];

export default function DeviceComparePage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [params, setParams] = useSearchParams();
  const initialIds = (params.get("ids") || "").split(",").filter(Boolean);
  const [ids, setIds] = useState(initialIds.slice(0, 4));
  const [allDevices, setAllDevices] = useState([]);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    axios.get(`${API}/devices`, { headers }).then(r => setAllDevices(r.data || [])).catch(() => {});
  }, [headers]);

  const load = useCallback(async () => {
    if (ids.length === 0) { setData([]); return; }
    setLoading(true);
    try {
      const r = await axios.post(`${API}/devices/compare`, { device_ids: ids }, { headers });
      setData(r.data.devices || []);
    } catch { setData([]); }
    finally { setLoading(false); }
  }, [ids, headers]);

  useEffect(() => { load(); }, [load]);

  const setIdAt = (idx, val) => {
    const next = [...ids];
    next[idx] = val;
    setIds(next.filter(Boolean));
    setParams({ ids: next.filter(Boolean).join(",") });
  };

  const removeAt = (idx) => {
    const next = ids.filter((_, i) => i !== idx);
    setIds(next);
    setParams(next.length ? { ids: next.join(",") } : {});
  };

  const slots = [...Array(Math.min(4, ids.length + 1))].map((_, i) => ids[i] || "");

  return (
    <div className="space-y-5 p-6" data-testid="device-compare-page">
      <div className="rounded-2xl border border-cyan-500/20 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.15),transparent_35%),radial-gradient(circle_at_top_left,rgba(16,185,129,0.08),transparent_28%),linear-gradient(135deg,rgba(17,19,24,0.98),rgba(10,12,17,0.98))] p-5 shadow-[0_22px_65px_rgba(0,0,0,0.20)] md:p-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-300">Asset intelligence</p>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight"><BarChart3 className="h-6 w-6 text-cyan-200" />Compare managed assets</h1>
        <p className="text-sm text-zinc-500">Side-by-side health, specs, and tickets — pick up to 4 devices.</p>
      </div>

      {/* Slot pickers */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {slots.map((curId, idx) => (
          <Card key={idx} className="border-cyan-500/15 bg-cyan-500/[0.025]">
            <CardContent className="p-3"><p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-zinc-500">Comparison slot {idx + 1}</p><div className="flex items-center gap-2">
              <Select value={curId} onValueChange={(v) => setIdAt(idx, v)}>
                <SelectTrigger className="h-8 text-xs flex-1" data-testid={`compare-slot-${idx}`}>
                  <SelectValue placeholder={`Device ${idx + 1}`} />
                </SelectTrigger>
                <SelectContent className="max-h-[400px]">
                  {allDevices.map(d => <SelectItem key={d.id} value={d.id}>{d.name} · {d.client_name}</SelectItem>)}
                </SelectContent>
              </Select>
              {curId && (
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-rose-400" onClick={() => removeAt(idx)} data-testid={`compare-remove-${idx}`}>
                  <X className="w-4 h-4" />
                </Button>
              )}
            </div></CardContent>
          </Card>
        ))}
      </div>

      {/* Compare table */}
      {ids.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-zinc-500">Pick devices from the slots above to compare.</CardContent></Card>
      ) : loading ? (
        <Card><CardContent className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-zinc-500" /></CardContent></Card>
      ) : (
        <Card className="overflow-hidden border-cyan-500/15">
          <CardHeader className="border-b border-white/[0.06] bg-cyan-500/[0.025] pb-3"><CardTitle className="text-base">Comparison record</CardTitle><p className="text-xs text-zinc-500">Live asset data and derived health signals.</p></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-zinc-800">
                    <th className="text-left p-2 text-[10px] uppercase tracking-widest font-mono text-zinc-500">Attribute</th>
                    {data.map((d, i) => (
                      <th key={i} className="text-left p-2 min-w-[180px]">
                        <div className="font-medium">{d.device.name}</div>
                        <div className="text-[10px] text-zinc-500 font-mono">{d.device.client_name}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((row, i) => {
                    const values = data.map(d => row.fn(d));
                    return (
                      <tr key={i} className="border-b border-zinc-900 hover:bg-zinc-900/30" data-testid={`compare-row-${row.label}`}>
                        <td className="p-2 text-[10px] uppercase tracking-widest font-mono text-zinc-500">{row.label}</td>
                        {data.map((d, j) => (
                          <td key={j} className="p-2 text-zinc-200">{row.fmt(values[j])}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Commentary row */}
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {data.map((d, i) => (
                <div key={i} className="px-3 py-2 rounded border border-violet-500/20 bg-violet-500/5">
                  <div className="text-[10px] uppercase tracking-widest font-mono text-violet-300 mb-1">AI Verdict — {d.device.name}</div>
                  <p className="text-xs text-zinc-200">{d.commentary}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
