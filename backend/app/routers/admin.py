"""Private admin panel API. Only verified accounts listed in ADMIN_EMAILS get in.

It shows aggregates and settings, never other users' documents or file names.
"""

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.extraction.text import ocr_available, ocr_languages
from app.models import DocStatus, Document, UsageEvent, User, utcnow
from app.schemas import AdminLimits
from app.security import current_user
from app.services.limits import ai_calls_today, get_limits, limits_dict, set_limits, today_start

router = APIRouter(prefix="/api/admin", tags=["admin"])


def require_admin(user: User = Depends(current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(404, "Not found.")  # do not reveal that the panel exists
    return user


@router.get("/overview")
def overview(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    s = get_settings()
    limits = get_limits(db)
    today, week = today_start(), utcnow() - timedelta(days=7)

    def count(*where):
        return db.scalar(select(func.count()).select_from(Document).where(*where)) or 0

    def last_gemini(success: bool):
        return db.scalar(
            select(UsageEvent)
            .where(UsageEvent.provider == "gemini", UsageEvent.success.is_(success))
            .order_by(UsageEvent.created_at.desc())
            .limit(1)
        )

    ok, err = last_gemini(True), last_gemini(False)
    calls_today = ai_calls_today(db)
    failed_today = (
        db.scalar(
            select(func.count()).where(
                UsageEvent.provider == "gemini",
                UsageEvent.success.is_(False),
                UsageEvent.created_at >= today,
            )
        )
        or 0
    )
    by_method = dict(
        db.execute(
            select(UsageEvent.provider, func.count())
            .where(UsageEvent.created_at >= today, UsageEvent.success.is_(True))
            .group_by(UsageEvent.provider)
        ).all()
    )
    avg_ms = db.scalar(
        select(func.avg(UsageEvent.latency_ms)).where(
            UsageEvent.success.is_(True), UsageEvent.created_at >= week
        )
    )
    recent_failures = db.execute(
        select(Document.processed_at, Document.mime_type, Document.mode, Document.error)
        .where(Document.status == DocStatus.FAILED)
        .order_by(Document.processed_at.desc())
        .limit(10)
    ).all()
    return {
        "gemini": {
            "configured": not s.demo_mode,
            "enabled": limits.ai_enabled,
            "model": s.gemini_model,
            "calls_today": calls_today,
            "failures_today": failed_today,
            "last_success_at": ok.created_at if ok else None,
            "last_error_at": err.created_at if err else None,
            "last_error": err.error if err else None,
        },
        "fallbacks": {
            "pdf_text": True,
            "ocr": ocr_available(),
            "ocr_languages": list(ocr_languages()),
        },
        "quota": {
            "global_limit": limits.ai_daily_limit_global,
            "global_remaining": max(0, limits.ai_daily_limit_global - calls_today),
            "per_user_limit": limits.ai_daily_limit_per_user,
        },
        "documents": {
            "total": count(),
            "today": count(Document.created_at >= today),
            "failed_total": count(Document.status == DocStatus.FAILED),
            "failed_today": count(
                Document.status == DocStatus.FAILED, Document.processed_at >= today
            ),
            "extractions_today_by_method": by_method,
            "avg_processing_ms_7d": int(avg_ms or 0),
        },
        "users": {
            "registered": db.scalar(select(func.count()).where(User.is_demo.is_(False))) or 0,
            "new_today": db.scalar(
                select(func.count()).where(User.is_demo.is_(False), User.created_at >= today)
            )
            or 0,
            "demo_workspaces": db.scalar(select(func.count()).where(User.is_demo.is_(True))) or 0,
        },
        "recent_failures": [
            {"at": at, "type": mime, "mode": mode, "error": error}
            for at, mime, mode, error in recent_failures
        ],
        "limits": limits_dict(limits),
        "max_upload_mb": s.max_upload_mb,
    }


@router.put("/limits")
def update_limits(
    body: AdminLimits, _: User = Depends(require_admin), db: Session = Depends(get_db)
):
    try:
        return limits_dict(set_limits(db, body.model_dump(exclude_none=True)))
    except ValueError as e:
        raise HTTPException(422, str(e)) from None


@router.post("/gemini-check")
def gemini_check(_: User = Depends(require_admin)):
    """Asks Google whether the key and model work. Reads model metadata: no generation cost."""
    s = get_settings()
    if s.demo_mode:
        return {"ok": False, "message": "No GEMINI_API_KEY is set on the server."}
    from google import genai
    from google.genai import errors as genai_errors

    try:
        genai.Client(api_key=s.gemini_api_key).models.get(model=s.gemini_model)
    except genai_errors.APIError as e:
        return {"ok": False, "message": f"Gemini answered {e.code}: {e.message}"[:300]}
    except Exception as e:  # network problems
        return {"ok": False, "message": f"Could not reach Gemini: {type(e).__name__}"}
    return {"ok": True, "message": f"The key works and {s.gemini_model} is available."}
