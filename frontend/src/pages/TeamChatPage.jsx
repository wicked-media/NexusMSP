import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Hash, Lock, Plus, Send, Search, Smile, Paperclip, Pin, Trash2, Edit, Reply,
  X, AtSign, CornerDownRight, CheckCheck, MessageSquarePlus, Users, MessageCircle,
  Phone, Video, Info, Image as ImageIcon, MoreVertical, Mic, ArrowLeft
} from "lucide-react";

const COMMON_EMOJIS = ["👍", "❤️", "😂", "🎉", "🔥", "🚀", "✅", "💯", "👏", "😮", "🙏", "👀"];
const TICKET_REGEX = /\/ticket\s+([\w-]+)/gi;

// ============== Helpers ==============
const formatRelativeTime = (ts) => {
  if (!ts) return "";
  const d = new Date(ts);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
};

const formatMessageTime = (ts) => {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
};

const formatDateSeparator = (ts) => {
  const d = new Date(ts);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const ymd = new Date(d); ymd.setHours(0, 0, 0, 0);
  const days = Math.floor((today - ymd) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
};

const initials = (name) => (name || "?").split(" ").map(s => s[0]).join("").slice(0, 2).toUpperCase();
const avatarHue = (s) => { let h = 0; for (let i = 0; i < (s || "").length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) % 360; };

// ============== Main ==============
export default function TeamChatPage() {
  const { token, user } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const [channels, setChannels] = useState([]);
  const [users, setUsers] = useState([]);
  const [presence, setPresence] = useState({});
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState(null);
  const [pinned, setPinned] = useState([]);
  const [thread, setThread] = useState(null);
  const [threadInput, setThreadInput] = useState("");
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [emojiTarget, setEmojiTarget] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState("");
  const [typingUsers, setTypingUsers] = useState([]);
  const [showInfo, setShowInfo] = useState(false);
  const fileRef = useRef(null);
  const scrollRef = useRef(null);

  const activeChannel = channels.find(c => c.id === activeId);

  // Initial load + presence + users
  useEffect(() => {
    if (!token) return;
    let alive = true;
    const load = async () => {
      try {
        const [chs, pr, us] = await Promise.all([
          axios.get(`${API}/chat/channels-preview`, { headers }).then(r => r.data).catch(() => axios.get(`${API}/chat/channels`, { headers }).then(r => r.data)),
          axios.get(`${API}/presence`, { headers }).then(r => r.data),
          axios.get(`${API}/users`, { headers }).then(r => r.data).catch(() => []),
        ]);
        if (!alive) return;
        setChannels(chs || []);
        setPresence(Object.fromEntries((pr.users || []).map(u => [u.user_id, u.status])));
        setUsers(us || []);
        if (!activeId && chs.length > 0) setActiveId(chs[0].id);
      } catch { /* ignore */ }
    };
    load();
    const t = setInterval(load, 6000);
    return () => { alive = false; clearInterval(t); };
  }, [token]); // eslint-disable-line

  // Heartbeat
  useEffect(() => {
    if (!token) return;
    const beat = () => axios.post(`${API}/presence/heartbeat`, {}, { headers }).catch(() => {});
    beat();
    const t = setInterval(beat, 25000);
    return () => clearInterval(t);
  }, [token]); // eslint-disable-line

  // Messages + typing poll
  const refreshMessages = useCallback(async () => {
    if (!activeId) return;
    try {
      const [msgsR, pinR, typR] = await Promise.all([
        axios.get(`${API}/chat/channels/${activeId}/messages`, { headers }),
        axios.get(`${API}/chat/channels/${activeId}/pinned`, { headers }).catch(() => ({ data: [] })),
        axios.get(`${API}/chat/channels/${activeId}/typing`, { headers }).catch(() => ({ data: [] })),
      ]);
      setMessages(msgsR.data || []);
      setPinned(pinR.data || []);
      setTypingUsers(typR.data || []);
      axios.post(`${API}/chat/channels/${activeId}/read`, {}, { headers }).catch(() => {});
    } catch { /* ignore */ }
  }, [activeId, headers]);

  useEffect(() => {
    if (!activeId) return;
    refreshMessages();
    const t = setInterval(refreshMessages, 3000);
    return () => clearInterval(t);
  }, [activeId, refreshMessages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, activeId]);

  const send = async () => {
    const body = input.trim();
    if (!body || !activeId) return;
    setInput("");
    try { await axios.post(`${API}/chat/channels/${activeId}/messages`, { body }, { headers }); refreshMessages(); }
    catch { toast.error("Send failed"); setInput(body); }
  };

  const sendTyping = useCallback(() => { if (activeId) axios.post(`${API}/chat/channels/${activeId}/typing`, {}, { headers }).catch(() => {}); }, [activeId, headers]);

  const sendThread = async () => {
    const body = threadInput.trim();
    if (!body || !thread) return;
    setThreadInput("");
    try { await axios.post(`${API}/chat/messages/${thread.parent.id}/reply`, { body }, { headers });
      const r = await axios.get(`${API}/chat/messages/${thread.parent.id}/thread`, { headers });
      setThread(r.data); refreshMessages();
    } catch { toast.error("Reply failed"); }
  };

  const openThread = async (msg) => {
    try { const r = await axios.get(`${API}/chat/messages/${msg.id}/thread`, { headers }); setThread(r.data); }
    catch { toast.error("Thread load failed"); }
  };

  const toggleReaction = async (msgId, emoji) => {
    try { const r = await axios.post(`${API}/chat/messages/${msgId}/reactions`, { emoji }, { headers });
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, reactions: r.data.reactions } : m));
      if (thread?.parent.id === msgId) setThread(t => ({ ...t, parent: { ...t.parent, reactions: r.data.reactions } }));
      setEmojiTarget(null);
    } catch { toast.error("Reaction failed"); }
  };

  const startEdit = (msg) => { setEditingId(msg.id); setEditingText(msg.body); };
  const saveEdit = async () => {
    try { await axios.put(`${API}/chat/messages/${editingId}`, { body: editingText }, { headers }); setEditingId(null); refreshMessages(); }
    catch { toast.error("Edit failed"); }
  };
  const deleteMsg = async (id) => {
    if (!window.confirm("Delete this message?")) return;
    try { await axios.delete(`${API}/chat/messages/${id}`, { headers }); refreshMessages(); } catch { toast.error("Delete failed"); }
  };
  const togglePin = async (msg) => {
    try { await axios.post(`${API}/chat/messages/${msg.id}/${msg.pinned ? "unpin" : "pin"}`, {}, { headers }); refreshMessages(); } catch { toast.error("Pin failed"); }
  };

  const onUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast.error("Max 10 MB"); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      const b64 = reader.result.split(",")[1];
      try { await axios.post(`${API}/chat/channels/${activeId}/upload`, { filename: file.name, content_type: file.type, base64: b64 }, { headers }); refreshMessages(); toast.success("Sent"); }
      catch { toast.error("Upload failed"); }
    };
    reader.readAsDataURL(file);
  };

  const doSearch = async () => {
    if (!searchTerm.trim()) { setSearchResults(null); return; }
    try { const r = await axios.get(`${API}/chat/search`, { headers, params: { q: searchTerm } }); setSearchResults(r.data || []); }
    catch { toast.error("Search failed"); }
  };

  // Filter sidebar by search term (chat name)
  const filteredChannels = useMemo(() => {
    if (!searchTerm) return channels;
    const q = searchTerm.toLowerCase();
    return channels.filter(c => (c.name || "").toLowerCase().includes(q));
  }, [channels, searchTerm]);

  // Group messages by day for separators
  const groupedMessages = useMemo(() => {
    const groups = [];
    let currentDate = null;
    let lastUserId = null;
    for (const m of messages.filter(m => !m.thread_id)) {
      const dateKey = (m.ts || "").slice(0, 10);
      if (dateKey !== currentDate) {
        groups.push({ type: "separator", label: formatDateSeparator(m.ts), key: `sep-${dateKey}` });
        currentDate = dateKey;
        lastUserId = null;
      }
      const grouped = lastUserId === m.user_id;
      groups.push({ type: "msg", msg: m, grouped, key: m.id });
      lastUserId = m.user_id;
    }
    return groups;
  }, [messages]);

  return (
    <div className="h-[calc(100vh-60px)] flex bg-gradient-to-br from-background via-background to-violet-950/10 overflow-hidden" data-testid="team-chat-page">
      {/* === SIDEBAR === */}
      <aside className="w-[340px] border-r border-border/40 flex flex-col bg-card/30 backdrop-blur-xl">
        {/* Sidebar header */}
        <div className="p-4 border-b border-border/40">
          <div className="flex items-center justify-between mb-3">
            <h1 className="font-bold text-xl tracking-tight bg-gradient-to-r from-violet-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent">Chats</h1>
            <Button size="sm" variant="ghost" className="rounded-full h-9 w-9 p-0 hover:bg-violet-500/15 hover:text-violet-300" onClick={() => setShowNewDialog(true)} data-testid="new-chat-btn" title="New chat or channel">
              <MessageSquarePlus className="w-4 h-4" />
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} onKeyDown={e => e.key === "Enter" && searchTerm && doSearch()} placeholder="Search chats or messages..." className="pl-9 h-9 text-sm rounded-full bg-muted/40 border-0 focus-visible:ring-1 focus-visible:ring-violet-500/40" data-testid="chat-search" />
          </div>
        </div>

        {/* Conversations list */}
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-0.5">
            {filteredChannels.length === 0 ? (
              <div className="text-center py-12 px-4">
                <MessageCircle className="w-12 h-12 mx-auto mb-3 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No conversations yet</p>
                <Button size="sm" className="mt-3" onClick={() => setShowNewDialog(true)}>
                  <Plus className="w-3.5 h-3.5 mr-1" />Start a chat
                </Button>
              </div>
            ) : filteredChannels.map(c => (
              <ChannelRow key={c.id} channel={c} active={activeId === c.id} presence={presence} onClick={() => { setActiveId(c.id); setSearchResults(null); setThread(null); }} />
            ))}
          </div>
        </ScrollArea>

        {/* Self avatar footer */}
        <div className="p-3 border-t border-border/40 flex items-center gap-3">
          <Avatar className="w-9 h-9 ring-2 ring-emerald-500/40">
            <AvatarFallback style={{ backgroundColor: `hsl(${avatarHue(user?.name)}, 60%, 35%)`, color: "white", fontSize: 12 }}>{initials(user?.name)}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user?.name}</p>
            <p className="text-[10px] text-emerald-400 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />Online</p>
          </div>
        </div>
      </aside>

      {/* === MAIN === */}
      <main className="flex-1 flex flex-col min-w-0 relative">
        {!activeChannel ? (
          <EmptyState onNew={() => setShowNewDialog(true)} />
        ) : (
          <>
            {/* Header */}
            <div className="px-5 py-3 border-b border-border/40 bg-card/30 backdrop-blur-xl flex items-center gap-3">
              <Avatar className="w-10 h-10">
                <AvatarFallback style={{ backgroundColor: `hsl(${avatarHue(activeChannel.name)}, 55%, 40%)`, color: "white", fontSize: 13 }}>
                  {activeChannel.is_dm ? initials(activeChannel.name) : <Hash className="w-4 h-4" />}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold truncate">{activeChannel.name}</h2>
                  {activeChannel.is_private && <Lock className="w-3 h-3 text-muted-foreground" />}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {activeChannel.is_dm
                    ? (presence[activeChannel.other_user_id] === "online" ? <><span className="text-emerald-400">●</span> Active now</> : "Offline")
                    : `${activeChannel.member_ids?.length || 0} members${typingUsers.length > 0 ? ` · ${typingUsers[0].user_name} typing…` : ""}`}
                </p>
              </div>
              <Button size="sm" variant="ghost" className="rounded-full h-9 w-9 p-0" title="Voice call (coming soon)"><Phone className="w-4 h-4" /></Button>
              <Button size="sm" variant="ghost" className="rounded-full h-9 w-9 p-0" title="Video call (coming soon)"><Video className="w-4 h-4" /></Button>
              <Button size="sm" variant="ghost" className="rounded-full h-9 w-9 p-0" onClick={() => setShowInfo(s => !s)} title="Info"><Info className="w-4 h-4" /></Button>
            </div>

            {/* Pinned strip */}
            {pinned.length > 0 && (
              <div className="px-5 py-2 border-b border-amber-500/20 bg-amber-500/[0.05] flex items-center gap-2 text-xs">
                <Pin className="w-3 h-3 text-amber-400" />
                <span className="font-medium text-amber-300">{pinned.length} Pinned:</span>
                <span className="text-muted-foreground truncate">{pinned[0].body.slice(0, 80)}{pinned[0].body.length > 80 ? "…" : ""}</span>
              </div>
            )}

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
              {searchResults ? (
                <SearchResultsView results={searchResults} headers={headers} onClose={() => { setSearchResults(null); setSearchTerm(""); }} userId={user?.id} />
              ) : groupedMessages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground py-20">
                  <div className="w-20 h-20 rounded-full bg-gradient-to-br from-violet-500/20 to-cyan-500/20 flex items-center justify-center mb-4">
                    <MessageCircle className="w-9 h-9 text-violet-400" />
                  </div>
                  <p className="font-medium">Send your first message</p>
                  <p className="text-xs mt-1">Type below to start the conversation</p>
                </div>
              ) : groupedMessages.map(g => g.type === "separator" ? (
                <DateSeparator key={g.key} label={g.label} />
              ) : (
                <ChatBubble
                  key={g.key} msg={g.msg} grouped={g.grouped} isOwn={g.msg.user_id === user?.id} headers={headers}
                  onReact={(em) => toggleReaction(g.msg.id, em)}
                  onThread={() => openThread(g.msg)}
                  onEdit={() => startEdit(g.msg)}
                  onDelete={() => deleteMsg(g.msg.id)}
                  onPin={() => togglePin(g.msg)}
                  onSetEmojiTarget={() => setEmojiTarget(g.msg.id)}
                  emojiOpen={emojiTarget === g.msg.id}
                  onCloseEmoji={() => setEmojiTarget(null)}
                  editing={editingId === g.msg.id}
                  editingText={editingText} setEditingText={setEditingText}
                  onSaveEdit={saveEdit} onCancelEdit={() => setEditingId(null)}
                />
              ))}
              {typingUsers.length > 0 && !searchResults && <TypingIndicator users={typingUsers} />}
            </div>

            {/* Composer */}
            <div className="p-3 border-t border-border/40 bg-card/30 backdrop-blur-xl">
              <div className="flex items-end gap-2">
                <input ref={fileRef} type="file" className="hidden" onChange={onUpload} />
                <Button size="sm" variant="ghost" className="rounded-full h-10 w-10 p-0 hover:bg-violet-500/10" onClick={() => fileRef.current?.click()} title="Attach"><Paperclip className="w-4 h-4" /></Button>
                <div className="flex-1 relative">
                  <Input value={input} onChange={e => { setInput(e.target.value); sendTyping(); }} onKeyDown={e => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())} placeholder={`Message ${activeChannel?.name || ""}…  use @ to mention or /ticket T-XXX`} className="rounded-full pl-4 pr-12 h-10 bg-muted/40 border-0 focus-visible:ring-1 focus-visible:ring-violet-500/40" data-testid="chat-input" />
                  <Button size="sm" variant="ghost" className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full h-8 w-8 p-0 hover:bg-violet-500/10" title="Emoji" onClick={() => { const em = COMMON_EMOJIS[Math.floor(Math.random() * COMMON_EMOJIS.length)]; setInput(p => p + em); }}><Smile className="w-4 h-4" /></Button>
                </div>
                <Button onClick={send} disabled={!input.trim()} className="rounded-full h-10 w-10 p-0 bg-gradient-to-br from-violet-500 to-cyan-500 hover:from-violet-600 hover:to-cyan-600 shadow-lg shadow-violet-500/25" data-testid="chat-send"><Send className="w-4 h-4" /></Button>
              </div>
            </div>
          </>
        )}
      </main>

      {/* Info panel */}
      {showInfo && activeChannel && (
        <aside className="w-72 border-l border-border/40 p-4 overflow-auto bg-card/20 backdrop-blur-xl">
          <div className="text-center mb-4">
            <Avatar className="w-20 h-20 mx-auto mb-2"><AvatarFallback style={{ backgroundColor: `hsl(${avatarHue(activeChannel.name)}, 55%, 40%)`, color: "white", fontSize: 24 }}>{activeChannel.is_dm ? initials(activeChannel.name) : <Hash className="w-7 h-7" />}</AvatarFallback></Avatar>
            <h3 className="font-semibold text-lg">{activeChannel.name}</h3>
            <p className="text-xs text-muted-foreground">{activeChannel.is_private ? "Private" : "Public"} · {activeChannel.member_ids?.length || 0} members</p>
          </div>
          <h4 className="text-[10px] font-semibold uppercase text-muted-foreground mb-2">Members</h4>
          <div className="space-y-2">
            {(activeChannel.member_ids || []).map(uid => {
              const u = users.find(x => x.id === uid);
              if (!u) return null;
              return (
                <div key={uid} className="flex items-center gap-2 p-1.5 rounded hover:bg-muted/30">
                  <Avatar className="w-7 h-7"><AvatarFallback style={{ backgroundColor: `hsl(${avatarHue(u.name)}, 55%, 40%)`, color: "white", fontSize: 10 }}>{initials(u.name)}</AvatarFallback></Avatar>
                  <div className="flex-1 min-w-0"><p className="text-sm truncate">{u.name}</p><p className="text-[10px] text-muted-foreground capitalize">{presence[u.id] || "offline"}</p></div>
                </div>
              );
            })}
          </div>
        </aside>
      )}

      {/* Thread sidebar */}
      {thread && (
        <aside className="w-96 border-l border-border/40 flex flex-col bg-card/30 backdrop-blur-xl" data-testid="thread-panel">
          <div className="p-3 border-b border-border/40 flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-1.5"><CornerDownRight className="w-4 h-4 text-cyan-400" />Thread</h3>
            <Button size="sm" variant="ghost" className="rounded-full h-7 w-7 p-0" onClick={() => setThread(null)}><X className="w-3.5 h-3.5" /></Button>
          </div>
          <div className="flex-1 overflow-auto p-3 space-y-1">
            <ChatBubble msg={thread.parent} isOwn={thread.parent.user_id === user?.id} headers={headers} compact />
            <div className="my-3 border-t border-border/40 pt-3 space-y-1">
              {thread.replies.map(r => <ChatBubble key={r.id} msg={r} isOwn={r.user_id === user?.id} headers={headers} compact />)}
            </div>
          </div>
          <div className="p-3 border-t border-border/40 flex gap-2">
            <Input value={threadInput} onChange={e => setThreadInput(e.target.value)} onKeyDown={e => e.key === "Enter" && sendThread()} placeholder="Reply…" className="rounded-full bg-muted/40 border-0" data-testid="thread-input" />
            <Button onClick={sendThread} size="sm" className="rounded-full h-9 w-9 p-0 bg-gradient-to-br from-violet-500 to-cyan-500" data-testid="thread-send"><Send className="w-3.5 h-3.5" /></Button>
          </div>
        </aside>
      )}

      {/* New chat dialog */}
      <NewChatDialog open={showNewDialog} onOpenChange={setShowNewDialog} users={users} headers={headers} currentUserId={user?.id} onCreated={(ch) => { setChannels(prev => prev.find(c => c.id === ch.id) ? prev : [ch, ...prev]); setActiveId(ch.id); setShowNewDialog(false); }} />
    </div>
  );
}

