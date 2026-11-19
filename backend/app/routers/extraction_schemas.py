from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.demo.data import SCHEMAS
from app.models import Document, ExtractionSchema, User
from app.schemas import SchemaIn, SchemaOut
from app.security import current_user

router = APIRouter(prefix="/api/schemas", tags=["schemas"])


def get_owned_schema(db: Session, user: User, schema_id: str) -> ExtractionSchema:
    schema = db.scalar(
        select(ExtractionSchema).where(
            ExtractionSchema.id == schema_id, ExtractionSchema.user_id == user.id
        )
    )
    if not schema:  # 404 for other users' ids too: never reveal that they exist
        raise HTTPException(404, "Schema not found.")
    return schema


def _out(schema: ExtractionSchema, count: int) -> SchemaOut:
    out = SchemaOut.model_validate(schema)
    out.document_count = count
    return out


@router.get("", response_model=list[SchemaOut])
def list_schemas(user: User = Depends(current_user), db: Session = Depends(get_db)):
    counts = dict(
        db.execute(
            select(Document.schema_id, func.count())
            .where(Document.user_id == user.id)
            .group_by(Document.schema_id)
        ).all()
    )
    schemas = db.scalars(
        select(ExtractionSchema)
        .where(ExtractionSchema.user_id == user.id)
        .order_by(ExtractionSchema.created_at)
    ).all()
    # Accounts created before a template existed get it now (built-ins cannot be deleted).
    have = {s.kind for s in schemas}
    missing = [ExtractionSchema(user_id=user.id, **t) for t in SCHEMAS if t["kind"] not in have]
    if missing:
        db.add_all(missing)
        db.commit()
        schemas = [*schemas, *missing]
    order = {t["kind"]: i for i, t in enumerate(SCHEMAS)}
    schemas = sorted(schemas, key=lambda s: order.get(s.kind, len(order)))  # stable: custom last
    return [_out(s, counts.get(s.id, 0)) for s in schemas]


@router.post("", response_model=SchemaOut, status_code=201)
def create_schema(
    body: SchemaIn, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    schema = ExtractionSchema(user_id=user.id, **body.model_dump())
    db.add(schema)
    db.commit()
    return _out(schema, 0)


@router.get("/{schema_id}", response_model=SchemaOut)
def get_schema(schema_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _out(get_owned_schema(db, user, schema_id), 0)


@router.put("/{schema_id}", response_model=SchemaOut)
def update_schema(
    schema_id: str,
    body: SchemaIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    schema = get_owned_schema(db, user, schema_id)
    for k, v in body.model_dump().items():
        setattr(schema, k, v)
    db.commit()
    return _out(schema, 0)


@router.delete("/{schema_id}", status_code=204)
def delete_schema(
    schema_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    schema = get_owned_schema(db, user, schema_id)
    if schema.kind:
        raise HTTPException(409, "Built-in templates can't be deleted, but you can edit them.")
    # Documents keep their schema snapshot, so deleting a schema never loses results.
    db.delete(schema)
    db.commit()
