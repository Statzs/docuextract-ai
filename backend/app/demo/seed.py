"""Creates an isolated, throwaway demo workspace for one visitor."""

import secrets
from datetime import timedelta
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.demo.data import SAMPLES, SCHEMAS
from app.extraction.demo import DemoExtractor
from app.models import DocStatus, Document, ExtractionSchema, UsageEvent, User, utcnow
from app.security import hash_password
from app.services.exporter import final_values
from app.services.files import validate_upload

SAMPLES_DIR = Path(__file__).parent / "samples"


def create_default_schemas(db: Session, user: User) -> dict[str, ExtractionSchema]:
    out = {}
    for s in SCHEMAS:
        schema = ExtractionSchema(user_id=user.id, **s)
        db.add(schema)
        out[s["name"]] = schema
    db.flush()
    return out


def create_demo_user(db: Session) -> User:
    user = User(
        email=f"demo-{secrets.token_hex(6)}@demo.docuextract.local",
        name="Demo Visitor",
        password_hash=hash_password(secrets.token_urlsafe(24)),  # unusable: demo is cookie-only
        is_demo=True,
    )
    db.add(user)
    db.flush()
    schemas = create_default_schemas(db, user)

    extractor = DemoExtractor()  # always offline, never spends Gemini quota on demo data
    now = utcnow()
    for filename, schema_name, _title, _lines, days_ago, validate in SAMPLES:
        data = (SAMPLES_DIR / filename).read_bytes()
        meta = validate_upload(data, filename)
        schema = schemas[schema_name]
        result = extractor.extract(data, meta.mime_type, schema.fields)
        created = now - timedelta(days=days_ago, hours=1)
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
            status=DocStatus.NEEDS_REVIEW,
            attempts=1,
            provider=extractor.name,
            model=extractor.model,
            extracted_data=result.fields,
            created_at=created,
            processed_at=created + timedelta(seconds=2),
        )
        if validate:
            doc.status, doc.validated_at = DocStatus.VALIDATED, created + timedelta(minutes=5)
            doc.reviewed_data = final_values(doc)
        db.add(doc)
        db.flush()
        db.add(
            UsageEvent(
                user_id=user.id,
                document_id=doc.id,
                provider=extractor.name,
                model=extractor.model,
                input_tokens=result.input_tokens,
                output_tokens=result.output_tokens,
                tokens_estimated=True,
                latency_ms=40,
                success=True,
                created_at=created,
            )
        )
    db.commit()
    return user


def purge_old_demo_users(db: Session, max_age_hours: int = 24) -> int:
    cutoff = utcnow() - timedelta(hours=max_age_hours)
    old = db.scalars(select(User).where(User.is_demo, User.created_at < cutoff)).all()
    for u in old:
        db.delete(u)  # FK cascades remove their schemas, documents and usage
    db.commit()
    return len(old)
