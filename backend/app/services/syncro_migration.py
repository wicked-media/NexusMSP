"""One-time Syncro -> Nexus migration.

This is deliberately a migration connector, not a live Syncro mirror. It pulls
the source records once, archives the raw payload, then upserts a Nexus record
using an immutable ``syncro_*`` identifier. Re-running the job updates the same
records instead of creating duplicates.

Safety rules:

- raw source evidence is written before the mapped record;
- a failed mapping never rolls back the raw archive;
- nothing is deleted from Nexus or Syncro;
- a dry run counts what would happen without writing canonical records;
- every job is tenant-scoped and resumable at the entity boundary;
- Syncro API errors are retried only when transient, and are never silent.
"""

from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import json
import logging
import math
import random
import re
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import PurePosixPath
from typing import Any, AsyncIterator, Awaitable, Callable, Iterable, Mapping
from urllib.parse import quote, unquote, urljoin, urlparse

import httpx

from app.database import db

logger = logging.getLogger(__name__)

PER_PAGE = 100
MAX_PAGES = 10000
# Syncro allows 180 requests/minute (3/second) per IP; stay just under it.
MIN_REQUEST_INTERVAL_SECONDS = 0.35
MAX_RETRIES = 4
DEFAULT_TIMEOUT_SECONDS = 30.0
RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}
MAX_TICKET_ATTACHMENT_BYTES = 25 * 1024 * 1024
MAX_PO_ATTACHMENT_BYTES = 10 * 1024 * 1024
ATTACHMENT_REDIRECT_LIMIT = 4

# A job that has not written progress for this long is treated as interrupted.
# Progress is flushed every 25 records, so this is far longer than any normal
# page request and only releases work after a worker has genuinely stopped.
STALE_JOB_MINUTES = 30


class SyncroMigrationError(Exception):
    """Base class for safe, operator-readable migration failures."""


class SyncroConfigurationError(SyncroMigrationError):
    """The Syncro connection is not configured for this tenant."""


class SyncroAPIError(SyncroMigrationError):
    """Syncro returned a non-retryable response."""


class MappingError(SyncroMigrationError):
    """A source record cannot be mapped without a required parent record."""


class SyncroAttachmentError(SyncroMigrationError):
    """An attachment cannot be downloaded or retained safely."""


class ActiveMigrationError(SyncroMigrationError):
    """Another migration job is already running for this tenant."""

    def __init__(self, job_id: str):
        super().__init__("A Syncro migration is already running for this workspace")
        self.job_id = job_id


# ============== SMALL VALUE HELPERS ==============


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _text(value: Any, *, limit: int | None = None) -> str:
    text = str(value or "").strip()
    return text[:limit] if limit else text


def _first(record: Mapping[str, Any], *keys: str, default: Any = None) -> Any:
    for key in keys:
        if key not in record:
            continue
        value = record.get(key)
        if value is not None and value != "":
            return value
    return default


def _related_id(record: Mapping[str, Any], *keys: str) -> str:
    for key in keys:
        value = record.get(key)
        if isinstance(value, Mapping):
            value = value.get("id")
        text = _text(value)
        if text:
            return text
    return ""


def _source_id(record: Mapping[str, Any]) -> str:
    return _related_id(record, "id", "ID", "_id")


