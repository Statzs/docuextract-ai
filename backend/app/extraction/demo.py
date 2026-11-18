"""Offline extractor used when no Gemini key is configured.

It is deliberately simple and honest: it reads the PDF text layer and matches
"Label: value" lines against the schema's field labels/keys. It is not AI; it
exists so the whole product (upload -> review -> export -> usage) can be
exercised without any private key.
"""

import io
import json
import re

from pypdf import PdfReader

from app.extraction.base import ExtractionError, ExtractionResult
from app.extraction.normalize import normalize_fields


def pdf_text(content: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(content))
        return "\n".join((page.extract_text() or "") for page in reader.pages)
    except Exception as e:  # pypdf raises a wide variety of errors on malformed files
        raise ExtractionError(f"pdf text extraction failed: {e}", "Could not read the PDF.") from e


def _aliases(field: dict) -> list[str]:
    return list(dict.fromkeys([field["label"], field["key"].replace("_", " ")]))


class DemoExtractor:
    name = "demo"
    model = "demo-text-matcher"

    def extract(self, content: bytes, mime_type: str, fields: list[dict]) -> ExtractionResult:
        notes: list[str] = []
        text = pdf_text(content) if mime_type == "application/pdf" else ""
        if mime_type != "application/pdf":
            notes.append("Demo mode cannot read images (no OCR). Configure GEMINI_API_KEY.")
        elif not text.strip():
            notes.append("This PDF has no text layer. Demo mode needs Gemini for scanned files.")

        raw: dict[str, dict] = {}
        for f in fields:
            pattern = "|".join(re.escape(a) for a in _aliases(f))
            m = re.search(rf"^\s*(?:{pattern})\s*:\s*(.+?)\s*$", text, re.I | re.M)
            raw[f["key"]] = {"value": m.group(1) if m else None, "confidence": 0.9 if m else 0}

        result = normalize_fields(raw, fields)
        return ExtractionResult(
            fields=result,
            model=self.model,
            input_tokens=max(1, len(text) // 4),  # rough chars-per-token estimate
            output_tokens=max(1, len(json.dumps(result)) // 4),
            tokens_estimated=True,
            notes=notes,
        )
