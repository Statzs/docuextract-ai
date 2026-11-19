"""Checks AI answers against the document's own text, so a made-up value cannot look certain."""

import re

from app.extraction.normalize import parse_date, parse_number
from app.extraction.rules import DATE_RE, NUMBER_RE

UNVERIFIED_CAP = 0.4


def _norm(s: str) -> str:
    return re.sub(r"[\W_]+", " ", s.casefold()).strip()


def ground_in_text(values: dict[str, dict], text: str, fields: list[dict]) -> int:
    """Lower the confidence of values that do not appear in `text`. Returns how many.

    Only used when the text is a reliable copy of the document (a PDF text layer).
    """
    if len(text.strip()) < 50:
        return 0
    words = f" {_norm(text)} "
    numbers = {parse_number(n) for n in NUMBER_RE.findall(text)}
    dates = {parse_date(d) for d in DATE_RE.findall(text)}
    missing = 0
    for f in fields:
        item = values.get(f["key"])
        if not item or item["value"] is None or f["type"] == "boolean":
            continue
        v = item["value"]
        if f["type"] in ("number", "currency"):
            found = isinstance(v, float) and v in numbers
        elif f["type"] == "date":
            found = v in dates
        else:
            found = f" {_norm(str(v))} " in words
        if not found:
            item["confidence"] = min(item["confidence"], UNVERIFIED_CAP)
            missing += 1
    return missing
