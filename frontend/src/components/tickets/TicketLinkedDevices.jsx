import { useState, useMemo } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, X, Monitor, Star, ExternalLink } from "lucide-react";
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
        <Label className="text-xs text-muted-foreground">Linked Devices</Label>
        <span className="text-[10px] text-muted-foreground">{linkedDevices.length} linked</span>
      </div>

      {linkedDevices.length === 0 && (
        <p className="text-[11px] text-muted-foreground italic">No devices linked. Add one below.</p>
      )}

      <div className="flex flex-wrap gap-1.5">
        {linkedDevices.map(d => {
          const isPrimary = ticket.device_id === d.id;
          return (
            <div
              key={d.id}
              className={`group inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded-md border text-[11px] transition-all ${
                isPrimary
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                  : "border-border bg-muted/30 hover:bg-muted/50"
              }`}
              data-testid={`linked-device-chip-${d.id}`}
            >
              <Monitor className="w-3 h-3 opacity-70" />
              <button
                className="font-medium hover:underline truncate max-w-[140px]"
                onClick={() => navigate(`/devices/${d.id}`)}
                title={d._missing ? "Device not found" : `Open ${d.name}`}
              >
                {d.name}
              </button>
              {isPrimary && <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" />}
              {!isPrimary && (
                <button
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-amber-400 hover:bg-amber-500/20 rounded p-0.5"
                  onClick={() => handlePromote(d.id)}
                  title="Make primary device"
                  data-testid={`linked-device-promote-${d.id}`}
                >
                  <Star className="w-2.5 h-2.5" />
                </button>
              )}
              <button
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
                  {d.name} {d.os && <span className="text-muted-foreground">· {d.os}</span>}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm" variant="outline"
            className="h-7 px-2"
            onClick={handleAdd}
            disabled={!picker || busy}
            data-testid="link-device-add-btn"
          >
            <Plus className="w-3 h-3" />
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
    </div>
  );
}
