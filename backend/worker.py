"""Dedicated NexusMSP scheduler and event-worker process."""

from __future__ import annotations

import asyncio
import logging

from app.database import client
from server import background_worker_specs


logger = logging.getLogger("nexus.worker")


async def run_worker() -> None:
    tasks = [
        asyncio.create_task(worker(), name=f"nexus-{name}")
        for name, worker in background_worker_specs()
    ]
    logger.info("Nexus worker started %s durable loops", len(tasks))
    try:
        await asyncio.gather(*tasks)
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        client.close()
        logger.info("Nexus worker stopped cleanly")


if __name__ == "__main__":
    try:
        asyncio.run(run_worker())
    except KeyboardInterrupt:
        pass
