import { useEffect, useState } from "react";
import axios from "axios";
import { API } from "@/App";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Activity as ActivityIcon,
  Bell,
  Bookmark,
  Building2,
  FileText,
  Loader2,
  Mail,
  Pin,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { ChannelAvatar, PresenceLabel, TechnicianAvatar } from "@/components/teamChat/TeamChatShared";
import {
  ConversationDetails,
  EmptyContent,
  FilesView,
  PinnedView,
} from "@/components/teamChat/TeamChatPanels";
import { channelDisplayName, isLivePresence } from "@/lib/teamChatHelpers";
import { formatRelative } from "@/lib/teamChatFormat";

const TABS = [
  { value: "overview", label: "Overview", icon: ActivityIcon },
  { value: "pinned", label: "Pinned", icon: Pin },
  { value: "files", label: "Files", icon: FileText },
  { value: "manage", label: "Manage", icon: ShieldCheck },
];

/**
 * The context rail.
 *
 * Chat is where operational work is discussed, so the right rail is organised
 * around the work rather than around a settings list: what this conversation is
 * linked to, who is in it and who is currently active, what has been pinned or
 * shared, and — behind its own tab, and only for people who can change them —
 * the access controls. Member management keeps the same server-validated calls
 * it has always used; this rail changes where they are presented, not what they
 * are allowed to do.
 */
