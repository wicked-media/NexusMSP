import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API } from "@/App";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import NexusWorkflowDialog from "@/components/NexusWorkflowDialog";
import { toast } from "sonner";
import {
  Bell,
  Building2,
  Check,
  Download,
  FileText,
  Hash,
  Loader2,
  MessageCircle,
  MessageSquarePlus,
  Pin,
  Plus,
  Search,
  Send,
  X,
} from "lucide-react";
import { chatAuthorName, channelDisplayName, repairDisplayText } from "@/lib/teamChatHelpers";
import { formatBytes, formatRelative, notificationSummary } from "@/lib/teamChatFormat";
import { ChannelAvatar, PresenceLabel, TechnicianAvatar } from "@/components/teamChat/TeamChatShared";
import { MessageRow } from "@/components/teamChat/TeamChatMessages";

export function FilesView({ files, onDownload }) {
  return (
    <div className="flex-1 overflow-y-auto p-5 md:p-8">
      <div className="mx-auto max-w-4xl"><h3 className="mb-1 text-lg font-semibold">Shared files</h3><p className="mb-5 text-sm text-zinc-500">Files shared in this conversation.</p>
        {files.length === 0 ? <EmptyContent icon={FileText} title="No shared files" body="Attachments shared in posts appear here." /> : <div className="overflow-hidden rounded-xl border border-white/5">{files.map(message => <button key={message.id} onClick={() => onDownload(message.attachment)} className="flex w-full items-center gap-3 border-b border-white/5 bg-white/[0.02] p-4 text-left last:border-0 hover:bg-white/[0.04]"><FileText className="h-5 w-5 text-cyan-300" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{message.attachment.filename}</p><p className="text-xs text-zinc-600">{message.user_name} · {formatRelative(message.ts)} · {formatBytes(message.attachment.size)}</p></div><Download className="h-4 w-4 text-zinc-500" /></button>)}</div>}
      </div>
    </div>
  );
}

export function PinnedView({ messages, onOpenThread }) {
  return <div className="flex-1 overflow-y-auto p-5 md:p-8"><div className="mx-auto max-w-4xl"><h3 className="mb-1 text-lg font-semibold">Pinned posts</h3><p className="mb-5 text-sm text-zinc-500">Important updates kept for the team.</p>{messages.length === 0 ? <EmptyContent icon={Pin} title="Nothing pinned" body="Pin a post from its More actions menu." /> : <div className="space-y-3">{messages.map(message => <button key={message.id} onClick={() => onOpenThread(message)} className="block w-full rounded-xl border border-amber-500/15 bg-amber-500/[0.04] p-4 text-left hover:border-amber-500/30"><div className="mb-2 flex items-center gap-2 text-xs text-zinc-500"><Pin className="h-3.5 w-3.5 text-amber-400" />Pinned by {message.pinned_by || "a teammate"} · {formatRelative(message.pinned_at || message.ts)}</div><p className="whitespace-pre-wrap text-sm text-zinc-300">{repairDisplayText(message.body)}</p></button>)}</div>}</div></div>;
}

export function SearchResults({ results, onSelect, onClose }) {
  return <div className="flex-1 overflow-y-auto p-5 md:p-8"><div className="mx-auto max-w-4xl"><div className="mb-5 flex items-center justify-between"><div><h3 className="text-lg font-semibold">Search results</h3><p className="text-sm text-zinc-500">{results.length} matching messages</p></div><Button variant="ghost" size="sm" onClick={onClose} aria-label="Close search results"><X className="h-4 w-4" /></Button></div>{results.length === 0 ? <EmptyContent icon={Search} title="No matches" body="Try a different person, ticket, or phrase." /> : <div className="space-y-2">{results.map(result => <button key={result.id} onClick={() => onSelect(result)} className="w-full rounded-xl border border-white/5 bg-white/[0.02] p-4 text-left hover:border-cyan-500/30 hover:bg-white/[0.04]"><div className="mb-2 flex items-center gap-2 text-xs text-zinc-500">{result.channel_kind === "team" ? <Hash className="h-3.5 w-3.5" /> : <MessageCircle className="h-3.5 w-3.5" />}<span>{result.channel_name}</span><span>·</span><span>{chatAuthorName(result.user_name, result.is_system)}</span><span>·</span><span>{formatRelative(result.ts)}</span></div><p className="line-clamp-3 text-sm text-zinc-300">{repairDisplayText(result.body)}</p></button>)}</div>}</div></div>;
}

