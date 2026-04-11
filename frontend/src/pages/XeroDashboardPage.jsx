import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  DollarSign, TrendingUp, AlertTriangle, CheckCircle,
  FileText, Users, RefreshCw, Loader2, CreditCard, Receipt, Search,
  ArrowUpRight, BarChart3, Clock, Plus, Send, Eye, Trash2,
  ArrowRightLeft, Ban, Calendar, Zap, History, PieChart,
  Repeat, ArrowRight, Pause, Play, XCircle
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart as RePieChart,
  Pie, Cell, Legend, AreaChart, Area
} from "recharts";

const STATUS_COLORS = {
  PAID: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/30" },
  AUTHORISED: { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/30" },
  DRAFT: { bg: "bg-zinc-500/10", text: "text-zinc-400", border: "border-zinc-500/30" },
  VOIDED: { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/30" },
  OVERDUE: { bg: "bg-orange-500/10", text: "text-orange-400", border: "border-orange-500/30" },
  SENT: { bg: "bg-cyan-500/10", text: "text-cyan-400", border: "border-cyan-500/30" },
  APPROVED: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/30" },
  DECLINED: { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/30" },
  CONVERTED: { bg: "bg-purple-500/10", text: "text-purple-400", border: "border-purple-500/30" },
};

const PIE_COLORS = ["#10b981", "#3b82f6", "#6b7280", "#ef4444", "#f59e0b", "#8b5cf6"];

function StatusBadge({ status }) {
  const sc = STATUS_COLORS[status] || STATUS_COLORS.DRAFT;
  return <Badge className={`${sc.bg} ${sc.text} ${sc.border} text-[10px]`}>{status}</Badge>;
}

function AgingBar({ label, amount, total, color }) {
  const pct = total > 0 ? Math.min((amount / total) * 100, 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono" style={{ color }}>${amount.toLocaleString("en", { minimumFractionDigits: 0 })}</span>
      </div>
      <div className="h-2 bg-muted/20 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

export default function XeroDashboardPage() {
  const { token } = useAuth();
  const [activeTab, setActiveTab] = useState("overview");
  const [dashboard, setDashboard] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [estimates, setEstimates] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [syncHistory, setSyncHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  // Filters
  const [invSearch, setInvSearch] = useState("");
  const [invStatus, setInvStatus] = useState("all");
  const [estSearch, setEstSearch] = useState("");
  // Dialogs
  const [payDialog, setPayDialog] = useState(null);
  const [payAmount, setPayAmount] = useState("");
  const [createInvDialog, setCreateInvDialog] = useState(false);
  const [createEstDialog, setCreateEstDialog] = useState(false);
  const [createRecDialog, setCreateRecDialog] = useState(false);
  const [invForm, setInvForm] = useState({ client_name: "", reference: "", due_date: "", line_items: [{ description: "", quantity: 1, unit_price: 0 }] });
  const [estForm, setEstForm] = useState({ title: "", client_name: "", valid_until: "", notes: "", line_items: [{ description: "", quantity: 1, unit_price: 0 }] });
  const [recForm, setRecForm] = useState({ client_name: "", description: "", frequency: "monthly", line_items: [{ description: "", quantity: 1, unit_price: 0 }] });
  const headers = { Authorization: `Bearer ${token}` };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [dRes, iRes, cRes, aRes, eRes, rRes, sRes] = await Promise.all([
        axios.get(`${API}/xero/dashboard`, { headers }),
        axios.get(`${API}/xero/invoices`, { headers }),
        axios.get(`${API}/xero/contacts`, { headers }),
        axios.get(`${API}/xero/accounts`, { headers }),
        axios.get(`${API}/xero/estimates`, { headers }),
        axios.get(`${API}/xero/recurring`, { headers }),
        axios.get(`${API}/xero/sync-history`, { headers }),
      ]);
      setDashboard(dRes.data);
      setInvoices(iRes.data);
      setContacts(cRes.data);
      setAccounts(aRes.data);
      setEstimates(eRes.data);
      setRecurring(rRes.data);
      setSyncHistory(sRes.data);
    } catch { toast.error("Failed to load financial data"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await axios.post(`${API}/xero/sync`, {}, { headers });
      toast.success("Xero sync completed");
      fetchAll();
    } catch { toast.error("Sync failed"); }
    finally { setSyncing(false); }
  };

  const handlePay = async () => {
    if (!payDialog || !payAmount) return;
    try {
      await axios.put(`${API}/xero/invoices/${payDialog.id}/pay`, { amount: parseFloat(payAmount) }, { headers });
      toast.success("Payment recorded");
      setPayDialog(null); setPayAmount("");
      fetchAll();
    } catch { toast.error("Payment failed"); }
  };

  const handleSendInvoice = async (inv) => {
    try {
      await axios.post(`${API}/xero/invoices/${inv.id}/send`, {}, { headers });
      toast.success(`Invoice ${inv.invoice_number} sent`);
      fetchAll();
    } catch { toast.error("Failed to send"); }
  };

  const handleVoidInvoice = async (inv) => {
    try {
      await axios.put(`${API}/xero/invoices/${inv.id}/void`, {}, { headers });
      toast.success(`Invoice ${inv.invoice_number} voided`);
      fetchAll();
    } catch { toast.error("Failed to void"); }
  };

  const handleCreateInvoice = async () => {
    if (!invForm.client_name) { toast.error("Client name required"); return; }
    try {
      await axios.post(`${API}/xero/invoices`, invForm, { headers });
      toast.success("Invoice created");
      setCreateInvDialog(false);
      setInvForm({ client_name: "", reference: "", due_date: "", line_items: [{ description: "", quantity: 1, unit_price: 0 }] });
      fetchAll();
    } catch { toast.error("Failed to create invoice"); }
  };

  const handleCreateEstimate = async () => {
    if (!estForm.title || !estForm.client_name) { toast.error("Title and client required"); return; }
    try {
      await axios.post(`${API}/xero/estimates`, estForm, { headers });
      toast.success("Estimate created");
      setCreateEstDialog(false);
      setEstForm({ title: "", client_name: "", valid_until: "", notes: "", line_items: [{ description: "", quantity: 1, unit_price: 0 }] });
      fetchAll();
    } catch { toast.error("Failed to create estimate"); }
  };

  const handleConvertEstimate = async (est) => {
    try {
      await axios.post(`${API}/xero/estimates/${est.id}/convert`, {}, { headers });
      toast.success(`Estimate ${est.estimate_number} converted to invoice`);
      fetchAll();
    } catch { toast.error("Conversion failed"); }
  };

  const handleCreateRecurring = async () => {
    if (!recForm.client_name || !recForm.description) { toast.error("Client and description required"); return; }
    try {
      await axios.post(`${API}/xero/recurring`, recForm, { headers });
      toast.success("Recurring template created");
      setCreateRecDialog(false);
      setRecForm({ client_name: "", description: "", frequency: "monthly", line_items: [{ description: "", quantity: 1, unit_price: 0 }] });
      fetchAll();
    } catch { toast.error("Failed to create recurring"); }
  };

  const handleToggleRecurring = async (rec) => {
    try {
      const res = await axios.put(`${API}/xero/recurring/${rec.id}/toggle`, {}, { headers });
      toast.success(`Recurring invoice ${res.data.status}`);
      fetchAll();
    } catch { toast.error("Failed to toggle"); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const d = dashboard || {};
  const filteredInvoices = invoices.filter(inv =>
    (!invSearch || inv.client_name?.toLowerCase().includes(invSearch.toLowerCase()) || inv.invoice_number?.toLowerCase().includes(invSearch.toLowerCase())) &&
    (invStatus === "all" || inv.status === invStatus)
  );
  const filteredEstimates = estimates.filter(est =>
    !estSearch || est.client_name?.toLowerCase().includes(estSearch.toLowerCase()) || est.title?.toLowerCase().includes(estSearch.toLowerCase())
  );
  const pieData = Object.entries(d.by_status || {}).map(([status, data]) => ({ name: status, value: data.count, total: data.total }));
  const aging = d.aging || {};
  const agingTotal = (aging.current || 0) + (aging["30_days"] || 0) + (aging["60_days"] || 0) + (aging["90_plus"] || 0);
  const totalRecurringMRR = recurring.filter(r => r.status === "active" && r.frequency === "monthly").reduce((s, r) => s + (r.amount || 0), 0);

  return (
    <div className="space-y-5" data-testid="xero-dashboard">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Finance Center</h1>
          <p className="text-muted-foreground">Xero-powered accounting, invoicing & financial management</p>
        </div>
        <div className="flex items-center gap-2">
          {d.last_sync && <span className="text-xs text-muted-foreground">Last sync: {new Date(d.last_sync).toLocaleString()}</span>}
          <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing} data-testid="sync-xero-btn">
            <RefreshCw className={`w-4 h-4 mr-1 ${syncing ? "animate-spin" : ""}`} />{syncing ? "Syncing..." : "Sync Xero"}
          </Button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: "Total Revenue", value: d.total_revenue, color: "text-emerald-400", bg: "bg-emerald-500/10", icon: TrendingUp },
          { label: "Collected", value: d.total_paid, color: "text-blue-400", bg: "bg-blue-500/10", icon: CheckCircle },
          { label: "Outstanding", value: d.total_outstanding, color: "text-amber-400", bg: "bg-amber-500/10", icon: Clock },
          { label: "Overdue", value: d.total_overdue, color: "text-red-400", bg: "bg-red-500/10", icon: AlertTriangle, danger: d.total_overdue > 0 },
          { label: "Recurring MRR", value: totalRecurringMRR, color: "text-violet-400", bg: "bg-violet-500/10", icon: Repeat },
        ].map((s, i) => {
          const Icon = s.icon;
          return (
            <Card key={`stat-${i}`} className={s.danger ? "border-red-500/40" : ""} data-testid={`stat-${s.label.toLowerCase().replace(/\s/g, "-")}`}>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className={`text-2xl font-black ${s.color}`}>${(s.value || 0).toLocaleString("en", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
                    <p className="text-[11px] text-muted-foreground">{s.label}</p>
                  </div>
                  <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center`}><Icon className={`w-5 h-5 ${s.color}`} /></div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-8 w-full">
          <TabsTrigger value="overview" data-testid="tab-overview"><BarChart3 className="w-3 h-3 mr-1" />Overview</TabsTrigger>
          <TabsTrigger value="invoices" data-testid="tab-invoices"><Receipt className="w-3 h-3 mr-1" />Invoices ({invoices.length})</TabsTrigger>
          <TabsTrigger value="estimates" data-testid="tab-estimates"><FileText className="w-3 h-3 mr-1" />Estimates ({estimates.length})</TabsTrigger>
          <TabsTrigger value="recurring" data-testid="tab-recurring"><Repeat className="w-3 h-3 mr-1" />Recurring ({recurring.length})</TabsTrigger>
          <TabsTrigger value="contacts" data-testid="tab-contacts"><Users className="w-3 h-3 mr-1" />Contacts ({contacts.length})</TabsTrigger>
          <TabsTrigger value="accounts" data-testid="tab-accounts"><DollarSign className="w-3 h-3 mr-1" />Accounts ({accounts.length})</TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history"><History className="w-3 h-3 mr-1" />Sync Log</TabsTrigger>
          <TabsTrigger value="aging" data-testid="tab-aging"><AlertTriangle className="w-3 h-3 mr-1" />Aging</TabsTrigger>
        </TabsList>

        {/* ============ OVERVIEW TAB ============ */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Monthly Revenue</CardTitle></CardHeader>
              <CardContent>
                {(d.monthly_revenue || []).length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={d.monthly_revenue}>
                      <defs>
                        <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={v => [`$${v.toLocaleString()}`, "Revenue"]} />
                      <Area type="monotone" dataKey="revenue" stroke="#10b981" fill="url(#revGrad)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : <div className="h-[220px] flex items-center justify-center text-muted-foreground">No revenue data</div>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Invoice Status Breakdown</CardTitle></CardHeader>
              <CardContent>
                {pieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <RePieChart>
                      <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
                        {pieData.map((_, i) => <Cell key={`pie-${i}`} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(value, name) => [value, name]} />
                      <Legend />
                    </RePieChart>
                  </ResponsiveContainer>
                ) : <div className="h-[220px] flex items-center justify-center text-muted-foreground">No invoice data</div>}
              </CardContent>
            </Card>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Collection Rate</CardTitle></CardHeader>
              <CardContent>
                <div className="flex items-center gap-4">
                  <div className="relative w-24 h-24">
                    <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
                      <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="8" className="text-muted/20" />
                      <circle cx="50" cy="50" r="40" fill="none" stroke={d.collection_rate >= 80 ? "#10b981" : d.collection_rate >= 50 ? "#f59e0b" : "#ef4444"} strokeWidth="8" strokeLinecap="round"
                        strokeDasharray={2 * Math.PI * 40} strokeDashoffset={2 * Math.PI * 40 * (1 - (d.collection_rate || 0) / 100)}
                        style={{ transition: "stroke-dashoffset 1s ease-in-out" }} />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-xl font-bold">{d.collection_rate || 0}%</span>
                    </div>
                  </div>
                  <div className="space-y-1 text-sm">
                    <p className="text-muted-foreground">Invoices: <span className="font-mono text-foreground">{d.invoice_count || 0}</span></p>
                    <p className="text-muted-foreground">Contacts: <span className="font-mono text-foreground">{d.contacts_count || 0}</span></p>
                    <p className="text-muted-foreground">Estimates: <span className="font-mono text-foreground">{d.estimates_count || 0}</span></p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Receivables Aging</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <AgingBar label="Current" amount={aging.current || 0} total={agingTotal} color="#10b981" />
                <AgingBar label="1-30 Days" amount={aging["30_days"] || 0} total={agingTotal} color="#f59e0b" />
                <AgingBar label="31-60 Days" amount={aging["60_days"] || 0} total={agingTotal} color="#f97316" />
                <AgingBar label="90+ Days" amount={aging["90_plus"] || 0} total={agingTotal} color="#ef4444" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Recent Activity</CardTitle></CardHeader>
              <CardContent>
                <ScrollArea className="h-[140px]">
                  <div className="space-y-2">
                    {syncHistory.slice(0, 6).map(e => (
                      <div key={e.id} className="flex items-start gap-2 text-xs">
                        <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${e.status === "success" ? "bg-emerald-400" : "bg-amber-400"}`} />
                        <div>
                          <p className="text-muted-foreground">{e.message}</p>
                          <p className="text-[10px] text-muted-foreground/60">{new Date(e.timestamp).toLocaleString()}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ============ INVOICES TAB ============ */}
        <TabsContent value="invoices" className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search invoices..." value={invSearch} onChange={e => setInvSearch(e.target.value)} data-testid="search-invoices" />
            </div>
            <Select value={invStatus} onValueChange={setInvStatus}>
              <SelectTrigger className="w-[150px]" data-testid="inv-status-filter"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="DRAFT">Draft</SelectItem>
                <SelectItem value="AUTHORISED">Authorised</SelectItem>
                <SelectItem value="PAID">Paid</SelectItem>
                <SelectItem value="VOIDED">Voided</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" onClick={() => setCreateInvDialog(true)} data-testid="create-invoice-btn"><Plus className="w-4 h-4 mr-1" />New Invoice</Button>
          </div>
          <Card>
            <ScrollArea className="h-[420px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead><TableHead>Client</TableHead><TableHead>Date</TableHead>
                    <TableHead>Due</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Due</TableHead><TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredInvoices.map(inv => {
                    const isOverdue = inv.status === "AUTHORISED" && inv.due_date < new Date().toISOString().split("T")[0];
                    return (
                      <TableRow key={inv.id} data-testid={`invoice-${inv.id}`}>
                        <TableCell className="font-mono text-sm">{inv.invoice_number}</TableCell>
                        <TableCell>{inv.client_name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{inv.date}</TableCell>
                        <TableCell className={`text-sm ${isOverdue ? "text-red-400 font-medium" : "text-muted-foreground"}`}>{inv.due_date}</TableCell>
                        <TableCell><StatusBadge status={isOverdue ? "OVERDUE" : inv.status} /></TableCell>
                        <TableCell className="text-right font-mono">${inv.total?.toLocaleString("en", { minimumFractionDigits: 2 })}</TableCell>
                        <TableCell className={`text-right font-mono ${inv.amount_due > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                          ${inv.amount_due?.toLocaleString("en", { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {inv.status === "DRAFT" && (
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleSendInvoice(inv)} title="Send">
                                <Send className="w-3.5 h-3.5 text-blue-400" />
                              </Button>
                            )}
                            {inv.amount_due > 0 && inv.status !== "DRAFT" && inv.status !== "VOIDED" && (
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setPayDialog(inv); setPayAmount(String(inv.amount_due)); }} title="Record Payment" data-testid={`pay-${inv.id}`}>
                                <CreditCard className="w-3.5 h-3.5 text-emerald-400" />
                              </Button>
                            )}
                            {inv.status !== "PAID" && inv.status !== "VOIDED" && (
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleVoidInvoice(inv)} title="Void">
                                <Ban className="w-3.5 h-3.5 text-red-400" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          </Card>
        </TabsContent>

        {/* ============ ESTIMATES TAB ============ */}
        <TabsContent value="estimates" className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search estimates..." value={estSearch} onChange={e => setEstSearch(e.target.value)} data-testid="search-estimates" />
            </div>
            <Button size="sm" onClick={() => setCreateEstDialog(true)} data-testid="create-estimate-btn"><Plus className="w-4 h-4 mr-1" />New Estimate</Button>
          </div>
          <Card>
            <ScrollArea className="h-[420px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Estimate #</TableHead><TableHead>Title</TableHead><TableHead>Client</TableHead>
                    <TableHead>Status</TableHead><TableHead>Valid Until</TableHead><TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEstimates.map(est => (
                    <TableRow key={est.id} data-testid={`estimate-${est.id}`}>
                      <TableCell className="font-mono text-sm">{est.estimate_number}</TableCell>
                      <TableCell className="font-medium">{est.title}</TableCell>
                      <TableCell>{est.client_name}</TableCell>
                      <TableCell><StatusBadge status={est.status} /></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{est.valid_until}</TableCell>
                      <TableCell className="text-right font-mono">${est.total?.toLocaleString("en", { minimumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {est.status !== "CONVERTED" && est.status !== "DECLINED" && (
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px]" onClick={() => handleConvertEstimate(est)} data-testid={`convert-${est.id}`}>
                              <ArrowRight className="w-3 h-3 mr-1 text-purple-400" />Convert
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </Card>
        </TabsContent>

        {/* ============ RECURRING TAB ============ */}
        <TabsContent value="recurring" className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Card className="border-none shadow-none bg-violet-500/5"><CardContent className="py-2 px-4 flex items-center gap-2">
                <Repeat className="w-4 h-4 text-violet-400" /><span className="text-sm text-muted-foreground">Active MRR:</span>
                <span className="font-mono font-bold text-violet-400">${totalRecurringMRR.toLocaleString()}/mo</span>
              </CardContent></Card>
            </div>
            <Button size="sm" onClick={() => setCreateRecDialog(true)} data-testid="create-recurring-btn"><Plus className="w-4 h-4 mr-1" />New Template</Button>
          </div>
          <div className="space-y-2">
            {recurring.map(rec => (
              <Card key={rec.id} data-testid={`recurring-${rec.id}`}>
                <CardContent className="py-3 px-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${rec.status === "active" ? "bg-violet-500/10" : "bg-muted/30"}`}>
                        <Repeat className={`w-4 h-4 ${rec.status === "active" ? "text-violet-400" : "text-muted-foreground"}`} />
                      </div>
                      <div>
                        <p className="font-medium text-sm">{rec.client_name}</p>
                        <p className="text-xs text-muted-foreground">{rec.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="font-mono font-bold">${rec.amount?.toLocaleString()}<span className="text-xs text-muted-foreground font-normal">/{rec.frequency === "monthly" ? "mo" : "yr"}</span></p>
                        <p className="text-[10px] text-muted-foreground">Next: {rec.next_generation} | Generated: {rec.invoices_generated}x</p>
                      </div>
                      <Badge variant={rec.status === "active" ? "default" : "secondary"} className="text-[10px]">{rec.status}</Badge>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleToggleRecurring(rec)} title={rec.status === "active" ? "Pause" : "Resume"}>
                        {rec.status === "active" ? <Pause className="w-3.5 h-3.5 text-amber-400" /> : <Play className="w-3.5 h-3.5 text-emerald-400" />}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* ============ CONTACTS TAB ============ */}
        <TabsContent value="contacts">
          <Card>
            <ScrollArea className="h-[420px]">
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

        {/* ============ ACCOUNTS TAB ============ */}
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

        {/* ============ SYNC HISTORY TAB ============ */}
        <TabsContent value="history">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Xero Sync History</CardTitle>
                <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing} data-testid="trigger-sync-btn">
                  <RefreshCw className={`w-3 h-3 mr-1 ${syncing ? "animate-spin" : ""}`} />Trigger Sync
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[380px]">
                <div className="space-y-2">
                  {syncHistory.map(e => (
                    <div key={e.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted/20 transition-colors" data-testid={`sync-${e.id}`}>
                      <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${e.status === "success" ? "bg-emerald-400" : "bg-amber-400"}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[9px] px-1.5">{e.event_type}</Badge>
                          <span className="text-[10px] text-muted-foreground">{new Date(e.timestamp).toLocaleString()}</span>
                        </div>
                        <p className="text-sm mt-0.5">{e.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============ AGING TAB ============ */}
        <TabsContent value="aging" className="space-y-4">
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: "Current", amount: aging.current || 0, color: "text-emerald-400", bg: "bg-emerald-500/10" },
              { label: "1-30 Days", amount: aging["30_days"] || 0, color: "text-amber-400", bg: "bg-amber-500/10" },
              { label: "31-60 Days", amount: aging["60_days"] || 0, color: "text-orange-400", bg: "bg-orange-500/10" },
              { label: "90+ Days", amount: aging["90_plus"] || 0, color: "text-red-400", bg: "bg-red-500/10" },
            ].map((b, i) => (
              <Card key={`aging-${i}`}>
                <CardContent className="pt-4 pb-3">
                  <p className="text-[11px] text-muted-foreground">{b.label}</p>
                  <p className={`text-2xl font-black ${b.color}`}>${b.amount.toLocaleString("en", { minimumFractionDigits: 0 })}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Overdue Invoices</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead><TableHead>Client</TableHead><TableHead>Due Date</TableHead>
                    <TableHead>Days Overdue</TableHead><TableHead className="text-right">Amount Due</TableHead><TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.filter(inv => inv.status === "AUTHORISED" && inv.due_date < new Date().toISOString().split("T")[0]).map(inv => {
                    const daysOverdue = Math.floor((new Date() - new Date(inv.due_date)) / (1000 * 60 * 60 * 24));
                    return (
                      <TableRow key={inv.id}>
                        <TableCell className="font-mono">{inv.invoice_number}</TableCell>
                        <TableCell>{inv.client_name}</TableCell>
                        <TableCell className="text-red-400">{inv.due_date}</TableCell>
                        <TableCell><Badge variant="destructive" className="text-[10px]">{daysOverdue}d overdue</Badge></TableCell>
                        <TableCell className="text-right font-mono text-red-400">${inv.amount_due?.toLocaleString("en", { minimumFractionDigits: 2 })}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px]" onClick={() => { setPayDialog(inv); setPayAmount(String(inv.amount_due)); }}>
                            <CreditCard className="w-3 h-3 mr-1" />Record Payment
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {invoices.filter(inv => inv.status === "AUTHORISED" && inv.due_date < new Date().toISOString().split("T")[0]).length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No overdue invoices</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ============ DIALOGS ============ */}

      {/* Pay Dialog */}
      <Dialog open={!!payDialog} onOpenChange={v => { if (!v) setPayDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Payment - {payDialog?.invoice_number}</DialogTitle>
            <DialogDescription>Record a payment against this invoice</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Client: {payDialog?.client_name}</p>
            <p className="text-sm">Invoice Total: <span className="font-mono font-bold">${payDialog?.total?.toLocaleString("en", { minimumFractionDigits: 2 })}</span></p>
            <p className="text-sm">Amount Due: <span className="font-mono font-bold text-amber-400">${payDialog?.amount_due?.toLocaleString("en", { minimumFractionDigits: 2 })}</span></p>
            <div><Label>Payment Amount</Label><Input type="number" step="0.01" value={payAmount} onChange={e => setPayAmount(e.target.value)} data-testid="pay-amount" /></div>
          </div>
          <DialogFooter><Button onClick={handlePay} data-testid="confirm-pay-btn"><CreditCard className="w-4 h-4 mr-1" />Record Payment</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Invoice Dialog */}
      <Dialog open={createInvDialog} onOpenChange={setCreateInvDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Invoice</DialogTitle>
            <DialogDescription>Create a new Xero invoice</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Client Name</Label><Input value={invForm.client_name} onChange={e => setInvForm(p => ({ ...p, client_name: e.target.value }))} data-testid="inv-client" /></div>
            <div><Label>Reference</Label><Input value={invForm.reference} onChange={e => setInvForm(p => ({ ...p, reference: e.target.value }))} /></div>
            <div><Label>Due Date</Label><Input type="date" value={invForm.due_date} onChange={e => setInvForm(p => ({ ...p, due_date: e.target.value }))} /></div>
            <Separator />
            <div className="space-y-2">
              <Label>Line Items</Label>
              {invForm.line_items.map((item, i) => (
                <div key={`inv-li-${i}`} className="grid grid-cols-6 gap-2">
                  <Input className="col-span-3" placeholder="Description" value={item.description} onChange={e => { const items = [...invForm.line_items]; items[i] = { ...items[i], description: e.target.value }; setInvForm(p => ({ ...p, line_items: items })); }} />
                  <Input type="number" placeholder="Qty" value={item.quantity} onChange={e => { const items = [...invForm.line_items]; items[i] = { ...items[i], quantity: Number(e.target.value) }; setInvForm(p => ({ ...p, line_items: items })); }} />
                  <Input type="number" placeholder="Price" value={item.unit_price} onChange={e => { const items = [...invForm.line_items]; items[i] = { ...items[i], unit_price: Number(e.target.value) }; setInvForm(p => ({ ...p, line_items: items })); }} />
                  <Button variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={() => { const items = invForm.line_items.filter((_, j) => j !== i); setInvForm(p => ({ ...p, line_items: items.length ? items : [{ description: "", quantity: 1, unit_price: 0 }] })); }}>
                    <XCircle className="w-4 h-4 text-muted-foreground" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" className="text-xs" onClick={() => setInvForm(p => ({ ...p, line_items: [...p.line_items, { description: "", quantity: 1, unit_price: 0 }] }))}>
                <Plus className="w-3 h-3 mr-1" />Add Line
              </Button>
            </div>
          </div>
          <DialogFooter><Button onClick={handleCreateInvoice} data-testid="submit-invoice-btn"><Plus className="w-4 h-4 mr-1" />Create Invoice</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Estimate Dialog */}
      <Dialog open={createEstDialog} onOpenChange={setCreateEstDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Estimate</DialogTitle>
            <DialogDescription>Create a new project estimate</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Title</Label><Input value={estForm.title} onChange={e => setEstForm(p => ({ ...p, title: e.target.value }))} data-testid="est-title" /></div>
            <div><Label>Client Name</Label><Input value={estForm.client_name} onChange={e => setEstForm(p => ({ ...p, client_name: e.target.value }))} data-testid="est-client" /></div>
            <div><Label>Valid Until</Label><Input type="date" value={estForm.valid_until} onChange={e => setEstForm(p => ({ ...p, valid_until: e.target.value }))} /></div>
            <div><Label>Notes</Label><Textarea rows={2} value={estForm.notes} onChange={e => setEstForm(p => ({ ...p, notes: e.target.value }))} /></div>
            <Separator />
            <div className="space-y-2">
              <Label>Line Items</Label>
              {estForm.line_items.map((item, i) => (
                <div key={`est-li-${i}`} className="grid grid-cols-6 gap-2">
                  <Input className="col-span-3" placeholder="Description" value={item.description} onChange={e => { const items = [...estForm.line_items]; items[i] = { ...items[i], description: e.target.value }; setEstForm(p => ({ ...p, line_items: items })); }} />
                  <Input type="number" placeholder="Qty" value={item.quantity} onChange={e => { const items = [...estForm.line_items]; items[i] = { ...items[i], quantity: Number(e.target.value) }; setEstForm(p => ({ ...p, line_items: items })); }} />
                  <Input type="number" placeholder="Price" value={item.unit_price} onChange={e => { const items = [...estForm.line_items]; items[i] = { ...items[i], unit_price: Number(e.target.value) }; setEstForm(p => ({ ...p, line_items: items })); }} />
                  <Button variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={() => { const items = estForm.line_items.filter((_, j) => j !== i); setEstForm(p => ({ ...p, line_items: items.length ? items : [{ description: "", quantity: 1, unit_price: 0 }] })); }}>
                    <XCircle className="w-4 h-4 text-muted-foreground" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" className="text-xs" onClick={() => setEstForm(p => ({ ...p, line_items: [...p.line_items, { description: "", quantity: 1, unit_price: 0 }] }))}>
                <Plus className="w-3 h-3 mr-1" />Add Line
              </Button>
            </div>
          </div>
          <DialogFooter><Button onClick={handleCreateEstimate} data-testid="submit-estimate-btn"><Plus className="w-4 h-4 mr-1" />Create Estimate</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Recurring Dialog */}
      <Dialog open={createRecDialog} onOpenChange={setCreateRecDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Recurring Template</DialogTitle>
            <DialogDescription>Set up automated recurring invoicing</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Client Name</Label><Input value={recForm.client_name} onChange={e => setRecForm(p => ({ ...p, client_name: e.target.value }))} data-testid="rec-client" /></div>
            <div><Label>Description</Label><Input value={recForm.description} onChange={e => setRecForm(p => ({ ...p, description: e.target.value }))} /></div>
            <div><Label>Frequency</Label>
              <Select value={recForm.frequency} onValueChange={v => setRecForm(p => ({ ...p, frequency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="yearly">Yearly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Separator />
            <div className="space-y-2">
              <Label>Line Items</Label>
              {recForm.line_items.map((item, i) => (
                <div key={`rec-li-${i}`} className="grid grid-cols-6 gap-2">
                  <Input className="col-span-3" placeholder="Description" value={item.description} onChange={e => { const items = [...recForm.line_items]; items[i] = { ...items[i], description: e.target.value }; setRecForm(p => ({ ...p, line_items: items })); }} />
                  <Input type="number" placeholder="Qty" value={item.quantity} onChange={e => { const items = [...recForm.line_items]; items[i] = { ...items[i], quantity: Number(e.target.value) }; setRecForm(p => ({ ...p, line_items: items })); }} />
                  <Input type="number" placeholder="Price" value={item.unit_price} onChange={e => { const items = [...recForm.line_items]; items[i] = { ...items[i], unit_price: Number(e.target.value) }; setRecForm(p => ({ ...p, line_items: items })); }} />
                  <Button variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={() => { const items = recForm.line_items.filter((_, j) => j !== i); setRecForm(p => ({ ...p, line_items: items.length ? items : [{ description: "", quantity: 1, unit_price: 0 }] })); }}>
                    <XCircle className="w-4 h-4 text-muted-foreground" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" className="text-xs" onClick={() => setRecForm(p => ({ ...p, line_items: [...p.line_items, { description: "", quantity: 1, unit_price: 0 }] }))}>
                <Plus className="w-3 h-3 mr-1" />Add Line
              </Button>
            </div>
          </div>
          <DialogFooter><Button onClick={handleCreateRecurring} data-testid="submit-recurring-btn"><Plus className="w-4 h-4 mr-1" />Create Template</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
