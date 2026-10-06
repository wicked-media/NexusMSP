import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Search } from "lucide-react";

/**
 * In-session command palette (Ctrl/Cmd + K).
 *
 * Deliberately dependency-free: it renders inside the fullscreen remote viewer
 * overlay, so it owns its own stacking context, focus and key handling rather
 * than relying on a shared dialog. It only ever offers the commands the session
 * has already authorised — it never becomes a route to an unconsented action.
 */
export default function NexusRemoteCommandPalette({
  open,
  onOpenChange,
  commands = [],
  sessionLabel = "",
  heading = "Session commands",
  testid = "remote-command-palette",
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);

  const available = useMemo(() => commands.filter((command) => !command.disabled), [commands]);
  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return available;
    return available.filter((command) => {
      const haystack = [command.label, command.hint, command.group, ...(command.keywords || [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(value);
    });
  }, [available, query]);

  useEffect(() => {
    if (!open) return undefined;
    setQuery("");
    setActiveIndex(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => { setActiveIndex(0); }, [query]);

  if (!open) return null;

  const run = (command) => {
    if (!command) return;
    onOpenChange?.(false);
    command.run?.();
  };

  const handleKeyDown = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(filtered.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      run(filtered[activeIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onOpenChange?.(false);
    }
  };

  let lastGroup = null;

  return (
    <div
      className="fixed inset-0 z-[140] flex items-start justify-center bg-black/70 p-4 pt-[10vh] backdrop-blur-sm animate-in fade-in-0 duration-150"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onOpenChange?.(false); }}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-cyan-400/25 bg-[linear-gradient(160deg,rgba(8,145,178,0.10),rgba(2,6,23,0.97)_46%)] shadow-2xl shadow-cyan-950/50 animate-in fade-in-0 zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        data-testid={testid}
      >
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-cyan-200" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command — spooler, dns, fit, end session…"
            aria-label={heading}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            data-testid={`${testid}-input`}
          />
          <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">ESC</kbd>
        </div>

        {sessionLabel && (
          <p className="border-b border-white/5 px-3 py-1.5 font-mono text-[10px] text-muted-foreground" data-testid={`${testid}-session`}>
            {sessionLabel}
          </p>
        )}

        <div className="max-h-[52vh] overflow-y-auto py-1.5" data-testid={`${testid}-list`}>
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">No session command matches that.</p>
          ) : (
            filtered.map((command) => {
              const index = filtered.indexOf(command);
              const showGroup = command.group && command.group !== lastGroup;
              lastGroup = command.group || lastGroup;
              const Icon = command.icon;
              return (
                <div key={command.id}>
                  {showGroup && (
                    <p className="px-3 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">{command.group}</p>
                  )}
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => run(command)}
                    data-active={index === activeIndex ? "true" : "false"}
                    data-testid={`${testid}-item-${command.id}`}
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors ${
                      index === activeIndex ? "bg-cyan-400/[0.12] text-cyan-50" : "text-foreground hover:bg-white/[0.04]"
                    }`}
                  >
                    {Icon ? <Icon className="h-3.5 w-3.5 shrink-0 text-cyan-200" aria-hidden="true" /> : <span className="h-3.5 w-3.5 shrink-0" />}
                    <span className="min-w-0 flex-1 truncate">{command.label}</span>
                    {command.hint && <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{command.hint}</span>}
                    {index === activeIndex && <CornerDownLeft className="h-3 w-3 shrink-0 text-cyan-200" aria-hidden="true" />}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-white/10 px-3 py-2 text-[10px] text-muted-foreground">
          <span><kbd className="rounded border border-white/10 bg-white/5 px-1 font-mono">↑</kbd> <kbd className="rounded border border-white/10 bg-white/5 px-1 font-mono">↓</kbd> move</span>
          <span><kbd className="rounded border border-white/10 bg-white/5 px-1 font-mono">↵</kbd> run</span>
          <span className="ml-auto">Only commands this session allows</span>
        </div>
      </div>
    </div>
  );
}
