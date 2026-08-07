"""Durable Nexus platform event delivery and replay.

MongoDB is the current persistence and checkpoint store.  The contracts in
this module deliberately avoid Mongo-specific fields so a JetStream transport
can be added later without changing publishers or subscribers.
"""

from __future__ import annotations

import asyncio
import base64
from datetime import datetime, timedelta, timezone
from fnmatch import fnmatchcase
import hashlib
import hmac
import json
import os
import secrets
from typing import Any
from urllib.parse import urlparse
import uuid

from cryptography.fernet import Fernet, InvalidToken
import httpx
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.database import JWT_SECRET, db


DEFAULT_RETENTION_DAYS = max(30, int(os.environ.get("NEXUS_EVENT_RETENTION_DAYS", "90")))
MAX_DELIVERY_ATTEMPTS = max(3, int(os.environ.get("NEXUS_EVENT_MAX_ATTEMPTS", "6")))
DELIVERY_BACKOFF_SECONDS = (15, 60, 300, 900, 3600, 14400)
EVENT_INTEGRITY_VERSION = 1
EVENT_CHAIN_GENESIS = "0" * 64
_INDEX_LOCK = asyncio.Lock()
_INDEXES_READY = False


def utc_now_dt() -> datetime:
    return datetime.now(timezone.utc)


def utc_now() -> str:
    return utc_now_dt().isoformat()


def subject_matches(subject: str, patterns: list[str] | tuple[str, ...]) -> bool:
    """Match a dotted subject against exact or shell-style wildcard patterns."""
    value = str(subject or "").strip().lower()
    return any(fnmatchcase(value, str(pattern or "").strip().lower()) for pattern in patterns)


def retry_delay_seconds(attempt: int) -> int:
    index = max(0, min(int(attempt or 1) - 1, len(DELIVERY_BACKOFF_SECONDS) - 1))
    return DELIVERY_BACKOFF_SECONDS[index]


def canonical_event_evidence(event: dict) -> dict:
    """Return only the immutable envelope fields protected by the event seal."""
    return {
        "id": event.get("id"),
        "subject": event.get("subject"),
        "schema_version": event.get("schema_version"),
        "source": event.get("source"),
        "tenant_id": event.get("tenant_id"),
        "client_id": event.get("client_id"),
        "correlation_id": event.get("correlation_id"),
        "causation_id": event.get("causation_id"),
        "actor": event.get("actor") or {},
        "payload": event.get("payload") or {},
        "occurred_at": event.get("occurred_at"),
        "partition_key": event.get("partition_key"),
        "sequence": event.get("sequence"),
        "published_at": event.get("published_at"),
    }


