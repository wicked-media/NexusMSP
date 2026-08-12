import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { keyboardKeyLower } from "@/lib/keyboard";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { API, useAuth } from "@/App";
import { useClientContext } from "@/contexts/ClientContext";
import { navGroups } from "@/config/navigation";
import { toast } from "sonner";
import {
  ArrowRight,
  BookOpen,
  Box,
  ChevronDown,
  ChevronUp,
  CornerDownLeft,
  FileText,
  HardDrive,
  History,
  Monitor,
  Phone,
  Receipt,
  Search,
  ShieldCheck,
  Sparkles,
  Terminal,
  Ticket,
  Users,
} from "lucide-react";

const RECENT_COMMAND_KEY = "nexus-command-recent-v1";

const readRecentCommands = () => {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_COMMAND_KEY) || "[]");
    return Array.isArray(value) ? value.slice(0, 6) : [];
  } catch {
    return [];
  }
};

const commandIdentity = item => [
  item.kind,
  item.id || item.path || item.cmd || item.ticket_number || item.slug || item.label,
].join(":");

const storableCommand = item => {
  const {
    kind, id, path, cmd, ticket_number, slug, label, hint, desc, status, route,
  } = item;
  return { kind, id, path, cmd, ticket_number, slug, label, hint, desc, status, route };
};

const EMPTY_SEARCH = {
  intents: [],
  tickets: [],
  clients: [],
  devices: [],
  users: [],
  invoices: [],
  pbxs: [],
  backups: [],
  knowledge: [],
  products: [],
};

const SLASH_COMMANDS = [
  { cmd: "ticket", args: "TKT-### status|priority <value>", desc: "Change ticket status or priority", icon: Ticket },
  { cmd: "close", args: "TKT-###", desc: "Close a ticket", icon: ShieldCheck },
  { cmd: "assign", args: "@user TKT-###", desc: "Assign a ticket", icon: Users },
  { cmd: "sla", args: "TKT-###", desc: "Show SLA timers", icon: FileText },
  { cmd: "note", args: "TKT-### <body>", desc: "Add an auditable internal note", icon: FileText },
  { cmd: "summarize", args: "", desc: "Summarise the last 40 messages", icon: Sparkles },
  { cmd: "page", args: "<severity>", desc: "Page the team", icon: Terminal },
  { cmd: "help", args: "", desc: "List all slash commands", icon: BookOpen },
];

const flatNavPages = (() => {
  const pages = [];
  for (const group of navGroups || []) {
    for (const item of group.items || []) {
      if (item.path && item.label) pages.push({ path: item.path, label: item.label, group: group.title });
      for (const child of item.children || []) {
        if (child.path && child.label) pages.push({ path: child.path, label: child.label, group: group.title });
      }
    }
  }
  const seen = new Set();
  return pages.filter(page => (seen.has(page.path) ? false : (seen.add(page.path), true)));
})();

function paletteIcon(item) {
  if (item.icon) return item.icon;
  return {
    intent: Sparkles,
    ticket: Ticket,
    client: Users,
    device: Monitor,
    user: Users,
    invoice: Receipt,
    pbx: Phone,
    backup: HardDrive,
    knowledge: BookOpen,
    product: Box,
    page: ArrowRight,
    slash: Terminal,
    tip: FileText,
  }[item.kind] || FileText;
}

