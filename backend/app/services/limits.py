"""Usage limits: defaults from the environment, overridable from the admin panel."""

from dataclasses import asdict, dataclass, fields
from datetime import timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import AppSetting, Document, UsageEvent, User, utcnow


@dataclass
class Limits:
    ai_enabled: bool
    ai_daily_limit_per_user: int
    ai_daily_limit_global: int
    daily_documents_per_user: int
    max_pdf_pages: int
    ocr_max_pages: int
    retention_days: int


# (min, max) accepted from the admin panel.
BOUNDS = {
    "ai_daily_limit_per_user": (0, 10_000),
    "ai_daily_limit_global": (0, 100_000),
    "daily_documents_per_user": (1, 10_000),
    "max_pdf_pages": (1, 100),
    "ocr_max_pages": (1, 30),
    "retention_days": (0, 3650),
}


def get_limits(db: Session) -> Limits:
    s = get_settings()
    values = {
        "ai_enabled": True,
        **{k: getattr(s, k) for k in BOUNDS},
    }
    for row in db.scalars(select(AppSetting)):
        if row.key == "ai_enabled":
            values["ai_enabled"] = row.value == "true"
        elif row.key in BOUNDS:
            values[row.key] = int(row.value)
    return Limits(**values)


def set_limits(db: Session, changes: dict) -> Limits:
    names = {f.name for f in fields(Limits)}
    for key, value in changes.items():
        if key not in names:
            raise ValueError(f"unknown setting {key}")
        if key == "ai_enabled":
            stored = "true" if value else "false"
        else:
            lo, hi = BOUNDS[key]
            if not isinstance(value, int) or isinstance(value, bool) or not lo <= value <= hi:
                raise ValueError(f"{key} must be a whole number between {lo} and {hi}")
            stored = str(value)
        row = db.get(AppSetting, key)
        if row:
            row.value = stored
        else:
            db.add(AppSetting(key=key, value=stored))
    db.commit()
    return get_limits(db)


def today_start():
    return utcnow().replace(hour=0, minute=0, second=0, microsecond=0)


def ai_calls_today(db: Session, user_id: str | None = None) -> int:
    stmt = select(func.count()).where(
        UsageEvent.provider == "gemini", UsageEvent.created_at >= today_start()
    )
    if user_id:
        stmt = stmt.where(UsageEvent.user_id == user_id)
    return db.scalar(stmt) or 0


def ai_block_reason(db: Session, user: User, mode: str, limits: Limits) -> str | None:
    """Why this extraction will not use AI, in words for the user; None = AI can be used."""
    if mode == "private":
        return "Private mode: this document was not sent to any AI service."
    if user.is_demo:
        return "Demo workspaces use standard text reading, never AI."
    if get_settings().demo_mode:
        return "AI extraction is not set up on this server, so standard text reading was used."
    if not limits.ai_enabled:
        return "AI extraction is paused by the administrator, so standard text reading was used."
    # shortcut: check-then-act; concurrent jobs can overshoot by a few calls. Use a DB counter
    # row with SELECT ... FOR UPDATE if the limit must be exact.
    if ai_calls_today(db) >= limits.ai_daily_limit_global:
        return (
            "Today's shared AI budget is used up, so standard text reading was used. "
            "AI will be available again tomorrow."
        )
    if ai_calls_today(db, user.id) >= limits.ai_daily_limit_per_user:
        return (
            f"You have used today's {limits.ai_daily_limit_per_user} AI extractions, so standard "
            "text reading was used. AI will be available again tomorrow."
        )
    return None


def documents_today(db: Session, user_id: str) -> int:
    return (
        db.scalar(
            select(func.count()).where(
                Document.user_id == user_id, Document.created_at >= today_start()
            )
        )
        or 0
    )


def purge_expired_documents(db: Session, limits: Limits) -> int:
    """Data retention: delete documents (file and results) older than the configured days."""
    if not limits.retention_days:
        return 0
    cutoff = utcnow() - timedelta(days=limits.retention_days)
    n = db.execute(delete(Document).where(Document.created_at < cutoff)).rowcount
    db.commit()
    return n


def limits_dict(limits: Limits) -> dict:
    return asdict(limits)
