import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { API, useAuth } from "@/App";
import { navGroups } from "@/config/navigation";
import { toast } from "sonner";
import {
  Search, Ticket, Users, Monitor, ArrowRight, Terminal, FileText,
  Sparkles, CornerDownLeft, ChevronUp, ChevronDown,
} from "lucide-react";

// ── Slash command catalog (mirrors the chat composer) ──
const SLASH_COMMANDS = [
  { cmd: "ticket",    args: "TKT-### status|priority <value>", desc: "Change ticket status or priority", icon: "🎟️" },
  { cmd: "close",     args: "TKT-###",                          desc: "Close a ticket",                  icon: "🔒" },
  { cmd: "assign",    args: "@user TKT-###",                    desc: "Assign ticket to a user",         icon: "👤" },
  { cmd: "sla",       args: "TKT-###",                          desc: "Show SLA timers",                 icon: "📊" },
  { cmd: "note",      args: "TKT-### <body>",                   desc: "Add internal note from chat",     icon: "📝" },
  { cmd: "summarize", args: "",                                  desc: "AI summary of last 40 messages", icon: "🤖" },
  { cmd: "page",      args: "<severity>",                        desc: "Page the team",                   icon: "📟" },
  { cmd: "help",      args: "",                                  desc: "List all slash commands",         icon: "❓" },
];

// Flatten navigation tree once
const flatNavPages = (() => {
  const out = [];
  for (const g of navGroups || []) {
    for (const item of g.items || []) {
      if (item.path && item.label) out.push({ path: item.path, label: item.label, group: g.title });
      for (const child of item.children || []) {
        if (child.path && child.label) out.push({ path: child.path, label: child.label, group: g.title });
      }
    }
  }
  // de-dupe by path
  const seen = new Set();
  return out.filter(p => (seen.has(p.path) ? false : (seen.add(p.path), true)));
})();

