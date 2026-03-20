import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  DollarSign, TrendingUp, TrendingDown, BarChart3, Loader2, Users, Ticket,
  ArrowUpRight, ArrowDownRight, Percent, Clock
} from "lucide-react";

const priorityColors = { critical: "text-red-500", high: "text-orange-500", medium: "text-yellow-500", low: "text-green-500" };

export default function RevenueTrackingPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("tickets");
  const [sortBy, setSortBy] = useState("profit");

  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get(`${API}/revenue-tracking/dashboard`, { headers });
        setData(res.data);
      } catch { toast.error("Failed to load revenue data"); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  if (!data) return null;

  const { summary, tickets, by_client, by_tech } = data;
  const sorted = [...tickets].sort((a, b) => sortBy === "profit" ? b.profit - a.profit : sortBy === "revenue" ? b.total_revenue - a.total_revenue : a.margin_pct - b.margin_pct);

  return (
    <div className="space-y-5" data-testid="revenue-tracking-page">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Revenue per Ticket</h1>
        <p className="text-sm text-muted-foreground">Profitability analysis across tickets, clients, and technicians</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Card><CardContent className="p-4"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Revenue</p><p className="text-2xl font-bold text-emerald-500">${summary.total_revenue.toLocaleString()}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Cost</p><p className="text-2xl font-bold text-red-400">${summary.total_cost.toLocaleString()}</p></CardContent></Card>
        <Card className={summary.total_profit > 0 ? "border-emerald-500/20" : "border-red-500/20"}><CardContent className="p-4"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Net Profit</p><p className={`text-2xl font-bold ${summary.total_profit > 0 ? "text-emerald-500" : "text-red-500"}`}>${summary.total_profit.toLocaleString()}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Overall Margin</p><p className={`text-2xl font-bold ${summary.overall_margin > 40 ? "text-emerald-500" : summary.overall_margin > 20 ? "text-amber-500" : "text-red-500"}`}>{summary.overall_margin}%</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg Revenue/Ticket</p><p className="text-2xl font-bold">${summary.avg_revenue_per_ticket.toLocaleString()}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg Profit/Ticket</p><p className="text-2xl font-bold">${summary.avg_profit_per_ticket.toLocaleString()}</p></CardContent></Card>
      </div>

      {/* View Selector */}
      <div className="flex items-center gap-3">
        {[
          { key: "tickets", label: "By Ticket", icon: Ticket },
          { key: "clients", label: "By Client", icon: Users },
          { key: "techs", label: "By Technician", icon: BarChart3 },
        ].map(v => (
          <Button key={v.key} variant={view === v.key ? "default" : "outline"} size="sm" onClick={() => setView(v.key)} data-testid={`view-${v.key}`}>
            <v.icon className="w-3 h-3 mr-1" />{v.label}
          </Button>
        ))}
        {view === "tickets" && (
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-[140px] ml-auto"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="profit">Sort by Profit</SelectItem><SelectItem value="revenue">Sort by Revenue</SelectItem><SelectItem value="margin">Sort by Margin</SelectItem></SelectContent>
          </Select>
        )}
      </div>

      {/* By Ticket */}
      {view === "tickets" && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticket</TableHead><TableHead>Client</TableHead><TableHead>Priority</TableHead>
                  <TableHead className="text-right">Revenue</TableHead><TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Profit</TableHead><TableHead className="text-right">Margin</TableHead>
                  <TableHead className="text-right">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.slice(0, 50).map(t => (
                  <TableRow key={t.id} data-testid={`rev-ticket-${t.id}`}>
                    <TableCell><p className="text-sm font-medium truncate max-w-[200px]">{t.title}</p></TableCell>
                    <TableCell className="text-sm">{t.client_name}</TableCell>
                    <TableCell><Badge variant="outline" className={`text-[10px] capitalize ${priorityColors[t.priority]}`}>{t.priority}</Badge></TableCell>
                    <TableCell className="text-right font-mono text-sm text-emerald-400">${t.total_revenue.toFixed(0)}</TableCell>
                    <TableCell className="text-right font-mono text-sm text-red-400">${t.total_cost.toFixed(0)}</TableCell>
                    <TableCell className={`text-right font-mono text-sm font-bold ${t.profit > 0 ? "text-emerald-400" : "text-red-400"}`}>${t.profit.toFixed(0)}</TableCell>
                    <TableCell className="text-right"><Badge variant="outline" className={`text-[10px] ${t.margin_pct > 40 ? "text-emerald-400 border-emerald-500/30" : t.margin_pct > 20 ? "text-amber-400 border-amber-500/30" : "text-red-400 border-red-500/30"}`}>{t.margin_pct}%</Badge></TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">{t.total_minutes}m</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* By Client */}
      {view === "clients" && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Client</TableHead><TableHead className="text-right">Tickets</TableHead><TableHead className="text-right">Revenue</TableHead><TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Profit</TableHead><TableHead className="text-right">Margin</TableHead></TableRow></TableHeader>
              <TableBody>
                {by_client.map(c => (
                  <TableRow key={c.client_name} data-testid={`rev-client-${c.client_name}`}>
                    <TableCell className="font-medium">{c.client_name}</TableCell>
                    <TableCell className="text-right">{c.tickets}</TableCell>
                    <TableCell className="text-right font-mono text-emerald-400">${c.revenue.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono text-red-400">${c.cost.toLocaleString()}</TableCell>
                    <TableCell className={`text-right font-mono font-bold ${c.profit > 0 ? "text-emerald-400" : "text-red-400"}`}>${c.profit.toLocaleString()}</TableCell>
                    <TableCell className="text-right"><Badge variant="outline" className={`text-[10px] ${c.margin_pct > 40 ? "text-emerald-400" : c.margin_pct > 20 ? "text-amber-400" : "text-red-400"}`}>{c.margin_pct}%</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* By Tech */}
      {view === "techs" && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Technician</TableHead><TableHead className="text-right">Tickets</TableHead><TableHead className="text-right">Revenue</TableHead><TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Profit</TableHead><TableHead className="text-right">Margin</TableHead><TableHead className="text-right">$/Hour</TableHead></TableRow></TableHeader>
              <TableBody>
                {by_tech.map(t => (
                  <TableRow key={t.tech_name} data-testid={`rev-tech-${t.tech_name}`}>
                    <TableCell className="font-medium">{t.tech_name}</TableCell>
                    <TableCell className="text-right">{t.tickets}</TableCell>
                    <TableCell className="text-right font-mono text-emerald-400">${t.revenue.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono text-red-400">${t.cost.toLocaleString()}</TableCell>
                    <TableCell className={`text-right font-mono font-bold ${t.profit > 0 ? "text-emerald-400" : "text-red-400"}`}>${t.profit.toLocaleString()}</TableCell>
                    <TableCell className="text-right"><Badge variant="outline" className={`text-[10px] ${t.margin_pct > 40 ? "text-emerald-400" : t.margin_pct > 20 ? "text-amber-400" : "text-red-400"}`}>{t.margin_pct}%</Badge></TableCell>
                    <TableCell className="text-right font-mono text-sm">${t.revenue_per_hour}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
