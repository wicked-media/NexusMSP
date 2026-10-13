"""Shared, branded PDF rendering for NexusMSP client-facing evidence documents.

The reports hub and the QBR workflow both use this module.  Keeping the
document system in one place prevents individual workflows from slowly
drifting back to generic report layouts.
"""

from __future__ import annotations

from datetime import datetime
from itertools import zip_longest
from io import BytesIO
from pathlib import Path
from typing import Any, Iterable
from xml.sax.saxutils import escape

from app.database import UPLOADS_DIR
from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


INK = colors.HexColor("#0B172A")
SLATE = colors.HexColor("#526276")
MUTED = colors.HexColor("#718096")
SURFACE = colors.HexColor("#F4F7FB")
SURFACE_STRONG = colors.HexColor("#EAF0F7")
LINE = colors.HexColor("#D9E2EC")
WHITE = colors.white

# A distribution table (status, priority, category counts) is the shape most
# report sections arrive in. It renders as a ranked table with a share bar so a
# client pack reads as a document rather than as a list of strings.
DISTRIBUTION_BAR_WIDTH = 32 * mm
SHARE_BAR_HEIGHT = 2.6 * mm
MAX_RECORD_COLUMNS = 6


def _as_text(value: Any) -> str:
    """Return printable, predictable text for built-in PDF fonts.

    Report payloads may include copied punctuation or legacy mojibake.  The
    document font intentionally stays with the core PDF font set for portable
    client downloads, so normalise the few characters that commonly render as
    gibberish rather than letting them leak into a customer document.
    """
    if value is None:
        return "Not recorded"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, (int, float, str)):
        text = str(value)
    elif isinstance(value, list):
        text = ", ".join(_as_text(item) for item in value) or "None"
    elif isinstance(value, dict):
        text = "; ".join(
            f"{_label(key)}: {_as_text(item)}"
            for key, item in value.items()
        ) or "None"
    else:
        text = str(value)

    replacements = {
        "\u2014": "-", "\u2013": "-", "\u2022": "-", "\u2026": "...",
        "\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"',
        "\u2192": "->", "\u00b7": "-", "\u00a0": " ",
        "\u00e2\u20ac\u201d": "-", "\u00e2\u20ac\u201c": "-", "\u00e2\u20ac\u00a2": "-",
        "\u00c2\u00b7": "-",
    }
    for source, replacement in replacements.items():
        text = text.replace(source, replacement)
    return text.encode("latin-1", "replace").decode("latin-1")


def _safe_color(value: Any, fallback: colors.Color) -> colors.Color:
    try:
        return colors.HexColor(str(value))
    except (TypeError, ValueError):
        return fallback


def _branding_logo_path(branding: dict[str, Any]) -> str | None:
    """Return a verified local branding logo suitable for ReportLab.

    Branding values are URLs because they are also consumed by the web UI.  A
    generated document must never fetch an arbitrary URL while rendering, so
    it only resolves the filename inside Nexus' managed branding directory.
    SVG uploads remain valid web assets; ReportLab simply falls back to the
    typographic masthead when it cannot render their format.
    """
    for key in ("invoice_logo_url", "company_logo_url", "letterhead_logo_url"):
        raw_url = str(branding.get(key) or "").strip()
        if not raw_url:
            continue
        filename = Path(raw_url.split("?", 1)[0]).name
        if not filename:
            continue
        candidate = UPLOADS_DIR / "branding" / filename
        if candidate.is_file():
            return str(candidate)
    return None


def _timestamp(value: Any) -> str:
    if not value:
        return "Not recorded"
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed.strftime("%d %b %Y at %H:%M UTC")
    except (TypeError, ValueError):
        return _as_text(value)


def _paragraph(value: Any, style: ParagraphStyle) -> Paragraph:
    return Paragraph(escape(_as_text(value)), style)


def _number_text(value: Any) -> str:
    """Render counts and amounts readably without ever guessing a unit.

    The API supplies real numbers for measured evidence, so thousands
    separators are always safe.  Currency and percentage symbols are added only
    where the field name states the unit, never inferred from magnitude.
    """
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, int):
        return f"{value:,}"
    if isinstance(value, float):
        if float(value).is_integer():
            return f"{value:,.0f}"
        # A client document never prints binary float noise: 96.40% reads as
        # 96.4% and 6.40 hours as 6.4 hours. Money keeps its cents through
        # ``_money_text``, which is chosen from the field name, never here.
        return f"{value:,.2f}".rstrip("0").rstrip(".")
    return _as_text(value)


# Units are read from the field name, never from magnitude: a count called
# ``tickets_total`` must not become "$148.00" and a balance must keep its cents.
_MONEY_UNITS = (
    "amount", "balance", "outstanding", "subtotal", "tax", "price", "rate", "cost",
    "mrr", "arr", "revenue", "invoiced", "paid", "spend", "discount", "fee", "budget", "margin",
)
_MONEY_TOKENS = frozenset((*_MONEY_UNITS, "total", "value", "net", "gross"))
_COUNT_SUBJECTS = (
    "tickets", "devices", "jobs", "assets", "sessions", "patches", "alerts", "invoices",
    "items", "clients", "users", "lines", "records", "checks", "subscriptions", "contracts",
)


def _money_label(label: Any) -> bool:
    """True when a field name states a currency amount."""
    name = str(label or "").strip().lower()
    if not name:
        return False
    tokens = name.split("_")
    if tokens[-1] in _MONEY_TOKENS:
        return not any(subject in tokens[:-1] for subject in _COUNT_SUBJECTS)
    return any(unit in name for unit in _MONEY_UNITS)


