import hashlib
from datetime import date
from typing import Literal
from urllib.parse import quote

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Response,
    UploadFile,
)
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session, undefer

from app.config import get_settings
from app.db import get_db
from app.extraction.base import ExtractionError
from app.extraction.classify import suggest_kind
from app.extraction.normalize import coerce
from app.extraction.text import pdf_text
from app.models import DocStatus, Document, ExtractionSchema, User, utcnow
from app.routers.extraction_schemas import get_owned_schema
from app.schemas import DocumentDetail, DocumentPage, ExtractIn, ReviewIn
from app.security import current_user, upload_limiter
from app.services import exporter
from app.services.files import UploadRejected, validate_upload
from app.services.limits import documents_today, get_limits, purge_expired_documents
from app.services.processing import process_document

router = APIRouter(prefix="/api/documents", tags=["documents"])

EXPORTS = {
    "csv": (exporter.to_csv, "text/csv; charset=utf-8"),
    "xlsx": (exporter.to_xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    "json": (exporter.to_json, "application/json"),
}


def get_owned_document(db: Session, user: User, doc_id: str, with_content=False) -> Document:
    stmt = select(Document).where(Document.id == doc_id, Document.user_id == user.id)
    if with_content:
        stmt = stmt.options(undefer(Document.content))
    doc = db.scalar(stmt)
    if not doc:
        raise HTTPException(404, "Document not found.")
    return doc


def _suggest(db: Session, user: User, doc: Document) -> str | None:
    """Pre-select a template from the PDF's text layer (images would need OCR: too slow here)."""
    text = ""
    if doc.mime_type == "application/pdf":
        try:
            text = pdf_text(doc.content)
        except ExtractionError:
            pass
    kind = suggest_kind(text, doc.filename)
    if not kind:
        return None
    return db.scalar(
        select(ExtractionSchema.id).where(
            ExtractionSchema.user_id == user.id, ExtractionSchema.kind == kind
        )
    )


def _queue(doc: Document, schema: ExtractionSchema, mode: str) -> None:
    doc.schema_id, doc.schema_name, doc.schema_snapshot = schema.id, schema.name, schema.fields
    doc.mode, doc.status, doc.error = mode, DocStatus.QUEUED, None


@router.post("", response_model=DocumentDetail, status_code=201)
def upload_document(
    background: BackgroundTasks,
    response: Response,
    file: UploadFile = File(...),
    schema_id: str | None = Form(None),
    mode: Literal["auto", "private"] = Form("auto"),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Store a file. With `schema_id` extraction starts at once; without it the document
    waits (status `uploaded`) for the user to pick a type, and a suggestion is returned."""
    upload_limiter.hit(user.id)  # per account, so a changing IP does not help
    schema = get_owned_schema(db, user, schema_id) if schema_id else None
    limits = get_limits(db)
    purge_expired_documents(db, limits)
    limit = get_settings().max_upload_mb * 1024 * 1024
    data = file.file.read(limit + 1)  # bounded read: never buffer more than limit+1 bytes
    try:
        meta = validate_upload(data, file.filename, limits.max_pdf_pages)
    except UploadRejected as e:
        raise HTTPException(422, str(e)) from None

    digest = hashlib.sha256(data).hexdigest()
    existing = db.scalar(
        select(Document)
        .where(
            Document.user_id == user.id,
            Document.content_sha256 == digest,
            Document.status != DocStatus.FAILED,
        )
        .order_by(Document.created_at.desc())
    )
    if existing:  # the same file again: no new storage, no new AI call
        response.status_code = 200
        out = DocumentDetail.model_validate(existing)
        out.duplicate = True
        return out
    if documents_today(db, user.id) >= limits.daily_documents_per_user:
        raise HTTPException(
            429,
            f"You can upload {limits.daily_documents_per_user} documents per day. "
            "Please try again tomorrow.",
        )

    doc = Document(
        user_id=user.id,
        schema_name="",
        schema_snapshot=[],
        filename=meta.filename,
        mime_type=meta.mime_type,
        size_bytes=meta.size_bytes,
        page_count=meta.page_count,
        content=data,
        content_sha256=digest,
        status=DocStatus.UPLOADED,
    )
    if schema:
        _queue(doc, schema, mode)
    db.add(doc)
    db.commit()
    if schema:
        background.add_task(process_document, doc.id)
        return doc
    out = DocumentDetail.model_validate(doc)
    out.suggested_schema_id = _suggest(db, user, doc)
    return out


@router.post("/{doc_id}/extract", response_model=DocumentDetail)
def extract_document(
    doc_id: str,
    body: ExtractIn,
    background: BackgroundTasks,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Extract (or re-extract with another type) an uploaded document."""
    upload_limiter.hit(user.id)
    doc = get_owned_document(db, user, doc_id)
    schema = get_owned_schema(db, user, body.schema_id)
    # Atomic: two clicks cannot start two jobs (or two AI calls) for one document.
    started = db.execute(
        update(Document)
        .where(
            Document.id == doc.id,
            Document.status.not_in([DocStatus.QUEUED, DocStatus.PROCESSING]),
        )
        .values(status=DocStatus.QUEUED)
    ).rowcount
    if not started:
        db.rollback()
        raise HTTPException(409, "This document is already being processed.")
    db.refresh(doc)
    _queue(doc, schema, body.mode)
    db.commit()
    background.add_task(process_document, doc.id)
    return doc


@router.get("", response_model=DocumentPage)
def list_documents(
    status: str | None = Query(None),
    q: str | None = Query(None, max_length=100),
    schema_id: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    stmt = select(Document).where(Document.user_id == user.id)
    if status:
        stmt = stmt.where(Document.status.in_(status.split(",")))
    if q:
        escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        stmt = stmt.where(Document.filename.ilike(f"%{escaped}%", escape="\\"))
    if schema_id:
        stmt = stmt.where(Document.schema_id == schema_id)
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    items = db.scalars(
        stmt.order_by(Document.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    ).all()
    return DocumentPage(items=items, total=total, page=page, page_size=page_size)


@router.get("/export")
def export_documents(
    format: Literal["csv", "xlsx", "json"] = "csv",
    ids: str | None = Query(None, description="Comma-separated document ids"),
    status: str | None = Query(None),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    stmt = select(Document).where(Document.user_id == user.id)
    if ids:
        stmt = stmt.where(Document.id.in_(ids.split(",")[:500]))
    if status:
        stmt = stmt.where(Document.status.in_(status.split(",")))
    else:
        stmt = stmt.where(Document.status.in_([DocStatus.NEEDS_REVIEW, DocStatus.VALIDATED]))
    docs = db.scalars(stmt.order_by(Document.created_at.desc())).all()
    if not docs:
        raise HTTPException(404, "No processed documents match this export.")
    build, media = EXPORTS[format]
    name = f"docuextract-{date.today().isoformat()}.{format}"
    return Response(
        build(docs),
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.get("/{doc_id}", response_model=DocumentDetail)
def get_document(doc_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    doc = get_owned_document(db, user, doc_id)
    if doc.status != DocStatus.UPLOADED:
        return doc
    out = DocumentDetail.model_validate(doc)
    out.suggested_schema_id = _suggest(db, user, doc)
    return out


@router.get("/{doc_id}/file")
def get_document_file(
    doc_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    doc = get_owned_document(db, user, doc_id, with_content=True)
    return Response(
        doc.content,
        media_type=doc.mime_type,  # sniffed from magic bytes at upload, never client-supplied
        headers={
            "Content-Disposition": f"inline; filename*=UTF-8''{quote(doc.filename)}",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, max-age=300",
        },
    )


@router.patch("/{doc_id}/review", response_model=DocumentDetail)
def review_document(
    doc_id: str, body: ReviewIn, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    doc = get_owned_document(db, user, doc_id)
    if doc.status not in (DocStatus.NEEDS_REVIEW, DocStatus.VALIDATED):
        raise HTTPException(409, "Only processed documents can be reviewed.")
    fields = {f["key"]: f for f in doc.schema_snapshot}
    unknown = set(body.values) - set(fields)
    if unknown:
        raise HTTPException(422, f"Unknown fields: {', '.join(sorted(unknown))}")

    current = exporter.final_values(doc)
    errors = {}
    for key, raw in body.values.items():
        value, ok = coerce(raw, fields[key]["type"])
        if not ok:
            errors[key] = f"Expected a valid {fields[key]['type']}."
        current[key] = value
    if body.validate_document:
        for key, f in fields.items():
            if f.get("required") and current.get(key) in (None, ""):
                errors[key] = "This field is required."
    if errors:
        raise HTTPException(422, {"message": "Some fields are invalid.", "fields": errors})

    doc.reviewed_data = {k: current.get(k) for k in fields}
    if body.validate_document:
        doc.status, doc.validated_at = DocStatus.VALIDATED, utcnow()
    db.commit()
    return doc


@router.post("/{doc_id}/retry", response_model=DocumentDetail)
def retry_document(
    doc_id: str,
    background: BackgroundTasks,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    doc = get_owned_document(db, user, doc_id)
    if doc.status in (DocStatus.QUEUED, DocStatus.PROCESSING):
        raise HTTPException(409, "This document is already being processed.")
    if not doc.schema_snapshot:
        raise HTTPException(409, "Choose a document type first.")
    doc.status, doc.error = DocStatus.QUEUED, None
    db.commit()
    background.add_task(process_document, doc.id)
    return doc


@router.delete("/{doc_id}", status_code=204)
def delete_document(doc_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(get_owned_document(db, user, doc_id))
    db.commit()
