import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { Keyboard, RotateCcw, Sparkles } from "lucide-react";
import { CHAT_SHORTCUTS } from "@/components/teamChat/chatLearning";

function Key({ children }) {
  return (
    <kbd className="rounded-md border border-white/[0.12] border-b-2 bg-black/30 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
      {children}
    </kbd>
  );
}

/**
 * The keyboard cheat sheet.
 *
 * A chat workspace lives or dies on muscle memory, so the shortcuts are
 * documented where a technician will actually look for them (`?`), and the same
 * panel is the honest place to explain the learned ordering: what was recorded,
 * what it changed, and how to clear it. When there is no evidence the panel says
 * so instead of implying the workspace has adapted.
 */
export default function ChatShortcutsDialog({ open, onOpenChange, learningHint, onForgetLearning }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <NexusWorkflowDialog
        eyebrow="Keyboard first"
        title="Chat shortcuts"
        description="Move through conversations without reaching for the mouse. Shortcuts never fire while you are typing in a field."
        icon={Keyboard}
        tone="cyan"
        className="max-w-2xl"
        contentClassName="max-h-[65vh] overflow-y-auto"
        data-testid="chat-shortcuts-dialog"
        footer={<Button onClick={() => onOpenChange(false)} data-testid="chat-shortcuts-done">Done</Button>}
      >
        <div className="space-y-5">
          <div className="overflow-hidden rounded-xl border border-white/[0.08]">
            {CHAT_SHORTCUTS.map((shortcut) => (
              <div key={shortcut.id} className="flex items-start gap-3 border-b border-white/[0.06] p-3 last:border-0">
                <span className="flex shrink-0 items-center gap-1 pt-0.5">
                  {shortcut.keys.map((key) => <Key key={key}>{key}</Key>)}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-100">{shortcut.label}</p>
                  <p className="mt-0.5 text-[11px] leading-4 text-zinc-500">{shortcut.detail}</p>
                </div>
              </div>
            ))}
          </div>

          <section className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.045] p-4" aria-label="What Nexus has learned here">
            <div className="flex items-start gap-2">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium text-emerald-50">
                  What Nexus learned in chat
                  <Badge variant="outline" className="text-[9px]">{learningHint ? learningHint.label : "Nothing yet"}</Badge>
                </p>
                <p className="mt-1 text-[11px] leading-5 text-emerald-100/70">
                  {learningHint
                    ? learningHint.detail
                    : "Chat keeps its designed order until you have used it enough for a pattern to be real. Nothing is inferred from a single visit, and this memory never changes what you can access."}
                </p>
              </div>
              {onForgetLearning && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 gap-1.5 border-emerald-400/25 bg-emerald-400/[0.07] text-[11px] text-emerald-100 hover:bg-emerald-400/[0.14]"
                  onClick={onForgetLearning}
                  data-testid="chat-shortcuts-forget-learning"
                >
                  <RotateCcw className="h-3.5 w-3.5" />Forget
                </Button>
              )}
            </div>
          </section>
        </div>
      </NexusWorkflowDialog>
    </Dialog>
  );
}
