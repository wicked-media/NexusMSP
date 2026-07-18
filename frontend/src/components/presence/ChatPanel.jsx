import { useState, useEffect, useRef, useMemo } from "react";
import axios from "axios";
import { useLocation, useNavigate } from "react-router-dom";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PresenceDot } from "./PresenceDot";
import { MessageCircle, X, Send, Hash, Users, Maximize2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

const SHORTCUT = "c";

export function ChatPanel() {
  const { token, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [channels, setChannels] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [presence, setPresence] = useState([]);
  const [unread, setUnread] = useState({});
  const [showDirectory, setShowDirectory] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef(null);

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  // Load channels + presence + unread (polled)
  useEffect(() => {
    if (!token) return;
    let alive = true;
    const load = async () => {
      try {
        const [chs, pr, un] = await Promise.all([
          axios.get(`${API}/chat/channels-preview`, { headers }).then(r => r.data),
          axios.get(`${API}/presence`, { headers }).then(r => r.data),
          axios.get(`${API}/chat/unread`, { headers }).then(r => r.data),
        ]);
        if (!alive) return;
        setChannels(chs); setPresence(pr.users || []); setUnread(un); setError("");
        setActiveId(current => current && chs.some(channel => channel.id === current) ? current : chs[0]?.id || null);
      } catch (_) { setError("Quick chat is unavailable."); }
    };
    load();
    const t = setInterval(load, 8000);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line
  }, [token]);

  // Poll messages
  useEffect(() => {
    if (!activeId || !token) return;
    let alive = true;
    const fetchMsgs = async () => {
      try {
        const r = await axios.get(`${API}/chat/channels/${activeId}/messages`, { headers });
        if (!alive) return;
        setMessages(r.data || []);
        // mark read
        axios.post(`${API}/chat/channels/${activeId}/read`, {}, { headers }).catch(() => {});
        setTimeout(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, 50);
      } catch (_) {}
    };
    fetchMsgs();
    const t = setInterval(fetchMsgs, 3500);
    return () => { alive = false; clearInterval(t); };
  }, [activeId, token, headers]);

  // Ctrl/Cmd + Shift + C toggles quick chat without conflicting with global search.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === SHORTCUT && !["INPUT", "TEXTAREA"].includes(e.target.tagName)) {
        e.preventDefault();
        setOpen(v => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const send = async () => {
    const body = input.trim();
    if (!body || !activeId) return;
    setInput("");
    try {
      if (body.startsWith("/")) {
        await axios.post(`${API}/chat/slash`, { channel_id: activeId, raw: body }, { headers });
      } else {
        await axios.post(`${API}/chat/channels/${activeId}/messages`, { body }, { headers });
      }
      const r = await axios.get(`${API}/chat/channels/${activeId}/messages`, { headers });
      setMessages(r.data || []);
      setTimeout(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, 50);
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
  };

  const startDM = async (otherId) => {
    try {
      const r = await axios.post(`${API}/chat/dm/${otherId}`, {}, { headers });
      const ch = r.data;
      setChannels(prev => prev.find(c => c.id === ch.id) ? prev : [...prev, ch]);
      setActiveId(ch.id);
      setShowDirectory(false);
    } catch (e) { toast.error(e.response?.data?.detail || e.message); }
  };

  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);
  const presenceById = useMemo(() => {
    const m = {};
    presence.forEach(p => { m[p.user_id] = p; });
    return m;
  }, [presence]);

  if (!token || location.pathname === "/team-chat") return null;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-4 z-50 bg-violet-600 hover:bg-violet-500 rounded-full w-12 h-12 flex items-center justify-center shadow-lg shadow-violet-500/40 transition-transform hover:scale-110"
        data-testid="chat-toggle-btn"
      >
        <MessageCircle className="w-5 h-5 text-white" />
        {totalUnread > 0 && (
          <span className="absolute -top-1 -right-1 bg-rose-500 rounded-full text-[10px] px-1.5 py-0.5 text-white font-bold">{totalUnread}</span>
        )}
      </button>
    );
  }

  const activeCh = channels.find(c => c.id === activeId);
  const myPresence = presenceById[user?.id];

  return (
    <div className="fixed bottom-20 right-4 z-50 w-[640px] max-w-[95vw] h-[560px] max-h-[85vh] bg-background border border-border rounded-lg shadow-2xl shadow-violet-500/10 flex overflow-hidden" data-testid="chat-panel">
      {/* Sidebar */}
      <div className="w-44 border-r border-border bg-muted/20 flex flex-col">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <div><div className="text-xs font-semibold uppercase tracking-widest text-violet-400">Quick chat</div><div className="text-[9px] text-muted-foreground">Ctrl+Shift+C</div></div>
          <PresenceDot led={myPresence?.led || "offline"} size={8} />
        </div>
        <ScrollArea className="flex-1">
          <div className="px-2 py-2 text-[10px] uppercase tracking-widest text-muted-foreground">Channels</div>
          {channels.filter(c => c.kind === "team").map(c => (
            <button key={c.id}
              onClick={() => setActiveId(c.id)}
              className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 ${activeId === c.id ? "bg-violet-500/10 text-violet-400" : "hover:bg-muted/40"}`}
              data-testid={`channel-${c.name}`}
            >
              <Hash className="w-3 h-3" />{c.display_name || c.name}
              {unread[c.id] > 0 && <Badge variant="outline" className="ml-auto text-[9px] text-rose-400 border-rose-500/40 px-1">{unread[c.id]}</Badge>}
            </button>
          ))}
          <div className="px-2 py-2 text-[10px] uppercase tracking-widest text-muted-foreground mt-2 flex items-center justify-between">
            <span>DMs</span>
            <button onClick={() => setShowDirectory(v => !v)} className="text-violet-400 hover:underline">+ new</button>
          </div>
          {channels.filter(c => c.kind !== "team").map(c => (
            <button key={c.id}
              onClick={() => setActiveId(c.id)}
              className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 ${activeId === c.id ? "bg-violet-500/10 text-violet-400" : "hover:bg-muted/40"}`}
            >
              <Users className="w-3 h-3" />{c.display_name || c.name}
              {unread[c.id] > 0 && <Badge variant="outline" className="ml-auto text-[9px] text-rose-400 border-rose-500/40 px-1">{unread[c.id]}</Badge>}
            </button>
          ))}
          {showDirectory && (
            <div className="border-t border-border mt-2 pt-2">
              <div className="px-2 text-[10px] uppercase text-muted-foreground mb-1">Team</div>
              {presence.filter(p => p.user_id !== user?.id).map(p => (
                <button key={p.user_id} onClick={() => startDM(p.user_id)} className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-muted/40" data-testid={`dm-with-${p.user_id}`}>
                  <PresenceDot led={p.led} size={6} />{p.user_name}
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <div className="font-semibold text-sm flex items-center gap-2 truncate">
            {activeCh?.kind === "dm" ? <Users className="w-3.5 h-3.5" /> : <Hash className="w-3.5 h-3.5" />}
            {activeCh?.display_name || activeCh?.name}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setOpen(false); navigate("/team-chat"); }} title="Open Team Chat"><Maximize2 className="w-3.5 h-3.5" /></Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setOpen(false)} data-testid="chat-close-btn"><X className="w-3.5 h-3.5" /></Button>
          </div>
        </div>

        {error && <div className="mx-3 mt-3 flex items-center gap-2 rounded border border-rose-500/20 bg-rose-500/10 p-2 text-[10px] text-rose-300"><AlertCircle className="h-3 w-3" />{error}</div>}

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
          {messages.length === 0 && <div className="text-center text-xs text-muted-foreground py-8">No messages yet. Type / for slash commands.</div>}
          {messages.map(m => {
            const isMine = m.user_id === user?.id;
            const isSystem = m.is_system;
            return (
              <div key={m.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`} data-testid={`msg-${m.id}`}>
                <div className={`max-w-[80%] rounded-lg px-3 py-1.5 text-xs ${isSystem ? "bg-violet-500/10 text-violet-400 border border-violet-500/30 italic" : isMine ? "bg-violet-600 text-white" : "bg-muted/50 text-foreground"}`}>
                  {!isMine && !isSystem && <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">{m.user_name}</div>}
                  <div className="whitespace-pre-wrap break-words">{m.body}</div>
                  <div className={`text-[9px] mt-0.5 ${isMine ? "text-violet-200" : "text-muted-foreground"}`}>{(m.ts || "").slice(11, 16)}</div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="p-2 border-t border-border flex gap-2">
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={input.startsWith("/") ? "Slash command — try /help" : "Message or /command"}
            className="text-xs h-8"
            data-testid="chat-input"
          />
          <Button onClick={send} size="sm" className="h-8" data-testid="chat-send-btn"><Send className="w-3.5 h-3.5" /></Button>
        </div>
      </div>
    </div>
  );
}
