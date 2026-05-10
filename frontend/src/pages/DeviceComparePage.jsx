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
    <div className="p-6 space-y-4" data-testid="device-compare-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <BarChart3 className="w-6 h-6 text-violet-400" />Compare Devices
        </h1>
        <p className="text-sm text-zinc-500">Side-by-side health, specs, and tickets — pick up to 4 devices.</p>
      </div>

      {/* Slot pickers */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {slots.map((curId, idx) => (
          <Card key={idx} className="border-zinc-800">
            <CardContent className="p-3 flex items-center gap-2">
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
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Compare table */}
      {ids.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-zinc-500">Pick devices from the slots above to compare.</CardContent></Card>
      ) : loading ? (
        <Card><CardContent className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-zinc-500" /></CardContent></Card>
      ) : (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Comparison</CardTitle></CardHeader>
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