export default function ContextRail({
  channel,
  users = [],
  presenceFor,
  currentUserId,
  canManage,
  headers,
  onUpdated,
  onClose,
  pinned = [],
  files = [],
  onDownload,
  onOpenThread,
  onJumpToUnread,
  onMarkUnread,
  onToggleSaved,
  onToggleMuted,
  notifySummary,
  context = {},
}) {
  const [tab, setTab] = useState("overview");
  const [activity, setActivity] = useState([]);
  const [loadingActivity, setLoadingActivity] = useState(false);

  useEffect(() => setTab("overview"), [channel?.id]);

  useEffect(() => {
    if (tab !== "activity" || !channel?.id) return undefined;
    let active = true;
    setLoadingActivity(true);
    axios.get(`${API}/chat/channels/${channel.id}/activity`, { headers })
      .then((response) => active && setActivity(response.data || []))
      .catch(() => active && setActivity([]))
      .finally(() => active && setLoadingActivity(false));
    return () => { active = false; };
  }, [channel?.id, headers, tab]);

  if (!channel) return null;

  const memberIds = channel.kind === "team" && !channel.is_private
    ? users.map((user) => user.id)
    : channel.member_ids || [];
  const members = memberIds
    .map((id) => users.find((candidate) => candidate.id === id))
    .filter(Boolean)
    .sort((left, right) => Number(isLivePresence(presenceFor(right.id))) - Number(isLivePresence(presenceFor(left.id))));
  const linkedWork = [
    ["Tickets", context.tickets, "Ticket linked in this conversation"],
    ["Invoices", context.invoices, "Invoice linked in this conversation"],
    ["Purchase orders", context.purchaseOrders, "Purchase order linked in this conversation"],
    ["Pinned", pinned.length, "Pinned posts"],
  ].filter(([, value]) => value > 0);

  return (
    <aside
      className="fixed inset-y-0 right-0 z-30 flex w-full max-w-sm flex-col border-l border-white/[0.07] bg-[#101922] shadow-2xl md:static md:inset-auto"
      data-testid="chat-context-rail"
      aria-label="Conversation context"
    >
      <div className="flex h-16 items-center justify-between border-b border-white/[0.07] px-4">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Conversation</p>
          <h3 className="truncate font-semibold">{channelDisplayName(channel)}</h3>
        </div>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onClose} aria-label="Close conversation context">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex items-center gap-1 border-b border-white/[0.07] px-2 py-1.5" role="tablist" aria-label="Conversation context sections">
        {TABS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${
              tab === value ? "bg-cyan-500/[0.14] text-cyan-100" : "text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-200"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />{label}
            {value === "files" && files.length > 0 && <span className="text-[10px] text-zinc-500">{files.length}</span>}
            {value === "pinned" && pinned.length > 0 && <span className="text-[10px] text-zinc-500">{pinned.length}</span>}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <ScrollArea className="flex-1">
          <div className="space-y-4 p-4">
            <div className="flex items-center gap-3">
              <ChannelAvatar channel={channel} presence={channel.other_user_id ? presenceFor(channel.other_user_id) : null} size="md" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{channelDisplayName(channel)}</p>
                <p className="truncate text-[11px] text-zinc-500">
                  {channel.kind === "client_direct"
                    ? "Approved customer connection"
                    : `${channel.is_private ? "Private" : "Company-wide"} · ${channel.member_count || memberIds.length} members`}
                </p>
              </div>
            </div>

            {channel.description && (
              <p className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-xs leading-5 text-zinc-400">{channel.description}</p>
            )}

            {channel.kind === "client_direct" && (
              <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/[0.05] p-3" data-testid="customer-connection-details">
                <p className="flex items-center gap-1.5 text-[11px] font-medium text-cyan-100"><Building2 className="h-3.5 w-3.5" />Approved customer connection</p>
                <p className="mt-1.5 truncate text-sm text-zinc-100">{channel.customer_name || channelDisplayName(channel)}</p>
                {channel.customer_email && <p className="truncate text-[11px] text-zinc-500">{channel.customer_email}</p>}
                <p className="mt-2 text-[10px] leading-4 text-zinc-500">Private customer access is limited to this technician and remains linked to the approval record.</p>
              </div>
            )}

            {linkedWork.length > 0 && (
              <section aria-label="Linked work">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">Linked work</p>
                <div className="grid grid-cols-2 gap-2">
                  {linkedWork.map(([label, value, detail]) => (
                    <div key={label} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5" title={detail}>
                      <p className="text-[10px] uppercase tracking-wide text-zinc-600">{label}</p>
                      <p className="text-lg font-semibold tabular-nums text-zinc-100">{value}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="space-y-1.5" aria-label="Conversation actions">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">Actions</p>
              <button type="button" onClick={onJumpToUnread} className="flex w-full items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-left text-xs text-zinc-300 transition hover:border-cyan-400/25 hover:text-white">
                <ActivityIcon className="h-3.5 w-3.5 text-cyan-300" />Jump to next unread conversation
              </button>
              <button type="button" onClick={onMarkUnread} className="flex w-full items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-left text-xs text-zinc-300 transition hover:border-cyan-400/25 hover:text-white">
                <Mail className="h-3.5 w-3.5 text-cyan-300" />Mark this conversation unread
              </button>
              <button type="button" onClick={onToggleSaved} aria-pressed={Boolean(channel.is_saved)} className="flex w-full items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-left text-xs text-zinc-300 transition hover:border-amber-400/25 hover:text-white">
                <Bookmark className={`h-3.5 w-3.5 ${channel.is_saved ? "text-amber-300" : "text-zinc-500"}`} />
                {channel.is_saved ? "Remove from saved" : "Save this conversation"}
              </button>
              <button type="button" onClick={onToggleMuted} aria-pressed={Boolean(channel.is_muted)} className="flex w-full items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-left text-xs text-zinc-300 transition hover:border-cyan-400/25 hover:text-white">
                <Bell className={`h-3.5 w-3.5 ${channel.is_muted ? "text-zinc-500" : "text-emerald-300"}`} />
                {channel.is_muted ? "Turn notifications on" : "Mute notifications"}
              </button>
              <p className="px-1 text-[10px] text-zinc-600">Notifications: {notifySummary}</p>
            </section>

            <section aria-label="Members">
              <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">
                <Users className="h-3 w-3" />Members
              </p>
              <div className="space-y-0.5">
                {members.map((member) => (
                  <div key={member.id} className="flex items-center gap-3 rounded-lg p-2 hover:bg-white/[0.03]">
                    <TechnicianAvatar name={member.name} avatarUrl={member.avatar} className="h-8 w-8" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{member.name}{member.id === currentUserId ? " (you)" : ""}</p>
                      <PresenceLabel status={presenceFor(member.id)} />
                    </div>
                  </div>
                ))}
                {members.length === 0 && <p className="px-2 text-xs text-zinc-600">No member records to show.</p>}
              </div>
            </section>
          </div>
        </ScrollArea>
      )}

      {tab === "pinned" && <PinnedView messages={pinned} onOpenThread={onOpenThread} />}
      {tab === "files" && <FilesView files={files} onDownload={onDownload} />}

      {tab === "manage" && (
        canManage ? (
          <ConversationDetails
            channel={channel}
            users={users}
            presenceFor={presenceFor}
            currentUserId={currentUserId}
            canManage={canManage}
            headers={headers}
            onUpdated={onUpdated}
          />
        ) : (
          <div className="p-4">
            <EmptyContent
              icon={ShieldCheck}
              title="Access is managed by an owner"
              body="Channel and private-member changes require the channel owner or an administrator."
            />
          </div>
        )
      )}

      {tab === "activity" && (
        <ScrollArea className="flex-1">
          <div className="p-4">
            {loadingActivity ? (
              <div className="flex items-center gap-2 py-6 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" />Loading channel history…</div>
            ) : activity.length === 0 ? (
              <EmptyContent icon={ActivityIcon} title="No changes recorded" body="Access, ownership and membership changes appear here with their actor." />
            ) : (
              <div className="space-y-2">
                {activity.map((event) => (
                  <div key={event.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 text-xs">
                    <p className="text-zinc-300">{event.actor_name} · {String(event.event_type || "change").replaceAll(".", " ")}</p>
                    <p className="mt-0.5 text-[10px] text-zinc-600">{formatRelative(event.created_at)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      )}
    </aside>
  );
}
