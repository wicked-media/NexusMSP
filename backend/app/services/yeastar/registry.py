"""Declarative catalogue of the Yeastar P-Series OpenAPI surface.

The integration previously exposed four hand-written read endpoints, so every
new PBX capability needed another bespoke route, service call and UI branch.
This module describes the provider's interfaces once, as data, and lets a
single gated dispatcher serve them.

Two rules keep that safe:

* An operation is reachable only if it appears here, so the dispatcher can
  never be talked into calling an arbitrary provider path with the tenant's
  credentials.
* ``access == "write"`` names the Nexus action permission the caller must
  hold, and ``destructive`` marks the calls that remove provider state.

``proxied`` operations return a provider-side download URL.  Those URLs must
never reach the browser (see ``docs/DATA_OWNERSHIP.md``); they are served
through the Nexus streaming endpoints instead, and the generic dispatcher
refuses them.
"""
from __future__ import annotations

from dataclasses import dataclass, field

READ = "read"
WRITE = "write"
ALLOWED_METHODS = frozenset({"GET", "POST"})


@dataclass(frozen=True)
class Operation:
    """One callable Yeastar interface, described as data."""

    id: str
    category: str
    method: str
    path: str
    summary: str
    access: str = READ
    version: str = "1.0"
    action: str | None = None
    destructive: bool = False
    proxied: bool = False
    params: tuple[str, ...] = field(default_factory=tuple)

    @property
    def is_write(self) -> bool:
        return self.access == WRITE


def _op(
    op_id: str,
    category: str,
    method: str,
    path: str,
    summary: str,
    *,
    access: str = READ,
    version: str = "1.0",
    action: str | None = None,
    destructive: bool = False,
    proxied: bool = False,
    params: tuple[str, ...] = (),
) -> Operation:
    return Operation(
        id=op_id,
        category=category,
        method=method,
        path=path,
        summary=summary,
        access=access,
        version=version,
        action=action,
        destructive=destructive,
        proxied=proxied,
        params=params,
    )


# Read pagination keys accepted by the list-style interfaces.
_PAGE = ("page", "page_size")


