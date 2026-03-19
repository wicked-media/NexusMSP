import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Map, Plus, Calendar, DollarSign, ArrowRight, Trash2 } from "lucide-react";
import { toast } from "sonner";

const statusColors = { planned: "secondary", in_progress: "default", completed: "outline", cancelled: "destructive" };
const priorityColors = { high: "destructive", medium: "secondary", low: "outline" };

export default function ItRoadmapPage() {
  const { token } = useAuth();
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState("");
  const [roadmap, setRoadmap] = useState(null);
  const [allRoadmaps, setAllRoadmaps] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", category: "upgrade", target_date: "", quarter: "", estimated_cost: 0, priority: "medium" });
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    Promise.all([
      axios.get(`${API}/clients`, { headers }),
      axios.get(`${API}/it-roadmap`, { headers }),
    ]).then(([c, r]) => {
      setClients(c.data);
      setAllRoadmaps(r.data);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedClient) return;
    axios.get(`${API}/it-roadmap/${selectedClient}`, { headers }).then(r => setRoadmap(r.data)).catch(() => {});
  }, [selectedClient]);

  const addItem = async () => {
    try {
      await axios.post(`${API}/it-roadmap/${selectedClient}`, { ...form, estimated_cost: Number(form.estimated_cost) }, { headers });
      toast.success("Roadmap item added");
      setShowAdd(false);
      setForm({ title: "", description: "", category: "upgrade", target_date: "", quarter: "", estimated_cost: 0, priority: "medium" });
      const { data } = await axios.get(`${API}/it-roadmap/${selectedClient}`, { headers });
      setRoadmap(data);
    } catch { toast.error("Failed to add item"); }
  };

  const updateStatus = async (itemId, status) => {
    await axios.put(`${API}/it-roadmap/item/${itemId}`, { status }, { headers });
    const { data } = await axios.get(`${API}/it-roadmap/${selectedClient}`, { headers });
    setRoadmap(data);
    toast.success("Status updated");
  };

  const deleteItem = async (itemId) => {
    await axios.delete(`${API}/it-roadmap/item/${itemId}`, { headers });
    const { data } = await axios.get(`${API}/it-roadmap/${selectedClient}`, { headers });
    setRoadmap(data);
    toast.success("Item deleted");
  };

  return (
    <div className="space-y-6" data-testid="it-roadmap-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Client IT Roadmap Builder</h1>
          <p className="text-muted-foreground text-sm mt-1">Plan and track technology upgrades per client</p>
        </div>
        <div className="flex gap-3">
          <Select value={selectedClient} onValueChange={setSelectedClient}>
            <SelectTrigger className="w-[240px]" data-testid="roadmap-client-select">
              <SelectValue placeholder="Select client..." />
            </SelectTrigger>
            <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
          {selectedClient && (
            <Dialog open={showAdd} onOpenChange={setShowAdd}>
              <DialogTrigger asChild><Button data-testid="add-roadmap-item"><Plus className="w-4 h-4 mr-2" />Add Item</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Add Roadmap Item</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <Input placeholder="Title" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} data-testid="roadmap-title-input" />
                  <Textarea placeholder="Description" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
                  <div className="grid grid-cols-2 gap-3">
                    <Select value={form.category} onValueChange={v => setForm(p => ({ ...p, category: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["upgrade", "migration", "security", "new_service", "infrastructure", "training"].map(c => <SelectItem key={c} value={c} className="capitalize">{c.replace("_"," ")}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={form.priority} onValueChange={v => setForm(p => ({ ...p, priority: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["high","medium","low"].map(p => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Input type="date" value={form.target_date} onChange={e => setForm(p => ({ ...p, target_date: e.target.value }))} />
                    <Input placeholder="Quarter (Q1 2026)" value={form.quarter} onChange={e => setForm(p => ({ ...p, quarter: e.target.value }))} />
                  </div>
                  <Input type="number" placeholder="Estimated cost" value={form.estimated_cost} onChange={e => setForm(p => ({ ...p, estimated_cost: e.target.value }))} />
                  <Button onClick={addItem} className="w-full" data-testid="save-roadmap-item">Save</Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {!selectedClient && allRoadmaps.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Clients with Roadmaps</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Total Items</TableHead><TableHead>Upcoming</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {allRoadmaps.map(r => (
                  <TableRow key={r.client_id} className="cursor-pointer" onClick={() => setSelectedClient(r.client_id)}>
                    <TableCell className="font-medium">{r.client_name}</TableCell>
                    <TableCell>{r.total_items}</TableCell>
                    <TableCell>{r.upcoming}</TableCell>
                    <TableCell><ArrowRight className="w-4 h-4 text-muted-foreground" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {roadmap && roadmap.items && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Map className="w-4 h-4" />Roadmap for {roadmap.client?.name}</CardTitle></CardHeader>
          <CardContent>
            {roadmap.items.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No roadmap items. Add one to get started.</p>
            ) : (
              <div className="space-y-3">
                {roadmap.items.map(item => (
                  <div key={item.id} className="flex items-start justify-between p-4 border rounded-lg hover:bg-muted/30 transition-colors" data-testid={`roadmap-item-${item.id}`}>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm">{item.title}</span>
                        <Badge variant={statusColors[item.status]} className="text-xs capitalize">{item.status?.replace("_", " ")}</Badge>
                        <Badge variant={priorityColors[item.priority]} className="text-xs capitalize">{item.priority}</Badge>
                        <Badge variant="outline" className="text-xs capitalize">{item.category?.replace("_"," ")}</Badge>
                      </div>
                      {item.description && <p className="text-xs text-muted-foreground mb-1">{item.description}</p>}
                      <div className="flex gap-4 text-xs text-muted-foreground">
                        {item.target_date && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{item.target_date}</span>}
                        {item.quarter && <span>{item.quarter}</span>}
                        {item.estimated_cost > 0 && <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" />${item.estimated_cost.toLocaleString()}</span>}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Select value={item.status} onValueChange={v => updateStatus(item.id, v)}>
                        <SelectTrigger className="h-7 w-[120px] text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {["planned","in_progress","completed","cancelled"].map(s => <SelectItem key={s} value={s} className="capitalize">{s.replace("_"," ")}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteItem(item.id)}><Trash2 className="w-3 h-3 text-destructive" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
