import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { API } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Loader2, Link2, RefreshCw, Search, Users } from "lucide-react";
import { toast } from "sonner";

export default function TenantsTab({ token, backupStatuses }) {
  const headers = { Authorization: `Bearer ${token}` };
  const [customers, setCustomers] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");
  const [mappingFilter, setMappingFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [linkDialog, setLinkDialog] = useState(null);
  const [linkClientId, setLinkClientId] = useState("");

  const fetchAll = useCallback(async () => {
    const requestHeaders = { Authorization: `Bearer ${token}` };
    setLoading(true);
    try {
      const [custRes, clientsRes] = await Promise.all([
        axios.get(`${API}/acronis/customers`, { headers: requestHeaders }).catch(() => ({ data: [] })),
        axios.get(`${API}/clients`, { headers: requestHeaders }).catch(() => ({ data: [] })),
      ]);
      setCustomers(Array.isArray(custRes.data) ? custRes.data : []);
      setClients(clientsRes.data || []);
    } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useEffect(() => { setPage(1); }, [search, mappingFilter]);

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

  const normalizedSearch = search.trim().toLowerCase();
  const filtered = customers.filter((customer) => {
    const matchesMapping = mappingFilter === "all"
      || (mappingFilter === "linked" && customer.linked_client_name)
      || (mappingFilter === "unlinked" && !customer.linked_client_name);
    if (!matchesMapping) return false;
    if (!normalizedSearch) return true;
    return [customer.name, customer.linked_client_name, customer.kind]
      .some((value) => String(value || "").toLowerCase().includes(normalizedSearch));
  });
  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const pagedCustomers = filtered.slice(startIndex, startIndex + pageSize);
  const rangeStart = filtered.length ? startIndex + 1 : 0;
  const rangeEnd = Math.min(startIndex + pageSize, filtered.length);

  const tenantSummary = backupStatuses?.tenant_summary || {};

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  return (
    <div className="space-y-3" data-testid="bcc-tenants-tab">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search tenants or linked clients..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="tenants-search"
            aria-label="Search Acronis tenants"
          />
        </div>
        <Select value={mappingFilter} onValueChange={setMappingFilter}>
          <SelectTrigger className="w-full sm:w-40" aria-label="Filter tenant mapping"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All mappings</SelectItem>
            <SelectItem value="linked">Linked</SelectItem>
            <SelectItem value="unlinked">Not linked</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing} data-testid="sync-acronis-btn">
          {syncing ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
          Sync Acronis
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Acronis Tenant</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Linked NexusMSP Client</TableHead>
                  <TableHead className="text-center">Machines</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedCustomers.map((c, i) => {
                  const stats = tenantSummary[c.name] || {};
                  return (
                    <TableRow key={c.id || startIndex + i} data-testid={`tenant-row-${c.id}`}>
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
          </div>
          {filtered.length === 0 && (
            <div className="py-12 text-center text-muted-foreground">
              <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">{search ? "No matching tenants" : "No tenants found"}</p>
              {!search && <p className="text-[11px] mt-1 opacity-70">Click "Sync Acronis" to pull from Cyber Cloud.</p>}
            </div>
          )}
          {filtered.length > 0 && (
            <div className="flex flex-col gap-2 border-t border-border/60 bg-muted/[0.12] px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between" data-testid="tenant-pagination">
              <span>Showing <strong className="text-foreground">{rangeStart}–{rangeEnd}</strong> of <strong className="text-foreground">{filtered.length}</strong> tenants</span>
              <div className="flex items-center justify-between gap-2 sm:justify-end">
                <span className="mr-1">Page {safePage} of {totalPages}</span>
                <Button variant="outline" size="sm" className="h-8" onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage <= 1} aria-label="Previous tenant page"><ChevronLeft className="mr-1 h-3.5 w-3.5" />Previous</Button>
                <Button variant="outline" size="sm" className="h-8" onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage >= totalPages} aria-label="Next tenant page">Next<ChevronRight className="ml-1 h-3.5 w-3.5" /></Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!linkDialog} onOpenChange={v => !v && setLinkDialog(null)}>
        <NexusWorkflowDialog
          eyebrow="Backup tenant mapping"
          title="Link Acronis tenant"
          description={`Map ${linkDialog?.name || "this Acronis tenant"} to its NexusMSP client so billing, backup assurance and audit history remain connected.`}
          icon={Link2}
          tone="cyan"
          className="max-w-xl"
          footer={<><Button variant="outline" onClick={() => setLinkDialog(null)}>Cancel</Button><Button onClick={handleLink} disabled={!linkClientId} data-testid="confirm-link-tenant"><Link2 className="w-4 h-4 mr-1" />Link tenant</Button></>}
        >
          <DialogHeader className="sr-only" aria-hidden="true">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-300">Tenant mapping</p>
            <DialogTitle className="mt-1 flex items-center gap-2 text-xl">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-sky-400/25 bg-sky-400/10"><Link2 className="h-4 w-4 text-sky-300" /></span>
              Link Acronis tenant
            </DialogTitle>
            <DialogDescription>
              Map "{linkDialog?.name}" to a NexusMSP client for unified billing, backup assurance, and audit history.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-xl border border-sky-400/15 bg-sky-400/[0.04] p-3 text-sm"><p className="font-medium">{linkDialog?.name}</p><p className="mt-1 text-xs text-muted-foreground">Select the customer responsible for this backup tenant. This mapping drives usage billing and customer-level reporting.</p></div>
            <div><label className="text-sm font-medium">NexusMSP customer</label><Select value={linkClientId} onValueChange={setLinkClientId}><SelectTrigger className="mt-1" data-testid="link-client-select"><SelectValue placeholder="Choose customer" /></SelectTrigger><SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div>
          </div>
        </NexusWorkflowDialog>
      </Dialog>
    </div>
  );
}
