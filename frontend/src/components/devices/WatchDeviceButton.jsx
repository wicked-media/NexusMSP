import { useState, useEffect } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { API } from "@/App";

/**
 * Watch / unwatch toggle button — adds a device to the user's personal Workspace
 * watched-devices list so it surfaces in /workspace.
 */
export default function WatchDeviceButton({ deviceId, token, deviceName }) {
  const headers = { Authorization: `Bearer ${token}` };
  const [watched, setWatched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!deviceId) return;
    setChecking(true);
    // Simply look at workspace state for this device
    axios.get(`${API}/workspace`, { headers })
      .then(r => {
        const watchedIds = (r.data?.watched_devices || []).map(d => d.id);
        setWatched(watchedIds.includes(deviceId));
      })
      .catch(() => setWatched(false))
      .finally(() => setChecking(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  const toggle = async () => {
    setLoading(true);
    try {
      if (watched) {
        await axios.delete(`${API}/workspace/watch/device/${deviceId}`, { headers });
        setWatched(false);
        toast.success(`Stopped watching ${deviceName || deviceId}`);
      } else {
        await axios.post(`${API}/workspace/watch/device/${deviceId}`, { reason: "manual watch" }, { headers });
        setWatched(true);
        toast.success(`Now watching ${deviceName || deviceId} 👁️`);
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to toggle watch");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant="outline" size="sm"
      onClick={toggle}
      disabled={loading || checking}
      className={watched ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-700 hover:bg-cyan-500/20 dark:text-cyan-300" : ""}
      title={watched ? "Stop watching this device" : "Add to my workspace watch list"}
      data-testid="watch-device-btn"
    >
      {loading || checking
        ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
        : watched
          ? <Eye className="w-3.5 h-3.5 mr-1" />
          : <EyeOff className="w-3.5 h-3.5 mr-1" />}
      {watched ? "Watching" : "Watch"}
    </Button>
  );
}
