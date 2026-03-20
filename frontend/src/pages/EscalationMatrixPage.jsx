import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, Bell, Clock, Settings, Zap } from "lucide-react";
import { toast } from "sonner";

export default function EscalationMatrixPage() {
  const { token } = useAuth();
  const [rules, setRules] = useState([]);
  const [logs, setLogs] = useState([]);
  const [tab, setTab] = useState("rules");
  const [checking, setChecking] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = () => {
    Promise.all([
      axios.get(`${API}/escalation-matrix/rules`, { headers }),
      axios.get(`${API}/escalation-matrix/log`, { headers }),
    ]).then(([r, l]) => { setRules(r.data); setLogs(l.data); }).catch(() => {});
  };

  useEffect(() => { fetchData(); }, []);

  const runCheck = async () => {
    setChecking(true);
    try {
      const { data } = await axios.post(`${API}/escalation-matrix/check`, {}, { headers });
      toast.success(`Checked ${data.checked_tickets} tickets, escalated ${data.escalated}`);
      fetchData();
    } catch { toast.error("Check failed"); }
    setChecking(false);
  };

  const toggleRule = async (rule) => {
    await axios.put(`${API}/escalation-matrix/rules/${rule.id}`, { enabled: !rule.enabled }, { headers });
    fetchData();
  };

  return (
    <div className="space-y-6" data-testid="escalation-matrix-page">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold tracking-tight">Escalation Matrix</h1>
          <p className="text-muted-foreground text-sm mt-1">Automated ticket escalation with custom rules</p></div>
        <Button onClick={runCheck} disabled={checking} data-testid="run-escalation-check">
          <Zap className={`w-4 h-4 mr-2 ${checking ? "animate-spin" : ""}`} />{checking ? "Checking..." : "Run Escalation Check"}
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card><CardContent className="pt-4 pb-3 text-center"><Settings className="w-4 h-4 mx-auto mb-1 text-primary" /><p className="text-xl font-bold">{rules.length}</p><p className="text-xs text-muted-foreground">Rules</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><p className="text-xl font-bold text-green-500">{rules.filter(r => r.enabled).length}</p><p className="text-xs text-muted-foreground">Active</p></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><Bell className="w-4 h-4 mx-auto mb-1 text-amber-500" /><p className="text-xl font-bold">{logs.length}</p><p className="text-xs text-muted-foreground">Escalations</p></CardContent></Card>
      </div>

      <Card>
        <CardContent className="pt-4">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="mb-4"><TabsTrigger value="rules">Escalation Rules</TabsTrigger><TabsTrigger value="log">Escalation Log ({logs.length})</TabsTrigger></TabsList>
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
                      <TableCell><Badge variant={r.enabled ? "default" : "outline"}>{r.enabled ? "Active" : "Off"}</Badge></TableCell>
                      <TableCell><Button variant="ghost" size="sm" onClick={() => toggleRule(r)}>{r.enabled ? "Disable" : "Enable"}</Button></TableCell>
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
    </div>
  );
}
