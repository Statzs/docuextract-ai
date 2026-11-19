"""Accuracy benchmark on generated fictional documents (no real data).

    uv run python -m scripts.benchmark            # standard reading (text layer + OCR)
    uv run python -m scripts.benchmark --gemini   # also Gemini (needs GEMINI_API_KEY; uses quota)

Each document is built from random fictional values in one of several layouts and label
wordings, so the score reflects layouts the rules were not written against. A field counts
as correct only if the normalised value equals the ground truth; empty answers count wrong.
"""

import argparse
import io
import os
import random
from collections import defaultdict

from fpdf import FPDF

from app.demo.data import INVOICE_FIELDS, PAYMENT_FIELDS, PURCHASE_ORDER_FIELDS, RECEIPT_FIELDS
from app.extraction.normalize import coerce
from app.extraction.rules import StandardExtractor
from app.extraction.text import ocr_available

R = random.Random(42)  # noqa: S311 (fake data, reproducible)
COMPANIES = [
    "Alder & Finch",
    "Bluepeak Freight",
    "Corvid Labs",
    "Dunmore Textiles",
    "Elm Row Café",
]
PEOPLE = ["Inés Navarro", "Tomas Reyes", "Priya Natarajan", "Owen Clarke", "Leila Haddad"]
METHODS = ["Visa", "Mastercard", "Cash", "Bank transfer", "PayPal"]

# Several wordings per field: the first is the template label, the rest are what real
# documents print instead. "Bill No.", "Sold by", "Amount payable" and "Credited to" are
# deliberately NOT in the rules' synonym list, to measure how unseen wording is handled.
WORDINGS = {
    "invoice_number": ["Invoice Number", "Invoice No.", "Invoice #", "Bill No."],
    "vendor_name": ["Vendor", "Supplier", "Billed by", "Sold by"],
    "issue_date": ["Issue Date", "Invoice Date", "Date"],
    "due_date": ["Due Date", "Payment due"],
    "total": ["Total", "Amount due", "Total due", "Grand total", "Amount payable"],
    "currency": ["Currency"],
    "merchant": ["Merchant", "Store"],
    "date": ["Date", "Transaction date"],
    "payment_method": ["Payment Method", "Paid with"],
    "po_number": ["PO Number", "P.O. No.", "Order number"],
    "buyer": ["Buyer", "Ordered by"],
    "supplier": ["Supplier", "Vendor"],
    "order_date": ["Order Date", "PO Date"],
    "payer": ["Payer", "Paid by"],
    "payee": ["Payee", "Paid to", "Beneficiary", "Credited to"],
    "payment_date": ["Payment Date", "Date paid", "Value date"],
    "amount": ["Amount", "Amount paid"],
    "reference": ["Reference", "Transaction ID"],
}
DATE_STYLES = ["%Y-%m-%d", "%d/%m/%Y", "%B %d, %Y", "%d.%m.%Y"]


def _money(lo, hi):
    return round(R.uniform(lo, hi), 2)


def _date():
    import datetime as dt

    d = dt.date(2026, 1, 1) + dt.timedelta(days=R.randrange(0, 330))
    return d.isoformat(), d.strftime(R.choice(DATE_STYLES))


def make_case(kind: str):
    """(fields, truth{key: normalised value}, printed{key: text on the page})"""
    truth, printed = {}, {}

    def put(key, value, shown=None):
        truth[key], printed[key] = value, shown if shown is not None else str(value)

    if kind == "invoice":
        fields = INVOICE_FIELDS
        put("invoice_number", f"INV-{R.randrange(1000, 99999)}")
        put("vendor_name", R.choice(COMPANIES))
        iso, shown = _date()
        put("issue_date", iso, shown)
        total = _money(50, 9000)
        put("total", total, f"{total:,.2f}")
        put("currency", R.choice(["USD", "EUR", "GBP"]))
    elif kind == "receipt":
        fields = RECEIPT_FIELDS
        put("merchant", R.choice(COMPANIES))
        iso, shown = _date()
        put("date", iso, shown)
        put("payment_method", R.choice(METHODS))
        total = _money(3, 300)
        put("total", total, f"${total:.2f}")
    elif kind == "purchase_order":
        fields = PURCHASE_ORDER_FIELDS
        put("po_number", f"PO-{R.randrange(100, 9999)}")
        put("buyer", R.choice(COMPANIES))
        put("supplier", R.choice([c for c in COMPANIES if c != truth["buyer"]]))
        iso, shown = _date()
        put("order_date", iso, shown)
        total = _money(100, 20000)
        put("total", total, f"{total:,.2f}")
    else:
        fields = PAYMENT_FIELDS
        put("payer", R.choice(PEOPLE))
        put("payee", R.choice(COMPANIES))
        iso, shown = _date()
        put("payment_date", iso, shown)
        amount = _money(10, 5000)
        put("amount", amount, f"{amount:,.2f}")
        put("reference", f"TX-{R.randrange(10000, 999999)}")
    return fields, truth, printed