def event_content_hash(event: dict) -> str:
    payload = json.dumps(
        canonical_event_evidence(event),
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def previous_event_hash(previous: dict | None) -> str:
    if not previous:
        return EVENT_CHAIN_GENESIS
    sealed = (previous.get("integrity") or {}).get("chain_hash")
    return sealed or f"legacy:{event_content_hash(previous)}"


def build_event_integrity(event: dict, previous: dict | None = None, *, origin: str = "native") -> dict:
    content_hash = event_content_hash(event)
    previous_hash = previous_event_hash(previous)
    chain_hash = hashlib.sha256(f"{previous_hash}:{content_hash}".encode("utf-8")).hexdigest()
    return {
        "version": EVENT_INTEGRITY_VERSION,
        "algorithm": "sha256",
        "content_hash": content_hash,
        "previous_hash": previous_hash,
        "chain_hash": chain_hash,
        "origin": origin,
        "sealed_at": utc_now(),
    }


def verify_event_integrity(event: dict, previous: dict | None = None) -> dict:
    """Verify one event's content seal and its link to the previous partition event."""
    integrity = event.get("integrity") or {}
    if not integrity:
        return {
            "status": "legacy",
            "content_verified": False,
            "chain_verified": False,
            "link_verified": None,
        }

    expected_content = event_content_hash(event)
    content_verified = hmac.compare_digest(
        str(integrity.get("content_hash") or ""),
        expected_content,
    )
    recorded_previous = str(integrity.get("previous_hash") or "")
    expected_chain = hashlib.sha256(
        f"{recorded_previous}:{expected_content}".encode("utf-8")
    ).hexdigest()
    chain_verified = hmac.compare_digest(
        str(integrity.get("chain_hash") or ""),
        expected_chain,
    )
    if previous is None:
        link_verified = True if recorded_previous == EVENT_CHAIN_GENESIS else None
    else:
        link_verified = hmac.compare_digest(recorded_previous, previous_event_hash(previous))

    if content_verified and chain_verified and link_verified is not False:
        status = "verified" if link_verified is True else "partial"
    else:
        status = "compromised"
    return {
        "status": status,
        "content_verified": content_verified,
        "chain_verified": chain_verified,
        "link_verified": link_verified,
        "origin": integrity.get("origin") or "unknown",
    }


def validate_subject_patterns(patterns: Any) -> list[str]:
    if not isinstance(patterns, (list, tuple)):
        raise ValueError("At least one event subject pattern is required")
    result = []
    for raw in patterns:
        value = str(raw or "").strip().lower().replace(" ", ".")
        if not value or value.startswith(".") or value.endswith("."):
            raise ValueError("Event subject patterns must use dotted names such as ticket.*")
        allowed = set("abcdefghijklmnopqrstuvwxyz0123456789._-*")
        if any(character not in allowed for character in value):
            raise ValueError(f"Invalid event subject pattern: {value}")
        result.append(value)
    if not result:
        raise ValueError("At least one event subject pattern is required")
    return sorted(set(result))


def validate_webhook_url(value: str) -> str:
    url = str(value or "").strip()
    parsed = urlparse(url)
    local_hosts = {"localhost", "127.0.0.1", "::1"}
    if parsed.username or parsed.password:
        raise ValueError("Webhook URLs cannot contain embedded credentials")
    if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in local_hosts):
        raise ValueError("Webhook delivery requires HTTPS; HTTP is allowed only for localhost")
    if not parsed.hostname:
        raise ValueError("A valid webhook host is required")
    return url


def _secret_cipher() -> Fernet:
    material = os.environ.get("NEXUS_EVENT_SECRET_KEY") or JWT_SECRET
    key = base64.urlsafe_b64encode(hashlib.sha256(material.encode("utf-8")).digest())
    return Fernet(key)


def encrypt_signing_secret(value: str) -> str:
    return _secret_cipher().encrypt(value.encode("utf-8")).decode("ascii")


def decrypt_signing_secret(value: str | None) -> str:
    if not value:
        return ""
    try:
        return _secret_cipher().decrypt(value.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError):
        return ""


async def ensure_event_backbone_indexes() -> None:
    global _INDEXES_READY
    if _INDEXES_READY:
        return
    async with _INDEX_LOCK:
        if _INDEXES_READY:
            return
        await db.platform_events.create_index("id", unique=True, name="event_id_unique")
        await db.platform_events.create_index(
            [("tenant_id", 1), ("idempotency_key", 1)],
            unique=True,
            name="event_idempotency_unique",
            partialFilterExpression={"idempotency_key": {"$type": "string"}},
        )
        await db.platform_events.create_index(
            [("partition_key", 1), ("sequence", 1)],
            name="event_partition_sequence",
        )
        await db.platform_events.create_index([("occurred_at", -1)], name="event_occurred_at")
        await db.platform_events.create_index([("subject", 1), ("occurred_at", -1)], name="event_subject_time")
        await db.platform_event_subscriptions.create_index("id", unique=True, name="event_subscription_id_unique")
        await db.platform_event_deliveries.create_index("id", unique=True, name="event_delivery_id_unique")
        await db.platform_event_deliveries.create_index("delivery_key", unique=True, name="event_delivery_key_unique")
        await db.platform_event_deliveries.create_index(
            [("status", 1), ("next_attempt_at", 1)],
            name="event_delivery_due",
        )
        await db.platform_event_replays.create_index("id", unique=True, name="event_replay_id_unique")
        _INDEXES_READY = True


