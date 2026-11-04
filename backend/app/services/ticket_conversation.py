"""Safe rich-text helpers for the ticket conversation boundary.

Ticket comments are both technician work records and (when public) customer
communication.  The browser may send Tiptap HTML, but the API is the trust
boundary: it stores a small semantic allow-list and a plain-text projection for
search, auditing and empty-content validation.
"""

from __future__ import annotations

from html import escape
from html.parser import HTMLParser
from typing import Iterable
from urllib.parse import urlparse

from fastapi import HTTPException


_ALLOWED_TAGS = frozenset({
    "a", "b", "blockquote", "br", "code", "em", "h1", "h2", "h3", "i",
    "li", "ol", "p", "pre", "s", "strong", "table", "tbody", "td", "th",
    "thead", "tr", "u", "ul",
})
_VOID_TAGS = frozenset({"br"})
_TEXT_BREAK_TAGS = frozenset({"br", "p", "li", "blockquote", "pre", "h1", "h2", "h3", "tr"})
_MAX_CONTENT_LENGTH = 50_000


def _safe_href(value: str) -> str | None:
    candidate = str(value or "").strip()
    if not candidate:
        return None
    parsed = urlparse(candidate)
    if parsed.scheme.lower() not in {"http", "https", "mailto"}:
        return None
    return candidate


class _TicketHtmlSanitiser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.text_parts: list[str] = []
        self.open_tags: list[str] = []

    def handle_starttag(self, tag: str, attrs: Iterable[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag not in _ALLOWED_TAGS:
            return
        if tag == "a":
            href = _safe_href(dict(attrs).get("href") or "")
            if href:
                self.parts.append(f'<a href="{escape(href, quote=True)}" rel="noopener noreferrer">')
            else:
                self.parts.append("<a>")
        else:
            self.parts.append(f"<{tag}>")
        if tag not in _VOID_TAGS:
            self.open_tags.append(tag)
        if tag in _TEXT_BREAK_TAGS:
            self.text_parts.append("\n")

    def handle_startendtag(self, tag: str, attrs: Iterable[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag not in _ALLOWED_TAGS or tag in _VOID_TAGS:
            return
        # HTML copied from rich clients is sometimes imperfect.  Close through
        # a matching allowed tag without manufacturing arbitrary markup.
        if tag not in self.open_tags:
            return
        while self.open_tags:
            opened = self.open_tags.pop()
            self.parts.append(f"</{opened}>")
            if opened in _TEXT_BREAK_TAGS:
                self.text_parts.append("\n")
            if opened == tag:
                break

    def handle_data(self, data: str) -> None:
        self.parts.append(escape(data, quote=False))
        self.text_parts.append(data)

    def result(self) -> tuple[str, str]:
        while self.open_tags:
            self.parts.append(f"</{self.open_tags.pop()}>")
        return "".join(self.parts).strip(), " ".join("".join(self.text_parts).split())


def sanitise_ticket_rich_text(value: object) -> tuple[str, str]:
    """Return safe semantic HTML and its plain-text projection.

    Newline-only/plain text is represented as paragraphs so pasted technician
    notes remain readable in both the ticket UI and email delivery.
    """
    raw = str(value or "")
    if len(raw) > _MAX_CONTENT_LENGTH:
        raise HTTPException(status_code=422, detail="An update may contain up to 50,000 characters")

    parser = _TicketHtmlSanitiser()
    parser.feed(raw)
    parser.close()
    html, text = parser.result()
    if not text:
        raise HTTPException(status_code=422, detail="Write an update before publishing")
    if "<" not in raw:
        paragraphs = [escape(line, quote=False) for line in raw.splitlines() if line.strip()]
        html = "".join(f"<p>{line}</p>" for line in paragraphs) or f"<p>{escape(raw, quote=False)}</p>"
    return html, text