def _money_text(value: Any) -> str:
    try:
        return f"${float(value):,.2f}"
    except (TypeError, ValueError):
        return _as_text(value)


# Field names arrive snake_cased from the API. A client-facing document must
# read as professional prose, so the tokens that are acronyms are translated
# rather than title-cased into "Sla" and "Pct", which reads as a leaked
# database column. This glossary is the document's house style.
_LABEL_ACRONYMS = {
    "sla": "SLA", "csat": "CSAT", "nps": "NPS", "kpi": "KPI", "roi": "ROI",
    "rpo": "RPO", "rto": "RTO", "mrr": "MRR", "arr": "ARR", "api": "API",
    "os": "OS", "ip": "IP", "url": "URL", "id": "ID", "ids": "IDs",
    "qbr": "QBR", "sql": "SQL", "cpu": "CPU", "ram": "RAM", "ssd": "SSD",
    "gpu": "GPU", "vpn": "VPN", "mfa": "MFA", "eol": "EOL", "eos": "EOS",
    "m365": "M365", "voip": "VoIP", "sip": "SIP", "it": "IT", "ad": "AD",
    "av": "AV", "msp": "MSP", "epp": "EPP", "edr": "EDR", "tls": "TLS",
    "db": "DB", "vm": "VM", "vms": "VMs", "csv": "CSV", "pdf": "PDF",
    "btu": "BTU", "pat": "PAT", "pki": "PKI", "ups": "UPS", "nas": "NAS",
}

# A unit is printed with the value, not with the label: "SLA compliance 96.4%",
# never "SLA compliance pct 96.4%".
_LABEL_UNIT_TOKENS = frozenset({"pct", "percent", "percentage"})


def document_label(key: Any) -> str:
    """Human label for a stored field name, in the document's own voice.

    Shared by every Nexus document surface so an on-screen report and its
    downloaded PDF name the same field the same way.
    """
    raw = str(key or "").replace("-", " ").replace("_", " ").strip()
    if not raw:
        return ""
    words = []
    for token in raw.split():
        lowered = token.lower()
        if lowered in _LABEL_UNIT_TOKENS:
            continue
        words.append(_LABEL_ACRONYMS.get(lowered, lowered.capitalize()))
    return " ".join(words) or str(key)


# Internal alias: the module reads better with the short name at the call sites.
_label = document_label


def _value_text(key: Any, value: Any) -> str:
    """Field-aware evidence text for a key/value pair."""
    if _is_numeric(value):
        label = str(key or "").lower()
        if any(marker in label for marker in ("pct", "percent", "_share")):
            return f"{_number_text(value)}%"
        if _money_label(key):
            return _money_text(value)
    return _number_text(value)


def _is_numeric(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _section_heading(number: int, title: str, primary: colors.Color, styles: dict[str, ParagraphStyle]) -> Table:
    """Numbered section bar, so a review can cite "section 03" directly."""
    label = Paragraph(
        f'<font color="#BFDBFE">{number:02d}</font>&nbsp;&nbsp;{escape(_as_text(title).upper())}',
        styles["section_label"],
    )
    table = Table([[label]], colWidths=[178 * mm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), INK),
        ("LINEBEFORE", (0, 0), (0, -1), 3, primary),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return table


def _sub_heading(title: str, styles: dict[str, ParagraphStyle]) -> Table:
    table = Table([[Paragraph(escape(_as_text(title).upper()), styles["sub_heading"])]], colWidths=[178 * mm])
    table.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, -1), 0.5, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    return table


def _standard_table_style(primary: colors.Color) -> list[tuple]:
    return [
        ("BACKGROUND", (0, 0), (-1, 0), primary),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.35, LINE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, SURFACE]),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]


def _document_control(items: list[tuple[str, str]], styles: dict[str, ParagraphStyle], primary: colors.Color, width: float) -> Table:
    """The provenance strip: who produced this, when, and on what basis."""
    cells = [
        [Paragraph(escape(_as_text(label).upper()), styles["meta_label"]), Paragraph(escape(_as_text(value)), styles["meta_value"])]
        for label, value in items
    ]
    rows: list[list[Any]] = []
    for start in range(0, len(cells), 4):
        row = cells[start:start + 4]
        while len(row) < 4:
            row.append([Paragraph("", styles["meta_label"]), Paragraph("", styles["meta_value"])])
        rows.append(row)
    table = Table(rows, colWidths=[width / 4] * 4)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), WHITE),
        ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("LINEBEFORE", (0, 0), (0, -1), 2.5, primary),
        ("LINEAFTER", (0, 0), (-2, -1), 0.5, LINE),
        ("LINEABOVE", (0, 0), (-1, 0), 2.5, primary),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return table


def _metric_band(cards: list[tuple], styles: dict[str, ParagraphStyle], primary: colors.Color, width: float) -> Table:
    """Headline evidence tiles. A tile may carry a third caption value."""
    cells = []
    for card in cards:
        label, value = card[0], card[1]
        caption = card[2] if len(card) > 2 else None
        stack = [
            Paragraph(escape(_as_text(label).upper()), styles["metric_label"]),
            Paragraph(escape(_number_text(value)), styles["metric_value"]),
        ]
        if caption not in (None, ""):
            stack.append(Paragraph(escape(_as_text(caption)), styles["metric_caption"]))
        cells.append(stack)
    table = Table([cells], colWidths=[width / len(cells)])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), WHITE),
        ("BOX", (0, 0), (-1, -1), 0.6, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.6, LINE),
        ("LINEABOVE", (0, 0), (-1, 0), 2.5, primary),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    return table


