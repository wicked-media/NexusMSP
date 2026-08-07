import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { MetricStrip, MetricTile } from "@/components/design-system";
import { toast } from "sonner";
import Barcode from "react-barcode";
import {
  Plus, Search, Loader2, Package, Edit, Trash2, DollarSign, Tag,
  BarChart3, AlertTriangle, ArrowUpDown, RefreshCw, Layers, Archive, Printer, QrCode, ArrowDown, ArrowUp, Copy, ChevronRight, Link2, Truck, Unlink, Calculator, Upload,
  MoreHorizontal, ChevronDown, ClipboardList, Boxes, CircleDollarSign, RotateCcw, ShieldCheck
} from "lucide-react";

const CATEGORIES = ["Hardware", "Software", "Licensing", "Services", "Accessories", "Networking", "Security", "Cloud"];
const STOCK_CONTROLLED_CATEGORIES = ["Hardware", "Accessories", "Networking", "Security"];
const tracksInventory = (product) => product.track_inventory ?? STOCK_CONTROLLED_CATEGORIES.includes(product.category);
const resolveProductImageUrl = (url) => !url || url.startsWith("data:") || /^https?:\/\//.test(url) ? (url || "") : `${API.replace(/\/api$/, "")}${url}`;

export default function ProductsPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewProduct, setViewProduct] = useState(null);
  const [sortField, setSortField] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [detailTab, setDetailTab] = useState("overview");
  const [stockMovements, setStockMovements] = useState([]);
  const [instances, setInstances] = useState([]);
  const [bundleItems, setBundleItems] = useState([]);
  const [onOrderInfo, setOnOrderInfo] = useState(null);
  const [bundleAddProduct, setBundleAddProduct] = useState("");
  const [bundleAddQty, setBundleAddQty] = useState(1);
  const [onOrderSummary, setOnOrderSummary] = useState([]);
  const [stockDialog, setStockDialog] = useState(false);
  const [instanceDialog, setInstanceDialog] = useState(false);
  const [labelDialog, setLabelDialog] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importCsv, setImportCsv] = useState("");
  const [importing, setImporting] = useState(false);
  const [uploadingProductImage, setUploadingProductImage] = useState(false);
  const [stockForm, setStockForm] = useState({ type: "in", quantity: "1", reason: "" });
  const [instanceForm, setInstanceForm] = useState({ count: "1", serial_number: "", location: "Warehouse" });
  const labelRef = useRef();
  const productImageInputRef = useRef();
  const [form, setForm] = useState({
    name: "", sku: "", description: "", category: "Hardware", vendor: "",
    cost_price: "", retail_price: "", tax_rate: "0", quantity_in_stock: "0",
    reorder_level: "5", unit: "each", is_active: true, is_taxable: true,
    is_recurring: false, billing_cycle: "monthly", track_inventory: true, pricing_tiers: [], image_url: ""
  });

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const [productsResult, ordersResult] = await Promise.allSettled([
        axios.get(`${API}/products`, { headers }),
        axios.get(`${API}/products/inventory/on-order-summary`, { headers }),
      ]);
      if (productsResult.status === "rejected") throw productsResult.reason;
      setProducts(productsResult.value.data || []);
      setOnOrderSummary(ordersResult.status === "fulfilled" ? (ordersResult.value.data || []) : []);
    } catch { toast.error("Failed to load the product catalogue"); }
    finally { setLoading(false); }
  }, [headers]);

  const fetchProductDetails = useCallback(async (productId) => {
    try {
      const [movRes, instRes, bundRes, orderRes] = await Promise.allSettled([
        axios.get(`${API}/products/${productId}/stock-movements`, { headers }),
        axios.get(`${API}/products/${productId}/instances`, { headers }),
        axios.get(`${API}/products/${productId}/bundle`, { headers }),
        axios.get(`${API}/products/${productId}/on-order`, { headers }),
      ]);
      setStockMovements(movRes.status === "fulfilled" ? (movRes.value.data || []) : []);
      setInstances(instRes.status === "fulfilled" ? (instRes.value.data || []) : []);
      setBundleItems(bundRes.status === "fulfilled" ? (bundRes.value.data?.bundle_items || []) : []);
      setOnOrderInfo(orderRes.status === "fulfilled" ? orderRes.value.data : null);
    } catch { /* silent */ }
  }, [headers]);

  useEffect(() => { if (token) fetchProducts(); }, [fetchProducts, token]);

  const importProducts = async () => {
    if (!importCsv.trim()) return;
    setImporting(true);
    try {
      const { data } = await axios.post(`${API}/billing-pro/products/bulk-import`, { csv_text: importCsv }, { headers });
      toast.success(`Imported ${data.inserted} new products; updated ${data.updated}.`);
      setImportOpen(false);
      setImportCsv("");
      fetchProducts();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Product import failed");
    } finally { setImporting(false); }
  };

  // The sidebar's Add Product action opens the same canonical catalogue page
  // and immediately presents the product form.
  useEffect(() => {
    if (searchParams.get("new") !== "1") return;
    setEditing(null);
    setForm({
      name: "", sku: "", description: "", category: "Hardware", vendor: "",
      cost_price: "", retail_price: "", tax_rate: "0", quantity_in_stock: "0",
      reorder_level: "5", unit: "each", is_active: true, is_taxable: true,
      is_recurring: false, billing_cycle: "monthly", track_inventory: true, pricing_tiers: [], image_url: ""
    });
    setIsFormOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("new");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (viewProduct) fetchProductDetails(viewProduct.id);
  }, [fetchProductDetails, viewProduct]);

  const resetForm = () => setForm({
    name: "", sku: "", description: "", category: "Hardware", vendor: "",
    cost_price: "", retail_price: "", tax_rate: "0", quantity_in_stock: "0",
    reorder_level: "5", unit: "each", is_active: true, is_taxable: true,
    is_recurring: false, billing_cycle: "monthly", track_inventory: true, pricing_tiers: [], image_url: ""
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
      is_recurring: p.is_recurring || false, billing_cycle: p.billing_cycle || "monthly",
      track_inventory: p.track_inventory ?? ["Hardware", "Accessories", "Networking", "Security"].includes(p.category),
      pricing_tiers: p.pricing_tiers || [], image_url: p.image_url || ""
    });
    setIsFormOpen(true);
  };

  const handleSave = async () => {
    if (!form.name) { toast.error("Product name is required"); return; }
    const payload = { ...form, cost_price: parseFloat(form.cost_price) || 0, retail_price: parseFloat(form.retail_price) || 0, tax_rate: parseFloat(form.tax_rate) || 0, quantity_in_stock: parseInt(form.quantity_in_stock) || 0, reorder_level: parseInt(form.reorder_level) || 5 };
    if (!editing && payload.sku) payload.barcode = payload.sku;
    try {
      let savedId = editing?.id;
      const successMessage = editing ? "Product updated" : "Product created";
      if (editing) {
        await axios.put(`${API}/products/${editing.id}`, payload, { headers });
      } else {
        const r = await axios.post(`${API}/products`, payload, { headers });
        savedId = r.data?.id;
      }
      // Save tier pricing separately to dedicated endpoint
      let tierPricingFailed = false;
      if (savedId && Array.isArray(form.pricing_tiers)) {
        try {
          await axios.put(`${API}/billing-pro/products/${savedId}/pricing-tiers`,
            { tiers: form.pricing_tiers.filter(t => t.min_qty && t.unit_price >= 0) },
            { headers }
          );
        } catch { tierPricingFailed = true; }
      }
      if (editing && viewProduct?.id === editing.id) {
        const updatedProduct = await axios.get(`${API}/products/${editing.id}`, { headers });
        setViewProduct(updatedProduct.data);
        fetchProductDetails(editing.id);
      }
      setIsFormOpen(false); fetchProducts();
      if (tierPricingFailed) toast.error(`${successMessage}, but quantity-break pricing could not be saved. Please reopen the product and try again.`);
      else toast.success(successMessage);
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to save"); }
  };

  const handleProductImageUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Choose an image file"); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error("Product image must be 10 MB or smaller"); return; }
    const upload = new FormData();
    upload.append("file", file);
    setUploadingProductImage(true);
    try {
      const { data } = await axios.post(`${API}/products/upload-image`, upload, { headers });
      setForm(current => ({ ...current, image_url: data.image_url }));
      toast.success("Product image ready to save");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Product image upload failed");
    } finally { setUploadingProductImage(false); }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API}/products/${id}`, { headers });
      toast.success("Product deleted"); fetchProducts();
      if (viewProduct?.id === id) setViewProduct(null);
      setDeleteTarget(null);
    } catch { toast.error("Failed to delete"); }
  };

  const handleStockMovement = async () => {
    if (!viewProduct) return;
    try {
      await axios.post(`${API}/products/${viewProduct.id}/stock-movement`, stockForm, { headers });
      toast.success("Stock updated");
      setStockDialog(false);
      const res = await axios.get(`${API}/products/${viewProduct.id}`, { headers });
      setViewProduct(res.data);
      fetchProductDetails(viewProduct.id);
      fetchProducts();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to update stock"); }
  };

  const handleCreateInstances = async () => {
    if (!viewProduct) return;
    try {
      await axios.post(`${API}/products/${viewProduct.id}/instances`, { ...instanceForm, count: parseInt(instanceForm.count) || 1 }, { headers });
      toast.success("Instances created");
      setInstanceDialog(false);
      fetchProductDetails(viewProduct.id);
      const res = await axios.get(`${API}/products/${viewProduct.id}`, { headers });
      setViewProduct(res.data);
      fetchProducts();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to create instances"); }
  };

  const handleSaveBundle = async (items) => {
    if (!viewProduct) return;
    try {
      await axios.put(`${API}/products/${viewProduct.id}/bundle`, { bundle_items: items }, { headers });
      toast.success("Bundle updated");
      fetchProductDetails(viewProduct.id);
      const updatedProduct = await axios.get(`${API}/products/${viewProduct.id}`, { headers });
      setViewProduct(updatedProduct.data);
      fetchProducts();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to save bundle"); }
  };

  const addToBundle = () => {
    if (!bundleAddProduct || bundleAddProduct === viewProduct?.id) return;
    const existing = bundleItems.find(b => b.product_id === bundleAddProduct);
    if (existing) { toast.error("Product already in bundle"); return; }
    const prod = products.find(p => p.id === bundleAddProduct);
    if (!prod) return;
    const newItems = [...bundleItems, { product_id: prod.id, name: prod.name, sku: prod.sku, category: prod.category, quantity: bundleAddQty, cost_price: prod.cost_price, retail_price: prod.retail_price, quantity_in_stock: prod.quantity_in_stock }];
    setBundleItems(newItems);
    handleSaveBundle(newItems.map(i => ({ product_id: i.product_id, quantity: i.quantity })));
    setBundleAddProduct("");
    setBundleAddQty(1);
  };

  const removeFromBundle = (pid) => {
    const newItems = bundleItems.filter(b => b.product_id !== pid);
    setBundleItems(newItems);
    handleSaveBundle(newItems.map(i => ({ product_id: i.product_id, quantity: i.quantity })));
  };


  const handleGenerateBarcode = async () => {
    if (!viewProduct) return;
    try {
      const res = await axios.post(`${API}/products/${viewProduct.id}/generate-barcode`, { barcode_value: viewProduct.sku || viewProduct.id.substring(0, 12) }, { headers });
      toast.success("Barcode generated");
      setViewProduct({ ...viewProduct, barcode: res.data.barcode, barcode_image: res.data.barcode_image });
      fetchProducts();
    } catch { toast.error("Failed to generate barcode"); }
  };

  const printLabel = (item) => {
    setSelectedLabel(item);
    setLabelDialog(true);
  };

  const handlePrint = () => {
    const printWindow = window.open("", "_blank", "width=400,height=600");
    if (!printWindow) return;
    const barcodeVal = String(selectedLabel?.barcode || selectedLabel?.sku || "N/A").replace(/[<>"'&]/g, "");
    const productName = String(selectedLabel?.product_name || selectedLabel?.name || "").replace(/[<>"'&]/g, "");
    const sku = String(selectedLabel?.sku || "").replace(/[<>"'&]/g, "");
    const category = String(selectedLabel?.category || "").replace(/[<>"'&]/g, "");
    const vendor = String(selectedLabel?.vendor || "").replace(/[<>"'&]/g, "");
    const price = selectedLabel?.retail_price ? `<div class="price">$${Number(selectedLabel.retail_price).toFixed(2)}</div>` : "";
    const doc = printWindow.document;
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><title>Label</title>
      <style>@page{size:4in 6in;margin:0}body{margin:0;padding:12px;font-family:Arial,sans-serif;width:4in}
      .name{font-size:16px;font-weight:bold;margin-bottom:4px}.sku{font-size:11px;color:#555;margin-bottom:12px}
      .bc{text-align:center;margin:16px 0}.price{font-size:20px;font-weight:bold;text-align:center;margin-top:8px}
      .cat{font-size:10px;color:#777;margin-top:4px}</style></head>
      <body><div class="name">${productName}</div>
      <div class="sku">SKU: ${sku}</div>
      <div class="bc"><svg id="bc"></svg></div>
      <div style="text-align:center;font-family:monospace;font-size:11px;letter-spacing:2px">${barcodeVal}</div>
      ${price}
      <div class="cat">${category}${vendor ? " | " + vendor : ""}</div>
      <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"></script>
      <script>JsBarcode("#bc","${barcodeVal}",{format:"CODE128",width:2,height:80,displayValue:false});window.print();window.close();</script>
      </body></html>`);
    doc.close();
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
  const totalValue = products.filter(tracksInventory).reduce((s, p) => s + (p.retail_price * p.quantity_in_stock), 0);
  const lowStock = products.filter(p => tracksInventory(p) && p.quantity_in_stock <= (p.reorder_level || 5) && p.is_active);
  const recurring = products.filter(p => p.is_recurring);

  const toggleSort = (field) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const formDialog = (
    <Dialog open={isFormOpen} onOpenChange={v => { setIsFormOpen(v); if (!v) setEditing(null); }}>
      <DialogContent className="flex h-[min(90vh,860px)] max-h-[calc(100vh-2rem)] max-w-6xl flex-col gap-0 overflow-hidden border-cyan-400/20 bg-background p-0 shadow-2xl shadow-cyan-950/30">
        <DialogHeader className="shrink-0 border-b border-cyan-400/15 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.16),transparent_42%),linear-gradient(135deg,rgba(16,185,129,0.08),transparent)] px-6 py-5 pr-14">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Catalogue control</p>
          <DialogTitle className="mt-1 flex items-center gap-3 text-xl text-foreground"><span className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-400/10"><Package className="h-5 w-5 text-cyan-200" /></span>{editing ? "Edit product record" : "Create product record"}</DialogTitle>
          <DialogDescription className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">{editing ? "Update the catalogue, stock and billing details in one controlled record. Changes remain visible wherever this product is quoted, ordered or invoiced." : "Define the item once for purchasing, stock control, service delivery and billing. Set the commercial model before it is used on a purchase order or invoice."}</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 gap-0 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-5 px-6 py-5">
          <section className="rounded-2xl border border-border/65 bg-card/45 p-4">
            <div className="mb-4 flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-400/[0.08]"><Tag className="h-4 w-4 text-cyan-200" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300">01 · Identity</p><p className="mt-1 text-sm font-semibold">Catalogue identity</p><p className="mt-1 text-xs text-muted-foreground">The shared name and SKU technicians will select throughout NexusMSP.</p></div></div>
          <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Product Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Dell OptiPlex 7090" data-testid="product-name" /></div>
            <div><Label>SKU</Label><Input value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} placeholder="e.g. DELL-OPT-7090" data-testid="product-sku" /></div>
          </div>
          <div><Label>Description</Label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Product description..." rows={2} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Category</Label>
              <Select value={form.category} onValueChange={v => setForm({ ...form, category: v, track_inventory: STOCK_CONTROLLED_CATEGORIES.includes(v) })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Vendor</Label><Input value={form.vendor} onChange={e => setForm({ ...form, vendor: e.target.value })} placeholder="e.g. Dell Technologies" /></div>
          </div>
          </div>
          </section>
          <section className="rounded-2xl border border-border/65 bg-card/45 p-4">
            <div className="mb-4 flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-400/[0.08]"><CircleDollarSign className="h-4 w-4 text-emerald-200" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300">02 · Commercial model</p><p className="mt-1 text-sm font-semibold">Pricing and tax</p><p className="mt-1 text-xs text-muted-foreground">Used as defaults on invoices, purchase orders and contract services.</p></div></div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Cost Price ($)</Label><Input type="number" step="0.01" value={form.cost_price} onChange={e => setForm({ ...form, cost_price: e.target.value })} data-testid="product-cost" /></div>
            <div className="flex items-end gap-2">
              <div className="flex-1"><Label>Retail Price ($)</Label><Input type="number" step="0.01" value={form.retail_price} onChange={e => setForm({ ...form, retail_price: e.target.value })} data-testid="product-price" /></div>
              <Button
                type="button" size="sm" variant="outline" className="mb-0.5"
                onClick={async () => {
                  const cost = parseFloat(form.cost_price) || 0;
                  if (cost <= 0) { toast.error("Set cost price first"); return; }
                  try {
                    const r = await axios.post(`${API}/billing-pro/products/suggest-retail`, { cost_price: cost, target_margin_pct: 35 }, { headers });
                    setForm(p => ({ ...p, retail_price: String(r.data.suggested_retail) }));
                    toast.success(`Retail set for ~35% margin (markup ${r.data.markup_pct}%)`);
                  } catch { toast.error("Suggest failed"); }
                }}
                data-testid="suggest-retail-btn"
                title="Auto-set retail for 35% margin"
              >
                <Calculator className="w-3.5 h-3.5" />
              </Button>
            </div>
            <div><Label>Tax Rate (%)</Label><Input type="number" step="0.01" value={form.tax_rate} onChange={e => setForm({ ...form, tax_rate: e.target.value })} /></div>
          </div>
          <div className="mt-4 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.045] px-3 py-2.5 text-xs text-muted-foreground"><ShieldCheck className="mr-1.5 inline h-3.5 w-3.5 text-emerald-300" />The saved price remains auditable. Existing purchase-order and invoice lines retain their historical price.</div>
          </section>
          <section className="rounded-2xl border border-border/65 bg-card/45 p-4">
            <div className="mb-4 flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-400/20 bg-amber-400/[0.08]"><Boxes className="h-4 w-4 text-amber-200" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300">03 · Fulfilment and pricing</p><p className="mt-1 text-sm font-semibold">Stock, recurring service and volume tiers</p><p className="mt-1 text-xs text-muted-foreground">Make the operational model clear before this product is selected in a technician workflow.</p></div></div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Quantity in Stock</Label><Input type="number" value={form.quantity_in_stock} onChange={e => setForm({ ...form, quantity_in_stock: e.target.value })} data-testid="product-stock" /></div>
            <div><Label>Reorder Level</Label><Input type="number" value={form.reorder_level} onChange={e => setForm({ ...form, reorder_level: e.target.value })} /></div>
            <div><Label>Unit</Label>
              <Select value={form.unit} onValueChange={v => setForm({ ...form, unit: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="each">Each</SelectItem><SelectItem value="pack">Pack</SelectItem>
                  <SelectItem value="box">Box</SelectItem><SelectItem value="license">License</SelectItem>
                  <SelectItem value="hour">Hour</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Quantity-Break Pricing (Tiers)</Label>
              <Button type="button" size="sm" variant="ghost"
                onClick={() => setForm(p => ({ ...p, pricing_tiers: [...(p.pricing_tiers || []), { min_qty: 1, unit_price: parseFloat(p.retail_price) || 0 }] }))}
                data-testid="add-tier-btn"
              ><Plus className="w-3.5 h-3.5 mr-1" />Add Tier</Button>
            </div>
            {(form.pricing_tiers || []).length === 0 ? (
              <p className="text-[11px] text-muted-foreground">No tiers — flat price applies. Add tiers like: 1+=$100, 10+=$90, 50+=$80.</p>
            ) : (form.pricing_tiers || []).map((t, i) => (
              <div key={i} className="flex items-center gap-2" data-testid={`tier-${i}`}>
                <Label className="text-xs w-12">Min Qty</Label>
                <Input type="number" className="w-24" value={t.min_qty} onChange={e => setForm(p => { const t2 = [...p.pricing_tiers]; t2[i] = { ...t2[i], min_qty: parseInt(e.target.value) || 1 }; return { ...p, pricing_tiers: t2 }; })} />
                <Label className="text-xs">Unit Price $</Label>
                <Input type="number" step="0.01" className="w-32" value={t.unit_price} onChange={e => setForm(p => { const t2 = [...p.pricing_tiers]; t2[i] = { ...t2[i], unit_price: parseFloat(e.target.value) || 0 }; return { ...p, pricing_tiers: t2 }; })} />
                <Button type="button" size="sm" variant="ghost" onClick={() => setForm(p => ({ ...p, pricing_tiers: p.pricing_tiers.filter((_, ii) => ii !== i) }))}><Trash2 className="w-3.5 h-3.5 text-rose-400" /></Button>
              </div>
            ))}
          </div>
          <Separator />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border/65 bg-background/35 p-3"><span><span className="block text-sm font-medium">Track inventory</span><span className="mt-0.5 block text-xs text-muted-foreground">Include in receipts, stock movements and low-stock review.</span></span><Switch checked={form.track_inventory} onCheckedChange={v => setForm({ ...form, track_inventory: v })} /></label>
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border/65 bg-background/35 p-3"><span><span className="block text-sm font-medium">Recurring billing</span><span className="mt-0.5 block text-xs text-muted-foreground">Offer as a repeatable service or subscription line.</span></span><Switch checked={form.is_recurring} onCheckedChange={v => setForm({ ...form, is_recurring: v })} /></label>
          </div>
          {form.is_recurring && (
            <div className="max-w-xs"><Label>Billing Cycle</Label>
              <Select value={form.billing_cycle} onValueChange={v => setForm({ ...form, billing_cycle: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem><SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="annually">Annually</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          </section>
        </div>
        <aside className="border-t border-border/60 bg-muted/[0.14] px-5 py-5 lg:border-l lg:border-t-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Record status</p>
          <div className="mt-3 rounded-xl border border-border/65 bg-background/35 p-3">
            <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium">Product image</p><p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">Add a vendor logo or product photo for clear catalogue recognition.</p></div><Package className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" /></div>
            <div className="mt-3 flex items-center gap-3">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-cyan-400/20 bg-cyan-400/[0.06]">
                {form.image_url ? <img src={resolveProductImageUrl(form.image_url)} alt="Product preview" className="h-full w-full object-cover" onError={event => { event.currentTarget.style.display = "none"; }} /> : <Package className="h-6 w-6 text-cyan-200/70" />}
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <input ref={productImageInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={handleProductImageUpload} data-testid="product-image-input" />
                <Button type="button" size="sm" variant="outline" className="w-full" onClick={() => productImageInputRef.current?.click()} disabled={uploadingProductImage} data-testid="upload-product-image">
                  {uploadingProductImage ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}{uploadingProductImage ? "Uploading…" : form.image_url ? "Replace image" : "Upload image"}
                </Button>
                {form.image_url && <Button type="button" size="sm" variant="ghost" className="w-full text-muted-foreground hover:text-destructive" onClick={() => setForm(current => ({ ...current, image_url: "" }))} data-testid="remove-product-image"><Trash2 className="mr-1.5 h-3.5 w-3.5" />Remove image</Button>}
              </div>
            </div>
          </div>
          <div className="mt-3 space-y-3">
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border/65 bg-background/35 p-3"><span><span className="block text-sm font-medium">Active</span><span className="mt-0.5 block text-xs text-muted-foreground">Available for technician selection.</span></span><Switch checked={form.is_active} onCheckedChange={v => setForm({ ...form, is_active: v })} /></label>
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border/65 bg-background/35 p-3"><span><span className="block text-sm font-medium">Taxable</span><span className="mt-0.5 block text-xs text-muted-foreground">Use the configured tax rate by default.</span></span><Switch checked={form.is_taxable} onCheckedChange={v => setForm({ ...form, is_taxable: v })} /></label>
          </div>
          <Separator className="my-5" />
          <div className="rounded-xl border border-cyan-400/15 bg-cyan-400/[0.045] p-3"><p className="text-xs font-semibold text-cyan-100">Save review</p><ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground"><li>{form.name.trim() ? "Product name ready" : "Product name is required"}</li><li>{form.track_inventory ? "Stock control enabled" : "Not stock controlled"}</li><li>{form.is_recurring ? `${form.billing_cycle} recurring option` : "One-off billing by default"}</li><li>{(form.pricing_tiers || []).length ? `${form.pricing_tiers.length} volume tier${form.pricing_tiers.length === 1 ? "" : "s"} configured` : "Standard price only"}</li></ul></div>
          <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground"><RotateCcw className="mr-1 inline h-3.5 w-3.5" />A saved record creates the shared source of truth; each later use retains its own commercial and audit history.</p>
        </aside>
        </div>
        <DialogFooter className="shrink-0 flex-row items-center justify-between border-t border-border/60 bg-background/80 px-6 py-4 sm:justify-between"><p className="hidden text-xs text-muted-foreground md:block">Required: product name. No stock movement is created until the product is receipted or adjusted.</p><div className="ml-auto flex gap-2"><Button variant="outline" onClick={() => { setIsFormOpen(false); setEditing(null); }}>Cancel</Button><Button onClick={handleSave} disabled={!form.name.trim()} data-testid="save-product-btn"><Package className="mr-1.5 h-4 w-4" />{editing ? "Save changes" : "Create product"}</Button></div></DialogFooter>
      </DialogContent>
    </Dialog>
  );

  // ========== LABEL PRINT DIALOG ==========
  const labelPrintDialog = (
    <Dialog open={labelDialog} onOpenChange={setLabelDialog}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Print Label</DialogTitle></DialogHeader>
        {selectedLabel && (
          <div ref={labelRef} className="p-6 bg-white text-black rounded-lg border-2 border-dashed">
            <p className="text-base font-bold">{selectedLabel.product_name || selectedLabel.name}</p>
            <p className="text-xs text-gray-500 mb-3">SKU: {selectedLabel.sku || "N/A"}</p>
            <div className="flex justify-center my-4">
              <Barcode value={selectedLabel.barcode || selectedLabel.sku || "N/A"} format="CODE128" width={2} height={70} displayValue={false} />
            </div>
            <p className="text-center font-mono text-xs tracking-widest">{selectedLabel.barcode || selectedLabel.sku || "N/A"}</p>
            {selectedLabel.retail_price > 0 && <p className="text-center text-xl font-bold mt-2">${Number(selectedLabel.retail_price).toFixed(2)}</p>}
            <p className="text-center text-[10px] text-gray-400 mt-1">{selectedLabel.category || ""} {selectedLabel.vendor ? `| ${selectedLabel.vendor}` : ""}</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setLabelDialog(false)}>Cancel</Button>
          <Button onClick={handlePrint} data-testid="print-label-btn"><Printer className="w-4 h-4 mr-1" />Print Label</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  // ========== DETAIL VIEW ==========
  if (viewProduct) {
    const p = viewProduct;
    const isStockTracked = tracksInventory(p);
    const margin = p.retail_price - p.cost_price;
    const marginPct = p.cost_price > 0 ? ((margin / p.cost_price) * 100).toFixed(1) : "N/A";
    const stockMovementQuantity = Math.max(0, Number(stockForm.quantity) || 0);
    const projectedStock = stockForm.type === "in" ? p.quantity_in_stock + stockMovementQuantity : stockForm.type === "out" ? Math.max(0, p.quantity_in_stock - stockMovementQuantity) : stockMovementQuantity;
    const instanceCount = Math.max(1, Math.min(100, parseInt(instanceForm.count, 10) || 1));
    return (
      <div className="space-y-6" data-testid="product-detail">
        <section className="overflow-hidden rounded-2xl border border-cyan-400/20 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.15),transparent_38%),linear-gradient(135deg,rgba(16,185,129,0.08),transparent)] shadow-xl shadow-cyan-950/15">
          <div className="flex items-center gap-2 border-b border-cyan-400/15 px-4 py-3">
            <Button variant="ghost" size="sm" onClick={() => { setViewProduct(null); setDetailTab("overview"); }} data-testid="back-to-products">
              <Package className="mr-1 h-4 w-4" />Products
            </Button>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
            <span className="truncate text-sm font-medium text-muted-foreground">Product record</span>
          </div>
          <div className="flex flex-col gap-5 px-6 py-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-cyan-400/25 bg-cyan-400/[0.09] shadow-inner shadow-cyan-300/10">
                {p.image_url ? <img src={resolveProductImageUrl(p.image_url)} alt="" className="h-full w-full object-cover" onError={event => { event.currentTarget.style.display = "none"; }} /> : <Package className="h-7 w-7 text-cyan-200" />}
              </div>
              <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Catalogue record</p><h1 className="mt-1 truncate text-2xl font-semibold tracking-tight">{p.name}</h1><p className="mt-1 font-mono text-xs text-muted-foreground">SKU: {p.sku || "Not set"}</p></div>
            </div>
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <Badge variant={p.is_active ? "default" : "secondary"} className="h-7 px-2.5">{p.is_active ? "Active" : "Inactive"}</Badge>
              {p.is_recurring && <Badge className="h-7 bg-violet-600 px-2.5">Recurring</Badge>}
              <Badge variant="outline" className="h-7 px-2.5">{p.category}</Badge>
              <Button onClick={() => openEdit(p)} data-testid="edit-product-header"><Edit className="mr-1.5 h-4 w-4" />Edit product</Button>
            </div>
          </div>
        </section>

        <MetricStrip columns={4}>
          <MetricTile label="Retail Price" value={`$${Number(p.retail_price || 0).toFixed(2)}`} accent="emerald" icon={<DollarSign className="h-3.5 w-3.5" />} />
          <MetricTile label={isStockTracked ? "In Stock" : "Stock Control"} value={isStockTracked ? p.quantity_in_stock : "Off"} accent={isStockTracked && p.quantity_in_stock <= p.reorder_level ? "amber" : "cyan"} icon={<Boxes className="h-3.5 w-3.5" />} />
          <MetricTile label="Margin" value={p.cost_price > 0 ? `${marginPct}%` : "—"} accent="violet" icon={<BarChart3 className="h-3.5 w-3.5" />} />
          <MetricTile label="Product Type" value={p.is_recurring ? "Recurring" : "One-off"} accent="sky" icon={p.is_recurring ? <RefreshCw className="h-3.5 w-3.5" /> : <Package className="h-3.5 w-3.5" />} />
        </MetricStrip>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Product workspace</p><p className="mt-1 text-sm text-muted-foreground">Review pricing, inventory, bundle contents and traceable stock history.</p></div>
        </div>

        <Tabs value={detailTab} onValueChange={setDetailTab}>
          <TabsList>
            <TabsTrigger value="overview" data-testid="tab-product-overview">Overview</TabsTrigger>
            <TabsTrigger value="inventory" data-testid="tab-product-inventory">Inventory</TabsTrigger>
            <TabsTrigger value="bundles" data-testid="tab-product-bundles">Bundle ({bundleItems.length})</TabsTrigger>
            <TabsTrigger value="barcodes" data-testid="tab-product-barcodes">Barcodes & Labels</TabsTrigger>
            <TabsTrigger value="history" data-testid="tab-product-history">Stock History ({stockMovements.length})</TabsTrigger>
          </TabsList>

          {/* OVERVIEW TAB */}
          <TabsContent value="overview">
            <div className="grid grid-cols-12 gap-6 mt-4">
              <div className="col-span-8 space-y-4">
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Pricing</CardTitle></CardHeader>
                  <CardContent>
                    {p.description && <p className="text-sm text-muted-foreground mb-4">{p.description}</p>}
                    <div className="grid grid-cols-4 gap-4">
                      <div className="p-3 rounded-lg bg-muted/30 border"><p className="text-xs text-muted-foreground mb-1">Cost Price</p><p className="text-lg font-bold">${p.cost_price.toFixed(2)}</p></div>
                      <div className="p-3 rounded-lg bg-muted/30 border"><p className="text-xs text-muted-foreground mb-1">Retail Price</p><p className="text-lg font-bold text-green-500">${p.retail_price.toFixed(2)}</p></div>
                      <div className="p-3 rounded-lg bg-muted/30 border"><p className="text-xs text-muted-foreground mb-1">Margin</p><p className="text-lg font-bold text-cyan-500">${margin.toFixed(2)} ({marginPct}%)</p></div>
                      <div className="p-3 rounded-lg bg-muted/30 border"><p className="text-xs text-muted-foreground mb-1">Tax Rate</p><p className="text-lg font-bold">{p.tax_rate}%</p></div>
                    </div>
                    {p.pricing_tiers?.length > 0 && (
                      <div className="mt-4 rounded-lg border border-violet-500/20 bg-violet-500/[0.04] p-3" data-testid="product-tier-pricing-summary">
                        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-violet-300">
                          <Layers className="h-3.5 w-3.5" /> Quantity-break pricing
                        </div>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {[...p.pricing_tiers].sort((a, b) => a.min_qty - b.min_qty).map(tier => (
                            <div key={`${tier.min_qty}-${tier.unit_price}`} className="rounded-md border border-violet-500/15 bg-background/30 px-3 py-2">
                              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{tier.min_qty}+ units</p>
                              <p className="font-mono text-sm font-semibold">${Number(tier.unit_price).toFixed(2)} <span className="text-xs font-normal text-muted-foreground">each</span></p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Inventory</CardTitle></CardHeader>
                  <CardContent>
                    {isStockTracked ? <div className="grid grid-cols-3 gap-4">
                      <div className="p-3 rounded-lg bg-muted/30 border">
                        <p className="text-xs text-muted-foreground mb-1">In Stock</p>
                        <p className={`text-2xl font-bold ${p.quantity_in_stock <= p.reorder_level ? 'text-red-500' : 'text-green-500'}`}>{p.quantity_in_stock}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-muted/30 border"><p className="text-xs text-muted-foreground mb-1">Reorder Level</p><p className="text-2xl font-bold text-yellow-500">{p.reorder_level}</p></div>
                      <div className="p-3 rounded-lg bg-muted/30 border"><p className="text-xs text-muted-foreground mb-1">Stock Value</p><p className="text-2xl font-bold">${(p.retail_price * p.quantity_in_stock).toFixed(2)}</p></div>
                    </div> : <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-5 text-sm text-muted-foreground"><span className="font-medium text-foreground">Stock not tracked.</span> This product remains billable but is not included in on-hand quantity, stock value or reorder alerts.</div>}
                    {/* On Order Indicator */}
                    {isStockTracked && onOrderInfo && onOrderInfo.on_order_qty > 0 && (
                      <div className="mt-3 p-3 rounded-lg border border-cyan-500/30 bg-cyan-500/5">
                        <div className="flex items-center gap-2 mb-2">
                          <Truck className="w-4 h-4 text-cyan-400 animate-pulse" />
                          <span className="text-sm font-semibold text-cyan-400">On Order: {onOrderInfo.on_order_qty} units</span>
                        </div>
                        <div className="space-y-1">
                          {onOrderInfo.purchase_orders?.map((po, i) => (
                            <div key={`k-${i}`} className="flex items-center justify-between text-xs">
                              <span className="font-mono text-cyan-300">{po.po_number}</span>
                              <span className="text-muted-foreground">{po.vendor}</span>
                              <span className="font-medium">{po.quantity} units</span>
                              {po.expected_delivery && <span className="text-muted-foreground">{po.expected_delivery}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
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
                    <div className="flex justify-between"><span className="text-muted-foreground">Stock Control</span><span className="font-medium">{isStockTracked ? "Tracked" : "Not tracked"}</span></div>
                    <Separator />
                    <div className="flex justify-between"><span className="text-muted-foreground">Taxable</span><span className="font-medium">{p.is_taxable ? "Yes" : "No"}</span></div>
                    {p.is_recurring && <>
                      <Separator />
                      <div className="flex justify-between"><span className="text-muted-foreground">Billing Cycle</span><span className="font-medium capitalize">{p.billing_cycle}</span></div>
                    </>}
                    <Separator />
                    <div className="flex justify-between"><span className="text-muted-foreground">Instances</span><span className="font-medium">{instances.length}</span></div>
                  </CardContent>
                </Card>
                {/* Barcode Preview */}
                {p.barcode && (
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">Barcode</CardTitle></CardHeader>
                    <CardContent className="flex flex-col items-center">
                      <Barcode value={p.barcode} format="CODE128" width={1.5} height={50} displayValue={false} />
                      <p className="font-mono text-xs mt-1 tracking-wider">{p.barcode}</p>
                      <Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => printLabel(p)} data-testid="print-product-label">
                        <Printer className="w-3 h-3 mr-1" />Print Label
                      </Button>
                    </CardContent>
                  </Card>
                )}
                <div className="flex flex-col gap-2">
                  {isStockTracked && <Button variant="outline" onClick={() => { setStockDialog(true); setStockForm({ type: "in", quantity: "1", reason: "" }); }} className="w-full" data-testid="stock-movement-btn"><ArrowUpDown className="w-4 h-4 mr-1" />Stock Movement</Button>}
                  {!p.barcode && <Button variant="outline" onClick={handleGenerateBarcode} className="w-full" data-testid="generate-barcode-btn"><QrCode className="w-4 h-4 mr-1" />Generate Barcode</Button>}
                  <Button variant="destructive" onClick={() => setDeleteTarget(p)} className="w-full" data-testid="delete-product-btn"><Trash2 className="w-4 h-4 mr-1" />Delete</Button>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* INVENTORY TAB */}
          <TabsContent value="inventory">
            {isStockTracked ? <div className="mt-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Product Instances ({instances.length})</h3>
                <Button size="sm" onClick={() => { setInstanceDialog(true); setInstanceForm({ count: "1", serial_number: "", location: "Warehouse" }); }} data-testid="add-instance-btn"><Plus className="w-4 h-4 mr-1" />Add Instances</Button>
              </div>
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Serial / Barcode</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Location</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {instances.length === 0 ? (
                        <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No instances yet. Create individual tracked items.</TableCell></TableRow>
                      ) : instances.map(inst => (
                        <TableRow key={inst.id} data-testid={`instance-${inst.id}`}>
                          <TableCell>
                            <div>
                              <p className="font-mono text-xs font-medium">{inst.barcode}</p>
                              <p className="text-xs text-muted-foreground">SN: {inst.serial_number}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={inst.status === "in_stock" ? "default" : inst.status === "deployed" ? "secondary" : "outline"} className="text-xs">
                              {inst.status.replace("_", " ")}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">{inst.location}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{new Date(inst.created_at).toLocaleDateString()}</TableCell>
                          <TableCell>
                            <Button variant="ghost" size="sm" className="h-7" onClick={() => printLabel({ ...inst, product_name: p.name, retail_price: p.retail_price, category: p.category, vendor: p.vendor, sku: p.sku })}>
                              <Printer className="w-3 h-3" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div> : <div className="mt-4 rounded-lg border border-dashed bg-muted/20 px-5 py-10 text-center text-sm text-muted-foreground"><Package className="mx-auto mb-3 h-8 w-8 opacity-35" /><p className="font-medium text-foreground">Instance tracking is off</p><p className="mt-1">Enable <strong>Track Stock</strong> in Edit Product before recording serialised instances.</p></div>}
          </TabsContent>

          {/* BUNDLES TAB */}
          <TabsContent value="bundles">
            <div className="mt-4 space-y-4">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2"><Link2 className="w-4 h-4" />Bundled Products</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground mb-4">Link related products together (e.g. monitor + keyboard + mouse) to offer as a package deal.</p>
                  {/* Add to bundle */}
                  <div className="flex items-center gap-2 mb-4 p-3 rounded-lg border bg-muted/20">
                    <Select value={bundleAddProduct || "__none"} onValueChange={v => setBundleAddProduct(v === "__none" ? "" : v)}>
                      <SelectTrigger className="flex-1"><SelectValue placeholder="Select product to add" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">Choose product...</SelectItem>
                        {products.filter(pr => pr.id !== p.id && !bundleItems.find(b => b.product_id === pr.id)).map(pr => (
                          <SelectItem key={pr.id} value={pr.id}>{pr.name} (${pr.retail_price.toFixed(2)})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input type="number" min="1" className="w-20" value={bundleAddQty} onChange={e => setBundleAddQty(parseInt(e.target.value) || 1)} placeholder="Qty" />
                    <Button size="sm" onClick={addToBundle} disabled={!bundleAddProduct} data-testid="add-to-bundle-btn"><Plus className="w-4 h-4 mr-1" />Add</Button>
                  </div>
                  {bundleItems.length === 0 ? (
                    <div className="text-center py-8 border rounded-lg border-dashed">
                      <Link2 className="w-10 h-10 mx-auto text-muted-foreground mb-2 opacity-30" />
                      <p className="text-muted-foreground text-sm">No bundled products yet</p>
                      <p className="text-xs text-muted-foreground mt-1">Add monitors, RAM, cables, etc. to create a product bundle</p>
                    </div>
                  ) : (
                    <>
                      <Table>
                        <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>SKU</TableHead><TableHead>Category</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Price</TableHead><TableHead className="text-right">Stock</TableHead><TableHead></TableHead></TableRow></TableHeader>
                        <TableBody>
                          {bundleItems.map(bi => (
                            <TableRow key={bi.product_id}>
                              <TableCell className="font-medium">{bi.name}</TableCell>
                              <TableCell className="font-mono text-xs">{bi.sku || "-"}</TableCell>
                              <TableCell><Badge variant="outline" className="text-xs">{bi.category}</Badge></TableCell>
                              <TableCell className="text-right font-mono">{bi.quantity}</TableCell>
                              <TableCell className="text-right font-mono">${bi.retail_price?.toFixed(2)}</TableCell>
                              <TableCell className="text-right">
                                <span className={bi.quantity_in_stock <= 0 ? "text-red-400" : ""}>{bi.quantity_in_stock}</span>
                              </TableCell>
                              <TableCell><Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => removeFromBundle(bi.product_id)}><Unlink className="w-3 h-3" /></Button></TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      <Separator className="my-3" />
                      <div className="flex justify-end gap-6 text-sm">
                        <div><span className="text-muted-foreground">Bundle Cost: </span><span className="font-mono font-bold">${bundleItems.reduce((s, b) => s + (b.cost_price || 0) * b.quantity, 0).toFixed(2)}</span></div>
                        <div><span className="text-muted-foreground">Bundle Retail: </span><span className="font-mono font-bold text-green-400">${bundleItems.reduce((s, b) => s + (b.retail_price || 0) * b.quantity, 0).toFixed(2)}</span></div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* BARCODES & LABELS TAB */}
          <TabsContent value="barcodes">
            <div className="mt-4 space-y-4">
              <Card>
                <CardHeader><CardTitle className="text-sm">Product Barcode</CardTitle></CardHeader>
                <CardContent>
                  {p.barcode ? (
                    <div className="flex flex-col items-center gap-4">
                      <div className="p-6 bg-white rounded-lg border">
                        <Barcode value={p.barcode} format="CODE128" width={2} height={80} displayValue={true} fontSize={14} />
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" onClick={() => printLabel(p)} data-testid="print-main-label"><Printer className="w-4 h-4 mr-1" />Print Label</Button>
                        <Button variant="outline" onClick={() => { navigator.clipboard.writeText(p.barcode); toast.success("Barcode copied"); }}><Copy className="w-4 h-4 mr-1" />Copy Value</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <QrCode className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                      <p className="text-muted-foreground mb-3">No barcode generated yet</p>
                      <Button onClick={handleGenerateBarcode}><QrCode className="w-4 h-4 mr-1" />Generate Barcode</Button>
                    </div>
                  )}
                </CardContent>
              </Card>
              {instances.length > 0 && (
                <Card>
                  <CardHeader><CardTitle className="text-sm">Instance Barcodes ({instances.length})</CardTitle></CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {instances.slice(0, 12).map(inst => (
                        <div key={inst.id} className="p-3 bg-white rounded-lg border text-center cursor-pointer hover:border-primary/50 transition-colors" onClick={() => printLabel({ ...inst, product_name: p.name, retail_price: p.retail_price, category: p.category, vendor: p.vendor, sku: p.sku })}>
                          <Barcode value={inst.barcode} format="CODE128" width={1.2} height={40} displayValue={false} />
                          <p className="font-mono text-[10px] mt-1">{inst.barcode}</p>
                          <p className="text-[10px] text-muted-foreground">SN: {inst.serial_number}</p>
                        </div>
                      ))}
                    </div>
                    {instances.length > 12 && <p className="text-center text-xs text-muted-foreground mt-3">+ {instances.length - 12} more instances</p>}
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* STOCK HISTORY TAB */}
          <TabsContent value="history">
            <div className="mt-4">
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Type</TableHead>
                        <TableHead>Quantity</TableHead>
                        <TableHead>Stock Change</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>By</TableHead>
                        <TableHead>Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stockMovements.length === 0 ? (
                        <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No stock movements recorded</TableCell></TableRow>
                      ) : stockMovements.map(m => (
                        <TableRow key={m.id}>
                          <TableCell>
                            <Badge variant={m.type === "in" ? "default" : m.type === "out" ? "destructive" : "outline"} className={`text-xs ${m.type === "in" ? "bg-green-600" : ""}`}>
                              {m.type === "in" ? <ArrowDown className="w-3 h-3 mr-1" /> : m.type === "out" ? <ArrowUp className="w-3 h-3 mr-1" /> : null}
                              {m.type.toUpperCase()}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono font-medium">{m.type === "in" ? "+" : m.type === "out" ? "-" : ""}{m.quantity}</TableCell>
                          <TableCell className="font-mono text-xs">{m.previous_stock} &rarr; {m.new_stock}</TableCell>
                          <TableCell className="text-sm max-w-[200px] truncate">{m.reason || "-"}</TableCell>
                          <TableCell className="text-sm">{m.created_by_name || "-"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{new Date(m.created_at).toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        {formDialog}
        {labelPrintDialog}

        {/* Stock Movement Dialog */}
        <Dialog open={stockDialog} onOpenChange={setStockDialog}>
          <DialogContent className="max-w-2xl overflow-hidden border-cyan-400/20 bg-background p-0 shadow-2xl shadow-cyan-950/30">
            <DialogHeader className="border-b border-cyan-400/15 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.16),transparent_42%),linear-gradient(135deg,rgba(16,185,129,0.08),transparent)] px-6 py-5 pr-14">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Inventory control</p>
              <DialogTitle className="mt-1 flex items-center gap-3 text-xl"><span className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-400/10"><ArrowUpDown className="h-5 w-5 text-cyan-200" /></span>Record stock movement</DialogTitle>
              <DialogDescription className="mt-2 text-sm leading-relaxed">Apply a receipting, issue or correction event to <span className="font-medium text-foreground">{p.name}</span>. NexusMSP records the before-and-after quantity in the product audit history.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_15rem]">
              <div className="space-y-5 px-6 py-5">
                <section className="rounded-2xl border border-border/65 bg-card/45 p-4">
                  <div className="mb-4 flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-400/[0.08]"><Archive className="h-4 w-4 text-emerald-200" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300">Movement details</p><p className="mt-1 text-sm font-semibold">Quantity and intent</p><p className="mt-1 text-xs text-muted-foreground">Use an adjustment only when setting the physical on-hand count.</p></div></div>
                  <div className="grid gap-4 sm:grid-cols-2"><div><Label>Movement type</Label><Select value={stockForm.type} onValueChange={v => setStockForm({ ...stockForm, type: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="in">Receive stock</SelectItem><SelectItem value="out">Issue stock</SelectItem><SelectItem value="adjustment">Set stock count</SelectItem></SelectContent></Select></div><div><Label>{stockForm.type === "adjustment" ? "New on-hand count" : "Quantity"}</Label><Input type="number" value={stockForm.quantity} onChange={e => setStockForm({ ...stockForm, quantity: e.target.value })} min="0" /></div></div>
                  <div className="mt-4"><Label>Reason and reference</Label><Textarea value={stockForm.reason} onChange={e => setStockForm({ ...stockForm, reason: e.target.value })} placeholder="e.g. Received against PO-1042, issued to ticket #4421…" rows={3} /></div>
                </section>
              </div>
              <aside className="border-t border-border/60 bg-muted/[0.14] px-5 py-5 md:border-l md:border-t-0"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Save review</p><div className="mt-3 space-y-3"><div className="rounded-xl border border-border/65 bg-background/35 p-3"><p className="text-xs text-muted-foreground">Current on-hand</p><p className="mt-1 font-mono text-xl font-semibold">{p.quantity_in_stock}</p></div><div className="rounded-xl border border-cyan-400/15 bg-cyan-400/[0.045] p-3"><p className="text-xs text-muted-foreground">After this event</p><p className="mt-1 font-mono text-xl font-semibold text-cyan-100">{projectedStock}</p><p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{stockForm.type === "in" ? "Inventory will be received." : stockForm.type === "out" ? "Inventory will be issued." : "Inventory will be set to this count."}</p></div></div><p className="mt-4 text-[11px] leading-relaxed text-muted-foreground"><RotateCcw className="mr-1 inline h-3.5 w-3.5" />The signed-in technician and supplied reason are retained with the movement.</p></aside>
            </div>
            <DialogFooter className="flex-row items-center justify-end gap-2 border-t border-border/60 bg-background/80 px-6 py-4"><Button variant="outline" onClick={() => setStockDialog(false)}>Cancel</Button><Button onClick={handleStockMovement} data-testid="submit-stock-btn"><ArrowUpDown className="mr-1.5 h-4 w-4" />{stockForm.type === "in" ? "Receive stock" : stockForm.type === "out" ? "Issue stock" : "Apply adjustment"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Create Instances Dialog */}
        <Dialog open={instanceDialog} onOpenChange={setInstanceDialog}>
          <DialogContent className="max-w-2xl overflow-hidden border-cyan-400/20 bg-background p-0 shadow-2xl shadow-cyan-950/30">
            <DialogHeader className="border-b border-cyan-400/15 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.16),transparent_42%),linear-gradient(135deg,rgba(16,185,129,0.08),transparent)] px-6 py-5 pr-14">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Asset traceability</p>
              <DialogTitle className="mt-1 flex items-center gap-3 text-xl"><span className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-400/10"><QrCode className="h-5 w-5 text-cyan-200" /></span>Create serialised instances</DialogTitle>
              <DialogDescription className="mt-2 text-sm leading-relaxed">Create individually traceable instances for <span className="font-medium text-foreground">{p.name}</span>. Each instance receives its own barcode for stock, ticket and client assignment.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_15rem]">
              <div className="space-y-5 px-6 py-5"><section className="rounded-2xl border border-border/65 bg-card/45 p-4"><div className="mb-4 flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-violet-400/20 bg-violet-400/[0.08]"><Layers className="h-4 w-4 text-violet-200" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300">Instance details</p><p className="mt-1 text-sm font-semibold">Serial and location</p><p className="mt-1 text-xs text-muted-foreground">Leave the serial base blank for NexusMSP to generate unique values.</p></div></div><div className="grid gap-4 sm:grid-cols-2"><div><Label>Number of instances</Label><Input type="number" value={instanceForm.count} onChange={e => setInstanceForm({ ...instanceForm, count: e.target.value })} min="1" max="100" /></div><div><Label>Location</Label><Input value={instanceForm.location} onChange={e => setInstanceForm({ ...instanceForm, location: e.target.value })} placeholder="e.g. Warehouse A" /></div></div><div className="mt-4"><Label>Serial number base <span className="text-muted-foreground">(optional)</span></Label><Input value={instanceForm.serial_number} onChange={e => setInstanceForm({ ...instanceForm, serial_number: e.target.value })} placeholder="e.g. DELL-OPT-2026" /><p className="mt-1.5 text-[11px] text-muted-foreground">For multiple instances, NexusMSP appends a sequence such as <span className="font-mono">-01</span>, <span className="font-mono">-02</span>.</p></div></section></div>
              <aside className="border-t border-border/60 bg-muted/[0.14] px-5 py-5 md:border-l md:border-t-0"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Creation review</p><div className="mt-3 space-y-3"><div className="rounded-xl border border-border/65 bg-background/35 p-3"><p className="text-xs text-muted-foreground">Instances to create</p><p className="mt-1 font-mono text-xl font-semibold">{instanceCount}</p></div><div className="rounded-xl border border-violet-400/15 bg-violet-400/[0.045] p-3"><p className="text-xs text-muted-foreground">Inventory after creation</p><p className="mt-1 font-mono text-xl font-semibold text-violet-100">{p.quantity_in_stock + instanceCount}</p><p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">Stock is increased and a traceable inbound movement is written.</p></div></div><p className="mt-4 text-[11px] leading-relaxed text-muted-foreground"><RotateCcw className="mr-1 inline h-3.5 w-3.5" />Instances can later be linked to tickets, invoices and client assets without losing their serial history.</p></aside>
            </div>
            <DialogFooter className="flex-row items-center justify-end gap-2 border-t border-border/60 bg-background/80 px-6 py-4"><Button variant="outline" onClick={() => setInstanceDialog(false)}>Cancel</Button><Button onClick={handleCreateInstances} data-testid="submit-instances-btn"><QrCode className="mr-1.5 h-4 w-4" />Create {instanceCount} {instanceCount === 1 ? "instance" : "instances"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ========== LIST VIEW ==========
  return (
    <div className="space-y-6" data-testid="products-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Products</h1>
          <p className="text-muted-foreground">{products.length} products in catalog</p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)} data-testid="products-import-csv"><Upload className="w-3.5 h-3.5 mr-1" />Import CSV</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5" data-testid="products-workspace-tools">
                <MoreHorizontal className="w-3.5 h-3.5" />
                Tools
                <ChevronDown className="w-3.5 h-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => navigate("/stocktake")} className="gap-2" data-testid="products-tools-stocktake">
                <ClipboardList className="w-4 h-4" />
                Stocktake
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/stocktake-mobile")} className="gap-2" data-testid="products-tools-mobile-stocktake">
                <QrCode className="w-4 h-4" />
                Mobile stocktake
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/rentals")} className="gap-2" data-testid="products-tools-phone-rentals">
                <Truck className="w-4 h-4" />
                Phone rentals
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={openCreate} data-testid="add-product-btn"><Plus className="w-4 h-4 mr-1" />Add Product</Button>
        </div>
      </div>

      <MetricStrip columns={5}>
        <MetricTile label="Total Products" value={products.length} accent="cyan" icon={<Package className="h-3.5 w-3.5" />} testid="products-metric-total" />
        <MetricTile label="Inventory Value" value={`$${totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} accent="emerald" icon={<DollarSign className="h-3.5 w-3.5" />} testid="products-metric-value" />
        <MetricTile label="Recurring" value={recurring.length} accent="violet" icon={<RefreshCw className="h-3.5 w-3.5" />} testid="products-metric-recurring" />
        <MetricTile label="Low Stock" value={lowStock.length} accent="amber" icon={<AlertTriangle className="h-3.5 w-3.5" />} testid="products-metric-low-stock" />
        <MetricTile label="Categories" value={categories.length} accent="sky" icon={<Layers className="h-3.5 w-3.5" />} testid="products-metric-categories" />
      </MetricStrip>

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

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="cursor-pointer" onClick={() => toggleSort("name")}><div className="flex items-center gap-1">Product <ArrowUpDown className="w-3 h-3" /></div></TableHead>
                <TableHead className="hidden lg:table-cell">SKU</TableHead>
                <TableHead className="hidden lg:table-cell">Category</TableHead>
                <TableHead className="hidden xl:table-cell">Vendor</TableHead>
                <TableHead className="hidden xl:table-cell">Barcode</TableHead>
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
                <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => { setViewProduct(p); setDetailTab("overview"); }} data-testid={`product-row-${p.id}`}>
                  <TableCell className="min-w-[11rem]">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded border border-primary/10 bg-primary/10">
                        {p.image_url ? <img src={resolveProductImageUrl(p.image_url)} alt="" className="h-full w-full object-cover" onError={event => { event.currentTarget.style.display = "none"; }} /> : p.is_recurring ? <RefreshCw className="w-4 h-4 text-purple-500" /> : <Package className="w-4 h-4 text-primary" />}
                      </div>
                      <span className="min-w-0"><span className="block truncate font-medium">{p.name}</span><span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground lg:hidden">{p.sku || "No SKU"}</span></span>
                    </div>
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs lg:table-cell">{p.sku || "-"}</TableCell>
                  <TableCell className="hidden lg:table-cell"><Badge variant="outline" className="text-xs">{p.category}</Badge></TableCell>
                  <TableCell className="hidden text-sm xl:table-cell">{p.vendor || "-"}</TableCell>
                  <TableCell className="hidden xl:table-cell">
                    {p.barcode ? (
                      <div className="flex items-center gap-1">
                        <QrCode className="w-3 h-3 text-emerald-500" />
                        <span className="font-mono text-[10px]">{p.barcode}</span>
                      </div>
                    ) : <span className="text-xs text-muted-foreground">-</span>}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm font-medium">${p.retail_price.toFixed(2)}</TableCell>
                  <TableCell className="text-right">
                    {tracksInventory(p) ? <>
                    <span className={`font-mono text-sm font-medium ${p.quantity_in_stock <= (p.reorder_level || 5) ? 'text-red-500' : ''}`}>
                      {p.quantity_in_stock}
                    </span>
                    {p.quantity_in_stock <= (p.reorder_level || 5) && <AlertTriangle className="w-3 h-3 text-yellow-500 inline ml-1" />}
                    {(() => { const oo = onOrderSummary.find(o => o.product_id === p.id); return oo ? (
                      <div className="flex items-center gap-1 justify-end mt-0.5">
                        <Truck className="w-3 h-3 text-cyan-400 animate-pulse" />
                        <span className="text-[10px] font-mono text-cyan-400">{oo.on_order_qty} ordered</span>
                      </div>
                    ) : null; })()}
                    </> : <span className="text-xs text-muted-foreground">Not tracked</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={p.is_active ? "default" : "secondary"} className="text-[10px]">{p.is_active ? "Active" : "Inactive"}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label={`Edit ${p.name}`} onClick={() => openEdit(p)}><Edit className="w-3 h-3" /></Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label={`Print label for ${p.name}`} onClick={() => printLabel(p)}><Printer className="w-3 h-3" /></Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" aria-label={`Delete ${p.name}`} onClick={() => setDeleteTarget(p)}><Trash2 className="w-3 h-3" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {lowStock.length > 0 && (
        <Card className="border-yellow-500/30">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2 text-yellow-500"><AlertTriangle className="w-4 h-4" />Low Stock Alert ({lowStock.length} items)</CardTitle></CardHeader>
          <CardContent>
            <div className="flex gap-2 flex-wrap">
              {lowStock.map(p => (
                <div key={p.id} className="px-3 py-2 rounded-lg border border-yellow-500/20 bg-yellow-500/5 cursor-pointer hover:border-yellow-500/40 transition-colors" onClick={() => { setViewProduct(p); setDetailTab("overview"); }}>
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">Stock: <span className="text-red-500 font-bold">{p.quantity_in_stock}</span> / Reorder: {p.reorder_level}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>Import products from CSV</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Required: <code>Name</code>. Optional columns include SKU, Category, Vendor, Cost Price, Retail Price, Stock, Reorder, Tax Rate, Description, and Unit. Matching SKUs are updated.</p>
          <Textarea rows={12} value={importCsv} onChange={event => setImportCsv(event.target.value)} placeholder="Paste CSV data here…" className="font-mono text-xs" data-testid="products-import-csv-text" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setImportOpen(false)}>Cancel</Button>
            <Button disabled={importing || !importCsv.trim()} onClick={importProducts} data-testid="products-run-import">{importing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Upload className="w-4 h-4 mr-1" />}Import products</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name || "product"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the product, its tracked instances, stock movements, and bundle links. Ticket and invoice history is retained.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Product</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleteTarget && handleDelete(deleteTarget.id)} data-testid="confirm-delete-product">
              Delete Product
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {formDialog}
      {labelPrintDialog}
    </div>
  );
}
