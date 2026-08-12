"""Shared, branded PDF rendering for NexusMSP client-facing evidence documents.

The reports hub and the QBR workflow both use this module.  Keeping the
document system in one place prevents individual workflows from slowly
drifting back to generic report layouts.
"""

from __future__ import annotations

from datetime import datetime
from io import BytesIO
from typing import Any, Iterable
from xml.sax.saxutils import escape

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
            f"{str(key).replace('_', ' ').title()}: {_as_text(item)}"
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


def _section_title(title: str, primary: colors.Color, styles: dict[str, ParagraphStyle]) -> Table:
    label = Paragraph(escape(_as_text(title).upper()), styles["section_label"])
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


def _key_value_table(values: dict[str, Any], styles: dict[str, ParagraphStyle], primary: colors.Color) -> Table:
    rows = [[_paragraph("Measure", styles["table_header"]), _paragraph("Evidence", styles["table_header"])]]
    for key, value in values.items():
        label = str(key).replace("_", " ").title()
        rows.append([_paragraph(label, styles["body_strong"]), _paragraph(value, styles["body"])])
    table = Table(rows, colWidths=[57 * mm, 121 * mm], repeatRows=1)
    table.setStyle(_standard_table_style(primary))
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
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]


def _list_table(values: list[dict[str, Any]], styles: dict[str, ParagraphStyle], primary: colors.Color) -> Table:
    keys: list[str] = []
    for row in values:
        for key in row:
            if key not in keys:
                keys.append(key)
            if len(keys) == 5:
                break
        if len(keys) == 5:
            break
    if not keys:
        return _key_value_table({"Evidence": "No retained entries"}, styles, primary)

    headers = [_paragraph(str(key).replace("_", " ").title(), styles["table_header"]) for key in keys]
    rows = [headers]
    for row in values:
        rows.append([_paragraph(row.get(key), styles["body"]) for key in keys])
    width = 178 * mm / len(keys)
    table = Table(rows, colWidths=[width] * len(keys), repeatRows=1)
    table.setStyle(_standard_table_style(primary))
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
            _paragraph(bucket.get("invoice_count") or 0, styles["body"]),
            _paragraph(f"${float(bucket.get('balance') or 0):,.2f}", styles["body"]),
        ])
    rows.append([
        _paragraph("Total receivables", styles["body_strong"]),
        _paragraph(values.get("total_invoices") or 0, styles["body_strong"]),
        _paragraph(f"${float(values.get('grand_total') or 0):,.2f}", styles["body_strong"]),
    ])
    table = Table(rows, colWidths=[80 * mm, 33 * mm, 65 * mm], repeatRows=1)
    table.setStyle(_standard_table_style(primary) + [
        ("BACKGROUND", (0, -1), (-1, -1), SURFACE_STRONG),
    ])
    return table


