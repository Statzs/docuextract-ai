"""Standard (non-AI) extraction: reads the document text and matches labelled values.

Deterministic and honest: a field gets a value only if a label for it appears in the text
next to a value of the right type. Nothing is guessed; unmatched fields stay empty.
"""

import re

from app.extraction.base import ExtractionError, ExtractionResult
from app.extraction.normalize import normalize_fields, parse_date, parse_number
from app.extraction.text import read_text

# Extra labels per field key, on top of the field's own label and key. Lowercase.
SYNONYMS: dict[str, list[str]] = {
    "invoice_number": ["invoice no", "invoice #", "invoice num", "inv no", "inv #", "factura no"],
    "vendor_name": ["vendor", "supplier", "seller", "billed by", "from", "proveedor"],
    "issue_date": ["invoice date", "date of issue", "issued", "date", "fecha"],
    "due_date": ["payment due", "due", "fecha de vencimiento"],
    "subtotal": ["sub total", "sub-total", "net amount", "net total"],
    "tax": ["vat", "iva", "sales tax", "gst", "tax amount"],
    "total": [
        "total due",
        "amount due",
        "grand total",
        "balance due",
        "total amount",
        "amount paid",
        "total",
        "importe total",
    ],
    "currency": ["currency", "moneda"],
    "merchant": ["store", "seller", "shop", "comercio"],
    "date": ["transaction date", "purchase date", "fecha"],
    "payment_method": ["paid with", "payment type", "tender", "card", "forma de pago"],
    "tip_included": ["tip", "gratuity", "service charge"],
    "contract_title": ["title", "agreement", "contract"],
    "party_one": ["landlord", "lessor", "seller", "provider", "employer", "client", "party a"],
    "party_two": ["tenant", "lessee", "buyer", "contractor", "employee", "customer", "party b"],
    "effective_date": ["start date", "commencement date", "effective", "dated"],
    "end_date": ["expiration date", "expiry date", "termination date", "end"],
    "contract_value": ["monthly rent", "rent", "contract value", "fee", "price", "amount"],
    "governing_law": ["governing law", "jurisdiction"],
    "po_number": ["po number", "po no", "po #", "p.o. number", "p.o. no", "order number"],
    "buyer": ["bill to", "ordered by", "customer", "purchaser"],
    "supplier": ["vendor", "seller", "ship from"],
    "order_date": ["po date", "date"],
    "delivery_date": ["deliver by", "ship date", "delivery"],
    "payer": ["paid by", "from", "sender", "remitter"],
    "payee": ["paid to", "to", "beneficiary", "recipient"],
    "payment_date": ["date paid", "transaction date", "value date", "date"],
    "amount": ["amount paid", "total paid", "payment amount", "total"],
    "reference": ["transaction id", "reference no", "ref", "confirmation number", "receipt no"],
    "title": ["subject", "re"],
    "document_date": ["date"],
    "issuer": ["from", "issued by", "sender"],
    "recipient": ["to", "addressed to", "attention", "attn"],
    "reference_number": ["reference", "ref", "number", "no"],
    "total_amount": ["total", "amount", "amount due"],
}
ISO_CURRENCIES = {"USD", "EUR", "GBP", "MXN", "CAD", "AUD", "JPY", "CHF", "BRL", "ARS", "COP"}
DATE_RE = re.compile(
    r"\d{4}-\d{1,2}-\d{1,2}"
    r"|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}"
    r"|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}"
    r"|\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+\d{4}"
)
NUMBER_RE = re.compile(r"-?\d[\d.,]*\d|\d")
SEGMENT_SPLIT = re.compile(r"\s{3,}|\t|\s\|\s")
BOOL_RE = re.compile(r"\b(yes|no|true|false|s[ií]|included|not included)\b", re.I)
CONFIDENCE = {"separator": 0.85, "same_line": 0.7, "next_line": 0.55}


def aliases(field: dict) -> list[str]:
    names = [
        field["label"].lower(),
        field["key"].replace("_", " "),
        *SYNONYMS.get(field["key"], []),
    ]
    # Longest first, so "invoice number" wins over "invoice" on the same line.
    return sorted(dict.fromkeys(n.strip() for n in names if n.strip()), key=len, reverse=True)


