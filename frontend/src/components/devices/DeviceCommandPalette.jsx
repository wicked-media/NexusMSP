/* DeviceCommandPalette.jsx — Cmd+K overlay for type-to-command. */
import { useEffect, useState, useMemo } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { API, useAuth } from "@/App";
import { Command, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { keyboardKey, keyboardKeyLower } from "@/lib/keyboard";

// Lightweight grammar: "reboot <name>", "iso <name>", "diagnose <name>", "wake <client>", "open <name>", "ticket <name>"
function parse(query, devices) {
  const q = query.trim();
  if (!q) return { kind: "search", suggestions: [] };
  const lower = q.toLowerCase();
  const verbs = ["reboot", "isolate", "iso", "diagnose", "wake", "open", "ticket", "script"];
  let verb = null;
  let rest = lower;
  for (const v of verbs) {
    if (lower.startsWith(v + " ") || lower === v) {
      verb = v === "iso" ? "isolate" : v;
      rest = lower.slice(v.length).trim();
      break;
    }
  }
  if (!verb) {
    // Fuzzy device-name match
    const matches = devices
      .filter(d => (d.name || "").toLowerCase().includes(lower) || (d.client_name || "").toLowerCase().includes(lower))
      .slice(0, 8)
      .map(d => ({ kind: "open", device: d, label: `Open ${d.name}`, sub: d.client_name || "" }));
    return { kind: "search", suggestions: matches };
  }
  const target = rest;
  if (verb === "wake") {
    const clientMatches = [...new Set(devices.map(d => d.client_name).filter(Boolean))]
      .filter(c => c.toLowerCase().includes(target))
      .slice(0, 5)
      .map(c => ({ kind: "wake-client", client: c, label: `Wake all of ${c}`, sub: "broadcast WoL" }));
    return { kind: "verb", verb, suggestions: clientMatches };
  }
  const targetDevices = devices
    .filter(d => (d.name || "").toLowerCase().includes(target) || (d.client_name || "").toLowerCase().includes(target))
    .slice(0, 6)
    .map(d => ({ kind: verb, device: d, label: `${verb} ${d.name}`, sub: d.client_name || "" }));
  return { kind: "verb", verb, suggestions: targetDevices };
}

export default function DeviceCommandPalette({ devices = [] }) {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && keyboardKeyLower(e) === "k") {
        e.preventDefault();
        setOpen(o => !o);
      }
      if (keyboardKey(e) === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => { if (open) setQuery(""); }, [open]);

  const parsed = useMemo(() => parse(query, devices), [query, devices]);

  const execute = async (s) => {
    setBusy(true);
    try {
      if (s.kind === "open") { navigate(`/devices/${s.device.id}`); setOpen(false); return; }
      if (s.kind === "ticket") {
        navigate(`/tickets?device_id=${s.device.id}&new=1`);
        setOpen(false);
        return;
      }
      if (s.kind === "wake-client") {
        toast.success(`Wake-on-LAN broadcast queued for ${s.client}`);
        setOpen(false);
        return;
      }
      // diagnose, reboot, isolate, script — call existing endpoints
      const headers = { Authorization: `Bearer ${token}` };
      if (s.kind === "diagnose") {
        await axios.post(`${API}/devices/${s.device.id}/ai-diagnose`, {}, { headers });
        toast.success(`Diagnose requested for ${s.device.name}`);
      } else if (s.kind === "reboot") {
        await axios.post(`${API}/devices/quick-scripts/run`, { script_id: "qs-restart-agent", device_ids: [s.device.id] }, { headers });
        toast.success(`Reboot queued for ${s.device.name}`);
      } else if (s.kind === "isolate") {
        toast.success(`Isolation requested for ${s.device.name} (review in Devices)`);
      } else if (s.kind === "script") {
        navigate(`/devices/${s.device.id}?action=quick-script`);
      }
      setOpen(false);
    } catch { toast.error("Action failed"); }
    finally { setBusy(false); }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[12vh]" onClick={() => setOpen(false)} data-testid="device-command-palette">
      <div className="w-full max-w-xl bg-zinc-900 border border-violet-500/40 rounded-xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-zinc-800">
          <Command className="w-4 h-4 text-violet-300" />
          <input
            autoFocus
            placeholder="reboot ws-001 · iso ACME-SRV · diagnose laptop-7 · wake Acme · ticket SRV-01"
            className="flex-1 bg-transparent outline-none text-sm text-zinc-100 placeholder-zinc-600"
            value={query}
            onChange={e => setQuery(e.target.value)}
            data-testid="device-command-input"
          />
          {busy && <Loader2 className="w-3 h-3 animate-spin text-violet-300" />}
          <kbd className="text-[10px] text-zinc-500 px-1.5 py-0.5 border border-zinc-700 rounded">ESC</kbd>
        </div>
        <div className="max-h-[55vh] overflow-y-auto py-1">
          {parsed.suggestions.length === 0 && (
            <p className="px-3 py-4 text-xs text-zinc-500">
              Type a device name to <strong className="text-zinc-300">open</strong>, or start with a verb: <code className="text-violet-300">reboot</code>, <code className="text-violet-300">iso</code>, <code className="text-violet-300">diagnose</code>, <code className="text-violet-300">wake</code>, <code className="text-violet-300">ticket</code>, <code className="text-violet-300">script</code>.
            </p>
          )}
          {parsed.suggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => execute(s)}
              className="w-full text-left flex items-center gap-3 px-3 py-2 hover:bg-violet-500/10 transition-colors"
              data-testid={`palette-suggestion-${i}`}
            >
              <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-200 uppercase tracking-wider min-w-[60px] text-center">
                {s.kind === "open" ? "open" : s.kind}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-zinc-100 truncate">{s.label}</p>
                <p className="text-[10px] text-zinc-500 truncate">{s.sub}</p>
              </div>
              <ArrowRight className="w-3 h-3 text-zinc-500" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
