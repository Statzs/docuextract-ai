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
from sqlalchemy import func, select
from sqlalchemy.orm import Session, undefer

from app.config import get_settings
from app.db import get_db
from app.extraction.normalize import coerce
from app.models import DocStatus, Document, UsageEvent, User, utcnow
from app.routers.extraction_schemas import get_owned_schema
from app.schemas import DocumentDetail, DocumentPage, ReviewIn
from app.security import current_user, upload_limiter
from app.services import exporter
from app.services.files import UploadRejected, validate_upload
from app.services.processing import process_document

router = APIRouter(prefix="/api/documents", tags=["documents"])

EXPORTS = {
    "csv": (exporter.to_csv, "text/csv; charset=utf-8"),
    "xlsx": (exporter.to_xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    "json": (exporter.to_json, "application/json"),
}


def enforce_ai_quota(db: Session, user: User) -> None:
    """Refuse new AI work once today's per-user or global Gemini budget is spent."""
    s = get_settings()
    if s.demo_mode or user.is_demo:
        return  # offline extractor: no cost
    midnight = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    today = select(func.count()).where(
        UsageEvent.provider == "gemini", UsageEvent.created_at >= midnight
    )
    # shortcut: check-then-act; concurrent uploads can overshoot by a few calls. Use a
    # DB counter row with SELECT ... FOR UPDATE if the limit must be exact.
    if db.scalar(today) >= s.ai_daily_limit_global:
        raise HTTPException(
            429, "The daily AI budget for this demo is used up. Try again tomorrow."
        )
    if db.scalar(today.where(UsageEvent.user_id == user.id)) >= s.ai_daily_limit_per_user:
        raise HTTPException(
            429, "You have reached today's AI extraction limit. Try again tomorrow."
        )


def get_owned_document(db: Session, user: User, doc_id: str, with_content=False) -> Document:
    stmt = select(Document).where(Document.id == doc_id, Document.user_id == user.id)
    if with_content:
        stmt = stmt.options(undefer(Document.content))
    doc = db.scalar(stmt)
    if not doc:
        raise HTTPException(404, "Document not found.")
    return doc


@router.post("", response_model=DocumentDetail, status_code=201)
def upload_document(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    schema_id: str = Form(...),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    upload_limiter.hit(user.id)  # per account, so a changing IP does not help
    schema = get_owned_schema(db, user, schema_id)
    enforce_ai_quota(db, user)
    limit = get_settings().max_upload_mb * 1024 * 1024
    data = file.file.read(limit + 1)  # bounded read: never buffer more than limit+1 bytes
    try:
        meta = validate_upload(data, file.filename)
    except UploadRejected as e:
        raise HTTPException(422, str(e)) from None

    doc = Document(
        user_id=user.id,
        schema_id=schema.id,
        schema_name=schema.name,
        schema_snapshot=schema.fields,
        filename=meta.filename,
        mime_type=meta.mime_type,
        size_bytes=meta.size_bytes,
        page_count=meta.page_count,
        content=data,
    )
    db.add(doc)
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
    return get_owned_document(db, user, doc_id)


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
    enforce_ai_quota(db, user)
    doc.status, doc.error = DocStatus.QUEUED, None
    db.commit()
    background.add_task(process_document, doc.id)
    return doc


@router.delete("/{doc_id}", status_code=204)
def delete_document(doc_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(get_owned_document(db, user, doc_id))
    db.commit()
