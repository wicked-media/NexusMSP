import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog } from "@/components/ui/dialog";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { toast } from "sonner";
import { 
  MessageSquare,
  Send,
  Terminal,
  FileUp,
  Trash2,
  Monitor,
  User,
  Bot,
  ArrowLeft,
  RefreshCw,
  Loader2,
  Command
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";

const MessageBubble = ({ message, isOwn }) => {
  const getIcon = () => {
    if (message.message_type === 'command') return <Terminal className="w-4 h-4" />;
    if (message.message_type === 'file') return <FileUp className="w-4 h-4" />;
    if (message.message_type === 'system') return <Bot className="w-4 h-4" />;
    return <User className="w-4 h-4" />;
  };

  const getBgColor = () => {
    if (message.message_type === 'command') return 'bg-yellow-500/10 border-yellow-500/20';
    if (message.message_type === 'system') return 'bg-blue-500/10 border-blue-500/20';
    if (message.direction === 'inbound') return 'bg-muted';
    return 'bg-primary/10 border-primary/20';
  };

  return (
    <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'} mb-3`}>
      <div className={`max-w-[80%] rounded-lg p-3 border ${getBgColor()}`}>
        <div className="flex items-center gap-2 mb-1">
          {getIcon()}
          <span className="text-xs font-medium">{message.user_name}</span>
          {message.message_type !== 'text' && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {message.message_type}
            </Badge>
          )}
        </div>
        <p className={`text-sm ${message.message_type === 'command' ? 'font-mono' : ''}`}>
          {message.message}
        </p>
        {message.metadata?.filename && (
          <div className="mt-2 p-2 bg-background rounded text-xs">
            📎 {message.metadata.filename}
          </div>
        )}
        <p className="text-[10px] text-muted-foreground mt-1">
          {formatDistanceToNow(new Date(message.created_at), { addSuffix: true })}
        </p>
      </div>
    </div>
  );
};