def _contents_strip(titles: list[str], styles: dict[str, ParagraphStyle], primary: colors.Color, width: float) -> Table:
    """A short contents index. Only used once a document has real sections."""
    entries = [f"{number:02d}   {_as_text(title)}" for number, title in enumerate(titles, start=1)]
    half = (len(entries) + 1) // 2
    left, right = entries[:half], entries[half:]
    rows = [
        [Paragraph(escape(left_item), styles["contents"]), Paragraph(escape(right_item), styles["contents"])]
        for left_item, right_item in zip_longest(left, right, fillvalue="")
    ]
    table = Table(rows, colWidths=[width / 2, width / 2])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), SURFACE),
        ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("LINEBEFORE", (0, 0), (0, -1), 2.5, primary),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    return table


def _closing_note(text: str, styles: dict[str, ParagraphStyle], primary: colors.Color, width: float) -> Table:
    """Document control: the retention statement plus how the evidence was read."""
    method = (
        "Evidence basis: retained Nexus records captured at generation time. "
        "Dimensions without recorded evidence are reported as not recorded, and this document is a "
        "point-in-time snapshot rather than a forecast."
    )
    table = Table([
        [Paragraph(escape(_as_text(text)), styles["body_strong"])],
        [Spacer(1, 1.6 * mm)],
        [Paragraph(escape(method), styles["footer"])],
    ], colWidths=[width])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), SURFACE),
        ("LINEBEFORE", (0, 0), (0, -1), 2.5, primary),
        ("BOX", (0, 0), (-1, -1), 0.35, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return table


def _value_table(values: dict[str, Any], styles: dict[str, ParagraphStyle], primary: colors.Color) -> Table:
    rows = [[_paragraph("Measure", styles["table_header"]), _paragraph("Recorded evidence", styles["table_header"])]]
    numeric = [
        key for key, value in values.items()
        if _is_numeric(value) or (isinstance(value, str) and value.replace(",", "").replace(".", "", 1).isdigit())
    ]
    for key, value in values.items():
        label = _label(key)
        style = styles["body_right"] if key in numeric else styles["body"]
        rows.append([_paragraph(label, styles["body_strong"]), Paragraph(escape(_value_text(key, value)), style)])
    table = Table(rows, colWidths=[86 * mm, 92 * mm], repeatRows=1)
    table.setStyle(_standard_table_style(primary) + [("ALIGN", (1, 0), (1, -1), "RIGHT")])
    return table


def _metric_grid(values: dict[str, Any], styles: dict[str, ParagraphStyle]) -> Table:
    """The summary section reads as a metric grid, not as a second table."""
    pairs = [
        (_label(key), _value_text(key, value))
        for key, value in values.items()
        if not isinstance(value, (dict, list))
    ]
    rows = []
    for start in range(0, len(pairs), 2):
        chunk = pairs[start:start + 2]
        cells: list[Any] = []
        for label, value in chunk:
            cells.extend([
                Paragraph(escape(_as_text(label)), styles["meta_label"]),
                Paragraph(escape(_as_text(value)), styles["metric_value_small"]),
            ])
        while len(cells) < 4:
            cells.append("")
        rows.append(cells)
    table = Table(rows, colWidths=[60 * mm, 29 * mm, 60 * mm, 29 * mm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), WHITE),
        ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.35, LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return table


def _share_bar(share: float, primary: colors.Color) -> Table:
    share = max(0.0, min(1.0, float(share or 0)))
    filled = max(0.5 * mm, DISTRIBUTION_BAR_WIDTH * share)
    remainder = max(0.5 * mm, DISTRIBUTION_BAR_WIDTH - filled)
    bar = Table([["", ""]], colWidths=[filled, remainder], rowHeights=[SHARE_BAR_HEIGHT])
    bar.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), primary),
        ("BACKGROUND", (1, 0), (1, 0), SURFACE_STRONG),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return bar


def _looks_like_distribution(key: Any, values: dict[str, Any]) -> bool:
    """A breakdown renders as ranked evidence; a set of metrics stays a table."""
    if len(values) < 2 or not all(_is_numeric(value) for value in values.values()):
        return False
    name = str(key or "").lower()
    if name.startswith("by_") or name.endswith(("breakdown", "distribution", "mix", "split")):
        return True
    metric_markers = (
        "total", "count", "rate", "pct", "percent", "score", "average", "_sum",
        "assets", "devices", "tickets", "sessions", "patches", "invoices",
    )
    return not any(marker in str(label).lower() for label in values for marker in metric_markers)


def _distribution_table(values: dict[str, Any], styles: dict[str, ParagraphStyle], primary: colors.Color) -> Table:
    items = [(_label(key), float(value)) for key, value in values.items() if _is_numeric(value)]
    if not items:
        return _value_table(values, styles, primary)
    total = sum(value for _, value in items)
    rows = [[
        _paragraph("Category", styles["table_header"]),
        _paragraph("Count", styles["table_header"]),
        _paragraph("Share of total", styles["table_header"]),
        _paragraph("%", styles["table_header"]),
    ]]
    for label, value in items:
        share = (value / total) if total else 0.0
        rows.append([
            _paragraph(label, styles["body_strong"]),
            Paragraph(escape(_number_text(int(value) if value.is_integer() else value)), styles["body_right"]),
            _share_bar(share, primary),
            _paragraph(f"{share * 100:.1f}%", styles["body_right"]),
        ])
    rows.append([
        _paragraph("Total", styles["body_strong"]),
        Paragraph(escape(_number_text(int(total) if float(total).is_integer() else total)), styles["body_strong_right"]),
        "",
        _paragraph("100.0%" if total else "-", styles["body_strong_right"]),
    ])
    table = Table(rows, colWidths=[68 * mm, 22 * mm, DISTRIBUTION_BAR_WIDTH + 10 * mm, 20 * mm], repeatRows=1)
    table.setStyle(_standard_table_style(primary) + [
        ("BACKGROUND", (0, -1), (-1, -1), SURFACE_STRONG),
        ("VALIGN", (0, 1), (-1, -1), "MIDDLE"),
    ])
    return table


