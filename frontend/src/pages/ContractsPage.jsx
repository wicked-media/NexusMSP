import { useState, useEffect } from "react";
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
  Repeat
} from "lucide-react";
import { format } from "date-fns";
import { PdfViewerDialog } from "@/components/PdfViewerDialog";
import { PageShell, MetricStrip, MetricTile } from "@/components/design-system";

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
  const [contracts, setContracts] = useState([]);
  const [clients, setClients] = useState([]);
  const [lineItems, setLineItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [renewalAlerts, setRenewalAlerts] = useState([]);
  const [contractSummary, setContractSummary] = useState(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLineItemDialogOpen, setIsLineItemDialogOpen] = useState(false);
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
  });

  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [contractsRes, clientsRes, lineItemsRes, renewalsRes, summaryRes] = await Promise.all([
        axios.get(`${API}/contracts`, { headers }),
        axios.get(`${API}/clients`, { headers }),
        axios.get(`${API}/line-items`, { headers }),
        axios.get(`${API}/contracts/renewal-alerts`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/contracts/summary`, { headers }).catch(() => ({ data: null })),
      ]);
      setContracts(contractsRes.data);
      setClients(clientsRes.data);
      setLineItems(lineItemsRes.data);
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
        unit_price: parseFloat(lineItemForm.unit_price) || 0
      };
      await axios.post(`${API}/line-items`, submitData, { headers });
      toast.success("Line item added");
      setIsLineItemDialogOpen(false);
      setLineItemForm({
        contract_id: "",
        client_id: "",
        name: "",
        description: "",
        quantity: "1",
        unit_price: "",
        billing_frequency: "monthly"
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
      notes: ""
    });
    setSelectedContract(null);
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
      notes: contract.notes || ""
    });
    setIsDialogOpen(true);
  };

  const openAddLineItem = (contract) => {
    setLineItemForm({
      ...lineItemForm,
      contract_id: contract.id,
      client_id: contract.client_id
    });
    setIsLineItemDialogOpen(true);
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
    } catch (e) {
      toast.error(e.response?.data?.detail || "Convert failed");
    } finally {
      setConverting(false);
    }
  };

  const filteredContracts = contracts.filter(contract => {
    return contract.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
           contract.client_name?.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const totalValue = contracts.filter(c => c.status === 'active').reduce((sum, c) => sum + (c.value || 0), 0);

  return (
    <PageShell data-testid="contracts-page">
      <MetricStrip columns={5}>
        <MetricTile label="Total Contracts" value={contracts.length} accent="indigo" icon={<FileText className="w-2.5 h-2.5 text-indigo-400" />} testid="contracts-metric-total" />
        <MetricTile label="Monthly Value" value={`$${totalValue.toLocaleString()}`} accent="emerald" icon={<DollarSign className="w-2.5 h-2.5 text-emerald-400" />} testid="contracts-metric-value" />
        <MetricTile label="Active" value={contracts.filter(c => c.status === 'active').length} accent="sky" icon={<Calendar className="w-2.5 h-2.5 text-sky-400" />} testid="contracts-metric-active" />
        <MetricTile label="Expiring (90d)" value={renewalAlerts.length} accent={renewalAlerts.filter(a => a.urgency === "critical").length > 0 ? "rose" : "amber"} icon={<Calendar className="w-2.5 h-2.5 text-amber-400" />} testid="contracts-metric-expiring" />
        <MetricTile label="Line Items" value={lineItems.length} accent="violet" icon={<FileText className="w-2.5 h-2.5 text-violet-400" />} testid="contracts-metric-lineitems" />
      </MetricStrip>
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Contracts</h1>
          <p className="text-xs text-zinc-500 mt-0.5">Manage service agreements and recurring billing</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button data-testid="create-contract-button">
              <Plus className="w-4 h-4 mr-2" />
              New Contract
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{selectedContract ? "Edit Contract" : "Create New Contract"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
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
                  <Label>Type</Label>
                  <Select
                    value={formData.contract_type}
                    onValueChange={(value) => setFormData({ ...formData, contract_type: value })}
                  >
                    <SelectTrigger data-testid="contract-type-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="managed_services">Managed Services</SelectItem>
                      <SelectItem value="break_fix">Break/Fix</SelectItem>
                      <SelectItem value="project">Project</SelectItem>
                      <SelectItem value="retainer">Retainer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
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
              <DialogFooter>
                <Button type="submit" data-testid="contract-submit-button">
                  {selectedContract ? "Update" : "Create Contract"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Renewal Alerts */}
      {renewalAlerts.length > 0 && (
        <Card className="border-amber-500/20" data-testid="renewal-alerts">
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Calendar className="w-4 h-4 text-amber-500" />Contract Renewal Alerts</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {renewalAlerts.slice(0, 5).map(alert => (
                <div key={alert.contract_id} className={`flex items-center justify-between p-3 rounded-lg border ${alert.urgency === "critical" ? "bg-red-500/5 border-red-500/20" : alert.urgency === "warning" ? "bg-amber-500/5 border-amber-500/20" : "bg-blue-500/5 border-blue-500/20"}`}>
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
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search */}
      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search contracts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              data-testid="contracts-search-input"
            />
          </div>
        </CardContent>
      </Card>

      {/* Line Item Dialog */}
      <Dialog open={isLineItemDialogOpen} onOpenChange={setIsLineItemDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Line Item</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleLineItemSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Item Name</Label>
              <Input
                value={lineItemForm.name}
                onChange={(e) => setLineItemForm({ ...lineItemForm, name: e.target.value })}
                placeholder="e.g., Microsoft 365 Business"
                required
              />
            </div>
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
            <DialogFooter>
              <Button type="submit">Add Line Item</Button>
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
                      <TableRow key={contract.id} className="table-row-hover">
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
                            {contractTypes[contract.contract_type]?.label}
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
                        <TableCell>
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
        <DialogContent className="sm:max-w-[500px]" aria-describedby="convert-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Repeat className="w-5 h-5 text-emerald-400" />Convert to Recurring Invoice</DialogTitle>
            <p id="convert-desc" className="text-xs text-muted-foreground">
              Creates a linked recurring invoice template from this contract's {lineItems.filter(li => li.contract_id === convertDialog?.id).length} line item(s).
              Each generation will auto-attach current Acronis usage (if linked).
            </p>
          </DialogHeader>
          <div className="space-y-3">
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
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConvertDialog(null)}>Cancel</Button>
            <Button onClick={handleConvertToRecurring} disabled={converting} data-testid="confirm-convert-btn">
              {converting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Repeat className="w-4 h-4 mr-1" />}
              Create Recurring Invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </PageShell>
  );
}
