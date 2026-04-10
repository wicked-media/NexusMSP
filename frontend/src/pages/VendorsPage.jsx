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
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Plus, Search, Loader2, Edit, Trash2, Building2, Globe, Phone, Mail,
  RefreshCw, ArrowLeft, ChevronRight, ShoppingCart, DollarSign, FileText,
  MapPin, CreditCard, ExternalLink, Users
} from "lucide-react";

const CATEGORIES = [
  { value: "general", label: "General" },
  { value: "hardware", label: "Hardware" },
  { value: "software", label: "Software" },
  { value: "telecom", label: "Telecom" },
  { value: "networking", label: "Networking" },
  { value: "cloud", label: "Cloud Services" },
  { value: "security", label: "Security" },
  { value: "consulting", label: "Consulting" },
];

const PAYMENT_TERMS = ["Net 7", "Net 14", "Net 30", "Net 45", "Net 60", "Net 90", "Due on Receipt", "Prepaid"];

const CAT_COLORS = {
  general: "bg-slate-500/20 text-slate-400", hardware: "bg-blue-500/20 text-blue-400",
  software: "bg-purple-500/20 text-purple-400", telecom: "bg-cyan-500/20 text-cyan-400",
  networking: "bg-emerald-500/20 text-emerald-400", cloud: "bg-indigo-500/20 text-indigo-400",
  security: "bg-red-500/20 text-red-400", consulting: "bg-amber-500/20 text-amber-400",
};

const emptyForm = {
  name: "", contact_name: "", email: "", phone: "", address: "", city: "",
  state: "", country: "Australia", postal_code: "", abn: "", tax_id: "",
  payment_terms: "Net 30", website: "", notes: "", category: "general",
};

