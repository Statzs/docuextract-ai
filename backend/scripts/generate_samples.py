"""Regenerate the fictional sample PDFs in app/demo/samples (dev-only, uses fpdf2).

uv run python -m scripts.generate_samples

Layout rule that keeps the offline demo extractor working: every `Label: value` pair is
drawn on its own line, with nothing else at the same height.
"""

import re
from pathlib import Path

from fpdf import FPDF

from app.demo.data import SAMPLES

OUT = Path(__file__).resolve().parent.parent / "app" / "demo" / "samples"
INK, MUTED, RULE, ACCENT = (24, 24, 27), (113, 113, 122), (228, 228, 231), (190, 242, 100)
TOTAL_KEYS = {"Subtotal", "Tax", "Total"}
ITEM = re.compile(r"^(.*?\S)\s{2,}(\S+)$")  # "description   amount" (2+ spaces)
LABEL = re.compile(r"^[A-Za-z][A-Za-z ]*:")


def _classify(lines: list[str]):
    header, meta, items, totals, prose = [], [], [], [], []
    in_header = True
    for line in lines:
        if not line:
            in_header = False
            continue
        if LABEL.match(line):
            key, value = (p.strip() for p in line.split(":", 1))
            (totals if key in TOTAL_KEYS else meta).append((key, value))
            in_header = False
        elif m := ITEM.match(line):
            items.append((m[1], m[2]))
        elif in_header and len(line.split()) <= 6:  # long sentences are body text
            header.append(line)
        else:
            prose.append(line)
    return header, meta, items, totals, prose


def render(title: str, lines: list[str], receipt: bool = False) -> bytes:
    header, meta, items, totals, prose = _classify(lines)
    pdf = FPDF(format=(90, 190) if receipt else "A4")
    pdf.set_creator("DocuExtract AI demo generator")
    pdf.set_margins(8 if receipt else 18, 12 if receipt else 18)
    pdf.set_auto_page_break(False)
    pdf.add_page()
    w = pdf.epw

    pdf.set_fill_color(*ACCENT)
    pdf.rect(0, 0, pdf.w, 3, "F")

    # Issuer (left) and document title (right) share the first line; neither is a label.
    pdf.set_text_color(*INK)
    pdf.set_font("Helvetica", "B", 12 if receipt else 15)
    issuer = header[0] if header else ""
    if receipt:
        pdf.cell(w, 7, issuer, align="C", new_x="LMARGIN", new_y="NEXT")
    else:
        pdf.cell(w / 2, 8, issuer)
        pdf.set_font("Helvetica", "B", 20)
        pdf.cell(w / 2, 8, title, align="R", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", size=8.5)
    pdf.set_text_color(*MUTED)
    for line in header[1:]:
        pdf.cell(w, 4.5, line, align="C" if receipt else "L", new_x="LMARGIN", new_y="NEXT")
    if receipt:
        pdf.set_font("Helvetica", "B", 9)
        pdf.cell(w, 6, title, align="C", new_x="LMARGIN", new_y="NEXT")

    def rule(gap=4):
        pdf.ln(gap)
        pdf.set_draw_color(*RULE)
        pdf.line(pdf.l_margin, pdf.get_y(), pdf.l_margin + w, pdf.get_y())
        pdf.ln(gap)

    rule(5)
    for p in prose:
        pdf.set_font("Helvetica", size=9.5)
        pdf.set_text_color(*INK)
        pdf.multi_cell(w, 5, p, new_x="LMARGIN", new_y="NEXT")
        pdf.ln(2)

    label_w = 30 if receipt else 42
    for key, value in meta:
        pdf.set_font("Helvetica", size=8.5 if receipt else 9.5)
        pdf.set_text_color(*MUTED)
        pdf.cell(label_w, 6, f"{key}:")
        pdf.set_font("Helvetica", "B", 8.5 if receipt else 9.5)
        pdf.set_text_color(*INK)
        pdf.cell(w - label_w, 6, value, new_x="LMARGIN", new_y="NEXT")

    if items:
        rule()
        if not receipt:
            pdf.set_font("Helvetica", "B", 8)
            pdf.set_text_color(*MUTED)
            pdf.cell(w - 40, 6, "DESCRIPTION")
            pdf.cell(40, 6, "AMOUNT", align="R", new_x="LMARGIN", new_y="NEXT")
        pdf.set_text_color(*INK)
        for desc, amount in items:
            pdf.set_font("Helvetica", size=8.5 if receipt else 10)
            pdf.cell(w - 30, 7, desc)
            pdf.cell(30, 7, amount, align="R", new_x="LMARGIN", new_y="NEXT")

    if totals:
        rule()
        box_x = pdf.l_margin + (0 if receipt else w * 0.55)
        box_w = w - (box_x - pdf.l_margin)
        for key, value in totals:
            final = key == "Total"
            pdf.set_x(box_x)
            pdf.set_font("Helvetica", "B" if final else "", 11 if final else 9.5)
            pdf.set_text_color(*(INK if final else MUTED))
            pdf.cell(box_w / 2, 7, f"{key}:")
            pdf.set_text_color(*INK)
            pdf.cell(box_w / 2, 7, value, align="R", new_x="LMARGIN", new_y="NEXT")

    if title.startswith("RESIDENTIAL"):
        pdf.ln(18)
        for who in ("Landlord signature", "Tenant signature"):
            pdf.set_draw_color(*MUTED)
            y = pdf.get_y() + 8
            pdf.line(pdf.l_margin, y, pdf.l_margin + 70, y)
            pdf.set_y(y + 1)
            pdf.set_font("Helvetica", size=8)
            pdf.set_text_color(*MUTED)
            pdf.cell(70, 5, who, new_x="LMARGIN", new_y="NEXT")
            pdf.ln(6)

    pdf.set_y(-14 if receipt else -16)
    pdf.set_font("Helvetica", "I", 7)
    pdf.set_text_color(160, 160, 165)
    pdf.cell(w, 5, "Fictional document generated for the DocuExtract AI demo.", align="C")
    return bytes(pdf.output())


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for filename, schema, title, lines, _days, _validate in SAMPLES:
        (OUT / filename).write_bytes(render(title, lines, receipt=schema == "Receipt"))
        print("wrote", filename)
