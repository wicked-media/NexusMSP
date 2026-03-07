import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { 
  Plus, 
  Search, 
  Package,
  Server,
  Code,
  MoreVertical,
  Loader2,
  DollarSign
} from "lucide-react";
import { format } from "date-fns";

const typeConfig = {
  hardware: { label: "Hardware", icon: Server, class: "bg-blue-500/10 text-blue-500" },
  software: { label: "Software", icon: Code, class: "bg-purple-500/10 text-purple-500" }
};

export default function AssetsPage() {
  const { token } = useAuth();
  const [assets, setAssets] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    client_id: "",
    asset_type: "hardware",
    manufacturer: "",
    model: "",
    serial_number: "",
    purchase_date: "",
    warranty_expiry: "",
    cost: ""
  });

  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [assetsRes, clientsRes] = await Promise.all([
        axios.get(`${API}/assets`, { headers }),
        axios.get(`${API}/clients`, { headers })
      ]);
      setAssets(assetsRes.data);
      setClients(clientsRes.data);
    } catch (error) {
      toast.error("Failed to fetch assets");
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
      const submitData = { ...formData, cost: parseFloat(formData.cost) || 0 };
      if (selectedAsset) {
        await axios.put(`${API}/assets/${selectedAsset.id}`, submitData, { headers });
        toast.success("Asset updated");
      } else {
        await axios.post(`${API}/assets`, submitData, { headers });
        toast.success("Asset created");
      }
      setIsDialogOpen(false);
      resetForm();
      fetchData();
    } catch (error) {
      toast.error("Failed to save asset");
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this asset?")) return;
    try {
      await axios.delete(`${API}/assets/${id}`, { headers });
      toast.success("Asset deleted");
      fetchData();
    } catch (error) {
      toast.error("Failed to delete asset");
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      client_id: "",
      asset_type: "hardware",
      manufacturer: "",
      model: "",
      serial_number: "",
      purchase_date: "",
      warranty_expiry: "",
      cost: ""
    });
    setSelectedAsset(null);
  };

  const openEditDialog = (asset) => {
    setSelectedAsset(asset);
    setFormData({
      name: asset.name,
      client_id: asset.client_id,
      asset_type: asset.asset_type,
      manufacturer: asset.manufacturer || "",
      model: asset.model || "",
      serial_number: asset.serial_number || "",
      purchase_date: asset.purchase_date || "",
      warranty_expiry: asset.warranty_expiry || "",
      cost: asset.cost?.toString() || ""
    });
    setIsDialogOpen(true);
  };

  const filteredAssets = assets.filter(asset => {
    const matchesSearch = asset.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          asset.client_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          asset.serial_number?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = typeFilter === "all" || asset.asset_type === typeFilter;
    return matchesSearch && matchesType;
  });

  const totalValue = assets.reduce((sum, asset) => sum + (asset.cost || 0), 0);
  const hardwareCount = assets.filter(a => a.asset_type === "hardware").length;
  const softwareCount = assets.filter(a => a.asset_type === "software").length;

  return (
    <div className="space-y-6" data-testid="assets-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Assets</h1>
          <p className="text-muted-foreground">Track hardware and software inventory</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button data-testid="add-asset-button">
              <Plus className="w-4 h-4 mr-2" />
              Add Asset
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{selectedAsset ? "Edit Asset" : "Add New Asset"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Asset Name</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Dell PowerEdge R740"
                  required
                  data-testid="asset-name-input"
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
                    <SelectTrigger data-testid="asset-client-select">
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
                    value={formData.asset_type}
                    onValueChange={(value) => setFormData({ ...formData, asset_type: value })}
                  >
                    <SelectTrigger data-testid="asset-type-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hardware">Hardware</SelectItem>
                      <SelectItem value="software">Software</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Manufacturer</Label>
                  <Input
                    value={formData.manufacturer}
                    onChange={(e) => setFormData({ ...formData, manufacturer: e.target.value })}
                    placeholder="e.g., Dell, Microsoft"
                    data-testid="asset-manufacturer-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Model</Label>
                  <Input
                    value={formData.model}
                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                    placeholder="e.g., PowerEdge R740"
                    data-testid="asset-model-input"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Serial Number</Label>
                  <Input
                    value={formData.serial_number}
                    onChange={(e) => setFormData({ ...formData, serial_number: e.target.value })}
                    placeholder="Optional"
                    data-testid="asset-serial-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Cost ($)</Label>
                  <Input
                    type="number"
                    value={formData.cost}
                    onChange={(e) => setFormData({ ...formData, cost: e.target.value })}
                    placeholder="0.00"
                    data-testid="asset-cost-input"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Purchase Date</Label>
                  <Input
                    type="date"
                    value={formData.purchase_date}
                    onChange={(e) => setFormData({ ...formData, purchase_date: e.target.value })}
                    data-testid="asset-purchase-date-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Warranty Expiry</Label>
                  <Input
                    type="date"
                    value={formData.warranty_expiry}
                    onChange={(e) => setFormData({ ...formData, warranty_expiry: e.target.value })}
                    data-testid="asset-warranty-input"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" data-testid="asset-submit-button">
                  {selectedAsset ? "Update" : "Add Asset"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Package className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{assets.length}</p>
              <p className="text-xs text-muted-foreground">Total Assets</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Server className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{hardwareCount}</p>
              <p className="text-xs text-muted-foreground">Hardware</p>
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
              <p className="text-xs text-muted-foreground">Total Value</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search assets..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                data-testid="assets-search-input"
              />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[150px]" data-testid="assets-type-filter">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="hardware">Hardware</SelectItem>
                <SelectItem value="software">Software</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Assets Table */}
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
                    <TableHead>Asset</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Serial Number</TableHead>
                    <TableHead>Cost</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAssets.length > 0 ? filteredAssets.map(asset => {
                    const TypeIcon = typeConfig[asset.asset_type]?.icon || Package;
                    return (
                      <TableRow key={asset.id} className="table-row-hover">
                        <TableCell>
                          <div>
                            <p className="font-medium">{asset.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {asset.manufacturer} {asset.model}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{asset.client_name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={typeConfig[asset.asset_type]?.class}>
                            <TypeIcon className="w-3 h-3 mr-1" />
                            {typeConfig[asset.asset_type]?.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {asset.serial_number || "N/A"}
                        </TableCell>
                        <TableCell className="font-medium">
                          ${asset.cost?.toLocaleString() || "0"}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEditDialog(asset)}>
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                className="text-destructive"
                                onClick={() => handleDelete(asset.id)}
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
                      <TableCell colSpan={6} className="text-center py-12">
                        <Package className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                        <p className="text-muted-foreground">No assets found</p>
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
