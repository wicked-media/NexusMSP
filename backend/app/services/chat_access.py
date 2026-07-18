"""Shared access control and presentation helpers for internal team chat."""

from __future__ import annotations

from typing import Any
import uuid

from fastapi import HTTPException

from app.database import db


DEFAULT_CHAT_CHANNELS = (
    ("general", "Company-wide announcements and day-to-day coordination"),
    ("ops", "High-signal operational coordination, escalations, and incident handovers"),
    ("service-desk", "Ticket handovers, dispatch coordination, and technician collaboration"),
    ("alerts", "Automated monitoring and security notifications that need team visibility"),
    ("random", "Social chat and everything outside normal operations"),
)


def is_chat_admin(user: dict) -> bool:
    role = str(user.get("role") or "").lower()
    return bool(user.get("is_admin") or role in {"admin", "owner"})


def channel_is_accessible(channel: dict, user: dict) -> bool:
    """Return whether a user can read a channel, including legacy channel rows."""
    uid = user.get("id")
    members = channel.get("member_ids") or []
    kind = channel.get("kind") or "team"

    if kind == "team":
        if is_chat_admin(user):
            return True
        if channel.get("is_private") is False:
            return True
        if "is_private" not in channel and not members:
            return True
    return bool(uid and uid in members)


def channel_visibility_query(user: dict) -> dict[str, Any]:
    uid = user.get("id")
    if is_chat_admin(user):
        return {"$or": [{"kind": "team"}, {"member_ids": uid}]}
    return {
        "$or": [
            {"kind": "team", "is_private": False},
            {"kind": "team", "is_private": {"$exists": False}, "member_ids": {"$size": 0}},
            {"member_ids": uid},
        ]
    }


async def require_channel_access(channel_id: str, user: dict) -> dict:
    channel = await db.chat_channels.find_one({"id": channel_id}, {"_id": 0})
    if not channel:
        raise HTTPException(404, "Channel not found")
    if not channel_is_accessible(channel, user):
        raise HTTPException(403, "You do not have access to this conversation")
    return channel


async def require_message_access(message_id: str, user: dict) -> tuple[dict, dict]:
    message = await db.chat_messages.find_one({"id": message_id}, {"_id": 0})
    if not message:
        raise HTTPException(404, "Message not found")
    channel = await require_channel_access(message.get("channel_id"), user)
    return message, channel


async def ensure_default_channels() -> None:
    for name, description in DEFAULT_CHAT_CHANNELS:
        existing = await db.chat_channels.find_one({"name": name, "kind": "team"}, {"_id": 0, "id": 1})
        if existing:
            continue
        now = _now_iso()
        await db.chat_channels.insert_one({
            "id": uuid.uuid4().hex,
            "name": name,
            "display_name": name.replace("-", " ").title(),
            "description": description,
            "kind": "team",
            "is_private": False,
            "is_dm": False,
            "member_ids": [],
            "created_by": "system",
            "created_at": now,
            "updated_at": now,
        })


async def initialize_chat_storage() -> None:
    """Create the read-path indexes used by polling, previews, and search."""
    await db.chat_channels.create_index([("kind", 1), ("is_private", 1), ("updated_at", -1)])
    await db.chat_channels.create_index([("member_ids", 1), ("updated_at", -1)])
    await db.chat_messages.create_index([("channel_id", 1), ("ts", -1)])
    await db.chat_messages.create_index([("thread_id", 1), ("ts", 1)])
    await db.chat_read_state.create_index([("user_id", 1), ("channel_id", 1)])
    await db.presence_state.create_index([("user_id", 1), ("last_heartbeat", -1)])
    await db.chat_typing.create_index([("channel_id", 1), ("ts", -1)])
    await ensure_default_channels()


async def enrich_channels(channels: list[dict], user: dict) -> list[dict]:
    """Hydrate DM names, member counts, and management flags for the UI."""
    uid = user.get("id")
    other_ids: set[str] = set()
    for channel in channels:
        if (channel.get("kind") or "") == "dm":
            other_ids.update(member for member in (channel.get("member_ids") or []) if member != uid)

    users_by_id: dict[str, dict] = {}
    if other_ids:
        cursor = db.users.find(
            {"id": {"$in": list(other_ids)}},
            {"_id": 0, "id": 1, "name": 1, "email": 1, "avatar": 1},
        )
        async for row in cursor:
            users_by_id[row["id"]] = row

    active_user_count: int | None = None
    result: list[dict] = []
    for source in channels:
        channel = dict(source)
        kind = channel.get("kind") or "team"
        members = list(channel.get("member_ids") or [])
        channel["is_dm"] = kind in {"dm", "group_dm"} or bool(channel.get("is_dm"))
        channel["is_group_dm"] = kind == "group_dm" or bool(channel.get("is_group_dm"))
        channel["is_private"] = bool(channel.get("is_private") or kind in {"dm", "group_dm"})

        if kind == "dm":
            other_id = next((member for member in members if member != uid), None)
            other = users_by_id.get(other_id) or {}
            channel["other_user_id"] = other_id
            channel["display_name"] = other.get("name") or other.get("email") or "Direct message"
            channel["name"] = channel["display_name"]
            channel["avatar"] = other.get("avatar")
            channel["member_count"] = 2
        elif kind == "team":
            channel["display_name"] = channel.get("display_name") or str(channel.get("name") or "channel").replace("-", " ").title()
            if not channel["is_private"]:
                if active_user_count is None:
                    active_user_count = await db.users.count_documents({"is_active": {"$ne": False}})
                channel["member_count"] = active_user_count
            else:
                channel["member_count"] = len(members)
        else:
            channel["display_name"] = channel.get("display_name") or channel.get("name") or "Group chat"
            channel["member_count"] = len(members)

        channel["can_manage"] = is_chat_admin(user) or channel.get("created_by") == uid
        result.append(channel)
    return result


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()