export function InfoPanel({ channel, users, presenceFor, currentUserId, canManage, headers, onUpdated, onClose }) {
  const memberIds = useMemo(
    () => channel.kind === "team" && !channel.is_private ? users.map(user => user.id) : channel.member_ids || [],
    [channel.is_private, channel.kind, channel.member_ids, users],
  );
  const [draftMemberIds, setDraftMemberIds] = useState(memberIds);
  const [savingMembers, setSavingMembers] = useState(false);
  const [activity, setActivity] = useState([]);
  const [nextOwnerId, setNextOwnerId] = useState("");
  const [transferringOwner, setTransferringOwner] = useState(false);
  const canManageMembers = channel.kind === "team" && channel.is_private && canManage;
  const canTransferOwnership = channel.kind === "team" && canManage && channel.created_by !== "system";
  useEffect(() => { setDraftMemberIds(memberIds); }, [channel.id, memberIds]);
  useEffect(() => {
    let active = true;
    axios.get(`${API}/chat/channels/${channel.id}/activity`, { headers })
      .then(response => active && setActivity(response.data || []))
      .catch(() => active && setActivity([]));
    return () => { active = false; };
  }, [channel.id, headers]);
  const addMember = userId => {
    if (userId && !draftMemberIds.includes(userId)) setDraftMemberIds(current => [...current, userId]);
  };
  const removeMember = userId => {
    if (userId !== currentUserId) setDraftMemberIds(current => current.filter(id => id !== userId));
  };
  const saveMembers = async () => {
    setSavingMembers(true);
    try {
      await axios.put(`${API}/chat/channels/${channel.id}/members`, { member_ids: draftMemberIds }, { headers });
      toast.success("Private channel members saved");
      onUpdated?.();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Members could not be updated");
    } finally {
      setSavingMembers(false);
    }
  };
  const transferOwnership = async () => {
    if (!nextOwnerId || transferringOwner) return;
    setTransferringOwner(true);
    try {
      await axios.post(`${API}/chat/channels/${channel.id}/ownership`, { owner_id: nextOwnerId }, { headers });
      toast.success("Channel ownership transferred");
      setNextOwnerId("");
      onUpdated?.();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Ownership could not be transferred");
    } finally {
      setTransferringOwner(false);
    }
  };
  return (
    <aside className="fixed inset-y-0 right-0 z-30 flex w-full max-w-sm flex-col border-l border-white/5 bg-[#1d1f26] shadow-2xl md:static md:inset-auto" data-testid="chat-info-panel">
      <div className="flex h-16 items-center justify-between border-b border-white/5 px-4"><h3 className="font-semibold">Conversation details</h3><Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onClose} aria-label="Close conversation details"><X className="h-4 w-4" /></Button></div>
      {canManageMembers && <div className="border-b border-white/5 bg-cyan-500/[0.04] p-4"><div className="mb-2 flex items-center justify-between"><p className="text-xs font-medium text-cyan-100">Private member access</p><span className="text-[10px] text-zinc-500">Owner</span></div><div className="flex gap-2"><select value="" onChange={event => addMember(event.target.value)} className="h-9 min-w-0 flex-1 rounded-lg border border-white/10 bg-[#252832] px-2 text-xs text-zinc-300"><option value="">Add a technician…</option>{users.filter(candidate => !draftMemberIds.includes(candidate.id)).map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select><Button onClick={saveMembers} disabled={savingMembers} className="h-9 shrink-0 bg-emerald-600 px-3 text-xs hover:bg-emerald-500">{savingMembers ? "Saving" : "Save"}</Button></div><div className="mt-2 flex flex-wrap gap-1">{draftMemberIds.map(id => { const member = users.find(candidate => candidate.id === id); return member ? <span key={id} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/20 py-1 pl-2 pr-1 text-[10px] text-zinc-300">{member.name}{id !== currentUserId && <button type="button" onClick={() => removeMember(id)} className="rounded-full p-0.5 text-zinc-500 hover:bg-rose-500/15 hover:text-rose-300" title={`Remove ${member.name}`}><X className="h-3 w-3" /></button>}</span> : null; })}</div></div>}
      {canTransferOwnership && <div className="border-b border-white/5 bg-amber-500/[0.035] p-4"><p className="text-xs font-medium text-amber-100">Channel ownership</p><p className="mt-1 text-[11px] text-zinc-500">Transfer management responsibility to an active technician.</p><div className="mt-2 flex gap-2"><select value={nextOwnerId} onChange={event => setNextOwnerId(event.target.value)} className="h-9 min-w-0 flex-1 rounded-lg border border-white/10 bg-[#252832] px-2 text-xs text-zinc-300"><option value="">Choose new owner…</option>{users.filter(candidate => candidate.id !== channel.created_by).map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select><Button onClick={transferOwnership} disabled={!nextOwnerId || transferringOwner} className="h-9 shrink-0 bg-amber-600 px-3 text-xs hover:bg-amber-500">{transferringOwner ? "Saving" : "Transfer"}</Button></div></div>}
      <div className="border-b border-white/5 bg-white/[0.015] px-4 py-3"><div className="flex items-center gap-2 text-xs text-zinc-400"><Bell className="h-3.5 w-3.5 text-cyan-300" /><span>Notifications: {notificationSummary(channel)}</span></div></div>
      {channel.kind === "client_direct" && <div className="border-b border-cyan-500/15 bg-cyan-500/[0.045] p-4" data-testid="customer-connection-details"><div className="flex items-start gap-2"><Building2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" /><div className="min-w-0"><p className="text-xs font-medium text-cyan-100">Approved customer connection</p><p className="mt-1 truncate text-sm text-zinc-100">{channel.customer_name || channelDisplayName(channel)}</p>{channel.customer_email && <p className="mt-0.5 truncate text-[11px] text-zinc-500">{channel.customer_email}</p>}<p className="mt-2 text-[10px] leading-4 text-zinc-500">Private customer access is limited to this technician and remains linked to the approval record.</p></div></div></div>}
      <ScrollArea className="flex-1"><div className="p-5 text-center"><ChannelAvatar channel={channel} presence={channel.other_user_id ? presenceFor(channel.other_user_id) : null} size="md" /><h4 className="mt-3 text-lg font-semibold">{channelDisplayName(channel)}</h4><p className="mt-1 text-xs text-zinc-500">{channel.is_private ? "Private" : "Company-wide"} · {channel.member_count || memberIds.length} members</p>{channel.description && <p className="mt-4 rounded-lg bg-white/[0.03] p-3 text-left text-sm text-zinc-400">{channel.description}</p>}</div><div className="border-t border-white/5 p-4"><p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">Members</p><div className="space-y-1">{memberIds.map(id => { const member = users.find(candidate => candidate.id === id); if (!member) return null; return <div key={id} className="flex items-center gap-3 rounded-lg p-2 hover:bg-white/[0.03]"><TechnicianAvatar name={member.name} avatarUrl={member.avatar} className="h-8 w-8" /><div className="min-w-0 flex-1 text-left"><p className="truncate text-sm">{member.name}</p><PresenceLabel status={presenceFor(id)} /></div></div>; })}</div></div><div className="border-t border-white/5 p-4"><p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">Channel history</p>{activity.length === 0 ? <p className="text-xs text-zinc-600">No recorded channel changes yet.</p> : <div className="space-y-2">{activity.map(event => <div key={event.id} className="rounded-lg bg-white/[0.025] p-2.5 text-xs"><p className="text-zinc-300">{event.actor_name} · {String(event.event_type || "change").replaceAll(".", " ")}</p><p className="mt-0.5 text-[10px] text-zinc-600">{formatRelative(event.created_at)}</p></div>)}</div>}</div></ScrollArea>
    </aside>
  );
}

export function ThreadPanel({ thread, currentUserId, headers, input, onInput, onSend, onClose, editingId, editingText, onEditingText, onStartEdit, onCancelEdit, onSaveEdit, onDelete, onReact }) {
  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-white/5 bg-[#1d1f26] shadow-2xl md:static md:inset-auto" data-testid="thread-panel">
      <div className="flex h-16 items-center justify-between border-b border-white/5 px-4"><div><h3 className="font-semibold">Thread</h3><p className="text-xs text-zinc-600">{thread.replies.length} {thread.replies.length === 1 ? "reply" : "replies"}</p></div><Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onClose} aria-label="Close thread"><X className="h-4 w-4" /></Button></div>
      <div className="flex-1 overflow-y-auto p-3"><MessageRow message={thread.parent} own={thread.parent.user_id === currentUserId} currentUserId={currentUserId} headers={headers} compact={false} onDownload={() => {}} editing={editingId === thread.parent.id} editingText={editingText} onEditingText={onEditingText} onStartEdit={() => onStartEdit(thread.parent)} onCancelEdit={onCancelEdit} onSaveEdit={onSaveEdit} onDelete={() => onDelete(thread.parent)} onReact={emoji => onReact(thread.parent.id, emoji)} />{thread.replies.length > 0 && <div className="my-3 border-t border-white/5" />}{thread.replies.map(reply => <MessageRow key={reply.id} message={reply} own={reply.user_id === currentUserId} currentUserId={currentUserId} headers={headers} compact={false} onDownload={() => {}} editing={editingId === reply.id} editingText={editingText} onEditingText={onEditingText} onStartEdit={() => onStartEdit(reply)} onCancelEdit={onCancelEdit} onSaveEdit={onSaveEdit} onDelete={() => onDelete(reply)} onReact={emoji => onReact(reply.id, emoji)} />)}</div>
      <div className="border-t border-white/5 p-3"><div className="flex gap-2 rounded-lg border border-white/10 bg-black/20 p-2"><Input value={input} onChange={event => onInput(event.target.value)} onKeyDown={event => event.key === "Enter" && onSend()} placeholder="Reply to thread" className="h-8 border-0 bg-transparent shadow-none focus-visible:ring-0" data-testid="thread-input" /><Button size="sm" onClick={onSend} disabled={!input.trim()} className="h-8 w-8 bg-emerald-600 p-0 hover:bg-emerald-500"><Send className="h-3.5 w-3.5" /></Button></div></div>
    </aside>
  );
}

export function NewConversationDialog({ open, onOpenChange, users, currentUserId, headers, onCreated }) {
  const [tab, setTab] = useState("dm");
  const [selected, setSelected] = useState([]);
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [privateChannel, setPrivateChannel] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setSelected([]); setSearch(""); setName(""); setDescription(""); setPrivateChannel(false); setTab("dm"); } }, [open]);
  const candidates = users.filter(user => user.id !== currentUserId && (!search || `${user.name} ${user.email}`.toLowerCase().includes(search.toLowerCase())));
  const toggle = id => setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  const create = async () => {
    setBusy(true);
    try {
      let response;
      if (tab === "dm") response = await axios.post(`${API}/chat/dm/${selected[0]}`, {}, { headers });
      else if (tab === "group") response = await axios.post(`${API}/chat/group-dm`, { member_ids: selected, name: name.trim() || undefined }, { headers });
      else response = await axios.post(`${API}/chat/channels`, { name, description, is_private: privateChannel, member_ids: privateChannel ? selected : [] }, { headers });
      onCreated(response.data);
      toast.success(tab === "channel" ? "Channel created" : "Conversation opened");
    } catch (requestError) {
      toast.error(requestError?.response?.data?.detail || "Conversation could not be created");
    } finally { setBusy(false); }
  };
  const invalid = tab === "dm" ? selected.length !== 1 : tab === "group" ? selected.length < 2 : name.trim().length < 2;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <NexusWorkflowDialog
        eyebrow="Audited collaboration workflow"
        title="Start collaborating"
        description="Open a private conversation, assemble an operational group, or create a governed channel with a clear purpose and access boundary."
        icon={MessageSquarePlus}
        tone="emerald"
        className="max-h-[90vh] max-w-2xl"
        contentClassName="overflow-y-auto"
        data-testid="collaboration-workflow"
        footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={create} disabled={invalid || busy} className="min-w-32 bg-emerald-600 hover:bg-emerald-500">{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{tab === "channel" ? "Create channel" : "Start chat"}</Button></>}
      >
        <Tabs value={tab} onValueChange={value => { setTab(value); setSelected([]); setName(""); }}>
          <TabsList className="grid h-11 w-full grid-cols-3 rounded-xl border border-white/5 bg-black/25 p-1"><TabsTrigger value="dm" className="rounded-lg">Direct</TabsTrigger><TabsTrigger value="group" className="rounded-lg">Group chat</TabsTrigger><TabsTrigger value="channel" className="rounded-lg">Channel</TabsTrigger></TabsList>
          <div className="mt-4 rounded-xl border border-white/5 bg-white/[0.02] p-4">
            <TabsContent value="dm" className="mt-0 space-y-3"><p className="text-xs text-zinc-500">Choose one technician. Existing conversations reopen instead of creating duplicates.</p><UserSearch value={search} onChange={setSearch} /><UserPicker candidates={candidates} selected={selected} onToggle={id => setSelected([id])} /></TabsContent>
            <TabsContent value="group" className="mt-0 space-y-3"><p className="text-xs text-zinc-500">Bring at least two technicians into a focused handover or working group.</p><Input value={name} onChange={event => setName(event.target.value.slice(0, 80))} placeholder="Group name (optional)" className="border-white/10 bg-black/20" /><UserSearch value={search} onChange={setSearch} /><UserPicker candidates={candidates} selected={selected} onToggle={toggle} /></TabsContent>
            <TabsContent value="channel" className="mt-0 space-y-3"><p className="text-xs text-zinc-500">Create a durable workspace for a service, project, incident stream, or technical discipline.</p><Input value={name} onChange={event => setName(event.target.value.replace(/\s+/g, "-").toLowerCase().slice(0, 50))} placeholder="Channel name" className="border-white/10 bg-black/20" data-testid="channel-name-new" /><Textarea value={description} onChange={event => setDescription(event.target.value.slice(0, 240))} placeholder="Purpose, scope, and what belongs in this channel" className="min-h-24 border-white/10 bg-black/20" /><label className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/5 bg-black/15 p-3 transition hover:border-cyan-500/20"><input type="checkbox" checked={privateChannel} onChange={event => setPrivateChannel(event.target.checked)} className="accent-emerald-500" /><div><p className="text-sm font-medium">Private channel</p><p className="text-xs text-zinc-500">Only selected members can discover and read this channel.</p></div></label>{privateChannel && <><UserSearch value={search} onChange={setSearch} /><UserPicker candidates={candidates} selected={selected} onToggle={toggle} /></>}</TabsContent>
          </div>
        </Tabs>
      </NexusWorkflowDialog>
    </Dialog>
  );
}

export function UserSearch({ value, onChange }) {
  return <div className="relative mt-3"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" /><Input value={value} onChange={event => onChange(event.target.value)} placeholder="Find teammates" className="border-white/10 bg-black/20 pl-9" /></div>;
}

export function UserPicker({ candidates, selected, onToggle }) {
  return <ScrollArea className="h-64 rounded-lg border border-white/5"><div className="p-1">{candidates.map(candidate => { const checked = selected.includes(candidate.id); return <button key={candidate.id} onClick={() => onToggle(candidate.id)} className={`flex w-full items-center gap-3 rounded-lg p-2 text-left ${checked ? "bg-cyan-500/15" : "hover:bg-white/[0.04]"}`}><TechnicianAvatar name={candidate.name} avatarUrl={candidate.avatar} className="h-9 w-9" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{candidate.name}</p><p className="truncate text-xs text-zinc-600">{candidate.email}</p></div>{checked && <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500"><Check className="h-3 w-3" /></span>}</button>; })}{candidates.length === 0 && <p className="p-8 text-center text-sm text-zinc-600">No teammates found</p>}</div></ScrollArea>;
}

export function ConversationWelcome({ channel }) {
  return <div className="flex h-full min-h-[360px] flex-col items-center justify-center px-6 text-center"><ChannelAvatar channel={channel} presence={null} size="md" /><h3 className="mt-4 text-xl font-semibold">Welcome to {channelDisplayName(channel)}</h3><p className="mt-2 max-w-md text-sm text-zinc-500">{channel.description || (channel.kind === "team" ? "Share the operational context that keeps everyone aligned." : "This private conversation is ready when you are.")}</p></div>;
}

export function EmptyWorkspace({ onNew }) {
  return <div className="flex flex-1 flex-col items-center justify-center p-8 text-center"><div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-emerald-500/15"><MessageCircle className="h-9 w-9 text-emerald-400" /></div><h2 className="mt-5 text-2xl font-semibold">Nexus Chat, built for the work</h2><p className="mt-2 max-w-md text-sm text-zinc-500">Keep private conversations, operational channels, files, and ticket context in one secure workspace.</p><Button onClick={onNew} className="mt-5 bg-emerald-600 hover:bg-emerald-500"><Plus className="mr-2 h-4 w-4" />Start collaborating</Button></div>;
}

export function EmptyContent({ icon: Icon, title, body }) {
  return <div className="rounded-xl border border-dashed border-white/10 p-12 text-center"><Icon className="mx-auto h-8 w-8 text-zinc-700" /><h4 className="mt-3 font-medium">{title}</h4><p className="mt-1 text-sm text-zinc-600">{body}</p></div>;
}

export function ConversationSkeleton() {
  return <div className="space-y-2 p-2">{[1, 2, 3, 4, 5].map(item => <div key={item} className="flex animate-pulse gap-3 p-2"><div className="h-10 w-10 rounded-full bg-white/5" /><div className="flex-1 space-y-2"><div className="h-3 w-2/3 rounded bg-white/5" /><div className="h-2.5 w-full rounded bg-white/[0.03]" /></div></div>)}</div>;
}

export function DayDivider({ label }) {
  return <div className="my-5 flex items-center gap-3"><div className="h-px flex-1 bg-white/5" /><span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">{label}</span><div className="h-px flex-1 bg-white/5" /></div>;
}

export function TypingIndicator({ users }) {
  return <div className="ml-12 mt-2 flex items-center gap-2 text-xs text-zinc-500"><span className="flex -space-x-1">{users.slice(0, 3).map(person => <TechnicianAvatar key={person.user_id} name={person.user_name} avatarUrl={person.avatar_url || person.avatar} className="h-6 w-6 border border-[#1d1f26]" fallbackClassName="text-[8px]" />)}</span><span className="flex gap-1 rounded-full bg-white/5 px-3 py-2"><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500" /><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:120ms]" /><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:240ms]" /></span>{users.map(person => person.user_name).join(", ")} typing</div>;
}

export function ComposerButton({ icon: Icon, label, onClick }) {
  return <button type="button" onClick={onClick} title={label} aria-label={label} className="rounded-md p-2 text-zinc-500 transition hover:bg-cyan-500/10 hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"><Icon className="h-4 w-4" /></button>;
}

export function SuggestionPanel({ children, title, className = "" }) {
  return <div className={`absolute left-0 z-30 mb-2 max-h-72 w-full overflow-y-auto rounded-xl border border-white/10 bg-[#252832] py-1 shadow-2xl ${className}`}><p className="border-b border-white/5 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">{title}</p>{children}</div>;
}
