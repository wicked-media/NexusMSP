"""Small, shared controls for user-supplied upload metadata."""

from __future__ import annotations

from io import BytesIO
from pathlib import PurePath
from typing import Iterable
from zipfile import BadZipFile, ZipFile

from fastapi import HTTPException


IMAGE_EXTENSIONS = frozenset({"jpg", "jpeg", "png", "gif", "webp"})
ATTACHMENT_EXTENSIONS = frozenset({
    "bin", "csv", "doc", "docx", "eml", "gif", "jpg", "jpeg", "json",
    "log", "msg", "pdf", "png", "ppt", "pptx", "txt", "webp", "xls",
    "xlsx", "xml", "zip",
})


def upload_is_releasable(record: dict) -> bool:
    """Allow explicit clean verdicts and documented pre-quarantine records."""
    scan_status = (record.get("security_scan") or {}).get("status")
    return not scan_status or scan_status == "clean"


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


def validate_upload_signature(content: bytes, extension: str) -> None:
    """Reject empty files and high-confidence extension/content mismatches.

    Malware scanning is a separate mandatory boundary. These checks stop a
    browser-active or executable payload from being labelled as a trusted
    image/document before it reaches that scanner.
    """
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    ext = str(extension or "").strip().lower().lstrip(".")
    fixed_signatures = {
        "pdf": (b"%PDF-",),
        "png": (b"\x89PNG\r\n\x1a\n",),
        "jpg": (b"\xff\xd8\xff",),
        "jpeg": (b"\xff\xd8\xff",),
        "gif": (b"GIF87a", b"GIF89a"),
    }
    signatures = fixed_signatures.get(ext)
    if signatures and not content.startswith(signatures):
        raise HTTPException(status_code=400, detail="File content does not match its extension")
    if ext == "webp" and not (content.startswith(b"RIFF") and content[8:12] == b"WEBP"):
        raise HTTPException(status_code=400, detail="File content does not match its extension")

    if ext in {"doc", "xls", "ppt", "msg"} and not content.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
        raise HTTPException(status_code=400, detail="File content does not match its extension")

    if ext in {"zip", "docx", "xlsx", "pptx"}:
        try:
            with ZipFile(BytesIO(content)) as archive:
                names = set(archive.namelist())
        except (BadZipFile, OSError):
            raise HTTPException(status_code=400, detail="File content does not match its extension")
        required_prefix = {"docx": "word/", "xlsx": "xl/", "pptx": "ppt/"}.get(ext)
        package_mismatch = required_prefix and (
            "[Content_Types].xml" not in names
            or not any(name.startswith(required_prefix) for name in names)
        )
        if package_mismatch:
            raise HTTPException(status_code=400, detail="File content does not match its extension")

    if ext in {"csv", "eml", "json", "log", "md", "txt", "xml"} and b"\x00" in content[:8192]:
        raise HTTPException(status_code=400, detail="File content does not match its extension")
