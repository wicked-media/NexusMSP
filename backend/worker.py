"""Dedicated NexusMSP scheduler and event-worker process."""

from __future__ import annotations

import asyncio
import logging
import os

os.environ.setdefault("OTEL_SERVICE_NAME", "nexus-worker")

from app.database import client  # noqa: E402 - service identity must precede server import
from app.services.observability import (  # noqa: E402 - see service identity above
    mark_worker_started,
    mark_worker_stopped,
    shutdown_observability,
    start_worker_metrics_server,
)
from server import background_worker_specs  # noqa: E402


logger = logging.getLogger("nexus.worker")


async def _guard_worker(name: str, worker) -> None:
    failed = False
    mark_worker_started(name)
    try:
        await worker()
    except asyncio.CancelledError:
        raise
    except Exception:
        failed = True
        logger.exception("worker_loop_failed worker=%s", name)
        raise
    finally:
        mark_worker_stopped(name, failed=failed)


async def run_worker() -> None:
    start_worker_metrics_server()
    tasks = [
        asyncio.create_task(_guard_worker(name, worker), name=f"nexus-{name}")
        for name, worker in background_worker_specs()
    ]
    logger.info("Nexus worker started %s durable loops", len(tasks))
    try:
        await asyncio.gather(*tasks)
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        shutdown_observability()
        client.close()
        logger.info("Nexus worker stopped cleanly")


if __name__ == "__main__":
    try:
        asyncio.run(run_worker())
    except KeyboardInterrupt:
        pass
