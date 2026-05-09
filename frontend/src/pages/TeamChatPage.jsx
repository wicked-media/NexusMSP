import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Hash, Lock, Plus, Send, Search, Smile, Paperclip, Pin, Trash2,
  Edit, MessageSquare, Users, X, ChevronDown, ChevronRight,
  AtSign, Reply, MoreHorizontal, Image as ImageIcon, FileText, CornerDownRight, Loader2
} from "lucide-react";

const COMMON_EMOJIS = ["👍", "❤️", "🎉", "🚀", "✅", "🔥", "👏", "😂", "😮", "🙏", "💯", "👀"];

export default function TeamChatPage() {
  const { token, user } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const [channels, setChannels] = useState([]);
  const [users, setUsers] = useState([]);
  const [presence, setPresence] = useState({});
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState(null);
  const [pinned, setPinned] = useState([]);
  const [showPinned, setShowPinned] = useState(false);
  const [thread, setThread] = useState(null);
  const [threadInput, setThreadInput] = useState("");
  const [showNewChannel, setShowNewChannel] = useState(false);
  const [newChannel, setNewChannel] = useState({ name: "", is_private: false });
  const [emojiTarget, setEmojiTarget] = useState(null); // {msgId} for picker
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState("");
  const [typingUsers, setTypingUsers] = useState([]);
  const [showMembers, setShowMembers] = useState(false);
  const fileRef = useRef(null);
  const scrollRef = useRef(null);

  const activeChannel = channels.find(c => c.id === activeId);

  // Initial load
  useEffect(() => {
    if (!token) return;
    let alive = true;
    const load = async () => {
      try {
        const [chs, pr, us] = await Promise.all([
          axios.get(`${API}/chat/channels`, { headers }).then(r => r.data),
          axios.get(`${API}/presence`, { headers }).then(r => r.data),
          axios.get(`${API}/technicians`, { headers }).then(r => r.data).catch(() => []),
        ]);
        if (!alive) return;
        setChannels(chs || []);
        setPresence(Object.fromEntries((pr.users || []).map(u => [u.user_id, u.status])));
        setUsers(us || []);
        if (!activeId && chs.length > 0) setActiveId(chs[0].id);
      } catch (e) { /* ignore */ }
    };
    load();
    const t = setInterval(load, 8000);
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
    const t = setInterval(refreshMessages, 4000);
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
    try {
      await axios.post(`${API}/chat/channels/${activeId}/messages`, { body }, { headers });
      refreshMessages();
    } catch (e) { toast.error("Send failed"); setInput(body); }
  };

  const sendTyping = useCallback(() => {
    if (activeId) axios.post(`${API}/chat/channels/${activeId}/typing`, {}, { headers }).catch(() => {});
  }, [activeId, headers]);

  const sendThread = async () => {
    const body = threadInput.trim();
    if (!body || !thread) return;
    setThreadInput("");
    try {
      await axios.post(`${API}/chat/messages/${thread.parent.id}/reply`, { body }, { headers });
      const r = await axios.get(`${API}/chat/messages/${thread.parent.id}/thread`, { headers });
      setThread(r.data);
      refreshMessages();
    } catch { toast.error("Reply failed"); }
  };

  const openThread = async (msg) => {
    try {
      const r = await axios.get(`${API}/chat/messages/${msg.id}/thread`, { headers });
      setThread(r.data);
    } catch { toast.error("Thread load failed"); }
  };

  const toggleReaction = async (msgId, emoji) => {
    try {
      const r = await axios.post(`${API}/chat/messages/${msgId}/reactions`, { emoji }, { headers });
      // Update locally
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, reactions: r.data.reactions } : m));
      if (thread?.parent.id === msgId) setThread(t => ({ ...t, parent: { ...t.parent, reactions: r.data.reactions } }));
      setEmojiTarget(null);
    } catch { toast.error("Reaction failed"); }
  };

  const startEdit = (msg) => { setEditingId(msg.id); setEditingText(msg.body); };
  const saveEdit = async () => {
    try {
      await axios.put(`${API}/chat/messages/${editingId}`, { body: editingText }, { headers });
      setEditingId(null);
      refreshMessages();
    } catch { toast.error("Edit failed"); }
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
      try {
        await axios.post(`${API}/chat/channels/${activeId}/upload`, { filename: file.name, content_type: file.type, base64: b64 }, { headers });
        refreshMessages();
        toast.success(`Uploaded ${file.name}`);
      } catch { toast.error("Upload failed"); }
    };
    reader.readAsDataURL(file);
  };

  const createChannel = async () => {
    if (!newChannel.name.trim()) return;
    try {
      const r = await axios.post(`${API}/chat/channels`, newChannel, { headers });
      toast.success("Channel created");
      setShowNewChannel(false);
      setNewChannel({ name: "", is_private: false });
      setChannels(prev => [r.data, ...prev]);
      setActiveId(r.data.id);
    } catch { toast.error("Create failed"); }
  };

  const startDM = async (otherId) => {
    try {
      const r = await axios.post(`${API}/chat/dm/${otherId}`, {}, { headers });
      setActiveId(r.data.id);
      setChannels(prev => prev.find(c => c.id === r.data.id) ? prev : [r.data, ...prev]);
    } catch { toast.error("DM failed"); }
  };

  const doSearch = async () => {
    if (!search.trim()) { setSearchResults(null); return; }
    try {
      const r = await axios.get(`${API}/chat/search`, { headers, params: { q: search } });
      setSearchResults(r.data || []);
    } catch { toast.error("Search failed"); }
  };

  return (
    <div className="h-[calc(100vh-60px)] flex bg-background" data-testid="team-chat-page">
      {/* Sidebar */}
      <aside className="w-64 border-r flex flex-col">
        <div className="p-3 border-b">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-sm flex items-center gap-1.5"><MessageSquare className="w-4 h-4 text-violet-400" />Team Chat</h2>
            <Button size="sm" variant="ghost" onClick={() => setShowNewChannel(true)} title="New channel" data-testid="new-channel-btn"><Plus className="w-3.5 h-3.5" /></Button>
          </div>
          <div className="mt-2 relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === "Enter" && doSearch()} placeholder="Search messages..." className="pl-8 h-8 text-xs" data-testid="chat-search" />
          </div>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-0.5">
            <p className="text-[10px] uppercase text-muted-foreground px-2 pb-1 font-semibold">Channels</p>
            {channels.filter(c => !c.is_dm).map(c => (
              <button key={c.id} onClick={() => { setActiveId(c.id); setSearchResults(null); }}
                className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-xs ${activeId === c.id ? "bg-violet-500/15 text-violet-300" : "hover:bg-muted/50"}`}
                data-testid={`channel-${c.id}`}>
                {c.is_private ? <Lock className="w-3 h-3" /> : <Hash className="w-3 h-3" />}
                <span className="truncate flex-1 text-left">{c.name}</span>
              </button>
            ))}
            <p className="text-[10px] uppercase text-muted-foreground px-2 pt-3 pb-1 font-semibold">Direct Messages</p>
            {channels.filter(c => c.is_dm).map(c => (
              <button key={c.id} onClick={() => { setActiveId(c.id); setSearchResults(null); }}
                className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-xs ${activeId === c.id ? "bg-violet-500/15 text-violet-300" : "hover:bg-muted/50"}`}>
                <span className={`w-2 h-2 rounded-full ${presence[c.other_user_id] === "online" ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
                <span className="truncate flex-1 text-left">{c.name}</span>
              </button>
            ))}
            <p className="text-[10px] uppercase text-muted-foreground px-2 pt-3 pb-1 font-semibold">Team</p>
            {users.filter(u => u.id !== user?.id).map(u => (
              <button key={u.id} onClick={() => startDM(u.id)} className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-xs hover:bg-muted/50">
                <span className={`w-2 h-2 rounded-full ${presence[u.id] === "online" ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
                <span className="truncate flex-1 text-left">{u.name}</span>
              </button>
            ))}
          </div>
        </ScrollArea>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Channel header */}
        <div className="px-4 py-2.5 border-b flex items-center gap-2">
          <h2 className="font-semibold flex items-center gap-1.5">
            {activeChannel?.is_dm ? <Users className="w-4 h-4" /> : activeChannel?.is_private ? <Lock className="w-4 h-4" /> : <Hash className="w-4 h-4" />}
            {activeChannel?.name || "—"}
          </h2>
          {activeChannel?.topic && <span className="text-xs text-muted-foreground">| {activeChannel.topic}</span>}
          <div className="ml-auto flex items-center gap-1">
            {pinned.length > 0 && <Button size="sm" variant="ghost" onClick={() => setShowPinned(!showPinned)} className="h-7 text-xs"><Pin className="w-3 h-3 mr-1" />{pinned.length} pinned</Button>}
            <Button size="sm" variant="ghost" onClick={() => setShowMembers(!showMembers)} className="h-7" title="Members"><Users className="w-3.5 h-3.5" /></Button>
          </div>
        </div>

        {/* Pinned strip */}
        {showPinned && pinned.length > 0 && (
          <div className="px-4 py-2 border-b bg-amber-500/[0.04]">
            <p className="text-[10px] uppercase font-semibold text-amber-300 mb-1">Pinned</p>
            <div className="space-y-1 max-h-32 overflow-auto">
              {pinned.map(p => (<div key={p.id} className="text-xs"><strong>{p.user_name}:</strong> {p.body.slice(0, 200)}</div>))}
            </div>
          </div>
        )}

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
          {searchResults ? (
            <div>
              <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold">Search results ({searchResults.length})</h3><Button size="sm" variant="ghost" onClick={() => { setSearchResults(null); setSearch(""); }}><X className="w-3.5 h-3.5" /></Button></div>
              <div className="space-y-2">{searchResults.map(m => (<MessageBubble key={m.id} msg={m} isOwn={m.user_id === user?.id} channels={channels} compact={true} />))}</div>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
              <MessageSquare className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm">No messages yet — say hi 👋</p>
            </div>
          ) : (
            <div className="space-y-1">
              {messages.filter(m => !m.thread_id).map(m => (
                <MessageBubble key={m.id} msg={m} isOwn={m.user_id === user?.id}
                  onReact={(em) => toggleReaction(m.id, em)}
                  onThread={() => openThread(m)}
                  onEdit={() => startEdit(m)}
                  onDelete={() => deleteMsg(m.id)}
                  onPin={() => togglePin(m)}
                  onSetEmojiTarget={() => setEmojiTarget(m.id)}
                  emojiOpen={emojiTarget === m.id}
                  onCloseEmoji={() => setEmojiTarget(null)}
                  editing={editingId === m.id}
                  editingText={editingText} setEditingText={setEditingText}
                  onSaveEdit={saveEdit} onCancelEdit={() => setEditingId(null)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Typing indicator */}
        {typingUsers.length > 0 && (
          <div className="px-4 py-1 text-[11px] italic text-muted-foreground">
            {typingUsers.map(u => u.user_name).join(", ")} {typingUsers.length === 1 ? "is" : "are"} typing…
          </div>
        )}

        {/* Input */}
        <div className="p-3 border-t">
          <div className="flex items-end gap-2">
            <input ref={fileRef} type="file" className="hidden" onChange={onUpload} />
            <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} className="h-9" title="Attach"><Paperclip className="w-4 h-4" /></Button>
            <Input value={input} onChange={e => { setInput(e.target.value); sendTyping(); }} onKeyDown={e => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())} placeholder={`Message ${activeChannel?.name || ""}…  (use @ to mention)`} className="flex-1" data-testid="chat-input" />
            <Button onClick={send} disabled={!input.trim()} data-testid="chat-send"><Send className="w-4 h-4" /></Button>
          </div>
        </div>
      </main>

      {/* Members panel */}
      {showMembers && activeChannel && (
        <aside className="w-56 border-l p-3 overflow-auto">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2">Members</h3>
          <div className="space-y-1">{users.filter(u => !activeChannel.member_ids?.length || activeChannel.member_ids.includes(u.id)).map(u => (
            <div key={u.id} className="flex items-center gap-2 text-xs"><span className={`w-2 h-2 rounded-full ${presence[u.id] === "online" ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />{u.name}</div>
          ))}</div>
        </aside>
      )}

      {/* Thread sidebar */}
      {thread && (
        <aside className="w-96 border-l flex flex-col" data-testid="thread-panel">
          <div className="p-3 border-b flex items-center justify-between"><h3 className="text-sm font-semibold flex items-center gap-1.5"><CornerDownRight className="w-4 h-4" />Thread</h3><Button size="sm" variant="ghost" onClick={() => setThread(null)}><X className="w-3.5 h-3.5" /></Button></div>
          <div className="flex-1 overflow-auto p-3">
            <MessageBubble msg={thread.parent} isOwn={thread.parent.user_id === user?.id} compact />
            <div className="my-3 border-t pt-3 space-y-2">
              {thread.replies.map(r => <MessageBubble key={r.id} msg={r} isOwn={r.user_id === user?.id} compact />)}
            </div>
          </div>
          <div className="p-3 border-t flex gap-2">
            <Input value={threadInput} onChange={e => setThreadInput(e.target.value)} onKeyDown={e => e.key === "Enter" && sendThread()} placeholder="Reply…" data-testid="thread-input" />
            <Button onClick={sendThread} size="sm" data-testid="thread-send"><Send className="w-3.5 h-3.5" /></Button>
          </div>
        </aside>
      )}

      {/* New channel dialog */}
      <Dialog open={showNewChannel} onOpenChange={setShowNewChannel}><DialogContent>
        <DialogHeader><DialogTitle>New Channel</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Channel name (e.g. ops, dev, helpdesk)" value={newChannel.name} onChange={e => setNewChannel({ ...newChannel, name: e.target.value })} data-testid="ch-name-input" />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={newChannel.is_private} onChange={e => setNewChannel({ ...newChannel, is_private: e.target.checked })} />Private channel (invite-only)</label>
        </div>
        <DialogFooter><Button variant="ghost" onClick={() => setShowNewChannel(false)}>Cancel</Button><Button onClick={createChannel} data-testid="confirm-new-channel">Create</Button></DialogFooter>
      </DialogContent></Dialog>
    </div>
  );
}

/* ========== Message Bubble Component ========== */
function MessageBubble({ msg, isOwn, onReact, onThread, onEdit, onDelete, onPin, onSetEmojiTarget, emojiOpen, onCloseEmoji, editing, editingText, setEditingText, onSaveEdit, onCancelEdit, compact }) {
  const [showActions, setShowActions] = useState(false);
  return (
    <div className={`group relative px-2 py-1.5 rounded hover:bg-muted/30 ${msg.deleted ? "opacity-50" : ""} ${msg.pinned ? "border-l-2 border-amber-500/50 bg-amber-500/[0.02]" : ""}`} onMouseEnter={() => setShowActions(true)} onMouseLeave={() => setShowActions(false)}>
      <div className="flex items-baseline gap-2">
        <span className="font-semibold text-sm">{msg.user_name}</span>
        <span className="text-[10px] text-muted-foreground">{msg.ts && new Date(msg.ts).toLocaleString([], { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" })}</span>
        {msg.edited && <span className="text-[10px] text-muted-foreground italic">(edited)</span>}
        {msg.pinned && <Pin className="w-2.5 h-2.5 text-amber-400" />}
      </div>
      {editing ? (
        <div className="mt-1 flex gap-2">
          <Input value={editingText} onChange={e => setEditingText(e.target.value)} className="h-8" />
          <Button size="sm" onClick={onSaveEdit} className="h-8">Save</Button>
          <Button size="sm" variant="ghost" onClick={onCancelEdit} className="h-8">Cancel</Button>
        </div>
      ) : (
        <p className="text-sm whitespace-pre-wrap mt-0.5">{msg.body}</p>
      )}
      {msg.attachment?.is_image && (
        <a href={`${API}/chat/files/${msg.attachment.file_id}`} target="_blank" rel="noopener" className="block mt-2"><div className="text-xs text-cyan-400 underline">📎 {msg.attachment.filename}</div></a>
      )}
      {/* Reactions */}
      {msg.reactions && Object.keys(msg.reactions).length > 0 && (
        <div className="flex gap-1 mt-1 flex-wrap">
          {Object.entries(msg.reactions).map(([emoji, users]) => (
            <button key={emoji} onClick={() => onReact && onReact(emoji)} className="text-xs bg-muted/40 hover:bg-muted/60 rounded-full px-2 py-0.5 border border-border/40">{emoji} {users.length}</button>
          ))}
        </div>
      )}
      {/* Thread count */}
      {msg.thread_count > 0 && !compact && (
        <button onClick={onThread} className="mt-1 text-xs text-cyan-400 hover:underline flex items-center gap-1"><CornerDownRight className="w-3 h-3" />{msg.thread_count} repl{msg.thread_count === 1 ? "y" : "ies"}</button>
      )}
      {/* Actions toolbar */}
      {showActions && !editing && !compact && (
        <div className="absolute top-0 right-2 -translate-y-1/2 flex items-center gap-0.5 bg-card border rounded shadow-md px-1 py-0.5 z-10">
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onSetEmojiTarget} title="React"><Smile className="w-3.5 h-3.5" /></Button>
          {onThread && <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onThread} title="Reply in thread"><Reply className="w-3.5 h-3.5" /></Button>}
          {onPin && <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onPin} title={msg.pinned ? "Unpin" : "Pin"}><Pin className={`w-3.5 h-3.5 ${msg.pinned ? "text-amber-400 fill-amber-400" : ""}`} /></Button>}
          {isOwn && onEdit && <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onEdit} title="Edit"><Edit className="w-3.5 h-3.5" /></Button>}
          {isOwn && onDelete && <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onDelete} title="Delete"><Trash2 className="w-3.5 h-3.5 text-rose-400" /></Button>}
        </div>
      )}
      {/* Emoji picker */}
      {emojiOpen && (
        <div className="absolute top-6 right-2 bg-card border rounded shadow-lg p-2 grid grid-cols-6 gap-1 z-20">
          {COMMON_EMOJIS.map(em => <button key={em} onClick={() => onReact(em)} className="text-lg hover:bg-muted/60 rounded p-1">{em}</button>)}
          <button onClick={onCloseEmoji} className="col-span-6 text-[10px] text-muted-foreground mt-1 hover:underline">Close</button>
        </div>
      )}
    </div>
  );
}
