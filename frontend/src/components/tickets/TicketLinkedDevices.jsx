import { useState, useMemo } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, X, Monitor, Star, ExternalLink, Radio, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { API } from "@/App";

/**
 * Multi-device chip-list editor for a ticket (Syncro-style).
 * - Shows current device_ids as chips
 * - Star indicates primary device (legacy device_id field)
 * - + dropdown to link more devices (filtered to ticket's client + not already linked)
 * - X to unlink, Star to promote a chip to primary
 */
export default function TicketLinkedDevices({ ticket, devices, token, onChange }) {
  const navigate = useNavigate();
  const [picker, setPicker] = useState("");
  const [busy, setBusy] = useState(false);
  const [remoteBusyId, setRemoteBusyId] = useState(null);
  const [remoteSession, setRemoteSession] = useState(null);
  const headers = { Authorization: `Bearer ${token}` };

  // Normalize: device_ids array; ensure primary device_id is included
  const linkedIds = useMemo(() => {
    const ids = [...(ticket.device_ids || [])];
    if (ticket.device_id && !ids.includes(ticket.device_id)) ids.unshift(ticket.device_id);
    return ids;
  }, [ticket.device_ids, ticket.device_id]);

  const linkedDevices = useMemo(() => {
    return linkedIds.map(id => {
      const d = devices.find(x => x.id === id);
      return d || { id, name: id, _missing: true };
    });
  }, [linkedIds, devices]);

  const candidates = useMemo(() => {
    return devices
      .filter(d => !linkedIds.includes(d.id))
      .filter(d => !ticket.client_id || d.client_id === ticket.client_id);
  }, [devices, linkedIds, ticket.client_id]);

  const handleAdd = async () => {
    if (!picker || busy) return;
    setBusy(true);
    try {
      const r = await axios.post(`${API}/tickets/${ticket.id}/devices`, { device_id: picker }, { headers });
      onChange?.({
        device_ids: r.data.device_ids,
        device_names: r.data.device_names,
        device_id: ticket.device_id || picker,
        device_name: ticket.device_name || (devices.find(d => d.id === picker)?.name) || picker,
      });
      toast.success("Device linked");
      setPicker("");
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to link device"); }
    finally { setBusy(false); }
  };

  const launchNative = (connectionUrl) => {
    if (!connectionUrl) return;
    const anchor = document.createElement("a");
    anchor.href = connectionUrl;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    window.setTimeout(() => document.body.removeChild(anchor), 100);
  };

  const handleRemote = async (device, event) => {
    event?.preventDefault();
    event?.stopPropagation();
    if (remoteBusyId) return;
    setRemoteBusyId(device.id);
    try {
      const { data } = await axios.post(`${API}/tickets/${ticket.id}/devices/${device.id}/remote-connect`, {}, { headers });
      setRemoteSession(data);
      toast.success(`Remote session prepared for ${data.device_name}`);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Remote connection could not be prepared");
    } finally {
      setRemoteBusyId(null);
    }
  };

  const handleRemove = async (deviceId) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await axios.delete(`${API}/tickets/${ticket.id}/devices/${deviceId}`, { headers });
      const newPrimary = r.data.device_ids?.[0] || null;
      onChange?.({
        device_ids: r.data.device_ids,
        device_names: r.data.device_names,
        device_id: ticket.device_id === deviceId ? newPrimary : ticket.device_id,
        device_name: ticket.device_id === deviceId ? (devices.find(d => d.id === newPrimary)?.name || null) : ticket.device_name,
      });
      toast.success("Device unlinked");
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to unlink"); }
    finally { setBusy(false); }
  };

  const handlePromote = async (deviceId) => {
    if (busy) return;
    setBusy(true);
    try {
      // Set primary device — use the existing PATCH endpoint for ticket
      await axios.put(`${API}/tickets/${ticket.id}`, { device_id: deviceId }, { headers });
      onChange?.({
        device_id: deviceId,
        device_name: devices.find(d => d.id === deviceId)?.name || deviceId,
      });
      toast.success("Primary device updated");
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to set primary"); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-2" data-testid="ticket-linked-devices">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">Linked assets</Label>
        <span className="text-[10px] text-muted-foreground">{linkedDevices.length} linked</span>
      </div>

      {linkedDevices.length === 0 && (
        <p className="text-[11px] text-muted-foreground italic">No assets linked. Add one below to work from this ticket.</p>
      )}

      <div className="space-y-2">
        {linkedDevices.map(d => {
          const isPrimary = ticket.device_id === d.id;
          return (
            <div
              key={d.id}
              className={`group flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[11px] transition-all ${
                isPrimary
                  ? "border-cyan-400/30 bg-cyan-400/[0.07] text-zinc-100"
                  : "border-white/[0.08] bg-black/10 hover:border-cyan-400/20 hover:bg-cyan-400/[0.035]"
              }`}
              data-testid={`linked-device-chip-${d.id}`}
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${d.status === "online" ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" : "bg-zinc-600"}`} />
              <Monitor className="h-3.5 w-3.5 shrink-0 text-cyan-300" />
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left font-medium hover:text-cyan-200 hover:underline"
                onClick={() => navigate(`/devices/${d.id}`)}
                title={d._missing ? "Device not found" : `Open ${d.name}`}
              >
                {d.name}
              </button>
              {isPrimary && <span className="rounded border border-cyan-400/25 bg-cyan-400/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-cyan-200">Primary</span>}
              <Button type="button" size="sm" variant="outline" className="h-7 border-cyan-400/25 bg-cyan-400/[0.04] px-2 text-[10px] text-cyan-100 hover:bg-cyan-400/15" onClick={(event) => handleRemote(d, event)} disabled={!!remoteBusyId || d._missing} data-testid={`linked-device-remote-${d.id}`}>
                {remoteBusyId === d.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Radio className="mr-1 h-3 w-3" />}Remote
              </Button>
              {!isPrimary && (
                <button
                  type="button"
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-amber-400 hover:bg-amber-500/20 rounded p-0.5"
                  onClick={() => handlePromote(d.id)}
                  title="Make primary device"
                  data-testid={`linked-device-promote-${d.id}`}
                >
                  <Star className="w-2.5 h-2.5" />
                </button>
              )}
              <button
                type="button"
                className="opacity-60 hover:opacity-100 hover:bg-red-500/20 hover:text-red-400 rounded p-0.5 transition-all"
                onClick={() => handleRemove(d.id)}
                title="Unlink"
                data-testid={`linked-device-remove-${d.id}`}
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          );
        })}
      </div>

      {candidates.length > 0 && (
        <div className="flex items-center gap-1.5">
          <Select value={picker || "__none"} onValueChange={v => setPicker(v === "__none" ? "" : v)}>
            <SelectTrigger className="h-7 text-xs flex-1" data-testid="link-device-select">
              <SelectValue placeholder="+ Link another device" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">Choose device...</SelectItem>
              {candidates.map(d => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name} {d.os && <span className="text-muted-foreground"> - {d.os}</span>}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm" variant="outline"
            className="h-7 border-cyan-400/25 bg-cyan-400/[0.04] px-2.5 text-[10px] text-cyan-100 hover:bg-cyan-400/15"
            onClick={handleAdd}
            disabled={!picker || busy}
            data-testid="link-device-add-btn"
          >
            <Plus className="mr-1 h-3 w-3" />Link
          </Button>
        </div>
      )}

      {linkedDevices.length > 0 && ticket.device_id && (
        <Button
          variant="link" size="sm"
          className="px-0 h-6 text-[11px]"
          onClick={() => navigate(`/devices/${ticket.device_id}`)}
          data-testid="view-device-link"
        >
          <ExternalLink className="w-3 h-3 mr-1" />
          Open primary device
        </Button>
      )}

      <Dialog open={!!remoteSession} onOpenChange={(open) => !open && setRemoteSession(null)}>
        <DialogContent className="max-w-md border-cyan-400/25 bg-[linear-gradient(145deg,rgba(10,24,32,0.98),rgba(11,14,20,0.98))]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-cyan-100"><span className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-400/25 bg-cyan-400/10"><Radio className="h-4 w-4 text-cyan-300" /></span>Remote session ready</DialogTitle>
            <DialogDescription>Open the supported RustDesk session without leaving this ticket. This action is recorded in the ticket audit history.</DialogDescription>
          </DialogHeader>
          {remoteSession && <div className="space-y-3">
            <div className="rounded-lg border border-white/[0.08] bg-black/20 p-3 text-xs"><p className="font-medium text-zinc-100">{remoteSession.device_name}</p><p className="mt-1 font-mono text-[11px] text-cyan-200">RustDesk ID: {remoteSession.rustdesk_id}</p></div>
            <Button type="button" className="h-10 w-full bg-emerald-500 text-emerald-950 hover:bg-emerald-400" onClick={() => launchNative(remoteSession.connection_url)} data-testid="ticket-remote-launch-native"><Radio className="mr-2 h-4 w-4" />Open in RustDesk</Button>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" className="h-9 text-xs" onClick={() => navigator.clipboard.writeText(remoteSession.rustdesk_id).then(() => toast.success("RustDesk ID copied"))}><Copy className="mr-1.5 h-3.5 w-3.5" />Copy ID</Button>
              <Button type="button" variant="outline" className="h-9 text-xs" disabled={!remoteSession.web_client_url} onClick={() => window.open(remoteSession.web_client_url, "_blank", "noopener")}><ExternalLink className="mr-1.5 h-3.5 w-3.5" />Web console</Button>
            </div>
          </div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