def _records_table(values: list[dict[str, Any]], styles: dict[str, ParagraphStyle], primary: colors.Color) -> Table:
    keys: list[str] = []
    for row in values:
        for key in row:
            if key not in keys:
                keys.append(key)
        if len(keys) >= MAX_RECORD_COLUMNS:
            break
    keys = keys[:MAX_RECORD_COLUMNS]
    if not keys:
        return _value_table({"Evidence": "No retained entries"}, styles, primary)

    numeric_columns = []
    money_columns = []
    for position, key in enumerate(keys):
        supplied = [row.get(key) for row in values if row.get(key) not in (None, "")]
        if supplied and all(_is_numeric(value) for value in supplied):
            numeric_columns.append(position)
            if _money_label(key):
                money_columns.append(position)

    rows = [[_paragraph(_label(key), styles["table_header"]) for key in keys]]
    for row in values:
        cells = []
        for position, key in enumerate(keys):
            if position in money_columns:
                cells.append(Paragraph(escape(_money_text(row.get(key))), styles["body_right"]))
            elif position in numeric_columns:
                cells.append(Paragraph(escape(_number_text(row.get(key))), styles["body_right"]))
            else:
                cells.append(_paragraph(row.get(key), styles["body"]))
        rows.append(cells)

    width = 178 * mm / len(keys)
    table = Table(rows, colWidths=[width] * len(keys), repeatRows=1)
    style = _standard_table_style(primary)
    last_first_cell = str(list(values[-1].values())[0] if values[-1] else "").strip().lower() if values else ""
    if last_first_cell.startswith("total"):
        style.append(("BACKGROUND", (0, -1), (-1, -1), SURFACE_STRONG))
        style.append(("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"))
    table.setStyle(style)
    return table


def _aging_table(values: dict[str, Any], styles: dict[str, ParagraphStyle], primary: colors.Color) -> Table:
    rows = [[
        _paragraph("Age bucket", styles["table_header"]),
        _paragraph("Invoices", styles["table_header"]),
        _paragraph("Outstanding balance", styles["table_header"]),
    ]]
    for bucket in (values.get("buckets") or {}).values():
        rows.append([
            _paragraph(bucket.get("label") or "Not recorded", styles["body_strong"]),
            Paragraph(escape(_number_text(int(bucket.get("invoice_count") or 0))), styles["body_right"]),
            Paragraph(escape(_money_text(bucket.get("balance") or 0)), styles["body_right"]),
        ])
    rows.append([
        _paragraph("Total receivables", styles["body_strong"]),
        Paragraph(escape(_number_text(int(values.get("total_invoices") or 0))), styles["body_strong_right"]),
        Paragraph(escape(_money_text(values.get("grand_total") or 0)), styles["body_strong_right"]),
    ])
    table = Table(rows, colWidths=[80 * mm, 33 * mm, 65 * mm], repeatRows=1)
    table.setStyle(_standard_table_style(primary) + [
        ("BACKGROUND", (0, -1), (-1, -1), SURFACE_STRONG),
    ])
    return table


def _records_or_bullets(values: list[Any], styles: dict[str, ParagraphStyle], primary: colors.Color) -> list[Any]:
    if values and all(isinstance(item, dict) for item in values):
        return [_records_table(values, styles, primary)]
    bullets: list[Any] = []
    for item in values or ["No retained entries"]:
        bullets.append(Paragraph(f'<font color="#52708F">-</font> {escape(_as_text(item))}', styles["body"]))
        bullets.append(Spacer(1, 1.4 * mm))
    return bullets


def _section_flowables(name: str, value: Any, number: int, styles: dict[str, ParagraphStyle], primary: colors.Color) -> list[Any]:
    """Render one evidence section into the document's own visual language."""
    flowables: list[Any] = [_section_heading(number, name, primary, styles), Spacer(1, 2.6 * mm)]
    normalised = str(name).strip().lower().replace(" ", "_")
    if normalised == "summary" and isinstance(value, dict):
        flowables.append(_metric_grid(value, styles))
        return flowables
    if normalised == "accounts_receivable_aging" and isinstance(value, dict):
        flowables.append(_aging_table(value, styles, primary))
        return flowables
    if isinstance(value, dict):
        scalars = {key: item for key, item in value.items() if not isinstance(item, (dict, list))}
        nested = {key: item for key, item in value.items() if isinstance(item, (dict, list))}
        if scalars:
            flowables.extend([_value_table(scalars, styles, primary), Spacer(1, 3.5 * mm)])
        for key, item in nested.items():
            label = _label(key)
            flowables.extend([_sub_heading(label, styles), Spacer(1, 1.8 * mm)])
            if isinstance(item, dict):
                flowables.append(
                    _distribution_table(item, styles, primary)
                    if _looks_like_distribution(key, item)
                    else _value_table(item, styles, primary)
                )
            else:
                flowables.extend(_records_or_bullets(item, styles, primary))
            flowables.append(Spacer(1, 3.5 * mm))
        return flowables
    if isinstance(value, list):
        return flowables + _records_or_bullets(value, styles, primary)
    flowables.append(_paragraph(value, styles["body"]))
    return flowables


