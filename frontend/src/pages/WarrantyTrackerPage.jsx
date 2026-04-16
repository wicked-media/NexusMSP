import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Shield, AlertTriangle, Clock, CheckCircle, HelpCircle, Loader2, Search, Edit, Download, Server, Cpu, Monitor } from "lucide-react";

const statusColors = { active: "bg-emerald-500/15 text-emerald-400", expiring_soon: "bg-amber-500/15 text-amber-400", expired: "bg-red-500/15 text-red-400", unknown: "bg-slate-500/15 text-slate-400" };
const statusIcons = { active: CheckCircle, expiring_soon: Clock, expired: AlertTriangle, unknown: HelpCircle };

export default function WarrantyTrackerPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("expiring_soon");
  const [search, setSearch] = useState("");
  const [editDevice, setEditDevice] = useState(null);
  const [editDate, setEditDate] = useState("");
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = () => {
    setLoading(true);
    axios.get(`${API}/warranty/overview`, { headers }).then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateWarranty = async () => {
    if (!editDevice) return;
    try {
      await axios.put(`${API}/warranty/${editDevice.id}`, { warranty_expiry: editDate }, { headers });
      toast.success("Warranty updated");
      setEditDevice(null);
      fetchData();
    } catch { toast.error("Failed to update"); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  if (!data) return null;

  const { stats: s } = data;
  const tabData = { expiring_soon: data.expiring_soon, expired: data.expired, active: data.active, unknown: data.unknown };
  const filteredData = (tabData[tab] || []).filter(d => !search || d.hostname?.toLowerCase().includes(search.toLowerCase()) || d.client_name?.toLowerCase().includes(search.toLowerCase()));
  const manufacturers = [...new Set(Object.values(tabData).flat().map(d => d.manufacturer).filter(Boolean))];
  const mfgBreakdown = manufacturers.map(m => ({ name: m, total: Object.values(tabData).flat().filter(d => d.manufacturer === m).length, expired: data.expired.filter(d => d.manufacturer === m).length }));

  return (
    <div className="space-y-5" data-testid="warranty-tracker-page">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-rose-500 flex items-center justify-center"><Shield className="w-5 h-5 text-white" /></div>
          Hardware Warranty & Lifecycle Tracker
        </h1>
        <p className="text-muted-foreground mt-1">Track warranty expiry, refresh candidates, and manufacturer coverage across all devices</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: "Total Devices", value: s.total, icon: Monitor, color: "text-foreground" },
          { label: "Active Warranty", value: s.active, icon: CheckCircle, color: "text-emerald-400" },
          { label: "Expiring Soon", value: s.expiring_soon, icon: Clock, color: "text-amber-400", highlight: s.expiring_soon > 0 },
          { label: "Expired", value: s.expired, icon: AlertTriangle, color: "text-red-400", highlight: s.expired > 0 },
          { label: "Unknown", value: s.unknown, icon: HelpCircle, color: "text-slate-400" },
        ].map(st => (
          <Card key={st.label} className={`border-border/40 ${st.highlight ? "border-amber-500/30" : ""}`}>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-1"><p className="text-xs text-muted-foreground uppercase tracking-wider">{st.label}</p><st.icon className={`w-4 h-4 ${st.color}`} /></div>
              <p className={`text-2xl font-bold ${st.color}`}>{st.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Manufacturer Breakdown */}
      {mfgBreakdown.length > 0 && (
        <Card className="border-border/40">
          <CardHeader className="pb-2"><CardTitle className="text-sm">By Manufacturer</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {mfgBreakdown.sort((a, b) => b.total - a.total).slice(0, 8).map(m => (
                <div key={m.name} className="p-2 rounded-lg border border-border/30 text-center min-w-[100px]">
                  <p className="font-semibold text-sm">{m.name}</p>
                  <p className="text-xs text-muted-foreground">{m.total} devices</p>
                  {m.expired > 0 && <Badge className="text-[9px] bg-red-500/20 text-red-400 mt-1">{m.expired} expired</Badge>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Card className="border-border/40">
        <CardContent className="pt-4">
          <Tabs value={tab} onValueChange={setTab}>
            <div className="flex items-center justify-between mb-3">
              <TabsList>
                <TabsTrigger value="expiring_soon">Expiring Soon ({s.expiring_soon})</TabsTrigger>
                <TabsTrigger value="expired">Expired ({s.expired})</TabsTrigger>
                <TabsTrigger value="active">Active ({s.active})</TabsTrigger>
                <TabsTrigger value="unknown">Unknown ({s.unknown})</TabsTrigger>
              </TabsList>
              <div className="relative w-56"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-8 text-sm" /></div>
            </div>
            {["expiring_soon", "expired", "active", "unknown"].map(t => (
              <TabsContent key={t} value={t}>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Hostname</TableHead><TableHead>Type</TableHead><TableHead>Manufacturer</TableHead><TableHead>Model</TableHead><TableHead>Client</TableHead><TableHead>Warranty</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {filteredData.map(d => {
                      const StatusIcon = statusIcons[d.warranty_status] || HelpCircle;
                      return (
                        <TableRow key={d.id} data-testid={`warranty-row-${d.id}`}>
                          <TableCell className="font-semibold text-sm">{d.hostname}</TableCell>
                          <TableCell><Badge variant="outline" className="text-[10px] capitalize">{d.device_type}</Badge></TableCell>
                          <TableCell className="text-sm">{d.manufacturer || "—"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{d.model || "—"}</TableCell>
                          <TableCell className="text-sm">{d.client_name}</TableCell>
                          <TableCell>
                            {d.warranty_expiry ? <span className="text-sm">{new Date(d.warranty_expiry).toLocaleDateString()}</span> : <span className="text-muted-foreground text-xs">Not set</span>}
                            {d.days_left !== undefined && <Badge className="ml-1 text-[9px] bg-amber-500/20 text-amber-400">{d.days_left}d left</Badge>}
                            {d.days_expired !== undefined && <Badge className="ml-1 text-[9px] bg-red-500/20 text-red-400">{d.days_expired}d ago</Badge>}
                          </TableCell>
                          <TableCell><Badge className={`text-[10px] ${statusColors[d.warranty_status]}`}><StatusIcon className="w-3 h-3 mr-1" />{d.warranty_status?.replace("_", " ")}</Badge></TableCell>
                          <TableCell><Button variant="ghost" size="sm" className="h-7" onClick={() => { setEditDevice(d); setEditDate(d.warranty_expiry?.slice(0, 10) || ""); }}><Edit className="w-3 h-3" /></Button></TableCell>
                        </TableRow>
                      );
                    })}
                    {filteredData.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No devices in this category</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={!!editDevice} onOpenChange={() => setEditDevice(null)}>
        <DialogContent aria-describedby="edit-warranty-desc">
          <DialogHeader><DialogTitle>Update Warranty</DialogTitle><DialogDescription id="edit-warranty-desc">Set warranty expiry for {editDevice?.hostname}</DialogDescription></DialogHeader>
          <div><label className="text-sm font-medium">Warranty Expiry Date</label><Input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} className="mt-1" /></div>
          <DialogFooter><Button variant="outline" onClick={() => setEditDevice(null)}>Cancel</Button><Button onClick={updateWarranty}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
