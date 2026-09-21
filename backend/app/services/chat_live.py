"""Ephemeral, access-safe live update fan-out for Team Chat.

The message and channel collections remain the authoritative chat record. This
module carries only minimal invalidation signals to connected technicians; the
browser always re-reads through the normal permission-checked REST routes.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import AsyncIterator
from typing import Any


_subscribers: dict[str, tuple[str, asyncio.Queue[dict[str, Any]]]] = {}


def subscribe(user_id: str) -> tuple[str, asyncio.Queue[dict[str, Any]]]:
    subscriber_id = uuid.uuid4().hex
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=100)
    _subscribers[subscriber_id] = (str(user_id), queue)
    return subscriber_id, queue


def unsubscribe(subscriber_id: str) -> None:
    _subscribers.pop(subscriber_id, None)


def publish_channel_update(channel_id: str, kind: str, recipient_ids: list[str] | None = None) -> None:
    """Fan out a content-free event only to eligible connected technicians.

    ``recipient_ids=None`` means a company-wide channel. Private and direct
    channels must pass their membership list so an event cannot disclose a
    conversation's existence to another technician.
    """
    event = {"type": "chat.channel.updated", "channel_id": str(channel_id), "kind": str(kind)}
    recipients = {str(user_id) for user_id in recipient_ids or [] if user_id}
    for user_id, queue in list(_subscribers.values()):
        if recipient_ids is not None and user_id not in recipients:
            continue
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            # The REST refresh remains authoritative. Dropping a stale
            # invalidation is preferable to blocking a sensitive write.
            continue


async def stream_events(request: Any, user_id: str) -> AsyncIterator[str]:
    subscriber_id, queue = subscribe(user_id)
    try:
        while True:
            if await request.is_disconnected():
                break
            try:
                event = await asyncio.wait_for(queue.get(), timeout=25.0)
                yield f"data: {json.dumps(event)}\n\n"
            except asyncio.TimeoutError:
                yield "event: heartbeat\ndata: {}\n\n"
    finally:
        unsubscribe(subscriber_id)
