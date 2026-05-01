import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import axios from "axios";
import { useParams, useNavigate, useSearchParams, Link } from "react-router-dom";
import { API, useAuth } from "@/App";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Siren, AlertTriangle, Clock, Users, Radio, MessageSquare, Send,
  CheckCircle2, Loader2, ChevronRight, Share2, Copy, Link2, XCircle,
  Activity, Server, FileText, Zap, Plus, Eye, Megaphone, ChevronUp, RefreshCw,
} from "lucide-react";
import { PostmortemButton } from "@/components/ai/PostmortemButton";

const STATUS_CLS = {
  investigating: "text-rose-400 border-rose-500/40 bg-rose-500/10",
  identified: "text-amber-400 border-amber-500/40 bg-amber-500/10",
  monitoring: "text-sky-400 border-sky-500/40 bg-sky-500/10",
  resolved: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10",
};

const SEVERITY_CLS = {
  P1: "text-rose-400 border-rose-500/40 bg-rose-500/10",
  P2: "text-amber-400 border-amber-500/40 bg-amber-500/10",
  P3: "text-sky-400 border-sky-500/40 bg-sky-500/10",
  P4: "text-zinc-400 border-zinc-500/40 bg-zinc-500/10",
};

function timeAgo(iso) {
  if (!iso) return "—";
  try {
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  } catch { return "—"; }
}

export default function WarRoomPage() {
  const { id } = useParams();
  return id ? <WarRoomDetail wrId={id} /> : <WarRoomList />;
}

