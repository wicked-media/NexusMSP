import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle, History, Play, Plus, Terminal } from "lucide-react";
import { toast } from "sonner";
import HeroTile from "@/components/HeroTile";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";

export default function ScriptTicketPage() {
  const { token } = useAuth();
  const [scripts, setScripts] = useState([]);
  const [executions, setExecutions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", trigger: "", action: "create_ticket", ticket_priority: "P2", script_content: "" });
  useEffect(() => {
    const fetchData = async () => {
      try {
        const headers = { Authorization: `Bearer ${token}` };
        const [scriptsResponse, executionsResponse] = await Promise.all([
          axios.get(`${API}/script-ticket/scripts`, { headers }),
          axios.get(`${API}/script-ticket/executions`, { headers }),
        ]);
        setScripts(scriptsResponse.data || []);
        setExecutions(executionsResponse.data || []);
      } catch (e) { toast.error("Script-to-ticket workspace could not be loaded"); }
      setLoading(false);
    };
    fetchData();
  }, [token]);

  const createIntegration = async event => {
    event.preventDefault();
    if (!form.name.trim() || !form.trigger.trim() || !form.script_content.trim()) return;
    setSaving(true);
    try {
      const { data } = await axios.post(`${API}/script-ticket/scripts`, form, { headers: { Authorization: `Bearer ${token}` } });
      setScripts(current => [data, ...current]);
      setForm({ name: "", description: "", trigger: "", action: "create_ticket", ticket_priority: "P2", script_content: "" });
      setCreateOpen(false);
      toast.success("Script integration created");
    } catch {
      toast.error("Could not create the script integration");
    } finally { setSaving(false); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;

  return (
    <div className="space-y-6" data-testid="script-ticket-page">
      <OperationalPageHeader eyebrow="Automation controls" title="Script-to-Ticket Integration" description="Turn known signals into accountable ticket work, with the trigger, action and execution history kept together." icon={Terminal} tone="violet" actions={<Button size="sm" onClick={() => setCreateOpen(true)} data-testid="create-script-integration"><Plus className="mr-1.5 h-4 w-4" />New integration</Button>} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <HeroTile label="Script integrations" value={scripts.length} icon={Terminal} glow="violet" subtitle="Ticket-aware automations" testId="script-ticket-integrations" />
        <HeroTile label="Total executions" value={scripts.reduce((a, s) => a + (s.executions || 0), 0)} icon={Play} glow="sky" subtitle="Recorded script runs" testId="script-ticket-executions" />
        <HeroTile label="Active" value={scripts.filter(s => s.enabled).length} icon={CheckCircle} glow="emerald" subtitle="Enabled integrations" testId="script-ticket-active" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
      {scripts.map(s => (
        <Card key={s.id} className="border-border/60 transition-shadow hover:shadow-md" data-testid={`script-${s.id}`}>
          <CardContent className="pt-4">
            <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{s.name}</h3><Badge variant={s.enabled ? "default" : "secondary"} className={s.enabled ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/15" : ""}>{s.enabled ? "Active" : "Paused"}</Badge>{s.ticket_priority && <Badge variant="outline">{s.ticket_priority}</Badge>}</div>
            <p className="text-sm text-muted-foreground mt-1">{s.description}</p>
            <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3"><span className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">Trigger <code className="ml-1 font-medium text-foreground">{s.trigger}</code></span><span className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">Action <strong className="ml-1 font-medium text-foreground">{String(s.action || "").replace(/_/g, " ")}</strong></span><span className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">Runs <strong className="ml-1 font-medium text-foreground">{s.executions || 0}</strong></span></div>
            {s.script_content && <pre className="mt-3 p-3 bg-muted rounded-lg text-xs overflow-x-auto font-mono">{s.script_content}</pre>}
          </CardContent>
        </Card>
      ))}
        </div>
        <Card className="h-fit border-border/60"><CardContent className="pt-4"><div className="mb-3 flex items-center gap-2"><History className="h-4 w-4 text-violet-400" /><div><h2 className="text-sm font-semibold">Recent execution</h2><p className="text-xs text-muted-foreground">Latest ticket automation activity</p></div></div>{executions.length ? <div className="space-y-3">{executions.slice(0, 5).map(execution => <div key={execution.id} className="border-l-2 border-violet-400/60 pl-3 text-xs"><p className="font-medium">{execution.script_name || execution.script_id || "Script run"}</p><p className="mt-0.5 text-muted-foreground">{execution.ticket_id ? `Ticket ${execution.ticket_id}` : execution.result || "Recorded"}</p><p className="mt-1 text-[10px] text-muted-foreground">{execution.executed_at ? new Date(execution.executed_at).toLocaleString() : "Awaiting first execution"}</p></div>)}</div> : <div className="rounded-lg border border-dashed border-border/70 px-4 py-8 text-center text-xs text-muted-foreground">Execution history will appear here as scripts create or update tickets.</div>}</CardContent></Card>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <NexusWorkflowDialog eyebrow="Automation controls" title="Create script integration" description="Define a reliable signal, then tell Nexus exactly how the resulting ticket work should begin." icon={Terminal} tone="violet" footer={<><Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button><Button form="script-integration-form" type="submit" disabled={saving} data-testid="save-script-integration">{saving ? "Creating…" : "Create integration"}</Button></>}>
          <form id="script-integration-form" onSubmit={createIntegration} className="space-y-4"><div className="space-y-2"><Label>Name</Label><Input value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} placeholder="Disk space alert to ticket" required /></div><div className="space-y-2"><Label>Purpose</Label><Input value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} placeholder="What the technician should expect" /></div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Trigger</Label><Input value={form.trigger} onChange={event => setForm(current => ({ ...current, trigger: event.target.value }))} placeholder="disk_space_alert" required /></div><div className="space-y-2"><Label>Ticket priority</Label><Input value={form.ticket_priority} onChange={event => setForm(current => ({ ...current, ticket_priority: event.target.value.toUpperCase() }))} placeholder="P2" /></div></div><div className="space-y-2"><Label>Action</Label><Input value={form.action} onChange={event => setForm(current => ({ ...current, action: event.target.value }))} placeholder="create_ticket" required /></div><div className="space-y-2"><Label>Script content</Label><Textarea value={form.script_content} onChange={event => setForm(current => ({ ...current, script_content: event.target.value }))} placeholder="New-NexusOpsTicket ..." className="min-h-36 font-mono text-xs" required /></div></form>
        </NexusWorkflowDialog>
      </Dialog>
    </div>
  );
}
