import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { DollarSign, TrendingUp, TrendingDown, Users, BarChart3, PieChart, ArrowUpRight, ArrowDownRight, AlertTriangle, ChevronRight } from "lucide-react";

export default function RevenueTrackerPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState(null);
  const [cohorts, setCohorts] = useState(null);
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    axios.get(`${API}/revenue-tracker/overview`, { headers }).then(r => setData(r.data));
    axios.get(`${API}/revenue-tracker/cohort`, { headers }).then(r => setCohorts(r.data));
  }, []);

  if (!data) return <div className="animate-pulse p-8">Loading Revenue Tracker...</div>;
  const { summary, clients, monthly_trend, by_service } = data;

  return (
    <div data-testid="revenue-tracker-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><DollarSign size={24} /> MRR / ARR Revenue Tracker</h1>
          <p className="text-sm text-[var(--muted)] mt-1">Track recurring revenue, churn, and expansion across clients</p>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Current MRR", value: `$${summary.current_mrr?.toLocaleString()}`, change: `${summary.mrr_growth}%`, up: summary.mrr_growth > 0, color: "#10b981" },
          { label: "Current ARR", value: `$${summary.current_arr?.toLocaleString()}`, sub: "MRR x 12", color: "#3b82f6" },
          { label: "Net Revenue Retention", value: `${summary.net_revenue_retention}%`, sub: "Target: 110%+", color: "#8b5cf6" },
          { label: "Logo Retention", value: `${summary.logo_retention}%`, sub: "Target: 95%+", color: "#f97316" },
        ].map((kpi, i) => (
          <div key={i} className="rounded-xl p-4 border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="text-xs text-[var(--muted)] mb-1">{kpi.label}</div>
            <div className="text-2xl font-bold" style={{ color: kpi.color }}>{kpi.value}</div>
            {kpi.change && (
              <div className={`text-xs flex items-center gap-1 mt-1 ${kpi.up ? "text-emerald-400" : "text-red-400"}`}>
                {kpi.up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />} {kpi.change} vs last month
              </div>
            )}
            {kpi.sub && <div className="text-[10px] text-[var(--muted)] mt-1">{kpi.sub}</div>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Avg Rev/Endpoint", value: `$${summary.avg_revenue_per_endpoint}`, icon: BarChart3 },
          { label: "Expansion Revenue", value: `$${summary.expansion_revenue?.toLocaleString()}`, icon: TrendingUp },
          { label: "Churn Risk Revenue", value: `$${summary.churn_risk_revenue?.toLocaleString()}`, icon: AlertTriangle, danger: true },
          { label: "Total Clients", value: clients?.length, icon: Users },
        ].map((s, i) => (
          <div key={i} className="rounded-xl p-4 border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="flex items-center gap-1.5 text-xs text-[var(--muted)] mb-1"><s.icon size={12} />{s.label}</div>
            <div className={`text-lg font-bold ${s.danger ? "text-red-400" : ""}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4">
        {["overview", "by-service", "clients", "cohorts"].map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 rounded-lg text-sm capitalize ${tab === t ? "text-white" : "text-[var(--muted)]"}`} style={{ background: tab === t ? "var(--accent)" : "var(--secondary)" }}>{t.replace("-", " ")}</button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="rounded-xl p-4 border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <h3 className="text-sm font-medium mb-3">MRR Trend (6 months)</h3>
          <div className="flex items-end gap-3 h-48">
            {monthly_trend?.map((m, i) => {
              const maxMrr = Math.max(...monthly_trend.map(t => t.mrr));
              return (
                <div key={i} className="flex-1 flex flex-col items-center">
                  <div className="w-full flex flex-col gap-0.5 items-center" style={{ height: "180px" }}>
                    <div className="w-full flex gap-0.5" style={{ height: "100%", alignItems: "flex-end" }}>
                      <div className="flex-1 rounded-t bg-emerald-500" style={{ height: `${(m.mrr / maxMrr) * 100}%` }} title={`MRR: $${m.mrr}`} />
                      <div className="flex-1 rounded-t bg-blue-500/50" style={{ height: `${(m.new / maxMrr) * 100}%` }} title={`New: $${m.new}`} />
                      <div className="flex-1 rounded-t bg-red-400/50" style={{ height: `${(m.churn / maxMrr) * 100}%` }} title={`Churn: $${m.churn}`} />
                    </div>
                  </div>
                  <span className="text-[10px] text-[var(--muted)] mt-1">{m.month}</span>
                </div>
              );
            })}
          </div>
          <div className="flex gap-4 mt-3 justify-center text-xs">
            <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-emerald-500" /> MRR</span>
            <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-blue-500/50" /> New</span>
            <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-red-400/50" /> Churn</span>
          </div>
        </div>
      )}

      {tab === "by-service" && (
        <div className="rounded-xl p-4 border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <h3 className="text-sm font-medium mb-3">Revenue by Service</h3>
          <div className="space-y-3">
            {by_service?.map((s, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-sm w-40 truncate">{s.service}</span>
                <div className="flex-1 h-6 rounded-full overflow-hidden" style={{ background: "var(--secondary)" }}>
                  <div className="h-full rounded-full" style={{ width: `${s.pct}%`, background: ["#10b981", "#3b82f6", "#8b5cf6", "#f97316", "#eab308", "#ef4444"][i] }} />
                </div>
                <span className="text-sm font-medium w-20 text-right">${s.mrr?.toLocaleString()}</span>
                <span className="text-xs text-[var(--muted)] w-10 text-right">{s.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "clients" && (
        <div className="space-y-2">
          {clients?.map((c, i) => (
            <div key={i} data-testid={`client-${c.client_name}`} className="rounded-xl p-3 border flex items-center gap-3" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{c.client_name}</div>
                <div className="text-xs text-[var(--muted)]">{c.endpoints} endpoints &middot; {c.services?.length} services</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold text-emerald-400">${c.mrr?.toLocaleString()}/mo</div>
                {c.expansion_mrr > 0 && <div className="text-[10px] text-blue-400">+${c.expansion_mrr} expansion</div>}
              </div>
              <span className={`px-2 py-0.5 rounded text-[10px] ${c.churn_risk === "high" ? "bg-red-500/20 text-red-400" : c.churn_risk === "medium" ? "bg-yellow-500/20 text-yellow-400" : "bg-emerald-500/20 text-emerald-400"}`}>{c.churn_risk} risk</span>
              <span className="text-xs text-[var(--muted)]">Ends {c.contract_end}</span>
            </div>
          ))}
        </div>
      )}

      {tab === "cohorts" && cohorts && (
        <div className="rounded-xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <table className="w-full text-sm">
            <thead><tr className="border-b" style={{ borderColor: "var(--border)" }}>
              <th className="text-left p-3 text-xs text-[var(--muted)]">Cohort</th>
              <th className="text-right p-3 text-xs text-[var(--muted)]">Start</th>
              <th className="text-right p-3 text-xs text-[var(--muted)]">Now</th>
              <th className="text-right p-3 text-xs text-[var(--muted)]">MRR Start</th>
              <th className="text-right p-3 text-xs text-[var(--muted)]">MRR Now</th>
              <th className="text-right p-3 text-xs text-[var(--muted)]">Retention</th>
              <th className="text-right p-3 text-xs text-[var(--muted)]">Expansion</th>
            </tr></thead>
            <tbody>
              {cohorts.cohorts?.map((c, i) => (
                <tr key={i} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                  <td className="p-3 font-medium">{c.cohort}</td>
                  <td className="p-3 text-right">{c.clients_start}</td>
                  <td className="p-3 text-right">{c.clients_now}</td>
                  <td className="p-3 text-right">${c.mrr_start?.toLocaleString()}</td>
                  <td className="p-3 text-right font-medium text-emerald-400">${c.mrr_now?.toLocaleString()}</td>
                  <td className="p-3 text-right">{c.retention_pct}%</td>
                  <td className="p-3 text-right text-blue-400">+{c.expansion_pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
