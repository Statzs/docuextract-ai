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
MAX_IMAGE_PIXELS = 40_000_000  # ~ a 7000x5700 photo; larger is a decompression-bomb risk


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


def _check_image(data: bytes) -> None:
    from PIL import Image

    try:
        with Image.open(io.BytesIO(data)) as im:
            w, h = im.size  # reads the header only; pixels are not decoded here
            im.verify()  # structural check of the file
    except Exception as e:  # Pillow raises many types for broken or hostile files
        raise UploadRejected("The image appears to be corrupted.") from e
    if w * h > MAX_IMAGE_PIXELS:
        raise UploadRejected("The image is too large. Use a photo under 40 megapixels.")


def validate_upload(
    data: bytes, filename: str | None, max_pages: int | None = None
) -> ValidatedFile:
    s = get_settings()
    max_pages = max_pages or s.max_pdf_pages
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
        if pages > max_pages:
            raise UploadRejected(f"PDFs are limited to {max_pages} pages.")
    else:
        _check_image(data)
    return ValidatedFile(sanitize_filename(filename), mime, len(data), pages)
