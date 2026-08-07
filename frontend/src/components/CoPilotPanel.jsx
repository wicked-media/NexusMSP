import { useState, useRef, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, X, Loader2, Minimize2, Sparkles, Copy, Check, Bot
} from "lucide-react";

// Renders text with code blocks properly formatted
function RenderContent({ content }) {
  const parts = content.split(/(```[\s\S]*?```)/g);
  return (
    <div className="space-y-2">
      {parts.map((part, i) => {
        if (part.startsWith("```")) {
          const lines = part.slice(3, -3).split("\n");
          const lang = lines[0].trim();
          const code = lang ? lines.slice(1).join("\n") : lines.join("\n");
          return (
            <div key={i} className="relative group">
              {lang && <span className="absolute top-1 left-2 text-[9px] text-muted-foreground/60 uppercase">{lang}</span>}
              <pre className="bg-background/80 border rounded-md p-3 pt-5 text-xs font-mono overflow-x-auto whitespace-pre-wrap"><code>{code}</code></pre>
              <button className="absolute top-1 right-1 p-1 rounded bg-muted/80 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(code); }}>
                <Copy className="w-3 h-3" />
              </button>
            </div>
          );
        }
        // Render inline code with backticks
        const inlineParts = part.split(/(`[^`]+`)/g);
        return (
          <div key={i} className="whitespace-pre-wrap break-words">
            {inlineParts.map((ip, j) => {
              if (ip.startsWith("`") && ip.endsWith("`")) {
                return <code key={j} className="bg-background/80 border px-1 py-0.5 rounded text-xs font-mono">{ip.slice(1, -1)}</code>;
              }
              return <span key={j}>{ip}</span>;
            })}
          </div>
        );
      })}
    </div>
  );
}

export default function CoPilotPanel({ ticket, device }) {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId] = useState(() => `copilot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const [copied, setCopied] = useState(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (open && !minimized && inputRef.current) inputRef.current.focus();
  }, [open, minimized]);

  // Auto-greet on first open
  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([{
        role: "assistant",
        content: `I'm your Co-Pilot for this ticket. I can help you:\n- Diagnose issues and suggest fixes\n- Draft customer replies\n- Find relevant KB articles\n- Recommend scripts to run\n\nWhat do you need help with?`,
      }]);
    }
  }, [open, messages.length]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: userMsg }]);
    setLoading(true);
    try {
      const res = await axios.post(`${API}/ai/copilot`, {
        message: userMsg,
        session_id: sessionId,
        ticket_context: {
          title: ticket?.title || "",
          description: ticket?.description || "",
          client_name: ticket?.client_name || "",
          category: ticket?.category || "",
          priority: ticket?.priority || "",
          device_name: device?.name || "",
          device_status: device?.status || "",
        },
      }, { headers });
      setMessages(prev => [...prev, { role: "assistant", content: res.data.response }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Sorry, I couldn't process that. Please try again." }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const copyText = (text, idx) => {
    navigator.clipboard.writeText(text);
    setCopied(idx);
    setTimeout(() => setCopied(null), 2000);
  };

  const quickActions = [
    { label: "Diagnose this issue", msg: "What could be causing this issue and how should I fix it?" },
    { label: "Draft a reply", msg: "Draft a professional customer reply updating them on the ticket status." },
    { label: "Find KB articles", msg: "Are there any knowledge base articles related to this issue?" },
    { label: "Suggest scripts", msg: "What scripts or commands should I run to troubleshoot this?" },
  ];

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} className="fixed bottom-16 right-6 h-12 w-12 rounded-full shadow-lg bg-purple-600 hover:bg-purple-700 z-[100]"
        data-testid="copilot-toggle">
        <Bot className="w-5 h-5" />
      </Button>
    );
  }

  if (minimized) {
    return (
      <div className="fixed bottom-16 right-6 z-[100] flex items-center gap-2 bg-card border rounded-full px-4 py-2 shadow-lg cursor-pointer"
        onClick={() => setMinimized(false)} data-testid="copilot-minimized">
        <Bot className="w-4 h-4 text-purple-400" />
        <span className="text-sm font-medium">Co-Pilot</span>
        {loading && <Loader2 className="w-3 h-3 animate-spin text-purple-400" />}
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 ml-1" onClick={e => { e.stopPropagation(); setOpen(false); setMinimized(false); }}>
          <X className="w-3 h-3" />
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-16 right-6 w-[400px] h-[520px] bg-card border rounded-xl shadow-2xl z-[100] flex flex-col overflow-hidden"
      data-testid="copilot-panel">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b bg-purple-600/10">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-purple-400" />
          <span className="font-semibold text-sm">Technician Co-Pilot</span>
          <Badge className="bg-purple-500/20 text-purple-300 text-[9px] border-purple-500/30">AI</Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setMinimized(true)}>
            <Minimize2 className="w-3 h-3" />
          </Button>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => { setOpen(false); setMinimized(false); }}>
            <X className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 px-3 py-2" ref={scrollRef}>
        <div className="space-y-3">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                msg.role === "user"
                  ? "bg-purple-600/20 text-foreground"
                  : "bg-muted/50 text-foreground"
              }`}>
                <RenderContent content={msg.content} />
                {msg.role === "assistant" && (
                  <Button variant="ghost" size="sm" className="h-5 px-1 mt-1 text-[9px] text-muted-foreground"
                    onClick={() => copyText(msg.content, i)}>
                    {copied === i ? <Check className="w-2.5 h-2.5 mr-0.5" /> : <Copy className="w-2.5 h-2.5 mr-0.5" />}
                    {copied === i ? "Copied" : "Copy"}
                  </Button>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-muted/50 rounded-lg px-3 py-2 flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin text-purple-400" />
                <span className="text-xs text-muted-foreground">Thinking...</span>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Quick Actions */}
      {messages.length <= 1 && (
        <div className="px-3 pb-1 flex flex-wrap gap-1">
          {quickActions.map((qa, i) => (
            <Button key={i} variant="outline" size="sm" className="h-6 text-[10px] rounded-full border-purple-500/20 text-purple-300 hover:bg-purple-500/10"
              onClick={() => { setInput(qa.msg); }} data-testid={`quick-action-${i}`}>
              <Sparkles className="w-2.5 h-2.5 mr-1" />{qa.label}
            </Button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="p-3 pt-1 border-t">
        <div className="flex items-center gap-2">
          <Input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown} placeholder="Ask anything..." className="h-9 text-sm"
            data-testid="copilot-input" />
          <Button size="sm" className="h-9 w-9 p-0 bg-purple-600 hover:bg-purple-700"
            onClick={sendMessage} disabled={!input.trim() || loading} data-testid="copilot-send">
            <Send className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
