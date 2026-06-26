/* LeadsKanban.jsx — 7-column drag-and-drop board with confetti on Won. */
import { useEffect, useState, useMemo } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card } from "@/components/ui/card";
import InitialsAvatar from "./InitialsAvatar";
import LeadScoreBadge from "./LeadScoreBadge";
import { PIPELINE_STAGES, STATUS_CONFIG, money, timeAgo } from "./leadHelpers";
import { toast } from "sonner";

function fireConfetti() {
  const colors = ["#34d399", "#fbbf24", "#a78bfa", "#22d3ee", "#f472b6"];
  const root = document.createElement("div");
  root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:9999";
  document.body.appendChild(root);
  for (let i = 0; i < 80; i++) {
    const s = document.createElement("span");
    const left = Math.random() * 100;
    const delay = Math.random() * 200;
    const dur = 1400 + Math.random() * 800;
    s.style.cssText = `position:absolute;top:-10px;left:${left}%;width:8px;height:14px;background:${colors[i % colors.length]};opacity:.95;transform:rotate(${Math.random() * 360}deg);transition:transform ${dur}ms ease-out, top ${dur}ms ease-out, opacity ${dur}ms ease-out`;
    root.appendChild(s);
    setTimeout(() => {
      s.style.top = `${100 + Math.random() * 5}%`;
      s.style.transform = `translateX(${(Math.random() - 0.5) * 200}px) rotate(${Math.random() * 720}deg)`;
      s.style.opacity = "0";
    }, delay);
  }
  setTimeout(() => root.remove(), 2800);
}

export default function LeadsKanban({ leads = [], scores = {}, onOpen, onMoved }) {
  const { token } = useAuth();
  const [dragging, setDragging] = useState(null);
  const [overCol, setOverCol] = useState(null);

  const grouped = useMemo(() => {
    const out = {};
    PIPELINE_STAGES.concat(["lost"]).forEach(s => { out[s] = []; });
    leads.forEach(l => {
      const s = out[l.status] ? l.status : "new";
      out[s].push(l);
    });
    Object.values(out).forEach(arr => arr.sort((a, b) => (scores[b.id]?.overall || 0) - (scores[a.id]?.overall || 0)));
    return out;
  }, [leads, scores]);

  const onDrop = async (stage) => {
    if (!dragging || dragging.status === stage) { setDragging(null); setOverCol(null); return; }
    const id = dragging.id;
    const prevStatus = dragging.status;
    try {
      await axios.put(`${API}/leads/${id}`, { status: stage }, { headers: { Authorization: `Bearer ${token}` } });
      if (stage === "won") {
        fireConfetti();
        toast.success(`🎉 ${dragging.company_name} — WON`);
      } else if (stage === "lost") {
        toast(`💀 ${dragging.company_name} — moved to Lost`);
      } else {
        toast.success(`${dragging.company_name} → ${STATUS_CONFIG[stage]?.label}`);
      }
      onMoved && onMoved(id, prevStatus, stage);
    } catch {
      toast.error("Failed to move lead");
    } finally {
      setDragging(null);
      setOverCol(null);
    }
  };

  return (
    <div className="flex gap-3 overflow-x-auto pb-4" data-testid="leads-kanban">
      {PIPELINE_STAGES.concat(["lost"]).map(stage => {
        const cfg = STATUS_CONFIG[stage];
        const cards = grouped[stage] || [];
        const total = cards.reduce((s, l) => s + (Number(l.estimated_value) || 0), 0);
        const isOver = overCol === stage;
        return (
          <div
            key={stage}
            onDragOver={e => { e.preventDefault(); setOverCol(stage); }}
            onDragLeave={() => setOverCol(c => c === stage ? null : c)}
            onDrop={() => onDrop(stage)}
            className={`flex-shrink-0 w-72 rounded-lg border ${isOver ? "border-violet-500 bg-violet-500/5" : "border-zinc-800/60 bg-zinc-900/30"}`}
            data-testid={`kanban-col-${stage}`}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/60">
              <div className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${cfg.orb}`} />
                <span className="text-[11px] uppercase tracking-wider font-semibold text-zinc-200">{cfg.label}</span>
                <span className="text-[10px] text-zinc-500 font-mono">{cards.length}</span>
              </div>
              <span className="text-[10px] text-zinc-500 font-mono">{money(total)}</span>
            </div>
            <div className="p-2 space-y-2 min-h-[200px] max-h-[70vh] overflow-y-auto">
              {cards.length === 0 && <p className="text-[10px] text-zinc-600 px-1 py-4 text-center">Empty</p>}
              {cards.map(l => {
                const score = scores[l.id];
                return (
                  <Card
                    key={l.id}
                    draggable
                    onDragStart={() => setDragging(l)}
                    onClick={() => onOpen && onOpen(l.id)}
                    data-testid={`kanban-card-${l.id}`}
                    className="cursor-grab active:cursor-grabbing p-2 bg-zinc-950/40 border-zinc-800/60 hover:border-violet-500/50 transition-all"
                  >
                    <div className="flex items-start gap-2">
                      <InitialsAvatar name={l.company_name} size={26} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-semibold text-zinc-100 truncate">{l.company_name}</p>
                        <p className="text-[10px] text-zinc-500 truncate">{l.contact_name || "—"}</p>
                      </div>
                      {score && <LeadScoreBadge score={score.overall} sub={score} compact />}
                    </div>
                    <div className="flex items-center justify-between mt-1.5 text-[10px] text-zinc-500">
                      <span className="font-mono">{money(l.estimated_value)}</span>
                      <span>{timeAgo(l.last_activity_at || l.updated_at || l.created_at)}</span>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
