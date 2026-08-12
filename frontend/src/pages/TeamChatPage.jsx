import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Link, useSearchParams } from "react-router-dom";
import { API, useAuth } from "@/App";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Activity,
  AlertCircle,
  ArrowRightLeft,
  ArrowLeft,
  AtSign,
  Check,
  CheckCircle2,
  ChevronDown,
  CornerDownRight,
  Download,
  Edit3,
  FileText,
  Hash,
  Loader2,
  Link as LinkIcon,
  Lock,
  MessageCircle,
  MessageSquarePlus,
  MoreHorizontal,
  Paperclip,
  PanelRightOpen,
  Pin,
  Phone,
  Plus,
  Reply,
  RefreshCw,
  Search,
  Send,
  Smile,
  Sparkles,
  Trash2,
  UserRoundCheck,
  Users,
  X,
  XCircle,
} from "lucide-react";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import {
  chatAuthorName,
  channelDisplayName,
  extractOperationalContext,
  filterChatChannels,
  groupChatMessages,
  isLivePresence,
  PRESENCE_META,
  repairDisplayText,
  totalUnread,
} from "@/lib/teamChatHelpers";

const COMMON_EMOJIS = ["👍", "❤️", "😂", "🎉", "🔥", "🚀", "✅", "💯", "👏", "👀"];
const TICKET_REGEX = /\/ticket\s+([\w-]+)/gi;
const INVOICE_REGEX = /\/invoice\s+([\w-]+)/gi;
const PO_REGEX = /\/po\s+([\w-]+)/gi;
const SLASH_COMMANDS = [
  { cmd: "po", args: "PO-####", description: "Link a purchase order" },
  { cmd: "invoice", args: "INV-###", description: "Link an invoice" },
  { cmd: "ticket", args: "TKT-### [status|priority <value>]", description: "Link or update a ticket" },
  { cmd: "close", args: "TKT-###", description: "Close a ticket" },
  { cmd: "assign", args: "@user TKT-###", description: "Assign a ticket" },
  { cmd: "sla", args: "TKT-###", description: "Show SLA timers" },
  { cmd: "note", args: "TKT-### <body>", description: "Add an internal note" },
  { cmd: "summarize", args: "", description: "Summarize recent messages" },
  { cmd: "page", args: "<severity>", description: "Page the team" },
  { cmd: "help", args: "", description: "List commands" },
];
const SLASH_NAMES = new Set(SLASH_COMMANDS.map(command => command.cmd));

const initials = name => String(name || "?").split(/\s+/).filter(Boolean).map(part => part[0]).join("").slice(0, 2).toUpperCase();
const workItemLabel = busyState => {
  if (!busyState) return "Available";
  const [kind, reference] = String(busyState).split(":", 2);
  if (kind === "ticket") return `Working ticket ${reference}`;
  if (kind === "invoice") return `Reviewing invoice ${reference}`;
  if (kind === "po") return `Working purchase order ${reference}`;
  if (kind === "remote") return "In a remote session";
  if (kind === "warroom") return "In a war room";
  return "Working";
};
const avatarHue = value => {
  let hash = 0;
  for (const char of String(value || "")) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
};
const formatTime = value => value ? new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
const formatRelative = value => {
  if (!value) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
};
const formatDay = value => {
  if (!value || value === "unknown") return "Earlier";
  const date = new Date(`${value}T00:00:00`);
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (value === todayKey) return "Today";
  if (value === yesterday.toISOString().slice(0, 10)) return "Yesterday";
  return date.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
};

