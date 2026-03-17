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
  RefreshCw
} from "lucide-react";
import { format } from "date-fns";

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

  const filteredContracts = contracts.filter(contract => {
    return contract.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
           contract.client_name?.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const totalValue = contracts.filter(c => c.status === 'active').reduce((sum, c) => sum + (c.value || 0), 0);

  return (
    <div className="space-y-6" data-testid="contracts-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Contracts</h1>
          <p className="text-muted-foreground">Manage service agreements and recurring billing</p>
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

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <FileText className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{contracts.length}</p>
              <p className="text-xs text-muted-foreground">Total Contracts</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">${totalValue.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Monthly Value</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Calendar className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{contracts.filter(c => c.status === 'active').length}</p>
              <p className="text-xs text-muted-foreground">Active</p>
            </div>
          </CardContent>
        </Card>
        <Card className={renewalAlerts.filter(a => a.urgency === "critical").length > 0 ? "border-red-500/30" : ""}>
          <CardContent className="p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${renewalAlerts.filter(a => a.urgency === "critical").length > 0 ? "bg-red-500/10" : "bg-amber-500/10"}`}>
              <Calendar className={`w-5 h-5 ${renewalAlerts.filter(a => a.urgency === "critical").length > 0 ? "text-red-500" : "text-amber-500"}`} />
            </div>
            <div>
              <p className={`text-2xl font-bold ${renewalAlerts.filter(a => a.urgency === "critical").length > 0 ? "text-red-500" : ""}`}>{renewalAlerts.length}</p>
              <p className="text-xs text-muted-foreground">Expiring (90d)</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <FileText className="w-5 h-5 text-purple-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{lineItems.length}</p>
              <p className="text-xs text-muted-foreground">Line Items</p>
            </div>
          </CardContent>
        </Card>
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
                    <Badge variant="outline" className="text-[9px] capitalize">{alert.sla_tier}</Badge>
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
                              <DropdownMenuItem onClick={() => openEditDialog(contract)}>
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openAddLineItem(contract)}>
                                Add Line Item
                              </DropdownMenuItem>
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
                      <TableCell colSpan={7} className="text-center py-12">
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
    </div>
  );
}
