from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.demo.data import SAMPLES
from app.demo.seed import SAMPLES_DIR
from app.extraction.text import ocr_available
from app.models import Document, UsageEvent, User, utcnow
from app.schemas import AiStatus, AppConfig, UsageDay, UsageSummary
from app.security import current_user
from app.services.files import ACCEPTED_TYPES, sniff_mime
from app.services.limits import ai_block_reason, ai_calls_today, get_limits

router = APIRouter(prefix="/api", tags=["usage"])


@router.get("/usage", response_model=UsageSummary)
def usage_summary(
    days: int = Query(30, ge=1, le=365),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    today = utcnow().date()
    start = today - timedelta(days=days - 1)
    events = db.scalars(
        select(UsageEvent).where(
            UsageEvent.user_id == user.id,
            UsageEvent.created_at >= utcnow() - timedelta(days=days),
        )
    ).all()
    # shortcut: aggregates in Python; fine for per-user volumes, move to SQL GROUP BY at scale.
    by_day = {
        (start + timedelta(days=i)).isoformat(): UsageDay(
            date=(start + timedelta(days=i)).isoformat(),
            requests=0,
            failures=0,
            input_tokens=0,
            output_tokens=0,
        )
        for i in range(days)
    }
    for e in events:
        day = by_day.get(e.created_at.date().isoformat())
        if day:
            day.requests += 1
            day.failures += 0 if e.success else 1
            day.input_tokens += e.input_tokens
            day.output_tokens += e.output_tokens

    status_counts = dict(
        db.execute(
            select(Document.status, func.count())
            .where(Document.user_id == user.id)
            .group_by(Document.status)
        ).all()
    )
    return UsageSummary(
        days=days,
        total_requests=len(events),
        failed_requests=sum(not e.success for e in events),
        input_tokens=sum(e.input_tokens for e in events),
        output_tokens=sum(e.output_tokens for e in events),
        avg_latency_ms=int(sum(e.latency_ms for e in events) / len(events)) if events else 0,
        estimated=any(e.tokens_estimated for e in events),
        series=list(by_day.values()),
        status_counts=status_counts,
    )


@router.get("/config", response_model=AppConfig)
def app_config(db: Session = Depends(get_db)):
    s = get_settings()
    limits = get_limits(db)
    return AppConfig(
        demo_mode=s.demo_mode,
        provider="standard" if s.demo_mode else "gemini",
        model="pdf-text/ocr + rules" if s.demo_mode else s.gemini_model,
        max_upload_mb=s.max_upload_mb,
        max_pdf_pages=limits.max_pdf_pages,
        accepted_types=ACCEPTED_TYPES,
        password_reset_enabled=s.password_reset_enabled,
        ocr_available=ocr_available(),
        retention_days=limits.retention_days,
        google_enabled=s.google_enabled,
        github_enabled=s.github_enabled,
    )


@router.get("/ai-status", response_model=AiStatus)
def ai_status(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Whether the next extraction in auto mode would use AI, so the UI can say so up front."""
    limits = get_limits(db)
    reason = ai_block_reason(db, user, "auto", limits)
    remaining = None
    if reason is None:
        remaining = max(0, limits.ai_daily_limit_per_user - ai_calls_today(db, user.id))
    return AiStatus(available=reason is None, reason=reason, remaining_today=remaining)


# Whitelist: only these fictional files can be served, so the path never comes from the client.
_SAMPLE_FILES = {name: schema for name, schema, *_ in SAMPLES}


@router.get("/samples")
def list_samples(_: User = Depends(current_user)):
    return [{"filename": name, "schema": schema} for name, schema in _SAMPLE_FILES.items()]


@router.get("/samples/{filename}")
def get_sample(filename: str, _: User = Depends(current_user)):
    if filename not in _SAMPLE_FILES:
        raise HTTPException(404, "Sample not found")
    path = SAMPLES_DIR / filename
    return FileResponse(path, media_type=sniff_mime(path.read_bytes()[:16]))
