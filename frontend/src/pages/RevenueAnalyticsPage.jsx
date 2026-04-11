import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  DollarSign, TrendingUp, TrendingDown, Users, BarChart3, Ticket,
  ArrowUpRight, ArrowDownRight, AlertTriangle, Loader2, Clock, Percent
} from "lucide-react";

export default function RevenueAnalyticsPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [tab, setTab] = useState("mrr");
  const [mrrData, setMrrData] = useState(null);
  const [cohorts, setCohorts] = useState(null);
  const [ticketData, setTicketData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [subTab, setSubTab] = useState("overview");
  const [ticketView, setTicketView] = useState("tickets");
  const [sortBy, setSortBy] = useState("profit");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [mrr, coh, rev] = await Promise.allSettled([
        axios.get(`${API}/revenue-tracker/overview`, { headers }),
        axios.get(`${API}/revenue-tracker/cohort`, { headers }),
        axios.get(`${API}/revenue-tracking/dashboard`, { headers }),
      ]);
      if (mrr.status === "fulfilled") setMrrData(mrr.value.data);
      if (coh.status === "fulfilled") setCohorts(coh.value.data);
      if (rev.status === "fulfilled") setTicketData(rev.value.data);
    } catch { toast.error("Failed to load revenue data"); }
    finally { setLoading(false); }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const s = mrrData?.summary || {};
  const ts = ticketData?.summary || {};

  return (
    <div data-testid="revenue-analytics-page" className="space-y-5">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center"><DollarSign className="w-5 h-5 text-white" /></div>
          Revenue Analytics
        </h1>
        <p className="text-muted-foreground mt-1">MRR/ARR tracking, per-ticket profitability, and cohort analysis</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="mrr" data-testid="tab-mrr">MRR / ARR</TabsTrigger>
          <TabsTrigger value="per-ticket" data-testid="tab-per-ticket">Per-Ticket Revenue</TabsTrigger>
          <TabsTrigger value="cohorts" data-testid="tab-cohorts">Cohort Analysis</TabsTrigger>
        </TabsList>

        {/* --- MRR/ARR TAB --- */}
        <TabsContent value="mrr" className="mt-4 space-y-5">
          {!mrrData ? <p className="text-muted-foreground text-center py-12">No MRR data available</p> : <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Current MRR", value: `$${s.current_mrr?.toLocaleString()}`, change: `${s.mrr_growth}%`, up: s.mrr_growth > 0, color: "#10b981" },
                { label: "Current ARR", value: `$${s.current_arr?.toLocaleString()}`, sub: "MRR x 12", color: "#3b82f6" },
                { label: "Net Revenue Retention", value: `${s.net_revenue_retention}%`, sub: "Target: 110%+", color: "#8b5cf6" },
                { label: "Logo Retention", value: `${s.logo_retention}%`, sub: "Target: 95%+", color: "#f97316" },
              ].map((kpi, i) => (
                <div key={`k-${i}`} className="rounded-xl p-4 border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                  <div className="text-xs text-[var(--muted)] mb-1">{kpi.label}</div>
                  <div className="text-2xl font-bold" style={{ color: kpi.color }}>{kpi.value}</div>
                  {kpi.change && <div className={`text-xs flex items-center gap-1 mt-1 ${kpi.up ? "text-emerald-400" : "text-red-400"}`}>{kpi.up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />} {kpi.change} vs last month</div>}
                  {kpi.sub && <div className="text-[10px] text-[var(--muted)] mt-1">{kpi.sub}</div>}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Avg Rev/Endpoint", value: `$${s.avg_revenue_per_endpoint}`, icon: BarChart3 },
                { label: "Expansion Revenue", value: `$${s.expansion_revenue?.toLocaleString()}`, icon: TrendingUp },
                { label: "Churn Risk Revenue", value: `$${s.churn_risk_revenue?.toLocaleString()}`, icon: AlertTriangle, danger: true },
                { label: "Total Clients", value: mrrData.clients?.length, icon: Users },
              ].map((st, i) => (
                <div key={`k-${i}`} className="rounded-xl p-4 border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                  <div className="flex items-center gap-1.5 text-xs text-[var(--muted)] mb-1"><st.icon size={12} />{st.label}</div>
                  <div className={`text-lg font-bold ${st.danger ? "text-red-400" : ""}`}>{st.value}</div>
                </div>
              ))}
            </div>
            <div className="flex gap-1 mb-4">
              {["overview", "by-service", "clients"].map(t => (
                <button key={t} onClick={() => setSubTab(t)} className={`px-3 py-1.5 rounded-lg text-sm capitalize ${subTab === t ? "text-white" : "text-[var(--muted)]"}`} style={{ background: subTab === t ? "var(--accent)" : "var(--secondary)" }}>{t.replace("-", " ")}</button>
              ))}
            </div>
            {subTab === "overview" && (
              <div className="rounded-xl p-4 border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <h3 className="text-sm font-medium mb-3">MRR Trend (6 months)</h3>
                <div className="flex items-end gap-3 h-48">
                  {mrrData.monthly_trend?.map((m, i) => {
                    const maxMrr = Math.max(...mrrData.monthly_trend.map(t => t.mrr));
                    return (
                      <div key={`k-${i}`} className="flex-1 flex flex-col items-center">
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
            {subTab === "by-service" && (
              <div className="rounded-xl p-4 border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <h3 className="text-sm font-medium mb-3">Revenue by Service</h3>
                <div className="space-y-3">
                  {mrrData.by_service?.map((sv, i) => (
                    <div key={`k-${i}`} className="flex items-center gap-3">
                      <span className="text-sm w-40 truncate">{sv.service}</span>
                      <div className="flex-1 h-6 rounded-full overflow-hidden" style={{ background: "var(--secondary)" }}>
                        <div className="h-full rounded-full" style={{ width: `${sv.pct}%`, background: ["#10b981", "#3b82f6", "#8b5cf6", "#f97316", "#eab308", "#ef4444"][i % 6] }} />
                      </div>
                      <span className="text-sm font-medium w-20 text-right">${sv.mrr?.toLocaleString()}</span>
                      <span className="text-xs text-[var(--muted)] w-10 text-right">{sv.pct}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {subTab === "clients" && (
              <div className="space-y-2">
                {mrrData.clients?.map((c, i) => (
                  <div key={`k-${i}`} className="rounded-xl p-3 border flex items-center gap-3" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                    <div className="flex-1 min-w-0"><div className="text-sm font-medium">{c.client_name}</div><div className="text-xs text-[var(--muted)]">{c.endpoints} endpoints</div></div>
                    <div className="text-right"><div className="text-sm font-bold text-emerald-400">${c.mrr?.toLocaleString()}/mo</div>{c.expansion_mrr > 0 && <div className="text-[10px] text-blue-400">+${c.expansion_mrr} expansion</div>}</div>
                    <span className={`px-2 py-0.5 rounded text-[10px] ${c.churn_risk === "high" ? "bg-red-500/20 text-red-400" : c.churn_risk === "medium" ? "bg-yellow-500/20 text-yellow-400" : "bg-emerald-500/20 text-emerald-400"}`}>{c.churn_risk} risk</span>
                  </div>
                ))}
              </div>
            )}
          </>}
        </TabsContent>

        {/* --- PER-TICKET TAB --- */}
        <TabsContent value="per-ticket" className="mt-4 space-y-5">
          {!ticketData ? <p className="text-muted-foreground text-center py-12">No ticket revenue data</p> : <>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              <Card><CardContent className="p-4"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Revenue</p><p className="text-2xl font-bold text-emerald-500">${ts.total_revenue?.toLocaleString()}</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Cost</p><p className="text-2xl font-bold text-red-400">${ts.total_cost?.toLocaleString()}</p></CardContent></Card>
              <Card className={ts.total_profit > 0 ? "border-emerald-500/20" : "border-red-500/20"}><CardContent className="p-4"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Net Profit</p><p className={`text-2xl font-bold ${ts.total_profit > 0 ? "text-emerald-500" : "text-red-500"}`}>${ts.total_profit?.toLocaleString()}</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Overall Margin</p><p className={`text-2xl font-bold ${ts.overall_margin > 40 ? "text-emerald-500" : ts.overall_margin > 20 ? "text-amber-500" : "text-red-500"}`}>{ts.overall_margin}%</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg Revenue/Ticket</p><p className="text-2xl font-bold">${ts.avg_revenue_per_ticket?.toLocaleString()}</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg Profit/Ticket</p><p className="text-2xl font-bold">${ts.avg_profit_per_ticket?.toLocaleString()}</p></CardContent></Card>
            </div>
            <div className="flex items-center gap-3">
              {[{ key: "tickets", label: "By Ticket", icon: Ticket }, { key: "clients", label: "By Client", icon: Users }, { key: "techs", label: "By Technician", icon: BarChart3 }].map(v => (
                <Button key={v.key} variant={ticketView === v.key ? "default" : "outline"} size="sm" onClick={() => setTicketView(v.key)}><v.icon className="w-3 h-3 mr-1" />{v.label}</Button>
              ))}
              {ticketView === "tickets" && (
                <Select value={sortBy} onValueChange={setSortBy}><SelectTrigger className="w-[140px] ml-auto"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="profit">Sort by Profit</SelectItem><SelectItem value="revenue">Sort by Revenue</SelectItem><SelectItem value="margin">Sort by Margin</SelectItem></SelectContent></Select>
              )}
            </div>
            {ticketView === "tickets" && (
              <Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Ticket</TableHead><TableHead>Client</TableHead><TableHead>Priority</TableHead><TableHead className="text-right">Revenue</TableHead><TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Profit</TableHead><TableHead className="text-right">Margin</TableHead><TableHead className="text-right">Time</TableHead></TableRow></TableHeader>
                <TableBody>{[...ticketData.tickets].sort((a, b) => sortBy === "profit" ? b.profit - a.profit : sortBy === "revenue" ? b.total_revenue - a.total_revenue : a.margin_pct - b.margin_pct).slice(0, 50).map(t => (
                  <TableRow key={t.id}><TableCell><p className="text-sm font-medium truncate max-w-[200px]">{t.title}</p></TableCell><TableCell className="text-sm">{t.client_name}</TableCell><TableCell><Badge variant="outline" className="text-[10px] capitalize">{t.priority}</Badge></TableCell><TableCell className="text-right font-mono text-sm text-emerald-400">${t.total_revenue.toFixed(0)}</TableCell><TableCell className="text-right font-mono text-sm text-red-400">${t.total_cost.toFixed(0)}</TableCell><TableCell className={`text-right font-mono text-sm font-bold ${t.profit > 0 ? "text-emerald-400" : "text-red-400"}`}>${t.profit.toFixed(0)}</TableCell><TableCell className="text-right"><Badge variant="outline" className={`text-[10px] ${t.margin_pct > 40 ? "text-emerald-400" : t.margin_pct > 20 ? "text-amber-400" : "text-red-400"}`}>{t.margin_pct}%</Badge></TableCell><TableCell className="text-right text-xs text-muted-foreground">{t.total_minutes}m</TableCell></TableRow>
                ))}</TableBody></Table></CardContent></Card>
            )}
            {ticketView === "clients" && (
              <Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Client</TableHead><TableHead className="text-right">Tickets</TableHead><TableHead className="text-right">Revenue</TableHead><TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Profit</TableHead><TableHead className="text-right">Margin</TableHead></TableRow></TableHeader>
                <TableBody>{ticketData.by_client?.map(c => (
                  <TableRow key={c.client_name}><TableCell className="font-medium">{c.client_name}</TableCell><TableCell className="text-right">{c.tickets}</TableCell><TableCell className="text-right font-mono text-emerald-400">${c.revenue?.toLocaleString()}</TableCell><TableCell className="text-right font-mono text-red-400">${c.cost?.toLocaleString()}</TableCell><TableCell className={`text-right font-mono font-bold ${c.profit > 0 ? "text-emerald-400" : "text-red-400"}`}>${c.profit?.toLocaleString()}</TableCell><TableCell className="text-right"><Badge variant="outline" className={`text-[10px] ${c.margin_pct > 40 ? "text-emerald-400" : c.margin_pct > 20 ? "text-amber-400" : "text-red-400"}`}>{c.margin_pct}%</Badge></TableCell></TableRow>
                ))}</TableBody></Table></CardContent></Card>
            )}
            {ticketView === "techs" && (
              <Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Technician</TableHead><TableHead className="text-right">Tickets</TableHead><TableHead className="text-right">Revenue</TableHead><TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Profit</TableHead><TableHead className="text-right">Margin</TableHead><TableHead className="text-right">$/Hour</TableHead></TableRow></TableHeader>
                <TableBody>{ticketData.by_tech?.map(t => (
                  <TableRow key={t.tech_name}><TableCell className="font-medium">{t.tech_name}</TableCell><TableCell className="text-right">{t.tickets}</TableCell><TableCell className="text-right font-mono text-emerald-400">${t.revenue?.toLocaleString()}</TableCell><TableCell className="text-right font-mono text-red-400">${t.cost?.toLocaleString()}</TableCell><TableCell className={`text-right font-mono font-bold ${t.profit > 0 ? "text-emerald-400" : "text-red-400"}`}>${t.profit?.toLocaleString()}</TableCell><TableCell className="text-right"><Badge variant="outline" className={`text-[10px] ${t.margin_pct > 40 ? "text-emerald-400" : t.margin_pct > 20 ? "text-amber-400" : "text-red-400"}`}>{t.margin_pct}%</Badge></TableCell><TableCell className="text-right font-mono text-sm">${t.revenue_per_hour}</TableCell></TableRow>
                ))}</TableBody></Table></CardContent></Card>
            )}
          </>}
        </TabsContent>

        {/* --- COHORTS TAB --- */}
        <TabsContent value="cohorts" className="mt-4">
          {!cohorts ? <p className="text-muted-foreground text-center py-12">No cohort data</p> : (
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
                    <tr key={`k-${i}`} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
