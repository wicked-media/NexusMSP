import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, AreaChart, Area } from "recharts";
import { DollarSign, TrendingUp, TrendingDown, CreditCard, FileText, Users, Calendar, Download, Wallet, PieChart as PieIcon, BarChart3, RefreshCw } from "lucide-react";

const COLORS = ["#3b82f6", "#8b5cf6", "#06b6d4", "#f59e0b", "#ef4444", "#22c55e", "#f97316", "#ec4899"];

export default function FinancialReportsPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [revenue, setRevenue] = useState(null);
  const [aging, setAging] = useState(null);
  const [pnl, setPnl] = useState(null);
  const [clientRev, setClientRev] = useState(null);
  const [serviceRev, setServiceRev] = useState(null);
  const [collections, setCollections] = useState(null);
  const [tax, setTax] = useState(null);
  const [allocations, setAllocations] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [r1, r2, r3, r4, r5, r6, r7, r8] = await Promise.all([
        axios.get(`${API}/reports/financial/revenue-summary`, { headers }),
        axios.get(`${API}/reports/financial/aging`, { headers }),
        axios.get(`${API}/reports/financial/profit-loss`, { headers }),
        axios.get(`${API}/reports/financial/client-revenue`, { headers }),
        axios.get(`${API}/reports/financial/service-revenue`, { headers }),
        axios.get(`${API}/reports/financial/payment-collection`, { headers }),
        axios.get(`${API}/reports/financial/tax-summary`, { headers }),
        axios.get(`${API}/reports/financial/monthly-allocations`, { headers }),
      ]);
      setRevenue(r1.data); setAging(r2.data); setPnl(r3.data); setClientRev(r4.data);
      setServiceRev(r5.data); setCollections(r6.data); setTax(r7.data); setAllocations(r8.data);
    } catch { toast.error("Failed to load financial reports"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const agingBuckets = aging?.buckets || {};
  const agingData = [
    { name: "Current", value: agingBuckets.current?.total || 0, count: agingBuckets.current?.count || 0 },
    { name: "1-30 Days", value: agingBuckets["30_days"]?.total || 0, count: agingBuckets["30_days"]?.count || 0 },
    { name: "31-60 Days", value: agingBuckets["60_days"]?.total || 0, count: agingBuckets["60_days"]?.count || 0 },
    { name: "61-90 Days", value: agingBuckets["90_days"]?.total || 0, count: agingBuckets["90_days"]?.count || 0 },
    { name: "90+ Days", value: agingBuckets.over_90?.total || 0, count: agingBuckets.over_90?.count || 0 },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-bold tracking-tight">Financial Reports</h1><p className="text-muted-foreground">Comprehensive financial analytics & reporting</p></div>
        <Button variant="outline" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
      </div>

      {/* KPI Cards */}
      {revenue && (
        <div className="grid grid-cols-5 gap-4">
          {[
            { label: "MRR", value: `$${revenue.current_mrr?.toLocaleString()}`, icon: TrendingUp, color: "text-blue-500" },
            { label: "ARR", value: `$${revenue.current_arr?.toLocaleString()}`, icon: BarChart3, color: "text-violet-500" },
            { label: "Total Revenue", value: `$${revenue.total_revenue?.toLocaleString()}`, icon: DollarSign, color: "text-emerald-500" },
            { label: "Collected", value: `$${revenue.total_collected?.toLocaleString()}`, icon: Wallet, color: "text-amber-500" },
            { label: "Outstanding", value: `$${revenue.total_outstanding?.toLocaleString()}`, icon: FileText, color: "text-red-500" },
          ].map((k, i) => (
            <Card key={i}><CardContent className="pt-4"><div className="flex items-center gap-3"><k.icon className={`w-7 h-7 ${k.color}`} /><div><p className="text-[10px] text-muted-foreground uppercase tracking-wide">{k.label}</p><p className="text-lg font-bold">{k.value}</p></div></div></CardContent></Card>
          ))}
        </div>
      )}

      <Tabs defaultValue="revenue">
        <TabsList className="grid grid-cols-8 w-full">
          <TabsTrigger value="revenue">Revenue</TabsTrigger>
          <TabsTrigger value="pnl">P&L</TabsTrigger>
          <TabsTrigger value="aging">AR Aging</TabsTrigger>
          <TabsTrigger value="clients">By Client</TabsTrigger>
          <TabsTrigger value="services">By Service</TabsTrigger>
          <TabsTrigger value="collections">Collections</TabsTrigger>
          <TabsTrigger value="tax">Tax</TabsTrigger>
          <TabsTrigger value="allocations">Allocations</TabsTrigger>
        </TabsList>

        {/* Revenue Chart */}
        <TabsContent value="revenue">
          <Card><CardHeader><CardTitle>Monthly Revenue Trend</CardTitle></CardHeader><CardContent>
            <div style={{ width: "100%", height: 350 }}>
              <ResponsiveContainer>
                <AreaChart data={revenue?.monthly_data || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis dataKey="month" stroke="#888" fontSize={11} />
                  <YAxis stroke="#888" fontSize={11} />
                  <Tooltip contentStyle={{ backgroundColor: "#1a1a2e", border: "1px solid #333" }} />
                  <Area type="monotone" dataKey="revenue" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.1} name="Revenue" />
                  <Area type="monotone" dataKey="collected" stroke="#22c55e" fill="#22c55e" fillOpacity={0.1} name="Collected" />
                  <Area type="monotone" dataKey="outstanding" stroke="#ef4444" fill="#ef4444" fillOpacity={0.05} name="Outstanding" />
                  <Legend />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent></Card>
        </TabsContent>

        {/* P&L */}
        <TabsContent value="pnl">
          <Card><CardHeader><CardTitle>Profit & Loss Statement</CardTitle></CardHeader><CardContent>
            <div style={{ width: "100%", height: 350 }}>
              <ResponsiveContainer>
                <BarChart data={pnl?.monthly_data || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis dataKey="month" stroke="#888" fontSize={11} />
                  <YAxis stroke="#888" fontSize={11} />
                  <Tooltip contentStyle={{ backgroundColor: "#1a1a2e", border: "1px solid #333" }} />
                  <Bar dataKey="revenue" fill="#3b82f6" name="Revenue" />
                  <Bar dataKey="cogs" fill="#f59e0b" name="COGS" />
                  <Bar dataKey="net_profit" fill="#22c55e" name="Net Profit" />
                  <Legend />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <Table className="mt-4">
              <TableHeader><TableRow><TableHead>Month</TableHead><TableHead>Revenue</TableHead><TableHead>COGS</TableHead><TableHead>Gross Profit</TableHead><TableHead>OpEx</TableHead><TableHead>Net Profit</TableHead><TableHead>Margin</TableHead></TableRow></TableHeader>
              <TableBody>
                {(pnl?.monthly_data || []).filter(d => d.revenue > 0).map(d => (
                  <TableRow key={d.month}><TableCell>{d.month}</TableCell><TableCell>${d.revenue.toLocaleString()}</TableCell><TableCell>${d.cogs.toLocaleString()}</TableCell><TableCell>${d.gross_profit.toLocaleString()}</TableCell><TableCell>${d.operating_expenses.toLocaleString()}</TableCell><TableCell className={d.net_profit >= 0 ? "text-emerald-500 font-medium" : "text-red-500"}>${d.net_profit.toLocaleString()}</TableCell><TableCell>{d.margin_percent}%</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        {/* AR Aging */}
        <TabsContent value="aging">
          <Card><CardHeader><CardTitle>Accounts Receivable Aging</CardTitle></CardHeader><CardContent>
            <div style={{ width: "100%", height: 300 }}>
              <ResponsiveContainer>
                <BarChart data={agingData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis dataKey="name" stroke="#888" fontSize={11} />
                  <YAxis stroke="#888" fontSize={11} />
                  <Tooltip contentStyle={{ backgroundColor: "#1a1a2e", border: "1px solid #333" }} />
                  <Bar dataKey="value" fill="#3b82f6" name="Amount" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-5 gap-3 mt-4">
              {agingData.map((b, i) => (
                <Card key={i} className={i >= 3 ? "border-red-500/20" : i >= 2 ? "border-amber-500/20" : ""}>
                  <CardContent className="pt-3 text-center"><p className="text-lg font-bold">${b.value.toLocaleString()}</p><p className="text-[10px] text-muted-foreground">{b.name} ({b.count})</p></CardContent>
                </Card>
              ))}
            </div>
            <p className="text-sm font-medium mt-3">Grand Total Outstanding: <span className="text-red-500">${aging?.grand_total?.toLocaleString()}</span></p>
          </CardContent></Card>
        </TabsContent>

        {/* By Client */}
        <TabsContent value="clients">
          <Card><CardContent className="pt-4">
            <Table>
              <TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Total Invoiced</TableHead><TableHead>Collected</TableHead><TableHead>Outstanding</TableHead><TableHead>Collection Rate</TableHead><TableHead>Invoices</TableHead></TableRow></TableHeader>
              <TableBody>
                {(clientRev?.clients || []).map(c => (
                  <TableRow key={c.client_id}><TableCell className="font-medium">{c.client_name}</TableCell><TableCell>${c.total_invoiced.toLocaleString()}</TableCell><TableCell className="text-emerald-500">${c.total_paid.toLocaleString()}</TableCell><TableCell className={c.outstanding > 0 ? "text-red-500" : ""}>${c.outstanding.toLocaleString()}</TableCell><TableCell><Badge className={c.collection_rate >= 90 ? "bg-emerald-500/10 text-emerald-500" : c.collection_rate >= 70 ? "bg-yellow-500/10 text-yellow-500" : "bg-red-500/10 text-red-500"}>{c.collection_rate}%</Badge></TableCell><TableCell>{c.invoice_count}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        {/* By Service */}
        <TabsContent value="services">
          <Card><CardContent className="pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div style={{ width: "100%", height: 300 }}>
                <ResponsiveContainer>
                  <PieChart><Pie data={(serviceRev?.services || []).slice(0, 8)} dataKey="total_revenue" nameKey="service_name" cx="50%" cy="50%" outerRadius={100} label={({ name, percent }) => `${name.substring(0, 15)} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={10}>{(serviceRev?.services || []).slice(0, 8).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip /></PieChart>
                </ResponsiveContainer>
              </div>
              <Table>
                <TableHeader><TableRow><TableHead>Service</TableHead><TableHead>Revenue</TableHead><TableHead>Qty</TableHead><TableHead>Avg Price</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(serviceRev?.services || []).map((s, i) => (
                    <TableRow key={i}><TableCell className="font-medium text-sm">{s.service_name}</TableCell><TableCell>${s.total_revenue.toLocaleString()}</TableCell><TableCell>{s.total_quantity}</TableCell><TableCell>${s.avg_unit_price}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent></Card>
        </TabsContent>

        {/* Collections */}
        <TabsContent value="collections">
          <Card><CardContent className="pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div><h3 className="text-sm font-semibold mb-3">By Payment Method</h3>
                {(collections?.by_method || []).map((m, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-border/50"><div className="flex items-center gap-2"><CreditCard className="w-4 h-4 text-blue-500" /><span className="text-sm capitalize">{m.method?.replace("_", " ")}</span></div><div className="text-right"><p className="font-medium">${m.total?.toLocaleString()}</p><p className="text-[10px] text-muted-foreground">{m.count} transactions</p></div></div>
                ))}
              </div>
              <div style={{ width: "100%", height: 250 }}>
                <ResponsiveContainer>
                  <LineChart data={collections?.monthly || []}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" /><XAxis dataKey="month" stroke="#888" fontSize={11} /><YAxis stroke="#888" fontSize={11} /><Tooltip contentStyle={{ backgroundColor: "#1a1a2e", border: "1px solid #333" }} /><Line type="monotone" dataKey="collected" stroke="#22c55e" name="Collected" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </CardContent></Card>
        </TabsContent>

        {/* Tax */}
        <TabsContent value="tax">
          <Card><CardContent className="pt-4">
            <Table>
              <TableHeader><TableRow><TableHead>Quarter</TableHead><TableHead>Subtotal</TableHead><TableHead>Tax Collected</TableHead><TableHead>Total</TableHead><TableHead>Effective Rate</TableHead><TableHead>Invoices</TableHead></TableRow></TableHeader>
              <TableBody>
                {(tax?.quarters || []).map(q => (
                  <TableRow key={q.quarter}><TableCell className="font-medium">{q.quarter}</TableCell><TableCell>${q.subtotal.toLocaleString()}</TableCell><TableCell className="text-amber-500">${q.tax_collected.toLocaleString()}</TableCell><TableCell>${q.total.toLocaleString()}</TableCell><TableCell>{q.effective_tax_rate}%</TableCell><TableCell>{q.invoice_count}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-sm font-medium mt-3">Total Tax Collected: <span className="text-amber-500">${tax?.total_tax_collected?.toLocaleString()}</span></p>
          </CardContent></Card>
        </TabsContent>

        {/* Allocations */}
        <TabsContent value="allocations">
          <Card><CardHeader><CardTitle>Monthly Allocations - {allocations?.month}</CardTitle></CardHeader><CardContent>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <Card className="border-blue-500/20"><CardContent className="pt-3 text-center"><p className="text-xl font-bold text-blue-500">${allocations?.summary?.total_mrr?.toLocaleString()}</p><p className="text-[10px] text-muted-foreground">Recurring (MRR)</p></CardContent></Card>
              <Card className="border-violet-500/20"><CardContent className="pt-3 text-center"><p className="text-xl font-bold text-violet-500">${allocations?.summary?.total_adhoc?.toLocaleString()}</p><p className="text-[10px] text-muted-foreground">Ad-hoc / Project</p></CardContent></Card>
              <Card className="border-emerald-500/20"><CardContent className="pt-3 text-center"><p className="text-xl font-bold text-emerald-500">${allocations?.summary?.total_revenue?.toLocaleString()}</p><p className="text-[10px] text-muted-foreground">Total Revenue</p></CardContent></Card>
            </div>
            <Table>
              <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Client</TableHead><TableHead>Description</TableHead><TableHead>Category</TableHead><TableHead>Amount</TableHead></TableRow></TableHeader>
              <TableBody>
                {(allocations?.allocations || []).slice(0, 30).map((a, i) => (
                  <TableRow key={i}><TableCell><Badge variant="outline" className="text-[9px] capitalize">{a.type?.replace("_", " ")}</Badge></TableCell><TableCell className="text-sm">{a.client_name}</TableCell><TableCell className="text-sm">{a.description}</TableCell><TableCell><Badge variant="outline" className="text-[9px]">{a.category}</Badge></TableCell><TableCell className="font-medium">${a.amount?.toLocaleString()}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