export default function CommandPalette() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const [search, setSearch] = useState({ tickets: [], clients: [], devices: [], users: [] });
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  // ⌘K / Ctrl+K opens the palette anywhere
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Reset on open
  useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
      setSearch({ tickets: [], clients: [], devices: [], users: [] });
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Debounced backend search (only when not in slash-mode and q has 2+ chars)
  useEffect(() => {
    if (!token || !open) return;
    if (q.startsWith("/") || q.trim().length < 2) {
      setSearch({ tickets: [], clients: [], devices: [], users: [] });
      return;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await axios.get(`${API}/command-palette/search`, { headers, params: { q: q.trim() } });
        setSearch(r.data || { tickets: [], clients: [], devices: [], users: [] });
      } catch { /* ignore */ }
    }, 180);
    return () => clearTimeout(debounceRef.current);
  }, [q, token, open, headers]);

  // Build the unified result list
  const sections = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const list = [];

    if (ql.startsWith("/")) {
      const cmdQ = ql.slice(1);
      const cmds = SLASH_COMMANDS.filter(c => !cmdQ || c.cmd.startsWith(cmdQ.split(" ")[0]));
      list.push({ heading: "Slash command", icon: Terminal, items: cmds.map(c => ({
        kind: "slash", cmd: c.cmd, label: `/${c.cmd}`, hint: c.args, desc: c.desc, icon: c.icon, raw: ql,
      }))});
      return list;
    }

    // Pages — always available, filtered by query
    const pages = flatNavPages.filter(p => !ql || p.label.toLowerCase().includes(ql) || p.path.toLowerCase().includes(ql)).slice(0, 6);
    if (pages.length) list.push({ heading: "Pages", icon: ArrowRight, items: pages.map(p => ({ kind: "page", label: p.label, hint: p.group, path: p.path })) });

    if (ql.length >= 2) {
      if (search.tickets?.length) list.push({ heading: "Tickets", icon: Ticket, items: search.tickets.map(t => ({
        kind: "ticket", label: `${t.ticket_number} · ${t.title}`, hint: `${t.client_name || ""} · ${t.priority || ""}`, status: t.status, id: t.id, ticket_number: t.ticket_number,
      }))});
      if (search.clients?.length) list.push({ heading: "Clients", icon: Users, items: search.clients.map(c => ({
        kind: "client", label: c.name, hint: c.email || c.contract_status, id: c.id,
      }))});
      if (search.devices?.length) list.push({ heading: "Assets", icon: Monitor, items: search.devices.map(d => ({
        kind: "device", label: d.hostname || d.name, hint: `${d.client_name || ""} · ${d.device_type || ""}`, id: d.id, status: d.status,
      }))});
      if (search.users?.length) list.push({ heading: "People", icon: Users, items: search.users.map(u => ({
        kind: "user", label: u.name, hint: `${u.email} · ${u.role || "tech"}`, id: u.id,
      }))});
    }

    if (!list.length) {
      list.push({ heading: "Suggestions", icon: Sparkles, items: [
        { kind: "tip", label: "Type / for slash commands", hint: "e.g. /close TKT-001" },
        { kind: "tip", label: "Search a ticket number, client name or device", hint: "e.g. INC-0003 or Acme" },
      ]});
    }
    return list;
  }, [q, search]);

  // Flat array for keyboard nav
  const flatItems = useMemo(() => sections.flatMap(s => s.items), [sections]);
  useEffect(() => { if (idx >= flatItems.length) setIdx(0); }, [flatItems.length, idx]);

  const runItem = async (item) => {
    if (!item || item.kind === "tip") return;
    if (item.kind === "page")    { navigate(item.path); setOpen(false); return; }
    if (item.kind === "ticket")  { navigate(`/tickets?ticket=${encodeURIComponent(item.ticket_number || item.id)}`); setOpen(false); return; }
    if (item.kind === "client")  { navigate(`/clients?id=${item.id}`); setOpen(false); return; }
    if (item.kind === "device")  { navigate(`/devices/${item.id}`); setOpen(false); return; }
    if (item.kind === "user")    { navigate("/team"); setOpen(false); return; }
    if (item.kind === "slash") {
      const raw = q.startsWith("/") && q.trim().split(/\s+/).length > 1 ? q.trim() : `/${item.cmd}`;
      // If user only typed "/cmd" without args, just complete the input rather than executing —
      // unless the command takes no args (like /help, /summarize), in which case execute now.
      const meta = SLASH_COMMANDS.find(c => c.cmd === item.cmd);
      const needsArgs = meta && meta.args.length > 0;
      const userTypedArgs = q.trim().split(/\s+/).length > 1;
      if (needsArgs && !userTypedArgs) {
        setQ(`/${item.cmd} `);
        setTimeout(() => inputRef.current?.focus(), 0);
        return;
      }
      try {
        const r = await axios.post(`${API}/command-palette/run`, { raw }, { headers });
        toast.success(r.data?.message?.body?.slice(0, 100) || `Ran ${raw}`);
        setOpen(false);
      } catch (e) {
        toast.error(e.response?.data?.detail || "Command failed");
      }
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx(i => Math.min(flatItems.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIdx(i => Math.max(0, i - 1)); }
    else if (e.key === "Enter")   { e.preventDefault(); runItem(flatItems[idx]); }
  };

  // Iterate to track which absolute idx each item is
  let cursor = 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="max-w-2xl p-0 gap-0 overflow-hidden border-violet-500/30 shadow-2xl shadow-violet-500/20"
        data-testid="command-palette"
      >
        <DialogTitle className="sr-only">Command Palette</DialogTitle>
        {/* Search header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50 bg-gradient-to-r from-violet-500/5 to-cyan-500/5">
          <Search className="w-4 h-4 text-violet-400 shrink-0" />
          <Input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setIdx(0); }}
            onKeyDown={onKeyDown}
            placeholder="Search tickets, clients, devices, pages — or type / for commands…"
            className="border-0 bg-transparent focus-visible:ring-0 px-0 h-7 text-sm"
            data-testid="palette-input"
          />
          <kbd className="hidden md:inline-flex items-center gap-0.5 text-[10px] font-mono text-muted-foreground border rounded px-1.5 py-0.5">esc</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto">
          {sections.map((sec) => (
            <div key={sec.heading} className="py-1">
              <div className="px-4 py-1 text-[10px] uppercase tracking-widest font-semibold text-muted-foreground/80 flex items-center gap-1.5">
                <sec.icon className="w-3 h-3" />{sec.heading}
              </div>
              {sec.items.map((item) => {
                const myIdx = cursor++;
                const active = myIdx === idx;
                return (
                  <button
                    key={`${item.kind}-${myIdx}`}
                    onClick={() => runItem(item)}
                    onMouseEnter={() => setIdx(myIdx)}
                    className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${active ? "bg-violet-500/15" : "hover:bg-muted/30"} ${item.kind === "tip" ? "cursor-default" : ""}`}
                    data-testid={`palette-item-${item.kind}-${myIdx}`}
                  >
                    {/* Leading icon */}
                    <span className="w-6 text-base leading-none">
                      {item.icon || (
                        item.kind === "ticket" ? <Ticket className="w-4 h-4 text-cyan-400" /> :
                        item.kind === "client" ? <Users className="w-4 h-4 text-emerald-400" /> :
                        item.kind === "device" ? <Monitor className="w-4 h-4 text-amber-400" /> :
                        item.kind === "user"   ? <Users className="w-4 h-4 text-pink-400" /> :
                        item.kind === "page"   ? <ArrowRight className="w-4 h-4 text-violet-400" /> :
                        item.kind === "slash"  ? <Terminal className="w-4 h-4 text-violet-400" /> :
                        <FileText className="w-4 h-4 text-muted-foreground" />
                      )}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm truncate ${item.kind === "slash" ? "font-mono font-semibold text-violet-300" : "font-medium"}`}>{item.label}</span>
                        {item.status && <Badge variant="outline" className="text-[9px] capitalize px-1 py-0 h-4">{item.status}</Badge>}
                      </div>
                      {item.hint && <p className="text-[11px] text-muted-foreground truncate">{item.hint}</p>}
                      {item.desc && <p className="text-[11px] text-muted-foreground truncate">{item.desc}</p>}
                    </div>
                    {active && item.kind !== "tip" && (
                      <CornerDownLeft className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="border-t border-border/50 px-4 py-2 flex items-center gap-3 text-[10px] text-muted-foreground bg-card/40">
          <span className="flex items-center gap-1"><ChevronUp className="w-3 h-3" /><ChevronDown className="w-3 h-3" />navigate</span>
          <span className="flex items-center gap-1"><CornerDownLeft className="w-3 h-3" />select</span>
          <span className="flex items-center gap-1"><kbd className="font-mono border rounded px-1">/</kbd>commands</span>
          <span className="ml-auto flex items-center gap-1"><kbd className="font-mono border rounded px-1">⌘K</kbd>toggle</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