// ============== Channel row in sidebar ==============
function ChannelRow({ channel, active, presence, onClick }) {
  const isOnline = channel.is_dm && presence[channel.other_user_id] === "online";
  return (
    <button onClick={onClick} className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-xl transition-all ${active ? "bg-violet-500/15 ring-1 ring-violet-500/30" : "hover:bg-muted/40"}`} data-testid={`channel-${channel.id}`}>
      <div className="relative shrink-0">
        <Avatar className="w-11 h-11">
          <AvatarFallback style={{ backgroundColor: `hsl(${avatarHue(channel.name)}, 55%, 40%)`, color: "white", fontSize: 13 }}>
            {channel.is_dm ? initials(channel.name) : <Hash className="w-5 h-5" />}
          </AvatarFallback>
        </Avatar>
        {isOnline && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-card" />}
      </div>
      <div className="flex-1 min-w-0 text-left">
        <div className="flex items-center justify-between gap-2">
          <p className={`font-medium text-sm truncate ${channel.unread_count > 0 ? "" : ""}`}>{channel.name}</p>
          <span className="text-[10px] text-muted-foreground shrink-0">{formatRelativeTime(channel.last_message?.ts || channel.created_at)}</span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <p className={`text-xs truncate ${channel.unread_count > 0 ? "text-foreground font-medium" : "text-muted-foreground"}`}>
            {channel.last_message ? <><span className="text-muted-foreground">{channel.last_message.user_name?.split(" ")[0]}:</span> {channel.last_message.body || "📎 Attachment"}</> : <span className="italic text-muted-foreground/70">No messages yet</span>}
          </p>
          {channel.unread_count > 0 && (
            <span className="shrink-0 min-w-5 h-5 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 text-white text-[10px] font-bold flex items-center justify-center px-1.5 shadow-md">
              {channel.unread_count > 99 ? "99+" : channel.unread_count}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ============== Empty State ==============
function EmptyState({ onNew }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-gradient-to-br from-background via-violet-950/5 to-cyan-950/5">
      <div className="w-32 h-32 rounded-full bg-gradient-to-br from-violet-500/20 to-cyan-500/20 flex items-center justify-center mb-6 shadow-2xl shadow-violet-500/10 animate-pulse">
        <MessageCircle className="w-14 h-14 text-violet-400" />
      </div>
      <h2 className="text-2xl font-bold tracking-tight mb-2 bg-gradient-to-r from-violet-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent">Welcome to Team Chat</h2>
      <p className="text-sm text-muted-foreground max-w-sm mb-6">Start a direct message, create a group chat, or open a channel — built for fast, distraction-free internal collaboration.</p>
      <Button onClick={onNew} className="rounded-full px-6 h-11 bg-gradient-to-r from-violet-500 to-cyan-500 hover:from-violet-600 hover:to-cyan-600 shadow-lg shadow-violet-500/25"><MessageSquarePlus className="w-4 h-4 mr-2" />Start a new chat</Button>
    </div>
  );
}

// ============== Search results ==============
function SearchResultsView({ results, headers, onClose, userId }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3 px-2">
        <h3 className="text-sm font-semibold">Search results ({results.length})</h3>
        <Button size="sm" variant="ghost" onClick={onClose} className="rounded-full h-7 w-7 p-0"><X className="w-3.5 h-3.5" /></Button>
      </div>
      <div className="space-y-2">{results.map(m => (<ChatBubble key={m.id} msg={m} isOwn={m.user_id === userId} headers={headers} compact />))}</div>
    </div>
  );
}

// ============== Date Separator ==============
function DateSeparator({ label }) {
  return (
    <div className="flex items-center gap-3 my-4 px-4">
      <div className="flex-1 h-px bg-border/30" />
      <span className="text-[10px] uppercase font-semibold text-muted-foreground tracking-widest">{label}</span>
      <div className="flex-1 h-px bg-border/30" />
    </div>
  );
}

// ============== Typing indicator ==============
function TypingIndicator({ users }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 ml-12">
      <div className="bg-muted/60 rounded-2xl px-4 py-2 flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: "0s" }} />
        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: "0.15s" }} />
        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: "0.3s" }} />
      </div>
      <span className="text-[11px] text-muted-foreground italic">{users.map(u => u.user_name).join(", ")} typing</span>
    </div>
  );
}

// ============== Ticket Card embed ==============
function TicketCard({ ticketNumber, headers }) {
  const [card, setCard] = useState(null);
  useEffect(() => { let alive = true; axios.get(`${API}/chat/ticket-card/${ticketNumber}`, { headers }).then(r => alive && setCard(r.data)).catch(() => {}); return () => { alive = false; }; }, [ticketNumber]); // eslint-disable-line
  if (!card) return null;
  const prio = card.priority || "medium";
  const prioStyle = prio === "critical" ? "bg-rose-500/10 border-rose-500/40 text-rose-300" : prio === "high" ? "bg-amber-500/10 border-amber-500/40 text-amber-300" : prio === "low" ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-300" : "bg-cyan-500/10 border-cyan-500/40 text-cyan-300";
  return (
    <a href={`/tickets?id=${card.id}`} className="block mt-2 p-3 rounded-xl border bg-card/60 hover:bg-card/80 hover:border-violet-500/40 transition w-full max-w-md backdrop-blur-sm">
      <div className="flex items-center gap-2 mb-1.5">
        <code className="text-[10px] font-mono bg-violet-500/10 text-violet-300 px-1.5 py-0.5 rounded">{card.ticket_number}</code>
        <Badge variant="outline" className={`text-[9px] capitalize ${prioStyle}`}>{prio}</Badge>
        <Badge variant="outline" className="text-[9px] capitalize">{card.status?.replace("_", " ")}</Badge>
      </div>
      <p className="text-sm font-medium">{card.title}</p>
      <p className="text-[11px] text-muted-foreground mt-1">{card.client_name}{card.assigned_to_name ? ` · ${card.assigned_to_name}` : ""}{card.service_name ? ` · ${card.service_name}` : ""}</p>
    </a>
  );
}

function renderBody(body, headers) {
  if (!body) return null;
  const matches = [...body.matchAll(TICKET_REGEX)];
  if (matches.length === 0) return <span className="whitespace-pre-wrap break-words">{body}</span>;
  const parts = []; let last = 0;
  matches.forEach((m, i) => {
    if (m.index > last) parts.push(<span key={`t${i}`}>{body.slice(last, m.index)}</span>);
    parts.push(<code key={`c${i}`} className="bg-violet-500/15 text-violet-300 px-1 rounded text-xs font-mono">{m[0]}</code>);
    last = m.index + m[0].length;
  });
  if (last < body.length) parts.push(<span key="end">{body.slice(last)}</span>);
  const ticketNumbers = [...new Set(matches.map(m => m[1]))];
  return (
    <>
      <span className="whitespace-pre-wrap break-words">{parts}</span>
      {ticketNumbers.map(n => <TicketCard key={n} ticketNumber={n} headers={headers} />)}
    </>
  );
}

// ============== Bubble ==============
function ChatBubble({ msg, grouped, isOwn, headers, onReact, onThread, onEdit, onDelete, onPin, onSetEmojiTarget, emojiOpen, onCloseEmoji, editing, editingText, setEditingText, onSaveEdit, onCancelEdit, compact }) {
  const [hover, setHover] = useState(false);
  const bubbleStyle = isOwn
    ? "bg-gradient-to-br from-violet-500 to-cyan-600 text-white shadow-md shadow-violet-500/20"
    : "bg-muted/60 text-foreground";

  return (
    <div className={`flex gap-2 ${isOwn ? "flex-row-reverse" : "flex-row"} ${grouped ? "mt-0.5" : "mt-3"} ${msg.deleted ? "opacity-50" : ""}`} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {/* Avatar */}
      <div className="w-9 shrink-0 flex justify-center">
        {!grouped && !isOwn && (
          <Avatar className="w-9 h-9 mt-1"><AvatarFallback style={{ backgroundColor: `hsl(${avatarHue(msg.user_name)}, 55%, 40%)`, color: "white", fontSize: 11 }}>{initials(msg.user_name)}</AvatarFallback></Avatar>
        )}
      </div>

      <div className={`flex flex-col max-w-[68%] ${isOwn ? "items-end" : "items-start"}`}>
        {!grouped && (
          <div className={`flex items-center gap-2 mb-1 px-1 ${isOwn ? "flex-row-reverse" : ""}`}>
            <span className="text-[12px] font-semibold">{msg.user_name}</span>
            <span className="text-[10px] text-muted-foreground">{formatMessageTime(msg.ts)}</span>
            {msg.pinned && <Pin className="w-2.5 h-2.5 text-amber-400" />}
          </div>
        )}

        <div className="relative group">
          {editing ? (
            <div className="flex gap-2 w-96">
              <Input value={editingText} onChange={e => setEditingText(e.target.value)} onKeyDown={e => e.key === "Enter" && onSaveEdit()} className="h-9 rounded-full bg-muted/40 border-0" autoFocus />
              <Button size="sm" onClick={onSaveEdit} className="h-9 rounded-full">Save</Button>
              <Button size="sm" variant="ghost" onClick={onCancelEdit} className="h-9 rounded-full"><X className="w-3.5 h-3.5" /></Button>
            </div>
          ) : (
            <div className={`px-3.5 py-2 rounded-2xl text-sm leading-relaxed ${bubbleStyle} ${isOwn ? "rounded-br-md" : "rounded-bl-md"} ${msg.pinned ? "ring-2 ring-amber-500/40" : ""}`}>
              {renderBody(msg.body, headers)}
              {msg.attachment?.is_image && (
                <a href={`${API}/chat/files/${msg.attachment.file_id}`} target="_blank" rel="noopener" className="block mt-2 flex items-center gap-1 text-xs underline opacity-90"><ImageIcon className="w-3 h-3" />{msg.attachment.filename}</a>
              )}
              {msg.edited && <span className="ml-1.5 text-[9px] opacity-70">(edited)</span>}
            </div>
          )}

          {/* Action toolbar */}
          {hover && !editing && !compact && (
            <div className={`absolute top-0 ${isOwn ? "right-full mr-2" : "left-full ml-2"} -translate-y-2 flex items-center gap-0.5 bg-card border rounded-full shadow-lg px-1 py-0.5 z-10`}>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 rounded-full" onClick={onSetEmojiTarget} title="React"><Smile className="w-3.5 h-3.5" /></Button>
              {onThread && <Button size="sm" variant="ghost" className="h-7 w-7 p-0 rounded-full" onClick={onThread} title="Reply in thread"><Reply className="w-3.5 h-3.5" /></Button>}
              {onPin && <Button size="sm" variant="ghost" className="h-7 w-7 p-0 rounded-full" onClick={onPin} title={msg.pinned ? "Unpin" : "Pin"}><Pin className={`w-3.5 h-3.5 ${msg.pinned ? "text-amber-400 fill-amber-400" : ""}`} /></Button>}
              {isOwn && onEdit && <Button size="sm" variant="ghost" className="h-7 w-7 p-0 rounded-full" onClick={onEdit} title="Edit"><Edit className="w-3.5 h-3.5" /></Button>}
              {isOwn && onDelete && <Button size="sm" variant="ghost" className="h-7 w-7 p-0 rounded-full" onClick={onDelete} title="Delete"><Trash2 className="w-3.5 h-3.5 text-rose-400" /></Button>}
            </div>
          )}

          {/* Emoji picker */}
          {emojiOpen && (
            <div className={`absolute top-full mt-1 ${isOwn ? "right-0" : "left-0"} bg-card border rounded-xl shadow-2xl p-2 grid grid-cols-6 gap-1 z-20`}>
              {COMMON_EMOJIS.map(em => <button key={em} onClick={() => onReact(em)} className="text-lg hover:bg-muted/60 rounded-lg p-1 transition">{em}</button>)}
              <button onClick={onCloseEmoji} className="col-span-6 text-[10px] text-muted-foreground hover:underline mt-1">Close</button>
            </div>
          )}
        </div>

        {/* Reactions */}
        {msg.reactions && Object.keys(msg.reactions).length > 0 && (
          <div className={`flex gap-1 mt-1 flex-wrap ${isOwn ? "justify-end" : "justify-start"}`}>
            {Object.entries(msg.reactions).map(([emoji, users]) => (
              <button key={emoji} onClick={() => onReact && onReact(emoji)} className="text-xs bg-card hover:bg-card/80 border rounded-full px-2 py-0.5 shadow-sm transition">{emoji} <span className="text-muted-foreground">{users.length}</span></button>
            ))}
          </div>
        )}

        {/* Thread count */}
        {msg.thread_count > 0 && !compact && (
          <button onClick={onThread} className={`mt-1 text-[11px] text-cyan-400 hover:underline flex items-center gap-1 ${isOwn ? "self-end" : ""}`}><CornerDownRight className="w-3 h-3" />{msg.thread_count} repl{msg.thread_count === 1 ? "y" : "ies"}</button>
        )}
      </div>
    </div>
  );
}

// ============== New Chat Dialog ==============
function NewChatDialog({ open, onOpenChange, users, headers, currentUserId, onCreated }) {
  const [tab, setTab] = useState("dm");
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [channelName, setChannelName] = useState("");
  const [channelPrivate, setChannelPrivate] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [searchQ, setSearchQ] = useState("");

  useEffect(() => { if (open) { setSelectedUsers([]); setChannelName(""); setGroupName(""); setSearchQ(""); } }, [open]);

  const filteredUsers = users.filter(u => u.id !== currentUserId && (!searchQ || u.name.toLowerCase().includes(searchQ.toLowerCase())));

  const createDM = async () => {
    if (selectedUsers.length !== 1) return toast.error("Select exactly 1 user for a DM");
    try { const r = await axios.post(`${API}/chat/dm/${selectedUsers[0]}`, {}, { headers }); onCreated(r.data); toast.success("DM opened"); }
    catch { toast.error("Failed"); }
  };

  const createGroup = async () => {
    if (selectedUsers.length < 2) return toast.error("Select at least 2 people for a group");
    try { const r = await axios.post(`${API}/chat/group-dm`, { member_ids: selectedUsers, name: groupName || undefined }, { headers }); onCreated(r.data); toast.success("Group chat created"); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const createChannel = async () => {
    if (!channelName.trim()) return toast.error("Channel name required");
    try { const r = await axios.post(`${API}/chat/channels`, { name: channelName, is_private: channelPrivate, member_ids: channelPrivate ? selectedUsers : [] }, { headers }); onCreated(r.data); toast.success("Channel created"); }
    catch { toast.error("Failed"); }
  };

  const toggleUser = (id) => setSelectedUsers(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><MessageSquarePlus className="w-5 h-5 text-violet-400" />Start a new chat</DialogTitle>
          <DialogDescription>Direct message a teammate, start a group chat, or create a channel.</DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid grid-cols-3">
            <TabsTrigger value="dm" data-testid="tab-dm"><MessageCircle className="w-3 h-3 mr-1" />DM</TabsTrigger>
            <TabsTrigger value="group" data-testid="tab-group"><Users className="w-3 h-3 mr-1" />Group</TabsTrigger>
            <TabsTrigger value="channel" data-testid="tab-channel"><Hash className="w-3 h-3 mr-1" />Channel</TabsTrigger>
          </TabsList>

          <TabsContent value="dm" className="space-y-3 mt-3">
            <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" /><Input placeholder="Find a teammate..." value={searchQ} onChange={e => setSearchQ(e.target.value)} className="pl-9 rounded-full bg-muted/40 border-0" /></div>
            <ScrollArea className="h-72 -mx-1 px-1"><div className="space-y-1">
              {filteredUsers.map(u => {
                const checked = selectedUsers[0] === u.id;
                return (
                  <button key={u.id} onClick={() => setSelectedUsers([u.id])} className={`w-full flex items-center gap-3 p-2 rounded-lg ${checked ? "bg-violet-500/15 ring-1 ring-violet-500/30" : "hover:bg-muted/40"}`} data-testid={`pick-user-${u.id}`}>
                    <Avatar className="w-9 h-9"><AvatarFallback style={{ backgroundColor: `hsl(${avatarHue(u.name)}, 55%, 40%)`, color: "white", fontSize: 11 }}>{initials(u.name)}</AvatarFallback></Avatar>
                    <div className="flex-1 text-left min-w-0"><p className="text-sm font-medium truncate">{u.name}</p><p className="text-[10px] text-muted-foreground truncate">{u.email}</p></div>
                    {checked && <CheckCheck className="w-4 h-4 text-violet-400" />}
                  </button>
                );
              })}
            </div></ScrollArea>
            <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={createDM} disabled={selectedUsers.length !== 1} data-testid="confirm-dm">Open DM</Button></DialogFooter>
          </TabsContent>

          <TabsContent value="group" className="space-y-3 mt-3">
            <Input placeholder="Group name (optional, auto-generates from members)" value={groupName} onChange={e => setGroupName(e.target.value)} className="rounded-full bg-muted/40 border-0 px-4" data-testid="group-name" />
            <p className="text-xs text-muted-foreground">Select 2+ teammates to start a group chat. They'll all see the messages.</p>
            <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" /><Input placeholder="Search teammates..." value={searchQ} onChange={e => setSearchQ(e.target.value)} className="pl-9 rounded-full bg-muted/40 border-0" /></div>
            <ScrollArea className="h-60 -mx-1 px-1"><div className="space-y-1">
              {filteredUsers.map(u => {
                const checked = selectedUsers.includes(u.id);
                return (
                  <button key={u.id} onClick={() => toggleUser(u.id)} className={`w-full flex items-center gap-3 p-2 rounded-lg ${checked ? "bg-violet-500/15 ring-1 ring-violet-500/30" : "hover:bg-muted/40"}`} data-testid={`pick-group-${u.id}`}>
                    <Avatar className="w-9 h-9"><AvatarFallback style={{ backgroundColor: `hsl(${avatarHue(u.name)}, 55%, 40%)`, color: "white", fontSize: 11 }}>{initials(u.name)}</AvatarFallback></Avatar>
                    <div className="flex-1 text-left min-w-0"><p className="text-sm font-medium truncate">{u.name}</p><p className="text-[10px] text-muted-foreground truncate">{u.email}</p></div>
                    {checked && <div className="w-5 h-5 rounded-full bg-violet-500 flex items-center justify-center"><CheckCheck className="w-3 h-3 text-white" /></div>}
                  </button>
                );
              })}
            </div></ScrollArea>
            <p className="text-[11px] text-muted-foreground text-center">{selectedUsers.length} selected</p>
            <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={createGroup} disabled={selectedUsers.length < 2} data-testid="confirm-group">Create group</Button></DialogFooter>
          </TabsContent>

          <TabsContent value="channel" className="space-y-3 mt-3">
            <Input placeholder="Channel name (e.g. ops, dev, general)" value={channelName} onChange={e => setChannelName(e.target.value.replace(/\s+/g, "-").toLowerCase())} className="rounded-full bg-muted/40 border-0 px-4" data-testid="channel-name-new" />
            <label className="flex items-center gap-2 text-sm cursor-pointer p-2 rounded-lg hover:bg-muted/30">
              <input type="checkbox" checked={channelPrivate} onChange={e => setChannelPrivate(e.target.checked)} className="w-4 h-4" />
              <Lock className="w-3.5 h-3.5" />Private channel (invite-only)
            </label>
            {channelPrivate && (
              <ScrollArea className="h-48 -mx-1 px-1"><div className="space-y-1">
                {filteredUsers.map(u => {
                  const checked = selectedUsers.includes(u.id);
                  return (
                    <button key={u.id} onClick={() => toggleUser(u.id)} className={`w-full flex items-center gap-3 p-2 rounded-lg ${checked ? "bg-violet-500/15" : "hover:bg-muted/40"}`}>
                      <Avatar className="w-7 h-7"><AvatarFallback style={{ backgroundColor: `hsl(${avatarHue(u.name)}, 55%, 40%)`, color: "white", fontSize: 9 }}>{initials(u.name)}</AvatarFallback></Avatar>
                      <span className="text-sm">{u.name}</span>
                      {checked && <CheckCheck className="ml-auto w-4 h-4 text-violet-400" />}
                    </button>
                  );
                })}
              </div></ScrollArea>
            )}
            <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={createChannel} disabled={!channelName.trim()} data-testid="confirm-channel">Create channel</Button></DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
