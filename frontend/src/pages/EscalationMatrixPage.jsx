import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog } from "@/components/ui/dialog";
import { MetricStrip, MetricTile } from "@/components/design-system";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { AlertTriangle, Bell, RefreshCw, Settings, ShieldCheck, Zap } from "lucide-react";
import { toast } from "sonner";

export default function EscalationMatrixPage() {
  const { token } = useAuth();
  const [rules, setRules] = useState([]);
  const [logs, setLogs] = useState([]);
  const [tab, setTab] = useState("rules");
  const [checking, setChecking] = useState(false);
  const [checkConfirmationOpen, setCheckConfirmationOpen] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = () => {
    Promise.all([
      axios.get(`${API}/escalation-matrix/rules`, { headers }),
      axios.get(`${API}/escalation-matrix/log`, { headers }),
    ]).then(([r, l]) => { setRules(r.data); setLogs(l.data); }).catch(() => {});
  };

  useEffect(() => { fetchData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const runCheck = async () => {
    setChecking(true);
    try {
      const { data } = await axios.post(`${API}/escalation-matrix/check`, {}, { headers });
      toast.success(`Checked ${data.checked_tickets} tickets, escalated ${data.escalated}`);
      fetchData();
    } catch { toast.error("Escalation check failed. Nothing was changed."); }
    setChecking(false);
  };

  const toggleRule = async (rule) => {
    try {
      await axios.put(`${API}/escalation-matrix/rules/${rule.id}`, { enabled: !rule.enabled }, { headers });
      toast.success(`${rule.name} ${rule.enabled ? "paused" : "activated"}`);
      fetchData();
    } catch {
      toast.error(`Couldn't update ${rule.name}`);
    }
  };

  return (
    <div className="space-y-6" data-testid="escalation-matrix-page">
      <div className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-gradient-to-br from-violet-500/[0.10] via-background to-background p-5 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-violet-400">Service desk guardrail</p>
          <h1 className="text-2xl font-bold tracking-tight">Escalation Matrix</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Keep ownership visible when a ticket needs a faster response. Review the rules, then run a controlled check.</p>
        </div>
        <Button onClick={() => setCheckConfirmationOpen(true)} disabled={checking} data-testid="run-escalation-check">
          <Zap className="mr-2 h-4 w-4" />Run escalation check
        </Button>
      </div>

      <MetricStrip columns={3}>
        <MetricTile label="Escalation rules" value={rules.length} accent="violet" icon={<Settings className="w-2.5 h-2.5 text-violet-400" />} testid="escalation-metric-rules" />
        <MetricTile label="Active rules" value={rules.filter(r => r.enabled).length} accent="emerald" icon={<Zap className="w-2.5 h-2.5 text-emerald-400" />} testid="escalation-metric-active" />
        <MetricTile label="Escalations" value={logs.length} accent="amber" icon={<Bell className="w-2.5 h-2.5 text-amber-400" />} testid="escalation-metric-log" />
      </MetricStrip>

      <Card className="border-border/60 shadow-sm">
        <CardContent className="pt-4">
          <Tabs value={tab} onValueChange={setTab}>
            <div className="mb-4 flex flex-col gap-3 border-b border-border/60 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div><p className="text-sm font-semibold">Escalation control</p><p className="text-xs text-muted-foreground">Rules define what changes; the activity log proves what happened.</p></div>
              <TabsList><TabsTrigger value="rules">Rules ({rules.length})</TabsTrigger><TabsTrigger value="log">Activity ({logs.length})</TabsTrigger></TabsList>
            </div>
            <TabsContent value="rules">
              <Table>
                <TableHeader><TableRow><TableHead>Rule</TableHead><TableHead>Trigger</TableHead><TableHead>Priority</TableHead><TableHead>Time Threshold</TableHead><TableHead>Escalate To</TableHead><TableHead>Notify</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
                <TableBody>
                  {rules.map(r => (
                    <TableRow key={r.id} data-testid={`rule-${r.id}`}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-xs font-mono">{r.trigger}</TableCell>
                      <TableCell className="capitalize text-xs">{r.priority}</TableCell>
                      <TableCell>{r.time_threshold_minutes}min</TableCell>
                      <TableCell>{r.escalate_to}</TableCell>
                      <TableCell className="text-xs">{r.notification}</TableCell>
                       <TableCell><Badge variant={r.enabled ? "default" : "outline"} className={r.enabled ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/15" : ""}>{r.enabled ? "Active" : "Paused"}</Badge></TableCell>
                       <TableCell className="text-right"><Button variant="outline" size="sm" onClick={() => toggleRule(r)}>{r.enabled ? "Pause rule" : "Activate rule"}</Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>
            <TabsContent value="log">
              <Table>
                <TableHeader><TableRow><TableHead>Ticket</TableHead><TableHead>Client</TableHead><TableHead>Rule</TableHead><TableHead>Escalated To</TableHead><TableHead>Reason</TableHead><TableHead>Time</TableHead></TableRow></TableHeader>
                <TableBody>
                  {logs.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No escalations yet</TableCell></TableRow> :
                    logs.map(l => (
                      <TableRow key={l.id} data-testid={`esc-log-${l.id}`}>
                        <TableCell className="font-mono text-xs">{l.ticket_id}</TableCell>
                        <TableCell>{l.client_name}</TableCell>
                        <TableCell>{l.rule_name}</TableCell>
                        <TableCell>{l.escalate_to}</TableCell>
                        <TableCell className="text-xs">{l.reason}</TableCell>
                        <TableCell className="text-xs">{new Date(l.escalated_at).toLocaleString()}</TableCell>
                      </TableRow>
                    ))
                  }
                </TableBody>
              </Table>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={checkConfirmationOpen} onOpenChange={setCheckConfirmationOpen}>
        <NexusWorkflowDialog
          eyebrow="Escalation control"
          title="Run escalation check"
          description="Nexus will evaluate open tickets against active rules and apply only the escalations that match. Every action will appear in the activity log."
          icon={AlertTriangle}
          tone="amber"
          footer={<><Button variant="outline" onClick={() => setCheckConfirmationOpen(false)}>Cancel</Button><Button onClick={async () => { setCheckConfirmationOpen(false); await runCheck(); }} disabled={checking} data-testid="confirm-escalation-check"><RefreshCw className={`mr-2 h-4 w-4 ${checking ? "animate-spin" : ""}`} />{checking ? "Checking…" : "Run check"}</Button></>}
        >
          <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-4">
            <div className="flex gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" /><div><p className="text-sm font-semibold">Safe, auditable escalation</p><p className="mt-1 text-sm leading-6 text-muted-foreground">This does not close tickets or notify customers directly. It applies the configured ownership and notification rules, then records the reason and destination for review.</p></div></div>
          </div>
        </NexusWorkflowDialog>
      </Dialog>
    </div>
  );
}
