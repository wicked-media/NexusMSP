import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Phone, Plus, Search, Loader2, Edit, Trash2, DollarSign,
  ArrowLeft, CheckCircle, AlertTriangle, RefreshCw,
  CreditCard, Smartphone, Calendar, TrendingUp,
  ArrowRightLeft, RotateCcw, Receipt, ChevronRight
} from "lucide-react";

const STATUS_CONFIG = {
  active: { label: "Active", class: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  completed: { label: "Completed", class: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  overdue: { label: "Overdue", class: "bg-red-500/20 text-red-400 border-red-500/30" },
  cancelled: { label: "Cancelled", class: "bg-gray-500/20 text-gray-400 border-gray-500/30" },
  returned: { label: "Returned", class: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
};

const DEVICE_STATUS = {
  available: { label: "Available", class: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  rented: { label: "Rented", class: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  sold: { label: "Sold", class: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  returned: { label: "Returned", class: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  decommissioned: { label: "Decommissioned", class: "bg-gray-500/20 text-gray-400 border-gray-500/30" },
};

const CONDITION_MAP = { new: "New", excellent: "Excellent", good: "Good", fair: "Fair", damaged: "Damaged" };

const emptyDeviceForm = { model_name: "", serial_number: "", mac_address: "", imei: "", firmware_version: "", condition: "new", notes: "", purchase_price: "0", purchase_date: "", vendor_id: "", warranty_expiry: "" };
const emptyAgreementForm = { client_id: "", device_id: "", agreement_type: "rental", start_date: "", end_date: "", device_cost: "0", deposit_amount: "0", monthly_amount: "0", total_payments: "0", notes: "" };

export default function RentalsPage() {
  const { token } = useAuth();
  const [mainTab, setMainTab] = useState("agreements");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  // Data
  const [agreements, setAgreements] = useState([]);
  const [devices, setDevices] = useState([]);
  const [clients, setClients] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [yealinkModels, setYealinkModels] = useState([]);
  const [stats, setStats] = useState(null);

  // Dialogs
  const [deviceDialog, setDeviceDialog] = useState(false);
  const [agreementDialog, setAgreementDialog] = useState(false);
  const [paymentDialog, setPaymentDialog] = useState(false);
  const [returnDialog, setReturnDialog] = useState(false);
  const [viewAgreement, setViewAgreement] = useState(null);
  const [editingDevice, setEditingDevice] = useState(null);

  // Forms
  const [deviceForm, setDeviceForm] = useState({ ...emptyDeviceForm });
  const [agreementForm, setAgreementForm] = useState({ ...emptyAgreementForm });
  const [paymentForm, setPaymentForm] = useState({ amount: "", method: "bank_transfer", note: "", is_deposit: false });
  const [returnForm, setReturnForm] = useState({ condition: "good", notes: "" });

  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [agRes, devRes, cliRes, vendRes, modelsRes, statsRes] = await Promise.all([
        axios.get(`${API}/rentals`, { headers }),
        axios.get(`${API}/rental-devices`, { headers }),
        axios.get(`${API}/clients`, { headers }),
        axios.get(`${API}/vendors`, { headers }),
        axios.get(`${API}/rental-devices/models`, { headers }),
        axios.get(`${API}/rentals/stats`, { headers }),
      ]);
      setAgreements(agRes.data);
      setDevices(devRes.data);
      setClients(cliRes.data);
      setVendors(vendRes.data);
      setYealinkModels(modelsRes.data);
      setStats(statsRes.data);
    } catch { toast.error("Failed to load rental data"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- DEVICE CRUD ----
  const openAddDevice = () => { setEditingDevice(null); setDeviceForm({ ...emptyDeviceForm }); setDeviceDialog(true); };
  const openEditDevice = (d) => {
    setEditingDevice(d);
    setDeviceForm({
      model_name: d.model_name || "", serial_number: d.serial_number || "", mac_address: d.mac_address || "",
      imei: d.imei || "", firmware_version: d.firmware_version || "", condition: d.condition || "new",
      notes: d.notes || "", purchase_price: String(d.purchase_price || 0), purchase_date: d.purchase_date || "",
      vendor_id: d.vendor_id || "", warranty_expiry: d.warranty_expiry || "",
    });
    setDeviceDialog(true);
  };

  const handleSaveDevice = async () => {
    if (!deviceForm.model_name || !deviceForm.serial_number) { toast.error("Model and serial number required"); return; }
    try {
      const payload = { ...deviceForm, purchase_price: parseFloat(deviceForm.purchase_price) || 0 };
      if (editingDevice) {
        await axios.put(`${API}/rental-devices/${editingDevice.id}`, payload, { headers });
        toast.success("Device updated");
      } else {
        await axios.post(`${API}/rental-devices`, payload, { headers });
        toast.success("Device added to inventory");
      }
      setDeviceDialog(false); fetchData();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to save device"); }
  };

  const handleDeleteDevice = async (id) => {
    try {
      await axios.delete(`${API}/rental-devices/${id}`, { headers });
      toast.success("Device removed"); fetchData();
    } catch (e) { toast.error(e.response?.data?.detail || "Cannot delete device"); }
  };

  // ---- AGREEMENT CRUD ----
  const openNewAgreement = () => {
    setAgreementForm({ ...emptyAgreementForm, start_date: new Date().toISOString().split("T")[0] });
    setAgreementDialog(true);
  };

  const handleCreateAgreement = async () => {
    if (!agreementForm.client_id || !agreementForm.device_id || !agreementForm.start_date) {
      toast.error("Client, device, and start date are required"); return;
    }
    try {
      const payload = {
        ...agreementForm,
        device_cost: parseFloat(agreementForm.device_cost) || 0,
        deposit_amount: parseFloat(agreementForm.deposit_amount) || 0,
        monthly_amount: parseFloat(agreementForm.monthly_amount) || 0,
        total_payments: parseInt(agreementForm.total_payments) || 0,
      };
      await axios.post(`${API}/rentals`, payload, { headers });
      toast.success(payload.agreement_type === "buy_outright" ? "Sale recorded" : "Rental agreement created");
      setAgreementDialog(false); fetchData();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to create agreement"); }
  };

  // ---- PAYMENT ----
  const openPaymentDialog = (rental) => {
    setViewAgreement(rental);
    setPaymentForm({ amount: String(rental.monthly_amount || 0), method: "bank_transfer", note: "", is_deposit: false });
    setPaymentDialog(true);
  };

  const handleRecordPayment = async () => {
    if (!paymentForm.amount || parseFloat(paymentForm.amount) <= 0) { toast.error("Enter a valid amount"); return; }
    try {
      const res = await axios.post(`${API}/rentals/${viewAgreement.id}/payment`, {
        amount: parseFloat(paymentForm.amount), method: paymentForm.method,
        note: paymentForm.note, is_deposit: paymentForm.is_deposit,
      }, { headers });
      toast.success(`Payment of $${paymentForm.amount} recorded. ${res.data.remaining_payments} payments remaining.`);
      setPaymentDialog(false); fetchData();
      if (viewAgreement) {
        const updated = await axios.get(`${API}/rentals/${viewAgreement.id}`, { headers });
        setViewAgreement(updated.data);
      }
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to record payment"); }
  };

  // ---- RETURN ----
  const openReturnDialog = (rental) => { setViewAgreement(rental); setReturnForm({ condition: "good", notes: "" }); setReturnDialog(true); };

  const handleReturnDevice = async () => {
    try {
      await axios.post(`${API}/rentals/${viewAgreement.id}/return`, returnForm, { headers });
      toast.success("Device returned successfully");
      setReturnDialog(false); setViewAgreement(null); fetchData();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to process return"); }
  };

  // Filters
  const filteredAgreements = agreements
    .filter(a => statusFilter === "all" || a.status === statusFilter)
    .filter(a => typeFilter === "all" || a.agreement_type === typeFilter)
    .filter(a => !search || a.client_name?.toLowerCase().includes(search.toLowerCase()) || a.device_model?.toLowerCase().includes(search.toLowerCase()) || a.device_serial?.toLowerCase().includes(search.toLowerCase()));

  const filteredDevices = devices
    .filter(d => statusFilter === "all" || d.status === statusFilter)
    .filter(d => !search || d.model_name?.toLowerCase().includes(search.toLowerCase()) || d.serial_number?.toLowerCase().includes(search.toLowerCase()) || d.mac_address?.toLowerCase().includes(search.toLowerCase()));

  const availableDevices = devices.filter(d => d.status === "available" || d.status === "returned");

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  // ============ AGREEMENT DETAIL VIEW ============
  if (viewAgreement) {
    const r = viewAgreement;
    const progress = r.total_payments > 0 ? (r.payments_made / r.total_payments) * 100 : (r.agreement_type === "buy_outright" ? 100 : 0);
    const remaining = r.total_payments > 0 ? r.total_payments - r.payments_made : 0;
    const remainingAmount = Math.max(0, (r.device_cost || 0) - (r.amount_paid || 0));
    const sc = STATUS_CONFIG[r.status] || STATUS_CONFIG.active;

    return (
      <div className="space-y-6" data-testid="rental-detail">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setViewAgreement(null)} data-testid="back-to-rentals"><ArrowLeft className="w-4 h-4 mr-1" />Back</Button>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
            <span className="font-semibold">{r.client_name}</span>
            <Badge className={sc.class}>{sc.label}</Badge>
            <Badge variant="outline">{r.agreement_type === "buy_outright" ? "Purchase" : r.agreement_type === "lease_to_own" ? "Lease to Own" : "Rental"}</Badge>
          </div>
          <div className="flex gap-2">
            {r.status === "active" && (
              <>
                <Button size="sm" onClick={() => openPaymentDialog(r)} data-testid="record-payment-btn"><CreditCard className="w-3 h-3 mr-1" />Record Payment</Button>
                <Button size="sm" variant="outline" onClick={() => openReturnDialog(r)} data-testid="return-device-btn"><RotateCcw className="w-3 h-3 mr-1" />Return Device</Button>
              </>
            )}
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Device</p><p className="font-semibold text-sm">{r.device_model}</p><p className="text-xs text-muted-foreground font-mono">{r.device_serial}</p></CardContent></Card>
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Total Cost</p><p className="text-xl font-bold">${(r.device_cost || 0).toFixed(2)}</p></CardContent></Card>
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Amount Paid</p><p className="text-xl font-bold text-emerald-400">${(r.amount_paid || 0).toFixed(2)}</p></CardContent></Card>
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Remaining</p><p className="text-xl font-bold text-amber-400">${remainingAmount.toFixed(2)}</p></CardContent></Card>
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Payments</p><p className="text-xl font-bold">{r.payments_made}/{r.total_payments || "N/A"}</p>{remaining > 0 && <p className="text-xs text-muted-foreground">{remaining} remaining</p>}</CardContent></Card>
        </div>

        {/* Progress */}
        {r.agreement_type !== "buy_outright" && r.total_payments > 0 && (
          <Card>
            <CardContent className="pt-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Payment Progress</span>
                <span className="font-medium">{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} className="h-3" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Monthly: ${(r.monthly_amount || 0).toFixed(2)}</span>
                {r.next_payment_date && <span>Next payment: {r.next_payment_date}</span>}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Details Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Smartphone className="w-4 h-4" />Device Details</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Model</span><span>{r.device_model}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Serial</span><span className="font-mono">{r.device_serial}</span></div>
              {r.device_mac && <div className="flex justify-between"><span className="text-muted-foreground">MAC</span><span className="font-mono">{r.device_mac}</span></div>}
              <div className="flex justify-between"><span className="text-muted-foreground">Deposit</span><span>${(r.deposit_amount || 0).toFixed(2)} {r.deposit_paid ? <Badge className="ml-1 bg-emerald-500/20 text-emerald-400 text-[10px]">Paid</Badge> : <Badge className="ml-1 bg-amber-500/20 text-amber-400 text-[10px]">Pending</Badge>}</span></div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Calendar className="w-4 h-4" />Agreement Details</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Start Date</span><span>{r.start_date}</span></div>
              {r.end_date && <div className="flex justify-between"><span className="text-muted-foreground">End Date</span><span>{r.end_date}</span></div>}
              {r.return_date && <div className="flex justify-between"><span className="text-muted-foreground">Returned</span><span>{r.return_date}</span></div>}
              {r.return_condition && <div className="flex justify-between"><span className="text-muted-foreground">Return Condition</span><span className="capitalize">{r.return_condition}</span></div>}
              {r.notes && <div className="pt-2"><p className="text-muted-foreground">Notes</p><p>{r.notes}</p></div>}
            </CardContent>
          </Card>
        </div>

        {/* Payment History */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Receipt className="w-4 h-4" />Payment History</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Date</TableHead><TableHead>Amount</TableHead><TableHead>Method</TableHead><TableHead>Type</TableHead><TableHead>Recorded By</TableHead><TableHead>Note</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {(r.payment_history || []).map((p, i) => (
                  <TableRow key={p.id || i}>
                    <TableCell className="text-xs">{p.date ? new Date(p.date).toLocaleDateString() : "-"}</TableCell>
                    <TableCell className="font-medium">${(p.amount || 0).toFixed(2)}</TableCell>
                    <TableCell className="capitalize text-xs">{(p.method || "").replace("_", " ")}</TableCell>
                    <TableCell>{p.is_deposit ? <Badge variant="outline" className="text-xs">Deposit</Badge> : <Badge variant="secondary" className="text-xs">Payment</Badge>}</TableCell>
                    <TableCell className="text-xs">{p.recorded_by || "-"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.note || "-"}</TableCell>
                  </TableRow>
                ))}
                {(!r.payment_history || r.payment_history.length === 0) && (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No payments recorded yet</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ============ MAIN VIEW ============
  return (
    <div className="space-y-6" data-testid="rentals-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Phone Rentals & Sales</h1>
          <p className="text-muted-foreground">Manage Yealink phone inventory, rentals, and outright purchases</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
          {mainTab === "inventory" && <Button onClick={openAddDevice} data-testid="add-device-btn"><Plus className="w-4 h-4 mr-1" />Add Device</Button>}
          {mainTab === "agreements" && <Button onClick={openNewAgreement} data-testid="new-agreement-btn"><Plus className="w-4 h-4 mr-1" />New Agreement</Button>}
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card><CardContent className="pt-4"><div className="flex items-center gap-2"><Phone className="w-5 h-5 text-blue-500" /><div><p className="text-xs text-muted-foreground">Total Devices</p><p className="text-xl font-bold">{stats.total_devices}</p></div></div></CardContent></Card>
          <Card><CardContent className="pt-4"><div className="flex items-center gap-2"><CheckCircle className="w-5 h-5 text-emerald-500" /><div><p className="text-xs text-muted-foreground">Available</p><p className="text-xl font-bold">{stats.available_devices}</p></div></div></CardContent></Card>
          <Card><CardContent className="pt-4"><div className="flex items-center gap-2"><ArrowRightLeft className="w-5 h-5 text-cyan-500" /><div><p className="text-xs text-muted-foreground">Active Rentals</p><p className="text-xl font-bold">{stats.active}</p></div></div></CardContent></Card>
          <Card className={stats.overdue > 0 ? "border-red-500/40" : ""}><CardContent className="pt-4"><div className="flex items-center gap-2"><AlertTriangle className={`w-5 h-5 ${stats.overdue > 0 ? "text-red-500" : "text-muted-foreground"}`} /><div><p className="text-xs text-muted-foreground">Overdue</p><p className="text-xl font-bold">{stats.overdue}</p></div></div></CardContent></Card>
          <Card><CardContent className="pt-4"><div className="flex items-center gap-2"><TrendingUp className="w-5 h-5 text-emerald-500" /><div><p className="text-xs text-muted-foreground">Revenue</p><p className="text-xl font-bold">${(stats.total_revenue || 0).toLocaleString()}</p></div></div></CardContent></Card>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={mainTab} onValueChange={v => { setMainTab(v); setSearch(""); setStatusFilter("all"); setTypeFilter("all"); }}>
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="agreements" data-testid="tab-agreements">Agreements ({agreements.length})</TabsTrigger>
            <TabsTrigger value="inventory" data-testid="tab-inventory">Device Inventory ({devices.length})</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[130px]" data-testid="status-filter"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {mainTab === "agreements"
                  ? Object.entries(STATUS_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)
                  : Object.entries(DEVICE_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)
                }
              </SelectContent>
            </Select>
            {mainTab === "agreements" && (
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-[140px]" data-testid="type-filter"><SelectValue placeholder="Type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="rental">Rental</SelectItem>
                  <SelectItem value="buy_outright">Buy Outright</SelectItem>
                  <SelectItem value="lease_to_own">Lease to Own</SelectItem>
                </SelectContent>
              </Select>
            )}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9 w-[220px]" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} data-testid="search-input" />
            </div>
          </div>
        </div>

        {/* AGREEMENTS TAB */}
        <TabsContent value="agreements" className="space-y-3 mt-4">
          {filteredAgreements.map(a => {
            const sc = STATUS_CONFIG[a.status] || STATUS_CONFIG.active;
            const progress = a.total_payments > 0 ? Math.round((a.payments_made / a.total_payments) * 100) : (a.agreement_type === "buy_outright" ? 100 : 0);
            return (
              <Card key={a.id} className="hover:border-primary/40 transition-colors cursor-pointer" onClick={() => setViewAgreement(a)} data-testid={`agreement-${a.id}`}>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${a.agreement_type === "buy_outright" ? "bg-purple-500/10" : a.agreement_type === "lease_to_own" ? "bg-amber-500/10" : "bg-cyan-500/10"}`}>
                        {a.agreement_type === "buy_outright" ? <DollarSign className="w-5 h-5 text-purple-500" /> : <Phone className="w-5 h-5 text-cyan-500" />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold">{a.client_name}</p>
                          <Badge className={sc.class}>{sc.label}</Badge>
                          <Badge variant="outline" className="text-[10px]">{a.agreement_type === "buy_outright" ? "Purchase" : a.agreement_type === "lease_to_own" ? "Lease to Own" : "Rental"}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{a.device_model} - SN: {a.device_serial} {a.device_mac ? `| MAC: ${a.device_mac}` : ""}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6 text-sm" onClick={e => e.stopPropagation()}>
                      <div className="text-center"><p className="text-xs text-muted-foreground">Cost</p><p className="font-medium">${(a.device_cost || 0).toFixed(2)}</p></div>
                      <div className="text-center"><p className="text-xs text-muted-foreground">Paid</p><p className="font-medium text-emerald-400">${(a.amount_paid || 0).toFixed(2)}</p></div>
                      {a.agreement_type !== "buy_outright" && (
                        <div className="w-24">
                          <div className="flex justify-between text-[10px] text-muted-foreground mb-1"><span>{a.payments_made}/{a.total_payments}</span><span>{progress}%</span></div>
                          <Progress value={progress} className="h-1.5" />
                        </div>
                      )}
                      {a.status === "active" && (
                        <Button size="sm" variant="outline" className="h-7" onClick={() => openPaymentDialog(a)} data-testid={`pay-btn-${a.id}`}><CreditCard className="w-3 h-3 mr-1" />Pay</Button>
                      )}
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {filteredAgreements.length === 0 && (
            <Card className="border-dashed"><CardContent className="py-12 text-center">
              <Phone className="w-12 h-12 mx-auto text-muted-foreground mb-3 opacity-30" />
              <p className="text-muted-foreground mb-3">No agreements found</p>
              <Button onClick={openNewAgreement}><Plus className="w-4 h-4 mr-1" />Create First Agreement</Button>
            </CardContent></Card>
          )}
        </TabsContent>

        {/* INVENTORY TAB */}
        <TabsContent value="inventory" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model</TableHead><TableHead>Serial Number</TableHead><TableHead>MAC Address</TableHead>
                    <TableHead>Status</TableHead><TableHead>Condition</TableHead><TableHead>Client</TableHead>
                    <TableHead>Purchase Price</TableHead><TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDevices.map(d => {
                    const ds = DEVICE_STATUS[d.status] || DEVICE_STATUS.available;
                    return (
                      <TableRow key={d.id} data-testid={`device-row-${d.id}`}>
                        <TableCell><div className="flex items-center gap-2"><Phone className="w-4 h-4 text-cyan-500" /><span className="font-medium">{d.model_name}</span></div></TableCell>
                        <TableCell className="font-mono text-xs">{d.serial_number}</TableCell>
                        <TableCell className="font-mono text-xs">{d.mac_address || "-"}</TableCell>
                        <TableCell><Badge className={ds.class}>{ds.label}</Badge></TableCell>
                        <TableCell className="capitalize text-sm">{d.condition}</TableCell>
                        <TableCell className="text-sm">{d.current_client_name || "-"}</TableCell>
                        <TableCell className="text-sm">${(d.purchase_price || 0).toFixed(2)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEditDevice(d)} data-testid={`edit-device-${d.id}`}><Edit className="w-3 h-3" /></Button>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => handleDeleteDevice(d.id)} data-testid={`delete-device-${d.id}`}><Trash2 className="w-3 h-3" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filteredDevices.length === 0 && (
                    <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">No devices in inventory</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ===== ADD/EDIT DEVICE DIALOG ===== */}
      <Dialog open={deviceDialog} onOpenChange={v => { setDeviceDialog(v); if (!v) setEditingDevice(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editingDevice ? "Edit Device" : "Add Yealink Device"}</DialogTitle></DialogHeader>
          <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
            <div>
              <Label>Model *</Label>
              <Select value={deviceForm.model_name} onValueChange={v => setDeviceForm({ ...deviceForm, model_name: v })}>
                <SelectTrigger data-testid="device-model-select"><SelectValue placeholder="Select model" /></SelectTrigger>
                <SelectContent>{yealinkModels.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Serial Number *</Label><Input value={deviceForm.serial_number} onChange={e => setDeviceForm({ ...deviceForm, serial_number: e.target.value })} placeholder="e.g. 805EC04ABCDE" data-testid="device-serial-input" /></div>
              <div><Label>MAC Address</Label><Input value={deviceForm.mac_address} onChange={e => setDeviceForm({ ...deviceForm, mac_address: e.target.value })} placeholder="e.g. 80:5E:C0:4A:BC:DE" data-testid="device-mac-input" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>IMEI (if mobile)</Label><Input value={deviceForm.imei} onChange={e => setDeviceForm({ ...deviceForm, imei: e.target.value })} /></div>
              <div><Label>Firmware</Label><Input value={deviceForm.firmware_version} onChange={e => setDeviceForm({ ...deviceForm, firmware_version: e.target.value })} placeholder="e.g. 124.86.0.70" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Condition</Label>
                <Select value={deviceForm.condition} onValueChange={v => setDeviceForm({ ...deviceForm, condition: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(CONDITION_MAP).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Purchase Price ($)</Label><Input type="number" value={deviceForm.purchase_price} onChange={e => setDeviceForm({ ...deviceForm, purchase_price: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Purchase Date</Label><Input type="date" value={deviceForm.purchase_date} onChange={e => setDeviceForm({ ...deviceForm, purchase_date: e.target.value })} /></div>
              <div><Label>Warranty Expiry</Label><Input type="date" value={deviceForm.warranty_expiry} onChange={e => setDeviceForm({ ...deviceForm, warranty_expiry: e.target.value })} /></div>
            </div>
            <div><Label>Vendor</Label>
              <Select value={deviceForm.vendor_id} onValueChange={v => setDeviceForm({ ...deviceForm, vendor_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select vendor (optional)" /></SelectTrigger>
                <SelectContent>{vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Notes</Label><Textarea value={deviceForm.notes} onChange={e => setDeviceForm({ ...deviceForm, notes: e.target.value })} rows={2} /></div>
          </div>
          <DialogFooter><Button onClick={handleSaveDevice} data-testid="save-device-btn">{editingDevice ? "Update" : "Add"} Device</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== NEW AGREEMENT DIALOG ===== */}
      <Dialog open={agreementDialog} onOpenChange={setAgreementDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>New Phone Agreement</DialogTitle></DialogHeader>
          <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
            <div>
              <Label>Agreement Type *</Label>
              <Select value={agreementForm.agreement_type} onValueChange={v => setAgreementForm({ ...agreementForm, agreement_type: v })}>
                <SelectTrigger data-testid="agreement-type-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="rental">Rental (Monthly Payments)</SelectItem>
                  <SelectItem value="buy_outright">Buy Outright (One-time Purchase)</SelectItem>
                  <SelectItem value="lease_to_own">Lease to Own</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Client *</Label>
              <Select value={agreementForm.client_id} onValueChange={v => setAgreementForm({ ...agreementForm, client_id: v })}>
                <SelectTrigger data-testid="agreement-client-select"><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Device *</Label>
              <Select value={agreementForm.device_id} onValueChange={v => setAgreementForm({ ...agreementForm, device_id: v })}>
                <SelectTrigger data-testid="agreement-device-select"><SelectValue placeholder="Select available device" /></SelectTrigger>
                <SelectContent>
                  {availableDevices.length === 0 && <div className="px-3 py-2 text-sm text-muted-foreground">No available devices</div>}
                  {availableDevices.map(d => <SelectItem key={d.id} value={d.id}>{d.model_name} - SN: {d.serial_number}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Start Date *</Label><Input type="date" value={agreementForm.start_date} onChange={e => setAgreementForm({ ...agreementForm, start_date: e.target.value })} data-testid="agreement-start-date" /></div>
              {agreementForm.agreement_type !== "buy_outright" && (
                <div><Label>End Date</Label><Input type="date" value={agreementForm.end_date} onChange={e => setAgreementForm({ ...agreementForm, end_date: e.target.value })} /></div>
              )}
            </div>
            <Separator />
            <p className="text-sm font-semibold flex items-center gap-2"><DollarSign className="w-4 h-4" />Pricing</p>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Device Cost ($)</Label><Input type="number" value={agreementForm.device_cost} onChange={e => setAgreementForm({ ...agreementForm, device_cost: e.target.value })} data-testid="agreement-cost" /></div>
              {agreementForm.agreement_type !== "buy_outright" && (
                <div><Label>Deposit ($)</Label><Input type="number" value={agreementForm.deposit_amount} onChange={e => setAgreementForm({ ...agreementForm, deposit_amount: e.target.value })} /></div>
              )}
            </div>
            {agreementForm.agreement_type !== "buy_outright" && (
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Monthly Amount ($)</Label><Input type="number" value={agreementForm.monthly_amount} onChange={e => setAgreementForm({ ...agreementForm, monthly_amount: e.target.value })} data-testid="agreement-monthly" /></div>
                <div><Label>Total Payments (#)</Label><Input type="number" value={agreementForm.total_payments} onChange={e => setAgreementForm({ ...agreementForm, total_payments: e.target.value })} placeholder="e.g. 12 for 12 months" data-testid="agreement-total-payments" /></div>
              </div>
            )}
            <div><Label>Notes</Label><Textarea value={agreementForm.notes} onChange={e => setAgreementForm({ ...agreementForm, notes: e.target.value })} rows={2} /></div>
          </div>
          <DialogFooter><Button onClick={handleCreateAgreement} data-testid="create-agreement-btn">{agreementForm.agreement_type === "buy_outright" ? "Record Purchase" : "Create Agreement"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== PAYMENT DIALOG ===== */}
      <Dialog open={paymentDialog} onOpenChange={setPaymentDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Payment</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {viewAgreement && <p className="text-sm text-muted-foreground">Recording payment for <strong>{viewAgreement.client_name}</strong> - {viewAgreement.device_model}</p>}
            <div><Label>Amount ($) *</Label><Input type="number" value={paymentForm.amount} onChange={e => setPaymentForm({ ...paymentForm, amount: e.target.value })} data-testid="payment-amount" /></div>
            <div><Label>Payment Method</Label>
              <Select value={paymentForm.method} onValueChange={v => setPaymentForm({ ...paymentForm, method: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="credit_card">Credit Card</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                  <SelectItem value="direct_debit">Direct Debit</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={paymentForm.is_deposit} onChange={e => setPaymentForm({ ...paymentForm, is_deposit: e.target.checked })} className="rounded" />
              <Label>This is a deposit payment</Label>
            </div>
            <div><Label>Note</Label><Input value={paymentForm.note} onChange={e => setPaymentForm({ ...paymentForm, note: e.target.value })} placeholder="Optional note" /></div>
          </div>
          <DialogFooter><Button onClick={handleRecordPayment} data-testid="confirm-payment-btn"><CreditCard className="w-4 h-4 mr-1" />Record Payment</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== RETURN DIALOG ===== */}
      <Dialog open={returnDialog} onOpenChange={setReturnDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Return Device</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {viewAgreement && <p className="text-sm text-muted-foreground">Returning <strong>{viewAgreement.device_model}</strong> from {viewAgreement.client_name}</p>}
            <div><Label>Return Condition</Label>
              <Select value={returnForm.condition} onValueChange={v => setReturnForm({ ...returnForm, condition: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="excellent">Excellent</SelectItem>
                  <SelectItem value="good">Good</SelectItem>
                  <SelectItem value="fair">Fair</SelectItem>
                  <SelectItem value="damaged">Damaged</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Notes</Label><Textarea value={returnForm.notes} onChange={e => setReturnForm({ ...returnForm, notes: e.target.value })} rows={3} placeholder="Describe the condition of the device..." /></div>
          </div>
          <DialogFooter><Button onClick={handleReturnDevice} data-testid="confirm-return-btn"><RotateCcw className="w-4 h-4 mr-1" />Process Return</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
