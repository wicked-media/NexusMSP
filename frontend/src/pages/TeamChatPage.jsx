import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Link, useSearchParams } from "react-router-dom";
import { API, useAuth } from "@/App";
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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import NexusWorkspaceHeader from "@/components/NexusWorkspaceHeader";
import { toast } from "sonner";
import {
  Activity,
  ArrowRightLeft,
  ArrowLeft,
  AtSign,
  Bell,
  Bold,
  Bookmark,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  Code2,
  Edit3,
  FileText,
  Image,
  Loader2,
  Lock,
  List,
  Mail,
  MessageCircle,
  MessageSquarePlus,
  MoreHorizontal,
  Paperclip,
  PanelRightOpen,
  Pin,
  Phone,
  RefreshCw,
  Search,
  Send,
  SlidersHorizontal,
  Smile,
  Sparkles,
  Quote,
  Trash2,
  UserRoundCheck,
  Users,
  Volume2,
  VolumeX,
  X,
  XCircle,
  Keyboard,
} from "lucide-react";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import {
  channelDisplayName,
  extractOperationalContext,
  filterChatChannels,
  groupChatMessages,
  isLivePresence,
  PRESENCE_META,
  totalUnread,
} from "@/lib/teamChatHelpers";
import {
  isPendingDirectChatRequest,
  normaliseDirectChatRequest,
} from "@/lib/chatConnections";
import { applyChatFormat } from "@/lib/richChatMessage";
import { notificationSummary, readFileAsBase64 } from "@/lib/teamChatFormat";
import {
  ChannelAvatar,
  CustomerConnectionPulse,
  DirectRequestDecisionForm,
  DirectRequestInbox,
  NexusOperationsPulse,
  TechnicianAvatar,
} from "@/components/teamChat/TeamChatShared";
import { MessageRow } from "@/components/teamChat/TeamChatMessages";
import {
  ComposerButton,
  ConversationWelcome,
  DayDivider,
  EmptyWorkspace,
  FilesView,
  NewConversationDialog,
  PinnedView,
  SearchResults,
  SuggestionPanel,
  ThreadPanel,
  TypingIndicator,
  JumpToLatestBar,
  NewMessagesDivider,
} from "@/components/teamChat/TeamChatPanels";
import ConversationRail from "@/components/teamChat/ConversationRail";
import ContextRail from "@/components/teamChat/ContextRail";
import ChatShortcutsDialog from "@/components/teamChat/ChatShortcutsDialog";
import { useWorkspaceLearning } from "@/hooks/useWorkspaceLearning";
import { learningHint } from "@/lib/workspaceLearning";
import {
  CHAT_ACTION,
  CHAT_VIEW,
  CHAT_WORKSPACE,
  channelLearningTarget,
  isTypingTarget,
  rankChatSurfaces,
  readRecentConversations,
  rememberRecentConversation,
  shortcutHint,
  surfaceTarget,
  unreadAnchorIndex,
  writeRecentConversations,
} from "@/components/teamChat/chatLearning";

const CHAT_SETTINGS_KEY = "nexus_chat_settings";
const DEFAULT_CHAT_SETTINGS = { density: "comfy", enterToSend: true, showTimestamps: true, showAvatars: true, accent: "emerald" };
const ACCENT_SWATCHES = [
  { value: "emerald", label: "Emerald", className: "bg-emerald-400" },
  { value: "cyan", label: "Cyan", className: "bg-cyan-400" },
  { value: "violet", label: "Violet", className: "bg-violet-400" },
  { value: "amber", label: "Amber", className: "bg-amber-400" },
];

function loadChatSettings() {
  try {
    return { ...DEFAULT_CHAT_SETTINGS, ...JSON.parse(window.localStorage.getItem(CHAT_SETTINGS_KEY) || "{}") };
  } catch {
    return { ...DEFAULT_CHAT_SETTINGS };
  }
}

const EMOJI_GROUPS = [
  { label: "Frequently used", emojis: ["👍", "❤️", "😂", "🎉", "🔥", "🚀", "✅", "💯", "👏", "👀"] },
  { label: "People", emojis: ["😀", "😁", "😂", "🥹", "😍", "😎", "🤔", "🙌", "👏", "🙏", "💪", "👋"] },
  { label: "Work", emojis: ["✅", "❗", "⚠️", "🔒", "🛠️", "💻", "📎", "📌", "📣", "🟢", "🔴", "⏳"] },
  { label: "Objects", emojis: ["🚀", "💡", "🎯", "📈", "🧠", "🔍", "🧩", "☕", "🎉", "✨", "💬", "🤝"] },
];
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

/**
 * The declared chat surfaces.
 *
 * Chat remembers which section, rail tab and quick action a technician actually
 * opens and ranks these with that evidence (`chatLearning.js`). The order here is
 * the designed order, so a first-time technician sees exactly what was authored —
 * and nothing is ever removed, only reordered.
 */
