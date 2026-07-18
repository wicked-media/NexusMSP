import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DollarSign, Ticket, Clock, BarChart3 } from "lucide-react";

export default function CostPerTicketPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("tickets");
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    axios.get(`${API}/cost-per-ticket/dashboard`, { headers }).then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!data) return null;

  return (
    <div className="space-y-6" data-testid="cost-per-ticket-page">
      <div><h1 className="text-2xl font-bold tracking-tight">Cost-Per-Ticket Analytics</h1>
        <p className="text-muted-foreground text-sm mt-1">True cost analysis combining labour and linked supplier purchase orders.</p></div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <Card><CardContent className="pt-4 pb-3 text-center"><Ticket className="w-4 h-4 mx-auto mb-1" /><p className="text-xl font-bold">{data.summary.total_tickets}</p><p className="text-xs text-muted-foreground">Total Tickets</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><p className="text-xl font-bold">{data.summary.tickets_with_time}</p><p className="text-xs text-muted-foreground">With Time Logged</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><DollarSign className="w-4 h-4 mx-auto mb-1 text-green-500" /><p className="text-xl font-bold">${data.summary.total_labor_cost.toLocaleString()}</p><p className="text-xs text-muted-foreground">Total Labor Cost</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><DollarSign className="w-4 h-4 mx-auto mb-1 text-amber-500" /><p className="text-xl font-bold">${(data.summary.total_supplier_cost || 0).toLocaleString()}</p><p className="text-xs text-muted-foreground">Supplier Cost</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><DollarSign className="w-4 h-4 mx-auto mb-1 text-blue-500" /><p className="text-xl font-bold">${data.summary.avg_cost_per_ticket}</p><p className="text-xs text-muted-foreground">Avg Cost/Ticket</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><Clock className="w-4 h-4 mx-auto mb-1" /><p className="text-xl font-bold">{data.summary.avg_hours_per_ticket}h</p><p className="text-xs text-muted-foreground">Avg Hours/Ticket</p></CardContent></Card>
      </div>

      <Card>
        <CardContent className="pt-4">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="mb-4">
              <TabsTrigger value="tickets">Top Tickets by Cost</TabsTrigger>
              <TabsTrigger value="category">By Category</TabsTrigger>
              <TabsTrigger value="client">By Client</TabsTrigger>
              <TabsTrigger value="priority">By Priority</TabsTrigger>
            </TabsList>
            <TabsContent value="tickets">
              <Table><TableHeader><TableRow><TableHead>Ticket</TableHead><TableHead>Client</TableHead><TableHead>Category</TableHead><TableHead>Priority</TableHead><TableHead>Hours</TableHead><TableHead>Labor</TableHead><TableHead>Supplier</TableHead><TableHead>Total Cost</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>{data.tickets.map(t => (
                  <TableRow key={t.ticket_id} data-testid={`cost-ticket-${t.ticket_id}`}>
                    <TableCell className="font-medium max-w-[200px] truncate">{t.title}</TableCell><TableCell className="text-sm">{t.client_name}</TableCell>
                    <TableCell className="capitalize text-xs">{t.category}</TableCell><TableCell><Badge variant="outline" className="capitalize text-xs">{t.priority}</Badge></TableCell>
                    <TableCell>{t.hours_spent}h</TableCell><TableCell className="font-mono">${t.labor_cost.toLocaleString()}</TableCell><TableCell className="font-mono text-amber-400">${(t.supplier_cost || 0).toLocaleString()}</TableCell><TableCell className="font-mono font-semibold">${(t.total_cost ?? t.labor_cost).toLocaleString()}</TableCell>
                    <TableCell><Badge variant="outline" className="capitalize text-xs">{t.status}</Badge></TableCell>
                  </TableRow>
                ))}</TableBody></Table>
            </TabsContent>
            <TabsContent value="category">
              <Table><TableHeader><TableRow><TableHead>Category</TableHead><TableHead>Tickets</TableHead><TableHead>Total Cost</TableHead><TableHead>Avg Cost</TableHead><TableHead>Total Hours</TableHead></TableRow></TableHeader>
                <TableBody>{data.by_category.map(c => (
                  <TableRow key={c.category} data-testid={`cost-cat-${c.category}`}>
                    <TableCell className="font-medium capitalize">{c.category}</TableCell><TableCell>{c.count}</TableCell>
                    <TableCell className="font-mono">${c.total_cost.toLocaleString()}</TableCell><TableCell className="font-mono">${c.avg_cost}</TableCell>
                    <TableCell>{c.total_hours}h</TableCell>
                  </TableRow>
                ))}</TableBody></Table>
            </TabsContent>
            <TabsContent value="client">
              <Table><TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Tickets</TableHead><TableHead>Total Cost</TableHead><TableHead>Avg Cost</TableHead></TableRow></TableHeader>
                <TableBody>{data.by_client.map(c => (
                  <TableRow key={c.client} data-testid={`cost-client-${c.client}`}>
                    <TableCell className="font-medium">{c.client}</TableCell><TableCell>{c.count}</TableCell>
                    <TableCell className="font-mono">${c.total_cost.toLocaleString()}</TableCell><TableCell className="font-mono">${c.avg_cost}</TableCell>
                  </TableRow>
                ))}</TableBody></Table>
            </TabsContent>
            <TabsContent value="priority">
              <Table><TableHeader><TableRow><TableHead>Priority</TableHead><TableHead>Tickets</TableHead><TableHead>Total Cost</TableHead><TableHead>Avg Cost</TableHead></TableRow></TableHeader>
                <TableBody>{data.by_priority.map(p => (
                  <TableRow key={p.priority} data-testid={`cost-pri-${p.priority}`}>
                    <TableCell className="font-medium capitalize">{p.priority}</TableCell><TableCell>{p.count}</TableCell>
                    <TableCell className="font-mono">${p.total_cost.toLocaleString()}</TableCell><TableCell className="font-mono">${p.avg_cost}</TableCell>
                  </TableRow>
                ))}</TableBody></Table>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