export default function VendorsPage() {
  const { token } = useAuth();
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewVendor, setViewVendor] = useState(null);
  const [form, setForm] = useState({ ...emptyForm });

  const headers = { Authorization: `Bearer ${token}` };

  const fetchVendors = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/vendors`, { headers });
      setVendors(res.data);
    } catch { toast.error("Failed to load vendors"); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchVendors(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openAdd = () => { setEditing(null); setForm({ ...emptyForm }); setFormOpen(true); };
  const openEdit = (v) => {
    setEditing(v);
    setForm({
      name: v.name || "", contact_name: v.contact_name || "", email: v.email || "",
      phone: v.phone || "", address: v.address || "", city: v.city || "",
      state: v.state || "", country: v.country || "Australia", postal_code: v.postal_code || "",
      abn: v.abn || "", tax_id: v.tax_id || "", payment_terms: v.payment_terms || "Net 30",
      website: v.website || "", notes: v.notes || "", category: v.category || "general",
    });
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!form.name) { toast.error("Vendor name is required"); return; }
    try {
      if (editing) {
        await axios.put(`${API}/vendors/${editing.id}`, form, { headers });
        toast.success("Vendor updated");
        if (viewVendor?.id === editing.id) {
          const res = await axios.get(`${API}/vendors/${editing.id}`, { headers });
          setViewVendor(res.data);
        }
      } else {
        await axios.post(`${API}/vendors`, form, { headers });
        toast.success("Vendor created");
      }
      setFormOpen(false); fetchVendors();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to save vendor"); }
  };

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API}/vendors/${id}`, { headers });
      toast.success("Vendor deleted");
      if (viewVendor?.id === id) setViewVendor(null);
      fetchVendors();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to delete"); }
  };

  const openViewVendor = async (v) => {
    try {
      const res = await axios.get(`${API}/vendors/${v.id}`, { headers });
      setViewVendor(res.data);
    } catch { toast.error("Failed to load vendor details"); }
  };

  const filtered = vendors
    .filter(v => catFilter === "all" || v.category === catFilter)
    .filter(v => !search || v.name?.toLowerCase().includes(search.toLowerCase()) || v.contact_name?.toLowerCase().includes(search.toLowerCase()) || v.email?.toLowerCase().includes(search.toLowerCase()));

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  // ============ VENDOR DETAIL VIEW ============
  if (viewVendor) {
    const v = viewVendor;
    const cc = CAT_COLORS[v.category] || CAT_COLORS.general;
    return (
      <div className="space-y-6" data-testid="vendor-detail">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setViewVendor(null)} data-testid="back-to-vendors"><ArrowLeft className="w-4 h-4 mr-1" />Back</Button>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
            <span className="font-semibold">{v.name}</span>
            <Badge className={cc}>{v.category}</Badge>
            {!v.is_active && <Badge variant="destructive">Inactive</Badge>}
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="bg-cyan-600 hover:bg-cyan-700" onClick={() => window.location.href = `/purchase-orders?vendor=${v.id}`} data-testid="create-po-btn"><ShoppingCart className="w-3 h-3 mr-1" />Create PO</Button>
            <Button size="sm" variant="outline" onClick={() => openEdit(v)} data-testid="edit-vendor-btn"><Edit className="w-3 h-3 mr-1" />Edit</Button>
            <Button size="sm" variant="destructive" onClick={() => handleDelete(v.id)}><Trash2 className="w-3 h-3 mr-1" />Delete</Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Total Orders</p><p className="text-xl font-bold">{v.total_orders || 0}</p></CardContent></Card>
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Total Spent</p><p className="text-xl font-bold">${(v.total_spent || 0).toLocaleString()}</p></CardContent></Card>
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Payment Terms</p><p className="text-xl font-bold">{v.payment_terms}</p></CardContent></Card>
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Category</p><p className="text-xl font-bold capitalize">{v.category}</p></CardContent></Card>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Users className="w-4 h-4" />Contact Info</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {v.contact_name && <div className="flex justify-between"><span className="text-muted-foreground">Contact</span><span>{v.contact_name}</span></div>}
              {v.email && <div className="flex justify-between"><span className="text-muted-foreground">Email</span><a href={`mailto:${v.email}`} className="text-primary hover:underline">{v.email}</a></div>}
              {v.phone && <div className="flex justify-between"><span className="text-muted-foreground">Phone</span><span>{v.phone}</span></div>}
              {v.website && <div className="flex justify-between"><span className="text-muted-foreground">Website</span><a href={v.website} target="_blank" rel="noreferrer" className="text-primary hover:underline flex items-center gap-1">{v.website}<ExternalLink className="w-3 h-3" /></a></div>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><MapPin className="w-4 h-4" />Address & Tax</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {(v.address || v.city) && <div className="flex justify-between"><span className="text-muted-foreground">Address</span><span>{[v.address, v.city, v.state, v.postal_code].filter(Boolean).join(", ")}</span></div>}
              <div className="flex justify-between"><span className="text-muted-foreground">Country</span><span>{v.country}</span></div>
              {v.abn && <div className="flex justify-between"><span className="text-muted-foreground">ABN</span><span className="font-mono">{v.abn}</span></div>}
              {v.tax_id && <div className="flex justify-between"><span className="text-muted-foreground">Tax ID</span><span className="font-mono">{v.tax_id}</span></div>}
            </CardContent>
          </Card>
        </div>

        {v.notes && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Notes</CardTitle></CardHeader>
            <CardContent><p className="text-sm text-muted-foreground">{v.notes}</p></CardContent>
          </Card>
        )}

        {/* Purchase Orders for this vendor */}
        {v.purchase_orders && v.purchase_orders.length > 0 && (
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><ShoppingCart className="w-4 h-4" />Purchase Orders ({v.purchase_orders.length})</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>PO #</TableHead><TableHead>Status</TableHead><TableHead>Total</TableHead><TableHead>Date</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {v.purchase_orders.map(po => (
                    <TableRow key={po.id}>
                      <TableCell className="font-mono text-xs">{po.po_number || po.id?.slice(0, 8)}</TableCell>
                      <TableCell><Badge variant="outline" className="capitalize text-xs">{po.status}</Badge></TableCell>
                      <TableCell>${(po.total || 0).toFixed(2)}</TableCell>
                      <TableCell className="text-xs">{po.created_at ? new Date(po.created_at).toLocaleDateString() : "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // ============ MAIN LIST ============
  return (
    <div className="space-y-6" data-testid="vendors-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Vendors</h1>
          <p className="text-muted-foreground">Manage your suppliers and vendor relationships</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchVendors}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
          <Button onClick={openAdd} data-testid="add-vendor-btn"><Plus className="w-4 h-4 mr-1" />Add Vendor</Button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-3">
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-[150px]" data-testid="vendor-cat-filter"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search vendors..." value={search} onChange={e => setSearch(e.target.value)} data-testid="vendor-search" />
        </div>
        <p className="text-sm text-muted-foreground">{filtered.length} vendor{filtered.length !== 1 ? "s" : ""}</p>
      </div>

      {/* Vendor Cards */}
      <div className="space-y-3">
        {filtered.map(v => {
          const cc = CAT_COLORS[v.category] || CAT_COLORS.general;
          return (
            <Card key={v.id} className="hover:border-primary/40 transition-colors cursor-pointer" onClick={() => openViewVendor(v)} data-testid={`vendor-card-${v.id}`}>
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-11 h-11 rounded-xl bg-slate-800 flex items-center justify-center">
                      <Building2 className="w-5 h-5 text-slate-400" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">{v.name}</p>
                        <Badge className={cc + " text-[10px]"}>{v.category}</Badge>
                        {!v.is_active && <Badge variant="destructive" className="text-[10px]">Inactive</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {[v.contact_name, v.email, v.phone].filter(Boolean).join(" | ") || "No contact info"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-6 text-sm" onClick={e => e.stopPropagation()}>
                    <div className="text-center"><p className="text-xs text-muted-foreground">Orders</p><p className="font-medium">{v.total_orders || 0}</p></div>
                    <div className="text-center"><p className="text-xs text-muted-foreground">Spent</p><p className="font-medium">${(v.total_spent || 0).toLocaleString()}</p></div>
                    <div className="text-center"><p className="text-xs text-muted-foreground">Terms</p><p className="font-medium text-xs">{v.payment_terms}</p></div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-cyan-400" onClick={() => window.location.href = `/purchase-orders?vendor=${v.id}`} data-testid={`create-po-${v.id}`}><ShoppingCart className="w-3 h-3 mr-1" />PO</Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(v)} data-testid={`edit-vendor-${v.id}`}><Edit className="w-3 h-3" /></Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => handleDelete(v.id)} data-testid={`delete-vendor-${v.id}`}><Trash2 className="w-3 h-3" /></Button>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {filtered.length === 0 && (
          <Card className="border-dashed"><CardContent className="py-12 text-center">
            <Building2 className="w-12 h-12 mx-auto text-muted-foreground mb-3 opacity-30" />
            <p className="text-muted-foreground mb-3">No vendors found</p>
            <Button onClick={openAdd}><Plus className="w-4 h-4 mr-1" />Add Your First Vendor</Button>
          </CardContent></Card>
        )}
      </div>

      {/* ===== ADD/EDIT VENDOR DIALOG ===== */}
      <Dialog open={formOpen} onOpenChange={v => { setFormOpen(v); if (!v) setEditing(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? "Edit Vendor" : "Add New Vendor"}</DialogTitle></DialogHeader>
          <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Vendor Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Yealink Australia" data-testid="vendor-name-input" /></div>
              <div><Label>Category</Label>
                <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
                  <SelectTrigger data-testid="vendor-category-select"><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <Separator />
            <p className="text-sm font-semibold flex items-center gap-2"><Users className="w-4 h-4" />Contact</p>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Contact Name</Label><Input value={form.contact_name} onChange={e => setForm({ ...form, contact_name: e.target.value })} placeholder="Primary contact" /></div>
              <div><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="accounts@vendor.com" data-testid="vendor-email-input" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Phone</Label><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+61 2 1234 5678" /></div>
              <div><Label>Website</Label><Input value={form.website} onChange={e => setForm({ ...form, website: e.target.value })} placeholder="https://www.vendor.com" /></div>
            </div>
            <Separator />
            <p className="text-sm font-semibold flex items-center gap-2"><MapPin className="w-4 h-4" />Address</p>
            <div><Label>Street Address</Label><Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="123 Business Street" /></div>
            <div className="grid grid-cols-4 gap-3">
              <div><Label>City</Label><Input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} /></div>
              <div><Label>State</Label><Input value={form.state} onChange={e => setForm({ ...form, state: e.target.value })} /></div>
              <div><Label>Postal Code</Label><Input value={form.postal_code} onChange={e => setForm({ ...form, postal_code: e.target.value })} /></div>
              <div><Label>Country</Label><Input value={form.country} onChange={e => setForm({ ...form, country: e.target.value })} /></div>
            </div>
            <Separator />
            <p className="text-sm font-semibold flex items-center gap-2"><CreditCard className="w-4 h-4" />Billing</p>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>ABN</Label><Input value={form.abn} onChange={e => setForm({ ...form, abn: e.target.value })} placeholder="XX XXX XXX XXX" /></div>
              <div><Label>Tax ID</Label><Input value={form.tax_id} onChange={e => setForm({ ...form, tax_id: e.target.value })} /></div>
              <div><Label>Payment Terms</Label>
                <Select value={form.payment_terms} onValueChange={v => setForm({ ...form, payment_terms: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PAYMENT_TERMS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} /></div>
          </div>
          <DialogFooter><Button onClick={handleSave} data-testid="save-vendor-btn">{editing ? "Update" : "Create"} Vendor</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
