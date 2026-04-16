import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  FileText, Plus, Trash2, Send, CheckCircle, XCircle, Copy, Eye, Edit,
  DollarSign, TrendingUp, Loader2, RefreshCw, Calendar, ArrowRight, Zap,
  Search, Award
} from "lucide-react";

const STATUS_MAP = {
  draft: { label: "Draft", color: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20" },
  sent: { label: "Sent", color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  viewed: { label: "Viewed", color: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20" },
  accepted: { label: "Accepted", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  declined: { label: "Declined", color: "bg-red-500/10 text-red-400 border-red-500/20" },
  expired: { label: "Expired", color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  converted: { label: "Converted", color: "bg-violet-500/10 text-violet-400 border-violet-500/20" },
};

const TERMS = [
  { id: "month_to_month", label: "Month-to-Month" },
  { id: "6_months", label: "6 Months" },
  { id: "12_months", label: "12 Months" },
  { id: "24_months", label: "24 Months" },
  { id: "36_months", label: "36 Months" },
];

export default function ProposalBuilderPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [proposals, setProposals] = useState([]);
  const [stats, setStats] = useState(null);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(null);
  const [saving, setSaving] = useState(false);

  const emptyForm = {
    client_id: "", client_name: "", client_email: "", title: "", summary: "",
    scope_of_work: "", contract_term: "12_months", payment_terms: "net_30",
    tax_rate: "10", currency: "AUD", notes: "",
    valid_until: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
    line_items: [{ description: "", quantity: "1", rate: "", amount: "", billing_type: "recurring" }],
  };
  const [form, setForm] = useState(emptyForm);

  const fetchData = useCallback(async () => {
    try {
      const [pRes, sRes, cRes] = await Promise.all([
        axios.get(`${API}/proposals`, { headers }),
        axios.get(`${API}/proposals/stats`, { headers }),
        axios.get(`${API}/clients`, { headers }),
      ]);
      setProposals(pRes.data);
      setStats(sRes.data);
      setClients(cRes.data);
    } catch { toast.error("Failed to load proposals"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const updateLI = (items, setter, idx, field, value) => {
    const u = [...items];
    u[idx] = { ...u[idx], [field]: value };
    if (field === "quantity" || field === "rate") {
      u[idx].amount = (parseFloat(u[idx].quantity || 0) * parseFloat(u[idx].rate || 0)).toFixed(2);
    }
    setter(prev => ({ ...prev, line_items: u }));
  };

  const addLI = (setter) => setter(prev => ({ ...prev, line_items: [...prev.line_items, { description: "", quantity: "1", rate: "", amount: "", billing_type: "recurring" }] }));
  const removeLI = (setter, idx) => setter(prev => ({ ...prev, line_items: prev.line_items.filter((_, i) => i !== idx) }));

  const calcTotals = (items, taxRate) => {
    const subtotal = items.reduce((a, li) => a + (parseFloat(li.amount) || 0), 0);
    const tax = subtotal * (parseFloat(taxRate) || 0) / 100;
    const mrr = items.filter(li => li.billing_type === "recurring").reduce((a, li) => a + (parseFloat(li.amount) || 0), 0);
    const setup = items.filter(li => li.billing_type !== "recurring").reduce((a, li) => a + (parseFloat(li.amount) || 0), 0);
    return { subtotal, tax, total: subtotal + tax, mrr, setup };
  };

  const createProposal = async () => {
    if (!form.client_id || !form.title) { toast.error("Client and title required"); return; }
    setSaving(true);
    try {
      const items = form.line_items.filter(li => li.description).map(li => ({ ...li, quantity: parseFloat(li.quantity) || 1, rate: parseFloat(li.rate) || 0, amount: parseFloat(li.amount) || 0, total: parseFloat(li.amount) || 0, unit_price: parseFloat(li.rate) || 0 }));
      const data = { ...form, tax_percent: parseFloat(form.tax_rate) || 0, line_items: items };
      await axios.post(`${API}/proposals`, data, { headers });
      toast.success("Proposal created");
      setShowCreate(false);
      setForm(emptyForm);
      fetchData();
    } catch { toast.error("Failed"); }
    finally { setSaving(false); }
  };

  const saveEdit = async () => {
    if (!showEdit) return;
    setSaving(true);
    try {
      const data = { ...showEdit, tax_rate: parseFloat(showEdit.tax_rate) || 0, line_items: showEdit.line_items?.filter(li => li.description).map(li => ({ ...li, quantity: parseFloat(li.quantity) || 1, rate: parseFloat(li.rate) || 0, amount: parseFloat(li.amount) || 0 })) };
      await axios.put(`${API}/proposals/${showEdit.id}`, data, { headers });
      toast.success("Updated");
      setShowEdit(null);
      fetchData();
    } catch { toast.error("Failed"); }
    finally { setSaving(false); }
  };

  const sendProposal = async (id) => { try { await axios.post(`${API}/proposals/${id}/send`, {}, { headers }); toast.success("Proposal sent"); fetchData(); } catch { toast.error("Failed"); } };
  const acceptProposal = async (id) => { try { await axios.post(`${API}/proposals/${id}/accept`, {}, { headers }); toast.success("Proposal accepted"); fetchData(); } catch { toast.error("Failed"); } };
  const declineProposal = async (id) => { try { await axios.post(`${API}/proposals/${id}/decline`, {}, { headers }); toast.success("Proposal declined"); fetchData(); } catch { toast.error("Failed"); } };
  const duplicateProposal = async (id) => { try { await axios.post(`${API}/proposals/${id}/duplicate`, {}, { headers }); toast.success("Duplicated"); fetchData(); } catch { toast.error("Failed"); } };
  const deleteProposal = async (id) => { if (!window.confirm("Delete?")) return; try { await axios.delete(`${API}/proposals/${id}`, { headers }); toast.success("Deleted"); fetchData(); } catch { toast.error("Failed"); } };

  const convertToContract = async (id) => {
    try {
      const res = await axios.post(`${API}/proposals/${id}/convert-to-contract`, {}, { headers });
      toast.success(res.data.message);
      fetchData();
    } catch { toast.error("Conversion failed"); }
  };

  const filtered = proposals.filter(p => {
    if (filterStatus !== "all" && p.status !== filterStatus) return false;
    if (search && !p.client_name?.toLowerCase().includes(search.toLowerCase()) && !p.title?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  const LIEditor = ({ items, setter }) => (
    <div className="space-y-2">
      <div className="grid grid-cols-12 gap-2 text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
        <div className="col-span-4">Description</div><div className="col-span-1">Qty</div><div className="col-span-2">Rate</div><div className="col-span-2">Amount</div><div className="col-span-2">Type</div><div className="col-span-1"></div>
      </div>
      {items.map((li, idx) => (
        <div key={`li-${idx}`} className="grid grid-cols-12 gap-2 items-center">
          <Input className="col-span-4 h-8 text-xs" value={li.description} onChange={e => updateLI(items, setter, idx, "description", e.target.value)} placeholder="Service..." />
          <Input className="col-span-1 h-8 text-xs font-mono" type="number" value={li.quantity} onChange={e => updateLI(items, setter, idx, "quantity", e.target.value)} />
          <Input className="col-span-2 h-8 text-xs font-mono" type="number" value={li.rate} onChange={e => updateLI(items, setter, idx, "rate", e.target.value)} placeholder="0" />
          <div className="col-span-2 text-xs font-mono font-bold">${parseFloat(li.amount || 0).toFixed(2)}</div>
          <Select value={li.billing_type || "recurring"} onValueChange={v => updateLI(items, setter, idx, "billing_type", v)}>
            <SelectTrigger className="col-span-2 h-8 text-[10px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="recurring">Recurring</SelectItem>
              <SelectItem value="one_time">One-Time</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" className="col-span-1 h-8 w-8 p-0" onClick={() => removeLI(setter, idx)} disabled={items.length <= 1}><Trash2 className="w-3 h-3" /></Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => addLI(setter)}><Plus className="w-3 h-3 mr-1" />Add Line</Button>
    </div>
  );

  return (
    <div className="space-y-5" data-testid="proposal-builder-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><FileText className="w-6 h-6 text-cyan-400" />Proposals & Quotes</h1>
          <p className="text-muted-foreground mt-1">Create proposals, win deals, and convert to contracts</p>
        </div>
        <Button onClick={() => { setShowCreate(true); setForm(emptyForm); }} data-testid="create-proposal-btn"><Plus className="w-4 h-4 mr-1" />New Proposal</Button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-5 gap-3">
          {[
            { label: "Pipeline", value: `$${stats.pipeline_value?.toLocaleString()}`, icon: TrendingUp, color: "text-blue-400", bg: "bg-blue-500/10" },
            { label: "Won Value", value: `$${stats.won_value?.toLocaleString()}`, icon: DollarSign, color: "text-emerald-400", bg: "bg-emerald-500/10" },
            { label: "Win Rate", value: `${stats.win_rate}%`, icon: Award, color: "text-amber-400", bg: "bg-amber-500/10" },
            { label: "Drafts", value: stats.by_status?.draft || 0, icon: Edit, color: "text-zinc-400", bg: "bg-zinc-500/10" },
            { label: "Sent", value: stats.by_status?.sent || 0, icon: Send, color: "text-blue-400", bg: "bg-blue-500/10" },
          ].map((s, i) => (
            <Card key={`s-${i}`}><CardContent className="p-3 flex items-center gap-3">
              <div className={`w-9 h-9 rounded-xl ${s.bg} flex items-center justify-center`}><s.icon className={`w-4 h-4 ${s.color}`} /></div>
              <div><p className="text-lg font-bold">{s.value}</p><p className="text-[9px] text-muted-foreground uppercase tracking-wider">{s.label}</p></div>
            </CardContent></Card>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search proposals..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {Object.entries(STATUS_MAP).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Proposals Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Proposal</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>MRR</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Term</TableHead>
                <TableHead>Valid Until</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">No proposals yet</TableCell></TableRow>}
              {filtered.map(p => {
                const st = STATUS_MAP[p.status] || STATUS_MAP.draft;
                return (
                  <TableRow key={p.id} data-testid={`proposal-${p.id}`}>
                    <TableCell>
                      <p className="font-medium text-sm">{p.title || p.proposal_number}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{p.proposal_number}</p>
                    </TableCell>
                    <TableCell>{p.client_name}</TableCell>
                    <TableCell className="font-mono">${(p.mrr || 0).toLocaleString()}/mo</TableCell>
                    <TableCell className="font-mono font-bold">${(p.total || 0).toLocaleString()}</TableCell>
                    <TableCell className="capitalize text-xs">{p.contract_term?.replace(/_/g, " ")}</TableCell>
                    <TableCell className="text-xs">{p.valid_until}</TableCell>
                    <TableCell><Badge className={`${st.color} border text-[9px]`}>{st.label}</Badge></TableCell>
                    <TableCell>
                      <div className="flex gap-1 justify-end">
                        {p.status === "draft" && <Button size="sm" variant="ghost" title="Send" onClick={() => sendProposal(p.id)}><Send className="w-3 h-3 text-blue-400" /></Button>}
                        {(p.status === "sent" || p.status === "viewed") && (
                          <>
                            <Button size="sm" variant="ghost" title="Accept" onClick={() => acceptProposal(p.id)}><CheckCircle className="w-3 h-3 text-emerald-400" /></Button>
                            <Button size="sm" variant="ghost" title="Decline" onClick={() => declineProposal(p.id)}><XCircle className="w-3 h-3 text-red-400" /></Button>
                          </>
                        )}
                        {p.status === "accepted" && <Button size="sm" variant="ghost" title="Convert to Contract" onClick={() => convertToContract(p.id)} data-testid={`convert-${p.id}`}><Zap className="w-3 h-3 text-violet-400" /></Button>}
                        <Button size="sm" variant="ghost" title="Edit" onClick={() => setShowEdit({ ...p, tax_rate: String(p.tax_rate || 10) })}><Edit className="w-3 h-3" /></Button>
                        <Button size="sm" variant="ghost" title="Duplicate" onClick={() => duplicateProposal(p.id)}><Copy className="w-3 h-3" /></Button>
                        <Button size="sm" variant="ghost" title="Delete" className="text-red-400" onClick={() => deleteProposal(p.id)}><Trash2 className="w-3 h-3" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* CREATE DIALOG */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" aria-describedby="create-prop-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileText className="w-5 h-5 text-cyan-400" />New Proposal</DialogTitle>
            <DialogDescription id="create-prop-desc">Build a proposal to win new or expand existing business</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Client</Label>
                <Select value={form.client_id} onValueChange={v => { const c = clients.find(x => x.id === v); setForm(p => ({ ...p, client_id: v, client_name: c?.name || "", client_email: c?.email || "" })); }}>
                  <SelectTrigger data-testid="prop-client"><SelectValue placeholder="Select client..." /></SelectTrigger>
                  <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Title</Label><Input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="e.g., Managed IT Services Proposal" data-testid="prop-title" /></div>
            </div>
            <div><Label>Executive Summary</Label><Textarea value={form.summary} onChange={e => setForm(p => ({ ...p, summary: e.target.value }))} rows={2} placeholder="Brief overview of what you're proposing..." /></div>
            <div><Label>Scope of Work</Label><Textarea value={form.scope_of_work} onChange={e => setForm(p => ({ ...p, scope_of_work: e.target.value }))} rows={3} placeholder="Detailed description of services..." /></div>
            <Separator />
            <Label className="text-sm font-medium">Pricing</Label>
            <LIEditor items={form.line_items} setter={setForm} />
            {(() => { const t = calcTotals(form.line_items, form.tax_rate); return (
              <div className="grid grid-cols-4 gap-3 p-3 rounded-lg bg-muted/30 border text-sm">
                <div><span className="text-muted-foreground text-xs block">MRR</span><span className="font-mono font-bold text-emerald-400">${t.mrr.toFixed(2)}</span></div>
                <div><span className="text-muted-foreground text-xs block">Setup</span><span className="font-mono font-bold">${t.setup.toFixed(2)}</span></div>
                <div><span className="text-muted-foreground text-xs block">Tax ({form.tax_rate}%)</span><span className="font-mono">${t.tax.toFixed(2)}</span></div>
                <div><span className="text-muted-foreground text-xs block">Total</span><span className="font-mono font-bold text-lg">${t.total.toFixed(2)}</span></div>
              </div>
            ); })()}
            <Separator />
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Contract Term</Label>
                <Select value={form.contract_term} onValueChange={v => setForm(p => ({ ...p, contract_term: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TERMS.map(t => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Payment Terms</Label>
                <Select value={form.payment_terms} onValueChange={v => setForm(p => ({ ...p, payment_terms: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="due_on_receipt">Due on Receipt</SelectItem>
                    <SelectItem value="net_14">Net 14</SelectItem>
                    <SelectItem value="net_30">Net 30</SelectItem>
                    <SelectItem value="net_60">Net 60</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Valid Until</Label><Input type="date" value={form.valid_until} onChange={e => setForm(p => ({ ...p, valid_until: e.target.value }))} /></div>
            </div>
            <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} placeholder="Internal notes..." /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={createProposal} disabled={saving} data-testid="prop-submit">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create Proposal"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* EDIT DIALOG */}
      <Dialog open={!!showEdit} onOpenChange={v => { if (!v) setShowEdit(null); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" aria-describedby="edit-prop-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Edit className="w-5 h-5" />Edit Proposal — {showEdit?.proposal_number}</DialogTitle>
            <DialogDescription id="edit-prop-desc">Update proposal details and pricing</DialogDescription>
          </DialogHeader>
          {showEdit && (
            <div className="space-y-4">
              <div><Label>Title</Label><Input value={showEdit.title || ""} onChange={e => setShowEdit(p => ({ ...p, title: e.target.value }))} /></div>
              <div><Label>Summary</Label><Textarea value={showEdit.summary || ""} onChange={e => setShowEdit(p => ({ ...p, summary: e.target.value }))} rows={2} /></div>
              <div><Label>Scope of Work</Label><Textarea value={showEdit.scope_of_work || ""} onChange={e => setShowEdit(p => ({ ...p, scope_of_work: e.target.value }))} rows={3} /></div>
              <Separator />
              <Label className="text-sm font-medium">Pricing</Label>
              <LIEditor items={showEdit.line_items || []} setter={setShowEdit} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEdit(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save Changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