def render_nexus_document_pdf(
    *,
    title: str,
    document_kind: str,
    subtitle: str,
    metadata: Iterable[tuple[str, Any]],
    metric_cards: Iterable[tuple[str, Any]],
    sections: Iterable[tuple[str, Any]],
    branding: dict[str, Any] | None = None,
    footer: str | None = None,
    generated_by: str | None = None,
) -> bytes:
    """Render a premium, printable Nexus report or evidence document.

    The renderer intentionally supports plain data snapshots as well as richer
    QBR content.  Every caller gets the same header, metric cards, section
    bars, table treatment, typography, footer and page numbering.
    """
    branding = branding or {}
    primary = _safe_color(branding.get("primary_color", "#14B8A6"), colors.HexColor("#14B8A6"))
    company_name = _as_text(branding.get("company_name") or "NexusMSP")
    document_theme = branding.get("document_theme", "executive")
    document_density = str(branding.get("document_density") or "standard").lower()
    if document_density not in {"compact", "standard", "spacious"}:
        document_density = "standard"
    density_scale = {"compact": 0.86, "standard": 1, "spacious": 1.14}[document_density]
    branding_logo_path = _branding_logo_path(branding)
    body_width = 178 * mm
    kind_text = _as_text(document_kind).lower()
    # The company name is already drawn on the masthead, so the context line
    # names the document class rather than repeating the vendor name.
    if "procurement" in kind_text or "purchase order" in kind_text:
        header_context = "PROCUREMENT CONTROL"
        footer_context = "retained procurement record"
    elif "invoice" in kind_text or "commercial" in kind_text:
        header_context = "COMMERCIAL RECORD"
        footer_context = "retained commercial record"
    else:
        header_context = "CLIENT EVIDENCE"
        footer_context = "confidential managed service evidence"

    buffer = BytesIO()

    def make_document() -> SimpleDocTemplate:
        # The document is built twice: the first pass counts the pages so the
        # footer can print "Page X of Y" instead of an unbound page number.
        return SimpleDocTemplate(
            buffer,
            pagesize=A4,
            rightMargin=16 * mm,
            leftMargin=16 * mm,
            topMargin=41 * mm,
            bottomMargin=20 * mm,
            title=_as_text(title),
            author=company_name,
        )
    base_styles = getSampleStyleSheet()
    styles = {
        "eyebrow": ParagraphStyle("NexusDocumentEyebrow", parent=base_styles["Normal"], fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=primary, spaceAfter=5),
        "title": ParagraphStyle("NexusDocumentTitle", parent=base_styles["Title"], fontName="Helvetica-Bold", fontSize=(25 if document_theme == "executive" else 22) * density_scale, leading=29 * density_scale, textColor=INK, spaceAfter=5),
        "subtitle": ParagraphStyle("NexusDocumentSubtitle", parent=base_styles["Normal"], fontName="Helvetica", fontSize=10, leading=15, textColor=SLATE),
        "meta_label": ParagraphStyle("NexusDocumentMetaLabel", parent=base_styles["Normal"], fontName="Helvetica-Bold", fontSize=6.4, leading=9, textColor=MUTED),
        "meta_value": ParagraphStyle("NexusDocumentMetaValue", parent=base_styles["Normal"], fontName="Helvetica-Bold", fontSize=8.4, leading=11, textColor=INK),
        "metric_label": ParagraphStyle("NexusDocumentMetricLabel", parent=base_styles["Normal"], fontName="Helvetica-Bold", fontSize=7, leading=9, textColor=MUTED),
        "metric_value": ParagraphStyle("NexusDocumentMetricValue", parent=base_styles["Normal"], fontName="Helvetica-Bold", fontSize=17, leading=20, textColor=INK),
        "metric_value_small": ParagraphStyle("NexusDocumentMetricValueSmall", parent=base_styles["Normal"], fontName="Helvetica-Bold", fontSize=9.5, leading=12.5, textColor=INK),
        "metric_caption": ParagraphStyle("NexusDocumentMetricCaption", parent=base_styles["Normal"], fontName="Helvetica", fontSize=6.6, leading=9, textColor=MUTED, spaceBefore=1.6),
        "section_label": ParagraphStyle("NexusDocumentSectionLabel", parent=base_styles["Normal"], fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=WHITE),
        "sub_heading": ParagraphStyle("NexusDocumentSubHeading", parent=base_styles["Normal"], fontName="Helvetica-Bold", fontSize=7.2, leading=10, textColor=primary),
        "contents": ParagraphStyle("NexusDocumentContents", parent=base_styles["Normal"], fontName="Helvetica", fontSize=7.6, leading=12, textColor=SLATE),
        "body": ParagraphStyle("NexusDocumentBody", parent=base_styles["BodyText"], fontName="Helvetica", fontSize=9, leading=14, textColor=SLATE),
        "body_strong": ParagraphStyle("NexusDocumentBodyStrong", parent=base_styles["BodyText"], fontName="Helvetica-Bold", fontSize=9, leading=14, textColor=INK),
        "body_right": ParagraphStyle("NexusDocumentBodyRight", parent=base_styles["BodyText"], fontName="Helvetica", fontSize=9, leading=14, textColor=SLATE, alignment=TA_RIGHT),
        "body_strong_right": ParagraphStyle("NexusDocumentBodyStrongRight", parent=base_styles["BodyText"], fontName="Helvetica-Bold", fontSize=9, leading=14, textColor=INK, alignment=TA_RIGHT),
        "table_header": ParagraphStyle("NexusDocumentTableHeader", parent=base_styles["BodyText"], fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=WHITE),
        "footer": ParagraphStyle("NexusDocumentFooter", parent=base_styles["Normal"], fontName="Helvetica", fontSize=7.2, leading=10, textColor=SLATE),
    }

    meta_items = [(label, _as_text(value)) for label, value in metadata if value not in (None, "", "Not recorded")]
    if generated_by and not any(str(label).strip().lower() == "prepared by" for label, _ in meta_items):
        # Provenance is part of the document, not only of the delivery email.
        meta_items.append(("Prepared by", _as_text(generated_by)))
    section_list = list(sections)

    def build_story() -> list[Any]:
        # A story is consumed by a build pass, so the two-pass page count needs
        # a freshly assembled story rather than the same flowable list twice.
        story: list[Any] = [
            Paragraph(escape(f"{company_name.upper()}  -  {_as_text(document_kind).upper()}"), styles["eyebrow"]),
            Paragraph(escape(_as_text(title)), styles["title"]),
            Paragraph(escape(_as_text(subtitle)), styles["subtitle"]),
            Spacer(1, 4 * mm),
        ]
        if meta_items:
            story.extend([_document_control(meta_items, styles, primary, body_width), Spacer(1, 5 * mm)])

        cards = list(metric_cards)[:4]
        if cards:
            story.extend([_metric_band(cards, styles, primary, body_width), Spacer(1, 6 * mm)])

        if len(section_list) >= 3:
            story.extend([
                Paragraph("IN THIS DOCUMENT", styles["meta_label"]),
                Spacer(1, 1.6 * mm),
                _contents_strip([name for name, _ in section_list], styles, primary, body_width),
                Spacer(1, 5 * mm),
            ])

        for number, (section_name, section_value) in enumerate(section_list, start=1):
            block = _section_flowables(section_name, section_value, number, styles, primary)
            # Keep a heading with its first block so a section label is never
            # stranded at the bottom of one page while its evidence begins on
            # the next. The remaining flowables stay splittable so a long
            # section can still flow across pages.
            story.append(KeepTogether(block[:2]))
            story.extend(block[2:])

        story.extend([
            Spacer(1, 5 * mm),
            _closing_note(
                footer or branding.get("report_footer_text") or "This document is a retained point-in-time NexusMSP evidence snapshot.",
                styles,
                primary,
                body_width,
            ),
        ])
        return story

    total_pages = {"value": 0}

    def draw_page(canvas, doc):
        canvas.saveState()
        page_width, page_height = A4
        header_height = 34 * mm
        canvas.setFillColor(INK)
        canvas.rect(0, page_height - header_height, page_width, header_height, fill=1, stroke=0)
        canvas.setFillColor(primary)
        canvas.rect(0, page_height - 2.6 * mm, page_width, 2.6 * mm, fill=1, stroke=0)
        canvas.setFillColor(WHITE)
        canvas.setFont("Helvetica-Bold", 11)
        canvas.drawString(16 * mm, page_height - 12 * mm, company_name)
        canvas.setFillColor(colors.HexColor("#BFDBFE"))
        canvas.setFont("Helvetica-Bold", 7)
        canvas.drawString(16 * mm, page_height - 19 * mm, _as_text(document_kind).upper())
        canvas.setFillColor(colors.HexColor("#8FA3BF"))
        canvas.setFont("Helvetica", 6.6)
        canvas.drawString(16 * mm, page_height - 25 * mm, _as_text(subtitle)[:78])
        header_text_right = page_width - 16 * mm
        if branding_logo_path:
            try:
                logo_width = 20 * mm
                canvas.drawImage(
                    branding_logo_path,
                    header_text_right - logo_width,
                    page_height - 27 * mm,
                    width=logo_width,
                    height=16 * mm,
                    preserveAspectRatio=True,
                    anchor="c",
                    mask="auto",
                )
                header_text_right -= logo_width + 5 * mm
            except Exception:
                # A valid web logo can still be an SVG or an unsupported image
                # codec. Keep the document readable rather than failing a PDF.
                pass
        canvas.setFillColor(WHITE)
        canvas.setFont("Helvetica-Bold", 7)
        canvas.drawRightString(header_text_right, page_height - 12 * mm, header_context)
        canvas.setFillColor(colors.HexColor("#8FA3BF"))
        canvas.setFont("Helvetica", 6.6)
        canvas.drawRightString(header_text_right, page_height - 19 * mm, "CONFIDENTIAL")
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.45)
        canvas.line(16 * mm, 13 * mm, page_width - 16 * mm, 13 * mm)
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica", 7)
        canvas.drawString(16 * mm, 8 * mm, f"{company_name} | {footer_context.title()}")
        canvas.drawRightString(page_width - 16 * mm, 8 * mm, f"Page {doc.page} of {total_pages['value'] or doc.page}")
        canvas.restoreState()

    first_pass = make_document()
    first_pass.build(build_story(), onFirstPage=draw_page, onLaterPages=draw_page)
    total_pages["value"] = first_pass.page
    buffer.seek(0)
    buffer.truncate(0)
    final_pass = make_document()
    final_pass.build(build_story(), onFirstPage=draw_page, onLaterPages=draw_page)
    return buffer.getvalue()


