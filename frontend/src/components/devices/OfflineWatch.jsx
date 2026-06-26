/* OfflineWatch.jsx — devices that went offline in last 15 min. Auto-clears. */
import { useEffect, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { API, useAuth } from "@/App";
import { Card } from "@/components/ui/card";
import { WifiOff } from "lucide-react";

export default function OfflineWatch() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [list, setList] = useState([]);

  useEffect(() => {
    let live = true;
    const tick = () => axios.get(`${API}/devices/offline-watch`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (live) setList(r.data?.devices || []); }).catch(() => {});
    tick();
    const id = setInterval(tick, 30000);
    return () => { live = false; clearInterval(id); };
  }, [token]);

  if (list.length === 0) return null;
  return (
    <Card className="p-3 bg-red-500/5 border-red-500/30" data-testid="offline-watch">
      <div className="flex items-center gap-2 mb-2">
        <WifiOff className="w-3.5 h-3.5 text-red-300" />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-red-200">
          Just went offline ({list.length})
        </p>
      </div>
      <div className="space-y-1">
        {list.slice(0, 6).map(d => (
          <button
            key={d.id}
            onClick={() => navigate(`/devices/${d.id}`)}
            className="w-full text-left text-[11px] flex items-center justify-between hover:text-red-200"
            data-testid={`offline-watch-row-${d.id}`}
          >
            <span className="truncate">{d.name}</span>
            <span className="text-[10px] text-zinc-500 ml-2 flex-shrink-0">{d.client_name}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}
