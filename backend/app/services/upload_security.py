"""Small, shared controls for user-supplied upload metadata."""

from __future__ import annotations

from pathlib import PurePath
from typing import Iterable

from fastapi import HTTPException


IMAGE_EXTENSIONS = frozenset({"jpg", "jpeg", "png", "gif", "webp"})
ATTACHMENT_EXTENSIONS = frozenset({
    "bin", "csv", "doc", "docx", "eml", "gif", "jpg", "jpeg", "json",
    "log", "msg", "pdf", "png", "ppt", "pptx", "txt", "webp", "xls",
    "xlsx", "xml", "zip",
})


def safe_upload_extension(
    filename: str | None,
    *,
    allowed: Iterable[str],
    default: str | None = None,
) -> str:
    """Return a normalized allow-listed extension without path components.

    Multipart filenames are attacker-controlled.  Building a storage path from
    ``filename.split('.')[-1]`` can preserve slashes and ``..`` segments.
    Only the basename suffix is considered and it must match the allow-list.
    """
    original = str(filename or "").replace("\\", "/")
    basename = PurePath(original).name
    suffix = PurePath(basename).suffix.lower().lstrip(".")
    allowed_set = {str(value).strip().lower().lstrip(".") for value in allowed}
    if suffix in allowed_set:
        return suffix
    if not suffix and default and default.lower().lstrip(".") in allowed_set:
        return default.lower().lstrip(".")
    raise HTTPException(status_code=400, detail="Unsupported file type")


def safe_original_filename(filename: str | None, *, default: str = "attachment") -> str:
    """Return a display-only basename stripped of control characters."""
    basename = PurePath(str(filename or "").replace("\\", "/")).name
    cleaned = "".join(character for character in basename if ord(character) >= 32 and character not in "\r\n")
    return cleaned[:180] or default
