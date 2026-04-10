import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  KeyRound, Plus, Eye, EyeOff, Copy, Trash2, Loader2, RefreshCw,
  Shield, Search, Globe, User, Clock, Lock
} from "lucide-react";

export default function VaultPage() {
  const { token } = useAuth();
  const [entries, setEntries] = useState([]);
  const [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [revealed, setRevealed] = useState({});
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("passwords");
  const [form, setForm] = useState({ name: "", username: "", password: "", url: "", notes: "", category: "general", client_name: "" });
  const headers = { Authorization: `Bearer ${token}` };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [eRes, aRes] = await Promise.all([
        axios.get(`${API}/vault/entries`, { headers }),
        axios.get(`${API}/vault/audit-log`, { headers }),
      ]);
      setEntries(eRes.data);
      setAudit(aRes.data);
    } catch { toast.error("Failed to load vault"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const createEntry = async () => {
    try {
      await axios.post(`${API}/vault/entries`, form, { headers });
      toast.success("Credential saved");
      setShowCreate(false);
      setForm({ name: "", username: "", password: "", url: "", notes: "", category: "general", client_name: "" });
      fetchAll();
    } catch { toast.error("Failed to save"); }
  };

  const revealPassword = async (id) => {
    if (revealed[id]) { setRevealed(r => ({ ...r, [id]: null })); return; }
    try {
      const res = await axios.get(`${API}/vault/entries/${id}`, { headers });
      setRevealed(r => ({ ...r, [id]: res.data.password }));
      toast.success("Password revealed - access logged");
    } catch { toast.error("Failed to reveal"); }
  };

  const copyPassword = async (id) => {
    try {
      const res = await axios.get(`${API}/vault/entries/${id}`, { headers });
      await navigator.clipboard.writeText(res.data.password);
      toast.success("Copied to clipboard");
    } catch { toast.error("Failed to copy"); }
  };

  const deleteEntry = async (id) => {
    try { await axios.delete(`${API}/vault/entries/${id}`, { headers }); toast.success("Deleted"); fetchAll(); }
    catch { toast.error("Failed to delete"); }
  };

  const filtered = entries.filter(e =>
    (e.name || "").toLowerCase().includes(search.toLowerCase()) ||
    (e.username || "").toLowerCase().includes(search.toLowerCase()) ||
    (e.client_name || "").toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="space-y-5" data-testid="vault-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3"><KeyRound className="w-8 h-8 text-amber-400" />Password Vault</h1>
          <p className="text-muted-foreground">{entries.length} credentials stored &middot; Encrypted at rest</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchAll}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
          <Button onClick={() => setShowCreate(true)} data-testid="add-credential-btn"><Plus className="w-4 h-4 mr-1" />Add Credential</Button>
        </div>
      </div>

      <div className="flex gap-2 items-center">
        {["passwords", "audit"].map(t => (
          <Button key={t} variant={tab === t ? "default" : "outline"} size="sm" onClick={() => setTab(t)} className="capitalize">{t === "passwords" ? "Credentials" : "Audit Log"}</Button>
        ))}
        {tab === "passwords" && (
          <div className="ml-auto relative">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 w-60" />
          </div>
        )}
      </div>

      {tab === "passwords" && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Username</TableHead><TableHead>Password</TableHead><TableHead>URL</TableHead><TableHead>Client</TableHead><TableHead>Category</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {filtered.map(e => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium flex items-center gap-2"><Lock className="w-3 h-3 text-amber-400" />{e.name}</TableCell>
                    <TableCell className="text-sm font-mono">{e.username}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <span className="text-sm font-mono">{revealed[e.id] || "••••••••"}</span>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => revealPassword(e.id)} data-testid={`reveal-${e.id}`}>
                          {revealed[e.id] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyPassword(e.id)} data-testid={`copy-${e.id}`}><Copy className="w-3 h-3" /></Button>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">{e.url && <a href={e.url} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline flex items-center gap-1"><Globe className="w-3 h-3" />{e.url.replace(/https?:\/\//, "").slice(0, 25)}</a>}</TableCell>
                    <TableCell className="text-xs">{e.client_name || "-"}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{e.category}</Badge></TableCell>
                    <TableCell><Button variant="ghost" size="icon" className="h-6 w-6 text-red-400" onClick={() => deleteEntry(e.id)}><Trash2 className="w-3 h-3" /></Button></TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-12"><KeyRound className="w-10 h-10 mx-auto text-muted-foreground mb-2 opacity-30" /><p className="text-muted-foreground">No credentials stored yet</p></TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {tab === "audit" && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Credential</TableHead><TableHead>Action</TableHead><TableHead>By</TableHead><TableHead>When</TableHead></TableRow></TableHeader>
              <TableBody>
                {audit.map((a, i) => (
                  <TableRow key={`k-${i}`}>
                    <TableCell className="font-medium">{a.entry_name}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{a.action}</Badge></TableCell>
                    <TableCell className="text-sm">{a.accessed_by}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{a.accessed_at?.slice(0, 16)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Credential</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Client Firewall Login" data-testid="vault-name" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Username</Label><Input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} data-testid="vault-username" /></div>
              <div><Label>Password</Label><Input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} data-testid="vault-password" /></div>
            </div>
            <div><Label>URL</Label><Input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="https://..." /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Client</Label><Input value={form.client_name} onChange={e => setForm({ ...form, client_name: e.target.value })} /></div>
              <div>
                <Label>Category</Label>
                <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["general", "network", "server", "cloud", "email", "vpn", "database", "other"].map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={createEntry} data-testid="save-credential-btn">Save Credential</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
