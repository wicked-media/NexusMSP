import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  DollarSign, TrendingUp, TrendingDown, AlertTriangle, CheckCircle,
  FileText, Users, RefreshCw, Loader2, CreditCard, Receipt, Search,
  ArrowUpRight, BarChart3, Clock, Plus
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart,
  Pie, Cell, Legend
} from "recharts";

const STATUS_COLORS = {
  PAID: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/30" },
  AUTHORISED: { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/30" },
  DRAFT: { bg: "bg-gray-500/10", text: "text-gray-400", border: "border-gray-500/30" },
  VOIDED: { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/30" },
  OVERDUE: { bg: "bg-orange-500/10", text: "text-orange-400", border: "border-orange-500/30" },
};

export default function XeroDashboardPage() {
  const { token } = useAuth();
  const [dashboard, setDashboard] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [payDialog, setPayDialog] = useState(null);
  const [payAmount, setPayAmount] = useState("");
  const headers = { Authorization: `Bearer ${token}` };

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [dRes, iRes, cRes, aRes] = await Promise.all([
        axios.get(`${API}/xero/dashboard`, { headers }),
        axios.get(`${API}/xero/invoices`, { headers }),
        axios.get(`${API}/xero/contacts`, { headers }),
        axios.get(`${API}/xero/accounts`, { headers }),
      ]);
      setDashboard(dRes.data);
      setInvoices(iRes.data);
      setContacts(cRes.data);
      setAccounts(aRes.data);
    } catch { toast.error("Failed to load Xero data"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); }, []);

  const handlePay = async () => {
    if (!payDialog || !payAmount) return;
    try {
      await axios.put(`${API}/xero/invoices/${payDialog.id}/pay`, { amount: parseFloat(payAmount) }, { headers });
      toast.success("Payment recorded");
      setPayDialog(null);
      setPayAmount("");
      fetchAll();
    } catch { toast.error("Payment failed"); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const d = dashboard || {};
  const filteredInvoices = invoices.filter(inv =>
    (!search || inv.client_name?.toLowerCase().includes(search.toLowerCase()) || inv.invoice_number?.toLowerCase().includes(search.toLowerCase())) &&
    (statusFilter === "all" || inv.status === statusFilter)
  );

  const pieData = Object.entries(d.by_status || {}).map(([status, data]) => ({
    name: status, value: data.count, total: data.total,
  }));
  const PIE_COLORS = ["#10b981", "#3b82f6", "#6b7280", "#ef4444", "#f59e0b"];

  return (
    <div className="space-y-6" data-testid="xero-dashboard">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Xero Accounting</h1>
          <p className="text-muted-foreground">Financial overview and invoice management</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchAll} data-testid="refresh-xero"><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        <Card data-testid="stat-revenue">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-3xl font-black text-emerald-400">${(d.total_revenue || 0).toLocaleString("en", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
                <p className="text-[11px] text-muted-foreground">Total Revenue</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-emerald-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="stat-paid">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-3xl font-black text-blue-400">${(d.total_paid || 0).toLocaleString("en", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
                <p className="text-[11px] text-muted-foreground">Collected</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center">
                <CheckCircle className="w-6 h-6 text-blue-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="stat-outstanding">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-3xl font-black text-amber-400">${(d.total_outstanding || 0).toLocaleString("en", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
                <p className="text-[11px] text-muted-foreground">Outstanding</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center">
                <Clock className="w-6 h-6 text-amber-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className={d.total_overdue > 0 ? "border-red-500/40" : ""} data-testid="stat-overdue">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <p className={`text-3xl font-black ${d.total_overdue > 0 ? "text-red-400" : "text-muted-foreground"}`}>
                  ${(d.total_overdue || 0).toLocaleString("en", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </p>
                <p className="text-[11px] text-muted-foreground">Overdue ({d.overdue_count || 0})</p>
              </div>
              <div className={`w-12 h-12 rounded-xl ${d.total_overdue > 0 ? "bg-red-500/10" : "bg-muted/30"} flex items-center justify-center`}>
                <AlertTriangle className={`w-6 h-6 ${d.total_overdue > 0 ? "text-red-400" : "text-muted-foreground"}`} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Monthly Revenue</CardTitle></CardHeader>
          <CardContent>
            {(d.monthly_revenue || []).length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={d.monthly_revenue}>
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={v => [`$${v.toLocaleString()}`, "Revenue"]} />
                  <Bar dataKey="revenue" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="h-[220px] flex items-center justify-center text-muted-foreground">No revenue data</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Invoice Status Breakdown</CardTitle></CardHeader>
          <CardContent>
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
                    {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(value, name) => [value, name]} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : <div className="h-[220px] flex items-center justify-center text-muted-foreground">No invoice data</div>}
          </CardContent>
        </Card>
      </div>

      {/* Tabs: Invoices, Contacts, Accounts */}
      <Tabs defaultValue="invoices">
        <TabsList>
          <TabsTrigger value="invoices"><FileText className="w-3 h-3 mr-1" />Invoices ({invoices.length})</TabsTrigger>
          <TabsTrigger value="contacts"><Users className="w-3 h-3 mr-1" />Contacts ({contacts.length})</TabsTrigger>
          <TabsTrigger value="accounts"><BarChart3 className="w-3 h-3 mr-1" />Accounts ({accounts.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="invoices" className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search invoices..." value={search} onChange={e => setSearch(e.target.value)} data-testid="search-invoices" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px]" data-testid="status-filter"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="DRAFT">Draft</SelectItem>
                <SelectItem value="AUTHORISED">Authorised</SelectItem>
                <SelectItem value="PAID">Paid</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Card>
            <ScrollArea className="h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead><TableHead>Client</TableHead><TableHead>Date</TableHead>
                    <TableHead>Due</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Due</TableHead><TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredInvoices.map(inv => {
                    const sc = STATUS_COLORS[inv.status] || STATUS_COLORS.DRAFT;
                    const isOverdue = inv.status === "AUTHORISED" && inv.due_date < new Date().toISOString().split("T")[0];
                    return (
                      <TableRow key={inv.id} data-testid={`invoice-${inv.id}`}>
                        <TableCell className="font-mono text-sm">{inv.invoice_number}</TableCell>
                        <TableCell>{inv.client_name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{inv.date}</TableCell>
                        <TableCell className={`text-sm ${isOverdue ? "text-red-400 font-medium" : "text-muted-foreground"}`}>{inv.due_date}</TableCell>
                        <TableCell>
                          <Badge className={`${sc.bg} ${sc.text} ${sc.border} text-[10px]`}>
                            {isOverdue ? "OVERDUE" : inv.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">${inv.total?.toLocaleString("en", { minimumFractionDigits: 2 })}</TableCell>
                        <TableCell className={`text-right font-mono ${inv.amount_due > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                          ${inv.amount_due?.toLocaleString("en", { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell>
                          {inv.amount_due > 0 && inv.status !== "DRAFT" && (
                            <Button variant="outline" size="sm" className="h-7 text-[10px]" onClick={() => { setPayDialog(inv); setPayAmount(String(inv.amount_due)); }}
                              data-testid={`pay-${inv.id}`}>
                              <CreditCard className="w-3 h-3 mr-1" />Pay
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          </Card>
        </TabsContent>

        <TabsContent value="contacts">
          <Card>
            <ScrollArea className="h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead><TableHead>Account #</TableHead><TableHead>Xero ID</TableHead>
                    <TableHead>Status</TableHead><TableHead className="text-right">Balance Due</TableHead>
                    <TableHead className="text-right">Overdue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contacts.map(c => (
                    <TableRow key={c.id} data-testid={`contact-${c.id}`}>
                      <TableCell className="font-medium">{c.client_name || c.name}</TableCell>
                      <TableCell className="font-mono text-sm">{c.account_number}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{c.xero_contact_id}</TableCell>
                      <TableCell><Badge className="bg-emerald-500/10 text-emerald-400 text-[10px]">{c.status}</Badge></TableCell>
                      <TableCell className="text-right font-mono">${c.balance_due?.toLocaleString("en", { minimumFractionDigits: 2 })}</TableCell>
                      <TableCell className={`text-right font-mono ${c.overdue_amount > 0 ? "text-red-400" : "text-muted-foreground"}`}>
                        ${c.overdue_amount?.toLocaleString("en", { minimumFractionDigits: 2 })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </Card>
        </TabsContent>

        <TabsContent value="accounts">
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Type</TableHead>
                  <TableHead>Status</TableHead><TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map(a => (
                  <TableRow key={a.id} data-testid={`account-${a.id}`}>
                    <TableCell className="font-mono">{a.code}</TableCell>
                    <TableCell className="font-medium">{a.name}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{a.type}</Badge></TableCell>
                    <TableCell><Badge className="bg-emerald-500/10 text-emerald-400 text-[10px]">{a.status}</Badge></TableCell>
                    <TableCell className="text-right font-mono">${a.balance?.toLocaleString("en", { minimumFractionDigits: 2 })}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Pay Dialog */}
      <Dialog open={!!payDialog} onOpenChange={v => { if (!v) setPayDialog(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Payment - {payDialog?.invoice_number}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Client: {payDialog?.client_name}</p>
            <p className="text-sm">Invoice Total: <span className="font-mono font-bold">${payDialog?.total?.toLocaleString("en", { minimumFractionDigits: 2 })}</span></p>
            <p className="text-sm">Amount Due: <span className="font-mono font-bold text-amber-400">${payDialog?.amount_due?.toLocaleString("en", { minimumFractionDigits: 2 })}</span></p>
            <div>
              <Label>Payment Amount</Label>
              <Input type="number" step="0.01" value={payAmount} onChange={e => setPayAmount(e.target.value)} data-testid="pay-amount" />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handlePay} data-testid="confirm-pay-btn"><CreditCard className="w-4 h-4 mr-1" />Record Payment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
