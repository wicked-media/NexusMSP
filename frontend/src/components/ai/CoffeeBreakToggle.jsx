import { useEffect, useState, useRef } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Coffee, Clock, X } from "lucide-react";
import { toast } from "sonner";

const REASONS = [
  { key: "coffee", label: "Coffee", icon: "☕", mins: 15 },
  { key: "lunch", label: "Lunch", icon: "🥪", mins: 45 },
  { key: "meeting", label: "Meeting", icon: "👥", mins: 30 },
  { key: "focus", label: "Deep focus", icon: "🧘", mins: 60 },
  { key: "break", label: "Quick break", icon: "⏸", mins: 10 },
];

/**
 * Coffee Break Mode toggle — small header widget; when active, shows live countdown.
 * Pauses SLA on the tech's assigned tickets via backend.
 */
export function CoffeeBreakToggle() {
  const { token } = useAuth();
  const [status, setStatus] = useState({ active: false });
  const [customMin, setCustomMin] = useState(15);
  const [popOpen, setPopOpen] = useState(false);
  const timerRef = useRef(null);
  const headers = { Authorization: `Bearer ${token}` };

  const load = async () => {
    try {
      const r = await axios.get(`${API}/coffee-break/status`, { headers });
      setStatus(r.data);
    } catch { /* ignore */ }
  };
  useEffect(() => { load(); /* eslint-disable-line */ }, []);

  // Tick remaining_seconds locally
  useEffect(() => {
    if (status.active && status.remaining_seconds > 0) {
      timerRef.current = setInterval(() => {
        setStatus((s) => {
          if (!s.active) return s;
          const r = Math.max(0, (s.remaining_seconds || 0) - 1);
          if (r === 0) { load(); return { ...s, remaining_seconds: 0 }; }
          return { ...s, remaining_seconds: r };
        });
      }, 1000);
      return () => clearInterval(timerRef.current);
    }
  }, [status.active]); // eslint-disable-line

  const start = async (reason, duration_minutes) => {
    try {
      await axios.post(`${API}/coffee-break/start`, { reason, duration_minutes }, { headers });
      toast.success(`Break started — ${duration_minutes}m · SLA paused`);
      setPopOpen(false);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
  };

  const end = async () => {
    try {
      await axios.post(`${API}/coffee-break/end`, {}, { headers });
      toast.success("Welcome back — SLA resumed");
      load();
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
  };

  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  if (status.active) {
    return (
      <Button
        variant="outline" size="sm"
        className="text-amber-400 border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20"
        onClick={end}
        data-testid="coffee-break-end-btn"
        title="SLA is paused — click to resume"
      >
        <Coffee className="w-3 h-3 mr-1.5" />
        <span className="font-mono text-[11px] mr-1.5">{fmt(status.remaining_seconds || 0)}</span>
        <span className="capitalize">{status.reason || "break"}</span>
        <X className="w-3 h-3 ml-1.5 opacity-60" />
      </Button>
    );
  }

  return (
    <Popover open={popOpen} onOpenChange={setPopOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline" size="sm"
          className="text-zinc-300 border-zinc-700 hover:bg-zinc-800"
          data-testid="coffee-break-btn"
        >
          <Coffee className="w-3 h-3 mr-1" />Break
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3">
        <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-2">
          Pause SLA — pick a reason
        </div>
        <div className="space-y-1">
          {REASONS.map((r) => (
            <button
              key={r.key}
              onClick={() => start(r.key, r.mins)}
              className="w-full flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-zinc-800 text-sm"
              data-testid={`coffee-break-preset-${r.key}`}
            >
              <span>{r.icon} {r.label}</span>
              <span className="text-[10px] font-mono text-zinc-500 flex items-center gap-1">
                <Clock className="w-2.5 h-2.5" />{r.mins}m
              </span>
            </button>
          ))}
          <div className="pt-2 mt-2 border-t border-zinc-800 flex items-center gap-2">
            <input
              type="number" min="1" max="240" value={customMin}
              onChange={(e) => setCustomMin(Number(e.target.value))}
              className="w-16 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs font-mono"
              data-testid="coffee-break-custom-mins"
            />
            <Button size="sm" className="flex-1" onClick={() => start("other", customMin)} data-testid="coffee-break-custom-btn">
              Custom
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
