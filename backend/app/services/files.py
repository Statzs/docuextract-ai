"""Upload validation. Never trust the client's content type or filename."""

import io
import re
import unicodedata
from dataclasses import dataclass

from pypdf import PdfReader
from pypdf.errors import PdfReadError

from app.config import get_settings

SIGNATURES: list[tuple[bytes, str]] = [
    (b"%PDF-", "application/pdf"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
]
ACCEPTED_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"]


class UploadRejected(ValueError):
    pass


@dataclass
class ValidatedFile:
    filename: str
    mime_type: str
    size_bytes: int
    page_count: int | None


def sniff_mime(data: bytes) -> str | None:
    for sig, mime in SIGNATURES:
        if data.startswith(sig):
            return mime
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def sanitize_filename(name: str | None) -> str:
    name = unicodedata.normalize("NFKC", name or "document")
    name = name.replace("\\", "/").rsplit("/", 1)[-1]  # drop any path component
    name = re.sub(r"[^\w.\- ()]", "_", name).strip(" .")
    return (name or "document")[:200]


def validate_upload(data: bytes, filename: str | None) -> ValidatedFile:
    s = get_settings()
    if not data:
        raise UploadRejected("The file is empty.")
    if len(data) > s.max_upload_mb * 1024 * 1024:
        raise UploadRejected(f"The file exceeds the {s.max_upload_mb} MB limit.")
    mime = sniff_mime(data)
    if mime is None:
        raise UploadRejected("Unsupported file type. Upload a PDF, PNG, JPEG or WebP file.")

    pages = None
    if mime == "application/pdf":
        try:
            reader = PdfReader(io.BytesIO(data))
            encrypted = reader.is_encrypted
            pages = 0 if encrypted else len(reader.pages)
        except (PdfReadError, ValueError, KeyError, TypeError, OSError) as e:
            raise UploadRejected("The PDF appears to be corrupted.") from e
        if encrypted:
            raise UploadRejected("Password-protected PDFs are not supported.")
        if pages == 0:
            raise UploadRejected("The PDF has no pages.")
        if pages > s.max_pdf_pages:
            raise UploadRejected(f"PDFs are limited to {s.max_pdf_pages} pages.")
    return ValidatedFile(sanitize_filename(filename), mime, len(data), pages)
