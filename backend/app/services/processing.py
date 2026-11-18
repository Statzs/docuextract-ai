"""Runs one extraction job: retries transient failures, records usage, sets status."""

import logging
import time

from sqlalchemy import update

from app.config import get_settings
from app.db import SessionLocal
from app.extraction import get_extractor
from app.extraction.base import ExtractionError, Extractor, TransientExtractionError
from app.extraction.demo import DemoExtractor
from app.models import DocStatus, Document, UsageEvent, User, utcnow

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


def process_document(document_id: str, extractor: Extractor | None = None, sleep=time.sleep):
    s = get_settings()
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
        if extractor is None:
            # Public demo visitors never spend the owner's Gemini budget.
            extractor = DemoExtractor() if db.get(User, doc.user_id).is_demo else get_extractor()
        doc.provider, doc.model = extractor.name, extractor.model
        db.commit()
        content, mime, fields = doc.content, doc.mime_type, doc.schema_snapshot

        for attempt in range(1, s.extraction_max_attempts + 1):
            doc.attempts += 1
            started = time.perf_counter()
            event = UsageEvent(
                user_id=doc.user_id,
                document_id=doc.id,
                provider=extractor.name,
                model=extractor.model,
            )
            try:
                result = extractor.extract(content, mime, fields)
            except ExtractionError as e:
                transient = isinstance(e, TransientExtractionError)
                log.warning("extraction attempt %s failed for %s: %s", attempt, doc.id, e)
                event.success, event.error = False, str(e)[:200]
                event.latency_ms = int((time.perf_counter() - started) * 1000)
                db.add(event)
                if transient and attempt < s.extraction_max_attempts:
                    db.commit()
                    sleep(s.extraction_backoff_seconds * 2 ** (attempt - 1))
                    continue
                doc.status, doc.error = DocStatus.FAILED, e.user_message
                if transient:
                    doc.error += f" Gave up after {attempt} attempts."
                doc.processed_at = utcnow()
                db.commit()
                return
            except Exception:
                log.exception("unexpected extraction error for %s", doc.id)
                event.success, event.error = False, "internal error"
                db.add(event)
                doc.status, doc.error = DocStatus.FAILED, "Unexpected error during extraction."
                doc.processed_at = utcnow()
                db.commit()
                return

            event.success = True
            event.latency_ms = int((time.perf_counter() - started) * 1000)
            event.input_tokens, event.output_tokens = result.input_tokens, result.output_tokens
            event.tokens_estimated = result.tokens_estimated
            event.model = result.model
            db.add(event)
            doc.extracted_data, doc.reviewed_data = result.fields, None
            doc.notes = " ".join(result.notes) or None
            doc.status, doc.processed_at, doc.validated_at = DocStatus.NEEDS_REVIEW, utcnow(), None
            db.commit()
            return
