/* LifecycleTimeline.jsx — devices on a horizontal age axis with EOL markers. */
import { useEffect, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { API, useAuth } from "@/App";
import { Loader2 } from "lucide-react";

const STATUS_COLOR = {
  ok: "bg-emerald-500",
  "refresh-soon": "bg-sky-400",
  "due-now": "bg-amber-400",
  overdue: "bg-red-500",
};

export default function LifecycleTimeline() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState({ devices: [], summary: {} });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    axios.get(`${API}/devices/lifecycle`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (live) setData(r.data || { devices: [], summary: {} }); })
      .catch(() => { if (live) setData({ devices: [], summary: {} }); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [token]);

  if (loading) return <div className="flex items-center justify-center py-12 gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Computing lifecycle…</div>;
  if (data.devices.length === 0) return <div className="py-12 text-center text-muted-foreground text-sm">No devices to plot.</div>;

  const maxYears = Math.max(7, ...data.devices.map(d => d.age_years));
  const buckets = [0, 1, 2, 3, 4, 5, 6, 7].filter(y => y <= maxYears).map(y => ({
    year: y,
    devices: data.devices.filter(d => Math.floor(d.age_years) === y),
  }));

  return (
    <div className="space-y-4" data-testid="lifecycle-timeline">
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: "Overdue", count: data.summary.overdue || 0, color: "border-red-500/40 bg-red-500/10 text-red-300" },
          { label: "Due Now", count: data.summary.due_now || 0, color: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
          { label: "Refresh Soon", count: data.summary.refresh_soon || 0, color: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
          { label: "OK", count: data.summary.ok || 0, color: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
        ].map(s => (
          <div key={s.label} className={`text-center p-2 rounded border ${s.color}`} data-testid={`lifecycle-summary-${s.label.toLowerCase().replace(' ', '-')}`}>
            <p className="text-lg font-mono font-bold">{s.count}</p>
            <p className="text-[10px] uppercase tracking-wider">{s.label}</p>
          </div>
        ))}
      </div>
      <div className="relative">
        <div className="flex border-b border-zinc-800 pb-1 mb-2">
          {buckets.map(b => (
            <div key={b.year} className="flex-1 text-center text-[10px] text-zinc-500">{b.year}y</div>
          ))}
        </div>
        <div className="flex gap-1">
          {buckets.map(b => (
            <div key={b.year} className="flex-1 min-h-[80px] bg-zinc-900/30 border border-zinc-800/40 rounded p-1 flex flex-wrap gap-0.5 items-start" data-testid={`lifecycle-bucket-${b.year}`}>
              {b.devices.slice(0, 30).map(d => (
                <button
                  key={d.id}
                  title={`${d.name} · ${d.age_years}y · ${d.days_to_eol > 0 ? `${d.days_to_eol}d to EOL` : `${Math.abs(d.days_to_eol)}d overdue`}`}
                  onClick={() => navigate(`/devices/${d.id}`)}
                  className={`w-2 h-4 rounded-sm ${STATUS_COLOR[d.status] || "bg-zinc-600"} hover:scale-125 transition-transform`}
                  data-testid={`lifecycle-pip-${d.id}`}
                />
              ))}
              {b.devices.length > 30 && (
                <span className="text-[9px] text-zinc-500">+{b.devices.length - 30}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
