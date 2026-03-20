import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Smartphone, Clock, CheckCircle, AlertTriangle, Bell, Timer, ChevronRight, Plus, Star, MapPin, Phone, Ticket } from "lucide-react";

const PRIORITY_COLORS = { critical: "#ef4444", high: "#f97316", medium: "#eab308", low: "#22c55e" };

export default function MobileTechPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [dayData, setDayData] = useState(null);
  const [notifs, setNotifs] = useState(null);
  const [tab, setTab] = useState("my-day");
  const [queue, setQueue] = useState(null);

  useEffect(() => {
    axios.get(`${API}/mobile-tech/my-day`, { headers }).then(r => setDayData(r.data));
    axios.get(`${API}/mobile-tech/notifications`, { headers }).then(r => setNotifs(r.data));
  }, []);

  const loadQueue = () => {
    axios.get(`${API}/mobile-tech/queue`, { headers }).then(r => setQueue(r.data));
  };

  useEffect(() => { if (tab === "queue") loadQueue(); }, [tab]);

  if (!dayData) return <div className="animate-pulse p-8">Loading...</div>;

  return (
    <div data-testid="mobile-tech-page" className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Smartphone size={24} /> Mobile Tech</h1>
          <p className="text-sm text-[var(--muted)]">{dayData.date} &middot; {dayData.tech_name}</p>
        </div>
        <div className="relative">
          <Bell size={20} />
          {notifs && notifs.unread_count > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center">{notifs.unread_count}</span>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        {[
          { label: "Assigned", value: dayData.stats.tickets_today, color: "#3b82f6" },
          { label: "Completed", value: dayData.stats.completed_today, color: "#10b981" },
          { label: "Avg Response", value: `${dayData.stats.avg_response_min}m`, color: "#f97316" },
          { label: "CSAT", value: dayData.stats.satisfaction, icon: Star, color: "#eab308" },
        ].map((s, i) => (
          <div key={i} className="rounded-xl p-3 text-center border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="text-lg font-bold" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[10px] text-[var(--muted)]">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 overflow-x-auto">
        {[
          { id: "my-day", label: "My Day" },
          { id: "schedule", label: "Schedule" },
          { id: "queue", label: "Queue" },
          { id: "notifications", label: "Alerts" },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap ${tab === t.id ? "text-white" : "text-[var(--muted)]"}`} style={{ background: tab === t.id ? "var(--accent)" : "var(--secondary)" }}>{t.label}</button>
        ))}
      </div>

      {/* Quick Actions */}
      {tab === "my-day" && (
        <>
          <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
            {(dayData.quick_actions || []).map((a, i) => (
              <button key={i} data-testid={`quick-action-${i}`} className="px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap" style={{ background: "var(--accent)", color: "white" }}>{a}</button>
            ))}
          </div>

          <h3 className="text-sm font-medium mb-2 text-[var(--muted)]">Assigned Tickets</h3>
          <div className="space-y-2">
            {(dayData.assigned_tickets || []).map((t, i) => (
              <div key={i} data-testid={`ticket-${i}`} className="rounded-xl p-3 border flex items-center gap-3 transition-colors hover:border-[var(--accent)]" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <div className="w-2 h-8 rounded-full" style={{ background: PRIORITY_COLORS[t.priority] || "#6b7280" }} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{t.title}</div>
                  <div className="text-xs text-[var(--muted)] flex items-center gap-2">
                    <span>{t.client}</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: "var(--secondary)" }}>{t.priority}</span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-xs font-medium" style={{ color: PRIORITY_COLORS[t.priority] }}>{t.sla_remaining}</div>
                  <div className="text-[10px] text-[var(--muted)]">{t.status}</div>
                </div>
                <ChevronRight size={14} className="text-[var(--muted)]" />
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "schedule" && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium mb-2 text-[var(--muted)]">Today's Schedule</h3>
          {(dayData.schedule || []).map((s, i) => (
            <div key={i} data-testid={`schedule-${i}`} className="rounded-xl p-3 border flex items-center gap-3" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <div className="text-sm font-mono font-medium w-14 text-center" style={{ color: "var(--accent)" }}>{s.time}</div>
              <div className="w-px h-10 bg-[var(--border)]" />
              <div className="flex-1">
                <div className="text-sm font-medium">{s.title}</div>
                <div className="text-xs text-[var(--muted)] flex items-center gap-1"><MapPin size={10} /> {s.location}</div>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] capitalize" style={{ background: PRIORITY_COLORS[s.priority] + "22", color: PRIORITY_COLORS[s.priority] }}>{s.type}</span>
            </div>
          ))}
        </div>
      )}

      {tab === "queue" && queue && (
        <div className="space-y-2">
          {(queue.queue || []).map((t, i) => (
            <div key={i} className="rounded-xl p-3 border flex items-center gap-3" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <div className="w-2 h-8 rounded-full" style={{ background: PRIORITY_COLORS[t.priority] }} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{t.title}</div>
                <div className="text-xs text-[var(--muted)]">{t.client} &middot; {t.status}</div>
              </div>
              <span className="text-xs" style={{ color: PRIORITY_COLORS[t.priority] }}>{t.sla_remaining}</span>
            </div>
          ))}
        </div>
      )}

      {tab === "notifications" && notifs && (
        <div className="space-y-2">
          {(notifs.notifications || []).map(n => (
            <div key={n.id} data-testid={`notif-${n.id}`} className={`rounded-xl p-3 border flex items-start gap-3 ${!n.read ? "border-l-2 border-l-[var(--accent)]" : ""}`} style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${n.type === "escalation" ? "bg-red-500/20" : n.type === "assignment" ? "bg-blue-500/20" : "bg-gray-500/20"}`}>
                {n.type === "escalation" ? <AlertTriangle size={14} className="text-red-400" /> : n.type === "assignment" ? <Ticket size={14} className="text-blue-400" /> : <Bell size={14} className="text-gray-400" />}
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium">{n.title}</div>
                <div className="text-xs text-[var(--muted)]">{n.message}</div>
                <div className="text-[10px] text-[var(--muted)] mt-1">{n.time}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