export default function CommandPalette() {
  const { token } = useAuth();
  const { activeClient, activeClientId } = useClientContext() || {};
  const navigate = useNavigate();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const [search, setSearch] = useState(EMPTY_SEARCH);
  const [searching, setSearching] = useState(false);
  const [recent, setRecent] = useState(readRecentCommands);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  const rememberItem = useCallback(item => {
    if (!item || item.kind === "tip") return;
    setRecent(current => {
      const next = [
        storableCommand(item),
        ...current.filter(entry => commandIdentity(entry) !== commandIdentity(item)),
      ].slice(0, 6);
      localStorage.setItem(RECENT_COMMAND_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = event => {
      const modifier = event.metaKey || event.ctrlKey;
      // Some browser extensions and telemetry tools dispatch incomplete keyboard
      // events. Treat those as non-shortcuts instead of allowing a global handler
      // to throw and destabilise the current workspace.
      const commandShortcut = keyboardKeyLower(event) === "k";
      const everythingShortcut = event.code === "Space";
      if (modifier && (commandShortcut || everythingShortcut)) {
        event.preventDefault();
        setOpen(current => !current);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("nexus:open-command-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("nexus:open-command-palette", onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setIdx(0);
    setSearch(EMPTY_SEARCH);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    if (!token || !open) return;
    if (q.startsWith("/") || q.trim().length < 2) {
      setSearch(EMPTY_SEARCH);
      setSearching(false);
      return;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const response = await axios.get(`${API}/command-palette/search`, {
          headers,
          params: { q: q.trim(), ...(activeClientId ? { client_id: activeClientId } : {}) },
        });
        setSearch({ ...EMPTY_SEARCH, ...(response.data || {}) });
      } catch {
        setSearch(EMPTY_SEARCH);
      } finally {
        setSearching(false);
      }
    }, 180);
    return () => clearTimeout(debounceRef.current);
  }, [q, token, open, headers, activeClientId]);

  const sections = useMemo(() => {
    const query = q.trim().toLowerCase();
    const list = [];

    if (query.startsWith("/")) {
      const commandQuery = query.slice(1).split(" ")[0];
      const commands = SLASH_COMMANDS.filter(command => !commandQuery || command.cmd.startsWith(commandQuery));
      list.push({
        heading: "Audited slash commands",
        icon: Terminal,
        items: commands.map(command => ({
          kind: "slash",
          cmd: command.cmd,
          label: `/${command.cmd}`,
          hint: command.args,
          desc: command.desc,
          icon: command.icon,
        })),
      });
      return list;
    }

    if (search.intents?.length) {
      list.push({
        heading: "Nexus understands",
        icon: Sparkles,
        items: search.intents.map(intent => ({ ...intent, kind: "intent", desc: intent.description })),
      });
    }

    if (!query && recent.length) {
      list.push({
        heading: "Continue where you left off",
        icon: History,
        items: recent.map(item => ({ ...item, recent: true })),
      });
    }

    const pages = flatNavPages
      .filter(page => !query || page.label.toLowerCase().includes(query) || page.path.toLowerCase().includes(query))
      .slice(0, query ? 5 : 7);
    if (pages.length) {
      list.push({
        heading: query ? "Workspaces" : "Open a workspace",
        icon: ArrowRight,
        items: pages.map(page => ({ kind: "page", label: page.label, hint: page.group, path: page.path })),
      });
    }

    if (query.length >= 2) {
      if (search.tickets?.length) list.push({
        heading: "Tickets",
        icon: Ticket,
        items: search.tickets.map(ticket => ({
          kind: "ticket",
          label: `${ticket.ticket_number} · ${ticket.title}`,
          hint: `${ticket.client_name || "No client"} · ${ticket.priority || "No priority"}`,
          status: ticket.status,
          id: ticket.id,
          ticket_number: ticket.ticket_number,
        })),
      });
      if (search.clients?.length) list.push({
        heading: "Clients",
        icon: Users,
        items: search.clients.map(client => ({
          kind: "client",
          label: client.name,
          hint: client.email || client.contract_status,
          id: client.id,
        })),
      });
      if (search.devices?.length) list.push({
        heading: "Managed assets",
        icon: Monitor,
        items: search.devices.map(device => ({
          kind: "device",
          label: device.hostname || device.name,
          hint: `${device.client_name || "No client"} · ${device.device_type || "Asset"}`,
          id: device.id,
          status: device.status,
        })),
      });
      if (search.users?.length) list.push({
        heading: "People",
        icon: Users,
        items: search.users.map(user => ({
          kind: "user",
          label: user.name,
          hint: `${user.email} · ${user.role || "Technician"}`,
          id: user.id,
        })),
      });
      if (search.invoices?.length) list.push({
        heading: "Invoices",
        icon: Receipt,
        items: search.invoices.map(invoice => ({
          kind: "invoice",
          label: invoice.invoice_name || invoice.invoice_number,
          hint: `${invoice.client_name || "No client"} · ${invoice.status || "Draft"}`,
          id: invoice.id,
          status: invoice.status,
        })),
      });
      if (search.pbxs?.length) list.push({
        heading: "Voice services",
        icon: Phone,
        items: search.pbxs.map(pbx => ({
          kind: "pbx",
          label: pbx.pbx_name || pbx.name || "Yeastar PBX",
          hint: `${pbx.client_name || "No client"} · ${pbx.status || "Unknown"}`,
          id: pbx.id,
          status: pbx.status,
        })),
      });
      if (search.backups?.length) list.push({
        heading: "Backups",
        icon: HardDrive,
        items: search.backups.map(job => ({
          kind: "backup",
          label: job.name || "Backup job",
          hint: `${job.client_name || "No client"} · ${job.provider || job.status || "Backup"}`,
          id: job.id,
          status: job.status,
        })),
      });
      if (search.knowledge?.length) list.push({
        heading: "Knowledge",
        icon: BookOpen,
        items: search.knowledge.map(article => ({
          kind: "knowledge",
          label: article.title,
          hint: article.category || article.summary,
          id: article.id,
          slug: article.slug,
        })),
      });
      if (search.products?.length) list.push({
        heading: "Products",
        icon: Box,
        items: search.products.map(product => ({
          kind: "product",
          label: product.name,
          hint: `${product.sku || "No SKU"} · ${product.category || "Product"}`,
          id: product.id,
        })),
      });
    }

    if (!list.length && !searching) {
      list.push({
        heading: "Try a Nexus command",
        icon: Sparkles,
        items: [
          { kind: "tip", label: "Reset John's MFA", hint: "Opens a reviewed Microsoft identity workflow" },
          { kind: "tip", label: "Remote into Reception PC", hint: "Finds the asset and opens remote support" },
          { kind: "tip", label: "Restart the failed backup", hint: "Opens a protected backup action" },
          { kind: "tip", label: "Type / for slash commands", hint: "Run an explicit audited command" },
        ],
      });
    }
    return list;
  }, [q, recent, search, searching]);

  const flatItems = useMemo(() => sections.flatMap(section => section.items), [sections]);
  useEffect(() => {
    if (idx >= flatItems.length) setIdx(0);
  }, [flatItems.length, idx]);

  const runItem = async item => {
    if (!item || item.kind === "tip") return;
    if (item.kind === "intent") {
      rememberItem(item);
      navigate(item.route);
      toast.info("Workflow opened for review", {
        description: "Nexus has not changed anything yet. Confirm scope and approval in the workspace.",
      });
      setOpen(false);
      return;
    }
    if (item.kind === "page") {
      rememberItem(item);
      navigate(item.path);
      setOpen(false);
      return;
    }
    if (item.kind === "ticket") navigate(`/tickets?ticket=${encodeURIComponent(item.ticket_number || item.id)}`);
    if (item.kind === "client") navigate(`/clients?client=${encodeURIComponent(item.id)}`);
    if (item.kind === "device") navigate(`/devices/${item.id}`);
    if (item.kind === "user") navigate("/team-hub?view=directory");
    if (item.kind === "invoice") navigate(`/invoices?invoice=${encodeURIComponent(item.id)}`);
    if (item.kind === "pbx") navigate(`/voice?tab=pbxs&pbxId=${encodeURIComponent(item.id)}`);
    if (item.kind === "backup") navigate(`/backup-center?job=${encodeURIComponent(item.id)}`);
    if (item.kind === "knowledge") navigate(item.slug ? `/knowledge-base/${item.slug}` : "/documentation-hub?tab=library");
    if (item.kind === "product") navigate(`/products?product=${encodeURIComponent(item.id)}`);
    if (!["slash", "page", "intent"].includes(item.kind)) {
      rememberItem(item);
      setOpen(false);
      return;
    }
    if (item.kind !== "slash") return;

    const raw = q.startsWith("/") && q.trim().split(/\s+/).length > 1 ? q.trim() : `/${item.cmd}`;
    const metadata = SLASH_COMMANDS.find(command => command.cmd === item.cmd);
    const needsArguments = metadata && metadata.args.length > 0;
    const hasArguments = q.trim().split(/\s+/).length > 1;
    if (needsArguments && !hasArguments) {
      setQ(`/${item.cmd} `);
      setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }
    try {
      const response = await axios.post(`${API}/command-palette/run`, { raw }, { headers });
      rememberItem({ ...item, label: raw, hint: item.desc });
      toast.success(response.data?.message?.body?.slice(0, 100) || `Ran ${raw}`);
      setOpen(false);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Command failed");
    }
  };

  const onKeyDown = event => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIdx(current => Math.min(flatItems.length - 1, current + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setIdx(current => Math.max(0, current - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      runItem(flatItems[idx]);
    }
  };

  let cursor = 0;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="nx-command-palette max-w-3xl gap-0 overflow-hidden border-cyan-500/25 p-0 shadow-2xl shadow-cyan-500/10"
        data-testid="command-palette"
      >
        <DialogTitle className="sr-only">Nexus Command</DialogTitle>
        <div className="border-b border-border bg-gradient-to-r from-cyan-500/[0.10] via-violet-500/[0.05] to-transparent px-4 py-3.5">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-400/10">
                <Sparkles className="h-3.5 w-3.5 text-cyan-700 dark:text-cyan-200" />
              </span>
              <div>
                <p className="text-xs font-semibold text-foreground">Nexus Command</p>
                <p className="text-[10px] text-muted-foreground">{activeClient ? `Prioritising ${activeClient.name}` : "Search every connected Nexus record or describe an operational outcome"}</p>
              </div>
            </div>
            <Badge variant="outline" className="border-emerald-500/25 bg-emerald-500/[0.07] text-[9px] text-emerald-700 dark:text-emerald-200">
              Approval-aware
            </Badge>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-border bg-background/60 px-3">
            <Search className="h-4 w-4 shrink-0 text-cyan-700 dark:text-cyan-300" />
            <Input
              ref={inputRef}
              value={q}
              onChange={event => {
                setQ(event.target.value);
                setIdx(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="Search a person, client, asset, ticket, invoice, PBX, backup, product or document"
              className="h-10 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
              data-testid="palette-input"
            />
            {searching ? <span className="text-[10px] text-cyan-700 dark:text-cyan-300">Searching…</span> : <kbd className="hidden rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground md:inline-flex">Esc</kbd>}
          </div>
        </div>

        <div className="max-h-[62vh] overflow-y-auto py-1">
          {sections.map(section => (
            <div key={section.heading} className="py-1">
              <div className="flex items-center gap-1.5 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                <section.icon className="h-3 w-3" />
                {section.heading}
              </div>
              {section.items.map(item => {
                const itemIndex = cursor++;
                const active = itemIndex === idx;
                const LeadingIcon = paletteIcon(item);
                return (
                  <button
                    key={`${commandIdentity(item)}-${itemIndex}`}
                    type="button"
                    onClick={() => runItem(item)}
                    onMouseEnter={() => setIdx(itemIndex)}
                    className={`nx-command-item flex w-full items-center gap-3 px-4 py-2.5 text-left ${active ? "bg-cyan-500/[0.10]" : "hover:bg-muted/35"} ${item.kind === "tip" ? "cursor-default" : ""}`}
                    data-active={active ? "true" : "false"}
                    data-testid={`palette-item-${item.kind}-${itemIndex}`}
                  >
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${item.kind === "intent" ? "border-cyan-500/25 bg-cyan-500/10" : "border-border bg-muted/30"}`}>
                      <LeadingIcon className={`h-4 w-4 ${item.kind === "intent" ? "text-cyan-700 dark:text-cyan-200" : "text-muted-foreground"}`} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`truncate text-sm ${item.kind === "slash" ? "font-mono font-semibold text-violet-700 dark:text-violet-200" : "font-medium text-foreground"}`}>{item.label}</span>
                        {item.status && <Badge variant="outline" className="h-4 px-1 py-0 text-[9px] capitalize">{item.status}</Badge>}
                        {item.kind === "intent" && <Badge variant="outline" className="h-4 border-cyan-500/25 px-1 py-0 text-[9px] text-cyan-700 dark:text-cyan-200">Review workflow</Badge>}
                      </div>
                      {item.hint && <p className="truncate text-[11px] text-muted-foreground">{item.hint}</p>}
                      {item.desc && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{item.desc}</p>}
                    </div>
                    {active && item.kind !== "tip" && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-cyan-700 dark:text-cyan-300" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 border-t border-border bg-muted/20 px-4 py-2 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><ChevronUp className="h-3 w-3" /><ChevronDown className="h-3 w-3" />navigate</span>
          <span className="flex items-center gap-1"><CornerDownLeft className="h-3 w-3" />open or review</span>
          <span className="flex items-center gap-1"><kbd className="rounded border border-border px-1 font-mono">/</kbd>audited commands</span>
          <span className="ml-auto">No change runs without the required scope and approval.</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