OPERATIONS: tuple[Operation, ...] = (
    # --- System ---------------------------------------------------------
    _op("system.information", "System", "GET", "system/information", "PBX model, firmware, serial and uptime."),
    _op("system.capacity", "System", "GET", "system/capacity", "Extension, concurrent-call and AI capacity usage."),
    _op("system.menu_options", "System", "GET", "system/get_menuoptions", "Selectable IDs and names for PBX features."),
    _op("system.timezones", "System", "GET", "timezone/list", "Time zone list for scheduling."),
    # --- Extension ------------------------------------------------------
    _op("extension.list", "Extension", "GET", "extension/list", "Every extension with presence and registration."),
    _op("extension.search", "Extension", "GET", "extension/search", "Search extensions by number or name.", params=("search",) + _PAGE),
    _op("extension.get", "Extension", "GET", "extension/get", "One extension's full configuration.", params=("id",)),
    _op("extension.query", "Extension", "GET", "extension/query", "Several extensions in one call."),
    _op(
        "extension.credentials",
        "Extension",
        "GET",
        "extension/getpassword",
        "Registration password and voicemail PIN. Audited on every read.",
        action="voice.extension.secret.read",
        params=("id",),
    ),
    _op("extension.create", "Extension", "POST", "extension/create", "Add an extension.", access=WRITE, action="voice.extension.manage"),
    _op("extension.update", "Extension", "POST", "extension/update", "Edit an extension.", access=WRITE, action="voice.extension.manage"),
    _op(
        "extension.delete",
        "Extension",
        "GET",
        "extension/delete",
        "Delete an extension and its configuration.",
        access=WRITE,
        action="voice.extension.manage",
        destructive=True,
        params=("id",),
    ),
    _op(
        "extension.welcome_email",
        "Extension",
        "POST",
        "extension/send_welcome_email",
        "Send Linkus welcome mail so a starter's softphone self-installs.",
        access=WRITE,
        action="voice.extension.manage",
    ),
    _op("extension.group_list", "Extension", "GET", "extension_group/list", "Extension groups (departments)."),
    _op("extension.group_get", "Extension", "GET", "extension_group/get", "One extension group.", params=("id",)),
    _op("extension.group_create", "Extension", "POST", "extension_group/create", "Add an extension group.", access=WRITE, action="voice.extension.manage"),
    _op("extension.group_update", "Extension", "POST", "extension_group/update", "Edit an extension group.", access=WRITE, action="voice.extension.manage"),
    _op(
        "extension.group_delete",
        "Extension",
        "GET",
        "extension_group/delete",
        "Delete an extension group.",
        access=WRITE,
        action="voice.extension.manage",
        destructive=True,
        params=("id",),
    ),
    # --- Organisation ---------------------------------------------------
    _op("organization.list", "Organisation", "GET", "organization/list", "Organisation directory used by routing and reporting."),
    _op("organization.get", "Organisation", "GET", "organization/get", "One organisation node.", params=("id",)),
    # --- Trunk ----------------------------------------------------------
    _op("trunk.list", "Trunk", "GET", "trunk/list", "SIP trunks with registration state."),
    _op("trunk.search", "Trunk", "GET", "trunk/search", "Search trunks by name.", params=("search",) + _PAGE),
    _op("trunk.get", "Trunk", "GET", "trunk/get", "One trunk's configuration.", params=("id",)),
    _op("trunk.itsp_list", "Trunk", "GET", "trunk/itsp_list", "Available ITSP SIP trunk providers."),
    _op("trunk.create", "Trunk", "POST", "trunk/create", "Add a SIP trunk.", access=WRITE, action="voice.continuity.manage"),
    _op("trunk.update", "Trunk", "POST", "trunk/update", "Edit a SIP trunk.", access=WRITE, action="voice.continuity.manage"),
    _op(
        "trunk.delete",
        "Trunk",
        "GET",
        "trunk/delete",
        "Delete a SIP trunk.",
        access=WRITE,
        action="voice.continuity.manage",
        destructive=True,
        params=("id",),
    ),
    # --- Contacts and phonebook ----------------------------------------
    _op("contact.list", "Contacts", "GET", "company_contact/list", "Company-wide PBX contacts.", params=_PAGE),
    _op("contact.search", "Contacts", "GET", "company_contact/search", "Search company contacts.", params=("search",) + _PAGE),
    _op("contact.create", "Contacts", "POST", "company_contact/create", "Add a company contact.", access=WRITE, action="voice.routing.manage"),
    _op("contact.update", "Contacts", "POST", "company_contact/update", "Edit a company contact.", access=WRITE, action="voice.routing.manage"),
    _op("phonebook.list", "Contacts", "GET", "phonebook/list", "PBX phonebooks.", params=_PAGE),
    _op("phonebook.create", "Contacts", "POST", "phonebook/create", "Add a phonebook.", access=WRITE, action="voice.routing.manage"),
    # --- Handset fleet --------------------------------------------------
    _op("phone.search", "Handset fleet", "GET", "phone/search", "Desk phones with model, template and status.", params=("search",) + _PAGE),
    _op("phone.get", "Handset fleet", "GET", "phone/get", "One desk phone.", params=("id",)),
    _op("phone.compatibility", "Handset fleet", "GET", "auto_provisioning/compatibility", "Models and options available to auto provisioning."),
    _op("phone.batch_create", "Handset fleet", "POST", "phone/batchcreate", "Bulk-add handsets of one vendor and model.", access=WRITE, action="voice.provisioning.manage"),
    _op("phone.batch_update", "Handset fleet", "POST", "phone/batchupdate", "Bulk-edit handsets sharing a template.", access=WRITE, action="voice.provisioning.manage"),
    _op(
        "phone.batch_reprovision",
        "Handset fleet",
        "POST",
        "phone/batchreprovision",
        "Bulk re-provision handsets after a config change.",
        access=WRITE,
        action="voice.provisioning.manage",
    ),
    _op("phone.batch_reboot", "Handset fleet", "POST", "phone/batchreboot", "Bulk reboot handsets.", access=WRITE, action="voice.provisioning.manage"),
    _op(
        "phone.batch_delete",
        "Handset fleet",
        "POST",
        "phone/batchdelete",
        "Bulk-delete handsets.",
        access=WRITE,
        action="voice.provisioning.manage",
        destructive=True,
    ),
    # --- Routing --------------------------------------------------------
    _op("routing.inbound_list", "Routing", "GET", "inbound_route/list", "Inbound routes (DID to destination).", params=_PAGE),
    _op("routing.inbound_get", "Routing", "GET", "inbound_route/get", "One inbound route.", params=("id",)),
    _op("routing.inbound_create", "Routing", "POST", "inbound_route/create", "Add an inbound route.", access=WRITE, action="voice.routing.manage"),
    _op("routing.inbound_update", "Routing", "POST", "inbound_route/update", "Edit an inbound route.", access=WRITE, action="voice.routing.manage"),
    _op(
        "routing.inbound_delete",
        "Routing",
        "GET",
        "inbound_route/delete",
        "Delete an inbound route.",
        access=WRITE,
        action="voice.routing.manage",
        destructive=True,
        params=("id",),
    ),
    _op("routing.outbound_list", "Routing", "GET", "outbound_route/list", "Outbound routes and their trunk order.", params=_PAGE),
    _op("routing.outbound_create", "Routing", "POST", "outbound_route/create", "Add an outbound route.", access=WRITE, action="voice.routing.manage"),
    _op("routing.outbound_update", "Routing", "POST", "outbound_route/update", "Edit an outbound route.", access=WRITE, action="voice.routing.manage"),
    _op(
        "routing.outbound_delete",
        "Routing",
        "GET",
        "outbound_route/delete",
        "Delete an outbound route.",
        access=WRITE,
        action="voice.routing.manage",
        destructive=True,
        params=("id",),
    ),
    # --- IVR, ring group, conference, paging ----------------------------
    _op("ivr.list", "Routing", "GET", "ivr/list", "IVR menus.", params=_PAGE),
    _op("ivr.get", "Routing", "GET", "ivr/get", "One IVR menu.", params=("id",)),
    _op("ivr.create", "Routing", "POST", "ivr/create", "Add an IVR menu.", access=WRITE, action="voice.routing.manage"),
    _op("ivr.update", "Routing", "POST", "ivr/update", "Edit an IVR menu.", access=WRITE, action="voice.routing.manage"),
    _op("ivr.delete", "Routing", "GET", "ivr/delete", "Delete an IVR menu.", access=WRITE, action="voice.routing.manage", destructive=True, params=("id",)),
    _op("ringgroup.list", "Routing", "GET", "ringgroup/list", "Ring groups.", params=_PAGE),
    _op("ringgroup.get", "Routing", "GET", "ringgroup/get", "One ring group with its members.", params=("id",)),
    _op("ringgroup.create", "Routing", "POST", "ringgroup/create", "Add a ring group.", access=WRITE, action="voice.routing.manage"),
    _op("ringgroup.update", "Routing", "POST", "ringgroup/update", "Edit a ring group.", access=WRITE, action="voice.routing.manage"),
    _op(
        "ringgroup.delete",
        "Routing",
        "GET",
        "ringgroup/delete",
        "Delete a ring group.",
        access=WRITE,
        action="voice.routing.manage",
        destructive=True,
        params=("id",),
    ),
    _op("ringgroup.options", "Routing", "GET", "ringgroup/getoptions", "Global ring group defaults."),
    _op("conference.list", "Routing", "GET", "conference/list", "Scheduled conferences.", params=_PAGE),
    _op("conference.ongoing", "Routing", "GET", "conference/query_ongoing_conference", "Conferences in progress."),
    _op("conference.create", "Routing", "POST", "conference/create", "Schedule a conference.", access=WRITE, action="voice.routing.manage"),
    _op("paging.list", "Routing", "GET", "paging/list", "Paging groups.", params=_PAGE),
    _op("paging.create", "Routing", "POST", "paging/create", "Add a paging group.", access=WRITE, action="voice.routing.manage"),
    # --- Queue ----------------------------------------------------------
    _op("queue.list", "Queue", "GET", "queue/list", "Call queues with their members.", params=_PAGE),
    _op("queue.get", "Queue", "GET", "queue/get", "One queue's configuration.", params=("id",)),
    _op("queue.call_status", "Queue", "GET", "queue/call_status", "Live queue depth, waiting callers and longest wait.", params=("queue_id",)),
    _op("queue.agent_status", "Queue", "GET", "queue/agent_status", "Agent login and pause state per queue.", params=("queue_id",)),
    _op("queue.pause_reasons", "Queue", "GET", "queue_pause_reason/list", "Configured pause reasons."),
    _op("queue.options", "Queue", "GET", "queue_option/get", "Global queue settings."),
    _op("queue.create", "Queue", "POST", "queue/create", "Add a queue.", access=WRITE, action="voice.queue.manage"),
    _op("queue.update", "Queue", "POST", "queue/update", "Edit a queue.", access=WRITE, action="voice.queue.manage"),
    _op("queue.delete", "Queue", "GET", "queue/delete", "Delete a queue.", access=WRITE, action="voice.queue.manage", destructive=True, params=("id",)),
    _op("queue.pause_reasons_update", "Queue", "POST", "queue_pause_reason/update", "Edit pause reasons.", access=WRITE, action="voice.queue.manage"),
    _op(
        "queue.agent_login",
        "Queue",
        "GET",
        "queue/agent_login",
        "Log an agent in to or out of a queue.",
        access=WRITE,
        action="voice.queue.manage",
        params=("queue_id", "ext_id", "action"),
    ),
    _op(
        "queue.agent_pause",
        "Queue",
        "GET",
        "queue/agent_pause",
        "Pause or unpause a queue agent.",
        access=WRITE,
        action="voice.queue.manage",
        params=("queue_id", "ext_id", "action", "reason"),
    ),
    _op("agent.login", "Queue", "GET", "agent/login", "Agent login across queues.", access=WRITE, action="voice.queue.manage", params=("ext_id", "action")),
    _op("agent.pause", "Queue", "GET", "agent/pause", "Agent pause across queues.", access=WRITE, action="voice.queue.manage", params=("ext_id", "action")),
    # --- Calls ----------------------------------------------------------
    _op("call.active", "Calls", "GET", "call/query", "Calls in progress."),
    _op("cdr.list", "Calls", "GET", "cdr/list", "Call detail records (v1.0).", params=_PAGE + ("start_time", "end_time")),
    _op("cdr.list_v2", "Calls", "GET", "cdr/list", "Call detail records with the fuller v2.0 field set.", version="2.0", params=_PAGE + ("start_time", "end_time")),
    _op("call.note_get", "Calls", "GET", "callnotes/get", "The note attached to a call.", params=("call_id",)),
    _op(
        "call.note_update",
        "Calls",
        "POST",
        "callnotes/update",
        "Attach or edit the note on a call.",
        access=WRITE,
        action="voice.calls.annotate",
    ),
    # --- Voicemail ------------------------------------------------------
    _op("voicemail.group_list", "Voicemail", "GET", "vm_group/list", "Group voicemail boxes."),
    _op("voicemail.query", "Voicemail", "GET", "vm/query", "Voicemail messages for extensions or groups.", params=("ext_id",) + _PAGE),
    _op("voicemail.get", "Voicemail", "GET", "vm/get", "One voicemail message's metadata.", params=("ext_id", "msg_id")),
    _op("voicemail.download", "Voicemail", "GET", "vm/download", "Provider URL for a voicemail message.", proxied=True, params=("ext_id", "msg_id")),
    _op("voicemail.create", "Voicemail", "POST", "vm/create", "Add a voicemail message.", access=WRITE, action="voice.compliance.manage"),
    _op("voicemail.mark_read", "Voicemail", "POST", "vm/update", "Update a message's read status.", access=WRITE, action="voice.compliance.manage"),
    _op(
        "voicemail.delete",
        "Voicemail",
        "GET",
        "vm/delete",
        "Delete a voicemail message.",
        access=WRITE,
        action="voice.compliance.manage",
        destructive=True,
        params=("ext_id", "msg_id"),
    ),
    # --- Recording ------------------------------------------------------
    _op("recording.list", "Recording", "GET", "recording/list", "Call recordings held on the PBX.", params=_PAGE),
    _op("recording.search", "Recording", "GET", "recording/search", "Search recordings by caller, callee or time.", params=("search", "start_time", "end_time") + _PAGE),
    _op(
        "recording.download",
        "Recording",
        "GET",
        "recording/download",
        "Provider URL for a recording.",
        proxied=True,
        params=("id", "file", "recording_id"),
    ),
    _op(
        "recording.play",
        "Recording",
        "GET",
        "recording/playtoextension",
        "Play a recording to an extension's handset.",
        access=WRITE,
        action="voice.recording.listen",
        params=("id", "ext_id"),
    ),
    # --- Compliance -----------------------------------------------------
    _op("autorecord.get", "Compliance", "GET", "autorecord/get", "Automatic recording settings."),
    _op("autorecord.update", "Compliance", "POST", "autorecord/update", "Change automatic recording settings.", access=WRITE, action="voice.compliance.manage"),
    _op("block_numbers.list", "Compliance", "GET", "block_numbers/list", "Call blocklist rules.", params=_PAGE),
    _op("block_numbers.create", "Compliance", "POST", "block_numbers/create", "Add a blocklist rule.", access=WRITE, action="voice.compliance.manage"),
    _op(
        "block_numbers.delete",
        "Compliance",
        "GET",
        "block_numbers/delete",
        "Delete a blocklist rule.",
        access=WRITE,
        action="voice.compliance.manage",
        destructive=True,
        params=("id",),
    ),
    _op("allow_numbers.list", "Compliance", "GET", "allow_numbers/list", "Call allowlist rules.", params=_PAGE),
    _op("allow_numbers.create", "Compliance", "POST", "allow_numbers/create", "Add an allowlist rule.", access=WRITE, action="voice.compliance.manage"),
    _op(
        "allow_numbers.delete",
        "Compliance",
        "GET",
        "allow_numbers/delete",
        "Delete an allowlist rule.",
        access=WRITE,
        action="voice.compliance.manage",
        destructive=True,
        params=("id",),
    ),
    _op("pin_list.list", "Compliance", "GET", "pin_list/list", "PIN lists that gate outbound calling.", params=_PAGE),
    _op("pin_list.create", "Compliance", "POST", "pin_list/create", "Add a PIN list.", access=WRITE, action="voice.compliance.manage"),
    # --- Prompts and audio ---------------------------------------------
    _op("prompt.preference_get", "Prompts", "GET", "prompt_preference/get", "System prompt preference."),
    _op("prompt.system_list", "Prompts", "GET", "system_prompt/list", "Installed system prompt languages."),
    _op("prompt.custom_list", "Prompts", "GET", "custom_prompt/list", "Custom prompts.", params=_PAGE),
    _op("prompt.custom_create", "Prompts", "POST", "custom_prompt/create", "Create a prompt from text to speech.", access=WRITE, action="voice.prompts.manage"),
    _op("prompt.moh_list", "Prompts", "GET", "play_list/list", "Music-on-hold playlists."),
    _op("prompt.moh_files", "Prompts", "GET", "moh_files/list", "Music-on-hold audio files."),
    _op("prompt.ringtone_list", "Prompts", "GET", "custom_ringtone/list", "Custom ringtones."),
    # --- Continuity -----------------------------------------------------
    _op("storage.list", "Continuity", "GET", "storage/list", "Storage devices and free space for recordings."),
    _op("system_log.list", "Continuity", "GET", "system_log/list", "PBX system logs.", params=_PAGE),
    _op("system_log.download", "Continuity", "GET", "system_log/download", "Provider URL for system log files.", proxied=True),
    _op("backup.list", "Continuity", "GET", "backup/list", "PBX configuration backups.", params=_PAGE),
    _op("backup.get", "Continuity", "GET", "backup/get", "One backup file.", params=("id",)),
    _op("backup.status", "Continuity", "GET", "backup/getstatus", "Status of a backup job.", params=("id",)),
    _op("backup.download", "Continuity", "GET", "backup/download", "Provider URL for a backup file.", proxied=True, params=("id",)),
    _op("backup.create", "Continuity", "POST", "backup/create", "Start a PBX configuration backup.", access=WRITE, action="voice.continuity.manage"),
    _op(
        "backup.delete",
        "Continuity",
        "GET",
        "backup/delete",
        "Delete a PBX backup file.",
        access=WRITE,
        action="voice.continuity.manage",
        destructive=True,
        params=("id",),
    ),
    _op("monitor.extension_status", "Continuity", "GET", "extension_status_monitor/list", "API extension-status monitoring settings."),
    _op(
        "monitor.extension_status_update",
        "Continuity",
        "POST",
        "extension_status_monitor/update",
        "Change extension-status monitoring.",
        access=WRITE,
        action="voice.continuity.manage",
    ),
    _op("monitor.trunk_status", "Continuity", "GET", "trunk_status_monitor/list", "API trunk-status monitoring settings."),
    _op(
        "monitor.trunk_status_update",
        "Continuity",
        "POST",
        "trunk_status_monitor/update",
        "Change trunk-status monitoring.",
        access=WRITE,
        action="voice.continuity.manage",
    ),
    _op("webhook.query", "Continuity", "GET", "webhook/query", "Event push settings for this PBX."),
    _op("webhook.update", "Continuity", "POST", "webhook/update", "Change event push settings.", access=WRITE, action="voice.continuity.manage"),
    _op("audio.stream_get", "Continuity", "GET", "websocketaudiostream/get", "WebSocket audio streaming settings."),
    _op(
        "audio.stream_update",
        "Continuity",
        "POST",
        "websocketaudiostream/update",
        "Change WebSocket audio streaming settings.",
        access=WRITE,
        action="voice.continuity.manage",
    ),
    # --- Messaging ------------------------------------------------------
    _op("message.channel_list", "Messaging", "GET", "message_channel/list", "SMS, WhatsApp, Facebook and Live Chat channels."),
    _op("message.channel_get", "Messaging", "GET", "message_channel/get", "One message channel.", params=("id",)),
    _op("message.queue_list", "Messaging", "GET", "message_queue/list", "Message queues."),
    _op("message.session_list", "Messaging", "GET", "message_session/list", "Message sessions.", params=_PAGE),
    _op("message.campaign_list", "Messaging", "GET", "message_campaign/list", "Message campaigns.", params=_PAGE),
    _op("message.get", "Messaging", "GET", "message/get", "Messages inside a session.", params=("session_id",) + _PAGE),
    _op("message.send", "Messaging", "POST", "message/send", "Send a message or open a session.", access=WRITE, action="voice.messaging.manage"),
    _op("message.session_close", "Messaging", "POST", "message_session/close", "Close a message session.", access=WRITE, action="voice.messaging.manage"),
    _op("message.session_archive", "Messaging", "POST", "message_session/archive", "Archive a message session.", access=WRITE, action="voice.messaging.manage"),
)