def _flowable_for_section(name: str, value: Any, styles: dict[str, ParagraphStyle], primary: colors.Color):
    if name == "accounts_receivable_aging" and isinstance(value, dict):
        return _aging_table(value, styles, primary)
    if isinstance(value, dict):
        return _key_value_table(value, styles, primary)
    if isinstance(value, list):
        if value and all(isinstance(item, dict) for item in value):
            return _list_table(value, styles, primary)
        bullets = []
        for item in value or ["No retained entries"]:
            bullets.append(Paragraph(f'<font color="#52708F">-</font> {escape(_as_text(item))}', styles["body"]))
            bullets.append(Spacer(1, 1.4 * mm))
        return bullets
    return _paragraph(value, styles["body"])


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
    body_width = 178 * mm

    buffer = BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=16 * mm,
        leftMargin=16 * mm,
        topMargin=43 * mm,
        bottomMargin=20 * mm,
        title=_as_text(title),
        author=company_name,
    )
    base_styles = getSampleStyleSheet()
    styles = {
        "eyebrow": ParagraphStyle("NexusDocumentEyebrow", parent=base_styles["Normal"], fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=primary, spaceAfter=5),
        "title": ParagraphStyle("NexusDocumentTitle", parent=base_styles["Title"], fontName="Helvetica-Bold", fontSize=25 if document_theme == "executive" else 22, leading=29, textColor=INK, spaceAfter=5),
        "subtitle": ParagraphStyle("NexusDocumentSubtitle", parent=base_styles["Normal"], fontName="Helvetica", fontSize=10, leading=15, textColor=SLATE),
        "meta": ParagraphStyle("NexusDocumentMeta", parent=base_styles["Normal"], fontName="Helvetica-Bold", fontSize=7.3, leading=10, textColor=SLATE),
        "metric_label": ParagraphStyle("NexusDocumentMetricLabel", parent=base_styles["Normal"], fontName="Helvetica-Bold", fontSize=7, leading=9, textColor=MUTED),
        "metric_value": ParagraphStyle("NexusDocumentMetricValue", parent=base_styles["Normal"], fontName="Helvetica-Bold", fontSize=17, leading=20, textColor=INK),
        "section_label": ParagraphStyle("NexusDocumentSectionLabel", parent=base_styles["Normal"], fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=WHITE),
        "body": ParagraphStyle("NexusDocumentBody", parent=base_styles["BodyText"], fontName="Helvetica", fontSize=9, leading=14, textColor=SLATE),
        "body_strong": ParagraphStyle("NexusDocumentBodyStrong", parent=base_styles["BodyText"], fontName="Helvetica-Bold", fontSize=9, leading=14, textColor=INK),
        "table_header": ParagraphStyle("NexusDocumentTableHeader", parent=base_styles["BodyText"], fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=WHITE),
        "footer": ParagraphStyle("NexusDocumentFooter", parent=base_styles["Normal"], fontName="Helvetica", fontSize=7, leading=9, textColor=MUTED, alignment=TA_RIGHT),
    }

    meta_items = [(label, _as_text(value)) for label, value in metadata if value not in (None, "")]
    meta_text = "  |  ".join(f"{_as_text(label).upper()}: {value}" for label, value in meta_items)
    story = [
        Paragraph(escape(f"{company_name.upper()} | {document_kind.upper()}"), styles["eyebrow"]),
        Paragraph(escape(_as_text(title)), styles["title"]),
        Paragraph(escape(_as_text(subtitle)), styles["subtitle"]),
        Spacer(1, 3.5 * mm),
    ]
    if meta_text:
        meta_table = Table([[Paragraph(escape(meta_text), styles["meta"])]], colWidths=[body_width])
        meta_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), SURFACE),
            ("LINEBEFORE", (0, 0), (0, -1), 2.5, primary),
            ("BOX", (0, 0), (-1, -1), 0.35, LINE),
            ("LEFTPADDING", (0, 0), (-1, -1), 9),
            ("RIGHTPADDING", (0, 0), (-1, -1), 9),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ]))
        story.extend([meta_table, Spacer(1, 5 * mm)])

    cards = list(metric_cards)[:4]
    if cards:
        cells = []
        for label, value in cards:
            cells.append([
                Paragraph(escape(_as_text(label).upper()), styles["metric_label"]),
                Paragraph(escape(_as_text(value)), styles["metric_value"]),
            ])
        metric_table = Table([cells], colWidths=[body_width / len(cells)])
        metric_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), WHITE),
            ("BOX", (0, 0), (-1, -1), 0.65, LINE),
            ("INNERGRID", (0, 0), (-1, -1), 0.65, LINE),
            ("LINEABOVE", (0, 0), (-1, 0), 2.5, primary),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 9),
            ("RIGHTPADDING", (0, 0), (-1, -1), 9),
            ("TOPPADDING", (0, 0), (-1, -1), 9),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
        ]))
        story.extend([metric_table, Spacer(1, 6 * mm)])

    for section_name, section_value in sections:
        section_flowables = [_section_title(section_name, primary, styles), Spacer(1, 2.5 * mm)]
        content = _flowable_for_section(section_name.lower().replace(" ", "_"), section_value, styles, primary)
        if isinstance(content, list):
            section_flowables.extend(content)
        else:
            section_flowables.append(content)
        section_flowables.append(Spacer(1, 5 * mm))
        # Keep short sections together so a section label is never stranded at
        # the bottom of one page while its evidence begins on the next.
        story.append(KeepTogether(section_flowables))

    story.extend([
        Spacer(1, 3 * mm),
        Paragraph(escape(_as_text(footer or branding.get("report_footer_text") or "This document is a retained point-in-time NexusMSP evidence snapshot.")), styles["footer"]),
    ])

    def draw_page(canvas, doc):
        canvas.saveState()
        page_width, page_height = A4
        header_height = 37 * mm
        canvas.setFillColor(INK)
        canvas.rect(0, page_height - header_height, page_width, header_height, fill=1, stroke=0)
        canvas.setFillColor(primary)
        canvas.rect(0, page_height - header_height, page_width, 3 * mm, fill=1, stroke=0)
        canvas.setFillColor(WHITE)
        canvas.setFont("Helvetica-Bold", 10)
        canvas.drawString(16 * mm, page_height - 13 * mm, company_name)
        canvas.setFillColor(colors.HexColor("#BFDBFE"))
        canvas.setFont("Helvetica-Bold", 7)
        canvas.drawString(16 * mm, page_height - 20 * mm, _as_text(document_kind).upper())
        canvas.setFillColor(WHITE)
        canvas.setFont("Helvetica", 7)
        canvas.drawRightString(page_width - 16 * mm, page_height - 13 * mm, "NEXUSMSP CLIENT EVIDENCE")
        canvas.setFillColor(colors.HexColor("#BFDBFE"))
        canvas.drawRightString(page_width - 16 * mm, page_height - 20 * mm, f"PAGE {doc.page}")
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.45)
        canvas.line(16 * mm, 13 * mm, page_width - 16 * mm, 13 * mm)
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica", 7)
        canvas.drawString(16 * mm, 8 * mm, f"{company_name} | Confidential managed service evidence")
        actor = _as_text(generated_by) if generated_by else "NexusMSP"
        canvas.drawRightString(
            page_width - 16 * mm,
            8 * mm,
            f"Generated by {actor} | {_timestamp(datetime.utcnow().isoformat())}",
        )
        canvas.restoreState()

    document.build(story, onFirstPage=draw_page, onLaterPages=draw_page)
    return buffer.getvalue()


def render_nexus_purchase_order_pdf(
    purchase_order: dict[str, Any],
    *,
    branding: dict[str, Any] | None = None,
    generated_by: str | None = None,
) -> bytes:
    """Render a procurement document using the Nexus report document language.

    Purchase orders deliberately share the same masthead, hierarchy, evidence
    tables and provenance treatment as reports.  This prevents a customer
    facing commercial document from looking like a separate product.
    """
    po = purchase_order or {}
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

    return render_nexus_document_pdf(
        title=f"Purchase Order {po_number}",
        document_kind="Procurement record",
        subtitle=f"{_as_text(po.get('vendor') or 'Vendor not recorded')} | Delivery { _as_text(delivery) }",
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
        footer="This purchase order is a retained NexusMSP procurement record. Validate supplier acceptance before fulfilment.",
        generated_by=generated_by,
    )