const CHAT_SECTIONS = [
  { value: "activity", label: "Inbox", icon: Activity, badge: "unread" },
  { value: "chat", label: "Direct", icon: MessageCircle },
  { value: "customer", label: "Clients", icon: Building2, badge: "requests" },
  { value: "teams", label: "Channels", icon: Users },
  { value: "work", label: "Work rooms", icon: FileText },
];
const CHAT_TABS = [
  { value: "posts", label: "Messages", icon: MessageCircle, count: "messages" },
  { value: "files", label: "Files", icon: FileText, count: "files" },
  { value: "pins", label: "Pinned", icon: Pin, count: "pinned" },
];
const CHAT_WORK_ACTIONS = [
  { id: "link_ticket", label: "Link ticket", icon: FileText, command: "/ticket " },
  { id: "link_invoice", label: "Link invoice", icon: FileText, command: "/invoice " },
  { id: "link_purchase_order", label: "Link purchase order", icon: FileText, command: "/po " },
  { id: "add_internal_note", label: "Add internal note", icon: Edit3, command: "/note " },
  { id: "page_on_call", label: "Page on-call", icon: Bell, command: "/page ", destructive: true },
];
const CHAT_EMPTY_STATES = {
  activity: { title: "You are all caught up", body: "New mentions and unread conversations appear here. Nexus never invents activity to fill this space." },
  chat: { title: "No direct conversations yet", body: "Start a private chat with a technician. Existing conversations reopen instead of duplicating." },
  saved: { title: "Nothing saved yet", body: "Save a conversation from its options menu to keep the ones you return to at hand." },
  customer: { title: "No customer conversations", body: "Approved customer conversations appear here after a technician reviews the request." },
  teams: { title: "No channels match", body: "Create a channel for a service, project or incident stream, or clear the filter." },
  work: { title: "No work rooms yet", body: "A Ticket Pass creates a secure room around the work, with the handover attached." },
};

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
  const [messageSearchQuery, setMessageSearchQuery] = useState("");
  const [messageSearchScope, setMessageSearchScope] = useState("all");
  const [searchResults, setSearchResults] = useState(null);
  const [showMessageSearch, setShowMessageSearch] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [channelLoading, setChannelLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [archivedChannels, setArchivedChannels] = useState([]);
  const [loadingArchived, setLoadingArchived] = useState(false);
  const [thread, setThread] = useState(null);
  const [threadInput, setThreadInput] = useState("");
  const [emojiTarget, setEmojiTarget] = useState(null);
  const [chatSettings, setChatSettings] = useState(loadChatSettings);
  const [chatSettingsOpen, setChatSettingsOpen] = useState(false);
  useEffect(() => {
    try { window.localStorage.setItem(CHAT_SETTINGS_KEY, JSON.stringify(chatSettings)); } catch { /* Cosmetic preference only. */ }
  }, [chatSettings]);
  const [composerEmojiOpen, setComposerEmojiOpen] = useState(false);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const [gifQuery, setGifQuery] = useState("");
  const [gifResults, setGifResults] = useState([]);
  const [gifState, setGifState] = useState("idle");
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState("");
  const [channelEditorOpen, setChannelEditorOpen] = useState(false);
  const [channelNameDraft, setChannelNameDraft] = useState("");
  const [channelDescriptionDraft, setChannelDescriptionDraft] = useState("");
  const [savingChannelDetails, setSavingChannelDetails] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [referenceMatches, setReferenceMatches] = useState([]);
  const [referenceIndex, setReferenceIndex] = useState(0);
  const [mobileConversationOpen, setMobileConversationOpen] = useState(false);
  const [directRequests, setDirectRequests] = useState([]);
  const [directRequestSummary, setDirectRequestSummary] = useState({});
  const [directRequestState, setDirectRequestState] = useState("loading");
  const [directRequestError, setDirectRequestError] = useState("");
  const [directRequestDialog, setDirectRequestDialog] = useState(null);
  const [directRequestResponse, setDirectRequestResponse] = useState("");
  const [directRequestDecision, setDirectRequestDecision] = useState("");
  const scrollRef = useRef(null);
  const activeIdRef = useRef(null);
  const nearBottomRef = useRef(true);
  const typingAtRef = useRef(0);
  const fileRef = useRef(null);
  const gifRef = useRef(null);
  const composerRef = useRef(null);
  const openedThreadRef = useRef("");
  const manuallyUnreadChannelIdsRef = useRef(new Set());

  // What chat has learned about this technician's use of this workspace. The
  // memory is presentation only: it can reorder a section, tab or quick action,
  // never reveal a conversation or grant access. With no evidence the workspace
  // keeps its declared order and claims nothing.
  const chatLearning = useWorkspaceLearning(token, CHAT_WORKSPACE);
  const recordChatSignal = chatLearning.record;
  const [recentConversations, setRecentConversations] = useState(() => readRecentConversations(window.localStorage));
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [highlightMessageId, setHighlightMessageId] = useState("");
  const [unreadAnchorCount, setUnreadAnchorCount] = useState(0);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const channelsRef = useRef([]);
  const highlightTimerRef = useRef(0);

  const activeChannel = channels.find(channel => channel.id === activeId);
  const presenceFor = userId => presence[userId]?.led || "offline";
  const myPresence = presenceFor(user?.id);
  const canEditActiveChannel = activeChannel?.kind === "team" && (
    activeChannel.created_by === user?.id
    || user?.is_admin
    || ["admin", "owner"].includes(String(user?.role || "").toLowerCase())
  );
  const canRenameActiveChannel = canEditActiveChannel;

  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => { channelsRef.current = channels; }, [channels]);
  useEffect(() => { writeRecentConversations(window.localStorage, recentConversations); }, [recentConversations]);
  useEffect(() => () => window.clearTimeout(highlightTimerRef.current), []);

  // Opening a section or a rail tab is what the workspace learns from. Neither
  // signal can change access: they only decide the order of a list.
  useEffect(() => {
    const target = surfaceTarget(`section_${mode}`);
    if (target) recordChatSignal(CHAT_VIEW, target);
  }, [mode, recordChatSignal]);
  useEffect(() => {
    const target = activeId ? surfaceTarget(`tab_${activeTab}`) : "";
    if (target) recordChatSignal(CHAT_VIEW, target);
  }, [activeId, activeTab, recordChatSignal]);

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

  const loadDirectRequests = useCallback(async ({ quiet = false } = {}) => {
    if (!token) return;
    if (!quiet) setDirectRequestState("loading");
    try {
      const response = await axios.get(`${API}/chat-connections/requests`, { headers });
      const payload = response.data || {};
      const rows = Array.isArray(payload) ? payload : payload.requests || [];
      setDirectRequests(rows.map(normaliseDirectChatRequest).filter(request => request.id));
      setDirectRequestSummary(Array.isArray(payload) ? {} : payload.summary || {});
      setDirectRequestError("");
      setDirectRequestState("ready");
    } catch (requestError) {
      const status = requestError?.response?.status;
      if (status === 404 || status === 501) {
        setDirectRequestState("unavailable");
        setDirectRequestError("");
        return;
      }
      setDirectRequestState("error");
      setDirectRequestError(requestError?.response?.data?.detail || "Direct requests could not be refreshed.");
    }
  }, [headers, token]);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    loadDirectRequests();
    const timer = setInterval(() => loadDirectRequests({ quiet: true }), 15_000);
    return () => clearInterval(timer);
  }, [loadDirectRequests]);

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
      if (!manuallyUnreadChannelIdsRef.current.has(channelId)) {
        axios.post(`${API}/chat/channels/${channelId}/read`, {}, { headers }).catch(() => {});
      }
    } catch (requestError) {
      if (activeIdRef.current === channelId) setError(requestError?.response?.data?.detail || "This conversation could not be refreshed.");
    } finally {
      if (!quiet && activeIdRef.current === channelId) setChannelLoading(false);
    }
  }, [headers]);

  const refreshTyping = useCallback(async channelId => {
    if (!channelId || channelId !== activeIdRef.current) return;
    try {
      const response = await axios.get(`${API}/chat/channels/${channelId}/typing`, { headers });
      if (channelId === activeIdRef.current) setTypingUsers(response.data || []);
    } catch { /* Typing is ephemeral; preserve the last known state until the next update. */ }
  }, [headers]);

  useEffect(() => {
    setMessages([]);
    setPinned([]);
    setFiles([]);
    setThread(null);
    setChannelEditorOpen(false);
    setActiveTab("posts");
    setHighlightMessageId("");
    nearBottomRef.current = true;
    setShowJumpToLatest(false);
    if (!activeId) return undefined;
    // Read the unread count before the channel is marked read, so the "new
    // messages" marker is derived from the conversation's own evidence rather
    // than guessed after the fact.
    setUnreadAnchorCount(Number(channelsRef.current.find(channel => channel.id === activeId)?.unread_count || 0));
    refreshChannel();
  }, [activeId, refreshChannel]);

  useEffect(() => {
    if (!token) return undefined;
    const controller = new AbortController();
    let reconnectTimer;
    let fallbackTimer;

    const refreshFromEvent = event => {
      if (event?.type !== "chat.channel.updated") return;
      if (event.kind === "typing.updated") {
        refreshTyping(event.channel_id);
        return;
      }
      loadWorkspace({ quiet: true });
      if (event.channel_id === activeIdRef.current) refreshChannel({ quiet: true });
    };

    const connect = async () => {
      try {
        const response = await fetch(`${API}/chat/events/stream`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
          signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error("Chat live updates are unavailable");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!controller.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() || "";
          frames.forEach(frame => {
            const data = frame.split("\n").find(line => line.startsWith("data:"));
            if (!data) return;
            try { refreshFromEvent(JSON.parse(data.slice(5).trim() || "{}")); } catch { /* ignore malformed transient frames */ }
          });
        }
      } catch (streamError) {
        if (streamError?.name !== "AbortError") reconnectTimer = window.setTimeout(connect, 1_500);
      }
    };

    connect();
    // A quiet recovery pass covers a server restart or a missed ephemeral
    // invalidation without returning to the old high-frequency polling model.
    fallbackTimer = window.setInterval(() => {
      loadWorkspace({ quiet: true });
      if (activeIdRef.current) refreshChannel({ quiet: true });
    }, 45_000);
    return () => {
      controller.abort();
      window.clearTimeout(reconnectTimer);
      window.clearInterval(fallbackTimer);
    };
  }, [loadWorkspace, refreshChannel, refreshTyping, token]);

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

  // The unread marker comes from the count captured when the conversation was
  // opened, applied to the messages actually loaded. When the two cannot be
  // reconciled there is no marker, rather than a marker in the wrong place.
  const unreadAnchorId = useMemo(() => {
    const index = unreadAnchorIndex(messages, unreadAnchorCount);
    return index >= 0 ? messages[index]?.id || "" : "";
  }, [messages, unreadAnchorCount]);

  const scrollToLatest = () => {
    nearBottomRef.current = true;
    setShowJumpToLatest(false);
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  };

  const recordWorkAction = action => {
    const target = surfaceTarget(action.id);
    if (target) recordChatSignal(CHAT_ACTION, target);
  };

  const selectChannel = channelId => {
    manuallyUnreadChannelIdsRef.current.delete(channelId);
    const opened = channels.find(channel => channel.id === channelId);
    const target = channelLearningTarget(opened);
    if (target) recordChatSignal(CHAT_VIEW, target);
    setRecentConversations(current => rememberRecentConversation(current, {
      id: channelId,
      name: opened ? channelDisplayName(opened) : "",
      kind: opened?.kind || "team",
      at: new Date().toISOString(),
    }));
    setActiveId(channelId);
    setSearchParams({ channel: channelId }, { replace: true });
    setSearchResults(null);
    setQuery("");
    setMobileConversationOpen(true);
    setShowInfo(false);
  };

  const markConversationUnread = async () => {
    if (!activeChannel) return;
    try {
      const response = await axios.post(`${API}/chat/channels/${activeChannel.id}/mark-unread`, {}, { headers });
      if (!response.data?.ok) {
        toast.message("There are no received messages to return to your inbox.");
        return;
      }
      manuallyUnreadChannelIdsRef.current.add(activeChannel.id);
      setChannels(current => current.map(channel => channel.id === activeChannel.id ? { ...channel, unread_count: Math.max(1, Number(channel.unread_count || 0)) } : channel));
      setMode("activity");
      toast.success("Conversation returned to your inbox.");
    } catch (requestError) {
      toast.error(requestError?.response?.data?.detail || "Conversation could not be marked unread.");
    }
  };

  const updateConversationPreference = async (field, value) => {
    if (!activeChannel) return;
    const previous = activeChannel;
    const patch = field === "notify_level"
      ? { notify_level: value, is_muted: value === "none", mute_until: null }
      : field === "mute_until"
        ? { mute_until: value, is_muted: Boolean(value) }
        : field === "is_muted" && !value
          ? { is_muted: false, mute_until: null, notify_level: "mentions" }
          : { [field]: value };
    setChannels(current => current.map(channel => channel.id === activeChannel.id ? { ...channel, ...patch } : channel));
    try {
      await axios.put(`${API}/chat/channels/${activeChannel.id}/preference`, patch, { headers });
    } catch (requestError) {
      setChannels(current => current.map(channel => channel.id === activeChannel.id ? { ...channel, ...previous } : channel));
      toast.error(requestError?.response?.data?.detail || "Conversation preference could not be saved.");
    }
  };

  const openArchivedChannels = async () => {
    setShowArchived(true);
    setLoadingArchived(true);
    try {
      const response = await axios.get(`${API}/chat/channels/archived`, { headers });
      setArchivedChannels(response.data || []);
    } catch (requestError) {
      toast.error(requestError?.response?.data?.detail || "Archived channels could not be loaded.");
    } finally {
      setLoadingArchived(false);
    }
  };

  const restoreChannel = async channel => {
    try {
      await axios.post(`${API}/chat/channels/${channel.id}/restore`, {}, { headers });
      setArchivedChannels(current => current.filter(item => item.id !== channel.id));
      await loadWorkspace({ quiet: true });
      selectChannel(channel.id);
      setShowArchived(false);
      toast.success("Channel restored.");
    } catch (requestError) {
      toast.error(requestError?.response?.data?.detail || "Channel could not be restored.");
    }
  };

  const beginChannelEdit = () => {
    if (!activeChannel || !canEditActiveChannel) return;
    setChannelNameDraft(activeChannel.name || "");
    setChannelDescriptionDraft(activeChannel.description || "");
    setChannelEditorOpen(true);
  };

  const saveChannelDetails = async () => {
    if (!activeChannel || !canEditActiveChannel || savingChannelDetails) return;
    setSavingChannelDetails(true);
    try {
      const payload = { description: channelDescriptionDraft };
      if (canRenameActiveChannel) payload.name = channelNameDraft;
      const response = await axios.patch(`${API}/chat/channels/${activeChannel.id}`, payload, { headers });
      const updated = response.data;
      setChannels(current => current.map(channel => channel.id === activeChannel.id ? { ...channel, ...updated } : channel));
      setChannelEditorOpen(false);
      toast.success("Channel details updated.");
      loadWorkspace({ quiet: true });
    } catch (requestError) {
      toast.error(requestError?.response?.data?.detail || "Channel details could not be saved.");
    } finally {
      setSavingChannelDetails(false);
    }
  };

  const openDirectRequestDialog = request => {
    setDirectRequestDialog(normaliseDirectChatRequest(request));
    setDirectRequestResponse("");
  };

  const decideDirectRequest = async decision => {
    if (!directRequestDialog || directRequestDecision) return;
    const responseText = directRequestResponse.trim();
    if (decision === "decline" && responseText.length < 3) {
      toast.error("Add a short, respectful reason before declining.");
      return;
    }
    setDirectRequestDecision(decision);
    try {
      const response = await axios.post(
        `${API}/chat-connections/requests/${encodeURIComponent(directRequestDialog.id)}/decision`,
        { decision, response: responseText || undefined },
        { headers },
      );
      const result = response.data || {};
      const nextRequest = normaliseDirectChatRequest(result.request || {
        ...directRequestDialog,
        status: decision === "accept" ? "accepted" : "declined",
      });
      setDirectRequests(current => current.map(request => request.id === directRequestDialog.id ? nextRequest : request));
      setDirectRequestDialog(null);
      setDirectRequestResponse("");
      if (decision === "decline") {
        toast.success("Request declined and recorded.");
        return;
      }

      const channel = result.channel || result.conversation;
      const channelId = result.channel_id || channel?.id;
      if (channel?.id) {
        setChannels(current => [channel, ...current.filter(existing => existing.id !== channel.id)]);
      }
      await Promise.all([loadWorkspace({ quiet: true }), loadDirectRequests({ quiet: true })]);
      setMode("customer");
      if (channelId) {
        selectChannel(channelId);
        toast.success("Private customer conversation approved.");
      } else {
        toast.success("Request approved. The private conversation is being prepared.");
      }
    } catch (requestError) {
      toast.error(requestError?.response?.data?.detail || "The request could not be updated.");
    } finally {
      setDirectRequestDecision("");
    }
  };

  const sendTyping = () => {
    if (!activeId || Date.now() - typingAtRef.current < 2000) return;
    typingAtRef.current = Date.now();
    axios.post(`${API}/chat/channels/${activeId}/typing`, {}, { headers }).catch(() => {});
  };

  const insertComposerFormat = format => {
    const composer = composerRef.current;
    const result = applyChatFormat(input, composer?.selectionStart, composer?.selectionEnd, format);
    setInput(result.value);
    window.requestAnimationFrame(() => {
      composerRef.current?.focus();
      composerRef.current?.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
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
    const term = messageSearchQuery.trim();
    if (!term) { setSearchResults(null); return; }
    setSearching(true);
    try {
      const response = await axios.get(`${API}/chat/search`, { headers, params: { q: term, ...(messageSearchScope === "channel" && activeId ? { channel_id: activeId } : {}) } });
      setSearchResults(response.data || []);
      setShowMessageSearch(false);
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
      setThread(current => current && ({ ...current, parent: current.parent.id === messageId ? { ...current.parent, reactions: response.data.reactions } : current.parent, replies: current.replies.map(reply => reply.id === messageId ? { ...reply, reactions: response.data.reactions } : reply) }));
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
      if (thread?.parent?.id) openThread({ id: thread.parent.id });
    } catch {
      toast.error("Message could not be edited");
    }
  };

  const deleteMessage = async messageId => {
    if (!window.confirm("Unsend this message? A deletion notice remains in the conversation.")) return;
    try {
      await axios.delete(`${API}/chat/messages/${messageId}`, { headers });
      refreshChannel({ quiet: true });
      if (thread?.parent?.id) openThread({ id: thread.parent.id });
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

  const jumpToUnread = () => {
    const nextUnread = channels.find(channel => channel.id !== activeId && Number(channel.unread_count || 0) > 0);
    if (!nextUnread) {
      toast.message("You are all caught up.");
      return;
    }
    selectChannel(nextUnread.id);
    toast.message(`Opened unread conversation: ${channelDisplayName(nextUnread)}.`);
  };

  /** Move through the visible list from the keyboard, opening as it goes. */
  const stepConversation = direction => {
    if (visibleChannels.length === 0) return;
    const index = visibleChannels.findIndex(channel => channel.id === activeId);
    const next = visibleChannels[(index === -1 ? 0 : index + direction + visibleChannels.length) % visibleChannels.length];
    if (!next || next.id === activeId) return;
    selectChannel(next.id);
  };

  // The keyboard contract below is installed once. It reads the newest handlers
  // through a ref, so moving through conversations does not tear down and re-add
  // the window listener on every render.
  const shortcutHandlers = useRef({ jumpToUnread, stepConversation });
  useEffect(() => {
    shortcutHandlers.current = { jumpToUnread, stepConversation };
  });

  const rankedSections = useMemo(
    () => rankChatSurfaces(CHAT_SECTIONS, { surface: CHAT_VIEW, learning: chatLearning, idOf: section => surfaceTarget(`section_${section.value}`) }),
    [chatLearning],
  );
  const rankedTabs = useMemo(
    () => rankChatSurfaces(CHAT_TABS, { surface: CHAT_VIEW, learning: chatLearning, idOf: tab => surfaceTarget(`tab_${tab.value}`) }),
    [chatLearning],
  );
  const rankedWorkActions = useMemo(
    () => rankChatSurfaces(CHAT_WORK_ACTIONS, { surface: CHAT_ACTION, learning: chatLearning, idOf: action => surfaceTarget(action.id) }),
    [chatLearning],
  );
  const chatLearningHint = learningHint({ surface: CHAT_VIEW, personal: chatLearning.personal, team: chatLearning.team });

  const forgetChatLearning = async () => {
    try {
      const removed = await chatLearning.forget();
      setRecentConversations([]);
      writeRecentConversations(window.localStorage, []);
      toast.success(`${removed || 0} learned chat signal${removed === 1 ? "" : "s"} forgotten`, {
        description: "Sections, rail tabs and quick actions are back to the Nexus default order, and the reopen list on this device was cleared.",
      });
    } catch {
      toast.error("Nexus could not forget the learned chat ordering. Nothing has been changed.");
    }
  };

  const focusMessage = messageId => {
    if (!messageId) return;
    setHighlightMessageId(messageId);
    window.clearTimeout(highlightTimerRef.current);
    window.requestAnimationFrame(() => {
      scrollRef.current?.querySelector(`[data-message-id="${messageId}"]`)?.scrollIntoView({ block: "center" });
    });
    highlightTimerRef.current = window.setTimeout(() => setHighlightMessageId(""), 2600);
  };

  // One keyboard contract for the workspace. Anything typed into a field belongs
  // to the field, so single-key shortcuts are ignored there rather than stealing
  // a technician's input.
  useEffect(() => {
    const onKeyDown = event => {
      if (isTypingTarget(event.target)) {
        if (event.key === "Escape") event.target?.blur?.();
        return;
      }
      const modified = event.metaKey || event.ctrlKey;
      if (modified && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setShowMessageSearch(true);
        return;
      }
      if (event.altKey && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        shortcutHandlers.current.stepConversation(event.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (event.altKey && event.key.toLowerCase() === "u") {
        event.preventDefault();
        shortcutHandlers.current.jumpToUnread();
        return;
      }
      if (event.key === "/") {
        event.preventDefault();
        composerRef.current?.focus();
        return;
      }
      if (event.key === "?") {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if (event.key === "Escape") {
        if (thread) { setThread(null); return; }
        if (showInfo) setShowInfo(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showInfo, thread]);

  const deleteChannel = async () => {
    if (!activeChannel) return;
    if (!window.confirm(`Archive #${channelDisplayName(activeChannel)}? Posts stay preserved and an owner or admin can restore it.`)) return;
    try {
      await axios.delete(`${API}/chat/channels/${activeChannel.id}`, { headers });
      setShowInfo(false);
      setActiveId(null);
      setMode("teams");
      await loadWorkspace({ quiet: true });
      toast.success("Channel archived");
    } catch (requestError) {
      toast.error(requestError?.response?.data?.detail || "Channel could not be deleted");
    }
  };

  const loadGifs = async query => {
    setGifState("loading");
    try {
      const response = await axios.get(`${API}/chat/gifs`, { headers, params: query ? { q: query } : {} });
      setGifResults(response.data?.results || []);
      setGifState("ready");
    } catch (requestError) {
      setGifResults([]);
      setGifState(requestError?.response?.status === 503 ? "unconfigured" : "error");
    }
  };

  const shareGif = async gif => {
    if (!activeId) return;
    try {
      await axios.post(`${API}/chat/channels/${activeId}/gifs`, gif, { headers });
      setGifPickerOpen(false);
      toast.success("GIF shared");
      refreshChannel({ quiet: true });
    } catch (requestError) {
      toast.error(requestError?.response?.data?.detail || "GIF could not be shared");
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
  const pendingDirectRequests = useMemo(
    () => directRequests.filter(isPendingDirectChatRequest),
    [directRequests],
  );
  const directSubscriberValue = directRequestSummary?.subscriber_count ?? directRequestSummary?.subscribers ?? 0;
  const directSubscriberCount = Array.isArray(directSubscriberValue) ? directSubscriberValue.length : Number(directSubscriberValue) || 0;
  const activePresence = activeChannel?.other_user_id ? presenceFor(activeChannel.other_user_id) : null;
  const activeTeammates = users.filter(candidate => candidate.id !== user?.id && isLivePresence(presenceFor(candidate.id))).length;
  const activePeople = activeTeammates + (isLivePresence(myPresence) ? 1 : 0);
  const operationalContext = useMemo(() => extractOperationalContext(messages), [messages]);
  const draftOperationalCommand = command => {
    setInput(current => current.trim() ? `${current}\n${command}` : command);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3" data-testid="team-chat-page">
        <NexusWorkspaceHeader
          eyebrow="Service desk"
          title="Chat"
          description="Secure team conversations, customer handovers, and operational context."
          icon={MessageCircle}
          tone="emerald"
          signal={activePeople > 0 ? "working" : "neutral"}
          signalLabel={`${activePeople} active now`}
          signalDescription="Presence is refreshed while this workspace is open."
          actionsLabel="Chat controls"
          actionsDescription="Find, refresh, or start a conversation."
          showBack={false}
          actions={<>
            <Button variant="outline" size="sm" onClick={() => setShowMessageSearch(true)} aria-label="Search messages"><Search className="mr-1.5 h-3.5 w-3.5" />Search</Button>
            <Button variant="outline" size="sm" onClick={() => { loadWorkspace({ quiet: true }); refreshChannel({ quiet: true }); }} disabled={loading || channelLoading} data-testid="refresh-team-chat-btn"><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${(loading || channelLoading) ? "animate-spin" : ""}`} />Refresh</Button>
            <Button size="sm" onClick={() => setShowNewDialog(true)} data-testid="new-chat-btn"><MessageSquarePlus className="mr-1.5 h-3.5 w-3.5" />New conversation</Button>
          </>}
        />

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0d141b] text-zinc-100 shadow-[0_24px_70px_-40px_rgba(0,0,0,0.95)]">
      <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* The conversation rail owns the section strip, the filter, the list and the
          presence footer. On a narrow viewport it yields to the open conversation
          and comes back from the header's back button. */}
      <div className={`${mobileConversationOpen ? "hidden md:flex" : "flex"} min-h-0 shrink-0`}>
        <ConversationRail
          modes={rankedSections.map(section => ({
            value: section.value,
            label: section.label,
            icon: section.icon,
            badge: section.badge === "unread" ? unread : section.badge === "requests" ? pendingDirectRequests.length : 0,
          }))}
          mode={mode}
          onMode={value => { setMode(value); setSearchResults(null); }}
          title={mode === "activity" ? "Inbox" : mode === "saved" ? "Saved" : mode === "teams" ? "Channels" : mode === "work" ? "Work rooms" : mode === "customer" ? "Client conversations" : "Direct chats"}
          subtitle={query ? `${visibleChannels.length} matching “${query}”` : `${unread} unread · ${activePeople} active now`}
          query={query}
          onQuery={setQuery}
          searching={searching}
          onClearSearch={() => { setQuery(""); setSearchResults(null); }}
          onNew={() => setShowNewDialog(true)}
          tools={(
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-9 w-9 rounded-lg p-0 text-zinc-400 hover:bg-white/[0.08] hover:text-white" data-testid="collaboration-workspace-tools" aria-label="Chat workspace tools">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem asChild><Link to="/live-chat"><MessageCircle className="mr-2 h-4 w-4" />Client live chat</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link to="/script-ticket"><FileText className="mr-2 h-4 w-4" />Ticket automations</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link to="/voice"><Phone className="mr-2 h-4 w-4" />Voice services</Link></DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={openArchivedChannels}><RefreshCw className="mr-2 h-4 w-4" />Archived channels</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          savedActive={mode === "saved"}
          onToggleSaved={() => setMode(mode === "saved" ? "teams" : "saved")}
          error={error}
          onRetry={() => loadWorkspace()}
          loading={loading}
          channels={visibleChannels}
          activeId={activeId}
          onSelect={selectChannel}
          presenceFor={presenceFor}
          recentChannels={recentConversations.filter(entry => channels.some(channel => channel.id === entry.id))}
          onSelectRecent={id => (channels.some(channel => channel.id === id) ? selectChannel(id) : toast.message("That conversation is no longer available."))}
          learningHint={chatLearningHint}
          onForgetLearning={forgetChatLearning}
          empty={CHAT_EMPTY_STATES[mode] || CHAT_EMPTY_STATES.teams}
          currentUser={user}
          myPresence={myPresence}
          presenceDetail={workItemLabel(presence[user?.id]?.busy_state)}
          onStatusChange={updateStatus}
        />
      </div>

      <main className={`${mobileConversationOpen ? "flex" : "hidden md:flex"} min-h-0 min-w-0 flex-1 flex-col bg-[#0d141b]`}>
        {mode === "customer" && (
          <div className="border-b border-cyan-500/15 bg-[#101922] p-3 md:px-5" data-testid="customer-request-region">
            <div className="mx-auto max-w-4xl">
              <DirectRequestInbox
                requests={pendingDirectRequests}
                state={directRequestState}
                error={directRequestError}
                subscriberCount={directSubscriberCount}
                onRetry={() => loadDirectRequests()}
                onReview={openDirectRequestDialog}
              />
            </div>
          </div>
        )}
        {!activeChannel ? (
          <EmptyWorkspace onNew={() => setShowNewDialog(true)} />
        ) : (
          <>
            <header className="border-b border-white/[0.07] bg-[#101922] px-3 md:px-5">
              <div className={`flex items-center gap-3 ${channelEditorOpen ? "min-h-16 py-3" : "h-16"}`}>
                <Button variant="ghost" size="sm" className="h-9 w-9 p-0 md:hidden" onClick={() => setMobileConversationOpen(false)} aria-label="Back to conversations"><ArrowLeft className="h-4 w-4" /></Button>
                <ChannelAvatar channel={activeChannel} presence={activePresence} size="md" />
                {channelEditorOpen ? (
                  <div className="min-w-0 flex-1 space-y-2">
                    {canRenameActiveChannel ? (
                      <Input value={channelNameDraft} onChange={event => setChannelNameDraft(event.target.value)} maxLength={50} aria-label="Channel name" className="h-9 max-w-sm border-white/10 bg-black/20 text-sm font-semibold" />
                    ) : (
                      <p className="text-sm font-semibold text-zinc-100">{channelDisplayName(activeChannel)}</p>
                    )}
                    <div className="flex flex-wrap items-end gap-2">
                      <Textarea value={channelDescriptionDraft} onChange={event => setChannelDescriptionDraft(event.target.value)} maxLength={240} aria-label="Channel purpose" placeholder="What is this channel for?" className="min-h-9 max-w-xl resize-none border-white/10 bg-black/20 py-2 text-xs" />
                      <Button size="sm" className="h-9 bg-cyan-600 text-xs hover:bg-cyan-500" onClick={saveChannelDetails} disabled={savingChannelDetails}>{savingChannelDetails ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}Save</Button>
                      <Button variant="ghost" size="sm" className="h-9 text-xs text-zinc-400 hover:text-white" onClick={() => setChannelEditorOpen(false)} disabled={savingChannelDetails}>Cancel</Button>
                    </div>
                  </div>
                ) : canEditActiveChannel ? (
                  <button type="button" onClick={beginChannelEdit} className="group min-w-0 flex-1 rounded-md py-1 text-left outline-none transition hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-cyan-400/60" aria-label="Edit channel name and purpose">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate text-base font-semibold">{channelDisplayName(activeChannel)}</h2>
                      {activeChannel.is_private && <Lock className="h-3.5 w-3.5 text-zinc-500" />}
                      <Edit3 className="h-3.5 w-3.5 text-zinc-600 opacity-0 transition group-hover:opacity-100" />
                    </div>
                    <p className="truncate text-xs text-zinc-500">{activeChannel.description || `${activeChannel.member_count || 0} members`}</p>
                  </button>
                ) : (
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate text-base font-semibold">{channelDisplayName(activeChannel)}</h2>
                      {activeChannel.is_private && <Lock className="h-3.5 w-3.5 text-zinc-500" />}
                    </div>
                    <p className="truncate text-xs text-zinc-500">
                      {activeChannel.kind === "dm"
                        ? PRESENCE_META[activePresence || "offline"].label
                        : activeChannel.kind === "client_direct"
                          ? activeChannel.client_name || activeChannel.description || "Approved customer connection"
                          : activeChannel.description || `${activeChannel.member_count || 0} members`}
                    </p>
                  </div>
                )}
                {typingUsers.length > 0 && <span className="hidden text-xs text-cyan-200 lg:block">{typingUsers.map(row => row.user_name).join(", ")} typing…</span>}
                <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-zinc-400 hover:text-white" onClick={() => setShortcutsOpen(true)} aria-label="Keyboard shortcuts" title={`Keyboard shortcuts — ${shortcutHint()}`} data-testid="chat-shortcuts-btn"><Keyboard className="h-4 w-4" /></Button>
                <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-zinc-400 hover:text-white" onClick={() => setChatSettingsOpen(true)} aria-label="Chat settings" title="Chat settings" data-testid="chat-settings-btn"><SlidersHorizontal className="h-4 w-4" /></Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-zinc-400 hover:text-white" aria-label="Conversation options"><MoreHorizontal className="h-4 w-4" /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel>Conversation</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => updateConversationPreference("is_saved", !activeChannel.is_saved)}>
                      <Bookmark className="mr-2 h-4 w-4" />{activeChannel.is_saved ? "Remove from saved" : "Save conversation"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => updateConversationPreference("is_muted", !activeChannel.is_muted)}>
                      {activeChannel.is_muted ? <Volume2 className="mr-2 h-4 w-4" /> : <VolumeX className="mr-2 h-4 w-4" />}{activeChannel.is_muted ? "Turn notifications on" : "Mute notifications"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => updateConversationPreference("notify_level", "mentions")}><AtSign className="mr-2 h-4 w-4" />Notify for mentions only{activeChannel.notify_level === "mentions" && <Check className="ml-auto h-3.5 w-3.5" />}</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => updateConversationPreference("notify_level", "all")}><Bell className="mr-2 h-4 w-4" />Notify for every message{activeChannel.notify_level === "all" && <Check className="ml-auto h-3.5 w-3.5" />}</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => updateConversationPreference("mute_until", new Date(Date.now() + 60 * 60 * 1000).toISOString())}><VolumeX className="mr-2 h-4 w-4" />Mute for one hour</DropdownMenuItem>
                    <DropdownMenuItem onClick={jumpToUnread}><ArrowRightLeft className="mr-2 h-4 w-4" />Jump to next unread</DropdownMenuItem>
                    <DropdownMenuItem onClick={markConversationUnread}>
                      <Mail className="mr-2 h-4 w-4" />Mark unread
                    </DropdownMenuItem>
                    {activeChannel.kind === "team" && (activeChannel.created_by === user?.id || user?.is_admin || ["admin", "owner"].includes(String(user?.role || "").toLowerCase())) && <><DropdownMenuSeparator /><DropdownMenuItem className="text-amber-200 focus:text-amber-100" onClick={deleteChannel}><Trash2 className="mr-2 h-4 w-4" />Archive channel</DropdownMenuItem></>}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-zinc-400 hover:text-white" onClick={() => { setShowInfo(current => !current); setThread(null); }} aria-label="Conversation details"><PanelRightOpen className="h-4 w-4" /></Button>
              </div>
              <div className="flex h-10 items-end gap-5 text-sm">
                {rankedTabs.map(tab => {
                  const count = tab.count === "messages" ? messages.filter(message => !message.thread_id).length : tab.count === "files" ? files.length : pinned.length;
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.value}
                      onClick={() => { setActiveTab(tab.value); setSearchResults(null); }}
                      aria-current={activeTab === tab.value ? "true" : undefined}
                      className={`flex h-10 items-center gap-1.5 border-b-2 px-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${activeTab === tab.value ? "border-emerald-500 text-white" : "border-transparent text-zinc-500 hover:text-zinc-200"}`}
                    >
                      <Icon className="h-3.5 w-3.5" />{tab.label}{count > 0 && <span className="text-[10px] text-zinc-600">{count}</span>}
                    </button>
                  );
                })}
              </div>
            </header>

            {activeTab === "posts" && !searchResults && activeChannel.kind === "team" && (
              <NexusOperationsPulse context={operationalContext} pinnedCount={pinned.length} />
            )}

            {activeTab === "posts" && !searchResults && activeChannel.kind === "client_direct" && (
              <CustomerConnectionPulse channel={activeChannel} />
            )}

            {searchResults ? (
              <SearchResults
                results={searchResults}
                onSelect={result => {
                  selectChannel(result.channel_id);
                  // Mark the message the search actually matched, so a jump from
                  // results lands on evidence rather than on a bare conversation.
                  focusMessage(result.thread_id || result.id);
                  openThread({ id: result.thread_id || result.id });
                }}
                onClose={() => setSearchResults(null)}
              />
            ) : activeTab === "files" ? (
              <FilesView files={files} onDownload={downloadFile} />
            ) : activeTab === "pins" ? (
              <PinnedView messages={pinned} onOpenThread={openThread} />
            ) : (
              <>
                <div
                  ref={scrollRef}
                  onScroll={event => {
                    const node = event.currentTarget;
                    const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 120;
                    nearBottomRef.current = atBottom;
                    setShowJumpToLatest(!atBottom && messages.length > 0);
                  }}
                  className="relative flex-1 overflow-y-auto"
                  data-testid="chat-message-list"
                  role="log"
                  aria-live="polite"
                  aria-relevant="additions"
                  aria-label={`Messages in ${channelDisplayName(activeChannel)}`}
                >
                  {channelLoading && messages.length === 0 ? (
                    <div className="flex h-full items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-emerald-400" /></div>
                  ) : groupedMessages.length === 0 ? (
                    <ConversationWelcome
                      channel={activeChannel}
                      onCommand={draftOperationalCommand}
                      onOpenDetails={() => { setShowInfo(true); setThread(null); }}
                    />
                  ) : (
                    <div className="mx-auto max-w-4xl px-3 py-5 md:px-8">
                      {groupedMessages.map(group => (
                        <Fragment key={group.key}>
                          {group.type === "message" && group.message.id === unreadAnchorId && (
                            <NewMessagesDivider count={unreadAnchorCount} />
                          )}
                          {group.type === "day" ? (
                            <DayDivider label={formatDay(group.day)} />
                          ) : (
                            <MessageRow
                              message={group.message}
                              compact={group.compact}
                              own={group.message.user_id === user?.id}
                              settings={chatSettings}
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
                              highlighted={highlightMessageId === group.message.id}
                            />
                          )}
                        </Fragment>
                      ))}
                      {typingUsers.length > 0 && <TypingIndicator users={typingUsers} />}
                    </div>
                  )}
                  {showJumpToLatest && (
                    <div className="px-3 pb-3 md:px-8">
                      <JumpToLatestBar count={unreadAnchorCount} onClick={scrollToLatest} />
                    </div>
                  )}
                </div>

                <div className="border-t border-white/[0.07] bg-[#101922] p-3 md:px-5 md:py-4">
                  <div className="relative mx-auto max-w-4xl rounded-xl border border-white/[0.09] bg-[#17212b] shadow-[0_16px_35px_-25px_rgba(0,0,0,0.95)] focus-within:border-emerald-500/50 focus-within:ring-1 focus-within:ring-emerald-500/15">
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
                      <div className="absolute bottom-full left-2 z-30 mb-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-white/10 bg-[#202b36] p-3 shadow-2xl shadow-black/45" role="dialog" aria-label="Choose an emoji">
                        <div className="mb-2 flex items-center justify-between"><p className="text-xs font-semibold text-zinc-100">Emoji</p><button type="button" onClick={() => setComposerEmojiOpen(false)} className="rounded-md p-1 text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-100" aria-label="Close emoji picker"><X className="h-3.5 w-3.5" /></button></div>
                        <div className="max-h-60 space-y-3 overflow-y-auto pr-1">
                          {EMOJI_GROUPS.map(group => <div key={group.label}><p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{group.label}</p><div className="grid grid-cols-8 gap-1">{group.emojis.map((emoji, index) => <button key={`${group.label}-${emoji}-${index}`} type="button" onClick={() => { setInput(current => `${current}${emoji}`); setComposerEmojiOpen(false); composerRef.current?.focus(); }} className="grid h-8 w-8 place-items-center rounded-md text-base transition hover:bg-emerald-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60" aria-label={`Add ${emoji}`}>{emoji}</button>)}</div></div>)}
                        </div>
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
                        if (event.key === "Enter" && !event.shiftKey && chatSettings.enterToSend) { event.preventDefault(); send(); }
                      }}
                      placeholder={`Message ${channelDisplayName(activeChannel)}`}
                      className="min-h-[52px] resize-none border-0 bg-transparent px-4 pb-1 pt-2.5 text-sm shadow-none focus-visible:ring-0"
                      aria-label={`Message ${channelDisplayName(activeChannel)}`}
                      data-testid="chat-input"
                    />
                    <div className="flex items-center gap-1.5 px-3 pb-1.5 text-[10px]">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button type="button" className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/20 bg-cyan-500/[0.08] px-2 py-1 font-medium text-cyan-100 transition hover:border-cyan-400/45 hover:bg-cyan-500/[0.16]">
                            <Sparkles className="h-3 w-3" />Work actions<ChevronDown className="h-3 w-3" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-52">
                          <DropdownMenuLabel>Turn this conversation into work</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          {rankedWorkActions.map((action, index) => {
                            const Icon = action.icon;
                            const last = index === rankedWorkActions.length - 1;
                            return (
                              <Fragment key={action.id}>
                                {last && <DropdownMenuSeparator />}
                                <DropdownMenuItem
                                  className={action.destructive ? "text-rose-300 focus:text-rose-200" : undefined}
                                  onClick={() => { recordWorkAction(action); draftOperationalCommand(action.command); }}
                                  data-testid={`chat-work-action-${action.id}`}
                                >
                                  <Icon className="mr-2 h-3.5 w-3.5" />{action.label}
                                </DropdownMenuItem>
                              </Fragment>
                            );
                          })}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <button type="button" onClick={() => draftOperationalCommand("/summarize")} className="rounded-md px-2 py-1 font-medium text-zinc-400 transition hover:bg-white/[0.06] hover:text-zinc-100">Summarise</button>
                      <span className="hidden text-zinc-600 md:inline">Use / for commands</span>
                    </div>
                    <div className="flex items-center gap-1 px-2 pb-2">
                      <input ref={fileRef} type="file" className="hidden" onChange={uploadFile} />
                      <input ref={gifRef} type="file" accept="image/gif" className="hidden" onChange={uploadFile} />
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><ComposerButton icon={Bold} label="Format message" /></DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-48">
                          <DropdownMenuLabel>Formatting</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => insertComposerFormat("bold")}><Bold className="mr-2 h-3.5 w-3.5" />Bold <span className="ml-auto text-[10px] text-zinc-500">**text**</span></DropdownMenuItem>
                          <DropdownMenuItem onClick={() => insertComposerFormat("code")}><Code2 className="mr-2 h-3.5 w-3.5" />Inline code</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => insertComposerFormat("quote")}><Quote className="mr-2 h-3.5 w-3.5" />Quote</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => insertComposerFormat("list")}><List className="mr-2 h-3.5 w-3.5" />Bullet list</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <ComposerButton icon={Paperclip} label="Attach file" onClick={() => fileRef.current?.click()} />
                      <ComposerButton icon={Image} label="Share GIF" onClick={() => { setGifPickerOpen(true); if (gifState === "idle") loadGifs(""); }} />
                      <ComposerButton icon={Smile} label="Emoji" onClick={() => setComposerEmojiOpen(current => !current)} />
                      <ComposerButton icon={AtSign} label="Mention" onClick={() => setInput(current => `${current}@`)} />
                      <span className="ml-1 hidden text-[10px] text-zinc-600 sm:inline">{chatSettings.enterToSend ? "Markdown · Enter to send · Shift+Enter for a new line" : "Markdown · Enter for a new line · use Send to send"}</span>
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
        <ContextRail
          channel={activeChannel}
          users={users}
          presenceFor={presenceFor}
          currentUserId={user?.id}
          canManage={canEditActiveChannel}
          headers={headers}
          onUpdated={() => loadWorkspace({ quiet: true })}
          onClose={() => setShowInfo(false)}
          pinned={pinned}
          files={files}
          onDownload={downloadFile}
          onOpenThread={openThread}
          onJumpToUnread={jumpToUnread}
          onMarkUnread={markConversationUnread}
          onToggleSaved={() => updateConversationPreference("is_saved", !activeChannel.is_saved)}
          onToggleMuted={() => updateConversationPreference("is_muted", !activeChannel.is_muted)}
          notifySummary={notificationSummary(activeChannel)}
          context={operationalContext}
        />
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
          editingId={editingId}
          editingText={editingText}
          onEditingText={setEditingText}
          onStartEdit={message => { setEditingId(message.id); setEditingText(message.body); }}
          onCancelEdit={() => setEditingId(null)}
          onSaveEdit={saveEdit}
          onDelete={message => deleteMessage(message.id)}
          onReact={toggleReaction}
        />
      )}

      <ChatShortcutsDialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
        learningHint={chatLearningHint}
        onForgetLearning={forgetChatLearning}
      />
      <NewConversationDialog
        open={showNewDialog}
        onOpenChange={setShowNewDialog}
        users={users}
        currentUserId={user?.id}
        headers={headers}
        onCreated={channel => {
          setChannels(current => [channel, ...current.filter(existing => existing.id !== channel.id)]);
          setMode(channel.kind === "team" ? "teams" : channel.kind === "object" ? "work" : channel.kind === "client_direct" ? "customer" : "chat");
          setActiveId(channel.id);
          setSearchParams({ channel: channel.id }, { replace: true });
          setMobileConversationOpen(true);
          setShowNewDialog(false);
        }}
      />
      <Dialog open={chatSettingsOpen} onOpenChange={setChatSettingsOpen}>
        <NexusWorkflowDialog
          eyebrow="Make it yours"
          title="Chat settings"
          description="Personalise how team chat looks and behaves for you. These preferences are saved on this device."
          icon={SlidersHorizontal}
          tone="cyan"
          className="max-w-lg"
          data-testid="chat-settings-dialog"
          footer={<Button onClick={() => setChatSettingsOpen(false)} data-testid="chat-settings-done">Done</Button>}
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
              <div><p className="text-sm font-medium">Compact message density</p><p className="text-[11px] text-muted-foreground">Tighter spacing for busy channels.</p></div>
              <Switch checked={chatSettings.density === "compact"} onCheckedChange={value => setChatSettings(current => ({ ...current, density: value ? "compact" : "comfy" }))} data-testid="chat-setting-density" />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
              <div><p className="text-sm font-medium">Enter to send</p><p className="text-[11px] text-muted-foreground">When off, Enter starts a new line and you send with the Send button.</p></div>
              <Switch checked={chatSettings.enterToSend} onCheckedChange={value => setChatSettings(current => ({ ...current, enterToSend: value }))} data-testid="chat-setting-enter" />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
              <div><p className="text-sm font-medium">Show timestamps</p><p className="text-[11px] text-muted-foreground">Display the send time beside each sender.</p></div>
              <Switch checked={chatSettings.showTimestamps} onCheckedChange={value => setChatSettings(current => ({ ...current, showTimestamps: value }))} data-testid="chat-setting-timestamps" />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
              <div><p className="text-sm font-medium">Show avatars</p><p className="text-[11px] text-muted-foreground">Hide avatars for a text-first view.</p></div>
              <Switch checked={chatSettings.showAvatars} onCheckedChange={value => setChatSettings(current => ({ ...current, showAvatars: value }))} data-testid="chat-setting-avatars" />
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
              <p className="text-sm font-medium">Your message accent</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Tint applied to your own messages.</p>
              <div className="mt-2.5 flex items-center gap-2">
                {ACCENT_SWATCHES.map(swatch => (
                  <button key={swatch.value} type="button" onClick={() => setChatSettings(current => ({ ...current, accent: swatch.value }))} aria-label={`${swatch.label} accent`} className={`flex h-9 w-9 items-center justify-center rounded-full transition hover:scale-110 ${swatch.className} ${chatSettings.accent === swatch.value ? "ring-2 ring-white/80 ring-offset-2 ring-offset-background" : "opacity-60"}`} data-testid={`chat-setting-accent-${swatch.value}`} />
                ))}
                <Select value={chatSettings.accent} onValueChange={value => setChatSettings(current => ({ ...current, accent: value }))}>
                  <SelectTrigger className="h-9 w-36 text-xs" data-testid="chat-setting-accent-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ACCENT_SWATCHES.map(swatch => <SelectItem key={swatch.value} value={swatch.value}>{swatch.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </NexusWorkflowDialog>
      </Dialog>

      <Dialog open={showArchived} onOpenChange={setShowArchived}>
        <NexusWorkflowDialog
          eyebrow="Recoverable channel archive"
          title="Archived channels"
          description="Archived channels keep their posts, attachments, and governance history. Restore one when the work resumes."
          icon={RefreshCw}
          tone="amber"
          footer={<Button variant="outline" onClick={() => setShowArchived(false)}>Close</Button>}
        >
          <div className="space-y-2">
            {loadingArchived ? <div className="flex items-center gap-2 py-6 text-sm text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" />Loading archive…</div> : archivedChannels.length === 0 ? <p className="py-6 text-center text-sm text-zinc-500">No archived channels you can restore.</p> : archivedChannels.map(channel => <div key={channel.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-3"><ChannelAvatar channel={channel} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{channelDisplayName(channel)}</p><p className="truncate text-xs text-zinc-500">{channel.description || "No channel purpose"}</p></div><Button size="sm" variant="outline" onClick={() => restoreChannel(channel)}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Restore</Button></div>)}
          </div>
        </NexusWorkflowDialog>
      </Dialog>
      <Dialog open={showMessageSearch} onOpenChange={setShowMessageSearch}>
        <NexusWorkflowDialog
          eyebrow="Find operational context"
          title="Search messages"
          description="Search across conversations without changing the conversation filter or losing your current place."
          icon={Search}
          tone="cyan"
          footer={<><Button variant="outline" onClick={() => setShowMessageSearch(false)}>Cancel</Button><Button onClick={searchMessages} disabled={!messageSearchQuery.trim() || searching}>{searching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}Search messages</Button></>}
        >
          <div className="space-y-2">
            <Label htmlFor="message-search-query" className="text-xs">Words, ticket references, or people</Label>
            <Input
              id="message-search-query"
              value={messageSearchQuery}
              onChange={event => setMessageSearchQuery(event.target.value)}
              onKeyDown={event => event.key === "Enter" && searchMessages()}
              placeholder="e.g. INC-0015, backup, Alex"
              autoFocus
            />
            <select value={messageSearchScope} onChange={event => setMessageSearchScope(event.target.value)} className="h-9 w-full rounded-lg border border-white/10 bg-black/20 px-3 text-sm text-zinc-300">
              <option value="all">Search all accessible conversations</option>
              <option value="channel" disabled={!activeId}>Search this conversation only</option>
            </select>
          </div>
        </NexusWorkflowDialog>
      </Dialog>
      <Dialog open={gifPickerOpen} onOpenChange={setGifPickerOpen}>
        <NexusWorkflowDialog eyebrow="Media" title="Share a GIF" description="Search Tenor, or upload a GIF from your computer." icon={Image} tone="cyan" footer={<Button variant="outline" onClick={() => gifRef.current?.click()}>Upload GIF</Button>}>
          <form className="flex gap-2" onSubmit={event => { event.preventDefault(); loadGifs(gifQuery); }}><Input value={gifQuery} onChange={event => setGifQuery(event.target.value)} placeholder="Search GIFs" autoFocus /><Button type="submit" disabled={gifState === "loading"}>{gifState === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}</Button></form>
          {gifState === "unconfigured" ? <p className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] p-3 text-sm text-amber-100">GIF search is ready for a Tenor API key. You can still upload a GIF now.</p> : gifState === "error" ? <p className="mt-4 text-sm text-rose-200">GIF search is temporarily unavailable. Try again or upload a GIF.</p> : <div className="mt-4 grid grid-cols-3 gap-2">{gifResults.map(gif => <button key={gif.id} type="button" onClick={() => shareGif(gif)} className="overflow-hidden rounded-lg border border-white/10 bg-black/20 hover:border-cyan-400/50"><img src={gif.preview_url} alt={gif.title || "GIF"} className="aspect-video w-full object-cover" /></button>)}</div>}
          {gifState === "ready" && <p className="mt-3 text-[10px] text-zinc-500">Powered by Tenor</p>}
        </NexusWorkflowDialog>
      </Dialog>
      <Dialog
        open={Boolean(directRequestDialog)}
        onOpenChange={open => {
          if (!open && !directRequestDecision) {
            setDirectRequestDialog(null);
            setDirectRequestResponse("");
          }
        }}
      >
        <NexusWorkflowDialog
          eyebrow="Customer connection approval"
          title={directRequestDialog ? `Review ${directRequestDialog.customerName}'s request` : "Review direct request"}
          description="Approve a private customer conversation only when the context is appropriate. Nexus records the decision and preserves the supplied work context."
          icon={UserRoundCheck}
          tone="cyan"
          data-testid="direct-request-workflow"
          footer={(
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setDirectRequestDialog(null);
                  setDirectRequestResponse("");
                }}
                disabled={Boolean(directRequestDecision)}
              >
                Cancel
              </Button>
              <Button
                variant="outline"
                className="border-rose-500/30 text-rose-200 hover:bg-rose-500/10 hover:text-rose-100"
                onClick={() => decideDirectRequest("decline")}
                disabled={Boolean(directRequestDecision)}
                data-testid="decline-direct-request"
              >
                {directRequestDecision === "decline" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
                Decline
              </Button>
              <Button
                onClick={() => decideDirectRequest("accept")}
                disabled={Boolean(directRequestDecision)}
                data-testid="accept-direct-request"
              >
                {directRequestDecision === "accept" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                Approve & open chat
              </Button>
            </>
          )}
        >
          {directRequestDialog && (
            <DirectRequestDecisionForm
              request={directRequestDialog}
              response={directRequestResponse}
              onResponse={setDirectRequestResponse}
            />
          )}
        </NexusWorkflowDialog>
      </Dialog>
      </div>
      </section>
    </div>
  );
}
