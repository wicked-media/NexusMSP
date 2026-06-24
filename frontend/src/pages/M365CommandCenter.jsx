import { useEffect, useState, useMemo, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  Cloud, Shield, Users, Search, Server, Eye, Sparkles, AlertTriangle, ChevronRight,
  CheckCircle2, XCircle, ExternalLink, Loader2, Wand2, RefreshCw, Plus, Trash2, Play,
  KeyRound, Lock, ShieldCheck, History, Layers, FileText, Code, ListChecks, Activity, UserMinus,
} from "lucide-react";

const SEVERITY_COLORS = {
  critical: "bg-rose-500/20 text-rose-300 border-rose-500/30",
  high: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  medium: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  low: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};

export default function M365CommandCenter() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [tab, setTab] = useState("overview");
  const [summary, setSummary] = useState(null);
  const [conn, setConn] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, c] = await Promise.all([
        axios.get(`${API}/m365/tenants/health/summary`, { headers }),
        axios.get(`${API}/m365/connection`, { headers }),
      ]);
      setSummary(s.data);
      setConn(c.data);
    } catch (e) { toast.error("M365 load failed"); }
    finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 space-y-5" data-testid="m365-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-light tracking-tight flex items-center gap-3">
            <Cloud className="w-7 h-7 text-cyan-400" />
            M365 Command Center
            <Badge variant="outline" className="text-[10px] border-cyan-500/30 text-cyan-300">CIPP-style</Badge>
            {conn?.mode === "live" ? (
              <Badge className="text-[10px] bg-emerald-500/20 text-emerald-300 border-emerald-500/30">LIVE</Badge>
            ) : (
              <Badge className="text-[10px] bg-amber-500/20 text-amber-300 border-amber-500/30">MOCK</Badge>
            )}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            CIPP-style multi-tenant M365 management — Standards engine, GDAP, universal search, MFA & Secure Score analytics.
          </p>
        </div>
        <Button variant="outline" onClick={load}><RefreshCw className="w-3.5 h-3.5 mr-1" />Refresh</Button>
      </div>

      {/* Hero KPI strip */}
      {loading || !summary ? <div className="p-12 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></div> : (
        <div className="grid grid-cols-2 md:grid-cols-7 gap-2">
          <KpiTile label="Tenants" value={summary.tenants} icon={Server} color="cyan" />
          <KpiTile label="Users" value={summary.users} icon={Users} color="violet" />
          <KpiTile label="MFA %" value={summary.avg_mfa_pct + "%"} icon={KeyRound} color="emerald" />
          <KpiTile label="Secure Score" value={summary.avg_secure_score} icon={ShieldCheck} color="sky" />
          <KpiTile label="Trend 30d" value={(summary.secure_trend >= 0 ? "+" : "") + summary.secure_trend} icon={Activity} color={summary.secure_trend >= 0 ? "emerald" : "rose"} />
          <KpiTile label="Risky Sign-ins" value={summary.risky_signins_30d} icon={AlertTriangle} color="amber" />
          <KpiTile label="GDAP Expiring" value={summary.gdap_expiring_30d} icon={History} color="rose" />
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid grid-cols-7 w-full">
          <TabsTrigger value="overview" data-testid="m365-tab-overview"><Cloud className="w-3.5 h-3.5 mr-1" />Tenants</TabsTrigger>
          <TabsTrigger value="users" data-testid="m365-tab-users"><Users className="w-3.5 h-3.5 mr-1" />Users</TabsTrigger>
          <TabsTrigger value="standards" data-testid="m365-tab-standards"><ListChecks className="w-3.5 h-3.5 mr-1" />Standards</TabsTrigger>
          <TabsTrigger value="gdap" data-testid="m365-tab-gdap"><KeyRound className="w-3.5 h-3.5 mr-1" />GDAP</TabsTrigger>
          <TabsTrigger value="security" data-testid="m365-tab-security"><Shield className="w-3.5 h-3.5 mr-1" />Security</TabsTrigger>
          <TabsTrigger value="alerts" data-testid="m365-tab-alerts"><AlertTriangle className="w-3.5 h-3.5 mr-1" />Alerts</TabsTrigger>
          <TabsTrigger value="settings" data-testid="m365-tab-settings"><Lock className="w-3.5 h-3.5 mr-1" />Connection</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-3 pt-2"><TenantsTab headers={headers} /></TabsContent>
        <TabsContent value="users" className="space-y-3 pt-2"><UsersTab headers={headers} /></TabsContent>
        <TabsContent value="standards" className="space-y-3 pt-2"><StandardsTab headers={headers} /></TabsContent>
        <TabsContent value="gdap" className="space-y-3 pt-2"><GdapTab headers={headers} /></TabsContent>
        <TabsContent value="security" className="space-y-3 pt-2"><SecurityTab headers={headers} /></TabsContent>
        <TabsContent value="alerts" className="space-y-3 pt-2"><AlertsTab headers={headers} /></TabsContent>
        <TabsContent value="settings" className="space-y-3 pt-2"><ConnectionTab headers={headers} conn={conn} onSaved={load} /></TabsContent>
      </Tabs>
    </div>
  );
}

