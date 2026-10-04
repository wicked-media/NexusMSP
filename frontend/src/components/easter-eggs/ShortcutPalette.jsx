import { useEffect, useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Keyboard } from "lucide-react";
import { toast } from "sonner";

const SHORTCUTS = [
  { group: "Global", items: [
    { keys: ["Cmd/Ctrl", "K"], label: "Open command palette" },
    { keys: ["Cmd/Ctrl", "."], label: "Open Nexus Quick Dock" },
    { keys: ["Cmd/Ctrl", "/"], label: "Open this shortcut palette" },
    { keys: ["/"], label: "Focus search (Clients / Tickets)" },
    { keys: ["j"], label: "Next row in dense lists" },
    { keys: ["k"], label: "Previous row in dense lists" },
    { keys: ["Esc"], label: "Close any modal / dialog" },
    { keys: ["R"], label: "Refresh current page data" },
  ]},
  { group: "Tickets", items: [
    { keys: ["T"], label: "Open timer" },
    { keys: ["V"], label: "Open Voice Journal" },
    { keys: ["A"], label: "Apply blueprint" },
  ]},
  { group: "Chat", items: [
    { keys: ["Cmd/Ctrl", "Shift", "C"], label: "Open quick team chat" },
    { keys: ["/"], label: "Show slash commands" },
    { keys: ["Shift", "Enter"], label: "New line" },
    { keys: ["Enter"], label: "Send message" },
  ]},
  { group: "Easter eggs", items: [
    { keys: ["↑↑↓↓←→←→BA"], label: "Konami code → Retro CRT mode (30s)" },
  ]},
];

export default function ShortcutPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const { token } = useAuth();

  // Hidden egg: typing "sudo" here has exactly the effect you deserve.
  const fireSudoEgg = async () => {
    try {
      const { data } = await axios.post(`${API}/tech-fun/easter-egg/sudo`, {}, { headers: { Authorization: `Bearer ${token}` } });
      toast(data.message || "Permission denied. Nice try.");
      if (data.awarded) toast.success("Hidden badge unlocked: Privilege Escalator 🐧");
    } catch {
      toast("Permission denied. Nice try.");
    }
  };

  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName || "").toUpperCase();
      const inField = tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        if (inField) return;
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ql = q.trim().toLowerCase();
  const groups = SHORTCUTS.map((g) => ({
    ...g,
    items: g.items.filter((i) => !ql || i.label.toLowerCase().includes(ql) || i.keys.join(" ").toLowerCase().includes(ql)),
  })).filter((g) => g.items.length > 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg" data-testid="shortcut-palette">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base"><Keyboard className="w-4 h-4 text-violet-400" />Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search shortcuts…" autoFocus data-testid="shortcut-search" />
        {ql === "sudo" && (
          <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-3 text-sm" data-testid="sudo-egg">
            <p className="font-medium text-amber-200">Permission denied. Nice try. 😏</p>
            <Button size="sm" variant="outline" className="mt-2" onClick={fireSudoEgg} data-testid="sudo-egg-button">Ask again nicely</Button>
          </div>
        )}
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          {groups.map((g) => (
            <div key={g.group}>
              <div className="text-[10px] uppercase tracking-widest text-violet-400 mb-1">{g.group}</div>
              <ul className="space-y-1">
                {g.items.map((i, idx) => (
                  <li key={idx} className="flex items-center justify-between text-sm gap-3">
                    <span className="text-foreground/85">{i.label}</span>
                    <span className="flex items-center gap-1">
                      {i.keys.map((k, ix) => (
                        <kbd key={ix} className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono border border-border/50">{k}</kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {groups.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No matches</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