def _number(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _integer(value: Any, default: int = 0) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _cents_or_none(value: Any) -> float | None:
    """Convert a Syncro cent amount, preserving "field absent" as None."""
    if value in (None, ""):
        return None
    try:
        return round(float(value) / 100.0, 2)
    except (TypeError, ValueError):
        return None


def _boolean(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return bool(value)
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


def _iso(value: Any) -> str | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        parsed = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return parsed.isoformat()
    if isinstance(value, (int, float)):
        seconds = value / 1000 if value > 10_000_000_000 else value
        try:
            return datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat()
        except (OverflowError, OSError, ValueError):
            return None
    return str(value).strip() or None


def _date_only(value: Any) -> str | None:
    timestamp = _iso(value)
    return timestamp[:10] if timestamp else None


def _properties(record: Mapping[str, Any]) -> dict[str, Any]:
    raw = record.get("properties")
    values: dict[str, Any] = {}
    if isinstance(raw, Mapping):
        values.update({str(key).strip(): value for key, value in raw.items()})
    elif isinstance(raw, list):
        for item in raw:
            if not isinstance(item, Mapping):
                continue
            name = _text(_first(item, "name", "key", "property", "label"))
            if name:
                values[name] = _first(item, "value", "val", "data")
    return values


def _property(record: Mapping[str, Any], *names: str) -> Any:
    values = _properties(record)
    lowered = {str(key).strip().lower(): value for key, value in values.items()}
    for name in names:
        if name.strip().lower() in lowered:
            return lowered[name.strip().lower()]
    return None


def _address(record: Mapping[str, Any]) -> str | None:
    raw = _first(record, "address", "address1", "street")
    if isinstance(raw, Mapping):
        parts = [
            raw.get("line1") or raw.get("street") or raw.get("address"),
            raw.get("line2"),
            raw.get("city"),
            raw.get("state"),
            raw.get("zip") or raw.get("postal_code"),
        ]
        return ", ".join(_text(part) for part in parts if _text(part)) or None
    parts = [
        raw,
        _first(record, "city", "suburb"),
        _first(record, "state", "province"),
        _first(record, "zip", "postcode", "postal_code"),
    ]
    return ", ".join(_text(part) for part in parts if _text(part)) or None


def _custom_fields(record: Mapping[str, Any]) -> dict[str, Any]:
    raw = _first(record, "custom_fields", "customFields", "fields")
    if isinstance(raw, Mapping):
        return {str(key): value for key, value in raw.items()}
    if isinstance(raw, list):
        values: dict[str, Any] = {}
        for item in raw:
            if not isinstance(item, Mapping):
                continue
            name = _text(_first(item, "name", "key", "label"))
            if name:
                values[name] = _first(item, "value", "val", "data")
        return values
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except ValueError:
            return {}
    return {}


def _tags(record: Mapping[str, Any]) -> list[str]:
    raw = _first(record, "tags", "tag_list", default=[])
    if isinstance(raw, str):
        raw = re.split(r"[,;]", raw)
    if not isinstance(raw, list):
        return []
    values: list[str] = []
    for item in raw:
        if isinstance(item, Mapping):
            item = _first(item, "name", "label", "tag")
        text = _text(item, limit=80)
        if text and text not in values:
            values.append(text)
    return values


def _syncro_name(record: Mapping[str, Any]) -> str:
    return _text(
        _first(record, "business_name", "name", "company_name", "organization_name")
        or " ".join(
            part
            for part in (
                _text(_first(record, "firstname", "first_name")),
                _text(_first(record, "lastname", "last_name")),
            )
            if part
        )
    )


def _frequency(value: Any) -> str:
    normalised = _text(value).lower().replace("-", "_").replace(" ", "_")
    mapping = {
        "daily": "daily",
        "weekly": "weekly",
        "biweekly": "fortnightly",
        "fortnightly": "fortnightly",
        "monthly": "monthly",
        "quarterly": "quarterly",
        "semi_annually": "semi_annually",
        "semiannually": "semi_annually",
        "semi_annual": "semi_annually",
        "annually": "annually",
        "annual": "annually",
        "yearly": "annually",
        "biennially": "biennially",
        "triennially": "triennially",
    }
    return mapping.get(normalised, "monthly")


def _invoice_status(value: Any) -> str:
    normalised = _text(value).lower()
    if normalised in {"paid", "complete", "completed"}:
        return "paid"
    if normalised in {"overdue"}:
        return "overdue"
    if normalised in {"sent", "published", "unpaid", "open"}:
        return "sent"
    if normalised in {"void", "voided", "cancelled", "canceled", "written_off"}:
        return "cancelled"
    return "draft"


def _lead_status(value: Any) -> tuple[str, int]:
    """Map Syncro lead stages onto Nexus CRM stages and pipeline positions."""
    normalised = _text(value).lower().replace("_", " ").replace("-", " ").strip()
    mapping = {
        "new": ("new", 1),
        "lead": ("new", 1),
        "first contact": ("contacted", 2),
        "contacted": ("contacted", 2),
        "opportunity": ("qualified", 3),
        "prospect": ("qualified", 3),
        "qualified": ("qualified", 3),
        "waiting on client": ("contacted", 2),
        "waiting on customer": ("contacted", 2),
        "pending": ("proposal", 4),
        "proposal": ("proposal", 4),
        "in negotiation": ("negotiation", 5),
        "negotiation": ("negotiation", 5),
        "won": ("won", 6),
        "lost": ("lost", 0),
    }
    return mapping.get(normalised, ("new", 1))


def _po_status(value: Any) -> str:
    """Map Syncro purchase-order states onto the Nexus procurement workflow."""
    normalised = _text(value).lower().replace("_", " ").replace("-", " ").strip()
    if normalised in {"cancelled", "canceled", "void", "declined", "rejected"}:
        return "cancelled"
    if normalised in {"received", "complete", "completed", "finished", "closed"}:
        return "received"
    if "partial" in normalised:
        return "partial"
    if normalised in {"pending approval", "pending"}:
        return "pending_approval"
    if normalised == "approved":
        return "approved"
    if normalised in {"ordered", "sent", "submitted", "open", "awaiting delivery"}:
        return "submitted"
    return "draft"


def _ticket_status(value: Any) -> str:
    normalised = _text(value).lower().replace("_", " ")
    if normalised in {"resolved", "solution provided"}:
        return "resolved"
    if normalised in {"closed", "cancelled", "canceled", "deleted"}:
        return "closed"
    if normalised in {
        "waiting on customer",
        "waiting on client",
        "waiting for customer",
        "waiting for client",
        "pending customer",
        "pending client",
        "waiting on parts",
        "waiting for parts",
        "waiting on vendor",
        "on hold",
        "on_hold",
    }:
        return "on_hold"
    if normalised in {"in progress", "in_progress", "progress", "working", "scheduled"}:
        return "in_progress"
    return "open"


def _ticket_priority(value: Any) -> str:
    normalised = _text(value).lower()
    if normalised in {"urgent", "critical", "emergency", "p1"}:
        return "urgent"
    if normalised in {"high", "p2"}:
        return "high"
    if normalised in {"low", "p4"}:
        return "low"
    return "medium"


def _line_items(record: Mapping[str, Any]) -> list[dict[str, Any]]:
    raw_lines = _first(record, "line_items", "lineItems", "lines", default=[])
    if isinstance(raw_lines, Mapping):
        raw_lines = raw_lines.get("line_items") or raw_lines.get("items") or []
    if not isinstance(raw_lines, list):
        return []
    lines: list[dict[str, Any]] = []
    for raw in raw_lines:
        if not isinstance(raw, Mapping):
            continue
        quantity = _number(_first(raw, "quantity", "qty"), 1.0)
        rate = _number(_first(raw, "unit_price", "unitPrice", "price", "rate"), 0.0)
        total = _number(_first(raw, "total", "amount", "line_total"), quantity * rate)
        name = _text(_first(raw, "name", "description", "product_name", "title"))
        line = {
            "description": name or "Imported Syncro line item",
            "name": name or "Imported Syncro line item",
            "quantity": quantity,
            "unit_price": rate,
            "rate": rate,
            "total": total,
            "amount": total,
            "product_id": _related_id(raw, "product_id", "product"),
            "sku": _text(_first(raw, "sku", "product_sku")),
            "tax_rate": _number(_first(raw, "tax_rate", "taxRate"), 0.0),
            "taxable": _boolean(_first(raw, "taxable", "is_taxable"), True),
            "source": "syncro",
            "syncro_line_item_id": _source_id(raw) or None,
        }
        lines.append({key: value for key, value in line.items() if value not in (None, "")})
    return lines


def _merge_detail(raw: Mapping[str, Any], detail: Any) -> dict[str, Any]:
    if not isinstance(detail, Mapping):
        return dict(raw)
    for key in (
        "invoice",
        "schedule",
        "ticket",
        "contract",
        "product",
        "customer",
        "purchase_order",
        "lead",
        "vendor",
    ):
        nested = detail.get(key)
        if isinstance(nested, Mapping):
            return {**raw, **nested}
    return {**raw, **detail}


ATTACHMENT_CONTENT_TYPE_EXTENSIONS = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "text/csv": "csv",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
}


def _attachment_records(raw: Mapping[str, Any]) -> list[Mapping[str, Any] | str]:
    items: list[Mapping[str, Any] | str] = []
    for key in ("attachments", "files", "documents", "attachment"):
        value = raw.get(key)
        if value is None:
            continue
        if isinstance(value, str):
            value = [value]
        elif isinstance(value, Mapping):
            if any(name in value for name in ("url", "download_url", "file_url", "filename", "id")):
                value = [value]
            else:
                nested = (
                    value.get("attachments")
                    or value.get("files")
                    or value.get("items")
                    or value.get("data")
                )
                value = nested if isinstance(nested, list) else list(value.values())
        if not isinstance(value, list):
            continue
        for item in value:
            if isinstance(item, (Mapping, str)) and item not in items:
                items.append(item)
    return items


def _normalise_attachment(item: Mapping[str, Any] | str, *, parent_kind: str) -> dict[str, Any]:
    outer = item if isinstance(item, Mapping) else {}
    nested: Mapping[str, Any] = {}
    for key in ("attachment", "file", "document"):
        candidate = outer.get(key)
        if isinstance(candidate, Mapping):
            nested = candidate
            break
    payload = {**outer, **nested} if nested else dict(outer)
    if not payload:
        payload = {"url": _text(item)}
    url = _text(
        _first(
            payload,
            "url",
            "download_url",
            "downloadUrl",
            "file_url",
            "fileUrl",
            "attachment_url",
            "attachmentUrl",
            "signed_url",
            "signedUrl",
            "link",
            "href",
        )
    )
    if not url:
        for key in ("attachment", "file", "document"):
            if isinstance(payload.get(key), str):
                url = _text(payload[key])
                break
    filename = _text(
        _first(
            payload,
            "filename",
            "file_name",
            "fileName",
            "name",
            "original_filename",
            "originalFilename",
            "display_name",
        ),
        limit=200,
    )
    if not filename and url:
        filename = unquote(PurePosixPath(urlparse(url).path).name)
    attachment_id = (
        _source_id(payload)
        or _text(_first(payload, "attachment_id", "attachmentId"))
        or _source_id(outer)
    )
    if not attachment_id:
        stable_url = url.split("?", 1)[0]
        attachment_id = "url-" + hashlib.sha256(
            f"{stable_url}|{filename}".encode("utf-8")
        ).hexdigest()[:24]
    return {
        "syncro_attachment_id": attachment_id,
        "parent_kind": parent_kind,
        "url": url,
        "filename": filename,
        "content_type": _text(
            _first(
                payload,
                "content_type",
                "content-type",
                "contentType",
                "mime_type",
                "mimeType",
                "type",
            ),
            limit=120,
        )
        or "application/octet-stream",
        "size": _integer(
            _first(payload, "size", "file_size", "fileSize", "size_bytes", "bytes"), 0
        ),
        "created_at": _iso(_first(payload, "created_at", "createdAt", "uploaded_at")),
        "uploaded_by_name": _text(
            _first(payload, "uploaded_by_name", "user_name", "created_by_name"), limit=200
        ),
        "raw": dict(outer) if outer else {"url": _text(item)},
    }


def _attachment_filename(filename: str, content_type: str, attachment_id: str) -> str:
    cleaned = "".join(
        character
        for character in str(filename or "").replace("\\", "/").rsplit("/", 1)[-1]
        if ord(character) >= 32 and character not in "\r\n"
    ).strip()[:180]
    if not cleaned:
        cleaned = f"syncro-attachment-{attachment_id}"
    if not PurePosixPath(cleaned).suffix:
        extension = ATTACHMENT_CONTENT_TYPE_EXTENSIONS.get(str(content_type or "").lower())
        if extension:
            cleaned = f"{cleaned}.{extension}"
    return cleaned


def tenant_query(tenant_id: str, query: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Match this tenant, while preserving the documented nexus-local legacy rows."""
    operational = dict(query or {})
    if tenant_id == "nexus-local":
        partition = {
            "$or": [
                {"tenant_id": "nexus-local"},
                {"tenant_id": {"$exists": False}},
                {"tenant_id": None},
                {"tenant_id": ""},
            ]
        }
    else:
        partition = {"tenant_id": tenant_id}
    return {"$and": [operational, partition]} if operational else partition


def _safe_error(exc: BaseException) -> str:
    detail = getattr(exc, "detail", None)
    message = str(detail or exc).strip() or exc.__class__.__name__
    return message[:600]


# ============== SYNCRO API CLIENT ==============


def normalise_subdomain(value: Any) -> str:
    """Accept a subdomain or a full Syncro URL, never an arbitrary origin."""
    raw = _text(value).lower()
    if not raw:
        raise SyncroConfigurationError("Syncro subdomain is required")
    if "://" in raw:
        parsed = urlparse(raw)
        host = parsed.hostname or ""
    else:
        host = raw.split("/", 1)[0]
    if host.startswith("www."):
        host = host[4:]
    if host.endswith(".syncromsp.com"):
        host = host[: -len(".syncromsp.com")]
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", host):
        raise SyncroConfigurationError(
            "Use only the Syncro subdomain, for example 'acme' from acme.syncromsp.com"
        )
    return host


def _extract_items(payload: Any, path: str) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, Mapping)]
    if not isinstance(payload, Mapping):
        return []
    preferred = path.strip("/").split("/", 1)[0].replace("-", "_")
    candidates = [
        preferred,
        preferred.rstrip("s"),
        {"customer_assets": "assets"}.get(preferred, ""),
        "comments" if preferred == "ticket_comments" else "",
        "schedules" if preferred == "schedules" else "",
        "items",
        "data",
        "results",
        "records",
    ]
    for key in candidates:
        if not key:
            continue
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, Mapping)]
    for value in payload.values():
        if isinstance(value, list) and all(isinstance(item, Mapping) for item in value):
            return list(value)
    return []


@dataclass(frozen=True)
class DownloadedAttachment:
    content: bytes
    content_type: str
    filename: str
    url: str


def _attachment_url_is_safe(value: str) -> str:
    """Reject non-HTTPS and local-network attachment URLs before any fetch."""
    parsed = urlparse(value)
    if parsed.scheme != "https" or parsed.username or parsed.password:
        raise SyncroAttachmentError("Attachment URL must be an authenticated HTTPS URL")
    host = str(parsed.hostname or "").strip().rstrip(".").lower()
    if not host:
        raise SyncroAttachmentError("Attachment URL has no host")
    if host == "localhost" or host.endswith(".localhost") or host.endswith(".local") or host.endswith(".internal"):
        raise SyncroAttachmentError("Attachment URL points to a local network host")
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return value
    if not address.is_global:
        raise SyncroAttachmentError("Attachment URL points to a non-public address")
    return value


def _content_disposition_filename(value: str | None) -> str:
    raw = str(value or "")
    match = re.search(r"filename\*=UTF-8''([^;]+)|filename=\"?([^\";]+)\"?", raw, re.IGNORECASE)
    if not match:
        return ""
    return unquote((match.group(1) or match.group(2) or "").strip())


def _total_pages(payload: Any) -> int | None:
    if not isinstance(payload, Mapping):
        return None
    for container in (payload.get("meta"), payload.get("pagination"), payload.get("page")):
        if isinstance(container, Mapping):
            for key in ("total_pages", "totalPages", "pages"):
                if container.get(key) is not None:
                    try:
                        return max(1, int(container[key]))
                    except (TypeError, ValueError):
                        pass
    for key in ("total_pages", "totalPages", "pages"):
        if payload.get(key) is not None:
            try:
                return max(1, int(payload[key]))
            except (TypeError, ValueError):
                pass
    return None


class SyncroClient:
    """Small, rate-limited Syncro API v1 client used by the migration job."""

    def __init__(
        self,
        subdomain: str,
        api_key: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        min_interval_seconds: float = MIN_REQUEST_INTERVAL_SECONDS,
        timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
        max_retries: int = MAX_RETRIES,
        retry_base_seconds: float = 0.5,
    ):
        self.subdomain = normalise_subdomain(subdomain)
        self.api_key = _text(api_key)
        if not self.api_key:
            raise SyncroConfigurationError("Syncro API key is required")
        self.base_url = f"https://{self.subdomain}.syncromsp.com/api/v1"
        self.min_interval_seconds = max(0.0, min_interval_seconds)
        self.max_retries = max(0, max_retries)
        self.retry_base_seconds = max(0.0, retry_base_seconds)
        self._auth_mode = "bearer"
        self._next_request_at = 0.0
        self._throttle_lock = asyncio.Lock()
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            timeout=httpx.Timeout(timeout_seconds),
            transport=transport,
            headers={"Accept": "application/json", "User-Agent": "NexusMSP-Syncro-Migration/1.0"},
        )

    async def __aenter__(self) -> "SyncroClient":
        return self

    async def __aexit__(self, *_args: Any) -> None:
        await self.close()

    async def close(self) -> None:
        await self._client.aclose()

    def _headers(self) -> dict[str, str]:
        if self._auth_mode == "raw":
            return {"Authorization": self.api_key}
        return {"Authorization": f"Bearer {self.api_key}"}

    async def _throttle(self) -> None:
        if self.min_interval_seconds <= 0:
            return
        async with self._throttle_lock:
            now = time.monotonic()
            delay = self._next_request_at - now
            if delay > 0:
                await asyncio.sleep(delay)
            self._next_request_at = max(time.monotonic(), self._next_request_at) + self.min_interval_seconds

    def _backoff(self, attempt: int) -> float:
        base = min(8.0, self.retry_base_seconds * (2 ** attempt))
        return base + random.uniform(0, max(0.01, base * 0.25))

    @staticmethod
    def _retry_after(response: httpx.Response) -> float | None:
        raw = response.headers.get("retry-after", "").strip()
        if not raw:
            return None
        try:
            return min(30.0, max(0.0, float(raw)))
        except ValueError:
            return None

    async def get(self, path: str, params: Mapping[str, Any] | None = None) -> Any:
        last_error: BaseException | None = None
        for attempt in range(self.max_retries + 1):
            await self._throttle()
            try:
                response = await self._client.get(path, params=dict(params or {}), headers=self._headers())
            except httpx.HTTPError as exc:
                last_error = exc
                if attempt >= self.max_retries:
                    raise SyncroAPIError(f"Syncro request failed for {path}: {type(exc).__name__}") from exc
                await asyncio.sleep(self._backoff(attempt))
                continue

            if response.status_code == 401 and self._auth_mode == "bearer":
                # Older installations send the raw token. Try that once, then
                # fail closed rather than pretending the connection works.
                self._auth_mode = "raw"
                continue

            if response.status_code in RETRYABLE_STATUS_CODES and attempt < self.max_retries:
                await asyncio.sleep(self._retry_after(response) or self._backoff(attempt))
                continue

            if response.status_code >= 400:
                raise SyncroAPIError(
                    f"Syncro API returned HTTP {response.status_code} for {path}"
                )

            try:
                return response.json()
            except ValueError as exc:
                raise SyncroAPIError(f"Syncro API returned non-JSON content for {path}") from exc

        raise SyncroAPIError(f"Syncro request failed after retries for {path}: {type(last_error).__name__}")

    async def download(
        self,
        url: str,
        *,
        max_bytes: int,
        filename: str | None = None,
    ) -> DownloadedAttachment:
        """Fetch one bounded attachment, including Syncro-auth and safe redirects."""
        if max_bytes <= 0:
            raise SyncroAttachmentError("Attachment size limit must be positive")
        current = urljoin(self.base_url + "/", _text(url))
        redirects = 0
        while True:
            _attachment_url_is_safe(current)
            try:
                from app.services.event_backbone import assert_outbound_destination

                current = await assert_outbound_destination(current)
            except ValueError as exc:
                raise SyncroAttachmentError(
                    f"Attachment URL is not a public destination: {exc}"
                ) from exc
            host = str(urlparse(current).hostname or "").strip().rstrip(".").lower()
            include_syncro_auth = host == f"{self.subdomain}.syncromsp.com" or host.endswith(".syncromsp.com")
            headers = {"Accept": "*/*", "User-Agent": "NexusMSP-Syncro-Migration/1.0"}
            if include_syncro_auth:
                headers.update(self._headers())
            attempt = 0
            while True:
                await self._throttle()
                try:
                    async with self._client.stream("GET", current, headers=headers) as response:
                        if response.status_code == 401 and include_syncro_auth and self._auth_mode == "bearer":
                            self._auth_mode = "raw"
                            headers.update(self._headers())
                            continue
                        if response.status_code in {301, 302, 303, 307, 308}:
                            location = response.headers.get("location")
                            if not location:
                                raise SyncroAttachmentError("Attachment redirect had no destination")
                            if redirects >= ATTACHMENT_REDIRECT_LIMIT:
                                raise SyncroAttachmentError("Attachment redirected too many times")
                            current = urljoin(current, location)
                            redirects += 1
                            break
                        if response.status_code in RETRYABLE_STATUS_CODES and attempt < self.max_retries:
                            await asyncio.sleep(self._retry_after(response) or self._backoff(attempt))
                            attempt += 1
                            continue
                        if response.status_code >= 400:
                            raise SyncroAPIError(
                                f"Syncro attachment returned HTTP {response.status_code}"
                            )
                        declared_length = response.headers.get("content-length")
                        if declared_length:
                            try:
                                if int(declared_length) > max_bytes:
                                    raise SyncroAttachmentError("Attachment exceeds the Nexus size limit")
                            except ValueError:
                                pass
                        chunks: list[bytes] = []
                        total = 0
                        async for chunk in response.aiter_bytes():
                            total += len(chunk)
                            if total > max_bytes:
                                raise SyncroAttachmentError("Attachment exceeds the Nexus size limit")
                            chunks.append(chunk)
                        content_type = (
                            response.headers.get("content-type") or "application/octet-stream"
                        ).split(";", 1)[0].strip() or "application/octet-stream"
                        remote_name = _content_disposition_filename(response.headers.get("content-disposition"))
                        fallback_name = unquote(PurePosixPath(urlparse(current).path).name)
                        return DownloadedAttachment(
                            content=b"".join(chunks),
                            content_type=content_type,
                            filename=_text(filename or remote_name or fallback_name) or "attachment",
                            url=current,
                        )
                except httpx.HTTPError as exc:
                    if attempt < self.max_retries:
                        await asyncio.sleep(self._backoff(attempt))
                        attempt += 1
                        continue
                    raise SyncroAPIError(
                        f"Syncro attachment download failed: {type(exc).__name__}"
                    ) from exc
            # A redirect exited the response loop; validate and follow it above.
            continue

    async def iter_items(
        self,
        path: str,
        params: Mapping[str, Any] | None = None,
        page_size: int | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        page = 1
        total_pages: int | None = None
        effective_page_size = max(1, page_size or PER_PAGE)
        while page <= MAX_PAGES:
            payload = await self.get(
                path,
                {**dict(params or {}), "page": page, "per_page": effective_page_size},
            )
            items = _extract_items(payload, path)
            for item in items:
                yield item
            if total_pages is None:
                total_pages = _total_pages(payload)
            if total_pages is not None:
                if page >= total_pages:
                    break
            elif len(items) < effective_page_size:
                break
            if not items:
                break
            page += 1
        else:
            raise SyncroAPIError(
                f"Syncro pagination exceeded {MAX_PAGES} pages for {path}; "
                "refusing to report a partial migration as complete"
            )


# ============== MAPPING CONTEXT ==============


@dataclass
class MigrationContext:
    database: Any
    tenant_id: str
    job_id: str
    cache: dict[str, dict[str, str]] = field(default_factory=dict)
    client_names: dict[str, str] = field(default_factory=dict)

    def bucket(self, key: str) -> dict[str, str]:
        return self.cache.setdefault(key, {})


@dataclass
class MappedRecord:
    document: dict[str, Any]
    existing_id: str | None = None
    match_basis: str | None = None


async def _resolve_id(
    context: MigrationContext,
    collection: str,
    field: str,
    external_id: str,
    cache_key: str,
) -> str | None:
    if not external_id:
        return None
    bucket = context.bucket(cache_key)
    if external_id in bucket:
        return bucket[external_id]
    row = await context.database[collection].find_one(
        tenant_query(context.tenant_id, {field: external_id}),
        {"_id": 0, "id": 1},
    )
    if not row or not row.get("id"):
        return None
    bucket[external_id] = str(row["id"])
    return str(row["id"])


async def _find_existing(
    context: MigrationContext,
    collection: str,
    field: str,
    external_id: str,
) -> dict[str, Any] | None:
    if not external_id:
        return None
    return await context.database[collection].find_one(
        tenant_query(context.tenant_id, {field: external_id}),
        {"_id": 0},
    )


async def _find_by_id(context: MigrationContext, collection: str, record_id: str) -> dict[str, Any] | None:
    if not record_id:
        return None
    return await context.database[collection].find_one(
        tenant_query(context.tenant_id, {"id": record_id}),
        {"_id": 0},
    )


def _normalise_number(value: Any) -> str:
    """Compare document numbers without treating spacing or case as identity."""
    return " ".join(_text(value).split()).casefold()


def _source_number(spec: EntitySpec, raw: Mapping[str, Any]) -> str:
    if not spec.source_number_keys:
        return ""
    return _text(_first(raw, *spec.source_number_keys), limit=80)


async def _source_client_id(
    context: MigrationContext,
    spec: EntitySpec,
    raw: Mapping[str, Any],
) -> str | None:
    if spec.key not in {"tickets", "invoices"}:
        return None
    return await _resolve_id(
        context,
        "clients",
        "syncro_id",
        _related_id(raw, "customer_id", "customer"),
        "clients",
    )


async def _find_number_match(
    context: MigrationContext,
    *,
    collection: str,
    number_field: str,
    number: str,
    client_id: str | None,
    external_field: str,
    label: str,
) -> dict[str, Any] | None:
    """Link a mid-transition record by number only when the match is unambiguous.

    Number matching is deliberately tenant-wide so a collision cannot create a
    second record, then rejects a candidate that belongs to another client. It
    never claims a record already linked to a different Syncro source.
    """
    cleaned = _text(number, limit=80)
    if not cleaned or not client_id:
        return None
    pattern = r"^\s*" + r"\s+".join(re.escape(part) for part in cleaned.split()) + r"\s*$"
    clauses: list[dict[str, Any]] = [
        {number_field: {"$regex": pattern, "$options": "i"}}
    ]
    if cleaned.isdigit():
        clauses.append({number_field: int(cleaned)})
    candidates = await context.database[collection].find(
        tenant_query(context.tenant_id, {"$or": clauses}),
        {
            "_id": 0,
            "id": 1,
            "client_id": 1,
            number_field: 1,
            external_field: 1,
        },
    ).to_list(10)
    wanted = _normalise_number(cleaned)
    matches = [
        candidate
        for candidate in candidates
        if _normalise_number(candidate.get(number_field)) == wanted
    ]
    if not matches:
        return None
    if any(_text(candidate.get(external_field)) for candidate in matches):
        raise MappingError(
            f"{label} number {cleaned} is already linked to another Syncro record"
        )
    if any(_text(candidate.get("client_id")) != _text(client_id) for candidate in matches):
        raise MappingError(
            f"{label} number {cleaned} belongs to a different Nexus client"
        )
    if len(matches) > 1:
        raise MappingError(
            f"{label} number {cleaned} matches multiple Nexus records; resolve the duplicate before migrating"
        )
    return matches[0]


async def _client_name(context: MigrationContext, client_id: str | None) -> str | None:
    """Resolve the denormalised client name used by existing list/detail views."""
    if not client_id:
        return None
    if client_id not in context.client_names:
        row = await context.database.clients.find_one(
            tenant_query(context.tenant_id, {"id": client_id}),
            {"_id": 0, "name": 1},
        )
        context.client_names[client_id] = _text((row or {}).get("name"))
    return context.client_names[client_id] or None


def _base_document(context: MigrationContext, external_field: str, external_id: str) -> dict[str, Any]:
    return {
        "tenant_id": context.tenant_id,
        external_field: external_id,
        "source": "syncro",
        "syncro_migrated_at": _now_iso(),
        "syncro_migration_job_id": context.job_id,
    }


# ============== ENTITY MAPPERS ==============


async def _map_customer(context: MigrationContext, raw: Mapping[str, Any]) -> MappedRecord:
    syncro_id = _source_id(raw)
    name = _syncro_name(raw) or f"Syncro customer {syncro_id}"
    email = _text(_first(raw, "email", "email_address"), limit=320) or None
    document = {
        **_base_document(context, "syncro_id", syncro_id),
        "name": name,
        "email": email,
        "phone": _text(_first(raw, "phone", "phone_number", "mobile"), limit=80) or None,
        "address": _address(raw),
        "website": _text(_first(raw, "website", "url"), limit=500) or None,
        "industry": _text(_first(raw, "industry", "industry_name"), limit=200) or None,
        "contract_type": _text(_first(raw, "contract_type"), limit=80) or "monthly",
        "syncro_created_at": _iso(_first(raw, "created_at", "created")),
        "syncro_updated_at": _iso(_first(raw, "updated_at", "updated")),
    }
    document = {key: value for key, value in document.items() if value not in (None, "")}
    document["created_at"] = _iso(_first(raw, "created_at", "created")) or _now_iso()

    existing = await _find_existing(context, "clients", "syncro_id", syncro_id)
    if existing:
        return MappedRecord(document=document, existing_id=str(existing["id"]))

    # A customer manually created in Nexus may already represent this Syncro
    # customer. Attach the immutable source ID only when the name matches and
    # the available email evidence agrees; never merge by name alone when both
    # records have different emails.
    candidates = await context.database.clients.find(
        tenant_query(context.tenant_id, {"name": name}),
        {"_id": 0},
    ).to_list(10)
    for candidate in candidates:
        if candidate.get("syncro_id"):
            continue
        candidate_email = _text(candidate.get("email")).lower()
        source_email = _text(email).lower()
        # Link only when the available email evidence agrees. If either side
        # has an email and the other does not, a name-only match is too weak to
        # risk merging two different customers.
        if candidate_email != source_email:
            continue
        return MappedRecord(
            document=document,
            existing_id=str(candidate.get("id") or ""),
            match_basis="name_email" if source_email else "name",
        )
    return MappedRecord(document=document)


async def _map_contact(context: MigrationContext, raw: Mapping[str, Any]) -> MappedRecord:
    syncro_id = _source_id(raw)
    customer_id = _related_id(raw, "customer_id", "customer")
    client_id = await _resolve_id(context, "clients", "syncro_id", customer_id, "clients")
    if not client_id:
        raise MappingError(f"Contact {syncro_id} references unmigrated customer {customer_id}")
    name = _syncro_name(raw) or _text(_first(raw, "email")) or f"Syncro contact {syncro_id}"
    document = {
        **_base_document(context, "syncro_contact_id", syncro_id),
        "client_id": client_id,
        "name": name,
        "email": _text(_first(raw, "email", "email_address"), limit=320) or None,
        "phone": _text(_first(raw, "phone", "phone_number", "mobile"), limit=80) or None,
        "role": _text(_first(raw, "title", "role", "job_title"), limit=200) or None,
        "is_primary": _boolean(_first(raw, "primary", "is_primary", "primary_contact")),
        "syncro_created_at": _iso(_first(raw, "created_at", "created")),
        "syncro_updated_at": _iso(_first(raw, "updated_at", "updated")),
    }
    document = {key: value for key, value in document.items() if value not in (None, "")}
    document["created_at"] = _iso(_first(raw, "created_at", "created")) or _now_iso()
    return MappedRecord(document=document)


def _device_type(value: Any) -> str:
    normalised = _text(value).lower()
    mapping = {
        "desktop": "workstation",
        "workstation": "workstation",
        "pc": "workstation",
        "laptop": "laptop",
        "notebook": "laptop",
        "server": "server",
        "tablet": "tablet",
        "mobile": "mobile",
        "phone": "mobile",
        "printer": "printer",
        "network device": "network",
        "network": "network",
        "firewall": "firewall",
        "router": "router",
        "switch": "switch",
        "access point": "access_point",
        "other": "other",
    }
    return mapping.get(normalised, "workstation")


async def _map_asset(context: MigrationContext, raw: Mapping[str, Any]) -> MappedRecord:
    syncro_id = _source_id(raw)
    customer_id = _related_id(raw, "customer_id", "customer")
    client_id = await _resolve_id(context, "clients", "syncro_id", customer_id, "clients")
    if not client_id:
        raise MappingError(f"Asset {syncro_id} references unmigrated customer {customer_id}")
    hostname = _text(_first(raw, "hostname", "name", "device_name"), limit=255) or f"Syncro asset {syncro_id}"
    online = _first(raw, "online", "is_online")
    status = "online" if _boolean(online) else "offline" if online is not None else "unknown"
    document = {
        **_base_document(context, "syncro_asset_id", syncro_id),
        "client_id": client_id,
        "client_name": await _client_name(context, client_id),
        "name": _text(_first(raw, "name", "hostname", "device_name"), limit=255) or hostname,
        "hostname": hostname,
        "device_type": _device_type(_first(raw, "asset_type", "device_type", "type")),
        "os": _text(_property(raw, "Operating System", "OS", "os") or _first(raw, "os"), limit=200) or None,
        "os_version": _text(_property(raw, "OS Version", "Operating System Version") or _first(raw, "os_version"), limit=200) or None,
        "ip_address": _text(_property(raw, "Local IP", "IP Address", "IP") or _first(raw, "ip_address", "local_ip"), limit=80) or None,
        "mac_address": _text(_property(raw, "MAC Address", "MAC", "Primary MAC") or _first(raw, "mac_address"), limit=80) or None,
        "serial_number": _text(_property(raw, "Serial Number", "Serial") or _first(raw, "serial_number", "serial"), limit=200) or None,
        "manufacturer": _text(_property(raw, "Manufacturer", "Make") or _first(raw, "manufacturer"), limit=200) or None,
        "model": _text(_property(raw, "Model") or _first(raw, "model"), limit=200) or None,
        "assigned_user": _text(_property(raw, "Assigned User", "User") or _first(raw, "assigned_user"), limit=200) or None,
        "last_logged_in_user": _text(_property(raw, "Last Logged In User", "Last User") or _first(raw, "last_logged_in_user"), limit=200) or None,
        "agent_version": _text(_first(raw, "agent_version", "version"), limit=80) or None,
        "status": status,
        "last_seen": _iso(_first(raw, "last_seen", "last_seen_at", "updated_at", "updated")),
        "tags": _tags(raw),
        "notes": _text(_first(raw, "notes", "description"), limit=8000) or None,
        "lifecycle_state": "active",
        "archived": False,
        "syncro_created_at": _iso(_first(raw, "created_at", "created")),
        "syncro_updated_at": _iso(_first(raw, "updated_at", "updated")),
    }
    document = {key: value for key, value in document.items() if value not in (None, "")}
    document["created_at"] = _iso(_first(raw, "created_at", "created")) or _now_iso()
    document["last_seen"] = document.get("last_seen") or document["created_at"]
    return MappedRecord(document=document)


async def _map_product(context: MigrationContext, raw: Mapping[str, Any]) -> MappedRecord:
    syncro_id = _source_id(raw)
    name = _text(_first(raw, "name", "product_name", "description"), limit=300) or f"Syncro product {syncro_id}"
    retail = _number(_first(raw, "retail_price", "price", "unit_price"), 0.0)
    cost = _number(_first(raw, "cost_price", "cost"), 0.0)
    document = {
        **_base_document(context, "syncro_product_id", syncro_id),
        "name": name,
        "sku": _text(_first(raw, "sku", "code", "product_code"), limit=120) or None,
        "description": _text(_first(raw, "description", "long_description"), limit=8000) or None,
        "category": _text(_first(raw, "category", "category_name"), limit=200) or "General",
        "vendor": _text(_first(raw, "vendor", "vendor_name", "manufacturer"), limit=200) or None,
        "cost_price": cost,
        "retail_price": retail,
        "tax_rate": _number(_first(raw, "tax_rate", "taxRate"), 0.0),
        "quantity_in_stock": _integer(_first(raw, "quantity_in_stock", "quantity", "stock"), 0),
        "is_active": _boolean(_first(raw, "active", "is_active"), True),
        "is_recurring": _boolean(_first(raw, "recurring", "is_recurring"), False),
        "billing_cycle": _frequency(_first(raw, "billing_cycle", "frequency")),
        "barcode": _text(_first(raw, "barcode", "upc"), limit=120) or None,
        "syncro_created_at": _iso(_first(raw, "created_at", "created")),
        "syncro_updated_at": _iso(_first(raw, "updated_at", "updated")),
    }
    document = {key: value for key, value in document.items() if value not in (None, "")}
    document["created_at"] = _iso(_first(raw, "created_at", "created")) or _now_iso()
    return MappedRecord(document=document)


async def _map_contract(context: MigrationContext, raw: Mapping[str, Any]) -> MappedRecord:
    syncro_id = _source_id(raw)
    customer_id = _related_id(raw, "customer_id", "customer")
    client_id = await _resolve_id(context, "clients", "syncro_id", customer_id, "clients")
    if not client_id:
        raise MappingError(f"Contract {syncro_id} references unmigrated customer {customer_id}")
    status = _text(_first(raw, "status"), limit=40).lower() or "active"
    if status in {"cancelled", "canceled", "expired", "inactive"}:
        status = "cancelled" if "cancel" in status else "expired"
    document = {
        **_base_document(context, "syncro_contract_id", syncro_id),
        "client_id": client_id,
        "client_name": await _client_name(context, client_id),
        "name": _text(_first(raw, "name", "description", "contract_name"), limit=300) or f"Syncro contract {syncro_id}",
        "contract_type": _text(_first(raw, "contract_type", "type"), limit=80) or "managed_services",
        "billing_frequency": _frequency(_first(raw, "billing_frequency", "frequency")),
        "start_date": _date_only(_first(raw, "start_date", "start", "created_at")) or _now_iso()[:10],
        "end_date": _date_only(_first(raw, "end_date", "end", "expiry_date")),
        "value": _number(_first(raw, "value", "amount", "price", "monthly_value"), 0.0),
        "auto_renew": _boolean(_first(raw, "auto_renew", "renew"), True),
        "sla_tier": _text(_first(raw, "sla_tier", "service_tier"), limit=80) or "standard",
        "status": status,
        "notes": _text(_first(raw, "notes", "description"), limit=8000) or None,
        "syncro_created_at": _iso(_first(raw, "created_at", "created")),
        "syncro_updated_at": _iso(_first(raw, "updated_at", "updated")),
    }
    document = {key: value for key, value in document.items() if value not in (None, "")}
    document["created_at"] = _iso(_first(raw, "created_at", "created")) or _now_iso()
    return MappedRecord(document=document)


async def _map_invoice(context: MigrationContext, raw: Mapping[str, Any]) -> MappedRecord:
    syncro_id = _source_id(raw)
    customer_id = _related_id(raw, "customer_id", "customer")
    client_id = await _resolve_id(context, "clients", "syncro_id", customer_id, "clients")
    if not client_id:
        raise MappingError(f"Invoice {syncro_id} references unmigrated customer {customer_id}")
    total = _number(_first(raw, "total", "amount", "grand_total"), 0.0)
    paid = _number(_first(raw, "amount_paid", "paid_amount", "amountPaid"), 0.0)
    status = _invoice_status(_first(raw, "status", "invoice_status"))
    if status not in {"draft", "sent", "paid", "overdue", "cancelled"}:
        status = "draft"
    payment_status = "paid" if status == "paid" or (total > 0 and paid >= total) else "partial" if paid > 0 else "unpaid"
    ticket_id = await _resolve_id(
        context, "tickets", "syncro_ticket_id", _related_id(raw, "ticket_id", "ticket"), "tickets"
    )
    contract_id = await _resolve_id(
        context, "contracts", "syncro_contract_id", _related_id(raw, "contract_id", "contract"), "contracts"
    )
    document = {
        **_base_document(context, "syncro_invoice_id", syncro_id),
        "client_id": client_id,
        "client_name": await _client_name(context, client_id),
        "contract_id": contract_id,
        "invoice_number": _text(_first(raw, "number", "invoice_number", "invoice_no"), limit=80) or f"SYNCRO-{syncro_id}",
        "ticket_id": ticket_id,
        "status": status,
        "payment_status": payment_status,
        "subtotal": _number(_first(raw, "subtotal", "sub_total"), 0.0),
        "tax": _number(_first(raw, "tax", "tax_amount", "total_tax"), 0.0),
        "tax_rate": _number(_first(raw, "tax_rate", "taxRate"), 0.0),
        "total": total,
        "amount_paid": paid,
        "due_date": _date_only(_first(raw, "due_date", "due")),
        "paid_date": _date_only(_first(raw, "paid_date", "payment_date", "paid_at")),
        "notes": _text(_first(raw, "notes", "memo"), limit=8000) or None,
        "line_items": _line_items(raw),
        "is_recurring": _boolean(_first(raw, "is_recurring", "recurring"), False),
        "syncro_created_at": _iso(_first(raw, "created_at", "date", "invoice_date")),
        "syncro_updated_at": _iso(_first(raw, "updated_at", "updated")),
    }
    document = {key: value for key, value in document.items() if value not in (None, "")}
    document["created_at"] = _iso(_first(raw, "created_at", "date", "invoice_date")) or _now_iso()
    return MappedRecord(document=document)


def _payment_method(record: Mapping[str, Any]) -> str:
    method = _text(
        _first(record, "method", "payment_method", "payment_type", "type"),
        limit=80,
    )
    normalised = re.sub(r"[^a-z0-9]+", " ", method.lower()).strip()
    words = set(normalised.split())
    if "eftpos" in normalised or "efpos" in normalised:
        return "eftpos"
    if "xero" in normalised or _text(
        _first(record, "xero_payment_id", "xero_id", "accounting_payment_id")
    ):
        return "xero_reconciled"
    if "cash" in normalised or "petty" in normalised:
        return "cash"
    if "cheque" in normalised or "check" in words:
        return "cheque"
    if any(token in normalised for token in ("bank", "ach", "transfer", "direct debit", "wire")):
        return "bank_transfer"
    return "other"


_PAYMENT_OPTIONAL_SOURCE_FIELDS = (
    "reference",
    "notes",
    "syncro_method",
    "currency",
    "syncro_status",
)


def _payment_entry_source_id(item: Any) -> str:
    """Return the Syncro payment ID carried by an embedded invoice entry."""
    if not isinstance(item, Mapping):
        return ""
    current = _text(item.get("syncro_payment_id"))
    if current:
        return current
    if str(item.get("source") or "") in {"syncro", "syncro_migration"}:
        return _text(item.get("id"))
    return ""


def _payment_entry_matches(item: Any, syncro_id: str) -> bool:
    """Recognise both current and pre-upgrade Syncro payment entries."""
    if not isinstance(item, Mapping):
        return False
    if str(item.get("syncro_payment_id") or "") == syncro_id:
        return True
    # Earlier connector versions copied the Syncro ID into the entry's `id`
    # without adding syncro_payment_id. Match only those explicit legacy
    # entries so a manual payment that happens to share an ID is never merged.
    return (
        not item.get("syncro_payment_id")
        and str(item.get("id") or "") == syncro_id
        and str(item.get("source") or "") in {"syncro", "syncro_migration"}
    )


def _payment_reconciliation_status(record: Mapping[str, Any], method: str) -> str:
    if method == "xero_reconciled":
        return "matched"
    state = _text(
        _first(record, "reconciliation_status", "reconciliation_state"),
        limit=40,
    ).lower()
    if (
        _boolean(_first(record, "reconciled", "is_reconciled", "reconciled_in_xero"), False)
        or state in {"matched", "reconciled", "complete", "completed", "settled"}
        or _text(_first(record, "xero_payment_id", "xero_id"))
    ):
        return "matched"
    return "pending_xero_reconciliation"


def _payment_document(
    raw: Mapping[str, Any],
    *,
    invoice_id: str | None,
    invoice: Mapping[str, Any],
) -> dict[str, Any]:
    syncro_id = _source_id(raw)
    if not syncro_id:
        raise MappingError("Syncro payment has no id")
    invoice_syncro_id = _related_id(raw, "invoice_id", "invoice")
    if not invoice_syncro_id:
        raise MappingError(f"Payment {syncro_id} has no invoice")
    amount = _number(
        _first(raw, "amount", "total", "payment_amount", "amount_dollars"),
        0.0,
    )
    if not math.isfinite(amount) or abs(amount) < 0.005:
        raise MappingError(f"Payment {syncro_id} has no valid amount")
    method = _payment_method(raw)
    reference = _text(
        _first(
            raw,
            "reference",
            "transaction_id",
            "payment_reference",
            "check_number",
            "number",
            "external_id",
        ),
        limit=200,
    )
    if not reference and method in {"eftpos", "xero_reconciled"}:
        reference = f"Syncro payment {syncro_id}"
    date = (
        _date_only(_first(raw, "date", "payment_date", "paid_at", "created_at"))
        or invoice.get("paid_date")
        or _now_iso()[:10]
    )
    recorded_at = _iso(_first(raw, "created_at", "recorded_at", "updated_at")) or _now_iso()
    source_method = _text(
        _first(raw, "method", "payment_method", "payment_type", "type"),
        limit=80,
    )
    document = {
        "id": f"syncro-payment-{syncro_id}",
        "syncro_payment_id": syncro_id,
        "syncro_invoice_id": invoice_syncro_id,
        "amount": round(amount, 2),
        "method": method,
        "date": date,
        "reference": reference,
        "notes": _text(_first(raw, "notes", "memo", "description"), limit=4000),
        "recorded_at": recorded_at,
        "recorded_by": "Syncro migration",
        "source": "syncro_migration",
        "entry_type": "refund" if amount < 0 else "payment",
    }
    if invoice_id:
        document["invoice_id"] = invoice_id
    if source_method:
        document["syncro_method"] = source_method
    currency = _text(_first(raw, "currency", "currency_code"), limit=8)
    if currency:
        document["currency"] = currency
    source_status = _text(_first(raw, "status", "payment_status"), limit=40)
    if source_status:
        document["syncro_status"] = source_status
    return {key: value for key, value in document.items() if value not in (None, "")}


async def _map_payment(context: MigrationContext, raw: Mapping[str, Any]) -> MappedRecord:
    syncro_id = _source_id(raw)
    if not syncro_id:
        raise MappingError("Syncro payment has no id")
    invoice_syncro_id = _related_id(raw, "invoice_id", "invoice")
    if not invoice_syncro_id:
        raise MappingError(f"Payment {syncro_id} has no invoice")
    invoice_id = await _resolve_id(
        context, "invoices", "syncro_invoice_id", invoice_syncro_id, "invoices"
    )
    if not invoice_id:
        raise MappingError(
            f"Payment {syncro_id} references unmigrated invoice {invoice_syncro_id}"
        )
    invoice = await _find_by_id(context, "invoices", invoice_id)
    if not invoice:
        raise MappingError(
            f"Payment {syncro_id} references unmigrated invoice {invoice_syncro_id}"
        )
    return MappedRecord(
        document=_payment_document(raw, invoice_id=invoice_id, invoice=invoice)
    )


async def _map_recurring(context: MigrationContext, raw: Mapping[str, Any]) -> MappedRecord:
    syncro_id = _source_id(raw)
    customer_id = _related_id(raw, "customer_id", "customer")
    client_id = await _resolve_id(context, "clients", "syncro_id", customer_id, "clients")
    if not client_id:
        raise MappingError(f"Recurring invoice {syncro_id} references unmigrated customer {customer_id}")
    contract_id = await _resolve_id(
        context, "contracts", "syncro_contract_id", _related_id(raw, "contract_id", "contract"), "contracts"
    )
    name = _text(_first(raw, "name", "description", "template_name"), limit=300) or f"Syncro recurring invoice {syncro_id}"
    status_raw = _text(_first(raw, "status", "state"), limit=40).lower()
    status = "active" if status_raw not in {"paused", "cancelled", "canceled", "inactive", "expired"} else "inactive"
    document = {
        **_base_document(context, "syncro_recurring_invoice_id", syncro_id),
        "client_id": client_id,
        "client_name": await _client_name(context, client_id),
        "contract_id": contract_id,
        "description": name,
        "invoice_name": name,
        "frequency": _frequency(_first(raw, "frequency", "billing_frequency", "interval")),
        "start_date": _date_only(_first(raw, "start_date", "start", "created_at")) or _now_iso()[:10],
        "end_date": _date_only(_first(raw, "end_date", "end")),
        "next_generation": _date_only(_first(raw, "next_run_at", "next_date", "next_generation", "next_occurrence")),
        "status": status,
        "line_items": _line_items(raw),
        "subtotal": _number(_first(raw, "subtotal", "sub_total"), 0.0),
        "tax_rate": _number(_first(raw, "tax_rate", "taxRate"), 0.0),
        "amount": _number(_first(raw, "amount", "total", "grand_total"), 0.0),
        "auto_send": _boolean(_first(raw, "auto_send", "send_automatically"), False),
        "notes": _text(_first(raw, "notes", "memo"), limit=8000) or None,
        "is_recurring": True,
        "include_acronis_usage": False,
        "include_pax8_usage": False,
        "syncro_created_at": _iso(_first(raw, "created_at", "created")),
        "syncro_updated_at": _iso(_first(raw, "updated_at", "updated")),
    }
    document = {key: value for key, value in document.items() if value not in (None, "")}
    document["created_at"] = _iso(_first(raw, "created_at", "created")) or _now_iso()
    return MappedRecord(document=document)


async def _map_ticket(context: MigrationContext, raw: Mapping[str, Any]) -> MappedRecord:
    syncro_id = _source_id(raw)
    customer_id = _related_id(raw, "customer_id", "customer")
    client_id = await _resolve_id(context, "clients", "syncro_id", customer_id, "clients")
    if not client_id:
        raise MappingError(f"Ticket {syncro_id} references unmigrated customer {customer_id}")
    contact_id = await _resolve_id(
        context, "contacts", "syncro_contact_id", _related_id(raw, "contact_id", "contact"), "contacts"
    )
    device_id = await _resolve_id(
        context, "devices", "syncro_asset_id", _related_id(raw, "asset_id", "customer_asset_id", "asset"), "assets"
    )
    parent_id = await _resolve_id(
        context, "tickets", "syncro_ticket_id", _related_id(raw, "parent_id", "parent_ticket_id"), "tickets"
    )
    subject = _text(_first(raw, "subject", "title", "summary"), limit=500) or f"Syncro ticket {syncro_id}"
    number = _text(_first(raw, "number", "ticket_number"), limit=80) or f"SYNCRO-{syncro_id}"
    created_at = _iso(_first(raw, "created_at", "created", "created_date"))
    updated_at = _iso(_first(raw, "updated_at", "updated", "last_updated"))
    document = {
        **_base_document(context, "syncro_ticket_id", syncro_id),
        "ticket_number": number,
        "title": subject,
        "subject": subject,
        "description": _text(_first(raw, "description", "body", "details"), limit=50000) or "",
        "client_id": client_id,
        "client_name": await _client_name(context, client_id),
        "contact_id": contact_id,
        "contact_name": _text(_first(raw, "contact_name"), limit=200) or None,
        "contact_email": _text(_first(raw, "contact_email"), limit=320) or None,
        "device_id": device_id,
        "asset_id": device_id,
        "parent_id": parent_id,
        "status": _ticket_status(_first(raw, "status", "state")),
        "priority": _ticket_priority(_first(raw, "priority", "severity")),
        "category": _text(_first(raw, "category", "issue_type", "type"), limit=120) or "support",
        "ticket_type": _text(_first(raw, "ticket_type", "type"), limit=80) or "incident",
        "source": "syncro",
        "assigned_name": _text(_first(raw, "assignee_name", "assigned_to_name", "user_name", "technician_name"), limit=200) or None,
        "tags": _tags(raw),
        "custom_fields": _custom_fields(raw),
        "last_activity_at": updated_at or created_at,
        "syncro_created_at": created_at,
        "syncro_updated_at": updated_at,
        "syncro_resolved_at": _iso(_first(raw, "resolved_at", "resolved")),
        "syncro_closed_at": _iso(_first(raw, "closed_at", "closed")),
    }
    document = {key: value for key, value in document.items() if value not in (None, "")}
    document["created_at"] = created_at or _now_iso()
    document["updated_at"] = updated_at or document["created_at"]
    return MappedRecord(document=document)


async def _map_ticket_comment(context: MigrationContext, raw: Mapping[str, Any]) -> MappedRecord:
    syncro_id = _source_id(raw)
    ticket_id = await _resolve_id(
        context, "tickets", "syncro_ticket_id", _related_id(raw, "ticket_id", "ticket"), "tickets"
    )
    if not ticket_id:
        raise MappingError(f"Comment {syncro_id} references an unmigrated ticket")
    content = _text(_first(raw, "body", "comment", "content", "description", "text"), limit=50000)
    if not content:
        raise MappingError(f"Comment {syncro_id} has no content")
    document = {
        **_base_document(context, "syncro_comment_id", syncro_id),
        "ticket_id": ticket_id,
        "user_id": f"syncro:{_related_id(raw, 'user_id', 'created_by', 'author_id') or 'unknown'}",
        "user_name": _text(_first(raw, "user_name", "created_by_name", "author_name", "name"), limit=200) or "Syncro",
        "content": content,
        "is_internal": _boolean(_first(raw, "internal", "is_internal", "hidden", "private")),
        "source": "syncro",
        "syncro_created_at": _iso(_first(raw, "created_at", "created")),
    }
    document = {key: value for key, value in document.items() if value not in (None, "")}
    document["created_at"] = _iso(_first(raw, "created_at", "created")) or _now_iso()
    return MappedRecord(document=document)


async def _map_timelog(context: MigrationContext, raw: Mapping[str, Any]) -> MappedRecord:
    syncro_id = _source_id(raw)
    ticket_id = await _resolve_id(
        context, "tickets", "syncro_ticket_id", _related_id(raw, "ticket_id", "ticket"), "tickets"
    )
    if not ticket_id:
        raise MappingError(f"Timelog {syncro_id} references an unmigrated ticket")
    minutes = _integer(_first(raw, "duration_minutes", "minutes", "duration"), 0)
    if minutes <= 0:
        raise MappingError(f"Timelog {syncro_id} has no usable duration")
    rate = _number(_first(raw, "hourly_rate", "rate"), 0.0)
    document = {
        **_base_document(context, "syncro_timelog_id", syncro_id),
        "ticket_id": ticket_id,
        "user_id": f"syncro:{_related_id(raw, 'user_id', 'created_by', 'technician_id') or 'unknown'}",
        "user_name": _text(_first(raw, "user_name", "technician_name", "created_by_name"), limit=200) or "Syncro",
        "description": _text(_first(raw, "notes", "description", "summary"), limit=10000) or "Imported Syncro timelog",
        "minutes": minutes,
        "billable": _boolean(_first(raw, "billable", "is_billable"), True),
        "hourly_rate": rate,
        "total_amount": round((minutes / 60) * rate, 2),
        "date": _date_only(_first(raw, "date", "created_at", "started_at")) or _now_iso()[:10],
        "invoiced": _boolean(_first(raw, "invoiced", "billed"), False),
        "syncro_created_at": _iso(_first(raw, "created_at", "created")),
    }
    document = {key: value for key, value in document.items() if value not in (None, "")}
    document["created_at"] = _iso(_first(raw, "created_at", "created")) or _now_iso()
    return MappedRecord(document=document)


async def _product_by_syncro_id(context: MigrationContext, external_id: str) -> dict[str, Any]:
    if not external_id:
        return {}
    row = await context.database.products.find_one(
        tenant_query(context.tenant_id, {"syncro_product_id": external_id}),
        {"_id": 0, "id": 1, "name": 1, "sku": 1, "tax_rate": 1},
    )
    return dict(row or {})


async def _purchase_order_line_items(
    context: MigrationContext,
    raw: Mapping[str, Any],
) -> list[dict[str, Any]]:
    """Map Syncro PO lines, whose costs are cents and whose product IDs are external."""
    raw_lines = _first(raw, "line_items", "lines", default=[])
    if isinstance(raw_lines, Mapping):
        raw_lines = raw_lines.get("line_items") or raw_lines.get("items") or []
    if not isinstance(raw_lines, list):
        return []
    lines: list[dict[str, Any]] = []
    for item in raw_lines:
        if not isinstance(item, Mapping):
            continue
        external_product = _related_id(item, "product_id", "product")
        product = await _product_by_syncro_id(context, external_product)
        quantity = max(1, _integer(_first(item, "quantity", "qty"), 1))
        unit_price = _cents_or_none(_first(item, "cost_cents", "unit_cost_cents", "costCents"))
        if unit_price is None:
            unit_price = _number(_first(item, "unit_price", "cost", "price"), 0.0)
        total = _cents_or_none(_first(item, "total_cents", "totalCents", "line_total_cents"))
        if total is None:
            total = round(quantity * unit_price, 2)
        received = _boolean(_first(item, "received", "is_received"))
        received_qty = _integer(_first(item, "received_quantity", "received_qty"), quantity if received else 0)
        received_qty = max(0, min(quantity, received_qty))
        name = (
            _text(product.get("name"), limit=300)
            or _text(_first(item, "name", "description", "product_name"), limit=300)
            or f"Syncro product {external_product or 'line'}"
        )
        line_status = "received" if received_qty >= quantity else "partial" if received_qty > 0 else "pending"
        line = {
            "product_id": product.get("id"),
            "product_name": name,
            "name": name,
            "description": name,
            "sku": _text(product.get("sku") or _first(item, "sku", "product_sku"), limit=120) or None,
            "quantity": quantity,
            "unit_price": unit_price,
            "rate": unit_price,
            "total": total,
            "amount": total,
            "tax_rate": _number(product.get("tax_rate") or _first(item, "tax_rate"), 0.0),
            "received_qty": received_qty,
            "returned_qty": 0,
            "status": line_status,
            "received": received_qty >= quantity,
            "received_serials": [],
            "receipt_batches": [],
            "arrival_notified": False,
            "source": "syncro",
            "syncro_line_item_id": _source_id(item) or None,
        }
        lines.append({key: value for key, value in line.items() if value not in (None, "")})
    return lines


async def _map_lead(context: MigrationContext, raw: Mapping[str, Any]) -> MappedRecord:
    syncro_id = _source_id(raw)
    first_name = _text(_first(raw, "first_name", "firstName"))
    last_name = _text(_first(raw, "last_name", "lastName"))
    contact_name = " ".join(part for part in (first_name, last_name) if part).strip()
    email = _text(_first(raw, "email", "email_address"), limit=320) or None
    company_name = (
        _text(_first(raw, "business_then_name", "business_name", "company_name", "customer_business_then_name"), limit=300)
        or contact_name
        or email
        or f"Syncro lead {syncro_id}"
    )
    status, pipeline_stage = _lead_status(_first(raw, "status", "state"))
    customer_external = _related_id(raw, "customer_id", "customer")
    converted_to_client = await _resolve_id(
        context, "clients", "syncro_id", customer_external, "clients"
    )
    address = _address(raw)
    notes_parts = [
        _text(_first(raw, "hidden_notes", "notes", "description"), limit=8000),
        _text(_first(raw, "ticket_description"), limit=8000),
    ]
    if address:
        notes_parts.append(f"Address: {address}")
    document = {
        **_base_document(context, "syncro_lead_id", syncro_id),
        "company_name": company_name,
        "contact_name": contact_name or company_name,
        "email": email,
        "phone": _text(_first(raw, "phone", "phone_number"), limit=80) or None,
        "mobile": _text(_first(raw, "mobile", "mobile_phone"), limit=80) or None,
        "website": _text(_first(raw, "website", "url"), limit=500) or None,
        "source": "syncro",
        "industry": _text(_first(raw, "industry"), limit=200) or None,
        "employee_count": _text(_first(raw, "employee_count", "employees"), limit=80) or None,
        "estimated_value": _number(
            _first(raw, "opportunity_amount_dollars", "estimated_value", "value"), 0.0
        ),
        "status": status,
        "pipeline_stage": pipeline_stage,
        "notes": "\n\n".join(part for part in notes_parts if part) or None,
        "converted_to_client": converted_to_client,
        "address": address,
        "city": _text(_first(raw, "city"), limit=120) or None,
        "state": _text(_first(raw, "state", "province"), limit=120) or None,
        "postal_code": _text(_first(raw, "zip", "postal_code", "postcode"), limit=40) or None,
        "syncro_status": _text(_first(raw, "status", "state"), limit=80) or None,
        "syncro_customer_id": customer_external or None,
        "syncro_contact_id": _related_id(raw, "contact_id", "contact") or None,
        "syncro_user_id": _related_id(raw, "user_id", "assigned_to", "user") or None,
        "syncro_created_at": _iso(_first(raw, "created_at", "created")),
        "syncro_updated_at": _iso(_first(raw, "updated_at", "updated")),
    }
    document = {key: value for key, value in document.items() if value not in (None, "")}
    document["created_at"] = _iso(_first(raw, "created_at", "created")) or _now_iso()
    document["updated_at"] = _iso(_first(raw, "updated_at", "updated")) or document["created_at"]
    return MappedRecord(document=document)


async def _map_vendor(context: MigrationContext, raw: Mapping[str, Any]) -> MappedRecord:
    syncro_id = _source_id(raw)
    contact_name = " ".join(
        part for part in (
            _text(_first(raw, "rep_first_name", "first_name")),
            _text(_first(raw, "rep_last_name", "last_name")),
        ) if part
    ).strip()
    name = _text(_first(raw, "name", "vendor_name", "business_name"), limit=300) or f"Syncro vendor {syncro_id}"
    document = {
        **_base_document(context, "syncro_vendor_id", syncro_id),
        "name": name,
        "contact_name": contact_name or _text(_first(raw, "contact_name"), limit=200) or None,
        "email": _text(_first(raw, "email", "email_address"), limit=320) or None,
        "phone": _text(_first(raw, "phone", "phone_number"), limit=80) or None,
        "website": _text(_first(raw, "website", "url"), limit=500) or None,
        "address": _text(_first(raw, "address", "address1", "street"), limit=500) or None,
        "city": _text(_first(raw, "city"), limit=120) or None,
        "state": _text(_first(raw, "state", "province"), limit=120) or None,
        "postal_code": _text(_first(raw, "zip", "postal_code", "postcode"), limit=40) or None,
        "country": _text(_first(raw, "country"), limit=120) or None,
        "account_number": _text(_first(raw, "account_number", "account_no"), limit=120) or None,
        "abn": _text(_first(raw, "abn"), limit=40) or None,
        "tax_id": _text(_first(raw, "tax_id", "vat_number"), limit=80) or None,
        "payment_terms": _text(_first(raw, "payment_terms"), limit=80) or "Net 30",
        "category": _text(_first(raw, "category", "vendor_type"), limit=80) or "general",
        "notes": _text(_first(raw, "notes", "description"), limit=8000) or None,
        "is_active": _boolean(_first(raw, "active", "is_active"), True),
        "is_preferred": _boolean(_first(raw, "preferred", "is_preferred"), False),
        "total_orders": _integer(_first(raw, "total_orders"), 0),
        "total_spent": _number(_first(raw, "total_spent"), 0.0),
        "rating": _number(_first(raw, "rating"), 0.0),
        "status": "active" if _boolean(_first(raw, "active", "is_active"), True) else "inactive",
        "syncro_created_at": _iso(_first(raw, "created_at", "created")),
        "syncro_updated_at": _iso(_first(raw, "updated_at", "updated")),
    }
    document = {key: value for key, value in document.items() if value not in (None, "")}
    document["created_at"] = _iso(_first(raw, "created_at", "created")) or _now_iso()
    document["updated_at"] = _iso(_first(raw, "updated_at", "updated")) or document["created_at"]
    return MappedRecord(document=document)


async def _map_purchase_order(context: MigrationContext, raw: Mapping[str, Any]) -> MappedRecord:
    syncro_id = _source_id(raw)
    vendor_payload = raw.get("vendor")
    vendor_payload = vendor_payload if isinstance(vendor_payload, Mapping) else {}
    vendor_external = _related_id(raw, "vendor_id", "vendor")
    vendor_id = await _resolve_id(
        context, "vendors", "syncro_vendor_id", vendor_external, "vendors"
    )
    vendor_doc = await _find_by_id(context, "vendors", vendor_id) if vendor_id else {}
    vendor_doc = vendor_doc or {}
    vendor_contact = (
        _text(_first(vendor_payload, "contact_name") or vendor_doc.get("contact_name"), limit=200)
        or " ".join(
            part for part in (
                _text(_first(vendor_payload, "rep_first_name")),
                _text(_first(vendor_payload, "rep_last_name")),
            ) if part
        ).strip()
    )
    vendor_name = (
        _text(_first(raw, "vendor_name"), limit=300)
        or _text(vendor_payload.get("name"), limit=300)
        or _text(vendor_doc.get("name"), limit=300)
        or (f"Syncro vendor {vendor_external}" if vendor_external else "Syncro vendor")
    )
    line_items = await _purchase_order_line_items(context, raw)
    subtotal_default = round(sum(line.get("total", 0) for line in line_items), 2)
    subtotal = _number(_first(raw, "subtotal", "sub_total"), subtotal_default)
    shipping = _number(_first(raw, "shipping", "shipping_cost"), 0.0)
    other = _number(_first(raw, "other", "other_cost"), 0.0)
    total = _number(_first(raw, "total", "grand_total"), round(subtotal + shipping + other, 2))
    tax = _number(_first(raw, "tax", "tax_amount"), max(0.0, round(total - subtotal - shipping - other, 2)))
    notes = "\n\n".join(
        part for part in (
            _text(_first(raw, "general_notes", "notes"), limit=8000),
            _text(_first(raw, "shipping_notes"), limit=2000),
        ) if part
    )
    po_number = _text(_first(raw, "number", "po_number", "purchase_order_number"), limit=80) or f"SYNCRO-PO-{syncro_id}"
    document = {
        **_base_document(context, "syncro_purchase_order_id", syncro_id),
        "po_number": po_number,
        "vendor": vendor_name,
        "vendor_id": vendor_id,
        "vendor_contact": vendor_contact or None,
        "vendor_email": _text(_first(raw, "vendor_email") or vendor_payload.get("email") or vendor_doc.get("email"), limit=320) or None,
        "status": _po_status(_first(raw, "status", "state")),
        "line_items": line_items,
        "subtotal": subtotal,
        "tax": tax,
        "shipping": shipping,
        "other": other,
        "total": total,
        "notes": notes or None,
        "shipping_notes": _text(_first(raw, "shipping_notes"), limit=2000) or None,
        "ship_to": _text(_first(raw, "ship_to", "shipping_address"), limit=2000) or None,
        "expected_delivery": _date_only(_first(raw, "expected_date", "expected_delivery")),
        "due_date": _date_only(_first(raw, "due_date")),
        "paid_date": _date_only(_first(raw, "paid_date")),
        "delivery_tracking": _text(_first(raw, "delivery_tracking", "tracking_number"), limit=500) or None,
        "approval_required": False,
        "created_by": "syncro",
        "created_by_name": "Syncro",
        "last_ping_at": None,
        "escalated": False,
        "version": 1,
        "syncro_status": _text(_first(raw, "status", "state"), limit=80) or None,
        "syncro_user_id": _related_id(raw, "user_id", "user") or None,
        "syncro_created_at": _iso(_first(raw, "created_at", "created")),
        "syncro_updated_at": _iso(_first(raw, "updated_at", "updated")),
    }
    document = {key: value for key, value in document.items() if value not in (None, "")}
    document["created_at"] = _iso(_first(raw, "created_at", "created")) or _now_iso()
    document["updated_at"] = _iso(_first(raw, "updated_at", "updated")) or document["created_at"]
    return MappedRecord(document=document)


# ============== ENTITY REGISTRY ==============


@dataclass(frozen=True)
class EntitySpec:
    key: str
    label: str
    path: str
    collection: str | None = None
    external_field: str | None = None
    mapper: Callable[[MigrationContext, Mapping[str, Any]], Awaitable[MappedRecord]] | None = None
    detail_path: str | None = None
    page_size: int | None = None
    preserve: frozenset[str] = frozenset()
    attachment_kind: str | None = None
    payment_parent: str | None = None
    number_field: str | None = None
    source_number_keys: tuple[str, ...] = ()


ENTITY_SPECS: dict[str, EntitySpec] = {
    "customers": EntitySpec(
        key="customers",
        label="Customers",
        path="/customers",
        collection="clients",
        external_field="syncro_id",
        mapper=_map_customer,
        preserve=frozenset({"mrr", "device_count", "ticket_count", "contacts", "pax8_company_id", "tier", "lifecycle"}),
    ),
    "contacts": EntitySpec(
        key="contacts",
        label="Contacts",
        path="/contacts",
        collection="contacts",
        external_field="syncro_contact_id",
        mapper=_map_contact,
    ),
    "assets": EntitySpec(
        key="assets",
        label="Assets and endpoints",
        path="/customer_assets",
        collection="devices",
        external_field="syncro_asset_id",
        mapper=_map_asset,
        preserve=frozenset(
            {
                "nexus_agent_id",
                "archived",
                "archived_at",
                "archived_by",
                "archived_by_name",
                "archive_reason",
                "lifecycle_state",
                "merged_into_id",
                "merged_at",
                "merged_by",
                "merged_device_ids",
            }
        ),
    ),
    "products": EntitySpec(
        key="products",
        label="Products and services",
        path="/products",
        collection="products",
        external_field="syncro_product_id",
        mapper=_map_product,
    ),
    "contracts": EntitySpec(
        key="contracts",
        label="Contracts",
        path="/contracts",
        collection="contracts",
        external_field="syncro_contract_id",
        mapper=_map_contract,
    ),
    "tickets": EntitySpec(
        key="tickets",
        label="Tickets",
        path="/tickets",
        collection="tickets",
        external_field="syncro_ticket_id",
        mapper=_map_ticket,
        number_field="ticket_number",
        source_number_keys=("number", "ticket_number"),
        preserve=frozenset(
            {
                "merged_into",
                "parent_id",
                "next_checkpoint_at",
                "last_customer_reply_at",
                "last_technician_reply_at",
            }
        ),
    ),
    "ticket_attachments": EntitySpec(
        key="ticket_attachments",
        label="Ticket attachments",
        path="/tickets",
        collection="ticket_attachments",
        external_field="syncro_attachment_id",
        detail_path="/tickets/{id}",
        attachment_kind="ticket",
    ),
    "ticket_comments": EntitySpec(
        key="ticket_comments",
        label="Ticket comments",
        path="/ticket_comments",
        collection="ticket_comments",
        external_field="syncro_comment_id",
        mapper=_map_ticket_comment,
    ),
    "invoices": EntitySpec(
        key="invoices",
        label="Invoices and line items",
        path="/invoices",
        collection="invoices",
        external_field="syncro_invoice_id",
        mapper=_map_invoice,
        number_field="invoice_number",
        source_number_keys=("number", "invoice_number", "invoice_no"),
        detail_path="/invoices/{id}",
        preserve=frozenset({"payments", "xero_invoice_id", "stripe_session_id", "split_billing", "split_billing_parent_id"}),
    ),
    "invoice_attachments": EntitySpec(
        key="invoice_attachments",
        label="Invoice attachments",
        path="/invoices",
        collection="invoice_attachments",
        external_field="syncro_attachment_id",
        detail_path="/invoices/{id}",
        attachment_kind="invoice",
    ),
    "recurring_invoices": EntitySpec(
        key="recurring_invoices",
        label="Recurring invoices",
        path="/schedules",
        collection="recurring_invoices",
        external_field="syncro_recurring_invoice_id",
        mapper=_map_recurring,
        detail_path="/schedules/{id}",
        preserve=frozenset({"include_acronis_usage", "include_pax8_usage", "contract_id"}),
    ),
    "timelogs": EntitySpec(
        key="timelogs",
        label="Ticket time entries",
        path="/timelogs",
        collection="time_entries",
        external_field="syncro_timelog_id",
        mapper=_map_timelog,
    ),
    "payments": EntitySpec(
        key="payments",
        label="Payments",
        path="/payments",
        collection="invoices",
        external_field="syncro_payment_id",
        mapper=_map_payment,
        payment_parent="invoices",
    ),
    "users": EntitySpec(key="users", label="Syncro users", path="/users"),
    "leads": EntitySpec(
        key="leads",
        label="Leads and opportunities",
        path="/leads",
        collection="leads",
        external_field="syncro_lead_id",
        mapper=_map_lead,
        page_size=25,
        preserve=frozenset(
            {
                "status",
                "pipeline_stage",
                "converted_to_client",
                "assigned_to",
                "assigned_name",
                "assigned_to_name",
                "last_contact",
                "next_follow_up",
            }
        ),
    ),
    "vendors": EntitySpec(
        key="vendors",
        label="Vendors",
        path="/vendors",
        collection="vendors",
        external_field="syncro_vendor_id",
        mapper=_map_vendor,
        preserve=frozenset(
            {"status", "is_active", "total_orders", "total_spent", "is_preferred", "rating"}
        ),
    ),
    "purchase_orders": EntitySpec(
        key="purchase_orders",
        label="Purchase orders",
        path="/purchase_orders",
        collection="purchase_orders",
        external_field="syncro_purchase_order_id",
        mapper=_map_purchase_order,
        detail_path="/purchase_orders/{id}",
        page_size=20,
        preserve=frozenset(
            {
                "client_id",
                "client_name",
                "ticket_id",
                "ticket_number",
                "ticket_title",
                "assigned_to",
                "assigned_to_name",
                "approval_required",
                "document_label",
                "document_terms",
                "document_template_id",
                "escalated",
                "escalated_at",
                "last_ping_at",
                "version",
                "status",
                "line_items",
                "subtotal",
                "tax",
                "shipping",
                "other",
                "total",
            }
        ),
    ),
    "purchase_order_attachments": EntitySpec(
        key="purchase_order_attachments",
        label="Purchase-order attachments",
        path="/purchase_orders",
        collection="purchase_orders",
        external_field="syncro_attachment_id",
        detail_path="/purchase_orders/{id}",
        page_size=20,
        attachment_kind="purchase_order",
    ),
    "ticket_blueprints": EntitySpec(key="ticket_blueprints", label="Ticket blueprints", path="/ticket_blueprints"),
    "wiki_pages": EntitySpec(key="wiki_pages", label="Wiki pages", path="/wiki_pages"),
}

# Select every supported record type by default so a single run covers the
# whole tenant. Raw-only entities are archived for later mapping rather than
# silently skipped.
DEFAULT_MIGRATION_ENTITIES = tuple(ENTITY_SPECS)
ALL_MIGRATION_ENTITIES = tuple(ENTITY_SPECS)


def capabilities() -> dict[str, Any]:
    return {
        "mode": "one_time_migration",
        "entities": [
            {
                "key": spec.key,
                "label": spec.label,
                "collection": spec.collection,
                "mapped": bool(spec.mapper or spec.attachment_kind),
                "attachments": bool(spec.attachment_kind),
                "default": spec.key in DEFAULT_MIGRATION_ENTITIES,
                "detail_enrichment": bool(spec.detail_path),
            }
            for spec in ENTITY_SPECS.values()
        ],
        "default_entities": list(DEFAULT_MIGRATION_ENTITIES),
        "notes": [
            "Raw source records are archived first; unmapped fields remain available in syncro_migration_records.",
            "A dry run writes no canonical records.",
            "Re-running an applied migration updates the same records by immutable Syncro IDs.",
            "Nexus never deletes a source or destination record during migration.",
            "Ticket, invoice and purchase-order attachments are retained through their existing private Nexus storage paths.",
            "Ticket and invoice attachments require the configured malware scanner; scanner failures are recorded per file and can be retried.",
            "A mid-transition ticket or invoice without a Syncro ID is linked by its normalised number when exactly one same-client Nexus record matches; ambiguous or cross-client matches fail instead of creating a duplicate.",
            "Payments are written into the owning invoice's payments history and keyed by syncro_payment_id; reruns update the same entry instead of double-counting.",
            "An applied job exposes a reconciliation report comparing archived Syncro invoice totals and payment sums with Nexus, including missing, extra and duplicate payment entries.",
            "Review failures, counts and reconciliation before switching off Syncro.",
        ],
    }


# ============== JOB LIFECYCLE ==============


def _empty_counts() -> dict[str, int]:
    return {"fetched": 0, "created": 0, "updated": 0, "linked": 0, "archived": 0, "failed": 0}


def _job_totals(job: Mapping[str, Any]) -> dict[str, int]:
    totals = _empty_counts()
    for counts in (job.get("counts") or {}).values():
        for key in totals:
            totals[key] += int((counts or {}).get(key) or 0)
    return totals


def _public_job(job: Mapping[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in job.items() if key != "_id"}


async def _fail_stale_jobs(database: Any, tenant_id: str) -> int:
    """Release active jobs whose worker stopped without a terminal state.

    A process restart must not leave the tenant permanently blocked from
    starting another migration. Only jobs that have not written progress for
    ``STALE_JOB_MINUTES`` are touched, and no source or destination records are
    changed.
    """
    rows = await database.syncro_migration_jobs.find(
        tenant_query(tenant_id, {"status": {"$in": ["queued", "running"]}}),
        {"_id": 0, "id": 1, "updated_at": 1},
    ).to_list(50)
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=STALE_JOB_MINUTES)
    failed = 0
    for row in rows:
        updated = row.get("updated_at")
        stale = True
        if updated:
            try:
                parsed = datetime.fromisoformat(str(updated).replace("Z", "+00:00"))
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=timezone.utc)
                stale = parsed < cutoff
            except (TypeError, ValueError):
                stale = True
        if not stale:
            continue
        now = _now_iso()
        await database.syncro_migration_jobs.update_one(
            tenant_query(tenant_id, {"id": row["id"], "status": {"$in": ["queued", "running"]}}),
            {
                "$set": {
                    "status": "failed",
                    "last_error": (
                        "Migration worker stopped before finishing; start a new job to continue. "
                        "No records were deleted."
                    ),
                    "completed_at": now,
                    "updated_at": now,
                }
            },
        )
        failed += 1
    return failed


async def create_job(
    database: Any,
    *,
    tenant_id: str,
    requested_by: str,
    entities: Iterable[str] | None,
    mode: str,
) -> dict[str, Any]:
    if mode not in {"dry_run", "apply"}:
        raise ValueError("mode must be dry_run or apply")
    requested = [
        str(entity).strip()
        for entity in (entities or DEFAULT_MIGRATION_ENTITIES)
        if str(entity).strip()
    ]
    unknown = sorted({entity for entity in requested if entity not in ENTITY_SPECS})
    if unknown:
        raise ValueError(f"Unsupported Syncro entities: {', '.join(unknown)}")
    selected = [entity for entity in requested if entity in ENTITY_SPECS]
    if not selected:
        raise ValueError("No supported Syncro entities were selected")
    # Preserve dependency order (customers before contacts/assets/tickets).
    selected = [entity for entity in ENTITY_SPECS if entity in set(selected)]

    await _fail_stale_jobs(database, tenant_id)
    active = await database.syncro_migration_jobs.find_one(
        tenant_query(tenant_id, {"status": {"$in": ["queued", "running"]}}),
        {"_id": 0, "id": 1},
    )
    if active:
        raise ActiveMigrationError(str(active["id"]))

    now = _now_iso()
    job = {
        "id": str(uuid.uuid4()),
        "tenant_id": tenant_id,
        "status": "queued",
        "mode": mode,
        "entities": selected,
        "counts": {entity: _empty_counts() for entity in selected},
        "totals": _empty_counts(),
        "current_entity": None,
        "current_entity_index": 0,
        "completed_entities": 0,
        "percent": 0,
        "sample": [],
        "last_error": None,
        "cancel_requested": False,
        "requested_by": _text(requested_by) or "system",
        "created_at": now,
        "updated_at": now,
        "started_at": None,
        "completed_at": None,
    }
    await database.syncro_migration_jobs.insert_one(job)
    return _public_job(job)


async def _persist_job(database: Any, job: dict[str, Any]) -> None:
    job["totals"] = _job_totals(job)
    job["updated_at"] = _now_iso()
    await database.syncro_migration_jobs.update_one(
        {"id": job["id"]},
        {
            "$set": {
                "status": job.get("status"),
                "counts": job.get("counts") or {},
                "totals": job["totals"],
                "current_entity": job.get("current_entity"),
                "current_entity_index": job.get("current_entity_index", 0),
                "completed_entities": job.get("completed_entities", 0),
                "percent": job.get("percent", 0),
                "sample": job.get("sample") or [],
                "last_error": job.get("last_error"),
                "cancel_requested": bool(job.get("cancel_requested")),
                "started_at": job.get("started_at"),
                "completed_at": job.get("completed_at"),
                "updated_at": job["updated_at"],
            }
        },
    )


async def _load_syncro_config(database: Any, tenant_id: str) -> dict[str, Any]:
    row = await database.settings.find_one(
        tenant_query(tenant_id, {"type": "syncro"}),
        {"_id": 0},
    )
    if not row or not row.get("api_key") or not row.get("subdomain"):
        raise SyncroConfigurationError("Syncro is not configured for this workspace")
    return row


async def _archive_raw(
    context: MigrationContext,
    *,
    entity: str,
    syncro_id: str,
    raw: Mapping[str, Any],
    mapped_collection: str | None = None,
    mapped_id: str | None = None,
    status: str = "archived",
    parent_syncro_id: str | None = None,
) -> None:
    now = _now_iso()
    checksum = hashlib.sha256(
        json.dumps(raw, sort_keys=True, default=str, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    document = {
        "tenant_id": context.tenant_id,
        "job_id": context.job_id,
        "entity": entity,
        "syncro_id": syncro_id,
        "parent_syncro_id": parent_syncro_id,
        "raw": dict(raw),
        "checksum": checksum,
        "mapped_collection": mapped_collection,
        "mapped_id": mapped_id,
        "status": status,
        "last_seen_at": now,
    }
    # Migration archives are always written by this service with a tenant_id,
    # so use direct equality here. A nested $and/$or query is harder to upsert
    # safely and is unnecessary for records this service owns.
    await context.database.syncro_migration_records.update_one(
        {"tenant_id": context.tenant_id, "entity": entity, "syncro_id": syncro_id},
        {
            "$set": document,
            "$setOnInsert": {
                "id": str(uuid.uuid4()),
                "first_seen_at": now,
            },
        },
        upsert=True,
    )


async def _record_failure(
    context: MigrationContext,
    *,
    entity: str,
    syncro_id: str,
    error: str,
    raw: Mapping[str, Any] | None = None,
) -> None:
    excerpt = ""
    if raw:
        try:
            excerpt = json.dumps(raw, default=str, separators=(",", ":"))[:8000]
        except (TypeError, ValueError):
            excerpt = "raw payload was not JSON serialisable"
    await context.database.syncro_migration_failures.insert_one(
        {
            "id": str(uuid.uuid4()),
            "tenant_id": context.tenant_id,
            "job_id": context.job_id,
            "entity": entity,
            "syncro_id": syncro_id,
            "error": _text(error, limit=600),
            "raw_excerpt": excerpt,
            "created_at": _now_iso(),
        }
    )


def _source_label(entity: str, raw: Mapping[str, Any]) -> str:
    if entity == "customers":
        return _syncro_name(raw) or _source_id(raw)
    if entity == "leads":
        return _text(_first(raw, "business_then_name", "business_name", "email"), limit=120) or _source_id(raw)
    if entity == "tickets":
        return _text(_first(raw, "subject", "title", "number"), limit=120) or _source_id(raw)
    if entity in {"invoices", "recurring_invoices", "purchase_orders"}:
        return _text(_first(raw, "number", "name", "description"), limit=120) or _source_id(raw)
    if entity == "payments":
        reference = _text(
            _first(raw, "reference", "transaction_id", "payment_reference"), limit=80
        ) or "Payment"
        return f"{reference} {_number(_first(raw, 'amount', 'total'), 0.0):.2f}"
    return _text(_first(raw, "name", "hostname", "email", "subject", "description"), limit=120) or _source_id(raw)


def _append_sample(job: dict[str, Any], entity: str, syncro_id: str, label: str, status: str) -> None:
    sample = list(job.get("sample") or [])
    sample.append({"entity": entity, "syncro_id": syncro_id, "label": label, "status": status})
    job["sample"] = sample[-12:]


async def _process_record(
    context: MigrationContext,
    *,
    spec: EntitySpec,
    raw: Mapping[str, Any],
    mode: str,
    counts: dict[str, int],
) -> str:
    syncro_id = _source_id(raw)
    if not syncro_id:
        raise MappingError("Syncro record has no id")
    if mode == "dry_run":
        if not spec.mapper or not spec.collection or not spec.external_field:
            counts["archived"] += 1
            return "archived"
        existing = await _find_existing(context, spec.collection, spec.external_field, syncro_id)
        if not existing and spec.number_field:
            existing = await _find_number_match(
                context,
                collection=spec.collection,
                number_field=spec.number_field,
                number=_source_number(spec, raw),
                client_id=await _source_client_id(context, spec, raw),
                external_field=spec.external_field,
                label=spec.label,
            )
        if existing:
            counts["updated"] += 1
            return "would_update"
        counts["created"] += 1
        return "would_create"

    await _archive_raw(
        context,
        entity=spec.key,
        syncro_id=syncro_id,
        raw=raw,
        mapped_collection=spec.collection,
        status="raw_archived",
        parent_syncro_id=_related_id(raw, "customer_id", "ticket_id", "invoice_id", "vendor_id") or None,
    )

    if not spec.mapper or not spec.collection or not spec.external_field:
        counts["archived"] += 1
        return "archived"

    mapped = await spec.mapper(context, raw)
    document = dict(mapped.document)
    document.setdefault("tenant_id", context.tenant_id)
    document.setdefault(spec.external_field, syncro_id)

    existing = None
    number_match_basis = None
    if mapped.existing_id:
        existing = await _find_by_id(context, spec.collection, mapped.existing_id)
    if not existing:
        existing = await _find_existing(context, spec.collection, spec.external_field, syncro_id)
    if not existing and spec.number_field:
        existing = await _find_number_match(
            context,
            collection=spec.collection,
            number_field=spec.number_field,
            number=_text(document.get(spec.number_field), limit=80) or _source_number(spec, raw),
            client_id=_text(document.get("client_id")) or await _source_client_id(context, spec, raw),
            external_field=spec.external_field,
            label=spec.label,
        )
        if existing:
            number_match_basis = f"{spec.number_field}_match"
    match_basis = mapped.match_basis or number_match_basis

    if existing:
        updates = {
            key: value
            for key, value in document.items()
            if key not in {"id", "created_at", "tenant_id"} and key not in spec.preserve
        }
        if "tags" in updates:
            updates["tags"] = sorted({*_tags(existing), *(_tags({"tags": updates["tags"]}))})
        updates["updated_at"] = _now_iso()
        await context.database[spec.collection].update_one(
            tenant_query(context.tenant_id, {"id": existing["id"]}),
            {"$set": updates},
        )
        mapped_id = str(existing["id"])
        status = "linked" if match_basis else "updated"
        counts["linked" if match_basis else "updated"] += 1
    else:
        document.setdefault("id", str(uuid.uuid4()))
        document.setdefault("created_at", _now_iso())
        document["updated_at"] = _now_iso()
        await context.database[spec.collection].insert_one(document)
        mapped_id = str(document["id"])
        status = "created"
        counts["created"] += 1

    await _archive_raw(
        context,
        entity=spec.key,
        syncro_id=syncro_id,
        raw=raw,
        mapped_collection=spec.collection,
        mapped_id=mapped_id,
        status=status,
        parent_syncro_id=_related_id(raw, "customer_id", "ticket_id", "invoice_id", "vendor_id") or None,
    )
    return status


async def _attachment_parent(
    context: MigrationContext,
    kind: str,
    syncro_parent_id: str,
) -> dict[str, Any] | None:
    if kind == "ticket":
        return await context.database.tickets.find_one(
            tenant_query(context.tenant_id, {"syncro_ticket_id": syncro_parent_id}),
            {
                "_id": 0,
                "id": 1,
                "tenant_id": 1,
                "client_id": 1,
                "syncro_ticket_id": 1,
                "ticket_number": 1,
            },
        )
    if kind == "invoice":
        return await context.database.invoices.find_one(
            tenant_query(context.tenant_id, {"syncro_invoice_id": syncro_parent_id}),
            {
                "_id": 0,
                "id": 1,
                "tenant_id": 1,
                "client_id": 1,
                "syncro_invoice_id": 1,
                "invoice_number": 1,
            },
        )
    return await context.database.purchase_orders.find_one(
        tenant_query(context.tenant_id, {"syncro_purchase_order_id": syncro_parent_id}),
        {
            "_id": 0,
            "id": 1,
            "tenant_id": 1,
            "client_id": 1,
            "syncro_purchase_order_id": 1,
            "po_number": 1,
            "attachments": 1,
        },
    )


async def _process_attachments(
    context: MigrationContext,
    *,
    job: dict[str, Any],
    client: Any,
    spec: EntitySpec,
    mode: str,
) -> bool:
    """Retain ticket, invoice and PO files through their owning Nexus storage path."""
    kind = str(spec.attachment_kind or "")
    counts = job["counts"].setdefault(spec.key, _empty_counts())
    processed_since_flush = 0
    max_bytes = MAX_TICKET_ATTACHMENT_BYTES if kind in {"ticket", "invoice"} else MAX_PO_ATTACHMENT_BYTES

    async def checkpoint() -> bool:
        nonlocal processed_since_flush
        processed_since_flush += 1
        if processed_since_flush < 25:
            return True
        await _persist_job(context.database, job)
        latest = await context.database.syncro_migration_jobs.find_one(
            {"id": job["id"]},
            {"_id": 0, "cancel_requested": 1},
        )
        processed_since_flush = 0
        if latest and latest.get("cancel_requested"):
            job["status"] = "cancelled"
            job["cancel_requested"] = True
            return False
        return True

    async for raw_parent in client.iter_items(spec.path, page_size=spec.page_size):
        parent_syncro_id = _source_id(raw_parent)
        if not parent_syncro_id:
            continue
        try:
            detail = await client.get(
                str(spec.detail_path).format(id=quote(str(parent_syncro_id), safe=""))
            )
            parent_source = _merge_detail(raw_parent, detail)
            nested_container = isinstance(detail, Mapping) and any(
                isinstance(detail.get(key), Mapping)
                for key in ("ticket", "purchase_order", "invoice", "contract", "product", "customer", "lead", "vendor")
            )
            if isinstance(detail, Mapping) and nested_container:
                # Some detail responses keep the parent under a named object and
                # expose attachments as a sibling collection.
                for key in ("attachments", "files", "documents"):
                    sibling = detail.get(key)
                    if not isinstance(sibling, list):
                        continue
                    current = parent_source.get(key)
                    parent_source[key] = (
                        [*current, *sibling] if isinstance(current, list) else list(sibling)
                    )
        except Exception as exc:
            counts["failed"] += 1
            await _record_failure(
                context,
                entity=spec.key,
                syncro_id=parent_syncro_id,
                error=f"Could not load {kind} detail: {_safe_error(exc)}",
                raw=raw_parent,
            )
            if not await checkpoint():
                return False
            continue

        records = _attachment_records(parent_source)
        if not records:
            if not await checkpoint():
                return False
            continue

        nexus_parent = await _attachment_parent(context, kind, parent_syncro_id)
        for record in records:
            counts["fetched"] += 1
            meta = _normalise_attachment(record, parent_kind=kind)
            attachment_id = str(meta["syncro_attachment_id"])
            if not meta.get("url"):
                counts["failed"] += 1
                await _record_failure(
                    context,
                    entity=spec.key,
                    syncro_id=attachment_id,
                    error="Attachment has no download URL",
                    raw=meta["raw"],
                )
                continue
            if mode != "dry_run" and not nexus_parent:
                counts["failed"] += 1
                await _record_failure(
                    context,
                    entity=spec.key,
                    syncro_id=attachment_id,
                    error=f"Parent {kind} {parent_syncro_id} is not migrated",
                    raw=meta["raw"],
                )
                continue

            existing_id: str | None = None
            if nexus_parent:
                if kind in {"ticket", "invoice"}:
                    attachment_store = (
                        context.database.ticket_attachments
                        if kind == "ticket"
                        else context.database.invoice_attachments
                    )
                    parent_field = "ticket_id" if kind == "ticket" else "invoice_id"
                    existing = await attachment_store.find_one(
                        tenant_query(
                            context.tenant_id,
                            {
                                parent_field: nexus_parent.get("id"),
                                "syncro_attachment_id": attachment_id,
                            },
                        ),
                        {"_id": 0, "id": 1},
                    )
                    existing_id = str(existing.get("id")) if existing and existing.get("id") else None
                else:
                    existing_id = next(
                        (
                            str(attachment.get("id"))
                            for attachment in nexus_parent.get("attachments") or []
                            if isinstance(attachment, Mapping)
                            and str(attachment.get("syncro_attachment_id") or "") == attachment_id
                        ),
                        None,
                    )

            if existing_id:
                try:
                    if mode != "dry_run":
                        await _archive_raw(
                            context,
                            entity=spec.key,
                            syncro_id=attachment_id,
                            raw=meta["raw"],
                            mapped_collection=spec.collection,
                            mapped_id=existing_id,
                            status="linked",
                            parent_syncro_id=parent_syncro_id,
                        )
                    counts["linked"] += 1
                    _append_sample(job, spec.key, attachment_id, meta.get("filename") or attachment_id, "linked")
                except Exception as exc:
                    counts["failed"] += 1
                    await _record_failure(
                        context,
                        entity=spec.key,
                        syncro_id=attachment_id,
                        error=_safe_error(exc),
                        raw=meta["raw"],
                    )
                continue

            if mode == "dry_run":
                counts["created"] += 1
                _append_sample(job, spec.key, attachment_id, meta.get("filename") or attachment_id, "would_create")
                continue

            try:
                downloaded = await client.download(
                    meta["url"],
                    max_bytes=max_bytes,
                    filename=meta.get("filename") or None,
                )
                filename = _attachment_filename(
                    downloaded.filename or meta.get("filename") or "",
                    downloaded.content_type or meta.get("content_type") or "",
                    attachment_id,
                )
                if kind == "ticket":
                    from app.routers.ticket_attachments import store_ticket_attachment

                    stored = await store_ticket_attachment(
                        ticket=nexus_parent or {},
                        content=downloaded.content,
                        filename=filename,
                        content_type=downloaded.content_type,
                        uploaded_by="syncro-migration",
                        uploaded_by_name="Syncro migration",
                        source="syncro_migration",
                        syncro_attachment_id=attachment_id,
                        syncro_ticket_id=parent_syncro_id,
                        database=context.database,
                    )
                elif kind == "invoice":
                    from app.routers.invoice_attachments import store_invoice_attachment

                    stored = await store_invoice_attachment(
                        invoice=nexus_parent or {},
                        content=downloaded.content,
                        filename=filename,
                        content_type=downloaded.content_type,
                        uploaded_by="syncro-migration",
                        uploaded_by_name="Syncro migration",
                        source="syncro_migration",
                        syncro_attachment_id=attachment_id,
                        syncro_invoice_id=parent_syncro_id,
                        database=context.database,
                    )
                else:
                    from app.routers.purchase_orders import store_purchase_order_attachment

                    stored = await store_purchase_order_attachment(
                        po_id=str((nexus_parent or {}).get("id") or ""),
                        content=downloaded.content,
                        filename=filename,
                        content_type=downloaded.content_type,
                        category="migration",
                        note="Imported from Syncro",
                        uploaded_by="syncro-migration",
                        uploaded_by_name="Syncro migration",
                        source="syncro_migration",
                        syncro_attachment_id=attachment_id,
                        syncro_purchase_order_id=parent_syncro_id,
                        database=context.database,
                    )
                await _archive_raw(
                    context,
                    entity=spec.key,
                    syncro_id=attachment_id,
                    raw=meta["raw"],
                    mapped_collection=spec.collection,
                    mapped_id=str(stored.get("id") or ""),
                    status="created",
                    parent_syncro_id=parent_syncro_id,
                )
                counts["created"] += 1
                _append_sample(job, spec.key, attachment_id, filename, "created")
            except Exception as exc:  # one bad file must not abort the rest
                counts["failed"] += 1
                await _record_failure(
                    context,
                    entity=spec.key,
                    syncro_id=attachment_id,
                    error=_safe_error(exc),
                    raw=meta["raw"],
                )

        if not await checkpoint():
            return False

    await _persist_job(context.database, job)
    return True


async def _process_payments(
    context: MigrationContext,
    *,
    job: dict[str, Any],
    client: Any,
    spec: EntitySpec,
    mode: str,
) -> bool:
    """Write Syncro payments into the owning invoice's authoritative ledger."""
    counts = job["counts"].setdefault(spec.key, _empty_counts())
    processed_since_flush = 0

    async def checkpoint() -> bool:
        nonlocal processed_since_flush
        processed_since_flush += 1
        if processed_since_flush < 25:
            return True
        await _persist_job(context.database, job)
        latest = await context.database.syncro_migration_jobs.find_one(
            {"id": job["id"]},
            {"_id": 0, "cancel_requested": 1},
        )
        processed_since_flush = 0
        if latest and latest.get("cancel_requested"):
            job["status"] = "cancelled"
            job["cancel_requested"] = True
            return False
        return True

    async for raw in client.iter_items(spec.path, page_size=spec.page_size):
        counts["fetched"] += 1
        syncro_id = _source_id(raw)
        if not syncro_id:
            counts["failed"] += 1
            await _record_failure(
                context,
                entity=spec.key,
                syncro_id="unknown",
                error="Syncro payment has no id",
                raw=raw,
            )
            if not await checkpoint():
                return False
            continue

        parent_syncro_id = _related_id(raw, "invoice_id", "invoice") or None
        try:
            if mode == "dry_run":
                if not parent_syncro_id:
                    raise MappingError(f"Payment {syncro_id} has no invoice")
                invoice_id = await _resolve_id(
                    context,
                    "invoices",
                    "syncro_invoice_id",
                    parent_syncro_id,
                    "invoices",
                )
                invoice = (
                    await _find_by_id(context, "invoices", invoice_id)
                    if invoice_id
                    else None
                )
                _payment_document(
                    raw,
                    invoice_id=invoice_id,
                    invoice=invoice or {},
                )
                payments = list((invoice or {}).get("payments") or [])
                matches = [
                    index
                    for index, item in enumerate(payments)
                    if _payment_entry_matches(item, syncro_id)
                ]
                if len(matches) > 1:
                    raise MappingError(
                        f"Payment {syncro_id} appears multiple times on invoice {invoice_id}"
                    )
                status = "would_update" if matches else "would_create"
                counts["updated" if matches else "created"] += 1
                _append_sample(job, spec.key, syncro_id, _source_label(spec.key, raw), status)
                if not await checkpoint():
                    return False
                continue

            # Preserve source evidence even when the parent invoice cannot
            # be mapped. The successful write below refreshes this row with
            # its final status and mapped invoice ID.
            await _archive_raw(
                context,
                entity=spec.key,
                syncro_id=syncro_id,
                raw=raw,
                mapped_collection=spec.collection,
                mapped_id=None,
                status="raw_archived",
                parent_syncro_id=parent_syncro_id,
            )
            if not spec.mapper:
                raise MappingError(f"Payment {syncro_id} has no mapper")
            mapped = await spec.mapper(context, raw)
            payment = dict(mapped.document)
            invoice_id = _text(payment.get("invoice_id"))
            invoice = await _find_by_id(context, spec.payment_parent or "invoices", invoice_id)
            if not invoice:
                raise MappingError(
                    f"Payment {syncro_id} references unmigrated invoice {parent_syncro_id}"
                )
            payments = list(invoice.get("payments") or [])
            matches = [
                index
                for index, item in enumerate(payments)
                if _payment_entry_matches(item, syncro_id)
            ]
            if len(matches) > 1:
                raise MappingError(
                    f"Payment {syncro_id} appears multiple times on invoice {invoice_id}"
                )

            if matches:
                existing = dict(payments[matches[0]])
                # Source-owned optional fields are cleared when Syncro no longer
                # supplies them; local reconciliation evidence is preserved.
                source_payment = {field: "" for field in _PAYMENT_OPTIONAL_SOURCE_FIELDS}
                source_payment.update(payment)
                if str(existing.get("reconciliation_status") or "") not in {
                    "matched",
                    "settled_pending_xero",
                }:
                    source_payment["reconciliation_status"] = _payment_reconciliation_status(
                        raw, str(payment.get("method") or "other")
                    )
                payments[matches[0]] = {**existing, **source_payment}
                status = "updated"
                counts["updated"] += 1
            else:
                payment["reconciliation_status"] = _payment_reconciliation_status(
                    raw, str(payment.get("method") or "other")
                )
                payments.append(payment)
                status = "created"
                counts["created"] += 1
            result = await context.database[spec.payment_parent or "invoices"].update_one(
                tenant_query(context.tenant_id, {"id": invoice_id}),
                {
                    "$set": {
                        "payments": payments,
                        "updated_at": _now_iso(),
                    }
                },
            )
            if getattr(result, "matched_count", 0) == 0:
                raise RuntimeError(
                    f"Invoice {invoice_id} changed during payment migration"
                )
            await _archive_raw(
                context,
                entity=spec.key,
                syncro_id=syncro_id,
                raw=raw,
                mapped_collection=spec.collection,
                mapped_id=invoice_id,
                status=status,
                parent_syncro_id=parent_syncro_id,
            )
            _append_sample(job, spec.key, syncro_id, _source_label(spec.key, raw), status)
        except MappingError as exc:
            counts["failed"] += 1
            await _record_failure(
                context,
                entity=spec.key,
                syncro_id=syncro_id,
                error=_safe_error(exc),
                raw=raw,
            )
        except Exception as exc:  # one bad payment must not abort the rest
            counts["failed"] += 1
            await _record_failure(
                context,
                entity=spec.key,
                syncro_id=syncro_id,
                error=_safe_error(exc),
                raw=raw,
            )

        if not await checkpoint():
            return False

    await _persist_job(context.database, job)
    return True


async def _process_entity(
    context: MigrationContext,
    *,
    job: dict[str, Any],
    client: Any,
    entity: str,
    mode: str,
) -> bool:
    spec = ENTITY_SPECS[entity]
    if spec.attachment_kind:
        return await _process_attachments(context, job=job, client=client, spec=spec, mode=mode)
    if spec.payment_parent:
        return await _process_payments(context, job=job, client=client, spec=spec, mode=mode)
    counts = job["counts"].setdefault(entity, _empty_counts())
    processed_since_flush = 0
    async for raw in client.iter_items(spec.path, page_size=spec.page_size):
        syncro_id = _source_id(raw)
        counts["fetched"] += 1
        if syncro_id:
            try:
                if spec.detail_path and not _line_items(raw):
                    detail = await client.get(spec.detail_path.format(id=quote(str(syncro_id), safe="")))
                    raw = _merge_detail(raw, detail)
                status = await _process_record(
                    context,
                    spec=spec,
                    raw=raw,
                    mode=mode,
                    counts=counts,
                )
                _append_sample(job, entity, syncro_id, _source_label(entity, raw), status)
            except MappingError as exc:
                counts["failed"] += 1
                await _record_failure(
                    context,
                    entity=entity,
                    syncro_id=syncro_id,
                    error=_safe_error(exc),
                    raw=raw,
                )
            except Exception as exc:  # a single bad record must not abort a migration
                counts["failed"] += 1
                await _record_failure(
                    context,
                    entity=entity,
                    syncro_id=syncro_id or "unknown",
                    error=_safe_error(exc),
                    raw=raw,
                )
        processed_since_flush += 1
        if processed_since_flush >= 25:
            await _persist_job(context.database, job)
            latest = await context.database.syncro_migration_jobs.find_one(
                {"id": job["id"]},
                {"_id": 0, "cancel_requested": 1},
            )
            if latest and latest.get("cancel_requested"):
                job["status"] = "cancelled"
                job["cancel_requested"] = True
                return False
            processed_since_flush = 0

    # An empty source entity is a valid result. The job records zero fetched so
    # an operator can distinguish "nothing to migrate" from "entity skipped".
    await _persist_job(context.database, job)
    return True


async def run_migration_job(
    job_id: str,
    *,
    database: Any | None = None,
    client_factory: Callable[[dict[str, Any]], Any] | None = None,
) -> dict[str, Any] | None:
    database = database or db
    job = await database.syncro_migration_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        return None
    if job.get("status") not in {"queued", "running"}:
        return _public_job(job)

    job["status"] = "running"
    job["started_at"] = job.get("started_at") or _now_iso()
    await _persist_job(database, job)

    client: Any | None = None
    try:
        config = await _load_syncro_config(database, str(job["tenant_id"]))
        client = (
            client_factory(config)
            if client_factory
            else SyncroClient(config.get("subdomain"), config.get("api_key"))
        )
        context = MigrationContext(
            database=database,
            tenant_id=str(job["tenant_id"]),
            job_id=str(job["id"]),
        )
        entities = [entity for entity in job.get("entities") or [] if entity in ENTITY_SPECS]
        for index, entity in enumerate(entities):
            latest = await database.syncro_migration_jobs.find_one(
                {"id": job["id"]},
                {"_id": 0, "cancel_requested": 1},
            )
            if latest and latest.get("cancel_requested"):
                job["status"] = "cancelled"
                job["cancel_requested"] = True
                break
            if job.get("status") == "cancelled":
                break
            job["current_entity"] = entity
            job["current_entity_index"] = index
            job["percent"] = round((index / max(len(entities), 1)) * 100, 1)
            await _persist_job(database, job)
            completed = await _process_entity(
                context,
                job=job,
                client=client,
                entity=entity,
                mode=str(job.get("mode") or "dry_run"),
            )
            if not completed:
                break
            job["completed_entities"] = index + 1
            job["percent"] = round(((index + 1) / max(len(entities), 1)) * 100, 1)
            await _persist_job(database, job)
        if job.get("status") != "cancelled":
            job["status"] = "completed"
            job["percent"] = 100
        job["current_entity"] = None
    except Exception as exc:
        job["status"] = "failed"
        job["last_error"] = _safe_error(exc)
        logger.warning("Syncro migration job %s failed: %s", job_id, _safe_error(exc))
    finally:
        if client is not None and hasattr(client, "close"):
            try:
                await client.close()
            except Exception:
                logger.debug("Syncro migration client close failed", exc_info=True)
        job["completed_at"] = _now_iso()
        await _persist_job(database, job)
    return _public_job(job)


async def list_jobs(database: Any, tenant_id: str, *, limit: int = 20) -> list[dict[str, Any]]:
    rows = await database.syncro_migration_jobs.find(
        tenant_query(tenant_id, {}),
        {"_id": 0},
    ).sort("created_at", -1).to_list(max(1, min(limit, 100)))
    return [_public_job(row) for row in rows]


async def get_job(database: Any, tenant_id: str, job_id: str) -> dict[str, Any] | None:
    job = await database.syncro_migration_jobs.find_one(
        tenant_query(tenant_id, {"id": job_id}),
        {"_id": 0},
    )
    return _public_job(job) if job else None


async def list_failures(
    database: Any,
    tenant_id: str,
    job_id: str,
    *,
    limit: int = 100,
) -> list[dict[str, Any]]:
    rows = await database.syncro_migration_failures.find(
        tenant_query(tenant_id, {"job_id": job_id}),
        {"_id": 0, "raw_excerpt": 0},
    ).sort("created_at", -1).to_list(max(1, min(limit, 500)))
    return list(rows)


# ============== POST-MIGRATION RECONCILIATION ==============

RECONCILIATION_TOLERANCE = 0.005
MAX_RECONCILIATION_RECORDS = 50_000
MAX_RECONCILIATION_DETAILS = 100
MAX_RECONCILIATION_PAYMENT_ISSUES = 50


def _money(value: Any) -> float:
    return round(_number(value, 0.0), 2)


def _currency_code(value: Any) -> str:
    return _text(value, limit=8).upper()


def _money_changed(left: Any, right: Any) -> bool:
    return abs(_money(left) - _money(right)) >= RECONCILIATION_TOLERANCE


def _bounded_details(rows: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "count": len(rows),
        "items": rows[:MAX_RECONCILIATION_DETAILS],
        "truncated": len(rows) > MAX_RECONCILIATION_DETAILS,
    }


async def build_reconciliation_report(
    database: Any,
    tenant_id: str,
    job_id: str,
    *,
    issues_only: bool = True,
    limit: int = 100,
    offset: int = 0,
    all_rows: bool = False,
) -> dict[str, Any] | None:
    """Compare archived Syncro invoice/payment evidence with Nexus invoices.

    The report is deliberately tenant-wide rather than limited to one job's
    entity selection: a payment-only re-run still needs to be compared with the
    invoices migrated by an earlier run. The job supplies the authorisation and
    provenance, while the raw archive and canonical invoices supply the data.
    """
    job = await get_job(database, tenant_id, job_id)
    if not job:
        return None

    raw_rows = await database.syncro_migration_records.find(
        tenant_query(tenant_id, {"entity": {"$in": ["invoices", "payments"]}}),
        {
            "_id": 0,
            "entity": 1,
            "syncro_id": 1,
            "raw": 1,
            "status": 1,
            "job_id": 1,
        },
    ).to_list(MAX_RECONCILIATION_RECORDS)
    canonical_rows = await database.invoices.find(
        tenant_query(tenant_id, {"syncro_invoice_id": {"$exists": True}}),
        {
            "_id": 0,
            "id": 1,
            "syncro_invoice_id": 1,
            "invoice_number": 1,
            "client_id": 1,
            "total": 1,
            "amount_paid": 1,
            "payment_status": 1,
            "payments": 1,
        },
    ).to_list(MAX_RECONCILIATION_RECORDS)
    raw_truncated = len(raw_rows) >= MAX_RECONCILIATION_RECORDS
    canonical_truncated = len(canonical_rows) >= MAX_RECONCILIATION_RECORDS

    source_invoices: dict[str, dict[str, Any]] = {}
    source_payments: dict[str, dict[str, Any]] = {}
    for row in raw_rows:
        raw = row.get("raw") if isinstance(row.get("raw"), Mapping) else {}
        syncro_id = _text(row.get("syncro_id")) or _source_id(raw)
        if not syncro_id:
            continue
        entity = _text(row.get("entity"))
        if entity == "invoices":
            source_invoices[syncro_id] = {
                "syncro_invoice_id": syncro_id,
                "invoice_number": _text(
                    _first(raw, "number", "invoice_number", "invoice_no"), limit=80
                ),
                "client_syncro_id": _related_id(raw, "customer_id", "customer"),
                "status": _text(_first(raw, "status", "invoice_status"), limit=40),
                "total": _money(_first(raw, "total", "amount", "grand_total")),
                "amount_paid": _money(
                    _first(raw, "amount_paid", "paid_amount", "amountPaid")
                ),
                "currency": _currency_code(_first(raw, "currency", "currency_code")),
            }
        elif entity == "payments":
            source_payments[syncro_id] = {
                "syncro_payment_id": syncro_id,
                "invoice_syncro_id": _related_id(raw, "invoice_id", "invoice"),
                "amount": _money(
                    _first(raw, "amount", "total", "payment_amount", "amount_dollars")
                ),
                "currency": _currency_code(_first(raw, "currency", "currency_code")),
            }

    nexus_invoices_by_source: dict[str, list[dict[str, Any]]] = {}
    for invoice in canonical_rows:
        source_id = _text(invoice.get("syncro_invoice_id"))
        if not source_id:
            continue
        nexus_invoices_by_source.setdefault(source_id, []).append(invoice)

    # Reconcile currency codes without inventing one. When one side omitted the
    # code, use the other side's code; otherwise group the evidence separately.
    for source_id, source in source_invoices.items():
        candidates = nexus_invoices_by_source.get(source_id) or []
        if not source["currency"] and candidates:
            source["currency"] = _currency_code(candidates[0].get("currency"))
        source["currency"] = source["currency"] or "UNSPECIFIED"
    for payment in source_payments.values():
        parent = source_invoices.get(payment["invoice_syncro_id"])
        payment["currency"] = (
            (parent or {}).get("currency")
            or payment["currency"]
            or "UNSPECIFIED"
        )

    nexus_payment_index: dict[str, list[dict[str, Any]]] = {}
    nexus_entries_by_invoice: dict[str, list[dict[str, Any]]] = {}
    for invoice in canonical_rows:
        invoice_source_id = _text(invoice.get("syncro_invoice_id"))
        invoice_id = _text(invoice.get("id"))
        for entry in invoice.get("payments") or []:
            payment_source_id = _payment_entry_source_id(entry)
            if not payment_source_id:
                continue
            item = {
                "syncro_payment_id": payment_source_id,
                "invoice_syncro_id": invoice_source_id,
                "invoice_id": invoice_id,
                "amount": _money(entry.get("amount")),
                "currency": _currency_code(invoice.get("currency")),
            }
            nexus_payment_index.setdefault(payment_source_id, []).append(item)
            nexus_entries_by_invoice.setdefault(invoice_source_id, []).append(item)

    source_payments_by_invoice: dict[str, list[dict[str, Any]]] = {}
    for payment in source_payments.values():
        source_payments_by_invoice.setdefault(
            payment["invoice_syncro_id"], []
        ).append(payment)

    orphan_source_payments = [
        payment
        for payment in source_payments.values()
        if payment["invoice_syncro_id"] not in source_invoices
    ]
    unexpected_nexus_invoices = [
        {
            "syncro_invoice_id": source_id,
            "invoice_count": len(invoices),
            "currency": _currency_code(invoices[0].get("currency")) or "UNSPECIFIED",
            "invoices": [
                {"id": _text(invoice.get("id")), "invoice_number": _text(invoice.get("invoice_number"))}
                for invoice in invoices[:MAX_RECONCILIATION_DETAILS]
            ],
        }
        for source_id, invoices in nexus_invoices_by_source.items()
        if source_id not in source_invoices
    ]
    duplicate_nexus_invoices = [
        {
            "syncro_invoice_id": source_id,
            "invoice_count": len(invoices),
            "currency": _currency_code(invoices[0].get("currency")) or "UNSPECIFIED",
            "invoices": [
                {"id": _text(invoice.get("id")), "invoice_number": _text(invoice.get("invoice_number"))}
                for invoice in invoices[:MAX_RECONCILIATION_DETAILS]
            ],
        }
        for source_id, invoices in nexus_invoices_by_source.items()
        if len(invoices) > 1
    ]
    unexpected_nexus_payments = [
        item
        for item in (entry for entries in nexus_payment_index.values() for entry in entries)
        if item["syncro_payment_id"] not in source_payments
    ]
    duplicate_nexus_payments = [
        {
            "syncro_payment_id": payment_id,
            "entry_count": len(entries),
            "currency": entries[0].get("currency") or "UNSPECIFIED",
            "entries": entries[:MAX_RECONCILIATION_DETAILS],
        }
        for payment_id, entries in nexus_payment_index.items()
        if len(entries) > 1
    ]

    rows: list[dict[str, Any]] = []
    for source_id in sorted(source_invoices):
        source = source_invoices[source_id]
        nexus_candidates = nexus_invoices_by_source.get(source_id, [])
        nexus_invoice = nexus_candidates[0] if nexus_candidates else None
        source_payments_here = source_payments_by_invoice.get(source_id, [])
        nexus_entries = nexus_entries_by_invoice.get(source_id, [])
        nexus_by_payment: dict[str, list[dict[str, Any]]] = {}
        for item in nexus_entries:
            nexus_by_payment.setdefault(item["syncro_payment_id"], []).append(item)

        issue_codes: set[str] = set()
        payment_issues: list[dict[str, Any]] = []
        source_currency = source["currency"]
        nexus_currency = (
            _currency_code((nexus_invoice or {}).get("currency")) or source_currency
        )
        if not nexus_invoice:
            issue_codes.add("missing_invoice")
        if len(nexus_candidates) > 1:
            issue_codes.add("duplicate_nexus_invoice")
        if nexus_invoice and source_currency != nexus_currency:
            issue_codes.add("currency_mismatch")

        source_payment_ids = {payment["syncro_payment_id"] for payment in source_payments_here}
        for payment in source_payments_here:
            payment_id = payment["syncro_payment_id"]
            entries = nexus_by_payment.get(payment_id, [])
            if not entries:
                global_entries = nexus_payment_index.get(payment_id, [])
                kind = "wrong_invoice_payment" if global_entries else "missing_payment"
                issue_codes.add(kind)
                payment_issues.append(
                    {
                        "syncro_payment_id": payment_id,
                        "kind": kind,
                        "source_amount": payment["amount"],
                        "nexus_amount": _money(
                            sum(entry["amount"] for entry in global_entries)
                        )
                        if global_entries
                        else 0.0,
                    }
                )
                continue
            if len(entries) > 1:
                issue_codes.add("duplicate_payment")
                payment_issues.append(
                    {
                        "syncro_payment_id": payment_id,
                        "kind": "duplicate_payment",
                        "source_amount": payment["amount"],
                        "nexus_amount": _money(sum(entry["amount"] for entry in entries)),
                    }
                )
            nexus_amount = _money(sum(entry["amount"] for entry in entries))
            if _money_changed(payment["amount"], nexus_amount):
                issue_codes.add("payment_amount_mismatch")
                payment_issues.append(
                    {
                        "syncro_payment_id": payment_id,
                        "kind": "payment_amount_mismatch",
                        "source_amount": payment["amount"],
                        "nexus_amount": nexus_amount,
                    }
                )
        for payment_id in nexus_by_payment:
            if payment_id not in source_payment_ids:
                issue_codes.add("extra_nexus_payment")
                payment_issues.append(
                    {
                        "syncro_payment_id": payment_id,
                        "kind": "extra_nexus_payment",
                        "source_amount": 0.0,
                        "nexus_amount": _money(
                            sum(entry["amount"] for entry in nexus_by_payment[payment_id])
                        ),
                    }
                )

        nexus_total = _money((nexus_invoice or {}).get("total"))
        nexus_amount_paid = _money((nexus_invoice or {}).get("amount_paid"))
        source_total = _money(source["total"])
        source_amount_paid = _money(source["amount_paid"])
        if nexus_invoice and _money_changed(source_total, nexus_total):
            issue_codes.add("invoice_total_mismatch")
        if nexus_invoice and _money_changed(source_amount_paid, nexus_amount_paid):
            issue_codes.add("amount_paid_mismatch")

        source_payment_sum = _money(
            sum(payment["amount"] for payment in source_payments_here)
        )
        nexus_payment_sum = _money(sum(entry["amount"] for entry in nexus_entries))
        if len(source_payments_here) != len(nexus_entries):
            issue_codes.add("payment_count_mismatch")
        if _money_changed(source_payment_sum, nexus_payment_sum):
            issue_codes.add("payment_sum_mismatch")

        rows.append(
            {
                "syncro_invoice_id": source_id,
                "invoice_number": source["invoice_number"]
                or _text((nexus_invoice or {}).get("invoice_number")),
                "currency": source_currency,
                "source_currency": source_currency,
                "nexus_currency": nexus_currency if nexus_invoice else "",
                "nexus_invoice_id": _text((nexus_invoice or {}).get("id")),
                "client_id": _text((nexus_invoice or {}).get("client_id")),
                "client_syncro_id": source["client_syncro_id"],
                "source_status": source["status"],
                "nexus_payment_status": _text(
                    (nexus_invoice or {}).get("payment_status")
                ),
                "source_total": source_total,
                "nexus_total": nexus_total,
                "total_delta": round(source_total - nexus_total, 2),
                "source_amount_paid": source_amount_paid,
                "nexus_amount_paid": nexus_amount_paid,
                "amount_paid_delta": round(source_amount_paid - nexus_amount_paid, 2),
                "source_payment_count": len(source_payments_here),
                "nexus_payment_count": len(nexus_entries),
                "source_payment_sum": source_payment_sum,
                "nexus_payment_sum": nexus_payment_sum,
                "payment_delta": round(source_payment_sum - nexus_payment_sum, 2),
                "issue_codes": sorted(issue_codes),
                "payment_issues": payment_issues[:MAX_RECONCILIATION_PAYMENT_ISSUES],
                "payment_issues_truncated": len(payment_issues)
                > MAX_RECONCILIATION_PAYMENT_ISSUES,
            }
        )

    source_invoice_total = _money(sum(source["total"] for source in source_invoices.values()))
    source_amount_paid = _money(
        sum(source["amount_paid"] for source in source_invoices.values())
    )
    nexus_invoice_total = _money(
        sum(
            _money(nexus_invoices_by_source[source_id][0].get("total"))
            for source_id in source_invoices
            if nexus_invoices_by_source.get(source_id)
        )
    )
    nexus_amount_paid = _money(
        sum(
            _money(nexus_invoices_by_source[source_id][0].get("amount_paid"))
            for source_id in source_invoices
            if nexus_invoices_by_source.get(source_id)
        )
    )
    source_payment_total = _money(
        sum(payment["amount"] for payment in source_payments.values())
    )
    all_nexus_payment_entries = [
        entry for entries in nexus_payment_index.values() for entry in entries
    ]
    nexus_payment_total = _money(
        sum(entry["amount"] for entry in all_nexus_payment_entries)
    )

    def _currency_bucket(mapping: dict[str, dict[str, Any]], code: str) -> dict[str, Any]:
        return mapping.setdefault(
            code or "UNSPECIFIED",
            {
                "invoice_count": 0,
                "invoice_total": 0.0,
                "amount_paid": 0.0,
                "payment_count": 0,
                "payment_total": 0.0,
            },
        )

    source_by_currency: dict[str, dict[str, Any]] = {}
    for source in source_invoices.values():
        bucket = _currency_bucket(source_by_currency, source["currency"])
        bucket["invoice_count"] += 1
        bucket["invoice_total"] += _money(source["total"])
        bucket["amount_paid"] += _money(source["amount_paid"])
    for payment in source_payments.values():
        bucket = _currency_bucket(source_by_currency, payment["currency"])
        bucket["payment_count"] += 1
        bucket["payment_total"] += _money(payment["amount"])

    nexus_by_currency: dict[str, dict[str, Any]] = {}
    for source_id, source in source_invoices.items():
        candidates = nexus_invoices_by_source.get(source_id) or []
        if not candidates:
            continue
        first = candidates[0]
        currency = _currency_code(first.get("currency")) or source["currency"]
        bucket = _currency_bucket(nexus_by_currency, currency)
        bucket["invoice_count"] += 1
        bucket["invoice_total"] += _money(first.get("total"))
        bucket["amount_paid"] += _money(first.get("amount_paid"))
    for invoice in canonical_rows:
        source_id = _text(invoice.get("syncro_invoice_id"))
        currency = (
            _currency_code(invoice.get("currency"))
            or (source_invoices.get(source_id) or {}).get("currency")
            or "UNSPECIFIED"
        )
        for entry in invoice.get("payments") or []:
            if not _payment_entry_source_id(entry):
                continue
            bucket = _currency_bucket(nexus_by_currency, currency)
            bucket["payment_count"] += 1
            bucket["payment_total"] += _money(entry.get("amount"))

    currencies = sorted(
        set(source_by_currency) | set(nexus_by_currency),
        key=lambda code: (code == "UNSPECIFIED", code),
    )
    currency_status = (
        "none"
        if not currencies
        else "unspecified"
        if currencies == ["UNSPECIFIED"]
        else "single"
        if len(currencies) == 1
        else "mixed"
    )
    by_currency: dict[str, dict[str, Any]] = {}
    currency_totals_match = True
    for code in currencies:
        source_side = source_by_currency.get(
            code,
            {
                "invoice_count": 0,
                "invoice_total": 0.0,
                "amount_paid": 0.0,
                "payment_count": 0,
                "payment_total": 0.0,
            },
        )
        nexus_side = nexus_by_currency.get(
            code,
            {
                "invoice_count": 0,
                "invoice_total": 0.0,
                "amount_paid": 0.0,
                "payment_count": 0,
                "payment_total": 0.0,
            },
        )
        source_side = {
            **source_side,
            "invoice_total": _money(source_side["invoice_total"]),
            "amount_paid": _money(source_side["amount_paid"]),
            "payment_total": _money(source_side["payment_total"]),
        }
        nexus_side = {
            **nexus_side,
            "invoice_total": _money(nexus_side["invoice_total"]),
            "amount_paid": _money(nexus_side["amount_paid"]),
            "payment_total": _money(nexus_side["payment_total"]),
        }
        side_difference = {
            "invoice_total": round(
                source_side["invoice_total"] - nexus_side["invoice_total"], 2
            ),
            "amount_paid": round(
                source_side["amount_paid"] - nexus_side["amount_paid"], 2
            ),
            "payment_total": round(
                source_side["payment_total"] - nexus_side["payment_total"], 2
            ),
            "payment_count": source_side["payment_count"] - nexus_side["payment_count"],
        }
        by_currency[code] = {
            "source": source_side,
            "nexus": nexus_side,
            "difference": side_difference,
        }
        if (
            abs(side_difference["invoice_total"]) >= RECONCILIATION_TOLERANCE
            or abs(side_difference["amount_paid"]) >= RECONCILIATION_TOLERANCE
            or abs(side_difference["payment_total"]) >= RECONCILIATION_TOLERANCE
            or side_difference["payment_count"] != 0
        ):
            currency_totals_match = False

    mismatch_invoice_count = sum(1 for row in rows if row["issue_codes"])
    issue_counts: dict[str, int] = {}
    for row in rows:
        for code in row["issue_codes"]:
            issue_counts[code] = issue_counts.get(code, 0) + 1
    invoice_delta = round(source_invoice_total - nexus_invoice_total, 2)
    paid_delta = round(source_amount_paid - nexus_amount_paid, 2)
    payment_delta = round(source_payment_total - nexus_payment_total, 2)
    payment_count_delta = len(source_payments) - len(all_nexus_payment_entries)
    has_source_records = bool(source_invoices or source_payments)
    reconciled = (
        has_source_records
        and not raw_truncated
        and not canonical_truncated
        and mismatch_invoice_count == 0
        and abs(invoice_delta) < RECONCILIATION_TOLERANCE
        and abs(paid_delta) < RECONCILIATION_TOLERANCE
        and abs(payment_delta) < RECONCILIATION_TOLERANCE
        and payment_count_delta == 0
        and currency_totals_match
        and not orphan_source_payments
        and not unexpected_nexus_invoices
        and not duplicate_nexus_invoices
        and not unexpected_nexus_payments
        and not duplicate_nexus_payments
    )

    filtered_rows = [row for row in rows if row["issue_codes"]] if issues_only else rows
    filtered_rows.sort(
        key=lambda row: (
            not bool(row["issue_codes"]),
            (row["invoice_number"] or row["syncro_invoice_id"]).casefold(),
            row["syncro_invoice_id"],
        )
    )
    safe_limit = (
        len(filtered_rows)
        if all_rows
        else max(1, min(int(limit or 100), 500))
    )
    safe_offset = 0 if all_rows else max(0, int(offset or 0))
    page = filtered_rows[safe_offset : safe_offset + safe_limit]

    report_status = (
        "reconciled"
        if reconciled
        else "no_source_records"
        if not has_source_records
        else "attention_required"
    )
    return {
        "generated_at": _now_iso(),
        "scope": "tenant_migration_archive",
        "tolerance": RECONCILIATION_TOLERANCE,
        "job": {
            "id": _text(job.get("id")),
            "status": _text(job.get("status")),
            "mode": _text(job.get("mode")),
            "requested_by": _text(job.get("requested_by")),
            "completed_at": job.get("completed_at"),
        },
        "status": report_status,
        "matched": reconciled,
        "has_source_records": has_source_records,
        "coverage": {
            "raw_record_count": len(raw_rows),
            "canonical_invoice_count": len(canonical_rows),
            "raw_truncated": raw_truncated,
            "canonical_invoices_truncated": canonical_truncated,
        },
        "source": {
            "invoice_count": len(source_invoices),
            "invoice_total": source_invoice_total,
            "amount_paid": source_amount_paid,
            "payment_count": len(source_payments),
            "payment_total": source_payment_total,
        },
        "nexus": {
            "linked_invoice_count": sum(
                1 for source_id in source_invoices if nexus_invoices_by_source.get(source_id)
            ),
            "missing_invoice_count": sum(
                1 for source_id in source_invoices if not nexus_invoices_by_source.get(source_id)
            ),
            "invoice_total": nexus_invoice_total,
            "amount_paid": nexus_amount_paid,
            "payment_count": len(all_nexus_payment_entries),
            "payment_total": nexus_payment_total,
        },
        "difference": {
            "invoice_total": invoice_delta,
            "amount_paid": paid_delta,
            "payment_total": payment_delta,
            "payment_count": payment_count_delta,
        },
        "currencies": currencies,
        "currency_status": currency_status,
        "by_currency": by_currency,
        "warnings": [
            {
                "code": "multiple_currencies",
                "message": "Amounts are grouped by currency and are not converted.",
            }
        ]
        if currency_status == "mixed"
        else [],
        "mismatch_invoice_count": mismatch_invoice_count,
        "issue_counts": issue_counts,
        "invoices": page,
        "invoice_total_count": len(filtered_rows),
        "returned_count": len(page),
        "offset": safe_offset,
        "limit": safe_limit,
        "truncated": safe_offset + len(page) < len(filtered_rows),
        "payment_exceptions": {
            "orphan_source_payments": _bounded_details(orphan_source_payments),
            "unexpected_nexus_invoices": _bounded_details(unexpected_nexus_invoices),
            "duplicate_nexus_invoices": _bounded_details(duplicate_nexus_invoices),
            "unexpected_nexus_payments": _bounded_details(unexpected_nexus_payments),
            "duplicate_nexus_payments": _bounded_details(duplicate_nexus_payments),
        },
    }


def _csv_text(value: Any) -> str:
    text = _text(value)
    return "'" + text if text.startswith(("=", "+", "-", "@")) else text


def reconciliation_csv(report: Mapping[str, Any]) -> str:
    """Render the reconciliation rows as a spreadsheet-safe CSV export."""
    import csv
    import io

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "record_type",
            "syncro_id",
            "parent_syncro_id",
            "label",
            "issue_codes",
            "source_total",
            "nexus_total",
            "total_delta",
            "source_amount_paid",
            "nexus_amount_paid",
            "amount_paid_delta",
            "source_payment_count",
            "nexus_payment_count",
            "source_payment_sum",
            "nexus_payment_sum",
            "payment_delta",
            "detail",
            "currency",
        ]
    )

    for row in report.get("invoices") or []:
        writer.writerow(
            [
                "invoice",
                _csv_text(row.get("syncro_invoice_id")),
                "",
                _csv_text(row.get("invoice_number")),
                " | ".join(row.get("issue_codes") or []),
                row.get("source_total") or 0,
                row.get("nexus_total") or 0,
                row.get("total_delta") or 0,
                row.get("source_amount_paid") or 0,
                row.get("nexus_amount_paid") or 0,
                row.get("amount_paid_delta") or 0,
                row.get("source_payment_count") or 0,
                row.get("nexus_payment_count") or 0,
                row.get("source_payment_sum") or 0,
                row.get("nexus_payment_sum") or 0,
                row.get("payment_delta") or 0,
                "",
                _csv_text(row.get("currency")),
            ]
        )
        for issue in row.get("payment_issues") or []:
            source_amount = _number(issue.get("source_amount"))
            nexus_amount = _number(issue.get("nexus_amount"))
            writer.writerow(
                [
                    "payment_issue",
                    _csv_text(issue.get("syncro_payment_id")),
                    _csv_text(row.get("syncro_invoice_id")),
                    _csv_text(issue.get("kind")),
                    _csv_text(issue.get("kind")),
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    round(source_amount, 2),
                    round(nexus_amount, 2),
                    round(source_amount - nexus_amount, 2),
                    "",
                    _csv_text(row.get("currency")),
                ]
            )

    exceptions = report.get("payment_exceptions") or {}
    for item in (exceptions.get("orphan_source_payments") or {}).get("items") or []:
        writer.writerow(
            [
                "orphan_source_payment",
                _csv_text(item.get("syncro_payment_id")),
                _csv_text(item.get("invoice_syncro_id")),
                "Orphan source payment",
                "orphan_source_payment",
                "",
                "",
                "",
                "",
                "",
                "",
                1,
                0,
                item.get("amount") or 0,
                "",
                "",
                "",
                _csv_text(item.get("currency")),
            ]
        )
    for item in (exceptions.get("unexpected_nexus_payments") or {}).get("items") or []:
        writer.writerow(
            [
                "unexpected_nexus_payment",
                _csv_text(item.get("syncro_payment_id")),
                _csv_text(item.get("invoice_syncro_id")),
                "Unexpected Nexus payment",
                "unexpected_nexus_payment",
                "",
                "",
                "",
                "",
                "",
                "",
                0,
                1,
                "",
                item.get("amount") or 0,
                "",
                "",
                _csv_text(item.get("currency")),
            ]
        )
    for item in (exceptions.get("duplicate_nexus_payments") or {}).get("items") or []:
        writer.writerow(
            [
                "duplicate_nexus_payment",
                _csv_text(item.get("syncro_payment_id")),
                "",
                f"{item.get('entry_count') or 0} entries",
                "duplicate_payment",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                json.dumps(item.get("entries") or [], separators=(",", ":")),
                _csv_text(item.get("currency")),
            ]
        )
    for item in (exceptions.get("duplicate_nexus_invoices") or {}).get("items") or []:
        writer.writerow(
            [
                "duplicate_nexus_invoice",
                _csv_text(item.get("syncro_invoice_id")),
                "",
                f"{item.get('invoice_count') or 0} invoices",
                "duplicate_nexus_invoice",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                json.dumps(item.get("invoices") or [], separators=(",", ":")),
                _csv_text(item.get("currency")),
            ]
        )
    for item in (exceptions.get("unexpected_nexus_invoices") or {}).get("items") or []:
        writer.writerow(
            [
                "unexpected_nexus_invoice",
                _csv_text(item.get("syncro_invoice_id")),
                "",
                f"{item.get('invoice_count') or 0} invoices",
                "unexpected_nexus_invoice",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                json.dumps(item.get("invoices") or [], separators=(",", ":")),
                _csv_text(item.get("currency")),
            ]
        )
    return "\ufeff" + output.getvalue()
