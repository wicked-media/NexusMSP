import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { 
  Plus, 
  Search, 
  FileText,
  MoreVertical,
  Loader2,
  DollarSign,
  Calendar,
  RefreshCw,
  Shield,
  Eye,
  Download,
  Repeat,
  TrendingUp
  , PackageCheck, Smartphone, Pencil, RotateCcw, Undo2, History
} from "lucide-react";
import { format } from "date-fns";
import { PdfViewerDialog } from "@/components/PdfViewerDialog";
import { PageShell } from "@/components/design-system";
import HeroTile from "@/components/HeroTile";

const slaShieldConfig = {
  platinum: { label: "Platinum", color: "text-slate-300", bg: "bg-gradient-to-b from-slate-200 to-slate-400", border: "border-slate-400/50", fill: "#e2e8f0" },
  gold: { label: "Gold", color: "text-yellow-400", bg: "bg-gradient-to-b from-yellow-300 to-yellow-500", border: "border-yellow-500/50", fill: "#fbbf24" },
  silver: { label: "Silver", color: "text-slate-400", bg: "bg-gradient-to-b from-slate-300 to-slate-500", border: "border-slate-500/50", fill: "#94a3b8" },
  bronze: { label: "Bronze", color: "text-amber-600", bg: "bg-gradient-to-b from-amber-400 to-amber-700", border: "border-amber-600/50", fill: "#d97706" },
  standard: { label: "Standard", color: "text-gray-500", bg: "bg-gradient-to-b from-gray-400 to-gray-600", border: "border-gray-500/50", fill: "#6b7280" },
};

const SLAShieldBadge = ({ tier, size = "sm" }) => {
  const config = slaShieldConfig[tier] || slaShieldConfig.standard;
  const s = size === "lg" ? "w-8 h-8" : "w-5 h-5";
  const textSize = size === "lg" ? "text-[8px]" : "text-[5px]";
  return (
    <div className="relative inline-flex items-center gap-1.5" title={`${config.label} SLA`}>
      <div className="relative">
        <svg className={s} viewBox="0 0 24 24" fill="none">
          <path d="M12 2L3 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z" fill={config.fill} opacity="0.2" />
          <path d="M12 2L3 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z" stroke={config.fill} strokeWidth="1.5" fill="none" />
          <path d="M9 12l2 2 4-4" stroke={config.fill} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <span className={`font-semibold capitalize ${config.color} ${size === "lg" ? "text-sm" : "text-[10px]"}`}>{config.label}</span>
    </div>
  );
};

const contractTypes = {
  managed_services: { label: "Managed Services", class: "bg-blue-500/10 text-blue-500" },
  break_fix: { label: "Break/Fix", class: "bg-yellow-500/10 text-yellow-500" },
  project: { label: "Project", class: "bg-purple-500/10 text-purple-500" },
  retainer: { label: "Retainer", class: "bg-green-500/10 text-green-500" }
};

