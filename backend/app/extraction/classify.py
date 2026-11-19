"""Suggests a document type from its text. Only a pre-selection: the user always confirms."""

import re

KEYWORDS: dict[str, list[str]] = {
    "invoice": ["invoice", "factura", "bill to", "invoice number", "due date", "amount due"],
    "receipt": ["receipt", "recibo", "ticket", "cashier", "change", "thank you", "tip"],
    "contract": [
        "agreement",
        "contract",
        "parties",
        "hereby",
        "landlord",
        "tenant",
        "lease",
        "term",
        "contrato",
        "governing law",
    ],
    "purchase_order": ["purchase order", "p.o.", "po number", "ship to", "orden de compra"],
    "payment_record": [
        "payment confirmation",
        "payment received",
        "remittance",
        "transaction id",
        "transfer",
        "amount paid",
        "comprobante",
        "paid to",
    ],
}


def suggest_kind(text: str, filename: str = "") -> str | None:
    haystack = f"{filename.replace('-', ' ').replace('_', ' ')}\n{text}".lower()
    scores = {
        kind: sum(1 for w in words if re.search(rf"(?<!\w){re.escape(w)}(?!\w)", haystack))
        for kind, words in KEYWORDS.items()
    }
    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    best, score = ranked[0]
    # Two clues at least, and a clear winner; otherwise let the user choose.
    if score >= 2 and score > ranked[1][1]:
        return best
    return None
