import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertCircle,
  Bookmark,
  Check,
  ChevronDown,
  History,
  Loader2,
  MessageCircle,
  MessagesSquare,
  Sparkles,
  X,
} from "lucide-react";
import { ConversationRow, PresenceLabel, TechnicianAvatar } from "@/components/teamChat/TeamChatShared";
import { PRESENCE_META } from "@/lib/teamChatHelpers";
import { CHAT_RECENT_VISIBLE } from "@/components/teamChat/chatLearning";

const STATUS_OPTIONS = [
  ["", "active", "Available"],
  ["dnd", "dnd", "Do not disturb"],
  ["break", "break", "On a break"],
  ["away", "away", "Appear away"],
];

/**
 * The conversation rail.
 *
 * One column that answers three questions in order: which section am I in, what
 * have I been working on, and what needs my attention. The section strip and the
 * list are ordered by what this technician actually opens (see
 * `chatLearning.js`), but nothing is ever removed and a first-time technician
 * sees exactly the declared order — the rail only claims to have adapted when
 * there is recorded evidence in `learningHint`.
 */
export default function ConversationRail({
  modes = [],
  mode,
  onMode,
  title,
  subtitle,
  query,
  onQuery,
  searching,
  onClearSearch,
  onNew,
  tools,
  savedActive,
  onToggleSaved,
  error,
  onRetry,
  loading,
  channels = [],
  activeId,
  onSelect,
  presenceFor,
  recentChannels = [],
  onSelectRecent,
  learningHint,
  onForgetLearning,
  empty,
  currentUser,
  myPresence,
  presenceDetail,
  onStatusChange,
}) {
  const recent = recentChannels.slice(0, CHAT_RECENT_VISIBLE);

  return (
    <aside className="flex w-full shrink-0 flex-col border-r border-white/[0.07] bg-[#111a22] md:w-[304px] xl:w-[336px]" aria-label="Conversations">
      <div className="border-b border-white/[0.07] px-4 pb-3 pt-4">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Messages</p>
            <h2 className="truncate text-xl font-semibold text-white">{title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-[11px] text-zinc-500">{subtitle}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleSaved}
              aria-pressed={savedActive}
              aria-label="Saved conversations"
              className={`h-9 w-9 rounded-lg p-0 ${savedActive ? "bg-amber-500/10 text-amber-200" : "text-zinc-400 hover:bg-white/[0.08] hover:text-white"}`}
            >
              <Bookmark className="h-4 w-4" />
            </Button>
            {tools}
          </div>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Chat sections">
          {modes.map(({ value, label, icon: Icon, badge }) => {
            const active = mode === value;
            return (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onMode(value)}
                className={`relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${
                  active ? "bg-cyan-500/[0.14] text-cyan-100 shadow-sm shadow-cyan-950/30" : "text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-200"
                }`}
              >
                {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
                {label}
                {badge > 0 && (
                  <span className="ml-0.5 rounded-full bg-rose-500 px-1.5 text-[9px] font-bold leading-4 text-white" aria-label={`${badge} waiting`}>
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="relative mt-3">
          <MessagesSquare className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <Input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Filter conversations"
            aria-label="Filter conversations"
            className="h-9 border-white/5 bg-black/20 pl-9 pr-9 text-sm placeholder:text-zinc-600 focus-visible:ring-emerald-500/50"
            data-testid="chat-search"
          />
          {searching ? (
            <Loader2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-emerald-400" />
          ) : query ? (
            <button
              type="button"
              onClick={onClearSearch}
              className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-zinc-500 transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
              aria-label="Clear conversation filter"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        <Button size="sm" className="mt-2.5 h-9 w-full bg-emerald-600 text-xs hover:bg-emerald-500" onClick={onNew} data-testid="new-chat-btn">
          <MessageCircle className="mr-1.5 h-3.5 w-3.5" />New conversation
        </Button>
      </div>

      {learningHint && (
        <div className="flex items-start gap-2 border-b border-white/[0.07] bg-emerald-500/[0.045] px-4 py-2.5" data-testid="chat-learning-hint">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium text-emerald-100">{learningHint.label}</p>
            <p className="mt-0.5 text-[10px] leading-4 text-emerald-100/60">{learningHint.detail}</p>
          </div>
          {onForgetLearning && (
            <button
              type="button"
              onClick={onForgetLearning}
              className="shrink-0 rounded-md px-1.5 py-1 text-[10px] font-medium text-emerald-100/80 transition hover:bg-emerald-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
              data-testid="chat-forget-learning"
            >
              Forget
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="m-3 flex items-start gap-2 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-200" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={onRetry}
            className="shrink-0 rounded-md px-1.5 py-1 font-medium text-rose-100 transition hover:bg-rose-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/50"
          >
            Retry
          </button>
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="p-2">
          {!query && recent.length > 0 && (
            <section className="mb-3" aria-label="Jump back in">
              <p className="flex items-center gap-1.5 px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">
                <History className="h-3 w-3" />Jump back in
              </p>
              <div className="flex flex-wrap gap-1.5 px-1">
                {recent.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => onSelectRecent(entry.id)}
                    className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] py-1 pl-1 pr-2.5 text-[11px] text-zinc-300 transition hover:border-cyan-400/30 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
                    title={entry.name ? `Reopen ${entry.name}` : "Reopen conversation"}
                  >
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-cyan-500/15 text-[9px] font-semibold text-cyan-100">
                      {(entry.name || "#").slice(0, 1).toUpperCase()}
                    </span>
                    <span className="max-w-[9.5rem] truncate">{entry.name || "Conversation"}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((item) => (
                <div key={item} className="flex animate-pulse gap-3 p-2">
                  <div className="h-10 w-10 rounded-full bg-white/5" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-2/3 rounded bg-white/5" />
                    <div className="h-2.5 w-full rounded bg-white/[0.03]" />
                  </div>
                </div>
              ))}
            </div>
          ) : channels.length === 0 ? (
            <div className="px-5 py-14 text-center">
              <MessageCircle className="mx-auto mb-3 h-9 w-9 text-zinc-700" />
              <p className="text-sm font-medium text-zinc-300">{empty?.title || "No conversations found"}</p>
              <p className="mt-1 text-xs leading-5 text-zinc-600">{empty?.body || "Start a chat or create a team channel."}</p>
            </div>
          ) : (
            channels.map((channel) => (
              <ConversationRow
                key={channel.id}
                channel={channel}
                active={channel.id === activeId}
                presence={presenceFor(channel.other_user_id)}
                onClick={() => onSelect(channel.id)}
              />
            ))
          )}
        </div>
      </ScrollArea>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex w-full items-center gap-3 border-t border-white/[0.07] px-4 py-3 text-left transition hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
            data-testid="chat-status-menu"
            aria-label="Set your status"
          >
            <TechnicianAvatar name={currentUser?.name} avatarUrl={currentUser?.avatar} className="h-9 w-9" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{currentUser?.name}</p>
              <PresenceLabel status={myPresence} detail={presenceDetail} />
            </div>
            <ChevronDown className="h-4 w-4 text-zinc-600" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Set your status</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {STATUS_OPTIONS.map(([value, status, label]) => (
            <DropdownMenuItem key={status} onClick={() => onStatusChange(value)}>
              <span className={`h-2.5 w-2.5 rounded-full ${PRESENCE_META[status].dot}`} />
              {label}
              {myPresence === status && <Check className="ml-auto h-4 w-4" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </aside>
  );
}