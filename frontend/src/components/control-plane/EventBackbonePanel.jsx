import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
  Activity, CheckCircle2, Clock3, KeyRound, Loader2, Play, Plus, Radio,
  RefreshCw, Repeat2, RotateCw, Send, ServerCog, ShieldAlert, Webhook,
} from "lucide-react";

import { API, useAuth } from "@/App";
import HeroTile from "@/components/HeroTile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";


const EMPTY_SUBSCRIPTION = {
  name: "",
  description: "",
  subjectPatterns: "ticket.*\ndevice.*",
  deliveryType: "webhook",
  endpointUrl: "",
};

function dateLabel(value) {
  if (!value) return "Not yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleString();
}

function statusStyle(status) {
  if (status === "healthy" || status === "delivered") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (status === "degraded" || status === "dead_letter") return "border-rose-500/30 bg-rose-500/10 text-rose-200";
  if (status === "retrying" || status === "attention") return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  return "border-cyan-500/25 bg-cyan-500/[0.07] text-cyan-100";
}

export default function EventBackbonePanel({ contract }) {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [health, setHealth] = useState(contract?.health || null);
  const [subscriptions, setSubscriptions] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [subscriptionOpen, setSubscriptionOpen] = useState(false);
  const [subscriptionForm, setSubscriptionForm] = useState(EMPTY_SUBSCRIPTION);
  const [secret, setSecret] = useState(null);
  const [replayOpen, setReplayOpen] = useState(false);
  const [replayForm, setReplayForm] = useState({ subject: "ticket.created", fromTime: "", toTime: "", reason: "" });
  const [replayPreview, setReplayPreview] = useState(null);

  const load = useCallback(async (quiet = false) => {
    if (!token) return;
    if (!quiet) setLoading(true);
    try {
      const [healthResponse, subscriptionResponse, deliveryResponse, eventResponse] = await Promise.all([
        axios.get(`${API}/events/backbone/health`, { headers }),
        axios.get(`${API}/events/backbone/subscriptions`, { headers }),
        axios.get(`${API}/events/backbone/deliveries?limit=40`, { headers }),
        axios.get(`${API}/events/platform/recent?limit=20`, { headers }),
      ]);
      setHealth(healthResponse.data);
      setSubscriptions(subscriptionResponse.data || []);
      setDeliveries(deliveryResponse.data || []);
      setEvents(eventResponse.data || []);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Event backbone evidence could not be loaded");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [headers, token]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    setWorking(true);
    try {
      const response = await axios.post(`${API}/events/backbone/subscriptions`, {
        name: subscriptionForm.name,
        description: subscriptionForm.description,
        subject_patterns: subscriptionForm.subjectPatterns.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean),
        delivery_type: subscriptionForm.deliveryType,
        endpoint_url: subscriptionForm.deliveryType === "webhook" ? subscriptionForm.endpointUrl : undefined,
      }, { headers });
      setSubscriptionOpen(false);
      setSubscriptionForm(EMPTY_SUBSCRIPTION);
      setSecret(response.data?.signing_secret ? response.data : null);
      toast.success("Governed event subscription created");
      await load(true);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Event subscription could not be created");
    } finally {
      setWorking(false);
    }
  };

  const toggleSubscription = async (subscription) => {
    setWorking(true);
    try {
      await axios.patch(`${API}/events/backbone/subscriptions/${subscription.id}`, {
        enabled: !subscription.enabled,
      }, { headers });
      toast.success(subscription.enabled ? "Subscription paused" : "Subscription enabled");
      await load(true);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Subscription state could not be changed");
    } finally {
      setWorking(false);
    }
  };

  const rotateSecret = async (subscription) => {
    setWorking(true);
    try {
      const response = await axios.post(`${API}/events/backbone/subscriptions/${subscription.id}/rotate-secret`, {}, { headers });
      setSecret({ ...response.data, name: subscription.name });
      toast.success("Webhook signing secret rotated");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Signing secret could not be rotated");
    } finally {
      setWorking(false);
    }
  };

  const processQueue = async () => {
    setWorking(true);
    try {
      const response = await axios.post(`${API}/events/backbone/deliveries/process`, { limit: 100 }, { headers });
      const result = response.data;
      toast.success(result.processed ? `Processed ${result.processed} event deliveries` : "The delivery queue is already current");
      await load(true);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Delivery queue could not be processed");
    } finally {
      setWorking(false);
    }
  };

  const retry = async (delivery) => {
    setWorking(true);
    try {
      await axios.post(`${API}/events/backbone/deliveries/${delivery.id}/retry`, {}, { headers });
      toast.success("Delivery returned to the governed retry queue");
      await load(true);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Delivery could not be retried");
    } finally {
      setWorking(false);
    }
  };

  const replayPayload = (dryRun) => ({
    subject: replayForm.subject.trim() || undefined,
    from_time: replayForm.fromTime ? new Date(replayForm.fromTime).toISOString() : undefined,
    to_time: replayForm.toTime ? new Date(replayForm.toTime).toISOString() : undefined,
    reason: replayForm.reason.trim(),
    dry_run: dryRun,
  });

  const previewReplay = async () => {
    setWorking(true);
    try {
      const response = await axios.post(`${API}/events/backbone/replay`, replayPayload(true), { headers });
      setReplayPreview(response.data);
      toast.success("Replay preview calculated without sending anything");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Replay preview could not be calculated");
    } finally {
      setWorking(false);
    }
  };

  const executeReplay = async () => {
    if (!replayForm.reason.trim()) {
      toast.info("Add an audit reason before creating a replay");
      return;
    }
    setWorking(true);
    try {
      const response = await axios.post(`${API}/events/backbone/replay`, replayPayload(false), { headers });
      toast.success(`Created ${response.data.delivery_count || 0} replay deliveries`);
      setReplayOpen(false);
      setReplayPreview(null);
      await load(true);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Governed replay could not be created");
    } finally {
      setWorking(false);
    }
  };

  const deadLetters = deliveries.filter((item) => item.status === "dead_letter");
  return (
    <div className="space-y-4" data-testid="event-backbone-panel">
      <Card className="overflow-hidden border-cyan-500/20 bg-gradient-to-br from-cyan-500/[0.055] via-card to-sky-500/[0.025]">
        <CardHeader className="border-b border-border/70">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="flex items-center gap-2 text-base"><Radio className="h-4 w-4 text-cyan-300" />Nexus event backbone</CardTitle>
                <Badge variant="outline" className={statusStyle(health?.status)}>{health?.status || "checking"}</Badge>
                <Badge variant="outline" className="font-mono text-[10px]">at-least-once</Badge>
              </div>
              <CardDescription className="mt-1">Immutable events, tenant-scoped idempotency, ordered partitions, signed subscriber delivery, retries, dead-letter evidence and governed replay.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => load()} disabled={loading || working}><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
              <Button variant="outline" size="sm" onClick={processQueue} disabled={working}><Play className="mr-1.5 h-3.5 w-3.5" />Process queue</Button>
              <Button variant="outline" size="sm" onClick={() => setReplayOpen(true)} disabled={working}><Repeat2 className="mr-1.5 h-3.5 w-3.5" />Replay</Button>
              <Button size="sm" onClick={() => setSubscriptionOpen(true)} disabled={working}><Plus className="mr-1.5 h-3.5 w-3.5" />Subscriber</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <HeroTile label="Events · 24h" value={health?.events_24h ?? 0} icon={Activity} glow="cyan" subtitle={`Latest ${health?.latest_event?.subject || "awaiting publisher"}`} />
            <HeroTile label="Delivery queue" value={health?.queue_depth ?? 0} icon={Send} glow={health?.queue_depth ? "amber" : "emerald"} subtitle={`${health?.retrying ?? 0} waiting to retry`} />
            <HeroTile label="Delivery success" value={`${health?.delivery_success_rate ?? 100}%`} icon={CheckCircle2} glow="emerald" subtitle={`${health?.delivered_24h ?? 0} delivered in 24h`} />
            <HeroTile label="Dead letter" value={health?.dead_letter ?? 0} icon={ShieldAlert} glow={health?.dead_letter ? "rose" : "zinc"} subtitle={`${health?.enabled_subscriptions ?? 0} enabled subscribers`} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
            <div className="rounded-xl border border-border/70 bg-muted/10 p-3">
              <div className="flex items-center justify-between gap-3">
                <div><p className="text-sm font-semibold">Governed subscribers</p><p className="mt-0.5 text-xs text-muted-foreground">Each consumer declares its subjects and keeps a separate delivery checkpoint.</p></div>
                <Badge variant="outline">{subscriptions.length}</Badge>
              </div>
              <div className="mt-3 space-y-2">
                {subscriptions.map((subscription) => (
                  <div key={subscription.id} className="rounded-xl border border-border/70 bg-black/10 p-3">
                    <div className="flex flex-wrap items-start gap-2">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-500/20 bg-cyan-500/[0.05]">
                        {subscription.delivery_type === "webhook" ? <Webhook className="h-4 w-4 text-cyan-200" /> : <ServerCog className="h-4 w-4 text-cyan-200" />}
                      </div>
                      <div className="min-w-0 flex-1"><p className="text-sm font-medium">{subscription.name}</p><p className="mt-0.5 truncate text-[11px] text-muted-foreground">{subscription.endpoint_url || "Internal audit checkpoint"}</p></div>
                      <Badge variant="outline" className={subscription.enabled ? statusStyle("healthy") : ""}>{subscription.enabled ? "enabled" : "paused"}</Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">{subscription.subject_patterns?.map((pattern) => <Badge key={pattern} variant="outline" className="font-mono text-[9px]">{pattern}</Badge>)}</div>
                    <div className="mt-3 flex justify-end gap-2">
                      {subscription.delivery_type === "webhook" && <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => rotateSecret(subscription)} disabled={working}><KeyRound className="mr-1 h-3 w-3" />Rotate secret</Button>}
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => toggleSubscription(subscription)} disabled={working}>{subscription.enabled ? "Pause" : "Enable"}</Button>
                    </div>
                  </div>
                ))}
                {!subscriptions.length && <div className="rounded-xl border border-dashed border-border p-6 text-center"><Webhook className="mx-auto h-6 w-6 text-muted-foreground" /><p className="mt-2 text-sm font-medium">No subscribers yet</p><p className="mt-1 text-xs text-muted-foreground">Events are retained even before the first consumer is connected.</p></div>}
              </div>
            </div>

            <div className="rounded-xl border border-border/70 bg-muted/10 p-3">
              <div className="flex items-center justify-between gap-3">
                <div><p className="text-sm font-semibold">Delivery operations</p><p className="mt-0.5 text-xs text-muted-foreground">Attempts, failures and replay deliveries remain separate from the immutable event.</p></div>
                <Badge variant="outline" className={deadLetters.length ? statusStyle("dead_letter") : statusStyle("healthy")}>{deadLetters.length} dead letter</Badge>
              </div>
              <div className="mt-3 space-y-2">
                {deliveries.slice(0, 8).map((delivery) => (
                  <div key={delivery.id} className="flex items-start gap-3 rounded-xl border border-border/70 bg-black/10 p-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/70"><Send className="h-3.5 w-3.5 text-cyan-200" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5"><code className="truncate text-[11px] text-cyan-100">{delivery.subject}</code><Badge variant="outline" className={`${statusStyle(delivery.status)} text-[9px]`}>{delivery.status?.replaceAll("_", " ")}</Badge>{delivery.replay_id && <Badge variant="outline" className="text-[9px]">replay</Badge>}</div>
                      <p className="mt-1 text-[11px] text-muted-foreground">{delivery.subscription_name} · {delivery.attempts || 0}/{delivery.max_attempts || 0} attempts · {dateLabel(delivery.updated_at)}</p>
                      {delivery.last_error && <p className="mt-1 line-clamp-2 text-[10px] text-rose-200">{delivery.last_error}</p>}
                    </div>
                    {delivery.status === "dead_letter" && <Button variant="outline" size="sm" className="h-7 px-2" onClick={() => retry(delivery)} disabled={working}><RotateCw className="h-3 w-3" /></Button>}
                  </div>
                ))}
                {!deliveries.length && <div className="rounded-xl border border-dashed border-border p-6 text-center"><Clock3 className="mx-auto h-6 w-6 text-muted-foreground" /><p className="mt-2 text-sm font-medium">No delivery attempts yet</p><p className="mt-1 text-xs text-muted-foreground">A matching published event will create the first checkpoint.</p></div>}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border/70 bg-muted/10 p-3">
            <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold">Immutable event journal</p><p className="mt-0.5 text-xs text-muted-foreground">Recent envelopes preserve correlation, partition order and retention evidence.</p></div><Badge variant="outline">{events.length} shown</Badge></div>
            <div className="mt-3 grid gap-2 lg:grid-cols-2">
              {events.slice(0, 10).map((event) => (
                <div key={event.id} className="rounded-lg border border-border/70 bg-black/10 p-2.5">
                  <div className="flex items-center justify-between gap-2"><code className="truncate text-xs text-cyan-100">{event.subject}</code><span className="font-mono text-[10px] text-muted-foreground">#{event.sequence || "legacy"}</span></div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground"><span>{event.partition_key || "legacy partition"}</span><span>{dateLabel(event.occurred_at)}</span><span>{event.source}</span></div>
                </div>
              ))}
              {!events.length && <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground lg:col-span-2">The first module event will appear here with its retained delivery evidence.</div>}
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={subscriptionOpen} onOpenChange={setSubscriptionOpen}>
        <DialogContent className="max-w-2xl" data-testid="event-subscription-dialog">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Webhook className="h-5 w-5 text-cyan-300" />Connect an event subscriber</DialogTitle><DialogDescription>Declare only the subjects this consumer owns. Webhooks receive HMAC-signed envelopes and an idempotency key for safe at-least-once processing.</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-2"><Label>Subscriber name</Label><Input value={subscriptionForm.name} onChange={(event) => setSubscriptionForm((current) => ({ ...current, name: event.target.value }))} placeholder="Service Desk automations" /></div>
            <div className="space-y-2"><Label>Delivery type</Label><Select value={subscriptionForm.deliveryType} onValueChange={(value) => setSubscriptionForm((current) => ({ ...current, deliveryType: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="webhook">Signed webhook</SelectItem><SelectItem value="audit">Internal audit checkpoint</SelectItem></SelectContent></Select></div>
            <div className="space-y-2 sm:col-span-2"><Label>Purpose</Label><Input value={subscriptionForm.description} onChange={(event) => setSubscriptionForm((current) => ({ ...current, description: event.target.value }))} placeholder="What consumes these events and who owns it?" /></div>
            <div className="space-y-2 sm:col-span-2"><Label>Subject patterns · one per line</Label><Textarea rows={4} className="font-mono text-xs" value={subscriptionForm.subjectPatterns} onChange={(event) => setSubscriptionForm((current) => ({ ...current, subjectPatterns: event.target.value }))} placeholder={"ticket.*\ndevice.health.*"} /></div>
            {subscriptionForm.deliveryType === "webhook" && <div className="space-y-2 sm:col-span-2"><Label>HTTPS endpoint</Label><Input value={subscriptionForm.endpointUrl} onChange={(event) => setSubscriptionForm((current) => ({ ...current, endpointUrl: event.target.value }))} placeholder="https://automation.example.com/nexus/events" /><p className="text-[11px] text-muted-foreground">Redirects are not followed. The signing secret is shown once after creation.</p></div>}
          </div>
          <div className="flex justify-end gap-2 border-t border-border pt-4"><Button variant="outline" onClick={() => setSubscriptionOpen(false)} disabled={working}>Cancel</Button><Button onClick={create} disabled={working || subscriptionForm.name.trim().length < 3}>{working && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Create subscriber</Button></div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(secret)} onOpenChange={(open) => !open && setSecret(null)}>
        <DialogContent className="max-w-xl" data-testid="event-secret-dialog">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-amber-300" />Copy the signing secret now</DialogTitle><DialogDescription>NexusMSP stores this encrypted and will not show it again. The receiver should verify the X-Nexus-Signature HMAC before accepting a delivery.</DialogDescription></DialogHeader>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4"><p className="text-xs font-medium">{secret?.name || "Webhook subscription"}</p><code className="mt-2 block break-all rounded-lg border border-border bg-black/20 p-3 text-xs text-amber-100">{secret?.signing_secret}</code></div>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => navigator.clipboard.writeText(secret?.signing_secret || "").then(() => toast.success("Signing secret copied"))}>Copy secret</Button><Button onClick={() => setSecret(null)}>I have stored it</Button></div>
        </DialogContent>
      </Dialog>

      <Dialog open={replayOpen} onOpenChange={(open) => { setReplayOpen(open); if (!open) setReplayPreview(null); }}>
        <DialogContent className="max-w-2xl" data-testid="event-replay-dialog">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Repeat2 className="h-5 w-5 text-violet-300" />Governed event replay</DialogTitle><DialogDescription>Preview the exact delivery count before replaying retained immutable events. Replays create new delivery checkpoints and never rewrite the original event.</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2"><Label>Exact event subject</Label><Input className="font-mono text-xs" value={replayForm.subject} onChange={(event) => { setReplayForm((current) => ({ ...current, subject: event.target.value })); setReplayPreview(null); }} placeholder="ticket.created" /></div>
            <div className="space-y-2"><Label>From · optional</Label><Input type="datetime-local" value={replayForm.fromTime} onChange={(event) => { setReplayForm((current) => ({ ...current, fromTime: event.target.value })); setReplayPreview(null); }} /></div>
            <div className="space-y-2"><Label>To · optional</Label><Input type="datetime-local" value={replayForm.toTime} onChange={(event) => { setReplayForm((current) => ({ ...current, toTime: event.target.value })); setReplayPreview(null); }} /></div>
            <div className="space-y-2 sm:col-span-2"><Label>Audit reason</Label><Textarea rows={3} value={replayForm.reason} onChange={(event) => setReplayForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Why is redelivery required, and which incident or change authorises it?" /></div>
          </div>
          {replayPreview && <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.04] p-4"><p className="text-sm font-semibold">Safe preview</p><div className="mt-2 grid grid-cols-3 gap-2 text-center"><div><p className="text-lg font-semibold">{replayPreview.event_count}</p><p className="text-[10px] text-muted-foreground">events</p></div><div><p className="text-lg font-semibold">{replayPreview.subscription_count}</p><p className="text-[10px] text-muted-foreground">subscribers</p></div><div><p className="text-lg font-semibold">{replayPreview.delivery_count}</p><p className="text-[10px] text-muted-foreground">deliveries</p></div></div></div>}
          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4"><Button variant="outline" onClick={() => setReplayOpen(false)} disabled={working}>Cancel</Button><Button variant="outline" onClick={previewReplay} disabled={working || !replayForm.subject.trim()}>{working && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Preview only</Button><Button onClick={executeReplay} disabled={working || !replayPreview || !replayForm.reason.trim()}><Repeat2 className="mr-1.5 h-4 w-4" />Create replay</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
