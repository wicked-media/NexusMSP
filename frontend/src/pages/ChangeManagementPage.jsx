import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GitBranch, Plus, CheckCircle, XCircle, Clock, Play, Flag } from "lucide-react";
import { toast } from "sonner";

const statusColors = { pending_review: "secondary", approved: "default", implementing: "outline", completed: "default", rejected: "destructive", rollback: "destructive" };
const riskColors = { high: "destructive", medium: "secondary", low: "outline" };

export default function ChangeManagementPage() {
  const { token } = useAuth();
  const [changes, setChanges] = useState([]);
  const [stats, setStats] = useState(null);
  const [clients, setClients] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [tab, setTab] = useState("pending_review");
  const [form, setForm] = useState({ title: "", description: "", category: "standard", risk_level: "medium", impact: "", rollback_plan: "", client_id: "", scheduled_date: "", maintenance_window: "" });
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = () => {
    Promise.all([
      axios.get(`${API}/change-management`, { headers }),
      axios.get(`${API}/change-management/stats`, { headers }),
      axios.get(`${API}/clients`, { headers }),
    ]).then(([c, s, cl]) => { setChanges(c.data); setStats(s.data); setClients(cl.data); }).catch(() => {});
  };

  useEffect(() => { fetchData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    const cl = clients.find(c => c.id === form.client_id);
    try {
      await axios.post(`${API}/change-management`, { ...form, client_name: cl?.name || "" }, { headers });
      toast.success("Change request created");
      setShowCreate(false);
      setForm({ title: "", description: "", category: "standard", risk_level: "medium", impact: "", rollback_plan: "", client_id: "", scheduled_date: "", maintenance_window: "" });
      fetchData();
    } catch { toast.error("Failed"); }
  };

  const action = async (id, act) => {
    await axios.post(`${API}/change-management/${id}/${act}`, {}, { headers });
    toast.success(`Change ${act}ed`);
    fetchData();
  };

  const filtered = tab === "all" ? changes : changes.filter(c => c.status === tab);

  return (
    <div className="space-y-6" data-testid="change-management-page">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold tracking-tight">Change Management</h1>
          <p className="text-muted-foreground text-sm mt-1">ITIL-style change requests with CAB approval</p></div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild><Button data-testid="create-change"><Plus className="w-4 h-4 mr-2" />New Change Request</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Create Change Request</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Input placeholder="Title" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} data-testid="change-title-input" />
              <Textarea placeholder="Description" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
              <div className="grid grid-cols-2 gap-3">
                <Select value={form.category} onValueChange={v => setForm(p => ({ ...p, category: v }))}><SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["standard","normal","emergency","expedited"].map(c => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent></Select>
                <Select value={form.risk_level} onValueChange={v => setForm(p => ({ ...p, risk_level: v }))}><SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["high","medium","low"].map(r => <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>)}</SelectContent></Select>
              </div>
              <Select value={form.client_id} onValueChange={v => setForm(p => ({ ...p, client_id: v }))}><SelectTrigger><SelectValue placeholder="Client (optional)" /></SelectTrigger>
                <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select>
              <Textarea placeholder="Impact assessment" value={form.impact} onChange={e => setForm(p => ({ ...p, impact: e.target.value }))} />
              <Textarea placeholder="Rollback plan" value={form.rollback_plan} onChange={e => setForm(p => ({ ...p, rollback_plan: e.target.value }))} />
              <div className="grid grid-cols-2 gap-3">
                <Input type="date" value={form.scheduled_date} onChange={e => setForm(p => ({ ...p, scheduled_date: e.target.value }))} placeholder="Scheduled Date" />
                <Input placeholder="Maintenance Window" value={form.maintenance_window} onChange={e => setForm(p => ({ ...p, maintenance_window: e.target.value }))} />
              </div>
              <Button onClick={create} className="w-full" data-testid="submit-change">Submit</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {stats && (
        <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
          <Card><CardContent className="pt-4 pb-3 text-center"><p className="text-xl font-bold">{stats.total}</p><p className="text-xs text-muted-foreground">Total</p></CardContent></Card>
          <Card><CardContent className="pt-4 pb-3 text-center"><p className="text-xl font-bold text-amber-500">{stats.pending_review}</p><p className="text-xs text-muted-foreground">Pending</p></CardContent></Card>
          <Card><CardContent className="pt-4 pb-3 text-center"><p className="text-xl font-bold text-green-500">{stats.approved}</p><p className="text-xs text-muted-foreground">Approved</p></CardContent></Card>
          <Card><CardContent className="pt-4 pb-3 text-center"><p className="text-xl font-bold text-blue-500">{stats.implementing}</p><p className="text-xs text-muted-foreground">Implementing</p></CardContent></Card>
          <Card><CardContent className="pt-4 pb-3 text-center"><p className="text-xl font-bold">{stats.completed}</p><p className="text-xs text-muted-foreground">Completed</p></CardContent></Card>
          <Card><CardContent className="pt-4 pb-3 text-center"><p className="text-xl font-bold text-red-500">{stats.rejected}</p><p className="text-xs text-muted-foreground">Rejected</p></CardContent></Card>
        </div>
      )}

      <Card>
        <CardContent className="pt-4">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="mb-4">
              <TabsTrigger value="pending_review">Pending Review</TabsTrigger>
              <TabsTrigger value="approved">Approved</TabsTrigger>
              <TabsTrigger value="implementing">Implementing</TabsTrigger>
              <TabsTrigger value="all">All Changes</TabsTrigger>
            </TabsList>
            <Table>
              <TableHeader><TableRow>
                <TableHead>ID</TableHead><TableHead>Title</TableHead><TableHead>Category</TableHead><TableHead>Risk</TableHead><TableHead>Client</TableHead><TableHead>Requested By</TableHead><TableHead>Status</TableHead><TableHead>Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filtered.length === 0 ? <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No changes in this category</TableCell></TableRow> :
                  filtered.map(c => (
                    <TableRow key={c.id} data-testid={`change-${c.id}`}>
                      <TableCell className="font-mono text-xs">{c.id}</TableCell>
                      <TableCell className="font-medium max-w-[200px] truncate">{c.title}</TableCell>
                      <TableCell><Badge variant="outline" className="capitalize text-xs">{c.category}</Badge></TableCell>
                      <TableCell><Badge variant={riskColors[c.risk_level]} className="capitalize text-xs">{c.risk_level}</Badge></TableCell>
                      <TableCell className="text-sm">{c.client_name || "-"}</TableCell>
                      <TableCell className="text-sm">{c.requested_by}</TableCell>
                      <TableCell><Badge variant={statusColors[c.status]} className="capitalize text-xs">{c.status?.replace("_", " ")}</Badge></TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {c.status === "pending_review" && <><Button size="sm" variant="default" onClick={() => action(c.id, "approve")}><CheckCircle className="w-3 h-3" /></Button><Button size="sm" variant="destructive" onClick={() => action(c.id, "reject")}><XCircle className="w-3 h-3" /></Button></>}
                          {c.status === "approved" && <Button size="sm" onClick={() => action(c.id, "implement")}><Play className="w-3 h-3" /></Button>}
                          {c.status === "implementing" && <Button size="sm" onClick={() => action(c.id, "complete")}><CheckCircle className="w-3 h-3" /></Button>}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                }
              </TableBody>
            </Table>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