function KpiTile({ label, value, icon: Icon, color }) {
  return (
    <Card className={`bg-gradient-to-br from-${color}-500/10 to-transparent border-${color}-500/30`}>
      <CardContent className="p-3 text-center">
        <div className={`flex items-center justify-center gap-1 text-[10px] uppercase tracking-wider text-${color}-300`}>
          <Icon className="w-3 h-3" />{label}
        </div>
        <div className={`text-xl font-light mt-1 text-${color}-200`}>{value}</div>
      </CardContent>
    </Card>
  );
}

// ─────────────── Tenants ───────────────
function TenantsTab({ headers }) {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState(null);
  const [selected, setSelected] = useState(null);
  const [brief, setBrief] = useState(null);
  const [briefLoading, setBriefLoading] = useState(false);

  useEffect(() => { axios.get(`${API}/m365/tenants`, { headers }).then(r => setTenants(r.data)).finally(() => setLoading(false)); }, [headers]);

  const runSearch = async () => {
    if (!q.trim()) { setSearch(null); return; }
    try { const r = await axios.get(`${API}/m365/search?q=${encodeURIComponent(q)}`, { headers }); setSearch(r.data); }
    catch (e) { toast.error("Search failed"); }
  };

  const openTenant = async (t) => {
    try {
      const r = await axios.get(`${API}/m365/tenants/${t.id}`, { headers });
      setSelected(r.data);
      setBriefLoading(true);
      setBrief(null);
      const br = await axios.get(`${API}/m365/tenants/${t.id}/ai-brief`, { headers });
      setBrief(br.data);
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setBriefLoading(false); }
  };

  if (loading) return <Loader2 className="w-5 h-5 animate-spin mx-auto mt-8" />;

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-3">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-cyan-400" />
            <Input placeholder="Universal search — across ALL tenants (users, domains, GDAP roles)…" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && runSearch()} data-testid="m365-search-input" />
            <Button size="sm" variant="outline" onClick={runSearch} data-testid="m365-search-btn">Search</Button>
            {search && <Button size="sm" variant="ghost" onClick={() => { setQ(""); setSearch(null); }}>Clear</Button>}
          </div>
        </CardContent>
      </Card>

      {search && (
        <Card className="border-cyan-500/30 bg-cyan-500/5">
          <CardContent className="p-3">
            <div className="text-[10px] uppercase tracking-wider text-cyan-300 mb-2 flex items-center gap-1"><Sparkles className="w-3 h-3" />Search results — {search.count}</div>
            {search.users.length > 0 && <SearchSection title="Users" items={search.users} render={u => <span>{u.display_name} · <code className="text-[10px] text-muted-foreground">{u.upn}</code> · <span className="text-[10px]">{u.tenant_name}</span></span>} />}
            {search.tenants.length > 0 && <SearchSection title="Tenants" items={search.tenants} render={t => <span>{t.name} · {t.default_domain} · Secure {t.secure_score}</span>} />}
            {search.gdap.length > 0 && <SearchSection title="GDAP roles" items={search.gdap} render={g => <span>{g.tenant_name} · {g.roles.slice(0, 3).join(", ")}{g.roles.length > 3 ? "…" : ""}</span>} />}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Tenant</TableHead><TableHead>License</TableHead><TableHead className="text-right">Users</TableHead>
              <TableHead className="text-right">MFA</TableHead><TableHead className="text-right">Secure Score</TableHead>
              <TableHead className="text-right">Trend 30d</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {tenants.map(t => (
                <TableRow key={t.id} className="hover:bg-muted/40 cursor-pointer" onClick={() => openTenant(t)} data-testid={`tenant-row-${t.id}`}>
                  <TableCell><div className="font-medium">{t.name}</div><div className="text-[10px] text-muted-foreground font-mono">{t.default_domain}</div></TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px]">{t.license_sku}</Badge></TableCell>
                  <TableCell className="text-right font-mono text-xs">{t.users_count}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{t.mfa_enrolled_pct}%</TableCell>
                  <TableCell className="text-right font-mono text-xs">{t.secure_score}/100</TableCell>
                  <TableCell className={`text-right font-mono text-xs ${t.secure_score_30d_trend >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{t.secure_score_30d_trend >= 0 ? "+" : ""}{t.secure_score_30d_trend}</TableCell>
                  <TableCell><Badge className={t.status === "warning" ? SEVERITY_COLORS.medium : SEVERITY_COLORS.low}>{t.status}</Badge></TableCell>
                  <TableCell className="text-right"><Eye className="w-3 h-3 text-muted-foreground" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Tenant detail dialog */}
      <Dialog open={!!selected} onOpenChange={(v) => { if (!v) { setSelected(null); setBrief(null); } }}>
        <DialogContent className="max-w-3xl">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><Server className="w-5 h-5 text-cyan-400" />{selected.name}</DialogTitle>
                <DialogDescription className="font-mono text-[10px]">{selected.default_domain} · {selected.tenant_id}</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-4 gap-2">
                {Object.entries({ "Users": selected.computed?.user_count, "No-MFA": selected.computed?.users_no_mfa, "Admins": selected.computed?.admins, "Secure": selected.secure_score }).map(([k, v]) =>
                  <Card key={k}><CardContent className="p-2 text-center"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</div><div className="text-lg font-medium">{v}</div></CardContent></Card>
                )}
              </div>
              <div className="grid grid-cols-5 gap-2">
                {Object.entries(selected.deep_links || {}).map(([k, v]) =>
                  <a key={k} href={v} target="_blank" rel="noopener noreferrer" className="text-[11px] text-cyan-400 hover:underline flex items-center gap-1"><ExternalLink className="w-3 h-3" />{k}</a>
                )}
              </div>
              {briefLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : brief && (
                <Card className="bg-fuchsia-500/5 border-fuchsia-500/30">
                  <CardContent className="p-3">
                    <div className="text-[10px] uppercase tracking-wider text-fuchsia-300 flex items-center gap-1"><Sparkles className="w-3 h-3" />AI Executive Brief</div>
                    <pre className="text-xs mt-2 whitespace-pre-wrap font-sans text-zinc-200">{brief.brief}</pre>
                  </CardContent>
                </Card>
              )}
              <DialogFooter><Button onClick={() => setSelected(null)}>Close</Button></DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SearchSection({ title, items, render }) {
  return (
    <div className="mb-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{title} ({items.length})</div>
      <div className="space-y-0.5">{items.map((it, i) => <div key={i} className="text-xs pl-2">{render(it)}</div>)}</div>
    </div>
  );
}

// ─────────────── Users ───────────────
function UsersTab({ headers }) {
  const [users, setUsers] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [filter, setFilter] = useState({ tenant_id: "", q: "", no_mfa: false });
  const [loading, setLoading] = useState(true);
  const [offboard, setOffboard] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter.tenant_id) params.set("tenant_id", filter.tenant_id);
    if (filter.q) params.set("q", filter.q);
    if (filter.no_mfa) params.set("no_mfa", "true");
    try {
      const [u, t] = await Promise.all([
        axios.get(`${API}/m365/users?${params}`, { headers }),
        axios.get(`${API}/m365/tenants`, { headers }),
      ]);
      setUsers(u.data); setTenants(t.data);
    } finally { setLoading(false); }
  }, [headers, filter]);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <Card>
        <CardContent className="p-3 flex items-center gap-2 flex-wrap">
          <Select value={filter.tenant_id || "all"} onValueChange={v => setFilter(f => ({ ...f, tenant_id: v === "all" ? "" : v }))}>
            <SelectTrigger className="w-56"><SelectValue placeholder="All tenants" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All tenants</SelectItem>{tenants.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
          </Select>
          <Input placeholder="Search by name / UPN / dept" className="w-72" value={filter.q} onChange={e => setFilter(f => ({ ...f, q: e.target.value }))} />
          <div className="flex items-center gap-1 text-xs"><Switch checked={filter.no_mfa} onCheckedChange={v => setFilter(f => ({ ...f, no_mfa: v }))} /> No MFA only</div>
          <span className="text-[10px] text-muted-foreground ml-auto">{users.length} users</span>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          {loading ? <Loader2 className="w-5 h-5 animate-spin my-8 mx-auto" /> : (
            <Table>
              <TableHeader><TableRow><TableHead>User</TableHead><TableHead>Tenant</TableHead><TableHead>Dept</TableHead><TableHead>MFA</TableHead><TableHead>License</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {users.slice(0, 200).map(u => (
                  <TableRow key={u.id} data-testid={`user-row-${u.id}`}>
                    <TableCell><div className="font-medium text-sm flex items-center gap-1">{u.display_name}{u.is_admin && <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-[9px] px-1">ADMIN</Badge>}</div><div className="text-[10px] text-muted-foreground font-mono">{u.upn}</div></TableCell>
                    <TableCell className="text-xs">{u.tenant_name}</TableCell>
                    <TableCell className="text-xs">{u.department}</TableCell>
                    <TableCell><Badge className={`text-[10px] ${u.mfa_method === "none" ? SEVERITY_COLORS.high : u.mfa_method === "sms" ? SEVERITY_COLORS.medium : SEVERITY_COLORS.low}`}>{u.mfa_method}</Badge></TableCell>
                    <TableCell className="text-[10px]">{u.license_sku || "—"}</TableCell>
                    <TableCell><Badge variant="outline" className={`text-[10px] ${u.account_enabled ? "text-emerald-400 border-emerald-500/30" : "text-zinc-500"}`}>{u.account_enabled ? "active" : "disabled"}</Badge></TableCell>
                    <TableCell><Button size="sm" variant="ghost" className="h-7 text-[10px] text-rose-400" onClick={() => setOffboard(u)} data-testid={`offboard-${u.id}`}><UserMinus className="w-3 h-3 mr-1" />Offboard</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <OffboardingWizard open={!!offboard} user={offboard} onClose={() => setOffboard(null)} onDone={load} headers={headers} />
    </>
  );
}

function OffboardingWizard({ open, user, onClose, onDone, headers }) {
  const [steps, setSteps] = useState({
    disable_signin: true, remove_licenses: true, hide_from_gal: true, set_ooo: true, convert_to_shared: true,
    forward_email_to_manager: false, transfer_onedrive: false,
  });
  const [ooo, setOoo] = useState("");
  const [forwardTo, setForwardTo] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      await axios.post(`${API}/m365/offboarding`, {
        user_id: user.id, tenant_id: user.tenant_id, steps,
        ooo_message: ooo || undefined,
        forward_to_upn: forwardTo || undefined,
      }, { headers });
      toast.success(`${user.display_name} offboarded`);
      onDone && onDone(); onClose();
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };

  if (!user) return null;
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl" data-testid="offboarding-wizard">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><UserMinus className="w-5 h-5 text-rose-400" />Offboard {user.display_name}</DialogTitle>
          <DialogDescription className="text-xs">{user.upn} · {user.tenant_name}</DialogDescription></DialogHeader>
        <div className="space-y-2">
          {Object.entries({
            disable_signin: "Disable sign-in",
            remove_licenses: "Remove licenses",
            hide_from_gal: "Hide from Global Address List",
            set_ooo: "Set Out-of-Office",
            convert_to_shared: "Convert mailbox to shared",
            forward_email_to_manager: "Forward email to UPN below",
            transfer_onedrive: "Transfer OneDrive to UPN below",
          }).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={steps[k]} onChange={e => setSteps(s => ({ ...s, [k]: e.target.checked }))} data-testid={`offboard-step-${k}`} />{label}</label>
          ))}
          {steps.set_ooo && <Textarea rows={2} placeholder="Out-of-office message" value={ooo} onChange={e => setOoo(e.target.value)} />}
          {(steps.forward_email_to_manager || steps.transfer_onedrive) && <Input placeholder="Forward/transfer to UPN" value={forwardTo} onChange={e => setForwardTo(e.target.value)} />}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={run} disabled={busy} className="bg-rose-500/30 text-rose-200 border border-rose-500/40 hover:bg-rose-500/40" data-testid="offboard-run-btn">{busy ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <UserMinus className="w-3 h-3 mr-1" />}Run Offboarding</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────── Standards ───────────────
function StandardsTab({ headers }) {
  const [items, setItems] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [runResult, setRunResult] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, t] = await Promise.all([
        axios.get(`${API}/m365/standards`, { headers }),
        axios.get(`${API}/m365/tenants`, { headers }),
      ]);
      setItems(s.data); setTenants(t.data);
    } finally { setLoading(false); }
  }, [headers]);
  useEffect(() => { load(); }, [load]);

  const toggle = async (s) => {
    try {
      const r = await axios.put(`${API}/m365/standards/${s.id}`, { enabled: !s.enabled, actions: !s.enabled ? ["report", "remediate"] : ["report"] }, { headers });
      setItems(prev => prev.map(x => x.id === s.id ? r.data : x));
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
  };

  const runNow = async (s) => {
    try {
      const r = await axios.post(`${API}/m365/standards/${s.id}/run`, {}, { headers });
      setRunResult(r.data);
      toast.success(`${s.name} ran across ${r.data.run.tenant_count} tenants`);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
  };

  if (loading) return <Loader2 className="w-5 h-5 animate-spin mx-auto mt-8" />;

  const byCategory = items.reduce((acc, s) => { (acc[s.category] ||= []).push(s); return acc; }, {});

  return (
    <>
      <Card className="bg-emerald-500/5 border-emerald-500/30"><CardContent className="p-3 flex items-center gap-2">
        <ListChecks className="w-4 h-4 text-emerald-400" />
        <span className="text-sm font-medium">Standards Engine</span>
        <span className="text-xs text-muted-foreground">Define golden config → schedule → drift detected → auto-remediated. {items.filter(s => s.enabled).length} of {items.length} enabled.</span>
      </CardContent></Card>

      {Object.entries(byCategory).map(([cat, arr]) => (
        <Card key={cat}>
          <CardContent className="p-3 space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{cat}</div>
            {arr.map(s => (
              <div key={s.id} className={`flex items-center gap-2 p-2 rounded border ${s.enabled ? "border-emerald-500/30 bg-emerald-500/5" : "border-zinc-800 bg-muted/20"}`} data-testid={`standard-${s.key}`}>
                <Switch checked={s.enabled} onCheckedChange={() => toggle(s)} data-testid={`standard-toggle-${s.key}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium flex items-center gap-2">{s.name}<Badge className={`text-[9px] ${SEVERITY_COLORS[s.severity]}`}>{s.severity}</Badge>{s.auto_remediate && <Badge variant="outline" className="text-[9px] text-emerald-400 border-emerald-500/30">auto-remediate</Badge>}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{s.description}</div>
                  {s.last_run_summary && <div className="text-[10px] mt-0.5 font-mono">✓ {s.last_run_summary.compliant} · ⚠ {s.last_run_summary.drifted} · 🔧 {s.last_run_summary.remediated}</div>}
                </div>
                <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => runNow(s)} data-testid={`standard-run-${s.key}`}><Play className="w-3 h-3 mr-1" />Run</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      <Dialog open={!!runResult} onOpenChange={(v) => !v && setRunResult(null)}>
        <DialogContent className="max-w-3xl">
          {runResult && (
            <>
              <DialogHeader><DialogTitle className="flex items-center gap-2"><ListChecks className="w-5 h-5 text-emerald-400" />{runResult.run.standard_name}</DialogTitle>
                <DialogDescription className="text-xs">Ran on {runResult.run.tenant_count} tenants · {new Date(runResult.run.started_at).toLocaleString()}</DialogDescription></DialogHeader>
              <div className="grid grid-cols-3 gap-2">
                <Card><CardContent className="p-2 text-center"><div className="text-[10px] text-emerald-300 uppercase">Compliant</div><div className="text-xl">{runResult.run.summary.compliant}</div></CardContent></Card>
                <Card><CardContent className="p-2 text-center"><div className="text-[10px] text-amber-300 uppercase">Drifted</div><div className="text-xl">{runResult.run.summary.drifted}</div></CardContent></Card>
                <Card><CardContent className="p-2 text-center"><div className="text-[10px] text-violet-300 uppercase">Remediated</div><div className="text-xl">{runResult.run.summary.remediated}</div></CardContent></Card>
              </div>
              <ScrollArea className="max-h-[40vh]"><div className="space-y-0.5">
                {runResult.results.map(r => (
                  <div key={r.id} className="flex items-center justify-between text-xs px-2 py-1 border-b border-zinc-900/60">
                    <span>{r.tenant_name}</span>
                    <span className="flex items-center gap-2">
                      {r.compliant ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <XCircle className="w-3 h-3 text-rose-400" />}
                      <Badge variant="outline" className="text-[9px]">{r.action}</Badge>
                    </span>
                  </div>
                ))}
              </div></ScrollArea>
              <DialogFooter><Button onClick={() => setRunResult(null)}>Close</Button></DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─────────────── GDAP ───────────────
function GdapTab({ headers }) {
  const [items, setItems] = useState([]);
  const [roleTemplates, setRoleTemplates] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [g, r] = await Promise.all([
        axios.get(`${API}/m365/gdap`, { headers }),
        axios.get(`${API}/m365/gdap/role-templates`, { headers }),
      ]);
      setItems(g.data); setRoleTemplates(r.data);
    } finally { setLoading(false); }
  }, [headers]);
  useEffect(() => { load(); }, [load]);

  const extend = async (g) => {
    if (!window.confirm(`Extend GDAP for ${g.tenant_name} by 365 days?`)) return;
    try { await axios.post(`${API}/m365/gdap/${g.id}/extend`, { days: 365 }, { headers }); toast.success("Extended"); load(); }
    catch (e) { toast.error(e.response?.data?.detail || e.message); }
  };

  if (loading) return <Loader2 className="w-5 h-5 animate-spin mx-auto mt-8" />;

  return (
    <>
      <Card><CardContent className="p-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Role Templates</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {roleTemplates.map(rt => (
            <Card key={rt.id} className="bg-violet-500/5 border-violet-500/20"><CardContent className="p-2">
              <div className="text-xs font-medium">{rt.name}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{rt.roles.length} roles</div>
              <div className="text-[10px] mt-0.5 line-clamp-2">{rt.roles.slice(0, 3).join(" · ")}{rt.roles.length > 3 ? "…" : ""}</div>
            </CardContent></Card>
          ))}
        </div>
      </CardContent></Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Tenant</TableHead><TableHead>Roles</TableHead><TableHead className="text-right">Expires in</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {items.map(g => (
                <TableRow key={g.id} data-testid={`gdap-row-${g.id}`}>
                  <TableCell><div className="font-medium">{g.tenant_name}</div></TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px]">{g.role_count} roles</Badge> <span className="text-[10px] text-muted-foreground">{g.roles.slice(0, 3).join(", ")}{g.roles.length > 3 ? "…" : ""}</span></TableCell>
                  <TableCell className={`text-right font-mono text-xs ${g.expires_in_days <= 30 ? "text-rose-400" : g.expires_in_days <= 90 ? "text-amber-400" : "text-zinc-300"}`}>{g.expires_in_days}d</TableCell>
                  <TableCell><Badge className={g.status === "active" ? SEVERITY_COLORS.low : SEVERITY_COLORS.medium}>{g.status}</Badge></TableCell>
                  <TableCell><Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => extend(g)} data-testid={`gdap-extend-${g.id}`}><RefreshCw className="w-3 h-3 mr-1" />Extend +1y</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

// ─────────────── Security ───────────────
function SecurityTab({ headers }) {
  const [mfa, setMfa] = useState(null);
  const [trend, setTrend] = useState(null);
  const [ca, setCa] = useState([]);
  const [aitm, setAitm] = useState(null);

  useEffect(() => {
    axios.get(`${API}/m365/mfa-analytics`, { headers }).then(r => setMfa(r.data));
    axios.get(`${API}/m365/secure-score/trend`, { headers }).then(r => setTrend(r.data));
    axios.get(`${API}/m365/ca-templates`, { headers }).then(r => setCa(r.data));
    axios.get(`${API}/m365/aitm-page`, { headers }).then(r => setAitm(r.data));
  }, [headers]);

  const saveAitm = async () => {
    try { const r = await axios.put(`${API}/m365/aitm-page`, aitm, { headers }); setAitm({ ...aitm, css: r.data.css }); toast.success("Saved"); }
    catch (e) { toast.error(e.message); }
  };

  return (
    <div className="grid grid-cols-2 gap-3">
      {/* MFA Analytics */}
      <Card>
        <CardContent className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1"><KeyRound className="w-3 h-3" />MFA by method</div>
          {!mfa ? <Loader2 className="w-4 h-4 animate-spin" /> : (
            <>
              <div className="text-3xl font-light text-emerald-300">{mfa.mfa_pct}<span className="text-base text-zinc-500">%</span></div>
              <div className="text-[10px] text-muted-foreground">{mfa.no_mfa_admin_count} admins without MFA · {mfa.no_mfa_users.length} users without MFA</div>
              <div className="space-y-1 mt-2">
                {Object.entries(mfa.by_method).map(([m, n]) => (
                  <div key={m} className="flex items-center gap-2 text-[11px]">
                    <span className="w-32">{m}</span>
                    <div className="flex-1 h-2 rounded bg-zinc-900"><div className="h-full bg-emerald-500/50" style={{ width: `${(n / mfa.total_users) * 100}%` }} /></div>
                    <span className="font-mono">{n}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Secure Score trend */}
      <Card>
        <CardContent className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1"><ShieldCheck className="w-3 h-3" />Secure Score 30-day average</div>
          {!trend ? <Loader2 className="w-4 h-4 animate-spin" /> : (() => {
            const s = trend.series; const w = 400, h = 100;
            const minV = Math.min(...s.map(p => p.avg)); const maxV = Math.max(...s.map(p => p.avg));
            const path = s.map((p, i) => `${i === 0 ? "M" : "L"}${(i / (s.length - 1)) * w},${h - ((p.avg - minV) / (maxV - minV || 1)) * h}`).join(" ");
            return <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-24"><path d={path} fill="none" stroke="#22d3ee" strokeWidth="2" /></svg>;
          })()}
          <div className="text-[10px] text-muted-foreground mt-1">across {trend?.tenants.length || 0} tenants</div>
        </CardContent>
      </Card>

      {/* Conditional Access Library */}
      <Card className="col-span-2">
        <CardContent className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Layers className="w-3 h-3" />Conditional Access Template Library</div>
            <Badge variant="outline" className="text-[10px]">{ca.length} templates</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {ca.map(t => (
              <Card key={t.id} className="bg-violet-500/5 border-violet-500/20">
                <CardContent className="p-2.5">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">{t.name}</div>
                    <Badge className={`text-[9px] ${SEVERITY_COLORS[t.severity] || SEVERITY_COLORS.medium}`}>{t.severity}</Badge>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{t.source} · {t.category}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Anti-AITM Page */}
      <Card className="col-span-2">
        <CardContent className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Shield className="w-3 h-3" />Anti-AITM &ldquo;Do Not Login&rdquo; Page</div>
            {aitm && <Switch checked={aitm.enabled} onCheckedChange={v => setAitm({ ...aitm, enabled: v })} data-testid="aitm-toggle" />}
          </div>
          {aitm && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div><Label className="text-xs">Company name</Label><Input value={aitm.company_name || ""} onChange={e => setAitm({ ...aitm, company_name: e.target.value })} /></div>
                <div className="col-span-2"><Label className="text-xs">Primary color</Label><Input type="color" value={aitm.primary_color || "#DC2626"} onChange={e => setAitm({ ...aitm, primary_color: e.target.value })} className="h-9 p-1" /></div>
                <div className="col-span-3"><Label className="text-xs">Warning text</Label><Textarea rows={2} value={aitm.warning_text || ""} onChange={e => setAitm({ ...aitm, warning_text: e.target.value })} /></div>
              </div>
              <div className="flex items-center gap-2"><Button onClick={saveAitm} size="sm" data-testid="aitm-save-btn"><Code className="w-3 h-3 mr-1" />Save & Generate CSS</Button></div>
              {aitm.css && <ScrollArea className="max-h-40 border border-zinc-800 rounded p-2"><pre className="text-[10px] whitespace-pre-wrap text-emerald-300 font-mono">{aitm.css}</pre></ScrollArea>}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────────── Alerts ───────────────
function AlertsTab({ headers }) {
  const [items, setItems] = useState([]);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: "", expression: "", severity: "medium", enabled: true });

  const load = useCallback(async () => {
    const r = await axios.get(`${API}/m365/scripted-alerts`, { headers }); setItems(r.data);
  }, [headers]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    try { await axios.post(`${API}/m365/scripted-alerts`, draft, { headers }); toast.success("Created"); setCreating(false); setDraft({ name: "", expression: "", severity: "medium", enabled: true }); load(); }
    catch (e) { toast.error(e.response?.data?.detail || e.message); }
  };
  const remove = async (id) => { if (!window.confirm("Delete alert?")) return; await axios.delete(`${API}/m365/scripted-alerts/${id}`, { headers }); load(); };

  return (
    <>
      <Card><CardContent className="p-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium flex items-center gap-1"><AlertTriangle className="w-4 h-4 text-amber-400" />Scripted Alerts</div>
          <div className="text-[10px] text-muted-foreground">Multi-signal audit-log expressions. Triggers tickets and webhooks.</div>
        </div>
        <Button size="sm" variant="outline" onClick={() => setCreating(true)} data-testid="alert-create-btn"><Plus className="w-3 h-3 mr-1" />New Alert</Button>
      </CardContent></Card>

      {items.map(a => (
        <Card key={a.id}>
          <CardContent className="p-3 flex items-center gap-2" data-testid={`alert-${a.key}`}>
            <Badge className={`text-[9px] ${SEVERITY_COLORS[a.severity]}`}>{a.severity}</Badge>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{a.name}</div>
              <div className="text-[10px] text-zinc-400 font-mono truncate">{a.expression}</div>
            </div>
            <Badge variant="outline" className="text-[10px]">{a.trigger_count_30d} fires/30d</Badge>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-rose-400" onClick={() => remove(a.id)}><Trash2 className="w-3 h-3" /></Button>
          </CardContent>
        </Card>
      ))}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Scripted Alert</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Input placeholder="Name" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
            <Textarea rows={3} placeholder="Expression (e.g. signin.country != last_signin.country AND time_delta < 2h)" value={draft.expression} onChange={e => setDraft({ ...draft, expression: e.target.value })} />
            <Select value={draft.severity} onValueChange={v => setDraft({ ...draft, severity: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="critical">critical</SelectItem><SelectItem value="high">high</SelectItem><SelectItem value="medium">medium</SelectItem><SelectItem value="low">low</SelectItem></SelectContent>
            </Select>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button><Button onClick={create} data-testid="alert-create-submit">Create</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─────────────── Connection settings ───────────────
function ConnectionTab({ headers, conn, onSaved }) {
  const [form, setForm] = useState({ app_id: "", tenant_id: "", app_secret: "", refresh_token: "", partner_center_account: "" });
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const save = async () => {
    setBusy(true);
    try {
      const payload = Object.fromEntries(Object.entries(form).filter(([_, v]) => v));
      await axios.put(`${API}/m365/connection`, payload, { headers });
      toast.success("Saved");
      onSaved && onSaved();
      setForm({ app_id: "", tenant_id: "", app_secret: "", refresh_token: "", partner_center_account: "" });
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  const test = async () => {
    setBusy(true);
    try { const r = await axios.post(`${API}/m365/connection/test`, {}, { headers }); setTestResult(r.data); }
    catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Card>
      <CardContent className="p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Lock className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-medium">M365 Connection</span>
          <Badge className={conn?.mode === "live" ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300"}>{conn?.mode}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">Create a Partner Center app registration with GDAP + Graph permissions, then paste the IDs/secret/refresh token below. While empty, the platform runs against realistic mock tenants so you can demo immediately.</p>
        {conn && (conn.app_id || conn.tenant_id) && (
          <div className="text-[11px] text-muted-foreground bg-muted/30 p-2 rounded">
            Stored: app_id=<code>{conn.app_id}</code> · tenant_id=<code>{conn.tenant_id}</code> · secret=<code>{conn.app_secret || "—"}</code> · refresh_token=<code>{conn.refresh_token || "—"}</code>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">App ID</Label><Input value={form.app_id} onChange={e => setForm({ ...form, app_id: e.target.value })} data-testid="m365-conn-app-id" /></div>
          <div><Label className="text-xs">Tenant ID</Label><Input value={form.tenant_id} onChange={e => setForm({ ...form, tenant_id: e.target.value })} data-testid="m365-conn-tenant-id" /></div>
          <div><Label className="text-xs">App Secret</Label><Input type="password" value={form.app_secret} onChange={e => setForm({ ...form, app_secret: e.target.value })} data-testid="m365-conn-secret" /></div>
          <div><Label className="text-xs">Refresh Token</Label><Input type="password" value={form.refresh_token} onChange={e => setForm({ ...form, refresh_token: e.target.value })} data-testid="m365-conn-refresh" /></div>
          <div className="col-span-2"><Label className="text-xs">Partner Center account email</Label><Input value={form.partner_center_account} onChange={e => setForm({ ...form, partner_center_account: e.target.value })} /></div>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={save} disabled={busy} data-testid="m365-conn-save">{busy ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Lock className="w-3 h-3 mr-1" />}Save</Button>
          <Button variant="outline" onClick={test} disabled={busy} data-testid="m365-conn-test">Test connection</Button>
          {testResult && <span className={`text-xs ${testResult.ok ? "text-emerald-400" : "text-amber-400"}`}>{testResult.ok ? `✓ ${testResult.scope}` : `✗ ${testResult.reason || "—"}`}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