def render_nexus_purchase_order_pdf(
    purchase_order: dict[str, Any],
    *,
    branding: dict[str, Any] | None = None,
    generated_by: str | None = None,
    document_profile: dict[str, Any] | None = None,
) -> bytes:
    """Render a procurement document using the Nexus report document language.

    Purchase orders deliberately share the same masthead, hierarchy, evidence
    tables and provenance treatment as reports.  This prevents a customer
    facing commercial document from looking like a separate product.
    """
    po = purchase_order or {}
    profile = document_profile or {}
    line_items = po.get("line_items") or []
    formatted_items: list[dict[str, Any]] = []
    ordered_quantity = 0.0
    received_quantity = 0.0
    for item in line_items:
        quantity = float(item.get("quantity") or 0)
        unit_price = float(item.get("unit_price") or 0)
        received = float(item.get("received_qty") or 0)
        ordered_quantity += quantity
        received_quantity += received
        formatted_items.append({
            "Item": item.get("product_name") or item.get("name") or "Unspecified item",
            "Quantity": f"{quantity:g}",
            "Unit price": f"${unit_price:,.2f}",
            "Received": f"{received:g} / {quantity:g}",
            "Line total": f"${quantity * unit_price:,.2f}",
        })

    status = _as_text(po.get("status") or "draft").replace("_", " ").title()
    po_number = _as_text(po.get("po_number") or po.get("id") or "Draft")
    total = float(po.get("total") or 0)
    delivery = po.get("expected_delivery") or "Not scheduled"
    supplier = {
        "Vendor": po.get("vendor") or "Not recorded",
        "Contact": po.get("vendor_contact") or "Not recorded",
        "Email": po.get("vendor_email") or "Not recorded",
        "Ship to": po.get("ship_to") or "Not recorded",
    }
    financials = {
        "Subtotal": f"${float(po.get('subtotal') or 0):,.2f}",
        "Tax": f"${float(po.get('tax') or 0):,.2f}",
        "Shipping": f"${float(po.get('shipping') or 0):,.2f}",
        "Total commitment": f"${total:,.2f}",
    }
    approval = {
        "Status": status,
        "Approved by": po.get("approved_by_name") or "Awaiting approval",
        "Approved at": _timestamp(po.get("approved_at")),
        "Created": _timestamp(po.get("created_at")),
    }
    sections: list[tuple[str, Any]] = [
        ("Supplier & delivery", supplier),
        ("Ordered items", formatted_items or [{"Item": "No line items recorded"}]),
        ("Financial summary", financials),
        ("Approval & audit", approval),
    ]
    if po.get("notes"):
        sections.append(("Notes", po.get("notes")))
    if profile.get("terms"):
        sections.append(("Terms & conditions", profile.get("terms")))
    for extra_section in profile.get("extra_sections") or []:
        if not isinstance(extra_section, dict):
            continue
        title = _as_text(extra_section.get("title") or "Additional information")
        content = extra_section.get("content")
        if content not in (None, ""):
            sections.append((title, content))

    document_label = _as_text(profile.get("label") or "Purchase Order")
    subtitle_parts = [
        _as_text(profile.get("subtitle") or ""),
        _as_text(po.get("vendor") or "Vendor not recorded"),
        f"Delivery {_as_text(delivery)}",
    ]

    return render_nexus_document_pdf(
        title=f"{document_label} {po_number}",
        document_kind="Procurement record",
        subtitle=" | ".join(part for part in subtitle_parts if part),
        metadata=[
            ("PO", po_number),
            ("Status", status),
            ("Created", _timestamp(po.get("created_at"))),
            ("Expected delivery", delivery),
        ],
        metric_cards=[
            ("Total commitment", f"${total:,.2f}"),
            ("Line items", len(line_items)),
            ("Units received", f"{received_quantity:g} / {ordered_quantity:g}"),
            ("Status", status),
        ],
        sections=sections,
        branding=branding,
        footer=profile.get("footer") or "This purchase order is a retained NexusMSP procurement record. Validate supplier acceptance before fulfilment.",
        generated_by=generated_by,
    )