async def backfill_legacy_event_metadata(limit: int = 10000) -> int:
    """Add ordering and retention metadata to pre-backbone event envelopes."""
    await ensure_event_backbone_indexes()
    events = await db.platform_events.find(
        {
            "$or": [
                {"partition_key": {"$exists": False}},
                {"sequence": {"$exists": False}},
                {"published_at": {"$exists": False}},
                {"retention_until": {"$exists": False}},
            ]
        },
        {"_id": 0},
    ).sort("occurred_at", 1).to_list(max(1, min(int(limit or 10000), 50000)))
    migrated = 0
    for event in events:
        partition_key = str(event.get("client_id") or event.get("tenant_id") or "nexus-local")
        occurred_at = str(event.get("occurred_at") or utc_now())
        try:
            occurred = datetime.fromisoformat(occurred_at)
            if occurred.tzinfo is None:
                occurred = occurred.replace(tzinfo=timezone.utc)
        except (TypeError, ValueError):
            occurred = utc_now_dt()
        update = {
            "partition_key": event.get("partition_key") or partition_key,
            "sequence": event.get("sequence") or await _next_partition_sequence(partition_key),
            "published_at": event.get("published_at") or occurred.isoformat(),
            "retention_until": event.get("retention_until") or (occurred + timedelta(days=DEFAULT_RETENTION_DAYS)).isoformat(),
            "retention_days": event.get("retention_days") or DEFAULT_RETENTION_DAYS,
            "migration": {
                "source": "legacy-platform-event",
                "backfilled_at": utc_now(),
            },
        }
        result = await db.platform_events.update_one({"id": event["id"]}, {"$set": update})
        migrated += result.modified_count
    return migrated


async def backfill_event_integrity(limit: int = 50000) -> int:
    """Seal legacy events in partition order without rewriting an existing seal."""
    await ensure_event_backbone_indexes()
    events = await db.platform_events.find(
        {},
        {"_id": 0},
    ).sort([("partition_key", 1), ("sequence", 1)]).to_list(
        max(1, min(int(limit or 50000), 100000))
    )
    previous_by_partition: dict[str, dict] = {}
    sealed = 0
    for event in events:
        partition = str(event.get("partition_key") or event.get("client_id") or event.get("tenant_id") or "nexus-local")
        previous = previous_by_partition.get(partition)
        if not event.get("integrity"):
            integrity = build_event_integrity(event, previous, origin="backfill")
            result = await db.platform_events.update_one(
                {"id": event["id"], "integrity": {"$exists": False}},
                {"$set": {"integrity": integrity}},
            )
            if result.modified_count:
                event["integrity"] = integrity
                sealed += 1
            else:
                refreshed = await db.platform_events.find_one({"id": event["id"]}, {"_id": 0, "integrity": 1})
                if refreshed and refreshed.get("integrity"):
                    event["integrity"] = refreshed["integrity"]
        previous_by_partition[partition] = event
    return sealed


