"""Event publisher for notify channels (Slack/Teams/Discord webhooks).
Fire-and-forget — never blocks ticket creation."""
import asyncio, httpx, logging
from app.database import db

logger = logging.getLogger("notify_publish")


async def _send(ch: dict, text: str):
    payload = {"slack": {"text": text}, "teams": {"text": text}, "discord": {"content": text}}.get(ch.get("kind"), {"text": text})
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            await c.post(ch["webhook_url"], json=payload)
    except Exception as e:
        logger.warning(f"Notify webhook failed for {ch.get('name')}: {e}")


async def publish_event(event: str, text: str):
    """Find all active channels subscribed to `event` and post `text`."""
    try:
        channels = await db.notify_channels.find({"is_active": True, "events": event}, {"_id": 0}).to_list(50)
        await asyncio.gather(*[_send(c, text) for c in channels], return_exceptions=True)
    except Exception as e:
        logger.warning(f"publish_event error: {e}")


def fire(event: str, text: str):
    """Schedule publish without awaiting; safe in non-async paths."""
    try:
        loop = asyncio.get_event_loop()
        loop.create_task(publish_event(event, text))
    except Exception as e:
        logger.warning(f"fire error: {e}")
