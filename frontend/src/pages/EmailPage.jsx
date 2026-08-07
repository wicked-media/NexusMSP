import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useNavigate, useSearchParams } from "react-router-dom";
import DOMPurify from "dompurify";
import { formatDistanceToNow } from "date-fns";
import { API, useAuth } from "@/App";
import HeroTile from "@/components/HeroTile";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronsUpDown,
  CircleAlert,
  Clock,
  ExternalLink,
  Inbox,
  Loader2,
  Mail,
  MailCheck,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  UserRound,
  XCircle,
} from "lucide-react";

const EMPTY_COMPOSE = {
  to_addresses: "",
  cc_addresses: "",
  subject: "",
  body: "",
  client_id: "",
};

const STATUS_CONFIG = {
  draft: { label: "Draft", className: "border-amber-500/25 bg-amber-500/10 text-amber-200" },
  sent: { label: "Sent", className: "border-emerald-500/25 bg-emerald-500/10 text-emerald-200" },
  failed: { label: "Delivery failed", className: "border-rose-500/25 bg-rose-500/10 text-rose-200" },
  received: { label: "Received", className: "border-sky-500/25 bg-sky-500/10 text-sky-200" },
};

const WORKFLOW_TONES = {
  cyan: {
    background: "bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.17),transparent_45%),linear-gradient(135deg,rgba(6,182,212,0.10),transparent)]",
    icon: "border-cyan-400/25 bg-cyan-400/10 text-cyan-300",
    eyebrow: "text-cyan-300",
    badge: "border-cyan-400/30 bg-cyan-400/5 text-cyan-200",
  },
  emerald: {
    background: "bg-[radial-gradient(circle_at_top_right,rgba(52,211,153,0.17),transparent_45%),linear-gradient(135deg,rgba(16,185,129,0.10),transparent)]",
    icon: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
    eyebrow: "text-emerald-300",
    badge: "border-emerald-500/30 bg-emerald-500/5 text-emerald-300",
  },
};

function WorkflowDialogHeader({ icon: Icon, eyebrow, title, description, badge, tone = "cyan" }) {
  const palette = WORKFLOW_TONES[tone] || WORKFLOW_TONES.cyan;
  return (
    <DialogHeader className={`shrink-0 border-b border-white/[0.07] px-6 py-5 text-left ${palette.background}`}>
      <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${palette.eyebrow}`}>{eyebrow}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl border ${palette.icon}`}>
          <Icon className="h-4 w-4" />
        </span>
        <DialogTitle className="text-2xl tracking-tight text-zinc-100">{title}</DialogTitle>
        {badge && <Badge variant="outline" className={`text-[10px] ${palette.badge}`}>{badge}</Badge>}
      </div>
      <DialogDescription className="mt-2 max-w-3xl">{description}</DialogDescription>
    </DialogHeader>
  );
}

