import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Zap, Monitor, RefreshCw, Terminal, Shield, ScanLine, Download, Radio } from "lucide-react";
import { toast } from "sonner";

const actionIcons = { restart: RefreshCw, run_script: Terminal, deploy_patch: Shield, collect_inventory: ScanLine, install_agent: Download, force_checkin: Radio };

export default function BulkActionsPage() {
  const { token } = useAuth();
  const [devices, setDevices] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [actions, setActions] = useState([]);
  const [chosenAction, setChosenAction] = useState("");
  const [history, setHistory] = useState([]);
  const [executing, setExecuting] = useState(false);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    Promise.all([
      axios.get(`${API}/devices`, { headers }),
      axios.get(`${API}/bulk-actions/actions`, { headers }),
      axios.get(`${API}/bulk-actions/history`, { headers }),
    ]).then(([d, a, h]) => {
      setDevices(d.data);
      setActions(a.data);
      setHistory(h.data);
    }).catch(() => {});
  }, []);

  const toggle = (id) => setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const toggleAll = () => setSelected(prev => prev.size === devices.length ? new Set() : new Set(devices.map(d => d.id)));

  const execute = async () => {
    if (selected.size === 0 || !chosenAction) { toast.error("Select devices and an action"); return; }
    setExecuting(true);
    try {
      const { data } = await axios.post(`${API}/bulk-actions/execute`, { device_ids: [...selected], action: chosenAction }, { headers });
      toast.success(`Action completed: ${data.succeeded}/${data.device_count} succeeded`);
      setHistory(prev => [data, ...prev]);
      setSelected(new Set());
    } catch { toast.error("Execution failed"); }
    setExecuting(false);
  };

  return (
    <div className="space-y-6" data-testid="bulk-actions-page">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold tracking-tight">Bulk Device Actions</h1>
          <p className="text-muted-foreground text-sm mt-1">Execute actions across multiple devices at once</p></div>
        <div className="flex gap-3 items-center">
          <Badge variant="outline" className="text-sm">{selected.size} selected</Badge>
          <Select value={chosenAction} onValueChange={setChosenAction}>
            <SelectTrigger className="w-[200px]" data-testid="action-select"><SelectValue placeholder="Select action..." /></SelectTrigger>
            <SelectContent>{actions.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
          </Select>
          <Button onClick={execute} disabled={executing || selected.size === 0} data-testid="execute-bulk-action">
            <Zap className={`w-4 h-4 mr-2 ${executing ? "animate-spin" : ""}`} />{executing ? "Executing..." : "Execute"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Monitor className="w-4 h-4" />Devices</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead className="w-10"><Checkbox checked={selected.size === devices.length && devices.length > 0} onCheckedChange={toggleAll} /></TableHead>
              <TableHead>Hostname</TableHead><TableHead>Client</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>OS</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {devices.map(d => (
                <TableRow key={d.id} className={selected.has(d.id) ? "bg-primary/5" : ""} data-testid={`device-row-${d.id}`}>
                  <TableCell><Checkbox checked={selected.has(d.id)} onCheckedChange={() => toggle(d.id)} /></TableCell>
                  <TableCell className="font-medium">{d.name}</TableCell>
                  <TableCell className="text-sm">{d.client_name}</TableCell>
                  <TableCell className="capitalize text-xs">{d.device_type}</TableCell>
                  <TableCell><Badge variant={d.status === "online" ? "default" : "destructive"} className="text-xs capitalize">{d.status}</Badge></TableCell>
                  <TableCell className="text-xs">{d.os}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {history.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Action History</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Action</TableHead><TableHead>Devices</TableHead><TableHead>Succeeded</TableHead><TableHead>Failed</TableHead><TableHead>By</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
              <TableBody>
                {history.map(h => (
                  <TableRow key={h.id} data-testid={`history-${h.id}`}>
                    <TableCell className="font-medium capitalize">{h.action?.replace("_", " ")}</TableCell>
                    <TableCell>{h.device_count}</TableCell>
                    <TableCell className="text-green-500">{h.succeeded}</TableCell>
                    <TableCell className="text-red-500">{h.failed}</TableCell>
                    <TableCell className="text-sm">{h.executed_by}</TableCell>
                    <TableCell className="text-xs">{new Date(h.executed_at).toLocaleString()}</TableCell>
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
