"""Coerce raw extracted values into the declared field type.

Both providers go through here so the UI and exports always see the same shapes:
number/currency -> float, date -> 'YYYY-MM-DD', boolean -> bool, string -> str.
Values that cannot be coerced are kept as strings with confidence capped, so a
human reviewer sees them instead of silently losing data.
"""

import re
from datetime import datetime
from typing import Any

DATE_FORMATS = [
    "%Y-%m-%d",
    "%d/%m/%Y",
    "%m/%d/%Y",
    "%d-%m-%Y",
    "%d.%m.%Y",
    "%B %d, %Y",
    "%b %d, %Y",
    "%d %B %Y",
    "%d %b %Y",
    "%Y/%m/%d",
]
TRUE = {"true", "yes", "y", "1", "si", "sí", "x"}
FALSE = {"false", "no", "n", "0"}


def parse_number(raw: Any) -> float | None:
    if isinstance(raw, bool):
        return None
    if isinstance(raw, int | float):
        return float(raw)
    s = re.sub(r"[^\d,.\-]", "", str(raw))
    if not re.search(r"\d", s):
        return None
    # "1.234,56" (EU) vs "1,234.56" (US): the last separator is the decimal one.
    if "," in s and "." in s:
        eu = s.rfind(",") > s.rfind(".")
        s = s.replace(".", "").replace(",", ".") if eu else s.replace(",", "")
    elif "," in s:
        head, _, tail = s.rpartition(",")
        s = f"{head.replace(',', '')}.{tail}" if len(tail) in (1, 2) else s.replace(",", "")
    try:
        return float(s)
    except ValueError:
        return None


def parse_date(raw: Any) -> str | None:
    s = str(raw).strip()
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def coerce(value: Any, field_type: str) -> tuple[Any, bool]:
    """Return (value, ok). ok=False means the value did not match the type."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None, True
    if field_type in ("number", "currency"):
        n = parse_number(value)
        return (n, True) if n is not None else (str(value), False)
    if field_type == "date":
        d = parse_date(value)
        return (d, True) if d else (str(value), False)
    if field_type == "boolean":
        if isinstance(value, bool):
            return value, True
        s = str(value).strip().lower()
        if s in TRUE:
            return True, True
        if s in FALSE:
            return False, True
        return str(value), False
    return str(value).strip(), True


def normalize_fields(raw: dict[str, Any], fields: list[dict]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for f in fields:
        item = raw.get(f["key"]) or {}
        if not isinstance(item, dict):
            item = {"value": item, "confidence": 0.5}
        value, ok = coerce(item.get("value"), f["type"])
        try:
            conf = float(item.get("confidence") or 0)
        except (TypeError, ValueError):
            conf = 0.0
        conf = max(0.0, min(1.0, conf))
        if value is None:
            conf = 0.0
        elif not ok:
            conf = min(conf, 0.3)
        out[f["key"]] = {"value": value, "confidence": round(conf, 2)}
    return out
