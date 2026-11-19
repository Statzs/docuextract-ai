"""Pydantic request/response models (the API contract)."""

import re
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

FieldType = Literal["string", "number", "currency", "date", "boolean"]
KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,39}$")


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---- auth ----
class RegisterIn(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=8, max_length=128)
    website: str = Field(default="", max_length=200)  # honeypot: hidden from people


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=128)


class ForgotPasswordIn(BaseModel):
    email: EmailStr


class ResetPasswordIn(BaseModel):
    token: str = Field(min_length=20, max_length=200)
    password: str = Field(min_length=8, max_length=128)


class UserOut(ORM):
    id: str
    email: str
    name: str
    is_demo: bool
    is_admin: bool = False
    has_password: bool = True


# ---- extraction schemas ----
class FieldDef(BaseModel):
    key: str
    label: str = Field(min_length=1, max_length=60)
    type: FieldType = "string"
    required: bool = False
    description: str = Field(default="", max_length=300)

    @field_validator("key")
    @classmethod
    def _key(cls, v: str) -> str:
        if not KEY_RE.match(v):
            raise ValueError("key must be snake_case: lowercase letters, digits, underscores")
        return v


class SchemaIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=500)
    fields: list[FieldDef] = Field(min_length=1, max_length=40)

    @model_validator(mode="after")
    def _unique_keys(self):
        keys = [f.key for f in self.fields]
        if len(keys) != len(set(keys)):
            raise ValueError("field keys must be unique")
        return self


class SchemaOut(ORM):
    id: str
    name: str
    kind: str | None = None
    description: str
    fields: list[FieldDef]
    created_at: datetime
    updated_at: datetime
    document_count: int = 0


# ---- documents ----
class FieldValue(BaseModel):
    value: Any = None
    confidence: float = 0.0


class DocumentOut(ORM):
    id: str
    filename: str
    mode: str = "auto"
    mime_type: str
    size_bytes: int
    page_count: int | None
    status: str
    error: str | None
    attempts: int
    provider: str | None
    model: str | None
    notes: str | None
    schema_id: str | None
    schema_name: str
    created_at: datetime
    processed_at: datetime | None
    validated_at: datetime | None


class DocumentDetail(DocumentOut):
    schema_snapshot: list[FieldDef]
    extracted_data: dict[str, FieldValue] | None
    reviewed_data: dict[str, Any] | None
    # Only on upload / while waiting for a type: the template the text suggests.
    suggested_schema_id: str | None = None
    duplicate: bool = False  # the same file was already uploaded; this is that document


class ExtractIn(BaseModel):
    schema_id: str
    mode: Literal["auto", "private"] = "auto"


class DocumentPage(BaseModel):
    items: list[DocumentOut]
    total: int
    page: int
    page_size: int


class ReviewIn(BaseModel):
    values: dict[str, Any]
    validate_document: bool = Field(default=False, alias="validate")

    model_config = ConfigDict(populate_by_name=True)


# ---- usage ----
class UsageDay(BaseModel):
    date: str
    requests: int
    failures: int
    input_tokens: int
    output_tokens: int


class UsageSummary(BaseModel):
    days: int
    total_requests: int
    failed_requests: int
    input_tokens: int
    output_tokens: int
    avg_latency_ms: int
    estimated: bool
    series: list[UsageDay]
    status_counts: dict[str, int]


class AppConfig(BaseModel):
    demo_mode: bool
    provider: str
    model: str
    max_upload_mb: int
    max_pdf_pages: int
    accepted_types: list[str]
    password_reset_enabled: bool
    ocr_available: bool
    retention_days: int
    google_enabled: bool
    github_enabled: bool


class AiStatus(BaseModel):
    available: bool
    reason: str | None
    remaining_today: int | None


class AdminLimits(BaseModel):
    ai_enabled: bool | None = None
    ai_daily_limit_per_user: int | None = None
    ai_daily_limit_global: int | None = None
    daily_documents_per_user: int | None = None
    max_pdf_pages: int | None = None
    ocr_max_pages: int | None = None
    retention_days: int | None = None
