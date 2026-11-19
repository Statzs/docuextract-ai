"""Reads a document's text without AI: the PDF text layer, or Tesseract OCR for scans/images."""

import io
import logging
import shutil
from dataclasses import dataclass, field
from functools import lru_cache

from pypdf import PdfReader

from app.extraction.base import ExtractionError

log = logging.getLogger("docuextract.text")
# Below this many characters per page a PDF is treated as scanned and sent to OCR.
MIN_CHARS_PER_PAGE = 25
OCR_LANGS = ("eng", "spa")


@dataclass
class DocumentText:
    text: str
    method: str  # "text" (PDF text layer) or "ocr"
    notes: list[str] = field(default_factory=list)


def pdf_page_texts(content: bytes) -> list[str]:
    try:
        reader = PdfReader(io.BytesIO(content))
        return [_page_text(page) for page in reader.pages]
    except Exception as e:  # pypdf raises a wide variety of errors on malformed files
        raise ExtractionError(f"pdf text extraction failed: {e}", "Could not read the PDF.") from e


def _page_text(page) -> str:
    # Layout mode keeps the gap between a label column and its value ("Total      3.00"),
    # which the rules use to pair them. Plain mode is the fallback for odd PDFs.
    try:
        return page.extract_text(extraction_mode="layout") or ""
    except Exception:
        return page.extract_text() or ""


def pdf_text(content: bytes) -> str:
    return "\n".join(pdf_page_texts(content))


@lru_cache
def ocr_languages() -> tuple[str, ...]:
    """Installed Tesseract languages we use; empty when Tesseract is not installed."""
    if not shutil.which("tesseract"):
        return ()
    import pytesseract

    try:
        installed = set(pytesseract.get_languages(config=""))
    except Exception:
        log.exception("tesseract is installed but not usable")
        return ()
    return tuple(lang for lang in OCR_LANGS if lang in installed)


def ocr_available() -> bool:
    return bool(ocr_languages())


def _ocr(image) -> str:
    import pytesseract

    image = image.convert("L")
    image.thumbnail((2500, 2500))  # bounds memory and CPU on a small instance
    try:
        return pytesseract.image_to_string(image, lang="+".join(ocr_languages()), timeout=90)
    except (RuntimeError, pytesseract.TesseractError) as e:  # RuntimeError = timeout
        raise ExtractionError(f"ocr failed: {e}", "We could not read the text in this file.") from e


def ocr_image(content: bytes) -> str:
    from PIL import Image

    with Image.open(io.BytesIO(content)) as im:
        return _ocr(im)


def ocr_pdf(content: bytes, max_pages: int) -> str:
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(content)
    try:
        return "\n".join(
            _ocr(pdf[i].render(scale=200 / 72).to_pil()) for i in range(min(len(pdf), max_pages))
        )
    finally:
        pdf.close()


def read_text(content: bytes, mime_type: str, ocr_max_pages: int = 5) -> DocumentText:
    if mime_type == "application/pdf":
        pages = pdf_page_texts(content)
        text = "\n".join(pages)
        if len("".join(text.split())) >= MIN_CHARS_PER_PAGE * len(pages):
            return DocumentText(text, "text")
        if not ocr_available():
            return DocumentText(
                text, "text", ["This PDF looks scanned and OCR is not available on this server."]
            )
        notes = []
        if len(pages) > ocr_max_pages:
            notes.append(f"Scanned PDF: only the first {ocr_max_pages} pages were read.")
        return DocumentText(ocr_pdf(content, ocr_max_pages), "ocr", notes)
    if not ocr_available():
        return DocumentText("", "ocr", ["Reading images needs OCR, which is not available here."])
    return DocumentText(ocr_image(content), "ocr")