export default function TeamChatPage() {
  const { token, user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedChannelId = searchParams.get("channel");
  const requestedThreadId = searchParams.get("thread");
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [channels, setChannels] = useState([]);
  const [users, setUsers] = useState([]);
  const [presence, setPresence] = useState({});
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [pinned, setPinned] = useState([]);
  const [files, setFiles] = useState([]);
  const [readReceipts, setReadReceipts] = useState([]);
  const [typingUsers, setTypingUsers] = useState([]);
  const [mode, setMode] = useState("teams");
  const [activeTab, setActiveTab] = useState("posts");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [channelLoading, setChannelLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [thread, setThread] = useState(null);
  const [threadInput, setThreadInput] = useState("");
  const [emojiTarget, setEmojiTarget] = useState(null);
  const [composerEmojiOpen, setComposerEmojiOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [referenceMatches, setReferenceMatches] = useState([]);
  const [referenceIndex, setReferenceIndex] = useState(0);
  const [mobileConversationOpen, setMobileConversationOpen] = useState(false);
  const scrollRef = useRef(null);
  const activeIdRef = useRef(null);
  const nearBottomRef = useRef(true);
  const typingAtRef = useRef(0);
  const fileRef = useRef(null);
  const composerRef = useRef(null);
  const openedThreadRef = useRef("");

  const activeChannel = channels.find(channel => channel.id === activeId);
  const presenceFor = userId => presence[userId]?.led || "offline";
  const myPresence = presenceFor(user?.id);

  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  const loadWorkspace = useCallback(async ({ quiet = false } = {}) => {
    if (!token) return;
    if (!quiet) setLoading(true);
    try {
      const [channelResponse, presenceResponse, userResponse] = await Promise.all([
        axios.get(`${API}/chat/channels-preview`, { headers }),
        axios.get(`${API}/presence`, { headers }),
        axios.get(`${API}/users`, { headers }),
      ]);
      const nextChannels = channelResponse.data || [];
      const presenceRows = presenceResponse.data?.users || [];
      const userRows = Array.isArray(userResponse.data) ? userResponse.data : userResponse.data?.users || [];
      setChannels(nextChannels);
      setPresence(Object.fromEntries(presenceRows.map(row => [row.user_id, row])));
      const activeUsers = userRows.filter(row => row.is_active !== false && row.archived !== true);
      // Seeded/imported user records can occasionally contain the same person more than once.
      // Keep the people picker deterministic and avoid creating duplicate DM targets.
      setUsers(Array.from(new Map(activeUsers.map(row => [String(row.email || row.id).toLowerCase(), row])).values()));
      setActiveId(current => requestedChannelId && nextChannels.some(channel => channel.id === requestedChannelId)
        ? requestedChannelId
        : current && nextChannels.some(channel => channel.id === current) ? current : nextChannels[0]?.id || null);
      setError("");
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || "Nexus Chat could not be loaded.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [headers, requestedChannelId, token]);

  useEffect(() => {
    loadWorkspace();
    const timer = setInterval(() => loadWorkspace({ quiet: true }), 8000);
    return () => clearInterval(timer);
  }, [loadWorkspace]);

  useEffect(() => {
    if (!token) return undefined;
    const heartbeat = () => axios.post(`${API}/presence/heartbeat`, {}, { headers }).catch(() => {});
    heartbeat();
    const timer = setInterval(heartbeat, 25000);
    return () => clearInterval(timer);
  }, [headers, token]);

  const refreshChannel = useCallback(async ({ quiet = false } = {}) => {
    const channelId = activeIdRef.current;
    if (!channelId) return;
    if (!quiet) setChannelLoading(true);
    try {
      const [messageResponse, pinResponse, fileResponse, typingResponse, receiptResponse] = await Promise.all([
        axios.get(`${API}/chat/channels/${channelId}/messages`, { headers }),
        axios.get(`${API}/chat/channels/${channelId}/pinned`, { headers }),
        axios.get(`${API}/chat/channels/${channelId}/files`, { headers }),
        axios.get(`${API}/chat/channels/${channelId}/typing`, { headers }),
        axios.get(`${API}/chat/channels/${channelId}/read-receipts`, { headers }),
      ]);
      if (activeIdRef.current !== channelId) return;
      setMessages(messageResponse.data || []);
      setPinned(pinResponse.data || []);
      setFiles(fileResponse.data || []);
      setReadReceipts(receiptResponse.data || []);
      setTypingUsers(typingResponse.data || []);
      setChannels(current => current.map(channel => channel.id === channelId ? { ...channel, unread_count: 0 } : channel));
      axios.post(`${API}/chat/channels/${channelId}/read`, {}, { headers }).catch(() => {});
    } catch (requestError) {
      if (activeIdRef.current === channelId) setError(requestError?.response?.data?.detail || "This conversation could not be refreshed.");
    } finally {
      if (!quiet && activeIdRef.current === channelId) setChannelLoading(false);
    }
  }, [headers]);

  useEffect(() => {
    setMessages([]);
    setPinned([]);
    setFiles([]);
    setThread(null);
    setActiveTab("posts");
    nearBottomRef.current = true;
    if (!activeId) return undefined;
    refreshChannel();
    const timer = setInterval(() => refreshChannel({ quiet: true }), 3000);
    return () => clearInterval(timer);
  }, [activeId, refreshChannel]);

  const lastMessageId = messages.filter(message => !message.thread_id).at(-1)?.id;
  useEffect(() => {
    if (nearBottomRef.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lastMessageId, activeId]);

  const slashSuggestions = useMemo(() => {
    if (!input.startsWith("/") || input.includes(" ")) return [];
    const term = input.slice(1).toLowerCase();
    return SLASH_COMMANDS.filter(command => command.cmd.startsWith(term));
  }, [input]);

  const referenceMatch = input.match(/^\/(ticket|invoice|po)\s+([^\s]*)$/i);
  const referenceKind = referenceMatch?.[1]?.toLowerCase() || "";
  const referenceQuery = referenceMatch?.[2] || "";
  useEffect(() => {
    if (!referenceKind) { setReferenceMatches([]); return undefined; }
    const timer = setTimeout(() => {
      axios.get(`${API}/chat/reference-search`, { params: { kind: referenceKind, q: referenceQuery }, headers })
        .then(response => { setReferenceMatches(response.data || []); setReferenceIndex(0); })
        .catch(() => setReferenceMatches([]));
    }, 140);
    return () => clearTimeout(timer);
  }, [headers, referenceKind, referenceQuery]);

  const pickReference = reference => {
    if (!referenceMatch) return;
    setInput(`/${referenceMatch[1].toLowerCase()} ${reference.reference} `);
    setReferenceMatches([]);
  };

  const mentionSuggestions = useMemo(() => {
    const match = input.match(/@([\w.-]*)$/);
    if (!match) return [];
    const term = match[1].toLowerCase();
    const memberIds = activeChannel?.member_ids?.length ? new Set(activeChannel.member_ids) : null;
    const teammates = users.filter(candidate => candidate.id !== user?.id && (!memberIds || memberIds.has(candidate.id)) && [candidate.name, candidate.email].some(value => value?.toLowerCase().includes(term))).slice(0, 6);
    const broadcasts = activeChannel?.is_dm ? [] : [
      { id: "broadcast-channel", broadcast: "channel", name: "Channel", detail: "Notify everyone in this channel" },
      { id: "broadcast-here", broadcast: "here", name: "Here", detail: "Notify everyone currently active" },
    ].filter(candidate => candidate.broadcast.includes(term) || candidate.name.toLowerCase().includes(term));
    return [...broadcasts, ...teammates];
  }, [activeChannel, input, user?.id, users]);

  useEffect(() => { setMentionIndex(0); }, [input, activeId]);

  const groupedMessages = useMemo(() => groupChatMessages(messages), [messages]);
  const visibleChannels = useMemo(() => filterChatChannels(channels, mode, query), [channels, mode, query]);

  const selectChannel = channelId => {
    setActiveId(channelId);
    setSearchParams({ channel: channelId }, { replace: true });
    setSearchResults(null);
    setQuery("");
    setMobileConversationOpen(true);
    setShowInfo(false);
  };

  const sendTyping = () => {
    if (!activeId || Date.now() - typingAtRef.current < 2000) return;
    typingAtRef.current = Date.now();
    axios.post(`${API}/chat/channels/${activeId}/typing`, {}, { headers }).catch(() => {});
  };

  const send = async () => {
    const body = input.trim();
    if (!body || !activeId || sending) return;
    const temporaryId = `pending-${Date.now()}`;
    const optimistic = {
      id: temporaryId,
      channel_id: activeId,
      user_id: user?.id,
      user_name: user?.name,
      avatar_url: user?.avatar,
      body,
      ts: new Date().toISOString(),
      reactions: {},
      pending: true,
    };
    setInput("");
    setComposerEmojiOpen(false);
    setSending(true);
    setMessages(current => [...current, optimistic]);
    nearBottomRef.current = true;
    try {
      const commandName = body.startsWith("/") ? body.split(/\s+/)[0].slice(1).toLowerCase() : "";
      const response = body.startsWith("/") && SLASH_NAMES.has(commandName)
        ? await axios.post(`${API}/chat/slash`, { channel_id: activeId, raw: body }, { headers })
        : await axios.post(`${API}/chat/channels/${activeId}/messages`, { body }, { headers });
      setMessages(current => [...current.filter(message => message.id !== temporaryId), response.data]);
      loadWorkspace({ quiet: true });
    } catch (requestError) {
      setMessages(current => current.filter(message => message.id !== temporaryId));
      setInput(body);
      toast.error(requestError?.response?.data?.detail || "Message could not be sent");
    } finally {
      setSending(false);
    }
  };

  const searchMessages = async () => {
    const term = query.trim();
    if (!term) { setSearchResults(null); return; }
    setSearching(true);
    try {
      const response = await axios.get(`${API}/chat/search`, { headers, params: { q: term } });
      setSearchResults(response.data || []);
    } catch (requestError) {
      toast.error(requestError?.response?.data?.detail || "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const updateStatus = async manualState => {
    try {
      await axios.post(`${API}/presence/status`, { manual_state: manualState }, { headers });
      await axios.post(`${API}/presence/heartbeat`, {}, { headers });
      loadWorkspace({ quiet: true });
    } catch {
      toast.error("Status could not be updated");
    }
  };

  const toggleReaction = async (messageId, emoji) => {
    try {
      const response = await axios.post(`${API}/chat/messages/${messageId}/reactions`, { emoji }, { headers });
      setMessages(current => current.map(message => message.id === messageId ? { ...message, reactions: response.data.reactions } : message));
      setThread(current => current && current.parent.id === messageId ? { ...current, parent: { ...current.parent, reactions: response.data.reactions } } : current);
      setEmojiTarget(null);
    } catch {
      toast.error("Reaction could not be saved");
    }
  };

  const openThread = async message => {
    try {
      const response = await axios.get(`${API}/chat/messages/${message.id}/thread`, { headers });
      setThread(response.data);
      setShowInfo(false);
    } catch {
      toast.error("Thread could not be opened");
    }
  };

  const copyMessageLink = async message => {
    const threadId = message.thread_id || message.id;
    const url = `${window.location.origin}/team-chat?channel=${encodeURIComponent(activeId)}&thread=${encodeURIComponent(threadId)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Message link copied");
    } catch {
      toast.error("Message link could not be copied");
    }
  };

  useEffect(() => {
    if (!requestedThreadId || !activeId || openedThreadRef.current === requestedThreadId) return;
    let active = true;
    axios.get(`${API}/chat/messages/${requestedThreadId}/thread`, { headers })
      .then(response => {
        if (!active) return;
        openedThreadRef.current = requestedThreadId;
        setThread(response.data);
        setShowInfo(false);
      })
      .catch(() => active && toast.error("That thread is no longer available"));
    return () => { active = false; };
  }, [activeId, headers, requestedThreadId]);

  const sendThread = async () => {
    const body = threadInput.trim();
    if (!body || !thread) return;
    setThreadInput("");
    try {
      await axios.post(`${API}/chat/messages/${thread.parent.id}/reply`, { body }, { headers });
      const response = await axios.get(`${API}/chat/messages/${thread.parent.id}/thread`, { headers });
      setThread(response.data);
      refreshChannel({ quiet: true });
    } catch {
      setThreadInput(body);
      toast.error("Reply could not be sent");
    }
  };

  const saveEdit = async () => {
    const body = editingText.trim();
    if (!body) return;
    try {
      await axios.put(`${API}/chat/messages/${editingId}`, { body }, { headers });
      setEditingId(null);
      refreshChannel({ quiet: true });
    } catch {
      toast.error("Message could not be edited");
    }
  };

  const deleteMessage = async messageId => {
    if (!window.confirm("Delete this message?")) return;
    try {
      await axios.delete(`${API}/chat/messages/${messageId}`, { headers });
      refreshChannel({ quiet: true });
    } catch {
      toast.error("Message could not be deleted");
    }
  };

  const togglePin = async message => {
    try {
      await axios.post(`${API}/chat/messages/${message.id}/${message.pinned ? "unpin" : "pin"}`, {}, { headers });
      refreshChannel({ quiet: true });
    } catch {
      toast.error("Pin could not be updated");
    }
  };

  const uploadFile = async event => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !activeId) return;
    if (file.size > 10 * 1024 * 1024) { toast.error("Attachments are limited to 10 MB"); return; }
    try {
      const base64 = await readFileAsBase64(file);
      await axios.post(`${API}/chat/channels/${activeId}/upload`, {
        filename: file.name,
        content_type: file.type || "application/octet-stream",
        base64,
      }, { headers });
      toast.success("File shared");
      refreshChannel({ quiet: true });
    } catch (requestError) {
      toast.error(requestError?.response?.data?.detail || "File could not be shared");
    }
  };

  const downloadFile = async attachment => {
    try {
      const response = await axios.get(`${API}/chat/files/${attachment.file_id}`, { headers, responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = attachment.filename || "attachment";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("File could not be downloaded");
    }
  };

  const pickMention = candidate => {
    const handle = candidate.broadcast || candidate.email?.split("@")[0] || candidate.name.replace(/\s+/g, "");
    setInput(current => current.replace(/@[\w.-]*$/, `@${handle} `));
  };

  const unread = totalUnread(channels);
  const activePresence = activeChannel?.other_user_id ? presenceFor(activeChannel.other_user_id) : null;
  const activeTeammates = users.filter(candidate => candidate.id !== user?.id && isLivePresence(presenceFor(candidate.id))).length;
  const activePeople = activeTeammates + (isLivePresence(myPresence) ? 1 : 0);
  const activeChannelTechnicians = useMemo(() => {
    const memberIds = activeChannel?.member_ids?.length ? new Set(activeChannel.member_ids) : null;
    return users.filter(candidate => (!memberIds || memberIds.has(candidate.id)) && isLivePresence(presence[candidate.id]?.led || "offline"));
  }, [activeChannel?.member_ids, presence, users]);
  const operationalContext = useMemo(() => extractOperationalContext(messages), [messages]);
  const draftOperationalCommand = command => {
    setInput(current => current.trim() ? `${current}\n${command}` : command);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  };

  return (
    <div className="space-y-4" data-testid="team-chat-page">
      <OperationalPageHeader
        eyebrow="Nexus Connect · conversation that performs the work"
        title="Nexus Connect"
        description="Coordinate technicians, pass ownership, act on live Nexus objects and preserve every operational decision in one auditable workspace."
        icon={MessageCircle}
        tone="emerald"
        actions={<>
          <span className="inline-flex h-8 items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.07] px-3 text-xs text-emerald-200"><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" /></span>{activePeople} active</span>
          <Button variant="outline" size="sm" onClick={() => { loadWorkspace({ quiet: true }); refreshChannel({ quiet: true }); }} disabled={loading || channelLoading} data-testid="refresh-team-chat-btn"><RefreshCw className={`mr-1.5 h-4 w-4 ${(loading || channelLoading) ? "animate-spin" : ""}`} />Refresh</Button>
          <Button size="sm" onClick={() => setShowNewDialog(true)} data-testid="new-chat-btn"><MessageSquarePlus className="mr-1.5 h-4 w-4" />New conversation</Button>
        </>}
      />

      <section className="h-[calc(100vh-255px)] min-h-[620px] overflow-hidden rounded-2xl border border-border/80 bg-[#0f151c] text-zinc-100 shadow-2xl shadow-black/20">
      <div className="flex h-full overflow-hidden">
      <nav className="hidden md:flex w-[72px] shrink-0 flex-col items-center border-r border-cyan-500/10 bg-[#121a21] py-3" aria-label="Nexus Chat sections">
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-600 shadow-lg shadow-emerald-950/40">
          <MessageCircle className="h-5 w-5 text-white" />
        </div>
        <RailButton icon={Activity} label="Inbox" active={mode === "activity"} badge={unread} onClick={() => setMode("activity")} />
        <RailButton icon={MessageCircle} label="Direct" active={mode === "chat"} onClick={() => setMode("chat")} />
        <RailButton icon={Users} label="Channels" active={mode === "teams"} onClick={() => setMode("teams")} />
        <RailButton icon={FileText} label="Work rooms" active={mode === "work"} onClick={() => setMode("work")} />
        <div className="mt-auto px-2 text-center text-[9px] uppercase tracking-[0.16em] text-zinc-600">Nexus<br />Chat</div>
      </nav>

      <aside className={`${mobileConversationOpen ? "hidden md:flex" : "flex"} w-full md:w-[320px] shrink-0 flex-col border-r border-cyan-500/10 bg-[#151e27]`}>
        <div className="border-b border-cyan-500/10 px-4 pb-3 pt-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300">Nexus collaboration</p>
              <h1 className="text-xl font-semibold">{mode === "activity" ? "Inbox" : mode === "teams" ? "Channels" : mode === "work" ? "Work rooms" : "Direct messages"}</h1>
            </div>
            <div className="flex items-center gap-1.5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-9 w-9 rounded-lg p-0 text-zinc-400 hover:bg-white/[0.08] hover:text-white" data-testid="collaboration-workspace-tools" aria-label="Collaboration workspace tools">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem asChild><Link to="/live-chat"><MessageCircle className="mr-2 h-4 w-4" />Client live chat</Link></DropdownMenuItem>
                  <DropdownMenuItem asChild><Link to="/script-ticket"><FileText className="mr-2 h-4 w-4" />Script-to-ticket</Link></DropdownMenuItem>
                  <DropdownMenuItem asChild><Link to="/voice"><Phone className="mr-2 h-4 w-4" />Voice services</Link></DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 text-[10px] text-zinc-500">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/15 bg-emerald-500/5 px-2 py-1 text-emerald-300"><span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" /></span>{activePeople} active now</span>
            {unread > 0 && <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-cyan-200">{unread} need attention</span>}
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <Input
              value={query}
              onChange={event => { setQuery(event.target.value); if (!event.target.value) setSearchResults(null); }}
              onKeyDown={event => event.key === "Enter" && searchMessages()}
              placeholder="Search chats and messages"
              className="h-9 border-white/5 bg-black/20 pl-9 pr-9 text-sm placeholder:text-zinc-600 focus-visible:ring-emerald-500/50"
              data-testid="chat-search"
            />
            {searching ? (
              <Loader2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-emerald-400" />
            ) : query ? (
              <button
                type="button"
                onClick={() => { setQuery(""); setSearchResults(null); }}
                className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-zinc-500 transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
                aria-label="Clear chat search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </div>

        {error && (
          <div className="m-3 flex items-start gap-2 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span className="flex-1">{error}</span>
            <button type="button" onClick={() => loadWorkspace()} className="shrink-0 rounded-md px-1.5 py-1 font-medium text-rose-100 transition hover:bg-rose-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/50">Retry</button>
          </div>
        )}

        <ScrollArea className="flex-1">
          <div className="p-2">
            {loading ? (
              <ConversationSkeleton />
            ) : visibleChannels.length === 0 ? (
              <div className="px-6 py-16 text-center">
                <MessageCircle className="mx-auto mb-3 h-9 w-9 text-zinc-700" />
                <p className="text-sm font-medium text-zinc-300">{mode === "activity" ? "You’re all caught up" : "No conversations found"}</p>
                <p className="mt-1 text-xs text-zinc-600">{mode === "activity" ? "New mentions and unread chats appear here." : mode === "work" ? "Ticket Pass creates a secure room around the work." : "Start a chat or create a team channel."}</p>
              </div>
            ) : visibleChannels.map(channel => (
              <ConversationRow
                key={channel.id}
                channel={channel}
                active={channel.id === activeId}
                presence={presenceFor(channel.other_user_id)}
                onClick={() => selectChannel(channel.id)}
              />
            ))}
          </div>
        </ScrollArea>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-3 border-t border-white/5 px-4 py-3 text-left hover:bg-white/[0.03]" data-testid="chat-status-menu">
              <TechnicianAvatar name={user?.name} avatarUrl={user?.avatar} className="h-9 w-9" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{user?.name}</p>
                <PresenceLabel status={myPresence} detail={workItemLabel(presence[user?.id]?.busy_state)} />
              </div>
              <ChevronDown className="h-4 w-4 text-zinc-600" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>Set your status</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {[
              ["", "active", "Available"],
              ["dnd", "dnd", "Do not disturb"],
              ["break", "break", "On a break"],
              ["away", "away", "Appear away"],
            ].map(([value, status, label]) => (
              <DropdownMenuItem key={status} onClick={() => updateStatus(value)}>
                <span className={`h-2.5 w-2.5 rounded-full ${PRESENCE_META[status].dot}`} />{label}
                {myPresence === status && <Check className="ml-auto h-4 w-4" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </aside>

      <main className={`${mobileConversationOpen ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col bg-[#0e151c]`}>
        {!activeChannel ? (
          <EmptyWorkspace onNew={() => setShowNewDialog(true)} />
        ) : (
          <>
            <header className="border-b border-cyan-500/10 bg-[#121b24] px-3 md:px-5">
              <div className="flex h-16 items-center gap-3">
                <Button variant="ghost" size="sm" className="h-9 w-9 p-0 md:hidden" onClick={() => setMobileConversationOpen(false)} aria-label="Back to conversations"><ArrowLeft className="h-4 w-4" /></Button>
                <ChannelAvatar channel={activeChannel} presence={activePresence} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-base font-semibold">{channelDisplayName(activeChannel)}</h2>
                    {activeChannel.is_private && <Lock className="h-3.5 w-3.5 text-zinc-500" />}
                  </div>
                  <p className="truncate text-xs text-zinc-500">
                    {activeChannel.kind === "dm"
                      ? PRESENCE_META[activePresence || "offline"].label
                      : activeChannel.description || `${activeChannel.member_count || 0} members`}
                  </p>
                </div>
                {typingUsers.length > 0 && <span className="hidden text-xs text-cyan-200 lg:block">{typingUsers.map(row => row.user_name).join(", ")} typing…</span>}
                <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-zinc-400 hover:text-white" onClick={() => { setShowInfo(current => !current); setThread(null); }} aria-label="Conversation details"><PanelRightOpen className="h-4 w-4" /></Button>
              </div>
              <div className="flex h-10 items-end gap-5 text-sm">
                {[
                  ["posts", "Posts", MessageCircle, messages.filter(message => !message.thread_id).length],
                  ["files", "Files", FileText, files.length],
                  ["pins", "Pinned", Pin, pinned.length],
                ].map(([value, label, Icon, count]) => (
                  <button key={value} onClick={() => { setActiveTab(value); setSearchResults(null); }} className={`flex h-10 items-center gap-1.5 border-b-2 px-1 transition ${activeTab === value ? "border-emerald-500 text-white" : "border-transparent text-zinc-500 hover:text-zinc-200"}`}>
                    <Icon className="h-3.5 w-3.5" />{label}{count > 0 && <span className="text-[10px] text-zinc-600">{count}</span>}
                  </button>
                ))}
              </div>
            </header>

            {activeTab === "posts" && !searchResults && activeChannel.kind === "team" && (
              <NexusOperationsPulse
                activeTechnicians={activeChannelTechnicians}
                context={operationalContext}
                pinnedCount={pinned.length}
                onDraftCommand={draftOperationalCommand}
              />
            )}

            {searchResults ? (
              <SearchResults results={searchResults} onSelect={result => { selectChannel(result.channel_id); openThread({ id: result.thread_id || result.id }); }} onClose={() => setSearchResults(null)} />
            ) : activeTab === "files" ? (
              <FilesView files={files} onDownload={downloadFile} />
            ) : activeTab === "pins" ? (
              <PinnedView messages={pinned} onOpenThread={openThread} />
            ) : (
              <>
                <div
                  ref={scrollRef}
                  onScroll={event => { const node = event.currentTarget; nearBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 120; }}
                  className="flex-1 overflow-y-auto"
                  data-testid="chat-message-list"
                >
                  {channelLoading && messages.length === 0 ? (
                    <div className="flex h-full items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-emerald-400" /></div>
                  ) : groupedMessages.length === 0 ? (
                    <ConversationWelcome channel={activeChannel} />
                  ) : (
                    <div className="mx-auto max-w-4xl px-3 py-5 md:px-8">
                      {groupedMessages.map(group => group.type === "day" ? (
                        <DayDivider key={group.key} label={formatDay(group.day)} />
                      ) : (
                        <MessageRow
                          key={group.key}
                          message={group.message}
                          compact={group.compact}
                          own={group.message.user_id === user?.id}
                           currentUserId={user?.id}
                           headers={headers}
                           presence={presence}
                           readReceipts={readReceipts}
                          editing={editingId === group.message.id}
                          editingText={editingText}
                          onEditingText={setEditingText}
                          onStartEdit={() => { setEditingId(group.message.id); setEditingText(group.message.body); }}
                          onCancelEdit={() => setEditingId(null)}
                          onSaveEdit={saveEdit}
                          onDelete={() => deleteMessage(group.message.id)}
                          onPin={() => togglePin(group.message)}
                          onThread={() => openThread(group.message)}
                          onCopyMessageLink={() => copyMessageLink(group.message)}
                          onReact={emoji => toggleReaction(group.message.id, emoji)}
                          emojiOpen={emojiTarget === group.message.id}
                          onEmojiOpen={() => setEmojiTarget(group.message.id)}
                          onEmojiClose={() => setEmojiTarget(null)}
                          onDownload={downloadFile}
                        />
                      ))}
                      {typingUsers.length > 0 && <TypingIndicator users={typingUsers} />}
                    </div>
                  )}
                </div>

                <div className="border-t border-cyan-500/10 bg-[#121b24] p-3 md:px-5 md:py-4">
                  <div className="relative mx-auto max-w-4xl rounded-xl border border-cyan-500/10 bg-[#19232e] shadow-lg shadow-black/20 focus-within:border-emerald-500/50 focus-within:shadow-emerald-950/20">
                    {referenceMatch && referenceMatches.length > 0 && (
                      <SuggestionPanel className="bottom-full" title={`Link ${referenceMatch[1].toLowerCase()}`}>
                        {referenceMatches.map((reference, index) => (
                          <button key={reference.id || reference.reference} onMouseEnter={() => setReferenceIndex(index)} onClick={() => pickReference(reference)} className={`flex w-full items-start gap-3 px-3 py-2 text-left ${referenceIndex === index ? "bg-emerald-500/15" : "hover:bg-white/5"}`}>
                            <FileText className="mt-0.5 h-4 w-4 text-emerald-400" />
                            <div className="min-w-0"><code className="text-sm text-emerald-300">{reference.reference}</code><p className="truncate text-xs text-zinc-300">{reference.title}</p><p className="text-[11px] text-zinc-500">{reference.subtitle}</p></div>
                          </button>
                        ))}
                        <p className="border-t border-white/5 px-3 py-1.5 text-[10px] text-zinc-500">Tab selects · keep typing to add context</p>
                      </SuggestionPanel>
                    )}
                    {slashSuggestions.length > 0 && (
                      <SuggestionPanel className="bottom-full" title="Commands">
                        {slashSuggestions.map((command, index) => (
                          <button key={command.cmd} onMouseEnter={() => setSlashIndex(index)} onClick={() => setInput(`/${command.cmd}${command.args ? " " : ""}`)} className={`flex w-full items-start gap-3 px-3 py-2 text-left ${slashIndex === index ? "bg-emerald-500/15" : "hover:bg-white/5"}`}>
                            <Sparkles className="mt-0.5 h-4 w-4 text-emerald-400" />
                            <div><code className="text-sm text-emerald-300">/{command.cmd}</code> <span className="text-xs text-zinc-500">{command.args}</span><p className="text-xs text-zinc-500">{command.description}</p></div>
                          </button>
                        ))}
                      </SuggestionPanel>
                    )}
                    {mentionSuggestions.length > 0 && !slashSuggestions.length && (
                      <SuggestionPanel className="bottom-full" title="Mention a teammate">
                        {mentionSuggestions.map((candidate, index) => (
                          <button key={candidate.id} onMouseEnter={() => setMentionIndex(index)} onClick={() => pickMention(candidate)} className={`flex w-full items-center gap-3 px-3 py-2 text-left ${mentionIndex === index ? "bg-cyan-500/15" : "hover:bg-white/5"}`}>
                            {candidate.broadcast ? <div className="grid h-7 w-7 place-items-center rounded-full bg-cyan-500/15 text-cyan-200"><AtSign className="h-3.5 w-3.5" /></div> : <TechnicianAvatar name={candidate.name} avatarUrl={candidate.avatar} className="h-7 w-7" fallbackClassName="text-[9px]" />}
                            <div><p className="text-sm">{candidate.broadcast ? `@${candidate.broadcast}` : candidate.name}</p><p className="text-[11px] text-zinc-500">{candidate.detail || candidate.email}</p></div>
                          </button>
                        ))}
                      </SuggestionPanel>
                    )}
                    {composerEmojiOpen && (
                      <div className="absolute bottom-full left-10 z-30 mb-2 flex gap-1 rounded-xl border border-white/10 bg-[#252832] p-2 shadow-2xl">
                        {COMMON_EMOJIS.map(emoji => <button key={emoji} onClick={() => { setInput(current => `${current}${emoji}`); setComposerEmojiOpen(false); }} className="rounded-lg p-1.5 text-lg hover:bg-white/10">{emoji}</button>)}
                      </div>
                    )}
                    <Textarea
                      ref={composerRef}
                      value={input}
                      onChange={event => { setInput(event.target.value.slice(0, 5000)); sendTyping(); setSlashIndex(0); }}
                      onKeyDown={event => {
                        if (referenceMatches.length > 0 && ["ArrowDown", "ArrowUp", "Tab"].includes(event.key)) {
                          event.preventDefault();
                          if (event.key === "ArrowDown") setReferenceIndex(index => (index + 1) % referenceMatches.length);
                          else if (event.key === "ArrowUp") setReferenceIndex(index => (index - 1 + referenceMatches.length) % referenceMatches.length);
                          else pickReference(referenceMatches[referenceIndex]);
                          return;
                        }
                        if (slashSuggestions.length > 0 && ["ArrowDown", "ArrowUp", "Tab"].includes(event.key)) {
                          event.preventDefault();
                          if (event.key === "ArrowDown") setSlashIndex(index => (index + 1) % slashSuggestions.length);
                          else if (event.key === "ArrowUp") setSlashIndex(index => (index - 1 + slashSuggestions.length) % slashSuggestions.length);
                          else setInput(`/${slashSuggestions[slashIndex].cmd}${slashSuggestions[slashIndex].args ? " " : ""}`);
                          return;
                        }
                        if (mentionSuggestions.length > 0 && ["ArrowDown", "ArrowUp", "Tab"].includes(event.key)) {
                          event.preventDefault();
                          if (event.key === "ArrowDown") setMentionIndex(index => (index + 1) % mentionSuggestions.length);
                          else if (event.key === "ArrowUp") setMentionIndex(index => (index - 1 + mentionSuggestions.length) % mentionSuggestions.length);
                          else pickMention(mentionSuggestions[mentionIndex]);
                          return;
                        }
                        if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); }
                      }}
                      placeholder={`Message ${channelDisplayName(activeChannel)}`}
                      className="min-h-[64px] resize-none border-0 bg-transparent px-4 pb-2 pt-3 text-sm shadow-none focus-visible:ring-0"
                      aria-label={`Message ${channelDisplayName(activeChannel)}`}
                      data-testid="chat-input"
                    />
                    <div className="flex flex-wrap items-center gap-1 px-3 pb-1.5 text-[10px]">
                      <span className="mr-1 uppercase tracking-[0.14em] text-zinc-600">Ops actions</span>
                      <button type="button" onClick={() => setInput("/ticket ")} className="rounded-md border border-white/5 bg-white/[0.03] px-2 py-1 text-zinc-400 transition hover:border-cyan-500/30 hover:bg-cyan-500/10 hover:text-cyan-100">Link ticket</button>
                      <button type="button" onClick={() => setInput("/invoice ")} className="rounded-md border border-white/5 bg-white/[0.03] px-2 py-1 text-zinc-400 transition hover:border-cyan-500/30 hover:bg-cyan-500/10 hover:text-cyan-100">Link invoice</button>
                      <button type="button" onClick={() => setInput("/po ")} className="rounded-md border border-white/5 bg-white/[0.03] px-2 py-1 text-zinc-400 transition hover:border-cyan-500/30 hover:bg-cyan-500/10 hover:text-cyan-100">Link PO</button>
                      <button type="button" onClick={() => setInput("/note ")} className="rounded-md border border-white/5 bg-white/[0.03] px-2 py-1 text-zinc-400 transition hover:border-cyan-500/30 hover:bg-cyan-500/10 hover:text-cyan-100">Add note</button>
                      <button type="button" onClick={() => setInput("/page ")} className="rounded-md border border-white/5 bg-white/[0.03] px-2 py-1 text-zinc-400 transition hover:border-rose-500/30 hover:bg-rose-500/10 hover:text-rose-200">Page on-call</button>
                      <button type="button" onClick={() => setInput("/summarize")} className="rounded-md border border-white/5 bg-white/[0.03] px-2 py-1 text-zinc-400 transition hover:border-emerald-500/30 hover:bg-emerald-500/10 hover:text-emerald-100">AI summary</button>
                    </div>
                    <div className="flex items-center gap-1 px-2 pb-2">
                      <input ref={fileRef} type="file" className="hidden" onChange={uploadFile} />
                      <ComposerButton icon={Paperclip} label="Attach file" onClick={() => fileRef.current?.click()} />
                      <ComposerButton icon={Smile} label="Emoji" onClick={() => setComposerEmojiOpen(current => !current)} />
                      <ComposerButton icon={AtSign} label="Mention" onClick={() => setInput(current => `${current}@`)} />
                      <span className="ml-1 hidden text-[10px] text-zinc-600 sm:inline">Shift+Enter for a new line</span>
                      <span className="ml-auto hidden text-[10px] tabular-nums text-zinc-600 sm:inline">{input.length}/5000</span>
                      <Button onClick={send} disabled={!input.trim() || sending} className="h-8 rounded-lg bg-emerald-600 px-3 hover:bg-emerald-500" data-testid="chat-send">
                        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        <span className="ml-1.5 hidden sm:inline">Send</span>
                      </Button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </main>

      {showInfo && activeChannel && (
        <InfoPanel channel={activeChannel} users={users} presenceFor={presenceFor} currentUserId={user?.id} headers={headers} onUpdated={() => loadWorkspace({ quiet: true })} onClose={() => setShowInfo(false)} />
      )}
      {thread && (
        <ThreadPanel
          thread={thread}
          currentUserId={user?.id}
          headers={headers}
          input={threadInput}
          onInput={setThreadInput}
          onSend={sendThread}
          onClose={() => setThread(null)}
        />
      )}

      <NewConversationDialog
        open={showNewDialog}
        onOpenChange={setShowNewDialog}
        users={users}
        currentUserId={user?.id}
        headers={headers}
        onCreated={channel => {
          setChannels(current => [channel, ...current.filter(existing => existing.id !== channel.id)]);
          setMode(channel.kind === "team" ? "teams" : channel.kind === "object" ? "work" : "chat");
          setActiveId(channel.id);
          setSearchParams({ channel: channel.id }, { replace: true });
          setMobileConversationOpen(true);
          setShowNewDialog(false);
        }}
      />
      </div>
      </section>
    </div>
  );
}

function NexusOperationsPulse({ activeTechnicians, context, pinnedCount, onDraftCommand }) {
  const liveLabel = activeTechnicians.length === 1 ? "1 technician active" : `${activeTechnicians.length} technicians active`;
  const contextMetrics = [
    ["Tickets", context.tickets, "border-cyan-500/20 bg-cyan-500/[0.06] text-cyan-100"],
    ["Invoices", context.invoices, "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-100"],
    ["Purchase orders", context.purchaseOrders, "border-amber-500/20 bg-amber-500/[0.06] text-amber-100"],
    ["Pinned", pinnedCount, "border-white/10 bg-white/[0.03] text-zinc-200"],
  ];

  return (
    <section className="border-b border-cyan-500/10 bg-gradient-to-r from-cyan-500/[0.08] via-emerald-500/[0.045] to-transparent px-3 py-2.5 md:px-5" aria-label="Nexus operations pulse">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-2.5 rounded-xl border border-cyan-500/10 bg-[#101a22]/70 px-3 py-2 shadow-inner shadow-cyan-950/20">
        <div className="flex items-center gap-2 pr-1">
          <span className="relative grid h-8 w-8 place-items-center rounded-lg border border-emerald-500/25 bg-emerald-500/[0.10] text-emerald-300">
            <span className="absolute h-2 w-2 animate-ping rounded-full bg-emerald-400/70" /><Activity className="relative h-4 w-4" />
          </span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-emerald-300">Nexus operations pulse</p>
            <p className="text-xs text-zinc-500">{liveLabel}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5" aria-label="Linked work in this channel">
          {contextMetrics.map(([label, value, className]) => (
            <span key={label} className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] ${className}`}>
              <strong className="text-xs leading-none">{value}</strong>{label}
            </span>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => onDraftCommand("/ticket ")} className="rounded-md border border-white/8 bg-white/[0.03] px-2 py-1 text-[10px] font-medium text-zinc-300 transition hover:border-cyan-500/30 hover:bg-cyan-500/10 hover:text-cyan-100">Link work</button>
          <button type="button" onClick={() => onDraftCommand("/page high")} className="rounded-md border border-rose-500/15 bg-rose-500/[0.05] px-2 py-1 text-[10px] font-medium text-rose-200 transition hover:border-rose-400/40 hover:bg-rose-500/10">Page team</button>
          <button type="button" onClick={() => onDraftCommand("/summarize")} className="rounded-md border border-emerald-500/15 bg-emerald-500/[0.05] px-2 py-1 text-[10px] font-medium text-emerald-100 transition hover:border-emerald-400/40 hover:bg-emerald-500/10">Handoff brief</button>
        </div>
      </div>
    </section>
  );
}

function RailButton({ icon: Icon, label, active, badge = 0, onClick }) {
  return (
    <button onClick={onClick} aria-current={active ? "page" : undefined} className={`relative mb-2 flex w-full flex-col items-center gap-1 border-l-2 py-2 text-[10px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-400/60 ${active ? "border-cyan-500 bg-cyan-500/[0.05] text-cyan-200" : "border-transparent text-zinc-500 hover:text-zinc-200"}`}>
      <Icon className="h-5 w-5" />{label}
      {badge > 0 && <span className="absolute right-3 top-0 min-w-4 rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">{badge > 99 ? "99+" : badge}</span>}
    </button>
  );
}

function ConversationRow({ channel, active, presence, onClick }) {
  const name = channelDisplayName(channel);
  return (
    <button onClick={onClick} aria-current={active ? "page" : undefined} className={`mb-0.5 flex w-full gap-3 rounded-lg border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${active ? "border-cyan-500/20 bg-cyan-500/10 shadow-sm shadow-cyan-950/20" : "border-transparent hover:bg-white/[0.04]"}`} data-testid={`channel-${channel.id}`}>
      <ChannelAvatar channel={channel} presence={presence} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className={`truncate text-sm ${channel.unread_count ? "font-semibold text-white" : "font-medium text-zinc-300"}`}>{name}</p>
          <span className="ml-auto shrink-0 text-[10px] text-zinc-600">{formatRelative(channel.last_message?.ts || channel.updated_at || channel.created_at)}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <p className={`truncate text-xs ${channel.unread_count ? "text-zinc-300" : "text-zinc-600"}`}>
            {channel.last_message ? `${channel.last_message.user_name ? `${chatAuthorName(channel.last_message.user_name, channel.last_message.is_system).split(" ")[0]}: ` : ""}${repairDisplayText(channel.last_message.body || "Attachment")}` : channel.kind === "team" ? channel.description || "Team channel" : "Start a conversation"}
          </p>
          {channel.unread_count > 0 && <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-cyan-500 px-1.5 text-[10px] font-semibold text-white">{channel.unread_count > 99 ? "99+" : channel.unread_count}</span>}
        </div>
      </div>
    </button>
  );
}

function ChannelAvatar({ channel, presence, size = "sm" }) {
  const dimension = size === "md" ? "h-10 w-10" : "h-10 w-10";
  const name = channelDisplayName(channel);
  const statusMeta = presence ? PRESENCE_META[presence] || PRESENCE_META.offline : null;
  return (
    <div className="relative shrink-0">
      {channel.kind === "team" ? (
        <Avatar className={dimension}>
          <AvatarFallback style={avatarStyle(name)}><Hash className="h-4 w-4" /></AvatarFallback>
        </Avatar>
      ) : channel.kind === "object" ? (
        <Avatar className={dimension}>
          <AvatarFallback className="border border-emerald-500/25 bg-emerald-500/10 text-emerald-200"><FileText className="h-4 w-4" /></AvatarFallback>
        </Avatar>
      ) : <TechnicianAvatar name={name} avatarUrl={channel.avatar} className={dimension} />}
      {statusMeta && <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-[#1d1f26] ${statusMeta.dot}`} />}
    </div>
  );
}

function TechnicianAvatar({ name, avatarUrl, className = "h-9 w-9", fallbackClassName = "" }) {
  return (
    <Avatar className={className}>
      {avatarUrl && <AvatarImage src={avatarUrl} alt={`${name || "Technician"} profile`} className="object-cover" />}
      <AvatarFallback className={fallbackClassName} style={avatarStyle(name)}>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

function PresenceLabel({ status, detail }) {
  const meta = PRESENCE_META[status] || PRESENCE_META.offline;
  return <div><p className={`flex items-center gap-1.5 text-[11px] ${meta.text}`}><span className={`h-2 w-2 rounded-full ${meta.dot}`} />{meta.label}</p>{detail && detail !== "Available" && <p className="mt-0.5 truncate text-[10px] text-zinc-500">{detail}</p>}</div>;
}

function MessageRow({ message, compact, own, currentUserId, headers, presence, readReceipts, editing, editingText, onEditingText, onStartEdit, onCancelEdit, onSaveEdit, onDelete, onPin, onThread, onCopyMessageLink, onReact, emojiOpen, onEmojiOpen, onEmojiClose, onDownload }) {
  const [hovered, setHovered] = useState(false);
  if (message.is_system) {
    const text = repairDisplayText(message.body);
    const isWarning = /unknown command|not found|could not|couldn't|invalid|failed|error/i.test(text);
    return (
      <div className="my-3 flex justify-center">
        <div className={`flex max-w-2xl items-start gap-2 rounded-lg border px-4 py-2 text-left text-xs ${isWarning ? "border-amber-500/25 bg-amber-500/[0.08] text-amber-100" : "border-cyan-500/20 bg-cyan-500/10 text-cyan-100"}`}>
          {isWarning ? <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" /> : <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300" />}
          <div><span className="mr-1.5 font-semibold">{isWarning ? "Command notice" : "Nexus Automation"}</span>{" "}{text}</div>
        </div>
      </div>
    );
  }
  return (
    <div className={`group relative flex gap-3 rounded-xl px-2 py-2 transition-colors ${own ? "border border-emerald-500/10 bg-emerald-500/[0.035]" : "hover:bg-cyan-500/[0.025]"} ${compact ? "mt-0.5" : "mt-2"} ${message.pending ? "opacity-60" : ""}`} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div className="w-9 shrink-0">{!compact && <TechnicianAvatar name={message.user_name} avatarUrl={message.avatar_url || message.avatar} className="h-9 w-9" />}</div>
      <div className="min-w-0 flex-1">
        {!compact && <div className="mb-1 flex items-center gap-2"><span className="text-sm font-semibold text-zinc-200">{message.user_name}</span><span className="text-[10px] text-zinc-600">{formatTime(message.ts)}</span>{message.edited && <span className="text-[9px] text-zinc-600">Edited</span>}{message.pinned && <Pin className="h-3 w-3 text-amber-400" />}</div>}
        {editing ? (
          <div className="flex gap-2"><Input value={editingText} onChange={event => onEditingText(event.target.value)} onKeyDown={event => event.key === "Enter" && onSaveEdit()} autoFocus className="h-9 border-white/10 bg-black/20" /><Button size="sm" onClick={onSaveEdit}>Save</Button><Button size="sm" variant="ghost" onClick={onCancelEdit}>Cancel</Button></div>
        ) : (
          <div className={`text-sm leading-6 ${message.deleted ? "italic text-zinc-600" : "text-zinc-300"}`}>
            <MessageBody body={message.body} headers={headers} presence={presence} currentUserId={currentUserId} channelId={message.channel_id} />
            {message.attachment && <AttachmentCard attachment={message.attachment} headers={headers} onDownload={() => onDownload(message.attachment)} />}
            {message.action_card?.kind === "ticket_pass" && <TicketPassCard handoffId={message.action_card.id} headers={headers} currentUserId={currentUserId} />}
          </div>
        )}
        {onReact && message.reactions && Object.keys(message.reactions).length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">{Object.entries(message.reactions).map(([emoji, voters]) => <button key={emoji} onClick={() => onReact(emoji)} className={`rounded-full border px-2 py-0.5 text-xs ${voters.includes?.(currentUserId) ? "border-emerald-500/50 bg-emerald-500/15" : "border-white/10 bg-white/[0.03]"}`}>{emoji} <span className="text-zinc-500">{voters.length}</span></button>)}</div>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-2">{message.thread_count > 0 && onThread && <button onClick={onThread} className="flex items-center gap-1 text-xs font-medium text-cyan-300 hover:text-cyan-200"><CornerDownRight className="h-3.5 w-3.5" />{message.thread_count} {message.thread_count === 1 ? "reply" : "replies"}</button>}<MessageReadReceipt message={message} currentUserId={currentUserId} receipts={readReceipts} /></div>
      </div>
      {hovered && !editing && !message.pending && !message.deleted && (onReact || onThread || onCopyMessageLink || onPin || onStartEdit || onDelete) && (
        <div className="absolute right-3 top-0 flex -translate-y-1/2 items-center rounded-lg border border-white/10 bg-[#252832] p-0.5 shadow-xl">
          {onReact && <MessageAction icon={Smile} label="React" onClick={onEmojiOpen} />}
          {onThread && <MessageAction icon={Reply} label="Reply" onClick={onThread} />}
          {onCopyMessageLink && <MessageAction icon={LinkIcon} label="Copy message link" onClick={onCopyMessageLink} />}
          {onPin && <MessageAction icon={Pin} label={message.pinned ? "Unpin" : "Pin"} onClick={onPin} />}
          {own && onStartEdit && <MessageAction icon={Edit3} label="Edit" onClick={onStartEdit} />}
          {own && onDelete && <MessageAction icon={Trash2} label="Delete" onClick={onDelete} destructive />}
        </div>
      )}
      {emojiOpen && (
        <div className="absolute right-3 top-7 z-30 flex gap-1 rounded-xl border border-white/10 bg-[#252832] p-2 shadow-2xl">
          {COMMON_EMOJIS.map(emoji => <button key={emoji} onClick={() => onReact(emoji)} className="rounded-lg p-1 text-base hover:bg-white/10">{emoji}</button>)}
          <button onClick={onEmojiClose} className="ml-1 rounded-lg p-1 text-zinc-500 hover:bg-white/10"><X className="h-4 w-4" /></button>
        </div>
      )}
    </div>
  );
}

function MessageReadReceipt({ message, currentUserId, receipts }) {
  if (!message.ts || message.pending || message.deleted || message.user_id !== currentUserId) return null;
  const readers = (receipts || []).filter(receipt => receipt.user_id !== message.user_id && receipt.user_id !== currentUserId && receipt.last_read_at >= message.ts);
  if (!readers.length) return null;
  return <span className="flex items-center gap-1.5 text-[10px] text-zinc-500" title={`Seen by ${readers.map(reader => reader.user_name).join(", ")}`}><span className="flex -space-x-1">{readers.slice(0, 3).map(reader => <TechnicianAvatar key={reader.user_id} name={reader.user_name} avatarUrl={reader.avatar_url || reader.avatar} className="h-4 w-4 border border-[#1d1f26]" fallbackClassName="text-[7px]" />)}</span><Check className="h-3 w-3 text-emerald-400" />Seen{readers.length > 1 ? ` by ${readers.length}` : ""}</span>;
}

function MessageAction({ icon: Icon, label, onClick, destructive }) {
  return <button onClick={onClick} title={label} aria-label={label} className={`rounded-md p-1.5 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${destructive ? "text-rose-400 focus-visible:ring-rose-400/60" : "text-zinc-400 hover:text-zinc-100"}`}><Icon className="h-3.5 w-3.5" /></button>;
}

function MessageBody({ body, headers, presence, currentUserId, channelId }) {
  const text = repairDisplayText(body);
  const tickets = [...new Set([...text.matchAll(TICKET_REGEX)].map(match => match[1]))];
  const invoices = [...new Set([...text.matchAll(INVOICE_REGEX)].map(match => match[1]))];
  const purchaseOrders = [...new Set([...text.matchAll(PO_REGEX)].map(match => match[1]))];
  if (!tickets.length && !invoices.length && !purchaseOrders.length) return <RichMessageText text={text} />;
  return (
    <>
      <RichMessageText text={text} />
      {tickets.map(ticketNumber => <TicketCard key={ticketNumber} ticketNumber={ticketNumber} headers={headers} presence={presence} currentUserId={currentUserId} channelId={channelId} />)}
      {invoices.map(invoiceNumber => <InvoiceCard key={invoiceNumber} invoiceNumber={invoiceNumber} headers={headers} presence={presence} />)}
      {purchaseOrders.map(poNumber => <div key={poNumber}><PurchaseOrderCard poNumber={poNumber} headers={headers} /><WorkPresence kind="po" reference={poNumber} presence={presence} headers={headers} /></div>)}
    </>
  );
}

function RichMessageText({ text }) {
  return <span className="whitespace-pre-wrap break-words">{String(text || "").split(/(@[\w.-]+)/g).map((part, index) => part.startsWith("@") ? <span key={`${part}-${index}`} className={`rounded px-1 py-0.5 text-xs font-medium ${["@channel", "@here", "@everyone"].includes(part.toLowerCase()) ? "bg-amber-500/15 text-amber-200" : "bg-cyan-500/15 text-cyan-100"}`}>{part}</span> : part)}</span>;
}

function TicketCard({ ticketNumber, headers, presence, currentUserId, channelId }) {
  const [ticket, setTicket] = useState(null);
  const [passOpen, setPassOpen] = useState(false);
  useEffect(() => {
    let active = true;
    axios.get(`${API}/chat/ticket-card/${ticketNumber}`, { headers }).then(response => active && setTicket(response.data)).catch(() => {});
    return () => { active = false; };
  }, [headers, ticketNumber]);
  if (!ticket) return null;
  return (
    <div className="mt-2 max-w-lg overflow-hidden rounded-xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/[0.08] to-black/20 shadow-lg shadow-black/10">
      <Link to={`/tickets?ticket=${encodeURIComponent(ticket.ticket_number)}`} className="block p-3 transition hover:bg-cyan-500/[0.05]">
        <div className="mb-1 flex items-center gap-2"><code className="text-xs text-cyan-200">{ticket.ticket_number}</code><Badge variant="outline" className="text-[9px] capitalize">{ticket.priority}</Badge><Badge variant="outline" className="text-[9px] capitalize">{ticket.status?.replace(/_/g, " ")}</Badge></div>
        <p className="text-sm font-medium text-zinc-100">{ticket.title}</p><p className="mt-1 text-xs text-zinc-500">{ticket.client_name}{ticket.assigned_to_name ? ` · ${ticket.assigned_to_name}` : ""}</p>
      </Link>
      <div className="flex items-center gap-2 border-t border-white/5 px-3 py-2">
        <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-[11px] text-cyan-200"><Link to={`/tickets?ticket=${encodeURIComponent(ticket.ticket_number)}`}>Open ticket</Link></Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px] text-emerald-200" onClick={() => setPassOpen(true)}><ArrowRightLeft className="mr-1.5 h-3.5 w-3.5" />Pass ticket</Button>
      </div>
      <div className="px-3 pb-2"><WorkPresence kind="ticket" reference={ticket.ticket_number} presence={presence} headers={headers} /></div>
      <TicketPassDialog open={passOpen} onOpenChange={setPassOpen} ticket={ticket} headers={headers} currentUserId={currentUserId} channelId={channelId} />
    </div>
  );
}

function TicketPassDialog({ open, onOpenChange, ticket, headers, currentUserId, channelId }) {
  const [technicians, setTechnicians] = useState([]);
  const [toUserId, setToUserId] = useState("");
  const [mode, setMode] = useState("take_over");
  const [reason, setReason] = useState("");
  const [workCompleted, setWorkCompleted] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    axios.get(`${API}/users`, { headers })
      .then(response => {
        const rows = Array.isArray(response.data) ? response.data : response.data?.users || [];
        setTechnicians(rows.filter(row => row.id !== currentUserId && row.is_active !== false && row.archived !== true));
      })
      .catch(() => setTechnicians([]));
  }, [currentUserId, headers, open]);

  const submit = async () => {
    if (!toUserId || reason.trim().length < 3 || submitting) return;
    setSubmitting(true);
    try {
      const response = await axios.post(`${API}/nexus-connect/ticket-passes`, {
        ticket_ref: ticket.id || ticket.ticket_number,
        to_user_id: toUserId,
        mode,
        reason: reason.trim(),
        work_completed: workCompleted.split("\n").map(value => value.trim()).filter(Boolean),
        suggested_next_action: nextAction.trim(),
        channel_id: channelId || undefined,
      }, { headers });
      toast.success("Ticket pass sent", { description: `${response.data?.handoff?.to_user_name} must accept before ownership changes.` });
      onOpenChange(false);
      setToUserId("");
      setReason("");
      setWorkCompleted("");
      setNextAction("");
      setMode("take_over");
    } catch (requestError) {
      toast.error("Ticket pass could not be sent", { description: requestError?.response?.data?.detail || "Review the handover and try again." });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <NexusWorkflowDialog
        eyebrow="Nexus ticket pass"
        title={`Hand over ${ticket.ticket_number}`}
        description="The recipient must explicitly accept. Nexus preserves both technicians, the reason, work completed and the live assignment trail."
        icon={ArrowRightLeft}
        tone="emerald"
        className="max-w-2xl"
        contentClassName="max-h-[65vh] overflow-y-auto"
        data-testid="ticket-pass-workflow"
        footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={submit} disabled={!toUserId || reason.trim().length < 3 || submitting} className="bg-emerald-600 hover:bg-emerald-500">{submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRightLeft className="mr-2 h-4 w-4" />}Send ticket pass</Button></>}
      >
        <div className="grid gap-5 md:grid-cols-2">
          <label className="space-y-2 text-xs font-medium text-zinc-300">Receiving technician
            <select value={toUserId} onChange={event => setToUserId(event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-white/10 bg-black/25 px-3 text-sm text-zinc-100 outline-none focus:border-emerald-500/60">
              <option value="">Choose a technician</option>
              {technicians.map(technician => <option key={technician.id} value={technician.id}>{technician.name || technician.email}</option>)}
            </select>
          </label>
          <label className="space-y-2 text-xs font-medium text-zinc-300">Pass mode
            <select value={mode} onChange={event => setMode(event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-white/10 bg-black/25 px-3 text-sm text-zinc-100 outline-none focus:border-emerald-500/60">
              <option value="take_over">Take over - transfer ownership</option>
              <option value="assist">Assist - join without transfer</option>
              <option value="escalate">Escalate - higher-level ownership</option>
              <option value="consult">Consult - specialist advice</option>
              <option value="cover">Cover - temporary ownership</option>
              <option value="return">Return - send back with outcome</option>
              <option value="swarm">Swarm - collaborate as a group</option>
            </select>
          </label>
          <label className="space-y-2 text-xs font-medium text-zinc-300 md:col-span-2">Why are you passing this ticket?
            <Textarea value={reason} onChange={event => setReason(event.target.value)} placeholder="Explain why this technician is the right next owner..." className="mt-2 min-h-20 border-white/10 bg-black/25" />
          </label>
          <label className="space-y-2 text-xs font-medium text-zinc-300">Work completed
            <Textarea value={workCompleted} onChange={event => setWorkCompleted(event.target.value)} placeholder={"One completed action per line\nRestarted workstation\nCleared print queue"} className="mt-2 min-h-28 border-white/10 bg-black/25" />
          </label>
          <label className="space-y-2 text-xs font-medium text-zinc-300">Suggested next action
            <Textarea value={nextAction} onChange={event => setNextAction(event.target.value)} placeholder="Check the print server spooler and driver deployment." className="mt-2 min-h-28 border-white/10 bg-black/25" />
          </label>
        </div>
      </NexusWorkflowDialog>
    </Dialog>
  );
}

function TicketPassCard({ handoffId, headers, currentUserId }) {
  const [handoff, setHandoff] = useState(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState("");
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    axios.get(`${API}/nexus-connect/ticket-passes/${handoffId}`, { headers })
      .then(response => setHandoff(response.data))
      .catch(() => setHandoff(null))
      .finally(() => setLoading(false));
  }, [handoffId, headers]);
  useEffect(load, [load]);

  const decide = async (decision, reason = "") => {
    setProcessing(decision);
    try {
      const response = await axios.post(
        `${API}/nexus-connect/ticket-passes/${handoffId}/${decision}`,
        decision === "decline" ? { reason } : {},
        { headers },
      );
      setHandoff(response.data?.handoff || handoff);
      setDeclineOpen(false);
      setDeclineReason("");
      toast.success(decision === "accept" ? "Ticket pass accepted" : "Ticket pass declined");
    } catch (requestError) {
      toast.error("Ticket pass could not be updated", { description: requestError?.response?.data?.detail || "Refresh the live ticket state and try again." });
      load();
    } finally {
      setProcessing("");
    }
  };

  if (loading) return <div className="mt-3 flex max-w-xl items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-4 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" />Loading live ticket pass...</div>;
  if (!handoff) return null;
  const pendingForMe = handoff.status === "pending" && handoff.to_user_id === currentUserId;
  const statusTone = handoff.status === "accepted"
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
    : handoff.status === "declined" || handoff.status === "stale"
      ? "border-rose-500/25 bg-rose-500/10 text-rose-200"
      : "border-amber-500/25 bg-amber-500/10 text-amber-100";
  return (
    <div className="mt-3 max-w-xl overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-[#12231f] to-[#111923] shadow-xl shadow-black/20">
      <div className="flex items-start justify-between gap-4 border-b border-white/5 px-4 py-3">
        <div><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300"><UserRoundCheck className="h-3.5 w-3.5" />Nexus Ticket Pass</div><p className="mt-1 text-sm font-semibold text-white">{handoff.mode_label} to {handoff.to_user_name}</p></div>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${statusTone}`}>{handoff.status}</span>
      </div>
      <div className="space-y-3 px-4 py-4">
        <div><code className="text-xs text-cyan-200">{handoff.ticket?.ticket_number}</code><p className="mt-1 text-sm font-medium text-zinc-100">{handoff.ticket?.title}</p><p className="mt-1 text-xs text-zinc-500">{handoff.ticket?.client_name} · {handoff.ticket?.priority} priority · {handoff.ticket?.status?.replace(/_/g, " ")}</p></div>
        <div className="rounded-lg border border-white/5 bg-black/20 p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Reason</p><p className="mt-1 text-sm text-zinc-300">{handoff.reason}</p></div>
        {handoff.work_completed?.length > 0 && <div><p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Work completed</p><ul className="mt-1.5 space-y-1">{handoff.work_completed.map(item => <li key={item} className="flex gap-2 text-xs text-zinc-300"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />{item}</li>)}</ul></div>}
        {handoff.suggested_next_action && <div className="border-l-2 border-cyan-500/50 pl-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-cyan-400">Suggested next action</p><p className="mt-1 text-xs text-zinc-300">{handoff.suggested_next_action}</p></div>}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-white/5 bg-black/10 px-4 py-3">
        <Button asChild variant="ghost" size="sm" className="h-8 text-xs"><Link to={`/tickets?ticket=${encodeURIComponent(handoff.ticket?.ticket_number || handoff.ticket_id)}`}>View context</Link></Button>
        {handoff.status === "pending" && !pendingForMe && <span className="ml-auto text-[11px] text-amber-200">Awaiting {handoff.to_user_name}</span>}
        {pendingForMe && <><Button size="sm" className="ml-auto h-8 bg-emerald-600 text-xs hover:bg-emerald-500" disabled={Boolean(processing)} onClick={() => decide("accept")}>{processing === "accept" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}Accept</Button><Button variant="outline" size="sm" className="h-8 text-xs" disabled={Boolean(processing)} onClick={() => setDeclineOpen(true)}><XCircle className="mr-1.5 h-3.5 w-3.5" />Decline</Button></>}
      </div>
      <Dialog open={declineOpen} onOpenChange={setDeclineOpen}>
        <NexusWorkflowDialog eyebrow="Ticket handover" title="Decline ticket pass?" description={`Give ${handoff.from_user_name} enough context to choose the right next step.`} icon={XCircle} tone="amber" className="max-w-lg" data-testid="decline-ticket-pass-workflow" footer={<><Button variant="ghost" onClick={() => setDeclineOpen(false)}>Cancel</Button><Button variant="destructive" disabled={declineReason.trim().length < 3 || Boolean(processing)} onClick={() => decide("decline", declineReason.trim())}>Decline pass</Button></>}><Textarea value={declineReason} onChange={event => setDeclineReason(event.target.value)} placeholder="Why can you not accept this ticket?" className="min-h-24 border-white/10 bg-black/25" /></NexusWorkflowDialog>
      </Dialog>
    </div>
  );
}

function InvoiceCard({ invoiceNumber, headers, presence }) {
  const [invoice, setInvoice] = useState(null);
  useEffect(() => {
    let active = true;
    axios.get(`${API}/chat/invoice-card/${invoiceNumber}`, { headers }).then(response => active && setInvoice(response.data)).catch(() => {});
    return () => { active = false; };
  }, [headers, invoiceNumber]);
  if (!invoice) return null;
  return (
    <Link to={`/invoices?invoice=${encodeURIComponent(invoice.id)}`} className="mt-2 block max-w-lg rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] p-3 transition hover:border-emerald-400/50">
      <div className="mb-1 flex items-center gap-2"><code className="text-xs text-emerald-300">{invoice.invoice_number}</code><Badge variant="outline" className="text-[9px] capitalize">{invoice.payment_status}</Badge></div>
      <p className="text-sm font-medium text-zinc-200">{invoice.client_name || "Invoice"}</p><p className="mt-1 text-xs text-zinc-400">Total ${Number(invoice.total || 0).toFixed(2)} · Due ${Number(invoice.amount_due || 0).toFixed(2)}{invoice.due_date ? ` · Due ${invoice.due_date}` : ""}</p>
      <WorkPresence kind="invoice" reference={invoice.invoice_number} presence={presence} headers={headers} />
    </Link>
  );
}

function PurchaseOrderCard({ poNumber, headers }) {
  const [purchaseOrder, setPurchaseOrder] = useState(null);
  useEffect(() => {
    let active = true;
    axios.get(`${API}/chat/po-card/${poNumber}`, { headers }).then(response => active && setPurchaseOrder(response.data)).catch(() => {});
    return () => { active = false; };
  }, [headers, poNumber]);
  if (!purchaseOrder) return null;
  return <Link to={`/purchase-orders?po=${encodeURIComponent(purchaseOrder.id)}`} className="mt-2 block max-w-lg rounded-lg border border-cyan-500/20 bg-cyan-500/[0.06] p-3 transition hover:border-cyan-400/50"><div className="mb-1 flex items-center gap-2"><code className="text-xs text-cyan-300">{purchaseOrder.po_number}</code><Badge variant="outline" className="text-[9px] capitalize">{purchaseOrder.status}</Badge></div><p className="text-sm font-medium text-zinc-200">{purchaseOrder.vendor || "Purchase order"}</p><p className="mt-1 text-xs text-zinc-400">Total ${Number(purchaseOrder.total || 0).toFixed(2)}{purchaseOrder.expected_delivery ? ` · Expected ${purchaseOrder.expected_delivery}` : ""}</p></Link>;
}

function WorkPresence({ kind, reference, workItemId, presence, headers }) {
  const [events, setEvents] = useState([]);
  const workItem = `${kind}:${workItemId || reference}`;
  useEffect(() => {
    let active = true;
    axios.get(`${API}/presence/work-activity`, { params: { work_item: workItem, limit: 2 }, headers })
      .then(response => active && setEvents(response.data?.events || []))
      .catch(() => active && setEvents([]));
    return () => { active = false; };
  }, [headers, workItem]);
  const people = Object.values(presence || {}).filter(person => person.busy_state === workItem && person.led !== "offline");
  if (!people.length && !events.length) return null;
  const latest = events[0];
  return <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-white/5 pt-2"><div className="flex -space-x-1.5">{people.slice(0, 4).map(person => <TechnicianAvatar key={person.user_id} name={person.user_name} avatarUrl={person.avatar_url || person.avatar} className="h-5 w-5 border border-[#1d1f26]" fallbackClassName="text-[8px]" />)}</div>{people.length > 0 && <><p className="text-[10px] text-emerald-300">{people.length === 1 ? `${people[0].user_name} is active here` : `${people.length} technicians active here`}</p><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /></>}{latest && <p className="basis-full text-[10px] text-zinc-500">{latest.user_name || "Technician"} {latest.event === "left" ? "last left" : "opened"} {formatRelative(latest.created_at)}</p>}</div>;
}

function AttachmentCard({ attachment, headers, onDownload }) {
  return (
    <div className="mt-2 w-full max-w-md overflow-hidden rounded-lg border border-white/10 bg-black/20">
      {attachment.is_image && <ImageAttachmentPreview attachment={attachment} headers={headers} onDownload={onDownload} />}
      <button onClick={onDownload} className="flex w-full items-center gap-3 p-3 text-left hover:bg-white/[0.03] hover:text-cyan-100">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-500/15"><FileText className="h-4 w-4 text-cyan-200" /></div>
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-zinc-200">{attachment.filename}</p><p className="text-[10px] text-zinc-600">{formatBytes(attachment.size)} · Download original</p></div><Download className="h-4 w-4 text-zinc-500" />
      </button>
    </div>
  );
}

function ImageAttachmentPreview({ attachment, headers, onDownload }) {
  const [source, setSource] = useState("");
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    axios.get(`${API}/chat/files/${attachment.file_id}`, { headers, responseType: "blob" })
      .then(response => {
        objectUrl = URL.createObjectURL(response.data);
        if (active) setSource(objectUrl);
      })
      .catch(() => {});
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.file_id, headers]);
  if (!source) return null;
  return <button type="button" onClick={onDownload} title="Download original image" className="block max-h-80 w-full overflow-hidden border-b border-white/10 bg-black/30 text-left"><img src={source} alt={attachment.filename || "Shared image"} className="max-h-80 w-full object-contain" /></button>;
}

function FilesView({ files, onDownload }) {
  return (
    <div className="flex-1 overflow-y-auto p-5 md:p-8">
      <div className="mx-auto max-w-4xl"><h3 className="mb-1 text-lg font-semibold">Shared files</h3><p className="mb-5 text-sm text-zinc-500">Files shared in this conversation.</p>
        {files.length === 0 ? <EmptyContent icon={FileText} title="No shared files" body="Attachments shared in posts appear here." /> : <div className="overflow-hidden rounded-xl border border-white/5">{files.map(message => <button key={message.id} onClick={() => onDownload(message.attachment)} className="flex w-full items-center gap-3 border-b border-white/5 bg-white/[0.02] p-4 text-left last:border-0 hover:bg-white/[0.04]"><FileText className="h-5 w-5 text-cyan-300" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{message.attachment.filename}</p><p className="text-xs text-zinc-600">{message.user_name} · {formatRelative(message.ts)} · {formatBytes(message.attachment.size)}</p></div><Download className="h-4 w-4 text-zinc-500" /></button>)}</div>}
      </div>
    </div>
  );
}

function PinnedView({ messages, onOpenThread }) {
  return <div className="flex-1 overflow-y-auto p-5 md:p-8"><div className="mx-auto max-w-4xl"><h3 className="mb-1 text-lg font-semibold">Pinned posts</h3><p className="mb-5 text-sm text-zinc-500">Important updates kept for the team.</p>{messages.length === 0 ? <EmptyContent icon={Pin} title="Nothing pinned" body="Pin a post from its More actions menu." /> : <div className="space-y-3">{messages.map(message => <button key={message.id} onClick={() => onOpenThread(message)} className="block w-full rounded-xl border border-amber-500/15 bg-amber-500/[0.04] p-4 text-left hover:border-amber-500/30"><div className="mb-2 flex items-center gap-2 text-xs text-zinc-500"><Pin className="h-3.5 w-3.5 text-amber-400" />Pinned by {message.pinned_by || "a teammate"} · {formatRelative(message.pinned_at || message.ts)}</div><p className="whitespace-pre-wrap text-sm text-zinc-300">{repairDisplayText(message.body)}</p></button>)}</div>}</div></div>;
}

function SearchResults({ results, onSelect, onClose }) {
  return <div className="flex-1 overflow-y-auto p-5 md:p-8"><div className="mx-auto max-w-4xl"><div className="mb-5 flex items-center justify-between"><div><h3 className="text-lg font-semibold">Search results</h3><p className="text-sm text-zinc-500">{results.length} matching messages</p></div><Button variant="ghost" size="sm" onClick={onClose} aria-label="Close search results"><X className="h-4 w-4" /></Button></div>{results.length === 0 ? <EmptyContent icon={Search} title="No matches" body="Try a different person, ticket, or phrase." /> : <div className="space-y-2">{results.map(result => <button key={result.id} onClick={() => onSelect(result)} className="w-full rounded-xl border border-white/5 bg-white/[0.02] p-4 text-left hover:border-cyan-500/30 hover:bg-white/[0.04]"><div className="mb-2 flex items-center gap-2 text-xs text-zinc-500">{result.channel_kind === "team" ? <Hash className="h-3.5 w-3.5" /> : <MessageCircle className="h-3.5 w-3.5" />}<span>{result.channel_name}</span><span>·</span><span>{chatAuthorName(result.user_name, result.is_system)}</span><span>·</span><span>{formatRelative(result.ts)}</span></div><p className="line-clamp-3 text-sm text-zinc-300">{repairDisplayText(result.body)}</p></button>)}</div>}</div></div>;
}

function InfoPanel({ channel, users, presenceFor, currentUserId, headers, onUpdated, onClose }) {
  const memberIds = useMemo(
    () => channel.kind === "team" && !channel.is_private ? users.map(user => user.id) : channel.member_ids || [],
    [channel.is_private, channel.kind, channel.member_ids, users],
  );
  const [draftMemberIds, setDraftMemberIds] = useState(memberIds);
  const [savingMembers, setSavingMembers] = useState(false);
  const canManageMembers = channel.kind === "team" && channel.is_private && channel.created_by === currentUserId;
  useEffect(() => { setDraftMemberIds(memberIds); }, [channel.id, memberIds]);
  const addMember = userId => {
    if (userId && !draftMemberIds.includes(userId)) setDraftMemberIds(current => [...current, userId]);
  };
  const removeMember = userId => {
    if (userId !== currentUserId) setDraftMemberIds(current => current.filter(id => id !== userId));
  };
  const saveMembers = async () => {
    setSavingMembers(true);
    try {
      await axios.put(`${API}/chat/channels/${channel.id}/members`, { member_ids: draftMemberIds }, { headers });
      toast.success("Private channel members saved");
      onUpdated?.();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Members could not be updated");
    } finally {
      setSavingMembers(false);
    }
  };
  return (
    <aside className="fixed inset-y-0 right-0 z-30 flex w-full max-w-sm flex-col border-l border-white/5 bg-[#1d1f26] shadow-2xl md:static md:inset-auto" data-testid="chat-info-panel">
      <div className="flex h-16 items-center justify-between border-b border-white/5 px-4"><h3 className="font-semibold">Conversation details</h3><Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onClose} aria-label="Close conversation details"><X className="h-4 w-4" /></Button></div>
      {canManageMembers && <div className="border-b border-white/5 bg-cyan-500/[0.04] p-4"><div className="mb-2 flex items-center justify-between"><p className="text-xs font-medium text-cyan-100">Private member access</p><span className="text-[10px] text-zinc-500">Owner</span></div><div className="flex gap-2"><select value="" onChange={event => addMember(event.target.value)} className="h-9 min-w-0 flex-1 rounded-lg border border-white/10 bg-[#252832] px-2 text-xs text-zinc-300"><option value="">Add a technician…</option>{users.filter(candidate => !draftMemberIds.includes(candidate.id)).map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select><Button onClick={saveMembers} disabled={savingMembers} className="h-9 shrink-0 bg-emerald-600 px-3 text-xs hover:bg-emerald-500">{savingMembers ? "Saving" : "Save"}</Button></div><div className="mt-2 flex flex-wrap gap-1">{draftMemberIds.map(id => { const member = users.find(candidate => candidate.id === id); return member ? <span key={id} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/20 py-1 pl-2 pr-1 text-[10px] text-zinc-300">{member.name}{id !== currentUserId && <button type="button" onClick={() => removeMember(id)} className="rounded-full p-0.5 text-zinc-500 hover:bg-rose-500/15 hover:text-rose-300" title={`Remove ${member.name}`}><X className="h-3 w-3" /></button>}</span> : null; })}</div></div>}
      <ScrollArea className="flex-1"><div className="p-5 text-center"><ChannelAvatar channel={channel} presence={channel.other_user_id ? presenceFor(channel.other_user_id) : null} size="md" /><h4 className="mt-3 text-lg font-semibold">{channelDisplayName(channel)}</h4><p className="mt-1 text-xs text-zinc-500">{channel.is_private ? "Private" : "Company-wide"} · {channel.member_count || memberIds.length} members</p>{channel.description && <p className="mt-4 rounded-lg bg-white/[0.03] p-3 text-left text-sm text-zinc-400">{channel.description}</p>}</div><div className="border-t border-white/5 p-4"><p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">Members</p><div className="space-y-1">{memberIds.map(id => { const member = users.find(candidate => candidate.id === id); if (!member) return null; return <div key={id} className="flex items-center gap-3 rounded-lg p-2 hover:bg-white/[0.03]"><TechnicianAvatar name={member.name} avatarUrl={member.avatar} className="h-8 w-8" /><div className="min-w-0 flex-1 text-left"><p className="truncate text-sm">{member.name}</p><PresenceLabel status={presenceFor(id)} /></div></div>; })}</div></div></ScrollArea>
    </aside>
  );
}

function ThreadPanel({ thread, currentUserId, headers, input, onInput, onSend, onClose }) {
  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-white/5 bg-[#1d1f26] shadow-2xl md:static md:inset-auto" data-testid="thread-panel">
      <div className="flex h-16 items-center justify-between border-b border-white/5 px-4"><div><h3 className="font-semibold">Thread</h3><p className="text-xs text-zinc-600">{thread.replies.length} {thread.replies.length === 1 ? "reply" : "replies"}</p></div><Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onClose} aria-label="Close thread"><X className="h-4 w-4" /></Button></div>
      <div className="flex-1 overflow-y-auto p-3"><MessageRow message={thread.parent} own={thread.parent.user_id === currentUserId} currentUserId={currentUserId} headers={headers} compact={false} onDownload={() => {}} />{thread.replies.length > 0 && <div className="my-3 border-t border-white/5" />}{thread.replies.map(reply => <MessageRow key={reply.id} message={reply} own={reply.user_id === currentUserId} currentUserId={currentUserId} headers={headers} compact={false} onDownload={() => {}} />)}</div>
      <div className="border-t border-white/5 p-3"><div className="flex gap-2 rounded-lg border border-white/10 bg-black/20 p-2"><Input value={input} onChange={event => onInput(event.target.value)} onKeyDown={event => event.key === "Enter" && onSend()} placeholder="Reply to thread" className="h-8 border-0 bg-transparent shadow-none focus-visible:ring-0" data-testid="thread-input" /><Button size="sm" onClick={onSend} disabled={!input.trim()} className="h-8 w-8 bg-emerald-600 p-0 hover:bg-emerald-500"><Send className="h-3.5 w-3.5" /></Button></div></div>
    </aside>
  );
}

function NewConversationDialog({ open, onOpenChange, users, currentUserId, headers, onCreated }) {
  const [tab, setTab] = useState("dm");
  const [selected, setSelected] = useState([]);
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [privateChannel, setPrivateChannel] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setSelected([]); setSearch(""); setName(""); setDescription(""); setPrivateChannel(false); setTab("dm"); } }, [open]);
  const candidates = users.filter(user => user.id !== currentUserId && (!search || `${user.name} ${user.email}`.toLowerCase().includes(search.toLowerCase())));
  const toggle = id => setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  const create = async () => {
    setBusy(true);
    try {
      let response;
      if (tab === "dm") response = await axios.post(`${API}/chat/dm/${selected[0]}`, {}, { headers });
      else if (tab === "group") response = await axios.post(`${API}/chat/group-dm`, { member_ids: selected, name: name.trim() || undefined }, { headers });
      else response = await axios.post(`${API}/chat/channels`, { name, description, is_private: privateChannel, member_ids: privateChannel ? selected : [] }, { headers });
      onCreated(response.data);
      toast.success(tab === "channel" ? "Channel created" : "Conversation opened");
    } catch (requestError) {
      toast.error(requestError?.response?.data?.detail || "Conversation could not be created");
    } finally { setBusy(false); }
  };
  const invalid = tab === "dm" ? selected.length !== 1 : tab === "group" ? selected.length < 2 : name.trim().length < 2;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <NexusWorkflowDialog
        eyebrow="Audited collaboration workflow"
        title="Start collaborating"
        description="Open a private conversation, assemble an operational group, or create a governed channel with a clear purpose and access boundary."
        icon={MessageSquarePlus}
        tone="emerald"
        className="max-h-[90vh] max-w-2xl"
        contentClassName="overflow-y-auto"
        data-testid="collaboration-workflow"
        footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={create} disabled={invalid || busy} className="min-w-32 bg-emerald-600 hover:bg-emerald-500">{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{tab === "channel" ? "Create channel" : "Start chat"}</Button></>}
      >
        <Tabs value={tab} onValueChange={value => { setTab(value); setSelected([]); setName(""); }}>
          <TabsList className="grid h-11 w-full grid-cols-3 rounded-xl border border-white/5 bg-black/25 p-1"><TabsTrigger value="dm" className="rounded-lg">Direct</TabsTrigger><TabsTrigger value="group" className="rounded-lg">Group chat</TabsTrigger><TabsTrigger value="channel" className="rounded-lg">Channel</TabsTrigger></TabsList>
          <div className="mt-4 rounded-xl border border-white/5 bg-white/[0.02] p-4">
            <TabsContent value="dm" className="mt-0 space-y-3"><p className="text-xs text-zinc-500">Choose one technician. Existing conversations reopen instead of creating duplicates.</p><UserSearch value={search} onChange={setSearch} /><UserPicker candidates={candidates} selected={selected} onToggle={id => setSelected([id])} /></TabsContent>
            <TabsContent value="group" className="mt-0 space-y-3"><p className="text-xs text-zinc-500">Bring at least two technicians into a focused handover or working group.</p><Input value={name} onChange={event => setName(event.target.value.slice(0, 80))} placeholder="Group name (optional)" className="border-white/10 bg-black/20" /><UserSearch value={search} onChange={setSearch} /><UserPicker candidates={candidates} selected={selected} onToggle={toggle} /></TabsContent>
            <TabsContent value="channel" className="mt-0 space-y-3"><p className="text-xs text-zinc-500">Create a durable workspace for a service, project, incident stream, or technical discipline.</p><Input value={name} onChange={event => setName(event.target.value.replace(/\s+/g, "-").toLowerCase().slice(0, 50))} placeholder="Channel name" className="border-white/10 bg-black/20" data-testid="channel-name-new" /><Textarea value={description} onChange={event => setDescription(event.target.value.slice(0, 240))} placeholder="Purpose, scope, and what belongs in this channel" className="min-h-24 border-white/10 bg-black/20" /><label className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/5 bg-black/15 p-3 transition hover:border-cyan-500/20"><input type="checkbox" checked={privateChannel} onChange={event => setPrivateChannel(event.target.checked)} className="accent-emerald-500" /><div><p className="text-sm font-medium">Private channel</p><p className="text-xs text-zinc-500">Only selected members can discover and read this channel.</p></div></label>{privateChannel && <><UserSearch value={search} onChange={setSearch} /><UserPicker candidates={candidates} selected={selected} onToggle={toggle} /></>}</TabsContent>
          </div>
        </Tabs>
      </NexusWorkflowDialog>
    </Dialog>
  );
}

function UserSearch({ value, onChange }) {
  return <div className="relative mt-3"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" /><Input value={value} onChange={event => onChange(event.target.value)} placeholder="Find teammates" className="border-white/10 bg-black/20 pl-9" /></div>;
}

function UserPicker({ candidates, selected, onToggle }) {
  return <ScrollArea className="h-64 rounded-lg border border-white/5"><div className="p-1">{candidates.map(candidate => { const checked = selected.includes(candidate.id); return <button key={candidate.id} onClick={() => onToggle(candidate.id)} className={`flex w-full items-center gap-3 rounded-lg p-2 text-left ${checked ? "bg-cyan-500/15" : "hover:bg-white/[0.04]"}`}><TechnicianAvatar name={candidate.name} avatarUrl={candidate.avatar} className="h-9 w-9" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{candidate.name}</p><p className="truncate text-xs text-zinc-600">{candidate.email}</p></div>{checked && <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500"><Check className="h-3 w-3" /></span>}</button>; })}{candidates.length === 0 && <p className="p-8 text-center text-sm text-zinc-600">No teammates found</p>}</div></ScrollArea>;
}

function ConversationWelcome({ channel }) {
  return <div className="flex h-full min-h-[360px] flex-col items-center justify-center px-6 text-center"><ChannelAvatar channel={channel} presence={null} size="md" /><h3 className="mt-4 text-xl font-semibold">Welcome to {channelDisplayName(channel)}</h3><p className="mt-2 max-w-md text-sm text-zinc-500">{channel.description || (channel.kind === "team" ? "Share the operational context that keeps everyone aligned." : "This private conversation is ready when you are.")}</p></div>;
}

function EmptyWorkspace({ onNew }) {
  return <div className="flex flex-1 flex-col items-center justify-center p-8 text-center"><div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-emerald-500/15"><MessageCircle className="h-9 w-9 text-emerald-400" /></div><h2 className="mt-5 text-2xl font-semibold">Nexus Chat, built for the work</h2><p className="mt-2 max-w-md text-sm text-zinc-500">Keep private conversations, operational channels, files, and ticket context in one secure workspace.</p><Button onClick={onNew} className="mt-5 bg-emerald-600 hover:bg-emerald-500"><Plus className="mr-2 h-4 w-4" />Start collaborating</Button></div>;
}

function EmptyContent({ icon: Icon, title, body }) {
  return <div className="rounded-xl border border-dashed border-white/10 p-12 text-center"><Icon className="mx-auto h-8 w-8 text-zinc-700" /><h4 className="mt-3 font-medium">{title}</h4><p className="mt-1 text-sm text-zinc-600">{body}</p></div>;
}

function ConversationSkeleton() {
  return <div className="space-y-2 p-2">{[1, 2, 3, 4, 5].map(item => <div key={item} className="flex animate-pulse gap-3 p-2"><div className="h-10 w-10 rounded-full bg-white/5" /><div className="flex-1 space-y-2"><div className="h-3 w-2/3 rounded bg-white/5" /><div className="h-2.5 w-full rounded bg-white/[0.03]" /></div></div>)}</div>;
}

function DayDivider({ label }) {
  return <div className="my-5 flex items-center gap-3"><div className="h-px flex-1 bg-white/5" /><span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">{label}</span><div className="h-px flex-1 bg-white/5" /></div>;
}

function TypingIndicator({ users }) {
  return <div className="ml-12 mt-2 flex items-center gap-2 text-xs text-zinc-500"><span className="flex -space-x-1">{users.slice(0, 3).map(person => <TechnicianAvatar key={person.user_id} name={person.user_name} avatarUrl={person.avatar_url || person.avatar} className="h-6 w-6 border border-[#1d1f26]" fallbackClassName="text-[8px]" />)}</span><span className="flex gap-1 rounded-full bg-white/5 px-3 py-2"><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500" /><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:120ms]" /><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:240ms]" /></span>{users.map(person => person.user_name).join(", ")} typing</div>;
}

function ComposerButton({ icon: Icon, label, onClick }) {
  return <button type="button" onClick={onClick} title={label} aria-label={label} className="rounded-md p-2 text-zinc-500 transition hover:bg-cyan-500/10 hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"><Icon className="h-4 w-4" /></button>;
}

function SuggestionPanel({ children, title, className = "" }) {
  return <div className={`absolute left-0 z-30 mb-2 max-h-72 w-full overflow-y-auto rounded-xl border border-white/10 bg-[#252832] py-1 shadow-2xl ${className}`}><p className="border-b border-white/5 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">{title}</p>{children}</div>;
}

function avatarStyle(value) {
  return { backgroundColor: `hsl(${avatarHue(value)}, 48%, 38%)`, color: "white", fontSize: 11 };
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
