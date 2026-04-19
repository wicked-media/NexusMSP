import { useState } from "react";
import axios from "axios";
import { API, useAuth } from "@/App";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Wand2, Loader2, Copy, AlertTriangle, Bug, Check } from "lucide-react";
import { toast } from "sonner";

const tokenHeaders = (token) => ({ Authorization: `Bearer ${token}` });

/**
 * Ticket Auto-Co-pilot — dropdown button with 3 actions.
 * Renders inline in a ticket detail header.
 */
export function TicketCopilotButton({ ticketId, onResult }) {
  const { token } = useAuth();
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState(null);
  const [output, setOutput] = useState("");
  const [structured, setStructured] = useState(null);

  const run = async (act) => {
    setAction(act); setOutput(""); setStructured(null); setRunning(true); setOpen(true);
    try {
      const res = await axios.post(`${API}/tickets/${ticketId}/copilot`, { action: act, tone: "friendly" }, { headers: tokenHeaders(token) });
      setOutput(res.data.output || "");
      setStructured(res.data.structured || null);
      onResult?.(act, res.data);
    } catch (e) {
      setOutput(`Error: ${e.response?.data?.detail || e.message}`);
    } finally { setRunning(false); }
  };

  const copyOut = () => { navigator.clipboard.writeText(output); toast.success("Copied"); };

  const actionLabel = { summarize: "Summary", next_step: "Next Step", draft_reply: "Client Reply Draft" }[action] || "";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="text-indigo-400 border-indigo-500/30 hover:bg-indigo-500/10" data-testid="ticket-copilot-btn">
            <Sparkles className="w-3 h-3 mr-1" />Copilot
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => run("summarize")} data-testid="copilot-summarize"><Wand2 className="w-3 h-3 mr-2" />Summarize thread</DropdownMenuItem>
          <DropdownMenuItem onClick={() => run("next_step")} data-testid="copilot-next-step"><Check className="w-3 h-3 mr-2" />Suggest next step</DropdownMenuItem>
          <DropdownMenuItem onClick={() => run("draft_reply")} data-testid="copilot-draft-reply"><Copy className="w-3 h-3 mr-2" />Draft client reply</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl" data-testid="copilot-result-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-400" />
              Copilot · {actionLabel}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 min-h-[200px]">
            {running ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />Claude is thinking…
              </div>
            ) : structured?.next_step ? (
              <div className="space-y-2">
                <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-4">
                  <div className="text-[10px] uppercase tracking-widest text-indigo-400 font-semibold mb-1">Next Step</div>
                  <div className="text-sm">{structured.next_step}</div>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
                  <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-1">Rationale</div>
                  <div className="text-xs text-zinc-400">{structured.rationale}</div>
                </div>
                {structured.eta_minutes && <Badge variant="outline">ETA ~{structured.eta_minutes}m</Badge>}
              </div>
            ) : (
              <pre className="whitespace-pre-wrap text-sm text-zinc-200 font-sans">{output || "(no output)"}</pre>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={copyOut} disabled={running || !output} data-testid="copilot-copy-btn"><Copy className="w-3 h-3 mr-1" />Copy</Button>
            <Button onClick={() => setOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}


/**
 * "Explain This Error" button — paste raw log/trace, get plain-English diagnosis.
 */
export function ExplainErrorButton({ label = "Explain Error", contextHint = "unspecified" }) {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [ctx, setCtx] = useState(contextHint);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  const run = async () => {
    if (!errorText.trim()) { toast.error("Paste an error log or stack trace"); return; }
    setRunning(true); setResult(null);
    try {
      const res = await axios.post(`${API}/ai/explain-error`, { error_text: errorText, context: ctx }, { headers: tokenHeaders(token) });
      setResult(res.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    } finally { setRunning(false); }
  };

  const sevColor = {
    critical: "text-rose-400 border-rose-500/40 bg-rose-500/10",
    high: "text-orange-400 border-orange-500/40 bg-orange-500/10",
    medium: "text-amber-400 border-amber-500/40 bg-amber-500/10",
    low: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10",
  }[result?.severity || "medium"];

  return (
    <>
      <Button variant="outline" size="sm" className="text-rose-400 border-rose-500/30 hover:bg-rose-500/10" onClick={() => setOpen(true)} data-testid="explain-error-btn">
        <Bug className="w-3 h-3 mr-1" />{label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl" data-testid="explain-error-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400" />
              Explain This Error
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">Paste error / stack trace</label>
              <Textarea
                rows={7}
                placeholder="System.OutOfMemoryException at ... / kernel: Out of memory: Killed process ..."
                value={errorText}
                onChange={(e) => setErrorText(e.target.value)}
                className="font-mono text-xs"
                data-testid="explain-error-input"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">Context</label>
              <select className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs" value={ctx} onChange={(e) => setCtx(e.target.value)}>
                <option value="unspecified">Unspecified</option>
                <option value="windows event log">Windows Event Log</option>
                <option value="linux syslog">Linux / Syslog</option>
                <option value="app trace">App stack trace</option>
                <option value="network">Network / firewall</option>
                <option value="database">Database</option>
                <option value="backup">Backup job</option>
              </select>
              <Button onClick={run} disabled={running} className="ml-auto" data-testid="explain-error-run">
                {running ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />}Diagnose
              </Button>
            </div>

            {result && (
              <div className="space-y-3 pt-2 border-t border-zinc-800">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border font-mono ${sevColor}`}>{result.severity}</span>
                  <div className="text-xs text-zinc-400">{result.likely_cause}</div>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                  <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-1">Diagnosis</div>
                  <div className="text-sm text-zinc-200">{result.diagnosis}</div>
                </div>
                {result.remediation_steps?.length > 0 && (
                  <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-3">
                    <div className="text-[10px] uppercase tracking-widest text-indigo-400 font-semibold mb-2">Remediation steps</div>
                    <ol className="list-decimal list-inside space-y-1 text-sm text-zinc-200">
                      {result.remediation_steps.map((s, i) => <li key={`s-${i}`}>{s}</li>)}
                    </ol>
                  </div>
                )}
                {result.references?.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {result.references.map((r, i) => (
                      <a key={`r-${i}`} href={r} target="_blank" rel="noreferrer" className="text-[10px] text-sky-400 underline font-mono">{r}</a>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
