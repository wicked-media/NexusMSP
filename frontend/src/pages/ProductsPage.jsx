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
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Plus, Search, Loader2, Package, Edit, Trash2, DollarSign, Tag,
  BarChart3, AlertTriangle, ArrowUpDown, ShoppingCart, RefreshCw,
  Box, Layers, Archive
} from "lucide-react";

const CATEGORIES = ["Hardware", "Software", "Licensing", "Services", "Accessories", "Networking", "Security", "Cloud"];

export default function ProductsPage() {
  const { token } = useAuth();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewProduct, setViewProduct] = useState(null);
  const [sortField, setSortField] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [form, setForm] = useState({
    name: "", sku: "", description: "", category: "Hardware", vendor: "",
    cost_price: "", retail_price: "", tax_rate: "0", quantity_in_stock: "0",
    reorder_level: "5", unit: "each", is_active: true, is_taxable: true,
    is_recurring: false, billing_cycle: "monthly"
  });

  const headers = { Authorization: `Bearer ${token}` };

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/products`, { headers });
      setProducts(res.data);
    } catch { toast.error("Failed to load products"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchProducts(); }, []);

  const resetForm = () => setForm({
    name: "", sku: "", description: "", category: "Hardware", vendor: "",
    cost_price: "", retail_price: "", tax_rate: "0", quantity_in_stock: "0",
    reorder_level: "5", unit: "each", is_active: true, is_taxable: true,
    is_recurring: false, billing_cycle: "monthly"
  });

  const openCreate = () => { setEditing(null); resetForm(); setIsFormOpen(true); };
  const openEdit = (p) => {
    setEditing(p);
    setForm({
      name: p.name, sku: p.sku, description: p.description || "", category: p.category,
      vendor: p.vendor || "", cost_price: String(p.cost_price), retail_price: String(p.retail_price),
      tax_rate: String(p.tax_rate || 0), quantity_in_stock: String(p.quantity_in_stock),
      reorder_level: String(p.reorder_level || 5), unit: p.unit || "each",
      is_active: p.is_active !== false, is_taxable: p.is_taxable !== false,
      is_recurring: p.is_recurring || false, billing_cycle: p.billing_cycle || "monthly"
    });
    setIsFormOpen(true);
  };

  const handleSave = async () => {
    if (!form.name) { toast.error("Product name is required"); return; }
    const payload = { ...form, cost_price: parseFloat(form.cost_price) || 0, retail_price: parseFloat(form.retail_price) || 0, tax_rate: parseFloat(form.tax_rate) || 0, quantity_in_stock: parseInt(form.quantity_in_stock) || 0, reorder_level: parseInt(form.reorder_level) || 5 };
    try {
      if (editing) {
        await axios.put(`${API}/products/${editing.id}`, payload, { headers });
        toast.success("Product updated");
      } else {
        await axios.post(`${API}/products`, payload, { headers });
        toast.success("Product created");
      }
      setIsFormOpen(false); fetchProducts();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to save"); }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API}/products/${id}`, { headers });
      toast.success("Product deleted");
      fetchProducts();
      if (viewProduct?.id === id) setViewProduct(null);
    } catch { toast.error("Failed to delete"); }
  };

  const filtered = products
    .filter(p => catFilter === "all" || p.category === catFilter)
    .filter(p => !search || p.name?.toLowerCase().includes(search.toLowerCase()) || p.sku?.toLowerCase().includes(search.toLowerCase()) || p.vendor?.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const av = a[sortField], bv = b[sortField];
      if (typeof av === "number") return sortDir === "asc" ? av - bv : bv - av;
      return sortDir === "asc" ? String(av || "").localeCompare(String(bv || "")) : String(bv || "").localeCompare(String(av || ""));
    });

  const categories = [...new Set(products.map(p => p.category))].sort();
  const totalValue = products.reduce((s, p) => s + (p.retail_price * p.quantity_in_stock), 0);
  const lowStock = products.filter(p => p.quantity_in_stock <= (p.reorder_level || 5) && p.is_active);
  const recurring = products.filter(p => p.is_recurring);

  const toggleSort = (field) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const formDialog = (
    <Dialog open={isFormOpen} onOpenChange={v => { setIsFormOpen(v); if (!v) setEditing(null); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{editing ? "Edit Product" : "Add Product"}</DialogTitle></DialogHeader>
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Product Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Dell OptiPlex 7090" data-testid="product-name" /></div>
            <div><Label>SKU</Label><Input value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} placeholder="e.g. DELL-OPT-7090" data-testid="product-sku" /></div>
          </div>
          <div><Label>Description</Label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Product description..." rows={2} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Category</Label>
              <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Vendor</Label><Input value={form.vendor} onChange={e => setForm({ ...form, vendor: e.target.value })} placeholder="e.g. Dell Technologies" /></div>
          </div>
          <Separator />
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Cost Price ($)</Label><Input type="number" step="0.01" value={form.cost_price} onChange={e => setForm({ ...form, cost_price: e.target.value })} data-testid="product-cost" /></div>
            <div><Label>Retail Price ($)</Label><Input type="number" step="0.01" value={form.retail_price} onChange={e => setForm({ ...form, retail_price: e.target.value })} data-testid="product-price" /></div>
            <div><Label>Tax Rate (%)</Label><Input type="number" step="0.01" value={form.tax_rate} onChange={e => setForm({ ...form, tax_rate: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Quantity in Stock</Label><Input type="number" value={form.quantity_in_stock} onChange={e => setForm({ ...form, quantity_in_stock: e.target.value })} data-testid="product-stock" /></div>
            <div><Label>Reorder Level</Label><Input type="number" value={form.reorder_level} onChange={e => setForm({ ...form, reorder_level: e.target.value })} /></div>
            <div><Label>Unit</Label>
              <Select value={form.unit} onValueChange={v => setForm({ ...form, unit: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="each">Each</SelectItem>
                  <SelectItem value="pack">Pack</SelectItem>
                  <SelectItem value="box">Box</SelectItem>
                  <SelectItem value="license">License</SelectItem>
                  <SelectItem value="hour">Hour</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Separator />
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2"><Switch checked={form.is_active} onCheckedChange={v => setForm({ ...form, is_active: v })} /><Label>Active</Label></div>
            <div className="flex items-center gap-2"><Switch checked={form.is_taxable} onCheckedChange={v => setForm({ ...form, is_taxable: v })} /><Label>Taxable</Label></div>
            <div className="flex items-center gap-2"><Switch checked={form.is_recurring} onCheckedChange={v => setForm({ ...form, is_recurring: v })} /><Label>Recurring</Label></div>
          </div>
          {form.is_recurring && (
            <div className="max-w-xs"><Label>Billing Cycle</Label>
              <Select value={form.billing_cycle} onValueChange={v => setForm({ ...form, billing_cycle: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="annually">Annually</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter><Button onClick={handleSave} data-testid="save-product-btn">{editing ? "Update" : "Create"} Product</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );

  // ========== DETAIL VIEW ==========
  if (viewProduct) {
    const p = viewProduct;
    const margin = p.retail_price - p.cost_price;
    const marginPct = p.cost_price > 0 ? ((margin / p.cost_price) * 100).toFixed(1) : "N/A";
    return (
      <div className="space-y-6" data-testid="product-detail">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setViewProduct(null)} data-testid="back-to-products">
            <Package className="w-4 h-4 mr-1" />Back to Products
          </Button>
        </div>
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-8 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-2xl">{p.name}</CardTitle>
                    <p className="text-sm text-muted-foreground font-mono mt-1">SKU: {p.sku || "N/A"}</p>
                  </div>
                  <div className="flex gap-2">
                    <Badge variant={p.is_active ? "default" : "secondary"}>{p.is_active ? "Active" : "Inactive"}</Badge>
                    {p.is_recurring && <Badge className="bg-purple-600">Recurring</Badge>}
                    <Badge variant="outline">{p.category}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {p.description && <p className="text-sm text-muted-foreground mb-4">{p.description}</p>}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-3 rounded-lg bg-muted/30 border"><p className="text-xs text-muted-foreground mb-1">Cost Price</p><p className="text-lg font-bold">${p.cost_price.toFixed(2)}</p></div>
                  <div className="p-3 rounded-lg bg-muted/30 border"><p className="text-xs text-muted-foreground mb-1">Retail Price</p><p className="text-lg font-bold text-green-500">${p.retail_price.toFixed(2)}</p></div>
                  <div className="p-3 rounded-lg bg-muted/30 border"><p className="text-xs text-muted-foreground mb-1">Margin</p><p className="text-lg font-bold text-cyan-500">${margin.toFixed(2)} ({marginPct}%)</p></div>
                  <div className="p-3 rounded-lg bg-muted/30 border"><p className="text-xs text-muted-foreground mb-1">Tax Rate</p><p className="text-lg font-bold">{p.tax_rate}%</p></div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Inventory</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4">
                  <div className="p-3 rounded-lg bg-muted/30 border">
                    <p className="text-xs text-muted-foreground mb-1">In Stock</p>
                    <p className={`text-2xl font-bold ${p.quantity_in_stock <= p.reorder_level ? 'text-red-500' : 'text-green-500'}`}>{p.quantity_in_stock}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/30 border"><p className="text-xs text-muted-foreground mb-1">Reorder Level</p><p className="text-2xl font-bold text-yellow-500">{p.reorder_level}</p></div>
                  <div className="p-3 rounded-lg bg-muted/30 border"><p className="text-xs text-muted-foreground mb-1">Stock Value</p><p className="text-2xl font-bold">${(p.retail_price * p.quantity_in_stock).toFixed(2)}</p></div>
                </div>
              </CardContent>
            </Card>
          </div>
          <div className="col-span-4 space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Details</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Vendor</span><span className="font-medium">{p.vendor || "N/A"}</span></div>
                <Separator />
                <div className="flex justify-between"><span className="text-muted-foreground">Unit</span><span className="font-medium capitalize">{p.unit}</span></div>
                <Separator />
                <div className="flex justify-between"><span className="text-muted-foreground">Taxable</span><span className="font-medium">{p.is_taxable ? "Yes" : "No"}</span></div>
                {p.is_recurring && <>
                  <Separator />
                  <div className="flex justify-between"><span className="text-muted-foreground">Billing Cycle</span><span className="font-medium capitalize">{p.billing_cycle}</span></div>
                </>}
              </CardContent>
            </Card>
            <div className="flex flex-col gap-2">
              <Button onClick={() => openEdit(p)} className="w-full" data-testid="edit-product-btn"><Edit className="w-4 h-4 mr-1" />Edit Product</Button>
              <Button variant="destructive" onClick={() => { handleDelete(p.id); }} className="w-full" data-testid="delete-product-btn"><Trash2 className="w-4 h-4 mr-1" />Delete</Button>
            </div>
          </div>
        </div>
        {formDialog}
      </div>
    );
  }

  // ========== LIST VIEW ==========
  return (
    <div className="space-y-6" data-testid="products-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Products</h1>
          <p className="text-muted-foreground">{products.length} products in catalog</p>
        </div>
        <Button onClick={openCreate} data-testid="add-product-btn"><Plus className="w-4 h-4 mr-1" />Add Product</Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center"><Package className="w-5 h-5 text-blue-500" /></div><div><p className="text-xs text-muted-foreground">Total Products</p><p className="text-xl font-bold">{products.length}</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center"><DollarSign className="w-5 h-5 text-green-500" /></div><div><p className="text-xs text-muted-foreground">Inventory Value</p><p className="text-xl font-bold">${totalValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center"><RefreshCw className="w-5 h-5 text-purple-500" /></div><div><p className="text-xs text-muted-foreground">Recurring</p><p className="text-xl font-bold">{recurring.length}</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-yellow-500/10 flex items-center justify-center"><AlertTriangle className="w-5 h-5 text-yellow-500" /></div><div><p className="text-xs text-muted-foreground">Low Stock</p><p className="text-xl font-bold text-yellow-500">{lowStock.length}</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center"><Layers className="w-5 h-5 text-cyan-500" /></div><div><p className="text-xs text-muted-foreground">Categories</p><p className="text-xl font-bold">{categories.length}</p></div></div></CardContent></Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search products, SKU, vendor..." value={search} onChange={e => setSearch(e.target.value)} data-testid="product-search" />
        </div>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-[160px]" data-testid="category-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Products Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="cursor-pointer" onClick={() => toggleSort("name")}><div className="flex items-center gap-1">Product <ArrowUpDown className="w-3 h-3" /></div></TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead className="cursor-pointer text-right" onClick={() => toggleSort("cost_price")}><div className="flex items-center gap-1 justify-end">Cost <ArrowUpDown className="w-3 h-3" /></div></TableHead>
                <TableHead className="cursor-pointer text-right" onClick={() => toggleSort("retail_price")}><div className="flex items-center gap-1 justify-end">Price <ArrowUpDown className="w-3 h-3" /></div></TableHead>
                <TableHead className="cursor-pointer text-right" onClick={() => toggleSort("quantity_in_stock")}><div className="flex items-center gap-1 justify-end">Stock <ArrowUpDown className="w-3 h-3" /></div></TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center py-12 text-muted-foreground">{search || catFilter !== "all" ? "No products match your filters" : "No products yet. Add your first product."}</TableCell></TableRow>
              ) : filtered.map(p => (
                <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setViewProduct(p)} data-testid={`product-row-${p.id}`}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center flex-shrink-0">
                        {p.is_recurring ? <RefreshCw className="w-4 h-4 text-purple-500" /> : <Package className="w-4 h-4 text-primary" />}
                      </div>
                      <span className="font-medium">{p.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{p.sku || "-"}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{p.category}</Badge></TableCell>
                  <TableCell className="text-sm">{p.vendor || "-"}</TableCell>
                  <TableCell className="text-right font-mono text-sm">${p.cost_price.toFixed(2)}</TableCell>
                  <TableCell className="text-right font-mono text-sm font-medium">${p.retail_price.toFixed(2)}</TableCell>
                  <TableCell className="text-right">
                    <span className={`font-mono text-sm font-medium ${p.quantity_in_stock <= (p.reorder_level || 5) ? 'text-red-500' : ''}`}>
                      {p.quantity_in_stock}
                    </span>
                    {p.quantity_in_stock <= (p.reorder_level || 5) && <AlertTriangle className="w-3 h-3 text-yellow-500 inline ml-1" />}
                  </TableCell>
                  <TableCell>
                    <Badge variant={p.is_active ? "default" : "secondary"} className="text-[10px]">{p.is_active ? "Active" : "Inactive"}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(p)}><Edit className="w-3 h-3" /></Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => handleDelete(p.id)}><Trash2 className="w-3 h-3" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Low Stock Alert */}
      {lowStock.length > 0 && (
        <Card className="border-yellow-500/30">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2 text-yellow-500"><AlertTriangle className="w-4 h-4" />Low Stock Alert ({lowStock.length} items)</CardTitle></CardHeader>
          <CardContent>
            <div className="flex gap-2 flex-wrap">
              {lowStock.map(p => (
                <div key={p.id} className="px-3 py-2 rounded-lg border border-yellow-500/20 bg-yellow-500/5 cursor-pointer hover:border-yellow-500/40 transition-colors" onClick={() => setViewProduct(p)}>
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">Stock: <span className="text-red-500 font-bold">{p.quantity_in_stock}</span> / Reorder: {p.reorder_level}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {formDialog}
    </div>
  );
}
