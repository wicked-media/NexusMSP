import { useState, useEffect, useMemo, useRef } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Mic, MicOff, Send, Loader2, AlertCircle, CheckCircle, MessageSquare, Plus } from "lucide-react";
import OperationalPageHeader from "@/components/OperationalPageHeader";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";

export default function VoiceTicketPage() {
  const { token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const [action, setAction] = useState("create");
  const [ticketId, setTicketId] = useState("");
  const [clientId, setClientId] = useState("");
  const [clients, setClients] = useState([]);
  const [history, setHistory] = useState([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const recognitionRef = useRef(null);

  useEffect(() => {
    axios.get(`${API}/clients`, { headers }).then(r => setClients(r.data)).catch(() => {});
    axios.get(`${API}/voice-ticket/history`, { headers }).then(r => setHistory(r.data)).catch(() => {});
  }, [headers]);

  const toggleRecording = () => {
    if (recording) {
      recognitionRef.current?.stop();
      setRecording(false);
      return;
    }
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
      toast.error("Speech recognition not supported in this browser. Please use Chrome.");
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    let finalTranscript = transcript;
    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript + " ";
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      setTranscript(finalTranscript + interim);
    };
    recognition.onerror = (e) => { toast.error(`Speech error: ${e.error}`); setRecording(false); };
    recognition.onend = () => { setRecording(false); };
    recognitionRef.current = recognition;
    recognition.start();
    setRecording(true);
    toast.success("Listening... Speak now");
  };

  const processVoice = async () => {
    if (!transcript.trim()) return toast.error("No transcript to process");
    setProcessing(true);
    try {
      const selectedClient = clients.find(c => c.id === clientId);
      const res = await axios.post(`${API}/voice-ticket/transcribe`, {
        transcript: transcript.trim(), action, ticket_id: ticketId || undefined,
        client_id: clientId || undefined, client_name: selectedClient?.name || undefined
      }, { headers });
      setResult(res.data);
      setReviewOpen(false);
      if (res.data.action === "ticket_created") {
        toast.success("Ticket created from voice!");
        setTranscript("");
      } else if (res.data.action === "note_added") {
        toast.success("Voice note added to ticket");
        setTranscript("");
      }
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
    finally { setProcessing(false); }
  };

  return (
    <div className="space-y-5" data-testid="voice-ticket-page">
      <OperationalPageHeader eyebrow="Technician capture" title="Voice to Ticket" description="Capture work while it is fresh, then review the transcript and destination before Nexus creates or updates ticket work." icon={Mic} tone="violet" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Main Recording Area */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="border-border/60 shadow-sm">
            <CardContent className="pt-6 space-y-4">
              <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.06] p-3 text-xs text-muted-foreground"><span className="font-semibold text-violet-200">Capture → Review → Commit.</span> Dictate or type the detail first; Nexus only creates work after you confirm the outcome.</div>
              {/* Action selector */}
              <div className="flex items-center gap-3">
                <Select value={action} onValueChange={setAction}>
                  <SelectTrigger className="w-[200px]" data-testid="voice-action"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="create"><Plus className="w-3 h-3 inline mr-1" />Create New Ticket</SelectItem>
                    <SelectItem value="note"><MessageSquare className="w-3 h-3 inline mr-1" />Add Note to Ticket</SelectItem>
                    <SelectItem value="transcribe"><Mic className="w-3 h-3 inline mr-1" />Just Transcribe</SelectItem>
                  </SelectContent>
                </Select>
                {action === "create" && (
                  <Select value={clientId || "none"} onValueChange={v => setClientId(v === "none" ? "" : v)}>
                    <SelectTrigger className="w-[200px]" data-testid="voice-client"><SelectValue placeholder="Select Client" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No Client</SelectItem>
                      {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                {action === "note" && (
                  <Input value={ticketId} onChange={e => setTicketId(e.target.value)} placeholder="Ticket ID" className="w-[200px]" data-testid="voice-ticket-id" />
                )}
              </div>

              {/* Recording button */}
              <div className="flex flex-col items-center py-8">
                <button
                  onClick={toggleRecording}
                  className={`w-28 h-28 rounded-full flex items-center justify-center transition-all ${recording ? "bg-red-500 shadow-lg shadow-red-500/30 animate-pulse" : "bg-primary/10 hover:bg-primary/20 border-2 border-primary/20"}`}
                  data-testid="voice-record-btn"
                >
                  {recording ? <MicOff className="w-10 h-10 text-white" /> : <Mic className="w-10 h-10 text-primary" />}
                </button>
                <p className="text-sm text-muted-foreground mt-3">{recording ? "Recording... Click to stop" : "Click to start recording"}</p>
              </div>

              {/* Transcript */}
              <div>
                <Label className="text-xs text-muted-foreground">Transcript</Label>
                <textarea
                  className="w-full min-h-[120px] rounded-lg border bg-background p-3 text-sm resize-y focus:ring-1 focus:ring-primary"
                  value={transcript}
                  onChange={e => setTranscript(e.target.value)}
                  placeholder="Your speech will appear here... You can also type directly."
                  data-testid="voice-transcript"
                />
              </div>

              {/* Process button */}
              <div className="flex items-center gap-3">
                <Button onClick={() => setReviewOpen(true)} disabled={processing || !transcript.trim()} data-testid="voice-process-btn">
                  <Send className="mr-1.5 h-4 w-4" />Review outcome
                </Button>
                <Button variant="outline" onClick={() => { setTranscript(""); setResult(null); }}>Clear</Button>
              </div>
            </CardContent>
          </Card>

          {/* Result */}
          {result && (
            <Card className={result.action === "ticket_created" ? "border-emerald-500/20 bg-emerald-500/5" : result.action === "note_added" ? "border-blue-500/20 bg-blue-500/5" : ""} data-testid="voice-result">
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-center gap-2">
                  {result.action === "ticket_created" && <><CheckCircle className="w-5 h-5 text-emerald-500" /><p className="font-medium text-emerald-400">Ticket Created</p></>}
                  {result.action === "note_added" && <><CheckCircle className="w-5 h-5 text-blue-500" /><p className="font-medium text-blue-400">Note Added</p></>}
                  {result.action === "transcribed" && <><AlertCircle className="w-5 h-5 text-amber-500" /><p className="font-medium text-amber-400">Transcription Complete</p></>}
                </div>
                {result.ticket && (
                  <div className="p-3 rounded-lg border bg-muted/20">
                    <p className="text-sm font-mono">{result.ticket.ticket_number}</p>
                    <p className="text-sm font-medium">{result.ticket.title}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-[10px] capitalize">{result.ticket.priority}</Badge>
                      <Badge variant="outline" className="text-[10px] capitalize">{result.ticket.category}</Badge>
                    </div>
                  </div>
                )}
                {result.extracted && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>AI Detected:</span>
                    <Badge variant="outline" className="text-[10px]">Priority: {result.extracted.priority}</Badge>
                    <Badge variant="outline" className="text-[10px]">Category: {result.extracted.category}</Badge>
                    {result.confidence && <Badge variant="outline" className="text-[10px]">Confidence: {Math.round(result.confidence * 100)}%</Badge>}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Quick Tips</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <p>Say <strong>"The network is down at Acme Corporation, this is urgent"</strong> and AI will auto-detect:</p>
              <div className="flex items-center gap-2"><Badge variant="outline" className="text-[9px]">Priority: Critical</Badge><Badge variant="outline" className="text-[9px]">Category: Networking</Badge></div>
              <Separator />
              <p>Mention keywords like <strong>printer, VPN, email, security</strong> for auto-categorization</p>
              <p>Use words like <strong>urgent, critical, ASAP</strong> for priority detection</p>
            </CardContent>
          </Card>

          {history.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Recent Voice Notes</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {history.slice(0, 5).map(h => (
                  <div key={h.id} className="p-2 rounded-lg border text-xs">
                    <p className="truncate">{h.content?.replace("[Voice Note] ", "")}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{h.created_at?.split("T")[0]}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <NexusWorkflowDialog eyebrow="Technician capture" title={action === "create" ? "Review ticket from voice" : action === "note" ? "Review ticket note" : "Review transcription"} description="Check the captured detail and where it will be recorded. Nexus keeps the original voice transcript as evidence for the resulting work." icon={Mic} tone="violet" footer={<><Button variant="outline" onClick={() => setReviewOpen(false)}>Keep editing</Button><Button onClick={processVoice} disabled={processing || !transcript.trim() || (action === "note" && !ticketId.trim())} data-testid="confirm-voice-ticket">{processing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}{action === "create" ? "Create ticket" : action === "note" ? "Add note" : "Save transcription"}</Button></>}>
          <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-lg border border-border/60 bg-muted/20 p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Outcome</p><p className="mt-1 text-sm font-medium">{action === "create" ? "Create new ticket" : action === "note" ? `Add note to ${ticketId || "ticket required"}` : "Store transcription"}</p></div><div className="rounded-lg border border-border/60 bg-muted/20 p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Client context</p><p className="mt-1 text-sm font-medium">{clients.find(client => client.id === clientId)?.name || (action === "note" ? "Inferred from ticket" : "No client selected")}</p></div></div><div className="rounded-xl border border-violet-500/20 bg-black/20 p-4"><p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-violet-300">Captured transcript</p><p className="whitespace-pre-wrap text-sm leading-6">{transcript}</p></div>{action === "note" && !ticketId && <p className="rounded-lg border border-amber-500/20 bg-amber-500/[0.06] p-3 text-xs text-amber-100">Enter the ticket ID before committing this note.</p>}</div>
        </NexusWorkflowDialog>
      </Dialog>
    </div>
  );
}
