import { useEffect, useState } from "react";
import axios from "axios";
import { API } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Link2, RefreshCw, Search, Users } from "lucide-react";
import { toast } from "sonner";

export default function TenantsTab({ token, backupStatuses }) {
  const headers = { Authorization: `Bearer ${token}` };
  const [customers, setCustomers] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");
  const [linkDialog, setLinkDialog] = useState(null);
  const [linkClientId, setLinkClientId] = useState("");

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [custRes, clientsRes] = await Promise.all([
        axios.get(`${API}/acronis/customers`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/clients`, { headers }).catch(() => ({ data: [] })),
      ]);
      setCustomers(Array.isArray(custRes.data) ? custRes.data : []);
      setClients(clientsRes.data || []);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line */ }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await axios.post(`${API}/acronis/sync`, {}, { headers });
      toast.success(`Synced ${res.data.tenants_synced} tenants · ${res.data.resources_synced} resources`);
      fetchAll();
    } catch { toast.error("Sync failed"); }
    finally { setSyncing(false); }
  };

  const handleLink = async () => {
    if (!linkDialog || !linkClientId) return;
    try {
      await axios.post(
        `${API}/acronis/customers/${linkDialog.id}/link`,
        { client_id: linkClientId, acronis_tenant_id: linkDialog.acronis_tenant_id },
        { headers }
      );
      toast.success(`Linked ${linkDialog.name}`);
      setLinkDialog(null);
      setLinkClientId("");
      fetchAll();
    } catch { toast.error("Link failed"); }
  };

  const filtered = customers.filter(c =>
    !search || (c.name || "").toLowerCase().includes(search.toLowerCase()) ||
    (c.linked_client_name || "").toLowerCase().includes(search.toLowerCase())
  );

  const tenantSummary = backupStatuses?.tenant_summary || {};

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  return (
    <div className="space-y-3" data-testid="bcc-tenants-tab">
      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search tenants or linked clients..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="tenants-search"
          />
        </div>
        <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing} data-testid="sync-acronis-btn">
          {syncing ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
          Sync Acronis
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Acronis Tenant</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Linked NexusOps Client</TableHead>
                <TableHead className="text-center">Machines</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c, i) => {
                const stats = tenantSummary[c.name] || {};
                return (
                  <TableRow key={c.id || i} data-testid={`tenant-row-${c.id}`}>
                    <TableCell className="font-medium text-sm">{c.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] capitalize">{c.kind || "customer"}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={c.enabled !== false ? "default" : "destructive"}
                        className={`text-[10px] ${c.enabled !== false ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : ""}`}
                      >
                        {c.enabled !== false ? "Active" : "Disabled"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {c.linked_client_name ? (
                        <Badge className="bg-emerald-500/10 text-emerald-300 border-emerald-500/30 border text-[10px]">
                          {c.linked_client_name}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not linked</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center text-xs">
                      {stats.total ? (
                        <div className="flex items-center justify-center gap-1.5">
                          <span className="font-mono">{stats.total}</span>
                          {stats.ok > 0 && <span className="text-emerald-400 text-[10px]">{stats.ok}✓</span>}
                          {stats.failed > 0 && <span className="text-rose-400 text-[10px]">{stats.failed}✕</span>}
                          {stats.warning > 0 && <span className="text-amber-400 text-[10px]">{stats.warning}!</span>}
                        </div>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => { setLinkDialog(c); setLinkClientId(c.linked_client_id || ""); }}
                        data-testid={`link-tenant-${c.id}`}
                      >
                        <Link2 className="w-3 h-3 mr-1" />
                        {c.linked_client_name ? "Change" : "Link"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {filtered.length === 0 && (
            <div className="py-12 text-center text-muted-foreground">
              <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">{search ? "No matching tenants" : "No tenants found"}</p>
              {!search && <p className="text-[11px] mt-1 opacity-70">Click "Sync Acronis" to pull from Cyber Cloud.</p>}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!linkDialog} onOpenChange={v => !v && setLinkDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="w-5 h-5" />Link Acronis Tenant
            </DialogTitle>
            <DialogDescription>
              Map "{linkDialog?.name}" to a NexusOps client for unified billing & reporting.
            </DialogDescription>
          </DialogHeader>
          <Select value={linkClientId} onValueChange={setLinkClientId}>
            <SelectTrigger data-testid="link-client-select"><SelectValue placeholder="Select a NexusOps client..." /></SelectTrigger>
            <SelectContent>
              {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLinkDialog(null)}>Cancel</Button>
            <Button onClick={handleLink} disabled={!linkClientId} data-testid="confirm-link-tenant">
              <Link2 className="w-4 h-4 mr-1" />Link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