function WarRoomList() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [includeResolved, setIncludeResolved] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: "", severity: "P1", summary: "", client_id: "", ticket_id: "" });
  const [clients, setClients] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/warroom?include_resolved=${includeResolved}`, { headers });
      setRooms(res.data || []);
    } catch (e) { toast.error("Load failed"); }
    finally { setLoading(false); }
  }, [headers, includeResolved]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get(`${API}/clients`, { headers });
        setClients(res.data || []);
      } catch {}
    })();
  }, [headers]);

  const create = async () => {
    if (!form.title.trim()) { toast.error("Title required"); return; }
    setCreating(true);
    try {
      const res = await axios.post(`${API}/warroom`, form, { headers });
      toast.success("War room opened");
      setCreateOpen(false);
      navigate(`/warroom/${res.data.war_room.id}`);
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setCreating(false); }
  };

  const active = rooms.filter(r => r.status !== "resolved");
  const resolved = rooms.filter(r => r.status === "resolved");

  return (
    <div className="p-6 space-y-5" data-testid="warroom-list-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-light tracking-tight flex items-center gap-3">
            <Siren className="w-7 h-7 text-rose-500" />
            Incident War Rooms
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            One URL · live tech chat · affected devices · past-incident playbook · client-bookmarkable status.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setIncludeResolved(v => !v)} data-testid="warroom-toggle-resolved">
            {includeResolved ? "Active only" : "Show resolved"}
          </Button>
          <Button
            onClick={() => setCreateOpen(true)}
            variant="outline"
            className="text-rose-400 border-rose-500/30 hover:bg-rose-500/10"
            data-testid="warroom-new-btn"
          >
            <Plus className="w-4 h-4 mr-1" /> Open War Room
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <KpiBox label="Active" value={active.length} accent="rose" icon={<Siren className="w-4 h-4" />} />
        <KpiBox label="Investigating" value={active.filter(r => r.status === "investigating").length} accent="rose" icon={<AlertTriangle className="w-4 h-4" />} />
        <KpiBox label="Identified" value={active.filter(r => r.status === "identified").length} accent="amber" icon={<Activity className="w-4 h-4" />} />
        <KpiBox label="Monitoring" value={active.filter(r => r.status === "monitoring").length} accent="sky" icon={<Eye className="w-4 h-4" />} />
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Loading…</div>
          ) : rooms.length === 0 ? (
            <div className="p-16 text-center text-sm text-muted-foreground">
              No war rooms. When a P1 fires, open one to give your techs a single battle-station.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Incident</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>ETA</TableHead>
                  <TableHead>Opened</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...active, ...resolved].map(r => (
                  <TableRow key={r.id} className="cursor-pointer hover:bg-muted/30" onClick={() => navigate(`/warroom/${r.id}`)} data-testid={`warroom-row-${r.id}`}>
                    <TableCell className="text-sm font-medium">{r.title}</TableCell>
                    <TableCell className="text-sm">{r.client_name || "—"}</TableCell>
                    <TableCell><Badge variant="outline" className={SEVERITY_CLS[r.severity] || ""}>{r.severity}</Badge></TableCell>
                    <TableCell><Badge variant="outline" className={STATUS_CLS[r.status]}>{r.status}</Badge></TableCell>
                    <TableCell className="text-xs">{r.eta || "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{timeAgo(r.created_at)} · by {r.created_by}</TableCell>
                    <TableCell><ChevronRight className="w-4 h-4 opacity-40" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-xl" data-testid="warroom-create-dialog">
          <DialogHeader><DialogTitle>Open a new War Room</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Title *</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="ACME Corp · VPN outage" data-testid="warroom-title" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Severity</Label>
                <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v })}>
                  <SelectTrigger data-testid="warroom-severity"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["P1", "P2", "P3", "P4"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Client (optional)</Label>
                <Select value={form.client_id || "__none"} onValueChange={(v) => setForm({ ...form, client_id: v === "__none" ? "" : v })}>
                  <SelectTrigger data-testid="warroom-client"><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">None</SelectItem>
                    {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Summary (optional)</Label>
              <Textarea rows={3} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} placeholder="What do we know so far?" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={create} disabled={creating || !form.title.trim()} variant="outline" className="text-rose-400 border-rose-500/30 hover:bg-rose-500/10" data-testid="warroom-create-submit">
              {creating ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Siren className="w-4 h-4 mr-1" />}Open
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KpiBox({ label, value, accent = "zinc", icon }) {
  const col = { rose: "text-rose-400", amber: "text-amber-400", sky: "text-sky-400", emerald: "text-emerald-400", zinc: "text-zinc-400" }[accent];
  return (
    <Card><CardContent className="p-4">
      <div className={`flex items-center gap-1.5 text-[10px] uppercase tracking-widest ${col}`}>{icon}{label}</div>
      <div className="text-3xl font-light mt-1">{value}</div>
    </CardContent></Card>
  );
}

function WarRoomDetail({ wrId }) {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [wr, setWr] = useState(null);
  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [etaDraft, setEtaDraft] = useState("");
  const [statusDraft, setStatusDraft] = useState("");
  const [updating, setUpdating] = useState(false);
  const [pageOpen, setPageOpen] = useState(false);
  const messagesRef = useRef(null);

  const load = useCallback(async (showSpinner = false) => {
    try {
      const res = await axios.get(`${API}/warroom/${wrId}`, { headers });
      setWr(res.data);
      if (!etaDraft) setEtaDraft(res.data.eta || "");
      if (!statusDraft) setStatusDraft(res.data.status);
    } catch (e) {
      if (showSpinner) toast.error("Load failed: " + (e.response?.data?.detail || e.message));
    }
  }, [headers, wrId, etaDraft, statusDraft]);

  useEffect(() => { load(true); }, [wrId]); // eslint-disable-line
  useEffect(() => {
    if (wr?.status === "resolved") return;
    const iv = setInterval(load, 4000);
    return () => clearInterval(iv);
  }, [load, wr?.status]);
  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [wr?.messages?.length]);

  if (!wr) {
    return <div className="p-8 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Loading war room…</div>;
  }

  const publicUrl = `${window.location.origin}/warroom/public/${wr.public_slug}`;

  const sendMessage = async () => {
    if (!msg.trim()) return;
    setSending(true);
    try {
      await axios.post(`${API}/warroom/${wrId}/messages`, { body: msg }, { headers });
      setMsg("");
      load();
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setSending(false); }
  };

  const updateStatus = async (patch) => {
    setUpdating(true);
    try {
      await axios.post(`${API}/warroom/${wrId}/status`, patch, { headers });
      load();
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setUpdating(false); }
  };

  const resolve = async () => {
    if (!window.confirm("Mark this war room resolved?")) return;
    const notes = window.prompt("Resolution notes (optional)") || "";
    try {
      await axios.post(`${API}/warroom/${wrId}/resolve`, { resolved_notes: notes }, { headers });
      toast.success("Resolved");
      load();
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
  };

  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-background to-muted/20" data-testid="warroom-detail-page">
      {/* War room header */}
      <div className="border-b border-border px-6 py-3 flex items-center gap-3 bg-background/80 backdrop-blur">
        <Button variant="ghost" size="sm" onClick={() => navigate("/warroom")} className="flex-shrink-0">← Back</Button>
        <Siren className="w-5 h-5 text-rose-500 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-medium truncate" data-testid="warroom-title">{wr.title}</h1>
            <Badge variant="outline" className={SEVERITY_CLS[wr.severity]}>{wr.severity}</Badge>
            <Badge variant="outline" className={STATUS_CLS[wr.status]}>{wr.status}</Badge>
          </div>
          <div className="text-[11px] text-muted-foreground">
            {wr.client_name || "No client"} · opened {timeAgo(wr.created_at)} by {wr.created_by}
            {wr.resolved_at && <span> · resolved {timeAgo(wr.resolved_at)}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            variant="outline" size="sm"
            className="text-rose-400 border-rose-500/30 hover:bg-rose-500/10"
            onClick={() => setPageOpen(true)}
            disabled={wr.status === "resolved"}
            data-testid="warroom-page-btn"
          >
            <Megaphone className="w-3.5 h-3.5 mr-1" />Page Team
          </Button>
          <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(publicUrl); toast.success("Public status URL copied"); }} data-testid="warroom-share-btn">
            <Share2 className="w-3.5 h-3.5 mr-1" />Share
          </Button>
          {wr.status !== "resolved" && (
            <Button variant="outline" size="sm" className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" onClick={resolve} data-testid="warroom-resolve-btn">
              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />Resolve
            </Button>
          )}
          {wr.status === "resolved" && <PostmortemButton warRoomId={wr.id} />}
        </div>
      </div>

      <div className="flex-1 grid grid-cols-12 gap-3 p-3 overflow-hidden">
        {/* LEFT sidebar: context */}
        <div className="col-span-3 overflow-y-auto space-y-3">
          <Card>
            <CardContent className="p-3 space-y-2">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> ETA</div>
              <Input
                value={etaDraft}
                onChange={(e) => setEtaDraft(e.target.value)}
                onBlur={() => etaDraft !== (wr.eta || "") && updateStatus({ eta: etaDraft })}
                placeholder="e.g. 15 min"
                className="h-8 text-xs"
                disabled={wr.status === "resolved"}
                data-testid="warroom-eta"
              />
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1 pt-1"><Activity className="w-3 h-3" /> Status</div>
              <Select value={statusDraft} onValueChange={(v) => { setStatusDraft(v); updateStatus({ status: v }); }} disabled={wr.status === "resolved"}>
                <SelectTrigger className="h-8 text-xs" data-testid="warroom-status-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="investigating">Investigating</SelectItem>
                  <SelectItem value="identified">Identified</SelectItem>
                  <SelectItem value="monitoring">Monitoring</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                </SelectContent>
              </Select>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground pt-2 flex items-center gap-1"><Users className="w-3 h-3" /> Participants ({wr.participants?.length || 0})</div>
              <div className="flex flex-wrap gap-1">
                {(wr.participants || []).map((p, i) => (
                  <Badge key={i} variant="outline" className="text-[9px]">{p.name}</Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-3 space-y-2">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1"><Link2 className="w-3 h-3" /> Client status URL</div>
              <div className="flex items-center gap-1">
                <Input readOnly value={publicUrl} className="h-7 text-[10px] font-mono" data-testid="warroom-public-url" />
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { navigator.clipboard.writeText(publicUrl); toast.success("Copied"); }}><Copy className="w-3 h-3" /></Button>
              </div>
              <p className="text-[9px] text-muted-foreground leading-tight">Share with client — no login needed. Techs' private chat stays hidden.</p>
            </CardContent>
          </Card>

          {wr.pages?.length > 0 && (
            <Card>
              <CardContent className="p-3">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1 mb-2">
                  <Megaphone className="w-3 h-3" /> Escalation Ladder
                  {wr.auto_escalate && wr.next_escalation_at && (
                    <Badge variant="outline" className="ml-auto text-[9px] text-amber-400 border-amber-500/30">
                      <Clock className="w-2.5 h-2.5 mr-1" />Next: {timeAgo(wr.next_escalation_at)}
                    </Badge>
                  )}
                </div>
                <div className="space-y-1.5">
                  {wr.pages.map((p) => (
                    <div key={p.id} className={`flex items-center gap-2 text-xs rounded px-2 py-1 ${p.status === "ack" ? "bg-emerald-500/10 border border-emerald-500/20" : p.status === "sent" ? "bg-zinc-800/60" : "bg-zinc-900/40 opacity-70"}`} data-testid={`warroom-page-${p.id}`}>
                      <Badge variant="outline" className={`text-[9px] ${p.tier === 1 ? "text-rose-400 border-rose-500/30" : p.tier === 2 ? "text-amber-400 border-amber-500/30" : "text-sky-400 border-sky-500/30"}`}>T{p.tier}</Badge>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{p.name}</div>
                        <div className="text-[9px] text-muted-foreground font-mono truncate">{(p.channels || []).join(" · ")}</div>
                      </div>
                      {p.status === "ack" ? (
                        <Badge variant="outline" className="text-[9px] text-emerald-400 border-emerald-500/30"><CheckCircle2 className="w-2.5 h-2.5 mr-0.5" />ACK</Badge>
                      ) : p.status === "sent" ? (
                        <Badge variant="outline" className="text-[9px] text-zinc-400 border-zinc-600">sent</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[9px] text-zinc-500 border-zinc-700">pending</Badge>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {wr.affected_devices?.length > 0 && (
            <Card>
              <CardContent className="p-3">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1 mb-2"><Server className="w-3 h-3" /> Affected devices</div>
                {wr.affected_devices.map(d => (
                  <Link to={`/devices/${d.id}`} key={d.id} className="block hover:bg-muted/40 rounded px-2 py-1">
                    <div className="text-xs font-medium">{d.name}</div>
                    <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Badge variant="outline" className={d.status === "online" ? "text-emerald-400 border-emerald-500/30 text-[9px]" : "text-rose-400 border-rose-500/30 text-[9px]"}>{d.status}</Badge>
                      <span>{d.ip_address}</span>
                    </div>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* CENTER: Chat + messages */}
        <div className="col-span-6 flex flex-col overflow-hidden">
          <Card className="flex-1 flex flex-col overflow-hidden">
            <div className="px-3 py-2 border-b border-border text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1">
              <MessageSquare className="w-3 h-3" /> Live tech chat · {wr.messages?.length || 0} messages
            </div>
            <div ref={messagesRef} className="flex-1 overflow-y-auto p-3 space-y-2" data-testid="warroom-messages">
              {(wr.messages || []).map(m => (
                <div key={m.id} className={m.kind === "system" ? "text-[10px] text-zinc-500 italic" : "bg-muted/30 rounded-md p-2"}>
                  {m.kind === "system" ? (
                    <div>⊙ {m.body} · <span className="text-[9px]">{timeAgo(m.ts)}</span></div>
                  ) : (
                    <>
                      <div className="text-[10px] text-muted-foreground font-medium">{m.author} · <span className="text-[9px]">{timeAgo(m.ts)}</span></div>
                      <div className="text-sm whitespace-pre-wrap">{m.body}</div>
                    </>
                  )}
                </div>
              ))}
              {(!wr.messages || wr.messages.length === 0) && <div className="text-center text-xs text-muted-foreground py-6">Drop the first update…</div>}
            </div>
            <div className="border-t border-border p-2 flex items-center gap-2 bg-background/50">
              <Input
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !sending) { e.preventDefault(); sendMessage(); } }}
                placeholder={wr.status === "resolved" ? "War room resolved" : "Type update… Enter to send"}
                disabled={sending || wr.status === "resolved"}
                data-testid="warroom-message-input"
              />
              <Button size="sm" variant="outline" onClick={sendMessage} disabled={sending || !msg.trim() || wr.status === "resolved"} data-testid="warroom-send-btn">
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
          </Card>
        </div>

        {/* RIGHT: similar incidents */}
        <div className="col-span-3 overflow-y-auto">
          <Card>
            <CardContent className="p-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1 mb-2">
                <Zap className="w-3 h-3" /> Past similar incidents
              </div>
              {(wr.similar_incidents || []).length === 0 ? (
                <div className="text-[11px] text-muted-foreground py-3 text-center">No similar past incidents found.</div>
              ) : (
                <div className="space-y-2">
                  {wr.similar_incidents.map(si => (
                    <Link key={si.ticket_id} to={`/tickets?ticket=${si.ticket_id}`} className="block bg-muted/30 hover:bg-muted/50 rounded-md p-2">
                      <div className="text-xs font-medium line-clamp-1">{si.title}</div>
                      <div className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5">
                        {si.resolution || <em>No resolution recorded</em>}
                      </div>
                      <div className="text-[9px] text-muted-foreground mt-1">Resolved {timeAgo(si.resolved_at)}</div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {wr.summary && (
            <Card className="mt-3">
              <CardContent className="p-3">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1 mb-2"><FileText className="w-3 h-3" /> Summary</div>
                <p className="text-xs whitespace-pre-wrap">{wr.summary}</p>
              </CardContent>
            </Card>
          )}

          {wr.resolved_notes && (
            <Card className="mt-3 border-emerald-500/30 bg-emerald-500/5">
              <CardContent className="p-3">
                <div className="text-[10px] uppercase tracking-widest text-emerald-400 flex items-center gap-1 mb-2"><CheckCircle2 className="w-3 h-3" /> Resolution</div>
                <p className="text-xs whitespace-pre-wrap">{wr.resolved_notes}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <PageTeamDialog
        open={pageOpen}
        onOpenChange={setPageOpen}
        wrId={wrId}
        headers={headers}
        onPaged={() => load()}
      />
    </div>
  );
}

function PageTeamDialog({ open, onOpenChange, wrId, headers, onPaged }) {
  const [techs, setTechs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [channels, setChannels] = useState(new Set(["email", "push", "sms"]));
  const [autoEscalate, setAutoEscalate] = useState(true);
  const [grace, setGrace] = useState(5);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    axios.get(`${API}/tech-roster?active_only=true`, { headers })
      .then((r) => {
        setTechs(r.data || []);
        // Pre-select tier-1 on-call techs
        const pre = new Set((r.data || []).filter((t) => t.escalation_tier === 1).map((t) => t.id));
        setSelected(pre);
      })
      .catch(() => toast.error("Failed to load roster"))
      .finally(() => setLoading(false));
  }, [open, headers]);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleChannel = (c) => {
    setChannels((prev) => {
      const next = new Set(prev);
      next.has(c) ? next.delete(c) : next.add(c);
      return next;
    });
  };

  const fire = async () => {
    if (selected.size === 0) { toast.error("Pick at least one tech"); return; }
    setSending(true);
    try {
      await axios.post(
        `${API}/warroom/${wrId}/page`,
        {
          tech_ids: Array.from(selected),
          channels: Array.from(channels),
          auto_escalate: autoEscalate,
          grace_minutes: grace,
        },
        { headers },
      );
      toast.success(autoEscalate ? "Tier 1 paged — escalation armed" : `Paged ${selected.size} tech(s)`);
      onOpenChange(false);
      onPaged && onPaged();
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
    finally { setSending(false); }
  };

  const groups = { 1: [], 2: [], 3: [] };
  techs.forEach((t) => groups[t.escalation_tier || 2]?.push(t));

  const CHS = [
    { k: "slack", l: "Slack" }, { k: "teams", l: "Teams" }, { k: "sms", l: "SMS" },
    { k: "email", l: "Email" }, { k: "push", l: "In-app" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="warroom-page-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-rose-500" /> Page Team
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-muted/30 rounded-md px-3 py-2">
            <div>
              <div className="text-sm font-medium flex items-center gap-2">
                <ChevronUp className="w-4 h-4 text-rose-400" /> Auto-Escalate
              </div>
              <div className="text-[10px] text-muted-foreground">Fires Tier 1 now · escalates to Tier 2 then Tier 3 if no ack</div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <Label className="text-[10px] text-muted-foreground">Grace</Label>
                <Input type="number" min={1} max={60} value={grace} onChange={(e) => setGrace(parseInt(e.target.value) || 5)} className="h-7 w-14 text-xs" data-testid="warroom-page-grace" />
                <span className="text-[10px] text-muted-foreground">min</span>
              </div>
              <Switch checked={autoEscalate} onCheckedChange={setAutoEscalate} data-testid="warroom-page-autoescalate" />
            </div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Channels</Label>
            <div className="flex flex-wrap gap-2 mt-1.5">
              {CHS.map(({ k, l }) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => toggleChannel(k)}
                  className={`px-3 py-1 rounded-md border text-xs ${channels.has(k) ? "bg-sky-500/10 border-sky-500/40 text-sky-300" : "border-zinc-700 text-zinc-400 hover:border-zinc-500"}`}
                  data-testid={`warroom-page-ch-${k}`}
                >{l}</button>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Technicians</Label>
            {loading ? (
              <div className="py-8 text-center text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading roster…</div>
            ) : techs.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">
                No technicians in roster. <Link to="/tech-roster" className="text-sky-400 underline">Add some</Link> to enable paging.
              </div>
            ) : (
              <div className="space-y-3 max-h-72 overflow-y-auto mt-1.5 pr-1">
                {[1, 2, 3].map((tier) => groups[tier].length > 0 && (
                  <div key={tier}>
                    <div className={`text-[10px] uppercase tracking-widest font-semibold mb-1 ${tier === 1 ? "text-rose-400" : tier === 2 ? "text-amber-400" : "text-sky-400"}`}>
                      Tier {tier}
                    </div>
                    <div className="space-y-1">
                      {groups[tier].map((t) => (
                        <label key={t.id} className="flex items-center gap-2 bg-muted/30 hover:bg-muted/50 rounded px-2 py-1.5 cursor-pointer" data-testid={`warroom-page-tech-${t.id}`}>
                          <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} className="accent-rose-500" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium flex items-center gap-2">
                              {t.name}
                              {t.on_call && <Badge variant="outline" className="text-[9px] text-emerald-400 border-emerald-500/30">ON-CALL</Badge>}
                            </div>
                            <div className="text-[10px] text-muted-foreground">{t.role || ""}{t.mobile ? ` · ${t.mobile}` : ""}</div>
                          </div>
                          <div className="text-[9px] text-muted-foreground font-mono">{(t.preferred_channels || []).join("/")}</div>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={fire}
            disabled={sending || selected.size === 0}
            variant="outline"
            className="text-rose-400 border-rose-500/30 hover:bg-rose-500/10"
            data-testid="warroom-page-fire-btn"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Megaphone className="w-4 h-4 mr-1" />}
            {autoEscalate ? "Fire Tier 1 · Arm escalation" : `Page ${selected.size} now`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
