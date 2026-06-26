/* TopTalkersPanel.jsx — top 5 CPU/RAM/Disk pressure devices. Auto-refreshes. */
import { useEffect, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { API, useAuth } from "@/App";
import { Card } from "@/components/ui/card";
import { Cpu, MemoryStick, HardDrive } from "lucide-react";

function Bar({ value, color }) {
  return (
    <div className="h-1 rounded-full bg-zinc-800 overflow-hidden">
      <div className={`h-full ${color} transition-all`} style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  );
}

function List({ icon: Icon, label, items, color, navigate, testid }) {
  return (
    <Card className="p-3 bg-zinc-900/40 border-zinc-800/60" data-testid={testid}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-3.5 h-3.5 text-violet-300" />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300">{label}</p>
      </div>
      <div className="space-y-1.5">
        {items.length === 0 && <p className="text-[10px] text-zinc-500">No data.</p>}
        {items.map((it, i) => (
          <button
            key={it.id || i}
            onClick={() => it.id && navigate(`/devices/${it.id}`)}
            className="w-full text-left group"
            data-testid={`${testid}-row-${i}`}
          >
            <div className="flex items-center justify-between text-[11px]">
              <span className="truncate text-zinc-200 group-hover:text-violet-200">{it.name}</span>
              <span className="font-mono text-zinc-400 flex-shrink-0">{Math.round(it.value)}%</span>
            </div>
            <Bar value={it.value} color={color} />
          </button>
        ))}
      </div>
    </Card>
  );
}

export default function TopTalkersPanel() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState({ cpu: [], ram: [], disk: [] });

  useEffect(() => {
    let live = true;
    const tick = () => axios.get(`${API}/devices/top-talkers`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (live) setData(r.data || {}); }).catch(() => {});
    tick();
    const id = setInterval(tick, 15000);
    return () => { live = false; clearInterval(id); };
  }, [token]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3" data-testid="top-talkers-panel">
      <List icon={Cpu} label="Top CPU" items={data.cpu || []} color="bg-red-500" navigate={navigate} testid="top-talkers-cpu" />
      <List icon={MemoryStick} label="Top RAM" items={data.ram || []} color="bg-amber-400" navigate={navigate} testid="top-talkers-ram" />
      <List icon={HardDrive} label="Top Disk" items={data.disk || []} color="bg-cyan-400" navigate={navigate} testid="top-talkers-disk" />
    </div>
  );
}
