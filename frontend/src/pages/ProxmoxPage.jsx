import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Server, Play, Square, RotateCcw, Power, RefreshCw, CheckCircle, XCircle, Archive, Calendar, Loader2 } from "lucide-react";

export default function ProxmoxPage() {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [nodes, setNodes] = useState([]);
  const [vms, setVms] = useState([]);
  const [backups, setBackups] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [backupDialog, setBackupDialog] = useState(false);
  const [backupForm, setBackupForm] = useState({ vm_id: "", vm_name: "", type: "full", storage: "local-zfs", retention_days: 30 });
  const [scheduleDialog, setScheduleDialog] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({ name: "", schedule: "0 2 * * *", type: "full", storage: "local-zfs", retention_days: 30, vms: [] });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [nRes, vRes, bRes, sRes] = await Promise.all([
        axios.get(`${API}/proxmox/nodes`, { headers }),
        axios.get(`${API}/proxmox/vms`, { headers }),
        axios.get(`${API}/proxmox/backups`, { headers }),
        axios.get(`${API}/proxmox/backup-schedules`, { headers }),
      ]);
      setNodes(nRes.data); setVms(vRes.data); setBackups(bRes.data); setSchedules(sRes.data);
    } catch { toast.error("Failed to load Proxmox data"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchData(); }, [fetchData]);

  const handleVmAction = async (vmId, action) => {
    setActionLoading(`${vmId}-${action}`);
    try {
      await axios.post(`${API}/proxmox/vms/${vmId}/action`, { action }, { headers });
      toast.success(`VM ${action} executed`);
      fetchData();
    } catch { toast.error(`Failed to ${action} VM`); }
    finally { setActionLoading(null); }
  };

  const handleCreateBackup = async () => {
    try { await axios.post(`${API}/proxmox/backups`, backupForm, { headers }); toast.success("Backup started"); setBackupDialog(false); fetchData(); } catch { toast.error("Failed"); }
  };

  const handleCreateSchedule = async () => {
    try { await axios.post(`${API}/proxmox/backup-schedules`, scheduleForm, { headers }); toast.success("Schedule created"); setScheduleDialog(false); fetchData(); } catch { toast.error("Failed"); }
  };

  const statusColor = { running: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20", stopped: "bg-red-500/10 text-red-500 border-red-500/20", suspended: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20" };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-bold tracking-tight">Proxmox</h1><p className="text-muted-foreground">Virtual machine management & backups</p></div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchData}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
          <Button variant="outline" onClick={() => setScheduleDialog(true)} data-testid="create-schedule-btn"><Calendar className="w-4 h-4 mr-1" />Schedule</Button>
          <Button onClick={() => setBackupDialog(true)} data-testid="create-backup-btn"><Archive className="w-4 h-4 mr-1" />New Backup</Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {nodes.map(n => (
          <Card key={n.id} className={n.status === "warning" ? "border-yellow-500/30" : ""}><CardContent className="pt-4">
            <div className="flex items-center justify-between mb-3"><div className="flex items-center gap-2"><Server className="w-5 h-5 text-blue-500" /><span className="font-semibold">{n.name}</span></div><Badge className={n.status === "online" ? "bg-emerald-500/10 text-emerald-500" : "bg-yellow-500/10 text-yellow-500"}>{n.status}</Badge></div>
            <div className="grid grid-cols-3 gap-2 text-sm"><div><p className="text-[10px] text-muted-foreground">CPU</p><p className="font-medium">{n.cpu_usage}%</p></div><div><p className="text-[10px] text-muted-foreground">RAM</p><p className="font-medium">{n.memory_usage}%</p></div><div><p className="text-[10px] text-muted-foreground">Disk</p><p className="font-medium">{n.disk_usage}%</p></div></div>
            <p className="text-xs text-muted-foreground mt-2">{n.vm_count} VMs | {n.ip}</p>
          </CardContent></Card>
        ))}
      </div>

      <Tabs defaultValue="vms">
        <TabsList><TabsTrigger value="vms">Virtual Machines ({vms.length})</TabsTrigger><TabsTrigger value="backups">Backups ({backups.length})</TabsTrigger><TabsTrigger value="schedules">Schedules ({schedules.length})</TabsTrigger></TabsList>

        <TabsContent value="vms">
          <Table>
            <TableHeader><TableRow><TableHead>VM</TableHead><TableHead>Node</TableHead><TableHead>Client</TableHead><TableHead>OS</TableHead><TableHead>vCPU</TableHead><TableHead>RAM</TableHead><TableHead>IP</TableHead><TableHead>Backup</TableHead><TableHead className="w-[200px]">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {vms.map(vm => (
                <TableRow key={vm.id} data-testid={`vm-row-${vm.id}`}>
                  <TableCell><div className="flex items-center gap-2"><div className={`w-2 h-2 rounded-full ${vm.status === "running" ? "bg-emerald-500" : vm.status === "stopped" ? "bg-red-500" : "bg-yellow-500"}`} /><div><p className="font-medium">{vm.name}</p><p className="text-[10px] text-muted-foreground">ID: {vm.vmid} | {vm.type?.toUpperCase()}</p></div><Badge className={statusColor[vm.status] + " text-[9px]"}>{vm.status}</Badge></div></TableCell>
                  <TableCell className="text-xs">{vm.node_name}</TableCell>
                  <TableCell className="text-sm">{vm.client_name}</TableCell>
                  <TableCell className="text-xs">{vm.os}</TableCell>
                  <TableCell>{vm.vcpu}</TableCell>
                  <TableCell>{vm.ram_gb}GB</TableCell>
                  <TableCell className="text-xs font-mono">{vm.ip_address}</TableCell>
                  <TableCell>{vm.backup_enabled ? <Badge className="bg-emerald-500/10 text-emerald-500 text-[9px]">{vm.backup_schedule}</Badge> : <Badge className="bg-red-500/10 text-red-500 text-[9px]">off</Badge>}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {vm.status !== "running" && <Button size="sm" className="h-7 bg-emerald-600 hover:bg-emerald-700 text-[11px] px-2.5 gap-1" onClick={() => handleVmAction(vm.id, "start")} disabled={!!actionLoading} data-testid={`start-vm-${vm.id}`}>{actionLoading === `${vm.id}-start` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}Start</Button>}
                      {vm.status === "running" && <>
                        <Button size="sm" variant="outline" className="h-7 text-[11px] px-2 text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/10 gap-1" onClick={() => handleVmAction(vm.id, "reboot")} disabled={!!actionLoading} data-testid={`reboot-vm-${vm.id}`}><RotateCcw className="w-3 h-3" />Reboot</Button>
                        <Button size="sm" variant="outline" className="h-7 text-[11px] px-2 text-blue-400 border-blue-500/30 hover:bg-blue-500/10 gap-1" onClick={() => handleVmAction(vm.id, "shutdown")} disabled={!!actionLoading} data-testid={`shutdown-vm-${vm.id}`}><Power className="w-3 h-3" />Shutdown</Button>
                        <Button size="sm" variant="outline" className="h-7 text-[11px] px-2 text-red-400 border-red-500/30 hover:bg-red-500/10 gap-1" onClick={() => handleVmAction(vm.id, "stop")} disabled={!!actionLoading} data-testid={`stop-vm-${vm.id}`}><Square className="w-3 h-3" />Stop</Button>
                      </>}
                      <Button size="sm" variant="outline" className="h-7 text-[11px] px-2 gap-1" onClick={() => { setBackupForm({ vm_id: vm.id, vm_name: vm.name, type: "full", storage: "local-zfs", retention_days: 30 }); setBackupDialog(true); }} data-testid={`backup-vm-${vm.id}`}><Archive className="w-3 h-3" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="backups">
          <Table>
            <TableHeader><TableRow><TableHead>VM</TableHead><TableHead>Type</TableHead><TableHead>Size</TableHead><TableHead>Duration</TableHead><TableHead>Storage</TableHead><TableHead>Status</TableHead><TableHead>Verified</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
            <TableBody>
              {backups.map(b => (
                <TableRow key={b.id}><TableCell className="font-medium">{b.vm_name}</TableCell><TableCell><Badge variant="outline" className="text-[10px] capitalize">{b.type}</Badge></TableCell><TableCell>{b.size_gb} GB</TableCell><TableCell>{b.duration_minutes}m</TableCell><TableCell className="text-xs font-mono">{b.storage}</TableCell><TableCell><Badge className={b.status === "completed" ? "bg-emerald-500/10 text-emerald-500" : b.status === "running" ? "bg-blue-500/10 text-blue-500" : "bg-red-500/10 text-red-500"}>{b.status}</Badge></TableCell><TableCell>{b.verified ? <CheckCircle className="w-4 h-4 text-emerald-500" /> : <XCircle className="w-4 h-4 text-muted-foreground" />}</TableCell><TableCell className="text-xs">{b.created_at?.substring(0, 16).replace("T", " ")}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="schedules">
          <div className="space-y-3">
            {schedules.map(s => (
              <Card key={s.id}><CardContent className="pt-4 flex items-center justify-between"><div><div className="flex items-center gap-2"><span className="font-medium">{s.name}</span><Badge variant="outline" className={s.enabled ? "text-emerald-500" : "text-muted-foreground"}>{s.enabled ? "Active" : "Disabled"}</Badge><Badge variant="outline" className="text-[10px] capitalize">{s.type}</Badge></div><p className="text-xs text-muted-foreground mt-1">Cron: {s.schedule} | Storage: {s.storage} | Retention: {s.retention_days}d | {s.vms?.length || 0} VMs</p></div>{s.last_run && <span className="text-xs text-muted-foreground">Last: {s.last_run.substring(0, 16).replace("T", " ")}</span>}</CardContent></Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={backupDialog} onOpenChange={setBackupDialog}>
        <DialogContent><DialogHeader><DialogTitle>Create Backup</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>VM</Label><Select value={backupForm.vm_id} onValueChange={v => { const vm = vms.find(x => x.id === v); setBackupForm({ ...backupForm, vm_id: v, vm_name: vm?.name || "" }); }}><SelectTrigger data-testid="backup-vm-select"><SelectValue placeholder="Select VM" /></SelectTrigger><SelectContent>{vms.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid grid-cols-2 gap-3"><div><Label>Type</Label><Select value={backupForm.type} onValueChange={v => setBackupForm({ ...backupForm, type: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="full">Full</SelectItem><SelectItem value="incremental">Incremental</SelectItem><SelectItem value="differential">Differential</SelectItem></SelectContent></Select></div><div><Label>Retention (days)</Label><Input type="number" value={backupForm.retention_days} onChange={e => setBackupForm({ ...backupForm, retention_days: parseInt(e.target.value) || 30 })} /></div></div>
          </div>
          <DialogFooter><Button onClick={handleCreateBackup} data-testid="submit-backup-btn"><Archive className="w-4 h-4 mr-1" />Create Backup</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={scheduleDialog} onOpenChange={setScheduleDialog}>
        <DialogContent><DialogHeader><DialogTitle>Create Backup Schedule</DialogTitle></DialogHeader>
          <div className="space-y-3"><div><Label>Name</Label><Input value={scheduleForm.name} onChange={e => setScheduleForm({ ...scheduleForm, name: e.target.value })} /></div><div className="grid grid-cols-2 gap-3"><div><Label>Cron</Label><Input value={scheduleForm.schedule} onChange={e => setScheduleForm({ ...scheduleForm, schedule: e.target.value })} placeholder="0 2 * * *" /></div><div><Label>Type</Label><Select value={scheduleForm.type} onValueChange={v => setScheduleForm({ ...scheduleForm, type: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="full">Full</SelectItem><SelectItem value="incremental">Incremental</SelectItem></SelectContent></Select></div></div></div>
          <DialogFooter><Button onClick={handleCreateSchedule}><Calendar className="w-4 h-4 mr-1" />Create</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
