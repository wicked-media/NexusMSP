import { useState, useRef, useEffect } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mic, Square, Loader2, CheckCircle, Waves } from "lucide-react";
import { toast } from "sonner";

/**
 * Voice Journal — record, transcribe via Whisper, auto-log time entry + ticket note.
 * Pops a dialog with a big red record button, shows live duration, then posts once done.
 */
export function VoiceJournalButton({ ticketId, onLogged, compact = false }) {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [blobUrl, setBlobUrl] = useState(null);
  const [duration, setDuration] = useState(0);
  const [durationMin, setDurationMin] = useState(15);
  const [billable, setBillable] = useState(true);
  const [transcript, setTranscript] = useState("");
  const [success, setSuccess] = useState(false);

  const mediaRef = useRef(null);
  const chunksRef = useRef([]);
  const blobRef = useRef(null);
  const tickRef = useRef(null);

  const reset = () => {
    setRecording(false); setBlobUrl(null); setDuration(0); setTranscript("");
    setSuccess(false); setUploading(false); blobRef.current = null; chunksRef.current = [];
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
  };

  useEffect(() => { if (!open) reset(); }, [open]);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        blobRef.current = blob;
        setBlobUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((t) => t.stop());
      };
      mediaRef.current = mr;
      mr.start();
      setRecording(true); setDuration(0);
      tickRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    } catch (e) {
      toast.error(`Mic access denied: ${e.message}`);
    }
  };

  const stop = () => {
    mediaRef.current?.stop();
    setRecording(false);
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    // Nudge default duration to recording length rounded up (in minutes, min 1)
    setDurationMin(Math.max(1, Math.ceil(duration / 60)));
  };

  const upload = async () => {
    if (!blobRef.current) { toast.error("No recording to upload"); return; }
    setUploading(true); setTranscript("");
    try {
      const fd = new FormData();
      fd.append("audio", blobRef.current, "voice.webm");
      fd.append("ticket_id", ticketId);
      fd.append("duration_minutes", String(durationMin));
      fd.append("billable", billable ? "true" : "false");
      fd.append("category", "Support");
      const res = await axios.post(`${API}/voice-journal/log-entry`, fd, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "multipart/form-data" },
      });
      setTranscript(res.data.transcript || "(empty)");
      setSuccess(true);
      onLogged?.(res.data);
      toast.success(`Logged ${durationMin}m + ticket note`);
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    } finally { setUploading(false); }
  };

  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  return (
    <>
      <Button
        variant="outline" size="sm"
        className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
        onClick={() => setOpen(true)}
        data-testid="voice-journal-btn"
      >
        <Waves className="w-3 h-3 mr-1" />{compact ? "" : "Voice Journal"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md" data-testid="voice-journal-dialog">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Waves className="w-4 h-4 text-emerald-400" />Voice Journal</DialogTitle></DialogHeader>

          {!success ? (
            <div className="space-y-4">
              <div className="flex flex-col items-center py-3">
                <button
                  onClick={recording ? stop : start}
                  disabled={uploading || !!blobUrl}
                  className={`w-24 h-24 rounded-full flex items-center justify-center transition-all border-2 ${
                    recording
                      ? "bg-rose-500/20 border-rose-500 animate-pulse"
                      : "bg-emerald-500/10 border-emerald-500/40 hover:bg-emerald-500/20"
                  } ${blobUrl ? "opacity-40 cursor-not-allowed" : ""}`}
                  data-testid="voice-journal-record-btn"
                >
                  {recording ? <Square className="w-8 h-8 text-rose-400" /> : <Mic className="w-8 h-8 text-emerald-400" />}
                </button>
                <div className="mt-3 font-mono text-lg text-zinc-200" data-testid="voice-journal-timer">{fmtTime(duration)}</div>
                <div className="text-[10px] uppercase tracking-widest text-zinc-500 mt-0.5">
                  {recording ? "Recording…" : blobUrl ? "Ready to log" : "Tap to record"}
                </div>
                {blobUrl && <audio src={blobUrl} controls className="w-full mt-3" />}
              </div>

              {blobUrl && (
                <div className="space-y-3 pt-2 border-t border-zinc-800">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-[10px] uppercase tracking-widest text-zinc-500">Minutes</Label>
                      <Input type="number" min="1" max="480" value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))} data-testid="voice-journal-minutes" />
                    </div>
                    <div>
                      <Label className="text-[10px] uppercase tracking-widest text-zinc-500">Billable?</Label>
                      <select className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-2 text-sm" value={billable ? "yes" : "no"} onChange={(e) => setBillable(e.target.value === "yes")}>
                        <option value="yes">Billable</option>
                        <option value="no">Non-billable</option>
                      </select>
                    </div>
                  </div>
                  <Button className="w-full" onClick={upload} disabled={uploading} data-testid="voice-journal-log-btn">
                    {uploading ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Transcribing & logging…</> : <>Log entry</>}
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-emerald-400"><CheckCircle className="w-5 h-5" />Logged · {durationMin}m {billable ? "billable" : "non-billable"}</div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-1">Transcript</div>
                <div className="text-sm text-zinc-200 whitespace-pre-wrap">{transcript}</div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{success ? "Done" : "Close"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
