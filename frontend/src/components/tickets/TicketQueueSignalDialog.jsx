import { useEffect, useMemo, useState } from "react";
import { Link2, Loader2, Monitor, Search, Send } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatCheckpointTime } from "@/lib/ticketCasePulse";

const CHECKPOINT_HORIZON_MS = 366 * 24 * 60 * 60 * 1000;

function toLocalInputValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function defaultCheckpointAt(ticket) {
  const now = Date.now();
  const existing = ticket?.next_checkpoint_at ? new Date(ticket.next_checkpoint_at) : null;
  const hasFuturePromise = existing && Number.isFinite(existing.getTime()) && existing.getTime() > now + 5 * 60_000;
  const target = hasFuturePromise ? new Date(existing.getTime()) : new Date(now + 4 * 60 * 60_000);
  target.setSeconds(0, 0);
  if (!hasFuturePromise) {
    const remainder = target.getMinutes() % 15;
    if (remainder) target.setMinutes(target.getMinutes() + 15 - remainder);
  }
  return toLocalInputValue(target);
}

const UPDATE_COPY = {
  first_update: {
    title: "Send the first update",
    description: "Acknowledge the request and tell the client what happens next.",
    placeholder: "Acknowledge the request, state what you are checking, and give the next checkpoint…",
  },
  recover: {
    title: "Send a recovery update",
    description: "The SLA target has passed. Explain what changed and when the next update will come.",
    placeholder: "Acknowledge the delay, explain the current position, and give the next checkpoint…",
  },
  checkpoint: {
    title: "Record the next checkpoint",
    description: "Work is paused. Make the dependency and the restart date visible to the client.",
    placeholder: "This is paused pending… We will move it forward on…",
  },
  next_checkpoint: {
    title: "Set the next checkpoint",
    description: "A recovery update is recorded. Confirm the next checkpoint with the client and keep the record moving.",
    placeholder: "Here is where this stands and the next checkpoint…",
  },
  promised: {
    title: "Update the promised checkpoint",
    description: "The client already has a promised next update. Send an update or move the checkpoint without losing the commitment.",
    placeholder: "Here is where this stands and what will change before the promised update…",
  },
  checkpoint_due: {
    title: "The promised update is late",
    description: "The time the client was promised an update has passed. Send an update and record the new checkpoint.",
    placeholder: "We missed the update we promised. Here is what changed, and the new time you can expect…",
  },
  protect: {
    title: "Protect the SLA window",
    description: "The target is close. Send a concise status update before the window closes.",
    placeholder: "Here is where this stands and what happens next…",
  },
  catch_up: {
    title: "Catch the record up",
    description: "No activity has been recorded for a while. Re-establish the next concrete step.",
    placeholder: "Here is the current position and the next step…",
  },
  add_update: {
    title: "Add the next update",
    description: "Capture the next concrete step so the record stays useful to the team and the client.",
    placeholder: "Summarise the next step…",
  },
};

