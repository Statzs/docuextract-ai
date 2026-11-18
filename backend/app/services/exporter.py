import csv
import io
import json
from typing import Any

from openpyxl import Workbook

from app.models import Document

FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def final_values(doc: Document) -> dict[str, Any]:
    """Human-reviewed values win over raw AI output."""
    extracted = {k: v.get("value") for k, v in (doc.extracted_data or {}).items()}
    return {**extracted, **(doc.reviewed_data or {})}


def build_rows(docs: list[Document]) -> tuple[list[str], list[dict[str, Any]]]:
    keys: list[str] = []
    for d in docs:
        for f in d.schema_snapshot:
            if f["key"] not in keys:
                keys.append(f["key"])
    header = ["document_id", "filename", "schema", "status", "validated_at", *keys]
    rows = []
    for d in docs:
        values = final_values(d)
        rows.append(
            {
                "document_id": d.id,
                "filename": d.filename,
                "schema": d.schema_name,
                "status": d.status,
                "validated_at": d.validated_at.isoformat() if d.validated_at else None,
                **{k: values.get(k) for k in keys},
            }
        )
    return header, rows


def _safe_cell(v: Any) -> Any:
    # Prevent CSV/formula injection when the file is opened in a spreadsheet app.
    if isinstance(v, str) and v.startswith(FORMULA_PREFIXES):
        return "'" + v
    return v


def to_csv(docs: list[Document]) -> bytes:
    header, rows = build_rows(docs)
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=header)
    w.writeheader()
    for r in rows:
        w.writerow({k: _safe_cell(v) for k, v in r.items()})
    return ("﻿" + buf.getvalue()).encode()  # BOM so Excel detects UTF-8


def to_xlsx(docs: list[Document]) -> bytes:
    header, rows = build_rows(docs)
    wb = Workbook()
    ws = wb.active
    ws.title = "Extractions"
    ws.append(header)
    for r in rows:
        ws.append([_safe_cell(r[k]) for k in header])
    ws.freeze_panes = "A2"
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def to_json(docs: list[Document]) -> bytes:
    _, rows = build_rows(docs)
    return json.dumps(rows, indent=2, ensure_ascii=False, default=str).encode()