export default function DeviceChatPage() {
  const { token, user } = useAuth();
  const { deviceId } = useParams();
  const navigate = useNavigate();
  const [device, setDevice] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [activeTab, setActiveTab] = useState("chat");
  const [commandInput, setCommandInput] = useState("");
  const [commandConfirmationOpen, setCommandConfirmationOpen] = useState(false);
  const [clearConfirmationOpen, setClearConfirmationOpen] = useState(false);
  const messagesEndRef = useRef(null);

  const headers = { Authorization: `Bearer ${token}` };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const fetchChat = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/devices/${deviceId}/chat`, { headers });
      setDevice(response.data.device);
      setMessages(response.data.messages);
    } catch (error) {
      toast.error("Failed to load chat");
    } finally {
      setLoading(false);
    }
  };

  // fetchChat is intentionally invoked only when the route device changes.
  useEffect(() => {
    if (deviceId) {
      fetchChat();
    }
  }, [deviceId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async (e) => {
    e?.preventDefault();
    if (!newMessage.trim()) return;

    setSending(true);
    try {
      await axios.post(`${API}/devices/${deviceId}/chat`, {
        message: newMessage,
        message_type: "text"
      }, { headers });
      setNewMessage("");
      fetchChat();
    } catch (error) {
      toast.error("Failed to send message");
    } finally {
      setSending(false);
    }
  };

  const sendCommand = async (e) => {
    e?.preventDefault();
    if (!commandInput.trim()) return;

    setSending(true);
    try {
      await axios.post(`${API}/devices/${deviceId}/chat/command?command=${encodeURIComponent(commandInput)}`, {}, { headers });
      setCommandInput("");
      setCommandConfirmationOpen(false);
      fetchChat();
      toast.success("Command sent");
    } catch (error) {
      toast.error("Failed to send command");
    } finally {
      setSending(false);
    }
  };

  const clearChat = async () => {
    try {
      await axios.delete(`${API}/devices/${deviceId}/chat`, { headers });
      setMessages([]);
      setClearConfirmationOpen(false);
      toast.success("Chat cleared");
    } catch (error) {
      toast.error("Failed to clear chat");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="device-chat-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
              device?.status === 'online' ? 'bg-green-500/10' : 'bg-red-500/10'
            }`}>
              <Monitor className={`w-5 h-5 ${device?.status === 'online' ? 'text-green-500' : 'text-red-500'}`} />
            </div>
            <div>
              <h1 className="text-xl font-bold">{device?.name}</h1>
              <p className="text-sm text-muted-foreground">{device?.client_name} • {device?.ip_address}</p>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchChat}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => setClearConfirmationOpen(true)}>
            <Trash2 className="w-4 h-4 mr-2" />
            Clear transcript
          </Button>
        </div>
      </div>

      {/* Chat Card */}
      <Card className="h-[calc(100vh-220px)]">
        <CardHeader className="pb-2">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="chat" className="gap-2">
                <MessageSquare className="w-4 h-4" />
                Chat
              </TabsTrigger>
              <TabsTrigger value="commands" className="gap-2">
                <Terminal className="w-4 h-4" />
                Commands
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent className="flex flex-col h-[calc(100%-80px)]">
          {/* Messages Area */}
          <ScrollArea className="flex-1 pr-4">
            {messages.length > 0 ? (
              <div className="space-y-1 py-4">
                {messages.map(msg => (
                  <MessageBubble 
                    key={msg.id} 
                    message={msg} 
                    isOwn={msg.user_id === user?.id && msg.direction === 'outbound'}
                  />
                ))}
                <div ref={messagesEndRef} />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <MessageSquare className="w-12 h-12 mb-4 opacity-50" />
                <p>No messages yet</p>
                <p className="text-sm">Start a conversation with this device</p>
              </div>
            )}
          </ScrollArea>

          {/* Input Area */}
          <div className="pt-4 border-t">
            {activeTab === 'chat' ? (
              <form onSubmit={sendMessage} className="flex gap-2">
                <Input
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Type a message..."
                  className="flex-1"
                  disabled={sending}
                  data-testid="chat-input"
                />
                <Button type="submit" disabled={sending || !newMessage.trim()}>
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </Button>
              </form>
            ) : (
              <form onSubmit={sendCommand} className="space-y-3">
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <Command className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      value={commandInput}
                      onChange={(e) => setCommandInput(e.target.value)}
                      placeholder="Enter command (e.g., systeminfo, ipconfig)"
                      className="pl-9 font-mono"
                      disabled={sending}
                      data-testid="command-input"
                    />
                  </div>
                  <Button type="button" onClick={() => setCommandConfirmationOpen(true)} disabled={sending || !commandInput.trim()}>
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Review command"}
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setCommandInput("systeminfo")}>
                    systeminfo
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setCommandInput("ipconfig /all")}>
                    ipconfig
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setCommandInput("tasklist")}>
                    tasklist
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setCommandInput("netstat -an")}>
                    netstat
                  </Button>
                </div>
              </form>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={commandConfirmationOpen} onOpenChange={setCommandConfirmationOpen}>
        <NexusWorkflowDialog
          eyebrow="Device operations"
          title="Review device command"
          description="Confirm the exact command before Nexus sends it to the device agent. The request and resulting output remain in this device timeline."
          icon={Terminal}
          tone="amber"
          footer={<><Button variant="outline" onClick={() => setCommandConfirmationOpen(false)}>Cancel</Button><Button onClick={sendCommand} disabled={!commandInput.trim() || sending} data-testid="confirm-device-command"><Terminal className="mr-2 h-4 w-4" />{sending ? "Sending…" : "Send to device"}</Button></>}
        >
          <div className="space-y-3"><div className="rounded-xl border border-amber-400/20 bg-black/25 p-4"><p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-300">Command</p><code className="block whitespace-pre-wrap break-words font-mono text-sm text-foreground">{commandInput}</code></div><p className="text-xs leading-5 text-muted-foreground">Only use commands that are safe for this client and ticket context. For a high-impact change, create an approved change first.</p></div>
        </NexusWorkflowDialog>
      </Dialog>

      <Dialog open={clearConfirmationOpen} onOpenChange={setClearConfirmationOpen}>
        <NexusWorkflowDialog
          eyebrow="Device operations"
          title="Clear device transcript?"
          description="This removes the chat history shown in Nexus for this endpoint. It cannot be restored from this workspace."
          icon={Trash2}
          tone="amber"
          footer={<><Button variant="outline" onClick={() => setClearConfirmationOpen(false)}>Keep transcript</Button><Button variant="destructive" onClick={clearChat} data-testid="confirm-clear-device-chat"><Trash2 className="mr-2 h-4 w-4" />Clear transcript</Button></>}
        >
          <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-4 text-sm leading-6 text-muted-foreground">Consider preserving command output and technician instructions in the related ticket before removing the device conversation.</div>
        </NexusWorkflowDialog>
      </Dialog>
    </div>
  );
}
