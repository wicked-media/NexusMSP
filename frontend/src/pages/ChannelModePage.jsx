import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Building2, Users, Monitor, DollarSign, Plus, ChevronRight, TrendingUp } from "lucide-react";

const TIER_COLORS = { enterprise: "#8b5cf6", professional: "#3b82f6", standard: "#6b7280" };
const FEATURE_LIST = ["tickets", "devices", "clients", "reports", "security", "patching", "backup", "automation", "ai_copilot", "white_label"];

export default function ChannelModePage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState(null);
  const [revenue, setRevenue] = useState(null);
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState("tenants");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", admin_email: "", tier: "standard" });

  useEffect(() => {
    axios.get(`${API}/channel-mode/tenants`, { headers }).then(r => setData(r.data));
    axios.get(`${API}/channel-mode/revenue`, { headers }).then(r => setRevenue(r.data));
  }, []);

  const createTenant = async () => {
    await axios.post(`${API}/channel-mode/tenant`, form, { headers });
    setShowCreate(false);
    setForm({ name: "", admin_email: "", tier: "standard" });
    axios.get(`${API}/channel-mode/tenants`, { headers }).then(r => setData(r.data));
  };

  if (!data) return <div className="animate-pulse p-8">Loading Channel Mode...</div>;
  const { tenants, summary } = data;

  return (
    <div data-testid="channel-mode-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Building2 size={24} /> Channel / MSP-of-MSPs</h1>
          <p className="text-sm text-[var(--muted)] mt-1">Manage white-label tenant MSPs from a single pane</p>
        </div>
        <button data-testid="create-tenant-btn" onClick={() => setShowCreate(true)} className="px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5" style={{ background: "var(--accent)", color: "white" }}>
          <Plus size={14} /> New Tenant
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {[
          { label: "Total Tenants", value: summary.total_tenants, icon: Building2, color: "#3b82f6" },
          { label: "Active", value: summary.active, icon: Users, color: "#10b981" },
          { label: "Total Endpoints", value: summary.total_endpoints?.toLocaleString(), icon: Monitor, color: "#8b5cf6" },
          { label: "Total MRR", value: `$${summary.total_mrr?.toLocaleString()}`, icon: DollarSign, color: "#f97316" },
          { label: "Avg Margin", value: `${summary.avg_margin}%`, icon: TrendingUp, color: "#10b981" },
        ].map((s, i) => (
          <div key={`k-${i}`} className="rounded-xl p-4 border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="flex items-center gap-2 mb-2"><s.icon size={14} style={{ color: s.color }} /><span className="text-xs text-[var(--muted)]">{s.label}</span></div>
            <div className="text-xl font-bold">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4">
        {["tenants", "revenue"].map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 rounded-lg text-sm capitalize ${tab === t ? "text-white" : "text-[var(--muted)]"}`} style={{ background: tab === t ? "var(--accent)" : "var(--secondary)" }}>{t}</button>
        ))}
      </div>

      {tab === "tenants" && (
        <div className="space-y-2">
          {tenants.map(t => (
            <div key={t.tenant_id} data-testid={`tenant-${t.tenant_id}`} onClick={() => setSelected(selected?.tenant_id === t.tenant_id ? null : t)} className="rounded-xl p-4 border cursor-pointer transition-colors hover:border-[var(--accent)]" style={{ background: "var(--card)", borderColor: selected?.tenant_id === t.tenant_id ? "var(--accent)" : "var(--border)" }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm" style={{ background: t.branding?.primary_color || "#3b82f6" }}>{t.name.charAt(0)}</div>
                  <div>
                    <div className="font-medium">{t.name}</div>
                    <div className="text-xs text-[var(--muted)]">{t.domain}</div>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="px-2 py-0.5 rounded text-xs font-medium capitalize" style={{ background: TIER_COLORS[t.tier] + "22", color: TIER_COLORS[t.tier] }}>{t.tier}</span>
                  <span className="text-[var(--muted)]"><Monitor size={12} className="inline mr-1" />{t.endpoint_count}</span>
                  <span className="font-medium text-emerald-400">${t.mrr?.toLocaleString()}/mo</span>
                  <span className={`px-2 py-0.5 rounded text-xs ${t.status === "active" ? "bg-emerald-500/20 text-emerald-400" : "bg-yellow-500/20 text-yellow-400"}`}>{t.status}</span>
                  <ChevronRight size={14} className="text-[var(--muted)]" />
                </div>
              </div>
              {selected?.tenant_id === t.tenant_id && (
                <div className="mt-4 pt-4 border-t grid grid-cols-2 md:grid-cols-4 gap-4 text-sm" style={{ borderColor: "var(--border)" }}>
                  <div><span className="text-[var(--muted)] text-xs block">Technicians</span>{t.technicians || "N/A"}</div>
                  <div><span className="text-[var(--muted)] text-xs block">Clients</span>{t.clients_count || "N/A"}</div>
                  <div><span className="text-[var(--muted)] text-xs block">Margin</span>{t.margin_pct}%</div>
                  <div><span className="text-[var(--muted)] text-xs block">Admin</span>{t.admin_email}</div>
                  <div className="col-span-full"><span className="text-[var(--muted)] text-xs block mb-1">Features Enabled</span>
                    <div className="flex flex-wrap gap-1">{(t.features_enabled || []).map(f => <span key={f} className="px-2 py-0.5 rounded text-xs" style={{ background: "var(--secondary)" }}>{f}</span>)}</div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "revenue" && revenue && (
        <div className="space-y-4">
          <div className="rounded-xl p-4 border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <h3 className="text-sm font-medium mb-3">Monthly Revenue vs Cost</h3>
            <div className="flex items-end gap-2 h-40">
              {(revenue.monthly_trend || []).map((m, i) => (
                <div key={`k-${i}`} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex flex-col items-center gap-0.5">
                    <div className="w-full rounded-t bg-emerald-500" style={{ height: `${(m.revenue / 80000) * 100}px` }} />
                    <div className="w-full rounded-t bg-red-400/50" style={{ height: `${(m.cost / 80000) * 100}px` }} />
                  </div>
                  <span className="text-[10px] text-[var(--muted)]">{m.month}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl p-4 border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <h3 className="text-sm font-medium mb-3">Revenue by Tier</h3>
            <div className="space-y-2">
              {Object.entries(revenue.by_tier || {}).map(([tier, val]) => (
                <div key={tier} className="flex items-center gap-3">
                  <span className="text-sm capitalize w-24">{tier}</span>
                  <div className="flex-1 h-6 rounded-full overflow-hidden" style={{ background: "var(--secondary)" }}>
                    <div className="h-full rounded-full" style={{ width: `${(val / Math.max(...Object.values(revenue.by_tier))) * 100}%`, background: TIER_COLORS[tier] || "#6b7280" }} />
                  </div>
                  <span className="text-sm font-medium w-20 text-right">${val?.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Create tenant modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
          <div className="rounded-xl p-6 w-full max-w-md" style={{ background: "var(--card)" }} onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">Create New Tenant</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-[var(--muted)] block mb-1">MSP Name</label>
                <input data-testid="tenant-name-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: "var(--secondary)", border: "1px solid var(--border)" }} placeholder="Acme IT Services" />
              </div>
              <div>
                <label className="text-xs text-[var(--muted)] block mb-1">Admin Email</label>
                <input data-testid="tenant-email-input" value={form.admin_email} onChange={e => setForm({ ...form, admin_email: e.target.value })} className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: "var(--secondary)", border: "1px solid var(--border)" }} placeholder="admin@acmeit.com" />
              </div>
              <div>
                <label className="text-xs text-[var(--muted)] block mb-1">Tier</label>
                <select data-testid="tenant-tier-select" value={form.tier} onChange={e => setForm({ ...form, tier: e.target.value })} className="w-full px-3 py-2 rounded-lg text-sm" style={{ background: "var(--secondary)", border: "1px solid var(--border)" }}>
                  <option value="standard">Standard</option>
                  <option value="professional">Professional</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg text-sm" style={{ background: "var(--secondary)" }}>Cancel</button>
              <button data-testid="submit-tenant-btn" onClick={createTenant} className="px-4 py-2 rounded-lg text-sm text-white" style={{ background: "var(--accent)" }}>Create Tenant</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
