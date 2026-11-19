"""Runs one extraction job.

Hybrid: Gemini when the user allows it and the budget has room, otherwise (or if Gemini
fails) the standard reader (PDF text layer / Tesseract OCR + label rules). Every attempt is
recorded as a usage event; the document says which method produced its values.
"""

import logging
import time

from sqlalchemy import update

from app.config import get_settings
from app.db import SessionLocal
from app.extraction import get_ai_extractor
from app.extraction.base import (
    ExtractionError,
    ExtractionResult,
    Extractor,
    TransientExtractionError,
)
from app.extraction.rules import StandardExtractor
from app.extraction.text import pdf_text
from app.extraction.verify import ground_in_text
from app.models import DocStatus, Document, UsageEvent, User, utcnow
from app.services.limits import ai_block_reason, get_limits

log = logging.getLogger("docuextract.processing")


def recover_interrupted_jobs() -> int:
    """In-process jobs die with the server; surface them as failed so users can retry.

    shortcut: assumes a single API instance; with several, use a durable job queue instead.
    """
    with SessionLocal() as db:
        stuck = (
            db.query(Document)
            .filter(Document.status.in_([DocStatus.QUEUED, DocStatus.PROCESSING]))
            .all()
        )
        for doc in stuck:
            doc.status = DocStatus.FAILED
            doc.error = "Processing was interrupted by a server restart. Please retry."
        db.commit()
        return len(stuck)


def _attempt(db, doc: Document, extractor: Extractor, sleep) -> ExtractionResult:
    """Run one extractor with retries on transient errors. Raises the last ExtractionError."""
    s = get_settings()
    for attempt in range(1, s.extraction_max_attempts + 1):
        doc.attempts += 1
        started = time.perf_counter()
        event = UsageEvent(
            user_id=doc.user_id, document_id=doc.id, provider=extractor.name, model=extractor.model
        )
        try:
            result = extractor.extract(doc.content, doc.mime_type, doc.schema_snapshot)
        except ExtractionError as e:
            log.warning("%s attempt %s failed for %s: %s", extractor.name, attempt, doc.id, e)
            event.success, event.error = False, str(e)[:200]
            event.latency_ms = int((time.perf_counter() - started) * 1000)
            db.add(event)
            db.commit()
            if isinstance(e, TransientExtractionError) and attempt < s.extraction_max_attempts:
                sleep(s.extraction_backoff_seconds * 2 ** (attempt - 1))
                continue
            if isinstance(e, TransientExtractionError):
                e.user_message += f" Gave up after {attempt} attempts."
            raise
        result.provider = result.provider or extractor.name
        event.success = True
        event.latency_ms = int((time.perf_counter() - started) * 1000)
        event.input_tokens, event.output_tokens = result.input_tokens, result.output_tokens
        event.tokens_estimated = result.tokens_estimated
        event.provider = result.provider
        event.model = result.model
        db.add(event)
        db.commit()
        return result
    raise AssertionError("unreachable")  # the loop always returns or raises


def _hybrid(db, doc: Document, sleep) -> ExtractionResult:
    limits = get_limits(db)
    reason = ai_block_reason(db, db.get(User, doc.user_id), doc.mode, limits)
    if reason is None:
        try:
            result = _attempt(db, doc, get_ai_extractor(), sleep)
        except ExtractionError as e:
            reason = (
                f"The AI could not process this document ({e.user_message.rstrip('.')}), "
                "so it was read with standard text reading instead."
            )
        else:
            if doc.mime_type == "application/pdf":
                try:
                    text = pdf_text(doc.content)
                    unverified = ground_in_text(result.fields, text, doc.schema_snapshot)
                except ExtractionError:
                    unverified = 0
                if unverified:
                    result.notes.append(
                        f"{unverified} AI value(s) do not appear word for word in the document; "
                        "they are marked low confidence. Please check them."
                    )
            return result
    result = _attempt(db, doc, StandardExtractor(limits.ocr_max_pages), sleep)
    result.notes.insert(0, reason)
    return result


def process_document(document_id: str, extractor: Extractor | None = None, sleep=time.sleep):
    """`extractor` forces one extractor (tests); by default the hybrid pipeline decides."""
    with SessionLocal() as db:
        # Atomic claim: of two concurrent runs for one document, only one wins (no double billing).
        claimed = db.execute(
            update(Document)
            .where(Document.id == document_id, Document.status == DocStatus.QUEUED)
            .values(status=DocStatus.PROCESSING, error=None, notes=None)
        ).rowcount
        db.commit()
        if not claimed:
            return  # deleted, or already picked up by another run
        doc = db.get(Document, document_id)
        try:
            result = _attempt(db, doc, extractor, sleep) if extractor else _hybrid(db, doc, sleep)
        except ExtractionError as e:
            doc.status, doc.error = DocStatus.FAILED, e.user_message
        except Exception:
            log.exception("unexpected extraction error for %s", doc.id)
            db.rollback()
            doc = db.get(Document, document_id)
            doc.status, doc.error = DocStatus.FAILED, "Unexpected error during extraction."
        else:
            doc.provider = result.provider
            doc.model = result.model
            doc.extracted_data, doc.reviewed_data = result.fields, None
            doc.notes = " ".join(result.notes) or None
            doc.status, doc.validated_at = DocStatus.NEEDS_REVIEW, None
        doc.processed_at = utcnow()
        db.commit()
