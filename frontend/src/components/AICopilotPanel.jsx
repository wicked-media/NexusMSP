import { useState, useRef, useEffect, useCallback } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Bot, Send, Loader2, X, Minimize2, Maximize2, Sparkles, MessageSquare, Lightbulb } from "lucide-react";

export function AICopilotPanel({ isOpen, onClose }) {
  const { token } = useAuth();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId] = useState(() => Math.random().toString(36).slice(2, 10));
  const [suggestions, setSuggestions] = useState([]);
  const [minimized, setMinimized] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    if (isOpen) {
      axios.get(`${API}/copilot/suggestions`, { headers }).then(r => setSuggestions(r.data)).catch(() => {});
      inputRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const sendMessage = async (text) => {
    const msg = text || input.trim();
    if (!msg) return;
    setInput("");
    setMessages(prev => [...prev, { role: "user", text: msg }]);
    setLoading(true);
    try {
      const res = await axios.post(`${API}/copilot/chat`, { message: msg, session_id: sessionId }, { headers });
      setMessages(prev => [...prev, { role: "assistant", text: res.data.reply }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", text: "Sorry, I encountered an error." }]);
    }
    setLoading(false);
  };

  if (!isOpen) return null;
  if (minimized) return (
    <div className="fixed bottom-4 right-4 z-50">
      <Button onClick={() => setMinimized(false)} className="rounded-full w-14 h-14 shadow-2xl bg-primary" data-testid="copilot-expand">
        <Bot className="w-6 h-6" />
      </Button>
    </div>
  );

  return (
    <div className="fixed right-0 top-0 h-full w-[380px] bg-background border-l border-border shadow-2xl z-50 flex flex-col" data-testid="copilot-panel">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-primary/5">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
            <Bot className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-bold">NexusOps AI</p>
            <p className="text-[10px] text-muted-foreground">Your MSP copilot</p>
          </div>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setMinimized(true)}><Minimize2 className="w-3 h-3" /></Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} data-testid="copilot-close"><X className="w-3 h-3" /></Button>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 px-4 py-3">
        {messages.length === 0 && (
          <div className="text-center py-8 space-y-4">
            <Sparkles className="w-10 h-10 mx-auto text-primary/40" />
            <p className="text-sm text-muted-foreground">Ask me anything about your MSP</p>
            <div className="space-y-2">
              {suggestions.map((s, i) => (
                <button key={i} onClick={() => sendMessage(s.text)}
                  className="w-full text-left text-xs p-2.5 rounded-lg bg-muted/30 hover:bg-muted/50 border border-border/30 transition-all flex items-center gap-2"
                  data-testid={`copilot-suggestion-${i}`}>
                  <Lightbulb className="w-3 h-3 text-amber-400 flex-shrink-0" />
                  {s.text}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`mb-3 flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] px-3 py-2 rounded-xl text-sm leading-relaxed ${
              m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted/40 border border-border/30"}`}>
              <p className="whitespace-pre-wrap">{m.text}</p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start mb-3">
            <div className="px-3 py-2 rounded-xl bg-muted/40 border border-border/30">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />Thinking...
              </div>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </ScrollArea>

      {/* Input */}
      <div className="p-3 border-t border-border">
        <form onSubmit={(e) => { e.preventDefault(); sendMessage(); }} className="flex gap-2">
          <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
            placeholder="Ask about tickets, clients, devices..."
            className="flex-1 bg-muted/30 border border-border/30 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary/50 transition-colors"
            disabled={loading} data-testid="copilot-input" />
          <Button type="submit" size="icon" disabled={loading || !input.trim()} className="shrink-0" data-testid="copilot-send">
            <Send className="w-4 h-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}
