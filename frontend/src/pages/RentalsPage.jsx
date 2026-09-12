import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
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
import { WorkspaceLoadingState } from "@/components/WorkspaceState";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { MetricStrip, MetricTile } from "@/components/design-system";
import { toast } from "sonner";
import {
  Phone, Plus, Search, Edit, Trash2, DollarSign,
  ArrowLeft, AlertTriangle, RefreshCw,
  CreditCard, Smartphone, Calendar, TrendingUp,
  ArrowRightLeft, RotateCcw, Receipt, ChevronRight, Building2,
  FileText, CircleAlert, PackageCheck
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
const NO_CONTRACT = "__no-contract__";

const AGREEMENT_TYPES = {
  rental: { label: "Rental", description: "Recurring rental payment", tone: "sky" },
  buy_outright: { label: "Purchase", description: "One-time sale", tone: "violet" },
  lease_to_own: { label: "Lease to own", description: "Fixed ownership plan", tone: "amber" },
};

const currency = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2 });
const formatCurrency = (value) => currency.format(Number(value) || 0);
const formatDate = (value) => {
  if (!value) return "Not set";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
};
const startOfToday = () => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
};
const paymentHealth = (agreement) => {
  if (agreement.status !== "active" || !agreement.next_payment_date) return null;
  const dueDate = new Date(`${agreement.next_payment_date.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(dueDate.getTime())) return null;
  const daysUntilDue = Math.ceil((dueDate.getTime() - startOfToday().getTime()) / 86400000);
  if (daysUntilDue < 0) return { key: "payment_overdue", label: "Payment overdue", detail: `${Math.abs(daysUntilDue)}d overdue`, className: "bg-red-500/15 text-red-300 border-red-400/30" };
  if (daysUntilDue === 0) return { key: "payment_due", label: "Due today", detail: "Payment due today", className: "bg-amber-500/15 text-amber-300 border-amber-400/30" };
  if (daysUntilDue <= 7) return { key: "payment_due", label: "Due soon", detail: `Due in ${daysUntilDue}d`, className: "bg-amber-500/15 text-amber-300 border-amber-400/30" };
  return null;
};

const emptyDeviceForm = { model_name: "", serial_number: "", mac_address: "", imei: "", firmware_version: "", condition: "new", notes: "", purchase_price: "0", purchase_date: "", vendor_id: "", warranty_expiry: "" };
const emptyAgreementForm = { client_id: "", device_id: "", agreement_type: "rental", start_date: "", end_date: "", device_cost: "0", deposit_amount: "0", monthly_amount: "0", total_payments: "0", sla_contract_id: "", notes: "" };

export default function RentalsPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [mainTab, setMainTab] = useState("agreements");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  // Data
  const [agreements, setAgreements] = useState([]);
  const [devices, setDevices] = useState([]);
  const [clients, setClients] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [yealinkModels, setYealinkModels] = useState([]);
  const [stats, setStats] = useState(null);

  // Dialogs
  const [deviceDialog, setDeviceDialog] = useState(false);
  const [agreementDialog, setAgreementDialog] = useState(false);
  const [paymentDialog, setPaymentDialog] = useState(false);
  const [returnDialog, setReturnDialog] = useState(false);
  const [viewAgreement, setViewAgreement] = useState(null);
  const [editingDevice, setEditingDevice] = useState(null);
  const [deviceToDelete, setDeviceToDelete] = useState(null);

  // Forms
  const [deviceForm, setDeviceForm] = useState({ ...emptyDeviceForm });
  const [agreementForm, setAgreementForm] = useState({ ...emptyAgreementForm });
  const [paymentForm, setPaymentForm] = useState({ amount: "", method: "bank_transfer", note: "", is_deposit: false });
  const [returnForm, setReturnForm] = useState({ condition: "good", notes: "" });

  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async ({ quiet = false } = {}) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const [agRes, devRes, cliRes, vendRes, modelsRes, statsRes, contractsRes] = await Promise.all([
        axios.get(`${API}/rentals`, { headers }),
        axios.get(`${API}/rental-devices`, { headers }),
        axios.get(`${API}/clients`, { headers }),
        axios.get(`${API}/vendors`, { headers }),
        axios.get(`${API}/rental-devices/models`, { headers }),
        axios.get(`${API}/rentals/stats`, { headers }),
        axios.get(`${API}/contracts`, { headers }).catch(() => ({ data: [] })),
      ]);
      setAgreements(agRes.data);
      setDevices(devRes.data);
      setClients(cliRes.data);
      setVendors(vendRes.data);
      setYealinkModels(modelsRes.data);
      setStats(statsRes.data);
      setContracts(contractsRes.data);
    } catch { toast.error(quiet ? "Rentals could not refresh. The current view has been kept." : "Failed to load rental data"); }
    finally { if (quiet) setRefreshing(false); else setLoading(false); }
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
    if (agreementForm.end_date && agreementForm.end_date < agreementForm.start_date) {
      toast.error("The end date cannot be before the agreement start date"); return;
    }
    if (agreementForm.agreement_type !== "buy_outright" && !(Number(agreementForm.monthly_amount) > 0)) {
      toast.error("Add a monthly amount for a rental or lease-to-own agreement"); return;
    }
    try {
      const payload = {
        ...agreementForm,
        device_cost: parseFloat(agreementForm.device_cost) || 0,
        deposit_amount: parseFloat(agreementForm.deposit_amount) || 0,
        monthly_amount: parseFloat(agreementForm.monthly_amount) || 0,
        total_payments: parseInt(agreementForm.total_payments) || 0,
        sla_contract_id: agreementForm.sla_contract_id || null,
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

  const openAgreementById = (agreementId) => {
    const agreement = agreements.find((item) => item.id === agreementId);
    if (agreement) setViewAgreement(agreement);
    else toast.error("The linked agreement is no longer available");
  };

  const openClient = (clientId) => {
    if (clientId) navigate(`/clients?client=${encodeURIComponent(clientId)}`);
  };

  const selectAgreementDevice = (deviceId) => {
    const device = devices.find((item) => item.id === deviceId);
    setAgreementForm((current) => ({
      ...current,
      device_id: deviceId,
      device_cost: Number(current.device_cost) > 0 ? current.device_cost : String(device?.purchase_price || 0),
    }));
  };

  // Filters
  const filteredAgreements = agreements
    .filter(a => statusFilter === "all" || (statusFilter === "payment_overdue" ? paymentHealth(a)?.key === "payment_overdue" : statusFilter === "payment_due" ? paymentHealth(a)?.key === "payment_due" : a.status === statusFilter))
    .filter(a => typeFilter === "all" || a.agreement_type === typeFilter)
    .filter(a => !search || [a.client_name, a.client_id, a.device_model, a.device_serial, a.device_mac, a.sla_contract_name, a.sla_contract_id, a.notes, a.id].some(value => value?.toLowerCase?.().includes(search.toLowerCase())));

  const filteredDevices = devices
    .filter(d => statusFilter === "all" || d.status === statusFilter)
    .filter(d => !search || [d.model_name, d.serial_number, d.mac_address, d.imei, d.current_client_name, d.notes, d.id].some(value => value?.toLowerCase?.().includes(search.toLowerCase())));

  const availableDevices = devices.filter(d => d.status === "available" || d.status === "returned");
  const activeClientContracts = useMemo(
    () => contracts.filter((contract) => contract.client_id === agreementForm.client_id && contract.status === "active"),
    [contracts, agreementForm.client_id],
  );
  const contractsById = useMemo(() => Object.fromEntries(contracts.map((contract) => [contract.id, contract])), [contracts]);
  const paymentOverdue = agreements.filter((agreement) => paymentHealth(agreement)?.key === "payment_overdue");
  const paymentDueSoon = agreements.filter((agreement) => paymentHealth(agreement)?.key === "payment_due");
  const attentionCount = paymentOverdue.length + paymentDueSoon.length;

  if (loading) return <WorkspaceLoadingState label="Loading rentals" />;

  // ============ AGREEMENT DETAIL VIEW ============
  if (viewAgreement) {
    const r = viewAgreement;
    const progress = r.total_payments > 0 ? (r.payments_made / r.total_payments) * 100 : (r.agreement_type === "buy_outright" ? 100 : 0);
    const remainingAmount = Math.max(0, (r.device_cost || 0) - (r.amount_paid || 0));
    const sc = STATUS_CONFIG[r.status] || STATUS_CONFIG.active;
    const type = AGREEMENT_TYPES[r.agreement_type] || AGREEMENT_TYPES.rental;
    const billingContract = contractsById[r.sla_contract_id] || null;
    const canRecordPayment = r.status === "active" && r.agreement_type !== "buy_outright";
    const canReturnDevice = ["active", "completed"].includes(r.status) && r.agreement_type !== "buy_outright";
    const paymentState = paymentHealth(r);

    return (
      <div className="space-y-5" data-testid="rental-detail">
        <section className="nx-page-stage nx-ambient-surface rounded-2xl border border-sky-500/20 bg-gradient-to-br from-sky-500/[0.10] via-background to-background p-5 md:p-6" data-nx-signal="rental-record">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <Button variant="ghost" size="sm" onClick={() => setViewAgreement(null)} className="-ml-2 mb-3 rounded-lg text-muted-foreground hover:text-foreground" data-testid="back-to-rentals"><ArrowLeft className="mr-1 h-4 w-4" />Back to rentals</Button>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-sky-300">Rental agreement</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">{r.client_name || "Client rental"}</h1>
                <Badge className={sc.class}>{sc.label}</Badge>
                <Badge variant="outline" className="border-sky-400/20 bg-sky-400/[0.06] text-sky-200">{type.label}</Badge>
                {paymentState && <Badge className={paymentState.className}>{paymentState.label}</Badge>}
              </div>
              <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground"><span>{r.device_model || "Phone"}</span><span className="hidden sm:inline">•</span><span className="font-mono text-xs">{r.device_serial || "Serial not recorded"}</span></p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {r.client_id && <Button variant="outline" size="sm" onClick={() => openClient(r.client_id)}><Building2 className="mr-1.5 h-3.5 w-3.5" />Open client</Button>}
              {canReturnDevice && <Button size="sm" variant="outline" onClick={() => openReturnDialog(r)} data-testid="return-device-btn"><RotateCcw className="mr-1.5 h-3.5 w-3.5" />Return device</Button>}
              {canRecordPayment && <Button size="sm" onClick={() => openPaymentDialog(r)} data-testid="record-payment-btn"><CreditCard className="mr-1.5 h-3.5 w-3.5" />Record payment</Button>}
            </div>
          </div>
        </section>

        <MetricStrip columns={5}>
          <MetricTile label="Device value" value={formatCurrency(r.device_cost)} trend={r.device_model || "Phone"} accent="sky" icon={<Phone />} />
          <MetricTile label="Collected" value={formatCurrency(r.amount_paid)} trend={`${r.payments_made || 0} payment${r.payments_made === 1 ? "" : "s"} recorded`} accent="emerald" icon={<DollarSign />} />
          <MetricTile label="Balance" value={formatCurrency(remainingAmount)} trend={remainingAmount > 0 ? "Still to recover" : "Fully recovered"} accent={remainingAmount > 0 ? "amber" : "emerald"} icon={<CircleAlert />} />
          <MetricTile label="Payment plan" value={r.total_payments ? `${r.payments_made || 0}/${r.total_payments}` : "Open"} trend={r.total_payments ? `${Math.round(progress)}% complete` : "No fixed payment term"} accent="violet" icon={<Receipt />} />
          <MetricTile label="Next payment" value={r.next_payment_date ? formatDate(r.next_payment_date) : "—"} trend={paymentState?.detail || (r.status === "returned" ? "Device returned" : type.description)} accent={paymentState?.key === "payment_overdue" ? "rose" : "sky"} icon={<Calendar />} />
        </MetricStrip>

        {/* Progress */}
        {r.agreement_type !== "buy_outright" && r.total_payments > 0 && (
          <Card className="overflow-hidden rounded-2xl border-border/70 bg-card/90 shadow-[0_18px_45px_-34px_rgba(0,0,0,0.95)]">
            <CardContent className="space-y-3 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <div><p className="font-semibold">Payment progress</p><p className="mt-0.5 text-xs text-muted-foreground">{type.description}</p></div>
                <span className="rounded-full border border-border/80 bg-muted/45 px-2.5 py-1 text-xs font-semibold">{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} className="h-3" />
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>Monthly payment: {formatCurrency(r.monthly_amount)}</span>
                {r.next_payment_date && <span>Next payment: {formatDate(r.next_payment_date)}</span>}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Details Grid */}
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)]">
          <Card className="overflow-hidden rounded-2xl border-border/70 bg-card/90 shadow-[0_18px_45px_-34px_rgba(0,0,0,0.95)]">
            <CardHeader className="border-b border-border/60 bg-gradient-to-r from-sky-400/[0.07] to-transparent pb-3"><CardTitle className="flex items-center gap-2 text-sm"><Smartphone className="h-4 w-4 text-sky-300" />Device and return record</CardTitle></CardHeader>
            <CardContent className="grid gap-x-8 gap-y-3 p-5 text-sm sm:grid-cols-2">
              <div><p className="text-xs text-muted-foreground">Model</p><p className="mt-1 font-medium">{r.device_model || "Not recorded"}</p></div>
              <div><p className="text-xs text-muted-foreground">Serial number</p><p className="mt-1 font-mono text-xs text-foreground">{r.device_serial || "Not recorded"}</p></div>
              {r.device_mac && <div><p className="text-xs text-muted-foreground">MAC address</p><p className="mt-1 font-mono text-xs text-foreground">{r.device_mac}</p></div>}
              <div><p className="text-xs text-muted-foreground">Deposit</p><p className="mt-1 font-medium">{formatCurrency(r.deposit_amount)} <Badge className={`ml-1 ${r.deposit_paid ? "bg-emerald-500/20 text-emerald-300 border-emerald-400/30" : "bg-amber-500/20 text-amber-300 border-amber-400/30"}`}>{r.deposit_paid ? "Paid" : "Pending"}</Badge></p></div>
              {r.return_date && <div><p className="text-xs text-muted-foreground">Returned</p><p className="mt-1 font-medium">{formatDate(r.return_date)}</p></div>}
              {r.return_condition && <div><p className="text-xs text-muted-foreground">Return condition</p><p className="mt-1 font-medium capitalize">{r.return_condition}</p></div>}
              {r.return_notes && <div className="sm:col-span-2"><p className="text-xs text-muted-foreground">Return notes</p><p className="mt-1 leading-6">{r.return_notes}</p></div>}
            </CardContent>
          </Card>
          <Card className="overflow-hidden rounded-2xl border-border/70 bg-card/90 shadow-[0_18px_45px_-34px_rgba(0,0,0,0.95)]">
            <CardHeader className="border-b border-border/60 bg-gradient-to-r from-violet-400/[0.07] to-transparent pb-3"><CardTitle className="flex items-center gap-2 text-sm"><FileText className="h-4 w-4 text-violet-300" />Billing context</CardTitle></CardHeader>
            <CardContent className="space-y-4 p-5 text-sm">
              <div><p className="text-xs text-muted-foreground">Agreement term</p><p className="mt-1 font-medium">{formatDate(r.start_date)}{r.end_date ? ` to ${formatDate(r.end_date)}` : " onwards"}</p></div>
              <div><p className="text-xs text-muted-foreground">Linked client contract</p>{billingContract || r.sla_contract_name ? <p className="mt-1 font-medium">{billingContract?.name || r.sla_contract_name}</p> : <p className="mt-1 text-muted-foreground">No contract linked</p>}</div>
              <div><p className="text-xs text-muted-foreground">Payment cadence</p><p className="mt-1 font-medium">{r.agreement_type === "buy_outright" ? "One-time purchase" : `${formatCurrency(r.monthly_amount)} monthly`}</p></div>
              {r.notes && <div className="border-t border-border/60 pt-3"><p className="text-xs text-muted-foreground">Agreement notes</p><p className="mt-1 leading-6">{r.notes}</p></div>}
            </CardContent>
          </Card>
        </div>

        {/* Payment History */}
        <Card className="overflow-hidden rounded-2xl border-border/70 bg-card/90 shadow-[0_18px_45px_-34px_rgba(0,0,0,0.95)]">
          <CardHeader className="border-b border-border/60 bg-gradient-to-r from-emerald-400/[0.07] to-transparent pb-3"><CardTitle className="flex items-center gap-2 text-sm"><Receipt className="h-4 w-4 text-emerald-300" />Payment history</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto"><Table>
              <TableHeader className="bg-muted/45">
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
            </Table></div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ============ MAIN VIEW ============
  return (
    <div className="space-y-5" data-testid="rentals-page">
      <OperationalPageHeader
        eyebrow="Products & Stock / Rentals"
        title="Phone rentals"
        description="Track every handset from inventory through agreement, payment, return, and client billing context."
        icon={Phone}
        tone="emerald"
        signal="rental-operations"
        actions={<>
          <Button variant="outline" size="sm" onClick={() => fetchData({ quiet: true })} disabled={refreshing}><RefreshCw className={`mr-1.5 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />Refresh</Button>
          {mainTab === "inventory" ? <Button onClick={openAddDevice} data-testid="add-device-btn"><Plus className="mr-1.5 h-4 w-4" />Add device</Button> : <Button onClick={openNewAgreement} data-testid="new-agreement-btn"><Plus className="mr-1.5 h-4 w-4" />New agreement</Button>}
        </>}
      />

      {stats && <MetricStrip columns={5}>
        <MetricTile label="Phones in fleet" value={stats.total_devices || 0} trend={`${stats.rented_devices || 0} assigned`} accent="sky" icon={<Phone />} />
        <MetricTile label="Ready to assign" value={stats.available_devices || 0} trend={stats.available_devices ? "Inventory available" : "Add phones to stock"} accent="emerald" icon={<PackageCheck />} />
        <MetricTile label="Active agreements" value={stats.active || 0} trend={`${agreements.filter((agreement) => agreement.agreement_type === "lease_to_own").length} lease to own`} accent="violet" icon={<ArrowRightLeft />} />
        <MetricTile label="Needs payment review" value={attentionCount} trend={paymentOverdue.length ? `${paymentOverdue.length} overdue` : paymentDueSoon.length ? `${paymentDueSoon.length} due this week` : "Nothing due this week"} accent={attentionCount ? "amber" : "emerald"} icon={<AlertTriangle />} />
        <MetricTile label="Collected" value={formatCurrency(stats.total_revenue)} trend={stats.expected_revenue ? `${formatCurrency(stats.outstanding_balance)} outstanding` : "Recorded payments"} accent="emerald" icon={<TrendingUp />} />
      </MetricStrip>}

      {(attentionCount > 0 || availableDevices.length === 0) && (
        <Card className={`overflow-hidden rounded-2xl border ${paymentOverdue.length ? "border-red-400/25 bg-red-400/[0.035]" : "border-amber-400/25 bg-amber-400/[0.035]"}`}>
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${paymentOverdue.length ? "border-red-400/25 bg-red-400/[0.10] text-red-300" : "border-amber-400/25 bg-amber-400/[0.10] text-amber-300"}`}><CircleAlert className="h-4 w-4" /></span><div><p className="font-semibold">{paymentOverdue.length ? `${paymentOverdue.length} rental payment${paymentOverdue.length === 1 ? "" : "s"} need attention` : availableDevices.length === 0 ? "No phones are ready to assign" : `${paymentDueSoon.length} payment${paymentDueSoon.length === 1 ? "" : "s"} due within seven days`}</p><p className="mt-0.5 text-sm text-muted-foreground">{paymentOverdue.length ? "Review overdue payments before the next client touchpoint." : availableDevices.length === 0 ? "Add device inventory before starting another agreement." : "Open the focused payment list and keep upcoming collections on track."}</p></div></div>
            {paymentOverdue.length || paymentDueSoon.length ? <Button variant="outline" size="sm" onClick={() => { setMainTab("agreements"); setStatusFilter(paymentOverdue.length ? "payment_overdue" : "payment_due"); }}><CircleAlert className="mr-1.5 h-3.5 w-3.5" />Review payments</Button> : <Button variant="outline" size="sm" onClick={() => { setMainTab("inventory"); }}><Plus className="mr-1.5 h-3.5 w-3.5" />Add inventory</Button>}
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs value={mainTab} onValueChange={v => { setMainTab(v); setSearch(""); setStatusFilter("all"); setTypeFilter("all"); }}>
        <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card/70 p-3 shadow-[0_16px_40px_-34px_rgba(0,0,0,0.95)] xl:flex-row xl:items-center xl:justify-between">
          <TabsList aria-label="Phone rental workspace sections" className="h-auto w-fit max-w-full justify-start overflow-x-auto rounded-xl border border-border/70 bg-muted/50 p-1">
            <TabsTrigger value="agreements" data-testid="tab-agreements">Agreements ({agreements.length})</TabsTrigger>
            <TabsTrigger value="inventory" data-testid="tab-inventory">Device Inventory ({devices.length})</TabsTrigger>
          </TabsList>
          <div className="flex flex-1 flex-wrap items-center gap-2 xl:justify-end">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[170px]" data-testid="status-filter"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {mainTab === "agreements"
                  ? <><SelectItem value="payment_overdue">Payment overdue</SelectItem><SelectItem value="payment_due">Payment due soon</SelectItem>{Object.entries(STATUS_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</>
                  : Object.entries(DEVICE_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)
                }
              </SelectContent>
            </Select>
            {mainTab === "agreements" && (
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-full sm:w-[160px]" data-testid="type-filter"><SelectValue placeholder="Type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="rental">Rental</SelectItem>
                  <SelectItem value="buy_outright">Buy Outright</SelectItem>
                  <SelectItem value="lease_to_own">Lease to Own</SelectItem>
                </SelectContent>
              </Select>
            )}
            <div className="relative min-w-[min(100%,16rem)] flex-1 xl:max-w-xs">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder={mainTab === "agreements" ? "Search client, phone, serial…" : "Search phone, serial, client…"} value={search} onChange={e => setSearch(e.target.value)} data-testid="search-input" />
            </div>
          </div>
        </div>

        {/* AGREEMENTS TAB */}
        <TabsContent value="agreements" className="space-y-3 mt-4">
          {filteredAgreements.map(a => {
            const sc = STATUS_CONFIG[a.status] || STATUS_CONFIG.active;
            const progress = a.total_payments > 0 ? Math.round((a.payments_made / a.total_payments) * 100) : (a.agreement_type === "buy_outright" ? 100 : 0);
            const type = AGREEMENT_TYPES[a.agreement_type] || AGREEMENT_TYPES.rental;
            const paymentState = paymentHealth(a);
            return (
              <Card key={a.id} className="group overflow-hidden rounded-2xl border-border/70 bg-card/90 shadow-[0_14px_36px_-32px_rgba(0,0,0,0.95)] transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-[0_20px_42px_-30px_rgba(34,211,238,0.28)]" data-testid={`agreement-${a.id}`}>
                <CardContent className="p-0">
                  <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between lg:p-5">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${a.agreement_type === "buy_outright" ? "border-violet-400/20 bg-violet-400/[0.10] text-violet-300" : a.agreement_type === "lease_to_own" ? "border-amber-400/20 bg-amber-400/[0.10] text-amber-300" : "border-sky-400/20 bg-sky-400/[0.10] text-sky-300"}`}>
                        {a.agreement_type === "buy_outright" ? <DollarSign className="h-5 w-5" /> : <Phone className="h-5 w-5" />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate font-semibold">{a.client_name || "Client rental"}</p>
                          <Badge className={sc.class}>{sc.label}</Badge>
                          <Badge variant="outline" className="text-[10px]">{type.label}</Badge>
                          {paymentState && <Badge className={`text-[10px] ${paymentState.className}`}>{paymentState.label}</Badge>}
                        </div>
                        <p className="mt-1 truncate text-xs text-muted-foreground">{a.device_model || "Phone"} <span className="font-mono">• {a.device_serial || "No serial"}</span>{a.device_mac ? <span className="hidden 2xl:inline"> • {a.device_mac}</span> : null}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>Started {formatDate(a.start_date)}</span>
                          {a.next_payment_date && <span>{paymentState?.detail || `Next payment ${formatDate(a.next_payment_date)}`}</span>}
                          {a.sla_contract_name && <span className="flex items-center gap-1"><FileText className="h-3 w-3" />{a.sla_contract_name}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                      <div className="mr-2 min-w-[86px] text-left text-xs lg:text-right"><p className="text-muted-foreground">Collected</p><p className="mt-0.5 font-semibold text-emerald-300">{formatCurrency(a.amount_paid)}</p></div>
                      {a.agreement_type !== "buy_outright" && <div className="mr-2 w-28"><div className="mb-1 flex justify-between text-[10px] text-muted-foreground"><span>{a.total_payments ? `${a.payments_made || 0}/${a.total_payments}` : "Open term"}</span><span>{a.total_payments ? `${progress}%` : ""}</span></div>{a.total_payments ? <Progress value={progress} className="h-1.5" /> : <div className="h-1.5 rounded-full bg-muted" />}</div>}
                      {a.client_id && <Button size="sm" variant="ghost" className="h-8 px-2.5" onClick={() => openClient(a.client_id)}><Building2 className="mr-1 h-3.5 w-3.5" />Client</Button>}
                      {a.status === "active" && a.agreement_type !== "buy_outright" && <Button size="sm" variant="outline" className="h-8" onClick={() => openPaymentDialog(a)} data-testid={`pay-btn-${a.id}`}><CreditCard className="mr-1 h-3.5 w-3.5" />Pay</Button>}
                      <Button size="sm" className="h-8" onClick={() => setViewAgreement(a)}>Open <ChevronRight className="ml-1 h-3.5 w-3.5" /></Button>
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
          <Card className="overflow-hidden rounded-2xl border-border/70 bg-card/90 shadow-[0_18px_45px_-34px_rgba(0,0,0,0.95)]">
            <CardContent className="p-0">
              <div className="overflow-x-auto"><Table>
                <TableHeader className="bg-muted/45">
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
                      <TableRow key={d.id} className="transition-colors hover:bg-primary/[0.035]" data-testid={`device-row-${d.id}`}>
                        <TableCell><div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-lg border border-sky-400/20 bg-sky-400/[0.08]"><Phone className="h-4 w-4 text-sky-300" /></span><span className="font-medium">{d.model_name}</span></div></TableCell>
                        <TableCell className="font-mono text-xs">{d.serial_number}</TableCell>
                        <TableCell className="font-mono text-xs">{d.mac_address || "-"}</TableCell>
                        <TableCell><Badge className={ds.class}>{ds.label}</Badge></TableCell>
                        <TableCell className="capitalize text-sm">{d.condition}</TableCell>
                        <TableCell className="text-sm">{d.current_client_name ? <Button variant="link" className="h-auto p-0 text-sm font-normal" onClick={() => openClient(d.current_client_id)}>{d.current_client_name}</Button> : <span className="text-muted-foreground">Unassigned</span>}</TableCell>
                        <TableCell className="text-sm">{formatCurrency(d.purchase_price)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {d.current_rental_id && <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => openAgreementById(d.current_rental_id)}><FileText className="mr-1 h-3.5 w-3.5" />Agreement</Button>}
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label={`Edit ${d.model_name}`} onClick={() => openEditDevice(d)} data-testid={`edit-device-${d.id}`}><Edit className="h-3.5 w-3.5" /></Button>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive disabled:text-muted-foreground" aria-label={`Remove ${d.model_name}`} disabled={Boolean(d.current_rental_id)} onClick={() => setDeviceToDelete(d)} data-testid={`delete-device-${d.id}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filteredDevices.length === 0 && (
                    <TableRow><TableCell colSpan={8} className="py-12 text-center text-muted-foreground"><div className="flex flex-col items-center gap-3"><Phone className="h-9 w-9 opacity-30" /><div><p className="font-medium text-foreground">No matching phone inventory</p><p className="mt-1 text-sm">Add a handset or adjust the search and filters.</p></div><Button size="sm" onClick={openAddDevice}><Plus className="mr-1.5 h-3.5 w-3.5" />Add device</Button></div></TableCell></TableRow>
                  )}
                </TableBody>
              </Table></div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ===== ADD/EDIT DEVICE DIALOG ===== */}
      <Dialog open={deviceDialog} onOpenChange={v => { setDeviceDialog(v); if (!v) setEditingDevice(null); }}>
        <DialogContent className="flex h-[min(820px,calc(100vh-1.5rem))] max-h-[calc(100vh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:rounded-2xl">
          <DialogHeader className="shrink-0 border-b border-border/80 bg-gradient-to-r from-cyan-400/15 via-cyan-400/[0.04] to-transparent px-5 py-5 pr-12"><DialogTitle>{editingDevice ? "Edit Device" : "Add Yealink Device"}</DialogTitle></DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
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
          <DialogFooter className="shrink-0 border-t border-border/80 bg-muted/[0.12] px-5 py-4"><Button onClick={handleSaveDevice} data-testid="save-device-btn">{editingDevice ? "Update" : "Add"} Device</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== NEW AGREEMENT DIALOG ===== */}
      <Dialog open={agreementDialog} onOpenChange={setAgreementDialog}>
        <DialogContent className="flex h-[min(820px,calc(100vh-1.5rem))] max-h-[calc(100vh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:rounded-2xl">
          <DialogHeader className="shrink-0 border-b border-border/80 bg-gradient-to-r from-violet-400/15 via-violet-400/[0.04] to-transparent px-5 py-5 pr-12"><DialogTitle>New Phone Agreement</DialogTitle></DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
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
              <Select value={agreementForm.client_id} onValueChange={v => setAgreementForm({ ...agreementForm, client_id: v, sla_contract_id: "" })}>
                <SelectTrigger data-testid="agreement-client-select"><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Device *</Label>
              <Select value={agreementForm.device_id} onValueChange={selectAgreementDevice}>
                <SelectTrigger data-testid="agreement-device-select"><SelectValue placeholder="Select available device" /></SelectTrigger>
                <SelectContent>
                  {availableDevices.length === 0 && <div className="px-3 py-2 text-sm text-muted-foreground">No available devices</div>}
                  {availableDevices.map(d => <SelectItem key={d.id} value={d.id}>{d.model_name} - SN: {d.serial_number}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Billing contract</Label>
              <Select value={agreementForm.sla_contract_id || NO_CONTRACT} onValueChange={v => setAgreementForm({ ...agreementForm, sla_contract_id: v === NO_CONTRACT ? "" : v })} disabled={!agreementForm.client_id}>
                <SelectTrigger><SelectValue placeholder={agreementForm.client_id ? "No contract linked" : "Select a client first"} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CONTRACT}>No contract linked</SelectItem>
                  {activeClientContracts.map(contract => <SelectItem key={contract.id} value={contract.id}>{contract.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="mt-1.5 text-xs text-muted-foreground">Link the rental to the client contract that owns its billing and service context.</p>
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
            {agreementForm.device_id && <div className="rounded-xl border border-sky-400/20 bg-sky-400/[0.05] px-3 py-2.5 text-xs text-muted-foreground"><span className="font-semibold text-sky-200">Pricing assist:</span> the selected handset&apos;s purchase cost has been used as the starting device value. Review it before creating the agreement.</div>}
            <div><Label>Notes</Label><Textarea value={agreementForm.notes} onChange={e => setAgreementForm({ ...agreementForm, notes: e.target.value })} rows={2} /></div>
          </div>
          <DialogFooter className="shrink-0 border-t border-border/80 bg-muted/[0.12] px-5 py-4"><Button onClick={handleCreateAgreement} data-testid="create-agreement-btn">{agreementForm.agreement_type === "buy_outright" ? "Record Purchase" : "Create Agreement"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== REMOVE DEVICE CONFIRMATION ===== */}
      <Dialog open={Boolean(deviceToDelete)} onOpenChange={open => { if (!open) setDeviceToDelete(null); }}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader><DialogTitle>Remove phone from inventory?</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p><span className="font-medium text-foreground">{deviceToDelete?.model_name}</span> <span className="font-mono text-xs">{deviceToDelete?.serial_number}</span> will be removed from available inventory.</p>
            <p>Phones linked to an agreement cannot be removed, so the rental history remains intact.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeviceToDelete(null)}>Keep phone</Button>
            <Button variant="destructive" onClick={async () => { const id = deviceToDelete?.id; setDeviceToDelete(null); if (id) await handleDeleteDevice(id); }}><Trash2 className="mr-1.5 h-4 w-4" />Remove phone</Button>
          </DialogFooter>
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
