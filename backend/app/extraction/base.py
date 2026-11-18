from dataclasses import dataclass, field
from typing import Any, Protocol


class ExtractionError(Exception):
    """Permanent failure: retrying will not help (bad input, invalid response)."""

    def __init__(self, message: str, user_message: str = "Extraction failed."):
        super().__init__(message)
        self.user_message = user_message


class TransientExtractionError(ExtractionError):
    """Temporary failure (rate limit, 5xx, timeout): safe to retry with backoff."""


@dataclass
class ExtractionResult:
    fields: dict[str, dict[str, Any]]  # key -> {"value": ..., "confidence": float}
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    tokens_estimated: bool = False
    notes: list[str] = field(default_factory=list)


class Extractor(Protocol):
    name: str
    model: str

    def extract(self, content: bytes, mime_type: str, fields: list[dict]) -> ExtractionResult: ...