async def _next_partition_sequence(partition_key: str) -> int:
    document = await db.platform_event_sequences.find_one_and_update(
        {"partition_key": partition_key},
        {
            "$inc": {"value": 1},
            "$set": {"updated_at": utc_now()},
            "$setOnInsert": {"created_at": utc_now()},
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return int((document or {}).get("value", 1))


def _delivery_document(
    subscription: dict,
    event: dict,
    *,
    replay_id: str | None = None,
) -> dict:
    now = utc_now()
    generation = replay_id or "initial"
    delivery_type = subscription.get("delivery_type", "webhook")
    immediately_delivered = delivery_type == "audit"
    return {
        "id": str(uuid.uuid4()),
        "delivery_key": f"{subscription['id']}:{event['id']}:{generation}",
        "event_id": event["id"],
        "subject": event["subject"],
        "tenant_id": event.get("tenant_id"),
        "client_id": event.get("client_id"),
        "subscription_id": subscription["id"],
        "subscription_name": subscription.get("name"),
        "delivery_type": delivery_type,
        "status": "delivered" if immediately_delivered else "pending",
        "attempts": 1 if immediately_delivered else 0,
        "max_attempts": MAX_DELIVERY_ATTEMPTS,
        "next_attempt_at": None if immediately_delivered else now,
        "last_attempt_at": now if immediately_delivered else None,
        "delivered_at": now if immediately_delivered else None,
        "last_error": None,
        "response_status": None,
        "response_excerpt": None,
        "replay_id": replay_id,
        "created_at": now,
        "updated_at": now,
    }


async def enqueue_event_deliveries(event: dict, *, replay_id: str | None = None, subscription_ids: list[str] | None = None) -> int:
    await ensure_event_backbone_indexes()
    query: dict[str, Any] = {"enabled": {"$ne": False}}
    if subscription_ids:
        query["id"] = {"$in": subscription_ids}
    subscriptions = await db.platform_event_subscriptions.find(query, {"_id": 0}).to_list(500)
    inserted = 0
    for subscription in subscriptions:
        if not subject_matches(event.get("subject", ""), subscription.get("subject_patterns") or []):
            continue
        document = _delivery_document(subscription, event, replay_id=replay_id)
        try:
            await db.platform_event_deliveries.insert_one(document)
            inserted += 1
        except DuplicateKeyError:
            continue
    return inserted


async def persist_platform_event(
    event: dict,
    *,
    idempotency_key: str | None = None,
    partition_key: str | None = None,
    retention_days: int | None = None,
) -> dict:
    """Persist an immutable event and create subscriber delivery checkpoints."""
    await ensure_event_backbone_indexes()
    tenant_id = str(event.get("tenant_id") or "nexus-local")
    idempotency_value = str(idempotency_key or "").strip() or None
    if idempotency_value:
        existing = await db.platform_events.find_one(
            {"tenant_id": tenant_id, "idempotency_key": idempotency_value},
            {"_id": 0},
        )
        if existing:
            return {**existing, "deduplicated": True}

    resolved_partition = str(
        partition_key
        or event.get("partition_key")
        or event.get("client_id")
        or tenant_id
    )
    retained_days = max(7, min(int(retention_days or DEFAULT_RETENTION_DAYS), 3650))
    now = utc_now_dt()
    stored = {
        **event,
        "idempotency_key": idempotency_value,
        "partition_key": resolved_partition,
        "sequence": await _next_partition_sequence(resolved_partition),
        "published_at": now.isoformat(),
        "retention_until": (now + timedelta(days=retained_days)).isoformat(),
        "retention_days": retained_days,
    }
    previous = await db.platform_events.find_one(
        {
            "partition_key": resolved_partition,
            "sequence": {"$lt": stored["sequence"]},
        },
        {"_id": 0},
        sort=[("sequence", -1)],
    )
    stored["integrity"] = build_event_integrity(stored, previous)
    try:
        await db.platform_events.insert_one({**stored})
    except DuplicateKeyError:
        if not idempotency_value:
            raise
        existing = await db.platform_events.find_one(
            {"tenant_id": tenant_id, "idempotency_key": idempotency_value},
            {"_id": 0},
        )
        if existing:
            return {**existing, "deduplicated": True}
        raise

    stored["delivery_count"] = await enqueue_event_deliveries(stored)
    stored["automation_run_count"] = 0
    if not str(stored.get("subject") or "").startswith("automation."):
        # Local import avoids a module cycle: the runtime also publishes its
        # own lifecycle events through this backbone.
        from app.services.automation_runtime import queue_runs_for_platform_event

        stored["automation_run_count"] = len(await queue_runs_for_platform_event(stored))
    stored["deduplicated"] = False
    return stored


async def create_subscription(data: dict, actor: dict) -> dict:
    await ensure_event_backbone_indexes()
    name = str(data.get("name") or "").strip()
    if len(name) < 3:
        raise ValueError("Subscription name must contain at least three characters")
    delivery_type = str(data.get("delivery_type") or "webhook").strip().lower()
    if delivery_type not in {"webhook", "audit"}:
        raise ValueError("Delivery type must be webhook or audit")
    endpoint_url = None
    signing_secret = None
    signing_secret_encrypted = None
    if delivery_type == "webhook":
        endpoint_url = validate_webhook_url(data.get("endpoint_url"))
        signing_secret = secrets.token_urlsafe(32)
        signing_secret_encrypted = encrypt_signing_secret(signing_secret)
    now = utc_now()
    subscription = {
        "id": str(uuid.uuid4()),
        "name": name,
        "description": str(data.get("description") or "").strip(),
        "subject_patterns": validate_subject_patterns(data.get("subject_patterns") or []),
        "delivery_type": delivery_type,
        "endpoint_url": endpoint_url,
        "signing_secret_encrypted": signing_secret_encrypted,
        "enabled": bool(data.get("enabled", True)),
        "created_by": actor.get("id") or "system",
        "created_by_name": actor.get("name") or actor.get("email") or "Nexus System",
        "created_at": now,
        "updated_at": now,
    }
    await db.platform_event_subscriptions.insert_one({**subscription})
    public = {key: value for key, value in subscription.items() if key != "signing_secret_encrypted"}
    if signing_secret:
        public["signing_secret"] = signing_secret
        public["signing_secret_notice"] = "Copy this signing secret now. NexusMSP will not display it again."
    return public


async def update_subscription(subscription_id: str, data: dict) -> dict | None:
    await ensure_event_backbone_indexes()
    current = await db.platform_event_subscriptions.find_one({"id": subscription_id}, {"_id": 0})
    if not current:
        return None
    update: dict[str, Any] = {"updated_at": utc_now()}
    for field in ("name", "description"):
        if field in data:
            update[field] = str(data.get(field) or "").strip()
    if "subject_patterns" in data:
        update["subject_patterns"] = validate_subject_patterns(data["subject_patterns"])
    if "enabled" in data:
        update["enabled"] = bool(data["enabled"])
    if "endpoint_url" in data and current.get("delivery_type") == "webhook":
        update["endpoint_url"] = validate_webhook_url(data["endpoint_url"])
    await db.platform_event_subscriptions.update_one({"id": subscription_id}, {"$set": update})
    return await db.platform_event_subscriptions.find_one(
        {"id": subscription_id},
        {"_id": 0, "signing_secret_encrypted": 0},
    )


async def rotate_subscription_secret(subscription_id: str) -> dict | None:
    current = await db.platform_event_subscriptions.find_one({"id": subscription_id}, {"_id": 0})
    if not current or current.get("delivery_type") != "webhook":
        return None
    signing_secret = secrets.token_urlsafe(32)
    await db.platform_event_subscriptions.update_one(
        {"id": subscription_id},
        {"$set": {"signing_secret_encrypted": encrypt_signing_secret(signing_secret), "updated_at": utc_now()}},
    )
    return {
        "id": subscription_id,
        "signing_secret": signing_secret,
        "signing_secret_notice": "Copy this signing secret now. NexusMSP will not display it again.",
    }


async def _claim_due_delivery() -> dict | None:
    now = utc_now()
    lock_token = str(uuid.uuid4())
    lock_until = (utc_now_dt() + timedelta(seconds=60)).isoformat()
    document = await db.platform_event_deliveries.find_one_and_update(
        {
            "$or": [
                {"status": {"$in": ["pending", "retrying"]}, "next_attempt_at": {"$lte": now}},
                {"status": "processing", "lock_expires_at": {"$lte": now}},
            ]
        },
        {
            "$set": {
                "status": "processing",
                "lock_token": lock_token,
                "lock_expires_at": lock_until,
                "updated_at": now,
            }
        },
        sort=[("next_attempt_at", 1), ("created_at", 1)],
        return_document=ReturnDocument.AFTER,
    )
    if document:
        document.pop("_id", None)
    return document


async def _deliver_webhook(delivery: dict, subscription: dict, event: dict) -> tuple[bool, int | None, str | None]:
    body = json.dumps(event, separators=(",", ":"), sort_keys=True, default=str)
    secret = decrypt_signing_secret(subscription.get("signing_secret_encrypted"))
    signature = hmac.new(secret.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).hexdigest() if secret else ""
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "NexusMSP-Event-Delivery/1.0",
        "X-Nexus-Event-ID": event["id"],
        "X-Nexus-Event-Subject": event["subject"],
        "X-Nexus-Delivery-ID": delivery["id"],
        "X-Nexus-Signature": f"sha256={signature}",
        "Idempotency-Key": delivery["delivery_key"],
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0), follow_redirects=False) as client:
            response = await client.post(subscription["endpoint_url"], content=body, headers=headers)
        excerpt = response.text[:500] if response.text else None
        return 200 <= response.status_code < 300, response.status_code, excerpt
    except Exception as exc:  # network failures are retained and retried
        return False, None, str(exc)[:500]


