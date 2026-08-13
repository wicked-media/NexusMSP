import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle, XCircle, Clock, Plus } from "lucide-react";
import { toast } from "sonner";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";

const statusColors = { pending: "secondary", approved: "default", rejected: "destructive" };

export default function ApprovalWorkflowsPage() {
  const { token } = useAuth();
  const [pending, setPending] = useState([]);
  const [all, setAll] = useState([]);
  const [workflows, setWorkflows] = useState([]);
  const [tab, setTab] = useState("pending");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ type: "general", title: "", description: "", amount: 0 });
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = () => {
    Promise.all([
      axios.get(`${API}/approvals`, { headers }),
      axios.get(`${API}/approvals/all`, { headers }),
      axios.get(`${API}/approvals/workflows`, { headers }),
    ]).then(([p, a, w]) => {
      setPending(p.data);
      setAll(a.data);
      setWorkflows(w.data);
    }).catch(() => {});
  };

  useEffect(() => { fetchData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const createApproval = async () => {
    try {
      await axios.post(`${API}/approvals`, { ...form, amount: Number(form.amount) }, { headers });
      toast.success("Approval request created");
      setShowCreate(false);
      setForm({ type: "general", title: "", description: "", amount: 0 });
      fetchData();
    } catch { toast.error("Failed to create"); }
  };

  const approve = async (id) => {
    await axios.post(`${API}/approvals/${id}/approve`, {}, { headers });
    toast.success("Approved");
    fetchData();
  };

  const reject = async (id) => {
    await axios.post(`${API}/approvals/${id}/reject`, {}, { headers });
    toast.success("Rejected");
    fetchData();
  };

  return (
    <div className="space-y-6" data-testid="approval-workflows-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Approval Workflows</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage approval requests for purchases, changes, and more</p>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild><Button data-testid="create-approval"><Plus className="w-4 h-4 mr-2" />New Request</Button></DialogTrigger>
          <NexusWorkflowDialog
            eyebrow="Governed request"
            title="Create approval request"
            description="Capture the decision, impact, and cost once so approvers have the context they need without chasing for details."
            icon={Clock}
            tone="amber"
            headerAccessory={<Badge variant="outline" className="border-amber-500/25 bg-amber-500/10 text-amber-300">Awaiting decision</Badge>}
            footer={<><Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button><Button onClick={createApproval} data-testid="submit-approval">Submit for approval</Button></>}
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <Label htmlFor="approval-request-type">Request type</Label>
                <Select value={form.type} onValueChange={v => setForm(p => ({ ...p, type: v }))}>
                  <SelectTrigger data-testid="approval-type-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                  {["general","purchase","device_change","contract_change","discount"].map(t => (
                    <SelectItem key={t} value={t} className="capitalize">{t.replace("_"," ")}</SelectItem>
                  ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-4 text-sm text-muted-foreground"><p className="font-medium text-foreground">Review-ready by design</p><p className="mt-1 leading-5">The request is recorded with its decision and approver, creating a durable operational trail.</p></div>
              <div className="space-y-2 sm:col-span-2"><Label htmlFor="approval-request-title">Clear request title</Label><Input id="approval-request-title" placeholder="e.g. Approve firewall replacement" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} data-testid="approval-title-input" /></div>
              <div className="space-y-2 sm:col-span-2"><Label htmlFor="approval-request-description">Business context</Label><Textarea id="approval-request-description" rows={4} placeholder="What will change, why it matters, and the outcome being requested." value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} /></div>
              <div className="space-y-2"><Label htmlFor="approval-request-amount">Amount (optional)</Label><Input id="approval-request-amount" type="number" min="0" placeholder="0.00" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} /></div>
            </div>
          </NexusWorkflowDialog>
        </Dialog>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card><CardContent className="pt-4 pb-3 text-center">
          <Clock className="w-5 h-5 mx-auto mb-1 text-amber-500" />
          <p className="text-xl font-bold text-amber-500">{pending.length}</p>
          <p className="text-xs text-muted-foreground">Pending</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <CheckCircle className="w-5 h-5 mx-auto mb-1 text-green-500" />
          <p className="text-xl font-bold text-green-500">{all.filter(a => a.status === "approved").length}</p>
          <p className="text-xs text-muted-foreground">Approved</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <XCircle className="w-5 h-5 mx-auto mb-1 text-red-500" />
          <p className="text-xl font-bold text-red-500">{all.filter(a => a.status === "rejected").length}</p>
          <p className="text-xs text-muted-foreground">Rejected</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardContent className="pt-4">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="mb-4">
              <TabsTrigger value="pending">Pending ({pending.length})</TabsTrigger>
              <TabsTrigger value="all">All Requests</TabsTrigger>
              <TabsTrigger value="workflows">Workflow Rules</TabsTrigger>
            </TabsList>

            <TabsContent value="pending">
              {pending.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No pending approvals</p>
              ) : (
                <div className="space-y-3">
                  {pending.map(a => (
                    <div key={a.id} className="flex items-start justify-between p-4 border rounded-lg" data-testid={`pending-approval-${a.id}`}>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-sm">{a.title}</span>
                          <Badge variant="outline" className="text-xs capitalize">{a.type.replace("_"," ")}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{a.description}</p>
                        <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                          <span>By: {a.requested_by}</span>
                          {a.amount > 0 && <span>${a.amount.toLocaleString()}</span>}
                          <span>{new Date(a.created_at).toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => approve(a.id)} data-testid={`approve-btn-${a.id}`}>
                          <CheckCircle className="w-4 h-4 mr-1" />Approve
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => reject(a.id)} data-testid={`reject-btn-${a.id}`}>
                          <XCircle className="w-4 h-4 mr-1" />Reject
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="all">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Title</TableHead><TableHead>Type</TableHead><TableHead>Requested By</TableHead>
                  <TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead>Decided By</TableHead><TableHead>Date</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {all.map(a => (
                    <TableRow key={a.id} data-testid={`approval-row-${a.id}`}>
                      <TableCell className="font-medium">{a.title}</TableCell>
                      <TableCell className="capitalize text-xs">{a.type.replace("_"," ")}</TableCell>
                      <TableCell className="text-sm">{a.requested_by}</TableCell>
                      <TableCell className="font-mono">{a.amount > 0 ? `$${a.amount}` : "-"}</TableCell>
                      <TableCell><Badge variant={statusColors[a.status]} className="text-xs capitalize">{a.status}</Badge></TableCell>
                      <TableCell className="text-sm">{a.decided_by || "-"}</TableCell>
                      <TableCell className="text-xs">{new Date(a.created_at).toLocaleDateString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>

            <TabsContent value="workflows">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Workflow</TableHead><TableHead>Trigger</TableHead><TableHead>Approver</TableHead><TableHead>Status</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {workflows.map(w => (
                    <TableRow key={w.id} data-testid={`workflow-${w.id}`}>
                      <TableCell className="font-medium">{w.name}</TableCell>
                      <TableCell className="text-xs font-mono">{w.trigger}</TableCell>
                      <TableCell className="capitalize">{w.approver_role}</TableCell>
                      <TableCell><Badge variant={w.enabled ? "default" : "outline"}>{w.enabled ? "Enabled" : "Disabled"}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
