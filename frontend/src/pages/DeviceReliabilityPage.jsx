import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { API, useAuth } from "@/App";
import { PageShell } from "@/components/design-system";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, RefreshCw, Server, AlertTriangle, Flame, Clock, Activity, Zap, Shield, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

function useApi(token) {
  return useMemo(() => ({
    get: (p) => axios.get(`${API}${p}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.data),
    post: (p, b) => axios.post(`${API}${p}`, b || {}, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.data),
  }), [token]);
}

function fmtAgo(seconds) {
  if (seconds == null) return "never";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function fmtDate(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

export default function DeviceReliabilityPage() {
  const { token } = useAuth();
  const api = useApi(token);
  const [tab, setTab] = useState("overview");
  const [status, setStatus] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const loadStatus = () => api.get("/trmm-sync/status").then(setStatus).catch(() => {});
  useEffect(() => { loadStatus(); const i = setInterval(loadStatus, 15000); return () => clearInterval(i); /* eslint-disable-next-line */ }, []);

  const syncNow = async () => {
    setSyncing(true);
    try {
      const r = await api.post("/trmm-sync/run");
      toast.success(`Synced · ${r.devices_updated} devices${r.outages_created ? ` · ${r.outages_created} outage(s)` : ""}`);
      loadStatus();
    } catch (e) { toast.error(e.message); }
    finally { setSyncing(false); }
  };

  const freshColor = !status ? "zinc" : status.staleness_seconds == null ? "zinc" : status.staleness_seconds < 180 ? "emerald" : status.staleness_seconds < 900 ? "amber" : "rose";

  return (
    <PageShell>
      <div className="space-y-4" data-testid="device-reliability-page">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-violet-400 mb-1 flex items-center gap-2"><Server className="w-3 h-3" />TRMM Reliability</div>
            <h1 className="text-2xl font-semibold tracking-tight">Live agent sync · outage detective · stale radar</h1>
            <p className="text-sm text-muted-foreground">
              {status?.demo_mode
                ? "DEMO MODE — synthetic agents driving the UI. Configure TRMM in Settings → Integrations to switch to live."
                : "Live TRMM sync is active. Status refreshes every 3 min."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={`text-${freshColor}-400 border-${freshColor}-500/40`}>
              Updated {fmtAgo(status?.staleness_seconds)}
            </Badge>
            {status?.demo_mode && <Badge variant="outline" className="text-amber-400 border-amber-500/40">DEMO</Badge>}
            <Button size="sm" variant="outline" onClick={syncNow} disabled={syncing} className="text-violet-400 border-violet-500/30 hover:bg-violet-500/10" data-testid="sync-now-btn">
              {syncing ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}Sync now
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Agents seen" value={status?.agents_seen || 0} color="sky" icon={Server} />
          <Stat label="Devices updated" value={status?.devices_updated || 0} color="emerald" icon={Activity} />
          <Stat label="Transitions" value={status?.transitions_count || 0} color="violet" icon={Zap} />
          <Stat label="Status" value={status?.configured ? "LIVE" : "DEMO"} color={status?.configured ? "emerald" : "amber"} icon={status?.configured ? CheckCircle2 : Shield} />
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="overview" data-testid="tab-overview"><Activity className="w-3 h-3 mr-1" />Client health</TabsTrigger>
            <TabsTrigger value="outages" data-testid="tab-outages"><Flame className="w-3 h-3 mr-1" />Outages</TabsTrigger>
            <TabsTrigger value="stale" data-testid="tab-stale"><Clock className="w-3 h-3 mr-1" />Stale agents</TabsTrigger>
            <TabsTrigger value="bulk" data-testid="tab-bulk"><Zap className="w-3 h-3 mr-1" />Bulk actions</TabsTrigger>
          </TabsList>
          <TabsContent value="overview"><ClientHealth api={api} /></TabsContent>
          <TabsContent value="outages"><Outages api={api} /></TabsContent>
          <TabsContent value="stale"><StaleAgents api={api} /></TabsContent>
          <TabsContent value="bulk"><BulkActions api={api} /></TabsContent>
        </Tabs>
      </div>
    </PageShell>
  );
}

function Stat({ label, value, color = "sky", icon: Icon }) {
  return (
    <Card><CardContent className="p-3 flex items-center gap-3">
      {Icon && <Icon className={`w-5 h-5 text-${color}-400`} />}
      <div>
        <div className={`text-[10px] uppercase tracking-widest text-${color}-400`}>{label}</div>
        <div className="text-xl font-semibold">{value}</div>
      </div>
    </CardContent></Card>
  );
}

/* ─── Client Health ─── */
function ClientHealth({ api }) {
  const [data, setData] = useState(null);
  useEffect(() => { api.get("/trmm-sync/client-health").then(setData).catch(() => {}); }, [api]);
  if (!data) return <div className="py-10 text-center"><Loader2 className="w-4 h-4 animate-spin mx-auto" /></div>;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
      {(data.clients || []).map((c) => {
        const badgeColor = c.badge === "FULL OUTAGE" ? "rose" : c.badge === "PARTIAL OUTAGE" ? "amber" : c.badge === "HEALTHY" ? "emerald" : "sky";
        return (
          <Card key={c.client_id} data-testid={`client-health-${c.client_id}`} className={`border-l-2 border-l-${badgeColor}-500/60`}>
            <CardContent className="p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="font-medium text-sm truncate">{c.client_name}</div>
                <Badge variant="outline" className={`text-${badgeColor}-400 border-${badgeColor}-500/40 text-[10px]`}>{c.badge}</Badge>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-emerald-400">● {c.online} online</span>
                <span className="text-rose-400">● {c.offline} offline</span>
                {c.warning > 0 && <span className="text-amber-400">● {c.warning} warning</span>}
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div className={`h-full bg-${badgeColor}-500`} style={{ width: `${c.online_pct}%` }} />
              </div>
              <div className="text-[11px] text-muted-foreground">{c.online_pct}% online · {c.linked}/{c.total} linked to TRMM</div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/* ─── Outages ─── */
function Outages({ api }) {
  const [data, setData] = useState(null);
  const load = () => api.get("/trmm-sync/outages").then(setData).catch(() => {});
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  const resolve = async (id) => { await api.post(`/trmm-sync/outages/${id}/resolve`); toast.success("Resolved"); load(); };
  if (!data) return <div className="py-10 text-center"><Loader2 className="w-4 h-4 animate-spin mx-auto" /></div>;
  return (
    <div className="mt-3 space-y-2">
      {(data.outages || []).length === 0 ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
          <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-emerald-400" />No active outages detected.
        </CardContent></Card>
      ) : (data.outages || []).map((o) => (
        <Card key={o.id} className="border-l-2 border-l-rose-500/60" data-testid={`outage-${o.id}`}>
          <CardContent className="p-3 flex items-center gap-3 flex-wrap">
            <Flame className="w-5 h-5 text-rose-400" />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm">{o.client_name}</div>
              <div className="text-xs text-muted-foreground">
                {o.offline_count} devices offline · detected {fmtDate(o.detected_at)}
                {o.ticket_number && <> · <Link to={`/tickets?number=${o.ticket_number}`} className="text-violet-400 hover:underline">{o.ticket_number}</Link></>}
              </div>
            </div>
            <Button size="sm" variant="outline" className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" onClick={() => resolve(o.id)} data-testid={`resolve-${o.id}`}>Resolve</Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ─── Stale Agents ─── */
function StaleAgents({ api }) {
  const [data, setData] = useState(null);
  useEffect(() => { api.get("/trmm-sync/stale-agents?days=3").then(setData).catch(() => {}); }, [api]);
  if (!data) return <div className="py-10 text-center"><Loader2 className="w-4 h-4 animate-spin mx-auto" /></div>;
  return (
    <div className="mt-3">
      {(data.stale || []).length === 0 ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
          <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-emerald-400" />No stale agents — all agents reported in the last {data.days_threshold} days.
        </CardContent></Card>
      ) : (
        <Card><CardContent className="p-0">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border/40">
              <tr><th className="p-2 text-left">Device</th><th className="p-2 text-left">Client</th><th className="p-2 text-left">Last seen</th><th className="p-2 text-left">Agent ID</th></tr>
            </thead>
            <tbody>
              {(data.stale || []).map((s) => (
                <tr key={s.id} className="border-b border-border/20">
                  <td className="p-2">{s.name}</td>
                  <td className="p-2 text-muted-foreground">{s.client_name}</td>
                  <td className="p-2"><Badge variant="outline" className="text-rose-400 border-rose-500/40 text-[10px]">{fmtDate(s.last_seen)}</Badge></td>
                  <td className="p-2 font-mono text-[10px] text-muted-foreground">{s.trmm_agent_id?.slice(0, 16)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent></Card>
      )}
    </div>
  );
}

/* ─── Bulk Actions ─── */
function BulkActions({ api }) {
  const [devices, setDevices] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [running, setRunning] = useState(false);

  useEffect(() => {
    axios.get(`${API}/devices`, { headers: { Authorization: `Bearer ${JSON.parse(localStorage.getItem("user") || "{}").token || ""}` } })
      .then(() => {}).catch(() => {});
    api.get("/trmm/linked-devices").then(setDevices).catch(() => setDevices([]));
  }, [api]);

  const toggle = (id) => {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id); else s.add(id);
    setSelected(s);
  };

  const run = async (action) => {
    if (selected.size === 0) return toast.error("Select devices");
    if (!window.confirm(`Run ${action} on ${selected.size} devices?`)) return;
    setRunning(true);
    try {
      const r = await api.post("/trmm-sync/bulk-action", { action, device_ids: Array.from(selected) });
      const ok = r.results.filter((x) => x.ok).length;
      const fail = r.results.length - ok;
      toast.success(`${action}: ${ok} succeeded${fail ? `, ${fail} failed` : ""}${r.demo_mode ? " (demo)" : ""}`);
    } catch (e) { toast.error(e.message); }
    finally { setRunning(false); }
  };

  const linked = Array.isArray(devices) ? devices : [];

  return (
    <div className="mt-3 space-y-3">
      <Card><CardContent className="p-3 flex items-center gap-2 flex-wrap">
        <div className="text-sm flex-1">{selected.size} device(s) selected</div>
        <Button size="sm" variant="outline" onClick={() => run("reboot")} disabled={running || selected.size === 0} className="text-amber-400 border-amber-500/30" data-testid="bulk-reboot">Reboot</Button>
        <Button size="sm" variant="outline" onClick={() => run("install-patches")} disabled={running || selected.size === 0} className="text-violet-400 border-violet-500/30" data-testid="bulk-patch">Install patches</Button>
        <Button size="sm" variant="outline" onClick={() => run("run-checks")} disabled={running || selected.size === 0} className="text-sky-400 border-sky-500/30" data-testid="bulk-checks">Run checks</Button>
        <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>Clear</Button>
      </CardContent></Card>
      <Card><CardContent className="p-0 max-h-[60vh] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border/40 sticky top-0 bg-background">
            <tr><th className="p-2 w-10"></th><th className="p-2 text-left">Device</th><th className="p-2 text-left">Client</th><th className="p-2 text-left">Hostname</th></tr>
          </thead>
          <tbody>
            {linked.map((d) => (
              <tr key={d.id} className="border-b border-border/20 hover:bg-muted/30">
                <td className="p-2"><Checkbox checked={selected.has(d.id)} onCheckedChange={() => toggle(d.id)} data-testid={`bulk-select-${d.id}`} /></td>
                <td className="p-2">{d.name}</td>
                <td className="p-2 text-muted-foreground">{d.client_name}</td>
                <td className="p-2 font-mono text-[10px] text-muted-foreground">{d.trmm_hostname}</td>
              </tr>
            ))}
            {linked.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">No devices linked to TRMM.</td></tr>}
          </tbody>
        </table>
      </CardContent></Card>
      <div className="text-[11px] text-muted-foreground flex items-center gap-1">
        <AlertTriangle className="w-3 h-3 text-amber-400" />
        Change Freeze windows are honoured automatically — frozen clients are skipped with <code className="bg-muted px-1 rounded">change_freeze_active</code> reason.
      </div>
    </div>
  );
}