function UpdateDialog({ action, busy, onOpenChange, onSendUpdate }) {
  const [note, setNote] = useState("");
  const [nextCheckpointAt, setNextCheckpointAt] = useState(() => defaultCheckpointAt(action.ticket));
  const move = action.move;
  const copy = UPDATE_COPY[move.key] || UPDATE_COPY.add_update;
  const checkpointDate = nextCheckpointAt ? new Date(nextCheckpointAt) : null;
  const checkpointValid = Boolean(
    checkpointDate
    && Number.isFinite(checkpointDate.getTime())
    && checkpointDate.getTime() > Date.now(),
  );
  const checkpointMin = toLocalInputValue(new Date(Date.now() + 60_000));
  const checkpointMax = toLocalInputValue(new Date(Date.now() + CHECKPOINT_HORIZON_MS));

  useEffect(() => {
    setNote("");
    setNextCheckpointAt(defaultCheckpointAt(action.ticket));
  }, [action.key, action.ticket]);

  const submit = () => {
    if (!note.trim() || !checkpointValid || busy) return;
    onSendUpdate?.(action.ticket, note.trim(), action.key, move, nextCheckpointAt);
  };

  return (
    <NexusWorkflowDialog
      eyebrow={`Queue action · ${action.ticket.ticket_number || "Ticket"}`}
      title={copy.title}
      description={copy.description}
      icon={Send}
      tone={move.tone === "critical" ? "rose" : "amber"}
      className="max-w-2xl"
      data-testid="queue-update-dialog"
      footer={<>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
        <Button type="button" onClick={submit} disabled={!note.trim() || !checkpointValid || busy} data-testid="queue-update-submit">
          {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
          Publish update
        </Button>
      </>}
    >
      <div className="rounded-xl border border-amber-300/15 bg-amber-400/[0.045] px-3 py-2.5">
        <p className="text-xs font-semibold text-amber-100">{action.ticket.title || "Service request"}</p>
        <p className="mt-1 text-[11px] leading-5 text-zinc-400">{move.detail}</p>
      </div>
      <div className="mt-4">
        <label htmlFor="queue-update-note" className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Customer-visible update</label>
        <Textarea
          id="queue-update-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={copy.placeholder}
          rows={4}
          maxLength={50_000}
          autoFocus
          className="mt-2 min-h-24 resize-y border-white/[0.09] bg-black/15 text-sm leading-6"
          data-testid="queue-update-input"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-zinc-600">
          <span>Published to the client portal. No email is sent from the queue.</span>
          <span className="font-mono tabular-nums">{note.length.toLocaleString()}/50,000</span>
        </div>
      </div>
      <div className="mt-4 rounded-xl border border-cyan-300/15 bg-cyan-400/[0.035] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="queue-update-checkpoint" className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-200/80">
            Next update promised
          </label>
          <span className="font-mono text-[10px] text-zinc-500">
            {checkpointValid ? formatCheckpointTime(checkpointDate) : "Choose a future time"}
          </span>
        </div>
        <Input
          id="queue-update-checkpoint"
          type="datetime-local"
          value={nextCheckpointAt}
          min={checkpointMin}
          max={checkpointMax}
          step={900}
          onChange={(event) => setNextCheckpointAt(event.target.value)}
          className="mt-2 h-10 border-white/[0.09] bg-black/15 text-xs text-zinc-200"
          aria-invalid={!checkpointValid}
          aria-describedby="queue-update-checkpoint-help"
          data-testid="queue-update-checkpoint"
        />
        <p id="queue-update-checkpoint-help" className="mt-2 text-[10px] leading-4 text-zinc-500">
          Stored on the ticket and shown in the queue and service pulse. The client is not emailed from this action.
        </p>
        {!checkpointValid && (
          <p className="mt-1 text-[10px] font-medium text-amber-300" role="alert">
            Choose a future checkpoint before publishing.
          </p>
        )}
      </div>
    </NexusWorkflowDialog>
  );
}

function DeviceDialog({ action, devices, busy, onOpenChange, onLinkDevice }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const ticket = action.ticket;
  const linkedIds = useMemo(
    () => new Set([...(ticket.device_ids || []), ticket.device_id].filter(Boolean).map(String)),
    [ticket.device_ids, ticket.device_id],
  );
  const availableDevices = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return devices
      .filter((device) => device.client_id && device.client_id === ticket.client_id && !linkedIds.has(String(device.id)))
      .filter((device) => !needle || [device.name, device.hostname, device.device_type].filter(Boolean).some((value) => String(value).toLowerCase().includes(needle)))
      .slice(0, 100);
  }, [devices, linkedIds, query, ticket.client_id]);

  useEffect(() => {
    setQuery("");
    setSelected("");
  }, [action.key]);

  const submit = () => {
    if (!selected || busy) return;
    onLinkDevice?.(ticket, selected);
  };

  return (
    <NexusWorkflowDialog
      eyebrow={`Queue action · ${ticket.ticket_number || "Ticket"}`}
      title="Link an endpoint"
      description="Attach the affected managed device so diagnostics and remote evidence stay with this incident."
      icon={Link2}
      tone="cyan"
      className="max-w-2xl"
      data-testid="queue-device-dialog"
      footer={<>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
        <Button type="button" onClick={submit} disabled={!selected || busy} data-testid="queue-device-submit">
          {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Link2 className="mr-1.5 h-3.5 w-3.5" />}
          Link endpoint
        </Button>
      </>}
    >
      <div className="rounded-xl border border-cyan-300/15 bg-cyan-400/[0.045] px-3 py-2.5">
        <p className="text-xs font-semibold text-cyan-100">{ticket.title || "Service request"}</p>
        <p className="mt-1 text-[11px] leading-5 text-zinc-400">Only active endpoints for {ticket.client_name || "this client"} can be linked.</p>
      </div>
      <div className="relative mt-4">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search endpoint name, hostname or type…"
          className="h-9 border-white/[0.09] bg-black/15 pl-9 text-xs"
          aria-label="Search endpoints"
          data-testid="queue-device-search"
        />
      </div>
      <div className="mt-3 max-h-64 space-y-1 overflow-y-auto rounded-xl border border-white/[0.08] bg-black/[0.12] p-1.5" data-testid="queue-device-list">
        {availableDevices.length ? availableDevices.map((device) => {
          const isSelected = selected === device.id;
          return (
            <button
              key={device.id}
              type="button"
              onClick={() => setSelected(device.id)}
              className={`flex w-full items-center gap-3 rounded-lg border px-2.5 py-2 text-left transition-colors ${isSelected ? "border-cyan-300/35 bg-cyan-400/[0.08]" : "border-transparent hover:border-white/[0.08] hover:bg-white/[0.03]"}`}
              aria-pressed={isSelected}
              data-testid={`queue-device-${device.id}`}
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-white/[0.08] bg-black/20 text-cyan-200"><Monitor className="h-3.5 w-3.5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-zinc-200">{device.name || device.hostname || device.id}</span>
                <span className="mt-0.5 block truncate text-[10px] text-zinc-500">{device.hostname || device.device_type || "Managed endpoint"}</span>
              </span>
              <span className={`shrink-0 font-mono text-[9px] uppercase tracking-[0.1em] ${device.status === "online" ? "text-emerald-300" : "text-zinc-600"}`}>
                {device.status || "recorded"}
              </span>
            </button>
          );
        }) : (
          <div className="px-3 py-8 text-center">
            <Monitor className="mx-auto h-5 w-5 text-zinc-700" />
            <p className="mt-2 text-xs text-zinc-400">{ticket.client_id ? "No available endpoints for this client." : "This ticket has no client record to match endpoints against."}</p>
            <p className="mt-1 text-[10px] text-zinc-600">{query ? "Try a different search." : "Manage endpoints from the client profile first."}</p>
          </div>
        )}
      </div>
    </NexusWorkflowDialog>
  );
}

export default function TicketQueueSignalDialog({
  action,
  devices = [],
  busy = false,
  onOpenChange,
  onSendUpdate,
  onLinkDevice,
}) {
  if (!action) return null;
  const isDevice = action.move?.key === "endpoint";
  return (
    <Dialog open onOpenChange={(open) => { if (!busy) onOpenChange?.(open); }}>
      {isDevice ? <DeviceDialog action={action} devices={devices} busy={busy} onOpenChange={onOpenChange} onLinkDevice={onLinkDevice} /> : <UpdateDialog action={action} busy={busy} onOpenChange={onOpenChange} onSendUpdate={onSendUpdate} />}
    </Dialog>
  );
}
