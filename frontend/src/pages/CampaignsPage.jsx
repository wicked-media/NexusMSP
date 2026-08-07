import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Mail, Plus, Send, Trash2, Loader2, RefreshCw, Copy } from "lucide-react";

export default function CampaignsPage({ embedded = false }) {
  const { token } = useAuth();
  const [campaigns, setCampaigns] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", subject: "", body: "", type: "maintenance", recipients: "all" });
  const headers = { Authorization: `Bearer ${token}` };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [cRes, tRes] = await Promise.all([
        axios.get(`${API}/campaigns`, { headers: { Authorization: `Bearer ${token}` } }),
        axios.get(`${API}/campaigns/templates`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      setCampaigns(cRes.data);
      setTemplates(tRes.data);
    } catch { toast.error("Failed to load campaigns"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const createCampaign = async () => {
    try { await axios.post(`${API}/campaigns`, form, { headers }); toast.success("Campaign created"); setShowCreate(false); fetchAll(); }
    catch { toast.error("Failed to create"); }
  };

  const sendCampaign = async (id) => {
    try {
      const res = await axios.post(`${API}/campaigns/${id}/send`, {}, { headers });
      toast.success(res.data.message);
      fetchAll();
    } catch { toast.error("Failed to send"); }
  };

  const deleteCampaign = async (id) => {
    try { await axios.delete(`${API}/campaigns/${id}`, { headers }); toast.success("Deleted"); fetchAll(); }
    catch { toast.error("Failed"); }
  };

  const applyTemplate = (t) => {
    setForm({ ...form, name: t.name, subject: t.subject, body: t.body, type: t.type });
    setShowCreate(true);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="space-y-5" data-testid="campaigns-page">
      {!embedded && (
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3"><Mail className="w-8 h-8 text-pink-400" />Email Campaigns</h1>
            <p className="text-muted-foreground">{campaigns.length} campaigns &middot; {campaigns.filter(c => c.status === "sent").length} sent</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={fetchAll}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
            <Button onClick={() => setShowCreate(true)} data-testid="create-campaign-btn"><Plus className="w-4 h-4 mr-1" />New Campaign</Button>
          </div>
        </div>
      )}

      {embedded && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 px-4 py-3">
          <div><p className="text-sm font-semibold">Email campaigns</p><p className="text-xs text-muted-foreground">{campaigns.length} campaigns &middot; {campaigns.filter(c => c.status === "sent").length} sent</p></div>
          <div className="flex gap-2"><Button variant="outline" size="sm" onClick={fetchAll}><RefreshCw className="w-3.5 h-3.5 mr-1" />Refresh</Button><Button size="sm" onClick={() => setShowCreate(true)} data-testid="create-campaign-btn"><Plus className="w-3.5 h-3.5 mr-1" />New Campaign</Button></div>
        </div>
      )}

      {/* Templates */}
      <div>
        <p className="text-xs font-bold text-muted-foreground mb-2 uppercase tracking-wider">Quick Templates</p>
        <div className="flex gap-2 overflow-x-auto">
          {templates.map((t, i) => (
            <Button key={`k-${i}`} variant="outline" size="sm" onClick={() => applyTemplate(t)} className="whitespace-nowrap" data-testid={`campaign-template-${i}`}>
              <Copy className="w-3 h-3 mr-1" />{t.name}
            </Button>
          ))}
        </div>
      </div>

      {/* Campaign list */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Campaign</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Recipients</TableHead><TableHead>Sent</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {campaigns.map(c => (
                <TableRow key={c.id}>
                  <TableCell>
                    <p className="font-medium">{c.name}</p>
                    <p className="text-xs text-muted-foreground">{c.subject}</p>
                  </TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px]">{c.type}</Badge></TableCell>
                  <TableCell>
                    <Badge className={`text-[10px] ${c.status === "sent" ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"}`}>{c.status}</Badge>
                  </TableCell>
                  <TableCell className="text-xs">{c.recipients}</TableCell>
                  <TableCell className="text-xs">{c.stats?.sent || 0} sent</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {c.status === "draft" && (
                        <Button variant="outline" size="sm" onClick={() => sendCampaign(c.id)} data-testid={`send-campaign-${c.id}`}><Send className="w-3 h-3 mr-1" />Send</Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400" onClick={() => deleteCampaign(c.id)}><Trash2 className="w-3 h-3" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {campaigns.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-12"><Mail className="w-10 h-10 mx-auto text-muted-foreground mb-2 opacity-30" /><p className="text-muted-foreground">No campaigns yet</p></TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Create Campaign</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Campaign Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} data-testid="campaign-name" /></div>
            <div><Label>Subject Line</Label><Input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Type</Label>
                <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["maintenance", "security", "newsletter", "custom"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Recipients</Label>
                <Select value={form.recipients} onValueChange={v => setForm({ ...form, recipients: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Clients</SelectItem>
                    <SelectItem value="tier:premium">Premium Only</SelectItem>
                    <SelectItem value="tier:standard">Standard Only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Body</Label><Textarea value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} rows={6} placeholder="Use {client_name}, {company_name} as variables..." /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={createCampaign} data-testid="save-campaign-btn">Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
