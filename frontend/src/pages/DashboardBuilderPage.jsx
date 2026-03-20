import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Plus, GripVertical, Trash2, Save, Layout, BarChart3, PieChart, Activity, Settings, Copy } from "lucide-react";

const WIDGET_ICONS = { stat_card: BarChart3, line_chart: Activity, bar_chart: BarChart3, pie_chart: PieChart, ticket_feed: Activity, alert_feed: Activity, device_map: Layout, sla_gauge: BarChart3, client_table: Layout, tech_status: Layout, revenue_trend: Activity, patch_status: BarChart3 };

function StatWidget({ widget }) {
  const c = widget.config || {};
  return (
    <div className="flex flex-col justify-between h-full">
      <span className="text-xs text-[var(--muted)] uppercase tracking-wider">{widget.title}</span>
      <div className="text-3xl font-bold" style={{ color: c.color || "#3b82f6" }}>{c.prefix}{typeof c.value === "number" && c.value > 999 ? c.value.toLocaleString() : c.value}{c.suffix}</div>
      {c.change !== undefined && <span className={`text-xs ${c.change >= 0 ? "text-emerald-400" : "text-red-400"}`}>{c.change >= 0 ? "+" : ""}{c.change}</span>}
    </div>
  );
}

function ChartWidget({ widget }) {
  const data = widget.config?.data || [];
  const maxVal = Math.max(...data.map(d => Object.values(d).find(v => typeof v === "number") || 0), 1);
  return (
    <div className="flex flex-col h-full">
      <span className="text-xs text-[var(--muted)] mb-2">{widget.title}</span>
      <div className="flex items-end gap-1 flex-1 min-h-0">
        {data.map((d, i) => {
          const val = Object.values(d).find(v => typeof v === "number") || 0;
          return (
            <div key={i} className="flex flex-col items-center flex-1">
              <div className="w-full rounded-t" style={{ height: `${(val / maxVal) * 100}%`, minHeight: 4, background: "var(--accent)" }} />
              <span className="text-[9px] text-[var(--muted)] mt-1 truncate w-full text-center">{Object.values(d).find(v => typeof v === "string")}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PieWidget({ widget }) {
  const data = widget.config?.data || [];
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="flex flex-col h-full">
      <span className="text-xs text-[var(--muted)] mb-2">{widget.title}</span>
      <div className="flex-1 flex items-center justify-center">
        <div className="relative w-24 h-24">
          <svg viewBox="0 0 36 36" className="w-full h-full">
            {data.reduce((acc, d, i) => {
              const pct = (d.value / total) * 100;
              const offset = acc.offset;
              acc.elements.push(<circle key={i} cx="18" cy="18" r="15.9" fill="none" stroke={d.color} strokeWidth="3" strokeDasharray={`${pct} ${100 - pct}`} strokeDashoffset={-offset} />);
              acc.offset += pct;
              return acc;
            }, { elements: [], offset: 0 }).elements}
          </svg>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mt-1">{data.map((d, i) => <span key={i} className="text-[10px] flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: d.color }} />{d.name}</span>)}</div>
    </div>
  );
}

function FeedWidget({ widget }) {
  const items = [
    { id: 1, title: "Server CPU spike - SRV-DC-01", time: "2m ago", severity: "high" },
    { id: 2, title: "Backup completed - RetailMax", time: "5m ago", severity: "low" },
    { id: 3, title: "Login failure x5 - admin@summit", time: "8m ago", severity: "medium" },
    { id: 4, title: "Disk 92% - TECH-FW-01", time: "12m ago", severity: "high" },
    { id: 5, title: "Patch deployed - KB5034441", time: "18m ago", severity: "low" },
  ];
  return (
    <div className="flex flex-col h-full">
      <span className="text-xs text-[var(--muted)] mb-2">{widget.title}</span>
      <div className="flex-1 overflow-auto space-y-1.5">
        {items.map(item => (
          <div key={item.id} className="flex items-center gap-2 text-xs p-1.5 rounded" style={{ background: "var(--secondary)" }}>
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${item.severity === "high" ? "bg-red-400" : item.severity === "medium" ? "bg-yellow-400" : "bg-emerald-400"}`} />
            <span className="flex-1 truncate">{item.title}</span>
            <span className="text-[var(--muted)] flex-shrink-0">{item.time}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function GaugeWidget({ widget }) {
  const val = widget.config?.value || 0;
  const color = widget.config?.color || "#10b981";
  return (
    <div className="flex flex-col items-center justify-center h-full">
      <span className="text-xs text-[var(--muted)] mb-2">{widget.title}</span>
      <div className="relative w-20 h-20">
        <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--border)" strokeWidth="2.5" />
          <circle cx="18" cy="18" r="15.9" fill="none" stroke={color} strokeWidth="2.5" strokeDasharray={`${val} ${100 - val}`} strokeLinecap="round" />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-lg font-bold">{val}%</span>
      </div>
    </div>
  );
}

function WidgetRenderer({ widget }) {
  const type = widget.type;
  if (type === "stat_card") return <StatWidget widget={widget} />;
  if (type === "line_chart" || type === "bar_chart" || type === "revenue_trend") return <ChartWidget widget={widget} />;
  if (type === "pie_chart" || type === "patch_status") return <PieWidget widget={widget} />;
  if (type === "ticket_feed" || type === "alert_feed") return <FeedWidget widget={widget} />;
  if (type === "sla_gauge") return <GaugeWidget widget={widget} />;
  return <div className="flex items-center justify-center h-full text-[var(--muted)] text-sm">{widget.title || type}</div>;
}

export default function DashboardBuilderPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [layouts, setLayouts] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [activeLayout, setActiveLayout] = useState(null);
  const [editing, setEditing] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);

  const loadLayouts = useCallback(() => {
    axios.get(`${API}/dashboard-builder/layouts`, { headers }).then(r => {
      setLayouts(r.data.layouts || []);
      setCatalog(r.data.available_widgets || []);
      if (!activeLayout && r.data.layouts?.length) setActiveLayout(r.data.layouts[0]);
    });
  }, []);

  useEffect(() => { loadLayouts(); }, []);

  const saveLayout = async () => {
    if (!activeLayout) return;
    await axios.post(`${API}/dashboard-builder/layout`, activeLayout, { headers });
    setEditing(false);
    loadLayouts();
  };

  const addWidget = (widgetType) => {
    if (!activeLayout) return;
    const w = catalog.find(c => c.type === widgetType);
    const newWidget = {
      id: `w-${Date.now()}`,
      type: widgetType,
      title: w?.label || widgetType,
      position: { x: 0, y: (activeLayout.widgets?.length || 0), w: 1, h: 1 },
      config: {},
    };
    setActiveLayout({ ...activeLayout, widgets: [...(activeLayout.widgets || []), newWidget] });
  };

  const removeWidget = (widgetId) => {
    if (!activeLayout) return;
    setActiveLayout({ ...activeLayout, widgets: activeLayout.widgets.filter(w => w.id !== widgetId) });
  };

  const widgets = activeLayout?.widgets || [];

  return (
    <div data-testid="dashboard-builder-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Layout size={24} /> Dashboard Builder</h1>
          <p className="text-sm text-[var(--muted)] mt-1">Create custom dashboards with drag-and-drop widgets</p>
        </div>
        <div className="flex gap-2">
          {editing && <button data-testid="add-widget-btn" onClick={() => setShowCatalog(!showCatalog)} className="px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5" style={{ background: "var(--accent)", color: "white" }}><Plus size={14} /> Add Widget</button>}
          {editing ? (
            <button data-testid="save-layout-btn" onClick={saveLayout} className="px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 bg-emerald-600 text-white"><Save size={14} /> Save</button>
          ) : (
            <button data-testid="edit-layout-btn" onClick={() => setEditing(true)} className="px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5" style={{ background: "var(--secondary)" }}><Settings size={14} /> Edit</button>
          )}
        </div>
      </div>

      {/* Layout selector */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        {layouts.map(l => (
          <button key={l.layout_id} data-testid={`layout-${l.layout_id}`} onClick={() => { setActiveLayout(l); setEditing(false); }} className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${activeLayout?.layout_id === l.layout_id ? "text-white" : ""}`} style={{ background: activeLayout?.layout_id === l.layout_id ? "var(--accent)" : "var(--secondary)" }}>
            {l.name}
          </button>
        ))}
      </div>

      {/* Widget catalog dropdown */}
      {showCatalog && editing && (
        <div className="rounded-xl p-4 mb-4 border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <h3 className="text-sm font-medium mb-3">Widget Catalog</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {catalog.map(w => {
              const Icon = WIDGET_ICONS[w.type] || Layout;
              return (
                <button key={w.type} onClick={() => { addWidget(w.type); setShowCatalog(false); }} className="p-3 rounded-lg text-left text-xs transition-colors hover:opacity-80" style={{ background: "var(--secondary)" }}>
                  <Icon size={16} className="mb-1 text-[var(--accent)]" />
                  <div className="font-medium">{w.label}</div>
                  <div className="text-[var(--muted)] text-[10px]">{w.description}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Widget grid */}
      <div className="grid grid-cols-3 gap-3" data-testid="widget-grid">
        {widgets.map(widget => (
          <div key={widget.id} data-testid={`widget-${widget.id}`} className="rounded-xl p-4 border relative group transition-all" style={{ background: "var(--card)", borderColor: "var(--border)", gridColumn: `span ${Math.min(widget.position?.w || 1, 3)}`, minHeight: (widget.position?.h || 1) * 140 }}>
            {editing && (
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                <button className="p-1 rounded hover:bg-red-500/20" onClick={() => removeWidget(widget.id)}><Trash2 size={12} className="text-red-400" /></button>
                <GripVertical size={12} className="text-[var(--muted)] mt-1 cursor-grab" />
              </div>
            )}
            <WidgetRenderer widget={widget} />
          </div>
        ))}
      </div>

      {widgets.length === 0 && (
        <div className="text-center py-20 text-[var(--muted)]">
          <Layout size={48} className="mx-auto mb-3 opacity-30" />
          <p>No widgets yet. Click <strong>Edit</strong> then <strong>Add Widget</strong> to start building.</p>
        </div>
      )}
    </div>
  );
}