def render_nexus_invoice_pdf(
    invoice: dict[str, Any],
    *,
    branding: dict[str, Any] | None = None,
    generated_by: str | None = None,
    document_profile: dict[str, Any] | None = None,
) -> bytes:
    """Render invoices in the shared Nexus client-document language.

    Invoices are commercial evidence, not an isolated template family.  They
    retain all of the important financial detail while sharing the same
    masthead, section hierarchy, provenance, footer and accessible tables as
    reports, purchase orders and portal audit records.
    """
    record = invoice or {}
    profile = document_profile or {}

    def as_number(value: Any) -> float:
        try:
            return float(value or 0)
        except (TypeError, ValueError):
            return 0.0

    def money(value: Any) -> str:
        return f"${as_number(value):,.2f}"

    invoice_number = _as_text(record.get("invoice_number") or record.get("id") or "Draft")
    invoice_header = _as_text((branding or {}).get("invoice_header_text") or "").strip()
    total = as_number(record.get("total"))
    paid = as_number(record.get("amount_paid"))
    balance = max(total - paid, 0)
    status = _as_text(record.get("payment_status") or record.get("status") or "issued").replace("_", " ").title()
    items: list[dict[str, Any]] = []
    for item in record.get("line_items") or []:
        quantity = as_number(item.get("quantity") or 1)
        rate = as_number(item.get("unit_price") or item.get("rate"))
        amount = as_number(item.get("total")) or quantity * rate
        items.append({
            "Item": item.get("product_name") or item.get("name") or "Managed service",
            "Description": item.get("description") or "-",
            "Quantity": f"{quantity:g}",
            "Rate": money(rate),
            "Amount": money(amount),
        })

    bill_to = {
        "Organisation": record.get("client_name") or "Not recorded",
        "Email": record.get("client_email") or "Not recorded",
        "Billing contact": record.get("billing_contact") or "Not recorded",
        "Billing address": record.get("billing_address") or record.get("client_address") or "Not recorded",
    }
    financials = {
        "Subtotal": money(record.get("subtotal") or total),
        "Discount": money(record.get("discount")) if as_number(record.get("discount")) else "None",
        "Tax": money(record.get("tax") or record.get("tax_amount")),
        "Amount paid": money(paid),
        "Balance due": money(balance),
        "Payment status": status,
    }
    sections: list[tuple[str, Any]] = [
        ("Bill to", bill_to),
        ("Invoice items", items or [{"Item": "No line items recorded", "Description": "-", "Quantity": "-", "Rate": "-", "Amount": money(total)}]),
        ("Financial summary", financials),
    ]
    payments = record.get("payments") or []
    if payments:
        sections.append(("Payment history", [{
            "Date": payment.get("date") or payment.get("created_at") or "Not recorded",
            "Method": _as_text(payment.get("method") or "Payment").replace("_", " ").title(),
            "Reference": payment.get("reference") or payment.get("session_id") or "-",
            "Amount": money(payment.get("amount")),
        } for payment in payments]))
    if record.get("notes"):
        sections.append(("Notes", record.get("notes")))
    if profile.get("terms"):
        sections.append(("Terms & conditions", profile.get("terms")))
    for extra_section in profile.get("extra_sections") or []:
        if not isinstance(extra_section, dict):
            continue
        title = _as_text(extra_section.get("title") or "Additional information")
        content = extra_section.get("content")
        if content not in (None, ""):
            sections.append((title, content))

    document_label = _as_text(profile.get("label") or "Tax Invoice")
    profile_subtitle = _as_text(profile.get("subtitle") or "").strip()

    return render_nexus_document_pdf(
        title=f"{document_label} {invoice_number}",
        document_kind="Tax invoice",
        subtitle=" | ".join(part for part in [profile_subtitle, invoice_header, _as_text(record.get("client_name") or "Client account"), status] if part),
        metadata=[
            ("Invoice", invoice_number),
            ("Issued", record.get("issued_date") or record.get("created_at")),
            ("Due", record.get("due_date")),
            ("Status", status),
        ],
        metric_cards=[
            ("Invoice total", money(total)),
            ("Balance due", money(balance)),
            ("Amount paid", money(paid)),
            ("Status", status),
        ],
        sections=sections,
        branding=branding,
        footer=profile.get("footer") or (branding or {}).get("invoice_footer_text") or "This invoice is a retained NexusMSP commercial record. Please quote the invoice number with any enquiry.",
        generated_by=generated_by,
    )


