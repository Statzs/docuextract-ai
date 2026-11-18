"""Gemini-backed extractor using structured (JSON schema constrained) output."""

import json

from google import genai
from google.genai import errors as genai_errors
from google.genai import types

from app.extraction.base import ExtractionError, ExtractionResult, TransientExtractionError
from app.extraction.normalize import normalize_fields

GEMINI_TYPES = {
    "string": "STRING",
    "number": "NUMBER",
    "currency": "NUMBER",
    "date": "STRING",
    "boolean": "BOOLEAN",
}
TYPE_HINTS = {
    "date": "Return as YYYY-MM-DD.",
    "currency": "Return the numeric amount only, without currency symbols.",
    "number": "Return a plain number.",
}
RETRYABLE_STATUS = {408, 429, 500, 502, 503, 504}


def build_response_schema(fields: list[dict]) -> dict:
    props = {}
    for f in fields:
        props[f["key"]] = {
            "type": "OBJECT",
            "properties": {
                "value": {"type": GEMINI_TYPES[f["type"]], "nullable": True},
                "confidence": {"type": "NUMBER"},
            },
            "required": ["value", "confidence"],
        }
    return {"type": "OBJECT", "properties": props, "required": [f["key"] for f in fields]}


def build_prompt(fields: list[dict]) -> str:
    lines = [
        "You extract structured data from the attached document.",
        "For every field return the exact value found in the document and a confidence",
        "between 0 and 1. If a field is not present, return value null and confidence 0.",
        "Never invent values. Fields:",
    ]
    for f in fields:
        hint = " ".join(filter(None, [f.get("description", ""), TYPE_HINTS.get(f["type"], "")]))
        lines.append(f"- {f['key']} ({f['label']}, {f['type']}): {hint}".rstrip(": "))
    return "\n".join(lines)


class GeminiExtractor:
    name = "gemini"

    def __init__(self, api_key: str, model: str, timeout_seconds: int = 60, client=None):
        self.model = model
        self.client = client or genai.Client(
            api_key=api_key, http_options=types.HttpOptions(timeout=timeout_seconds * 1000)
        )

    def extract(self, content: bytes, mime_type: str, fields: list[dict]) -> ExtractionResult:
        try:
            resp = self.client.models.generate_content(
                model=self.model,
                contents=[
                    types.Part.from_bytes(data=content, mime_type=mime_type),
                    build_prompt(fields),
                ],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=build_response_schema(fields),
                    temperature=0,
                ),
            )
        except genai_errors.APIError as e:
            if e.code in RETRYABLE_STATUS:
                raise TransientExtractionError(
                    f"gemini {e.code}: {e.message}", "The AI provider is busy. Retrying."
                ) from e
            raise ExtractionError(
                f"gemini {e.code}: {e.message}", "The AI provider rejected the request."
            ) from e
        except (TimeoutError, ConnectionError) as e:
            raise TransientExtractionError(f"gemini network: {e}", "AI provider timed out.") from e

        try:
            raw = json.loads(resp.text or "")
            if not isinstance(raw, dict):
                raise ValueError("response is not an object")
        except ValueError as e:
            raise ExtractionError(
                f"invalid JSON from gemini: {e}", "The AI returned an unreadable response."
            ) from e

        usage = resp.usage_metadata
        return ExtractionResult(
            fields=normalize_fields(raw, fields),
            model=self.model,
            input_tokens=(usage.prompt_token_count or 0) if usage else 0,
            output_tokens=(usage.candidates_token_count or 0) if usage else 0,
        )