async def process_due_deliveries(limit: int = 25) -> dict:
    await ensure_event_backbone_indexes()
    result = {"processed": 0, "delivered": 0, "retrying": 0, "dead_letter": 0}
    for _ in range(max(1, min(int(limit or 25), 250))):
        delivery = await _claim_due_delivery()
        if not delivery:
            break
        result["processed"] += 1
        subscription, event = await asyncio.gather(
            db.platform_event_subscriptions.find_one({"id": delivery["subscription_id"]}, {"_id": 0}),
            db.platform_events.find_one({"id": delivery["event_id"]}, {"_id": 0}),
        )
        success = False
        status_code = None
        response_excerpt = None
        if not subscription:
            response_excerpt = "Subscription no longer exists"
        elif not subscription.get("enabled", True):
            response_excerpt = "Subscription is disabled"
        elif not event:
            response_excerpt = "Event is no longer retained"
        elif subscription.get("delivery_type") == "audit":
            success = True
        else:
            success, status_code, response_excerpt = await _deliver_webhook(delivery, subscription, event)

        attempts = int(delivery.get("attempts") or 0) + 1
        now = utc_now()
        update: dict[str, Any] = {
            "attempts": attempts,
            "last_attempt_at": now,
            "response_status": status_code,
            "response_excerpt": response_excerpt,
            "updated_at": now,
            "lock_token": None,
            "lock_expires_at": None,
        }
        if success:
            update.update({"status": "delivered", "delivered_at": now, "next_attempt_at": None, "last_error": None})
            result["delivered"] += 1
        elif attempts >= int(delivery.get("max_attempts") or MAX_DELIVERY_ATTEMPTS):
            update.update({"status": "dead_letter", "next_attempt_at": None, "last_error": response_excerpt or f"HTTP {status_code}"})
            result["dead_letter"] += 1
        else:
            next_attempt = utc_now_dt() + timedelta(seconds=retry_delay_seconds(attempts))
            update.update({"status": "retrying", "next_attempt_at": next_attempt.isoformat(), "last_error": response_excerpt or f"HTTP {status_code}"})
            result["retrying"] += 1
        await db.platform_event_deliveries.update_one(
            {"id": delivery["id"], "lock_token": delivery.get("lock_token")},
            {"$set": update},
        )
    return result