def render_nexus_estimate_pdf(
    estimate: dict[str, Any],
    *,
    branding: dict[str, Any] | None = None,
    generated_by: str | None = None,
) -> bytes:
    """Render quotes and estimates through the shared Nexus document system."""
    record = estimate or {}

    def as_number(value: Any) -> float:
        try:
            return float(value or 0)
        except (TypeError, ValueError):
            return 0.0

    def money(value: Any) -> str:
        return f"${as_number(value):,.2f}"

    estimate_number = _as_text(record.get("estimate_number") or record.get("id") or "Draft")
    subtotal = as_number(record.get("subtotal") or record.get("sub_total"))
    tax = as_number(record.get("tax_amount") or record.get("tax"))
    total = as_number(record.get("total"))
    status = _as_text(record.get("status") or "draft").replace("_", " ").title()
    items: list[dict[str, Any]] = []
    for item in record.get("line_items") or []:
        quantity = as_number(item.get("quantity") or 1)
        rate = as_number(item.get("unit_price") or item.get("rate"))
        amount = as_number(item.get("total")) or quantity * rate
        items.append({
            "Item": item.get("product_name") or item.get("name") or "Proposed service",
            "Description": item.get("description") or "-",
            "Quantity": f"{quantity:g}",
            "Rate": money(rate),
            "Amount": money(amount),
        })

    prepared_for = {
        "Organisation": record.get("client_name") or "Not recorded",
        "Email": record.get("client_email") or "Not recorded",
        "Contact": record.get("client_contact") or record.get("billing_contact") or "Not recorded",
        "Address": record.get("client_address") or record.get("billing_address") or "Not recorded",
    }
    pricing = {
        "Subtotal": money(subtotal),
        "Discount": money(record.get("discount")) if as_number(record.get("discount")) else "None",
        "Tax": money(tax),
        "Proposed total": money(total),
        "Status": status,
    }
    sections: list[tuple[str, Any]] = [("Prepared for", prepared_for)]
    if record.get("description"):
        sections.append(("Proposal overview", record.get("description")))
    sections.extend([
        ("Proposed items", items or [{"Item": "No proposed line items", "Description": "-", "Quantity": "-", "Rate": "-", "Amount": money(total)}]),
        ("Pricing summary", pricing),
    ])
    if record.get("notes"):
        sections.append(("Notes", record.get("notes")))
    if record.get("terms"):
        sections.append(("Terms & conditions", record.get("terms")))

    return render_nexus_document_pdf(
        title=record.get("title") or f"Estimate {estimate_number}",
        document_kind="Service estimate",
        subtitle=f"{_as_text(record.get('client_name') or 'Client proposal')} | Valid until {_as_text(record.get('valid_until') or 'Not specified')}",
        metadata=[
            ("Estimate", estimate_number),
            ("Prepared", record.get("created_at")),
            ("Valid until", record.get("valid_until")),
            ("Status", status),
        ],
        metric_cards=[
            ("Proposed total", money(total)),
            ("Tax", money(tax)),
            ("Line items", len(items)),
            ("Status", status),
        ],
        sections=sections,
        branding=branding,
        footer=(branding or {}).get("invoice_footer_text") or "This estimate is a retained NexusMSP proposal and is not a tax invoice.",
        generated_by=generated_by,
    )