def render(kind: str, printed: dict, layout: str) -> bytes:
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 10, kind.replace("_", " ").upper(), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", size=11)
    pdf.cell(0, 6, "Fictional document for accuracy testing.", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)
    for key, value in printed.items():
        label = R.choice(WORDINGS.get(key, [key.replace("_", " ").title()]))
        text = value.encode("latin-1", "replace").decode("latin-1")
        if layout == "colon":
            pdf.cell(0, 7, f"{label}: {text}", new_x="LMARGIN", new_y="NEXT")
        elif layout == "columns":
            pdf.cell(60, 7, label)
            pdf.cell(0, 7, text, new_x="LMARGIN", new_y="NEXT")
        else:  # stacked: label above value
            pdf.set_font("Helvetica", "B", 9)
            pdf.cell(0, 5, f"{label}:", new_x="LMARGIN", new_y="NEXT")
            pdf.set_font("Helvetica", size=11)
            pdf.cell(0, 7, text, new_x="LMARGIN", new_y="NEXT")
    return bytes(pdf.output())


def to_image(pdf: bytes) -> bytes:
    import pypdfium2 as pdfium
    from PIL import ImageFilter

    img = pdfium.PdfDocument(pdf)[0].render(scale=150 / 72).to_pil().convert("L")
    img = img.rotate(R.uniform(-1.2, 1.2), expand=True, fillcolor=240)
    img = img.filter(ImageFilter.GaussianBlur(0.5))
    out = io.BytesIO()
    img.save(out, "PNG")
    return out.getvalue()


def score(result_fields, fields, truth):
    by_key = {f["key"]: f for f in fields}
    ok = 0
    for key, want in truth.items():
        got = result_fields.get(key, {}).get("value")
        want_norm, _ = coerce(want, by_key[key]["type"])
        if isinstance(got, str) and isinstance(want_norm, str):
            ok += got.strip().casefold() == want_norm.strip().casefold()
        else:
            ok += got == want_norm
    return ok, len(truth)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-layout", type=int, default=12)
    ap.add_argument("--gemini", action="store_true")
    args = ap.parse_args()

    extractors = [("standard", StandardExtractor())]
    if args.gemini:
        from app.extraction.gemini import GeminiExtractor

        key = os.environ.get("GEMINI_API_KEY")
        if not key:
            raise SystemExit("Set GEMINI_API_KEY to benchmark Gemini.")
        extractors.append(("gemini", GeminiExtractor(key, "gemini-3.5-flash-lite")))

    layouts = ["colon", "columns", "stacked"] + (["scan"] if ocr_available() else [])
    totals = defaultdict(lambda: [0, 0])
    kinds = ["invoice", "receipt", "purchase_order", "payment_record"]
    for layout in layouts:
        for i in range(args.per_layout):
            kind = kinds[i % len(kinds)]
            fields, truth, printed = make_case(kind)
            pdf = render(kind, printed, "colon" if layout == "scan" else layout)
            content, mime = (
                (to_image(pdf), "image/png") if layout == "scan" else (pdf, "application/pdf")
            )
            for name, ex in extractors:
                try:
                    fields_out = ex.extract(content, mime, fields).fields
                except Exception as e:  # count as all wrong, keep going
                    print(f"  {name} failed on {kind}/{layout}: {e}")
                    fields_out = {}
                ok, n = score(fields_out, fields, truth)
                totals[(name, layout)][0] += ok
                totals[(name, layout)][1] += n

    print(f"\nField accuracy on {args.per_layout} generated documents per layout")
    print(f"{'method':<10}{'layout':<10}{'correct':>10}{'accuracy':>10}")
    for (name, layout), (ok, n) in sorted(totals.items()):
        print(f"{name:<10}{layout:<10}{f'{ok}/{n}':>10}{ok / n:>10.0%}")
    if not ocr_available():
        print("(scan layout skipped: Tesseract is not installed)")


if __name__ == "__main__":
    main()