def typed_value(raw: str, field: dict) -> str | None:
    """The part of `raw` that fits the field type, or None if nothing fits."""
    raw = raw.strip(" .:#-–\t")
    kind = field["type"]
    if not raw:
        return None
    if kind == "date":
        m = DATE_RE.search(raw)
        return m.group(0) if m and parse_date(m.group(0)) else None
    if kind in ("number", "currency"):
        nums = [n for n in NUMBER_RE.findall(raw) if parse_number(n) is not None]
        if not nums:
            return None
        # Amounts are usually last ("Tax 8% 284.00"); counts are usually first.
        return nums[-1] if kind == "currency" else nums[0]
    if kind == "boolean":
        m = BOOL_RE.search(raw)
        if not m:
            return None
        word = m.group(1).lower()
        return "no" if word == "not included" else "yes" if word == "included" else word
    if field["key"] == "currency":
        m = re.search(r"\b[A-Z]{3}\b", raw)
        return m.group(0) if m and m.group(0) in ISO_CURRENCIES else None
    return raw[:200]


def _label_re(alias: str) -> re.Pattern:
    body = r"\s+".join(re.escape(w) for w in alias.split())
    # The alias must start the segment; an optional "(...)" qualifier may follow it.
    return re.compile(rf"^[\W_]*{body}(?![\w])\s*(?:\([^)]*\))?\s*([:#=.]|-\s)?\s*(.*)$", re.I)


def match_fields(text: str, fields: list[dict], scale: float = 1.0) -> dict[str, dict]:
    lines = [ln.strip() for ln in text.splitlines()]
    rows = [[s.strip() for s in SEGMENT_SPLIT.split(ln) if s.strip()] for ln in lines]
    out: dict[str, dict] = {}
    for f in fields:
        found = _find(f, rows)
        if found is None and f["key"] == "currency":
            codes = [c for c in re.findall(r"\b[A-Z]{3}\b", text) if c in ISO_CURRENCIES]
            found = (codes[0], 0.5) if codes else None
        value, conf = found if found else (None, 0.0)
        out[f["key"]] = {"value": value, "confidence": round(conf * scale, 2)}
    return out


def _find(field: dict, rows: list[list[str]]) -> tuple[str, float] | None:
    patterns = [_label_re(a) for a in aliases(field)]
    candidates: list[tuple[float, int, str]] = []  # (confidence, order, value)
    order = 0
    for r, segments in enumerate(rows):
        for s, segment in enumerate(segments):
            for pat in patterns:
                m = pat.match(segment)
                if not m:
                    continue
                order += 1
                sep, rest = m.group(1), m.group(2)
                value = typed_value(rest, field) if rest else None
                if value is not None and (sep or field["type"] != "string"):
                    # Free text needs "Label: value"; "From the start..." is prose, not a field.
                    kind = "separator" if sep else "same_line"
                    candidates.append((CONFIDENCE[kind], -order, value))
                elif not rest and s + 1 < len(segments):  # "Total      3,834.00"
                    value = typed_value(segments[s + 1], field)
                    if value is not None:
                        candidates.append((CONFIDENCE["same_line"], -order, value))
                elif not rest and (field["type"] != "string" or sep):
                    # "Total\n3,834.00": only for typed values, or "Vendor:\nAcme" with a colon.
                    nxt = next((x for x in rows[r + 1 : r + 2] if x), None)
                    value = typed_value(nxt[0], field) if nxt else None
                    if value is not None:
                        candidates.append((CONFIDENCE["next_line"], -order, value))
                break  # the longest matching alias decides for this segment
    if not candidates:
        return None
    conf, _, value = max(candidates)  # strongest evidence first, then earliest in the text
    return value, conf


class StandardExtractor:
    """PDF text layer or OCR, then label matching. Never sends data outside this server."""

    name = "text"
    model = "rules-v2"

    def __init__(self, ocr_max_pages: int = 5):
        self.ocr_max_pages = ocr_max_pages

    def extract(self, content: bytes, mime_type: str, fields: list[dict]) -> ExtractionResult:
        doc = read_text(content, mime_type, self.ocr_max_pages)
        if not doc.text.strip():
            hint = " ".join(doc.notes) or "Try a clearer scan or a PDF with selectable text."
            raise ExtractionError(
                "no readable text", f"We couldn't find readable text in this document. {hint}"
            )
        scale = 0.85 if doc.method == "ocr" else 1.0  # OCR misreads characters more often
        result = normalize_fields(match_fields(doc.text, fields, scale), fields)
        return ExtractionResult(
            fields=result,
            model="tesseract+rules" if doc.method == "ocr" else "pdf-text+rules",
            provider=doc.method,
            notes=doc.notes,
        )
