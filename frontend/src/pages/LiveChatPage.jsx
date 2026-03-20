import { useState, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageSquare, Send, X, Ticket, Plus } from "lucide-react";
import { toast } from "sonner";

export default function LiveChatPage() {
  const { token } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMsg, setNewMsg] = useState("");
  const headers = { Authorization: `Bearer ${token}` };

  const fetchSessions = () => {
    axios.get(`${API}/live-chat/sessions`, { headers }).then(r => setSessions(r.data)).catch(() => {});
  };

  useEffect(() => { fetchSessions(); }, []);

  const loadSession = async (sessionId) => {
    const { data } = await axios.get(`${API}/live-chat/sessions/${sessionId}`, { headers });
    setActiveSession(data.session);
    setMessages(data.messages);
  };

  const sendMessage = async () => {
    if (!newMsg.trim() || !activeSession) return;
    try {
      const { data } = await axios.post(`${API}/live-chat/sessions/${activeSession.id}/messages`, { content: newMsg }, { headers });
      setMessages(prev => [...prev, data]);
      setNewMsg("");
    } catch { toast.error("Failed to send"); }
  };

  const closeSession = async () => {
    if (!activeSession) return;
    await axios.post(`${API}/live-chat/sessions/${activeSession.id}/close`, {}, { headers });
    toast.success("Session closed");
    setActiveSession(null);
    setMessages([]);
    fetchSessions();
  };

  const createTicket = async () => {
    if (!activeSession) return;
    try {
      const { data } = await axios.post(`${API}/live-chat/sessions/${activeSession.id}/create-ticket`, {}, { headers });
      toast.success(`Ticket created: ${data.ticket_id}`);
    } catch { toast.error("Failed"); }
  };

  return (
    <div className="space-y-6" data-testid="live-chat-page">
      <div><h1 className="text-2xl font-bold tracking-tight">Live Chat</h1>
        <p className="text-muted-foreground text-sm mt-1">Real-time chat with clients</p></div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[600px]">
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><MessageSquare className="w-4 h-4" />Sessions ({sessions.length})</CardTitle></CardHeader>
          <CardContent>
            <ScrollArea className="h-[480px]">
              {sessions.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No active chat sessions</p>
              ) : (
                <div className="space-y-2">
                  {sessions.map(s => (
                    <div key={s.id} className={`p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors ${activeSession?.id === s.id ? "border-primary bg-primary/5" : ""}`}
                      onClick={() => loadSession(s.id)} data-testid={`chat-session-${s.id}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{s.visitor_name}</span>
                        <Badge variant={s.status === "active" ? "default" : "outline"} className="text-[10px]">{s.status}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{s.client_name}</p>
                      {s.subject && <p className="text-xs text-muted-foreground truncate">{s.subject}</p>}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2 flex flex-col">
          {activeSession ? (
            <>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">{activeSession.visitor_name}</CardTitle>
                    <p className="text-xs text-muted-foreground">{activeSession.client_name} - {activeSession.subject || "No subject"}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={createTicket} data-testid="create-ticket-from-chat"><Ticket className="w-3 h-3 mr-1" />Create Ticket</Button>
                    <Button size="sm" variant="destructive" onClick={closeSession} data-testid="close-chat"><X className="w-3 h-3 mr-1" />Close</Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col">
                <ScrollArea className="flex-1 mb-3 h-[400px]">
                  <div className="space-y-3 p-2">
                    {messages.map(m => (
                      <div key={m.id} className={`flex ${m.sender_type === "agent" ? "justify-end" : "justify-start"}`} data-testid={`msg-${m.id}`}>
                        <div className={`max-w-[70%] p-3 rounded-lg ${m.sender_type === "agent" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                          <p className="text-xs font-medium mb-0.5">{m.sender_name}</p>
                          <p className="text-sm">{m.content}</p>
                          <p className="text-[10px] opacity-70 mt-1">{new Date(m.sent_at).toLocaleTimeString()}</p>
                        </div>
                      </div>
                    ))}
                    {messages.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No messages yet</p>}
                  </div>
                </ScrollArea>
                <div className="flex gap-2">
                  <Input value={newMsg} onChange={e => setNewMsg(e.target.value)} placeholder="Type a message..."
                    onKeyDown={e => e.key === "Enter" && sendMessage()} data-testid="chat-input" />
                  <Button onClick={sendMessage} data-testid="send-message"><Send className="w-4 h-4" /></Button>
                </div>
              </CardContent>
            </>
          ) : (
            <CardContent className="flex-1 flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-40" />
                <p>Select a chat session to start</p>
              </div>
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}
