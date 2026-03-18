import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Plus, Search, Loader2, FileText, ArrowLeft, Send, CheckCircle,
  XCircle, Eye, Trash2, DollarSign, Clock, ArrowRight, Receipt,
  History, AlertCircle, CircleDot, Zap, RefreshCw, X
} from "lucide-react";
import { format } from "date-fns";

const STATUS_CONFIG = {
  draft: { label: "Draft", class: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30", icon: CircleDot, pulse: false },
  published: { label: "Published", class: "bg-blue-500/20 text-blue-400 border-blue-500/30", icon: Eye, pulse: true },
  sent: { label: "Sent", class: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30", icon: Send, pulse: true },
  approved: { label: "Approved", class: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30", icon: CheckCircle, pulse: false },
  declined: { label: "Declined", class: "bg-red-500/20 text-red-400 border-red-500/30", icon: XCircle, pulse: false },
  expired: { label: "Expired", class: "bg-amber-500/20 text-amber-400 border-amber-500/30", icon: Clock, pulse: false },
  converted: { label: "Converted", class: "bg-purple-500/20 text-purple-400 border-purple-500/30", icon: Receipt, pulse: false },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.draft;
  const Icon = cfg.icon;
  return (
    <Badge className={`${cfg.class} ${cfg.pulse ? "animate-pulse" : ""}`} data-testid={`status-${status}`}>
      <Icon className="w-3 h-3 mr-1" />{cfg.label}
    </Badge>
  );
}

function StatusIndicator({ status }) {
  const colors = {
    draft: "bg-zinc-400", published: "bg-blue-400", sent: "bg-cyan-400",
    approved: "bg-emerald-400", declined: "bg-red-400", expired: "bg-amber-400", converted: "bg-purple-400",
  };
  const pulseStatuses = ["published", "sent"];
  return (
    <div className="flex items-center gap-2">
      <div className={`w-2 h-2 rounded-full ${colors[status] || "bg-zinc-400"} ${pulseStatuses.includes(status) ? "animate-pulse shadow-lg" : ""}`}
        style={pulseStatuses.includes(status) ? { boxShadow: `0 0 8px ${status === "published" ? "#3b82f6" : "#06b6d4"}` } : {}} />
      <StatusBadge status={status} />
    </div>
  );
}

export default function EstimatesPage() {
  const { token } = useAuth();
  const [estimates, setEstimates] = useState([]);
  const [clients, setClients] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [auditLog, setAuditLog] = useState([]);
  const [form, setForm] = useState({
    title: "", description: "", client_id: "", client_name: "", client_email: "",
    line_items: [{ description: "", quantity: 1, unit_price: 0 }],
    tax_rate: 0, discount: 0, valid_until: "", notes: "", terms: "",
  });
  const headers = { Authorization: `Bearer ${token}` };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [eRes, cRes, sRes] = await Promise.all([
        axios.get(`${API}/estimates`, { headers }),
        axios.get(`${API}/clients`, { headers }),
        axios.get(`${API}/estimates/stats/summary`, { headers }),
      ]);
      setEstimates(eRes.data);
      setClients(cRes.data);
      setStats(sRes.data);
    } catch { toast.error("Failed to fetch estimates"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const resetForm = () => setForm({
    title: "", description: "", client_id: "", client_name: "", client_email: "",
    line_items: [{ description: "", quantity: 1, unit_price: 0 }],
    tax_rate: 0, discount: 0, valid_until: "", notes: "", terms: "",
  });

  const handleCreate = async () => {
    if (!form.title || !form.client_id) { toast.error("Title and client required"); return; }
    try {
      const res = await axios.post(`${API}/estimates`, form, { headers });
      toast.success(`Estimate ${res.data.estimate_number} created`);
      setIsCreateOpen(false);
      resetForm();
      fetchAll();
    } catch { toast.error("Failed to create estimate"); }
  };

  const handleStatusChange = async (id, newStatus, reason) => {
    try {
      await axios.put(`${API}/estimates/${id}/status`, { status: newStatus, reason }, { headers });
      toast.success(`Status changed to ${newStatus}`);
      if (viewing) {
        const res = await axios.get(`${API}/estimates/${id}`, { headers });
        setViewing(res.data);
        const aRes = await axios.get(`${API}/estimates/${id}/audit-log`, { headers });
        setAuditLog(aRes.data);
      }
      fetchAll();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const handleConvert = async (id) => {
    try {
      const res = await axios.post(`${API}/estimates/${id}/convert-to-invoice`, {}, { headers });
      toast.success(res.data.message);
      fetchAll();
      if (viewing) {
        const r = await axios.get(`${API}/estimates/${id}`, { headers });
        setViewing(r.data);
      }
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this estimate?")) return;
    try {
      await axios.delete(`${API}/estimates/${id}`, { headers });
      toast.success("Estimate deleted");
      setViewing(null);
      fetchAll();
    } catch { toast.error("Failed to delete"); }
  };

  const viewEstimate = async (est) => {
    setViewing(est);
    try {
      const aRes = await axios.get(`${API}/estimates/${est.id}/audit-log`, { headers });
      setAuditLog(aRes.data);
    } catch { setAuditLog([]); }
  };

  const addLineItem = () => setForm(f => ({ ...f, line_items: [...f.line_items, { description: "", quantity: 1, unit_price: 0 }] }));
  const removeLineItem = (idx) => setForm(f => ({ ...f, line_items: f.line_items.filter((_, i) => i !== idx) }));
  const updateLineItem = (idx, field, value) => setForm(f => {
    const items = [...f.line_items];
    items[idx] = { ...items[idx], [field]: value };
    return { ...f, line_items: items };
  });

  const calcSubtotal = (items) => items.reduce((s, i) => s + (i.quantity || 0) * (i.unit_price || 0), 0);

  const filtered = estimates.filter(e => {
    if (statusFilter !== "all" && e.status !== statusFilter) return false;
    if (search && !e.title?.toLowerCase().includes(search.toLowerCase()) && !e.estimate_number?.toLowerCase().includes(search.toLowerCase()) && !e.client_name?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  // ========== DETAIL VIEW ==========
  if (viewing) {
    const sub = calcSubtotal(viewing.line_items || []);
    const taxAmt = sub * (viewing.tax_rate || 0) / 100;
    return (
      <div className="space-y-5" data-testid="estimate-detail">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setViewing(null)} data-testid="back-to-estimates"><ArrowLeft className="w-4 h-4 mr-1" />Back</Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">{viewing.estimate_number}</h1>
              <StatusIndicator status={viewing.status} />
            </div>
            <p className="text-sm text-muted-foreground">{viewing.title} &middot; {viewing.client_name}</p>
          </div>
          <div className="ml-auto flex gap-2">
            {viewing.status === "draft" && <Button size="sm" onClick={() => handleStatusChange(viewing.id, "published")} className="bg-blue-600 hover:bg-blue-700" data-testid="publish-btn"><Eye className="w-3 h-3 mr-1" />Publish</Button>}
            {viewing.status === "published" && <Button size="sm" onClick={() => handleStatusChange(viewing.id, "sent")} className="bg-cyan-600 hover:bg-cyan-700" data-testid="mark-sent-btn"><Send className="w-3 h-3 mr-1" />Mark Sent</Button>}
            {["published", "sent"].includes(viewing.status) && (
              <>
                <Button size="sm" onClick={() => handleStatusChange(viewing.id, "approved")} className="bg-emerald-600 hover:bg-emerald-700" data-testid="approve-btn"><CheckCircle className="w-3 h-3 mr-1" />Approve</Button>
                <Button size="sm" variant="outline" className="text-red-400 border-red-500/30" onClick={() => { const r = prompt("Decline reason?"); if (r !== null) handleStatusChange(viewing.id, "declined", r); }} data-testid="decline-btn"><XCircle className="w-3 h-3 mr-1" />Decline</Button>
              </>
            )}
            {viewing.status === "approved" && !viewing.converted_to_invoice && <Button size="sm" onClick={() => handleConvert(viewing.id)} className="bg-purple-600 hover:bg-purple-700" data-testid="convert-btn"><Receipt className="w-3 h-3 mr-1" />Convert to Invoice</Button>}
            <Button size="sm" variant="outline" className="text-red-400" onClick={() => handleDelete(viewing.id)} data-testid="delete-estimate-btn"><Trash2 className="w-3 h-3" /></Button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Card className="col-span-2">
            <CardHeader className="pb-2"><CardTitle className="text-sm">Line Items</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Description</TableHead><TableHead className="text-right w-20">Qty</TableHead><TableHead className="text-right w-28">Unit Price</TableHead><TableHead className="text-right w-28">Total</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {(viewing.line_items || []).map((li, i) => (
                    <TableRow key={i}>
                      <TableCell>{li.description}</TableCell>
                      <TableCell className="text-right font-mono">{li.quantity}</TableCell>
                      <TableCell className="text-right font-mono">${parseFloat(li.unit_price || 0).toFixed(2)}</TableCell>
                      <TableCell className="text-right font-mono font-bold">${(li.quantity * li.unit_price).toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Separator className="my-3" />
              <div className="flex flex-col items-end gap-1 text-sm">
                <div className="flex gap-8"><span className="text-muted-foreground">Subtotal:</span><span className="font-mono">${sub.toFixed(2)}</span></div>
                {viewing.tax_rate > 0 && <div className="flex gap-8"><span className="text-muted-foreground">Tax ({viewing.tax_rate}%):</span><span className="font-mono">${taxAmt.toFixed(2)}</span></div>}
                {viewing.discount > 0 && <div className="flex gap-8"><span className="text-muted-foreground">Discount:</span><span className="font-mono text-red-400">-${parseFloat(viewing.discount).toFixed(2)}</span></div>}
                <Separator className="w-48" />
                <div className="flex gap-8 text-lg"><span className="font-semibold">Total:</span><span className="font-mono font-bold text-emerald-400">${parseFloat(viewing.total || 0).toFixed(2)}</span></div>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Details</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div><span className="text-muted-foreground">Client:</span> <span className="font-medium">{viewing.client_name}</span></div>
                {viewing.client_email && <div><span className="text-muted-foreground">Email:</span> {viewing.client_email}</div>}
                {viewing.valid_until && <div><span className="text-muted-foreground">Valid Until:</span> {viewing.valid_until}</div>}
                <div><span className="text-muted-foreground">Created:</span> {viewing.created_at?.slice(0, 10)}</div>
                <div><span className="text-muted-foreground">By:</span> {viewing.created_by_name}</div>
                {viewing.notes && <div className="pt-2 border-t"><span className="text-muted-foreground block">Notes:</span>{viewing.notes}</div>}
                {viewing.converted_to_invoice && <Badge className="bg-purple-500/20 text-purple-400 mt-2">Converted to Invoice</Badge>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1"><History className="w-3 h-3" />Audit Trail</CardTitle></CardHeader>
              <CardContent>
                <ScrollArea className="h-48">
                  <div className="space-y-2">
                    {auditLog.map(a => (
                      <div key={a.id} className="flex items-start gap-2 text-xs border-l-2 border-primary/20 pl-2 py-1">
                        <div>
                          <p className="font-medium">{a.details}</p>
                          <p className="text-muted-foreground">{a.user_name} &middot; {a.created_at?.slice(0, 16)}</p>
                        </div>
                      </div>
                    ))}
                    {auditLog.length === 0 && <p className="text-muted-foreground text-xs">No audit entries</p>}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // ========== LIST VIEW ==========
  const draftCount = estimates.filter(e => e.status === "draft").length;
  const activeCount = estimates.filter(e => ["published", "sent"].includes(e.status)).length;
  const approvedCount = estimates.filter(e => e.status === "approved").length;

  return (
    <div className="space-y-5" data-testid="estimates-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Estimates</h1>
          <p className="text-muted-foreground">{estimates.length} estimates &middot; ${stats?.total_value?.toLocaleString() || 0} total value</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchAll}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
          <Button onClick={() => setIsCreateOpen(true)} data-testid="create-estimate-btn"><Plus className="w-4 h-4 mr-1" />New Estimate</Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-3">
        <Card className="cursor-pointer hover:border-zinc-500/40" onClick={() => setStatusFilter("all")} data-testid="stat-total">
          <CardContent className="pt-4 pb-3"><div className="flex items-center justify-between"><div><p className="text-2xl font-black">{estimates.length}</p><p className="text-[11px] text-muted-foreground">Total</p></div><FileText className="w-5 h-5 text-muted-foreground" /></div></CardContent>
        </Card>
        <Card className="cursor-pointer hover:border-zinc-500/40" onClick={() => setStatusFilter("draft")} data-testid="stat-draft">
          <CardContent className="pt-4 pb-3"><div className="flex items-center justify-between"><div><p className="text-2xl font-black text-zinc-400">{draftCount}</p><p className="text-[11px] text-muted-foreground">Drafts</p></div><CircleDot className="w-5 h-5 text-zinc-400" /></div></CardContent>
        </Card>
        <Card className="cursor-pointer hover:border-blue-500/40" onClick={() => setStatusFilter("published")}>
          <CardContent className="pt-4 pb-3"><div className="flex items-center justify-between"><div><p className="text-2xl font-black text-blue-400">{activeCount}</p><p className="text-[11px] text-muted-foreground">Active</p></div><div className="w-3 h-3 rounded-full bg-blue-400 animate-pulse" style={{ boxShadow: "0 0 12px #3b82f6" }} /></div></CardContent>
        </Card>
        <Card className="cursor-pointer hover:border-emerald-500/40" onClick={() => setStatusFilter("approved")} data-testid="stat-approved">
          <CardContent className="pt-4 pb-3"><div className="flex items-center justify-between"><div><p className="text-2xl font-black text-emerald-400">{approvedCount}</p><p className="text-[11px] text-muted-foreground">Approved</p></div><CheckCircle className="w-5 h-5 text-emerald-400" /></div></CardContent>
        </Card>
        <Card data-testid="stat-value">
          <CardContent className="pt-4 pb-3"><div className="flex items-center justify-between"><div><p className="text-2xl font-black text-emerald-400">${stats?.approved_value?.toLocaleString() || 0}</p><p className="text-[11px] text-muted-foreground">Approved Value</p></div><DollarSign className="w-5 h-5 text-emerald-400" /></div></CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search estimates..." value={search} onChange={e => setSearch(e.target.value)} data-testid="search-estimates" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40" data-testid="filter-status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="published">Published</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="declined">Declined</SelectItem>
            <SelectItem value="converted">Converted</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Estimate #</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Created</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">No estimates found</TableCell></TableRow>
              ) : filtered.map(est => (
                <TableRow key={est.id} className="cursor-pointer hover:bg-muted/30" onClick={() => viewEstimate(est)} data-testid={`estimate-row-${est.id}`}>
                  <TableCell className="font-mono font-bold text-primary">{est.estimate_number}</TableCell>
                  <TableCell className="font-medium">{est.title}</TableCell>
                  <TableCell className="text-muted-foreground">{est.client_name}</TableCell>
                  <TableCell><StatusIndicator status={est.status} /></TableCell>
                  <TableCell className="text-right font-mono font-bold">${parseFloat(est.total || 0).toFixed(2)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{est.created_at?.slice(0, 10)}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={e => { e.stopPropagation(); handleDelete(est.id); }} data-testid={`delete-est-${est.id}`}><Trash2 className="w-3 h-3" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* CREATE DIALOG */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><FileText className="w-5 h-5" />New Estimate</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Title</Label><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Estimate title" data-testid="est-title" /></div>
              <div><Label>Client</Label>
                <Select value={form.client_id || "__none"} onValueChange={v => {
                  const c = clients.find(x => x.id === v);
                  setForm(f => ({ ...f, client_id: v === "__none" ? "" : v, client_name: c?.name || "", client_email: c?.email || "" }));
                }}>
                  <SelectTrigger data-testid="est-client"><SelectValue placeholder="Select client" /></SelectTrigger>
                  <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Description</Label><Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Description" rows={2} /></div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Line Items</Label>
                <Button size="sm" variant="outline" onClick={addLineItem}><Plus className="w-3 h-3 mr-1" />Add Item</Button>
              </div>
              <div className="space-y-2">
                {form.line_items.map((li, i) => (
                  <div key={i} className="grid grid-cols-[1fr_80px_100px_32px] gap-2 items-end">
                    <Input placeholder="Description" value={li.description} onChange={e => updateLineItem(i, "description", e.target.value)} data-testid={`li-desc-${i}`} />
                    <Input type="number" placeholder="Qty" value={li.quantity} onChange={e => updateLineItem(i, "quantity", parseFloat(e.target.value) || 0)} />
                    <Input type="number" placeholder="Price" value={li.unit_price} onChange={e => updateLineItem(i, "unit_price", parseFloat(e.target.value) || 0)} />
                    {form.line_items.length > 1 && <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-red-400" onClick={() => removeLineItem(i)}><X className="w-3 h-3" /></Button>}
                  </div>
                ))}
              </div>
              <div className="text-right mt-2 text-sm"><span className="text-muted-foreground">Subtotal: </span><span className="font-mono font-bold">${calcSubtotal(form.line_items).toFixed(2)}</span></div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div><Label>Tax Rate (%)</Label><Input type="number" value={form.tax_rate} onChange={e => setForm(f => ({ ...f, tax_rate: parseFloat(e.target.value) || 0 }))} /></div>
              <div><Label>Discount ($)</Label><Input type="number" value={form.discount} onChange={e => setForm(f => ({ ...f, discount: parseFloat(e.target.value) || 0 }))} /></div>
              <div><Label>Valid Until</Label><Input type="date" value={form.valid_until} onChange={e => setForm(f => ({ ...f, valid_until: e.target.value }))} /></div>
            </div>
            <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Internal notes" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} data-testid="save-estimate-btn"><FileText className="w-4 h-4 mr-1" />Create Estimate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
