"""Unit tests: pure functions with no HTTP or database."""

import json
from types import SimpleNamespace

import pytest
from google.genai import errors as genai_errors

from app.demo.data import INVOICE_FIELDS
from app.extraction.base import ExtractionError, TransientExtractionError
from app.extraction.gemini import GeminiExtractor, build_response_schema
from app.extraction.normalize import coerce, normalize_fields, parse_date, parse_number
from app.services.files import UploadRejected, sanitize_filename, sniff_mime, validate_upload

FIELDS = [
    {"key": "total", "label": "Total", "type": "currency"},
    {"key": "date", "label": "Date", "type": "date"},
    {"key": "paid", "label": "Paid", "type": "boolean"},
]


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("$1,234.56", 1234.56),
        ("1.234,56 €", 1234.56),
        ("403,28", 403.28),
        ("1,450", 1450.0),
        ("-12.5", -12.5),
        (99, 99.0),
        ("n/a", None),
        (True, None),
    ],
)
def test_parse_number(raw, expected):
    assert parse_number(raw) == expected


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("2026-10-02", "2026-10-02"),
        ("14.10.2026", "2026-10-14"),
        ("November 3, 2026", "2026-11-03"),
        ("11/14/2026", "2026-11-14"),
        ("someday", None),
    ],
)
def test_parse_date(raw, expected):
    assert parse_date(raw) == expected


def test_coerce_reports_type_mismatch():
    assert coerce("yes", "boolean") == (True, True)
    assert coerce("maybe", "boolean") == ("maybe", False)
    assert coerce("", "number") == (None, True)


def test_normalize_caps_confidence_on_bad_values():
    out = normalize_fields(
        {
            "total": {"value": "abc", "confidence": 0.99},
            "date": {"value": "2026-01-05", "confidence": 7},
            "paid": None,
        },
        FIELDS,
    )
    assert out["total"] == {"value": "abc", "confidence": 0.3}
    assert out["date"] == {"value": "2026-01-05", "confidence": 1.0}
    assert out["paid"] == {"value": None, "confidence": 0.0}


def test_sniff_and_sanitize():
    assert sniff_mime(b"%PDF-1.7 ...") == "application/pdf"
    assert sniff_mime(b"\x89PNG\r\n\x1a\nxxxx") == "image/png"
    assert sniff_mime(b"RIFF\x00\x00\x00\x00WEBPVP8 ") == "image/webp"
    assert sniff_mime(b"<html><script>") is None
    assert sanitize_filename("../../etc/passwd") == "passwd"
    assert sanitize_filename("C:\\Users\\x\\a<b>.pdf") == "a_b_.pdf"
    assert sanitize_filename("") == "document"


def test_validate_upload_rejects_bad_files():
    for data, msg in [
        (b"", "empty"),
        (b"MZ\x90\x00 not a pdf", "Unsupported"),
        (b"%PDF-1.4 garbage that is not a real pdf", "corrupted"),
    ]:
        with pytest.raises(UploadRejected, match=msg):
            validate_upload(data, "x.pdf")
    with pytest.raises(UploadRejected, match="limit"):
        validate_upload(b"%PDF-" + b"0" * (11 * 1024 * 1024), "big.pdf")


# ---- Gemini adapter (SDK mocked: no network, no key) ----
class FakeModels:
    def __init__(self, outcome):
        self.outcome, self.calls = outcome, []

    def generate_content(self, **kwargs):
        self.calls.append(kwargs)
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


def gemini_with(outcome):
    models = FakeModels(outcome)
    return GeminiExtractor("k", "gemini-test", client=SimpleNamespace(models=models)), models


def test_gemini_success_parses_and_normalizes():
    payload = {"total": {"value": "1,200.50", "confidence": 0.95}}
    resp = SimpleNamespace(
        text=json.dumps(payload),
        usage_metadata=SimpleNamespace(prompt_token_count=812, candidates_token_count=64),
    )
    ex, models = gemini_with(resp)
    result = ex.extract(b"%PDF-", "application/pdf", FIELDS)
    assert result.fields["total"] == {"value": 1200.5, "confidence": 0.95}
    assert result.fields["date"]["value"] is None
    assert (result.input_tokens, result.output_tokens) == (812, 64)
    config = models.calls[0]["config"]
    assert config.temperature == 0 and config.response_mime_type == "application/json"


def test_gemini_errors_are_classified():
    ex, _ = gemini_with(genai_errors.ServerError(503, {"error": {"message": "overloaded"}}))
    with pytest.raises(TransientExtractionError):
        ex.extract(b"x", "application/pdf", FIELDS)
    ex, _ = gemini_with(genai_errors.ClientError(400, {"error": {"message": "bad"}}))
    with pytest.raises(ExtractionError) as info:
        ex.extract(b"x", "application/pdf", FIELDS)
    assert not isinstance(info.value, TransientExtractionError)
    ex, _ = gemini_with(SimpleNamespace(text="not json", usage_metadata=None))
    with pytest.raises(ExtractionError, match="invalid JSON"):
        ex.extract(b"x", "application/pdf", FIELDS)


def test_response_schema_covers_every_field():
    schema = build_response_schema(INVOICE_FIELDS)
    assert set(schema["required"]) == {f["key"] for f in INVOICE_FIELDS}
    assert schema["properties"]["total"]["properties"]["value"]["type"] == "NUMBER"