function ClientAutocomplete({ clients, value, onValueChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedClient = clients.find((client) => client.id === value);
  const normalizedQuery = query.trim().toLowerCase();
  const matches = normalizedQuery
    ? clients.filter((client) => [
      client.name,
      client.email,
      client.billing_email,
      client.contact_name,
    ].filter(Boolean).some((field) => String(field).toLowerCase().includes(normalizedQuery)))
    : clients;

  return (
    <Popover open={open} onOpenChange={(nextOpen) => {
      setOpen(nextOpen);
      if (!nextOpen) setQuery("");
    }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-10 w-full justify-between border-white/10 bg-black/10 px-3 text-left font-normal hover:border-cyan-400/35 hover:bg-cyan-400/[0.04]"
          data-testid="email-client-select"
        >
          <span className={selectedClient ? "truncate text-zinc-100" : "truncate text-muted-foreground"}>
            {selectedClient?.name || "Search and link a client…"}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-cyan-300/70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[20rem] overflow-hidden border-cyan-400/25 bg-[#0b151d] p-0 shadow-2xl"
      >
        <Command shouldFilter={false}>
          <CommandInput
            autoFocus
            placeholder="Type a client, contact, or email…"
            value={query}
            onValueChange={setQuery}
            data-testid="email-client-search"
          />
          <CommandList>
            <CommandEmpty>No matching clients found.</CommandEmpty>
            <CommandGroup heading={`${matches.length} client${matches.length === 1 ? "" : "s"}`}>
              {matches.slice(0, 30).map((client) => {
                const email = client.billing_email || client.email || client.contact_email || "";
                return (
                  <CommandItem
                    key={client.id}
                    value={`${client.name || ""} ${email} ${client.contact_name || ""}`}
                    onSelect={() => {
                      onValueChange(client);
                      setOpen(false);
                      setQuery("");
                    }}
                    className="py-2"
                  >
                    <Check className={`h-4 w-4 shrink-0 ${value === client.id ? "opacity-100 text-emerald-300" : "opacity-0"}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{client.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {email || "No email address recorded"}
                      </span>
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function relativeTime(value) {
  if (!value) return "Not yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return formatDistanceToNow(date, { addSuffix: true });
}

function emailAddressFor(client) {
  return client?.billing_email || client?.email || client?.contact_email || "";
}

export default function EmailPage() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedClientId = searchParams.get("client");
  const shouldComposeForClient = searchParams.get("compose") === "1";
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const [status, setStatus] = useState({ configured: false, mailbox_count: 0 });
  const [emails, setEmails] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("all");
  const [search, setSearch] = useState("");
  const [composeData, setComposeData] = useState(EMPTY_COMPOSE);
  const [saving, setSaving] = useState(false);
  const [sendingId, setSendingId] = useState("");

  const fetchData = useCallback(async ({ initial = false, notify = false } = {}) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setLoadError("");
    try {
      const [statusRes, emailsRes, clientsRes] = await Promise.all([
        axios.get(`${API}/office365/status`, { headers }),
        axios.get(`${API}/emails`, { headers }),
        axios.get(`${API}/clients`, { headers }),
      ]);
      setStatus(statusRes.data || { configured: false, mailbox_count: 0 });
      setEmails(Array.isArray(emailsRes.data) ? emailsRes.data : []);
      setClients(Array.isArray(clientsRes.data) ? clientsRes.data : []);
      if (notify) toast.success("Communications workspace refreshed");
    } catch (error) {
      console.error("Failed to fetch email workspace:", error);
      setLoadError(error.response?.data?.detail || "The communications workspace could not be refreshed.");
      if (notify) toast.error("Could not refresh communications");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [headers]);

  useEffect(() => {
    fetchData({ initial: true });
  }, [fetchData]);

  useEffect(() => {
    if (!shouldComposeForClient || !requestedClientId || clients.length === 0) return;
    const client = clients.find((item) => item.id === requestedClientId);
    if (!client) return;
    setComposeData((current) => ({
      ...current,
      client_id: client.id,
      to_addresses: current.to_addresses || emailAddressFor(client),
    }));
    setIsComposeOpen(true);
    setSearchParams({}, { replace: true });
  }, [clients, requestedClientId, setSearchParams, shouldComposeForClient]);

  const metrics = useMemo(() => ({
    all: emails.length,
    inbox: emails.filter((email) => email.direction === "inbound").length,
    sent: emails.filter((email) => email.direction === "outbound" && email.status === "sent").length,
    attention: emails.filter((email) => ["draft", "failed"].includes(email.status)).length,
  }), [emails]);

  const filteredEmails = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return emails.filter((email) => {
      if (activeTab === "inbox" && email.direction !== "inbound") return false;
      if (activeTab === "sent" && !(email.direction === "outbound" && email.status === "sent")) return false;
      if (activeTab === "drafts" && email.status !== "draft") return false;
      if (activeTab === "attention" && !["draft", "failed"].includes(email.status)) return false;
      if (!normalizedSearch) return true;
      return [
        email.subject,
        email.from_address,
        email.from_name,
        email.client_name,
        ...(email.to_addresses || []),
        ...(email.cc_addresses || []),
      ].filter(Boolean).some((field) => String(field).toLowerCase().includes(normalizedSearch));
    });
  }, [activeTab, emails, search]);

  const resetCompose = () => {
    setComposeData(EMPTY_COMPOSE);
    setIsComposeOpen(false);
  };

  const openCompose = () => {
    setComposeData(EMPTY_COMPOSE);
    setIsComposeOpen(true);
  };

  const persistEmail = async ({ sendNow = false } = {}) => {
    const toList = composeData.to_addresses.split(",").map((address) => address.trim()).filter(Boolean);
    const ccList = composeData.cc_addresses.split(",").map((address) => address.trim()).filter(Boolean);
    if (!toList.length || !composeData.subject.trim() || !composeData.body.trim()) {
      toast.error("Recipient, subject, and message are required");
      return;
    }
    if (sendNow && !status.configured) {
      toast.error("Connect a Microsoft 365 delivery mailbox before sending");
      return;
    }
    setSaving(true);
    try {
      const emailRes = await axios.post(`${API}/emails`, {
        to_addresses: toList,
        cc_addresses: ccList,
        subject: composeData.subject.trim(),
        body: composeData.body,
        body_type: "text",
        client_id: composeData.client_id || null,
      }, { headers });
      if (sendNow) {
        await axios.post(`${API}/emails/${emailRes.data.id}/send`, {}, { headers });
        toast.success("Email accepted by Microsoft 365");
      } else {
        toast.success("Draft saved with its client audit link");
      }
      resetCompose();
      await fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || (sendNow ? "Email could not be sent" : "Draft could not be saved"));
    } finally {
      setSaving(false);
    }
  };

  const handleSend = async (emailId) => {
    if (!status.configured) {
      toast.error("Connect a Microsoft 365 delivery mailbox before sending");
      return;
    }
    setSendingId(emailId);
    try {
      await axios.post(`${API}/emails/${emailId}/send`, {}, { headers });
      toast.success("Email accepted by Microsoft 365");
      setSelectedEmail(null);
      await fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Email could not be sent");
    } finally {
      setSendingId("");
    }
  };

  const selectClient = (client) => {
    const clientEmail = emailAddressFor(client);
    setComposeData((current) => ({
      ...current,
      client_id: client.id,
      to_addresses: current.to_addresses || clientEmail,
    }));
    if (!clientEmail) toast.info("Client linked, but no email address is recorded");
  };

  const connectionLabel = status.configured
    ? `${status.sender_email || "Microsoft 365 sender"} · ${status.mailbox_count || 1} connected inbox${Number(status.mailbox_count || 1) === 1 ? "" : "es"}`
    : "No Microsoft 365 delivery mailbox is connected. Drafts are retained, but sending is disabled.";

  return (
    <div className="space-y-6" data-testid="email-page">
      <OperationalPageHeader
        eyebrow="Client communications"
        title="Communications"
        description="Compose, trace, and audit technician email from one Microsoft 365-backed workspace."
        icon={Mail}
        tone="sky"
        actions={(
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5" data-testid="communications-workspace-tools">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                  Workspace
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuItem onClick={() => navigate("/notify-channels")}>
                  <Send className="mr-2 h-4 w-4" />Slack &amp; Teams webhooks
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/csat-surveys")}>
                  <CheckCircle2 className="mr-2 h-4 w-4" />CSAT surveys
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/nps-tracker")}>
                  <ArrowUpRight className="mr-2 h-4 w-4" />NPS tracker
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/settings?tab=mailbox")}
              data-testid="email-mailbox-settings"
            >
              <Settings className="mr-1.5 h-3.5 w-3.5" />Mailbox settings
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchData({ notify: true })}
              disabled={refreshing}
              data-testid="email-refresh"
            >
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />Refresh
            </Button>
            <Button size="sm" onClick={openCompose} data-testid="email-compose">
              <Plus className="mr-1.5 h-3.5 w-3.5" />Compose
            </Button>
          </>
        )}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <HeroTile label="All messages" value={metrics.all} icon={Mail} glow="violet" onClick={() => setActiveTab("all")} active={activeTab === "all"} testId="email-stat-all" />
        <HeroTile label="Inbox" value={metrics.inbox} icon={ArrowDownLeft} glow="sky" onClick={() => setActiveTab("inbox")} active={activeTab === "inbox"} testId="email-stat-inbox" />
        <HeroTile label="Delivered" value={metrics.sent} icon={MailCheck} glow="emerald" onClick={() => setActiveTab("sent")} active={activeTab === "sent"} testId="email-stat-sent" />
        <HeroTile label="Needs action" value={metrics.attention} icon={CircleAlert} glow={metrics.attention ? "amber" : "zinc"} onClick={() => setActiveTab("attention")} active={activeTab === "attention"} testId="email-stat-attention" />
      </div>

      <Card className={status.configured ? "border-emerald-500/25 bg-emerald-500/[0.035]" : "border-amber-500/25 bg-amber-500/[0.035]"}>
        <CardContent className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${status.configured ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300" : "border-amber-500/25 bg-amber-500/10 text-amber-300"}`}>
              {status.configured ? <ShieldCheck className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{status.configured ? "Microsoft 365 delivery ready" : "Draft-only workspace"}</p>
                <Badge variant="outline" className={status.configured ? "border-emerald-500/25 text-emerald-300" : "border-amber-500/25 text-amber-300"}>
                  {status.configured ? "Connected" : "Action required"}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{connectionLabel}</p>
              {status.configured && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Last mailbox sync {relativeTime(status.last_sync)}. Delivery outcomes are retained in the audit ledger.
                </p>
              )}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate("/settings?tab=mailbox")} className="shrink-0">
            {status.configured ? "Review delivery audit" : "Connect mailbox"}
            <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
          </Button>
        </CardContent>
      </Card>

      {loadError && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-500/25 bg-rose-500/[0.05] px-4 py-3 text-sm text-rose-100" role="alert">
          <span className="flex items-center gap-2"><XCircle className="h-4 w-4" />{loadError}</span>
          <Button variant="outline" size="sm" onClick={() => fetchData()}>Retry</Button>
        </div>
      )}

      <Card className="overflow-hidden border-zinc-800/70">
        <CardHeader className="space-y-4 border-b border-white/[0.06] bg-black/10 pb-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="h-auto w-full justify-start gap-1 rounded-none border-b border-zinc-800 bg-transparent p-0 lg:w-auto">
                {[
                  { value: "all", label: "All", icon: Mail },
                  { value: "inbox", label: "Inbox", icon: ArrowDownLeft },
                  { value: "sent", label: "Sent", icon: ArrowUpRight },
                  { value: "drafts", label: "Drafts", icon: Clock },
                  { value: "attention", label: "Needs action", icon: CircleAlert },
                ].map(({ value, label, icon: Icon }) => (
                  <TabsTrigger
                    key={value}
                    value={value}
                    className="gap-1.5 rounded-t-lg rounded-b-none border-b-2 border-transparent px-3 py-2 text-xs data-[state=active]:border-cyan-400 data-[state=active]:bg-cyan-400/[0.07] data-[state=active]:text-cyan-100"
                  >
                    <Icon className="h-3.5 w-3.5" />{label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="relative w-full lg:w-80">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search subject, client, or address…"
                className="pl-9"
                data-testid="email-search"
              />
            </div>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{filteredEmails.length} message{filteredEmails.length === 1 ? "" : "s"} in this view</span>
            <span>Signed in as {user?.name || user?.email || "technician"}</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-72 items-center justify-center">
              <Loader2 className="h-7 w-7 animate-spin text-cyan-300" />
              <span className="ml-3 text-sm text-muted-foreground">Loading communications…</span>
            </div>
          ) : filteredEmails.length > 0 ? (
            <ScrollArea className="h-[540px]">
              <div className="divide-y divide-white/[0.06]">
                {filteredEmails.map((email) => {
                  const messageStatus = STATUS_CONFIG[email.status] || STATUS_CONFIG.draft;
                  return (
                    <button
                      type="button"
                      key={email.id}
                      className="group flex w-full items-start gap-4 p-4 text-left transition-colors hover:bg-cyan-500/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-400/70"
                      onClick={() => setSelectedEmail(email)}
                      data-testid={`email-row-${email.id}`}
                    >
                      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${email.direction === "inbound" ? "border-sky-500/25 bg-sky-500/10 text-sky-300" : "border-emerald-500/20 bg-emerald-500/[0.07] text-emerald-300"}`}>
                        {email.direction === "inbound" ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-medium text-zinc-100">{email.subject || "(No subject)"}</span>
                          <Badge variant="outline" className={`text-[10px] ${messageStatus.className}`}>{messageStatus.label}</Badge>
                        </span>
                        <span className="mt-1 block truncate text-sm text-muted-foreground">
                          {email.direction === "inbound"
                            ? `From ${email.from_name || email.from_address || "Unknown sender"}`
                            : `To ${(email.to_addresses || []).join(", ") || "No recipient"}`}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          {email.client_name && <span className="rounded border border-white/[0.08] bg-white/[0.025] px-1.5 py-0.5">{email.client_name}</span>}
                          {email.delivery_message && <span className="truncate">{email.delivery_message}</span>}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-[11px] text-muted-foreground">
                        {relativeTime(email.sent_at || email.received_at || email.created_at)}
                        {email.status === "draft" && (
                          <span className="mt-2 block text-amber-200">Ready to review</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          ) : (
            <div className="flex min-h-72 flex-col items-center justify-center px-6 py-12 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.06] text-cyan-300">
                {search ? <Search className="h-6 w-6" /> : <Inbox className="h-6 w-6" />}
              </span>
              <p className="mt-4 font-medium text-zinc-200">{search ? "No messages match that search" : "No communications in this view"}</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                {search
                  ? "Try a client name, subject, sender, or recipient."
                  : status.configured
                    ? "Compose an email or sync the connected mailbox to start building the auditable timeline."
                    : "You can safely prepare drafts now, then connect Microsoft 365 before sending."}
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {search && <Button variant="outline" size="sm" onClick={() => setSearch("")}>Clear search</Button>}
                <Button size="sm" onClick={openCompose}><Plus className="mr-1.5 h-3.5 w-3.5" />Compose email</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isComposeOpen} onOpenChange={(open) => {
        if (!saving) setIsComposeOpen(open);
      }}>
        <DialogContent className="max-h-[92vh] max-w-3xl gap-0 overflow-hidden p-0" data-testid="email-compose-dialog">
          <WorkflowDialogHeader
            icon={Send}
            eyebrow="Auditable correspondence"
            title="Compose client email"
            badge={status.configured ? "Microsoft 365 ready" : "Draft only"}
            tone={status.configured ? "emerald" : "cyan"}
            description="Link the message to a client, confirm every recipient, and retain its delivery outcome in the NexusMSP communications ledger."
          />
          <ScrollArea className="max-h-[calc(92vh-190px)]">
            <div className="space-y-5 px-6 py-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Linked client <span className="font-normal text-muted-foreground">(optional)</span></Label>
                  <ClientAutocomplete clients={clients} value={composeData.client_id} onValueChange={selectClient} />
                  <p className="text-[11px] text-muted-foreground">Links the correspondence to the client profile and audit trail.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email-to">To</Label>
                  <Input
                    id="email-to"
                    value={composeData.to_addresses}
                    onChange={(event) => setComposeData({ ...composeData, to_addresses: event.target.value })}
                    placeholder="client@example.com, accounts@example.com"
                    data-testid="email-to"
                    autoFocus
                  />
                  <p className="text-[11px] text-muted-foreground">Separate multiple recipients with commas.</p>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="email-cc">CC <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Input
                  id="email-cc"
                  value={composeData.cc_addresses}
                  onChange={(event) => setComposeData({ ...composeData, cc_addresses: event.target.value })}
                  placeholder="manager@example.com"
                  data-testid="email-cc"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email-subject">Subject</Label>
                <Input
                  id="email-subject"
                  value={composeData.subject}
                  onChange={(event) => setComposeData({ ...composeData, subject: event.target.value })}
                  placeholder="Clear, client-facing subject"
                  data-testid="email-subject"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email-body">Message</Label>
                <Textarea
                  id="email-body"
                  value={composeData.body}
                  onChange={(event) => setComposeData({ ...composeData, body: event.target.value })}
                  placeholder="Write the client update…"
                  rows={10}
                  className="min-h-56 resize-y"
                  data-testid="email-body"
                />
                <p className="text-[11px] text-muted-foreground">Your configured technician signature is added automatically by the delivery service.</p>
              </div>
              <div className={`rounded-xl border p-3 text-xs ${status.configured ? "border-emerald-500/20 bg-emerald-500/[0.04] text-emerald-100" : "border-amber-500/20 bg-amber-500/[0.04] text-amber-100"}`}>
                <div className="flex items-start gap-2">
                  {status.configured ? <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
                  <span>
                    {status.configured
                      ? `Send now uses ${status.sender_email || "the configured Microsoft 365 mailbox"} and records the provider result before the message is marked delivered.`
                      : "Send now is disabled because no Microsoft 365 mailbox is connected. Save the message as a draft or open Mailbox settings."}
                  </span>
                </div>
              </div>
            </div>
          </ScrollArea>
          <DialogFooter className="shrink-0 border-t border-white/[0.07] bg-black/15 px-6 py-4">
            <Button type="button" variant="outline" onClick={resetCompose} disabled={saving}>Cancel</Button>
            {!status.configured && (
              <Button type="button" variant="outline" onClick={() => navigate("/settings?tab=mailbox")} disabled={saving}>
                <Settings className="mr-1.5 h-4 w-4" />Mailbox settings
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => persistEmail()} disabled={saving}>
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Clock className="mr-1.5 h-4 w-4" />}Save draft
            </Button>
            <Button type="button" onClick={() => persistEmail({ sendNow: true })} disabled={saving || !status.configured}>
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}Send now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedEmail)} onOpenChange={(open) => {
        if (!open && !sendingId) setSelectedEmail(null);
      }}>
        <DialogContent className="max-h-[92vh] max-w-3xl gap-0 overflow-hidden p-0" data-testid="email-detail-dialog">
          {selectedEmail && (
            <>
              <WorkflowDialogHeader
                icon={selectedEmail.direction === "inbound" ? ArrowDownLeft : ArrowUpRight}
                eyebrow={selectedEmail.direction === "inbound" ? "Inbound correspondence" : "Outbound correspondence"}
                title={selectedEmail.subject || "(No subject)"}
                badge={(STATUS_CONFIG[selectedEmail.status] || STATUS_CONFIG.draft).label}
                description={`${selectedEmail.direction === "inbound" ? "Received" : "Created"} ${relativeTime(selectedEmail.received_at || selectedEmail.sent_at || selectedEmail.created_at)}${selectedEmail.client_name ? ` · linked to ${selectedEmail.client_name}` : ""}.`}
              />
              <ScrollArea className="max-h-[calc(92vh-190px)]">
                <div className="space-y-5 px-6 py-5">
                  <div className="grid gap-3 rounded-xl border border-white/[0.08] bg-white/[0.025] p-4 text-sm md:grid-cols-2">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">From</p>
                      <p className="mt-1 truncate">{selectedEmail.from_name || selectedEmail.from_address || "Unknown sender"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">To</p>
                      <p className="mt-1 break-words">{(selectedEmail.to_addresses || []).join(", ") || "No recipient"}</p>
                    </div>
                    {(selectedEmail.cc_addresses || []).length > 0 && (
                      <div className="md:col-span-2">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">CC</p>
                        <p className="mt-1 break-words">{selectedEmail.cc_addresses.join(", ")}</p>
                      </div>
                    )}
                  </div>
                  <div className="min-h-56 rounded-xl border border-white/[0.08] bg-black/15 p-5 text-sm leading-6">
                    {selectedEmail.body_type === "text" ? (
                      <p className="whitespace-pre-wrap">{selectedEmail.body}</p>
                    ) : (
                      <div className="prose prose-invert max-w-none text-sm" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(selectedEmail.body || "") }} />
                    )}
                  </div>
                  {selectedEmail.delivery_message && (
                    <div className={`rounded-xl border p-3 text-xs ${selectedEmail.status === "failed" ? "border-rose-500/20 bg-rose-500/[0.04] text-rose-100" : "border-emerald-500/20 bg-emerald-500/[0.04] text-emerald-100"}`}>
                      <p className="font-semibold">Delivery evidence</p>
                      <p className="mt-1 opacity-80">{selectedEmail.delivery_message}</p>
                      {selectedEmail.delivery_id && <p className="mt-1 font-mono text-[10px] opacity-60">Audit ID: {selectedEmail.delivery_id}</p>}
                    </div>
                  )}
                </div>
              </ScrollArea>
              <DialogFooter className="shrink-0 border-t border-white/[0.07] bg-black/15 px-6 py-4">
                {selectedEmail.client_id && (
                  <Button variant="outline" onClick={() => navigate(`/clients?client=${selectedEmail.client_id}`)}>
                    <UserRound className="mr-1.5 h-4 w-4" />Open client
                  </Button>
                )}
                <Button variant="outline" onClick={() => setSelectedEmail(null)} disabled={Boolean(sendingId)}>Close</Button>
                {selectedEmail.status === "draft" && (
                  <Button onClick={() => handleSend(selectedEmail.id)} disabled={Boolean(sendingId) || !status.configured}>
                    {sendingId === selectedEmail.id ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
                    Send through Microsoft 365
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
