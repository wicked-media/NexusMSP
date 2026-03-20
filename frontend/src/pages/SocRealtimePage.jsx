import { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Shield, Activity, Zap, Globe, AlertTriangle, Eye, RefreshCw, Play, Pause, Filter } from "lucide-react";

const SEVERITY_COLORS = { critical: "#ef4444", high: "#f97316", medium: "#eab308", low: "#22c55e" };
const CATEGORY_ICONS = { authentication: Shield, endpoint: Activity, email: Eye, network: Globe };

export default function SocRealtimePage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState(null);
  const [threatMap, setThreatMap] = useState(null);
  const [tab, setTab] = useState("feed");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filter, setFilter] = useState("all");
  const intervalRef = useRef(null);

  const loadEvents = useCallback(() => {
    axios.get(`${API}/soc-realtime/events`, { headers }).then(r => setData(r.data));
  }, []);

  const loadThreatMap = () => {
    axios.get(`${API}/soc-realtime/threat-map`, { headers }).then(r => setThreatMap(r.data));
  };

  useEffect(() => {
    loadEvents();
    loadThreatMap();
  }, []);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(loadEvents, 10000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh]);

  const generateEvent = async () => {
    await axios.post(`${API}/soc-realtime/generate`, {}, { headers });
    loadEvents();
  };

  if (!data) return <div className="animate-pulse p-8">Loading SOC Feed...</div>;

  const { events, stats } = data;
  const filtered = filter === "all" ? events : events.filter(e => e.severity === filter);

  return (
    <div data-testid="soc-realtime-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Shield size={24} /> Real-time SOC Feed</h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            Live security event stream &middot; {autoRefresh && <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> Auto-refreshing</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <button data-testid="toggle-refresh-btn" onClick={() => setAutoRefresh(!autoRefresh)} className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 ${autoRefresh ? "bg-emerald-600 text-white" : ""}`} style={{ background: autoRefresh ? undefined : "var(--secondary)" }}>
            {autoRefresh ? <><Pause size={14} /> Live</> : <><Play size={14} /> Paused</>}
          </button>
          <button data-testid="generate-event-btn" onClick={generateEvent} className="px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5" style={{ background: "var(--accent)", color: "white" }}>
            <Zap size={14} /> Simulate
          </button>
          <button onClick={loadEvents} className="px-3 py-1.5 rounded-lg text-sm" style={{ background: "var(--secondary)" }}>
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-4">
        {[
          { label: "Events (24h)", value: stats.total_events_24h, color: "#3b82f6" },
          { label: "Critical", value: stats.critical, color: "#ef4444" },
          { label: "High", value: stats.high, color: "#f97316" },
          { label: "Medium", value: stats.medium, color: "#eab308" },
          { label: "Blocked", value: stats.blocked, color: "#10b981" },
          { label: "Investigating", value: stats.investigating, color: "#8b5cf6" },
        ].map((s, i) => (
          <div key={i} className="rounded-lg p-3 border text-center" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="text-xl font-bold" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[10px] text-[var(--muted)]">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4">
        {["feed", "threat-map"].map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 rounded-lg text-sm capitalize ${tab === t ? "text-white" : "text-[var(--muted)]"}`} style={{ background: tab === t ? "var(--accent)" : "var(--secondary)" }}>{t.replace("-", " ")}</button>
        ))}
      </div>

      {tab === "feed" && (
        <>
          {/* Filter bar */}
          <div className="flex gap-1 mb-3">
            {["all", "critical", "high", "medium"].map(f => (
              <button key={f} onClick={() => setFilter(f)} className={`px-2.5 py-1 rounded text-xs capitalize ${filter === f ? "text-white" : ""}`} style={{ background: filter === f ? (SEVERITY_COLORS[f] || "var(--accent)") : "var(--secondary)" }}>{f}</button>
            ))}
          </div>

          {/* Event list */}
          <div className="space-y-1.5" data-testid="event-feed">
            {filtered.map(event => {
              const CatIcon = CATEGORY_ICONS[event.category] || Activity;
              return (
                <div key={event.event_id} data-testid={`event-${event.event_id}`} className="rounded-lg p-3 border flex items-center gap-3 transition-all hover:border-[var(--accent)]" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: SEVERITY_COLORS[event.severity] + "22" }}>
                    <CatIcon size={14} style={{ color: SEVERITY_COLORS[event.severity] }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{event.title}</div>
                    <div className="text-xs text-[var(--muted)] flex items-center gap-2 flex-wrap">
                      <span>{event.device}</span>
                      <span>&middot;</span>
                      <span>{event.client}</span>
                      <span>&middot;</span>
                      <span>{event.source_ip}</span>
                      {event.geo && <><span>&middot;</span><span>{event.geo}</span></>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${event.action === "blocked" ? "bg-emerald-500/20 text-emerald-400" : event.action === "quarantined" ? "bg-yellow-500/20 text-yellow-400" : "bg-purple-500/20 text-purple-400"}`}>{event.action}</span>
                    <span className="px-2 py-0.5 rounded text-[10px]" style={{ background: SEVERITY_COLORS[event.severity] + "22", color: SEVERITY_COLORS[event.severity] }}>{event.severity}</span>
                    <span className="text-[10px] text-[var(--muted)] w-24 text-right">{new Date(event.timestamp).toLocaleTimeString()}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {tab === "threat-map" && threatMap && (
        <div className="space-y-4">
          <div className="rounded-xl p-4 border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium">Attack Sources</h3>
              <span className="text-xs text-[var(--muted)]">Total blocked today: <strong className="text-emerald-400">{threatMap.total_blocked_today}</strong></span>
            </div>
            <div className="space-y-2">
              {threatMap.attack_sources?.sort((a, b) => b.attacks - a.attacks).map((src, i) => {
                const maxAttacks = Math.max(...threatMap.attack_sources.map(s => s.attacks));
                return (
                  <div key={i} data-testid={`threat-source-${src.code}`} className="flex items-center gap-3">
                    <span className="text-sm w-32 truncate">{src.country}</span>
                    <div className="flex-1 h-5 rounded-full overflow-hidden" style={{ background: "var(--secondary)" }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${(src.attacks / maxAttacks) * 100}%`, background: i === 0 ? "#ef4444" : i === 1 ? "#f97316" : "#eab308" }} />
                    </div>
                    <span className="text-sm font-medium w-10 text-right">{src.attacks}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="rounded-xl p-4 border text-center" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <Globe size={48} className="mx-auto mb-2 text-[var(--accent)]" />
            <p className="text-sm text-[var(--muted)]">Top attack type: <strong>{threatMap.top_attack_type}</strong></p>
          </div>
        </div>
      )}
    </div>
  );
}