async def retry_delivery(delivery_id: str) -> dict | None:
    now = utc_now()
    updated = await db.platform_event_deliveries.find_one_and_update(
        {"id": delivery_id},
        {
            "$set": {
                "status": "pending",
                "next_attempt_at": now,
                "last_error": None,
                "response_status": None,
                "response_excerpt": None,
                "updated_at": now,
            },
            "$unset": {"lock_token": "", "lock_expires_at": ""},
        },
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    return updated


async def purge_expired_events(limit: int = 1000) -> dict:
    """Apply the retention boundary while preserving events on legal hold."""
    await ensure_event_backbone_indexes()
    rows = await db.platform_events.find(
        {
            "retention_until": {"$lte": utc_now()},
            "legal_hold": {"$ne": True},
        },
        {"_id": 0, "id": 1},
    ).sort("retention_until", 1).to_list(max(1, min(int(limit or 1000), 10000)))
    event_ids = [row["id"] for row in rows]
    if not event_ids:
        return {"events_purged": 0, "deliveries_purged": 0}
    delivery_result = await db.platform_event_deliveries.delete_many({"event_id": {"$in": event_ids}})
    event_result = await db.platform_events.delete_many(
        {"id": {"$in": event_ids}, "legal_hold": {"$ne": True}}
    )
    return {
        "events_purged": event_result.deleted_count,
        "deliveries_purged": delivery_result.deleted_count,
    }


async def replay_events(data: dict, actor: dict) -> dict:
    await ensure_event_backbone_indexes()
    query: dict[str, Any] = {}
    event_ids = [str(value) for value in data.get("event_ids") or [] if str(value).strip()]
    if event_ids:
        query["id"] = {"$in": event_ids[:1000]}
    subject = str(data.get("subject") or "").strip()
    if subject:
        query["subject"] = subject
    time_query: dict[str, str] = {}
    if data.get("from_time"):
        time_query["$gte"] = str(data["from_time"])
    if data.get("to_time"):
        time_query["$lte"] = str(data["to_time"])
    if time_query:
        query["occurred_at"] = time_query
    if not query:
        raise ValueError("Replay requires event IDs, an exact subject or a time window")

    events = await db.platform_events.find(query, {"_id": 0}).sort("occurred_at", 1).to_list(1000)
    subscription_ids = [str(value) for value in data.get("subscription_ids") or [] if str(value).strip()]
    subscription_query: dict[str, Any] = {"enabled": {"$ne": False}}
    if subscription_ids:
        subscription_query["id"] = {"$in": subscription_ids}
    subscriptions = await db.platform_event_subscriptions.find(subscription_query, {"_id": 0}).to_list(500)
    candidate_count = sum(
        1
        for event in events
        for subscription in subscriptions
        if subject_matches(event.get("subject", ""), subscription.get("subject_patterns") or [])
    )
    dry_run = bool(data.get("dry_run", True))
    if dry_run:
        return {
            "dry_run": True,
            "event_count": len(events),
            "subscription_count": len(subscriptions),
            "delivery_count": candidate_count,
            "sample_event_ids": [event["id"] for event in events[:10]],
        }

    replay_id = str(uuid.uuid4())
    created = 0
    for event in events:
        created += await enqueue_event_deliveries(event, replay_id=replay_id, subscription_ids=subscription_ids or None)
    replay = {
        "id": replay_id,
        "query": query,
        "subscription_ids": subscription_ids,
        "event_count": len(events),
        "delivery_count": created,
        "requested_by": actor.get("id") or "system",
        "requested_by_name": actor.get("name") or actor.get("email") or "Nexus System",
        "reason": str(data.get("reason") or "").strip(),
        "created_at": utc_now(),
    }
    await db.platform_event_replays.insert_one(replay)
    return {**replay, "dry_run": False}


async def event_backbone_health() -> dict:
    await ensure_event_backbone_indexes()
    since = (utc_now_dt() - timedelta(hours=24)).isoformat()
    (
        events_24h,
        subscribers,
        enabled_subscribers,
        pending,
        retrying,
        processing,
        delivered_24h,
        dead_letter,
        dead_letter_24h,
        oldest_pending,
        latest_event,
    ) = await asyncio.gather(
        db.platform_events.count_documents({"occurred_at": {"$gte": since}}),
        db.platform_event_subscriptions.count_documents({}),
        db.platform_event_subscriptions.count_documents({"enabled": {"$ne": False}}),
        db.platform_event_deliveries.count_documents({"status": "pending"}),
        db.platform_event_deliveries.count_documents({"status": "retrying"}),
        db.platform_event_deliveries.count_documents({"status": "processing"}),
        db.platform_event_deliveries.count_documents({"status": "delivered", "delivered_at": {"$gte": since}}),
        db.platform_event_deliveries.count_documents({"status": "dead_letter"}),
        db.platform_event_deliveries.count_documents({"status": "dead_letter", "updated_at": {"$gte": since}}),
        db.platform_event_deliveries.find_one(
            {"status": {"$in": ["pending", "retrying", "processing"]}},
            {"_id": 0, "created_at": 1},
            sort=[("created_at", 1)],
        ),
        db.platform_events.find_one({}, {"_id": 0, "occurred_at": 1, "subject": 1}, sort=[("occurred_at", -1)]),
    )
    queue_depth = pending + retrying + processing
    delivered_total = delivered_24h + dead_letter_24h
    success_rate = round((delivered_24h / delivered_total) * 100, 1) if delivered_total else 100.0
    oldest_age = 0
    if oldest_pending and oldest_pending.get("created_at"):
        try:
            oldest_age = max(0, int((utc_now_dt() - datetime.fromisoformat(oldest_pending["created_at"])).total_seconds()))
        except (TypeError, ValueError):
            oldest_age = 0
    status = "degraded" if dead_letter or oldest_age > 900 else ("attention" if retrying or queue_depth > 100 else "healthy")
    return {
        "status": status,
        "transport": "mongodb-durable+sse",
        "broker_target": "nats-jetstream",
        "events_24h": events_24h,
        "subscriptions": subscribers,
        "enabled_subscriptions": enabled_subscribers,
        "queue_depth": queue_depth,
        "pending": pending,
        "retrying": retrying,
        "processing": processing,
        "delivered_24h": delivered_24h,
        "dead_letter": dead_letter,
        "dead_letter_24h": dead_letter_24h,
        "delivery_success_rate": success_rate,
        "oldest_pending_seconds": oldest_age,
        "latest_event": latest_event,
        "retention_days": DEFAULT_RETENTION_DAYS,
        "max_delivery_attempts": MAX_DELIVERY_ATTEMPTS,
        "checked_at": utc_now(),
    }