const statusConfig = {
  active: { label: "Active", class: "bg-green-500/10 text-green-500 border-green-500/20" },
  pending: { label: "Pending", class: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20" },
  expired: { label: "Expired", class: "bg-red-500/10 text-red-500 border-red-500/20" },
  cancelled: { label: "Cancelled", class: "bg-gray-500/10 text-gray-500 border-gray-500/20" }
};

export default function ContractsPage() {
  const { token } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [contracts, setContracts] = useState([]);
  const [contractTypeOptions, setContractTypeOptions] = useState([]);
  const [clients, setClients] = useState([]);
  const [lineItems, setLineItems] = useState([]);
  const [assets, setAssets] = useState([]);
  const [billingSources, setBillingSources] = useState({ asset_counts: [], products: [], pax8_products: [], pax8_linked: false });
  const [billingHealth, setBillingHealth] = useState(null);
  const [showBillingGuide, setShowBillingGuide] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [contractFilter, setContractFilter] = useState("all");
  const [renewalAlerts, setRenewalAlerts] = useState([]);
  const [contractSummary, setContractSummary] = useState(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLineItemDialogOpen, setIsLineItemDialogOpen] = useState(false);
  const [editingLineItem, setEditingLineItem] = useState(null);
  const [assetAction, setAssetAction] = useState(null);
  const [selectedContract, setSelectedContract] = useState(null);
  const [pdfViewer, setPdfViewer] = useState({ open: false, url: "", title: "", downloadUrl: "" });
  const [formData, setFormData] = useState({
    client_id: "",
    name: "",
    contract_type: "managed_services",
    billing_frequency: "monthly",
    start_date: "",
    end_date: "",
    value: "",
    auto_renew: true,
    sla_tier: "standard",
    notes: ""
  });
  const [lineItemForm, setLineItemForm] = useState({
    contract_id: "",
    client_id: "",
    name: "",
    description: "",
    quantity: "1",
    unit_price: "",
    billing_frequency: "monthly"
    , line_type: "standard", asset_id: "", term_start: "", term_end: "", supplier_cost: "", buyout_value: ""
  });

  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [contractsRes, clientsRes, lineItemsRes, assetsRes, typesRes, renewalsRes, summaryRes] = await Promise.all([
        axios.get(`${API}/contracts`, { headers }),
        axios.get(`${API}/clients`, { headers }),
        axios.get(`${API}/line-items`, { headers }),
        axios.get(`${API}/assets`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/contract-types?include_inactive=true`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/contracts/renewal-alerts`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/contracts/summary`, { headers }).catch(() => ({ data: null })),
      ]);
      setContracts(contractsRes.data);
      setClients(clientsRes.data);
      setLineItems(lineItemsRes.data);
      setAssets(assetsRes.data);
      setContractTypeOptions(typesRes.data);
      setRenewalAlerts(renewalsRes.data);
      setContractSummary(summaryRes.data);
    } catch (error) {
      toast.error("Failed to fetch contracts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const submitData = { ...formData, value: parseFloat(formData.value) || 0 };
      if (selectedContract) {
        await axios.put(`${API}/contracts/${selectedContract.id}`, submitData, { headers });
        toast.success("Contract updated");
      } else {
        await axios.post(`${API}/contracts`, submitData, { headers });
        toast.success("Contract created");
      }
      setIsDialogOpen(false);
      resetForm();
      fetchData();
    } catch (error) {
      toast.error("Failed to save contract");
    }
  };

  const handleLineItemSubmit = async (e) => {
    e.preventDefault();
    try {
      const submitData = {
        ...lineItemForm,
        quantity: parseInt(lineItemForm.quantity) || 1,
        unit_price: parseFloat(lineItemForm.unit_price) || 0,
        supplier_cost: parseFloat(lineItemForm.supplier_cost) || 0,
        buyout_value: parseFloat(lineItemForm.buyout_value) || 0
      };
      if (editingLineItem) {
        ["id", "client_name", "created_at", "total", "asset_id", "asset_name", "asset_serial_number", "asset_imei", "asset_status", "billing_lock", "asset_history"].forEach(key => delete submitData[key]);
        await axios.put(`${API}/line-items/${editingLineItem.id}`, submitData, { headers });
        toast.success("Billing inclusion updated");
      } else {
        await axios.post(`${API}/line-items`, submitData, { headers });
        toast.success("Billing inclusion added");
      }
      setIsLineItemDialogOpen(false);
      setEditingLineItem(null);
      setLineItemForm({
        contract_id: "",
        client_id: "",
        name: "",
        description: "",
        quantity: "1",
        unit_price: "",
        billing_frequency: "monthly", line_type: "standard", asset_id: "", term_start: "", term_end: "", supplier_cost: "", buyout_value: ""
      });
      fetchData();
    } catch (error) {
      toast.error("Failed to add line item");
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this contract?")) return;
    try {
      await axios.delete(`${API}/contracts/${id}`, { headers });
      toast.success("Contract deleted");
      fetchData();
    } catch (error) {
      toast.error("Failed to delete contract");
    }
  };

  const resetForm = () => {
    setFormData({
      client_id: "",
      name: "",
      contract_type: "managed_services",
      billing_frequency: "monthly",
      start_date: "",
      end_date: "",
      value: "",
      auto_renew: true,
      sla_tier: "standard",
      notes: ""
    });
    setSelectedContract(null);
    setBillingHealth(null);
    setShowBillingGuide(false);
  };

  const openEditDialog = (contract) => {
    setSelectedContract(contract);
    setFormData({
      client_id: contract.client_id,
      name: contract.name,
      contract_type: contract.contract_type,
      billing_frequency: contract.billing_frequency,
      start_date: contract.start_date,
      end_date: contract.end_date || "",
      value: contract.value?.toString() || "",
      auto_renew: contract.auto_renew,
      sla_tier: contract.sla_tier || "standard",
      notes: contract.notes || ""
    });
    setIsDialogOpen(true);
    axios.get(`${API}/contracts/${contract.id}/billing-health`, { headers }).then(result => setBillingHealth(result.data)).catch(() => setBillingHealth(null));
  };

  useEffect(() => {
    const contractId = searchParams.get("contract");
    if (!contractId || contracts.length === 0 || isDialogOpen) return;
    const contract = contracts.find(item => item.id === contractId);
    if (contract) {
      openEditDialog(contract);
    } else {
      toast.error("Contract not found");
    }
    const next = new URLSearchParams(searchParams);
    next.delete("contract");
    setSearchParams(next, { replace: true });
    // Deliberately runs once contracts have populated so an alert can open its record.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contracts, searchParams]);

  const openAddLineItem = (contract) => {
    setLineItemForm({
      contract_id: contract.id,
      client_id: contract.client_id,
      name: "", description: "", quantity: "1", unit_price: "", billing_frequency: contract.billing_frequency || "monthly",
      line_type: "standard", asset_id: "", term_start: contract.start_date || "", term_end: contract.end_date || "", supplier_cost: "", buyout_value: ""
    });
    setShowBillingGuide(false);
    setEditingLineItem(null);
    axios.get(`${API}/contracts/${contract.id}/billing-sources`, { headers }).then(result => setBillingSources(result.data)).catch(() => {});
    setIsLineItemDialogOpen(true);
  };

  const openEditLineItem = (item) => {
    setEditingLineItem(item);
    setLineItemForm({ ...item, quantity: String(item.quantity ?? 1), unit_price: String(item.unit_price ?? ""), supplier_cost: String(item.supplier_cost ?? ""), buyout_value: String(item.buyout_value ?? "") });
    setIsLineItemDialogOpen(true);
    axios.get(`${API}/contracts/${item.contract_id}/billing-sources`, { headers }).then(result => setBillingSources(result.data)).catch(() => {});
  };

  const handleAssetAction = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API}/line-items/${assetAction.item.id}/${assetAction.type === "replace" ? "replace-asset" : "return-asset"}`, assetAction.type === "replace" ? { asset_id: assetAction.asset_id, reason: assetAction.reason, effective_date: assetAction.effective_date } : { reason: assetAction.reason, effective_date: assetAction.effective_date }, { headers });
      toast.success(assetAction.type === "replace" ? "Asset replaced and lock transferred" : "Asset returned and billing stopped");
      setAssetAction(null);
      fetchData();
    } catch (error) { toast.error(error.response?.data?.detail || "Asset action failed"); }
  };

  const syncRecurring = async (contract) => {
    try { const result = await axios.post(`${API}/contracts/${contract.id}/sync-recurring`, {}, { headers }); toast.success(result.data.message); const health = await axios.get(`${API}/contracts/${contract.id}/billing-health`, { headers }); setBillingHealth(health.data); fetchData(); }
    catch (error) { toast.error(error.response?.data?.detail || "Recurring sync failed"); }
  };

  const [convertDialog, setConvertDialog] = useState(null); // holds contract
  const [convertForm, setConvertForm] = useState({ frequency: "monthly", tax_rate: 10, include_acronis_usage: true });
  const [converting, setConverting] = useState(false);

  const handleConvertToRecurring = async () => {
    if (!convertDialog) return;
    setConverting(true);
    try {
      const res = await axios.post(
        `${API}/contracts/${convertDialog.id}/convert-to-recurring`,
        convertForm,
        { headers }
      );
      toast.success(res.data.message);
      setConvertDialog(null);
      fetchData();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Convert failed");
    } finally {
      setConverting(false);
    }
  };

  const beginRecurringSetup = () => {
    if (!selectedContract) return;
    const inclusions = lineItems.filter(item => item.contract_id === selectedContract.id && item.asset_status !== "returned");
    if (!inclusions.length) {
      toast.message("Add at least one billing inclusion before creating the recurring invoice.");
      openAddLineItem(selectedContract);
      return;
    }
    setConvertForm({ frequency: selectedContract.billing_frequency || "monthly", tax_rate: 10, include_acronis_usage: true });
    setConvertDialog(selectedContract);
  };

  const resolveBillingCheck = (check) => {
    const item = lineItems.find(line => line.id === check.item_id);
    if (!item) {
      toast.message("This inclusion is no longer available. Refresh the contract and try again.");
      return;
    }
    openEditLineItem(item);
    toast.message(check.source === "pax8_subscription" ? "Confirm the Pax8 link, then save and sync the recurring invoice." : "Review the highlighted billing inclusion and save the correction.");
  };

  const filteredContracts = contracts.filter(contract => {
    const matchesSearch = contract.name.toLowerCase().includes(searchQuery.toLowerCase()) || contract.client_name?.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;
    if (contractFilter === "active") return contract.status === "active";
    if (contractFilter === "renewing") return renewalAlerts.some((alert) => alert.contract_id === contract.id);
    if (contractFilter === "line-items") return lineItems.some((item) => item.contract_id === contract.id);
    return true;
  });

  const totalValue = contracts.filter(c => c.status === 'active').reduce((sum, c) => sum + (c.value || 0), 0);

  return (
    <PageShell data-testid="contracts-page">
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="w-9 h-9 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center"><Shield className="w-4 h-4 text-violet-300" /></span>
          <div><h1 className="text-2xl font-bold tracking-tight">Contracts</h1><p className="text-sm text-muted-foreground">Service agreements, renewals, and recurring billing.</p></div>
        </div>
        <Button variant="outline" onClick={() => window.location.assign("/contract-profit")}><TrendingUp className="mr-2 h-4 w-4 text-emerald-400" />Profitability</Button>
        <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button data-testid="create-contract-button">
              <Plus className="w-4 h-4 mr-2" />
              New Contract
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-4xl overflow-hidden border-violet-500/20 bg-background/95 p-0">
            <DialogHeader className="border-b border-border/80 px-6 py-5">
              <div className="flex items-start gap-3 pr-6">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-violet-500/30 bg-violet-500/10"><FileText className="h-5 w-5 text-violet-300" /></span>
                <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300">Agreement workspace</p><DialogTitle className="mt-1">{selectedContract ? "Update contract record" : "Create service agreement"}</DialogTitle><p className="mt-1 text-sm text-muted-foreground">{selectedContract ? "Review commercial terms, renewal settings, billing inclusions, and the service commitment in one place." : "Capture the commercial commitment first, then add inclusions and create the linked recurring invoice when it is ready."}</p></div>
              </div>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
              <div className="grid grid-cols-3 gap-2 rounded-xl border border-violet-500/15 bg-violet-500/[0.035] p-3 text-xs">
                <div><p className="text-muted-foreground">Commercial value</p><p className="mt-1 font-semibold text-emerald-300">${Number(formData.value || 0).toLocaleString()}/mo</p></div>
                <div><p className="text-muted-foreground">Billing cadence</p><p className="mt-1 font-semibold capitalize">{formData.billing_frequency || "monthly"}</p></div>
                <div><p className="text-muted-foreground">Renewal</p><p className={`mt-1 font-semibold ${formData.auto_renew ? "text-sky-300" : "text-muted-foreground"}`}>{formData.auto_renew ? "Auto-renew on" : "Manual review"}</p></div>
              </div>
              <div className="flex items-center gap-2 pt-1"><span className="h-1.5 w-1.5 rounded-full bg-violet-400" /><p className="text-xs font-semibold uppercase tracking-wider text-violet-200">Agreement details</p></div>
              <div className="space-y-2">
                <Label>Contract Name</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Managed Services Agreement"
                  required
                  data-testid="contract-name-input"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Client</Label>
                  <Select
                    value={formData.client_id}
                    onValueChange={(value) => setFormData({ ...formData, client_id: value })}
                    required
                  >
                    <SelectTrigger data-testid="contract-client-select">
                      <SelectValue placeholder="Select client" />
                    </SelectTrigger>
                    <SelectContent>
                      {clients.map(client => (
                        <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between"><Label>Type</Label><button type="button" className="text-xs text-violet-300 hover:underline" onClick={() => window.location.assign("/settings?tab=contract-types")}>Manage types</button></div>
                  <Select
                    value={formData.contract_type}
                    onValueChange={(value) => {
                      const type = contractTypeOptions.find(item => item.code === value);
                      setFormData({
                        ...formData,
                        contract_type: value,
                        billing_frequency: type?.default_billing_frequency || formData.billing_frequency,
                        sla_tier: type?.default_sla_tier || formData.sla_tier,
                      });
                    }}
                  >
                    <SelectTrigger data-testid="contract-type-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(contractTypeOptions.length ? contractTypeOptions.filter(type => type.is_active || type.code === formData.contract_type) : Object.entries(contractTypes).map(([code, type]) => ({ code, name: type.label }))).map(type => <SelectItem key={type.code} value={type.code}>{type.name}{type.is_active === false ? " (inactive)" : ""}</SelectItem>)}
                    </SelectContent>
                  </Select>
        </div>
      </div>
              <div className="flex items-center gap-2 pt-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /><p className="text-xs font-semibold uppercase tracking-wider text-emerald-200">Commercial terms</p></div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Start Date</Label>
                  <Input
                    type="date"
                    value={formData.start_date}
                    onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                    required
                    data-testid="contract-start-date"
                  />
                </div>
                <div className="space-y-2">
                  <Label>End Date (Optional)</Label>
                  <Input
                    type="date"
                    value={formData.end_date}
                    onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                    data-testid="contract-end-date"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Monthly Value ($)</Label>
                  <Input
                    type="number"
                    value={formData.value}
                    onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                    placeholder="0.00"
                    data-testid="contract-value-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Billing Frequency</Label>
                  <Select
                    value={formData.billing_frequency}
                    onValueChange={(value) => setFormData({ ...formData, billing_frequency: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="quarterly">Quarterly</SelectItem>
                      <SelectItem value="annually">Annually</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <Label>Auto-Renew</Label>
                <Switch
                  checked={formData.auto_renew}
                  onCheckedChange={(checked) => setFormData({ ...formData, auto_renew: checked })}
                />
              </div>
              <div className="flex items-center gap-2 pt-1"><span className="h-1.5 w-1.5 rounded-full bg-sky-400" /><p className="text-xs font-semibold uppercase tracking-wider text-sky-200">Service commitment</p></div>
              <div className="space-y-2">
                <Label>SLA Tier</Label>
                <Select value={formData.sla_tier || "standard"} onValueChange={(v) => setFormData({ ...formData, sla_tier: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="platinum">Platinum - 1h Response</SelectItem>
                    <SelectItem value="gold">Gold - 4h Response</SelectItem>
                    <SelectItem value="silver">Silver - 8h Response</SelectItem>
                    <SelectItem value="standard">Standard - 24h Response</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Additional notes..."
                  rows={2}
                />
              </div>
              {selectedContract && (
                <div className="space-y-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] p-3" data-testid="contract-billing-inclusions">
                  <div className="flex items-start justify-between gap-3">
                    <div><p className="text-sm font-semibold">Billing inclusions</p><p className="text-xs text-muted-foreground">Services, asset counts, and serial-locked phone or hardware commitments.</p></div>
                    <Button type="button" size="sm" onClick={() => openAddLineItem(selectedContract)}><Plus className="mr-1 h-3.5 w-3.5" />Add inclusion</Button>
                  </div>
                  {lineItems.filter(item => item.contract_id === selectedContract.id).length === 0 ? <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">No billing inclusions yet. Add a standard service or a serial-locked asset commitment.</p> : (
                    <div className="space-y-2">
                      {lineItems.filter(item => item.contract_id === selectedContract.id).map(item => (
                        <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background/60 p-2.5">
                          <div className="min-w-0"><div className="flex items-center gap-2"><p className="text-sm font-medium truncate">{item.name}</p><Badge variant="outline" className="text-[10px] capitalize">{(item.billing_source || item.line_type || "manual").replaceAll("_", " ")}</Badge>{item.line_type === "asset_backed" && <Badge className={item.asset_status === "active" ? "bg-emerald-500/15 text-emerald-300" : "bg-muted text-muted-foreground"}>{item.asset_status === "active" ? "Locked" : item.asset_status}</Badge>}</div><p className="text-xs text-muted-foreground">{item.line_type === "asset_backed" ? `${item.asset_name || "Asset"} · ${item.asset_serial_number || "No serial"}${item.asset_imei ? ` · IMEI ${item.asset_imei}` : ""}` : item.billing_source === "pax8_subscription" ? "Live Pax8 seats and prices attached at invoice generation" : item.billing_source === "asset_count" ? `Live count: ${item.asset_type_filter || "all active assets"}` : item.billing_source === "inventory" ? "Live warehouse stock quantity" : item.description || "Standard recurring inclusion"}</p></div>
                          <div className="flex items-center gap-1"><span className="mr-1 text-sm font-semibold text-emerald-300">${Number(item.total ?? item.quantity * item.unit_price).toFixed(2)}</span><Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditLineItem(item)} title="Edit inclusion"><Pencil className="h-3.5 w-3.5" /></Button>{item.line_type === "asset_backed" && item.asset_status === "active" && <><Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setAssetAction({ type: "replace", item, asset_id: "", reason: "", effective_date: new Date().toISOString().slice(0, 10) })} title="Replace asset"><RotateCcw className="h-3.5 w-3.5" /></Button><Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setAssetAction({ type: "return", item, reason: "", effective_date: new Date().toISOString().slice(0, 10) })} title="Return asset"><Undo2 className="h-3.5 w-3.5" /></Button></>}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {selectedContract.recurring_invoice_id && <Button type="button" variant="outline" size="sm" onClick={() => syncRecurring(selectedContract)}><RefreshCw className="mr-1 h-3.5 w-3.5" />Sync active inclusions to recurring invoice</Button>}
                </div>
              )}
              {selectedContract && billingHealth && (
                <div className={`rounded-xl border p-3 ${billingHealth.overall === "ready" ? "border-emerald-500/20 bg-emerald-500/[0.03]" : "border-amber-500/25 bg-amber-500/[0.035]"}`} data-testid="contract-billing-health">
                  <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold">Billing health</p><p className="text-xs text-muted-foreground">{billingHealth.recurring_invoice_id ? `Recurring ${billingHealth.recurring_status || "linked"} · next run ${billingHealth.next_generation || "not scheduled"}` : "No recurring invoice linked yet"}</p></div><Badge className={billingHealth.overall === "ready" ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}>{billingHealth.overall === "ready" ? "Ready to bill" : "Needs attention"}</Badge></div>
                  {billingHealth.checks?.length > 0 && <div className="mt-3 space-y-1.5">{billingHealth.checks.map(check => <div key={check.item_id} className="flex items-center justify-between gap-3 rounded-md bg-background/50 px-2.5 py-2 text-xs"><div className="min-w-0"><span className="font-medium">{check.name}</span><span className="ml-2 text-muted-foreground">{check.detail}</span></div><Badge variant="outline" className={check.state === "ready" ? "border-emerald-500/25 text-emerald-300" : "border-amber-500/25 text-amber-300"}>{check.state}</Badge></div>)}</div>}
                  {billingHealth.overall !== "ready" && <div className="mt-3 border-t border-amber-500/15 pt-3"><Button type="button" size="sm" variant="outline" className="border-amber-500/30 text-amber-200 hover:bg-amber-500/10" onClick={() => setShowBillingGuide(open => !open)} data-testid="billing-health-guide-button">{showBillingGuide ? "Hide resolution plan" : "Resolve billing health"}</Button>{showBillingGuide && <div className="mt-3 space-y-2 rounded-lg border border-amber-500/15 bg-background/40 p-3"><p className="text-xs font-semibold text-amber-100">Resolution plan</p>{!billingHealth.recurring_invoice_id && <div className="flex items-center justify-between gap-3 rounded-md bg-background/60 p-2.5 text-xs"><p><span className="font-medium">1. Create the recurring invoice</span><br /><span className="text-muted-foreground">This is required before this contract can be billed automatically.</span></p><Button type="button" size="sm" onClick={beginRecurringSetup}>Set up</Button></div>}{billingHealth.checks?.filter(check => check.state !== "ready").map((check, index) => <div key={`guide-${check.item_id}`} className="flex items-center justify-between gap-3 rounded-md bg-background/60 p-2.5 text-xs"><p className="min-w-0"><span className="font-medium">{!billingHealth.recurring_invoice_id ? index + 2 : index + 1}. Fix {check.name}</span><br /><span className="text-muted-foreground">{check.detail}</span></p><Button type="button" size="sm" variant="outline" onClick={() => resolveBillingCheck(check)}>Review</Button></div>)}<p className="text-[11px] text-muted-foreground">When all items are ready, use “Sync active inclusions” to update the linked recurring invoice.</p></div>}</div>}
                </div>
              )}
              </div>
              <DialogFooter className="border-t border-border/80 px-6 py-4">
                <Button type="button" variant="outline" onClick={() => { setIsDialogOpen(false); resetForm(); }}>Cancel</Button>
                <Button type="submit" data-testid="contract-submit-button">
                  {selectedContract ? "Save contract" : "Create contract"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <HeroTile label="All contracts" value={contracts.length} subtitle="View full register" icon={FileText} glow="cyan" active={contractFilter === "all"} onClick={() => setContractFilter("all")} testId="contracts-metric-total" />
        <HeroTile label="Monthly value" value={`$${totalValue.toLocaleString()}`} subtitle="Active agreements" icon={DollarSign} glow="emerald" animated={false} active={contractFilter === "active"} onClick={() => setContractFilter("active")} testId="contracts-metric-value" />
        <HeroTile label="Active" value={contracts.filter(c => c.status === 'active').length} subtitle="Current coverage" icon={Calendar} glow="sky" active={contractFilter === "active"} onClick={() => setContractFilter("active")} testId="contracts-metric-active" />
        <HeroTile label="Expiring in 90 days" value={renewalAlerts.length} subtitle="Renewal worklist" icon={Calendar} glow={renewalAlerts.filter(a => a.urgency === "critical").length > 0 ? "rose" : "amber"} active={contractFilter === "renewing"} onClick={() => setContractFilter("renewing")} testId="contracts-metric-expiring" />
        <HeroTile label="Line items" value={lineItems.length} subtitle="Billable inclusions" icon={FileText} glow="violet" active={contractFilter === "line-items"} onClick={() => setContractFilter("line-items")} testId="contracts-metric-lineitems" />
      </div>

      {/* Renewal Alerts */}
      {renewalAlerts.length > 0 && (
        <Card className="border-amber-500/20" data-testid="renewal-alerts">
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Calendar className="w-4 h-4 text-amber-500" />Contract Renewal Alerts</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {renewalAlerts.slice(0, 5).map(alert => (
                <button type="button" key={alert.contract_id} onClick={() => {
                  const contract = contracts.find(item => item.id === alert.contract_id);
                  if (contract) openEditDialog(contract);
                }} className={`flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors hover:bg-muted/40 ${alert.urgency === "critical" ? "bg-red-500/5 border-red-500/20" : alert.urgency === "warning" ? "bg-amber-500/5 border-amber-500/20" : "bg-blue-500/5 border-blue-500/20"}`}>
                  <div className="flex items-center gap-3">
                    <Badge className={`text-[10px] ${alert.urgency === "critical" ? "bg-red-500/20 text-red-400" : alert.urgency === "warning" ? "bg-amber-500/20 text-amber-400" : "bg-blue-500/20 text-blue-400"}`}>{alert.days_remaining} days</Badge>
                    <div>
                      <p className="text-sm font-medium">{alert.contract_name}</p>
                      <p className="text-xs text-muted-foreground">{alert.client_name} | Expires: {alert.end_date?.split("T")[0]}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-sm">${(alert.value || 0).toLocaleString()}/mo</p>
                    <Badge variant="outline" className="text-[9px] capitalize"><SLAShieldBadge tier={alert.sla_tier} /></Badge>
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search contracts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              data-testid="contracts-search-input"
            />
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Showing {filteredContracts.length} of {contracts.length}</span>
            {contractFilter !== "all" && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setContractFilter("all")}>Clear filter</Button>}
          </div>
          </div>
        </CardContent>
      </Card>

      {/* Line Item Dialog */}
      <Dialog open={isLineItemDialogOpen} onOpenChange={setIsLineItemDialogOpen}>
        <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-3xl overflow-hidden p-0">
          <DialogHeader className="border-b border-border/80 px-6 py-5">
            <DialogTitle className="flex items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-500/25 bg-emerald-500/10"><PackageCheck className="h-4 w-4 text-emerald-300" /></span>{editingLineItem ? "Update billing inclusion" : "Add billing inclusion"}</DialogTitle>
            <p className="mt-1 text-sm text-muted-foreground">Define the billable service, live source, or serial-locked asset commitment that belongs to this agreement.</p>
          </DialogHeader>
          <form onSubmit={handleLineItemSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <div className="space-y-2">
              <Label>Inclusion type</Label>
              <Select value={lineItemForm.line_type || "standard"} onValueChange={(line_type) => setLineItemForm({ ...lineItemForm, line_type, billing_source: line_type === "standard" ? "manual" : line_type, quantity: line_type === "asset_backed" ? "1" : lineItemForm.quantity })} disabled={editingLineItem?.line_type === "asset_backed"}>
                <SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="standard">Manual service or product</SelectItem><SelectItem value="asset_count">Live client asset count</SelectItem><SelectItem value="asset_backed">Asset-backed commitment</SelectItem><SelectItem value="pax8_subscription">Live Pax8 / Microsoft subscription</SelectItem></SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Live sources refresh their quantity when the recurring invoice is generated. Asset-backed commitments lock a serial/IMEI until formally replaced or returned.</p>
            </div>
            <div className="space-y-2">
              <Label>Item Name</Label>
              <Input
                value={lineItemForm.name}
                onChange={(e) => setLineItemForm({ ...lineItemForm, name: e.target.value })}
                placeholder="e.g., Microsoft 365 Business"
                required
              />
            </div>
            {lineItemForm.line_type === "asset_backed" && (
              <div className="space-y-3 rounded-lg border border-violet-500/20 bg-violet-500/[0.035] p-3">
                <div className="flex items-center gap-2"><Smartphone className="h-4 w-4 text-violet-300" /><p className="text-sm font-medium">Locked client asset</p></div>
                <div className="space-y-2"><Label>Asset / serial</Label><Select value={lineItemForm.asset_id || ""} onValueChange={(asset_id) => setLineItemForm({ ...lineItemForm, asset_id })} disabled={!!editingLineItem}><SelectTrigger><SelectValue placeholder="Select an available client asset" /></SelectTrigger><SelectContent>{assets.filter(asset => asset.client_id === lineItemForm.client_id && (!asset.billing_lock || asset.id === editingLineItem?.asset_id)).map(asset => <SelectItem key={asset.id} value={asset.id}>{asset.name} · {asset.serial_number || "No serial"}{asset.imei ? ` · ${asset.imei}` : ""}</SelectItem>)}</SelectContent></Select></div>
                {!editingLineItem && assets.filter(asset => asset.client_id === lineItemForm.client_id && !asset.billing_lock).length === 0 && <p className="text-xs text-amber-300">No available assets for this client. Create/import the asset first so its serial or IMEI is captured.</p>}
                <div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label>Commitment starts</Label><Input type="date" value={lineItemForm.term_start || ""} onChange={e => setLineItemForm({ ...lineItemForm, term_start: e.target.value })} /></div><div className="space-y-2"><Label>Commitment ends</Label><Input type="date" value={lineItemForm.term_end || ""} onChange={e => setLineItemForm({ ...lineItemForm, term_end: e.target.value })} /></div><div className="space-y-2"><Label>Supplier cost ($)</Label><Input type="number" step="0.01" value={lineItemForm.supplier_cost || ""} onChange={e => setLineItemForm({ ...lineItemForm, supplier_cost: e.target.value })} /></div><div className="space-y-2"><Label>Buyout / residual ($)</Label><Input type="number" step="0.01" value={lineItemForm.buyout_value || ""} onChange={e => setLineItemForm({ ...lineItemForm, buyout_value: e.target.value })} /></div></div>
              </div>
            )}
            {lineItemForm.line_type === "asset_count" && <div className="space-y-2 rounded-lg border border-sky-500/20 bg-sky-500/[0.035] p-3"><Label>Count active client assets</Label><Select value={lineItemForm.asset_type_filter || "all"} onValueChange={asset_type_filter => setLineItemForm({ ...lineItemForm, asset_type_filter: asset_type_filter === "all" ? "" : asset_type_filter })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All active assets</SelectItem>{billingSources.asset_counts.map(row => <SelectItem key={row.asset_type} value={row.asset_type}>{row.asset_type} · {row.quantity} active</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">The quantity is recalculated at invoice generation, not copied as a static number.</p></div>}
            {lineItemForm.line_type === "pax8_subscription" && <div className="space-y-2 rounded-lg border border-indigo-500/20 bg-indigo-500/[0.035] p-3"><Label>Pax8 subscription product</Label><Select value={lineItemForm.pax8_product_id || ""} onValueChange={pax8_product_id => { const product = billingSources.pax8_products.find(row => row.product_id === pax8_product_id); setLineItemForm({ ...lineItemForm, pax8_product_id, name: product?.name || lineItemForm.name, description: product ? `${product.vendor} · live Pax8 seats` : lineItemForm.description }); }}><SelectTrigger><SelectValue placeholder={billingSources.pax8_linked ? "Select a synced Pax8 product" : "Link a Pax8 company first"} /></SelectTrigger><SelectContent>{billingSources.pax8_products.map(row => <SelectItem key={row.product_id} value={row.product_id}>{row.name} · {row.quantity} seats · {row.billing_term}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">Current Pax8 quantities and prices are added once at invoice generation. This contract inclusion is a visible control, not a second charge.</p></div>}
            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                value={lineItemForm.description}
                onChange={(e) => setLineItemForm({ ...lineItemForm, description: e.target.value })}
                placeholder="Optional description"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Quantity</Label>
                <Input
                  type="number"
                  value={lineItemForm.quantity}
                  onChange={(e) => setLineItemForm({ ...lineItemForm, quantity: e.target.value })}
                  min="1"
                />
              </div>
              <div className="space-y-2">
                <Label>Unit Price ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={lineItemForm.unit_price}
                  onChange={(e) => setLineItemForm({ ...lineItemForm, unit_price: e.target.value })}
                  placeholder="0.00"
                />
              </div>
            </div>
            </div>
            <DialogFooter className="border-t border-border/80 px-6 py-4">
              <Button type="button" variant="outline" onClick={() => { setIsLineItemDialogOpen(false); setEditingLineItem(null); }}>Cancel</Button><Button type="submit">{editingLineItem ? "Save inclusion" : "Add inclusion"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Contracts Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ScrollArea className="h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Contract</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>SLA</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Line Items</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredContracts.length > 0 ? filteredContracts.map(contract => {
                    const contractLineItems = lineItems.filter(li => li.contract_id === contract.id);
                    return (
                      <TableRow key={contract.id} className="table-row-hover cursor-pointer" onClick={() => openEditDialog(contract)} title="Open contract workspace">
                        <TableCell>
                          <div>
                            <p className="font-medium">{contract.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {contract.start_date} - {contract.end_date || "Ongoing"}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{contract.client_name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={contractTypes[contract.contract_type]?.class}>
                            {contractTypeOptions.find(type => type.code === contract.contract_type)?.name || contractTypes[contract.contract_type]?.label || contract.contract_type}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <SLAShieldBadge tier={contract.sla_tier || "standard"} />
                        </TableCell>
                        <TableCell>
                          <span className="font-semibold text-green-500">
                            ${contract.value?.toLocaleString()}/mo
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={statusConfig[contract.status]?.class}>
                            {statusConfig[contract.status]?.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">{contractLineItems.length} items</span>
                        </TableCell>
                        <TableCell onClick={(event) => event.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setPdfViewer({ open: true, url: `${API}/contracts/${contract.id}/pdf?token=${token}`, title: contract.name, downloadUrl: `${API}/contracts/${contract.id}/pdf/download?token=${token}` })}>
                                <Eye className="w-3.5 h-3.5 mr-2" />Preview PDF
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => { const a = document.createElement("a"); a.href = `${API}/contracts/${contract.id}/pdf/download?token=${token}`; a.target = "_blank"; a.rel = "noopener"; document.body.appendChild(a); a.click(); setTimeout(() => document.body.removeChild(a), 200); toast.success("Downloading contract PDF"); }}>
                                <Download className="w-3.5 h-3.5 mr-2" />Download PDF
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openEditDialog(contract)}>
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openAddLineItem(contract)}>
                                Add Line Item
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => { setConvertDialog(contract); setConvertForm({ frequency: contract.billing_frequency || "monthly", tax_rate: 10, include_acronis_usage: true }); }}
                                data-testid={`convert-recurring-${contract.id}`}
                                disabled={contractLineItems.length === 0}
                              >
                                <Repeat className="w-3.5 h-3.5 mr-2" />
                                Convert to Recurring Invoice
                              </DropdownMenuItem>
                              {contract.recurring_invoice_id && (
                                <DropdownMenuItem
                                  onClick={() => window.open(`/recurring-invoices?id=${contract.recurring_invoice_id}`, "_self")}
                                >
                                  <RefreshCw className="w-3.5 h-3.5 mr-2 text-emerald-400" />
                                  View Linked Recurring
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem 
                                className="text-destructive"
                                onClick={() => handleDelete(contract.id)}
                              >
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  }) : (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-12">
                        <FileText className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                        <p className="text-muted-foreground">No contracts found</p>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <PdfViewerDialog
        open={pdfViewer.open}
        onOpenChange={v => setPdfViewer(p => ({ ...p, open: v }))}
        pdfUrl={pdfViewer.url}
        title={pdfViewer.title}
        downloadUrl={pdfViewer.downloadUrl}
      />

      {/* Convert to Recurring Dialog */}
      <Dialog open={!!convertDialog} onOpenChange={v => !v && setConvertDialog(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-2xl overflow-hidden p-0" aria-describedby="convert-desc">
          <DialogHeader className="border-b border-border/80 px-6 py-5">
            <div className="flex items-start gap-3 pr-6"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-500/25 bg-emerald-500/10"><Repeat className="h-5 w-5 text-emerald-300" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300">Billing workflow</p><DialogTitle className="mt-1">Create recurring invoice</DialogTitle><p id="convert-desc" className="mt-1 text-sm text-muted-foreground">Create a linked recurring invoice template from this contract’s {lineItems.filter(li => li.contract_id === convertDialog?.id).length} inclusions. The first run will use the settings confirmed below.</p></div></div>
          </DialogHeader>
          <div className="space-y-5 px-6 py-5">
            <div>
              <Label className="text-xs">Billing Frequency</Label>
              <Select value={convertForm.frequency} onValueChange={v => setConvertForm({ ...convertForm, frequency: v })}>
                <SelectTrigger data-testid="convert-frequency-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="annually">Annually</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Tax Rate (%)</Label>
              <Input
                type="number"
                value={convertForm.tax_rate}
                onChange={e => setConvertForm({ ...convertForm, tax_rate: parseFloat(e.target.value) || 0 })}
                className="h-9"
              />
              <p className="text-[10px] text-muted-foreground mt-1">Default 10% (Australian GST)</p>
            </div>
            <div className="flex items-center justify-between p-3 rounded-md border bg-muted/30">
              <div>
                <Label className="text-xs">Auto-attach Acronis usage</Label>
                <p className="text-[10px] text-muted-foreground">Each generated invoice will include fresh Acronis billing for the period</p>
              </div>
              <Switch
                checked={convertForm.include_acronis_usage}
                onCheckedChange={v => setConvertForm({ ...convertForm, include_acronis_usage: v })}
                data-testid="include-acronis-switch"
              />
            </div>
          </div>
          <DialogFooter className="border-t border-border/80 px-6 py-4">
            <Button variant="outline" onClick={() => setConvertDialog(null)}>Cancel</Button>
            <Button onClick={handleConvertToRecurring} disabled={converting} data-testid="confirm-convert-btn">
              {converting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Repeat className="w-4 h-4 mr-1" />}
              Create Recurring Invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!assetAction} onOpenChange={v => !v && setAssetAction(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-2xl overflow-hidden p-0">
          <DialogHeader className="border-b border-border/80 px-6 py-5"><div className="flex items-start gap-3 pr-6"><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${assetAction?.type === "replace" ? "border-violet-500/25 bg-violet-500/10" : "border-amber-500/25 bg-amber-500/10"}`}>{assetAction?.type === "replace" ? <RotateCcw className="h-5 w-5 text-violet-300" /> : <Undo2 className="h-5 w-5 text-amber-300" />}</span><div><p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${assetAction?.type === "replace" ? "text-violet-300" : "text-amber-300"}`}>Asset billing control</p><DialogTitle className="mt-1">{assetAction?.type === "replace" ? "Replace locked asset" : "Return locked asset"}</DialogTitle><p className="mt-1 text-sm text-muted-foreground">{assetAction?.type === "replace" ? "The original serial stays in the audit trail and the billing lock moves to the replacement." : "Release the serial and exclude it from the next recurring-invoice sync."}</p></div></div></DialogHeader>
          <form onSubmit={handleAssetAction} className="space-y-5 px-6 py-5">
            {assetAction?.type === "replace" && <div className="space-y-2"><Label>Replacement asset</Label><Select value={assetAction.asset_id} onValueChange={asset_id => setAssetAction({ ...assetAction, asset_id })}><SelectTrigger><SelectValue placeholder="Select an available client asset" /></SelectTrigger><SelectContent>{assets.filter(asset => asset.client_id === assetAction.item.client_id && !asset.billing_lock).map(asset => <SelectItem key={asset.id} value={asset.id}>{asset.name} · {asset.serial_number || "No serial"}{asset.imei ? ` · ${asset.imei}` : ""}</SelectItem>)}</SelectContent></Select></div>}
            <div className="space-y-2"><Label>Effective date</Label><Input type="date" value={assetAction?.effective_date || ""} onChange={e => setAssetAction({ ...assetAction, effective_date: e.target.value })} required /></div>
            <div className="space-y-2"><Label>Reason</Label><Textarea value={assetAction?.reason || ""} onChange={e => setAssetAction({ ...assetAction, reason: e.target.value })} placeholder="e.g., Warranty replacement" required /></div>
            <DialogFooter className="border-t border-border/80 pt-5"><Button type="button" variant="outline" onClick={() => setAssetAction(null)}>Cancel</Button><Button type="submit" disabled={assetAction?.type === "replace" && !assetAction.asset_id}>{assetAction?.type === "replace" ? "Transfer billing lock" : "Confirm return"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      </div>
    </PageShell>
  );
}