OPERATION_BY_ID: dict[str, Operation] = {operation.id: operation for operation in OPERATIONS}

# Every action a write or sensitive read can require. Routers assert against
# this set so a typo in the catalogue fails fast instead of gating on nothing.
REQUIRED_ACTIONS = frozenset(
    operation.action for operation in OPERATIONS if operation.action is not None
)


def get_operation(operation_id: str) -> Operation | None:
    return OPERATION_BY_ID.get(operation_id)


def dispatcher_operations() -> tuple[Operation, ...]:
    """Operations the generic dispatcher may serve.

    Proxied operations are excluded: their responses carry a provider download
    URL, and a URL that authorises a download must not be handed to a browser.
    """
    return tuple(operation for operation in OPERATIONS if not operation.proxied)


def catalogue() -> list[dict]:
    """Grouped, browser-safe description of the available capability."""
    grouped: dict[str, list[dict]] = {}
    for operation in OPERATIONS:
        grouped.setdefault(operation.category, []).append(
            {
                "id": operation.id,
                "method": operation.method,
                "summary": operation.summary,
                "access": operation.access,
                "destructive": operation.destructive,
                "proxied": operation.proxied,
                "required_action": operation.action,
                "params": list(operation.params),
            }
        )
    return [
        {"category": category, "operations": sorted(items, key=lambda item: item["id"])}
        for category, items in sorted(grouped.items())
    ]
