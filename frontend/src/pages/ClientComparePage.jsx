import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Users, Monitor, DollarSign, Ticket, Heart } from "lucide-react";

export default function ClientComparePage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState("monthly_revenue");
  const [sortDir, setSortDir] = useState("desc");
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    axios.get(`${API}/client-compare`, { headers })
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!data) return null;

  const sorted = [...data.clients].sort((a, b) => sortDir === "desc" ? (b[sortField] || 0) - (a[sortField] || 0) : (a[sortField] || 0) - (b[sortField] || 0));

  const toggleSort = (field) => {
    if (sortField === field) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortField(field); setSortDir("desc"); }
  };

  const SortHeader = ({ field, children }) => (
    <TableHead className="cursor-pointer hover:text-primary transition-colors" onClick={() => toggleSort(field)}>
      <div className="flex items-center gap-1">{children}{sortField === field && <span className="text-xs">{sortDir === "desc" ? "v" : "^"}</span>}</div>
    </TableHead>
  );

  return (
    <div className="space-y-6" data-testid="client-compare-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Client Comparison Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Multi-tenant comparison of all client metrics</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-4 pb-3 text-center">
          <Users className="w-5 h-5 mx-auto mb-1 text-blue-500" />
          <p className="text-xl font-bold">{data.total}</p>
          <p className="text-xs text-muted-foreground">Total Clients</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <DollarSign className="w-5 h-5 mx-auto mb-1 text-green-500" />
          <p className="text-xl font-bold">${sorted.reduce((s, c) => s + c.monthly_revenue, 0).toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">Total MRR</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <Monitor className="w-5 h-5 mx-auto mb-1 text-cyan-500" />
          <p className="text-xl font-bold">{sorted.reduce((s, c) => s + c.devices, 0)}</p>
          <p className="text-xs text-muted-foreground">Total Devices</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <Ticket className="w-5 h-5 mx-auto mb-1 text-amber-500" />
          <p className="text-xl font-bold">{sorted.reduce((s, c) => s + c.open_tickets, 0)}</p>
          <p className="text-xs text-muted-foreground">Open Tickets</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><BarChart3 className="w-4 h-4" />Client Metrics</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Client</TableHead>
              <TableHead>Tier</TableHead>
              <SortHeader field="monthly_revenue">Revenue</SortHeader>
              <SortHeader field="devices">Devices</SortHeader>
              <SortHeader field="uptime_pct">Uptime</SortHeader>
              <SortHeader field="total_tickets">Tickets</SortHeader>
              <SortHeader field="open_tickets">Open</SortHeader>
              <SortHeader field="critical_tickets">Critical</SortHeader>
              <SortHeader field="rpe">RPE</SortHeader>
              <SortHeader field="sentiment_score">Sentiment</SortHeader>
              <TableHead>Overdue</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {sorted.map(c => (
                <TableRow key={c.client_id} data-testid={`compare-row-${c.client_id}`}>
                  <TableCell className="font-medium">{c.client_name}</TableCell>
                  <TableCell><Badge variant="outline" className="capitalize text-xs">{c.tier}</Badge></TableCell>
                  <TableCell className="font-mono">${c.monthly_revenue.toLocaleString()}</TableCell>
                  <TableCell>{c.devices}</TableCell>
                  <TableCell>
                    <span className={c.uptime_pct >= 95 ? "text-green-500" : c.uptime_pct >= 80 ? "text-amber-500" : "text-red-500"}>
                      {c.uptime_pct}%
                    </span>
                  </TableCell>
                  <TableCell>{c.total_tickets}</TableCell>
                  <TableCell>{c.open_tickets > 0 ? <span className="text-amber-500 font-medium">{c.open_tickets}</span> : "0"}</TableCell>
                  <TableCell>{c.critical_tickets > 0 ? <span className="text-red-500 font-bold">{c.critical_tickets}</span> : "0"}</TableCell>
                  <TableCell className="font-mono">${c.rpe}</TableCell>
                  <TableCell>
                    {c.sentiment_score > 0 ? (
                      <span className={c.sentiment_score >= 70 ? "text-green-500" : c.sentiment_score >= 40 ? "text-amber-500" : "text-red-500"}>
                        {c.sentiment_score}/100
                      </span>
                    ) : <span className="text-muted-foreground">-</span>}
                  </TableCell>
                  <TableCell>{c.overdue_invoices > 0 ? <Badge variant="destructive" className="text-xs">{c.overdue_invoices}</Badge> : "0"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
